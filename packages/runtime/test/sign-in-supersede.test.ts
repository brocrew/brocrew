import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import {
  ClaudeRuntime,
  claudeKeychainTokenProvider,
  claudeKeychainTokenProviderAsync,
  credentialFingerprint,
  type ClaudeAuthTokenProvider,
  type ClaudeQuery,
  type SessionHandle,
} from '../src/index'
import { AsyncQueue } from '../src/internal/async-queue'

/**
 * 147 · A session that follows the machine account — the adapter half.
 *
 * ## §1 first, because the ticket says the rest is void if the inference is wrong
 *
 * The PM's reading was that the token is read ONCE per launch and never per turn, so a running
 * session is pinned to whatever the machine login was when its child started. That is asserted here
 * against a COUNTING provider rather than read off the source: `consultedOncePerLaunch` sends four
 * turns and expects exactly one consultation. It held.
 *
 * ## And what a hash can and cannot be asked
 *
 * ⛔ The comparison is a SHA-256 of the access token and nothing else — never the token, never the
 * expiry (which is `number | null`, so it is blind exactly when the blob changes shape). It answers
 * "the credential moved" and NOT "the account changed": the Keychain blob carries no account
 * identity at all, measured in 147 §1. Every test below is about the first question; there is no
 * test for the second because there is no mechanism for it, and inventing one would be the fabricated
 * fact 039 is about.
 */

class FakeQuery implements ClaudeQuery {
  private readonly messages = new AsyncQueue<SDKMessage>()
  end(): void {
    this.messages.close()
  }
  async interrupt(): Promise<unknown> {
    return undefined
  }
  async close(): Promise<void> {
    this.messages.close()
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.messages[Symbol.asyncIterator]()
  }
}

/**
 * A runtime whose query options are captured, over a token provider whose calls are counted.
 *
 * ⚠️ **One source, two readers** (149). The runtime now takes the blocking provider (launch, which
 * builds a spawn env and has no await to put a read in) and the non-blocking one (the turn gate,
 * which runs on Electron's main process — 148 H4). Both are wired to the same `provider` here and
 * both increment the same counter, so "consulted once per launch" is a claim about the credential
 * being read at all rather than about one of two ways of reading it.
 */
function runtimeOver(provider: ClaudeAuthTokenProvider): {
  runtime: ClaudeRuntime
  options: Options[]
  consultations: () => number
} {
  let consultations = 0
  const counted: ClaudeAuthTokenProvider = () => {
    consultations++
    return provider()
  }
  const options: Options[] = []
  return {
    runtime: new ClaudeRuntime(
      (params) => {
        options.push(params.options)
        return new FakeQuery()
      },
      async () => true,
      counted,
      async () => counted(),
    ),
    options,
    consultations: () => consultations,
  }
}

const START = { cwd: '/tmp/work', providerHome: '/managed/profile' }
const REF = { provider: 'claude' as const, sessionId: 'sess_147', cwd: '/tmp/work', rotation: 0 }

describe('147 §1 — when the machine login is actually read', () => {
  it('consults the token provider ONCE per launch and never per turn (the PM inference, asserted)', async () => {
    const { runtime, consultations } = runtimeOver(() => 'sk-ant-oat01-A')
    const handle = await runtime.start(START)
    expect(consultations()).toBe(1)

    // Four turns through the SAME live child — `send` pushes onto the long-lived prompt queue and
    // rebuilds no environment, which is the whole reason a running session is pinned.
    for (const text of ['one', 'two', 'three', 'four']) {
      await handle.send(text)
      // A turn has to end before the next may begin (008); the fake never answers, so close the turn
      // by hand the way the suite does elsewhere. What matters is only that `send` was reached.
      await handle.interrupt()
    }
    expect(consultations()).toBe(1)
  })

  it('a NEW session and a RESUME each take the credential current at that moment', async () => {
    let current = 'sk-ant-oat01-FIRST'
    const { runtime, options } = runtimeOver(() => current)

    await runtime.start(START)
    expect(options[0]?.env?.['CLAUDE_CODE_OAUTH_TOKEN']).toBe('sk-ant-oat01-FIRST')

    // The machine login is replaced between the two launches — a switch, a renewal, we cannot tell.
    current = 'sk-ant-oat01-SECOND'

    await runtime.resume(REF, { providerHome: '/managed/profile' })
    expect(options[1]?.env?.['CLAUDE_CODE_OAUTH_TOKEN']).toBe('sk-ant-oat01-SECOND')

    // ⚑ The paired positive for the whole ticket: the resume is the mechanism the fix rides on, and
    // this is the line that proves it carries the NEW credential rather than the launch one.
    expect(options[0]?.env?.['CLAUDE_CODE_OAUTH_TOKEN']).not.toBe(
      options[1]?.env?.['CLAUDE_CODE_OAUTH_TOKEN'],
    )
  })
})

