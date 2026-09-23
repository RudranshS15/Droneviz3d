# Compliance Notes

Last reviewed: September 24, 2026 (India-focused deployment)

## 1. Data protection — DPDP Act, 2023

- **Consent before processing**: the upload form requires an explicit, purpose-limited
  consent checkbox (`data-consent`) before any reconstruction starts. The consent
  purpose is stated in plain language next to the checkbox, per §6(1) and the notice
  requirements of §5(1) DPDP Act — and it is **mode-aware**, because the two modes
  process different things:
  - *Browser/simulated mode* — "processing this video and the flight metadata I entered,
    on my device only".
  - *Worker mode* — additionally "sending sampled keyframes to the operator-run
    LocateAnything-3B inference worker". The video itself is still never uploaded.
- **Purpose limitation & data minimization**: only the video, the flight metadata the
  user types, and a session consent flag are processed. Nothing else is collected.
  The consent notice lists exactly what is processed and why.
- **Storage limitation**: the video remains in-memory page state and is gone on tab
  close. The *generated model* and its flight metadata persist in this browser's
  `localStorage` until Reset, so a guest can return to it without an account (see §2),
  and Reset deletes the entry outright.
- **Withdrawal of consent**: Reset stops processing and erases the stored model; the
  consent notice says so explicitly (§6(4) right to withdraw).
- **Server-side data, and what it is for**: the *administrator* area has a SQLite
  database holding admin/user account records (email, argon2id password hash, role,
  session tokens). It holds no reconstruction data, no video and no keyframes. A
  registration exists only if someone deliberately signs in — using the app as a guest
  creates no account and no server-side record.
- **Children (§9)**: the Service does not target children and collects no personal
  data, so no verifiable parental consent flow is triggered.
- **Grievance redressal**: the Privacy Policy names the repository issue tracker as
  the contact channel. If the project ever processes personal data on a server, a
  Data Fiduciary contact and grievance officer must be added there.
- **Cross-border transfer**: not applicable in browser/simulated mode — nothing leaves
  the device. In worker mode the sampled keyframes go to the operator-configured worker
  (typically the same machine or local network); an operator who runs that worker
  elsewhere is responsible for the transfer basis, and the Privacy Policy §5 names the
  mode rather than claiming nothing is transmitted.

## 2. Cookies / ePrivacy-style consent

- The **reconstruction app sets no cookies**, and there are no IndexedDB databases, no
  fingerprinting, no analytics SDKs, and no third-party scripts, fonts, or iframes
  anywhere in `src/`. Verified by code audit: no `document.cookie` outside the auth
  layer, no tracking storage APIs.
- **The one exception is the administrator area**: signing in at `/droneviz3d/admin`
  sets a single httpOnly session cookie plus a double-submit CSRF token. That is the
  ePrivacy Art. 5(3) *strictly necessary* ground again — the cookie exists to hold the
  session the operator just asked for, is not used for tracking, and is deleted on
  sign-out. Nothing is set for anyone who never signs in. An ordinary visitor, and
  therefore every guest, is unaffected.
- **One localStorage entry** (`droneviz3d-model`) holds the generated 3D model (point
  cloud, per-object detections, metrics, flight metadata, file name) so a guest can
  come back to their model without an account — it must therefore outlive the tab, and
  sessionStorage would not. It contains only the user's own reconstruction, never
  leaves the device, and is deleted outright by **Reset** on the Results page (which
  the policy and the button both say). Documented in the Cookies Policy §3 and the
  Privacy Policy §6; it is first-party program state storing data the user typed in
  themselves, not tracking.
