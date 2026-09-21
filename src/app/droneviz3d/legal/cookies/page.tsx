import { LegalPage } from '../legal-page'

export const metadata = {
  title: 'Cookies Policy — DroneViz3D',
  description: 'DroneViz3D sets no cookies and runs no trackers. This page explains why no consent banner is shown and what would change if that ever does.',
}

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookies Policy"
      intro="DroneViz3D sets no cookies and no similar tracking technologies. This page documents that fact, what the app does store in your browser (one entry, your own model, deleted on request), why you are not asked for cookie consent, and what would change if tracking were ever added."
      breadcrumb="Cookies Policy"
    >
      <section>
        <h2>1. Do we use cookies? No.</h2>
        <p>
          We do not set, read, or share any cookies — functional, analytics, advertising, or otherwise. We
          also do not use IndexedDB, service workers, or fingerprinting for tracking. The only browser
          storage we use is a single <strong>localStorage</strong> entry in this site&rsquo;s origin holding
          your generated 3D model, so you can come back to it without creating an account. It contains only
          your own reconstruction and the flight metadata it was georeferenced with, never the video file,
          and you can delete it in one click with the <strong>Reset</strong> button (&sect;3). Nothing about
          your visit is recorded by us: this site runs no analytics and sends no usage data anywhere.
        </p>
      </section>

      <section>
        <h2>2. Why there is no cookie consent banner</h2>
        <p>
          Consent banners are legally required when a site stores or accesses information on your device for
          purposes that are not strictly necessary to deliver the service you asked for (e.g. analytics or
          advertising under the EU ePrivacy regime, and tracking under India&rsquo;s DPDP Act, 2023 consent
          framework). The one entry DroneViz3D writes exists solely to keep the model you just generated
          available when you return — the feature itself, not a secondary purpose — which is the
          &ldquo;strictly necessary&rdquo; ground such rules carve out.
        </p>
        <p>
          We disclose it here anyway rather than rely on that exemption silently, and we give you a one-click
          way to delete it. If a future version ever adds a purpose that is <em>not</em> strictly necessary,
          a granular consent banner will appear <em>before</em> any such storage begins.
        </p>
      </section>

      <section>
        <h2>3. What the app stores in your browser</h2>
        <p>
          Your uploaded video and the file handle the browser gives it live in
          <strong>in-memory page state</strong> — functionally equivalent to a variable in the running
          program. They are never written to storage, never transmitted, and are gone when the tab closes.
        </p>
        <p>
          The <strong>generated 3D model</strong> — point cloud, per-object detections, the run summary, and
          the flight metadata it was georeferenced with — is written to a single
          <strong>localStorage</strong> key (<code>droneviz3d-model</code>) so a reload, a later visit, or a
          restart of your browser does not throw your model away. Anything typed into the upload form is
          part of that entry, so it survives too; the raw video never is, and only its file name is kept.
        </p>
        <p>
          That entry is not a cookie, is never sent to any server, and is readable only by this site in this
          browser. It stays on your device until you press <strong>Reset</strong> on the Results page, which
          deletes the key outright — not just the on-screen copy. Clearing site data in your browser’s
          settings removes it as well. Because the data is local to your device and holds location
          coordinates you entered yourself, treat a shared computer the way you would any downloaded file and
          press Reset when you are finished.
        </p>
      </section>

      <section>
        <h2>4. Third-party requests</h2>
        <p>
          The page loads no third-party scripts, fonts, images, iframes, or analytics. All assets are served
          from the same origin as the app. You can verify this with your browser&rsquo;s network inspector:
          after the initial page load, no requests leave your machine except to the site itself.
        </p>
      </section>

      <section>
        <h2>5. If we ever add cookies or analytics</h2>
        <p>
          Should a future version add analytics or embedded content, this policy will be updated first, the
          Privacy Policy will disclose each third party, and a consent mechanism compliant with the DPDP
          Act, 2023 (and, where applicable, the EU ePrivacy Directive / GDPR) will be shown before any
          non-essential cookie or tracker runs. Essential cookies only would still require disclosure.
        </p>
      </section>
    </LegalPage>
  )
}
