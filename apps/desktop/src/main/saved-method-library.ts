import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
  type BigIntStats,
} from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isStillTheFileOpened } from '@brobot2/runtime'
import { SAVED_METHODS_MOST_METHOD_BYTES } from '../shared/saved-methods'
import type {
  MethodBody,
  MethodLibrary,
  MethodLibraryItem,
  MethodProblem,
  MethodReference,
} from '../shared/saved-method-library'
import { parseSavedMethodLine, SAVED_METHODS_INDEX } from './saved-method-index'

const INDEX_BYTES = 64 * 1024
export const METHOD_LIBRARY_SCAN_LIMIT = 5000

/** Paths are derived in main; reading never provisions a missing profile home. */
export interface MethodLibraryInputs {
  readonly folder: string
  readonly homesRoot: string
}

/** Filesystem interleavings for the guarded reader's regression fixtures. */
export interface MethodReadSeams {
  readonly platform?: NodeJS.Platform
  readonly beforeOpen?: (name: string) => void
  readonly afterOpen?: (name: string) => void
}

interface FileImage {
  readonly bytes: Buffer
  readonly fingerprint: string
  readonly mode: number
}

class Refused extends Error {
  constructor(readonly problem: MethodProblem) {
    super(problem)
  }
}

function at(path: string): BigIntStats | null {
  try {
    return lstatSync(path, { bigint: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function within(root: string, path: string): boolean {
  const part = relative(root, path)
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

/** Refuse redirected folders and every symbolic link below the managed root. */
function folderAt(inputs: MethodLibraryInputs): BigIntStats {
  const root = resolve(inputs.homesRoot)
  const folder = resolve(inputs.folder)
  if (!within(root, folder)) throw new Refused('link')
  const rootStat = at(root)
  if (rootStat === null) throw new Refused('missing')
  if (rootStat.isSymbolicLink()) throw new Refused('link')
  if (!rootStat.isDirectory()) throw new Refused('not-a-file')
  let path = root
  let stat = rootStat
  for (const segment of relative(root, folder).split(sep)) {
    path = join(path, segment)
    const entry = at(path)
    if (entry === null) throw new Refused('missing')
    if (entry.isSymbolicLink()) throw new Refused('link')
    if (!entry.isDirectory()) throw new Refused('not-a-file')
    stat = entry
  }
  if (!within(realpathSync(root), realpathSync(folder))) throw new Refused('link')
  return stat
}

function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino
}
function hash(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}
function keyOf(name: string, indexName: string): string {
  return name === indexName ? 'index' : `method:${hash(name)}`
}

/** Read a stable plain file without following its final link or waiting on a pipe. */
function image(
  inputs: MethodLibraryInputs,
  name: string,
  limit: number,
  seams: MethodReadSeams,
): FileImage | null {
  const folder = folderAt(inputs)
  const path = join(inputs.folder, name)
  const before = at(path)
  if (before === null) return null
  if (before.isSymbolicLink()) throw new Refused('link')
  if (!before.isFile()) throw new Refused('not-a-file')
  if (before.size > BigInt(limit)) throw new Refused('too-large')
  seams.beforeOpen?.(name)
  const fd = openSync(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  )
  try {
    seams.afterOpen?.(name)
    if ((seams.platform ?? process.platform) === 'win32' && !isStillTheFileOpened(path, fd))
      throw new Refused('link')
    const opened = fstatSync(fd, { bigint: true })
    if (!opened.isFile() || !sameFile(before, opened)) throw new Refused('link')
    if (!sameFile(folder, folderAt(inputs))) throw new Refused('link')
    const buffer = Buffer.alloc(limit + 1)
    let count = 0
    while (count < buffer.length) {
      const read = readSync(fd, buffer, count, buffer.length - count, count)
      if (read === 0) break
      count += read
    }
    if (count > limit) throw new Refused('too-large')
    const after = fstatSync(fd, { bigint: true })
    const named = at(path)
    if (
      named === null ||
      named.isSymbolicLink() ||
      !sameFile(opened, named) ||
      opened.size !== after.size ||
      opened.mtimeNs !== after.mtimeNs ||
      opened.ctimeNs !== after.ctimeNs ||
      !sameFile(folder, folderAt(inputs))
    )
      throw new Refused('unreadable')
    const bytes = buffer.subarray(0, count)
    return { bytes, fingerprint: hash(bytes), mode: Number(opened.mode & 0o777n) }
  } finally {
    closeSync(fd)
  }
}

interface Catalog {
  readonly names: readonly string[]
  readonly references: ReadonlyMap<string, readonly MethodReference[]>
  readonly indexName: string
  readonly index: FileImage | null
  readonly indexProblem?: MethodProblem
  readonly malformedLines: number
  readonly truncated: boolean
}

/** Resolve a differently cased spelling only when it names the exact same file. */
function actualName(inputs: MethodLibraryInputs, found: ReadonlySet<string>, name: string): string {
  if (found.has(name)) return name
  let expected: BigIntStats | null
  try {
    expected = at(join(inputs.folder, name))
  } catch {
    return name
  }
  if (expected === null) return name
  for (const candidate of found) {
    if (candidate.toLowerCase() !== name.toLowerCase()) continue
    try {
      const actual = at(join(inputs.folder, candidate))
      if (actual !== null && sameFile(expected, actual)) return candidate
    } catch {
      /* One unrelated unreadable entry does not hide the rest of the catalog. */
    }
  }
  return name
}

function catalog(inputs: MethodLibraryInputs, seams: MethodReadSeams): Catalog {
  const expectedFolder = folderAt(inputs)
  const found = new Set<string>()
  let scanned = 0
  let truncated = false
  const directory = opendirSync(inputs.folder)
  try {
    for (;;) {
      const entry = directory.readSync()
      if (entry === null) break
      if (scanned++ >= METHOD_LIBRARY_SCAN_LIMIT) {
        truncated = true
        break
      }
      if (/\.md$/i.test(entry.name)) found.add(entry.name)
    }
  } finally {
    directory.closeSync()
  }
  if (!sameFile(expectedFolder, folderAt(inputs))) throw new Refused('link')
  const indexName = actualName(inputs, found, SAVED_METHODS_INDEX)
  let index: FileImage | null = null
  let indexProblem: MethodProblem | undefined
  try {
    index = image(inputs, indexName, INDEX_BYTES, seams)
  } catch (error) {
    indexProblem = error instanceof Refused ? error.problem : 'unreadable'
  }
  if (index !== null) {
    found.add(indexName)
    if (!index.bytes.equals(Buffer.from(index.bytes.toString('utf8'), 'utf8')))
      indexProblem = 'unreadable'
  }
  const references = new Map<string, MethodReference[]>()
  let malformedLines = 0
  if (index !== null)
    for (const line of index.bytes.toString('utf8').split(/\r?\n/)) {
      if (!/^\s*[-*] /.test(line)) continue
      const parsed = parseSavedMethodLine(line)
      if (parsed === null) {
        malformedLines += 1
        continue
      }
      const name = actualName(inputs, found, parsed.file)
      const entries = references.get(name) ?? []
      entries.push({ title: parsed.title, when: parsed.when, verified: parsed.verified })
      references.set(name, entries)
      found.add(name)
    }
  const names = [...found].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const indexAt = names.indexOf(indexName)
  if (indexAt >= 0) {
    names.splice(indexAt, 1)
    names.unshift(indexName)
  }
  return {
    names,
    references,
    indexName,
    index,
    ...(indexProblem === undefined ? {} : { indexProblem }),
    malformedLines,
    truncated,
  }
}

function item(
  inputs: MethodLibraryInputs,
  read: Catalog,
  name: string,
  seams: MethodReadSeams,
): MethodLibraryItem {
  let bytes: FileImage | null = null
  let problem: MethodProblem | undefined
  const references = read.references.get(name) ?? []
  try {
    bytes =
      name === read.indexName
        ? read.index
        : image(inputs, name, SAVED_METHODS_MOST_METHOD_BYTES, seams)
    problem = name === read.indexName ? read.indexProblem : undefined
    if (bytes === null && problem === undefined) problem = 'missing'
  } catch (error) {
    problem = error instanceof Refused ? error.problem : 'unreadable'
  }
  const dangling = problem === 'missing' && references.length > 0
  return {
    key: keyOf(name, read.indexName),
    name,
    kind: name === read.indexName ? 'index' : dangling ? 'missing-reference' : 'method',
    references,
    fingerprint: bytes?.fingerprint ?? null,
    bytes: bytes?.bytes.length ?? null,
    canDelete:
      !read.truncated && read.indexProblem === undefined && (problem === undefined || dangling),
    ...(problem === undefined ? {} : { problem }),
  }
}

export function listSavedMethodLibrary(
  inputs: MethodLibraryInputs,
  now: number,
  offset = 0,
  limit = 50,
  seams: MethodReadSeams = {},
): MethodLibrary {
  const empty = {
    items: [],
    total: 0,
    offset,
    nextOffset: null,
    indexState: 'absent',
    indexFingerprint: null,
    malformedLines: 0,
    truncated: false,
    readAt: now,
  } as const
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return {
      ...empty,
      state: 'unavailable',
      indexState: 'problem',
      problem: 'unreadable',
      indexProblem: 'unreadable',
    }
  }
  try {
    const read = catalog(inputs, seams)
    const names = read.names.slice(offset, offset + limit)
    return {
      state: 'read',
      items: names.map((name) => item(inputs, read, name, seams)),
      total: read.names.length,
      offset,
      nextOffset: offset + names.length < read.names.length ? offset + names.length : null,
      indexState:
        read.indexProblem !== undefined ? 'problem' : read.index === null ? 'absent' : 'ok',
      ...(read.indexProblem === undefined ? {} : { indexProblem: read.indexProblem }),
      indexFingerprint: read.index?.fingerprint ?? null,
      malformedLines: read.malformedLines,
      truncated: read.truncated,
      readAt: now,
    }
  } catch (error) {
    const problem = error instanceof Refused ? error.problem : 'unreadable'
    return problem === 'missing'
      ? { ...empty, state: 'missing' }
      : { ...empty, state: 'unavailable', indexState: 'problem', indexProblem: problem, problem }
  }
}

export function readSavedMethodBody(
  inputs: MethodLibraryInputs,
  key: string,
  seams: MethodReadSeams = {},
): MethodBody {
  try {
    const read = catalog(inputs, seams)
    const name = read.names.find((one) => keyOf(one, read.indexName) === key)
    if (name === undefined) return { ok: false, problem: 'missing' }
    const found = image(
      inputs,
      name,
      name === read.indexName ? INDEX_BYTES : SAVED_METHODS_MOST_METHOD_BYTES,
      seams,
    )
    if (found === null) return { ok: false, problem: 'missing' }
    return {
      ok: true,
      key,
      text: found.bytes.toString('utf8'),
      bytes: found.bytes.length,
      fingerprint: found.fingerprint,
    }
  } catch (error) {
    return { ok: false, problem: error instanceof Refused ? error.problem : 'unreadable' }
  }
}
