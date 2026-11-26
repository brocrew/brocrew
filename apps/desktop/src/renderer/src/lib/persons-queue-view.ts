import type { BlockedSinceIs } from './queue-time'
import type {
  AboutWork,
  ChainHop,
  LedgerWalk,
  LedgerWalkKind,
  OfferedAnswer,
  PersonsDecision,
  PersonsQuestion,
  WorkInHand,
} from '../../../shared/question-contracts'
import { NOTHING_NAMED_THE_WORK, WALK_COVERS } from '../../../shared/questions'
import type { AttentionRequest } from './attention'
import { agoWords } from './clock'
import { OPEN_THE_CONVERSATION } from './taking-over'
// ⚑ **UI-009 · a question this app asked is drawn and answered as `QuestionCard`** — see
// {@link PersonsQueueRow.question}.
import { wordsAsked, type AppQuestion, type QuestionWords } from './question-card'
import {
  type DisclosedRequest,
  type NoAnswerHere,
  type PersonsQueueDid,
  type PersonsQueueHop,
  type PersonsQueueKind,
  type PersonsQueueRow,
  type PersonsQueueWorld,
  byBlockedSince,
} from './persons-queue-rows'

/**
 * ⚑ **W4.28 review · *I opened it* is never offered where the link is not shown.** A server's url
 * card answers *I opened it* (`accept`) — the person's word that they opened the link on the card —
 * and this queue draws no request detail, so the link is not on its row. ⛔ The positive is left off
 * here; Deny, Cancel and the way to the card stay. The card and the overview, which show the link,
 * keep it.
 */
function withoutALinkItDoesNotShow(
  live: AttentionRequest | undefined,
): AttentionRequest | undefined {
  if (live === undefined || live.kind !== 'permission') return live
  const decisions = live.decisions.filter(
    (one) =>
      !(
        one.kind === 'permission' &&
        one.decision.outcome === 'allow' &&
        one.server?.opensALink === true
      ),
  )
  return decisions.length === live.decisions.length ? live : { ...live, decisions }
}
/**
 * 🔴 **What one of the looks actually WALKED, as a surface reads it** (453) — see
 * `LedgerWalk`, which is where the store computes it.
 *
 * ⛔ **The sentence is rendered HERE, from the word the walk used** — *"the row carries the WORD,
 * the surface carries the sentence"* — and the reason `WALK_COVERS`
 * lives in `shared/` rather than on the wire: a sentence that crossed the IPC boundary would be a
 * second copy of a string this module can derive, free to go stale against the word beside it.
 */
interface QueueCoverage {
  /** Which candidate set the look started from. */
  readonly walk: LedgerWalkKind
  /** ⛔ **How many ledgers it opened** — the QUERY's number, never `rows.length`. */
  readonly ledgers: number
  /** ⛔ **How many ledger rows it could not read** — the partial load, counted. */
  readonly rowsUnread: number
  /** ⚑ **D-017 · R8** — how many records it skipped whole, when any. */
  readonly ledgersSkipped?: number
  /** {@link WALK_COVERS} for {@link walk}, said once. */
  readonly says: string
}

/**
 * Everything both surfaces draw that MOVES with the state.
 *
 * ⚠️ **The FIXED copy is not on here and does not need to be** — this said *"every string"* and
 * five were not. ⛔ **Stated as a RULE rather than as a list, since `403` added three more to it**
 * (the review caught the list under-counting): every word that does not MOVE with the state is
 * written once — one derivation, wherever it lives. ⚑ That covers the unfollowable paragraph, the
 * two age phrasings (this object carries the age, not the phrase), the *also listed* clause, the
 * two group labels and the short-list disclosure. The destination's own group label is the SCREEN's
 * chrome and not this queue's.
 *
 * Shared kind words are exported here; time wording lives in queue-time.ts.
 * Words only `PersonsQueue.vue` draws are its own.
 */
