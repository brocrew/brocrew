import { THIS_CONVERSATION_HEADER } from './instruction-headings'
export { THIS_CONVERSATION_HEADER } from './instruction-headings'
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  readlinkSync,
  realpathSync,
  statSync,
  type Stats,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import {
  AUTO_MEMORY_INDEX,
  claudeAutoMemoryDir,
  claudeAutoMemoryIndex,
  CODEX_MEMORY_PIPELINE_FILES,
  CODEX_MEMORY_STORE_FILES,
  CODEX_MEMORY_SUMMARY,
  codexAdHocNotesDir,
  codexMemoryDir,
  isClaudeMemoryTopic,
} from '@brobot2/runtime'
import { providerValue, type Provider } from '@brobot2/shared'
import { agentPreamble, type PromptIdentity } from './agent-preamble'
import type { BundlePublish } from './profile-bundle'
// ⚑ **583 · which part of the compiled bundle is whose** — see `InjectedInstruction.sections`.
import type { InstructionSpan } from '../../shared/whose-text'
import type {
  InjectedInstruction,
  InjectedInstructionKind,
  MemoryLoadedEvent,
  RefusedInstruction,
  SessionInstructions,
} from '../../shared/runtime-ipc'

/**
 * **The memory files a Claude session is launched with — read here, appended as inert text** (158).
 *
 * ## Why this module exists at all
 *
 * The CLI loads the repo's `CLAUDE.md` and the user's own memory. BroBot loaded neither, for any
 * repo, ever — measured by 156 §4 and stated there in one sentence: *"No BroBot Claude session
 * currently reads a repository's native `CLAUDE.md`."* 160's rule is match the CLI unless the reason
 * is neighbours, and this gap has no neighbour reason. It is just missing.
 *
 * ## Why we read the files instead of asking the provider to
 *
 * ⛔ **`settingSources` stays `[]`.** 156 §5 went through the pinned SDK field by field: it is a
 * filesystem-CONFIGURATION gate, not an instruction selector. Turning on `user` re-admits
 * `settings.json`, permission rules, lifecycle and command HOOKS, environment variables, plugins,
 * skills and executable helpers from the profile home; turning on `project` re-admits all of that
 * from a directory **the agent can write** — one turn plants what the next launch executes.
 *
 * So the app reads the files itself and appends them through the preset Claude Code already uses
 * (`systemPrompt: { type: 'preset', preset: 'claude_code', append }`). Text enters the prompt;
 * every executable and configuration channel stays shut. That is a narrower claim than a sandbox
 * and 156 says so out loud: instructions still steer a model. It is not nothing, and it is not
 * containment.
 *
 * ## 🔴 733 · The reader follows links, as the CLI does (R92, R93)
 *
 * Follow instruction-file links, including a linked `.claude` directory, consistently with
 * the CLI's loading of `<providerHome>/memory/MEMORY.md`. Read only regular files with a size
 * cap, and verify the opened descriptor identifies the file checked before opening.
 *
 * ⚠️ **What stays in {@link readInstructionFile}, and none of it is about a credential**: the target
 * must be a regular file (a link to a FIFO would block the launch forever), the descriptor must be
 * the file that was checked (a path swapped between the two), the cap is enforced during the read,
 * the decode is strict, a chain of links that LOOPS is refused as `symlink`, and a link whose far
 * end is gone is `absent` — as the provider's own `stat` makes it — and, on a `CLAUDE.md` spelling
 * or a `.claude` directory, a person is still TOLD (`dangling-link`, {@link brokenMemoryLink}; a
 * dangling `AGENTS` file was silent before `733` and is still). ⚑ **Followed links are DISCLOSED**
 * on the item's `link`, and **one file reached by two names is sent once** (`same-file`).
 *
 * ⚑ **The home boundary of the WALK stays, and it is not a credential rule**: a profile's identity
 * is its own home (156 §1), and {@link projectInstructionChain} keeps the person's own home off the
 * walk as DIRECTORIES. 🔴 **But a LINK that lands in it is followed, as the CLI follows it** (`736`,
 * `733` F-1, R92): measured (`736`'s scratch of the bundled CLI, 2.1.281) — a project `CLAUDE.md`
 * that is a link to `~/.claude/CLAUDE.md` or to `~/CLAUDE.md` is SENT, once, as *"Contents of
 * <the project's CLAUDE.md> (project instructions, checked into the codebase)"*. ⛔ `733` refused it
 * as `personal-home`, a rule of this app's own at the leaf; it is gone.
 * ⚑ **And one refusal of a WORKING link stays**: a Codex `notes/` directory that is a link is not
 * listed, and its reason is the store's shape rather than a credential — see {@link memoryDirNames}.
 *
 * ## Codex is appended no FILE, and that is not an omission
 *
 * ⛔ **This heading read *"Codex is not APPENDED to"* until D-024**, which sends it one text.
 *
 * Codex reads `$CODEX_HOME/AGENTS.md` and its own project chain natively (156 §3), so injecting for
 * Codex would duplicate what the provider already loaded. What Codex *does* need is the other half
 * of 158 — the list it reports back has never been surfaced — and that comes off the handle, not
 * from here. See {@link SessionInstructions.provider}.
 *
 * ⚑ **D-024 · R1 — the one text sent to it is what is true of this conversation.** No file can
 * carry that for one conversation of a profile — the profile's file is shared by all of them — so
 * it rides the launch ({@link InstructionInputs.thisConversation}). 🔴 **In front of the first
 * message of every life, never as `developerInstructions`**
 * ({@link SessionLaunchRead.firstTurnLead}): a `collaborationMode` update overrides that field
 * (`552`), and D-024's review measured a `thread/resume`'s copy never reaching the model on the
 * bundled 0.146.0 — the thread keeps what it STARTED with — so a wake would have gone on reading
 * its first launch's list.
 *
 * ## 🔴 …but its MEMORY is here now, and the sentence that said otherwise was ours (317)
 *
 * ⛔ **This heading used to read *"Codex is not here"*, and the branch below said Codex *"has no
 * agent-written memory of its own"*.** Both were true at 165 and 156 measured them. **314 made them
 * false in this repository**, by switching `[features] memories` and `[memories] dedicated_tools`
 * on for every Codex profile — after which `$CODEX_HOME/memories/` is written by the agent, one
 * file of it is injected by the provider into every request, and this module went on reporting
 * `agentMemory: null` for every Codex session.
 *
 * > 🔴 **625 · that last clause is PAST TENSE and it has been read as present.** ⛔ A dispatch
 * > brief quoted it as a current fact — *"`agentMemory: null` for every Codex session"* — and
 * > built a section on the premise that Codex memory is unread. ⚑ **It is read**: the branch below
 * > calls {@link readCodexAgentMemory} and sets `agentMemory: codex.memory`, and
 * > `memory-without-a-conversation.test.ts` §1 asserts it against a planted store rather than
 * > against this paragraph. ⚠️ `a-description-hardens-into-a-ruling-in-the-docblock-it-leaves`,
 * > arriving through a correction that kept the old sentence so the change would be checkable.
 *
 * The pinned Codex app-server emits no `item/*` event for a memory call. Show the files the agent wrote through {@link readCodexAgentMemory} so requested memories remain visible.
 */

/**
 * The most we will read from any ONE file.
 *
 * ⚠️ A number rather than "whatever is there": this text goes into every request of the
 * conversation, so an accidental 40 MB log named `CLAUDE.md` is a cost question before it is a
 * safety one. 64 KiB is far above any real memory file and far below anything that would hurt.
 */
export const INSTRUCTION_FILE_CAP = 64 * 1024

/**
 * …and the most we will append in total, across every file on the chain.
 *
 * ⛔ **It bounds what is EMITTED, not the sum of the file sizes** (187 §2, from 168 M2). It used to
 * bound the latter, which is not the same number: {@link composeSystemHint} adds a preamble and one
 * `Contents of <path> (<scope>):` header per file, so a chain that measured exactly 256 KiB of file
 * bytes went out at 256 KiB **plus every header** — the cap advertised here and the cap applied were
 * different figures, and the difference grew with the number of files. The preamble and each block's
 * own overhead are charged against this budget now, and `instructions.test.ts` weighs the composed
 * string rather than the reads. ⚑ **D-024 · R1 — so is this conversation's own block**, reserved
 * before any file is granted, since it is never dropped.
 */
export const INSTRUCTION_TOTAL_CAP = 256 * 1024

/**
 * 🔴 **…and the most we will read from the agent's own memory STORE, across every file in it**
 * (317 §3).
 *
 * ## ⛔ Why this is a second budget and not a share of the one above
 *
 * {@link readClaudeAgentMemory} has ruled since 165 that agent memory *"does not draw on
 * {@link INSTRUCTION_TOTAL_CAP}, deliberately — that budget exists to bound what we APPEND to the
 * prompt, and this text is not appended, so spending the budget on it would silently shrink the
 * profile and project memory that is."* ⚠️ **That ruling stands and this does not weaken it.** What
 * it never said is that the memory read is therefore unbounded, which was fine while memory meant
 * one 64 KiB file and stopped being fine the moment 314 turned on a Codex store that grows a
 * rollout summary per conversation.
 *
 * ⚠️ **The same number as the append cap, and a separate accumulator.** Same number because it is
 * the same kind of judgement about how much text a panel and one IPC message should carry; separate
 * because a profile with a large memory must not be able to evict the `CLAUDE.md` files that
 * actually reach the model.
 *
 * ⚑ **Two 64 KiB files can never crowd out every note**: the two fixed Codex files cost at most
 * `2 × INSTRUCTION_FILE_CAP` and this is four times that, so the notes a person asked for always
 * have room. That relationship is asserted rather than assumed — see `instructions.test.ts`.
 */
export const AGENT_MEMORY_TOTAL_CAP = 256 * 1024

/**
 * ⚠️ **…and the most single memories we will LIST out of one store**, whatever the byte budget says
 * (317 §3).
 *
 * A byte cap alone bounds the read and not the panel: 312's notes are one line each, so 256 KiB of
 * them is upwards of a thousand rows in a drawer whose whole design is *"the paths are the
 * disclosure"*.
 *
 * ⚑ **What is not listed is SAID, in the note sentence, with its count** — never dropped in
 * silence. That is 187 §2's rule about a dropped source honoured in the field whose documented job
 * is to make the list above readable as complete; a row each would be the noise 086 rules against
 * in the other direction.
 *
 * ## ⚠️ Corrected in place at 322 (142), because it named one store and now governs two
 *
 * It said *"the most **ad-hoc notes** we will list"* and *"⛔ **Newest first**, because the note a
 * person is looking for is the one they just asked for"*. ⛔ **Both were true of Codex and neither
 * generalises**: Claude's store is topic files — `user_role.md`, `feedback_testing.md` — with no
 * timestamp in the name and no *"just asked for"* to be newest, so `claudeMemoryTopics` lists them
 * by name ASCENDING and `adHocNotes` keeps 317's descending order. ⚑ **The cap is the same number
 * for both** because it answers the same question — how many file rows a person reads at once
 * before a list stops being a list — and the ORDER is each store's own, stated where it is chosen.
 */
export const AGENT_MEMORY_NOTES_SHOWN = 20

/** The filename, fixed. Never a pattern, never a directory listing — one name, at known places. */
export const INSTRUCTION_FILENAME = 'CLAUDE.md'

/** The other spelling the CLI reads at every level of the chain (156's control measured both). */
export const INSTRUCTION_DOTDIR = '.claude'

/**
 * What was wrong with a file we would not read.
 *
 * ⚠️ **`symlink` no longer means *"a link, not followed"*** (`733`): the reader follows links, so
 * it means a chain of links that leads round in a LOOP, or a path swapped between the check and
 * the read — and, on {@link memoryDirNames}' one kept rule, a Codex `notes/` directory that is a
 * link. ⛔ The word stays because `memory_note` rows in a ledger carry it as it was written.
 */
export type InstructionRefusal =
  'symlink' | 'not-a-regular-file' | 'too-large' | 'not-utf8' | 'unreadable'

export type InstructionRead =
  | {
      ok: true
      text: string
      bytes: number
      truncated: boolean
      /**
       * The path the filesystem agrees with — where the links, if any, led. The caller that
       * DISPLAYS compares it against its own derivation and discloses a mismatch; see
       * {@link readClaudeAgentMemory}. (Set on every read since `733`, when every read follows.)
       */
      real?: string
    }
  | { ok: false; reason: InstructionRefusal }
  /** Nothing is there. Not a refusal — the ordinary case, and it is reported as nothing at all. */
  | { ok: false; reason: 'absent' }

/**
 * **Read one instruction file, or refuse it and say why.**
 *
 * The sequence, in this order and no other:
 *
 * 1. **`stat`** — links followed, as the CLI's own read follows them (`733`, R93; see the module
 *    note). A link whose far end is gone is `absent`; a chain of links that loops is `symlink`.
 * 2. **A regular file, before anything is opened** — a link to a directory or a FIFO fails here,
 *    which is what keeps a named pipe from blocking the launch forever.
 * 3. **`fstat` on the descriptor** — the thing we actually hold, not the thing at the path. Regular
 *    file, and the same `dev`/`ino` the `stat` saw: a path swapped in the gap fails this compare.
 * 4. **Read through that one descriptor**, in fixed chunks, stopping at the cap. ⛔ The cap is
 *    enforced DURING the read, not by allocating the file's reported size — a file that grows
 *    between `fstat` and `read` must not be able to grow the buffer.
 * 5. **Strict UTF-8.** `fatal: true`, so invalid bytes are a refusal rather than a prompt full of
 *    replacement characters. A leading BOM is consumed by the decoder and does not reach the model.
 *
 * ⚠️ **Truncation is reported, never silent.** A file cut at the cap comes back `truncated: true`,
 * and the UI shows that beside the text — the model got this much, and the user must be able to see
 * that it got no more.
 *
 * 🔴 **`733` · there is no `follow` option any more.** From 170 §2 until `733` it was `false` for
 * everything appended to the prompt — `lstat` first, then `open(O_NOFOLLOW)` — so a `CLAUDE.md`
 * that was a link was refused, for the credential it might point at. ⚑ Every rule left above is
 * about a loop, a missing target, a FIFO, a swap or the bytes; none of them is about a credential.
 */
export function readInstructionFile(path: string, cap = INSTRUCTION_FILE_CAP): InstructionRead {
  let seen: Stats
  try {
    seen = statSync(path)
  } catch (error) {
    // ENOENT is the ordinary case — most directories have no `CLAUDE.md` — and it is not a
    // refusal. Anything else (a permission wall, a broken mount) is, because we cannot say the
    // file is absent when what we learned is that we could not look.
    //
    // ⚠️ A DANGLING link is ENOENT and therefore `absent` — which is also what the provider's own
    // `stat` makes of it, so nothing reached the model and there is nothing to report. ⚑ A LOOP is
    // ELOOP, and it is refused as a link: there is no file at the end of it to read.
    if (isAbsent(error)) return { ok: false, reason: 'absent' }
    return { ok: false, reason: isSymlinkError(error) ? 'symlink' : 'unreadable' }
  }
  if (!seen.isFile()) return { ok: false, reason: 'not-a-regular-file' }

  let fd: number
  try {
    // ⚠️ **`O_NONBLOCK`, for the swap step 2 cannot see** (`733` review): a link retargeted at a
    // FIFO between the `stat` and this `open` would otherwise block the main process on the open
    // itself. On a regular file it changes nothing; the `fstat` below then refuses the FIFO.
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0))
  } catch (error) {
    // ⚠️ ELOOP here is a path that became a loop after the `stat` above.
    return { ok: false, reason: isSymlinkError(error) ? 'symlink' : 'unreadable' }
  }
  try {
    const held = fstatSync(fd)
    if (!held.isFile()) return { ok: false, reason: 'not-a-regular-file' }
    // The descriptor and the path we checked must be the SAME file. This is the TOCTOU close: a
    // rename or a swap between step 1 and step 2 changes the inode, and nothing else here would
    // notice: `stat` and `fstat` disagree exactly when the path was swapped between them.
    if (held.ino !== seen.ino || held.dev !== seen.dev) return { ok: false, reason: 'symlink' }

    const chunks: Buffer[] = []
    const buffer = Buffer.allocUnsafe(16 * 1024)
    let total = 0
    let truncated = false
    for (;;) {
      // `null` position: read sequentially through this descriptor, never re-opening the path.
      const read = readSync(fd, buffer, 0, buffer.length, null)
      if (read === 0) break
      const room = cap - total
      if (read >= room) {
        chunks.push(Buffer.from(buffer.subarray(0, room)))
        total += room
        // Only truncated if there was actually more to keep — a file that ends exactly on the cap
        // was read whole, and saying otherwise would be a warning about nothing.
        truncated = read > room || readSync(fd, buffer, 0, 1, null) > 0
        break
      }
      chunks.push(Buffer.from(buffer.subarray(0, read)))
      total += read
    }

    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
    } catch {
      // ⚠️ A truncated read can split a multi-byte character, which would refuse a perfectly good
      // UTF-8 file for the cap's sake. Drop the trailing partial sequence and decode again; only a
      // file that is still invalid after that is refused.
      const trimmed = dropPartialTail(Buffer.concat(chunks))
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(trimmed)
      } catch {
        return { ok: false, reason: 'not-utf8' }
      }
    }
    return { ok: true, text, bytes: total, truncated, real: realPath(path) }
  } catch {
    return { ok: false, reason: 'unreadable' }
  } finally {
    try {
      closeSync(fd)
    } catch {
      // best-effort: the read is done either way
    }
  }
}

