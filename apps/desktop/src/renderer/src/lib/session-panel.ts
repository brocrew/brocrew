import {
  NEEDING_NOUN,
  NEEDINGS,
  subAgentFacets,
  summonsAttention,
  workflowRunFacets,
  type AgentFacets,
  type Needing,
} from './agent-state'
import { BACKGROUND_WORD } from './background-work'
import { scheduleHeld, somethingRunning } from '../../../shared/agent-state'
import { pathTail } from '../../../shared/path-tail'
import { cardHomes, isAwaitingAnswer, type PlanItem, type TranscriptState } from './transcript'

/**
 * What still needs you, and what is still happening — read off the transcript (037).
 *
 * Keep current questions, permissions, sub-agents and checklist visible as status beside the transcript history, where pending actions can otherwise scroll away.
 *
 * ⚠️ **This is a projection, not a store.** It is a pure function of {@link TranscriptState} — the
 * same fold the conversation itself is rendered from — and it subscribes to nothing. That is the
 * whole design. A panel that listened to the same events and kept its own list would eventually
 * disagree with the transcript beside it: a permission answered in one and still open in the other,
 * an agent that ended still spinning. Two answers to one question in one window is worse than no
 * panel, and no amount of care keeps two folds in step forever.
 *
 * Everything here therefore leaves the panel by the same event that settles it in the transcript,
 * because it is the same fact being read twice rather than recorded twice.
 */

/**
 * Which kind of card is still waiting, without building the whole panel (082).
 *
 * ⚠️ **The rail needs this and must not pay for {@link sessionPanel} to get it.** That walks every
 * item to build four lists, and the rail would run it once per open conversation on every render —
 * to draw a mark that says one word.
 *
 * ⚠️ **It returns the same answer `needingFor` would, not merely A waiting card.** The first version
 * scanned backwards and returned the first hit, which is the LAST card in transcript order; the
 * panel applies a PRIORITY — a permission outranks a question, because a permission freezes the
 * composer. With both open, the rail drew a `?` and the top bar drew a lock, about the same session,
 * in the same window. Two answers to one question is the defect class 037 and 074 exist to prevent,
 * and this is why the answer is a priority rather than a position. Found in review.
 *
 * It still short-circuits on the case that matters: a permission is the top of the order, so finding
 * one ends the scan. A question keeps looking only because something more important may be older.
 *
 * ⚠️ **The caller decides WHETHER to ask, and since 099 the rail no longer asks at all.** With
 * nothing waiting this walks the whole list — there is no early exit from proving a negative — so it
 * was called behind a gate on the session's status, which is exactly what made the rail's answer a
 * second derivation that could lag the pane's. The rail now reads `TranscriptState.pending`, which
 * the fold maintains in O(1) and which feeds the same `needingFor` the pane uses. Anything reaching
 * for this function on a hot path should read that field instead; what is left here is the answer
 * for a caller that has a state and no fold behind it.
 */
export function pendingKind(state: TranscriptState): 'permission' | 'question' | null {
  let question = false
  for (let index = state.items.length - 1; index >= 0; index--) {
    const item = state.items[index]!
    if (!isAwaitingAnswer(item)) continue
    if (item.kind === 'permission') return 'permission'
    if (item.kind === 'userInput') question = true
  }
  return question ? 'question' : null
}

/** One thing in the panel, and where in the conversation it lives. */
export interface PanelEntry {
  /** Distinct within its section — the list renders on this. */
  key: string
  /**
   * The transcript item to scroll to. The panel is a way INTO the conversation and nothing else:
   * you answer a card where the card is, under the disclosure rules 031/034 established for it.
   */
  itemId: string
  title: string
  /** The second line. Empty when there is nothing more to say — never filled with a guess. */
  detail: string
  /**
   * How this row's agent is drawn (082) — decided HERE, with the item in hand, rather than by the
   * drawer looking at a title string and inferring which section it came from.
   *
   * A permission row and a question row differ by exactly one facet, and it is the facet that says
   * what the row wants from you; an agent row's facets come from its own card. Nothing else in the
   * panel gets any — a checklist and an image are not agents, and a faceless plate beside them
   * would be a mark that says nothing.
   */
  facets?: AgentFacets
}

/**
 * A file this session produced (067).
 *
 * ⚠️ **Only ever a file that EXISTS.** The transcript item this is read from carries a `path` only
 * after the runtime confirmed a real image file — wherever it is, since `726` · R92 — so an index
 * entry here is a promise that clicking it shows something. An image whose file has been moved away
 * still appears in the conversation — saying so is the entry's job — but it is not listed here,
 * because an index of things you cannot open is worse than a shorter index.
 */
