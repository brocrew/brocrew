// ⚑ **492 · a value import from `apps/desktop/src/shared/`, which is not `@brobot2/shared`** —
// `transcript.ts`'s own note on the 135 kB measurement applies: this module holds strings and a
// pure fold, and drags neither zod nor the database behind it.
import { ASKED_TO_STOP } from '../../../shared/how-work-stopped'
import type { PermissionDecision, UserInputQuestion } from '../../../shared/runtime-ipc'
import { mcpToolGrantDoes, type KeptGrant } from './permission-offer'
import type { UserInputRequestEvent } from './transcript'

/**
 * # ⛔ What a user-input request can be answered WITH — decided once, for every surface (214 §3)
 *
 * `213`, using the app: Home said *"The agent has finished planning and asks you to approve its
 * plan"*, offered **Reject** and **Open**, and printed underneath it *"carries no question and
 * nothing to approve — open it"*. Opening the conversation showed the correct **Approve / Reject**.
 * ⛔ **Three claims on one card and two of them contradicted the third.**
 *
 * ## Why it could happen
 *
 * The same fact was written down twice, in two files, in two shapes:
 *
 * | surface | what it said | |
 * |---|---|---|
 * | `UserInputCard.vue` | `questions.length > 0 ? 'Answer' : 'Approve'` | ✔ right |
 * | `attention.ts` | `questions.length === 0 && grant !== undefined` → Approve | ⛔ wrong |
 *
 * A Claude `ExitPlanMode` arrives as a `user_input_request` with `questions: []` and **no**
 * `permission` — it is a plan, not a sandbox grant — so it missed the overview's second clause,
 * fell through to the limit table and came out as `no-question`: *"carries no question and nothing
 * to approve"*, about the one request whose whole purpose is to be approved.
 *
 * ⚑ **`106` is the rule it broke** — no control that cannot act — but the deeper fault is that
 * neither surface was wrong on its own terms. They disagreed because nothing made them agree.
 * `211` did the same repair for the rail's opening line, and `205`'s own header says it: *"the rows
 * are `attention.ts`'s projection and this file adds no facts to them"*. That discipline stopped at
 * the boundary between the overview and the card.
 *
 * ## ⛔ The rule, and it is ONE rule
 *
 * **A request with no questions is approved by answering it with nothing.** That is not a new
 * claim — `UserInputCard` has sent `{kind:'answer', answers:{}}` for exactly this shape since `020`,
 * `answerToForward` returns `forwardable` for it (its loop has no questions to walk), and Claude's
 * `respondUserInput` settles the plan gesture on any answer. So the grant clause was never the
 * discriminator; the QUESTION COUNT was, and the grant only ever changed which SCOPE lines are
 * drawn beside it.
 *
 * ⚠️ **`'no-question'` is gone from {@link AttentionLimit} rather than reworded.** It was `207` M1's
 * repair of an earlier version of the same mistake — the row used to say *"asks more than one
 * question"* about a request that asks none — and it fixed the sentence while keeping the premise
 * that such a request cannot be answered from here. It can. A limit that describes a request this
 * surface CAN answer is a control that refuses to act, which is the defect, not a description of it.
 *
 * ## What makes the next one impossible
 *
 * Every surface that offers a positive control on a user-input request calls {@link userInputOffer}
 * and renders what it returns. There is no second predicate to drift: the word on the card's button
 * and the buttons in the overview's row are two fields of one answer, computed together, from the
 * request alone. `user-input-offer.test.ts` walks the shapes and asserts the two can never disagree.
 */

/**
 * 🔴 **728 · whose card it is, when an MCP SERVER raised it** (`mcpServerAsks` on the request) —
 * so the line under each button names who is told what. ⛔ Until `728` every such line said
 * *"the agent …"*, and on a server's card the agent is told nothing: Allow sends the SERVER
 * `accept`, Deny `decline`, Cancel `cancel`. ⚑ Renderer-local — it rides on a decision to choose
 * its sentence, and nothing sends it.
 */
export interface ServersAsk {
  readonly name: string
  /**
   * ⚑ **W4.28 · the card shows a link the server asks the person to open** (`mcpServerAsks.url`) —
   * so its Allow is *I opened it* ({@link I_OPENED_IT}), and the line under it says so.
   */
  readonly opensALink?: true
}

