import {
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { keepToolApproval, keptToolApprovalsFile } from '../src/codex/kept-tool-approvals'
import { ensureCodexMemoryConfig } from '../src/codex/memory-config'
import { aStagingName, createFreshFile, withProviderHomeLock } from '../src/internal/provider-home'
import type { WindowsCreates } from './fixtures/an-open-that-follows-links'

/**
 * A file this app makes new is made at its own name, never where a link left there points. Windows
 * has no `O_NOFOLLOW`, and there an exclusive create follows such a link and makes the file
 * wherever it points. Off Windows, this file's `node:fs` behaves so; on Windows the system does.
 * Scratch folders only.
 */

const creates = vi.hoisted((): WindowsCreates => ({ windows: true, swap: null, swapped: false }))

vi.mock('node:fs', async (importOriginal) => {
  const { asWindowsCreates } = await import('./fixtures/an-open-that-follows-links')
  return asWindowsCreates(await importOriginal<typeof import('node:fs')>(), creates)
})

let root: string
let home: string
let outside: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brobot2-made-new-'))
  home = join(root, 'home')
  outside = join(root, 'not-ours')
  mkdirSync(home)
  mkdirSync(outside)
  creates.windows = true
  creates.swap = null
  creates.swapped = false
  creates.afterCreate = null
})

afterEach(() => {
  creates.swap = null
  creates.afterCreate = null
  rmSync(root, { recursive: true, force: true })
})

/** A link at `at` to a file that does not exist yet, outside. */
const aLinkOutside = (at: string, name: string): string => {
  const target = join(outside, name)
  symlinkSync(target, at)
  return target
}

/** The next exclusive create of a name `when` picks finds a link to `target` there. */
const aLinkAsItIsMade = (when: (path: string) => boolean, target: string): void => {
  creates.swap = { when, run: (path) => symlinkSync(target, path) }
}

/**
 * The next exclusive create of a name `when` picks finds a link to `target` there, and once it has
 * made `target` and opened it, the link is traded for a second name of that file: a hard link.
 */
const aSecondNameAsItIsMade = (when: (path: string) => boolean, target: string): void => {
  aLinkAsItIsMade(when, target)
  creates.afterCreate = {
    when,
    run: (path) => {
      rmSync(path)
      linkSync(target, path)
    },
  }
}

/** The code a create refused with, or undefined when it made a file (whose descriptor is closed). */
const codeOf = (run: () => unknown): string | undefined => {
  try {
    const made = run()
    if (typeof made === 'number') closeSync(made)
  } catch (error) {
    return (error as NodeJS.ErrnoException).code
  }
  return undefined
}

describe('a new file, made new', () => {
  it('the plain exclusive create follows a link left at the name: what this guards against', () => {
    const at = join(home, 'made')
    const target = aLinkOutside(at, 'made-there')

    closeSync(openSync(at, 'wx'))

    expect(existsSync(target), 'the exclusive create did not follow the link').toBe(true)
  })

  it('🔴 a link left at the name, pointing nowhere yet, is refused, and nothing is made where it points', () => {
    const at = join(home, 'made')
    const target = aLinkOutside(at, 'made-there')

    expect(codeOf(() => createFreshFile(at))).toBe('EEXIST')

    expect(existsSync(target)).toBe(false)
  })

  it('🔴 a link put at the name as it is made: the file is closed unwritten, and where it points stays empty', () => {
    const at = join(home, 'made')
    const target = join(outside, 'made-there')
    aLinkAsItIsMade((path) => path === at, target)

    expect(codeOf(() => createFreshFile(at))).toBe('ELOOP')

    expect(creates.swapped).toBe(true)
    expect(statSync(target).size).toBe(0)
  })

  it('🔴 a link put at the name as it is made, then traded for a second name of the file it made: refused, and nothing is written where it points', () => {
    const at = join(home, 'made')
    const target = join(outside, 'made-there')
    aSecondNameAsItIsMade((path) => path === at, target)

    expect(codeOf(() => createFreshFile(at))).toBe('ELOOP')

    expect(creates.swapped).toBe(true)
    expect(creates.afterCreate).toBeNull()
    expect(statSync(target).size).toBe(0)
  })

  it('a name nothing is at is made new, and opened to write', () => {
    const at = join(home, 'made')
    const fd = createFreshFile(at)
    try {
      writeSync(fd, 'WRITTEN')
    } finally {
      closeSync(fd)
    }
    expect(readFileSync(at, 'utf8')).toBe('WRITTEN')
  })

  it('where opens do not follow links, the system’s own create refuses the link', () => {
    creates.windows = false
    const at = join(home, 'made')
    const target = aLinkOutside(at, 'made-there')

    expect(codeOf(() => createFreshFile(at))).toBe('EEXIST')

    expect(existsSync(target)).toBe(false)
  })

  it('a staging name is the file’s, then a name nobody can know before it is made', () => {
    const one = aStagingName(join(home, 'config.toml'))
    expect(one.startsWith(`${join(home, 'config.toml')}.brobot-`)).toBe(true)
    expect(one.slice(-24)).toMatch(/^[0-9a-f]{24}$/)
    expect(aStagingName(join(home, 'config.toml'))).not.toBe(one)
  })
})