export interface PanelAsset {
  key: string
  /** The transcript item, so the conversation can be scrolled to it as well as the file opened. */
  itemId: string
  /** Absolute path — what the viewer is opened with. */
  path: string
  /** The file's own name. The row's label. */
  name: string
  /** What it was generated from, when the provider said. The second line. */
  prompt?: string
}

/** The checklist, while it still has something left to do. */
export interface PanelTodo {
  itemId: string
  steps: PlanItem['steps']
  /** How many are finished — the header line, so the panel says progress without a second walk. */
  done: number
  note?: string
}

export interface SessionPanel {
  questions: PanelEntry[]
  permissions: PanelEntry[]
  agents: PanelEntry[]
  /**
   * What the session MADE (067).
   *
   * Assets accumulate instead of leaving when settled. Include them in this same projection rather than add a separately fetched column; {@link sessionPanel} owns that shared view.
   *
   * It stays a projection, so the rule that actually matters is intact: this is read off the same
   * items the transcript renders, and cannot disagree with them.
   */
  assets: PanelAsset[]
  /**
   * The dynamic workflows still running (108, ruled in 107 §1) — **one row each, never their N
   * children.**
   *
   * ⚠️ **A 22-agent run is ONE happening.** The Open tab answers "what is happening", and listing a
   * long workflow's agents here would bury the real sub-agents beside them in a list meant for an
   * at-a-glance read. The agents live in the tree, on the tool call that launched them.
   *
   * ⚠️ **This is emphatically NOT counted into {@link SessionPanel.waiting}** — see there. It is the
   * whole of 080's ruling, and the reason this is its own field rather than more entries in
   * `agents`: a caller that treated all "open" lists alike would have to remember the exception,
   * and 037's own comment is that a rule stated in two places is a rule free to be forgotten in one.
   */
  workflows: PanelEntry[]
  todo: PanelTodo | null
  /**
   * How many things are blocked on YOU.
   *
   * Deliberately not the total. A running agent and an unfinished checklist are things that are
   * HAPPENING; counting them here would put a number on the badge that never reaches zero while the
   * agent works, and a badge that is always lit is a badge nobody reads.
   */
  waiting: number
  /**
   * Nothing this panel LISTS is open. A good state, and the panel says so out loud.
   *
   * ⛔ **This used to say "nothing needs you and nothing is running", and 250 found the second half
   * false.** `248`'s detached work is running and is listed HERE by nothing — it belongs to
   * `BackgroundBar`, above the composer — so the sentence read *"Nothing is waiting"* over a
   * conversation that had a 30-second command in flight. The gate is unchanged; what changed is
   * that the paragraph it gates now has two forms. See {@link panelEmptyWords}. ⚠️ **The words
   * quoted there are `250`'s, and `577` replaced them** — see {@link NOTHING_OPEN_HEAD}.
   */
  empty: boolean
  /**
   * ⛔ **Something is still running that this panel does not list** (250) — `248`'s level set.
   *
   * ⚠️ **It is deliberately NOT part of {@link empty} and NOT part of {@link waiting}, and the two
   * exclusions have different reasons.**
   *
   *  - Not `waiting`, on `229`'s ruling: that count is what freezes the composer, badges the drawer
   *    and raises `205`'s attention bar, and background work asks nothing and blocks nothing. This is
   *    the same line `workflows` already sits on — *counted as HAPPENING, never counted as WAITING*.
   *  - Not `empty`, because `empty` gates a PARAGRAPH. Folding this in would make the paragraph
   *    vanish and leave a genuinely blank column, which is the exact failure `067`'s review named
   *    (*"a blank column that reads like a panel that failed to load"*).
   *
   * ⛔ **And it adds no ROW, which is `035`.** The bar is on the same screen, carries the provider's
   * own description and is the only place the work can be stopped; a second list of it here would be
   * the duplicate `248` already refused when it kept this out of `205`'s queue.
   */
  stillRunning: boolean
  /**
   * ⛔ **…and whether any of it can be NAMED** — `running.length > 0`, which is exactly
   * `BackgroundBar`'s own `v-if`.
   *
   * ⚠️ Two fields rather than one because they answer two questions and the level can say yes to the
   * first and no to the second: `normalize.ts` counts a task the provider sent with no `task_id`,
   * which cannot be listed and cannot be stopped. {@link panelEmptyWords} is the only reader, and it
   * uses this to avoid pointing at a list that has not rendered.
   */
  runningNamed: boolean
  /**
   * ⛔ **Something is SCHEDULED that this panel does not list either** (258) — `253`'s level.
   *
   * ⚠️ **Excluded from {@link empty} and {@link waiting} for the two reasons {@link stillRunning}
   * is**, and one more of its own: a schedule asks nothing, blocks nothing, and is not even
   * happening yet, so it is the weakest possible candidate for a count that means *"frozen"*.
   *
   * ⛔ **And it adds no ROW, which is `035` and `248`'s ruling reused.** `ScheduleBar` is on the same
   * screen with the expression, the repeat and the prompt; a second list of it here would be the
   * duplicate `248` already refused when it kept background work out of `205`'s queue.
   *
   * ⚑ **Asked through `scheduleHeld`, the bar's own condition** — of this window's fold, which lists
   * what the provider last stated; ⚠️ a stopped conversation is started only for the jobs its
   * provider will bring back (D-029), which the host's word says. See `scheduled-work.ts`.
   */
  scheduled: boolean
}

