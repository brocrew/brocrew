import { describe, expect, it } from 'vitest'
import { runtimeEventSchema, type RuntimeEvent } from '../src/index'
import { codexTurnOutcome, normalizeNotification } from '../src/codex/normalize'
import {
  completedTurn,
  threadStartedNotification,
  turn,
  turnCompletedNotification,
  turnStartedNotification,
} from './fixtures/codex-protocol'

describe('normalizeNotification — Codex → content RuntimeEvents', () => {
  it('turn/started emits no content (working is machine-owned)', () => {
    expect(normalizeNotification('turn/started', turnStartedNotification('t', 'tn_1'))).toEqual([])
  })

  describe('turn/plan/updated → plan_update (028)', () => {
    const planned = (plan: unknown, explanation: string | null = null): RuntimeEvent | undefined =>
      normalizeNotification('turn/plan/updated', {
        threadId: 'th_1',
        turnId: 'tn_1',
        explanation,
        plan,
      })[0]

    it('maps the three statuses and states the WHOLE list, exactly as captured live', () => {
      // Both payloads are the real ones from the 026 capture, shortened but otherwise verbatim.
      expect(
        planned([
          { step: 'Create notes.txt', status: 'inProgress' },
          { step: 'Count the lines', status: 'pending' },
        ]),
      ).toMatchObject({
        type: 'plan_update',
        steps: [
          { text: 'Create notes.txt', status: 'active' },
          { text: 'Count the lines', status: 'pending' },
        ],
      })

      // The SECOND notification of the same turn restates every step — which is why the neutral
      // event replaces rather than appends, and why nothing accumulates between these two calls.
      expect(
        planned(
          [
            { step: 'Create notes.txt', status: 'completed' },
            { step: 'Count the lines', status: 'completed' },
          ],
          'Created the file and verified its line count.',
        ),
      ).toMatchObject({
        type: 'plan_update',
        steps: [
          { text: 'Create notes.txt', status: 'done' },
          { text: 'Count the lines', status: 'done' },
        ],
        note: 'Created the file and verified its line count.',
      })
    })

    it('a null explanation stays ABSENT rather than becoming an empty note', () => {
      // `null` is the live default while a plan is being worked; `note: ''` would render as a
      // caption that exists and says nothing.
      const event = planned([{ step: 'x', status: 'pending' }])
      expect(event).not.toHaveProperty('note')
      expect(runtimeEventSchema.safeParse(event).success).toBe(true)
    })

    it('ONE unreadable step condemns the whole plan — a checklist with a hole is worse than none', () => {
      // A plan rendered with a line silently missing reads as complete. Each of these is loud
      // instead: the method is recognized, so `unrecognized` says the PAYLOAD surprised us.
      for (const plan of [
        [{ step: 'ok', status: 'pending' }, { step: 'no status' }],
        [{ step: 'ok', status: 'pending' }, { status: 'pending' }], // no text
        [
          { step: 'ok', status: 'pending' },
          { step: 'x', status: 'somethingNew' },
        ],
        'not an array',
        undefined,
      ]) {
        expect(planned(plan), JSON.stringify(plan)).toMatchObject({
          type: 'unknown',
          provider: 'codex',
          category: 'unrecognized',
          label: 'turn/plan/updated',
        })
      }
    })

    it('an EMPTY plan passes through as the empty list it is', () => {
      // Never observed, and deliberately not second-guessed here: the adapter states what the
      // provider said, and the FOLD decides that an empty checklist opens no block (028).
      expect(planned([])).toMatchObject({ type: 'plan_update', steps: [] })
    })
  })

  it('item/agentMessage/delta → assistant_delta', () => {
    expect(
      normalizeNotification('item/agentMessage/delta', {
        threadId: 't',
        turnId: 'tn',
        itemId: 'i',
        delta: 'Hel',
      }),
    ).toEqual([{ type: 'assistant_delta', text: 'Hel' }])
  })

  it('coalesced deltas then an authoritative agentMessage', () => {
    const stream = ['Hel', 'lo'].flatMap((delta) =>
      normalizeNotification('item/agentMessage/delta', { delta }),
    )
    expect(stream).toEqual([
      { type: 'assistant_delta', text: 'Hel' },
      { type: 'assistant_delta', text: 'lo' },
    ])
    expect(
      normalizeNotification('item/completed', {
        item: { type: 'agentMessage', id: 'm1', text: 'Hello' },
      }),
    ).toEqual([{ type: 'assistant_message', text: 'Hello' }])
  })

  it('item/started commandExecution → tool_call; item/completed → tool_result (ok from status)', () => {
    expect(
      normalizeNotification('item/started', {
        item: { type: 'commandExecution', id: 'i1', command: 'ls -la' },
      }),
    ).toMatchObject([{ type: 'tool_call', id: 'i1', name: 'shell', summary: 'ls -la' }])

    expect(
      normalizeNotification('item/completed', {
        item: { type: 'commandExecution', id: 'i1', status: 'completed' },
      }),
    ).toMatchObject([{ type: 'tool_result', id: 'i1', summary: 'shell command', ok: true }])

    expect(
      normalizeNotification('item/completed', {
        item: { type: 'commandExecution', id: 'i1', status: 'failed' },
      })[0],
    ).toMatchObject({ type: 'tool_result', ok: false })
  })

  it('item/started fileChange → tool_call(apply_patch)', () => {
    expect(
      normalizeNotification('item/started', { item: { type: 'fileChange', id: 'f1' } }),
    ).toEqual([{ type: 'tool_call', id: 'f1', name: 'apply_patch', summary: 'file change' }])
  })

  it('turn/completed emits no content (the turn terminal is machine-owned)', () => {
    expect(
      normalizeNotification(
        'turn/completed',
        turnCompletedNotification('th_1', completedTurn('t')),
      ),
    ).toEqual([])
  })

  it('a MALFORMED agentMessage delta is surfaced, not silently dropped (044 P2 #5)', () => {
    // Pre-fix an intentional no-content delta and a malformed payload were both `[]`, so a delta
    // whose field was missing or the wrong type vanished with no trace.
    for (const params of [
      { threadId: 't', turnId: 'tn', itemId: 'i' }, // `delta` missing entirely
      { threadId: 't', turnId: 'tn', itemId: 'i', delta: 42 }, // wrong type
      { threadId: 't', turnId: 'tn', itemId: 'i', delta: null },
      { threadId: 't', turnId: 'tn', itemId: 'i', delta: { text: 'nested' } },
      'not even a record',
    ]) {
      expect(
        normalizeNotification('item/agentMessage/delta', params),
        JSON.stringify(params),
      ).toEqual([
        {
          type: 'unknown',
          provider: 'codex',
          category: 'unrecognized',
          label: 'item/agentMessage/delta', // the neutral KIND, for display (072)
          raw: { method: 'item/agentMessage/delta', params },
        },
      ])
    }
  })

  it('a WELL-FORMED empty delta stays an intentional no-op (no false `unknown`)', () => {
    expect(
      normalizeNotification('item/agentMessage/delta', {
        threadId: 't',
        turnId: 'tn',
        itemId: 'i',
        delta: '',
      }),
    ).toEqual([])
  })

  it('codexTurnOutcome FAILS CLOSED on inProgress and on an unknown status (044 P2 #5)', () => {
    // `turn/completed` saying the turn is still `inProgress` is a contradiction; pre-fix BOTH this
    // and any future status were reported as a success the provider never claimed.
    const inProgress = codexTurnOutcome(
      turnCompletedNotification('th_1', turn('t', { status: 'inProgress' })),
    )
    expect(inProgress.outcome).toBe('failed')
    expect(inProgress.message).toMatch(/inProgress/)

    const future = codexTurnOutcome({ turn: { id: 't', status: 'futureStatus' } })
    expect(future.outcome).toBe('failed')
    expect(future.message).toMatch(/unrecognized status/)

    // A missing/absent status is not an affirmative success either.
    expect(codexTurnOutcome({ turn: { id: 't' } }).outcome).toBe('failed')
    expect(codexTurnOutcome({}).outcome).toBe('failed')
  })

  it('codexTurnOutcome maps turn.status to a terminal outcome', () => {
    expect(codexTurnOutcome({ turn: { status: 'completed' } })).toEqual({ outcome: 'completed' })
    expect(codexTurnOutcome({ turn: { status: 'interrupted' } })).toEqual({
      outcome: 'interrupted',
    })
    const failed = codexTurnOutcome({ turn: { status: 'failed', error: { message: 'boom' } } })
    expect(failed.outcome).toBe('failed')
    expect(failed.message).toContain('boom')
  })

  it('error notification → non-fatal error event', () => {
    expect(normalizeNotification('error', { message: 'rate limited' })).toEqual([
      { type: 'error', message: 'rate limited', fatal: false },
    ])
  })

  it('session-lifecycle notifications are owned by the handle (mapped to nothing here)', () => {
    expect(normalizeNotification('thread/started', threadStartedNotification('t'))).toEqual([])
    expect(normalizeNotification('thread/closed', {})).toEqual([])
  })

  it('unmapped notification → unknown carrying raw (never throws)', () => {
    let events: RuntimeEvent[] = []
    expect(() => {
      events = normalizeNotification('some/futureNotification', { a: 1 })
    }).not.toThrow()
    expect(events[0]).toMatchObject({
      type: 'unknown',
      provider: 'codex',
      raw: { method: 'some/futureNotification', params: { a: 1 } },
    })
  })
})

