import { SUPPORTED_PROVIDERS, type Provider } from '@brobot2/shared'
import { providerKnowledge } from '../providers/knowledge-definitions'
import type {
  InstructionInputs,
  SessionLaunchRead,
  MemoryStoreLayout,
} from '../providers/instruction-types'
export * from '../providers/instruction-types'
export * from '../providers/instruction-limits'
export { THIS_CONVERSATION_HEADER } from './instruction-headings'
export { readInstructionFile, realPath } from '../providers/instruction-io'
export {
  composeSystemHint,
  conversationBlock,
  headingAsSent,
} from '../providers/instruction-composition'
export {
  repositoryConventionChain as codexConventionChain,
  AGENTS_OVERRIDE_FILENAME,
  AGENTS_FILENAME,
} from '../providers/repository-instructions'
export {
  INSTRUCTION_FILENAME,
  INSTRUCTION_DOTDIR,
  projectInstructionChain,
  readClaudeAgentMemory,
  readCodexAgentMemory,
  adHocNotes,
} from '../providers/knowledge-definitions'

/**
 * Called on every start AND every resume, deliberately: a launch reads the live profile again.
 * A file changed during a conversation takes effect at the next launch.
 */
export function readSessionInstructions(inputs: InstructionInputs): SessionLaunchRead {
  return providerKnowledge[inputs.provider].instructions.read(inputs)
}
export function memoryStoreCounts(provider: Provider, providerHome: string) {
  return providerKnowledge[provider].memory.counts(providerHome)
}
export function readAgentMemoryPage(
  provider: Provider,
  providerHome: string,
  offset: number,
  limit: number,
) {
  return providerKnowledge[provider].memory.readPage(providerHome, offset, limit)
}
export const MEMORY_STORE_LAYOUT = Object.fromEntries(
  SUPPORTED_PROVIDERS.map((provider) => [provider, providerKnowledge[provider].memory.layout]),
) as Readonly<Record<Provider, MemoryStoreLayout>>
export function readAgentMemorySelection(provider: Provider, providerHome: string, entry: string) {
  return providerKnowledge[provider].memory.select(providerHome, entry)
}
