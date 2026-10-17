import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { namesTheSameThing, recheckHandedPaths } from '../src/main/runtime/handed-path'

/**
 * A file a person attached is sent when what its path names now is what they chose. On Windows one
 * file has several spellings — its short name and any letter case — and every one of them is that
 * file. A path that now passes through a link or a junction is another thing, on every system.
 */

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

/** A scratch folder, spelled as the system's temp folder spells it. */
function aFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'brobot2-attached-'))
  folders.push(folder)
  return folder
}

/** What a fictional disk says of each path: its volume, its number there, and whether it is a link. */
type Entry = { readonly dev: bigint; readonly ino: bigint; readonly link?: boolean }

/** A look at a fictional disk, by path in any letter case; a path it does not hold cannot be read. */
function aDisk(entries: Readonly<Record<string, Entry>>) {
  const byPath = new Map(
    Object.entries(entries).map(([path, entry]) => [path.toLowerCase(), entry]),
  )
  return async (path: string) => {
    const entry = byPath.get(path.toLowerCase())
    if (entry === undefined)
      throw Object.assign(new Error('fictional: no such path'), { code: 'ENOENT' })
    return { dev: entry.dev, ino: entry.ino, isSymbolicLink: () => entry.link === true }
  }
}

/** One volume; a number past 2^53, as Windows gives them. */
const VOLUME = 0x2bd3_9a11n
const HIGH = 2n ** 60n

describe('whether an attached path still names what it resolves to', () => {
  const shortName = 'C:\\Users\\RUNNER~1\\work\\notes.md'
  const longName = 'C:\\Users\\runneradmin\\work\\notes.md'
  /** One file reached by its short and its long spelling: each folder is one object. */
  const oneFile = {
    'C:\\': { dev: VOLUME, ino: HIGH + 5n },
    'C:\\Users': { dev: VOLUME, ino: HIGH + 10n },
    'C:\\Users\\RUNNER~1': { dev: VOLUME, ino: HIGH + 20n },
    'C:\\Users\\runneradmin': { dev: VOLUME, ino: HIGH + 20n },
    'C:\\Users\\RUNNER~1\\work': { dev: VOLUME, ino: HIGH + 30n },
    'C:\\Users\\runneradmin\\work': { dev: VOLUME, ino: HIGH + 30n },
    'C:\\Users\\RUNNER~1\\work\\notes.md': { dev: VOLUME, ino: HIGH + 40n },
    'C:\\Users\\runneradmin\\work\\notes.md': { dev: VOLUME, ino: HIGH + 40n },
  }

  it('on Windows, a short name and a long one of the same file are the same thing', async () => {
    expect(await namesTheSameThing(shortName, longName, 'win32', aDisk(oneFile))).toBe(true)
  })

  it('on Windows, another letter case is the same thing', async () => {
    const otherCase = 'c:\\users\\RUNNERADMIN\\WORK\\Notes.MD'
    expect(await namesTheSameThing(otherCase, longName, 'win32', aDisk(oneFile))).toBe(true)
  })

  it('🔴 on Windows, a path resolved through a junction that is gone by the check is another thing', async () => {
    // Resolved while `slot` was a junction to the vault; looked at once it was a folder again. Same
    // depth, no link left on the way: only what each folder is tells the two apart.
    const attached = 'C:\\work\\slot\\notes.md'
    const resolved = 'C:\\private\\vault\\notes.md'
    const disk = aDisk({
      'C:\\': { dev: VOLUME, ino: HIGH + 5n },
      'C:\\work': { dev: VOLUME, ino: HIGH + 50n },
      'C:\\private': { dev: VOLUME, ino: HIGH + 60n },
      'C:\\work\\slot': { dev: VOLUME, ino: HIGH + 51n },
      'C:\\private\\vault': { dev: VOLUME, ino: HIGH + 61n },
      'C:\\work\\slot\\notes.md': { dev: VOLUME, ino: HIGH + 52n },
      'C:\\private\\vault\\notes.md': { dev: VOLUME, ino: HIGH + 62n },
    })
    expect(await namesTheSameThing(attached, resolved, 'win32', disk)).toBe(false)
  })

  it('🔴 on Windows, numbers that differ only past 2^53 are two objects', async () => {
    const twins = { ...oneFile, 'C:\\Users\\runneradmin': { dev: VOLUME, ino: HIGH + 21n } }
    expect(Number(HIGH + 20n)).toBe(Number(HIGH + 21n))
    expect(await namesTheSameThing(shortName, longName, 'win32', aDisk(twins))).toBe(false)
  })

  it('⛔ on Windows, a disk that keeps no file numbers tells nothing apart', async () => {
    const unnumbered = Object.fromEntries(
      Object.entries(oneFile).map(([path, entry]) => [path, { ...entry, ino: 0n }]),
    )
    expect(await namesTheSameThing(shortName, longName, 'win32', aDisk(unnumbered))).toBe(false)
  })

  it('on Windows, a part that is a link or junction is another thing, wherever it is', async () => {
    for (const at of ['C:\\Users\\RUNNER~1\\work', 'C:\\Users\\RUNNER~1\\work\\notes.md']) {
      const linked = { ...oneFile, [at]: { ...oneFile[at as keyof typeof oneFile], link: true } }
      expect(await namesTheSameThing(shortName, longName, 'win32', aDisk(linked)), at).toBe(false)
    }
  })

  it('on Windows, a stream, a device or extended path, a part that cannot be read, or another depth is not another spelling', async () => {
    // NTFS gives a named stream its file's number: only the stream rule tells them apart.
    const withAStream = aDisk({
      ...oneFile,
      [`${shortName}:hidden`]: oneFile['C:\\Users\\RUNNER~1\\work\\notes.md'],
    })
    expect(await namesTheSameThing(`${shortName}:hidden`, longName, 'win32', withAStream)).toBe(
      false,
    )
    // The same folders by their extended and device spellings: only the prefix rule refuses them.
    const prefixed = aDisk({
      ...oneFile,
      ...Object.fromEntries(
        Object.entries(oneFile).flatMap(([path, entry]) => [
          [`\\\\?\\${path}`, entry],
          [`\\\\.\\${path}`, entry],
        ]),
      ),
    })
    expect(await namesTheSameThing(`\\\\?\\${longName}`, longName, 'win32', prefixed)).toBe(false)
    expect(await namesTheSameThing(`\\\\.\\${longName}`, longName, 'win32', prefixed)).toBe(false)
    const disk = aDisk(oneFile)
    const unread = 'C:\\Users\\RUNNER~1\\other\\notes.md'
    expect(await namesTheSameThing(unread, longName, 'win32', disk)).toBe(false)
    const deeper = 'C:\\Users\\runneradmin\\work\\more\\notes.md'
    expect(await namesTheSameThing(shortName, deeper, 'win32', disk)).toBe(false)
  })

  it('on macOS and Linux, only the same spelling is the same thing', async () => {
    const disk = aDisk({})
    expect(await namesTheSameThing('/a/notes.md', '/a/notes.md', 'darwin', disk)).toBe(true)
    expect(await namesTheSameThing('/tmp/notes.md', '/private/tmp/notes.md', 'darwin', disk)).toBe(
      false,
    )
    expect(await namesTheSameThing('/a/Notes.md', '/a/notes.md', 'linux', disk)).toBe(false)
  })
})

