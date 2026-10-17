import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppDatabase } from '../src/main/db/connection'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { composeReadable } from '../src/renderer/src/lib/readable-export'
import {
  acceptEvent,
  createSessionRecord,
  type SessionRecord,
} from '../src/renderer/src/lib/session-record'
import {
  applyEvent,
  createTranscript,
  markReopened,
  type TranscriptItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import { isVisibleIn } from '../src/renderer/src/lib/transcript-mode'
import {
  WINDOW_MAX_EVENTS,
  carryForward,
  foldWindow,
} from '../src/renderer/src/lib/transcript-window'
import { ASKED_TO_STOP, WHO_STOPPED_IT, stoppedBy } from '../src/shared/how-work-stopped'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  aHostOverScriptedCodex,
  waitFor,
  Window,
  type ScriptedAppServer,
} from './lib/scripted-codex-host'

/** ⚑ A notice as the fold hands it out — the item, placed and timed. */
type NoticeItem = Extract<TranscriptItem, { kind: 'notice' }>

/**
 * # 🔴 730 · Draw 3 — a Stop the provider has not answered, SAID in the conversation (the fold)
 *
 * ⚑ **The ruling, verbatim** (`730` §1):
 *
 *  - **R83** — *"A Stop the provider does not answer is said (Codex has not answered the stop), and
 *    a second press joins the first ask instead of queuing another."*
 *
 * ⚑ **Main's half is `723`'s** and is the premise here, never re-built: the host writes
 * `stop_unanswered { waitedMs, by, agent?, agentProfile? }` (the last since `734`) once per ask when its bound passes with the ask
 * unanswered and the turn still running, and a person's Stop while that ask stands asks nothing
 * new (`RuntimeHost.interrupt` joins it) — `a-stop-codex-does-not-answer-is-said.test.ts`. ⚑ What
 * `730` added is the WORDS and the fact the Stop control reads, and this file is the fold's half:
 *
 * | § | what | 🔴 subject (RED on `main` b9b1a4fc) | ⚑ control, one fact over (green on both) |
 * |---|---|---|---|
 * | 0 | the real host's rows, through the renderer's one door | a Stop Codex never answers → ONE warn notice and the fact standing; a JOINED press changes neither | a Codex that answers → no such notice, nothing standing |
 * | 1 | the fold | the notice says *"The provider has not answered the stop asked for by a person"* — no provider named, even over a Codex `ref` — and holds the facts | the same rows without `stop_unanswered` |
 * | 1 | the asker | *an agent* — never the `sess_` handle the row carries; every asker by its kind | — |
 * | 2 | the three clears | the next `turn`, a newer ask, a reopen each let go of the fact; the notice stays as history | the `turn` row's own notice is the same words with or without the fact |
 * | 3 | a window release | the fact survives a release whose released prefix held its row | a `turn` after it → nothing standing; the retained rows alone never say it |
 * | 4 | the readable export | prints the fold's provider-less sentence, as `This app · warn` | the ask's own line is printed on both trees |
 *
 * ⚠️ **What `main` does instead.** On b9b1a4fc `transcript.ts`' `case 'stop_unanswered'` is a bare
 * `return`: no item, and `TranscriptState` has no `stopUnanswered` (so it reads `undefined`), and
 * `FoldCarry` carries nothing for it. ⚑ So every 🔴 below fails on `main` on its own assertion.
 *
 * ⚠️ **`lib/stop-unanswered.ts` is a NEW module**, so it is imported only INSIDE subjects, through a
 * dynamic `import()` — the node project lets a missing module fail the arm that asks for it, never
 * the file (Vite's SSR import analysis leaves an unresolved specifier to the runner), and the
 * controls run on `main`. ⚑ A control that reads the new state reads it as `?? null`: *nothing
 * standing* is the claim, and `main`'s `undefined` is that claim too.
 */

const AT = 1_700_000_000_000

/** ⚑ The new module — read inside subjects only (see the header). */
const since730 = (): Promise<typeof import('../src/renderer/src/lib/stop-unanswered')> =>
  import('../src/renderer/src/lib/stop-unanswered')

