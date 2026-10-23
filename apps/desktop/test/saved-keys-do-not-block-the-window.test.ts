import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiKeys,
  ApiKeyUnreadableError,
  KEY_STORAGE_TIMEOUT_MS,
  safeStorageCipher,
} from '../src/main/runtime/api-keys'
import { createProviderAuthOps } from '../src/main/runtime/provider-homes'
import { STALL_FLOOR_MS } from '../src/main/stall-watch'

vi.mock('../src/main/providers/claude/backing-login', () => ({
  machineLoginPresence: vi.fn(async () => undefined),
}))

const FAKE_KEY = 'fictional-key-for-tests'
const SEALED = Buffer.from('fictional-ciphertext').toString('base64')

function store(saved = true) {
  const rows = new Map<string, { sealed: string; setAt: number }>()
  if (saved) rows.set('claude', { sealed: SEALED, setAt: 1 })
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

  it('a slow decrypt lets timer ticks through and refuses by the deadline without another native request', async () => {
    vi.useFakeTimers()
    const native = storage()
    const door = held<{ result: string; shouldReEncrypt: boolean }>()
    native.decryptStringAsync.mockReturnValue(door.promise)
    const keys = new ApiKeys(store(), safeStorageCipher(native), Date.now, 'darwin')
    const failure = keys.read('claude').catch((error: unknown) => error)
    let ticks = 0
    const heartbeat = setInterval(() => {
      ticks += 1
    }, STALL_FLOOR_MS / 5)
    await vi.advanceTimersByTimeAsync(KEY_STORAGE_TIMEOUT_MS)
    const error = await failure
    expect(ticks).toBe(KEY_STORAGE_TIMEOUT_MS / (STALL_FLOOR_MS / 5))
    expect(error).toBeInstanceOf(ApiKeyUnreadableError)
    expect((error as Error).message).toContain('macOS may be waiting for permission')
    expect((error as Error).message).toContain('Save it again')
    expect(keys.status('claude')).toMatchObject({
      readState: 'unreadable',
      unreadableReason: (error as Error).message,
    })
    await expect(keys.read('claude')).rejects.toThrow(ApiKeyUnreadableError)
    expect(native.decryptStringAsync).toHaveBeenCalledTimes(1)
    expect(native.forbidden).not.toHaveBeenCalled()
    door.resolve({ result: FAKE_KEY, shouldReEncrypt: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(keys.status('claude').inUse).toBe(false)
    clearInterval(heartbeat)
  })

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

  it('a refused save during a live read does not invalidate the unchanged saved key', async () => {
    const native = storage()
    const door = held<{ result: string; shouldReEncrypt: boolean }>()
    native.decryptStringAsync.mockReturnValueOnce(door.promise)
    const saved = store()
    const keys = new ApiKeys(saved, safeStorageCipher(native))
    const reading = keys.current('claude')
    const alsoReading = keys.current('claude')
    expect(alsoReading).toBe(reading)
    await Promise.resolve()
    expect(await keys.set('claude', 'another-fictional-key')).toContain('could not encrypt')
    expect(keys.current('claude')).toBe(reading)
    door.resolve({ result: FAKE_KEY, shouldReEncrypt: false })
    expect(await reading).toEqual({ key: FAKE_KEY, setAt: 1 })
    expect(await alsoReading).toEqual({ key: FAKE_KEY, setAt: 1 })
    expect(native.decryptStringAsync).toHaveBeenCalledTimes(1)
    expect(saved.rows.get('claude')).toEqual({ sealed: SEALED, setAt: 1 })
    expect(native.encryptStringAsync).not.toHaveBeenCalled()
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

  it('a competing save refuses before the deadline and leaves the admitted save intact', async () => {
    vi.useFakeTimers()
    const native = storage()
    const door = held<Buffer>()
    native.encryptStringAsync.mockReturnValue(door.promise)
    const saved = store(false)
    const keys = new ApiKeys(saved, safeStorageCipher(native), () => 12)
    const first = keys.set('claude', FAKE_KEY)
    await vi.advanceTimersByTimeAsync(0)
    expect(native.encryptStringAsync).toHaveBeenCalledExactlyOnceWith(FAKE_KEY)
    expect(await keys.set('claude', 'another-fictional-key')).toContain('could not encrypt')
    door.resolve(Buffer.from('admitted-ciphertext'))
    await vi.advanceTimersByTimeAsync(0)
    expect(await first).toBeNull()
    expect(saved.rows.get('claude')).toEqual({
      sealed: Buffer.from('admitted-ciphertext').toString('base64'),
      setAt: 12,
    })
    expect(native.encryptStringAsync).toHaveBeenCalledTimes(1)
  })

  it('a slow initialization is bounded and cannot start encryption after timeout', async () => {
    vi.useFakeTimers()
    const native = storage()
    const door = held<boolean>()
    native.isAsyncEncryptionAvailable.mockReturnValue(door.promise)
    const saved = store(false)
    const keys = new ApiKeys(saved, safeStorageCipher(native))
    const save = keys.set('claude', FAKE_KEY)
    await vi.advanceTimersByTimeAsync(KEY_STORAGE_TIMEOUT_MS)
    expect(await save).toContain('could not encrypt the key')
    door.resolve(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(native.encryptStringAsync).not.toHaveBeenCalled()
    expect(saved.rows.size).toBe(0)
  })

  it('a slow encryption neither blocks timers nor saves a late result', async () => {
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
    await vi.advanceTimersByTimeAsync(KEY_STORAGE_TIMEOUT_MS)
    expect(await save).toContain('macOS may be waiting for permission')
    expect(await keys.set('claude', FAKE_KEY)).toContain('could not encrypt')
    expect(native.encryptStringAsync).toHaveBeenCalledTimes(1)
    door.resolve(Buffer.from('late-ciphertext'))
    await vi.advanceTimersByTimeAsync(0)
    expect(saved.rows.size).toBe(0)
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
  // Electron's own two rejections of `decryptStringAsync` (43.2.0).
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

  it('a Keychain that has not answered by this app’s own deadline is said to be waiting too', async () => {
    vi.useFakeTimers()
    const native = storage()
    native.decryptStringAsync.mockReturnValue(held<never>().promise)
    const keys = new ApiKeys(store(), safeStorageCipher(native), Date.now, 'darwin')
    const failure = keys.read('claude').catch((caught: unknown) => caught)
    await vi.advanceTimersByTimeAsync(KEY_STORAGE_TIMEOUT_MS)
    const said = ((await failure) as Error).message
    expect(said).toContain(WAITING)
    expect(said).not.toContain(ANOTHER_ENTRY)
    // A read while that one is still out says the same, and asks the Keychain nothing more.
    const again = await keys.read('claude').catch((caught: unknown) => caught)
    expect((again as Error).message).toBe(said)
    expect(native.decryptStringAsync).toHaveBeenCalledTimes(1)
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
    // The seal has no check of its own: about one wrong open in a hundred "succeeds".
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
    // Saved again, it is sealed with the entry this version has, and reads.
    expect(await keys.set('claude', FAKE_KEY)).toBeNull()
    expect(await keys.read('claude')).toBe(FAKE_KEY)
    expect(keys.status('claude')).toMatchObject({ inUse: true })
    expect(native.forbidden).not.toHaveBeenCalled()
  })
})
