/**
 * Tests for bootstrap.ts — the rule that decides who may claim the first
 * administrator account.
 *
 * The race this guards against is "whoever registers first wins", which on a
 * public URL can easily be a scanner rather than the person who deployed the
 * app. The interesting cases are therefore the ones where the answer is
 * *refuse*: a refusal must create no account at all, because a downgraded
 * plain user would consume the slot and lock the real owner out permanently.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  BOOTSTRAP_TOKEN_ENV, decideBootstrapRole, isLocalRequest, isLoopbackAddress,
  readConfiguredToken, tokensMatch,
} from '../src/lib/bootstrap'

const TOKEN = 'a'.repeat(64)

function ctx(overrides: Partial<Parameters<typeof decideBootstrapRole>[0]> = {}) {
  return {
    hasAdmin: false,
    ownersConfigured: false,
    isOwner: false,
    configuredToken: null as string | null,
    isProduction: true,
    isLocalRequest: false,
    ...overrides,
  }
}

test('without an allowlist, an installation with an administrator never grants another one', () => {
  // Even a caller who knows the bootstrap token cannot escalate once an admin
  // exists — the token is a setup credential, not a standing privilege.
  assert.deepEqual(decideBootstrapRole(ctx({ hasAdmin: true }), ''), { action: 'create-user' })
  assert.deepEqual(decideBootstrapRole(ctx({ hasAdmin: true }), TOKEN), { action: 'create-user' })
  assert.deepEqual(
    decideBootstrapRole(ctx({ hasAdmin: true, configuredToken: TOKEN }), TOKEN),
    { action: 'create-user' }
  )
})

test('with a token configured, only a matching token grants the admin role', () => {
  const configured = ctx({ configuredToken: TOKEN, isProduction: true, isLocalRequest: false })

  assert.deepEqual(decideBootstrapRole(configured, TOKEN), { action: 'grant-admin' })

  const wrong = decideBootstrapRole(configured, 'b'.repeat(64))
  assert.equal(wrong.action, 'refuse')
  assert.equal(wrong.action === 'refuse' && wrong.status, 403)

  const missing = decideBootstrapRole(configured, '')
  assert.equal(missing.action, 'refuse')
  assert.equal(missing.action === 'refuse' && missing.status, 403)
})

test('a configured token is required even in development', () => {
  // Explicit configuration beats the local convenience: if an operator set a
  // token, they want it enforced, and a bare local request must not bypass it.
  const decision = decideBootstrapRole(
    ctx({ configuredToken: TOKEN, isProduction: false, isLocalRequest: true }),
    ''
  )
  assert.equal(decision.action, 'refuse')
})

test('without a token, production refuses setup instead of downgrading it', () => {
  const decision = decideBootstrapRole(ctx({ isProduction: true, isLocalRequest: false }), '')
  assert.equal(decision.action, 'refuse', 'must not create any account')
  assert.equal(decision.action === 'refuse' && decision.status, 403)
  // The message is for the operator, and names the variable that fixes it.
  assert.match(decision.action === 'refuse' ? decision.error : '', /ADMIN_BOOTSTRAP_TOKEN/)
})

test('without a token, a proxied request to a public host is refused', () => {
  // A deployment reached through a proxy is never a "local request", so the
  // production refusal is not the only thing standing in the way.
  const decision = decideBootstrapRole(ctx({ isProduction: false, isLocalRequest: false }), '')
  assert.equal(decision.action, 'refuse')
})

test('without a token, the developer\'s own machine keeps the first-run flow', () => {
  const decision = decideBootstrapRole(ctx({ isProduction: false, isLocalRequest: true }), '')
  assert.deepEqual(decision, { action: 'grant-admin' })
})

// ---- owner allowlist --------------------------------------------------------

test('with an allowlist, only a listed address may hold admin — token or not', () => {
  const owner = ctx({ ownersConfigured: true, isOwner: true, configuredToken: TOKEN })
  assert.deepEqual(decideBootstrapRole(owner, TOKEN), { action: 'grant-admin' })

  // The token proves "I am setting this installation up", not "let me in":
  // holding it does not make an unlisted address an owner.
  const stranger = ctx({ ownersConfigured: true, isOwner: false, configuredToken: TOKEN })
  assert.deepEqual(decideBootstrapRole(stranger, TOKEN), { action: 'create-user' })
})

test('with an allowlist, an unlisted address still registers as a plain user', () => {
  // Refusing here would be wrong now: the owner's claim is gated by their
  // address, not by arriving before anybody else, so the slot is not contested.
  assert.deepEqual(
    decideBootstrapRole(ctx({ ownersConfigured: true, isOwner: false, isProduction: true }), ''),
    { action: 'create-user' }
  )
  assert.deepEqual(
    decideBootstrapRole(ctx({ ownersConfigured: true, isOwner: false, hasAdmin: true }), ''),
    { action: 'create-user' }
  )
})

test('with an allowlist, the local convenience never grants a non-owner', () => {
  // The dev shortcut is about *where* the request came from, so it must not be
  // enough to clear the owner gate.
  assert.deepEqual(
    decideBootstrapRole(ctx({ ownersConfigured: true, isOwner: false, isProduction: false, isLocalRequest: true }), ''),
    { action: 'create-user' }
  )
  assert.deepEqual(
    decideBootstrapRole(ctx({ ownersConfigured: true, isOwner: true, isProduction: false, isLocalRequest: true }), ''),
    { action: 'grant-admin' }
  )
})

test('a listed owner can still be refused by the token gate', () => {
  // Being on the allowlist is necessary, not sufficient: on a deployment the
  // address alone must not be enough, or knowing somebody's email would be
  // enough to take over the installation.
  const deployed = ctx({ ownersConfigured: true, isOwner: true, isProduction: true, isLocalRequest: false })
  assert.equal(decideBootstrapRole(deployed, '').action, 'refuse')
  assert.equal(decideBootstrapRole(ctx({ ownersConfigured: true, isOwner: true, configuredToken: TOKEN }), 'wrong').action, 'refuse')
})

test('with an allowlist, several owner addresses may hold admin at once', () => {
  // Unlike the single-claim rule, an allowlist expresses a standing right, so
  // an existing administrator no longer blocks a second owner address.
  const secondOwner = ctx({ hasAdmin: true, ownersConfigured: true, isOwner: true, configuredToken: TOKEN })
  assert.deepEqual(decideBootstrapRole(secondOwner, TOKEN), { action: 'grant-admin' })
})

test('readConfiguredToken treats unset and blank as "not configured"', () => {
  assert.equal(readConfiguredToken({}), null)
  assert.equal(readConfiguredToken({ [BOOTSTRAP_TOKEN_ENV]: '' }), null)
  assert.equal(readConfiguredToken({ [BOOTSTRAP_TOKEN_ENV]: '   ' }), null)
  assert.equal(readConfiguredToken({ [BOOTSTRAP_TOKEN_ENV]: '  abc  ' }), 'abc')
  assert.equal(readConfiguredToken({ [BOOTSTRAP_TOKEN_ENV]: 'abc' }), 'abc')
})

test('tokensMatch is exact, and safe for inputs of different lengths', () => {
  assert.equal(tokensMatch(TOKEN, TOKEN), true)
  // Lengths differ → the digest comparison must not throw (raw timingSafeEqual would).
  assert.equal(tokensMatch('short', TOKEN), false)
  assert.equal(tokensMatch(TOKEN, 'short'), false)
  assert.equal(tokensMatch('', TOKEN), false)
  assert.equal(tokensMatch('', ''), true, 'two empty values are equal — callers must never configure a blank token')
  // No prefix, suffix or case-insensitive cleverness.
  assert.equal(tokensMatch(TOKEN.slice(0, 32), TOKEN), false)
  assert.equal(tokensMatch(`${TOKEN}x`, TOKEN), false)
  assert.equal(tokensMatch('A'.repeat(64), TOKEN), false)
})

// ---- request adapter --------------------------------------------------------

function req(headers: Record<string, string>): Request {
  return new Request('http://example.test/api/auth/register', { method: 'POST', headers })
}

test('isLocalRequest accepts loopback hosts, and nothing else', () => {
  assert.equal(isLocalRequest(req({ host: 'localhost:3000' })), true)
  assert.equal(isLocalRequest(req({ host: '127.0.0.1:3000' })), true)
  assert.equal(isLocalRequest(req({ host: '[::1]:3000' })), true)
  assert.equal(isLocalRequest(req({ host: '[::1]' })), true)

  assert.equal(isLocalRequest(req({ host: 'example.com' })), false)
  assert.equal(isLocalRequest(req({ host: '192.168.1.20:3000' })), false, 'a LAN peer is not the developer')
  assert.equal(isLocalRequest(req({})), false, 'no Host at all is not evidence of locality')
})

test('isLocalRequest judges the forwarding values, not their presence', () => {
  // Next.js sets these headers on *every* request, so a direct curl to
  // localhost arrives looking exactly like this. Treating the presence of a
  // forwarding header as disqualifying silently disabled the local flow.
  assert.equal(
    isLocalRequest(req({
      host: '127.0.0.1:3000',
      'x-forwarded-for': '::ffff:127.0.0.1',
      'x-forwarded-host': '127.0.0.1:3000',
      'x-forwarded-proto': 'http',
    })),
    true,
    'what Next actually injects for a local request'
  )
  assert.equal(isLocalRequest(req({ host: 'localhost:3000', 'x-forwarded-for': '127.0.0.1' })), true)
  assert.equal(isLocalRequest(req({ host: 'localhost:3000', 'x-forwarded-for': '::1' })), true)
  // The first entry is the originating client; the rest are hops in front of it.
  assert.equal(isLocalRequest(req({ host: 'localhost:3000', 'x-forwarded-for': '127.0.0.1, 10.0.0.5' })), true)
})

test('isLocalRequest disqualifies a client address that is not loopback', () => {
  // Every one of these is what a real deployment looks like from inside the app.
  assert.equal(isLocalRequest(req({ host: 'localhost:3000', 'x-forwarded-for': '203.0.113.9' })), false)
  assert.equal(isLocalRequest(req({ host: 'localhost:3000', 'x-real-ip': '203.0.113.9' })), false)
  // A LAN peer hitting a dev server, which Next also reports via x-forwarded-for.
  assert.equal(isLocalRequest(req({ host: '192.168.1.20:3000', 'x-forwarded-for': '::ffff:192.168.1.20' })), false)
  // A same-host proxy serving a public Host is not a local request either.
  assert.equal(isLocalRequest(req({ host: 'localhost:3000', 'x-forwarded-host': 'dv3.example.com' })), false)
  // And the public hostname is still not local.
  assert.equal(isLocalRequest(req({ host: 'dv3.example.com:443' })), false)
})

test('isLoopbackAddress recognises every form a header carries', () => {
  for (const local of ['127.0.0.1', '127.0.1.5', '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1', 'localhost', '[::1]']) {
    assert.equal(isLoopbackAddress(local), true, `${local} is loopback`)
  }
  for (const remote of ['', '  ', '203.0.113.9', '::ffff:203.0.113.9', '10.0.0.5', '128.0.0.1', '0.0.0.0', 'localhost.evil.test']) {
    assert.equal(isLoopbackAddress(remote), false, `${JSON.stringify(remote)} is not loopback`)
  }
  // Malformed values must not slip through as local.
  for (const junk of ['127.0.0.256', '127.0.0', '127.0.0.1.2', '127.0.0.a']) {
    assert.equal(isLoopbackAddress(junk), false, `${junk} is not a usable address`)
  }
})
