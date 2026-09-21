# DroneViz3D

**Single-Pass Drone Video to Accurate 3D Model Generation System**

Smart India Hackathon 2026 · SIH26158 · Team ByteCraft

## Quick Start

    npm install
    npm run dev

Open http://localhost:3000/droneviz3d

## Tech Stack
- Next.js 15 + React 19
- Tailwind CSS
- Zustand (state management)
- WebGL Canvas (3D rendering)

## Security

See [`SECURITY.md`](SECURITY.md) for the full audit: zero vulnerabilities, security
headers, hardened inference worker, and the admin backend controls.

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
- `/droneviz3d/processing` — 10-step pipeline visualization
- `/droneviz3d/viewer` — Interactive 3D point cloud viewer
- `/droneviz3d/results` — Metrics, confidence maps, export
