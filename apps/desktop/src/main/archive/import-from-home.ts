import type { Provider } from '@brobot2/shared'
import type { ChildDescent } from '../adopt/discover-sessions'
import type { SessionStore } from '../db/session-store'
import { deriveLedger, type ProviderLines } from './derive-ledger'
import type { ResolveImagePath } from './import-codex'

/**
 * Import one conversation found in a provider home: give it a row here, and read its file into a
 * ledger. The file is read where it is, a window at a time, and nothing of it is kept — so what the
 * provider later deletes, this app can show but no longer read again.
 *
 * 🔒 It writes only to our own database. The path is handed in by discovery and opened read-only.
 */

/** One conversation found in a provider home, and what the provider says about it. */
export interface HomeConversation {
  provider: Provider
  /** The provider's own id — Claude's `session_id`, Codex's `thread.id`. */
  sessionId: string
  cwd: string
  /** Absolute path to the provider's own transcript. */
  path: string
  /** When the provider last touched it. */
  updatedAt: number
  /** When the conversation began, as the provider records it. */
  createdAt: number
  /**
   * The profile whose home it was found in, or null for the user's own. Passed straight to
   * `store.adopt`, where null is what makes the row honestly unresumable.
   */
  profileId: string | null
  /**
   * The descent, when the conversation is a child of another one. Recorded on the row, because the
   * row outlives the provider's file and no state database can be asked once the file is gone.
   */
  child?: ChildDescent
}

/** What importing one conversation did. Every ending is named; none of them is silent. */
export type HomeImportOutcome =
  /** Its file was read into a ledger, and it is readable here now. */
  | 'imported'
  /** It already had a ledger here, and nothing was read. */
  | 'up-to-date'
  /** Its file holds no line of conversation. Nothing was promoted. */
  | 'nothing-readable'
  /** The file ends inside a record; the next import can retry. */
  | 'still-writing'
  /** Asked to stop before it finished. Nothing it wrote is read, and nothing was replaced. */
  | 'stopped'
  /** Its file could not be read. */
  | 'unreadable'

/**
 * What an outcome MEANS, in words a person can act on. None of them is phrased as a failure unless
 * it is one: someone told "failed" when the truth is "you already have it" will press it again.
 */
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

/** Everything one import touches, injected — so it runs in a test with no disk. */
export interface HomeImportDeps {
  store: SessionStore
  newSessionId(): string
  /** The provider's lines at a path, a window at a time. */
  lines(path: string): ProviderLines
  /** A checker for this conversation's generated-image claims, or absent. */
  resolveImage?: ResolveImagePath
}

/**
 * Import one conversation. Asked to stop between batches; a stop leaves the row and nothing else.
 *
 * A conversation already here is left as it is: a ledger that is read again is a rebuild, which a
 * person asks for by name.
 */
export async function importFromHome(
  deps: HomeImportDeps,
  source: HomeConversation,
  cancelled: () => boolean,
): Promise<HomeImportOutcome> {
  const known = deps.store.findByProviderRef(source.provider, source.sessionId)
  // ⚠️ **Before the short-circuit.** A row this app already holds can still learn whose child it
  // is, and the clock stays put: `learnDescent`, not `refreshAdopted`.
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
      // Null for the user's own homes: no home of ours holds this, and the store reads that as
      // unresumable with the reason, rather than offering a reopen that would fail.
      profileId: source.profileId,
      // The PROVIDER's times. This conversation existed before we saw it; `adopted_at` is where
      // "when we recorded it" belongs.
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
    // Another writer promoted a ledger first, or one was already there: either way it is here.
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
