import { describe, expect, it } from 'vitest'
import { RUNTIME_EVENT_TYPES, type RuntimeEvent, type SessionRef } from '@brobot2/runtime'
import { applyEvent, appendUserMessage, createTranscript } from '../src/renderer/src/lib/transcript'
import { isVisibleIn, visibleItems } from '../src/renderer/src/lib/transcript-mode'
import type { TranscriptItem } from '../src/renderer/src/lib/transcript'

/**
 * The body serves the dev screen and, later, the real app view. `normal` hiding the
 * wrong thing is the dangerous direction: a user who cannot see a failure, a stall
 * or a card waiting on them has been lied to by omission. These pin exactly what
 * each mode shows, against a transcript built by the real fold.
 */

const ref: SessionRef = {
  provider: 'claude',
  sessionId: 'sess-abc',
  cwd: '/tmp/scratch',
  rotation: 0,
}

const scope = {
  cwd: '/tmp/scratch',
  paths: [],
  networkHosts: [],
  persistence: 'once' as const,
  amendments: [],
  availableDecisions: ['allow' as const, 'deny' as const],
  underDisclosed: false,
}

/** A realistic session: conversation, tool work, a card, chatter, lifecycle and a failure. */
function realisticTranscript() {
  const state = createTranscript()
  const feed = (...events: RuntimeEvent[]) => events.forEach((e) => applyEvent(state, e))

  feed({ type: 'session', state: 'started', ref }) // notice · info
  appendUserMessage(state, 'do the thing')
  feed(
    { type: 'unknown', provider: 'claude', category: 'reasoning', raw: {} },
    { type: 'unknown', provider: 'claude', category: 'lifecycle', label: 'message_start', raw: {} },
    { type: 'assistant_message', text: 'on it' },
    { type: 'tool_call', id: 't1', name: 'Bash', summary: 'ls' },
    { type: 'permission_request', id: 'p1', kind: 'command', action: 'Bash', detail: 'ls', scope },
    { type: 'tool_result', id: 't1', summary: 'ok', ok: true },
    { type: 'error', message: 'claude is retrying after an API error', fatal: false }, // notice · warn
    { type: 'unknown', provider: 'claude', category: 'unrecognized', raw: { surprise: true } },
    { type: 'turn', state: 'completed' }, // notice · info
    { type: 'error', message: 'the provider died', fatal: true }, // notice · error
  )
  return state
}

const kindsOf = (items: TranscriptItem[]) => items.map((item) => item.kind)