export interface PersonsQueueView {
  /**
   * ⛔ **Both populations, OLDEST-BLOCKED FIRST** (434, criterion 17; `403` had them concatenated)
   * — one list, because a person has one inbox and one order.
   *
   * ⚠️ Every row still carries {@link PersonsQueueRow.kind}, and a surface reads it **per row**
   * rather than grouping on it: a group is a second ordering, and two orderings on one list is the
   * thing criterion 17 forbids. See {@link byBlockedSince}.
   */
  readonly rows: readonly PersonsQueueRow[]
  /**
   * ⛔ **A fact, not a badge.** `rows.length`, never rounded, never capped, and never drawn at all
   * when it is zero — an app that says *"0"* where it means *"nothing"* has spent the reader's
   * attention to tell them there was nothing to spend it on.
   */
  readonly count: number
  /**
   * The strong line. ⚠️ **It names the populations rather than a total noun** (403): *"2 questions
   * and 1 decision are waiting on you"*, because how much of a summons somebody else might still
   * take is part of what it says.
   */
  readonly heading: string
  /**
   * ⛔ **The one sentence a screen reader is told, or the empty string** (401, from the v2.5.1
   * attention-policy correction).
   *
   * ⚑ **A question and a permission are the only things that may summon attention**, and since
   * `403` this channel carries both — not a completion, not an error, not a count of anything
   * else. `401` could spend only half of that licence, because the population that was missing is
   * the permission.
   *
   * 🔴 **And it now carries a THIRD kind of thing the grammar has no word for, which is a finding
   * rather than a licence quietly widened.** `403`'s reader admits every member of
   * `ChannelRefusal`, and that vocabulary's own docblock says *"four of these are criterion 10's
   * and the fifth is not — a secret is not authority, it is a credential"*. ⛔ **A conversation
   * frozen on a secret only a person can type is exactly as frozen as one frozen on an
   * approval**, so dropping it would be the surface refusing to show a person the thing that is
   * waiting on them; announcing it is the honest act and the grammar is what is short a member.
   * See `403`'s response §11.
   *
   * ⚠️ Empty when there is nothing, so the region says nothing rather than announcing an
   * all-clear nobody asked for.
   */
  readonly announcement: string
  /**
   * 🔴 **One of the two reads did not answer, so this list is short and says so** (403, from the
   * review).
   *
   * ⛔ **The first version coupled them and it re-created the defect `401` exists to prevent.** It
   * returned `null` for the whole view when EITHER read refused — so one persistent failure of the
   * verb `403` added deleted `401`'s escalated queue as well, and a summary counting a `null` view as
   * zero went back to *"Nothing needs you. The workspace is quiet."* over rows it had just read
   * successfully. ⚑ **A new read must not be able to take an old feature down.**
   *
   * ⚠️ **So `null` is now BOTH-refused, and one refusal draws what landed and discloses the
   * hole.** The count is then *what is known*, not *what there is* — which is a weaker claim than
   * the queue usually makes, and the only honest one available.
   */
  readonly partial: boolean
  /**
   * 🔴 **The most recent look did not answer, so what is drawn is the one before it** (434).
   *
   * ⛔ **This is the hole `403`'s `partial` could not see, and it is the one that is REACHABLE.**
   * The screen keeps each population's last good answer on a refusal — which is right, and is why
   * *"nothing is waiting on you"* cannot be drawn out of a dropped IPC call. ⚠️ But the value is
   * then non-null for ever, so `partial` is false for ever, and a read that has been failing since
   * the first minute of a session draws a list from that minute **with nothing saying so**.
   *
   * ⛔ **A queue that silently omits an item fails criterion 17 in the direction that costs most**,
   * and a stale list omits every item that arrived since it was taken. ⚑ So the two disclosures are
   * separate facts: {@link partial} is *a list has never been read*, this is *a list is not being
   * read any more*, and a surface may be in both at once.
   */
  readonly stale: boolean
  /**
   * 🔴 **What each look walked, or `null` because that look has never answered**
   * (453, HO-024 criterion 17's *everything*).
   *
   * ## ⛔ Why it is per POPULATION and not one number
   *
   * ⚠️ **The two walks read the SAME candidate set** — `questionsAPersonMustAnswer` and
   * `decisionsAwaitingAPerson` both start from `SELECT DISTINCT session_id … WHERE type =
   * 'request_routed'` — so a total across both double-counts every ledger and every unread row in
   * it. ⛔ A sum would be a number nobody could act on, which is the defect
   * {@link PersonsQueueView.count} refuses in the other direction.
   *
   * ⚑ **Exhaustive over {@link PersonsQueueKind}**, so a new population arrives here as a compile
   * error rather than as a silently missing coverage fact.
   */
  readonly covers: Readonly<Record<PersonsQueueKind, QueueCoverage | null>>
  /**
   * 🔴 **Not one of the looks that ANSWERED walked a ledger at all** (453).
   *
   * ⛔ **The false all-clear `403` and `434` each closed one door on, and this is the third.**
   * `partial` is *a list has never been read*; `stale` is *a list is not being read any more*; this
   * is **a list was read and there was no ledger behind it** — `NULL_SESSION_STORE` answers every
   * one of these readers with an empty list, and *"Nothing is waiting on you"* was drawn from it
   * with nothing anywhere able to tell it apart from a quiet workspace.
   */
  readonly noLedger: boolean
  /**
   * 🔴 **At least one look could not read a ledger ROW, so this list may be short** (453).
   *
   * ⛔ **`150`'s backlogged mark, come due on the one surface that cannot carry it.** An
   * unparseable ledger row has been skipped since `150` — *"a transcript with a hole is honest"* —
   * and that skip was invisible above the store. ⚠️ A digest may be scoped; a list of obligations
   * may not, so a row this app dropped is an obligation a person is not being told about.
   */
  readonly rowsDropped: boolean
  /**
   * 🔴 **ANY of the four holes — the one input `homeAttention.unread` takes** (453).
   *
   * ## ⛔ It exists because the two call sites had already diverged
   *
   * ⚠️ **`434` widened *what forbids quiet* from `partial` to `partial || stale` and widened it in
   * ONE of the two places.** One call site passed both; `RuntimeScreen.vue`'s `homeNeedsYou`
   * passed `partial` alone — so the rail's own summary could say *"Nothing needs you. The
   * workspace is quiet."* over a list that stopped answering an hour ago while the screen beside
   * it disclosed exactly that. ⛔ **`304`'s contradiction**, and the docblock over that call site
   * cites `304` by name.
   *
   * 🔴 **Two more holes would have been two more chances to diverge**, so the disjunction is
   * derived HERE and the call sites read one field — `taking-over.ts`'s ruling one surface over:
   * *two copies of one sentence is how the same press comes to be described two ways.*
   *
   * ⚑ **`quiet` is a CLAIM and every one of these says *not knowing*** — `086`'s rule, which is
   * the whole reason `unread` is an input at all.
   */
  readonly mayBeShort: boolean
}

