import {
  hasControlCharacter,
  hasReorderingCharacter,
  quotedLiteral,
  type ScheduledJob,
} from '../../../shared/runtime-ipc'
import { SCHEDULED } from '../../../shared/agent-state'
import type { ScheduleRegistry } from './transcript'

/**
 * **What this conversation has promised to do LATER, in words** (258, from `253`'s event and `250`'s
 * measurement).
 *
 * ## Keep scheduled work visible independently of local activity
 *
 * > *"in the UI 'claude' is idle, even though it has something scheduled each 2 minutes."*
 *
 * Show a waiting schedule in the side panel even when no permission or question is pending.
 *
 * `250` measured where the fact lives and built nothing, as its dispatch instructed. `253` built the
 * event and drew nothing, as its dispatch instructed: `transcript.ts`'s arm was `case
 * 'scheduled_work': return`. So a job an agent created — reliably, unaided, in the 34-tool
 * vocabulary this app launches with — reached the app, was published as a level, and stopped at the
 * Events tab, which shows everything and is therefore where nothing is found.
 *
 * ## ⛔ Four rules this file is built to keep, and each one is somebody's scar
 *
 *  - Preserve the provider's cron expression verbatim. The provider owns timezone, daylight-saving behavior and the process that wakes. Do not spell a stepped cron expression in this block comment because its characters can terminate the comment; examples live in `schedule-words.test.ts`. The separate one-line state uses `shared/agent-state.ts`'s `nextWake` only for readable future times, while this bar retains the expression.
 *  - Show `prompt` without comparing it: the SDK can truncate it at 1000 characters with an in-string `… [+N chars]` marker, so it need not equal the submitted job text.
 *  - Absent is not empty; {@link ScheduleRegistry} enforces that distinction before this file reads the registry.
 *  - Do not infer that Codex has no scheduled work from an empty registry. The pinned protocol exposes no thread-scoped scheduled job to answer that question; an empty registry leaves the bar undrawn.
 *
 * ## ⚠️ Which way this fails
 *
 * Toward saying too little. A job that has been deleted stays on screen until the next turn end
 * restates the level, because `253` measured that the app cannot tell a deleted job from a one-shot
 * that fired and refuses to guess. A job that exists and has never been stated is not here at all.
 * Both are silences; neither is a false promise, which is the direction that would matter.
 *
 * ## ⚑ D-017 · R11 — the word and the bar's condition are `shared/agent-state.ts`'s
 *
 * `SCHEDULED` is the one word for this state — the pill, the rail row, this bar's heading and an
 * agent's `list_agents` line all say it, so none can name it a second way — and `scheduleHeld` is
 * whether the level holds anything, named or merely counted (`dropped` counts: `247` §3, *"a
 * registry that quietly undercounts is worse than none"*). ⛔ Deliberately not *"waiting"*, which
 * this app has spent on a person's answer: a schedule asks nothing of anybody.
 *
 * ⚑ **D-029 · the bar and every word ask that one question**, whether or not the conversation's
 * process runs: this app starts a stopped conversation in time for the jobs its provider will bring
 * back. ⚠️ Not for every job its ledger lists — one replaced, one aged out, one made before its last
 * compaction — and only the host knows which: so a view drawn from its ledger wears the host's
 * word, and its card draws no bar under *idle* (`AgentCard`). ⛔ 258 §2's *asleep* sentence went —
 * *"nothing here fires until this conversation takes its next message"* is no longer the rule.
 */

/**
 * ⛔ **The bar's heading — how many jobs the PROVIDER named, and nothing about when.**
 *
 * ⚠️ **The count is `jobs.length + dropped`, which is how many rows the provider sent**, not how
 * many are listed. `250` found the failure of the other arithmetic on the neighbouring surface:
 * `BackgroundBar`'s heading counts `running.length`, so a level carrying only unlistable rows would
 * have opened with *"**0** things are still running"*. Counting what was sent means this heading is
 * never 0 when the bar renders, and {@link droppedScheduleNote} says how much of it is missing.
 *
 * 🔴 **PRESENT tense, and the first draft's future tense was a real over-claim** — found by the
 * adversarial pass over this diff. *"1 job will wake this conversation"* is a statement about what
 * is going to happen, and this app cannot make one: the level is restated only at TURN END, so a
 * job the model deleted mid-turn, or a `recurring: false` row whose time has already passed, would
 * go on being promised for as long as nobody spoke. ⚑ This file's own header says its failure
 * direction is *toward saying too little* — a promise is the other direction, and it walked in
 * through the heading. *"is scheduled"* is what the provider said, which is all this app has.
 */
export function scheduleHead(registry: ScheduleRegistry): string {
  const total = registry.jobs.length + registry.dropped
  return total === 1 ? `1 job is ${SCHEDULED}` : `${total} jobs are ${SCHEDULED}`
}

