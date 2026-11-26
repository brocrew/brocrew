import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runtimeEventSchema, type RuntimeEvent } from '../src/index'
import { codexTurnOutcome, normalizeNotification } from '../src/codex/normalize'
import {
  completedTurn,
  threadStartedNotification,
  turnCompletedNotification,
  turnStartedNotification,
} from './fixtures/codex-protocol'

describe('notification classification is exhaustive over the GENERATED union (060 P2)', () => {
  /**
   * The generated methods, read from the vendored protocol at test time — not a hand-copied list,
   * so this cannot drift from what the app-server actually sends (faithful doubles).
   */
  const GENERATED_METHODS: string[] = [
    ...new Set(
      readFileSync(new URL('../src/codex/protocol/ServerNotification.ts', import.meta.url), 'utf8')
        .match(/"method": "[^"]+"/g)!
        .map((m) => m.slice('"method": "'.length, -1)),
    ),
  ]

  /** Methods normalizeNotification maps itself — they never reach the chatter classifier. */
  const FIRST_CLASS = new Set([
    'error',
    'item/agentMessage/delta',
    'item/started',
    'item/completed',
    // 027: the reasoning summary stream is mapped, not classified.
    'item/reasoning/summaryTextDelta',
    'item/reasoning/summaryPartAdded',
    // 028: the plan is mapped to `plan_update`, not classified.
    'turn/plan/updated',
    // 087: the two the context meter is built on — a reading and a boundary.
    'thread/tokenUsage/updated',
    'thread/compacted',
    // 096: the turn's diff, parsed per file. It was `lifecycle` chatter until this task measured
    // that it is the ONLY file-change signal Codex actually sends.
    'turn/diff/updated',
    // 177: content-gated. The routine heartbeat is still `lifecycle` chatter — a throttle is not.
    'account/rateLimits/updated',
    // 177: never routine. `ModelRerouteReason` has one member, and every one of them means the
    // reply came from a model the user did not choose.
    'model/rerouted',
    'turn/started',
    'turn/completed',
    'thread/started',
    'thread/closed',
  ])

  const categoryOf = (method: string): string | undefined => {
    const [event] = normalizeNotification(method, { threadId: 'th_1', turnId: 'tn_1' })
    return event?.type === 'unknown' ? event.category : undefined
  }

  it('`thread/compacted` is a typed COMPACTION now, not chatter — and the legacy name still is', () => {
    // 060 P2's repro was that the classifier only knew the LEGACY `contextCompacted`, so the method
    // the pinned app-server actually sends fell through to `unrecognized` and rendered
    // prominently. 064 filed it as quiet `lifecycle`; 087 promotes it, because a compaction is the
    // reason a long conversation forgets things and it deserves a durable row.
    expect(GENERATED_METHODS).toContain('thread/compacted') // the name comes from the generated union
    expect(normalizeNotification('thread/compacted', { threadId: 'th_1', turnId: 'tn_1' })).toEqual(
      [
        // ⚠️ No magnitudes, and that is the protocol rather than a gap in the parsing:
        // `ContextCompactedNotification` is `{threadId, turnId}` and nothing else.
        { type: 'compaction', source: 'thread/compacted' },
      ],
    )
    // The legacy name an older app-server may still send stays CLASSIFIED chatter — it was never
    // promoted, and 087 did not promote it either: it is not in the generated union, so there is no
    // shape to trust. Paired with the positive above so "no longer lifecycle" cannot pass vacuously.
    expect(categoryOf('contextCompacted')).toBe('lifecycle')
  })

  it('EVERY generated notification method is classified — none falls through to `unrecognized`', () => {
    const unclassified = GENERATED_METHODS.filter(
      (method) => !FIRST_CLASS.has(method) && categoryOf(method) === 'unrecognized',
    )
    expect(unclassified, `unclassified generated methods: ${unclassified.join(', ')}`).toEqual([])
    expect(GENERATED_METHODS.length).toBeGreaterThan(60) // sanity: the union really was read
  })

  it('a method OUTSIDE the generated union is still `unrecognized` (loud)', () => {
    // The guard must not quiet genuinely-unknown traffic — that is the signal it exists to protect.
    expect(categoryOf('some/methodCodexNeverDeclared')).toBe('unrecognized')
    expect(categoryOf('totally-made-up')).toBe('unrecognized')
  })

  it('049 categories are preserved — the reasoning/plan/activity/echo buckets did not shift', () => {
    expect(categoryOf('item/reasoning/textDelta')).toBe('reasoning')
    // `item/plan/delta` is the ONLY member of the `plan` bucket now: 028 promoted
    // `turn/plan/updated` to a first-class `plan_update`, the same way 027 promoted the reasoning
    // summaries out of `reasoning`. The delta stays chatter because the protocol marks it
    // EXPERIMENTAL and warns its concatenation need not match the finished plan.
    expect(categoryOf('item/plan/delta')).toBe('plan')
    expect(categoryOf('item/commandExecution/outputDelta')).toBe('activity')
    expect(categoryOf('item/mcpToolCall/progress')).toBe('activity')
    expect(categoryOf('rawResponseItem/completed')).toBe('echo')
    // `thread/tokenUsage/updated` left the `lifecycle` bucket in 087 the same way the reasoning
    // summaries left `reasoning` in 027. `categoryOf` feeds a bare `{threadId, turnId}`, which for
    // a first-class method is now a MALFORMED payload — so `unrecognized` here is the 055 rule
    // firing, not the classifier. Paired with a method still in the bucket so a broken classifier
    // could not satisfy both lines.
    expect(categoryOf('thread/tokenUsage/updated')).toBe('unrecognized')
    expect(categoryOf('serverRequest/resolved')).toBe('lifecycle')
  })

  it('first-class methods are still handled as content/lifecycle, not classified as chatter', () => {
    // Protocol-shaped payloads per method: an empty payload would trip the malformed-delta /
    // malformed-item rules (055) and prove nothing about classification.
    const FAITHFUL: Record<string, unknown> = {
      error: { error: { message: 'boom' } },
      'item/agentMessage/delta': { delta: 'hi' },
      'item/started': { item: { type: 'commandExecution', id: 'i1', command: 'ls' } },
      'item/completed': { item: { type: 'agentMessage', id: 'm1', text: 'hi' } },
      'turn/started': turnStartedNotification('th_1', 'tn_1'),
      'turn/completed': turnCompletedNotification('th_1', completedTurn('tn_1')),
      'thread/started': threadStartedNotification('th_1'),
      'thread/closed': {},
      // 027: the reasoning summary stream is mapped to `thinking`, not classified.
      'item/reasoning/summaryTextDelta': { threadId: 'th_1', turnId: 'tn_1', delta: 'why' },
      'item/reasoning/summaryPartAdded': { threadId: 'th_1', turnId: 'tn_1', summaryIndex: 0 },
      // 028: the checklist is mapped to `plan_update`, not classified.
      'turn/plan/updated': {
        threadId: 'th_1',
        turnId: 'tn_1',
        explanation: null,
        plan: [{ step: 'do the thing', status: 'inProgress' }],
      },
      // 087: a real reading off this machine's own database, field for field.
      'thread/tokenUsage/updated': {
        threadId: 'th_1',
        turnId: 'tn_1',
        tokenUsage: {
          total: { totalTokens: 277751, inputTokens: 276618 },
          last: { totalTokens: 18790, inputTokens: 18731 },
          modelContextWindow: 258400,
        },
      },
      'thread/compacted': { threadId: 'th_1', turnId: 'tn_1' },
      // 096: a real aggregate off the wire, structurally verbatim — the shape the live probe
      // measured (`packages/runtime/smoke/file-change-probe.smoke.ts`), with a `diff --git` header
      // per file and git's own add/delete markers.
      'turn/diff/updated': {
        threadId: 'th_1',
        turnId: 'tn_1',
        diff: [
          'diff --git a/added.txt b/added.txt',
          'new file mode 100644',
          'index 0000000..ce01362',
          '--- /dev/null',
          '+++ b/added.txt',
          '@@ -0,0 +1 @@',
          '+hello',
          '',
        ].join('\n'),
      },
      // 177: the THROTTLED shape, which is the one this method is first-class for. The routine
      // shape it also handles is chatter by design and is asserted separately below — feeding it
      // here would fail this loop, which is exactly the discrimination being claimed.
      'account/rateLimits/updated': {
        rateLimits: { primary: { usedPercent: 97, windowDurationMins: 300, resetsAt: 1787224622 } },
      },
      // 177: the generated shape, field for field.
      'model/rerouted': {
        threadId: 'th_1',
        turnId: 'tn_1',
        fromModel: 'gpt-5.6-sol',
        toModel: 'gpt-5.4',
        reason: 'highRiskCyberActivity',
      },
    }
    for (const method of FIRST_CLASS) {
      const events = normalizeNotification(method, FAITHFUL[method])
      expect(
        events.every((e) => e.type !== 'unknown'),
        `${method} must be handled, not classified as chatter`,
      ).toBe(true)
    }
  })
})

