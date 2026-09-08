/** @type {import('next').NextConfig} */

const isProd = process.env.NODE_ENV === 'production'

const nextConfig = {
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
}

module.exports = nextConfig