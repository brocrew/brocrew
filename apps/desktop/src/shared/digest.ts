import type { LedgerWalk } from './questions'

/**
 * 🔴 **What a digest may say, and what it must say about how it knows** (438, HO-024 §5.1–5.3,
 * HO-025 §2 criterion 16/18/19).
 *
 * ## ⛔ Every line carries its REGISTER, and there is no way to make one without it
 *
 * Report an agent-declared outcome as its claim rather than an observation. The person may read the digest instead of the source, so confident wording must not upgrade the evidence.
 *
 * ⛔ **So `register` is a required field on {@link DigestLine} and nothing defaults it.** The only
 * two ways to build a line are {@link observedLine} and {@link claimedLine} — see below for why
 * `unknown` has none — and there is no generic constructor, so *"a line with no register"* is not
 * a state this app can reach. ⚠️ **`465` closed the two doors `463` measured beside that one**:
 * {@link DigestLine} is a discriminated union, so a `claimed` line with no speaker no longer
 * compiles, and {@link LINE_REGISTERS} declares which register each kind may be built in, so an
 * agent's own sentence can no longer be constructed as an observation.
 *
 * ⚠️ **And the un-enumerated state is fail-CLOSED, deliberately**: a register a reader does not
 * recognise is WITHHELD and counted, never drawn — see `REGISTER_WORDS` in the renderer's
 * `digest.ts`. Making `observed` the fallback would have made the most trustworthy-looking label
 * the one an unlabelled fact falls into, which is exactly the shape of
 * `an-unenumerated-state-counts-as-success`.
 *
 * ## ⚑ The nearest precedent in this codebase, cited rather than invented
 *
 * `SessionStore.lastTurnStop` already separates *nothing has said* from *it did not happen* —
 * `222` §3's rule, **"say what was not seen, never what did not happen"**. {@link DigestGap} is
 * that rule with a count on it, and `unknown` is that rule as a register.
 *
 * ## ⛔ Derived, never stored (HO-024 §5.4)
 *
 * Nothing here is persisted. A {@link WindowDigest} is a pure function of (the ledger rows in the
 * window, the window) — regenerate it and get the same value. ⚠️ **The read's own COST is not part
 * of it**, and that separation is load-bearing: {@link DigestReading.cost} carries a clock, so a
 * *"regenerate and compare"* test would be comparing a stopwatch if the two were one object.
 */

/**
 * ⛔ **The closed vocabulary, and the order is HO-024 §5.1–5.3's own order.**
 *
 * ⚑ It is also the order a surface draws them in, which is `HO-001`'s provenance ordering finally
 * reaching a person: what the engine watched outranks what an agent said, and what nobody can
 * answer comes last and is never silent.
 */
export const DIGEST_REGISTERS = ['observed', 'claimed', 'unknown'] as const

/**
 * ⚠️ **`unknown` has no line constructor, and that is deliberate rather than missing.** What the
 * ledger cannot answer is carried by {@link DigestGap}, which has a COUNT of the rows it is
 * unable to speak for — a line has no such field, and a gap drawn as a line would lose the one
 * number that says how big the hole is. ⛔ The register is still a member because the surface
 * draws the `unknown` chip on every gap, and because a line arriving from a build that DOES
 * construct one must be labellable rather than withheld.
 */

export type DigestRegister = (typeof DIGEST_REGISTERS)[number]

