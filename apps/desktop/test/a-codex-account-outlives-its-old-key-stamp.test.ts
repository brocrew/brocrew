import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as codex from '@brobot2/runtime/codex'
import { stopKeepingCodexSignInsInStep } from '../../../packages/runtime/src/codex/shared-sign-in'
import { bringTheCodexKeyTo, createCodexModule } from '../src/main/providers/codex'

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return { ...actual, rm: vi.fn(actual.rm) }
})
beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(rm).mockReset().mockImplementation(actual.rm)
})

const roots: string[] = []
afterEach(() => {
  stopKeepingCodexSignInsInStep()
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const stamp = 'brobot-api-key-login.json'
const account = (id: string) =>
  JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: { account_id: id },
    last_refresh: '2026-11-24T00:00:00Z',
  })
function fixture(noLinks = true) {
  const root = mkdtempSync(join(tmpdir(), 'brocrew-stamped-account-'))
  roots.push(root)
  const homeOf = (profile: string) => join(root, profile, 'codex')
  const home = homeOf('fern')
  for (const profile of ['brobot', 'fern', 'moss']) mkdirSync(homeOf(profile), { recursive: true })
  const a = account('acct-fictional-a')
  const b = account('acct-fictional-b')
  const c = account('acct-fictional-c')
  writeFileSync(join(homeOf('brobot'), 'auth.json'), a)
  writeFileSync(join(homeOf('moss'), 'auth.json'), c)
  writeFileSync(join(home, 'auth.json'), '{"auth_mode":"apikey","OPENAI_API_KEY":"fictional-key"}')
  writeFileSync(join(home, stamp), '{"setAt":17}')
  const originalShare = codex.shareCodexSignIn
  if (noLinks)
    vi.spyOn(codex, 'shareCodexSignIn').mockImplementation((target, options) =>
      originalShare(target, {
        ...options,
        platform: 'win32',
        link: () => {
          throw Object.assign(new Error('Fictional Windows link refusal'), { code: 'EPERM' })
        },
      }),
    )
  const change = vi.fn(async (target: string) => {
    rmSync(join(target, 'auth.json'), { force: true })
    return { ok: true as const, authMethod: null }
  })
  const key = { current: vi.fn(() => null), isSaved: () => false, change }
  const module = createCodexModule(
    {
      managedRoot: root,
      defaultProfile: 'brobot',
      homeOf,
      profiles: () => ['brobot', 'fern', 'moss'],
      assertMayOpen: () => {},
    },
    {
      runtime: { command: () => 'fictional-not-started' },
      home: {
        provisionHome: (_root, target) => {
          mkdirSync(target, { recursive: true })
        },
        key,
      },
      auth: { command: () => 'fictional-not-started', key },
    },
  )
  const nativeSignIn = (success = true) => {
    const originalStart = codex.startCodexLogin
    vi.spyOn(codex, 'startCodexLogin').mockImplementation(async (_factory, target, cwd, signal) => {
      let arrived!: () => void
      const completion = new Promise<void>((done) => {
        arrived = done
      })
      const transport: codex.CodexTransport = {
        async request(method) {
          if (method === 'account/login/start') {
            if (success) writeFileSync(join(target, 'auth.json'), b)
            arrived()
            return {
              loginId: 'fictional-login',
              authUrl: 'https://login.example.invalid/fictional',
            }
          }
          if (method === 'getAuthStatus')
            return {
              authMethod: success ? 'chatgpt' : null,
              authToken: null,
              requiresOpenaiAuth: true,
            }
          if (method === 'account/read')
            return {
              account: success
                ? { type: 'chatgpt', email: 'fictional@example.invalid', planType: 'pro' }
                : null,
            }
          return {}
        },
        notify() {},
        respond() {},
        respondError() {},
        close() {},
        async *incoming() {
          await completion
          yield { kind: 'notification', method: 'account/login/completed', params: { success } }
        },
      }
      return originalStart(() => transport, target, cwd, signal)
    })
  }
  const unchangedSiblings = () => {
    expect(readFileSync(join(homeOf('brobot'), 'auth.json'), 'utf8')).toBe(a)
    expect(readFileSync(join(homeOf('moss'), 'auth.json'), 'utf8')).toBe(c)
  }
  return { home, homeOf, b, key, change, module, nativeSignIn, unchangedSiblings }
}

