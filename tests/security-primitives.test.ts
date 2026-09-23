/**
 * Tests for the hardening primitives: client-IP resolution under an explicit
 * trusted-proxy policy, the atomic rate limiter, and atomic user creation.
 *
 * These lock two behaviours a static review flagged as overstated security:
 * forwarded headers were trusted unconditionally (so a caller could mint a fresh
 * rate-limit identity per request), and the limiter counted and inserted as two
 * separate statements (so the limit was advisory across processes).
 *
 * The database used here is this file's own temporary copy — see
 * DRONEVIZ_DB_PATH — so running the suite never creates the developer's
 * database.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempDir = mkdtempSync(join(tmpdir(), 'droneviz3d-security-'))
process.env.DRONEVIZ_DB_PATH = join(tempDir, 'security-test.db')

import { chooseClientIp, createRateLimiter, trustProxyEnabled } from '../src/lib/rate-limit'
import {
  DuplicateEmailError, clearRateEvents, consumeRateEvent, countAdmins, countRateEvents,
  createUserAtomic, findUserByEmail,
} from '../src/lib/db'

// ---------- Trusted-proxy policy ----------

test('the nearest hop is the identity, not the client-supplied first entry', () => {
  // One hop: our own server appended the address it saw.
  assert.equal(chooseClientIp('203.0.113.7', null, true), '203.0.113.7')
  // A client that prepends a fake address cannot change the answer, because the
  // trustworthy value is the one appended last.
  assert.equal(chooseClientIp('9.9.9.9, 203.0.113.7', null, true), '203.0.113.7')
  assert.equal(chooseClientIp('9.9.9.9, 8.8.8.8, 203.0.113.7', '198.51.100.1', true), '203.0.113.7')
})

test('with no trusted proxy, forwarded headers are ignored entirely', () => {
  // Stricter than per-IP: every caller shares one budget, which cannot be evaded
  // by inventing a header.
  assert.equal(chooseClientIp('1.2.3.4', '5.6.7.8', false), 'unknown')
  assert.equal(chooseClientIp('1.2.3.4, 5.6.7.8', null, false), 'unknown')
})

test('missing and malformed headers degrade to a single shared bucket', () => {
  assert.equal(chooseClientIp(null, null, true), 'unknown')
  assert.equal(chooseClientIp('', '', true), 'unknown')
  assert.equal(chooseClientIp('  ,  ', null, true), 'unknown')
  // X-Real-IP is still a header, so it is only consulted when trusting proxies.
  assert.equal(chooseClientIp(null, '198.51.100.1', true), '198.51.100.1')
})

test('TRUST_PROXY is opt-out, and opt-out is spelled several ways', () => {
  assert.equal(trustProxyEnabled({}), true)
  assert.equal(trustProxyEnabled({ TRUST_PROXY: '1' }), true)
  assert.equal(trustProxyEnabled({ TRUST_PROXY: 'true' }), true)
  for (const off of ['0', 'false', 'off', 'no', ' OFF ']) {
    assert.equal(trustProxyEnabled({ TRUST_PROXY: off }), false, `${off} must disable it`)
  }
})

// ---------- Atomic rate limiting ----------

test('the limiter admits exactly the limit and then refuses', () => {
  const limit = createRateLimiter(3, 60_000, 'test-admits')
  const results = Array.from({ length: 6 }, () => limit('client-a'))
  assert.equal(results.filter((r) => r.ok).length, 3, 'exactly the limit may pass')
  assert.equal(results[3].ok, false)
  assert.ok(results[3].retryAfterSec >= 1, 'a refusal must say how long to wait')
})

test('separate keys do not consume each others budget', () => {
  const limit = createRateLimiter(2, 60_000, 'test-keys')
  assert.equal(limit('one').ok, true)
  assert.equal(limit('one').ok, true)
  assert.equal(limit('one').ok, false)
  assert.equal(limit('two').ok, true, 'a different identity starts fresh')
})

test('namespaces keep identical raw keys apart', () => {
  const a = createRateLimiter(1, 60_000, 'ns-a')
  const b = createRateLimiter(1, 60_000, 'ns-b')
  assert.equal(a('same').ok, true)
  assert.equal(a('same').ok, false)
  assert.equal(b('same').ok, true, 'the same key under another namespace is independent')
})

test('consume is a single decision, so the count can never over-admit', () => {
  // The old implementation counted and inserted separately. This asserts the
  // combined operation: after `limit` admits, the recorded count is exactly
  // `limit` — not `limit` plus whatever raced in between.
  const key = 'atomic:probe'
  clearRateEvents(key)
  const now = Date.now()
  let admitted = 0
  for (let i = 0; i < 10; i++) {
    if (consumeRateEvent(key, now + i, 60_000, 4).allowed) admitted++
  }
  assert.equal(admitted, 4)
  assert.equal(countRateEvents(key, now - 1), 4, 'stored events match the admits exactly')
})

// ---------- Atomic user creation ----------

test('createUserAtomic refuses a duplicate instead of throwing a raw constraint', () => {
  const decide = () => 'user' as const
  createUserAtomic('dup@example.test', 'hash-1', decide)
  assert.throws(
    () => createUserAtomic('dup@example.test', 'hash-2', decide),
    (err: unknown) => err instanceof DuplicateEmailError
  )
  // The first account is untouched.
  assert.equal(findUserByEmail('dup@example.test')?.password_hash, 'hash-1')
})

test('the role decision sees a fresh admin count inside the transaction', () => {
  const seen: boolean[] = []
  createUserAtomic('owner-atomic@example.test', 'hash', (hasAdmin) => {
    seen.push(hasAdmin)
    return 'admin'
  })
  createUserAtomic('second-atomic@example.test', 'hash', (hasAdmin) => {
    seen.push(hasAdmin)
    return hasAdmin ? 'user' : 'admin'
  })
  assert.deepEqual(seen, [false, true], 'the second decision must observe the first write')
  assert.equal(countAdmins(), 1)
})