describe('the Codex warning family surfaces as a NON-FATAL error, not quiet chatter (065)', () => {
  /**
   * Read straight from the vendored union: every generated method whose name says it reports a
   * problem. Derived, not hand-copied, so a NEW generated warning fails this suite instead of
   * quietly becoming chatter (faithful doubles).
   */
  const GENERATED_WARNING_METHODS = [
    ...new Set(
      readFileSync(new URL('../src/codex/protocol/ServerNotification.ts', import.meta.url), 'utf8')
        .match(/"method": "[^"]+"/g)!
        .map((m) => m.slice('"method": "'.length, -1))
        .filter((m) => /warning|deprecation|error/i.test(m) && m !== 'error'),
    ),
  ]

  const first = (method: string, params: unknown) => normalizeNotification(method, params)[0]

  it('covers exactly the six warning methods the generated union declares', () => {
    expect(GENERATED_WARNING_METHODS.sort()).toEqual(
      [
        'configWarning',
        'deprecationNotice',
        'guardianWarning',
        'thread/realtime/error',
        'warning',
        'windows/worldWritableWarning',
      ].sort(),
    )
  })

  it('EVERY generated warning method → visible non-fatal error, never an `unknown` card', () => {
    // Pre-fix (064) each of these was quiet `unknown{category:'lifecycle'}` — a guardianWarning
    // the user could never see.
    for (const method of GENERATED_WARNING_METHODS) {
      const event = first(method, { message: 'something is wrong' })
      expect(event, method).toMatchObject({ type: 'error', fatal: false })
      expect(event?.type === 'error' && event.message, method).toContain(method)
    }
  })

  it('carries the payload text: `message`, or `summary` (+ `details`)', () => {
    expect(
      first('guardianWarning', { threadId: 'th_1', message: 'sandbox escape attempt' }),
    ).toEqual({ type: 'error', message: 'guardianWarning: sandbox escape attempt', fatal: false })
    expect(first('configWarning', { summary: 'bad key', details: 'line 4' })).toEqual({
      type: 'error',
      message: 'configWarning: bad key — line 4',
      fatal: false,
    })
    expect(first('deprecationNotice', { summary: 'x is deprecated', details: null })).toEqual({
      type: 'error',
      message: 'deprecationNotice: x is deprecated',
      fatal: false,
    })
    // A payload with no text degrades to the method name, never an empty message.
    expect(
      first('windows/worldWritableWarning', { samplePaths: ['/tmp/x'], extraCount: 2 }),
    ).toEqual({ type: 'error', message: 'windows/worldWritableWarning', fatal: false })
  })

  it('is NEVER fatal — a warning must not terminate the session or turn', () => {
    for (const method of GENERATED_WARNING_METHODS) {
      const event = first(method, { message: 'x' })
      // Asserted in TWO steps deliberately: `event?.type === 'error' && event.fatal` would
      // short-circuit to `false` for a NON-error event and pass vacuously on the pre-fix code,
      // where these were quiet `unknown` cards (016/035 — a test must fail when the property
      // does not hold).
      expect(event?.type, method).toBe('error')
      expect((event as Extract<RuntimeEvent, { type: 'error' }>).fatal, method).toBe(false)
    }
  })

  it('non-warning methods still classify exactly as before (064 intact)', () => {
    const categoryOf = (method: string) => {
      const [event] = normalizeNotification(method, {})
      return event?.type === 'unknown' ? event.category : undefined
    }
    // `thread/compacted` left this list in 087 — it is a typed `compaction` now, so it produces no
    // `unknown` at all. The positive half of the pair is the line below it, which still does.
    expect(categoryOf('thread/compacted')).toBeUndefined()
    expect(normalizeNotification('thread/compacted', {})[0]?.type).toBe('compaction')
    expect(categoryOf('item/reasoning/textDelta')).toBe('reasoning')
    expect(categoryOf('thread/realtime/closed')).toBe('lifecycle') // a realtime sibling that is NOT a warning
    expect(categoryOf('some/methodCodexNeverDeclared')).toBe('unrecognized')
  })
})