describe('the numbers this computer gives its folders', () => {
  it('two folders are two numbers, and one folder by two spellings is one', async () => {
    const root = aFolder()
    mkdirSync(join(root, 'one'))
    mkdirSync(join(root, 'two'))
    const one = await lstat(join(root, 'one'), { bigint: true })
    const two = await lstat(join(root, 'two'), { bigint: true })
    const again = await lstat(join(root, 'one'), { bigint: true })
    expect(one.ino, 'this disk keeps no file numbers').not.toBe(0n)
    expect(one.ino === two.ino && one.dev === two.dev, 'two folders share a number').toBe(false)
    expect(again.ino).toBe(one.ino)
    if (process.platform === 'win32') {
      const otherSpelling = await lstat(realpathSync.native(root).toUpperCase(), { bigint: true })
      expect(otherSpelling.ino).toBe((await lstat(root, { bigint: true })).ino)
    }
  })
})

describe('a staged file at the send, on this computer', () => {
  /** A file in a folder of its own, staged as the picker hands it over: its real path. */
  function aStagedFile() {
    const root = aFolder()
    const folder = join(root, 'work')
    mkdirSync(folder)
    const file = join(folder, 'notes.md')
    writeFileSync(file, 'fictional notes\n')
    const real = realpathSync.native(file)
    return { root, folder, file, real }
  }

  it('is sent when it is what was attached', async () => {
    const { root, real } = aStagedFile()
    const checked = await recheckHandedPaths(
      [{ path: real, kind: 'file', outsideCwd: false }],
      root,
    )
    expect(checked).toEqual({ paths: [{ path: real, kind: 'file', outsideCwd: false }] })
  })

  it('on Windows, is sent whatever spelling of it was attached', async (ctx) => {
    ctx.skip(process.platform !== 'win32', 'one spelling per file off Windows')
    const { root, file, real } = aStagedFile()
    // The temp folder's own spelling (a short name on the hosted runner), and another case.
    for (const spelled of [file, file.toUpperCase(), real.toLowerCase()]) {
      const checked = await recheckHandedPaths(
        [{ path: spelled, kind: 'file', outsideCwd: false }],
        root,
      )
      expect(checked, spelled).toEqual({ paths: [{ path: real, kind: 'file', outsideCwd: false }] })
    }
  })

  it('🔴 on Windows, is refused when it was resolved through a junction that was gone by the check', async (ctx) => {
    ctx.skip(process.platform !== 'win32', 'junctions are Windows’ own')
    const root = realpathSync.native(aFolder())
    const slot = join(root, 'work', 'slot')
    const vault = join(root, 'private', 'vault')
    mkdirSync(slot, { recursive: true })
    mkdirSync(vault, { recursive: true })
    writeFileSync(join(slot, 'notes.md'), 'fictional notes\n')
    writeFileSync(join(vault, 'notes.md'), 'fictional vault\n')
    const attached = join(slot, 'notes.md')
    // The send resolves the path while a junction stands where the folder was…
    renameSync(slot, `${slot}-before`)
    symlinkSync(vault, slot, 'junction')
    const resolved = realpathSync.native(attached)
    expect(resolved).toBe(join(vault, 'notes.md'))
    // …and the folder is back before the attached path is looked at again.
    rmdirSync(slot)
    renameSync(`${slot}-before`, slot)
    expect(await namesTheSameThing(attached, resolved)).toBe(false)
  })

  it('is refused when a link or junction now stands where its folder was', async () => {
    const { root, folder, real } = aStagedFile()
    const elsewhere = join(root, 'elsewhere')
    mkdirSync(elsewhere)
    writeFileSync(join(elsewhere, 'notes.md'), 'other notes\n')
    renameSync(folder, join(root, 'work-before'))
    symlinkSync(elsewhere, folder, process.platform === 'win32' ? 'junction' : 'dir')
    const checked = await recheckHandedPaths(
      [{ path: real, kind: 'file', outsideCwd: false }],
      root,
    )
    expect(checked).toMatchObject({
      refusal: expect.stringContaining('that is not what you attached any more'),
    })
  })
})
