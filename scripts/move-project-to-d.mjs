#!/usr/bin/env node
/**
 * Relocate this project's storage to another drive while keeping its path.
 *
 * Phase 1 (default)   — resumable copy of the project to the destination drive.
 * Phase 2 (--finish)  — rename the original aside, put a directory junction in
 *                       its place pointing at the copy, then delete the old copy.
 *
 * Why this exists rather than `mv`: the tree is ~20k files and a cross-volume
 * move outruns any single shell command, while an interrupted `mv` cannot
 * resume. Re-running is always safe: a destination file whose size matches its
 * source is skipped, nothing is ever removed from the source during phase 1,
 * and phase 2 refuses to touch anything until a verifying pass succeeds.
 *
 * Why the junction goes on the *project root*, not on node_modules or .next:
 * that was tried and rejected. Next rewrites paths it resolves through such a
 * link and the build dies with "Can't resolve './D:/…/node_modules/next/…'".
 * With the whole project on the other volume, every path inside it is native to
 * that volume and nothing is cross-volume.
 *
 * ── To finish a pending relocation ──────────────────────────────────────────
 *   --finish must run with the Freebuff app (and any Explorer window showing
 *   this folder) closed. The app holds the project directory open for the
 *   lifetime of a session, and Windows cannot rename a directory that any
 *   process has open — attempts fail with a sharing violation. The script
 *   detects that, reports it, and changes nothing.
 *
 *   A double-clickable wrapper for exactly this lives next to this file:
 *   scripts/move-project-to-d.cmd
 *
 * Usage:
 *   node scripts/move-project-to-d.mjs                 # copy / re-sync only
 *   node scripts/move-project-to-d.mjs --finish        # copy, then swap and clean up
 *   node scripts/move-project-to-d.mjs --finish --keep-source
 *   node scripts/move-project-to-d.mjs --src <dir> --dst <dir> [--budget-seconds N]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : argv[index + 1]
}
const hasFlag = (name) => argv.includes(name)

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(arg('--src', path.resolve(SCRIPT_DIR, '..')))
const DST = path.resolve(arg('--dst', 'D:/DroneViz3D'))
const FINISH = hasFlag('--finish')
const KEEP_SOURCE = hasFlag('--keep-source')
const BUDGET_MS = Number(arg('--budget-seconds', '240')) * 1000
const SKIP = new Set(['.next', '.next-build', '.test-build'])
const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES'])

/** Synchronous sleep; the process is doing one thing and it must be simple. */
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const real = (p) => {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

const startedAt = Date.now()
const stats = { files: 0, bytes: 0, copied: 0, skipped: 0, links: 0 }
const failures = []
let budgetExpired = false

const outOfTime = () => Date.now() - startedAt > BUDGET_MS
const atTopLevel = (dir) => dir === SRC

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  for (let attempt = 1; ; attempt += 1) {
    try {
      fs.copyFileSync(src, dst)
      return true
    } catch (err) {
      // A watcher or indexer can hold a transient lock; a short retry usually wins.
      if (attempt >= 3 || !RETRYABLE.has(err.code)) {
        failures.push(`copy ${path.relative(SRC, src)}: ${err.code ?? err.message}`)
        return false
      }
      sleep(250)
    }
  }
}

function copyTree(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true })
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (outOfTime()) {
      budgetExpired = true
      return
    }
    if (atTopLevel(srcDir) && SKIP.has(entry.name)) continue

    const src = path.join(srcDir, entry.name)
    const dst = path.join(dstDir, entry.name)

    let stat
    try {
      stat = fs.lstatSync(src)
    } catch {
      continue // vanished mid-walk (a lock file); not part of the move
    }

    if (stat.isSymbolicLink()) {
      stats.links += 1
      if (!fs.existsSync(dst)) {
        let type = 'file'
        try {
          if (fs.statSync(src).isDirectory()) type = 'junction'
        } catch {
          // dangling link: recreate it as-is
        }
        fs.symlinkSync(fs.readlinkSync(src), dst, type)
      }
      continue
    }

    if (stat.isDirectory()) {
      copyTree(src, dst)
      continue
    }
    if (!stat.isFile()) continue // sockets and other non-copyable entries

    stats.files += 1
    stats.bytes += stat.size
    try {
      if (fs.existsSync(dst) && fs.statSync(dst).size === stat.size) {
        stats.skipped += 1
        continue
      }
    } catch {
      // fall through and (re)copy
    }
    if (copyFile(src, dst)) stats.copied += 1
  }
}