describe('transcript mode', () => {
  /**
   * ⛔ **CORRECTED, not deleted** (142). This read *"debug shows every item, exactly as the dev
   * screen always has"* and asserted `visibleItems('debug', items) === items`. That contract is what
   * 211 §4 retired: the toggle that turns this mode on has promised *"session start, turn
   * boundaries, idle gaps"* since 079 and delivered every recognized whisper as well — 208
   * `item/plan/delta` markers in the conversation 210 was trying to read.
   *
   * ⚑ **The paired positive is the point of the shape below**: it is not enough to show that debug
   * drops something, because a mode that dropped everything would pass that. Debug is asserted to be
   * `normal` PLUS the boundaries, with both halves named.
   */
  it('debug is the conversation PLUS the lifecycle boundaries — and nothing else (211 §4)', () => {
    const state = realisticTranscript()
    const debug = visibleItems('debug', state.items)
    const normal = visibleItems('normal', state.items)

    // It is not "everything" any more…
    expect(debug.length).toBeLessThan(state.items.length)
    // …and it is not "the conversation" either: it is strictly bigger.
    expect(debug.length).toBeGreaterThan(normal.length)
    // Every row the conversation shows is still here, in the same order.
    expect(debug.filter((item) => normal.includes(item))).toEqual(normal)
    // And what it adds back is exactly the boundaries: the two `info` notices ("session started",
    // "turn completed") and the one payload the runtime classified as session/turn housekeeping.
    // The `reasoning` chatter beside them in the same fixture is in NEITHER view.
    const added = debug.filter((item) => !normal.includes(item))
    expect(added.map((item) => item.kind)).toEqual(['notice', 'unknown', 'notice'])
    expect(
      added.every((item) => {
        if (item.kind === 'notice') return item.level === 'info'
        return item.kind === 'unknown' && item.category === 'lifecycle'
      }),
    ).toBe(true)
  })

  it('normal keeps the conversation: messages, tools and the cards waiting on you', () => {
    const shown = visibleItems('normal', realisticTranscript().items)

    expect(kindsOf(shown)).toContain('user')
    expect(kindsOf(shown)).toContain('assistant')
    expect(kindsOf(shown)).toContain('tool')
    expect(kindsOf(shown)).toContain('permission')
  })

  it('normal hides lifecycle chrome but never a problem', () => {
    const shown = visibleItems('normal', realisticTranscript().items)
    const notices = shown.filter((item) => item.kind === 'notice')

    // "session started" and "turn completed" are gone…
    expect(notices.every((item) => item.level !== 'info')).toBe(true)
    // …while the retry warning and the fatal error both survive.
    expect(notices.map((item) => item.level).sort()).toEqual(['error', 'warn'])
  })

  it('normal hides recognized chatter and keeps a genuine surprise', () => {
    const shown = visibleItems('normal', realisticTranscript().items)
    const unknowns = shown.filter((item) => item.kind === 'unknown')

    expect(unknowns).toHaveLength(1)
    expect(unknowns[0]?.category).toBe('unrecognized')
  })

  it('normal is a filter, not a reordering or a rewrite', () => {
    const items = realisticTranscript().items
    const shown = visibleItems('normal', items)

    expect(shown.length).toBeLessThan(items.length)
    // Every surviving item is the same object, in the same relative order.
    expect(shown).toEqual(items.filter((item) => shown.includes(item)))
  })

  it.each([
    ['info', false],
    ['warn', true],
    ['error', true],
  ] as const)('normal shows a %s notice: %s — and debug shows all three', (level, visible) => {
    // ⚑ The `debug` half is unchanged by 211 §4 and it is the half that MATTERS here: `info`
    // notices ARE the session starts and turn boundaries the toggle promises, so this is the
    // positive that stops the new filter from being "drops everything".
    const item: TranscriptItem = { kind: 'notice', id: 'n', level, text: 'x' }
    expect(isVisibleIn('normal', item)).toBe(visible)
    expect(isVisibleIn('debug', item)).toBe(true)
  })

  /**
   * ⛔ **The `debug` column CHANGED and the `normal` column did not** (211 §4). It used to read
   * `true` for every row, because debug meant everything. `lifecycle` is the one category the
   * toggle's own words cover — `unknownCategorySchema` calls it *"session/turn housekeeping"* — and
   * `plan` is the category that put 208 markers into 210's planning conversation.
   */
  it.each([
    ['reasoning', false, false],
    ['plan', false, false],
    ['lifecycle', false, true],
    ['activity', false, false],
    ['echo', false, false],
    ['unrecognized', true, true],
  ] as const)('a %s unknown — normal: %s, debug: %s', (category, inNormal, inDebug) => {
    const item: TranscriptItem = { kind: 'unknown', id: 'u', provider: 'codex', category, raw: {} }
    expect(isVisibleIn('normal', item)).toBe(inNormal)
    expect(isVisibleIn('debug', item)).toBe(inDebug)
  })

  /**
   * ⛔ **CORRECTED in 211 §4** — it was *"leaves the conversation but stays in debug (028)"*.
   *
   * The reason 028 gave for keeping it in debug was debug's old contract, *"showing what the
   * provider really said"*, and that job belongs to the drawer's Events tab. A call the runtime told
   * us is already drawn as the checklist beside it is the same fact twice in either mode, and it is
   * not one of the three things the toggle promises.
   */
  it('a SUPERSEDED tool row leaves BOTH views — the raw call is a tab away (028, 211 §4)', () => {
    const call: TranscriptItem = {
      kind: 'tool',
      id: 't1',
      callId: 'toolu_a',
      name: 'TaskCreate',
      summary: '…',
      result: null,
    }
    // The paired positive first: an ordinary tool row is shown in both, so what follows is about
    // being superseded and not about tool rows.
    expect(isVisibleIn('normal', call)).toBe(true)
    expect(isVisibleIn('debug', call)).toBe(true)
    expect(isVisibleIn('normal', { ...call, superseded: true })).toBe(false)
    expect(isVisibleIn('debug', { ...call, superseded: true })).toBe(false)
  })

  it('decides every item kind the fold can produce — nothing falls through unclassified', () => {
    // Drive one of every event variant through the real fold, so a new item kind
    // arrives here as an unhandled case rather than as an accidental default.
    const state = createTranscript()
    appendUserMessage(state, 'hi')
    const samples: Record<(typeof RUNTIME_EVENT_TYPES)[number], RuntimeEvent> = {
      session: { type: 'session', state: 'started', ref },
      conversation_reset: {
        type: 'conversation_reset',
        ref: { ...ref, sessionId: 'after-the-clear' },
        source: 'conversation_reset',
      },
      // 586 · the provider's own all-clear. It draws NOTHING in either mode, which is the ruling
      // and not an omission — see `transcript.ts`'s arm for it.
      // ⚑ A usage reading: the host takes it before the ledger, so it draws nothing anywhere.
      provider_usage: {
        type: 'provider_usage',
        readings: [{ window: 'five_hour', usedPercent: 40, resetsAt: 1_790_913_208_000 }],
      },
      provider_limit_clear: {
        type: 'provider_limit_clear',
        window: 'five_hour',
        source: 'rate_limit_event',
      },
      turn: { type: 'turn', state: 'completed' },
      provider_turn: { type: 'provider_turn' },
      assistant_delta: { type: 'assistant_delta', text: 'x' },
      assistant_message: { type: 'assistant_message', text: 'x' },
      tool_call: { type: 'tool_call', id: 't', name: 'Bash', summary: 's' },
      tool_result: { type: 'tool_result', id: 't', summary: 's', ok: true },
      permission_request: {
        type: 'permission_request',
        id: 'p',
        kind: 'file',
        action: 'Write',
        detail: 'f',
        scope,
      },
      user_input_request: { type: 'user_input_request', id: 'ui', prompt: 'p', questions: [] },
      request_resolved: { type: 'request_resolved', id: 'p' },
      status: { type: 'status', state: 'idle' },
      thinking: { type: 'thinking', phase: 'delta', redacted: true, tokens: 42 },
      activity: { type: 'activity', phase: 'thinking' },
      image: { type: 'image', imageId: 'exec-1', path: '/x/generated_images/t/exec-1.png' },
      plan_update: { type: 'plan_update', steps: [{ text: 'step one', status: 'active' }] },
      sub_agent: { type: 'sub_agent', agentId: 'a1', phase: 'started', kind: 'Explore' },
      error: { type: 'error', message: 'oops', fatal: false },
      context_reading: {
        type: 'context_reading',
        reading: { kind: 'tokens', used: 46971 },
        source: 'message_start',
      },
      compaction: { type: 'compaction', before: 128000, after: 24000, source: 'compact_boundary' },
      file_change: {
        type: 'file_change',
        changes: [{ path: 'src/a.ts', status: 'modified', added: 2, removed: 1 }],
        source: 'turn/diff/updated',
      },
      workflow_run: {
        type: 'workflow_run',
        taskId: 'wf1',
        toolUseId: 't',
        name: 'demo',
        phases: [{ index: 1, title: 'Draft' }],
        agents: [{ agentId: 'a1', label: 'writer', phaseIndex: 1, state: 'running' }],
        source: 'task_progress',
      },
      // 247. Drives the fold's `background_work` arm, which deliberately creates no item — so this
      // pass asserts the taxonomy is walked, and the kind set below asserts nothing new appeared.
      background_work: {
        type: 'background_work',
        running: [{ id: 'bqiucw912', toolCallId: 't', kind: 'local_bash' }],
        source: 'background_tasks_changed',
      },
      // 253. Drives the fold's `scheduled_work` arm, which is a handoff and creates no item — so
      // this pass asserts the taxonomy is walked and the kind set below asserts nothing appeared.
      scheduled_work: {
        type: 'scheduled_work',
        jobs: [{ id: 'a7c8a668', schedule: '* * * * *', recurring: true, prompt: 'tick' }],
        source: 'hook/Stop',
      },
      // 279. Drives the fold's `provider_commands` arm, which is a handoff and creates no item —
      // so this pass asserts the taxonomy is walked and the kind set below asserts nothing appeared.
      tool_inventory: {
        type: 'tool_inventory',
        naming: { prefix: 'mcp__', separator: '__' },
        declared: {
          server: 'brobot',
          tools: [{ name: 'spawn_agent', description: 'Create another agent.', parameters: [] }],
        },
        published: {
          tools: ['Bash', 'mcp__brobot__spawn_agent'],
          servers: [{ name: 'brobot', status: 'connected' }],
        },
        source: 'init',
      },
      provider_commands: {
        type: 'provider_commands',
        commands: [{ name: 'compact', description: 'Free up context' }],
        prefix: '/',
        source: 'initializationResult',
      },
      memory_recall: {
        type: 'memory_recall',
        entries: [{ path: 'MEMORY.md', lineStart: 1, lineEnd: 3, note: 'the user’s full name' }],
        threadIds: ['019c6e27-e55b-73d1-87d8-4e01f1f75043'],
        source: 'memoryCitation',
      },
      unknown: { type: 'unknown', provider: 'claude', category: 'reasoning', raw: null },
    }
    for (const type of RUNTIME_EVENT_TYPES) applyEvent(state, samples[type])

    const kinds = new Set(kindsOf(state.items))
    expect(kinds).toEqual(
      new Set([
        'user',
        'assistant',
        'tool',
        'permission',
        'userInput',
        'thinking',
        'plan',
        'subAgent',
        'notice',
        // 067: the picture the agent made. CONTENT, and shown in `normal` — it was `unknown`
        // chatter and therefore invisible in the only mode a user reads.
        'image',
        // 087: the compaction boundary. Shown in `normal` for the same reason `image` is — it was
        // `unknown{lifecycle}` chatter, i.e. invisible in the only mode a user reads, and it is the
        // reason the agent no longer remembers what it was told above the line.
        'compaction',
        // 199: the conversation-reset boundary. Same argument as `compaction` one step further on
        // — it was `unknown{lifecycle}` chatter too, and what it announced was not "the earlier
        // turns were summarized" but "the provider is answering from a different conversation now".
        'reset',
        // 319: what the agent said it READ out of its memory. ⛔ Shown in `normal` for the sharpest
        // version of the reason above it: friction log F5 is a person saying he cannot see a recall
        // happen, so a row only a debug toggle reveals is a row that does not answer him. ⚑ Its
        // write-side twin, `memoryNote` (318), is app-authored and reaches this list from a
        // `TranscriptEvent` rather than a `RuntimeEvent`, which is why it is not in this set.
        'memoryRecall',
        'unknown',
      ]),
    )
    for (const item of state.items) expect(typeof isVisibleIn('normal', item)).toBe('boolean')
  })
})
