import type { TurnProvenance } from '@brobot2/runtime'
// ⚑ **The recipient vocabulary the direction line renders from** (HO-088 §4.1) — a VALUE import,
// and this module is main-only so nothing about it reaches the renderer bundle.
import { QUESTION_RECIPIENTS } from '../../shared/questions'
import type { WhoDidIt } from '../../shared/who-did-it'
import { foldProfileName } from '../../shared/runtime-ipc'
// ⚑ **A piece is named by its label beside its title**, in the one spelling every surface uses —
// and a conversation by the piece it owns.
import {
  pieceLine,
  theOwnerOf,
  theWorkThatNamesItSaid,
  type WorkThatNamesIt,
} from '../../shared/piece-called'

/**
 * 🔴 **What the MODEL is told about who sent it a turn** (HO-020 §5.3 half 2, `HO-088` §4).
 *
 * ## ⛔ Why it exists: unframed words read as the person's own, on both providers
 *
 * | producer | what the provider receives | carries its origin? |
 * |---|---|---|
 * | **`message_agent`** | **the calling model's string, verbatim** | ⛔ **nothing** |
 * | `deliverQuestion` · `deliverReply` · `tellOneParent` | app-composed sentences | ✔ by id |
 * | the composer | the person's words | ✔ by a rendered line, not by silence |
 *
 * 🔴 **One exception to the third row, by ruling (`R42`)**: a person's message whose first word is a
 * command the provider published goes to the provider EXACTLY as typed, with no line in front of it
 * — see `a-command-goes-as-typed.ts`. ⛔ **The CLI reads a command before any model**, and the frame
 * would stop it from running at all. ⚠️ **A PROMPT command — a skill such as `/code-review` — is
 * then expanded into a turn a model DOES read, without this line**: `R42`'s price — ⚑ **accepted by
 * `R58`**: the `person` stamp rides in its own field, and an agent's message is still always
 * framed. 🔴 **And `R59`, one door over**: a person's `/compact` on a conversation whose adapter
 * compacts on request (Codex's `thread/compact/start`) reaches no model at all — it goes to that
 * request. ⚑ `RuntimeHost.handToProvider` decides both before this file is asked, so
 * {@link messageNamingItsSender} still frames every person's message it is handed.
 *
 * Frame handed-over work with its actual sender. Unframed words can be mistaken for the person's request, giving an agent authority the person never supplied.
 *
 * ## 🔴 The person's turn is framed too: silence carries nothing
 *
 * ⛔ **An unframed turn is not evidence of a person.** {@link RuntimeHost.originOf} answers `null`
 * for {@link THE_APP_ITSELF} too, so silence would be TWO senders, and *not framed, therefore a
 * person* is the dangerous default read from the receiving end instead of the sending one.
 *
 * 🔴 **`HO-088` §1 measured what the inference costs.** Ada, handed a person's words with nothing in
 * front of them, *"had no way to know she was talking to a PERSON at all"* and typed her question
 * back as ordinary chat text. ⚑ **`HO-088` §4 is the ruling**: *"Every message an agent receives
 * says who sent it: the person, or a named agent"* — ⚠️ **rendered from a recorded fact, and the
 * fact it names for this half is *the person's own window*.** ⚠️ **`R42` narrows it, and by less
 * than its own reason says**: a built-in command is consumed by the CLI, but a prompt command (a
 * skill) reaches a model as a turn with no sender line — a finding for the PM.
 *
 * ⛔ **A turn is the person's only when a person demonstrably TYPED it**, asked as
 * {@link aPersonTypedIt} and never as *not an agent and not the app* — which is why the person arm
 * is a positive answer with its own word rather than the absence of the other two.
 *
 * ⚠️ **And what it does not fix, said plainly** (standing rule 15). ⛔ **A model with nowhere to send
 * a question for the person needs a TOOL, not a sentence** — `HO-088` §2 and §3 build it, and
 * neither is in this file.
 *
 * ## ⚑ What the launch layer already says, and why it is not this
 *
 * ⛔ **A spawned conversation is ALREADY told who started it**, in the dynamic layer — *"This
 * conversation was started by Ada (the owner of W1 · Bakery website). That conversation can send
 * you messages, and can still do so after this app has been restarted."* (HO-015 §3;
 * `factory-text.ts` renders it.) ⚠️ **That sentence says who CAN send, and this one says who DID.**
 * A model holding the first and reading an unframed turn has no way to tell its parent's words from
 * the words of the person at the keyboard — and `can_message: 'any'` means the sender need not be
 * the parent at all.
 *
 * ⚑ **Matched by the relationship, and the label is an address.** 🔴 **R3**: the launch line names
 * the parent by the piece it owned when this conversation was last launched, and the direction line
 * names the sender by the piece it owns when the message goes ({@link WhereTheSenderStands.named})
 * — ⚑ its own piece on the chain of the piece the message gives, drives or names. ⚠️ **The two
 * labels agree only while that has not moved**: a conversation that owns a root is always named by
 * its root, but one that owns none is named by a piece, so a parent given more work since the
 * launch can be named by another label now. ⛔ So a model is never asked to compare them: what says
 * a sender is its giver is this line's relationship clause (*"who gave you W1.2.1"*), read off the
 * pieces the receiver holds at each message, and either label addresses that conversation wherever
 * its id would (R1). ⚑ This line says *Sent by* rather than *started by*, because the sender need
 * not be the parent and — for a caller this app does not have yet — need not be a session. A sender
 * that holds no piece has no label, and the direction line addresses it by its full `sess_<uuid>`.
 *
 * ## ⛔ Why naming a session id here is not the address HO-015 §1.3 refuses
 *
 * ⚠️ **§1.3 is about an ARGUMENT** — *"a model-supplied parent address is an addressing primitive
 * an agent could aim… the model names which task it is finishing, never who to send it to."*
 * ⛔ It is enforced by `REPLY_ADDRESSING_KEYS`, which refuses fourteen spellings of a destination
 * **as a parameter**, and by `reply_to_parent` having no destination parameter to refuse.
 * ⚑ **Nothing about this line is aimable**: `message_agent` resolves an id through an entitlement
 * the caller cannot choose, so a conversation outside it answers `no-such-agent` whether the id was
 * overheard, guessed or never minted — and the two refusals are IDENTICAL, which is what stops a
 * reader being walked to enumerate the app's agents.
 *
 * ⚠️ **The bound is the app's reach rule, and it is still a bound a caller cannot choose.** `send`
 * and `queueMessage` admit a conversation the caller did not start through
 * `RuntimeHost.withinMessagingReach`: an agent may message any other conversation except a
 * service's, whose work comes only through `give_work`. ⛔ **The receiver still learns only an id
 * the sender was entitled to reach**, which is the property this paragraph exists to state: the
 * sender does not pick which ids those are.
 *
 * ## ⚠️ What it deliberately does not contain
 *
 * ⛔ **No person, and there is none to name.** The product records no decision actor at all, and the
 * two `display_name` columns hold a name for an AGENT rather than for a person — so neither could
 * fill this clause even when one is set. ⚑ *No invented actor.*
 *
 * An identity's display name, including one generated by `human-names.ts`, names an agent, not the person. {@link ACallerWithAnId.aPersonIsBehindIt} reports that a person is present at the sending conversation, read from the slot; it cannot prove that the sender quotes or paraphrases them. {@link A_PERSON_SENT_IT} names the kind of caller proved by {@link aPersonTypedIt}, consistent with `who-did-it.ts`, not a human identity.
 * Do not infer authority from `role`, which selects text and can be null. {@link WhereTheSenderStands} supplies the sender's name and its open work given to the receiver. A brief also names the work it gives or rebriefs so the receiver can refer to it. A note or follow-up's claimed kind is recorded elsewhere, not rendered here. This provenance framing names no tool and requests no action.
 *
 * ## 🔴 It goes FIRST, where `messageNamingThePiece` goes last
 *
 * ⚠️ **An attribution that follows the words it attributes is a footnote; one that precedes them is
 * a frame.** The surface does the same — `RelayedEntry` puts the sender ABOVE the bubble, because a
 * reader scrolling past must not read the words as theirs and then be corrected. ⛔ The model reads
 * the same string in the same order, so the provider-bound framing is the surface's, and a rule
 * that differed between them would be two answers to *whose words are these*.
 *
 * ⚑ **And it keeps the last-line guard honest rather than stepping around it.**
 * `what-an-agent-is-told-about-its-work.test.ts` §1 slices the LAST line and refuses an address on
 * it; the finishing line is still last, still addresses nobody, and still means *this is yours to
 * finish*.
 */
