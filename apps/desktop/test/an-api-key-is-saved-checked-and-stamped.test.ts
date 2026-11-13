import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthUnavailableError } from '@brobot2/runtime'
import type { CodexKeyOutcome } from '@brobot2/runtime/codex'
import {
  API_KEYS_FILE,
  ApiKeyUnreadableError,
  ApiKeys,
  askTheProvider,
  theCheapestModel,
  whyNotAKey,
} from '../src/main/runtime/api-keys'
import { prepareProviderHome } from '../src/main/runtime/provider-homes'
import type { CodexKeySeam } from '../src/main/providers/codex/types'

/**
 * API keys: the keys file, the provider check, and the Codex home's stamp. No test here holds a
 * real key: each uses a made-up string.
 */

const KEY = 'sk-test-0123456789abcdef' // gitleaks:allow — a made-up key

let userData: string
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'brocrew-api-keys-'))
})
afterEach(() => {
  chmodSync(userData, 0o700)
  rmSync(userData, { recursive: true, force: true })
})
const fileOf = (): string => join(userData, API_KEYS_FILE)
const CANT_BE_USED = {
  set: true,
  inUse: false,
  readState: 'unreadable',
  unreadableReason: 'Saved key can’t be read, save it again in Settings.',
}
const readTheFile = (): { keys: Record<string, { key: string; setAt: number }> } =>
  JSON.parse(readFileSync(fileOf(), 'utf8'))

describe('whyNotAKey', () => {
  it('accepts a key as a provider shows it, and refuses what no key is', () => {
    expect(whyNotAKey(KEY)).toBeNull()
    expect(whyNotAKey(`  ${KEY}\n`)).toBeNull()
    expect(whyNotAKey('')).toContain('Enter the key')
    expect(whyNotAKey('   ')).toContain('Enter the key')
    expect(whyNotAKey('sk-ant fake not a key')).toContain('no spaces or line breaks')
    expect(whyNotAKey('sk-ant\nfake')).toContain('no spaces or line breaks')
    expect(whyNotAKey('sk-ünïcode')).toContain('does not look like an API key')
    expect(whyNotAKey('a'.repeat(1024))).toBeNull()
  })

  it('never quotes what it refuses', () => {
    for (const bad of ['sk secret words', 'sk-ünïcode-secret']) {
      expect(whyNotAKey(bad)).not.toContain(bad.slice(0, 8))
    }
  })
})

