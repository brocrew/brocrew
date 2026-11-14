import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { Worker } from 'node:worker_threads'
import { expect, it } from 'vitest'
import type { ListingAnswer } from '../src/shared/listing-published'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { windowMemoryHost } from '../test/helpers/window-memory-host'
import { bundleAWorker } from '../test/helpers/bundle-a-worker'
import { seedWindowWorkspace } from '../test/helpers/fictional-window-workspace'

it(
  'reads the complete legacy listing from production-proportional history at 128 MB',
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'fictional-window-workspace-'))
    const file = join(directory, 'fictional.sqlite')
    const db = openDatabase(file)
    let host: ReturnType<typeof windowMemoryHost>['host'] | undefined
    try {
      applyMigrations(
        db,
        join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'),
      )
      const seedStart = performance.now()
      const scale = seedWindowWorkspace(db, directory)
      console.log(
        'Window workspace fixture',
        JSON.stringify({
          ...scale,
          databaseBytes: statSync(file).size,
          setupMilliseconds: performance.now() - seedStart,
        }),
      )
      const store = createSessionStore(db)
      const bundle = await bundleAWorker(
        'src/main/window-reader.worker.ts',
        directory,
        'window.cjs',
      )
      const worker = new Worker(bundle, {
        workerData: { file },
        resourceLimits: {
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 16,
        },
      })
      let oom = 0
      worker.on('error', (error) => {
        if ('code' in error && error.code === 'ERR_WORKER_OUT_OF_MEMORY') oom++
        console.log('Window workspace worker error', error.name, error.message)
      })
      const fixture = windowMemoryHost(directory, db, store, worker)
      host = fixture.host
      const { onMain } = fixture
      const sink = {
        ownerId: 'fictional-window',
        alive: true,
        aPersonIsBehindIt: true,
        send: () => {},
        sendLiveness: () => {},
      }
      const start = performance.now()
      const recentLegacy = await executeRuntimeCommand(host, sink, { kind: 'listResumable' })
      const remainingLegacy = await executeRuntimeCommand(host, sink, { kind: 'listUnresumable' })
      expect(recentLegacy).toEqual([])
      expect(remainingLegacy).toHaveLength(scale.conversations)
      const page = (await executeRuntimeCommand(host, sink, {
        kind: 'listConversations',
      })) as ListingAnswer
      if ('refused' in page) throw new Error(page.refused)
      const { resumable: recent, unresumable: remaining } = page
      const elapsed = performance.now() - start
      expect(recent).toEqual([])
      expect(remaining.map((row) => row.sessionId).sort()).toEqual(
        Array.from({ length: scale.conversations }, (_, n) => `fictional-scale-${n}`).sort(),
      )
      expect(remaining).toEqual(remainingLegacy)
      expect(page.published.covers).toEqual({ population: 'listing', complete: true })
      expect(onMain).not.toHaveBeenCalled()
      expect(oom).toBe(0)
      expect(elapsed).toBeLessThanOrEqual(60_000)
      await host.closeAll()
      host = undefined
      const checkout = fileURLToPath(new URL('../../../', import.meta.url))
      const queryDirectory = join(directory, 'query-only')
      const manifest = JSON.parse(execFileSync(process.execPath, ['scripts/build-window-query-only.mjs', queryDirectory], { cwd: checkout, encoding: 'utf8' }))
      const query = JSON.parse(execFileSync(process.execPath, ['scripts/window-query-only.mjs', file, join(queryDirectory, 'window-reader.cjs'), join(queryDirectory, 'manifest.json'), 'candidate'], { cwd: checkout, encoding: 'utf8', timeout: 65_000 }))
      expect(query.outcome).toBe('complete')
      expect(query.owners).toBe(scale.conversations)
      expect(query.oom).toBe(0)
      expect(query.milliseconds).toBeLessThanOrEqual(60_000)
      expect(query.workerSha256).toBe(manifest.workerSha256)
      console.log('Window query-only binding', JSON.stringify({ manifest, query }))
      console.log(
        'Window workspace result',
        JSON.stringify({
          elapsedMilliseconds: elapsed,
          conversations: remaining.length,
          oldSpaceMb: worker.resourceLimits?.maxOldGenerationSizeMb,
          oom,
          mainHistoryReads: onMain.mock.calls.length,
        }),
      )
    } finally {
      await host?.closeAll()
      db.close()
      rmSync(directory, { recursive: true, force: true })
    }
  },
  15 * 60_000,
)