/**
 * `a`, `a or b`, `a, b or c` — the same Oxford-free shape `provider-config.ts`' `humanList` writes
 * for *and*. ⛔ Local rather than shared: that one lives in the MAIN process, and a renderer import
 * of a `shared` value costs this bundle 135 kB.
 */
function orList(words: readonly string[]): string {
  const last = words[words.length - 1]
  // ⚠️ Unreachable while {@link summonsAttention} admits anybody, and the heading test's vacuity
  // floor is what keeps it unreachable. It returns a word rather than an empty string so a fold
  // that did empty this set could never render a heading with a hole where its subject was.
  if (last === undefined) return 'nothing'
  if (words.length === 1) return last
  return `${words.slice(0, -1).join(', ')} or ${last}`
}

/**
 * 🔴 **Which NEEDINGS this column counts — read from the predicate, never listed again** (577).
 *
 * ⛔ **Byte-for-byte the summands of {@link SessionPanel.waiting} at this commit** — and it is a
 * DIFFERENT question asked of the same vocabulary, so that agreement is asserted rather than
 * assumed: `the-heading-and-what-it-counts.test.ts` §1 derives the counted set from the fold by
 * planting one card per NEEDING and compares it with this. ⚑ `446` is why it is worth asserting: a
 * population joined the count and four surfaces had to be widened by hand. The heading below is
 * the fifth, and it widens itself.
 */
export const WHAT_THIS_COLUMN_COUNTS: readonly Needing[] = NEEDINGS.filter(summonsAttention)

/**
 * 🔴 **The heading, in a person's words, naming exactly what the column counted** (577).
 *
 * ⚑ Reads *"No permissions or questions are on a card here"* at this commit.
 * ⛔ **Nobody writes those nouns here**: they come from {@link WHAT_THIS_COLUMN_COUNTS}
 * through {@link NEEDING_NOUN}, so a heading that names a population the fold does not count, or
 * misses one it does, is a broken build or a red test rather than a sentence a person has no way
 * to check.
 *
 * ## 🔴 602 · *on a card here*, and *raised here* was the half that was false
 *
 * ⛔ **`577` ended this sentence *"have been raised here"* and `589` measured it false.** ⚠️ A
 * worker that calls `ask_question` writes a `question_asked` row into its OWN ledger; `transcript.ts`
 * folds that row into a NOTICE — *"asked about W1.2"* — and draws no card, so this column counts
 * zero and the paragraph claimed nothing had been raised **two lines under the app's own notice
 * saying something was**. ⚑ Measured on this tree: one `question_asked`, `waiting: 0`, `empty:
 * true`, and the old head.
 *
 * 🔴 **`591` did not close it and could not**: it made a question outlive its clock (`HO-082` §2),
 * which is about the question's LIFETIME and not about what the pane counts.
 *
 * ⚑ **So the claim is scoped to what the column actually looked at, rather than caveated.** It
 * walks `state.items` and counts CARDS — `permission` and `userInput` — and *on a card*
 * is this app's own noun for that population: `PersonsQueue.vue` writes *"its card is not in the
 * part on screen"*, `attention.ts` projects the same items, and `589` priced the repair in those
 * words. ⛔ **`raised here` is now retired as a phrase for this column**, and the reason it read
 * well is the reason it was dangerous: it denies a MECHANISM, and this app has a second mechanism
 * that raises a question here and draws no card.
 *
 * ⚠️ **What it deliberately does NOT do** is send the reader anywhere. ⛔ `589` found that the one
 * place that pointed — the person's queue, *"open it to answer"* — was pointing at nothing, and a
 * second pointer from here would be the same defect with a new origin.
 *
 * ## 🔴 *here*, and it is the half that answers `EXT-010` §3.1 rather than the nouns
 *
 * ⛔ **An earlier draft of this dispatch ended *"are open"* and the adversarial pass over its own
 * diff killed it.** ⚠️ On the PO's own screen the agent had asked three questions in prose, and
 * *"no questions are open"* denies, by name, the thing the person is looking at — `492`'s one
 * word, two claims, on one screen, arriving at the exact axis the complaint was about.
 * 🔴 **And the scoping cue a reader might have used is absent precisely then**: the bands are
 * drawn only where they have rows, so on a bare column there is no `Questions` heading to read
 * this noun against.
 *
 * ⚑ **The scoping word denies the MECHANISM rather than the asking**, and `602` narrowed which
 * mechanism: *raised here* denied every way of raising one, including the app's own
 * (`question_asked`); *on a card here* denies only the population this column walks. ⛔ A question
 * an agent types into its reply is not on a card; neither is one `ask_question` routed away. ⚠️ **A
 * neighbouring sentence still says *raised here* and it is still true of its own subject** —
 * `digest.ts`'s *"N requests were raised here"* counts ledger rows. ⚑ Swept at `602` and left
 * standing, deliberately.
 */
