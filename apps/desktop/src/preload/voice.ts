import type { IpcRenderer } from 'electron'
import {
  VOICE_CHANNELS,
  isVoiceId,
  isVoicePhase,
  type VoiceBridge,
  type VoiceSettingsPane,
  type VoiceResult,
  type VoiceState,
} from '../shared/voice'

export function voiceBridge(
  ipc: Pick<IpcRenderer, 'invoke' | 'on' | 'removeListener'>,
  platform: string,
): VoiceBridge {
  return Object.freeze({
    supported: platform === 'darwin',
    start: (id: string) => ipc.invoke(VOICE_CHANNELS.start, id) as Promise<VoiceResult>,
    stop: async (id: string) => {
      await ipc.invoke(VOICE_CHANNELS.stop, id)
    },
    cancel: async (id: string) => {
      await ipc.invoke(VOICE_CHANNELS.cancel, id)
    },
    openSettings: async (pane: VoiceSettingsPane) => {
      await ipc.invoke(VOICE_CHANNELS.openSettings, pane)
    },
    onState: (listener: (state: VoiceState) => void) => {
      const receive = (_event: unknown, value: unknown): void => {
        if (!value || typeof value !== 'object') return
        const item = value as Record<string, unknown>
        if (isVoiceId(item.id) && isVoicePhase(item.phase))
          listener({ id: item.id, phase: item.phase })
      }
      ipc.on(VOICE_CHANNELS.state, receive)
      return () => {
        ipc.removeListener(VOICE_CHANNELS.state, receive)
      }
    },
  })
}