export type TurnOrigin = ThePersonAtAWindow | ACallerWithAnId

/**
 * 🔴 **The person's own turn, and there is nothing in it** (`HO-088` §4).
 *
 * ## ⛔ Why it is an ARM and not a `null`
 *
 * ⚠️ **{@link THE_APP_ITSELF} answers `null`**, and two senders sharing one value would make *not
 * framed* mean *the person* by elimination. ⛔ **A word makes it a positive answer**:
 * {@link RuntimeHost.originOf} has three arms and each is asked on its own terms, for the
 * provider's string as for the ledger's row.
 *
 * ⚑ **The word is `WHO_DID_IT`'s, byte for byte**, because the fact is the same fact: this is the
 * caller `whoDidIt` writes `a-person` for, decided by the same {@link aPersonTypedIt}. ⚠️ **Two
 * spellings of *a person typed this* would be free to disagree the day either moved**, which is the
 * argument {@link RuntimeHost.originOf} already makes about a row and a line.
 *
 * ## ⚠️ It has no `caller`, and that absence is enforced rather than promised
 *
 * ⛔ **There is no id to put in one.** A window's owner id names a SURFACE — `webContents:3` — and
 * it is meaningless to a receiver, unmatchable against anything the launch layer said, and gone at
 * the next restart. ⚑ **The union is what stops it appearing anyway**: a reader that wants a
 * conversation to write a row into cannot reach this arm at all, which is how
 * {@link RuntimeHost.noteTheSending} keeps its rail — as a compile error, not as a defect in a
 * transcript.
 */
export interface ThePersonAtAWindow {
  /**
   * ⛔ **The discriminant, and {@link WHO_DID_IT}'s own member** — see the type's docblock.
   *
   * ⚑ **Spelled through {@link WhoDidIt} rather than as a bare literal**, so *"the word is the
   * ledger's, byte for byte"* is a thing the compiler checks instead of a thing this docblock
   * claims. ⚠️ A type-only import, so nothing crosses at runtime.
   */
  readonly who: Extract<WhoDidIt, 'a-person'>
  /**
   * ⚑ **Always `null`, and it is the SAME `null` {@link ACallerWithAnId.profile} already means.**
   *
   * ⛔ **Kept on this arm rather than removed**, deliberately: that field's own docblock lists *"a
   * caller that is not a conversation at all"* as one of the three facts its `null` carries, and a
   * window is exactly that. ⚠️ **So a reader of `from?.profile ?? null` gets the same answer for a
   * person as for a caller with no profile.**
   */
  readonly profile: null
}

/**
 * 🔴 **A sender this app has an id for** — an agent's conversation, or a transport this app does not
 * have yet.
 *
 * ⛔ **ONE arm for two of {@link WHO_DID_IT}'s members, because the LINE is one line.** ⚠️ An
 * `agent:` id folds to a conversation and an unrecognised prefix does not, and that difference is
 * real — but both are framed, both are framed with the id, and *"an opaque id is worth more than
 * silence"* is the same sentence for each. ⚑ **A third arm would be a distinction this file makes
 * and nothing in it reads**; `whoDidIt` is where those two are told apart, for a ledger row that
 * has to say which.
 */
