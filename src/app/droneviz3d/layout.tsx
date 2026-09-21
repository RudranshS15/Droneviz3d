'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useDroneVizStore } from './store'

const navItems = [
  { href: '/droneviz3d', label: 'Home', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { href: '/droneviz3d/upload', label: 'Upload', icon: 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12' },
  { href: '/droneviz3d/processing', label: 'Process', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
  { href: '/droneviz3d/viewer', label: '3D Viewer', icon: 'M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5' },
  { href: '/droneviz3d/results', label: 'Results', icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { href: '/droneviz3d/admin', label: 'Admin', icon: 'M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z' },
]

const legalLinks = [
  { href: '/droneviz3d/legal/privacy', label: 'Privacy Policy' },
  { href: '/droneviz3d/legal/terms', label: 'Terms & Conditions' },
  { href: '/droneviz3d/legal/cookies', label: 'Cookies Policy' },
]

export default function DroneViz3DLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { isProcessing, processingComplete } = useDroneVizStore()

  // Stored-model rehydration can settle after the first render, so kick it here
  // (once, for the whole section) and mark it finished either way. Page guards
  // wait on `hydrated` before concluding that no model exists: without this a
  // hard load of a viewer or results URL bounces the user to Upload even though
  // their finished model is still in this browser's localStorage.
  useEffect(() => {
    const store = useDroneVizStore
    if (store.getState().hydrated) return
    Promise.resolve(store.persist.rehydrate())
      .catch(() => undefined)
      .then(() => store.getState().markHydrated())
  }, [])

  return (
    <div className="min-h-screen bg-[#09090b] text-white font-sans selection:bg-cyan-500/30">
      {/* Skip link — first focusable element on every page */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-cyan-600 focus:text-white focus:font-semibold"
      >
        Skip to main content
      </a>

      {/* Subtle gradient bg */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-cyan-500/[0.04] rounded-full blur-[120px]" />
        <div className="absolute -bottom-40 -left-40 w-[600px] h-[600px] bg-blue-500/[0.03] rounded-full blur-[120px]" />
      </div>

      {/* Nav */}
      <nav aria-label="Main navigation" className="fixed top-0 left-0 right-0 z-50 bg-[#09090b]/70 backdrop-blur-2xl border-b border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <Link href="/droneviz3d" className="flex items-center gap-2.5 group" aria-label="DroneViz3D home">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-[11px] font-black tracking-tight shadow-lg shadow-cyan-500/20" aria-hidden="true">
                DV
              </div>
              <span className="text-[15px] font-bold tracking-tight text-white/90 group-hover:text-white transition-colors">
                DroneViz3D
              </span>
            </Link>

            {/* Desktop nav */}
            <div className="hidden md:flex items-center gap-0.5">
              {navItems.map((item) => {
                const isActive = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-200 ${
                      isActive
                        ? 'bg-white/[0.08] text-white'
                        : 'text-[#a8a29e] hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                    </svg>
                    {item.label}
                  </Link>
                )
              })}
            </div>

            {/* Status pill */}
            <div className="hidden md:flex items-center gap-3" role="status" aria-live="polite">
              {isProcessing && (
                <span className="flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-300 text-[11px] font-medium border border-cyan-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" aria-hidden="true" />
                  Processing
                </span>
              )}
              {processingComplete && !isProcessing && (
                <span className="flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 text-green-300 text-[11px] font-medium border border-green-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" aria-hidden="true" />
                  Ready
                </span>
              )}
              <span className="px-2.5 py-1 rounded-md bg-white/[0.06] text-[#a8a29e] text-[11px] font-mono">
                SIH 2026
              </span>
            </div>

            {/* Mobile toggle */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-menu"
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              className="md:hidden p-2 text-[#a8a29e] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 rounded-lg"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
                {mobileMenuOpen
                  ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  : <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div id="mobile-menu" className="md:hidden border-t border-white/[0.06] bg-[#09090b]/95 backdrop-blur-2xl">
            <div className="px-4 py-3 space-y-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  aria-current={pathname === item.href ? 'page' : undefined}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                    pathname === item.href ? 'bg-white/[0.08] text-white' : 'text-[#a8a29e]'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </nav>

      <main id="main-content" className="relative z-10 pt-14">{children}</main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.04] mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2 text-[#a8a29e] text-[12px]">
              <div className="w-5 h-5 rounded bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-[8px] font-black text-white" aria-hidden="true">DV</div>
              <span>DroneViz3D — Team ByteCraft — SIH26158</span>
            </div>
            <span className="text-[12px] text-[#a8a29e]">
              Single-Pass Drone Video to 3D Model Generation
            </span>
          </div>
          <nav aria-label="Legal" className="mt-6 flex flex-wrap items-center justify-center sm:justify-start gap-x-5 gap-y-2 text-[12px]">
            {legalLinks.map((l) => (
              <Link key={l.href} href={l.href} className="text-[#a8a29e] underline-offset-2 hover:text-[#d4a053] hover:underline transition-colors">
                {l.label}
              </Link>
            ))}
          </nav>
          <p className="mt-4 text-[11px] text-[#a8a29e]/80 max-w-3xl">
            DroneViz3D is a hackathon prototype. Outputs are demonstration reconstructions, not survey-grade
            measurements. Grounding uses NVIDIA&rsquo;s open-source LocateAnything-3B; see the Third-party
            components section in the Terms.
          </p>
        </div>
      </footer>
    </div>
  )
}
