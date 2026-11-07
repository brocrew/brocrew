import type { AppNotice } from './app-notice'
import type { HandedPath } from './attachment-contracts'
import type { MoveOrigin } from './move-contracts'
import type { AgentMessageKind, WorkReport } from './work-report-contracts'

export interface HumanFinalContext {
  promptOrdinal: number
  prompt: string
}

export interface HumanTurnAnswer extends HumanFinalContext {
  final: { ordinal: number; text: string; at: number | null } | null
}

export interface HumanAnswers {
  latest: HumanTurnAnswer | null
  /** The ledger assigns late content to its last turn until another turn opens. */
  active: HumanFinalContext | null
}

/**
 * A turn this app sent, in the same ordered stream as the provider's events.
 *
 * No provider reports what we said to it — Codex echoes it back as unrecognized chatter,
 * Claude not at all — so a stream of `RuntimeEvent`s alone is only ever half a conversation.
 * Reopening a session made that visible: the replies came back and the questions did not.
 * It is deliberately NOT a `RuntimeEvent`: nothing said it, we did.
 */
export interface UserTurnEvent {
  /** Positive observation at the window-caller boundary. Missing on legacy/imported rows. */
  humanInitiated?: boolean
  /** The original person message forwarded by a Move press. */
  movedFrom?: MoveOrigin
  type: 'user_turn'
  text: string
  /**
   * ⛔ **What was attached, as its OWN field — never glued into {@link text}** (216 §2).
   *
   * ⚠️ **This is `214`'s defect prevented from the other end.** That dispatch removed 12,646 messages
   * that rendered injected material as *"You"*; concatenating a path onto somebody's sentence and
   * storing the result as their turn is the same mistake pointed the other way — the transcript
   * would render BroBot's words as theirs, permanently, with nothing to tell them apart.
   *
   * ⚑ **The provider still receives one string** — `messageWithHandedPaths` composes it, and
   * `SessionHandle.send`'s words stay one string (216 §1: a Codex `mention` contributes zero content
   * items at the pin, so plain text is the only form that reaches a model at all). ⚠️ `662` added
   * a second argument, which says who wrote the words. It is never a path, and a path is never
   * put in it. This field is
   * BroBot's own record of what it added, which is what lets the transcript separate the two.
   *
   * Absent on every turn that attached nothing, which is almost all of them.
   */
  attachments?: HandedPath[]
  /**
   * ⛔ **Who wrote these words — when the answer is not "the person" (074, and 278 §1).**
   *
   * `undefined` is the ordinary turn: the host watched somebody type it into the composer and hand
   * it over. The two values are the two ways that stops being true, and each is a fact this app
   * cannot verify and must therefore RECORD rather than pretend to check.
   *
   * ## `provider_transcript` — a file said the person said it (074, from 069 §2.4)
   *
   * `import-claude.ts` and `import-codex.ts` read user turns from provider-home JSONL files rather than sends the app observed. A writer with access to those files can supply user-looking messages, so mark that provenance instead of presenting the words as verified typing.
   *
   * It is not fixable by checking harder: from the file's point of view there is nothing to check
   * against, which is exactly why this records the provenance instead of pretending to verify it.
   *
   * ## 🔴 `app_authored` — BroBot wrote them (278 §1, from 276; widened at 406)
   *
   * ⚠️ **This heading used to end *"and the person pressed a button"*, and `406` took that half
   * out rather than adding a value beside it.** ⛔ The clause was true of the one producer that
   * existed and false of the three that exist now: `deliverReply` (393) and `tellOneParent` (400,
   * 404) put BroBot's own sentences into a parent's transcript with nobody pressing anything, and
   * both shipped as the person's *"You"* bubble — `214`'s defect, in a path written after the
   * dispatch that removed 12,646 instances of it. ⚑ **What the value has always MEANT is the
   * sentence at the top of this block**: who wrote these words, when the answer is not the person.
   * A button is a fact about one producer.
   *
   * ⛔ **The subject is {@link work}, not a second attribution value**, so the vocabulary stays two
   * answers to *who wrote this* rather than becoming a list of occasions — see that field.
   *
   * ## 🔴 **413 · it is no longer decided per producer. It is decided from WHO IS ASKING.**
   *
   * Messages and briefs between agents must retain the calling agent's identity when `agent-tools.ts` invokes `queueMessage`. Presenting those words as You gives the receiver apparent authority the person never supplied.
   *
   * Compute provenance once at the host boundary through {@link RuntimeHost.whoseWordsTheseAre}. Only a window passing the positive `aWindowIsAsking` test produces an unmarked person-authored turn; a new transport defaults to app authorship rather than borrowing the person's authority. `words-the-person-did-not-say.test.ts` checks every producer reaching the provider with independent controls.
   *
   * ⚠️ **It therefore covers a producer BroBot did not write the words of**, and `413` §4's ruling
   * is what makes that honest rather than sloppy: *"a turn attributed to the app is not a turn
   * attributed to a named agent unless the ledger holds that name."* ⛔ **Attributing to the app is
   * the weaker claim and it is the safe one.** The name is not thrown away — see
   * {@link relayedFrom} — it is simply not what this field says.
   *
   * `endPlanMode` sends a real message as well as changing mode. The pinned Codex provider needs that sentence to begin work, so retain the send but attribute the words to the app rather than the person.
   *
   * ⚠️ **Still a `user_turn`, deliberately, and that is not a compromise.** It IS a turn: the
   * provider receives it, `045` opens a turn row from this event and from nothing else, and the
   * transcript fold clears the previous turn's activity and error memory on it. A separate event
   * type would have had to be taught to every one of those places, and the first one anybody forgot
   * would be a real provider turn with no row. What changes is the AUTHORSHIP, which is what was
   * wrong — so the authorship is what this field carries, and `transcript.ts` renders an
   * app-authored turn as its own kind of entry rather than as anybody's bubble.
   *
   * The same shape as `(requested)` on a reasoning effort: a value we cannot confirm — or did not
   * come from the person — is shown MARKED rather than either hidden or dressed up as theirs.
   */
  attribution?: 'provider_transcript' | 'app_authored'
  /**
   * 🔴 **What this app-authored turn REPORTS, when the app put it there about work** (406,
   * HO-019 §2) — see {@link WorkReport}.
   *
   * ## ⛔ It is what makes the entry decidable, and that is why it is here and not a second event
   *
   * ⚠️ **`attribution: 'app_authored'` says only that BroBot wrote the words.** Three paths do
   * that today and they are three different things to read: the go-ahead (`endPlanMode`), a
   * child's reply (`deliverReply`), and the notice that nothing is driving work (`tellOneParent`).
   * ⛔ Rendering all three as `ContinuationEntry` — *"sent for you"*, under the go-ahead's own
   * authorship line — would be one word answering two questions, which is `395`'s ruling. ⚑ **So
   * the AUTHORSHIP is the attribution and the SUBJECT is this field**, and `transcript.ts` picks
   * the entry from whether it is here.
   *
   * ⚠️ **Absent on the go-ahead and on every ordinary turn**, which is almost all of them.
   *
   * ## ⛔ It does not make the turn anything other than a turn
   *
   * ⚑ {@link attribution}'s own argument, one field over: the provider receives these words, `045`
   * opens a turn row from this event and from nothing else, and the fold clears the previous
   * turn's activity on it. A separate event type would have had to be taught to all of that.
   */
  work?: WorkReport
  /**
   * 🔴 **The conversation whose agent wrote these words, when BroBot only CARRIED them** (413) —
   * `413` §4's *"unless the ledger holds that name"*, held.
   *
   * ## ⛔ Two producers, and both of them are another conversation speaking
   *
   *  - **`message_agent`** — one agent gives another work. The words are the calling model's, and
   *    this is the conversation it was speaking from ({@link RuntimeHost.sessionSpeakingAs}).
   *  - **`routeRequest`** (394) — a child's question, carried to its parent. Here BroBot composed
   *    the framing and the child wrote the question inside it, and this names the child.
   *
   * ## ⚠️ It is the SUBJECT, beside {@link work}, and that is what makes the entry decidable
   *
   * ⛔ **An `app_authored` turn with neither key is the GO-AHEAD**, which is true of every ledger
   * ever written: before `406` nothing else carried the attribution at all, and `406` gave its two
   * producers `work` in the same spread. ⚑ So the fold reads the subject — `work`, then this — and
   * falls back to the go-ahead's own entry. ⚠️ **Rendering a relayed turn as that entry would put a
   * child's question under *"sent for you"***, which is exactly the falsehood `406` refused to
   * ship and the reason it left `routeRequest` unmarked.
   *
   * ## ⛔ A conversation id, and the RENDERER still does not draw it
   *
   * ⚑ **`413` §4: *"No invented actor."*** The ledger holds the name so that a reader can join this
   * turn to the conversation that produced it; the row a person reads never prints this string,
   * because a handle dressed as a sender is an actor invented out of an id.
   *
   * 🔴 **545 · the row DOES name the relayer now, and it reads the field below rather than this
   * one** — `HO-054` §3, which reversed the second half of `413` §4 and left the first half
   * standing word for word. ⛔ **The reversal is not *invent an actor*; it is that an actor which
   * used to be uninventable is now resolvable** — `449` made a conversation resolvable to an
   * identity and `537` made five surfaces ask {@link agentName} for the words.
   *
   * ⚠️ **The TRANSCRIPT never holds THIS string** — the fold still reads it as present-or-absent —
   * so a replayed row cannot put an unbounded conversation id into a bubble. ⛔ **The raw
   * Events tab DOES print it**, and that is stated rather than glossed: `boundStoredEvent` has no
   * arm for this key, exactly as it has none for `work_given.givenBy` or
   * `request_routed.requestId`. ⚑ An id printed unbounded in the debug stream is a
   * pre-existing class in `describe-event.ts` and not a new one — and it is named here so that
   * whoever bounds one of them bounds all of them. 🔴 **{@link relayedFromProfile} is NOT in that
   * class and never was**: it has a transcript reader from the day it was added, so `545` bounded
   * it in the same commit — which is this paragraph's own *the day either of these gains a reader
   * outside `describe-event.ts`, it leaves the class too*, applied at birth.
   *
   * ## 🔴 `work`'s ids WERE the fourth member and are not one any more (518)
   *
   * ⛔ **This paragraph named four keys and `510` made the classification false for one of them.**
   * The class is *an id printed unbounded in the DEBUG STREAM*, and `work` left it when its ids
   * gained readers in the TRANSCRIPT — since D-016 {@link WorkReport.resources} and
   * {@link WorkReport.owner}: a replayed row's reader draws each, and a press sends the value
   * straight back over the command wire, where an unbounded id would reach a door that bounds it.
   *
   * ⚑ **So `518` bounded that one and left these two here deliberately**, which is the sentence
   * above being kept rather than broken: *bounds all of them* ranges over a CLASS, and the class
   * is what a key can reach. ⚠️ **The day either of these gains a reader outside
   * `describe-event.ts`, it leaves the class too** — and `session-store.ts`'s `boundWorkReport` is
   * the shape that takes it. ⛔ A member with no non-debug reader still belongs here.
   *
   * ⚠️ **Absent on every turn a person typed and on every turn BroBot wrote itself.**
   */
  relayedFrom?: string
  /**
   * 🔴 **WHO relayed it, as opposed to WHERE they were speaking from** (545, `HO-054` §3) — the
   * relaying conversation's identity slug, folded.
   *
   * ## ⛔ The gap it closes, and the gap was measured rather than argued
   *
   * Resolve the actual sender identity at the host where `SessionStore.identityOf` can answer it. {@link relayedFrom} is a session handle, not an identity slug usable by {@link agentName}; a fixed BroBot label is wrong on forwarded manager-to-worker hops.
   *
   * ## ⚠️ `undefined` is *this app cannot name the relayer*, and it is REACHABLE
   *
   * ⛔ **Every row written before `545` carries {@link relayedFrom} and not this** — which is the
   * durable second case, not a hypothetical one: a person reopening a conversation from last week
   * meets it. ⚑ It is also what a conversation with no identity answers, the same `null`
   * `identityOf` returns. ⚠️ **The row then says what it can rather than inventing a name** — see
   * `relayed-turn.ts`'s `AN_UNNAMED_RELAYER`, which exists for exactly this value and says so.
   *
   * ⛔ **Never a display name.** This is the folded slug, so one edit to `agent_identity.display_name`
   * moves every surface at once ({@link agentName}) instead of freezing a friendly word onto a row
   * that can never be re-read.
   *
   * ⚠️ **It cannot travel without {@link relayedFrom}** — one writer puts both on the row, and
   * {@link TurnAuthorship} is what makes that structural rather than remembered.
   */
  relayedFromProfile?: string
  /**
   * 🔴 **The piece of work these words DELIVER, when they are a brief or a new brief** (671 · `658`
   * G2 as a task; a piece since D-016) — {@link WorkGivenEvent.piece}.
   *
   * ⚑ **The TURN names the piece**, so the words the owner reads are joined to the work on both
   * branches: the idle branch has no held message to join through, and the held branch's flushed
   * turn carries the same key. ⛔ **Never inferred from the text**: the provider's copy of a brief
   * QUOTES the label and this row's {@link text} does not — `216`'s rule, one string for the model
   * and another in the ledger — so no reader could have parsed it out, and none may.
   *
   * ## ⚠️ The ORDER in the ledger differs by branch, and a reader must not assume one
   *
   * ⚑ **Idle:** this turn FIRST, then the `work_given` row — written once the provider has taken
   * the brief. ⚑ **Held:** the `message_queued` row, then `work_given`, and this turn when the
   * message flushes. ⛔ **So a reader that joins the turn to its piece joins in both directions.**
   * ⚑ A new brief's turn always comes after its {@link WorkRebriefedEvent}, which is written first.
   *
   * ⚠️ **Written only on a brief `give_work` sent, or a new brief `update_work` sent** — a person's
   * turn, a note, a follow-up, a reply, a routed question and a notice deliver no piece; what they
   * drive is {@link drives}. ⛔ **Absent on every turn written before D-016**: a task id such a turn
   * carries is under another key, which nothing reads. ⚑ Bounded on replay (`session-store.ts`): a stored value this app could not have
   * minted is dropped, and the turn still reads as relayed.
   */
  piece?: string
  /**
   * 🔴 **The piece's label, beside it** (687 · `678` H6 as a task's number; a label since D-016) —
   * {@link WorkGivenEvent.label}.
   *
   * ⚑ **On both branches**: the label is taken before the brief is sent (D-016 · R4), so a page that
   * starts at this turn — a resume, a recording, a window's release — can name the piece without the
   * `work_given` row. ⛔ **Present only beside {@link piece}**; the replay bound drops a label that is
   * not one `pieceCalled` spells.
   */
  label?: string
  /**
   * 🔴 **D-016 · commit 6 · R4 — the piece of THIS conversation's these words drive, when they name
   * one**: the piece a note, a follow-up, a notice, a question or an answer names, when this
   * conversation holds it — or the piece of its own that the named piece hangs under (a child's
   * reply, a stall notice about it, its question). ⚑ The turn drives that piece and no other
   * (`derivePieces`); a piece this ledger holds no row for — its root, or work that is not its own —
   * drives nothing. ⛔ Absent on words that name no piece — a person's, a note about none, the
   * go-ahead — which drive every open piece, as every row written before commit 6 does; and absent
   * on a brief and a new brief, whose {@link piece} names what they drive. Bounded on replay: an id
   * this app could not have minted is dropped.
   */
  drives?: string
  /**
   * 🔴 **What the AGENT that sent these words said they are** (687 · `678` H1) — one of
   * {@link AGENT_MESSAGE_KINDS}, the same word the sender's {@link MessageSentEvent.kind} records.
   *
   * ⛔ **The gap: a card could not say *question* positively.** A missing task id meant a
   * question, a routed request OR a turn written before `671` — three things one absence could not
   * tell apart. ⚑ **This is the sender's own declaration, carried to the receiver's row**, so the
   * two ends of one exchange cannot disagree about what it was.
   *
   * ⚠️ **A CLAIM, and labelled as one** — {@link MessageSentEvent.kind}'s own rule. ⛔ Since D-010
   * an agent must name the kind — `message_agent` refuses a call without one — so there is no
   * default here to have been taken for it. A row written before D-010 may say `question`, which is
   * no longer a kind: readers ask `isAgentMessageKind` and show nothing for it.
   *
   * ⛔ **Written ONLY when an agent's conversation sent the words with `message_agent`** — through
   * `RuntimeHost.whoseWordsTheseAre`. ⚠️ **Absent on a person's turn, on everything the app wrote —
   * a reply, a notice, the go-ahead — on a brief `give_work` or `update_work` sent, which
   * {@link piece} names, and on a question the app ROUTED**, which names the child it came from
   * ({@link relayedFrom}) and yet was never declared by anybody. ⛔ Absent on every row written
   * before `687`: *not recorded*, never *a question*.
   *
   * ⚠️ **One path would write it undeclared, and nothing reaches it** (`687`'s review): `send` and
   * `sendInterrupting` hold a lost race through `queueAs` as a `note`, so an AGENT caller there
   * would be recorded `note` when it lost and nothing when it won. ⛔ Only a window reaches either
   * door today (`ipc.ts`), and a window's turn carries no `says` at all.
   */
  says?: AgentMessageKind
  /**
   * 🔴 **This app's OWN report of something it observed** (624, `HO-095` §6.1) — see
   * {@link AppNotice}.
   *
   * ## ⛔ A SUBJECT, in {@link work}'s and {@link relayedFrom}'s family
   *
   * ⚠️ **{@link attribution} already said the app wrote the words; nothing said what they are
   * ABOUT.** ⛔ That is `WorkReportItem`'s own argument — *"`app_authored` says BroBot wrote the
   * words; it does not say what they are ABOUT"* — and the fold's fallback for an app-authored
   * turn with NO subject is the plan go-ahead's entry, captioned with the control a person
   * pressed. ⚑ `615`'s decision carrier and `591`'s person-answered question reach that fallback
   * and nobody pressed anything for either.
   *
   * ## ⚠️ Absent is the GO-AHEAD, and it has to stay that way
   *
   * ⛔ **Every `app_authored` turn written before `624` is a plan go-ahead**, so the absence is a
   * fact about those rows rather than a gap. ⚑ Marking the go-ahead instead and defaulting the
   * rest would have re-captioned every ledger already on disk — {@link QueuedMessageEvent.kind}'s
   * shape and {@link QueuedMessageEvent.messageId}'s, pointed at a reader instead of at a writer.
   *
   * ⚠️ **It cannot travel without {@link attribution}**, which {@link TurnAuthorship} is what
   * makes structural: one writer puts both on the row.
   */
  appNotice?: AppNotice
  /** The answer this delivery carries, without the surrounding question notice. */
  answeredQuestion?: AnsweredQuestion
  /**
   * 🔴 **The messages this ONE turn delivered, oldest first, when there were several**:
   * everything waiting goes together, as one turn, each marked with who sent it, and the ledger
   * keeps one `user_turn` per delivery, with an optional `parts` list.
   *
   * ⚑ **Each part is what a turn of that one message would have carried** — its words as sent, its
   * attachments, who wrote it (the authorship), the piece it gives or the piece it drives — so a
   * reader reads a part as it reads a turn ({@link theMessagesOf}). ⚠️ How its sender stands to
   * this conversation is not stored: it is worked out from the work at the handover, as it is for a
   * turn of one message.
   *
   * ⛔ **Written only with two or more.** A turn of one message keeps the shape it always had, and
   * then {@link text} and the keys above are its own. With parts, the turn carries {@link text} —
   * the parts' words joined, what `045`'s turn row and the search read — and nothing else: who wrote
   * what is on each part. ⛔ **So a row with parts is never read through its own top level**, which
   * would be a person's (413's default) — see {@link theMessagesOf}. ⚠️ Absent on every row written
   * before D-027, and bounded on replay (`session-store.ts`).
   */
  parts?: readonly UserTurnPart[]
  /**
   * ⚑ **Words this turn opened with asked for the turn before it to be stopped**, so they would be
   * read at once — a message or an answer that interrupts. ⚑ That turn's work is this turn's: the
   * pieces the stop cut are driven by it ({@link derivePieces}). ⚠️ Of the turn, never of a part.
   */
  askedForTheStop?: true
  /**
   * ⚑ This app started this turn with nothing new, after it repaired the sign-in a turn of this
   * conversation was refused on before doing anything: the agent answers the message its thread
   * already holds, which was not sent again. {@link text} is empty. ⚠️ Of the turn, never of a part.
   */
  carriesOn?: true
  /**
   * The host carried the retained give on after an account change, rather than a repaired copy.
   * Present only with carriesOn; the window displays this fact without inferring it from a provider.
   * Of the turn, never of a message part.
   */
  carriedOnAfterAccountChange?: true
  /**
   * 🔴 **F093 · R2 — the whole text the provider was handed for this turn**: the words in the
   * lines BroBot puts around them — the sender line, the direction line, the piece line, a stop
   * line, a held-messages header, the attachments block — and, on Codex, the first-turn lead.
   * ⚑ The same as {@link text} for a person's command, which goes as typed. ⚠️ Absent on rows
   * written before F093, and where no words were handed over (a person's `/compact` on Codex).
   * ⛔ {@link text} stays the words alone: the transcript draws those.
   */
  sent?: string
  /**
   * ⚑ **W4.179 — on Codex, this conversation's own text in front of {@link sent}**: whether it was
   * the whole of it or only the sections that changed since the thread got it, and how many of
   * {@link sent}'s characters it is. ⚠️ Absent when nothing rode in front, and on rows from before.
   */
  lead?: LeadInFront
}

