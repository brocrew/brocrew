import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { PluginHostUiRequest } from './host-wire'
import { PLUGIN_HOST_CHANNEL, PLUGIN_HOST_CHANGED } from '../../shared/plugin-host-channels'
import type { PluginHostResult } from '../../shared/plugin-contract'
import type { PluginHostUiRequest as UiRequest } from '../../shared/plugin-host'

/** The app window supplies its workspace; plugin pages never select an app IPC operation. */
export interface PluginHostUi {
  request(workspaceId: string, input: UiRequest): Promise<PluginHostResult<unknown>>
  onChanged(listener: (workspaceId: string) => void): () => void
}
export function registerPluginHostIpc(
  ipc: Pick<IpcMain, 'handle'>,
  host: PluginHostUi,
  workspaceOf: (event: IpcMainInvokeEvent) => string | null,
): () => void {
  const readers = new Map<WebContents, string>()
  const stop = host.onChanged((workspaceId) => {
    for (const [sender, workspace] of readers)
      if (sender.isDestroyed()) readers.delete(sender)
      else if (workspace === workspaceId) sender.send(PLUGIN_HOST_CHANGED)
  })
  ipc.handle(PLUGIN_HOST_CHANNEL, async (event, input: unknown) => {
    const workspaceId = workspaceOf(event)
    const parsed = PluginHostUiRequest.safeParse(input)
    if (!workspaceId || event.senderFrame !== event.sender.mainFrame || !parsed.success)
      return { error: { code: 'not-found' } }
    const asked = parsed.data
    if (asked.kind === 'snapshot') {
      if (!readers.has(event.sender))
        event.sender.once('destroyed', () => readers.delete(event.sender))
      readers.set(event.sender, workspaceId)
    }
    return host.request(workspaceId, asked)
  })
  return () => {
    readers.clear()
    stop()
  }
}
