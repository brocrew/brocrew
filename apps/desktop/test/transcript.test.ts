import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RUNTIME_EVENT_TYPES, type RuntimeEvent, type SessionRef } from '@brobot2/runtime'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import { aLaunchRecordIn } from '../src/main/runtime/what-this-agent-was-given'
import { REOPEN_COSTS } from '../src/renderer/src/lib/reopening'
import {
  NOTHING_WAITS_FOR_THIS_ANSWER,
  appendUserMessage,
  applyEvent,
  createTranscript,
  isAwaitingAnswer,
  markPermissionAnswered,
  markReopened,
  markRequestFailed,
  markUserInputAnswered,
  type AssistantItem,
  type NoticeItem,
  type PermissionItem,
  type PlanItem,
  type SubAgentCard,
  type SubAgentToolRow,
  type ToolItem,
  type TranscriptState,
  type UserInputItem,
} from '../src/renderer/src/lib/transcript'

/**
 * The fold from events to what the screen shows. It is the only interpretation
 * layer in the renderer, so the rules that could quietly lie to the user — delta
 * versus authoritative text, tool correlation, and when a card stops being
 * answerable — are pinned here.
 */

const ref: SessionRef = {
  provider: 'claude',
  sessionId: 'sess-abc',
  cwd: '/tmp/scratch',
  rotation: 0,
}

const scope = {
  cwd: '/tmp/scratch',
  paths: ['write /tmp/scratch/out.txt'],
  networkHosts: [],
  persistence: 'once' as const,
  amendments: [],
  availableDecisions: ['allow' as const, 'deny' as const],
  underDisclosed: false,
}

function permissionRequest(id = 'req_1'): RuntimeEvent {
  return { type: 'permission_request', id, kind: 'file', action: 'Write', detail: 'out.txt', scope }
}

function feed(state: TranscriptState, ...events: RuntimeEvent[]): TranscriptState {
  for (const event of events) applyEvent(state, event)
  return state
}

