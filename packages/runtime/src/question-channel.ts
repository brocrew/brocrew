import type { RuntimeEvent } from './events'
import type { UserInputQuestion } from './permission'

/**
 * 🔴 **What may travel, and everything that may not** (394, HO-007 S4 + criterion 10).
 *
 * ## ⛔ The distinction this file exists to keep
 *
 * **Knowledge escalates. Authority does not.** A question is knowledge — a conversation does not
 * know something and asks, and the asking may travel to whoever can answer. ⛔ **A permission is
 * authority, it is always a person's, and it never travels.** HO-017 §4 states it as a standing
 * principle; criterion 10 states it as a property of the channel: *"permissions cannot enter the
 * question channel — asserted as absent, not assumed."*
 *
 * ## 🔴 It is a CLASSIFIER and deliberately not a filter, and that is the whole design
 *
 * ⛔ **A filter justified by *"we never see permissions here"* blinds the instrument that would
 * show you one.** Once the gate is in, the evidence that motivated it can no longer arrive, and a
 * census reports zero forever — honestly, and wrongly. ⚠️ Same shape as `362`'s provider-blind
 * refusal: an emergent property of a predicate with no test anywhere, which is *a gate nobody
 * proves can fail.*
 *
 * ⚑ **So nothing here drops anything.** Every request still reaches every surface it reached
 * before; this function only answers *where may it go*, in a closed vocabulary, and its answer is
 * RECORDED by its caller — see `RequestRoutedEvent`, whose `because` field is what makes *"has
 * anything permission-shaped ever arrived here?"* a question the ledger answers rather than one the
 * gate has made unaskable.
 *
 * ## ⛔ An ADMIT-LIST, so a shape neither provider sends today is refused
 *
 * ⚠️ **A negative is only as strong as the search shape that produced it** (standing rule 4). The
 * admitted shape is {@link QUESTION_REQUEST_KEYS} — a NAMED SET, asserted equal rather than
 * counted (`353`'s idiom) — and anything carrying a key outside it is
 * {@link ChannelRefusal.a-shape-this-app-has-not-been-taught}. ⛔ **A shape the validator has not
 * been taught is a refusal, never a pass.**
 *
 * 🔴 **And that check has to happen BEFORE the wire parse, which is why the caller passes the
 * adapter's own event.** `runtimeEventSchema` is built from `z.object`, and zod STRIPS an
 * undocumented key rather than failing on it — so by the time an event has been through
 * `toWireEvent` a field no adapter here knows about is already gone. ⚠️ `348` met the same fact one
 * layer up and answered it with `z.looseObject` so a rail could refuse an argument BY NAME; this
 * is that lesson at the event boundary, where the shape cannot be changed because the schema is
 * also the ledger's contract.
 *
 * ## ⚠️ The two providers do not ask questions the same way, and neither describes the other
 *
 * ⛔ **Derived from the adapters, not from a capture** — *absence in a capture is not absence*, and
 * a provider that did not send something during one recording has not promised never to.
 *
 * **Claude** (`claude/claude-runtime.ts`):
 *  - `handleCanUseTool` raises `permission_request` for every command/file tool.
 *  - `USER_INPUT_TOOLS` — `AskUserQuestion`, `ExitPlanMode`, `EnterPlanMode` — raise
 *    `user_input_request` instead. ⚑ **`claudeQuestions` returns `[]` for everything that is not
 *    `AskUserQuestion`**, so the two plan tools arrive here as a request with NOTHING TO ANSWER.
 *    ⛔ They are consent: `ExitPlanMode` asks a person to approve a plan. ⚑ Since `736` (R98)
 *    `EnterPlanMode` never arrives: the CLI does not ask before it (measured), so the adapter
 *    allows it with no card in every mode; only a ledger row written before `736` carries one.
 *  - ⛔ **Claude never populates `permission`.** There is one `user_input_request` emit in that
 *    file, and since `478` it carries `{type, id, prompt, questions, consent}` — where `consent`
 *    is set for exactly the two plan tools, off the same `PLAN_GESTURES` entry that moves the
 *    floor when the card is approved, and is absent on an `AskUserQuestion`.
 *
 * **Codex** (`codex/codex-runtime.ts`):
 *  - `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` raise
 *    `permission_request`.
 *  - `handleUserInputRequest` reads `isPermission = method === 'item/permissions/requestApproval'`
 *    and emits **two different shapes from one branch**: a permission grant as
 *    `{questions: [], permission: codexUserPermission(params)}`, and a question as
 *    `{questions: codexQuestions(params)}` with no `permission` at all.
 *  - ⚑ A Codex question request with zero questions is DECLINED by the adapter and never emitted,
 *    so `a-consent-with-nothing-to-answer` is Claude's shape today — and it is asked of both,
 *    because which tool exists is *"a bet on someone else's release notes"* (`USER_INPUT_TOOLS`'s
 *    own docblock, after `056` moved that set once already).
 *
 * ⛔ **So they differ in KIND and nothing here invents a symmetry.** On Codex a permission is a
 * FIELD; on Claude it is a TOOL NAME that produces an empty question list. Two members of this
 * vocabulary, not one widened one — HO-017 §4's *"where providers differ in kind, say so"*.
 */

