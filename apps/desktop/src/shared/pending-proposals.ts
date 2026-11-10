/**
 * The proposals still waiting on a person, from a ledger's proposed and settled rows, oldest first.
 * A proposal waits until a settled row names its id. A rebuilt ledger replays the same id, so
 * proposals are keyed by id and a duplicate collapses into the later row. Imports nothing, so the
 * renderer can use it.
 */
export function pendingProposals<Proposed, Settled, Pending extends { readonly at: number }>(
  rows: readonly {
    readonly conversation: string
    readonly at: number
    readonly event: Proposed | Settled
  }[],
  fold: {
    readonly settled: (event: Proposed | Settled) => event is Settled
    readonly id: (event: Proposed | Settled) => string
    readonly pending: (event: Proposed, conversation: string, at: number) => Pending
  },
): readonly Pending[] {
  const open = new Map<string, { readonly id: string; readonly pending: Pending }>()
  const ended = new Set<string>()
  for (const row of rows) {
    const id = fold.id(row.event)
    if (fold.settled(row.event)) {
      ended.add(id)
      continue
    }
    open.set(id, { id, pending: fold.pending(row.event, row.conversation, row.at) })
  }
  return [...open.values()]
    .filter((one) => !ended.has(one.id))
    .map((one) => one.pending)
    .sort((a, b) => a.at - b.at)
}
