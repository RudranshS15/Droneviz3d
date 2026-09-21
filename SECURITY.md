# Security Audit — DroneViz3D

Audit date: September 8, 2026 · Result: **npm audit: 0 vulnerabilities**

## Architecture matters here

DroneViz3D is a Next.js app: 3D reconstruction runs **entirely in the browser**
(Zustand state + WebGL canvas; the raw video never leaves the device). Since
September 2026 it also ships an **optional admin backend** (SQLite + session auth,
see §9) that the operator enables by creating the first account at
`/droneviz3d/admin`, which requires the bootstrap token to claim an admin role
on a deployed instance (§9.1). The reconstruction pipeline itself still has no
server-side involvement; the admin backend only stores login data.

The only other network-facing component is `grounding-worker.py` (the optional
LocateAnything-3B inference service), which has been hardened — see §8.

## Control-by-control status

| # | Requested control | Status | Where / evidence |
|---|---|---|---|
| 1 | API keys hidden | ✅ | Zero secrets in code; `.env` files gitignored (`*.env`, `*.pem`, `*.key`, …); `.env.example` is an empty template. No `NEXT_PUBLIC_*` secrets exist. |
| 2 | Env variables checked | ✅ | Four variables are read, all inspected: `WORKER_URL` + `WORKER_TOKEN` (server-only, injected by the grounding proxy so the browser never sees the token), `NEXT_PUBLIC_GROUNDING_MODE` (public by design — a non-secret mode flag), and `ADMIN_BOOTSTRAP_TOKEN` (server-only, gates first-admin setup — §9.1). `NODE_ENV` is set by Next itself. `.env.example` documents each with a public-vs-server explanation. |
| 3 | Admin routes protected | ✅ | `/droneviz3d/admin/*` is guarded server-side (session + role check in each page); admin APIs require an admin session. Guards run in Node server components — the Edge middleware runtime cannot open the local SQLite DB, so `middleware.ts` is intentionally absent. Next is on 15.5.x (middleware-bypass CVE GHSA-f82v-jwr5-qhjx / CVE-2025-29927 patched). |
| 4 | Proper authentication | ✅ | Session-based: random 256-bit tokens in SQLite, delivered as httpOnly + SameSite=Lax + Secure-on-HTTPS cookies, 7-day expiry, **double-submit CSRF token per session** (server-side value + `X-CSRF-Token` header). Passwords argon2id (OWASP params). Rate-limited login/register + **account-level lockout** (5 bad passwords on one email → 15 min lock, independent of IP). Password change requires forced re-auth and **rotates the session cookie** + signs out other sessions. |
| 5 | User access control | ✅ | Roles: `user` / `admin`, with an **owner allowlist** (`OWNER_EMAILS`, §9.2): only listed addresses are admin by default and only an owner may grant the role to anyone else or remove a user, so every promotion is the owner's own decision. An owner account can never be demoted or deleted by anyone. Claiming admin additionally requires `ADMIN_BOOTSTRAP_TOKEN` on any deployment, so a public instance cannot be seized before the owner registers (§9.1). Admin-only: user list, **role change (promote/demote)**, delete user (self-delete + last-admin guards), system status. Role changes **revoke the user's sessions** so a token minted under the old role can't be reused; new sign-in gets a rotated cookie. |
| 6 | Form sanitization | ✅ | All inputs validated client-side (`validator.ts`: ranges, types, dates) before use; React escapes all rendered values; labels sent to the worker are length/character-capped and deduplicated. CSV export contains only numeric values (no formula-injection vector). |
| 7 | XSS protection | ✅ | Zero `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `document.write` in `src/` (verified by search). Worker output is parsed with regex into numbers and rendered as text/canvas only. Production CSP active (see §7). |
| 8 | Rate limiting | ✅ | Login/register/password-change: 5–10 attempts per 15 min per IP **plus** per-account failure locks. Admin API: 120 calls/min/IP. Grounding proxy: 60 POSTs/10 min/IP. Worker: 30 req/min/IP. All site limiters are **backed by the shared SQLite store** (`rate_events` table in the same `data/` DB), so they hold across multiple server processes/instances on one volume — not just one process's memory. |
| 9 | API endpoints secured | ✅ | Worker: bearer-token auth (required unless loopback + explicitly disabled), upload size/dimension/format caps, label caps, `Cache-Control: no-store`, `docs` endpoints disabled. |
| 10 | CORS checked | ✅ | Worker CORS locked to `http://localhost:3000` + `http://127.0.0.1:3000`, no credentials. Site itself is same-origin; no third-party origins anywhere. |
| 11 | Security headers | ✅ | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, CSP + HSTS (production), `X-Powered-By` removed. |
| 12 | Debug mode off | ✅ | No debug flags and no `console.log` in `src/`; production build is stripped. Three deliberate `console.warn` calls exist, all operator diagnostics carrying no secrets: oversized-model persistence, worker-grounding fallback, and a refused administrator setup. React Strict Mode enabled (dev-only behavior, catches bugs early). |
| 13 | Dependencies updated | ✅ | Next 14.2.35 → **15.5.25**, React 18 → **19.2**, Zustand 4 → **5**, PostCSS 8.4.31 → **8.5.28** (incl. the copy bundled inside Next, forced via `overrides`). |
| 14 | Unused packages removed | ✅ | All deps are used (next/react/react-dom/zustand + Tailwind toolchain). None removed; none added beyond the upgrade. |
| 15 | Exposed files checked | ✅ | `git ls-files` shows no secrets, keys, or credentials. `.gitignore` now also covers all `.env.*`, certs/keys, logs, coverage, and `screenshots/`. |
| 16 | Database access secured | ✅ | Local SQLite (`data/droneviz3d.db`, gitignored, WAL mode, foreign keys on). No credentials in code; no network exposure; single-owner file permissions. |
| 17 | Passwords hashed | ✅ | argon2id (m=19456 KiB, t=2, p=1 — OWASP parameters) via `@node-rs/argon2`. Verification is constant-time and failure-agnostic; hashes are never logged. |
| 18 | SQL injection protection | ✅ | Every query is a prepared statement (`node:sqlite` built-in module — zero native deps); no string-built SQL anywhere in `src/lib/db.ts`. |
| 19 | HTTPS enabled | ✅* | `*` Deployment-level. HSTS (preload) + `upgrade-insecure-requests` are configured and activate automatically on HTTPS hosts. Local `npm run dev` is intentionally plain HTTP on loopback. |
| 20 | Security audit run | ✅ | `npm audit` → **0 vulnerabilities** (was 2 high). Typecheck clean; production build passes (§10). |