/**
 * ⛔ **The event types the digest read selects, and the fold branches on.**
 *
 * 🔴 **This list, the SQL and the fold's arms must move together**, which is the rule
 * `selectPieceEvents` already states about its own list (`session-store.ts`): *a type the fold
 * branches on and the statement omits reads as "that event never happened", silently.* ⚠️ The SQL
 * spells the same names inline — it takes no interpolation — and a census asserts all three
 * agree, **in both directions**: a vocabulary member with no arm
 * is selected, widens the scan, and falls into `default` contributing nothing, which is the same
 * silent loss seen from the other side.
 *
 * 🔴 **`request_resolved` and `request_interrupted` are here because a review found the gap they
 * close.** `deriveRoutedRequests` ends a routed request on inputs this list had two of, so a
 * person pressing Stop — which writes `work_interrupted` and then one `request_interrupted` per
 * open request, at adjacent ordinals — produced a digest that drew *"work was stopped"* beside
 * *"nothing in this window ended one"*, with the endings sitting in the same window.
 * ⚠️ **A conversation's own `status: ended` is still not read**, and {@link DigestGapKind}
 * `open-is-not-waiting` says so in its own words rather than implying it.
 *
 * 🔴 **591 · a take-back or a close ends questions too, and each is here for exactly that review's
 * reason, one act over.** ⛔ Since D-016 one `work_taken_back` row both takes the piece back and
 * ends its owner's open questions about it, and one `work_closed` row both closes the piece and ends
 * them, so the fold counts both off that row: omitting it would draw *"nothing in this window ended
 * a question"* about endings sitting in the same window. ⚠️ **The sentence above
 * used to count the fold's inputs and `591` made it wrong**; it is stated without a count, which is
 * `396`'s rule and the mistake that sentence was itself warning about.
 *
 * ⚠️ **A minority of the ledger's types, and what a digest does NOT read is as much a decision as
 * what it does**: no `assistant_message`, no `thinking`, no `context_reading`, no `status`.
 * ⛔ **The count used to be written here and `458` retired the habit** — the census counts both
 * lists and this sentence cannot.
 *
 * ⚑ **The first two are the transcript this exists to replace**; `context_reading` is context
 * OCCUPANCY and `430` refused it by name; `status` fires on every lifecycle change of every
 * conversation and would widen the scan this read's whole cost claim rests on.
 *
 * 🔴 **475 · `message_unqueued` was in that list beside `status` and it does not belong there, and
 * the difference is what a row NAMES rather than what it costs.** ⛔ A held message's ending
 * carries an edge to the work: it names the message, and `work_given` names the same message, so
 * the pair says WHICH piece of work stopped being driven. ⚑ Since D-016 `work_restarted` carries
 * one too — it names the pieces the restart stalled, each waiting or working when the row was
 * written. ⚠️ `turn` and `status` name no piece at all — which piece they stopped is
 * `derivePieces`' answer and it is reached by folding a whole conversation, not a window — so
 * selecting `status` would buy this read no attribution and cost it the scan. ⚑ **The two are not one decision**: `session-machine.ts` publishes a `status` on
 * every transition and `turn` is already here, so `status` is a multiple of a population this read
 * already carries; a `message_unqueued` exists once per HELD message, and a message is held only
 * while a turn is running.
 *
 * 🔴 **466 admitted `tool_call` and `tool_result`, which that list named, and the discriminator is
 * WHOSE tool.** `463` read a night in which the only activity was a `brobot__list_agents`
 * call and its answer, and the digest said *"nothing this digest reads was recorded here"*. ⛔ A
 * call to one of THIS APP's own tools is an act in the workspace — the same class as a routing or
 * a refusal, and `tool_refused` has been in this list since `405` — while a call to `Bash` or
 * `apply_patch` IS the work, which is `405` §2's rule and the reason the exclusion was right for
 * everything else. ⚠️ **The narrowing is in the FOLD and not in the SQL**, because `tool_result`
 * carries no tool name: only its `id` ties it to the call, so the statement selects both types and
 * the fold keeps the pair whose call this app published.
 */
export const DIGEST_EVENT_TYPES = [
  'work_given',
  'work_replied',
  'work_taken_back',
  'work_closed',
  'request_routed',
  'request_escalated',
  'request_stranded',
  'request_resolved',
  'request_interrupted',
  'question_asked',
  'user_decision',
  'work_interrupted',
  'work_restarted',
  'tool_refused',
  'turn',
  'sub_agent',
  'workflow_run',
  'tool_call',
  'tool_result',
  'message_unqueued',
] as const

