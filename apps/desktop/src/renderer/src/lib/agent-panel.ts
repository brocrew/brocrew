import type { AgentState as OneState } from '../../../shared/agent-state'
import { agentStateWords } from '../../../shared/agent-state'
import type { WorkThatNamesIt } from '../../../shared/piece-called'
import type {
  AgentIdentity,
  ContextReading,
  CreatedSession,
  KeptFile,
} from '../../../shared/runtime-ipc'
import type { TheWholeForest } from '../../../shared/the-whole-forest'
import type { LastReported, ReportedFrom } from '../../../shared/who-called-whom'
import { clockTimeFrom } from '../../../shared/clock'
import type { AgentFacets, RailSays } from './agent-state'
import { agoWords } from './clock'
import { formatTokens, groupTokens, percentText } from './context-meter'
import { latestWords } from './latest-words'
import { FOR_A_PERSON } from './outgoing-card'
import { basenameOf } from './paths'
import { processMemoryWords } from './process-memory'
import type { TranscriptState } from './transcript'
import {
  inTheirPlace,
  workingTogetherView,
  type CastReading,
  type CastTask,
} from './working-together'

/**
 * Fold the agent panel's facts and actions from reads the window already owns: transcript, cast, forest, rail and memory. This data layer adds no styling or independent polling timer.
 *
 * ⚑ A fact this window does not hold is `{ value: null, why }` — a plain sentence for an empty
 * state, never a zero.
 */

/** A fact, or why it is not here. */
export type Fact<T> =
  { readonly value: T; readonly why?: undefined } | { readonly value: null; readonly why: string }

const known = <T>(value: T): Fact<T> => ({ value })

/** Why a conversation whose process was looked for has no memory figure. */
export const NOT_RUNNING_NOW = 'Not running now.'
/** Why a conversation that is working has none: its process has not been measured yet. */
export const NOT_MEASURED_YET = 'Not measured yet.'
/** The short word where a memory figure could not be measured. */
export const NOT_MEASURED = 'not measured'
const missing = (why: string): Fact<never> => ({ value: null, why })

export interface AgentPanelInput {
  readonly conversation: string | null
  /** The conversation's session — its folder and its settings. */
  readonly session: CreatedSession | null
  /** Its transcript fold — the latest words, the context reading, the briefs. */
  readonly state: TranscriptState
  readonly who: string
  readonly profile: string | null
  readonly facets: AgentFacets
  readonly agentState: OneState | null
  /** The work that names it — its root, where a person gave it one. */
  readonly named: WorkThatNamesIt | null
  readonly cast: CastReading | null
  readonly identities: readonly AgentIdentity[] | null
  readonly forest: TheWholeForest | null
  readonly railSays: ReadonlyMap<string, RailSays> | null
  readonly processMemory: ReadonlyMap<string, number>
  /** Main's sentence where no process could be measured at all, else null. */
  readonly memoryUnmeasured: string | null
  readonly files: readonly KeptFile[] | null
  /** The files filter's text — a name or a piece label. */
  readonly fileFilter: string
  /** How many file tiles the card shows before "+N more". */
  readonly fileTiles: number
  readonly now: number
}

export interface AgentPanelTask {
  readonly piece: string
  readonly label: string
  readonly title: string
  /** Its state in the window's words — *being worked on*, *answered*, *replied*. */
  readonly word: string
  readonly status: 'active' | 'open' | 'closed'
  /** Who gave it — *for you* where a person did. */
  readonly from: string
  readonly brief: string | null
}

export interface AgentPanelSubAgent {
  readonly conversation: string
  readonly name: string
  readonly profile: string | null
  readonly facets: AgentFacets
  /** Its state in its rail row's words; *replaced by …* for a replaced one (F094). */
  readonly word: string | null
  readonly active: boolean
  readonly model: Fact<string>
  readonly effort: Fact<string>
  readonly context: Fact<string>
  readonly memory: Fact<string>
  /**
   * ⚑ **W4.203 · where each figure came from**, for its title: *last ran*, *set to*, *asked for*,
   * *from its transcript*, *now*, or the time of a last reading. Absent where there is none.
   */
  readonly from: { readonly model?: string; readonly effort?: string; readonly context?: string }
}

