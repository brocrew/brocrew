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
