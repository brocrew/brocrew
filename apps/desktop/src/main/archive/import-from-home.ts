import type { Provider } from '@brobot2/shared'
import type { ChildDescent } from '../adopt/discover-sessions'
import type { SessionStore } from '../db/session-store'
import { deriveLedger, type ProviderLines } from './derive-ledger'
import type { ResolveImagePath } from './transcript-types'

export interface HomeConversation {
  provider: Provider

  sessionId: string
  cwd: string

  path: string

  updatedAt: number

  createdAt: number

  profileId: string | null

  child?: ChildDescent
}

export type HomeImportOutcome =
  'imported' | 'up-to-date' | 'nothing-readable' | 'still-writing' | 'stopped' | 'unreadable'

export function describeOutcome(outcome: HomeImportOutcome): string {
  return {
    imported: 'Imported — its conversation is readable here now.',
    'up-to-date': 'Already imported.',
    'nothing-readable': 'Its file holds no readable conversation.',
    'still-writing':
      'Its file is still being written. Try importing it again when it has finished.',
    stopped: 'Stopped before it finished. Nothing was changed; try again.',
    unreadable: 'Its transcript could not be read.',
  }[outcome]
}

export interface HomeImportDeps {
  store: SessionStore
  newSessionId(): string

  lines(path: string): ProviderLines

  resolveImage?: ResolveImagePath
}

export async function importFromHome(
  deps: HomeImportDeps,
  source: HomeConversation,
  cancelled: () => boolean,
): Promise<HomeImportOutcome> {
  const known = deps.store.findByProviderRef(source.provider, source.sessionId)

  // Existing ledgers can still learn their parent without being rebuilt.
  if (known !== null) deps.store.learnDescent(known, source.child)
  if (known !== null && deps.store.ledgerStatus(known).present) return 'up-to-date'
  if (cancelled()) return 'stopped'

  let sessionId = known
  if (sessionId === null) {
    sessionId = deps.newSessionId()
    deps.store.adopt({
      id: sessionId,
      provider: source.provider,
      sessionId: source.sessionId,
      cwd: source.cwd,

      profileId: source.profileId,

      updatedAt: source.updatedAt,
      createdAt: source.createdAt,
      ...(source.child ? { child: source.child } : {}),
    })
  }

  const outcome = await deriveLedger(
    deps.store,
    sessionId,
    source.provider,
    deps.lines(source.path),
    {
      // Only if the file names no time at all does the conversation's own recorded start stand in.
      fallbackAt: source.createdAt,
      cancelled,
      rebuild: false,
      ...(deps.resolveImage ? { resolveImage: deps.resolveImage } : {}),
    },
  )
  switch (outcome) {
    case 'imported':
      return 'imported'

    case 'skipped':
    case 'superseded':
      return 'up-to-date'
    case 'nothing-readable':
      return 'nothing-readable'
    case 'still-writing':
      return 'still-writing'
    case 'stopped':
      return 'stopped'
    case 'failed':
      return 'unreadable'
  }
}
