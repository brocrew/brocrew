import { randomUUID } from 'node:crypto'
import { link, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
const adviceIo = vi.hoisted(() => ({ fileSync: false, directorySync: false }))
vi.mock('../src/main/plugins/private-files', async () => {
  const files = await vi.importActual<typeof import('../src/main/plugins/private-files')>(
    '../src/main/plugins/private-files',
  )
  return {
    ...files,
    createFileNotThroughALink: async (
      ...args: Parameters<typeof files.createFileNotThroughALink>
    ) => {
      const file = await files.createFileNotThroughALink(...args)
      if (adviceIo.fileSync) {
        adviceIo.fileSync = false
        file.sync = async () => {
          throw new Error('fictional file sync failure')
        }
      }
      return file
    },
    syncDirectoryAt: async (...args: Parameters<typeof files.syncDirectoryAt>) => {
      if (adviceIo.directorySync) {
        adviceIo.directorySync = false
        throw new Error('fictional directory sync failure')
      }
      return files.syncDirectoryAt(...args)
    },
  }
})
import { privateChild } from '../src/main/plugins/node-host-files'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import { OWNER_WIRE, secret, type OwnerRecord } from '../src/main/plugins/supervisor/protocol'
import {
  readRecoveryAdvice,
  writeRecoveryAdvice,
} from '../src/main/plugins/supervisor/recovery-advice'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const parent = await realpath(
    await mkdtemp(
      join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-owner-advice-'),
    ),
  )
  roots.push(parent)
  const root = join(parent, 'plugins')

  const storage = new SupervisorStorage(root, [], true)
  const record: OwnerRecord = {
    version: 1,
    epoch: randomUUID(),
    key: secret(),
    phase: 'blocked',
    wire: OWNER_WIRE,
  }
  storage.write(record)
  const directory = await privateChild(root, `supervisor-launches/${randomUUID()}`)
  return { root, parent, directory, storage, record, path: join(directory, 'recovery-advice.json') }
}
it('retains only this launch and epoch advice, without copying owner capabilities', async () => {
  const f = await fixture()
  try {
    expect(await writeRecoveryAdvice(f.root, f.directory, f.record)).toBe(true)
    const error = await readRecoveryAdvice(f.root, f.directory, () => f.storage.read())
    expect(error).toMatchObject({
      code: 'cleanup-pending',
      ownerEpoch: f.record.epoch,
      diagnostic: { phase: 'blocked', stage: 'recovery', reason: 'restart-required' },
    })
    expect(await readFile(f.path, 'utf8')).not.toContain(f.record.key)
    expect(f.storage.read()).toEqual(f.record)
    f.storage.write({ ...f.record, epoch: randomUUID() })
    expect(await readRecoveryAdvice(f.root, f.directory, () => f.storage.read())).toBeUndefined()
    f.storage.write({ ...f.record, phase: 'accepting' })
    expect(await readRecoveryAdvice(f.root, f.directory, () => f.storage.read())).toBeUndefined()
    f.storage.write({ ...f.record, phase: 'draining' })
    expect(await readRecoveryAdvice(f.root, f.directory, () => f.storage.read())).toBeUndefined()
  } finally {
    f.storage.close()
  }
})
it('rejects another launch and an advice receipt copied from that launch', async () => {
  const f = await fixture()
  try {
    await writeRecoveryAdvice(f.root, f.directory, f.record)
    const other = await privateChild(f.root, `supervisor-launches/${randomUUID()}`)
    expect(await readRecoveryAdvice(f.root, other, () => f.storage.read())).toBeUndefined()
    await writeFile(join(other, 'recovery-advice.json'), await readFile(f.path), { mode: 0o600 })
    expect(await readRecoveryAdvice(f.root, other, () => f.storage.read())).toBeUndefined()
    expect(await readRecoveryAdvice(f.root, f.parent, () => f.storage.read())).toBeUndefined()
  } finally {
    f.storage.close()
  }
})
it.each([
  ['empty', '{}'],
  ['oversized', 'x'.repeat(4097)],
  ['partial', '{"format":1}'],
])('rejects %s advice', async (_kind, bytes) => {
  const f = await fixture()
  try {
    await writeFile(f.path, bytes, { mode: 0o600 })
    expect(await readRecoveryAdvice(f.root, f.directory, () => f.storage.read())).toBeUndefined()
    expect(await writeRecoveryAdvice(f.root, f.directory, f.record)).toBe(false)
    expect(await readFile(f.path, 'utf8')).toBe(bytes)
  } finally {
    f.storage.close()
  }
})
it('rejects a hardlinked advice receipt', async () => {
  const f = await fixture()
  try {
    await writeRecoveryAdvice(f.root, f.directory, f.record)
    await link(f.path, join(f.parent, 'advice-alias'))
    expect(await readRecoveryAdvice(f.root, f.directory, () => f.storage.read())).toBeUndefined()
  } finally {
    f.storage.close()
  }
})
it.skipIf(process.platform === 'win32')(
  'never follows a receipt symlink or overwrites its target',
  async () => {
    const f = await fixture()
    try {
      const target = join(f.parent, 'sentinel')
      await writeFile(target, 'fictional-sentinel', { mode: 0o600 })
      await symlink(target, f.path)
      expect(await readRecoveryAdvice(f.root, f.directory, () => f.storage.read())).toBeUndefined()
      expect(await writeRecoveryAdvice(f.root, f.directory, f.record)).toBe(false)
      expect(await readFile(target, 'utf8')).toBe('fictional-sentinel')
    } finally {
      f.storage.close()
    }
  },
)
it('loses advice on a protected-record read failure and refuses accepting advice publication', async () => {
  const f = await fixture()
  try {
    expect(
      await writeRecoveryAdvice(f.root, f.directory, { ...f.record, phase: 'accepting' }),
    ).toBe(false)
    expect(await writeRecoveryAdvice(f.root, f.directory, f.record)).toBe(true)
    expect(
      await readRecoveryAdvice(f.root, f.directory, () => {
        throw new Error('fictional IO failure')
      }),
    ).toBeUndefined()
    expect(f.storage.read()).toEqual(f.record)
  } finally {
    f.storage.close()
  }
})
it.each(['fileSync', 'directorySync'] as const)(
  'loses advice after %s failure and can retry without changing owner state',
  async (failure) => {
    const f = await fixture()
    try {
      adviceIo[failure] = true
      expect(await writeRecoveryAdvice(f.root, f.directory, f.record)).toBe(false)
      expect(await readRecoveryAdvice(f.root, f.directory, () => f.storage.read())).toBeUndefined()
      expect(await writeRecoveryAdvice(f.root, f.directory, f.record)).toBe(true)
      expect(f.storage.read()).toEqual(f.record)
    } finally {
      adviceIo[failure] = false
      f.storage.close()
    }
  },
)
