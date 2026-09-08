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
  addRateEvent, clearRateEvents, countRateEvents,
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
    const cutoff = now - windowMs
    pruneRateEvents(key, cutoff)
    if (countRateEvents(key, cutoff) >= limit) {
      const oldest = oldestRateEvent(key, cutoff) ?? now
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) }
    }
    addRateEvent(key, now)
    return { ok: true, retryAfterSec: 0 }
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

/** Best-effort client IP from common proxy headers, falling back to the socket. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return req.headers.get('x-real-ip') ?? 'unknown'
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
