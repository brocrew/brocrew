import { SUPPORTED_PROVIDERS } from '@brobot2/shared'
import { providerDefinitions } from '../providers/definitions'
import { CHANNEL_REFUSAL_SENTENCES } from '@brobot2/runtime'
import {
  DIGEST_LINE_KINDS,
  LINE_REGISTERS,
  claimedLine,
  observedLine,
  type ClaimedLine,
  type DigestRegister,
  type DigestGap,
  type DigestGapKind,
  type DigestLine,
  type ObservedLine,
  type ObservedLineKind,
  type NativeFanOut,
} from '../../shared/digest'
import { PERMANENCE_SAID, isRailPermanence } from '../../shared/refusals'
import { nothingRecordsWho, whoDidItSays } from '../../shared/who-did-it'
import { whereItWent, type LedgerWalk } from '../../shared/questions'
import { ASKED_TO_STOP } from '../../shared/how-work-stopped'
// ⚑ **D-016 · a piece is its label beside its title** (`shared/piece-called`), in `shared/` so main
// spells it as the window does — and the `tool-answered` line quotes tools' receipts, which name
// pieces by the same label.
import { pieceLine } from '../../shared/piece-called'
import { ledgersSkippedOf, skipTheLedger, type DigestRow } from '../db/session-store'
import { AGENT_TOOL_SERVER } from './agent-tools'

/**
 * 🔴 **The distiller** (438, HO-024 §5.1–5.4, HO-025 §2 criteria 16/18/19).
 *
 * ## ⛔ A pure fold, and that is what criterion 19 is
 *
 * ⚑ **`distil(read, name)` reads nothing and writes nothing.** Hand it the same read and it
 * returns the same value — HO-024 §5.4's *"regenerate it from the ledger and get the same
 * digest"*, made a property of a function rather than a promise about a cache. ⛔ **There is no
 * cache here and none anywhere behind it**: the store read is issued fresh on every refresh, and
 * a value that can answer differently from the fold is the *stored opinion* the criterion forbids.
 *
 * ## ⛔ Observed lines are GROUPED; claimed lines are not
 *
 * ⚠️ **Not a layout preference — a claim about interchangeability.** Four `turn` rows say exactly
 * what *"4 turns ended"* says. Two `work_replied` rows are two agents' sentences, and collapsing
 * them into *"2 workers reported"* would throw away the only content a person is reading this
 * INSTEAD of the transcript for. ⛔ So an observation's instances fold into a count and an agent's
 * declaration keeps its own line, its own words and its own speaker.
 *
 * ## ⚠️ What crosses, and what deliberately does not
 *
 * ⛔ **`work_given.brief` is never drawn.** That field IS the work — `405` §2's rule, the same one
 * that keeps a request's arguments off `tool_refused`. The line names the piece by its label and
 * title, and the conversation, which is what a person quotes.
 *
 * ⚑ **`work_replied.summary` IS drawn, and the distinction is real rather than convenient.** A
 * summary is a report ABOUT work, written by an agent to be read by whoever gave the work; a
 * prompt or an `apply_patch` argument is the work itself. ⚠️ And it is drawn as `claimed`, with
 * the agent named on the row, which is the whole of HO-024 §5.1.
 *
 * ⛔ **`question_asked.prompt` is never drawn either** — `437`'s row is read only to decide
 * whether a routing can say which work it is about. A type in the read vocabulary that produces
 * no line of its own is a decision, stated here so it cannot be mistaken for an omission.
 */

/**
 * ⚑ **Fixed, so the surface's order is the vocabulary's and not the ledger's accidents** — and
 * DERIVED from {@link LINE_REGISTERS} since `466`, rather than a second list of the same words.
 *
 * ⛔ **`ObservedLineKind`, so `worker-reported` cannot be listed here** (465). It used to be the
 * whole vocabulary minus one member somebody had remembered to leave out, and the day anybody
 * pasted the twelfth in, an agent's own sentence would have been grouped and drawn as something
 * the engine watched.
 *
 * 🔴 **466 · and it was still a LITERAL, which is invisible when it goes short in the other
 * direction.** `sentence()` is exhaustive, so a kind added to {@link DIGEST_LINE_KINDS} and
 * forgotten there is a compile error — but a kind added and forgotten HERE compiled, folded, and
 * was never emitted by {@link distil}, with nothing red. ⚠️ That is
 * `a-loop-over-a-literal-variant-list-is-not-exhaustive`, and `466` added four kinds at once,
 * which is the dispatch that would have paid for it. ⚑ **465's own table is the derivation**: a
 * kind is drawn in order exactly when it declares it may be built as an observation.
 */
const OBSERVED_ORDER: readonly ObservedLineKind[] = DIGEST_LINE_KINDS.filter(
  (kind): kind is ObservedLineKind =>
    (LINE_REGISTERS[kind] as readonly DigestRegister[]).includes('observed'),
)

/** `1 thing` / `4 things`, because a digest that says *"1 turns ended"* is read as a machine. */
function many(count: number, one: string, more: string): string {
  return count === 1 ? `1 ${one}` : `${String(count)} ${more}`
}

/**
 * ⛔ **`1 · this one; 2 · that one`** — a counted breakdown in one of the app's own closed
 * vocabularies (466).
 *
 * ⚑ **`turn-ended`'s shape, with a sentence where it has a word.** That line says *"3 completed,
 * 1 failed"* because `turn.state`'s members read as English; `RAIL_PERMANENCES` and
 * `CHANNEL_REFUSALS` are hyphenated codes that do not, so each count carries the vocabulary's own
 * sentence instead — `PERMANENCE_SAID` and `CHANNEL_REFUSAL_SENTENCES`, never a third spelling.
 *
 * ⚠️ **`say` takes a `string`**, deliberately: a word off a replayed ledger that this build's
 * vocabulary no longer contains is printed as itself, which is `permanenceSaid`'s rule and the one
 * place a digest must not print `undefined`.
 */
function eachWord(counts: Map<string, number>, say: (word: string) => string): string {
  return [...counts].map(([word, n]) => `${String(n)} · ${say(word)}`).join('; ')
}

/**
 * ⛔ **The clause that names actors, or nothing at all** (477) — {@link eachWord}'s breakdown with
 * the vocabulary's own sentences, and the empty string when this window saw none.
 *
 * ⚠️ **Empty rather than *"nobody"***: a window whose every row predates provenance must compose
 * `465`'s sentence and nothing else, so the two clauses are independent and each one is silent
 * about a population it has no rows for.
 */
function whoClause(counts: Map<string, number>, lead: string): string {
  return counts.size === 0 ? '' : ` ${lead}: ${eachWord(counts, whoDidItSays)}.`
}

