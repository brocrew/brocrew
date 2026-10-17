/**
 * 🔴 **The exec-permission probe's two judgments, lifted out so `ci` can hold them** (`655`, from
 * `649` F7).
 *
 * ⛔ **`495`'s probe claimed *"the only answer it sends is the provider-offered `cancel`, so
 * `/usr/bin/true` is never executed"* — and asserted neither half.** It answered `cancel` before
 * looking at what was offered, and nothing checked that the command did not run.
 *
 *  1. {@link offers} — ⚑ **a decision is sent only if the provider OFFERED it.** The probe reads
 *     the raw `availableDecisions` before answering; if `cancel` is not there it sends nothing, and
 *     the arm is NOT PERFORMED rather than answered with something the provider did not list.
 *  2. {@link executionEvidence} — ⚑ **"did not run" is read off the provider's own record of the
 *     item**, never off an absence. A `commandExecution` item carries execution facts — a
 *     `processId`, an `exitCode`, a `completed` status, output — and `item/commandExecution/outputDelta`
 *     streams what a running command prints. ⛔ **Any one of those means it ran.**
 *
 * ⚠️ **And what makes the negative a measurement:** the probe judges only after the turn has
 * reached its own terminal (`turn/completed`) and a short listen past it, for item reports that
 * trail the terminal. Without that terminal the claim is NOT PERFORMED, never *did not run*
 * (`absence-in-a-capture-is-not-absence`); and the probe also requires the provider's own
 * `declined` for the item it asked about, so it cannot pass on a silence.
 *
 * ⛔ **A fact counts wherever it appears.** Every frame of an item is read, not only the last: a
 * `processId` on `item/started` followed by an `item/completed` that omits it still means it ran.
 *
 * ⛔ **`failed` alone is not execution**: a command the sandbox refused to start, or a turn torn
 * down before it began, can end `failed` with no process and no exit code. `declined` is the
 * provider saying it did not run it.
 */

export interface Frame {
  readonly method: string
  readonly params: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** ⚑ Whether the raw approval request OFFERED this decision. Nothing else may be sent. */
export function offers(params: unknown, decision: string): boolean {
  const offered = isRecord(params) ? params['availableDecisions'] : undefined
  return Array.isArray(offered) && offered.includes(decision)
}

export interface CommandItem {
  readonly id: string
  readonly status: string | null
  readonly processId: string | null
  readonly exitCode: number | null
}

export interface ExecutionEvidence {
  /** Every `commandExecution` item the provider reported, in the last state it reported. */
  readonly items: readonly CommandItem[]
  readonly outputDeltas: number
  /** Each fact that says a command RAN. Empty means the provider reported none. */
  readonly ranBecause: readonly string[]
}

export function executionEvidence(frames: readonly Frame[]): ExecutionEvidence {
  const items = new Map<string, CommandItem>()
  const ranBecause = new Set<string>()
  let outputDeltas = 0
  for (const frame of frames) {
    if (frame.method === 'item/commandExecution/outputDelta') {
      outputDeltas += 1
      continue
    }
    if (frame.method !== 'item/started' && frame.method !== 'item/completed') continue
    const item = isRecord(frame.params) ? frame.params['item'] : undefined
    if (!isRecord(item) || item['type'] !== 'commandExecution') continue
    const id = typeof item['id'] === 'string' ? item['id'] : '(no id)'
    const reported: CommandItem = {
      id,
      status: typeof item['status'] === 'string' ? item['status'] : null,
      processId: typeof item['processId'] === 'string' ? item['processId'] : null,
      exitCode: typeof item['exitCode'] === 'number' ? item['exitCode'] : null,
    }
    items.set(id, reported)
    // ⛔ Every frame's facts, not only the last state's — a later frame cannot erase an earlier one.
    if (reported.status === 'completed') ranBecause.add(`item ${id} status completed`)
    if (reported.processId !== null) ranBecause.add(`item ${id} processId ${reported.processId}`)
    if (reported.exitCode !== null) ranBecause.add(`item ${id} exitCode ${reported.exitCode}`)
  }
  if (outputDeltas > 0) ranBecause.add(`${outputDeltas} item/commandExecution/outputDelta frame(s)`)
  return { items: [...items.values()], outputDeltas, ranBecause: [...ranBecause] }
}
