import { LegalPage } from '../legal-page'

export const metadata = {
  title: 'Privacy Policy — DroneViz3D',
  description: 'How DroneViz3D handles your drone video and flight metadata. All processing happens in your browser.',
}

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="DroneViz3D is built so your drone footage never leaves your device. This policy explains exactly what data the service touches, what it never collects, and the rights you have under Indian law."
      breadcrumb="Privacy Policy"
    >
      <section>
        <h2>1. Who we are</h2>
        <p>
          DroneViz3D (&ldquo;the Service&rdquo;) is a hackathon project by Team ByteCraft for Smart India
          Hackathon 2026 (problem statement SIH26158). It converts a single drone video plus flight
          metadata into a georeferenced 3D model. For questions about this policy, contact the team
          through the repository&rsquo;s issue tracker.
        </p>
      </section>

      <section>
        <h2>2. The short version</h2>
        <ul>
          <li>Your video file is processed <strong>entirely in your browser</strong>. It is never uploaded to us or to any third party. In an optional &ldquo;worker&rdquo; deployment (see &sect;5), sampled keyframes — never the raw video — are sent to an inference worker operated by the person running the deployment.</li>
          <li>Flight metadata you type in stays in your browser&rsquo;s memory for the session and is not transmitted anywhere.</li>
          <li>We use <strong>no analytics, no advertising trackers, no social plugins, and no third-party embeds</strong>.</li>
          <li>If the operator enables the optional admin panel, your email address and a password hash (argon2id) are stored in a local database on the operator&rsquo;s machine for access control — see &sect;3.</li>
          <li>We set <strong>no cookies</strong> and read nothing from your device&rsquo;s storage beyond what the app needs to function while the tab is open.</li>
        </ul>
      </section>

      <section>
        <h2>3. Data we process, and why (data minimization)</h2>
        <p>We collect only what the feature you are using requires:</p>
        <ul>
          <li>
            <strong>Drone video file</strong> — processed locally with your consent to extract keyframes and
            generate the 3D model. It stays in your device&rsquo;s memory (a temporary in-browser URL) and is
            discarded when you close or reload the tab, or when you press &ldquo;Reset&rdquo;.
          </li>
          <li>
            <strong>Flight metadata</strong> (GPS reference point, altitude, speed, heading, camera parameters) —
            used to georeference the reconstruction. Entered by you, kept in memory, never transmitted.
          </li>
          <li>
            <strong>Consent record</strong> — a single on-device flag that remembers you consented to local
            processing this session, so the app can enforce consent before processing. It contains no
            personal data and is not sent anywhere.
          </li>
        </ul>
        <p>
          That is the complete list for the reconstruction pipeline. We do not collect names, phone
          numbers, payment details, device identifiers, IP-based profiles, or precise location beyond
          the coordinates you type in yourself for georeferencing.
        </p>
        <p>
          <strong>Optional admin backend.</strong> If the person running this deployment enables the
          admin panel (by visiting /droneviz3d/admin), the following additional data is processed
          solely for access control:
        </p>
        <ul>
          <li><strong>Email address</strong> — your login identifier, stored in the operator&rsquo;s local
          SQLite database (<code>data/droneviz3d.db</code> on their machine).</li>
          <li><strong>Password hash</strong> — argon2id-hashed; the password itself is never stored,
          logged, or readable, and hashing parameters follow the OWASP recommendations.</li>
          <li><strong>Session token</strong> — a random token in an httpOnly cookie, stored server-side
          with a 7-day expiry.</li>
        </ul>
        <p>
          Creating an account constitutes consent to this processing (DPDP Act &sect;6); you can delete
          your account by asking the administrator, which removes your email and sessions. The first
          account created on a fresh installation becomes the administrator.
        </p>
      </section>

      <section>
        <h2>4. What we never do</h2>
        <ul>
          <li>We never upload, store, or share your video or metadata on a server. In worker mode, only sampled keyframes are transmitted to the operator&rsquo;s inference worker, only during processing, and are not stored by the Service.</li>
          <li>We never sell or share personal data, because we do not collect it.</li>
          <li>We do not use cookies or similar technologies for tracking, advertising, or profiling.</li>
          <li>We do not embed third-party content (no external iframes, fonts, CDNs, or map tiles).</li>
          <li>We do not run automated decision-making or profiling about you.</li>
        </ul>
      </section>

      <section>
        <h2>5. Third-party model, locally referenced</h2>
        <p>
          The 3D reconstruction is grounded with NVIDIA&rsquo;s open-source <strong>LocateAnything-3B</strong>{' '}
          vision-language model. The model code and weights are used by the Service&rsquo;s own pipeline; no
          image data is ever sent to NVIDIA, Hugging Face, or any external API. There are two deployment
          modes:
        </p>
        <ul>
          <li>
            <strong>Browser mode (default)</strong> — a deterministic simulated adapter stands in for the
            model so the demo runs without a GPU. No frame leaves your device.
          </li>
          <li>
            <strong>Worker mode (operator-configured)</strong> — the app extracts keyframes from your video
            in the browser and sends <em>only those sampled frames</em> to an inference worker running
            NVIDIA&rsquo;s model, operated by whoever deployed the Service (typically on the same machine or
            local network). The raw video and your flight metadata never leave your device. This mode is
            disclosed in the consent checkbox before processing starts, and the operator is responsible for
            the worker&rsquo;s security and retention.
          </li>
        </ul>
      </section>

      <section>
        <h2>6. Your rights under the DPDP Act, 2023</h2>
        <p>
          Because the Service is designed for users in India, we follow the Digital Personal Data Protection
          Act, 2023 (&ldquo;DPDP Act&rdquo;). Personal data is processed only with your consent, only for the
          purpose described above, and only to the extent necessary (Section 4 &amp; 6 DPDP Act). Since we do
          not retain personal data on any server, the practical way to exercise any right is on your own
          device:
        </p>
        <ul>
          <li><strong>Withdraw consent</strong> — close the tab or press Reset; processing stops immediately.</li>
          <li><strong>Erasure</strong> — close the tab; in-memory video, metadata, and the generated model are destroyed with it.</li>
          <li><strong>Access &amp; portability</strong> — export the generated model yourself (PLY/OBJ/CSV) from the Results page.</li>
          <li><strong>Grievance redressal</strong> — contact the team via the repository issue tracker; we respond to privacy questions as a project priority.</li>
        </ul>
      </section>

      <section>
        <h2>7. Children</h2>
        <p>
          Consistent with Section 9 of the DPDP Act, the Service is not directed at children under 18 (or
          such higher age as may be prescribed), and we do not process children&rsquo;s personal data because
          we do not collect personal data at all.
        </p>
      </section>

      <section>
        <h2>8. Security</h2>
        <p>
          All reconstruction processing is local to your browser over an encrypted connection (HTTPS)
          when the site is hosted. Because video and flight data never leave your device, a server breach
          cannot expose your footage. Login credentials for the optional admin panel are protected with
          argon2id password hashing and httpOnly session cookies.
        </p>
      </section>

      <section>
        <h2>9. Changes to this policy</h2>
        <p>
          If the Service ever adds server-side processing, analytics, or third-party embeds, this policy
          will be updated <em>before</em> those features go live, and consent will be re-requested where
          the DPDP Act requires it.
        </p>
      </section>
    </LegalPage>
  )
}