/**
 * ⛔ **`465`'s sentence, scoped to the rows it is still true of** (477, HO-029 §2.2).
 *
 * ⚠️ **Counted off the silent rows and never off the group**, which is what makes a MIXED window
 * honest: two requests answered, one of them by a named person, must say the absence about ONE.
 * ⚑ A window with no silent rows says nothing here, and a window with nothing else composes
 * exactly the string `465` shipped.
 */
function nobodyClause(count: number, verb: string): string {
  // ⛔ **503 · the sentence itself moved to `shared/who-did-it.ts` and this composes it.** A
  // request CARD now describes the same population, and two composers of one sentence are two
  // chances to disagree about the fact this app has to be most careful with. ⚑ What stays here is
  // the digest's own frame — the leading space, the full stop, and the silence at zero.
  return count === 0 ? '' : ` ${nothingRecordsWho(verb, count)}.`
}

interface Grouped {
  count: number
  at: number
  /** The newest row's own detail, or null when this kind draws none. */
  detail: string | null
}

/** ⚑ **D-016 · a piece as a line names it** — its label beside its title ({@link pieceLine}). */
interface NamedPiece {
  readonly piece: string
  readonly label: string
  readonly title: string
}

/**
 * What the fold accumulates before it composes a sentence. ⛔ Counters only — no row is kept, so
 * a digest cannot accidentally grow a transcript inside itself.
 */
interface Tally {
  readonly groups: Map<ObservedLineKind, Grouped>
  readonly claims: ClaimedLine[]
  /** A piece's id to its label and title, for pieces GIVEN inside this window. */
  readonly given: Map<string, NamedPiece>
  /**
   * 🔴 **475 · the held message's name to the piece it carried**, for pieces given inside this
   * window whose brief was HELD — `WorkGivenEvent.messageId`, which is absent when the brief went
   * straight out and there was no message to hold.
   *
   * ⛔ **`derivePieces` keys the same pair the same way and its rule is carried, not re-decided**:
   * *"an unnamed ending pairs with nothing"* (`354`). A ledger written before messages had names
   * holds `message_unqueued` rows with no `messageId`, and treating `undefined` as a match would
   * join two different messages.
   *
   * ⚠️ **A BARE key, and {@link key} holds the rule this field is the example of.**
   * `newQueuedMessageId` is `msg_${randomUUID()}`, minted at one call site in this process and
   * never supplied by a caller, so two conversations cannot hold one between them. ⛔ **Not because
   * this read is narrow** — it is the widest read in the app — **but because the id cannot repeat
   * across conversations in the first place.**
   */
  readonly byMessage: Map<string, NamedPiece>
  /**
   * 🔴 **475 · pieces this window can say something about the fate of** — a reply, a taking back,
   * a brief that was never sent, or a restart that stalled it. ⛔ It is the set the
   * `work-without-an-ending` gap subtracts, so a piece this digest DID speak for is not also counted
   * as one it could not.
   *
   * ⚠️ **Not a claim that the work is closed.** A stalled piece is open and a not-sent one is very
   * much open; this records that a SENTENCE on this card is about it.
   *
   * ⚑ **Bare, for {@link byMessage}'s reason one id over** — `newWorkId` is `work_${randomUUID()}`,
   * and {@link key} is where the rule lives.
   */
  readonly spokenFor: Set<string>
  /**
   * 🔴 **D-016 · the questions each piece's owner asked about it, inside this window** — by piece,
   * each as its `(conversation, request id)` {@link key}. ⚑ Taking the piece back or closing it ends
   * them (the questions fold's `work_taken_back` and `work_closed` arms), so this digest's arms for
   * the two read them into {@link ended}: no row of their own says so.
   */
  readonly questionsAboutPiece: Map<string, string[]>
  /**
   * 🔴 **Requests a `question_asked` row was written for** — `437`'s only such row — **by
   * `(conversation, request id)`** (474).
   *
   * ⛔ **Composite through {@link key}, which is also where the difference from {@link byMessage}
   * is argued.** ⚠️ This set can hold a PROVIDER's request id, and one id this app did not mint is
   * enough — `463` F2: *"provider request IDs are only session-local"*.
   */
  readonly questionsNamingWork: Set<string>
  /**
   * Every routed request seen in this window, travelled or not — by `(conversation, request id)`.
   * ⛔ See {@link key} for why the pair.
   */
  readonly routed: Set<string>
  /**
   * ⛔ **Routed ids that TRAVELLED**, which is the only population *which work is this about* can
   * be asked of. A permission never travelled and has no piece to name, so counting it in the
   * `question-without-work` gap would fire that gap on every permission in every window and
   * leave it permanently unclosable — a gap in every window every time, which HO-025 §5.3 says
   * would mean the design is wrong rather than the ledger.
   *
   * ⛔ **By `(conversation, request id)` since `474`** — see {@link key}.
   */
  readonly travelled: Set<string>
  /**
   * Routed requests this window also saw ended — by `(conversation, request id)`. ⛔ See
   * {@link key} for why the pair.
   */
  readonly ended: Set<string>
  /** Conversations a restart caught holding work — counted once each, not once per row. */
  readonly restartedIn: Set<string>
  /** Replies about a piece that was not given in this window. */
  carriedIn: number
  /** One key per native child, holding the largest reading it reported. */
  readonly childMax: Map<string, number>
  /** Every native child seen, reporting or not. */
  readonly childSeen: Set<string>
  readonly turns: {
    completed: number
    failed: number
    interrupted: number
    /** ⛔ A `state` this build does not know — counted, never indexed. See the `turn` arm. */
    unreadable: number
  }
  refusals: number
  replies: number
  /**
   * 🔴 **How many refusals carried each permanence, in the order they were first seen** (466).
   *
   * ⛔ **Keyed by the raw word off the row and never by {@link RailPermanence}**, because a ledger
   * row is `JSON.parse`d and cast: a build reading a vocabulary that has moved must count the word
   * it found rather than drop it. `permanenceSaid` prints it as itself; this counts it as itself.
   */
  readonly permanences: Map<string, number>
  /**
   * 🔴 **How many requests only a person can settle came up for each reason** (466), first-seen
   * order — `request_routed.because`, which the fold already reads to tell two populations apart
   * and used to discard.
   */
  readonly because: Map<string, number>
  /**
   * 🔴 **A call this app's OWN tools answered, by `(conversation, call id)`** (466).
   *
   * ⛔ **Composite, through {@link key}, and that is not caution.** `tool_call.id` is the
   * PROVIDER's, and `463` F2 measured a real collision from keying request facts on a bare one
   * across a project: *"provider request IDs are only session-local"*. ⚠️ A `tool_result` matched
   * to a `tool_call` of the same id in ANOTHER conversation would print one tool's name over
   * another tool's answer, which is that defect with a sentence on it.
   *
   * ⚑ **`466` keyed this field this way and refused to widen it; `474` widened it** — and
   * {@link key} says why that follows from where an id is minted rather than from which dispatch
   * arrived first.
   */
  readonly ourCalls: Map<string, string>
  /**
   * 🔴 **477 · how many answered requests named each actor**, first-seen order — the counter
   * {@link Tally.permanences} is, over {@link WHO_DID_IT} instead of `RAIL_PERMANENCES`.
   *
   * ⛔ **Keyed by the raw word off the row and never by {@link WhoDidIt}**, for `permanences`'
   * stated reason: a ledger row is `JSON.parse`d and cast, so a build reading a vocabulary that has
   * moved counts the word it found rather than dropping it. {@link whoDidItSays} prints it as
   * itself.
   */
  readonly answerers: Map<string, number>
  /**
   * 🔴 **477 · how many answered requests named NOBODY** — the rows written before this app
   * recorded an actor (HO-029 §2.2).
   *
   * ⛔ **A separate counter and not a member of {@link answerers}.** *We never wrote this down* and
   * *the caller was one this app has no word for* are different claims about the ledger, and
   * folding them into one count would report a discontinuity in this app's own history as a
   * property of whoever answered. ⚑ It is what keeps `465`'s sentence exactly right for the
   * population it was written for, for ever.
   */
  answeredByNobodyRecorded: number
}

