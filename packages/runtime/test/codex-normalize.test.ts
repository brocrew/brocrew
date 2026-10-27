import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runtimeEventSchema, type RuntimeEvent } from '../src/index'
import { RateLimitWatch, codexTurnOutcome, normalizeNotification } from '../src/codex/normalize'
import {
  completedTurn,
  threadStartedNotification,
  turn,
  turnCompletedNotification,
  turnStartedNotification,
} from './fixtures/codex-protocol'

/**
 * ⛔ **182 M5 · the provider ships a boolean called `showBufferingUi`, and BroBot was hiding it.**
 *
 * `ModelSafetyBufferingUpdatedNotification` is `{ threadId, turnId, model, useCases, reasons,
 * showBufferingUi, fasterModel }` — every field of it landed in the chatter list, so a turn could
 * pause mid-stream with nothing on screen. 177 left it there because no payload had been captured;
 * ⚑ **an absent capture is not an absent field**, and the generated type is a measurement of its own.
 */
describe('safety buffering is a state, not housekeeping (188 §2, from 182 M5)', () => {
  const buffering = (params: Record<string, unknown>): RuntimeEvent | undefined =>
    normalizeNotification('model/safetyBuffering/updated', params)[0]

  const BASE = {
    threadId: 'th_1',
    turnId: 'tn_1',
    model: 'gpt-5.1-codex',
    useCases: ['coding'],
    reasons: ['safety_review'],
    fasterModel: null,
  }

  it('⛔ says so when the provider says to show it', () => {
    const event = buffering({ ...BASE, showBufferingUi: true })
    expect(event?.type).toBe('error')
    if (event?.type !== 'error') throw new Error('unreachable')
    expect(event.fatal, 'a pause is not a death').toBe(false)
    expect(event.message).toContain('holding this turn for a safety check')
    // The provider's own reason strings, quoted rather than translated into something friendlier.
    expect(event.message).toContain('safety_review')
  })

  it('⚑ …and stays quiet when the provider says NOT to — the paired negative', () => {
    // The gate is the provider's flag, not a threshold of ours. `false` is lossless chatter, so
    // nothing routine reaches the transcript and the payload is still in raw history.
    const event = buffering({ ...BASE, showBufferingUi: false })
    expect(event?.type).toBe('unknown')
    if (event?.type !== 'unknown') throw new Error('unreachable')
    expect(event.category).toBe('lifecycle')
    expect(JSON.stringify(event.raw), 'nothing is dropped').toContain('safety_review')
  })

  it('⚠️ a missing flag is not a true one', () => {
    // Fail-quiet in the direction that matters: the type declares the boolean non-nullable, so a
    // payload without it is a shape we do not recognise and must not narrate.
    expect(buffering({ ...BASE })?.type).toBe('unknown')
    expect(buffering({ ...BASE, showBufferingUi: 'yes' })?.type).toBe('unknown')
  })

  it('names the faster model the provider offers, and invents none when it does not', () => {
    const offered = buffering({ ...BASE, showBufferingUi: true, fasterModel: 'gpt-5.1-mini' })
    expect(offered?.type === 'error' && offered.message).toContain('gpt-5.1-mini')
    const bare = buffering({ ...BASE, showBufferingUi: true })
    expect(bare?.type === 'error' && bare.message).not.toContain('faster alternative')
  })

  it('bounds an unbounded array — one notification is not an unbounded line', () => {
    const many = buffering({
      ...BASE,
      showBufferingUi: true,
      reasons: ['one', 'two', 'three', 'four', 'five'],
    })
    expect(many?.type === 'error' && many.message).toContain('one, two, three')
    expect(
      many?.type === 'error' && many.message,
      'the fourth is dropped, not wrapped',
    ).not.toContain('four')
  })

  it('every event it emits is schema-valid', () => {
    for (const params of [
      { ...BASE, showBufferingUi: true },
      { ...BASE, showBufferingUi: false },
      { ...BASE, showBufferingUi: true, reasons: [], fasterModel: 'x' },
    ]) {
      for (const event of normalizeNotification('model/safetyBuffering/updated', params)) {
        expect(runtimeEventSchema.safeParse(event).success).toBe(true)
      }
    }
  })
})

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
      ).toEqual({
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
      ).toEqual({
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
      expect(planned([])).toEqual({ type: 'plan_update', steps: [] })
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
    ).toEqual([{ type: 'tool_call', id: 'i1', name: 'shell', summary: 'ls -la' }])

    expect(
      normalizeNotification('item/completed', {
        item: { type: 'commandExecution', id: 'i1', status: 'completed' },
      }),
    ).toEqual([{ type: 'tool_result', id: 'i1', summary: 'shell command', ok: true }])

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
    ).toEqual([{ type: 'plan_update', steps: [], body: text.trim() }])
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
    expect(checklist).toEqual([
      { type: 'plan_update', steps: [{ text: 'read the file', status: 'active' }] },
    ])
    const document = normalizeNotification('item/completed', {
      item: { type: 'plan', id: 'p1', text: '# Plan' },
    })
    expect(document).toEqual([{ type: 'plan_update', steps: [], body: '# Plan' }])
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
    ).toEqual({ type: 'tool_result', id: 'i1', summary: 'ls -la', ok: true })
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