/** A request's {@link ServersAsk}, or `undefined` for every request a server did not raise. */
export function serversAskOf(request: {
  readonly mcpServerAsks?: { readonly server: string; readonly url?: string } | undefined
}): ServersAsk | undefined {
  if (request.mcpServerAsks === undefined) return undefined
  return {
    name: request.mcpServerAsks.server,
    ...(request.mcpServerAsks.url === undefined ? {} : { opensALink: true as const }),
  }
}

/** A decision a surface can send WITHOUT opening the conversation. */
export type AttentionDecision =
  | {
      kind: 'permission'
      label: string
      decision: PermissionDecision
      /**
       * 🔴 **730 · R81 — this Cancel asks no turn to stop** (the request's `cancelStopsNothing`,
       * `723`): the card's Cancel is the provider's own cancel and nothing more (since `736`, R97,
       * every elicitation card; until then a frame that named no turn), so the adapter sends no
       * interrupt and latches nothing. ⚑ Renderer-only: what leaves this window is `decision`
       * alone. ⚑ Present only as `true`, only beside `cancel` — see {@link CANCEL_STOPS_NOTHING}.
       */
      stopsNothing?: true
      /** ⚑ 728 · the SERVER that raised this card, when one did — see {@link ServersAsk}. */
      server?: ServersAsk
      /**
       * 🔴 **739 · `726` F-14 — what the conversation grant covers**, beside `allow_for_session`
       * only: the card's `scope.grants` rules in words (`conversationGrantCovers`), so the line under
       * that button on every surface says the rule and not only that there is one. ⚑ Renderer-only,
       * like {@link stopsNothing}: what leaves this window is `decision` alone.
       */
      covers?: string
      /**
       * 🔴 **739 · `736` F-1 — what *Always allow* keeps and where**, beside `allow_always` only
       * (`keptGrantOf`, read off `scope.grants.allow_always` and `alwaysFile`). ⚑ Renderer-only.
       */
      keeps?: KeptGrant
      /**
       * 🔴 **743 · `739` F-1, ruled — the wholesale grant's own warning**, beside
       * `allow_all_for_session` only (`wideGrantWarning`): *Waiting on you* and the person's queue offer that
       * grant as a one-click answer now, and draw it under the warning the card draws (058).
       * ⚑ Renderer-only.
       */
      warns?: string
      /**
       * 🔴 **743 · the MCP tool the conversation's grant covers**, beside `allow_all_for_session`
       * only, where Codex raised the card for a call of its own (R80): the line under the button
       * names the tool and its server (`mcpToolGrantDoes`), as the card's does. ⚑ Renderer-only.
       */
      mcpToolCall?: { readonly server: string; readonly tool: string }
    }
  | { kind: 'answer'; label: string; questionId: string; option: string; server?: ServersAsk }
  /**
   * ⛔ **The positive answer to a request that asks no question** — a Codex permission grant (`207`
   * M1) and a Claude plan approval (`214` §3) are both this shape.
   *
   * Its own kind rather than an `answer` with an empty id because the payload is genuinely
   * different: there is no question to key, and an id nobody asked for would be sent as a real one.
   *
   * 🔴 **`consent` is what this press is a consent TO, and it is required** (478). ⛔ One member of
   * {@link AttentionDecision} carried three materially different effects — a turn-scoped access
   * grant, an agent starting to plan, and an agent leaving plan mode to start work — under one
   * sentence, *"the request is approved with no answer"*, which describes the PAYLOAD and not any
   * of them. ⚑ **A field of the decision rather than a table beside it**, which is `470`'s shape
   * (`CapabilityField.whenItTakesEffect`, required, `null` on seven of eight): keyed by where it
   * lives, so `464`'s rename hazard cannot reach it.
   */
  | { kind: 'approve'; label: string; consent: ConsentAsked }
  | { kind: 'reject'; label: string; server?: ServersAsk }

/**
 * ⛔ **Why a one-click answer might not be offered on an overview** (086: never imply a state we
 * cannot back).
 *
 * A one-click answer from a dashboard has to produce a response that is *exactly* as correct as the
 * card's would be. These are the cases where it cannot:
 *
 *  - `multiple` — more than one question. One click cannot answer two, and answering one is not an
 *    answer.
 *  - `multi-select` — the provider asked for *many* of the options; one click would send one and
 *    call it the answer.
 *  - `free-form` — no options at all, so there is nothing to click; the answer is typed.
 *  - `secret` — the provider marked the answer sensitive. It is not going on a dashboard.
 *
 * In every one of them the row still offers **Reject**, which is protocol-safe and always available,
 * and says why the rest is not here. It never renders a control that would send a half-answer.
 *
 * ⚠️ **There is deliberately no member for "asks nothing".** See the note above: that request is
 * answerable, and saying otherwise is what `214` §3 was.
 */
