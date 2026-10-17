import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  applyEvent,
  createTranscript,
  everyCard,
  markReopened,
} from '../src/renderer/src/lib/transcript'

/**
 * 🔴 **695 · R35 — the card of an agent still running in the BACKGROUND is not ended by its turn.**
 *
 * ⚑ A backgrounded agent outlives the turn that dispatched it by definition, and since `695`
 * declared `perTaskStopAffordance` it outlives a Stop too (`probe:per-task-stop`). ⛔ The turn's
 * sweep drew *"finished"* over it while the bar beside the card still listed it and still offered to
 * stop it. The runtime half is `sub-agent-turn-end.test.ts`; this is the fold's half, because the
 * fold runs its OWN sweep at the terminal turn, and that sweep would draw *finished* over the card
 * even when the stream carries no ending. ⚠️ An older ledger is untouched either way: it replays the
 * runtime's synthetic `sub_agent ended`, which the fold's `sub_agent` arm obeys whatever the level
 * says.
 */

const AT = 1_700_000_000_000

function fold(events: TranscriptEvent[]) {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event, AT)
  return state
}

const started = (agentId: string): TranscriptEvent =>
  ({ type: 'sub_agent', phase: 'started', agentId, kind: 'general-purpose' }) as TranscriptEvent

const level = (ids: string[]): TranscriptEvent =>
  ({
    type: 'background_work',
    running: ids.map((id) => ({ id, kind: 'local_agent' })),
    source: 'background_tasks_changed',
  }) as TranscriptEvent

const interrupted = { type: 'turn', state: 'interrupted' } as TranscriptEvent

const running = (state: ReturnType<typeof createTranscript>) =>
  Object.fromEntries(everyCard(state).map((card) => [card.agentId, card.running]))

describe('695 · R35 — a Stop spares the card of an agent the level still lists', () => {
  it('the backgrounded card stays running; the foreground one beside it is stopped', () => {
    const state = fold([started('bg'), started('fg'), level(['bg']), interrupted])
    expect(running(state)).toEqual({ bg: true, fg: false })
  })

  it('control — with no level naming it, the same card is stopped by the same turn', () => {
    const state = fold([started('bg'), started('fg'), interrupted])
    expect(running(state)).toEqual({ bg: false, fg: false })
  })

  it('a session boundary still stops it — the child’s exit takes every task with it', () => {
    const state = fold([started('bg'), level(['bg']), interrupted])
    expect(running(state)).toEqual({ bg: true })
    markReopened(state)
    expect(running(state)).toEqual({ bg: false })
  })

  it('and the provider’s own ending still lands — the spare is not a claim that it never ends', () => {
    const state = fold([
      started('bg'),
      level(['bg']),
      interrupted,
      {
        type: 'sub_agent',
        phase: 'ended',
        agentId: 'bg',
        outcome: 'interrupted',
      } as TranscriptEvent,
    ])
    expect(running(state)).toEqual({ bg: false })
  })
})

/**
 * 🔴 **695 · R35, the model's half (standing rule 8.1)** — `interrupt_agent` told a model *"whatever
 * it was part-way through is thrown away"*, which on Claude was true of its background agents until
 * the declaration. ⚑ Pinned by name (rule 5): the clause that says background work survives, and the
 * absence of the sentence that said it did not.
 */
describe('695 · R35 — what interrupt_agent tells the model about background work', () => {
  const source = readFileSync(
    join(__dirname, '..', 'src', 'main', 'runtime', 'agent-tools.ts'),
    'utf8',
  )

  it('says the turn’s work is thrown away and the background work keeps running', () => {
    // ⚑ **720 · `709` F-9 — the sentence now ASKS, and says where to read what happened.** Since R43
    // the ledger records the provider's word, and a turn asked to stop can be finished anyway —
    // so *"is cut short"* promised an outcome the ledger could contradict. ⚑ F084 — the background
    // clause (695's R35) now says, per provider, what the stop ends: on Claude, work sent to the
    // background still keeps running.
    expect(source).toContain(
      'It asks the turn it is in to stop: that turn may end there, throwing away whatever it was part-way through, or it may be finished anyway — once the agent is no longer working, get_agent_status says which, so read it there before you rely on either. The stop also ends commands that turn started: on Claude, the command it is waiting on, while work it sent to the background keeps running; on Codex, every command that turn started, even one it left running. A command an earlier turn left running keeps running.',
    )
  })

  it('🔴 720 · no longer promises the turn IS cut short — a promise R43’s ledger can contradict', () => {
    expect(source).not.toContain('The turn it is in is cut short')
  })

  it('no longer says everything it was part-way through is thrown away', () => {
    expect(source).not.toContain('Whatever it was part-way through is thrown away.')
  })
})
