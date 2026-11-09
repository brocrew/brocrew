import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthUnavailableError, type CodexKeyChange, type CodexKeyOutcome } from '@brobot2/runtime'
import {
  API_KEY_MAX_LENGTH,
  API_KEYS_FILE,
  ApiKeyUnreadableError,
  ApiKeys,
  askTheProvider,
  theCheapestModel,
  whyNotAKey,
  type EarlierKeys,
} from '../src/main/runtime/api-keys'
import { bringTheCodexKeyTo, prepareProviderHome } from '../src/main/runtime/provider-homes'
import type { CodexKeySeam } from '../src/main/runtime/provider-homes'

/**
 * API keys: the keys file, the move of keys an earlier version sealed, the provider check, and the
 * Codex home's stamp. No test here holds a real key or opens a real Keychain: each uses a made-up
 * string and a fake opener.
 */

const KEY = 'sk-test-0123456789abcdef' // gitleaks:allow — a made-up key
const OLD_KEY = 'sk-test-earlier-0123456789' // gitleaks:allow — a made-up key

/** The database rows an earlier version sealed, in memory. "Sealed" is the key reversed. */
function earlierRows(
  rows: Partial<Record<'claude' | 'codex', { setAt: number; key: string }>> = {},
) {
  const kept = new Map<string, { sealed: string; setAt: number }>()
  for (const [provider, row] of Object.entries(rows))
    kept.set(provider, { sealed: seal(row.key), setAt: row.setAt })
  const store: EarlierKeys & { kept: typeof kept } = {
    kept,
    earlierApiKey: (provider) => kept.get(provider) ?? null,
    forgetEarlierApiKey: (provider) => {
      kept.delete(provider)
    },
  }
  return store
}
const seal = (key: string): string => [...key].reverse().join('')
const open = vi.fn(async (sealed: string) => seal(sealed))

let userData: string
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'brocrew-api-keys-'))
  open.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
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
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve))
}
function held<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('whyNotAKey', () => {
  it('🔴 accepts a key as a provider shows it, and refuses what no key is', () => {
    expect(whyNotAKey(KEY)).toBeNull()
    expect(whyNotAKey(`  ${KEY}\n`)).toBeNull()
    expect(whyNotAKey('')).toContain('Enter the key')
    expect(whyNotAKey('   ')).toContain('Enter the key')
    expect(whyNotAKey('sk-ant fake not a key')).toContain('no spaces or line breaks')
    expect(whyNotAKey('sk-ant\nfake')).toContain('no spaces or line breaks')
    expect(whyNotAKey('sk-ünïcode')).toContain('does not look like an API key')
    expect(whyNotAKey('a'.repeat(API_KEY_MAX_LENGTH + 1))).toContain('does not look like')
    expect(whyNotAKey('a'.repeat(API_KEY_MAX_LENGTH))).toBeNull()
  })

  it('⛔ never quotes what it refuses', () => {
    for (const bad of ['sk secret words', 'sk-ünïcode-secret', 'x'.repeat(600)]) {
      expect(whyNotAKey(bad)).not.toContain(bad.slice(0, 8))
    }
  })
})