export type AttentionLimit = 'multiple' | 'multi-select' | 'free-form' | 'secret'

/**
 * 🔴 **What a zero-question card is a consent TO, as a closed vocabulary** (478).
 *
 * ⛔ **Three requests arrive on one event type with one control on them**, and they are not one
 * thing: Codex's `item/permissions/requestApproval` widens a sandbox for the length of a turn,
 * Claude's `EnterPlanMode` starts the provider's plan mode, and Claude's `ExitPlanMode` ends it
 * (⚑ until `728` they also raised and lowered this app's own read-only floor, which R93 removed).
 * ⚠️ Since `736` (R98) no `EnterPlanMode` card is raised — the CLI does not ask before it — so a
 * *start-planning* card is one replayed from a row written before then. ⚠️ `476` read the two
 * plan cards as one *"Enter/ExitPlanMode consent"*; that is the same sentence over two materially
 * different effects, which is the defect this dispatch was sent at, one level further in.
 *
 * ## ⚠️ The fourth member is a GAP and not a default
 *
 * ⛔ **A consent this window cannot name gets a sentence that says so.** Falling back to either
 * real member would put a confident effect on a card nobody classified
 * (`an-unenumerated-state-counts-as-success`, with the stakes inverted — `438`'s rule, inherited).
 * ⚑ It is REACHABLE rather than defensive: `user_input_request` rows written before `478` carry no
 * `consent` key, the fold replays them, and `477`'s ruling for exactly that population is that the
 * absence means *nobody said* and must keep saying so.
 */
export type ConsentAsked =
  | 'access-for-this-turn'
  | NonNullable<UserInputRequestEvent['consent']>
  | 'a-consent-this-window-cannot-name'

/**
 * ⛔ **Which of {@link ConsentAsked} one request is, read off the request and nothing else** (478).
 *
 * ⚠️ **`permission` is asked FIRST, and the order is `question-channel.ts`'s own** — *"the only
 * refusal that names what the request IS"*, because a Codex grant also has no questions and would
 * otherwise be reported as a plan card. ⚑ `340`'s finding, in the surface this time: a reason
 * answering with another reason's sentence.
 *
 * ⚑ **Exported because a classifier nothing can drive is a classifier nobody can measure.** Both
 * callers reach it through {@link userInputOffer}, which is handed the whole request so the two
 * surfaces cannot classify one card differently — `214` §3's rule, applied to the consent as it was
 * applied to the word on the button.
 */
export function consentAsked(request: UserInputRequestEvent): ConsentAsked {
  if (request.permission !== undefined) return 'access-for-this-turn'
  if (request.consent !== undefined) return request.consent
  return 'a-consent-this-window-cannot-name'
}

/**
 * ⚑ **Always offered, on every request, whatever else is.** `{kind:'reject'}` is the protocol-safe
 * default the contract names — the provider cannot hang on it — so a row that can offer nothing else
 * can still stop an agent waiting on an answer it is not going to get.
 */
const REJECT: AttentionDecision = { kind: 'reject', label: 'Reject' }

