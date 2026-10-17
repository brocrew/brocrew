import type { ThinkingItem, ToolItem, TranscriptItem } from './transcript'
import { drawsAsACard } from './draws-as-a-card'
import {
  TOOL_OUTCOME_WORD,
  didNotPlainlySucceed,
  toolOutcome,
  toolSettled,
  toolTook,
} from './tool-outcome'

/**
 * ⚑ **A run's member, and the two envelope fields come with it.** `ToolItem` itself carries neither
 * `at` nor `ordinal` — they are `TranscriptItem`'s, stamped by the fold — and both are load-bearing
 * here: `at` is one half of every duration, and `ordinal` is *"the one identifier of a row that
 * survives a RE-FOLD."*
 */
export type RunCall = ToolItem & Pick<TranscriptItem, 'at' | 'ordinal'>

/** A finished thought inside a run, with the same two envelope fields. */
export type RunThought = ThinkingItem & Pick<TranscriptItem, 'at' | 'ordinal'>

/** One member of a run: a settled tool call or a finished thought, in ledger order. */
export type RunMember = RunCall | RunThought

const isCall = (member: RunMember): member is RunCall => member.kind === 'tool'

/**
 * Group consecutive settled tool rows into one row.
 *
 * ## ⛔ The defect, and it is an INVERSION rather than a tidiness problem
 *
 * ⚠️ **`EXT-013` §3.2:** *"seven boxes of `mcp__brobot__list_profiles{}` around two sentences of Ada
 * explaining her plan."* 🔴 **The agent's words are the small quiet part and the plumbing is the
 * loud part.**
 *
 * ⚑ **And the loudness was never the type.** Measured on `a69703c1`: `.tool-summary` is
 * `--text-4xs` (8.5 px) and its argument `code` is `--text-5xs` (8 px), where the reference line
 * `thought · ~434 tokens` is `--text-3xs` (9 px). ⛔ **The tool row's TEXT was already smaller than
 * the line it has to match.** What made seven of them dominate is the BOX — a `--line` border, a
 * `--wash-1` fill and a 34 px minimum — so the collapse deletes chrome and the type goes UP.
 *
 * ## 🔴 What may join a run, and every exclusion is somebody's ruling
 *
 * ⛔ **A run holds SETTLED, ORDINARY tool calls and the FINISHED thoughts between them, and nothing
 * else.** A thought that is still streaming stays its own row, as do the agent's own words. Four
 * kinds of tool row are kept out, and none of the four is a preference:
 *
 *  - Keep a live call separate through {@link toolSettled}; its Stop this command action must stay visible.
 *  - Keep sub-agent calls separate so running children are not hidden inside collapsed output.
 *  - Keep workflow calls separate for the same reason.
 *  - Keep app messaging calls separate as cards showing where their words went.
 *
 * ⚑ **So the rows this deletes are the finished, childless ones**, which is precisely the seven the
 * PO counted. A turn that is still working looks exactly as it does today.
 *
 * ## ⛔ A REFUSAL is not a member, and that is the correction this dispatch owes its brief
 *
 * 🔴 **`587`'s brief asked for *"a run containing a refusal"* with the refusal spelled onto the
 * collapsed line.** ⚠️ **A refusal cannot be a member, and the reason is measured rather than
 * stylistic.** `ToolRefusedEvent` carries no call id at all. ⚠️ **`runtime-ipc.ts` says why it has
 * none** — *"an id present on one provider and absent on the other would be worse than none"* — and
 * **`transcript.ts`'s fold states what the row has instead**, which is the sentence this function is
 * built around:
 *
 * > ⚠️ **"It is not attached to the call above it, and {@link ToolRefusedEvent} says why: no id
 * > reaches the tool layer on either provider, so the row states which tool and which rule and lets
 * > its position do the rest."**
 *
 * 🔴 **Position is the whole of a refusal's attribution, and a collapse that absorbed one would
 * spend it.** ⚑ **So a refusal BREAKS a run** — it keeps its place in the ledger's order, at exactly
 * the legibility it has today, and the calls on either side of it collapse around it.
 *
 * ⚑ **That satisfies `EXT-013` §3.3 in its strongest form**: *"a refused call … must stay legible
 * when the run is COLLAPSED"* is answered by never collapsing one. ⛔ **And it is not free** — the
 * measured worst case, four refusals in a row (`two-verbs-one-sentence.smoke.ts`), draws four quiet
 * lines where absorbing would have drawn one. ⚠️ **Four quiet lines is the price of three facts, and
 * the inversion is fixed either way: after this, every one of those rows is a line and the refusals
 * are the only loud thing left.**
 *
 * ## ⚠️ What a run does NOT do
 *
 * ⛔ **It does not reorder, drop or lift anything.** Members keep their ledger order inside the row,
 * and every item that is not in a run is emitted exactly where it was.
 */