/** ⚑ R83's sentence with the provider unknown, verbatim ONCE — rule 5 pins it by function below. */
const THE_PROVIDER_HAS_NOT_ANSWERED = 'The provider has not answered the stop asked for by a person'

/** ⚑ A Codex conversation's `ref` — the fold KNOWS the provider, and still names none. */
const CODEX_REF = { provider: 'codex' as const, sessionId: 'th_1', cwd: '/work', rotation: 0 }

const started = { type: 'session', state: 'started', ref: CODEX_REF } as TranscriptEvent
const asked = { type: 'user_turn', text: 'count to sixty' } as TranscriptEvent
const working = { type: 'status', state: 'working' } as TranscriptEvent
const aPersonsAsk: TranscriptEvent = { type: 'work_interrupted', by: 'a-person' }
/** ⚑ The row as the host writes it at its default bound (`DEFAULT_INTERRUPT_WAIT_MS`). */
const unanswered: TranscriptEvent = { type: 'stop_unanswered', waitedMs: 2_000, by: 'a-person' }
const theTurnEnds = { type: 'turn', state: 'interrupted' } as TranscriptEvent

/** ⚑ Folded by the real fold, one row at a time, as the live stream does. */
function folded(...events: TranscriptEvent[]): TranscriptState {
  const state = createTranscript()
  events.forEach((event, index) => applyEvent(state, event, AT + index * 1_000))
  return state
}

const notices = (items: readonly TranscriptItem[]): NoticeItem[] =>
  items.filter((item): item is NoticeItem => item.kind === 'notice')

/** ⚑ The notices that say R83's words — found by the words, so a control can count none. */
const saysUnanswered = (items: readonly TranscriptItem[]): NoticeItem[] =>
  notices(items).filter((one) => one.text.includes('has not answered the stop'))

/** ⚑ The one R83 notice, asserted to exist — a lookup that returns nothing is a vacuous test. */
function theNotice(items: readonly TranscriptItem[]): NoticeItem {
  const found = saysUnanswered(items)
  expect(found, 'the fold drew no notice for `stop_unanswered`').toHaveLength(1)
  return found[0]!
}

/** ⚑ What the Stop control reads — `undefined` on `main`, which has no such field. */
const standing = (state: TranscriptState): unknown =>
  (state as { stopUnanswered?: unknown }).stopUnanswered

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §0 · the real host's rows, through the renderer's one door
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** ⚑ Short: the host's own bound, as `a-stop-codex-does-not-answer-is-said.test.ts` sets it. */
const INTERRUPT_WAIT_MS = 40