/** What every surface offers on one user-input request. */
export interface UserInputOffer {
  /**
   * ⛔ **The word on the positive control, wherever one is drawn.** `Approve` exactly when the
   * request asks nothing — which is the same predicate that puts an `approve` decision in
   * {@link decisions}, because it is read once and used twice.
   */
  positive: 'Answer' | 'Approve'
  /**
   * 🔴 **What pressing {@link positive} DOES — a field of the offer that names the control** (482).
   *
   * ## ⛔ Why a field here and not a second call on the card
   *
   * ⚠️ **`478` F3 measured the hole: *"`UserInputCard`'s Approve says nothing at all"*.** The queue
   * draws {@link whatThisAnswerDoes} under every button it offers; the card drew the word and
   * stopped. ⛔ **The obvious repair — let the card call `whatThisAnswerDoes` itself — needs the
   * card to BUILD the decision first**, and the only `approve` decision that carries the right
   * {@link ConsentAsked} is the one three lines below this interface. ⚑ A card constructing its own
   * would be a second producer of a value this module already makes, which is `473`'s defect
   * exactly (`permissionDecisionFor`) and `214` §3's one level up.
   *
   * 🔴 **So the sentence is a FIELD of the thing it describes**, which is `470`'s shape — the one
   * `464` was fixed into after five person-side readers each spelled a label instead of reading it.
   * ⚠️ On the zero-question branch it is literally `whatThisAnswerDoes(theApproveDecisionBelow)`, so
   * the card and the queue cannot say two things about one press: there is one call.
   *
   * ⛔ **On the question branch it is NOT one of {@link decisions}**, and that is not a gap. Those
   * are the one-click answers an overview may send; this is the card's SUBMIT, which sends whatever
   * was filled into the form — a different act, so a different sentence. See
   * {@link ANSWER_SENDS_THE_FORM}.
   */
  positiveDoes: string
  /**
   * ⛔ **What Reject does**, from the same function, so a card spells neither sentence nor decision.
   *
   * ⚠️ **It never varies, and it is still a field rather than an exported constant.** A constant
   * would be a second name for `whatThisAnswerDoes`'s reject arm, free to be drawn where that arm
   * is not; a field is only reachable by asking this module what THIS request offers — which is the
   * question every surface is supposed to be asking.
   */
  rejectDoes: string
  /**
   * The one-click decisions an OVERVIEW can send, in order, always ending in Reject.
   *
   * A card does not read this: it has the whole form, so it can answer a multi-select or a typed
   * question that this list cannot. What it does read is {@link positive}, {@link positiveDoes} and
   * {@link rejectDoes} — the facts the two surfaces used to hold separately.
   */
  decisions: AttentionDecision[]
  /** Why an overview has no positive one-click here, or null when it has one. */
  limit: AttentionLimit | null
}

/**
 * What can be sent in answer to this request, from a dashboard and from the card.
 *
 * ## ⚠️ It takes the REQUEST now, and it used to take the questions (478)
 *
 * ⛔ **The old reason was that the two callers could pass what they have** — the overview walks a
 * fold item, the card holds a computed — *"and so this cannot reach for anything else about the
 * session and become a second opinion about it."* ⚑ **That second half still holds and is what
 * makes the change safe:** the argument is one request, not the session, so there is still nothing
 * else here to reach for. ⚠️ Both callers always had the whole request; passing a slice of it was
 * what stopped the `approve` decision saying what it was a consent to.
 *
 * ⛔ **And a second argument beside the questions would have been worse than either**, because two
 * arguments can describe two different requests, which is the exact failure `214` §3 is about.
 */
export function userInputOffer(request: UserInputRequestEvent): UserInputOffer {
  const questions = request.questions
  // ⛔ **The whole discriminator, and the whole fix.** Nothing about grants, nothing about plans,
  // nothing about which provider sent it: a request that asks no question is approved by answering
  // it with nothing, and both surfaces now learn that from this line.
  //
  // ⚠️ **`consentAsked` does NOT reopen that** (478). It decides what the one Approve here SAYS,
  // never whether there is one — `213`'s defect was a surface deciding a zero-question request was
  // unanswerable, and the predicate above is still `questions.length === 0` and nothing else.
  if (questions.length === 0) {
    // ⛔ **Built once and used twice** (482). The card reads the SENTENCE and the overview reads the
    // DECISION, and they are the same object — so the consent this request asks for cannot be read
    // one way on one surface and another way on the other.
    const approve: AttentionDecision = {
      kind: 'approve',
      label: 'Approve',
      consent: consentAsked(request),
    }
    return {
      positive: 'Approve',
      positiveDoes: whatThisAnswerDoes(approve),
      rejectDoes: whatThisAnswerDoes(REJECT),
      decisions: [approve, REJECT],
      limit: null,
    }
  }
  const only = questions.length === 1 ? questions[0] : undefined
  const limit = limitOf(questions, only)
  // ⚑ 728 · a SERVER's form: its answers go to the server, and its reject tells the server no.
  const server = serversAskOf(request)
  const reject: AttentionDecision =
    server === undefined ? REJECT : { kind: 'reject', label: REJECT.label, server }
  return {
    positive: 'Answer',
    positiveDoes:
      server === undefined
        ? ANSWER_SENDS_THE_FORM
        : `${server.name} gets the answers you filled in here`,
    rejectDoes: whatThisAnswerDoes(reject),
    decisions:
      limit === null && only !== undefined
        ? [
            ...only.options.map((option) => ({
              kind: 'answer' as const,
              label: option.label,
              questionId: only.id,
              option: option.label,
              ...(server === undefined ? {} : { server }),
            })),
            reject,
          ]
        : [reject],
    limit,
  }
}