/**
 * 🔴 **Every reason a request may not travel, as a closed vocabulary.**
 *
 * ⛔ **Closed because {@link CHANNEL_REFUSAL_SENTENCES} is keyed by it**, so a sixth reason cannot
 * be added without saying what it is — the shape `an-unenumerated-state-counts-as-success` exists
 * to force.
 *
 * ⚠️ **Four of these are criterion 10's and the last two are not**, and the difference is stated
 * rather than folded away: a secret is not authority, it is a credential, refused because it is a
 * person's to type; and a server's own request (`728`) is not the agent's question at all. See the
 * members.
 */
export const CHANNEL_REFUSALS = [
  /**
   * ⛔ **A command or file approval** — Claude `canUseTool` for anything outside `USER_INPUT_TOOLS`,
   * Codex `item/commandExecution/requestApproval` and `item/fileChange/requestApproval`.
   *
   * ⚑ **The plainest member, and the one criterion 10 is usually read as being about.** Deciding
   * what an agent may do is authority, and authority is a person's.
   */
  'a-permission-decision',
  /**
   * ⛔ **A request for extra access** — Codex `item/permissions/requestApproval`, which arrives on
   * the SAME event type as a question and is told apart by the `permission` field alone.
   *
   * ⚠️ **This is the member that makes the check structural rather than typed.** A reader that
   * asked only *"is this a `permission_request`?"* would hand a parent agent the power to widen its
   * child's sandbox, because on this provider that arrives as a `user_input_request`.
   */
  'a-grant-of-access',
  /**
   * ⛔ **A consent with nothing to answer** — a `user_input_request` whose `questions` are empty.
   *
   * ⚑ **Claude's plan card is this today**: `claudeQuestions` returns `[]` for `ExitPlanMode`, an
   * approval of a plan. (`EnterPlanMode`'s card — approve planning at all — went in `736`, R98: the
   * CLI does not ask it. A row written before then still carries one.) ⚠️ A card whose only control is *approve* is not a question,
   * whatever event type it arrives on.
   */
  'a-consent-with-nothing-to-answer',
  /**
   * 🔴 **A shape this app has not been taught** — a request carrying any key outside
   * {@link QUESTION_REQUEST_KEYS}.
   *
   * ⛔ **The member that makes this an admit-list.** Neither provider sends such a shape today, and
   * that is exactly why it is here: the day one does, the request does not travel and the ledger
   * says a shape nobody had classified arrived. ⚠️ **It cannot be reached after the wire parse** —
   * zod strips the key — which is why the caller classifies the adapter's own event.
   */
  'a-shape-this-app-has-not-been-taught',
  /**
   * ⛔ **A question whose answer is a secret** — `UserInputQuestion.secret`, which Codex sets from
   * its own `isSecret` and Claude has no field for.
   *
   * ⚠️ **NOT criterion 10's permission, and it is named separately rather than folded in.** A
   * secret is not authority — nothing is being approved — it is a credential, and the rule it meets
   * is the same one from the other side: it is a person's to type. ⛔ Routing it would ask an AGENT
   * for a secret and then record a refusal path that had never considered one.
   *
   * ⚑ **Ahead of a shape we have seen, deliberately.** `141` measured that `isSecret` *"is not
   * exposed by the ordinary pinned model-tool schema and defaults false"*, so no ordinary Codex
   * question sets it today — and `absence in a capture is not absence`. The neutral question has
   * carried the flag since `143` precisely so a producer that starts setting it does not find the
   * app unprepared.
   */
  'a-secret-only-a-person-can-type',
  /**
   * 🔴 **728 · A request an MCP SERVER made of the person** — a form, a zero-field form or a url
   * visit, on either provider, marked `mcpServerAsks` by the adapter; ⚠️ except the one `723` F-2
   * leaves open: a frame wearing Codex's marker during a call Codex ran unasked is drawn as Codex's,
   * unmarked.
   *
   * ⛔ **Not the agent's question, and it never was.** It arrived with a question's shape, so until
   * `728` it travelled to a parent agent like one (`728`'s review): an agent could answer a server's
   * form for the person. ⚑ R93 keeps *"saying truly WHO is asking"*, and the provider's own CLI
   * puts a server's form in front of the person (measured, both CLIs); so it stays a person's.
   * ⚠️ Classified by NAME, above the admit-list walk, for `permission`'s and `consent`'s reason: a
   * request carrying the key would otherwise be recorded as a shape nobody had taught.
   */
  'a-server-asks-the-person',
] as const

