import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { PROVIDER_DESCRIPTORS, SUPPORTED_PROVIDERS, type ProviderDescriptor } from '@brobot2/shared'

const descriptors = PROVIDER_DESCRIPTORS as unknown as ProviderDescriptor[]
const ids = SUPPORTED_PROVIDERS as unknown as string[]
const descriptorCount = descriptors.length
const idCount = ids.length
let protocol: typeof import('../src/main/db/limits-read-protocol')
let usage: typeof import('../src/main/provider-usage-file')

beforeAll(async () => {
  // Add the fixture before loading consumers. The shared tests check the enum validator itself.
  descriptors.push({
    ...PROVIDER_DESCRIPTORS[0],
    id: 'probe',
    defaults: { conversation: false, identity: false },
  })
  ids.push('probe')
  protocol = await import('../src/main/db/limits-read-protocol')
  usage = await import('../src/main/provider-usage-file')
})

afterAll(() => {
  descriptors.splice(descriptorCount)
  ids.splice(idCount)
})

const reading = { window: 'weekly', usedPercent: 20, resetsAt: null, at: 95 }

it('builds optional strict usage fields for every registered descriptor', () => {
  const input = {
    operation: 1,
    databaseEpoch: 1,
    signInEpoch: 1,
    capturedAt: 100,
    signInChangedAt: { probe: 90 },
    usage: { probe: [reading] },
  }
  expect(protocol.limitsReadInput.safeParse(input).success).toBe(true)
  expect(
    protocol.limitsReadInput.safeParse({ ...input, signInChangedAt: {}, usage: {} }).success,
  ).toBe(true)
  expect(protocol.limitsReadInput.safeParse({ ...input, usage: { unknown: [] } }).success).toBe(
    false,
  )
})

it('gives a newly registered provider its own persisted usage arrays and reads its rows', () => {
  const { NO_USAGE_KEPT, readKeptUsage } = usage
  expect(Object.keys(NO_USAGE_KEPT.readings)).toEqual(ids)
  expect(Reflect.get(NO_USAGE_KEPT.readings, 'probe')).toEqual([])
  expect(Reflect.get(NO_USAGE_KEPT.readings, 'probe')).not.toBe(NO_USAGE_KEPT.readings.claude)
  const directory = mkdtempSync(join(tmpdir(), 'registry-collections-'))
  try {
    const file = join(directory, 'usage.json')
    writeFileSync(file, JSON.stringify({ readings: { probe: [reading] } }))
    expect(Reflect.get(readKeptUsage(file).readings, 'probe')).toEqual([reading])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
