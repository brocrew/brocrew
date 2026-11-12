import { mkdtemp, realpath, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPluginNodeHost } from '../src/main/plugins/node-host'
import { createRepoAwarePluginVerifier } from '../src/main/plugins/package-verifier'
import { manifestFor, packageFixture } from './plugin-package-fixtures'
import { pluginNodeRuntimeFixture } from './lib/plugin-node-runtime-fixture'

const startGate = vi.hoisted(() => ({
  held: false,
  entered: false,
  release: undefined as (() => void) | undefined,
}))
vi.mock('../src/main/plugins/node-runtime', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/main/plugins/node-runtime')>()
  return {
    ...original,
    async runtimeFiles(...args: Parameters<typeof original.runtimeFiles>) {
      if (startGate.held) {
        startGate.entered = true
        await new Promise<void>((resolve) => {
          startGate.release = resolve
        })
      }
      return original.runtimeFiles(...args)
    },
  }
})

let folder = ''
let host: ReturnType<typeof createPluginNodeHost> | undefined

afterEach(async () => {
  startGate.held = false
  startGate.release?.()
  await host?.stop()
  if (folder) await rm(folder, { recursive: true, force: true })
  host = undefined
  folder = ''
})

describe.skipIf(process.platform === 'win32')('Node host pending-start cleanup', () => {
  it('waits for an accepted pending start on stop and never forks it afterwards', async () => {
    folder = await realpath(await mkdtemp(join(tmpdir(), 'nh-pending-')))
    const { runtime } = await pluginNodeRuntimeFixture(folder)
    const home = join(folder, 'private')
    host = createPluginNodeHost({ root: home, runtime, readyMs: 5000 })
    const manifest = manifestFor()
    manifest.platforms = [
      { os: process.platform as 'darwin' | 'linux', cpu: process.arch as 'arm64' | 'x64' },
    ]
    const value = packageFixture({ manifest })
    const catalogue = createRepoAwarePluginVerifier({
      target: manifest.platforms[0]!,
    }).verifyCatalogue(value.bytes)
    const spec = {
      package: catalogue.verifyPackage(manifest.id, manifest.version, value.archive),
      releaseDigest: value.release.archive.sha256,
    }
    startGate.held = true
    startGate.entered = false
    const starting = host.start(spec)
    void starting.catch(() => undefined)
    try {
      await vi.waitFor(() => expect(startGate.entered).toBe(true))
      let settled = false
      const stopped = host.stop().then((result) => {
        settled = true
        return result
      })
      await new Promise((resolve) => setImmediate(resolve))
      expect(settled).toBe(false)
      startGate.release!()
      await expect(starting).rejects.toThrow('plugin-host-start')
      await expect(stopped).resolves.toEqual({ exited: false })
      const runs = await readdir(join(home, 'runs'))
      expect(runs).toEqual([])
    } finally {
      startGate.held = false
      startGate.release?.()
    }
  }, 30000)
})