describe('transcript fold', () => {
  it('accumulates deltas into one live block', () => {
    const state = feed(
      createTranscript(),
      { type: 'assistant_delta', text: 'Hel' },
      { type: 'assistant_delta', text: 'lo' },
    )

    expect(state.items).toHaveLength(1)
    expect(state.items[0]).toMatchObject({ kind: 'assistant', text: 'Hello', streaming: true })
  })

  it('lets the authoritative message replace the accumulated text, not extend it', () => {
    const state = feed(
      createTranscript(),
      { type: 'assistant_delta', text: 'Hel' },
      { type: 'assistant_delta', text: 'lo' },
      { type: 'assistant_message', text: 'Hello, world' },
    )

    expect(state.items).toHaveLength(1)
    expect(state.items[0]).toMatchObject({
      kind: 'assistant',
      text: 'Hello, world',
      streaming: false,
    })
    expect(state.streamingId).toBeNull()
  })

  it('provider follow-ups 1 · an async message keeps its questions, for a surface to draw as choices', () => {
    const questions = [{ title: 'Which database?', options: ['Postgres', 'SQLite'] }]
    const state = feed(createTranscript(), {
      type: 'assistant_message',
      text: 'Which database?',
      questions,
    })
    expect(state.items[0]).toMatchObject({ kind: 'assistant', questions })
    // …and the same, when the words had streamed first.
    const streamed = feed(
      createTranscript(),
      { type: 'assistant_delta', text: 'Which' },
      { type: 'assistant_message', text: 'Which database?', questions },
    )
    expect(streamed.items[0]).toMatchObject({ kind: 'assistant', streaming: false, questions })
    // ⛔ Nothing waits on them: no card, no awaiting answer.
    expect(state.items.filter((one) => one.kind !== 'assistant')).toEqual([])
  })

  it('renders a message that never streamed', () => {
    const state = feed(createTranscript(), { type: 'assistant_message', text: 'done' })
    expect(state.items[0]).toMatchObject({ kind: 'assistant', text: 'done', streaming: false })
  })

  it('stops attributing deltas to a block once a turn ends', () => {
    const state = feed(
      createTranscript(),
      { type: 'assistant_delta', text: 'one' },
      { type: 'turn', state: 'completed' },
      { type: 'assistant_delta', text: 'two' },
    )

    const assistants = state.items.filter(
      (item): item is AssistantItem => item.kind === 'assistant',
    )
    expect(assistants.map((item) => item.text)).toEqual(['one', 'two'])
    expect(assistants[0]?.streaming).toBe(false)
  })

  it('correlates a tool result to its call', () => {
    const state = feed(
      createTranscript(),
      { type: 'tool_call', id: 'tool_1', name: 'Bash', summary: 'ls' },
      { type: 'tool_result', id: 'tool_1', summary: '3 files', ok: true },
    )

    expect(state.items).toHaveLength(1)
    expect(state.items[0]).toMatchObject({
      kind: 'tool',
      name: 'Bash',
      result: { summary: '3 files', ok: true },
    })
  })

  it('keeps both ends of a tool call, so how long it took is measured and not invented', () => {
    // The surface shows a duration on every tool row (Slice 2 · 005). A `tool_result` MUTATES the
    // call's item rather than adding one, so without carrying its time here there would be nothing
    // to subtract from — and a rendered "210 ms" would be a number nobody measured.
    const state = createTranscript()
    applyEvent(state, { type: 'tool_call', id: 'tool_1', name: 'Bash', summary: 'ls' }, 1_000)
    applyEvent(state, { type: 'tool_result', id: 'tool_1', summary: '3 files', ok: true }, 1_210)

    const tool = state.items[0] as ToolItem & { at?: number }
    expect(tool.at).toBe(1_000) // the call keeps the time it started
    expect(tool.result?.at).toBe(1_210) // …and the result the time it landed
  })

  it('leaves a result with no call without a duration rather than guessing one', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'tool_result', id: 'tool_9', summary: 'orphan', ok: false }, 5_000)

    const tool = state.items[0] as ToolItem & { at?: number }
    // The item is stamped with when the result arrived; there is no call to measure from, so the
    // pair cannot produce a duration — and the row shows none.
    expect(tool.at).toBe(5_000)
    expect(tool.result?.at).toBe(undefined)
  })

  it('surfaces a result whose call was never seen instead of dropping it', () => {
    const state = feed(createTranscript(), {
      type: 'tool_result',
      id: 'tool_9',
      summary: 'orphan',
      ok: false,
    })

    const tool = state.items[0] as ToolItem
    expect(tool.kind).toBe('tool')
    expect(tool.callId).toBe('tool_9')
    expect(tool.result).toEqual({ summary: 'orphan', ok: false })
  })

  it('opens a permission card that only this app can answer', () => {
    const state = feed(createTranscript(), permissionRequest())
    const card = state.items[0] as PermissionItem

    expect(card.kind).toBe('permission')
    expect(card.outcome).toBeNull()
    expect(card.note).toBeNull()
    expect(card.request.scope.availableDecisions).toEqual(['allow', 'deny'])

    markPermissionAnswered(state, 'req_1', 'deny')
    expect((state.items[0] as PermissionItem).outcome).toBe('deny')
  })

  it('records why a decision could not be delivered', () => {
    const state = feed(createTranscript(), permissionRequest())
    markRequestFailed(state, 'req_1', 'request req_1 is not pending')
    expect((state.items[0] as PermissionItem).note).toBe('request req_1 is not pending')
  })

  it('marks the card the id belongs to, never just the first one', () => {
    const state = feed(
      createTranscript(),
      permissionRequest('req_1'),
      permissionRequest('req_2'),
      { type: 'user_input_request', id: 'ui_1', prompt: 'first', questions: [] },
      { type: 'user_input_request', id: 'ui_2', prompt: 'second', questions: [] },
    )

    markPermissionAnswered(state, 'req_2', 'allow')
    markUserInputAnswered(state, 'ui_2', 'rejected')
    markRequestFailed(state, 'req_1', 'gone')

    expect((state.items[0] as PermissionItem).outcome).toBeNull()
    expect((state.items[0] as PermissionItem).note).toBe('gone')
    expect((state.items[1] as PermissionItem).outcome).toBe('allow')
    expect((state.items[2] as UserInputItem).answered).toBeNull()
    expect((state.items[3] as UserInputItem).answered).toBe('rejected')
  })

  it('stops offering a card the PROVIDER withdrew, without inventing a decision (051)', () => {
    const state = feed(
      createTranscript(),
      permissionRequest('req_1'),
      { type: 'user_input_request', id: 'ui_1', prompt: 'which?', questions: [] },
      { type: 'request_resolved', id: 'req_1' },
      { type: 'request_resolved', id: 'ui_1' },
    )

    // Non-actionable (the card reads `outcome !== null || note !== null`) — but `outcome` stays
    // null, because we never decided: the provider took the request away.
    expect((state.items[0] as PermissionItem).note).toBe('withdrawn by the provider')
    expect((state.items[0] as PermissionItem).outcome).toBeNull()
    expect((state.items[1] as UserInputItem).note).toBe('withdrawn by the provider')
    expect((state.items[1] as UserInputItem).answered).toBeNull()
  })

  it('ignores a withdrawal for a request it never saw', () => {
    const state = feed(createTranscript(), permissionRequest('req_1'), {
      type: 'request_resolved',
      id: 'req_nope',
    })
    expect((state.items[0] as PermissionItem).note).toBeNull()
  })

  it('ignores a response for a request it never saw', () => {
    const state = feed(createTranscript(), permissionRequest('req_1'))
    markPermissionAnswered(state, 'req_nope', 'allow')
    expect((state.items[0] as PermissionItem).outcome).toBeNull()
  })

  it('marks still-open cards as settled when the session ends, so no button lies', () => {
    // ⚑ **D-017b · one sentence for every stop** (`NOTHING_WAITS_FOR_THIS_ANSWER`): whether it was
    // a close, a quit or a failure is a fact about a process (`05` rule 5), so a card no longer says
    // *"settled when the session closed"* / *"…failed"* — only that nothing waits for its answer.
    const state = feed(
      createTranscript(),
      permissionRequest('req_1'),
      { type: 'user_input_request', id: 'ui_1', prompt: 'which?', questions: [] },
      { type: 'session', state: 'ended', ref },
    )

    expect((state.items[0] as PermissionItem).note).toBe(NOTHING_WAITS_FOR_THIS_ANSWER)
    expect((state.items[1] as UserInputItem).note).toBe(NOTHING_WAITS_FOR_THIS_ANSWER)
    expect(state.ended).toBe(true)
  })

  it('treats a session that ends without a ref as terminal — the status is the only signal', () => {
    // A session closed before the provider ever confirmed one has no honest ref to
    // announce, so the machine emits `status:'ended'` alone.
    const state = feed(createTranscript(), permissionRequest(), { type: 'status', state: 'ended' })

    expect(state.ended).toBe(true)
    expect((state.items[0] as PermissionItem).note).toBe(NOTHING_WAITS_FOR_THIS_ANSWER)
  })

  it('treats status errored as terminal too', () => {
    const state = feed(createTranscript(), permissionRequest(), {
      type: 'status',
      state: 'errored',
    })

    expect(state.ended).toBe(true)
    expect((state.items[0] as PermissionItem).note).toBe(NOTHING_WAITS_FOR_THIS_ANSWER)
  })

  it('keeps the first terminal reason when both signals arrive', () => {
    const state = feed(
      createTranscript(),
      permissionRequest(),
      { type: 'error', message: 'provider died', fatal: true },
      { type: 'status', state: 'errored' },
    )

    expect((state.items[0] as PermissionItem).note).toBe(NOTHING_WAITS_FOR_THIS_ANSWER)
    expect(state.items.filter((item) => item.kind === 'notice')).toHaveLength(1)
  })

  it('settles open cards on a fatal error too', () => {
    const state = feed(createTranscript(), permissionRequest(), {
      type: 'error',
      message: 'provider died',
      fatal: true,
    })

    expect((state.items[0] as PermissionItem).note).toBe(NOTHING_WAITS_FOR_THIS_ANSWER)
    expect(state.ended).toBe(true)
  })

  it('leaves an already-answered card alone when the session ends', () => {
    const state = feed(createTranscript(), permissionRequest())
    markPermissionAnswered(state, 'req_1', 'allow')
    applyEvent(state, { type: 'session', state: 'ended', ref })

    expect(state.items[0]).toMatchObject({ outcome: 'allow', note: null })
  })

  it('answers a user-input card', () => {
    const state = feed(createTranscript(), {
      type: 'user_input_request',
      id: 'ui_1',
      prompt: 'pick one',
      questions: [{ id: 'q0', prompt: 'pick one', options: [{ label: 'a' }, { label: 'b' }] }],
    })

    markUserInputAnswered(state, 'ui_1', 'answered')
    expect((state.items[0] as UserInputItem).answered).toBe('answered')
  })

  it('tracks status, the ref, and the user’s own messages', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'session', state: 'started', ref })
    applyEvent(state, { type: 'status', state: 'working' })
    appendUserMessage(state, 'do the thing')

    expect(state.ref).toEqual(ref)
    expect(state.status).toBe('working')
    expect(state.items.at(-1)).toMatchObject({ kind: 'user', text: 'do the thing' })
  })

  it('renders our own turn from the stream, like everything else', () => {
    // Live and replayed take the same path: the host echoes the turn it accepted, and the
    // fold turns it into the same user item a reopened session is rebuilt from.
    const state = feed(createTranscript(), { type: 'assistant_delta', text: 'thinking' })
    applyEvent(state, { type: 'user_turn', text: 'do the thing' })

    expect(state.items.at(-1)).toMatchObject({ kind: 'user', text: 'do the thing' })
    // …and it closes whatever was streaming, so the next reply starts its own block.
    expect((state.items[0] as AssistantItem).streaming).toBe(false)
  })

  it('replays the decision we made, so an allowed card does not read as unanswered', () => {
    // The decision used to be a local mutation, invisible to the ledger. Replayed, every card
    // the user had allowed came back settled-but-blank — as if nobody had ever answered it.
    const state = feed(createTranscript(), permissionRequest('req_1'))
    applyEvent(state, { type: 'user_decision', requestId: 'req_1', outcome: 'allow' })
    expect((state.items[0] as PermissionItem).outcome).toBe('allow')

    // The same entry answers a user-input card; the id decides which, not the caller.
    const asked = feed(createTranscript(), {
      type: 'user_input_request',
      id: 'ui_1',
      prompt: 'p',
      questions: [],
    })
    applyEvent(asked, { type: 'user_decision', requestId: 'ui_1', outcome: 'answered' })
    expect((asked.items[0] as UserInputItem).answered).toBe('answered')
  })

  it('does not leave a reopened session looking dead', () => {
    // The replayed transcript ends with the session closing — that ending belongs to the
    // session we resumed FROM. Leaving `ended` set shuts the composer on a live session.
    const state = feed(
      createTranscript(),
      { type: 'assistant_delta', text: 'half a repl' },
      { type: 'session', state: 'ended', ref },
    )
    expect(state.ended).toBe(true)

    markReopened(state)

    expect(state.ended).toBe(false)
    expect(state.status).toBe('idle')
    // A recording can stop mid-stream; the next turn must not extend that block.
    expect((state.items[0] as AssistantItem).streaming).toBe(false)
    applyEvent(state, { type: 'assistant_delta', text: 'a new reply' })
    expect(state.items.filter((item) => item.kind === 'assistant')).toHaveLength(2)
  })

  it('a session that died mid-turn does not reopen still claiming to be working (027)', () => {
    // Force-quit while a tool ran: no `turn` event was ever persisted, so the replay ends with the
    // activity and the thinking block still open. Both describe a process that died with the last
    // session, and the pill in particular is a statement about NOW — "running Bash" on a session
    // that is idle is simply false, and nothing later would clear it until the next turn ends.
    const state = feed(
      createTranscript(),
      { type: 'thinking', phase: 'delta', redacted: true, tokens: 40 },
      { type: 'tool_call', id: 'c1', name: 'Bash', summary: 'sleep 900' },
    )
    expect(state.activity).toEqual({ phase: 'tool', detail: 'Bash' })

    markReopened(state)

    expect(state.activity).toBeNull()
    expect(state.items.find((item) => item.kind === 'thinking')).toMatchObject({ streaming: false })
    // The reasoning of the NEXT turn opens its own block rather than resuming the dead one.
    applyEvent(state, { type: 'thinking', phase: 'delta', redacted: true, tokens: 5 })
    expect(state.items.filter((item) => item.kind === 'thinking')).toHaveLength(2)
  })

  it('shows an unmapped provider payload as a raw card instead of crashing', () => {
    const state = feed(createTranscript(), {
      type: 'unknown',
      provider: 'codex',
      category: 'unrecognized',
      raw: { weird: true },
    })
    expect(state.items[0]).toMatchObject({ kind: 'unknown', provider: 'codex' })
  })

  it('carries the neutral category through so the view can quiet chatter (049)', () => {
    // The fold must pass `category` through untouched — it is the ONLY thing the view switches
    // on, and `raw` must survive so a later chat UI can render reasoning/plans richly.
    const raw = { type: 'reasoning', id: 'r1' }
    const state = feed(
      createTranscript(),
      { type: 'unknown', provider: 'codex', category: 'reasoning', raw },
      { type: 'unknown', provider: 'claude', category: 'lifecycle', raw: { s: 1 } },
      { type: 'unknown', provider: 'codex', category: 'unrecognized', raw: { novel: true } },
    )
    expect(state.items.map((i) => (i.kind === 'unknown' ? i.category : i.kind))).toEqual([
      'reasoning',
      'lifecycle',
      'unrecognized',
    ])
    expect(state.items[0]).toMatchObject({ kind: 'unknown', category: 'reasoning', raw })
  })

  it('gives every item a unique id, so the list can key on it', () => {
    const state = feed(
      createTranscript(),
      { type: 'assistant_message', text: 'a' },
      { type: 'tool_call', id: 't', name: 'Bash', summary: 's' },
      permissionRequest(),
      { type: 'turn', state: 'completed' },
    )
    const ids = state.items.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('handles every event variant in the taxonomy', () => {
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
      permission_request: permissionRequest(),
      user_input_request: { type: 'user_input_request', id: 'ui', prompt: 'p', questions: [] },
      request_resolved: { type: 'request_resolved', id: 'p1' },
      status: { type: 'status', state: 'idle' },
      thinking: { type: 'thinking', phase: 'delta', redacted: true, tokens: 42 },
      activity: { type: 'activity', phase: 'thinking' },
      image: { type: 'image', imageId: 'exec-1', path: '/x/generated_images/t/exec-1.png' },
      plan_update: { type: 'plan_update', steps: [{ text: 'step one', status: 'active' }] },
      sub_agent: { type: 'sub_agent', agentId: 'a1', phase: 'started', kind: 'Explore' },
      error: { type: 'error', message: 'oops', fatal: false },
      context_reading: {
        type: 'context_reading',
        reading: { kind: 'proportional', used: 14807, window: 258400 },
        source: 'thread/tokenUsage/updated',
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
      // 247. The level, as `background_tasks_changed` states it.
      background_work: {
        type: 'background_work',
        running: [{ id: 'bqiucw912', toolCallId: 'toolu_1', kind: 'local_bash' }],
        source: 'background_tasks_changed',
      },
      scheduled_work: {
        type: 'scheduled_work',
        jobs: [{ id: 'a7c8a668', schedule: '* * * * *', recurring: true, prompt: 'tick' }],
        source: 'hook/Stop',
      },
      // 279. Drives the fold's `provider_commands` arm, which is a handoff into `CommandRegistry`
      // and creates no item — the palette draws the band, not the transcript.
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
      unknown: { type: 'unknown', provider: 'claude', category: 'unrecognized', raw: null },
    }

    // `status` is state, not a line; `request_resolved` ANNOTATES the card it names (051) rather
    // than adding one; `activity` is what the agent is doing RIGHT NOW (027) — a pill that is
    // replaced and then cleared, never a line in the transcript. `context_reading` (087) joins them
    // for exactly the same reason and it is the whole of 078's ruling: the meter ABSORBS the usage
    // stream so it never becomes transcript rows. Its sibling `compaction` does add one, because a
    // boundary is a fact about history rather than a statement about the present.
    const annotatesRatherThanAdds = new Set([
      'status',
      'request_resolved',
      'activity',
      'context_reading',
      // 096: a file change is not a line in the conversation. The individual writes are already
      // inline as tool rows; the Changes pane CONSOLIDATES them, which is 092's whole thesis. It
      // lands on its own facet — see `ChangeLog` — so `items` is untouched.
      'file_change',
      // 108: a dynamic workflow is not a line either, and this is the strongest case of the rule.
      // The reproduction run sent TWELVE frames for one workflow; a 22-agent run sends more. They
      // fold into one tree hanging off the `Workflow` tool call — 078's *"without turning every
      // usage update into a transcript row"* — so `items` is untouched here too. The tree's own
      // presence is asserted in `workflow-tree.test.ts`; what this pins is that nothing accrues.
      'workflow_run',
      // 247: nor is background work. The runtime publishes the level and the endings; the running-
      // work registry, the truthful card and the per-task stop are 248's, and the fold deliberately
      // creates no item until then — see the arm in `transcript.ts` for what 248 has to read.
      'background_work',
      // ⛔ 258: nor is a schedule, and since this dispatch that is a RULING rather than a handoff.
      // The level is restated at every turn end — `253` measured `init` at 10 194 / 54 805 /
      // 114 037 ms as one cron woke one session twice — so a card per frame is a card every two
      // minutes for as long as the conversation is open. It lands in `ScheduleRegistry` and is drawn
      // by `ScheduleBar` above the composer; see the arm in `transcript.ts` for why a card gated on
      // CHANGE would be a claim this app cannot make.
      'scheduled_work',
      // ⛔ 279: nor is the agent's own command list, and it is the clearest case of the rule yet.
      // The level says what this session COULD be asked to do — a standing fact, not a thing that
      // happened — so a transcript row for it would be a line in the conversation about no event in
      // the conversation. It lands in `CommandRegistry` and is drawn by the palette's own band; see
      // the arm in `transcript.ts` for why `set: null` and `set: {commands: []}` are kept apart.
      'provider_commands',
      // ⛔ 358: nor is the tool inventory, for the neighbour's reason with one more on top. It says
      // what this session COULD call — a standing fact — and on Codex it is emitted precisely to
      // say that the provider reports NOTHING, so a transcript row for it would be a line in the
      // conversation about the absence of a fact. It lands in `ToolRegistry` and is drawn by the
      // Tools sheet; see the arm in `transcript.ts` for why `set: null` and `published: null` are
      // three states rather than two.
      'tool_inventory',
      // ⛔ 586: nor is the provider's own all-clear, and this one is out of the transcript for the
      // reason it was ever chatter. `rate_limit_event` fires once or twice per TURN saying nothing
      // is wrong, so a row for it is a row on every turn telling a reader the ordinary thing —
      // `074`'s ruling, which `HO-080` §1.3 did not touch. ⚑ What it changed is that the fact is
      // now TYPED, so `providerLimitsSeen` can match it against a wall; it lands in no registry at
      // all, because the only reader is a ledger query. See the arm in `transcript.ts`.
      'provider_limit_clear',
      // ⚑ Nor a usage reading, which never reaches a window: the host takes it before the ledger.
      'provider_usage',
    ])
    for (const type of RUNTIME_EVENT_TYPES) {
      const state = createTranscript()
      expect(() => applyEvent(state, samples[type])).not.toThrow()
      expect(state.items.length, type).toBe(annotatesRatherThanAdds.has(type) ? 0 : 1)
      expect(describeEvent(samples[type])).not.toBe('')
    }
  })

  /**
   * **…and the half of the taxonomy the sweep above has never walked** (097).
   *
   * ⚠️ The test before this one is called *"every event variant in the taxonomy"* and its taxonomy is
   * `RUNTIME_EVENT_TYPES` — the PROVIDER's vocabulary. `TranscriptEvent` is that plus five events
   * this app authors itself, and none of them has ever been in that loop. So a `describeEvent`
   * returning `''` for `user_turn`, `user_decision`, 077's queued pair or 097's `user_command` was
   * caught by the compiler (`const exhaustive: never`) and by nothing else — and the compiler cannot
   * see an arm that returns the empty string on purpose.
   *
   * Enumerated by hand rather than derived, because there is no runtime list of the app-authored
   * half to derive from — which is exactly why it was possible to forget it existed.
   */
  it('handles every event variant WE author, which the taxonomy list does not name', () => {
    /** 379's row (a piece's since D-016), named so the roster and the sweep quote one object. */
    const WORK_GIVEN: TranscriptEvent = {
      type: 'work_given',
      piece: 'work_1',
      label: 'W1.7',
      parent: 'work_root',
      givenBy: 'sess_parent',
      title: 'Read the brief',
      brief: 'read the brief',
    }
    const WORK_REPLIED: TranscriptEvent = {
      type: 'work_replied',
      piece: 'work_1',
      outcome: 'done',
      summary: 'the brief is read',
      resources: [],
    }
    const ours: { event: TranscriptEvent; adds: number }[] = [
      {
        event: {
          type: 'worker_registered',
          identity: 'aid:reader',
          identityCreatedAt: 123,
          giver: 'sess_giver',
          number: 1,
        },
        adds: 0,
      },
      { event: { type: 'user_turn', text: 'hello' }, adds: 1 },
      { event: { type: 'user_decision', requestId: 'p1', outcome: 'allow' }, adds: 0 },
      { event: { type: 'message_queued', text: 'later' }, adds: 1 },
      { event: { type: 'message_unqueued', reason: 'cancelled', text: 'later' }, adds: 1 },
      // 097: a gesture, recorded for the ledger and drawn nowhere. `adds: 0` is the RULING, not an
      // omission — see the `user_command` arm in `applyEvent`.
      { event: { type: 'user_command', command: 'interrupted' }, adds: 0 },
      {
        event: { type: 'user_command', command: 'changed_model', target: 'claude-opus-5' },
        adds: 0,
      },
      // 318: a memory note. `adds: 1` is the ruling — the counterpart of `user_command` above, and
      // the two arms sit next to each other in `applyEvent` for exactly that reason.
      {
        event: {
          type: 'memory_note',
          notes: [
            {
              path: '/p/memories/extensions/ad_hoc/notes/2026-09-04T00-00-00-x.md',
              bytes: 3,
              text: 'hi',
            },
          ],
        },
        adds: 1,
      },
      // 332 · the launch row. One item, and `describeEvent` names the store — the assertions at the
      // foot of this test are what hold both.
      {
        event: { type: 'memory_loaded', index: '/p/memory/MEMORY.md', beside: 2 },
        adds: 1,
      },
      // 379 · the give, and it adds NOTHING — `user_command`'s standing, for `user_command`'s
      // reason: the conversation already shows the work this row names (the brief is this
      // conversation's own turn), and drawing the piece beside its own message would say the same
      // thing twice in the one surface meant to read like a conversation. ⚠️ It still has to have a
      // `describeEvent` line, which the loop below asserts: the Events tab filters nothing, and a
      // row that renders as an empty string there is a row a debugger cannot see.
      { event: WORK_GIVEN, adds: 0 },
      // 393 · the reply, and it adds nothing for its give's reason with one word changed: the
      // conversation already shows the reply as the `reply_to_parent` call that produced it (the
      // row lands on that call as its card), and the WORDS reach the parent's transcript as an
      // ordinary turn rather than this one's.
      { event: WORK_REPLIED, adds: 0 },
      // ⚑ **D-016 · every other piece row draws nothing either** — a taking back, a title, a status
      // line, the two verbs nothing writes yet, and the giver's receipt. ⚠️ The owner is TOLD of a
      // taking back by an app notice, which is an ordinary turn this transcript already draws
      // (429's notice moved there), so a row here would say it twice.
      { event: { type: 'work_taken_back', piece: 'work_1', by: 'sess_parent' }, adds: 0 },
      {
        event: { type: 'work_retitled', piece: 'work_1', title: 'Read it', by: 'sess_parent' },
        adds: 0,
      },
      {
        event: { type: 'work_status_set', piece: 'work_1', line: 'reading', by: 'sess_child' },
        adds: 0,
      },
      {
        event: { type: 'work_rebriefed', piece: 'work_1', brief: 'read it all', by: 'sess_parent' },
        adds: 0,
      },
      { event: { type: 'work_closed', piece: 'work_1', by: 'sess_parent' }, adds: 0 },
      // ⚑ D-047 · the giver's own record of a give: it lands on the `give_work` call that wrote it,
      // and adds no row of its own.
      {
        event: {
          type: 'work_sent',
          piece: 'work_1',
          label: 'W1.1',
          as: 'given',
          to: 'sess_child',
          title: 'Read it',
          brief: 'read it all',
        },
        adds: 0,
      },
      // 394: where a request was sent. `adds: 0` is the RULING — the card it names is already drawn
      // in this very transcript, and a routing decision beside it would read as an instruction about
      // who should answer, which a person is never bound by.
      {
        event: { type: 'request_routed', requestId: 'req_1', to: 'the-parent', parent: 'sess_1' },
        adds: 0,
      },
      // 437: a worker asked about a named piece of work.
      //
      // 🔴 **474 · `adds: 1`, and the `adds: 0` ruling it replaces is still half true.** ⛔ The
      // WORDS are still not drawn — they are on the `ask_parent` tool call in this very transcript
      // and again in the PARENT's, so a third copy would be the one with no sender. ⚑ **What is
      // drawn is the EDGE**: which work the conversation stopped over, which `463` F4 measured as
      // written and thrown away and which nothing on this page said. ⚠️ The tool call above names a
      // `task_<uuid4>`, which is not a sentence a person reads.
      //
      // ⛔ **This fixture's piece was never given in this state**, so the notice names no label
      // — the honest absence, and the `adds` count is the same either way.
      {
        event: {
          type: 'question_asked',
          requestId: 'req_1',
          piece: 'work_1',
          prompt: 'which database?',
          questions: [{ id: 'answer', prompt: 'which database?', options: [] }],
        },
        adds: 1,
      },
      // 🔴 **395: who asked this turn to stop. `adds: 1`, and it is the ONE app-authored gesture
      // that draws.** ⛔ `user_command` above adds nothing because *"the conversation already shows
      // every consequence"* — and for an interruption that argument covers only THAT it stopped.
      // `turn:'interrupted'` has four producers and names none of them, so without this notice the
      // surface can show that work stopped and cannot show that somebody stopped it, which is the
      // false-provider-bug the dispatch exists to prevent.
      { event: { type: 'work_interrupted', by: 'an-agent', agent: 'sess_p' }, adds: 1 },
      // 🔴 **730 · R83: `adds: 1`** — *"Codex has not answered the stop"*, drawn now (`723` wrote
      // the fact, `723`'s response F-3 left the words to the frontend). See `stop-unanswered.ts`.
      { event: { type: 'stop_unanswered', waitedMs: 2_000, by: 'a-person' }, adds: 1 },
      // ⛔ **396: `adds: 0`, and it is `request_routed`'s ruling.** The card this row closes was
      // drawn in the life that ended — a stranded request is by definition one a LAUNCH found open —
      // so a notice here would announce the disappearance of something this transcript is not
      // showing. ⚑ The reader it has consequences for is the parent, through `list_questions`.
      { event: { type: 'request_stranded', requestId: 'req_1' }, adds: 0 },
      // ⛔ **397: `adds: 0`, and the reason is the row above it rather than the one above THAT.**
      // `work_interrupted` already draws *"asked to stop by …"* (709), and the app writes one of these per open
      // card — so a notice here would print one gesture two, three or four times in a row, directly
      // under the sentence that already said it. ⚑ The reader it has consequences for is the parent,
      // through `list_questions`, exactly as a stranding is.
      { event: { type: 'request_interrupted', requestId: 'req_1' }, adds: 0 },
      // ⛔ **D-009: `adds: 0`, `request_interrupted`'s reason one act over** — a withdrawal is the
      // asker's own tool call, already on screen, and a recipient's ending reaches the asker as the
      // app's own message, which is drawn. ⚑ (591's `request_work_withdrawn` is gone at D-016: the
      // questions fold ends a piece's questions on `work_taken_back` itself.)
      { event: { type: 'question_withdrawn', requestId: 'req_1' }, adds: 0 },
      {
        event: { type: 'question_recipient_ended', requestId: 'req_1', recipient: 'sess_b' },
        adds: 0,
      },
      // A question passed up, ended with the piece the one it carried was about: no item.
      {
        event: { type: 'question_ended_with_its_piece', requestId: 'req_1', ending: 'work-closed' },
        adds: 0,
      },
      // ⛔ **398: `adds: 0`, and this is a ruling about the SURFACE rather than about a duplicate.**
      // Both edges arrive in pairs and a long turn can hold several; drawing them would put
      // *"nothing happened"* rows into a transcript at exactly the moments there is nothing to read.
      // ⚑ The instrument a person already has is truer and live — `LivenessTracker` publishes
      // `silent` on the same window beside the header — and the reader it has consequences for is
      // the parent, through `list_tasks`.
      { event: { type: 'work_restarted' }, adds: 0 },
      // ⛔ **673: `adds: 0`, as every reopen drew before the row existed** — the row is for the task
      // fold. ⚠️ Not a duplicate: the transcript draws no seam line at all (a finding, not a ruling).
      { event: { type: 'reopened' }, adds: 0 },
      // ⚑ **T-002 · D-004 (R101): `adds: 1`** — a reopen this app made BY ITSELF on a renewed
      // sign-in says so in one line, under the stop it answers.
      { event: { type: 'reopened', because: 'the-sign-in-was-renewed' }, adds: 1 },
      // An agent's restore from the archive: `adds: 1`, the line that names the agent.
      {
        event: {
          type: 'restored_from_archive',
          saying: 'Brought back from the archive: Ada restored it.',
        },
        adds: 1,
      },
      // ⛔ **D-017 · R4: `adds: 0`, for `reopened`'s reason one row up** — the row is for the
      // question fold (which requests a later terminal status abandons), and nothing was said.
      { event: { type: 'launched' }, adds: 0 },
      // ⚑ A launch that could not use the text pack it was named says so in one line, from its own
      // record; a launch that used one says nothing here (the agent-input popup names its folder).
      {
        event: {
          type: 'launched',
          given: aLaunchRecordIn({
            placement: 'first-message',
            textPack: { folder: '/fictional/pack', refused: { kind: 'core-missing' } },
          })!,
        },
        adds: 1,
      },
      {
        event: {
          type: 'launched',
          given: aLaunchRecordIn({
            placement: 'first-message',
            textPack: { folder: '/fictional/pack', refused: null },
          })!,
        },
        adds: 0,
      },
      // 🔴 **D-017 · R10: `adds: 1` at each end of a replacement** — a person reading either
      // conversation is told the other one holds what comes next; nothing else in either ledger
      // says so (`transcript.ts`' arm).
      { event: { type: 'replaced_by', sessionId: 'sess_new' }, adds: 1 },
      { event: { type: 'replaces', sessionId: 'sess_old' }, adds: 1 },
      // ⛔ **404: `adds: 0`, and it is a duplicate rather than a ruling about the surface.** This row
      // (`work_stall_told`, `work_reported` until D-016) is written into the PARENT's ledger directly
      // under the notice it records, and that notice is an ordinary `user_turn` this transcript
      // already draws. ⚑ Its `set-right` member draws nothing either, for the same reason.
      {
        event: { type: 'work_stall_told', piece: 'work_1', cause: 'app_restarted', how: 'pushed' },
        adds: 0,
      },
      { event: { type: 'work_stall_told', piece: 'work_1', how: 'set-right' }, adds: 0 },
      {
        event: {
          type: 'work_reconciliation',
          incident: 'incident_1',
          piece: 'work_1',
          kind: 'stopped',
          since: 10,
          step: 'person',
          outcome: 'listed',
        },
        adds: 0,
      },
      {
        event: {
          type: 'work_recovery',
          turn: 'turn_1',
          pieces: ['work_1'],
          since: 10,
          phase: 'pending',
        },
        adds: 0,
      },
      // ⛔ **398: `adds: 0`, and `request_interrupted`'s reason with the sign flipped.** The row is
      // written into the CHILD's ledger and is about the PARENT's silence — this conversation did
      // nothing, and a notice here would tell the wrong conversation about the wrong actor. ⚑ It
      // belongs in the person's queue, which is what `questionsForAPerson` answers.
      { event: { type: 'request_escalated', requestId: 'req_1' }, adds: 0 },
      // ⛔ **405: `adds: 1`, and it is the ONE app-authored row in this sweep that draws.** Every
      // `adds: 0` above it is *"the conversation already shows this"*; `402` F2 measured that for a
      // refusal the conversation shows the OPPOSITE — `tool_call` and `tool_result ok: true`, which
      // is what an admitted call looks like. ⚑ HO-019 §4: *a person reading a transcript should be
      // able to see that an agent tried something and was told no.*
      {
        event: {
          type: 'tool_refused',
          tool: 'spawn_agent',
          rail: 'not-in-can-spawn',
          permanence: 'until-a-person-changes-it',
          retryable: false,
        },
        adds: 1,
      },
      // ⛔ **415 · a notice, like the refusal above it** — the reply is recorded and reached nobody,
      // and the transcript is where the person who can do something about it is looking.
      {
        event: {
          type: 'reply_undelivered',
          piece: 'work_1',
          parent: 'sess_parent',
          because: 'no-conversation',
        },
        adds: 1,
      },
      // ⚑ **D-042 · 682's set-aside notice went, with the stand-in re-judge that wrote it.** No
      // launch sets a person's choice aside any more: R1 names the pair each conversation runs on
      // and records it on its row, and a model outside the list is refused at the give
      // (`refuseModel`) before anything starts — so there is no row left to draw.
      // ⛔ **439: `adds: 0`, and it is `work_stall_told`'s duplicate argument pointed the other
      // way.** This row is written into the SENDER's ledger, and the act it records is already on
      // screen there as the `message_agent` tool call that performed it. ⚑ **What the row carries
      // that the call cannot** — the kind, the delivery, the piece it is about, whether a person is
      // at this conversation — is structure rather than narration, and the raw Events tab prints
      // all of it.
      {
        event: {
          type: 'message_sent',
          to: 'sess_pm',
          toProfile: 'project-manager',
          kind: 'follow-up',
          delivery: 'queued',
          messageId: 'msg_1',
          piece: 'work_1',
          label: 'W1.7',
          onBehalfOfAPerson: true,
        },
        adds: 0,
      },
      // ⛔ **582: `adds: 1`, and it is a NOTICE rather than a card** — an instruction ask is
      // answered on the identity it is about, beside the versions it would change, so this
      // transcript tells a person it happened and where to answer it.
      {
        event: {
          type: 'instruction_proposed',
          askId: 'iprop_1',
          ask: 'propose',
          about: 'worker',
          proposedBy: 'default',
          text: 'Never force-push.',
          why: 'it keeps coming up',
        },
        adds: 1,
      },
      // ⛔ **582: `adds: 1`, which is where it parts from `user_decision`.** That one ANNOTATES a
      // card that is already here; this one has nothing to annotate, because the ask above is a
      // notice and a notice carries no state a later row can change.
      { event: { type: 'instruction_settled', askId: 'iprop_1', ending: 'approved' }, adds: 1 },
      {
        event: {
          type: 'instruction_changed',
          conversation: 'ses-wren',
          profile: 'lark',
          version: 2,
          previousVersion: 1,
          author: { profile: 'wren', name: 'Wren' },
          replacedPersonVersion: 1,
        },
        adds: 1,
      },
      // An agent's request to register an MCP server is a notice too: its card is under Waiting on
      // you. Its ending rewrites that line when it is on the page, and adds one when it is not.
      {
        event: {
          type: 'mcp_server_requested',
          requestId: 'msreq_1',
          name: 'kibana',
          url: 'http://127.0.0.1:8765/mcp',
          reaches: 'reads the logs',
          whoGetsIt: 'everyone',
          requestedBy: 'default',
        },
        adds: 1,
      },
      {
        event: { type: 'mcp_server_request_settled', requestId: 'msreq_1', ending: 'approved' },
        adds: 1,
      },
    ]
    // ⛔ **Non-vacuity, and it is the COMPILER's now rather than a pinned number** (318).
    //
    // ⚠️ **The pinned count was `toBe(5)` and it did not fail when a sixth app-authored type
    // arrived** — because it counts this hand-written list against itself. It caught an entry being
    // deleted and was blind to a type being added, which is the only direction that has ever
    // happened here. `TranscriptEvent` minus `RuntimeEvent` is still not enumerable at runtime, so
    // the roster is declared as a `Record` over the literal union instead: it does not COMPILE until
    // a new app-authored event is named, and the assertion then holds the list above to it.
    const roster: Record<Exclude<TranscriptEvent, RuntimeEvent>['type'], true> = {
      worker_registered: true,
      instruction_proposed: true,
      instruction_changed: true,
      instruction_settled: true,
      mcp_server_requested: true,
      mcp_server_request_settled: true,
      user_turn: true,
      user_decision: true,
      message_queued: true,
      message_unqueued: true,
      user_command: true,
      memory_note: true,
      memory_loaded: true,
      // ⚑ **D-016's piece rows**, and they arrived as compile errors like every one before them.
      work_given: true,
      work_replied: true,
      work_taken_back: true,
      work_retitled: true,
      work_status_set: true,
      work_rebriefed: true,
      work_closed: true,
      // ⚑ **D-047's**, and it arrived as a compile error like every one before it.
      work_sent: true,
      request_routed: true,
      message_sent: true,
      work_interrupted: true,
      // ⚑ **723's**, and it arrived as a compile error like every one before it.
      stop_unanswered: true,
      request_stranded: true,
      // ⚑ **D-009's two**, and each arrived as a compile error.
      question_withdrawn: true,
      question_recipient_ended: true,
      question_ended_with_its_piece: true,
      request_interrupted: true,
      work_restarted: true,
      reopened: true,
      // An agent's restore from the archive.
      restored_from_archive: true,
      // ⚑ **D-017 · R4's launch marker**, and it arrived as a compile error like every one before it.
      launched: true,
      // ⚑ **D-017 · R10's pair**, and they arrived the same way.
      replaced_by: true,
      replaces: true,
      work_stall_told: true,
      work_reconciliation: true,
      work_recovery: true,
      request_escalated: true,
      tool_refused: true,
      reply_undelivered: true,
      // ⚑ **D-042** · 682's `model_choice_set_aside` went (see the sweep above).
      // ⚑ **437's question row, and it arrived as a compile error like every one before it.**
      question_asked: true,
    }
    expect(
      [...new Set(ours.map((o) => o.event.type))].sort(),
      'an app-authored type is missing from this sweep',
    ).toEqual(Object.keys(roster).sort())

    for (const { event, adds } of ours) {
      const state = createTranscript()
      expect(() => applyEvent(state, event)).not.toThrow()
      expect(state.items.length, event.type).toBe(adds)
      expect(describeEvent(event), event.type).not.toBe('')
    }
  })
})

