import { clockTime } from '../../../shared/clock'
import { unreadSays } from './rows-unread'
import { localFields, localFormat, sameLocalDay } from '../../../shared/local-time'
import { undrivenSentence, type WaitOn } from '../../../shared/tasks'
import type { WorkIncident, WorkIncidentKind } from '../../../shared/work-incidents'
import type { LedgerWalk, PersonsQuestion } from '../../../shared/questions'
import {
  RECOVERY_KINDS,
  type PersonTodo,
  type RecoveryBecause,
  type RecoveryDetail,
} from '../../../shared/work-waits'

/** The presses on a to-do, and its note box's placeholder. */
export const TODO_DONE = 'Done'
export const TODO_CANT = "Can't do it"
export const TODO_NOTE = 'Add a note (optional)'

/** "Ada asks you to do this · W3.1". */
export function todoHead(todo: Pick<PersonTodo, 'askedByName' | 'label'>): string {
  return `${todo.askedByName} asks you to do this${todo.label === null ? '' : ` · ${todo.label}`}`
}

/** What a to-do says once the host took the person's answer. */
export function todoAnsweredSays(askedByName: string, done: boolean): string {
  return done ? `Done. ${askedByName} is told.` : `Sent. ${askedByName} is told you can't do it.`
}

/** The two things a person can do about a piece another conversation gave, or the one for theirs. */
function whatToDo(giverName: string | null, gaveIt: boolean): string {
  if (!gaveIt) return 'Look to see where it stands.'
  return `Look, or take it back for ${giverName ?? 'its giver'} to redo or give again.`
}

const SAID: Readonly<Record<WorkIncidentKind, (one: WorkIncident, now: number) => string>> = {
  'wait-needs-classification': (one) =>
    `${one.label} with ${one.holderName} is marked waiting, but not on anything.`,
  stopped: (one) =>
    one.cause === undefined
      ? `${one.label} with ${one.holderName} stopped.`
      : `${one.label} with ${one.holderName} stopped: ${undrivenSentence(one.cause)}.`,
  'wait-target-ended': (one) =>
    `${one.label} with ${one.holderName} is waiting on something that has ended.`,
  'wait-target-missing': (one) =>
    `${one.label} with ${one.holderName} is waiting on something this app can no longer find.`,
  'notice-not-delivered': (one) =>
    `${one.label} with ${one.holderName} stopped, and the notice to ${one.giverName ?? 'its giver'} did not arrive.`,
  'recovery-pending': (one, now) => {
    const recovery = recoveryOf(one)
    if (recovery === undefined) return `${one.label} with ${one.holderName} picks up again.`
    const when =
      recovery.resumesAt === null
        ? recovery.because === 'app-restart'
          ? ' shortly'
          : ''
        : ` ${whenSaid(recovery.resumesAt, now)}`
    return `${one.label} with ${one.holderName} picks up again${when}, ${UNTIL[recovery.because]}.`
  },
  'recovery-declined': (one) => {
    const recovery = recoveryOf(one)
    return recovery === undefined
      ? `${one.label} with ${one.holderName} was not picked back up.`
      : `${one.label} with ${one.holderName} was not picked back up after ${CUT[recovery.because]}.`
  },
  'recovery-failed': (one) => {
    const recovery = recoveryOf(one)
    return recovery === undefined
      ? `${one.label} with ${one.holderName} could not be picked back up.`
      : `${one.label} with ${one.holderName} could not be picked back up after ${CUT[recovery.because]}.`
  },
}

const dayFormat = localFormat({ weekday: 'short', day: 'numeric', month: 'short' })

/**
 * A time to come on the Mac's clock, with its day where it isn't today: "at 09:00", "tomorrow at
 * 09:00", "on Fri 16 Oct at 09:00".
 */
