import { providerKnowledge } from '../providers/knowledge-definitions'
import {
  constants,
  closeSync,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  read,
  readSync,
  write,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { trustProviderHomeAncestry, withProviderHomeLock } from '@brobot2/runtime/provider-home'
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

export { BUILT_IN_SKILLS_FAILURE } from '../../shared/built-in-skills'

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
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > maximum) throw new Error('Unexpected skill resource.')
    const bytes = Buffer.alloc(maximum + 1)
    const got = readSync(fd, bytes, 0, bytes.length, 0)
    if (got > maximum || got !== stat.size) throw new Error('Changed skill resource.')
    return bytes.subarray(0, got).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

export function readBuiltInSkills(directory: string): VerifiedBuiltInSkills {
  const manifest: unknown = JSON.parse(boundedFile(join(directory, 'manifest.json'), 65_536))
  const bodies = new Map<string, string>()
  for (const name of BUILT_IN_SKILL_NAMES) {
    bodies.set(name, boundedFile(join(directory, name, 'SKILL.md'), 65_536))
  }
  return verifyBuiltInSkills(manifest, bodies)
}

/**
 * The shipped skills, read once, now, and kept for the rest of the run. A build run from its source
 * reads them from a folder a newer commit can rewrite while it runs; with this copy, what it offers
 * is what it was started with, and a rewrite reaches the app at its next start, with the code it
 * belongs to. A read that fails is kept as that failure: the files are not read again this run.
 */
export function keptShippedSkills(directory: string): () => VerifiedBuiltInSkills {
  let kept: { readonly skills: VerifiedBuiltInSkills } | { readonly failure: unknown }
  try {
    kept = { skills: readBuiltInSkills(directory) }
  } catch (failure) {
    kept = { failure }
  }
  return () => {
    if ('failure' in kept) throw kept.failure
    return kept.skills
  }
}

/** Fresh objects only. Ancestor pins use the existing managed-home containment checks. */
function ownedViewStorage(managedRoot: string, home: string, current: () => boolean) {
  const pins: ReturnType<typeof trustProviderHomeAncestry>[] = []
  const files = new Map<string, { fd: number; dev: number; ino: number }>()
  let root: string | null = null
  const verify = () => {
    if (!current()) throw new Error('Skill launch cancelled or replaced.')
    for (const pin of pins) pin.verify()
    for (const [path, item] of files) {
      const stat = lstatSync(path),
        held = fstatSync(item.fd)
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.dev !== item.dev ||
        stat.ino !== item.ino ||
        held.dev !== item.dev ||
        held.ino !== item.ino
      ) {
        throw new Error('An owned skill file was substituted.')
      }
    }
  }
  const at = (viewRoot: string, relativePath: string) => {
    if (
      viewRoot !== root ||
      relativePath.split('/').some((part) => part === '..' || part === '.' || part === '')
    )
      throw new Error('Unexpected skill path.')
    return join(viewRoot, relativePath)
  }
  const storage: NewSkillViewStorage = {
    async reserve(digest) {
      verify()
      root = mkdtempSync(join(home, `brobot-skills-${digest}-`))
      verify()
      pins.push(trustProviderHomeAncestry(managedRoot, root, { includeLeaf: true }))
      verify()
      return root
    },
    async createDirectory(viewRoot, path) {
      verify()
      const destination = at(viewRoot, path)
      mkdirSync(destination, { mode: 0o700 })
      verify()
      pins.push(trustProviderHomeAncestry(managedRoot, destination, { includeLeaf: true }))
      verify()
    },
    async createFile(viewRoot, path, text) {
      verify()
      const destination = at(viewRoot, path)
      const fd = openSync(
        destination,
        constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
        0o600,
      )
      try {
        const stat = fstatSync(fd)
        files.set(destination, { fd, dev: stat.dev, ino: stat.ino })
      } catch (error) {
        closeSync(fd)
        throw error
      }
      verify()
      const bytes = Buffer.from(text, 'utf8')
      await new Promise<void>((done, fail) =>
        write(fd, bytes, 0, bytes.length, 0, (error, written) => {
          if (error) fail(error)
          else if (written !== bytes.length) fail(new Error('Incomplete skill write.'))
          else done()
        }),
      )
      verify()
    },
    async readFile(viewRoot, path, maximum) {
      verify()
      const item = files.get(at(viewRoot, path))
      if (!item) throw new Error('Skill file was not created by this launch.')
      const bytes = Buffer.alloc(maximum + 1)
      const length = await new Promise<number>((done, fail) =>
        read(item.fd, bytes, 0, bytes.length, 0, (error, count) =>
          error ? fail(error) : done(count),
        ),
      )
      verify()
      if (length > maximum || fstatSync(item.fd).size !== length)
        throw new Error('Changed installed skill file.')
      return bytes.subarray(0, length).toString('utf8')
    },
    async complete() {
      verify()
      for (const item of files.values()) fchmodSync(item.fd, 0o400)
      verify()
    },
  }
  return {
    storage,
    verify,
    release() {
      for (const item of files.values()) {
        try {
          closeSync(item.fd)
        } catch {
          /* Still release all other owned descriptors. */
        }
      }
      for (const pin of pins) pin.release()
      // A later launch sweeps incomplete views and copies whose providers have stopped.
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
    const ancestry = trustProviderHomeAncestry(input.managedRoot, input.providerHome, {
      includeLeaf: true,
    })
    const owned = ownedViewStorage(input.managedRoot, resolve(input.providerHome), () => {
      ancestry.verify()
      return input.isCurrent()
    })
    try {
      const installedView = await withProviderHomeLock(
        input.providerHome,
        async () => {
          const installed = await installNewSkillView(owned.storage, view, input.isCurrent)
          if (!input.isCurrent()) throw new Error('Skill launch is no longer current.')
          ancestry.verify()
          retainSkillView(installed.root, input.inUseUntil)
          return {
            root: installed.root,
            prepared: {
              context: {
                root: installed.discoveryPath,
                skills: view.skills.map((item) =>
                  providerKnowledge[input.provider].skills.launchedEntry(
                    installed.discoveryPath,
                    item,
                  ),
                ),
              },
              reminder: expanded?.reminder ?? builtInSkillReminders(input.provider, selected),
              ...(input.selection && expanded
                ? { catalogueRevision: input.selection.revision, versions: expanded.versions }
                : {}),
              version: bundle.catalogue.version,
              isCurrent: input.isCurrent,
            },
          }
        },
        {
          verify: () => {
            ancestry.verify()
            if (!input.isCurrent()) throw new Error('Stale skill launch.')
          },
        },
      )
      owned.verify()
      if (!input.isCurrent()) throw new Error('Skill launch is no longer current.')
      // Publish this launch first. Cleanup owns its pins and contains its failures; neither the
      // backlog nor another launch's sweep belongs on the provider's start path.
      void sweepSkillViews(input.managedRoot, resolve(input.providerHome), installedView.root)
      return installedView.prepared
    } finally {
      owned.release()
      ancestry.release()
    }
  } catch (error) {
    console.warn('Built-in skill preparation failed', error)
    throw new Error(BUILT_IN_SKILLS_FAILURE, { cause: error })
  }
}
