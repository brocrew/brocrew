import { screenFacts } from '../../src/renderer/src/composables/useWhoCalledWhom'
import type { WorkEdge } from '../../src/shared/who-called-whom'
import { META } from './harness'

const walk = <Row>(rows: Row[], kind: string) =>
  ({ rows, walk: kind, ledgers: rows.length, rowsUnread: 0 }) as never

/**
 * Gives the cast an answered reading of the conversation on screen: no children, the work it gave
 * and the work it was given, read at `at`, and nothing at work.
 */
export function castTheWork(work: { gave?: WorkEdge[]; took?: WorkEdge[]; at: number }): void {
  const read = {
    conversation: META.sessionId,
    parent: null,
    children: walk([], 'every-conversation-this-one-spawned'),
    workGivenOut: walk(work.gave ?? [], 'every-conversation-this-one-gave-work-to'),
    workTakenIn: walk(work.took ?? [], 'every-piece-of-work-this-one-was-given'),
    readAt: work.at,
  }
  screenFacts().update({
    reading: { conversation: META.sessionId, read, answered: true, atWork: null },
  })
}
