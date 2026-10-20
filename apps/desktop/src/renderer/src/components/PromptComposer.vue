<script lang="ts">
import type { SendIntent } from '../lib/session-store'
import { pathTail } from '../../../shared/path-tail'
import {
  MAX_HANDED_PATHS,
  hasSomethingToSend,
  isPastedImage,
  noRoomForPastedImage,
  nothingToSendYet,
  onlyOnePastedImage,
  pastedImageLabel,
  type DroppedPathVerdict,
  type HandedPath,
} from '../../../shared/runtime-ipc'

/**
 * The composer's state is DERIVED from the session, never set by hand: a composer that could be
 * told it was idle while a permission was pending would let you type a message that answers
 * nothing, which is precisely the confusion the frozen state exists to prevent.
 */
export type ComposerState =
  /** Ready. Enter breaks the line; the button or ⌘/Ctrl-Enter sends. */
  | 'idle'
  /**
   * The provider is running: the input is its, and the button asks it to stop — or, while an ask
   * it has not answered stands, joins that ask (`730`, R83; see `stopUnanswered`).
   *
   * ⚠️ **"The provider is running" is deliberately wider than "a turn is running" as of 123**, and
   * this state needed no change to absorb the difference. A burst the provider started by itself —
   * a background run finishing and waking the agent, measured 18 times in the live corpus — reaches
   * `busy` through the same `status: working`, and every branch below still means what it says:
   * queueing waits for the provider to finish, ⇧⌘↵ asks it to stop and sends once it has ended —
   * or gives the words back if it has not within the host's bounded wait (`739`: it said *takes it
   * back* — see `A_STOP_THEN_THIS_IS_SENT`), and the stop button asks it to
   * stop (`737`: it said *stops it*, which R43 made false — see `A_STOP_ASKS_THE_TURN`).
   * ⛔ The placeholder is `${who} is working — type to queue a message…` — because it says what
   * typing here will DO; ⚑ since D-010 whatever already waits, since several may. Naming who
   * started the work would be a fact about the transcript above, where the missing `user_turn`
   * already says it.
   */
  | 'busy'
  /**
   * The conversation is being OPENED, and nothing is running yet (103).
   *
   * ⚠️ **This is not `busy`, and telling the composer it was is what 102 had to paper over.** Every
   * branch below that reads `busy` means "a turn is running": you may queue behind it, ⇧⌘↵ asks it
   * to stop and sends once it has ended (or gives the words back), and `interrupt-session` is the name a quarter of `ui-live-smoke.mjs` waits on to mean
   * exactly that. A launch is none of those things — there is no turn to queue behind, nothing to
   * interrupt, and a second send starts a SECOND conversation rather than waiting for the first
   * (102's review). 102 expressed the difference as two extra props and three added clauses; it is
   * one state, and saying so deletes all of them.
   *
   * The box locks — see {@link canType} for the two data-loss paths that decided it — and the way
   * out is the Cancel in the foot, which is 101's placement and 102's mechanism.
   */
  | 'starting'
  /** A permission or a question is waiting on you — a message will not answer it. */
  | 'frozen'

/**
 * Whether a composer keydown means SEND — the WHOLE decision, IME clause included, so a future
 * caller cannot get a version of it that fires mid-composition. Enter alone does not send — it
 * breaks the line, because a message is multi-line prose now (015) and losing half-typed
 * paragraphs to a reflexive Enter is the exact bug this replaced. Sending is deliberate: the
 * button, or Enter with ⌘/Ctrl held. An Enter that commits an IME composition is neither.
 */
export function isSendShortcut(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'isComposing'>,
): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing
}

/** The label for the interrupting chord, in the modifier this platform actually has (077). */
export function interruptKeyLabel(platform: string): string {
  return /mac/i.test(platform) ? '⇧⌘↵' : 'Shift+Ctrl↵'
}

/**
 * Whether this text may be SENT from this state — the guard both send paths (button and
 * shortcut) run through. Trim decides emptiness only; what gets sent is the text itself.
 *
 * ⚠️ **`busy` is allowed since 077, and that reversal is the whole ticket.** It used to be
 * `state === 'idle'`, which is why redirecting an agent meant interrupting it, watching the turn
 * die, and only then being allowed to type — *"two actions, and the message you had ready is lost
 * between them"*. What a send MEANS while busy is a separate question, answered by
 * {@link sendIntentFor}; this only answers whether there is anything to send.
 *
 * `frozen` stays refused, for an unchanged reason: a card is waiting on a specific answer that a
 * message would not give (063). ⚑ D-017b · there is no ended conversation: every one takes a
 * message.
 *
 * ⚠️ **`starting` is refused too, and it is the one refusal that is about a conversation that does
 * not exist yet** (103). 102's review found a second ⌘↵ on the launcher starting a SECOND
 * conversation whose launch took the name the first was cancellable by, leaving the first
 * unstoppable — and fixed it in the launcher, one layer above this guard, which meant the box
 * cleared itself and the words had to be handed back. It belongs here, in the predicate both send
 * paths run through, because there is nothing to send to yet.
 * The launcher's own guard came out with it — one rule, one place; see `NewConversation.startWith`.
 *
 * ⛔ **`blocked` is the same move again, for a reason the STATE cannot see** (169 §1). The launcher
 * knows one thing this predicate never could: that the profile name typed above the box is not a
 * name a folder can have, so the launch it would start has nowhere to run. Before this, the launcher
 * let the gesture happen and refused it afterwards — Send lit, pressed, and answered with the words
 * handed back — which is exactly the *"no control that cannot act"* 106 forbids. The caller supplies
 * the sentence; this predicate makes it stop both send paths rather than only the one that goes
 * through the button.
 */
export function canSend(
  text: string,
  state: ComposerState,
  blocked: string | null = null,
  attached = 0,
): boolean {
  // ⛔ **An attachment is content too** (216, found in review). With an empty box and a folder
  // staged, the Send button was lit and pressing it did nothing at all — no message, no error,
  // nothing — because this required text and the button's `:disabled` never reflected that. ⚑ The
  // fix is the permissive one, because *"here, look at this"* is a real thing to mean and
  // `messageWithHandedPaths` already composes it: with no words it sends the block alone.
  //
  // ⛔ **`hasSomethingToSend` rather than the predicate written out here** (221 §1). It was written
  // out here, and the wire held `text: z.string().min(1)` — one rule in two places, disagreeing,
  // for two dispatches: the button was lit, the press was legal at every other layer, and the
  // schema between them answered with raw zod. The wire calls this same function now.
  return (
    blocked === null && (state === 'idle' || state === 'busy') && hasSomethingToSend(text, attached)
  )
}

/**
 * What pressing send MEANS, from the state and whether Shift was held (077).
 *
 * The ordinary shortcut queues; Shift interrupts. Queueing preserves the running turn and sends afterward. An interruption can discard in-flight thinking if honored, though the provider may finish first, so require the deliberate modifier.
 *
 * Both are offered as BUTTONS as well, so neither outcome is reachable only by knowing a shortcut —
 * the dispatch's *"make the choice obvious at the moment of pressing, not a setting buried
 * elsewhere"*.
 */
export function sendIntentFor(state: ComposerState, interrupting: boolean): SendIntent {
  if (state !== 'busy') return 'now'
  return interrupting ? 'interrupt' : 'queue'
}

/** The shortcut as the hint spells it — the modifier this platform actually has. */
export function sendKeyLabel(platform: string): string {
  return /mac/i.test(platform) ? '⌘↵' : 'Ctrl↵'
}

/**
 * 🔴 **744 · What a chip marked *missing* says on hover** — a restored draft's path that was not
 * there when BroBot started. ⚠️ **The WHOLE message waits on it**: the send is refused by name while
 * the path is still gone (`recheckHandedPaths`) and the words come back, so the sentence does not
 * suggest the rest would go without it.
 */
export const MISSING_ON_RESTORE =
  'Not found at this path when BroCrew started — the message will not send until it is back or you remove it'
</script>

<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import { createAttachmentBook, type DraftHanding } from '../lib/drafts'
import { A_STOP_ASKS_THE_TURN } from '../lib/stop-unanswered'
import { A_STOP_THEN_THIS_IS_SENT } from '../lib/stop-unanswered'
import { isOnlyAStopWord } from '../lib/a-stop-word'