/**
 * Codex sub-agents (033), reversing 029's conclusion that it has none.
 *
 * Every fixture below is a VERBATIM frame from a live capture — the exact JSON the app-server wrote
 * on stdout, kept whole rather than trimmed to the fields under test, because the last time these
 * shapes were reasoned about instead of read the conclusion was the opposite of the truth.
 */
describe('Codex sub-agents — subAgentActivity → sub_agent (033)', () => {
  /** Captured: `item/started` for the first of two agents, whole. */
  const BIRTH = {
    type: 'subAgentActivity',
    id: 'call_zFKkDrjgdPnOXkrtl3WPdkfY',
    kind: 'started',
    agentThreadId: '019fc03a-07e4-7632-a834-97f12ec75f38',
    agentPath: '/root/alpha',
  }

  it('a birth becomes ONE card, identified by the child thread and named from its path', () => {
    expect(normalizeNotification('item/started', { item: BIRTH })).toMatchObject([
      {
        type: 'sub_agent',
        phase: 'started',
        agentId: '019fc03a-07e4-7632-a834-97f12ec75f38',
        idKind: 'thread',
        parentToolCallId: 'call_zFKkDrjgdPnOXkrtl3WPdkfY',
        kind: 'alpha',
      },
    ])
  })

  it('the SAME item on item/completed emits nothing — that is the whole duplication fix', () => {
    // The provider does not send this twice. It sends one instantaneous announcement framed as an
    // item that opens and closes in the same millisecond (`startedAtMs === completedAtMs`, captured
    // as 1785636456494 for both), and the old catch-all wrapped it on BOTH phases. Every sub-agent
    // therefore rendered twice, and 033 was dispatched believing the provider was at fault.
    expect(normalizeNotification('item/completed', { item: BIRTH })).toEqual([])
  })

  it('an item/completed does NOT mean the sub-agent completed — nothing here can end a card', () => {
    // The distinction the bug hid: this item closing is the ANNOUNCEMENT closing. The child's own
    // ending arrives on its thread, in `CodexSubAgents`, and never through this function.
    const both = [
      ...normalizeNotification('item/started', { item: BIRTH }),
      ...normalizeNotification('item/completed', { item: BIRTH }),
    ]
    expect(both.filter((e) => e.type === 'sub_agent' && e.phase === 'ended')).toEqual([])
  })

  it('every SubAgentActivityKind maps, and only `interrupted` and `completed` end a card', () => {
    // Exhaustive over the generated union — the source switch makes a new member a compile error,
    // and this makes a member with no honest mapping a test failure.
    const phases = {
      started: 'started',
      interacted: 'progress',
      interrupted: 'ended',
      completed: 'ended',
    } as const
    for (const [kind, phase] of Object.entries(phases)) {
      const [event] = normalizeNotification('item/started', { item: { ...BIRTH, kind } })
      expect(event, `${kind} → ${phase}`).toMatchObject({ type: 'sub_agent', phase })
    }
    // An interruption is neither a success nor the sub-agent's fault: it reports itself rather than
    // being rounded to `failed` or hidden as "we were not told".
    expect(
      normalizeNotification('item/started', { item: { ...BIRTH, kind: 'interrupted' } })[0],
    ).toMatchObject({ phase: 'ended', outcome: 'interrupted' })
    // ⚑ 0.160.0's `completed` says the child is done, not how it went: no outcome, so a failed
    // ending its own `turn/completed` reported is never overwritten by a name.
    expect(
      normalizeNotification('item/started', { item: { ...BIRTH, kind: 'completed' } })[0],
    ).not.toHaveProperty('outcome')
  })

  it('an agent path keeps everything after the primary agent, and an odd one is kept whole', () => {
    const named = (agentPath: string): unknown =>
      normalizeNotification('item/started', { item: { ...BIRTH, agentPath } })[0]
    expect(named('/root/workspace_mapper')).toMatchObject({ kind: 'workspace_mapper' })
    // Hierarchy is information: a grandchild must not be flattened to its own last segment.
    expect(named('/root/alpha/gamma')).toMatchObject({ kind: 'alpha/gamma' })
    expect(named('/elsewhere/x')).toMatchObject({ kind: '/elsewhere/x' })
    expect(named('')).not.toHaveProperty('kind')
  })

  it('no identity, no card: it degrades to a LOUD unknown rather than an uncorrelatable card', () => {
    // A card whose agentId is empty can never be progressed or ended — it would spin forever.
    for (const item of [
      { ...BIRTH, agentThreadId: '' },
      { ...BIRTH, kind: 'someFutureKind' },
      { type: 'subAgentActivity', id: 'o1' },
    ]) {
      expect(normalizeNotification('item/started', { item }), JSON.stringify(item)).toEqual([
        {
          type: 'unknown',
          provider: 'codex',
          category: 'unrecognized',
          label: 'subAgentActivity',
          raw: item,
        },
      ])
    }
  })

  it('emits schema-valid events', () => {
    for (const event of normalizeNotification('item/started', { item: BIRTH })) {
      expect(runtimeEventSchema.parse(event)).toBeTruthy()
    }
  })
})

