import type { TranscriptItem } from './transcript'

/**
 * What the app is allowed to say about plan mode (030).
 *
 * Extracted from the component on purpose. This copy is governed by a rule — plan mode must never
 * be described as a safety gate — and the rule can only be enforced on wording a test can reach.
 * Inside the component the yolo variant was only produced by a local ref no render test could set,
 * so the branch that says the most was the one branch never checked. Here both are plain values.
 *
 * ⚠️ **The claim being guarded against is the SDK's own.** The pinned SDK describes
 * `permissionMode: 'plan'` as *"Planning mode, no actual tool execution"*, and the 026 capture
 * measured the model performing a `Write` while in it — its `ExitPlanModeOutput.filePath` suggests
 * why, since it writes the plan out. Plan mode changes what the agent does FIRST. It does not
 * sandbox anything, and approvals remain the only thing gating an action.
 *
 * 056 turned that inference into a fact: in the app's own ledger the agent, in plan mode, wrote its
 * plan to a real file on disk and we raised a real file-write card for it. "No actual tool
 * execution" is the SDK's wording, not the behaviour, and this copy is the only place the product
 * gets to be straight about that.
 */

/*
 * ⛔ **`PLAN_MODE_LABEL` went with the control it labelled** (417, HO-022 §2). It read
 * `'propose first'` and it was the launcher checkbox's word; the front door asks for nothing now,
 * and plan mode is started from the agent card's Plan chip (`card-run-plan`), which writes its own.
 */

/*
 * ⛔ **`planModeTitle` and `PLAN_YOLO_NOTE` went with the two controls they described** (417,
 * HO-022 §2). The first was the launcher checkbox's tooltip — *"It is NOT a sandbox… chosen when
 * the session starts; it cannot be switched on later"* — and the second the note shown when plan
 * and yolo were armed together. ⛔ **Neither is rendered anywhere now**, and the launcher can no
 * longer arm either setting, so the combination they warned about is unreachable from the front
 * door. ⚠️ **The rule they carried is not gone**: *plan mode is not a safety gate* is asserted
 * against the surface that still says it, in `the-agent-panels-plan-and-approval-mode.dom.test.ts`,
 * over the agent card's `card-run-plan`. ⚑ Deleted rather than kept and swept, because copy
 * nothing renders is not copy — it is a sentence waiting to be believed by the next surface that
 * finds it.
 */

/**
 * The go-ahead (060) — the gesture that ends a planning conversation, in the three strings that
 * describe it.
 *
 * ⚠️ **This is the highest-risk copy in the feature, which is why it lives here beside the rule.**
 * The obvious word for it is "approve", and the obvious sentence is *"the agent can now act"* —
 * both of which say plan mode had been STOPPING it. It had not: a planning agent runs shell
 * commands on its way to proposing (057 measured one doing so, 026 measured Claude writing a file),
 * and the only thing standing between an agent and an action is the approval settings. So the copy
 * is written around what CHANGES — it stops proposing and starts doing — and never around what it
 * is now permitted to do.
 *
 * ⚠️ **And it must not be mistaken for the provider's own affordance.** No provider asks this
 * question; the app asks it. {@link GO_AHEAD_MESSAGE} is a real message this app sends on the
 * user's behalf, so it is stated in {@link GO_AHEAD_NOTE} before it goes.
 *
 * Disclosing the string above the composer does not establish its authorship in the transcript. Use {@link GO_AHEAD_AUTHORSHIP} where it lands so app-written words are not recorded as text the person typed.
 */
export const GO_AHEAD_LABEL = 'Start work on this plan'

