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

/**
 * 🔴 **D-016 · where this app keeps a piece's resources, and the only code that touches their
 * bytes** — a file a conversation hands over for a piece: its giver's inputs (`give_work`,
 * `update_work`) or what its owner made (`update_work`, `reply_to_parent`), copied byte for byte
 * and never changed.
 *
 * ⚑ **One place per content**: `<userData>/resources/<sha256>/<name>`. The hash is of the bytes as
 * they were read, and the name is the file's own; the `work_resource` row names both, so the file is
 * found from its row and checked against it on every read.
 *
 * ⛔ **No canonical form and no ingest state machine.** The bytes are kept as they arrived — a hash
 * is the identity of THOSE bytes — and the file is written to a temporary name and renamed into
 * place before its row is written. A crash between the two leaves a file with no row, which nothing
 * reads and which costs nothing; the reverse, a row with no file, cannot be produced by this order.
 *
 * ⚑ **Lifted from the document registry this replaced** (380, 517, 521, 635): the allow-list of
 * forms, the per-form size bound, the `O_NOFOLLOW | O_NONBLOCK` reads and the placement of a row's
 * file inside the tree it is kept in are theirs, unchanged in what they refuse.
 *
 * ⚑ **D-026 · and the title a kept file is given** ({@link resourceTitle}), read off the same
 * bytes as they are kept.
 */

/** The directory under Electron's `userData` that holds every resource. */
export const RESOURCES_DIRNAME = 'resources'

/**
 * ⚑ **The resources tree, inside `userData`** — the one place this app writes a resource, and the
 * one place it reads one back from. ⛔ Not a piece owner's working folder: a resource is the trail
 * of a piece, and a trail must not change or vanish with somebody's folder.
 */
export function resourcesRoot(userData: string): string {
  return join(userData, RESOURCES_DIRNAME)
}

/**
 * ⛔ **Every way keeping or reading a resource can be refused** — a vocabulary of its own, in the
 * payload every rail vocabulary shares (`341`), so a model meets one grammar everywhere.
 */
export const RESOURCE_RAILS = [
  /** Nothing is there, it will not resolve, or it is not a regular file. */
  'resource-unreadable',
  /**
   * ⛔ **Not a form this app keeps** — its name's extension is not on `FORM_OF_EXTENSION`'s
   * allow-list, so it was never going to be kept, whatever is in it.
   */
  'resource-not-a-form-this-app-keeps',
  /** Bigger than its form may be ({@link MOST_BYTES_OF_FORM}). */
  'resource-too-large',
  /** No bytes at all. ⚑ `work_resource_bytes_ck` refuses the same thing in the database. */
  'resource-empty',
  /** A Markdown file or a page whose bytes are not UTF-8: a text a person cannot read is not text. */
  'resource-not-text',
  /**
   * 🔴 **The bytes could not be put where this app keeps them** — a full disk, a permission, or
   * something already standing at that name that is not these bytes. A person's to clear.
   */
  'resource-could-not-be-kept',
  /**
   * ⛔ **No resource has that id** — and nothing else: every agent may read every resource, so there
   * is no *not yours* for this word to fold (HO-057's ruling, carried from the documents it replaced).
   * An id from before D-016 (`doc:…`) names none.
   */
  'no-such-resource',
  /** Its row is here and nothing is where this app keeps its file. */
  'resource-bytes-missing',
  /**
   * ⚑ **Its row is here and what stands where its file is kept could not be read** — a directory, a
   * FIFO, a symlink, a permission, or a place outside the tree a hand-edited row named. ⛔ Its own
   * word beside {@link 'resource-bytes-missing'}, for `517`'s reason: *the file is gone* about a file
   * that is sitting there sends its reader looking for something that is not lost.
   */
  'resource-bytes-unreadable',
  /** 🔴 The file where this app keeps it no longer hashes to what was kept. */
  'resource-bytes-changed',
  /**
   * ⛔ **This app has nowhere to keep resources** — a host wired without a resources tree. It
   * refuses rather than picking a directory.
   */
  'resource-store-unavailable',
] as const

export type ResourceRail = (typeof RESOURCE_RAILS)[number]

/**
 * ⚑ **`permanent` means *the same arguments will fail forever*** — `341`'s reading. A path's
 * extension is a property of the argument, so that one is permanent; a file that is missing, empty,
 * too big or not text can be rewritten, so those are not. ⚠️ The ones about what this app holds are
 * facts about its own disk: a person's to repair where a person can, permanent where no call can.
 */
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

