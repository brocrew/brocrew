import type { UserTurnEvent } from './runtime-ipc'

/**
 * ⚑ **A person's own words, as one message of a turn carries them** — a message or a command a
 * window sent (unmarked, 413), the plan go-ahead their press sent (app-authored, about nothing), or
 * their answer to a question, carried to its asker.
 *
 * ⚑ **F097 · one reading for the host and the fold**: the host asks it of the turn that runs
 * (`RuntimeHost`'s `aPersonsWordsOpenedIt`), and `derivePieces` of the turn whose end leaves a
 * piece a conversation gave waiting on the person who wrote. ⛔ **A module of its own, reaching
 * nothing but a ledger type**, so the fold that reads it still reaches no clock, store or disk.
 */
export function aPersonsOwnWords(
  one: Pick<UserTurnEvent, 'attribution' | 'work' | 'relayedFrom' | 'appNotice'>,
): boolean {
  if (one.attribution === undefined) return true
  if (one.appNotice === 'an-answer-to-a-question') return true
  return (
    one.attribution === 'app_authored' &&
    one.work === undefined &&
    one.relayedFrom === undefined &&
    one.appNotice === undefined
  )
}
