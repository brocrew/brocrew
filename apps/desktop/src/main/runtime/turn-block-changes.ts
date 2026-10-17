import {
  WHAT_IS_OPEN_IS_SAID_AGAIN_AFTER_MS,
  TURN_LABEL_POINTS,
  type AHelperInTheTurn,
  type CurrentWorkInTheTurn,
  type ExtraTurnFacts,
} from './what-this-app-adds-to-a-turn'

export const TURN_HELPER_OWNERS = 32
export const TURN_HELPER_PIECES = 256
export const TURN_HELPER_LINES = 5

export interface TurnBlockSnapshot {
  readonly helpers: ReadonlyMap<string, string>
  readonly rotation: number
  readonly current: string | null
  readonly personWait: { readonly signature: string; readonly at: number } | null
  readonly hintedTurn: string | null
  readonly awaitingEnd: ReadonlySet<string>
  readonly at: number | null
}

export const EMPTY_TURN_BLOCK: TurnBlockSnapshot = {
  helpers: new Map(),
  rotation: 0,
  current: null,
  personWait: null,
  hintedTurn: null,
  awaitingEnd: new Set(),
  at: null,
}

export function turnBlockChanges(
  input: {
    readonly now: number
    readonly person: boolean
    readonly helpers: readonly AHelperInTheTurn[] | null
    readonly personWait: string | null
    readonly nobodyWaiting: boolean
    readonly replyQuestionTurn: string | null
    readonly current: CurrentWorkInTheTurn
  },
  before: TurnBlockSnapshot,
): { readonly extra: ExtraTurnFacts; readonly next: TurnBlockSnapshot } {
  const extra: {
    helpers?: ExtraTurnFacts['helpers']
    nobodyWaiting?: boolean
    replyQuestion?: boolean
    currentWork?: CurrentWorkInTheTurn
  } = {}
  const seen = new Map(before.helpers)
  const awaitingEnd = new Set(before.awaitingEnd)
  let rotation = before.rotation
  const helpersReadable =
    input.helpers !== null &&
    input.helpers.every((row) => [...row.label].length <= TURN_LABEL_POINTS)
  if (!helpersReadable || input.helpers === null) {
    extra.helpers = null
    // These rows were read, but none was shown. Keep their endings eligible without acknowledgement.
    for (const row of input.helpers ?? [])
      if (row.open || (before.at !== null && row.givenAt > before.at)) awaitingEnd.add(row.piece)
  } else {
    const present = new Set(input.helpers.map((row) => row.piece))
    for (const id of seen.keys()) if (!present.has(id)) seen.delete(id)
    for (const id of awaitingEnd) if (!present.has(id)) awaitingEnd.delete(id)
    for (const row of input.helpers)
      if (row.open || (before.at !== null && row.givenAt > before.at)) awaitingEnd.add(row.piece)
    const order = (left: AHelperInTheTurn, right: AHelperInTheTurn): number =>
      left.givenAt - right.givenAt || left.label.localeCompare(right.label)
    const urgent = input.helpers.filter((row) => row.open && row.urgent).sort(order)
    const rotated = urgent
      .slice(rotation % Math.max(1, urgent.length))
      .concat(urgent.slice(0, rotation % Math.max(1, urgent.length)))
    const changed = input.helpers
      .filter(
        (row) =>
          !row.urgent &&
          (row.open
            ? seen.get(row.piece) !== row.revision
            : awaitingEnd.has(row.piece) && seen.get(row.piece) !== row.revision),
      )
      .sort(order)
    const eligible = [...rotated, ...changed]
    const rows = eligible.slice(0, TURN_HELPER_LINES)
    for (const row of rows) {
      seen.set(row.piece, row.revision)
      if (!row.open) awaitingEnd.delete(row.piece)
    }
    if (urgent.length > TURN_HELPER_LINES)
      rotation = (rotation + rows.filter((row) => row.urgent).length) % urgent.length
    extra.helpers = {
      rows,
      more: eligible.length - rows.length,
      unchanged: input.helpers.filter((row) => row.open).length,
    }
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
  const current = JSON.stringify(input.current)
  if (input.person || current !== before.current) extra.currentWork = input.current
  return {
    extra,
    next: {
      helpers: seen,
      rotation,
      current,
      awaitingEnd,
      at: helpersReadable ? input.now : before.at,
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
