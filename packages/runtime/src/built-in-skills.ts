import { posix, win32 } from 'node:path'
import type { BuiltInSkillsContext } from './runtime'

export const BUILT_IN_SKILLS_FAILURE =
  'Built-in skills could not be prepared. Nothing was overwritten.'

function record(value: unknown): Record<string, unknown> | null {
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
  provider: 'claude' | 'codex',
  platform: NodeJS.Platform = process.platform,
): void {
  const path = rulesOf(platform)
  if (!isQualified(context.root, platform) || context.skills.length > 64) {
    throw new Error(BUILT_IN_SKILLS_FAILURE)
  }
  const names = new Set<string>()
  for (const skill of context.skills) {
    const bare = provider === 'claude' ? skill.name.replace(/^brobot:/, '') : skill.name
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(bare) ||
      names.has(skill.name) ||
      (provider === 'claude' && skill.name !== `brobot:${bare}`) ||
      skill.path !==
        path.join(context.root, provider === 'claude' ? 'skills' : '', bare, 'SKILL.md') ||
      !skill.description ||
      skill.description.length > 500
    ) {
      throw new Error(BUILT_IN_SKILLS_FAILURE)
    }
    names.add(skill.name)
  }
}

export function claudeBuiltInSkillOptions(context: BuiltInSkillsContext, sharedRoot?: string) {
  validateBuiltInSkills(context, 'claude')
  return {
    plugins: [
      { type: 'local' as const, path: context.root },
      ...(sharedRoot ? [{ type: 'local' as const, path: sharedRoot }] : []),
    ],
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
function mayBeWithin(reported: string, folder: string, platform: NodeJS.Platform): boolean {
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

export function verifyClaudeBuiltInSkills(
  message: unknown,
  context: BuiltInSkillsContext,
  platform: NodeJS.Platform = process.platform,
): void {
  validateBuiltInSkills(context, 'claude', platform)
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

export function verifyCodexBuiltInSkills(
  response: unknown,
  context: BuiltInSkillsContext,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): void {
  validateBuiltInSkills(context, 'codex', platform)
  const data = record(response)?.data
  if (!Array.isArray(data)) throw new Error(BUILT_IN_SKILLS_FAILURE)
  const entries = data.filter((entry) => isTheSamePath(record(entry)?.cwd, cwd, platform))
  if (entries.length !== 1) throw new Error(BUILT_IN_SKILLS_FAILURE)
  const entry = record(entries[0])!
  if (!Array.isArray(entry.skills) || !Array.isArray(entry.errors)) {
    throw new Error(BUILT_IN_SKILLS_FAILURE)
  }
  const isOwnedPath = (path: string) => mayBeWithin(path, context.root, platform)
  if (
    entry.errors.some((error) => {
      const one = record(error)
      return typeof one?.path !== 'string' || isOwnedPath(one.path)
    })
  )
    throw new Error(BUILT_IN_SKILLS_FAILURE)
  const expected = new Set(context.skills.map((skill) => skill.name))
  for (const item of entry.skills) {
    const one = record(item)
    if (typeof one?.path !== 'string') continue
    const owned = isOwnedPath(one.path)
    if (owned && (typeof one.name !== 'string' || !expected.has(one.name))) {
      throw new Error(BUILT_IN_SKILLS_FAILURE)
    }
  }
  for (const wanted of context.skills) {
    const matches = entry.skills.filter((item) => record(item)?.name === wanted.name)
    const got = record(matches[0])
    if (
      matches.length !== 1 ||
      !isTheSamePath(got?.path, wanted.path, platform) ||
      got?.description !== wanted.description ||
      got.enabled !== true
    ) {
      throw new Error(BUILT_IN_SKILLS_FAILURE)
    }
  }
}

export async function registerCodexBuiltInSkills(
  context: BuiltInSkillsContext,
  cwd: string,
  request: (method: 'skills/extraRoots/set' | 'skills/list', params: object) => Promise<unknown>,
  sharedRoot?: string,
): Promise<void> {
  validateBuiltInSkills(context, 'codex')
  await request('skills/extraRoots/set', {
    extraRoots: [context.root, ...(sharedRoot ? [sharedRoot] : [])],
  })
  const catalogue = await request('skills/list', { cwds: [cwd], forceReload: true })
  verifyCodexBuiltInSkills(catalogue, context, cwd)
}
