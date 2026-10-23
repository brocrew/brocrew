import { providerKnowledge } from '../providers/knowledge-definitions'
import { join } from 'node:path'
import { type Provider } from '@brobot2/shared'
import { SKILL_LIMITS } from '../../shared/skills-catalogue'
import {
  skillDigest,
  verifyBuiltInSkills,
  type BuiltInSkill,
  type VerifiedBuiltInSkills,
} from './built-in-catalogue'

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
  readonly discoveryRoot: 'claude-plugin' | 'codex/skills'
}

/** A launch view contains instructions only: no hooks, commands, servers or executable resources. */
export function builtInSkillView(
  provider: Provider,
  bundle: VerifiedBuiltInSkills,
  selected: readonly BuiltInSkill[],
): BuiltInSkillView {
  const verified = verifyBuiltInSkills(bundle.catalogue, bundle.bodies)
  if (verified.digest !== bundle.digest) throw new Error('Changed built-in skill catalogue.')
  const names = new Set(selected.map((item) => item.name))
  if (names.size !== selected.length) throw new Error('Duplicate selected skill.')
  const skills = verified.catalogue.skills.filter((item) => names.has(item.name))
  if (
    skills.length !== selected.length ||
    selected.some(
      (item) =>
        JSON.stringify(item) !== JSON.stringify(skills.find((one) => one.name === item.name)),
    )
  )
    throw new Error('A selected skill does not belong to this bundle.')
  const files = providerKnowledge[provider].skills.initialFiles()
  const discoveryRoot = providerKnowledge[provider].skills.discoveryRoot

  for (const item of skills) {
    files.set(
      providerKnowledge[provider].skills.fileFor(item.name),
      verified.bodies.get(item.name)!,
    )
  }
  const digest = skillDigest(
    JSON.stringify({ bundle: verified.digest, provider, names: skills.map((item) => item.name) }),
  )
  return { provider, digest, files, skills, discoveryRoot }
}

/** The implementation must reserve a new owned directory, never adopt an existing marker. */
export interface NewSkillViewStorage {
  reserve(digest: string): Promise<string>
  createDirectory(root: string, relativePath: string): Promise<void>
  createFile(root: string, relativePath: string, text: string): Promise<void>
  readFile(root: string, relativePath: string, maximumBytes: number): Promise<string>
  complete(root: string): Promise<void>
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
  const expectedRoot = providerKnowledge[view.provider].skills.discoveryRoot
  if (
    view.skills.length > SKILL_LIMITS.selected ||
    [...view.files.values()].reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8'), 0) >
      SKILL_LIMITS.selectedBytes
  )
    throw new Error('Too many installed skills.')
  const expected = new Set<string>()
  const names = new Set<string>()
  if (view.discoveryRoot !== expectedRoot) throw new Error('Unexpected skill discovery root.')
  for (const [file, manifest] of providerKnowledge[view.provider].skills.initialFiles()) {
    expected.add(file)
    if (view.files.get(file) !== manifest) throw new Error('Unexpected skill plugin manifest.')
  }
  for (const item of view.skills) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(item.name) || names.has(item.name)) {
      throw new Error('Unexpected installed skill name.')
    }
    names.add(item.name)
    const path = providerKnowledge[view.provider].skills.fileFor(item.name)
    expected.add(path)
    const text = view.files.get(path)
    if (
      text === undefined ||
      Buffer.byteLength(text, 'utf8') !== item.bytes ||
      skillDigest(text) !== item.sha256
    ) {
      throw new Error('Changed installed skill body.')
    }
  }
  if (
    view.files.size !== expected.size ||
    [...view.files.keys()].some((path) => !expected.has(path))
  ) {
    throw new Error('Unexpected installed skill files.')
  }
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
    const read = await storage.readFile(root, path, Buffer.byteLength(text, 'utf8'))
    if (read !== text) throw new Error('The installed skill does not match its body.')
    checkCurrent()
  }
  await storage.complete(root)
  checkCurrent()
  for (const [path, text] of view.files) {
    const final = await storage.readFile(root, path, Buffer.byteLength(text, 'utf8'))
    if (final !== text) throw new Error('The completed skill view changed before publication.')
    checkCurrent()
  }
  // Runtime adapters are given nothing until every exclusive write and read-back succeeded.
  return { root, discoveryPath: join(root, view.discoveryRoot) }
}
