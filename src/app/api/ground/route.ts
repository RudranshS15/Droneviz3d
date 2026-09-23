/**
 * POST /api/ground — server-side proxy to the LocateAnything-3B worker.
 *
 * The browser never sees WORKER_TOKEN / WORKER_URL: both live in server-side
 * env vars (.env.local) and this route injects the Authorization header.
 * Without WORKER_TOKEN set, the route refuses to run (503) rather than forward
 * unauthenticated — the worker would reject the request anyway.
 *
 * Limits mirror grounding-worker.py (≤24 frames, ≤8 MB/frame) so this route
 * cannot be abused as an open relay if it is ever exposed beyond localhost. The
 * aggregate body cap is enforced from Content-Length before the body is read,
 * and upstream inference runs with bounded concurrency.
 */

import { NextRequest, NextResponse } from 'next/server'
import { isSameOrigin } from '@/lib/auth'
import { groundLimiter, clientIp, rateLimitedResponse } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WORKER_URL = (process.env.WORKER_URL ?? 'http://127.0.0.1:8300').replace(/\/+$/, '')
const WORKER_TOKEN = process.env.WORKER_TOKEN ?? ''
const MAX_FRAMES = 24
const MAX_FRAME_BYTES = 8 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 90_000

/**
 * Aggregate body cap, enforced from Content-Length *before* the body is
 * buffered. `req.formData()` parses and holds the whole multipart payload in
 * memory, so validating frame sizes afterwards means a request can allocate its
 * full size first — the permitted payload alone reaches 192 MiB at the limits
 * above. With this check the server refuses on the declared length and never
 * reads the body.
 *
 * Multipart framing adds boundary and header bytes per part, hence the slack.
 * A request with no Content-Length (chunked transfer) cannot be pre-checked; it
 * still meets the per-frame limits below, and deployment ingress should cap
 * request bodies as well — see SECURITY.md.
 */
const MAX_PER_PART_OVERHEAD = 16 * 1024
const MAX_BODY_BYTES = MAX_FRAMES * (MAX_FRAME_BYTES + MAX_PER_PART_OVERHEAD)

/**
 * Upper bound on simultaneous upstream inference calls. The worker holds a GPU
 * batch; forwarding an unbounded number of concurrent requests turns a rate
 * limit into a queue of GPU work nobody can cancel. Excess requests are refused
 * immediately with Retry-After rather than queued.
 */
const MAX_CONCURRENT_UPSTREAM = 4
let inFlight = 0

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Same-origin gate: a drive-by page on another site must not be able to burn
  // worker compute. Browser clients always send Origin; non-browser callers
  // are still throttled by the rate limit below.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
  }

  // Proxy is anonymous (no session) so per-IP throttling is the defense.
  const limited = groundLimiter(clientIp(req))
  if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec)

  // Refuse an over-large body before reading it. Content-Length is the declared
  // size, so a lying client still meets the per-frame limits after parsing.
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: `Request body too large: ${MAX_BODY_BYTES / (1024 * 1024)} MB is the maximum` },
      { status: 413, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  if (!WORKER_TOKEN) {
    return NextResponse.json(
      { error: 'Grounding worker not configured. Set WORKER_TOKEN (and optionally WORKER_URL) in .env.local, then restart the server.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data body' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  const frames = form.getAll('frames')
  if (frames.length === 0) {
    return NextResponse.json({ error: 'At least one keyframe is required (field "frames")' }, { status: 422, headers: { 'Cache-Control': 'no-store' } })
  }
  if (frames.length > MAX_FRAMES) {
    return NextResponse.json({ error: `At most ${MAX_FRAMES} frames per request` }, { status: 422, headers: { 'Cache-Control': 'no-store' } })
  }

  const outgoing = new FormData()
  for (const f of frames) {
    if (!(f instanceof File)) {
      return NextResponse.json({ error: 'Every "frames" entry must be a file' }, { status: 422, headers: { 'Cache-Control': 'no-store' } })
    }
    if (f.size > MAX_FRAME_BYTES) {
      return NextResponse.json({ error: `Frame "${f.name}" exceeds the ${MAX_FRAME_BYTES / (1024 * 1024)} MB limit` }, { status: 413, headers: { 'Cache-Control': 'no-store' } })
    }
    outgoing.append('frames', f, f.name)
  }
  outgoing.append('labels', String(form.get('labels') ?? 'building,vehicle,tree'))

  // Bounded concurrency: a full slot pool means "try again shortly", not "wait
  // in an unbounded queue".
  if (inFlight >= MAX_CONCURRENT_UPSTREAM) {
    return NextResponse.json(
      { error: 'Grounding worker is busy — try again shortly' },
      { status: 503, headers: { 'Retry-After': '5', 'Cache-Control': 'no-store' } }
    )
  }

  inFlight++
  try {
    const upstream = await fetch(`${WORKER_URL}/ground`, {
      method: 'POST',
      body: outgoing,
      headers: { Authorization: `Bearer ${WORKER_TOKEN}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const body = await upstream.text()
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const detail = err instanceof Error && err.name === 'TimeoutError'
      ? 'Grounding worker timed out'
      : 'Grounding worker unreachable — is grounding-worker.py running?'
    return NextResponse.json({ error: detail }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  } finally {
    inFlight--
  }
}