export const NOTHING_OPEN_HEAD = `No ${orList(
  WHAT_THIS_COLUMN_COUNTS.map((needing) => NEEDING_NOUN[needing]),
)} are on a card here`

/**
 * 🔴 **What the empty column may claim, and it is NOT that nothing is waiting** (577).
 *
 * ⚑ **Here rather than in the component, so a test can hold the surface to the exact words** —
 * `169` §2's rule, which `attention.ts` already cites for `OPEN_REQUEST_MISSED`.
 *
 * ## 🔴 577 · the heading said *"Nothing is waiting"* while an agent was waiting
 *
 * ⛔ **`EXT-010` §3.1: BroBot ended its turn with *Waiting on you* and three questions in prose —
 * correct behaviour, it had been told to stop and ask — and this column said nothing was waiting.**
 * ⚠️ **Both statements were true of the code and one of them was false to the person reading it.**
 *
 * ⚑ **The PO named two legal repairs and `577` derived which from the fold.** The count is honest:
 * {@link SessionPanel.waiting} is the populations `isAwaitingAnswer` admits, and that
 * predicate's last line is `return false` — an assistant message is not a card, whatever it says.
 * ⛔ Widening it would mean reading the model's own prose, and the only structured fact underneath
 * (*the turn ended*) is true after EVERY turn, which is the badge-that-never-comes-down this file
 * already refuses three times. 🔴 **So the COUNT stays and the HEADING says what it counts.**
 *
 * ⚑ **{@link NOTHING_OPEN_HEAD} is DERIVED from `summonsAttention` rather than written beside it.**
 * A heading that names a set by hand is a second copy of that set; this one cannot name a
 * population the fold does not count, or fail to name one it does — and
 * `the-heading-and-what-it-counts.test.ts` compares the words against the fold's own behaviour, so
 * neither side is the sentence agreeing with itself.
 *
 * ⛔ **The forbidden direction, kept from `250`.** An earlier draft changed this to *"Nothing is
 * waiting on you"*. That reads better and collides with the app's own vocabulary: `NEEDING_WORD
 * .plan` is *"waiting on you (plan approval)"*, and a plan go-ahead is a `needing` that `standingOf`
 * deliberately does NOT call `waiting` — so a conversation holding a go-ahead and a detached command
 * would have carried a plate whose accessible name says *waiting on you* six inches under a
 * paragraph saying nothing was. Found by the adversarial pass over 250's diff. ⚠️ **It is also
 * the person's queue's own heading** (`personsQueueView`), over a different count. ⚑ The heading below reaches for
 * neither phrase.
 *
 * ⚠️ **ONE heading in all five arms, and that is `250`'s ruling kept rather than inertia.** The
 * arms differ in what ELSE is going on — detached work, a schedule, work handed out — not in what
 * is open, and what is open is all the heading claims.
 *
 * ⚑ **`229`'s ruling is untouched and is why the arms exist at all:** background work genuinely
 * asks nothing, so it was never part of the count — the BODY is where that fact belongs. It was the
 * body that was false in `250`: it enumerated what *"appears here while it is open"*, a list a
 * detached command is not in, over a conversation that had one running.
 *
 * ⛔ **The body names WHERE the thing is** (`239`: a refusal states its own workaround). A person
 * told that something is running and not told where to look for it has been given an alarm and no
 * instrument — and this app has that instrument, six inches down.
 *
 * ⚠️ **It names the LIST and deliberately not the BUTTON, and the first draft named the button.**
 * `BackgroundBar`'s stop is gated on `canStopBackgroundWork`, which the host sets only for an
 * adapter that implements `stopBackgroundWork` — Claude today, and `106`'s rule is that a control
 * which cannot act is not offered at all rather than greyed. So *"with the button that stops it"*
 * was true only by a coupling nothing states: the one adapter that publishes a level set is the one
 * that can stop it. That is true at this commit and is not a property anyone promised to keep, and a
 * sentence that depends on it would become a lie in a dispatch that had no reason to look here.
 *
 * ⛔ **The residual this used to declare unfixable is fixed below, and the paragraph saying otherwise
 * was removed by the adversarial pass over 250's own diff.** It posed a false dilemma — widen `248`'s
 * bar, or narrow the WORD — and the third option was always available, because the SENTENCE is 250's
 * own and could branch. {@link PANEL_EMPTY_WORDS.unnamed} is that branch.
 *
 * ⚠️ **What genuinely remains with `248` is the BAR**, whose `v-if` is `running.length > 0` and whose
 * heading counts the same number, so a level that names rows this app cannot list still draws
 * nothing at all — including `droppedNote`, the notice written for exactly that case, which sits
 * inside it. Reported in 250's response rather than fixed here; what changed is that 250 no longer
 * adds a second wrong statement on top of it.
 */
