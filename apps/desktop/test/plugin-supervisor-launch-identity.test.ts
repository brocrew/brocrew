import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { launchRootKey } from '../src/main/plugins/supervisor/launch-identity'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import { OWNER_LAUNCH_MS } from '../src/main/plugins/supervisor/protocol'
import { PluginStartupError } from '../src/main/plugins/startup-failure'

const paths = vi.hoisted(() => ({ ordinary: vi.fn(), native: vi.fn(), mkdir: vi.fn() }))
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>()
  return {
    ...actual,
    realpathSync: Object.assign(paths.ordinary, { native: paths.native }),
    mkdirSync: paths.mkdir,
    lstatSync: () => ({ isDirectory: () => true }),
  }
})
vi.mock('../src/main/plugins/supervisor/storage', async (original) => {
  const actual = await original<typeof import('../src/main/plugins/supervisor/storage')>()
  return {
    ...actual,
    SupervisorStorage: class extends actual.SupervisorStorage {
      constructor(...args: ConstructorParameters<typeof actual.SupervisorStorage>) {
        super(...args)
        Object.defineProperty(this, 'identity', { value: 'fictional-reused-directory' })
      }
    },
  }
})

// These deterministic doubles qualify selection/error semantics, never native filesystem behavior.
describe('launch-only root selection', () => {
  const releases: (() => void)[] = []
  const fictional = resolve('fictional-launch-key')
  const root = join(fictional, 'plugins')
  const alias = join(fictional, 'PLUGINS')
  const nativeRoot = join(fictional, 'NativeCase')
  beforeEach(() => {
    paths.ordinary.mockReset().mockImplementation((path: string) => path)
    paths.native.mockReset().mockImplementation((path: string) => path)
    paths.mkdir.mockReset()
    vi.spyOn(SupervisorStorage.prototype, 'read').mockReturnValue(null)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  })
  afterEach(async () => {
    for (const release of releases.splice(0)) release()
    await vi.advanceTimersByTimeAsync(0)
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  function options(selected: string) {
    return {
      root: selected,
      workspaceRoot: join(fictional, 'workspace'),
      generation: randomUUID(),
      build: 'fictional',
    }
  }
  function held() {
    let release!: () => void
    let reject!: (error: unknown) => void
    const promise = new Promise<void>((yes, no) => {
      release = yes
      reject = no
    })
    releases.push(release)
    return { promise, release, reject }
  }
  function attach(selected: string, launch: () => Promise<void>) {
    return PluginWorkspaceLease.attach({ ...options(selected), launch }).catch(
      (error: unknown) => error,
    )
  }
  function cause(result: unknown): unknown {
    expect(result).toBeInstanceOf(Error)
    return (result as Error).cause
  }
  async function expire() {
    await vi.advanceTimersByTimeAsync(OWNER_LAUNCH_MS + 20)
  }
  function aliases() {
    paths.native.mockImplementation((path: string) =>
      path === root || path === alias ? nativeRoot : path,
    )
  }

  it('uses exact native case when ordinary realpath returns different spellings', () => {
    aliases()
    expect(launchRootKey(root)).toBe(JSON.stringify(['existing', nativeRoot]))
    expect(launchRootKey(alias)).toBe(launchRootKey(root))
    expect(paths.native).toHaveBeenCalledWith(resolve(root))
    expect(paths.ordinary).not.toHaveBeenCalled()
  })
  it('keeps native case-only siblings distinct despite legacy metadata identity collisions', () => {
    const second = join(fictional, 'nativecase')
    paths.native.mockReturnValueOnce(nativeRoot).mockReturnValueOnce(second)
    expect(launchRootKey(root)).not.toBe(launchRootKey(alias))
    expect(paths.ordinary).not.toHaveBeenCalled()
  })
  it('tags ENOENT exact spellings separately from existing native paths without caching', () => {
    const missing = Object.assign(new Error('fictional missing'), { code: 'ENOENT' })
    paths.native.mockImplementation(() => {
      throw missing
    })
    expect(launchRootKey(root)).toBe(JSON.stringify(['missing', resolve(root)]))
    expect(launchRootKey(alias)).toBe(JSON.stringify(['missing', resolve(alias)]))
    paths.native.mockReturnValue(resolve(root))
    expect(launchRootKey(root)).toBe(JSON.stringify(['existing', resolve(root)]))
    expect(paths.native).toHaveBeenCalledTimes(3)
  })
  it.each(['EACCES', 'EIO', 'ENOTDIR', 'ELOOP'])('propagates native %s unchanged', (code) => {
    const original = Object.assign(new Error('fictional lookup failure'), { code })
    paths.native.mockImplementation(() => {
      throw original
    })
    expect(() => launchRootKey(root)).toThrow(original)
  })
  it('shares native aliases across caller timeout, with mkdir before each single key capture', async () => {
    aliases()
    const gate = held()
    const launch = vi.fn(() => gate.promise)
    const first = attach(root, launch)
    const second = attach(alias, launch)
    await expire()
    expect(await first).toMatchObject({ code: 'unavailable' })
    expect(await second).toMatchObject({ code: 'unavailable' })
    const third = attach(alias, launch)
    await expire()
    expect(await third).toMatchObject({ code: 'unavailable' })
    expect(launch).toHaveBeenCalledOnce()
    expect(paths.native.mock.calls).toEqual([[root], [alias], [alias]])
    expect(paths.mkdir.mock.calls).toEqual(
      [root, alias, alias].map((path) => [
        join(path, 'supervisor'),
        { recursive: true, mode: 0o700 },
      ]),
    )
    for (let i = 0; i < 3; i++)
      expect(paths.mkdir.mock.invocationCallOrder[i]).toBeLessThan(
        paths.native.mock.invocationCallOrder[i]!,
      )
    gate.release()
    await vi.advanceTimersByTimeAsync(0)
    expect(paths.native).toHaveBeenCalledTimes(3)
  })
  it('starts a distinct native case-only root while the first remains held after timeout', async () => {
    // Even rootIdentity is forced to collide here: only the native launch key can separate them.
    paths.ordinary.mockImplementation((path: string) =>
      path === root || path === alias ? root : path,
    )
    const firstGate = held()
    const firstLaunch = vi.fn(() => firstGate.promise)
    const first = attach(root, firstLaunch)
    await expire()
    expect(await first).toMatchObject({ code: 'unavailable' })
    const secondGate = held()
    const secondLaunch = vi.fn(() => secondGate.promise)
    const second = attach(alias, secondLaunch)
    await vi.advanceTimersByTimeAsync(0)
    expect(secondLaunch).toHaveBeenCalledOnce()
    expect(firstLaunch).toHaveBeenCalledOnce()
    await expire()
    expect(await second).toMatchObject({ code: 'unavailable' })
  })
  it('retains the second root original startup cause while a colliding legacy root stays held', async () => {
    paths.ordinary.mockImplementation((path: string) =>
      path === root || path === alias ? root : path,
    )
    const gate = held()
    const first = attach(root, () => gate.promise)
    await expire()
    expect(await first).toMatchObject({ code: 'unavailable' })
    const original = new Error('fictional second-root failure')
    const startup = new PluginStartupError('runtime', original)
    const launch = vi.fn(async () => {
      throw startup
    })
    const second = attach(alias, launch)
    await expire()
    expect(await second).toMatchObject({ code: 'unavailable', cause: startup })
    expect(cause(await second)).toBe(startup)
    expect(startup.cause).toBe(original)
    expect(launch).toHaveBeenCalledOnce()
  })
  it('does not schedule a launcher when native lookup fails and keeps its exact public cause', async () => {
    const original = Object.assign(new Error('fictional denied lookup'), { code: 'EACCES' })
    paths.native.mockImplementation(() => {
      throw original
    })
    const launch = vi.fn(async () => {})
    const result = attach(root, launch)
    await expire()
    expect(await result).toMatchObject({ code: 'unavailable', cause: original })
    expect(cause(await result)).toBe(original)
    expect(launch).not.toHaveBeenCalled()
  })
  it('shares original rejection, then removes the captured key on actual settlement for retry', async () => {
    aliases()
    const gate = held()
    const original = new Error('fictional shared runtime failure')
    const startup = new PluginStartupError('runtime', original)
    const launch = vi.fn(() => gate.promise)
    const first = attach(root, launch)
    const second = attach(alias, launch)
    await vi.advanceTimersByTimeAsync(0)
    expect(launch).toHaveBeenCalledOnce()
    // A changed lookup after capture must not change which map entry finally removes.
    paths.native.mockReturnValue(join(fictional, 'retargeted'))
    gate.reject(startup)
    await vi.advanceTimersByTimeAsync(0)
    for (const result of [await first, await second]) {
      expect(result).toMatchObject({ code: 'unavailable', cause: startup })
      expect(cause(result)).toBe(startup)
      expect(startup.cause).toBe(original)
    }
    aliases()
    const retry = attach(alias, launch)
    await vi.advanceTimersByTimeAsync(0)
    expect(await retry).toMatchObject({ code: 'unavailable', cause: startup })
    expect(launch).toHaveBeenCalledTimes(2)
  })
})