function isAbsent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function isSymlinkError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === 'ELOOP' || code === 'EMLINK'
}

/**
 * 🔒 **The path the filesystem agrees with** — the one predicate every decision in this module is
 * now made on (170 §4).
 *
 * ⛔ **`O_NOFOLLOW` (which the reader used until `733`) guards the LAST component only, and three
 * separate rules here were written as though it guarded the path.** 168 found the same fact three ways; the one that reaches furthest is
 * H4 — `/tmp/home-alias -> $HOME` is not lexically below the personal home, so
 * {@link projectInstructionChain}'s exclusion never fired, the walk reached
 * `/tmp/home-alias/.claude/CLAUDE.md`, the leaf looked perfectly ordinary at the end of it, and
 * BroBot appended the user's personal memory to the prompt under the alias's name.
 *
 * ⚠️ **It climbs to the deepest existing ancestor** rather than giving up, the same way
 * `real-path.ts`'s `realResolve` does and for the same reason: the thing being compared often does
 * not exist yet — a `CLAUDE.md` that is not there is the ordinary case at every level of the chain —
 * and falling back to the lexical spelling would put the untrusted half of the comparison back.
 *
 * ⛔ **…and until 188 that sentence was a description of something else** (182 L2). It tried the
 * path and then its IMMEDIATE parent, and gave up to the lexical spelling after two. Two levels
 * happen to be enough for every call site here — cwd ancestors exist, provider homes exist, and a
 * missing instruction leaf sits in a directory that does not — so this was a helper-contract defect
 * rather than a live bypass. It is the shape 171 ruled on all the same: **a committed comment
 * stating a false machine fact is worse than none**, and the one that says "deepest existing
 * ancestor" is read by the next person deciding whether they may call this on a deeper path. Made
 * true rather than corrected, because the true version is the one every caller already assumed.
 *
 * ⚠️ **Deliberately not `real-path.ts`'s `realResolve`, which it is otherwise the twin of.** That
 * one returns `null` for a dangling final symlink, because it answers "may this write through?" and
 * a destination that cannot be established must not be answered with a guess (183, from 182 H1). This one answers "which
 * path is this, really?" for a comparison and a display, and has no null to return; a link whose
 * far end is gone is the READER's to answer ({@link readInstructionFile}: `absent`), on the
 * descriptor rather than on the spelling.
 */
export function realPath(path: string): string {
  const absolute = resolve(path)
  const tail: string[] = []
  let at = absolute
  for (;;) {
    try {
      // The home boundary is containment, not display identity. Keep the filesystem's spelling so
      // a case or Unicode alias of home cannot make the walk read personal instruction files.
      return join(realpathSync.native(at), ...tail)
    } catch {
      const parent = dirname(at)
      // The filesystem root resolved to nothing, so there is no real ancestor to hang the tail on.
      // Lexical is all that is left, and every caller compares it against a real path that will
      // therefore not match — which is the fail-closed direction for all three of them.
      if (parent === at) return absolute
      tail.unshift(basename(at))
      at = parent
    }
  }
}

/**
 * Drop a trailing UTF-8 sequence the cap cut in half. At most three bytes can be pending, so this
 * walks back over continuation bytes and removes the lead byte whose sequence never completed.
 */
function dropPartialTail(bytes: Buffer): Buffer {
  for (let back = 1; back <= 3 && back <= bytes.length; back += 1) {
    const byte = bytes[bytes.length - back]!
    if ((byte & 0b1100_0000) === 0b1000_0000) continue // continuation byte — keep walking back
    const needed =
      (byte & 0b1110_0000) === 0b1100_0000
        ? 2
        : (byte & 0b1111_0000) === 0b1110_0000
          ? 3
          : (byte & 0b1111_1000) === 0b1111_0000
            ? 4
            : 1
    return needed > back ? bytes.subarray(0, bytes.length - back) : bytes
  }
  return bytes
}

/**
 * **The directories whose instructions a session at `cwd` loads, outermost first.**
 *
 * 156's zero-turn control measured what the CLI walks: the cwd and its ancestors, both spellings at
 * each level, three levels deep, ordered outermost → innermost. This matches that, and does not
 * invent a depth — the walk is bounded by a boundary rather than by a number.
 *
 * ⛔ **Where it stops: the OS home directory, and anything above it.** The CLI stops below the
 * filesystem root, which for a repo under `~` would put `~/CLAUDE.md` and `~/.claude/CLAUDE.md` on
 * the chain — and in the CLI those are the *user* scope, loaded because the CLI's config root IS
 * `~/.claude`. BroBot's config root is the per-profile provider home (156 §1), which is the whole
 * point of *"HOME is who"*: a profile's identity comes from its own home, not from the machine's.
 * Admitting the personal files through the project door would re-import, silently, exactly what the
 * per-profile home exists to keep separate. So home and its ancestors are excluded — which also
 * excludes the filesystem root, and makes the CLI's own boundary a consequence of this one rather
 * than a second rule.
 *
 * ⚠️ A session whose cwd IS the home directory therefore loads no project memory at all. That is
 * the intended edge and the note in {@link readSessionInstructions} says so.
 *
 * ## 🔴 …and *"below home"* is a question about the real path, not the spelling (170 §3, 168 H4)
 *
 * ⛔ **A symlink in a PARENT of the cwd walked straight through this boundary.** With
 * `/tmp/home-alias -> $HOME` and a cwd of `/tmp/home-alias/projects/repo`, no directory on the walk
 * is lexically at or below `$HOME`, so the exclusion never fired; the chain reached
 * `/tmp/home-alias`, its `.claude` was a real directory seen through the alias rather than a symlink,
 * the leaf `lstat` and `O_NOFOLLOW` saw an ordinary file — and BroBot read the personal
 * `~/.claude/CLAUDE.md` into the prompt and labelled it with the alias path. 164 §4 puts a sentence
 * in the generated workspace file saying the machine's instructions deliberately do not apply; this
 * made that sentence false without the agent ever naming the personal path.
 *
 * **Both spellings, and either one stops the walk.** The lexical test stays because it is the one
 * the drawer's paths are in; the real test is what closes the alias. ⚑ The chain itself is still
 * returned LEXICALLY — a user who typed a path must see the path they typed, and rewriting every
 * entry to its real form would change what the drawer shows for every ordinary session on a machine
 * where `/tmp` or `/var` is a link.
 */
export function projectInstructionChain(cwd: string, home = homedir()): string[] {
  const homeResolved = resolve(home)
  const homeReal = realPath(homeResolved)
  const chain: string[] = []
  let dir = resolve(cwd)
  for (;;) {
    if (isHomeOrAbove(dir, homeResolved) || isHomeOrAbove(realPath(dir), homeReal)) break
    chain.unshift(dir)
    const parent = dirname(dir)
    if (parent === dir) break // the filesystem root, for a cwd that is not under home at all
    dir = parent
  }
  return chain
}

/** True when `dir` is the home directory itself, or one of its ancestors (including the root). */
function isHomeOrAbove(dir: string, home: string): boolean {
  return dir === home || home.startsWith(dir.endsWith(sep) ? dir : dir + sep)
}

/**
 * 🔴 **733 · where a followed link led, or nothing when it did not lead anywhere else.**
 *
 * ⚑ The memory store's comparison (170 §4): the file read, against the name asked for taken
 * through the REAL directory the walk stood in — so a `/var` that is really `/private/var` is not
 * a link, and a `CLAUDE.md`, or a `.claude` directory above one, that points elsewhere is.
 */
function linkOf(path: string, real: string): string | undefined {
  const dir = dirname(path)
  const derived =
    basename(dir) === INSTRUCTION_DOTDIR
      ? join(realPath(dirname(dir)), INSTRUCTION_DOTDIR, basename(path))
      : join(realPath(dir), basename(path))
  return real === derived ? undefined : real
}

/** The repository-convention filenames, in the order Codex selects between them. */
export const AGENTS_OVERRIDE_FILENAME = 'AGENTS.override.md'
export const AGENTS_FILENAME = 'AGENTS.md'

/**
 * 🔴 **The repository's `AGENTS` layer, selected the way CODEX selects it** (377, HO-012 §3 as
 * `377` §6 cites it; the mechanism is `364` §2.3 and the price is its `+1.5 days / 5 places`).
 *
 * ## ⛔ Why this walk exists at all, and why it is Claude-only
 *
 * Repositories such as `sample-api` may supply `AGENTS.md` without `CLAUDE.md`.
 * Bridge their conventions to Claude so both providers receive the same repository rules.
 *
 * ⛔ **The fix is a Claude-only bridge and NOT a Claude setting source.** `364` §2.2 exercised a real
 * `2.1.218` child across `[]`, User, Project and User+Project: enabling a source imports permissions,
 * hooks, environment mutation, plugins and helpers — and **both harmless `SessionStart` shell hooks
 * executed before any prompt or model turn.** ⚑ It also would not have worked: no Claude setting
 * source reads `AGENTS.md` at all.
 *
 * ⛔ **And the bytes go to Claude ONLY.** `364` §2.3: putting repo bytes in Codex's global override,
 * or echoing them through `developerInstructions`, gives Codex the copy AND its own native read.
 * **The Codex branch of this reader still injects nothing, and that is a DECISION rather than an
 * omission** — of these bytes: what it does compose is this conversation's own text (D-024 · R1),
 * which no file carries. The two routes it declines are declined for different reasons, and `555`
 * split them because one word was carrying both:
 *
 *  - ⛔ **The global override is the one with a confidentiality cost.** One home serves every
 *    project, so project A's conventions written there are read by project B. ⚑ **That half is a
 *    rail** — it is this branch, in code — and it is what HO-062 §2 means by *safety lives in the
 *    rails*.
 *  - ⚠️ **`developerInstructions` is per-thread and leaks across nothing.** Its cost is context on
 *    every request, next to a native read that already happened. 🔴 **And since `552` it carries a
 *    second one**: a Codex `collaborationMode` update takes precedence over that field, so a layer
 *    sent there stops being in force from the first mode switch onwards — see `collaborationModeFor`
 *    in `packages/runtime/src/codex/codex-runtime.ts`. ⛔ **Whoever reaches for this route reaches
 *    for a layer with a stated limit**, which is the fact this paragraph exists to hand them.
 *
 * ⚑ **`HO-023` §7 called an arrangement like this one *"a safety property, not a convenience"* and
 * HO-062 §2 withdrew that framing.** The word is spent here on the half that is enforced by a
 * branch, and not on the half that is a judgement about cost.
 *
 * ## ⚑ The selection, exactly
 *
 * Nearest `.git` root through the cwd; **no root means the cwd alone**; at most ONE file per
 * directory — `AGENTS.override.md` before `AGENTS.md` — outermost to innermost. ⚠️ **An override
 * that EXISTS shadows the ordinary file in its directory even when it is empty**, which is `362`
 * §2's live matrix: at a project directory the candidate is chosen before its content is read. That
 * is the opposite of the profile-global pair, which is first-NONEMPTY, and conflating the two is the
 * mistake `362` was written to correct.
 *
 * ## 🔒 The home boundary is the SAME one, and it had to be said out loud
 *
 * ⛔ **A `.git` at or above `$HOME` does not open a door 170 §4 closed.** That dispatch found BroBot
 * reading a person's own `~/.claude/CLAUDE.md` into a prompt through a symlinked parent, and
 * {@link projectInstructionChain} has excluded home and its ancestors ever since. A second walk with
 * its own stopping rule would be a second answer to the same question — so this one is filtered by
 * {@link isHomeOrAbove} on both spellings, and a person whose home is itself a repository gets the
 * directories below it and not `~/AGENTS.md`.
 */
