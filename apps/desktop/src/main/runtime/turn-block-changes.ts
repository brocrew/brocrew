import type { PromptUpdateBaseline } from '../../shared/human-answer-contracts'
import {
  WHAT_IS_OPEN_IS_SAID_AGAIN_AFTER_MS,
  type AHelperInTheTurn,
  type CurrentWorkInTheTurn,
  type ExtraTurnFacts,
} from './what-this-app-adds-to-a-turn'

export const TURN_HELPER_OWNERS = 32
export const TURN_HELPER_PIECES = 256
const TURN_LIST_LINES = 5
const MEMORY_PREFIX = 'memory:'

export type PromptCollectionPrefix = 'method:' | 'skill:' | `memory:${string}:`

export interface PromptUpdate {
  readonly key: keyof PromptUpdateBaseline
  readonly revision: string
  readonly description: string
  readonly text: string
  readonly at: number
  readonly observed?: boolean
  readonly untimed?: boolean
  readonly empty?: boolean
  readonly group?: boolean
}

export interface TurnBlockSnapshot {
  readonly promptUpdates?: PromptUpdateBaseline
  readonly memoryNudged: boolean
  readonly personWait: { readonly signature: string; readonly at: number } | null
  readonly hintedTurn: string | null
}

export const EMPTY_TURN_BLOCK: TurnBlockSnapshot = {
  memoryNudged: false,
  personWait: null,
  hintedTurn: null,
}

export function turnBlockChanges(
  input: {
    readonly promptUpdates?: readonly PromptUpdate[]
    readonly readCollections?: readonly PromptCollectionPrefix[]
    readonly editableMemoryFolders?: readonly string[]
    readonly now: number
    readonly person: boolean
    readonly helpers: readonly AHelperInTheTurn[]
    readonly helpersIncomplete?: boolean
    readonly personWait: string | null
    readonly nobodyWaiting: boolean
    readonly replyQuestionTurn: string | null
    readonly current: CurrentWorkInTheTurn
  },
  before: TurnBlockSnapshot,
): { readonly extra: ExtraTurnFacts; readonly next: TurnBlockSnapshot } {
  const extra: {
    profileChanges?: readonly string[]
    helpers?: ExtraTurnFacts['helpers']
    nobodyWaiting?: boolean
    replyQuestion?: boolean
    currentWork: CurrentWorkInTheTurn
  } = { currentWork: input.current }
  const promptUpdates = { ...before.promptUpdates }
  let baselineChanged = false
  const profileChanges: string[] = []
  const grouped = new Map<string, string[]>()
  const memoryTitles: string[] = []
  const newMemoryStores: string[] = []
  const updates = input.promptUpdates ?? []
  if (input.readCollections?.length) {
    const present = new Set(updates.map(({ key }) => key))
    for (const key of Object.keys(promptUpdates) as (keyof PromptUpdateBaseline)[]) {
      if (
        input.readCollections.some((prefix) => key !== prefix && key.startsWith(prefix)) &&
        !present.has(key)
      ) {
        delete promptUpdates[key]
        baselineChanged = true
      }
    }
    for (const prefix of input.readCollections) {
      if (prefix === 'method:' || prefix === 'skill:' || promptUpdates[prefix] !== undefined)
        continue
      newMemoryStores.push(prefix)
      promptUpdates[prefix] = 'seen'
      baselineChanged = true
    }
  }
  for (const update of updates) {
    const seen = promptUpdates[update.key]
    if (seen === update.revision || (seen === undefined && update.empty)) continue
    promptUpdates[update.key] = update.revision
    baselineChanged = true
    if (update.key.startsWith(MEMORY_PREFIX)) {
      if (!newMemoryStores.some((prefix) => update.key.startsWith(prefix)))
        memoryTitles.push(update.text)
      continue
    }
    const when = new Date(update.at).toISOString()
    const timing = update.observed ? `observed at ${when}` : `changed at ${when}`
    const heading = `${update.description} (${timing}).`
    if (update.group) {
      const lines = grouped.get(heading)
      if (lines === undefined) grouped.set(heading, [update.text])
      else lines.push(update.text)
    } else profileChanges.push(update.untimed ? update.text : `${heading}\n\n${update.text}`)
  }
  for (const [heading, lines] of grouped) profileChanges.push(`${heading}\n\n${lines.join('\n')}`)
  if (memoryTitles.length > 0) {
    const titles = memoryTitles.slice(0, TURN_LIST_LINES).join(', ')
    const more = memoryTitles.length - TURN_LIST_LINES
    profileChanges.push(
      `Memory changed (observed at ${new Date(input.now).toISOString()}): ${titles}${more > 0 ? ` and ${more} more` : ''}.`,
    )
  }
  const memoryFolders = input.editableMemoryFolders ?? []
  const nudgeMemory = memoryFolders.length > 0 && (memoryTitles.length > 0 || !before.memoryNudged)
  if (nudgeMemory) {
    const locations = memoryFolders.map((folder) => `\`${folder}\``).join(', ')
    profileChanges.push(`Fix or remove outdated memory in ${locations}.`)
  }
  if (profileChanges.length > 0) extra.profileChanges = profileChanges
  const order = (left: AHelperInTheTurn, right: AHelperInTheTurn): number =>
    Number(right.urgent) - Number(left.urgent) ||
    (left.changedAt ?? Infinity) - (right.changedAt ?? Infinity) ||
    left.givenAt - right.givenAt ||
    left.label.localeCompare(right.label)
  const eligible = input.helpers.filter((row) => row.state !== null).sort(order)
  const rows = eligible.slice(0, TURN_LIST_LINES)
  const latestFailure = new Map<string, number>()
  for (const row of rows) {
    const failure = row.providerTurnFailure
    if (failure !== undefined) {
      const latest = latestFailure.get(row.owner)
      if (latest === undefined || failure.turnOrdinal > latest)
        latestFailure.set(row.owner, failure.turnOrdinal)
    }
  }
  const diagnosed = new Set<string>()
  extra.helpers = {
    rows: rows.map((row) => {
      const { providerTurnFailure, ...ordinary } = row
      if (providerTurnFailure === undefined) return row
      if (
        providerTurnFailure.turnOrdinal !== latestFailure.get(row.owner) ||
        diagnosed.has(row.owner)
      )
        return ordinary
      diagnosed.add(row.owner)
      return row
    }),
    more: eligible.length - rows.length,
    ...(input.helpersIncomplete || eligible.length !== input.helpers.length
      ? { incomplete: true }
      : {}),
  }
  const due =
    input.person ||
    before.personWait === null ||
    input.personWait !== before.personWait.signature ||
    (input.personWait !== '[]' &&
      input.now - before.personWait.at > WHAT_IS_OPEN_IS_SAID_AGAIN_AFTER_MS)
  if (input.personWait !== null && input.nobodyWaiting && due) extra.nobodyWaiting = true
  const hint =
    input.nobodyWaiting &&
    input.replyQuestionTurn !== null &&
    input.replyQuestionTurn !== before.hintedTurn
  if (hint) extra.replyQuestion = true
  return {
    extra,
    next: {
      promptUpdates: baselineChanged ? promptUpdates : before.promptUpdates,
      memoryNudged: before.memoryNudged || nudgeMemory,
      personWait:
        input.personWait === null
          ? before.personWait
          : due
            ? { signature: input.personWait, at: input.now }
            : before.personWait,
      hintedTurn: hint ? input.replyQuestionTurn : before.hintedTurn,
    },
  }
}
