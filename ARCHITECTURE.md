# DroneViz3D — Architecture Audit

An honest map of what the app is, how data flows through it, what is measured versus
synthesized, and what would have to change to make the 3D output a real survey product.

Reviewed at commit `2b332f9` (characterization suite) plus the orientation / framing /
results-correctness work that follows it.

---

## 1. The one thing to understand first

**The current pipeline does not recover surfaces.** It detects objects on keyframes with
LocateAnything-3B, projects each detection through the camera model onto the ground plane,
deduplicates across views, and *synthesizes* a point cloud and mesh from those grounded
objects. Surface texture and fine geometry between detected objects are generated, not
measured.

That is a data-source limitation, not a rendering limitation. A better viewer makes the
result clearer, smoother, and more honestly labelled — it does not make it accurate.
Recovering real surfaces is a backend photogrammetry project (structure-from-motion /
multi-view stereo, or LiDAR), and is scoped out below in §7.

Everything in the UI that describes the output is written against this constraint: the
processing page, the results status states, `COMPLIANCE.md`, and the legal pages all say
the model is synthesized from detections.

---

## 2. Module map

### Pipeline (browser, no server round-trip except grounding)

| Module | Responsibility | Notes |
| --- | --- | --- |
| `validator.ts` | Parses and validates an uploaded flight log (CSV/JSON), returns typed flight data or structured errors | Pure; bounds-checked field by field |
| `geometry.ts` | Camera model, ENU frame, flight pose interpolation, deterministic RNG (`mulberry32`), hashing | Pure; the **coordinate contract** lives here |
| `grounding.ts` | LocateAnything-3B adapter: response parsing, keyframe planning, box → ground projection, cross-view dedup, confidence scoring, the simulated adapter | Pure logic + one `fetch` adapter |
| `pipeline.ts` | Step definitions, progress model, demo adapter, timing metadata | Pure |
| `reconstruct.ts` | Turns grounded objects into the point cloud, trajectory, confidence annotations, and metrics | Pure; deterministic given the same input |
| `exporter.ts` | PLY / OBJ / CSV serialization | Pure; deliberately no GeoTIFF/DEM/LAS |

### View layer

| Module | Responsibility | Why it is separate |
| --- | --- | --- |
| `viewer-camera.ts` | Orbit camera, view basis, projection, gizmo axes, framing | Pure — testable without a DOM |
| `viewer-render.ts` | Canvas drawing: points, path, markers, gizmo, scale bar | Typed against a structural 2D-context interface so tests use a recording stub |
| `scene.ts` | Scene composition: bounds incl. near-flight-path, layer model, path-fit | Pure |
| `confidence.ts` | The single confidence scale (thresholds + colours + labels) | One definition shared by viewer and results |
| `results-view.ts` | Derived results state: status id, measured vs estimated, empty/partial/restored presentation | Pure |
| `store.ts` | Zustand store, pipeline orchestration, `sessionStorage` persistence | Only module that touches browser storage |

### Server

| Route | Purpose | Protection |
| --- | --- | --- |
| `POST /api/ground` | Proxy to `grounding-worker.py`; injects the bearer token so it never reaches the browser | Rate limited (60 / 10 min / IP), same-origin check, target allow-listed |
| `POST /api/auth/{register,login,logout,password}` | Session auth | argon2id, IP + email lockout, CSRF on state-changing calls |
| `GET /api/auth/me` | Session identity + CSRF token | Session cookie required |
| `/api/admin/*` | User list, role change, delete, status | Session + `admin` role + CSRF + rate limit |

`src/lib/` holds `db.ts` (SQLite via `node:sqlite`, all prepared statements),
`auth.ts` (hash/verify, session + CSRF issuance and rotation), and `rate-limit.ts`
(shared-store sliding window). See `SECURITY.md`.

---

## 3. Data flow

```
flight log ──validate──▶ RawFlightData
                            │
uploaded video ──▶ keyframe plan (grounding.ts)
                            │
                            ▼
              POST /api/ground ──▶ grounding-worker.py ──▶ LocateAnything-3B (GPU)
                            │                                   │
                            ◀── boxes in [0,1000] image space ───┘
                            │
                    projectBoxToGround (camera model, ground plane)
                            │
                    deduplicateDetections (multi-view corroboration)
                            │
                       TrackedObject[]
                            │
                        reconstruct
                            │
        ┌───────────────────┼────────────────────┬─────────────────┐
        ▼                   ▼                    ▼                 ▼
   Point3D[]         ReconstructionPose[]  ConfidenceAnnotation[]  metrics
        │                   │                    │                 │
        └─────────┬─────────┴──────────┬─────────┘                 │
                  ▼                    ▼                           ▼
            viewer-render        scene.ts (layers, fit)      results-view.ts
```

When the worker is unreachable the store falls back to the simulated adapter, and the UI
says so. The simulated adapter implements the same interface as the real one, so the rest
of the pipeline cannot tell them apart — which is exactly why the status states in
`results-view.ts` exist.

---

## 4. The coordinate contract (P0)

