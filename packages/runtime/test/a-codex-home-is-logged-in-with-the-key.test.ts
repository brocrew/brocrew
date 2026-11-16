import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CodexIncoming, CodexTransport } from '../src/codex'
import { AsyncQueue } from '../src/internal/async-queue'
import { changeCodexKeyInHome } from '../src/codex/codex-login'
import { beginCodexHomeBoot, resetCodexHomeBoots } from '../src/codex/home-boot'

/** Legacy no-key cleanup retains native status, cancellation, error and boot cleanup behavior. */

const KEY = 'sk-test-made-up-codex-key-0123456789'

/** A transport that answers by method, records every request WITH its params, and says when closed. */
class RecordingTransport implements CodexTransport {
  private readonly queue = new AsyncQueue<CodexIncoming>()
  readonly requests: { method: string; params: unknown }[] = []
  closes = 0
  constructor(private readonly answers: Record<string, unknown | Error>) {}
  request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params })
    const answer = this.answers[method]
    if (answer instanceof Error) return Promise.reject(answer)
    if (answer === undefined) return Promise.reject(new Error(`no answer for ${method}`))
    return Promise.resolve(answer)
  }
  notify(): void {}
  respond(): void {}
  respondError(): void {}
  incoming(): AsyncIterable<CodexIncoming> {
    return this.queue
  }
  close(): void {
    this.closes += 1
    this.queue.close()
  }
  methods(): string[] {
    return this.requests.map((one) => one.method)
  }
}

describe('changeCodexKeyInHome', () => {
  let home: string
  let made: RecordingTransport[]

  beforeEach(() => {
    resetCodexHomeBoots()
    home = mkdtempSync(join(tmpdir(), 'brobot2-codexkey-home-'))
    made = []
  })
  afterEach(() => {
    resetCodexHomeBoots()
    rmSync(home, { recursive: true, force: true })
  })

  const answers = (
    over: Record<string, unknown | Error> = {},
  ): Record<string, unknown | Error> => ({
    initialize: { codexHome: home },
    'account/logout': {},
    getAuthStatus: { authMethod: null, authToken: null, requiresOpenaiAuth: false },
    ...over,
  })
  const factory = (table: Record<string, unknown | Error>) => (): CodexTransport => {
    const transport = new RecordingTransport(table)
    made.push(transport)
    return transport
  }

  it('🔴 no key logs the home out, and reports that it runs on whatever is left — or on nothing', async () => {
    const out = await changeCodexKeyInHome(
      factory(answers({ getAuthStatus: { authMethod: 'chatgpt' } })),
      home,
    )
    expect(out).toEqual({ ok: true, authMethod: 'chatgpt' })
    expect(made[0]?.methods()).toEqual(['initialize', 'account/logout', 'getAuthStatus'])
    expect(made[0]?.requests[1]?.params).toBeUndefined()

    const none = await changeCodexKeyInHome(
      factory(answers({ getAuthStatus: { authMethod: null } })),
      home,
    )
    expect(none).toEqual({ ok: true, authMethod: null })
  })

  it('⛔ a logout Codex refuses is answered in BroBot’s words — never the provider’s, never the key — and nothing is asked after it', async () => {
    const outcome = await changeCodexKeyInHome(
      factory(answers({ 'account/logout': new Error(`401 for ${KEY}: Incorrect API key`) })),
      home,
    )
    expect(outcome).toEqual({
      ok: false,
      reason: 'Codex would not log this profile out.',
    })
    expect(JSON.stringify(outcome)).not.toContain(KEY)
    expect(JSON.stringify(outcome)).not.toContain('Incorrect API key')
    expect(made[0]?.methods()).not.toContain('getAuthStatus')
    expect(made[0]?.closes).toBeGreaterThan(0)
  })

  it('⛔ a status that cannot be read after logout is said, not assumed', async () => {
    const outcome = await changeCodexKeyInHome(
      factory(answers({ getAuthStatus: new Error('stalled') })),
      home,
    )
    expect(outcome).toEqual({
      ok: false,
      reason: 'Codex did not say what this profile runs on after it tried to log this profile out.',
    })
  })

  it('⚑ a gesture already cancelled never starts an app-server', async () => {
    const controller = new AbortController()
    controller.abort()
    const outcome = await changeCodexKeyInHome(factory(answers()), home, controller.signal)
    expect(outcome.ok).toBe(false)
    expect(made).toHaveLength(0)
  })

  it('🔴 the home’s boot slot is free after every outcome — success, a refused logout, a bad handshake', async () => {
    const freed = async (): Promise<boolean> => {
      const release = await Promise.race([
        beginCodexHomeBoot(home),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
      ])
      if (release === null) return false
      release()
      return true
    }
    await changeCodexKeyInHome(factory(answers()), home)
    expect(await freed(), 'after a success').toBe(true)
    await changeCodexKeyInHome(factory(answers({ 'account/logout': new Error('no') })), home)
    expect(await freed(), 'after a refused logout').toBe(true)
    await changeCodexKeyInHome(
      factory(answers({ initialize: new Error('initialize failed') })),
      home,
    )
    expect(await freed(), 'after a bad handshake').toBe(true)
  })
})
