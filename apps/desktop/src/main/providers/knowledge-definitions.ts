import type { KeptRulePolicy } from './kept-rule-policy'
import { keptRules as claudeKeptRules } from './claude/kept-rules'
import { keptRules as codexKeptRules } from './codex/kept-rules'
import type { Provider } from '@brobot2/shared'
import type { InstructionPolicy } from './knowledge-policy'
import type { MemoryPolicy } from './memory-policy'
import type { SnapshotPolicy } from './snapshot-policy'
import { snapshot as claudeSnapshot } from './claude/snapshot'
import { snapshot as codexSnapshot } from './codex/snapshot'
import type { SkillPolicy } from './skill-policy'
import { skills as claudeSkills } from './claude/skills'
import { skills as codexSkills } from './codex/skills'
import { instructions as claudeInstructions } from './claude/instructions'
import { instructions as codexInstructions } from './codex/instructions'
import { memory as claudeMemory } from './claude/memory'
import { memory as codexMemory } from './codex/memory'

export interface ProviderKnowledge {
  readonly instructions: InstructionPolicy
  readonly memory: MemoryPolicy
  readonly snapshot: SnapshotPolicy
  readonly keptRules: KeptRulePolicy
  readonly skills: SkillPolicy
}
/** Instruction and memory readers are separate from the transcript-only definition closure. */
export const providerKnowledge: Readonly<Record<Provider, ProviderKnowledge>> = {
  claude: {
    instructions: claudeInstructions,
    memory: claudeMemory,
    snapshot: claudeSnapshot,
    skills: claudeSkills,
    keptRules: claudeKeptRules,
  },
  codex: {
    instructions: codexInstructions,
    memory: codexMemory,
    snapshot: codexSnapshot,
    skills: codexSkills,
    keptRules: codexKeptRules,
  },
}
/** The two reminder fields and their order belong to the fixed legacy catalogue format. */
export const legacySkillReminderFormats = [
  codexSkills.legacyReminder,
  claudeSkills.legacyReminder,
] as const
export { legacySharedSkillProvider } from './codex/skills'
export {
  INSTRUCTION_FILENAME,
  INSTRUCTION_DOTDIR,
  projectInstructionChain,
} from './claude/instructions'
export { readClaudeAgentMemory } from './claude/memory'
export { readCodexAgentMemory, adHocNotes } from './codex/memory'
