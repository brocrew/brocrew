import type {
  LibraryEntry,
  LibraryPage,
  ResumableSessionInfo,
  UnresumableSessionInfo,
} from '../../src/shared/runtime-ipc'
import { entry, page } from './library-filter-fixture'

function recordingEntry(row: ResumableSessionInfo | UnresumableSessionInfo): LibraryEntry {
  const closed = 'reason' in row
  const origin =
    closed && row.restoredFromBundle
      ? 'restored'
      : closed && row.foundInUserHome
        ? 'user-home'
        : 'ours'
  return entry({
    id: row.sessionId,
    recordId: row.sessionId,
    provider: row.provider,
    providerSessionId: closed ? null : row.ref.sessionId,
    cwd: row.cwd,
    title: '',
    preview: '',
    bytes: null,
    origin,
    onDisk: origin === 'user-home',
    readable: row.hasTranscript,
    lastEnding: row.lastEnding,
    child: closed ? null : row.child,
    unresumableReason: closed ? row.reason : row.resumeRefusal,
    updatedAt: row.updatedAt,
    profileId: origin === 'ours' ? (row.profileId ?? 'default') : undefined,
  })
}

export function recordingPage(
  rows: readonly (ResumableSessionInfo | UnresumableSessionInfo)[],
): LibraryPage {
  return page({
    entries: rows.map(recordingEntry),
    matched: rows.length,
    counts: { ...page().counts, total: rows.length },
  })
}
