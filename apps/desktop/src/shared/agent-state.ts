import type { BackgroundWork, ScheduledJob } from '@brobot2/runtime'
import { clockTime } from './clock'
import { hasControlCharacter, hasReorderingCharacter, quotedLiteral } from './runtime-ipc'

/**
 * # ⚑ D-017 · R11 — what an agent is doing, as ONE derivation (`05` rule 5)
 *
 * An agent can be idle while it has a scheduled job. Represent the schedule separately from current activity.
 *
 * ⛔ **One state, read by every reader**: `list_agents`, `get_agent_status` and `list_tasks`'
 * `given_to_is` in `main`, and the window's plate, rail and palette. Each side
 * feeds it the facts it holds — `main` from the running conversation's levels and the ledger, the
 * window from its transcript's registries — and neither words a state on its own. ⚑ It was the
 * window's (F023: `agent-state.ts`, `scheduled-work.ts`, `background-work.ts`) and moved here whole,
 * words included, so `main` says what the window draws.
 *
 * ⚑ **Whether a process runs is never one of its inputs** (rule 5): a conversation this app is not
 * running reads `idle` unless a person or another agent owes it something, which is what its record
 * says, and a message starts it — ⚑ or unless it owes another agent an answer (F036), which the
 * asker's record says — ⚑ or unless it holds a job this app will start it for (D-029), which
 * reads *scheduled*. ⚠️ *Starting* reads `active`: something is on its way into it.
 *
 * ## The states, in the one order they are asked
 *
 *  1. **needs you** — a person's answer or approval is waiting in it: a card or question asked of a
 *     person, a decision, or an ask against its rules — ⚑ or (F097) it answered a person who wrote to
 *     it, with work it was given still open, and waits for their next words.
 *  2. **active** — a turn is running, or a start or a delivery is on its way in.
 *  3. **waiting on an answer from <name>** — a question it asked is its parent's (or the agent it
 *     named) to answer (R19): never a person's, so never *needs you*. ⚑ The conversation is named by
 *     the piece it owns (D-016 · commit 7 · R3): a question can go to any of one agent's
 *     conversations, so the agent's name alone could name two.
 *  4. **owes an answer to <name>** — ⚑ F036 · its turn ended with a question still open that another
 *     conversation put to it: as its parent, or by naming it. ⚑ Each asker is said once, named as
 *     agents are named everywhere; several say the oldest asker and how many more.
 *  5. **running in the background · <what>** — idle, with work still running: a command, or a
 *     sub-agent its provider runs in the background (D-040).
 *  6. **scheduled · HH:MM** — idle, with a wake-up the provider scheduled; the time is the next one
 *     this app knows for its jobs, on the Mac's clock, and is left out when it knows none.
 *  7. **waiting on <name>** — ⚑ D-036 · idle, with work it gave out still open, whatever its own
 *     depth: a piece it gave, or one a conversation it took the place of gave, that is not
 *     answered, taken back or closed — whatever became of the piece it hangs under, and stalled or
 *     not. ⚑ Each conversation holding it is said once, named as agents are named everywhere, by the
 *     piece it owns (`Ali (the owner of W1.3.1 · Book the flights)`); several say the one given work
 *     first and how many more.
 *  8. **idle**.
 *
 * ⚑ **Why R19's state sits third** — below *active*, above the background. ⛔ **Below *active***: a
 * conversation that asked and then carried on is doing something, and *active* is the truer word
 * while it does; a card the provider is PARKED on holds no turn that runs, so an asker stopped on its
 * question reads the wait. ⛔ **Above the background and the schedule**, for the reason *needs you*
 * already outranks them in the window (`250`): an unanswered question HOLDS the conversation — it
 * cannot go on with what it asked about until somebody answers — while work left running holds
 * nothing, and a wake-up has not started. The word a reader gets is the one that names who must act.
 *
 * ⚑ **Why F036's sits fourth** — right below its own unanswered question, above the background, the
 * schedule and its wait on a worker. ⛔ **Below *waiting on an answer***: an agent waiting on its own
 * question is blocked first. ⛔ **Above the rest**: the next move is THIS conversation's — another
 * agent waits on it — while the background, a wake-up and work out with others ask nothing of it; a
 * conversation that owes an answer and reads *waiting on a worker* looks as if the two wait on each
 * other (F036, measured). ⚠️ Only once its turn has ended: *active* outranks it, so a turn answering
 * it says so.
 *
 * ⚑ **Why D-036's sits seventh** — below the schedule, above *idle*, where the window already ranked
 * a conversation's own wait on a worker. ⛔ **Below the six above it**: the work is out with other
 * agents, so a person's answer, a turn, a question, a process or a wake-up is the nearer thing to
 * say. ⛔ **Above *idle***: work it gave is not over — a reply is on its way, and it starts it
 * (D-017 · R1), or the piece stalled and is its own to follow up or take back — and *idle* would
 * say it holds nothing out. ⚠️ A stalled piece keeps the word, though nothing drives it, so the
 * conversation's word agrees with its piece's (*waiting on a worker*).
 */