function bump(tally: Tally, kind: ObservedLineKind, at: number, detail: string | null): void {
  const held = tally.groups.get(kind)
  if (held === undefined) {
    tally.groups.set(kind, { count: 1, at, detail })
    return
  }
  held.count += 1
  // ⚠️ **The NEWEST row supplies the detail**, and `>=` rather than `>` so that rows sharing a
  // millisecond resolve to the later one in read order rather than to the first one seen.
  if (at >= held.at) {
    held.at = at
    held.detail = detail
  }
}

/**
 * ⛔ **One key per `(conversation, thing)` pair, joined by a byte no id can contain.**
 *
 * ⚠️ `sub_agent.agentId` and `workflow_run.taskId` are bare `z.string()` with no `.max()` and no
 * character rule — a provider chooses them. A space or a slash as the joiner would let two
 * different children share one key and be max-merged into one reading, which is the one
 * arithmetic mistake this whole section exists to avoid.
 *
 * 🔴 **474 · and the same joiner now carries every REQUEST fact in this fold** (`463` F2). ⛔ A
 * provider's request id is minted per conversation — Codex's is a JSON-RPC `RequestId`, rendered
 * `number:1` for the first server request of every connection, and Claude's is an SDK `toolUseID`
 * *"unique per tool call and scoped to the turn that raised them"*. ⚠️ **So a bare id made two
 * conversations' first questions one request**: an answer in one closed the `open-is-not-waiting`
 * gap for the other, and a `question_asked` in one closed the `question-without-work` gap for the
 * other. ⛔ **`NUL` rather than `:` or `-`**, because a request id may contain either — `requestKey`
 * renders a Codex id as `number:1`, which already has a colon in it.
 *
 * ## 🔴 Which keys in this fold carry the conversation, and which do not — ONE account
 *
 * ⚑ **474 relay 1**, because `474` and `475` landed on neighbouring fields and each argued about
 * the OTHER's subject. ⛔ **Two self-contained halves of one rule is not a rule**, so the rule is
 * here, once, and each field says only which side of it it lands on.
 *
 * ⚑ **{@link distil} is the one read in this app that folds MANY conversations at once** — see
 * `SessionStore.DigestRow`, *"asks about every placed conversation and gets back rows from many of
 * them at once"* — so every correlation it makes has to answer for itself. ⛔ **What answers is
 * not the width of the read, and never the dispatch that wrote the field. It is where the id was
 * MINTED.**
 *
 * > ⛔ **A collection keys `(conversation, id)` unless EVERY id it can hold was minted by this
 * > process.**
 *
 * ⚠️ **One-sided on purpose.** Pairing an id that is already unique costs a prefix and changes no
 * answer; leaving the pair off a session-local one merges two conversations in silence, which is
 * `463` F2 measured rather than feared. ⛔ **So a MIXED population pairs**: the request sets hold
 * provider ids AND the `req_<uuid>` ones this app mints for `437`'s own questions, and one id it
 * did not mint is enough.
 *
 * **BARE** — {@link Tally.given}, {@link Tally.spokenFor} and {@link Tally.questionsAboutPiece}'s
 * keys (`newWorkId`, `work_<uuid>`) and
 * {@link Tally.byMessage} (`newQueuedMessageId`, `msg_<uuid>`), because each is minted at ONE call
 * site in this process and no caller may supply one; and {@link Tally.restartedIn}, which holds the
 * conversation a pair would have been made OF.
 *
 * **PAIRED**, because a provider mints what they hold — {@link Tally.ourCalls} (`tool_call.id`),
 * {@link Tally.childMax} and {@link Tally.childSeen} (`sub_agent.agentId`, `workflow_run.taskId`),
 * and {@link Tally.routed}, {@link Tally.travelled}, {@link Tally.ended} and
 * {@link Tally.questionsNamingWork} (a request id).
 *
 * ⚠️ **A future field needs neither dispatch's history — it needs to know who mints its id**, and
 * `what-a-request-is-about-and-whose-it-is.test.ts` derives both rosters from this source, so a
 * field added on the wrong side of the rule goes red rather than silent.
 */
function key(...parts: readonly string[]): string {
  return parts.join('\u0000')
}

/**
 * ⛔ **One more of a word, in the order the words were first seen** (466).
 *
 * ⚠️ **First-seen order rather than the vocabulary's**, and it is a determinism decision rather
 * than a taste one: the read hands the fold rows in `created_at, session_id, ordinal` order, so
 * first-seen is a function of the ledger and the same rows compose the same sentence — which is
 * HO-024 §5.4's *"regenerate it and get the same digest"*. ⛔ Ordering by the vocabulary instead
 * would need a value import of a list per counter and would say nothing more.
 */
function countWord(counts: Map<string, number>, word: string): void {
  counts.set(word, (counts.get(word) ?? 0) + 1)
}