describe('transcript fold — an agent the agent dispatched (029)', () => {
  /**
   * The dispatching row, exactly as `normalizeMessage` emits it. Named `Agent` because that is
   * what this machine's dispatch tool is actually called — but the fold reads no names at all, and
   * that is the point: the binding is `parentToolCallId`, so the tool could be called anything.
   */
  const dispatch = (callId = 'toolu_task'): RuntimeEvent => ({
    type: 'tool_call',
    id: callId,
    name: 'Agent',
    summary: 'Report working directory',
  })

  const started = (agentId: string, parentToolCallId?: string): RuntimeEvent => ({
    type: 'sub_agent',
    agentId,
    phase: 'started',
    ...(parentToolCallId ? { parentToolCallId } : {}),
    kind: 'general-purpose',
    title: 'Report working directory',
  })

  const cardsOn = (state: TranscriptState, callId: string): SubAgentCard[] => {
    const tool = state.items.find(
      (item): item is ToolItem & { at?: number } => item.kind === 'tool' && item.callId === callId,
    )
    return tool?.subAgents ?? []
  }

  it('nests the card INSIDE the row that dispatched it', () => {
    const state = feed(createTranscript(), dispatch(), started('a1', 'toolu_task'))
    expect(cardsOn(state, 'toolu_task')).toHaveLength(1)
    expect(cardsOn(state, 'toolu_task')[0]).toMatchObject({
      agentId: 'a1',
      kind: 'general-purpose',
      title: 'Report working directory',
      running: true,
    })
    // …and it is NOT a top-level item competing with the conversation.
    expect(state.items.some((item) => item.kind === 'subAgent')).toBe(false)
  })

  it('binds by parentToolCallId, NOT by what happened to arrive last', () => {
    // The claim 029 rests on. Two dispatches are open at once and the card names the FIRST, so
    // adjacency and identity disagree — which is the only arrangement that can tell them apart.
    const state = feed(
      createTranscript(),
      dispatch('toolu_first'),
      dispatch('toolu_second'),
      started('a1', 'toolu_first'),
    )
    expect(cardsOn(state, 'toolu_first').map((c) => c.agentId)).toEqual(['a1'])
    expect(cardsOn(state, 'toolu_second')).toHaveLength(0)
  })

  it('a card that arrives BEFORE its row is kept, then adopted when the row lands', () => {
    const state = createTranscript()
    applyEvent(state, started('a1', 'toolu_task'))
    // Never dropped: it renders at top level rather than vanishing because it was early.
    expect(state.items.filter((item) => item.kind === 'subAgent')).toHaveLength(1)
    applyEvent(state, dispatch())
    expect(state.items.some((item) => item.kind === 'subAgent')).toBe(false)
    expect(cardsOn(state, 'toolu_task').map((c) => c.agentId)).toEqual(['a1'])
    // And it is still the SAME card — a later phase must find it in its new home.
    applyEvent(state, { type: 'sub_agent', agentId: 'a1', phase: 'ended', outcome: 'completed' })
    expect(cardsOn(state, 'toolu_task')[0]).toMatchObject({ running: false, outcome: 'completed' })
  })

  it("routes the CHILD's tool calls into its card, not into the parent conversation", () => {
    // The misattribution 029 found: Claude forwards a sub-agent's tool blocks into the parent
    // stream by default, and nothing read `parent_tool_use_id` — so the child's Bash rendered as
    // if the parent had run it, with nothing on screen to betray it.
    const state = feed(
      createTranscript(),
      dispatch(),
      started('a1', 'toolu_task'),
      {
        type: 'tool_call',
        id: 'child_1',
        name: 'Bash',
        summary: 'ls',
        parentToolCallId: 'toolu_task',
      },
      {
        type: 'tool_result',
        id: 'child_1',
        summary: 'notes.txt',
        ok: true,
        parentToolCallId: 'toolu_task',
      },
      { type: 'tool_call', id: 'own_1', name: 'Read', summary: 'notes.txt' },
    )
    // Exactly two tool ROWS in the conversation: the dispatch and the parent's own Read.
    const rows = state.items.filter((item): item is ToolItem => item.kind === 'tool')
    expect(rows.map((r) => r.callId)).toEqual(['toolu_task', 'own_1'])
    // The child's call and its result live on the card.
    const card = cardsOn(state, 'toolu_task')[0]
    expect(card?.body).toEqual([
      {
        kind: 'tool',
        callId: 'child_1',
        name: 'Bash',
        summary: 'ls',
        result: { summary: 'notes.txt', ok: true },
      },
    ])
    expect(card?.lastTool).toBe('Bash')
  })

  it('MERGES phases — a later one never blanks what an earlier one reported', () => {
    // `task_updated` carries no `tool_use_id` and no `subagent_type` at all, so treating absence
    // as "cleared" would wipe the card's heading at the exact moment it finished.
    const state = feed(
      createTranscript(),
      dispatch(),
      started('a1', 'toolu_task'),
      {
        type: 'sub_agent',
        agentId: 'a1',
        phase: 'progress',
        parentToolCallId: 'toolu_task',
        lastTool: 'Bash',
        usage: { tokens: 6997, toolCalls: 1, ms: 7798 },
      },
      { type: 'sub_agent', agentId: 'a1', phase: 'ended', outcome: 'completed' },
    )
    expect(cardsOn(state, 'toolu_task')[0]).toMatchObject({
      kind: 'general-purpose',
      title: 'Report working directory',
      lastTool: 'Bash',
      usage: { tokens: 6997, toolCalls: 1, ms: 7798 },
      running: false,
      outcome: 'completed',
    })
  })

  it('both endings are idempotent — whichever arrives, the card stops running exactly once', () => {
    // `task_updated` and `task_notification` BOTH report the ending and both are mapped, so that a
    // run producing only one of them still cannot leave a card spinning.
    const state = feed(
      createTranscript(),
      dispatch(),
      started('a1', 'toolu_task'),
      { type: 'sub_agent', agentId: 'a1', phase: 'ended', outcome: 'completed' },
      {
        type: 'sub_agent',
        agentId: 'a1',
        phase: 'ended',
        parentToolCallId: 'toolu_task',
        outcome: 'completed',
        summary: '/Users/alex/brobot2-scratch',
        usage: { tokens: 8944, ms: 2041 },
      },
    )
    expect(cardsOn(state, 'toolu_task')).toHaveLength(1)
    expect(cardsOn(state, 'toolu_task')[0]).toMatchObject({
      running: false,
      outcome: 'completed',
      summary: '/Users/alex/brobot2-scratch',
    })
  })

  it('reclaims a child call that landed in the conversation before the card existed', () => {
    // The child's tool blocks and its `task_started` arrive on DIFFERENT messages, so the child can
    // be seen working before it is known to exist. Left alone, that window renders the child's work
    // as the parent's — the exact misattribution 029 exists to end, surviving as a race.
    const state = feed(
      createTranscript(),
      dispatch(),
      {
        type: 'tool_call',
        id: 'child_1',
        name: 'Bash',
        summary: 'ls',
        parentToolCallId: 'toolu_task',
      },
      {
        type: 'tool_result',
        id: 'child_1',
        summary: 'notes.txt',
        ok: true,
        parentToolCallId: 'toolu_task',
      },
    )
    // Before the card exists it has nowhere to go, so it is visible rather than lost.
    expect(state.items.filter((i) => i.kind === 'tool').map((i) => (i as ToolItem).callId)).toEqual(
      ['toolu_task', 'child_1'],
    )
    applyEvent(state, started('a1', 'toolu_task'))
    // …and the moment the card appears it takes its call back, result and all.
    expect(state.items.filter((i) => i.kind === 'tool').map((i) => (i as ToolItem).callId)).toEqual(
      ['toolu_task'],
    )
    expect(cardsOn(state, 'toolu_task')[0]?.body).toEqual([
      {
        kind: 'tool',
        callId: 'child_1',
        name: 'Bash',
        summary: 'ls',
        result: { summary: 'notes.txt', ok: true },
      },
    ])
  })

  it('re-homes a card that a LATER phase is the first to give a parent', () => {
    // `task_started` may omit the dispatch id and `task_updated` always does, so placement cannot
    // be decided once: a card created parentless would otherwise sit at top level for the rest of
    // the session with its row visible right above it.
    const state = createTranscript()
    applyEvent(state, dispatch())
    applyEvent(state, { type: 'sub_agent', agentId: 'a1', phase: 'started', kind: 'Explore' })
    expect(state.items.filter((item) => item.kind === 'subAgent')).toHaveLength(1)
    applyEvent(state, {
      type: 'sub_agent',
      agentId: 'a1',
      phase: 'ended',
      parentToolCallId: 'toolu_task',
      outcome: 'completed',
    })
    expect(state.items.some((item) => item.kind === 'subAgent')).toBe(false)
    expect(cardsOn(state, 'toolu_task')[0]).toMatchObject({ agentId: 'a1', outcome: 'completed' })
  })

  it('never lets a usage counter go BACKWARDS between reports', () => {
    // The live capture has a `task_notification` carrying `tool_uses: 0` after heartbeats that
    // reported more. Taken verbatim it made the header say "0 tools" while the card's own body
    // listed the calls we had watched it make — two numbers on one card contradicting each other.
    const state = feed(
      createTranscript(),
      dispatch(),
      started('a1', 'toolu_task'),
      {
        type: 'sub_agent',
        agentId: 'a1',
        phase: 'progress',
        usage: { tokens: 6997, toolCalls: 3, ms: 7798 },
      },
      {
        type: 'sub_agent',
        agentId: 'a1',
        phase: 'ended',
        usage: { tokens: 8944, toolCalls: 0, ms: 2041 },
        outcome: 'completed',
      },
    )
    expect(cardsOn(state, 'toolu_task')[0]?.usage).toEqual({
      tokens: 8944, // still climbs where the later report is genuinely larger
      toolCalls: 3, // …but never drops below what we already watched happen
      ms: 7798,
    })
  })

  it('the turn ending stops a running card WITHOUT inventing an outcome', () => {
    // "We were never told how it went" is a different fact from "it succeeded", and only the
    // provider gets to state the second one.
    const state = feed(createTranscript(), dispatch(), started('a1', 'toolu_task'), {
      type: 'turn',
      state: 'completed',
    })
    expect(cardsOn(state, 'toolu_task')[0]).toMatchObject({ running: false })
    expect(cardsOn(state, 'toolu_task')[0]).not.toHaveProperty('outcome')
  })

  it('a session that ends MID-turn stops its cards too (found by 037)', () => {
    // The gap the session panel exposed. Three of the four endings swept running cards — the turn,
    // a reopen, a read-only recording — and the terminal one did not, because a turn normally ends
    // first and has already done it. Closing a session while an agent runs skips that: there is no
    // `turn` event, and every card kept claiming to be running about a process that died with the
    // session. Easy to miss as a spinner in a long thread; impossible to miss in a panel whose job
    // is to list what is running.
    const state = feed(createTranscript(), dispatch(), started('a1', 'toolu_task'), {
      type: 'status',
      state: 'ended',
    })
    expect(cardsOn(state, 'toolu_task')[0]).toMatchObject({ running: false })
    // Still no invented outcome: we were never told how it went.
    expect(cardsOn(state, 'toolu_task')[0]).not.toHaveProperty('outcome')
  })

  it('a fatal error stops them by the same path', () => {
    const state = feed(createTranscript(), dispatch(), started('a1', 'toolu_task'), {
      type: 'error',
      message: 'the provider died',
      fatal: true,
    })
    expect(cardsOn(state, 'toolu_task')[0]).toMatchObject({ running: false })
  })

  it('reopening never leaves a card spinning about a process that died with the session', () => {
    const state = feed(createTranscript(), dispatch(), started('a1', 'toolu_task'), {
      type: 'sub_agent',
      agentId: 'a1',
      phase: 'progress',
      lastTool: 'Bash',
    })
    markReopened(state)
    expect(cardsOn(state, 'toolu_task')[0]).toMatchObject({ running: false })
    expect(cardsOn(state, 'toolu_task')[0]).not.toHaveProperty('outcome')
  })

  /**
   * An agent's agent (035) — 029's known limit, closed.
   *
   * The chain is three links: the conversation dispatches A with `toolu_task`; A makes its own call
   * `toolu_inner`, which lands on A's card rather than in the conversation; that call dispatches B.
   * B's parent is therefore an id that is deliberately NOT in `state.toolItems` — it has no row —
   * so B looked parentless and stranded at top level, beside the conversation, with nothing on
   * screen connecting it to the work that asked for it.
   */
  describe("an agent's own agent (035)", () => {
    const inner = (): RuntimeEvent => ({
      type: 'tool_call',
      id: 'toolu_inner',
      name: 'Agent',
      summary: 'check the lockfile',
      parentToolCallId: 'toolu_task',
    })
    const grandchild = (): RuntimeEvent => ({
      type: 'sub_agent',
      agentId: 'b1',
      phase: 'started',
      parentToolCallId: 'toolu_inner',
      kind: 'Explore',
      title: 'check the lockfile',
    })
    /** The card hanging off one of another card's OWN calls. */
    const nestedOn = (state: TranscriptState, callId: string): SubAgentCard[] =>
      cardsOn(state, 'toolu_task')[0]?.body.find(
        (row): row is SubAgentToolRow => row.kind === 'tool' && row.callId === callId,
      )?.subAgents ?? []

    it('nests under the CALL that dispatched it, inside its parent agent', () => {
      const state = feed(
        createTranscript(),
        dispatch(),
        started('a1', 'toolu_task'),
        inner(),
        grandchild(),
      )
      expect(nestedOn(state, 'toolu_inner')).toHaveLength(1)
      expect(nestedOn(state, 'toolu_inner')[0]).toMatchObject({ agentId: 'b1', kind: 'Explore' })
      // The thing that was wrong: nothing left over at top level.
      expect(state.items.some((item) => item.kind === 'subAgent')).toBe(false)
      // …and A still holds exactly one card of its own, in the row that dispatched it.
      expect(cardsOn(state, 'toolu_task')).toHaveLength(1)
    })

    it('…in EITHER order — the binding is the id, not who arrived first', () => {
      // The grandchild announces itself before the call that dispatched it is folded. It renders at
      // top level meanwhile — never dropped — and is adopted the moment its parent call appears.
      const state = feed(createTranscript(), dispatch(), started('a1', 'toolu_task'), grandchild())
      expect(state.items.filter((item) => item.kind === 'subAgent')).toHaveLength(1)
      feed(state, inner())
      expect(nestedOn(state, 'toolu_inner')).toHaveLength(1)
      expect(state.items.some((item) => item.kind === 'subAgent')).toBe(false)
    })

    it('the grandchild keeps its own work, and its ending still finds it', () => {
      const state = feed(
        createTranscript(),
        dispatch(),
        started('a1', 'toolu_task'),
        inner(),
        grandchild(),
        {
          type: 'tool_call',
          id: 'g_1',
          name: 'Read',
          summary: 'pnpm-lock.yaml',
          parentToolCallId: 'toolu_inner',
        },
        {
          type: 'tool_result',
          id: 'g_1',
          summary: 'ok',
          ok: true,
          parentToolCallId: 'toolu_inner',
        },
        {
          type: 'sub_agent',
          agentId: 'b1',
          phase: 'ended',
          outcome: 'completed',
          summary: 'clean',
        },
      )
      const card = nestedOn(state, 'toolu_inner')[0]
      expect(card).toMatchObject({ running: false, outcome: 'completed', summary: 'clean' })
      expect(card?.body).toEqual([
        {
          kind: 'tool',
          callId: 'g_1',
          name: 'Read',
          summary: 'pnpm-lock.yaml',
          result: { summary: 'ok', ok: true },
        },
      ])
      // The grandchild's Read is ITS work, so it must not also be a row in the conversation.
      expect(state.items.some((item) => item.kind === 'tool' && item.callId === 'g_1')).toBe(false)
    })

    it('a card whose parent call never arrives still renders, at top level', () => {
      // The honest fallback, unchanged from 029: better a card with no visible parent than no card.
      const state = feed(createTranscript(), grandchild())
      expect(state.items.filter((item) => item.kind === 'subAgent')).toHaveLength(1)
    })

    it('the turn ending stops it too — nesting must not hide a card from the sweep (035 review)', () => {
      // The bug this test exists for: 029's "nothing is left spinning" sweep walked one level, which
      // was the whole truth until a card could live inside another card's tool entry. A grandchild
      // would have gone on claiming to be running, forever, about a process that ended with the turn
      // — and it is the deepest card, so the least likely to be noticed.
      const running = feed(
        createTranscript(),
        dispatch(),
        started('a1', 'toolu_task'),
        inner(),
        grandchild(),
      )
      expect(nestedOn(running, 'toolu_inner')[0]).toMatchObject({ running: true })
      feed(running, { type: 'turn', state: 'completed' })
      expect(nestedOn(running, 'toolu_inner')[0]).toMatchObject({ running: false })
      // …and still no invented outcome, at any depth.
      expect(nestedOn(running, 'toolu_inner')[0]).not.toHaveProperty('outcome')

      // The same holds for a ledger replayed after the app was quit.
      const replayed = feed(
        createTranscript(),
        dispatch(),
        started('a1', 'toolu_task'),
        inner(),
        grandchild(),
      )
      markReopened(replayed)
      expect(nestedOn(replayed, 'toolu_inner')[0]).toMatchObject({ running: false })
    })
  })

  /**
   * **The OTHER grandchild — the one whose dispatch happened on another connection** (135).
   *
   * ⚑ **035's chain and this one are the same picture from two providers, and only one of them has
   * a middle link.** Claude forwards a child's tool blocks into the parent stream, so the `Agent`
   * call that spawns a depth-2 agent is on our wire and the block above nests the card under it —
   * measured, twice, in `sess_6b4380fa`. Codex runs each child on its own thread with its own
   * connection, so the equivalent call is announced to the CHILD and never to us: the grandchild
   * arrives as `{agentId, idKind:'thread', origin:'observed'}` and nothing else.
   *
   * ⛔ So the fold must NOT put it under the depth-1 card. There is no id to bind it with, and the
   * only candidate — "the other agent we happen to know about" — is a guess. Top level, saying so.
   */
  describe('a nested agent nobody announced (135)', () => {
    const CHILD = '019ff855-9c0d-7951-bd56-f7e914581198'
    const GRAND = '019ff856-3833-7d11-bd85-c3bd5a0368c0'
    /** The measured provider-event shape used by `CodexSubAgents`. */
    const announcedChild = (): RuntimeEvent => ({
      type: 'sub_agent',
      agentId: CHILD,
      idKind: 'thread',
      phase: 'started',
      parentToolCallId: 'call_LmwDmS9Oiq9Bov0hAVqRAT3Q',
      kind: 'ui_test',
    })
    const observedGrandchild = (): RuntimeEvent => ({
      type: 'sub_agent',
      agentId: GRAND,
      idKind: 'thread',
      phase: 'started',
      origin: 'observed',
    })
    const tops = (state: TranscriptState): SubAgentCard[] =>
      state.items.filter((item) => item.kind === 'subAgent').map((item) => item.card)

    it('gets a card of its own, carrying the fact that nothing announced it', () => {
      const state = feed(createTranscript(), announcedChild(), observedGrandchild())
      expect(tops(state).map((c) => c.agentId)).toEqual([CHILD, GRAND])
      expect(tops(state)[1]).toMatchObject({ origin: 'observed', idKind: 'thread', running: true })
      // ⛔ No parent invented — not the depth-1 child's dispatch, not anything else.
      expect(tops(state)[1]).not.toHaveProperty('parentToolCallId')
      expect(tops(state)[1]).not.toHaveProperty('kind')
    })

    it('⛔ never lands inside the depth-1 card, whose own rows stay its own', () => {
      // Two agents ran; two cards. The depth-1 card must not gain a body row, a nested card, or the
      // `observed` mark — 135 measured that every event on it names its own thread, before and after.
      const state = feed(createTranscript(), announcedChild(), observedGrandchild(), {
        type: 'sub_agent',
        agentId: GRAND,
        phase: 'ended',
      })
      const child = tops(state)[0]
      expect(child).toMatchObject({ agentId: CHILD, kind: 'ui_test', running: true })
      expect(child?.body).toEqual([])
      expect(child).not.toHaveProperty('origin')
      // …and the grandchild's own ending found the grandchild's own card.
      expect(tops(state)[1]).toMatchObject({ agentId: GRAND, running: false })
    })

    it('the raw event stream says nothing announced it, rather than showing a bare id', () => {
      // The Events log is where a reader goes to check what the provider really said. For this card
      // the answer is "nothing" — without the clause, the line is an id and reads as an agent whose
      // name the app merely failed to render.
      expect(describeEvent(observedGrandchild())).toBe(`started · ${GRAND} · nothing announced it`)
      // …and an announced child's line is unchanged, or the clause is decoration rather than a fact.
      expect(describeEvent(announcedChild())).toBe('started · ui_test')
    })

    it('the turn ending stops it like any other card', () => {
      const state = feed(createTranscript(), observedGrandchild(), {
        type: 'turn',
        state: 'completed',
      })
      expect(tops(state)[0]).toMatchObject({ agentId: GRAND, running: false })
      // Still no invented outcome: a thread going quiet says it stopped, never how it went.
      expect(tops(state)[0]).not.toHaveProperty('outcome')
    })
  })
})

