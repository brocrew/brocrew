import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertOwnedPathsAreReal,
  contentAt,
  copyDurably,
  nodeFs,
  OwnedPathIsALink,
  pathExists,
  privateDir,
  readTextOrNull,
  RETRY_DELAYS_MS,
  retrying,
  sha256Of,
  syncFolder,
  writeAtomically,
  writeJsonAtomically,
  type RecoveryFs,
} from '../../src/main/recovery/files'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function aFolder(): string {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-recovery-files-'))
  roots.push(root)
  return root
}

function coded(code: string): Error {
  return Object.assign(new Error(`${code}: made up by the test`), { code })
}

const POSIX = process.platform !== 'win32'

describe('writeJsonAtomically', () => {
  it('writes the value whole, private to this user, and leaves no temporary file', async () => {
    const folder = aFolder()
    const file = join(folder, 'manifest.json')
    await writeJsonAtomically(file, { format: 'x', version: 1 })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ format: 'x', version: 1 })
    expect(readFileSync(file, 'utf8').endsWith('}\n')).toBe(true)
    expect(readdirSync(folder)).toEqual(['manifest.json'])
    if (POSIX) expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('replaces a file that is already there', async () => {
    const folder = aFolder()
    const file = join(folder, 'journal.json')
    writeFileSync(file, '{"step":"staged"}\n')
    await writeJsonAtomically(file, { step: 'installed' })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ step: 'installed' })
    expect(readdirSync(folder)).toEqual(['journal.json'])
  })

  it('leaves the old file as it was, and no temporary file, when the write fails', async () => {
    const folder = aFolder()
    const file = join(folder, 'journal.json')
    writeFileSync(file, 'the old record\n')
    const full: RecoveryFs = {
      ...nodeFs,
      open: async (path, flags, mode) => {
        const handle = await nodeFs.open(path, flags, mode)
        return {
          ...handle,
          writeFile: async (data) => {
            await handle.writeFile(typeof data === 'string' ? data.slice(0, 3) : data)
            throw coded('ENOSPC')
          },
        }
      },
    }
    await expect(writeJsonAtomically(file, { step: 'installed' }, full)).rejects.toThrow('ENOSPC')
    expect(readFileSync(file, 'utf8')).toBe('the old record\n')
    expect(readdirSync(folder)).toEqual(['journal.json'])
  })

  it('leaves the old file as it was, and no temporary file, when the rename fails', async () => {
    const folder = aFolder()
    const file = join(folder, 'journal.json')
    writeFileSync(file, 'the old record\n')
    const refusing: RecoveryFs = {
      ...nodeFs,
      rename: () => Promise.reject(coded('EXDEV')),
    }
    await expect(writeJsonAtomically(file, { step: 'installed' }, refusing)).rejects.toThrow(
      'EXDEV',
    )
    expect(readFileSync(file, 'utf8')).toBe('the old record\n')
    expect(readdirSync(folder)).toEqual(['journal.json'])
  })

  it('renames through a file held briefly by another program', async () => {
    const folder = aFolder()
    const file = join(folder, 'gate.json')
    let refusals = 2
    const held: RecoveryFs = {
      ...nodeFs,
      rename: (from, to) =>
        refusals-- > 0 ? Promise.reject(coded('EBUSY')) : nodeFs.rename(from, to),
    }
    await writeJsonAtomically(file, { ok: true }, held)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ ok: true })
    expect(readdirSync(folder)).toEqual(['gate.json'])
  })
})

