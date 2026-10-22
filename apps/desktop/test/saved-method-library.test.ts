import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as savedMethods from '../src/main/saved-methods'

// This contract also compiles before the complete library reader exists.
interface MethodLibraryInputs {
  readonly folder: string
  readonly homesRoot: string
}
interface MethodReadSeams {
  readonly platform?: NodeJS.Platform
  readonly beforeOpen?: (name: string) => void
  readonly afterOpen?: (name: string) => void
}
interface LibraryItem {
  readonly key: string
  readonly name: string
  readonly kind: string
  readonly fingerprint: string | null
  readonly references: readonly unknown[]
  readonly canDelete: boolean
}
interface LibraryReading {
  readonly state: string
  readonly items: readonly LibraryItem[]
  readonly total: number
  readonly nextOffset: number | null
  readonly indexFingerprint: string | null
  readonly malformedLines: number
  readonly indexState: string
  readonly truncated: boolean
}
type BodyReading =
  | { readonly ok: false; readonly problem: string }
  | {
      readonly ok: true
      readonly text: string
      readonly bytes: number
      readonly fingerprint: string
    }
const METHOD_LIBRARY_SCAN_LIMIT = 5000
function listSavedMethodLibrary(
  inputs: MethodLibraryInputs,
  now: number,
  offset?: number,
  limit?: number,
): LibraryReading {
  const read: unknown = Reflect.get(savedMethods, 'listSavedMethodLibrary')
  expect(read, 'the complete saved-method library reader').toBeTypeOf('function')
  return (
    read as (
      inputs: MethodLibraryInputs,
      now: number,
      offset?: number,
      limit?: number,
    ) => LibraryReading
  )(inputs, now, offset, limit)
}
function readSavedMethodBody(
  inputs: MethodLibraryInputs,
  key: string,
  seams?: MethodReadSeams,
): BodyReading {
  const read: unknown = Reflect.get(savedMethods, 'readSavedMethodBody')
  expect(read, 'the saved-method body reader').toBeTypeOf('function')
  return (
    read as (inputs: MethodLibraryInputs, key: string, seams?: MethodReadSeams) => BodyReading
  )(inputs, key, seams)
}
import { SAVED_METHODS_MOST_METHOD_BYTES } from '../src/shared/saved-methods'