describe('ApiKeys', () => {
  it('saved-key launch revisions stay distinct across replacement and removal in one clock tick', async () => {
    const keys = new ApiKeys(userData, () => 1234)
    await keys.set('codex', 'fictional-key-fern')
    const first = keys.status('codex').setAt!
    await keys.set('codex', 'fictional-key-willow')
    const second = keys.status('codex').setAt!
    await keys.remove('codex')
    await keys.set('codex', 'fictional-key-maple')
    expect(second).toBeGreaterThan(first)
    expect(keys.status('codex').setAt).toBeGreaterThan(second)
  })

  it('keeps a key in a file only the person can read, trims it, and tells the window no key', async () => {
    const keys = new ApiKeys(userData, () => 1234)
    expect(keys.status('claude')).toEqual({
      provider: 'claude',
      set: false,
      setAt: null,
      inUse: false,
      aCheckSpendsAToken: true,
    })
    expect(await keys.read('claude')).toBeNull()
    expect(existsSync(fileOf())).toBe(false)

    expect(await keys.set('claude', `  ${KEY}  `)).toBeNull()
    expect(readTheFile().keys['claude']).toEqual({ key: KEY, setAt: 1234 })
    if (process.platform !== 'win32') expect(statSync(fileOf()).mode & 0o777).toBe(0o600)
    expect(await keys.read('claude')).toBe(KEY)
    expect(await keys.current('claude')).toEqual({ key: KEY, setAt: 1234 })
    expect(keys.status('claude')).toEqual({
      provider: 'claude',
      set: true,
      setAt: 1234,
      inUse: true,
      aCheckSpendsAToken: true,
    })
    expect(JSON.stringify(keys.status('claude'))).not.toContain(KEY)
    expect(keys.status('codex').set).toBe(false)
    expect(keys.status('codex')).not.toHaveProperty('aCheckSpendsAToken')
  })

  it('a second key replaces the first, at the clock’s moment', async () => {
    let now = 10
    const keys = new ApiKeys(userData, () => now)
    await keys.set('codex', 'sk-first')
    now = 20
    await keys.set('codex', 'sk-second')
    expect(await keys.current('codex')).toEqual({ key: 'sk-second', setAt: 20 })
  })

  it('a key that is refused is not kept', async () => {
    const keys = new ApiKeys(userData)
    expect(await keys.set('claude', 'has space')).toContain('no spaces')
    expect(existsSync(fileOf())).toBe(false)
  })

  it('remove says whether there was a key, and a removed key is no key', async () => {
    const keys = new ApiKeys(userData)
    expect(await keys.remove('claude')).toBe(false)
    await keys.set('claude', KEY)
    expect(await keys.remove('claude')).toBe(true)
    expect(await keys.read('claude')).toBeNull()
    expect(keys.status('claude').set).toBe(false)
  })

  it('two providers saved in the same tick both keep their key', async () => {
    const keys = new ApiKeys(userData)
    await Promise.all([keys.set('claude', KEY), keys.set('codex', 'sk-codex-fern')])
    expect(await keys.read('claude')).toBe(KEY)
    expect(await keys.read('codex')).toBe('sk-codex-fern')
  })

  it('a keys file that can’t be read stops both starts, is left as it is, and a save sets it aside', async () => {
    writeFileSync(fileOf(), '{ not json', { mode: 0o600 })
    const keys = new ApiKeys(userData, () => 77)
    for (const provider of ['claude', 'codex'] as const) {
      expect(keys.status(provider)).toMatchObject(CANT_BE_USED)
      await expect(keys.read(provider)).rejects.toThrow(ApiKeyUnreadableError)
    }
    expect(readFileSync(fileOf(), 'utf8')).toBe('{ not json')

    expect(await keys.set('codex', 'sk-codex-fern')).toBeNull()
    expect(readFileSync(join(userData, `${API_KEYS_FILE}.unreadable-77`), 'utf8')).toBe(
      '{ not json',
    )
    expect(await keys.read('codex')).toBe('sk-codex-fern')
    // The other provider's key was in the unreadable file: it still can't be used, never the sign-in.
    expect(keys.status('claude')).toMatchObject(CANT_BE_USED)
    expect(await keys.remove('claude')).toBe(true)
    expect(keys.status('claude')).toMatchObject({ set: false, inUse: false })
    expect(await keys.read('claude')).toBeNull()
  })
})

it.skipIf(process.platform === 'win32')(
  'a save over an unreadable file that can’t be written leaves that file in place, still refusing',
  async () => {
    writeFileSync(fileOf(), '{ not json', { mode: 0o600 })
    const keys = new ApiKeys(userData, () => 77)
    chmodSync(userData, 0o500)
    expect(await keys.set('codex', 'sk-codex-fern')).toContain('couldn’t write the key')
    chmodSync(userData, 0o700)
    expect(readFileSync(fileOf(), 'utf8')).toBe('{ not json')
    for (const provider of ['claude', 'codex'] as const)
      expect(keys.status(provider)).toMatchObject(CANT_BE_USED)
  },
)

it('a stale sealed row is not opened and does not count as a current key', async () => {
  const sealed = new Set(['claude', 'codex'])
  const store = {
    hasSealedApiKey: (provider: string) => sealed.has(provider),
    forgetSealedApiKey: (provider: string) => void sealed.delete(provider),
  }
  const keys = new ApiKeys(userData, () => 5, store)
  for (const provider of ['claude', 'codex'] as const) {
    expect(keys.status(provider)).toMatchObject({ set: false, inUse: false, setAt: null })
    expect(await keys.read(provider)).toBeNull()
  }
  expect(await keys.set('claude', KEY)).toBeNull()
  expect(await keys.read('claude')).toBe(KEY)
  expect(await keys.remove('codex')).toBe(true)
  expect(await keys.read('codex')).toBeNull()
  expect(keys.status('codex')).toMatchObject({ set: false, inUse: false })
  expect(sealed.size).toBe(0)
})