export type DigestEventType = (typeof DIGEST_EVENT_TYPES)[number]

/**
 * ⚑ **What a line is ABOUT** — a closed vocabulary, so a surface can order and key rows without
 * reading their prose, and so a test can assert a kind is drawn without pinning a sentence.
 *
 * ⛔ **`worker-reported` is the only `claimed` member** and the only one drawn per event rather
 * than grouped; see {@link ClaimedLine.count}. ⚠️ **Which register a member may be built in is
 * DECLARED in {@link LINE_REGISTERS}** rather than read off this list's order or its prose.
 *
 * 🔴 **`person-answered` became `request-answered` at `465`, and the rename is half the finding.**
 * ⛔ {@link UserDecisionEvent} carries a request id and an outcome and nothing else: `463` drove
 * the production answer door with a parent AGENT's caller, for a spawned worker's question, and
 * the digest drew *"1 request was answered by a person."* ⚠️ **A kind is a key a surface orders,
 * groups and tests on**, so a kind that names an actor no row carries is the same false claim the
 * sentence was, one layer below where anybody would look for it.
 */
export const DIGEST_LINE_KINDS = [
  'work-handed-out',
  'work-taken-back',
  // ⚑ A person took back the piece a service was on: `work_taken_back` with no conversation in `by`.
  'work-taken-back-by-a-person',
  'work-closed',
  // ⚑ A person closed stopped work: `work_closed` with no conversation in `by`.
  'work-closed-by-a-person',
  /**
   * 🔴 **475 · the one stall cause a windowed reader can attribute** — see
   * {@link DIGEST_EVENT_TYPES}. ⛔ It is about the MESSAGE and not about the piece's state: the
   * app did not send it, which is true of all three shapes `abandoned` reaches, and whether the
   * provider received one of them is the one thing `UnqueuedMessageEvent.detail` says this app
   * does not know.
   */
  'work-not-sent',
  'question-travelled',
  /**
   * 🔴 **611 · an agent addressed its question to a PERSON** (HO-088 §2) — a third routing
   * outcome, and it is neither of the two beside it.
   *
   * ⛔ **Not `question-travelled`**, which says it went to a parent and is the population
   * `question-without-work` is computed over. ⚠️ **Not `decision-raised`** either: nothing refused
   * it and there is no `ChannelRefusal` to name, so the sentence that enumerates those reasons has
   * nothing to say about it. ⚑ Without a member of its own it would have been counted as one of
   * the two and been wrong in the digest a person reads at the end of a night.
   */
  'question-addressed-to-a-person',
  'decision-raised',
  'question-escalated',
  'question-lost',
  'request-answered',
  'work-interrupted',
  'work-restarted',
  'tool-refused',
  'turn-ended',
  'question-about-work',
  'tool-answered',
  'worker-reported',
] as const

export type DigestLineKind = (typeof DIGEST_LINE_KINDS)[number]

/**
 * 🔴 **Which registers each kind may be built in — DECLARED, and still never DERIVED** (465, from
 * `463`'s criterion-18 failure).
 *
 * ## ⛔ The requirement this table is the type of
 *
 * ⚑ **{@link claimedLine} takes its speaker as a required argument because a claim with no author
 * is a rumour.** The equivalent requirement for an observation is not a speaker — it is that what
 * the line says was WRITTEN BY THE ENGINE. So: **a line's register is declared with its kind and
 * never chosen at the call site, an observation carries no author because no row it stands for
 * names one, and a claim carries one because its row does.**
 *
 * ⚠️ **`463` measured why the helper alone was not enough.** `claimedLine` already refused a
 * speakerless claim, and two doors beside it stayed open: `observedLine` accepted ANY kind — so an
 * agent's own sentence could be built as `worker-reported` with `register: 'observed'` and drawn —
 * and {@link DigestLine} was a single interface, so an object literal spelling
 * `register: 'claimed'` with `saidBy: null` compiled. ⛔ Both are now compile errors: this table
 * narrows the constructors, and the union below narrows the field.
 *
 * ## ⚠️ This is NOT the derivation `438` refused, and the difference is the reason it is a SET
 *
 * ⛔ `438` wrote *"`register` is required and is never inferred from `kind`"*, because *"the day a
 * kind grows a second provenance — an observed refusal beside a worker's claim about the same tool
 * — the derivation is silently wrong for one of them."* ⚑ **That objection is about a function
 * from kind to register, and this is not one.** Every member here is a LIST: the day
 * `tool-refused` really does acquire a claimed half it declares `['observed', 'claimed']`, both
 * constructors accept it, and each call site still writes its own register. Nothing is inferred,
 * and nothing can be silently wrong for one of them — what changes is only that a call site can no
 * longer pick a register the kind was never given.
 *
 * ⚠️ **`unknown` is a legal member of the value type and no kind declares it**, which is the same
 * statement {@link DIGEST_REGISTERS}'s own docblock makes: an unknown is carried by a
 * {@link DigestGap}, which has the count a line has no field for.
 */
