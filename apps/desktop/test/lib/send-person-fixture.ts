import { agentToolsFor } from '../../src/main/runtime/agent-tools'
import { personOpener } from '../helpers/person-opens-session'
import type { ApprovalMode } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type { RuntimeEventSink, RuntimeHost } from '../../src/main/runtime/runtime-host'

export function createFixtureConversation(
  host: RuntimeHost,
  window: RuntimeEventSink,
  cwd: string,
  profileId: string,
  provider: Provider,
  approvalMode: ApprovalMode,
) {
  return host.createSession({ provider, profileId, approvalMode, cwd }, window)
}

export function fixturePersonEntry(
  read: () => { host: RuntimeHost; root: string; window: RuntimeEventSink },
) {
  const open = personOpener(read, 'ask')
  return {
    open,
    toolsOf: (conversation: string) => agentToolsFor(read().host, conversation),
    seed: async (profileId: string) => {
      const id = await open(profileId)
      const { host, window } = read()
      await host.close(id, window)
    },
  }
}