export function whenSaid(at: number, now: number): string {
  const time = clockTime(at)
  if (time === '') return ''
  if (sameLocalDay(at, now)) return `at ${time}`
  if (isTheDayAfter(at, now)) return `tomorrow at ${time}`
  return `on ${dayFormat(at).replace(',', '')} at ${time}`
}

/**
 * Whether `at` falls on the calendar day after `now`'s, on the Mac's clock. ⚑ Compared as dates,
 * never as now plus 24 hours: a day a clock change shortens or lengthens is 23 or 25 hours long.
 */
function isTheDayAfter(at: number, now: number): boolean {
  const today = localFields(now)
  const next = new Date(Date.UTC(today.year, today.month, today.date + 1))
  const day = localFields(at)
  return (
    day.year === next.getUTCFullYear() &&
    day.month === next.getUTCMonth() &&
    day.date === next.getUTCDate()
  )
}

/** What a pending recovery waits for, after "picks up again …,". */
const UNTIL: Readonly<Record<RecoveryBecause, string>> = {
  'usage-limit': 'once its usage limit resets',
  'sign-in': 'once its sign-in is renewed',
  program: 'once its program has restarted',
  'app-restart': 'after BroCrew restarted',
}

/** What cut the turn, after "was not picked back up after …". */
const CUT: Readonly<Record<RecoveryBecause, string>> = {
  'usage-limit': 'a usage limit',
  'sign-in': 'a sign-in problem',
  program: 'its program stopped',
  'app-restart': 'BroCrew restarted',
}

/** A recovery incident's why and when, where the host says them. */
function recoveryOf(one: WorkIncident): RecoveryDetail | undefined {
  return (one as WorkIncident & { readonly recovery?: RecoveryDetail }).recovery
}

/** Whether Take back is offered: only on a piece a conversation gave, and never while it picks up. */
export function mayTakeBack(one: Pick<WorkIncident, 'giver' | 'kind'>): boolean {
  return one.giver !== null && one.kind !== 'recovery-pending'
}

/** What an incident says: what happened, then what a person can do about it. */
export function incidentSays(one: WorkIncident, now: number): string {
  const said = SAID[one.kind](one, now)
  return one.kind === 'recovery-pending'
    ? said
    : `${said} ${whatToDo(one.giverName, one.giver !== null)}`
}

/** A typed wait, said where its holder read idle; an agent wait by name where the host gives one. */
export function waitOnSays(on: WaitOn, agentName?: string): string {
  switch (on.kind) {
    case 'person':
      return 'waiting on you'
    case 'agent':
      if (agentName !== undefined) return `waiting on ${agentName}`
      return 'label' in on ? `waiting on ${on.label}` : 'waiting on an answer'
    case 'time':
      return `waiting until ${clockTime(on.at)}`
    case 'event':
      return 'job' in on ? 'waiting for a scheduled job' : 'waiting for a background command'
  }
}

/** One to-do as its card draws it. */
export interface TodoRow {
  readonly key: string
  readonly sessionId: string
  readonly askedByName: string
  readonly head: string
  readonly text: string
  readonly files: PersonTodo['files']
}

/** One incident as its entry draws it. */
export interface WorkEntry {
  readonly key: string
  /** The piece's label, which Take back names. */
  readonly label: string
  /** The holder's conversation, where Look goes. */
  readonly sessionId: string
  readonly says: string
  readonly mayTakeBack: boolean
  /** The incident's kind, as a key a test and a style can select on. */
  readonly kind: WorkIncidentKind
}

/** A list, whether its last look answered, and what it could not read. */
export interface ListRead<Row> {
  readonly rows: readonly Row[]
  readonly unread: boolean
  /** The look answered and could not read some rows; `null` when there is nothing to say. */
  readonly short: string | null
}

/** What Waiting on you draws of to-dos, pieces that need a look, and recovery. */
export interface WorkWaitsView {
  readonly todos: ListRead<TodoRow>
  readonly incidents: ListRead<WorkEntry>
  readonly recoveries: ListRead<WorkEntry>
  /** The pieces drawn in either work list: no other band draws them again. */
  readonly shown: ReadonlySet<string>
}