/**
 * 🔴 **This app's own tool, unqualified — or `null` because the agent called something else** (466).
 *
 * ## ⛔ Both spellings, because a bare prefix is a provider test wearing a data test's clothes
 *
 * ⚠️ **`tool_call.name` is QUALIFIED and the two providers qualify differently** —
 * `brobot__list_agents` on one, `mcp__brobot__list_agents` on the other, both measured
 * (`tool-inventory.ts`). ⛔ `startsWith('brobot__')` matches the first and misses every row of the
 * second, *"which would look exactly like a conversation whose tools did not arrive"*. ⚑ So the
 * name is split with each provider's own {@link ToolNaming} and compared with
 * {@link AGENT_TOOL_SERVER} — the word the toolset is actually published under.
 *
 * ## ⚠️ The prefixed naming is tried FIRST, and the order is load-bearing
 *
 * ⛔ Codex's naming has an EMPTY prefix, so `splitQualified` reads `mcp__brobot__list_agents` as
 * server `mcp`, tool `brobot__list_agents` — a miss that looks like a pass. Trying the prefixed
 * naming first is what makes the second attempt safe.
 *
 * ## ⚑ Unqualified, because that is what a person is shown everywhere else
 *
 * ⛔ `ToolRefusedEvent.tool` is *"unqualified — `spawn_agent`, never `mcp__brobot__spawn_agent`"*,
 * and the digest already prints it that way on `tool-refused`. ⚠️ Printing the qualified name here
 * would put two spellings of one tool on one card, and one of them names a PROVIDER — which `317`
 * forbids in user-visible text and has a source scan for.
 */
function ourTool(name: string): string | null {
  for (const provider of SUPPORTED_PROVIDERS) {
    const split = providerDefinitions[provider].transcripts.splitToolName?.(name) ?? null
    if (split !== null && split.server === AGENT_TOOL_SERVER) return split.tool
  }
  return null
}

/**
 * ⛔ **The maximum per child, never a sum of progress frames** (`430`'s measured rule).
 *
 * ⚠️ Claude re-sends one child's cumulative total on every frame — 6,997 then 8,944 — so adding
 * them reports 15,941 for a child that spent 8,944. Codex reports the child's whole-thread
 * `total`, and its `last` can be an order of magnitude larger. ⚑ Max within a child; sum across
 * children; and a child that reported nothing is counted and never imputed as zero.
 */
function reportUsage(tally: Tally, key: string, tokens: number | undefined): void {
  tally.childSeen.add(key)
  if (tokens === undefined || !Number.isFinite(tokens) || tokens < 0) return
  const held = tally.childMax.get(key)
  if (held === undefined || tokens > held) tally.childMax.set(key, tokens)
}

