import {
  FILES_FOUND_LISTED,
  MOST_FILES_SEARCHED,
  MOST_TEXT_SEARCHED,
  OLDER_FILES_COUNTED,
  formOfName,
  type DocumentContent,
  type DocumentForm,
} from '../../shared/documents'
import type {
  AgentIdentity,
  FilesKept,
  FilesKeptScope,
  KeptFile,
  ResourceDrawing,
  ResourceReading,
  ResourceReveal,
} from '../../shared/runtime-ipc'
import type {
  KeptFileRow,
  KeptFilesAsked,
  KeptFilesPaged,
  ResourceRow,
  SessionStore,
  WorkRow,
} from '../db/session-store'
import { WindowReadUnavailable, type WindowStoreReader } from '../db/window-read-protocol'
import {
  MOST_BYTES_A_WINDOW_DRAWS,
  MOST_PIXELS_A_WINDOW_DRAWS,
  keptFileToShow,
  keptPictureOrPdf,
  refuseResource,
  resourceBytes,
  resourceTitle,
  resourceTitleBeforeFrontMatter,
  type ResourceRefusal,
} from '../resources/resources'
import {
  inFoundOrder,
  wordsOutsideTheText,
  wordsInTheText,
  type FindFilesAsked,
  type FoundFile,
  type FoundFiles,
  type TextHolds,
} from './kept-file-search'

interface KeptFilesDeps {
  readonly store: Pick<
    SessionStore,
    | 'resource'
    | 'agentIdentities'
    | 'keptFilesBefore'
    | 'keptFilesNewestFirst'
    | 'untitledResources'
    | 'titleResource'
    | 'titledResources'
    | 'retitleResource'
    | 'conversationBinding'
    | 'filesKept'
  >
  resourcesRoot?(): string
  windowReader?: WindowStoreReader
  revealPath?(path: string): void
}

interface KeptFilesOperations {
  theIdsItStandsFor(id: string): readonly string[]
  pieceNamed(spelled: string): WorkRow | null
  keptFileOf(row: KeptFileRow, roster: readonly AgentIdentity[] | null): KeptFile
  now(): number
  isClosed(): boolean
  theWorldMoved(kind: 'work'): void
  handBackTheMainProcess(): Promise<void>
}

/** ⚑ **D-037 · how many files a search names and looks through at once**, between hand-backs. */
const FILES_SEARCHED_AT_ONCE = 100

/** ⚑ **D-037 · how many text bytes a search reads before it hands the main process back.** */
const TEXT_READ_AT_ONCE = 2_097_152

/** ⚑ **F046** — how many files kept before titles were taken are read for one page of titling. */
const FILES_TITLED_AT_ONCE = 50

/**
 * ⚑ **F046 — files kept from this moment on were titled by a reader that reads front matter**, so
 * only a file kept before it can hold a title the older, heading-only reader gave
 * ({@link RuntimeHost.titleTheOlderFiles}). ⚑ The reader shipped on 2026-10-03; this is the week of
 * the first public release, so every beta still in a tester's hands is covered, and the set the
 * pass reads stays the files kept before it rather than growing with every file kept.
 */
const FRONT_MATTER_READ_EVERYWHERE_SINCE = Date.UTC(2026, 9, 11)

export class KeptFiles {
  constructor(
    private readonly deps: KeptFilesDeps,
    private readonly operations: KeptFilesOperations,
  ) {}

