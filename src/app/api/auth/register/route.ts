import { NextRequest, NextResponse } from 'next/server'
import {
  hashPassword, validateCredentials, issueSession, isSameOrigin,
} from '@/lib/auth'
import { registerLimiter, clientIp } from '@/lib/rate-limit'
import { DuplicateEmailError, createUserAtomic } from '@/lib/db'
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

  // Hash *before* taking the write lock. argon2id takes tens of milliseconds,
  // and holding SQLite's single write lock across it would serialize every
  // registration in the process. Previously the existence check ran, then we
  // awaited the hash, then we inserted — so two concurrent requests for the same
  // or different emails could both pass checks that the hash delay invalidated.
  const passwordHash = await hashPassword(password)

  // Who may become the administrator is decided inside the transaction, with a
  // fresh admin count, so the "first account becomes admin" rule cannot be
  // claimed by two requests at once. See bootstrap.ts and owners.ts for the rule.
  const ownerEmails = readOwnerEmails(process.env)
  try {
    const user = createUserAtomic(email, passwordHash, (hasAdmin) => {
      const decision = decideBootstrapRole(
        {
          hasAdmin,
          ownersConfigured: ownerEmails.length > 0,
          isOwner: isOwnerEmail(email, ownerEmails),
          configuredToken: readConfiguredToken(process.env),
          isProduction: process.env.NODE_ENV === 'production',
          isLocalRequest: isLocalRequest(req),
        },
        bootstrapToken
      )
      if (decision.action === 'refuse') {
        // Worth a server-side line: an operator hitting this is usually one env
        // var away from a working installation.
        console.warn(`[auth] refused registration for ${email}: administrator setup required`)
        throw new RefusedRegistration(decision.status, decision.error)
      }
      return decision.action === 'grant-admin' ? 'admin' : 'user'
    })
    await issueSession(user.id)
    return NextResponse.json(
      { user: { id: user.id, email: user.email, role: user.role } },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    // A refused claim leaves no trace: no account was written and no session was
    // minted, because the throw rolled the transaction back.
    if (err instanceof RefusedRegistration) {
      return NextResponse.json({ error: err.message }, { status: err.status, headers: { 'Cache-Control': 'no-store' } })
    }
    // Unique-email violation, including one that only appears across processes.
    if (err instanceof DuplicateEmailError) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
    }
    throw err
  }
}

/** Raised inside the registration transaction to abort it with a response. */
class RefusedRegistration extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'RefusedRegistration'
  }
}
