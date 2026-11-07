import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiKeys, ApiKeyUnreadableError, safeStorageCipher } from '../src/main/runtime/api-keys'
import { createProviderAuthOps } from '../src/main/runtime/provider-homes'
import { STALL_FLOOR_MS } from '../src/main/stall-watch'
import type { Provider } from '@brobot2/shared'
import { keyCantBeRead } from '../src/renderer/src/lib/saved-key'

vi.mock('../src/main/providers/claude/backing-login', () => ({
  machineLoginPresence: vi.fn(async () => undefined),
}))

const FAKE_KEY = 'fictional-key-for-tests'
const SEALED = Buffer.from('fictional-ciphertext').toString('base64')

const PAST_THE_OLD_BOUND_MS = 16_000

function store(saved = true, provider = 'claude') {
  const rows = new Map<string, { sealed: string; setAt: number }>()
  if (saved) rows.set(provider, { sealed: SEALED, setAt: 1 })
  return {
    rows,
    keptApiKey: (provider: string) => rows.get(provider) ?? null,
    keepSealedApiKey: (provider: string, sealed: string, setAt: number) => {
      rows.set(provider, { sealed, setAt })
    },
    forgetApiKey: (provider: string) => rows.delete(provider),
  }
}

function held<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function storage() {
  const forbidden = vi.fn(() => {
    throw new Error('synchronous Keychain access')
  })
  return {
    isEncryptionAvailable: forbidden,
    encryptString: forbidden,
    decryptString: forbidden,
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptStringAsync: vi.fn<(key: string) => Promise<Buffer>>(async () =>
      Buffer.from('new-fictional-ciphertext'),
    ),
    decryptStringAsync: vi.fn<
      (encrypted: Buffer) => Promise<{ result: string; shouldReEncrypt: boolean }>
    >(async () => ({
      result: FAKE_KEY,
      shouldReEncrypt: false,
    })),
    forbidden,
  }
}

afterEach(() => vi.useRealTimers())