describe('normalizeNotification — full ThreadItem coverage + error shape (007 P2-2)', () => {
  // Every generated ThreadItem['type'] classified. Kept in sync by the source's
  // exhaustive `itemCategory` switch (a new union member is a compile error).
  const TOOL_TYPES = [
    'commandExecution',
    'fileChange',
    'mcpToolCall',
    'dynamicToolCall',
    'webSearch',
    'collabAgentToolCall',
  ]
  const OPAQUE_TYPES = [
    'userMessage',
    'hookPrompt',
    // 0.160.0 · the output of a function call a CLIENT supplied with `turn/start`'s `toolOutput`,
    // which this app never sends: our own input reflected back.
    'functionCallOutput',
    // ⚠️ `imageView` is still here and `imageGeneration` is not (067). The asymmetry is deliberate
    // and is argued in `normalize.ts`: a generated image is written to a file inside the provider's
    // own home, and a VIEWED one is an arbitrary path anywhere the agent can read.
    'imageView',
    'sleep',
    'enteredReviewMode',
    'exitedReviewMode',
    // ⚠️ `contextCompaction` LEFT this set in 087, exactly as `imageGeneration` left it in 067: it
    // is a first-class `compaction` event now. Its absence here is load-bearing — leaving it would
    // assert that the one durable record of dropped context is still quiet chatter.
  ]

  it('covers the full 19-variant union (6 tool + 8 opaque + subAgentActivity + reasoning + agentMessage + plan + imageGeneration)', () => {
    // +1 agentMessage, +1 reasoning, +1 subAgentActivity, +1 plan, +1 imageGeneration — each left
    // the opaque set when it became a first-class event (027, then 033, then 057, then 067), so the
    // union total is unchanged and the split moved. `contextCompaction` is the newest (087): four
    // real ones on this machine against zero of the `thread/compacted` notification the protocol
    // now prefers, so the ITEM is the path that actually runs and it became `compaction`.
    // `functionCallOutput` joined the opaque set at 0.160.0.
    expect(TOOL_TYPES.length + OPAQUE_TYPES.length + 6).toBe(19)
  })

  it('tool kinds map to tool_call/tool_result, and a REAL success is ok:true (including collabAgentToolCall)', () => {
    for (const type of TOOL_TYPES) {
      // Protocol-shaped (062): every status-bearing tool kind reports one, so the fixture carries
      // an affirmative `completed` rather than omitting the field the real provider always sends.
      const item = { type, id: 'x1', command: 'ls', query: 'q', prompt: 'p', status: 'completed' }
      expect(normalizeNotification('item/started', { item })[0]?.type, `${type} started`).toBe(
        'tool_call',
      )
      expect(
        normalizeNotification('item/completed', { item })[0],
        `${type} completed`,
      ).toMatchObject({ type: 'tool_result', ok: true })
    }
  })

  it('agentMessage completed → assistant_message', () => {
    expect(
      normalizeNotification('item/completed', {
        item: { type: 'agentMessage', id: 'm', text: 'hi' },
      }),
    ).toEqual([{ type: 'assistant_message', text: 'hi' }])
  })

  /**
   * 🔴 **319 · the field this function read past for three dispatches.**
   *
   * ⛔ **316 concluded a memory recall was *"invisible, permanently"*** after counting item TYPES
   * across fifteen config arms looking for a memory tool. 318 re-measured with a control and found
   * it on the item that search had already seen: `agentMessage.memoryCitation`, parsed by the
   * app-server out of the model's own `<oai-mem-citation>` block and stripped out of `text`.
   *
   * ⚑ **The payload below is the one 318 captured from a real 0.146.0 child**, verbatim — including
   * the `019c6e27-…` rollout id — so these are assertions about a shape the wire produced rather
   * than about one this file invented.
   */
  describe('a memory recall on the message item (319)', () => {
    const CITED = {
      type: 'agentMessage',
      id: 'm',
      text: "The user's full name is Bob Alicio.",
      memoryCitation: {
        entries: [{ path: 'MEMORY.md', lineStart: 1, lineEnd: 3, note: 'BROBOT_318_NOTE_MARKER' }],
        threadIds: ['019c6e27-e55b-73d1-87d8-4e01f1f75043'],
      },
    }

    it('carries the file, the LINE RANGE and the note — all three came off the wire', () => {
      expect(normalizeNotification('item/completed', { item: CITED })).toEqual([
        { type: 'assistant_message', text: "The user's full name is Bob Alicio." },
        {
          type: 'memory_recall',
          entries: [
            { path: 'MEMORY.md', lineStart: 1, lineEnd: 3, note: 'BROBOT_318_NOTE_MARKER' },
          ],
          threadIds: ['019c6e27-e55b-73d1-87d8-4e01f1f75043'],
          source: 'memoryCitation',
        },
      ])
    })

    it('emits the recall AFTER the message, so the row is under the answer either way', () => {
      // ⛔ The position is a ruling (see the adapter): the fold finalizes a STREAMED assistant block
      // in place, so a recall emitted first would sit above the answer when nothing streamed and
      // below it when something did — one payload, two layouts, decided by a channel nobody sees.
      const events = normalizeNotification('item/completed', { item: CITED })
      expect(events.map((event) => event.type)).toEqual(['assistant_message', 'memory_recall'])
    })

    it('⛔ `null` is the provider saying NO MEMORY WAS CONSULTED, and draws nothing', () => {
      // 318's control arm: a reply with no citation block carries the field PRESENT and `null`. So
      // the distinction is real on the wire, and this layer collapses it to no event on purpose —
      // a row under every answer saying "no memory was consulted" is noise, and one saying
      // "unknown" is the fabricated third state 319 §1.3 forbids by name.
      expect(
        normalizeNotification('item/completed', {
          item: { type: 'agentMessage', id: 'm', text: 'hi', memoryCitation: null },
        }),
      ).toEqual([{ type: 'assistant_message', text: 'hi' }])
    })

    it('an ABSENT field draws nothing either — and the message is never lost with it', () => {
      // ⚠️ The paired positive: whatever happens to the citation, the ANSWER still arrives. A
      // reading that could swallow the reply would be a far worse bug than a missing row.
      const events = normalizeNotification('item/completed', {
        item: { type: 'agentMessage', id: 'm', text: 'hi' },
      })
      expect(events).toEqual([{ type: 'assistant_message', text: 'hi' }])
    })

    it('a MALFORMED citation is "no citation", never an error (319 §3)', () => {
      // ⛔ This field is not in a contract this app controls. A shape from a future pin must cost
      // this channel its rows and cost the conversation nothing else — never an `unknown` row on
      // every assistant message the provider ever sends again.
      for (const memoryCitation of ['nope', 42, [], { entries: 'no' }, { entries: [{}] }]) {
        expect(
          normalizeNotification('item/completed', {
            item: { type: 'agentMessage', id: 'm', text: 'hi', memoryCitation },
          }),
        ).toEqual([{ type: 'assistant_message', text: 'hi' }])
      }
    })

    it('a broken RANGE costs the range and not the file (074)', () => {
      const events = normalizeNotification('item/completed', {
        item: {
          type: 'agentMessage',
          id: 'm',
          text: 'hi',
          memoryCitation: {
            // Every way a range can be unusable, one per entry: reversed, fractional, negative,
            // half-present, and not a number at all. ⛔ `234-3` is not a shortened fact.
            entries: [
              { path: 'a.md', lineStart: 234, lineEnd: 3, note: 'reversed' },
              { path: 'b.md', lineStart: 1.5, lineEnd: 9, note: 'fractional' },
              { path: 'c.md', lineStart: -1, lineEnd: 9, note: 'negative' },
              { path: 'd.md', lineStart: 4, note: 'half' },
              { path: 'e.md', lineStart: 'one', lineEnd: 'three', note: 'words' },
            ],
            threadIds: [],
          },
        },
      })
      const recall = events.find((event) => event.type === 'memory_recall')
      expect(recall?.type === 'memory_recall' && recall.entries).toEqual([
        { path: 'a.md', note: 'reversed' },
        { path: 'b.md', note: 'fractional' },
        { path: 'c.md', note: 'negative' },
        { path: 'd.md', note: 'half' },
        { path: 'e.md', note: 'words' },
      ])
      // ⚑ The paired positive on the same payload: a usable range beside them still survives, so
      // this test cannot pass by the reader having stopped reading ranges altogether.
      const good = normalizeNotification('item/completed', { item: CITED }).find(
        (event) => event.type === 'memory_recall',
      )
      expect(good?.type === 'memory_recall' && good.entries[0]?.lineStart).toBe(1)
    })

    it('⛔ a citation from which NOTHING survives draws nothing, not a bare "used memory" row', () => {
      // 319 §1.1: the file, the range and the note are what make the row worth showing. A heading
      // with none of them is the row the dispatch rules out by name.
      expect(
        normalizeNotification('item/completed', {
          item: {
            type: 'agentMessage',
            id: 'm',
            text: 'hi',
            memoryCitation: { entries: [{ path: '' }], threadIds: ['019c6e27'] },
          },
        }),
      ).toEqual([{ type: 'assistant_message', text: 'hi' }])
    })

    it('a citation on a message with NO text stays surfaced as malformed', () => {
      // Missing text is malformed even when a citation is present; an explicit empty string is valid.
      const events = normalizeNotification('item/completed', {
        item: { type: 'agentMessage', id: 'm', memoryCitation: CITED.memoryCitation },
      })
      expect(events.map((event) => event.type)).toEqual(['unknown'])
    })

    it('every emitted recall satisfies the wire schema', () => {
      for (const event of normalizeNotification('item/completed', { item: CITED })) {
        expect(runtimeEventSchema.safeParse(event).success).toBe(true)
      }
    })
  })

  /** The neutral category each opaque kind is classified into (049) — keyed by real item type. */
  const OPAQUE_CATEGORIES: Record<string, string> = {
    userMessage: 'echo',
    hookPrompt: 'echo',
    functionCallOutput: 'echo',
    imageView: 'activity',
    sleep: 'lifecycle',
    enteredReviewMode: 'lifecycle',
    exitedReviewMode: 'lifecycle',
  }

  it('opaque kinds are surfaced as CLASSIFIED unknown{raw} — never dropped, never `unrecognized` (049)', () => {
    // Every opaque kind is recognized chatter: it carries a neutral category so the UI can quiet
    // it, and `raw` is preserved intact so a later chat UI can render reasoning/plans richly.
    expect(Object.keys(OPAQUE_CATEGORIES).sort()).toEqual([...OPAQUE_TYPES].sort())
    for (const type of OPAQUE_TYPES) {
      const item = { type, id: 'o1' }
      const category = OPAQUE_CATEGORIES[type]
      expect(category, `${type} must be classified`).not.toBe('unrecognized')
      for (const phase of ['item/started', 'item/completed'] as const) {
        expect(normalizeNotification(phase, { item }), `${type} ${phase}`).toEqual([
          { type: 'unknown', provider: 'codex', category, label: type, raw: item },
        ])
      }
    }
  })

  it('a reasoning item is THINKING now, not chatter (027)', () => {
    // Promoted out of `unknown{category:'reasoning'}`. The item itself carries no usable text —
    // captured live, `summary`/`content` are empty on the item even with the summary stream on —
    // so what it contributes is that reasoning is happening, and `redacted` says the words were
    // withheld rather than absent. The words, when the turn asked for them, arrive as deltas.
    const item = { type: 'reasoning', id: 'rs_1', summary: [], content: [] }
    expect(normalizeNotification('item/started', { item })).toEqual([
      { type: 'thinking', phase: 'delta', redacted: true },
      { type: 'activity', phase: 'thinking' },
    ])
    expect(normalizeNotification('item/completed', { item })).toEqual([
      { type: 'thinking', phase: 'complete' },
    ])
  })

  it('a plan item is the plan DOCUMENT now, not chatter (057)', () => {
    // Promoted out of `unknown{category:'plan'}` on the same grounds reasoning was: it turned out to
    // carry the thing itself. Measured, one plan-mode turn against the pinned 0.146.0 app-server —
    // 235 `item/plan/delta` frames and then a completed item whose `text` is the whole markdown
    // proposal. It lands in `plan_update.body`, which is where Claude's `ExitPlanMode.input.plan`
    // already goes (030/056), so the UI renders a plan without being told whose it is.
    const text = '# Add verbose CLI output\n\n## Summary\n\nAdd a `--verbose` option.\n'
    expect(
      normalizeNotification('item/completed', { item: { type: 'plan', id: 'p1', text } }),
    ).toMatchObject([{ type: 'plan_update', steps: [], body: text.trim() }])
  })

  it('a plan item at STARTED says nothing — its text is empty on the wire (057)', () => {
    // Measured: the item is opened before a single delta lands, so `started` carries `text: ''`. An
    // empty document would announce a plan that does not exist yet, and a `plan_update` with neither
    // steps nor body is the "empty checklist out of nowhere" the transcript fold already refuses.
    expect(
      normalizeNotification('item/started', { item: { type: 'plan', id: 'p1', text: '' } }),
    ).toEqual([])
    // …and a COMPLETED one with nothing in it is malformed, so it stays loud rather than silent.
    expect(
      normalizeNotification('item/completed', { item: { type: 'plan', id: 'p1', text: '   ' } }),
    ).toEqual([
      {
        type: 'unknown',
        provider: 'codex',
        category: 'unrecognized',
        label: 'plan',
        raw: { type: 'plan', id: 'p1', text: '   ' },
      },
    ])
  })

  it('the checklist and the document are DIFFERENT plans, and both are `plan_update` (057)', () => {
    // `turn/plan/updated` is the working checklist (028); the plan item is the proposal. They are
    // disjoint on this provider rather than two views of one thing — the server's own plan-mode
    // instructions forbid the checklist tool while planning ("if you try to use `update_plan` in
    // Plan mode, it will return an error"), and `turn/plan/updated` fired zero times across the
    // measured plan turn AND its default-mode control. That is what makes it safe for the document
    // event to carry `steps: []` under the neutral replace-don't-append contract.
    const checklist = normalizeNotification('turn/plan/updated', {
      threadId: 'th_1',
      turnId: 'tn_1',
      explanation: null,
      plan: [{ step: 'read the file', status: 'inProgress' }],
    })
    expect(checklist).toMatchObject([
      { type: 'plan_update', steps: [{ text: 'read the file', status: 'active' }] },
    ])
    const document = normalizeNotification('item/completed', {
      item: { type: 'plan', id: 'p1', text: '# Plan' },
    })
    expect(document).toMatchObject([{ type: 'plan_update', steps: [], body: '# Plan' }])
  })

  it('the reasoning SUMMARY stream carries the words (027)', () => {
    // Only exists because the turn asks for it (`TurnStartParams.summary`); without that these
    // never fire and the reasoning items are empty.
    expect(
      normalizeNotification('item/reasoning/summaryTextDelta', {
        threadId: 'th_1',
        turnId: 'tn_1',
        itemId: 'rs_1',
        delta: '**Planning seven-step L/R sequence**',
      }),
    ).toEqual([{ type: 'thinking', phase: 'delta', text: '**Planning seven-step L/R sequence**' }])

    // A new summary part is a paragraph boundary: no words of its own, but not nothing.
    expect(
      normalizeNotification('item/reasoning/summaryPartAdded', {
        threadId: 'th_1',
        turnId: 'tn_1',
        itemId: 'rs_1',
        summaryIndex: 1,
      }),
    ).toEqual([{ type: 'thinking', phase: 'delta' }])

    // A well-formed EMPTY delta is a no-op; a malformed one is surfaced rather than dropped.
    expect(normalizeNotification('item/reasoning/summaryTextDelta', { delta: '' })).toEqual([])
    expect(normalizeNotification('item/reasoning/summaryTextDelta', { delta: 42 })[0]?.type).toBe(
      'unknown',
    )
  })

  it('a NOVEL item type is `unrecognized` (stays loud), raw preserved (049)', () => {
    const item = { type: 'somethingCodexAddedLater', id: 'x1', payload: { a: 1 } }
    expect(normalizeNotification('item/started', { item })).toEqual([
      { type: 'unknown', provider: 'codex', category: 'unrecognized', label: item.type, raw: item },
    ])
  })

  it('recognized-but-unmapped notification METHODS are classified; novel methods stay loud (049)', () => {
    // These streams — reasoning deltas especially — were the bulk of the `unknown` flood.
    // `summaryTextDelta`/`summaryPartAdded` left this list in 027 — they are `thinking` now.
    // `textDelta` stays: it was NEVER observed firing, so nothing was promoted on the strength of
    // it, and if it ever does arrive it should be loud-ish chatter rather than silently mapped.
    const byMethod: Record<string, string> = {
      'item/reasoning/textDelta': 'reasoning',
      'item/plan/delta': 'plan',
      'item/commandExecution/outputDelta': 'activity',
      'item/mcpToolCall/progress': 'activity',
      'rawResponseItem/completed': 'echo',
    }
    const params = { threadId: 'th_1', turnId: 'tn_1' }
    for (const [method, category] of Object.entries(byMethod)) {
      expect(normalizeNotification(method, params), method).toEqual([
        { type: 'unknown', provider: 'codex', category, label: method, raw: { method, params } },
      ])
    }
    // A method we have never seen stays the LOUD bucket.
    expect(normalizeNotification('some/future/method', params)).toEqual([
      {
        type: 'unknown',
        provider: 'codex',
        category: 'unrecognized',
        label: 'some/future/method',
        raw: { method: 'some/future/method', params },
      },
    ])
  })

  it('malformed known items degrade to unknown{raw}, not dropped', () => {
    // a tool kind missing its id
    expect(
      normalizeNotification('item/started', {
        item: { type: 'commandExecution', command: 'ls' },
      })[0]?.type,
    ).toBe('unknown')
    // a completed agentMessage with no text
    expect(
      normalizeNotification('item/completed', { item: { type: 'agentMessage', id: 'm' } })[0]?.type,
    ).toBe('unknown')
    // a non-record item, and an item with no `type`
    expect(normalizeNotification('item/started', { item: 42 })[0]?.type).toBe('unknown')
    expect(normalizeNotification('item/completed', { item: { id: 'x' } })[0]?.type).toBe('unknown')
  })

  it('error notification surfaces params.error.message, not the generic string', () => {
    expect(
      normalizeNotification('error', {
        error: { message: 'boom' },
        willRetry: false,
        threadId: 't',
        turnId: 'u',
      }),
    ).toEqual([{ type: 'error', message: 'boom', fatal: false }])
  })

  it('a rejected credential carries `cause: auth` — and the sentence stays verbatim (098)', () => {
    // Use the wire frame measured for an expired profile credential.
    expect(
      normalizeNotification('error', {
        error: {
          message:
            'Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.',
          codexErrorInfo: 'unauthorized',
          additionalDetails: null,
        },
        willRetry: false,
        threadId: 't',
        turnId: 'u',
      }),
    ).toEqual([
      {
        type: 'error',
        // ⚠️ Unchanged and complete. 085's rule: the adapter's diagnostic is the only copy of what
        // happened and it belongs in the log and the ledger. The `cause` is an ADDITION.
        message:
          'Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.',
        fatal: false,
        cause: 'auth',
      },
    ])
  })

  it('and an ordinary failure does NOT — the cause is read from the code, never the prose (098)', () => {
    // The pairing. Same shape, same kind of sentence, a different `codexErrorInfo` — so this pins
    // that the discriminant is the typed field and not something matched out of the English.
    expect(
      normalizeNotification('error', {
        error: {
          message: 'Your request could not be completed. Please log out and sign in again.',
          codexErrorInfo: 'serverOverloaded',
          additionalDetails: null,
        },
        willRetry: false,
        threadId: 't',
        turnId: 'u',
      }),
    ).toEqual([
      {
        type: 'error',
        message: 'Your request could not be completed. Please log out and sign in again.',
        fatal: false,
      },
    ])
  })
})

