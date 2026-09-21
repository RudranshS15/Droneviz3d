/**
 * owners.ts — the account(s) that own this installation.
 *
 * `OWNER_EMAILS` (comma-separated, server-only) names the addresses that:
 *
 *   - are the only accounts that may ever hold the admin role (everyone else
 *     registers as a plain user, whatever else they present);
 *   - may grant that role to somebody else, so every promotion is the owner's
 *     deliberate decision rather than any admin's;
 *   - may remove another user's access, while somebody they do promote may
 *     remove *regular users* only (see canRemoveUser);
 *   - can never be demoted, deleted or otherwise locked out — by anyone,
 *     including each other and themselves.
 *
 * Unset, the installation keeps the earlier behaviour: the bootstrap token
 * decides who may claim the *first* admin, every admin may manage users, and the
 * last-admin guard is the only lockout protection.
 *
 * Why this is configuration rather than a hard-coded address: this repository is
 * public, and an owner address belongs in the deployment's environment, not in
 * the source tree. Configuration also lets the owner change without a code
 * change, and lets one deployment own several addresses.
 *
 * See bootstrap.ts (who may claim admin at all) and the admin routes (what an
 * owner may do to others).
 */

export const OWNER_EMAILS_ENV = 'OWNER_EMAILS'

/**
 * Parse the allowlist: comma-separated, trimmed, lower-cased and de-duplicated.
 * Anything blank is dropped, so `OWNER_EMAILS=` (a common way to "unset" a
 * variable in a config file) means "no owners configured" rather than an owner
 * whose address is the empty string.
 */
export function readOwnerEmails(env: Record<string, string | undefined>): string[] {
  const raw = env[OWNER_EMAILS_ENV]
  if (typeof raw !== 'string') return []
  const seen = new Set<string>()
  for (const part of raw.split(',')) {
    const email = part.trim().toLowerCase()
    if (email !== '') seen.add(email)
  }
  return [...seen]
}

/**
 * Case-insensitive membership test. Exact address equality only — a substring
 * or suffix test here would let `attacker.owner@example.com` or
 * `owner@example.com.evil.test` inherit the owner's powers.
 */
export function isOwnerEmail(email: string, owners: readonly string[]): boolean {
  if (owners.length === 0) return false
  return owners.includes(email.trim().toLowerCase())
}

/** Structural shape so this module needs no database import (and stays pure). */
export interface Actor {
  email: string
  role: 'user' | 'admin'
}

/**
 * May this actor change anybody's role?
 *
 * Without an allowlist, any admin may — that is the older behaviour. With one,
 * only an owner may, which is what keeps every promotion the owner's own
 * decision.
 *
 * The admin requirement is part of the predicate rather than an unstated
 * precondition: a function that answers "yes" for a logged-out browser is a trap
 * for the next caller, even when today's only caller checks the role first.
 */
export function canChangeRoles(actor: Actor, owners: readonly string[]): boolean {
  if (actor.role !== 'admin') return false
  return owners.length === 0 || isOwnerEmail(actor.email, owners)
}

/**
 * May this actor remove this user?
 *
 * Without an allowlist, any admin may (the route separately refuses self-
 * deletion and the last admin). With one:
 *
 *   - the owner may remove anybody;
 *   - a promoted admin may remove **regular users only** — the day-to-day
 *     moderation case — so they cannot purge each other, and above all cannot
 *     remove the owner;
 *   - nobody may remove an owner, including the owner themselves.
 *
 * Non-admins never pass, whatever the allowlist says.
 */
export function canRemoveUser(
  actor: Actor,
  target: Actor,
  owners: readonly string[]
): boolean {
  if (actor.role !== 'admin') return false
  if (owners.length === 0) return true
  if (isOwnerEmail(target.email, owners)) return false
  if (isOwnerEmail(actor.email, owners)) return true
  return target.role === 'user'
}