export interface ACallerWithAnId {
  /** ⛔ **The discriminant** — see {@link ThePersonAtAWindow} for why there is one at all. */
  readonly who: 'a-caller-with-an-id'
  /**
   * ⛔ **Who asked, in the vocabulary the app mints ids in** — `RuntimeEventSink.ownerId`, folded
   * to the conversation when the caller IS one.
   *
   * ⚑ **Almost always the full `sess_<uuid>`, never shortened**, because almost every caller that
   * reaches a frame is an agent, and a sender that holds no piece is addressed by it (R3: one that
   * holds one is addressed by that piece's label). ⚠️ **It is `ownerId` and not a session for a
   * caller this app does not have yet** — {@link THE_APP_ITSELF}'s own docblock: *"tomorrow the MCP
   * tool a PM would spawn agents through … gets its own prefix from whatever registers it."* ⛔ **An
   * opaque id is worth more than silence**, because silence is what credits a person with words
   * they never wrote.
   *
   * ⚠️ **This is the CALLER and not the message's subject.** Where BroBot composed the words about
   * somebody else, the composed sentence already names the conversation it is about and the
   * caller is {@link THE_APP_ITSELF}, which is answered `null` one branch up.
   */
  readonly caller: string
  /** The conversation was identified at send time, before any ledger reconstruction. */
  readonly knownAtSend?: true
  /**
   * ⚑ **The identity behind it, folded — `agent_identity.slug`, or `null` when that conversation
   * has no identity.**
   *
   * ⛔ **A person typed this string**, into the launcher's name box, and it is the only
   * human-chosen name in the ledger that names an agent at all.
   *
   * ⚠️ **This FIELD is the slug and nothing else, deliberately**, whatever `display_name` holds: the
   * string here is what a model must send back as `profile_slug`, so a friendlier name in its place
   * would hand an agent a word no door of this app accepts. ⚑ The person-facing answer is
   * {@link agentName} and it is a different question — see `human-names.ts`, which is what fills
   * that column.
   *
   * ⛔ **Null when the conversation has no identity**, which is the same `null`
   * `SessionStore.identityOf` returns for a session id that never existed — and also for a
   * {@link caller} that is not a conversation at all. That is three facts sharing one value, and
   * none is worth refusing a turn over: the line drops the clause and keeps the id, which is the
   * half that is always true.
   */
  readonly profile: string | null
  /**
   * 🔴 **Whether a PERSON is at the conversation that sent these words** (criterion 23, HO-024 §4
   * row 23).
   *
   * ## ⛔ What it says, exactly, and what it refuses to say
   *
   * ⚑ **It says a person is THERE. It does not say the words are theirs**, and it cannot: the app
   * sees a model's output and a sink that declared a person is behind it, and nothing in between. ⛔
   * **Whether a person's words were quoted or reworded is not a distinction this app can make.** A
   * quotation and a paraphrase are the same string to every layer that handles it. ⚑ So the honest
   * line states the fact this app observed and names its own limit.
   *
   * ## ⛔ It is DERIVED, and a model has no way to spell it
   *
   * ⚠️ **`SessionSlot.ownerIsAPerson`, copied from {@link RuntimeEventSink.aPersonIsBehindIt} at the
   * instant a sink took ownership** — {@link RuntimeHost.originOf} reads the slot, never the
   * caller. ⛔ **There is no tool argument for it, on any of the fifteen.** A model that could
   * assert *I am asking for a person* would put an agent's words in a person's authority, and
   * `mayAnswerAsAHuman`'s own docblock refuses exactly that shape one door over.
   *
   * ## ⚠️ `false` is the ordinary case and adds no clause
   *
   * ⛔ An agent messaging another agent with nobody watching gets the line it always got. ⚑ The
   * clause appears only where it is TRUE, so a receiver learns nothing from its absence that it did
   * not already know — and a sentence rendered on every turn would be a sentence nobody reads.
   */
  readonly aPersonIsBehindIt: boolean
}

/**
 * ⛔ **The person's turn, as ONE value** — the shape {@link THE_APP_DID_IT} already uses one
 * vocabulary over, and for its reason: a second object literal is a second thing to keep in step,
 * and a mutation on one of two byte-identical literals changes nothing a reader can see.
 */
export const THE_PERSON_AT_A_WINDOW: ThePersonAtAWindow = { who: 'a-person', profile: null }

/**
 * 🔴 **What a model reads above a person's own words** (`HO-088` §4).
 *
 * ## ⛔ What it claims, and it is exactly what {@link aPersonTypedIt} can prove
 *
 * Say that a person typed the turn into an app window, without naming a human the ledger does not identify. Use the same `a person` wording as `WHO_DID_IT_SAYS['a-person']` and `answerText` so one caller kind has one description.
 *
 * ## 🔴 Why there is NO hedge, where the agent line's is all hedge
 *
 * ⛔ **That hedge exists because a MODEL wrote the words** — *"this app cannot tell you whether they
 * quote the person or paraphrase them"* — and a quotation and a paraphrase are the same string to
 * every layer that handles it. ⚑ **Here there is no model in between.** The bytes crossed one
 * boundary, from the composer to the provider, and *typed into this app* is that fact said
 * positively rather than a doubt imported to keep the two sentences looking alike.
 *
 * ⚠️ **Two sentences about one fact that hedge differently teach a reader there are two facts**,
 * which is why the clause is absent and not merely softened.
 *
 * ## ⚑ What it does NOT say
 *
 * ⛔ **No WHAT** — the kind is still with the PO, exactly as the agent line's docblock says. ⛔ **No
 * direction** — see {@link theDirectionLine}, which is a separate sentence for the reason the
 * behalf clause is one.
 *
 * ## ⚠️ On every message a person types, except a command
 *
 * ⛔ **`R42`**: a person's command goes to the provider as typed, with no line in front of it,
 * decided in `RuntimeHost.handToProvider` before this line is ever composed — see
 * `a-command-goes-as-typed.ts`. ⚑ **D-027**: a held message that might be one goes alone, through
 * that door, and never in a turn of several ({@link aTurnOfSeveral}). ⚑ **`R59`**: and a person's
 * `/compact` on Codex is not words at all — it runs Codex's own compaction request.
 */
export const A_PERSON_SENT_IT = 'Sent by a person, typed into this app.'