  /**
   * 🔴 **D-037 · find the files this app keeps** — `find_files`: on the caller's tree (the pieces it
   * holds or gave and everything under them — what a person sees on its Files tab, {@link filesKept}'s
   * `tree`) or everywhere, newest first; with words, only the files that hold every one of them
   * ({@link wordsOutsideTheText}, then a report's or a page's text).
   *
   * ⛔ **It asks nothing about who is calling**, as {@link readResource} does not: a kept file is the
   * work's documentation, shared, and no line runs between agents.
   *
   * ⚑ **Bounded, and only when called.** A list names {@link FILES_FOUND_LISTED}. A search looks
   * through at most {@link MOST_FILES_SEARCHED} files and {@link MOST_TEXT_SEARCHED} bytes of text,
   * newest first, {@link FILES_SEARCHED_AT_ONCE} at a time, handing the main process back between
   * pages and every {@link TEXT_READ_AT_ONCE} bytes read: naming a page walks its pieces' owners'
   * work rows (`SessionStore.keptFilesNewestFirst`). ⚑ What it did not look through is counted, and
   * `goOnFrom` names the file to carry on from.
   *
   * ⚠️ **Text is read through {@link resourceBytes}**, `read_document`'s own reader — inside the tree
   * and re-hashed — each kept copy once a call. A file it cannot read is searched by its names and
   * its piece alone, and counted.
   */
  async findKeptFiles(asAgent: string, asked: FindFilesAsked): Promise<FoundFiles> {
    if (asked.olderThan !== null && this.deps.store.resource(asked.olderThan) === null) {
      return { ok: false, reason: 'older-than-names-no-file' }
    }
    const scope: KeptFilesPaged =
      asked.where === 'everywhere'
        ? { scope: 'everywhere' }
        : { scope: 'tree', holder: asAgent, givers: this.operations.theIdsItStandsFor(asAgent) }
    const roster = this.deps.store.agentIdentities()
    /** ⚑ What is left once `last` was looked through — counted once a call, and capped. */
    const leftAfter = (
      last: KeptFileRow | undefined,
    ): Pick<FoundFiles & { ok: true }, 'older' | 'goOnFrom'> => {
      const older =
        last === undefined
          ? 0
          : this.deps.store.keptFilesBefore(scope, last.resource.resource, OLDER_FILES_COUNTED)
      return { older, goOnFrom: older > 0 && last !== undefined ? last.resource.resource : null }
    }

    if (asked.words.length === 0) {
      const page = this.deps.store.keptFilesNewestFirst(scope, {
        olderThan: asked.olderThan,
        limit: FILES_FOUND_LISTED,
      })
      return {
        ok: true,
        files: page.rows.map((row) => ({
          file: this.operations.keptFileOf(row, roster),
          foundIn: [],
          excerpt: null,
        })),
        looked: page.rows.length,
        ...leftAfter(page.rows.at(-1)),
        textUnread: 0,
        readAt: this.operations.now(),
      }
    }

    const root = this.deps.resourcesRoot?.()
    /**
     * ⚑ What each kept copy's text holds of the words, once a call — by its folder and name, where
     * its bytes are — or `null`: it could not be read. ⛔ The text itself is not kept.
     */
    const texts = new Map<string, TextHolds | null>()
    const files: FoundFile[] = []
    let looked = 0
    let textRead = 0
    let sinceHandedBack = 0
    let textUnread = 0
    let last: KeptFileRow | undefined
    let cursor = asked.olderThan
    const enough = (): boolean =>
      looked >= MOST_FILES_SEARCHED || files.length >= FILES_FOUND_LISTED
    search: while (!enough()) {
      const page = this.deps.store.keptFilesNewestFirst(scope, {
        olderThan: cursor,
        limit: FILES_SEARCHED_AT_ONCE,
      })
      if (page.through === null) break
      for (const row of page.rows) {
        if (enough()) break search
        const file = this.operations.keptFileOf(row, roster)
        const isText = file.form === 'markdown' || file.form === 'page'
        const copy = `${row.resource.sha256}/${row.resource.name}`
        const unread = isText && !texts.has(copy)
        // ⛔ **A file is looked through whole or not at all**: one whose text would pass the bound
        // is left for the next call, so every file counted as looked through was.
        if (unread && looked > 0 && textRead + row.resource.bytes > MOST_TEXT_SEARCHED) {
          break search
        }
        looked += 1
        last = row
        const outside = wordsOutsideTheText(file, asked.words)
        if (outside.missing.length === 0) {
          files.push({ file, foundIn: inFoundOrder(outside.foundIn), excerpt: null })
          continue
        }
        if (!isText) continue
        if (unread) {
          const read = root === undefined ? null : resourceBytes(root, row.resource)
          texts.set(
            copy,
            read?.ok === true && read.content.as !== 'not-for-a-model'
              ? wordsInTheText(read.content.text, asked.words)
              : null,
          )
          textRead += row.resource.bytes
          sinceHandedBack += row.resource.bytes
        }
        const inText = texts.get(copy) ?? null
        if (inText === null) {
          textUnread += 1
        } else if (outside.missing.every((word) => inText.holds.has(word))) {
          files.push({
            file,
            foundIn: inFoundOrder(new Set([...outside.foundIn, 'text'])),
            excerpt: inText.around.get(outside.missing[0] ?? '') ?? null,
          })
        }
        if (sinceHandedBack >= TEXT_READ_AT_ONCE) {
          sinceHandedBack = 0
          await this.operations.handBackTheMainProcess()
        }
      }
      // ⚑ **From the last row the page READ**, named or not, so a page whose every row could not be
      // named still moves the search on.
      cursor = page.through
      await this.operations.handBackTheMainProcess()
    }
    return {
      ok: true,
      files,
      looked,
      ...leftAfter(last),
      textUnread,
      readAt: this.operations.now(),
    }
  }

