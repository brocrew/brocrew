import type { PersistedEventInfo } from './runtime-ipc'
import { WHO_DID_IT, WHO_DID_IT_SAYS, type ActedBy, type WhoDidIt } from './who-did-it'

/**
 * 🔴 **Telling *somebody stopped this* from *this broke*** (395, HO-007 S5) — the reading, and the
 * enumeration of every place it has to be readable.
 *
 * ## ⛔ Why this file exists at all
 *
 * ⚠️ **Interrupt a turn and the provider stops mid-sentence, which is what a provider dying looks
 * like too.** A person watching sees the same thing either way: work that stopped. ⛔ **If a person
 * cannot tell the two apart, this app manufactures false provider bugs** — somebody reports a
 * crash, and what happened is that their agent's parent pressed stop.
 *
 * 🔴 **And no single field can tell them apart.** `turn.state === 'interrupted'` has four producers
 * — {@link SessionMachine.forceEnd} from `interrupt()`, the same call from `close()`,
 * `terminalizeErrored` when a fatal error lands on a turn an interrupt was already requested for,
 * and `failTurn` — plus a fifth: the PROVIDER's own word (Codex `turn/completed{status:'interrupted'}`,
 * Claude `terminal_reason: 'aborted_*'`). ⚑ **The discriminator is a PAIR of neighbouring rows, not a
 * field**, which is exactly why it has to be a named fold rather than a reading each surface
 * performs for itself. ⚑ **Since `720` (R71) the first four carry `wordOf: 'this-app'`** on the
 * `turn` row, so WHOSE word it is is a field — rows before `720` carry none, and who ASKED is still
 * the neighbouring row.
 *
 * ⚠️ **709 · R43 — the fifth used to be the machine's, not the provider's.** ⛔ A permission `cancel`
 * latched `requestInterrupt()` and `completeTurn` then RENAMED the provider's own outcome
 * `interrupted` — so a turn the provider completed after an ask read `it-was-stopped`. ⚑ Since `709`
 * `completeTurn` records the provider's word. ⚑ The latch still decides the word of two of the
 * machine's own four — `failTurn` and a fatal error (`terminalizeErrored`); `forceEnd` sets it itself
 * and always says `interrupted`.
 *
 * ⚠️ **492 moved one Cancel door from the latch to the provider's word.** ⛔ On the Codex agent-tool
 * card the latch was the ONLY thing producing `interrupted` — the provider was never asked to stop,
 * so an ordinary completion was renamed. ⚑ That door now sends `turn/interrupt` and the word arrives
 * as the provider's own. **The doors that tell the provider** — a command or file approval's
 * `{decision:'cancel'}`, and Claude's `interrupt: true` — kept the latch, and since `709` their word
 * is the provider's too. ⚑ **`720` closed the rest**: every Cancel door latches (R71), and the
 * external-MCP elicitation card — whose `{action:'cancel'}` goes to the MCP server and let the turn
 * run on to `completed` (`probe:codex-external-mcp` arm H) — also asked the card's own turn to stop
 * (R74). 🔴 **`736` (R97) took that back**: the Codex terminal's own Esc lets the turn run on, and
 * *"BroBot adds no stop of its own to a Cancel"* — so every elicitation card's Cancel is only the
 * server's answer, and its row says so (`stopsNothing`).
 *
 * ## 🔴 494 · a Cancel writes no `work_interrupted`, and it never had to
 *
 * ⛔ **`492` filed the absence as a finding and priced the wrong repair** — a second
 * {@link WorkInterruptedEvent} from `RuntimeHost.respondPermission`. ⚑ **The actor was already
 * recorded**: {@link UserDecisionEvent.by} has carried it since `477`, written unconditionally by
 * the one writer that can spell `cancel`, on a row this fold was simply not reading.
 *
 * ⚠️ **So `494` moved the READER and wrote nothing new.** `491`'s assertion — *a cancel writes no
 * `work_interrupted`* — is still true, and HO-029 §2.2's *do not backfill* was never in the way,
 * because nothing is backfilled. 🔴 **The fold now reads a second producer**, and
 * {@link whoCancelledIt} is the one derivation all three readers of it share.
 *
 * ## ⛔ Two questions, and neither is derived from the other
 *
 * ⚠️ **{@link HowWorkStopped} is about the WORK; {@link WhoStoppedIt} is about a GESTURE.** They
 * are independent, and folding them into one vocabulary is how *"it was stopped"* comes to imply
 * *"a person did it"* — which is the false sentence this dispatch found shipped
 * (`ENDING_SENTENCE.interrupted`, since `222`).
 *
 * ⚑ **The case that proves they are independent**: a turn can be asked to stop and finish anyway —
 * no longer narrow since `709` (R43): Codex completes a turn after `turn/interrupt`
 * (`probe:codex-early-interrupt`) and the ledger records its word. So {@link StopReading.how} may
 * read `it-finished` while {@link StopReading.who} names an agent — and both statements are true,
 * and since `720` (R72) the stall notice says both.
 *
 * ## ⚠️ What this fold deliberately does NOT read
 *
 * ⛔ **`user_command`.** That event records *which control a PERSON pressed* and is gated on
 * `mayControl`, so it is silent for every commanded gesture — `runtime-host.ts`'s `noteUserCommand`
 * says so in as many words: *"A commanded `sendInterrupting` or `interrupt` therefore writes NO
 * breadcrumb, silently."* ⚑ A fold that read it would answer *"nobody"* for every agent-driven stop,
 * which is the defect, not the reading.
 *
 * ⛔ **`status`.** `idle` follows an interruption and a recoverable fault alike, and `errored`
 * follows a fatal one — but a status is about the SESSION and this is about one turn. The three rows
 * below all carry the turn they belong to (`events.turn_id`); a status arriving after the terminal
 * does not.
 */

