import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  type BigIntStats,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { aStagingName, createFreshFile, isStillTheFileOpened } from '@brobot2/runtime'
import {
  captureMethodFileGuard,
  readKnowledgeFileCapture,
  safeMethodFileName,
  type MethodFileCapture,
  type MethodLibraryInputs,
} from '../saved-method-library'
import { SUPPORTED_PROVIDERS, type Provider } from '@brobot2/shared'
import { providerKnowledge } from '../providers/knowledge-definitions'
import type { SessionStore } from '../db/session-store'
import { isPathSegment } from '../../shared/runtime-ipc'
import type { ActedBy } from '../../shared/who-did-it'
import type {
  AgentMemoryEntry,
  AgentMemoryStore,
  AmendmentRefused,
  MemoryEditAct,
  MemoryAmendment,
  MemoryObservation,
  MemoryAmendmentWrite,
  MemoryStoreState,
} from '../../shared/agent-memory'
import { keepToThisUser, verifyFileToThisUser, type AccessLists } from '../recovery/windows-privacy'
import {
  AGENT_MEMORY_NOTES_SHOWN,
  MEMORY_STORE_LAYOUT,
  memoryStoreCounts,
  readAgentMemoryPage,
  readAgentMemorySelection,
  realPath,
  type AgentMemoryStoreRead,
} from './instructions'

/**
 * 🔴 **An agent's memory store read WITHOUT a conversation, and the one door a person may change it
 * through** (625, `EXT-015` §1 · §3).
 *
 * ## ⛔ Why this module exists beside `instructions.ts` rather than inside it
 *
 * ⚑ **`instructions.ts` answers a LAUNCH's question.** Every entry point it has takes an
 * `InstructionInputs` — a provider, a provider home, a cwd, a published bundle — because it is
 * composing what one conversation's model will be told. ⚠️ **This module has no conversation**: it
 * is handed a profile and asked what is on disk for it, under every provider, right now.
 *
 * ⛔ **The READERS are not duplicated.** {@link readClaudeAgentMemory} and
 * {@link readCodexAgentMemory} are `instructions.ts`' own per-provider walks, exported for exactly
 * this caller — `169` §1's rule, and the thing it protects against here is specific: two answers to
 * *which files are in this store* would let the popup offer a removal for a file the drawer never
 * listed, or refuse one it did.
 *
 * ## 🔒 It is the only module in this feature that may touch the filesystem
 *
 * ⛔ **`no-byte-authority.test.ts` pins `runtime/ipc.ts` and `runtime-host.ts` at ZERO `node:fs`
 * imports**, and the house ruling behind it is the load-bearing half here: **the renderer never
 * supplies a path.** ⚠️ A caller names an entry by the string this app itself produced, and
 * {@link amendAgentMemory} looks that string up in a list it derives FRESH — the path it opens is
 * always its own. 🔴 A caller-supplied string is never joined, never resolved and never opened.
 *
 * ## ⛔ The write follows NO link, and that is the opposite of the read — on purpose
 *
 * ⚑ **`readMemoryStore` follows links** under `170` §2: the provider read the target before this
 * app was asked anything, so refusing removed the row from the panel and removed nothing from the
 * prompt. ⛔ **That argument inverts for a write.** Following a link here would delete or rewrite a
 * file outside `~/Library/Application Support/@brobot2/desktop/`, which `EXT-015` §5 forbids by
 * name — *"Never `~/.claude` and never `~/.codex`"* — and unlike the read, refusing costs a person
 * nothing they cannot get another way. ⚠️ **Refusing the read buys nothing. Refusing the write buys
 * everything.**
 *
 * 🔴 **Two independent checks, because provenance alone is not enough** (`workflow-output.ts`'
 * standing rule): the entry must be a MEMBER of the freshly derived candidate list, AND its real
 * path must resolve inside the managed provider-homes root. ⛔ Neither is sufficient — the
 * membership check alone would pass an entry the reader deliberately followed out of the store, and
 * the containment check alone would pass any file under the root that no store ever named.
 */

/**
 * ⛔ **One reader per provider, as an exhaustive table** — the rail that makes a third provider a
 * COMPILE error rather than an empty popup.
 *
 * ⚑ **This is what `MEMORY_STORE_STATE` deliberately has no *we cannot read this provider* word
 * for.** A fifth state standing in the future would be a line no mutation can kill
 * (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`), and the planted-future value it would
 * be is exactly the shape standing rule 12 warns about — *"standing in the future stops working
 * when the future arrives."* 🔴 A `Record<Provider, …>` cannot go short, so the question arrives
 * with the provider.
 *
 * ⚠️ **The values are `instructions.ts`' own functions**, not wrappers: a wrapper is a second place
 * for the store's shape to be decided.
 */
const STORE_READER = Object.fromEntries(
  SUPPORTED_PROVIDERS.map((provider) => [provider, providerKnowledge[provider].memory.readStore]),
) as Readonly<Record<Provider, (providerHome: string) => AgentMemoryStoreRead>>

/**
 * ⛔ **The order the stores are reported in** — derived from the reader table's own keys, never a
 * second list.
 *
 * ⚠️ **`Object.keys` is typed `string[]`**, so the cast is the one place this file admits the
 * language cannot express what the table already guarantees. ⚑ A `Provider` that is missing from
 * `STORE_READER` cannot compile, so a key that is here is a provider and a provider that exists is
 * a key.
 */
const PROVIDERS = Object.keys(STORE_READER) as readonly Provider[]

/** What a caller must hand this module so it never has to spell a path scheme of its own. */
export interface AgentMemoryInputs {
  /** The identity, already folded by the caller — this module does no name folding. */
  readonly profileId: string
  /**
   * ⛔ **Where one provider's home for this profile WOULD be** — the host's own
   * `providerHomePath` seam, which is `deriveProviderHome` and touches nothing.
   *
   * ⚠️ **A seam rather than a join, for `RuntimeHostDeps.providerHomePath`'s own reason**: the
   * layout under `userData` is the app layer's business, and a module that learned to spell
   * `default/<profile>/<provider>` would be a second copy of it.
   */
  readonly homeOf: (provider: Provider) => string
  /**
   * ⛔ **The managed root every provider home lives under** — `<userData>/provider-homes`, or
   * `null` for a host that has no data directory of ours.
   *
   * 🔴 **`null` makes every entry unamendable rather than every entry amendable.** ⚠️ A host that
   * cannot say where the root is cannot check containment, and the direction that fails closed is
   * the one that refuses. ⛔ A default root guessed here would make every containment claim pass.
   */
  readonly homesRoot: string | null
}

/** What {@link readAgentMemory} answers — the stores, and the moment the walk was asked for. */
export interface AgentMemoryStoresRead {
  readonly stores: readonly AgentMemoryStore[]
  readonly readAt: number
}

