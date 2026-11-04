import type { PluginHostClient, PluginHostSnapshot } from '../../../shared/plugin-host'

/** A host settings request navigates to the existing plugin settings placeholder. */
export function listenForPluginSettings(
  client: PluginHostClient | undefined,
  open: (view: NonNullable<PluginHostSnapshot['settingsViews']>[number]) => void,
): () => void {
  if (!client) return () => {}
  let alive = true,
    generation = 0
  const shown = new Set<string>()
  const refresh = async () => {
    const own = ++generation
    try {
      const answer = await client.request({ kind: 'snapshot' })
      if (!alive || own !== generation || !('value' in answer)) return
      const snapshot = answer.value as PluginHostSnapshot
      const views = snapshot.settingsViews ?? []
      const current = new Set(views.map((view) => view.viewId))
      for (const id of shown) if (!current.has(id)) shown.delete(id)
      for (const view of views)
        if (!shown.has(view.viewId)) {
          shown.add(view.viewId)
          open(view)
        }
    } catch {
      /* Normal plugin settings remains available after a lost notice. */
    }
  }
  const stop = client.onChanged(() => {
    void refresh()
  })
  void refresh()
  return () => {
    alive = false
    generation++
    stop()
  }
}
