import { providerKnowledge } from '../providers/index'
import { join } from 'node:path'
import { type Provider } from '@brobot2/shared'
import { SKILL_LIMITS } from '../../shared/skills-catalogue'
import { skillDigest, type BuiltInSkill, type VerifiedBuiltInSkills } from './built-in-catalogue'

export interface BuiltInSkillView {
  readonly provider: Provider
  readonly digest: string
  readonly files: ReadonlyMap<string, string>
  readonly skills: readonly {
    readonly name: string
    readonly description: string
    readonly sha256: string
    readonly bytes: number
  }[]
  readonly discoveryRoot: string
}

/** A launch view contains instructions only: no hooks, commands, servers or executable resources. */
export function builtInSkillView(
  provider: Provider,
  bundle: VerifiedBuiltInSkills,
  selected: readonly BuiltInSkill[],
): BuiltInSkillView {
  const skills = selected
  const files = providerKnowledge[provider].skills.initialFiles()
  const discoveryRoot = providerKnowledge[provider].skills.discoveryRoot

  for (const item of skills) {
    files.set(providerKnowledge[provider].skills.fileFor(item.name), bundle.bodies.get(item.name)!)
  }
  const digest = skillDigest(
    JSON.stringify({ bundle: bundle.digest, provider, names: skills.map((item) => item.name) }),
  )
  return { provider, digest, files, skills, discoveryRoot }
}

/** The implementation must reserve a new owned directory, never adopt an existing marker. */
export interface NewSkillViewStorage {
  reserve(digest: string): Promise<string>
  createDirectory(root: string, relativePath: string): Promise<void>
  createFile(root: string, relativePath: string, text: string): Promise<void>
}

export async function installNewSkillView(
  storage: NewSkillViewStorage,
  view: BuiltInSkillView,
  isCurrent: () => boolean = () => true,
): Promise<{ root: string; discoveryPath: string }> {
  const checkCurrent = () => {
    if (!isCurrent()) throw new Error('The skill launch is no longer current.')
  }
  checkCurrent()
  if (
    view.skills.length > SKILL_LIMITS.selected ||
    [...view.files.values()].reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8'), 0) >
      SKILL_LIMITS.selectedBytes
  )
    throw new Error('Too many installed skills.')
  const root = await storage.reserve(view.digest)
  checkCurrent()
  const directories = new Set<string>()
  const ensure = async (path: string) => {
    const components = path.split('/')
    for (let i = 1; i <= components.length; i++) {
      const directory = components.slice(0, i).join('/')
      if (!directories.has(directory)) {
        await storage.createDirectory(root, directory)
        checkCurrent()
        directories.add(directory)
      }
    }
  }
  await ensure(view.discoveryRoot)
  for (const [path, text] of view.files) {
    const components = path.split('/')
    for (let i = 1; i < components.length; i++) {
      const directory = components.slice(0, i).join('/')
      if (!directories.has(directory)) {
        await storage.createDirectory(root, directory)
        checkCurrent()
        directories.add(directory)
      }
    }
    await storage.createFile(root, path, text)
    checkCurrent()
  }
  checkCurrent()
  return { root, discoveryPath: join(root, view.discoveryRoot) }
}
