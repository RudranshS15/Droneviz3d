import { NextRequest, NextResponse } from 'next/server'
import {
  hashPassword, validateCredentials, issueSession, isSameOrigin,
} from '@/lib/auth'
import { registerLimiter, clientIp } from '@/lib/rate-limit'
import { createUser, findUserByEmail, countAdmins } from '@/lib/db'
import {
  decideBootstrapRole, isLocalRequest, readConfiguredToken,
} from '@/lib/bootstrap'
import { isOwnerEmail, readOwnerEmails } from '@/lib/owners'

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

  let body: { email?: unknown; password?: unknown; bootstrapToken?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = typeof body.password === 'string' ? body.password : ''
  const bootstrapToken = typeof body.bootstrapToken === 'string' ? body.bootstrapToken.trim() : ''

  const invalid = validateCredentials(email, password)
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 422, headers: { 'Cache-Control': 'no-store' } })
  }

  if (findUserByEmail(email)) {
    return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
  }

  // Who may become the administrator is decided before anything is written, so
  // a refused claim leaves no trace: no account, no session, no consumed slot.
  // See bootstrap.ts and owners.ts for the full rule.
  const ownerEmails = readOwnerEmails(process.env)
  const decision = decideBootstrapRole(
    {
      hasAdmin: countAdmins() > 0,
      ownersConfigured: ownerEmails.length > 0,
      isOwner: isOwnerEmail(email, ownerEmails),
      configuredToken: readConfiguredToken(process.env),
      isProduction: process.env.NODE_ENV === 'production',
      isLocalRequest: isLocalRequest(req),
    },
    bootstrapToken
  )

  if (decision.action === 'refuse') {
    // Worth a server-side line: an operator hitting this is usually one env var
    // away from a working installation.
    console.warn(`[auth] refused registration for ${email}: administrator setup required`)
    return NextResponse.json(
      { error: decision.error },
      { status: decision.status, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  const role = decision.action === 'grant-admin' ? 'admin' : 'user'
  const user = createUser(email, await hashPassword(password), role)
  await issueSession(user.id)

  return NextResponse.json(
    { user: { id: user.id, email: user.email, role: user.role } },
    { status: 201, headers: { 'Cache-Control': 'no-store' } }
  )
}
