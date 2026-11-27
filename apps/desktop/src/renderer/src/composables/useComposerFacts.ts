import { computed, type ComputedRef } from 'vue'
import type { AgentState } from '../../../shared/agent-state-contracts'
import { providerIsYetToStart } from '../../../shared/agent-state'
import { stopJoinsThatAsk } from '../lib/stop-unanswered'
import { THE_COMPACT_COMMAND, type CompactionFacts } from '../lib/compaction-offer'
import type { SessionRecord } from '../lib/session-record'
import type { SessionPanel } from '../lib/session-panel'
import { CLOSING_BLOCK, SIGN_IN_SUPERSEDED_BLOCK } from '../lib/send-refusals'
import { aCommandInTheBox, aCommandTakesNoAttachmentsYet } from '../lib/a-command-with-files'
import type { SendBlock } from '../lib/composer-notice'
import type { ComposerState } from '../components/PromptComposer.vue'
import type { ConversationPaneProps } from '../lib/conversation-pane-props'

/**
 * What the composer may do in this conversation now: its state, what blocks a send, the
 * go-ahead and Stop (moved out of `ConversationPane.vue` unchanged).
 */
export function useComposerFacts(
  props: Pick<ConversationPaneProps, 'draft' | 'handing' | 'identities' | 'launching' | 'record'>,
  control: ComputedRef<SessionRecord['control']>,
  panel: ComputedRef<SessionPanel>,
  agentState: ComputedRef<AgentState | undefined>,
  signInSuperseded: ComputedRef<boolean>,
  who: ComputedRef<string>,
) {
  /** 🔴 **0.2.40 · a send is on its way in and the provider is yet to start** (the host says `active`, the fold `idle`). */
  const yetToStart = computed(() =>
    providerIsYetToStart(control.value.status, props.record.agentState, props.launching),
  )

  // Drawn from its ledger while the host says Active. Its message goes in by `startAndSend`, which stops
  // nothing, so no Stop and send; Stop needs its page to show a turn or a wait, as a stopped life's does not.
  const runsWithoutThisWindow = computed(
    () => props.record.phase === 'recorded' && agentState.value?.is === 'active',
  )
  const aTurnOnItsPage = computed(() =>
    ['working', 'waiting_permission'].includes(control.value.status),
  )

  /**
   * Determine composer state from both the conversation's state and whether it can accept a message.
   *
   * ⚠️ **`panel.waiting` is *what is OWED*, and a composer freezes on *what is BLOCKED*.** ⚑ The
   * CARDS are counted here, off this window's own fold, which is right when the host's word lags by a
   * frame. The conversation being blocked is `control.status`, which is the host's one derivation
   * (`042` measured three writers of it and `122` left one). ⚠️ **Reading the STATUS alone would give
   * up `064`'s rule** that the composer's state is control truth read locally — a card released from
   * this window's page still has an open request behind it.
   */
  const composerState = computed<ComposerState>(() => {
    // ⚑ **D-017b · a message from this view is starting it** — busy, with the start's Stop.
    if (props.launching === true) return 'busy'
    // ⚑ **D-017b · a conversation drawn from its ledger takes its next message**, whatever its fold
    // last said: nothing in it is working here, and the message is what continues it. ⛔ **Above the
    // cards**: a card on such a view is answered by the window that holds it — or, where none does,
    // once this window takes it (the card's own press) — so it freezes nothing here.
    // …unless the host says it is Active: then it runs without this window ({@link runsWithoutThisWindow}).
    if (props.record.phase === 'recorded') return runsWithoutThisWindow.value ? 'busy' : 'idle'
    // ⛔ **The CARDS, and deliberately not `panel.waiting`** — see this computed's own note.
    if (panel.value.permissions.length + panel.value.questions.length > 0) return 'frozen'
    // 🔴 **The host is holding this conversation on a person**, whether or not its card is in the part
    // of the fold this window holds.
    if (control.value.status === 'waiting_permission') return 'frozen'
    // 🔴 **0.2.40 · busy under an Active header**: the host names it before the provider says `working`.
    if (yetToStart.value) return 'busy'
    return control.value.status === 'idle' ? 'idle' : 'busy'
  })

  /**
   * Whether a message is already waiting to be sent (077).
   *
   * ⚠️ **Read from `meta`, which the liveness channel keeps current — not from the transcript fold.**
   * The queue empties in the main process when a turn ends, with no command returning to say so, and
   * a reader paged back into history is looking at a fold that may not contain the queued item at all.
   * 064's rule: the composer's state is CONTROL truth.
   */
  const hasQueued = computed(() => (props.record.meta?.queued?.length ?? 0) > 0)

  /**
   * 🔴 **718 · `R60` — what the panel's "Compact now…" is offered on: the facts the COMPOSER
   * reads**, handed over rather than re-derived, so the control is live exactly where a plain Send of
   * `/compact` would go (`compaction-offer.ts`). ⛔ Not {@link sendBlocked}, which also carries what the
   * composer says about the DRAFT — a compaction sends no draft.
   *
   * ⚠️ `state` is {@link composerState} itself: a sixth `ComposerState` fails to compile here until
   * somebody decides what the offer says in it.
   */
  const compaction = computed<CompactionFacts>(() => ({
    state: composerState.value,
    closing: props.record.phase === 'closing',
    signInSuperseded: signInSuperseded.value,
    hasQueued: hasQueued.value,
    // ⚑ **The person's own `/compact`, held behind the turn** — the answer to R60's question already
    // on its way, read off the same CONTROL truth {@link hasQueued} reads (`meta.queued`).
    // ⚠️ `typeof` because a held row read by a double or an older bridge may carry no words at all, and
    // a computed the drawer reads must not throw over a fact it only needs for one sentence.
    compactionIsWaiting: (props.record.meta?.queued ?? []).some(
      (held) =>
        held.attribution !== 'app_authored' &&
        typeof held.text === 'string' &&
        held.text.trim().split(/\s/)[0] === THE_COMPACT_COMMAND,
    ),
    who: who.value,
  }))

  /**
   * The button is disabled unless the composer would accept a message, because pressing it SENDS
   * one. Derived from the same `composerState` rather than from a second reading of the status, so
   * the two controls can never disagree about whether this conversation can be spoken to — a button
   * that was live while the box was frozen would be refused by the host, *"cannot start work on the
   * plan: this conversation is still working"*, which is a worse way to learn the same thing.
   *
   * ⚠️ **678 · corrected (`670` §6).** This said the press *"would fail in the runtime with 'a turn is
   * in progress'"*. ⛔ **It never reached the runtime**: `RuntimeHost`'s go-ahead asks the status
   * first and refuses before it releases the plan — so the sentence above is that guard's own words.
   * ⚑ **And a race lost PAST the guard is not a failure since `670`**: another sender opened a turn
   * between the guard and the send, and the go-ahead is HELD and goes when that turn ends.
   *
   * ⚠️ **`busy` is the second half, and it is what makes a DOUBLE CLICK harmless.** Nothing about the
   * conversation changes until the command returns, so two clicks in the same breath would send two
   * go-aheads — and the second one is refused, correctly: by the host's guard while the first one's
   * turn runs, or by the handle once it has ended, because by then the plan has already been released
   * (678: this said *"by the handle"* alone). The user would have seen an error for pressing a button twice. `busy` is
   * the flag every other command on this record already sets while one is in flight; reusing it means
   * the guard cannot drift from them. ⚠️ **739 (`737` F-6) — while one is in flight AND inside its
   * bound** (`A_COMMAND_IS_WAITED_ON_MS`): a go-ahead with no answer after it lights this button
   * again, so a second press can go out while the first is still out, and the host's guard is what
   * refuses it — the pane says the first has had no answer (`session-unanswered`).
   *
   * ⛔ **And the sign-in is the third, added by 149 (148 H2).** This button SENDS, so everything true
   * of the composer is true of it — and the composer is refused outright while the machine sign-in has
   * moved on. It stayed live because it reads composer AVAILABILITY rather than the composer's answer,
   * and the host let it through: the go-ahead was the one send path outside the gate, so pressing this
   * released the plan durably and then started a turn on the superseded child. The host refuses it now;
   * this keeps the user from having to learn that by pressing.
   */
  const canGoAhead = computed(
    () => composerState.value === 'idle' && !props.record.busy && !signInSuperseded.value,
  )

  /**
   * 🔴 **739 · `737` F-6 — why the go-ahead is dark when no turn is running**: a command for this
   * conversation is still out (`busy`), for up to `A_COMMAND_IS_WAITED_ON_MS`. ⛔ The title said
   * *"Wait for the current turn to finish"* here too, over a conversation with no turn running.
   */
  const GO_AHEAD_WAITS_FOR_AN_ANSWER =
    'Wait for what you just asked of this conversation to be answered, then start work.'

  /**
   * Show the send reasons the window already knows, with closing before sign-in and attachments.
   * Frozen and ended states keep their own actionable hints. Busy sends use the same sign-in rule;
   * Stop is independent. The host remains the authority for facts this window does not hold.
   */
  const sendBlocked = computed<SendBlock[]>(() => {
    // Every reason that holds, most important first: the composer shows the first and counts the rest.
    const reasons: SendBlock[] = []
    // ⚑ **D-017b · a message from here cannot continue it** — the host said so when it drew it
    // (another window has it open, or this app cannot start it again), in its own words.
    const cannot = props.record.meta?.cannotTakeAMessage ?? null
    if (cannot !== null) reasons.push({ words: cannot })
    // ⛔ **Closing outranks `frozen`** (234 §2, from `228` M2). ⚠️ **219 gated Send on
    // `closing` and left this line above it**, so a conversation closed with a card open kept the
    // frozen advice: *"answer the request above to continue"*, about a request `close()` settles at
    // teardown start (`settleRequests()`), in a conversation that is not going to continue. ⚑ The
    // same precedence argument this block already makes for the sign-in: a conversation on its way
    // out cannot be repaired by the remedy the state names, so naming it first would name a later
    // that does not exist.
    if (props.record.phase === 'closing') reasons.push({ words: CLOSING_BLOCK })
    if (composerState.value !== 'idle' && composerState.value !== 'busy') return reasons
    if (signInSuperseded.value) reasons.push({ words: SIGN_IN_SUPERSEDED_BLOCK })
    const command = aCommandInTheBox(props.draft, control.value.commands)
    if (command !== null && props.handing.staged.length > 0)
      reasons.push({
        words: aCommandTakesNoAttachmentsYet(command),
        fix: { label: 'Remove attachments', press: () => props.handing.stage([]) },
      })
    return reasons
  })

  /**
   * 🔴 **696 · `688` L1 — whether a message can be typed and sent here NOW**, for the one sentence that
   * tells a person to: a taken-back go-ahead's *"— type your next message to carry on"*
   * (`takenBackGoAheadsThatMayCarryOn`).
   *
   * ⛔ **Four facts, each one a way the instruction was false** (`696`'s review, two rounds): a
   * message from here cannot continue it (D-017b); it is `closing`; its sign-in was superseded, so no message can go out on
   * it until it is reopened; or the reader has scrolled back past a released slab, where a message the
   * person sent after the row sits in a part of the conversation this page does not hold. ⚑ Frozen is
   * not one: the card is answered, and then a message goes. ⚠️ **Asked of the facts, not of
   * {@link sendBlocked}**: that one answers *what the composer says*, and it says nothing of a
   * superseded sign-in while frozen — the card's advice outranks it there — though the sign-in still
   * holds every message back (round two). ⚠️ **Today that pair cannot meet** (round two's refuter): the
   * held go-ahead is Codex's (`endPlanMode` is a Codex-only path) and only Claude's adapter reports a
   * superseded sign-in. ⚑ The clause is kept because it is asked of the FACT, not of a provider — the
   * day either side widens, it holds without anybody remembering this paragraph.
   */
  const canTakeAMessage = computed(
    () =>
      (props.record.meta?.cannotTakeAMessage ?? null) === null &&
      props.record.phase !== 'closing' &&
      !signInSuperseded.value &&
      props.record.window.atTail,
  )

  /**
   * ⛔ **Whether the turn can still be taken back — the composer's `interruptible`, supplied for the
   * first time** (234 §2, from `228` M2).
   *
   * ⚠️ **It was a DEAD PROP from 102/103 until this dispatch**: nothing in `src` set it after 103 removed the
   * launcher's `false`, so it was permanently `true`. ⚑ **This is the caller it was waiting for.**
   *
   * ⛔ **Stop is the one control the sign-in block deliberately leaves lit** — interrupting needs no
   * credential — **and closing is not that case.** Teardown ends the running turn itself, and bounds
   * it (070); pressing Stop into a handle whose provider is already being stopped is a second way to
   * ask for a thing that is already happening, and it can come back as a session error from a handle
   * that has gone. ⚠️ Nothing is lost: Close is the stronger gesture and it is the one in flight.
   *
   * ⚑ **One computed, read by the button and by the key** (`onKey` is the third stop affordance; 094).
   * 🔴 **0.2.40 · and not while a send is on its way in and the provider is yet to start**: nothing exists to stop, so a Stop would be dead. The composer is busy and Stop waits for the provider ({@link providerIsYetToStart}); a launch this view owns keeps its own.
   */
  const interruptible = computed(
    () =>
      props.record.phase !== 'closing' &&
      !yetToStart.value &&
      (props.launching === true || !runsWithoutThisWindow.value || aTurnOnItsPage.value),
  )

  /**
   * 🔴 **730 · R83 — what the Stop control says while an ask to stop goes unanswered**, or `null`.
   * ⚑ Off {@link control} and never the reading window: it is a claim about NOW. ⚑ The provider off
   * the record's meta, as the transcript's cards name it (`725`, R73).
   */
  const stopUnansweredWords = computed(() =>
    control.value.stopUnanswered === null
      ? null
      : stopJoinsThatAsk(
          control.value.stopUnanswered,
          props.record.meta?.provider ?? null,
          // ⚑ **737 · and which agent asked**, named as the notice names it (`734` F-2).
          props.identities ?? null,
        ),
  )

  return {
    yetToStart,
    runsWithoutThisWindow,
    aTurnOnItsPage,
    composerState,
    hasQueued,
    compaction,
    canGoAhead,
    GO_AHEAD_WAITS_FOR_AN_ANSWER,
    sendBlocked,
    canTakeAMessage,
    interruptible,
    stopUnansweredWords,
  }
}