/**
 * 🔴 **The one line of direction every message carries** (HO-088 §4.1).
 *
 * ## ⛔ It is a HINT, and the PO says so in as many words
 *
 * ⚠️ **`HO-088` §4.2: *"It is a hint and I am not pretending otherwise. `581`'s bound: we can prove
 * what was sent, never what was heeded."*** ⛔ **So nothing enforces it and nothing may.** There is
 * no rail behind this sentence, and `ask_question` refuses a call that names no recipient rather
 * than supplying the one named here — the app does not default it (HO-088 §2.2), and a line that
 * said *"we will send it to your parent if you do not say"* would describe a behaviour this app
 * deliberately does not have.
 *
 * ## ⚑ The recipient choices are RENDERED, which is HO-015 §2 rather than a style
 *
 * ⛔ **PE-005: a person-started conversation has no parent.** This line knows the sender, not
 * whether another conversation gave the receiver a piece. It therefore states the condition for
 * each recipient instead of directing every receiver to `the-parent`. The choices come from
 * `QUESTION_RECIPIENTS`, so a vocabulary change cannot leave a stale spelling in the hint. ⚑ **The
 * WHO is handed in**: the person, or the conversation the line above already named in full — by its
 * agent's name alone, with the piece it owns, so one sender is not spelled out in full twice six
 * inches apart.
 *
 * ## ⚠️ A separate sentence
 *
 * ⛔ **The line above is about WHO SENT IT; this is about WHAT TO DO.** ⚑ A reader that learned the
 * two as one string could not tell which half went missing when one of them did — which is the
 * argument `ACallerWithAnId.aPersonIsBehindIt`'s clause already carries, one fact over. ⚑ **PE-009
 * · a caller's note is not answered by turn text.** The person arm still says who the turn answers.
 * The caller arm says that turn text does not go back to the sender, and names the tools for a
 * response that really needs to be delivered. The caller kind is passed explicitly: an id or a
 * profile name is not evidence that its holder is an agent. ⚑ **Words that hand over a piece say
 * nothing of a note**: their piece line asks for `reply_to_parent`, and *"a note expects no
 * answer"* beside it would read as a contradiction.
 */
export function theDirectionLine(
  who: string,
  sender: 'person' | 'caller' = 'person',
  /** These words give a piece, or its new brief. */
  handsAPiece = false,
): string {
  const aNote = handsAPiece ? '' : 'A note expects no answer. '
  if (sender === 'caller') {
    return (
      `The words you write in this turn do not reach ${who}. ${aNote}` +
      'Reply with message_agent if the sender is a reachable agent. ' +
      'Use answer_question for a waiting question or reply_to_parent to finish work. ' +
      `For questions about work another conversation gave you, ask ${QUESTION_RECIPIENTS[0]} unless the brief says otherwise. ` +
      `With no giver, ask ${QUESTION_RECIPIENTS[1]} for the person's decision. ` +
      'In ask_question, who_answers is required.'
    )
  }
  return (
    `You are answering ${who}. For a question about a piece another conversation gave you, use ` +
    `${QUESTION_RECIPIENTS[0]} unless that piece's brief says otherwise. If no conversation gave ` +
    `you work, use ${QUESTION_RECIPIENTS[1]} when you need the person's decision. ` +
    `ask_question takes who_answers and there is no default.`
  )
}

/**
 * ⛔ **The person's stamp, as ONE value** — {@link THE_PERSON_AT_A_WINDOW}'s reason: a second object
 * literal is a second thing to keep in step, and a mutation on one of two identical literals changes
 * nothing a reader can see.
 */
const A_PERSON_TYPED_THIS: TurnProvenance = { kind: 'person' }

/**
 * 🔴 **The same answer, told to the PROVIDER in the field it has for it** — see `TurnProvenance` in
 * `@brobot2/runtime`.
 *
 * ## ⛔ One value in, and it is the value the frame is rendered from
 *
 * ⚑ **{@link messageNamingItsSender} and this read the SAME `from`, inside the same
 * `RuntimeHost.handToProvider`**, so the sentence a model reads and the stamp its provider reads
 * cannot name two senders. 🔴 **And inside `RuntimeHost.handTogetherToProvider`** (D-027), the other
 * door, for a turn of several held messages: each message's frame and this read its own origin, and
 * {@link theStampOfSeveral} makes their answers the turn's one stamp. ⚠️ This is not a second
 * derivation of *whose words are these*. It is the one `RuntimeHost.originOf` already made, spelled
 * a second way for a second reader.
 *
 * ## 🔴 The three arms, and the security half is the middle one
 *
 * - ⚑ **{@link THE_PERSON_AT_A_WINDOW} → `person`.** It is decided by `aPersonTypedIt` and
 *   nothing else, the same positive test the ledger's `a-person` comes from.
 * - ⛔ **{@link ACallerWithAnId} → `peer`, ALWAYS, whatever the words say.** An agent's
 *   `message_agent` can contain *ultracode*, or any sentence written to look like a person's. The
 *   stamp never reads the text, so the text cannot move it. ⚠️ **This is the trap:**
 *   stamping every turn `person` would let any agent's words pass every gate kept for a person.
 * - ⛔ **`null` → nothing.** BroBot composed these words. Its own sentences are not a person's,
 *   and no `SDKMessageOrigin` kind is true of them: `auto-continuation` is the CLI continuing its own
 *   loop, not a host speaking. An absent stamp is also what every such turn already was.
 *
 * ⚠️ **What `null` covers is wider than it looks**, and every case is right to be absent. The relayed
 * question, a child's reply, an agent's answer and the answer a person gave in a card are all
 * delivered by `THE_APP_ITSELF`, as BroBot's sentence with the other party's words quoted inside it.
 * `originOf` answers `null` for that caller, and `QueuedMessage.origin`'s note says why for the
 * routed question: *"framing those as sent by that child would be false"*.
 * 🔴 **A person's answer quotes the agent's question inside it too**, so stamping that turn
 * `person` would put an agent's words through the person's gate. That is the trap again, one door
 * over.
 *
 * ## 🔴 A person's turn can still carry words nobody typed: the names of what they attached
 *
 * ⛔ **A name can break out of the quotes.** The attachment block quotes each path, and the CLI's
 * keyword matcher ignores anything inside a quoted region. ⚠️ **But that matcher does not read
 * backslash escapes**, so a `"` in a name, which the block writes as `\"`, closes the region early.
 * An agent can name a file `notes" ultracode "x.md`, a person can attach it, and the keyword then
 * sits OUTSIDE every quote of a turn stamped `person`. ⚑ **So a person's turn whose attached names
 * contain a `"` gets no stamp at all.** The words, the frame and the block are untouched. ⚠️ **Not a
 * second escaping rule**: `quotedLiteral` stays the one HOW, and this is a decision about the
 * STAMP. A name without a `"` cannot leave its quotes, because nothing else `JSON.stringify` writes
 * inside them is a `"`.
 *
 * ## ⚑ `name` is the app's ONE naming function, asked only for the arm that has an identity
 *
 * ⛔ **`nameOf` is a parameter, for {@link whoseWordsTheseAre}'s `identityOf` reason**: this stays a
 * pure expression, the host hands it `agentName` over the roster, and a test hands it a function.
 * ⚠️ **A caller with no profile gets no `name` key**, and not the category word *another agent*. A
 * category in a field that says *display name* would be read as somebody's name.
 */