export interface AgentPanel {
  readonly header: {
    readonly name: string
    readonly profile: string | null
    readonly facets: AgentFacets
    /** Its one state, in the rail's words (`agentStateWords`), or null before the host has said. */
    readonly status: string | null
  }
  readonly workspace: {
    /** The folder it works in, or why not. */
    readonly path: Fact<string>
    /** The folder's own name, for the menu's label. */
    readonly name: string | null
  }
  /** Its latest words: one paragraph, when and how long ago, and the transcript item to go to. */
  readonly latest: {
    readonly text: string
    readonly at: number | null
    readonly ago: string | null
    readonly itemId: string
  } | null
  readonly run: {
    readonly model: Fact<string>
    readonly effort: Fact<string>
    /** How full its context is — `910k`, or `42%` where the window size is known. */
    readonly context: Fact<string>
    readonly memory: Fact<string>
  }
  /** The piece it works on now — the newest open one it was given, else the root a person gave. */
  readonly currentTask: AgentPanelTask | null
  readonly taskCounts: {
    readonly active: number
    readonly open: number
    readonly closed: number
    readonly all: number
  }
  /** Every piece it was given, oldest first — the task-history dialog. */
  readonly tasks: readonly AgentPanelTask[]
  readonly files: {
    readonly total: number
    /** Every file the filter keeps, newest first — the files dialog. */
    readonly matching: readonly KeptFile[]
    /** The first tiles of `matching`. */
    readonly tiles: readonly KeptFile[]
    /** How many `matching` holds beyond the tiles — "+N more". */
    readonly more: number
    /** Why there are none, or null. */
    readonly why: string | null
  }
  readonly subAgents: {
    readonly cards: readonly AgentPanelSubAgent[]
    readonly active: number
    readonly idle: number
    /** Why there are none, or null. */
    readonly why: string | null
  }
}

const ACTIVE_DOINGS: ReadonlySet<string> = new Set([
  'working',
  'thinking',
  'tool',
  'compacting',
  'replying',
])

/** ⚑ A context reading in the run strip's words — `910k`, or `42% · 383,200 tokens`. */
function contextOf(reading: ContextReading | null, why: string): Fact<string> {
  if (reading === null || reading.kind === 'unknown') return missing(why)
  if (reading.kind === 'tokens') return known(formatTokens(reading.used))
  return known(`${percentText(reading) ?? '—'}% · ${groupTokens(reading.used)} tokens`)
}

// ⚑ Partial, so a source this window has no word for says nothing rather than failing the build.
const MODEL_FROM: Readonly<Partial<Record<ReportedFrom, string>>> = {
  'its-provider': 'last ran',
  'its-setting': 'set to',
}
const EFFORT_FROM: Readonly<Partial<Record<ReportedFrom, string>>> = {
  'its-provider': 'last ran',
  'its-setting': 'asked for',
}
const NOT_RECORDED = 'Not recorded.'

/** ⚑ W4.203 · a sub-agent's model, effort and context: live while it runs, else its last report. */
function childFigures(
  rail: RailSays | undefined,
  last: LastReported | null,
  live: ContextReading | null,
  now: number,
): Pick<AgentPanelSubAgent, 'model' | 'effort' | 'context' | 'from'> {
  const model = last?.model ?? rail?.model ?? null
  const effort = last?.effort ?? rail?.effort ?? null
  const from: { model?: string; effort?: string; context?: string } = {}
  const modelFrom = last?.modelFrom ? MODEL_FROM[last.modelFrom] : undefined
  const effortFrom = last?.effortFrom ? EFFORT_FROM[last.effortFrom] : undefined
  if (modelFrom) from.model = modelFrom
  if (effortFrom) from.effort = effortFrom
  let context: Fact<string>
  if (live !== null && live.kind !== 'unknown') {
    context = known(formatTokens(live.used))
    from.context = 'now'
  } else if (last?.context && last.context.reading.kind !== 'unknown') {
    context = known(
      `${formatTokens(last.context.reading.used)} · ${clockTimeFrom(last.context.at, now)}`,
    )
    from.context = `last reported at ${clockTimeFrom(last.context.at, now)}`
  } else context = missing(NOT_RECORDED)
  return {
    model: model === null ? missing(NOT_RECORDED) : known(model),
    effort: effort === null ? missing(NOT_RECORDED) : known(effort),
    context,
    from,
  }
}