describe('a throttle the user is FEELING becomes visible; the heartbeat stays quiet (177 §1)', () => {
  /**
   * ⛔ **The routine frame, captured live from this machine** (`pnpm run probe:throttle`, 16 Aug):
   * a `pro` plan, 74% of a 7-day window used, no credits, no wall reported. Every fixture below is
   * this object with ONE field changed, so what is being tested is the gate rather than a shape.
   */
  const ROUTINE = {
    limitId: 'codex',
    limitName: null,
    primary: { usedPercent: 74, windowDurationMins: 10080, resetsAt: 1787224622 },
    secondary: null,
    credits: { hasCredits: false, unlimited: false, balance: '0' },
    individualLimit: null,
    spendControlReached: null,
    planType: 'pro',
    rateLimitReachedType: null,
  }

  const seen = (rateLimits: unknown): RuntimeEvent | undefined =>
    normalizeNotification('account/rateLimits/updated', { rateLimits })[0]

  const said = (rateLimits: unknown): string => {
    const event = seen(rateLimits)
    return event?.type === 'error' ? event.message : ''
  }

  it('the frame that actually arrives is QUIET — and is still recorded, losslessly', () => {
    const event = seen(ROUTINE)
    // ⚠️ The pair 074 established for Claude: routine is noise. Both halves asserted, because
    // "not an error" would pass over an event that had stopped being emitted at all.
    expect(event?.type).toBe('unknown')
    expect(event?.type === 'unknown' ? event.category : null).toBe('lifecycle')
    expect(event?.type === 'unknown' ? event.label : null).toBe('account/rateLimits/updated')
    // Lossless: the whole snapshot is still carried, so the debug view and the ledger keep it.
    expect(event?.type === 'unknown' ? event.raw : null).toEqual({
      method: 'account/rateLimits/updated',
      params: { rateLimits: ROUTINE },
    })
  })

  it('the WALL is visible, named by the provider, with no threshold of ours involved', () => {
    const line = said({ ...ROUTINE, rateLimitReachedType: 'rate_limit_reached' })
    expect(line).toContain('codex is rate-limited (rate_limit_reached)')
    // ⚠️ The exact instant, not a prefix: `resetsAt` is epoch SECONDS and `Date` takes ms, so a
    // missing ×1000 would still render a plausible-looking timestamp — in 1970.
    expect(line).toContain('resets 2026-08-20T11:17:02.000Z')
    // Non-fatal, always: a throttle pauses a turn, it does not end a session (065's rule).
    expect(seen({ ...ROUTINE, rateLimitReachedType: 'rate_limit_reached' })).toEqual({
      type: 'error',
      message: line,
      fatal: false,
    })
    // ⚠️ It fires at 0% used, too — the wall is the provider's report, not our arithmetic. Without
    // this, a gate that only ever read `usedPercent` would pass every line above.
    expect(
      said({
        ...ROUTINE,
        primary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: null },
        rateLimitReachedType: 'workspace_owner_credits_depleted',
      }),
    ).toContain('workspace_owner_credits_depleted')
    // The other wall the snapshot can report, and it is a different sentence because it is a
    // different fact — spend control is the workspace's own limit, not the plan's.
    expect(said({ ...ROUTINE, spendControlReached: true })).toContain(
      'codex has reached its spend control',
    )
  })

  it('the APPROACH is visible at the floor and quiet one point below it', () => {
    const window = (usedPercent: number): unknown => ({
      ...ROUTINE,
      primary: { usedPercent, windowDurationMins: 10080, resetsAt: 1787224622 },
    })
    // ⛔ The boundary, both sides. A floor asserted only from above is a floor that could drift
    // anywhere below the sample and never be noticed.
    expect(said(window(89))).toBe('')
    expect(seen(window(89))?.type).toBe('unknown')
    expect(said(window(90))).toContain(
      'codex is approaching its rate limit — 90% of a 7-day window',
    )
    expect(said(window(99))).toContain('99% of a 7-day window')
    // The SECOND window counts too, and the fuller of the two carries the sentence.
    expect(
      said({
        ...ROUTINE,
        primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: null },
        secondary: { usedPercent: 95, windowDurationMins: 10080, resetsAt: null },
      }),
    ).toContain('95% of a 7-day window')
    // 5 hours reads as hours, and a duration the provider did not report is described as absent
    // rather than given an invented length.
    expect(said({ ...ROUTINE, primary: { usedPercent: 96, windowDurationMins: 300 } })).toContain(
      '96% of a 5-hour window',
    )
    expect(said({ ...ROUTINE, primary: { usedPercent: 96, windowDurationMins: null } })).toContain(
      '96% of this window',
    )
  })

  it('is not fooled by a sparse update, and never invents a state from an absence', () => {
    // The notification documents itself as a rolling SPARSE update whose nulls do not clear an
    // earlier value. This function is pure and has no earlier value, so a null must read as "not
    // reported here" — quiet — rather than as either "fine" or "throttled".
    expect(seen({})?.type).toBe('unknown')
    expect(seen(undefined)?.type).toBe('unknown')
    expect(seen({ primary: null, secondary: null })?.type).toBe('unknown')
    // ⛔ **`credits` is not a gate**, and this is the assertion that keeps it from becoming one.
    // The live frame carries `hasCredits:false, balance:"0"` on a working session, so a gate that
    // read it would fire on every routine heartbeat — 074's noise, reintroduced.
    expect(
      seen({ ...ROUTINE, credits: { hasCredits: false, unlimited: false, balance: '0' } })?.type,
    ).toBe('unknown')
    // A `usedPercent` that is not a number is not a 0 and not a 100 — it is nothing.
    expect(seen({ ...ROUTINE, primary: { usedPercent: 'lots' } })?.type).toBe('unknown')
  })

  /**
   * ⛔ **182 M4 · the provider's SPARSE-update contract, which the pure function cannot keep.**
   *
   * `AccountRateLimitsUpdatedNotification`: *"Clients should merge available values into the most
   * recent `account/rateLimits/read` response… Nullable account metadata may be unavailable in a
   * rolling update and does not clear a previously observed value."* `RateLimitSnapshot`
   * .spendControlReached says it again: *"`None` is unavailable, not a sparse-update recovery."*
   */
  describe('the merge, the reset, and saying each thing once (188 §2, from 182 M4)', () => {
    /**
     * ⚠️ **Every fixture here carries a FUTURE reset**, and that is load-bearing rather than tidy.
     * The watch drops what it holds once the provider's own reset time has passed, so a snapshot
     * built on `ROUTINE`'s reset — which is a real captured epoch, now in the past — would expire
     * between frames and the merge under test would never happen.
     */
    const LATER = 4_000_000_000
    const WALL = {
      ...ROUTINE,
      primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: LATER },
      rateLimitReachedType: 'rate_limit_reached',
    }
    const watched = (watch: RateLimitWatch, rateLimits: unknown): string => {
      const event = normalizeNotification('account/rateLimits/updated', { rateLimits }, watch)[0]
      return event?.type === 'error' ? event.message : ''
    }

    it('⛔ keeps a wall a sparse frame did not re-send, instead of downgrading it', () => {
      const watch = new RateLimitWatch()
      expect(watched(watch, WALL)).toContain('codex is rate-limited')
      // The exact sequence 182 describes: a sparse frame with a fuller primary window and NO
      // `rateLimitReachedType`. Judged alone it reads as "approaching" — a WEAKER sentence while
      // nothing has improved. Merged, the wall is still the state, so it can only say the wall.
      const sparse = watched(watch, {
        primary: { usedPercent: 92, windowDurationMins: 300, resetsAt: LATER },
      })
      expect(sparse, 'the wall was not withdrawn, so nothing weaker may be said').not.toContain(
        'approaching',
      )
      // ⚠️ It is allowed to speak again here, and does: the merged window moved its own reset, so
      // the sentence is a different fact rather than a repetition. What it may not do is weaken.
      expect(sparse === '' || sparse.includes('rate-limited')).toBe(true)
      // …and an IDENTICAL sparse frame after that is silent, because nothing changed at all.
      expect(
        watched(watch, { primary: { usedPercent: 92, windowDurationMins: 300, resetsAt: LATER } }),
      ).toBe('')
      // ⚑ The paired positive: without the watch, this is exactly the downgrade that used to ship.
      expect(
        said({ primary: { usedPercent: 92, windowDurationMins: 300, resetsAt: LATER } }),
      ).toContain('approaching its rate limit')
    })

    it('⚑ …and a fresh watch still says the first thing it sees', () => {
      // The anti-vacuity half of the test above: silence must come from the dedup, not from the
      // watch being mute.
      const watch = new RateLimitWatch()
      expect(watched(watch, { primary: { usedPercent: 92, windowDurationMins: 300 } })).toContain(
        'approaching its rate limit',
      )
    })

    it('⛔ says an unchanged warning ONCE, however many frames repeat it', () => {
      // 177 measured this notification at once or twice per TURN. Above 90% every frame used to
      // append a fresh transcript warning; a hundred-turn conversation accumulated a hundred.
      const watch = new RateLimitWatch()
      const frame = {
        ...ROUTINE,
        primary: { usedPercent: 95, windowDurationMins: 300, resetsAt: LATER },
      }
      expect(watched(watch, frame)).toContain('95%')
      expect(watched(watch, frame)).toBe('')
      expect(watched(watch, frame)).toBe('')
      // …and a CHANGE still speaks. Dedup is about the sentence, not about the method.
      expect(
        watched(watch, {
          ...frame,
          primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: LATER },
        }),
      ).toContain('99%')
    })

    it('⛔ quotes the reset of the window the sentence is ABOUT', () => {
      // The bug in plain numbers: a 95% five-hour window resetting at t=1000 beside a 10% weekly
      // window resetting at t=9_000_000. `Math.max` reported the weekly reset next to the 5-hour
      // percentage — two windows, one sentence, and the time a person would act on belonged to
      // neither.
      const line = said({
        ...ROUTINE,
        primary: { usedPercent: 95, windowDurationMins: 300, resetsAt: 1000 },
        secondary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: 9_000_000 },
      })
      expect(line).toContain('95% of a 5-hour window')
      expect(line, 'the reset of the window it just named').toContain(
        new Date(1000 * 1000).toISOString(),
      )
      expect(line, 'and not the other window’s').not.toContain(
        new Date(9_000_000 * 1000).toISOString(),
      )
    })

    it('⚠️ drops what it holds once the provider’s own reset time has passed', () => {
      // The expiry is the provider's number, never a timer of ours — and a wall with no reset at
      // all STANDS, because inferring "fine" from an absence is the thing this class refuses to do.
      // ⚠️ **This comment used to say "nothing else can end a wall: this app does not call
      // `account/rateLimits/read`"** — true when 188 wrote it, false since 201 §2, and left here in
      // its corrected form rather than deleted because it is the sentence that explains the expiry.
      const watch = new RateLimitWatch()
      const resetsAt = LATER
      expect(
        watched(watch, {
          ...WALL,
          primary: { usedPercent: 100, windowDurationMins: 300, resetsAt },
        }),
      ).toContain('rate-limited')
      // Still inside the window: merged, deduped, silent.
      expect(
        watched(watch, { primary: { usedPercent: 50, windowDurationMins: 300, resetsAt } }),
      ).toBe('')
      // Past it: the held wall is dropped, and a fresh wall is news again.
      const later = new RateLimitWatch()
      expect(
        watched(later, {
          ...WALL,
          primary: { usedPercent: 100, windowDurationMins: 300, resetsAt },
        }),
      ).toContain('rate-limited')
      const line = later.observe(
        { ...WALL, primary: { usedPercent: 100, windowDurationMins: 300, resetsAt } },
        resetsAt * 1000 + 1,
      )
      expect(line, 'the window reset, so the same wall is a new fact').toContain('rate-limited')
    })

    it('⚠️ one session’s state never reaches another', () => {
      const first = new RateLimitWatch()
      expect(watched(first, WALL)).toContain('rate-limited')
      // A second conversation must not be silenced by a warning it never showed.
      const second = new RateLimitWatch()
      expect(watched(second, WALL)).toContain('rate-limited')
    })
  })

  /**
   * ⛔ **192 H1's five sequences, one test each** (201). The PM re-read `RateLimitWatch` line by line
   * after the verifier crashed and confirmed all five; each `it` below is named for the one it pins.
   *
   * ⚠️ **Every fixture in here is the LIVE capture** — `pnpm run probe:ratelimit-baseline`, this
   * machine, 21 Aug — with its reset times moved into the future so the expiry does not fire between
   * frames. ⛔ **The two buckets are real**: `codex` and `codex_bengalfox` (*"GPT-5.3-Codex-Spark"*)
   * both came back from one `account/rateLimits/read`, which is why the multi-bucket half of this is
   * a defect rather than a hypothetical.
   */
  describe('the bucket the sentence is about (201, from 192 H1)', () => {
    const LATER = 4_000_000_000
    const OTHER_RESET = 4_100_000_000
    const iso = (seconds: number): string => new Date(seconds * 1000).toISOString()

    /** The `codex` bucket as the read really returns it, at the wall. */
    const AT_THE_WALL = {
      limitId: 'codex',
      limitName: null,
      primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: LATER },
      secondary: null,
      credits: { hasCredits: false, unlimited: false, balance: '0' },
      individualLimit: null,
      spendControlReached: false,
      planType: 'prolite',
      rateLimitReachedType: 'rate_limit_reached',
    }

    /** The SECOND metered bucket, verbatim from the capture but for its resets. */
    const SPARK = {
      limitId: 'codex_bengalfox',
      limitName: 'GPT-5.3-Codex-Spark',
      primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: OTHER_RESET },
      secondary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: OTHER_RESET },
      credits: null,
      individualLimit: null,
      spendControlReached: null,
      planType: 'prolite',
      rateLimitReachedType: null,
    }

    /** An `account/rateLimits/read` response in the shape the pinned binary really answers. */
    const baseline = (codex: Record<string, unknown>): unknown => ({
      rateLimits: codex,
      rateLimitsByLimitId: { codex, codex_bengalfox: SPARK },
      rateLimitResetCredits: { availableCount: 0, credits: [] },
    })

    /** The frame 192 H1 §1 describes: a fuller window, and the wall not re-sent. */
    const SPARSE_92 = { primary: { usedPercent: 92, windowDurationMins: 300, resetsAt: LATER } }

    const watched = (watch: RateLimitWatch, rateLimits: unknown, now?: number): string => {
      const line = now === undefined ? watch.observe(rateLimits) : watch.observe(rateLimits, now)
      return line ?? ''
    }

    it('⛔ 1 · no baseline · a user already at the wall is told so, before any frame downgrades it', () => {
      const watch = new RateLimitWatch()
      // §2's choice, from the user's side: the state that already exists is fetched and SPOKEN.
      expect(watch.seed(baseline(AT_THE_WALL))).toEqual([
        `codex is rate-limited (rate_limit_reached) — the turn may stall until it resets; resets ${iso(LATER)}`,
      ])
      // …and the sparse frame that used to be the first thing this session ever heard can no
      // longer be the weaker sentence, because there is now something for it to merge INTO.
      expect(watched(watch, SPARSE_92), 'the wall was never withdrawn').not.toContain('approaching')

      // ⚑ **The paired positive, and it is the defect itself.** The identical frame on a watch with
      // no baseline says exactly the thing 192 H1 §1 describes.
      expect(watched(new RateLimitWatch(), SPARSE_92)).toContain(
        'codex is approaching its rate limit — 92% of a 5-hour window',
      )
    })

    it('⛔ 2 · cross-bucket · a frame for another `limitId` cannot say a word about ours', () => {
      const watch = new RateLimitWatch()
      watch.seed(
        baseline({
          ...AT_THE_WALL,
          rateLimitReachedType: null,
          primary: { usedPercent: 37, windowDurationMins: 10080, resetsAt: LATER },
        }),
      )
      expect(watched(watch, AT_THE_WALL)).toContain('codex is rate-limited')

      // ⛔ The Frankenstein, in one assertion: under ONE flat record this frame overwrites the keys
      // it carries and inherits `rateLimitReachedType` from the bucket next door, so a 0%-used
      // limit reports OUR wall — and quotes ITS reset while doing it.
      const other = watched(watch, {
        limitId: 'codex_bengalfox',
        primary: { usedPercent: 92, windowDurationMins: 300, resetsAt: OTHER_RESET },
      })
      expect(other, 'the other bucket is not at a wall and must not claim one').not.toContain(
        'rate-limited',
      )
      expect(other).toContain('codex is approaching its rate limit')
      // ⚑ …and it NAMES itself, which is the other half of "a sentence that describes a real
      // bucket": two unqualified sentences about two limits are the same defect from the far end.
      expect(other).toContain('on the GPT-5.3-Codex-Spark limit')
      expect(other).toContain(iso(OTHER_RESET))

      // ⛔ And ours is untouched by all of it — still the wall, still OUR reset.
      const ours = watched(watch, {
        limitId: 'codex',
        primary: { usedPercent: 93, windowDurationMins: 300, resetsAt: LATER - 1 },
      })
      expect(ours).toContain('codex is rate-limited (rate_limit_reached)')
      expect(ours, 'the main bucket speaks in the sentence 177 shipped').not.toContain('on the')
      expect(ours, 'and never quotes the other bucket’s reset').not.toContain(iso(OTHER_RESET))
    })

    it('⛔ 3 · nested sparse loss · a null sub-field does not erase a known one', () => {
      const watch = new RateLimitWatch()
      expect(
        watched(watch, {
          limitId: 'codex',
          primary: { usedPercent: 95, windowDurationMins: 300, resetsAt: LATER },
        }),
      ).toBe(
        `codex is approaching its rate limit — 95% of a 5-hour window used; resets ${iso(LATER)}`,
      )

      // The frame that reports only that the percentage moved. Both other fields of
      // `RateLimitWindow` are nullable — *"unavailable in a rolling update"* — and a TOP-LEVEL
      // merge replaces the window whole, taking the length and the reset with it.
      const line = watched(watch, {
        limitId: 'codex',
        primary: { usedPercent: 97, windowDurationMins: null, resetsAt: null },
      })
      expect(line, 'the window’s length survived a frame that did not re-send it').toContain(
        '97% of a 5-hour window',
      )
      expect(line, 'and so did the reset a person would act on').toContain(iso(LATER))

      // ⚑ The paired positive: a sub-field the provider really CHANGES still replaces.
      expect(
        watched(watch, {
          limitId: 'codex',
          primary: { usedPercent: 98, resetsAt: LATER + 600 },
        }),
      ).toContain(iso(LATER + 600))
    })

    it('⛔ 4 · recovery then recurrence · a warning that went away and came back is news again', () => {
      const watch = new RateLimitWatch()
      const at = (usedPercent: number): unknown => ({
        limitId: 'codex',
        primary: { usedPercent, windowDurationMins: 300, resetsAt: LATER },
      })
      expect(watched(watch, at(95))).toContain('95% of a 5-hour window')
      // Quiet. Nothing to say — and, before 201, nothing to forget either.
      expect(watched(watch, at(50))).toBe('')
      // ⛔ The same wording, and it must speak: `said` did not survive the return to quiet.
      expect(watched(watch, at(95)), 'the warning came back, so it is news').toContain('95% of a')
      // ⚑ The paired positive 074's rule requires: an UNCHANGED warning is still said once.
      expect(watched(watch, at(95))).toBe('')
      expect(watched(watch, at(95))).toBe('')
    })

    it('⛔ 5 · unknown resets · a window that never said when it resets cannot expire the wall', () => {
      const PAST = 1_000_000
      const held = {
        limitId: 'codex',
        rateLimitReachedType: 'rate_limit_reached',
        primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: PAST },
        // ⚠️ The window the old `.filter((at) => at > 0)` threw away BEFORE asking whether the rest
        // had passed — so the whole snapshot expired on the strength of a window it ignored.
        secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: null },
      }
      const watch = new RateLimitWatch()
      expect(watched(watch, held, PAST * 1000 - 1)).toContain('rate-limited')
      // Past the primary's reset. The secondary never reported one, so nothing here says the limit
      // has ended — and a frame that moves the primary must still read as the WALL.
      const after = watched(
        watch,
        {
          limitId: 'codex',
          primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: PAST - 60 },
        },
        PAST * 1000 + 1,
      )
      expect(after, 'an unknown reset is unknown, not past').toContain('rate-limited')

      // ⚑ The paired positive: when every window it holds says its own reset has passed, it DOES
      // expire — 188's rule, which 201 narrows rather than removes.
      const rolls = new RateLimitWatch()
      const known = {
        ...held,
        secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: PAST },
      }
      expect(watched(rolls, known, PAST * 1000 - 1)).toContain('rate-limited')
      expect(
        watched(
          rolls,
          { limitId: 'codex', primary: { usedPercent: 12, windowDurationMins: 300 } },
          PAST * 1000 + 1,
        ),
        'the wall was dropped, and 12% has nothing to say',
      ).toBe('')
    })

    it('⚑ the baseline speaks for the bucket the PROVIDER calls the main one, and no other', () => {
      // A second metered limit at 99% is a fact about a model this conversation may never touch.
      // It is HELD — so a rolling frame naming it merges into something real — but a warning
      // nobody asked for on every session open is 074's noise.
      const watch = new RateLimitWatch()
      const busy = {
        ...SPARK,
        primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: OTHER_RESET },
      }
      expect(
        watch.seed({
          rateLimits: {
            ...AT_THE_WALL,
            rateLimitReachedType: null,
            primary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: LATER },
          },
          rateLimitsByLimitId: {
            codex: {
              ...AT_THE_WALL,
              rateLimitReachedType: null,
              primary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: LATER },
            },
            codex_bengalfox: busy,
          },
        }),
        'the main bucket is quiet, so the baseline is quiet',
      ).toEqual([])
      // ⛔ …and the moment the provider pushes a frame for that bucket — which it does because the
      // session is metering on it — the state it merges into is the one the baseline fetched.
      expect(watched(watch, { limitId: 'codex_bengalfox' })).toContain(
        'codex is approaching its rate limit on the GPT-5.3-Codex-Spark limit — 99% of a 5-hour window',
      )
    })

    describe('0.160.0 · `ordinaryUsageAllowed` decides the main limit when the provider sends it', () => {
      const PAST = 1_000_000_000
      const AT_HALF = {
        ...AT_THE_WALL,
        rateLimitReachedType: null,
        primary: { usedPercent: 50, windowDurationMins: 10080, resetsAt: LATER },
      }
      const read = (codex: Record<string, unknown>, allowed: boolean | null): unknown => ({
        ...(baseline(codex) as object),
        ordinaryUsageAllowed: allowed,
      })
      const NOT_ALLOWED =
        'codex is rate-limited (included usage not allowed) — turns may stall until codex says usage is allowed again'

      it('`false` is a wall even at 50%, said with NO reset time — and the person’s queue reads it as stopped', () => {
        const watch = new RateLimitWatch()
        expect(watch.seed(read(AT_HALF, false))).toEqual([NOT_ALLOWED])
        expect(watch.awaitingTheProvidersWord(), 'the runtime re-reads before a turn').toBe(true)
        // ⛔ No `; resets …`: the queue would end the wall by it, which is the forbidden inference.
        expect(NOT_ALLOWED).not.toContain('resets')
      })

      it('`false` is never dropped because a reset time passed, and its wall carries no reset either', () => {
        const passed = { ...AT_THE_WALL, primary: { ...AT_THE_WALL.primary, resetsAt: PAST } }
        // ⚑ The paired positive: with no field, a wall whose reset is past is dropped, as before.
        expect(new RateLimitWatch().seed(baseline(passed))).toEqual([])
        expect(new RateLimitWatch().seed(read(passed, false))).toEqual([
          'codex is rate-limited (rate_limit_reached) — turns may stall until codex says usage is allowed again',
        ])
      })

      it('`false` holds until a read says `true` — a read that says nothing does not undo it', () => {
        const watch = new RateLimitWatch()
        watch.seed(read(AT_HALF, false))
        watch.seed(read(AT_HALF, null))
        expect(watch.awaitingTheProvidersWord()).toBe(true)
        expect(watch.seed(read(AT_HALF, true))).toEqual([])
        expect(watch.awaitingTheProvidersWord()).toBe(false)
      })

      it('a re-read goes ON TOP: a fresher percentage replaces the one held', () => {
        const watch = new RateLimitWatch()
        expect(watch.seed(read(AT_THE_WALL, false))).toHaveLength(1)
        const reset = {
          ...AT_THE_WALL,
          rateLimitReachedType: null,
          primary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: OTHER_RESET },
        }
        // ⚑ Allowed, at 0%: nothing to say — not an approach read off the old 100%.
        expect(watch.seed(read(reset, true))).toEqual([])
      })

      it('`true` says no wall for the main limit, and an approach still speaks', () => {
        expect(new RateLimitWatch().seed(read(AT_THE_WALL, true))).toEqual([
          `codex is approaching its rate limit — 100% of a 7-day window used; resets ${iso(LATER)}`,
        ])
      })

      it('a rolling wall on the main limit is the newer word over `true` — before or after the answer', () => {
        const after = new RateLimitWatch()
        after.seed(read(AT_HALF, true), 1_000, 900)
        expect(watched(after, AT_THE_WALL, 2_000)).toContain('codex is rate-limited')
        // ⚑ …and one seen while the read was in flight beats its `true` too.
        const during = new RateLimitWatch()
        expect(watched(during, AT_THE_WALL, 1_000)).toContain('codex is rate-limited')
        expect(during.seed(read(AT_HALF, true), 2_000, 500)).toEqual([])
        expect(during.awaitingTheProvidersWord()).toBe(false)
        expect(watched(during, AT_THE_WALL, 3_000), 'still walled, nothing new to say').toBe('')
      })

      it('`null` keeps today’s reading exactly', () => {
        expect(new RateLimitWatch().seed(read(AT_THE_WALL, null))).toEqual([
          `codex is rate-limited (rate_limit_reached) — the turn may stall until it resets; resets ${iso(LATER)}`,
        ])
      })
    })

    it('⚑ a server that fills only the backward-compatible view still seeds one bucket', () => {
      const watch = new RateLimitWatch()
      expect(watch.seed({ rateLimits: AT_THE_WALL, rateLimitsByLimitId: null })).toEqual([
        `codex is rate-limited (rate_limit_reached) — the turn may stall until it resets; resets ${iso(LATER)}`,
      ])
      // A response with nothing in it seeds nothing and says nothing — and does not throw.
      expect(new RateLimitWatch().seed({})).toEqual([])
      expect(new RateLimitWatch().seed(null)).toEqual([])
    })

    it('⚑ what it holds is a COPY — the caller keeps its payload, the watch keeps its own', () => {
      // The same object the baseline was read from is carried in the raw history and handed
      // straight to the renderer. A watch that held its sub-objects by reference would be tied to
      // it for the life of the session — the aliasing that survives precisely because nothing
      // mutates it today.
      const response = baseline({
        ...AT_THE_WALL,
        rateLimitReachedType: null,
        primary: { usedPercent: 95, windowDurationMins: 300, resetsAt: LATER },
      })
      const watch = new RateLimitWatch()
      expect(watch.seed(response)).toEqual([
        `codex is approaching its rate limit — 95% of a 5-hour window used; resets ${iso(LATER)}`,
      ])
      const byId = (
        response as { rateLimitsByLimitId: Record<string, { primary: Record<string, unknown> }> }
      ).rateLimitsByLimitId
      byId['codex']!.primary['windowDurationMins'] = 10080
      // ⚑ Read through a frame that moves only the percentage, so what is measured is which window
      // the watch is holding rather than which sentence was deduped.
      expect(watched(watch, { limitId: 'codex', primary: { usedPercent: 96 } })).toContain(
        '96% of a 5-hour window',
      )
    })

    it('⛔ a baseline that arrives LATE goes underneath what was observed, never over it', () => {
      // The call is not awaited (see `readRateLimitBaseline`), so a rolling frame can and does
      // overtake the response. That frame is the NEWER fact; a baseline written over it would
      // resurrect the state the session has just left — 086 with the sign flipped.
      const watch = new RateLimitWatch()
      expect(
        watched(watch, {
          limitId: 'codex',
          primary: { usedPercent: 95, windowDurationMins: 300, resetsAt: LATER },
        }),
      ).toContain('95% of a 5-hour window')
      watch.seed(
        baseline({
          ...AT_THE_WALL,
          rateLimitReachedType: null,
          primary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: OTHER_RESET },
        }),
      )
      // ⚑ Read through a frame that moves only the percentage, so what is under test is which
      // window survived rather than which sentence was deduped.
      const line = watched(watch, { limitId: 'codex', primary: { usedPercent: 96 } })
      expect(line, 'the observed window, not the baseline’s').toContain('96% of a 5-hour window')
      expect(line).toContain(iso(LATER))
      expect(line).not.toContain(iso(OTHER_RESET))
    })

    it('⚠️ a frame that names no bucket goes to the default, not to a bucket of its own', () => {
      // The contract says nullable metadata may be unavailable in a rolling update, and `limitId`
      // is nullable. Filing such a frame separately would rebuild 192 H1 §1 inside the fix: a
      // sparse 92% in an empty bucket while a wall stands in the real one.
      const watch = new RateLimitWatch()
      watch.seed(baseline(AT_THE_WALL))
      expect(watched(watch, SPARSE_92), 'merged into the bucket the provider called main').toBe('')
      // With no baseline and exactly one bucket held, the only bucket it could be about is that one.
      const single = new RateLimitWatch()
      expect(watched(single, AT_THE_WALL)).toContain('rate-limited')
      expect(watched(single, SPARSE_92)).toBe('')
    })

    it('🔒 the bucket map is BOUNDED, and past the cap a frame is judged alone', () => {
      // 052's rule on 200's surface: the key is a string off the wire. Past the cap there is no
      // memory to merge into, so the frame is read exactly as the pre-188 pure function read it —
      // which never downgraded a wall it could SEE, only one it had been told about.
      const watch = new RateLimitWatch()
      const busy = (id: string): unknown => ({
        limitId: id,
        primary: { usedPercent: 95, windowDurationMins: 300, resetsAt: LATER },
      })
      for (let i = 1; i < 16; i++) watched(watch, busy(`invented_${i}`))
      // The sixteenth, and the last one this session will hold state for.
      expect(watched(watch, busy('invented_0'))).toContain(
        'on the invented_0 limit — 95% of a 5-hour window',
      )
      for (let i = 16; i < 40; i++) watched(watch, busy(`invented_${i}`))

      // A wall on an untracked bucket is still visible…
      const wall = watched(watch, {
        limitId: 'invented_99',
        rateLimitReachedType: 'rate_limit_reached',
      })
      expect(wall).toContain('codex is rate-limited')
      // …and said once, because the overflow path is deduped against ONE string rather than a map.
      // ⛔ Without the cap these are two buckets and the second speaks too.
      expect(
        watched(watch, { limitId: 'invented_98', rateLimitReachedType: 'rate_limit_reached' }),
      ).toBe('')
      // ⛔ …while a bucket INSIDE the cap still remembers its own line. Without this, a cap of zero
      // would satisfy every assertion above.
      expect(watched(watch, busy('invented_0')), 'a tracked bucket kept its memory').toBe('')
    })

    it('⛔ §3’s shape, unchanged — wall · spend control · 90% · quiet · raw', () => {
      // Assert each of the five states through the watch, preserving the gate while checking
      // the state behind it.
      const line = (rateLimits: unknown): string => watched(new RateLimitWatch(), rateLimits)
      expect(line({ ...ROUTINE, rateLimitReachedType: 'rate_limit_reached' })).toContain(
        'codex is rate-limited (rate_limit_reached) — the turn may stall until it resets',
      )
      expect(line({ ...ROUTINE, spendControlReached: true })).toContain(
        'codex has reached its spend control — the turn may stall until it resets',
      )
      const at = (usedPercent: number): unknown => ({
        ...ROUTINE,
        primary: { usedPercent, windowDurationMins: 10080, resetsAt: LATER },
      })
      expect(line(at(89)), 'the floor, from below').toBe('')
      expect(line(at(90))).toContain('codex is approaching its rate limit — 90% of a 7-day window')
      expect(line(ROUTINE), 'the frame that really arrives is quiet').toBe('')
      // …and `raw` is carried whichever way the gate went, which is the assertion the quiet half
      // needs: silence that lost the frame is not the same silence.
      const quiet = normalizeNotification(
        'account/rateLimits/updated',
        { rateLimits: ROUTINE },
        new RateLimitWatch(),
      )[0]
      expect(quiet?.type).toBe('unknown')
      expect(quiet?.type === 'unknown' ? quiet.raw : null).toEqual({
        method: 'account/rateLimits/updated',
        params: { rateLimits: ROUTINE },
      })
    })
  })

  it('every event it can emit is schema-valid', () => {
    for (const snapshot of [
      ROUTINE,
      { ...ROUTINE, rateLimitReachedType: 'rate_limit_reached' },
      { ...ROUTINE, primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: 1 } },
      {},
    ]) {
      expect(runtimeEventSchema.safeParse(seen(snapshot)).success).toBe(true)
    }
  })
})