/**
 * ⚑ **425 · the act a caller may take, for the four rails about a file it offered** — one act,
 * because what differs between them is a fact about the file that was refused, and each rail's own
 * sentence says which. ⛔ Every other rail carries none: `shared/refusals.ts`' biconditional — a rail
 * carries an act if and only if this app can retry it.
 */
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

/** ⛔ **What a caller may do instead, or `null` because this app knows of nothing** (425). */
export function resourceRemedyOf(rail: ResourceRail): RefusalRemedy | null {
  return RESOURCE_REMEDY[rail]
}

/**
 * ⚑ **The act for a file that was refused for what it IS** — another file that satisfies every
 * listed requirement, never the same path again. ⛔ It names an artifact and not a verb (`422` §3).
 */
const OFFER_ANOTHER_FILE =
  ' Write a file and offer that path instead — one of the types this app holds, not empty, and no larger than a file of that type may be.'

/**
 * 🔴 **The act for a file this app will never keep**, in the PO's words (`HO-097` §1.4): the content
 * is the deliverable and nothing is wrong with it, so keep it and name its path. ⛔ The second
 * sentence is the core's folder clause (`factory-text.ts`, `CORE_TEXT`) said on its own, and
 * `the-last-folder-words.test.ts` holds the two equal.
 */
const KEEP_IT_AND_NAME_ITS_PATH =
  ' Keep it where it is and name its full path in what you write. Use the assigned folder.'

/**
 * The sentence for each rail. ⛔ The five about a file an agent offered, and the one about keeping
 * it, are said only by the three doors that keep a file — a reply, a give's inputs and
 * `update_work`'s files — each of which records nothing when one is refused, so each says nothing
 * was recorded; the rest are said by `read_document` too, so they say only what was returned.
 */
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

/** A refusal in `341`'s shape, from this module's vocabulary. */
export interface ResourceRefusal {
  readonly outcome: 'refused'
  readonly rail: ResourceRail
  readonly permanence: RailPermanence
  readonly retryable: boolean
  readonly reason: string
  /** ⛔ **425 · the act left, as a word** — see {@link RESOURCE_REMEDY}. */
  readonly remedy: RefusalRemedy | null
  readonly detail: Readonly<Record<string, unknown>>
}

/** ⛔ `retryable` is DERIVED from `permanence` through one table, so the two cannot disagree. */
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

/**
 * 🔴 **How big a text resource may be — 1 MiB** (380 §4): about three hundred pages of prose, and the
 * bound on a string that crosses an IPC wire. ⚠️ Tests write the literal, because a test that spells
 * this constant plus one moves with it and pins nothing.
 */
export const MAX_TEXT_RESOURCE_BYTES = 1_048_576

/**
 * 🔴 **635 · how big a resource of each FORM may be** — text against prose, and 16 MiB for a picture
 * or a PDF: clear of a retina screenshot or a report with figures, and still a refusal for a video,
 * an archive or a disk image. ⚠️ A bound on ONE resource; nothing here bounds how many are kept.
 */
export const MOST_BYTES_OF_FORM: Readonly<Record<DocumentForm, number>> = {
  markdown: MAX_TEXT_RESOURCE_BYTES,
  page: MAX_TEXT_RESOURCE_BYTES,
  image: 16_777_216,
  pdf: 16_777_216,
}

/** ⛔ **The largest any resource may be**, DERIVED — the reader's bound moves with the writer's. */
export const MOST_BYTES_OF_ANY_FORM = Math.max(...Object.values(MOST_BYTES_OF_FORM))

