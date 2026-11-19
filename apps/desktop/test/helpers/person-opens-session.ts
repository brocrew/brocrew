import type { Provider } from '@brobot2/shared'
import type { RuntimeHost, RuntimeEventSink } from '../../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../../src/main/runtime/ipc'

export function personOpener(
  read: () => { host: RuntimeHost; root: string; window: RuntimeEventSink },
  defaultMode: 'ask' | 'auto',
  provider: Provider = 'claude',
) {
  return async (profileId: string, approvalMode: 'ask' | 'auto' = defaultMode): Promise<string> => {
    const { host, root, window } = read()
    const { sessionId } = await host.createSession(
      { provider, profileId, approvalMode, cwd: root },
      window,
    )
    return sessionId
  }
}

export function personOpenerOverIpc(
  read: () => { host: RuntimeHost; root: string; window: RuntimeEventSink },
) {
  return async (profileId: string): Promise<string> => {
    const { host, root, window } = read()
    const opened = (await executeRuntimeCommand(host, window, {
      kind: 'createSession',
      provider: 'claude',
      profileId,
      approvalMode: 'ask',
      cwd: root,
    })) as { sessionId: string }
    return opened.sessionId
  }
}
