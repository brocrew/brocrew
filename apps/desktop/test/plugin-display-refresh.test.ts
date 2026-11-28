import './plugin-startup-fixtures'
import fs from 'node:fs'
import * as asyncFs from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { setup, settingsCall } from './plugin-production-fixtures'
import { fixture, stateFile } from './plugin-lifecycle-fixtures'
import { readPluginInstructions } from '../src/main/plugins/instructions'
import * as committed from '../src/main/plugins/state/observe-committed'

async function connected(mixed = false) {
  const owner = await fixture()
  await owner.controller.install(owner.handle, 'chrome')
  const f = await setup(owner.pkg)
  const display = vi.fn(async () => {
    const status = await owner.controller.status()
    return {
      cards: mixed
        ? status.cards.map((card) => ({ ...card, installed: false, state: 'Unavailable' as const }))
        : status.cards,
      evidence: status.evidence,
    }
  })
  f.peer.catalogue.mockImplementation(async () => {
    const status = await owner.controller.status()
    return mixed
      ? status.cards.map((card) => ({ ...card, installed: false, state: 'Unavailable' as const }))
      : status.cards
  })
  Object.assign(f.peer, { displayCatalogue: display })
  const options = {
    ...f.options,
    root: owner.root,
    workspaceRoot: owner.workspace,
    target: owner.opts.target,
  }
  // Synchronous reads of the plugin state on workspace main.
  const opens = () =>
    [
      ...vi.mocked(fs.openSync).mock.calls.map(([path]) => path),
      ...vi.mocked(fs.readFileSync).mock.calls.map(([path]) => path),
    ].filter((path) => dirname(String(path)) === join(owner.root, 'state')).length
  return { ...f, owner, display, options, opens }
}

for (const path of ['startup', 'settings', 'agent turn', 'timer', 'mixed fallback']) {
  it(`does not read the plugin state synchronously on workspace main for ${path}`, async () => {
    const interval = vi.spyOn(globalThis, 'setInterval')
    const f = await connected(path === 'mixed fallback')
    const observer = vi.spyOn(committed, 'observeInstallations')
    const before = f.opens()
    f.controller.start(f.options)
    await f.controller.ready!()
    const startup = f.opens() - before
    if (path === 'startup') expect(startup).toBe(0)
    const at = f.opens(),
      displayCalls = f.display.mock.calls.length,
      calls = displayCalls + f.peer.catalogue.mock.calls.length
    if (path === 'settings' || path === 'mixed fallback')
      await settingsCall(f.controller)({ kind: 'list' })
    if (path === 'agent turn') readPluginInstructions(f.controller)
    if (path === 'timer') {
      const tick = interval.mock.calls.find(([, ms]) => ms === 5000)?.[0]
      expect(tick).toBeTypeOf('function')
      ;(tick as () => void)()
    }
    if (path !== 'startup')
      await vi.waitFor(() =>
        expect(f.display.mock.calls.length + f.peer.catalogue.mock.calls.length).toBeGreaterThan(
          calls,
        ),
      )
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(f.opens() - at).toBe(0)
    expect(observer).not.toHaveBeenCalled()
    expect(f.display.mock.calls.length).toBeGreaterThan(path === 'startup' ? 0 : displayCalls)
    expect(await f.controller.catalogue()).toMatchObject([
      { installed: true, state: path === 'mixed fallback' ? 'Unavailable' : 'Running' },
    ])
  })
}

it('uses the same owner evidence for pending and absent fallback cards', async () => {
  const f = await connected(true)
  f.display.mockResolvedValue({
    cards: [{ id: 'chrome', name: 'Chrome', installed: false, state: 'Unavailable' }],
    evidence: { installed: [], pending: 'chrome' },
  })
  f.controller.start(f.options)
  await f.controller.ready!()
  expect(await f.controller.catalogue()).toMatchObject([
    { installed: null, unavailableReason: 'operation-pending' },
  ])
  f.display.mockResolvedValue({
    cards: [{ id: 'chrome', name: 'Chrome', installed: false, state: 'Unavailable' }],
    evidence: { installed: [], pending: null },
  })
  expect(await f.controller.catalogue()).toMatchObject([{ installed: false }])
})

it('legacy agent and timer refresh never request fallback disk evidence', async () => {
  const f = await setup()
  f.peer.catalogue.mockResolvedValue([
    { id: f.pkg.release.id, name: 'Fictional', installed: false, state: 'Unavailable' },
  ])
  const interval = vi.spyOn(globalThis, 'setInterval')
  const observe = vi.spyOn(committed, 'observeInstallations')
  f.controller.start(f.options)
  await f.controller.ready!()
  readPluginInstructions(f.controller)
  await new Promise<void>((resolve) => setImmediate(resolve))
  const tick = interval.mock.calls.find(([, ms]) => ms === 5000)?.[0] as () => void
  tick()
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(observe).not.toHaveBeenCalled()
  observe.mockResolvedValue({ installed: [f.pkg.release.id], pending: null })
  expect(await f.controller.catalogue()).toMatchObject([{ installed: true, state: 'Unavailable' }])
  expect(observe).toHaveBeenCalledOnce()
})

it.each(['partial', 'unreadable'] as const)(
  'disconnected Settings reads fresh %s evidence instead of held cards',
  async (mode) => {
    const f = await connected()
    f.supervisor.ready.mockResolvedValue(false)
    f.controller.start(f.options)
    await f.controller.ready!()
    expect(await f.controller.catalogue()).toMatchObject([
      { installed: true, state: 'Unavailable' },
    ])
    if (mode === 'partial') {
      fs.writeFileSync(stateFile(join(f.owner.root, 'state'))!, '{"format":2')
    } else {
      vi.mocked(asyncFs.readFile).mockImplementationOnce(async () => {
        throw Object.assign(new Error('fictional unreadable state'), { code: 'EACCES' })
      })
    }
    expect(await f.controller.catalogue()).toMatchObject([
      { installed: null, state: 'Unavailable' },
    ])
    const at = f.opens()
    readPluginInstructions(f.controller)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(f.opens()).toBe(at)
  },
)