describe('tool-result status is affirmative-only and exhaustive (060 P2)', () => {
  /** Every tool kind that CARRIES a status, with the statuses its generated union allows. */
  const STATUS_BEARING = [
    { type: 'commandExecution', declines: true },
    { type: 'fileChange', declines: true },
    { type: 'mcpToolCall', declines: false },
    { type: 'dynamicToolCall', declines: false },
    { type: 'collabAgentToolCall', declines: false },
  ] as const

  const completed = (item: Record<string, unknown>) =>
    normalizeNotification('item/completed', { item })[0] as Extract<
      RuntimeEvent,
      { type: 'tool_result' }
    >

  it("REVIEWER'S PROBE: inProgress on item/completed is NOT a success, for every tool kind", () => {
    // Pre-fix `itemOk` returned true for everything except failed/declined, so a contradictory
    // `item/completed` carrying `inProgress` rendered as a successful tool result.
    for (const { type } of STATUS_BEARING) {
      const result = completed({ type, id: 'x1', status: 'inProgress' })
      expect(result, `${type} inProgress`).toMatchObject({ type: 'tool_result', ok: false })
      expect(result.summary, `${type} reason`).toMatch(/inProgress/)
    }
  })

  it("REVIEWER'S PROBE: a MISSING status is NOT a success — the result still resolves the card", () => {
    for (const { type } of STATUS_BEARING) {
      const result = completed({ type, id: 'x1' })
      // Fail closed, but still a tool_result: an unresolved card would hang in the transcript.
      expect(result, `${type} missing`).toMatchObject({ type: 'tool_result', id: 'x1', ok: false })
      expect(result.summary, `${type} reason`).toMatch(/no status/)
    }
  })

  it("REVIEWER'S PROBE: a runtime-NOVEL status is NOT a success", () => {
    for (const { type } of STATUS_BEARING) {
      const result = completed({ type, id: 'x1', status: 'someFutureStatus' })
      expect(result, `${type} novel`).toMatchObject({ type: 'tool_result', ok: false })
      expect(result.summary, `${type} reason`).toMatch(/unrecognized status/)
    }
  })

  it('a non-string status (wrong type) is NOT a success', () => {
    for (const status of [42, null, true, { state: 'completed' }, ['completed']]) {
      expect(completed({ type: 'commandExecution', id: 'x1', status })).toMatchObject({
        type: 'tool_result',
        ok: false,
      })
    }
  })

  it('failed and declined stay ok:false and say which', () => {
    expect(completed({ type: 'commandExecution', id: 'x1', status: 'failed' })).toMatchObject({
      ok: false,
    })
    expect(completed({ type: 'commandExecution', id: 'x1', status: 'failed' }).summary).toMatch(
      /failed/,
    )
    // `declined` is only in the command/patch unions — the kinds that can be refused.
    for (const { type, declines } of STATUS_BEARING) {
      if (!declines) continue
      expect(completed({ type, id: 'x1', status: 'declined' }).summary).toMatch(/declined/)
    }
  })

  it('an affirmative `completed` is ok:true and its summary is left clean', () => {
    expect(
      completed({ type: 'commandExecution', id: 'i1', command: 'ls -la', status: 'completed' }),
    ).toMatchObject({ type: 'tool_result', id: 'i1', summary: 'ls -la', ok: true })
  })

  it('webSearch has NO status in the protocol, so its completion is an affirmative success', () => {
    // Failing it closed would be as untrue as the old blanket success — the shape carries no
    // success/failure channel. A compile-time guard in the source fails the build if that changes.
    expect(completed({ type: 'webSearch', id: 'w1', query: 'cats' })).toEqual({
      type: 'tool_result',
      id: 'w1',
      summary: 'cats',
      ok: true,
    })
  })

  it('a completed item that CONTRADICTS its own success is refused (dynamic success:false, mcp error)', () => {
    // Affirmative-only means the item must not contradict itself, not merely that status says
    // `completed`. Both fields are declared on the generated shapes.
    const dynamic = completed({
      type: 'dynamicToolCall',
      id: 'd1',
      status: 'completed',
      success: false,
    })
    expect(dynamic).toMatchObject({ ok: false })
    expect(dynamic.summary).toMatch(/success:false/)

    const mcp = completed({
      type: 'mcpToolCall',
      id: 'm1',
      status: 'completed',
      error: { message: 'server exploded' },
    })
    expect(mcp).toMatchObject({ ok: false })
    expect(mcp.summary).toMatch(/error/)

    // …but `success: true` / `error: null` are untouched successes.
    expect(
      completed({ type: 'dynamicToolCall', id: 'd2', status: 'completed', success: true }),
    ).toMatchObject({ ok: true })
    expect(
      completed({ type: 'mcpToolCall', id: 'm2', status: 'completed', error: null }),
    ).toMatchObject({ ok: true })
  })
})

