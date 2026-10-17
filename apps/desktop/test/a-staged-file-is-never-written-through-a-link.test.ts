import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  linkSync,
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
import { basename, join } from 'node:path'
import { claudeAutoMemoryDir } from '@brobot2/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindowsCreates } from '../../../packages/runtime/test/fixtures/an-open-that-follows-links'
import { removeKeptRule } from '../src/main/kept-rules'
import { keepResource } from '../src/main/resources/resources'
import { amendAgentMemory } from '../src/main/runtime/agent-memory'
import { publishOwnFile } from '../src/main/runtime/workspace'
import { makeWorkerPieceFolder, WORKER_OUTPUT_FAILURE } from '../src/main/worker-piece-folder'

/**
 * What this app stages and renames into place, and the markers it makes, are made new at names of
 * their own, never where a link left there points. Windows has no `O_NOFOLLOW`, and there an
 * exclusive create follows such a link and makes the file wherever it points. Off Windows, this
 * file's `node:fs` behaves so; on Windows the system does. Scratch folders only.
 */

const creates = vi.hoisted((): WindowsCreates => ({ windows: true, swap: null, swapped: false }))

vi.mock('node:fs', async (importOriginal) => {
  const { asWindowsCreates } =
    await import('../../../packages/runtime/test/fixtures/an-open-that-follows-links')
  return asWindowsCreates(await importOriginal<typeof import('node:fs')>(), creates)
})

let root: string
let outside: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brobot2-staged-'))
  outside = join(root, 'not-ours')
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

/** Links at every name a staging used before its names were random: `<prefix>.brobot-<pid>-<n>`. */
const linksAtTheOldNames = (prefix: string): void => {
  for (let n = 0; n < 10; n++) {
    symlinkSync(
      join(outside, `old-${String(n)}`),
      `${prefix}.brobot-${String(process.pid)}-${String(n)}`,
    )
  }
}

/** The next exclusive create of a name `when` picks finds a link to `target` there. */
const aLinkAsItIsMade = (when: (path: string) => boolean, target: string): void => {
  creates.swap = { when, run: (path) => symlinkSync(target, path) }
}

/** What a link put in the moment made where it points: nothing, or an empty file. */
const bytesAt = (path: string): number => (existsSync(path) ? statSync(path).size : 0)

describe('a kept rule removed', () => {
  const RULE = 'Bash(make *)'
  const aSettingsFile = (): string => {
    const folder = join(root, 'project', '.claude')
    mkdirSync(folder, { recursive: true })
    const file = join(folder, 'settings.local.json')
    writeFileSync(file, JSON.stringify({ permissions: { allow: [RULE, 'Read'] } }))
    return file
  }
  const remove = (file: string) =>
    removeKeptRule(
      { claudeProjectFiles: [file], homes: [], personsOwn: [] },
      { provider: 'claude', file, kept: RULE },
    )

  it('🔴 a link at a name the old staging used is never written through', () => {
    const file = aSettingsFile()
    linksAtTheOldNames(file)

    expect(remove(file)).toEqual({ removed: true })

    expect(readdirSync(outside)).toEqual([])
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ permissions: { allow: ['Read'] } })
  })

  it('🔴 a link put at its staged name as it is made sends nothing outside', () => {
    const file = aSettingsFile()
    const target = join(outside, 'staged')
    aLinkAsItIsMade((path) => path.startsWith(`${file}.brobot-`), target)

    expect(remove(file)).toMatchObject({ removed: false })

    expect(creates.swapped).toBe(true)
    expect(bytesAt(target)).toBe(0)
    expect(JSON.parse(readFileSync(file, 'utf8')).permissions.allow).toContain(RULE)
  })
})

describe('a file the workspace is given', () => {
  const NAME = 'AGENTS.md'

  it('🔴 a link at a name the old staging used is never written through', () => {
    linksAtTheOldNames(join(root, `.${NAME}`))

    publishOwnFile(root, NAME, 'THE WORKSPACE’S OWN\n')

    expect(readdirSync(outside)).toEqual([])
    expect(readFileSync(join(root, NAME), 'utf8')).toBe('THE WORKSPACE’S OWN\n')
  })

  it('🔴 a link put at its staged name as it is made sends nothing outside', () => {
    const target = join(outside, 'staged')
    aLinkAsItIsMade((path) => path.startsWith(join(root, `.${NAME}.brobot-`)), target)

    expect(() => publishOwnFile(root, NAME, 'THE WORKSPACE’S OWN\n')).toThrow(/could not stage/)

    expect(creates.swapped).toBe(true)
    expect(bytesAt(target)).toBe(0)
    expect(existsSync(join(root, NAME))).toBe(false)
  })
})