/**
 * 🔴 **What this agent has written down, under every provider, right now.**
 *
 * ⛔ **Every provider, never only the configured one.** `setAgentProvider` has been able to move an
 * identity since `433`, and the home it moved away from still holds what the agent wrote there;
 * `AgentIdentity.provider` is also nullable, so a reading scoped to *the* provider would have to
 * invent an answer for *nobody has said*. ⚑ A store with nothing in it costs one `existsSync`.
 *
 * ⚠️ **`readAt` is stamped on the ASK, above the first syscall** —
 * `stamp-a-measurement-when-you-ask-not-when-it-answers`, and `readClaudeAgentMemory`'s own
 * `lookedAt` one layer down. ⛔ Taken at the end it would date a directory listing with the moment
 * the last file finished, and the only mistake an early stamp can make is telling a person their
 * edit might just have missed the look — the answer that sends somebody to look again.
 */
export function readAgentMemory(inputs: AgentMemoryInputs): AgentMemoryStoresRead {
  const readAt = Date.now()
  const stores = PROVIDERS.map((provider) => storeFor(provider, inputs, rootsOf(inputs)))
  return { stores, readAt }
}

/**
 * 🔴 **F093 · C8 b — one PAGE of what this agent has written down, under every provider** — the
 * agent-input popup's read of memory, past the launch readers' twenty files.
 *
 * ⚑ {@link readAgentMemory}'s walk, page by page: each store's fixed files on page one, then its topic
 * files or notes from `offset` ({@link readAgentMemoryPage}), with each store's `total` and where its
 * next page starts. ⚑ The same amendable check and the same states.
 */
export function readAgentMemoryPaged(
  inputs: AgentMemoryInputs,
  page: { readonly offset: number; readonly limit: number },
): AgentMemoryStoresRead {
  const readAt = Date.now()
  const root = rootsOf(inputs)
  const stores = PROVIDERS.map((provider): AgentMemoryStore => {
    const home = inputs.homeOf(provider)
    if (!existsSync(home)) {
      return {
        provider,
        state: 'no-home',
        dir: null,
        entries: [],
        refused: [],
        total: 0,
        nextOffset: null,
      }
    }
    const paged = readAgentMemoryPage(provider, home, page.offset, page.limit)
    const entries: AgentMemoryEntry[] = paged.memory.map((item) => ({
      ...item,
      amendable: amendable(item.path, item.link, root),
    }))
    const state = stateOf(entries, paged)
    // ⚑ A page asked past the last topic file or note of a store that holds some is not a store
    // nothing was written in. ⛔ Page one never is: an empty index there is nothing written.
    const pastTheEnd = page.offset > 0 && page.offset >= paged.listed && paged.total > 0
    return {
      provider,
      state: state === 'nothing-written' && pastTheEnd ? 'past-the-last-page' : state,
      dir: paged.dir,
      entries,
      refused: paged.refused,
      total: paged.total,
      nextOffset: paged.nextOffset,
    }
  })
  return { stores, readAt }
}

/**
 * ⛔ **The managed root in both spellings, or `null` for a host that cannot name one.**
 *
 * ⚑ **Resolved ONCE for a whole walk**, not once per entry: `realPath` walks the filesystem, and
 * the root does not move between two providers of one reading. ⚠️ Both spellings, because the
 * lexical and the real spelling answer different arms of {@link amendable} and only one of them
 * costs a syscall.
 */
function rootsOf(inputs: AgentMemoryInputs): ManagedRoot | null {
  if (inputs.homesRoot === null) return null
  return { lexical: resolve(inputs.homesRoot), real: realPath(inputs.homesRoot) }
}

interface ManagedRoot {
  readonly lexical: string
  readonly real: string
}

function storeFor(
  provider: Provider,
  inputs: AgentMemoryInputs,
  root: ManagedRoot | null,
): AgentMemoryStore {
  const home = inputs.homeOf(provider)
  // ⛔ **The HOME, not the memory directory** — `no-home` is *this agent has never run on this
  // provider* and only the home can say that. ⚠️ `existsSync` follows links, which is the right
  // answer here for the same reason it is in `readCodexAgentMemory`: a home pointed at another
  // disk is a home, and a dangling one is not.
  if (!existsSync(home)) {
    return { provider, state: 'no-home', dir: null, entries: [], refused: [] }
  }
  const read = STORE_READER[provider](home)
  const entries: AgentMemoryEntry[] = read.memory.map((item) => ({
    ...item,
    amendable: amendable(item.path, item.link, root),
  }))
  // ⚑ **W4.177 — and, as a page would say it, how many there are and where the next page starts**:
  // this read lists the store's fixed files and its first topic files or notes, as page one does.
  const { total, listed } = memoryStoreCounts(provider, home)
  return {
    provider,
    state: stateOf(entries, read),
    dir: read.dir,
    entries,
    refused: read.refused,
    total,
    nextOffset: listed > AGENT_MEMORY_NOTES_SHOWN ? AGENT_MEMORY_NOTES_SHOWN : null,
  }
}

/**
 * ⛔ **Which of the four launch-read words is true of this store** — and each is true of nothing
 * else. ⚑ The paged read adds a fifth, `past-the-last-page`, itself ({@link readAgentMemoryPaged}).
 *
 * ⚠️ **`unreadable` is asked BEFORE `nothing-written`**, and the order is the whole point: a store
 * whose every file was declined has an empty list, and answering *"hasn't written anything down
 * yet"* about it would be a wall of refusals rendering as an empty state — which is `MEMORY_STORE_IS`'
 * own argument, enforced here rather than left to a reader.
 */
function stateOf(
  entries: readonly AgentMemoryEntry[],
  read: AgentMemoryStoreRead,
): MemoryStoreState {
  if (entries.length > 0) return 'read'
  if (read.refused.length > 0) return 'unreadable'
  return 'nothing-written'
}

/**
 * At or inside `root`. `relative`, never `startsWith`: `/a/b-evil` is not inside `/a/b`.
 *
 * ⚠️ **A copy of this three-line comparison, and `372` is the reason it is a copy** — the
 * resources module keeps its own `within` for the same reason. ⛔ **A shared guard exports its POLICY along
 * with its arithmetic**: `internal/confinement.ts`' `isWithin` carries the Claude adapter's
 * plan-file and memory allowances, and that ruling is not this door's. ⚑ What must not differ is
 * the arithmetic, and it does not.
 */
