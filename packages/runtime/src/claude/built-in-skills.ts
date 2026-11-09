import type { BuiltInSkillsContext } from '../runtime'
import {
  BUILT_IN_SKILLS_FAILURE,
  record,
  validateBuiltInSkills,
  isTheSamePath,
  mayBeTheSamePath,
} from '../built-in-skills'

export function claudeBuiltInSkillOptions(context: BuiltInSkillsContext, sharedRoot?: string) {
  validateBuiltInSkills(context, { prefix: 'brobot:', directory: 'skills' })
  return {
    plugins: [
      { type: 'local' as const, path: context.root },
      ...(sharedRoot ? [{ type: 'local' as const, path: sharedRoot }] : []),
    ],
  }
}

export function verifyClaudeBuiltInSkills(
  message: unknown,
  context: BuiltInSkillsContext,
  platform: NodeJS.Platform = process.platform,
): void {
  validateBuiltInSkills(context, { prefix: 'brobot:', directory: 'skills' }, platform)
  const init = record(message)
  const plugins = Array.isArray(init?.plugins) ? init.plugins : []
  const owned = plugins.filter((item) => record(item)?.name === 'brobot')
  const skills = Array.isArray(init?.skills) ? init.skills : []
  const expected = new Set(context.skills.map((skill) => skill.name))
  const errors = init?.plugin_errors === undefined ? [] : init.plugin_errors
  if (
    owned.length !== 1 ||
    !isTheSamePath(record(owned[0])?.path, context.root, platform) ||
    context.skills.some((skill) => skills.filter((name) => name === skill.name).length !== 1) ||
    skills.some(
      (name) => typeof name === 'string' && name.startsWith('brobot:') && !expected.has(name),
    ) ||
    !Array.isArray(errors) ||
    errors.some((error) => {
      const one = record(error)
      return (
        mayBeTheSamePath(one?.path, context.root, platform) ||
        one?.plugin === 'brobot' ||
        one?.plugin === 'inline[0]' ||
        (typeof one?.plugin === 'string' && one.plugin.startsWith('brobot@'))
      )
    })
  ) {
    throw new Error(BUILT_IN_SKILLS_FAILURE)
  }
}