/** The one place a conversation is spoken to — and the place that says why you cannot speak. */
const props = withDefaults(
  defineProps<{
    state: ComposerState
    /**
     * What is typed here — owned by the CALLER, keyed by conversation (019). This component is
     * handed a different conversation rather than being rebuilt for each one, so text it owned
     * itself followed you between threads and could be sent to the wrong agent.
     *
     * REQUIRED on purpose. Optional, it was the one-line path back to that bug: a call site that
     * forgot `:draft` still compiled and still rendered a normal-looking field, whose displayed
     * text was then whatever the DOM happened to be holding — the previous conversation's.
     */
    draft: string
    /** What the box invites you to type — a new thread asks a different question. */
    placeholder?: string
    /** Who is working, when a turn is running. */
    who?: string
    /**
     * Whether a running TURN can be taken back.
     *
     * ⚠️ **It is about a turn, and 103 gave the other case its own state.** This prop read *"false
     * while a session is still being STARTED: there is no turn to interrupt yet, and a stop button
     * that did nothing would be the one control on this surface that lies"*; 102 made the launch
     * stoppable and flipped it to `true`, which lit `interrupt-session` and the Esc hint on a
     * surface that has neither. `starting` says what is actually true, so this prop is back to
     * meaning one thing.
     */
    interruptible?: boolean
    /**
     * Whether a message is ALREADY waiting to be sent (077). One at a time: the host refuses a
     * second rather than overwriting the first, and this is what lets the control say so before the
     * press instead of after it.
     */
    hasQueued?: boolean
    /**
     * 🔴 **730 · R83 — an ask to stop the provider has not answered, and what Stop does now** — the
     * caller's sentence (`stopJoinsThatAsk`), or `null`.
     *
     * ⚑ **Drawn only while `busy`.** There the host joins a press to the standing ask and asks the
     * provider nothing new (`RuntimeHost.interrupt`); while a card is up (`frozen`) a press is a NEW
     * ask that settles the card, so the frozen words stay. ⚠️ Interrupt-and-send asks again too
     * (`723` F-5), so the draft's two outcomes are left as they are.
     */
    stopUnanswered?: string | null
    /**
     * ⛔ **Why a send cannot happen right now, in the caller's own words — or `null`** (169 §1).
     *
     * Not a boolean, and that is the whole of 118's rule: *"a greyed button still says 'this is the
     * thing to do here, later'; there is no later"*. A disabled control is only honest when the
     * later is reachable, so the reason travels WITH the refusal and is rendered where the press
     * would have happened — the foot, beside the button, which is already this component's job:
     * *"the one place a conversation is spoken to, and the place that says why you cannot speak"*.
     *
     * ⚠️ **It is about the SEND, not the text.** Typing stays open (a message worth writing is worth
     * keeping while the thing that blocks it is fixed), and nothing here inspects why — the caller
     * has the fact and the sentence, and this component has the two send paths.
     */
    blocked?: string | null
    /**
     * ⛔ **The attachment TRANSACTION for this draft** (292 §2) — owned by the CALLER, keyed by
     * conversation, for exactly the reason {@link draft} is.
     *
     * ⚠️ **It was a LIST and an `update:attachments` emit until 292, and that is what `288` H2
     * was.** Held as a list the paths were safe — `019`'s bug with a filename on it, closed by
     * `216` — but the OPERATIONS that produce them were still the component's, and
     * `ConversationPane` keys this component by session id so a conversation switch tears it down.
     * A screenshot pasted in A and answered while B was on screen reached neither: Vue drops
     * emissions from an unmounted component, so the write had nowhere to go. ⛔ **Measured, both
     * directions: A had no chip, no refusal and no attachment, and B was not contaminated either.**
     *
     * ⚑ **So the caller hands over the transaction rather than its result.** Staging, the refusal
     * and the work in flight are all one object keyed by draft, and a late answer commits to the
     * draft it was started for wherever the screen has gone. A composer that comes BACK to A finds
     * the work still open and waits for it — which a component-local version could not do, however
     * carefully it handed its results off.
     *
     * ⚠️ **Defaulted rather than required, and only for mounts that own no draft book.** SSR and
     * unit mounts get a private transaction that behaves exactly like a real one and dies with
     * them, which is the honest thing for a caller with nowhere to keep a draft. ⛔ **Both shipped
     * mounts pass a real one and are typechecked into doing so** — `ConversationPane` and
     * `NewConversation` both take it as a REQUIRED prop, so `RuntimeScreen` cannot forget it.
     */
    handing?: DraftHanding
    /** This conversation's working directory, so the picker can say when a path is outside it. */
    cwd?: string
    /**
     * ⛔ **Whether this mount offers the paperclip at all** (216 §2, opened on the launcher by 217).
     *
     * ⚑ **Default `false`, and that default is what kept a half-wired version off the screen.** The
     * control needs three things from its caller — somewhere to keep what is staged, a folder to
     * judge it against, and a listener for `update:attachments` — and a mount that offered the
     * button without them would open a native dialog and throw the answer away. Opt-in means the
     * nine lines arrive together or not at all.
     *
     * ⚠️ **`217` turned it on for `NewConversation`**, because `013` makes the launcher's prompt the
     * FIRST message: without it a conversation could not BEGIN with a file, which is the first thing
     * a person tries. Both mounts pass it now; the default survives for whatever mounts this next.
     */
    canAttach?: boolean
  }>(),
  {
    placeholder: 'Message this conversation…',
    who: 'The agent',
    interruptible: true,
    hasQueued: false,
    stopUnanswered: null,
    blocked: null,
    // ⚠️ A FACTORY, so each mount that owns no book gets its own — a shared one would be `019`'s
    // bug in the one place this component is allowed to keep state at all.
    handing: () => createAttachmentBook().handing('composer'),
    cwd: '',
    canAttach: false,
  },
)

const emit = defineEmits<{
  /**
   * The text, which of the three things the press meant (077), and ⛔ **what was attached** (216).
   *
   * ⚠️ **The paths travel WITH the send, not beside it.** They were a separate `update:attachments`
   * and a frame that read the book at send time — and the frame did not read it, so every
   * attachment a person made was cleared from the chip and dropped on the floor. An adversarial
   * review of `216`'s own diff found it, confirmed by four independent angles; nothing in the suite
   * crossed that seam because nothing mounts `RuntimeScreen`. Carried on the event, the send and its
   * attachments cannot come apart.
   */
  send: [text: string, intent: SendIntent, attachments: HandedPath[]]
  /**
   * Stop what is running: the turn while `busy`/`frozen`, the LAUNCH while `starting` (102/103).
   *
   * One event for both because the caller is the only thing that knows which it has — and it does,
   * because it is the caller that put this composer in that state.
   */
  interrupt: []
  'update:draft': [text: string]
}>()

/** Reads the caller's draft, writes straight back to it — no second copy to drift out of sync. */
const text = computed({
  // `?? ''` for the runtime only: the prop is required, but a missing prop is a dev warning rather
  // than a stop, and a field bound to `undefined` is worse than one bound to empty.
  get: () => props.draft ?? '',
  set: (value: string) => emit('update:draft', value),
})
/**
 * ⚠️ **Typing is allowed while the agent works (077).** The field used to lock the moment a turn
 * started, so the only way to redirect an agent was to stop it and then type — and whatever you had
 * already written was lost in between. `frozen` still locks: it is waiting on a specific answer.
 *
 * ⚠️ **`starting` locks, and it took the review to work out why it must** (103). The first version
 * of this state left the box open — "the next thought is worth keeping" — and two verifiers traced
 * what that costs: the box already holds a message that was SENT and is still in flight, so a
 * second thought typed over it makes the two collide. On a failed launch the hand-back is skipped
 * (it refuses to overwrite live typing, 019) and the sent message is dropped; on a cancelled one
 * the sent message is written back and the live typing is dropped. Either way something a person
 * wrote disappears without being told.
 *
 * So this is `frozen`'s reason, not 077's: **a launch is not a turn, and there is nothing to type
 * INTO yet.** It costs almost nothing — a healthy Codex handshake was measured at 80–83 ms warm and
 * 530–916 ms cold (102) — and when it is not almost nothing, the answer is the Cancel in the foot,
 * not a second message.
 */
const canType = computed(() => props.state === 'idle' || props.state === 'busy')

/**
 * ⛔ **The staged list — the ONE thing every reader and every write here computes from.**
 *
 * ## ⚑ 236 §4's one-tick window is GONE rather than papered over (292 §2)
 *
 * This read `pendingStaged.value ?? props.attachments`, and the local copy existed because
 * `props.attachments` *does not change when the parent writes it — it changes when the parent
 * RE-RENDERS*, a scheduler tick away. Two drops resolving in one tick both computed from the
 * pre-drop list and the second one's answer won, so the first file was silently gone (`231` #10,
 * measured).
 *
 * ⛔ **The transaction answers synchronously, so there is no window to hold open.**
 * {@link DraftHanding.staged} reads the book the caller writes; a stage lands before the next
 * reader can run, whether or not anything has re-rendered. ⚑ Deleting the copy also deletes the one
 * way the two could disagree — which is what `232` widening this window (an awaited IPC round trip
 * instead of a `stat`) had made expensive.
 */
const staged = computed<readonly HandedPath[]>(() => props.handing.staged)

/**
 * # 🔴 The draft is a TRANSACTION, and acquiring an attachment is an operation inside it (262 §1)
 *
 * ## ⛔ What was wrong, in the five steps the reviewer wrote out
 *
 * 1. The composer holds `please inspect this` and nothing is staged.
 * 2. The person pastes a screenshot and **presses Send while it is still being written.**
 * 3. {@link onPaste} awaits `pasteImage` and then a classification before it reaches {@link stage},
 *    and main's half is not a token await — it encodes, sweeps the root, writes atomically and
 *    classifies.
 * 4. {@link send} is still enabled *by the text*. It reads an EMPTY {@link staged}, emits the
 *    text-only turn and clears the composer.
 * 5. The paste resolves and {@link stage} drops the screenshot into the now-empty composer.
 *
 * 🔴 **The provider got the prompt without the image it refers to, and the chip then appeared as if
 * it belonged to a draft that no longer existed — so the NEXT Send attached that old screenshot to
 * a new message.** ⛔ That is a silent message-integrity failure, not late decoration: the picture
 * arrives beside words that were never about it, and nothing on screen ever said so.
 *
 * ## ⚠️ Why the old one-tick window did not close it, though it is about the same gesture
 *
 * That window joined *completed* {@link stage} writes across a parent-render tick — it existed
 * because two drops that have both come BACK could compute from the same stale prop. ⛔ **There was
 * no state at all for an acquisition that has not reached `stage` yet**, which is the whole of this
 * defect: the composer could not tell "nothing is attached" from "nothing is attached *yet*".
 *
 * ## ⛔ One primitive, not a screenshot special case — the reviewer asked for this explicitly
 *
 * The picker, the drop and the paste have the identical shape: read what the gesture carries
 * synchronously, ask main, stage the answer. **All three go through {@link acquire}**, so the rule
 * is a property of *asking main* rather than a thing somebody remembered to do for ⌘V. A fourth
 * gesture gets it by being written the same way, and `one-way-to-stage.test.ts` already forbids
 * reaching the staging rules any other way.
 *
 * ## ⛔ The mechanism: {@link send} does not emit while this draft has an operation open
 *
 * The reviewer offered two, and they are not equal. **Binding a result to the draft that started
 * it** stops the screenshot riding the NEXT message but still lets THIS one go out without it —
 * which is the half of the failure that reaches the provider. **Holding the send** is the one that
 * makes both true at once: nothing is late, because nothing is emitted until everything that was
 * reserved has arrived.
 *
 * ⚑ **Waiting rather than disabling.** A Send refused because a file is mid-write is `106`'s *"the
 * gesture happened and quietly did nothing"*, and ⌘↵ has no button to grey. The press is honoured;
 * it lands a beat later, and {@link acquiringNow} puts that beat on screen.
 *
 * ⚠️ **The wait is ABOVE {@link canSend}, and that ordering is a second defect closed.** With an
 * empty box and a screenshot still being written there is nothing for `canSend` to say yes to — so
 * ⌘↵ pressed a moment after ⌘V was dropped on the floor in silence, and the chip then appeared over
 * a composer nobody had sent. The content of the message has not arrived yet; asking whether there
 * is anything to send before it has is asking the wrong question.
 *
 * ## 🔴 …and 292 §1 found the half of this that was still open
 *
 * ⛔ **The wait IS a window** (`288` H1, measured: two presses, two sends, the second one carrying
 * the same words and no attachment). Two `send()` calls both awaited the same acquisition and both
 * resumed; the first emitted and cleared the draft, and the second — reading a prop-backed draft
 * the parent had not patched yet — emitted the same words again. ⚑ {@link sending} is the latch,
 * set before the first await, and it is why this docblock's *"nothing is emitted until everything
 * reserved has arrived"* now also means *"and then exactly once"*.
 *
 * ⛔ **What is NOT here, and why**: an epoch stamped on each acquisition and compared at
 * {@link stage}. ⚑ **292 made it unnecessary rather than merely unreachable** — the operation is
 * stamped with its draft's key by {@link DraftHanding} and commits to that draft, so there is no
 * later moment at which the wrong one could be chosen.
 */
