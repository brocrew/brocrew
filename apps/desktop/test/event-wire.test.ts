import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '@brobot2/runtime'
import { toWireEvent } from '../src/main/runtime/event-wire'
// The renderer's own one-line summary, imported rather than restated: the claim below is that a
// degraded frame is legible on the surface a live step reads, and only the real function can say so.
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * Everything crossing to the renderer goes through here, so the two failure modes
 * that would silently break the stream are covered: an event the adapter got wrong,
 * and provider data that Electron's structured clone would refuse to send.
 */
describe('toWireEvent', () => {
  it('passes a valid event through unchanged', () => {
    const event: RuntimeEvent = { type: 'assistant_message', text: 'hi' }
    expect(toWireEvent('claude', event)).toEqual(event)
  })

  it('strips anything outside the contract', () => {
    const event = { type: 'status', state: 'idle', secret: 'do-not-forward' } as RuntimeEvent
    expect(toWireEvent('claude', event)).toEqual({ type: 'status', state: 'idle' })
  })

  it('degrades a malformed event to `unknown` rather than forwarding a half-typed value', () => {
    const event = { type: 'turn', state: 'exploded' } as unknown as RuntimeEvent
    expect(toWireEvent('codex', event)).toEqual({
      type: 'unknown',
      provider: 'codex',
      category: 'unrecognized',
      // ⚑ **And it says which of ours it was** (235). The replacement is unchanged; what changed is
      // that it is no longer indistinguishable from provider chatter.
      label: 'degraded:turn',
      degradedFrom: 'turn',
      raw: { type: 'turn', state: 'exploded' },
    })
  })

  it('keeps a plain unknown payload intact', () => {
    const raw = { some: { nested: ['payload', 1, true] } }
    expect(
      toWireEvent('codex', { type: 'unknown', provider: 'codex', category: 'unrecognized', raw }),
    ).toEqual({
      type: 'unknown',
      provider: 'codex',
      category: 'unrecognized',
      raw,
    })
  })

  it('projects a payload that structured clone would reject, so the stream survives it', () => {
    const raw = { keep: 'this', drop: () => 'not cloneable' }
    const wire = toWireEvent('claude', {
      type: 'unknown',
      provider: 'claude',
      category: 'unrecognized',
      raw,
    })

    expect(wire).toEqual({
      type: 'unknown',
      provider: 'claude',
      category: 'unrecognized',
      raw: { keep: 'this' },
    })
    expect(() => structuredClone(wire)).not.toThrow()
  })

  it('describes a payload that survives neither cloning nor JSON', () => {
    const wire = toWireEvent('claude', {
      type: 'unknown',
      provider: 'claude',
      category: 'unrecognized',
      raw: () => 'a bare function',
    })
    expect(wire).toEqual({
      type: 'unknown',
      provider: 'claude',
      category: 'unrecognized',
      raw: '[unserializable function]',
    })
    expect(() => structuredClone(wire)).not.toThrow()
  })

  it('keeps a circular payload (structured clone handles it, JSON would not)', () => {
    const raw: Record<string, unknown> = { name: 'loop' }
    raw.self = raw

    const wire = toWireEvent('codex', {
      type: 'unknown',
      provider: 'codex',
      category: 'unrecognized',
      raw,
    })
    expect(() => structuredClone(wire)).not.toThrow()
    expect((wire as { raw: { name: string } }).raw.name).toBe('loop')
  })

  it('an image event crosses the wire intact — with and without a path (067)', () => {
    // ⚠️ Written because the review found the variant untested here. The pathless shape is the
    // "file is gone" one, and it is the one at risk: if `path` were ever made required, that event
    // would fail the schema and degrade to an `unrecognized` chatter card — the wrong words, in the
    // wrong style, for a state the UI has a real answer for. Both shapes, so neither can drift.
    const withPath: RuntimeEvent = {
      type: 'image',
      imageId: 'exec-1',
      path: '/x/generated_images/t/exec-1.png',
      prompt: 'a sleeping fox',
    }
    const withoutPath: RuntimeEvent = { type: 'image', imageId: 'exec-1' }
    expect(toWireEvent('codex', withPath)).toEqual(withPath)
    expect(toWireEvent('codex', withoutPath)).toEqual(withoutPath)
    expect(() => structuredClone(toWireEvent('codex', withPath))).not.toThrow()
  })

  it('a multi-select question crosses the wire with its flag, and one without it still crosses (139)', () => {
    // ⛔ **The hop 139 was told not to miss.** This function re-validates and *"strips anything
    // outside the schema"* (128) — which is exactly how a `multiSelect` the normalizer had faithfully
    // copied would still have arrived at the card as nothing. The flag has to be DECLARED to survive
    // this line, not merely present on the object above it.
    const multi: RuntimeEvent = {
      type: 'user_input_request',
      id: 'toolu_1',
      prompt: 'AskUserQuestion',
      questions: [
        {
          id: 'q0',
          prompt: 'which capabilities?',
          options: [{ label: 'a' }, { label: 'b' }],
          multiSelect: true,
        },
        {
          id: 'q1',
          prompt: 'where do files go?',
          options: [{ label: 'x' }, { label: 'y' }],
          multiSelect: false,
        },
      ],
    }
    expect(toWireEvent('claude', multi)).toEqual(multi)

    // ⚑ And the ledger's own shape: every `user_input_request` recorded before 139 carries no such
    // field, replay hands them to the same renderer, and an absent flag must stay absent — filled in
    // as `false` it would claim the provider answered a question it was never asked.
    const historical = {
      type: 'user_input_request',
      id: 'toolu_2',
      prompt: 'AskUserQuestion',
      questions: [
        { id: 'q0', prompt: 'pick a colour', options: [{ label: 'blue' }, { label: 'red' }] },
      ],
    } as RuntimeEvent
    expect(toWireEvent('claude', historical)).toEqual(historical)

    // Non-vacuity for the first assertion: the strip is real on this very event, so "it survived"
    // means the schema declares it and not that nothing is ever removed here.
    const withJunk = { ...multi, id: 'toolu_3', modeHint: 'checkbox' } as RuntimeEvent
    expect(toWireEvent('claude', withJunk)).toEqual({ ...multi, id: 'toolu_3' })
  })

  it('the option OBJECT, the header, the escape and the mask all cross the wire (143)', () => {
    // ⛔ **The same hop, for the four things 143 added.** 139's tripwire proved a declared field
    // survives this line; these are four more that had to be declared, and one of them — `options` —
    // stopped being a `string[]` entirely. A description faithfully copied by both normalizers and
    // then dropped here would reach the card as a label with no reason, which is the exact state
    // this dispatch exists to end.
    const rich: RuntimeEvent = {
      type: 'user_input_request',
      id: 'toolu_4',
      prompt: 'AskUserQuestion',
      questions: [
        {
          id: 'q0',
          prompt: 'which database?',
          header: 'DB',
          options: [
            { label: 'postgres', description: 'the one already running' },
            { label: 'sqlite' },
          ],
          allowOther: true,
          secret: false,
          multiSelect: false,
        },
      ],
    }
    expect(toWireEvent('claude', rich)).toEqual(rich)

    // ⚑ **The legacy row, on the path that DOES re-parse.** Every `user_input_request` written
    // before 143 holds bare strings, and the schema's string branch coerces them to `{label}` rather
    // than failing the parse and degrading the whole event to `unknown`. That coercion is not what
    // saves replay — replay never parses, see `boundStoredEvent` — but an imported bundle and any
    // re-emitted event come through here, and a card of blank chips is not a better outcome than a
    // card that says the event was unreadable.
    const legacy = {
      type: 'user_input_request',
      id: 'toolu_5',
      prompt: 'AskUserQuestion',
      questions: [{ id: 'q0', prompt: 'pick a colour', options: ['blue', 'red'] }],
    } as unknown as RuntimeEvent
    expect(toWireEvent('claude', legacy)).toEqual({
      type: 'user_input_request',
      id: 'toolu_5',
      prompt: 'AskUserQuestion',
      questions: [
        { id: 'q0', prompt: 'pick a colour', options: [{ label: 'blue' }, { label: 'red' }] },
      ],
    })

    // Non-vacuity, per field: an undeclared sibling of each new field is stripped from the very same
    // event, so "they survived" is a fact about the schema and not about this function being inert.
    // `as unknown as` because these two fields are exactly what the neutral shape does NOT declare:
    // `isOther` is the provider's spelling of `allowOther`, and `preview` is the option field 142
    // measured real and this dispatch deliberately did not take.
    const withJunk = {
      ...rich,
      id: 'toolu_6',
      questions: [{ ...rich.questions[0]!, isOther: true, preview: 'a mockup' }],
    } as unknown as RuntimeEvent
    expect(toWireEvent('claude', withJunk)).toEqual({ ...rich, id: 'toolu_6' })
  })

  it('an image event with an absurd prompt is REFUSED into the bounded path (067)', () => {
    // The adapter truncates, but an imported bundle bypasses every adapter. The schema cap is what
    // catches that, and what it degrades to is the `unknown` door — where 052's ceiling applies.
    const corrupt = { type: 'image', imageId: 'exec-1', prompt: 'x'.repeat(500_000) }
    const wire = toWireEvent('codex', corrupt as unknown as RuntimeEvent)
    expect(wire.type).toBe('unknown')
    expect(JSON.stringify(wire).length).toBeLessThan(2_000)
  })

  it("carries a child's attribution on its WORDS across the boundary (128)", () => {
    // ⛔ **The second place the schema is load-bearing, and the one the normalizer test cannot
    // see.** This function's own docstring says validation *"strips anything outside the schema"* —
    // so before 128 a `parentToolCallId` spread onto an `assistant_message` would have been dropped
    // here, silently, and the fold in the renderer would have been asked to route by a field that
    // never arrived. `tool_call` has been crossing intact since 029; this is its other half.
    const said: RuntimeEvent = {
      type: 'assistant_message',
      text: '[GAPS-BG] Starting the coverage audit.',
      parentToolCallId: 'toolu_01XUw2M6GqwL4GcxNuDH9cfR',
    }
    expect(toWireEvent('claude', said)).toEqual(said)
    // …and the paired positive that the field is genuinely optional: the parent's own prose crosses
    // with no owner at all rather than acquiring an empty one.
    const main: RuntimeEvent = { type: 'assistant_message', text: '[MAIN] Both back.' }
    expect(toWireEvent('claude', main)).toEqual(main)
  })

  it('never throws, whatever it is handed', () => {
    expect(() => toWireEvent('claude', undefined as unknown as RuntimeEvent)).not.toThrow()
    expect(() => toWireEvent('claude', null as unknown as RuntimeEvent)).not.toThrow()
  })
})