/**
 * What is actually sent. Short, unmistakably a go-ahead, and it appears in the transcript as the
 * message it is — the button does not whisper to the provider behind the conversation's back.
 *
 * ## 🔴 This block said *"the message is not the mechanism (the switch is)"*, and 276 measured that false
 *
 * ⛔ **It is a mechanism, and removing it would break plan mode on Codex.** 276 ran the committed
 * `CodexRuntime` against the bundled **0.146.0** app-server — `gpt-5.6-luna` low, a fresh isolated
 * provider home per trial — and put the two halves against each other:
 *
 * | shape | what was done | turns | work |
 * |---|---|---|---|
 * | **A** | `setPlanMode(false)`, send NOTHING, wait 10 s | **0/2** | **0/2** files |
 * | **B** | `setPlanMode(false)` **+ this sentence** (what the button does) | **2/2** | **2/2**, byte-exact |
 * | **C** | this sentence alone, plan mode still on | 5/5 | acted **3/5**; **2/5** said they were waiting for plan mode to end |
 *
 * ⚑ **A is the decisive one.** `setPlanMode(false)` records a phase for the NEXT turn and
 * deliberately sends nothing, so with no next turn Codex never receives the switch at all: after
 * the request, plan state read `requested:false` and still `effective:true`. A switch does not wake
 * a model.
 *
 * ⚠️ **So the sentence does two jobs, and the old comment named neither.** It STARTS the turn —
 * which is the boundary on which `{mode:'default'}` actually reaches Codex — and it is a semantic
 * instruction in its own right, which is what C measures: three planning-profile turns crossed from
 * proposing into executing on the text alone. The switch is the mode mechanism; this is the turn
 * trigger. ⛔ **The old sentence is exactly the reasoning someone would use to delete this string,
 * and A is what that would cost.**
 *
 * It also has to READ as a go-ahead to the model, which is the half a shorter string loses: the
 * probe's second turn said `Go ahead — do it now.` and the mode switch is what made that land — B
 * against C is that difference, measured, on the sentence this constant actually holds.
 *
 * The renderer hands this to the host rather than the host owning a copy of it, so the sentence
 * shown in {@link GO_AHEAD_NOTE} and the sentence that reaches the provider are the same string
 * and cannot drift apart. ⚑ **278 §1 kept that property and added a third reader** —
 * {@link GO_AHEAD_AUTHORSHIP}'s entry in the transcript quotes the same value, so what is promised
 * before the click, what is sent, and what is shown afterwards are one string.
 *
 * ⚠️ **This is Codex-only, and 276 corrected the record on that too.** ⛔ **The two line numbers
 * that used to close this sentence were 300 lines wide of it by `461`** — they landed on a field
 * declaration and on MCP inventory parsing — so the citation names the SYMBOL, which is what
 * `claude/capabilities.ts` already does for this exact reason. Claude's planning ends at
 * the model's own `ExitPlanMode` card: `planNeedsGoAhead` is false there, this button is not drawn,
 * and {@link ClaudeSessionHandle.setPlanMode} rejects `false`. Nothing in this file
 * reaches that provider.
 */
export const GO_AHEAD_MESSAGE = 'Go ahead with this plan.'

/** What the bar says above the composer while a plan is waiting for the go-ahead. */
export const GO_AHEAD_NOTE =
  'This conversation is planning: the agent proposes rather than carries out. Starting work sends ' +
  `“${GO_AHEAD_MESSAGE}” and it stops proposing from then on.`

/** Who the transcript entry is attributed to. Not "You", which is the entire point of 278 §1. */
export const GO_AHEAD_SENDER = 'This app'

/**
 * 🔴 **What the transcript says about the message afterwards** (278 §1, from 276).
 *
 * ⚠️ **The one thing it must never do is imply the message was optional or cosmetic.** It is not:
 * 276 measured the switch alone starting **0/2** turns and producing **0/2** work — see
 * {@link GO_AHEAD_MESSAGE}. So this says the press and the send are one gesture, and says which
 * half does what, rather than apologising for a message BroBot had to send.
 *
 * ⚠️ **It names the control by {@link GO_AHEAD_LABEL} rather than quoting it**, so the sentence a
 * reader meets afterwards and the button they pressed cannot drift into naming two different
 * things — the same one-value rule {@link GO_AHEAD_NOTE} follows for the message itself.
 */
export const GO_AHEAD_AUTHORSHIP =
  `${GO_AHEAD_SENDER} sent this when you pressed “${GO_AHEAD_LABEL}”. You did not write it — the ` +
  'setting change on its own starts no turn, so the agent would not have heard anything.'

/**
 * 🔴 **688 · R22 — why BroBot's words are WAITING in the conversation** — the held go-ahead's own
 * sentence, {@link GO_AHEAD_AUTHORSHIP}'s twin before the send.
 *
 * ⚑ `endPlanMode` holds the go-ahead when it loses its race to a turn another sender opened (`670`
 * §6): the plan is released first, and the message waits for that turn to end. ⛔ **So it may not
 * say *sent*** — {@link GO_AHEAD_AUTHORSHIP} does, and it is drawn once the words have gone.
 */
export const GO_AHEAD_HELD_WHY =
  `${GO_AHEAD_SENDER} sends this when the turn ends, because you pressed “${GO_AHEAD_LABEL}”. ` +
  'You did not write it.'

/**
 * 🔴 **688 · R33 — the held go-ahead's own control**, in its own words and never the person's
 * *Cancel it* (R22). ⚑ PM ruling R33: a person MAY take back a held go-ahead, from its own entry.
 * ⚠️ Main allows it: `cancelQueuedMessage` refuses only a `notice`, and the go-ahead is held as work.
 */
export const TAKE_BACK_THE_GO_AHEAD = 'Take back the go-ahead'