function fold(rows: readonly DigestRow[], name: (id: string) => string): Tally {
  const tally: Tally = {
    groups: new Map(),
    claims: [],
    given: new Map(),
    questionsAboutPiece: new Map(),
    questionsNamingWork: new Set(),
    routed: new Set(),
    travelled: new Set(),
    ended: new Set(),
    restartedIn: new Set(),
    carriedIn: 0,
    childMax: new Map(),
    childSeen: new Set(),
    turns: { completed: 0, failed: 0, interrupted: 0, unreadable: 0 },
    refusals: 0,
    replies: 0,
    permanences: new Map(),
    because: new Map(),
    ourCalls: new Map(),
    byMessage: new Map(),
    spokenFor: new Set(),
    answerers: new Map(),
    answeredByNobodyRecorded: 0,
  }
  for (const row of rows) {
    const event = row.event
    switch (event.type) {
      case 'work_given': {
        const named = { piece: event.piece, label: event.label, title: event.title }
        tally.given.set(event.piece, named)
        // ⚑ **475 · the edge to the held message, when there was one.** ⛔ `messageId` is absent
        // when the brief went STRAIGHT OUT — `derivePieces` starts such a row at `working` rather
        // than `waiting` — and an absent name pairs with nothing, deliberately.
        if (event.messageId !== undefined) tally.byMessage.set(event.messageId, named)
        bump(
          tally,
          'work-handed-out',
          row.at,
          `${pieceLine(event.label, event.title)}, to ${name(row.sessionId)}`,
        )
        break
      }
      case 'work_replied': {
        tally.replies += 1
        const named = tally.given.get(event.piece)
        if (named === undefined) tally.carriedIn += 1
        // ⚑ **475** — see {@link Tally.spokenFor}. A reply is the ordinary ending, and work this
        // window watched end is not work whose fate it could not say.
        tally.spokenFor.add(event.piece)
        const said = name(row.sessionId)
        // The questions its owner asked about it end with it, as a close's do.
        for (const asked of tally.questionsAboutPiece.get(event.piece) ?? []) tally.ended.add(asked)
        const about =
          named === undefined
            ? 'work it was given before this window'
            : pieceLine(named.label, named.title)
        tally.claims.push(
          claimedLine(
            `claim:${row.sessionId}:${String(row.ordinal)}`,
            'worker-reported',
            row.at,
            `${said} reported ${about} ${event.outcome} — ${event.summary}`,
            said,
          ),
        )
        break
      }
      case 'work_taken_back': {
        // ⚑ **466 · named when this window saw the give** — a taking back of older work says so
        // rather than printing nothing at all.
        const named = tally.given.get(event.piece)
        tally.spokenFor.add(event.piece)
        // ⚑ **D-016 · and the questions its owner asked about it end with it**, as a close's do — the
        // questions fold ends them on this row, which is the whole of what says so: no row of their
        // own is written.
        for (const asked of tally.questionsAboutPiece.get(event.piece) ?? []) tally.ended.add(asked)
        // ⚑ A person took it back (no conversation in `by`): the line says so, off the row itself.
        if (event.by === null) {
          bump(
            tally,
            'work-taken-back-by-a-person',
            row.at,
            named === undefined ? null : pieceLine(named.label, named.title),
          )
          break
        }
        bump(
          tally,
          'work-taken-back',
          row.at,
          named === undefined ? null : pieceLine(named.label, named.title),
        )
        break
      }
      case 'work_closed': {
        // ⚑ **D-016 · a close, `work_taken_back`'s twin** — named when this window saw the give, and
        // the questions its owner asked about it end with it on this row.
        const named = tally.given.get(event.piece)
        tally.spokenFor.add(event.piece)
        for (const asked of tally.questionsAboutPiece.get(event.piece) ?? []) tally.ended.add(asked)
        bump(
          tally,
          'work-closed',
          row.at,
          named === undefined ? null : pieceLine(named.label, named.title),
        )
        break
      }
      case 'message_unqueued': {
        // 🔴 **475 · the only stall cause a windowed row-reader can attribute to a piece of work.**
        //
        // ## ⛔ Read for the EDGE, and it contributes nothing without one
        //
        // ⚠️ **`request_resolved`'s arm, one subject over**: a row that pairs with nothing this
        // window saw draws no line and is not counted anywhere. ⛔ Most `message_unqueued` rows
        // are not about work at all — every held message ends with one — and the pair with a
        // `work_given` this window read is the whole of what says this one was.
        //
        // ## ⚠️ `abandoned` only, and it is three endings wearing one word
        //
        // ⛔ **`sent` is the ordinary path and `cancelled` is somebody taking work back or closing
        // it** — the second is not drawn here: a taking back writes `message_unqueued: 'cancelled'`
        // AND `work_taken_back` for one piece, and a close `work_closed` and the cancel, so a line
        // built on the cancel would count it twice.
        //
        // 🔴 **The sentence says the app did not send it and nothing more.** Three causes reach
        // `abandoned` — the conversation ended underneath it, an attachment went away, and an
        // ending that landed mid-handover — and {@link UnqueuedMessageEvent.detail} is where the
        // difference is written. ⛔ **The detail is NOT drawn**: it can name what a person
        // attached, which is `405` §2's rule about a request's arguments, and one of the three
        // says the provider may have received the message — a clause that would contradict the
        // count it was hung on. ⚑ *Not sent* is true of all three, which is why it is the whole
        // of the line.
        if (event.reason !== 'abandoned' || event.messageId === undefined) break
        const held = tally.byMessage.get(event.messageId)
        if (held === undefined) break
        tally.spokenFor.add(held.piece)
        // ⚑ **The label is on the entry rather than looked up again**, so this arm has no
        // *"label unknown"* branch to write: the map is filled from `work_given` rows in THIS
        // window. ⛔ A branch no fixture can reach is a line no mutation can kill.
        bump(tally, 'work-not-sent', row.at, pieceLine(held.label, held.title))
        break
      }
      case 'request_routed': {
        // ⛔ **474 · the CONVERSATION and the id, never the id alone** — see
        // {@link Tally.questionsNamingWork}.
        tally.routed.add(key(row.sessionId, event.requestId))
        // 🔴 **611 · THREE populations, one row type, and the fold that tells them apart is
        // shared** — {@link whereItWent}. ⛔ It read `because === undefined` and called that
        // *travelled*; since `HO-088` §2 a routing can carry no refusal and still not have gone to
        // any parent, so that spelling put every question an agent addressed to a person into the
        // `travelled` set — where `question-without-work` then asked which work it named and
        // `question-travelled` told a person it had gone up.
        const went = whereItWent(event)
        // ⚑ **D-009 · a question to an agent the asker named travelled too** — to another
        // conversation, which owes the answer — so it is counted and joined exactly as the parent's.
        if (went.is === 'the-parent' || went.is === 'the-agent-the-asker-named') {
          tally.travelled.add(key(row.sessionId, event.requestId))
          bump(tally, 'question-travelled', row.at, null)
        } else if (went.is === 'the-person-the-asker-named') {
          // ⛔ **Deliberately NOT in `travelled`** — see {@link Tally.travelled}: that set is what
          // *which work is this about* may be asked of, and a question aimed past every parent is
          // not a question a parent failed to answer.
          bump(tally, 'question-addressed-to-a-person', row.at, null)
        } else {
          // ⚑ **466 · the reason is KEPT** — `463`: *"the digest collapses all five reasons into
          // one count"*, and a person cannot name what happened from *"5 requests came up"*.
          countWord(tally.because, went.because)
          bump(tally, 'decision-raised', row.at, null)
        }
        break
      }
      case 'question_asked': {
        // ⚑ **Read for its `piece`, and since `466` it also SAYS which work.** `437` minted the
        // only row in this app that says which work a question is about; it rides beside its own
        // `request_routed`, so this arm still draws no question — what it draws is the EDGE, which
        // nothing drew before and which `463` asked for by name.
        const asked = key(row.sessionId, event.requestId)
        tally.questionsNamingWork.add(asked)
        // ⚑ **611 · a PASSED-UP question names no piece here**, and a question to an agent may name
        // none. ⛔ It is still a question this app raised, so the row above still counts it; what
        // it cannot do is name work, and `question-about-work` is a line about work.
        // ⚑ **D-016 · the row carries the piece's LABEL**, so the line names it whenever the piece
        // was given — no absence for work given before this window.
        if (event.piece !== undefined) {
          tally.questionsAboutPiece.set(event.piece, [
            ...(tally.questionsAboutPiece.get(event.piece) ?? []),
            asked,
          ])
          bump(tally, 'question-about-work', row.at, event.label ?? null)
        }
        break
      }
      case 'request_escalated':
        bump(tally, 'question-escalated', row.at, null)
        break
      case 'request_stranded':
        bump(tally, 'question-lost', row.at, null)
        tally.ended.add(key(row.sessionId, event.requestId))
        break
      case 'request_resolved':
        // ⚠️ **`id`, not `requestId`** — the provider's own spelling, and `deriveRoutedRequests`
        // keys this branch the same way. ⛔ It draws no line: a request the provider withdrew is
        // not something that happened TO a person, and the fold reads it only so the
        // `open-is-not-waiting` gap cannot claim an ending it is looking straight at.
        tally.ended.add(key(row.sessionId, event.id))
        break
      case 'request_interrupted':
        tally.ended.add(key(row.sessionId, event.requestId))
        break
      case 'user_decision':
        // 🔴 **477 · the row says who answered, and a row written before it could does not**
        // (HO-029 §2.1/§2.2). ⛔ **Two counters and never one**: a named actor and an absence are
        // different claims, and the sentence below states each about its own population rather
        // than choosing whichever is bigger. ⚠️ **Nothing is inferred for the absent arm** — the
        // kind is still named for the request, and `465`'s sentence is still what the old rows
        // produce, because it is still the only true thing to say about them.
        if (event.by === undefined) tally.answeredByNobodyRecorded += 1
        else countWord(tally.answerers, event.by.who)
        bump(tally, 'request-answered', row.at, null)
        tally.ended.add(key(row.sessionId, event.requestId))
        break
      case 'work_interrupted':
        bump(tally, 'work-interrupted', row.at, null)
        break
      case 'work_restarted':
        // ⚠️ **Conversations, not rows.** `settleRestartedWork` writes one row per conversation
        // PER LAUNCH, so two restarts inside one window would otherwise name more conversations
        // than exist.
        tally.restartedIn.add(row.sessionId)
        // ⚑ **D-016 · the row names the pieces the restart stalled** — the line below says that
        // work is stalled, so this card speaks for each of them.
        for (const piece of event.pieces ?? []) tally.spokenFor.add(piece)
        bump(tally, 'work-restarted', row.at, null)
        break
      case 'tool_refused':
        tally.refusals += 1
        // ⚑ **466 · the permanence is on the row and was being thrown away.** `405` records it
        // *"beside `permanence` even though every door DERIVES it"* precisely so a reader does not
        // have to re-derive it, and the digest was the reader that did not read it.
        countWord(tally.permanences, event.permanence)
        bump(tally, 'tool-refused', row.at, `${event.tool}, by the rail ${event.rail}`)
        break
      case 'turn': {
        // ⛔ **A state this build does not know is COUNTED, never indexed.** `turn.state` is read
        // back through a cast — `toPersistedEvents` does `JSON.parse(...) as TranscriptEvent` and
        // nothing checks it — so an imported conversation, or this build reading a ledger a later
        // one wrote, can carry a fourth member. ⚠️ Writing it by index would set `NaN` on a key
        // nothing reads and drop the row out of a breakdown that still counts it, so the line
        // would say *"4 turns ended — 3 completed"* and not add up to itself.
        if (
          event.state === 'completed' ||
          event.state === 'failed' ||
          event.state === 'interrupted'
        ) {
          tally.turns[event.state] += 1
        } else {
          tally.turns.unreadable += 1
        }
        bump(tally, 'turn-ended', row.at, null)
        break
      }
      case 'sub_agent':
        reportUsage(tally, key(row.sessionId, event.agentId), event.usage?.tokens)
        break
      case 'workflow_run': {
        // ⛔ **The roster, never the run's own `usage`, and never both** (`430`). They are two
        // descriptions of one spend produced from one frame — the repo's own fixture carries
        // `usage.total_tokens: 7718` and a single roster agent with `tokens: 7718`. ⚑ Counting at
        // the AGENT level is the declared aggregation level, and the surface says so.
        for (const agent of event.agents ?? []) {
          reportUsage(tally, key(row.sessionId, event.taskId, agent.agentId), agent.tokens)
        }
        break
      }
      case 'tool_call': {
        // 🔴 **466 · only THIS APP's own tools, and the row is kept rather than drawn.** A call is
        // half a fact; what `463` needed named is what the tool ANSWERED, and the answer is on the
        // `tool_result` row, which carries no tool name. ⛔ So the call is remembered by
        // `(conversation, id)` — see {@link Tally.ourCalls} for why the conversation is in the key
        // — and the result names the tool from it.
        const ours = ourTool(event.name)
        if (ours !== null) tally.ourCalls.set(key(row.sessionId, event.id), ours)
        break
      }
      case 'tool_result': {
        // ⛔ **A result with no call of ours in this window draws NOTHING, and that is not a
        // defect.** `tool_result` carries `id`, `summary` and `ok` and no name at all, so a
        // receipt whose call fell before the window is a receipt this app cannot attribute — and
        // guessing it is ours would print the agent's own `Bash` output into a digest.
        const called = tally.ourCalls.get(key(row.sessionId, event.id))
        if (called === undefined) break
        // ⚠️ **`summary` is the SHORT FORM and the only durable one.** `457` measured 353
        // characters of prose against 3,691 of payload and `TOOL_SUMMARY_MAX` cuts at 200; `462`
        // owns the whole answer and holds it only while a conversation is running, which is never
        // true of a window a digest is reading back. ⛔ So this is not 462's surface, cannot become
        // it, and must not imply it is showing everything.
        bump(
          tally,
          'tool-answered',
          row.at,
          `${called} ${event.ok ? 'answered' : 'failed'}: ${event.summary}`,
        )
        break
      }
      default:
        // ⚠️ **Unreachable while the SQL and `DIGEST_EVENT_TYPES` agree**, and a census asserts
        // they do. A row of a type this switch does not branch on contributes NOTHING rather than
        // falling into a default line — an un-annotated fact must not acquire a register by
        // landing somewhere.
        break
    }
  }
  return tally
}

