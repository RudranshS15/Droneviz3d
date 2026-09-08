import { NextRequest, NextResponse } from 'next/server'
import {
  verifyPassword, validateCredentials, hashPassword,
  getSessionUser, getSessionToken, validCsrf,
  isSameOrigin, csrfRejected, unauthorized, rotateSession,
} from '@/lib/auth'
import {
  passwordChangeLimiter, passwordChangeLock, clientIp, rateLimitedResponse,
} from '@/lib/rate-limit'
import { findUserById, updatePassword, deleteUserSessionsExcept } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * PATCH /api/auth/password — change the signed-in user's password.
 *
 * Security posture:
 *  - Forced re-authentication: the CURRENT password must be supplied and
 *    verified before anything changes (defeats a hijacked idle session).
 *  - Brute-force protection on that re-auth: IP throttle + per-user failure
 *    lock (5 wrong current-password attempts → 15 min lock for the account).
 *  - CSRF: requires the session-bound X-CSRF-Token header.
 *  - Session hygiene on success: every OTHER session for the user is revoked
 *    and the current session cookie is rotated (fresh token) so previously
 *    captured tokens stop working.
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 })
  }

  const limited = passwordChangeLimiter(clientIp(req))
  if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec)

  const user = await getSessionUser()
  if (!user) return unauthorized()
  if (!(await validCsrf(req))) return csrfRejected()

  let body: { currentPassword?: unknown; newPassword?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''
  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { error: 'currentPassword and newPassword are required' },
      { status: 422, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  // Forced re-authentication with the same per-account lockout as login.
  const lockSec = passwordChangeLock.blocked(String(user.id))
  if (lockSec > 0) return rateLimitedResponse(lockSec)

  const stored = findUserById(user.id)
  if (!stored || !(await verifyPassword(stored.password_hash, currentPassword))) {
    passwordChangeLock.record(String(user.id))
    return NextResponse.json(
      { error: 'Current password is incorrect' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  const invalid = validateCredentials(stored.email, newPassword)
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 422, headers: { 'Cache-Control': 'no-store' } })
  }
  if (newPassword === currentPassword) {
    return NextResponse.json(
      { error: 'New password must be different from the current one' },
      { status: 422, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  const currentToken = await getSessionToken()
  updatePassword(user.id, await hashPassword(newPassword))
  // Revoke every other session, then rotate this one (fresh token + cookie).
  passwordChangeLock.clear(String(user.id))
  if (currentToken) {
    deleteUserSessionsExcept(user.id, currentToken)
    await rotateSession(user.id, currentToken)
  }

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
