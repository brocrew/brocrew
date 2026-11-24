import {
  WHAT_IS_OPEN_IS_SAID_AGAIN_AFTER_MS,
  type AHelperInTheTurn,
  type CurrentWorkInTheTurn,
  type ExtraTurnFacts,
} from './what-this-app-adds-to-a-turn'

export const TURN_HELPER_OWNERS = 32
export const TURN_HELPER_PIECES = 256
const TURN_HELPER_LINES = 5

export interface TurnBlockSnapshot {
  readonly peerActivity?: string
  readonly savedMethods?: string
  readonly rotation: number
  readonly personWait: { readonly signature: string; readonly at: number } | null
  readonly hintedTurn: string | null
}

export const EMPTY_TURN_BLOCK: TurnBlockSnapshot = {
  rotation: 0,
  personWait: null,
  hintedTurn: null,
}

export function turnBlockChanges(
  input: {
    readonly peerActivity?: string
    readonly savedMethods?: string
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
    peerActivity?: string
    savedMethods?: string
    helpers?: ExtraTurnFacts['helpers']
    nobodyWaiting?: boolean
    replyQuestion?: boolean
    currentWork: CurrentWorkInTheTurn
  } = { currentWork: input.current }
  if (input.peerActivity !== undefined && input.peerActivity !== before.peerActivity) {
    if (input.peerActivity !== '') extra.peerActivity = input.peerActivity
    else if (before.peerActivity)
      extra.peerActivity = 'There are no other conversations of this profile.'
  }
  if (input.savedMethods !== undefined && input.savedMethods !== before.savedMethods) {
    extra.savedMethods = input.savedMethods
  }
  const order = (left: AHelperInTheTurn, right: AHelperInTheTurn): number =>
    left.givenAt - right.givenAt || left.label.localeCompare(right.label)
  const eligible = [...input.helpers].sort(order)
  const urgent = eligible.filter((row) => row.urgent)
  const allUrgentFit = urgent.length <= TURN_HELPER_LINES
  const fixed = allUrgentFit ? urgent : []
  const rotatable = allUrgentFit ? eligible.filter((row) => !row.urgent) : urgent
  const slots = TURN_HELPER_LINES - fixed.length
  const offset = before.rotation % Math.max(1, rotatable.length)
  const rotating = rotatable.slice(offset).concat(rotatable.slice(0, offset)).slice(0, slots)
  const rows = [...fixed, ...rotating]
  const rotation = rotatable.length > slots ? (offset + rotating.length) % rotatable.length : 0
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
    ...(input.helpersIncomplete ? { incomplete: true } : {}),
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
      peerActivity: input.peerActivity ?? before.peerActivity,
      savedMethods: input.savedMethods ?? before.savedMethods,
      rotation,
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