describe('a model the provider swapped is not chatter (177 §2)', () => {
  const rerouted = (params: unknown): RuntimeEvent | undefined =>
    normalizeNotification('model/rerouted', params)[0]

  it('says which model answered, which one was asked for, and why', () => {
    expect(
      rerouted({
        threadId: 'th_1',
        turnId: 'tn_1',
        fromModel: 'gpt-5.6-sol',
        toModel: 'gpt-5.4',
        reason: 'highRiskCyberActivity',
      }),
    ).toEqual({
      type: 'error',
      message:
        'codex answered this turn with gpt-5.4 instead of gpt-5.6-sol (highRiskCyberActivity)',
      fatal: false,
    })
  })

  it('is visible for EVERY reroute — there is no routine one to gate against', () => {
    // `ModelRerouteReason` has a single member today. The point of this line is that a payload
    // with no reason at all is still surfaced, rather than falling back to chatter: "which model
    // answered" is the fact, and the reason is the annotation.
    const event = rerouted({ fromModel: 'a', toModel: 'b' })
    expect(event?.type).toBe('error')
    expect(event?.type === 'error' ? event.message : '').toBe(
      'codex answered this turn with b instead of a',
    )
    expect(event?.type === 'error' ? event.fatal : true).toBe(false)
  })

  it('degrades to what it has rather than describing a swap it cannot name', () => {
    expect(rerouted({ toModel: 'b' })?.type).toBe('error')
    const partial = rerouted({ toModel: 'b', reason: 'highRiskCyberActivity' })
    expect(partial?.type === 'error' ? partial.message : '').toBe(
      'codex moved this turn to b (highRiskCyberActivity)',
    )
    const empty = rerouted({})
    expect(empty?.type === 'error' ? empty.message : '').toBe(
      'codex moved this turn to another model',
    )
    expect(runtimeEventSchema.safeParse(empty).success).toBe(true)
  })

  it('`model/verification` is NOT promoted with it — a different claim, still chatter', () => {
    // The pair that keeps §2's ruling narrow. `ModelVerification` is `trustedAccessForCyber`: the
    // provider granting this turn access. It changes nothing the user chose, so it stays quiet —
    // and asserting that beside the promotion above is what stops "promote the model/* family"
    // from being read into this change later.
    const [event] = normalizeNotification('model/verification', {
      threadId: 'th_1',
      turnId: 'tn_1',
      verifications: ['trustedAccessForCyber'],
    })
    expect(event?.type).toBe('unknown')
    expect(event?.type === 'unknown' ? event.category : null).toBe('lifecycle')
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
    expect(normalizeNotification('item/started', { item: BIRTH })).toEqual([
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

  it('the new notifications are classified, never `unrecognized`', () => {
    const quiet = {
      'thread/reverted': 'lifecycle',
      'thread/attachment/updated': 'lifecycle',
      'thread/queue/changed': 'lifecycle',
      'project/changed': 'lifecycle',
      'thread/project/updated': 'lifecycle',
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

describe('Codex 0.160.0 · a message that asks without waiting (request_user_input_async)', () => {
  const ASYNC = {
    type: 'agentMessage',
    id: 'call_async',
    text: 'Which database?\n- Postgres\n- SQLite',
    phase: 'final_answer',
    memoryCitation: null,
    delivery: 'async',
    questions: [{ title: 'Which database?', options: ['Postgres', 'SQLite'] }],
  }

  it('carries its questions on the message, and nothing waits on them', () => {
    expect(normalizeNotification('item/completed', { item: ASYNC })).toEqual([
      {
        type: 'assistant_message',
        text: 'Which database?\n- Postgres\n- SQLite',
        phase: 'final',
        questions: [{ title: 'Which database?', options: ['Postgres', 'SQLite'] }],
      },
    ])
  })

  it('only an ASYNC message carries them, and a malformed entry is dropped, never invented', () => {
    expect(normalizeNotification('item/completed', { item: { ...ASYNC, delivery: null } })).toEqual(
      [{ type: 'assistant_message', text: ASYNC.text, phase: 'final' }],
    )
    const [event] = normalizeNotification('item/completed', {
      item: {
        ...ASYNC,
        questions: [
          { title: '  ' },
          { title: 'Free text?' },
          { title: 'Pick', options: ['', 7, 'A'] },
          'x',
        ],
      },
    })
    expect(event).toEqual({
      type: 'assistant_message',
      text: ASYNC.text,
      phase: 'final',
      questions: [{ title: 'Free text?' }, { title: 'Pick', options: ['A'] }],
    })
  })

  it('is bounded: ten questions, ten options, and a long title cut with an ellipsis', () => {
    const many = Array.from({ length: 12 }, (_, at) => ({
      title: at === 0 ? 'x'.repeat(2500) : `q${at}`,
      options: Array.from({ length: 12 }, (_, n) => `o${n}`),
    }))
    const [event] = normalizeNotification('item/completed', { item: { ...ASYNC, questions: many } })
    const asked = event?.type === 'assistant_message' ? (event.questions ?? []) : []
    expect(asked).toHaveLength(10)
    expect(asked[0]?.title).toHaveLength(2000)
    expect(asked[0]?.title.endsWith('…')).toBe(true)
    expect(asked[1]?.options).toHaveLength(10)
  })
})
