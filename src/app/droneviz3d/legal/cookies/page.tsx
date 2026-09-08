import { LegalPage } from '../legal-page'

export const metadata = {
  title: 'Cookies Policy — DroneViz3D',
  description: 'DroneViz3D sets no cookies and runs no trackers. This page explains why no consent banner is shown and what would change if that ever does.',
}

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookies Policy"
      intro="DroneViz3D sets no cookies and no similar tracking technologies. This page documents that fact, why you are not asked for cookie consent, and what would change if tracking were ever added."
      breadcrumb="Cookies Policy"
    >
      <section>
        <h2>1. Do we use cookies? No.</h2>
        <p>
          We do not set, read, or share any cookies — functional, analytics, advertising, or otherwise. We
          also do not use localStorage, IndexedDB, service workers, or fingerprinting for tracking. The only
          browser storage we use is a single <strong>sessionStorage</strong> entry holding your generated 3D
          model so it survives a page reload within the same tab; it is scoped to that tab, contains only
          your own reconstruction, and is automatically deleted when the tab closes (&sect;3). Nothing about
          your visit is recorded by us, because the Service has no backend that receives it.
        </p>
      </section>

      <section>
        <h2>2. Why there is no cookie consent banner</h2>
        <p>
          Consent banners are legally required when a site stores or accesses information on your device for
          non-essential purposes (e.g. analytics or advertising under the EU ePrivacy regime, and tracking
          under India&rsquo;s DPDP Act, 2023 consent framework). Since DroneViz3D sets nothing and reads
          nothing from your device, there is nothing to consent to — so adding a banner would be misleading.
          If that ever changes, a granular consent banner will appear <em>before</em> any non-essential
          storage begins.
        </p>
      </section>

      <section>
        <h2>3. What the app stores in your browser (session only)</h2>
        <p>
          While the tab is open, the app keeps your uploaded video and the metadata you typed in
          <strong>in-memory page state</strong> — functionally equivalent to a variable in the running
          program: never written to disk, never transmitted, and gone when the tab closes.
        </p>
        <p>
          The <strong>generated 3D model</strong> (point cloud, metrics, and the flight metadata used) is
          additionally written to a single <strong>sessionStorage</strong> key so it survives a page reload
          within the same tab. sessionStorage is tab-scoped, contains only your own reconstruction data, is
          not sent to any server, and is cleared automatically by the browser when the tab closes. The raw
          video is never stored in sessionStorage (only its file name). This is session-scoped program state,
          not tracking, and is not covered by cookie rules.
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