const acquiringNow = computed(() => props.handing.acquiring)

/**
 * ⛔ **Reserve the slot BEFORE the first await, then stage what comes back** — in the DRAFT rather
 * than in this component (292 §2). See {@link DraftHanding.acquire}.
 */
async function acquire(work: () => Promise<readonly DroppedPathVerdict[] | null>): Promise<void> {
  await props.handing.acquire(work)
}

/** Wait until this draft has no operations left open. See {@link DraftHanding.settle}. */
async function settle(): Promise<void> {
  await props.handing.settle()
}

/**
 * ⛔ **The button's own answer to the question both send paths already ask** (223).
 *
 * ## What was wrong, and how long it had been wrong
 *
 * `send-prompt`'s `:disabled` was `!canType || blocked !== null`. ⛔ **It never asked about
 * content.** So with an empty box and nothing attached — *the state the app spends most of its life
 * in* — Send was lit, full-accent and completely inert: `221` pressed it in the running app and
 * measured **no conversation, no rail row, the wire never reached**. `106` in its worst form, on the
 * most-seen button in the product.
 *
 * ⚑ **`canSend`, not a third term.** Writing `!canType || blocked !== null || !hasSomethingToSend(…)`
 * would have been a fourth transcription of a rule that already has one home. `canSend` IS
 * `blocked === null && canType && hasSomethingToSend(…)` — the same three clauses, in the predicate
 * `send()` and the ⌘↵ handler both run through. The button now asks the same question they do, which
 * is the whole of this fix.
 *
 * ⚠️ **This is NOT `221` §6 reversed, and the distinction is the reason 223 exists.** `221` forbade
 * darkening Send for an ATTACHMENT-ONLY message, because that message has content and a working
 * feature would have been hidden behind a dead control. `hasSomethingToSend` is the one predicate
 * that tells the two states apart: a staged file keeps the button lit, and an empty box with nothing
 * staged does not.
 */
const canSendNow = computed(() =>
  canSend(text.value, props.state, props.blocked, staged.value.length),
)

/**
 * ⛔ **WHY the button is dark, or null when it is not** (223, from an adversarial pass over 223's own
 * diff).
 *
 * ## The regression this exists to have prevented
 *
 * The first version of 223 put the new sentence into the `:title` ternary as one more branch, beside
 * `blocked` and `starting`. ⛔ **That was a second, independent reading of a rule `:disabled` was
 * already computing** — and the two disagreed immediately: on an `ended` conversation `canSend`
 * refuses on its STATE clause, no branch answered for that state, and the dark button read *"Type a
 * message, or attach a file, to send"* over a disabled textarea and a disabled paperclip, one line
 * above a foot saying the conversation had ended. Measured in Chromium through the real
 * `ConversationPane`, not a forced mount.
 *
 * ⚑ **So the reason is derived FROM the answer.** `canSendNow.value` is asked first: while it is
 * true there is no reason, and every branch below is unreachable. That is what makes the invariant —
 * *a dark button always has a sentence, and a lit one never does* — hold by construction rather than
 * by the two chains happening to enumerate the same clauses in the same order.
 *
 * ⚠️ **The order below is `canSend`'s own order, and it is the precedence decision** (219 §1, which
 * 223 §6 forbids weakening). `blocked` outranks everything: both it and an empty box can be true at
 * once, and an empty box is fixed by doing the thing the person was already about to do while
 * `blocked` is not. Then the STATE, which names a wait or an ending rather than a thing to type.
 * The content sentence is last because it is the fall-through: the button is dark, and nothing
 * above explains it.
 *
 * ⚠️ **`frozen` is here for completeness and is not reachable through either shipped mount** — but
 * the REASON changed at 234 §2 and the old one is dead (found in review). It used to be that a
 * frozen conversation always rendered `interrupt-session`, because `interruptible` defaulted to
 * true; the pane supplies it now, so frozen + closing renders the send button instead. What keeps
 * this branch unreached is the line above it: `blocked` carries `CLOSING_BLOCK` in exactly that
 * state and short-circuits first. It costs one line and stops the fall-through from ever answering
 * for a state.
 */
const sendRefusal = computed<string | null>(() => {
  if (canSendNow.value) return null
  if (props.blocked !== null) return props.blocked
  if (props.state === 'starting') return 'This conversation is still opening — one at a time'
  if (props.state === 'frozen') return 'Answer the request above — a message will not answer it'
  return nothingToSendYet(props.canAttach)
})
// SSR-safe: the render tests run in node, where there is no navigator to ask.
const platform = typeof navigator === 'undefined' ? '' : navigator.platform
const sendKey = sendKeyLabel(platform)
const interruptKey = interruptKeyLabel(platform)

/**
 * ⛔ **When the busy pair — Queue and Interrupt-and-send — is on offer** (234 §2, from `227` M4 /
 * `228` M1).
 *
 * ⚠️ **It read `state === 'busy' && text.trim() !== '' && blocked === null`, and the middle clause
 * is a fourth transcription of a rule that has one home.** `223` made {@link canSendNow} the
 * button's answer and `221` made it the wire's; this selector was written before either and never
 * asked. ⛔ **So with a file staged and no words, while a turn was running, the app offered
 * NOTHING**: no Queue, no Interrupt-and-send, and the fall-through put the plain stop button in the
 * slot. `221` made that message legal on the wire and `216` decided *"here, look at this"* is a real
 * thing to mean — ⌘↵ sent it perfectly well, and typing any word at all made both buttons appear.
 * A feature reachable only by knowing a shortcut is `106` from the other side.
 *
 * ⚑ **`canSendNow`, not a fourth clause.** It already IS `blocked === null && (idle|busy) &&
 * hasSomethingToSend(…)`, so pairing it with `busy` is the same three conditions asked once. The
 * hint below reads the same computed, because the sentence and the buttons describing different
 * states is how `223`'s tooltip went wrong.
 */
const busyChoices = computed(() => props.state === 'busy' && canSendNow.value)

/**
 * ⛔ **Whether the composer WEARS the frozen register** (234 §2, from an adversarial pass over this
 * dispatch's own diff).
 *
 * ⚠️ **The paint and the sentence had come apart.** `tokens.css` reserves this amber for *"an
 * in-flight run is frozen on YOU"*, and §2 made `blocked` outrank the frozen hint on a closing
 * conversation — so the foot read *"this conversation is closing — nothing more can be sent to
 * it"* in the colour that means the opposite. ⚑ One predicate, read by the form and by the hint,
 * so the two cannot disagree again: the register belongs to the sentence that is actually shown.
 */
const frozenLook = computed(() => props.state === 'frozen' && props.blocked === null)

/**
 * Whether the turn can be taken back — **`frozen` included, and that is 094's P2.**
 *
 * ⚠️ **Every stop affordance in this app used to be gated on `busy` alone**, and
 * `ConversationPane.vue` returns `frozen` — not `busy` — the moment a permission or a question is
 * waiting on you. So the one state where a turn is definitely not going to end on its own was the
 * one state you could not stop it from: the exits were to answer the card or to close the whole
 * conversation. 093 measured it by pressing stop with a card open and getting
 * `no [data-cy=interrupt-session]`.
 *
 * **This does not touch 034's rule**, which is about a MESSAGE: `canSend` still refuses `frozen`,
 * the textarea is still disabled, and the card still has to be answered for the turn to continue.
 * Stopping the turn is not answering the card — removing the stop button was never what kept a
 * typed message from looking like an answer, and 063's unattended card is untouched either way.
 * What the interrupt then does to the card is the runtime's existing 085 path: both adapters
 * `settleRequests()` inside `interrupt()`, and the terminal `turn` event settles the card through
 * `transcript.ts`'s one `settlePending` — measured live on both providers as `settled when the turn
 * was interrupted`, the same wording closing the conversation produces. **No second ending is
 * invented here**, which is the claim; not that no other ending exists — a session that dies in the
 * same breath still records `settled when the session failed`, because the first ending to speak
 * wins and that one is true too (review).
 *
 * Stop must also settle a frozen out-of-turn card. An `interrupt()` implementation that returns solely because no turn is active leaves the enabled control unable to change that state.
 *
 * ⚠️ **What makes it act depends on what is running, and a reviewer corrected this.** With a card
 * open and NO provider work behind it, `SessionMachine.forceEnd` finds nothing to end and emits
 * nothing; the button acts because `interrupt()`'s guard now asks *"is anything to do"* rather than
 * *"is a turn open"*, and `settleRequests()` then declines the card so the agent stops waiting.
 * `forceEnd` is what acts when a burst IS latched. `out-of-turn-work.test.ts` pins all three
 * halves — the provider is told, the card is settled, the composer comes back — because "not a
 * no-op" needs all three.
 */
const canInterrupt = computed(
  () => (props.state === 'busy' || props.state === 'frozen') && props.interruptible,
)

/**
 * Whether the box holds only a word asking the agent to stop, while the turn can be stopped. Then
 * Stop now is the primary choice: it stops the turn and keeps the word in the box, unsent.
 */
const stopWordOnly = computed(
  () =>
    busyChoices.value &&
    canInterrupt.value &&
    staged.value.length === 0 &&
    isOnlyAStopWord(text.value),
)