describe('saved keys and the window', () => {
  it('reports an outstanding saved-key read without claiming that it failed', async () => {
    const native = storage()
    const door = held<{ result: string; shouldReEncrypt: boolean }>()
    native.decryptStringAsync.mockReturnValue(door.promise)
    const keys = new ApiKeys(store(), safeStorageCipher(native))
    const reading = keys.current('claude')
    const status = keys.status('claude')
    door.resolve({ result: FAKE_KEY, shouldReEncrypt: false })
    await reading
    expect(status).toMatchObject({ set: true, inUse: false, readState: 'reading' })
    expect(keyCantBeRead(status)).toBe(false)
    expect(keys.status('claude')).toMatchObject({ inUse: true })
    expect(native.decryptStringAsync).toHaveBeenCalledTimes(1)
  })

  it('installs the shared read before notifying a reentrant observer and settles before its notice', async () => {
    const native = storage()
    const door = held<{ result: string; shouldReEncrypt: boolean }>()
    native.decryptStringAsync.mockReturnValue(door.promise)
    const keys = new ApiKeys(store(), safeStorageCipher(native))
    const subscribe = Reflect.get(keys, 'onReadStateChanged') as
      ((listener: (provider: Provider) => void) => () => void) | undefined
    expect(subscribe).toBeTypeOf('function')
    if (subscribe === undefined) return
    const states: unknown[] = []
    let shared: ReturnType<ApiKeys['current']> | undefined
    const stop = subscribe.call(keys, (provider) => {
      expect(provider).toBe('claude')
      const state = keys.status(provider)
      states.push(state)
      if (state.readState === ('reading' as string)) shared = keys.current(provider)
    })
    const read = keys.current('claude')
    expect(shared).toBe(read)
    expect(states).toHaveLength(1)
    door.resolve({ result: FAKE_KEY, shouldReEncrypt: false })
    await read
    expect(states).toHaveLength(2)
    expect(states[1]).toMatchObject({ inUse: true })
    expect(native.decryptStringAsync).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(states)).not.toContain(FAKE_KEY)
    expect(JSON.stringify(states)).not.toContain(SEALED)
    stop()
    await keys.current('claude')
    expect(states).toHaveLength(2)
  })

  it('keeps a replacement read pending when a removed generation finally answers', async () => {
    const native = storage()
    const first = held<{ result: string; shouldReEncrypt: boolean }>()
    const second = held<{ result: string; shouldReEncrypt: boolean }>()
    native.decryptStringAsync.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const saved = store()
    const keys = new ApiKeys(saved, safeStorageCipher(native))
    const old = keys.current('claude').catch((error: unknown) => error)
    keys.remove('claude')
    saved.keepSealedApiKey('claude', 'fictional-replacement-seal', 2)
    const fresh = keys.current('claude')
    const queued = keys.status('claude')
    first.resolve({ result: FAKE_KEY, shouldReEncrypt: false })
    expect(await old).toBeInstanceOf(ApiKeyUnreadableError)
    const stillReading = keys.status('claude')
    second.resolve({ result: 'fictional-replacement-key', shouldReEncrypt: false })
    expect(await fresh).toEqual({ key: 'fictional-replacement-key', setAt: 2 })
    expect(queued).toMatchObject({ setAt: 2, readState: 'reading' })
    expect(stillReading).toMatchObject({ setAt: 2, readState: 'reading' })
    expect(native.decryptStringAsync).toHaveBeenCalledTimes(2)
  })

  it('disposes read observers without cancelling shared work or publishing removed generations', async () => {
    const native = storage()
    const door = held<{ result: string; shouldReEncrypt: boolean }>()
    native.decryptStringAsync.mockReturnValue(door.promise)
    const keys = new ApiKeys(store(), safeStorageCipher(native))
    const subscribe = Reflect.get(keys, 'onReadStateChanged') as
      ((listener: (provider: Provider) => void) => () => void) | undefined
    expect(subscribe).toBeTypeOf('function')
    if (subscribe === undefined) return
    const heard = vi.fn()
    const disposed = vi.fn()
    subscribe.call(keys, heard)
    const stop = subscribe.call(keys, disposed)
    const read = keys.current('claude').catch((error: unknown) => error)
    stop()
    keys.remove('claude')
    door.resolve({ result: FAKE_KEY, shouldReEncrypt: false })
    expect(await read).toBeInstanceOf(ApiKeyUnreadableError)
    expect(heard).toHaveBeenCalledExactlyOnceWith('claude')
    expect(disposed).toHaveBeenCalledExactlyOnceWith('claude')
    expect(keys.status('claude')).toMatchObject({ set: false })
  })

  it('constructs and reports a saved key before the window opens without initializing encryption', async () => {
    const native = storage()
    const keys = new ApiKeys(store(), safeStorageCipher(native))
    expect(keys.status('claude')).toMatchObject({
      set: true,
      inUse: false,
      readState: 'not-checked',
    })
    keys.status('claude')
    const read = vi.fn(() => keys.read('claude'))
    const auth = createProviderAuthOps('/fictional-not-used', {
      codexCommand: () => {
        throw new Error('no process may run')
      },
      apiKey: read,
      keyStatus: (provider) => keys.status(provider),
    })
    expect(await auth.check('claude', 'unused', new AbortController().signal)).toMatchObject({
      state: 'usable',
      login: 'api-key',
    })
    expect(read).not.toHaveBeenCalled()
    expect(native.isAsyncEncryptionAvailable).not.toHaveBeenCalled()
    expect(native.decryptStringAsync).not.toHaveBeenCalled()
    expect(native.forbidden).not.toHaveBeenCalled()
    expect(await keys.read('claude')).toBe(FAKE_KEY)
    expect(native.decryptStringAsync).toHaveBeenCalledExactlyOnceWith(Buffer.from(SEALED, 'base64'))
    expect(keys.status('claude')).toMatchObject({ set: true, inUse: true })
  })

  it('a Codex sign-in refusal uses presence, never a key read', () => {
    const current = vi.fn(async () => ({ key: FAKE_KEY, setAt: 1 }))
    const auth = createProviderAuthOps('/fictional-not-used', {
      codexCommand: () => {
        throw new Error('no process may run')
      },
      codexKey: { isSaved: () => true, current, change: vi.fn() },
    })
    expect(() => auth.reprovision('codex', 'unused')).toThrow('An API key is saved for Codex')
    expect(current).not.toHaveBeenCalled()
  })

  it('a computer with no saved keys never reaches safeStorage, even for a launch read', async () => {
    const native = storage()
    const keys = new ApiKeys(store(false), safeStorageCipher(native))
    for (const provider of ['claude', 'codex'] as const) {
      expect(keys.status(provider).set).toBe(false)
      expect(await keys.current(provider)).toBeNull()
      expect(await keys.read(provider)).toBeNull()
    }
    expect(native.forbidden).not.toHaveBeenCalled()
    expect(native.isAsyncEncryptionAvailable).not.toHaveBeenCalled()
    expect(native.decryptStringAsync).not.toHaveBeenCalled()
  })

  it.each(['claude', 'codex'] as const)(
    'a slow %s decrypt lets timer ticks through and is waited for: the key is read when the Keychain answers',
    async (provider) => {
      vi.useFakeTimers()
      const native = storage()
      const door = held<{ result: string; shouldReEncrypt: boolean }>()
      native.decryptStringAsync.mockReturnValue(door.promise)
      const keys = new ApiKeys(store(true, provider), safeStorageCipher(native), Date.now, 'darwin')
      let outcome: unknown = 'pending'
      const reading = keys.read(provider).then(
        (key) => (outcome = key),
        (error: unknown) => (outcome = error),
      )
      let ticks = 0
      const heartbeat = setInterval(() => {
        ticks += 1
      }, STALL_FLOOR_MS / 5)
      await vi.advanceTimersByTimeAsync(PAST_THE_OLD_BOUND_MS)
      expect(ticks).toBe(PAST_THE_OLD_BOUND_MS / (STALL_FLOOR_MS / 5))
      expect(outcome).toBe('pending')
      expect(keys.status(provider).readState).not.toBe('unreadable')
      door.resolve({ result: FAKE_KEY, shouldReEncrypt: false })
      await vi.advanceTimersByTimeAsync(0)
      await reading
      expect(outcome).toBe(FAKE_KEY)
      expect(keys.status(provider).inUse).toBe(true)
      expect(native.decryptStringAsync).toHaveBeenCalledTimes(1)
      expect(native.forbidden).not.toHaveBeenCalled()
      clearInterval(heartbeat)
    },
  )

  it('a refused decrypt gives recovery words, never the native error, and a later permitted read can work', async () => {
    const native = storage()
    native.decryptStringAsync.mockRejectedValueOnce(new Error(`permission denied: ${FAKE_KEY}`))
    const keys = new ApiKeys(store(), safeStorageCipher(native), Date.now, 'darwin')
    await expect(keys.read('claude')).rejects.toThrow('Save it again under “API key”')
    expect(JSON.stringify(keys.status('claude'))).not.toContain(FAKE_KEY)
    expect(JSON.stringify(keys.status('claude'))).not.toContain('permission denied')
    expect(await keys.read('claude')).toBe(FAKE_KEY)
    expect(keys.status('claude')).not.toHaveProperty('unreadableReason')
    expect(native.forbidden).not.toHaveBeenCalled()
  })

  it('two launches share a pending decrypt but a later launch reads the key again', async () => {
    const native = storage()
    const door = held<{ result: string; shouldReEncrypt: boolean }>()
    native.decryptStringAsync.mockReturnValueOnce(door.promise)
    const keys = new ApiKeys(store(), safeStorageCipher(native))
    const a = keys.current('claude')
    const b = keys.current('claude')
    expect(a).toBe(b)
    door.resolve({ result: FAKE_KEY, shouldReEncrypt: false })
    expect(await a).toEqual({ key: FAKE_KEY, setAt: 1 })
    expect(await keys.read('claude')).toBe(FAKE_KEY)
    expect(native.decryptStringAsync).toHaveBeenCalledTimes(2)
  })

  it('a save during a live read waits for it: the read gets the saved key, then the new one is kept', async () => {
    const native = storage()
    const door = held<{ result: string; shouldReEncrypt: boolean }>()
    native.decryptStringAsync.mockReturnValueOnce(door.promise)
    const saved = store()
    const keys = new ApiKeys(saved, safeStorageCipher(native))
    const reading = keys.current('claude')
    const alsoReading = keys.current('claude')
    expect(alsoReading).toBe(reading)
    await Promise.resolve()
    const saving = keys.set('claude', 'another-fictional-key')
    await Promise.resolve()
    expect(keys.current('claude')).toBe(reading)
    expect(native.encryptStringAsync).not.toHaveBeenCalled()
    door.resolve({ result: FAKE_KEY, shouldReEncrypt: false })
    expect(await reading).toEqual({ key: FAKE_KEY, setAt: 1 })
    expect(await alsoReading).toEqual({ key: FAKE_KEY, setAt: 1 })
    expect(await saving).toBeNull()
    expect(native.decryptStringAsync).toHaveBeenCalledTimes(1)
    expect(native.encryptStringAsync).toHaveBeenCalledExactlyOnceWith('another-fictional-key')
    expect(saved.rows.get('claude')?.sealed).not.toBe(SEALED)
  })

  it('removal during decrypt never hands the old key to a launch', async () => {
    const native = storage()
    const door = held<{ result: string; shouldReEncrypt: boolean }>()
    native.decryptStringAsync.mockReturnValue(door.promise)
    const keys = new ApiKeys(store(), safeStorageCipher(native))
    const failed = keys.read('claude').catch((error: unknown) => error)
    await Promise.resolve()
    keys.remove('claude')
    door.resolve({ result: FAKE_KEY, shouldReEncrypt: false })
    expect(await failed).toBeInstanceOf(ApiKeyUnreadableError)
    expect(await keys.read('claude')).toBeNull()
    expect(keys.status('claude').set).toBe(false)
  })

  it('saving uses only async encryption, without a preliminary synchronous availability check', async () => {
    const native = storage()
    const saved = store(false)
    const keys = new ApiKeys(saved, safeStorageCipher(native), () => 12)
    expect(await keys.set('claude', FAKE_KEY)).toBeNull()
    expect(native.isAsyncEncryptionAvailable).toHaveBeenCalledTimes(1)
    expect(native.encryptStringAsync).toHaveBeenCalledExactlyOnceWith(FAKE_KEY)
    expect(native.forbidden).not.toHaveBeenCalled()
    expect(saved.rows.get('claude')).toEqual({
      sealed: Buffer.from('new-fictional-ciphertext').toString('base64'),
      setAt: 12,
    })
  })

  it('a competing save waits its turn, and the later key is the one kept', async () => {
    vi.useFakeTimers()
    const native = storage()
    const door = held<Buffer>()
    native.encryptStringAsync.mockReturnValue(door.promise)
    const saved = store(false)
    const keys = new ApiKeys(saved, safeStorageCipher(native), () => 12)
    const first = keys.set('claude', FAKE_KEY)
    await vi.advanceTimersByTimeAsync(0)
    expect(native.encryptStringAsync).toHaveBeenCalledExactlyOnceWith(FAKE_KEY)
    const second = keys.set('claude', 'another-fictional-key')
    door.resolve(Buffer.from('admitted-ciphertext'))
    native.encryptStringAsync.mockResolvedValue(Buffer.from('later-ciphertext'))
    await vi.advanceTimersByTimeAsync(0)
    expect(await first).toBeNull()
    expect(await second).toBeNull()
    expect(saved.rows.get('claude')).toEqual({
      sealed: Buffer.from('later-ciphertext').toString('base64'),
      setAt: 13,
    })
    expect(native.encryptStringAsync).toHaveBeenCalledTimes(2)
  })

  it('a slow initialization is waited for, and the key is saved when it answers', async () => {
    vi.useFakeTimers()
    const native = storage()
    const door = held<boolean>()
    native.isAsyncEncryptionAvailable.mockReturnValue(door.promise)
    const saved = store(false)
    const keys = new ApiKeys(saved, safeStorageCipher(native))
    let said: unknown = 'pending'
    const save = keys.set('claude', FAKE_KEY).then((answer) => (said = answer))
    await vi.advanceTimersByTimeAsync(PAST_THE_OLD_BOUND_MS)
    expect(said).toBe('pending')
    door.resolve(true)
    await vi.advanceTimersByTimeAsync(0)
    await save
    expect(said).toBeNull()
    expect(native.encryptStringAsync).toHaveBeenCalledExactlyOnceWith(FAKE_KEY)
    expect(saved.rows.size).toBe(1)
  })

  it('a slow encryption does not block timers, and its result is saved when it comes', async () => {
    vi.useFakeTimers()
    const native = storage()
    const door = held<Buffer>()
    native.encryptStringAsync.mockReturnValue(door.promise)
    const saved = store(false)
    const keys = new ApiKeys(saved, safeStorageCipher(native), Date.now, 'darwin')
    const save = keys.set('claude', FAKE_KEY)
    const tick = vi.fn()
    setTimeout(tick, STALL_FLOOR_MS / 5)
    await vi.advanceTimersByTimeAsync(STALL_FLOOR_MS / 5)
    expect(tick).toHaveBeenCalledTimes(1)
    let said: unknown = 'pending'
    void save.then((answer) => (said = answer))
    await vi.advanceTimersByTimeAsync(PAST_THE_OLD_BOUND_MS)
    expect(said).toBe('pending')
    expect(native.encryptStringAsync).toHaveBeenCalledTimes(1)
    door.resolve(Buffer.from('late-ciphertext'))
    await vi.advanceTimersByTimeAsync(0)
    expect(await save).toBeNull()
    expect(saved.rows.get('claude')?.sealed).toBe(Buffer.from('late-ciphertext').toString('base64'))
  })

  it('🔴 removing the key while a save waits behind a slow read cancels that save', async () => {
    const native = storage()
    const door = held<{ result: string; shouldReEncrypt: boolean }>()
    native.decryptStringAsync.mockReturnValueOnce(door.promise)
    const saved = store()
    const keys = new ApiKeys(saved, safeStorageCipher(native))
    const reading = keys.current('claude').catch(() => null)
    await Promise.resolve()
    const saving = keys.set('claude', 'another-fictional-key')
    await Promise.resolve()
    keys.remove('claude')
    door.resolve({ result: FAKE_KEY, shouldReEncrypt: false })
    await reading
    expect(await saving).toContain('saved key changed')
    expect(saved.rows.size).toBe(0)
    expect(keys.status('claude').set).toBe(false)
  })

  it('removing a key while its replacement is encrypting cancels the late save', async () => {
    const native = storage()
    const door = held<Buffer>()
    native.encryptStringAsync.mockReturnValue(door.promise)
    const saved = store()
    const keys = new ApiKeys(saved, safeStorageCipher(native))
    const save = keys.set('claude', FAKE_KEY)
    await Promise.resolve()
    keys.remove('claude')
    door.resolve(Buffer.from('replacement'))
    expect(await save).toContain('saved key changed')
    expect(saved.rows.size).toBe(0)
  })

  it('an unavailable encryption service never replaces an existing sealed key', async () => {
    const native = storage()
    native.isAsyncEncryptionAvailable.mockResolvedValue(false)
    const saved = store()
    const keys = new ApiKeys(saved, safeStorageCipher(native))
    expect(await keys.set('claude', FAKE_KEY)).toContain('could not encrypt')
    expect(saved.rows.get('claude')).toEqual({ sealed: SEALED, setAt: 1 })
    expect(native.encryptStringAsync).not.toHaveBeenCalled()
  })
})