function sentence(kind: ObservedLineKind, group: Grouped, tally: Tally): string {
  const turns = tally.turns
  switch (kind) {
    case 'work-handed-out':
      return `${many(group.count, 'piece of work was', 'pieces of work were')} handed out — the most recent is ${group.detail ?? 'unnamed'}.`
    case 'work-taken-back':
      return `${many(group.count, 'piece of work was', 'pieces of work were')} taken back by whoever gave it — the most recent is ${group.detail ?? 'work handed out before this window'}.`
    case 'work-taken-back-by-a-person':
      return `${many(group.count, 'piece of work was', 'pieces of work were')} taken back by a person — the most recent is ${group.detail ?? 'work handed out before this window'}.`
    case 'work-closed':
      return `${many(group.count, 'piece of work was', 'pieces of work were')} closed by whoever gave it — the most recent is ${group.detail ?? 'work handed out before this window'}.`
    // 🔴 **475 · what the app DID, never what the agent got.** ⛔ *Not sent* is this app's own
    // word for all three endings `abandoned` covers — `QueuedMessage.vue` leads every one of them
    // with it — and it is the strongest thing that is true of the mid-handover case, where the
    // row itself says the message may have reached the agent and nothing can come back either
    // way. ⚠️ **No cause clause**, for that reason: the cause is on `detail` and `detail` is not
    // drawn here.
    case 'work-not-sent':
      return `${many(group.count, 'held message carrying work was not sent', 'held messages carrying work were not sent')} — the most recent carried ${group.detail ?? 'unnamed'}.`
    case 'question-travelled':
      return `${many(group.count, 'question', 'questions')} travelled to a parent.`
    // ⚑ **611 · it says WHO it was for and never who answered it** (HO-028 §2, `465`'s rule) — the
    // routing row records where the app sent it, and a digest line claiming a person had read it
    // would be an observation about somebody this window never watched.
    case 'question-addressed-to-a-person':
      return `${many(group.count, 'question was', 'questions were')} addressed to a person by the conversation that asked.`
    case 'decision-raised':
      return `${many(group.count, 'request', 'requests')} came up that only a person can settle: ${eachWord(
        tally.because,
        (word) =>
          // ⛔ **The vocabulary's own prose, and the SAME fallback the queue reader uses** —
          // `RuntimeHost.decisionsForAPerson`: a reason this build has not been taught says so
          // rather than printing a code at a person.
          CHANNEL_REFUSAL_SENTENCES[word as keyof typeof CHANNEL_REFUSAL_SENTENCES] ??
          'something only a person can settle, of a kind this app has not been taught',
      )}.`
    case 'question-escalated':
      return `${many(group.count, 'question', 'questions')} ran past a deadline and reached a person.`
    case 'question-lost':
      return `${many(group.count, 'question was', 'questions were')} still open when the app last went away.`
    case 'request-answered':
      // 🔴 **This said *"answered by a person"* until `465`, and `463` measured it false through
      // the production door**: the parent AGENT answered its spawned worker's question, through
      // `RuntimeHost.answerQuestion`, and the digest drew an `observed` chip in front of a person
      // who had never been asked. ⛔ **`465` narrowed it to the ending and the absence**, because
      // the row genuinely did not know who had answered.
      //
      // 🔴 **477 · the row knows now, and the old rows still do not — so BOTH clauses are drawn,
      // each about its own population** (HO-029 §2.2: *"new events produce a name, old ones
      // produce that sentence, nothing in between, nothing guessed"*). ⛔ **A window holding only
      // old rows composes `465`'s sentence byte for byte**, which is the point: the sentence is
      // not retired, it is scoped. ⚠️ **And still never *"a person"* for an actorless row** — the
      // absence clause counts `answeredByNobodyRecorded`, never `group.count`, so a mixed window
      // cannot lend a named row's actor to a silent one.
      return `${many(group.count, 'request was', 'requests were')} answered.${whoClause(
        tally.answerers,
        'Who answered',
      )}${nobodyClause(tally.answeredByNobodyRecorded, 'answered')}`
    case 'work-interrupted':
      // 🔴 **709 · R43 — the ASK, counted as an ask.** ⛔ *"Work was stopped"* read the row as proof
      // the stop worked, which was true only while `SessionMachine` renamed whatever the provider did
      // next `interrupted`. ⚑ A provider can complete a turn it was asked to stop, and the turn line
      // beside this one says so in the provider's word — so this line says what the row records.
      return `Work was ${ASKED_TO_STOP} ${many(group.count, 'time', 'times')}.`
    case 'work-restarted':
      // ⛔ **This row does NOT mean the work recovered.** `WorkRestartedEvent`'s own docblock is
      // *"the app being killed while work is in progress"*, `derivePieces` moves the piece to
      // `stalled`, and the transcript's own words are *"the app restarted while this conversation
      // still held work"*. ⚠️ The first version of this line said *"came back after a restart"* —
      // an `observed` chip in front of a sentence that inverted the fact, which is the exact
      // failure this whole surface is about.
      return `The app restarted while ${many(tally.restartedIn.size, 'conversation', 'conversations')} still held work nobody had finished; that work is stalled until somebody drives it.`
    case 'tool-refused':
      return `${many(group.count, 'tool call was', 'tool calls were')} refused — the most recent was ${group.detail ?? 'unnamed'}. How long each is expected to hold: ${eachWord(
        tally.permanences,
        // ⚑ **`shared/refusals.ts`'s table, which 466 moved there so this fold could read it** —
        // the renderer's transcript row has printed the same clause since `405`.
        (word) => (isRailPermanence(word) ? PERMANENCE_SAID[word] : word),
      )}.`
    case 'turn-ended': {
      const parts = [
        turns.completed === 0 ? null : `${String(turns.completed)} completed`,
        turns.failed === 0 ? null : `${String(turns.failed)} failed`,
        turns.interrupted === 0 ? null : `${String(turns.interrupted)} interrupted`,
        // ⚑ **Named rather than dropped**, so the breakdown always sums to the count above it.
        turns.unreadable === 0 ? null : `${String(turns.unreadable)} this app could not read`,
      ].filter((part): part is string => part !== null)
      return `${many(group.count, 'turn', 'turns')} ended — ${parts.join(', ')}.`
    }
    case 'question-about-work':
      return `${many(group.count, 'question says', 'questions say')} which piece of work it is about — the most recent is ${group.detail ?? 'work handed out before this window'}.`
    case 'tool-answered':
      return `${many(group.count, 'call to this app’s own tools', 'calls to this app’s own tools')} came back — the most recent was ${group.detail ?? 'unnamed'}.`
  }
  // ⛔ **No `worker-reported` arm, and its absence is now checked by the compiler** (465). It used
  // to be an unreachable case kept for exhaustiveness over the whole vocabulary; the parameter is
  // `ObservedLineKind` now, so the switch is exhaustive over exactly the kinds that reach it and a
  // claim's sentence has no way in here at all.
}