  /**
   * ⚑ **F046 — the files kept before titles were taken, titled once from their kept bytes** — by
   * {@link resourceTitle}, the rule a file kept now is titled by, so an older one reads as a new one
   * would. Started once after a launch, behind the window (`index.ts`), and never on a door.
   *
   * ⚑ **Once, by the data**: every file it visits leaves with a title — its name, when its bytes are
   * gone, unreadable or changed, or it is a form with no text (read only for those that have one) —
   * so a later launch finds none; ⚠️ it still asks for them, a scan of `work_resource` (no index
   * holds a missing title), after handing the main process back first. ⚑ **Bounded**:
   * {@link FILES_TITLED_AT_ONCE} rows a page, one file read at a time, handing the main process back
   * between them; it stops when a quit begins, and when a page titles nothing. Open windows are told
   * once, at the end.
   *
   * ⚑ **And the files the old reader titled, read again**: a Markdown file kept while a front matter
   * `title:` was not read took its first `# ` heading, or its name, and is titled by what its bytes
   * say now. ⛔ **Only a title the reader gave is replaced**: the stored title must be the file's name
   * or exactly what the reader before front matter gives from the same bytes
   * ({@link resourceTitleBeforeFrontMatter}), and it must still be that when the write lands
   * (`retitleResource` compares). So a title anyone chose, or one taken from the front matter, is
   * never replaced; a title cut at 200 characters equals a fresh read and changes nothing.
   * ⚠️ **Read on each launch:** a file titled by its name, as before, and a Markdown file titled
   * otherwise only if it was kept before {@link FRONT_MATTER_READ_EVERYWHERE_SINCE} (a page has no
   * older reader) — a page at a time by its place, one file at a time, handing the main process back
   * between them. Answers how many it titled and how many it titled again.
   */
  async titleTheOlderFiles(): Promise<{ titled: number; retitled: number }> {
    const root = this.deps.resourcesRoot?.()
    if (root === undefined) return { titled: 0, retitled: 0 }
    let titled = 0
    await this.operations.handBackTheMainProcess()
    for (;;) {
      if (this.operations.isClosed()) break
      const page = this.deps.store.untitledResources(FILES_TITLED_AT_ONCE)
      let titledNow = 0
      for (const row of page) {
        if (this.operations.isClosed()) break
        const form = formOfName(row.name)
        const read = form === 'markdown' || form === 'page' ? resourceBytes(root, row) : null
        const title =
          read !== null && read.ok
            ? resourceTitle({ name: row.name, form: read.form, bytes: read.bytes })
            : row.name
        if (this.deps.store.titleResource(row.resource, title)) titledNow += 1
        await this.operations.handBackTheMainProcess()
      }
      titled += titledNow
      if (page.length === 0 || titledNow === 0) break
    }
    let retitled = 0
    let after = 0
    for (;;) {
      if (this.operations.isClosed()) break
      const page = this.deps.store.titledResources(
        after,
        FILES_TITLED_AT_ONCE,
        FRONT_MATTER_READ_EVERYWHERE_SINCE,
      )
      for (const { at, row } of page) {
        if (this.operations.isClosed()) break
        after = at
        const was = row.title
        const form = formOfName(row.name)
        if (was === null || (form !== 'markdown' && form !== 'page')) continue
        // ⚑ A page is titled as it always was, so only one titled by its name can read otherwise.
        if (form === 'page' && was !== row.name) continue
        const read = resourceBytes(root, row)
        if (read.ok) {
          const file = { name: row.name, form: read.form, bytes: read.bytes }
          const title = resourceTitle(file)
          if (
            title !== was &&
            (was === row.name || was === resourceTitleBeforeFrontMatter(file)) &&
            this.deps.store.retitleResource(row.resource, was, title)
          ) {
            retitled += 1
          }
        }
        await this.operations.handBackTheMainProcess()
      }
      if (page.length < FILES_TITLED_AT_ONCE) break
    }
    if (titled + retitled > 0 && !this.operations.isClosed()) this.operations.theWorldMoved('work')
    return { titled, retitled }
  }

