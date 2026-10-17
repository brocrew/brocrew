export const BUILT_IN_SKILLS_FAILURE =
  'Built-in skills could not be prepared. Nothing was overwritten.'

export const BUILT_IN_SKILL_NAMES = [
  'delegate',
  'hand-back',
  'split-work',
  'ask-and-wait',
  'remember',
  'build-a-team',
  'add-a-capability',
  'build-software',
] as const

export type BuiltInSkillName = (typeof BUILT_IN_SKILL_NAMES)[number]

/** Current grants can remove a reminder; they cannot offer a skill absent from the launch view. */
export function permittedInstalledSkillReminders(
  installed: string,
  canCreateAgents: boolean,
  isCoordinator: boolean,
): string {
  return installed
    .split('\n')
    .filter((line) => {
      if (/^(?:brobot:)?build-a-team — /.test(line)) return canCreateAgents
      if (/^(?:brobot:)?add-a-capability — /.test(line)) return canCreateAgents || isCoordinator
      return true
    })
    .join('\n')
}
