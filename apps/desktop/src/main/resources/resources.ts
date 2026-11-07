import { refusalReason } from '../../shared/refusals'
import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createFreshFile, openNotThroughALink } from '@brobot2/runtime'
import type { RailPermanence, RefusalRemedy } from '../../shared/refusals'
import {
  CONTENT_OF_FORM,
  formOfName,
  type DocumentContent,
  type DocumentForm,
  type DrawnAs,
} from '../../shared/documents'
import { PIECE_TITLE_CHARS } from '../../shared/piece-called'
import { filesystemSpelling } from '../runtime/scratch-cwd'

const RESOURCES_DIRNAME = 'resources'

export function resourcesRoot(userData: string): string {
  return join(userData, RESOURCES_DIRNAME)
}

export const RESOURCE_RAILS = [
  'resource-unreadable',
  'resource-not-a-form-this-app-keeps',
  'resource-too-large',
  'resource-empty',
  'resource-not-text',
  'resource-could-not-be-kept',
  'no-such-resource',
  'resource-bytes-missing',
  'resource-bytes-unreadable',
  'resource-bytes-changed',
  'resource-store-unavailable',
] as const

export type ResourceRail = (typeof RESOURCE_RAILS)[number]

const RESOURCE_PERMANENCE: Readonly<Record<ResourceRail, RailPermanence>> = {
  'resource-unreadable': 'while-this-holds',
  'resource-not-a-form-this-app-keeps': 'permanent',
  'resource-too-large': 'while-this-holds',
  'resource-empty': 'while-this-holds',
  'resource-not-text': 'while-this-holds',
  'resource-could-not-be-kept': 'until-a-person-changes-it',
  'no-such-resource': 'permanent',
  'resource-bytes-missing': 'permanent',
  'resource-bytes-unreadable': 'until-a-person-changes-it',
  'resource-bytes-changed': 'permanent',
  'resource-store-unavailable': 'until-a-person-changes-it',
}

const RESOURCE_REMEDY: Readonly<Record<ResourceRail, RefusalRemedy | null>> = {
  'resource-unreadable': 'offer-a-workspace-markdown-file-that-reads',
  'resource-not-a-form-this-app-keeps': null,
  'resource-too-large': 'offer-a-workspace-markdown-file-that-reads',
  'resource-empty': 'offer-a-workspace-markdown-file-that-reads',
  'resource-not-text': 'offer-a-workspace-markdown-file-that-reads',
  'resource-could-not-be-kept': null,
  'no-such-resource': null,
  'resource-bytes-missing': null,
  'resource-bytes-unreadable': null,
  'resource-bytes-changed': null,
  'resource-store-unavailable': null,
}

export function resourceRemedyOf(rail: ResourceRail): RefusalRemedy | null {
  return RESOURCE_REMEDY[rail]
}

const OFFER_ANOTHER_FILE =
  ' Write a file and offer that path instead — one of the types this app holds, not empty, and no larger than a file of that type may be.'

const KEEP_IT_AND_NAME_ITS_PATH =
  ' Keep it where it is and name its full path in what you write. Use the assigned folder.'

const RESOURCE_SENTENCES: Readonly<Record<ResourceRail, string>> = {
  'resource-unreadable':
    'no readable file is there, so nothing was kept and nothing was recorded.' + OFFER_ANOTHER_FILE,
  'resource-not-a-form-this-app-keeps':
    'this app does not keep files of that type, so nothing was kept and nothing was recorded.' +
    KEEP_IT_AND_NAME_ITS_PATH,
  'resource-too-large':
    'that file is too large, so nothing was kept and nothing was recorded.' + OFFER_ANOTHER_FILE,
  'resource-empty':
    'that file is empty, and an empty file is not a resource, so nothing was kept and nothing was recorded.' +
    OFFER_ANOTHER_FILE,
  'resource-not-text':
    'that file is not UTF-8 text, so nothing was kept and nothing was recorded.' +
    OFFER_ANOTHER_FILE,
  'resource-could-not-be-kept':
    'this app could not store that file, so nothing was kept and nothing was recorded. Trying again will not help until a person sorts out what stopped it.',
  'no-such-resource':
    'check the id in the reply or piece record. There is no resource by the id you gave, so nothing was returned and retrying that id cannot work.',
  'resource-bytes-missing':
    'ask a person to restore the file. That resource is recorded, but its file is missing, so nothing was returned and retrying this id alone cannot recover it.',
  'resource-bytes-unreadable':
    'that resource could not be read, so nothing was returned. Asking again will not help until a person has looked at what stands where this app keeps it.',
  'resource-bytes-changed':
    'ask a person to check or restore the file. It no longer matches the hash kept for this resource, so nothing was returned and retrying this id alone cannot repair it.',
  'resource-store-unavailable':
    'this app has nowhere to keep resources, so nothing was kept or read. Trying again will not help until a person sets it up.',
}