/** SHA-256, lowercase hex — what `work_resource_sha256_ck` is written to admit. */
export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** At or inside `root`. `relative`, never `startsWith`: `/a/b-evil` is not inside `/a/b`. */
function within(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/**
 * 🔴 **The file an agent offered, resolved** (380 §2.2; `726` · R92) — absolute as given, relative
 * against the offering conversation's own folder, which is a resolution base and never a bound.
 * ⛔ `realpathSync.native`, so the name kept is the filesystem's own spelling (372).
 */
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

/** What a file offered as a resource turned out to be, ready to keep. */
export type OfferedResource =
  | {
      readonly ok: true
      /** The file's own name — `basename` of its real path, never a path. */
      readonly name: string
      readonly form: DocumentForm
      readonly bytes: Buffer
      readonly sha256: string
    }
  | { readonly ok: false; readonly refusal: ResourceRefusal }

/** A file that passed {@link readOfferedResource} — what {@link keepResource} keeps. */
export type OfferedFile = Extract<OfferedResource, { readonly ok: true }>

/**
 * 🔴 **Read a file offered as a resource, and say whether it may be kept** (380, 635; D-016).
 *
 * ⛔ **The extension first, with no syscall**; then `O_NOFOLLOW | O_NONBLOCK` — the leaf was already
 * resolved, and a FIFO would block Electron's main process — and `fstat` decides the shape, because a
 * directory opens fine on macOS. The SIZE is measured before a byte is taken, against the form's own
 * bound.
 *
 * ⚑ **Then the two rules about the bytes**: at least one of them, and for a Markdown file or a page,
 * UTF-8 — decoded with `fatal: true`, because `Buffer.toString('utf8')` silently substitutes U+FFFD.
 * ⛔ Nothing is changed: the bytes kept are the bytes read, and the hash is of exactly them.
 *
 * `suppliedPath` is the path as the agent spelled it. A file too large to keep is named by it, so an
 * agent offering several files can tell which one; it falls back to `realPath`.
 */
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

/**
 * ⚑ **At most `size` bytes, read through the descriptor** — bounded by the size a stat just gave,
 * so a file that grows between the two reads what was measured and no more.
 */
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

/** What was at a path this app itself wrote. */
type OwnFileRead =
  { readonly ok: true; readonly bytes: Buffer; readonly sha256: string } | { readonly ok: false }

/**
 * 🔴 **Read a file this app put there, and hash it.** ⛔ Every "no" is the same answer — absent, a
 * symlink, a directory, a FIFO, unreadable, or bigger than any resource may be — and the caller
 * decides what it means; the same three flags as {@link readOfferedResource}, for its reasons.
 */
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
    return { ok: true, bytes: read, sha256: sha256Hex(read) }
  } catch {
    return { ok: false }
  } finally {
    closeQuietly(fd)
  }
}

/** ⛔ *Is something standing at this name* — asked with `lstat`, which is not a read (521). */
function somethingStandsAt(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * ⛔ **A name this app would write as one path segment, and nothing else** — never empty, never
 * `.` or `..`, with no separator and no NUL. ⚑ Every name it keeps is the `basename` of a real path,
 * which passes; this is what a hand-edited row must pass too before it is joined to the tree.
 */
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

/** ⛔ The spelling `work_resource_sha256_ck` admits, asked again before it becomes a directory. */
const SHA256_HEX = /^[0-9a-f]{64}$/

/** Why the bytes could not be kept — the caller's word, carried in its refusal's detail. */
export type KeepProblem = 'write-failed' | 'something-else-is-at-that-name'

/**
 * 🔴 **Put these bytes where this app keeps them** — `<root>/<sha256>/<name>`.
 *
 * ⚑ **Written to a temporary name in `root`, then renamed into place**, so a reader never meets a
 * half-written file at the kept name: the temporary name is random and made new
 * ({@link createFreshFile}), so a link planted there fails the create rather than writing somewhere
 * else, on Windows too.
 *
 * ⚑ **The same bytes already there is a success** — two replies handing in one file keep one copy,
 * and the second is told the truth. ⛔ **Something ELSE there is a refusal and is never replaced**:
 * a kept file is an identity other rows point at, and replacing it would change what they name.
 *
 * ⛔ **The hash directory is asked with `lstat` before anything is renamed into it** (521): a symlink
 * standing at `<root>/<sha256>` would carry the rename out of the tree, and a `mkdir` that answered
 * `EEXIST` about it would say nothing.
 */
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
    if (already.ok && already.sha256 === offered.sha256) return { ok: true }
    if (somethingStandsAt(kept)) return { ok: false, problem: 'something-else-is-at-that-name' }
    writeOwn(temporary, offered.bytes)
    renameSync(temporary, kept)
    return { ok: true }
  } catch {
    discard(temporary)
    return { ok: false, problem: 'write-failed' }
  }
}

/** Write bytes at a path this app owns, through a descriptor rather than through a name. */
function writeOwn(path: string, bytes: Buffer): void {
  const fd = createFreshFile(path)
  try {
    let written = 0
    while (written < bytes.length) written += writeSync(fd, bytes, written)
  } finally {
    closeSync(fd)
  }
}

/** Best effort: a temporary file left behind is harmless, and nothing reads it. */
function discard(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    // nothing there, or nothing we can do about it
  }
}