export type ChannelRefusal = (typeof CHANNEL_REFUSALS)[number]

/**
 * 🔴 **The named set a request must be exactly, to travel** (394 §3).
 *
 * ⛔ **Asserted equal to the admitted shape, never counted.** `353`'s rule — *an inventory equals a
 * NAMED LIST rather than a count* — and the reason a count would be worse than useless here: a
 * provider that dropped `prompt` and added `permission` would keep the count and change the
 * meaning.
 *
 * ⚠️ **`permission` is deliberately absent even though `userInputRequestSchema` declares it.** It
 * is a documented field of the EVENT and an inadmissible one for the CHANNEL, and the difference is
 * the whole of {@link CHANNEL_REFUSALS.a-grant-of-access}.
 *
 * ⚠️ **And `consent` is absent for the same reason** (478). A card that says which way it moves
 * plan mode is a consent, and a consent has nothing to answer — so it is classified by name above
 * this list rather than admitted into it. ⛔ Adding either key here would let a request that is not
 * a question travel.
 */
// ⚑ **`isBlocking` is admitted** (provider follow-ups 1): Codex 0.160.0 sends it on EVERY question
// (`ToolRequestUserInputParams.isBlocking`, required), and the card carries it as data only — it
// changes nothing about what is asked or who may answer. ⛔ Left out, every Codex child's question
// was refused here as an untaught shape and went to a person instead of its parent.
export const QUESTION_REQUEST_KEYS = ['type', 'id', 'prompt', 'questions', 'isBlocking'] as const

const ADMITTED_KEYS: ReadonlySet<string> = new Set<string>(QUESTION_REQUEST_KEYS)

/**
 * What the channel says about one request.
 *
 * ⚠️ **`travels: true` carries the questions**, so a caller that has been told a request may go does
 * not re-read the event and get a second answer. ⛔ It carries no destination: WHERE a question goes
 * is the app's question and this file does not know whether the conversation has a parent.
 */
export type ChannelVerdict =
  | {
      readonly travels: true
      readonly id: string
      readonly prompt: string
      readonly questions: readonly UserInputQuestion[]
    }
  | { readonly travels: false; readonly id: string; readonly because: ChannelRefusal }

/**
 * 🔴 **Classify one provider event: may what it asks travel, and if not, what is it?**
 *
 * ⛔ **`null` means this event asks nobody anything** — it is not a request at all — which is every
 * event but two and is answered by one comparison.
 *
 * ⚠️ **Hand it the ADAPTER'S event, before `toWireEvent`.** See this module's note: the wire parse
 * strips an undocumented key, and `a-shape-this-app-has-not-been-taught` is a fact about the key
 * being there.
 *
 * ⛔ **Read defensively, because the argument may not have passed the contract yet.** The type says
 * `RuntimeEvent`; the value is whatever an adapter emitted, and this runs above the parse that
 * would have refused it. A malformed request is `a-shape-this-app-has-not-been-taught` — the safe
 * reading, and the same one `admitMessaging` takes for a project it cannot place.
 */