## 7. Content Security Policy (production)

`default-src 'self'`; scripts/styles from self with `unsafe-inline` (required by
Next.js's inline bootstrap + Tailwind); media/images `blob:`/`data:` for the
in-browser pipeline; `object-src 'none'`, `base-uri 'self'`,
`frame-ancestors 'none'`, `form-action 'self'`; worker allowed via
`connect-src` to `http://127.0.0.1:8300` only. CSP is applied only in
production builds (`next build`), because dev-mode HMR requires inline scripts.

## 8. grounding-worker.py hardening

The web app talks to the worker through a server-side proxy (`src/app/api/ground`):
`WORKER_TOKEN` and `WORKER_URL` live in server-only env vars and are injected into
`Authorization: Bearer` by the proxy — the token is never in the browser bundle.
The public flag `NEXT_PUBLIC_GROUNDING_MODE=worker` (not a secret) switches the
app to the real backend; keyframes are extracted from the video in the browser and
POSTed through the proxy. Without a token the proxy returns 503 and the store
falls back to the simulated adapter.

- **Auth**: `WORKER_TOKEN` / `--token`; `/ground` and `/health` return 401 without
  a valid `Authorization: Bearer` header. Refuses to bind a non-loopback address
  without a token.
- **Rate limit**: 30 req/min per client IP (in-memory sliding window).
- **Request caps**: ≤ 24 frames, ≤ 8 MB/frame (chunked read), ≤ 8192×8192 px,
  PIL decompression-bomb guard, JPEG/PNG/WebP allowlist, ≤ 20 labels, labels
  stripped of control characters and truncated to 64 chars.
- **CORS**: only `http://localhost:3000` / `http://127.0.0.1:3000`, no credentials.
- **Headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on `/ground`.
- **Footprint**: API docs UI disabled (`docs_url=None`).
- If you ever expose it beyond loopback: put it behind a reverse proxy with TLS
  and real auth, and add a persistent rate-limit store (e.g. Redis).

## 9. Admin backend — implemented controls

Implemented September 2026:

1. **Auth**: session-based. Token = 32 random bytes stored in SQLite; browser
   holds only the httpOnly, SameSite=Lax cookie (Secure in production, 7-day
   TTL).
2. **CSRF**: every session stores its own 16-byte token next to the session
   row. All mutating, session-authenticated routes (logout, password change,
   delete user, change role) require it echoed in the `X-CSRF-Token` header;
   the admin UI fetches it fresh from `/api/auth/me` per call so it stays valid
   after session rotation. Login/register (sessionless) and the grounding proxy
   use the same-origin `Origin` check + rate limits instead.
3. **Passwords**: argon2id (m=19456, t=2, p=1) via `@node-rs/argon2`; generic
   error messages on failed login (no account enumeration); registration and
   login rate-limited per IP.
4. **Account lockout**: 5 failed passwords on one **email** locks that account
   for 15 minutes regardless of source IP (defeats IP rotation); a successful
   login clears the counter. Password changes get the same per-user lock on the
   forced re-authentication step.
5. **Password change** (`PATCH /api/auth/password`): current password must be
   verified (forced re-auth), new password validated, **all other sessions
   revoked**, and the current session cookie **rotated** to a fresh token.
6. **Privilege change** (`PATCH /api/admin/users/[id]` promote/demote):
   self-change refused, last-admin demotion refused; on success the target
   user's sessions are revoked so they must sign in again (rotated cookie
   under the new role). With `OWNER_EMAILS` set the owner is the only account
   that may change a role, the owner account itself is refused as a target,
   and no unlisted address can be given the admin role at all (§9.2).
