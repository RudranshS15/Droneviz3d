/**
 * Tests for owners.ts — the allowlist of accounts that own the installation.
 *
 * This is an authorisation boundary, so the tests concentrate on the ways a
 * membership check goes wrong: substring matching, case, stray whitespace, and
 * the "unset" state accidentally producing an owner.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  OWNER_EMAILS_ENV, canChangeRoles, canRemoveUser, isOwnerEmail, readOwnerEmails,
} from '../src/lib/owners'
import type { Actor } from '../src/lib/owners'

const OWNER = 'owner@example.com'

test('an unset or blank allowlist means no owners at all', () => {
  assert.deepEqual(readOwnerEmails({}), [])
  assert.deepEqual(readOwnerEmails({ [OWNER_EMAILS_ENV]: '' }), [])
  assert.deepEqual(readOwnerEmails({ [OWNER_EMAILS_ENV]: '   ' }), [])
  // A list of nothing but separators must not invent an empty-string owner.
  assert.deepEqual(readOwnerEmails({ [OWNER_EMAILS_ENV]: ', ,,' }), [])
})

test('the allowlist is parsed forgivingly', () => {
  assert.deepEqual(readOwnerEmails({ [OWNER_EMAILS_ENV]: OWNER }), [OWNER])
  assert.deepEqual(readOwnerEmails({ [OWNER_EMAILS_ENV]: `  ${OWNER}  ` }), [OWNER])
  assert.deepEqual(readOwnerEmails({ [OWNER_EMAILS_ENV]: 'OWNER@Example.COM' }), [OWNER])
  assert.deepEqual(
    readOwnerEmails({ [OWNER_EMAILS_ENV]: `${OWNER}, second@example.com ,third@example.com` }),
    [OWNER, 'second@example.com', 'third@example.com']
  )
  // Duplicates collapse, and blanks in the middle of a list are skipped.
  assert.deepEqual(
    readOwnerEmails({ [OWNER_EMAILS_ENV]: `${OWNER},${OWNER}, ,second@example.com` }),
    [OWNER, 'second@example.com']
  )
})

test('membership requires the exact address', () => {
  const owners = readOwnerEmails({ [OWNER_EMAILS_ENV]: OWNER })

  assert.equal(isOwnerEmail(OWNER, owners), true)
  assert.equal(isOwnerEmail('  OWNER@EXAMPLE.COM  ', owners), true, 'trimmed and case-insensitive')

  // Every one of these must stay a plain user: a loose match here would hand
  // admin to an address the operator never named.
  assert.equal(isOwnerEmail('notowner@example.com', owners), false)
  assert.equal(isOwnerEmail('owner@example.com.evil.test', owners), false)
  assert.equal(isOwnerEmail('xowner@example.com', owners), false)
  assert.equal(isOwnerEmail('owner@example.co', owners), false)
  assert.equal(isOwnerEmail('owner@example.comx', owners), false)
  assert.equal(isOwnerEmail('', owners), false)
})

test('membership is false for everyone when no owner is configured', () => {
  // Failing closed matters: an empty allowlist must never read as "everyone".
  assert.equal(isOwnerEmail(OWNER, []), false)
  assert.equal(isOwnerEmail('', []), false)
})

test('a second owner address is accepted alongside the first', () => {
  const owners = readOwnerEmails({ [OWNER_EMAILS_ENV]: `${OWNER},partner@example.com` })
  assert.equal(isOwnerEmail(OWNER, owners), true)
  assert.equal(isOwnerEmail('partner@example.com', owners), true)
  assert.equal(isOwnerEmail('someone@example.com', owners), false)
})

// ---- who may do what --------------------------------------------------------

const OWNERS = [OWNER]
const owner: Actor = { email: OWNER, role: 'admin' }
const promoted: Actor = { email: 'sam@example.com', role: 'admin' }
const plain: Actor = { email: 'sam@example.com', role: 'user' }
const another: Actor = { email: 'other@example.com', role: 'user' }
const anotherAdmin: Actor = { email: 'other@example.com', role: 'admin' }

test('without an allowlist every admin keeps the older powers', () => {
  assert.equal(canChangeRoles(promoted, []), true)
  assert.equal(canChangeRoles({ email: 'someone@example.com', role: 'user' }, []), false, 'not an admin')
  assert.equal(canRemoveUser({ email: 'someone@example.com', role: 'user' }, plain, []), false, 'not an admin')
  // The route still refuses self-deletion and the last admin; this predicate is
  // only the owner-allowlist half of the decision.
  assert.equal(canRemoveUser(promoted, plain, []), true)
  assert.equal(canRemoveUser(promoted, anotherAdmin, []), true)
})

test('with an allowlist only the owner may change a role', () => {
  assert.equal(canChangeRoles(owner, OWNERS), true)
  // A promoted admin is still an admin — just not one who can hand out the role.
  assert.equal(canChangeRoles(promoted, OWNERS), false)
  assert.equal(canChangeRoles(plain, OWNERS), false)
})

test('with an allowlist a promoted admin may remove regular users only', () => {
  assert.equal(canRemoveUser(promoted, plain, OWNERS), true, 'the day-to-day moderation case')
  assert.equal(canRemoveUser(promoted, another, OWNERS), true)

  // But never a peer admin — so promoted admins cannot purge each other…
  assert.equal(canRemoveUser(promoted, anotherAdmin, OWNERS), false)
  assert.equal(canRemoveUser(promoted, owner, OWNERS), false)
  assert.equal(canRemoveUser(anotherAdmin, promoted, OWNERS), false, 'symmetric: neither can remove the other')
})

test('with an allowlist nobody removes an owner, including the owner', () => {
  assert.equal(canRemoveUser(owner, owner, OWNERS), false)
  assert.equal(canRemoveUser(promoted, owner, OWNERS), false)
  assert.equal(canRemoveUser(plain, owner, OWNERS), false)
})

test('the owner may remove anybody, admins included', () => {
  assert.equal(canRemoveUser(owner, plain, OWNERS), true)
  assert.equal(canRemoveUser(owner, anotherAdmin, OWNERS), true)
  assert.equal(canRemoveUser(owner, promoted, OWNERS), true)
})

test('a plain user can remove nobody', () => {
  assert.equal(canRemoveUser(plain, another, OWNERS), false)
  assert.equal(canRemoveUser(plain, owner, OWNERS), false)
})
