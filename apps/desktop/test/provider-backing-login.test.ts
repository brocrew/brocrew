import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthState } from '@brobot2/runtime'
import * as claude from '../src/main/providers/claude'
import * as codex from '../src/main/providers/codex'
import { createProviderModules } from '../src/main/providers'

const native = vi.hoisted(() => ({
  read: vi.fn((): never => {
    throw new Error('No credential contents may be read')
  }),
  codex: vi.fn<() => Promise<AuthState>>(async () => ({
    state: 'usable' as const,
    login: 'api-key' as const,
    expiresAt: null,
  })),
}))
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof import('node:fs')>()),
  readFileSync: native.read,
}))
vi.mock('@brobot2/runtime', async (original) => ({
  ...(await original<typeof import('@brobot2/runtime')>()),
  defaultKeychainReaderForALaunch: native.read,
  probeCodexAuthInHome: native.codex,
}))

class Child extends EventEmitter {
  kill = vi.fn<(signal: NodeJS.Signals) => boolean>(() => true)
}
type Spawn = (
  file: string,
  args: readonly string[],
  options: { stdio: 'ignore'; windowsHide: true },
) => Child
type MacProbe = (signal?: AbortSignal, spawn?: Spawn) => Promise<boolean | undefined>
function macProbe(): MacProbe {
  const probe = Reflect.get(claude, 'machineLoginPresence') as MacProbe | undefined
  expect(probe, 'the metadata-only Mac probe').toBeDefined()
  if (probe === undefined) throw new Error('The metadata-only Mac probe is absent')
  return probe
}
type FileProbe = (
  path: string,
  inspect?: () => { isFile(): boolean; isSymbolicLink(): boolean },
) => boolean | undefined
function fileProbe(): FileProbe {
  const probe = Reflect.get(codex, 'machineLoginPresence') as FileProbe | undefined
  expect(probe, 'the no-follow machine-file probe').toBeDefined()
  if (probe === undefined) throw new Error('The machine-file probe is absent')
  return probe
}

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fictional-backing-login-'))
  native.read.mockClear()
  native.codex.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(root, { recursive: true, force: true })
})
function modules(presence: () => Promise<boolean | undefined>, machine: string | (() => string)) {
  const auth = { keyStatus: () => ({ set: true }), key: native.read }
  Reflect.set(auth, 'platform', 'darwin')
  Reflect.set(auth, 'loginPresence', presence)
  return createProviderModules(
    (provider) => ({
      managedRoot: join(root, 'managed'),
      defaultProfile: 'fern',
      homeOf: (profile) => join(root, 'managed', 'default', profile, provider),
      profiles: () => ['fern'],
      assertMayOpen: () => {},
    }),
    {
      claude: { runtime: { program: native.read }, home: {}, auth },
      codex: {
        runtime: { command: native.read },
        home: {},
        auth: {
          command: () => '/fictional/codex',
          machineAuthPath: typeof machine === 'string' ? () => machine : machine,
        },
      },
    },
  )
}

describe('the login behind a saved key', () => {
  it.each([true, false, undefined])(
    'reports Mac presence %s without opening the key or login',
    async (present) => {
      const presence = vi.fn(async () => present)
      const bound = modules(presence, join(root, 'missing'))
      expect(presence).not.toHaveBeenCalled()
      const signal = new AbortController().signal
      const state = await bound.claude.auth.check('fern', signal)
      expect(state).toMatchObject({ state: 'usable', login: 'api-key' })
      expect((state as { loginBehindTheKey?: boolean }).loginBehindTheKey).toBe(present)
      expect(presence).toHaveBeenCalledWith(signal)
      expect(native.read).not.toHaveBeenCalled()
    },
  )

  it.each([true, false])(
    'counts only the Codex machine source, present=%s, never a key-written profile',
    async (present) => {
      const machine = join(root, 'machine', 'auth.json')
      mkdirSync(join(root, 'machine'))
      if (present) writeFileSync(machine, 'fictional content that must not be opened')
      const profile = join(root, 'managed', 'default', 'fern', 'codex')
      mkdirSync(profile, { recursive: true })
      writeFileSync(join(profile, 'auth.json'), 'fictional key-written profile')
      const bound = modules(async () => undefined, machine)
      const state = await bound.codex.auth.check('fern')
      expect(state).toMatchObject({ state: 'usable', login: 'api-key', loginBehindTheKey: present })
      expect(native.read).not.toHaveBeenCalled()
    },
  )
})