describe('Codex collab rows say what they DID (033)', () => {
  /** Captured verbatim: the only `collabAgentToolCall` shape four sessions ever produced. */
  const WAIT = {
    type: 'collabAgentToolCall',
    id: 'call_oItNoCWD2L90UHtPUqhABbz3',
    tool: 'wait',
    status: 'inProgress',
    senderThreadId: '019fc039-e13a-7c21-b1cd-5702b7b22fd2',
    receiverThreadIds: [],
    prompt: null,
    model: null,
    reasoningEffort: null,
    agentsStates: {},
  }
  const summaryOf = (item: unknown): string => {
    const [event] = normalizeNotification('item/started', { item })
    return event?.type === 'tool_call' ? event.summary : `not a tool_call: ${event?.type}`
  }

  it('the observed row reads as an operation, not as the bare word `wait`', () => {
    // `receiverThreadIds: []` is a BROADCAST wait, which "every agent" states exactly. Naming the
    // agents would need a payload no capture has ever contained.
    expect(summaryOf(WAIT)).toBe('wait for every agent')
    expect(summaryOf({ ...WAIT, receiverThreadIds: ['t1'] })).toBe('wait for 1 agent')
    expect(summaryOf({ ...WAIT, receiverThreadIds: ['t1', 't2'] })).toBe('wait for 2 agents')
  })

  it('every CollabAgentTool has a phrase, and an unknown one keeps its own name', () => {
    // ⚠️ "every agent" only for `wait`, the measured broadcast: for the rest an empty list says only
    // that the provider did not name the agent.
    const phrases: Record<string, string> = {
      spawnAgent: 'spawn an agent',
      sendInput: 'send input to an agent',
      resumeAgent: 'resume an agent',
      wait: 'wait for every agent',
      closeAgent: 'close an agent',
      sendMessage: 'send a message to an agent',
      followupTask: 'give an agent a follow-up task',
      interruptAgent: 'interrupt an agent',
      listAgents: 'list agents',
    }
    for (const [tool, phrase] of Object.entries(phrases)) {
      expect(summaryOf({ ...WAIT, tool }), tool).toBe(phrase)
    }
    // A tool the generated union does not know is more informative under its own name than under
    // an invented phrase or the generic 'collab'.
    expect(summaryOf({ ...WAIT, tool: 'teleportAgent' })).toBe('teleportAgent')
    expect(summaryOf({ ...WAIT, tool: '' })).toBe('collab')
  })

  it('the prompt no longer HIDES the operation, which is the bug being fixed', () => {
    // Before 033 a collab call carrying a prompt rendered the prompt alone, so the one field that
    // says whether an agent was spawned, messaged or CLOSED was the one field left off the row.
    expect(summaryOf({ ...WAIT, tool: 'spawnAgent', prompt: 'map the workspace' })).toBe(
      'spawn an agent — map the workspace',
    )
    expect(summaryOf({ ...WAIT, tool: 'spawnAgent', model: 'gpt-5.6-sol', prompt: 'map it' })).toBe(
      'spawn an agent · gpt-5.6-sol — map it',
    )
  })
})

