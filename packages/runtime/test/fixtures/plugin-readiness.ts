import { afterEach, beforeEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CodexIncoming, CodexTransport } from '../../src/codex/codex-transport'
import { AsyncQueue } from '../../src/internal/async-queue'
import { CODEX_PROTOCOL_VERSION } from '../../src/codex/protocol-version'
import type { SessionHandle } from '../../src/index'
import { threadStartResponse, turnStartResponse, completedTurn } from './codex-protocol'

export const route = {
  name: 'plugin-fern',
  url: 'http://127.0.0.1:8123/mcp',
  capability: 'a'.repeat(64),
}
export function readinessHomes() {
  const folders: string[] = []
  const handles: SessionHandle[] = []
  beforeEach(() => vi.useFakeTimers())
  afterEach(async () => {
    for (const handle of handles.splice(0)) await handle.close()
    vi.useRealTimers()
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  })
  function home() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'fictional-plugin-readiness-')))
    folders.push(root)
    const providerHome = join(root, 'home')
    mkdirSync(providerHome)
    return { providerHome, cwd: root }
  }
  return { home, handles }
}
export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((ready) => {
    resolve = ready
  })
  return { promise, resolve }
}
export const ready = (name = route.name) => ({
  data: [{ name, runtimeStatus: 'connected', toolsError: null, tools: { echo: {} } }],
})
export const tick = () => vi.advanceTimersByTimeAsync(0)

export class Wire implements CodexTransport {
  readonly queue = new AsyncQueue<CodexIncoming>()
  readonly requests: { method: string; params: unknown }[] = []
  readonly catalogsAtTurns: string[][] = []
  catalog: string[] = []
  discovery: (params: unknown) => Promise<unknown> = async () => ready()
  constructor(readonly location: { providerHome: string; cwd: string }) {}
  async request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params })
    if (method === 'initialize')
      return {
        userAgent: `fictional/${CODEX_PROTOCOL_VERSION}`,
        codexHome: this.location.providerHome,
      }
    if (method === 'getAuthStatus') return { authMethod: 'apikey', requiresOpenaiAuth: true }
    if (method === 'account/read') return { account: { type: 'apiKey' } }
    if (method === 'thread/start' || method === 'thread/resume')
      return threadStartResponse('fictional-thread', this.location.cwd)
    if (method === 'mcpServerStatus/list') return this.discovery(params)
    if (method === 'turn/start') {
      this.catalogsAtTurns.push([...this.catalog])
      return turnStartResponse(`fictional-turn-${this.catalogsAtTurns.length}`)
    }
    return {}
  }
  notify(): void {}
  respond(): void {}
  respondError(): void {}
  incoming(): AsyncIterable<CodexIncoming> {
    return this.queue
  }
  close(): void {
    this.queue.close()
  }
  finish() {
    this.queue.push({
      kind: 'notification',
      method: 'turn/completed',
      params: {
        threadId: 'fictional-thread',
        turn: completedTurn(`fictional-turn-${this.catalogsAtTurns.length}`),
      },
    })
  }
}