/**
 * 🔴 **Every place an interruption or a fault can be observed** (395 §1) — the search shape the
 * distinguishability claim is measured against.
 *
 * ⛔ **A closed list, so *"they differ everywhere"* is a loop rather than three assertions somebody
 * chose.** ⚑ Adding a fourth surface that can show an ending is adding a member here, and the day
 * that happens the census in `the-interruption-that-looks-like-a-fault.test.ts` has no reading for
 * it and goes red — which is the whole reason the enumeration is data and not a paragraph.
 *
 * ⚠️ **`the-ledger` is this file; the other two are read where they live** — the transcript's words
 * are the renderer's (`ending.ts`, `transcript.ts`), and what a parent is told is `agent-tools.ts`'s.
 * ⛔ Pulling either into this module would drag a surface into `shared/` to make a test tidier.
 */
export const WHERE_A_STOP_IS_OBSERVED = [
  'the-ledger',
  'the-transcript',
  'what-a-parent-is-told',
] as const

export type WhereAStopIsObserved = (typeof WHERE_A_STOP_IS_OBSERVED)[number]

/**
 * 🔴 **What happened to the WORK** — five answers, and `nothing-has-said` is one of them.
 *
 * ⚠️ **`it-was-stopped-and-it-faulted` is a real state and not a tidy-up.** `SessionMachine`'s
 * `terminalizeErrored` writes `interrupted` when a fatal error lands on a turn whose interrupt was
 * already requested, so the ledger holds both facts — and reporting only one of them would be this
 * app choosing which half of what it saw to tell you. ⛔ *An unenumerated state counts as success*
 * is the defect one direction; picking a winner between two recorded facts is the same defect the
 * other way.
 *
 * ⚠️ **`nothing-has-said` is the absence, and it says what was not seen rather than what did not
 * happen** — `222` §3's rule for `unknown`, one fold over. A turn with no terminal row is one this
 * app stopped watching, not one that never ended.
 */
export const HOW_WORK_STOPPED = [
  'it-finished',
  'it-was-stopped',
  'the-provider-faulted',
  'it-was-stopped-and-it-faulted',
  'nothing-has-said',
] as const

export type HowWorkStopped = (typeof HOW_WORK_STOPPED)[number]

