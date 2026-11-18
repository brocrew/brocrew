import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import { setup, seams } from './plugin-production-fixtures'
import { supervisorFixtures } from './plugin-supervisor-fixtures'
import { readPluginInstructions } from '../src/main/plugins/instructions'
import { PluginSupervisorAttachment } from '../src/main/plugins/supervisor/client'
import { PluginSupervisorError } from '../src/main/plugins/supervisor/protocol'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'

const owners = supervisorFixtures()
const apps: PluginSupervisorAttachment[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.quit()
  await owners.cleanup()
})

describe.skipIf(process.platform === 'win32')(
  'Settings waits for its current lifecycle owner',
  () => {
    async function begin(mode: 'new' | 'reused', ready = false) {
      const f = await setup()
      const target = await owners.fixture()
      const app = new PluginSupervisorAttachment()
      apps.push(app)
      vi.spyOn(app, 'supports').mockReturnValue(false)
      const recordPath = join(target.root, 'supervisor/owner.json')
      async function publish(lifecycleReady: boolean, epoch?: string) {
        const record = JSON.parse(await readFile(recordPath, 'utf8'))
        // Like the owner: replace the record atomically, never rewrite it in place.
        const staged = `${recordPath}.${randomUUID()}.tmp`
        await writeFile(
          staged,
          JSON.stringify({ ...record, lifecycleReady, ...(epoch && { epoch }) }),
          { mode: 0o600 },
        )
        await rename(staged, recordPath)
      }
      let owner: Awaited<ReturnType<typeof target.start>>
      const launch = vi.fn(async () => {
        owner = await target.start()
        await publish(ready)
      })
      if (mode === 'reused') await launch()
      seams.launch.mockImplementationOnce(() =>
        Object.assign(launch, { diagnostic: () => undefined }),
      )
      seams.connect.mockImplementation(async () => {
        if (!ready) throw new PluginSupervisorError('unavailable')
        return f.peer
      })
      f.controller.start({
        ...f.options,
        root: target.root,
        workspaceRoot: target.workspaceRoot,
        supervisor: app,
      })
      await vi.waitFor(() => expect(app.holdsLease()).toBe(true))
      let settled = false
      const initialization = f.controller.ready!().then(() => {
        settled = true
      })
      return {
        ...f,
        target,
        app,
        launch,
        owner: () => owner!,
        publish,
        initialization,
        settled: () => settled,
        async finish() {
          ready = true
          await publish(true)
        },
      }
    }

    it.each(['new', 'reused'] as const)(
      'keeps attempt 1 pending past the connection window while a %s owner bootstraps',
      async (mode) => {
        const f = await begin(mode)
        try {
          // Owner hello/hold is real. The person server is deliberately not ready yet.
          await delay(5500)
          expect(f.settled()).toBe(false)
          expect(seams.connect).not.toHaveBeenCalled()
          expect(readPluginInstructions(f.controller)).toMatchObject([{ state: 'Unavailable' }])
          await f.finish()
          await f.initialization
          expect(readPluginInstructions(f.controller)).toMatchObject([{ state: 'Available' }])
          expect(seams.connect).toHaveBeenCalledOnce()
          expect(f.launch).toHaveBeenCalledOnce()
          expect(f.app.holdsLease()).toBe(true)
        } finally {
          await f.controller.close()
        }
      },
    )

    it('connects immediately when the reused owner is already ready', async () => {
      const f = await begin('reused', true)
      await f.initialization
      expect(readPluginInstructions(f.controller)).toMatchObject([{ state: 'Available' }])
      expect(seams.connect).toHaveBeenCalledOnce()
      expect(f.launch).toHaveBeenCalledOnce()
    })

    it('reads again when readiness is published during a record read', async () => {
      const f = await begin('reused')
      // The owner's atomic rename can land between one read's lstat and open.
      const read = vi.spyOn(SupervisorStorage.prototype, 'read').mockImplementationOnce(() => {
        throw new PluginSupervisorError('unavailable')
      })
      try {
        await f.finish()
        await f.initialization
        expect(read).toHaveBeenCalled()
        expect(readPluginInstructions(f.controller)).toMatchObject([{ state: 'Available' }])
        expect(seams.connect).toHaveBeenCalledOnce()
        expect(f.launch).toHaveBeenCalledOnce()
      } finally {
        read.mockRestore()
        await f.controller.close()
      }
    })

    it('close cancels startup while the admitted owner is still warming', async () => {
      const f = await begin('reused')
      await f.controller.close()
      await f.initialization
      expect(seams.connect).not.toHaveBeenCalled()
      expect(readPluginInstructions(f.controller)).toBeNull()
      await f.finish()
      await delay(30)
      expect(seams.connect).not.toHaveBeenCalled()
    })

    it('does not connect when bootstrap shuts down its owner', async () => {
      const f = await begin('reused')
      await f.owner().shutdown()
      await f.initialization
      expect(readPluginInstructions(f.controller)).toMatchObject([{ state: 'Unavailable' }])
      expect(seams.connect).not.toHaveBeenCalled()
      await f.controller.close()
    })

    it('a ready record for another epoch cannot complete this admission', async () => {
      const f = await begin('reused')
      await f.publish(true, randomUUID())
      await f.initialization
      expect(readPluginInstructions(f.controller)).toMatchObject([{ state: 'Unavailable' }])
      expect(seams.connect).not.toHaveBeenCalled()
      await f.controller.close()
    })
  },
)
