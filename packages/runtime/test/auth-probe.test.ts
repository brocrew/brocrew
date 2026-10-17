import { describe, expect, it } from 'vitest'
import {
  CODEX_UNAUTHORIZED,
  blocksLaunch,
  codexAuthStateFrom,
  CODEX_SIGN_IN_REFUSED_AT_ROUTING,
  isCodexUnauthorized,
  isUsable,
  probeCodexAuth,
  type AuthState,
} from '../src/index'
import type { CodexIncoming, CodexTransport } from '../src/index'

/**
 * The credential classifier (098), pinned to the payloads the bundled 0.146.0 app-server actually
 * returned rather than to shapes invented here.
 *
 * ⚠️ **Every refusal below is paired with an acceptance**, deliberately: a test suite that only ever
 * proves "this is rejected" passes just as well over a function that rejects everything, and the
 * cost of that mistake on a credential path is an app that tells a signed-in user they are signed
 * out. The four states each get both directions.
 */

/** `getAuthStatus` with nothing provisioned — copied from an empty `CODEX_HOME`. */
const STATUS_ABSENT = { authMethod: null, authToken: null, requiresOpenaiAuth: true }
/** `getAuthStatus` for a configured ChatGPT login — identical whether it works or not. */
const STATUS_CHATGPT = { authMethod: 'chatgpt', authToken: null, requiresOpenaiAuth: true }
/** `getAuthStatus` for an API key. */
const STATUS_APIKEY = { authMethod: 'apikey', authToken: null, requiresOpenaiAuth: true }

const ACCOUNT_NONE = { account: null, requiresOpenaiAuth: true }
const ACCOUNT_CHATGPT = {
  account: { type: 'chatgpt', email: 'probe@example.invalid', planType: 'pro' },
  requiresOpenaiAuth: true,
}
const ACCOUNT_APIKEY = { account: { type: 'apiKey' }, requiresOpenaiAuth: true }

describe('codexAuthStateFrom — the four states, each proved in both directions (098)', () => {
  it('absent: the provider says there is no login, and the same call says otherwise when there is', () => {
    const absent = codexAuthStateFrom(STATUS_ABSENT, ACCOUNT_NONE)
    expect(absent.state).toBe('absent')
    expect(blocksLaunch(absent)).toBe(true)

    // The pairing. `authMethod: null` is what makes it absent — not the null account beside it,
    // which the stale case shares.
    expect(codexAuthStateFrom(STATUS_CHATGPT, ACCOUNT_CHATGPT).state).toBe('usable')
  })

  it('stale: a login is configured but the provider cannot use it', () => {
    const stale = codexAuthStateFrom(STATUS_CHATGPT, ACCOUNT_NONE)
    expect(stale.state).toBe('stale')
    expect(blocksLaunch(stale)).toBe(true)
    expect(isUsable(stale)).toBe(false)

    // The pairing, and the reason this needs two requests rather than one: `getAuthStatus` is
    // BYTE-IDENTICAL between the working case and the broken one. Only the account tells them apart.
    const working = codexAuthStateFrom(STATUS_CHATGPT, ACCOUNT_CHATGPT)
    expect(working.state).toBe('usable')
    expect(isUsable(working)).toBe(true)
  })

  it('usable: reports the account identity when the provider gives one, and copes when it does not', () => {
    expect(codexAuthStateFrom(STATUS_CHATGPT, ACCOUNT_CHATGPT)).toEqual({
      state: 'usable',
      account: 'probe@example.invalid',
      login: 'account',
      plan: 'pro',
      expiresAt: null,
    })
    // An API-key account carries no email and no plan — the generated `Account` variant is literally
    // `{type:'apiKey'}` — so it is usable with no label rather than usable with a blank one, and
    // its login is the key.
    expect(codexAuthStateFrom(STATUS_APIKEY, ACCOUNT_APIKEY)).toEqual({
      state: 'usable',
      login: 'api-key',
      expiresAt: null,
    })
  })

  it('🔒 never surfaces a token, even when the provider hands one back', () => {
    // `includeToken` is always false so this should not arrive — but if a future build volunteers it,
    // the classifier must not carry it out. The assertion is on the WHOLE serialised state.
    const state = codexAuthStateFrom(
      { ...STATUS_CHATGPT, authToken: 'sk-secret-token-value' },
      ACCOUNT_CHATGPT,
    )
    expect(JSON.stringify(state)).not.toContain('sk-secret-token-value')
    // Paired: it did not just return nothing — it still classified, and still named the account.
    expect(state).toEqual({
      state: 'usable',
      account: 'probe@example.invalid',
      login: 'account',
      plan: 'pro',
      expiresAt: null,
    })
  })

  it('unknown: a server that did not answer is NOT a server saying "signed out"', () => {
    // The key is MISSING rather than null — an older or non-conformant app-server, or a stub.
    const unanswered = codexAuthStateFrom({}, {})
    expect(unanswered.state).toBe('unknown')
    // ⚠️ The whole point: it must not block a launch on the strength of an unimplemented method.
    expect(blocksLaunch(unanswered)).toBe(false)

    // The pairing, and the distinction that makes this safe: an EXPLICIT null still means absent.
    expect(codexAuthStateFrom(STATUS_ABSENT, ACCOUNT_NONE).state).toBe('absent')
    // Half an answer is still no answer.
    expect(codexAuthStateFrom(STATUS_CHATGPT, {}).state).toBe('unknown')
    expect(codexAuthStateFrom({}, ACCOUNT_CHATGPT).state).toBe('unknown')
  })
})