describe('metadata-only Mac lookup', () => {
  it.each([
    [0, true],
    [44, false],
    [1, undefined],
    [null, undefined],
  ] as const)('classifies exit %s without reading either stream', async (code, expected) => {
    const probe = macProbe()
    const child = new Child()
    const spawn = vi.fn(() => child)
    const result = probe(undefined, spawn)
    expect(spawn).toHaveBeenCalledExactlyOnceWith(
      '/usr/bin/security',
      ['find-generic-password', '-s', 'Claude Code-credentials'],
      { stdio: 'ignore', windowsHide: true },
    )
    child.emit('close', code)
    expect(await result).toBe(expected)
    expect(child.kill).not.toHaveBeenCalled()
    expect(native.read).not.toHaveBeenCalled()
  })

  it('kills a timed out lookup once and keeps ownership until close', async () => {
    vi.useFakeTimers()
    const probe = macProbe()
    const child = new Child()
    const settled = vi.fn()
    const result = probe(undefined, () => child).then((value) => {
      settled(value)
      return value
    })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL')
    expect(settled).not.toHaveBeenCalled()
    child.emit('close', 0)
    expect(await result).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts without claiming absence, and never starts an already cancelled lookup', async () => {
    const probe = macProbe()
    const child = new Child()
    const cancel = new AbortController()
    const spawn = vi.fn(() => child)
    const result = probe(cancel.signal, spawn)
    cancel.abort()
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL')
    child.emit('close', 44)
    expect(await result).toBeUndefined()
    expect(await probe(cancel.signal, spawn)).toBeUndefined()
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('keeps spawn failure unknown even if a child later closes with zero', async () => {
    const probe = macProbe()
    const child = new Child()
    const result = probe(undefined, () => child)
    child.emit('error', new Error('fictional spawn failure'))
    child.emit('close', 0)
    expect(await result).toBeUndefined()
    expect(
      await probe(undefined, () => {
        throw new Error('fictional synchronous failure')
      }),
    ).toBeUndefined()
  })
})

describe('metadata-only Codex machine source', () => {
  it('accepts a regular file, excludes links and folders, and never opens it', () => {
    const probe = fileProbe()
    const path = join(root, 'auth.json')
    writeFileSync(path, 'fictional content that must not be opened')
    expect(probe(path)).toBe(true)
    expect(probe(root)).toBe(false)
    expect(probe(path, () => ({ isFile: () => true, isSymbolicLink: () => true }))).toBe(false)
    expect(native.read).not.toHaveBeenCalled()
  })

  it('distinguishes definite absence from an unreadable location', () => {
    const probe = fileProbe()
    expect(probe(join(root, 'missing'))).toBe(false)
    expect(
      probe('/fictional/blocked', () => {
        throw Object.assign(new Error('fictional denied'), { code: 'EACCES' })
      }),
    ).toBeUndefined()
    expect(native.read).not.toHaveBeenCalled()
  })
})

describe('Codex presence is read only for a live key check', () => {
  it.each([
    { state: 'usable', login: 'account', expiresAt: null },
    { state: 'absent', reason: 'fictional missing login' },
    { state: 'unknown', reason: 'fictional failed probe' },
  ] as AuthState[])('skips the machine path for $state / $login', async (state) => {
    const path = vi.fn((): string => {
      throw new Error('No source lookup for this auth result')
    })
    native.codex.mockResolvedValueOnce(state)
    const bound = modules(async () => undefined, path)
    expect(await bound.codex.auth.check('fern')).toBe(state)
    expect(path).not.toHaveBeenCalled()
    expect(native.read).not.toHaveBeenCalled()
  })

  it('skips the source lookup when a usable key probe answers after abort', async () => {
    const path = vi.fn((): string => {
      throw new Error('No source lookup after abort')
    })
    const cancelled = new AbortController()
    cancelled.abort()
    const bound = modules(async () => undefined, path)
    const state = await bound.codex.auth.check('fern', cancelled.signal)
    expect(state).toMatchObject({ state: 'usable', login: 'api-key' })
    expect(path).not.toHaveBeenCalled()
    expect(native.read).not.toHaveBeenCalled()
  })
})
