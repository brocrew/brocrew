import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import { createPluginSupervisorLauncher } from '../src/main/plugins/supervisor/launcher'
import { pluginFailureCause, pluginStartupDiagnostic } from '../src/main/plugins/startup-failure'

const runtime = vi.hoisted(() => ({ node: process.execPath }))
vi.mock('../src/main/plugins/node-runtime', () => ({
  preparePluginNodeRuntime: async () => ({ id: 'a'.repeat(64), version: process.versions.node }),
  runtimeFiles: async () => ({ node: runtime.node }),
}))
let root = ''
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})
it.each(['exit', 'spawn'] as const)(
  'fails promptly after a real child %s failure, keeping the actual diagnostic',
  async (failure) => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'fictional-launch-failure-')))
    const workspaceRoot = join(root, 'workspace')
    const resourcesRoot = join(root, 'resources')
    await mkdir(workspaceRoot)
    await mkdir(join(resourcesRoot, 'plugin-supervisor'), { recursive: true })
    await writeFile(
      join(resourcesRoot, 'plugin-supervisor/entry.cjs'),
      "require('fictional-missing-startup-module')",
    )
    runtime.node = failure === 'exit' ? process.execPath : join(root, 'absent-node')
    const options = {
      root: join(root, 'global'),
      workspaceRoot,
      generation: randomUUID(),
      build: 'fictional-build',
    }
    const launch = createPluginSupervisorLauncher({
      root: options.root,
      workspaceRoots: [workspaceRoot],
      resourcesRoot,
    })
    const began = performance.now()
    const error = await PluginWorkspaceLease.attach({ ...options, launch }).catch(
      (error: unknown) => error,
    )
    expect(error).toMatchObject({ code: 'unavailable' })
    expect(pluginStartupDiagnostic(launch.diagnostic(error) ?? error)).toEqual({
      exitCode: failure === 'exit' ? 1 : null,
      signal: null,
      stderr:
        failure === 'exit' ? "Error: Cannot find module 'fictional-missing-startup-module'" : null,
    })
    if (failure === 'spawn') expect(pluginFailureCause(error)).toContain('ENOENT')
    expect(performance.now() - began).toBeLessThan(2_000)
  },
)