describe('transcript fold — the agent`s checklist (028)', () => {
  const plan = (
    steps: Extract<RuntimeEvent, { type: 'plan_update' }>['steps'],
    rest: Partial<Omit<Extract<RuntimeEvent, { type: 'plan_update' }>, 'type' | 'steps'>> = {},
  ): RuntimeEvent => ({ type: 'plan_update', steps, ...rest })

  const planItems = (state: TranscriptState): PlanItem[] =>
    state.items.filter((item): item is PlanItem & { at?: number } => item.kind === 'plan')

  it('UPDATES IN PLACE and never accumulates — one block per turn, whatever the revision count', () => {
    // The acceptance criterion of the whole task. Three revisions of the same plan are ONE item
    // showing the latest state, not three items and not a growing list.
    const state = feed(
      createTranscript(),
      plan([
        { text: 'Create notes.txt', status: 'active' },
        { text: 'Count the lines', status: 'pending' },
      ]),
      plan([
        { text: 'Create notes.txt', status: 'done' },
        { text: 'Count the lines', status: 'active' },
      ]),
      plan(
        [
          { text: 'Create notes.txt', status: 'done' },
          { text: 'Count the lines', status: 'done' },
        ],
        { note: 'Created the file and verified its line count.' },
      ),
    )
    expect(planItems(state)).toHaveLength(1)
    expect(planItems(state)[0]).toMatchObject({
      steps: [
        { text: 'Create notes.txt', status: 'done' },
        { text: 'Count the lines', status: 'done' },
      ],
      note: 'Created the file and verified its line count.',
    })
  })

  it('REPLACES rather than merges, so a removed step really disappears', () => {
    // Claude's `deleted` reaches the fold as a SHORTER list, and merging would leave the abandoned
    // task on screen as a line the model is supposedly still working on.
    const state = feed(
      createTranscript(),
      plan([
        { text: 'Keep me', status: 'pending' },
        { text: 'Drop me', status: 'pending' },
      ]),
      plan([{ text: 'Keep me', status: 'done' }]),
    )
    expect(planItems(state)[0]?.steps).toEqual([{ text: 'Keep me', status: 'done' }])
  })

  it('a note that goes away is REMOVED, not left behind as a stale caption', () => {
    const state = feed(
      createTranscript(),
      plan([{ text: 'x', status: 'pending' }], { note: 'first pass' }),
      plan([{ text: 'x', status: 'active' }]),
    )
    expect(planItems(state)[0]).not.toHaveProperty('note')
  })

  it('a NEW turn opens a NEW block instead of rewriting the last one', () => {
    // Claude's task list outlives a turn, so turn 2 can restate a list built in turn 1. Mutating
    // the old block would silently rewrite history above where the reader is sitting.
    const state = feed(
      createTranscript(),
      plan([{ text: 'A', status: 'active' }]),
      { type: 'turn', state: 'completed' },
      plan([
        { text: 'A', status: 'done' },
        { text: 'B', status: 'active' },
      ]),
    )
    expect(planItems(state)).toHaveLength(2)
    expect(planItems(state)[0]?.steps).toEqual([{ text: 'A', status: 'active' }])
    expect(planItems(state)[1]?.steps).toHaveLength(2)
  })

  it('an EMPTY plan with nothing to say opens no block — it must not claim a plan exists', () => {
    const state = feed(createTranscript(), plan([]))
    expect(planItems(state)).toHaveLength(0)
    // But an already-open block is EMPTIED rather than left showing steps that are gone.
    const open = feed(createTranscript(), plan([{ text: 'A', status: 'active' }]), plan([]))
    expect(planItems(open)[0]?.steps).toEqual([])
  })

  it('`supersedes` marks the tool rows the checklist IS, and only those', () => {
    const state = feed(
      createTranscript(),
      { type: 'tool_call', id: 'toolu_a', name: 'TaskCreate', summary: '…' },
      { type: 'tool_call', id: 'toolu_bash', name: 'Bash', summary: 'ls' },
      plan([{ text: 'A', status: 'pending' }], { supersedes: ['toolu_a'] }),
    )
    const tools = state.items.filter((item): item is ToolItem => item.kind === 'tool')
    expect(tools.find((t) => t.callId === 'toolu_a')?.superseded).toBe(true)
    expect(tools.find((t) => t.callId === 'toolu_bash')?.superseded).toBeUndefined()
    // A superseding that names a call we never saw is a no-op, not a crash.
    expect(() =>
      applyEvent(state, plan([{ text: 'A', status: 'pending' }], { supersedes: ['nope'] })),
    ).not.toThrow()
  })

  it('replays to the FINAL recorded state, not a half-built one', () => {
    // Resume feeds the persisted ledger back through this same fold. Every event carries the whole
    // list, so the last one wins and the rehydrated conversation shows the plan as it ended.
    const state = feed(
      createTranscript(),
      plan([
        { text: 'A', status: 'active' },
        { text: 'B', status: 'pending' },
      ]),
      plan([
        { text: 'A', status: 'done' },
        { text: 'B', status: 'active' },
      ]),
      plan([
        { text: 'A', status: 'done' },
        { text: 'B', status: 'done' },
      ]),
    )
    markReopened(state)
    expect(planItems(state)).toHaveLength(1)
    expect(planItems(state)[0]?.steps.every((step) => step.status === 'done')).toBe(true)
    // Reopening forgets WHICH block it was, so the next session cannot overwrite the replayed one.
    applyEvent(state, plan([{ text: 'C', status: 'active' }]))
    expect(planItems(state)).toHaveLength(2)
  })

  it('the first checklist closes the streamed text; later revisions do not chop it', () => {
    // Same rule as a reasoning block: starting a plan is a real boundary, ticking a box is not.
    const state = feed(
      createTranscript(),
      { type: 'assistant_delta', text: 'Here is what I will do. ' },
      plan([{ text: 'A', status: 'pending' }]),
      { type: 'assistant_delta', text: 'Starting now. ' },
      plan([{ text: 'A', status: 'active' }]),
      { type: 'assistant_delta', text: 'Still going.' },
    )
    const assistants = state.items.filter(
      (item): item is AssistantItem => item.kind === 'assistant',
    )
    expect(assistants).toHaveLength(2)
    expect(assistants[1]?.text).toBe('Starting now. Still going.')
  })
})