describe('why a saved key did not open, in the words a person reads', () => {
  const NO_SEALING_KEY =
    'safeStorage.decryptStringAsync is temporarily unavailable. Please try again.'
  const COULD_NOT_DECRYPT =
    'Error while decrypting the ciphertext provided to safeStorage.decryptStringAsync.'
  const WAITING = 'macOS may be waiting for permission to read its saved key.'
  const ANOTHER_ENTRY = 'It was saved with a Keychain entry this version of BroCrew doesn’t have.'

  async function refusalOn(
    platform: NodeJS.Platform,
    fails: (native: ReturnType<typeof storage>) => void,
  ): Promise<{ said: string; keys: ApiKeys; native: ReturnType<typeof storage> }> {
    const native = storage()
    fails(native)
    const keys = new ApiKeys(store(), safeStorageCipher(native), Date.now, platform)
    const error = await keys.read('claude').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiKeyUnreadableError)
    return { said: (error as Error).message, keys, native }
  }

  it('a Keychain that hands over no sealing key is said to be waiting, on a Mac only', async () => {
    const fails = (native: ReturnType<typeof storage>): void => {
      native.decryptStringAsync.mockRejectedValue(new Error(NO_SEALING_KEY))
    }
    const mac = await refusalOn('darwin', fails)
    expect(mac.said).toContain(WAITING)
    expect(mac.said).not.toContain(ANOTHER_ENTRY)
    expect(mac.said).toContain('Save it again under “API key” on the Claude card in Providers')
    const windows = await refusalOn('win32', fails)
    expect(windows.said).not.toContain('macOS')
    expect(windows.said).not.toContain('Keychain')
  })

  it('a key the Keychain’s sealing key does not open is said to be saved with another entry, and macOS is not said to wait', async () => {
    const fails = (native: ReturnType<typeof storage>): void => {
      native.decryptStringAsync.mockRejectedValue(new Error(COULD_NOT_DECRYPT))
    }
    const mac = await refusalOn('darwin', fails)
    expect(mac.said).toBe(
      'BroCrew can’t read the API key saved for Claude on this computer. ' +
        `${ANOTHER_ENTRY} ` +
        'Save it again under “API key” on the Claude card in Providers, or remove it there to use your sign-in instead.',
    )
    expect(mac.said).not.toContain('waiting')
    expect(mac.keys.status('claude')).toMatchObject({
      set: true,
      inUse: false,
      readState: 'unreadable',
      unreadableReason: mac.said,
    })
    const windows = await refusalOn('win32', fails)
    expect(windows.said).not.toContain('Keychain')
    expect(windows.said).toContain('Save it again')
  })

  it('a wrong sealing key that opens to garbage hands no launch that garbage', async () => {
    for (const garbage of ['\u0013\ufffd\u0001 not a key', 'two words', 'k\u00e9y']) {
      const { said, keys } = await refusalOn('darwin', (native) => {
        native.decryptStringAsync.mockResolvedValue({ result: garbage, shouldReEncrypt: false })
      })
      expect(said, JSON.stringify(garbage)).toContain(ANOTHER_ENTRY)
      expect(keys.status('claude')).toMatchObject({ inUse: false, readState: 'unreadable' })
      expect(JSON.stringify(keys.status('claude'))).not.toContain(garbage)
    }
  })

  it('any other failure says neither, and saving the key again is still the way out', async () => {
    const { said, keys, native } = await refusalOn('darwin', (failing) => {
      failing.decryptStringAsync.mockRejectedValueOnce(new Error('something else'))
    })
    expect(said).not.toContain(WAITING)
    expect(said).not.toContain(ANOTHER_ENTRY)
    expect(said).not.toContain('something else')
    expect(said).toContain('Save it again')
    expect(await keys.set('claude', FAKE_KEY)).toBeNull()
    expect(await keys.read('claude')).toBe(FAKE_KEY)
    expect(keys.status('claude')).toMatchObject({ inUse: true })
    expect(native.forbidden).not.toHaveBeenCalled()
  })
})