/**
 * **The context meter's Codex half** (087).
 *
 * The provider that reports a window, and the one whose payload contains a number that looks like
 * the answer and is not.
 */
describe('context readings and compaction boundaries (087)', () => {
  /**
   * A real payload off this machine's own database, verbatim except for the ids.
   *
   * ⚠️ **`total` and `last` are both here and they disagree by an order of magnitude**, which is
   * the entire point of the fixture: a test that supplied only the field we read could not fail if
   * the wrong one were read.
   */
  const usage = (over: Record<string, unknown> = {}) => ({
    threadId: 'th_1',
    turnId: 'tn_1',
    tokenUsage: {
      total: { totalTokens: 277751, inputTokens: 276618, cachedInputTokens: 200000 },
      last: { totalTokens: 18790, inputTokens: 18731, cachedInputTokens: 11008 },
      modelContextWindow: 258400,
      ...over,
    },
  })

  it('reads `last`, not `total` — `total` is cumulative billing and blows past the window', () => {
    // ⚠️ **Measured, over all 198 of these payloads in this machine's database:**
    // `total.totalTokens` exceeded `modelContextWindow` in **29 of them** (445,780 against a
    // 258,400 window — a gauge reading 172%). `last.*` exceeded it in **zero**. `total` is what the
    // thread has COST; `last` is what is in the window. Reading `total` here would have shipped a
    // percentage over 100 on any long conversation.
    expect(normalizeNotification('thread/tokenUsage/updated', usage())).toEqual([
      {
        type: 'context_reading',
        reading: { kind: 'proportional', used: 18790, window: 258400 },
        source: 'thread/tokenUsage/updated',
      },
    ])
    // The trap, named: the number NOT chosen would have been over the window.
    expect(277751).toBeGreaterThan(258400)
  })

  it('a null `modelContextWindow` degrades to `tokens` — the kind follows the payload, not the provider', () => {
    // The generated type is `number | null`. Codex has never sent null on this machine (198 of 198
    // carried a window), so this is the branch that is NOT observed — and it is exactly the branch
    // where a `window ?? 0` would divide by zero.
    const [event] = normalizeNotification(
      'thread/tokenUsage/updated',
      usage({ modelContextWindow: null }),
    )
    expect(event).toEqual({
      type: 'context_reading',
      reading: { kind: 'tokens', used: 18790 },
      source: 'thread/tokenUsage/updated',
    })
  })

  it('a window of ZERO is treated as no window — a denominator of 0 renders as Infinity', () => {
    // Narrowed rather than `&&`-ed, for the reason spelled out under the `contextCompaction` test
    // below: `guard && value` is `false` when the guard fails, which is not the value being claimed.
    const [event] = normalizeNotification(
      'thread/tokenUsage/updated',
      usage({ modelContextWindow: 0 }),
    )
    expect(event?.type).toBe('context_reading')
    if (event?.type === 'context_reading') expect(event.reading.kind).toBe('tokens')
    // Paired with the positive: a real window still produces a proportion, so this is a statement
    // about zero rather than about proportional readings having quietly stopped working.
    const [ok] = normalizeNotification('thread/tokenUsage/updated', usage())
    expect(ok?.type).toBe('context_reading')
    if (ok?.type === 'context_reading') expect(ok.reading.kind).toBe('proportional')
  })

  it('an unreadable count is LOUD, not a silent absence — a quiet meter looks like a quiet provider', () => {
    // 055's rule applied to a measurement: a first-class method arriving malformed is a fact about
    // the provider worth seeing. The alternative — returning `[]` — makes a broken payload
    // indistinguishable from a provider that simply has not reported yet, and the meter renders
    // both as `unknown`, so the defect would be invisible in the one surface built to show it.
    const MALFORMED: Record<string, unknown>[] = [
      {},
      { threadId: 't', turnId: 'u' },
      { tokenUsage: {} },
      { tokenUsage: { last: {} } },
      { tokenUsage: { last: { totalTokens: 'lots' } } },
      { tokenUsage: { total: { totalTokens: 18790 } } }, // the count is there, in the WRONG field
    ]
    for (const params of MALFORMED)
      expect(
        normalizeNotification('thread/tokenUsage/updated', params)[0],
        JSON.stringify(params),
      ).toMatchObject({ type: 'unknown', category: 'unrecognized' })
    // Non-vacuity: the well-formed payload is NOT loud, so the loop above separates two outcomes
    // rather than asserting that this method is always `unrecognized`.
    expect(normalizeNotification('thread/tokenUsage/updated', usage())[0]?.type).toBe(
      'context_reading',
    )
  })

  it('the `contextCompaction` ITEM is the path that runs, and it draws ONE row per compaction', () => {
    // ⚠️ Codex announces the item on BOTH phases with the SAME id — four events for two
    // compactions, measured on this machine. Drawing the row on `completed` only is what stops one
    // compaction drawing two boundary rows and making the meter's tally say 2.
    // ⚑ **717 · and its `started` phase is the compaction UNDER WAY** (`713` F-3: 140 ms before the
    // completion, with Codex's summary request between them) — the live pill, never a second row.
    const item = { type: 'contextCompaction', id: '019fd9ff-5721-73f1-ba21-e162ca2acf5b' }
    expect(normalizeNotification('item/started', { item })).toEqual([
      { type: 'activity', phase: 'compacting' },
    ])
    expect(normalizeNotification('item/completed', { item })).toEqual([
      { type: 'compaction', compactionId: item.id, source: 'contextCompaction' },
    ])
  })

  it('⚑ 717 · the control: no OTHER item kind, on either phase, says it is compacting', () => {
    // ⚑ Every other generated `ThreadItem['type']` — the union `itemCategory` is exhaustive over —
    // carrying the fields each kind's arm reads, so each reaches its real branch rather than the
    // malformed exit. A pill raised by an ordinary turn would claim a compaction nobody is running.
    const others = [
      'agentMessage',
      'reasoning',
      'plan',
      'imageGeneration',
      'subAgentActivity',
      'commandExecution',
      'fileChange',
      'mcpToolCall',
      'dynamicToolCall',
      'webSearch',
      'collabAgentToolCall',
      'userMessage',
      'hookPrompt',
      'imageView',
      'sleep',
      'enteredReviewMode',
      'exitedReviewMode',
    ]
    expect(others.length + 1, 'the 18-variant union, less `contextCompaction`').toBe(18)
    let reached = 0
    for (const type of others) {
      // ⚑ `kind` / `agentThreadId` / `agentPath` are what a sub-agent's birth reads (`717`'s review,
      // round 2: without them `subAgentActivity` took the malformed exit, not its branch).
      const item = {
        type,
        id: 'x1',
        text: 'words',
        command: 'ls',
        status: 'completed',
        kind: 'started',
        agentThreadId: 'th_child',
        agentPath: 'child',
      }
      for (const method of ['item/started', 'item/completed'] as const) {
        const events = normalizeNotification(method, { item })
        reached += events.length
        expect(
          events.some((event) => event.type === 'unknown' && event.category === 'unrecognized'),
          `${type} · ${method} took the malformed exit`,
        ).toBe(false)
        expect(
          events.some((event) => event.type === 'activity' && event.phase === 'compacting'),
          `${type} · ${method}`,
        ).toBe(false)
      }
    }
    // ⚑ Non-vacuity: the loop normalised real events, not a wall of empty arrays.
    expect(reached).toBeGreaterThan(20)
  })

  it('carries NO magnitudes, because Codex reports none', () => {
    // `ContextCompactionItem` is `{type, id}` and `ContextCompactedNotification` is
    // `{threadId, turnId}` — both verified in the generated protocol. A row with no numbers is the
    // correct outcome; a row with plausible ones would be fiction.
    const [event] = normalizeNotification('item/completed', {
      item: { type: 'contextCompaction', id: 'c1' },
    })
    expect(event).toEqual({ type: 'compaction', compactionId: 'c1', source: 'contextCompaction' })
    // ⚠️ These two used to read `expect(event?.type === 'compaction' && event.before)`, which
    // short-circuits to `false` — not `undefined` — whenever the guard fails, so `toBeUndefined()`
    // could never catch anything the `toEqual` above had not already caught (review findings 21 and
    // 25). Narrowed with an `if`, so the assertion is about the field.
    expect(event?.type).toBe('compaction')
    if (event?.type === 'compaction') {
      expect(event.before).toBeUndefined()
      expect(event.after).toBeUndefined()
      expect(event.trigger).toBeUndefined()
    }
  })
})