function verifyTree(srcDir, dstDir) {
  let checked = 0
  let bad = 0

  const walk = (src, dst) => {
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (outOfTime()) {
        budgetExpired = true
        return
      }
      if (atTopLevel(src) && SKIP.has(entry.name)) continue

      const srcPath = path.join(src, entry.name)
      const dstPath = path.join(dst, entry.name)

      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        walk(srcPath, dstPath)
        continue
      }

      const stat = fs.lstatSync(srcPath)
      checked += 1
      try {
        if (stat.isSymbolicLink()) {
          fs.lstatSync(dstPath)
        } else if (stat.isFile()) {
          if (fs.statSync(dstPath).size !== stat.size) throw new Error('size mismatch')
        }
      } catch {
        bad += 1
        if (failures.length < 12) failures.push(`verify ${path.relative(SRC, srcPath)}`)
      }
    }
  }

  walk(srcDir, dstDir)
  return { checked, bad }
}

function report(phase) {
  const mb = (stats.bytes / 1024 / 1024).toFixed(1)
  console.log(
    `${phase}: copied ${stats.copied}, skipped ${stats.skipped}, ` +
      `links ${stats.links} (source: ${stats.files} files, ${mb} MB)`,
  )
  if (failures.length > 0) {
    console.log(`problems (${failures.length}):`)
    for (const failure of failures.slice(0, 12)) console.log(`  - ${failure}`)
  }
}

// ── delete helper: Windows read-only files (git objects) need a chmod first ──

function unlinkAny(p) {
  // 1. the usual case; 2. Windows read-only files (git objects) need a chmod;
  // 3. directory junctions and symlinks to directories only yield to rmdir.
  try {
    fs.unlinkSync(p)
    return true
  } catch {
    /* try the next strategy */
  }
  try {
    fs.chmodSync(p, 0o666)
    fs.unlinkSync(p)
    return true
  } catch {
    /* try the next strategy */
  }
  try {
    fs.rmdirSync(p)
    return true
  } catch {
    return false
  }
}

function removeTree(dir) {
  let removed = 0
  let failed = 0

  const walk = (p) => {
    let entries
    try {
      entries = fs.readdirSync(p, { withFileTypes: true })
    } catch {
      if (unlinkAny(p)) removed += 1
      else failed += 1
      return
    }
    for (const entry of entries) {
      const child = path.join(p, entry.name)
      if (entry.isDirectory() && !entry.isSymbolicLink()) walk(child)
      else if (unlinkAny(child)) removed += 1
      else failed += 1
      if (removed > 0 && removed % 5000 === 0) {
        console.log(`  … ${removed} entries removed`)
      }
    }
    try {
      fs.rmdirSync(p)
    } catch {
      failed += 1
    }
  }

  walk(dir)
  return { removed, failed }
}

// ── phase 2 ─────────────────────────────────────────────────────────────────

function renameWithRetries(from, to, attempts = 8) {
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      fs.renameSync(from, to)
      return { ok: true }
    } catch (err) {
      lastError = err
      sleep(700)
    }
  }
  return { ok: false, error: lastError }
}

function cleanOldCopies() {
  const oldPath = `${SRC}-old`
  if (!fs.existsSync(oldPath) && !fs.existsSync(path.dirname(SRC))) return
  const parent = path.dirname(SRC)
  const prefix = `${path.basename(SRC)}-old`
  const leftovers = fs.readdirSync(parent).filter((name) => name === prefix || name.startsWith(`${prefix}-`))
  if (leftovers.length === 0) {
    console.log('no leftover copy to remove.')
    return
  }
  if (KEEP_SOURCE) {
    console.log(`--keep-source: leaving ${leftovers.map((n) => path.join(parent, n)).join(', ')} in place.`)
    return
  }
  for (const name of leftovers) {
    const target = path.join(parent, name)
    console.log(`removing the old copy at ${target} …`)
    const { removed, failed: failedDeletes } = removeTree(target)
    console.log(`  removed ${removed} entries${failedDeletes > 0 ? `, ${failedDeletes} could not be removed` : ''}`)
  }
}

