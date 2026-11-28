import './plugin-startup-fixtures'
import fs from 'node:fs'
import * as asyncFs from 'node:fs/promises'
import { prepareFirst } from './plugin-startup-fixtures'
import { join, dirname } from 'node:path'
import { expect, it, vi } from 'vitest'
import { setup, seams } from './plugin-production-fixtures'
import { fixture, deferred, stateFile } from './plugin-lifecycle-fixtures'
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
  const state = join(owner.root, 'state')
  const opens = () =>
    [
      ...vi.mocked(fs.openSync).mock.calls.map(([path]) => path),
      ...vi.mocked(fs.readFileSync).mock.calls.map(([path]) => path),
    ].filter((path) => dirname(String(path)) === state).length
  return { ...f, owner, options, state, opens }
}

it('does not synchronously read the plugin state during startup with an active agent', async () => {
  const f = await emptyOffers()
  const at = f.opens()
  f.controller.start(f.options)
  readPluginInstructions(f.controller)
  await f.controller.ready!()
  console.info(`startup empty: sync state reads=${f.opens() - at}`)
  expect(f.supervisor.start).not.toHaveBeenCalled()
  expect(seams.connect).not.toHaveBeenCalled()
  expect(f.opens() - at).toBe(0)
})

it('does not read it synchronously on the existing automatic reconnect while an agent is active', async () => {
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
  console.info(`reconnect empty: sync state reads=${f.opens() - at}`)
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

it('keeps the attachment fallback for an unreadable state file', async () => {
  const f = await emptyOffers()
  fs.writeFileSync(stateFile(f.state)!, '{"format":2')
  f.controller.start(f.options)
  expect(await f.controller.ready!()).toBe(true)
  expect(f.supervisor.start).toHaveBeenCalledOnce()
})

it('recovers on the next existing reconnect when first pending state is published after the read', async () => {
  const f = await emptyOffers(),
    native = vi.mocked(asyncFs.readFile).getMockImplementation()!
  let published = false
  vi.mocked(asyncFs.readFile).mockImplementation(async (...args) => {
    const bytes = await native(...args)
    if (dirname(String(args[0])) === f.state && !published) {
      published = true
      prepareFirst(f.owner)
    }
    return bytes
  })
  try {
    f.controller.start(f.options)
    await f.controller.ready!()
  } finally {
    vi.mocked(asyncFs.readFile).mockImplementation(native)
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
    native = vi.mocked(asyncFs.readFile).getMockImplementation()!
  await f.owner.controller.install(f.owner.handle, 'chrome')
  const opened = deferred<void>(),
    resume = deferred<void>()
  let held = false
  vi.mocked(asyncFs.readFile).mockImplementation(async (...args) => {
    const bytes = await native(...args)
    if (!held && dirname(String(args[0])) === f.state) {
      held = true
      opened.resolve()
      await resume.promise
    }
    return bytes
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
    vi.mocked(asyncFs.readFile).mockImplementation(native)
  }
})
