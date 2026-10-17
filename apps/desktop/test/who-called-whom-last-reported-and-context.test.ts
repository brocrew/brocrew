import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { deriveLedger } from '../src/main/archive/derive-ledger'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import type { LastReported } from '../src/shared/who-called-whom'
import { linesOf } from './helpers/provider-lines'

/**
 * # 20f1a2a0 · feat(panel): who-called-whom says what each conversation last reported
 *
 * ⚑ The commit added `lastReported` to the who-called-whom answer: for every conversation the read
 * names, its model, its effort, and its newest context reading. ⛔ Its only test is one key name in
 * `who-called-whom.test.ts` §8 (`'lastReported'` in the key list). Nothing reads a value out of it.
 *
 *  - **§1 · which source wins** (`RuntimeHost.lastReportedOf`). The model is what the provider
 *    reported, else what it was set to run; the effort the same, on its own. Each value carries the
 *    word for where it came from, and a conversation this app holds no row for is left out.
 *    ⛔ Not reached by the devs' tests: no test sets `reported_model` beside `model` and reads the
 *    panel, so swapping the two arms, or letting the setting win the effort, changes no assertion.
 *    Effect of that defect: the panel shows a stopped sub-agent on the model it was set to, not the
 *    one its provider said it ran.
 *  - **§2 · the context reading and its cache** (`RuntimeHost.lastContextOf`). The first read looks
 *    only at the last 2,000 rows (`CONTEXT_LOOKBACK_ROWS`); a later read looks only at the rows
 *    written since and keeps what it found, while those rows are within the bound; a rebuilt ledger
 *    forgets the entry (`rebuildLedger`).
 *    ⛔ Not reached by the devs' tests: nothing writes a `context_reading` row and reads the panel,
 *    and no test rebuilds a ledger after a who-called-whom read. (`who-called-whom-as-generations`
 *    is a renderer-only test with no host, so the host harness of `who-called-whom.test.ts` and the
 *    archive planting of `derived-generation.test.ts` are copied here instead.)
 *
 * 🔒 The provider is a double, every directory is temporary and removed after each test, and no
 * provider home, HOME or app folder is touched.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')

const NOW = 1_800_000_000_000

/** Two Claude records that fold to a real conversation — copied from `derived-generation.test.ts`. */
const claudeFrames = (from: number, count: number): string[] =>
  Array.from({ length: count }, (_, index) =>
    JSON.stringify({
      type: index % 2 === 0 ? 'user' : 'assistant',
      timestamp: new Date(1_700_000_000_000 + (from + index) * 1_000).toISOString(),
      message: { content: `line ${String(from + index)}` },
    }),
  )

