/**
 * bootstrap.ts — who is allowed to claim the first administrator account.
 *
 * The race this closes: "the first account to register becomes the admin" is
 * harmless on a developer's own machine and dangerous on a deployed instance,
 * because the winner is simply whoever's request arrives first — and against a
 * public URL that is often a scanner, not the person who deployed the app.
 *
 * The rule instead:
 *
 *   - When OWNER_EMAILS is configured (see owners.ts), only those addresses may
 *     hold the admin role at all; every other registration is a plain user.
 *   - With no allowlist configured, an installation that already has an
 *     administrator never grants another one through registration — every new
 *     account is a plain user.
 *   - On an installation with no administrator, claiming the admin role
 *     requires ADMIN_BOOTSTRAP_TOKEN (`openssl rand -hex 32`) to be sent with
 *     the registration and to match. Comparing digests keeps it constant-time.
 *   - No administrator, no configured token, and a request that did not come
 *     from the developer's own machine → registration is *refused*, not quietly
 *     downgraded to a plain user. That distinction matters: creating a plain
 *     user would consume the first-account slot and lock the real owner out of
 *     the token path for good.
 *   - No administrator, no configured token, local development → the
 *     first-run convenience is kept, since that is the machine of whoever is
 *     running the app.
 *
 * The decision is a pure function of the environment plus two booleans, so the
 * whole table can be tested without starting a server.
 */

import { createHash, timingSafeEqual } from 'node:crypto'

export const BOOTSTRAP_TOKEN_ENV = 'ADMIN_BOOTSTRAP_TOKEN'

export interface BootstrapContext {
  /** whether any account already holds the admin role */
  hasAdmin: boolean
  /** OWNER_EMAILS is configured, so the admin role is restricted to owners */
  ownersConfigured: boolean
  /** the address being registered is one of those owners */
  isOwner: boolean
  /** the configured ADMIN_BOOTSTRAP_TOKEN, or null when unset/blank */
  configuredToken: string | null
  /** NODE_ENV === 'production' */
  isProduction: boolean
  /** a direct request to the developer's own machine (see isLocalRequest) */
  isLocalRequest: boolean
}

export type BootstrapDecision =
  /** create this account as the administrator */
  | { action: 'grant-admin' }
  /** create this account as an ordinary user */
  | { action: 'create-user' }
  /** create nothing — the caller returns `status` with `error` */
  | { action: 'refuse'; status: number; error: string }

/**
 * Wrong or missing token. Deliberately identical whether the token was absent
 * or merely wrong, so this cannot be used to probe for a configured token.
 */
const TOKEN_REQUIRED =
  'This registration requires the bootstrap token — check ADMIN_BOOTSTRAP_TOKEN and try again.'

/**
 * No token configured, so no admin can be granted here. Worded for the operator
 * who is the legitimate reader of this message; it reveals no more than the 403
 * already does. Note this is reachable both when no admin exists yet and when a
 * configured owner is trying to claim the role on a deployment that has one.
 */
const SETUP_REQUIRED =
  'No bootstrap token is configured, so administrator registration is disabled. ' +
  'Set ADMIN_BOOTSTRAP_TOKEN on the server, then register with it.'

/**
 * Blank and whitespace-only both count as "not configured". Typed as a plain
 * string map rather than `NodeJS.ProcessEnv` so callers (and tests) can pass
 * just the variables they mean without satisfying Node's whole env shape.
 */
export function readConfiguredToken(env: Record<string, string | undefined>): string | null {
  const raw = env[BOOTSTRAP_TOKEN_ENV]
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Constant-time token comparison. Both sides are hashed first so the buffers
 * are always the same length — timingSafeEqual throws on a length mismatch, and
 * comparing raw values would leak the token's length through timing.
 */
export function tokensMatch(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided, 'utf8').digest()
  const b = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(a, b)
}

export function decideBootstrapRole(
  ctx: BootstrapContext,
  providedToken: string
): BootstrapDecision {
  // The owner gate. With an allowlist configured, an address that is not on it
  // can never hold admin — no token, no origin and no cleverness changes that.
  // Letting such an address register as a plain user is harmless, because the
  // owner's own claim is gated by their address rather than by arriving first.
  const mayHoldAdmin = ctx.ownersConfigured ? ctx.isOwner : true
  if (!mayHoldAdmin) return { action: 'create-user' }

  // Without an allowlist there is exactly one admin to give away, and the
  // bootstrap token exists to gate that single claim. With an allowlist, every
  // configured owner address may hold the role.
  if (!ctx.ownersConfigured && ctx.hasAdmin) return { action: 'create-user' }

  if (ctx.configuredToken) {
    return tokensMatch(providedToken, ctx.configuredToken)
      ? { action: 'grant-admin' }
      : { action: 'refuse', status: 403, error: TOKEN_REQUIRED }
  }

  // Unconfigured token: the local first-run convenience, and nothing else. A
  // deployed instance still refuses, so a configured owner address is not by
  // itself enough to claim admin in production.
  if (!ctx.isProduction && ctx.isLocalRequest) return { action: 'grant-admin' }

  return { action: 'refuse', status: 403, error: SETUP_REQUIRED }
}

/**
 * Loopback addresses in every form headers actually carry them: IPv4, IPv6,
 * and the IPv4-mapped `::ffff:127.0.0.1` a dual-stack socket reports.
 */
export function isLoopbackAddress(value: string): boolean {
  const raw = value.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (raw === '') return false
  if (raw === 'localhost' || raw === '::1' || raw === '0:0:0:0:0:0:0:1') return true
  // An IPv4 peer on a dual-stack socket arrives as `::ffff:a.b.c.d`.
  const v4 = raw.startsWith('::ffff:') ? raw.slice('::ffff:'.length) : raw
  const octets = v4.split('.')
  if (octets.length !== 4) return false
  if (!octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255)) return false
  return octets[0] === '127'
}

/** Host header (`host:port` or `[v6]:port`) with its port stripped. */
function hostnameOf(value: string): string {
  const raw = value.trim()
  // `[::1]:3000` and `[::1]` carry the address in brackets; `host:port` does
  // not. Handle the bracketed form first so the port split can't mangle it.
  return raw.startsWith('[') ? raw.slice(1, raw.indexOf(']')) : raw.split(':')[0]
}

/**
 * Is this request plausibly from the developer's own machine?
 *
 * Worth knowing before reading the code: Next.js *itself* sets
 * `x-forwarded-for` / `x-forwarded-host` / `x-forwarded-proto` on every
 * incoming request — a plain `curl` to localhost arrives with
 * `x-forwarded-for: ::ffff:127.0.0.1`. So the mere presence of a forwarding
 * header proves nothing; only the values do. Both the client address and the
 * Host must be loopback, so a same-host proxy serving a public Host is
 * rejected too, and skewing to false is the safe direction throughout.
 *
 * This gates a *development* convenience only — the production path never
 * consults it (see decideBootstrapRole).
 */
export function isLocalRequest(req: Request): boolean {
  const headers = req.headers

  // The first entry is the originating client; later entries are proxies.
  const forwardedFor = headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
  const client = forwardedFor !== '' ? forwardedFor : headers.get('x-real-ip')?.trim() ?? ''
  if (client !== '' && !isLoopbackAddress(client)) return false

  const forwardedHost = headers.get('x-forwarded-host')?.split(',')[0]?.trim() ?? ''
  const host = forwardedHost !== '' ? forwardedHost : headers.get('host') ?? ''
  if (host === '') return false

  return isLoopbackAddress(hostnameOf(host))
}