/** What a kept resource's row names — {@link resourceBytes}' argument, as the row carries it. */
export interface KeptResource {
  readonly resource: string
  readonly name: string
  readonly sha256: string
}

/** What a read of a kept resource produces: what the bytes ARE, the bytes, and what a model gets. */
export type ResourceBytesResult =
  | {
      readonly ok: true
      readonly form: DocumentForm
      readonly bytes: Buffer
      readonly content: DocumentContent
    }
  | { readonly ok: false; readonly refusal: ResourceRefusal }

/**
 * 🔴 **The bytes of a kept resource — placed inside the root, then read, then re-hashed** — the one
 * reader both doors go through: an agent's `read_document` and a person's window (517's rule, one
 * boundary in one place).
 *
 * ⚑ **Placed first.** The row's hash and name are checked to be what this app writes, and the path
 * they make is asked two ways: lexically, with no syscall, and on its real spelling, which is what
 * catches a symlink pointing out. Then:
 *
 *  1. it does not resolve ⇒ `resource-bytes-missing` — absent, and only absent;
 *  2. it resolves outside the tree, or what is there cannot be read ⇒ `resource-bytes-unreadable`;
 *  3. it reads and the hash disagrees ⇒ `resource-bytes-changed`.
 *
 * ⛔ **The detail carries the resource id and nothing else**: a resource is reached by its id, and a
 * refusal that quoted the path would hand the tree's spelling over.
 */
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
  if (read.sha256 !== row.sha256) {
    return {
      ok: false,
      refusal: refuseResource('resource-bytes-changed', {
        resource: row.resource,
        kept: row.sha256,
        found: read.sha256,
      }),
    }
  }
  // ⛔ **The form is read off the kept name and never off a column** — a name this build has no word
  // for is a file it cannot say anything about, which is what `resource-bytes-unreadable` means.
  const form = formOfName(row.name)
  if (form === null) return refused('resource-bytes-unreadable')
  return { ok: true, form, bytes: read.bytes, content: contentOf(form, read.bytes) }
}

/**
 * 🔴 **D-032 · the most bytes a window is handed to draw one kept picture or PDF** — the bound they
 * are kept under ({@link MOST_BYTES_OF_FORM}, 16 MiB), so every picture and PDF this app holds can be
 * drawn and nothing bigger can be kept to begin with. ⚠️ A row that names more — a database edited by
 * hand — is answered `too-large` with its size and this bound before a byte is read, and the window
 * offers to show it in Finder instead.
 */
export const MOST_BYTES_A_WINDOW_DRAWS = Math.max(MOST_BYTES_OF_FORM.image, MOST_BYTES_OF_FORM.pdf)

/**
 * 🔴 **D-032 · the most pixels a window is handed to draw in one picture** — as many as an
 * 8192 × 8192 one, 64 megapixels: an 8K screen is 33.
 *
 * ⚠️ **Measured on this app's Electron (43.2.0)**: a PNG is decoded whole, however small its file,
 * so a 48 KB PNG that says it is 20000 × 20000 took the window's renderer to 2.0 GB drawn fitted, and
 * to 3.1 GB with 3.0 GB more on the GPU at its natural size. ⛔ So a PNG, JPEG, GIF or WebP past this
 * is answered `too-many-pixels` with its size, and the window offers Finder instead. ⚑ An SVG is
 * drawn at the size it is shown: one that says it is 100000 × 100000 left the renderer at 88 MB.
 */
export const MOST_PIXELS_A_WINDOW_DRAWS = 8192 * 8192

/**
 * ⚑ **D-032 · the width and height a PNG, JPEG, GIF or WebP says it is**, read off its header — PNG's
 * first chunk, GIF's screen, WebP's lossy, lossless or extended header, JPEG's frame header — or
 * `null` where that header is not there to read.
 */
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

/**
 * ⚑ **A JPEG's size, from its frame header** — the segments are walked by their lengths from the
 * start, past fill bytes and the markers that carry none, to the first frame header, which says
 * its lines and its samples per line. ⛔ A scan, or the end, before any frame header is `null`.
 */
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

