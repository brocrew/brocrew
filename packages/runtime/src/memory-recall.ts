import { clip } from './provider-commands'

/**
 * 🔴 **What the agent READ out of its memory, in the agent's own citation** (319, friction log F5).
 *
 * Read memory recall from `agentMessage.memoryCitation`, not a nonexistent memory-tool item. The field identifies the cited file, line range and usage note.
 *
 * ⚑ **What this module is: the neutral shape and the one bounding rule.** Reading the provider's
 * wire field is `codex/normalize.ts`'s job, exactly as `readCodexSkill` sits there and
 * `boundCommands` sits in `provider-commands.ts` — a vocabulary this side, a dialect that side.
 *
 * ## ⛔ Three things a row built from this must never do
 *
 *  1. **Never open the file.** Every string here is written by the MODEL, in prose, at the end of a
 *     reply. The provider's own instruction is *"use file paths relative to the memory base path"*
 *     and *"do not cite workspace files as memory citations"* — an instruction, which is a thing a
 *     model can get wrong. So {@link MemoryRecallEntry.path} is displayed and is never resolved,
 *     never joined to a home, never handed to `readFile`. It is a claim about where something was
 *     read, not a handle for reading it.
 *  2. **Never claim a tool ran.** No tool call is published for this and none exists (316 stands on
 *     that half). What the provider published is the model's own statement about what it used,
 *     parsed by the app-server. The wording on screen has to survive that: *the agent said it used
 *     this*, not *we watched it read this*.
 *  3. **Never let one provider's shape become the other's silence.** Claude has no equivalent at
 *     this pin — 318 measured that its CLI preloads the memory index into its own prompt with no
 *     tool and no citation — so a Claude session emits none of these, and no surface may read the
 *     absence of a row as *"Claude consulted nothing"*.
 *
 * ## ⚠️ And one about `null`, which is a real answer here
 *
 * 318's control arm is what makes this field evidence rather than decoration: a reply with no
 * citation block carries `memoryCitation` **present and `null`**, not absent. So the provider
 * distinguishes *"no memory was consulted"* from *"this build does not report"* — and this app
 * collapses the two into *no event*, deliberately. ⛔ The collapse is at the ROW, never in the
 * reading: a row saying *"no memory was consulted"* under every answer is noise, and one saying
 * *"unknown"* would be the fabricated third state 319 §1.3 forbids by name.
 */

/**
 * One file the agent said it read, as the model itself cited it.
 *
 * ⚠️ **The range is OPTIONAL although the provider declares it required.** `MemoryCitationEntry` in
 * the vendored v2 protocol is `{path, lineStart, lineEnd, note}` with no optionals — but this field
 * is parsed by the app-server out of a line of model prose, and this app's contract with an
 * un-owned wire shape is that a malformed part costs that part and nothing else (319 §3). A path
 * with no usable range is still the answer to *"which memory?"*; a range printed from a number
 * nobody could read would be `074`'s defect — a measurement nobody made.
 */
export interface MemoryRecallEntry {
  /**
   * The file, **relative to the profile's memory base path** — `MEMORY.md`,
   * `rollout_summaries/2026-02-17T21-23-02-LN3m-example.md`.
   *
   * ⛔ **Relative, and never resolved here.** The base path is a fact about a profile's home, which
   * this pure module does not have and must not guess; a surface that wants to say WHERE the store
   * is has 317's reader for that. See the module note for why it is never opened either.
   */
  readonly path: string
  /** First line the agent cited, 1-based. Absent when the provider's number was not usable. */
  readonly lineStart?: number
  /** Last line, inclusive. Absent with {@link lineStart} — a half range is not a range. */
  readonly lineEnd?: number
  /** The model's own words for HOW it used this file. Short by the provider's own instruction. */
  readonly note?: string
}