export const PANEL_EMPTY_WORDS = {
  quiet: {
    head: NOTHING_OPEN_HEAD,
    // ⚠️ **The heading names the cards since `577`, and the argument below is why the enumeration
    // exists at all.** ⛔ A body that names what *"appears here while it is open"* is a POINTER
    // CLAUSE, and a pointer clause is a claim: `250` and `258` each found this sentence false
    // because something had started appearing that it did not name. ⚑ The list is enumerated rather
    // than summarised on purpose — *"whatever is open appears here"* would never go false and would
    // never help.
    //
    // This band lists provider sub-agents from `sub_agent` events, not app identities given work. An app agent's work is recorded in the child's ledger and `work_given` creates no local item. Name this population sub-agents so the panel's pure transcript projection does not promise the app's broader agent roster.
    //
    // 🔴 **577 · the sentence got SHORTER, and it is the fifth correction rather than a trim.**
    // ⛔ Three of the five nouns moved UP into {@link NOTHING_OPEN_HEAD}, which now names exactly
    // what the column counted — so repeating them here would be the second copy this comment spends
    // four paragraphs warning about. ⚑ What is left is the population the heading does NOT count:
    // things that are HAPPENING rather than blocked on you, which is `080`'s line and `229`'s.
    // ⚠️ **And `workflows` joins the list, which is the fourth noun this sentence has been short
    // of.** A running workflow draws its own band here (`SessionPanel.vue`'s `SECTIONS`) and is one
    // of the four conjuncts in {@link SessionPanel.empty}, so it has been appearing here, unnamed,
    // since `108`. ⛑ Found by `577`'s own read of the gate rather than by anything going red.
    body: 'Running sub-agents, workflows and the checklist appear here too, while they are open.',
  },
  running: {
    head: NOTHING_OPEN_HEAD,
    body: `Work this conversation started is ${BACKGROUND_WORD.running} — it is listed above the composer.`,
  },
  /**
   * ⛔ **The level said something is running and named no row that can be listed** (`dropped` without
   * `running`) — so there is nothing above the composer to point at, and the sentence must not point.
   *
   * ⚠️ **This form exists because the adversarial pass over 250's diff rendered the state and read
   * the result**: the pill said *Still running*, `BackgroundBar`'s `v-if` is `running.length > 0` so
   * no bar drew, and the previous single running sentence sent the reader to a list that was not
   * there. Three statements, one false.
   *
   * ⚑ **And it is the first time the shortfall reaches a person at all.** `247` §3's rule is that *a
   * registry that quietly undercounts is worse than none*, and `droppedNote` — the notice written for
   * exactly this — sits INSIDE the bar that does not render, so until now it could not be read. That
   * remains a defect in `248`'s bar, reported rather than fixed here (its heading counts
   * `running.length` and would open with *"0 things are still running"*); what this sentence does is
   * stop 250 from adding a second wrong statement on top of it.
   */
  unnamed: {
    head: NOTHING_OPEN_HEAD,
    body: `Work this conversation started is ${BACKGROUND_WORD.running} — this conversation cannot say what it is.`,
  },
  /**
   * Represent a waiting schedule even when nothing is running or awaiting an answer.
   *
   * ⚠️ **The HEADING was unchanged here, for `250`'s reason and not by inertia**: a schedule asks
   * nothing of anybody under `229`'s ruling, so the body was where the fact belonged. It was the
   * body that was false — it enumerated what *"appears here while it is open"*, a list a cron is
   * not in, over a conversation that had one. ⚑ **`577` then changed the heading for a reason
   * `258` did not have**, and the arm is untouched by it: the heading is shared, and
   * {@link NOTHING_OPEN_HEAD} is as true over a schedule as the old one was.
   *
   * ⛔ **It names WHERE** (`239`: a refusal states its own workaround). ⚑ **And unlike the running
   * pair above, there is no `unnamed` twin needed**: `ScheduleBar`'s condition is `scheduleHeld`,
   * which counts `dropped`, and its heading counts every row the provider sent — so a level naming
   * rows this app cannot list still draws a bar with a true heading and the shortfall under it.
   * That is the `248` defect `250` had to work around, fixed rather than inherited.
   *
   * 🔴 **Which is why this says *"the schedule is above the composer"* and NOT *"it is listed"*, and
   * the first draft said the second.** Three reviewers found the same state: `jobs: []` with
   * `dropped: 2` draws a bar whose own notice reads *"2 of them are not listed here"*, six inches
   * under a paragraph promising a list. *Draws* is not *lists*, and the difference is precisely what
   * `PANEL_EMPTY_WORDS.unnamed` had to exist for one registry over. ⚠️ **And the tense is present**,
   * for the reason `scheduleHead`'s is: what will happen later is not a fact this app holds.
   */
  scheduled: {
    head: NOTHING_OPEN_HEAD,
    body: 'This conversation has work scheduled — the schedule is above the composer.',
  },
  /**
   * Represent work handed to another conversation even when nothing is waiting locally.
   *
   * ⚠️ **The HEADING was unchanged here too, for `250`'s reason and `258`'s**: work another agent
   * is getting on with asks nothing of anybody here, which is the same line `229` drew for
   * background work. It was the BODY that was short — it enumerated what *"appears here while it
   * is open"*, a list this conversation's own handed-out work is not in. ⚑ **`577` changed the
   * shared heading and left this arm alone**, for the reason on {@link PANEL_EMPTY_WORDS}.
   *
   * ⛔ **It names WHERE** (`239`: a refusal states its own workaround), and the where is a tab in
   * this same drawer rather than a bar above the composer. ⚑ **That is `258`'s method with the
   * location moved**: its list went above the composer because a schedule belongs beside the thing
   * that will run it; this list belongs in the right panel because that is where it was asked for,
   * twice, and because `506` ruled the panel itself may not subscribe.
   *
   * 🔴 **It says *has given out*, in the PERFECT and not the present.** The tab lists work whether
   * it is open or finished, so *"has work with other agents"* would be false the moment every
   * piece was answered — and the boolean behind this sentence is *are there rows*, not *is any of
   * it open*. ⚠️ The tally on the tab strip is the one that counts open work, and it is a
   * different question with a different absence.
   */
  gaveWork: {
    head: NOTHING_OPEN_HEAD,
    body: 'This conversation has given out work — it is on the Work tab.',
  },
} as const