export function provenanceOf(
  from: TurnOrigin | null,
  nameOf: (profile: string) => string,
  /**
   * ⚑ **The paths this turn attaches**, as the block will quote them. The person's arm is the only
   * one that reads them. ⛔ **Required**, so a door that attaches files cannot forget to pass them.
   */
  attached: readonly { readonly path: string }[],
): TurnProvenance | undefined {
  if (from === null) return undefined
  if (from.who === 'a-person') {
    return attached.some((each) => each.path.includes('"')) ? undefined : A_PERSON_TYPED_THIS
  }
  return {
    kind: 'peer',
    from: from.caller,
    ...(from.profile === null ? {} : { name: nameOf(from.profile) }),
  }
}

/**
 * 🔴 **Where an agent sender stands to the receiver** (D-011, proposal §8) — *"Sent by Sam (web-pm),
 * who is giving you W1.2 · Draft the plan"*, *"…, who sends you the new brief of W1.2 · Draft the
 * plan"*, *"…, who gave you W1.1"*, or *"…, another agent; it gave you no work"*. 🔴 **And the piece
 * its words name, when they name one** — *"This message is about W1.1 · Draft the plan
 * (answered)."* — {@link about}.
 *
 * ⚑ **Worked out by the host at the moment the words are handed to the provider**
 * (`RuntimeHost.whereTheSenderStands`), so a message held behind a turn says what is true when it
 * goes, not when it was queued. ⛔ **Read off the pieces the receiver holds** (their giver), never
 * off anything the sender says: a model that could spell a relationship could pose as a giver.
 */
export interface WhereTheSenderStands {
  readonly messageSender?: {
    readonly address: string
    readonly line: string
    readonly receiverLine: string
  }

  /**
   * ⚑ **Its name, the one every surface says** — `agentName` over the roster, which is a person's
   * name for it or its profile's label. `null` when the sender has no profile to name it by.
   */
  readonly name: string | null
  /**
   * 🔴 **The piece THESE words give the receiver, or give a new brief, when they are one** (R4) —
   * its label and title, and which of the two. ⚑ Measured: a brief to an idle receiver goes out
   * BEFORE its `work` row is written, so the rows alone would call its own giver *"another agent"*;
   * the label was taken before the send, which is what lets this line name it.
   */
  readonly handsYou: {
    readonly label: string
    readonly title: string | null
    /** ⚑ Whether these words give the piece, or give it a new brief (`update_work`). */
    readonly as: 'given' | 'rebriefed'
  } | null
  /**
   * ⚑ **The labels of the OTHER open pieces it gave this receiver**, in the order it gave them —
   * never the piece these words give.
   */
  readonly openWorkItGaveYou: readonly string[]
  /** ⚑ **Whether it gave this receiver work that is closed now** — asked only when none is open. */
  readonly gaveYouWorkThatIsClosed: boolean
  /**
   * ⚑ **R3 — the work that names the SENDER** — its root, else its own piece on the chain of the
   * piece these words give, drive or name (`SessionStore.workThatNamesUnder`), else what names it
   * now (`SessionStore.workThatNames`) — the address the answer goes back to (R1), or `null` when
   * it holds no piece: then its id is.
   */
  readonly named: WorkThatNamesIt | null
  /**
   * 🔴 **The piece a note or a follow-up names, as it stands when the words go** — its label, the
   * title it stands under now, and how it ended once it has (answered, taken back, closed). ⛔ Its
   * giver, its holder and whether either is the receiver are not said here: the piece is the
   * sender's to name only as one it gave or holds, and the clause above says where the sender
   * stands. `null` when the words name no piece — a note about none, and every brief, whose piece
   * {@link handsYou} names.
   */
  readonly about: WorkThatNamesIt | null
}

/**
 * ⚑ **What one turn has said so far** — the senders it has named in full, and the pieces whose
 * titles it has given — so that a later message of the same turn names them shorter: a sender by
 * its name alone, a piece by its label. ⚑ One per turn of several, added to as each message is
 * framed, in order ({@link messageNamingItsSender}); a message handed over alone needs none.
 */
export interface WhatThisTurnHasSaid {
  /**
   * The callers whose sender line named them in full, name and profile — each with the name it went
   * by, so two senders of one name are never told apart by that name alone.
   */
  readonly senders: Map<string, string>
  /**
   * The pieces whose titles were given, each with the title said — so a piece renamed between two
   * mentions is said again under its new title.
   */
  readonly titled: Map<string, string>
}

/** ⚑ **A turn that has said nothing yet** — see {@link WhatThisTurnHasSaid}. */
export function aTurnThatHasSaidNothing(): WhatThisTurnHasSaid {
  return { senders: new Map(), titled: new Map() }
}

/**
 * ⚑ **The relationship clause** — its own function so the answers are one decision. ⛔ *"it gave you
 * no work"* only when it never did: a giver whose work is closed is not *"another agent"* to the
 * conversation that did that work. ⛔ And *"another agent"* only of an AGENT — a caller with no
 * profile may be a transport this app does not know (`mcp:…`), and gets no clause. ⚑ **A piece
 * whose title was given already** is named by its label alone.
 */