describe('§0 · what the host writes for a Stop Codex never answers, folded through `acceptEvent`', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let host: RuntimeHost
  let servers: ScriptedAppServer[]
  const window = new Window('webContents:1')

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-730-stop-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-730-stop-root-'))
    window.messages.length = 0
    ;({ host, db, servers } = aHostOverScriptedCodex(userData, {
      interruptWaitMs: INTERRUPT_WAIT_MS,
    }))
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /** ⚑ A Codex conversation with a turn Codex is RUNNING — `723`'s own rig. */
  const aRunningTurn = async (): Promise<{ id: string; server: ScriptedAppServer }> => {
    const { sessionId: id } = await host.createSession(
      { provider: 'codex', approvalMode: 'ask', cwd: root },
      window,
    )
    const server = servers.at(-1)
    if (server === undefined) throw new Error('no app-server was opened')
    await host.send(id, 'count to sixty', window)
    await waitFor(() => server.sent('turn/start').length === 1, 'the first turn')
    await new Promise((resolve) => setTimeout(resolve, 20))
    return { id, server }
  }

  const pastTheBound = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, INTERRUPT_WAIT_MS * 3))

  /**
   * ⚑ **Every message the window was sent, cloned as the IPC channel clones it, through the
   * renderer's one door** — the record a pane draws, never a hand-set state.
   */
  function theWindowsRecord(id: string): SessionRecord {
    const record = createSessionRecord(id)
    const mine = window.messages.filter((message) => message.sessionId === id)
    expect(mine.length, 'the window was sent nothing').toBeGreaterThan(0)
    expect(mine[0]!.ordinal, 'the window missed the conversation’s first rows').toBe(0)
    for (const message of mine) acceptEvent(record, structuredClone(message))
    return record
  }

  it('🔴 a Stop Codex never answers → ONE warn notice in the provider-less words, and the fact standing', async () => {
    const { id, server } = await aRunningTurn()
    server.interruptAnswer = 'never'
    await host.interrupt(id, window)
    await pastTheBound()
    const record = theWindowsRecord(id)
    // ⚑ The premise, off what the host sent: a Codex conversation, still running, asked once.
    expect(record.control.ref?.provider).toBe('codex')
    expect(record.control.ended).toBe(false)
    expect(notices(record.control.items).map((one) => one.text)).toContain(
      `${ASKED_TO_STOP} by ${stoppedBy('a-person', null)}`,
    )
    // ⛔ On `main` the fold drew nothing for the row: the ask's line, and then silence.
    const notice = theNotice(record.control.items)
    expect(notice.level).toBe('warn')
    expect(notice.text).toBe(THE_PROVIDER_HAS_NOT_ANSWERED)
    expect(notice.stopUnanswered).toEqual({ waitedMs: INTERRUPT_WAIT_MS, by: 'a-person' })
    expect(standing(record.control)).toEqual({ waitedMs: INTERRUPT_WAIT_MS, by: 'a-person' })
    const { stopUnansweredSays } = await since730()
    expect(notice.text).toBe(
      stopUnansweredSays({ waitedMs: INTERRUPT_WAIT_MS, by: 'a-person' }, null),
    )
  })

  it('🔴 a JOINED press (R83’s second press) changes nothing on screen — one ask, one notice, the fact still standing', async () => {
    const { id, server } = await aRunningTurn()
    server.interruptAnswer = 'never'
    await host.interrupt(id, window)
    await pastTheBound()
    // ⚑ The second press, joined: the host asks nothing new (`723` §2). ⚠️ This rig calls
    // `host.interrupt` directly, so no row is written for it at all — the `user_command` breadcrumb
    // is `ipc.ts`'s, before that call, and draws nothing in the transcript either.
    await host.interrupt(id, window)
    await pastTheBound()
    expect(server.sent('turn/interrupt')).toHaveLength(1)
    const record = theWindowsRecord(id)
    const asks = notices(record.control.items).filter((one) =>
      one.text.startsWith(`${ASKED_TO_STOP} by `),
    )
    expect(asks).toHaveLength(1)
    theNotice(record.control.items)
    expect(standing(record.control)).toEqual({ waitedMs: INTERRUPT_WAIT_MS, by: 'a-person' })
  })

  it('⚑ THE CONTROL — a Codex that answers and ends the turn: the ask, the ending, no such notice and nothing standing', async () => {
    const { id, server } = await aRunningTurn()
    server.interruptAnswer = 'answers'
    await host.interrupt(id, window)
    await waitFor(
      () => window.messages.some((message) => message.event.type === 'turn'),
      'Codex’s ending',
    )
    await pastTheBound()
    const record = theWindowsRecord(id)
    // ⚑ …and it is a conversation that drew the ask — the negative sits beside what it does hold.
    expect(notices(record.control.items).map((one) => one.text)).toContain(
      `${ASKED_TO_STOP} by ${stoppedBy('a-person', null)}`,
    )
    expect(saysUnanswered(record.control.items)).toEqual([])
    expect(standing(record.control) ?? null).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the fold — the notice, its words, and the fact the Stop control reads
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · `stop_unanswered` is a warn notice in R83’s words, and a fact while it stands', () => {
  it('🔴 one new item: a warn notice saying *The provider has not answered the stop asked for by a person*, holding the facts', async () => {
    const before = folded(started, asked, working, aPersonsAsk)
    const state = folded(started, asked, working, aPersonsAsk, unanswered)
    // ⚑ The premise: the fold KNOWS this is Codex — and the sentence still names no provider,
    // because the fold's text is what a reader with no provider prints (the export, a reading pane).
    expect(state.ref?.provider).toBe('codex')
    expect(state.items).toHaveLength(before.items.length + 1)
    const notice = state.items.at(-1)
    expect(notice?.kind).toBe('notice')
    expect(notice).toEqual(theNotice(state.items))
    const said = theNotice(state.items)
    expect(said.level).toBe('warn')
    expect(said.text).toBe(THE_PROVIDER_HAS_NOT_ANSWERED)
    expect(said.text).not.toContain('Codex')
    // ⚑ The facts, deep — and no `agent` key for a person's ask (the row carries none).
    expect(said.stopUnanswered).toEqual({ by: 'a-person', waitedMs: 2_000 })
    expect(said.stopUnanswered !== undefined && 'agent' in said.stopUnanswered).toBe(false)
    expect(standing(state)).toEqual({ by: 'a-person', waitedMs: 2_000 })
    // ⚑ Stamped like every other item, and after the ask it is about.
    expect(said.at).toBe(AT + 4_000)
    const texts = notices(state.items).map((one) => one.text)
    expect(texts.indexOf(`${ASKED_TO_STOP} by a person`)).toBeGreaterThan(-1)
    expect(texts.indexOf(`${ASKED_TO_STOP} by a person`)).toBeLessThan(
      texts.indexOf(THE_PROVIDER_HAS_NOT_ANSWERED),
    )
    // ⚑ A warn notice — the reading view keeps it (an `info` one would be dropped there).
    expect(isVisibleIn('normal', said)).toBe(true)
    // ⚑ rule 5 — the words are the module's, not this file's.
    const { stopUnansweredSays } = await since730()
    expect(said.text).toBe(stopUnansweredSays({ by: 'a-person', waitedMs: 2_000 }, null))
  })

  it('⚑ THE CONTROL — the same rows without `stop_unanswered`: the ask’s line, no such notice, nothing standing', () => {
    const state = folded(started, asked, working, aPersonsAsk)
    expect(saysUnanswered(state.items)).toEqual([])
    expect(standing(state) ?? null).toBeNull()
    // ⚑ …and it is a fold that drew the ask — the negative sits beside what it does hold.
    expect(notices(state.items).at(-1)?.text).toBe(
      `${ASKED_TO_STOP} by ${stoppedBy('a-person', null)}`,
    )
  })

  it('🔴 the fact stands while the turn runs — the provider’s own rows do not let go of it', () => {
    const state = folded(
      started,
      asked,
      working,
      aPersonsAsk,
      unanswered,
      { type: 'assistant_message', text: 'forty-one, forty-two' } as TranscriptEvent,
      { type: 'activity', phase: 'tool', detail: 'Bash' } as TranscriptEvent,
      working,
    )
    expect(standing(state)).toEqual({ by: 'a-person', waitedMs: 2_000 })
    theNotice(state.items)
  })

  it('🔴 an agent’s ask is said as *an agent* — never the `sess_` handle the row carries, which the fact keeps', async () => {
    const byAnAgent: TranscriptEvent = {
      type: 'work_interrupted',
      by: 'an-agent',
      agent: 'sess_abc',
    }
    const agentsUnanswered: TranscriptEvent = {
      type: 'stop_unanswered',
      waitedMs: 2_000,
      by: 'an-agent',
      agent: 'sess_abc',
    }
    const state = folded(started, asked, working, byAnAgent, agentsUnanswered)
    const said = theNotice(state.items)
    expect(said.text).toBe('The provider has not answered the stop asked for by an agent')
    expect(said.text).not.toContain('sess_')
    // ⚑ The handle is not thrown away — it is kept as a fact, and never drawn.
    expect(said.stopUnanswered).toEqual({ by: 'an-agent', waitedMs: 2_000, agent: 'sess_abc' })
    expect(standing(state)).toEqual({ by: 'an-agent', waitedMs: 2_000, agent: 'sess_abc' })
    // 🔴 **737 · `724` F-3 / `732` F-4 — and the ask's own line above it says the category too**: it
    // was `main`'s *"asked to stop by sess_abc"* (`stoppedBy('an-agent', 'sess_abc')`).
    expect(notices(state.items).map((one) => one.text)).toContain(
      `${ASKED_TO_STOP} by ${stoppedBy('an-agent', null)}`,
    )
    expect(
      notices(state.items)
        .map((one) => one.text)
        .join('\n'),
    ).not.toContain('sess_abc')
    const { stopUnansweredSays } = await since730()
    expect(said.text).toBe(stopUnansweredSays({ by: 'an-agent', waitedMs: 2_000 }, null))
  })

  it('🔴 every asker the row can carry is said by its KIND, through `stoppedBy` with no handle', async () => {
    const said = WHO_STOPPED_IT.map((by) => {
      const agent = by === 'an-agent' ? { agent: 'sess_zz' } : {}
      const state = folded(started, asked, working, {
        type: 'stop_unanswered',
        waitedMs: 2_000,
        by,
        ...agent,
      })
      return { by, text: theNotice(state.items).text }
    })
    // ⚑ The loop is not empty, and it holds the two askers the ruling is about.
    expect(said.map((one) => one.by)).toEqual(expect.arrayContaining(['a-person', 'an-agent']))
    for (const { by, text } of said) {
      expect(text, by).toBe(
        `The provider has not answered the stop asked for by ${stoppedBy(by, null)}`,
      )
      expect(text, by).not.toContain('sess_')
    }
    // ⚑ rule 5 — by the module's function, after the drawing (so `main` fails on the drawing).
    const { stopUnansweredSays } = await since730()
    for (const { by, text } of said) {
      expect(text, by).toBe(stopUnansweredSays({ by, waitedMs: 2_000 }, null))
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · the three clears — where the host stops joining
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · the fact is let go where the host lets go of the ask; the notice stays as history', () => {
  /** ⚑ The premise every clear starts from — asserted, so a clear on `main` is not read off nothing. */
  function standingAsk(): TranscriptState {
    const state = folded(started, asked, working, aPersonsAsk, unanswered)
    expect(standing(state), 'the fold holds no standing ask to clear').toEqual({
      by: 'a-person',
      waitedMs: 2_000,
    })
    return state
  }

  it('🔴 the next `turn` row ends it — nothing standing, and the notice is still in the conversation', () => {
    const state = standingAsk()
    applyEvent(state, theTurnEnds, AT + 9_000)
    expect(standing(state)).toBeNull()
    theNotice(state.items)
    // ⚑ The turn's own ending is drawn after it, as on `main`.
    expect(notices(state.items).at(-1)?.text).toBe('turn interrupted')
  })

  it('⚑ THE CONTROL — the `turn` row’s own notice is the same words with or without a standing ask', () => {
    const without = folded(started, asked, working, aPersonsAsk, theTurnEnds)
    expect(notices(without.items).at(-1)?.text).toBe('turn interrupted')
    expect(standing(without) ?? null).toBeNull()
    expect(saysUnanswered(without.items)).toEqual([])
  })

  it('🔴 a NEWER ask ends it — nobody has waited on that one yet; its own line says the asker by its category (737)', () => {
    const state = standingAsk()
    applyEvent(state, { type: 'work_interrupted', by: 'an-agent', agent: 'sess_pm' }, AT + 9_000)
    expect(standing(state)).toBeNull()
    // ⚑ **737** — it was `main`'s *"asked to stop by sess_pm"*; the transcript names it with the roster.
    expect(notices(state.items).at(-1)?.text).toBe(
      `${ASKED_TO_STOP} by ${stoppedBy('an-agent', null)}`,
    )
    theNotice(state.items)
    // ⚑ …and when THAT ask goes unanswered too, the fact is the newer ask's — the newest wins.
    applyEvent(
      state,
      { type: 'stop_unanswered', waitedMs: 2_000, by: 'an-agent', agent: 'sess_pm' },
      AT + 12_000,
    )
    expect(standing(state)).toEqual({ by: 'an-agent', waitedMs: 2_000, agent: 'sess_pm' })
    expect(saysUnanswered(state.items).map((one) => one.text)).toEqual([
      THE_PROVIDER_HAS_NOT_ANSWERED,
      'The provider has not answered the stop asked for by an agent',
    ])
  })

  it('🔴 a reopen ends it — a new life asks afresh; the notice is history', () => {
    const state = standingAsk()
    markReopened(state)
    expect(standing(state)).toBeNull()
    theNotice(state.items)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · a window release — `FoldCarry` is hand-written
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · the fact survives a window release whose released prefix held its row', () => {
  const SESSION = 'sess_730'
  const message = (ordinal: number, event: TranscriptEvent): RuntimeEventMessage => ({
    sessionId: SESSION,
    ordinal,
    at: AT + ordinal * 1_000,
    event,
  })

  /** ⚑ Rows through the one door, from ordinal 0 — the live path, never a hand-set state. */
  function live(...events: TranscriptEvent[]): SessionRecord {
    const record = createSessionRecord(SESSION)
    for (const event of events) acceptEvent(record, message(record.nextOrdinal, event))
    return record
  }

  /** ⚑ Codex keeps streaming until the window has genuinely released a slab. */
  function overflow(record: SessionRecord): SessionRecord {
    for (let i = 0; i < WINDOW_MAX_EVENTS + 10; i++) {
      acceptEvent(
        record,
        message(record.nextOrdinal, { type: 'assistant_message', text: `reply ${i}` }),
      )
    }
    return record
  }

  /** ⚑ The row is GONE from the window — the release really took it. */
  function released(record: SessionRecord, ordinal: number): void {
    expect(record.window.hasOlder, 'the window never released a slab').toBe(true)
    expect(record.window.entries[0]!.ordinal).toBeGreaterThan(ordinal)
    expect(record.window.entries.some((entry) => entry.event.type === 'stop_unanswered')).toBe(
      false,
    )
  }

  it('🔴 at the tail: the notice left with its slab, and the fact the Stop control reads did not', () => {
    const record = overflow(live(started, asked, working, aPersonsAsk, unanswered))
    released(record, 4)
    // ⚑ The notice was history and went with the slab — the fact is state and stays.
    expect(saysUnanswered(record.control.items)).toEqual([])
    expect(standing(record.control)).toEqual({ by: 'a-person', waitedMs: 2_000 })
    expect(record.control.status).toBe('working')
  })

  it('⚑ THE CONTROL — a `turn` after it: after the same release nothing stands', () => {
    const record = overflow(live(started, asked, working, aPersonsAsk, unanswered, theTurnEnds))
    released(record, 4)
    expect(standing(record.control) ?? null).toBeNull()
  })

  it('⚑ THE CONTROL — the retained rows ALONE never say it, so the carry is what does', () => {
    const record = overflow(live(started, asked, working, aPersonsAsk, unanswered))
    released(record, 4)
    expect(standing(foldWindow(record.window.entries, record.liveFrom)) ?? null).toBeNull()
  })

  it('🔴 `carryForward` takes it and `foldWindow` puts it back — the hand-written carry, by name', () => {
    const state = folded(started, asked, working, aPersonsAsk, unanswered)
    const carry = carryForward(state, [])
    expect((carry as { stopUnanswered?: unknown }).stopUnanswered).toEqual({
      by: 'a-person',
      waitedMs: 2_000,
    })
    expect(standing(foldWindow([], null, carry))).toEqual({ by: 'a-person', waitedMs: 2_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · the readable export — a reader with no provider
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · the readable export prints the fold’s own sentence', () => {
  it('🔴 a `This app · warn` block with *The provider has not answered the stop asked for by a person*', () => {
    const state = folded(started, asked, working, aPersonsAsk, unanswered)
    const md = composeReadable('x', state.items, { toolActivity: false })
    expect(md).toContain(THE_PROVIDER_HAS_NOT_ANSWERED)
    expect(md.split(THE_PROVIDER_HAS_NOT_ANSWERED)).toHaveLength(2)
    const blocks = md.split('\n\n')
    const at = blocks.findIndex((block) => block.includes(THE_PROVIDER_HAS_NOT_ANSWERED))
    // ⚑ Its heading is the block before it — `This app · warn`, the reading view's own level.
    expect(at).toBeGreaterThan(0)
    expect(blocks[at - 1]).toContain('This app · warn')
    expect(md).not.toContain('Codex has not answered')
  })

  it('⚑ THE CONTROL — the ask’s own line is printed on both trees', () => {
    const state = folded(started, asked, working, aPersonsAsk, unanswered)
    const md = composeReadable('x', state.items, { toolActivity: false })
    expect(md).toContain(`${ASKED_TO_STOP} by ${stoppedBy('a-person', null)}`)
    expect(md).toContain('This app · warn')
  })
})