describe('isCodexUnauthorized — the typed half of a turn failure (098)', () => {
  /** The measured wire `TurnError` for an expired credential. */
  const REAL_UNAUTHORIZED = {
    message:
      'Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.',
    codexErrorInfo: 'unauthorized',
    additionalDetails: null,
  }

  it('recognises the code, and does NOT recognise the same sentence without it', () => {
    expect(isCodexUnauthorized(REAL_UNAUTHORIZED)).toBe(true)
    expect(CODEX_UNAUTHORIZED).toBe('unauthorized')

    // ⚠️ The pairing that names the rule: the prose is not the signal. An adapter that reworded
    // the message must not change this answer, and a provider that sends the sentence under a
    // different code is not reporting an auth failure.
    expect(isCodexUnauthorized({ ...REAL_UNAUTHORIZED, codexErrorInfo: 'serverOverloaded' })).toBe(
      false,
    )
    expect(isCodexUnauthorized({ message: REAL_UNAUTHORIZED.message })).toBe(false)
  })

  it('is not fooled by a missing, null, or non-record error', () => {
    expect(isCodexUnauthorized(null)).toBe(false)
    expect(isCodexUnauthorized(undefined)).toBe(false)
    expect(isCodexUnauthorized('unauthorized')).toBe(false)
    // Paired against the shape that IS one, so this is not passing over four ways to say "no".
    expect(isCodexUnauthorized({ codexErrorInfo: 'unauthorized' })).toBe(true)
  })

  it('🔴 the one refusal Codex does not type is read by its sentence, whole: the turn’s own failure and nothing near it', () => {
    // As Codex 0.160 reports a sign-in refused where it finds the account's workspace, after its
    // own re-read of the file and its own try at a renewal.
    const refused = {
      message: CODEX_SIGN_IN_REFUSED_AT_ROUTING,
      codexErrorInfo: 'other',
      additionalDetails: null,
    }
    expect(CODEX_SIGN_IN_REFUSED_AT_ROUTING).toBe('workspace routing discovery unauthorized (401)')
    expect(isCodexUnauthorized(refused)).toBe(true)
    // ⛔ The warning that carries the sentence, the row this app writes for a failed turn, the
    // same request failing for another reason, and the sentence with anything added or changed.
    for (const message of [
      'warning: Falling back from WebSockets to HTTPS transport. workspace routing discovery unauthorized (401)',
      'turn failed: workspace routing discovery unauthorized (401)',
      'workspace routing discovery failed',
      'workspace routing discovery timed out',
      'workspace routing discovery unauthorized (401) ',
      'Workspace routing discovery unauthorized (401)',
      'workspace routing discovery unauthorized',
    ]) {
      expect(isCodexUnauthorized({ ...refused, message }), message).toBe(false)
    }
  })

  it('🔴 a 401 on a member that carries a status is the credential refused too; another status is not', () => {
    // As Codex 0.160 reports a key OpenAI refuses, after its reconnects (measured on a loopback).
    const refusedKey = { codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 401 } } }
    expect(isCodexUnauthorized(refusedKey)).toBe(true)
    for (const kind of [
      'responseStreamConnectionFailed',
      'responseStreamDisconnected',
      'responseTooManyFailedAttempts',
    ]) {
      expect(isCodexUnauthorized({ codexErrorInfo: { [kind]: { httpStatusCode: 401 } } })).toBe(
        true,
      )
    }
    expect(
      isCodexUnauthorized({ codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 503 } } }),
    ).toBe(false)
    expect(
      isCodexUnauthorized({ codexErrorInfo: { httpConnectionFailed: { httpStatusCode: null } } }),
    ).toBe(false)
    expect(
      isCodexUnauthorized({ codexErrorInfo: { activeTurnNotSteerable: { httpStatusCode: 401 } } }),
    ).toBe(false)
  })
})