/**
 * ⚠️ **Running outranks scheduled, and the order is the same fact `standingOf` settles one file
 * over**: something in flight now is the more urgent sentence, and it is the only one of the two
 * with a Stop button behind it. A conversation that is both gets the running paragraph, and the
 * schedule is still on screen in its own bar.
 *
 * ## 🔴 508 · the fourth arm, and it ranks LAST of the three that are not `quiet`
 *
 * ⛔ **Work given out ranks below both, and the order is argued from the same axis.** Running work
 * is in flight in THIS conversation and has a Stop behind it; a schedule is a promise this
 * conversation made and will keep itself; work handed out is neither — it is somewhere else,
 * driven by somebody else, and nothing on this screen can act on it. ⚑ A conversation that is all
 * three gets the running paragraph, and both other surfaces are still on screen.
 *
 * ## ⛔ Why it is a second PARAMETER and not a fifth field on {@link SessionPanel}
 *
 * 🔴 **`sessionPanel` is a pure function of `TranscriptState` and this fact is not in it.** The
 * work a conversation gave out lives in the ledgers of the conversations it went to; the OWNER's
 * fold sets map entries for `work_given` (the label and title, and since `658` who gave it) and
 * *"draws no item of its own"*, and the giver's ledger holds none of where it stands — D-047's
 * `work_sent` keeps only what was given. ⚠️ Putting it
 * on the projection would make `sessionPanel` take an argument it cannot derive, which is the
 * first step of the subscription `506` §1.4 refused. ⛔ A parameter says plainly that this one
 * comes from somewhere else, and `SessionPanel.vue` takes it as a prop for the same reason.
 */
