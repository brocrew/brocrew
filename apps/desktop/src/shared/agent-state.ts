import type { AgentState, AgentStateArmFacts, AgentStateFacts, AgentStateName, BackgroundLevel, BackgroundRow, BackgroundWhat, ScheduleLevel, ScheduledRow } from './agent-state-contracts'
import { clockTime } from './clock'
import { hasControlCharacter, hasReorderingCharacter, quotedLiteral } from './runtime-ipc'

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
