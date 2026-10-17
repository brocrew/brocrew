import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionSnapshot } from '../src/main/db/session-store'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { deriveLedger } from '../src/main/archive/derive-ledger'
import { linesOf } from './helpers/provider-lines'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const evidence = process.env['BROBOT_WINDOW_BULK_MEASUREMENTS']

it.skipIf(evidence === undefined)(
  'measures paired fictional bundle import and rebuild totals',
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'fictional-window-bulk-'))
    const measurements: object[] = []
    const size = 10_000
    const ledger: SessionSnapshot['ledger'] = Array.from({ length: size }, (_, ordinal) => ({
      ordinal,
      at: 1_700_000_000_000 + ordinal,
      event:
        ordinal % 50 === 0
          ? { type: 'user_turn', text: 'fictional question' }
          : ordinal % 50 === 49
            ? { type: 'turn', state: 'completed' }
            : { type: 'assistant_message', text: 'fictional response '.repeat(8) },
    }))
    const frames = Array.from({ length: size }, (_, ordinal) =>
      JSON.stringify({
        type: ordinal % 50 === 0 ? 'user' : 'assistant',
        timestamp: new Date(1_700_000_000_000 + ordinal * 1000).toISOString(),
        message: { content: 'fictional line '.repeat(8) },
      }),
    )
    try {
      for (let round = -1; round < 5; round++) {
        const modes = round % 2 ? (['tracked', 'plain'] as const) : (['plain', 'tracked'] as const)
        for (const mode of modes) {
          const db = openDatabase(join(directory, `${round}-${mode}.sqlite`))
          try {
            applyMigrations(db, migrations)
            const store = createSessionStore(db)
            if (mode === 'tracked') {
              const sample = windowWriterSampler(db, () => true)
              for (const sessionId of ['bundle', 'archive'])
                for (let i = 0; i < 4; i++)
                  sample({
                    kind: 'leads',
                    sessionId,
                    before: Number.MAX_SAFE_INTEGER - i,
                    opening: 'fictional',
                    historicalOpening: 'fictional',
                  })
            }
            const session = {
              id: 'bundle',
              provider: 'claude' as const,
              sessionId: 'fictional-thread',
              cwd: directory,
              profileId: 'fictional',
              updatedAt: 1_700_000_000_000,
              createdAt: 1_700_000_000_000,
            }
            let began = performance.now()
            store.importSnapshot({ session, derivedThrough: 0, ledger })
            if (round >= 0)
              measurements.push({
                round,
                mode,
                kind: 'bundle',
                inputRows: size,
                watchers: mode === 'tracked' ? 8 : 0,
                elapsedMs: performance.now() - began,
              })
            expect(
              db.prepare("SELECT count(*) AS n FROM events WHERE session_id = 'bundle'").get(),
            ).toEqual({ n: size })
            store.adopt({ ...session, id: 'archive', sessionId: 'fictional-archive' })
            expect(
              await deriveLedger(store, 'archive', 'claude', linesOf(frames), {
                fallbackAt: session.createdAt,
              }),
            ).toBe('imported')
            began = performance.now()
            const outcome = await deriveLedger(store, 'archive', 'claude', linesOf(frames), {
              fallbackAt: session.createdAt,
              rebuild: true,
            })
            if (round >= 0)
              measurements.push({
                round,
                mode,
                kind: 'rebuild',
                inputRows: size,
                watchers: mode === 'tracked' ? 8 : 0,
                elapsedMs: performance.now() - began,
                outcome,
                projectedRows: db
                  .prepare(
                    `SELECT count(*) AS n FROM events WHERE session_id = 'archive'
              AND generation = (SELECT active FROM derived_generation WHERE session_id = 'archive')`,
                  )
                  .get(),
              })
            expect(outcome).toBe('imported')
          } finally {
            db.close()
          }
        }
      }
      if (evidence !== undefined)
        writeFileSync(evidence, JSON.stringify(measurements, null, 2) + '\n')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  },
  120_000,
)

const appendEvidence = process.env['BROBOT_WINDOW_LIVE_APPEND']
it.skipIf(appendEvidence === undefined)(
  'measures the full live append CPU path in paired rounds',
  () => {
    const directory = mkdtempSync(join(tmpdir(), 'fictional-live-append-'))
    const measurements: object[] = []
    try {
      for (let round = -1; round < 5; round++)
        for (const watchers of [0, 1, 8, 256]) {
          const modes =
            round % 2 ? (['tracked', 'plain'] as const) : (['plain', 'tracked'] as const)
          for (const mode of modes) {
            const db = openDatabase(join(directory, `${round}-${watchers}-${mode}.sqlite`))
            try {
              applyMigrations(db, migrations)
              const store = createSessionStore(db)
              store.create({
                id: 'alpha',
                provider: 'codex',
                cwd: directory,
                approvalMode: 'ask',
                profileId: 'fictional',
              })
              if (mode === 'tracked') {
                const sample = windowWriterSampler(db, () => true)
                for (let i = 0; i < watchers; i++)
                  sample({
                    kind: 'leads',
                    sessionId: 'alpha',
                    before: Number.MAX_SAFE_INTEGER - i,
                    opening: 'fictional',
                    historicalOpening: 'fictional',
                  })
              }
              const event = { type: 'assistant_message' as const, text: 'fictional streaming text' }
              db.transaction(() => {
                for (let i = 0; i < 100; i++) store.append('alpha', i, event, 1000 + i)
              })()
              const began = performance.now()
              db.transaction(() => {
                for (let i = 0; i < 1000; i++) store.append('alpha', 100 + i, event, 2000 + i)
              })()
              const elapsedMs = performance.now() - began
              if (round >= 0)
                measurements.push({
                  round,
                  mode,
                  watchers,
                  rows: 1000,
                  elapsedMs,
                  usPerRow: elapsedMs,
                })
            } finally {
              db.close()
            }
          }
        }
      if (appendEvidence !== undefined)
        writeFileSync(appendEvidence, JSON.stringify(measurements, null, 2) + '\n')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  },
  120_000,
)
