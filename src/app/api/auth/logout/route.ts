import { NextResponse } from 'next/server'
import { destroySession, validCsrf, csrfRejected } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<NextResponse> {
  // Cross-site POSTs must not be able to force-sign-out a user, so logout
  // requires the session-bound CSRF token like every other mutation.
  if (!(await validCsrf(req))) return csrfRejected()
  await destroySession()
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
