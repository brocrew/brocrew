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
import { bringTheCodexKeyTo } from '../src/main/providers/codex'
import { aCodexWorkspace, aFakeNativeSignIn } from './lib/codex-workspace-fixture'

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
  const module = aCodexWorkspace(root, homeOf, ['brobot', 'fern', 'moss'], key)
  const nativeSignIn = (success = true) => aFakeNativeSignIn(success ? b : null)
  const unchangedSiblings = () => {
    expect(readFileSync(join(homeOf('brobot'), 'auth.json'), 'utf8')).toBe(a)
    expect(readFileSync(join(homeOf('moss'), 'auth.json'), 'utf8')).toBe(c)
  }
  return { home, homeOf, b, key, change, module, nativeSignIn, unchangedSiblings }
}

for (const noLinks of [true, false]) {
  it(`a ${noLinks ? 'Windows no-link' : 'linked'} manual sign-in from an agent signs in the workspace’s one, which the agent then joins`, async () => {
    const f = fixture(noLinks)
    f.nativeSignIn()
    const started = await f.module.auth.signIn('fern')
    expect((await started.completed).success).toBe(true)
    await f.module.home.prepare('fern')
    // Its own stamped key login is logged out natively, then it reads the workspace's B.
    expect(f.change).toHaveBeenCalledExactlyOnceWith(f.home, { to: 'no-key' })
    expect(existsSync(join(f.home, stamp))).toBe(false)
    expect(lstatSync(join(f.home, 'auth.json')).isSymbolicLink()).toBe(!noLinks)
    expect(readFileSync(join(f.home, 'auth.json'), 'utf8')).toBe(f.b)
    expect(readFileSync(join(f.homeOf('brobot'), 'auth.json'), 'utf8')).toBe(f.b)
  })

  it(`launch never logs out account B behind a stale stamp, and puts the agent on the workspace’s sign-in ${noLinks ? 'without Windows links' : 'after an interrupted Mac sign-in'}`, async () => {
    const f = fixture(noLinks)
    writeFileSync(join(f.home, 'auth.json'), f.b)
    await f.module.home.prepare('fern')
    expect(readFileSync(join(f.home, 'auth.json'), 'utf8')).toBe(account('acct-fictional-a'))
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

it('a sign-in from an agent still reaches it when its old stamp is held open', async () => {
  const f = fixture()
  f.nativeSignIn()
  await holdStamp(f.home)
  const started = await f.module.auth.signIn('fern')
  expect((await started.completed).success).toBe(true)
  await f.module.home.prepare('fern')
  expect(existsSync(join(f.home, stamp))).toBe(true)
  expect(readFileSync(join(f.home, 'auth.json'), 'utf8')).toBe(f.b)
  expect(f.change).toHaveBeenCalledExactlyOnceWith(f.home, { to: 'no-key' })
})

it('a confirmed account can start while its obsolete stamp is held open', async () => {
  const f = fixture()
  writeFileSync(join(f.home, 'auth.json'), f.b)
  await holdStamp(f.home)
  await f.module.home.prepare('fern')
  expect(existsSync(join(f.home, stamp))).toBe(true)
  expect(readFileSync(join(f.home, 'auth.json'), 'utf8')).toBe(account('acct-fictional-a'))
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
