import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { VOICE_CHANNELS, isVoiceId, type VoiceResult } from '../../shared/voice'
import { VoiceService } from './service'

export function registerVoiceIpc(
  ipc: Pick<IpcMain, 'handle' | 'removeHandler'>,
  service: VoiceService,
  isAppWindow: (event: IpcMainInvokeEvent) => boolean,
): () => void {
  let closed = false
  ipc.handle(VOICE_CHANNELS.start, async (event, id: unknown): Promise<VoiceResult> => {
    if (closed || !isAppWindow(event) || !isVoiceId(id)) return { ok: false, error: 'unavailable' }
    const sender = event.sender
    const abort = (): void => service.cancel(sender, id)
    sender.on('did-navigate', abort)
    sender.on('render-process-gone', abort)
    sender.on('destroyed', abort)
    try {
      return await service.start(sender, id, (phase) => {
        if (!sender.isDestroyed()) sender.send(VOICE_CHANNELS.state, { id, phase })
      })
    } finally {
      sender.removeListener('did-navigate', abort)
      sender.removeListener('render-process-gone', abort)
      sender.removeListener('destroyed', abort)
    }
  })
  ipc.handle(VOICE_CHANNELS.stop, (event, id: unknown) => {
    if (!closed && isAppWindow(event) && isVoiceId(id)) service.stop(event.sender, id)
  })
  ipc.handle(VOICE_CHANNELS.cancel, (event, id: unknown) => {
    if (!closed && isAppWindow(event) && isVoiceId(id)) service.cancel(event.sender, id)
  })
  return () => {
    closed = true
    service.close()
    for (const name of [VOICE_CHANNELS.start, VOICE_CHANNELS.stop, VOICE_CHANNELS.cancel])
      ipc.removeHandler(name)
  }
}