export interface ResourceRefusal {
  readonly outcome: 'refused'
  readonly rail: ResourceRail
  readonly permanence: RailPermanence
  readonly retryable: boolean
  readonly reason: string
  readonly remedy: RefusalRemedy | null
  readonly detail: Readonly<Record<string, unknown>>
}

export function refuseResource(
  rail: ResourceRail,
  detail: Readonly<Record<string, unknown>> = {},
): ResourceRefusal {
  const permanence = RESOURCE_PERMANENCE[rail]
  return {
    outcome: 'refused',
    rail,
    permanence,
    retryable: permanence === 'while-this-holds',
    reason: refusalReason(RESOURCE_SENTENCES[rail]),
    remedy: resourceRemedyOf(rail),
    detail,
  }
}

export const MAX_TEXT_RESOURCE_BYTES = 1_048_576

export const MOST_BYTES_OF_FORM: Readonly<Record<DocumentForm, number>> = {
  markdown: MAX_TEXT_RESOURCE_BYTES,
  page: MAX_TEXT_RESOURCE_BYTES,
  image: 16_777_216,
  pdf: 16_777_216,
}

export const MOST_BYTES_OF_ANY_FORM = Math.max(...Object.values(MOST_BYTES_OF_FORM))

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

export function resolveResource(
  base: string,
  spelled: string,
):
  | { readonly ok: true; readonly realPath: string }
  | { readonly ok: false; readonly refusal: ResourceRefusal } {
  const lexicalPath = isAbsolute(spelled) ? resolve(spelled) : resolve(base, spelled)
  try {
    return { ok: true, realPath: realpathSync.native(lexicalPath) }
  } catch {
    return { ok: false, refusal: refuseResource('resource-unreadable', { path: spelled }) }
  }
}

export type OfferedResource =
  | {
      readonly ok: true
      readonly name: string
      readonly form: DocumentForm
      readonly bytes: Buffer
      readonly sha256: string
    }
  | { readonly ok: false; readonly refusal: ResourceRefusal }

export type OfferedFile = Extract<OfferedResource, { readonly ok: true }>

export function readOfferedResource(
  realPath: string,
  suppliedPath: string = realPath,
): OfferedResource {
  const name = basename(realPath)
  const form = formOfName(name)
  if (form === null) {
    return {
      ok: false,
      refusal: refuseResource('resource-not-a-form-this-app-keeps', { path: realPath }),
    }
  }
  let fd: number
  try {
    fd = openNotThroughALink(realPath, constants.O_RDONLY | constants.O_NONBLOCK)
  } catch {
    return { ok: false, refusal: refuseResource('resource-unreadable', { path: realPath }) }
  }
  let bytes: Buffer
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) {
      return { ok: false, refusal: refuseResource('resource-unreadable', { path: realPath }) }
    }
    const limit = MOST_BYTES_OF_FORM[form]
    if (stat.size > limit) {
      return {
        ok: false,
        refusal: refuseResource('resource-too-large', {
          path: suppliedPath,
          bytes: stat.size,
          limit,
        }),
      }
    }
    bytes = readBounded(fd, stat.size)
  } catch {
    return { ok: false, refusal: refuseResource('resource-unreadable', { path: realPath }) }
  } finally {
    closeQuietly(fd)
  }
  if (bytes.length === 0) {
    return { ok: false, refusal: refuseResource('resource-empty', { path: realPath }) }
  }
  if (CONTENT_OF_FORM[form] !== 'not-for-a-model') {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      return { ok: false, refusal: refuseResource('resource-not-text', { path: realPath }) }
    }
  }
  return { ok: true, name, form, bytes, sha256: sha256Hex(bytes) }
}

function readBounded(fd: number, size: number): Buffer {
  const bytes = Buffer.alloc(size)
  let filled = 0
  while (filled < bytes.length) {
    const got = readSync(fd, bytes, filled, bytes.length - filled, filled)
    if (got === 0) break
    filled += got
  }
  return bytes.subarray(0, filled)
}

