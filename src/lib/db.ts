/**
 * db.ts — SQLite persistence for the admin backend.
 *
 * Uses Node's built-in `node:sqlite` (DatabaseSync) so there are no native
 * dependencies to compile. Every query goes through prepared statements
 * (parameterized), so SQL injection is structurally impossible here.
 *
 * The database file lives at ./data/droneviz3d.db (gitignored). WAL mode is
 * enabled for concurrent readers/writers — this is also what makes the rate
 * limiter in rate-limit.ts *shared*: every server process (and instance on a
 * shared volume) reads and writes the same rate_events rows.
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type UserRole = 'user' | 'admin'

export interface UserRow {
  id: number
  email: string
  password_hash: string
  role: UserRole
  created_at: string
}

export interface SessionUser {
  id: number
  email: string
  role: UserRole
}

/**
 * Database location. `DRONEVIZ_DB_PATH` exists so a test can point at its own
 * temporary file instead of creating the developer's real database as a side
 * effect of running the suite. Resolved lazily, at connection time, rather than
 * at import — the module may be imported before a test sets the variable.
 */
function dbPath(): string {
  const fromEnv = process.env.DRONEVIZ_DB_PATH
  if (fromEnv && fromEnv.trim() !== '') return fromEnv
  return join(process.cwd(), 'data', 'droneviz3d.db')
}

let _db: DatabaseSync | null = null

