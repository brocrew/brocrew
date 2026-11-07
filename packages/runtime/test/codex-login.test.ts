import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexIncoming, CodexTransport } from '../src/index'
import { signInNotCheckedInTime } from '../src/auth-state'
import { AsyncQueue } from '../src/internal/async-queue'
import { probeCodexAuthInHome, startCodexLogin } from '../src/codex/codex-login'
import { beginCodexHomeBoot, resetCodexHomeBoots } from '../src/codex/home-boot'

const STATUS_CHATGPT = { authMethod: 'chatgpt', authToken: null, requiresOpenaiAuth: true }
const ACCOUNT_CHATGPT = {
  account: { type: 'chatgpt', email: 'probe@example.invalid', planType: 'pro' },
}

class SilentTransport implements CodexTransport {
  private readonly queue = new AsyncQueue<CodexIncoming>()
  private readonly pending = new Set<(error: Error) => void>()
  readonly requests: string[] = []
  closes = 0

  constructor(
    readonly home: string,
    private readonly answers: Record<string, unknown> | null,
  ) {}

  request(method: string): Promise<unknown> {
    this.requests.push(method)
    const answer = this.answers?.[method]
    if (answer !== undefined) return Promise.resolve(answer)
    return new Promise((_resolve, reject) => this.pending.add(reject))
  }
  notify(): void {}
  respond(): void {}
  respondError(): void {}
  incoming(): AsyncIterable<CodexIncoming> {
    return this.queue
  }
  holdClose: Promise<void> | null = null
  close(): Promise<void> | void {
    if (this.closes > 0) return this.closing ?? undefined
    this.closes += 1
    for (const reject of this.pending) reject(new Error('transport closed'))
    this.pending.clear()
    this.queue.close()
    if (this.holdClose === null) return undefined
    this.closing = this.holdClose
    return this.closing
  }
  private closing: Promise<void> | null = null
}

