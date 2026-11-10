import type { RuntimeHost, RuntimeEventSink } from '../../src/main/runtime/runtime-host'

export function personOpener(
  read: () => { host: RuntimeHost; root: string; window: RuntimeEventSink },
  defaultMode: 'ask' | 'auto',
) {
  return async (profileId: string, approvalMode: 'ask' | 'auto' = defaultMode): Promise<string> => {
    const { host, root, window } = read()
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode, cwd: root },
      window,
    )
    return sessionId
  }
}