/**
 * 🔴 **Who a row may name as the actor of a stop** — the READER's vocabulary since `494`, and
 * since `501` the WRITERS' as well.
 *
 * ## ⛔ There were two, because the two producers spelled the actor differently
 *
 * ⚠️ **`340` deferred naming the actor and `395` minted the first vocabulary**, a hand-written
 * `WHO_ASKED_IT_TO_STOP = ['a-person', 'an-agent']`, because `RuntimeHost.recordTheAsk` spelled
 * its own two words from `sessionSpeakingAs` alone. ⚑ `494` then gave the fold a SECOND producer
 * — {@link UserDecisionEvent.by}, a permission answered `cancel` — whose vocabulary is
 * {@link WHO_DID_IT}'s, and a reading left at the first producer's two would have had to DROP a
 * word the second one can write. ⛔ The reader's `null` already means *no row says*, and two
 * meanings for one absence is the defect `494` removed.
 *
 * 🔴 **`501` retired the pair rather than widening it.** `recordTheAsk` asks
 * `RuntimeHost.whoDidIt` like every other writer and refuses the app, so what
 * {@link WorkInterruptedEvent} can hold IS this type — by construction, and for every member
 * {@link WHO_DID_IT} gains after this one. ⚑ **The two vocabularies were one question asked
 * twice**, and the hand-written one was the half that could drift.
 *
 * ## ⚠️ Derived with `Exclude`, so a fifth caller kind cannot be missed
 *
 * ⛔ **Never a hand-written list.** A member added to {@link WHO_DID_IT} lands here the day it is
 * added and already owes a sentence to {@link WHO_DID_IT_SAYS} — so a reading can never be handed
 * an actor it has no words for.
 *
 * ## 🔴 `the-app-itself` is excluded, and it is a refusal rather than a preference
 *
 * ⛔ **Neither producer can put it here, and each refuses it in its own code.**
 * `mayAnswerAsAHuman` opens with `by !== THE_APP_ITSELF`, so the app cannot answer a card and
 * `RuntimeHost.respondPermission` writes no row for it; and `RuntimeHost.recordTheAsk` returns
 * without writing a row when the caller is the app. ⚑ Two actual refusals rather than this
 * paragraph — and `501` had to add the second one, because until then that caller was written
 * down as a person.
 *
 * ⚠️ **The reason is the one `395` gave when it drafted a `this-app` member and removed it**:
 * *the app never asks a turn to stop as an act of its own — it closes a conversation because a
 * person or an agent said to, and the row records whichever of those it was.* ⛔ The state that
 * member reached for is still reachable and still honest: a conversation closed mid-turn is
 * stopped with no ask written at all, and the reading is `it-was-stopped` with
 * {@link StopReading.who} `null` — *it was stopped, and this ledger does not say by whom*.
 * ⚑ **A truthful absence, where `this-app` would have been a guess dressed as a fact** — and a
 * false actor in a durable record is worse than an absent one (HO-037 §3).
 *
 * ⚠️ **`a-caller-this-app-cannot-name` is IN for the opposite reason.** `whoDidIt` returns it for
 * a caller that is neither a window nor a conversation, and such a caller reaches
 * `mayAnswerAsAHuman` the moment its sink declares a person — {@link WhoDidIt}'s own shipped
 * argument, not a new one. ⛔ A reading with no home for it would report that press as nobody's,
 * and until `501` the other producer reported it as a person's.
 */
export type WhoStoppedIt = Exclude<WhoDidIt, 'the-app-itself'>

export const WHO_STOPPED_IT: readonly WhoStoppedIt[] = WHO_DID_IT.filter(
  (who): who is WhoStoppedIt => who !== 'the-app-itself',
)

/**
 * 🔴 **The actor of a permission answered `cancel`** (494) — `null` when no row names one.
 *
 * ## ⛔ ONE derivation and three readers
 *
 * ⚠️ **{@link howWorkStopped}, `derivePieces` and `SessionStore.lastAskToStop` all ask this.**
 * {@link stoppedBy}'s standing rule applies to a derivation exactly as it does to a sentence:
 * three spellings would be three chances to disagree about who pressed one button, and two of
 * those readers sit on ONE payload — `AgentCard` carries `lastEndedTurn` and `lastAskToStop`
 * together, which is the pair `484` was dispatched about.
 *
 * ## ⚠️ `undefined` is HO-029 §2.2, and it stays `null` for ever
 *
 * ⛔ **A `user_decision` with no `by` was written before this app recorded who** — never *an actor
 * we failed to write*. ⚑ Nothing backfills, so a cancel from before `477` answers `null` for as
 * long as its ledger exists, and it is the same `null` a turn nobody asked to stop answers.
 *
 * ## 🔴 A cancel this app cannot name CLEARS an earlier ask
 *
 * ⛔ **It does not inherit one.** `394`'s rule in every caller is *the last ask wins*; returning
 * *keep whatever you had* would put an agent's name on a person's press — `491`'s defect, one
 * producer over. ⚑ So the callers assign this result whether or not it is `null`.
 *
 * ## ⚠️ It is the LEDGER boundary, which is why it re-asks what the type already answers
 *
 * ⛔ **A persisted payload is `JSON.parse`d and CAST, never re-parsed** — `isWhoDidIt`'s rule — so
 * `by.who` arrives as whatever a build with a different vocabulary wrote, and `by.agent` may be
 * missing on an arm this build requires it on. ⚑ A word with no sentence is dropped rather than
 * printed, and a missing id reads as the bare word exactly as {@link stoppedBy} has always read it.
 */