export const LINE_REGISTERS = {
  'work-handed-out': ['observed'],
  'work-taken-back': ['observed'],
  // ⚑ The engine watched the row, whose `by` says no conversation took it back: a person did.
  'work-taken-back-by-a-person': ['observed'],
  'work-closed': ['observed'],
  // ⚑ The engine watched the row, whose `by` says no conversation closed it: a person did.
  'work-closed-by-a-person': ['observed'],
  // ⚑ **475** — the engine watched a held message end without being sent, and the message names
  // the work. ⛔ Nothing an agent said is on this line.
  'work-not-sent': ['observed'],
  'question-travelled': ['observed'],
  // ⚑ **611** — the engine watched a routing that the asker aimed at a person. ⛔ An observation:
  // the row says where it went, and nothing an agent claimed is on this line.
  'question-addressed-to-a-person': ['observed'],
  'decision-raised': ['observed'],
  'question-escalated': ['observed'],
  'question-lost': ['observed'],
  'request-answered': ['observed'],
  'work-interrupted': ['observed'],
  'work-restarted': ['observed'],
  'tool-refused': ['observed'],
  'turn-ended': ['observed'],
  // ⚑ **466's**, and each of them is an observation: the engine watched a question name its work,
  // and a receipt arrive for a call this app published. ⛔ Neither is an agent's sentence.
  'question-about-work': ['observed'],
  'tool-answered': ['observed'],
  'worker-reported': ['claimed'],
} as const satisfies Readonly<Record<DigestLineKind, readonly DigestRegister[]>>

/**
 * ⛔ **The kinds {@link observedLine} will build**, derived from the declaration rather than typed
 * a second time. A kind added to {@link DIGEST_LINE_KINDS} and not to {@link LINE_REGISTERS} is a
 * compile error there, so this can never fall behind the vocabulary.
 */
export type ObservedLineKind = {
  [K in DigestLineKind]: 'observed' extends (typeof LINE_REGISTERS)[K][number] ? K : never
}[DigestLineKind]

/** ⛔ The kinds {@link claimedLine} will build. Today exactly one, and the table says so. */
export type ClaimedLineKind = {
  [K in DigestLineKind]: 'claimed' extends (typeof LINE_REGISTERS)[K][number] ? K : never
}[DigestLineKind]

/** What every line carries whatever its register — the fields that say nothing about provenance. */
interface LineFacts {
  /** Stable within one reading, so a list can key on it without a positional index. */
  readonly id: string
  /**
   * ⛔ **How many ledger rows this line stands for.**
   *
   * ⚑ **`observed` lines are GROUPED and `claimed` lines are not, and the reason is not style.**
   * Instances of an observation are interchangeable — *four turns ended* says everything four
   * separate rows would. ⚠️ **A claim is authored text and two claims are not interchangeable**:
   * collapsing them into *"2 workers reported"* would hide what an agent actually said, which is
   * the one thing a person is reading this instead of the transcript for.
   */
  readonly count: number
  /** The sentence, already composed — a renderer draws it and decides nothing about provenance. */
  readonly text: string
  /** The newest row this line stands for, epoch ms. */
  readonly at: number
}

