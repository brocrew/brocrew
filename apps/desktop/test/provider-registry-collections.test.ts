import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { PROVIDER_DESCRIPTORS, SUPPORTED_PROVIDERS, type ProviderDescriptor } from '@brobot2/shared'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'

const descriptors = PROVIDER_DESCRIPTORS as unknown as ProviderDescriptor[]
const ids = SUPPORTED_PROVIDERS as unknown as string[]
const descriptorCount = descriptors.length
const idCount = ids.length
let usage: typeof import('../src/main/provider-usage-file')

beforeAll(async () => {
  // Add the fixture before loading consumers. The shared tests check the enum validator itself.
  descriptors.push({
    ...PROVIDER_DESCRIPTORS[0],
    id: 'probe',
    defaults: { conversation: false, identity: false },
  })
  ids.push('probe')
  usage = await import('../src/main/provider-usage-file')
})

afterAll(() => {
  descriptors.splice(descriptorCount)
  ids.splice(idCount)
})

const reading = { window: 'weekly', usedPercent: 20, resetsAt: null, at: 95 }

it('gives a newly registered provider its own persisted usage arrays and reads its rows', () => {
  const { NO_USAGE_KEPT, usageKeptIn } = usage
  expect(Object.keys(NO_USAGE_KEPT.readings)).toEqual(ids)
  expect(Reflect.get(NO_USAGE_KEPT.readings, 'probe')).toEqual([])
  expect(Reflect.get(NO_USAGE_KEPT.readings, 'probe')).not.toBe(NO_USAGE_KEPT.readings.claude)
  const directory = mkdtempSync(join(tmpdir(), 'registry-collections-'))
  const db = openDatabase(join(directory, 'brobot2.sqlite'))
  try {
    applyMigrations(db, join(__dirname, '../src/main/db/migrations'))
    const readings = { ...NO_USAGE_KEPT.readings, probe: [reading] }
    usageKeptIn(db).write({ ...NO_USAGE_KEPT, readings })
    expect(Reflect.get(usageKeptIn(db).read().readings, 'probe')).toEqual([reading])
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