function closeQuietly(fd: number): void {
  try {
    closeSync(fd)
  } catch {
    // the bytes are already in hand; a failed close is not a failed read
  }
}

type OwnFileRead = { readonly ok: true; readonly bytes: Buffer } | { readonly ok: false }

function readOwnFile(path: string): OwnFileRead {
  let fd: number
  try {
    fd = openNotThroughALink(path, constants.O_RDONLY | constants.O_NONBLOCK)
  } catch {
    return { ok: false }
  }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > MOST_BYTES_OF_ANY_FORM) return { ok: false }
    const read = readBounded(fd, stat.size)
    return { ok: true, bytes: read }
  } catch {
    return { ok: false }
  } finally {
    closeQuietly(fd)
  }
}

function somethingStandsAt(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

function isOneSegment(name: string): boolean {
  return (
    name.length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes(sep) &&
    !name.includes('\0')
  )
}

const SHA256_HEX = /^[0-9a-f]{64}$/

export type KeepProblem = 'write-failed' | 'something-else-is-at-that-name'

export function keepResource(
  root: string,
  offered: { readonly bytes: Buffer; readonly sha256: string; readonly name: string },
): { readonly ok: true } | { readonly ok: false; readonly problem: KeepProblem } {
  if (!SHA256_HEX.test(offered.sha256) || !isOneSegment(offered.name)) {
    return { ok: false, problem: 'write-failed' }
  }
  const folder = join(root, offered.sha256)
  const kept = join(folder, offered.name)
  const temporary = join(root, `.${offered.sha256}.${randomBytes(8).toString('hex')}.part`)
  try {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    try {
      mkdirSync(folder, { mode: 0o700 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const standing = lstatSync(folder)
    if (!standing.isDirectory() || standing.isSymbolicLink()) {
      return { ok: false, problem: 'something-else-is-at-that-name' }
    }
    const already = readOwnFile(kept)
    if (already.ok && sha256Hex(already.bytes) === offered.sha256) return { ok: true }
    if (somethingStandsAt(kept)) return { ok: false, problem: 'something-else-is-at-that-name' }
    writeOwn(temporary, offered.bytes)
    renameSync(temporary, kept)
    return { ok: true }
  } catch {
    discard(temporary)
    return { ok: false, problem: 'write-failed' }
  }
}

function writeOwn(path: string, bytes: Buffer): void {
  const fd = createFreshFile(path)
  try {
    let written = 0
    while (written < bytes.length) written += writeSync(fd, bytes, written)
  } finally {
    closeSync(fd)
  }
}

function discard(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    // nothing there, or nothing we can do about it
  }
}

export interface KeptResource {
  readonly resource: string
  readonly name: string
  readonly sha256: string
}

export type ResourceBytesResult =
  | {
      readonly ok: true
      readonly form: DocumentForm
      readonly bytes: Buffer
      readonly content: DocumentContent
    }
  | { readonly ok: false; readonly refusal: ResourceRefusal }

export function resourceBytes(root: string, row: KeptResource): ResourceBytesResult {
  const refused = (rail: ResourceRail): ResourceBytesResult => ({
    ok: false,
    refusal: refuseResource(rail, { resource: row.resource }),
  })
  if (!SHA256_HEX.test(row.sha256) || !isOneSegment(row.name)) {
    return refused('resource-bytes-unreadable')
  }
  const lexicalRoot = resolve(root)
  const lexicalPath = join(lexicalRoot, row.sha256, row.name)
  if (!within(lexicalRoot, lexicalPath)) return refused('resource-bytes-unreadable')
  let realPath: string
  try {
    realPath = realpathSync.native(lexicalPath)
  } catch {
    return refused('resource-bytes-missing')
  }
  if (!within(filesystemSpelling(lexicalRoot), realPath)) {
    return refused('resource-bytes-unreadable')
  }
  const read = readOwnFile(lexicalPath)
  if (!read.ok) return refused('resource-bytes-unreadable')
  const form = formOfName(row.name)
  if (form === null) return refused('resource-bytes-unreadable')
  return { ok: true, form, bytes: read.bytes, content: contentOf(form, read.bytes) }
}

export const MOST_BYTES_A_WINDOW_DRAWS = Math.max(MOST_BYTES_OF_FORM.image, MOST_BYTES_OF_FORM.pdf)

export const MOST_PIXELS_A_WINDOW_DRAWS = 8192 * 8192

export function pictureSize(
  drawnAs: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
  bytes: Buffer,
): { readonly width: number; readonly height: number } | null {
  if (drawnAs === 'image/jpeg') return jpegSize(bytes)
  const named = (from: number): string => bytes.toString('latin1', from, from + 4)
  if (drawnAs === 'image/png') {
    if (bytes.length < 24 || named(12) !== 'IHDR') return null
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  if (drawnAs === 'image/gif') {
    return bytes.length < 10
      ? null
      : { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
  }
  if (bytes.length < 30) return null
  if (named(12) === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
  }
  if (named(12) === 'VP8L' && bytes[20] === 0x2f) {
    const packed = bytes.readUInt32LE(21)
    return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 }
  }
  if (named(12) === 'VP8X') {
    return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 }
  }
  return null
}

function jpegSize(bytes: Buffer): { readonly width: number; readonly height: number } | null {
  let at = 2
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null
    const marker = bytes[at + 1] ?? 0
    if (marker === 0xff) {
      at += 1
    } else if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2
    } else if (marker === 0xd9 || marker === 0xda) {
      return null
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (at + 9 > bytes.length) return null
      return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) }
    } else {
      const length = bytes.readUInt16BE(at + 2)
      if (length < 2) return null
      at += 2 + length
    }
  }
  return null
}