describe('ApiKeys', () => {
  it('saved-key launch revisions stay distinct across replacement and removal in one clock tick', async () => {
    const keys = new ApiKeys(userData, earlierRows(), () => 1234)
    await keys.set('codex', 'fictional-key-fern')
    const first = keys.status('codex').setAt!
    await keys.set('codex', 'fictional-key-willow')
    const second = keys.status('codex').setAt!
    await keys.remove('codex')
    await keys.set('codex', 'fictional-key-maple')
    expect(second).toBeGreaterThan(first)
    expect(keys.status('codex').setAt).toBeGreaterThan(second)
  })

  it('🔴 keeps a key in a file only the person can read, trims it, and tells the window no key', async () => {
    const keys = new ApiKeys(userData, earlierRows(), () => 1234)
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

  it('⚑ a second key replaces the first, at the clock’s moment', async () => {
    let now = 10
    const keys = new ApiKeys(userData, earlierRows(), () => now)
    await keys.set('codex', 'sk-first')
    now = 20
    await keys.set('codex', 'sk-second')
    expect(await keys.current('codex')).toEqual({ key: 'sk-second', setAt: 20 })
  })

  it('⛔ a key that is refused is not kept', async () => {
    const keys = new ApiKeys(userData, earlierRows())
    expect(await keys.set('claude', 'has space')).toContain('no spaces')
    expect(existsSync(fileOf())).toBe(false)
  })

  it('⚑ remove says whether there was a key, and a removed key is no key', async () => {
    const keys = new ApiKeys(userData, earlierRows())
    expect(await keys.remove('claude')).toBe(false)
    await keys.set('claude', KEY)
    expect(await keys.remove('claude')).toBe(true)
    expect(await keys.read('claude')).toBeNull()
    expect(keys.status('claude').set).toBe(false)
  })

  it('🔴 two providers saved in the same tick both keep their key', async () => {
    const keys = new ApiKeys(userData, earlierRows())
    await Promise.all([keys.set('claude', KEY), keys.set('codex', 'sk-codex-fern')])
    expect(await keys.read('claude')).toBe(KEY)
    expect(await keys.read('codex')).toBe('sk-codex-fern')
  })

  it('🔴 a keys file that can’t be read stops both starts, is left as it is, and a save sets it aside', async () => {
    writeFileSync(fileOf(), '{ not json', { mode: 0o600 })
    const keys = new ApiKeys(userData, earlierRows(), () => 77)
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
  '🔴 a save over an unreadable file that can’t be written leaves that file in place, still refusing',
  async () => {
    writeFileSync(fileOf(), '{ not json', { mode: 0o600 })
    const keys = new ApiKeys(userData, earlierRows(), () => 77)
    chmodSync(userData, 0o500)
    expect(await keys.set('codex', 'sk-codex-fern')).toContain('couldn’t write the key')
    chmodSync(userData, 0o700)
    expect(readFileSync(fileOf(), 'utf8')).toBe('{ not json')
    for (const provider of ['claude', 'codex'] as const)
      expect(keys.status(provider)).toMatchObject(CANT_BE_USED)
  },
)

describe('moving the keys an earlier version sealed', () => {
  it('🔴 a key moves once with its own time, its sealed row goes, and a second start opens nothing', async () => {
    const rows = earlierRows({ codex: { key: OLD_KEY, setAt: 555 } })
    const moved = vi.fn()
    const keys = new ApiKeys(userData, rows)
    expect(keys.status('codex')).toMatchObject({ ...CANT_BE_USED, setAt: 555 })
    await keys.moveEarlierKeys(open, moved)
    expect(await keys.current('codex')).toEqual({ key: OLD_KEY, setAt: 555 })
    expect(rows.kept.size).toBe(0)
    expect(open).toHaveBeenCalledTimes(1)
    expect(keys.revision('codex')).toBe(1)
    expect(moved).toHaveBeenCalledWith('codex')

    await new ApiKeys(userData, rows).moveEarlierKeys(open, moved)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('⚑ no rows and no file: nothing is opened or written', async () => {
    await new ApiKeys(userData, earlierRows()).moveEarlierKeys(open, vi.fn())
    expect(open).not.toHaveBeenCalled()
    expect(readdirSync(userData)).toEqual([])
  })

  it('🔴 a crash after the write and before the row goes: the next start drops the row unopened', async () => {
    const rows = earlierRows({ claude: { key: OLD_KEY, setAt: 9 } })
    const forget = rows.forgetEarlierApiKey
    rows.forgetEarlierApiKey = () => {
      throw new Error('the app stopped here')
    }
    await new ApiKeys(userData, rows).moveEarlierKeys(open, vi.fn()).catch(() => undefined)
    expect(rows.kept.size).toBe(1)
    rows.forgetEarlierApiKey = forget
    open.mockClear()
    const keys = new ApiKeys(userData, rows)
    await keys.moveEarlierKeys(open, vi.fn())
    expect(open).not.toHaveBeenCalled()
    expect(rows.kept.size).toBe(0)
    expect(await keys.read('claude')).toBe(OLD_KEY)
  })

  it.skipIf(process.platform === 'win32')(
    '🔴 a write that fails keeps the row, and the key can’t be used until the next start moves it',
    async () => {
      const rows = earlierRows({ claude: { key: OLD_KEY, setAt: 9 } })
      const keys = new ApiKeys(userData, rows)
      chmodSync(userData, 0o500)
      await keys.moveEarlierKeys(open, vi.fn())
      chmodSync(userData, 0o700)
      expect(rows.kept.size).toBe(1)
      expect(existsSync(fileOf())).toBe(false)
      expect(keys.status('claude')).toMatchObject(CANT_BE_USED)
      await expect(keys.read('claude')).rejects.toThrow(ApiKeyUnreadableError)

      const next = new ApiKeys(userData, rows)
      await next.moveEarlierKeys(open, vi.fn())
      expect(await next.read('claude')).toBe(OLD_KEY)
      expect(rows.kept.size).toBe(0)
    },
  )

  it('🔴 while the system has not answered, a start is refused at once in the plain words, never on the sign-in', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const rows = earlierRows({ claude: { key: OLD_KEY, setAt: 9 } })
    const keys = new ApiKeys(userData, rows)
    const moving = keys.moveEarlierKeys(() => new Promise<string>(() => {}), vi.fn())
    await settle()
    expect(keys.status('claude')).toMatchObject(CANT_BE_USED)
    const started = performance.now()
    await expect(keys.read('claude')).rejects.toThrow('Saved key can’t be read')
    await expect(keys.current('claude')).rejects.toThrow(ApiKeyUnreadableError)
    expect(performance.now() - started).toBeLessThan(50)
    expect(vi.getTimerCount()).toBe(0)
    expect(rows.kept.size).toBe(1)
    void moving
  })

  it('🔴 a key the system refuses to open can’t be used, and the move itself throws nothing', async () => {
    const rows = earlierRows({ codex: { key: OLD_KEY, setAt: 9 } })
    const keys = new ApiKeys(userData, rows)
    const moved = vi.fn()
    await keys.moveEarlierKeys(async () => {
      throw new Error('Error while decrypting the ciphertext')
    }, moved)
    expect(keys.status('codex')).toEqual({ provider: 'codex', setAt: 9, ...CANT_BE_USED })
    await expect(keys.read('codex')).rejects.toThrow(ApiKeyUnreadableError)
    expect(rows.kept.size).toBe(1)
    expect(moved).not.toHaveBeenCalled()
  })

  it('🔴 a key saved while the old one is being opened wins, with no refusal', async () => {
    const rows = earlierRows({ claude: { key: OLD_KEY, setAt: 9 } })
    const keys = new ApiKeys(userData, rows, () => 1000)
    const opened = held<string>()
    const moving = keys.moveEarlierKeys(() => opened.promise, vi.fn())
    await settle()
    expect(await keys.set('claude', KEY)).toBeNull()
    expect(rows.kept.size).toBe(0)
    opened.resolve(OLD_KEY)
    await moving
    expect(await keys.current('claude')).toEqual({ key: KEY, setAt: 1000 })
    expect(keys.status('claude')).toMatchObject({ set: true, inUse: true })
  })

  it('🔴 a key removed while the old one is being opened stays removed, and nothing is written', async () => {
    const rows = earlierRows({ claude: { key: OLD_KEY, setAt: 9 } })
    const keys = new ApiKeys(userData, rows)
    const opened = held<string>()
    const moving = keys.moveEarlierKeys(() => opened.promise, vi.fn())
    await settle()
    expect(await keys.remove('claude')).toBe(true)
    opened.resolve(OLD_KEY)
    await moving
    expect(await keys.read('claude')).toBeNull()
    expect(rows.kept.size).toBe(0)
    expect(existsSync(fileOf()) ? readTheFile().keys['claude'] : undefined).toBeUndefined()
    expect(keys.status('claude')).toMatchObject({ set: false, inUse: false })
  })

  it('🔴 a row a restored database brings back after the move is dropped unopened', async () => {
    const rows = earlierRows({ claude: { key: OLD_KEY, setAt: 9 } })
    const keys = new ApiKeys(userData, rows)
    await keys.moveEarlierKeys(open, vi.fn())
    await keys.remove('claude')
    rows.kept.set('claude', { sealed: seal(OLD_KEY), setAt: 9 })
    open.mockClear()
    const next = new ApiKeys(userData, rows)
    await next.moveEarlierKeys(open, vi.fn())
    expect(open).not.toHaveBeenCalled()
    expect(rows.kept.size).toBe(0)
    expect(await next.read('claude')).toBeNull()
  })

  it('🔴 a key removed after a failed move stays removed when a restored database brings its row back', async () => {
    const rows = earlierRows({ claude: { key: OLD_KEY, setAt: 9 } })
    const keys = new ApiKeys(userData, rows)
    await keys.moveEarlierKeys(async () => {
      throw new Error('denied')
    }, vi.fn())
    expect(await keys.remove('claude')).toBe(true)
    rows.kept.set('claude', { sealed: seal(OLD_KEY), setAt: 9 })
    open.mockClear()
    const next = new ApiKeys(userData, rows)
    await next.moveEarlierKeys(open, vi.fn())
    expect(open).not.toHaveBeenCalled()
    expect(rows.kept.size).toBe(0)
    expect(await next.read('claude')).toBeNull()
    expect(next.status('claude')).toMatchObject({ set: false })
  })

  it('🔴 a moved Codex key keeps its time, so a home logged in with it is not logged in again', async () => {
    const home = mkdtempSync(join(tmpdir(), 'brocrew-codex-home-'))
    try {
      writeFileSync(join(home, 'auth.json'), '{}')
      writeFileSync(join(home, 'brobot-api-key-login.json'), JSON.stringify({ setAt: 555 }))
      const keys = new ApiKeys(userData, earlierRows({ codex: { key: OLD_KEY, setAt: 555 } }))
      await keys.moveEarlierKeys(open, vi.fn())
      const change = vi.fn()
      expect(await bringTheCodexKeyTo(home, { current: () => keys.current('codex'), change })).toBe(
        'the-key',
      )
      expect(change).not.toHaveBeenCalled()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('askTheProvider', () => {
  const answering = (status: number) =>
    vi.fn(async () => ({ status }) as Response) as unknown as typeof fetch &
      ReturnType<typeof vi.fn>

  it('🔴 asks Anthropic’s free list of models with the key in x-api-key, and OpenAI’s with a bearer', async () => {
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

  it('⛔ every answer is a sentence in BroBot’s own words, and none holds the key', async () => {
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

  it('🔴 a connection that fails says it could not reach the provider — and not what the failure said', async () => {
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

    it('🔴 Claude: one one-token request on the newest Haiku the list names, and a funded key says so', async () => {
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

    it('🔴 a balance with no credit, a 402 or a billing error: the account can’t pay', async () => {
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

    it('⚑ control: another refusal of the request is not read as the account', async () => {
      const answer = await askTheProvider(
        'claude',
        KEY,
        listThenAnswer(400, { error: { type: 'invalid_request_error', message: 'bad model' } }),
      )
      expect(answer).toEqual({ ok: false, reason: expect.stringContaining('answered 400') })
    })

    it('⚑ Codex is asked for its list only', async () => {
      const fetched = listThenAnswer(200)
      expect(await askTheProvider('codex', KEY, fetched)).toEqual({ ok: true })
      expect(fetched).toHaveBeenCalledTimes(1)
    })

    it('⚑ the model is read from the list: the newest Haiku, else the newest model, else none', () => {
      expect(theCheapestModel(['claude-opus-9', 'claude-haiku-9', 'claude-haiku-8'])).toBe(
        'claude-haiku-9',
      )
      expect(theCheapestModel(['claude-opus-9', 'claude-sonnet-9'])).toBe('claude-opus-9')
      expect(theCheapestModel([])).toBeNull()
    })
  })
})

describe('bringTheCodexKeyTo', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'brobot2-codexkey-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  const STAMP = 'brobot-api-key-login.json'
  const stamp = () => JSON.parse(readFileSync(join(home, STAMP), 'utf8')) as { setAt: number }

  function aSeam(
    current: () => { key: string; setAt: number } | null,
    change: (home: string, change: CodexKeyChange) => Promise<CodexKeyOutcome> = async (_h, c) => {
      // A real login writes the credential the stamp is later checked against.
      if (c.to === 'the-key') writeFileSync(join(home, 'auth.json'), '{}')
      return { ok: true, authMethod: c.to === 'the-key' ? 'apikey' : null }
    },
  ) {
    const changes = vi.fn(change)
    const seam: CodexKeySeam = { current, change: changes }
    return { seam, changes }
  }

  it('🔴 with no key and no stamp the home keeps its copied login, and Codex is not asked', async () => {
    const { seam, changes } = aSeam(() => null)
    expect(await bringTheCodexKeyTo(home, seam)).toBe('its-login')
    expect(changes).not.toHaveBeenCalled()
  })

  it('🔴 a key logs the home in once, stamps WHEN it was saved (never the key), and a second look changes nothing', async () => {
    const { seam, changes } = aSeam(() => ({ key: KEY, setAt: 500 }))
    expect(await bringTheCodexKeyTo(home, seam)).toBe('the-key')
    expect(changes).toHaveBeenCalledTimes(1)
    expect(changes).toHaveBeenCalledWith(home, { to: 'the-key', apiKey: KEY })
    expect(stamp()).toEqual({ setAt: 500 })
    expect(readFileSync(join(home, STAMP), 'utf8')).not.toContain(KEY)

    expect(await bringTheCodexKeyTo(home, seam)).toBe('the-key')
    expect(changes).toHaveBeenCalledTimes(1)
  })

  it('⛔ the stamp stands only while the home still holds a login: a stamp over no auth.json logs in again', async () => {
    const { seam, changes } = aSeam(() => ({ key: KEY, setAt: 500 }))
    await bringTheCodexKeyTo(home, seam)
    rmSync(join(home, 'auth.json'))
    await bringTheCodexKeyTo(home, seam)
    expect(changes).toHaveBeenCalledTimes(2)
  })

  it('🔴 a key saved again (a later moment) logs the home in again, with the new one', async () => {
    let setAt = 500
    let key = 'sk-first'
    const { seam, changes } = aSeam(() => ({ key, setAt }))
    await bringTheCodexKeyTo(home, seam)
    setAt = 900
    key = 'sk-second'
    await bringTheCodexKeyTo(home, seam)
    expect(changes).toHaveBeenLastCalledWith(home, { to: 'the-key', apiKey: 'sk-second' })
    expect(stamp()).toEqual({ setAt: 900 })
  })

  it('🔴 a removed key logs the home out, drops the stamp, and hands the home back to its copied login', async () => {
    let held: { key: string; setAt: number } | null = { key: KEY, setAt: 500 }
    const { seam, changes } = aSeam(() => held)
    await bringTheCodexKeyTo(home, seam)
    held = null
    expect(await bringTheCodexKeyTo(home, seam)).toBe('its-login')
    expect(changes).toHaveBeenLastCalledWith(home, { to: 'no-key' })
    expect(existsSync(join(home, STAMP))).toBe(false)
    // …and with the stamp gone, the next look has nothing to undo.
    await bringTheCodexKeyTo(home, seam)
    expect(changes).toHaveBeenCalledTimes(2)
  })

  it('⛔ a login that fails refuses in BroBot’s words and stamps nothing — never a quiet fallback', async () => {
    const failing = aSeam(
      () => ({ key: KEY, setAt: 500 }),
      async () => ({ ok: false, reason: 'Codex did not start.' }),
    )
    const error = await bringTheCodexKeyTo(home, failing.seam).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AuthUnavailableError)
    expect((error as AuthUnavailableError).provider).toBe('codex')
    expect((error as Error).message).toBe('Codex did not start. Try again in a moment.')
    expect(existsSync(join(home, STAMP))).toBe(false)

    const notTheKey = aSeam(
      () => ({ key: KEY, setAt: 500 }),
      async () => ({ ok: true, authMethod: 'chatgpt' }),
    )
    const wrong = await bringTheCodexKeyTo(home, notTheKey.seam).catch((e: unknown) => e)
    expect(wrong).toBeInstanceOf(AuthUnavailableError)
    expect((wrong as Error).message).toContain('did not take the API key')
    expect((wrong as Error).message).not.toContain(KEY)
    expect(existsSync(join(home, STAMP))).toBe(false)
  })

  it('⛔ a logout that fails keeps the stamp, so the next launch tries it again', async () => {
    let held: { key: string; setAt: number } | null = { key: KEY, setAt: 500 }
    let logoutWorks = false
    const { seam } = aSeam(
      () => held,
      async (_h, c) => {
        if (c.to === 'the-key') {
          writeFileSync(join(home, 'auth.json'), '{}')
          return { ok: true, authMethod: 'apikey' }
        }
        return logoutWorks
          ? { ok: true, authMethod: null }
          : { ok: false, reason: 'Codex is busy.' }
      },
    )
    await bringTheCodexKeyTo(home, seam)
    held = null
    await expect(bringTheCodexKeyTo(home, seam)).rejects.toThrow(
      'Codex is busy. Try again in a moment.',
    )
    expect(existsSync(join(home, STAMP))).toBe(true)
    logoutWorks = true
    expect(await bringTheCodexKeyTo(home, seam)).toBe('its-login')
    expect(existsSync(join(home, STAMP))).toBe(false)
  })

  it('🔴 a saved key that can’t be used refuses the launch in its own words, and asks Codex nothing', async () => {
    const { seam, changes } = aSeam(() => {
      throw new ApiKeyUnreadableError('codex')
    })
    const error = await bringTheCodexKeyTo(home, seam).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AuthUnavailableError)
    expect((error as Error).message).toContain('Saved key can’t be read')
    expect(changes).not.toHaveBeenCalled()
    const { seam: broken } = aSeam(() => {
      throw new TypeError('a bug')
    })
    await expect(bringTheCodexKeyTo(home, broken)).rejects.toThrow(TypeError)
  })

  it('🔴 changes to ONE home run one at a time, in the order they were asked — and a failure does not block the next', async () => {
    const order: string[] = []
    const gate: { release: () => void } = { release: () => {} }
    let first = true
    let reads = 0
    const { seam } = aSeam(
      // Read when each change RUNS, so the second one sees the key saved after the first.
      () => {
        reads += 1
        return { key: `sk-${reads}`, setAt: reads }
      },
      async (_h, c) => {
        const mine = c.to === 'the-key' ? c.apiKey : 'none'
        order.push(`start ${mine}`)
        if (first) {
          first = false
          await new Promise<void>((resolve) => {
            gate.release = resolve
          })
          writeFileSync(join(home, 'auth.json'), '{}')
          order.push(`end ${mine}`)
          return { ok: false, reason: 'the first one fails' }
        }
        writeFileSync(join(home, 'auth.json'), '{}')
        order.push(`end ${mine}`)
        return { ok: true, authMethod: 'apikey' }
      },
    )
    const one = bringTheCodexKeyTo(home, seam)
    const two = bringTheCodexKeyTo(home, seam)
    // Let the second ask its question: it must not have started the login while the first runs.
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 2))
    expect(order).toEqual(['start sk-1'])
    gate.release()
    await expect(one).rejects.toThrow('the first one fails')
    expect(await two).toBe('the-key')
    expect(order).toEqual(['start sk-1', 'end sk-1', 'start sk-2', 'end sk-2'])
    expect(stamp()).toEqual({ setAt: 2 })
  })

  it('⚑ two homes do not wait for each other', async () => {
    const other = mkdtempSync(join(tmpdir(), 'brobot2-codexkey-other-'))
    try {
      let release: () => void = () => {}
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const seam: CodexKeySeam = {
        current: () => ({ key: KEY, setAt: 1 }),
        change: async (target) => {
          if (target === home) await held
          writeFileSync(join(target, 'auth.json'), '{}')
          return { ok: true, authMethod: 'apikey' }
        },
      }
      const slow = bringTheCodexKeyTo(home, seam)
      expect(await bringTheCodexKeyTo(other, seam)).toBe('the-key')
      release()
      expect(await slow).toBe('the-key')
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
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

  it('🔴 a Codex home logged in with the key copies no login, and returns at once', async () => {
    const copied = vi.fn()
    const { seam, changes } = (() => {
      const changes = vi.fn(async (home: string): Promise<CodexKeyOutcome> => {
        writeFileSync(join(home, 'auth.json'), '{}')
        return { ok: true, authMethod: 'apikey' }
      })
      return {
        seam: { current: () => ({ key: KEY, setAt: 7 }), change: changes } as CodexKeySeam,
        changes,
      }
    })()
    const home = await prepareProviderHome(
      userData,
      { profileId: 'default', provider: 'codex' },
      seams({ codexKey: seam, provisionCodexAuth: copied }),
    )
    expect(changes).toHaveBeenCalledTimes(1)
    expect(copied, 'the copied login was laid down over the key').not.toHaveBeenCalled()
    expect(existsSync(join(home, 'brobot-api-key-login.json'))).toBe(true)
  })

  it('⚑ …and with no key, the copied login is laid down as before', async () => {
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

  it('🔴 a Claude launch with a key set needs no login; one whose key can’t be used refuses, never falling back', async () => {
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
