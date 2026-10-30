import {
  constants,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeAutoMemoryDir } from '@brobot2/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeKeptRule } from '../src/main/kept-rules'
import { amendAgentMemory } from '../src/main/runtime/agent-memory'
import { readSavedMethods, SAVED_METHODS_INDEX } from '../src/main/saved-methods'

/**
 * Windows has no `O_NOFOLLOW`: an open there follows a link put at the path. The files an agent's
 * home holds and this app rewrites or reads for a launch are never written or read through one
 * anyway. Off Windows, this file's `node:fs` drops `O_NOFOLLOW` from an open, as Windows does, and
 * can put a link at a name just before an open. Scratch folders only.
 */

const fake = vi.hoisted(() => ({
  followsLinks: false,
  /** Run once, just before the first open `when` picks. */
  swap: null as null | { readonly when: (path: string, flags: unknown) => boolean; run(): void },
  swapped: false,
}))

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  const openSync = (...args: Parameters<typeof fs.openSync>): number => {
    const [path, flags, mode] = args
    const swap = fake.swap
    if (swap !== null && swap.when(String(path), flags)) {
      fake.swap = null
      swap.run()
      fake.swapped = true
    }
    const asked =
      fake.followsLinks && typeof flags === 'number'
        ? flags & ~(fs.constants.O_NOFOLLOW ?? 0)
        : flags
    return fs.openSync(path, asked, mode)
  }
  return { ...fs, default: { ...fs, openSync }, openSync }
})

let root: string
let outside: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brobot2-follows-links-'))
  outside = join(root, 'not-ours')
  mkdirSync(outside)
  fake.followsLinks = false
  fake.swap = null
  fake.swapped = false
})

afterEach(() => {
  fake.swap = null
  rmSync(root, { recursive: true, force: true })
})

/** An open that may write. */
const aWrite = (_path: string, flags: unknown): boolean =>
  typeof flags === 'string'
    ? /[wa+]/.test(flags)
    : (Number(flags) & (constants.O_WRONLY | constants.O_RDWR)) !== 0

/** The entry's name, now a link to `to`. */
const linkInPlace = (path: string, to: string) => () => {
  rmSync(path)
  symlinkSync(to, path)
}

describe('a memory entry, corrected', () => {
  const homesRoot = (): string => join(root, 'provider-homes')
  const homeOf = (provider: string): string => join(homesRoot(), 'default', 'writer', provider)
  const aStore = (): { dir: string; note: string } => {
    const dir = claudeAutoMemoryDir(homeOf('claude'))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'MEMORY.md'), '- [A note](note.md) — a fictional note\n')
    writeFileSync(join(dir, 'note.md'), 'A FICTIONAL NOTE\n')
    return { dir, note: join(dir, 'note.md') }
  }
  const correct = (entry: string, text: string) =>
    amendAgentMemory({
      profileId: 'writer',
      homeOf,
      homesRoot: homesRoot(),
      provider: 'claude',
      act: 'corrected',
      text,
      entry,
    })

  it('🔴 a link put at the entry after it was checked is replaced, and what it points at keeps its bytes', async () => {
    const { dir, note } = aStore()
    const theirs = join(outside, 'CLAUDE.md')
    writeFileSync(theirs, 'SOMEONE ELSE’S FILE\n')
    fake.followsLinks = true
    fake.swap = { when: aWrite, run: linkInPlace(note, theirs) }

    const outcome = await correct(note, 'CORRECTED\n')

    expect(fake.swapped).toBe(true)
    expect(readFileSync(theirs, 'utf8')).toBe('SOMEONE ELSE’S FILE\n')
    expect(outcome.done).toBe(true)
    expect(lstatSync(note).isFile()).toBe(true)
    expect(readFileSync(note, 'utf8')).toBe('CORRECTED\n')
    expect(readdirSync(dir).sort()).toEqual(['MEMORY.md', 'note.md'])
  })

  it('🔴 an entry with a second name elsewhere is corrected at its own name only', async () => {
    const { note } = aStore()
    const theirs = join(outside, 'second-name.md')
    rmSync(note)
    writeFileSync(theirs, 'SOMEONE ELSE’S FILE\n')
    linkSync(theirs, note)

    expect((await correct(note, 'CORRECTED\n')).done).toBe(true)

    expect(readFileSync(theirs, 'utf8')).toBe('SOMEONE ELSE’S FILE\n')
    expect(readFileSync(note, 'utf8')).toBe('CORRECTED\n')
  })

  it('a corrected entry keeps its permissions, and nothing staged is left beside it', async () => {
    const { dir, note } = aStore()
    const mode = statSync(note).mode

    expect((await correct(note, 'CORRECTED\n')).done).toBe(true)

    expect(statSync(note).mode).toBe(mode)
    expect(readdirSync(dir).sort()).toEqual(['MEMORY.md', 'note.md'])
  })
})

