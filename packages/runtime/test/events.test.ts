import { describe, expect, it } from 'vitest'
import {
  DEGRADED_LABEL_PREFIX,
  DEGRADED_UNNAMED,
  RUNTIME_EVENT_TYPES,
  degradeEvent,
  permissionDecisionSchema,
  runtimeEventSchema,
  toRuntimeEvent,
  userInputResponseSchema,
  wrapUnknown,
  type RuntimeEvent,
} from '../src/index'

const ref = { provider: 'claude' as const, sessionId: 's1', cwd: '/tmp/x', rotation: 0 }

// One valid instance of every variant, keyed by discriminant.
const validEvents: Record<RuntimeEvent['type'], RuntimeEvent> = {
  session: { type: 'session', state: 'started', ref },
  conversation_reset: {
    type: 'conversation_reset',
    ref: { ...ref, sessionId: 's2' },
    source: 'conversation_reset',
  },
  turn: { type: 'turn', state: 'completed', turnId: 't1' },
  provider_turn: { type: 'provider_turn' },
  provider_usage: {
    type: 'provider_usage',
    readings: [{ window: 'five_hour', usedPercent: 40, resetsAt: 1_790_913_208_000 }],
  },
  assistant_delta: { type: 'assistant_delta', text: 'Hel' },
  assistant_message: { type: 'assistant_message', text: 'Hello' },
  tool_call: { type: 'tool_call', id: 'c1', name: 'Bash', summary: 'echo hi' },
  tool_result: { type: 'tool_result', id: 'c1', summary: 'ok', ok: true },
  permission_request: {
    type: 'permission_request',
    id: 'p1',
    kind: 'command',
    action: 'Bash',
    detail: 'echo hi',
    scope: {
      cwd: '/tmp/x',
      paths: [],
      networkHosts: [],
      persistence: 'once',
      amendments: [],
      availableDecisions: ['allow', 'deny', 'cancel'],
      underDisclosed: false,
    },
  },
  user_input_request: {
    type: 'user_input_request',
    id: 'u1',
    prompt: 'pick',
    // 143: one option carrying the `description` both providers guarantee and one without it,
    // because "the model gave no reason" is a real state — every row written before 143 — and not
    // merely something the type tolerates.
    questions: [
      {
        id: 'q0',
        prompt: 'pick a color',
        header: 'Colour',
        options: [{ label: 'blue', description: 'the calm one' }, { label: 'red' }],
        allowOther: true,
      },
    ],
  },
  request_resolved: { type: 'request_resolved', id: 'p1' },
  status: { type: 'status', state: 'idle' },
  error: { type: 'error', message: 'boom', fatal: false },
  thinking: { type: 'thinking', phase: 'delta', redacted: true, tokens: 165 },
  activity: { type: 'activity', phase: 'thinking' },
  image: { type: 'image', imageId: 'exec-1', path: '/tmp/x/a.png', prompt: 'a sleeping fox' },
  sub_agent: {
    type: 'sub_agent',
    agentId: 'a018b6340ee11bc0a',
    phase: 'ended',
    parentToolCallId: 'toolu_01Vy9DHCo9ANEMehzr8fMTtz',
    kind: 'general-purpose',
    title: 'Report working directory',
    usage: { tokens: 8944, toolCalls: 0, ms: 2041 },
    outcome: 'completed',
    summary: '/Users/alex/brobot2-scratch/capture-026',
  },
  plan_update: {
    type: 'plan_update',
    steps: [
      { text: 'Create notes.txt', status: 'done' },
      { text: 'Count the lines', status: 'active' },
      { text: 'Report the count', status: 'pending' },
    ],
    note: 'Created the file and verified its line count.',
  },
  // A REAL Codex reading, field for field off the wire: `last.totalTokens` against
  // `modelContextWindow`, both taken from a stored `thread/tokenUsage/updated`.
  context_reading: {
    type: 'context_reading',
    reading: { kind: 'proportional', used: 14807, window: 258400 },
    source: 'thread/tokenUsage/updated',
  },
  compaction: {
    type: 'compaction',
    compactionId: '019fd9ff-5721-73f1-ba21-e162ca2acf5b',
    before: 128000,
    after: 24000,
    trigger: 'auto',
    source: 'compact_boundary',
  },
  file_change: {
    type: 'file_change',
    changes: [
      { path: 'src/a.ts', status: 'modified', added: 3, removed: 1, diff: '@@ -1 +1 @@\n-a\n+b' },
      { path: 'moved.txt', status: 'renamed', oldPath: 'movable.txt', added: 1, removed: 1 },
    ],
    source: 'turn/diff/updated',
  },
  workflow_run: {
    type: 'workflow_run',
    taskId: 'wpftc68xh',
    toolUseId: 'toolu_01UyjaemGUNiXDSP18chuEXK',
    name: 'haiku-panel-demo',
    phases: [{ index: 1, title: 'Draft' }],
    agents: [
      {
        agentId: 'a9e5e6f897982a72a',
        label: 'poet:fan-out',
        phaseIndex: 1,
        state: 'done',
        model: 'claude-opus-5[1m]',
        queuedAt: 1786360510210,
        startedAt: 1786360510223,
        attempt: 1,
        lastTool: 'StructuredOutput',
        tokens: 7718,
        toolCalls: 1,
        durationMs: 2691,
      },
    ],
    usage: { tokens: 30982, toolCalls: 4, ms: 20985 },
    source: 'task_progress',
  },
  // 247 · the level, verbatim from the live capture in `background-reach-probe.smoke.ts`.
  background_work: {
    type: 'background_work',
    running: [
      {
        id: 'b23pvshmy',
        toolCallId: 'toolu_01KjRfdWrEBEGV7jGGTxpfvd',
        kind: 'local_bash',
        description: 'Background task: wait 30 seconds then write timestamp to file',
      },
    ],
    source: 'background_tasks_changed',
  },
  scheduled_work: {
    type: 'scheduled_work',
    jobs: [
      { id: 'a7c8a668', schedule: '* * * * *', recurring: true, prompt: 'IDLE_TRUTH_250 tick' },
    ],
    source: 'hook/Stop',
  },
  // 279 — one row carrying every optional field the live catalogue was measured to send (`/usage`
  // is the row with aliases) and one carrying only a name, because a skill whose author wrote no
  // description is a state the schema must admit rather than merely tolerate.
  // 358 · ⛔ **The `published` half is a REAL Claude reading**, cut down: the qualified name really
  // is `mcp__brobot__spawn_agent` and the built-in really is `Bash` — measured by
  // `probe:tool-inventory`, whose control arm listed the built-in and none of the five.
  tool_inventory: {
    type: 'tool_inventory',
    naming: { prefix: 'mcp__', separator: '__' },
    declared: {
      server: 'brobot',
      instructions: 'These tools reach the app you are running inside.',
      tools: [
        {
          name: 'spawn_agent',
          description: 'Create another agent.',
          parameters: [
            {
              name: 'profile_slug',
              type: 'string',
              required: true,
              description: 'Which identity.',
            },
            { name: 'project', type: 'string', required: false },
          ],
        },
      ],
    },
    published: {
      tools: ['Bash', 'mcp__brobot__spawn_agent'],
      servers: [{ name: 'brobot', status: 'connected' }],
    },
    source: 'init',
  },
  provider_commands: {
    type: 'provider_commands',
    commands: [
      {
        name: 'usage',
        description: "Show session cost, plan usage, and what's contributing to your limits",
        argumentHint: '',
        aliases: ['cost', 'stats'],
      },
      { name: 'imagegen' },
    ],
    prefix: '/',
    source: 'initializationResult',
  },
  // 319 — the shape 318 measured on a real 0.146.0 child, verbatim, so this map holds a payload the
  // wire actually produced rather than one this file invented.
  memory_recall: {
    type: 'memory_recall',
    entries: [
      { path: 'MEMORY.md', lineStart: 1, lineEnd: 3, note: 'the user’s full name' },
      { path: 'rollout_summaries/2026-02-17T21-23-02-LN3m-example.md' },
    ],
    threadIds: ['019c6e27-e55b-73d1-87d8-4e01f1f75043'],
    source: 'memoryCitation',
  },
  // 586 — the shape `claude/normalize.ts` builds from a routine `rate_limit_event` whose
  // `status` is `allowed`. The window is the provider's own `rateLimitType`, carried as it
  // spells it because `readProviderLimit` reads the same word out of the wall sentence.
  provider_limit_clear: {
    type: 'provider_limit_clear',
    window: 'five_hour',
    source: 'rate_limit_event',
  },
  unknown: {
    type: 'unknown',
    provider: 'codex',
    category: 'unrecognized',
    raw: { weird: true },
  },
}

