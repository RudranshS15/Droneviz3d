'use client'

import Link from 'next/link'
import { ReactNode } from 'react'

export const LEGAL_LAST_UPDATED = 'September 7, 2026'

export function LegalPage({
  title,
  intro,
  children,
  breadcrumb,
}: {
  title: string
  intro: string
  breadcrumb: string
  children: ReactNode
}) {
  return (
    <div className="min-h-[calc(100vh-3.5rem)]">
      <div className="max-w-3xl mx-auto w-full px-4 sm:px-6 pt-10 pb-24">
        <nav aria-label="Breadcrumb" className="flex items-center gap-3 text-[12px] text-[#a8a29e] mb-6">
          <Link href="/droneviz3d" className="hover:text-[#d4a053] transition-colors">Home</Link>
          <span aria-hidden="true">/</span>
          <span className="text-[#e7e5e4]">{breadcrumb}</span>
        </nav>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#e7e5e4] mb-3">{title}</h1>
        <p className="text-[14px] text-[#a8a29e] mb-4">{intro}</p>
        <p className="text-[12px] text-[#a8a29e] mb-10">Last updated: {LEGAL_LAST_UPDATED}</p>
        <div className="space-y-8 text-[14px] leading-relaxed text-[#a8a29e] [&_h2]:text-[18px] [&_h2]:font-semibold [&_h2]:text-[#e7e5e4] [&_h2]:mb-3 [&_h2]:pt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2 [&_li]:pl-1 [&_a]:text-[#d4a053] [&_a]:underline [&_a:hover]:text-[#e7e5e4] [&_strong]:text-[#e7e5e4] [&_code]:font-mono [&_code]:text-[13px] [&_code]:bg-[#1c1917] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded">
          {children}
        </div>
      </div>
    </div>
  )
}