/**
 * ⛔ **What the registry says when it is UNDERSTATING what is scheduled** — `247`'s `dropped`,
 * `092`'s no-silent-cap rule, in {@link droppedNote}'s shape one registry over.
 *
 * ⚠️ **Two reasons, counted together on purpose**: rows past the 100 ceiling, and rows the provider
 * sent with no id at all. **Why** a row was dropped is not a fact this app holds, and inventing one
 * would be `039`'s failure.
 *
 * ⚑ **Phrased against the HEADING rather than against the rows**, because the heading already counts
 * every row the provider sent — so *"3 of them"* reconciles with a number on screen instead of
 * asking a reader to add two.
 */
export function droppedScheduleNote(dropped: number): string {
  return dropped === 1
    ? '1 of them is not listed here — this conversation cannot name it'
    : `${dropped} of them are not listed here — this conversation cannot name them`
}

/**
 * Whether a job repeats, in the provider's own two states — and **absent when it did not say**.
 *
 * ⚠️ `recurring` is optional on the row, so `undefined` is a third answer and it is silence rather
 * than a guess (`074`: saying nothing arrived is a different fact from saying what did). Every
 * captured row carried the field; the optionality is a defensive read of an unknown payload, so this
 * branch is reachable rather than decorative.
 */
export const REPEAT_WORD = { true: 'repeats', false: 'once' } as const

/**
 * ⛔ **How much of a provider string one standing row shows** — the ledger's own ceilings, duplicated
 * here for `background-work.ts`'s stated reason and pinned by a test.
 *
 * ⚠️ **These are BACKSTOPS and never a second routine cut**, which is `251` §2's finding written
 * down rather than re-learnt: a display cut narrower than the ledger's would put two truncations on
 * one string, one of them counted and one not. `clipScheduleText` guarantees
 * `text.length <= max`— unlike `normalize.ts`'s `truncate`, which appends its ellipsis AFTER the
 * slice and is why `MAX_BACKGROUND_TEXT` had to be 201 to describe a 200-character rule. So these
 * are the runtime's numbers exactly, and a cut fires only on a payload the schema would have
 * rejected.
 *
 * ⚑ **Duplicated rather than imported**, the same trade `BACKGROUND_COMMAND_CHARS` and `changes.ts`
 * made and stated: the constants live in `packages/runtime`, and pulling them in here would drag the
 * runtime package into the renderer bundle for two integers. The equality is asserted in
 * `schedule-words.test.ts`, which runs in node and can import both.
 */
export const SCHEDULE_WHEN_CHARS = 200
/** The prompt's ceiling — see {@link SCHEDULE_WHEN_CHARS}. `MAX_SCHEDULE_PROMPT`. */
export const SCHEDULE_PROMPT_CHARS = 1024

/**
 * ⛔ **What makes a one-line row LIE** — `251` §2's set, applied to a second surface.
 *
 * ⚠️ **Duplicated from `background-work.ts`'s `breaksTheRow` rather than imported, because that file
 * belongs to `257` for the length of this dispatch and its predicate is not exported.** ⚑ **What is
 * NOT duplicated is the answer**: the two character SETS and the escaping are
 * {@link hasControlCharacter}, {@link hasReorderingCharacter} and {@link quotedLiteral}, all three
 * shared from `232` §2, so there is exactly one definition of *which* characters and exactly one of
 * *how*. `schedule-words.test.ts` asserts the two surfaces still answer alike.
 *
 * ⛔ **Both halves are reachable here and the second is the one with an attack behind it.** A
 * newline in a cron prompt turns one row into two and `\r` overwrites what was drawn before it;
 * U+202A–U+202E and U+2066–U+2069 reorder what is DRAWN without changing what is stored
 * (CVE-2021-42574, *"trojan source"*), and the target is a bar whose entire job is telling a person
 * what their machine has promised to do while they are not looking. ⚠️ And this text is more
 * exposed than a command: a cron prompt can be written by a model acting on a web page it read.
 */
function breaksTheRow(text: string): boolean {
  return hasControlCharacter(text) || hasReorderingCharacter(text)
}

/** One provider string, as far as the row shows it — {@link ScheduleLine}'s cells. */
export interface ScheduleShown {
  /** What a person reads. NEVER empty on any path that produces one of these. */
  text: string
  /** Characters of {@link full} that {@link text} does not show. 0 normally; non-zero is on screen. */
  cut: number
  /** The whole of what the level carries, quoted the same way and never clipped — the cell's title. */
  full: string
}