/** The to-dos among a person's question rows: those the host marked as an action. */
export function todosOf(questions: LedgerWalk<PersonsQuestion> | null): PersonTodo[] {
  return (questions?.rows ?? []).flatMap((row) => {
    const action = row.action
    if (action === undefined) return []
    return [
      {
        requestId: row.request.requestId,
        askedBy: row.request.askedBy,
        askedByName: row.reading.hops[0]?.waiting ?? 'An agent',
        label: row.about.is === 'the-asker-named-it' ? row.about.work.label : null,
        text: action.text,
        files: action.files,
        at: row.request.at,
      },
    ]
  })
}

/** The question rows that are questions, the to-dos left out: they are drawn as to-dos. */
export function questionsOnly(
  questions: LedgerWalk<PersonsQuestion> | null,
): LedgerWalk<PersonsQuestion> | null {
  return questions === null
    ? null
    : { ...questions, rows: questions.rows.filter((row) => row.action === undefined) }
}

/** What the host handed for each list, and whether its last look answered. */
export interface WorkWaitsRead {
  readonly todos: readonly PersonTodo[] | null
  readonly incidents: readonly WorkIncident[] | null
  readonly lastLookAnswered: { readonly todos: boolean; readonly incidents: boolean }
  /** What the incidents walk could not read: its rows and its ledgers skipped whole. */
  readonly incidentsShort?: { readonly rowsUnread: number; readonly ledgersSkipped?: number }
}

/** The incident reading, as the screen supplies it beside the questions the to-dos come from. */
export interface IncidentsRead {
  readonly incidents: readonly WorkIncident[] | null
  readonly lastLookAnswered: boolean
  /** What the walk could not read, as `LedgerWalk` counts it. */
  readonly rowsUnread?: number
  readonly ledgersSkipped?: number
}

/**
 * The one derivation. Each piece is drawn once: of several incidents for one piece, a recovery speaks
 * over the rest, and then the newest stands.
 */
export function workWaitsView(read: WorkWaitsRead, now: number): WorkWaitsView {
  const one = new Map<string, WorkIncident>()
  for (const incident of read.incidents ?? []) {
    const kept = one.get(incident.piece)
    const recovers = RECOVERY_KINDS.has(incident.kind)
    const keptRecovers = kept !== undefined && RECOVERY_KINDS.has(kept.kind)
    if (
      kept === undefined ||
      (recovers && !keptRecovers) ||
      (recovers === keptRecovers && incident.since > kept.since)
    ) {
      one.set(incident.piece, incident)
    }
  }
  const entry = (incident: WorkIncident): WorkEntry => ({
    key: incident.piece,
    label: incident.label,
    sessionId: incident.holder,
    says: incidentSays(incident, now),
    mayTakeBack: mayTakeBack(incident),
    kind: incident.kind,
  })
  const all = [...one.values()]
  const unread = !read.lastLookAnswered.incidents
  const short =
    read.incidentsShort === undefined
      ? null
      : unreadSays(read.incidentsShort.rowsUnread, read.incidentsShort.ledgersSkipped)
  return {
    todos: {
      rows: (read.todos ?? []).map((todo) => ({
        key: todo.requestId,
        sessionId: todo.askedBy,
        askedByName: todo.askedByName,
        head: todoHead(todo),
        text: todo.text,
        files: todo.files,
      })),
      unread: !read.lastLookAnswered.todos,
      short: null,
    },
    incidents: { rows: all.filter((i) => !RECOVERY_KINDS.has(i.kind)).map(entry), unread, short },
    // One reading lists both: its hole is said once, over the pieces that need a look.
    recoveries: {
      rows: all.filter((i) => RECOVERY_KINDS.has(i.kind)).map(entry),
      unread: false,
      short: null,
    },
    shown: new Set(one.keys()),
  }
}