/**
 * 🔴 **348 · a dynamic tool call is named, not flattened to the word `tool`.**
 *
 * ⛔ **`327`'s defect, on the item type `348` introduced.** `TOOL_ITEM_NAMES` maps
 * `dynamicToolCall` to the constant `'tool'`, so all five of this app's own tools — spawn, message,
 * end, list, status — would have appeared in a Codex transcript as five identical rows.
 *
 * ⚑ **The WIRE oracle is `smoke:codex-spawn`**, which asserts the row a real child produced is
 * `brobot__spawn_agent`. `327` §3's rule stands: a green unit test proves the normalizer, so the
 * spelling below is measured elsewhere and pinned here.
 */
describe('348 · the name of a dynamic tool call', () => {
  const rowFor = (item: Record<string, unknown>): { type: string; name?: string } =>
    normalizeNotification('item/started', {
      item: { id: 'i1', status: 'inProgress', ...item },
      threadId: 'th_1',
      turnId: 'tn_1',
    })[0] as { type: string; name?: string }

  it('⛔ a namespaced tool takes the provider’s own `<namespace>__<tool>` spelling', () => {
    const row = rowFor({ type: 'dynamicToolCall', namespace: 'brobot', tool: 'spawn_agent' })
    expect(row.type).toBe('tool_call')
    expect(row.name).toBe('brobot__spawn_agent')
  })

  it('⚠️ a tool declared without a namespace keeps its bare name', () => {
    expect(rowFor({ type: 'dynamicToolCall', namespace: null, tool: 'spawn_agent' }).name).toBe(
      'spawn_agent',
    )
  })

  it('🔴 …and an item with no tool name at all still says `tool` rather than inventing one', () => {
    // ⚠️ The paired negative. `tool` is non-null in the generated `ThreadItem`, so this is a
    // malformed item — and the honest answer to a malformed item is the word it always had, never a
    // name assembled from half of one.
    expect(rowFor({ type: 'dynamicToolCall', namespace: 'brobot' }).name).toBe('tool')
  })

  it('⚑ it is NOT prefixed `mcp__`, which is what Claude calls the same gesture', () => {
    // ⛔ `327` §2.4: one vocabulary for one thing, arrived at by measuring both providers. What was
    // measured there was each provider's OWN qualified name — and Codex does not call this MCP.
    expect(
      rowFor({ type: 'dynamicToolCall', namespace: 'brobot', tool: 'end_agent' }).name,
    ).not.toContain('mcp__')
    // …and the sibling that DOES carry the prefix, so this is a distinction rather than a blanket.
    expect(rowFor({ type: 'mcpToolCall', server: 'other', tool: 'echo' }).name).toBe(
      'mcp__other__echo',
    )
  })
})