describe('a kept rule removed where an open follows links (Windows)', () => {
  const RULE = 'Bash(make *)'
  const aLinkedSettingsFile = (): { file: string; theirs: string } => {
    const theirs = join(outside, 'settings.json')
    writeFileSync(theirs, JSON.stringify({ permissions: { allow: [RULE] } }))
    const project = join(root, 'project', '.claude')
    mkdirSync(project, { recursive: true })
    const file = join(project, 'settings.local.json')
    symlinkSync(theirs, file)
    return { file, theirs }
  }
  const remove = (file: string) =>
    removeKeptRule(
      { projectFiles: { claude: [file], codex: [] }, homes: [], personsOwn: [] },
      { provider: 'claude', file, kept: RULE },
      'win32',
    )

  it('🔴 a settings file that is a link has the rule removed from the file it leads to, and stays a link', () => {
    const { file, theirs } = aLinkedSettingsFile()
    fake.followsLinks = true

    expect(remove(file)).toEqual({ removed: true })

    expect(lstatSync(file).isSymbolicLink()).toBe(true)
    expect(JSON.parse(readFileSync(theirs, 'utf8'))).toEqual({ permissions: { allow: [] } })
  })

  it('a plain settings file is rewritten', () => {
    const project = join(root, 'project', '.claude')
    mkdirSync(project, { recursive: true })
    const file = join(project, 'settings.local.json')
    writeFileSync(file, JSON.stringify({ permissions: { allow: [RULE, 'Read'] } }))
    fake.followsLinks = true

    expect(remove(file)).toEqual({ removed: true })

    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ permissions: { allow: ['Read'] } })
  })
})

describe('a saved-methods index read where an open follows links (Windows)', () => {
  const METHOD = '# A fictional method\n\nStep one.\n'
  const OURS = '- Rotate a fictional log | when it is large | verified 2026-10-12 | rotate-log.md'
  const THEIRS = '- Someone else’s method | when they say | verified 2026-10-12 | rotate-log.md'
  const aFolder = (): string => {
    const folder = join(root, 'runbooks')
    mkdirSync(folder)
    writeFileSync(join(folder, 'rotate-log.md'), METHOD)
    writeFileSync(join(folder, SAVED_METHODS_INDEX), `${OURS}\n`)
    return folder
  }

  it('🔴 an index replaced by a link after it was looked at is not read', () => {
    const folder = aFolder()
    const index = join(folder, SAVED_METHODS_INDEX)
    const theirs = join(outside, 'index.md')
    writeFileSync(theirs, `${THEIRS}\n`)
    fake.followsLinks = true
    fake.swap = { when: (path) => path === index, run: linkInPlace(index, theirs) }

    const reading = readSavedMethods(folder, 0, 'win32')

    expect(fake.swapped).toBe(true)
    expect(reading).toMatchObject({
      kind: 'refused',
      refusal: { kind: 'a-link', what: 'the-index' },
    })
  })

  it('an index left as it was is read', () => {
    const folder = aFolder()
    fake.followsLinks = true

    const reading = readSavedMethods(folder, 0, 'win32')

    expect(reading).toMatchObject({ kind: 'read', methods: [{ title: 'Rotate a fictional log' }] })
  })
})