/**
 * ⛔ **230 M3's mechanism, at the boundary that performs it** (235).
 *
 * 230 H1's residual, in its own words: *"a log that dropped `tool_call` rows specifically, while
 * still recording turns and messages, would be invisible to them — and `snapshot().tools` reads the
 * same list, so there is no third surface to ask."* This is the turn that residual describes, run
 * end to end: a tool call loses its `summary`, the assistant message and the terminal turn beside it
 * are valid and survive, and the question is whether anything downstream can tell that a call was
 * erased from a turn in which no call was made.
 *
 * ⚠️ **The assertions are on the COUNT, deliberately.** `224` reclassified steps to read the ledger,
 * and what it asks the ledger is *how many tool calls are there* — so the fix has to be legible to a
 * counter, not merely present on an object.
 */
describe('235 · an erased tool call is countable, at the wire', () => {
  /** The regression 230 M3 describes: a `tool_call` emitted without its required `summary`. */
  const erased = { type: 'tool_call', id: 'toolu_1', name: 'Bash' } as unknown as RuntimeEvent

  /** The rest of the turn, all of it valid — which is what makes the erasure invisible. */
  const turn: RuntimeEvent[] = [
    { type: 'assistant_message', text: 'I ran it; the answer is 4.' },
    { type: 'turn', state: 'completed' },
  ]

  const wire = (events: RuntimeEvent[]): RuntimeEvent[] =>
    events.map((event) => toWireEvent('claude', event))

  it('⛔ the ledger can say "a tool call was erased", not only "no tool was called"', () => {
    const sent = wire([erased, ...turn])

    // The half that was already true and is the whole problem: the turn survives, and the tool does
    // not appear as a tool anywhere.
    expect(sent.filter((event) => event.type === 'tool_call')).toHaveLength(0)
    expect(sent.filter((event) => event.type === 'turn')).toHaveLength(1)
    expect(sent.filter((event) => event.type === 'assistant_message')).toHaveLength(1)

    // The half 235 adds: the third surface.
    const erasedCalls = sent.filter(
      (event) => event.type === 'unknown' && event.degradedFrom === 'tool_call',
    )
    expect(erasedCalls).toHaveLength(1)
  })

  it('⛔ and it does NOT say so about a turn that simply used no tools', () => {
    // ⚠️ The anti-vacuity half, and the one that decides whether the signal is worth anything: a
    // counter that reports an erasure for an ordinary turn would make every `NOT ASSERTED` into a
    // false alarm, which is a worse instrument than none.
    const honest = wire([
      ...turn,
      { type: 'unknown', provider: 'claude', category: 'reasoning', raw: { thinking: '…' } },
    ])
    expect(
      honest.filter((event) => event.type === 'unknown' && event.degradedFrom !== undefined),
    ).toHaveLength(0)
  })

  it('⛔ the signal reaches the renderer row a live step reads — with no renderer change', () => {
    // `ui-live-smoke.mjs`'s `ledgerRows()` reads one string per row: the `.rdetail` span, which is
    // `describeEvent(event)`. The `unknown` arm has printed `provider · label` since 072, so the
    // marker arrives on the surface a live step already has — this test is what says so, and what
    // would go red if the label stopped being derived from the erasure.
    const [row] = wire([erased])
    expect(describeEvent(row as TranscriptEvent)).toBe('claude · degraded:tool_call')

    // …and honest chatter still reads as itself on the same surface.
    const chatter: RuntimeEvent = {
      type: 'unknown',
      provider: 'claude',
      category: 'lifecycle',
      label: 'thread/compacted',
      raw: {},
    }
    expect(describeEvent(toWireEvent('claude', chatter) as TranscriptEvent)).toBe(
      'claude · thread/compacted',
    )
  })

  it('survives the round trip through IPC, or the renderer would never see it', () => {
    const [row] = wire([erased])
    const cloned = structuredClone(row) as RuntimeEvent
    expect(cloned.type === 'unknown' && cloned.degradedFrom).toBe('tool_call')
  })

  it('⛔ and it SAYS so on the log, once per frame — 085', () => {
    // ⚠️ Without this the warning is a line nobody would notice losing, which is the same sentence
    // `session-persistence.test.ts` writes over the ledger-skip warn. The ledger row is what an
    // instrument counts; this is the only thing that reaches a person watching a terminal.
    const original = console.warn
    const said: string[] = []
    console.warn = (...args: unknown[]) => void said.push(args.map(String).join(' '))
    try {
      wire([erased, ...turn])
    } finally {
      console.warn = original
    }
    expect(said).toHaveLength(1)
    expect(said[0]).toContain('claude')
    expect(said[0]).toContain('degraded:tool_call')
    // The Zod reason travels with it, or the line says a frame was refused without saying why.
    expect(said[0]).toContain('summary')
  })

  it('never throws on a candidate Zod itself cannot read, and still names it', () => {
    // ⛔ `runtimeEventSchema` is a discriminated union: Zod reads `.type` to choose an arm, and that
    // read is unguarded. A throwing getter escaped through this function into the event pump before
    // 235's adversarial pass found it — the guard was one call too late, inside the marker.
    const throwing = {
      get type() {
        throw new Error('a getter that refuses')
      },
    } as unknown as RuntimeEvent
    const original = console.warn
    console.warn = () => {}
    try {
      let out: RuntimeEvent | undefined
      expect(() => {
        out = toWireEvent('claude', throwing)
      }).not.toThrow()
      expect(out?.type).toBe('unknown')
      expect(() => structuredClone(out)).not.toThrow()
    } finally {
      console.warn = original
    }
  })
})