describe('runtimeEventSchema', () => {
  it('accepts every valid variant', () => {
    for (const type of RUNTIME_EVENT_TYPES) {
      expect(runtimeEventSchema.safeParse(validEvents[type]).success).toBe(true)
    }
  })

  it('covers exactly the documented variants', () => {
    // 14 since 027 promoted `thinking` and `activity` out of `unknown{category:'reasoning'}`;
    // 15 since 028 did the same for `plan_update` out of `unknown{category:'plan'}`; 16 since
    // 029 promoted `sub_agent` out of `unknown{category:'activity'}`; 17 since 067 promoted
    // `image` out of the SAME bucket — and that one is the reason the promotions keep happening:
    // `activity` is where a payload goes when nobody has decided what it means yet.
    // 19 since 087 promoted `context_reading` and `compaction` out of
    // `unknown{category:'lifecycle'}` — the fifth and sixth promotions, and the first pair to come
    // out of `lifecycle` rather than `activity`. 20 since 096 promoted `file_change` out of the
    // same bucket, and that one is the seventh: `turn/diff/updated` had been filed as chatter since
    // 064 and is the only file-change signal Codex actually sends.
    // `workflow_run` must be a typed event rather than recognized activity chatter:
    // filtering the latter from normal mode hid every frame while 22 agents ran.
    // 22 since 199 promoted `conversation_reset` out of `unknown{category:'lifecycle'}` — the
    // ninth promotion, and the only one so far that was losing WORK rather than visibility: the
    // event carries `new_conversation_id`, nothing read it, and a resumed session therefore
    // reopened the conversation the provider had abandoned.
    // 23 since 247 promoted `background_work` out of `unknown{category:'lifecycle'}` — the tenth
    // promotion, and the second to be losing something other than visibility: the level set says
    // what is STILL RUNNING, nothing read it, and the transcript therefore showed a settled tool
    // and an idle turn for a measured 26.6 s while the command was alive. ⚑ The frame it came out
    // of is still classified `lifecycle` and still emitted, unlike every promotion above: `245`
    // ruled that classification deliberate, so this one adds a fact rather than moving one.
    // 24 since 253 added `scheduled_work` — and it is NOT a promotion, which makes it the first
    // addition of its kind. Every entry above came out of `unknown`, because every one of them was
    // already arriving on the message stream misfiled. This one was never on the stream at all:
    // `250` measured a cron producing 0 of the 5 `task_*` frames a backgrounded `Bash` produced one
    // row later in the same capture, and the fact lives on the `Stop` hook's `session_crons`.
    // 25 since 279 added `provider_commands` — an addition rather than a promotion, like the entry
    // above and for a related reason: `commands_changed` WAS on the message stream and stays
    // classified `lifecycle` there (247's precedent, `245`'s ruling), but the fact it carries had
    // no home, and the other two producers were never on the stream at all — Claude's list comes
    // from the `initializationResult()` handshake and Codex's from a `skills/list` request.
    // 26 since 319 added `memory_recall` — ⛔ **the first one whose fact was already on the message
    // stream, on an item this taxonomy has mapped since 001, and simply never read.** Every entry
    // above was misfiled, unmapped or off-stream; this one arrived on `agentMessage`, which
    // {@link itemToEvents} has always handled, in a FIELD beside the `text` it did read. So the
    // eleventh addition is also the first that no `unknown` row ever hinted at: 316 counted item
    // types looking for a memory tool, found none, and concluded the act was unobservable.
    // 27 since 358 added `tool_inventory` — ⛔ **the first one that carries a fact the app STATES
    // as well as one the provider publishes**, and the first whose payload is required to be
    // nullable on both halves. Every entry above reports something a provider said; this one also
    // reports what BroBot handed the session, because the two disagreeing is the defect it exists
    // to make visible — and its `published: null` says a provider does not report at all, which no
    // other event in this taxonomy has ever had to express.
    // 28 since 586 promoted `provider_limit_clear` out of `unknown{category:'lifecycle'}` — ⛔ **the
    // twelfth addition, the third out of `lifecycle`, and the first promoted for a fact the LEDGER
    // is asked about rather than one a surface draws.** ⚠️ Every promotion above made something
    // visible; this one stays invisible on purpose — `074`'s ruling that a routine heartbeat must
    // not become noise still holds, and `transcript.ts` gives it no item in either mode. 🔴 What
    // changed is that `HO-080` §1 made a wall RETRACTABLE, and a retraction has to be matched
    // against the provider's own word rather than against an untyped `raw` blob.
    expect(new Set(Object.keys(validEvents))).toEqual(new Set(RUNTIME_EVENT_TYPES))
    // ⚑ 28 → 29: `provider_usage`, a reading the host keeps for the Providers screen and never records.
    // 30 since F080 added `provider_turn`: a turn the provider started by itself.
    expect(RUNTIME_EVENT_TYPES).toHaveLength(30)
  })

  it('the 027 additions are ADDITIVE — every pre-027 event still parses unchanged', () => {
    // The ledger is on disk. Rows written before these variants existed must keep parsing exactly
    // as they did, or a conversation recorded yesterday stops reopening today. Parsed here as raw
    // JSON, the way they come back off the wire and out of the database — not as typed literals,
    // which would only prove the compiler agrees with itself.
    const persisted: unknown[] = [
      { type: 'session', state: 'started', ref },
      { type: 'turn', state: 'completed', turnId: 't1' },
      { type: 'assistant_delta', text: 'Hel' },
      { type: 'assistant_message', text: 'Hello' },
      { type: 'tool_call', id: 'c1', name: 'Bash', summary: 'echo hi' },
      { type: 'tool_result', id: 'c1', summary: 'hi', ok: true },
      { type: 'status', state: 'working' },
      { type: 'error', message: 'boom', fatal: false },
      // The request family too: these are the rows a conversation that asked something of the user
      // leaves behind, and they are exactly the ones whose absence would go unnoticed — a reopened
      // session simply loses the card and reads as though the agent never asked.
      {
        type: 'permission_request',
        id: 'p1',
        kind: 'command',
        action: 'Bash',
        detail: 'echo hi',
        scope: {
          cwd: '/tmp/x',
          paths: [],
          networkHosts: [],
          persistence: 'once',
          amendments: [],
          availableDecisions: ['allow', 'deny', 'cancel'],
          underDisclosed: false,
        },
      },
      {
        type: 'user_input_request',
        id: 'u1',
        prompt: 'pick',
        // ⚑ **Left as bare strings on purpose** (143). This list is "rows already on disk still
        // parse", and bare-string options are precisely what every pre-143 row holds — so this is
        // the assertion that {@link userInputOptionSchema}'s string branch is not decoration.
        questions: [{ id: 'q0', prompt: 'pick a color', options: ['blue', 'red'] }],
      },
      // ⚑ **478 · a consent card written BEFORE `consent` existed** — every plan card on disk. The
      // absence means *nobody said*, and it must keep parsing and keep saying so (`477`'s ruling
      // for the same population, one event over).
      {
        type: 'user_input_request',
        id: 'u2',
        prompt: 'The agent has finished planning and asks you to approve its plan.',
        questions: [],
      },
      { type: 'request_resolved', id: 'p1' },
      { type: 'unknown', provider: 'codex', category: 'reasoning', raw: { any: 'shape' } },
    ]
    for (const row of persisted) {
      expect(runtimeEventSchema.safeParse(row).success, JSON.stringify(row)).toBe(true)
    }
  })

  it('478 · a consent card carries which way it moves, and nothing else may', () => {
    const plan = (consent: unknown): unknown => ({
      type: 'user_input_request',
      id: 'u3',
      prompt: 'plan?',
      questions: [],
      consent,
    })
    // ⛔ **A closed vocabulary on the wire too**, so a build that started sending a third word
    // reaches the ledger as a parse failure rather than as a card with nothing under its Approve.
    expect(runtimeEventSchema.safeParse(plan('start-planning')).success).toBe(true)
    expect(runtimeEventSchema.safeParse(plan('stop-planning')).success).toBe(true)
    expect(runtimeEventSchema.safeParse(plan('maybe-planning')).success).toBe(false)
    // ⚑ And the paired positive for the absence: no key at all is the pre-478 row, and it parses.
    expect(
      runtimeEventSchema.safeParse({
        type: 'user_input_request',
        id: 'u3',
        prompt: 'plan?',
        questions: [],
      }).success,
    ).toBe(true)
  })

  it('the new variants are all-optional beyond their discriminant and phase', () => {
    // "Not reported" has to stay expressible: a thinking event with neither text nor tokens is the
    // honest shape for a provider that only tells us that it thought.
    expect(runtimeEventSchema.safeParse({ type: 'thinking', phase: 'delta' }).success).toBe(true)
    expect(runtimeEventSchema.safeParse({ type: 'activity', phase: 'tool' }).success).toBe(true)
    expect(runtimeEventSchema.safeParse({ type: 'thinking', phase: 'nope' }).success).toBe(false)
    expect(runtimeEventSchema.safeParse({ type: 'activity', phase: 'napping' }).success).toBe(false)
  })

  it('rejects malformed variants', () => {
    expect(runtimeEventSchema.safeParse({ type: 'turn', state: 'nope' }).success).toBe(false)
    expect(runtimeEventSchema.safeParse({ type: 'tool_call', name: 'Bash' }).success).toBe(false)
    expect(runtimeEventSchema.safeParse({ type: 'status', state: 'sleeping' }).success).toBe(false)
  })
})

