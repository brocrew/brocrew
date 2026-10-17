import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { normalizeMessage } from '../../../packages/runtime/src/claude/normalize'
import { normalizeNotification } from '../../../packages/runtime/src/codex/normalize'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import {
  applyEvent,
  createTranscript,
  receiptOf,
  toldClause,
  type NoticeItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import { composeReadable } from '../src/renderer/src/lib/readable-export'
import type { ToolRefusedEvent, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # 🔴 685 · §2.1 — the act a refusal carries, on the notice a person reads (`675` F-d)
 *
 * ⚑ **`675` put the act inside the receipt's first 200 characters** — *"list_agents names the ones
 * you can reach"* — and the `tool_refused` notice still printed a rule name and two clauses: the act
 * was on the folded tool row and nowhere loud. ⛔ The row carries no sentence by design
 * (`ToolRefusedEvent`), so the notice now QUOTES what the call was told, joined to that call's own
 * receipt by content and by count (`transcript.ts`' `tellItsRefusal`).
 *
 * ⚑ **Real host, real ledger, real rail, real toolset — and each provider's REAL normalizer makes
 * the receipt**, so the cut the notice reads is the cut a person's transcript gets, not one this file
 * re-spelled. Every positive is paired with a planted control whose ONE difference is named.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * Use `answer_question`’s `no-question-by-that-name` refusal: the call remains a tool row
 * that crosses the cut with its act inside. A `give_work` call is its own card and prints its
 * receipt, so it no longer exercises this row behavior. `the-act-inside-the-cut.test.ts`
 * covers the same property.
 */
const ANSWER_ACT = 'list_questions names the requests you can answer'

const ev = (event: Record<string, unknown>): TranscriptEvent => event as unknown as TranscriptEvent

/** ⚑ Each provider's own spelling of this app's tools — Claude's `mcp__` and Codex's namespace. */
const CLAUDE_NAMING = { prefix: 'mcp__', separator: '__' }
const CODEX_NAMING = { prefix: '', separator: '__' }
const inventory = (naming: { prefix: string; separator: string }, server = 'brobot') =>
  ev({
    type: 'tool_inventory',
    naming,
    declared: {
      server,
      tools: ['give_work', 'message_agent', 'answer_question'].map((name) => ({
        name,
        description: '',
        parameters: [],
      })),
    },
    published: null,
  })

/** Current prose-only receipt; policy data is kept on the separate refusal row. */
function claudeReceipt(id: string, text: string, _json: unknown): TranscriptEvent {
  void _json
  const rows = normalizeMessage({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          content: [{ type: 'text', text }],
        },
      ],
    },
  } as never)
  const result = rows.find((one) => one.type === 'tool_result')
  if (result === undefined) throw new Error('the Claude normalizer made no receipt')
  return result as unknown as TranscriptEvent
}

/** What the Codex adapter hands back — a `dynamicToolCall` whose first content item is the prose. */
function codexReceipt(id: string, tool: string, text: string, _json: unknown): TranscriptEvent {
  void _json
  const rows = normalizeNotification('item/completed', {
    item: {
      type: 'dynamicToolCall',
      id,
      namespace: 'brobot',
      tool,
      arguments: {},
      status: 'completed',
      contentItems: [{ type: 'inputText', text }],
      success: true,
      durationMs: 3,
    },
    threadId: 'th_685',
    turnId: 'tn_685',
  })
  const result = rows.find((one) => one.type === 'tool_result')
  if (result === undefined) throw new Error('the Codex normalizer made no receipt')
  return result as unknown as TranscriptEvent
}

/** ⚑ The refusal notices only — a turn's own ending draws a notice of its own. */
const notices = (state: TranscriptState): NoticeItem[] =>
  state.items.filter(
    (item): item is NoticeItem => item.kind === 'notice' && item.text.startsWith('refused: '),
  )

