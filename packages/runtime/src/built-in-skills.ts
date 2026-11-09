import { posix, win32 } from 'node:path'
import type { BuiltInSkillsContext } from './runtime'

export const BUILT_IN_SKILLS_FAILURE =
  'Built-in skills could not be prepared. Nothing was overwritten.'

export function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** The path rules of the system a check reads paths for. */
const rulesOf = (platform: NodeJS.Platform) => (platform === 'win32' ? win32 : posix)

/** A Windows path that names its drive and root, or a UNC share: one that resolves to itself
 * alone. A drive-less `\Users\…` counts as absolute on Windows yet takes the current drive. */
const FULLY_QUALIFIED_ON_WINDOWS = /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/

const isQualified = (one: string, platform: NodeJS.Platform) =>
  platform === 'win32' ? FULLY_QUALIFIED_ON_WINDOWS.test(one) : posix.isAbsolute(one)

export function validateBuiltInSkills(
  context: BuiltInSkillsContext,
  layout: { readonly prefix: string; readonly directory: string },
  platform: NodeJS.Platform = process.platform,
): void {
  const path = rulesOf(platform)
  if (!isQualified(context.root, platform) || context.skills.length > 64) {
    throw new Error(BUILT_IN_SKILLS_FAILURE)
  }
  const names = new Set<string>()
  for (const skill of context.skills) {
    const bare = skill.name.startsWith(layout.prefix)
      ? skill.name.slice(layout.prefix.length)
      : skill.name
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(bare) ||
      names.has(skill.name) ||
      skill.name !== `${layout.prefix}${bare}` ||
      skill.path !==
        path.join(
          context.root,
          layout.directory,
          bare,
          'SKILL.md',
        ) ||
      !skill.description ||
      skill.description.length > 500
    ) {
      throw new Error(BUILT_IN_SKILLS_FAILURE)
    }
    names.add(skill.name)
  }
}

/**
 * Whether a path a provider reports is the one expected. Providers report paths resolved, in the
 * system's own form, and Windows may give them other separators or another case.
 */
export function isTheSamePath(
  reported: unknown,
  expected: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const path = rulesOf(platform)
  if (
    typeof reported !== 'string' ||
    !isQualified(reported, platform) ||
    !isQualified(expected, platform)
  ) {
    return false
  }
  const [one, other] = [path.resolve(reported), path.resolve(expected)]
  return platform === 'win32' ? one.toLowerCase() === other.toLowerCase() : one === other
}

/** On Windows, a path that names no drive, or a drive without its root, read on another's root. */
const readOnTheRootOf = (reported: string, other: string) =>
  win32.resolve(win32.parse(other).root, reported)

/**
 * Whether a diagnostic's path may be the one expected, read to fail closed: on Windows a path that
 * names no drive, or a drive without its root, is read on the expected path's own root.
 */
export function mayBeTheSamePath(
  reported: unknown,
  expected: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== 'win32' || typeof reported !== 'string') {
    return isTheSamePath(reported, expected, platform)
  }
  return isTheSamePath(readOnTheRootOf(reported, expected), expected, platform)
}

/** Whether a path a provider reports may lie in a folder, or be it, read to fail closed as above. */
export function mayBeWithin(reported: string, folder: string, platform: NodeJS.Platform): boolean {
  const path = rulesOf(platform)
  const within = path.relative(
    folder,
    platform === 'win32' ? readOnTheRootOf(reported, folder) : reported,
  )
  return (
    within === '' ||
    (within !== '..' && !within.startsWith(`..${path.sep}`) && !path.isAbsolute(within))
  )
}
