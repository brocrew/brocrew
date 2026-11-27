import { executeRuntimeCommand } from '../../src/main/runtime/ipc'
import type { RuntimeEventSink, RuntimeHost } from '../../src/main/runtime/runtime-host'
import type {
  RuntimeBridge,
  RuntimeChangeMessage,
  RuntimeCommand,
  RuntimeEventMessage,
  SessionLivenessMessage,
} from '../../src/shared/runtime-ipc'
import { everythingOverTheWire } from './the-wire'

function subscribe<T>(listeners: ((message: T) => void)[], listener: (message: T) => void) {
  listeners.push(listener)
  return () => void listeners.splice(listeners.indexOf(listener), 1)
}

/** Drive the renderer's session commands through serialization and the real test dispatcher. */
export function fixtureRuntimeBridge(
  run: <T>(command: RuntimeCommand) => Promise<T>,
  events: ((message: RuntimeEventMessage) => void)[],
  liveness: ((message: SessionLivenessMessage) => void)[],
  changed?: ((message: RuntimeChangeMessage) => void)[],
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
    stopLooking: (input) => run({ kind: 'stopLooking', ...input }),
    release: (input) => run({ kind: 'release', ...input }),
    listResumable: () => run({ kind: 'listResumable' }),
    listUnresumable: () => run({ kind: 'listUnresumable' }),
    onEvent: (listener) => subscribe(events, listener),
    onLiveness: (listener) => subscribe(liveness, listener),
    onChanged: (listener) => (changed === undefined ? () => {} : subscribe(changed, listener)),
  }
  return everythingOverTheWire(bridge) as RuntimeBridge
}

/** A renderer bridge and the event sink it subscribes to, kept across host restarts. */
export class FixtureRuntimeWindow implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  alive = true
  private readonly events: ((message: RuntimeEventMessage) => void)[] = []
  private readonly liveness: ((message: SessionLivenessMessage) => void)[] = []
  private readonly changed: ((message: RuntimeChangeMessage) => void)[] = []

  constructor(
    readonly ownerId: string,
    private readonly host: () => RuntimeHost,
  ) {}

  send(message: RuntimeEventMessage): void {
    for (const listener of [...this.events]) listener(message)
  }

  sendLiveness(message: SessionLivenessMessage): void {
    for (const listener of [...this.liveness]) listener(message)
  }

  announce(change: RuntimeChangeMessage): void {
    for (const listener of [...this.changed]) listener(change)
  }

  bridge(): RuntimeBridge {
    const run = async <T>(command: RuntimeCommand): Promise<T> =>
      (await executeRuntimeCommand(this.host(), this, command)) as T
    return fixtureRuntimeBridge(run, this.events, this.liveness, this.changed)
  }
}
