import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { AUTO_MEMORY_INDEX } from '@brobot2/runtime'
import { readClaudeAgentMemory, type ClaudeMemoryRead } from './memory'
import { agentPreamble } from '../../runtime/agent-preamble'
import type { InstructionInputs, SessionLaunchRead } from '../instruction-types'

import type {
  InjectedInstruction,
  InjectedInstructionKind,
  RefusedInstruction,
  MemoryLoadedEvent,
} from '../../../shared/runtime-ipc'
import {
  allocate,
  theProfileFileOf,
  composeSystemHint,
  conversationBlockCost,
  sendOurWorkspaceBodyOnce,
  sectionsOf,
} from '../instruction-composition'
import {
  readInstructionFile,
  realPath,
  safeStat,
  brokenMemoryLink,
  isHomeOrAbove,
} from '../instruction-io'
import { INSTRUCTION_FILE_CAP } from '../instruction-limits'
import {
  repositoryConventionChain as codexConventionChain,
  conventionFileIn,
} from '../repository-instructions'

export function linkOf(path: string, real: string): string | undefined {
  const dir = dirname(path)
  const derived =
    basename(dir) === INSTRUCTION_DOTDIR
      ? join(realPath(dirname(dir)), INSTRUCTION_DOTDIR, basename(path))
      : join(realPath(dir), basename(path))
  return real === derived ? undefined : real
}

export const INSTRUCTION_FILENAME = 'CLAUDE.md'

export const INSTRUCTION_DOTDIR = '.claude'

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

export function kindFor(path: string, workspaceFile: string | undefined): InjectedInstructionKind {
  return workspaceFile !== undefined && realPath(path) === realPath(workspaceFile)
    ? 'workspace-instructions'
    : 'project-memory'
}

export function claudeMemoryLoaded(read: ClaudeMemoryRead): MemoryLoadedEvent | null {
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

export function claudeMemoryNote(read: ClaudeMemoryRead): string {
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

export function noteFor(
  chain: string[],
  home: string,
  memory: string,
  dropped: string | null,
): string {
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

export function readSessionInstructions(inputs: InstructionInputs): SessionLaunchRead {
  const injected: InjectedInstruction[] = []
  const refused: RefusedInstruction[] = []
  if (inputs.bundle?.ok === false)
    refused.push({ path: inputs.bundle.path, reason: inputs.bundle.reason })
  const home = inputs.home ?? homedir()
  const seen = new Set<string>()
  const taken = new Set<string>()
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
  const agent = readClaudeAgentMemory(inputs.providerHome)
  refused.push(...agent.refused)
  if (inputs.bundle?.ok === true) take(inputs.bundle.path, 'profile-instructions')
  take(join(inputs.providerHome, INSTRUCTION_FILENAME), 'profile-memory')
  const conventionDirs = codexConventionChain(inputs.cwd, home)
  const conventions = new Map<string, string>()
  for (const dir of conventionDirs) {
    const file = conventionFileIn(dir)
    if (file !== null) conventions.set(dir, file)
  }
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

export const instructions = { read: readSessionInstructions, bundleLeaf: 'brobot-instructions.md' }