/**
 * # 🔴 One press or five, ONE submission — the latch `288` H1 asked for (292 §1)
 *
 * ## ⛔ What was wrong, measured before it was fixed
 *
 * `262` made Send WAIT for an attachment being written, and ⚠️ **the wait is the window.** Two
 * presses while a screenshot was mid-write both reached `await settle()` and both came back: the
 * first emitted `inspect this` with the picture and cleared the draft, and the second — reading a
 * draft the PARENT owns and Vue had not patched yet — emitted `inspect this` again, **with no
 * attachment at all.** One intended submission, two runtime sends; if the host accepts both the
 * person sent a duplicate they never wrote, and if it refuses the second the refusal path hands
 * back text that has already gone.
 *
 * ⚑ **Tenth recorded instance of a correct fix moving a cost somewhere nobody was looking**, and
 * the second time in this file: `232` making the classifier async is what widened `236` §4's window
 * from a `stat` to an IPC round trip.
 *
 * ## ⛔ Set before the FIRST await, which is the only place it can be set
 *
 * Everything from entering {@link send} to the latch is straight-line JavaScript, so no second
 * press can run in between — the same guarantee {@link DraftHanding.acquire} makes about its
 * reservation, for the same reason. A press that finds the latch set **coalesces**: it returns the
 * send already running rather than starting a second continuation.
 *
 * ## ⚠️ It is LOCAL, and that is a decision the transaction cannot make for it
 *
 * {@link DraftHanding} is keyed by draft precisely so an operation outlives this component. ⛔ **A
 * latch keyed the same way would be a deadlock**: a send left waiting when you switch conversations
 * can never emit — Vue drops emissions from an unmounted component — so a composer returning to
 * that draft would coalesce every press into a send that can never complete, and the conversation
 * would be permanently unsendable. ⚑ A press belongs to a mounted button; the acquisition it waits
 * on belongs to the draft. What a person who leaves mid-send comes back to is their words, their
 * chip — the picture lands in the draft it was pasted into — and a Send that works.
 *
 * ## ⚑ …and the LAST intent wins, so neither press is a silent no-op
 *
 * A coalesced ⇧⌘↵ raises the pending send to interrupting, because {@link send} reads the intent
 * *after* the wait anyway — *"a turn that started while the picture was being written turns this
 * press into a QUEUE"*. Dropping the second press's meaning on the floor would be `106`'s *"the
 * gesture happened and quietly did nothing"* arriving inside the fix for it.
 */
const sending = shallowRef<{ run: Promise<void>; interrupting: boolean } | null>(null)

function send(interrupting = false): Promise<void> {
  const already = sending.value
  if (already !== null) {
    // ⚠️ Raised, never lowered inside one submission: `interrupting || …` would let a stray plain
    // press cancel a deliberate ⇧⌘↵. The last press that ASKED for something wins.
    if (interrupting) already.interrupting = true
    return already.run
  }
  const latch = { run: Promise.resolve(), interrupting }
  // ⚠️ Assigned before `emitOnce` runs, so a press that arrives inside it coalesces rather than
  // seeing an empty latch. `run` is replaced immediately below with the real promise.
  sending.value = latch
  latch.run = emitOnce(latch).finally(() => {
    sending.value = null
  })
  return latch.run
}

async function emitOnce(latch: { interrupting: boolean }): Promise<void> {
  // 🔴 **Nothing is emitted while this draft still has an attachment on the way** (262 §1). See
  // {@link acquiringNow}: an empty `staged` is not the same fact as nothing having been attached,
  // and this is the line that tells the two apart. ⚠️ ABOVE `canSend` on purpose — an empty box
  // with a screenshot mid-write has nothing for it to say yes to yet.
  if (acquiringNow.value) await settle()
  // ⚠️ **Asked AFTER the wait, because the wait is a window**: a permission card, a close or an
  // interrupt can all land inside it, and the answer from before it would be a fact about a
  // composer that no longer exists. ⚑ A refusal here costs nothing — the words and the chips are
  // still in the box, which is what `019` means by not losing typing.
  if (!canSend(text.value, props.state, props.blocked, staged.value.length)) return
  // ⚠️ **Read AFTER the wait too.** A turn that started while the picture was being written turns
  // this press into a QUEUE, which is what pressing Send a beat later would have meant — reading it
  // before would send into a session that is now busy. ⚑ …and `latch.interrupting` rather than the
  // argument, so a ⇧⌘↵ that arrived DURING the wait is the meaning this send carries (292 §1).
  const intent = sendIntentFor(props.state, latch.interrupting)
  // ⚑ **D-010 · no refusal here**: several messages may wait — and since D-027 they go together, in
  // one turn, oldest first, a command alone.
  // trimEnd, not trim: a message that opens with indented code keeps its indentation — with a
  // multi-line field the leading whitespace is content, only the trailing newline is noise.
  // ⛔ Read BEFORE the clear below, and passed with the send — see the emit's own note.
  const handed = [...staged.value]
  emit('send', text.value.trimEnd(), intent, handed)
  text.value = ''
  // A refusal from an earlier picker attempt does not describe the next message.
  attachRefusal.value = null
  // ⛔ **Cleared WITH the text, because they were one message** (216 §2). An attachment that
  // outlived its send would ride along on the next one — silently, since the chip looks the same —
  // which is the shape `211` §1 spent a dispatch on for the launch draft.
  if (staged.value.length > 0) props.handing.stage([])
}

/**
 * ⛔ **The picker's refusal, at choose-time — kept in the DRAFT** (216 §3, moved by 292 §2).
 *
 * `106`/`118`/`169`: the gesture is not allowed to happen and then be undone. Main classifies what
 * came back before this ever sees it, so a bad choice produces a sentence here rather than a failed
 * turn later. ⚠️ `null` is CANCELLED and changes nothing — including the refusal already on screen,
 * because a person who opened the picker and thought better of it has not answered anything.
 *
 * ⛔ **It was a local `ref`, and a sentence about A shown only while A is on screen is half a
 * disclosure** (292 §2). The gesture whose refusal this is can be answered by main after the
 * composer that made it is gone — *"there is no image on the clipboard"* arriving for A while B is
 * on screen had nowhere to go at all. Held in the transaction it waits in A, like the chip does.
 */
const attachRefusal = computed<string | null>({
  get: () => props.handing.refusal,
  set: (why) => props.handing.refuse(why),
})

/**
 * ⛔ **Whether anything can be staged here at all** — the paperclip's rule AND the drop's (218 §2).
 *
 * ⚑ **One predicate, because they are one question.** A composer that greyed the button and still
 * took a drop would be two answers to *"can you attach right now"*, which is the shape acceptance 7
 * is about. `canAttach` is the mount's opt-in (216), `canType` is the state (a launch in flight has
 * nothing to attach TO), and the ceiling is the ceiling.
 */
const canStage = computed(
  () => props.canAttach && canType.value && staged.value.length < MAX_HANDED_PATHS,
)

async function attach(): Promise<void> {
  if (!canStage.value) return
  // ⛔ **Through {@link acquire}, like every other gesture that asks main something** (262 §1). A
  // picker is the SLOWEST of the three — it is a person deciding, in a modal that can stand open
  // for a minute — so a send in the middle of it is the likeliest instance of the defect, not the
  // rarest.
  await acquire(async () => {
    const chosen = await window.api.chooseAttachment({ cwd: props.cwd })
    // ⚠️ `null` is CANCELLED and changes nothing — including the refusal already on screen. Kept
    // out of `stage` rather than handed to it, because a drop has no cancel: by the time main sees
    // the paths the person has already let go. ⚑ {@link acquire} passes it straight through.
    return chosen === null ? null : [chosen]
  })
}

/**
 * # ⛔ Drop it on the composer (218 §2)
 *
 * ⚑ **A third GESTURE, not a third code path.** Everything below resolves paths and hands them to
 * {@link stage}; what a path IS, whether it exists, whether it is a folder and whether it is outside
 * the working directory are all still `classifyHandedPath` in main, exactly as the picker's are.
 *
 * ⛔ **BroBot never opens the file** (216), and here that is structural rather than disciplined: the
 * only thing the renderer can do with a `File` is send it across the preload bridge to
 * `webUtils.getPathForFile`, which returns a *path*. Nothing here reads bytes because nothing here
 * can — see `no-byte-authority.test.ts`, which now censuses this file for the web half of the same
 * rule (`FileReader`, `.arrayBuffer(`, `webkitGetAsEntry`).
 */

/**
 * How many drag-enters are outstanding — a COUNTER, not a boolean.
 *
 * ⚠️ `dragenter` and `dragleave` both fire when the pointer crosses between the composer's own
 * children (the textarea, a chip, a button), so a boolean set on enter and cleared on leave flickers
 * the target off the moment the cursor reaches the field it is inviting you to drop on.
 */
const dragDepth = ref(0)
/**
 * ⛔ **`canStage` as well as the counter — found reviewing this diff.**
 *
 * ⚠️ Every handler below is gated on `canStage`, so it can only be raised when a drop is possible.
 * But `canStage` can go FALSE while a drag is still in the air: a permission card arriving turns a
 * live conversation `frozen` mid-gesture, and nothing lowers the counter for that. The composer was
 * left saying *"Drop to attach"* over a drop it would then silently ignore — `106`'s exact shape, and
 * the one this feature's own refusal path exists to avoid.
 */
const dropping = computed(() => canStage.value && dragDepth.value > 0)

/**
 * Is this drag carrying FILES? — the question that keeps the target from lighting up on a text drag.
 *
 * ⚠️ **`types` is all that is readable during a drag.** `dataTransfer.files` is empty until the drop
 * itself, by design: the page is not allowed to know what you are dragging until you let go. So the
 * target is offered on the promise of files and the refusal happens on the drop, which is also why
 * {@link attachRefusal} has to carry a sentence for a drop that turns out to hold nothing usable.
 */
function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

function onDragEnter(event: DragEvent): void {
  if (!canStage.value || !carriesFiles(event)) return
  dragDepth.value += 1
}

function onDragOver(event: DragEvent): void {
  if (!canStage.value || !carriesFiles(event)) return
  // ⛔ **`dragover` is the ground truth that a drag is here — `dragenter` only refines it.**
  //
  // ⚠️ **Measured, live, and it is why this line exists.** `218`'s smoke drove a real file over
  // this composer through Chromium's own drag pipeline and the page received
  // `dragover[text/uri-list|Files]` TWICE with **no `dragenter` at all** — so a target counting
  // only enters stayed dark for a drag that was plainly over it. HTML5 says an enter precedes every
  // over; a pipeline that is going to drive this feature for the rest of its life disagrees, and
  // the measurement wins.
  //
  // ⚑ **Self-healing, which is what makes it safe to mix with the counter.** `dragover` repeats for
  // as long as the drag is held, so a missed enter costs nothing and a stray `dragleave` from a
  // child is undone on the next frame. With ordinary enters this line never fires.
  if (dragDepth.value === 0) dragDepth.value = 1
  // ⛔ **`preventDefault` on dragover is what makes this a drop TARGET.** Without it the `drop`
  // event never fires here at all and the drag falls through to the window.
  // ⚠️ **That fall-through is safe by RULE, not by measurement** (corrected reviewing this diff).
  // `218` §1's probe returned INCONCLUSIVE — a synthesised drop performs no default action, proven
  // with a URL control, so it could not observe what a real one would do. What is decidable is
  // asserted instead, in `window-navigation.test.ts`: a dropped file is not this window's document,
  // so the navigation is refused and no conversation is released; and `externalTarget` is
  // http/https-only, so it is not handed to the browser either. Safe is not the same as useful.
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  event.preventDefault()
}

function onDragLeave(): void {
  if (dragDepth.value > 0) dragDepth.value -= 1
}