/** A transport that answers only what a test tells it to, and records what was asked. */
class ProbeTransport implements CodexTransport {
  readonly asked: { method: string; params: unknown }[] = []
  constructor(private readonly replies: Record<string, unknown>) {}
  request(method: string, params: unknown): Promise<unknown> {
    this.asked.push({ method, params })
    if (!(method in this.replies)) return Promise.reject(new Error(`no reply for ${method}`))
    return Promise.resolve(this.replies[method])
  }
  notify(): void {}
  respond(): void {}
  respondError(): void {}
  incoming(): AsyncIterable<CodexIncoming> {
    return { [Symbol.asyncIterator]: async function* () {} }
  }
  close(): void {}
}

describe('probeCodexAuth — what it asks, and what it refuses to ask (098)', () => {
  it('🔒 asks with BOTH refresh knobs off — a probe must never spend the shared refresh token', async () => {
    const transport = new ProbeTransport({
      getAuthStatus: STATUS_CHATGPT,
      'account/read': ACCOUNT_CHATGPT,
    })
    const state = await probeCodexAuth(transport)

    expect(state).toEqual({
      state: 'usable',
      account: 'probe@example.invalid',
      login: 'account',
      plan: 'pro',
      expiresAt: null,
    })
    // The credential is SHARED with the user's own `~/.codex`, and OAuth rotates a refresh token on
    // use — so a probe that refreshed would break their CLI to find out whether their CLI works.
    expect(transport.asked).toEqual([
      { method: 'getAuthStatus', params: { includeToken: false, refreshToken: false } },
      { method: 'account/read', params: { refreshToken: false } },
    ])
  })

  it('a transport that throws is `unknown`, never a verdict about the credential', async () => {
    const broken = new ProbeTransport({})
    const state: AuthState = await probeCodexAuth(broken)
    expect(state.state).toBe('unknown')
    expect(blocksLaunch(state)).toBe(false)

    // Paired: the same probe against a working transport does reach a verdict, so this is not a
    // function that answers `unknown` to everything.
    expect(
      (
        await probeCodexAuth(
          new ProbeTransport({ getAuthStatus: STATUS_ABSENT, 'account/read': ACCOUNT_NONE }),
        )
      ).state,
    ).toBe('absent')
  })
})