/**
 * ⚑ **The command a piece of background work is running, joined from the tool call that started
 * it** (`251`) — the tool's own name and the call's summary, exactly as its card prints them, so the
 * card and the row cannot disagree.
 */
export interface BackgroundCommand {
  /** The tool's own name — `Bash`, `Agent`. */
  readonly name: string
  /** The call's `summary`, the exact string its card shows. */
  readonly text: string
}

/** One piece of work still running: the provider's own fields, plus the command joined to them. */
export type BackgroundRow = BackgroundWork & { readonly command?: BackgroundCommand }

/**
 * ⚑ **What is running in the background, as the provider last stated the LEVEL** — `running`
 * REPLACES on every level frame (`248`), and `dropped` counts the rows the level carried that could
 * not be listed, so a level that understates says so.
 */
export interface BackgroundLevel {
  readonly running: readonly BackgroundRow[]
  readonly dropped: number
}

/**
 * ⚑ **One scheduled job** — the provider's own fields, and the minute it will next run where this
 * app knows it (`nominalAt`, which the app's own level rows carry: a one-shot's own minute, a
 * repeating job's next one, read from what was recorded when the job was made). ⚑ `listedSince` is
 * the moment the window's fold first saw the job listed.
 */
export type ScheduledRow = ScheduledJob & { readonly listedSince?: number }

/** ⚑ **What is scheduled, as the provider last stated the LEVEL** — the same REPLACE rule (`258`). */
export interface ScheduleLevel {
  readonly jobs: readonly ScheduledRow[]
  readonly dropped: number
}

/** ⚑ Nothing running, and nothing scheduled: the level of a conversation no frame has spoken for. */
export const NOTHING_IN_THE_BACKGROUND: BackgroundLevel = { running: [], dropped: 0 }
export const NOTHING_SCHEDULED: ScheduleLevel = { jobs: [], dropped: 0 }

/**
 * ⛔ **Is anything still running — the ONE predicate** (`250`, on `223`'s rule: one predicate, every
 * consumer asks it).
 *
 * ⚠️ **`dropped` counts, and it is not defensive**: a level can carry rows this app cannot list — past
 * the ceiling, or sent with no id — so `running` is empty while something runs, and a predicate
 * reading only `running` would answer *idle* on the one payload the provider said was short (`247`
 * §3: *"a registry that quietly undercounts is worse than none"*).
 */
export function somethingRunning(level: BackgroundLevel): boolean {
  return level.running.length > 0 || level.dropped > 0
}

