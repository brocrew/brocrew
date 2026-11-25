import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import { setup, seams } from './plugin-production-fixtures'
import { deferred, supervisorFixtures } from './plugin-supervisor-fixtures'
import { readPluginInstructions } from '../src/main/plugins/instructions'
import { PluginSupervisorAttachment } from '../src/main/plugins/supervisor/client'
import { PluginSupervisorError } from '../src/main/plugins/supervisor/protocol'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'

const owners = supervisorFixtures()
const apps: PluginSupervisorAttachment[] = []
const controllers: { close(): Promise<void> }[] = []
afterEach(async () => {
  // Controllers first: a startup or retry still running writes into the owner root, and removing
  // that root under it failed with ENOTEMPTY (card 395).
  for (const controller of controllers.splice(0)) await controller.close()
  for (const app of apps.splice(0)) await app.quit()
  await owners.cleanup()
})

describe.skipIf(process.platform === 'win32')(
  'Settings waits for its current lifecycle owner',
  () => {
    async function begin(mode: 'new' | 'reused', ready = false) {
      const f = await setup()
      controllers.push(f.controller)
      const target = await owners.fixture()
      const app = new PluginSupervisorAttachment()
      apps.push(app)
      vi.spyOn(app, 'supports').mockReturnValue(false)
      const admitting = deferred<void>()
      const start = app.start.bind(app)
      vi.spyOn(app, 'start').mockImplementation((options) => {
        start(options)
        admitting.resolve()
      })
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
      // Wait for the admission itself. A 1 s poll measured the runner: a whole owner launch, hello
      // and hold took 30-270 ms here and passed 1 s on a busy CI runner (card 395).
      await admitting.promise
      expect(await app.ready(), String(app.lastStartError)).toBe(true)
      expect(app.holdsLease()).toBe(true)
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

    it('keeps trying a transient connection while the same owner still accepts the lease', async () => {
      const f = await begin('reused')
      const realNow = performance.now.bind(performance)
      let elapsed = 0
      const clock = vi.spyOn(performance, 'now').mockImplementation(() => realNow() + elapsed)
      seams.connect.mockImplementationOnce(async () => {
        elapsed = 65_000
        throw new PluginSupervisorError('unavailable', {
          cause: Object.assign(new Error('fictional listener not ready'), { code: 'ENOENT' }),
        })
      })
      try {
        await f.finish()
        await f.initialization
        expect(f.app.holdsLease()).toBe(true)
        expect(readPluginInstructions(f.controller)).toMatchObject([{ state: 'Available' }])
        expect(seams.connect).toHaveBeenCalledTimes(2)
        expect(f.launch).toHaveBeenCalledOnce()
      } finally {
        clock.mockRestore()
        await f.controller.close()
      }
    })

    it('keeps a second workspace waiting when the first workspace closes during a shared launch', async () => {
      const first = await setup()
      const second = await setup()
      const target = await owners.fixture()
      const firstApp = new PluginSupervisorAttachment()
      const secondApp = new PluginSupervisorAttachment()
      apps.push(firstApp, secondApp)
      controllers.push(first.controller, second.controller)
      for (const app of [firstApp, secondApp]) vi.spyOn(app, 'supports').mockReturnValue(false)
      const launching = deferred<void>()
      const publish = deferred<void>()
      const joining = deferred<void>()
      const start = secondApp.start.bind(secondApp)
      vi.spyOn(secondApp, 'start').mockImplementation((options) => {
        start(options)
        joining.resolve()
      })
      const launched = vi.fn(async (signal?: AbortSignal) => {
        launching.resolve()
        if (signal) {
          await Promise.race([
            publish.promise,
            new Promise<never>((_, reject) =>
              signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
            ),
          ])
        } else await publish.promise
        await target.start()
      })
      seams.launch.mockImplementation((options: unknown) =>
        Object.assign(() => launched((options as { signal?: AbortSignal }).signal), {
          diagnostic: () => undefined,
        }),
      )
      try {
        first.controller.start({ ...first.options, root: target.root, supervisor: firstApp })
        await launching.promise
        second.controller.start({ ...second.options, root: target.root, supervisor: secondApp })
        await joining.promise
        await first.controller.close()
        publish.resolve()
        expect(await secondApp.ready()).toBe(true)
        await second.controller.ready!()
        expect(secondApp.holdsLease()).toBe(true)
        expect(readPluginInstructions(second.controller)).toMatchObject([{ state: 'Available' }])
        expect(launched).toHaveBeenCalledOnce()
      } finally {
        publish.resolve()
        seams.launch.mockImplementation(() =>
          Object.assign(async () => {}, { diagnostic: () => undefined }),
        )
      }
    })

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