  /**
   * 🔴 **The AGENT's door onto a kept resource** — `read_document` (380 §7's reader, for resources
   * since D-016) — **and it asks NOTHING about who is calling** (HO-057, carried from the documents
   * resources replaced).
   *
   * ⛔ **Any agent may read any resource**: a resource is the trail of a piece, and a piece's record
   * names its resources to whoever may read that record. ⚑ **What still bounds it is WHAT is
   * returned**: {@link resourceBytes} holds the row's file inside the resources tree and re-checks
   * it against the hash it was kept with before a byte is returned.
   *
   * ⚠️ **Three answers before the bytes, each its own word**: this app has nowhere it keeps
   * resources (`resource-store-unavailable`), no resource has that id (`no-such-resource` — an id
   * from before D-016 among them), and then the byte rails.
   */
  readResource(
    resourceId: string,
  ):
    | { ok: true; resource: ResourceRow; form: DocumentForm; content: DocumentContent }
    | { ok: false; refusal: ResourceRefusal } {
    const root = this.deps.resourcesRoot?.()
    if (root === undefined) {
      return { ok: false, refusal: refuseResource('resource-store-unavailable') }
    }
    const row = this.deps.store.resource(resourceId)
    if (row === null) {
      return { ok: false, refusal: refuseResource('no-such-resource', { resource: resourceId }) }
    }
    const read = resourceBytes(root, row)
    if (!read.ok) return { ok: false, refusal: read.refusal }
    // ⚑ **635 · the CONTENT and never the bytes** (`HO-097` §1.2). ⛔ A model gets a form it can
    // use or a word saying there is none; the Buffer stays on this side of the wire.
    return { ok: true, resource: row, form: read.form, content: read.content }
  }

  /**
   * 🔴 **The PERSON's door onto the same bytes** (510) — a person reading a reply that names a
   * resource opens it here.
   *
   * ## ⛔ A SIBLING of {@link readResource}, and the difference is the VOCABULARY
   *
   * ⚑ An agent meets `RESOURCE_RAILS` — a permanence and a remedy, because a model decides whether
   * to stop — and a window meets the four words of {@link ResourceReading}, because a person
   * decides whether to go and look. ⛔ A nullable-caller parameter would have been the wrong shape: a
   * door is where a vocabulary is chosen.
   *
   * ⚑ **It asks no capability** — HO-005: *"the human is unrestricted"*. ⚠️ **What bounds it is
   * {@link resourceBytes}**, the one reader both doors go through, so an agent may never read what a
   * person may not (517's rule, one boundary in one place).
   *
   * ⚠️ **`unreadable` folds *gone* and *something is standing there that cannot be read***: both
   * end at a person going to look, and the one sentence the panel draws says so.
   */
  readResourceForAPerson(resourceId: string): ResourceReading {
    const root = this.deps.resourcesRoot?.()
    if (root === undefined) return { ok: false, reason: 'no-store' }
    const row = this.deps.store.resource(resourceId)
    if (row === null) return { ok: false, reason: 'no-such-resource' }
    const read = resourceBytes(root, row)
    if (!read.ok) {
      return {
        ok: false,
        reason: read.refusal.rail === 'resource-bytes-changed' ? 'changed' : 'unreadable',
      }
    }
    return {
      ok: true,
      resourceId: row.resource,
      // ⚑ **The name a person reads is the FILE's** — the name it was handed in with, never a path.
      name: row.name,
      // 🔴 **635 · the FORM, so the window knows which viewer to be** (`HO-097` §1.3).
      form: read.form,
      // ⛔ **The TEXT for a text form and `null` otherwise** — a `''` here would draw an empty page
      // over a picture (`an-unenumerated-state-counts-as-success`).
      text: read.content.as === 'not-for-a-model' ? null : read.content.text,
      bytes: row.bytes,
    }
  }

  /**
   * 🔴 **D-032 · a kept picture or PDF, for the PERSON who opened it** — {@link readResourceForAPerson}'s
   * door, handing over the bytes rather than the text. ⚑ {@link keptPictureOrPdf} reads them through
   * {@link resourceBytes}, so they are inside the resources tree and hash to what was kept; reads their
   * type off the bytes, within the kind their name says; holds a picture to a number of pixels; and
   * sets the type a window draws them as. ⚑ Read when a person opens one and at no other time.
   * ⛔ What a window may do with them is {@link ResourceDrawing}'s to say.
   */
  drawResourceForAPerson(resourceId: string): ResourceDrawing {
    const found = this.keptForAPerson(resourceId)
    if (!('row' in found)) return found
    const kept = keptPictureOrPdf(found.root, found.row)
    if (!kept.ok) {
      if (kept.reason === 'too-large') {
        return {
          ok: false,
          reason: 'too-large',
          bytes: found.row.bytes,
          mostBytes: MOST_BYTES_A_WINDOW_DRAWS,
        }
      }
      if (kept.reason === 'too-many-pixels') {
        return { ...kept, mostPixels: MOST_PIXELS_A_WINDOW_DRAWS }
      }
      return { ok: false, reason: kept.reason }
    }
    const { resource, name } = found.row
    return { ok: true, resourceId: resource, name, drawnAs: kept.drawnAs, bytes: kept.bytes }
  }

