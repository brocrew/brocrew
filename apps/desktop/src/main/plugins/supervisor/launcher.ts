import { PluginStartupError, observePluginSupervisorLaunch } from '../startup-failure'
import type { PluginUnavailableReason } from '../../../shared/plugin-settings'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { preparePluginNodeRuntime, runtimeFiles } from '../node-runtime'
import {
  privateChild,
  immutableFile,
  verifyImmutableFile,
  publishPrivateDirectory,
  sourceBytes,
  digest,
} from '../node-host-files'
import { SupervisorStorage } from './storage'
import { windowsSystemEnvironment } from '../system-environment'
import { OWNER_LAUNCH_MS, PluginSupervisorError } from './protocol'
import { LaunchConfig, type PluginLifecyclePlan, type PluginStartupPlan } from './launch-format'

/** App/controller input only; no defaults to a system executable, app entry or live root. */
export function createPluginSupervisorLauncher(options: {
  root: string
  workspaceRoots: readonly string[]
  resourcesRoot: string
  browserExecutable?: string
  startup?: PluginStartupPlan
  lifecycle?: PluginLifecyclePlan
  /** Resolves the app-fixed modern source only when a new owner is actually needed. */
  lifecycleForNewOwner?(): Promise<PluginLifecyclePlan>
}): (() => Promise<void>) & { diagnostic(cause?: unknown): Error | undefined } {
  const { lifecycleForNewOwner, ...plain } = options
  const captured = structuredClone(plain)
  let pending: Promise<void> | undefined
  let diagnostic: ReturnType<typeof observePluginSupervisorLaunch> | undefined
  async function launch(): Promise<void> {
    diagnostic = undefined
    const storage = new SupervisorStorage(captured.root, captured.workspaceRoots, true)
    let phase: PluginUnavailableReason = 'storage'
    try {
      const root = storage.root
      phase = 'catalogue'
      const lifecycle = lifecycleForNewOwner ? await lifecycleForNewOwner() : captured.lifecycle
      phase = 'runtime'
      const runtime = await preparePluginNodeRuntime({
        resourcesRoot: captured.resourcesRoot,
        durableRoot: join(root, 'runtimes'),
      })
      const { node } = await runtimeFiles(runtime)
      phase = 'service-start'
      const bytes = await sourceBytes(
        join(captured.resourcesRoot, 'plugin-supervisor/entry.cjs'),
        16 * 1024 * 1024,
      )
      const entries = await privateChild(root, 'supervisor-entries')
      const kept = await publishPrivateDirectory(
        entries,
        digest(bytes),
        async (stage) => {
          await immutableFile(join(stage, 'entry.cjs'), bytes)
        },
        async (directory) => {
          await verifyImmutableFile(join(directory, 'entry.cjs'), bytes)
        },
      )
      const launches = await privateChild(root, 'supervisor-launches')
      const directory = await privateChild(launches, randomUUID())
      const config = LaunchConfig.parse({
        format: 1,
        root,
        workspaceRoots: captured.workspaceRoots,
        runtime: { directory: dirname(node), id: runtime.id },
        browserExecutable: captured.browserExecutable,
        startup: captured.startup,
        lifecycle,
      })
      const input = Buffer.from(JSON.stringify(config)),
        configPath = join(directory, 'launch.json')
      await immutableFile(configPath, input)
      storage.check()
      const temporary =
        process.platform === 'win32' ? await privateChild(root, 'supervisor-temp') : null
      const child = spawn(node, [join(kept, 'entry.cjs'), configPath, digest(input)], {
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
        cwd: root,
        env: temporary
          ? { ...windowsSystemEnvironment(), USERPROFILE: root, TEMP: temporary, TMP: temporary }
          : { HOME: root, PATH: '/usr/bin:/bin', LC_ALL: 'C' },
      })
      diagnostic = observePluginSupervisorLaunch(child, [config.lifecycle?.personKey ?? ''])
      let failed = false
      let spawnError: Error | undefined
      child.once('error', (error) => {
        failed = true
        spawnError = error
      })
      child.unref()
      const until = performance.now() + OWNER_LAUNCH_MS - 200
      while (performance.now() < until) {
        if (failed || child.exitCode !== null || child.signalCode !== null) break
        try {
          const ready = JSON.parse(
            (await sourceBytes(join(directory, 'service.json'), 4096)).toString('utf8'),
          )
          if (ready.format === 1 && ready.ready === true && ready.pid === child.pid) return
        } catch {
          /* Missing private readiness is never authority to attach. */
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      await diagnostic.drainUntil(until)
      throw new PluginSupervisorError('unavailable', {
        cause: Object.assign(diagnostic(), { cause: spawnError }),
      })
    } catch (error) {
      throw new PluginStartupError(phase, error)
    } finally {
      storage.close()
    }
  }
  return Object.assign(
    () => {
      pending ??= launch()
        .catch((error) => {
          if (error instanceof PluginSupervisorError) throw error
          throw new PluginSupervisorError('unavailable', { cause: error })
        })
        .finally(() => {
          pending = undefined
        })
      return pending
    },
    {
      diagnostic: (cause?: unknown) =>
        diagnostic ? Object.assign(diagnostic(), { cause }) : undefined,
    },
  )
}
