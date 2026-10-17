import { ASKED_TO_STOP, stoppedBy } from '../../../shared/how-work-stopped'
import {
  agentName,
  providerName,
  type AgentIdentity,
  type Provider,
  type StopUnansweredEvent,
  type WorkInterruptedEvent,
} from '../../../shared/runtime-ipc'

/**
 * # 🔴 730 · R83 — a Stop the provider has not answered, said
 *
 * ⚑ **The ruling, whole** (`720` F-F): *"A Stop the provider does not answer is said (Codex has not
 * answered the stop), and a second press joins the first ask instead of queuing another."*
 *
 * ⚑ **The fact is main's** (`723`): `stop_unanswered { waitedMs, by, agent?, agentProfile? }` (the last since `734`), written once per ask
 * when the host's bound passes with the ask unanswered and its turn still running — from all three
 * doors that ask (a person's Stop, interrupt-and-send, `interrupt_agent`). ⚑ And the join is main's
 * too: a person's Stop while that ask stands asks nothing new (`RuntimeHost.interrupt`). What is
 * this file's is the WORDS, said in two places — the conversation's notice and the Stop control —
 * from one spelling.
 *
 * ⛔ **The asker is named by its kind, never by its handle** (`HO-095` §5.3, `724` F-3): `stoppedBy`
 * with no agent id says *an agent* rather than `sess_…`. 🔴 **737 · and by its NAME where the row
 * carries its identity** (`734` F-2, `732` F-4): since `734` both rows an agent's ask writes carry
 * the asker's identity slug (`agentProfile`), and {@link whoAskedItToStop} names it through
 * `agentName` (R41) — the category where there is no identity or no roster.
 *
 * ⚠️ **It is a statement about THEN** (the row's own docblock): the provider may still answer, or
 * end the turn in its own word. No row says a late answer (`723` F-7), so between that answer and
 * the next `turn` row it is *has not answered the stop* that goes stale — the join clause is
 * conditional (*while that ask stands*) and stays true. ⚑ The fold clears the fact on the next
 * `turn` row and on a reopen (where the host stops joining), and on a newer ask — which the host
 * joins too, but nobody has waited on yet.
 */

/** ⚑ The row's own facts — what the notice and the control both read (`agentProfile` since `737`). */
export type StopUnanswered = Pick<StopUnansweredEvent, 'by' | 'agent' | 'agentProfile' | 'waitedMs'>

/** ⚑ **737** · the facts of the ask itself (`work_interrupted`) that name who asked. */
export type AskedToStop = Pick<WorkInterruptedEvent, 'by' | 'agent' | 'agentProfile'>

/**
 * 🔴 **737 · `734` F-2, `732` F-4 — who asked a turn to stop, as a person reads it**: the asking
 * agent's NAME (`agentName(agentProfile, identities)`, R41) where the row carries its identity and
 * the roster has landed; otherwise its category (`stoppedBy`: *an agent*, *a person*).
 *
 * ⛔ **Never the `sess_…` handle** (`HO-095` §5.3): the row's {@link AskedToStop.agent} is a
 * conversation id and is never handed to `stoppedBy` here. ⚠️ **`agentName(null, …)` answers
 * *BroBot*** (`relayed-turn.ts`' rule), so an absent identity never reaches it. ⚠️ **Only on an
 * agent's ask** — a person's ask that carried an identity (`732` M14 plants one) is still *a person*.
 * ⚠️ **A reader with no roster says the category** (the rows' own rule): the fold, and the readable
 * export that prints what the fold wrote.
 */
export function whoAskedItToStop(
  fact: AskedToStop,
  identities: readonly AgentIdentity[] | null,
): string {
  const named =
    fact.by === 'an-agent' && fact.agentProfile !== undefined && identities !== null
      ? agentName(fact.agentProfile, identities)
      : null
  return stoppedBy(fact.by, named)
}

/**
 * 🔴 **737 · the ask's notice** — *"asked to stop by Grace"*, in {@link ASKED_TO_STOP}'s bytes (R43),
 * with {@link whoAskedItToStop}'s asker. ⛔ It said *"asked to stop by sess_…"* for every agent's ask.
 */
export function askedToStopSays(
  fact: AskedToStop,
  identities: readonly AgentIdentity[] | null,
): string {
  return `${ASKED_TO_STOP} by ${whoAskedItToStop(fact, identities)}`
}

/**
 * 🔴 **The notice's sentence** — *"Codex has not answered the stop asked for by a person"*.
 * ⚑ The provider is NAMED where the surface knows it — composed from {@link providerName}, never
 * typed (`317`) — and is *the provider* where it does not. ⚠️ **The fold always writes the second
 * form** (`provider: null`), for readers that cannot name it (the readable export); `NoticeEntry`
 * says it again with the pane's provider.
 */