describe('toRuntimeEvent (boundary parser)', () => {
  it('passes a valid candidate through unchanged', () => {
    for (const type of RUNTIME_EVENT_TYPES) {
      expect(toRuntimeEvent('claude', validEvents[type])).toEqual(validEvents[type])
    }
  })

  it('degrades an unmapped payload to an unknown event, never throwing', () => {
    for (const garbage of [{ type: 'mystery', x: 1 }, 'a string', 42, null, undefined, {}, []]) {
      let result: RuntimeEvent | undefined
      expect(() => {
        result = toRuntimeEvent('codex', garbage)
      }).not.toThrow()
      expect(result?.type).toBe('unknown')
      if (result?.type === 'unknown') {
        expect(result.provider).toBe('codex')
        expect(result.raw).toEqual(garbage)
      }
    }
  })
})

describe('wrapUnknown (raw-payload boundary)', () => {
  it('wraps ANY candidate as unknown{raw} without interpreting it — even a valid variant shape (007 P2-8)', () => {
    for (const type of RUNTIME_EVENT_TYPES) {
      const valid = validEvents[type]
      const wrapped = wrapUnknown('codex', valid)
      // Unclassified calls default to the LOUD bucket, so a missed classification is
      // conspicuous rather than silently filed away as chatter (049).
      expect(wrapped).toEqual({
        type: 'unknown',
        provider: 'codex',
        category: 'unrecognized',
        raw: valid,
      })
      // a `status`/`session`/… shaped payload never surfaces as that real event
      if (type !== 'unknown') expect(wrapped.type).not.toBe(type)
    }
  })

  it('carries the given category and always preserves raw (049)', () => {
    const raw = { deep: { payload: [1, 2, 3] } }
    for (const category of ['reasoning', 'plan', 'lifecycle', 'activity', 'echo'] as const) {
      const wrapped = wrapUnknown('claude', raw, category)
      expect(wrapped).toEqual({ type: 'unknown', provider: 'claude', category, raw })
      // Classifying must never cost information — the payload is the SAME object.
      expect((wrapped as Extract<RuntimeEvent, { type: 'unknown' }>).raw).toBe(raw)
      expect(runtimeEventSchema.safeParse(wrapped).success).toBe(true)
    }
  })
})

