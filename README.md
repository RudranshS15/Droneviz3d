# DroneViz3D

**Single-pass drone video to a georeferenced semantic 3D scene**

Smart India Hackathon 2026 · SIH26158 · Team ByteCraft

> **What this produces, in one paragraph.** Detections from NVIDIA's LocateAnything-3B are
> projected through the camera model onto the ground plane, deduplicated across keyframes, and
> assembled into a point cloud. Object *positions and footprints* come from those detections.
> Object *heights* come from a per-class prior (`CLASS_HEIGHT_PRIOR`), and every surface point
> between objects is synthesized — so the result is an **illustrative semantic scene, not a
> measured reconstruction**, and a single pass with no stereo overlap cannot make it one. No
> mesh, no texture, no orthophoto. `exporter.ts` writes points and vertices only. The UI, the
> exports and the legal pages all say so; if a claim about this system cannot be checked
> against the code, treat it as unverified.

## Quick Start

    npm install
    npm run dev

Open http://localhost:3000/droneviz3d

Development and production output go to separate directories, so the dev server
can keep running while you build or run the full verify gate: `npm run dev`
writes `.next/`, while `npm run build` and `npm start` use `.next-build/`.
Sharing one directory is what used to let a build delete the dev chunks an open
tab was still requesting (it surfaced as `ChunkLoadError: Loading chunk … failed`,
or a script refused for being served as `text/plain`).

Both commands default to port 3000, so to serve a production build beside a
running dev server, pick another port: `npm start -- -p 3100`.

## Storage layout

On this workstation the checkout is stored on `D:\DroneViz3D`; its original path
becomes a directory junction to that copy after the one-time `--finish` step
below (C: is nearly full and D: has room). Nothing else has to change, because
the path does not.

`scripts/move-project-to-d.mjs` does the move in two resumable phases: the
default copies and then verifies every file, skipping whatever already matches;
`--finish` renames the original aside, creates the junction, and deletes the old
copy. Re-running either phase is always safe. `--finish` requires the app that
owns the folder (Freebuff) to be closed — Windows cannot rename a directory any
process has open — and reports that instead of half-doing the swap.
`scripts/move-project-to-d.cmd` is the double-click wrapper for it.

    node scripts/move-project-to-d.mjs           # copy / re-sync, safe at any time
    scripts\move-project-to-d.cmd                # swap, with Freebuff closed

Link the project root only — never `node_modules` or `.next`. Next rewrites
paths it resolves through a subdirectory link and the build dies with
`Can't resolve './D:/…/node_modules/next/…'`. On a fresh clone none of this
applies: `npm install && npm run dev` works anywhere.

## Tech Stack
- Next.js 15 + React 19
- Tailwind CSS
- Zustand (state management)
- WebGL Canvas (3D rendering)

## Security

See [`SECURITY.md`](SECURITY.md) for the full audit: the dependency scan, security
headers, the hardened inference worker, the admin backend controls, and §11 — the items
that depend on deployment and are deliberately **not** claimed as closed.

## Admin backend

An optional session-authenticated admin area lives at `/droneviz3d/admin`:

- **First-run**: set `ADMIN_BOOTSTRAP_TOKEN` (`openssl rand -hex 32`) on the
  server, then open `/droneviz3d/admin`, choose **Create account**, and paste the
  token — the first account becomes the administrator. A deployed instance
  **refuses** registration without that variable instead of letting whoever
  arrives first take the admin role. On `npm run dev` the token is optional, so
  local first-run is unchanged.
- **Owner account** (`OWNER_EMAILS`, optional): a comma-separated allowlist of
  the addresses that own the installation. Only those are admin by default — any
  other registration is a plain user even with the correct token — and only an
  owner can change anybody's role, so the only way someone becomes an admin is
  your deliberate promotion. Somebody you do promote can remove regular users
  (moderation) but never another admin and never you. An owner account can never
  be demoted or deleted by anyone, including itself, so you cannot be locked out
  of your own installation. Passwords are the only credential a user holds, so
  removing a user revokes their sessions immediately.
- **Auth**: argon2id password hashing; httpOnly SameSite cookies (7-day sessions);
  per-session CSRF tokens (required on every mutating call, refreshed via
  `GET /api/auth/me`); per-IP rate limits **plus per-account lockout** (5 bad
  passwords on one email → 15 min lock). Password changes need the current
  password (forced re-auth), sign out other sessions, and rotate the session
  cookie.
- **Storage**: local SQLite via Node's built-in `node:sqlite` — `data/droneviz3d.db`
  (gitignored). Every query is a prepared statement; the same file backs the
  shared rate-limit store so limits hold across server instances on one volume.
- **Admin APIs**: `GET /api/admin/users`, `PATCH /api/admin/users/[id]`
  (promote/demote — revokes the target's sessions), `DELETE /api/admin/users/[id]`
  (guards: no self-delete, no removing the last admin), `GET /api/admin/status`
  (includes a live LocateAnything worker health probe). All admin APIs are
  rate-limited.
- **Auth APIs**: `POST /api/auth/{register,login,logout}`, `GET /api/auth/me`,
  `PATCH /api/auth/password`.

Reset the backend by deleting `data/` and restarting the server.

## Guest use (no account)

Uploading, processing, the viewer and results need no account and no sign-in — the
only authenticated area is the admin panel. A finished reconstruction is kept in the
browser's own `localStorage` so a guest can return to their model days later; the raw
video never is. **Reset** on the Results page deletes that stored model from the
browser. See the Privacy Policy §§3 and 6, and the Cookies Policy §3.

## Pages
- `/droneviz3d` — Landing page
- `/droneviz3d/upload` — Video upload + GPS metadata form
- `/droneviz3d/processing` — 9-step pipeline visualization (`STEP_DEFINITIONS`)
- `/droneviz3d/viewer` — Interactive 3D point cloud viewer
- `/droneviz3d/results` — Metrics (measured vs estimated), detection-quality distribution, export