function whereItStands(
  stands: WhereTheSenderStands,
  anAgent: boolean,
  titled: ReadonlyMap<string, string> = new Map(),
): string {
  const previous = workItGaveYou(stands)
  if (stands.handsYou !== null) {
    const named = pieceLine(
      stands.handsYou.label,
      titled.get(stands.handsYou.label) === stands.handsYou.title ? null : stands.handsYou.title,
    )
    const hands =
      stands.handsYou.as === 'rebriefed'
        ? `sends you the new brief of ${named}`
        : `is giving you ${named}`
    return stands.openWorkItGaveYou.length === 0
      ? `, who ${hands}`
      : `, who ${hands} and ${previous}`
  }
  if (previous !== null) return `, who ${previous}`
  return anAgent ? ', another agent; it gave you no work' : ''
}

function workItGaveYou(stands: WhereTheSenderStands): string | null {
  const open = stands.openWorkItGaveYou
  if (open.length === 1) return `gave you ${open[0]}`
  if (open.length > 1) return `gave you ${open.slice(0, -1).join(', ')} and ${open.at(-1)}`
  return stands.gaveYouWorkThatIsClosed ? 'gave you work that is now closed' : null
}

/**
 * ⛔ **Put the sender in front of the words, or hand the words back untouched.**
 *
 * ⛔ **`null` is THE APP and nothing else**, and all three answers are POSITIVE tests — see
 * {@link RuntimeHost.originOf}. ⚠️ A person's arm carried by the absence of the other two would
 * leave a reader to infer it, and `HO-088` §1 measured an agent failing to. ⚑ **BroBot's own
 * composed sentences keep the silence** — {@link replyText}, {@link questionText} and
 * {@link undrivenWorkText} each name the conversation they are about, and a frame in front would be
 * BroBot introducing itself.
 *
 * ⚠️ **The tempting spelling is *"frame it when the caller is an agent"*, and it is wrong**: a
 * transport that is neither a window nor an `agent:` id would fall through unframed, and its turn
 * would read as the APP's own sentence rather than as the person's — a different wrong answer, not
 * a smaller one. ⚑ *"The dangerous default is the one that credits a person with words they never
 * wrote."*
 *
 * ⚑ **A blank message is the line alone**, the shape `messageNamingThePiece` already uses,
 * because `\n\n` in front of nothing is a turn that opens with an empty line.
 *
 * 🔴 **It frames whatever it is handed, and a person's COMMAND is not handed to it.**
 * `RuntimeHost.handToProvider` sends that as typed first (`R42`, `a-command-goes-as-typed.ts`) — ⛔
 * a frame in front of `/compact` would stop the CLI running it.
 */