describe('decision schemas', () => {
  it('validates permission decisions', () => {
    expect(permissionDecisionSchema.safeParse({ outcome: 'allow' }).success).toBe(true)
    expect(
      permissionDecisionSchema.safeParse({ outcome: 'allow', updatedInput: { path: '/x' } })
        .success,
    ).toBe(true)
    expect(permissionDecisionSchema.safeParse({ outcome: 'deny', message: 'no' }).success).toBe(
      true,
    )
    expect(permissionDecisionSchema.safeParse({ outcome: 'allow_for_session' }).success).toBe(true)
    expect(permissionDecisionSchema.safeParse({ outcome: 'cancel' }).success).toBe(true)
    expect(permissionDecisionSchema.safeParse({ outcome: 'maybe' }).success).toBe(false)
  })

  it('validates user-input responses (answers keyed by question id, 033)', () => {
    expect(
      userInputResponseSchema.safeParse({ kind: 'answer', answers: { q0: 'a' } }).success,
    ).toBe(true)
    expect(
      userInputResponseSchema.safeParse({ kind: 'answer', answers: { q0: ['a', 'b'] } }).success,
    ).toBe(true) // multi-select
    expect(userInputResponseSchema.safeParse({ kind: 'answer', answers: {} }).success).toBe(true) // pure permission grant
    expect(userInputResponseSchema.safeParse({ kind: 'reject' }).success).toBe(true)
    expect(userInputResponseSchema.safeParse({ kind: 'answer' }).success).toBe(false) // missing answers
    expect(userInputResponseSchema.safeParse({ kind: 'answer', text: 'a' }).success).toBe(false) // old single-text shape gone
  })
})

