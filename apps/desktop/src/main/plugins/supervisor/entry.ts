// Self-contained standalone Node entry. Electron never owns the global process tree.
import { dirname, join } from 'node:path'
import { createPluginNodeHost } from '../node-host'
import { resumePluginNodeRuntime } from '../node-runtime'
import { sourceBytes, digest } from '../node-host-files'
import { writeReceipt } from '../../../../resources/plugin-host/receipts.mjs'
import { PluginSupervisor } from './owner'
import { createSupervisedPluginHost } from './node-host'
import { bootstrapPluginLifecycle } from '../lifecycle/bootstrap'
import { pluginStartupStderr } from '../startup-failure'
import { LaunchConfig } from './launch-format'
import { checkedSharedDataOwner } from '../shared-data'
import { previousRunsProvenStopped } from './recovery-proof'
import { recordDrainTrace } from './drain-trace'
import { openLog, serviceLogFile } from '../../logging/log'
import { PluginSupervisorError, ownerDiagnosticLine } from './protocol'

export async function runPluginSupervisor(configPath: string, expectedDigest: string) {
  const bytes = await sourceBytes(configPath, 1024 * 1024)
  if (!/^[a-f0-9]{64}$/.test(expectedDigest) || digest(bytes) !== expectedDigest)
    throw new Error('unavailable')
  const config = LaunchConfig.parse(JSON.parse(bytes.toString('utf8')))
  openLog(serviceLogFile(config.root), { console: false, sync: true })
  if (config.sharedDataOwner)
    checkedSharedDataOwner(config.sharedDataOwner, join(config.root, 'host'))

  const runtime = await resumePluginNodeRuntime(config.runtime)
  const receipts = dirname(configPath)
  const owner = await PluginSupervisor.start({
    root: config.root,
    workspaceRoots: config.workspaceRoots,
    recoverPrevious: async (previous) => {
      if (await previousRunsProvenStopped(config.root, { previous })) return true
      throw new PluginSupervisorError('cleanup-pending', {
        diagnostic: {
          phase: previous?.phase ?? 'missing',
          stage: 'recovery',
          probe: 'no-answer',
          reason: 'proof-pending',
        },
      })
    },
    traceDrain: recordDrainTrace,
    // Exit with the lock held so the next owner rechecks run receipts before starting.
    onBlockedWithoutProcesses: () => process.exit(0),
  })
  const host = createPluginNodeHost({
    root: join(config.root, 'host'),
    runtime,
    browserExecutable: config.browserExecutable,
    sharedDataOwner: config.sharedDataOwner,
  })
  const service = createSupervisedPluginHost(owner, host)
  const reportFailure = (error: unknown) => {
    const message =
      error instanceof Error && error.name !== 'ZodError'
        ? error.message
        : 'Invalid plugin service configuration'
    console.error(pluginStartupStderr(message) ?? 'Plugin service failed')
  }
  const stop = async () => {
    if (await owner.shutdown()) {
      await host.stop()
      process.exit(0)
    }
  }
  process.on('SIGTERM', () => {
    void stop()
  })
  process.on('SIGINT', () => {
    void stop()
  })
  void owner.closed.then(async () => {
    await host.stop()
    process.exit(0)
  })
  writeReceipt(receipts, 'service.json', { format: 1, ready: true, pid: process.pid })
  if (config.lifecycle) {
    const bootstrap = async () => {
      while (!owner.acceptsStarts()) await new Promise((resolve) => setTimeout(resolve, 10))
      await bootstrapPluginLifecycle({
        root: config.root,
        workspaceRoots: config.workspaceRoots,
        owner,
        host,
        plan: config.lifecycle!,
      })
      writeReceipt(receipts, 'lifecycle.json', { format: 1, ready: true })
    }
    void bootstrap().catch((error) => {
      reportFailure(error)
      void stop()
    })
  }
  return { owner, service }
}
if (typeof require !== 'undefined' && require.main === module) {
  void runPluginSupervisor(process.argv[2]!, process.argv[3]!).catch((error) => {
    console.error(
      pluginStartupStderr(
        error instanceof PluginSupervisorError && error.diagnostic
          ? ownerDiagnosticLine(error.diagnostic)
          : error instanceof Error && error.name !== 'ZodError'
            ? error.message
            : 'Invalid plugin service configuration',
      ) ?? 'Plugin service failed',
    )
    process.exitCode = 1
  })
}
