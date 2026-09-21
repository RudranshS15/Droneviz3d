/**
 * Tests for owners.ts — the allowlist of accounts that own the installation.
 *
 * This is an authorisation boundary, so the tests concentrate on the ways a
 * membership check goes wrong: substring matching, case, stray whitespace, and
 * the "unset" state accidentally producing an owner.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { OWNER_EMAILS_ENV, isOwnerEmail, readOwnerEmails } from '../src/lib/owners'

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