/** A whole citation, bounded — what one assistant message said it drew on. */
export interface MemoryRecall {
  readonly entries: MemoryRecallEntry[]
  /** Entries the citation named that this list does not hold. 0 normally. */
  readonly dropped: number
  /**
   * 🔴 **The ids of earlier Codex sessions the model says it drew on** — carried, and not rendered
   * as ids by anything (319 §1.2).
   *
   * ⚑ **What they are, from the provider's own instruction to the model** (the 0.146.0 binary, in
   * the same block that specifies the citation format): *"`rollout_ids` is for us to track what
   * previous rollouts you find useful … you can find rollout ids in rollout summary files and
   * MEMORY.md"*. So they are **previous conversations of this profile** — real ones, with rollout
   * files of their own — and three things follow that decide how a surface may use them:
   *
   *  - ⛔ **The provider says `citation_entries` is *"for rendering"* and this list is *"for us to
   *    track"*.** One of the two was written to be shown to a person and the other was not.
   *  - ⛔ **They are TRANSCRIBED by the model out of text files, not minted by the app-server.** An
   *    id the model mistyped is the same 36 characters of nothing as one it got right, and no part
   *    of this app can tell them apart.
   *  - ⚠️ **BroBot cannot resolve one.** Turning a rollout id into a conversation a person
   *    recognises means reading the profile's `sessions/` store, which is a capability and a
   *    separate dispatch. Until then, `106`'s rule applies: a surface must not offer what nothing
   *    can act on.
   *
   * So they are carried — the whole point of 319 is that this app was throwing the citation away —
   * and the row says only how MANY there were, which is the strongest true thing that can be said
   * without opening a file this app does not read.
   */
  readonly threadIds: string[]
  /**
   * Ids the citation named that {@link threadIds} does not hold — **for any reason**. 0 normally.
   *
   * ⛔ **Not only the cap**, and the difference matters because a SURFACE adds these two numbers to
   * say *"it also named N earlier sessions"*. An id too long to carry that was dropped without being
   * counted would make that N understate what the model wrote, which is `092` §4's silent cap at the
   * one number on the row a person has no other way to check. ⚠️ A DUPLICATE is not counted — the
   * provider's own instruction is *"include unique ids only"*, so two copies of one id named one
   * earlier session and this list holds one.
   */
  readonly threadsDropped: number
}

/**
 * The most entries one citation will carry rows for.
 *
 * ⚠️ **Measured small, bounded anyway.** The provider's own example block shows two lines and its
 * instruction is *"list entries in order of importance (most important first)"* — an ordering that
 * only matters if the list can be long. 20 is the same number `AGENT_MEMORY_NOTES_SHOWN` settled on
 * for the same judgement one surface over: how many file rows a person reads at once before a list
 * stops being a list. ⛔ A cap is never silent — {@link MemoryRecall.dropped} says when it bit
 * (`092` §4).
 */
export const MAX_RECALL_ENTRIES = 20

/**
 * The ceiling on a cited path, in characters.
 *
 * The same 4096 `file_change` bounds a path with, and stated as the same number on purpose: two
 * ceilings on *"a path this app will carry"* that differ are two answers to one question.
 */
export const MAX_RECALL_PATH = 4096

/**
 * The ceiling on the model's note about ONE file, in characters — ellipsis included.
 *
 * ⚠️ **500, and it is `MAX_COMMAND_TEXT`'s number for `MAX_COMMAND_TEXT`'s reason.** The
 * provider tells the model the note must be *"short, single-line"*, and the two real ones 318
 * captured are 44 and 20 characters — so this is an order of magnitude of headroom over the shape
 * it is for, and exists only so one malformed reply cannot write an unbounded string into every
 * store downstream (`052`).
 */
export const MAX_RECALL_NOTE = 500

/**
 * The most earlier-session ids one citation will carry. See {@link MemoryRecall.threadIds}.
 *
 * ⚑ **Bounded although nothing draws them**, which is the same rule `MAX_COMMAND_ALIASES` states:
 * an unbounded array of strings no surface can show still crosses IPC and still lands in SQLite.
 */
export const MAX_RECALL_THREADS = 20

/** The ceiling on one of those ids — the same 200 every other correlation id on this wire gets. */
export const MAX_THREAD_ID = 200

