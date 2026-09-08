import { NextRequest, NextResponse } from 'next/server'
import {
  hashPassword, validateCredentials, issueSession, isSameOrigin,
} from '@/lib/auth'
import { registerLimiter, clientIp } from '@/lib/rate-limit'
import { createUser, findUserByEmail, userCount } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 })
  }

  const limited = registerLimiter(clientIp(req))
  if (!limited.ok) {
    return NextResponse.json(
      { error: `Too many registration attempts — try again in ${limited.retryAfterSec}s` },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec), 'Cache-Control': 'no-store' } }
    )
  }

  let body: { email?: unknown; password?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''

  const invalid = validateCredentials(email, password)
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 422, headers: { 'Cache-Control': 'no-store' } })
  }

  if (findUserByEmail(email)) {
    return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
  }

  // First account on a fresh installation becomes the administrator.
  const role = userCount() === 0 ? 'admin' : 'user'
  const user = createUser(email, await hashPassword(password), role)
  await issueSession(user.id)

  return NextResponse.json(
    { user: { id: user.id, email: user.email, role: user.role } },
    { status: 201, headers: { 'Cache-Control': 'no-store' } }
  )
}