describe('unknown.label — the neutral kind, additive (072)', () => {
  it('is OPTIONAL: an unknown without a label still validates', () => {
    const event = wrapUnknown('codex', { a: 1 }, 'lifecycle')
    expect('label' in event).toBe(false) // absent means absent — no undefined key over IPC
    expect(runtimeEventSchema.safeParse(event).success).toBe(true)
  })

  it('carries the label when the adapter names the kind, and it stays schema-valid', () => {
    const event = wrapUnknown('codex', { a: 1 }, 'lifecycle', 'thread/compacted')
    expect(event).toMatchObject({
      type: 'unknown',
      category: 'lifecycle',
      label: 'thread/compacted',
    })
    expect(runtimeEventSchema.safeParse(event).success).toBe(true)
  })

  it('an empty label is treated as absent, never rendered as a stray separator', () => {
    expect('label' in wrapUnknown('claude', {}, 'activity', '')).toBe(false)
  })

  it('the label never changes classification — category and raw are untouched', () => {
    const raw = { method: 'thread/compacted', params: { a: 1 } }
    const withLabel = wrapUnknown('codex', raw, 'lifecycle', 'thread/compacted')
    const without = wrapUnknown('codex', raw, 'lifecycle')
    expect(withLabel.type === 'unknown' && withLabel.category).toBe('lifecycle')
    expect(without.type === 'unknown' && without.category).toBe('lifecycle')
    expect(withLabel.type === 'unknown' && withLabel.raw).toEqual(raw)
  })
})