describe('transcript fold — the live activity pill (027)', () => {
  it('replaces rather than accumulates, and never outlives the turn', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'activity', phase: 'thinking' })
    expect(state.activity).toEqual({ phase: 'thinking' })

    // Replaced wholesale — a pill says ONE thing about now.
    applyEvent(state, { type: 'activity', phase: 'waiting' })
    expect(state.activity).toEqual({ phase: 'waiting' })

    // A running tool IS the activity, derived from the neutral event rather than duplicated by
    // each adapter beside every call.
    applyEvent(state, { type: 'tool_call', id: 't1', name: 'Bash', summary: 'ls' })
    expect(state.activity).toEqual({ phase: 'tool', detail: 'Bash' })

    // …and the turn ending clears it. A stale "running Bash" after the turn is over is exactly
    // the kind of confident wrongness this app does not ship.
    applyEvent(state, { type: 'turn', state: 'completed' })
    expect(state.activity).toBeNull()
    // None of it left a line behind.
    expect(state.items.filter((item) => item.kind === 'thinking')).toHaveLength(0)
  })
})

describe('transcript fold — thinking (027)', () => {
  it('accumulates text into ONE block and closes it on complete', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'thinking', phase: 'delta', text: 'Plan' })
    applyEvent(state, { type: 'thinking', phase: 'delta', text: 'ning it' })
    const items = state.items.filter((item) => item.kind === 'thinking')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ text: 'Planning it', streaming: true, redacted: false })

    applyEvent(state, { type: 'thinking', phase: 'complete' })
    expect(state.items.find((item) => item.kind === 'thinking')).toMatchObject({ streaming: false })
  })

  it('a redacted block carries the count and NO words — the honest empty case', () => {
    // Both providers do this by default: Claude always, Codex until the turn asks for a summary.
    const state = createTranscript()
    applyEvent(state, { type: 'thinking', phase: 'delta', redacted: true, tokens: 165 })
    expect(state.items.find((item) => item.kind === 'thinking')).toMatchObject({
      text: '',
      redacted: true,
      tokens: 165,
    })
  })

  it('words arriving later cancel the redaction', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'thinking', phase: 'delta', redacted: true })
    applyEvent(state, { type: 'thinking', phase: 'delta', text: 'because 17 has no factors' })
    expect(state.items.find((item) => item.kind === 'thinking')).toMatchObject({
      text: 'because 17 has no factors',
      redacted: false,
    })
  })

  it('reasoning splits the reply ONCE, at the boundary — not on every delta', () => {
    // Claude reports thinking as a running token count: dozens of deltas per turn. Closing the
    // streamed text on each of them would chop one reply into a dozen blocks wherever reasoning
    // and text overlapped. Thinking and THEN speaking is a real boundary worth showing; thinking
    // a little more is not.
    const state = createTranscript()
    applyEvent(state, { type: 'assistant_delta', text: 'Before' })
    applyEvent(state, { type: 'thinking', phase: 'delta', redacted: true, tokens: 10 })
    applyEvent(state, { type: 'assistant_delta', text: 'After' })
    applyEvent(state, { type: 'thinking', phase: 'delta', redacted: true, tokens: 20 })
    applyEvent(state, { type: 'assistant_delta', text: 'More' })

    expect(state.items.map((item) => item.kind)).toEqual(['assistant', 'thinking', 'assistant'])
    expect(state.items.filter((item) => item.kind === 'assistant').map((i) => i.text)).toEqual([
      'Before',
      'AfterMore',
    ])
    // …and the later count still lands on the one block, rather than opening a second.
    expect(state.items.find((item) => item.kind === 'thinking')).toMatchObject({ tokens: 20 })
  })

  it('a turn that ends mid-thought closes the block rather than leaving it spinning', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'thinking', phase: 'delta', redacted: true })
    applyEvent(state, { type: 'turn', state: 'interrupted' })
    expect(state.items.find((item) => item.kind === 'thinking')).toMatchObject({ streaming: false })
  })

  it('a part boundary separates the parts and never invents a block (Codex summaryPartAdded)', () => {
    // The boundary event carries nothing at all — that emptiness IS the signal. On an open block
    // with words it does the one thing a boundary can do; with no block open it must do nothing,
    // because the block it would otherwise create claims a thought while being neither redacted
    // nor expandable: a "thought" pill with nothing behind it.
    const bare = { type: 'thinking', phase: 'delta' } as const
    const state = createTranscript()

    applyEvent(state, bare) // straggler: no block open
    expect(state.items).toHaveLength(0)

    applyEvent(state, { type: 'thinking', phase: 'delta', text: 'first part' })
    applyEvent(state, bare)
    applyEvent(state, { type: 'thinking', phase: 'delta', text: 'second part' })
    expect(state.items.filter((item) => item.kind === 'thinking')).toHaveLength(1)
    expect(state.items.find((item) => item.kind === 'thinking')?.text).toBe(
      'first part\n\nsecond part',
    )

    // …and never a LEADING break: a boundary before the first word has nothing to separate.
    const opened = createTranscript()
    applyEvent(opened, { type: 'thinking', phase: 'delta', redacted: true })
    applyEvent(opened, bare)
    applyEvent(opened, { type: 'thinking', phase: 'delta', text: 'words at last' })
    expect(opened.items.find((item) => item.kind === 'thinking')).toMatchObject({
      text: 'words at last',
      redacted: false,
    })
  })
})

/**
 * One Claude assistant message that mixes text and tool blocks now normalizes to MULTIPLE
 * `assistant_message` events around the `tool_call` (058, fixing 044 P3). The fold must render
 * that faithfully — every text run present exactly once, in order — because the deltas streamed
 * ALL of the message's text into a single open block before the authoritative events arrived.
 */
