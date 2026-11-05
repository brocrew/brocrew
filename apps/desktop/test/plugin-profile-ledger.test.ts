import { afterEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import {
  cleanupRetirementSubjects,
  legacyImportSubject,
  replaceHistoricalInput,
} from './plugin-retirement-subjects'
afterEach(cleanupRetirementSubjects)

it.each(['chrome', 'whatsapp'] as const)(
  'imports a durable %s reservation before any current action and leaves old bytes intact',
  async (plugin) => {
    const f = await legacyImportSubject(plugin),
      before = await f.inventory()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('No old domain I/O')
      }),
    )
    f.import()
    expect(await f.consumed()).toBe(1)
    expect(await f.inventory()).toEqual(before)
    expect(fetch).not.toHaveBeenCalled()
  },
)
it.each(['chrome', 'whatsapp'] as const)(
  'consumes an old Open reservation without launching or replaying it for %s',
  async (plugin) => {
    const f = await legacyImportSubject(plugin)
    await writeFile(
      join(f.directory, 'intents', '00000002.json'),
      JSON.stringify({ action: 'open-window', profile: 'DO-NOT-REPLAY' }),
    )
    const before = await f.inventory()
    f.import()
    expect(await f.consumed()).toBe(2)
    expect(await readFile(f.marker, 'utf8')).not.toContain('DO-NOT-REPLAY')
    f.import()
    expect(await f.inventory()).toEqual(before)
  },
)
it.each(['chrome', 'whatsapp'] as const)(
  'reopens consumed %s input without replaying enabled flags or changing account data',
  async (plugin) => {
    const f = await legacyImportSubject(plugin),
      before = await f.inventory()
    f.import()
    const marker = await readFile(f.marker)
    for (let press = 0; press < 3; press++) f.import()
    expect(await readFile(f.marker)).toEqual(marker)
    expect(await f.inventory()).toEqual(before)
  },
)
it.each(['chrome', 'whatsapp'] as const)(
  'concurrent startup imports publish one stable consumed boundary for %s',
  async (plugin) => {
    const f = await legacyImportSubject(plugin),
      before = await f.inventory()
    await Promise.all([Promise.resolve().then(f.import), Promise.resolve().then(f.import)])
    expect(await f.consumed()).toBe(1)
    expect(await f.inventory()).toEqual(before)
    expect((await readdir(f.home)).filter((name) => name.startsWith('.legacy'))).toEqual([])
  },
)
it.each(['chrome', 'whatsapp'] as const)(
  'does not replay an ambiguous old command after marker publication and reopen for %s',
  async (plugin) => {
    const f = await legacyImportSubject(plugin)
    await writeFile(
      join(f.directory, 'intents', '00000002.json'),
      'ambiguous old DELETE command bytes',
    )
    f.import()
    const marker = await readFile(f.marker),
      before = await f.inventory()
    f.import()
    expect(await f.consumed()).toBe(2)
    expect(await readFile(f.marker)).toEqual(marker)
    expect(await f.inventory()).toEqual(before)
  },
)
it.each(['chrome', 'whatsapp'] as const)(
  'keeps the consumed floor when old command tails are missing for %s',
  async (plugin) => {
    const f = await legacyImportSubject(plugin)
    await replaceHistoricalInput(f.floor, '99')
    await rm(join(f.directory, 'intents'), { recursive: true })
    const before = await f.inventory()
    f.import()
    expect(await f.consumed()).toBe(99)
    expect(await f.inventory()).toEqual(before)
    // Old history proof is intentionally retired: command bodies are not replay inputs.
  },
)
it.each(['chrome', 'whatsapp'] as const)(
  'ignores unpublished crash stages and never resets a consumed marker for %s',
  async (plugin) => {
    const f = await legacyImportSubject(plugin)
    await writeFile(join(f.directory, 'intents', '.new-00000099'), 'unpublished command')
    const before = await f.inventory()
    f.import()
    expect(await f.consumed()).toBe(1)
    await rm(join(f.directory, 'intents'), { recursive: true })
    f.import()
    expect(await f.consumed()).toBe(1)
    expect(await readFile(f.data)).toEqual(Buffer.from([0, 255, 17, 10]))
    expect(Object.keys(before).some((name) => name.includes('.new-00000099'))).toBe(true)
  },
)
it('old app profile methods are absent and a person-channel Apply is not agent authority', async () => {
  const { Command } = await import('../src/main/plugins/supervisor/protocol')
  expect(
    Command.safeParse({
      kind: 'apply',
      pluginId: 'chrome',
      revision: 0,
      proposal: { action: 'create-profile', profile: 'fern' },
    }).success,
  ).toBe(false)
  const { PluginLifecycleController } = await import('../src/main/plugins/lifecycle/controller')
  expect(PluginLifecycleController.prototype).not.toHaveProperty('applyProfile')
  expect(PluginLifecycleController.prototype).not.toHaveProperty('profileRevision')
})
it.each(['chrome', 'whatsapp'] as const)(
  'uses immutable source identity when reopening a consumed package input for %s',
  async (plugin) => {
    const f = await legacyImportSubject(plugin),
      before = await f.inventory()
    f.import()
    const value = JSON.parse(await readFile(f.marker, 'utf8'))
    expect(value.source).toEqual(f.input)
    expect(value.installId).toBe(f.installId)
    expect(await f.inventory()).toEqual(before)
  },
)