function within(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/**
 * 🔒 **May a person change this entry — asked in TWO arms, both required** (`EXT-015` §5).
 *
 * ⛔ **The LEXICAL arm, on the path this app DERIVED, and it is answered with no syscall.** A store
 * file is inside the managed root by construction, so this arm is what catches a derivation that
 * stopped being one — `placeResource`'s own first arm.
 *
 * ⛔ **The REAL arm, on the bytes the reader actually opened, and it is what catches a SYMLINK.**
 * ⚑ `readMemoryStore` follows links deliberately and sets {@link InjectedInstruction.link} to where
 * it really went; a `memory/MEMORY.md -> ~/.claude/CLAUDE.md` passes the first arm and fails this
 * one. 🔴 **That case is the whole reason this function exists**: `EXT-015` §5 is *"never
 * `~/.claude` and never `~/.codex`"*, and following the link on a WRITE is exactly how this app
 * would reach one.
 *
 * ## ⚠️ Both sides are resolved by the same authority, which is the case half
 *
 * ⛔ **`realpath` does not canonicalise case** (`realpath-does-not-canonicalise-case`) and APFS is
 * case-insensitive, so a string compare between two spellings of one directory is not a containment
 * check. ⚑ {@link realPath} is `realpathSync.native` — the FILESYSTEM's own spelling — and both
 * sides go through it, which is `placeResource`'s *two answers from one authority*.
 *
 * ## ⛔ The missing-path policy, stated because `372` says every caller must state its own
 *
 * **A path this app cannot resolve is REFUSED.** ⚠️ {@link realPath} has no null to return: it
 * falls back to the lexical spelling, which then compares against a REAL root it cannot match, so
 * the answer is `false`. ⚑ That is the right direction for an allow-list of exactly one tree.
 */
function amendable(path: string, link: string | undefined, root: ManagedRoot | null): boolean {
  if (root === null) return false
  if (!within(root.lexical, resolve(path))) return false
  return within(root.real, realPath(link ?? path))
}

/**
 * ⛔ **What one attempted amendment did** — a discriminated union, because the arms carry different
 * values (`a-value-beside-a-word-or-a-union-of-arms`).
 *
 * ⚑ **`textBefore` is on the DONE arm only**, and it is what the caller writes into the record. ⚠️
 * It is read here, inside the same guarded walk that decides the path, rather than handed in by a
 * caller who read it a minute ago: the record then states what was really there at the moment of
 * the act, which is the only claim it is able to make truthfully.
 */
export type AmendmentOutcome =
  | { readonly done: true; readonly entry: string; readonly textBefore: string }
  | { readonly done: false; readonly refused: AmendmentRefused; readonly entry: string }

/** What a caller hands {@link amendAgentMemory} on top of what the read needs. */
export interface AmendmentInputs extends AgentMemoryInputs {
  readonly provider: Provider
  /**
   * ⛔ **The entry as the READING named it** — matched against a freshly derived list, never
   * opened, never joined and never resolved.
   */
  readonly entry: string
  /** One of `MEMORY_EDIT`. */
  readonly act: MemoryEditAct
  /** ⛔ **The replacement text for `corrected`**, and ignored for `removed`. */
  readonly text: string
}

/**
 * 🔴 **A person removes or corrects one entry in one agent's memory store** (`EXT-015` §3.2).
 *
 * ## ⛔ The path this opens is always this app's own
 *
 * ⚑ **The store is re-read first**, and {@link AmendmentInputs.entry} is looked up in what came
 * back. ⚠️ **The matched entry's `path` is what gets opened** — the caller's string is compared and
 * then discarded. 🔴 So a caller that sent `../../../../etc/passwd` reaches no filesystem call at
 * all: it matches nothing, and the answer is `no-such-entry`.
 *
 * ## ⛔ …and it is checked a second time, independently
 *
 * ⚑ **{@link AgentMemoryEntry.amendable} is re-derived here rather than trusted from the reading a
 * surface is holding** — `HO-029` §3's rule is about not REPORTING an act as done, and this is its
 * other half: a check made when the popup opened is not a check made when the button was pressed.
 *
 * ## ⚠️ What a removal does NOT do, and it is `EXT-015` §5's second clause
 *
 * ⛔ **It removes ONE file and interprets nothing.** A Claude topic file that has a pointer line in
 * `MEMORY.md` leaves that line behind, because finding it would mean parsing the index's prose —
 * and *"Do not infer anything from the text of a memory entry. Show it; do not interpret it."* ⚑
 * `MEMORY.md` is itself an entry in this reading, so a person who wants the pointer gone corrects
 * that entry. **Two acts, both recorded, and neither of them this app guessing.**
 */
export async function amendAgentMemory(
  inputs: AmendmentInputs,
  seams: MemoryWriteSeams = {},
): Promise<AmendmentOutcome> {
  const found = readAgentMemorySelection(
    inputs.provider,
    inputs.homeOf(inputs.provider),
    inputs.entry,
  )
  if (found === undefined) return { done: false, refused: 'no-such-entry', entry: inputs.entry }
  // ⛔ **Re-derived, not carried.** See the docblock: the reading a surface holds was taken when
  // the popup opened, and a link can be planted between then and the press.
  if (!amendable(found.path, found.link, rootsOf(inputs)))
    return { done: false, refused: 'somewhere-else', entry: found.path }
  // ⚠️ **The bytes as the guarded reader got them**, which is also what makes `truncated` matter:
  // a file this app could only read part of is one it must not rewrite from that part.
  if (found.truncated) return { done: false, refused: 'unreadable', entry: found.path }
  try {
    if (inputs.act === 'removed') unlinkSync(found.path)
    else await rewrite(found.path, inputs.text, inputs.homesRoot, seams)
  } catch {
    return { done: false, refused: 'write-failed', entry: found.path }
  }
  return { done: true, entry: found.path, textBefore: found.text }
}

/** What a correction's write asks of the system; Windows' own by default. */
export interface MemoryWriteSeams {
  /** Test-only interleaving immediately before a confirmed memory unlink. */
  readonly beforeMemoryUnlink?: () => void
  readonly platform?: NodeJS.Platform
  readonly lists?: AccessLists
  /** A filesystem interleaving immediately before the final creation checks. */
  readonly beforeStageCreate?: (folder: string) => void
  /** An interleaving after a prepared knowledge stage was checked, before its publish-time open. */
  readonly beforeStagePublishOpen?: (stage: string) => void
  /** Where the one line about a shared data folder goes; the console by default. */
  readonly warn?: (line: string) => void
}

/**
 * A correction's staging filename: `.<entry>.brobot-<24 hex digits>` ({@link aStagingName}), or
 * `.<entry>.brobot-<pid>-<n>`, as builds before random names left them.
 */
const STAGED = /^\..+\.brobot-(?:[0-9a-f]{24}|\d+-\d+)$/

/** The staged corrections this process is writing now. */
const writing = new Set<string>()

/** A private byte image, prepared before a knowledge operation starts publishing its files. */
export interface KnowledgeFileStage {
  /** The caller rechecks its stored intent and fresh baseline immediately before publication. */
  install(replace: boolean, check: () => void): void
  /** Idempotent; a replaced or redirected staging name is never removed. */
  discard(): void
}

/**
 * Prepare bounded exact bytes using the memory writer's private staging hierarchy. This internal
 * helper grants no path authority: main derives the destination and supplies its intent guard.
 * An absent destination is installed exclusively; replacing a file replaces only its named entry.
 */
export async function stageKnowledgeFile(
  path: string,
  bytes: Buffer,
  mode: number,
  homesRoot: string,
  check: () => void,
  seams: MemoryWriteSeams = {},
): Promise<KnowledgeFileStage> {
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o777 || bytes.length > 64 * 1024)
    throw new Error('The knowledge file image is invalid')
  const contents = Buffer.from(bytes)
  const root = resolve(homesRoot)
  const destination = resolve(path)
  const part = relative(root, dirname(destination))
  if (part === '..' || part.startsWith(`..${sep}`) || isAbsolute(part))
    throw new Error('The knowledge destination is outside the managed root')
  const hierarchy = [directoryIdentity(root)]
  let cursor = root
  for (const segment of part.split(sep).filter(Boolean)) {
    cursor = join(cursor, segment)
    hierarchy.push(directoryIdentity(cursor))
  }
  const validate = () => {
    for (const directory of hierarchy) checkDirectory(directory)
    check()
  }
  validate()
  const platform = seams.platform ?? process.platform
  let privateStage = platform === 'win32' ? await stageIfPrivate(root, seams) : null
  if (privateStage !== null && hierarchy[hierarchy.length - 1]?.dev !== privateStage.dev)
    privateStage = null
  validate()
  const stageFolder = privateStage?.path ?? dirname(destination)
  const stageDirectories = privateStage?.hierarchy ?? hierarchy
  const validateStageFolder = () => {
    for (const directory of stageDirectories) checkDirectory(directory)
  }
  seams.beforeStageCreate?.(stageFolder)
  validateStageFolder()
  validate()
  const staged = aStagingName(join(stageFolder, `.${basename(destination)}`))
  const fd = createFreshFile(staged)
  let born: BigIntStats
  try {
    born = fstatSync(fd, { bigint: true })
  } catch (error) {
    closeSync(fd)
    throw error
  }
  writing.add(staged)
  let prepared: BigIntStats
  const namedStage = (expected: BigIntStats): void => {
    validateStageFolder()
    const actual = lstatSync(staged, { bigint: true })
    if (
      !actual.isFile() ||
      actual.isSymbolicLink() ||
      actual.dev !== expected.dev ||
      actual.ino !== expected.ino ||
      actual.size !== expected.size ||
      actual.mtimeNs !== expected.mtimeNs ||
      actual.ctimeNs !== expected.ctimeNs
    )
      throw new Error('The prepared knowledge file was replaced or changed')
  }
  const removeOwnStage = () => {
    try {
      validateStageFolder()
      const actual = lstatSync(staged, { bigint: true })
      if (
        actual.isFile() &&
        !actual.isSymbolicLink() &&
        actual.dev === born.dev &&
        actual.ino === born.ino
      )
        unlinkSync(staged)
    } catch {
      // A redirected or unavailable stage remains for recovery; never remove an unrelated entry.
    }
  }
  try {
    try {
      await sharedOnlyLogged(staged, seams, platform)
      validate()
      namedStage(born)
      if (platform === 'win32' && !isStillTheFileOpened(staged, fd))
        throw new Error('The knowledge staging file changed while its privacy was checked')
      writeFileSync(fd, contents)
      fsyncSync(fd)
      prepared = fstatSync(fd, { bigint: true })
    } finally {
      closeSync(fd)
    }
    namedStage(prepared)
  } catch (error) {
    removeOwnStage()
    writing.delete(staged)
    throw error
  }
  let active = true
  return {
    install(replace, guard) {
      if (!active) throw new Error('The prepared knowledge file has already been consumed')
      validate()
      guard()
      namedStage(prepared)
      seams.beforeStagePublishOpen?.(staged)
      const publishing = openSync(
        staged,
        constants.O_RDWR | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
      )
      try {
        const opened = fstatSync(publishing, { bigint: true })
        if (
          opened.dev !== prepared.dev ||
          opened.ino !== prepared.ino ||
          !opened.isFile() ||
          opened.size !== prepared.size ||
          opened.mtimeNs !== prepared.mtimeNs ||
          opened.ctimeNs !== prepared.ctimeNs ||
          (platform === 'win32' && !isStillTheFileOpened(staged, publishing))
        )
          throw new Error('The prepared knowledge file was replaced before publication')
        fchmodSync(publishing, mode)
        fsyncSync(publishing)
        prepared = fstatSync(publishing, { bigint: true })
      } finally {
        closeSync(publishing)
      }
      namedStage(prepared)
      if (replace) {
        renameSync(staged, destination)
      } else {
        // Hard-link creation fails if the name exists, including a file recreated after Delete.
        linkSync(staged, destination)
        removeOwnStage()
      }
      active = false
      writing.delete(staged)
    },
    discard() {
      if (!active) return
      active = false
      removeOwnStage()
      writing.delete(staged)
    },
  }
}