export function stopUnansweredSays(
  fact: StopUnanswered,
  provider: Provider | null,
  identities: readonly AgentIdentity[] | null = null,
): string {
  const who = provider === null ? `The provider` : providerName(provider)
  return `${who} has not answered the stop asked for by ${whoAskedItToStop(fact, identities)}`
}

/**
 * 🔴 **What the Stop control says while that ask stands** — the sentence above, and what a press
 * does now: R83's *"a second press joins the first ask"*, in the host's own terms (it does not ask
 * the provider again). ⚠️ *Stop* and never *pressing again*: the standing ask may be an agent's
 * `interrupt_agent` or an interrupt-and-send, which this person never pressed as Stop — and a
 * person's Stop joins those too (`RuntimeHost.interrupt`).
 *
 * ⚠️ **730 review · "while that ask stands", said and not assumed**: the host stops joining the
 * moment the provider answers, late or not, and no row says a late answer (`723` F-7) — so the
 * condition is on screen rather than a promise the next press may break.
 */
export function stopJoinsThatAsk(
  fact: StopUnanswered,
  provider: Provider | null,
  identities: readonly AgentIdentity[] | null = null,
): string {
  const who = provider === null ? `the provider` : providerName(provider)
  return `${stopUnansweredSays(fact, provider, identities)} — while that ask stands, Stop joins it rather than asking ${who} again`
}

/**
 * 🔴 **737 · `730` F-3 — what a press of Stop does, said as R43 says it**: *the turn is asked to
 * stop*, in {@link ASKED_TO_STOP}'s own bytes.
 *
 * ⛔ **The Stop control said *"Interrupt the running turn"*, and the frozen foot *"Esc stops the
 * turn"*** — both from before R43 (`709`): *"A turn is `interrupted` only when the provider says it
 * was."* A press sends the ask; Codex can finish the turn anyway (`probe:codex-early-interrupt`),
 * and on Claude it is this app that ends it when the ack does not come (R71). ⚑ **`asked`, and never
 * `stopped`** — the one claim true on both providers, and the one the card's Cancel line and the
 * transcript's notice already make (`how-work-stopped.ts`).
 *
 * ⚠️ **Passive on purpose.** A press inside `730` F-2's window — someone's ask already standing,
 * its bound not yet passed — JOINS that ask rather than making one (`RuntimeHost.interrupt`), so
 * *"asks the turn to stop"* would say this press asked; *"the turn is asked to stop"* is true of
 * both. ⚠️ And it names *the turn* as generally as the words it replaces did: a burst the provider
 * started itself reaches the same state (`ComposerState` `busy`).
 */
export const A_STOP_ASKS_THE_TURN = `the turn is ${ASKED_TO_STOP}`

/**
 * 🔴 **739 · `737` F-7 — what *Stop and send* does, said as R43 says it**: the turn is asked to stop
 * ({@link A_STOP_ASKS_THE_TURN}, never typed again here), and the words go once it has ENDED.
 *
 * ⛔ **It said *"Stop Codex and send this instead"* and *"to interrupt and send now"***, and since
 * R43 (`709`) the provider may finish the turn first: *"A turn is `interrupted` only when the
 * provider says it was."* ⚑ **Each word, read off the host** (`RuntimeHost.runSendInterrupting`):
 * where a turn is running, the press asks it anew — it never joins a standing ask (`723` F-5) —
 * then waits a BOUNDED while for it to end (the ask's 2 s, then `waitForIdle`'s 5 s), then sends.
 * *ended* is true whichever word the provider gives it, `interrupted` or `completed`; *instead* was
 * false when it finished first, and *now* was false for the seconds the host waits.
 * ⚠️ **The limit, rule 8.4, in the words themselves**: a turn still running when those waits run out
 * refuses the words, and they come back to the box (`RuntimeScreen`'s `restoreRefused`) beside the
 * host's own sentence — so *"or comes back to you if it has not within seconds"*, never a promise
 * that the words go whenever the turn ends. *within seconds* and not a number: the host's bounds are
 * not on the wire (`739` GAP), and a copy would drift.
 * ⚠️ **Two branches the words do not name, stated here**: a turn that had already ended when the host
 * looked is asked nothing and the words go at once (still *sent once it has ended*); and a send that
 * LOSES the race to another sender's turn is held behind that turn — or refused, where a work message
 * of the person's is already waiting (the one-work-message rule) — rather than sent when THIS turn
 * ends.
 */
export const A_STOP_THEN_THIS_IS_SENT = `${A_STOP_ASKS_THE_TURN}; this is sent once it has ended, or comes back to you if it has not within seconds`