/**
 * ⛔ **The drop** — resolve first, then everything else.
 *
 * ⚠️ **`dataTransfer.files` is read SYNCHRONOUSLY, before any `await`.** The list is only valid
 * while the event is being dispatched; an `await` first and it comes back empty. That is why the
 * paths are all resolved up front and only the classification is asynchronous.
 *
 * ⛔ **A path we cannot get is REFUSED with a reason** (acceptance 5). `getPathForFile` answers `''`
 * for dragged text, a URL, an image from a web page, a file on a remote volume — things that look
 * like files to the browser and are not files on this machine. `106`/`118`: the gesture is not
 * allowed to happen and then quietly do nothing.
 *
 * ⛔ **A dropped FOLDER is one path** (§3). It arrives as one `File` with a path, main classifies it
 * `directory`, and nothing anywhere enumerates it. `webkitGetAsEntry` and `readEntries` — the APIs
 * that would walk it — are on the census's denylist for this file.
 */
async function onDrop(event: DragEvent): Promise<void> {
  dragDepth.value = 0
  if (!canStage.value) return
  const dropped = Array.from(event.dataTransfer?.files ?? [])
  if (dropped.length === 0) return
  const { paths, pathless } = pathsIn(dropped)
  await acquire(async () => {
    const verdicts = await classify(paths)
    // The generic sentence goes LAST so a real path's specific refusal — which names it — wins the
    // one slot on screen.
    return pathless === 0 ? verdicts : [...verdicts, { refusal: pathlessRefusal(pathless) }]
  })
}

/**
 * ⛔ **Which of these `File`s are files on THIS machine — SYNCHRONOUSLY** (254 §2).
 *
 * ⚠️ **Written out twice, this was the same eleven lines in two handlers** — and `216`'s mutation
 * table said so out loud: three rows that had been protecting `onDrop` matched in two places at
 * once the moment the paste was written, which is a duplicate reported by an instrument rather than
 * by a reviewer. ⚑ One copy means one rule: the same `''`-means-no-path discriminator for a drag, a
 * Finder copy, and a screenshot.
 *
 * ⛔ **Split from {@link classify}, and the split is the fix for a real ordering defect** (found by
 * two review angles). Both facts here are readable without an `await`, and the PASTE needs the
 * pathless count BEFORE it asks main to look at the clipboard: with the round trip first, a
 * `handDroppedPaths` that took seconds on a stalled mount left a window in which a clipboard manager
 * — or macOS Universal Clipboard — could put something else on the pasteboard, and main would write
 * and stage THAT. ⚠️ The chip deliberately shows no filename and no preview, so the substitution
 * would have been invisible by design.
 *
 * ⛔ **`pathless` is returned rather than turned into a sentence here**, because the two gestures
 * owe DIFFERENT sentences for it: a drop of dragged text is *"that is not a file on this machine"*,
 * and a paste with no path is the ordinary case of a screenshot, which is the whole feature.
 */
function pathsIn(files: readonly File[]): { paths: string[]; pathless: number } {
  const paths: string[] = []
  let pathless = 0
  for (const file of files) {
    const path = window.api.pathForDroppedFile(file)
    if (path === '') {
      pathless += 1
      continue
    }
    paths.push(path)
  }
  return { paths, pathless }
}

/** ⛔ What main says these paths are — the one door, for every gesture that has one to ask about. */
async function classify(paths: readonly string[]): Promise<DroppedPathVerdict[]> {
  return paths.length === 0
    ? []
    : await window.api.handDroppedPaths({ paths: [...paths], cwd: props.cwd })
}

/**
 * # ⛔ Paste it into the composer (254 §2)
 *
 * Clipboard screenshots use {@link stage}, the same path as the picker and drop. `one-way-to-stage.test.ts` checks that all gestures converge there.
 *
 * ## ⛔ Two clipboards, told apart by the ONE question this side is allowed to ask
 *
 * ⚠️ **A file copied in Finder and a screenshot on the clipboard both arrive as `File` objects**,
 * and only one of them is a file on this machine. `pathForDroppedFile` answers `''` for the other —
 * the same discriminator {@link onDrop} already uses for dragged text and web images — so:
 *
 *  - **it has a path** → it is a drop by another gesture, and it goes through `handDroppedPaths`
 *    with no bytes touched anywhere. ⚑ **Better than writing a copy**: the file already exists, and
 *    inventing a second one would hand the agent a path nobody could find again.
 *  - **it has none** → main reads the clipboard itself. ⛔ **The renderer never looks at the bytes**,
 *    and could not: `.arrayBuffer()` and `FileReader` are on `no-byte-authority.test.ts`'s denylist
 *    for this file. Whether that entry is a picture is main's answer, from the clipboard, once.
 *
 * ⛔ **`preventDefault` is deliberately NOT called**, and that is a decision rather than an omission.
 * A textarea takes text and ignores everything else, so an image paste inserts nothing on its own;
 * a clipboard carrying BOTH an image and text (which plenty of apps write) would lose the text if
 * this swallowed the event. ⚑ Staging is additive — the picture becomes a chip, the words land in
 * the box, and neither gesture takes anything from the other.
 */
async function onPaste(event: ClipboardEvent): Promise<void> {
  // ⛔ **"This surface cannot attach" and "this message has no room" are DIFFERENT facts, and this
  // guard used to answer both with silence** (292 §4, from `288` M3).
  //
  // ⚠️ **It read `canStage`, which folds the ceiling in** — so at ten staged, ⌘V with a screenshot
  // returned here: no file written (right), no chip, no refusal, and — because an image-only paste
  // inserts no text either — **the entire gesture disappeared**. `106` in the shape this whole
  // feature's refusal path exists to avoid, on the one gesture with no control of its own to grey.
  //
  // ⚑ **The ceiling is not re-implemented here; it is let through to the rules that already own
  // it.** `room` below is already `≤ 0` at the ceiling, so main is never asked for the picture and
  // {@link stageVerdicts} answers with the same `noRoomForPastedImage()` the nine-files-plus-paste
  // case produces — one sentence, from one place, for one fact.
  //
  // ⚠️ **The DROP is deliberately still gated on `canStage`, and it is not the same defect**: it
  // has an affordance, and at the ceiling that affordance is withheld — `dropping` is false, so the
  // composer never says *"Drop to attach"* over a drop it would refuse. A paste has nothing to
  // withhold, which is exactly why silence reads as breakage.
  if (!props.canAttach || !canType.value) return
  // ⚠️ **Read SYNCHRONOUSLY, before any `await`** — `clipboardData` is only valid while the event is
  // being dispatched, for the same reason `dataTransfer.files` is in {@link onDrop}.
  const pasted = Array.from(event.clipboardData?.files ?? [])
  // ⛔ **TEXT WINS, and this is a correction from the review.** A pathless `File` was taken as
  // *"a screenshot"*, and it is not: copying a range out of Numbers, a table out of a web page or a
  // block out of Word puts plain text AND a picture of it on the pasteboard, and Chromium hands both
  // over. ⚠️ **Every one of those pastes would have staged a bitmap of the thing the person was
  // pasting as words** — with a chip that says only *"an image you pasted"*, no filename and no
  // preview, so there was nothing on screen that could have told them. ⚑ A textarea takes text, so
  // when the clipboard has text that is what ⌘V meant; the picture is only the payload when it is
  // the ONLY payload.
  // ⚠️ **NON-EMPTY text, not merely the flavour's presence** (review). Clipboard managers, Universal
  // Clipboard and several capture tools re-put an image with an empty `text/plain` beside it — and a
  // discriminator that read only `types` swallowed those pastes in total silence: no chip, no
  // refusal, no IPC, which is the `106` failure the rest of this gesture is built to avoid.
  const carriesText = (event.clipboardData?.getData('text/plain') ?? '').trim() !== ''
  if (pasted.length === 0) return
  const { paths, pathless } = pathsIn(pasted)
  // ⛔ **The ceiling is checked BEFORE main is asked to write anything** (review). `stage()` still
  // owns the ceiling; this is a precondition on the SIDE EFFECT, because a paste refused after the
  // write leaves a PNG on disk that no chip, no draft and no transcript ever referenced.
  // ⚠️ Deliberately conservative — `paths.length` counts entries that may yet be refused — because
  // the safe error is not writing a file we had room for, and the person is told either way.
  const room = MAX_HANDED_PATHS - staged.value.length - paths.length
  // 🔴 **The slot is reserved HERE, before main is asked anything** (262 §1). Everything above this
  // line is synchronous by rule — the clipboard is only readable while the event is dispatching —
  // and everything below it is an await, which is precisely the interval a Send used to cross.
  await acquire(async () => {
    // ⛔ **Main is asked about the CLIPBOARD first, and about the paths second.** It is the same
    // pasteboard a moment later either way, and the ordering keeps the window as small as this side
    // can make it — see {@link pathsIn}.
    const image =
      pathless === 0 || carriesText
        ? []
        : room > 0
          ? [await window.api.pasteImage({ cwd: props.cwd })]
          : [{ refusal: noRoomForPastedImage() }]
    const verdicts = await classify(paths)
    // ⛔ **One picture, because `clipboard.readImage()` is one answer** — and the rest are SAID
    // rather than dropped in silence (`106`, and `232` §3's own correction to the drop's ceiling).
    const extra =
      pathless > 1 && !carriesText ? [{ refusal: onlyOnePastedImage(pathless - 1) }] : []
    return [...verdicts, ...image, ...extra]
  })
}

function pathlessRefusal(count: number): string {
  return count === 1
    ? 'that is not a file on this machine — drop a file or a folder, not text or a picture from a web page'
    : `${count} of those are not files on this machine — drop files or folders, not text or pictures from a web page`
}

/** ⛔ §2's undo: remove one before send, by the path it names. */
function detach(path: string): void {
  attachRefusal.value = null
  // ⚠️ From {@link staged}, so a detach pressed while a drop is still resolving removes from the
  // list that drop is about to add to — rather than from a list one tick out of date, which would
  // put the detached file back (236 §4, and 292 §2 made "one tick out of date" unrepresentable).
  props.handing.stage(staged.value.filter((each) => each.path !== path))
}

/** The last segment, for the chip — the whole path is the `title` and the message's own words. */
/**
 * ⛔ **Whether a folder has been settled on at all** (217 §2).
 *
 * ⚑ Only the LAUNCHER can honestly be here: a live conversation's cwd is fixed when it starts, and
 * `ConversationPane` reads it off the session. A blank cwd on that surface would be a defect
 * upstream, and this caption — which claims nothing — is the right thing to show for it too.
 */
const cwdKnown = computed(() => props.cwd.trim() !== '')