/*
 * 🔴 **688 · R33 — what follows a take-back is main's sentence, and since 700 it lives in
 * `shared/the-go-ahead.ts`** (`688` H2). ⛔ It was two halves here, a second copy of main's bytes
 * pinned by a test; the row and main now import the one value.
 */

/**
 * 🔴 **696 · `688` L1 — the taken-back go-aheads whose row may still say {@link TYPE_TO_CARRY_ON}**,
 * by item id.
 *
 * ⛔ **An instruction is true only while a person can follow it, and only until they have.** `688`
 * drew *"— type your next message to carry on"* on every taken-back go-ahead for ever: after the
 * conversation had ended, where nothing can be typed, and after the person had typed. ⚑ **So the
 * second half is drawn only when BOTH hold**:
 *
 *  1. **a message can be typed and sent now** — `canTakeAMessage`, the pane's own answer: not
 *     `ended`, no refusal on the composer (`sendBlocked`: closing, a superseded sign-in), and the
 *     page holds the END of the conversation (review: scrolled back, a later message can sit in a
 *     released slab this list cannot see — so the page says only what it knows). ⚑ A frozen one
 *     can, once its card is answered;
 *  2. **nobody has carried on since** — no later item is a message the person wrote (`user`), a
 *     go-ahead that went (`continuation`), a held message of theirs still WAITING, or another
 *     go-ahead (`queued`, not relayed, not a report, not the app's notice). ⚠️ A later go-ahead
 *     counts even if it too was taken back: that row now carries the instruction, and one is
 *     enough. ⛔ A message of theirs they CANCELLED does not (review): nothing went, and no row
 *     would then say what they can do.
 *
 * ⚑ The first half — *the plan was released but the go-ahead was not sent* — is a fact about the
 * past and stays on every such row. ⚑ One pass from the end, so a transcript of any length costs
 * one walk.
 */
export function takenBackGoAheadsThatMayCarryOn(
  items: readonly TranscriptItem[],
  canTakeAMessage: boolean,
): ReadonlySet<string> {
  const open = new Set<string>()
  if (!canTakeAMessage) return open
  let carriedOnLater = false
  for (let at = items.length - 1; at >= 0; at--) {
    const item = items[at]!
    const takenBack =
      item.kind === 'queued' && item.goAhead === true && item.outcome === 'cancelled'
    if (takenBack && !carriedOnLater) open.add(item.id)
    if (thePersonCarriedOn(item)) carriedOnLater = true
  }
  return open
}

/** ⚑ `takenBackGoAheadsThatMayCarryOn`'s second condition, for one later item. */
function thePersonCarriedOn(item: TranscriptItem): boolean {
  if (item.kind === 'user' || item.kind === 'continuation') return true
  return (
    item.kind === 'queued' &&
    item.relayed !== true &&
    item.report === undefined &&
    item.appNotice === undefined &&
    (item.outcome === null || item.goAhead === true)
  )
}

/**
 * The way out that is not an approval (085).
 *
 * Allow leaving planning without sending {@link GO_AHEAD_MESSAGE} through {@link GO_AHEAD_LABEL}. Exiting a plan the person dislikes must not tell the agent to carry it out.
 *
 * ⚠️ **This is NOT a second way to stop planning, and 076's ruling is why it must not be.** Plan-off
 * and the go-ahead are the same transition on the wire — one `setPlanMode(false)`, carried by the
 * next turn as `{mode:'default'}` — and both buttons below go through the same `endPlanMode`
 * command. **The only difference is whether a message rides with it**, which is exactly the
 * difference between approving a plan and walking away from one. Two outcomes, one mechanism.
 */
export const LEAVE_PLAN_LABEL = 'Leave planning'

/** Said on the control, because "leave" alone does not say what happens to the plan or the turn. */
export const LEAVE_PLAN_TITLE =
  'Stop proposing without approving this plan. Nothing is sent — the agent hears nothing until ' +
  'you type, and whatever you say next is what it acts on.'

/**
 * Why the second button is absent on a provider whose plan mode is not ours to end (085).
 *
 * Claude's planning ends when the model's own `ExitPlanMode` request is answered, and that request
 * lives inside the SDK. A client-side switch here would be a rival exit the model's card knows
 * nothing about — 076's ruling, in the direction it was actually written for. (⚑ `741`: a reopen
 * leaves planning on every provider now, as the CLI's resume does — R99, corrected.) Said out loud
 * rather than shown as a disabled button with no explanation, which is the same silence in nicer
 * clothes.
 */
export const LEAVE_PLAN_UNAVAILABLE =
  'This provider ends planning through its own plan-approval request, not from here.'