export function whoCancelledIt(by: ActedBy | undefined): Pick<AskToStop, 'by' | 'asker'> | null {
  if (by === undefined) return null
  // ⚠️ **`typeof` rather than the arm.** {@link ActedBy} guarantees the id on this arm and a
  // REPLAYED row does not, so the bare word is what a row written without one reads as — which is
  // the sentence {@link stoppedBy} has carried since `484`.
  if (by.who === 'an-agent') {
    return { by: 'an-agent', asker: typeof by.agent === 'string' ? by.agent : null }
  }
  // ⛔ **Two drops, and they are different questions.** `the-app-itself` is the member this build's
  // own producers cannot write — see {@link WhoStoppedIt}, where the exclusion is argued and the
  // rail named. The membership test is the LEDGER boundary: a word from a build whose vocabulary
  // has moved arrives here as a string, and `isWhoDidIt`'s rule is that it is dropped rather than
  // printed.
  if (by.who === 'the-app-itself') return null
  if (!(WHO_STOPPED_IT as readonly string[]).includes(by.who)) return null
  return { by: by.who, asker: null }
}

/** One turn's ending, as the ledger can state it. */
export interface StopReading {
  /** What happened to the work. Never says who. */
  readonly how: HowWorkStopped
  /**
   * ⛔ **Who asked, or `null` because no row says.**
   *
   * ⚠️ **`null` beside `it-was-stopped` is a REACHABLE and honest pair**, not a gap: a conversation
   * closed mid-turn is stopped by a teardown that writes no ask at all. ⛔ Reporting `a-person` for
   * that is the sentence `395` repaired; reporting `nothing-has-said` for the WORK would be a
   * second lie, because the work really did stop.
   *
   * ⛔ **494 · a permission answered `cancel` is no longer one of those**, and the change is in
   * this fold rather than in any writer. {@link UserDecisionEvent.by} names the caller, so the two
   * remaining nulls are a turn nobody asked to stop and a row written before `477` — see
   * {@link whoCancelledIt}. ⚑ Its vocabulary is {@link WhoStoppedIt}'s and no longer one producer's.
   */
  readonly who: WhoStoppedIt | null
  /** The conversation that asked — present only when {@link who} is `an-agent`. */
  readonly asker: string | null
}

/** The reading of a turn this app holds no terminal for. */
const NOTHING_HAS_SAID: StopReading = { how: 'nothing-has-said', who: null, asker: null }

/**
 * 🔴 **Fold ONE turn's entries into how its work stopped and who asked.**
 *
 * ⛔ **Pure, total, and given exactly one turn's rows.** The caller narrows — `events.turn_id` is
 * what makes that possible, and `SessionStore.howTheLastTurnStopped` is the reader that does it. ⚑ A
 * fold handed a whole session would answer about whichever turn's rows happened to be last, which
 * is a different question wearing this one's name.
 *
 * ⚠️ **Every `error` counts, fatal or not.** `completeTurn` emits `error{fatal:false}` immediately
 * before `turn:'failed'`, and `fatalError` emits `error{fatal:true}` immediately before its own
 * terminal — so the presence of an error row on the turn is the one wire-level signal that is
 * present for every fault and for no interruption. ⛔ Reading `fatal` here would make a recoverable
 * provider failure read as an interruption.
 *
 * ⚠️ **The LAST ask wins**, for `394`'s reason one door over: a turn can be asked to stop twice —
 * a person after an agent, most obviously — and the reading names who last asked rather than who
 * first did.
 */
