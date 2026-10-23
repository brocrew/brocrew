import type { GivenSkills } from '../../shared/what-this-agent-was-given'
import type { ListedSkills } from './given-policy'
import type { ZodType } from 'zod'

export interface LegacySkillReminder {
  readonly field: string
  readonly schema: ZodType<string>
  canonical(name: string, text: string): string | null
}
export interface SkillPolicy {
  asGiven(listed: ListedSkills | null, builtIn: boolean): GivenSkills
  needsReminders(confirmed: () => boolean | undefined): boolean
  readonly builtInScope: string | null
  readonly discoveryRoot: string
  initialFiles(): Map<string, string>
  fileFor(name: string): string
  launchedEntry(
    root: string,
    skill: { readonly name: string; readonly description: string },
  ): {
    name: string
    description: string
    path: string
  }
  readonly legacyReminder: LegacySkillReminder
}
