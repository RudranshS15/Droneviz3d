/**
 * owners.ts — the account(s) that own this installation.
 *
 * `OWNER_EMAILS` (comma-separated, server-only) names the addresses that:
 *
 *   - are the only accounts that may ever hold the admin role (everyone else
 *     registers as a plain user, whatever else they present);
 *   - may grant that role to somebody else, so every promotion is the owner's
 *     deliberate decision rather than any admin's;
 *   - may remove another user's access;
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
