import type { PersonsQueue } from '../../src/shared/persons-published'

const readers = {
  questions: 'questionsForAPerson',
  decisions: 'decisionsForAPerson',
  stalled: 'stalledWorkForAPerson',
  stopped: 'stoppedWorkForAPerson',
  waitingOnWhoWrote: 'waitingOnWhoWroteForAPerson',
  incidents: 'workIncidentsForAPerson',
  instructionAsks: 'instructionAsksForAPerson',
  mcpServerRequests: 'mcpServerRequestsForAPerson',
} as const
let sequence = 0

/** The combined publication, backed by the fixture's mutable and deferred readers. */
export async function combinedPersonsQueue(
  source: Record<(typeof readers)[keyof typeof readers], () => Promise<unknown>>,
): Promise<PersonsQueue> {
  const parts = Object.fromEntries(
    await Promise.all(
      Object.entries(readers).map(async ([part, reader]) => {
        const value = await source[reader]()
        return [
          part,
          part === 'instructionAsks' || part === 'mcpServerRequests'
            ? value === null
              ? null
              : { rows: value, rowsUnread: 0 }
            : value,
        ]
      }),
    ),
  )
  const covers = Object.fromEntries(
    Object.entries(parts).map(([part, value]) => {
      const complete =
        value !== null &&
        typeof value === 'object' &&
        'rowsUnread' in value &&
        value.rowsUnread === 0
      return [
        part,
        { population: 'persons', scope: part, complete, ...(complete ? {} : { ids: [] }) },
      ]
    }),
  )
  return {
    ...parts,
    published: { epoch: { run: 'fixture-queue', n: 0 }, seq: ++sequence, covers },
  } as unknown as PersonsQueue
}