export function messageNamingItsSender(text: string, from: ThePersonAtAWindow | null): string
export function messageNamingItsSender(
  text: string,
  from: TurnOrigin | null,
  /**
   * 🔴 **Asked only for an agent's words** (D-011) — see {@link WhereTheSenderStands}. ⚑ A function
   * for {@link provenanceOf}'s `nameOf` reason: this stays pure, the host hands it the store's
   * answer, and a test hands it a function. ⛔ **Required wherever an agent's words can arrive** —
   * the overload above is the only way to leave it out, and it admits no agent.
   */
  standing: (sender: ACallerWithAnId) => WhereTheSenderStands,
  /** Set when somebody asked for the receiver's running turn to be stopped to read this now. */
  interrupting?: AStopAskedFor,
  /**
   * ⚑ **What the turn these words go in has said already**, for a turn of several — see
   * {@link WhatThisTurnHasSaid}. Read, then added to.
   */
  soFar?: WhatThisTurnHasSaid,
): string
export function messageNamingItsSender(
  text: string,
  from: TurnOrigin | null,
  standing?: (sender: ACallerWithAnId) => WhereTheSenderStands,
  interrupting?: AStopAskedFor,
  soFar?: WhatThisTurnHasSaid,
): string {
  // The app's own words carry no sender line; one that stopped a turn still says who asked — the
  // answerer whose answer it is, by name, as a sender's own line names its sender.
  if (from === null) {
    return interrupting === undefined
      ? text
      : withTheLine(theStopBehindIt(whoAskedTheStop(interrupting.askedBy, standing)), text)
  }
  // 🔴 **The person's arm, asked as a POSITIVE word** — see {@link A_PERSON_SENT_IT}. ⛔ Not
  // `from.caller === undefined` and not *"no profile and no id"*: the discriminant is the whole
  // reason {@link TurnOrigin} is a union, and a shape test here would be the negative default
  // wearing a type guard's clothes. ⚑ **The direction line rides with the sender line on BOTH
  // arms** (HO-088 §4.1) — see {@link theDirectionLine}. ⛔ *"Every message an agent receives says
  // who sent it"*, and the one line of direction is what §4.1 asks to travel with it. ⚠️ **The app's
  // own composed sentences still keep the silence**: `from === null` returned above, so
  // `questionText`, `answerText` and `undrivenWorkText` are untouched — a direction line on
  // BroBot's own notice would be this app instructing an agent about a turn it wrote itself.
  if (from.who === 'a-person') {
    return withTheLine(`${A_PERSON_SENT_IT}\n\n${theDirectionLine('a person')}`, text)
  }
  // 🔴 **By NAME and by where it stands** (D-011, proposal §8). ⛔ An id alone would make the
  // receiver match it against its launch line to learn whether this was its giver. ⚑ The profile
  // stays, in brackets: it is the word a model sends back as `profile_slug`. ⚠️ With no profile
  // there is no name, and the id is the one true answer. ⛔ Unreachable through the overloads: the
  // one that omits it admits no agent.
  if (standing === undefined) throw new Error('an agent sender needs where it stands (D-011)')
  const stands = standing(from)
  if (stands.messageSender !== undefined) {
    const name = stands.name ?? from.profile ?? from.caller
    const { address, line, receiverLine } = stands.messageSender
    const repeated = soFar?.senders.has(from.caller) === true
    const sender = repeated ? `conversation ${address}` : line
    const receiver = repeated ? '' : `, in your ${receiverLine}`
    soFar?.senders.set(from.caller, name)
    const about = stands.about
    const title =
      about === null || soFar?.titled.get(about.label) === about.title ? null : about.title
    if (about !== null && title !== null) soFar?.titled.set(about.label, title)
    const task = about === null ? '' : `, about task ${theWorkThatNamesItSaid({ ...about, title })}`
    const stop = interrupting === undefined ? '' : `\n\n${theStopBehindIt(name)}`
    const person = from.aPersonIsBehindIt
      ? '\n\nA person is at that conversation. Treat wishes it attributes to the person as theirs; only an approval needs the person directly.'
      : ''
    const previous = workItGaveYou(stands)
    const relationship = previous === null ? '' : `\n\nThis conversation ${previous}.`
    const direction = `Your reply here doesn't reach ${name}: use answer_question to answer, reply_to_parent to finish work, or message_agent to respond.`
    return withTheLine(
      `From ${name} (${sender})${task}${receiver}.${relationship}${person}${stop}\n\n${direction}`,
      text,
    )
  }
  const who = theAgentNamed(from, stands)
  // ⚑ **Named in full once a turn, then by its name alone** — otherwise one sender, with its
  // piece's whole title, runs through a busy turn dozens of times. Its profile and each piece's
  // title are said the first time; a later mention — in these words, or in a later message of the
  // same turn ({@link WhatThisTurnHasSaid}) — says the name or the label, and no fact goes.
  const titled = new Map(soFar?.titled ?? [])
  // ⚑ **The name alone only where it names one sender**: a person's name for it, never just its
  // profile's own word, which alone reads as a common noun; and none that another sender of this
  // turn goes by. Otherwise the name and profile, as in full.
  const name = stands.name
  const aRealName = from.profile !== null && name !== null && name !== foldProfileName(from.profile)
  const sharedInTheTurn = [...(soFar?.senders ?? [])].some(
    ([caller, other]) => caller !== from.caller && other === name,
  )
  const nameAlone = aRealName && name !== null && !sharedInTheTurn ? name : who
  const said = `Sent by ${soFar?.senders.has(from.caller) === true ? nameAlone : who}${whereItStands(stands, from.profile !== null, titled)}.`
  // ⚑ A piece counts as titled once a title was said for it — never when it was named by its label,
  // and only under the title said: a later, different title is said too.
  if (stands.handsYou !== null && stands.handsYou.title !== null) {
    titled.set(stands.handsYou.label, stands.handsYou.title)
  }
  // 🔴 **And the piece these words name, said last in that paragraph** (below) — so *"who gave you
  // work that is now closed"* is followed by which piece, and how it ended. ⚑ *This message*, its
  // own sentence after the two about its sender: a label names its owner, so *"It is about W1.2"*
  // beside them would read as about a conversation. ⛔ It names the piece, never what kind of
  // message this is. A message that names no piece is unchanged.
  const about =
    stands.about === null
      ? ''
      : ` This message is about ${theWorkThatNamesItSaid(titled.get(stands.about.label) === stands.about.title ? { ...stands.about, title: null } : stands.about)}.`
  if (stands.about !== null && stands.about.title !== null) {
    titled.set(stands.about.label, stands.about.title)
  }
  // ⚑ **These words hand over a piece** — see {@link theDirectionLine}.
  const handsAPiece = stands.handsYou !== null
  // ⚑ **The piece the sender owns, for the address below** — by its label alone once its title has
  // been given, in these words or earlier in the turn.
  const ownerSaid =
    stands.named === null
      ? ''
      : theOwnerOf(
          titled.get(stands.named.label) === stands.named.title
            ? { ...stands.named, title: null }
            : stands.named,
        )
  if (stands.named !== null && stands.named.title !== null) {
    titled.set(stands.named.label, stands.named.title)
  }
  soFar?.senders.set(from.caller, name ?? who)
  for (const [label, title] of titled) soFar?.titled.set(label, title)
  // 🔴 **The behalf half, and it is one sentence with a limit in it** — see
  // {@link ACallerWithAnId.aPersonIsBehindIt}. ⛔ **Appended rather than folded into the first
  // sentence**, because the first is about WHO and this is about WHETHER SOMEBODY ELSE IS THERE,
  // and a reader that learns the two as one string cannot tell which half went missing when one of
  // them does. ⚑ **The second clause is the load-bearing one**: without it a receiver reads *a
  // person is at that conversation* and supplies the inference this app refuses to make for it.
  const line = from.aPersonIsBehindIt
    ? `${said} A person is at that conversation. Treat wishes it attributes to the person as theirs; ` +
      `only an approval needs the person directly.`
    : said
  // ⚑ **The sender is named again here** — by its name alone, the line above having named it in
  // full, so the two still name one conversation one way. 🔴 **And the address rides here**, the one
  // string `message_agent` and `ask_question` take — ⚑ **the piece it owns** (R3; R1: every door
  // that takes an agent takes its label), and its id only when it holds none.
  //
  // ⛔ **Its own PARAGRAPH and not a clause**, which is {@link theDirectionLine}'s own argument
  // made true rather than described: *"a reader that learns the two as one string cannot tell
  // which half went missing when one of them does."*
  const answering =
    stands.named !== null
      ? `${nameAlone}, ${ownerSaid}`
      : who === `\`${from.caller}\``
        ? who
        : `${who}, conversation \`${from.caller}\``
  const stopped = interrupting === undefined ? '' : `\n\n${theStopBehindIt(who)}`
  return withTheLine(
    `${line}${about}${stopped}\n\n${theDirectionLine(answering, 'caller', handsAPiece)}`,
    text,
  )
}

/**
 * ⚑ **Who asked for a receiver's running turn to be stopped so that it would read these words now** —
 * held beside the words until they go in, because the line that says so is composed then.
 * ⚑ `null` is this app.
 */
export interface AStopAskedFor {
  readonly askedBy: TurnOrigin | null
}

/** ⚑ An agent sender, as its sender line names it: by name and profile, else by its id. */
function theAgentNamed(from: ACallerWithAnId, stands: WhereTheSenderStands): string {
  return from.profile === null || stands.name === null
    ? `\`${from.caller}\``
    : `${stands.name} (${from.profile})`
}

/** ⚑ Who asked for a stop, named as {@link messageNamingItsSender} names a sender. */
function whoAskedTheStop(
  askedBy: TurnOrigin | null,
  standing: ((sender: ACallerWithAnId) => WhereTheSenderStands) | undefined,
): string {
  if (askedBy === null) return 'This app'
  if (askedBy.who === 'a-person') return 'A person'
  if (standing === undefined) throw new Error('an agent who asked for a stop needs where it stands')
  return theAgentNamed(askedBy, standing(askedBy))
}

