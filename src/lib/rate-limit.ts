/**
 * rate-limit.ts — rate limiting backed by the shared SQLite store.
 *
 * Unlike an in-memory limiter, counters live in the same data/droneviz3d.db
 * file every server process uses, so the limits hold across multiple Next.js
 * instances on one host (or instances sharing a volume). For deployments that
 * don't share a disk, swap the store calls (addRateEvent / countRateEvents …)
 * for Redis behind the same shape — see SECURITY.md §Rate limiting.
 *
 * Two primitives:
 *  - createRateLimiter: sliding window that *consumes* a slot on every call
 *    (throttles raw request volume — used for IP-based budgets).
 *  - createFailureLock: nothing counts unless record() is called explicitly
 *    (lets us lock a *specific email or user* after repeated bad passwords,
 *    independent of where the attempts come from).
 */

import { NextResponse } from 'next/server'
import {
  addRateEvent, clearRateEvents, consumeRateEvent, countRateEvents,
  oldestRateEvent, pruneRateEvents, sweepRateEvents,
} from './db'

export interface RateLimitResult {
  ok: boolean
  /** seconds to wait before retrying (0 when ok) */
  retryAfterSec: number
}

const SWEEP_INTERVAL_MS = 60_000
const SWEEP_HORIZON_MS = 60 * 60 * 1000 // no window is longer than 15 min; 1h is ample
let lastSweep = 0

/** Per-process throttle so we don't scan the whole table on every request. */
function maybeSweep(): void {
  const now = Date.now()
  if (now - lastSweep < SWEEP_INTERVAL_MS) return
  lastSweep = now
  try {
    sweepRateEvents(now - SWEEP_HORIZON_MS)
  } catch {
    /* storage momentarily busy — next sweep will retry */
  }
}

/**
 * Sliding-window limiter: each call consumes one slot within the window.
 * `namespace` prefixes every key so distinct limiters (login vs ground vs
 * admin…) never share counters even when their raw keys are identical
 * (e.g. both keyed by the same client IP string).
 */
export function createRateLimiter(
  limit: number, windowMs: number, namespace: string
): (key: string) => RateLimitResult {
  return (rawKey: string): RateLimitResult => {
    const key = `${namespace}:${rawKey}`
    maybeSweep()
    const now = Date.now()
    // One atomic transaction: count and consume together, so N processes
    // admitting the same key cannot each see `limit - 1` and let (N-1) extra
    // requests through.
    const { allowed, oldest } = consumeRateEvent(key, now, windowMs, limit)
    if (allowed) return { ok: true, retryAfterSec: 0 }
    const since = oldest ?? now
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((since + windowMs - now) / 1000)) }
  }
}

export interface FailureLock {
  /** Seconds until the oldest failure ages out of the window; 0 when not blocked. */
  blocked(key: string): number
  /** Record one failure (only these count toward the lock). */
  record(key: string): void
  /** Forget all failures for a key (call on successful auth). */
  clear(key: string): void
}

export function createFailureLock(limit: number, windowMs: number, namespace: string): FailureLock {
  const scope = (rawKey: string) => `${namespace}:${rawKey}`
  return {
    blocked(rawKey: string): number {
      const key = scope(rawKey)
      maybeSweep()
      const now = Date.now()
      const cutoff = now - windowMs
      pruneRateEvents(key, cutoff)
      if (countRateEvents(key, cutoff) < limit) return 0
      const oldest = oldestRateEvent(key, cutoff) ?? now
      return Math.max(1, Math.ceil((oldest + windowMs - now) / 1000))
    },
    record(rawKey: string): void {
      addRateEvent(scope(rawKey), Date.now())
    },
    clear(rawKey: string): void {
      clearRateEvents(scope(rawKey))
    },
  }
}

/**
 * Trusted-proxy policy for identifying a client.
 *
 * Set `TRUST_PROXY=0` when nothing in front of this app appends to
 * `X-Forwarded-For`. Every caller then shares one `'unknown'` bucket, which is
 * stricter than per-IP (a shared budget cannot be evaded), and it is the honest
 * answer when the header is attacker-controlled.
 *
 * The default trusts exactly one hop. That is why it reads the *last* entry
 * rather than the first: our own server/proxy appends the address it actually
 * saw, so the rightmost value is the trustworthy one, while everything to its
 * left can be supplied by the client. The previous implementation used the first
 * entry, so a caller could send `X-Forwarded-For: <random>` and get a fresh rate
 * limit on every request.
 *
 * A deployment behind a CDN must ensure ingress *replaces* the header; see
 * SECURITY.md.
 */
/**
 * Typed as a plain string map rather than `NodeJS.ProcessEnv` so callers (and
 * tests) can pass only the variables they mean without satisfying Node's whole
 * env shape.
 */
export function trustProxyEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = (env.TRUST_PROXY ?? '').trim().toLowerCase()
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false
  return true
}

/**
 * Resolve a client identity from request headers. Pure, so the policy is
 * testable without a running server.
 */
export function chooseClientIp(
  forwardedFor: string | null,
  realIp: string | null,
  trustProxy: boolean
): string {
  if (!trustProxy) return 'unknown'
  if (forwardedFor) {
    const parts = forwardedFor.split(',').map((p) => p.trim()).filter(Boolean)
    const last = parts[parts.length - 1]
    if (last) return last
  }
  if (realIp) return realIp
  return 'unknown'
}

/** Client IP for rate-limit keys, under the policy above. */
export function clientIp(req: Request): string {
  return chooseClientIp(
    req.headers.get('x-forwarded-for'),
    req.headers.get('x-real-ip'),
    trustProxyEnabled()
  )
}

/** Standard 429 body + Retry-After used by every route. */
export function rateLimitedResponse(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: `Too many requests — try again in ${retryAfterSec}s` },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec), 'Cache-Control': 'no-store' } }
  )
}

// Shared budgets — every route uses these so limits are consistent globally.
// Namespaces are mandatory: they keep counters from different limiters apart
// even when both key on the same client-IP string.
export const loginLimiter = createRateLimiter(10, 15 * 60 * 1000, 'login-ip') // login attempts / 15 min / IP
export const registerLimiter = createRateLimiter(5, 15 * 60 * 1000, 'register-ip') // registrations / 15 min / IP
export const passwordChangeLimiter = createRateLimiter(5, 15 * 60 * 1000, 'pw-change-ip') // password tries / 15 min / IP
export const adminApiLimiter = createRateLimiter(120, 60 * 1000, 'admin-api') // admin API calls / min / IP
export const groundLimiter = createRateLimiter(60, 10 * 60 * 1000, 'ground') // grounding POSTs / 10 min / IP

// Account-level locks: repeated *failures* on one identity block that identity,
// no matter how many IPs the attacker rotates through.
export const loginEmailLock = createFailureLock(5, 15 * 60 * 1000, 'login-email') // 5 bad passwords → email locked 15 min
export const passwordChangeLock = createFailureLock(5, 15 * 60 * 1000, 'pw-change-user') // per-user, same shape