/** ⚑ The panel, folded from what the window already holds. Pure: no read, no timer. */
export function agentPanel(input: AgentPanelInput): AgentPanel {
  const band = workingTogetherView({
    reading: input.cast,
    forConversation: input.conversation ?? '',
    identities: input.identities,
    now: input.now,
  })

  /* the header and the folder */
  const cwd = input.session?.cwd ?? null
  const latest = latestWords(input.state)

  /* the run strip */
  const settings = input.session?.settings
  const reported = settings?.reported
  const model = reported?.model ?? settings?.model ?? null
  const effort = reported?.effort ?? settings?.reasoningEffort ?? null
  const context = contextOf(
    input.state.meter.reading,
    'Not reported yet: the provider says it with its next turn.',
  )
  /* ⚑ Each child's latest context reading rides on the poll the window already makes (F093 §4). */
  const childContext = new Map(
    (input.cast?.atWork?.conversations ?? []).map((one) => [one.conversation, one.context]),
  )
  const bytes =
    input.conversation === null ? undefined : input.processMemory.get(input.conversation)

  /* the tasks */
  const briefs = briefsOf(input.state)
  const tasks = (band?.taken ?? []).map((one) => taskOf(one, briefs))
  const openTasks = tasks.filter((one) => one.status !== 'closed')
  const root = input.named
  const rootTask: AgentPanelTask | null =
    root === null
      ? null
      : {
          piece: root.label,
          label: root.label,
          title: root.title ?? '',
          word: 'open',
          status: 'open',
          from: FOR_A_PERSON,
          brief: briefs.get(root.label) ?? null,
        }

  /* the files */
  const allFiles = [...(input.files ?? [])].sort((a, b) => b.keptAt - a.keptAt)
  const filter = input.fileFilter.trim().toLowerCase()
  const matching =
    filter === ''
      ? allFiles
      : allFiles.filter(
          (file) =>
            file.name.toLowerCase().includes(filter) ||
            file.title.toLowerCase().includes(filter) ||
            file.label.toLowerCase().includes(filter),
        )

  /* the sub agents */
  const cards = band
    ? inTheirPlace([...band.children, ...band.others], input.forest, input.identities).map(
        (card): AgentPanelSubAgent => {
          const rail = input.railSays?.get(card.conversation)
          const facets = rail?.facets ?? card.facets
          const childBytes = input.processMemory.get(card.conversation)
          const active = card.replacedBy === undefined && ACTIVE_DOINGS.has(facets.doing ?? '')
          return {
            conversation: card.conversation,
            name: card.name,
            profile: card.identity,
            facets,
            word:
              card.replacedBy !== undefined
                ? `replaced by ${card.replacedBy}`
                : (rail?.word ?? null),
            active,
            // ⚑ **W4.203 · what it last reported**, idle or ended alike (Esme's `lastReported`); the
            // live reading wins while it runs. ⛔ "Not recorded." only where the record has none.
            ...childFigures(
              rail,
              input.cast?.read.lastReported?.[card.conversation] ?? null,
              childContext.get(card.conversation) ?? null,
              input.now,
            ),
            memory:
              childBytes === undefined
                ? // A working conversation with no figure is between its start and its process.
                  missing(input.memoryUnmeasured ?? (active ? NOT_MEASURED_YET : NOT_RUNNING_NOW))
                : known(processMemoryWords(childBytes)),
          }
        },
      )
    : []

  return {
    header: {
      name: input.who,
      profile: input.profile,
      facets: input.facets,
      status: input.agentState === null ? null : agentStateWords(input.agentState),
    },
    workspace: {
      path:
        cwd === null ? missing('This conversation has not said where it works yet.') : known(cwd),
      name: cwd === null ? null : basenameOf(cwd) || cwd,
    },
    latest:
      latest === null
        ? null
        : {
            text: latest.text,
            at: latest.at,
            ago: latest.at == null ? null : agoWords(latest.at, input.now),
            itemId: latest.itemId,
          },
    run: {
      model: model === null ? missing('Not named yet.') : known(model),
      effort: effort === null ? missing('Not named for this model.') : known(effort),
      context,
      memory:
        bytes === undefined
          ? missing(input.memoryUnmeasured ?? NOT_RUNNING_NOW)
          : known(processMemoryWords(bytes)),
    },
    currentTask: openTasks.at(-1) ?? rootTask,
    taskCounts: {
      active: tasks.filter((one) => one.status === 'active').length,
      open: tasks.filter((one) => one.status === 'open').length,
      closed: tasks.filter((one) => one.status === 'closed').length,
      all: tasks.length,
    },
    tasks,
    files: {
      total: allFiles.length,
      matching,
      tiles: matching.slice(0, input.fileTiles),
      more: Math.max(0, matching.length - input.fileTiles),
      why:
        input.files === null
          ? 'Not read yet.'
          : allFiles.length === 0
            ? 'No files yet: a file appears here when this agent keeps one.'
            : matching.length === 0
              ? 'No file matches that.'
              : null,
    },
    subAgents: {
      cards,
      active: cards.filter((one) => one.active).length,
      idle: cards.filter((one) => !one.active).length,
      why:
        band === null
          ? 'Not read yet.'
          : cards.length === 0
            ? (band.childrenEmpty ?? 'No sub agents yet.')
            : null,
    },
  }
}

/** ⚑ Each piece's brief, by its label — the relayed message that opened it (`AgentCard`'s rule). */
function briefsOf(state: TranscriptState): ReadonlyMap<string, string> {
  const found = new Map<string, string>()
  for (const item of state.items) {
    if (item.kind !== 'relayed') continue
    const label = item.opened?.label
    if (label !== undefined && item.text.trim() !== '') found.set(label, item.text.trim())
  }
  return found
}

function taskOf(one: CastTask, briefs: ReadonlyMap<string, string>): AgentPanelTask {
  const { piece } = one
  return {
    piece: piece.piece,
    label: piece.reading.heading,
    title: piece.said,
    word: piece.reading.word,
    status: !piece.open ? 'closed' : piece.state === 'working' ? 'active' : 'open',
    from: one.toName,
    brief: briefs.get(piece.reading.heading) ?? null,
  }
}
