import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { ASKED_TO_STOP, stoppedBy } from '../src/shared/how-work-stopped'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import { composeReadable } from '../src/renderer/src/lib/readable-export'
import {
  THE_APPS_OWN_WORD,
  applyEvent,
  createTranscript,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # 🔴 725 · Draw 3 — R71: an ending THIS APP wrote is drawn as the app's word
 *
 * ⚑ **The ruling, verbatim** (`709` F-1, ruled by the PM): *"a stop the app forces is recorded as
 * the app's act (`wordOf: 'this-app'`), never as the provider's."* ⚑ `720` put the mark on the
 * machine's three own endings — `forceEnd` (a Claude Stop after its receipt, every Close),
 * `failTurn`, a fatal error's terminal — and on nothing a provider said. On `main` the renderer read
 * it nowhere: a marked and an unmarked ending drew the same bytes, *"turn interrupted"*.
 *
 * | § | what is drawn | 🔴 the subject | ⚑ the control, one fact over |
 * |---|---|---|---|
 * | 1 | the transcript's `turn …` notice | marked `interrupted` / `failed` gain {@link THE_APPS_OWN_WORD} | the same row unmarked stays exactly *turn interrupted* / *turn failed*; a cast foreign value draws nothing new |
 * | 2 | the Events tab's detail (`describeEvent`) | marked → *interrupted (ours)* | unmarked, and a foreign value → the state alone |
 * | 3 | the readable export | the marked notice's own line carries the clause | the unmarked line is the bare receipt |
 * | 4 | **the host path**, over the Fake runtime | a Close mid-turn: the ledger's own row is marked, and the fold of the ledger says so | a Stop of a live Fake turn — the double's own UNMARKED word — draws the bare receipt under its ask |
 *
 * ⚠️ **§4 is the one that is not a hand-built event.** A replayed payload is a cast
 * (`session-store.ts`'s `toPersistedEvents`), never re-parsed, so the drawing has to be read over
 * what the REAL machine wrote and the REAL store gave back — the mark is present because `forceEnd`
 * put it there, not because this file did. ⚑ Each arm asserts its premise off the ledger first
 * (the mark, or its absence), so a failed premise reads as a failed premise and never as a drawing.
 *
 * ⛔ **An UNMARKED ending gains nothing and is never called the provider's** — rows written before
 * `720` carry no mark whoever wrote them (`HO-029` §2.2, no backfill). Every control here pins the
 * unmarked bytes exactly, so a repair that labelled every ending would go red.
 *
 * ⚠️ The drawn half — the notice in a mounted pane, and that its clause is drawn whole — is
 * `test/dom/the-apps-own-ending-is-drawn.dom.test.ts`.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/* ================================================================ §1 · the notice */

const ev = (event: Record<string, unknown>): TranscriptEvent => event as unknown as TranscriptEvent

const foldOf = (events: readonly TranscriptEvent[]): TranscriptState => {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state
}

/** Every notice the fold wrote, in order, with its level — what the pane draws them from. */
const noticesOf = (state: TranscriptState): { level: string; text: string }[] =>
  state.items.flatMap((item) =>
    item.kind === 'notice' ? [{ level: item.level, text: item.text }] : [],
  )

const saidOf = (events: readonly TranscriptEvent[]): string[] =>
  noticesOf(foldOf(events)).map((one) => one.text)

describe('§1 · R71 — the `turn …` notice says whose word an ending is, when it is this app’s', () => {
  it('🔴 a marked `interrupted` reads the receipt AND the clause — one notice, still a warning', () => {
    const notices = noticesOf(
      foldOf([ev({ type: 'turn', state: 'interrupted', wordOf: 'this-app' })]),
    )
    expect(notices).toEqual([{ level: 'warn', text: `turn interrupted — ${THE_APPS_OWN_WORD}` }])
  })

  it('🔴 a marked `failed` (`failTurn`, a fatal terminal) reads the same clause', () => {
    expect(saidOf([ev({ type: 'turn', state: 'failed', wordOf: 'this-app' })])).toEqual([
      `turn failed — ${THE_APPS_OWN_WORD}`,
    ])
  })

  it('⚑ THE CONTROL — the same rows UNMARKED keep today’s bytes exactly, never called the provider’s', () => {
    // ⛔ Exact, not `not.toContain`: an unmarked row is a provider's word only from `720` on, so it
    // gains NOTHING — neither this clause nor a *provider's* one.
    expect(saidOf([ev({ type: 'turn', state: 'interrupted' })])).toEqual(['turn interrupted'])
    expect(saidOf([ev({ type: 'turn', state: 'failed' })])).toEqual(['turn failed'])
    expect(noticesOf(foldOf([ev({ type: 'turn', state: 'interrupted' })]))[0]?.level).toBe('warn')
  })

  it('⚑ a replayed payload is a CAST — any value but the one literal draws nothing new', () => {
    // ⚠️ `toPersistedEvents` hands back `JSON.parse(row.payload) as TranscriptEvent`, so a ledger
    // written by another build can carry anything here. ⛔ Only `'this-app'` is the mark.
    for (const wordOf of ['the-provider', true, 'This-App', '', 1, null]) {
      expect(saidOf([ev({ type: 'turn', state: 'interrupted', wordOf })]), String(wordOf)).toEqual([
        'turn interrupted',
      ])
    }
  })

  it('🔴 under a person’s Stop the ask stays the ASK, and the ending below it is the app’s', () => {
    // ⚑ The two rows a Claude Stop writes, in the order it writes them (`709` §3: the receipt beats
    // the result, so the recorded ending is the app's). ⛔ The clause names nobody who asked —
    // that is the row above it.
    expect(
      saidOf([
        ev({ type: 'user_turn', text: 'refactor the parser' }),
        ev({ type: 'work_interrupted', by: 'a-person' }),
        ev({ type: 'turn', state: 'interrupted', wordOf: 'this-app' }),
      ]),
    ).toEqual([
      `${ASKED_TO_STOP} by ${stoppedBy('a-person', null)}`,
      `turn interrupted — ${THE_APPS_OWN_WORD}`,
    ])
  })

  it('⚑ rule 5 — the clause, by name: this app’s word, and not the provider’s; it names no asker', () => {
    expect(THE_APPS_OWN_WORD).toMatch(/^this app’s word/)
    expect(THE_APPS_OWN_WORD).toContain('not the provider’s')
    // ⛔ It claims nothing about who asked or what the provider did (the tracer's risk list).
    expect(THE_APPS_OWN_WORD).not.toMatch(/\bby\b|stopped|asked|interrupted/)
    // ⚑ This app's curly apostrophe, never the straight byte.
    expect(THE_APPS_OWN_WORD).not.toContain("'")
  })
})

/* ================================================================ §2 · the Events tab */

describe('§2 · R71 — the Events tab’s detail: the panel’s own `(ours)`', () => {
  it('🔴 a marked ending is `(ours)` — we recorded it, nothing reported it', () => {
    expect(describeEvent(ev({ type: 'turn', state: 'interrupted', wordOf: 'this-app' }))).toBe(
      'interrupted (ours)',
    )
    expect(describeEvent(ev({ type: 'turn', state: 'failed', wordOf: 'this-app' }))).toBe(
      'failed (ours)',
    )
  })

  it('🔴 F080 · a turn its provider started says so, beside `(ours)` when this app wrote its ending', () => {
    expect(describeEvent(ev({ type: 'turn', state: 'completed', startedBy: 'the-provider' }))).toBe(
      'completed, a turn its provider started',
    )
    expect(
      describeEvent(
        ev({ type: 'turn', state: 'interrupted', wordOf: 'this-app', startedBy: 'the-provider' }),
      ),
    ).toBe('interrupted (ours), a turn its provider started')
    expect(describeEvent(ev({ type: 'provider_turn' }))).toBe('started by the provider')
  })

  it('⚑ THE CONTROL — unmarked, and a foreign value, are the state alone', () => {
    expect(describeEvent(ev({ type: 'turn', state: 'interrupted' }))).toBe('interrupted')
    expect(describeEvent(ev({ type: 'turn', state: 'completed' }))).toBe('completed')
    for (const wordOf of ['the-provider', true, '']) {
      expect(describeEvent(ev({ type: 'turn', state: 'failed', wordOf })), String(wordOf)).toBe(
        'failed',
      )
    }
  })
})

/* ================================================================ §3 · the readable export */

/** The export's lines that begin with the receipt — a notice's text is a line of its own. */
const receiptLines = (events: readonly TranscriptEvent[]): string[] =>
  composeReadable('x', foldOf(events).items, { toolActivity: false })
    .split('\n')
    .filter((line) => line.startsWith('turn '))

describe('§3 · R71 — the readable export carries the clause, because it is in the notice’s text', () => {
  it('🔴 a marked ending exports its clause, under the warning heading', () => {
    const events = [ev({ type: 'turn', state: 'interrupted', wordOf: 'this-app' })]
    expect(receiptLines(events)).toEqual([`turn interrupted — ${THE_APPS_OWN_WORD}`])
    expect(composeReadable('x', foldOf(events).items, { toolActivity: false })).toContain(
      'This app · warn',
    )
  })

  it('⚑ THE CONTROL — an unmarked ending exports the bare receipt', () => {
    expect(receiptLines([ev({ type: 'turn', state: 'interrupted' })])).toEqual(['turn interrupted'])
  })
})

/* ================================================================ §4 · the host path */

class AWindow implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  alive = true
  constructor(readonly ownerId: string) {}
  send(): void {}
  sendLiveness(): void {}
}

async function until(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('§4 · R71 over the real host — the mark the machine wrote is the one the fold reads', () => {
  let userData: string
  let db: AppDatabase
  let ledger: SessionStore
  let host: RuntimeHost
  let seq: number
  let theWindow: AWindow

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-725-r71-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    ledger = createSessionStore(db)
    const issued = new FakeProviderSessions()
    seq = 0
    theWindow = new AWindow('webContents:725')
    host = new RuntimeHost({
      store: ledger,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions: issued }),
      prepareProviderHome: (provider: Provider) => {
        const home = join(userData, 'provider-homes', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++seq}`,
      // ⚠️ Bounds on the MACHINE, not on the rule: nothing here waits on a real provider.
      interruptWaitMs: 40,
      closeDrainTimeoutMs: 40,
      readProviderConfig: (_provider, home) => ({
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
  })

  const eventsOf = (sessionId: string): TranscriptEvent[] =>
    ledger.events(sessionId).map((entry) => entry.event)

  /** ⚑ The replay path — the renderer's own fold over what the store hands back. */
  const replayed = (sessionId: string): TranscriptState => {
    const state = createTranscript()
    for (const entry of ledger.events(sessionId))
      applyEvent(state, entry.event, entry.at, entry.ordinal)
    return state
  }

  const receiptsOf = (sessionId: string): string[] =>
    noticesOf(replayed(sessionId))
      .map((one) => one.text)
      .filter((text) => text.startsWith('turn '))

  /** A conversation a person opened, parked mid-turn on the Fake's permission card. */
  const midTurn = async (): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', cwd: userData, approvalMode: 'ask' },
      theWindow,
    )
    await host.send(sessionId, 'a long piece of work', theWindow)
    await until(
      () => eventsOf(sessionId).some((event) => event.type === 'permission_request'),
      'the turn to park on its card',
    )
    return sessionId
  }

  const theEnding = (sessionId: string): TranscriptEvent & { type: 'turn' } => {
    const turn = eventsOf(sessionId).find((event) => event.type === 'turn')
    if (turn === undefined || turn.type !== 'turn') throw new Error('no terminal turn')
    return turn
  }

  it('🔴 a Close mid-turn: the ledger’s ending is this app’s, and the replayed notice says so', async () => {
    const sessionId = await midTurn()
    await host.close(sessionId, theWindow)
    await until(() => eventsOf(sessionId).some((e) => e.type === 'turn'), 'the forced terminal')
    // ⚑ THE PREMISE, off the ledger: `forceEnd` wrote it and marked it (`720`).
    const ending = theEnding(sessionId)
    expect(ending.state).toBe('interrupted')
    expect(ending.wordOf).toBe('this-app')
    // ⛔ …and a Close writes no ask (`how-work-stopped.ts`): nothing above it says who asked.
    expect(eventsOf(sessionId).some((e) => e.type === 'work_interrupted')).toBe(false)

    expect(receiptsOf(sessionId)).toEqual([`turn interrupted — ${THE_APPS_OWN_WORD}`])
    // ⚑ The same row, in the Events tab and in the export.
    expect(describeEvent(ending)).toBe('interrupted (ours)')
    const exported = composeReadable('x', replayed(sessionId).items, { toolActivity: false })
    expect(exported).toContain(`\nturn interrupted — ${THE_APPS_OWN_WORD}\n`)
  })

  it('⚑ THE CONTROL — a Stop of a live Fake turn: the double’s OWN word, unmarked, reads the bare receipt', async () => {
    const sessionId = await midTurn()
    await host.interrupt(sessionId, theWindow)
    await until(() => eventsOf(sessionId).some((e) => e.type === 'turn'), 'the provider’s terminal')
    // ⚑ THE PREMISE: the Fake's provider ended its turn in its own word (`fake-runtime.ts`,
    // `interrupt`: *"this double's provider ends the active turn `interrupted` in its own word"*).
    const ending = theEnding(sessionId)
    expect(ending.state).toBe('interrupted')
    expect(ending.wordOf).toBeUndefined()

    const said = noticesOf(replayed(sessionId)).map((one) => one.text)
    // ⚑ The ask is drawn as an ask (`709`), and the ending under it is the bare receipt.
    expect(said).toContain(`${ASKED_TO_STOP} by ${stoppedBy('a-person', null)}`)
    expect(receiptsOf(sessionId)).toEqual(['turn interrupted'])
    expect(describeEvent(ending)).toBe('interrupted')
  })
})