describe('retrying', () => {
  it('gives up after its bound, about ten tries over about two seconds, and throws the last error', async () => {
    const waits: number[] = []
    let calls = 0
    const always = (): Promise<never> => {
      calls += 1
      return Promise.reject(coded('EBUSY'))
    }
    await expect(
      retrying(always, { sleep: (ms) => (waits.push(ms), Promise.resolve()) }),
    ).rejects.toThrow('EBUSY')
    expect(calls).toBe(RETRY_DELAYS_MS.length + 1)
    expect(calls).toBe(10)
    expect(waits).toEqual(RETRY_DELAYS_MS)
    const total = waits.reduce((sum, ms) => sum + ms, 0)
    expect(total).toBeGreaterThanOrEqual(1500)
    expect(total).toBeLessThanOrEqual(2500)
  })

  it('retries EBUSY, EPERM and EACCES, and returns the first success', async () => {
    const codes = ['EBUSY', 'EPERM', 'EACCES']
    let calls = 0
    const value = await retrying(
      () => {
        const code = codes[calls++]
        return code === undefined ? Promise.resolve('done') : Promise.reject(coded(code))
      },
      { sleep: () => Promise.resolve() },
    )
    expect(value).toBe('done')
    expect(calls).toBe(4)
  })

  it('throws any other failure at once', async () => {
    let calls = 0
    await expect(
      retrying(
        () => {
          calls += 1
          return Promise.reject(coded('ENOSPC'))
        },
        { sleep: () => Promise.resolve() },
      ),
    ).rejects.toThrow('ENOSPC')
    expect(calls).toBe(1)
  })
})

describe('privateDir', () => {
  it.skipIf(!POSIX)(
    'makes the folder and its missing parents readable by this user only',
    async () => {
      const root = aFolder()
      const folder = join(root, 'backups', 'one')
      await privateDir(folder)
      expect(statSync(folder).mode & 0o777).toBe(0o700)
      expect(statSync(join(root, 'backups')).mode & 0o777).toBe(0o700)
      await privateDir(folder)
      expect(statSync(folder).isDirectory()).toBe(true)
    },
  )
})

/** Whether this system lets the test make a symbolic link to a folder. */
function canLink(): boolean {
  const root = aFolder()
  try {
    mkdirSync(join(root, 'target'))
    symlinkSync(join(root, 'target'), join(root, 'link'), 'junction')
    return true
  } catch {
    return false
  }
}

const LINKS = canLink()

/** Whether this system lets the test make a symbolic link to a file (Windows may need a right). */
function canLinkAFile(): boolean {
  const root = aFolder()
  try {
    writeFileSync(join(root, 'target'), 'x')
    symlinkSync(join(root, 'target'), join(root, 'link'))
    return true
  } catch {
    return false
  }
}

const FILE_LINKS = canLinkAFile()

describe('a link where a file is looked for', () => {
  it.skipIf(!FILE_LINKS)(
    'is something else to contentAt, never the file it points at, and is there even when its target is gone',
    async () => {
      const folder = aFolder()
      writeFileSync(join(folder, 'target'), 'the bytes')
      symlinkSync(join(folder, 'target'), join(folder, 'brobot2.sqlite'))
      expect(await contentAt(join(folder, 'brobot2.sqlite'))).toEqual({ kind: 'other' })
      rmSync(join(folder, 'target'))
      expect(await pathExists(join(folder, 'brobot2.sqlite'))).toBe(true)
      expect(await contentAt(join(folder, 'brobot2.sqlite'))).toEqual({ kind: 'other' })
    },
  )
})

/** A file system that records each open and what it was opened for, and each flush. */
function recording(): { fs: RecoveryFs; events: string[] } {
  const events: string[] = []
  const fs: RecoveryFs = {
    ...nodeFs,
    open: async (path, flags, mode) => {
      const handle = await nodeFs.open(path, flags, mode)
      events.push(`open ${flags} ${path}`)
      return {
        ...handle,
        sync: async () => {
          events.push(`sync ${path}`)
          await handle.sync()
        },
      }
    },
  }
  return { fs, events }
}

/** A file system whose folder flushes fail with `code`. */
function folderFlushFails(code: string): RecoveryFs {
  return {
    ...nodeFs,
    open: async (path, flags, mode) => {
      const handle = await nodeFs.open(path, flags, mode)
      if (!statSync(path).isDirectory()) return handle
      return { ...handle, sync: () => Promise.reject(coded(code)) }
    },
  }
}

