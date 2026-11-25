import { ref, shallowRef } from 'vue'
import type { ClientSessionApi } from '../../../shared/client-session-api'
import type {
  ExportedSession,
  ImportedRecording,
  ResumableSessionInfo,
  UnresumableSessionInfo,
} from '../../../shared/runtime-ipc'
import { appClosing } from '../lib/app-closing'
import { readableError } from '../lib/session-record'

export function useRecordedLibraryActions(
  readSessions: () => ClientSessionApi | undefined,
  refreshLibrary: () => Promise<void>,
) {
  const recordings = shallowRef(new Map<string, ResumableSessionInfo>())
  const unavailable = shallowRef(new Map<string, UnresumableSessionInfo>())
  const error = ref<string | null>(null)
  const exports = ref<Record<string, ExportedSession | string>>({})
  const exporting = ref<Record<string, boolean>>({})
  const imports = ref<Record<string, ImportedRecording | string>>({})
  const importing = ref<Record<string, boolean>>({})
  let issued = 0

  // The Library owns membership and search. Recorded details supply actions and provenance.
  async function refresh(): Promise<void> {
    if (appClosing.value) return
    const mine = ++issued
    try {
      const sessions = readSessions()
      if (!sessions?.listResumable) return
      const [list, closed] = await Promise.all([
        sessions.listResumable(),
        sessions.listUnresumable?.() ?? [],
      ])
      if (mine !== issued) return
      recordings.value = new Map(list.map((recording) => [recording.sessionId, recording]))
      unavailable.value = new Map(closed.map((recording) => [recording.sessionId, recording]))
      error.value = null
    } catch (cause) {
      if (mine === issued) error.value = readableError(cause)
    }
  }

  async function exportSession(sessionId: string, exportKind: 'native' | 'bundle'): Promise<void> {
    if (exporting.value[sessionId]) return
    exporting.value[sessionId] = true
    try {
      const sessions = readSessions()
      if (!sessions?.exportSession)
        throw new Error('Session export is not available in this window.')
      exports.value[sessionId] = await sessions.exportSession({ sessionId, exportKind })
    } catch (cause) {
      exports.value[sessionId] = readableError(cause)
    } finally {
      exporting.value[sessionId] = false
    }
  }

  async function importMessages(sessionId: string): Promise<void> {
    if (importing.value[sessionId]) return
    importing.value[sessionId] = true
    try {
      const sessions = readSessions()
      if (!sessions?.importRecordedSession) {
        throw new Error('Importing recorded messages is not available in this window.')
      }
      const result = await sessions.importRecordedSession({ sessionId })
      imports.value[sessionId] = result
      if (result.readable) await refreshLibrary()
    } catch (cause) {
      imports.value[sessionId] = readableError(cause)
    } finally {
      importing.value[sessionId] = false
    }
  }

  return {
    recordings,
    unavailable,
    error,
    exports,
    exporting,
    imports,
    importing,
    refresh,
    exportSession,
    importMessages,
  }
}
