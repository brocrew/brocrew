import { fork, type ChildProcessWithoutNullStreams, type ForkOptions } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { PluginHostError } from './node-host-files'

export interface PluginHostEnvelope {
  api: 1
  workspaceId: string
  requestId: string
  method: string
  params: unknown
}
export type PluginHostRequestHandler = (
  identity: Readonly<{ pluginId: string; runId: string }>,
  request: PluginHostEnvelope,
  signal: AbortSignal,
) => Promise<Record<string, unknown>>

const HostRequest = z.object({
  method: z.literal('brocrew/host'),
  params: z.object({
    api: z.literal(1),
    workspaceId: z.string(),
    requestId: z.string(),
    method: z.string(),
    params: z.json(),
  }),
})
const ReadyMessage = z.object({
  type: z.literal('brocrew-plugin-ready'),
  api: z.literal(1),
  mcp: z.object({ url: z.url(), headers: z.record(z.string(), z.string()).optional() }),
})

/** MCP framing on the already-owned child, so the SDK never starts a second process. */
class ProcessStdioTransport implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void
  private buffer = new ReadBuffer()
  private closed = false
  constructor(private readonly child: ChildProcessWithoutNullStreams) {}
  async start(): Promise<void> {
    this.child.stdout.on('data', this.read)
    this.child.stdin.on('error', this.error)
  }
  private error = (error: Error) => this.onerror?.(error)
  private read = (bytes: Buffer) => {
    this.buffer.append(bytes)
    try {
      for (;;) {
        const message = this.buffer.readMessage()
        if (!message) break
        this.onmessage?.(message)
      }
    } catch (error) {
      this.onerror?.(error instanceof Error ? error : new Error('Invalid MCP message'))
    }
  }
  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) throw new PluginHostError('ready')
    await new Promise<void>((resolve, reject) => {
      this.child.stdin.write(serializeMessage(message), (error) =>
        error ? reject(error) : resolve(),
      )
    })
  }
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.child.stdout.off('data', this.read)
    this.child.stdin.off('error', this.error)
    // The process owner controls shutdown. Closing an MCP session never invents process exit.
    this.onclose?.()
  }
}

