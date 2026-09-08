import { NextRequest, NextResponse } from 'next/server'
import {
  verifyPassword, issueSession, isSameOrigin,
} from '@/lib/auth'
import {
  loginLimiter, loginEmailLock, clientIp, rateLimitedResponse,
} from '@/lib/rate-limit'
import { findUserByEmail } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 })
  }

  // Per-IP throttle (raw request volume).
  const limited = loginLimiter(clientIp(req))
  if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec)

  let body: { email?: unknown; password?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 422, headers: { 'Cache-Control': 'no-store' } })
  }

  // Account-level lock: 5 failed passwords on THIS email lock the account for
  // 15 minutes regardless of the source IP, so rotating IPs can't keep
  // guessing. Only failures count (recorded below); a successful login clears.
  const lockSec = loginEmailLock.blocked(email)
  if (lockSec > 0) {
    return rateLimitedResponse(lockSec)
  }

  // Generic message on both failure modes so attackers cannot enumerate accounts.
  const user = findUserByEmail(email)
  if (!user || !(await verifyPassword(user.password_hash, password))) {
    if (user) loginEmailLock.record(email)
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }

  // Legit sign-in: forget this account's past failures.
  loginEmailLock.clear(email)

  await issueSession(user.id)
  return NextResponse.json(
    { user: { id: user.id, email: user.email, role: user.role } },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