/**
 * ⛔ **Is there a schedule — named or merely counted** (`258`) — {@link somethingRunning}'s rule, one
 * level over: `dropped` counts for the same reason.
 *
 * ⚠️ **It says the level HOLDS jobs, not that any fires.** ⚑ In `main` a stopped conversation's level
 * is its wake-up's — the jobs this app starts it for (D-029). ⚠️ A window's fold of a ledger holds
 * what the provider last listed, which may be jobs no start will bring back — replaced, aged out,
 * lost to a compaction — so a view drawn from a ledger draws the host's word over it.
 */
export function scheduleHeld(level: ScheduleLevel): boolean {
  return level.jobs.length > 0 || level.dropped > 0
}

// ─── What runs in the background ────────────────────────────────────────────────────────────────

/**
 * # 🔴 What a row is actually RUNNING (`251` §2)
 *
 * Prefer the command joined from the initiating call. The model's description alone may not identify the process the person is looking for.
 *
 * ⚑ **Three answers, and none of them is blank** (`106`: a row a person cannot name is a row they
 * cannot act on):
 *
 *  - **`command`** — the row joined to its own tool call, and the text is that call's summary: the
 *    string the tool card prints.
 *  - **`description`** — ⚠️ the join is OPTIONAL: a row with no tool call id shows the provider's
 *    description, and so does the FIRST level frame of every piece of work, which is emitted before
 *    the provider binds the call (`248` §5).
 *  - **`id`** — the last resort, when the row carries no description either; it is what a Stop sends,
 *    so a row named by it can still be acted on.
 */
export type BackgroundWhatFrom = 'command' | 'description' | 'id'

export interface BackgroundWhat {
  /** Which of the three answers this is. */
  readonly from: BackgroundWhatFrom
  /** The tool's own name, on a `command` only. */
  readonly name?: string
  /** What a person reads. Never empty. */
  readonly text: string
  /** Characters of {@link full} that {@link text} does not show. */
  readonly cut: number
  /**
   * The whole of what the LEDGER carries, quoted the same way and never clipped. ⚠️ Not "the whole
   * command": the normalizer keeps 200 characters of a tool summary and throws the rest away.
   */
  readonly full: string
}

/**
 * ⛔ **How much of a command one line shows** — `MAX_BACKGROUND_TEXT`'s 200 plus the ellipsis the
 * normalizer's `truncate` appends, so this is a backstop and never a second routine cut (`251` §2: a
 * narrower cut put two truncations on one command, one counted and one not).
 */
export const BACKGROUND_COMMAND_CHARS = 201

/**
 * ⛔ **What makes a one-line row lie**: a control character (a line break turns one row into two)
 * or a bidi mark (it reorders what is drawn without changing what is stored — CVE-2021-42574). Quoted
 * by {@link quotedLiteral} when either is present, and drawn as typed otherwise: a command is read by
 * a person, and backslashes in front of what they typed would be a worse reading of a true thing.
 */
function breaksTheRow(text: string): boolean {
  return hasControlCharacter(text) || hasReorderingCharacter(text)
}

function shown(raw: string): { text: string; cut: number; full: string } {
  const full = breaksTheRow(raw) ? quotedLiteral(raw) : raw
  // ⚠️ Sliced by CODE POINT, so an astral character at the boundary is never split.
  const points = [...full]
  return points.length <= BACKGROUND_COMMAND_CHARS
    ? { text: full, cut: 0, full }
    : {
        text: points.slice(0, BACKGROUND_COMMAND_CHARS).join(''),
        cut: points.length - BACKGROUND_COMMAND_CHARS,
        full,
      }
}

/**
 * ⚑ **What one row is running, in the words its own tool call used** — the command, else the
 * provider's description, else its id. ⚠️ A blank summary or description falls THROUGH: a row that
 * says nothing is the failure this exists to prevent.
 */
export function backgroundWhat(row: BackgroundRow): BackgroundWhat {
  if (row.command !== undefined && row.command.text.trim() !== '') {
    return { from: 'command', name: row.command.name, ...shown(row.command.text) }
  }
  if (row.description !== undefined && row.description.trim() !== '') {
    return { from: 'description', ...shown(row.description) }
  }
  return { from: 'id', ...shown(row.id) }
}