/** One package process, one retained MCP client, and host calls bound to this launch's identity. */
export function launchPluginProcess(options: {
  pluginId: string
  runId: string
  node: string
  guardian: string
  slot: string
  keeperCache?: string
  command: string
  args: readonly string[]
  cwd: string
  env: NodeJS.ProcessEnv
  mcp: { transport: 'stdio' } | { transport: 'streamable-http'; bootstrap: 'ready-message' }
  stop: { signal: string; graceMs?: number }
  readyMs: number
  hostRequest?: PluginHostRequestHandler
}) {
  const lifetime = new AbortController()
  const client = new Client(
    { name: 'brocrew-plugin-host', version: '1' },
    { capabilities: { experimental: { 'brocrew/host': { api: 1 } } } },
  )
  client.onerror = () => {}
  client.setRequestHandler(HostRequest, async (request, extra) => {
    if (lifetime.signal.aborted) return { error: { code: 'disabled' } }
    if (!options.hostRequest) return { error: { code: 'unsupported' } }
    return options.hostRequest(
      Object.freeze({ pluginId: options.pluginId, runId: options.runId }),
      request.params,
      AbortSignal.any([lifetime.signal, extra.signal]),
    )
  })
  const launchOptions: ForkOptions & { windowsHide: boolean } = {
    execPath: options.node,
    execArgv: [],
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  }
  const child = fork(options.guardian, [], launchOptions) as ChildProcessWithoutNullStreams
  // stderr is an ordinary diagnostic stream; consuming it keeps the process from blocking.
  child.stderr.resume()
  let resolveExit!: (result: { exited: boolean }) => void
  const exited = new Promise<{ exited: boolean }>((resolve) => {
    resolveExit = resolve
  })
  let resolveReady!: (value: {
    client: Client
    serverPid: number
    origin: string
    endpoint?: { url: string; headers: Record<string, string> }
  }) => void
  let rejectReady!: (error: Error) => void
  const ready = new Promise<Parameters<typeof resolveReady>[0]>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  void ready.catch(() => {})
  let ended = false,
    stopping = false,
    connecting = false,
    physicalExited = false,
    unsupported = false
  let packagePid: number | undefined
  let resolveSpawned!: () => void, rejectSpawned!: (error: Error) => void
  const spawned = new Promise<void>((resolve, reject) => {
    resolveSpawned = resolve
    rejectSpawned = reject
  })
  void spawned.catch(() => {})
  let stopPromise: Promise<{ exited: boolean }> | undefined
  let killTimer: ReturnType<typeof setTimeout> | undefined
  let transport: Transport | undefined
  function stop(): Promise<{ exited: boolean }> {
    if (stopPromise) return stopPromise
    stopping = true
    lifetime.abort()
    rejectReady(new PluginHostError(unsupported ? 'unsupported' : 'ready'))
    rejectSpawned(new PluginHostError('ready'))
    const graceMs = options.stop.graceMs ?? 3000
    stopPromise = (async () => {
      if (!ended) {
        if (child.connected)
          child.send({ channel: 'brocrew-plugin-process:v1', type: 'stop' }, () => {})
        // The guardian owns cleanup. If it crashes, the holder also observes its IPC disconnect.
        killTimer = setTimeout(() => {
          child.kill('SIGTERM')
        }, graceMs + 5000)
        killTimer.unref()
      }
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          exited,
          new Promise<{ exited: boolean }>((resolve) => {
            timeout = setTimeout(() => resolve({ exited: false }), graceMs + 5000)
          }),
        ])
      } finally {
        clearTimeout(timeout)
      }
    })()
    void client.close().catch(() => {})
    return stopPromise
  }
  client.onclose = () => {
    if (!ended && !stopping) void stop()
  }
  let readyTimer: ReturnType<typeof setTimeout>
  function deadline(ms: number) {
    clearTimeout(readyTimer)
    readyTimer = setTimeout(() => {
      void stop()
    }, ms)
    readyTimer.unref()
  }
  deadline(process.platform === 'win32' ? 130000 : options.readyMs)
  function finish(): void {
    if (ended) return
    ended = true
    clearTimeout(readyTimer)
    clearTimeout(killTimer)
    lifetime.abort()
    child.stdin.destroy()
    child.stdout.destroy()
    child.stderr.destroy()
    rejectReady(new PluginHostError(unsupported ? 'unsupported' : 'ready'))
    rejectSpawned(new PluginHostError('ready'))
    void client.close().catch(() => {})
    resolveExit({ exited: physicalExited })
  }
  child.once('error', () => {
    if (!child.pid) physicalExited = true
    finish()
  })
  child.once('close', finish)
  async function connect(endpoint?: { url: string; headers?: Record<string, string> }) {
    if (connecting || ended || stopping) return
    connecting = true
    try {
      await spawned
      if (ended || stopping) return
      transport = endpoint
        ? new StreamableHTTPClientTransport(new URL(endpoint.url), {
            requestInit: { headers: endpoint.headers },
          })
        : new ProcessStdioTransport(child)
      await client.connect(transport)
      if (ended || stopping || !packagePid) return
      clearTimeout(readyTimer)
      resolveReady({
        client,
        serverPid: packagePid,
        origin: endpoint ? new URL(endpoint.url).origin : '',
        ...(endpoint ? { endpoint: { url: endpoint.url, headers: endpoint.headers ?? {} } } : {}),
      })
    } catch {
      void stop()
    }
  }
  if (options.mcp.transport !== 'stdio') {
    let pending = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      pending += chunk
      let index: number
      while ((index = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, index)
        pending = pending.slice(index + 1)
        try {
          const message = ReadyMessage.safeParse(JSON.parse(line))
          if (message.success) void connect(message.data.mcp)
        } catch {
          /* Ordinary startup output is not a ready message. */
        }
      }
    })
  }
  child.on('message', (message: unknown) => {
    const value = message as {
      channel?: string
      type?: string
      pid?: number
      exited?: boolean
    }
    if (value?.channel !== 'brocrew-plugin-process:v1') return
    if (value.type === 'stopped') physicalExited = value.exited === true
    else if (value.type === 'unsupported') unsupported = true
    else if (value.type === 'job') deadline(options.readyMs)
    else if (value.type === 'spawned' && Number.isSafeInteger(value.pid) && Number(value.pid) > 1) {
      packagePid = value.pid
      resolveSpawned()
      if (options.mcp.transport === 'stdio') void connect()
    }
  })
  child.send(
    {
      channel: 'brocrew-plugin-process:v1',
      type: 'launch',
      command: options.command,
      args: [...options.args],
      cwd: options.cwd,
      stop: options.stop,
      slot: options.slot,
      keeperCache: options.keeperCache,
    },
    () => {},
  )
  return Object.freeze({ ready: () => ready, stop, exited })
}