describe('transcript fold — mixed text/tool message (044 P3)', () => {
  it('renders [text, tool, text] in order with no duplicated or dropped text', () => {
    // The realistic stream: deltas carry every text run into ONE open block ("BEFOREAFTER"),
    // then the authoritative, source-ordered events land.
    const state = feed(
      createTranscript(),
      { type: 'assistant_delta', text: 'BEFORE' },
      { type: 'assistant_delta', text: 'AFTER' },
      { type: 'assistant_message', text: 'BEFORE' },
      { type: 'tool_call', id: 'tu_1', name: 'Bash', summary: 'echo hi' },
      { type: 'assistant_message', text: 'AFTER' },
    )

    expect(state.items.map((i) => i.kind)).toEqual(['assistant', 'tool', 'assistant'])
    // The first block is REPLACED by its authoritative run — the streamed 'AFTER' does not linger.
    expect(state.items[0]).toMatchObject({ kind: 'assistant', text: 'BEFORE', streaming: false })
    expect(state.items[1]).toMatchObject({ kind: 'tool', callId: 'tu_1' })
    expect(state.items[2]).toMatchObject({ kind: 'assistant', text: 'AFTER', streaming: false })
    expect(state.streamingId).toBeNull()

    // No text is duplicated across the fold, and nothing is lost.
    const rendered = state.items
      .filter((i): i is AssistantItem => i.kind === 'assistant')
      .map((i) => i.text)
    expect(rendered).toEqual(['BEFORE', 'AFTER'])
  })

  it('a tool result still correlates to its call when assistant text follows the call', () => {
    const state = feed(
      createTranscript(),
      { type: 'assistant_message', text: 'BEFORE' },
      { type: 'tool_call', id: 'tu_1', name: 'Bash', summary: 'echo hi' },
      { type: 'assistant_message', text: 'AFTER' },
      { type: 'tool_result', id: 'tu_1', summary: 'hi', ok: true },
    )

    const tool = state.items.find((i): i is ToolItem => i.kind === 'tool')
    expect(tool?.result).toMatchObject({ summary: 'hi', ok: true })
    expect(state.items.map((i) => i.kind)).toEqual(['assistant', 'tool', 'assistant'])
  })
})

/**
 * Claude partial-stream frames are now surfaced as classified `unknown` events instead of being
 * dropped (063). The fold must keep rendering the streamed text exactly once: the structural
 * frames arrive INTERLEAVED with the text deltas, so they must not split, duplicate, or close the
 * live assistant block.
 */
describe('transcript fold — interleaved Claude stream frames (060 P2)', () => {
  it('renders the streamed text exactly once despite classified frames between deltas', () => {
    const chatter = (category: 'lifecycle' | 'reasoning' | 'activity'): RuntimeEvent => ({
      type: 'unknown',
      provider: 'claude',
      category,
      raw: { frame: category },
    })

    const state = feed(
      createTranscript(),
      chatter('lifecycle'), // message_start
      chatter('lifecycle'), // content_block_start
      { type: 'assistant_delta', text: 'Hel' },
      chatter('reasoning'), // thinking_delta mid-stream
      { type: 'assistant_delta', text: 'lo' },
      chatter('lifecycle'), // content_block_stop
      { type: 'assistant_message', text: 'Hello' },
      chatter('lifecycle'), // message_stop
    )

    const assistants = state.items.filter((i): i is AssistantItem => i.kind === 'assistant')
    expect(assistants).toHaveLength(1) // ONE block, not one per frame boundary
    expect(assistants[0]).toMatchObject({ text: 'Hello', streaming: false })
    // The chatter is present (lossless) and quiet — it never became assistant text.
    expect(state.items.filter((i) => i.kind === 'unknown')).toHaveLength(5)
    expect(state.streamingId).toBeNull()
  })
})

/**
 * Codex warnings now arrive as NON-FATAL `error` events (065). The fold must make them visible
 * without ending the session — that distinction is the whole point of routing them here rather
 * than leaving them as quiet chatter.
 */
describe('transcript fold — non-fatal errors are visible but not terminal (065)', () => {
  it('a warning renders a visible `warn` notice and leaves the session usable', () => {
    const state = feed(
      createTranscript(),
      { type: 'assistant_delta', text: 'working' },
      { type: 'error', message: 'guardianWarning: sandbox escape attempt', fatal: false },
    )

    const notices = state.items.filter((i): i is NoticeItem => i.kind === 'notice')
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ level: 'warn' })
    expect(notices[0]?.text).toContain('guardianWarning')
    // NOT terminal: the live assistant block is untouched and the session is still going.
    expect(state.streamingId).not.toBeNull()
  })

  it('only a FATAL error terminalizes — the contrast that makes the warning routing safe', () => {
    const warned = feed(createTranscript(), {
      type: 'error',
      message: 'configWarning: bad key',
      fatal: false,
    })
    const fatal = feed(createTranscript(), {
      type: 'error',
      message: 'provider died',
      fatal: true,
    })

    const levels = (s: TranscriptState) =>
      s.items.filter((i): i is NoticeItem => i.kind === 'notice').map((i) => i.level)
    expect(levels(warned)).toEqual(['warn'])
    expect(levels(fatal)).toEqual(['error'])
    // Many warnings in a row still never end the session.
    const many = createTranscript()
    for (let i = 0; i < 5; i++) {
      applyEvent(many, { type: 'error', message: `warning: ${i}`, fatal: false })
    }
    expect(many.items.filter((i) => i.kind === 'notice')).toHaveLength(5)
  })
})

/**
 * A streamed run interrupted by a tool must not be rendered twice (068, fixing 066 F5). The deltas
 * are provisional; the authoritative `assistant_message` is the truth. Because a `tool_call` closes
 * the streaming block, the message could no longer find it and appended a second copy.
 */
describe('transcript fold — a tool-interrupted streamed run is reconciled, not duplicated (066 F5)', () => {
  it("the reviewer's probe: delta 'AFTER' → tool_call → message 'AFTER' renders [tool, assistant]", () => {
    const state = feed(
      createTranscript(),
      { type: 'assistant_delta', text: 'AFTER' },
      { type: 'tool_call', id: 'tu_1', name: 'Bash', summary: 'ls' },
      { type: 'assistant_message', text: 'AFTER' },
    )

    expect(state.items.map((i) => i.kind)).toEqual(['tool', 'assistant'])
    const assistants = state.items.filter((i): i is AssistantItem => i.kind === 'assistant')
    expect(assistants.map((i) => i.text)).toEqual(['AFTER']) // exactly once
  })

  it('the 063 interleaving still renders BOTH runs — reconciliation must not eat real text', () => {
    // The confirmed-then-tool-then-new-run case: the first message CONFIRMS the streamed block, so
    // it must survive; only an UNCONFIRMED block is superseded.
    const state = feed(
      createTranscript(),
      { type: 'assistant_delta', text: 'BEFORE' },
      { type: 'assistant_delta', text: 'AFTER' },
      { type: 'assistant_message', text: 'BEFORE' },
      { type: 'tool_call', id: 'tu_1', name: 'Bash', summary: 'ls' },
      { type: 'assistant_message', text: 'AFTER' },
    )
    expect(state.items.map((i) => i.kind)).toEqual(['assistant', 'tool', 'assistant'])
    expect(
      state.items.filter((i): i is AssistantItem => i.kind === 'assistant').map((i) => i.text),
    ).toEqual(['BEFORE', 'AFTER'])
  })

  it('a streamed run left unconfirmed when the TURN ends is kept, not deleted by a later turn', () => {
    // Nothing may retroactively remove a finished turn's rendering.
    const state = feed(
      createTranscript(),
      { type: 'assistant_delta', text: 'turn one text' },
      { type: 'turn', state: 'completed' },
      { type: 'tool_call', id: 'tu_2', name: 'Bash', summary: 'ls' },
      { type: 'assistant_message', text: 'turn two text' },
    )
    expect(
      state.items.filter((i): i is AssistantItem => i.kind === 'assistant').map((i) => i.text),
    ).toEqual(['turn one text', 'turn two text'])
  })

  it('a plain streamed run with no tool still reconciles in place (no gratuitous re-ordering)', () => {
    const state = feed(
      createTranscript(),
      { type: 'assistant_delta', text: 'Hel' },
      { type: 'assistant_delta', text: 'lo' },
      { type: 'assistant_message', text: 'Hello, world' },
    )
    expect(state.items).toHaveLength(1)
    expect(state.items[0]).toMatchObject({ kind: 'assistant', text: 'Hello, world' })
  })
})

/**
 * The neutral `label` (072): the adapter stamps the provider's own kind string, and the renderer
 * shows it WITHOUT knowing where it came from. The kind lives at a different path inside `raw` per
 * provider, so reading it in the renderer would force a Codex/Claude branch — the exact
 * provider-agnosticism this field exists to preserve.
 */
describe('transcript fold — the neutral unknown label (072)', () => {
  it('carries the label through to the item, from either provider, unchanged', () => {
    const state = feed(
      createTranscript(),
      {
        type: 'unknown',
        provider: 'codex',
        category: 'lifecycle',
        label: 'thread/compacted',
        raw: {},
      },
      {
        type: 'unknown',
        provider: 'claude',
        category: 'reasoning',
        label: 'thinking_delta',
        raw: {},
      },
    )
    expect(state.items.map((i) => (i.kind === 'unknown' ? i.label : null))).toEqual([
      'thread/compacted',
      'thinking_delta',
    ])
    // The fold does not interpret it — same field, same value, whichever provider sent it.
    expect(state.items.every((i) => i.kind === 'unknown' && i.category !== 'unrecognized')).toBe(
      true,
    )
  })

  it('degrades cleanly when the adapter had no kind to name', () => {
    const state = feed(createTranscript(), {
      type: 'unknown',
      provider: 'codex',
      category: 'activity',
      raw: {},
    })
    const item = state.items[0]
    expect(item?.kind === 'unknown' && item.label).toBeUndefined()
  })
})

describe('describeEvent — the neutral unknown label (072)', () => {
  it('shows `provider · label`, and the provider alone when there is no label', () => {
    expect(
      describeEvent({
        type: 'unknown',
        provider: 'codex',
        category: 'lifecycle',
        label: 'thread/compacted',
        raw: {},
      }),
    ).toBe('codex · thread/compacted')
    expect(
      describeEvent({ type: 'unknown', provider: 'claude', category: 'activity', raw: {} }),
    ).toBe('claude')
  })
})

describe("the unknown-rendering path stays provider-agnostic (072 — the person's invariant)", () => {
  /** The files that turn an `unknown` event into pixels. */
  const RENDER_PATH = [
    '../src/renderer/src/components/UnknownEntry.vue',
    '../src/renderer/src/lib/describe-event.ts',
    '../src/renderer/src/lib/transcript.ts',
  ]

  it('never branches on a provider name and never reads a path inside `raw`', () => {
    // This is WHY `label` exists: the kind lives at a different path inside `raw` per provider
    // (`params.method` vs the SDK message `type`), so a renderer that dug it out of `raw` would
    // have to know which provider sent it. Stamping it in the adapter keeps this layer blind.
    for (const rel of RENDER_PATH) {
      const source = readFileSync(new URL(rel, import.meta.url), 'utf8')
      const code = source
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)) // ignore prose in comments
        .join('\n')
      expect(code, `${rel} must not name a provider`).not.toMatch(/['"`](codex|claude)['"`]/i)
      // Both a direct path read AND a cast — `(event.raw as {method?: string}).method` is a dig
      // dressed up as a type assertion, and the first version of this guard let it through.
      expect(code, `${rel} must not read a path inside raw`).not.toMatch(/\braw\s*[.[]/)
      expect(code, `${rel} must not cast raw to dig into it`).not.toMatch(/\braw\s+as\b/)
    }
  })
})

describe('SessionHeader stays provider-agnostic about the process line (076)', () => {
  it('never names a provider — the host formats the line, the view just shows it', () => {
    // The PID line differs per provider (a real number vs "SDK-managed"), which is exactly the
    // knowledge that must NOT leak into the view. The host pre-formats one string; the header
    // renders it verbatim.
    const source = readFileSync(
      new URL('../src/renderer/src/components/SessionHeader.vue', import.meta.url),
      'utf8',
    )
    const code = source
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*|<!--)/.test(line))
      .join('\n')
    expect(code, 'SessionHeader must not branch on a provider name').not.toMatch(
      /['"`](codex|claude)['"`]/i,
    )
    expect(code, 'the process line must be shown, not composed here').not.toMatch(/pid\s/i)
  })
})

/**
 * A question that outlived the thing that asked it (085).
 *
 * A resumed conversation must clear its old `ended` latch so the next close settles current
 * question cards. Otherwise `markTerminal` returns early and a three-question card remains
 * answerable after its provider request map has died, yielding `user-input request number:0
 * is not pending (already answered, settled, or unknown)` twice on screen.
 *
 * ⚠️ **084 located this in the wrong branch**, and reproducing rather than trusting the location is
 * what found it: it named the `turn` fold's missing `settlePending`, which is real and is fixed
 * here too, but it is not what bit him. The latch would have gone on silently swallowing every
 * subsequent ending in any conversation that had ever been resumed.
 */