/**
 * # ⛔ One row of the chip strip, decided ONCE (254 §2)
 *
 * ⚠️ **Nobody named a pasted image.** Every other chip here shows the last segment of a path a
 * person pointed at, so the label is a thing they recognise because they chose it. A screenshot has
 * no name until BroBot invents one, and showing `pasted-a3f9….png` would present an invention as
 * their choice — §2 asks for the difference to be visible, and this is where it is.
 *
 * ## ⛔ The authority is the PATH, not a flag the renderer carries
 *
 * ⚑ **`isPastedImage` is a shared function main and this side both use** — main builds the name,
 * this reads it — which is `197`'s remedy rather than `197`'s defect. Three things the first
 * version got wrong, all found by the adversarial pass and all fixed by the same move:
 *
 *  - **the queue.** `overTheWire` maps `HandedPath` field by field, so a screenshot queued behind a
 *    running turn and then *"put back in the composer"* came back with no flag — and the chip
 *    reverted to the invented filename, the file glyph and *"Don't send /…/pasted-a3f9….png"*: the
 *    three things §2 forbids, through one ordinary gesture.
 *  - **the caption wire.** `app:classify-attachments` applies no schema, so a flag on ANY path came
 *    back wearing main's authority and made an arbitrary file read as a screenshot.
 *  - **the altitude.** `pasted` was the one field on `HandedPath` main could not re-derive, which is
 *    that record's whole contract (232 §1). It is a DECORATION now: the measurements are shown only
 *    on a path that already says what it is, so a forged one decorates nothing.
 *
 * ⛔ **`outside` is suppressed for a paste**, and that is the one thing this hides on purpose.
 * `216` §2 made that mark the thing a person checks a handover of THEIR OWN choosing against; a
 * pasted image is somewhere BroBot picked, so the mark answers a question nobody asked and fires on
 * 100% of the gesture — which is `234` §4's *"a label that cries wolf teaches people to stop reading
 * it"*, arriving by construction rather than by an edge case. ⚑ The message to the model and the
 * transcript still carry it: what is dropped is the nag, not the record.
 */
interface Chip {
  handed: HandedPath
  pasted: boolean
  label: string
  glyph: string
  detach: string
  outside: 'none' | 'no-folder' | 'outside'
  /**
   * 🔴 **744 · R100 — a restored draft names a path that is no longer there** (`HandedPath.missing`,
   * main's caption at the restore). ⚑ Said on the chip rather than the chip vanishing: the message
   * came back as it was left, and the person decides what to do about the part that went.
   */
  missing: boolean
}

const chips = computed<Chip[]>(() =>
  staged.value.map((handed) => {
    // ⚠️ **`kind` as well as the name.** The name is main's own and nothing a renderer can invent —
    // but a FOLDER called `pasted-<32 hex>.png` is a legal thing to attach, and it would otherwise
    // wear the image glyph and lose the label that says it is a folder. ⚑ `kind` comes from `stat`,
    // so the two facts together are decidable rather than merely likely.
    const pasted = handed.kind === 'file' && isPastedImage(handed.path)
    return {
      handed,
      pasted,
      label: pasted ? pastedImageLabel(handed.pasted) : pathTail(handed.path) || handed.path,
      glyph: pasted ? '#i-image' : handed.kind === 'directory' ? '#i-folder' : '#i-file',
      // ⛔ **The undo names the same thing the label does.** *"Don't send
      // /Users/…/pasted-images/pasted-a3f9….png"* is a sentence about a file the person has never
      // seen the name of, on the one control that exists to let them change their mind — `106`'s
      // complaint the other way round: words that do not describe what pressing it undoes.
      detach: pasted ? 'Don’t send the image you pasted' : `Don’t send ${handed.path}`,
      // 🔴 **The `outside` mark is NOT suppressed for a paste — reverted** (found reviewing the fix
      // that suppressed it). ⚠️ The argument for hiding it was `234` §4's *"a label that cries wolf
      // teaches people to stop reading it"*: BroBot chose the location, so the mark answers a
      // question nobody asked and fires on 100% of the gesture. ⛔ **But `pasted` is decided by a
      // NAME, and a name is forgeable** — so suppressing it meant any file called
      // `pasted-<32 hex>.png`, picked or dropped from anywhere, lost the one disclosure `216` §2
      // exists for. ⚑ A caption may be approximately right; a DISCLOSURE may not, and the two are
      // not mine to trade. The mark is true here, and it stays.
      outside: !cwdKnown.value ? 'no-folder' : handed.outsideCwd ? 'outside' : 'none',
      missing: handed.missing === true,
    }
  }),
)

/**
 * The box itself — held for {@link focus} and for nothing else (435).
 *
 * ⚠️ **Not a second channel for the text.** `v-model="text"` is still the only thing that writes
 * it; this handle exists so the surface that mounted this composer can put the CARET here without
 * reaching into another component's DOM by `data-cy`, which is what the alternative looked like.
 */
const box = ref<HTMLTextAreaElement | null>(null)

function onEnter(event: KeyboardEvent): void {
  if (isSendShortcut(event)) {
    event.preventDefault()
    // Shift picks the destructive one. Read off the same event that decided this was a send, so
    // the chord and the outcome cannot come from two different readings of the keyboard.
    // ⚠️ `void`, because {@link send} may now WAIT for this draft's attachments (262 §1) — the
    // keydown handler has nothing to do with the answer and returning a promise into it would make
    // Vue report an unhandled rejection for a send that was simply refused.
    void send(event.shiftKey)
  }
  // Plain Enter falls through to the textarea's default: a newline, focus kept.
}

// No `fill()` expose any more: putting text in the box is writing the conversation's draft, which
// the caller now owns. A second way in would be a second place for the text to live.

/**
 * 🔴 **Put the cursor here** (435, HO-025 §5) — an ACT, not a second way in.
 *
 * ⛔ **The line above is about `fill()` and it still stands.** That expose was a second place for
 * the words to live; this one moves nothing and holds nothing — it is the same gesture a person
 * makes with a click, made by the surface that mounted this composer.
 *
 * ⚑ **Exposed rather than done here on mount, because only ONE of this component's mounts wants
 * it.** HO-025's property is about the front door: *"Defaults applied, composer focused, the
 * choices present and out of the path."* A composer that focused itself would also steal the
 * caret every time a conversation opened, which is a change to a surface nobody asked about — and
 * `composer-parity` exists to keep the two mounts differing only in what they are handed.
 *
 * ⚠️ **Optional-chained, because the box is absent until the first paint** and a caller may reach
 * for this from `onMounted` before Vue has flushed — `CommandPalette` wraps its own call in a
 * `nextTick` for the same reason.
 */
defineExpose({
  focus(): void {
    box.value?.focus()
  },
})
</script>