/**
 * ⚑ **What the conversation left running, in one phrase** — the first piece of work the provider
 * listed, named as its row names it, with how many more there are. `null` when nothing is listed.
 */
export function inTheBackground(level: BackgroundLevel): string | null {
  const first = level.running[0]
  if (first === undefined) return null
  const what = backgroundWhat(first).text
  const more = level.running.length - 1 + level.dropped
  return more > 0 ? `${what} +${more}` : what
}

// ─── When a scheduled wake-up is due ────────────────────────────────────────────────────────────

/**
 * ⚑ **When the conversation next wakes** — the earliest time ahead that this app knows for one of
 * its jobs ({@link ScheduledRow.nominalAt}), or `null` when it knows none. ⛔ No time is worked out
 * here from a job's expression: a job whose time is not known makes the word plain *scheduled*,
 * and so does one whose time has passed, which is all the provider still says of it.
 */
export function nextWake(jobs: readonly ScheduledRow[], now: number): number | null {
  let soonest: number | null = null
  for (const job of jobs) {
    const at = job.nominalAt
    if (at !== undefined && at > now && (soonest === null || at < soonest)) soonest = at
  }
  return soonest
}

// ─── The state ──────────────────────────────────────────────────────────────────────────────────

/** ⚑ The one word for work a conversation left running — the PM's own phrase (F023). */
export const IN_THE_BACKGROUND = 'running in the background'

/**
 * ⚑ **The one word for a conversation that will wake on its own later** (`258`) — the schedule bar's
 * heading and pill are built from it too. ⛔ Deliberately not *"waiting"*, which this app has already
 * spent on a person's answer: a schedule asks nothing of anybody.
 */
export const SCHEDULED = 'scheduled'

/**
 * ⚑ **One agent's state** — see this file's head for the order the arms are asked in.
 *
 * ⚠️ **The details travel on their arm**: what runs on `in-the-background`, when it is due on
 * `scheduled`, whose answer on `waiting-on-an-answer`, ⚑ who holds the work on
 * `waiting-on-a-worker`. `null` is *this app cannot say*, and the word then says only the state.
 */
export type AgentState =
  | { readonly is: 'needs-you' }
  | { readonly is: 'active' }
  | {
      readonly is: 'waiting-on-an-answer'
      /**
       * What to call the conversation that owes the answer — its agent's name, or a category, and
       * the piece it owns (`theConversationCalled`, D-016 · commit 7 · R3):
       * `Ada (the owner of W1.2 · Build the pages)`.
       */
      readonly from: string
      /** When it asked the question it waits on, epoch ms; absent where this app cannot say. */
      readonly since?: number
    }
  | {
      readonly is: 'owes-an-answer'
      /**
       * ⚑ **F036 · each conversation waiting on an answer from this one** — the asker of each question
       * still open that it was put as the parent or by name, once, named as {@link AgentState}'s
       * `from` is, in the order of its oldest such question. ⛔ Never empty.
       */
      readonly to: readonly [string, ...string[]]
      /** When the oldest of those questions was put to it, epoch ms; absent where this app cannot say. */
      readonly since?: number
    }
  | { readonly is: 'in-the-background'; readonly what: string | null }
  | { readonly is: 'scheduled'; readonly dueAt: number | null }
  | {
      readonly is: 'waiting-on-a-worker'
      /**
       * ⚑ **D-036 · who holds the work it gave out** — each conversation holding a piece of it that
       * is still open, once, named by the piece it owns as {@link AgentState}'s `from` is
       * (`theConversationCalled`), in the order of its oldest open give:
       * `Ali (the owner of W1.3.1 · Book the flights)`. ⛔ Never empty: a conversation with no work
       * out is not in this arm.
       */
      readonly on: readonly [string, ...string[]]
      /** When it gave out the oldest of that open work, epoch ms; absent where this app cannot say. */
      readonly since?: number
      /** The pieces whose holder stopped with them open; absent when none did. */
      readonly stopped?: readonly [StoppedPiece, ...StoppedPiece[]]
    }
  | { readonly is: 'idle' }

