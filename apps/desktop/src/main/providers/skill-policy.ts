import type { ZodType } from 'zod'

export interface LegacySkillReminder {
  readonly field: string
  readonly schema: ZodType<string>
  canonical(name: string, text: string): string | null
}
export interface SkillPolicy {
  readonly discoveryRoot: 'claude-plugin' | 'codex/skills'
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
