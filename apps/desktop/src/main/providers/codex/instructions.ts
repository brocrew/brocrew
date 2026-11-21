import type { InjectedInstruction, RefusedInstruction } from '../../../shared/instruction-contracts'
import { given } from './given'
import { CODEX_MEMORY_SUMMARY } from '@brobot2/runtime/codex'
import { readCodexAgentMemory, type CodexMemoryRead } from './memory'
import { agentPreamble } from '../../runtime/agent-preamble'
import type { BundlePublish, InstructionInputs, SessionLaunchRead } from '../instruction-types'

import { theProfileFileOf, composeSystemHint, BLOCK_SEPARATOR } from '../instruction-composition'

export const NOTE_PROVIDER_READS_ITS_OWN =
  'BroCrew appends nothing for this provider — it reads its own instruction files, and the list ' +
  'below is the one it reported.'

export const NOTE_SENDS_THIS_CONVERSATIONS_TEXT =
  'BroCrew sends this provider how to use its tools and what is true of this conversation in ' +
  'front of a message: the whole of it the first time, and again after the conversation is ' +
  'compacted; otherwise only what changed — it reads its own instruction files, and the list ' +
  'below is the one it reported.'

export function codexMemoryNote(
  read: CodexMemoryRead,
  bundle: BundlePublish | undefined,
  /** Whether this conversation's own text was composed and sent. */
  sendsThisConversation: boolean,
): string {
  // Names the leaf this app published for the provider to read, which
  // {@link NOTE_PROVIDER_READS_ITS_OWN} would otherwise leave a person to infer. It says
  // "published", never "appended": {@link SessionInstructions.injected} is text this app sent, and
  // on this provider it stays empty because the provider discovers the file natively.
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

export function readSessionInstructions(inputs: InstructionInputs): SessionLaunchRead {
  const injected: InjectedInstruction[] = []
  const refused: RefusedInstruction[] = []
  if (inputs.bundle?.ok === false)
    refused.push({ path: inputs.bundle.path, reason: inputs.bundle.reason })
  const codex = readCodexAgentMemory(inputs.providerHome)
  const codexConversation = composeSystemHint(injected, inputs.thisConversation) ?? null
  const codexComposed =
    inputs.bundle?.ok === false && inputs.identity !== undefined
      ? [agentPreamble(inputs.identity), codexConversation]
          .filter((text) => text !== null)
          .join(BLOCK_SEPARATOR)
      : codexConversation
  return {
    // No launch row on this provider: Codex injects `memory_summary.md` into every request, but that
    // file is a machine-written summary from a background extractor, not an index the agent
    // maintains, so the sentence would differ and one field must not span both truths.
    memoryLoaded: null,
    instructions: {
      injected,
      agentMemory: codex.memory,
      provider: [],
      refused: [...refused, ...codex.refused],
      // Names the leaf this app published for the provider to read, and what is sent: this
      // conversation's own text, when one was composed.
      note: codexMemoryNote(codex, inputs.bundle, inputs.thisConversation !== undefined),
      // True because the model appends its own citation block, the app-server parses it into
      // `agentMessage.memoryCitation` and strips it from `text`, and `codex/normalize.ts` turns it
      // into a `memory_recall` row. The panel reads this flag rather than asking which provider.
      recallsReported: true,
      // False because the memory tools live inside the code-mode `exec` surface and the app-server
      // publishes no `item/*` for a nested call, so nothing on this wire reports a write. A
      // `memory_note` row is not this flag: it is a directory listing this app took around a turn,
      // our observation rather than the provider's report (see `MemoryNoteEntry`).
      writesReported: false,
      // Composed here, in one call, so the string a person reads and the one the adapter is handed
      // are the same value. `injected` is empty because this provider reads its own instruction
      // files; what is sent is this conversation's own text alone, under its header, or `null`.
      ...(inputs.thisConversation === undefined
        ? {}
        : { thisConversation: inputs.thisConversation }),
      composed: codexComposed,
    },
    // Goes in front of the first message of every life, never as a system hint; see
    // {@link SessionLaunchRead.firstTurnLead}.
    systemHint: null,
    firstTurnLead: codexComposed,
    profileFile: theProfileFileOf(inputs, refused),
  }
}

export const instructions = {
  read: readSessionInstructions,
  given,
  bundleLeaf: 'AGENTS.override.md',
}