// A folder can be opened and flushed only off Windows, so these use the file system as it is there.
describe.skipIf(!POSIX)('a folder flush that fails', () => {
  it.each(['darwin', 'linux'] as const)(
    'is thrown from writeAtomically on %s after the rename',
    async (platform) => {
      const folder = aFolder()
      const file = join(folder, 'restore-journal.json')
      await expect(
        writeAtomically(file, '{"step":"planned"}\n', folderFlushFails('EIO'), platform),
      ).rejects.toThrow('EIO')
      // The new record is in place, but the caller was told it may not count on it.
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ step: 'planned' })
      expect(readdirSync(folder)).toEqual(['restore-journal.json'])
    },
  )

  it('is thrown from writeJsonAtomically and copyDurably too', async () => {
    const folder = aFolder()
    await expect(
      writeJsonAtomically(join(folder, 'gate.json'), { a: 1 }, folderFlushFails('EIO')),
    ).rejects.toThrow('EIO')
    writeFileSync(join(folder, 'a'), 'bytes')
    await expect(
      copyDurably(join(folder, 'a'), join(folder, 'b'), folderFlushFails('EIO')),
    ).rejects.toThrow('EIO')
  })

  it('flushes a folder that can be flushed', async () => {
    const folder = aFolder()
    const { fs, events } = recording()
    await syncFolder(folder, fs)
    expect(events).toEqual([`open r ${folder}`, `sync ${folder}`])
  })
})

describe('on Windows, which cannot flush a folder', () => {
  it('opens no folder to flush it', async () => {
    const { fs, events } = recording()
    await syncFolder(aFolder(), fs, 'win32')
    expect(events).toEqual([])
  })

  it('flushes a record again under its new name, through a handle that may write', async () => {
    const folder = aFolder()
    const file = join(folder, 'restore-journal.json')
    const { fs, events } = recording()
    await writeAtomically(file, '{"step":"planned"}\n', fs, 'win32')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ step: 'planned' })
    const temporary = events[0]?.slice('open wx '.length) ?? ''
    expect(temporary.startsWith(`${file}.`) && temporary.endsWith('.tmp')).toBe(true)
    expect(events).toEqual([
      `open wx ${temporary}`,
      `sync ${temporary}`,
      `open r+ ${file}`,
      `sync ${file}`,
    ])
  })
})

describe('copyDurably', () => {
  it('copies the bytes privately, flushes the copy through a handle that may write, then its folder', async () => {
    const folder = aFolder()
    const from = join(folder, 'database.sqlite')
    const to = join(folder, 'staged.sqlite')
    writeFileSync(from, Buffer.alloc(70_000, 3))
    const { fs, events } = recording()
    await copyDurably(from, to, fs)
    expect(readFileSync(to)).toEqual(readFileSync(from))
    // On Windows the copy's own flush puts its name on disk; there is no folder to flush.
    expect(events).toEqual(
      POSIX
        ? [`open r+ ${to}`, `sync ${to}`, `open r ${folder}`, `sync ${folder}`]
        : [`open r+ ${to}`, `sync ${to}`],
    )
    if (POSIX) expect(statSync(to).mode & 0o777).toBe(0o600)
  })

  it('never replaces a file already there', async () => {
    const folder = aFolder()
    writeFileSync(join(folder, 'a'), 'new')
    writeFileSync(join(folder, 'b'), 'kept')
    await expect(copyDurably(join(folder, 'a'), join(folder, 'b'))).rejects.toThrow('EEXIST')
    expect(readFileSync(join(folder, 'b'), 'utf8')).toBe('kept')
  })
})

describe('readTextOrNull', () => {
  it('is null for no file, tries a briefly held file again, and throws anything else', async () => {
    const folder = aFolder()
    const file = join(folder, 'history-only.json')
    expect(await readTextOrNull(file)).toBeNull()
    writeFileSync(file, 'the record')
    let refusals = 2
    const held: RecoveryFs = {
      ...nodeFs,
      readFile: (path) => (refusals-- > 0 ? Promise.reject(coded('EBUSY')) : nodeFs.readFile(path)),
    }
    expect(await readTextOrNull(file, held, { sleep: () => Promise.resolve() })).toBe('the record')
    const broken: RecoveryFs = { ...nodeFs, readFile: () => Promise.reject(coded('EIO')) }
    await expect(readTextOrNull(file, broken)).rejects.toThrow('EIO')
  })
})

