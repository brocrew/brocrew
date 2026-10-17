import {
  closeSync,
  existsSync,
  fchmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { aStagingName, createFreshFile, isStillTheFileOpened } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type {
  AgentMemoryEntry,
  AgentMemoryStore,
  AmendmentRefused,
  MemoryAmendmentAct,
  MemoryStoreState,
} from '../../shared/agent-memory'
import { keepToThisUser, verifyFileToThisUser, type AccessLists } from '../recovery/windows-privacy'
import {
  AGENT_MEMORY_NOTES_SHOWN,
  memoryStoreCounts,
  readAgentMemoryPage,
  readClaudeAgentMemory,
  readCodexAgentMemory,
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
const STORE_READER: Readonly<Record<Provider, (providerHome: string) => AgentMemoryStoreRead>> = {
  claude: readClaudeAgentMemory,
  codex: readCodexAgentMemory,
}

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
    // ⚠️ **Amendable only where {@link amendAgentMemory} can find it**: that door re-derives the
    // store with the launch readers, which list its first {@link AGENT_MEMORY_NOTES_SHOWN} topic files
    // or notes — so one further down is shown, and not offered for a change the door would refuse.
    const entries: AgentMemoryEntry[] = paged.memory.map((item) => {
      const reachable =
        item.kind === 'agent-memory' || paged.firstListed.includes(basename(item.path))
      return { ...item, amendable: reachable && amendable(item.path, item.link, root) }
    })
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
  /** One of `MEMORY_AMENDMENT`. */
  readonly act: MemoryAmendmentAct
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
  const store = storeFor(inputs.provider, inputs, rootsOf(inputs))
  const found = store.entries.find((item) => item.path === inputs.entry)
  if (found === undefined) return { done: false, refused: 'no-such-entry', entry: inputs.entry }
  // ⛔ **Re-derived, not carried.** See the docblock: the reading a surface holds was taken when
  // the popup opened, and a link can be planted between then and the press.
  if (!found.amendable) return { done: false, refused: 'somewhere-else', entry: found.path }
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
  readonly platform?: NodeJS.Platform
  readonly lists?: AccessLists
  /** A filesystem interleaving immediately before the final creation checks. */
  readonly beforeStageCreate?: (folder: string) => void
}

/**
 * A correction's staging filename: `.<entry>.brobot-<24 hex digits>` ({@link aStagingName}), or
 * `.<entry>.brobot-<pid>-<n>`, as builds before random names left them.
 */
const STAGED = /^\..+\.brobot-(?:[0-9a-f]{24}|\d+-\d+)$/

/** The staged corrections this process is writing now. */
const writing = new Set<string>()

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
  const privateStage = platform === 'win32' ? await privateStageFolder(homesRoot, seams) : null
  const stageFolder = privateStage?.path ?? folder
  const staged = aStagingName(join(stageFolder, `.${basename(path)}`))
  if (privateStage !== null) {
    seams.beforeStageCreate?.(stageFolder)
    for (const directory of privateStage.hierarchy) checkDirectory(directory)
    if (lstatSync(path, { bigint: true }).dev !== privateStage.dev) {
      throw new Error('The correction staging folder is not on the entry’s volume')
    }
  }
  const fd = createFreshFile(staged)
  writing.add(staged)
  try {
    try {
      await verifyFileToThisUser(staged, seams.lists, platform)
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
  const stat = lstatSync(path, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino === 0n) {
    throw new Error('The correction staging hierarchy is not a numbered directory')
  }
  return { path, dev: stat.dev, ino: stat.ino }
}

function checkDirectory(expected: StageDirectory): void {
  const actual = directoryIdentity(expected.path)
  if (actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new Error('The correction staging hierarchy was replaced')
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
  const prepare = async (): Promise<PrivateStage> => {
    const hierarchy: StageDirectory[] = []
    // A shared data folder is never tightened here: correction is refused instead. Both existing
    // parents must already be private, so another account cannot replace the staging directory.
    for (const path of [dirname(homesRoot), homesRoot]) {
      const directory = directoryIdentity(path)
      await verifyFileToThisUser(path, seams.lists, 'win32')
      await keepToThisUser(path, seams.lists, 'win32')
      checkDirectory(directory)
      hierarchy.push(directory)
    }
    mkdirSync(staged, { recursive: true, mode: 0o700 })
    const directory = directoryIdentity(staged)
    await verifyFileToThisUser(staged, seams.lists, 'win32')
    await keepToThisUser(staged, seams.lists, 'win32')
    checkDirectory(directory)
    hierarchy.push(directory)
    return { path: staged, dev: directory.dev, hierarchy }
  }
  const pending = prepare().finally(() => {
    if (preparingStages.get(staged) === pending) preparingStages.delete(staged)
  })
  preparingStages.set(staged, pending)
  return pending
}

/** Removes the staged corrections in `folder` that no write here is using: a crash left them. */
function sweepStaged(folder: string): void {
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
      if (lstatSync(path).isFile()) unlinkSync(path)
    } catch {
      // best effort: one left behind is hidden from every reading and is tried again next time
    }
  }
}