export type TranscriptRow =
  | {
      kind: 'item'
      /** The item to draw, unchanged. */
      item: TranscriptItem
      /** Its index in the list this was folded from — `TranscriptView`'s `dimmed` reads it. */
      at: number
    }
  | {
      kind: 'run'
      /**
       * ⚑ **Keyed on the FIRST member, and the alternative was measured against a live turn.** A run
       * grows at its END as calls settle, so a key taken from the last member would change on every
       * new call and remount the row — losing whatever a person had opened — in the middle of the
       * turn they were watching. The first member only moves when older history is prepended.
       *
       * ⚠️ Two moments still draw the row new. A lone thought is an item, so when the first call
       * settles after it the row becomes a run and is drawn by another component. And a prepend
       * that brings an older thought or call in front gives the run a new first member.
       */
      id: string
      /** Every member, tools and thoughts, in ledger order. */
      members: readonly RunMember[]
      /** The tool calls among them, in the same order. */
      calls: readonly RunCall[]
      at: number
    }

/**
 * ⛔ **A finished thought, or a call that is settled, childless, carrying no workflow, and not a
 * message to another conversation** — the whole membership test, in one predicate
 * so that {@link transcriptRows} and every instrument ask the same question.
 */
export function joinsARun(item: TranscriptItem): item is RunMember {
  // A finished thought joins the calls around it: Codex writes one before almost every call, and
  // each one used to break the run. A thought still streaming stays its own row.
  if (item.kind === 'thinking') return !item.streaming
  if (item.kind !== 'tool') return false
  if (item.subAgents !== undefined && item.subAgents.length > 0) return false
  if (item.workflow !== undefined) return false
  // 🔴 **658 · a call that spoke to another conversation is its own card**, never a line in a run.
  if (drawsAsACard(item)) return false
  return toolSettled(item)
}

/**
 * **The fold: a list of items becomes a list of rows**, where every maximal span of consecutive
 * {@link joinsARun} members is one row — except a single thought with no call beside it, which
 * stays the item it was.
 *
 * ⚑ **A span of ONE is still a run**, and that is `EXT-013` §3.1 rather than an edge case: the table
 * says *collapsed → the size and weight of `thought · ~434 tokens`* about a tool row, and *a run of
 * them → one line for the run*. ⛔ **A single finished call that stayed a bordered card while its
 * neighbours became lines would be two treatments for one kind of thing.**
 */
export function transcriptRows(items: readonly TranscriptItem[]): readonly TranscriptRow[] {
  const rows: TranscriptRow[] = []
  let run: RunMember[] = []
  let runAt = 0

  const close = (): void => {
    const first = run[0]
    const calls = run.filter(isCall)
    // A lone thought with no call beside it is drawn as it always was; two or more fold to one line.
    if (first !== undefined && calls.length === 0 && run.length === 1)
      rows.push({ kind: 'item', item: first, at: runAt })
    else if (first !== undefined)
      rows.push({ kind: 'run', id: `run:${first.id}`, members: run, calls, at: runAt })
    run = []
  }

  items.forEach((item, at) => {
    if (joinsARun(item)) {
      if (run.length === 0) runAt = at
      run.push(item)
      return
    }
    close()
    rows.push({ kind: 'item', item, at })
  })
  close()
  return rows
}

/**
 * ⚑ **What the row is keyed on**, so the `v-for` and the fold cannot disagree about it.
 *
 * ⚠️ **A plain item keeps `itemKey`'s answer rather than a new one** — a card must stay the SAME
 * component instance across a re-fold, which is what keeps an open disclosure open.
 */
export function rowKey(row: TranscriptRow, keyOfItem: (item: TranscriptItem) => string): string {
  return row.kind === 'run' ? row.id : keyOfItem(row.item)
}

/**
 * ⛔ **How many distinct tool names the quiet line spells before it starts counting.**
 *
 * ⚠️ **A cap is never silent** (`092`): what the line does not spell it says the number of, so
 * `+2 more` is a count rather than an elision.
 *
 * ⛔ **Three is a CHOSEN number and not a measured one, and the first version of this note claimed
 * otherwise** — it said three was what fits *"without the line wrapping"*, and the line cannot wrap
 * at any cap, because `.detail` is `white-space: nowrap`. ⚑ **What a cap buys is a count instead of
 * an ellipsis**: past it the line says `+2 more`, which is a fact, where the browser would have said
 * `…`, which is not. ⚠️ It lives here rather than in the stylesheet so the test and the renderer read
 * one value.
 */
export const NAMES_SPELLED = 3