describe('sha256Of and contentAt', () => {
  it('hashes a file larger than one read whole', async () => {
    const file = join(aFolder(), 'big.bin')
    const bytes = Buffer.alloc(2.5 * 1024 * 1024)
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 31) % 251
    writeFileSync(file, bytes)
    expect(await sha256Of(file)).toBe(createHash('sha256').update(bytes).digest('hex'))
  })

  it('says what is at a path: nothing, a file by its full hash, or something else', async () => {
    const folder = aFolder()
    expect(await contentAt(join(folder, 'none'))).toEqual({ kind: 'absent' })
    expect(await contentAt(folder)).toEqual({ kind: 'other' })
    const file = join(folder, 'brobot2.sqlite')
    const bytes = Buffer.alloc(200_000, 1)
    writeFileSync(file, bytes)
    const before = await contentAt(file)
    expect(before).toEqual({
      kind: 'file',
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
    // Only the last byte differs: the same size and the same first bytes.
    bytes[bytes.length - 1] = 2
    writeFileSync(file, bytes)
    expect(await contentAt(file)).not.toEqual(before)
  })
})

describe('assertOwnedPathsAreReal and privateDir', () => {
  it('pass real folders and paths not made yet, and refuse paths outside the data folder', async () => {
    const userData = aFolder()
    mkdirSync(join(userData, 'recovery', 'staged'), { recursive: true })
    await assertOwnedPathsAreReal(userData, [
      join(userData, 'recovery', 'staged', 'x', 'database.sqlite'),
      join(userData, 'brobot2.sqlite'),
    ])
    await expect(assertOwnedPathsAreReal(userData, [join(tmpdir(), 'elsewhere')])).rejects.toThrow(
      'not inside the data folder',
    )
  })

  it
    .skipIf(!LINKS)
    .each([
      ['backups'],
      ['recovery'],
      ['recovery/staged'],
      ['recovery/preserved'],
      ['recovery/scratch'],
      ['recovery/preserved/9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d'],
    ])('refuse %s when it is a link, and change nothing behind it', async (owned) => {
    const userData = aFolder()
    const elsewhere = aFolder()
    if (POSIX) chmodSync(elsewhere, 0o755)
    writeFileSync(join(elsewhere, 'kept.txt'), 'not BroBot’s')
    const parts = owned.split('/')
    mkdirSync(join(userData, ...parts.slice(0, -1)), { recursive: true })
    symlinkSync(elsewhere, join(userData, ...parts), 'junction')
    const inside = join(userData, ...parts, 'database.sqlite')
    const refused = await assertOwnedPathsAreReal(userData, [inside]).catch(
      (error: unknown) => error,
    )
    expect(refused).toBeInstanceOf(OwnedPathIsALink)
    expect((refused as OwnedPathIsALink).path).toBe(join(userData, ...parts))
    await expect(privateDir(join(userData, ...parts))).rejects.toBeInstanceOf(OwnedPathIsALink)
    expect(readdirSync(elsewhere)).toEqual(['kept.txt'])
    if (POSIX) expect(statSync(elsewhere).mode & 0o777).toBe(0o755)
  })

  it.skipIf(!LINKS)(
    'privateDir refuses a link where its folder should be, and leaves its target’s mode',
    async () => {
      const root = aFolder()
      const elsewhere = aFolder()
      // A folder others may read, to show the link's target is never made private.
      if (POSIX) chmodSync(elsewhere, 0o755)
      symlinkSync(elsewhere, join(root, 'backups'), 'junction')
      await expect(privateDir(join(root, 'backups'))).rejects.toBeInstanceOf(OwnedPathIsALink)
      if (POSIX) expect(statSync(elsewhere).mode & 0o777).toBe(0o755)
      expect(existsSync(join(root, 'backups'))).toBe(true)
    },
  )
})
