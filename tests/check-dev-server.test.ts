/**
 * Tests for scripts/check-dev-server.mjs — the prebuild guard.
 *
 * The guard exists because `next dev` and `next build` write the same `.next`
 * directory: building during development deletes the dev chunks an open browser
 * is still requesting, and the page dies with "ChunkLoadError: Loading chunk
 * ... failed" (or a script refused for being served as text/plain). The guard is
 * only worth having if it decides correctly, so these tests drive the real
 * script with a real listening socket.
 *
 * The case worth keeping is the decoy PORT: PORT is a common ambient variable
 * (it was 0 in this project's own shell), and reading it made the guard probe
 * the wrong port, wave the build through, and corrupt `.next`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// Compiled to .test-build/tests/, so the repo root is two levels up.
const SCRIPT = path.resolve(__dirname, '../../scripts/check-dev-server.mjs')

function runGuard(env: Record<string, string>) {
  const base: Record<string, string | undefined> = { ...process.env }
  delete base.DEV_PORT
  delete base.ALLOW_BUILD_WITH_DEV_SERVER
  const result = spawnSync(process.execPath, [SCRIPT], {
    env: { ...base, ...env } as NodeJS.ProcessEnv,
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/** Hold an ephemeral port open for the duration of fn, so a listener really exists. */
async function withListeningPort<T>(fn: (port: number) => T): Promise<T> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const { port } = server.address() as net.AddressInfo
  try {
    return fn(port)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

/** A port nothing is listening on. */
async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const { port } = server.address() as net.AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

test('a free dev port lets the build through, silently', async () => {
  const port = await freePort()
  const result = runGuard({ DEV_PORT: String(port) })
  assert.equal(result.status, 0)
  assert.equal(result.stdout.trim(), '', 'a passing guard should say nothing')
  assert.equal(result.stderr.trim(), '')
})

test('a listening dev port refuses the build, naming the port', async () => {
  await withListeningPort((port) => {
    const result = runGuard({ DEV_PORT: String(port) })
    assert.equal(result.status, 1)
    // The message has to survive being piped: use exitCode, not process.exit().
    assert.match(result.stderr, /Build refused/)
    assert.match(result.stderr, new RegExp(`port ${port}\\b`))
  })
})

test('an unrelated ambient PORT cannot mask the real dev port', async () => {
  await withListeningPort((port) => {
    // The regression that corrupted .next: PORT=0 in the environment was read as
    // "the dev port is 0", which never connects, so the build was allowed.
    assert.equal(runGuard({ DEV_PORT: String(port), PORT: '0' }).status, 1)
    // Nor may the real port arrive via PORT instead of DEV_PORT — otherwise an
    // unrelated PORT would make the guard refuse builds on a port we don't use.
    assert.equal(runGuard({ DEV_PORT: String(port), PORT: String(port) }).status, 1)
  })
})

test('a nonsensical DEV_PORT falls back to the dev script’s real port', () => {
  // An unusable value must not silently become "port 0", which would make the
  // guard pointless. It falls back to 3000, so behaviour must match asking for
  // 3000 explicitly. Compared rather than asserted outright, because whether
  // anything is on 3000 differs between a dev machine and CI.
  const explicit = runGuard({ DEV_PORT: '3000' })

  for (const bad of ['0', '-1', 'not-a-port', '70000', '']) {
    const result = runGuard({ DEV_PORT: bad })
    assert.equal(result.status, explicit.status, `DEV_PORT=${JSON.stringify(bad)} should behave as 3000`)
    assert.equal(result.stderr, explicit.stderr)
  }

  // …and it really is 3000 it falls back to, not some other port.
  if (explicit.status === 1) assert.match(explicit.stderr, /port 3000\b/)
})

test('the override allows the build but warns loudly', async () => {
  await withListeningPort((port) => {
    const result = runGuard({ DEV_PORT: String(port), ALLOW_BUILD_WITH_DEV_SERVER: '1' })
    assert.equal(result.status, 0)
    assert.match(result.stderr, /ALLOW_BUILD_WITH_DEV_SERVER/)
    assert.match(result.stderr, /about to break it/, 'the override must not be silent')
  })
})