describe('147 — the derived comparison', () => {
  it('is a one-way digest: not the token, stable for the same token, different for another', () => {
    const token = 'sk-ant-oat01-SECRET-VALUE'
    const fingerprint = credentialFingerprint(token)

    // 🔒 Nothing of the credential survives into the value we keep.
    expect(fingerprint).not.toContain(token)
    expect(fingerprint).not.toContain('SECRET')
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)

    expect(credentialFingerprint(token)).toBe(fingerprint) // stable — else every turn would refuse
    expect(credentialFingerprint(`${token}x`)).not.toBe(fingerprint) // and it actually discriminates
  })
})

describe('the tag a session gives the sign-in it launched on', () => {
  it('is one for two sessions on the same login, another on a renewed one, and not what the turn gate compares', async () => {
    let current = 'sk-ant-oat01-A'
    const { runtime } = runtimeOver(() => current)
    const one = await runtime.start(START)
    const two = await runtime.start(START)
    current = 'sk-ant-oat01-B'
    const renewed = await runtime.start(START)

    const tag = one.signInTag?.()
    expect(tag).toMatch(/^[0-9a-f]{32}$/)
    expect(two.signInTag?.()).toBe(tag)
    expect(renewed.signInTag?.()).toMatch(/^[0-9a-f]{32}$/)
    expect(renewed.signInTag?.()).not.toBe(tag)
    // 🔒 What a file keeps is neither the token nor the digest a turn is refused on.
    expect(credentialFingerprint('sk-ant-oat01-A')).not.toContain(tag)
  })

  it('a session launched with no login has none to give', async () => {
    const runtime = new ClaudeRuntime(
      () => new FakeQuery(),
      async () => true,
      undefined,
    )
    expect((await runtime.start(START)).signInTag?.()).toBeNull()
  })
})

