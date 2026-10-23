import { CODEX_MEMORY_SUMMARY } from '@brobot2/runtime'
import { readCodexAgentMemory, type CodexMemoryRead } from './memory'
import { agentPreamble } from '../../runtime/agent-preamble'
import type { InstructionInputs, SessionLaunchRead } from '../instruction-types'
import type { BundlePublish } from '../../runtime/profile-bundle'
import type { InjectedInstruction, RefusedInstruction } from '../../../shared/runtime-ipc'
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

export const instructions = { read: readSessionInstructions, bundleLeaf: 'AGENTS.override.md' }