for (const noLinks of [true, false]) {
  it(`a completed ${noLinks ? 'Windows no-link' : 'linked'} manual sign-in retires the previous key stamp`, async () => {
    const f = fixture(noLinks)
    f.nativeSignIn()
    const started = await f.module.auth.signIn('fern')
    expect((await started.completed).success).toBe(true)
    expect(existsSync(join(f.home, stamp))).toBe(false)
    expect(lstatSync(join(f.home, 'auth.json')).isSymbolicLink()).toBe(!noLinks)
    await f.module.home.prepare('fern')
    expect(readFileSync(join(f.home, 'auth.json'), 'utf8')).toBe(f.b)
    expect(f.change).not.toHaveBeenCalled()
    f.unchangedSiblings()
  })

  it(`launch preserves account B with a stale stamp ${noLinks ? 'without Windows links' : 'after an interrupted Mac sign-in'}`, async () => {
    const f = fixture(noLinks)
    writeFileSync(join(f.home, 'auth.json'), f.b)
    await f.module.home.prepare('fern')
    expect(readFileSync(join(f.home, 'auth.json'), 'utf8')).toBe(f.b)
    expect(existsSync(join(f.home, stamp))).toBe(false)
    expect(f.change).not.toHaveBeenCalled()
    f.unchangedSiblings()
  })
}

it('legacy no-key cleanup preserves a confirmed account instead of logging it out', async () => {
  const f = fixture()
  writeFileSync(join(f.home, 'auth.json'), f.b)
  expect(await bringTheCodexKeyTo(f.home, f.key)).toBe('its-login')
  expect(readFileSync(join(f.home, 'auth.json'), 'utf8')).toBe(f.b)
  expect(existsSync(join(f.home, stamp))).toBe(false)
  expect(f.change).not.toHaveBeenCalled()
  f.unchangedSiblings()
})

it('an actual stamped key still uses native logout before joining the default sign-in', async () => {
  const f = fixture()
  await f.module.home.prepare('fern')
  expect(f.change).toHaveBeenCalledExactlyOnceWith(f.home, { to: 'no-key' })
  expect(existsSync(join(f.home, stamp))).toBe(false)
  expect(readFileSync(join(f.home, 'auth.json'), 'utf8')).toBe(account('acct-fictional-a'))
  f.unchangedSiblings()
})

it('a failed native manual sign-in retains its key stamp for cleanup', async () => {
  const f = fixture()
  f.nativeSignIn(false)
  const started = await f.module.auth.signIn('fern')
  expect((await started.completed).success).toBe(false)
  expect(readFileSync(join(f.home, stamp), 'utf8')).toBe('{"setAt":17}')
  expect(f.change).not.toHaveBeenCalled()
  f.unchangedSiblings()
})

async function holdStamp(home: string): Promise<void> {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(rm).mockImplementation((path, options) =>
    String(path) === join(home, stamp)
      ? Promise.reject(Object.assign(new Error('Fictional Windows file hold'), { code: 'EPERM' }))
      : actual.rm(path, options),
  )
}

it('a successful native sign-in still shares B when its old stamp is held open', async () => {
  const f = fixture()
  f.nativeSignIn()
  await holdStamp(f.home)
  const started = await f.module.auth.signIn('fern')
  expect((await started.completed).success).toBe(true)
  expect(existsSync(join(f.home, stamp))).toBe(true)
  await f.module.home.prepare('fern')
  expect(readFileSync(join(f.home, 'auth.json'), 'utf8')).toBe(f.b)
  expect(f.change).not.toHaveBeenCalled()
  f.unchangedSiblings()
})

it('a confirmed account can start while its obsolete stamp is held open', async () => {
  const f = fixture()
  writeFileSync(join(f.home, 'auth.json'), f.b)
  await holdStamp(f.home)
  await f.module.home.prepare('fern')
  expect(existsSync(join(f.home, stamp))).toBe(true)
  expect(readFileSync(join(f.home, 'auth.json'), 'utf8')).toBe(f.b)
  expect(f.change).not.toHaveBeenCalled()
  f.unchangedSiblings()
})

it('implicit cleanup preserves a confirmed account when stamp removal is refused', async () => {
  const f = fixture()
  writeFileSync(join(f.home, 'auth.json'), f.b)
  await holdStamp(f.home)
  expect(await bringTheCodexKeyTo(f.home, f.key)).toBe('its-login')
  expect(existsSync(join(f.home, stamp))).toBe(true)
  expect(readFileSync(join(f.home, 'auth.json'), 'utf8')).toBe(f.b)
  expect(f.change).not.toHaveBeenCalled()
  f.unchangedSiblings()
})
