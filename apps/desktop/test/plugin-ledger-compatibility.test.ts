import { afterEach, expect, it } from 'vitest'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import {
  cleanupRetirementSubjects,
  legacyImportSubject,
  replaceHistoricalInput,
} from './plugin-retirement-subjects'
afterEach(cleanupRetirementSubjects)

it.each(['chrome', 'whatsapp'] as const)(
  'imports numeric and compacted old boundaries above four digits for %s',
  async (plugin) => {
    const f = await legacyImportSubject(plugin)
    await replaceHistoricalInput(
      f.floor,
      JSON.stringify({
        format: 2,
        installId: f.installId,
        revision: 10000,
        previous: 'a'.repeat(64),
      }),
    )
    await writeFile(
      join(f.directory, 'checkpoint.json'),
      JSON.stringify({
        format: 2,
        installId: f.installId,
        revision: 9999,
        previous: 'b'.repeat(64),
      }),
    )
    const before = await f.inventory()
    f.import()
    expect(await f.consumed()).toBe(10000)
    expect(await f.inventory()).toEqual(before)
  },
)
it.each(['chrome', 'whatsapp'] as const)(
  'retains the maximum consumed boundary despite historical digest disagreement for %s',
  async (plugin) => {
    const f = await legacyImportSubject(plugin)
    await replaceHistoricalInput(
      f.floor,
      JSON.stringify({
        format: 2,
        installId: f.installId,
        revision: 10000,
        previous: 'a'.repeat(64),
      }),
    )
    await writeFile(
      join(f.directory, 'checkpoint.json'),
      JSON.stringify({
        format: 2,
        installId: f.installId,
        revision: 10000,
        previous: 'b'.repeat(64),
      }),
    )
    const before = await f.inventory()
    f.import()
    expect(await f.consumed()).toBe(10000)
    expect(await f.inventory()).toEqual(before)
  },
)
it.each(['chrome', 'whatsapp'] as const)(
  'refuses malformed consumption metadata for %s without a marker, data reset or old-byte changes',
  async (plugin) => {
    for (const malformed of [
      '{broken',
      JSON.stringify({
        format: 2,
        installId: 'other-install',
        revision: 1,
        previous: 'a'.repeat(64),
      }),
      JSON.stringify({ format: 2, installId: '', revision: 1, previous: 'a'.repeat(64) }),
    ]) {
      const f = await legacyImportSubject(plugin)
      await replaceHistoricalInput(f.floor, malformed)
      const before = await f.inventory()
      expect(f.import).toThrow()
      await expect(readFile(f.marker)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await f.inventory()).toEqual(before)
    }
  },
)
it.each(['chrome', 'whatsapp'] as const)(
  'refuses overflowing %s boundary metadata without consuming or deleting input',
  async (plugin) => {
    const f = await legacyImportSubject(plugin)
    await replaceHistoricalInput(f.floor, String(Number.MAX_SAFE_INTEGER + 1))
    const before = await f.inventory()
    expect(f.import).toThrow()
    await expect(readFile(f.marker)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await f.inventory()).toEqual(before)
  },
)
it.each(['chrome', 'whatsapp'] as const)(
  'keeps consumed install/source identity on reopen for %s instead of negotiating old app methods',
  async (plugin) => {
    const f = await legacyImportSubject(plugin)
    f.import()
    const before = await readFile(f.marker),
      metadata = JSON.parse(before.toString())
    expect(metadata.source).toEqual(f.input)
    expect(metadata.installId).toBe(f.installId)
    f.import()
    expect(await readFile(f.marker)).toEqual(before)
  },
)
it.each(['chrome', 'whatsapp'] as const)(
  'consumes corrupt published command bytes and ignores old negotiation for %s',
  async (plugin) => {
    const f = await legacyImportSubject(plugin)
    await writeFile(
      join(f.directory, 'intents', '0000000000009001.json'),
      'corrupt command body must never be interpreted',
    )
    const before = await f.inventory()
    f.import()
    expect(await f.consumed()).toBe(9001)
    expect(await f.inventory()).toEqual(before)
    expect(await readFile(f.marker, 'utf8')).not.toContain('command body')
  },
)