export function howWorkStopped(entries: readonly PersistedEventInfo[]): StopReading {
  let asked: StopReading['who'] = null
  let asker: string | null = null
  let faulted = false
  let ended: 'completed' | 'failed' | 'interrupted' | null = null
  for (const entry of entries) {
    const event = entry.event
    if (event.type === 'work_interrupted') {
      asked = event.by
      // ⛔ **Cleared on every ask**, so a person stopping a turn an agent already asked about does
      // not inherit the agent's name. The two fields are one fact and are written together.
      asker = event.by === 'an-agent' ? (event.agent ?? null) : null
      continue
    }
    if (event.type === 'user_decision') {
      // 🔴 **494 · the second producer of an ask, and the only outcome that is one.** ⛔ `allow`,
      // `deny`, `answered` and `rejected` move nothing here: they are answers to a REQUEST, and
      // this field is about the TURN. ⚑ `cancel` is the one that stops it — on all three doors
      // (⚑ but for an external-MCP elicitation card, which asks nothing — every one since `736`,
      // R97; until then only one whose frame named no turn, `723` R81 — below),
      // and `RuntimeHost.respondPermission` is its single writer.
      //
      // ⚠️ **Assigned whether or not it names anybody**, which is {@link whoCancelledIt}'s own
      // rule: *the last ask wins*, and a cancel this app cannot name the author of must clear an
      // earlier one rather than inherit it.
      if (event.outcome !== 'cancel') continue
      // 🔴 **723 · R81 — a cancel that asked no turn to stop is no ask** (`stopsNothing`: since
      // `736` every external-MCP elicitation card's Cancel; until then only a card whose frame named
      // no turn). ⛔ Read as one, it would name its presser as the one who asked the running turn to
      // stop, and nobody asked anything.
      if (event.stopsNothing === true) continue
      const cancelled = whoCancelledIt(event.by)
      asked = cancelled?.by ?? null
      asker = cancelled?.asker ?? null
      continue
    }
    if (event.type === 'error') {
      faulted = true
      continue
    }
    if (event.type === 'turn') ended = event.state
  }
  if (ended === null) return NOTHING_HAS_SAID
  const how: HowWorkStopped =
    ended === 'interrupted'
      ? faulted
        ? 'it-was-stopped-and-it-faulted'
        : 'it-was-stopped'
      : ended === 'failed'
        ? 'the-provider-faulted'
        : // ⚠️ `completed` with an error row on it is still a completion: `completeTurn` only emits
          // an error on the `failed` arm, so the pair can only mean a recoverable error EARLIER in
          // the turn that the provider then recovered from. Calling that a fault would report a
          // turn that finished as one that broke. ⚑ (680: a Claude turn the provider REFUSED used to
          // close `completed` too — `is_error` on a `success` result was not read — and this said
          // *it finished* of it. It closes `failed` now; see `claudeResultOutcome`.)
          'it-finished'
  return { how, who: asked, asker }
}

/**
 * 🔴 **What this app claims when it asks a turn to stop — `asked`, and never `stopped`** (492,
 * `HO-032` §1 · criterion 20).
 *
 * ## ⛔ One clause, because after `492` it is one act
 *
 * ⚠️ **Two surfaces describe stopping a turn and they used to make different claims about it.**
 * `interrupt_agent` answers a model *"… was asked to stop"* — `RuntimeHost.interruptAgent`'s own
 * ruling, because **Codex's `interrupt()` awaits an answer the app-server may never send, and an
 * answered ask can still leave the turn running** (709 corrected the mechanism), so a
 * verb answering *stopped* would be false on one provider and would hang on the other. ⛔ The
 * permission card said *"the whole turn is interrupted"*, which is the claim that verb refuses to
 * make. ⚑ **`HO-032` §1 made a person's Cancel perform the same act**, and HO-030 §2's argument is
 * about habit: two spellings of one act teach a reader that the words are decoration.
 *
 * ## ⚠️ A CLAUSE and not a sentence, and the difference is deliberate
 *
 * ⛔ **The two sentences cannot be one string and should not pretend to be.** One is read by a
 * person BEFORE a press and names the turn; the other is read by a model AFTER one and names an
 * agent and its state. ⚑ What must not differ is the CLAIM, so the claim is the shared bytes and
 * each surface supplies its own subject — `stoppedBy`'s shape, one field over.
 *
 * ⚠️ **It says nothing about what the agent does next**, which is `430`'s narrowing and
 * `WHAT_COMES_AFTER_IS_NOT_OURS`'s job on the surfaces that draw it.
 */
export const ASKED_TO_STOP = 'asked to stop'

