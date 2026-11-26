import type {
  InjectedInstruction,
  InjectedInstructionKind,
  RefusedInstruction,
} from '../../../shared/instruction-contracts'
import type { MemoryLoadedEvent } from '../../../shared/conversation-events'
import { given } from './given'
import { workspaceInstructionFile as INSTRUCTION_FILENAME } from './layout.mjs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { AUTO_MEMORY_INDEX } from '@brobot2/runtime/claude'
import { readClaudeAgentMemory, type ClaudeMemoryRead } from './memory'
import { agentPreamble } from '../../runtime/agent-preamble'
import type { InstructionInputs, SessionLaunchRead } from '../instruction-types'

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
import { INSTRUCTION_FILE_CAP, INSTRUCTION_TOTAL_CAP } from '../instruction-limits'
import {
  repositoryConventionChain as codexConventionChain,
  conventionFileIn,
} from '../repository-instructions'

function linkOf(path: string, real: string): string | undefined {
  const dir = dirname(path)
  const derived =
    basename(dir) === INSTRUCTION_DOTDIR
      ? join(realPath(dirname(dir)), INSTRUCTION_DOTDIR, basename(path))
      : join(realPath(dir), basename(path))
  return real === derived ? undefined : real
}

const INSTRUCTION_DOTDIR = '.claude'

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
  // `lookedAt` is carried from the read, not re-taken: the clock here would date the row at the end
  // of the walk (see {@link MemoryLoadedEvent.lookedAt}).
  return {
    type: 'memory_loaded',
    index: index.path,
    beside: read.topicsFound,
    lookedAt: read.lookedAt,
  }
}

function claudeMemoryNote(read: ClaudeMemoryRead): string {
  if (read.dir === null || read.topicsFound === 0) return ''
  const parts = [
    read.injects
      ? `${AUTO_MEMORY_INDEX} in ${read.dir} is an index the provider puts in front of the ` +
        'model; the memories it points at are separate files beside it, which the agent reads ' +
        'only if it chooses to.'
      : // Does not name a file in the prompt when this profile has none. Says "nothing in it" rather
        // than "has none": a blank index is skipped by the reader and the provider's own prompt
        // calls it empty, so claiming it does not exist would send someone looking for a file they
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
        "profile's identity comes from its own folder rather than from your personal one " +
        '(a file on the way that links into it is followed, as the CLI does, and its row says so)'
  // `once` is non-empty only when a second copy was dropped and the kept one reached the model.
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
    // Appended as its own sentence: it is about a store BroBot neither reads for the prompt nor
    // wrote, and joining it to the files it does send would blur two provenances.
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
    // Stamped per file, just before the read (see {@link InjectedInstruction.readAt}): the walk does
    // real I/O between files, so one launch stamp would mis-date some of them.
    const readAt = Date.now()
    // The generated bundle holds two bounded pages plus shipped text. Other files retain their
    // original per-file cap; this allowance still fits inside the existing total budget.
    const cap =
      kind === 'profile-instructions' && inputs.bundleComposed !== undefined
        ? Math.max(
            INSTRUCTION_FILE_CAP,
            Math.min(INSTRUCTION_TOTAL_CAP, Buffer.byteLength(inputs.bundleComposed.text, 'utf8')),
          )
        : INSTRUCTION_FILE_CAP
    const read = readInstructionFile(path, cap)
    if (!read.ok) {
      // Links are followed, so a link whose far end is gone reads as `absent`, as the provider's own
      // `stat` does; it is still disclosed as a row rather than made silent.
      const said = read.reason === 'absent' ? brokenMemoryLink(path) : { path, reason: read.reason }
      if (said !== null) refused.push(said)
      return
    }
    const real = read.real ?? realPath(path)
    // A link that lands in the person's own home is followed too, as the CLI does: it is sent once,
    // as the project's file, and the row says where it led ({@link linkOf}).
    // An empty file is not an item: a heading over no text would claim something was sent.
    if (read.text.trim() === '') return
    // One file is sent once. The first name in walk order keeps it; a second name for it becomes a
    // row saying why it was not sent.
    if (taken.has(real)) {
      refused.push({ path, reason: 'same-file', link: real })
      return
    }
    taken.add(real)
    // A followed link says so (see {@link linkOf}): BroBot follows what the provider follows and
    // discloses it.
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
    // A `.claude` that is a link is followed, as the CLI does. `stat`, so a link to a directory is a
    // directory and a link to nothing is absent.
    const dot = join(dir, INSTRUCTION_DOTDIR)
    const dotUsable = safeStat(dot)?.isDirectory() === true
    const plain = join(dir, INSTRUCTION_FILENAME)
    take(plain, kindFor(plain, inputs.workspaceFile))
    const nested = join(dot, INSTRUCTION_FILENAME)
    if (dotUsable) take(nested, kindFor(nested, inputs.workspaceFile))
    else {
      // A `.claude` that links to nothing is disclosed too, named as the directory (what
      // `brokenMemoryLink` answers when the leaf has no path to stat).
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
    // The launch fact comes from the same read the panel is built from; see {@link claudeMemoryLoaded}.
    memoryLoaded: claudeMemoryLoaded(agent),
    instructions: {
      injected,
      agentMemory: agent.memory,
      provider: [],
      refused,
      // Drawn only on a send: `sentOnce` is decided before {@link allocate}, and a kept file the
      // budget then refuses would otherwise claim the body was appended once over a prompt that got
      // it zero times. So it asks the list that actually reached the model.
      note: noteFor(
        chain,
        home,
        claudeMemoryNote(agent),
        sentOnce !== null && injected.includes(sentOnce.kept) ? sentOnce.dropped : null,
      ),
      // False because the CLI preloads the memory index into its system prompt, with no memory tool
      // and no citation, so a recall row would have to be invented.
      recallsReported: false,
      // True because the CLI writes a memory with an ordinary `Write`/`Edit` naming a file in the
      // store, whose location is on its own wire (`system/init.memory_paths.auto`); the row says so via
      // `tool_call.memoryPath`. The sentence this flag draws is about the write only: there is no
      // single reading to point at, since the index is in the prompt from the start.
      writesReported: true,
      // What actually went to the model, as one string. Built after {@link allocate} from the same
      // `injected` array as the caller's hint, so the preamble, headers and budget truncation are in
      // it. The composition root hands this value to the adapter (`main/index.ts`).
      ...(inputs.thisConversation === undefined
        ? {}
        : { thisConversation: inputs.thisConversation }),
      composed,
    },
    // The system prompt at every launch; see {@link SessionLaunchRead.systemHint}.
    systemHint: composed,
    firstTurnLead: null,
    profileFile: theProfileFileOf(inputs, refused),
  }
}

export const instructions = {
  read: readSessionInstructions,
  given,
  bundleLeaf: 'brobot-instructions.md',
  workspaceFile: (root: string) => join(root, INSTRUCTION_FILENAME),
}