export function askedOfTheChannel(event: RuntimeEvent): ChannelVerdict | null {
  if (event.type !== 'permission_request' && event.type !== 'user_input_request') return null
  const asked: Record<string, unknown> = event
  // ⛔ **A request with no id is not a request, and `null` is the honest answer.** Nothing can
  // answer it, nothing can record it against a card, and `runtimeEventSchema` declares `id` required
  // — so the wire parse degrades it to `unknown` and the ledger never says a request happened
  // either. ⚑ Returning a verdict with an invented id would put a routing row beside no request.
  const id: unknown = asked['id']
  if (typeof id !== 'string' || id.length === 0) return null
  // ⛔ **728 · a server's own request by NAME, and FIRST** — {@link CHANNEL_REFUSALS}'s last member.
  // Above the permission branch (`728`'s review), because a server's zero-field form and its url
  // visit are `permission_request`s too, and would otherwise be recorded as the agent's approval.
  if (Object.hasOwn(asked, 'mcpServerAsks') && asked['mcpServerAsks'] !== undefined) {
    return { travels: false, id, because: 'a-server-asks-the-person' }
  }
  if (event.type === 'permission_request') {
    return { travels: false, id, because: 'a-permission-decision' }
  }
  // ⛔ **Asked FIRST, because it is the only refusal that names what the request IS.** An
  // `item/permissions/requestApproval` carries `permission` and an empty `questions`, so the
  // `a-consent-with-nothing-to-answer` branch below would also catch it — and would report a Codex
  // sandbox widening as a Claude plan card. `340`'s finding: a reason answering with another
  // reason's sentence.
  if (Object.hasOwn(asked, 'permission') && asked['permission'] !== undefined) {
    return { travels: false, id, because: 'a-grant-of-access' }
  }
  // ⛔ **And `consent` for the same reason, in the same place** (478). It is a documented field of
  // the EVENT and an inadmissible one for the CHANNEL — exactly like `permission` above — so it is
  // deliberately absent from {@link QUESTION_REQUEST_KEYS}, and a request carrying it would
  // otherwise fall into the admit-list walk below and be recorded as a shape nobody had classified.
  // ⚑ That is `340`'s finding again: a reason answering with another reason's sentence. A consent
  // card IS `a-consent-with-nothing-to-answer`, and it keeps its own name.
  if (Object.hasOwn(asked, 'consent') && asked['consent'] !== undefined) {
    return { travels: false, id, because: 'a-consent-with-nothing-to-answer' }
  }
  for (const key of Object.keys(asked)) {
    if (!ADMITTED_KEYS.has(key)) {
      return { travels: false, id, because: 'a-shape-this-app-has-not-been-taught' }
    }
  }
  if (typeof asked['prompt'] !== 'string') {
    return { travels: false, id, because: 'a-shape-this-app-has-not-been-taught' }
  }
  const questions: unknown = asked['questions']
  if (!Array.isArray(questions) || questions.length === 0) {
    return { travels: false, id, because: 'a-consent-with-nothing-to-answer' }
  }
  // ⚠️ **Every question, not the first.** A request can carry several — `sess_71a5b654` ord 234 sent
  // two in one call (`139`) — and one secret among them makes the whole card a person's, because
  // the providers take one response for the whole request and a partial answer is failed closed by
  // both adapters anyway.
  for (const question of questions as readonly UserInputQuestion[]) {
    if (question.secret === true) {
      return { travels: false, id, because: 'a-secret-only-a-person-can-type' }
    }
  }
  return {
    travels: true,
    id,
    prompt: asked['prompt'],
    questions: questions as readonly UserInputQuestion[],
  }
}

/**
 * ⚠️ **What each refusal means, in one line, for a reader of a ledger** — never for a model.
 *
 * ⛔ **These are not rail sentences and must not become them.** A rail sentence instructs the caller
 * that met it; these describe a routing decision to whoever is reading the record afterwards, which
 * is a person or a test. The sentences a model reads live in `question-rails.ts`, one package over,
 * and `394`'s suite asserts no string is shared between the two.
 */
export const CHANNEL_REFUSAL_SENTENCES: Readonly<Record<ChannelRefusal, string>> = {
  'a-permission-decision': 'a command or file approval, which is a person’s to give',
  'a-grant-of-access': 'a request for wider access, which is a person’s to grant',
  'a-consent-with-nothing-to-answer': 'a consent card with nothing to answer, which is an approval',
  'a-shape-this-app-has-not-been-taught':
    'a request shape this app has not been taught, which is refused rather than guessed at',
  'a-secret-only-a-person-can-type':
    'a question whose answer is a secret, which is a person’s to type',
  'a-server-asks-the-person':
    'a request an MCP server made of the person, which is theirs to answer',
}
