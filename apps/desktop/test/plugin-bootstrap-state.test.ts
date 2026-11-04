import { afterEach, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import { bootstrapPluginLifecycle } from '../src/main/plugins/lifecycle/bootstrap'
import type { createSupervisorLifecycle } from '../src/main/plugins/lifecycle/supervisor'
import { fictionalPublicKey, signed } from './plugin-package-fixtures'
const seam = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('../src/main/plugins/lifecycle/supervisor', () => ({
  createSupervisorLifecycle: seam.start,
}))
const folders: string[] = [],
  states: GlobalPluginState[] = []
afterEach(() => {
  for (const state of states.splice(0)) state.close()
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true })
  vi.resetAllMocks()
})
it.each(['absent', 'old', 'torn'] as const)(
  'production bootstrap opens ordinary state with %s historical birth marker and preserves opaque data',
  async (marker) => {
    const root = mkdtempSync(
      join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-bootstrap-'),
    )
    folders.push(root)
    const markerPath = join(root, 'lifecycle-state-born')
    if (marker !== 'absent') writeFileSync(markerPath, marker === 'old' ? '1\n' : '{interrupted')
    mkdirSync(join(root, 'data', 'fictional-kite'), { recursive: true })
    const opaque = join(root, 'data', 'fictional-kite', 'fictional-profile-and-consumed-command')
    const bytes = Buffer.from('fictional pairing/profile bytes\u0000consumed-command=17')
    writeFileSync(opaque, bytes)
    const empty = signed({ format: 1, entries: [] })
    const catalogue = join(root, 'fictional-catalogue.json'),
      signature = join(root, 'fictional-signature')
    writeFileSync(catalogue, empty.bytes)
    writeFileSync(signature, empty.signature)
    let observed!: GlobalPluginState
    seam.start.mockImplementation(
      async (options: Parameters<typeof createSupervisorLifecycle>[0]) => {
        observed = options.lifecycle.state
        states.push(observed)
        return { controller: {}, close: async () => {} }
      },
    )
    let end!: () => void
    const closed = new Promise<void>((resolve) => {
      end = resolve
    })
    const input: Parameters<typeof bootstrapPluginLifecycle>[0] = {
      root,
      workspaceRoots: [],
      owner: { closed } as Parameters<typeof bootstrapPluginLifecycle>[0]['owner'],
      host: {} as Parameters<typeof bootstrapPluginLifecycle>[0]['host'],
      plan: {
        publicKey: fictionalPublicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
        catalogue,
        signature,
        personKey: 'a'.repeat(64),
      },
    }
    try {
      await expect(bootstrapPluginLifecycle(input)).resolves.toBeDefined()
      expect(observed.inspect().pending).toBeNull()
      expect(observed.exportActivation().entries).toEqual([])
      expect(seam.start).toHaveBeenCalledOnce()
      const workspaceId = randomUUID()
      observed.setEnabled(workspaceId, 'fictional-kite', false)
      observed.setTitlesEnabled(workspaceId, 'fictional-kite', true)
      await bootstrapPluginLifecycle(input)
      expect(observed.getEnabled(workspaceId, 'fictional-kite')).toEqual({
        enabled: false,
        revision: 1,
      })
      expect(observed.getTitlesEnabled(workspaceId, 'fictional-kite')).toEqual({
        enabled: true,
        revision: 1,
      })
      expect(readFileSync(opaque)).toEqual(bytes)
      expect(existsSync(markerPath)).toBe(marker !== 'absent')
      if (marker !== 'absent')
        expect(readFileSync(markerPath, 'utf8')).toBe(marker === 'old' ? '1\n' : '{interrupted')
    } finally {
      end()
      await closed
    }
  },
)