  /**
   * 🔴 **D-032 · a kept file, shown in Finder by its id** — {@link revealPath}'s act, on a resource.
   * ⛔ **The path is found from the row by {@link keptFileToShow}**, which holds it inside the
   * resources tree and says when nothing is to be shown. ⚑ Nothing is opened either way, and the
   * path never reaches the window.
   */
  revealResource(resourceId: string): ResourceReveal {
    const found = this.keptForAPerson(resourceId)
    if (!('row' in found)) return found
    const kept = keptFileToShow(found.root, found.row)
    if (!kept.ok) return { ok: false, reason: kept.reason }
    this.deps.revealPath?.(kept.path)
    return { ok: true, changed: kept.changed }
  }

  /**
   * ⚑ **D-032 · the kept row a person's window names, and the folder it is kept in** — or
   * {@link ResourceReading}'s word for why there is none: this app keeps no resources folder in this
   * run, or holds no resource by that id. ⚠️ `row` is `undefined` only when there is no folder.
   */
  private keptForAPerson(
    resourceId: string,
  ):
    | { readonly root: string; readonly row: ResourceRow }
    | { readonly ok: false; readonly reason: 'no-store' | 'no-such-resource' } {
    const root = this.deps.resourcesRoot?.()
    const row = root === undefined ? undefined : this.deps.store.resource(resourceId)
    if (root === undefined || row === undefined) return { ok: false, reason: 'no-store' }
    return row === null ? { ok: false, reason: 'no-such-resource' } : { root, row }
  }

  /**
   * 🔴 **D-026 · R1 — the files kept in one scope, for a person** ({@link FilesKept}): a
   * conversation's tree, what one conversation added, or one piece.
   *
   * ⚑ **Existence first, then the read** (`SessionStore.spawnedBy`'s rule): a conversation or a
   * piece this app does not hold answers its own word, never an empty list that would say it holds
   * no files. ⚑ **A tree counts the gives of the conversations it took the place of as its own**
   * ({@link theIdsItStandsFor}, D-017 · R10), as its board does; ⚠️ the conversation scope is
   * exact: a file a conversation added is its own act, and each row names who added it.
   *
   * ⚑ **One store read** (`SessionStore.filesKept`), each row through {@link keptFileOf}, the mapper
   * the push uses too. ⛔ It asks no capability — HO-005, as {@link readResourceForAPerson}.
   */
  filesKept(asked: FilesKeptScope): FilesKept {
    let scope: KeptFilesAsked
    if (asked.scope === 'piece') {
      const row = this.operations.pieceNamed(asked.piece)
      if (row === null) return { ok: false, reason: 'no-piece-by-that-name' }
      scope = { scope: 'piece', piece: row.piece }
    } else if (this.deps.store.conversationBinding(asked.conversation) === null) {
      return { ok: false, reason: 'no-such-conversation' }
    } else if (asked.scope === 'tree') {
      scope = {
        scope: 'tree',
        holder: asked.conversation,
        givers: this.operations.theIdsItStandsFor(asked.conversation),
      }
    } else {
      scope = { scope: 'conversation', conversation: asked.conversation }
    }
    const roster = this.deps.store.agentIdentities()
    return {
      ok: true,
      files: this.deps.store.filesKept(scope).map((row) => this.operations.keptFileOf(row, roster)),
    }
  }

  /** The two opening lists share a worker snapshot; no ledger read falls back to main. */
  async filesKeptForWindow(conversation: string): Promise<FilesKept> {
    if (this.deps.store.conversationBinding(conversation) === null)
      return { ok: false, reason: 'no-such-conversation' }
    const reader = this.deps.windowReader
    if (reader === undefined || this.operations.isClosed()) throw new WindowReadUnavailable()
    const result = await reader.read({
      kind: 'files',
      sessionId: conversation,
      givers: [...this.operations.theIdsItStandsFor(conversation)],
    })
    if (result.kind !== 'files' || this.operations.isClosed()) throw new WindowReadUnavailable()
    return {
      ok: true,
      files: result.tree.map((row) => this.operations.keptFileOf(row, result.roster)),
      added: result.added.map((row) => this.operations.keptFileOf(row, result.roster)),
    }
  }
}
