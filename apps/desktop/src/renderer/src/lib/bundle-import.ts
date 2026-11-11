import { ref, watch } from 'vue'
import type { ClientApi } from '../../../shared/client-api'
import type { ImportedBundle } from '../../../shared/runtime-ipc'
import { readableError } from './session-record'

export function useBundleImport(client: Pick<ClientApi, 'sessions'>, load: () => Promise<void>) {
  const bundlePath = ref('')
  const restoring = ref(false)
  /** The last attempt's answer, verbatim from the host — never composed here (086). */
  const restored = ref<ImportedBundle | null>(null)

  /**
   * ⛔ **A verdict belongs to the path it was about** (214 §1, review). `restored` outlived the field,
   * so *"Restored 412 entries"* stayed on screen — as `role=status`, announced — underneath a
   * different path that had never been restored. The watcher is what ties the sentence to its subject;
   * clearing it inside the handlers alone could not, because the field changes without one.
   */
  watch(bundlePath, () => {
    restored.value = null
  })

  /**
   * ⛔ **Restore, then RE-READ the list** — for the same reason `checkHomes` does: what landed is the
   * store's to report. A surface that added its own row would be describing a conversation from the
   * file it just read instead of from the database that now holds it, and those are free to differ.
   */
  async function restoreBundle(): Promise<void> {
    const path = bundlePath.value.trim()
    if (path === '' || restoring.value) return
    restoring.value = true
    restored.value = null
    try {
      const sessions = client.sessions
      const importBundleFile = sessions?.importBundleFile
      if (!sessions || !importBundleFile) throw new Error('Session library is unavailable')
      const result = await importBundleFile.call(sessions, { path })
      restored.value = result
      // Only on success: a refusal changed nothing, and re-reading two thousand rows to prove it
      // would be work with no answer in it.
      if (result.ok) await load()
    } catch (error) {
      // The command itself failed — a store error, not a file the person chose. Said in the same
      // place as every other outcome, so there is no path where the button appears to do nothing.
      restored.value = { ok: false, reason: readableError(error) }
    } finally {
      restoring.value = false
    }
  }

  return { bundlePath, restoring, restored, restoreBundle }
}