/**
 * ⚑ **D-032 · what these bytes are, read off their own opening** — for a file whose name says it is
 * a picture or a PDF — or `null` when they are not one.
 *
 *  - A picture: PNG's eight bytes, JPEG's three, GIF87a or GIF89a, WebP's RIFF and WEBP; else text
 *    whose first element, past its prolog, is `<svg` ({@link opensAsAnSvg}), drawn as an SVG.
 *  - A PDF: `%PDF-` within its first 1024 bytes, where a PDF reader looks for it.
 *
 * ⚠️ **Off the bytes and not the extension**: a PNG saved as `.jpg` is a PNG and is drawn as one,
 * since every type here goes to an `<img>`, which runs nothing. ⛔ But a picture is never a PDF and a
 * PDF never a picture, and a page renamed `.png` or `.svg` is neither. ⚠️ A page renamed `.pdf` that
 * holds `%PDF-` near its top is handed over as a PDF, and the viewer cannot read it as one.
 */
export function drawnAsOfBytes(form: 'image' | 'pdf', bytes: Buffer): DrawnAs | null {
  const opensWith = (signature: readonly number[], at = 0): boolean =>
    bytes.length >= at + signature.length && signature.every((one, i) => bytes[at + i] === one)
  const ascii = (text: string): number[] => [...text].map((one) => one.charCodeAt(0))
  if (form === 'pdf') return bytes.subarray(0, 1024).includes('%PDF-') ? 'application/pdf' : null
  if (opensWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (opensWith([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (opensWith(ascii('GIF87a')) || opensWith(ascii('GIF89a'))) return 'image/gif'
  if (opensWith(ascii('RIFF')) && opensWith(ascii('WEBP'), 8)) return 'image/webp'
  // ⚑ Read as Latin-1, which every byte is, past a UTF-8 byte-order mark: the markup that decides
  // this is ASCII whether the file is UTF-8 or Latin-1, and the picture is the `<img>`'s to decode.
  const from = opensWith([0xef, 0xbb, 0xbf]) ? 3 : 0
  return opensAsAnSvg(bytes.toString('latin1', from)) ? 'image/svg+xml' : null
}

/**
 * ⚑ **Is `<svg` the first element of this text?** — past whitespace, processing instructions
 * (`<?xml …?>`), comments and a doctype, with or without its internal subset. ⛔ So a page that
 * merely holds an inline `<svg>` is not one. ⚠️ Each step moves forward by one search, so a text of
 * any size is read once; one that never closes what it opens is not an SVG.
 */
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
      // ⚠️ Case as written: an XML name is case-sensitive, and `<SVG>` is not an SVG.
      return /^<svg[\s/>]/.test(text.slice(at, at + 5))
    }
  }
  return false
}

/**
 * 🔴 **D-032 · a kept picture or PDF, for a window to draw** — or why not. ⚑ Through
 * {@link resourceBytes}, the one reader every door goes through: placed inside the tree, read, and
 * re-hashed against what was kept. ⚑ Then the type a window draws them as is read off the bytes
 * ({@link drawnAsOfBytes}) and set HERE, never by a name a window reads. ⛔ A Markdown file or a page
 * is not drawn this way — the text read is its door.
 */
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
  // ⚑ Measured off the row before a byte is read: a file too big to draw is never read to say so.
  if (row.bytes > MOST_BYTES_A_WINDOW_DRAWS) return { ok: false, reason: 'too-large' }
  const read = resourceBytes(root, row)
  // ⚠️ Gone and unreadable are one word, as the text read's: both end with a person going to look.
  if (!read.ok) {
    return {
      ok: false,
      reason: read.refusal.rail === 'resource-bytes-changed' ? 'changed' : 'unreadable',
    }
  }
  const drawnAs = drawnAsOfBytes(form, read.bytes)
  if (drawnAs === null) return { ok: false, reason: 'not-what-its-name-says' }
  // ⚑ A picture decoded whole is held to a number of pixels; an SVG is drawn at the size it is
  // shown, and a PDF page by its viewer.
  if (drawnAs !== 'image/svg+xml' && drawnAs !== 'application/pdf') {
    const size = pictureSize(drawnAs, read.bytes)
    if (size === null) return { ok: false, reason: 'not-what-its-name-says' }
    if (size.width * size.height > MOST_PIXELS_A_WINDOW_DRAWS) {
      return { ok: false, reason: 'too-many-pixels', width: size.width, height: size.height }
    }
  }
  // ⚑ A copy the size of the file, owning its whole buffer: what crosses to the window is exactly
  // these bytes, typed as a window's `Blob` takes them.
  return { ok: true, drawnAs, bytes: new Uint8Array(read.bytes) }
}

