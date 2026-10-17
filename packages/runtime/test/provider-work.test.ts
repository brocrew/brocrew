import { describe, expect, it } from 'vitest'
import { runtimeEventSchema, type RuntimeEvent } from '../src/events'
import { isProviderWork } from '../src/internal/provider-work'

/**
 * **Which events prove the model is running** (123) — the input to
 * {@link SessionMachine.noteProviderWork}, and therefore to a `status` the whole app reads.
 *
 * ⚠️ **A list is only as good as the thing that notices it has gone stale.** The interesting
 * assertion here is not that five types are in; it is that a SIXTH event type cannot be added to the
 * taxonomy without someone deciding which side of this line it falls on.
 */

/** Every `type` the runtime taxonomy can produce, read off the schema rather than typed out. */
function everyEventType(): string[] {
  return runtimeEventSchema.options.map((option) => {
    const literal = (option as unknown as { shape: { type: { value?: string } } }).shape.type
    const value = literal.value
    if (typeof value !== 'string') throw new Error('could not read a discriminator off the schema')
    return value
  })
}

describe('what counts as the provider working (123)', () => {
  const asEvent = (type: string): RuntimeEvent => ({ type }) as RuntimeEvent

  it('is exactly the five that mean the model is producing output', () => {
    const work = everyEventType().filter((type) => isProviderWork(asEvent(type)))
    expect(work.sort()).toEqual([
      'assistant_delta',
      'assistant_message',
      'thinking',
      'tool_call',
      'tool_result',
    ])
  })

  it('⛔ excludes `activity`, and 099 is the reason with a number on it', () => {
    // 208 of 657 activity events — 32% — arrive with no turn open, because it is a fire-and-forget
    // phase notification with no ending of its own. `agent-state.ts` already refuses to let one
    // promote an idle session to a busy one; latching the runtime's own status on one would rebuild
    // that bug a layer below the fix, where nothing downstream could correct it.
    expect(isProviderWork(asEvent('activity'))).toBe(false)
    // …and the app's own lifecycle output is not evidence about the provider either. A machine that
    // read its own emissions would latch on the status it had just published.
    expect(isProviderWork(asEvent('status'))).toBe(false)
    expect(isProviderWork(asEvent('turn'))).toBe(false)
    expect(isProviderWork(asEvent('session'))).toBe(false)
    // …and neither is the provider changing which conversation it is in (199). `/clear` is
    // something the user did between turns; a session that latched `working` on it would be busy
    // with no turn behind it and no ending coming.
    expect(isProviderWork(asEvent('conversation_reset'))).toBe(false)
    // A background run's progress frames prove a WORKFLOW is running, not that this session's own
    // model is. That distinction is 116's, and it is parked.
    expect(isProviderWork(asEvent('workflow_run'))).toBe(false)
    // ⛔ **And 247's is the sharpest case of all**, because being out is load-bearing rather than
    // merely safe: `background_work` exists to describe work that outlives the turn, so its
    // defining case is arriving while the model does nothing — measured, 26.6 s after the turn
    // completed. Latching `working` on it would move `245`'s lie one surface over.
    expect(isProviderWork(asEvent('background_work'))).toBe(false)
    // ⛔ **And 253's is not close, but it is out for a reason worth pinning anyway**: its Claude
    // producer is the `Stop` hook, so it is emitted at the instant a turn ENDS. Latching `working`
    // here would leave every conversation that ever scheduled anything permanently busy, with no
    // ending coming — an unchanged level is never republished.
    expect(isProviderWork(asEvent('scheduled_work'))).toBe(false)
  })

  it('an inventory is not evidence the provider is running (358)', () => {
    // ⛔ **Out for `provider_commands`' reason and one sharper one of its own.** `tool_inventory`
    // says what the agent COULD call — a standing fact — and its Codex arm is emitted on the very
    // path where the provider published NOTHING, because saying so is what that arm is for.
    // Latching `working` on it would read the provider's silence as evidence the provider is busy.
    expect(isProviderWork(asEvent('tool_inventory'))).toBe(false)
    // ⚑ The paired positive, driven through the same function in the same breath: a frame that IS
    // the provider working still answers true, so the assertion above is about this type and not
    // about a predicate that has stopped saying yes to anything.
    expect(isProviderWork(asEvent('tool_call'))).toBe(true)
  })

  it('a memory citation is not independent evidence of a turn (319)', () => {
    // ⛔ **Out because it is DERIVATIVE, not because it is mistimed.** `memory_recall` is emitted
    // from the same `agentMessage` item as the `assistant_message` beside it and from nothing else,
    // so the turn it would prove is already proved one event over. Including it would change no
    // behaviour and would make this list claim a citation is proof a model is running.
    expect(isProviderWork(asEvent('memory_recall'))).toBe(false)
    // ⚑ The paired positive: the event it always travels with IS the evidence.
    expect(isProviderWork(asEvent('assistant_message'))).toBe(true)
  })

  it("⛔ a sub-agent's output is not the main agent working (D-040)", () => {
    const parented = { parentToolCallId: 'toolu_agent' }
    for (const type of ['tool_call', 'tool_result', 'assistant_message']) {
      expect(isProviderWork({ type, ...parented } as unknown as RuntimeEvent), type).toBe(false)
      // ⚑ The paired positive: the same type with no parent is the main agent's own.
      expect(isProviderWork({ type } as unknown as RuntimeEvent), type).toBe(true)
      expect(
        isProviderWork({ type, parentToolCallId: undefined } as unknown as RuntimeEvent),
        `${type} with an explicit undefined parent`,
      ).toBe(true)
    }
  })

  it('makes a new event type someone’s decision rather than a default', () => {
    // ⛔ **The guard, and it is the whole point of the file.** If the taxonomy grows, this number
    // moves and whoever moves it has to say which side of the line the new type falls on. An
    // allow-list makes the safe answer the default; this makes the answer deliberate.
    const types = everyEventType()
    expect(new Set(types).size, 'the taxonomy has duplicate discriminators').toBe(types.length)
    expect(
      types.length,
      'a runtime event type was added or removed — classify it in `provider-work.ts` and update ' +
        'this count, rather than letting it default to "not the provider working"',
    ).toBe(30)
  })
})
