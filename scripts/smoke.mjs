/**
 * smoke.mjs — startup preconditions for the server half of DroneViz3D.
 *
 * The admin backend uses Node's built-in `node:sqlite` and keeps its database in
 * `./data`, neither of which is declared anywhere the runtime checks. A missing
 * Node version or a read-only data directory therefore surfaced as a confusing
 * 500 on the first request rather than as a clear refusal to start. This runs as
 * the first step of `npm run verify`, and can be run on its own with
 * `npm run smoke` on a deployment before pointing traffic at it.
 *
 * It is deliberately side-effect free apart from a probe file it removes again:
 * it does not create the application database.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MIN_NODE = [22, 5, 0]

function fail(message, hint) {
  console.error(`\n  smoke: FAIL — ${message}`)
  if (hint) console.error(`         ${hint}`)
  console.error('')
  process.exit(1)
}

// ---- 1. Node version -------------------------------------------------------
const current = process.versions.node.split('.').map(Number)
const tooOld =
  current[0] < MIN_NODE[0] ||
  (current[0] === MIN_NODE[0] && current[1] < MIN_NODE[1])
if (tooOld) {
  fail(
    `Node ${process.versions.node} is not supported (needs >= ${MIN_NODE.join('.')})`,
    'The database layer requires node:sqlite, which was added in Node 22.5.'
  )
}

// ---- 2. node:sqlite is actually available ----------------------------------
let DatabaseSync
try {
  ;({ DatabaseSync } = await import('node:sqlite'))
} catch {
  fail(
    'node:sqlite could not be loaded',
    `Node ${process.versions.node} should provide it as a built-in; a bundled or patched runtime may not.`
  )
}
if (typeof DatabaseSync !== 'function') {
  fail('node:sqlite did not export DatabaseSync')
}

// ---- 3. Writable storage ---------------------------------------------------
// The database lives at ./data/droneviz3d.db, and WAL mode writes sidecar files
// in the same directory, so the directory must allow both create and write.
const dataDir = join(process.cwd(), 'data')
const probe = join(dataDir, `.smoke-${process.pid}`)
try {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(probe, 'ok')
  rmSync(probe, { force: true })
} catch (err) {
  fail(
    `storage directory is not writable: ${dataDir}`,
    `Sessions, admin accounts and rate-limit counters all live here. ${err instanceof Error ? err.message : String(err)}`
  )
}

console.log(
  `  smoke: ok — Node ${process.versions.node}, node:sqlite present, storage writable (${dataDir})`
)
