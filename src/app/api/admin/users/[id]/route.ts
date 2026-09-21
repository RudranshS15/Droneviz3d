import { NextRequest, NextResponse } from 'next/server'
import {
  getSessionUser, unauthorized, forbidden, isSameOrigin, validCsrf, csrfRejected,
} from '@/lib/auth'
import { adminApiLimiter, clientIp, rateLimitedResponse } from '@/lib/rate-limit'
import {
  deleteUserById, deleteUserSessions, findUserById, countAdmins, setUserRole,
} from '@/lib/db'
import type { SessionUser, UserRole } from '@/lib/db'
import { canChangeRoles, canRemoveUser, isOwnerEmail, readOwnerEmails } from '@/lib/owners'

function conflict(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type GuardResult = { ok: true; user: SessionUser } | { ok: false; response: NextResponse }

/** Shared gate: same-origin, rate-limited, authenticated, admin, CSRF-validated. */
async function requireAdminActor(req: NextRequest): Promise<GuardResult> {
  if (!isSameOrigin(req)) {
    return { ok: false, response: NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403, headers: { 'Cache-Control': 'no-store' } }) }
  }
  const limited = adminApiLimiter(clientIp(req))
  if (!limited.ok) return { ok: false, response: rateLimitedResponse(limited.retryAfterSec) }

  const user = await getSessionUser()
  if (!user) return { ok: false, response: unauthorized() }
  if (user.role !== 'admin') return { ok: false, response: forbidden() }
  if (!(await validCsrf(req))) return { ok: false, response: csrfRejected() }
  return { ok: true, user }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const guarded = await requireAdminActor(req)
  if (!guarded.ok) return guarded.response
  const actor = guarded.user

  const { id: rawId } = await params
  const targetId = Number.parseInt(rawId, 10)
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 422, headers: { 'Cache-Control': 'no-store' } })
  }

  const target = findUserById(targetId)
  if (!target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }

  const ownerEmails = readOwnerEmails(process.env)

  // The owner account itself is immutable for everyone — every other admin, and
  // the owner's own session — so the installation can never be orphaned.
  if (isOwnerEmail(target.email, ownerEmails)) {
    return conflict('The owner account cannot be removed')
  }
  // Without an allowlist any admin may remove a user. With one, a promoted admin
  // may remove regular users but never a peer admin; only the owner may.
  if (!canRemoveUser(actor, target, ownerEmails)) {
    return forbidden('Only the owner account can remove an administrator')
  }

  // Guards: you cannot delete your own account, and the last admin cannot be removed.
  if (target.id === actor.id) {
    return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
  }
  if (target.role === 'admin' && countAdmins() <= 1) {
    return NextResponse.json({ error: 'Cannot delete the last administrator' }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
  }

  deleteUserSessions(targetId)
  deleteUserById(targetId)

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}

/**
 * PATCH /api/admin/users/[id] — change a user's role (privilege change).
 *
 * The user's sessions are revoked afterwards: the next request with an old
 * cookie is dead, so they must sign in again and receive a *rotated* session
 * token under the new privileges. Self-changes are refused so an admin can
 * never lock themselves out (and the last admin cannot be demoted).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const guarded = await requireAdminActor(req)
  if (!guarded.ok) return guarded.response
  const actor = guarded.user

  const { id: rawId } = await params
  const targetId = Number.parseInt(rawId, 10)
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 422, headers: { 'Cache-Control': 'no-store' } })
  }

  let body: { role?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  const role = body.role
  if (role !== 'admin' && role !== 'user') {
    return NextResponse.json({ error: 'role must be "admin" or "user"' }, { status: 422, headers: { 'Cache-Control': 'no-store' } })
  }

  const target = findUserById(targetId)
  if (!target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }

  const ownerEmails = readOwnerEmails(process.env)

  // Granting privileges is the owner's decision alone once an allowlist exists.
  // This is the whole of "nobody else is an admin until I say so": the owner is
  // the only actor who can pass this check, so the only source of a new admin is
  // the owner deliberately promoting one. A promoted admin gets the dashboard,
  // but cannot change roles, remove anyone, or touch the owner.
  if (!canChangeRoles(actor, ownerEmails)) {
    return forbidden('Only the owner account can change roles')
  }
  // The owner can never be demoted, so a promoted admin cannot turn on them.
  if (isOwnerEmail(target.email, ownerEmails)) {
    return conflict('The owner account cannot be demoted or changed')
  }

  if (target.id === actor.id) {
    return NextResponse.json(
      { error: 'You cannot change your own role' },
      { status: 409, headers: { 'Cache-Control': 'no-store' } }
    )
  }
  if (target.role === 'admin' && role === 'user' && countAdmins() <= 1) {
    return NextResponse.json(
      { error: 'Cannot demote the last administrator' },
      { status: 409, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  const was = target.role
  setUserRole(target.id, role as UserRole)
  // Privilege change → revoke every existing session so a token minted under
  // the old role cannot be reused. The user signs in again → rotated cookie.
  deleteUserSessions(target.id)

  return NextResponse.json(
    { ok: true, user: { id: target.id, email: target.email, role }, roleChanged: was !== role },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
