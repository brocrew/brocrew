import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { PastWorkSearchReader } from '../src/main/db/past-work-search-reader'
import { bundleAWorker } from './helpers/bundle-a-worker'
import { pastWorkTimingProbe } from './helpers/past-work-timing-probe'

type WorkerTiming = {
  receivedAt: bigint
  sendingAt: bigint
  workerCpuMs: number
  rank?: { wallMs: number; cpuMs: number; rows: number; fallback: boolean }
}

function msBetween(from: bigint, to: bigint): number {
  return Number(to - from) / 1e6
}

it.skipIf(!process.env.CI)(
  'measures a cold build, peak memory and queries on a heavy fictional profile',
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'fictional-heavy-profile-'))
    const file = join(directory, 'records.sqlite')
    const db = openDatabase(file)
    applyMigrations(db, join(import.meta.dirname, '../src/main/db/migrations'))
    const store = createSessionStore(db, () => 1_800_000_000_000)
    let reader: PastWorkSearchReader | undefined
    let largestMessageBytes = 0
    try {
      const event =
        db.prepare(`INSERT INTO events(id, session_id, ordinal, type, payload, created_at, generation)
      VALUES (?, ?, ?, ?, ?, ?, 0)`)
      db.transaction(() => {
        for (let conversation = 0; conversation < 1000; conversation++) {
          const id = `fictional-conversation-${conversation}`
          store.create({
            id,
            provider: 'codex',
            profileId: 'fictional-heavy-reader',
            cwd: directory,
            approvalMode: 'ask',
          })
          for (let message = 0; message < 200; message++) {
            const type = message % 2 === 0 ? 'user_turn' : 'assistant_message'
            const text =
              `corpusquartz uniquetoken${conversation}item${message} fictional notebook. ` +
              (message % 20 === 0 ? 'filler '.repeat(3000) : '')
            largestMessageBytes = Math.max(largestMessageBytes, Buffer.byteLength(text))
            event.run(
              `fictional-event-${conversation}-${message}`,
              id,
              message,
              type,
              JSON.stringify({ type, text }),
              1_800_000_000_000 + message,
            )
          }
        }
      })()
      db.pragma('wal_checkpoint(TRUNCATE)')
      const bundle = await bundleAWorker(
        'src/main/past-work-search.worker.ts',
        directory,
        'past-work.cjs',
        [pastWorkTimingProbe()],
      )
      const sent = new Map<number, bigint>()
      const returned = new Map<number, WorkerTiming & { resultAt: bigint }>()
      reader = new PastWorkSearchReader((source) => {
        const worker = new Worker(bundle, {
          workerData: { file: source },
          resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
        })
        const send = worker.postMessage.bind(worker)
        worker.postMessage = (...args) => {
          const [value] = args
          if (value.id !== undefined) sent.set(value.id, process.hrtime.bigint())
          send(...args)
        }
        worker.on('message', ({ id, card432 }: { id: number; card432?: WorkerTiming }) => {
          const resultAt = process.hrtime.bigint()
          if (card432 !== undefined) returned.set(id, { ...card432, resultAt })
        })
        return worker
      })
      const caller = 'fictional-conversation-0'
      const source = store.pastWorkSearchSource(caller)!
      const beforeRssMiB = process.memoryUsage().rss / 1024 / 1024
      let ticks = 0
      const pulse = setInterval(() => {
        ticks++
      }, 10)
      const started = performance.now()
      const cold = await reader.read(source, caller, 'uniquetoken999item199')
      const coldBuildMs = performance.now() - started
      clearInterval(pulse)
      console.info(
        'PAST_WORK_COLD ' +
          JSON.stringify({
            coldBuildMs,
            scope: 'worker startup, index build and first query',
            beforeRssMiB,
            peakRssMiB: process.resourceUsage().maxRSS / 1024,
            ok: cold.ok,
          }),
      )
      expect(cold).toMatchObject({
        ok: true,
        hits: [expect.objectContaining({ conversation: 'fictional-conversation-999' })],
      })
      expect(ticks).toBeGreaterThan(0)
      const queryTimes: number[] = []
      const phases = []
      for (let run = 0; run < 10; run++) {
        const at = performance.now()
        const startedAt = process.hrtime.bigint()
        const revision = store.pastWorkSearchSource(caller)!
        const selectedAt = process.hrtime.bigint()
        const found = await reader.read(revision, caller, 'corpusquartz')
        queryTimes.push(performance.now() - at)
        const completedAt = process.hrtime.bigint()
        const id = run + 2 // The cold query used request 1.
        const sentAt = sent.get(id)
        const timing = returned.get(id)
        phases.push(
          sentAt === undefined || timing === undefined
            ? { run, totalMs: queryTimes[run], missing: true }
            : {
                run,
                totalMs: queryTimes[run],
                sourceMs: msBetween(startedAt, selectedAt),
                readerQueueMs: msBetween(selectedAt, sentAt),
                dispatchMs: msBetween(sentAt, timing.receivedAt),
                workerWallMs: msBetween(timing.receivedAt, timing.sendingAt),
                workerCpuMs: timing.workerCpuMs,
                rank: timing.rank,
                resultReturnMs: msBetween(timing.sendingAt, timing.resultAt),
                readerFinishMs: msBetween(timing.resultAt, completedAt),
              },
        )
        expect(found.ok && found.hits.length).toBe(5)
        if (found.ok) expect(new Set(found.hits.map((hit) => hit.conversation)).size).toBe(5)
      }
      const queryMaxMs = Math.max(...queryTimes)
      console.info(
        'PAST_WORK_BENCHMARK ' +
          JSON.stringify({
            conversations: 1000,
            messages: 200000,
            largeMessageBytes: largestMessageBytes,
            indexedMessageLimit: 4096,
            coldBuildMs,
            beforeRssMiB,
            peakRssMiB: process.resourceUsage().maxRSS / 1024,
            queryMaxMs,
            mainThreadTicksDuringColdBuild: ticks,
          }),
      )
      console.info('CARD432_WARM_PHASES ' + JSON.stringify(phases))
      expect(queryMaxMs).toBeLessThan(200)
    } finally {
      await reader?.close()
      store.closePastWorkSearch()
      db.close()
      rmSync(directory, { recursive: true, force: true })
    }
  },
  240_000,
)