let root: string
let folder: string
let inputs: MethodLibraryInputs
const indexLine = (file: string, title = 'Readable steps') =>
  `- ${title} | During a review | verified 2031-01-01 | ${file}`

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'method-library-'))
  folder = join(root, 'managed', 'default', 'wren', 'runbooks')
  mkdirSync(folder, { recursive: true })
  inputs = { folder, homesRoot: join(root, 'managed') }
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('saved methods in the agent book', () => {
  it('does not provision a missing folder', () => {
    const absent = { ...inputs, folder: join(root, 'managed', 'default', 'lark', 'runbooks') }
    expect(listSavedMethodLibrary(absent, 100).state).toBe('missing')
    expect(existsSync(absent.folder)).toBe(false)
  })

  it('shows raw index, duplicate references, unindexed files, malformed lines and missing methods', () => {
    const text = [
      indexLine('review.md'),
      indexLine('review.md', 'Second use'),
      '- malformed entry',
      indexLine('missing.md'),
      '',
    ].join('\r\n')
    writeFileSync(join(folder, 'index.md'), text)
    writeFileSync(join(folder, 'review.md'), '# Review\nRead the change.\n')
    writeFileSync(join(folder, 'unindexed.md'), 'A method not listed yet.')
    const catalog = listSavedMethodLibrary(inputs, 100)
    expect(catalog.state).toBe('read')
    expect(catalog.items.map((one) => one.name)).toEqual([
      'index.md',
      'missing.md',
      'review.md',
      'unindexed.md',
    ])
    expect(catalog.items.find((one) => one.name === 'review.md')?.references).toHaveLength(2)
    expect(catalog.items.find((one) => one.name === 'missing.md')).toMatchObject({
      kind: 'missing-reference',
      problem: 'missing',
      canDelete: true,
    })
    expect(catalog.items.find((one) => one.name === 'unindexed.md')?.references).toEqual([])
    expect(catalog.malformedLines).toBe(1)
    expect(readSavedMethodBody(inputs, 'index')).toMatchObject({
      ok: true,
      text,
      fingerprint: catalog.indexFingerprint,
    })
  })

  it('reads the raw index beyond the launch index budget and paginates methods independently', () => {
    writeFileSync(join(folder, 'index.md'), `# Notes\n${'Context '.repeat(700)}\n`)
    for (let i = 0; i < 30; i++)
      writeFileSync(join(folder, `method-${String(i).padStart(2, '0')}.md`), `Method ${i}`)
    const first = listSavedMethodLibrary(inputs, 100, 0, 20)
    expect(first.total).toBe(31)
    expect(first.nextOffset).toBe(20)
    const next = listSavedMethodLibrary(inputs, 101, first.nextOffset!, 20)
    expect(next.items).toHaveLength(11)
    expect(next.nextOffset).toBeNull()
    const chosen = next.items.find((one) => one.name === 'method-21.md')!
    expect(readSavedMethodBody(inputs, chosen.key)).toMatchObject({
      ok: true,
      text: 'Method 21',
      fingerprint: chosen.fingerprint,
    })
    const index = readSavedMethodBody(inputs, 'index')
    expect(index.ok && index.bytes).toBeGreaterThan(4096)
  })

  it('resolves only app-issued keys and refuses linked or oversized method bodies', () => {
    const outside = join(root, 'outside.md')
    writeFileSync(outside, 'Outside the managed folder.')
    symlinkSync(outside, join(folder, 'linked.md'))
    writeFileSync(join(folder, 'large.md'), 'x'.repeat(SAVED_METHODS_MOST_METHOD_BYTES + 1))
    const catalog = listSavedMethodLibrary(inputs, 100)
    expect(catalog.items.find((one) => one.name === 'linked.md')).toMatchObject({
      problem: 'link',
      canDelete: false,
    })
    expect(catalog.items.find((one) => one.name === 'large.md')).toMatchObject({
      problem: 'too-large',
      canDelete: false,
    })
    expect(readSavedMethodBody(inputs, '../outside.md')).toEqual({ ok: false, problem: 'missing' })
    expect(
      readSavedMethodBody(inputs, catalog.items.find((one) => one.name === 'linked.md')!.key),
    ).toEqual({ ok: false, problem: 'link' })
  })

  it('refuses redirected folders and does not treat a directory as a method file', () => {
    mkdirSync(join(folder, 'directory.md'))
    expect(listSavedMethodLibrary(inputs, 100).items[0]).toMatchObject({
      problem: 'not-a-file',
      canDelete: false,
    })
    const redirected = join(root, 'elsewhere')
    mkdirSync(redirected)
    writeFileSync(join(redirected, 'private.md'), 'Different folder')
    rmSync(folder, { recursive: true })
    symlinkSync(redirected, folder, 'dir')
    expect(listSavedMethodLibrary(inputs, 100).state).toBe('unavailable')
  })

  it('reports an index directory and a linked index explicitly instead of implying there is no index', () => {
    mkdirSync(join(folder, 'index.md'))
    expect(listSavedMethodLibrary(inputs, 100)).toMatchObject({
      indexState: 'problem',
      indexProblem: 'not-a-file',
    })
    rmSync(join(folder, 'index.md'), { recursive: true })
    const outside = join(root, 'other-index.md')
    writeFileSync(outside, 'Other index')
    symlinkSync(outside, join(folder, 'index.md'))
    expect(listSavedMethodLibrary(inputs, 100)).toMatchObject({
      indexState: 'problem',
      indexProblem: 'link',
    })
  })

  it('allows a hard-linked plain method to be read while rejecting symbolic links', () => {
    const original = join(root, 'original.md')
    writeFileSync(original, 'Shared bytes')
    linkSync(original, join(folder, 'linked-name.md'))
    const entry = listSavedMethodLibrary(inputs, 100).items[0]!
    expect(entry).toMatchObject({ name: 'linked-name.md', canDelete: true })
    expect(readSavedMethodBody(inputs, entry.key)).toMatchObject({ ok: true, text: 'Shared bytes' })
  })

  it('does not call an invalid UTF-8 index absent or allow mutations through it', () => {
    writeFileSync(join(folder, 'index.md'), Buffer.from([0xff, 0xfe]))
    writeFileSync(join(folder, 'readable.md'), 'Readable')
    const catalog = listSavedMethodLibrary(inputs, 100)
    expect(catalog).toMatchObject({ indexState: 'problem', indexProblem: 'unreadable' })
    expect(catalog.items.every((one) => !one.canDelete)).toBe(true)
  })

  it('reads a changed method afresh and resolves a case alias only if it is the same file', () => {
    writeFileSync(join(folder, 'Review.md'), 'First')
    writeFileSync(join(folder, 'index.md'), indexLine('review.md'))
    const before = listSavedMethodLibrary(inputs, 100)
    const actual = before.items.find((one) => one.name === 'Review.md')!
    writeFileSync(join(folder, 'Review.md'), 'Second')
    const after = readSavedMethodBody(inputs, actual.key)
    expect(after).toMatchObject({ ok: true, text: 'Second' })
    expect(after.ok && after.fingerprint).not.toBe(actual.fingerprint)
    if (existsSync(join(folder, 'review.md'))) {
      expect(actual.references).toHaveLength(1)
      expect(before.items.filter((one) => one.name.toLowerCase() === 'review.md')).toHaveLength(1)
    } else {
      expect(actual.references).toEqual([])
      expect(before.items.find((one) => one.name === 'review.md')?.kind).toBe('missing-reference')
    }
  })

  it('recognizes a differently cased index only on a filesystem where it is the same entry', () => {
    const text = '# Index\n' + 'Context '.repeat(700)
    writeFileSync(join(folder, 'Index.md'), text)
    const catalog = listSavedMethodLibrary(inputs, 100)
    if (existsSync(join(folder, 'index.md'))) {
      expect(catalog).toMatchObject({ indexState: 'ok', total: 1 })
      expect(catalog.items[0]).toMatchObject({ key: 'index', kind: 'index', name: 'Index.md' })
      expect(readSavedMethodBody(inputs, 'index')).toMatchObject({ ok: true, text })
    } else {
      expect(catalog.indexState).toBe('absent')
      expect(catalog.items[0]?.kind).toBe('method')
    }
  })

  it('treats an index self-reference as metadata for the raw index', () => {
    writeFileSync(join(folder, 'index.md'), indexLine('index.md'))
    const catalog = listSavedMethodLibrary(inputs, 100)
    expect(catalog.total).toBe(1)
    expect(catalog.items[0]).toMatchObject({ key: 'index', kind: 'index' })
    expect(catalog.items[0]?.references).toHaveLength(1)
  })

  it('refuses a symbolic managed root and a folder swapped after opening a method', () => {
    const alternative = join(root, 'alternative')
    mkdirSync(alternative)
    writeFileSync(join(alternative, 'review.md'), 'Outside')
    const linkedRoot = join(root, 'linked-root')
    symlinkSync(inputs.homesRoot, linkedRoot, 'dir')
    expect(
      listSavedMethodLibrary(
        { folder: join(linkedRoot, 'default', 'wren', 'runbooks'), homesRoot: linkedRoot },
        100,
      ).state,
    ).toBe('unavailable')
    writeFileSync(join(folder, 'review.md'), 'Inside')
    const key = listSavedMethodLibrary(inputs, 100).items[0]!.key
    expect(
      readSavedMethodBody(inputs, key, {
        afterOpen: (name) => {
          if (name !== 'review.md') return
          renameSync(folder, `${folder}-old`)
          symlinkSync(alternative, folder, 'dir')
        },
      }).ok,
    ).toBe(false)
  })

  it('reports truncation instead of pretending a capped directory scan was complete', () => {
    for (let i = 0; i <= METHOD_LIBRARY_SCAN_LIMIT; i++)
      writeFileSync(join(folder, `note-${i}.md`), 'Note')
    const catalog = listSavedMethodLibrary(inputs, 100)
    expect(catalog.truncated).toBe(true)
    expect(catalog.total).toBe(METHOD_LIBRARY_SCAN_LIMIT)
    expect(catalog.items.every((one) => !one.canDelete)).toBe(true)
  })

  it.each([
    [-1, 50],
    [0, 0],
    [0, 101],
    [0.5, 50],
    [0, Number.NaN],
  ])('refuses invalid pagination %s / %s', (offset, limit) => {
    expect(listSavedMethodLibrary(inputs, 100, offset, limit).state).toBe('unavailable')
  })

  it('makes mutations unavailable when the complete index cannot be recovered', () => {
    writeFileSync(join(folder, 'index.md'), 'x'.repeat(64 * 1024 + 1))
    writeFileSync(join(folder, 'review.md'), 'Review')
    const catalog = listSavedMethodLibrary(inputs, 100)
    expect(catalog).toMatchObject({ indexState: 'problem', indexProblem: 'too-large' })
    expect(catalog.items.find((one) => one.name === 'index.md')).toMatchObject({
      problem: 'too-large',
      canDelete: false,
    })
    expect(catalog.items.find((one) => one.name === 'review.md')?.canDelete).toBe(false)
  })
})