/** Links at every name the staging used before its names were random: `<file>.brobot-<pid>-<n>`. */
const linksAtTheOldNames = (file: string): void => {
  for (let n = 0; n < 10; n++) {
    aLinkOutside(`${file}.brobot-${String(process.pid)}-${String(n)}`, `old-${String(n)}`)
  }
}

describe('the files a Codex home is given', () => {
  const config = (): string => join(home, 'config.toml')

  it('🔴 config.toml: a link at a name the old staging used is never written through', () => {
    linksAtTheOldNames(config())

    expect(ensureCodexMemoryConfig(home).outcome).toBe('written')

    expect(readdirSync(outside)).toEqual([])
    expect(readFileSync(config(), 'utf8')).toContain('[memories]')
  })

  it('🔴 config.toml: a link put at its staged name as it is made sends nothing outside', () => {
    const target = join(outside, 'staged')
    aLinkAsItIsMade((path) => path.startsWith(`${config()}.brobot-`), target)

    expect(ensureCodexMemoryConfig(home).outcome).toBe('failed')

    expect(creates.swapped).toBe(true)
    expect(statSync(target).size).toBe(0)
    expect(existsSync(config())).toBe(false)
  })

  const APPROVAL = { server: 'docs', url: 'https://docs.example/mcp', tool: 'search' }

  it('🔴 a kept tool approval: a link at a name the old staging used is never written through', () => {
    linksAtTheOldNames(keptToolApprovalsFile(home))

    keepToolApproval(home, APPROVAL)

    expect(readdirSync(outside)).toEqual([])
    expect(readFileSync(keptToolApprovalsFile(home), 'utf8')).toContain('"search"')
  })

  it('🔴 a kept tool approval: a link put at its staged name as it is made sends nothing outside', () => {
    const target = join(outside, 'staged')
    aLinkAsItIsMade((path) => path.startsWith(`${keptToolApprovalsFile(home)}.brobot-`), target)

    expect(() => keepToolApproval(home, APPROVAL)).toThrow()

    expect(creates.swapped).toBe(true)
    expect(statSync(target).size).toBe(0)
    expect(existsSync(keptToolApprovalsFile(home))).toBe(false)
  })
})

describe('the lock beside a provider home', () => {
  it('🔴 a link left at the lock’s name holds the home, and nothing is written where it points', async () => {
    const target = aLinkOutside(`${home}.lock`, 'lock')
    let ran = false

    await expect(
      withProviderHomeLock(home, () => (ran = true), { timeoutMs: 300, pollMs: 20 }),
    ).rejects.toThrow(/timed out acquiring provisioning lock/)

    expect(ran).toBe(false)
    expect(existsSync(target)).toBe(false)
  })

  it('🔴 a link put at the lock’s name as it is taken: refused, and where it points stays empty', async () => {
    const target = join(outside, 'lock')
    aLinkAsItIsMade((path) => path === `${home}.lock`, target)
    let ran = false

    await expect(
      withProviderHomeLock(home, () => (ran = true), { timeoutMs: 300, pollMs: 20 }),
    ).rejects.toThrow(/ELOOP/)

    expect(ran).toBe(false)
    expect(statSync(target).size).toBe(0)
  })

  it('🔴 a link put at the lock’s name as it is taken, then traded for a second name of the file it made: refused, and no stamp is written where it points', async () => {
    const target = join(outside, 'lock')
    aSecondNameAsItIsMade((path) => path === `${home}.lock`, target)
    let ran = false

    await expect(
      withProviderHomeLock(home, () => (ran = true), { timeoutMs: 300, pollMs: 20 }),
    ).rejects.toThrow(/ELOOP/)

    expect(ran).toBe(false)
    expect(creates.afterCreate).toBeNull()
    expect(statSync(target).size).toBe(0)
  })

  it('a lock nothing is at is taken and released', async () => {
    expect(await withProviderHomeLock(home, () => 'ran', { timeoutMs: 300, pollMs: 20 })).toBe(
      'ran',
    )
    expect(existsSync(`${home}.lock`)).toBe(false)
  })

  it('a stale lock a crash left is broken, and the home taken with a new lock made at its name', async () => {
    // Empty and an hour old: nobody stamped it, and its age says nobody holds it.
    const lock = `${home}.lock`
    writeFileSync(lock, '')
    const anHourAgo = new Date(Date.now() - 3_600_000)
    utimesSync(lock, anHourAgo, anHourAgo)

    expect(await withProviderHomeLock(home, () => 'ran', { timeoutMs: 2_000, pollMs: 20 })).toBe(
      'ran',
    )

    expect(existsSync(lock)).toBe(false)
    expect(readdirSync(root).filter((name) => name.includes('.stale-'))).toEqual([])
  })
})
