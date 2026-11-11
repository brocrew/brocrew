import type { RuntimeEvent } from '@brobot2/runtime'
import type { TranscriptEvent } from '../../src/shared/conversation-events'
import type { RuntimeEventMessage } from '../../src/shared/runtime-ipc'
import { NO_DISCOVERY } from '../../src/main/adopt/discover-sessions'

export function ancestryHostDeps(directory: string) {
  return {
    discoverSessions: NO_DISCOVERY,
    resolveCwd: () => directory,
    prepareProviderHome: () => directory,
    providerHomePath: () => directory,
    nativeTranscriptPath: () => null,
    exportDirectory: () => directory,
    readProviderConfig: () => ({
      home: directory,
      homeEnv: 'CODEX_HOME',
      model: 'fictional',
      authNote: null,
      files: [],
    }),
  }
}

export function ancestryBranch(): TranscriptEvent[] {
  return [
    { type: 'tool_call', id: 'outer', name: 'Agent', summary: 'child dispatch' },
    {
      type: 'sub_agent',
      agentId: 'child',
      phase: 'started',
      parentToolCallId: 'outer',
      title: 'Child',
    },
    {
      type: 'tool_call',
      id: 'inner',
      parentToolCallId: 'outer',
      name: 'Agent',
      summary: 'grandchild dispatch',
    },
    {
      type: 'sub_agent',
      agentId: 'grandchild',
      phase: 'started',
      parentToolCallId: 'inner',
      title: 'Grandchild',
    },
  ]
}

export function publishAncestryEvent(
  queue: { push(event: RuntimeEvent): void },
  receive: (listener: ((message: RuntimeEventMessage) => void) | undefined) => void,
  event: RuntimeEvent,
): Promise<void> {
  return new Promise((resolve) => {
    receive((message) => {
      if (message.event.type !== event.type) return
      if ('id' in event && (!('id' in message.event) || message.event.id !== event.id)) return
      if (
        'agentId' in event &&
        (!('agentId' in message.event) || message.event.agentId !== event.agentId)
      )
        return
      receive(undefined)
      resolve()
    })
    queue.push(event)
  })
}