const GAP_WORDS: Readonly<Record<DigestGapKind, (count: number) => string>> = {
  'unverified-outcome': (count) =>
    `${many(count, 'outcome is', 'outcomes are')} what a worker reported. Nothing in this app checked one.`,
  'carried-in': (count) =>
    `${many(count, 'report is', 'reports are')} about work handed out before this window, so the digest can name the outcome but not the piece of work.`,
  'native-usage-incomplete': (count) =>
    `${many(count, 'native child', 'native children')} reported no usage INSIDE this window. ⚠️ That is not zero, and it is not *never* either: a report the same child made before the window is not in this number.`,
  'collision-target': (count) =>
    `${many(count, 'refusal names', 'refusals name')} the rail and not what it collided with — the target is not recorded anywhere.`,
  'question-without-work': (count) =>
    `${many(count, 'question does', 'questions do')} not say which piece of work it is about.`,
  // 🔴 **466 · `463` F3, and the sentence is its own** — *"Part of this digest source record could
  // not be read."* ⛔ The cause is genuinely not known, which is `LedgerWalk.rowsUnread`'s own
  // rule: *"a COUNT of the rows it is unable to speak for, with the cause still unstated"*.
  'source-unreadable': (count) =>
    `${many(count, 'row', 'rows')} of the record this digest reads could not be read, so part of what happened here is missing from every line above. ⚠️ Nothing records why, and a row this app dropped is a row nothing else here can stand in for.`,
  // ⚑ **D-017 · R8 — its own sentence**: a whole conversation's record is not one row.
  'source-skipped': (count) =>
    `${many(count, 'conversation’s record', 'conversations’ records')} could not be read, so part of what happened here is missing from every line above. ⚠️ Nothing records why.`,
  'open-is-not-waiting': (count) =>
    `${many(count, 'request was', 'requests were')} raised here and nothing this digest reads ended one. ⚠️ It does not read a conversation stopping, so *open* means no ending in its vocabulary — never that somebody is still waiting.`,
  // 🔴 **475 · `open-is-not-waiting` one subject over, and the same honesty.** ⛔ The sentence
  // names the REASON rather than implying a ledger limit: the rows that stop work being driven
  // name no piece of work, so the digest counts them and can never say whose work they stopped.
  // ⚑ Which piece each one stalled is `derivePieces`' answer and it is reached by folding a whole
  // conversation — not a window — so no reader shaped like this one can produce it.
  //
  // ⚑ **D-017 · `05` rules 2 and 3 — no conversation ends; one that cannot be reopened is replaced**
  // (`replaced_by`, which stalls what it held `could_not_be_reopened` and names no work either). ⛔ It
  // said *"a conversation's own ending"*. ⚑ **D-016 · a restart names its pieces now** and is spoken
  // for, so it left this sentence.
  'work-without-an-ending': (count) =>
    `${many(count, 'piece of work was', 'pieces of work were')} handed out here and nothing this digest reads says what became of one. ⚠️ A turn ending, a stop and a conversation replaced because it could not be reopened are what leave work undriven, and none of those rows names a piece of work — so this card can count them and never tell you whose work stopped.`,
}