/**
 * Replace a file's bytes without opening it: write a fresh file exclusively and rename it over
 * the entry, keeping its mode. Windows stages live under the verified private managed homes root;
 * elsewhere they are beside the entry.
 *
 * ⛔ **The containment check above asks where the path leads, before the write; this asks nothing
 * of whatever is at the path by then.** A rename replaces the entry itself, so a link put there
 * after the check is replaced, never written through — on Windows too, where an open would follow
 * it — and a file with a second name elsewhere keeps its bytes there. A link already there is
 * refused. A reader sees the old file or the new one, never part of either.
 *
 * On Windows, stages are born inside a verified private folder on the same volume, so another
 * account cannot acquire a read handle before the correction is written. Their inherited ACL is
 * checked without changing it. Elsewhere the mode does that.
 *
 * Windows crash stages remain private and are not automatically deleted. Elsewhere, staged files
 * a crash left in the folder are removed first.
 */
async function rewrite(
  path: string,
  text: string,
  homesRoot: string | null,
  seams: MemoryWriteSeams,
): Promise<void> {
  const platform = seams.platform ?? process.platform
  const folder = dirname(path)
  if (platform !== 'win32') sweepStaged(folder)
  const before = lstatSync(path)
  if (!before.isFile()) throw new Error(`${path} is not a regular file, so it was not rewritten`)
  let privateStage = platform === 'win32' ? await stageIfPrivate(homesRoot, seams) : null
  if (privateStage !== null && lstatSync(path, { bigint: true }).dev !== privateStage.dev)
    privateStage = null
  const stageFolder = privateStage?.path ?? folder
  const staged = aStagingName(join(stageFolder, `.${basename(path)}`))
  if (privateStage !== null) {
    seams.beforeStageCreate?.(stageFolder)
    for (const directory of privateStage.hierarchy) checkDirectory(directory)
  }
  const fd = createFreshFile(staged)
  writing.add(staged)
  try {
    try {
      await sharedOnlyLogged(staged, seams, platform)
      if (platform === 'win32' && !isStillTheFileOpened(staged, fd)) {
        throw new Error(`${staged} was replaced as it was made private`)
      }
      writeFileSync(fd, text, 'utf8')
      fchmodSync(fd, before.mode & 0o7777)
    } finally {
      closeSync(fd)
    }
    renameSync(staged, path)
  } catch (error) {
    if (platform !== 'win32') {
      try {
        unlinkSync(staged)
      } catch {
        // best effort: the reason below is what matters
      }
    }
    throw error
  } finally {
    writing.delete(staged)
  }
}

/** A directory's exact disk identity, retained until the stage is created. */
interface StageDirectory {
  readonly path: string
  readonly dev: bigint
  readonly ino: bigint
}