export function panelEmptyWords(
  panel: Pick<SessionPanel, 'stillRunning' | 'runningNamed' | 'scheduled'>,
  /**
   * ⛔ **Whether this conversation has given out any work AT ALL** — rows, not open rows, and not
   * a count. ⚠️ `false` is *nothing read yet* as well as *nothing given out*, and both draw the
   * same paragraph: neither is a claim, and the tab is one click away either way.
   */
  gaveWork = false,
): {
  head: string
  body: string
} {
  if (panel.stillRunning) {
    return panel.runningNamed ? PANEL_EMPTY_WORDS.running : PANEL_EMPTY_WORDS.unnamed
  }
  if (panel.scheduled) return PANEL_EMPTY_WORDS.scheduled
  return gaveWork ? PANEL_EMPTY_WORDS.gaveWork : PANEL_EMPTY_WORDS.quiet
}

/**
 * The panel for `state`.
 *
 * One pass for the cards and the checklist, plus one walk of the sub-agent tree. Called on every
 * render of a live conversation, so it allocates only what it returns.
 */
export function sessionPanel(state: TranscriptState): SessionPanel {
  const questions: PanelEntry[] = []
  const permissions: PanelEntry[] = []
  /**
   * The LAST checklist, not the one the current turn is updating. `state.planId` is nulled when a
   * turn ends (028) so that the next turn opens its own block — but the plan it was working from is
   * still the plan, and the reader who scrolled away from it is exactly who this panel is for.
   */
  let plan: PlanItem | null = null
  const assets: PanelAsset[] = []

  for (const item of state.items) {
    if (item.kind === 'plan') plan = item
    // A file the session produced. `item.path` is the existence test AND the thing the viewer is
    // opened with — see {@link PanelAsset} on why a pathless image is shown in the conversation but
    // not indexed here.
    if (item.kind === 'image' && item.path) {
      assets.push({
        key: item.id,
        itemId: item.id,
        path: item.path,
        name: pathTail(item.path),
        ...(item.prompt ? { prompt: item.prompt } : {}),
      })
    }
    if (!isAwaitingAnswer(item)) continue
    if (item.kind === 'permission') {
      permissions.push({
        key: item.id,
        itemId: item.id,
        title: item.request.action,
        detail: item.request.detail,
        facets: { needing: 'permission' },
      })
    } else if (item.kind === 'userInput') {
      // The first question is the heading and the request's own prompt is the context under it. A
      // request with no structured questions is a permission GRANT, and then the prompt is all
      // there is — so it becomes the heading and the second line stays empty rather than repeating
      // it back.
      const heading = item.request.questions[0]?.prompt
      questions.push({
        key: item.id,
        itemId: item.id,
        title: heading ?? item.request.prompt,
        detail: heading === undefined || heading === item.request.prompt ? '' : item.request.prompt,
        facets: { needing: 'question' },
      })
    }
  }

  const agents = cardHomes(state)
    .filter(({ card }) => card.running)
    .map(({ card, itemId }) => ({
      // Keyed on the agent, not on its home: several cards can hang off one tool row.
      key: `agent:${card.agentId}`,
      itemId,
      title: card.title ?? card.kind ?? 'sub-agent',
      detail: card.lastTool ?? '',
      // The same card the transcript's own entry is drawn from, through the same function — the
      // panel and the conversation are one fact read twice, never recorded twice.
      facets: subAgentFacets(card),
    }))

  /**
   * Every running workflow, as one navigate-only row (108).
   *
   * Read off the TOOL ITEMS rather than off `state.workflows`, and that is deliberate: the registry
   * holds runs whose launching row has not appeared yet, and a panel row exists to be clicked
   * through to something. A run with no home has nowhere to send the reader, so it waits — which in
   * every measured conversation is no wait at all, since the `Workflow` call leads its first frame
   * by six events.
   */
  const workflows: PanelEntry[] = []
  for (const item of state.items) {
    if (item.kind !== 'tool') continue
    const run = item.workflow
    if (!run || !run.running) continue
    workflows.push({
      key: `workflow:${run.taskId}`,
      itemId: item.id,
      title: run.name ?? 'workflow',
      // The second line is what the run is FOR, not what it is doing this second — the head of the
      // tree already says that, and a drawer row that rewrites itself on every heartbeat is the
      // thing 078 exists to prevent.
      detail: run.description ?? '',
      facets: workflowRunFacets(run),
    })
  }

  const todo = openTodo(plan)
  // ⛔ {@link SessionPanel.waiting}'s own definition: *how many things are blocked on YOU*.
  const waiting = questions.length + permissions.length

  return {
    questions,
    permissions,
    agents,
    assets,
    workflows,
    todo,
    // ⚠️ **`workflows` is deliberately absent from this sum, and it is 080's line rather than an
    // omission** (107 §6). A running workflow is something that is HAPPENING; `waiting` counts what
    // is blocked on YOU, and it is what badges the drawer toggle, dots the Open tab and raises the
    // attention bar. A 22-agent run that is merely busy may raise none of them. The one case that
    // does count is a workflow AGENT hitting a permission — and that arrives as a real
    // `permission_request` card, counted above like any other, by the same code, with no special
    // case here at all.
    waiting,
    // ⚠️ **`assets` is deliberately NOT part of `empty`, and `waiting` does not count it either.**
    // {@link NOTHING_OPEN_HEAD} is a statement about work, and it stays true with a dozen pictures
    // in the index — a session that produced ten images and needs nothing from you is still a
    // session that needs nothing from you. Folding assets in here would light the header badge permanently for
    // the rest of the conversation, which 037 already refused to do for running sub-agents and for
    // the same reason: a badge that never comes down is a badge nobody reads.
    //
    // ⚠️ **`workflows` DOES join `empty`, and the asymmetry with `waiting` above is the point**
    // (108). A workflow is emphatically running — the panel saying "all clear" over a 22-agent
    // fan-out would be false in the one sentence it exists to say. That is exactly the line running
    // sub-agents already sit on: counted as HAPPENING, never counted as WAITING.
    //
    // ⛔ **This comment used to define `empty` as *"nothing needs you and nothing is running"*, and
    // 250 made the second half false without correcting it here** — found by the adversarial pass
    // over its own diff. `empty` is what it has always been in practice: **nothing this panel LISTS
    // is open.** Detached work is running and is listed here by nothing (`035` — the bar above the
    // composer owns it), so it is carried in {@link SessionPanel.stillRunning} and changes the
    // paragraph's BODY rather than removing the paragraph.
    empty: waiting === 0 && agents.length === 0 && workflows.length === 0 && todo === null,
    // ⛔ **The fact this panel does not list and was claiming the absence of** (250). See
    // {@link SessionPanel.stillRunning} for why it joins neither sum, and {@link panelEmptyWords}
    // for the sentence it changes. Read through the one predicate every surface asks (`223`), so the
    // paragraph, the pill and the rail row cannot come to different conclusions about one registry.
    stillRunning: somethingRunning(state.background),
    // ⚑ Deliberately the BAR's own condition, so the sentence and the widget cannot disagree about
    // whether there is a list to look at (`223`: one predicate, every consumer asks it).
    runningNamed: state.background.running.length > 0,
    // ⛔ **The other fact this panel does not list and was claiming the absence of** (258). Read
    // through the one predicate every surface asks (`223`), so the paragraph, the pill and the rail
    // row cannot come to different conclusions about one schedule.
    scheduled: scheduleHeld(state.schedule),
  }
}

/**
 * The checklist while it is still open — and `null` the moment it is not.
 *
 * "Open" for a checklist means it has a step left. A plan whose every step is `done` has ENDED, in
 * the same sense an answered permission has, and 037's rule is that ended things leave the panel.
 * A plan block carrying only a document and no steps is not a checklist at all and never enters.
 */
function openTodo(plan: PlanItem | null): PanelTodo | null {
  if (!plan) return null
  const done = plan.steps.filter((step) => step.status === 'done').length
  if (plan.steps.length === 0 || done === plan.steps.length) return null
  return {
    itemId: plan.id,
    steps: plan.steps,
    done,
    ...(plan.note !== undefined ? { note: plan.note } : {}),
  }
}
