import { createPluginToolBroker } from '../../src/main/plugins/tool-broker'
import type {
  BrokerAudit,
  BrokerProgress,
  BrokerInput,
  BrokerOptions,
  BrokerReply,
  BrokerRequest,
  BrokerValue,
  PluginExecution,
} from '../../src/main/plugins/tool-broker'

export function inventoryClient<Connect, List, Close>(sdk: {
  connect: Connect
  list: List
  close: Close
}) {
  return class Client {
    connect = sdk.connect
    listTools = sdk.list
    close = sdk.close
  }
}

export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
class Server {
  calls: Array<{
    request: BrokerRequest
    signal: AbortSignal
    result: ReturnType<typeof deferred<BrokerReply>>
    quiet: ReturnType<typeof deferred<void>>
    cancels: number
    onprogress?: (progress: BrokerProgress) => void
  }> = []
  cancelError: unknown
  onCancel?: () => void
  startError: unknown
  tool = (
    request: BrokerRequest,
    signal: AbortSignal,
    onprogress?: (progress: BrokerProgress) => void,
  ): PluginExecution => {
    if (this.startError) throw this.startError
    const call = {
      request,
      signal,
      result: deferred<BrokerReply>(),
      quiet: deferred<void>(),
      cancels: 0,
      onprogress,
    }
    this.calls.push(call)
    return {
      result: call.result.promise,
      quiescent: call.quiet.promise,
      cancel: () => {
        call.cancels++
        this.onCancel?.()
        if (this.cancelError) return Promise.reject(this.cancelError)
      },
    }
  }
  finish(index: number, value: BrokerValue = { done: true }) {
    this.calls[index]!.result.resolve({ ok: true, value })
    this.calls[index]!.quiet.resolve()
  }
}
export const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
export const tracked = <T>(promise: Promise<T>): Promise<T> => {
  void promise.catch(() => undefined)
  return promise
}
export function setup(change: (options: BrokerOptions) => BrokerOptions = (options) => options) {
  const server = new Server(),
    audit: BrokerAudit[] = []
  const options: BrokerOptions = {
    binding: { pluginId: 'fictional-browser', installId: 'installation-fern', epoch: 'epoch-one' },
    reservedNamespace: 'fictional-host',
    hostToolNames: ['give_work'],
    occupiedNamespaces: [],
    occupiedQualifiedNames: [],
    tools: [
      {
        name: 'read_page',
        description: 'Read a fictional page.',
        inputSchema: { type: 'object' },
      },
      {
        name: 'write_page',
        description: 'Write a fictional page.',
        inputSchema: { type: 'object' },
      },
    ],
    server,
    audit: (event) => audit.push(event),
  }
  const broker = createPluginToolBroker(change(options))
  const ws = broker.owner.attach('willow')
  const agent = broker.owner.grantAgent(ws, 'fern-life-one')
  const name = broker.agent.discover(agent)[0]!.qualifiedName
  const call = (who = agent, input: BrokerInput = { profile: 'fern' }, signal?: AbortSignal) =>
    tracked(broker.agent.call(who, name, input, signal))
  return { broker, options, server, audit, ws, agent, name, call }
}
