import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CodexIncoming, CodexTransport } from '../src/index'
import { AsyncQueue } from '../src/internal/async-queue'
import { changeCodexKeyInHome } from '../src/codex/codex-login'
import { beginCodexHomeBoot, resetCodexHomeBoots } from '../src/codex/home-boot'

/**
 * # 🔒 A Codex profile home is logged in with a person's key, or out of it
 *
 * Landing coverage for `changeCodexKeyInHome`: Codex's own login (`account/login/start {type:'apiKey'}`,
 * `account/logout`) in an app-server pinned to ONE home. ⛔ **The key goes into that one request and
 * nowhere else**; every failure is answered in this app's own words, never the provider's, which a
 * rejection can carry; the home's boot slot is released and the app-server closed on every path; and
 * what the home RUNS ON afterwards is asked (`getAuthStatus`), not assumed.
 */

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
    'account/login/start': { type: 'apiKey' },
    'account/logout': {},
    getAuthStatus: { authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false },
    ...over,
  })
  const factory = (table: Record<string, unknown | Error>) => (): CodexTransport => {
    const transport = new RecordingTransport(table)
    made.push(transport)
    return transport
  }

  it('🔴 a key logs the home in with ONE request that carries it, then asks what the home runs on', async () => {
    const outcome = await changeCodexKeyInHome(factory(answers()), home, {
      to: 'the-key',
      apiKey: KEY,
    })
    expect(outcome).toEqual({ ok: true, authMethod: 'apikey' })
    const [transport] = made
    expect(transport?.methods()).toEqual(['initialize', 'account/login/start', 'getAuthStatus'])
    expect(transport?.requests[1]?.params).toEqual({ type: 'apiKey', apiKey: KEY })
    // The key is in that one request and in no other.
    for (const [i, one] of (transport?.requests ?? []).entries()) {
      if (i === 1) continue
      expect(JSON.stringify(one.params ?? null), one.method).not.toContain(KEY)
    }
    // Asked what it runs on without a token.
    expect(transport?.requests[2]?.params).toEqual({ includeToken: false, refreshToken: false })
    expect(transport?.closes).toBeGreaterThan(0)
  })

  it('🔴 no key logs the home out, and reports that it runs on whatever is left — or on nothing', async () => {
    const out = await changeCodexKeyInHome(
      factory(answers({ getAuthStatus: { authMethod: 'chatgpt' } })),
      home,
      { to: 'no-key' },
    )
    expect(out).toEqual({ ok: true, authMethod: 'chatgpt' })
    expect(made[0]?.methods()).toEqual(['initialize', 'account/logout', 'getAuthStatus'])
    expect(made[0]?.requests[1]?.params).toBeUndefined()

    const none = await changeCodexKeyInHome(
      factory(answers({ getAuthStatus: { authMethod: null } })),
      home,
      { to: 'no-key' },
    )
    expect(none).toEqual({ ok: true, authMethod: null })
  })

  it('⛔ a login Codex refuses is answered in BroBot’s words — never the provider’s, never the key — and nothing is asked after it', async () => {
    const outcome = await changeCodexKeyInHome(
      factory(answers({ 'account/login/start': new Error(`401 for ${KEY}: Incorrect API key`) })),
      home,
      { to: 'the-key', apiKey: KEY },
    )
    expect(outcome).toEqual({
      ok: false,
      reason: 'Codex would not log this profile in with the key.',
    })
    expect(JSON.stringify(outcome)).not.toContain(KEY)
    expect(JSON.stringify(outcome)).not.toContain('Incorrect API key')
    expect(made[0]?.methods()).not.toContain('getAuthStatus')
    expect(made[0]?.closes).toBeGreaterThan(0)

    const out = await changeCodexKeyInHome(
      factory(answers({ 'account/logout': new Error('boom') })),
      home,
      { to: 'no-key' },
    )
    expect(out).toEqual({ ok: false, reason: 'Codex would not log this profile out.' })
  })

  it('⛔ a status that cannot be read after the login is said, not assumed to be the key', async () => {
    const outcome = await changeCodexKeyInHome(
      factory(answers({ getAuthStatus: new Error('stalled') })),
      home,
      { to: 'the-key', apiKey: KEY },
    )
    expect(outcome).toEqual({
      ok: false,
      reason:
        'Codex did not say what this profile runs on after it tried to log this profile in with the key.',
    })
  })

  it('⛔ an app-server pinned to ANOTHER home is refused at the handshake: no login is asked of it', async () => {
    const outcome = await changeCodexKeyInHome(
      factory(answers({ initialize: { codexHome: '/somewhere/else' } })),
      home,
      { to: 'the-key', apiKey: KEY },
    )
    expect(outcome).toEqual({
      ok: false,
      reason: 'Codex could not be started to log this profile in with the key.',
    })
    expect(made[0]?.methods()).toEqual(['initialize'])
    expect(JSON.stringify(outcome)).not.toContain(KEY)
    expect(made[0]?.closes).toBeGreaterThan(0)
  })

  it('⚑ a gesture already cancelled never starts an app-server', async () => {
    const controller = new AbortController()
    controller.abort()
    const outcome = await changeCodexKeyInHome(
      factory(answers()),
      home,
      { to: 'the-key', apiKey: KEY },
      controller.signal,
    )
    expect(outcome.ok).toBe(false)
    expect(made).toHaveLength(0)
  })

  it('🔴 the home’s boot slot is free after every outcome — success, a refused login, a bad handshake', async () => {
    const freed = async (): Promise<boolean> => {
      const release = await Promise.race([
        beginCodexHomeBoot(home),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
      ])
      if (release === null) return false
      release()
      return true
    }
    await changeCodexKeyInHome(factory(answers()), home, { to: 'the-key', apiKey: KEY })
    expect(await freed(), 'after a success').toBe(true)
    await changeCodexKeyInHome(factory(answers({ 'account/login/start': new Error('no') })), home, {
      to: 'the-key',
      apiKey: KEY,
    })
    expect(await freed(), 'after a refused login').toBe(true)
    await changeCodexKeyInHome(
      factory(answers({ initialize: { codexHome: '/elsewhere' } })),
      home,
      { to: 'the-key', apiKey: KEY },
    )
    expect(await freed(), 'after a bad handshake').toBe(true)
  })
})