describe('transcript fold — a card cannot outlive the turn or the session (085)', () => {
  const question: RuntimeEvent = {
    type: 'user_input_request',
    id: 'number:0',
    prompt: 'Which theme?',
    questions: [
      {
        id: 'ui_theme',
        prompt: 'Which theme?',
        options: [{ label: 'Midnight' }, { label: 'Daylight' }],
      },
    ],
  }
  const card = (state: TranscriptState): UserInputItem =>
    state.items.find((item): item is UserInputItem => item.kind === 'userInput')!

  it('the SECOND ending in a resumed conversation still settles — the latch is cleared', () => {
    const state = feed(
      createTranscript(),
      { type: 'session', state: 'started', ref },
      // A first life that ends. Nothing is pending, so this settles nothing — it only latches.
      { type: 'session', state: 'ended', ref },
      { type: 'status', state: 'ended' },
    )
    expect(state.ended, 'the first ending is real and must stick while it lasts').toBe(true)

    // …and a resume, which is the event that says the latch no longer describes anything.
    feed(state, { type: 'session', state: 'resumed', ref })
    expect(state.ended, 'a session that says it is open again is not over').toBe(false)

    feed(state, question)
    expect(isAwaitingAnswer(card(state)), 'positive: the card really is live first').toBe(true)

    feed(state, { type: 'session', state: 'ended', ref })
    expect(card(state).note).toBe(NOTHING_WAITS_FOR_THIS_ANSWER)
    expect(isAwaitingAnswer(card(state))).toBe(false)
  })

  it('the latch was the defect: without a resume the fold is unchanged', () => {
    // The guard still does its original job — `session:'ended'` and `status:'ended'` announce ONE
    // ending, and the second must not re-settle a card the first already spoke for. Pinned so the
    // fix above cannot be mistaken for removing the guard.
    const state = feed(createTranscript(), { type: 'session', state: 'started', ref }, question, {
      type: 'session',
      state: 'ended',
      ref,
    })
    expect(card(state).note).toBe(NOTHING_WAITS_FOR_THIS_ANSWER)
    // ⚠️ **D-017b** — a close and a failure say one sentence now, so the note cannot show the second
    // half re-settling; the answered-state below is what still would.
    feed(state, { type: 'status', state: 'errored' })
    expect(card(state).note, 'the second half of one ending changes nothing').toBe(
      NOTHING_WAITS_FOR_THIS_ANSWER,
    )
    expect(isAwaitingAnswer(card(state))).toBe(false)
  })

  it.each([
    ['interrupted' as const, 'settled when the turn was interrupted'],
    ['failed' as const, 'settled when the turn failed'],
    ['completed' as const, 'settled when the turn ended'],
  ])('a turn that %s says so on the card it killed', (turnState, expected) => {
    const state = feed(
      createTranscript(),
      { type: 'session', state: 'started', ref },
      question,
      permissionRequest('req_1'),
    )
    const permission = state.items.find(
      (item): item is PermissionItem => item.kind === 'permission',
    )!
    expect(isAwaitingAnswer(card(state)) && isAwaitingAnswer(permission)).toBe(true)

    feed(state, { type: 'turn', state: turnState })
    expect(card(state).note).toBe(expected)
    expect(permission.note, 'both kinds of card, one rule').toBe(expected)
    expect(card(state).answered, 'settled is NOT answered — nobody decided anything').toBeNull()
    expect(permission.outcome).toBeNull()
  })

  it('stays in the transcript, and an ANSWERED card is not relabelled by the turn ending', () => {
    const state = feed(createTranscript(), { type: 'session', state: 'started', ref }, question)
    markUserInputAnswered(state, 'number:0', 'answered')
    const cards = (s: TranscriptState): number =>
      s.items.filter((item) => item.kind === 'userInput').length
    expect(cards(state), 'positive: there is a card to keep').toBe(1)
    feed(state, { type: 'turn', state: 'interrupted' })
    // 063's rule in the other direction: the question does not vanish, it goes quiet visibly.
    // Counted by KIND rather than by total length, because the turn pushes its own notice too — a
    // total-length assertion would have been pinning the notice, not the card. Found by running it.
    expect(cards(state), 'nothing is removed').toBe(1)
    expect(card(state).answered).toBe('answered')
    expect(card(state).note, 'a decision that WAS made is not overwritten by teardown').toBeNull()
  })

  it('a resumed conversation does not hand back live buttons for a dead request', async () => {
    // ⚠️ **Found by review, and it is the same defect one door along.** A ledger that ends MID-TURN
    // — the app was quit, or died, while a question was on screen — has no `turn` and no
    // `session:'ended'` to settle anything, so the replay rebuilds the card with its buttons intact.
    // The adapter behind them is new and has never heard of the id, so pressing one is refused.
    // `markReadOnly` has always settled for exactly this reason; `markReopened` did not.
    const state = feed(createTranscript(), { type: 'session', state: 'started', ref }, question)
    expect(isAwaitingAnswer(card(state)), 'positive: it really was live before the resume').toBe(
      true,
    )

    markReopened(state)
    expect(card(state).note).toBe('settled when this conversation was last open')
    expect(isAwaitingAnswer(card(state))).toBe(false)
    // …and the conversation itself is open again, which is the whole point of `markReopened`.
    expect(state.ended).toBe(false)
  })

  it('a provider withdrawal does not relabel an ending that already named itself', () => {
    // ⚠️ Found by review. `request_resolved` wrote its note unconditionally, which was invisible
    // until 085 gave the `turn` fold something to write first. An adapter that withdraws its
    // requests during teardown emits both, in that order — and the vaguer sentence was winning.
    const state = feed(createTranscript(), { type: 'session', state: 'started', ref }, question, {
      type: 'turn',
      state: 'interrupted',
    })
    expect(card(state).note, 'positive: the turn named its own ending').toBe(
      'settled when the turn was interrupted',
    )
    feed(state, { type: 'request_resolved', id: 'number:0' })
    expect(card(state).note).toBe('settled when the turn was interrupted')

    // …and where nothing has spoken yet, the withdrawal still says its piece (051 unbroken).
    const fresh = feed(createTranscript(), { type: 'session', state: 'started', ref }, question, {
      type: 'request_resolved',
      id: 'number:0',
    })
    expect(fresh.items.find((i): i is UserInputItem => i.kind === 'userInput')!.note).toBe(
      'withdrawn by the provider',
    )
  })

  it('the first reason wins, so a real refusal is not overwritten by a later ending', () => {
    const state = feed(createTranscript(), { type: 'session', state: 'started', ref }, question)
    markRequestFailed(state, 'number:0', 'answering this failed: the host refused the response')
    feed(state, { type: 'turn', state: 'interrupted' }, { type: 'session', state: 'ended', ref })
    expect(card(state).note).toBe('answering this failed: the host refused the response')
  })
})

/**
 * 110 · Two rejected credentials, two different things to do about them.
 *
 * ⛔ **This is the branch 098 built the `cause` field for, and until now nothing tested it at all** —
 * the fold's `auth` arm shipped with no coverage, so `auth_stale` arriving beside it could have
 * fallen through to the raw provider text and no assertion would have moved.
 *
 * A session can be refused while the machine login remains healthy: a measured session
 * authenticated 22 seconds later. The notice must distinguish that condition from needing
 * another sign-in, which would discard five hours without fixing the cause.
 */
describe('transcript fold — a rejected credential says which remedy (110)', () => {
  const CODEX_TEXT =
    'Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.'
  const CLAUDE_TEXT = 'Failed to authenticate. API Error: 401 OAuth access token has been revoked.'

  const noticeOf = (state: TranscriptState): NoticeItem => {
    const notices = state.items.filter((i): i is NoticeItem => i.kind === 'notice')
    if (notices.length !== 1) throw new Error(`expected one notice, got ${notices.length}`)
    return notices[0] as NoticeItem
  }

  it('`auth_stale` offers a reopen, names where it is, and says what the reopen does not bring back', () => {
    const state = feed(createTranscript(), {
      type: 'error',
      message: CLAUDE_TEXT,
      fatal: true,
      cause: 'auth_stale',
    })
    const notice = noticeOf(state)
    expect(notice.level).toBe('error')
    // 🔴 **672 · the words that are ON the control, read from the control** (`656` F6). ⛔ This
    // assertion used to pin *"Resume"* and *"closed threads"* as literals, and `151` renamed both a
    // year earlier while it stayed green. ⚑ **D-017b · there is no control to name**: no closed list
    // in the sidebar and no press — a message sent from the conversation's own view continues it, so
    // that is the remedy the notice gives. The DOM half is `the-two-sentences-made-true.dom.test.ts`.
    expect(notice.text).toContain('send it a message to carry on')
    expect(notice.text).not.toContain('sidebar')
    expect(notice.text).not.toContain('press it')
    expect(notice.text).not.toContain('Resume')
    expect(notice.text).not.toContain('closed threads')
    // ⛔ **The claim `672` measured false on this path**, named so it cannot come back
    expect(notice.text).not.toContain('Nothing here is lost')
    // ⚑ **What IS kept, and the two remedies measured TRUE** — standing rule 5, by name
    expect(notice.text).toContain('cannot continue')
    expect(notice.text).toContain('Its transcript is kept')
    // ⚑ **T-002 · `1004 M12` · D-004 (R101)**: a login renewed elsewhere needs no message, and the
    // notice says so before it names the message for every other case.
    expect(notice.text).toContain('this app carries it on with the new login by itself')
    expect(notice.text).toContain('Otherwise, send it a message to carry on')
    expect(notice.text).toContain('reads your machine login again')
    expect(notice.text).toContain('says so if that login has expired too')
    // ⚑ **The two losses the reopen carries, held to the one cost table** (`reopening.ts`)
    for (const cost of ['Allow for this conversation', 'running in the background']) {
      const row = REOPEN_COSTS.find((one) => 'isTold' in one.person && one.person.isTold === cost)
      expect(row?.becomes, cost).toMatch(/^(lost|stopped)$/)
      expect(notice.text).toContain(cost)
    }
    // ⚠️ **And it must NOT say the other thing.** "Start a new conversation to sign in again" is
    // 098's remedy for a credential the app cannot replace; here it would be wrong advice with
    // hours of work behind it.
    expect(notice.text).not.toContain('sign in again')
    // The provider's sentence is in the ledger, not on the screen (085's split).
    expect(notice.text).not.toContain('401')
    expect(notice.text).not.toContain('OAuth')
  })

  it('`auth` still says sign in again — the branch that must not have moved', () => {
    const notice = noticeOf(
      feed(createTranscript(), {
        type: 'error',
        message: CODEX_TEXT,
        fatal: false,
        cause: 'auth',
      }),
    )
    expect(notice.level).toBe('error')
    expect(notice.text).toContain('sign in again')
    expect(notice.text).not.toContain('refresh token')
  })

  it('a cause-less error still shows the provider’s message — the fall-through that must survive', () => {
    // The `default` arm. Without this, routing both causes could quietly swallow every OTHER error.
    const notice = noticeOf(
      feed(createTranscript(), { type: 'error', message: 'disk full', fatal: false }),
    )
    expect(notice.text).toBe('disk full')
    expect(notice.level).toBe('warn')
  })

  it('the transcript is over, and its open cards are settled', () => {
    // ⚠️ The whole reason the error is `fatal` rather than a visible warning: a card left
    // answerable on a session that cannot take an answer is what 085 traced a request key to.
    const state = feed(createTranscript(), permissionRequest('req_1'), {
      type: 'error',
      message: CLAUDE_TEXT,
      fatal: true,
      cause: 'auth_stale',
    })
    expect(state.ended).toBe(true)
    const card = state.items.find((i): i is PermissionItem => i.kind === 'permission')
    // The EXACT reason, as every sibling test in this file pins it (review): `toBeTruthy()` would
    // have accepted any note at all. ⚑ **D-017b** — a failure and a close say ONE sentence now.
    expect(card?.note).toBe(NOTHING_WAITS_FOR_THIS_ANSWER)
    // …and the paired positive: the same card is still live when nothing has ended.
    const open = feed(createTranscript(), permissionRequest('req_2'))
    expect(open.items.find((i): i is PermissionItem => i.kind === 'permission')?.note).toBeNull()
  })
})

