import { NextResponse } from 'next/server'
import { getSessionUser, getSessionToken, unauthorized } from '@/lib/auth'
import { findSessionCsrf } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  const user = await getSessionUser()
  if (!user) return unauthorized()

  // The session-bound CSRF token the admin UI must echo back in mutating
  // requests. Per-session (rotates on re-login / password change).
  const token = await getSessionToken()
  const csrf = token ? (findSessionCsrf(token) ?? null) : null

  return NextResponse.json({ user, csrf }, { headers: { 'Cache-Control': 'no-store' } })
}