it('a key saved again outranks a sealed row the save did not get to clear', async () => {
  const store = { hasSealedApiKey: () => true, forgetSealedApiKey: () => {} }
  const keys = new ApiKeys(userData, () => 5, store)
  expect(await keys.set('codex', KEY)).toBeNull()
  expect(keys.status('codex')).toMatchObject({ set: true, inUse: true })
  expect(await keys.read('codex')).toBe(KEY)
})

describe('askTheProvider', () => {
  const answering = (status: number) =>
    vi.fn(async () => ({ status }) as Response) as unknown as typeof fetch &
      ReturnType<typeof vi.fn>

  it('asks Anthropic’s free list of models with the key in x-api-key, and OpenAI’s with a bearer', async () => {
    const claude = answering(200)
    expect(await askTheProvider('claude', KEY, claude)).toEqual({ ok: true })
    const [claudeUrl, claudeInit] = (claude as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(claudeUrl).toBe('https://api.anthropic.com/v1/models?limit=100')
    expect(claudeInit).toMatchObject({
      method: 'GET',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    })
    expect(claudeInit.signal).toBeInstanceOf(AbortSignal)

    const codex = answering(204)
    expect(await askTheProvider('codex', KEY, codex)).toEqual({ ok: true })
    const [codexUrl, codexInit] = (codex as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(codexUrl).toBe('https://api.openai.com/v1/models')
    expect(codexInit.headers).toEqual({ authorization: `Bearer ${KEY}` })
  })

  it('every answer is a sentence in BroBot’s own words, and none holds the key', async () => {
    const said: string[] = []
    for (const status of [401, 403, 429, 500]) {
      const answer = await askTheProvider('claude', KEY, answering(status))
      expect(answer.ok, String(status)).toBe(false)
      if (!answer.ok) said.push(answer.reason)
    }
    expect(said[0]).toContain('Anthropic did not accept this key')
    expect(said[1]).toContain('knows this key but refused the check’s request')
    expect(said[2]).toContain('answered 429')
    expect(said[3]).toContain('answered 500')
    const refusedOpenAI = await askTheProvider('codex', KEY, answering(401))
    expect(refusedOpenAI).toMatchObject({ ok: false, reason: expect.stringContaining('OpenAI') })
    for (const sentence of said) expect(sentence).not.toContain(KEY)
  })

  it('a connection that fails says it could not reach the provider — and not what the failure said', async () => {
    const down = vi.fn(async () => {
      throw new Error(`getaddrinfo ENOTFOUND while sending ${KEY}`)
    }) as unknown as typeof fetch
    const answer = await askTheProvider('codex', KEY, down)
    expect(answer).toEqual({
      ok: false,
      reason: expect.stringContaining('could not reach OpenAI to check the key'),
    })
    expect(JSON.stringify(answer)).not.toContain(KEY)
    expect(JSON.stringify(answer)).not.toContain('ENOTFOUND')
  })

  describe('whether the key’s account can pay', () => {
    const LIST = {
      data: [{ id: 'claude-opus-9' }, { id: 'claude-haiku-9' }, { id: 'claude-haiku-8' }],
    }
    /** The model list, then the one-token request's answer. */
    const listThenAnswer = (status: number, body: unknown = {}) =>
      vi.fn(async (url: string) =>
        url.includes('/v1/models')
          ? ({ status: 200, json: async () => LIST } as unknown as Response)
          : ({ status, json: async () => body } as unknown as Response),
      ) as unknown as typeof fetch & ReturnType<typeof vi.fn>

    it('Claude: one one-token request on the newest Haiku the list names, and a funded key says so', async () => {
      const fetched = listThenAnswer(200)
      expect(await askTheProvider('claude', KEY, fetched)).toEqual({
        ok: true,
        answeredARequest: true,
      })
      const [url, init] = fetched.mock.calls[1]!
      expect(url).toBe('https://api.anthropic.com/v1/messages')
      expect(init).toMatchObject({ method: 'POST', headers: { 'x-api-key': KEY } })
      expect(JSON.parse(init.body as string)).toMatchObject({
        model: 'claude-haiku-9',
        max_tokens: 1,
      })
      expect(fetched).toHaveBeenCalledTimes(2)
    })

    it('a balance with no credit, a 402 or a billing error: the account can’t pay', async () => {
      for (const [status, body] of [
        [
          400,
          { error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } },
        ],
        [402, {}],
        [400, { error: { type: 'billing_error', message: 'x' } }],
      ] as const) {
        const answer = await askTheProvider('claude', KEY, listThenAnswer(status, body))
        expect(answer, String(status)).toMatchObject({ ok: false, cannotPay: true })
        if (!answer.ok) {
          expect(answer.reason).toContain('can’t pay for a request')
          expect(answer.reason).not.toContain('credit balance is too low')
        }
      }
    })

    it('control: another refusal of the request is not read as the account', async () => {
      const answer = await askTheProvider(
        'claude',
        KEY,
        listThenAnswer(400, { error: { type: 'invalid_request_error', message: 'bad model' } }),
      )
      expect(answer).toEqual({ ok: false, reason: expect.stringContaining('answered 400') })
    })

    it('Codex is asked for its list only', async () => {
      const fetched = listThenAnswer(200)
      expect(await askTheProvider('codex', KEY, fetched)).toEqual({ ok: true })
      expect(fetched).toHaveBeenCalledTimes(1)
    })

    it('the model is read from the list: the newest Haiku, else the newest model, else none', () => {
      expect(theCheapestModel(['claude-opus-9', 'claude-haiku-9', 'claude-haiku-8'])).toBe(
        'claude-haiku-9',
      )
      expect(theCheapestModel(['claude-opus-9', 'claude-sonnet-9'])).toBe('claude-opus-9')
      expect(theCheapestModel([])).toBeNull()
    })
  })
})

describe('prepareProviderHome with a key', () => {
  let userData: string

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-prepare-'))
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  const seams = (extra: object = {}) => ({
    provisionHome: (_root: string, home: string): void => {
      mkdirSync(home, { recursive: true })
    },
    ...extra,
  })

  it('Codex home preparation copies its sign-in without reading or applying the saved key', async () => {
    const original = JSON.stringify({ auth_mode: 'chatgpt' })
    const copied = vi.fn((home: string) => writeFileSync(join(home, 'auth.json'), original))
    const current = vi.fn(() => ({ key: KEY, setAt: 7 }))
    const changes = vi.fn(async (home: string): Promise<CodexKeyOutcome> => {
      writeFileSync(join(home, 'auth.json'), '{"auth_mode":"apikey"}')
      return { ok: true, authMethod: 'apikey' }
    })
    const seam: CodexKeySeam = { current, change: changes }
    const home = await prepareProviderHome(
      userData,
      { profileId: 'default', provider: 'codex' },
      seams({ codexKey: seam, provisionCodexAuth: copied }),
    )
    expect(current).not.toHaveBeenCalled()
    expect(changes).not.toHaveBeenCalled()
    expect(copied).toHaveBeenCalledExactlyOnceWith(home)
    expect(readFileSync(join(home, 'auth.json'), 'utf8')).toBe(original)
    expect(existsSync(join(home, 'brobot-api-key-login.json'))).toBe(false)
  })

  it('…and with no key, the copied login is laid down as before', async () => {
    const copied = vi.fn()
    const seam: CodexKeySeam = { current: () => null, change: vi.fn() }
    await prepareProviderHome(
      userData,
      { profileId: 'default', provider: 'codex' },
      seams({ codexKey: seam, provisionCodexAuth: copied }),
    )
    expect(copied).toHaveBeenCalledTimes(1)
    expect(seam.change).not.toHaveBeenCalled()
  })

  it('a Claude launch with a key set needs no login; one whose key can’t be used refuses, never falling back', async () => {
    await expect(
      prepareProviderHome(
        userData,
        { profileId: 'default', provider: 'claude' },
        seams({ apiKey: () => KEY }),
      ),
    ).resolves.toEqual(expect.any(String))

    const error = await prepareProviderHome(
      userData,
      { profileId: 'default', provider: 'claude' },
      seams({
        apiKey: () => {
          throw new ApiKeyUnreadableError('claude')
        },
      }),
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AuthUnavailableError)
    expect((error as Error).message).toContain('Saved key can’t be read')
  })
})