/**
 * 🔴 **D-032 · where a kept file is, for Finder** — `<root>/<sha256>/<name>`, as {@link keepResource}
 * wrote it — or why it is not shown.
 *
 * ⛔ **Through {@link resourceBytes} first**, which holds the row's file inside the tree: a row naming
 * anywhere else, a link, something that is not a plain file, or one bigger than any kept file may be
 * is `unreadable`, and nothing absent is shown (`gone`). ⚠️ **A file whose bytes changed IS shown,
 * and says so** — it is where this app kept it, and a person restoring it needs to find it. ⛔ The
 * path goes to the OS and never to a window.
 */
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
  if (!read.ok && read.refusal.rail !== 'resource-bytes-changed') {
    return { ok: false, reason: 'unreadable' }
  }
  // ⚑ The path {@link resourceBytes} has just placed, spelled as it spells it.
  return { ok: true, path: join(resolve(root), row.sha256, row.name), changed: !read.ok }
}

/**
 * ⚑ **What a model is handed, from the form and the bytes** (635, `HO-097` §1.2) — exhaustive over
 * {@link DocumentForm} through {@link CONTENT_OF_FORM}, so a new form does not compile until somebody
 * says what a model gets for it. ⚠️ The text was decoded fatally on the way in and the hash has just
 * been re-checked, so this decode is of the same bytes and cannot substitute a character.
 */
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

/**
 * 🔴 **D-026 · R2 — the most characters a title FOUND in a kept file's text holds**: a piece's own
 * bound ({@link PIECE_TITLE_CHARS}), counted as that bound is counted (`string.length`), because a
 * file's title is drawn where a piece's is — one line, beside a label — and a Markdown file's first
 * line can be all of {@link MAX_TEXT_RESOURCE_BYTES}. ⚑ A longer heading or `<title>` is cut and
 * ends in `…`, so the line says it was cut; ⛔ never inside a surrogate pair.
 *
 * ⚠️ **A name, the fallback, is kept whole**, so a title can be as long as a file's name, which the
 * file system bounds (255 UTF-16 code units on APFS, the unit `string.length` counts): a cut name
 * would read as a file nobody kept.
 */
export const RESOURCE_TITLE_CHARS = PIECE_TITLE_CHARS

/**
 * ⚑ **D-026 · R2 — how each form finds its title in its text** — exhaustive over
 * {@link DocumentForm}, {@link CONTENT_OF_FORM}'s idiom, so a new form does not compile until
 * somebody says how it is titled. ⚑ `null`: a form with no text to look in, titled by its name.
 */
const TITLE_OF_FORM: Readonly<Record<DocumentForm, ((text: string) => string | null) | null>> = {
  markdown: markdownTitle,
  page: pageTitle,
  image: null,
  pdf: null,
}

/**
 * 🔴 **D-026 · R2 — a kept file's title, taken from the bytes in hand as it is kept** (`keptFor`),
 * so no agent does anything for it and no tool argument carries it:
 *
 *  - **a Markdown file**: the `title:` of its front matter, else its first `# ` heading outside a
 *    fenced code block ({@link markdownTitle});
 *  - **a page**: the text of its `<title>` ({@link pageTitle});
 *  - **anything else, no heading, or an empty one**: its name — never cut, since a name is one path
 *    segment and is what the rule falls back to.
 *
 * ⚑ A title found is capped at {@link RESOURCE_TITLE_CHARS}. ⚠️ The bytes were decoded fatally
 * when they were offered ({@link readOfferedResource}), so this decode substitutes nothing, and it
 * drops a leading byte order mark (`TextDecoder`'s default), which `Buffer.toString` would keep in
 * front of a first `#`.
 */
export function resourceTitle(file: Pick<OfferedFile, 'name' | 'form' | 'bytes'>): string {
  return titleBy(TITLE_OF_FORM[file.form], file)
}

/**
 * ⚑ **F046 — the title the reader gave before it read a front matter**: a Markdown file's first
 * `# ` heading, else its name — {@link resourceTitle} without {@link frontMatterTitle}, the same
 * cap, every other form as it is. ⚑ What `RuntimeHost.titleTheOlderFiles` compares a stored title
 * with: a title equal to it was the reader's, from these bytes, and is the reader's to replace.
 */
export function resourceTitleBeforeFrontMatter(
  file: Pick<OfferedFile, 'name' | 'form' | 'bytes'>,
): string {
  return titleBy(file.form === 'markdown' ? markdownHeading : TITLE_OF_FORM[file.form], file)
}