interface PrivateStage {
  readonly path: string
  readonly dev: bigint
  readonly hierarchy: readonly StageDirectory[]
}

/** A shared preparation prevents another correction from creating a file before the ACL is ready. */
const preparingStages = new Map<string, Promise<PrivateStage>>()

function directoryIdentity(path: string): StageDirectory {
  let stat = lstatSync(path, { bigint: true })
  // A link the person made to keep a folder elsewhere is followed; its folder's identity is checked.
  if (stat.isSymbolicLink()) stat = statSync(path, { bigint: true })
  if (!stat.isDirectory() || stat.ino === 0n) {
    throw new Error('The correction staging hierarchy is not a numbered directory')
  }
  return { path, dev: stat.dev, ino: stat.ino }
}

/** A folder replaced while it was in use: this one still refuses. */
class StagingReplaced extends Error {}

function checkDirectory(expected: StageDirectory): void {
  const actual = directoryIdentity(expected.path)
  if (actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new StagingReplaced('The correction staging hierarchy was replaced')
  }
}

/** Said once: a data folder others may read never stops a memory or a saved method being written. */
let sharedSaid = false
function sayShared(why: unknown, seams: MemoryWriteSeams): void {
  if (sharedSaid) return
  sharedSaid = true
  ;(seams.warn ?? ((line: string) => console.warn(line)))(
    `BroCrew writes memories and saved methods beside them, since other accounts may read its data folder: ${why instanceof Error ? why.message : String(why)}`,
  )
}

/** The private stage on Windows, or null to stage beside the file as elsewhere when there is none. */
async function stageIfPrivate(
  homesRoot: string | null,
  seams: MemoryWriteSeams,
): Promise<PrivateStage | null> {
  try {
    return await privateStageFolder(homesRoot, seams)
  } catch (error) {
    if (error instanceof StagingReplaced) throw error
    sayShared(error, seams)
    return null
  }
}

async function sharedOnlyLogged(
  staged: string,
  seams: MemoryWriteSeams,
  platform: NodeJS.Platform,
): Promise<void> {
  try {
    await verifyFileToThisUser(staged, seams.lists, platform)
  } catch (error) {
    sayShared(error, seams)
  }
}

function privateStageFolder(
  homesRoot: string | null,
  seams: MemoryWriteSeams,
): Promise<PrivateStage> {
  if (homesRoot === null) return Promise.reject(new Error('The managed homes root is unavailable'))
  const staged = join(homesRoot, '.brobot-stage')
  const waiting = preparingStages.get(staged)
  if (waiting !== undefined) return waiting
  // Whatever the privacy reads say, a folder replaced while they ran is refused; only a privacy
  // failure lets the caller stage beside the file instead.
  const keptPrivate = async (directory: StageDirectory): Promise<void> => {
    try {
      await verifyFileToThisUser(directory.path, seams.lists, 'win32')
      await keepToThisUser(directory.path, seams.lists, 'win32')
    } finally {
      checkDirectory(directory)
    }
  }
  const prepare = async (): Promise<PrivateStage> => {
    const hierarchy: StageDirectory[] = []
    for (const path of [dirname(homesRoot), homesRoot]) {
      const directory = directoryIdentity(path)
      hierarchy.push(directory)
      await keptPrivate(directory)
    }
    mkdirSync(staged, { recursive: true, mode: 0o700 })
    const directory = directoryIdentity(staged)
    hierarchy.push(directory)
    await keptPrivate(directory)
    return { path: staged, dev: directory.dev, hierarchy }
  }
  const pending = prepare().finally(() => {
    if (preparingStages.get(staged) === pending) preparingStages.delete(staged)
  })
  preparingStages.set(staged, pending)
  return pending
}

/** Removes the staged corrections in `folder` that no write here is using: a crash left them. */
function sweepStaged(folder: string, check?: () => void): void {
  let names: string[]
  try {
    names = readdirSync(folder)
  } catch {
    return
  }
  for (const name of names) {
    const path = join(folder, name)
    if (!STAGED.test(name) || writing.has(path)) continue
    try {
      check?.()
      if (lstatSync(path).isFile()) unlinkSync(path)
    } catch {
      // best effort: one left behind is hidden from every reading and is tried again next time
    }
  }
}

/** Sweep only inactive app stages inside a freshly guarded managed namespace. */
export function sweepKnowledgeStages(folder: string, check: () => void): void {
  check()
  sweepStaged(folder, check)
}

export interface MemoryFileSelection extends AgentMemoryInputs {
  readonly provider: Provider
  readonly entry: string
  readonly fingerprint: string
  readonly confirmed: boolean
  /** Main rechecks identity and any source record; no window supplies a function. */
  readonly check: () => void
}
export interface MemoryFileRestoration extends AgentMemoryInputs {
  /** Main loads this from the selected identity's immutable history. */
  readonly source: MemoryAmendment
  readonly confirmed: boolean
  readonly check: () => void
}
export type MemoryFileResult =
  | {
      readonly ok: true
      readonly entry: string
      readonly textBefore: string | null
      readonly textAfter: string | null
    }
  | { readonly ok: false; readonly reason: string; readonly changed?: boolean }
interface MemoryLocation {
  readonly inputs: MethodLibraryInputs
  readonly name: string
  readonly entry: string
}

/** The original eligible location in the current provider home, including an absent note. */
function memoryLocation(
  inputs: AgentMemoryInputs,
  provider: Provider,
  entry: string,
): MemoryLocation | null {
  if (inputs.homesRoot === null || !PROVIDERS.includes(provider)) return null
  const home = inputs.homeOf(provider)
  const layout = MEMORY_STORE_LAYOUT[provider]
  const fixed = layout.fixedFiles(home)
  const name = basename(entry)
  if (!safeMethodFileName(name)) return null
  const notes = layout.notesFolder(home)
  const known = fixed.includes(entry) || (dirname(entry) === notes && layout.acceptsNote(name))
  if (!known) return null
  const folder = fixed.includes(entry) ? dirname(fixed.find((path) => path === entry)!) : notes
  const derived = join(folder, name)
  if (derived !== entry) return null
  return { inputs: { homesRoot: inputs.homesRoot, folder }, name, entry: derived }
}
function memoryImage(location: MemoryLocation): MethodFileCapture | null {
  return readKnowledgeFileCapture(location.inputs, location.name)
}
function validText(image: MethodFileCapture): boolean {
  return image.bytes.equals(Buffer.from(image.bytes.toString('utf8'), 'utf8'))
}
function selectedMemory(inputs: AgentMemoryInputs, provider: Provider, entry: string) {
  if (inputs.homesRoot === null || !PROVIDERS.includes(provider)) return null
  // The caller's identifier is matched against fresh accepted names before any capture.
  const found = readAgentMemorySelection(provider, inputs.homeOf(provider), entry)
  if (found === undefined || found.truncated) return null
  const location = memoryLocation(inputs, provider, found.path)
  if (location === null) return null
  const image = memoryImage(location)
  if (image === null || !validText(image) || image.bytes.toString('utf8') !== found.text)
    return null
  return { location, image }
}
function sameMemoryImage(a: MethodFileCapture, b: MethodFileCapture | null): boolean {
  return (
    b !== null &&
    a.fingerprint === b.fingerprint &&
    a.mode === b.mode &&
    a.identity.dev === b.identity.dev &&
    a.identity.ino === b.identity.ino &&
    a.identity.mtimeNs === b.identity.mtimeNs &&
    a.identity.ctimeNs === b.identity.ctimeNs
  )
}

