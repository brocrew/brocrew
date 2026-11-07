import { providerKnowledge } from '../providers/knowledge-definitions'
import {
  constants,
  closeSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import type { BuiltInSkillsContext } from '@brobot2/runtime'
import { type Provider } from '@brobot2/shared'
import { BUILT_IN_SKILLS_FAILURE, BUILT_IN_SKILL_NAMES } from '../../shared/built-in-skills'
import {
  builtInSkillReminders,
  creationAllowedSkills,
  verifyBuiltInSkills,
  type VerifiedBuiltInSkills,
} from './built-in-catalogue'
import { selectedSkillView } from './selected-skill-view'
import { retainSkillView, sweepSkillViews } from './sweep-skill-views'
import type { SkillLaunchSelection } from './launch-selection'
import type { InstalledSkillVersion } from '../../shared/skills-installation'
import { builtInSkillView, installNewSkillView, type NewSkillViewStorage } from './skill-view'

export interface PreparedBuiltInSkills {
  readonly sharedRoot?: string
  readonly context: BuiltInSkillsContext
  readonly reminder: string
  readonly version: string
  readonly isCurrent: () => boolean
  readonly catalogueRevision?: number
  readonly versions?: readonly InstalledSkillVersion[]
}

function boundedFile(path: string, maximum: number): string {
  try {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK)
    try {
      if (!fstatSync(fd).isFile()) throw new Error('Not a regular skill file')
      const bytes = Buffer.alloc(maximum + 1)
      let length = 0
      while (length < bytes.length) {
        const got = readSync(fd, bytes, length, bytes.length - length, null)
        if (got === 0) break
        length += got
      }
      if (length > maximum) throw new Error(`Skill exceeds ${maximum} bytes`)
      return bytes.subarray(0, length).toString('utf8')
    } finally {
      closeSync(fd)
    }
  } catch (cause) {
    throw new Error(`${path}: ${String(cause)}`, { cause })
  }
}

export function readBuiltInSkills(directory: string): VerifiedBuiltInSkills {
  const manifestPath = join(directory, 'manifest.json')
  try {
    const manifest: unknown = JSON.parse(boundedFile(manifestPath, 65_536))
    const bodies = new Map<string, string>()
    for (const name of BUILT_IN_SKILL_NAMES)
      bodies.set(name, boundedFile(join(directory, name, 'SKILL.md'), 65_536))
    return verifyBuiltInSkills(manifest, bodies)
  } catch (cause) {
    throw new Error(`${manifestPath}: ${String(cause)}`, { cause })
  }
}

/** Keep a successful run's source; a failed read is retried after the source is repaired. */
export function keptShippedSkills(directory: string): () => VerifiedBuiltInSkills {
  let kept: VerifiedBuiltInSkills | undefined
  try {
    kept = readBuiltInSkills(directory)
  } catch {
    /* The next attempt names the current error. */
  }
  return () => (kept ??= readBuiltInSkills(directory))
}

function viewStorage(home: string): NewSkillViewStorage {
  return {
    async reserve(digest) {
      return mkdtempSync(join(home, `brobot-skills-${digest}-`))
    },
    async createDirectory(root, path) {
      mkdirSync(join(root, path), { mode: 0o700 })
    },
    async createFile(root, path, text) {
      writeFileSync(join(root, path), text, { flag: 'wx', mode: 0o600 })
    },
  }
}

export async function prepareBuiltInSkills(input: {
  provider: Provider
  providerHome: string
  managedRoot: string
  /** The shipped skills this run keeps ({@link keptShippedSkills}). */
  shipped: () => VerifiedBuiltInSkills
  /** The skills a text pack gives, already held to the shipped catalogue's rules. */
  skills?: VerifiedBuiltInSkills
  allShipped?: boolean
  canCreateAgents: boolean
  isCoordinator: boolean
  selection?: Pick<SkillLaunchSelection, 'revision' | 'skills'>
  isCurrent: () => boolean
  /** Settles only after the provider is confirmed stopped, including a slow close. */
  inUseUntil?: Promise<void>
}): Promise<PreparedBuiltInSkills> {
  try {
    const bundle = input.skills ?? input.shipped()
    const selected = input.allShipped
      ? bundle.catalogue.skills
      : creationAllowedSkills(bundle.catalogue, input.canCreateAgents, input.isCoordinator)
    if (
      input.selection?.skills.some(
        (skill) =>
          skill.requirement !== null &&
          !input.canCreateAgents &&
          !(skill.requirement === 'create-agents-or-coordinator' && input.isCoordinator),
      )
    )
      throw new Error('Skill grant is no longer available.')
    const expanded = input.selection
      ? selectedSkillView(
          input.provider,
          input.selection.skills,
          bundle,
          input.skills !== undefined,
        )
      : undefined
    const view = expanded ?? builtInSkillView(input.provider, bundle, selected)
    const installed = await installNewSkillView(
      viewStorage(resolve(input.providerHome)),
      view,
      input.isCurrent,
    )
    retainSkillView(installed.root, input.inUseUntil)
    void sweepSkillViews(input.managedRoot, resolve(input.providerHome), installed.root)
    return {
      context: {
        root: installed.discoveryPath,
        skills: view.skills.map((item) =>
          providerKnowledge[input.provider].skills.launchedEntry(installed.discoveryPath, item),
        ),
      },
      reminder: expanded?.reminder ?? builtInSkillReminders(input.provider, selected),
      ...(input.selection && expanded
        ? { catalogueRevision: input.selection.revision, versions: expanded.versions }
        : {}),
      version: bundle.catalogue.version,
      isCurrent: input.isCurrent,
    }
  } catch (error) {
    console.warn('Built-in skill preparation failed', error)
    throw new Error(`${BUILT_IN_SKILLS_FAILURE} ${input.providerHome}: ${String(error)}`, {
      cause: error,
    })
  }
}
