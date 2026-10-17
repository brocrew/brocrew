import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { LocalZone } from '../shared/local-time'
import type {
  MessagePath,
  MessagePathAsk,
  MessagePathTarget,
  RevealResult,
} from '../shared/runtime-ipc'
import type {
  HistoryConversation,
  HistoryEvent,
  RECOVERY_CHANNELS,
  RecoveryBridge,
  RecoveryProgress,
  StartupVerdict,
} from '../shared/recovery'

/**
 * The recovery window's preload: `window.recovery`, and nothing else. It is sandboxed, so it loads
 * no module but `electron`: everything it takes from elsewhere is a type, and the channel names are
 * written out here, held to the shared ones by their type.
 */

const CHANNELS = {
  verdict: 'recovery:verdict',
  restore: 'recovery:restore',
  return: 'recovery:return',
  retry: 'recovery:retry',
  quit: 'recovery:quit',
  zone: 'recovery:zone',
  conversations: 'recovery:conversations',
  transcript: 'recovery:transcript',
  messagePaths: 'recovery:message-paths',
  revealMessagePath: 'recovery:reveal-message-path',
  progress: 'recovery:progress',
} as const satisfies typeof RECOVERY_CHANNELS

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>

const recovery: RecoveryBridge = Object.freeze({
  verdict: () => invoke<StartupVerdict>(CHANNELS.verdict),
  onVerdict: (listener: (verdict: StartupVerdict) => void) => {
    const forward = (_event: IpcRendererEvent, verdict: StartupVerdict): void => listener(verdict)
    ipcRenderer.on(CHANNELS.verdict, forward)
    return () => {
      ipcRenderer.removeListener(CHANNELS.verdict, forward)
    }
  },
  restore: (checkpointId: string) => invoke<StartupVerdict>(CHANNELS.restore, checkpointId),
  returnToNewer: () => invoke<StartupVerdict>(CHANNELS.return),
  retry: () => invoke<StartupVerdict>(CHANNELS.retry),
  onProgress: (listener: (done: number, total: number) => void) => {
    const forward = (_event: IpcRendererEvent, progress: RecoveryProgress): void =>
      listener(progress.done, progress.total)
    ipcRenderer.on(CHANNELS.progress, forward)
    return () => {
      ipcRenderer.removeListener(CHANNELS.progress, forward)
    }
  },
  zone: () => invoke<LocalZone | null>(CHANNELS.zone),
  quit: () => invoke<void>(CHANNELS.quit),
  history: Object.freeze({
    conversations: () => invoke<readonly HistoryConversation[]>(CHANNELS.conversations),
    transcript: (id: string) => invoke<readonly HistoryEvent[]>(CHANNELS.transcript, id),
  }),
  resolveMessagePaths: (ask: MessagePathAsk) =>
    invoke<MessagePath[]>(CHANNELS.messagePaths, {
      sessionId: ask.sessionId,
      texts: [...ask.texts],
    }),
  revealMessagePath: (target: MessagePathTarget) =>
    invoke<RevealResult>(CHANNELS.revealMessagePath, {
      sessionId: target.sessionId,
      text: target.text,
    }),
})

contextBridge.exposeInMainWorld('recovery', recovery)
