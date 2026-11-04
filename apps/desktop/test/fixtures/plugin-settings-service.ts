import { randomUUID } from 'node:crypto'
import { SupervisorStorage } from '../../src/main/plugins/supervisor/storage'
import { PluginSupervisor } from '../../src/main/plugins/supervisor/owner'
import { servePersonPluginControl } from '../../src/main/plugins/lifecycle/person-control'
import type { PluginLifecycleController } from '../../src/main/plugins/lifecycle/controller'

export async function startSettingsService(root: string) {
  const owner = await PluginSupervisor.start({ root, workspaceRoots: [] })
  const controller = {
    attach: async () => ({ workspaceId: randomUUID() }),
    detach: async () => {},
    onHostChanged: () => () => {},
    status: async () => ({
      cards: [{ id: 'fictional-kite', state: 'Running', installed: true }],
      cleanupPending: [],
    }),
  } as unknown as PluginLifecycleController
  const settings = await servePersonPluginControl({
    root,
    key: 'fictional-settings-instance',
    controller,
    read: async () => null,
  })
  const stop = async () => {
    await settings.close()
    await owner.shutdown()
    process.exit(0)
  }
  process.once('SIGTERM', () => {
    void stop()
  })
  const storage = new SupervisorStorage(root, [], false)
  const epoch = storage.read()!.epoch
  storage.close()
  process.send?.({ ready: true, path: settings.path, epoch })
}
if (typeof require !== 'undefined' && require.main === module) {
  void startSettingsService(process.argv[2]!).catch((error) => {
    process.send?.({ ready: false, code: (error as NodeJS.ErrnoException).code ?? 'failure' })
    process.exitCode = 1
  })
}
