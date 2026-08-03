/**
 * Retry/backoff and stuck-detection tests for the chunked uploadTaskFile path.
 *
 * Chunk PATCH requests go through XMLHttpRequest, which is stubbed with a
 * scripted queue (one entry per send). getUploadStatus/finalizeUpload use
 * fetch, stubbed with queues routed by method. Fake timers drive the
 * exponential backoff sleeps so no real time passes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { uploadTaskFile, ApiError } from '../src/api'

const CHUNK = 10 * 1024 * 1024

interface TaskFixture {
  id: number
  type: string
  status: string
}

const TASK_FIXTURE: TaskFixture = { id: 42, type: 'files_import', status: 'pending' }

type ChunkScript =
  | { kind: 'ok'; bytes_received: number; status?: string }
  | { kind: 'http'; status: number; body?: string }
  | { kind: 'network' }

const chunkScripts: ChunkScript[] = []
const sentOffsets: string[] = []

class FakeXHR {
  private listeners = new Map<string, (() => void)[]>()
  private headers: Record<string, string> = {}
  status = 0
  responseText = ''
  upload = { addEventListener: vi.fn() }

  open() {}
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }
  getResponseHeader() {
    return null
  }
  abort() {}
  addEventListener(event: string, handler: () => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), handler])
  }
  send() {
    sentOffsets.push(this.headers['Upload-Offset'])
    const script = chunkScripts.shift()
    if (!script) throw new Error('No scripted response for chunk PATCH')
    queueMicrotask(() => {
      if (script.kind === 'network') {
        for (const handler of this.listeners.get('error') ?? []) handler()
        return
      }
      if (script.kind === 'http') {
        this.status = script.status
        this.responseText = script.body ?? ''
      } else {
        this.status = 200
        this.responseText = JSON.stringify({
          bytes_received: script.bytes_received,
          status: script.status ?? 'uploading',
        })
      }
      for (const handler of this.listeners.get('load') ?? []) handler()
    })
  }
}

type FetchScript = { status: number; body: unknown }
const statusScripts: FetchScript[] = []
const finalizeScripts: FetchScript[] = []

const mockFetch = vi.fn((url: string, init?: RequestInit) => {
  const method = init?.method ?? 'GET'
  const queue = method === 'POST' ? finalizeScripts : statusScripts
  const script = queue.shift()
  if (!script) throw new Error(`No scripted response for ${method} ${url}`)
  return Promise.resolve(
    new Response(JSON.stringify(script.body), {
      status: script.status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
})

function makeLargeFile(size: number): File {
  const file = new File(['x'], 'backup.tar.gz', { type: 'application/gzip' })
  Object.defineProperty(file, 'size', { value: size })
  Object.defineProperty(file, 'slice', {
    value: () => new Blob(['x'], { type: 'application/octet-stream' }),
  })
  return file
}

beforeEach(() => {
  chunkScripts.length = 0
  sentOffsets.length = 0
  statusScripts.length = 0
  finalizeScripts.length = 0
  mockFetch.mockClear()
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  vi.stubGlobal('fetch', mockFetch)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Run the upload while flushing fake backoff timers until it settles. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  let settled = false
  const guarded = promise.finally(() => {
    settled = true
  })
  // Prevent unhandled rejection warnings while we pump timers.
  guarded.catch(() => {})
  while (!settled) {
    await vi.advanceTimersByTimeAsync(1000)
  }
  return guarded
}

describe('uploadTaskFile chunked retry and backoff', () => {
  it('retries a retryable 500 chunk failure after a backoff and resumes', async () => {
    const file = makeLargeFile(2 * CHUNK)
    statusScripts.push({ status: 200, body: { bytes_received: 0, status: 'uploading' } })
    chunkScripts.push(
      { kind: 'http', status: 500, body: '{"detail":"boom"}' },
      { kind: 'ok', bytes_received: CHUNK },
      { kind: 'ok', bytes_received: 2 * CHUNK },
    )
    finalizeScripts.push({ status: 200, body: TASK_FIXTURE })

    const task = await settle(uploadTaskFile(42, file))

    expect(task).toEqual(TASK_FIXTURE)
    // Failed chunk is re-sent from the same offset after the backoff.
    expect(sentOffsets).toEqual(['0', '0', String(CHUNK)])
  })

  it('retries transport (network) errors like retryable HTTP errors', async () => {
    const file = makeLargeFile(2 * CHUNK)
    statusScripts.push({ status: 200, body: { bytes_received: 0, status: 'uploading' } })
    chunkScripts.push(
      { kind: 'network' },
      { kind: 'ok', bytes_received: CHUNK },
      { kind: 'ok', bytes_received: 2 * CHUNK },
    )
    finalizeScripts.push({ status: 200, body: TASK_FIXTURE })

    const task = await settle(uploadTaskFile(42, file))

    expect(task).toEqual(TASK_FIXTURE)
    expect(sentOffsets).toEqual(['0', '0', String(CHUNK)])
  })

  it('gives up after exhausting the retry budget', async () => {
    const file = makeLargeFile(2 * CHUNK)
    statusScripts.push({ status: 200, body: { bytes_received: 0, status: 'uploading' } })
    // UPLOAD_MAX_RETRIES = 3, so the 4th consecutive failure is rethrown.
    chunkScripts.push(
      { kind: 'http', status: 500, body: '{"detail":"boom"}' },
      { kind: 'http', status: 500, body: '{"detail":"boom"}' },
      { kind: 'http', status: 500, body: '{"detail":"boom"}' },
      { kind: 'http', status: 500, body: '{"detail":"boom"}' },
    )

    await expect(settle(uploadTaskFile(42, file))).rejects.toMatchObject({ status: 500 })
    expect(sentOffsets).toEqual(['0', '0', '0', '0'])
  })

  it('does not retry non-retryable HTTP errors', async () => {
    const file = makeLargeFile(2 * CHUNK)
    statusScripts.push({ status: 200, body: { bytes_received: 0, status: 'uploading' } })
    chunkScripts.push({ kind: 'http', status: 507, body: '{"detail":"insufficient storage"}' })

    await expect(settle(uploadTaskFile(42, file))).rejects.toMatchObject({ status: 507 })
    expect(sentOffsets).toEqual(['0'])
  })

  it('fails with a stuck error when resyncs never advance the offset', async () => {
    const file = makeLargeFile(2 * CHUNK)
    statusScripts.push({ status: 200, body: { bytes_received: 0, status: 'uploading' } })
    // Each accepted-but-not-advancing chunk response triggers a resync that
    // reports the same offset; UPLOAD_MAX_RESYNCS = 5 non-progress resyncs
    // are tolerated before the upload is declared stuck.
    for (let i = 0; i < 6; i += 1) {
      chunkScripts.push({ kind: 'ok', bytes_received: 0 })
      statusScripts.push({ status: 200, body: { bytes_received: 0, status: 'uploading' } })
    }

    await expect(settle(uploadTaskFile(42, file))).rejects.toThrow('Upload is stuck')
  })

  it('rejects when a 409 conflict reports the task left the uploading state', async () => {
    const file = makeLargeFile(2 * CHUNK)
    statusScripts.push({ status: 200, body: { bytes_received: 0, status: 'uploading' } })
    chunkScripts.push({
      kind: 'http',
      status: 409,
      body: JSON.stringify({ detail: { bytes_received: 0, status: 'failed' } }),
    })

    await expect(settle(uploadTaskFile(42, file))).rejects.toMatchObject({
      status: 409,
      detail: "Task is in 'failed' state, expected 'uploading'",
    })
  })

  it('resyncs and re-finalizes once when finalize reports a size mismatch', async () => {
    const file = makeLargeFile(2 * CHUNK)
    statusScripts.push({ status: 200, body: { bytes_received: 0, status: 'uploading' } })
    chunkScripts.push(
      { kind: 'ok', bytes_received: CHUNK },
      { kind: 'ok', bytes_received: 2 * CHUNK },
    )
    finalizeScripts.push({ status: 409, body: { detail: 'size mismatch' } })
    // Resync discovers a missing tail chunk, which is re-uploaded.
    statusScripts.push({ status: 200, body: { bytes_received: CHUNK, status: 'uploading' } })
    chunkScripts.push({ kind: 'ok', bytes_received: 2 * CHUNK })
    finalizeScripts.push({ status: 200, body: TASK_FIXTURE })

    const task = await settle(uploadTaskFile(42, file))

    expect(task).toEqual(TASK_FIXTURE)
    expect(sentOffsets).toEqual(['0', String(CHUNK), String(CHUNK)])
  })

  it('rejects when the initial resync reports a non-uploading task', async () => {
    const file = makeLargeFile(2 * CHUNK)
    statusScripts.push({ status: 200, body: { bytes_received: 0, status: 'pending' } })

    const err = await settle(uploadTaskFile(42, file)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).detail).toBe("Task is in 'pending' state, expected 'uploading'")
  })
})