/**
 * ⚠️ **Sliced by CODE POINT**, because `String.prototype.slice` cuts UTF-16 units and a prompt ending
 * on an emoji at the boundary would render a lone surrogate — `�` on screen, from a function whose
 * whole job is not to mislead about what was promised.
 *
 * ⚑ **The cut is counted in the characters the row WOULD have shown, quoting included**, rather than
 * in the raw string: two numbers for one thing is how a count stops being checkable, and the one a
 * reader can verify is the one about the string in front of them.
 */
function shown(raw: string, max: number): ScheduleShown {
  const full = breaksTheRow(raw) ? quotedLiteral(raw) : raw
  const points = [...full]
  return points.length <= max
    ? { text: full, cut: 0, full }
    : { text: points.slice(0, max).join(''), cut: points.length - max, full }
}

/**
 * ⛔ **What one row says** — and it is deliberately three optional cells rather than one answer.
 *
 * ⚠️ **`backgroundWhat`'s shape does not fit, and copying it would have been the mistake.** That one
 * picks ONE of three ways to name a piece of work, because a command, a description and an id are
 * three answers to the same question. A schedule's `when` and `asks` are answers to *different*
 * questions — *when will this happen* and *what will it say* — and §3's requirement is that a job
 * shows both, plus whether it recurs.
 *
 * ⛔ **{@link ScheduleLine.fallback} is the `106` floor**: `schedule` and `prompt` are both optional
 * on the row, so a job that arrives with neither would render an empty line, and a row a person
 * cannot name is a row they cannot act on. Then — and only then — the id is drawn, because it is the
 * one field the producer guarantees: a payload with no id is dropped and counted rather than
 * becoming a row with a blank one.
 */
export interface ScheduleLine {
  /**
   * The provider's own id — the row's `key` and its `data-cy`, never its drawn text.
   *
   * 🔴 **Raw, and {@link fallback} exists because that matters** (found by the adversarial pass over
   * this diff). The first draft drew this string straight into the template on a bare row, so a job
   * whose id carried U+202E would reorder everything after it on the one surface whose stated job is
   * saying what this machine has promised to do unattended — the exact hazard {@link breaksTheRow}
   * is declared for, walked around by the one field it was not applied to.
   */
  id: string
  /** The provider's own expression, verbatim and unparsed. Absent when it did not say. */
  when?: ScheduleShown
  /** {@link REPEAT_WORD}'s word. Absent when the provider did not say which. */
  repeat?: string
  /** What the job will send — SHOWN, never compared. Absent when the provider did not say. */
  asks?: ScheduleShown
  /**
   * ⛔ **Neither {@link when} nor {@link asks} arrived, so the row is named by its id** — quoted the
   * same way every other cell is, and present ONLY in that state, so the template's `v-else-if` and
   * the row's `data-bare` are one fact rather than two.
   */
  fallback?: ScheduleShown
}

/**
 * One job, as the bar draws it.
 *
 * ⚠️ **A blank string falls THROUGH rather than being drawn**, the same way `backgroundWhat` treats
 * a blank summary: both fields are `z.string()` with no minimum, and a cell rendering nothing at all
 * is `106` however true the nothing is. Trimmed for the TEST and not for the display — a prompt with
 * meaningful leading whitespace is still shown as the model wrote it.
 */
export function scheduleLine(job: ScheduledJob): ScheduleLine {
  const when = job.schedule !== undefined && job.schedule.trim() !== '' ? job.schedule : undefined
  const asks = job.prompt !== undefined && job.prompt.trim() !== '' ? job.prompt : undefined
  return {
    id: job.id,
    ...(when === undefined ? {} : { when: shown(when, SCHEDULE_WHEN_CHARS) }),
    ...(job.recurring === undefined
      ? {}
      : { repeat: REPEAT_WORD[job.recurring ? 'true' : 'false'] }),
    ...(asks === undefined ? {} : { asks: shown(asks, SCHEDULE_PROMPT_CHARS) }),
    // ⛔ **Through `shown` like every other drawn cell** — see {@link ScheduleLine.id} for the defect
    // that came of drawing it raw, and note that this is the ONE cell that can be the whole row.
    ...(when === undefined && asks === undefined
      ? { fallback: shown(job.id, SCHEDULE_WHEN_CHARS) }
      : {}),
  }
}

/**
 * ⛔ **What the row's cut says, in {@link cutNote}'s exact shape one registry over** (092).
 *
 * ⚑ Reachable only on a payload larger than the schema admits — see {@link SCHEDULE_WHEN_CHARS} —
 * so it is a backstop that says so rather than a routine notice. It still says a COUNT and never a
 * browser's ellipsis, because a `…` the layout engine draws cannot be told from one the prompt ends
 * with, and says nothing about how much is behind it.
 */
export function scheduleCutNote(cut: number): string {
  return cut === 1 ? '+1 more character' : `+${cut} more characters`
}