describe('malformed input fails loud or closed (066 F3 + F4)', () => {
  const completed = (item: Record<string, unknown>) =>
    normalizeNotification('item/completed', { item })[0] as Extract<
      RuntimeEvent,
      { type: 'tool_result' }
    >

  it('F3: a method named after an Object.prototype member is `unrecognized` AND schema-valid', () => {
    // Pre-fix the category lookup read INHERITED members, so `toString` yielded the prototype
    // function as the category — an event `runtimeEventSchema` rejects. A malformed provider
    // method could therefore produce a schema-invalid event.
    for (const method of ['toString', 'constructor', 'hasOwnProperty', 'valueOf', '__proto__']) {
      const [event] = normalizeNotification(method, { threadId: 'th_1' })
      expect(event, method).toMatchObject({ type: 'unknown', category: 'unrecognized' })
      expect(runtimeEventSchema.safeParse(event).success, `${method} must be schema-valid`).toBe(
        true,
      )
    }
  })

  it('F3: a tool item type named after a prototype member cannot inherit a function as its NAME', () => {
    const [event] = normalizeNotification('item/started', {
      item: { type: 'toString', id: 'x1' },
    })
    expect(runtimeEventSchema.safeParse(event).success).toBe(true)
    expect(event).toMatchObject({ type: 'unknown', category: 'unrecognized' })
  })

  it('F4: ANY non-affirmative `success` on a completed dynamicToolCall is not a success', () => {
    // Pre-fix only the literal `false` was caught, so the string 'false' rendered ok:true.
    for (const success of ['false', 'true', 0, 1, '', {}, [], false]) {
      expect(
        completed({ type: 'dynamicToolCall', id: 'd1', status: 'completed', success }),
        JSON.stringify(success),
      ).toMatchObject({ ok: false })
    }
    // Affirmative, and "not reported" (null/absent — the generated shape is `boolean | null`),
    // both stay successes: failing those closed would invent failures the provider never reported.
    expect(
      completed({ type: 'dynamicToolCall', id: 'd2', status: 'completed', success: true }),
    ).toMatchObject({ ok: true })
    expect(
      completed({ type: 'dynamicToolCall', id: 'd3', status: 'completed', success: null }),
    ).toMatchObject({ ok: true })
    expect(completed({ type: 'dynamicToolCall', id: 'd4', status: 'completed' })).toMatchObject({
      ok: true,
    })
  })

  it('F4: ANY present, non-empty `error` on a completed mcpToolCall is not a success', () => {
    // Pre-fix only a RECORD counted, so the bare string 'boom' rendered ok:true.
    for (const error of ['boom', { message: 'boom' }, {}, 42, []]) {
      expect(
        completed({ type: 'mcpToolCall', id: 'm1', status: 'completed', error }),
        JSON.stringify(error),
      ).toMatchObject({ ok: false })
    }
    for (const error of [null, undefined, '']) {
      expect(
        completed({ type: 'mcpToolCall', id: 'm2', status: 'completed', error }),
        JSON.stringify(error),
      ).toMatchObject({ ok: true })
    }
  })
})