describe('transcript fold — a voice with an owner (128)', () => {
  /**
   * Use two children in one turn, only one forwarding prose. Forwarding produces six loose
   * top-level turns wearing the parent’s voice, or about 42 in a seven-agent fan-out. Keep
   * the measured event order `dispatch → started → says → tool → says` to check authorship
   * across that path.
   */
  const dispatch = (callId: string, title: string): RuntimeEvent => ({
    type: 'tool_call',
    id: callId,
    name: 'Agent',
    summary: title,
  })

  const started = (agentId: string, parentToolCallId: string): RuntimeEvent => ({
    type: 'sub_agent',
    agentId,
    phase: 'started',
    parentToolCallId,
    kind: 'general-purpose',
    title: 'audit the workspace',
  })

  const says = (text: string, parentToolCallId?: string): RuntimeEvent => ({
    type: 'assistant_message',
    text,
    ...(parentToolCallId ? { parentToolCallId } : {}),
  })

  const cardOn = (state: TranscriptState, callId: string): SubAgentCard | undefined => {
    const tool = state.items.find(
      (item): item is ToolItem => item.kind === 'tool' && item.callId === callId,
    )
    return tool?.subAgents?.[0]
  }

  const spoken = (state: TranscriptState): string[] =>
    state.items.flatMap((item) => (item.kind === 'assistant' ? [item.text] : []))

  it("puts a child's words on the child's card — and leaves the parent's own where they were", () => {
    const state = feed(
      createTranscript(),
      says('[MAIN] Running two agents.'),
      dispatch('toolu_bg', 'Find files missed by scouts'),
      started('a95dbf5b', 'toolu_bg'),
      says('[GAPS-BG] Starting the coverage audit.', 'toolu_bg'),
      says('[MAIN] Both back.'),
    )

    // The negative: the child said something and it is NOT a turn in the conversation.
    expect(spoken(state)).toEqual(['[MAIN] Running two agents.', '[MAIN] Both back.'])
    // ⛔ **The paired positive, without which the line above passes over a fold that lost the
    // message entirely.** It is on the card, with its text intact.
    expect(cardOn(state, 'toolu_bg')?.body).toEqual([
      {
        kind: 'prose',
        id: expect.stringMatching(/^says_\d+$/),
        text: '[GAPS-BG] Starting the coverage audit.',
      },
    ])
  })

  it('a FAN-OUT adds no top-level turns at all — four children talking at once (078)', () => {
    // 078's rule, applied to speech: N agents must add N cards, never N turns. The parent speaks
    // twice here and the four children speak three times EACH, so the difference between the two
    // readings is 12 rows against 0.
    const kids = ['one', 'two', 'three', 'four']
    const state = feed(
      createTranscript(),
      says('[MAIN] Fanning out.'),
      ...kids.flatMap((k) => [dispatch(`toolu_${k}`, k), started(`agent_${k}`, `toolu_${k}`)]),
      ...[1, 2, 3].flatMap((round) =>
        kids.map((k) => says(`[${k.toUpperCase()}] round ${round}`, `toolu_${k}`)),
      ),
      says('[MAIN] All back.'),
    )

    expect(spoken(state), 'the parent still owns the conversation').toEqual([
      '[MAIN] Fanning out.',
      '[MAIN] All back.',
    ])
    // …and every one of the twelve sentences is somewhere, on the card of the child that said it.
    for (const k of kids) {
      expect(
        cardOn(state, `toolu_${k}`)?.body.map((row) =>
          row.kind === 'prose' ? row.text : row.name,
        ),
      ).toEqual([
        `[${k.toUpperCase()}] round 1`,
        `[${k.toUpperCase()}] round 2`,
        `[${k.toUpperCase()}] round 3`,
      ])
    }
    // The count 078 is about, stated as a ratio rather than a constant: four talking children cost
    // the transcript exactly what the parent's own two turns cost it, and nothing more.
    expect(spoken(state)).toHaveLength(2)
  })

  it('keeps the child’s words and its work in SOURCE ORDER (058)', () => {
    // 044 P3's defect, one component in: text before a tool must stay before it, and text after it
    // must stay a SECOND run rather than being merged into the first.
    const state = feed(
      createTranscript(),
      dispatch('toolu_bg', 'audit'),
      started('a1', 'toolu_bg'),
      says('before', 'toolu_bg'),
      {
        type: 'tool_call',
        id: 'child_1',
        name: 'Bash',
        summary: 'ls',
        parentToolCallId: 'toolu_bg',
      },
      says('after', 'toolu_bg'),
      {
        type: 'tool_result',
        id: 'child_1',
        summary: 'notes.txt',
        ok: true,
        parentToolCallId: 'toolu_bg',
      },
    )
    expect(
      cardOn(state, 'toolu_bg')?.body.map((row) =>
        row.kind === 'prose' ? `says:${row.text}` : `${row.name}:${row.result?.summary ?? '…'}`,
      ),
    ).toEqual(['says:before', 'Bash:notes.txt', 'says:after'])
  })

  it("never overwrites the PARENT's open streamed block with a child's message", () => {
    // ⛔ **A live defect this routing removes, not merely a case it handles.** `assistant_message`
    // reconciles against `state.streamingId` — so before 128 a child's forwarded message reaching
    // that code would have found the parent's half-written block and replaced its text with the
    // child's, one turn's words silently becoming another's.
    //
    // ⚠️ **The delta comes AFTER the dispatch, and that ordering is what makes this reachable.** A
    // `tool_call` closes the open block (`closeStreaming`), so the parent cannot still be mid-word
    // from before the dispatch — but a BACKGROUND child keeps talking while the parent writes its
    // next sentence, which is exactly what `sess_6b4380fa` recorded, and then the two overlap.
    const state = feed(
      createTranscript(),
      dispatch('toolu_bg', 'audit'),
      started('a1', 'toolu_bg'),
      { type: 'assistant_delta', text: '[MAIN] Still writ' },
      says('[GAPS-BG] done', 'toolu_bg'),
    )
    expect(spoken(state)).toEqual(['[MAIN] Still writ'])
    const open = state.items.find((item) => item.kind === 'assistant')
    expect(open?.kind === 'assistant' && open.streaming, 'the parent is still mid-sentence').toBe(
      true,
    )
    expect(state.streamingId, 'and the child did not close it').not.toBeNull()
  })

  it('speaks in the conversation when there is no card to own it — the honest fallback', () => {
    // Same rule the unclaimed tool call follows (029): an id naming a card that has not arrived is
    // not a reason to swallow what was said. It renders — and since 131 it renders REMEMBERING
    // whose it is, so the window is one a card can close rather than a permanent misattribution.
    const state = feed(createTranscript(), says('[GAPS-BG] early', 'toolu_unknown'))
    expect(spoken(state)).toEqual(['[GAPS-BG] early'])
    // ⛔ **The paired positive.** Without this the line above passes over a fold that dropped the
    // owner on the floor — which is exactly what 128 did, and why nothing could reclaim it.
    const loose = state.items.find((item) => item.kind === 'assistant')
    expect(loose?.kind === 'assistant' && loose.parentToolCallId).toBe('toolu_unknown')
  })

  it("⛔ an unresolved owner does not overwrite the PARENT's open block — both premises, ONE fixture (131)", () => {
    // ⚑ **130's reproducer, by event order.** 128 said this defect was removed and it was not: the
    // routing returned only on a `cardFor` HIT, so a miss fell through to the reconciler below it
    // and ran `open.text = event.text` on the parent's half-written turn. `cardFor` cannot find a
    // card that does not exist yet, and the child speaking BEFORE its `sub_agent` is the ordinary
    // background shape — the one `sess_6b4380fa` recorded.
    //
    // ⛔ **The two premises are held together here on purpose.** 128's tests split them: one made
    // the card before the delta, the other had no parent stream at all. Both passed, while their
    // combined production sequence corrupted the transcript. This fixture is that sequence.
    const state = feed(
      createTranscript(),
      dispatch('toolu_bg', 'audit'),
      { type: 'assistant_delta', text: '[MAIN] Still writ' },
      says('[GAPS-BG] early', 'toolu_bg'),
      started('a1', 'toolu_bg'),
    )

    // The words the parent wrote are the words the parent wrote.
    expect(spoken(state), "the parent's turn is intact and the child's is not in it").toEqual([
      '[MAIN] Still writ',
    ])
    const open = state.items.find((item) => item.kind === 'assistant')
    expect(open?.kind === 'assistant' && open.streaming, 'still mid-sentence').toBe(true)
    expect(state.streamingId, 'and the child did not close it').not.toBeNull()
    // …and the sentence is not lost either: the card took it back the moment it appeared.
    expect(cardOn(state, 'toolu_bg')?.body).toEqual([
      { kind: 'prose', id: expect.stringMatching(/^says_\d+$/), text: '[GAPS-BG] early' },
    ])
  })

  it('reclaims early words INTERLEAVED with early work, in arrival order (131 §4)', () => {
    // 127's altitude rule — *"owned by the child's card, never a loose top-level turn"* — for the
    // window 128 left open. 130 named the cost of closing it: *"two reclaimed sequences have to be
    // interleaved, and neither remembers when it arrived."* They do not have to: `state.items` IS
    // arrival order, so ONE backward walk taking both kinds finds them already interleaved. This is
    // the test that would go red if that walk were ever split into two sweeps.
    const state = feed(
      createTranscript(),
      dispatch('toolu_bg', 'audit'),
      says('[GAPS-BG] before', 'toolu_bg'),
      {
        type: 'tool_call',
        id: 'child_1',
        name: 'Bash',
        summary: 'ls',
        parentToolCallId: 'toolu_bg',
      },
      says('[GAPS-BG] after', 'toolu_bg'),
      started('a1', 'toolu_bg'),
    )
    expect(spoken(state), 'nothing of the child is left in the conversation').toEqual([])
    expect(
      cardOn(state, 'toolu_bg')?.body.map((row) =>
        row.kind === 'prose' ? `says:${row.text}` : row.name,
      ),
    ).toEqual(['says:[GAPS-BG] before', 'Bash', 'says:[GAPS-BG] after'])
  })

  it("⛔ a child's final answer is on the card ONCE, not twice (131 §2)", () => {
    // ⚑ **Measured after 128 shipped**, in `sess_6b4380fa`: ordinal 1776 is the forwarded child
    // message and ordinal 1779 is the terminal summary — 357 characters, byte-for-byte equal. An
    // older run holds the same collision at 3,970. The fold appended one to `body` and copied the
    // other to `summary`, and `SubAgentEntry` renders both, so the answer was drawn twice inside
    // one expanded card.
    const ANSWER = 'The coverage audit found three files with no tests.'
    const state = feed(
      createTranscript(),
      dispatch('toolu_bg', 'audit'),
      started('a1', 'toolu_bg'),
      says('[GAPS-BG] working…', 'toolu_bg'),
      says(ANSWER, 'toolu_bg'),
      {
        type: 'sub_agent',
        agentId: 'a1',
        phase: 'ended',
        parentToolCallId: 'toolu_bg',
        summary: ANSWER,
        outcome: 'completed',
      },
    )
    const card = cardOn(state, 'toolu_bg')
    expect(card?.summary, 'the answer is kept — in the one place the card draws an answer').toBe(
      ANSWER,
    )
    expect(
      card?.body.map((row) => (row.kind === 'prose' ? row.text : row.name)),
      'and the echo of it is gone, while everything else the child said stays',
    ).toEqual(['[GAPS-BG] working…'])
  })

  it('…and a summary with NO matching prose still renders — the paired positive (131 §2)', () => {
    // ⛔ Without this the rule above is satisfiable by dropping every summary. This is the
    // overwhelmingly common case: `forwardSubagentText` is off, so the terminal summary is usually
    // the ONLY thing the child ever says on its card.
    const state = feed(
      createTranscript(),
      dispatch('toolu_bg', 'audit'),
      started('a1', 'toolu_bg'),
      says('[GAPS-BG] working…', 'toolu_bg'),
      {
        type: 'sub_agent',
        agentId: 'a1',
        phase: 'ended',
        parentToolCallId: 'toolu_bg',
        summary: 'Three files have no tests.',
        outcome: 'completed',
      },
    )
    const card = cardOn(state, 'toolu_bg')
    expect(card?.summary).toBe('Three files have no tests.')
    expect(card?.body.map((row) => (row.kind === 'prose' ? row.text : row.name))).toEqual([
      '[GAPS-BG] working…',
    ])
  })

  it('drops the echo in the OTHER order too — the ending first, the words after (131 §2)', () => {
    // The late-card shape: the summary is already on the card when the reclaimed prose arrives. A
    // de-duplication that only ran when the summary landed second would put the answer back twice
    // for exactly the sessions 131 §1 exists to repair.
    const ANSWER = 'Three files have no tests.'
    const state = feed(
      createTranscript(),
      dispatch('toolu_bg', 'audit'),
      says(ANSWER, 'toolu_bg'),
      {
        type: 'sub_agent',
        agentId: 'a1',
        phase: 'ended',
        parentToolCallId: 'toolu_bg',
        summary: ANSWER,
        outcome: 'completed',
      },
    )
    const card = cardOn(state, 'toolu_bg')
    expect(card?.summary).toBe(ANSWER)
    expect(card?.body, 'reclaimed, then recognised as the same sentence').toEqual([])
  })

  it('keeps a sentence the child genuinely said TWICE with work in between (131 §2)', () => {
    // The negative bound on the rule above: identical text is not by itself an echo. Only the run
    // that repeats the FINAL answer goes; a child that says the same thing before and after a tool
    // said it twice, and the card is the record of what it said.
    const LINE = 'Checking the fixtures.'
    const state = feed(
      createTranscript(),
      dispatch('toolu_bg', 'audit'),
      started('a1', 'toolu_bg'),
      says(LINE, 'toolu_bg'),
      {
        type: 'tool_call',
        id: 'child_1',
        name: 'Bash',
        summary: 'ls',
        parentToolCallId: 'toolu_bg',
      },
      says(LINE, 'toolu_bg'),
      {
        type: 'sub_agent',
        agentId: 'a1',
        phase: 'ended',
        parentToolCallId: 'toolu_bg',
        summary: LINE,
        outcome: 'completed',
      },
    )
    expect(
      cardOn(state, 'toolu_bg')?.body.map((row) =>
        row.kind === 'prose' ? `says:${row.text}` : row.name,
      ),
      'exactly one of the two runs is the echo of the summary',
    ).toEqual([`says:${LINE}`, 'Bash'])
  })

  /**
   * **What text equality alone deletes (137, from 136's review).**
   *
   * ⛔ 136's verdict on the rule 131 shipped, verbatim: *"It has no provenance saying that row was
   * the completion echo, no adjacency requirement, and no memory that an echo has already been
   * removed."* Three deterministic failures follow, and all three are below. ⚠️ **Why no test saw
   * them:** the "said twice" fixture above places both matching rows BEFORE one summary event, so
   * the removal runs exactly once and one row survives by arithmetic rather than by rule.
   *
   * ⛔ **132 measured that this is invisible from outside** — the echo is removed before paint — so
   * the correctness of the whole thing rests on these.
   */
  describe('the echo, and the three things it is not (137)', () => {
    const S = 'Three files have no tests.'
    const ended = (summary: string): RuntimeEvent => ({
      type: 'sub_agent',
      agentId: 'a1',
      phase: 'ended',
      parentToolCallId: 'toolu_bg',
      summary,
      outcome: 'completed',
    })
    const childTool = (id: string): RuntimeEvent => ({
      type: 'tool_call',
      id,
      name: 'Bash',
      summary: 'ls',
      parentToolCallId: 'toolu_bg',
    })
    const rows = (state: TranscriptState): string[] =>
      (cardOn(state, 'toolu_bg')?.body ?? []).map((row) =>
        row.kind === 'prose' ? `says:${row.text}` : row.name,
      )

    it('⛔ (a) removes ONE echo, not every sentence that matches the summary', () => {
      // 136 §3, sequence one — the late-card order, where the ending is already on the card when the
      // child's forwarded words arrive. Each arriving copy was appended and immediately removed, so
      // a child that genuinely said the same thing twice ended up with a card holding a tool and
      // nothing it had said. An echo is ONE event said twice; the second copy is the child speaking.
      const state = feed(
        createTranscript(),
        dispatch('toolu_bg', 'audit'),
        started('a1', 'toolu_bg'),
        ended(S),
        says(S, 'toolu_bg'),
        childTool('child_1'),
        says(S, 'toolu_bg'),
      )

      expect(rows(state)).toEqual(['Bash', `says:${S}`])
      expect(cardOn(state, 'toolu_bg')?.summary, 'and the answer is still the answer').toBe(S)
    })

    it('⛔ (b) does not reach back across the work to move a sentence into the summary', () => {
      // 136 §3, sequence two: *"the displayed sentence is effectively moved from before the work to
      // the terminal summary, corrupting chronology."* The backward scan crossed a tool AND a later,
      // different sentence to delete the earlier one. A sentence with the child's own work after it
      // is not the last thing the child said, so it cannot be the echo of the last thing it said.
      const D = 'Starting with the importer.'
      const state = feed(
        createTranscript(),
        dispatch('toolu_bg', 'audit'),
        started('a1', 'toolu_bg'),
        says(S, 'toolu_bg'),
        childTool('child_1'),
        says(D, 'toolu_bg'),
        ended(S),
      )

      expect(rows(state), 'the child said it before the work, and that is where it stays').toEqual([
        `says:${S}`,
        'Bash',
        `says:${D}`,
      ])
    })

    it('⛔ (c) takes the whole trailing run when the answer arrived in two messages', () => {
      // The failure in the OTHER direction, and the one this function exists to prevent: an answer
      // forwarded as two blocks matched no single row, so both rows AND the summary rendered — the
      // duplicate, in the shape 131 did not test for.
      const B = 'The importer is the worst of them.'
      const state = feed(
        createTranscript(),
        dispatch('toolu_bg', 'audit'),
        started('a1', 'toolu_bg'),
        says(S, 'toolu_bg'),
        says(B, 'toolu_bg'),
        ended(`${S}\n\n${B}`),
      )

      expect(rows(state), 'said once, in the one place the card draws an answer').toEqual([])
      expect(cardOn(state, 'toolu_bg')?.summary).toBe(`${S}\n\n${B}`)
    })

    it('…and leaves a trailing run that is NOT the answer alone — the paired positive', () => {
      // ⛔ Without this, (c) is satisfiable by deleting any run of prose at the end of a card. The
      // rule is that the run IS the answer, not that the answer is long.
      const OTHER = 'I will look at the importer next.'
      const state = feed(
        createTranscript(),
        dispatch('toolu_bg', 'audit'),
        started('a1', 'toolu_bg'),
        says(S, 'toolu_bg'),
        says(OTHER, 'toolu_bg'),
        ended(`${S}\n\nThe importer is the worst of them.`),
      )

      expect(rows(state)).toEqual([`says:${S}`, `says:${OTHER}`])
    })

    it('remembers the ANSWER it took, so a summary that grows may still lose its own echo', () => {
      // Why the memory is the answer rather than a flag. A restated, longer summary is a different
      // sentence, and the card has not de-duplicated THAT one — a single "already done" bit would
      // leave the second echo on screen for the rest of the session.
      const MORE = `${S} The importer is the worst of them.`
      const state = feed(
        createTranscript(),
        dispatch('toolu_bg', 'audit'),
        started('a1', 'toolu_bg'),
        says(S, 'toolu_bg'),
        {
          type: 'sub_agent',
          agentId: 'a1',
          phase: 'progress',
          parentToolCallId: 'toolu_bg',
          summary: S,
        },
        says(MORE, 'toolu_bg'),
        ended(MORE),
      )

      expect(rows(state), 'each answer answered once').toEqual([])
      expect(cardOn(state, 'toolu_bg')?.summary).toBe(MORE)
    })
  })

  it('a run of prose is not a tool row, so nothing marks it unfinished (074)', () => {
    // `stopOpenToolCalls` walks the card body looking for calls with no result. Prose has no result
    // and never will; a sweep that could not tell the two apart would stamp `unfinished` on a
    // sentence — a claim about a process, made about a paragraph.
    const state = feed(
      createTranscript(),
      dispatch('toolu_bg', 'audit'),
      started('a1', 'toolu_bg'),
      says('half a thought', 'toolu_bg'),
      {
        type: 'tool_call',
        id: 'child_1',
        name: 'Bash',
        summary: 'ls',
        parentToolCallId: 'toolu_bg',
      },
      { type: 'turn', state: 'interrupted' },
    )
    const body = cardOn(state, 'toolu_bg')?.body ?? []
    expect(body.map((row) => row.kind)).toEqual(['prose', 'tool'])
    expect(body.every((row) => !('unfinished' in row) || row.kind === 'tool')).toBe(true)
    expect(body[1]?.kind === 'tool' && body[1].unfinished).toBe(true)
  })
})
