/**
 * Characterization tests for video-file.ts — the drop-path gate.
 *
 * The empty-MIME case is the one that matters: Chrome on Windows reports no type
 * for containers it plays, and judging by type alone made those drops do nothing
 * at all.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { videoFileError } from '../src/app/droneviz3d/video-file'

test('a typed video passes', () => {
  assert.equal(videoFileError({ type: 'video/mp4', name: 'flight.mp4' }), null)
  assert.equal(videoFileError({ type: 'video/quicktime', name: 'flight.mov' }), null)
})

test('an empty MIME type passes on a known extension (the Windows .mkv case)', () => {
  assert.equal(videoFileError({ type: '', name: 'FLIGHT.MKV' }), null)
  assert.equal(videoFileError({ type: '', name: 'clip.avi' }), null)
})

test('an unknown MIME type passes on a known extension', () => {
  assert.equal(videoFileError({ type: 'application/octet-stream', name: 'clip.webm' }), null)
})

test('a non-video is refused, and the message names the file and the formats', () => {
  const message = videoFileError({ type: 'image/png', name: 'map.png' })
  assert.ok(message !== null)
  assert.match(message, /map\.png/)
  assert.match(message, /MP4, MOV, AVI, MKV or WebM/)
})

test('no extension and no type is refused', () => {
  assert.ok(videoFileError({ type: '', name: 'noextension' }) !== null)
})

test('a dotted name resolves its last extension', () => {
  assert.equal(videoFileError({ type: '', name: 'flight.2026.06.01.mp4' }), null)
  assert.ok(videoFileError({ type: '', name: 'flight.2026.06.01' }) !== null)
})
