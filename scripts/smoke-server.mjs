/**
 * smoke-server.mjs — exercises the built server, not the build output.
 *
 * Why this exists: `npm run build` proves the app compiles, and `npm run smoke`
 * proves the runtime preconditions (Node, node:sqlite, writable storage). Until
 * this script, nothing proved the app actually *answers*. A mistyped CSP, a
 * broken route guard or a config change could break every response while CI
 * stayed green — the build output is identical either way.
 *
 * What it does: starts `next start` against the production build on a free port
 * (never 3000, so a running dev server is untouched; never exposed beyond
 * loopback), waits until it responds, asserts the pages, the API contracts and
 * the production-only security headers, then stops it again. Server output is
 * kept and printed when something fails, because "the check failed" without the
 * server's own error line is not actionable.
 *
 * Run it after `npm run build`, on its own as `npm run smoke:server`, or as the
 * final step of `npm run verify`. CI runs it on every push.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

const ROOT = process.cwd()
const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next')
const PROD_DIST = path.join(ROOT, '.next-build')
const READY_TIMEOUT_MS = 60_000

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : argv[index + 1]
}

const results = []
const serverOutput = []
let server = null
let stopped = false

function stopServer() {
  if (stopped) return
  stopped = true
  if (server && server.exitCode === null) {
    try {
      server.kill()
    } catch {
      // already gone
    }
  }
}

process.on('SIGINT', () => {
  stopServer()
  process.exit(130)
})
process.on('SIGTERM', () => {
  stopServer()
  process.exit(143)
})
process.on('exit', stopServer)

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

// ---- assertions ------------------------------------------------------------

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

async function waitForServer(base) {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error('the server exited before it answered')
    }
    try {
      await fetch(`${base}/droneviz3d`)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
  }
  throw new Error(`no response within ${READY_TIMEOUT_MS / 1000}s`)
}

async function check(name, run) {
  try {
    await run()
    results.push({ name, ok: true })
    console.log(`  ✓ ${name}`)
  } catch (err) {
    results.push({ name, ok: false })
    console.log(`  ✗ ${name} — ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function main() {
  if (!existsSync(path.join(PROD_DIST, 'BUILD_ID'))) {
    throw new Error(`no production build in ${path.basename(PROD_DIST)}/ — run \`npm run build\` first`)
  }
  if (!existsSync(NEXT_BIN)) {
    throw new Error(`Next's CLI is missing at ${NEXT_BIN} — run \`npm ci\` first`)
  }

  const port = Number(argOf('--port', '0')) || (await freePort())
  const base = `http://127.0.0.1:${port}`

  server = spawn(process.execPath, [NEXT_BIN, 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: ROOT,
    // `next start` sets this itself, but asserting the production-only headers
    // should not depend on that staying true.
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const capture = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) serverOutput.push(line.trim())
    }
    if (serverOutput.length > 80) serverOutput.splice(0, serverOutput.length - 80)
  }
  server.stdout.on('data', capture)
  server.stderr.on('data', capture)
  server.on('error', (err) => {
    serverOutput.push(`spawn error: ${err.message}`)
  })

  await waitForServer(base)
  console.log(`\n  smoke:server — ${base} (production build)\n`)

  const get = (route, init) => fetch(`${base}${route}`, init)

  await check('landing page serves HTML', async () => {
    const res = await get('/droneviz3d')
    assert(res.status === 200, `expected HTTP 200, got ${res.status}`)
    const type = res.headers.get('content-type') ?? ''
    assert(type.includes('text/html'), `content-type was "${type}"`)
    const html = await res.text()
    assert(html.includes('DroneViz3D'), 'the HTML never mentions DroneViz3D')
  })

  await check('production security headers are present', async () => {
    const res = await get('/droneviz3d')
    const header = (key) => res.headers.get(key) ?? ''
    assert(
      header('content-security-policy').includes("default-src 'self'"),
      `Content-Security-Policy is "${header('content-security-policy') || 'missing'}" — it is production-only, so this also proves NODE_ENV`
    )
    assert(header('strict-transport-security').startsWith('max-age='), `Strict-Transport-Security is "${header('strict-transport-security') || 'missing'}"`)
    assert(header('x-frame-options') === 'DENY', `X-Frame-Options is "${header('x-frame-options') || 'missing'}"`)
    assert(header('x-content-type-options') === 'nosniff', `X-Content-Type-Options is "${header('x-content-type-options') || 'missing'}"`)
    assert(header('referrer-policy') === 'strict-origin-when-cross-origin', `Referrer-Policy is "${header('referrer-policy') || 'missing'}"`)
    assert(header('permissions-policy').includes('camera=()'), `Permissions-Policy is "${header('permissions-policy') || 'missing'}"`)
    assert(header('x-powered-by') === '', 'X-Powered-By is still advertised (poweredByHeader)')
  })

  await check('legal pages are reachable', async () => {
    const pages = [
      ['/droneviz3d/legal/privacy', 'Privacy Policy'],
      ['/droneviz3d/legal/cookies', 'Cookies Policy'],
      ['/droneviz3d/legal/terms', 'Terms'],
    ]
    for (const [route, marker] of pages) {
      const res = await get(route)
      assert(res.status === 200, `${route} returned ${res.status}`)
      const html = await res.text()
      assert(html.includes(marker), `${route} never mentions "${marker}"`)
    }
  })

  await check('admin login page is served', async () => {
    const res = await get('/droneviz3d/admin')
    assert(res.status === 200, `expected HTTP 200, got ${res.status}`)
  })

  await check('unknown routes answer 404', async () => {
    const res = await get('/this-route-does-not-exist')
    assert(res.status === 404, `expected HTTP 404, got ${res.status}`)
  })

  await check('anonymous session is rejected (401)', async () => {
    const res = await get('/api/auth/me')
    assert(res.status === 401, `expected HTTP 401, got ${res.status}`)
    const body = await res.json()
    assert(body.error === 'Authentication required', `body was ${JSON.stringify(body)}`)
  })

  await check('admin API requires a session (401)', async () => {
    const res = await get('/api/admin/users')
    assert(res.status === 401, `expected HTTP 401, got ${res.status}`)
  })

  await check('mutations require the CSRF token (403)', async () => {
    const res = await get('/api/auth/logout', { method: 'POST' })
    assert(res.status === 403, `expected HTTP 403, got ${res.status}`)
    const body = await res.json()
    assert(String(body.error ?? '').includes('CSRF'), `body was ${JSON.stringify(body)}`)
  })

  await check('grounding proxy refuses GET (405)', async () => {
    const res = await get('/api/ground')
    assert(res.status === 405, `expected HTTP 405, got ${res.status}`)
  })

  await check('grounding proxy refuses cross-origin POST (403)', async () => {
    const res = await get('/api/ground', { method: 'POST', headers: { origin: 'https://evil.example' } })
    assert(res.status === 403, `expected HTTP 403, got ${res.status}`)
    const body = await res.json()
    assert(String(body.error ?? '').includes('Cross-origin'), `body was ${JSON.stringify(body)}`)
  })
}

try {
  await main()
} catch (err) {
  results.push({ name: 'server started', ok: false })
  console.log(`  ✗ server started — ${err instanceof Error ? err.message : String(err)}`)
}

stopServer()

const failed = results.filter((result) => !result.ok)
if (failed.length > 0) {
  console.log('\n  last server output:')
  for (const line of serverOutput.slice(-15)) console.log(`    ${line}`)
  console.log('')
}
console.log(
  `  smoke:server: ${results.length - failed.length}/${results.length} checks passed` +
    (failed.length > 0 ? ' — FAIL' : ' — ok')
)
process.exitCode = failed.length > 0 ? 1 : 0