describe('185 · a credential gesture owns its app-server from the spawn', () => {
  let root: string
  let spawned: SilentTransport[]

  beforeEach(() => {
    resetCodexHomeBoots()
    root = mkdtempSync(join(tmpdir(), 'brobot2-login-'))
    spawned = []
  })
  afterEach(() => {
    for (const transport of spawned) transport.close()
    resetCodexHomeBoots()
    rmSync(root, { recursive: true, force: true })
  })

  const transports =
    (answers: Record<string, unknown> | null) =>
    ({ providerHome }: { providerHome: string }): CodexTransport => {
      const transport = new SilentTransport(providerHome, answers)
      spawned.push(transport)
      return transport
    }

  const answering = (home: string): Record<string, unknown> => ({
    initialize: { codexHome: home },
    'account/login/start': { loginId: 'login_a1', authUrl: 'https://auth.openai.com/authorize?x' },
    'account/login/cancel': { status: 'canceled' },
    getAuthStatus: STATUS_CHATGPT,
    'account/read': ACCOUNT_CHATGPT,
  })

  async function gateWait(home: string): Promise<number> {
    const started = Date.now()
    const release = await beginCodexHomeBoot(home, { waitMs: 400 })
    const waited = Date.now() - started
    release()
    return waited
  }

  it('⛔ A · a check whose handshake is slow is waited for; a cancel ends it, with no transport open and no gate held', async () => {
    const home = join(root, 'codex')
    const asking = new AbortController()
    let answered = false
    const checking = probeCodexAuthInHome(transports(null), home, home, asking.signal).then(
      (state) => {
        answered = true
        return state
      },
    )
    await new Promise((resolve) => setTimeout(resolve, 8_500))
    expect(answered).toBe(false)
    expect(spawned[0]!.closes).toBe(0)

    asking.abort()
    const state = await checking
    expect(state.state).toBe('unknown')
    expect(state.state === 'unknown' && state.reason).not.toBe(signInNotCheckedInTime('Codex'))
    expect(spawned).toHaveLength(1)
    expect(spawned[0]!.closes, 'the app-server it spawned was closed').toBe(1)
    expect(await gateWait(home), "the home's boot gate was handed back").toBeLessThan(200)
  }, 20_000)

  it('…and the pairing: an ordinary check still answers, and still releases', async () => {
    const home = join(root, 'codex')
    const state = await probeCodexAuthInHome(transports(answering(home)), home, home)

    expect(state).toEqual({
      state: 'usable',
      account: 'probe@example.invalid',
      login: 'account',
      plan: 'pro',
      expiresAt: null,
    })
    expect(spawned[0]!.closes, 'a check closes its app-server on the way out too').toBe(1)
    expect(await gateWait(home)).toBeLessThan(200)
  })

  it('⛔ B · a sign-in whose handshake is slow is waited for; a cancel closes the child rather than stranding it', async () => {
    const home = join(root, 'codex')
    const signing = new AbortController()
    let settled = false
    const login = startCodexLogin(transports(null), home, home, signing.signal).finally(() => {
      settled = true
    })
    login.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 8_500))
    expect(settled).toBe(false)
    expect(spawned[0]!.closes).toBe(0)

    signing.abort()
    await expect(login).rejects.toThrow()
    expect(spawned).toHaveLength(1)
    expect(spawned[0]!.closes).toBe(1)
    expect(await gateWait(home)).toBeLessThan(200)
  }, 20_000)

  it('…and the pairing: an ordinary sign-in gets its URL, keeps the child, and frees the gate', async () => {
    const home = join(root, 'codex')
    const { login, start } = await startCodexLogin(transports(answering(home)), home, home)

    expect(start.authUrl).toBe('https://auth.openai.com/authorize?x')
    expect(spawned[0]!.closes).toBe(0)
    expect(await gateWait(home), 'the gate is not held across the browser round trip').toBeLessThan(
      200,
    )
    await login.cancel()
    expect(spawned[0]!.closes).toBe(1)
  })

  it('a Cancel the provider never acknowledges still tears the app-server down', async () => {
    const home = join(root, 'codex')
    const { login } = await startCodexLogin(
      transports({
        initialize: { codexHome: home },
        'account/login/start': { loginId: 'login_a1', authUrl: 'https://auth.openai.com/x' },
      }),
      home,
      home,
    )
    expect(spawned[0]!.closes).toBe(0)

    await login.cancel()

    expect(spawned[0]!.requests, 'it did tell the provider first').toContain('account/login/cancel')
    expect(spawned[0]!.closes, 'and tore the child down when it heard nothing back').toBe(1)
    expect(await login.completed()).toMatchObject({ success: false, error: 'canceled' })
  }, 20_000)

  it('an abort during the handshake closes the child, on both paths', async () => {
    const home = join(root, 'codex')

    const checking = new AbortController()
    const check = probeCodexAuthInHome(transports(null), home, home, checking.signal)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(spawned).toHaveLength(1)
    checking.abort()
    expect(spawned[0]!.closes, 'the abort reached the child, not just its awaiter').toBe(1)
    expect(await check).toMatchObject({ state: 'unknown' })

    const signing = new AbortController()
    const login = startCodexLogin(transports(null), home, home, signing.signal)
    login.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(spawned).toHaveLength(2)
    signing.abort()
    expect(spawned[1]!.closes, 'the abort reached the sign-in`s child too').toBe(1)
    await expect(login).rejects.toThrow()
    expect(await gateWait(home)).toBeLessThan(200)
  }, 20_000)

  it('a gesture cancelled before it starts leaves no state to unwind', async () => {
    const home = join(root, 'codex')
    const aborted = AbortSignal.abort()

    expect(await probeCodexAuthInHome(transports(null), home, home, aborted)).toMatchObject({
      state: 'unknown',
    })
    await expect(startCodexLogin(transports(null), home, home, aborted)).rejects.toThrow(
      /cancelled before it started/,
    )
    expect(spawned, 'nothing was spawned').toEqual([])
  })

  it('waits for a later step that is slow, rather than calling Codex too slow', async () => {
    const home = join(root, 'codex')
    let answered = false
    const asking = new AbortController()
    const checking = probeCodexAuthInHome(
      transports({ initialize: { codexHome: home } }),
      home,
      home,
      asking.signal,
    ).then((state) => {
      answered = true
      return state
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(answered).toBe(false)
    asking.abort()
    expect((await checking).state).toBe('unknown')
  }, 20_000)

  it('⛔ a second cancel JOINS the first teardown instead of walking past it', async () => {
    const home = join(root, 'codex')
    const { login } = await startCodexLogin(transports(answering(home)), home, home)
    const transport = spawned[0]!

    let finishClose!: () => void
    transport.holdClose = new Promise<void>((resolve) => (finishClose = resolve))

    let firstDone = false
    let secondDone = false
    const first = login.cancel().then(() => (firstDone = true))

    await vi.waitFor(() => expect(transport.closes).toBe(1))
    const second = login.cancel().then(() => (secondDone = true))

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(firstDone, 'the first caller is still tearing down').toBe(false)
    expect(secondDone, 'and the second must not have been told it was over').toBe(false)

    finishClose()
    await Promise.all([first, second])
    expect(firstDone && secondDone).toBe(true)
    expect(transport.closes, 'the child was reaped exactly once').toBe(1)
  })

  it('…and the pairing: one cancel on its own still resolves, and still closes the child', async () => {
    const home = join(root, 'codex')
    const { login } = await startCodexLogin(transports(answering(home)), home, home)
    await login.cancel()
    expect(spawned[0]!.closes).toBe(1)
    expect(await login.completed()).toMatchObject({ success: false, error: 'canceled' })
  })
})