function db(): DatabaseSync {
  if (_db) return _db
  const path = dbPath()
  mkdirSync(dirname(path), { recursive: true })
  const d = new DatabaseSync(path)
  d.exec('PRAGMA journal_mode = WAL')
  d.exec('PRAGMA foreign_keys = ON')
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf       TEXT NOT NULL DEFAULT '',
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS rate_events (
      key TEXT NOT NULL,
      ts  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rate_events_key_ts ON rate_events(key, ts);
  `)

  // Migration for databases created before the csrf column existed. Two
  // processes starting at once may race an ALTER — the try/catch is deliberate.
  const cols = d.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]
  if (!cols.some((c) => c.name === 'csrf')) {
    try {
      d.exec("ALTER TABLE sessions ADD COLUMN csrf TEXT NOT NULL DEFAULT ''")
    } catch {
      /* another process already added it */
    }
  }
  // Backfill csrf for sessions minted before this change so they keep working.
  d.exec("UPDATE sessions SET csrf = lower(hex(randomblob(16))) WHERE csrf = ''")

  _db = d
  return d
}

// ---- users -----------------------------------------------------------------

export function userCount(): number {
  const row = db().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
  return row.n
}

export function createUser(email: string, passwordHash: string, role: UserRole): UserRow {
  const stmt = db().prepare(
    'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)'
  )
  const res = stmt.run(email, passwordHash, role) as { lastInsertRowid: number | bigint }
  return {
    id: Number(res.lastInsertRowid),
    email,
    password_hash: passwordHash,
    role,
    created_at: new Date().toISOString(),
  }
}

export function findUserByEmail(email: string): UserRow | undefined {
  return db().prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined
}

export function findUserById(id: number): UserRow | undefined {
  return db().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
}

export function listUsers(): { id: number; email: string; role: UserRole; created_at: string }[] {
  // node:sqlite returns null-prototype rows, which Next.js refuses to pass to
  // client components — map to plain objects here.
  const rows = db()
    .prepare('SELECT id, email, role, created_at FROM users ORDER BY id ASC')
    .all() as { id: number; email: string; role: UserRole; created_at: string }[]
  return rows.map((r) => ({ id: r.id, email: r.email, role: r.role, created_at: r.created_at }))
}

export function deleteUserById(id: number): boolean {
  const res = db().prepare('DELETE FROM users WHERE id = ?').run(id) as { changes: number }
  return res.changes > 0
}

export function countAdmins(): number {
  const row = db().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }
  return row.n
}

/** Change a user's role (privilege change — callers must revoke sessions too). */
export function setUserRole(id: number, role: UserRole): boolean {
  const res = db().prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id) as { changes: number }
  return res.changes > 0
}

/** Replace a user's password hash (argon2id is hashed by the caller). */
export function updatePassword(userId: number, passwordHash: string): void {
  db().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId)
}

// ---- sessions --------------------------------------------------------------

export function createSession(id: string, userId: number, expiresAt: number, csrf: string): void {
  db().prepare(
    'INSERT INTO sessions (id, user_id, csrf, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, userId, csrf, expiresAt, Date.now())
}

export function findSession(id: string): (SessionUser & { expiresAt: number }) | undefined {
  const row = db()
    .prepare(
      `SELECT s.id AS sid, s.expires_at AS expiresAt, u.id, u.email, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`
    )
    .get(id) as { sid: string; expiresAt: number; id: number; email: string; role: UserRole } | undefined
  if (!row) return undefined
  return { id: row.id, email: row.email, role: row.role, expiresAt: row.expiresAt }
}

/** CSRF token bound to a specific session token ('' means never issued). */
export function findSessionCsrf(id: string): string | undefined {
  const row = db().prepare('SELECT csrf FROM sessions WHERE id = ?').get(id) as
    | { csrf: string }
    | undefined
  return row?.csrf
}

export function deleteSession(id: string): void {
  db().prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

export function deleteExpiredSessions(): void {
  db().prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
}

export function sessionCount(): number {
  const row = db().prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }
  return row.n
}

/** Delete all sessions for a user (used on account removal / role change). */
export function deleteUserSessions(userId: number): void {
  db().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}

/** Delete every session for a user except the one currently in use. */
export function deleteUserSessionsExcept(userId: number, exceptId: string): void {
  db().prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, exceptId)
}

// ---- transactions ---------------------------------------------------------

/**
 * Depth of an open transaction on this connection. `node:sqlite` gives one
 * synchronous connection per process, so nested calls must join the outer
 * transaction rather than try to open a second one (SQLite rejects that).
 */
let txDepth = 0

/**
 * Run `fn` inside a `BEGIN IMMEDIATE` transaction: the write lock is taken up
 * front, so a check-then-write inside `fn` cannot interleave with another
 * process. Required for anything that decides on a value it is about to write
 * — a plain check followed by a separate insert is exactly the race the review
 * flagged for both the rate limiter and registration.
 *
 * The function is synchronous on purpose: awaiting inside a transaction would
 * hold SQLite's single write lock across I/O, which is worse than the race.
 */
export function withImmediateTransaction<T>(fn: () => T): T {
  if (txDepth > 0) return fn()
  const d = db()
  d.exec('BEGIN IMMEDIATE')
  txDepth++
  try {
    const result = fn()
    d.exec('COMMIT')
    return result
  } catch (err) {
    try {
      d.exec('ROLLBACK')
    } catch {
      /* already rolled back by SQLite */
    }
    throw err
  } finally {
    txDepth--
  }
}

/** Thrown when an insert violates the unique-email constraint. */
export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`An account with this email already exists (${email})`)
    this.name = 'DuplicateEmailError'
  }
}

/**
 * Atomically decide a new user's role and create the account.
 *
 * `decide` runs *inside* the transaction with a fresh admin count, so the
 * "first account becomes admin" rule cannot be invalidated by a request that
 * started before it. The password is already hashed by the caller — hashing
 * inside would hold the write lock for the length of an argon2 computation.
 */
export function createUserAtomic(
  email: string,
  passwordHash: string,
  decide: (hasAdmin: boolean) => UserRole
): UserRow {
  return withImmediateTransaction(() => {
    if (findUserByEmail(email)) throw new DuplicateEmailError(email)
    return createUser(email, passwordHash, decide(countAdmins() > 0))
  })
}

// ---- shared rate-limit store ----------------------------------------------
// Used by rate-limit.ts. Rows carry (key, unix-ms) hits; a key is usually
// `scope:<identity>` (e.g. an IP or a normalized email). Because the table
// lives in the shared database file, limits hold across every instance that
// mounts the same data directory — not just one process's memory.

export function addRateEvent(key: string, ts: number): void {
  db().prepare('INSERT INTO rate_events (key, ts) VALUES (?, ?)').run(key, ts)
}

/**
 * Atomic check-and-consume for a sliding window: prune, count, and (only if
 * under the limit) insert, all inside one immediate transaction.
 *
 * The old flow counted and inserted as two separate statements, so two processes
 * could each observe `limit - 1` and both admit — the limit was advisory across
 * instances. Returns the oldest surviving hit when refusing, so the caller can
 * compute an accurate Retry-After.
 */
export function consumeRateEvent(
  key: string, now: number, windowMs: number, limit: number
): { allowed: boolean; oldest: number | null } {
  return withImmediateTransaction(() => {
    const d = db()
    const cutoff = now - windowMs
    d.prepare('DELETE FROM rate_events WHERE key = ? AND ts < ?').run(key, cutoff)
    const row = d.prepare('SELECT COUNT(*) AS n, MIN(ts) AS oldest FROM rate_events WHERE key = ? AND ts > ?')
      .get(key, cutoff) as { n: number; oldest: number | null }
    if (row.n >= limit) return { allowed: false, oldest: row.oldest ?? now }
    d.prepare('INSERT INTO rate_events (key, ts) VALUES (?, ?)').run(key, now)
    return { allowed: true, oldest: null }
  })
}

/** Number of hits for a key newer than `sinceMs`. */
export function countRateEvents(key: string, sinceMs: number): number {
  const row = db()
    .prepare('SELECT COUNT(*) AS n FROM rate_events WHERE key = ? AND ts > ?')
    .get(key, sinceMs) as { n: number }
  return row.n
}

/** Oldest surviving hit for a key newer than `sinceMs`, or null. */
export function oldestRateEvent(key: string, sinceMs: number): number | null {
  const row = db()
    .prepare('SELECT MIN(ts) AS ts FROM rate_events WHERE key = ? AND ts > ?')
    .get(key, sinceMs) as { ts: number | null }
  return row.ts ?? null
}

/** Drop a key's stale hits (called per key on each check). */
export function pruneRateEvents(key: string, olderThanMs: number): void {
  db().prepare('DELETE FROM rate_events WHERE key = ? AND ts < ?').run(key, olderThanMs)
}

/** Drop every hit for a key (used to clear a failure lock on success). */
export function clearRateEvents(key: string): void {
  db().prepare('DELETE FROM rate_events WHERE key = ?').run(key)
}

/** Global janitor: removes rows that can never matter again. */
export function sweepRateEvents(olderThanMs: number): void {
  db().prepare('DELETE FROM rate_events WHERE ts < ?').run(olderThanMs)
}