describe('a memory entry corrected, its stage beside it as on macOS and Linux', () => {
  const homesRoot = (): string => join(root, 'provider-homes')
  const homeOf = (provider: string): string => join(homesRoot(), 'default', 'writer', provider)
  const aNote = (): string => {
    const dir = claudeAutoMemoryDir(homeOf('claude'))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'MEMORY.md'), '- [A note](note.md) — a fictional note\n')
    writeFileSync(join(dir, 'note.md'), 'A FICTIONAL NOTE\n')
    return join(dir, 'note.md')
  }
  // The link rule is the create's own, on every system; the platform here only places the stage.
  const correct = (entry: string) =>
    amendAgentMemory(
      {
        profileId: 'writer',
        homeOf,
        homesRoot: homesRoot(),
        provider: 'claude',
        act: 'corrected',
        text: 'CORRECTED\n',
        entry,
      },
      { platform: 'darwin' },
    )

  it('🔴 a link at a name the old staging used is never written through', async () => {
    const note = aNote()
    linksAtTheOldNames(join(note, '..', `.${basename(note)}`))

    expect((await correct(note)).done).toBe(true)

    expect(readdirSync(outside)).toEqual([])
    expect(readFileSync(note, 'utf8')).toBe('CORRECTED\n')
  })

  it('🔴 a link put at its staged name as it is made sends nothing outside', async () => {
    const note = aNote()
    const target = join(outside, 'staged')
    aLinkAsItIsMade((path) => basename(path).startsWith('.note.md.brobot-'), target)

    const outcome = await correct(note)

    expect(!outcome.done && outcome.refused).toBe('write-failed')
    expect(creates.swapped).toBe(true)
    expect(bytesAt(target)).toBe(0)
    expect(readFileSync(note, 'utf8')).toBe('A FICTIONAL NOTE\n')
  })
})

describe('a kept resource', () => {
  const BYTES = Buffer.from('# A fictional report\n')
  const SHA256 = createHash('sha256').update(BYTES).digest('hex')

  it('🔴 a link put at its temporary name as it is made sends nothing outside', () => {
    const kept = join(root, 'resources')
    const target = join(outside, 'part')
    aLinkAsItIsMade(
      (path) => basename(path).startsWith(`.${SHA256}.`) && path.endsWith('.part'),
      target,
    )

    expect(keepResource(kept, { bytes: BYTES, sha256: SHA256, name: 'report.md' })).toEqual({
      ok: false,
      problem: 'write-failed',
    })

    expect(creates.swapped).toBe(true)
    expect(bytesAt(target)).toBe(0)
  })

  it('kept with nothing in the way', () => {
    const kept = join(root, 'resources')
    expect(keepResource(kept, { bytes: BYTES, sha256: SHA256, name: 'report.md' })).toEqual({
      ok: true,
    })
    expect(readFileSync(join(kept, SHA256, 'report.md'))).toEqual(BYTES)
  })
})

describe('a worker’s output folder, and the markers that say it is the app’s', () => {
  const piece = `work_${randomUUID()}`

  it.each([
    ['the folder’s own marker', '.brocrew-piece'],
    ['the root’s marker', '.brocrew-worker-output'],
  ])('🔴 a link put at %s as it is made sends nothing outside', (_, marker) => {
    const target = join(outside, 'marker')
    aLinkAsItIsMade((path) => basename(path) === marker, target)

    expect(() => makeWorkerPieceFolder(root, piece)).toThrow(WORKER_OUTPUT_FAILURE)

    expect(creates.swapped).toBe(true)
    expect(bytesAt(target)).toBe(0)
  })

  it.each([
    ['the folder’s own marker', '.brocrew-piece'],
    ['the root’s marker', '.brocrew-worker-output'],
  ])(
    '🔴 a link put at %s as it is made, then traded for a second name of the file it made, sends nothing outside',
    (_, marker) => {
      const target = join(outside, 'marker')
      aLinkAsItIsMade((path) => basename(path) === marker, target)
      creates.afterCreate = {
        when: (path) => basename(path) === marker,
        run: (path) => {
          rmSync(path)
          linkSync(target, path)
        },
      }

      expect(() => makeWorkerPieceFolder(root, piece)).toThrow(WORKER_OUTPUT_FAILURE)

      expect(creates.afterCreate).toBeNull()
      expect(bytesAt(target)).toBe(0)
    },
  )

  it('made with nothing in the way', () => {
    const output = makeWorkerPieceFolder(root, piece)
    expect(readFileSync(join(output, '.brocrew-piece'), 'utf8')).toBe(`${piece}\n`)
  })
})