/**
 * 🔴 **Why an overview has no positive one-click here, in the words a person reads** (434 · moved
 * out of `AttentionQueue.vue`, unchanged).
 *
 * ⛔ **Here rather than in one component because there are now TWO surfaces that draw it** — the
 * live overview and the person's queue — and this module's whole docblock is what happens when one
 * fact about a request is written down twice in two files. ⚑ `214 §3`, applied to the sentence
 * beside the buttons rather than to the word on them.
 */
export const LIMIT_WORDS: Readonly<Record<AttentionLimit, string>> = {
  multiple: 'asks more than one question — answer it on the card',
  'multi-select': 'takes more than one answer — answer it on the card',
  'free-form': 'takes a typed answer — answer it on the card',
  secret: 'the answer is sensitive — answer it on the card',
  // ⛔ **`no-question` is gone** (214 §3). It read *"carries no question and nothing to approve —
  // open it"*, and 213 saw it printed under *"asks you to approve its plan"* on a card whose
  // Approve was one click away inside the conversation. A request that asks nothing is approved by
  // answering it with nothing; `userInputOffer` says so once, for this surface and the card alike.
}

/**
 * ⛔ **Whether a decision READS as a refusal, so no surface draws one as the loud button** (434 ·
 * moved out of `AttentionQueue.vue`, unchanged).
 *
 * Deny and Cancel read as refusals and are drawn as ones — a refusal must never be the loud
 * button. `allow_for_session` is an approval however wide it is, so it is not one of these.
 *
 * ## ⚠️ The early `!== 'permission'` was a DEFAULT and 446 had to make it a decision
 *
 * ⛔ **A member added to {@link AttentionDecision} fell through that line as *not a refusal*,
 * silently** — which is `a-loop-over-a-literal-variant-list-is-not-exhaustive` in one guard. ⚑ The
 * kinds are asked in full, so the next member is a line somebody has to write rather than a
 * default.
 */
export function isRefusal(decision: AttentionDecision): boolean {
  if (decision.kind === 'reject') return true
  if (decision.kind === 'answer' || decision.kind === 'approve') return false
  return decision.decision.outcome === 'deny' || decision.decision.outcome === 'cancel'
}

/**
 * 🔴 **What happens if a person presses THIS** (434, HO-024 criterion 20's third clause).
 *
 * ## ⛔ The narrowing, which is `430`'s ruling and not a hedge
 *
 * > *"The Observer can explain **deterministic immediate routing/permission effects**; it cannot
 * > promise what a model will subsequently do. **Unknown downstream outcomes must be shown as
 * > gaps.**"*
 *
 * ⚑ **So every sentence here is about what THIS APP does the instant the answer is sent** — the
 * row it writes, and the state the request leaves. ⛔ **Not one of them says what the agent will
 * then do**, which is the model's and is disclosed once, beside the buttons, by
 * {@link WHAT_COMES_AFTER_IS_NOT_OURS}.
 *
 * ⚠️ **Keyed by the decision's own shape**, so a new `AttentionDecision` member or a new
 * `PermissionDecision['outcome']` does not compile until somebody has said what it does — the
 * shape `OUTCOME_LABEL` already uses for the word on the button, applied to its consequence.
 */
export function whatThisAnswerDoes(decision: AttentionDecision): string {
  if (decision.kind === 'reject') {
    if (decision.server !== undefined) return `${decision.server.name} is told no`
    return 'the request is declined and the agent is told nothing was answered'
  }
  // 🔴 **478 · the effect, and it is not the payload.** ⛔ *"the request is approved with no
  // answer"* described what leaves this window — `{answers:{}}`, the same object a DECLINE sends —
  // and said nothing about what the press does. ⚑ It is keyed by the decision's own
  // {@link ConsentAsked}, which was read off the request that raised it.
  if (decision.kind === 'approve') return CONSENT_EFFECTS[decision.consent]
  if (decision.kind === 'answer') {
    const who = decision.server === undefined ? 'the agent' : decision.server.name
    return `${who} is given “${decision.option}” as the answer`
  }
  // ⚑ **728 · a SERVER's card names the server** on Allow and Deny; its Cancel is 730's, below.
  if (decision.server !== undefined) {
    const says = whatAServersCardAnswerDoes(decision.decision.outcome, decision.server)
    if (says !== null) return says
  }
  // 🔴 **730 · R81 — a Cancel that asks no turn to stop says only what it does**, the named
  // exception to one-sentence-per-outcome (`two-sentences-a-person-chooses-on`), for this card only.
  if (decision.decision.outcome === 'cancel' && decision.stopsNothing === true) {
    return CANCEL_STOPS_NOTHING
  }
  // 🔴 **739 · `726` F-14 — the conversation grant's own rule, where the card names it** (R94: *"the
  // card's words say what the rule covers"*): the same clause as the line without it, then the rule.
  if (decision.decision.outcome === 'allow_for_session' && decision.covers !== undefined) {
    return `the agent may do this, and for this conversation what the provider’s own rule for it covers: ${decision.covers}`
  }
  // 🔴 **739 · `736` F-1 — what *Always allow* keeps, and where**, where the card says so.
  if (decision.decision.outcome === 'allow_always' && decision.keeps !== undefined) {
    return whatAlwaysAllowKeeps(decision.keeps)
  }
  // 🔴 **743 · `739` F-1 — the conversation's grant on Codex's MCP card, off the card**: its tool and
  // server, the line the card draws under the same button (R80).
  if (decision.decision.outcome === 'allow_all_for_session' && decision.mcpToolCall !== undefined) {
    return mcpToolGrantDoes(decision.mcpToolCall)
  }
  return PERMISSION_EFFECTS[decision.decision.outcome]
}