export function codexConventionChain(cwd: string, home = homedir()): string[] {
  const homeResolved = resolve(home)
  const homeReal = realPath(homeResolved)
  const start = resolve(cwd)
  // 1 · The nearest `.git`, walking up. ⚠️ `.git` is a FILE in a worktree and a directory in an
  // ordinary clone, so existence is the test rather than `isDirectory()`: a directory test finds no
  // root inside a worktree.
  let root: string | null = null
  for (let dir = start; ;) {
    if (safeStat(join(dir, '.git')) !== null) {
      root = dir
      break
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // 2 · Root through cwd, outermost first — or the cwd alone when there is no root.
  const chain: string[] = []
  for (let dir = start; ;) {
    chain.unshift(dir)
    if (root === null || dir === root) break
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return chain.filter(
    (dir) => !isHomeOrAbove(dir, homeResolved) && !isHomeOrAbove(realPath(dir), homeReal),
  )
}

/**
 * ⛔ **The one file this directory contributes, or nothing** — existence decides, never content.
 *
 * ⚠️ Returns the override's path when it is THERE, whatever is in it, so an empty one shadows.
 */
function conventionFileIn(dir: string): string | null {
  const override = join(dir, AGENTS_OVERRIDE_FILENAME)
  if (safeStat(override) !== null) return override
  const plain = join(dir, AGENTS_FILENAME)
  return safeStat(plain) === null ? null : plain
}

/**
 * ⚑ **One file BroBot generated into its own workspace: where it put it, and what it wrote** (594).
 *
 * ⛔ **Both halves, always together.** The path alone answers *"is this a name we own?"*, which is
 * not the question — see {@link InstructionInputs.workspaceOwnFiles}. Only the pair answers *"is
 * this our text?"*, and that is the one this module is allowed to make a claim about.
 */
export interface WorkspaceOwnFile {
  readonly path: string
  readonly content: string
}

/** What {@link readSessionInstructions} needs to know about the session being launched. */
export interface InstructionInputs {
  provider: Provider
  identity?: PromptIdentity
  cwd: string
  providerHome: string
  /**
   * The app's own generated workspace instruction file (006), when there is one — so a file BroBot
   * WROTE is labelled as such instead of arriving as if the user had put it there.
   */
  workspaceFile?: string
  /**
   * 🔴 **The files BroBot generated into its own workspace this launch, and what it wrote in them**
   * (594).
   *
   * ⛔ **BroBot publishes ONE body under TWO names.** `workspaceInstructionFiles()` renders
   * `WORKSPACE_INSTRUCTIONS` as both `CLAUDE.md` and `AGENTS.md`, and `ensureWorkspace` writes both
   * into the workspace at every launch, because two engines look for different names — Codex reads
   * `AGENTS.md` for itself and is injected nothing (`581`). ⚠️ **That publication is correct and 594
   * does not change it.**
   *
   * 🔴 **What it broke is on THIS side.** The Claude walk selects the cwd's `AGENTS` layer as
   * {@link codexConventionChain} does, so in the workspace — the default cwd of every conversation
   * that names no folder — the reader admitted our generated `AGENTS.md` as `repository-conventions`
   * and then our generated `CLAUDE.md` as `workspace-instructions`. ⛔ It deduplicates by PATH, so
   * the same kilobyte went to the model twice. Measured at `f9211472`: two blocks of 1,017 bytes,
   * the workspace marker twice, a 2,580-byte hint.
   *
   * ## ⛔ Why the CONTENT travels with the path, and not the path alone
   *
   * 🔴 **A first draft of 594 carried only the two paths and decided *"is this ours?"* by name.** ⚠️
   * **That directory is the agent's own cwd and the agent can write it** — and `ensureWorkspace`
   * republishes on the blank-cwd resolve and at startup, not on a resume or on an explicitly named
   * cwd. ⛔ So a file the agent wrote at a name we own would have been presented to the model as
   * *"generated by BroBot for this workspace"* and filed on the sheet under `factory`, *"Ships with
   * the app. Nobody here can edit it."* 🔴 **That is 086's provenance claim made about somebody
   * else's bytes, which is the one direction this label exists to prevent** — and it would have been
   * strictly worse than the mislabelling 594 set out to fix, because `repository-conventions` at
   * least says *the place's*.
   *
   * ⚑ **So `content` is here, it comes from the same `workspaceInstructionFiles()` call that WRITES
   * the files, and every decision below is made against the bytes this reader took off disk.**
   * ⚠️ Passed in rather than imported, for {@link InstructionInputs.bundle}'s stated reason: this
   * module stays pure over the filesystem and a caller can run it against a fixture tree.
   *
   * ⛔ **Absent means the caller published no workspace files**, which is every test that is not
   * about them — the same standing {@link InstructionInputs.workspaceFile} has. With it absent the
   * reader behaves exactly as it did before 594.
   */
  workspaceOwnFiles?: readonly WorkspaceOwnFile[]
  /** The OS home directory. A parameter so the boundary above is testable without one. */
  home?: string
  /**
   * 🔴 **What publishing this launch's compiled instruction bundle did** (377) — see
   * `profile-bundle.ts`.
   *
   * ⛔ **The publish happens BEFORE this read and its result is passed in, rather than being done
   * here.** Two reasons, and the second is the load-bearing one: this function is pure over the
   * filesystem in every other respect and a caller can run it against a fixture tree; and the
   * publish needs the compiled TEXT, which needs the database, which this module must not reach.
   *
   * ⚠️ **Absent means no bundle was published for this launch**, which is every host test that is
   * not about instructions — the same standing `workspaceFile` has.
   */
  bundle?: BundlePublish
  /**
   * 🔴 **The bundle this launch composed, and where each of its layers sits inside it** (583) —
   * see `profileBundleSpans`.
   *
   * ⛔ **Passed in for {@link InstructionInputs.bundle}'s own reason, one step further.** The
   * publish needs the compiled text and the spans come off the same walk; recomputing them here
   * would need the database, which this module must not reach. ⚠️ Absent means nobody composed a
   * bundle for this launch, which is every host test that is not about instructions.
   */
  bundleComposed?: { readonly text: string; readonly spans: readonly InstructionSpan[] }
  /**
   * 🔴 **D-024 · R1 — what is true of THIS conversation, composed for its launch alone** — see
   * `thisConversationSpans`.
   *
   * ⛔ **Never a file**: the profile's file is one per profile and a sibling's launch rewrites it,
   * so this text travels with the launch — composed LAST by {@link composeSystemHint}, under a
   * header of its own, on both providers, and handed on where each keeps it
   * ({@link SessionLaunchRead.systemHint}, {@link SessionLaunchRead.firstTurnLead}). ⚠️ Absent
   * means nobody composed one for this launch, which no launch does — `main/index.ts` always
   * composes it — and which is every reader test that is not about it:
   * {@link InstructionInputs.bundle}'s standing.
   */
  thisConversation?: { readonly text: string; readonly spans: readonly InstructionSpan[] }
}

/**
 * 🔴 **What one launch produced: the panel's list, and the one fact about it worth a row** (332).
 *
 * ⛔ **A wrapper rather than a second reader, and that is the whole point of the shape.** The launch
 * fact needs a number the panel's list cannot carry — how many memories are ON DISK, before the
 * per-file cap and the byte budget — and it needs the same *"is the index really in the prompt"*
 * decision the panel makes. ⚠️ Computing it in a second function would read the same directory
 * twice and decide the same question twice, and two decisions about one fact are how they come
 * apart. See {@link claudeMemoryLoaded}.
 */
export interface SessionLaunchRead {
  /** What the model was told and what the drawer shows (158) — unchanged by 332. */
  instructions: SessionInstructions
  /**
   * 🔴 **The launch row, when this profile has one to state** (332) — else `null`.
   *
   * ⛔ **`null` on every path where nothing reaches the prompt**, which is 322 §4's rule about the
   * panel applied to the ledger: a fresh profile whose agent has never written a memory must draw no
   * row at all, and a row saying nothing is loaded is 317's empty state as noise.
   *
   * ⚠️ **Ignored on a resume**, deliberately — see {@link MemoryLoadedEvent}: the conversation's
   * ledger already holds this row from the life that opened it.
   */
  memoryLoaded: MemoryLoadedEvent | null
  /**
   * 🔴 **`SessionInstructions.composed`, as the adapter's system hint** — on Claude, whose system
   * prompt is sent whole at every launch, start and resume alike. ⛔ `null` on Codex (D-024 · R1):
   * see {@link firstTurnLead}. ⚑ The same value, never a second composition (442).
   */
  systemHint: string | null
  /**
   * 🔴 **D-024 · R1 — `SessionInstructions.composed`, in front of the first message of this life**
   * — on Codex, where it is this conversation's own text alone; `null` on Claude. ⚑ **D-039** — on
   * Codex that text opens with how to use the tools, which its catalogue cannot hold.
   *
   * ⛔ **Not `developerInstructions`**: a `collaborationMode` update takes precedence over that
   * field (`552`), and a `thread/resume`'s copy was measured never reaching the model (D-024's
   * review, the bundled 0.146.0) — the thread keeps what it started with. ⚑ The first message of
   * each life is where neither reaches it. ⚠️ Unmeasured: whether a compaction inside one life
   * keeps that message whole — so 🔴 **D-039** the host owes it again after one, and after a turn
   * its provider never began (`HostedSession.firstTurnLead`).
   */
  firstTurnLead: string | null
  /**
   * 🔴 **F093 · R2 — BroBot's profile file for this launch**: where it was published, its text and
   * sections, and — when it did not reach the model — the reason (`refused`'s own code: someone
   * else's file at its name, or, on Claude, a budget it did not fit in — never one the folder's files
   * used up, since it is granted first, W4.178). `null` when the caller composed none.
   */
  profileFile: {
    readonly path: string
    readonly text: string
    readonly spans: readonly InstructionSpan[]
    readonly refused: string | null
  } | null
}

/** ⚑ **F093 · R2** — {@link SessionLaunchRead.profileFile}, off the launch's own inputs and refusals. */
function theProfileFileOf(
  inputs: InstructionInputs,
  refused: readonly RefusedInstruction[],
): SessionLaunchRead['profileFile'] {
  const { bundle, bundleComposed } = inputs
  if (bundle === undefined || bundleComposed === undefined) return null
  const declined = refused.find((row) => row.path === bundle.path)
  return {
    path: bundle.path,
    text: bundleComposed.text,
    spans: bundleComposed.spans,
    refused: declined === undefined ? null : declined.reason,
  }
}

/**
 * **Read everything this session's model will be told, and say where each part came from** (158).
 *
 * Order matters and is the CLI's: the profile's own memory first (who you are), then the project
 * chain outermost → innermost (what you are working on). A deeper file therefore lands later in the
 * prompt, which is the position the CLI gives it; nothing here deletes anything above it.
 *
 * ⚑ **Called on every start AND every resume, deliberately** — the LIVE PROFILE semantic 158 §2
 * ruled. A profile is an identity the user edits; a snapshot would mean editing your memory did
 * nothing until you started a new conversation, which is not what *"the same developer HOME"*
 * means. The cost, stated once here and again in the UI: a file changed mid-conversation does not
 * take effect until the next launch.
 *
 * ## 🔴 …and since 599 each row says WHEN that read happened
 *
 * ⛔ **The cost above did not change and this does not reduce it.** What changed is that it is no
 * longer invisible: {@link InjectedInstruction.readAt} carries the moment this reader asked for
 * each file's bytes, so a person who edits an instruction file mid-conversation can see whether
 * the running conversation is still on the older text. ⚠️ **`TOLD_IS_THE_LAST_LAUNCH` has said
 * *"from the files as they were then"* since 442 and could not say when *then* was.**
 *
 * ⚑ **Nothing appended to the model carries it** — see the field for the audience decision and for
 * what a stamp in {@link composeSystemHint} would have cost.
 *
 * ⚠️ **604 · and the memory store's look has a number too, on the ROW rather than on its files.**
 * {@link readClaudeAgentMemory} stamps when it asked, and {@link SessionLaunchRead.memoryLoaded}
 * carries it out as {@link MemoryLoadedEvent.lookedAt}. ⛔ **The `agentMemory` items still carry
 * none**, deliberately: the PROVIDER loaded those files, and 599's asymmetry is this app declining
 * to date somebody else's act file by file.
 */
export function readSessionInstructions(inputs: InstructionInputs): SessionLaunchRead {
  const injected: InjectedInstruction[] = []
  const refused: RefusedInstruction[] = []

  // 🔴 **A refused publish is reported on BOTH providers, and above the branch so it cannot be
  // reported on only one** (377, HO-016's *"the refusal is SURFACED TO A PERSON, not only
  // logged"*).
  //
  // ⛔ **This is the whole of the person-facing half.** `SessionInstructions.refused` is the drawer's
  // *"an absence with a reason"* list — 170's ruling that a source declined for any reason gets a row
  // — and putting the conflict there means a person meets it in the same place they meet a file the
  // reader could not read, rather than in a log nobody opens. ⚠️ **The launch is not refused**: somebody's own
  // override is a decision, and what this says is that ours was not published over it.
  //
  // 🔴 **485 · and it used to end *"the provider reads THEIR file"*, which is true on one provider
  // of two.** ⛔ Codex is pinned at `$CODEX_HOME` and reads `AGENTS.override.md` itself, so their
  // bytes really do take our slot. ⚠️ **Claude reads nothing at this leaf**: `brobot-instructions.md`
  // was chosen precisely because the provider does not know the name (`settingSources: []`), and the
  // only reader is the `take` below — gated on `bundle?.ok === true`. **So on Claude an unmanaged
  // override suppresses ours and delivers nothing in its place**, which is a worse outcome than the
  // comment described and the one a person needs the drawer row for.
  if (inputs.bundle?.ok === false)
    refused.push({ path: inputs.bundle.path, reason: inputs.bundle.reason })

  // Codex reads all of this itself (156 §3), so injecting would duplicate the provider's own work.
  // The list it reports back is surfaced from the handle instead — see `SessionInstructions`.
  //
  // ⚠️ `Provider` is a two-value union, so this branch is Codex. It is still spelled *"not claude"*
  // because that is what the sentence it returns is about — a provider that reads its own files —
  // and a third provider arriving here should have to answer the same question rather than inherit
  // Codex's answer by default.
  if (providerValue(inputs.provider, { claude: false, codex: true })) {
    // 🔴 **This used to say Codex *"has no agent-written memory of its own — so there is nothing to
    // derive, nothing to read, and nothing to show"*, citing 165 §4 and 156.** ⚑ Both were right
    // when written, and 314 made them false three dispatches later by switching Codex's memory on
    // in this app. The comment outlived its fact and every Codex session went on reporting no
    // memory at all — 308's defect exactly, in the file 308's remedy was written for.
    //
    // ⛔ **Corrected in place rather than deleted** (142): what changed is named, and when.
    const codex = readCodexAgentMemory(inputs.providerHome)
    const codexConversation = composeSystemHint(injected, inputs.thisConversation) ?? null
    // A refused profile publication must still identify this launch without replacing the file.
    const codexComposed =
      inputs.bundle?.ok === false && inputs.identity !== undefined
        ? [agentPreamble(inputs.identity), codexConversation]
            .filter((text) => text !== null)
            .join(BLOCK_SEPARATOR)
        : codexConversation
    return {
      // ⛔ **No launch row on this provider, and it is a SCOPE decision rather than a measurement**
      // (332 §2.5). Codex injects `memory_summary.md` into every request, so the same launch fact is
      // just as unstated here — `reach: 'prompt'` is already on that item one line down. ⚠️ It is
      // left alone because the sentence would differ: that file is a machine-written précis produced
      // by a background extractor, not an index the agent maintains pointing at memories beside it,
      // and 310 is what happens when one field is stretched over two providers' different truths.
      // ⚑ The gap is real and is written up for a number of its own.
      memoryLoaded: null,
      instructions: {
        injected,
        agentMemory: codex.memory,
        provider: [],
        refused: [...refused, ...codex.refused],
        // ⚑ **The note now names the leaf this app PUBLISHED for the provider to read** (377).
        // No file is injected here and the list below is still the provider's own — but a person
        // reading *"BroBot appends nothing for this provider"* beside a row for a file BroBot wrote
        // would have to guess which one that was. ⚑ **D-024 · R1 — and it says what IS sent**:
        // this conversation's own text, when one was composed.
        note: codexMemoryNote(codex, inputs.bundle, inputs.thisConversation !== undefined),
        // 🔴 **This provider publishes the read, so the panel may point at it** (319 §2.1). Measured
        // twice on a real 0.146.0 child, with a control: the model appends its own citation block, the
        // app-server parses it into `agentMessage.memoryCitation` and strips it out of `text`, and
        // `codex/normalize.ts` turns it into a `memory_recall` row in the conversation. ⚠️ The flag —
        // rather than the panel asking which provider this is — is `308`'s remedy: see the field.
        recallsReported: true,
        // ⛔ **`false`, and it is 316's measurement rather than a gap** (330 §4). Fifteen config arms
        // of a real 0.146.0 child: the memory tools live inside the code-mode `exec` surface and the
        // app-server publishes no `item/*` for a nested call, so nothing on this wire reports a write.
        // ⚠️ **A `memory_note` row is not this flag.** That row is a directory listing this app took
        // between the start and the end of a turn and it says so on screen; promising *"the
        // conversation shows the write"* about it would present our observation as the provider's
        // report, which is exactly the line `MemoryNoteEntry` was written to hold.
        writesReported: false,
        // 🔴 **Composed here rather than by the caller** (442) — one call, so the string a
        // person reads and the string the adapter is handed are the SAME value.
        //
        // ⛔ **`injected` is empty above and nothing adds to it**: this provider reads its own
        // instruction files, so BroBot appends none of them. ⚑ **D-024 · R1 — what it does send is
        // this conversation's own text**, which no file can carry for one conversation of a
        // profile; the composer returns it alone, under its header, and `null` only when nobody
        // composed one.
        ...(inputs.thisConversation === undefined
          ? {}
          : { thisConversation: inputs.thisConversation }),
        composed: codexComposed,
      },
      // 🔴 **D-024 · R1 — in front of the first message of every life, never as a system hint** —
      // see {@link SessionLaunchRead.firstTurnLead}.
      systemHint: null,
      firstTurnLead: codexComposed,
      profileFile: theProfileFileOf(inputs, refused),
    }
  }

  const home = inputs.home ?? homedir()
  const seen = new Set<string>()
  /**
   * 🔴 **733 · the FILES already taken, by where they really are** — beside {@link seen}, which is
   * keyed by the spelling the walk asked for. ⛔ Since `733` two names can be one file (a
   * `CLAUDE.md` that is a link to the `AGENTS.md` beside it is a common convention), and HO-075 §1
   * is *"that directory's conventions, ONCE"*. ⚠️ Keyed on the file, never on the text: `576` ruled
   * a content dedupe out, and two real files that say the same thing are still both sent.
   */
  const taken = new Set<string>()
  /**
   * Everything that survived the READER, in prompt order, before any of the budget is spent.
   *
   * ⛔ **The budget is no longer the read cap, and that is the fix rather than a tidy-up** (187 §2).
   * It was `Math.min(INSTRUCTION_FILE_CAP, budget)`, which made "there is no room left" and "there
   * is no file there" the same answer — both came back as nothing at all, and nothing at all is what
   * the drawer showed. Reading each candidate at the per-file cap and deciding afterwards is what
   * lets a dropped file be a row with a reason.
   */
  const candidates: InjectedInstruction[] = []

  const take = (path: string, kind: InjectedInstructionKind): void => {
    if (seen.has(path)) return
    seen.add(path)
    // 🔴 **599 · the moment we ASKED for these bytes, above the call that fetches them** — see
    // {@link InjectedInstruction.readAt} for what the number is a time OF and why it is early.
    //
    // ⛔ **Here rather than anywhere downstream, and here rather than once for the launch.** This
    // walk does real I/O between files, so a file written between two of these reads lands in one
    // and not the other; a single launch stamp would have to date one of them with the other's
    // moment. ⚠️ **And `readInstructionFile` is left alone** — its sequence is its own docblock's,
    // the clock is not part of that sequence, and the caller is the one that knows whether this
    // read is an append or a display.
    const readAt = Date.now()
    const read = readInstructionFile(path, INSTRUCTION_FILE_CAP)
    if (!read.ok) {
      // 🔴 **733 · a link whose far end is gone is DISCLOSED, in 314 §3's word.** Following, the
      // reader makes it `absent`, as the provider's own `stat` does — and until `733` the walk
      // refused every link, so such a file had a row; following must not make it silent.
      const said = read.reason === 'absent' ? brokenMemoryLink(path) : { path, reason: read.reason }
      if (said !== null) refused.push(said)
      return
    }
    const real = read.real ?? realPath(path)
    // ⚑ **736 · a link that lands in the person's own home is followed too**, as the CLI follows
    // it (`733` F-1, measured — see the module note): it is sent once, as the project's file, and
    // the row says where it led ({@link linkOf}). `733` refused it here as `personal-home`.
    // An empty file is not an item. It exists, it says nothing, and a section rendering a heading
    // over no text is 086 in the other direction.
    if (read.text.trim() === '') return
    // ⚑ **733 · one file, sent once** — see {@link taken}. The first name in walk order keeps it
    // (and discloses its link, below); a second name for it is a row saying why it was not sent.
    if (taken.has(real)) {
      refused.push({ path, reason: 'same-file', link: real })
      return
    }
    taken.add(real)
    // 🔴 **733 · a followed link SAYS so**, as 170 §2 ruled for the memory store it followed first:
    // *"BroBot follows what the provider follows, and says that it did."* See {@link linkOf}.
    const link = linkOf(path, real)
    candidates.push({
      kind,
      path,
      text: read.text,
      bytes: read.bytes,
      truncated: read.truncated,
      readAt,
      ...(link === undefined ? {} : { link }),
      ...sectionsOf(kind, read.text, inputs.bundleComposed),
    })
  }

  // 0 · The agent's own memory. Read FIRST — not because it is appended (it is not) but because it
  // is what the model sees first, and a refusal about it belongs above a refusal about a file that
  // reaches the model later. See {@link readMemoryStore} for why these are followed.
  const agent = readClaudeAgentMemory(inputs.providerHome)
  refused.push(...agent.refused)

  // 🔴 **1 · The app's own compiled instructions, FIRST** (377) — `factory + configured` from one
  // canonical source, published to this home a moment ago and read back through the same guarded
  // reader as everything else. ⚑ **D-024 · R1 — what is true of this conversation is not in the
  // file**: it is {@link InstructionInputs.thisConversation}, appended after every file.
  //
  // ⛔ **Read back rather than passed through as a string**, which is not ceremony: every other item
  // on this list is a file with a path a person can open, and an item whose `path` named a file
  // nobody could read would be the first row in this drawer that is not checkable. ⚑ It is also the
  // only way the byte budget, the truncation report and the disclosure all keep working on it for
  // free.
  //
  // ⚠️ **Before the profile's own memory in the PROMPT**, because that is the order of authority:
  // what the app says this agent IS comes before what the agent has written about itself.
  //
  // 🔴 **And FIRST in the budget, too** (W4.178). 594 found {@link allocate} granting this item
  // LAST — first in prompt order, and the grant walk is the reverse — so a saturated chain shed the
  // app's own compiled instructions before anything else. ⚑ Decided: it is granted ahead of
  // everything, and a repository's files give way instead.
  if (inputs.bundle?.ok === true) take(inputs.bundle.path, 'profile-instructions')

  // 2 · The profile's own memory — `<providerHome>/CLAUDE.md`, the file 156 §1 measured the pinned
  // CLI resolving from `CLAUDE_CONFIG_DIR`. ⚠️ NOT `<providerHome>/.claude/CLAUDE.md`.
  take(join(inputs.providerHome, INSTRUCTION_FILENAME), 'profile-memory')

  // 🔴 **3 · The repository's own `AGENTS` layer, selected as Codex selects it** (377, from `364`
  // §2.3) — see {@link codexConventionChain} for the walk and for why it is Claude-only.
  //
  // ⚑ **Composed into the SAME per-directory pass as the `CLAUDE.md` spellings**, root to cwd, with
  // the shared file before the Claude-specific ones at each depth. `364`: *"That keeps deeper scope
  // later while making Claude-only prose an explicit same-depth overlay."*
  const conventionDirs = codexConventionChain(inputs.cwd, home)
  const conventions = new Map<string, string>()
  for (const dir of conventionDirs) {
    const file = conventionFileIn(dir)
    if (file !== null) conventions.set(dir, file)
  }

  // 4 · The project chain, outermost → innermost, both spellings at each level.
  //
  // ⛔ **Walked as the UNION of the two chains rather than as the Claude one**, and the reason is
  // that *"they cannot differ"* is an argument rather than a mechanism. Both are ancestor chains of
  // one cwd and both stop at the same home boundary, so today every convention directory is already
  // on this list — ⚠️ **and a `for` over the Claude chain alone would drop a repository file in
  // silence the day either walk's stopping rule changes.** The extras are ancestors of the Claude
  // chain's own top and are already outermost-first, so prepending them is the composition order.
  const claudeChain = projectInstructionChain(inputs.cwd, home)
  const chain = [...conventionDirs.filter((dir) => !claudeChain.includes(dir)), ...claudeChain]
  for (const dir of chain) {
    const convention = conventions.get(dir)
    if (convention !== undefined) take(convention, 'repository-conventions')
    // 🔴 **733 · a `.claude` that is a LINK is followed, as the CLI follows it** (R93). ⛔ It was
    // refused as a link — *"a symlinked `.claude` would redirect the whole lookup"* — for the
    // credential the module note named. ⚑ `stat`, so a link to a directory is a directory and a
    // link to nothing is absent, which is what the CLI's own lookup makes of both.
    const dot = join(dir, INSTRUCTION_DOTDIR)
    const dotUsable = safeStat(dot)?.isDirectory() === true
    const plain = join(dir, INSTRUCTION_FILENAME)
    take(plain, kindFor(plain, inputs.workspaceFile))
    const nested = join(dot, INSTRUCTION_FILENAME)
    if (dotUsable) take(nested, kindFor(nested, inputs.workspaceFile))
    else {
      // ⚑ **733 · …and so is a `.claude` that is a link to nothing** — named as the DIRECTORY,
      // which is what `brokenMemoryLink` answers when the leaf has no path to stat.
      const broken = brokenMemoryLink(nested)
      if (broken !== null) refused.push(broken)
    }
  }

  // 🔴 **594 · the deciding line.** See {@link sendOurWorkspaceBodyOnce}: our own workspace body was
  // admitted twice — once under each name we publish it as — and this is where the second copy goes.
  // ⛔ Before {@link allocate}, so the kilobyte it frees is budget the rest of the chain can spend.
  const sentOnce = sendOurWorkspaceBodyOnce(candidates, inputs.workspaceOwnFiles)

  allocate(
    candidates,
    injected,
    refused,
    conversationBlockCost(inputs.thisConversation),
    agentPreamble(inputs.identity),
  )
  const composed = composeSystemHint(injected, inputs.thisConversation, inputs.identity) ?? null

  return {
    // 🔴 **The launch fact, from the SAME read the panel is built from** (332 §2) — see
    // {@link claudeMemoryLoaded} for the gate and for what it is allowed to say.
    memoryLoaded: claudeMemoryLoaded(agent),
    instructions: {
      injected,
      agentMemory: agent.memory,
      provider: [],
      refused,
      // ⛔ **Drawn on a SEND, never on a drop** (found in review). `sentOnce` is decided before
      // {@link allocate}; a keeper the budget then refuses would leave the panel saying the body
      // *was appended once* over a prompt that got it zero times, beside an `over-budget` row for
      // the file it names. ⚑ So the clause asks the list that actually reached the model.
      note: noteFor(
        chain,
        home,
        claudeMemoryNote(agent),
        sentOnce !== null && injected.includes(sentOnce.kept) ? sentOnce.dropped : null,
      ),
      // ⛔ **`false` is a MEASUREMENT, not a gap** (319 §2.1, §3). 318 looked at this provider's side
      // too: its CLI preloads the memory index into its own system prompt, with no memory tool and no
      // citation of any kind — and its memory WRITES are already visible as ordinary `Write`/`Edit`
      // tool calls, so nothing is missing from the conversation here either. A recall row on this path
      // would have to be invented, which 319 §3 forbids by name.
      recallsReported: false,
      // 🔴 **`true`, and it is what 330 measured plus what 330 built** (330 §2, §4). This CLI writes a
      // memory with an ordinary `Write`/`Edit` naming a file in the store, and the store's location is
      // on its own wire — `system/init.memory_paths.auto`, found by enumerating every key path of a
      // real 2.1.218 session. The conversation now says so on the row: `tool_call.memoryPath`.
      //
      // ⛔ **This does not re-open 319.** The sentence this flag draws is about the WRITE and says
      // nothing about a reading — there is no single reading to point at on this provider, because the
      // index is in the prompt from the start and each row of the store above already carries its own
      // reach word (322). A recall row here would still have to be invented, and still must not be.
      writesReported: true,
      // 🔴 **What actually went to the model, as one string** (442, criterion 24's *"composed,
      // as sent"*).
      //
      // ⚠️ **After {@link allocate}, over the same `injected` array the caller's hint is built
      // from** — so the preamble, the per-block headers and the truncation the budget applied are
      // all in it, and the panel can show the bytes rather than a plausible reassembly of them.
      // ⛔ The composition root hands THIS value to the adapter; see `main/index.ts`.
      ...(inputs.thisConversation === undefined
        ? {}
        : { thisConversation: inputs.thisConversation }),
      composed,
    },
    // ⚑ **The system prompt, at every launch** — {@link SessionLaunchRead.systemHint}.
    systemHint: composed,
    firstTurnLead: null,
    profileFile: theProfileFileOf(inputs, refused),
  }
}

/**
 * 🔴 **This profile has memory in the prompt, so the conversation may say so** (332 §1, §2).
 *
 * ⛔ **The gate is the INDEX reaching the prompt, and it is the panel's own gate rather than a
 * second one.** `injects` is literally *"did anything come back with `reach: 'prompt'`"*, so this
 * finds that same item and takes its path — one derivation, and the file the row names is
 * necessarily the file the panel says is in front of the model. ⚠️ A profile whose agent has filed
 * topic files but no index yet gets `null`: nothing of it reaches the model on its own, which is the
 * case 317 M25 found on the other provider and which {@link claudeMemoryNote} already has a
 * sentence for.
 *
 * ⛔ **`topicsFound`, never `topicsListed`.** The second is what survived `AGENT_MEMORY_NOTES_SHOWN`
 * and the byte budget — the panel's list — and reporting it here would understate a store of forty
 * as twenty with nothing on screen to say so. 092 §4: a cap that goes silent is the defect.
 *
 * ⚠️ **Claude only, and the call site is the enforcement** — this is reached below the branch that
 * returns for every other provider. 332 §2.5 rules Codex out of scope with its reason; see the
 * `memoryLoaded: null` there.
 *
 * ⛔ **A store that could not be LISTED comes back as `0`, and that is a silence rather than a
 * claim** (074, found reviewing this diff). `claudeMemoryTopics` answers `[]` plus a refusal when
 * the directory throws, so *"we could not look"* and *"there are none"* arrive as one number here —
 * and the row draws no clause at all for zero, so neither is ever asserted on screen. ⚑ The panel is
 * where a refusal is reported WITH its reason, exactly as `MemoryNoteEntry` leaves it.
 */
function claudeMemoryLoaded(read: ClaudeMemoryRead): MemoryLoadedEvent | null {
  const index = read.memory.find((item) => item.reach === 'prompt')
  if (index === undefined) return null
  // ⚑ **604 · carried, never re-taken.** Reading the clock here would date the row with the moment
  // the walk FINISHED — see {@link MemoryLoadedEvent.lookedAt} for which end is honest and why.
  return {
    type: 'memory_loaded',
    index: index.path,
    beside: read.topicsFound,
    lookedAt: read.lookedAt,
  }
}

/**
 * 🔴 **Spend {@link INSTRUCTION_TOTAL_CAP} on the files that would have WON, and say what was
 * dropped** (187 §2, from 168 M2).
 *
 * ## ⛔ The policy, ruled on rather than inherited
 *
 * The budget used to be spent first-come-first-served in prompt order, and prompt order is the
 * CLI's: profile memory, then the project chain **outermost → innermost**. So the file NEAREST the
 * agent — the one in its own working directory, the most specific thing anybody wrote — was the
 * first to vanish, and a rule written three directories up survived it. ⚠️ **That is the reverse of
 * what a reader expects, and it is also backwards on the prompt's own terms**: these blocks are
 * appended in order and later text is what wins when two files disagree, so the entries this
 * allocator was dropping were precisely the ones that would have decided the disagreement.
 *
 * ⛔ **So the budget is granted NEAREST-FIRST along the chain, and the survivors are emitted in
 * prompt order, unchanged.** 158's ordering is a statement about what the model reads and is
 * untouched; this is a statement about what gets read at all, and the two were only ever the same
 * list by accident.
 *
 * 🔴 **BroBot's own rules are granted FIRST of all** (W4.178). They are the profile file this app
 * compiles — its rules, the safety rules among them, and the person's own instructions for this
 * agent — and they are first in prompt order, so the reverse walk below used to reach them LAST: a
 * saturated chain shed them before any repository file. ⛔ They are never the part that is cut; a
 * repository's files give way instead. ⚑ They always fit: the file is read under
 * {@link INSTRUCTION_FILE_CAP}, a quarter of the budget.
 *
 * ⚠️ **The profile's own memory is granted next, ahead of the whole chain, and it is the other
 * deliberate exception to "keep what would have won".** It is not on the project chain: it is the
 * identity — the file the user wrote for this profile, for every project — and 166 made that
 * identity the axis the whole app turns on. Dropping who the agent is to keep a rule from three
 * directories above the repo is the wrong trade, and in practice it is a hand-written file of a few
 * hundred bytes that will never be what pushes a chain over the cap.
 *
 * ⚠️ **`continue`, not `break`**: one oversized file near the agent does not evict the small ones
 * behind it. Stopping at the first thing that will not fit would drop strictly more than this does,
 * for no reason a user could see.
 *
 * ## ⚠️ A dropped file is a ROW, which is the whole finding
 *
 * List a source refused for budget as well as one refused for a read error. The drawer must explain which custom text was excluded, rather than silently dropping it.
 *
 * ⛔ **Whole files, never a fragment.** A file that does not fit is dropped rather than cut to the
 * remaining bytes: a rule severed mid-sentence is worse than a rule that was not sent, and the row
 * naming it is something a person can act on. ⚠️ The per-file cap still truncates — that one is
 * disclosed on the item itself, as {@link InjectedInstruction.truncated}, and leaves the file
 * mostly intact.
 */
function allocate(
  candidates: readonly InjectedInstruction[],
  injected: InjectedInstruction[],
  refused: RefusedInstruction[],
  /**
   * ⚑ **D-024 · R1 — the bytes this conversation's own block will cost**
   * ({@link conversationBlockCost}), spent first: it is emitted whole and never dropped, so the
   * files share what is left and the cap still bounds everything sent.
   */
  reserved: number,
  preamble: string,
): void {
  // The preamble is emitted whenever anything is, so it is spent before anything is granted.
  let budget = INSTRUCTION_TOTAL_CAP - byteLength(preamble) - reserved
  const granted = new Set<InjectedInstruction>()
  // BroBot's own rules first, then identity, then the chain from the agent outwards. `reverse()` on
  // a copy — `candidates` is the prompt order and the emission below still reads it. ⚑ A `Set`, so
  // the chain's walk, which meets BroBot's rules again, does not take them twice.
  const order = new Set([
    ...candidates.filter((item) => item.kind === 'profile-instructions'),
    ...candidates.filter((item) => item.kind === 'profile-memory'),
    ...candidates.filter((item) => item.kind !== 'profile-memory').reverse(),
  ])
  for (const item of order) {
    const cost = item.bytes + byteLength(blockHeader(item)) + byteLength(BLOCK_SEPARATOR)
    if (cost > budget) continue
    budget -= cost
    granted.add(item)
  }
  // Both lists in PROMPT order, so the drawer reads top-to-bottom the way the model does — the
  // reverse walk above decides *what* survives and says nothing about how it is presented.
  for (const item of candidates) if (granted.has(item)) injected.push(item)
  for (const item of candidates) {
    if (!granted.has(item)) refused.push({ path: item.path, reason: 'over-budget' })
  }
}

/**
 * ⚠️ **UTF-8 bytes, not `String.length`.** The budget is spent in the units the request is billed
 * in; a chain of CJK instruction files is three bytes per character and a length-based count would
 * under-charge it by a factor of three.
 */
function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/**
 * 🔴 **The one instruction file the AGENT writes** (165) — read for DISPLAY, never appended.
 *
 * ⚑ **It moved at 166 and the drawer follows it without knowing that it did**: the path comes from
 * {@link claudeAutoMemoryIndex}, which is now `<providerHome>/memory/MEMORY.md` — one memory per
 * profile, whatever the session is working on. ⚠️ **The cwd is gone from the signature**, which is
 * the honest shape: this file is a property of the identity, so a reader that still took a working
 * directory would be advertising a scoping that no longer exists.
 *
 * ⛔ **Appending it would be the bug.** The provider loads this file into its own system prompt; a
 * second copy from us would double it, and 158's list would be claiming a choice this app did not
 * make. So it is read with the same reader as everything else — a regular file, size-capped,
 * strictly decoded — and returned on its own field.
 *
 * ⚠️ **It does not draw on {@link INSTRUCTION_TOTAL_CAP}**, deliberately. That budget exists to bound
 * what we APPEND to the prompt, and this text is not appended, so spending the budget on it would
 * silently shrink the profile and project memory that is.
 *
 * ⚑ **Absent is the ordinary first case and renders nothing**: before the agent has written
 * anything there is no `memory/` directory at all.
 *
 * ## 🔴 The ruling: BroBot follows what the provider follows, and says that it did (170 §2)
 *
 * Do not collapse every memory read failure to `null`. A linked `<providerHome>/memory/MEMORY.md` can point to `/tmp/secret.md` and still reach the provider's prompt. The drawer must show the source or a refusal instead of implying that no source exists.
 *
 * Two things were wrong and only one of them is about symlinks:
 *
 *  1. **Silence.** A read that fails for ANY reason — a `MEMORY.md` that is a directory, one that is
 *     not UTF-8, one behind a permission wall — is now a refused row with its reason, exactly like
 *     every file on the project chain. `absent` stays silent, because absent is not a refusal and a
 *     row for a file the user never created is 086 in the other direction.
 *  2. **The refusal itself.** ⚑ Refusing a link here prevents NOTHING: the provider is a separate
 *     process, it read the target before this app was asked anything, and it did not consult us. So
 *     the refusal cost the user the only thing they could have had — sight of it — and bought no
 *     protection at all. ⚠️ **Until `733` it was not the same rule as the one on the appended
 *     files, and the difference was the polarity, not the risk appetite**: there, refusing the link
 *     was what stopped BroBot putting a credential in the prompt; here, the text is in the prompt
 *     either way and the only open question is whether the user gets to read it too. 🔴 **`733` ·
 *     the appended files follow now too** — the credential was the whole of that rule's reason, and
 *     R93 removed it.
 *
 * 🔒 **What following does NOT relax**, since a ruling that quietly widened the reader would be the
 * worse mistake: the target must be a regular file (a link to a FIFO would otherwise block the
 * launch forever, and that check runs before anything is opened), the descriptor is still identity-
 * checked against the `stat`, the 64 KiB cap is still enforced during the read, the decode is still
 * strict, and **this text is still never appended** — the whole point of {@link SessionInstructions}'
 * separate field.
 *
 * ⚠️ **And the redirection is DISCLOSED.** `link` is set whenever the file actually read is not the
 * file this app derived — a link at the leaf, or at the `memory/` directory above it. It is compared
 * against {@link claudeAutoMemoryIndex} applied to the REAL provider home, so an ordinary session on
 * macOS (whose `/var/folders/…` home really lives at `/private/var/folders/…`) reports no
 * redirection, and a session whose memory index points somewhere else reports exactly where.
 */
interface AgentMemoryRead {
  /**
   * ⚑ **A LIST since 317**, in the order the model meets them: what the provider injected first,
   * then what the agent would have to fetch. Empty is the ordinary first case.
   *
   * ⚠️ **Corrected at 322** (142): this said *"For Claude it holds at most one entry, which is what
   * it always held"*. ⛔ **That was the defect rather than a description** — the store is an index
   * plus one file per memory, and reading only the index put one of a real profile's three files on
   * the panel. Both providers now fill this list from a whole directory.
   */
  memory: InjectedInstruction[]
  /** Every source that exists and was not readable. Silence about a source is the defect. */
  refused: RefusedInstruction[]
}

/**
 * 🔴 **A whole provider store's read — what came out of it, and WHICH directory it came out of**
 * (625).
 *
 * ⛔ **The supertype exists so the two provider readers have ONE declared shape**, which is what
 * lets `main/runtime/agent-memory.ts` hold them in a `Record<Provider, …>` — the table that makes a
 * third provider a compile error instead of an empty popup. ⚠️ `dir` was declared twice, identically,
 * on the two readers below; it is declared here once and they inherit it.
 */
export interface AgentMemoryStoreRead extends AgentMemoryRead {
  /**
   * The store's directory when there is one to talk about, else null.
   *
   * ⚠️ **`existsSync` rather than "did we read anything"**, on both readers: a store that exists and
   * holds nothing we show is still a store. ⛔ It FOLLOWS links, so a memory directory pointed at
   * another disk is a store and a DANGLING one is not — which is the answer that leaves the
   * broken-link row to say what happened.
   */
  dir: string | null
}

/**
 * One file in an agent's memory store, and everything {@link readMemoryStore} needs to disclose it.
 *
 * ⚠️ **`derived` is the same path recomputed from the REAL provider home**, never a second spelling
 * of the scheme (032). It is the whole of what makes {@link InjectedInstruction.link} mean *"this
 * memory was moved"* rather than *"this machine's `/var` is a link"*.
 */
interface MemoryCandidate {
  path: string
  derived: string
  // ⚑ `agent-memory-topic` joined the union at 322: one memory in its own file, Claude's half of
  // the same shape Codex's ad-hoc notes have. See `InjectedInstructionKind` for why it is a THIRD
  // kind rather than a second use of `agent-memory-note`.
  kind: 'agent-memory' | 'agent-memory-note' | 'agent-memory-topic'
  reach: 'prompt' | 'on-request'
}

/**
 * 🔴 **Read an agent's memory store, follow what the provider follows, and say what it declined.**
 *
 * ⚑ **One function for both providers** (100's rule), because every ruling in
 * {@link readClaudeAgentMemory}'s note is about the POLARITY of the read and not about Claude: the
 * provider reads these files itself, before and independently of this app, so refusing a link here
 * would remove the row from the panel and remove nothing from anything. That argument transfers to
 * Codex unchanged — with one honest weakening worth stating rather than glossing.
 *
 * ⚠️ **For Claude's index and Codex's `memory_summary.md`, the provider DID read it** — 312
 * captured both on the wire. For the rest of a Codex store, the provider reads it **if the model
 * chooses to**, through `memories__read` and `memories__search`. So `reach` is `'on-request'` for
 * those and the panel says so; what does NOT change is that the agent can reach them whether or not
 * BroBot displays them, so declining to display buys nothing here either.
 *
 * 🔒 **What following still does not relax**, exactly as at 170 §2: the target must be a regular
 * file (checked before anything is opened, which is what stops a link to a FIFO blocking the
 * launch), the descriptor is identity-checked against the `stat`, the per-file cap is enforced
 * during the read, the decode is strict, and none of this text is ever appended to a prompt.
 */
function readMemoryStore(candidates: readonly MemoryCandidate[]): AgentMemoryRead {
  const memory: InjectedInstruction[] = []
  const refused: RefusedInstruction[] = []
  // ⚠️ A broken `memories/` directory link makes EVERY leaf under it absent, so without this the
  // same one-line finding would be reported once per candidate.
  const reported = new Set<string>()
  let budget = AGENT_MEMORY_TOTAL_CAP

  const declare = (row: RefusedInstruction): void => {
    if (reported.has(row.path)) return
    reported.add(row.path)
    refused.push(row)
  }

  for (const candidate of candidates) {
    // ⛔ **The per-file cap, NOT what is left of the budget** (187 §2). Reading at the remaining
    // budget is the defect that made "there is no room left" and "there is no file there" the same
    // answer; the file is read whole and the fit is decided afterwards, so a drop can be stated.
    const read = readInstructionFile(candidate.path, INSTRUCTION_FILE_CAP)
    if (!read.ok) {
      // ⛔ `absent` is silent — unless what is absent is the far end of a LINK (314 §3).
      if (read.reason === 'absent') {
        const broken = brokenMemoryLink(candidate.path)
        if (broken !== null) declare(broken)
        continue
      }
      declare({ path: candidate.path, reason: read.reason })
      continue
    }
    // An empty file is not an item — a heading over no text is 086 in the other direction.
    if (read.text.trim() === '') continue
    // ⚠️ Silent, and deliberately: what did not fit is counted and named in the note sentence
    // ({@link codexMemoryNote}), because a store of a thousand one-line notes would otherwise turn
    // 187's "a dropped file is a row" into a thousand rows nobody can read.
    if (read.bytes > budget) continue
    budget -= read.bytes
    const link = read.real !== undefined && read.real !== candidate.derived ? read.real : undefined
    memory.push({
      kind: candidate.kind,
      path: candidate.path,
      text: read.text,
      bytes: read.bytes,
      truncated: read.truncated,
      reach: candidate.reach,
      ...(link === undefined ? {} : { link }),
    })
  }
  return { memory, refused }
}

/** What a path leads to, links followed — or `null` when it leads nowhere this app can read. */
function safeStat(path: string): Stats | null {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

/**
 * Does this path lead anywhere at all? ⚠️ **One derivation, not two** (169 §1) — it is
 * {@link safeStat} asked a yes/no question, so a change to what "readable" means cannot answer
 * differently here than it does one function down.
 */
function resolves(path: string): boolean {
  return safeStat(path) !== null
}

/**
 * 🔴 **A memory index that is a LINK TO NOWHERE — the one case `absent` was wrong about** (314 §3).
 *
 * ## The state this exists for, measured rather than imagined
 *
 * `312` pointed a real Claude child at a `memory/MEMORY.md` that was a symlink out of the provider
 * home and the child **followed it**, answering from the target with no tool call, leaving link and
 * target unchanged. That is 170 §2's ruling working exactly as intended: the provider follows the
 * link before BroBot is asked anything, so refusing it would remove the row from this panel and
 * remove nothing from the prompt — and {@link readClaudeAgentMemory} therefore follows it and DISCLOSES
 * the redirection on `link`.
 *
 * A memory link into `/tmp` can lose its target after reboot. Following it then yields ENOENT and `absent`, which is normally silent; distinguish a broken link so the panel explains why previously available memory is missing.
 *
 * ⚠️ **`readInstructionFile`'s own note is right about the MODEL and was being read as a statement
 * about the USER.** *"A dangling link is ENOENT and therefore absent — which is also what the
 * provider's own `stat` makes of it, so nothing reached the model and there is nothing to report"*
 * is true of the prompt and false of the panel: nothing reaching the model is precisely the thing
 * worth reporting when something used to.
 *
 * ## ⚑ Why this is a disclosure and not a repair
 *
 * ⛔ **Refusing was already ruled out** (170 §2) and nothing here reopens it. ⛔ **Repairing —
 * replacing the link, or copying the target back into the home — was considered and rejected**: the
 * app does not write `MEMORY.md`, the AGENT does, so this app has less claim over it than
 * `ensureWorkspace` has over the two files it generates and even THAT refuses to unlink a
 * `brobot-workspace` somebody may have pointed at a bigger disk on purpose. Silently replacing a
 * link is how a person loses a memory they redirected deliberately. **Saying so is the whole
 * remedy** — the one option §3 rules out is following it in silence, and after this nothing is
 * silent: a link that reads is disclosed on `link`, and a link that does not is disclosed here.
 *
 * ## What it checks
 *
 * Both shapes 170's `link` field can carry: the leaf, and the `memory/` directory above it. The
 * directory is checked second and only when the leaf says nothing, because a dangling directory
 * link makes `lstat` on the leaf ENOENT too — there is no path to the leaf to stat.
 *
 * 🔴 **`733` · the WALK asks it too**, of every file it takes and of a `.claude` directory: the walk
 * follows links now, and a link whose far end is gone had a row while the walk refused every link.
 * It is one of the two link rules `733` kept on the walk — a missing target; the other is a loop
 * ({@link readInstructionFile}'s `symlink`).
 *
 * ⚠️ **`readlink`, never `realpath`.** The target of a broken link is exactly what `realpath`
 * cannot tell you, and it is the only useful thing to print.
 */
function brokenMemoryLink(path: string): RefusedInstruction | null {
  for (const candidate of [path, dirname(path)]) {
    let seen: Stats
    try {
      seen = lstatSync(candidate)
    } catch {
      continue // nothing at this name at all — the ordinary case, and it stays silent
    }
    if (!seen.isSymbolicLink()) continue
    // ⛔ **A link is only reported when it leads NOWHERE, and this line is why.** Found reviewing
    // this diff: `memory/` may be a symlink somebody pointed at a real directory on another disk,
    // and the index inside it simply has not been written yet — a perfectly working redirect with
    // no file at the far end of the LEAF. Without this the panel told them their memory was gone.
    // ⚠️ `stat` follows; a link that resolves answers here and is left alone.
    if (resolves(candidate)) continue
    let target: string
    try {
      target = resolve(dirname(candidate), readlinkSync(candidate))
    } catch {
      target = '(unreadable)'
    }
    return { path: candidate, reason: 'dangling-link', link: target }
  }
  return null
}

/**
 * 🔴 **What a CLAUDE profile remembers** (322) — the index the provider injects, and the memories
 * beside it that it does not.
 *
 * ## ⛔ The defect this replaces, in one measurement
 *
 * A Claude memory store can contain an index and multiple topic files. List the store rather than treating its one index path as the entire memory:
 *
 * ```text
 * 205 B    MEMORY.md                        ← the only one the panel listed
 * 1691 B   brobot-home-is-provider-home.md  ⛔ invisible
 * 263 B    user_reviewer_handle.md          ⛔ invisible
 * ```
 *
 * ⛔ **Two of three files and 1,954 of 2,159 bytes were in the store and not on the panel** — and
 * the panel's own sentence is what makes that a defect rather than an omission. 318 shipped
 * *"Nothing here says which of these the agent has actually looked up"*, whose *"these"* reads as
 * *"the store"*. A list holding one file in three had already made it false.
 *
 * ## ⚑ 317's ruling applied rather than a second one invented
 *
 * 317 distinguishes what the provider puts in front of the model from what the agent reads only if
 * it chooses to, and {@link isClaudeMemoryTopic} carries the measurement for this provider: the
 * CLI splices `MEMORY.md` and nothing else into its own system prompt, and the one
 * mechanism that could attach a memory file unasked is gated off in this app's child env. So the
 * index is `'prompt'`, every topic file is `'on-request'`, and the reach word on each row is the
 * same one Codex's store already earns.
 *
 * ⚠️ **The pairing in `MEMORY.md` is NOT parsed** (322 §3.2). The index is prose the model writes
 * — `- [Title](file.md) — hook` by instruction, whatever it types in practice — and a link table
 * derived from it would put a relationship on the panel that nothing checked. The DIRECTORY is the
 * fact; the index's job is stated in the note sentence and the files are listed as they are on disk.
 */
interface ClaudeMemoryRead extends AgentMemoryStoreRead {
  /** How many topic files are on disk, and how many of them the list above holds. */
  topicsFound: number
  topicsListed: number
  /** Whether anything in this store actually reaches the prompt — i.e. the index exists. */
  injects: boolean
  /**
   * ⛔ **When this app ASKED for all of the above** (604) — see
   * {@link MemoryLoadedEvent.lookedAt} for what the number is a time of and whose act that is.
   *
   * ⚠️ **Required here and optional on the wire**, which is the split `599` already uses: the
   * reader always takes one, and the event type has to keep describing rows written before it did.
   */
  lookedAt: number
}

export function readClaudeAgentMemory(providerHome: string): ClaudeMemoryRead {
  // 🔴 **604 · the moment we ASKED, above every syscall in this function** — see
  // {@link MemoryLoadedEvent.lookedAt} for what it is a time OF and why it is one number.
  //
  // ⛔ **The first line, not the last, and not one per read.** Everything below does real I/O — a
  // `realpath`, a listing, and one guarded read per file — so a stamp taken at the BOTTOM would
  // date the listing that produced `topicsFound` with the moment the last file finished, and *"we
  // saw N beside it then"* would be a claim about a directory read earlier than it says. ⚑ Taken
  // here, every fact this function returns is from at-or-after the number, which is the direction
  // that can only under-claim. ⚠️ **One number because the row is one row**: `599`'s field is per
  // file because its list is per file, and this one accompanies a single path and a single count.
  const lookedAt = Date.now()
  // ⚑ Derived once, from the SAME function that produced the path we read — never a second copy of
  // the provider's directory scheme (032). Only the home is real-pathed, which is what makes this
  // "did the link move it" rather than "is any component of this path a link".
  const dir = claudeAutoMemoryDir(providerHome)
  const realDir = claudeAutoMemoryDir(realPath(providerHome))
  const topics = claudeMemoryTopics(dir)
  const read = readMemoryStore([
    {
      path: claudeAutoMemoryIndex(providerHome),
      derived: claudeAutoMemoryIndex(realPath(providerHome)),
      kind: 'agent-memory',
      // ⚑ The CLI loads this file into its own system prompt before this app is asked
      // anything: a real child answered from it with no tool call.
      reach: 'prompt',
    },
    // ⛔ **The index is FIRST and that is a budget decision as well as an order** (187 §2). The
    // accumulator in `readMemoryStore` is spent in this order, so a store of twenty topic files can
    // never evict the one file the model was actually given. `instructions.test.ts` asserts it.
    ...topics.names.slice(0, AGENT_MEMORY_NOTES_SHOWN).map((name) => ({
      path: join(dir, name),
      derived: join(realDir, name),
      kind: 'agent-memory-topic' as const,
      // ⚠️ Availability, never comprehension — the same word Codex's notes get, for the same
      // reason: the file is in the store and the agent can open it. Saying the model "has" it
      // would be 305's defect with a friendlier face.
      reach: 'on-request' as const,
    })),
  ])
  // ⛔ **De-duplicated, and this is the case §3.4 asked about** (found writing this). When
  // `memory/` is a link that leads NOWHERE, `readMemoryStore` already reports it: the index read
  // comes back `absent` and {@link brokenMemoryLink} walks up to the directory. The listing sees the
  // same broken directory and would name it a second time — one fact, two rows, on the one panel
  // whose whole job is to be readable. The leaf's row wins because it is the one that ran first.
  if (topics.refused !== null && !read.refused.some((row) => row.path === topics.refused?.path)) {
    read.refused.push(topics.refused)
  }
  return {
    ...read,
    // ⚠️ `existsSync` rather than "did we read anything", and it FOLLOWS links: a `memory/`
    // pointed at another disk is a store, and a DANGLING one is not — which leaves the broken-link
    // row above to say what happened, instead of a sentence about a directory that is gone.
    dir: existsSync(dir) ? dir : null,
    topicsFound: topics.names.length,
    topicsListed: read.memory.filter((item) => item.kind === 'agent-memory-topic').length,
    // ⚑ **Whether the INDEX is really there** — 317 M25's lesson, on the other provider. A profile
    // whose agent has written topic files but no index yet has nothing in the prompt, and a
    // sentence claiming one file is in front of the model would send the reader looking for it.
    injects: read.memory.some((item) => item.reach === 'prompt'),
    lookedAt,
  }
}

/**
 * The topic filenames beside the index, **by name, ascending** — or a refusal about the directory.
 *
 * ⚠️ **Ascending, and it is the only order these names have.** Codex's notes carry a fixed-width
 * timestamp, so 317 could sort them newest-first and mean it. A Claude memory is named for its
 * subject — `user_role.md`, `feedback_testing.md` — and the provider's own instruction is
 * *"organize memory semantically by topic, not chronologically"*. ⛔ Sorting these by `mtime` would
 * invent a recency the store does not record; byte order is stable, and it is what a person
 * scanning a directory listing already expects.
 *
 * ⚑ **Flat, deliberately.** The index format the provider dictates is `- [Title](file.md)`, one
 * segment, and {@link memoryDirNames} drops directories the way 317's reader does. A subdirectory
 * in this store is the provider's skills folder or something a person put there, and neither is a
 * memory the agent filed.
 */
function claudeMemoryTopics(dir: string): {
  names: string[]
  refused: RefusedInstruction | null
} {
  const listed = memoryDirNames(dir, true)
  return { names: listed.names.filter(isClaudeMemoryTopic), refused: listed.refused }
}

/**
 * 🔴 **What a CODEX profile remembers** (317 §2) — the store 314 switched on, read for display.
 *
 * ## ⛔ The ruling: three of the five, and the reason the other two are not on the panel
 *
 * 312 measured the whole tree on a real 0.146.0 child. This shows:
 *
 * | file | why it is here |
 * |---|---|
 * | `memories/memory_summary.md` | The provider injects it into every request, so the panel exposes text the model receives. |
 * | `memories/MEMORY.md` | The consolidated handbook holding the memory process's conclusions. |
 * | `memories/extensions/ad_hoc/notes/*.md` | Notes created at the person's explicit request; show the resulting files even without memory-call events. |
 *
 * ⛔ **`raw_memories.md` and `rollout_summaries/` are not on it**, and the reason is not that the
 * model cannot see them — it can, through `memories__list`/`read`/`search`, exactly like the three
 * above. The reason is **status**: they are stage 1's dump and one machine-written précis per
 * conversation the extractor ate, and phase 2 rewrites both. A panel that rendered them under
 * *"what the agent remembers"* would be inventing a standing they do not have, and a user who
 * edited one would be editing an input. ⚠️ They are also the unbounded half — 312's single
 * background run produced a rollout summary from one conversation.
 *
 * ⚑ **Not listed is not hidden.** {@link codexMemoryNote} names them, by filename, in the sentence
 * whose documented job is to let the list above be read as complete.
 *
 * ## 🔒 The ad-hoc directory is ENUMERATED, and that is a different act from reading a leaf
 *
 * ⛔ **A symlinked `notes/` is refused, not followed** — the only place this reader declines a link.
 * The two fixed files are followed under 170 §2's polarity argument, which is about a path the
 * PROVIDER derives and reads. Enumeration is not that: `notes -> ~/Documents` would have this app
 * listing and reading a directory nobody's provider ever looked at, and the whole store's shape
 * would come from the link rather than from Codex.
 *
 * 🔴 **`733` kept it, and its reason is why.** It used to cite the rule on a symlinked `.claude`
 * directory *"for the same stated reason"*; that one went at `733` because what it kept out was a
 * credential (R93, *"remove old guards"*). This one is about the store's SHAPE — which files are
 * Codex's — and not about a credential. ⚠️ **Its premise is argued, not measured**: `317` did not
 * watch Codex walk, or refuse, a linked `notes/`.
 */
interface CodexMemoryRead extends AgentMemoryStoreRead {
  /** How many ad-hoc notes are on disk, and how many of them the list above holds. */
  notesFound: number
  notesListed: number
  /** Whether anything in this store actually reaches the prompt — i.e. the summary exists. */
  injects: boolean
  /** Which of the pipeline's own files exist, so the sentence names only what is really there. */
  pipeline: string[]
}

export function readCodexAgentMemory(providerHome: string): CodexMemoryRead {
  const dir = codexMemoryDir(providerHome)
  const realDir = codexMemoryDir(realPath(providerHome))
  const notesDir = codexAdHocNotesDir(providerHome)
  // ⚠️ Hoisted: `realPath` walks the filesystem, and this was being recomputed once per note.
  const realNotesDir = codexAdHocNotesDir(realPath(providerHome))
  const notes = adHocNotes(notesDir)

  const candidates: MemoryCandidate[] = [
    ...CODEX_MEMORY_STORE_FILES.map((file) => ({
      path: join(dir, ...file.at),
      derived: join(realDir, ...file.at),
      kind: 'agent-memory' as const,
      reach: file.reach,
    })),
    ...notes.names.slice(0, AGENT_MEMORY_NOTES_SHOWN).map((name) => ({
      path: join(notesDir, name),
      derived: join(realNotesDir, name),
      kind: 'agent-memory-note' as const,
      // ⚠️ Availability, never comprehension: the note is in the store and the agent can search it.
      // Saying the model "has" it would be 305's defect with a friendlier face.
      reach: 'on-request' as const,
    })),
  ]

  const read = readMemoryStore(candidates)
  if (notes.refused !== null) read.refused.push(notes.refused)
  const listed = read.memory.filter((item) => item.kind === 'agent-memory-note').length
  return {
    ...read,
    // ⚠️ `existsSync` rather than "did we read anything": a store that exists and holds nothing we
    // show is still a store, and the sentence about it is still true. ⛔ It follows links, so a
    // `memories/` pointed at another disk is a store and a DANGLING one is not — which is the
    // answer that leaves the broken-link row to say what happened.
    dir: existsSync(dir) ? dir : null,
    notesFound: notes.names.length,
    notesListed: listed,
    // ⚑ **Whether the SUMMARY is really there**, so the sentence can say what is in the prompt
    // rather than what would be. ⚠️ Found reviewing this diff: a profile whose agent has written
    // only ad-hoc notes has no `memory_summary.md` yet, and a sentence stating that one file is in
    // front of the model sent the reader looking for a file that does not exist — 317's own defect
    // class, in the sentence 317 added.
    injects: read.memory.some((item) => item.reach === 'prompt'),
    pipeline: CODEX_MEMORY_PIPELINE_FILES.filter((name) => existsSync(join(dir, name))),
  }
}

/**
 * The ad-hoc note filenames, **newest first**, or a refusal when the directory is a link.
 *
 * ⚑ **Exported since 318, for one caller and one reason** (`memory-notes.ts`): the turn-boundary
 * observation asks the same question this does — *which notes are in this store* — and 169 §1 is
 * that one rule written in two places drifts. A second listing would have had to re-decide that a
 * subdirectory named `*.md` is not a note and that a linked ENTRY is, and the day the two answered
 * differently the transcript would announce a note the panel refused to show.
 *
 * ⚠️ **Sorted by NAME, descending.** 312 read the convention out of the child's own tool signature:
 * `YYYY-MM-DDTHH-MM-SS-<slug>.md`, fixed-width leading timestamp, so byte order is chronological
 * order and no `stat` is needed. It is also the more honest key — the name carries the timestamp the
 * AGENT declared, where an `mtime` is whatever last touched the file.
 */
export function adHocNotes(notesDir: string): {
  names: string[]
  refused: RefusedInstruction | null
} {
  const listed = memoryDirNames(notesDir, false)
  // ⛔ **Descending, and 322 left it alone.** The order is 317's ruling and it belongs to THIS
  // store: the timestamp is in the name, so newest-first is a real answer here and is not one for
  // a store whose names are subjects. See {@link claudeMemoryTopics} for the other order.
  return { names: [...listed.names].reverse(), refused: listed.refused }
}

/**
 * ⚑ **W4.177 — how many files a memory store holds that a page could show**, without reading any:
 * its fixed files that exist, and how many topic files or notes it lists — {@link readAgentMemoryPage}'s
 * own `total` and `listed`, for the unpaged read that lists the first {@link AGENT_MEMORY_NOTES_SHOWN}.
 */
export function memoryStoreCounts(
  provider: Provider,
  providerHome: string,
): { readonly total: number; readonly listed: number } {
  const isClaude = providerValue(provider, { claude: true, codex: false })
  const dir = isClaude ? claudeAutoMemoryDir(providerHome) : codexMemoryDir(providerHome)
  const fixed = isClaude
    ? [claudeAutoMemoryIndex(providerHome)]
    : CODEX_MEMORY_STORE_FILES.map((file) => join(dir, ...file.at))
  const listing = isClaude ? claudeMemoryTopics(dir) : adHocNotes(codexAdHocNotesDir(providerHome))
  const listed = listing.names.length
  return { total: fixed.filter((path) => existsSync(path)).length + listed, listed }
}

/** ⚑ **F093 · C8 b — the most topic files or notes one page of a memory store holds.** */
export const MEMORY_PAGE_MOST = 100

/**
 * 🔴 **F093 · C8 b — one PAGE of an agent's memory store**, for the agent-input popup: the store's
 * fixed files (Claude's `MEMORY.md`; Codex's summary and handbook) on the first page, then its topic
 * files or notes from `offset`, at most `limit` of them, in each store's own order.
 *
 * ⚑ **`offset` counts topic files and notes only**, so the fixed files are always on page one.
 * ⚠️ **The 256 KiB budget is spent per page** ({@link readMemoryStore}). ⛔ The launch readers above
 * are unchanged: they still list the first {@link AGENT_MEMORY_NOTES_SHOWN}.
 */
export interface AgentMemoryPage extends AgentMemoryStoreRead {
  /** Every file the store holds that this page could show: its fixed files that exist, and every topic file or note. */
  total: number
  /** Where the next page starts, or `null` after the last. */
  nextOffset: number | null
  /** ⚑ W4.177 — how many topic files or notes the store lists: an `offset` at or past it is past the end. */
  listed: number
  /**
   * ⚑ **The names the launch readers list** — the first {@link AGENT_MEMORY_NOTES_SHOWN} topic files
   * or notes, independently of the window's selected entry.
   */
  firstListed: readonly string[]
}

export function readAgentMemoryPage(
  provider: Provider,
  providerHome: string,
  offset: number,
  limit: number,
): AgentMemoryPage {
  const realHome = realPath(providerHome)
  const isClaude = providerValue(provider, { claude: true, codex: false })
  const dir = isClaude ? claudeAutoMemoryDir(providerHome) : codexMemoryDir(providerHome)
  const fixed: MemoryCandidate[] = isClaude
    ? [
        {
          path: claudeAutoMemoryIndex(providerHome),
          derived: claudeAutoMemoryIndex(realHome),
          kind: 'agent-memory',
          reach: 'prompt',
        },
      ]
    : CODEX_MEMORY_STORE_FILES.map((file) => ({
        path: join(dir, ...file.at),
        derived: join(codexMemoryDir(realHome), ...file.at),
        kind: 'agent-memory' as const,
        reach: file.reach,
      }))
  const listDir = isClaude ? dir : codexAdHocNotesDir(providerHome)
  const realListDir = isClaude ? claudeAutoMemoryDir(realHome) : codexAdHocNotesDir(realHome)
  const listing = isClaude ? claudeMemoryTopics(listDir) : adHocNotes(listDir)
  const listedKind = isClaude ? ('agent-memory-topic' as const) : ('agent-memory-note' as const)
  const from = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0
  const most = Number.isFinite(limit)
    ? Math.min(MEMORY_PAGE_MOST, Math.max(1, Math.floor(limit)))
    : AGENT_MEMORY_NOTES_SHOWN
  // ⚠️ **A page ends where its budget does**, so no file falls between two pages: the files are
  // measured before they are read (each at most the per-file cap), and the page stops at the first
  // that would not fit — which then opens the next one.
  const onThePage = from === 0 ? fixed : []
  let budget =
    AGENT_MEMORY_TOTAL_CAP - onThePage.reduce((spent, file) => spent + sizeOnDisk(file.path), 0)
  const taken: string[] = []
  for (const name of listing.names.slice(from, from + most)) {
    const cost = sizeOnDisk(join(listDir, name))
    if (taken.length > 0 && cost > budget) break
    budget -= cost
    taken.push(name)
  }
  const read = readMemoryStore([
    ...onThePage,
    ...taken.map((name) => ({
      path: join(listDir, name),
      derived: join(realListDir, name),
      kind: listedKind,
      reach: 'on-request' as const,
    })),
  ])
  const listingRefused = listing.refused
  if (listingRefused !== null && !read.refused.some((row) => row.path === listingRefused.path)) {
    read.refused.push(listingRefused)
  }
  const after = from + taken.length
  return {
    ...read,
    dir: existsSync(dir) ? dir : null,
    total: fixed.filter((file) => existsSync(file.path)).length + listing.names.length,
    nextOffset: after < listing.names.length ? after : null,
    listed: listing.names.length,
    firstListed: listing.names.slice(0, AGENT_MEMORY_NOTES_SHOWN),
  }
}

interface MemoryStoreLayout {
  readonly fixedFiles: (home: string) => readonly string[]
  readonly notesFolder: (home: string) => string
  readonly listNotes: (folder: string) => { names: string[] }
  readonly acceptsNote: (name: string) => boolean
}

/** The reader and writer use the same provider-owned memory locations and note names. */
export const MEMORY_STORE_LAYOUT: Readonly<Record<Provider, MemoryStoreLayout>> = {
  claude: {
    fixedFiles: (home) => [claudeAutoMemoryIndex(home)],
    notesFolder: claudeAutoMemoryDir,
    listNotes: claudeMemoryTopics,
    acceptsNote: isClaudeMemoryTopic,
  },
  codex: {
    fixedFiles: (home) =>
      CODEX_MEMORY_STORE_FILES.map((file) => join(codexMemoryDir(home), ...file.at)),
    notesFolder: codexAdHocNotesDir,
    listNotes: adHocNotes,
    // The caller checks safe Markdown filenames before asking about provider eligibility.
    acceptsNote: () => true,
  },
}

/** Resolve a selected entry against fresh names, then let the bounded page reader read it. */
export function readAgentMemorySelection(
  provider: Provider,
  providerHome: string,
  entry: string,
): InjectedInstruction | undefined {
  const layout = MEMORY_STORE_LAYOUT[provider]
  const fixed = layout.fixedFiles(providerHome)
  if (fixed.includes(entry))
    return readAgentMemoryPage(provider, providerHome, 0, 1).memory.find(
      (item) => item.path === entry,
    )
  const folder = layout.notesFolder(providerHome)
  const names = layout.listNotes(folder).names
  const offset = names.findIndex((name) => join(folder, name) === entry)
  if (offset < 0) return undefined
  // A changed ordering can refuse the selection; it cannot redirect it to another file.
  return readAgentMemoryPage(provider, providerHome, offset, 1).memory.find(
    (item) => item.path === entry,
  )
}

/** ⚑ A file's size, as a page's budget counts it: at most the per-file cap, and 0 when it is not there. */
function sizeOnDisk(path: string): number {
  return Math.min(INSTRUCTION_FILE_CAP, safeStat(path)?.size ?? 0)
}

/**
 * 🔴 **The `*.md` files in one memory directory, by name, ascending — or one refusal about the
 * directory itself.** The guards, and only the guards; every caller decides its own order.
 *
 * ⚠️ **Extracted at 322 rather than copied** (169 §1). Claude's store needed the same enumeration
 * and this block is four rulings deep — a dangling link is not a refusal, a working link is refused
 * rather than followed, a linked ENTRY is kept, a subdirectory is dropped in silence. Three of the
 * four were written in response to a defect. ⛔ **A second copy is a second place for one of them to
 * be re-decided**, and the day the two answered differently one store would refuse what the other
 * showed, with nothing on either panel saying why.
 *
 * ## 🔒 A working directory LINK: refused for one store, followed for the other, and why
 *
 * ⛔ **`followLink: false` is 317's ruling and it stays exactly as it was** — `733` too kept it,
 * because its reason is the store's shape and not a credential (see {@link readCodexAgentMemory}). `notes -> ~/Documents`
 * would have this app listing and reading a directory nobody's provider ever walked, and the whole
 * store's shape would come from the link rather than from Codex. Enumeration is not a leaf read:
 * 170 §2's polarity argument is that the provider `stat`s a path it DERIVED before this app is
 * asked anything, so refusing that leaf removes a row and removes nothing from the prompt.
 *
 * ⚑ **`followLink: true` is Claude's, and it is the same argument reaching the other answer** (322
 * §3.4). This app writes `Settings.autoMemoryDirectory` itself — see `claudeAutoMemoryDir` — so the
 * directory at the far end of that link is not a place the provider *might* look: it is the memory
 * store, by this app's own instruction, and the 2.1.218 CLI resolves it, reads its index into the
 * system prompt and lets the model open anything beside it. ⚠️ **And 314 §3 has already ruled on
 * this exact path**: somebody may point `memory/` at a real directory on another disk on purpose,
 * and a check that answered *"is this a symlink"* told them their memory was gone. ⛔ **Refusing to
 * enumerate here would put that row back**, one dispatch after it was removed, on a store this app
 * has already read the index out of. Every row it produces still discloses where it really came
 * from, on {@link InjectedInstruction.link}.
 */
function memoryDirNames(
  dir: string,
  followLink: boolean,
): {
  names: string[]
  refused: RefusedInstruction | null
} {
  let seen: Stats
  try {
    seen = lstatSync(dir)
  } catch {
    return { names: [], refused: null } // nothing written yet — the ordinary case, and it is silent
  }
  if (seen.isSymbolicLink()) {
    // ⛔ **A link that leads NOWHERE is not a refusal** (314 §3), and this branch is here because
    // the one below would have called it one. ⚠️ Found reviewing 317's diff: nothing declined to
    // read anything when the far end of a link is gone, and *"not read: symlink"* would send
    // somebody looking for a decision the app never made. {@link brokenMemoryLink} already knows
    // how to say it, target and all. ⚑ It runs for BOTH policies, because a broken link is not a
    // decision either of them made.
    const broken = brokenMemoryLink(dir)
    if (broken !== null) return { names: [], refused: broken }
    // 🔒 See this function's own note for why one store refuses here and the other does not.
    // Named as the DIRECTORY, because that is what was wrong.
    if (!followLink) return { names: [], refused: { path: dir, reason: 'symlink' } }
  }
  // ⚠️ **`statSync`, and only on the followed path.** `seen` is the LINK when there is one, so it
  // is never a directory and the check below would refuse every working redirect as
  // `not-a-regular-file` — the same row under a different word.
  const target = seen.isSymbolicLink() ? safeStat(dir) : seen
  if (target === null || !target.isDirectory()) {
    return { names: [], refused: { path: dir, reason: 'not-a-regular-file' } }
  }
  try {
    const names = readdirSync(dir, { withFileTypes: true })
      // ⚠️ **A symlinked ENTRY is kept, and that is not an inconsistency with the check above.**
      // The directory is refused because following it would let a link decide the whole store's
      // shape; a single memory that is a link is 170 §2's ordinary case — the agent reaches it
      // whichever way we go, so the guarded reader follows it and the panel discloses where it
      // went. Only a DIRECTORY is dropped here, silently: a subdirectory named `*.md` is not a
      // memory, and Codex's `memories__list` reports its `entry_type` as such.
      .filter((entry) => !entry.isDirectory() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort()
    return { names, refused: null }
  } catch {
    return { names: [], refused: { path: dir, reason: 'unreadable' } }
  }
}

/**
 * The app's own generated file is named as the app's, not passed off as something the user wrote.
 *
 * ⚠️ **Compared on the real path** (170 §4). A lexical compare answered "no" for a cwd that reaches
 * the workspace through an alias, and the direction of that mistake is the wrong one: BroBot's own
 * generated file would have been presented as project memory the user wrote, which is the exact 086
 * provenance claim this label exists to make.
 */
function kindFor(path: string, workspaceFile: string | undefined): InjectedInstructionKind {
  return workspaceFile !== undefined && realPath(path) === realPath(workspaceFile)
    ? 'workspace-instructions'
    : 'project-memory'
}

/**
 * 🔴 **The same kilobyte, once** (594, `HO-075` §1: *"an agent working in a directory receives that
 * directory's conventions, ONCE, whatever engine it runs on"*).
 *
 * > ⚑ **The rule: among the candidates that are files BroBot GENERATED into its own workspace and
 * > still hold exactly what BroBot wrote, keep the last in prompt order and label it as ours.**
 *
 * ⛔ **Run after the walk and BEFORE {@link allocate}, over what the GUARDED READER returned.** Both
 * files come back through {@link readInstructionFile} like everything else — links followed, same
 * per-file cap — so this compares the bytes that would have been SENT, not
 * two fresh reads of two names. ⚠️ A second read here would be two chances to disagree about one
 * fact, which is the argument {@link blockHeader} makes about its own duplication.
 *
 * ## ⛔ It fires on OUR TEXT, never on two files that merely match
 *
 * ⚑ **`ours` is a path AND a content**, so a file at a name we own that does not hold what we wrote
 * is not ours: it is not dropped, it is not relabelled, and it reaches the model under the label the
 * walk already gave it. 🔴 **576 ruled a blanket content dedupe OUT** — *"a blanket content dedupe
 * across repositories would discard intentional sources"* — and this is not one: a repository whose
 * own `AGENTS.md` and `CLAUDE.md` are identical by hand keeps both, with both labels, because
 * neither is at a path this app published.
 *
 * ⚠️ **The LAST in prompt order is the survivor, and that is the CLI's own ordering rather than a
 * preference.** Within one directory the convention file is taken before the `CLAUDE.md` spelling,
 * later text is what wins when two files disagree, and `kindFor` has called that last one
 * `workspace-instructions` since 158 — so keeping it changes neither the position in the prompt nor
 * the label a person already sees. ⛔ **The survivor is relabelled only when it is not already
 * ours**, which is the case where our `CLAUDE.md` is absent or refused and the `AGENTS.md` twin is
 * carrying the body alone: `repository-conventions` says *"this repository's shared agent
 * conventions"*, and the workspace is not a repository and nobody shared anything (164 §3.2, in the
 * sibling of the file 164 §3.2 was written about).
 *
 * ## 🔴 It CAN change a budgeted outcome — measured, after a first draft claimed the opposite
 *
 * ⛔ **576's warning was that *"the budget can drop a source in a different case"*, so a dedupe could
 * silently change WHICH source survives.** ⚠️ **Of the PAIR the warning is refuted, and that half is
 * arithmetic:** {@link allocate} grants nearest-first, `candidates` holds the convention file before
 * the `CLAUDE.md` spelling in one directory, so the reverse walk considers our `CLAUDE.md` **first**
 * of the two — and at a strictly lower cost, because `repository-conventions`' scope wording is 45
 * characters longer than `workspace-instructions`'. **In no budget state can this keep the twin
 * instead of the labelled copy.**
 *
 * 🔴 **Of the REST of the chain the warning holds, and a first draft of this docblock got it exactly
 * backwards.** ⛔ It said *"removing one candidate only ever frees budget… the grant loop is
 * `continue`, not `break`, so every file granted before 594 is still granted"*, and cited `continue`
 * as the proof. **`break` is the monotone one.** With `continue`, freeing ~1.2 kB near the front of
 * the grant order can admit a file of up to {@link INSTRUCTION_FILE_CAP} that did not fit before,
 * which then spends more than was freed and can cost a smaller, later item its slot.
 *
 * ⚠️ **Reproduced against this allocator rather than argued** (594): a saturated chain under a cwd
 * of the workspace, where dropping the 1,210-byte twin admitted a 65,536-byte `CLAUDE.md` from the
 * outer chain and pushed the 3,000-byte **compiled profile bundle** into `over-budget`. ⚑ **The
 * bundle no longer loses** (W4.178): {@link allocate} grants `profile-instructions` before
 * everything, so the same displacement now costs one of the chain's own files.
 *
 * ⚑ **Why the drop still belongs BEFORE {@link allocate} and not after it.** ⛔ Charging the budget
 * for a kilobyte that is never sent would make a person lose a real instruction file to make room
 * for a copy no model ever received. ⚠️ The displacement above is the allocator applying its own
 * stated ranking to one fewer candidate; the alternative is the app lying about what it appended.
 * 🔴 **Reachability, stated rather than glossed:** the chain has to be within about 1.2 kB of
 * saturating `INSTRUCTION_TOTAL_CAP`'s 256 kB, with a candidate sized into the window the drop
 * opens. It is not an everyday state — and the correctness of this paragraph does not depend on
 * that.
 *
 * ⛔ **Returns the path it dropped AND the row it kept**, because {@link noteFor} names the first on
 * the panel and the caller has to check the second survived {@link allocate} before saying so — a
 * sentence asserted rather than measured is the thing this module has been burned by twice.
 */
function sendOurWorkspaceBodyOnce(
  candidates: InjectedInstruction[],
  ours: readonly WorkspaceOwnFile[] | undefined,
): { readonly dropped: string; readonly kept: InjectedInstruction } | null {
  if (ours === undefined || ours.length === 0) return null
  // ⛔ **Both halves.** `realPath` for the same reason {@link kindFor} compares on it (170 §4) — a
  // cwd that reaches the workspace through an alias answers *no* to a lexical compare — and the
  // text because a name we own is not a claim that we wrote what is at it.
  const published = new Map(ours.map((one) => [realPath(one.path), one.content]))
  const generated = candidates.filter((item) => {
    const wrote = published.get(realPath(item.path))
    // ⚑ **A CUT file is refused by the comparison itself, so there is no truncation clause here.**
    // `wrote` is the WHOLE body this app published; {@link readInstructionFile} truncates at
    // {@link INSTRUCTION_FILE_CAP}, so a file big enough to be cut cannot equal it whatever its
    // first 64 KiB say. ⛔ A `!item.truncated` guard was written here and then removed: nothing can
    // make it decide anything, and a line no mutation can kill is not carrying its rule. ⚠️ The
    // PROPERTY is pinned by a test all the same — two enormous files sharing a prefix keep both —
    // because it must survive whichever line happens to enforce it.
    return wrote !== undefined && item.text === wrote
  })
  // 🔴 **The other direction of the same rule, and it is the one that cost more to get wrong.**
  // ⛔ {@link kindFor} calls the workspace `CLAUDE.md` ours by NAME and has since 158, so a file the
  // agent wrote at that path reaches the model under *"generated by BroBot for this workspace"* and
  // lands on the sheet under `factory` — *"Ships with the app. Nobody here can edit it."* ⚠️ Nothing
  // republishes it on a resume or on a session that names that directory, so those bytes survive to
  // be read. ⚑ **A path we publish at is not a claim we wrote what is there**, and this is where
  // that is made true: what is not ours goes back to belonging to the place it sits in.
  for (const item of candidates) {
    if (item.kind !== 'workspace-instructions' || generated.includes(item)) continue
    item.kind = 'project-memory'
  }

  // ⚑ **Everything that IS ours is labelled ours, whether or not anything is dropped.** ⛔ Two arms
  // need it and a keeper-only relabel served one: our `CLAUDE.md` absent or refused, so the
  // `AGENTS.md` twin carries the body alone; and the pair being ours but no longer one text, where
  // both are sent and both are this app's. ⚠️ `repository-conventions` says *"this repository's
  // shared agent conventions"* — the workspace is not a repository and nobody shared anything.
  for (const item of generated) item.kind = 'workspace-instructions'

  // One copy is not a duplication, and the label above is all it needed.
  if (generated.length < 2) return null
  // The last in prompt order survives; everything else that is the same body of ours goes.
  const keep = generated[generated.length - 1]
  if (keep === undefined) return null
  let dropped: string | null = null
  for (const item of generated) {
    // ⛔ **The two are compared to EACH OTHER, not only each to its own published body** (found in
    // review). Each having matched what this app wrote into it is not the same fact as the two
    // being one text — they are one text today only because `renderFor`'s header ternary has two
    // identical arms, and that ternary exists so the Codex arm can have a voice of its own. ⚠️ The
    // day it does, these are two different texts under two names and BOTH must be sent.
    if (item === keep || item.text !== keep.text) continue
    dropped = item.path
    candidates.splice(candidates.indexOf(item), 1)
  }
  return dropped === null ? null : { dropped, kept: keep }
}

/**
 * 🔴 **Which part of a file this app appended is whose** (583, `HO-073` §4) — and the one file
 * that has an answer.
 *
 * ⛔ **Only the compiled bundle, and only when the bytes READ BACK are the bytes composed.** The
 * spans are indices into the composed string; the row carries the string this reader took off
 * disk a moment later. ⚠️ Those are the same string on every ordinary launch — the publisher just
 * wrote it and `isOurs` refused to overwrite anything it did not write — but *ordinarily the same*
 * is not *the same*, and a span list slid by one truncation would file a person's own rules under
 * this app's name.
 *
 * ⚑ **So the check is EQUALITY of the whole text**, not a length, not a prefix: the cheapest test
 * that cannot be satisfied by a near miss. 🔴 **And its failure arm attaches nothing** rather than
 * attaching what it can — `438`'s fail-closed rule, which the sheet completes by drawing the row
 * whole and saying it could not tell which part is whose.
 */
function sectionsOf(
  kind: InjectedInstructionKind,
  text: string,
  composed: { readonly text: string; readonly spans: readonly InstructionSpan[] } | undefined,
): { sections?: readonly InstructionSpan[] } {
  if (kind !== 'profile-instructions' || composed === undefined) return {}
  return composed.text === text ? { sections: composed.spans } : {}
}

/**
 * ⚠️ **D-024 · R1 — reached only by a reading no launch built**: every launch composes this
 * conversation's own text (`main/index.ts`), so a Codex launch is always
 * {@link NOTE_SENDS_THIS_CONVERSATIONS_TEXT}. ⚑ Kept for {@link InstructionInputs.thisConversation}'s
 * standing: a reading that composed none sends this provider nothing, and says so.
 */
const NOTE_PROVIDER_READS_ITS_OWN =
  'BroCrew appends nothing for this provider — it reads its own instruction files, and the list ' +
  'below is the one it reported.'

/**
 * ⚑ **D-024 · R1 — the same note when this conversation's own text was sent**: that text is the
 * one thing no file can carry for one conversation of a profile, and it rides in front of the
 * first message of a launch ({@link SessionLaunchRead.firstTurnLead}). ⚑ **D-039** — it opens
 * with how to use the tools (the composition root adds them on this provider at every launch), so
 * the note no longer says *only*. ⚑ **W4.179** — once per thread, and after that only what changed
 * (`codex-lead.ts`), so the note says so.
 */
const NOTE_SENDS_THIS_CONVERSATIONS_TEXT =
  'BroCrew sends this provider how to use its tools and what is true of this conversation in ' +
  'front of a message: the whole of it the first time, and again after the conversation is ' +
  'compacted; otherwise only what changed — it reads its own instruction files, and the list ' +
  'below is the one it reported.'

/**
 * 🔴 **What the Codex list does NOT include, said in the field whose job that is** (317 §2.1, §3).
 *
 * ⛔ **The alternative was a refused row per file, and it is wrong here in both directions.** A
 * store with forty rollout summaries would put forty rows on a panel to say forty times that
 * something is not a memory — 086 in the other direction — and a store with a thousand ad-hoc notes
 * would bury the three the user came to read. {@link SessionInstructions.note} is documented as the
 * sentence that lets the list above *"be read as complete rather than as 'everything we happened to
 * find'"*, which is exactly this claim.
 *
 * ⚠️ **Every clause is a measurement.** The counts come off the directory, and the pipeline files
 * are named only when they are really there — a sentence that always listed them would be telling a
 * fresh profile about files it does not have.
 */
function codexMemoryNote(
  read: CodexMemoryRead,
  bundle: BundlePublish | undefined,
  /** ⚑ **D-024 · R1** — whether this conversation's own text was composed and sent. */
  sendsThisConversation: boolean,
): string {
  // 🔴 **What BroBot PUT there for this provider to read** (377) — the one thing
  // {@link NOTE_PROVIDER_READS_ITS_OWN} would otherwise leave a person to infer.
  //
  // ⛔ **It says *published*, never *appended*.** {@link SessionInstructions.injected} is documented
  // as text this app sent, and on this provider that list is empty and stays empty — the file below
  // is one the provider discovers natively. Two different acts, and 086 is exactly the rule that
  // they must not be described with one word.
  const published =
    bundle?.ok === true
      ? ` BroCrew published this profile's own instructions at ${bundle.path} for the provider to read.`
      : ''
  const lead = sendsThisConversation
    ? NOTE_SENDS_THIS_CONVERSATIONS_TEXT
    : NOTE_PROVIDER_READS_ITS_OWN
  if (read.dir === null) return `${lead}${published}`
  const parts = [
    `${lead}${published}`,
    `What this profile remembers is in ${read.dir}, written by the agent: ` +
      (read.injects
        ? `only ${CODEX_MEMORY_SUMMARY} is put in front of the model, and the agent reads the ` +
          'rest only if it chooses to.'
        : `nothing here is in front of the model yet — ${CODEX_MEMORY_SUMMARY} is the only file ` +
          'the provider injects and this profile has none, so the agent reads what is here only ' +
          'if it chooses to.'),
  ]
  if (read.notesFound > read.notesListed) {
    parts.push(`${read.notesListed} of ${read.notesFound} notes are listed here, newest first.`)
  }
  if (read.pipeline.length > 0) {
    parts.push(
      `${read.pipeline.join(' and ')} ${read.pipeline.length === 1 ? 'is' : 'are'} not listed — ` +
        'the extraction pipeline rewrites them, so they are its working material rather than ' +
        'something the agent decided to remember. The agent can still search them.',
    )
  }
  return parts.join(' ')
}

/**
 * 🔴 **What Claude's memory list does NOT say on its own** (322 §3.2) — the index's job, and the
 * count of what did not fit.
 *
 * ⛔ **Empty when this profile has no topic files, and that is §4's rule rather than an oversight.**
 * 317's empty state is *nothing at all* — no heading, no *"none"* — and a sentence explaining an
 * index that points at nothing would be 086 in the other direction: telling a fresh profile about
 * files it does not have, which is the exact defect 317 M25 found in 317's own sentence.
 *
 * ⚠️ **It says what the index IS, never what it points at.** §3.2 rules out parsing `- [Title](
 * file.md)` out of model-written prose to pair the rows up, and it is right to: the pairing would
 * be a claim nothing checked, drawn beside a listing that is a measurement.
 */
function claudeMemoryNote(read: ClaudeMemoryRead): string {
  if (read.dir === null || read.topicsFound === 0) return ''
  const parts = [
    read.injects
      ? `${AUTO_MEMORY_INDEX} in ${read.dir} is an index the provider puts in front of the ` +
        'model; the memories it points at are separate files beside it, which the agent reads ' +
        'only if it chooses to.'
      : // ⚑ 317 M25's lesson on the other provider: do not name a file in the prompt when this
        // profile has none. An agent that filed memories before writing an index is this case.
        // ⚠️ **"nothing in it" rather than "has none", and the difference is real** (found
        // reviewing this diff): an index that exists and is BLANK is skipped by the reader, and
        // the provider's own prompt then says *"Your MEMORY.md is currently empty"* — so a
        // sentence claiming the file does not exist would send somebody looking for a file they
        // are standing on.
        `Nothing in ${read.dir} reaches the model on its own yet: ${AUTO_MEMORY_INDEX} is the ` +
        'only file the provider puts in front of it, and there is nothing in this profile’s. The ' +
        'agent reads what is here only if it chooses to.',
  ]
  if (read.topicsFound > read.topicsListed) {
    parts.push(`${read.topicsListed} of ${read.topicsFound} memories are listed here, by name.`)
  }
  return parts.join(' ')
}

/**
 * 🔴 **The `sentOnce` clause is RENDERED FROM WHAT HAPPENED, never asserted** (594, standing rule 8
 * pointed at a person's sentence rather than a model's).
 *
 * ⛔ **`dropped` is the PATH of a row this launch actually removed**, so the sentence cannot outlive
 * the behaviour: a launch where the two files differ, where one was tampered with, or where no
 * workspace pair was published drops nothing and draws no clause at all. ⚠️ The name it prints comes
 * off that path and its partner off {@link INSTRUCTION_FILENAME}, rather than either being spelled
 * here, for the reason `blockHeader` gives about its own template — a second spelling of a filename
 * is a second thing to keep in step.
 *
 * ⚑ **Why this sentence and not a `refused` row.** The drawer's refusal list is drawn under a tab
 * called *not read*, over the lead *"Files on the walk BroBot would not read, and why"* — and this
 * file WAS read, was fine, and its bytes are in the prompt under the other name. ⛔ A row there
 * would be a refusal reported for something nothing declined, which is exactly what `187` §2 says
 * about `over-budget` one map entry away, and nothing a person could act on: BroBot owns both files
 * and rewrites them every launch. 🔴 **So the account of the walk is where it belongs**, and the
 * whole composed prompt is on the sheet's `as sent` tab either way.
 */
function noteFor(chain: string[], home: string, memory: string, dropped: string | null): string {
  const where =
    chain.length === 0
      ? `no directory was searched: this session's working directory is ${home} or above it, and ` +
        'BroCrew does not read instructions from your personal home'
      : `searched ${chain.length} ${chain.length === 1 ? 'directory' : 'directories'}, from ` +
        `${chain[0]} down to the working directory — the walk stops below ${home}, because a ` +
        // 169 §2 · the folder is named one clause earlier, in `${home}`. Saying "provider home"
        // after printing the path was the repo's word for the thing the sentence had just shown.
        "profile's identity comes from its own folder rather than from your personal one " +
        // ⚑ 736 · `733` F-1 — and a file on the way that LINKS into it is followed, as the CLI does.
        '(a file on the way that links into it is followed, as the CLI does, and its row says so)'
  // ⚑ **Both names, from the paths themselves** — see this function's docblock. `once` is non-empty
  // only on a launch where a second copy was actually dropped AND the keeper reached the model.
  const once =
    dropped === null
      ? ''
      : ` BroCrew writes this workspace's own instructions to both ${basename(dropped)} and ` +
        `${INSTRUCTION_FILENAME}, because Codex reads its own file and BroCrew reads yours for ` +
        'Claude; the two held the same text, so it was appended once. BroCrew rewrites both at ' +
        'every launch.'
  return (
    `Read at launch and appended as text; ${where}.${once} ` +
    'Editing one of these files takes effect the next time this conversation is opened, not now.' +
    // ⚠️ **Appended, never interleaved.** The sentence above is about the files BroBot reads and
    // sends; this one is about a store it neither reads for the prompt nor wrote. Joining them with
    // a conjunction would blur two provenances into one claim, which is what 086 is about.
    (memory === '' ? '' : ` ${memory}`)
  )
}

/**
 * **The exact text appended to the system prompt**, or `undefined` when there is nothing to append.
 *
 * The preamble names the agent. Each file keeps its own header so the model can attribute the
 * instructions to the file they came from.
 *
 * ⚠️ The headers are also what make the drawer's per-item list true: the user sees the same split
 * the model sees.
 */
export function composeSystemHint(
  injected: readonly InjectedInstruction[],
  /**
   * ⚑ **D-024 · R1 — this conversation's own text**, appended LAST under
   * {@link THIS_CONVERSATION_HEADER}: the CLI orders from the general to the specific — the
   * profile, then the project chain outermost to innermost — and one conversation is the most
   * specific scope there is. ⛔ Under a header of its own, so it is never read as the end of the
   * file before it. ⚠️ On Codex it is the whole composition, and it rides the first message of each
   * life ({@link SessionLaunchRead.firstTurnLead}).
   */
  thisConversation?: { readonly text: string },
  identity?: PromptIdentity,
): string | undefined {
  const parts: string[] = []
  if (injected.length > 0) {
    const blocks = injected.map((item) => `${blockHeader(item)}${item.text}`)
    parts.push(`${agentPreamble(identity)}${BLOCK_SEPARATOR}${blocks.join(BLOCK_SEPARATOR)}`)
  } else if (identity !== undefined && thisConversation !== undefined) {
    parts.push(agentPreamble(identity))
  }
  if (thisConversation !== undefined) parts.push(conversationBlock(thisConversation.text))
  return parts.length === 0 ? undefined : parts.join(BLOCK_SEPARATOR)
}

/**
 * ⚑ **D-024 · R1 — this conversation's block as sent**: its header, then its text — ONE string the
 * emitter and the accountant both call, {@link blockHeader}'s rule — and the per-message view, which
 * finds it in front of a Codex message (F093).
 */
export function conversationBlock(text: string): string {
  return `${THIS_CONVERSATION_HEADER}${BLOCK_SEPARATOR}${text}`
}

/**
 * ⚑ **W4.177 — the line the model read just above a file's text in the system prompt**, without the
 * blank line that follows it: {@link blockHeader}'s line, and in front of the FIRST file sent the
 * preamble too — the same strings {@link composeSystemHint} emits, so the two cannot drift. ⚑ For
 * the popup's reads, which give BroBot's appended text back part by part.
 */
export function headingAsSent(
  item: Pick<InjectedInstruction, 'path' | 'kind'>,
  first: boolean,
  preamble: string = agentPreamble(),
): string {
  const line = blockHeader(item).slice(0, -BLOCK_SEPARATOR.length)
  return first ? `${preamble}${BLOCK_SEPARATOR}${line}` : line
}

/**
 * ⚑ **D-024 · R1 — what {@link allocate} reserves for this conversation's block**: the block, and
 * the separator in front of it — charged once per block, as a file's is. ⚠️ `0` when none was
 * composed.
 */
function conversationBlockCost(thisConversation: { readonly text: string } | undefined): number {
  return thisConversation === undefined
    ? 0
    : byteLength(conversationBlock(thisConversation.text)) + byteLength(BLOCK_SEPARATOR)
}

/**
 * ⛔ **The per-file header, as ONE string that both the emitter and the accountant call** (187 §2).
 *
 * The accounting bug 168 M2 found was not an arithmetic slip — the budget simply had no idea this
 * text existed, because it was spelled inline inside {@link composeSystemHint} and nowhere else. A
 * header charged from a second copy of the template would drift the first time the wording changed;
 * charged from this one, the emitted string and the number it was weighed against cannot disagree.
 */
function blockHeader(item: Pick<InjectedInstruction, 'path' | 'kind'>): string {
  return `Contents of ${item.path} (${scopeWording(item.kind)}):${BLOCK_SEPARATOR}`
}

/**
 * What separates the preamble from the first block and each block from the next.
 *
 * ⚠️ Charged **once per block** rather than `n - 1` times, which is the same total: the preamble's
 * own trailing separator and the final block's absent one cancel exactly.
 */
const BLOCK_SEPARATOR = '\n\n'

/**
 * ⛔ **`workspace-instructions` had no wording of its own and inherited a FALSE one** (164 §3.2).
 *
 * The generated workspace file arrived under *"(project instructions, checked into the codebase)"* —
 * the CLI's phrase for a project `CLAUDE.md`, correct for those and wrong for this one. It is
 * checked into nothing: BroBot writes it, rewrites it on every launch, and the directory it lives in
 * is not a repository. A live tester read that label three lines above the CLI's own environment
 * block saying `Is a git repository: false` and reported the contradiction — boilerplate disagreeing
 * with boilerplate inside one prompt.
 *
 * ⚑ **The app already knew.** {@link kindFor} has distinguished this file since 158 so the drawer
 * could say *"BroBot wrote this one"*; only the sentence sent to the MODEL threw the distinction
 * away. 160's rule — match the CLI's framing — is what the other two branches are still doing, and
 * it never applied here, because the CLI has no such file to have a phrase for.
 */
function scopeWording(kind: InjectedInstructionKind): string {
  // 🔴 **377's two kinds get their own wording for 164 §3.2's reason**, which is the whole of why
  // this function exists: `workspace-instructions` once arrived under the CLI's phrase for a file it
  // was not, and a live tester read the contradiction three lines above the CLI's own environment
  // block. ⛔ Neither of these is *"checked into the codebase"* either — one is generated per launch
  // and the other is a shared convention file Claude does not select for itself.
  // ⚑ **D-024 · R1 — the rules and nothing about one conversation**: that is its own block, last.
  if (kind === 'profile-instructions') return 'generated by BroCrew for this profile at this launch'
  if (kind === 'repository-conventions') {
    return "this repository's shared agent conventions, read by BroCrew so both engines get them"
  }
  if (kind === 'workspace-instructions') return 'generated by BroCrew for this workspace'
  return kind === 'profile-memory'
    ? "this profile's private instructions for all projects"
    : 'project instructions, checked into the codebase'
}
