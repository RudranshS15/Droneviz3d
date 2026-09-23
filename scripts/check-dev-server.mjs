#!/usr/bin/env node
/**
 * Refuse to run `next build` while `next dev` is running.
 *
 * Both commands write the same `.next` directory. When a production build runs
 * against a live dev server it deletes the dev chunk files that the open browser
 * is still asking for, and the page dies in the browser with:
 *
 *   ChunkLoadError: Loading chunk app/droneviz3d/page failed
 *   Refused to execute script ... MIME type ('text/plain') is not executable
 *
 * Next resolves a missing chunk to its not-found response, which is served as
 * text/plain, hence the MIME refusal. What is left on disk is then a mix of dev
 * and production output, and the only remedy is to stop the server, delete
 * `.next` and start again — a confusing failure to trace back to its cause.
 *
 * This guard turns that into one clear line before any damage is done.
 * Set ALLOW_BUILD_WITH_DEV_SERVER=1 to override (e.g. if port 3000 is held by an
 * unrelated process).
 */
import net from 'node:net'

// The port this project's dev server actually uses (package.json: `next dev -p 3000`).
// Deliberately NOT read from PORT: unrelated tooling frequently exports PORT
// (while this guard was being written, the shell had PORT=0), and probing that
// instead of the real dev port made the guard silently permit the very build it
// exists to prevent. DEV_PORT is the explicit override.
const requested = Number(process.env.DEV_PORT)
const PORT =
  Number.isInteger(requested) && requested > 0 && requested < 65536 ? requested : 3000
const OVERRIDE = process.env.ALLOW_BUILD_WITH_DEV_SERVER === '1'

const listening = await new Promise((resolve) => {
  const socket = net.connect({ host: '127.0.0.1', port: PORT })
  const settle = (value) => {
    socket.destroy()
    resolve(value)
  }
  socket.setTimeout(750)
  socket.once('connect', () => settle(true))
  socket.once('timeout', () => settle(false))
  socket.once('error', () => settle(false))
})

// When nothing is listening the script falls through and exits 0 silently.
// Both branches set `exitCode` rather than calling process.exit(), so Node
// flushes the message before quitting — with a piped stdout/stderr, exiting
// immediately can swallow the very explanation this guard exists to print.
if (listening && OVERRIDE) {
  console.warn(
    `⚠ ALLOW_BUILD_WITH_DEV_SERVER=1 — building anyway while port ${PORT} is in use.\n` +
      '  If that port is a running `next dev`, this build is about to break it:\n' +
      '  stop the dev server and delete .next afterwards.\n',
  )
} else if (listening) {
  console.error(
    `\n✖ Build refused: something is listening on port ${PORT}.\n\n` +
      '  `next dev` and `next build` write to the same .next directory, so building\n' +
      '  now would delete the dev chunks an open browser tab is still requesting\n' +
      '  (it shows up as "ChunkLoadError: Loading chunk ... failed", or as a script\n' +
      '  refused for being served as text/plain).\n\n' +
      '  Stop the dev server, then build. If port ' +
      `${PORT} is some unrelated process,\n` +
      '  override with:  ALLOW_BUILD_WITH_DEV_SERVER=1 npm run build\n' +
      '  (if the dev port differs, set DEV_PORT to it.)\n',
  )
  process.exitCode = 1
}
