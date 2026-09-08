# Compliance Notes

Last reviewed: September 7, 2026 (India-focused deployment)

## 1. Data protection — DPDP Act, 2023

- **Consent before processing**: the upload form requires an explicit, purpose-limited
  consent checkbox (`data-consent`) before any reconstruction starts. The consent
  purpose ("process this video + metadata on your device only, to generate the 3D
  model") is stated in plain language next to the checkbox, per §6(1) and the
  notice requirements of §5(1) DPDP Act.
- **Purpose limitation & data minimization**: only the video, the flight metadata the
  user types, and a session consent flag are processed. Nothing else is collected.
  The consent notice lists exactly what is processed and why.
- **Storage limitation**: all data lives in in-memory page state and is destroyed on
  tab close or Reset. No server, database, or persistent storage is involved.
- **Withdrawal of consent**: closing the tab or pressing Reset stops processing; the
  consent notice says so explicitly (§6(4) right to withdraw).
- **Children (§9)**: the Service does not target children and collects no personal
  data, so no verifiable parental consent flow is triggered.
- **Grievance redressal**: the Privacy Policy names the repository issue tracker as
  the contact channel. If the project ever processes personal data on a server, a
  Data Fiduciary contact and grievance officer must be added there.
- **Cross-border transfer**: not applicable — no data leaves the device.

## 2. Cookies / ePrivacy-style consent

- The app sets **zero cookies** and no localStorage/IndexedDB, no fingerprinting,
  no analytics SDKs, and no third-party scripts, fonts, or iframes anywhere in `src/`.
  Verified by code audit: no `document.cookie`, no tracking storage APIs.
- **One sessionStorage entry** holds the generated 3D model (point cloud, metrics,
  flight metadata, file name) so it survives a page reload within the same tab. It is
  tab-scoped, contains only the user's own reconstruction, never leaves the device,
  and is cleared by the browser when the tab closes. Documented in the Cookies Policy
  §3; it is session-scoped program state, not tracking.
- **Conclusion: no cookie consent banner is required** — there is nothing to consent
  to. Adding a banner for a site with no cookies would be misleading (and is itself
  an anti-pattern under consent-fatigue guidance). The Cookies Policy documents this
  decision and commits to a granular pre-consent banner if tracking is ever added.
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
0 vulnerabilities (Next 14→15, React 18→19, PostCSS override); production security
headers (CSP, HSTS, frame/permissions policies) are set in `next.config.js`;
`grounding-worker.py` enforces bearer-token auth, per-IP rate limiting, upload caps,
and strict CORS. The app has no backend/database/user accounts today, so auth,
password hashing, and SQL injection protections are documented as a checklist for
when a server is added — they are not silently claimed as done.

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