/**
 * ⚑ **The engine watched these rows and wrote them down.**
 *
 * ⛔ **`saidBy` is the literal `null` and there is no other actor field**, which is the whole of
 * `465`'s requirement in the type: an observation may say only what a durable row carries, and the
 * rows this app writes for an answered request carry no answerer at all.
 */
export interface ObservedLine extends LineFacts {
  readonly register: 'observed'
  readonly kind: ObservedLineKind
  /**
   * ⛔ **`null`, always** — an observation has no author, because the engine is not a speaker.
   * ⚠️ Spelled as the literal rather than `string | null`, so *"an observation that names who did
   * it"* is not a value this module can produce.
   */
  readonly saidBy: null
}

/**
 * ⚑ **An agent said this and nothing in this app checked it.**
 *
 * ⛔ **`saidBy` is a required `string`** — a claim with no attributable speaker is a rumour, and
 * `438` made {@link claimedLine}'s signature refuse to build one. ⚠️ **`465` closed the door
 * beside it**: the interface used to be one shape with `saidBy: string | null`, so an object
 * literal could spell `register: 'claimed'` and `saidBy: null` and be drawn.
 */
export interface ClaimedLine extends LineFacts {
  readonly register: 'claimed'
  readonly kind: ClaimedLineKind
  /**
   * ⛔ **One, by type.** A claim is never grouped — see {@link LineFacts.count} — and a literal
   * `1` is what stops *"2 workers reported"* being a line this app can hold, rather than a rule
   * {@link claimedLine} happens to keep.
   */
  readonly count: 1
  readonly saidBy: string
}

/**
 * One line of a digest, with the register that says how it is known.
 *
 * ⛔ **A discriminated union, and `register` is still required and still never inferred from
 * `kind`** — see {@link LINE_REGISTERS} for why a DECLARED set of legal registers per kind is not
 * the derivation `438` refused. ⚠️ **`unknown` has no arm here**, for {@link DIGEST_REGISTERS}'s
 * own stated reason: what the ledger cannot answer is a {@link DigestGap}, which carries the count
 * a line has no field for. ⛔ **The renderer still refuses to draw a register it does not
 * recognise** — the preload casts the wire, so a main process one build ahead can hand it one this
 * union says is impossible, and `canBeDrawn` is where that is caught.
 */
export type DigestLine = ObservedLine | ClaimedLine

/**
 * ⛔ **The renderable unknowns `430` named, plus one `437` created and one `466` could no longer
 * leave silent.** ⚠️ The count is not written here: `458`'s rule, and `a-number-can-survive-the-
 * death-of-its-derivation` is exactly what happened to the two sentences that did carry one.
 *
 * ⚑ HO-024 §5.3: *"A digest that omits an unanswerable thing is worse than one that names it,
 * because omission is indistinguishable from nothing-happened."*
 *
 * ⚠️ **`away-cutoff` is NOT in this list, and that is HO-025 §5.3's test applied honestly.** A gap
 * that appears every time is a property of the WINDOW rather than of the ledger, so it is stated
 * once on {@link DigestReading.limit}. Every member below is conditional on rows the window
 * actually contains, and a window with none shows none.
 */
export const DIGEST_GAP_KINDS = [
  'unverified-outcome',
  'carried-in',
  'native-usage-incomplete',
  'collision-target',
  'question-without-work',
  'open-is-not-waiting',
  /**
   * 🔴 **475 · what became of the work, when nothing in the window says** — `open-is-not-waiting`
   * one subject over, and for the same reason: most of the {@link TaskStallCause}s are written by
   * rows that name no piece, so this read can count an ending and never attribute one.
   *
   * ⛔ **Conditional on rows, as every member here must be**: it counts gives this window
   * SAW whose fate this window can say nothing about, so work answered inside the window shows none
   * of it, and a window in which nothing was handed out shows none either.
   */
  'work-without-an-ending',
  'source-unreadable',
  /** ⚑ **D-017 · R8** — a conversation whose rows the digest could not fold, skipped whole. */
  'source-skipped',
] as const

