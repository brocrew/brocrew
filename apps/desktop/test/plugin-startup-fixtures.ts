import { vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { fixture } from './plugin-lifecycle-fixtures'

export function prepareFirst(f: Awaited<ReturnType<typeof fixture>>) {
  f.state.prepare({
    operationId: randomUUID(),
    snapshot: null,
    consent: {
      action: 'install',
      pluginId: 'chrome',
      at: 1000,
      expectedSequence: f.state.inspect().sequence,
      expectedInstallId: null,
      release: {
        version: '1.0.0',
        archiveSha256: 'a'.repeat(64),
        manifestSha256: 'b'.repeat(64),
        dataSchema: 1,
      },
    },
  })
}

vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>()
  const counted = {
    openSync: vi.fn(actual.openSync),
    lstatSync: vi.fn(actual.lstatSync),
    fstatSync: vi.fn(actual.fstatSync),
    readSync: vi.fn(actual.readSync),
    closeSync: vi.fn(actual.closeSync),
    readdirSync: vi.fn(actual.readdirSync),
    readFileSync: vi.fn(actual.readFileSync),
  }
  return { ...actual, ...counted, default: { ...actual, ...counted } }
})

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return {
    ...actual,
    open: vi.fn(actual.open),
    readdir: vi.fn(actual.readdir),
    readFile: vi.fn(actual.readFile),
  }
})
