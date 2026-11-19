import type { RuntimeBridge, RuntimeCommand } from '../../src/shared/runtime-ipc'
import { everythingOverTheWire } from './the-wire'

/** Drive the renderer's session commands through serialization and the real test dispatcher. */
export function fixtureRuntimeBridge(
  run: <T>(command: RuntimeCommand) => Promise<T>,
  subscriptions: Pick<RuntimeBridge, 'onEvent' | 'onLiveness' | 'onChanged'>,
): RuntimeBridge {
  const bridge: Partial<RuntimeBridge> = {
    createSession: (input) => run({ kind: 'createSession', ...input }),
    resume: (input) => run({ kind: 'resume', ...input }),
    claim: (input) => run({ kind: 'claim', ...input }),
    startAndSend: (input) => run({ kind: 'startAndSend', ...input }),
    cancelLaunch: (input) => run({ kind: 'cancelLaunch', ...input }),
    attachOpen: () => run({ kind: 'attachOpen' }),
    send: (input) => run({ kind: 'send', ...input }),
    sendInterrupting: (input) => run({ kind: 'sendInterrupting', ...input }),
    queueMessage: (input) => run({ kind: 'queueMessage', ...input }),
    close: (input) => run({ kind: 'close', ...input }),
    look: (input) => run({ kind: 'look', ...input }),
    listResumable: () => run({ kind: 'listResumable' }),
    listUnresumable: () => run({ kind: 'listUnresumable' }),
    ...subscriptions,
  }
  return everythingOverTheWire(bridge) as RuntimeBridge
}