export type DigestGapKind = (typeof DIGEST_GAP_KINDS)[number]

export interface DigestGap {
  readonly kind: DigestGapKind
  /** What cannot be answered, in words a person reads. */
  readonly says: string
  /** How many rows in this window are affected. Never zero: a gap with no rows is not drawn. */
  readonly count: number
}

/**
 * 🔴 **Native fan-out reported as COVERAGE, never as a total** (438 §4, from `430`).
 *
 * ⛔ **Three rules, each measured by `430` rather than argued.** (1) The label is *tokens reported
 * for observed native fan-out* — never a spend and never a currency figure. (2) A child with no
 * numeric usage is counted in {@link missing} and never imputed as zero. (3) A child's reports are
 * CUMULATIVE, so the reading is the MAXIMUM per child and never a sum of progress frames — Claude
 * re-sends 6,997 then 8,944 for one child, and summing them would report 15,941 for a child that
 * spent 8,944.
 *
 * ⚠️ **And a workflow's own `usage` is never added to its `agents[]` roster.** They are two
 * descriptions of one spend, produced from one frame: the repo's own fixture carries
 * `usage.total_tokens: 7718` and a single roster agent with `tokens: 7718`. This counts at the
 * AGENT level and says so.
 */
export interface NativeFanOut {
  /** Distinct native children observed in this window, by `(conversation, child id)`. */
  readonly children: number
  /** How many of them reported a number at least once. */
  readonly reported: number
  /** How many reported none. ⛔ Not zero tokens — no reading at all. */
  readonly missing: number
  /**
   * The sum over `reported` children of each child's largest reported reading, or `null` when no
   * child reported anything. ⛔ **`null` is not `0`**: zero would be a claim about spend.
   */
  readonly tokens: number | null
}

/**
 * 🔴 **What the read WALKED, carried without its rows** (466, `463` F3).
 *
 * ## ⛔ `453`'s vocabulary, imported, and not a second spelling of it
 *
 * ⚠️ **`463` F3 asked for three facts by name** — *"candidate set / ledgers opened / rows
 * unreadable for the digest reader"* — **and they are the three `453` already built** for a
 * person's queue. ⛔ `466`'s brief: *"Reuse that vocabulary. Do not fork a second one."* ⚑ So this
 * is {@link LedgerWalk} with its payload removed, which is the same move `told.ts` made with
 * {@link DigestRegister} — *"one register vocabulary, shared with the digest, never forked"* — and
 * the rules on each field are that interface's, not restated here.
 *
 * 🔴 **Its rows are dropped because they never cross the wire.** `digestWindow` hands
 * `LedgerWalk<DigestRow>` to `RuntimeHost.digest`, which folds the rows into lines and gaps; what
 * a person needs from the walk is what it covered, not what it carried.
 */
export type DigestRead = Omit<LedgerWalk<never>, 'rows'>

/**
 * 🔴 **The digest for one window, over every conversation one of this app's agents holds** (438; one
 * list since D-016). ⛔ A pure function of the rows and the window.
 */
export interface WindowDigest {
  /**
   * How many conversations the read covered.
   *
   * ⚠️ **Held by an agent of this app, which is not every conversation in the database.** A
   * conversation swept out of the user's own provider home is held by no agent of ours; it is
   * outside the digest, and {@link DigestReading.limit} is not where that is said —
   * {@link DigestReading.heldByNoAgent} is.
   */
  readonly sessions: number
  /**
   * 🔴 **What the read walked to produce this** (466) — see {@link DigestRead}.
   *
   * ⛔ **{@link DigestRead.ledgers} and {@link sessions} are two numbers and neither replaces the
   * other.** `ledgers` is how many conversations there are, taken from the candidate query before
   * a row was folded; `sessions` is how many of them the window actually saw. ⚠️ `ledgers: 47,
   * sessions: 0` is a quiet night; `ledgers: 0` is no conversations at all, and before this field
   * both were the same silent sentence.
   */
  readonly read: DigestRead
  readonly lines: readonly DigestLine[]
  readonly gaps: readonly DigestGap[]
  readonly fanOut: NativeFanOut
}