/**
 * 🔴 **The collapsed line, derived rather than composed at the call site** — one spelling, and a
 * test can drive it without a DOM.
 *
 * ## ⚑ Why it has two shapes and that is not two vocabularies
 *
 * ⚠️ **`ThinkingEntry`'s own label is the precedent and the reference**: it says
 * `thought · ~165 tokens` when there is a count and bare `thought` when there is not. ⛔ **The line
 * says the most informative thing it has at each size** — one call names itself and how long it
 * took, several are counted and then named — and matching that is the whole instruction in
 * `EXT-013` §3.1's first row.
 *
 * ## 🔴 The hazard, closed by construction rather than by vigilance
 *
 * ⛔ **`an-unenumerated-state-counts-as-success`.** ⚠️ {@link amiss} is computed from the COMPLEMENT
 * of `TOOL_OUTCOMES_DONE`, never from a list of failures somebody wrote out. 🔴 **A tenth outcome
 * added tomorrow appears on this line on the day it is added**, and the direction it fails in is
 * loud rather than quiet — which is the safe one for the only row a person may never expand.
 *
 * ⚑ **And it words them from `TOOL_OUTCOME_WORD`**, so *did not finish* and *ended, outcome not
 * reported* say here exactly what they say on the card (`222` §4).
 *
 * ## ⚠️ What the line does NOT say, stated because it is a real loss
 *
 * ⛔ **Detached work that FINISHED is `completed`, which is plainly done, so the line says nothing
 * about the detachment at all.** `248`'s own sentence — *"once the work ends, how long it really
 * ran is the other half of the completion record"* — is still drawn, but on the card only, and a
 * settled detached call has no card. ⚑ **A run of ONE still states the duration** (`toolTook` reads
 * `endedAt`, so *30.1 s* survives); a run of several states names instead.
 *
 * 🔴 **`248`'s ruling itself is intact and that is the part that matters**: a detached command that
 * is still RUNNING is never collapsed, because `joinsARun` keeps every live row out — so the green
 * settled card `245` measured for 24.5 seconds cannot come back.
 */
export interface RunLine {
  /** ⚑ The name when there is one call, the count when there are several or none. */
  head: string
  /** ⚠️ What it did — the names tallied, or the one call's duration. Empty when there is neither. */
  detail: string
  /** How many thoughts the run holds beside its calls, worded. Empty when there are none. */
  thoughts: string
  /** 🔴 Everything settled that is not plainly done, counted and worded. Drawn LOUD. */
  amiss: readonly string[]
  /**
   * ⛔ **Something in this run reached the profile's own memory store** (330, restored at the
   * adversarial pass over `587`'s diff).
   *
   * Retain the memory badge on the folded row. Putting it only in expanded content hides the identifying fact behind a press and the correct tab.
   *
   * ⚠️ **A flag, not the path.** The path is what `.tool-summary`'s ellipsis ate and what the panel
   * shows in full; what the quiet line owes is the WORD.
   */
  memory: boolean
}

export function runLine(members: readonly RunMember[]): RunLine {
  const calls = members.filter(isCall)
  const counted = members.length - calls.length
  const thoughts = counted === 1 ? '1 thought' : `${counted} thoughts`
  // Thoughts only: counted, never named, and nothing else to say.
  if (calls.length === 0)
    return { head: thoughts, detail: '', thoughts: '', amiss: [], memory: false }
  const one = calls.length === 1 ? calls[0] : undefined
  const amiss = tally(
    calls.filter(didNotPlainlySucceed).map((call) => TOOL_OUTCOME_WORD[toolOutcome(call)]),
    // ⚠️ **Every word, never a cap.** The names above are chrome and may be counted away; this is
    // the one thing on the line a person cannot get to any other way without opening the row.
    Number.POSITIVE_INFINITY,
    (word, count) => (one === undefined ? `${count} ${word}` : word),
  )
  const memory = calls.some((call) => call.memoryPath !== undefined)
  if (one !== undefined) {
    return {
      head: one.name,
      detail: amiss.length > 0 ? '' : (toolTook(one, one.at) ?? ''),
      thoughts: counted > 0 ? thoughts : '',
      amiss,
      memory,
    }
  }
  return {
    head: `${calls.length} tool calls`,
    detail: tally(
      calls.map((call) => call.name),
      NAMES_SPELLED,
      (name, count) => (count === 1 ? name : `${name} ×${count}`),
    ).join(', '),
    thoughts: counted > 0 ? thoughts : '',
    amiss,
    memory,
  }
}

/**
 * **Count the repeats, keep first-seen order, and say how many were not spelled.**
 *
 * ⚠️ **First-seen rather than most-frequent**, because the line sits where the calls happened and a
 * reader's eye is on the order they happened in. ⛔ **`Map` rather than an object**, so a tool
 * literally named `constructor` is counted rather than colliding with a prototype member.
 */
function tally(words: readonly string[], cap: number, say: (word: string, n: number) => string) {
  const counts = new Map<string, number>()
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1)
  const said = [...counts].slice(0, cap).map(([word, n]) => say(word, n))
  const left = counts.size - said.length
  return left > 0 ? [...said, `+${left} more`] : said
}