/** A title by `titleOf` from the file's text, capped — or its name, when `titleOf` finds none. */
function titleBy(
  titleOf: ((text: string) => string | null) | null,
  file: Pick<OfferedFile, 'name' | 'bytes'>,
): string {
  const found = titleOf === null ? null : titleOf(new TextDecoder('utf-8').decode(file.bytes))
  return found === null ? file.name : cappedTitle(found)
}

/** ⚑ {@link RESOURCE_TITLE_CHARS} at most, a cut one ending in `…`, never half a surrogate pair. */
function cappedTitle(title: string): string {
  if (title.length <= RESOURCE_TITLE_CHARS) return title
  let end = RESOURCE_TITLE_CHARS - 1
  const last = title.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return `${title.slice(0, end)}…`
}

/**
 * ⚑ **F046 — a Markdown file's front matter `title:` first** ({@link frontMatterTitle}): a file
 * that names itself there is called what it says, not by the first heading of its body. ⚑ **D-026 ·
 * R2 — else its first level-1 heading**, or `null` when it has none or the first one is empty (R2:
 * *the first `# ` line*, so a second is never looked for) — the first one the viewer draws
 * (`renderer/src/lib/markdown.ts`, CommonMark):
 *
 *  - ⛔ **A fenced code block is passed over** — three or more backticks or tildes, up to three
 *    spaces in, closed by a run of the same character at least as long; an unclosed one runs to the
 *    end. ⚠️ A backtick run with another backtick after it on its line opens none: CommonMark lets no
 *    backtick into a backtick fence's info string, so the line is inline code.
 *  - ⚠️ **The heading is looked for as the viewer draws the file**, which knows no front matter: a
 *    first `---` is a rule and a `# ` line after it a heading — so with no `title:` in front
 *    matter, that heading is the title.
 *  - ⚑ **A heading is `#` then a space or tab, or `#` alone**, up to three spaces in (what the
 *    viewer draws as a first-level heading); four spaces is code, and `#Title` or `## x` is not one.
 *  - ⚑ Its text is trimmed and a closing run of `#` dropped when a space or tab stands before it,
 *    so `# Title ##` is `Title` and `# Learn C#` keeps its `C#`. Inline Markdown is kept as written.
 *
 * ⛔ **Linear in the text**: the closing run is found by walking back, never by a regex that would
 * backtrack over a long run of spaces (measured: 10.7 s for 50,000 of them).
 */
function markdownTitle(text: string): string | null {
  const lines = text.split(/\r\n|\r|\n/)
  return frontMatterTitle(lines) ?? firstHeading(lines)
}

/** ⚑ The first level-1 heading of {@link markdownTitle}'s rule, alone: no front matter is read. */
function markdownHeading(text: string): string | null {
  return firstHeading(text.split(/\r\n|\r|\n/))
}

/** ⚑ The first level-1 heading among `lines`, by {@link markdownTitle}'s rule. */
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

/**
 * ⚑ **F085 — an unindented line that opens a YAML key**: a key, then `:` and a space, a tab or the
 * end of the line. ⚑ **The key may hold spaces** (`range checked: …` is a YAML key, and a front
 * matter with one used to be read as no front matter at all), and a colon not followed by a space
 * (`at 10:30: …`); or it is quoted, `"…"` (with `\"`) or `'…'` (with `''`).
 *
 * ⚑ **What it still refuses**, which is what keeps a rule followed by prose from being read as
 * YAML: a line with no `: ` in it (*"This file opens with a rule."*), and one that opens the way no
 * plain YAML key can — with a quote it never closes, `#`, `:`, a list item's `- `, `? `, or one of
 * YAML's indicators (`[ ] { } , & * ! | > % @` and a backtick). ⚠️ A block whose every line is
 * prose with a `: ` in it reads as YAML; it must also open the file with `---` and be closed by
 * `---` or `...`, which prose rarely is. ⛔ **Linear in the line**: each character of a plain key is
 * taken by exactly one of its two branches, and a space before the colon belongs to the key, so a
 * long run of spaces with no colon after it is not backtracked over.
 */