export function drawnAsOfBytes(form: 'image' | 'pdf', bytes: Buffer): DrawnAs | null {
  const opensWith = (signature: readonly number[], at = 0): boolean =>
    bytes.length >= at + signature.length && signature.every((one, i) => bytes[at + i] === one)
  const ascii = (text: string): number[] => [...text].map((one) => one.charCodeAt(0))
  if (form === 'pdf') return bytes.subarray(0, 1024).includes('%PDF-') ? 'application/pdf' : null
  if (opensWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (opensWith([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (opensWith(ascii('GIF87a')) || opensWith(ascii('GIF89a'))) return 'image/gif'
  if (opensWith(ascii('RIFF')) && opensWith(ascii('WEBP'), 8)) return 'image/webp'
  const from = opensWith([0xef, 0xbb, 0xbf]) ? 3 : 0
  return opensAsAnSvg(bytes.toString('latin1', from)) ? 'image/svg+xml' : null
}

function opensAsAnSvg(text: string): boolean {
  const past = (close: string, from: number): number => {
    const found = text.indexOf(close, from)
    return found < 0 ? -1 : found + close.length
  }
  let at = 0
  while (at >= 0 && at < text.length) {
    if (' \t\r\n'.includes(text.charAt(at))) {
      at += 1
    } else if (text.startsWith('<?', at)) {
      at = past('?>', at + 2)
    } else if (text.startsWith('<!--', at)) {
      at = past('-->', at + 4)
    } else if (text.slice(at, at + 9).toUpperCase() === '<!DOCTYPE') {
      const close = text.indexOf('>', at)
      const subset = text.indexOf('[', at)
      const from = subset >= 0 && (close < 0 || subset < close) ? text.indexOf(']', subset) : at
      at = from < 0 ? -1 : past('>', from)
    } else {
      return /^<svg[\s/>]/.test(text.slice(at, at + 5))
    }
  }
  return false
}

export type KeptPicture =
  | { readonly ok: true; readonly drawnAs: DrawnAs; readonly bytes: Uint8Array<ArrayBuffer> }
  | {
      readonly ok: false
      readonly reason:
        'not-a-picture-or-pdf' | 'too-large' | 'unreadable' | 'changed' | 'not-what-its-name-says'
    }
  | {
      readonly ok: false
      readonly reason: 'too-many-pixels'
      readonly width: number
      readonly height: number
    }

export function keptPictureOrPdf(
  root: string,
  row: KeptResource & { readonly bytes: number },
): KeptPicture {
  const form = formOfName(row.name)
  if (form !== 'image' && form !== 'pdf') return { ok: false, reason: 'not-a-picture-or-pdf' }
  if (row.bytes > MOST_BYTES_A_WINDOW_DRAWS) return { ok: false, reason: 'too-large' }
  const read = resourceBytes(root, row)
  if (!read.ok) {
    return { ok: false, reason: 'unreadable' }
  }
  const drawnAs = drawnAsOfBytes(form, read.bytes)
  if (drawnAs === null) return { ok: false, reason: 'not-what-its-name-says' }
  if (drawnAs !== 'image/svg+xml' && drawnAs !== 'application/pdf') {
    const size = pictureSize(drawnAs, read.bytes)
    if (size === null) return { ok: false, reason: 'not-what-its-name-says' }
    if (size.width * size.height > MOST_PIXELS_A_WINDOW_DRAWS) {
      return { ok: false, reason: 'too-many-pixels', width: size.width, height: size.height }
    }
  }
  return { ok: true, drawnAs, bytes: new Uint8Array(read.bytes) }
}

export function keptFileToShow(
  root: string,
  row: KeptResource,
):
  | { readonly ok: true; readonly path: string; readonly changed: boolean }
  | { readonly ok: false; readonly reason: 'gone' | 'unreadable' } {
  const read = resourceBytes(root, row)
  if (!read.ok && read.refusal.rail === 'resource-bytes-missing') {
    return { ok: false, reason: 'gone' }
  }
  if (!read.ok) {
    return { ok: false, reason: 'unreadable' }
  }
  return { ok: true, path: join(resolve(root), row.sha256, row.name), changed: false }
}

function contentOf(form: DocumentForm, bytes: Buffer): DocumentContent {
  switch (CONTENT_OF_FORM[form]) {
    case 'markdown':
      return { as: 'markdown', text: bytes.toString('utf8') }
    case 'source':
      return { as: 'source', text: bytes.toString('utf8') }
    case 'not-for-a-model':
      return {
        as: 'not-for-a-model',
        because: form === 'image' ? 'a-picture-is-not-text' : 'a-pdf-is-not-text',
      }
  }
}

export const RESOURCE_TITLE_CHARS = PIECE_TITLE_CHARS

const TITLE_OF_FORM: Readonly<Record<DocumentForm, ((text: string) => string | null) | null>> = {
  markdown: markdownTitle,
  page: pageTitle,
  image: null,
  pdf: null,
}

export function resourceTitle(file: Pick<OfferedFile, 'name' | 'form' | 'bytes'>): string {
  return titleBy(TITLE_OF_FORM[file.form], file)
}

export function resourceTitleBeforeFrontMatter(
  file: Pick<OfferedFile, 'name' | 'form' | 'bytes'>,
): string {
  return titleBy(file.form === 'markdown' ? markdownHeading : TITLE_OF_FORM[file.form], file)
}

function titleBy(
  titleOf: ((text: string) => string | null) | null,
  file: Pick<OfferedFile, 'name' | 'bytes'>,
): string {
  const found = titleOf === null ? null : titleOf(new TextDecoder('utf-8').decode(file.bytes))
  return found === null ? file.name : cappedTitle(found)
}

function cappedTitle(title: string): string {
  if (title.length <= RESOURCE_TITLE_CHARS) return title
  let end = RESOURCE_TITLE_CHARS - 1
  const last = title.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return `${title.slice(0, end)}…`
}

function markdownTitle(text: string): string | null {
  const lines = text.split(/\r\n|\r|\n/)
  return frontMatterTitle(lines) ?? firstHeading(lines)
}

function markdownHeading(text: string): string | null {
  return firstHeading(text.split(/\r\n|\r|\n/))
}

function firstHeading(lines: readonly string[]): string | null {
  let fence: string | null = null
  for (const line of lines) {
    if (fence !== null) {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1]
      if (closing !== undefined && closing[0] === fence[0] && closing.length >= fence.length) {
        fence = null
      }
      continue
    }
    const opening = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/.exec(line)?.[1]
    if (opening !== undefined) {
      fence = opening
      continue
    }
    const heading = /^ {0,3}#(?:[ \t]+(.*))?$/s.exec(line)
    if (heading === null) continue
    const said = (heading[1] ?? '').trimEnd()
    let end = said.length
    while (end > 0 && said[end - 1] === '#') end -= 1
    const kept =
      end === 0 || said[end - 1] === ' ' || said[end - 1] === '\t' ? said.slice(0, end) : said
    return kept.trim() || null
  }
  return null
}

const YAML_KEY =
  /^(?:(?![-?][ \t])[^\s#:'"[\]{},&*!|>%@`](?:[^:]|:(?![ \t]|$))*|(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*')[ \t]*):(?:[ \t]|$)/

function frontMatterTitle(lines: readonly string[]): string | null {
  if (!/^---[ \t]*$/.test(lines[0] ?? '')) return null
  const close = lines.findIndex((line, at) => at > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(line))
  if (close === -1) return null
  const block = lines.slice(1, close)
  const isYaml = block.every(
    (line) => /^[ \t]/.test(line) || /^\s*(?:#.*)?$/.test(line) || YAML_KEY.test(line),
  )
  if (!isYaml) return null
  for (const line of block) {
    const said = /^title:(?:[ \t](.*))?$/.exec(line)
    if (said === null) continue
    const raw = (said[1] ?? '').trim()
    const quoted = quotedValue(raw)
    if (quoted !== null) return quoted.trim() || null
    const comment = raw.search(/(?:^|[ \t])#/)
    const value = (comment === -1 ? raw : raw.slice(0, comment)).trim()
    if (/^[|>]/.test(value) || value === '~' || value === 'null') return null
    return value || null
  }
  return null
}

function quotedValue(raw: string): string | null {
  const quote = raw[0]
  if (quote !== '"' && quote !== "'") return null
  let inside = ''
  for (let at = 1; at < raw.length; at += 1) {
    const char = raw[at]
    const next = raw[at + 1]
    if (quote === '"' && char === '\\' && (next === '"' || next === '\\')) {
      inside += next
      at += 1
    } else if (char === quote && quote === "'" && next === "'") {
      inside += "'"
      at += 1
    } else if (char === quote) {
      return /^(?:[ \t]+#.*)?[ \t]*$/.test(raw.slice(at + 1)) ? inside : null
    } else {
      inside += char
    }
  }
  return null
}

function pageTitle(text: string): string | null {
  const markup = /<!--|<(title|script|style|svg|math)(?=[\s/>])/gi
  for (let found = markup.exec(text); found !== null; found = markup.exec(text)) {
    const name = found[1]?.toLowerCase()
    if (name === 'title') return titleText(text, found.index)
    const ends =
      name === undefined
        ? commentEnds(text, found.index)
        : name === 'script' || name === 'style'
          ? rawTextEnds(text, name, markup.lastIndex)
          : drawingEnds(text, name, found.index)
    if (ends < 0) return null
    markup.lastIndex = ends
  }
  return null
}

function titleText(text: string, at: number): string | null {
  const tagEnds = text.indexOf('>', at)
  if (tagEnds < 0) return null
  const closing = /<\/title\s*>/gi
  closing.lastIndex = tagEnds + 1
  const closed = closing.exec(text)
  if (closed === null) return null
  return (
    decodeEntities(text.slice(tagEnds + 1, closed.index))
      .replace(/\s+/g, ' ')
      .trim() || null
  )
}

function commentEnds(text: string, at: number): number {
  const closes = text.indexOf('-->', at + 2)
  return closes < 0 ? -1 : closes + 3
}

function rawTextEnds(text: string, name: string, from: number): number {
  const closing = new RegExp(`</${name}(?=[\\s/>])`, 'gi')
  closing.lastIndex = from
  const closed = closing.exec(text)
  if (closed === null) return -1
  const tagEnds = text.indexOf('>', closed.index)
  return tagEnds < 0 ? -1 : tagEnds + 1
}

function drawingEnds(text: string, name: string, at: number): number {
  const tags = new RegExp(`<(/?)${name}(?=[\\s/>])`, 'gi')
  tags.lastIndex = at
  let depth = 0
  for (let tag = tags.exec(text); tag !== null; tag = tags.exec(text)) {
    const tagEnds = text.indexOf('>', tag.index)
    if (tagEnds < 0) return -1
    if (tag[1] === '/') depth -= 1
    else if (text[tagEnds - 1] !== '/') depth += 1
    if (depth === 0) return tagEnds + 1
    tags.lastIndex = tagEnds + 1
  }
  return -1
}

const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
  ['mdash', '—'],
  ['ndash', '–'],
  ['hellip', '…'],
  ['middot', '·'],
  ['bull', '•'],
  ['lsquo', '‘'],
  ['rsquo', '’'],
  ['ldquo', '“'],
  ['rdquo', '”'],
  ['laquo', '«'],
  ['raquo', '»'],
  ['copy', '©'],
  ['reg', '®'],
  ['trade', '™'],
])

function decodeEntities(text: string): string {
  return text.replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]+);/g, (whole, body: string) => {
    if (!body.startsWith('#')) return NAMED_ENTITIES.get(body) ?? whole
    const hex = body[1] === 'x' || body[1] === 'X'
    const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
      ? String.fromCodePoint(code)
      : whole
  })
}