/**
 * 🔴 **739 · `736` F-1 — the line under *Always allow*, off the wire** ({@link KeptGrant}): the one
 * action, then that the provider's own rule for it is kept beyond this conversation, the file it is
 * kept in (verbatim — `740` moves it, R99) and the rule, and what else the press installs for this
 * conversation. ⚑ Each part is said only where the request carries it; with none it is
 * `PERMISSION_EFFECTS.allow_always`, which names no file and no rule.
 * ⛔ **It says what is KEPT, never what a later conversation will do with it**: whether it reads that
 * file is the file's reader's (a Claude rule, since `740`, is read for launches in its project).
 */
function whatAlwaysAllowKeeps(keeps: KeptGrant): string {
  // ⚑ The rule first, then the file: the file's path is long, and what is kept is what a person
  // weighs (739's own photograph).
  const what = keeps.rules === null ? '' : `: ${keeps.rules}`
  const where = keeps.file === null ? '' : `, in ${keeps.file}`
  const also =
    keeps.alsoForThisConversation === null
      ? ''
      : `; for this conversation it also covers: ${keeps.alsoForThisConversation}`
  return `${PERMISSION_EFFECTS.allow_always}${what}${where}${also}`
}

/**
 * 🔴 **730 · R81, ruled by the PM** (`720` F-B): *"A card whose press cannot stop the turn does not
 * say it will. When the frame names no turn, its line says only what the press does (the request is
 * cancelled; the turn is not asked to stop), and the host records no ask. This is a named exception
 * to `two-sentences`, for this card only."*
 *
 * ⚑ **Its claim is the adapter's own behaviour** (`codex-runtime.ts`: since `736`, R97, no
 * elicitation Cancel sends a `turn/interrupt` or latches; until then only a frame with no turn) and
 * the host's (`user_decision.stopsNothing`, no `work_interrupted`). ⚑ {@link ASKED_TO_STOP} is
 * interpolated, as every sentence that names the ask must (`make-the-word-mean-one-thing`), so the
 * negation cannot drift from the claim it negates.
 *
 * 🔴 **736 · R97 — *"its line says exactly that"***: *"the request is cancelled and the turn runs
 * on"*, measured of Codex's own Esc and of this app's Cancel (`probe:codex-mcp-tool-approval`'s
 * `cancel` arm: the turn completed). ⛔ Until `736` it said only what did NOT happen.
 */
export const CANCEL_STOPS_NOTHING = `the request is cancelled and the turn runs on — it is not ${ASKED_TO_STOP}`

/**
 * 🔴 **728 · a server's card's Allow and Deny, said of the SERVER** — MCP's `accept` and `decline`.
 * `null` for every other outcome: its Cancel keeps the words `730` ruled for it (R81 —
 * {@link CANCEL_STOPS_NOTHING} on every such card since `736`, R97; the whole-turn line only on a
 * row written before `736` that carries no marker), so
 * one press is never said two ways.
 */
function whatAServersCardAnswerDoes(
  outcome: PermissionDecision['outcome'],
  server: ServersAsk,
): string | null {
  if (outcome === 'allow' && server.opensALink === true)
    return `${server.name} is told you opened its link`
  if (outcome === 'allow') return `${server.name} is told yes`
  if (outcome === 'deny') return `${server.name} is told no`
  return null
}

