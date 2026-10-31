// Self-contained standalone Node entry. Electron never owns the global process tree.
import { createPublicKey } from 'node:crypto'
import { dirname, join } from 'node:path'
import { createPluginNodeHost } from '../node-host'
import { resumePluginNodeRuntime } from '../node-runtime'
import { sourceBytes, digest } from '../node-host-files'
import { keepPluginRootPrivate } from '../private-files'
import { createPluginVerifier } from '../package-verifier'
import { PLUGIN_LIMITS } from '../package-digests'
import { thisMachine } from '../package-schema'
import { writeReceipt } from '../../../../resources/plugin-host/receipts.mjs'
import { PluginSupervisor } from './owner'
import { createSupervisedPluginHost } from './node-host'
import { bootstrapPluginLifecycle } from '../lifecycle/bootstrap'
import { pluginStartupStderr } from '../startup-failure'
import { LaunchConfig } from './launch-format'

export async function runPluginSupervisor(configPath: string, expectedDigest: string) {
  const bytes = await sourceBytes(configPath, 1024 * 1024)
  if (!/^[a-f0-9]{64}$/.test(expectedDigest) || digest(bytes) !== expectedDigest)
    throw new Error('unavailable')
  const config = LaunchConfig.parse(JSON.parse(bytes.toString('utf8')))
  await keepPluginRootPrivate(config.root)
  const runtime = await resumePluginNodeRuntime(config.runtime)
  const owner = await PluginSupervisor.start({
    root: config.root,
    workspaceRoots: config.workspaceRoots,
  })
  const host = createPluginNodeHost({
    root: join(config.root, 'host'),
    runtime,
    browserExecutable: config.browserExecutable,
  })
  const service = createSupervisedPluginHost(owner, host)
  const receipts = dirname(configPath)
  const reportFailure = (error: unknown) => {
    const message =
      error instanceof Error && error.name !== 'ZodError'
        ? error.message
        : 'Invalid plugin service configuration'
    console.error(
      pluginStartupStderr(message, [config.lifecycle?.personKey ?? '']) ?? 'Plugin service failed',
    )
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
  if (config.startup) {
    // Installer/controller bootstrap only; no package path, key or start command is accepted
    // by the workspace lease protocol. The shipped app supplies no startup plan yet.
    const startup = async () => {
      while (!owner.acceptsStarts()) await new Promise((resolve) => setTimeout(resolve, 10))
      const plan = config.startup!
      const verifier = createPluginVerifier({
        pinnedPublicKey: createPublicKey({
          key: Buffer.from(plan.publicKey, 'base64'),
          format: 'der',
          type: 'spki',
        }),
        target: thisMachine(),
      }).verifyCatalogue(
        await sourceBytes(plan.catalogue, PLUGIN_LIMITS.catalogueBytes),
        await sourceBytes(plan.signature, 64),
      )
      const runs = []
      for (const spec of plan.packages) {
        const release = verifier.entries.find(
          (entry) => entry.id === spec.id && entry.version === spec.version,
        )
        if (!release) throw new Error('unavailable')
        const checked = verifier.verifyPackage(
          spec.id,
          spec.version,
          await sourceBytes(spec.archive, PLUGIN_LIMITS.archiveBytes),
        )
        const run = await service.start({ package: checked, releaseDigest: release.archive.sha256 })
        runs.push({
          runId: run.runId,
          receiptPath: run.receiptPath,
          serverPid: run.connection.serverPid,
          pluginId: spec.id,
          releaseDigest: release.archive.sha256,
        })
      }
      writeReceipt(receipts, 'runs.json', { format: 1, runs })
    }
    void startup().catch((error) => {
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
        error instanceof Error && error.name !== 'ZodError'
          ? error.message
          : 'Invalid plugin service configuration',
      ) ?? 'Plugin service failed',
    )
    process.exitCode = 1
  })
}
