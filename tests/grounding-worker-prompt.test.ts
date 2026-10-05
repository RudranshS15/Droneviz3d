/**
 * The object-class list is only worth a form field if it reaches the worker.
 *
 * There is nothing between the parser and the adapter's form body except one
 * `labels` local — which is exactly why it deserves a test: a typo that sent the
 * default list, or dropped the field, would be invisible everywhere else. The
 * parser is covered by label-vocabulary.test.ts and the adapter's response
 * handling by grounding.test.ts; this file covers the wire: what the proxy
 * receives when a custom list is configured.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createLocateAnythingAdapter } from '../src/app/droneviz3d/grounding'

interface CapturedCall {
  url: string
  init: RequestInit
}

/** Replace global fetch for one test, capturing what the adapter sent. */
function stubFetch(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: CapturedCall[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL ? input.toString() : input.url
    const requestInit = init ?? {}
    calls.push({ url, init: requestInit })
    return responder(url, requestInit)
  }) as typeof fetch
  return { calls, restore: () => { globalThis.fetch = original } }
}

const okResults = (count: number) =>
  new Response(
    JSON.stringify({ results: Array.from({ length: count }, () => ({ boxes: [], raw: '' })) }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )

test('the configured class list is sent as the worker’s labels field, in order', async () => {
  const { calls, restore } = stubFetch(() => okResults(1))
  try {
    const adapter = createLocateAnythingAdapter('/api/ground')
    await adapter([{ image: new Blob(['frame']), keyframeIndex: 0, labels: ['solar panel', 'chimney'] }])

    assert.equal(calls.length, 1, 'one request for one batch')
    assert.equal(calls[0].url, '/api/ground')
    const body = calls[0].init.body as FormData
    assert.ok(body instanceof FormData, 'the worker is called with a multipart body')
    // Comma-joined without spaces: the class names themselves may contain spaces
    // ("solar panel"), so the separator must not add any of its own.
    assert.equal(body.get('labels'), 'solar panel,chimney', 'the list the operator typed must be what the worker is asked about')
  } finally {
    restore()
  }
})

test('every keyframe is attached, named by its index, alongside the same labels', async () => {
  const { calls, restore } = stubFetch(() => okResults(2))
  try {
    const adapter = createLocateAnythingAdapter('/api/ground')
    await adapter([
      { image: new Blob(['a']), keyframeIndex: 3, labels: ['boat'] },
      { image: new Blob(['b']), keyframeIndex: 4, labels: ['boat'] },
    ])

    const body = calls[0].init.body as FormData
    const frames = body.getAll('frames') as File[]
    assert.equal(frames.length, 2)
    assert.deepEqual(frames.map((f) => f.name), ['keyframe-3.jpg', 'keyframe-4.jpg'])
    assert.equal(body.get('labels'), 'boat')
  } finally {
    restore()
  }
})

test('a box the worker returns without a label falls back to the configured class, not to a hard-coded one', async () => {
  const { restore } = stubFetch(() => new Response(
    JSON.stringify({ results: [{ boxes: [{ x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.5 }], raw: 'x' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  ))
  try {
    const adapter = createLocateAnythingAdapter('/api/ground')
    const [response] = await adapter([{ image: new Blob(['f']), keyframeIndex: 0, labels: ['lighthouse'] }])

    assert.equal(response.source, 'locateanything-3b')
    assert.equal(response.boxes[0].label, 'lighthouse')
  } finally {
    restore()
  }
})

test('a proxy failure surfaces as an error rather than an empty result', async () => {
  const { restore } = stubFetch(() => new Response(JSON.stringify({ error: 'worker offline' }), {
    status: 502, headers: { 'content-type': 'application/json' },
  }))
  try {
    const adapter = createLocateAnythingAdapter('/api/ground')
    await assert.rejects(
      () => adapter([{ image: new Blob(['f']), keyframeIndex: 0, labels: ['building'] }]),
      /worker offline/
    )
  } finally {
    restore()
  }
})