/**
 * ⛔ **The noun each population is counted in, and the article it takes when there is one of it**
 * (446) — exhaustive over {@link PersonsQueueKind}, so a new population cannot reach a surface
 * without a word of its own.
 *
 * ⚠️ **`403` had two nouns in two functions and `434` read them in three places.** A third
 * population would have been a third function and a fourth branch in every sentence below; written
 * as data, the sentences fold over whatever is present and the compiler is what refuses a
 * population with nothing to call itself.
 */
const NOUN_OF_KIND: Readonly<Record<PersonsQueueKind, { one: string; many: string }>> = {
  'a-question': { one: 'question', many: 'questions' },
  'a-decision': { one: 'decision', many: 'decisions' },
}

/** "1 question" / "4 questions" — the plural said once, from the table above. */
function counted(kind: PersonsQueueKind, count: number): string {
  const noun = NOUN_OF_KIND[kind]
  return `${count} ${count === 1 ? noun.one : noun.many}`
}

/**
 * ⛔ **"a", "a and b", "a, b and c"** — the serial join, so a sentence that names N populations is
 * one derivation rather than one branch per combination (446).
 *
 * ⚠️ **`403` wrote the two-population sentence by hand**, and the asks joined it (D-017 · R19): a
 * sentence per state is `never-name-a-count-of-surfaces` written as prose.
 */
