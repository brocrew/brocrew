import type { TranscriptEvent } from '../src/shared/conversation-events'
import { describe, expect, it } from 'vitest'
import { RUNTIME_EVENT_TYPES, type RuntimeEvent } from '@brobot2/runtime'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import { aLaunchRecordIn } from '../src/main/runtime/what-this-agent-was-given'
import {
  NOTHING_WAITS_FOR_THIS_ANSWER,
  appendUserMessage,
  applyEvent,
  createTranscript,
  markPermissionAnswered,
  markReopened,
  markRequestFailed,
  markUserInputAnswered,
  type AssistantItem,
  type PermissionItem,
  type UserInputItem,
} from './lib/core-transcript'
import { feed, permissionRequest, ref } from './helpers/transcript-fold-fixtures'

/**
 * The fold from events to what the screen shows. It is the only interpretation
 * layer in the renderer, so the rules that could quietly lie to the user — delta
 * versus authoritative text, tool correlation, and when a card stops being
 * answerable — are pinned here.
 */
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
      turn_summary: {
        type: 'turn_summary',
        status: 'completed',
        detail: 'Checked the change',
        needsAction: '',
      },
      command_summary: { type: 'command_summary', description: 'Checking the change' },
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
        prefix: '/',
        commands: [{ name: 'compact', description: 'Free up context' }],
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

    // State, a pill, a registry or a mark on another row: none of these is a line of its own.
    const annotatesRatherThanAdds = new Set([
      'status',
      'request_resolved',
      'activity',
      'context_reading',
      'file_change',
      'workflow_run',
      'background_work',
      'scheduled_work',
      'provider_commands',
      'tool_inventory',
      'provider_limit_clear',
      'provider_usage',
    ])
    const kinds = new Set<string>()
    for (const type of RUNTIME_EVENT_TYPES) {
      const state = createTranscript()
      expect(() => applyEvent(state, samples[type])).not.toThrow()
      expect(state.items.length, type).toBe(annotatesRatherThanAdds.has(type) ? 0 : 1)
      expect(describeEvent(samples[type])).not.toBe('')
      for (const item of state.items) kinds.add(item.kind)
    }
    // The kinds a provider event can draw, each one the reading view decides on.
    expect(kinds).toEqual(
      new Set([
        'assistant',
        'tool',
        'permission',
        'userInput',
        'thinking',
        'plan',
        'subAgent',
        'notice',
        'image',
        'compaction',
        'reset',
        'memoryRecall',
        'turnSummary',
        'commandSummary',
        'unknown',
      ]),
    )
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
      {
        event: { type: 'service_registered', identity: 'aid:reader', identityCreatedAt: 123 },
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
      // A conversation's title is the header's and the lists', never a row in its transcript.
      {
        event: {
          type: 'titled',
          title: 'DEV-100012',
          author: { kind: 'agent', conversation: 'sess_parent' },
        },
        adds: 0,
      },
      // Current rules are the footer's to say, never a row in the transcript.
      { event: { type: 'current_rules_set', text: 'Keep the pace at three an hour.' }, adds: 0 },
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
      {
        event: {
          type: 'ask_handoff_attempted',
          attempt: '["sess_recipient",0,1]',
          originals: [{ opening: '["sess_asker",0,1]', inputIndex: 0 }],
        },
        adds: 0,
      },
      {
        event: { type: 'ask_handoff_not_accepted', attempt: '["sess_recipient",0,1]' },
        adds: 0,
      },
      {
        event: { type: 'ask_provenance_unresolved', outgoingGeneration: 0, coverage: 'unprepared' },
        adds: 0,
      },
      // ⛔ **673: `adds: 0`, as every reopen drew before the row existed** — the row is for the task
      // fold. ⚠️ Not a duplicate: the transcript draws no seam line at all (a finding, not a ruling).
      { event: { type: 'pending_compaction', request: null }, adds: 0 },
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
      service_registered: true,
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
      ask_handoff_attempted: true,
      ask_handoff_not_accepted: true,
      ask_provenance_unresolved: true,
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
      pending_compaction: true,
      titled: true,
      current_rules_set: true,
    }
    expect(
      [...new Set(ours.map((o) => o.event.type))].sort(),
      'an app-authored type is missing from this sweep',
    ).toEqual(Object.keys(roster).sort())

    for (const { event, adds } of ours) {
      const state = createTranscript()
      expect(() => applyEvent(state, event)).not.toThrow()
      expect(state.items.length, event.type).toBe(adds)
      if (event.type === 'pending_compaction' || event.type === 'service_registered')
        expect(describeEvent(event), event.type).toBe('')
      else expect(describeEvent(event), event.type).not.toBe('')
    }
  })
})