/**
 * 🔴 **729 · PM ruling R90 — the reader's own ask, said as its own act** (`724` F-2).
 *
 * ⚑ **R90:** *"When the one who asked a turn to stop is the reader itself, it is told so as its own
 * act (you asked it to stop), never by its own name as if someone else had."* ⛔ Since `724` (`720`
 * F-C) the asker is NAMED — and the asker is usually the giver reading the sentence, so a project
 * manager that stopped its own worker was told *"…, by Ada"* about its own gesture.
 *
 * ⚠️ **R90's words, not {@link ASKED_TO_STOP}'s bytes**: that claim is passive and takes its actor
 * from {@link stoppedBy}; this one has the READER as its subject, which only a sentence composed for
 * one known reader can say — a message addressed TO that agent. ⚠️ **A person can read it too**
 * (`729`'s review): the push is drawn verbatim in the giver's transcript
 * (`WorkReportEntry.vue`), where *you* is that conversation's agent — as the card's own mark, *work
 * you gave out*, already reads it. ⛔ {@link stoppedBy}'s *"third person, never you"* stands for every
 * sentence composed FOR a person — the transcript's own notices, a Sessions row, a person's band.
 */
export const YOU_ASKED_IT_TO_STOP = 'you asked it to stop'

/**
 * ⛔ **Who asked, in a person's words** — ONE phrasing, for every surface that names an actor.
 *
 * ⚠️ **Not composed at a call site.** `ending.ts`'s standing rule — *"a surface that wanted its own
 * phrasing would be the second vocabulary"* — and here it is load-bearing rather than tidy: the
 * transcript names the actor while the turn is being read, and the Sessions row names it days
 * later, and two spellings would be two chances to disagree about a fact this dispatch exists to
 * get right.
 *
 * ⚑ **Third person, never *"you"*.** `222` shipped *"you stopped its last turn"* and it was false
 * for three of the four gestures that write the value; a transcript is also read by somebody other
 * than whoever pressed the button, and by the same person a week later. ⚠️ **729 · R90 — the one
 * exception is not made here**: a sentence composed for ONE agent reader that was itself the asker
 * says {@link YOU_ASKED_IT_TO_STOP} instead of calling this (`reply-rails.ts`' `theStallAndItsAsk`).
 *
 * @param agent the words for the asking conversation, when there is one. ⚠️ Since `724` (`720` F-C)
 *   every main-process sentence hands its NAME here (`reply-rails.ts`' `theAskNamed`, over
 *   `RuntimeHost.nameByItsWork` — its agent's name and the piece it owns, since D-016 · commit 7 ·
 *   R3), never the `sess_…` handle — ⚑ and since `729` (R90) the reader's OWN ask never reaches
 *   here: it is {@link YOU_ASKED_IT_TO_STOP}. ⛔ One caller still hands an ID:
 *   {@link whoAskedClause}, a reading's `asker` — which has no caller. ⚑ **Since `737` the renderer
 *   hands the NAME or nothing** (`stop-unanswered.ts`' `whoAskedItToStop`, for both rows an agent's
 *   ask writes): the agent's `agentName` where the row carries its identity and the window has the
 *   roster, else `null` — the category. The transcript handed a `work_interrupted` row's `agent`
 *   here until then, and drew *"asked to stop by sess_…"*.
 */
export function stoppedBy(by: WhoStoppedIt, agent: string | null): string {
  // ⚠️ **`'an agent'` when the row carries no id**, which a row written before this app named the
  // asker would be. It is the honest generalisation of what the row does say, and never a guess at
  // which conversation it was.
  //
  // ⛔ **494 · the other words come from {@link WHO_DID_IT_SAYS} rather than from a second table
  // here.** ⚑ {@link didIt} is the same phrasing for the same vocabulary one subject over, and two
  // tables for one set of words is how a surface comes to disagree with the digest about an actor.
  return by === 'an-agent' ? (agent ?? WHO_DID_IT_SAYS['an-agent']) : WHO_DID_IT_SAYS[by]
}

/**
 * ⚑ **The clause a surface adds when the ledger names an actor** — `null` when it does not.
 *
 * ⛔ **`null` is the ordinary case and not a failure.** A conversation closed mid-turn is stopped
 * with no ask written at all; a surface then says only that the work was stopped, which is all this
 * app knows.
 *
 * ⚠️ **494 · a card answered `cancel` used to be the other example here and is not one any more.**
 * ⚑ {@link whoCancelledIt} reads the actor off the decision row, so this clause now names a person
 * for the press that stopped the turn — and the remaining nulls are a turn nobody asked to stop and
 * a decision written before `477`.
 */