const YAML_KEY =
  /^(?:(?![-?][ \t])[^\s#:'"[\]{},&*!|>%@`](?:[^:]|:(?![ \t]|$))*|(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*')[ \t]*):(?:[ \t]|$)/

/**
 * ⚑ **F046 — the `title:` of a Markdown file's front matter**, or `null` when it has none, or it is
 * empty, or the file has no front matter: a first line `---` and a later one `---` or `...` closing
 * it — an unclosed one is no front matter. ⚑ **A top-level key only** (`title:` at the start of its
 * line), its value trimmed; a quoted one unquoted ({@link quotedValue}: `"…"` with `\"` and `\\`,
 * `'…'` with `''`), everything inside its quotes kept, `#` included; an unquoted one ends before a
 * ` #` comment. ⚠️ A block scalar (`|`, `>`) is not read: no title.
 */
function frontMatterTitle(lines: readonly string[]): string | null {
  if (!/^---[ \t]*$/.test(lines[0] ?? '')) return null
  const close = lines.findIndex((line, at) => at > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(line))
  if (close === -1) return null
  const block = lines.slice(1, close)
  // ⚠️ **Front matter only when it reads as YAML keys**: every unindented line that is not blank or
  // a comment is a `key:` ({@link YAML_KEY}) — else the first `---` was a rule, and the heading
  // after it the title.
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
    // ⚑ A ` #` comment ends an unquoted value — and a value that is only a comment is no value.
    const comment = raw.search(/(?:^|[ \t])#/)
    const value = (comment === -1 ? raw : raw.slice(0, comment)).trim()
    // ⚑ A block scalar is not read, and YAML's own words for nothing are no title.
    if (/^[|>]/.test(value) || value === '~' || value === 'null') return null
    return value || null
  }
  return null
}

/**
 * ⚑ **A quoted front-matter value, unquoted** — everything up to its own closing quote, `#`
 * included: in `"…"` a `\"` is a quote and a `\\` a backslash (any other backslash is kept as
 * written); in `'…'` a `''` is a quote. ⚑ Only blanks or a ` #` comment may follow the closing
 * quote. ⚠️ `null` when the value is not quoted, its quote never closes, or something else follows
 * it — then it is read as an unquoted value.
 */
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

/**
 * ⚑ **D-026 · R2 — the text of a page's `<title>`**, its whitespace collapsed to single spaces and
 * the common entities decoded ({@link decodeEntities}), or `null` when it has none or it is empty.
 *
 * ⚑ **The first `<title>` a browser would make the page's** (`document.title`), read in one pass
 * from the start, passing over what cannot hold it:
 *
 *  - a comment, `<!--` to the next `-->` (`<!-->` included) — ⚠️ an unclosed one runs to the end;
 *  - a `<script>`'s or a `<style>`'s text, to its closing tag — text, never an element;
 *  - an `<svg>` or a `<math>`, to the closing tag that matches it — a `<title>` in a drawing is its
 *    tooltip, never the page's.
 *
 * ⚠️ `<titles>` is not a title; an unclosed `<title>` gives none, and so does anything above left
 * unclosed. The rarer raw text (`<textarea>`, `<noscript>`, a `<template>`'s) is read as markup. ⛔
 * **Linear in the text**: each search starts where the last one ended.
 */
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

/** ⚑ The text of the `<title>` opened at `at`, as {@link pageTitle} gives it — `null` if unclosed. */
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

/** ⚑ Just past the comment opened at `at`, or `-1` if it is never closed. */
function commentEnds(text: string, at: number): number {
  const closes = text.indexOf('-->', at + 2)
  return closes < 0 ? -1 : closes + 3
}

/** ⚑ Just past the `</name>` that closes a script's or a style's text, looked for from `from`. */
function rawTextEnds(text: string, name: string, from: number): number {
  const closing = new RegExp(`</${name}(?=[\\s/>])`, 'gi')
  closing.lastIndex = from
  const closed = closing.exec(text)
  if (closed === null) return -1
  const tagEnds = text.indexOf('>', closed.index)
  return tagEnds < 0 ? -1 : tagEnds + 1
}

/**
 * ⚑ Just past the closing tag that matches the `<svg>` or `<math>` opened at `at`, counting the ones
 * nested in it — ⚠️ a self-closed one (`<svg/>`) holds nothing, and ends at its own tag.
 */
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

/**
 * ⚑ **The named entities a title is decoded from** — markup's own, the no-break space, and the
 * typographic ones a title is written with (dashes, quotes, the ellipsis, the dots and the marks);
 * any other name stays as it was written.
 */
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

/**
 * ⚑ **The common entities, in ONE pass** — so `&amp;lt;` reads `&lt;` and no further. A numeric one
 * is decoded when it names a Unicode scalar value (above 0, at most `0x10FFFF`, not a surrogate);
 * anything else stays as written.
 */
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
