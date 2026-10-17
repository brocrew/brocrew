import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MessageChannel, Worker, type MessagePort } from 'node:worker_threads'
import { performance } from 'node:perf_hooks'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { LimitsWorkerTransport } from '../src/main/db/limits-worker-transport'
import type { LimitsReadInput } from '../src/main/db/limits-read-protocol'
import { bundleAWorker } from './helpers/bundle-a-worker'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('real native limits worker keeps its caller scheduling', () => {
  let directory: string
  let db: AppDatabase
  let reader: LimitsWorkerTransport
  let file: string
  let probe: MessagePort
  let nativeStarted: ((at: number) => void) | undefined

  beforeAll(async () => {
    expect(process.versions.node.split('.')[0]).toBe('24')
    directory = mkdtempSync(join(tmpdir(), 'brobot-fictional-native-limits-'))
    file = join(directory, 'fictional.sqlite')
    db = openDatabase(file)
    applyMigrations(db, join(root, 'src/main/db/migrations'))
    const store = createSessionStore(db)
    store.create({
      id: 'fictional',
      provider: 'claude',
      cwd: directory,
      approvalMode: 'ask',
      profileId: 'agent',
    })
    store.append(
      'fictional',
      0,
      { type: 'error', message: 'claude is rate-limited (five_hour)', fatal: false },
      Date.now(),
    )
    await bundleAWorker(
      'test/fixtures/slow-limits-native.worker.ts',
      directory,
      'limits-native.cjs',
    )
    const channel = new MessageChannel()
    probe = channel.port1
    probe.on('message', (message: { type: string; at: number }) => {
      if (message.type === 'native-start') nativeStarted?.(message.at)
    })
    reader = new LimitsWorkerTransport(
      new Worker(join(directory, 'limits-native.cjs'), {
        workerData: { file, probe: channel.port2 },
        transferList: [channel.port2],
      }),
    )
  }, 60_000)

  afterAll(async () => {
    if (reader !== undefined) await reader.stop()
    probe?.close()
    if (db !== undefined) db.close()
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
  })

  async function measure(operation: number, replyTailMs = 0) {
    let beats = 0
    let inputHandled = false
    let inputAt = 0
    let nativeAt = 0
    let inputTimer: ReturnType<typeof setTimeout> | undefined
    nativeStarted = (at) => {
      nativeAt = at
      inputTimer = setTimeout(() => {
        inputHandled = true
        inputAt = Date.now()
      }, 30)
    }
    let last = performance.now()
    let longestGap = 0
    const heartbeat = setInterval(() => {
      const now = performance.now()
      longestGap = Math.max(longestGap, now - last)
      last = now
      beats++
    }, 10)
    const input: LimitsReadInput = {
      operation,
      databaseEpoch: 1,
      signInEpoch: 1,
      capturedAt: Date.now(),
      signInChangedAt: {},
      usage: {},
    }
    const started = performance.now()
    const answer = reader.execute(input)
    try {
      const actual = await answer
      const blockUntil = performance.now() + replyTailMs
      while (performance.now() < blockUntil) {
        /* A planted reply-handling stall. */
      }
      longestGap = Math.max(longestGap, performance.now() - last)
      const elapsed = performance.now() - started
      expect(elapsed).toBeGreaterThan(200)
      expect(beats).toBeGreaterThan(10)
      expect(inputHandled).toBe(true)
      expect(inputAt).toBeGreaterThanOrEqual(nativeAt)
      expect(inputAt).toBeLessThan(actual.readFinishedAt)
      const canonical = createSessionStore(db).providerLimitsSeen(actual.evaluatedAt)
      expect(canonical.rows).toHaveLength(1)
      expect(actual.canonical).toEqual(canonical)
      expect(actual.display).toEqual(canonical)
      console.info(
        JSON.stringify({
          proof: 'fictional-native-limits-worker',
          elapsedMs: elapsed,
          heartbeats: beats,
          longestGapMs: longestGap,
          inputHandled,
          nativeAt,
          inputAt,
          replyTailMs,
          workerReadMs: actual.readFinishedAt - actual.readStartedAt,
        }),
      )
      return longestGap
    } finally {
      clearInterval(heartbeat)
      clearTimeout(inputTimer)
      nativeStarted = undefined
    }
  }

  it('handles input during the native section and counts the completion tail', async () => {
    expect(await measure(1)).toBeLessThan(250)
  })

  it('detects a planted main-side reply tail instead of hiding it at completion', async () => {
    expect(await measure(2, 350)).toBeGreaterThanOrEqual(350)
    expect(await measure(3)).toBeLessThan(250)
  })
})