/** ⚑ **W4.179 — the lead in front of a Codex message's text**: which, and how long. */
export interface LeadInFront {
  readonly is: 'whole' | 'what-changed'
  /** How many of the message's `sent` characters it is, the blank line after it not counted. */
  readonly chars: number
}

/**
 * 🔴 **The keys that say a turn is not the person's — as one value** (413; a fourth at 545).
 *
 * ⛔ **`406` wrote two of them in one spread so neither could travel without the other, and said
 * so: *"There is one writer for both keys and it is this expression."*** ⚠️ There were four
 * expressions by then — `send`, the flush, and two the flush reads from — and the held path had to
 * rebuild the pair out of a field it happened to have kept. ⚑ **Naming the value is what makes the
 * one-writer claim structural**: {@link RuntimeHost.whoseWordsTheseAre} produces it, the mailbox
 * carries it whole, and the flush spreads it rather than re-deriving it from a proxy.
 *
 * ⚠️ **It said *three* until `545` and the count is gone rather than corrected**, which is
 * `a-number-can-survive-the-death-of-its-derivation` applied to the sentence that would next go
 * false: {@link UserTurnEvent.relayedFromProfile} is the fourth key, and a fifth must not need
 * this line edited again. ⛔ **The two relay keys are one fact in two halves** — the conversation
 * and the identity behind it — so nothing may put one on a row without the other.
 *
 * 🔴 **687 · the HELD rows carry it WHOLE now, `attribution` included** (R22). ⛔ Until `687`
 * `heldAuthorship` took `attribution` off before a `message_queued` or a `message_unqueued` was
 * written — *"a held row is not a turn"* — and the go-ahead, whose authorship is `attribution`
 * ALONE, reached its held row as `{}`: the person's shape. ⚑ **Who wrote the words is a fact about
 * the words and not about whether they were sent yet**, so a held row and the turn it becomes say
 * the same thing about it, and one reading — the SUBJECT picks the entry, `attribution` alone is
 * the go-ahead, `{}` is the person — serves all three rows.
 *
 * ⚑ **{@link UserTurnEvent.says} rides in here too** (687), because it has the same writer and
 * the same journey: {@link RuntimeHost.whoseWordsTheseAre} decides it at the door, the mailbox
 * carries it, and the flush spreads it.
 *
 * ⚠️ **`{}` is a turn a person typed**, and it is the only shape that is.
 */
export type TurnAuthorship = Pick<
  UserTurnEvent,
  | 'humanInitiated'
  | 'attribution'
  | 'work'
  | 'relayedFrom'
  | 'relayedFromProfile'
  | 'appNotice'
  | 'says'
  | 'answeredQuestion'
  | 'movedFrom'
>

export interface AnsweredQuestion {
  readonly requestId: string
  /** The answering conversation, or null when a person answered. */
  readonly answeredBy: string | null
  /** Answer-only text, bounded to the message family's preview limit. */
  readonly answer: string
  readonly cannotAnswer?: true
  readonly clipped?: true
}

/**
 * ⚑ **D-027 · one message of a turn that delivered several** — see {@link UserTurnEvent.parts}.
 * ⚑ **F093 · not {@link UserTurnEvent.sent}**: the text handed over is the whole turn's.
 */
export type UserTurnPart = Omit<
  UserTurnEvent,
  | 'type'
  | 'parts'
  | 'askedForTheStop'
  | 'carriesOn'
  | 'carriedOnAfterAccountChange'
  | 'sent'
  | 'lead'
>