<template>
  <!-- The BAND the composer sits in, hooked so the smoke can compare what it is painted on against
       the header at the other end of the conversation (080). The two are the top and bottom edges
       of one reading surface, and a run where they disagree is a theme scope that lost one of
       them — which is a thing you see instantly and no SSR test can. -->
  <div class="composer-wrap" data-cy="composer-band">
    <!-- ⚠️ `@submit` calls `send()`, not `send` — the handler takes an argument now. Bound bare, Vue
         would pass the SubmitEvent as `interrupting`, and an object is truthy: every press of the
         QUEUE button would have interrupted the turn instead of waiting for it. The typechecker
         caught it, which is the only reason it is not in this commit. -->
    <!-- ⛔ **The drop target is the WHOLE composer** (218 §2), not a separate well. The thing you
         are attaching to is the message, and the message is this box — a strip you have to aim at
         would be a second place to put a file, which is `216`'s chip strip problem in reverse.
         ⚠️ The handlers are inert unless `canStage`: a mount without the paperclip does not
         silently accept drops, which is the same opt-in the button has. -->
    <!-- ⛔ **`frozenLook`, not `state === 'frozen'`** (234 §2, found in review). The amber is
         `tokens.css`'s *"an in-flight run is frozen on YOU"* colour, and a closing conversation now
         reads the CLOSING sentence in the foot — so the paint has to follow the sentence, or the
         composer says one thing in words and the opposite in colour. -->
    <form
      class="composer"
      :class="{
        frozen: frozenLook,
        busy: state === 'busy',
        starting: state === 'starting',
        dropping,
      }"
      @submit.prevent="send()"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
      @paste="onPaste"
    >
      <!-- Show staged attachment paths above and separate from the text field. Paths appended to the provider prompt are app-supplied context and must be visible without appearing to be text the person typed. -->
      <ul v-if="staged.length > 0" class="attached" data-cy="composer-attachments">
        <li
          v-for="chip in chips"
          :key="chip.handed.path"
          :data-kind="chip.handed.kind"
          :data-pasted="String(chip.pasted)"
        >
          <svg class="icon">
            <!-- ⛔ **A third glyph, because there is a third thing** (254 §2). A paste is still a
                 `file` to `kind` — that is what `stat` says and what the agent will read it as —
                 so the icon is the one place the difference can show without lying about the type. -->
            <use :href="chip.glyph" />
          </svg>
          <span class="what" :title="chip.handed.path" :data-cy="`attached-${chip.handed.kind}`">{{
            chip.label
          }}</span>
          <!-- 🔒 Outside the cwd is allowed — every folder is (`726` · R92) — and SAID, so the
               agent's own permission card is not the first place anybody notices.
               ⛔ **Three states, not two** (217 §2). With NO folder chosen there is nothing to be
               outside OF, and `outsideWorkingDirectory` answers `true` for a blank cwd by design
               ("an unknown cwd counts as OUTSIDE") — so a two-state chip would mark every single
               attachment `outside` on the launcher's commonest case and be lying about a directory
               the person has not picked yet. The honest sentence is the one that says less.
               ⚠️ **…and a FOURTH state since 254 §2: a pasted image says nothing at all**, because
               the person did not choose where it went. See {@link Chip}. -->
          <em v-if="chip.outside === 'no-folder'" class="outside" data-cy="attached-no-folder"
            >no folder yet</em
          >
          <em v-else-if="chip.outside === 'outside'" class="outside" data-cy="attached-outside"
            >outside</em
          >
          <!-- 🔴 **744 · R100 — gone since the draft was kept.** ⚑ Beside the outside mark rather
               than instead of it: both are true. ⚠️ A caption, not a refusal — but the send IS
               refused, whole and by name, while the path is still gone (`recheckHandedPaths`), and
               the words come back; the title says so rather than implying the rest would go. -->
          <em
            v-if="chip.missing"
            class="missing"
            data-cy="attached-missing"
            :title="MISSING_ON_RESTORE"
            >missing</em
          >
          <button
            type="button"
            class="detach"
            :title="chip.detach"
            :data-cy="`detach-${chip.handed.kind}`"
            @click="detach(chip.handed.path)"
          >
            ×
          </button>
        </li>
      </ul>
      <!-- ⛔ **The beat a Send now waits for, said out loud** (262 §1). {@link send} holds the
           message until this draft's attachments have arrived, and a press that appears to do
           nothing for a moment is `106`'s complaint whatever the reason — so the reason is on
           screen. ⚑ Not a spinner and not a disabled button: nothing here is broken and the press
           is not refused, it is queued behind a file being written.
           ⚠️ **`polite`, not `alert`.** The refusal below interrupts because something went wrong;
           this is ordinary progress and does not deserve to cut across what a screen reader is
           already saying. -->
      <p v-if="acquiringNow" class="attaching" role="status" data-cy="composer-acquiring">
        Saving what you attached — Send waits for it
      </p>
      <p v-if="attachRefusal" class="attach-refused" role="alert" data-cy="attach-refused">
        {{ attachRefusal }}
      </p>
      <!-- ⛔ **Say what letting go will do, WHILE you are still holding it** (218 §2). A border that
           changes colour tells you something is happening; it does not tell you what. ⚑ Painted in
           `--accent`, the app's blue for *"this is live"* — deliberately NOT amber, which
           `tokens.css` reserves for *"an in-flight run is frozen on YOU"*, and deliberately no new
           token: nothing here is a state the grammar does not already have. -->
      <p v-if="dropping" class="dropping-here" data-cy="composer-drop-target">
        Drop to attach — the agent reads it, BroCrew does not
      </p>
      <textarea
        ref="box"
        v-model="text"
        rows="1"
        :disabled="!canType"
        :placeholder="
          state === 'frozen'
            ? 'The agent is frozen — answer above to continue…'
            : state === 'starting'
              ? // Not `${who} is working` — nothing is working yet. The message that was typed here
                // is already in flight; the foot says so, and offers the way out.
                'Opening the conversation…'
              : state === 'busy'
                ? // It used to read `${who} is working…`, which was the right thing to say about a
                  // field you could not type in. Now you can, so it says what typing here will do.
                  // ⚑ **D-010** — and whatever already waits: a second is queued behind it.
                  `${who} is working — type to queue a message…`
                : placeholder
        "
        data-cy="prompt-input"
        @keydown.enter="onEnter"
      ></textarea>

      <!-- ⚠️ **While a turn runs, what the buttons are depends on whether you have typed anything
           (077).** With an empty box the only thing you can want is to take the turn back, so the
           stop button stands alone as it did in 074. The moment there is text, there are two
           different things you might mean by sending it, and BOTH are rendered — the choice has to
           be visible at the moment of pressing rather than hidden behind knowing a chord.

           Wrapped in one element so the form's grid keeps its two columns whether there is one
           button here or two; a third grid child would wrap onto its own row. -->
      <div class="actions">
        <!-- ⛔ **The control `213` was missing** (216 §2). OUTSIDE the send/interrupt v-if chain —
             it is not one of the three things the primary button can be, it is a second control that
             is always there while you can type. (Put inside the chain it silently broke it: the Vue
             compiler caught what `vue-tsc` did not.) Disabled at the ceiling with the reason on it,
             never silently ignoring the press (106). -->
        <button
          v-if="canAttach"
          type="button"
          class="attach-button"
          :disabled="!canStage"
          :title="
            staged.length >= MAX_HANDED_PATHS
              ? `One message can carry ${MAX_HANDED_PATHS} attachments`
              : !canType
                ? // ⛔ Found in 216's review: this control has TWO disabled causes and the tooltip
                  // described only the ceiling, so a greyed paperclip explained what it would do
                  // if it worked (106, 118). ⚠️ Worded for BOTH mounts since 217 — the launcher
                  // greys it while a launch is in flight, and there is no conversation there to
                  // talk about.
                  'Not right now — this is busy'
                : // ⚑ **The paste has no control of its own, so the one control there IS names it**
                  // (254 §2). A gesture nothing on screen mentions is a gesture only the person who
                  // built it knows about — `213` is the dispatch about exactly that, from the other
                  // end. ⚠️ The two existing assertions match on the prefix, deliberately left
                  // intact so this reads as an addition rather than a replacement.
                  'Attach a file or folder for the agent to read — or paste a picture'
          "
          data-cy="attach-path"
          @click="attach"
        >
          <svg class="icon"><use href="#i-paperclip" /></svg>
        </button>
        <!-- ⛔ **`blocked === null`, and 219 is what put it there.** Both controls in here CARRY A
             MESSAGE — one queues it behind the running turn, the other asks the turn to stop and sends
             it once the turn has ended (`739`: it said *stops the turn and sends it instead*) — and the host refuses both on the same gate a plain send passes
             (`assertCanTakeTurn(session, 'queue')`, and twice for the interrupting one). So with a
             reason in hand they cannot act, and `canSend` already refuses them: left rendered, they
             were lit, full-accent, and pressing either did NOTHING AT ALL — no message, no error, no
             sound. That is 106's *"no control that cannot act"* in its worst form, and it is the
             defect 219 was dispatched to remove rather than to move one branch over.

             ⚑ **Removed rather than greyed, because something better belongs in the slot.** These
             two REPLACE the stop button while there is something to send — words OR a staged file
             since 234 §2, and this sentence said "text" until then. Greying them out would leave a
             busy turn with no stop control at all and only Esc, which is exactly 094's finding.
             Falling through to `canInterrupt` puts the plain stop back — the one gesture that still
             works, because interrupting needs no credential — and the reason the message cannot go
             is in the foot, where 169 put it. -->
        <!-- ⛔ **`busyChoices`, not `text.trim() !== ''`** (234 §2). See its docblock: a staged file
             with an empty box is content, and this selector was the last place in the app that
             still disagreed. -->
        <template v-if="busyChoices">
          <button
            class="queue-button"
            :class="{ secondary: stopWordOnly }"
            type="submit"
            :title="
              props.hasQueued
                ? `Let ${who} finish, then send this with what is already waiting — a command goes alone (${sendKey})`
                : `Let ${who} finish, then send this (${sendKey})`
            "
            data-cy="queue-prompt"
          >
            <svg class="icon"><use href="#i-clock" /></svg>
            Queue <kbd>{{ sendKey }}</kbd>
          </button>
          <!-- A box holding only "stop" means stop the turn, not queue the word or send it. -->
          <button
            v-if="stopWordOnly"
            class="stop-now-button"
            type="button"
            :title="`Stop — ${A_STOP_ASKS_THE_TURN} (Esc)`"
            data-cy="stop-now"
            @click="emit('interrupt')"
          >
            <svg class="icon"><use href="#i-square" /></svg>
            Stop now
          </button>
          <button
            v-else
            class="interrupt-send-button"
            type="button"
            :title="`Stop and send — ${A_STOP_THEN_THIS_IS_SENT} (${interruptKey})`"
            data-cy="interrupt-send-prompt"
            @click="send(true)"
          >
            Stop and send <kbd>{{ interruptKey }}</kbd>
          </button>
        </template>
        <!-- ⚠️ `canInterrupt`, not `state === 'busy'` (094). A turn frozen on a card is the one a
             user most needs to be able to abandon, and it was the one they could not.
             🔴 **737 · `730` F-3 — each title says what the press does, in R43's words**
             (`A_STOP_ASKS_THE_TURN`): it read *"Interrupt the running turn"* and *"Stop the turn
             instead of answering"*, claims a provider that finishes the turn anyway makes false. -->
        <button
          v-else-if="canInterrupt"
          class="interrupt-button"
          type="button"
          :title="
            state === 'frozen'
              ? `Stop instead of answering — ${A_STOP_ASKS_THE_TURN} (Esc)`
              : props.stopUnanswered !== null
                ? `${props.stopUnanswered} (Esc)`
                : `Stop — ${A_STOP_ASKS_THE_TURN} (Esc)`
          "
          data-cy="interrupt-session"
          @click="emit('interrupt')"
        >
          <svg class="icon"><use href="#i-square" /></svg>
        </button>
        <!-- ⛔ **`blocked` disables it, and 169 is the dispatch that says why in one line**: the
             PM typed `../../escape` as a profile name, and Send sat there enabled over a rule the
             app had already printed and would already have enforced. The reason is in the foot
             below AND on the control, because a `title` is the one explanation that is where the
             pointer already is. -->
        <!-- ⛔ **223 · `!canSendNow`, so the button asks what the send paths ask.** It read
             `!canType || blocked !== null` and had never asked about CONTENT — lit and inert on an
             empty box, which is the state the app is in most of the time. See {@link canSendNow}.

             ⛔ **And the tooltip is DERIVED from that same answer** — {@link sendRefusal}, which
             returns null while the button is lit and the reason while it is dark. The first version
             of 223 wrote the reason as a second ternary here, and the two chains disagreed on the
             first state neither of them enumerated: an `ended` conversation read *"Type a message"*
             over a locked box. One evaluation, so a dark button always has a sentence and a lit one
             never does. -->
        <button
          v-else
          class="send-button"
          type="submit"
          :disabled="!canSendNow"
          :title="sendRefusal ?? `Send (${sendKey})`"
          data-cy="send-prompt"
        >
          <svg class="icon"><use href="#i-send" /></svg>
        </button>
      </div>
    </form>

    <!-- ⚠️ **The foot is a ROW now, and the hint is still the only thing in it most of the time**
         (103). 101 put the launcher's Cancel here — *"in the composer foot, where the launch action
         lives and where its 'Starting the session…' feedback appears — one clear place, right where
         you're looking, with a way out"* — and specified ONE slot rather than a second in the
         header. The row carries the measure and the centring the hint used to carry itself, so with
         no button beside it the rendered result is what it was before. -->
    <div class="composer-foot">
      <p class="composer-hint" :class="{ frozen: frozenLook }" data-cy="composer-hint">
        <!-- ⛔ **First, and it outranks the state's own sentence** (169 §1). Every other branch here
             answers *"what does pressing send mean from this state"*; this one answers *"it will not
             happen, and here is what to fix"*, which is the only sentence worth reading when it is
             true.

             ⚠️ **BOTH callers set it now, and both withhold it in the states whose own sentence is
             the better one** (219 §1). The launcher withholds it while a launch is in flight, so the
             launch keeps its own feedback; the pane withholds it while the composer is `frozen` or
             `ended`, because a card waiting to be answered and a conversation that is over are each
             more actionable than the reason the caller has — and `canSend` refuses both anyway, so
             nothing is left un-gated by the silence. Reachable from `idle` and `busy`. -->
        <template v-if="blocked !== null">{{ blocked }}</template>
        <!-- The frozen hint names BOTH ways forward now (094). It used to name only one, and the
           other one did not exist. 🔴 **737 · `730` F-3** — and the second says what Esc does in
           R43's words: it said *"Esc stops the turn"*. -->
        <template v-else-if="state === 'frozen'">
          Answer the request above to continue. A message won't answer it<template
            v-if="canInterrupt"
            >, but <strong>Esc</strong> is Stop: {{ A_STOP_ASKS_THE_TURN }}</template
          >.
        </template>
        <!-- The two outcomes, spelled out at the moment they become available (077). Only shown once
           there is something to send — which since 234 §2 means words OR a staged file, asked
           through the one predicate rather than restated here. -->
        <!-- 🔴 **D-010 · several may wait** — and since D-027 they go together, in one turn, oldest
             first: this one goes after what already waits, whoever wrote it, in the same turn. ⛔
             Except a command, which the host sends alone (`R42`), so the foot says so, and so does
             the Queue button's title. -->
        <template v-else-if="busyChoices && props.hasQueued">
          <strong>{{ sendKey }}</strong> to send when {{ who }} finishes, with what is already
          waiting — a command goes alone · <strong>{{ interruptKey }}</strong> is Stop and send:
          {{ A_STOP_THEN_THIS_IS_SENT }}
        </template>
        <template v-else-if="busyChoices">
          <strong>{{ sendKey }}</strong> to send after {{ who }} finishes ·
          <strong>{{ interruptKey }}</strong> is Stop and send: {{ A_STOP_THEN_THIS_IS_SENT }}
        </template>
        <!-- ⚠️ **Both halves of this sentence are about a TURN** — Escape is bound by
             `ConversationPane` and nowhere else, and there has to be a turn to queue behind. 102
             found it lit on the launcher and gated it on a descriptor; `starting` is now a state of
             its own and cannot reach this branch at all. -->
        <!-- 🔴 **730 · R83** — see `stopUnanswered`: a press here joins the standing ask. ⚠️ **730
             review** — ⚑ since D-010 *type to queue* whatever already waits. -->
        <template
          v-else-if="state === 'busy' && props.interruptible && props.stopUnanswered !== null"
        >
          {{ props.stopUnanswered }}. <strong>Esc</strong> is Stop; type to queue a message.
        </template>
        <!-- 🔴 **737 · `730` F-3** — R83's foot's shape, one fact over: what is happening, then what
             Esc does in R43's words. It said *"…or press Esc to interrupt the turn"*. ⚑ And *type to
             queue*, whatever already waits (D-010). -->
        <template v-else-if="state === 'busy' && props.interruptible">
          {{ who }} is working — type to queue a message. <strong>Esc</strong> is Stop:
          {{ A_STOP_ASKS_THE_TURN }}.
        </template>
        <template v-else-if="state === 'busy'">{{ who }} is working…</template>
        <!-- The launch's own feedback, beside its own way out (101 §8). -->
        <template v-else-if="state === 'starting'">
          {{ who }} is starting this conversation…
        </template>
        <template v-else
          ><strong>{{ sendKey }}</strong> to send · <strong>Enter</strong> for a new line</template
        >
      </p>

      <!-- ⚠️ **`cancel-launch`, deliberately NOT `interrupt-session`** (102). `startSession` in
           `ui-live-smoke.mjs` *"keeps returning while the app is still on the launcher — 25 steps
           are written against that"*, and a quarter of that smoke waits on `interrupt-session` to
           mean "a turn is running". A launcher rendering that name would answer those waits
           instantly, on a surface with no turn on it. It is labelled rather than a glyph because it
           is the only control in this row and 101 asked for one that reads as a way out. -->
      <button
        v-if="state === 'starting'"
        class="cancel-launch"
        type="button"
        title="Stop opening this conversation"
        data-cy="cancel-launch"
        @click="emit('interrupt')"
      >
        <svg class="icon"><use href="#i-x" /></svg>Cancel
      </button>
    </div>
  </div>