function finish() {
  const cwd = path.resolve(process.cwd())
  if (cwd === SRC || cwd.startsWith(SRC + path.sep)) {
    console.log('Refusing to swap from inside the project: this shell\'s own working')
    console.log('directory would keep the folder locked. Run the same command from its')
    console.log('parent folder instead:\n')
    console.log(`  cd "${path.dirname(SRC)}"`)
    console.log(`  node "${path.join(SRC, 'scripts', path.basename(fileURLToPath(import.meta.url)))}" --finish\n`)
    console.log('(Or just close the app and double-click scripts/move-project-to-d.cmd.)')
    process.exitCode = 1
    return
  }

  if (fs.lstatSync(SRC).isSymbolicLink()) {
    console.log(`${SRC} is already a junction — this project is already relocated.`)
    console.log(`target: ${fs.readlinkSync(SRC)}`)
    cleanOldCopies()
    process.exitCode = 0
    return
  }

  if (!fs.existsSync(path.join(DST, 'package.json'))) {
    console.log(`Refusing to swap: ${DST} does not look like a copy of this project.`)
    console.log('Run the copy phase first (no --finish) and check the destination.')
    process.exitCode = 1
    return
  }

  const oldBase = `${SRC}-old`
  const oldPath = fs.existsSync(oldBase) ? `${oldBase}-${Date.now()}` : oldBase

  const renamed = renameWithRetries(SRC, oldPath)
  if (!renamed.ok) {
    console.log(`Could not rename ${SRC}`)
    console.log(`  reason: ${renamed.error?.code ?? renamed.error?.message}`)
    console.log('Nothing was changed. A process still has the folder open — most likely')
    console.log('the Freebuff app itself (it holds the project for the whole session).')
    console.log('Close it, then run this command again.')
    process.exitCode = 1
    return
  }
  console.log(`renamed the original to ${oldPath}`)

  try {
    fs.symlinkSync(DST, SRC, 'junction')
  } catch (err) {
    console.log(`Could not create the junction (${err.code ?? err.message}); rolling back.`)
    fs.renameSync(oldPath, SRC)
    console.log('Original restored; nothing changed.')
    process.exitCode = 1
    return
  }
  console.log(`junction created: ${SRC} -> ${DST}`)

  if (!fs.existsSync(path.join(SRC, 'package.json'))) {
    console.log('WARNING: package.json is not reachable through the new junction.')
    process.exitCode = 1
    return
  }
  console.log('verified: the project answers at its original path through the junction')

  if (KEEP_SOURCE) {
    console.log(`--keep-source: the old copy remains at ${oldPath}`)
  } else {
    console.log(`removing the old copy at ${oldPath} …`)
    const { removed, failed: failedDeletes } = removeTree(oldPath)
    console.log(`  removed ${removed} entries${failedDeletes > 0 ? `, ${failedDeletes} could not be removed (re-run to finish)` : ''}`)
  }
  console.log('\nDONE — storage is on the destination drive, and the project still opens')
  console.log(`at ${SRC}. Reopen it there as usual.`)
}

// ── run ─────────────────────────────────────────────────────────────────────

console.log(`source:      ${SRC}`)
console.log(`destination: ${DST}`)
console.log(`mode:        ${FINISH ? 'finish (copy, then swap)' : 'copy'}`)
console.log(`skipping:    ${[...SKIP].join(', ')}\n`)

if (fs.existsSync(DST) && real(SRC) && real(SRC) === real(DST)) {
  console.log('Source and destination are the same directory — this project is already relocated.')
  if (FINISH) cleanOldCopies()
  process.exitCode = 0
} else {
  fs.mkdirSync(DST, { recursive: true })
  copyTree(SRC, DST)

  if (budgetExpired) {
    report('COPY INCOMPLETE (time budget reached)')
    console.log(`\nRun the same command again to continue${FINISH ? ' (--finish will then swap).' : '.'}`)
    process.exitCode = 2
  } else {
    const { checked, bad } = verifyTree(SRC, DST)
    report(budgetExpired ? 'VERIFY INCOMPLETE (time budget reached)' : 'COPY COMPLETE')

    if (budgetExpired) {
      console.log('\nRun the same command again to finish verifying.')
      process.exitCode = 2
    } else if (bad > 0 || failures.length > 0) {
      console.log(`\nVERIFY FAILED: ${bad} of ${checked} entries missing or mismatched.`)
      console.log('Not swapping. Re-run to copy what is missing, then try again.')
      process.exitCode = 1
    } else {
      console.log(`\nVERIFIED: ${checked} entries present at the destination.`)
      if (FINISH) {
        finish()
      } else {
        console.log('The source was not touched. Add --finish (with the app closed) to swap.')
        process.exitCode = 0
      }
    }
  }
}