describe('Codex 0.160.0 · what the bump added to the classifier', () => {
  it('a tool that reports `interrupted` failed, and says that word', () => {
    const [result] = normalizeNotification('item/completed', {
      item: {
        type: 'collabAgentToolCall',
        id: 'call_1',
        tool: 'interruptAgent',
        status: 'interrupted',
        senderThreadId: 't0',
        receiverThreadIds: ['t1'],
        prompt: null,
        model: null,
        reasoningEffort: null,
        agentsStates: {},
      },
    })
    expect(result).toMatchObject({ type: 'tool_result', id: 'call_1', ok: false })
    expect(result?.type === 'tool_result' ? result.summary : '').toContain('interrupted')
  })

  it('a failed turn carries the misalignment explanation beside its message', () => {
    const outcome = codexTurnOutcome({
      turn: {
        id: 't',
        status: 'failed',
        error: {
          message: 'blocked',
          codexErrorInfo: 'misalignmentPolicyViolation',
          additionalDetails: null,
          misalignment: {
            errorType: null,
            detailedExplanation: 'the request asked for X',
            steer: null,
          },
        },
      },
    })
    expect(outcome).toEqual({
      outcome: 'failed',
      message: 'turn failed: blocked — the request asked for X',
    })
    // …and a turn error without one reads exactly as before.
    expect(
      codexTurnOutcome({
        turn: { id: 't', status: 'failed', error: { message: 'boom', misalignment: null } },
      }),
    ).toEqual({ outcome: 'failed', message: 'turn failed: boom' })
  })

  it('the error notification and terminal read the same native explanation', () => {
    const error = {
      message: 'blocked',
      misalignment: { detailedExplanation: 'the request asked for X' },
    }
    expect(normalizeNotification('error', { error })).toEqual([
      { type: 'error', message: 'blocked — the request asked for X', fatal: false },
    ])
    expect(codexTurnOutcome({ turn: { status: 'failed', error } })).toEqual({
      outcome: 'failed',
      message: 'turn failed: blocked — the request asked for X',
    })
    expect(normalizeNotification('error', { message: 'legacy detail' })).toEqual([
      { type: 'error', message: 'legacy detail', fatal: false },
    ])
    expect(normalizeNotification('error', {})).toEqual([
      { type: 'error', message: 'codex error', fatal: false },
    ])
  })

  it('the new notifications are classified, never `unrecognized`', () => {
    const quiet = {
      'thread/reverted': 'lifecycle',
      'thread/attachment/updated': 'lifecycle',
      'thread/queue/changed': 'lifecycle',
      'project/changed': 'lifecycle',
      'thread/project/updated': 'lifecycle',
      'thread/readState/changed': 'lifecycle',
      'thread/section/changed': 'lifecycle',
      'thread/prediction/updated': 'lifecycle',
      'account/gatewayOAuth/changed': 'lifecycle',
      'modelProvider/authRecoveryStarted': 'lifecycle',
      'modelProvider/authRecoveryCompleted': 'lifecycle',
      'autoApprovalReview/strictReviewRequired': 'activity',
      'mcpServer/event/stream/notification': 'activity',
      'thread/realtime/item/started': 'activity',
      'thread/realtime/item/transcript/delta': 'activity',
      'thread/realtime/item/completed': 'activity',
    } as const
    for (const [method, category] of Object.entries(quiet)) {
      const [event] = normalizeNotification(method, { threadId: 't' })
      expect(event, method).toMatchObject({ type: 'unknown', category })
    }
  })
})