function andJoin(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

/**
 * ⛔ **What is waiting, counted by population and never blended into one noun** (403).
 *
 * ⚑ **"2 questions and 1 decision"**, because the populations are different kinds of thing and a
 * person reading a summons is entitled to know how much of it somebody else might still take.
 * ⚠️ **A population with no rows is not named** — a
 * heading that named an empty one would be a count of nothing, which is what
 * {@link PersonsQueueView.count} refuses to draw for the whole.
 */
function waitingFor(present: readonly { kind: PersonsQueueKind; count: number }[]): string {
  return andJoin(present.map((one) => counted(one.kind, one.count)))
}

/**
 * ⛔ **The word for the one answerer in the chain who is not a conversation** (401).
 *
 * ⚑ **A constant, because it is the only place a name is not a name.** `ChainHop.on` is `null` for
 * this hop precisely so that an agent called `you` — or, where a conversation has none, its working
 * folder (`734`) — cannot be mistaken for the person: the discrimination is the null, and this is
 * only how the null prints.
 */
const YOU = 'you'

/**
 * ⛔ **What every participant after the first has been observed to do** — the claim NAMED at the
 * point it is made, so the expression below reads as *the person, or silence* rather than as a
 * null beside a bare string.
 *
 * ⚠️ **Not *ran out of answers*, *could not answer* or anything else in that direction**, however
 * the identifier is spelled: see {@link PersonsQueueDid}. ⚑ A constant is a name and a name is a
 * claim (`a-column-name-is-a-claim`), so this one says exactly what its value says.
 */
const HAS_NOT_ANSWERED: PersonsQueueDid = 'has-not-answered'

/**
 * 🔴 **What the FIRST participant did, by population** (613).
 *
 * ⚠️ **A permission DID ask**: it is a `RoutedRequest` like an escalated question, and what it was
 * refused is entry to the channel rather than the asking.
 *
 * ⚑ **Exhaustive over {@link PersonsQueueKind}** for {@link NOUN_OF_KIND}'s reason: a new
 * population cannot reach a surface without deciding what its asker did.
 */
const RAISED_IT: Readonly<Record<PersonsQueueKind, PersonsQueueDid>> = {
  'a-question': 'asked',
  'a-decision': 'asked',
}

/**
 * 🔴 **The hops turned into the thing a person looks at: A → B → you** (401).
 *
 * ⛔ **Derived, not a second walk.** Each hop is *X waiting on Y* and `hops[n].waiting` is
 * `hops[n-1].on` by construction, so the chain a surface draws is the first hop's asker followed by
 * every hop's answerer — one participant per hop end, in order, and none said twice in a row. ⚠️
 * Since `734` a participant is its AGENT's name, so two conversations of one identity next to each
 * other in a chain read the same word twice. ⚑ The wire row carries each conversation
 * (`PersonsQuestion.chain.links`); this row carries the asker's (`sessionId`) — `732` F-6. ⚑ And two
 * ROWS whose askers read one name are told apart beside the chain, never inside it
 * ({@link namesakesIn}, `737`).
 *
 * ⛔ **613 · and each of them carries what it DID** — see {@link PersonsQueueDid}. ⚑ Derived from
 * the same hop the name came from and never decided per surface, which is what stops two surfaces
 * saying two things about one walk.
 *
 * ⚠️ **An empty reading gives an empty chain, and never a bare `you`.** `escalationChain` cannot
 * produce one — it seeds a link before the loop — but the wire type permits it, and a surface that
 * printed a lone *"you"* for it would name a person as the answerer of a walk with no hops in it.
 */
function chainOf(hops: readonly ChainHop[], raised: PersonsQueueDid): PersonsQueueHop[] {
  const first = hops[0]
  if (first === undefined) return []
  return [
    { name: first.waiting, you: false, did: raised },
    // ⛔ **One condition, read twice** (613). ⚑ `hop.on === null` is the person, and both fields
    // are derived from it in one expression so a hop that says *you* and also claims an act is
    // unconstructable — which is what {@link PersonsQueueHop.did}'s *null iff you* rests on.
    ...hops.map((hop) => ({
      name: hop.on ?? YOU,
      you: hop.on === null,
      did: hop.on === null ? null : HAS_NOT_ANSWERED,
    })),
  ]
}

function disclosedBy(card: AttentionRequest): DisclosedRequest {
  return {
    asked: card.asked,
    scope: card.scope,
    underDisclosed: card.underDisclosed,
    detailOmitted: card.detailOmitted,
    ...(card.agentSays === undefined ? {} : { agentSays: card.agentSays }),
    ...(card.actionLines === undefined ? {} : { actionLines: card.actionLines }),
  }
}

/**
 * 🔴 **The one derivation of this queue's rows and its words** — pure, so both surfaces and a test
 * ask it the same question without a component around it.
 *
 * ⚠️ **`null` is *nobody has answered yet*, and it is not *nothing is waiting*.** `086`'s rule on
 * the one read where the wrong default is a false all-clear: a queue drawn empty before the first
 * look has landed claims a person is free, which is the claim this whole surface exists to stop
 * the app making by omission.
 *
 * ## ⛔ A CLOSED question cannot appear here, and the reason is upstream
 *
 * `SessionStore.questionsAPersonMustAnswer` filters `REQUEST_IS_OPEN[state]` (and, since `611`,
 * admits a row a deadline stamped OR one whose asker ADDRESSED it to a person, while excluding
 * {@link WhereARequestWent}'s refused arm by name — it was `escalatedAt !== null && because ===
 * null` until `HO-088` §2 gave a question a second way to become a person's), and
 * `RuntimeHost.questionsForAPerson` only maps — so `interrupted`, `stranded`, `abandoned`,
 * `answered`, `rejected`, `decided` and `withdrawn` are all absent by construction and this
 * surface never renders one. ⚠️ **What it must therefore not do is promise the converse.** A row
 * was open *when the look landed*; between that and a press the parent may answer it, somebody may
 * press Stop, or the app may go down. So the button takes a person to the CARD and the card
 * answers for itself, and nothing here says the question can still be answered.
 */
export function personsQueueView(
  questionsForAPerson: LedgerWalk<PersonsQuestion> | null,
  decisionsForAPerson: LedgerWalk<PersonsDecision> | null,
  world: PersonsQueueWorld,
): PersonsQueueView | null {
  // ⛔ **`null` only when NEITHER has landed** (403, corrected by the review). ⚠️ The first version
  // returned `null` when either did, which reads as the conservative choice and is the opposite:
  // `null` here means *nothing is drawn*, *Waiting on you* counts it as zero, and
  // one persistent failure of the new verb would therefore delete the escalated queue AND put the
  // screen back to *"the workspace is quiet"* over rows it had just read. ⛔ A read added today may
  // not take a feature that shipped yesterday down with it. ⚑ What one refusal costs instead is
  // disclosed — see {@link PersonsQueueView.partial}.
  if (questionsForAPerson === null && decisionsForAPerson === null) return null
  const asked = questionsForAPerson?.rows ?? []
  const settled = decisionsForAPerson?.rows ?? []
  // 🔴 **453 · what each look WALKED, kept beside what it found.** ⛔ `null` is *this look has
  // never answered* — the same absence {@link PersonsQueueView.partial} reads — and it is not
  // *"it walked nothing"*, which is `no-ledger` and a different sentence.
  const coverOf = <Row>(walked: LedgerWalk<Row> | null): QueueCoverage | null =>
    walked === null
      ? null
      : {
          walk: walked.walk,
          ledgers: walked.ledgers,
          rowsUnread: walked.rowsUnread,
          ...(walked.ledgersSkipped === undefined ? {} : { ledgersSkipped: walked.ledgersSkipped }),
          says: WALK_COVERS[walked.walk],
        }
  const covers = {
    'a-question': coverOf(questionsForAPerson),
    'a-decision': coverOf(decisionsForAPerson),
  } as const satisfies Readonly<Record<PersonsQueueKind, QueueCoverage | null>>
  const walked = Object.values(covers).filter((one) => one !== null)
  // ⛔ **EVERY look that answered, and never one of them.** A single look with no ledger behind it
  // while the others read the workspace is not a blind card — it is one read this app could not
  // serve, and drawing the strongest disclosure over it would say nothing was seen when most of it
  // was.
  //
  // ⚠️ **No `walked.length > 0` guard, and its absence is argued rather than forgotten.** `every`
  // over an empty list is vacuously TRUE, which would be the wrong answer — but the list cannot be
  // empty here: this function has already returned `null` when both readings are `null`, which
  // `persons-queue.test.ts` §2 pins. ⛔ A conjunct no mutation can make fail is not carrying a rule
  // (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`); the early return is.
  const noLedger = walked.every((one) => one.walk === 'no-ledger')
  // ⚠️ **ANY, not all.** One walk that dropped a row — or (D-017) skipped a whole record — makes
  // the whole merged list short.
  const rowsDropped = walked.some((one) => one.rowsUnread > 0 || (one.ledgersSkipped ?? 0) > 0)
  const place = (
    kind: PersonsQueueKind,
    request: { askedBy: string; requestId: string },
    hops: readonly ChainHop[],
    unfollowable: boolean,
    sentence: string,
    says: string | null,
    at: number | null,
    blockedSinceIs: BlockedSinceIs,
    work: readonly WorkInHand[],
    // ⛔ **474 · handed in from the population that knows** — see {@link PersonsQueueRow.about}.
    // ⚑ A permission passes {@link NOTHING_NAMED_THE_WORK}, which is that answer
    // DERIVED through the same fold rather than a word spelled twice.
    about: AboutWork,
    // 🔴 **UI-009 · a question THIS APP asked, with the host's offer on it — or `null`** — see
    // {@link PersonsQueueRow.question}. ⛔ Handed in per population for the reason `about` is: only
    // the question population can raise one, and a decision says `null` rather than being
    // defaulted into it.
    askedHere: { readonly offered: OfferedAnswer | null } | null,
    // 🔴 **D-046 · the question as it was asked**, off the person's list — `null` for a decision,
    // and where the host found no row.
    askedWords: QuestionWords | null,
  ): PersonsQueueRow => {
    const key = `${request.askedBy}:${request.requestId}`
    const held = world.held.has(request.askedBy)
    // ⛔ **The live row is the ONLY source of what may be sent** — see
    // {@link PersonsQueueRow.answers}. ⚠️ `held` and this are two different questions and the row
    // says both: a window can hold a conversation whose card is not in the page it holds.
    const onScreen = world.answerable.get(key)
    const live = withoutALinkItDoesNotShow(
      onScreen ?? (held ? undefined : world.nobodyHolds?.get(key)),
    )
    // 🔴 **UI-009 · a question this app asked is answered on its own card** — see
    // {@link PersonsQueueRow.question}. ⚑ Its words, off the person's list (D-046); and whether
    // this window already pressed, read before the card is drawn, so the five
    // seconds between a press and the next look say *answer sent* rather than offer it again
    // (`468`, `207` M2). ⚑ **D-017 · R6** — whether this window HOLDS the asker is not asked.
    const question: AppQuestion | null =
      askedHere === null
        ? null
        : {
            words: askedWords,
            offered: askedHere.offered,
            sent: world.answeredFromHere.has(key),
          }
    const settling =
      question !== null
        ? // ⚑ **The card answers it** — no decision from the live queue, and nothing to explain.
          { answers: [], limit: null, noAnswerHere: null }
        : live === undefined
          ? {
              answers: [],
              limit: null,
              // 🔴 **468 · THREE absences and not two** — see {@link NoAnswerHere}. ⚠️ The window's
              // own answer is read FIRST, because it is the one this row caused: a card settled by
              // the press a person just made here is not a card that was never in this page, and
              // *"open it to answer"* over one is a false instruction rather than a missing one.
              //
              // ⚑ **UI-009 · `602`'s fourth absence is gone** — a question this app raised has its
              // card above, so every row here has a card in its asker's transcript.
              //
              // ⚠️ **The ladder below is written with no comment in it on purpose**: mutation rows
              // across `434` and `602` anchor on this expression as literal text, and a sentence
              // inside it would darken every one of them the next time somebody edited a word
              // (`a-source-census-that-pins-a-line-kills-every-row-on-it`, one instrument over).
              noAnswerHere: world.answeredFromHere.has(key)
                ? 'no-longer-waiting'
                : held
                  ? 'not-in-this-window'
                  : 'not-yours-yet',
            }
          : live.sent
            ? // ⛔ **`sent` before the offer** (`207` M2): the buttons are gone the instant one is
              // pressed, and the reason is said where they were.
              { answers: [], limit: live.limit, noAnswerHere: 'answer-sent' }
            : live.decisions.length === 0
              ? { answers: [], limit: live.limit, noAnswerHere: 'nothing-on-offer' }
              : { answers: live.decisions, limit: live.limit, noAnswerHere: null }
    return {
      kind,
      key,
      sessionId: request.askedBy,
      requestId: request.requestId,
      ...(live?.card ? { liveCard: live.card, cardProvider: live.provider } : {}),
      chain: chainOf(hops, RAISED_IT[kind]),
      unfollowable,
      sentence,
      says,
      // ⚠️ **Null is rendered as "no time recorded", never as zero and never as "just now"** —
      // `attention.ts`'s rule, and the age is this surface's whole argument.
      since: at === null ? null : agoWords(at, world.now),
      // ⛔ **The same number the words were made from** — see {@link PersonsQueueRow.blockedSince}.
      blockedSince: at,
      // ⚠️ **`not-recorded` overrides the population's own clock when the stamp did not cross**,
      // because *which instant this is* and *there is no instant* are answers to the same question
      // and a row may not carry both.
      blockedSinceIs: at === null ? 'not-recorded' : blockedSinceIs,
      held,
      // ⚑ **487 · read off the LIVE row, and only where this row can still be answered here.**
      //
      // ⛔ **Both halves are load-bearing** (the second was found by this dispatch's own review).
      // A window that does not hold this card has no offer to read, and inventing the sentence
      // from a stale one is the shape `453` already paid for. ⚠️ **And every sentence this field
      // can carry ends with *refusing still works*** — which is false the instant there are no
      // buttons beside it. A row whose answers are gone for ANY of {@link NoAnswerHere}'s reasons
      // says that reason and nothing else: two sentences about one row, one of them describing
      // controls that are not there, is `468`'s false instruction with a new subject.
      noPositive: settling.answers.length === 0 ? null : (live?.noPositive ?? null),
      // ⚑ **701 · the same two halves, for the same reason** — see {@link PersonsQueueRow.marksSay}.
      marksSay: settling.answers.length === 0 ? [] : (live?.marksSay ?? []),
      refusesFirst: settling.answers.length > 0 && live?.refusesFirst === true,
      // ⚑ **D-017b · the one press's words** (`taking-over.ts`): the row's travel opens the
      // conversation in its full view, whatever it is doing, as every surface's press does.
      action: OPEN_THE_CONVERSATION,
      alsoOnScreen: onScreen !== undefined,
      answers: settling.answers,
      limit: settling.limit,
      // ⛔ **468 · off the LIVE row, which is the only thing that holds it** — a request with no
      // live projection has no bounced answer to report, because the thing that bounced took the
      // card out of the projection or left it in it. See {@link PersonsQueueRow.refused}.
      refused: live?.refused ?? null,
      noAnswerHere: settling.noAnswerHere as NoAnswerHere | null,
      question,
      // ⚑ A provider's question: its words, drawn beside the row's own answer path.
      words: question === null ? askedWords : null,
      disclosed:
        kind === 'a-decision' && settling.answers.length > 0 && live !== undefined
          ? disclosedBy(live)
          : null,
      work,
      about,
    }
  }
  const rows = [
    ...asked.map((one) =>
      place(
        'a-question',
        one.request,
        one.reading.hops,
        one.reading.unfollowable,
        one.sentence,
        // ⛔ **Null, and it is a fact rather than a gap.** `says` names what kept a request OUT of
        // the question channel; this one went through it. What happened to it is the chain.
        null,
        // 🔴 **611 · the moment it became a PERSON's, which is no longer always an escalation**
        // (HO-088 §2, HO-090 §4) — see {@link PersonsQuestion.aPersonsSince}. ⛔ It read
        // `one.request.escalatedAt`, which is null for a question its asker ADDRESSED to a person:
        // every such row would have drawn *"no time recorded"* and sorted as `not-recorded` in a
        // queue whose whole ordering is oldest-blocked first.
        one.aPersonsSince,
        // 🔴 **611 · WHICH event that number came off, which is now two events on one
        // population** (HO-088 §2). ⛔ This vocabulary's own job is to say which — *"`told` and
        // `routed` are not the same event"* — and a question an asker ADDRESSED to a person was
        // never told to anybody: it was a person's from the instant it was routed, which is
        // exactly what `routed` already means one population over.
        one.request.went.is === 'the-person-the-asker-named' ? 'routed' : 'told',
        one.work,
        // 🔴 **474 · the ONE population that can name its work** — `question_asked.piece` (`437`'s
        // edge, a piece since D-016), carried from the host's own fold. See {@link PersonsQueueRow.about}.
        one.about,
        // 🔴 **UI-009 · the ONE population this app can raise**, answered on its own card — the
        // offer is `whatTheAskerOffered`'s, run main-side beside the read that answered `raisedBy`.
        one.raisedBy === 'this-app' ? { offered: one.offered } : null,
        one.asked === null ? null : wordsAsked(one.asked, one.raisedBy === 'this-app'),
      ),
    ),
    ...settled.map((one) =>
      place(
        'a-decision',
        one.request,
        one.reading.hops,
        one.reading.unfollowable,
        one.sentence,
        one.says,
        // ⛔ **The routing's own stamp, because there is no other moment** — see
        // {@link PersonsQueueRow.since}. It was a person's from the instant it was written.
        one.request.at,
        'routed',
        one.work,
        // ⛔ **A permission names no piece at all** — `PermissionRequestEvent` has no such field —
        // so the answer is not *unknown*, it is *nothing records it*.
        NOTHING_NAMED_THE_WORK,
        // ⛔ **A permission has a card in the asker's own transcript and the card is what answers
        // it** — the provider raised it there. ⚠️ Composing an offer here would be `214 §3`'s
        // defect, and `permissionOffer` already decides it, on the live row.
        null,
        null,
      ),
    ),
    // ⛔ **Sorted ONCE, over both, and this is criterion 17's first clause** (434) — see
    // {@link byBlockedSince}. ⚠️ `403` concatenated here and each reader sorted its own
    // population, so the list was ordered by which READER found a row.
  ].sort(byBlockedSince)
  const count = rows.length
  // ⛔ **What is actually here, by population, and never a list of every population** (446) — the
  // sentences below fold over THIS, so a population with no rows is named nowhere.
  const present = (
    [
      { kind: 'a-question', count: asked.length },
      { kind: 'a-decision', count: settled.length },
    ] as const satisfies readonly { kind: PersonsQueueKind; count: number }[]
  ).filter((one) => one.count > 0)
  const only = present.length === 1 ? present[0]!.kind : null
  // ⛔ **One of the two reads did not answer** — see {@link PersonsQueueView.partial}. Named here
  // because the heading has to know: a strong line claiming to know, over a small line saying it
  // does not, is one card saying two things.
  const partial = questionsForAPerson === null || decisionsForAPerson === null
  // ⛔ **A read that has STOPPED answering, which `partial` cannot see** — see
  // {@link PersonsQueueView.stale}. ⚠️ Named beside `partial` rather than folded into it: they are
  // different holes, a surface may be in both, and the sentence for each is different.
  const stale = !world.lastLookAnswered.questions || !world.lastLookAnswered.decisions
  return {
    rows,
    count,
    // ⛔ **A true sentence at zero, and the PHOTOGRAPH is what found the second arm.** With one
    // read refused and the other empty this card draws — that is the whole of `partial` — and it
    // was drawing the strong line *"Nothing is waiting on you"* directly above a small line
    // saying a list could not be read. ⚠️ Two sentences, one claiming to know and one saying it
    // does not. ⚑ Naming every population would have been worse still: *"0 decisions"*, a noun for
    // a population that is not there — which is why `present` is filtered.
    heading:
      count === 0
        ? // ⛔ **Two different holes and two different sentences** (434). A list that has never
          // been read and a list that has stopped being read are not the same claim, and neither
          // of them is *"nothing is waiting on you"* — which at zero-with-a-hole is the strongest
          // false thing this app can say about somebody's own workload.
          // 🔴 **453 · and a THIRD and FOURTH hole, in front of the other two.** ⛔ *"This app has
          // no ledger"* subsumes every other disclosure — nothing was read, so nothing can be
          // partial or stale about it — and *"some of it could not be read"* is the one hole that
          // is true of a list that DID answer. ⚠️ Ordered strongest-first for `434`'s reason: at
          // zero-with-a-hole, *"nothing is waiting on you"* is the strongest false thing this app
          // can say about somebody's own workload, and every arm above it is a true one.
          noLedger
          ? 'No list could be read at all'
          : partial
            ? 'One list could not be read'
            : stale
              ? 'One list has stopped answering'
              : rowsDropped
                ? 'Some of what is waiting could not be read'
                : 'Nothing is waiting on you'
        : // ⚑ **446 · the singular reads its noun out of the same table the plural does.** ⛔ `403`
          // wrote *"A question"* / *"A decision"* as a ternary on one population's count, which is
          // a branch per population: a third would have made the FALSE arm mean *"whichever of the
          // other two it was"*.
          count === 1 && only !== null
          ? `A ${NOUN_OF_KIND[only].one} is waiting on you`
          : `${waitingFor(present)} are waiting on you`,
    announcement: count === 0 ? '' : `${waitingFor(present)} waiting on you.`,
    partial,
    stale,
    covers,
    noLedger,
    rowsDropped,
    // ⛔ **Derived once, here** — see {@link PersonsQueueView.mayBeShort} for the divergence it
    // closes. ⚑ Written as an `||` over the four named facts rather than as a fifth computation,
    // so a fifth hole added above cannot reach a surface by being forgotten in one of two places.
    mayBeShort: partial || stale || noLedger || rowsDropped,
  }
}