- **Conclusion: no cookie consent banner is required.** The entry exists solely to
  deliver the feature the user just asked for ("keep my reconstruction so I can return
  to it"), which is the ePrivacy Art. 5(3) "strictly necessary" ground; nothing is
  stored for a secondary purpose such as analytics. The banner is therefore not just
  unnecessary but would be misleading. The Cookies Policy states the exemption
  explicitly rather than relying on it silently, discloses the entry, and points at the
  one-click delete — and commits to a granular pre-consent banner before any storage
  that is *not* strictly necessary goes live.
- In-memory page state (the uploaded file object URL, form values) is program state,
  not device storage, and is not regulated as a "cookie".

## 3. Analytics & third-party embeds

- **Analytics**: none. No gtag/GA/Plausible/Matomo, no beacons. If any are added
  later: update Privacy Policy + Cookies Policy first, add consent gating.
- **Third-party embeds**: none. No iframes, no YouTube/Maps embeds, no external
  fonts or CDNs. The app is fully self-origin.

## 4. Advertising & claims standards

- All performance claims ("90% faster", "80% savings", "<1cm accuracy") were removed
  from the landing page because the demo cannot substantiate them. They are parked
  here to re-add **only with reproducible benchmark evidence** when the project
  reaches that milestone:
  - Claim candidates: sub-centimeter accuracy, processing speed vs. traditional
    photogrammetry, cost savings, coverage percentage.
  - Requirement before re-adding: a published methodology + dataset the numbers come
    from, phrased as measured results with conditions, not guarantees. India's
    Consumer Protection Act, 2019 (and ASCI code) treat unsubstantiated
    advertisements as misleading; the same standard is applied here voluntarily.
- Testimonials/reviews: none present; none may be fabricated (fake reviews would
  violate Consumer Protection Act, 2019 §2(28) and ASCI guidelines).
- The Results page labels its metrics as describing the *generated demo model* and
  the landing page labels its SVG as "Illustrative demo".

## 5. Drone & imagery law (user responsibility)

- **Drone Rules, 2021** (Ministry of Civil Aviation / DGCA): registration, airspace,
  and operational rules apply to the user's flight. The Terms place this duty on the
  user; DroneViz3D processes footage after capture.
- **IT Act, 2000 §66E / §43** (privacy of person, unauthorized access) and the
  DPDP Act: the Terms require users to have the legal right to process the footage
  they upload and to not process imagery of people/premises without permission.
- **Copyright**: users must own or be licensed to process their footage (Terms §3).

## 6. Accessibility

- WCAG 2.1 AA targets: skip link, semantic landmarks, labeled inputs, `role="switch"`
  toggles, `aria-pressed` buttons, `aria-current` nav, `role="progressbar"` /
  `role="meter"` where meaningful, `role="alert"` error list, keyboard-operable 3D
  viewer (arrow keys rotate, +/− zoom), `prefers-reduced-motion` respected in both
  animated demos, decorative icons hidden with `aria-hidden`, emoji given text
  alternatives, canvas given `role="img"` + descriptive `aria-label`.
- Contrast: muted text raised from `white/15–25` to `#a8a29e` (Stone-400) or higher
  on `#09090b` background (≈ 7:1 for #a8a29e; white/45+ used only for large text).
  Interactive borders raised to ≥ white/[0.12]. `#d4a053` (amber accent) on dark
  background ≈ 8:1. Status colors adjusted to `-300`/`-200` variants.
- The 3D viewer is a canvas visualization; a text summary (point count, grounded
  object list) is provided adjacent to it.

## 7. Model licensing

- LocateAnything-3B code is Apache-2.0; model weights carry NVIDIA's model license.
  Attribution and license pointers live in the footer and Terms §6. If the project
  ships a product using the weights commercially, review `LICENSE_MODEL` in NVlabs/Eagle.

## 8. Security

A full security audit is in [`SECURITY.md`](SECURITY.md). Summary: `npm audit` shows
0 vulnerabilities; production security headers (CSP, HSTS, frame/permissions policies) are
set in `next.config.js`; `grounding-worker.py` enforces bearer-token auth, per-IP rate
limiting, upload caps, and strict CORS.

There **is** a backend today, for the administrator area only: Next route handlers over
Node's built-in `node:sqlite`, with argon2id password hashing, session cookies, a
double-submit CSRF token, parameterized statements throughout, and rate limiting backed by
an atomic check-and-consume transaction. `npm audit: 0 vulnerabilities` is a
dependency-scan result and not a proof of security; the claims a reader can check are listed
in SECURITY.md with the caveats attached, including the ones that depend on deployment
(trusted-proxy configuration, body limits at ingress, shared rate-limit storage).

## 9. Open items (not blocking, but do before any public launch)

- Add a reachable contact email / grievance officer to the Privacy Policy once known.
- Worker mode (grounding-worker.py via /api/ground) is now implemented and disclosed:
  the consent checkbox, Privacy Policy §5, and the landing page state that sampled
  keyframes are sent to the operator-run inference worker while the raw video stays
  on-device. Before exposing the worker beyond loopback: add TLS + a retention
  policy and confirm the operator's security responsibilities (SECURITY.md §8).
- If the site is served to EU users, the no-cookie posture is already GDPR/ePrivacy
  friendly; re-verify if analytics are added.
- Domain/hosting privacy policy URL requirements for app-store listings, if any.
