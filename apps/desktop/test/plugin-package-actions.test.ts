import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { registerPluginSettings, type PluginSettingsController } from '../src/main/plugins/settings'
import { pluginsBridge } from '../src/preload/plugins'
import {
  PLUGIN_SETTINGS_CHANNEL,
  PluginReleaseDetailsSchema,
  type PluginCard,
} from '../src/shared/plugin-settings'

vi.mock('../src/main/plugins/ui/host', () => ({ openPluginConfigurationView: vi.fn() }))
const ref = {
  source: 'http://127.0.0.1:43210/fictional-oven.tar.gz',
  sha256: 'a'.repeat(64),
  bytes: 5120,
}
function setup() {
  const owner = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    getContentBounds: () => ({ width: 1180, height: 900 }),
    webContents: Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn() }),
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  })
  const cards: PluginCard[] = [
    { id: 'fictional-oven', name: 'Fictional oven', installed: false, state: 'Available' },
  ]
  const inspection = {
    id: cards[0]!.id,
    name: cards[0]!.name,
    ref,
    manifest: { format: 3 },
    details: {
      version: '1.0.0',
      digest: ref.sha256,
      manifestSha256: 'b'.repeat(64),
      authors: ['Fictional Baker & Partners'],
      permissions: {
        description: 'Use fictional ovens.',
        dataUses: ['Oven preferences'],
        resources: [],
      },
    },
  }
  const controller: PluginSettingsController = {
    catalogue: vi.fn(async () => cards),
    inspectPackage: vi.fn(async () => inspection),
    applyPackage: vi.fn(async () => {
      cards[0] = { ...cards[0]!, installed: true, state: 'Installed' }
    }),
    selectCatalogue: vi.fn(async () => cards),
    install: vi.fn(async () => {}),
    uninstall: vi.fn(async () => {}),
    screen: vi.fn(),
  }
  const ipc = { handle: vi.fn() }
  registerPluginSettings(ipc, () => owner as never, controller)
  const event = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame }
  return {
    controller,
    cards,
    inspection,
    call: (input: unknown) => ipc.handle.mock.calls[0]![1](event, input),
  }
}
it('shows actual authors and permissions from a selected package, then uses ordinary install/update requests', async () => {
  const f = setup()
  const shown = await f.call({ kind: 'inspect', package: ref })
  expect(shown).toEqual({ ok: true, inspection: f.inspection })
  expect(f.controller.applyPackage).not.toHaveBeenCalled()
  expect(shown.inspection).not.toHaveProperty('consent')
  expect(await f.call({ kind: 'install', id: 'fictional-oven', package: ref })).toMatchObject({
    ok: true,
    cards: [{ installed: true }],
  })
  expect(f.controller.applyPackage).toHaveBeenCalledWith(ref, 'install')
  await f.call({ kind: 'update', id: 'fictional-oven', package: ref })
  expect(f.controller.applyPackage).toHaveBeenCalledWith(ref, 'update')
})
it('uses local or URL source selections through the real Settings and preload request protocol', async () => {
  const f = setup()
  const source = join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-selected.tar.gz')
  expect(await f.call({ kind: 'inspect', source })).toMatchObject({ ok: true })
  expect(f.controller.inspectPackage).toHaveBeenCalledWith({ source })
  await f.call({ kind: 'source', source: 'http://127.0.0.1:43210/list.json' })
  expect(f.controller.selectCatalogue).toHaveBeenCalledWith('http://127.0.0.1:43210/list.json')
  const ipc = { invoke: vi.fn(async () => ({ ok: true })), on: vi.fn(), off: vi.fn() }
  await pluginsBridge(ipc).request({ kind: 'install', id: 'fictional-oven', package: ref })
  expect(ipc.invoke).toHaveBeenCalledWith(PLUGIN_SETTINGS_CHANNEL, {
    kind: 'install',
    id: 'fictional-oven',
    package: ref,
  })
})
it('displays actual operation errors without manufacturing a source or publisher refusal', async () => {
  const f = setup()
  f.controller.applyPackage = async () => {
    throw new Error('Fictional runtime exited with code 7.')
  }
  expect(await f.call({ kind: 'update', id: 'fictional-oven', package: ref })).toMatchObject({
    ok: false,
    detail: 'Fictional runtime exited with code 7.',
  })
})

it('normal Settings accepts long card metadata and declared display resources without the former count or text caps', async () => {
  const f = setup()
  const resources = Array.from({ length: 140 }, (_, i) => ({
    id: '.fictional ressource café ' + i,
    label: 'Fictional resource ' + 'r'.repeat(200),
    read: true,
    write: false,
  }))
  const details = {
    ...f.inspection.details,
    permissions: { ...f.inspection.details.permissions, resources },
  }
  expect(PluginReleaseDetailsSchema.parse(details).permissions.resources).toEqual(resources)
  Object.assign(f.inspection.details, details)
  f.cards.splice(
    0,
    f.cards.length,
    ...Array.from({ length: 250 }, (_, i) => ({
      id: '.fictional café ' + i + 'p'.repeat(100),
      name: 'Fictional café ' + 'n'.repeat(1400),
      installed: true,
      state: 'Installed' as const,
      installedVersion: '.version café ' + 'v'.repeat(120),
    })),
  )
  const answer = await f.call({ kind: 'list' })
  expect(answer.ok).toBe(true)
  expect(answer.cards).toEqual(f.cards)
  expect(
    (await f.call({ kind: 'inspect', package: ref })).inspection.details.permissions.resources,
  ).toEqual(resources)
})

it.each([
  { state: 'Running' as const, toolsUnavailable: true as const },
  { state: 'Unavailable' as const },
])(
  'lists a non-Chrome negotiated restart card in state $state without refusing the whole list',
  async (health) => {
    const f = setup()
    f.cards[0] = {
      id: 'fictional-orchard',
      name: 'Fictional orchard',
      installed: true,
      canRestart: true,
      ...health,
    }
    expect(await f.call({ kind: 'list' })).toMatchObject({
      ok: true,
      cards: [{ id: 'fictional-orchard', canRestart: true }],
    })
  },
)