</template>

<style scoped>
.composer-wrap {
  flex: 0 0 auto;
  padding: var(--space-8) var(--space-12) var(--space-6);
  border-top: var(--border-width) solid var(--line);
  background-color: var(--composer-surround-color, var(--panel));
  background-image: var(--composer-surround-image, none);
  background-position: var(--composer-surround-position, 0% 0%);
  background-repeat: var(--composer-surround-repeat, repeat);
  background-size: var(--composer-surround-size, auto);
  image-rendering: var(--composer-surround-rendering, auto);
}

.composer-wrap > * {
  image-rendering: auto;
}

.composer {
  display: grid;
  min-height: var(--space-24);
  max-width: var(--measure-message);
  align-items: end;
  margin: 0 auto;
  padding: var(--space-6);
  border: var(--border-width) solid var(--composer-field-line, var(--control-border));
  border-radius: var(--radius-card);
  background: var(--composer-field-bg, var(--panel));
  gap: var(--space-4);
  grid-template-columns: minmax(0, 1fr);
  box-shadow: var(--shadow-card);
}

/* Grow with the draft up to eight lines, then scroll inside the field. */
.composer textarea {
  --line: calc(var(--type-reading) * var(--leading-reading));
  --pad-block: var(--space-2);
  width: 100%;
  max-height: calc(8 * var(--line) + 2 * var(--pad-block));
  padding: var(--pad-block) var(--space-2);
  border: 0;
  background: transparent;
  color: var(--composer-field-ink, var(--text));
  field-sizing: content;
  font-family: inherit;
  font-size: var(--type-reading);
  line-height: var(--leading-reading);
  outline: none;
  overflow-y: auto;
  resize: none;
  scrollbar-color: var(--scrollbar-thumb) transparent;
  scrollbar-width: thin;
  min-height: calc(3 * var(--line));
}

.composer textarea::placeholder {
  color: var(--placeholder);
}

.composer.frozen {
  border-color: var(--composer-frozen-border);
  background: var(--composer-frozen-bg);
  opacity: 0.75;
}

.composer.frozen textarea {
  cursor: not-allowed;
}

.composer.busy textarea {
  color: var(--muted);
}

.composer.starting textarea {
  color: var(--text);
}

.attached,
.attach-refused,
.attaching,
.dropping-here {
  grid-column: 1 / -1;
}

.attaching {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
}

.composer.dropping {
  border-color: var(--accent-border);
  background: var(--accent-fill-strong);
}

.dropping-here {
  margin: 0;
  color: var(--accent-text);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}

.attached {
  display: flex;
  flex-wrap: wrap;
  margin: 0;
  padding: 0;
  gap: var(--space-3);
  list-style: none;
}

.attached li {
  display: flex;
  min-width: 0;
  align-items: center;
  padding: var(--space-1) var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--panel-3);
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-2);
}

.attached .icon {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  color: var(--faint);
}

.attached .what {
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attached .outside {
  color: var(--faint);
  font-style: normal;
}

.attached .missing {
  color: var(--danger);
  font-style: normal;
}

.detach {
  display: grid;
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: 1;
  cursor: pointer;
  place-items: center;
}

.detach:hover {
  background: var(--panel-2);
  color: var(--text);
}

.attach-refused {
  margin: 0;
  color: var(--danger-text);
  font-size: var(--type-caption);
}

.actions {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  width: 100%;
  justify-content: flex-end;
}

.send-button,
.interrupt-button,
.attach-button {
  display: grid;
  width: var(--control-icon);
  height: var(--control-h);
  border: 0;
  border-radius: var(--radius-md);
  place-items: center;
}

/* The worded choices: what a press does is read, not guessed from an icon. */
.queue-button,
.interrupt-send-button,
.stop-now-button {
  display: inline-flex;
  height: var(--control-h);
  align-items: center;
  padding: 0 var(--space-5);
  border-radius: var(--radius-md);
  font: inherit;
  font-size: var(--type-small);
  gap: var(--space-3);
  white-space: nowrap;
}

/* The shortcut keeps the button's full ink, for contrast; the bolder action word leads it. */
.queue-button,
.interrupt-send-button,
.stop-now-button {
  font-weight: var(--fw-semibold);
}

.queue-button kbd,
.interrupt-send-button kbd {
  font-family: inherit;
  font-size: var(--type-caption);
  font-weight: var(--fw-normal);
}

/* Stop now is the primary choice for a box holding only "stop", so it is filled. */
.stop-now-button {
  border: 0;
  background: var(--danger);
  color: var(--accent-ink);
}

.stop-now-button:hover {
  filter: brightness(1.08);
}

.queue-button {
  border: 0;
  background: var(--accent-solid-bg);
  color: var(--accent-ink);
}

/* Beside Stop now, queueing the word is the lesser choice. */
.queue-button.secondary {
  border: var(--border-width) solid var(--control-border);
  background: transparent;
  color: var(--text);
}

.queue-button:disabled {
  background: var(--wash-3);
  color: var(--faint);
}

.interrupt-send-button {
  border: var(--border-width) solid var(--danger-border);
  background: var(--danger-bg);
  color: var(--danger-text-pale);
}

.interrupt-send-button:hover {
  background: var(--danger-fill-hover);
}

.send-button {
  background: var(--accent-solid-bg);
  color: var(--accent-ink);
}

.send-button:disabled {
  background: var(--wash-3);
  color: var(--faint);
}

.interrupt-button {
  border: var(--border-width) solid var(--danger-border);
  background: var(--danger-bg);
  color: var(--danger-text-pale);
}

.interrupt-button:hover {
  background: var(--danger-fill-hover);
}

.icon {
  width: 14px;
  height: 14px;
}

.composer-foot {
  display: flex;
  max-width: var(--measure-message);
  align-items: center;
  margin: 0 auto;
  gap: var(--space-5);
}

.composer-hint {
  flex: 1;
  min-width: 0;
  margin: var(--space-4) 0 0;
  color: var(--muted);
  font-size: var(--type-caption);
  text-align: center;
}

.cancel-launch {
  display: inline-flex;
  height: 22px;
  flex: 0 0 auto;
  align-items: center;
  margin-top: var(--space-3);
  padding: 0 var(--space-4);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--wash-2);
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
  gap: var(--space-3);
}

.cancel-launch:hover {
  background: var(--wash-5);
  color: var(--text-soft);
}

.cancel-launch .icon {
  width: 11px;
  height: 11px;
}

.composer-hint.frozen {
  color: var(--waiting-text-hint);
}

.composer-hint strong {
  color: var(--muted);
  font-weight: var(--fw-semibold);
}

.attach-button {
  margin-right: auto;
}
.composer:focus-within {
  border-color: var(--accent);
}
</style>
