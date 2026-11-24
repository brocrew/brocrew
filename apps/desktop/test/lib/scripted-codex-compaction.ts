import type { CodexIncoming, CodexTransport } from '@brobot2/runtime/codex'
import { CODEX_PROTOCOL_VERSION } from '../../../../packages/runtime/src/codex/protocol-version'
import {
  completedTurn,
  threadStartResponse,
  turnCompletedNotification,
  turnStartResponse,
  turnStartedNotification,
} from '../../../../packages/runtime/test/fixtures/codex-protocol'
import { ready } from '../../../../packages/runtime/test/fixtures/plugin-readiness'

/** An async queue the scripted app-server pushes into. */
export class Wire<T> implements AsyncIterable<T> {
  private readonly waiting: T[] = []
  private settle: ((result: IteratorResult<T>) => void) | null = null
  private closed = false
  push(item: T): void {
    const settle = this.settle
    if (settle) {
      this.settle = null
      settle({ value: item, done: false })
      return
    }
    this.waiting.push(item)
  }
  close(): void {
    this.closed = true
    const settle = this.settle
    if (settle) {
      this.settle = null
      settle({ value: undefined as never, done: true })
    }
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.waiting.length > 0) {
          return Promise.resolve({ value: this.waiting.shift() as T, done: false })
        }
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise<IteratorResult<T>>((resolve) => {
          this.settle = resolve
        })
      },
    }
  }
}

/**
 * ⚑ **The app-server, scripted from what `probe:codex-command-as-typed` measured on 0.146.0.**
 *
 * - `turn/start` → its id, then (after the answer, as Codex writes it) `turn/started`, one agent
 *   message and `turn/completed` — an ordinary turn.
 * - `thread/compact/start` → `{}`, then `turn/started` under a NEW id, the `contextCompaction` item
 *   opening and closing, Codex's own warning, and `turn/completed`.
 *
 * ⚠️ Every request is kept, so a test reads what the adapter ASKED rather than what it emitted.
 */
export class ScriptedCodex implements CodexTransport {
  private readonly queue = new Wire<CodexIncoming>()
  private turns = 0
  compactionInterrupted = false
  compactionMayFinish: Promise<void> | null = null
  ordinaryTurnMayStart: Promise<void> | null = null
  pluginDiscovery: Promise<unknown> = Promise.resolve(ready())
  readonly requests: { method: string; params: Record<string, unknown> }[] = []
  constructor(readonly home: string) {}
  request(method: string, params?: unknown): Promise<unknown> {
    const given = (params ?? {}) as Record<string, unknown>
    this.requests.push({ method, params: given })
    if (method === 'mcpServerStatus/list') return this.pluginDiscovery
    if (method === 'initialize') {
      return Promise.resolve({
        userAgent: `brobot2/${CODEX_PROTOCOL_VERSION} (Mac OS 26.3.0; arm64) vscode/1.130.0 (brobot2; 0.0.0)`,
        codexHome: this.home,
      })
    }
    if (method === 'thread/start' || method === 'thread/resume') {
      const cwd = (given as { cwd?: string }).cwd ?? '/tmp/x'
      // ⚑ A conformant app-server applies the profile it was asked for — `auto` is `never` with no
      // sandbox — and the adapter fails a handshake that echoes anything else (013).
      const unattended = given['approvalPolicy'] === 'never'
      return Promise.resolve(
        threadStartResponse(
          'th_1',
          cwd,
          unattended ? { approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } } : {},
        ) as unknown as Record<string, unknown>,
      )
    }
    if (method === 'turn/start') {
      const id = `tn_${String(++this.turns)}`
      const start = () => {
        setTimeout(() => this.anOrdinaryTurn(id), 0)
        return turnStartResponse(id)
      }
      return this.ordinaryTurnMayStart?.then(start) ?? Promise.resolve(start())
    }
    if (method === 'thread/compact/start') {
      const id = `tc_${String(++this.turns)}`
      if (this.compactionMayFinish === null) setTimeout(() => this.aCompaction(id), 0)
      else void this.compactionMayFinish.then(() => this.aCompaction(id))
      return Promise.resolve({})
    }
    if (method === 'model/list') {
      // ⚑ **D-042 · R1 moved a fact here: every start NAMES its model and effort**, and a Codex start
      // naming nothing reads `model/list` and names the row it marks `isDefault`, at that row's
      // `defaultReasoningEffort` — the `{}` every other request is answered with now refuses the
      // launch (`nothing-names-a-model`, F2) before any conversation opens. One row, in the shape
      // 058 measured on 0.146.0 (`codex-runtime.ts`' `listModels`). ⚠️ The probe's app-server is
      // built BEFORE the session's, so `transports.at(-1)` is still the conversation's own.
      return Promise.resolve({
        data: [
          {
            id: 'm',
            model: 'm',
            displayName: 'm',
            hidden: false,
            isDefault: true,
            supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'medium' }],
            defaultReasoningEffort: 'medium',
          },
        ],
        nextCursor: null,
      })
    }
    return Promise.resolve({})
  }
  private push(method: string, params: unknown): void {
    this.queue.push({ kind: 'notification', method, params })
  }
  private anOrdinaryTurn(id: string): void {
    this.push('turn/started', turnStartedNotification('th_1', id))
    this.push('item/completed', {
      threadId: 'th_1',
      turnId: id,
      item: { type: 'agentMessage', id: `m_${id}`, text: 'ok' },
      completedAtMs: 1,
    })
    this.push('turn/completed', turnCompletedNotification('th_1', completedTurn(id)))
  }
  private aCompaction(id: string): void {
    this.push('turn/started', turnStartedNotification('th_1', id))
    if (this.compactionInterrupted) {
      this.push(
        'turn/completed',
        turnCompletedNotification('th_1', completedTurn(id, { status: 'interrupted' })),
      )
      return
    }
    const item = { type: 'contextCompaction', id: `cc_${id}` }
    this.push('item/started', { threadId: 'th_1', turnId: id, item, startedAtMs: 1 })
    this.push('item/completed', { threadId: 'th_1', turnId: id, item, completedAtMs: 2 })
    this.push('warning', {
      threadId: null,
      message:
        'Heads up: Long threads and multiple compactions can cause the model to be less accurate. Start a new thread when possible to keep threads small and targeted.',
    })
    this.push('turn/completed', turnCompletedNotification('th_1', completedTurn(id)))
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
  exited: Promise<void> | undefined
  /** The text of every `turn/start` this app-server was sent, in order. */
  turnTexts(): string[] {
    return this.requests
      .filter((one) => one.method === 'turn/start')
      .map((one) => {
        const input = one.params['input'] as { text?: string }[] | undefined
        return input?.[0]?.text ?? ''
      })
  }
  asked(method: string): number {
    return this.requests.filter((one) => one.method === method).length
  }
}