7. **Database**: `node:sqlite` (built into Node — nothing to compile), file in
   `data/` (gitignored), WAL mode, FK enforcement, prepared statements only.
8. **Admin routes**: `/droneviz3d/admin/*` pages and `/api/admin/*` routes all
   verify the session server-side and require role `admin`. Delete-user guards:
   cannot remove yourself or the last admin.
9. **Rate limiting (shared)**: limiters read/write a `rate_events` table in
   the shared `data/droneviz3d.db` instead of process memory, so limits hold
   across multiple instances on one host/volume (sliding window, per-key
   prune + global sweep). Instances on separate machines with no shared disk
   need a Redis-backed store behind the same interface (`addRateEvent` /
   `countRateEvents` / … in `src/lib/db.ts`) — that swap is the one remaining
   scale step. Re-run `npm audit` on every dependency change; keep `next` on
   the latest patched 15.x/16.x line.

### 9.1 First-administrator bootstrap

Auto-granting the admin role to the first account that registers is harmless on
a developer's machine and unsafe on a deployed instance: the winner is whoever's
request arrives first, and against a public URL that is frequently a scanner
rather than the person who deployed the app. Registration therefore never
escalates itself:

- An installation that **already has an administrator** only ever creates plain
  `user` accounts through registration — knowing the token grants nothing.
- On an installation with **no administrator**, the admin role requires
  `ADMIN_BOOTSTRAP_TOKEN` (`openssl rand -hex 32`) to be sent with the
  registration and to match. The comparison is constant-time and runs over
  SHA-256 digests, so neither value's length leaks through timing. Once an admin
  exists the token is never consulted again, so the variable can be deleted.
- With no administrator and **no configured token**, registration is *refused*
  (403) instead of quietly creating a plain user. That distinction is the whole
  point: a downgraded user would occupy the first-account slot and lock the
  legitimate owner out of the token path permanently.
- The token-free path is additionally limited to requests that look local: the
  client address (first `X-Forwarded-For` entry, else `X-Real-IP`) **and** the
  `Host` must both be loopback, and the path is disabled entirely in production —
  a spoofed `X-Forwarded-For: 127.0.0.1` is still refused there. Note that
  Next.js sets `x-forwarded-*` on every request itself, so this check reads the
  header *values* rather than their presence. It exists only so `npm run dev`
  on your own machine keeps its first-run flow.

A refused attempt writes nothing: no user row, no session, no rate-limit slot
consumed beyond the normal per-IP budget. The full decision table is unit-tested
in `tests/bootstrap.test.ts`.

### 9.2 Owner accounts

`OWNER_EMAILS` (comma-separated, server-only) names the accounts that own the
installation. It is the answer to "only my address may be admin, and nobody can
take that away from me":

- **Only listed addresses are admin by default.** Any other registration is a
  plain `user`, *even when the correct bootstrap token is presented* — the token
  proves "I am setting this up", not "I am the owner".
- **Only an owner may grant admin, or remove a user.** This is what "others can
  be admin only with my confirmation" reduces to: the owner is the only actor who
  can pass the check, so the sole source of a new admin is the owner deliberately
  promoting one. A promoted admin gets the dashboard but cannot change roles,
  remove anyone, or touch the owner.
- **An owner account is immutable.** It cannot be demoted, deleted, or have its
  sessions revoked — not by another admin, not by a second owner, and not by
  itself. This is what makes lockout structurally impossible rather than merely
  guarded: the `last-admin` checks exist for installations with no allowlist.
- **The token still gates the claim.** Being listed is necessary but not
  sufficient on a deployment: without a matching `ADMIN_BOOTSTRAP_TOKEN` the
  claim is refused, so knowing an address is not enough to take the account.
  Addresses are matched exactly (case-insensitively, trimmed) — a substring or
  suffix match would let `owner@example.com.evil.test` inherit owner powers.

Unset, the installation keeps the previous behaviour: the bootstrap token
decides the first admin, every admin may manage users, and the last-admin guard
is the only lockout protection. Parsing and matching are unit-tested in
`tests/owners.test.ts`; the interaction with the token gate is covered in
`tests/bootstrap.test.ts`.

## 10. Verification commands

```bash
npm audit                 # 0 vulnerabilities
npx tsc --noEmit          # clean
npm run build             # production build passes
```

## Reporting a vulnerability

This is a student project. If you find a real vulnerability, open a private issue
in the repository or email the maintainers (see the Privacy Policy contact) rather
than posting exploit details publicly.