describe('147 — a session notices its sign-in has been replaced', () => {
  /** Start a session on `first`, then move the machine login to `then`. */
  async function sessionAcross(
    first: string,
    then: string | null,
  ): Promise<{ handle: SessionHandle }> {
    let current: string | null = first
    const { runtime } = runtimeOver(() => current)
    const handle = await runtime.start(START)
    current = then
    return { handle }
  }

  it('says nothing while the credential is unchanged — the paired negative', async () => {
    const { handle } = await sessionAcross('sk-ant-oat01-A', 'sk-ant-oat01-A')
    expect(await handle.checkSignIn?.()).toBe(false)
    expect(handle.signInSuperseded).toBe(false)
  })

  it('reports a supersession once the machine login has been replaced', async () => {
    const { handle } = await sessionAcross('sk-ant-oat01-A', 'sk-ant-oat01-B')
    expect(handle.signInSuperseded).toBe(false) // nothing has looked yet
    expect(await handle.checkSignIn?.()).toBe(true)
    expect(handle.signInSuperseded).toBe(true) // …and the answer is latched for every free reader
  })

  it('LATCHES: a credential that comes back does not un-supersede a child that cannot use it', async () => {
    let current = 'sk-ant-oat01-A'
    const { runtime } = runtimeOver(() => current)
    const handle = await runtime.start(START)
    current = 'sk-ant-oat01-B'
    expect(await handle.checkSignIn?.()).toBe(true)
    // A rotation back to the original bytes is not a thing OAuth does, but a stale read or a restored
    // Keychain backup is — and the child was launched with a token that a rotation has already
    // revoked (110). Un-latching would offer it a turn it cannot take.
    current = 'sk-ant-oat01-A'
    expect(await handle.checkSignIn?.()).toBe(true)
    expect(handle.signInSuperseded).toBe(true)
  })

  it('a Keychain that yields NOTHING is not a supersession — we could not look, so we do not judge', async () => {
    const { handle } = await sessionAcross('sk-ant-oat01-A', null)
    expect(await handle.checkSignIn?.()).toBe(false)
    expect(handle.signInSuperseded).toBe(false)
  })

  it('a session launched with no auth bridge at all never reports one (the library default)', async () => {
    const options: Options[] = []
    const runtime = new ClaudeRuntime(
      (params) => {
        options.push(params.options)
        return new FakeQuery()
      },
      async () => true,
      undefined,
    )
    const handle = await runtime.start(START)
    expect(options[0]?.env?.['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined()
    expect(await handle.checkSignIn?.()).toBe(false)
    expect(handle.signInSuperseded).toBe(false)
  })

  it('a RESUMED session watches its sign-in too — the half that needs it most', async () => {
    let current = 'sk-ant-oat01-A'
    const { runtime } = runtimeOver(() => current)
    const handle = await runtime.resume(REF, { providerHome: '/managed/profile' })
    expect(await handle.checkSignIn?.()).toBe(false)
    current = 'sk-ant-oat01-B'
    expect(await handle.checkSignIn?.()).toBe(true)
  })

  it('asks the NON-BLOCKING reader, and a runtime with only the blocking one never reports (149)', async () => {
    // ⛔ 148 H4: the check ran `execFileSync` on Electron's main process. The fix is not "the same
    // read, wrapped" — the handle is handed the asynchronous provider and nothing else, so there is
    // no blocking reader for a later refactor to fall back to. A runtime constructed the old way
    // still LAUNCHES (the credential is injected from the blocking provider, which is where it has
    // to be read) and simply never notices a move.
    let current = 'sk-ant-oat01-A'
    const runtime = new ClaudeRuntime(
      () => new FakeQuery(),
      async () => true,
      () => current,
    )
    const handle = await runtime.start(START)
    current = 'sk-ant-oat01-B'
    expect(await handle.checkSignIn?.()).toBe(false)
    expect(handle.signInSuperseded).toBe(false)
  })

  it('and the two readers answer identically over one blob — same parse, same rules (149)', async () => {
    const blob = (token: string, expiresAt: number): string =>
      JSON.stringify({ claudeAiOauth: { accessToken: token, expiresAt } })
    const now = 1_000_000
    const live = blob('sk-ant-oat01-LIVE', now + 60_000)
    const expired = blob('sk-ant-oat01-DEAD', now - 1)

    const sync = claudeKeychainTokenProvider(
      () => live,
      () => now,
    )
    const async_ = claudeKeychainTokenProviderAsync(
      async () => live,
      () => now,
    )
    expect(sync()).toBe('sk-ant-oat01-LIVE')
    expect(await async_()).toBe('sk-ant-oat01-LIVE')

    // …including the answers that are NOT a token. An expired blob and a malformed one are both
    // "unavailable", and the gate reads unavailable as "cannot tell" rather than as a supersession.
    expect(
      claudeKeychainTokenProvider(
        () => expired,
        () => now,
      )(),
    ).toBeNull()
    expect(
      await claudeKeychainTokenProviderAsync(
        async () => expired,
        () => now,
      )(),
    ).toBeNull()
    expect(
      await claudeKeychainTokenProviderAsync(
        async () => 'not json',
        () => now,
      )(),
    ).toBeNull()
    expect(
      await claudeKeychainTokenProviderAsync(
        async () => null,
        () => now,
      )(),
    ).toBeNull()
  })

  it('compares against the credential it was LAUNCHED with, not a second read of its own', async () => {
    // One read per launch is what makes this true, and it is why `optionsFor` takes the digest from
    // the very bytes it injects rather than asking the provider again: a provider that answered
    // differently on a second call would otherwise pin the session to a credential no child ever had.
    let call = 0
    const { runtime, options } = runtimeOver(() => `sk-ant-oat01-${++call}`)
    const handle = await runtime.start(START)
    const injected = options[0]?.env?.['CLAUDE_CODE_OAUTH_TOKEN']
    expect(injected).toBe('sk-ant-oat01-1')
    // The next read yields `-2`, so a session that had fingerprinted a second read would compare
    // `-2` against `-3` here and report nothing wrong. It compares `-1` against `-2`.
    expect(await handle.checkSignIn?.()).toBe(true)
  })

  it('two LIVE children launched either side of a rotation disagree — the latch is per session (652, from 643 F6)', async () => {
    // ⛔ **Every other test here watches ONE handle**, and a single handle cannot tell a latch that
    // belongs to its session from one that belongs to the runtime every session shares. ⚑ This is
    // the hypothesis `643` confirmed from the mechanism and left as a sketch: what decides whether a
    // conversation is refused is the credential ITS child was launched with, not when it was spawned.
    let current = 'sk-ant-oat01-FIRST'
    const { runtime, options } = runtimeOver(() => current)
    const early = await runtime.start(START)
    current = 'sk-ant-oat01-SECOND'
    const late = await runtime.start(START)
    // The premise: two launches, two credentials — each child really was handed a different one.
    expect(options.map((each) => each.env?.['CLAUDE_CODE_OAUTH_TOKEN'])).toEqual([
      'sk-ant-oat01-FIRST',
      'sk-ant-oat01-SECOND',
    ])

    // ⚠️ **`early` FIRST, and the order is load-bearing**: asked second, a latch shared across the
    // runtime would already be set by the time `late` answered, and `late` first would pass over it.
    expect(await early.checkSignIn?.()).toBe(true) // launched on the old one
    expect(await late.checkSignIn?.()).toBe(false) // launched on the new one
    // …and the free readers the disclosures use say the same, per handle.
    expect(early.signInSuperseded).toBe(true)
    expect(late.signInSuperseded).toBe(false)
  })
})
