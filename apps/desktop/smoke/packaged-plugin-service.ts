// Exercise shipped service bytes with fresh data, the production argv, and an owned child handle.
import { preparePluginTools, callPluginTools } from './packaged-plugin-tools'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  PluginWorkspaceLease,
  pluginWorkspaceIdentity,
} from '../src/main/plugins/supervisor/client'
import { LaunchConfig } from '../src/main/plugins/supervisor/launch-format'
import { OWNER_LAUNCH_MS } from '../src/main/plugins/supervisor/protocol'
import { preparePluginNodeRuntime, runtimeFiles } from '../src/main/plugins/node-runtime'
import {
  digest,
  immutableFile,
  privateChild,
  privateRoot,
  sourceBytes,
} from '../src/main/plugins/node-host-files'
import { windowsSystemEnvironment } from '../src/main/plugins/system-environment'
import {
  observePluginSupervisorLaunch,
  recordPluginStartupFailure,
} from '../src/main/plugins/startup-failure'

export async function smoke(resources: string, scratch: string, packages?: string) {
  const root = await privateRoot(join(scratch, 'p'))
  const workspace = join(scratch, 'w')
  await mkdir(workspace, { mode: 0o700 })
  const runtime = await preparePluginNodeRuntime({
    resourcesRoot: resources,
    durableRoot: join(root, 'runtimes'),
  })
  const { node } = await runtimeFiles(runtime)
  const bytes = await sourceBytes(join(resources, 'plugin-supervisor/entry.cjs'), 16 * 1024 * 1024)
  const entry = join(await privateChild(root, `supervisor-entries/${digest(bytes)}`), 'entry.cjs')
  await immutableFile(entry, bytes)
  const directory = await privateChild(root, `supervisor-launches/${randomUUID()}`)
  const lifecycle = packages ? await preparePluginTools(root, scratch, packages) : undefined
  const input = Buffer.from(
    JSON.stringify(
      LaunchConfig.parse({
        format: 1,
        lifecycle,
        root,
        workspaceRoots: [workspace],
        runtime: { directory: dirname(node), id: runtime.id },
      }),
    ),
  )
  const configPath = join(directory, 'launch.json')
  await immutableFile(configPath, input)
  const child = spawn(node, [entry, configPath, digest(input)], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
    env:
      process.platform === 'win32'
        ? { ...windowsSystemEnvironment(), USERPROFILE: root, TEMP: scratch, TMP: scratch }
        : { HOME: root, PATH: '/usr/bin:/bin', LC_ALL: 'C' },
  })
  const diagnostic = observePluginSupervisorLaunch(child, [])
  let spawnError: Error | undefined
  let ended = false
  const closed = new Promise<void>((resolve) => {
    child.once('error', (error) => {
      spawnError = error
    })
    child.once('close', () => {
      ended = true
      resolve()
    })
  })
  const waitForExit = async (within: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        closed,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, within)
        }),
      ])
      return ended
    } finally {
      clearTimeout(timer)
    }
  }
  // The driver can time out independently of readiness; stop only this owned child handle.
  const interrupted = () => {
    child.kill('SIGTERM')
  }
  process.on('SIGTERM', interrupted)
  process.on('SIGINT', interrupted)
  let lease: PluginWorkspaceLease | undefined
  try {
    const until = performance.now() + OWNER_LAUNCH_MS
    let ready = false
    while (performance.now() < until) {
      if (spawnError) throw spawnError
      if (ended || child.exitCode !== null || child.signalCode !== null) {
        await diagnostic.drainUntil(until)
        throw diagnostic()
      }
      try {
        const receipt = JSON.parse(await readFile(join(directory, 'service.json'), 'utf8'))
        assert.equal(receipt.ready, true)
        assert.equal(receipt.pid, child.pid)
        ready = true
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    if (!ready) throw diagnostic()
    lease = await PluginWorkspaceLease.attach({
      root,
      workspaceRoot: workspace,
      generation: randomUUID(),
      build: 'packaged-service-smoke',
      launch: async () => {
        throw new Error('shipped service exited before attachment')
      },
    })
    // Observe the live shipped process after startup, then require an authenticated response.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    assert.equal(ended, false, 'packaged plugin service exited after readiness')
    await lease.renew()
    if (lifecycle)
      await callPluginTools(root, directory, lifecycle, lease, pluginWorkspaceIdentity(workspace))
    assert.equal(ended, false, 'packaged plugin service exited during tool calls')
    assert.equal(await lease.close(), true, 'packaged plugin service did not drain')
    lease = undefined
    assert.equal(
      await waitForExit(5000),
      true,
      'packaged plugin service did not exit after release',
    )
    assert.equal(child.exitCode, 0)
    console.log(
      `[plugin-service-check] ${packages ? 'plugin calls' : 'lifecycle only (plugin calls not requested)'}: ready, alive, authenticated, drained and exited`,
    )
  } catch (error) {
    await recordPluginStartupFailure(root, 'service-start', error)
    console.error(await readFile(join(root, 'plugin-startup.log'), 'utf8'))
    throw error
  } finally {
    try {
      await lease?.close()
    } finally {
      try {
        if (!ended) {
          child.kill('SIGTERM')
          if (!(await waitForExit(5000))) child.kill('SIGKILL')
          assert.equal(await waitForExit(5000), true, 'smoke-owned service cleanup unproved')
        }
      } finally {
        process.off('SIGTERM', interrupted)
        process.off('SIGINT', interrupted)
      }
    }
  }
}
