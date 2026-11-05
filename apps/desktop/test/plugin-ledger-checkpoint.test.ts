import { afterEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { readdir, rm, writeFile } from 'node:fs/promises'
import fs from 'node:fs'
import {
  cleanupRetirementSubjects,
  legacyImportSubject,
  replaceHistoricalInput,
} from './plugin-retirement-subjects'
afterEach(cleanupRetirementSubjects)

it.each([
  'before-checkpoint',
  'after-checkpoint',
  'before-tail-delete',
  'after-tail-delete',
] as const)(
  'imports old consumption after %s without replay, reset or compaction of old bytes',
  async (point) => {
    for (const plugin of ['chrome', 'whatsapp'] as const) {
      const f = await legacyImportSubject(plugin)
      const boundary = JSON.stringify({
        format: 2,
        installId: f.installId,
        revision: 64,
        previous: 'a'.repeat(64),
      })
      await replaceHistoricalInput(f.floor, boundary)
      if (point !== 'before-checkpoint')
        await writeFile(join(f.directory, 'checkpoint.json'), boundary)
      if (point === 'after-tail-delete') await rm(join(f.directory, 'intents'), { recursive: true })
      const before = await f.inventory()
      f.import()
      expect(await f.consumed()).toBe(64)
      f.import()
      expect(await f.inventory()).toEqual(before)
    }
  },
)
it.each(['chrome', 'whatsapp'] as const)(
  'imports a full old lifetime floor for %s without an app negotiation or ceiling',
  async (plugin) => {
    const f = await legacyImportSubject(plugin)
    await replaceHistoricalInput(f.floor, '4096')
    await writeFile(join(f.directory, 'intents', '0000000000004097.json'), 'opaque command')
    const before = await f.inventory()
    f.import()
    expect(await f.consumed()).toBe(4097)
    expect(await f.inventory()).toEqual(before)
  },
)
it.each(['chrome', 'whatsapp'] as const)(
  'keeps %s consumption available beyond the old 4100-press ceiling without replay',
  async (plugin) => {
    const f = await legacyImportSubject(plugin)
    await replaceHistoricalInput(f.floor, '4102')
    const before = await f.inventory()
    f.import()
    expect(await f.consumed()).toBe(4102)
    for (let read = 0; read < 3; read++) f.import()
    expect(await f.inventory()).toEqual(before)
  },
)
it.each(['chrome', 'whatsapp'] as const)(
  'recovers interruption on either side of current %s marker publication atomically',
  async (plugin) => {
    for (const point of ['before', 'after'] as const) {
      const f = await legacyImportSubject(plugin),
        before = await f.inventory(),
        rename = fs.renameSync
      vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
        if (String(destination) !== f.marker) return rename(source, destination)
        if (point === 'after') rename(source, destination)
        throw new Error('fictional import publication interruption')
      })
      expect(f.import).toThrow('fictional import publication interruption')
      vi.restoreAllMocks()
      f.import()
      expect(await f.consumed()).toBe(1)
      expect(await f.inventory()).toEqual(before)
      expect((await readdir(f.home)).filter((name) => name.startsWith('.legacy'))).toEqual([])
    }
  },
)