/**
 * ⛔ **235, from 230 M3 — an erasure has to be COUNTABLE, not merely survivable.**
 *
 * 230 H1 named the one thing that would defeat the event log as evidence: *"a log that dropped
 * `tool_call` rows specifically, while still recording turns and messages, would be invisible to
 * them — and `snapshot().tools` reads the same list, so there is no third surface to ask."* The
 * mechanism is shipped: a malformed event is REPLACED by an `unknown` and the stream carries on.
 * Before this the replacement looked exactly like honest provider chatter, so the transcript, the
 * ledger and every counter agreed that no tool was called — and agreed wrongly, with nothing
 * anywhere able to disagree.
 *
 * ⚠️ These are assertions about the DISCRIMINANT, not about the fallback existing. A test that only
 * checks `type === 'unknown'` passes just as well before the fix as after it.
 */
describe('235 · a degraded frame says what it was', () => {
  /** The 230 M3 shape, exactly: a tool call whose `summary` never made it. */
  const erasedToolCall = {
    type: 'tool_call',
    id: 'toolu_1',
    name: 'Bash',
  } as unknown as RuntimeEvent

  it('names the type it claimed to be, on both the machine field and the human label', () => {
    const degraded = degradeEvent('claude', erasedToolCall)
    expect(degraded).toMatchObject({
      type: 'unknown',
      provider: 'claude',
      category: 'unrecognized',
      label: 'degraded:tool_call',
      degradedFrom: 'tool_call',
    })
    // The payload is still carried whole, so nothing is lost by marking it.
    expect(degraded.type === 'unknown' && degraded.raw).toEqual(erasedToolCall)
  })

  it('⛔ BOTH doors mark it — `toRuntimeEvent` is the other one', () => {
    // 233's lesson, applied before it could be repeated: the rule changed at one of its call sites
    // is a rule nothing can rely on. `toRuntimeEvent` and the desktop wire boundary are the two
    // places a malformed event of ours becomes an `unknown`.
    const viaParser = toRuntimeEvent('claude', erasedToolCall)
    expect(viaParser.type === 'unknown' && viaParser.degradedFrom).toBe('tool_call')
    expect(viaParser.type === 'unknown' && viaParser.label).toBe('degraded:tool_call')
  })

  it('⛔ an ERASED tool call and an HONEST unknown are countable apart — the whole point', () => {
    const stream: RuntimeEvent[] = [
      toRuntimeEvent('claude', erasedToolCall),
      wrapUnknown('claude', { method: 'thread/compacted' }, 'lifecycle', 'thread/compacted'),
      wrapUnknown('claude', { some: 'chatter' }, 'reasoning'),
      toRuntimeEvent('claude', { type: 'assistant_message', text: 'the tool said 4' }),
    ]
    const erasedToolCalls = stream.filter(
      (event) => event.type === 'unknown' && event.degradedFrom === 'tool_call',
    )
    const realToolCalls = stream.filter((event) => event.type === 'tool_call')
    // The ledger says no tool was called…
    expect(realToolCalls).toHaveLength(0)
    // …and it can now also say that one was erased, which is a different sentence.
    expect(erasedToolCalls).toHaveLength(1)
    // Honest chatter is untouched: marking erasures must not make every `unknown` look like a bug.
    expect(stream.filter((e) => e.type === 'unknown' && e.degradedFrom !== undefined)).toHaveLength(
      1,
    )
  })

  it('a degraded frame is itself schema-valid, or it would be erased twice over', () => {
    const degraded = degradeEvent('codex', erasedToolCall)
    expect(runtimeEventSchema.safeParse(degraded).success).toBe(true)
    // Idempotent: re-validating one at the next boundary must not change it.
    expect(toRuntimeEvent('codex', degraded)).toEqual(degraded)
  })

  it('`wrapUnknown` NEVER sets it — provider chatter is not an erasure', () => {
    for (const category of ['reasoning', 'plan', 'lifecycle', 'activity', 'echo'] as const) {
      const chatter = wrapUnknown('codex', { type: 'tool_call' }, category, 'item/started')
      // ⚑ Note the payload: a provider frame that CONTAINS `type: 'tool_call'` still must not be
      // reported as one of ours that we lost. `wrapUnknown` never interprets its input (007 P2-8).
      expect(chatter.type === 'unknown' && 'degradedFrom' in chatter).toBe(false)
    }
  })

  it('counts an unnamed frame as an erasure anyway — the COUNT is never wrong', () => {
    for (const nameless of ['a string', 42, null, undefined, {}, [], { type: 42 }]) {
      const degraded = degradeEvent('codex', nameless)
      expect(degraded.type === 'unknown' && degraded.label).toBe(DEGRADED_UNNAMED)
      // Absent, not a placeholder: we do not know what it was, and inventing a name would be worse
      // than saying nothing.
      expect(degraded.type === 'unknown' && 'degradedFrom' in degraded).toBe(false)
    }
  })

  it('⛔ never echoes a hostile `type` into a log line or a DOM row', () => {
    const hostile: unknown[] = [
      { type: 'tool_call\n[31mFAKE' },
      { type: 'x'.repeat(5000) },
      { type: 'Tool_Call' },
      { type: '../../etc/passwd' },
      { type: '' },
    ]
    for (const candidate of hostile) {
      const degraded = degradeEvent('claude', candidate)
      expect(degraded.type === 'unknown' && degraded.label).toBe(DEGRADED_UNNAMED)
      expect(degraded.type === 'unknown' && degraded.raw).toEqual(candidate) // still carried whole
    }
  })

  it('⛔ the DOOR never throws on a candidate that cannot be asked for its type', () => {
    // ⚠️ **Through `toRuntimeEvent`, not `degradeEvent`, and that is the whole assertion.** 235's
    // first draft guarded the property read inside `degradedTypeOf` and tested it by calling
    // `degradeEvent` directly — one call too late. `runtimeEventSchema` is a DISCRIMINATED union,
    // so Zod reads `.type` off the candidate to choose an arm before any of our code runs, and that
    // read is unguarded: both doors threw, out through a function whose docstring has promised
    // *"Never throws"* since HO-001. Measured, then fixed, then pinned here.
    const throwing = {
      get type() {
        throw new Error('a getter that refuses')
      },
    }
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    for (const candidate of [throwing, revoked.proxy]) {
      let degraded: RuntimeEvent | undefined
      expect(() => {
        degraded = toRuntimeEvent('claude', candidate)
      }).not.toThrow()
      expect(degraded?.type === 'unknown' && degraded.label).toBe(DEGRADED_UNNAMED)
    }
    // …and the same candidate straight into the marker, so the inner guard is not left untested by
    // the outer one being fixed.
    expect(() => degradeEvent('claude', throwing)).not.toThrow()
  })

  it('⛔ a provider cannot forge the marker in the one field a live step reads', () => {
    // `label` is the provider's own kind string, copied verbatim (072) — and it is what
    // `describeEvent` renders and what `ui-live-smoke.mjs` greps. A Codex item whose `type` is
    // literally `degraded:tool_call` would otherwise have produced a row byte-identical to a real
    // erasure and made a live step report a tool call that was never lost.
    const forged = wrapUnknown(
      'codex',
      { type: 'degraded:tool_call' },
      'unrecognized',
      'degraded:tool_call',
    )
    expect(forged.type === 'unknown' && forged.label).toBe('provider:degraded:tool_call')
    expect(forged.type === 'unknown' && forged.label?.startsWith(DEGRADED_LABEL_PREFIX)).toBe(false)
    expect(forged.type === 'unknown' && 'degradedFrom' in forged).toBe(false)
    // ⚑ The paired positive: an ordinary provider label is untouched, whole and recognisable.
    const honest = wrapUnknown('codex', {}, 'lifecycle', 'thread/compacted')
    expect(honest.type === 'unknown' && honest.label).toBe('thread/compacted')
    // …and a real erasure still owns the namespace.
    expect(degradeEvent('claude', erasedToolCall).type === 'unknown').toBe(true)
    expect((degradeEvent('claude', erasedToolCall) as { label?: string }).label).toBe(
      'degraded:tool_call',
    )
  })

  it('the wire door can mark what it was even when the payload survives neither clone nor JSON', () => {
    // What `toWireEvent` does: the `raw` it carries is a projection, because Electron's structured
    // clone runs after us — but the TYPE is read off the original, so the frame is still named.
    const circular: Record<string, unknown> = { type: 'tool_call', id: 'toolu_1' }
    circular['self'] = circular
    const degraded = degradeEvent('claude', circular, '[unserializable object]')
    expect(degraded).toMatchObject({ degradedFrom: 'tool_call', raw: '[unserializable object]' })
  })
})
