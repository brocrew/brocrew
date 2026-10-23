import type { Provider } from '@brobot2/shared'
import type { InstructionPolicy } from './knowledge-policy'
import type { MemoryPolicy } from './memory-policy'
import type { SnapshotPolicy } from './snapshot-policy'
import { snapshot as claudeSnapshot } from './claude/snapshot'
import { snapshot as codexSnapshot } from './codex/snapshot'
import { instructions as claudeInstructions } from './claude/instructions'
import { instructions as codexInstructions } from './codex/instructions'
import { memory as claudeMemory } from './claude/memory'
import { memory as codexMemory } from './codex/memory'

export interface ProviderKnowledge {
  readonly instructions: InstructionPolicy
  readonly memory: MemoryPolicy
  readonly snapshot: SnapshotPolicy
}
/** Instruction and memory readers are separate from the transcript-only definition closure. */
export const providerKnowledge: Readonly<Record<Provider, ProviderKnowledge>> = {
  claude: { instructions: claudeInstructions, memory: claudeMemory, snapshot: claudeSnapshot },
  codex: { instructions: codexInstructions, memory: codexMemory, snapshot: codexSnapshot },
}
export {
  INSTRUCTION_FILENAME,
  INSTRUCTION_DOTDIR,
  projectInstructionChain,
} from './claude/instructions'
export { readClaudeAgentMemory } from './claude/memory'
export { readCodexAgentMemory, adHocNotes } from './codex/memory'
