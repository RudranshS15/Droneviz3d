import { LegalPage } from '../legal-page'

export const metadata = {
  title: 'Terms & Conditions — DroneViz3D',
  description: 'The terms governing your use of DroneViz3D, including acceptable use and drone-law responsibilities.',
}

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms & Conditions"
      intro="These terms govern your use of DroneViz3D. By using the Service you agree to them."
      breadcrumb="Terms & Conditions"
    >
      <section>
        <h2>1. Agreement</h2>
        <p>
          These Terms & Conditions (&ldquo;Terms&rdquo;) are an agreement between you and Team ByteCraft
          (&ldquo;we&rdquo;, &ldquo;us&rdquo;) covering the DroneViz3D web application. If you do not agree,
          do not use the Service.
        </p>
      </section>

      <section>
        <h2>2. What the Service is — and is not</h2>
        <ul>
          <li>
            DroneViz3D generates a <strong>demonstration 3D model</strong> from your drone video and the flight
            metadata you provide, using NVIDIA LocateAnything-3B–based semantic grounding. It is a hackathon
            prototype, not certified photogrammetry software.
          </li>
          <li>
            Outputs are <strong>not survey-grade measurements</strong> and must not be used for construction,
            land titling, legal boundaries, safety-of-flight decisions, or any purpose where inaccurate
            geometry could cause harm.
          </li>
          <li>
            Fine surface detail between detected objects is synthesized by the pipeline and is labeled as
            such in the interface.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. Your content, your responsibility</h2>
        <p>
          Your video and metadata stay on your device; we never receive them. You retain all rights to your
          footage. You confirm that:
        </p>
        <ul>
          <li>you own the footage or have permission to process it;</li>
          <li>you complied with all laws applicable to the flight that captured it (see Section 4);</li>
          <li>you will not upload content depicting private individuals or premises where processing would violate their privacy or any law.</li>
        </ul>
      </section>

      <section>
        <h2>4. Drone-law compliance is your responsibility</h2>
        <p>
          In India, drone operation is regulated under the Drone Rules, 2021 administered by the Ministry of
          Civil Aviation (DGCA). Depending on your use you may need registration, an air-space permit, or
          type certification, and there are restrictions on flying over private property, restricted zones,
          and on capturing imagery of people and premises. <strong>We do not operate drones and cannot
          authorize your flight</strong>; you are solely responsible for lawful operation and lawful
          capture of any footage you process.
        </p>
      </section>

      <section>
        <h2>5. Acceptable use</h2>
        <ul>
          <li>Do not use the Service to process imagery you are not legally allowed to possess or process.</li>
          <li>Do not attempt to identify, track, or profile individuals through the Service.</li>
          <li>Do not misrepresent Service output as certified survey, engineering, or legal evidence.</li>
          <li>Do not reverse-engineer the Service to remove attribution to NVIDIA LocateAnything-3B or violate its model license.</li>
        </ul>
      </section>

      <section>
        <h2>6. Third-party components</h2>
        <p>
          The Service uses NVIDIA&rsquo;s LocateAnything-3B under its own model license and other open-source
          components under their respective licenses (see the repository&rsquo;s <code>NOTICE</code> and{' '}
          <code>LICENSE</code> files). Those licenses govern their use; these Terms govern the Service as a whole.
        </p>
      </section>

      <section>
        <h2>7. No warranty</h2>
        <p>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any
          kind, express or implied, including merchantability, fitness for a particular purpose, and
          non-infringement. We do not warrant that outputs are accurate, complete, or fit for any specific use.
        </p>
      </section>

      <section>
        <h2>8. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, we are not liable for any indirect, incidental, special,
          consequential, or punitive damages, or for any loss of data, profits, or opportunity, arising from
          your use of (or inability to use) the Service or reliance on its outputs.
        </p>
      </section>

      <section>
        <h2>9. Governing law</h2>
        <p>
          These Terms are governed by the laws of India. Disputes are subject to the jurisdiction of the
          courts at New Delhi, unless mandatory local law gives you a different forum.
        </p>
      </section>

      <section>
        <h2>10. Changes</h2>
        <p>
          We may update these Terms as the project evolves. Material changes will be posted on this page with
          a new &ldquo;last updated&rdquo; date. Continued use after changes take effect constitutes acceptance.
        </p>
      </section>
    </LegalPage>
  )
}
