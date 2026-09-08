"""
grounding-worker.py — LocateAnything-3B inference service for DroneViz3D.

Hosts NVIDIA's LocateAnything-3B (nvidia/LocateAnything-3B on Hugging Face) and
exposes a small HTTP API that the web app's `createLocateAnythingAdapter` can call.
The web app ships with a deterministic simulated adapter with the identical
interface, so swapping this worker in changes nothing else in the codebase.

Why a separate worker: LocateAnything-3B needs a CUDA GPU (H100 / RTX 4090 class
recommended; the `la_flash` runtime targets A100, RTX 4090 and other non-Hopper/
Blackwell cards) and several GB of weights. Browsers cannot host it, so the model
runs server-side and keyframes are POSTed to it.

SECURITY NOTES
--------------
- The worker binds to 127.0.0.1 by default so it is only reachable from the
  machine running the browser. Do NOT expose it on 0.0.0.0 without TLS, a
  bearer token, and a reverse proxy in front of it.
- Start it with --token (or set WORKER_TOKEN) so the web app must authenticate.
  Without a token the API is open to anything that can reach the port.
- Built-in limits: per-IP rate limiting, max frames per request, max bytes per
  frame, max image dimensions, max labels, image format allowlist. These bound
  memory/CPU abuse on the host GPU machine.
- CORS is restricted to the local dev/prod origins of the web app.
- Response headers: X-Content-Type-Options nosniff, Cache-Control no-store.

Setup
-----
    git clone https://github.com/NVlabs/Eagle.git eagle
    cd eagle/Embodied && pip install -e .
    pip install fastapi uvicorn python-multipart pillow

    # Optional high-throughput runtime (from the HF model repo):
    #   hf download nvidia/LocateAnything-3B --local-dir LocateAnything-3B
    #   export PYTHONPATH="$PWD/LocateAnything-3B:$PYTHONPATH"
    #   export LA_FLASH_ATTN=la_flash

    export WORKER_TOKEN="$(openssl rand -hex 32)"
    python grounding-worker.py --port 8300

API
---
POST /ground
    multipart/form-data:
      frames:   one or more image files (JPEG/PNG/WebP keyframes)
      labels:   comma-separated query labels, e.g. "building,vehicle,tree"
    Authorization: Bearer <WORKER_TOKEN>
    -> {"results": [{"boxes": [{"label","x1","y1","x2","y2","score"}], "raw": "..."}]}
    Box coords are normalized to [0, 1], top-left origin — matching GroundingBox.

The model output format is Parallel Box Decoding tokens:
    <ref>label</ref><box><x1><y1><x2><y2></box>   coords in [0, 1000]
    <box><x><y></box>                             points
    <box>none</box>                               no object
which we parse with the same regex the reference implementation uses.
"""

from __future__ import annotations

import argparse
import io
import os
import re
import secrets
import time
from collections import defaultdict, deque
from typing import List

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image, UnidentifiedImageError

# ---------------------------------------------------------------------------
# Hard limits — keep memory and GPU time bounded per request.
# ---------------------------------------------------------------------------

MAX_FRAMES_PER_REQUEST = 24
MAX_FRAME_BYTES = 8 * 1024 * 1024        # 8 MB per keyframe
MAX_IMAGE_PIXELS = 40_000_000            # PIL decompression-bomb ceiling
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
MAX_LABELS = 20
MAX_LABEL_LENGTH = 64
RATE_LIMIT_PER_MINUTE = 30               # /ground requests per client IP
CHUNK_SIZE = 64 * 1024

app = FastAPI(title="DroneViz3D LocateAnything-3B worker", docs_url=None, redoc_url=None)

# CORS: only the local web app origins. The worker binds to 127.0.0.1, so this
# is defense-in-depth, not the primary boundary.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["POST", "GET"],
    allow_headers=["Authorization", "Content-Type"],
    allow_credentials=False,
    max_age=600,
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path == "/ground":
        response.headers["Cache-Control"] = "no-store"
    return response


# ---------------------------------------------------------------------------
# Auth + rate limiting (in-memory; fine for a single-user local worker)
# ---------------------------------------------------------------------------

TOKEN = os.environ.get("WORKER_TOKEN", "").strip()


def _authorized(authorization: str | None) -> bool:
    if not TOKEN:
        # No token configured — refuse to run in an exposed state only if the
        # user explicitly demanded one; otherwise warn loudly at startup.
        return True
    if not authorization:
        return False
    scheme, _, cred = authorization.partition(" ")
    return scheme.lower() == "bearer" and secrets.compare_digest(cred.strip(), TOKEN)


_HITS: dict[str, deque[float]] = defaultdict(deque)


def _rate_limited(client: str) -> bool:
    now = time.monotonic()
    window = _HITS[client]
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= RATE_LIMIT_PER_MINUTE:
        return True
    window.append(now)
    return False


async def _read_limited(upload: UploadFile) -> bytes:
    """Read the upload in chunks, aborting if it exceeds MAX_FRAME_BYTES."""
    data = bytearray()
    while True:
        chunk = await upload.read(CHUNK_SIZE)
        if not chunk:
            break
        data.extend(chunk)
        if len(data) > MAX_FRAME_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Frame exceeds the {MAX_FRAME_BYTES // (1024 * 1024)} MB limit",
            )
    return bytes(data)