export function whoAskedClause(reading: StopReading): string | null {
  return reading.who === null ? null : stoppedBy(reading.who, reading.asker)
}

/**
 * 🔴 **Which turn an ask to stop landed on** (484, HO-031 §2.1) — four answers, all reachable.
 *
 * ⛔ **It exists because an ask is an act on a CONVERSATION and {@link StopReading} is about one
 * TURN.** `RuntimeHost.askTheWorkToStop` writes `work_interrupted` for every caller and at every
 * moment, and `SessionStore`'s `turnFor` gives a row `turn_id = null` when nothing is running — so
 * the one gesture this app records the author of is invisible to every reader narrowed by turn.
 * ⚑ That is the measurement behind HO-031 §2.1: the ledger held `{"by":"a-person"}` and
 * `get_agent_status` answered `who: null`.
 *
 * ⚠️ **Each member is a state something actually reaches**, which is the test `395` applied to
 * the `this-app` word it drafted and removed — see {@link WhoStoppedIt}.
 *
 *  - **`the-turn-that-ended-last`** — the ordinary Stop, pressed while a turn was running. The same
 *    act {@link StopReading.who} already reports, named here so a reader can tell it IS the same.
 *  - **`a-turn-that-ended-earlier`** — asked while a turn was running, and that turn has ended with
 *    another turn after it: the words a stop was asked for went in as soon as it ended, which is
 *    what an interrupting message or answer does. ⚠️ It read `no-turn-was-running` until then — the
 *    turn it stopped was neither the last one ended nor the one running.
 *  - **`a-turn-that-is-running-now`** — asked, and the turn has not closed. ⛔ Not a race to be
 *    tidied away: Codex's `interrupt()` awaits an answer the app-server may never send (709),
 *    which `395` measured and `askTheWorkToStop` writes its row before the provider is asked
 *    precisely because of.
 *  - **`no-turn-was-running`** — Stop on an idle or stalled conversation. ⚑ Reachable from a window
 *    and from `interrupt_agent` alike: `INTERRUPT_RAILS` has no member for *there is nothing to
 *    stop*, deliberately, and this is the shape HO-031 §2.1 was written about.
 */
export const WHERE_AN_ASK_LANDED = [
  'the-turn-that-ended-last',
  'a-turn-that-ended-earlier',
  'a-turn-that-is-running-now',
  'no-turn-was-running',
] as const

export type WhereAnAskLanded = (typeof WHERE_AN_ASK_LANDED)[number]

/**
 * 🔴 **The last time anybody asked this conversation's work to stop** (484) — the CONVERSATION's
 * fact, beside {@link LastEndedTurn}'s turn-shaped one.
 *
 * ⛔ **Two fields, two questions, and the difference is which subject each is about.**
 * {@link StopReading.who} answers *who stopped THAT turn* and is `null` for a turn nobody stopped —
 * truthfully. This answers *who last asked THIS CONVERSATION to stop*, which has an answer whether
 * or not a turn was running when they asked. ⚠️ Folding the second into the first would make a
 * person's Stop of an idle conversation read as the ending of a turn it never touched, which is a
 * different false sentence from the one being repaired.
 *
 * ⚑ **{@link turn} is what makes the pair readable rather than two numbers a reader has to guess
 * about.** When it says anything but `the-turn-that-ended-last`, they are two acts. ⚠️ **709 · R43:
 * when it says `the-turn-that-ended-last` they are still two FACTS** — this ask, and that turn's
 * ending. ⚑ That ending is the provider's own word where the provider ended the turn — a Codex Stop
 * of a running turn, a Cancel on any door that asks one (never an external-MCP elicitation card's
 * since `736`, R97 — its row carries `stopsNothing`) — so a turn asked to stop and completed anyway reads
 * `it-finished` beside this ask, and both are true. ⛔ **Except where the machine ended it itself**:
 * Claude's Stop, once its receipt is in or its 2 s ack bound runs out, and every Close go through
 * `forceEnd`, which says `interrupted` whatever the provider says after — and that later word is
 * absorbed unread. ⚑ Since `720` (R71) that row carries `wordOf: 'this-app'`.
 */
