/**
 * auth.ts — password hashing + session management for the admin backend.
 *
 * - Passwords: argon2id (OWASP-recommended parameters), never stored in
 *   plaintext, never logged.
 * - Sessions: random 256-bit tokens stored server-side in SQLite; the browser
 *   only holds the token in an httpOnly, SameSite=Lax cookie (Secure on HTTPS).
 * - CSRF: every session mints its own server-side token (stored next to the
 *   session row). Mutating, session-authenticated routes require that token in
 *   the `X-CSRF-Token` header — a cross-site attacker cannot read it, so the
 *   cookie + header pair is proof the caller holds the session.
 * - Rotation: sessions are re-issued (new token + cookie) on password change,
 *   and a user's sessions are revoked when their role changes.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2'
import {
  SessionUser,
  createSession as dbCreateSession, findSession as dbFindSession,
  findSessionCsrf, deleteSession as dbDeleteSession, deleteExpiredSessions,
} from './db'

export const SESSION_COOKIE = 'dv3_session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const SESSION_ID_BYTES = 32
const CSRF_BYTES = 16

// OWASP password-hashing cheat sheet parameters for argon2id.
const ARGON2_PARAMS = { memoryCost: 19456, timeCost: 2, parallelism: 1 }

export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2_PARAMS)
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify(hash, password)
  } catch {
    return false // malformed hash / wrong input — never leak details
  }
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
}

/** Registration/password validation. Returns a human-readable error or null. */
export function validateCredentials(email: string, password: string): string | null {
  if (!isValidEmail(email)) return 'Enter a valid email address'
  if (password.length < 8) return 'Password must be at least 8 characters'
  if (password.length > 256) return 'Password is too long'
  return null
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

// ---- sessions --------------------------------------------------------------

function newSessionId(): string {
  return randomBytes(SESSION_ID_BYTES).toString('hex')
}

function newCsrf(): string {
  return randomBytes(CSRF_BYTES).toString('hex')
}

/** The raw session token from the request cookie, if any. */
export async function getSessionToken(): Promise<string | null> {
  const store = await cookies()
  return store.get(SESSION_COOKIE)?.value ?? null
}

export async function issueSession(userId: number): Promise<void> {
  deleteExpiredSessions()
  const token = newSessionId()
  dbCreateSession(token, userId, Date.now() + SESSION_TTL_MS, newCsrf())
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })
}

/**
 * Rotate the session cookie: destroy the old session row and mint a fresh
 * token + cookie. Used after privilege changes so any previously stolen token
 * dies with the old session.
 */
export async function rotateSession(userId: number, oldToken: string): Promise<void> {
  dbDeleteSession(oldToken)
  await issueSession(userId)
}

/** Resolve the current request's session to a user, or null. Expired sessions are cleaned up. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = await getSessionToken()
  if (!token) return null
  const session = dbFindSession(token)
  if (!session) return null
  if (session.expiresAt < Date.now()) {
    dbDeleteSession(token)
    return null
  }
  return { id: session.id, email: session.email, role: session.role }
}

/**
 * Validate the double-submit CSRF token: the `X-CSRF-Token` header must match
 * the token stored server-side for the session cookie. Cross-site attackers
 * can force the cookie along (SameSite=Lax already blocks most of that) but can
 * never read the header value, so a mismatch proves the call is not from a
 * legitimate page holding this session.
 */
export async function validCsrf(req: Request): Promise<boolean> {
  const token = await getSessionToken()
  if (!token) return false
  const expected = findSessionCsrf(token)
  if (!expected) return false
  const provided = req.headers.get('x-csrf-token')
  if (!provided) return false
  return safeEqual(provided, expected)
}

export async function destroySession(): Promise<void> {
  const token = await getSessionToken()
  if (token) dbDeleteSession(token)
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}

/**
 * Origin check for sessionless, browser-facing routes (login/register/ground):
 * when the browser sends an Origin header it must match this server.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true // non-browser client (curl/CLI); cookie SameSite still protects browsers
  const host = req.headers.get('host') ?? ''
  const expected = `http://${host}`
  const expectedHttps = `https://${host}`
  return origin === expected || origin === expectedHttps
}

export function unauthorized(message = 'Authentication required'): NextResponse {
  return NextResponse.json({ error: message }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
}

export function forbidden(message = 'Admin access required'): NextResponse {
  return NextResponse.json({ error: message }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
}

export function csrfRejected(): NextResponse {
  return NextResponse.json(
    { error: 'Invalid or missing CSRF token' },
    { status: 403, headers: { 'Cache-Control': 'no-store' } }
  )
}
