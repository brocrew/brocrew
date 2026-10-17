import type { AgentIdentity, ResumableSessionInfo } from '../../src/shared/runtime-ipc'
import type { LedgerWalk, LedgerWalkKind } from '../../src/shared/questions'
import type { SpawnEdge, WhoCalledWhom, WorkEdge } from '../../src/shared/who-called-whom'
import type { CastReading } from '../../src/renderer/src/lib/working-together'
import { identities, workerRows, NOW } from './parallel-workers-fixture'

export { NOW }
export const OWNER = 'ada-owner'
export const PROFILE = 'document-analyst'
export const PROFILE_ID = 'aid:document-analyst'
export const IDS = [OWNER, 'ada-worker-2', 'ada-worker-3', 'ada-worker-4'] as const
export const TITLES = [
  'Plan the meal',
  'Read the menu',
  'Check the recipe',
  'Compare the shopping list',
] as const

export function panelRows(): ResumableSessionInfo[] {
  return workerRows(4).map((row, index) => ({
    ...row,
    sessionId: IDS[index]!,
    profileId: PROFILE,
    worker: {
      identity: PROFILE_ID,
      giver: index === 0 ? 'fictional-parent' : OWNER,
      number: index + 1,
      bornAs: IDS[index]!,
    },
    named: { label: `W90.${index + 1}`, title: TITLES[index]! },
  }))
}

export function panelIdentities(): AgentIdentity[] {
  return [{ ...identities().identities[0]!, id: PROFILE_ID, slug: PROFILE, displayName: 'Ada' }]
}

const walk = <T>(rows: readonly T[], kind: LedgerWalkKind): LedgerWalk<T> => ({
  rows,
  walk: kind,
  ledgers: rows.length,
  rowsUnread: 0,
})

export function panelWork(): WorkEdge[] {
  return IDS.map((to, index) => ({
    piece: `fictional-piece-${index + 1}`,
    label: `W90.${index + 1}`,
    title: TITLES[index]!,
    from: OWNER,
    fromIdentity: PROFILE,
    to,
    toIdentity: PROFILE,
    state: 'working',
    givenAt: NOW - 120_000,
    endedAt: null,
  }))
}

export function panelReading(work = panelWork()): CastReading {
  const read: WhoCalledWhom = {
    conversation: OWNER,
    parent: null,
    children: walk<SpawnEdge>(
      IDS.slice(1).map((conversation) => ({
        conversation,
        identity: PROFILE,
        provider: 'codex',
        running: 'unwatched',
      })),
      'every-conversation-this-one-spawned',
    ),
    workGivenOut: walk(work, 'every-conversation-this-one-gave-work-to'),
    workTakenIn: walk<WorkEdge>([], 'every-piece-of-work-this-one-was-given'),
    readAt: NOW,
  }
  return { conversation: OWNER, read, answered: true, atWork: null }
}