/**
 * One whole reading: the window, the standing limit of any window, and the digest.
 *
 * ⛔ **{@link digest} is the deterministic part and {@link cost} is not.** Regenerate from the
 * same ledger and `digest` is byte-identical; `cost` is a stopwatch on this machine at this
 * moment. HO-024 §5.4 asks for the first and criterion 19 asks about the second, and putting them
 * in one object would have made *"the same digest"* untestable.
 */
export interface DigestReading {
  /** `[from, to)`, epoch ms — the window a person CHOSE, echoed back so the surface can name it. */
  readonly window: { readonly from: number; readonly to: number }
  /**
   * ⛔ **The one limit that is true of every window and is therefore not a gap.**
   *
   * ⚠️ `430` searched `last_seen`, `last_read`, `read_cursor`, `seen_at`, `viewed_at` and a digest
   * cursor across schema, IPC and renderer and found **no durable per-person last-view marker**;
   * `events.created_at` timestamps events and not readership. 🔴 **So no digest in this app can
   * cover *while you were away*** — it covers a window somebody chose, and says so.
   */
  readonly limit: { readonly says: string }
  readonly digest: WindowDigest
  /**
   * ⚠️ **Conversations no agent of this app holds**, counted so their absence is visible. ⛔
   * Omitting them would make *"nothing happened"* and *"nothing this digest can see"* the same
   * picture, which is the exact failure HO-024 §5.3 names.
   */
  readonly heldByNoAgent: number
  readonly cost: {
    /** Wall-clock for the whole read, this machine, this moment. */
    readonly totalMs: number
  }
}

/**
 * ⚑ **The engine watched it happen.** A turn ended, a piece was handed out, a refusal was recorded,
 * a restart occurred — HO-024 §5.1's own list.
 */
export function observedLine(
  id: string,
  kind: ObservedLineKind,
  count: number,
  at: number,
  text: string,
): ObservedLine {
  return { id, register: 'observed', kind, count, at, text, saidBy: null }
}

/**
 * ⚑ **An agent said it.** ⛔ `saidBy` is required here and nowhere else: a claim with no speaker is
 * a rumour, and this signature is what stops one being built.
 */
export function claimedLine(
  id: string,
  kind: ClaimedLineKind,
  at: number,
  text: string,
  saidBy: string,
): ClaimedLine {
  return { id, register: 'claimed', kind, count: 1, at, text, saidBy }
}

/**
 * ⛔ **The sentence the surface says instead of *while you were away*.**
 *
 * ⚠️ Kept here rather than in the renderer because it is a statement about the LEDGER, and `430`
 * measured the absence it describes. A surface may choose not to draw it; it may not reword it.
 */
/**
 * ⛔ **The widest window the host will read**, because the statement carries no `LIMIT` and
 * `events.created_at` has no index: a span is a scan bound, and an unbounded one is an invitation
 * to walk every row of every conversation into main-process memory.
 *
 * ⚠️ **Thirty-one days against a widest OFFERED window of seven**, so it bounds the wire without
 * bounding the surface. The zod schema cannot express it — a `.refine` cannot be a member of a
 * discriminated union — so the rail is the host's, and it is named here beside the sentence the
 * window is otherwise about.
 */
export const MAX_DIGEST_SPAN_MS = 31 * 24 * 3_600_000

export const WINDOW_WAS_CHOSEN =
  'This window was chosen here. Nothing in this app records when you last looked, so no digest ' +
  'can cover the time you were away — only a window you pick.'