/** Raw displayed fingerprint, or no destructive control when the whole entry cannot be captured. */
export function memoryEntryFingerprint(
  inputs: AgentMemoryInputs,
  provider: Provider,
  entry: string,
): string | null {
  try {
    return selectedMemory(inputs, provider, entry)?.image.fingerprint ?? null
  } catch {
    return null
  }
}

/** One confirmed removal. Main records the returned before-text before acknowledging success. */
export function removeMemoryEntry(
  inputs: MemoryFileSelection,
  seams: MemoryWriteSeams = {},
): MemoryFileResult {
  if (inputs.confirmed !== true) return { ok: false, reason: 'confirmation-required' }
  try {
    const selected = selectedMemory(inputs, inputs.provider, inputs.entry)
    if (selected === null || selected.image.fingerprint !== inputs.fingerprint)
      return { ok: false, reason: 'changed-or-unreadable' }
    const namespace = captureMethodFileGuard(selected.location.inputs)
    const guard = () => {
      namespace()
      inputs.check()
      if (!sameMemoryImage(selected.image, memoryImage(selected.location)))
        throw new Error('The memory entry changed')
      namespace()
    }
    guard()
    seams.beforeMemoryUnlink?.()
    guard()
    unlinkSync(selected.location.entry)
    return {
      ok: true,
      entry: selected.location.entry,
      textBefore: selected.image.bytes.toString('utf8'),
      textAfter: null,
    }
  } catch {
    return { ok: false, reason: 'changed-or-unreadable' }
  }
}

/** Restore saved text exclusively; an existing file or redirected namespace is never replaced. */
export async function restoreMemoryEntry(
  inputs: MemoryFileRestoration,
  seams: MemoryWriteSeams = {},
): Promise<MemoryFileResult> {
  if (inputs.confirmed !== true) return { ok: false, reason: 'confirmation-required' }
  if (
    inputs.source?.act !== 'removed' ||
    typeof inputs.source.textBefore !== 'string' ||
    inputs.source.textAfter !== null
  )
    return { ok: false, reason: 'not-restorable' }
  const savedText = inputs.source.textBefore
  const sourceStamp = JSON.stringify(inputs.source)
  const provider = inputs.source.provider
  const entry = inputs.source.entry
  const bytes = Buffer.from(savedText, 'utf8')
  if (bytes.length > 64 * 1024) return { ok: false, reason: 'too-large' }
  let stage: KnowledgeFileStage | null = null
  let installed = false
  try {
    const location = memoryLocation(inputs, provider, entry)
    if (location === null) return { ok: false, reason: 'not-restorable' }
    const namespace = captureMethodFileGuard(location.inputs)
    const guard = () => {
      namespace()
      inputs.check()
      if (JSON.stringify(inputs.source) !== sourceStamp)
        throw new Error('The source record changed')
      if (memoryImage(location) !== null) throw new Error('The memory entry was recreated')
      namespace()
    }
    guard()
    sweepKnowledgeStages(location.inputs.folder, namespace)
    guard()
    stage = await stageKnowledgeFile(
      location.entry,
      bytes,
      0o600,
      location.inputs.homesRoot,
      guard,
      seams,
    )
    guard()
    stage.install(false, guard)
    installed = true
    namespace()
    const written = memoryImage(location)
    if (written === null || !written.bytes.equals(bytes))
      throw new Error('The restoration could not be verified')
    return {
      ok: true,
      entry: location.entry,
      textBefore: null,
      textAfter: savedText,
    }
  } catch {
    return {
      ok: false,
      reason: installed ? 'change-incomplete' : 'changed-or-unreadable',
      ...(installed ? { changed: true } : {}),
    }
  } finally {
    stage?.discard()
  }
}

/** The inverse still requires confirmation and refuses any changed current text. */
export function undoMemoryRestoration(
  inputs: MemoryFileRestoration,
  seams: MemoryWriteSeams = {},
): MemoryFileResult {
  if (inputs.source?.act !== 'restored' || typeof inputs.source.textAfter !== 'string')
    return { ok: false, reason: 'not-restorable' }
  const sourceStamp = JSON.stringify(inputs.source)
  return removeMemoryEntry(
    {
      ...inputs,
      check: () => {
        inputs.check()
        if (JSON.stringify(inputs.source) !== sourceStamp)
          throw new Error('The source record changed')
      },
      provider: inputs.source.provider,
      entry: inputs.source.entry,
      fingerprint: createHash('sha256')
        .update(Buffer.from(inputs.source.textAfter, 'utf8'))
        .digest('hex'),
    },
    seams,
  )
}

/** An absent entry is meaningful only inside a pinned, eligible managed namespace. */
export function observeMemoryEntry(
  inputs: AgentMemoryInputs,
  provider: Provider,
  entry: string,
): MemoryObservation {
  try {
    const location = memoryLocation(inputs, provider, entry)
    if (location === null) throw new Error('The memory location is unavailable')
    const guard = captureMethodFileGuard(location.inputs)
    guard()
    const image = memoryImage(location)
    guard()
    return { fingerprint: image?.fingerprint ?? null }
  } catch {
    return { fingerprint: null, unreadable: true }
  }
}

interface MemoryCapture {
  readonly entry: string
  readonly text: string | null
  readonly fingerprint: string | null
  readonly check: () => void
}
function captureMemoryEntry(
  inputs: AgentMemoryInputs,
  provider: Provider,
  entry: string,
  fromHistory = false,
): MemoryCapture | null {
  try {
    const selected = fromHistory ? null : selectedMemory(inputs, provider, entry)
    const location = fromHistory ? memoryLocation(inputs, provider, entry) : selected?.location
    if (location === null || location === undefined) return null
    const namespace = captureMethodFileGuard(location.inputs)
    namespace()
    const image = fromHistory ? memoryImage(location) : selected!.image
    if (image !== null && !validText(image)) return null
    const check = () => {
      namespace()
      const current = memoryImage(location)
      if (image === null ? current !== null : !sameMemoryImage(image, current))
        throw new Error('The memory entry changed')
      namespace()
    }
    check()
    return {
      entry: location.entry,
      text: image?.bytes.toString('utf8') ?? null,
      fingerprint: image?.fingerprint ?? null,
      check,
    }
  } catch {
    return null
  }
}