/**
 * 🔴 **What the CARD's submit does, which is not one of {@link AttentionDecision}'s members** (482).
 *
 * ## ⛔ Why this sentence exists at all, when four neighbours already cover every one-click answer
 *
 * ⚠️ **{@link whatThisAnswerDoes} is keyed by a decision, and the card's positive control is not
 * one.** An overview offers *an option* — `the agent is given “Yes” as the answer` — because one
 * click IS the whole answer there. ⛔ The card offers a FORM: several questions, a multi-select,
 * a typed value, an `Other` beside the chips. What its button sends is whatever was filled in, and
 * no member of that union describes it.
 *
 * ⚑ **Naming it here rather than inventing a union member** is the narrower change and the honest
 * one: {@link AttentionDecision} is *what a surface may send WITHOUT opening the conversation*, and
 * a member for the thing you can only do WITH the conversation open would make that sentence false
 * for the sake of reusing a function.
 *
 * ⛔ **`430`'s narrowing holds here too.** It says what leaves this window the instant the button
 * is pressed and stops — what the agent then does with the answers is
 * {@link WHAT_COMES_AFTER_IS_NOT_OURS}, drawn once beside it.
 *
 * ⚠️ **No count in it** (`458`). *"your three answers"* would be a live cardinality in prose, and
 * the number moves while the card is on screen.
 */
export const ANSWER_SENDS_THE_FORM = 'the agent is given the answers you filled in here'

/**
 * ⛔ **The immediate effect of each permission outcome** — a `Record`, so an outcome added to the
 * runtime's enum is a build error here rather than a button with nothing under it.
 */
const PERMISSION_EFFECTS: Readonly<Record<PermissionDecision['outcome'], string>> = {
  allow: 'the agent may do this once',
  // ⚑ The rule the provider suggests for this ask (the SDK's permission `suggestions`), not only
  // *"the same thing again"*: for a read outside the folder, that folder; for an edit, every edit.
  // Where the card carries the rule, the line names it (`covers`, above); this is the line for a
  // card that carries none — every Codex card, and every older row.
  allow_for_session:
    'the agent may do this, and what the provider’s own rule for it covers, for this conversation',
  allow_all_for_session: 'the agent may do anything of this kind for this conversation',
  // ⚑ The provider's suggested rule, kept beyond the conversation: the line where the card names
  // neither the rule nor the file ({@link whatAlwaysAllowKeeps} adds them).
  allow_always:
    'the agent may do this, and the provider’s own rule for it is kept beyond this conversation',
  deny: 'the agent is refused this one thing',
  // 🔴 **478 · the SCOPE, which *"the request is cancelled"* left out.** ⛔ `cancel` is not a
  // louder `deny`: both adapters ask the session machine to interrupt before they answer at all —
  // `claude-runtime.ts` returns `{behavior:'deny', message:'cancelled by user', interrupt:true}`
  // after `requestInterrupt()`, and `codex-runtime.ts` calls the same method before it answers —
  // and both providers then end the turn `interrupted` in their OWN word (709, R43: measured,
  // Claude's `aborted_tools` and Codex's `turn/completed{status:'interrupted'}` after a command
  // approval's Cancel). ⚑ **736 · R97 — NOT an external-MCP elicitation card's**: its
  // `{action:'cancel'}` lets the turn run on (`probe:codex-external-mcp` arm H), as the Codex
  // terminal's own Esc does, and this app adds no stop of its own to it — so EVERY such card carries
  // `cancelStopsNothing` and says {@link CANCEL_STOPS_NOTHING} instead of this line. (From `720`
  // until `736`, R74 had that Cancel also ask its frame's turn to stop.)
  // ⚠️ A person reading the old sentence beside **Deny** could not tell that one of them stops
  // everything the agent is doing. ⚑ The card has said `Cancel turn` on its own button since `031`;
  // this is the overview finally saying the same thing in the line under it.
  //
  // ⛔ **482 · what this comment used to claim, and why the claim had to go.** It said Codex
  // reaches `interrupted` *"before writing `{decision:'cancel'}`"*, naming a wire write as the
  // mechanism. ⚠️ **There is a branch where that write never happens** — an `item/tool/call` is
  // answered with the tool's own RESULT, so `respondPermission` returns at the agentTool arm
  // without writing a decision at all — and `482` put a Cancel button on exactly that card.
  // ⚑ **The SENTENCE survives and the reasoning did not**: `requestInterrupt()` runs above that
  // branch, `SessionMachine.completeTurn` overrode the provider's own outcome with `interrupted`
  // (until 709, R43),
  // and `codex-runtime.test.ts`'s `482` pair asserts it against a provider reporting an ordinary
  // completion, with the same press as `deny` as the control. 🔴 **What is weaker there is not in
  // this sentence**: the provider is never ASKED to stop, so the agent runs on until it ends the
  // turn itself. That is a finding in `482`'s response, not a clause for a button.
  //
  // 🔴 **492 · the finding above is closed, and it took the verb with it** (HO-032 §1).
  //
  // ⛔ **The provider IS asked to stop now**, on that branch as on every other: the agent-tool arm
  // sends `turn/interrupt` after the tool result, `478` F3's *Cancel turn* is what the person chose,
  // and the PO's sentence is why the softer option was refused — *"Deny and Cancel do the same thing
  // on that door, and the only difference is a label that is false."*
  //
  // ⚠️ **So the CLAIM moved, not the scope.** *is interrupted* said the turn was over; what a press
  // does is send the ask. ⚑ {@link ASKED_TO_STOP} is the shared bytes, and `interrupt_agent` — the
  // verb that performs this same act for a model — composes its answer from the same constant, so
  // neither surface can drift into describing the act its own way. 🔴 **`asked`, never `stopped`, is
  // `RuntimeHost.interruptAgent`'s ruling**: Codex's own `interrupt()` may never be answered, and an
  // answered one can still leave the turn running (709), so *stopped* is a claim this app cannot
  // make on either provider.
  //
  // ⚠️ **Still ONE sentence for every door**, which `two-sentences-a-person-chooses-on.test.ts`
  // rules deliberately — *"the sentence is not per-provider and must not become one"*. ⛔ It is true
  // of all of them now, which is the repair `483` asked for rather than the softening it refused.
  cancel: `the whole turn is ${ASKED_TO_STOP}, and this request is refused`,
}