/**
 * ⛔ **The ONE bounding rule for a citation, and the one place a malformed part is forgiven.**
 *
 * ⚠️ **Not a convenience** — `169` §1, in the shape `boundCommands` states it: this runs on
 * the live wire and again over an imported bundle, and two call sites with two sets of caps means
 * one path shipping rows the schema rejects, which `toWireEvent` degrades to `unknown` and loses in
 * silence.
 *
 * ## What is dropped, what is clipped, and why the two are different
 *
 *  - **A path is DROPPED, never clipped** — {@link MAX_RECALL_PATH}. A shortened path is not a
 *    shorter answer to *"which file?"*, it is a wrong one, and it would send a person looking in the
 *    store for a name that is not there. Same ruling `boundCommands` makes about a command's name.
 *  - **A note is CLIPPED** — {@link MAX_RECALL_NOTE}. It is prose about how the file was used;
 *    losing its tail costs a reader some words, and losing the row costs them the file.
 *  - **A range is DROPPED as a PAIR.** `lineEnd` without `lineStart` is not half a range, it is a
 *    number with no meaning. ⚠️ **Presence is all this function checks, and that is deliberate**:
 *    whether two numbers are integral, non-negative and in order is a question about a PAYLOAD, and
 *    it is answered by whoever reads one — `codexMemoryRecall` on the wire, `storedRecallEntries` on
 *    replay, each against the same rule. By the time a pair reaches here it has been judged, and a
 *    second judgement in a function that takes `number | undefined` would be the same rule spelled
 *    twice. ⛔ Both of those refuse `234-3`, which is worse than no range at all.
 *
 * ⛔ **Every drop is counted.** `dropped` is measured against what the citation SENT, so one
 * subtraction covers the ceiling, the unusable paths, and anything that was not an entry at all.
 *
 * ⚠️ **Duplicate thread ids are removed, and that is the provider's own contract rather than our
 * tidiness** — its instruction to the model is *"include unique ids only; do not repeat ids"*. ⛔ No
 * shape check beyond that: the same instruction says they *"should look like UUIDs"*, and hardening
 * a filter on one capture's shape is how a channel goes quiet the day the shape moves
 * (`absence-in-a-capture-is-not-absence`). A de-duplicated id is not counted as dropped — the
 * citation named one earlier session and this list holds one earlier session.
 *
 * ⛔ **An id too long to carry IS counted, and an empty one is not** (found reviewing this diff).
 * The two are different facts: a 300-character string is something the model named and this event
 * will not carry, so a count that omitted it would understate what the citation said; an empty line
 * is not an id at all, and the provider explicitly allows *"an empty `<rollout_ids>` section"*.
 */
export function boundRecall(
  sentEntries: readonly MemoryRecallEntry[],
  sentThreadIds: readonly string[],
): MemoryRecall {
  const entries = sentEntries
    .filter((row) => row.path.trim() !== '' && row.path.length <= MAX_RECALL_PATH)
    .slice(0, MAX_RECALL_ENTRIES)
    .map((row) => ({
      path: row.path,
      // ⛔ **Both or neither** — see the note above about half a range.
      ...(row.lineStart !== undefined && row.lineEnd !== undefined
        ? { lineStart: row.lineStart, lineEnd: row.lineEnd }
        : {}),
      ...(row.note && row.note.trim() !== '' ? { note: clip(row.note, MAX_RECALL_NOTE) } : {}),
    }))
  const unique: string[] = []
  let unusable = 0
  for (const id of sentThreadIds) {
    // An empty line is not an id — see the note above.
    if (id.trim() === '') continue
    if (id.length > MAX_THREAD_ID) {
      unusable += 1
      continue
    }
    if (!unique.includes(id)) unique.push(id)
  }
  return {
    entries,
    dropped: sentEntries.length - entries.length,
    threadIds: unique.slice(0, MAX_RECALL_THREADS),
    threadsDropped: unusable + Math.max(0, unique.length - MAX_RECALL_THREADS),
  }
}
