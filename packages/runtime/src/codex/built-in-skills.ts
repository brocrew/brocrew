import type { BuiltInSkillsContext } from '../runtime'
import { cancelWith } from '../internal/bounded'
import {
  BUILT_IN_SKILLS_FAILURE,
  record,
  validateBuiltInSkills,
  isTheSamePath,
  mayBeWithin,
} from '../built-in-skills'

export function verifyCodexBuiltInSkills(
  response: unknown,
  context: BuiltInSkillsContext,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): void {
  validateBuiltInSkills(context, { prefix: '', directory: '' }, platform)
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
  validateBuiltInSkills(context, { prefix: '', directory: '' })
  await request('skills/extraRoots/set', {
    extraRoots: [context.root, ...(sharedRoot ? [sharedRoot] : [])],
  })
  const catalogue = await request('skills/list', { cwds: [cwd], forceReload: true })
  verifyCodexBuiltInSkills(catalogue, context, cwd)
}

/** The shared-library write may finish after Codex closes. Only a live launch needs its result. */
export async function prepareCodexSkills(
  prepare: (() => Promise<void>) | undefined,
  closed: AbortSignal | undefined,
): Promise<void> {
  if (!prepare || !closed) return prepare?.()
  let awaitingExit!: (reason: unknown) => void
  const ended = new Promise<never>((_, reject) => {
    awaitingExit = reject
  })
  const cancellation = cancelWith(closed, () => awaitingExit(closed.reason))
  const preparing = Promise.resolve().then(() => {
    closed.throwIfAborted()
    return prepare()
  })
  try {
    await Promise.race([ended, preparing])
  } finally {
    cancellation.release()
  }
}