/** Preserve the old bytes and permissions until the synchronous replacement guard passes. */
export async function correctMemoryEntry(
  inputs: MemoryFileSelection & { readonly text: string },
  seams: MemoryWriteSeams = {},
): Promise<MemoryFileResult> {
  if (inputs.confirmed !== true) return { ok: false, reason: 'confirmation-required' }
  const bytes = Buffer.from(inputs.text, 'utf8')
  if (bytes.length > 65536 || bytes.toString('utf8') !== inputs.text)
    return { ok: false, reason: 'too-large' }
  let stage: KnowledgeFileStage | null = null
  let installed = false
  try {
    const selected = selectedMemory(inputs, inputs.provider, inputs.entry)
    if (selected === null || selected.image.fingerprint !== inputs.fingerprint)
      return { ok: false, reason: 'changed-or-unreadable' }
    const namespace = captureMethodFileGuard(selected.location.inputs)
    const guard = () => {
      namespace()
      inputs.check()
      if (!sameMemoryImage(selected.image, memoryImage(selected.location)))
        throw new Error('The memory entry changed')
      namespace()
    }
    guard()
    stage = await stageKnowledgeFile(
      selected.location.entry,
      bytes,
      selected.image.mode,
      selected.location.inputs.homesRoot,
      guard,
      seams,
    )
    stage.install(true, guard)
    installed = true
    namespace()
    const actual = memoryImage(selected.location)
    if (actual === null || !actual.bytes.equals(bytes) || actual.mode !== selected.image.mode)
      throw new Error('The correction could not be verified')
    return {
      ok: true,
      entry: selected.location.entry,
      textBefore: selected.image.bytes.toString('utf8'),
      textAfter: inputs.text,
    }
  } catch {
    return {
      ok: false,
      reason: installed ? 'change-incomplete' : 'changed-or-unreadable',
      ...(installed ? { changed: true } : {}),
    }
  } finally {
    stage?.discard()
  }
}

type MemoryServiceStore = Pick<
  SessionStore,
  | 'agentIdentities'
  | 'memoryAmendmentsOf'
  | 'memoryAmendment'
  | 'beginMemoryAmendment'
  | 'settleMemoryAmendment'
  | 'hasPendingMemoryAmendment'
>
export interface MemoryServiceInputs {
  readonly store: MemoryServiceStore
  readonly inputsOf: (slug: string) => AgentMemoryInputs
  readonly now: () => number
  /** Main binds its separate app-only observer; the service never fabricates a person. */
  readonly reconcile: (
    identity: string,
    id: string,
    actual: MemoryObservation,
    by: ActedBy,
  ) => boolean
  readonly changed?: (slug: string) => void
  readonly seams?: {
    readonly beforeEffect?: () => Promise<void>
    readonly writes?: MemoryWriteSeams
  }
}
export interface MemoryServiceEdit {
  readonly profile: string
  readonly provider: Provider
  readonly entry: string
  readonly fingerprint: string
  readonly act: MemoryEditAct
  readonly text: string
  readonly confirmed: boolean
}
export type MemoryServiceResult =
  | { readonly ok: true; readonly amendment?: MemoryAmendment }
  | { readonly ok: false; readonly reason: string; readonly amendment?: MemoryAmendment }
export type MemoryService = Awaited<ReturnType<typeof createMemoryService>>
interface MemoryOperation {
  check(): void
  canRecord(): boolean
}