describe('20f1a2a0 · what each named conversation last reported', () => {
  let userData: string
  let workspace: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let clock: number
  /** The provider's own file the host finds, when a test plants one. */
  let providerFile: string | null

  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-last-reported-'))
    workspace = mkdtempSync(join(tmpdir(), 'brobot2-last-reported-cwd-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsDir)
    clock = NOW
    providerFile = null
    store = createSessionStore(db, tick)
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => providerFile,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_lr_${String(tick())}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  })

  /** A Codex conversation this app started, optionally started BY another and set to a model. */
  const conversation = (
    id: string,
    profileId: string,
    over: { parent?: string; model?: string; effort?: string } = {},
  ): string => {
    store.create({
      id,
      provider: 'codex',
      cwd: workspace,
      approvalMode: 'ask',
      profileId,
      ...(over.parent === undefined ? {} : { parentSessionId: over.parent }),
      ...(over.model === undefined ? {} : { model: over.model }),
      ...(over.effort === undefined ? {} : { reasoningEffort: over.effort }),
    })
    return id
  }

  /** What the who-called-whom read of `asked` says `about` last reported. */
  const reportedOf = (asked: string, about: string = asked): LastReported | undefined =>
    host.whoCalledWhom(asked).lastReported?.[about]

  /** `count` ordinary rows, appended after whatever the ledger already holds, in one commit. */
  const fill = (id: string, count: number): void => {
    const from = store.nextOrdinal(id)
    store.appendMany(
      id,
      Array.from({ length: count }, (_, index) => {
        const event: TranscriptEvent = {
          type: 'assistant_message',
          text: `filler ${String(index)}`,
        }
        return { ordinal: from + index, event, at: NOW + index }
      }),
    )
  }

  /** One context reading, appended as the ledger's next row, recorded at `at`. */
  const readingAt = (id: string, used: number, at: number): void => {
    const event: TranscriptEvent = {
      type: 'context_reading',
      reading: { kind: 'tokens', used },
      source: 'message_start',
    }
    store.append(id, store.nextOrdinal(id), event, at)
  }

  /* ═══════════════════════ §1 · which source wins, for model and for effort ═══════════════════════ */

  describe('§1 · `lastReportedOf` — the provider’s report, then the setting, then nothing', () => {
    it('🔴 ⛔ a reported model and effort win over the set ones — ⚑ a set-only row says its setting, a bare row says null', () => {
      const pm = conversation('sess_pm', 'project-manager')
      // ⛔ Both set AND reported: the report must win, for the model and for the effort.
      const reported = conversation('sess_reported', 'worker', {
        parent: pm,
        model: 'model-set',
        effort: 'low',
      })
      store.setReportedModel(reported, 'model-reported', 'high')
      // ⚑ Set only: the setting answers, and says so.
      const setOnly = conversation('sess_set_only', 'worker', {
        parent: pm,
        model: 'model-set',
        effort: 'medium',
      })
      // ⚑ The two chains are separate: a reported model with no reported effort keeps its set effort.
      const mixed = conversation('sess_mixed', 'worker', {
        parent: pm,
        model: 'model-set',
        effort: 'medium',
      })
      store.setReportedModel(mixed, 'model-reported', null)
      // ⚑ Neither: a Codex row is never asked of a transcript, so both are null with a null source.
      const bare = conversation('sess_bare', 'worker', { parent: pm })

      const read = host.whoCalledWhom(pm)
      const lastReported = read.lastReported ?? {}
      // ⚑ Every conversation the read names, once each — and the premise that all four are children.
      expect(read.children.rows.map((row) => row.conversation).sort()).toEqual(
        [bare, mixed, reported, setOnly].sort(),
      )
      expect(Object.keys(lastReported).sort()).toEqual([bare, mixed, pm, reported, setOnly].sort())

      // ⛔ Swapping the model arms answers 'model-set'/'its-setting' here; letting the setting win
      // the effort answers 'low'/'its-setting'.
      expect(lastReported[reported]).toEqual({
        model: 'model-reported',
        modelFrom: 'its-provider',
        effort: 'high',
        effortFrom: 'its-provider',
        context: null,
      })
      // ⚑ The control: the same setting, with no report, is what answers.
      expect(lastReported[setOnly]).toEqual({
        model: 'model-set',
        modelFrom: 'its-setting',
        effort: 'medium',
        effortFrom: 'its-setting',
        context: null,
      })
      expect(lastReported[mixed]).toEqual({
        model: 'model-reported',
        modelFrom: 'its-provider',
        effort: 'medium',
        effortFrom: 'its-setting',
        context: null,
      })
      expect(lastReported[bare]).toEqual({
        model: null,
        modelFrom: null,
        effort: null,
        effortFrom: null,
        context: null,
      })
    })

    it('⛔ a named conversation this app holds no row for is left out — ⚑ the one it does hold is in', () => {
      const child = conversation('sess_child', 'worker', { model: 'model-set', effort: 'low' })
      // A parent id no row holds — built the way `who-called-whom.test.ts` §1 builds it.
      db.pragma('foreign_keys = OFF')
      db.prepare(`UPDATE provider_session SET parent_session_id = ? WHERE id = ?`).run(
        'sess_ghost',
        child,
      )
      db.pragma('foreign_keys = ON')
      const read = host.whoCalledWhom(child)
      // ⚑ The premise: the read DOES name the ghost, so leaving it out is a decision, not an accident.
      expect(read.parent?.conversation).toBe('sess_ghost')
      // ⛔ No entry for it — and the read does not throw on it.
      expect(Object.keys(read.lastReported ?? {})).toEqual([child])
      expect(read.lastReported?.['sess_ghost']).toBeUndefined()
      // ⚑ The control: the conversation it holds a row for is there, with its setting.
      expect(read.lastReported?.[child]?.model).toBe('model-set')
      expect(read.lastReported?.[child]?.modelFrom).toBe('its-setting')
      // ⛔ And an id with no row at all answers an empty map.
      expect(host.whoCalledWhom('sess_nobody').lastReported).toEqual({})
    })
  })

  /* ═══════════════════ §2 · the context reading: the 2,000-row look-back and its cache ═══════════════════ */

  describe('§2 · `lastContextOf` — a bounded first read, a cache of what was found, forgotten on rebuild', () => {
    it('🔴 ⛔ a reading 2,090 rows back is not looked at on a first read — ⚑ one 1,950 rows back is, and one written later is found', () => {
      // ⛔ The reading at row 10 of 2,100: the first read looks at rows 100..2099 only.
      const far = conversation('sess_far', 'worker')
      fill(far, 10)
      readingAt(far, 111, NOW + 10_000)
      fill(far, 2_089)
      // ⚑ The control: the same ledger length, the reading at row 150 — inside the bound.
      const near = conversation('sess_near', 'worker')
      fill(near, 150)
      readingAt(near, 150, NOW + 20_000)
      fill(near, 1_949)

      // Ignoring the floor (`from`) finds the reading at row 10 here.
      expect(reportedOf(far)?.context).toBeNull()
      expect(reportedOf(near)?.context).toEqual({
        reading: { kind: 'tokens', used: 150 },
        at: NOW + 20_000,
      })

      // ⚑ A reading written after that first read is found by the next one (it is in the rows since).
      readingAt(far, 222, NOW + 30_000)
      expect(reportedOf(far)?.context).toEqual({
        reading: { kind: 'tokens', used: 222 },
        at: NOW + 30_000,
      })
    })

    it('🔴 ⚑ a reading found before still stands after exactly 2,000 rows with none — ⛔ after 2,001 it is a first read again', () => {
      // ⚑ Exactly 2,000 rows since: every one of them is inside the look-back, so nothing was missed
      // and the earlier reading still stands (`kept.through >= floor`, equal here).
      const exact = conversation('sess_exact', 'worker')
      readingAt(exact, 333, NOW + 40_000)
      expect(reportedOf(exact)?.context).toEqual({
        reading: { kind: 'tokens', used: 333 },
        at: NOW + 40_000,
      })
      fill(exact, 2_000)
      // Turning `>=` into `>` makes this a first read from the floor, which is one row past the
      // reading — and it answers null.
      expect(reportedOf(exact)?.context).toEqual({
        reading: { kind: 'tokens', used: 333 },
        at: NOW + 40_000,
      })

      // ⛔ One row more and the rows since are past the bound: a first read again, which does not
      // reach the old reading.
      const past = conversation('sess_past', 'worker')
      readingAt(past, 444, NOW + 50_000)
      expect(reportedOf(past)?.context).toEqual({
        reading: { kind: 'tokens', used: 444 },
        at: NOW + 50_000,
      })
      fill(past, 2_001)
      expect(reportedOf(past)?.context).toBeNull()
    })

    it('🔴 ⛔ a rebuilt ledger does not show the old generation’s reading — ⚑ it showed before, and a new one shows after', async () => {
      // A Claude conversation brought in from its provider's file, its ledger derived from it — as
      // `derived-generation.test.ts` plants one.
      const SESSION = 'sess_derived'
      store.adopt({
        id: SESSION,
        provider: 'claude',
        sessionId: 'thread-planted',
        cwd: workspace,
        profileId: 'default',
        updatedAt: 1_700_000_000_000,
        createdAt: 1_700_000_000_000,
      })
      providerFile = join(workspace, 'thread-planted.jsonl')
      writeFileSync(providerFile, `${claudeFrames(0, 6).join('\n')}\n`)
      expect(
        await deriveLedger(store, SESSION, 'claude', linesOf(claudeFrames(0, 6)), {
          fallbackAt: NOW,
        }),
      ).toBe('imported')
      // A reading this app wrote into that ledger — a rebuild from the file does not keep it.
      readingAt(SESSION, 555, NOW + 60_000)
      // ⚑ The control: before the rebuild, the read shows it (and caches it).
      expect(reportedOf(SESSION)?.context).toEqual({
        reading: { kind: 'tokens', used: 555 },
        at: NOW + 60_000,
      })
      const before = store.nextOrdinal(SESSION)

      // The file grows, so the new generation is longer than the old one.
      appendFileSync(providerFile, `${claudeFrames(6, 40).join('\n')}\n`)
      const rebuilt = await host.rebuildLedger(SESSION)
      expect(rebuilt.outcome).toBe('imported')
      // The premises the defect needs: the new generation holds no reading, and is at least as long
      // as the old one — so a kept entry would be trusted (returned as is, or used as `since`).
      expect(store.newestOfType?.(SESSION, 'context_reading') ?? null).toBeNull()
      expect(
        store.nextOrdinal(SESSION),
        'the rebuilt generation is at least as long as the one read before',
      ).toBeGreaterThanOrEqual(before)

      // ⛔ Without `contextAsLastRead.delete`, the old generation's 555 comes back here.
      expect(reportedOf(SESSION)?.context).toBeNull()
      // ⚑ And a reading written into the new generation is found.
      readingAt(SESSION, 666, NOW + 70_000)
      expect(reportedOf(SESSION)?.context).toEqual({
        reading: { kind: 'tokens', used: 666 },
        at: NOW + 70_000,
      })
    })
  })
})