def _decode_frame(data: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except UnidentifiedImageError:
        raise HTTPException(status_code=422, detail="Uploaded frame is not a valid image")
    except Image.DecompressionBombError:
        raise HTTPException(status_code=422, detail="Image dimensions exceed the safety limit")
    if img.format not in ALLOWED_FORMATS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported image format {img.format}; allowed: {', '.join(sorted(ALLOWED_FORMATS))}",
        )
    if img.width > 8192 or img.height > 8192:
        raise HTTPException(status_code=422, detail="Frame dimensions exceed 8192x8192")
    return img.convert("RGB")


# ---------------------------------------------------------------------------
# Model loading (lazy, so `--check` works without a GPU)
# ---------------------------------------------------------------------------

WORKER = None
MODEL_ID = "nvidia/LocateAnything-3B"


def get_worker():
    global WORKER
    if WORKER is None:
        # Requires NVlabs/Eagle (Embodied) installed: provides locateanything_worker.
        from locateanything_worker import LocateAnythingWorker  # type: ignore

        WORKER = LocateAnythingWorker(MODEL_ID)
    return WORKER


# ---------------------------------------------------------------------------
# Output parsing — mirrors the reference parser from the LocateAnything README
# ---------------------------------------------------------------------------

BOX_RE = re.compile(r"<ref>([^<]*)</ref><box><(\d+)><(\d+)><(\d+)><(\d+)></box>")
POINT_RE = re.compile(r"<box><(\d+)><(\d+)></box>")


def parse_answer(answer: str, width: int, height: int, labels: List[str]) -> List[dict]:
    boxes = []
    for m in BOX_RE.finditer(answer):
        label = m.group(1) or (labels[0] if labels else "object")
        x1, y1, x2, y2 = (int(m.group(i)) for i in range(2, 6))
        # Model emits coords in [0, 1000] relative to the image.
        nx1, nx2 = sorted((x1 / 1000.0, x2 / 1000.0))
        ny1, ny2 = sorted((y1 / 1000.0, y2 / 1000.0))
        if nx2 - nx1 < 0.002 or ny2 - ny1 < 0.002:
            continue  # degenerate box
        boxes.append(
            {
                "label": label[:MAX_LABEL_LENGTH],
                "x1": nx1, "y1": ny1, "x2": nx2, "y2": ny2,
                # Heuristic score; replace with native token logprobs if exposed.
                "score": 0.9,
            }
        )
    return boxes


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


@app.post("/ground")
async def ground(
    request: Request,
    frames: List[UploadFile] = File(...),
    labels: str = Form("building,vehicle,tree"),
    authorization: str | None = Header(default=None),
):
    if not _authorized(authorization):
        raise HTTPException(status_code=401, detail="Missing or invalid bearer token")
    client = request.client.host if request.client else "unknown"
    if _rate_limited(client):
        raise HTTPException(status_code=429, detail="Rate limit exceeded; try again shortly")

    if not frames or len(frames) > MAX_FRAMES_PER_REQUEST:
        raise HTTPException(
            status_code=422,
            detail=f"Send between 1 and {MAX_FRAMES_PER_REQUEST} frames per request",
        )

    # Sanitize labels: cap count + length, drop control characters.
    raw_labels = labels.split(",")
    label_list: list[str] = []
    for raw in raw_labels:
        cleaned = "".join(ch for ch in raw.strip() if ch.isprintable())[:MAX_LABEL_LENGTH]
        if cleaned and cleaned not in label_list:
            label_list.append(cleaned)
    if not label_list:
        raise HTTPException(status_code=422, detail="At least one non-empty label is required")
    if len(label_list) > MAX_LABELS:
        raise HTTPException(status_code=422, detail=f"At most {MAX_LABELS} labels per request")

    worker = get_worker()
    results = []
    for f in frames:
        data = await _read_limited(f)
        img = _decode_frame(data)
        answer = worker.detect(img, label_list)["answer"]
        results.append(
            {
                "boxes": parse_answer(answer, img.width, img.height, label_list),
                "raw": answer,
            }
        )
    return JSONResponse({"results": results})


@app.get("/health")
async def health(authorization: str | None = Header(default=None)):
    if TOKEN and not _authorized(authorization):
        raise HTTPException(status_code=401, detail="Missing or invalid bearer token")
    return {"status": "ok", "model": MODEL_ID, "loaded": WORKER is not None, "auth": bool(TOKEN)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8300)
    parser.add_argument("--host", default="127.0.0.1", help="Bind address; keep 127.0.0.1 unless TLS + proxy are in place")
    parser.add_argument("--token", default=None, help="Bearer token for /ground (default: $WORKER_TOKEN)")
    args = parser.parse_args()

    if args.token:
        TOKEN = args.token
    if not TOKEN:
        print("WARNING: no WORKER_TOKEN set — /ground is unauthenticated.")
        print("         Generate one with:  openssl rand -hex 32")
        if args.host not in ("127.0.0.1", "localhost"):
            raise SystemExit("Refusing to bind a non-loopback address without a token")

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port)