/** Await this factory before constructing a host or starting any provider conversation. */
export async function createMemoryService(deps: MemoryServiceInputs) {
  let accepting = true
  let databaseAvailable = true
  let closing: Promise<void> | undefined
  const issues = new Set<string>()
  const tails = new Map<string, Promise<void>>()
  const active = new Set<Promise<void>>()
  const counts = new Map<string, number>()
  const failed = (reason: string): MemoryServiceResult => ({ ok: false, reason })
  const identity = (slug: string) =>
    isPathSegment(slug) ? deps.store.agentIdentities().find((one) => one.slug === slug) : undefined
  const announce = (slug: string) => {
    if (!databaseAvailable) return
    try {
      deps.changed?.(slug)
    } catch {
      // A window refresh cannot change the durable result.
    }
  }
  const context: MemoryOperation = {
    check: () => {
      if (!databaseAvailable) throw new Error('Memory changes have finished closing')
    },
    canRecord: () => databaseAvailable,
  }
  const exclusive = (
    slug: string,
    operation: (access: MemoryOperation) => Promise<MemoryServiceResult>,
  ): Promise<MemoryServiceResult> => {
    if (!accepting) return Promise.resolve(failed('closing'))
    const previous = tails.get(slug) ?? Promise.resolve()
    counts.set(slug, (counts.get(slug) ?? 0) + 1)
    announce(slug)
    const result = previous.then(() =>
      accepting ? operation(context) : Promise.resolve(failed('closing')),
    )
    const finish = () => {
      active.delete(settled)
      if (tails.get(slug) === settled) tails.delete(slug)
      const count = (counts.get(slug) ?? 1) - 1
      if (count === 0) counts.delete(slug)
      else counts.set(slug, count)
      announce(slug)
    }
    const settled = result.then(finish, finish)
    active.add(settled)
    tails.set(slug, settled)
    return result
  }
  const candidate = (slug: string, provider: Provider, entry: string) =>
    deps.store
      .memoryAmendmentsOf(slug)
      .find(
        (row) =>
          row.provider === provider &&
          row.entry === entry &&
          row.outcome !== 'pending' &&
          row.outcome !== 'unchanged',
      )
  const observePending = async (slug: string, app: boolean): Promise<MemoryServiceResult> => {
    context.check()
    const one = identity(slug)
    if (one === undefined) return failed('no-such-agent')
    try {
      for (const row of deps.store.memoryAmendmentsOf(slug)) {
        if (row.outcome !== 'pending') continue
        context.check()
        const actual = observeMemoryEntry(deps.inputsOf(slug), row.provider, row.entry)
        context.check()
        const recorded = app
          ? deps.reconcile(one.id, row.id, actual, { who: 'the-app-itself' })
          : deps.store.settleMemoryAmendment(slug, row.id, actual, { who: 'a-person' })
        if (!recorded) throw new Error('The interruption could not be recorded')
        // Observation never changes memory. Only hidden, inactive app stages are swept.
        const location = memoryLocation(deps.inputsOf(slug), row.provider, row.entry)
        if (location !== null) {
          const guard = captureMethodFileGuard(location.inputs)
          sweepKnowledgeStages(location.inputs.folder, guard)
          const privateFolder = join(location.inputs.homesRoot, '.brobot-stage')
          try {
            const privateGuard = captureMethodFileGuard({
              homesRoot: location.inputs.homesRoot,
              folder: privateFolder,
            })
            sweepKnowledgeStages(privateFolder, privateGuard)
          } catch {
            // A Windows stage folder need not exist on this platform.
          }
        }
      }
      if (deps.store.hasPendingMemoryAmendment(slug))
        throw new Error('An interrupted memory change is still pending')
      issues.delete(slug)
      return { ok: true }
    } catch {
      issues.add(slug)
      return failed('interruption-needs-checking')
    }
  }
  // The same lock is used at boot and for every later app writer on every platform.
  for (const one of deps.store.agentIdentities())
    await exclusive(one.slug, () => observePending(one.slug, true))

  const change = async (
    slug: string,
    plan: Omit<MemoryAmendmentWrite, 'profileSlug' | 'by'>,
    capture: MemoryCapture,
    access: MemoryOperation,
    source?: MemoryAmendment,
  ): Promise<MemoryServiceResult> => {
    access.check()
    if (identity(slug) === undefined) return failed('no-such-agent')
    if (issues.has(slug) || deps.store.hasPendingMemoryAmendment(slug)) return failed('pending')
    capture.check()
    const sourceStamp = source === undefined ? null : JSON.stringify(source)
    const sourceCurrent = () => {
      access.check()
      if (
        source !== undefined &&
        (candidate(slug, source.provider, source.entry)?.id !== source.id ||
          JSON.stringify(deps.store.memoryAmendment(slug, source.id)) !== sourceStamp)
      )
        throw new Error('The source is no longer current')
    }
    sourceCurrent()
    const row = deps.store.beginMemoryAmendment(
      { ...plan, profileSlug: slug, by: { who: 'a-person' } },
      deps.now(),
    )
    if (row === null) return failed('not-recorded')
    announce(slug)
    const guard = () => {
      sourceCurrent()
      if (identity(slug) === undefined) throw new Error('The identity changed')
      if (deps.store.memoryAmendment(slug, row.id)?.outcome !== 'pending')
        throw new Error('The pending intent changed')
      capture.check()
    }
    try {
      await deps.seams?.beforeEffect?.()
      guard()
      const inputs = deps.inputsOf(slug)
      if (plan.act === 'restored' && source !== undefined) {
        await restoreMemoryEntry(
          { ...inputs, source, confirmed: true, check: guard },
          deps.seams?.writes,
        )
      } else if (plan.act === 'removed') {
        if (capture.fingerprint === null) throw new Error('The entry is absent')
        removeMemoryEntry(
          {
            ...inputs,
            provider: plan.provider,
            entry: capture.entry,
            fingerprint: capture.fingerprint,
            confirmed: true,
            check: guard,
          },
          deps.seams?.writes,
        )
      } else if (plan.act === 'corrected' && plan.textAfter !== null) {
        if (capture.fingerprint === null) throw new Error('The entry is absent')
        await correctMemoryEntry(
          {
            ...inputs,
            provider: plan.provider,
            entry: capture.entry,
            fingerprint: capture.fingerprint,
            confirmed: true,
            check: guard,
            text: plan.textAfter,
          },
          deps.seams?.writes,
        )
      }
    } catch {
      // The observation below records no effect, a partial change, or the planned result.
    }
    if (!access.canRecord()) return failed('closing')
    try {
      access.check()
      const actual = observeMemoryEntry(deps.inputsOf(slug), plan.provider, capture.entry)
      access.check()
      if (!deps.store.settleMemoryAmendment(slug, row.id, actual, { who: 'a-person' }))
        throw new Error('The outcome was not recorded')
      announce(slug)
      const settled = deps.store.memoryAmendment(slug, row.id)
      if (settled === null) throw new Error('The recorded outcome cannot be read')
      if (settled.outcome === 'done') return { ok: true, amendment: settled }
      return {
        ok: false,
        reason: settled.outcome === 'unchanged' ? 'nothing-changed' : 'change-incomplete',
        amendment: settled,
      }
    } catch {
      issues.add(slug)
      return failed('not-recorded')
    }
  }
  const person = (
    slug: string,
    by: ActedBy,
    operation: (access: MemoryOperation) => Promise<MemoryServiceResult>,
  ) =>
    by.who !== 'a-person'
      ? Promise.resolve(failed('person-required'))
      : exclusive(slug, async (access) => {
          try {
            access.check()
            if (identity(slug) === undefined) return failed('no-such-agent')
            return await operation(access)
          } catch {
            return failed(databaseAvailable ? 'changed-or-unreadable' : 'closing')
          }
        })
  return {
    busy(slug: string): boolean {
      return (counts.get(slug) ?? 0) > 0
    },
    held(slug: string): boolean {
      if ((counts.get(slug) ?? 0) > 0 || issues.has(slug)) return true
      if (!databaseAvailable) return false
      try {
        return deps.store.hasPendingMemoryAmendment(slug)
      } catch {
        return true
      }
    },
    amend(said: MemoryServiceEdit, by: ActedBy): Promise<MemoryServiceResult> {
      return person(said.profile, by, async (access) => {
        if (said.confirmed !== true) return failed('confirmation-required')
        const capture = captureMemoryEntry(deps.inputsOf(said.profile), said.provider, said.entry)
        if (capture === null || capture.text === null || capture.fingerprint !== said.fingerprint)
          return failed('changed-or-unreadable')
        return change(
          said.profile,
          {
            provider: said.provider,
            entry: capture.entry,
            act: said.act,
            textBefore: capture.text,
            textAfter: said.act === 'removed' ? null : said.text,
          },
          capture,
          access,
        )
      })
    },
    undo(slug: string, sourceId: string, confirmed: boolean, by: ActedBy) {
      return person(slug, by, async (access) => {
        if (confirmed !== true) return failed('confirmation-required')
        const source = deps.store.memoryAmendment(slug, sourceId)
        if (
          source === null ||
          source.outcome === 'pending' ||
          source.outcome === 'unchanged' ||
          candidate(slug, source.provider, source.entry)?.id !== source.id
        )
          return failed('source-changed')
        const capture = captureMemoryEntry(deps.inputsOf(slug), source.provider, source.entry, true)
        if (capture === null) return failed('changed-or-unreadable')
        const known = source.actual
        const current = capture.fingerprint
        const hashText = (text: string | null) =>
          text === null ? null : createHash('sha256').update(text).digest('hex')
        if (
          known?.unreadable ||
          (known === undefined
            ? source.outcome === 'partial' || capture.text !== source.textAfter
            : current !== known.fingerprint ||
              (current !== hashText(source.textBefore) && current !== hashText(source.textAfter)))
        )
          return failed('source-changed')
        const restored = source.textBefore
        const act = restored === null ? 'removed' : capture.text === null ? 'restored' : 'corrected'
        return change(
          slug,
          {
            provider: source.provider,
            entry: capture.entry,
            act,
            sourceId: source.id,
            textBefore: capture.text,
            textAfter: restored,
          },
          capture,
          access,
          source,
        )
      })
    },
    checkInterrupted(slug: string, confirmed: boolean, by: ActedBy) {
      return person(slug, by, async () =>
        confirmed ? observePending(slug, false) : failed('confirmation-required'),
      )
    },
    close(waitMs = 5000): Promise<void> {
      accepting = false
      if (closing !== undefined) return closing
      closing = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            Promise.all([...active]),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, Math.max(0, Math.min(30000, waitMs)))
            }),
          ])
        } finally {
          if (timer !== undefined) clearTimeout(timer)
          databaseAvailable = false
        }
      })()
      return closing
    },
  }
}
