import './plugin-startup-fixtures'
import fs from 'node:fs'
import * as asyncFs from 'node:fs/promises'
import { prepareFirst } from './plugin-startup-fixtures'
import { join, dirname } from 'node:path'
import { expect, it, vi } from 'vitest'
import { setup, seams } from './plugin-production-fixtures'
import { fixture, deferred } from './plugin-lifecycle-fixtures'
import { readPluginInstructions } from '../src/main/plugins/instructions'

async function emptyOffers() {
  const owner = await fixture()
  const f = await setup(owner.pkg)
  f.fetch.mockImplementation(async () => new Response(JSON.stringify({ format: 1, entries: [] })))
  const options = {
    ...f.options,
    root: owner.root,
    workspaceRoot: owner.workspace,
    target: owner.opts.target,
  }
  const guard = join(owner.root, 'state/lifecycle-guard')
  const opens = () =>
    vi.mocked(fs.openSync).mock.calls.filter(([path]) => dirname(String(path)) === guard).length
  return { ...f, owner, options, guard, opens }
}

it('does not synchronously replay an existing empty journal during startup with an active agent', async () => {
  const f = await emptyOffers()
  const at = f.opens()
  f.controller.start(f.options)
  readPluginInstructions(f.controller)
  await f.controller.ready!()
  console.info(`startup empty: sync journal opens=${f.opens() - at}`)
  expect(f.supervisor.start).not.toHaveBeenCalled()
  expect(seams.connect).not.toHaveBeenCalled()
  expect(f.opens() - at).toBe(0)
})

it('does not replay on the existing automatic reconnect while an agent is active', async () => {
  const f = await emptyOffers()
  await f.owner.controller.install(f.owner.handle, 'chrome')
  f.controller.start(f.options)
  expect(await f.controller.ready!()).toBe(true)
  await f.owner.controller.uninstall(f.owner.handle, 'chrome')
  f.supervisor.stoppedCleanly.mockReturnValue(true)
  const timeout = vi.spyOn(globalThis, 'setTimeout')
  const connectionOptions = seams.connect.mock.calls.at(-1)![0] as { lost(): void }
  connectionOptions.lost()
  const tick = timeout.mock.calls.find(([, ms]) => ms === 1000)![0] as () => void
  const at = f.opens()
  tick()
  readPluginInstructions(f.controller)
  await f.controller.ready!()
  await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(2))
  await f.controller.ready!()
  console.info(`reconnect empty: sync journal opens=${f.opens() - at}`)
  expect(f.supervisor.start).toHaveBeenCalledOnce()
  expect(f.opens() - at).toBe(0)
})

it('keeps the attachment fallback for installed state', async () => {
  const f = await emptyOffers()
  await f.owner.controller.install(f.owner.handle, 'chrome')
  f.controller.start(f.options)
  expect(await f.controller.ready!()).toBe(true)
  expect(f.supervisor.start).toHaveBeenCalledOnce()
})

it('keeps the attachment fallback for a partial journal', async () => {
  const f = await emptyOffers()
  fs.unlinkSync(
    join(
      f.guard,
      fs.readdirSync(f.guard).find((name) => name.endsWith('.seal'))!,
    ),
  )
  f.controller.start(f.options)
  expect(await f.controller.ready!()).toBe(true)
  expect(f.supervisor.start).toHaveBeenCalledOnce()
})

it('recovers on the next existing reconnect when first pending state is published after the final stamp', async () => {
  const f = await emptyOffers(),
    native = vi.mocked(asyncFs.open).getMockImplementation()!
  let published = false
  vi.mocked(asyncFs.open).mockImplementation(async (...args) => {
    const handle = await native(...args)
    if (String(args[0]) === f.owner.root && !published) {
      const close = handle.close.bind(handle)
      handle.close = async () => {
        await close()
        if (!published) {
          published = true
          prepareFirst(f.owner)
        }
      }
    }
    return handle
  })
  try {
    f.controller.start(f.options)
    await f.controller.ready!()
  } finally {
    vi.mocked(asyncFs.open).mockImplementation(native)
  }
  expect(published).toBe(true)
  expect(f.supervisor.start).not.toHaveBeenCalled()
  Object.assign(f.peer, {
    displayCatalogue: async () => ({ cards: [], evidence: { installed: [], pending: 'chrome' } }),
  })
  const at = f.opens()
  await f.controller.catalogue()
  expect(f.supervisor.start).toHaveBeenCalledOnce()
  expect(f.opens() - at).toBe(0)
})

it('does not start an owner after Close while the nonempty startup observation is pending', async () => {
  const f = await emptyOffers(),
    native = vi.mocked(asyncFs.open).getMockImplementation()!
  await f.owner.controller.install(f.owner.handle, 'chrome')
  const opened = deferred<void>(),
    resume = deferred<void>()
  let held = false
  vi.mocked(asyncFs.open).mockImplementation(async (...args) => {
    const handle = await native(...args)
    if (!held && dirname(String(args[0])) === f.guard) {
      held = true
      opened.resolve()
      await resume.promise
    }
    return handle
  })
  try {
    f.controller.start(f.options)
    await opened.promise
    const closing = f.controller.close()
    resume.resolve()
    await closing
    expect(f.supervisor.start).not.toHaveBeenCalled()
    expect(seams.connect).not.toHaveBeenCalled()
  } finally {
    resume.resolve()
    vi.mocked(asyncFs.open).mockImplementation(native)
  }
})