/**
 * ⛔ **What approving a zero-question card actually does, per {@link ConsentAsked}** (478) — a
 * `Record`, so a consent card this app learns about is a build error here rather than a button
 * with somebody else's sentence under it.
 *
 * ⚠️ **Every one of these is about what happens the instant the answer is sent**, which is `430`'s
 * narrowing and the same bound every sentence in this file is under. ⚑ **728 · R93** — the plan pair
 * used to name this app's OWN floor (`140`); that floor is gone, so it names the provider's plan mode
 * moving, which `claude-runtime.ts`'s `respondUserInput` settles the moment the answer is taken.
 */
const CONSENT_EFFECTS: Readonly<Record<ConsentAsked, string>> = {
  'access-for-this-turn': 'the access this card asks for is granted, for this turn and no longer',
  // ⚑ **728 · R93** — *"this app holds back the tools that change things"* went with the floor it
  // described: planning is the provider's own mode now. ⛔ Only what happens the instant the answer is
  // sent (430) — the mode moves; what the agent does in it is its own next step.
  'start-planning': 'the agent starts planning, in the provider’s own plan mode',
  'stop-planning': 'the agent stops planning, and its plan mode ends',
  // ⚑ **The gap, said rather than guessed** (430: *"unknown downstream outcomes must be shown as
  // gaps"*). ⛔ It keeps the old sentence's true half — the payload really does carry no answer —
  // and drops the implication that nothing else happens, which is what made it false on the two
  // cards this window CAN name.
  'a-consent-this-window-cannot-name':
    'the request is approved with no answer, and this window cannot say what else that does',
}

/**
 * 🔴 **The gap that must be shown rather than omitted** (434, HO-024 §5.3 · criterion 20).
 *
 * ⛔ **`430` measured that the ledger cannot answer *"what happens if I choose this"* past the
 * immediate effect**: answer descriptions are provider-authored claims, and *"request_routed /
 * escalation / stranding / interruption say where an open request went and whether it ended. They
 * do not predict the model's next action."* ⚠️ **Omitting it would read as *nothing else
 * happens***, which is the one thing nobody can promise about a model.
 */
export const WHAT_COMES_AFTER_IS_NOT_OURS =
  'What the agent does after that is its own next step, and this app does not predict it.'

/** See {@link AttentionLimit}. Null means this question can be answered with one click. */
function limitOf(
  questions: readonly UserInputQuestion[],
  only: UserInputQuestion | undefined,
): AttentionLimit | null {
  if (only === undefined) return 'multiple'
  if (only.secret === true) return 'secret'
  if (only.multiSelect === true) return 'multi-select'
  if (only.options.length === 0) return 'free-form'
  return null
}