export interface AskToStop {
  /**
   * ⛔ **Off a row's own actor — never derived from the caller a reader imagines.**
   *
   * ⚑ **494 · two producers now, and the vocabulary is the READER's** ({@link WhoStoppedIt}):
   * `WorkInterruptedEvent.by` for a Stop, and {@link UserDecisionEvent.by} for a permission
   * answered `cancel`.
   */
  readonly by: WhoStoppedIt
  /** The asking conversation's id — present only when {@link by} is `an-agent`, else `null`. */
  readonly asker: string | null
  /** Epoch ms of the row. */
  readonly at: number
  /** Which turn it landed on — see {@link WHERE_AN_ASK_LANDED}. */
  readonly turn: WhereAnAskLanded
}

/**
 * 🔴 **The last turn that ENDED — and never the one running now** (484, HO-031 §2.2).
 *
 * ## ⛔ The ruling this type carries
 *
 * ⚠️ **BroBot read `lastTurn: {"how":"the-provider-faulted"}` beside a task that had since been
 * answered and could not tell *stale* from *describing an older turn*.** ⛔ **The ambiguity was the
 * defect and neither reading was the bug**: the field has always been about the last CLOSED turn —
 * `SessionStore`'s query narrows on `closed_at IS NOT NULL` — and nothing in the value said so, so
 * a reader had to resolve it from a docblock it could not see.
 *
 * 🔴 **So the answer is written down and the other reading is unrepresentable.** {@link endedAt} is
 * a moment a running turn does not have, and {@link since} says outright whether this is the
 * current situation or a past one. ⚑ A payload carrying both cannot be read as *what it is doing
 * now*, which {@link AgentCard.state} answers and is the only field that does.
 */
export interface LastEndedTurn extends StopReading {
  /**
   * ⛔ **Epoch ms the turn CLOSED** — `turn.closed_at`, the column that decides which turn this is.
   *
   * ⚑ **Present on every arm, including `nothing-has-said`.** A turn closed by something that
   * appended no event still has a closing time; saying *this app did not see how it ended* is a
   * different claim from *this app does not know when*.
   */
  readonly endedAt: number
  /** ⚑ **Epoch ms the turn OPENED** — `turn.opened_at`: with {@link endedAt}, when it ran. */
  readonly startedAt: number
  /**
   * ⚑ **F080 — its provider started that turn by itself** (a `provider_turn` opened it: Claude
   * waking its agent when a background task ended). Absent when a message began it.
   */
  readonly startedByItsProvider?: true
  /**
   * 🔴 **Whether anything has started since** — two answers, and there is no third.
   *
   * ⛔ A later turn that had also ENDED would BE this turn, so the only thing that can exist after
   * the last closed one is an open one. ⚠️ That is what makes the pair exhaustive rather than a
   * list somebody chose, and it is why a reader is never left comparing timestamps.
   */
  readonly since: 'nothing-has-started-since' | 'a-turn-is-running-now'
}

/**
 * ⚑ **The clause a surface adds beside a sentence that reports an ask** — `''` when nobody is
 * named (484).
 *
 * ⛔ **{@link whoAskedClause}'s shape for the other subject.** That one answers about a TURN's
 * reading and returns `null`; this one answers about a stall's actor and returns the words already
 * punctuated for the sentence they follow, because its two callers both append rather than compose.
 *
 * ⚠️ **ONE composition and two callers, never two compositions** — `undrivenSentence`'s own rule in
 * `shared/tasks.ts`, and it is load-bearing here for {@link stoppedBy}'s reason: the line
 * `list_tasks` returns and the notice a parent is PUSHED are read as one account of one event, and
 * two spellings would be two chances to disagree about who did it.
 *
 * ⚠️ **724 · `720` F-C — `asker` is the NAME both callers hand it** (`reply-rails.ts`'
 * `theStallAndItsAsk`, over `theAskNamed`), never the row's id: the type cannot tell the two
 * strings apart, so a caller that passed {@link AskToStop.asker} straight through would print the
 * handle `HO-095` §5.3 ruled out of a sentence.
 */
export function askedByClause(ask: Pick<AskToStop, 'by' | 'asker'> | null): string {
  return ask === null ? '' : `, by ${stoppedBy(ask.by, ask.asker)}`
}