`geometry.ts` produces a local **ENU** frame: `x` = East, `y` = North, `z` = Up, metres.
This is the same convention the georeferenced export uses.

The bug class this prevents: a viewer that assumes a y-up graphics convention silently
renders the model on its side, and a gizmo drawn from a hard-coded basis then *agrees with
the wrong picture*, so the error looks like a feature. The fix is structural:

- `viewer-camera.ts` exports `WORLD_UP = {0,0,1}` and derives `right`/`up` from an
  explicit basis at every camera pose. Nothing in the renderer hard-codes an axis.
- The gizmo is drawn from that same basis, so it cannot disagree with the rendered points.
- Elevation is clamped short of the poles so the basis never degenerates.
- `tests/viewer-camera.test.ts` asserts the ground plane stays horizontal, that heights
  rise on screen, and that the gizmo's up axis tracks camera elevation.

---

## 5. Framing and interaction (P1)

- **Framing** fits the actual model bounds box, not a bounding sphere, then verifies by
  projecting every corner — a wide flat footprint fitted by sphere looks tiny on screen.
  Auto-fit runs on load, resize, and reset.
- **Layers** are independent: points (with adjustable point size), detections, trajectory,
  and confidence colouring can each be toggled without affecting the others.
- **Selection** focuses the camera on an object and surfaces its supporting observations.
- **Path vs model scale**: a straight pass can cruise 100 m+ above a small model, so the
  trajectory is drawn beyond the model bounds and `scene.ts` can frame "path only" — with
  an on-screen hint when the path is off-frame rather than silently invisible.
- Camera and scene mathematics are pure modules; renderer correctness is checked against a
  recording stub, so none of this needs a browser to test.

---

## 6. Honesty in the results layer (P2)

`results-view.ts` answers two questions as pure functions:

1. **Status** — `empty | running | incomplete | partial | restored | complete`. A run that
   produced no model, a run interrupted mid-way, and a session restored without its point
   cloud each get a distinct message. None of them renders as a successful survey.
2. **Provenance** — object counts and observations are *measured* (of the input frames);
   point counts, coverage, and confidence weights are *estimates* (of the synthesis step).
   The results page groups them separately instead of presenting one undifferentiated
   number grid.

Confidence colours come from `confidence.ts`, shared with the viewer, so the chart and the
picture cannot drift apart. Bands differ in lightness as well as hue, so the scale survives
colour-vision differences and greyscale printing. Export failures surface as an explicit
error state with the failing format named.

---

## 7. Known limitations and deferred work

| Limitation | Consequence | What a real fix looks like |
| --- | --- | --- |
| No surface recovery | The model is synthesized from detections; texture between objects is generated | SfM / MVS or LiDAR backend; a separate project |
| Single straight pass | No stereo overlap, so even a real pipeline could not triangulate dense surfaces | Flight planning with overlapping passes |
| Ground-plane projection | Objects are placed at the ground plane, so true height above ground is estimated | Per-object height from multi-view ray intersection |
| Simulated adapter fallback | Runs without a worker produce plausible-looking but synthetic detections | Always-on GPU worker; the results status already distinguishes these runs |
| Rate limiter is SQLite-backed | Correct across instances sharing a volume; wrong across hosts with no shared disk | Redis behind the same interface (see `SECURITY.md`) |
| `sessionStorage` persistence | Model survives reloads but not a new tab or browser restart | Accepted trade-off: privacy-first, no cross-session storage |

---

## 8. Testing strategy

`npm test` builds the project under `tsconfig.test.json` and runs Node's built-in test
runner — no browser, no extra framework.

| Suite | Locks down |
| --- | --- |
| `geometry.test.ts` | Flight parsing, pose interpolation, ENU frame, RNG determinism |
| `grounding.test.ts` | Response parsing incl. `none`, box projection, dedup, confidence |
| `reconstruct.test.ts` | Determinism, point/trajectory/metric invariants |
| `exporter.test.ts` | PLY/OBJ/CSV shape and precision; georeferencing |
| `viewer-camera.test.ts` | Orientation, gizmo basis, framing fits the bounds box |
| `viewer-render.test.ts` | Draw-call sequence, layer independence, off-frame path hint |
| `scene.test.ts` | Bounds incl. near path, path-fit view |
| `confidence.test.ts` | Band contiguity, coverage of [0,1], colour distinctness |
| `results-view.test.ts` | Every status state and the measured/estimated split |
| `store-persistence.test.ts` | Compact encode/decode round-trip, oversized-model degradation |

`npm run verify` runs typecheck + lint + test. CI (`.github/workflows/ci.yml`) requires all
three on every push, so the orientation and framing contracts cannot silently regress.

---

## 9. Change guidance

- **Never re-derive the up-axis.** Add camera math to `viewer-camera.ts` and test it there.
- **Never add a second confidence scale.** Add bands to `confidence.ts`.
- **Never let a new status state render as success by default.** Extend the union in
  `results-view.ts` and test it.
- **Keep `reconstruct.ts` deterministic.** Same flight data must yield the same model.
- **Anything that claims accuracy needs a measurement behind it** — see `COMPLIANCE.md`
  for the claim-review checklist.