/** A piece this conversation gave whose holder stopped with it open: its turn ended, nothing asked. */
export interface StoppedPiece {
  /** The piece's label, as a person says it: `W6.4.1`. */
  readonly label: string
  /** What to call its holder: the agent's name, `Quinn`. */
  readonly holder: string
  /** When the holder stopped, epoch ms. */
  readonly at: number
}

export type AgentStateName = AgentState['is']

/** What a state is derived from — each side feeds what it holds. */
export interface AgentStateFacts {
  /**
   * A person's answer or approval is waiting in this conversation — ⚑ or (F097) it answered a person
   * who wrote to it and waits for their next words.
   */
  readonly needsYou: boolean
  /** A turn is running, or a start or a delivery is on its way in. */
  readonly active: boolean
  /**
   * What to call the conversation that owes an answer to a question it asked — named by the piece it
   * owns, as {@link AgentState}'s `from` is — or `null`.
   */
  readonly waitingOnTheAnswerOf: string | null
  /** When it asked that question, epoch ms, or `null` or absent where this app cannot say. */
  readonly waitingOnTheAnswerSince?: number | null
  /**
   * ⚑ **F036 · what to call each conversation waiting on an answer from this one** — each once,
   * named and ordered as {@link AgentState}'s `to` is — or none.
   */
  readonly owesAnAnswerTo: readonly string[]
  /** When the oldest question it owes an answer to was put to it, epoch ms, or `null` or absent. */
  readonly owesAnAnswerSince?: number | null
  readonly background: BackgroundLevel
  readonly scheduled: ScheduleLevel
  /**
   * ⚑ **D-036 · what to call each conversation holding open work it gave** — each once, named and
   * ordered as {@link AgentState}'s `on` is — or none.
   */
  readonly waitingOnTheWorkOf: readonly string[]
  /** When it gave out the oldest of that open work, epoch ms, or `null` or absent. */
  readonly waitingOnTheWorkSince?: number | null
  /** The pieces it gave whose holder stopped with them open, oldest first, or none. */
  readonly stoppedWork?: readonly StoppedPiece[]
}

/**
 * ⚑ **Which state the facts land on — the ORDER alone, before any detail is read** (this file's
 * head). ⛔ The one place the order is written: {@link agentStateOf} asks it, and so does the
 * window's one-word standing, which holds them as facets rather than as levels — so the two
 * cannot rank one conversation's facts two ways.
 */
export interface AgentStateArmFacts {
  readonly needsYou: boolean
  readonly active: boolean
  readonly waitingOnAnAnswer: boolean
  /**
   * ⚑ **F036** — another conversation waits on an answer from this one. ⚠️ Absent is `false`: a
   * reader that does not hold the fact yet (the window's facets) asks the order without it.
   */
  readonly owesAnAnswer?: boolean
  readonly inTheBackground: boolean
  readonly scheduled: boolean
  readonly waitingOnAWorker: boolean
}

export function agentStateArm(facts: AgentStateArmFacts): AgentStateName {
  if (facts.needsYou) return 'needs-you'
  if (facts.active) return 'active'
  if (facts.waitingOnAnAnswer) return 'waiting-on-an-answer'
  if (facts.owesAnAnswer === true) return 'owes-an-answer'
  if (facts.inTheBackground) return 'in-the-background'
  if (facts.scheduled) return 'scheduled'
  if (facts.waitingOnAWorker) return 'waiting-on-a-worker'
  return 'idle'
}