function gap(kind: DigestGapKind, count: number): DigestGap | null {
  // ⛔ **A gap with no rows is not drawn**, which is what keeps HO-025 §5.3's *"it should now be
  // rare"* checkable: a hole that appeared in every window every time would be a design fault
  // rather than a ledger limit, and this is the line that would make that visible.
  if (count <= 0) return null
  return { kind, says: GAP_WORDS[kind](count), count }
}

/**
 * The distilled window. ⛔ Pure: same read in, same value out.
 *
 * 🔴 **466 · it takes the WALK rather than its rows**, because `463` F3 is a fact about the read
 * and not about anything in it: *"forbid the silent project sentence when an eligible row was
 * skipped"*. ⛔ A fold handed only `walk.rows` could not tell a window that recorded nothing from
 * one whose every row was unparseable — they are the same empty array — which is the whole of the
 * finding.
 */
export function distil(
  read: LedgerWalk<DigestRow>,
  name: (id: string) => string,
): { lines: readonly DigestLine[]; gaps: readonly DigestGap[]; fanOut: NativeFanOut } {
  const tally = fold(read.rows, name)

  const observed = OBSERVED_ORDER.flatMap((kind): ObservedLine[] => {
    const group = tally.groups.get(kind)
    if (group === undefined) return []
    return [
      observedLine(`observed:${kind}`, kind, group.count, group.at, sentence(kind, group, tally)),
    ]
  })
  // ⚑ **Observations first, then claims newest-first.** The order of the two blocks is HO-024
  // §5.1's provenance ordering — what the engine watched outranks what an agent said — and it is
  // the one ordering decision here that is cited rather than chosen.
  const claims = [...tally.claims].sort((left, right) => right.at - left.at)

  const reported = tally.childMax.size
  const fanOut: NativeFanOut = {
    children: tally.childSeen.size,
    reported,
    missing: tally.childSeen.size - reported,
    // ⛔ **`null`, never `0`, when nothing reported.** Zero is a claim about spend.
    tokens: reported === 0 ? null : [...tally.childMax.values()].reduce((sum, one) => sum + one, 0),
  }

  const unanswered = [...tally.routed].filter((id) => !tally.ended.has(id)).length
  // ⛔ **The TRAVELLED set, not every routing.** A permission never travelled and has no piece to
  // name, so asking *which work* of one would fire this gap on every permission for ever.
  const withoutWork = [...tally.travelled].filter((id) => !tally.questionsNamingWork.has(id)).length
  // ⛔ **475 · the pieces GIVEN in this window, and only those.** Work handed out before the
  // window is not counted here: the `carried-in` gap is the one that speaks for it, and counting
  // it twice would make a hole look bigger than the ledger it was read from.
  const workWithoutAnEnding = [...tally.given.keys()].filter(
    (piece) => !tally.spokenFor.has(piece),
  ).length

  const gaps = [
    gap('unverified-outcome', tally.replies),
    gap('carried-in', tally.carriedIn),
    gap('native-usage-incomplete', fanOut.missing),
    gap('collision-target', tally.refusals),
    gap('question-without-work', withoutWork),
    gap('open-is-not-waiting', unanswered),
    // 🔴 **475 · the work this window handed out and could say nothing else about.** ⛔ Subtracted
    // rather than counted separately, so the `work-not-sent` line VISIBLY takes one off this
    // number: a fact the card states is not also a fact the card says it cannot state.
    gap('work-without-an-ending', workWithoutAnEnding),
    // 🔴 **466 · the read's own hole, drawn where every other unknown is drawn.** ⚑ It fits
    // `DIGEST_GAP_KINDS`' stated rule — *"every member is conditional on rows the window actually
    // contains, and a window with none shows none"* — because `gap()` refuses a zero.
    gap('source-unreadable', read.rowsUnread),
    gap('source-skipped', read.ledgersSkipped ?? 0),
  ].filter((one): one is DigestGap => one !== null)

  return { lines: [...observed, ...claims], gaps, fanOut }
}

/**
 * 🔴 **D-017 · R8 — {@link distil}, skipping a conversation whose rows the fold cannot take**
 * rather than losing the whole digest. ⚑ Only after the whole fold threw, each conversation's rows
 * are folded alone; one that throws is warned, dropped, and counted on the read handed back.
 */
export function distilSkipping(
  read: LedgerWalk<DigestRow>,
  name: (id: string) => string,
): { readonly read: LedgerWalk<DigestRow>; readonly distilled: ReturnType<typeof distil> } {
  try {
    return { read, distilled: distil(read, name) }
  } catch {
    const skipped = new Set<string>()
    for (const sessionId of new Set(read.rows.map((row) => row.sessionId))) {
      const own = { ...read, rows: read.rows.filter((row) => row.sessionId === sessionId) }
      try {
        distil(own, name)
      } catch (error) {
        skipTheLedger(sessionId, error, undefined)
        skipped.add(sessionId)
      }
    }
    const kept: LedgerWalk<DigestRow> = {
      ...read,
      rows: read.rows.filter((row) => !skipped.has(row.sessionId)),
      ...ledgersSkippedOf((read.ledgersSkipped ?? 0) + skipped.size),
    }
    try {
      return { read: kept, distilled: distil(kept, name) }
    } catch (error) {
      // ⚠️ **A fault only two conversations' rows reproduce together** — no one of them throws
      // alone, so nothing here can say which. Every conversation in the read is skipped and
      // counted, and the digest says it could not read them rather than failing.
      const every = new Set(read.rows.map((row) => row.sessionId))
      for (const sessionId of every) {
        if (!skipped.has(sessionId)) skipTheLedger(sessionId, error, undefined)
      }
      const none: LedgerWalk<DigestRow> = {
        ...read,
        rows: [],
        ...ledgersSkippedOf((read.ledgersSkipped ?? 0) + every.size),
      }
      return { read: none, distilled: distil(none, name) }
    }
  }
}