/** The one refusal notice the fold drew — and a failure, loudly, when it drew any other number. */
function theNotice(state: TranscriptState): NoticeItem {
  const drawn = notices(state)
  expect(drawn).toHaveLength(1)
  return drawn[0] as NoticeItem
}

describe('685 §2.1 · the act a refusal carries, on its notice', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let counter: number
  let clock: number

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-685-act-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-685-act-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 3_000_000
    store = createSessionStore(db, () => clock++)
    counter = 0
    const sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: () => new FakeRuntime('claude', { sessions }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: () => clock++,
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
    rmSync(work, { recursive: true, force: true })
  })

  const sink: RuntimeEventSink = {
    ownerId: 'webContents:1',
    aPersonIsBehindIt: false,
    alive: true,
    send: () => {},
    sendLiveness: () => {},
  }

  const opens = async (profileId: string): Promise<string> =>
    (
      await host.createSession(
        { provider: 'claude', profileId, cwd: work, approvalMode: 'ask' },
        sink,
      )
    ).sessionId

  /** One real call through the real toolset: its text, its payload, and the row the host wrote. */
  async function refusedCall(
    sessionId: string,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<{ text: string; json: unknown; row: ToolRefusedEvent }> {
    const tool = agentToolsFor(host, sessionId).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const answered = await tool.call(args)
    const rows = store
      .events(sessionId)
      .map((one) => one.event)
      .filter((one): one is ToolRefusedEvent => one.type === 'tool_refused')
    const row = rows[rows.length - 1]
    if (row === undefined) throw new Error(`${name} recorded no refusal`)
    return { text: answered.text, json: answered.structured, row }
  }

  /**
   * `pm` answers a question nobody asked it — `no-question-by-that-name`, a rail whose sentence runs
   * past the 200-character cut with its act inside it.
   */
  async function aRefusedAnswer(): Promise<{
    text: string
    json: unknown
    /** The refusal as a row written before the host kept its sentence: joined by its receipt. */
    row: ToolRefusedEvent
    /** The refusal as the host writes it now, its whole sentence kept. */
    kept: ToolRefusedEvent
  }> {
    const pm = await opens('pm')
    const out = await refusedCall(pm, 'answer_question', {
      question: 'req_00000000-0000-0000-0000-000000000000',
      answers: [{ part: 'q0', answer: ['yes'] }],
    })
    expect(out.row.rail).toBe('no-question-by-that-name')
    // ⛔ **The premise, asserted**: the row is longer than the cut, so a person's row is cut.
    expect(out.text.length).toBeGreaterThan(200)
    expect(out.row.told, 'the host kept no sentence on its refusal').toBeDefined()
    // The same refusal without its kept sentence, as every row written before the host kept one.
    const older = Object.fromEntries(
      Object.entries(out.row).filter(([field]) => field !== 'told'),
    ) as unknown as ToolRefusedEvent
    expect(older.told).toBeUndefined()
    expect(older.rail).toBe(out.row.rail)
    return { text: out.text, json: out.json, row: older, kept: out.row }
  }

  it('🔴 a refusal the host kept whole is quoted whole on its notice, and not called a part', async () => {
    const { text, json, kept } = await aRefusedAnswer()
    const whole = text.slice('refused (no-question-by-that-name): '.length)
    for (const [naming, call, receipt] of [
      [
        CLAUDE_NAMING,
        ev({ type: 'tool_call', id: 'c1', name: 'mcp__brobot__answer_question', summary: '{}' }),
        claudeReceipt('c1', text, json),
      ],
      [
        CODEX_NAMING,
        ev({ type: 'tool_call', id: 'c1', name: 'brobot__answer_question', summary: '{}' }),
        codexReceipt('c1', 'answer_question', text, json),
      ],
    ] as const) {
      const state = createTranscript()
      for (const event of [inventory(naming), call, kept, receipt]) applyEvent(state, event)
      const notice = theNotice(state)
      // The receipt on the row is cut; the quotation is not.
      expect(whole.length).toBeGreaterThan(170)
      expect(notice.told).toBe(whole)
      expect(notice.told).toContain(ANSWER_ACT)
      expect(notice.toldInPart).toBeUndefined()
      expect(toldClause(notice.told, notice.toldInPart === true)).toBe(` · it was told: “${whole}”`)
    }
  })

  it('⚑ a kept sentence the host had to cut is called a part, and a handle in it is read aloud', async () => {
    const { text, json, kept } = await aRefusedAnswer()
    const state = createTranscript()
    for (const event of [
      inventory(CLAUDE_NAMING),
      ev({ type: 'tool_call', id: 'c1', name: 'mcp__brobot__answer_question', summary: '{}' }),
      { ...kept, told: { text: 'nobody is waiting on you (sess_abc123) for', dropped: 40 } },
      claudeReceipt('c1', text, json),
    ])
      applyEvent(state, event)
    const notice = theNotice(state)
    expect(notice.told).toBe('nobody is waiting on you (that conversation) for')
    expect(notice.toldInPart).toBe(true)
  })

  it('🔴 Claude · the notice quotes what the call was told, and the ACT is in it', async () => {
    const { text, json, row } = await aRefusedAnswer()
    expect(text.startsWith('refused (no-question-by-that-name): ')).toBe(true)
    const state = createTranscript()
    for (const event of [
      inventory(CLAUDE_NAMING),
      ev({ type: 'tool_call', id: 'toolu_1', name: 'mcp__brobot__answer_question', summary: '{}' }),
      row,
      claudeReceipt('toolu_1', text, json),
    ])
      applyEvent(state, event)
    const notice = theNotice(state)
    expect(notice.told).toBeDefined()
    expect(notice.told).toContain(ANSWER_ACT)
    // ⚑ The words are the receipt's own, after the prefix — nothing composed here. ⛔ And the
    // normalizer's `…` is NOT inside them: it was never said to the model, so the notice says the
    // words are the first part instead (`685`'s review).
    const told = notice.told ?? '∅'
    expect(told.endsWith('…')).toBe(false)
    expect(notice.toldInPart).toBe(true)
    expect(text.slice('refused (no-question-by-that-name): '.length).startsWith(told)).toBe(true)
    // ⛔ …and the app's own sentence is untouched: `text` is not where the quotation goes.
    expect(notice.text).toBe(
      'refused: answer_question · no-question-by-that-name · this exact call can never succeed · retrying will not help',
    )
    expect(notice.text).not.toContain(ANSWER_ACT)
  })

  it('🔴 Codex · the same join through the other normalizer’s cut', async () => {
    const { text, json, row } = await aRefusedAnswer()
    const state = createTranscript()
    for (const event of [
      inventory(CODEX_NAMING),
      ev({ type: 'tool_call', id: 'exec_1', name: 'brobot__answer_question', summary: '{}' }),
      row,
      codexReceipt('exec_1', 'answer_question', text, json),
    ])
      applyEvent(state, event)
    const notice = theNotice(state)
    expect(notice.told).toContain(ANSWER_ACT)
    // ⛔ Codex's cut mark is `… (200 of N characters)` — N counts the prefix the quotation drops, and
    // none of it was said to the model.
    expect(notice.told).not.toMatch(/…|of \d+ characters/)
    expect(notice.toldInPart).toBe(true)
  })

  it('⚑ the clause the notice and the export both draw is one spelling', async () => {
    const { text, json, row } = await aRefusedAnswer()
    const state = createTranscript()
    for (const event of [
      inventory(CLAUDE_NAMING),
      ev({ type: 'tool_call', id: 'toolu_1', name: 'mcp__brobot__answer_question', summary: '{}' }),
      row,
      claudeReceipt('toolu_1', text, json),
    ])
      applyEvent(state, event)
    const notice = theNotice(state)
    const clause = toldClause(notice.told, notice.toldInPart === true)
    expect(clause.startsWith(' · it was told, in part: “')).toBe(true)
    expect(clause).toContain(ANSWER_ACT)
    expect(composeReadable('t', state.items, { toolActivity: false })).toContain(clause)
    // ⚑ The controls: a notice with nothing joined adds nothing; a whole receipt is not *in part*.
    expect(toldClause(undefined)).toBe('')
    expect(toldClause('the words.')).toBe(' · it was told: “the words.”')
  })

  it('⚑ a handle in what the call was told is read aloud — the card’s rule, one surface over', async () => {
    const { text, json, row } = await aRefusedAnswer()
    // ⚑ Inside the cut — the sentence names the agent past it, so the handle goes where it is read.
    const withAHandle = text.replace(
      'for a request by that id',
      'for a request by that id (sess_abc123)',
    )
    expect(withAHandle).not.toBe(text)
    const state = createTranscript()
    for (const event of [
      inventory(CLAUDE_NAMING),
      ev({ type: 'tool_call', id: 'toolu_1', name: 'mcp__brobot__answer_question', summary: '{}' }),
      row,
      claudeReceipt('toolu_1', withAHandle, json),
    ])
      applyEvent(state, event)
    const told = theNotice(state).told ?? ''
    expect(told).toContain('(that conversation)')
    expect(told).not.toContain('sess_abc123')
  })

  it('⚑ a receipt that was NOT cut is quoted whole, and not called a part', async () => {
    const { json, row } = await aRefusedAnswer()
    const short = 'refused (no-question-by-that-name): nobody is waiting on you for that.'
    const state = createTranscript()
    for (const event of [
      inventory(CLAUDE_NAMING),
      ev({ type: 'tool_call', id: 'toolu_1', name: 'mcp__brobot__answer_question', summary: '{}' }),
      row,
      claudeReceipt('toolu_1', short, json),
    ])
      applyEvent(state, event)
    const notice = theNotice(state)
    expect(notice.told).toBe('nobody is waiting on you for that.')
    expect(notice.toldInPart).toBeUndefined()
  })

  it('⚑ `receiptOf` finds a call’s kept receipt on a top-level row AND on a sub-agent’s card', () => {
    const state = createTranscript()
    for (const event of [
      ev({ type: 'tool_call', id: 'toolu_task', name: 'Agent', summary: 'the work' }),
      ev({
        type: 'sub_agent',
        agentId: 'a1',
        phase: 'started',
        parentToolCallId: 'toolu_task',
        kind: 'general-purpose',
        title: 'the work',
      }),
      ev({
        type: 'tool_call',
        id: 'child_1',
        name: 'mcp__brobot__give_work',
        summary: '{}',
        parentToolCallId: 'toolu_task',
      }),
      ev({
        type: 'tool_result',
        id: 'child_1',
        summary: 'refused (too-deep): kept on the card',
        ok: true,
        parentToolCallId: 'toolu_task',
      }),
      ev({ type: 'tool_call', id: 'own_1', name: 'Read', summary: 'notes.txt' }),
      ev({ type: 'tool_result', id: 'own_1', summary: 'kept on the row', ok: true }),
    ])
      applyEvent(state, event)
    expect(receiptOf(state, 'child_1')).toBe('refused (too-deep): kept on the card')
    expect(receiptOf(state, 'own_1')).toBe('kept on the row')
    // ⚑ The control: a call nothing holds.
    expect(receiptOf(state, 'nobody')).toBeNull()
  })

  // ─────────────────────────────────────────────── the controls — each moves ONE fact

  it('⛔ a receipt for ANOTHER rail’s prefix joins nothing', async () => {
    const { text, json, row } = await aRefusedAnswer()
    const state = createTranscript()
    for (const event of [
      inventory(CLAUDE_NAMING),
      ev({ type: 'tool_call', id: 'toolu_1', name: 'mcp__brobot__answer_question', summary: '{}' }),
      row,
      claudeReceipt(
        'toolu_1',
        text.replace(
          'refused (no-question-by-that-name): ',
          'refused (a-person-answers-this-one): ',
        ),
        json,
      ),
    ])
      applyEvent(state, event)
    expect(theNotice(state).told).toBeUndefined()
  })

  it('⛔ two refusals of one tool on one rail in flight — the fold does not guess', async () => {
    const { text, json, row } = await aRefusedAnswer()
    const state = createTranscript()
    for (const event of [
      inventory(CLAUDE_NAMING),
      ev({ type: 'tool_call', id: 'toolu_1', name: 'mcp__brobot__answer_question', summary: '{}' }),
      ev({ type: 'tool_call', id: 'toolu_2', name: 'mcp__brobot__answer_question', summary: '{}' }),
      row,
      row,
      claudeReceipt('toolu_1', text, json),
      claudeReceipt('toolu_2', text, json),
    ])
      applyEvent(state, event)
    expect(notices(state).map((one) => one.told)).toEqual([undefined, undefined])
  })

  it('⛔ a call to a server this conversation was NOT declared — a name alone is not enough', async () => {
    const { text, json, row } = await aRefusedAnswer()
    const state = createTranscript()
    for (const event of [
      inventory(CLAUDE_NAMING),
      ev({
        type: 'tool_call',
        id: 'toolu_1',
        name: 'mcp__elsewhere__answer_question',
        summary: '{}',
      }),
      row,
      claudeReceipt('toolu_1', text, json),
    ])
      applyEvent(state, event)
    expect(theNotice(state).told).toBeUndefined()
  })

  it('⛔ a receipt written before 675 — Claude’s JSON alone — joins nothing', async () => {
    const { json, row } = await aRefusedAnswer()
    const state = createTranscript()
    for (const event of [
      inventory(CLAUDE_NAMING),
      ev({ type: 'tool_call', id: 'toolu_1', name: 'mcp__brobot__answer_question', summary: '{}' }),
      row,
      ev({
        type: 'tool_result',
        id: 'toolu_1',
        ok: true,
        summary: JSON.stringify(json).slice(0, 200),
      }),
    ])
      applyEvent(state, event)
    expect(theNotice(state).told).toBeUndefined()
  })

  it('⛔ the run ended before the receipt — a later receipt claims nothing', async () => {
    const { text, json, row } = await aRefusedAnswer()
    const state = createTranscript()
    for (const event of [
      inventory(CLAUDE_NAMING),
      ev({ type: 'tool_call', id: 'toolu_1', name: 'mcp__brobot__answer_question', summary: '{}' }),
      row,
      ev({ type: 'turn', state: 'completed' }),
      ev({ type: 'tool_call', id: 'toolu_2', name: 'mcp__brobot__answer_question', summary: '{}' }),
      claudeReceipt('toolu_2', text, json),
    ])
      applyEvent(state, event)
    expect(theNotice(state).told).toBeUndefined()
  })

  it('⚑ an OUTGOING card already prints its receipt — the notice adds nothing, one account of one call', async () => {
    const pm = await opens('pm')
    const { text, json, row } = await refusedCall(pm, 'message_agent', {
      agent: 'sess_nobody',
      text: 'hello',
      kind: 'follow-up',
    })
    const state = createTranscript()
    for (const event of [
      inventory(CLAUDE_NAMING),
      ev({ type: 'tool_call', id: 'toolu_1', name: 'mcp__brobot__message_agent', summary: '{}' }),
      row,
      claudeReceipt('toolu_1', text, json),
    ])
      applyEvent(state, event)
    expect(theNotice(state).told).toBeUndefined()
    // ⚑ …and the card's receipt carries the act — the account a person reads for this call.
    const card = state.items.find((item) => item.kind === 'tool')
    // ⚑ **D-017 · R12 — `no-such-agent` now says only *no conversation has that id*** (R13's true
    // words), and the act it points at reads *reach*.
    expect(card?.kind === 'tool' ? card.result?.summary : '').toContain(
      'list_agents names the ones you can reach',
    )
    // ⚑ The control: the same fold for a call that is NOT a card does join — the aRefusedAnswer cases.
  })
})