export function agentStateOf(facts: AgentStateFacts, now: number): AgentState {
  const from = facts.waitingOnTheAnswerOf
  const [firstStopped, ...moreStopped] = facts.stoppedWork ?? []
  // A stopped holder still holds the work, so it is counted among those this one waits on.
  const [first, ...more] = [
    ...facts.waitingOnTheWorkOf,
    ...(facts.stoppedWork ?? []).map((piece) => piece.holder),
  ]
  const [owedFirst, ...owedMore] = facts.owesAnAnswerTo
  const arm = agentStateArm({
    needsYou: facts.needsYou,
    active: facts.active,
    waitingOnAnAnswer: from !== null,
    owesAnAnswer: owedFirst !== undefined,
    inTheBackground: somethingRunning(facts.background),
    scheduled: scheduleHeld(facts.scheduled),
    waitingOnAWorker: first !== undefined,
  })
  if (arm === 'waiting-on-an-answer' && from !== null) {
    return { is: arm, from, ...since(facts.waitingOnTheAnswerSince) }
  }
  if (arm === 'owes-an-answer' && owedFirst !== undefined) {
    return { is: arm, to: [owedFirst, ...owedMore], ...since(facts.owesAnAnswerSince) }
  }
  if (arm === 'in-the-background') return { is: arm, what: inTheBackground(facts.background) }
  if (arm === 'scheduled') return { is: arm, dueAt: nextWake(facts.scheduled.jobs, now) }
  if (arm === 'waiting-on-a-worker' && first !== undefined) {
    return {
      is: arm,
      on: [first, ...more],
      ...since(facts.waitingOnTheWorkSince),
      ...(firstStopped === undefined ? {} : { stopped: [firstStopped, ...moreStopped] }),
    }
  }
  return arm === 'needs-you' || arm === 'active' ? { is: arm } : { is: 'idle' }
}

/** A wait's start as its arm carries it: present only where this app can say it. */
function since(at: number | null | undefined): { readonly since?: number } {
  return typeof at === 'number' ? { since: at } : {}
}

/**
 * ⚑ **The state in words** — *"scheduled · 04:53"*, *"running in the background · npm run build"*,
 * *"waiting on an answer from Ada (the owner of W1.2 · Build the pages)"*. ⛔ No full stop: it is a
 * word on a line. ⚑ The time is {@link clockTime}'s, on the Mac's clock in either process.
 * ⚠️ *"from <name>"* and not *"<name>'s answer"*: a possessive cannot follow the name's bracket.
 * ⚑ D-036 · *"waiting on Ali (the owner of W1.3.1 · Book the flights) +1"* — the first, and how
 * many other conversations hold its work, as {@link inTheBackground} says several. ⚑ F036 ·
 * *"owes an answer to Ada (the owner of W1.2 · Build the pages) +1"*, the same way.
 */
export function agentStateWords(state: AgentState): string {
  switch (state.is) {
    case 'needs-you':
      return 'needs you'
    case 'active':
      return 'active'
    case 'waiting-on-an-answer':
      return `waiting on an answer from ${state.from}`
    case 'owes-an-answer': {
      const [first, ...more] = state.to
      return more.length === 0
        ? `owes an answer to ${first}`
        : `owes an answer to ${first} +${String(more.length)}`
    }
    case 'in-the-background':
      return state.what === null ? IN_THE_BACKGROUND : `${IN_THE_BACKGROUND} · ${state.what}`
    case 'scheduled':
      return state.dueAt === null ? SCHEDULED : `${SCHEDULED} · ${clockTime(state.dueAt)}`
    case 'waiting-on-a-worker': {
      const [first, ...more] = state.on
      const stopped = state.stopped?.[0]
      // A holder that stopped with the work open is said as stopped, not waited on.
      const lead =
        stopped === undefined
          ? `waiting on ${first}`
          : `${stopped.label} with ${stopped.holder}: stopped at ${clockTime(stopped.at)}`
      return more.length === 0 ? lead : `${lead} +${String(more.length)}`
    }
    case 'idle':
      return 'idle'
  }
}
