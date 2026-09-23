/** @type {import('next').NextConfig} */

// Next loads this file as CommonJS, so it stays CommonJS to match. (The shared
// ESLint config forbids require(), hence the one-line exception; an ESM
// next.config.mjs cannot import next/constants — the package does not expose it
// to ESM — so the phase constants are not reachable that way.)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PHASE_DEVELOPMENT_SERVER } = require('next/constants')

const isProd = process.env.NODE_ENV === 'production'

/**
 * `next dev` and `next build` are given separate output directories so the two
 * can run at the same time.
 *
 * They originally shared `.next`, which meant a build during development deleted
 * the dev chunk files an open browser was still requesting; the page died with
 * "ChunkLoadError: Loading chunk … failed" and scripts/stylesheets refused for
 * being served as `text/plain` (Next answers a missing chunk with its not-found
 * response). Keeping the directories apart removes the conflict rather than
 * policing it, and lets the verify gate run without stopping the dev server.
 *
 *   next dev              -> .next/        (development output)
 *   next build / start    -> .next-build/  (production output)
 *
 * The phase is the reliable signal here: it is what Next passes to the config in
 * each mode, unlike NODE_ENV, which the environment can override.
 */
const distDir = (phase) => (phase === PHASE_DEVELOPMENT_SERVER ? '.next' : '.next-build')

const nextConfig = (phase) => ({
  distDir: distDir(phase),
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Apply security headers to every route.
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            // Camera/mic/geolocation are NOT used by the app; block them at the
            // browser level. (The drone's flight metadata is typed in by hand.)
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=()',
          },
          // Strict CSP only in production: dev-mode HMR needs inline scripts and
          // eval-based source maps, which the production policy forbids.
          ...(isProd
            ? [
                {
                  key: 'Content-Security-Policy',
                  value: [
                    "default-src 'self'",
                    "script-src 'self' 'unsafe-inline'",
                    "style-src 'self' 'unsafe-inline'",
                    "img-src 'self' blob: data:",
                    "media-src 'self' blob:",
                    "font-src 'self' data:",
                    // Local LocateAnything-3B worker (grounding-worker.py).
                    "connect-src 'self' http://127.0.0.1:8300 ws://127.0.0.1:8300",
                    "object-src 'none'",
                    "base-uri 'self'",
                    "frame-ancestors 'none'",
                    "form-action 'self'",
                    'upgrade-insecure-requests',
                  ].join('; '),
                },
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=63072000; includeSubDomains; preload',
                },
              ]
            : []),
        ],
      },
    ]
  },
})

module.exports = nextConfig