/**
 * What a receiver is told when somebody stopped its turn so that it would read this at once.
 *
 * ⚑ **What the stop ended is named in front of the turn ({@link theStopEnded}), and this defers to
 * that list** rather than restate a rule: which commands a stop ends differs by provider (Claude's
 * CLI ends the one the turn waits on; this app ends, on Codex, the one it ran last unless it used
 * another tool since), and a person's Stop can widen a stop asked for words to every command the
 * turn started. The list is what happened, on every one of those.
 */
export function theStopBehindIt(who: string): string {
  return (
    `${who} asked for the turn you were in to be stopped, so that you would read this message ` +
    `without waiting for that turn to end. If that cut something short, check where it stands ` +
    `before you go on: any of your commands the stop ended are named above, anything not named ` +
    `there still runs, and your open questions are still open.`
  )
}

/**
 * ⚑ **What a stop of a conversation's turn ended**, told once in front of the next turn that takes
 * words, so an agent that started `npm run dev` does not assume it still runs. `named` is the
 * commands, quoted and counted. ⚠️ Not *"your last turn"*: a person's command can run as a turn in
 * between. ⛔ No advice to start them again: a person who pressed Stop may have wanted exactly that
 * work stopped.
 */
export function theStopEnded(named: string, count: number): string {
  return count === 1
    ? `When your turn was stopped, the stop ended ${named}, which no longer runs.`
    : `When your turn was stopped, the stop ended ${named}, which no longer run.`
}

/** How much of a question's own words the line about its ending says back, in code points. */
const A_STOPPED_QUESTIONS_WORDS = 80

/** A question of a conversation's own that a stop of its turn ended: its id and what it asked. */
export interface AQuestionAStopEnded {
  readonly id: string
  readonly prompt: string
}

/**
 * ⚑ **The questions a stop of a conversation's turn ended**, told once in front of its next turn
 * that takes words: each by its own id and the first line of what it asked, so the asker knows no
 * answer is coming and can ask again. ⚠️ Not *"your last turn"*, for {@link theStopEnded}'s reason.
 */
export function theQuestionsAStopEnded(ended: readonly AQuestionAStopEnded[]): string {
  const named = ended.map(({ id, prompt }) => {
    const line = prompt.split(/\r\n|\r|\n/)[0]?.trim() ?? ''
    const points = [...line]
    const asked =
      points.length > A_STOPPED_QUESTIONS_WORDS
        ? `${points.slice(0, A_STOPPED_QUESTIONS_WORDS).join('')}…`
        : line
    return asked === '' ? id : `${id} (“${asked}”)`
  })
  const last = named.pop() ?? ''
  const all = named.length === 0 ? last : `${named.join(', ')} and ${last}`
  return ended.length === 1
    ? `Your question ${all} was ended unanswered when your turn was stopped. Ask it again if you still need the answer.`
    : `Your questions ${all} were ended unanswered when your turn was stopped. Ask them again if you still need the answers.`
}

/**
 * ⚑ **A blank message is the line ALONE** — one composition, so the two arms cannot come to differ
 * about it.
 *
 * ⛔ A second copy of ``text.trim() === '' ? line : `${line}\n\n${text}` `` would be how one arm
 * keeps the rule and the other grows a turn that opens with an empty line. ⚠️ Same shape as
 * `messageNamingThePiece`'s own guard, pointed the other way round because this line goes FIRST.
 */
function withTheLine(line: string, text: string): string {
  return text.trim() === '' ? line : `${line}\n\n${text}`
}

/**
 * 🔴 **Several held messages, as ONE turn's words**: everything waiting goes together, as
 * one turn, oldest first, each marked with who sent it, and each keeps its own tag.
 *
 * ⚑ **A lead, then each message under a heading saying which one it is, in the order they were
 * held.** Each keeps the frame it would have had alone — its sender line, its attachment block, its
 * piece line — so the heading adds only its place. ⚑ But shorter where an earlier message of the
 * turn already said it: a sender named in full before goes by its name, and a piece already titled
 * by its label ({@link WhatThisTurnHasSaid}). ⚠️ **Held order, which is not always the order the
 * words were written**: a held give carries its piece's newest brief (D-022 · R1) at the place the
 * give was held — so the lead says which came first and never which one wins. ⛔ **This app's own
 * words have no sender line** (`from === null`, {@link messageNamingItsSender}), so their heading
 * says whose they are: otherwise a notice after a person's message would read as more of the
 * person's words.
 *
 * ⚠️ **One string, as every turn is** (plain text is the only form that reaches a model), and the
 * lead first — so a turn of several never starts with a command's `/`, and a person's command never
 * rides in one: `RuntimeHost` sends each alone (`R42`).
 */
export function aTurnOfSeveral(
  messages: readonly { readonly words: string; readonly theAppWroteIt: boolean }[],
): string {
  const n = String(messages.length)
  return [
    `${n} messages were held for you and are delivered together in this turn, in the order they ` +
      'were held.',
    ...messages.map(
      (one, at) =>
        `Message ${String(at + 1)} of ${n}${one.theAppWroteIt ? ', written by this app' : ''}.` +
        `\n\n${one.words}`,
    ),
  ].join('\n\n')
}

/**
 * 🔴 **One stamp for a turn of several** (D-027) — {@link provenanceOf}'s answer for each message,
 * when they all agree; ⛔ **otherwise none**, the stamp that claims least. ⚑ So a turn is `person`
 * only when every message in it is a person's, and an agent's words never pass for a person's by
 * riding with them. ⚠️ The price is the person's: in a turn with anybody else's words, theirs go
 * unstamped.
 */
export function theStampOfSeveral(
  stamps: readonly (TurnProvenance | undefined)[],
): TurnProvenance | undefined {
  const [first, ...rest] = stamps
  const same = (one: TurnProvenance | undefined): boolean =>
    one === undefined || first === undefined
      ? one === first
      : one.kind === 'person'
        ? first.kind === 'person'
        : first.kind === 'peer' && one.from === first.from && one.name === first.name
  return rest.every(same) ? first : undefined
}
