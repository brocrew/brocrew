import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Provider } from '@brobot2/shared'
import { BUILT_IN_SKILL_NAMES } from '../../shared/built-in-skills'

/**
 * A version label the shipped texts may carry, `v6` or `v9.1`. Any such label is taken: a running
 * build reads the folder a newer commit wrote, so a label it cannot know must not stop a launch.
 * The format is `formatVersion`, which stays the one this build reads.
 */
export const SKILLS_VERSION_LABEL = /^v\d+(?:\.\d+)?$/

const skill = z.strictObject({
  name: z.enum(BUILT_IN_SKILL_NAMES),
  description: z.string().min(1).max(500),
  reminder: z.strictObject({
    codex: z.string().min(1).max(240),
    claude: z.string().min(1).max(247),
  }),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().min(1).max(65_536),
})

export const BuiltInSkillCatalogueSchema = z
  .strictObject({
    formatVersion: z.literal(1),
    version: z.string().regex(SKILLS_VERSION_LABEL),
    skills: z.array(skill).length(BUILT_IN_SKILL_NAMES.length),
  })
  .superRefine((catalogue, context) => {
    for (const [index, item] of catalogue.skills.entries()) {
      if (
        item.name !== BUILT_IN_SKILL_NAMES[index] ||
        !item.reminder.codex.startsWith(`${item.name} — `) ||
        item.reminder.claude !== `brobot:${item.reminder.codex}` ||
        /[\r\n]/.test(item.description + item.reminder.codex + item.reminder.claude)
      ) {
        context.addIssue({ code: 'custom', message: 'The built-in skill catalogue must agree.' })
      }
    }
  })

export type BuiltInSkillCatalogue = z.infer<typeof BuiltInSkillCatalogueSchema>
export type BuiltInSkill = BuiltInSkillCatalogue['skills'][number]

export function builtInSkillReminders(provider: Provider, skills: readonly BuiltInSkill[]): string {
  return skills.length === 0 ? '' : skills.map((item) => item.reminder[provider]).join('\n') + '\n'
}

export const skillDigest = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex')

export interface VerifiedBuiltInSkills {
  readonly catalogue: BuiltInSkillCatalogue
  readonly digest: string
  readonly bodies: ReadonlyMap<string, string>
}

/** Verifies the catalogue against the bundled bodies and their frontmatter. */
export function verifyBuiltInSkills(
  manifest: unknown,
  bodies: ReadonlyMap<string, string>,
): VerifiedBuiltInSkills {
  const catalogue = BuiltInSkillCatalogueSchema.parse(manifest)
  if (bodies.size !== catalogue.skills.length) throw new Error('Unexpected built-in skill files.')
  for (const item of catalogue.skills) {
    const text = bodies.get(item.name)
    if (
      text === undefined ||
      Buffer.byteLength(text, 'utf8') !== item.bytes ||
      skillDigest(text) !== item.sha256
    ) {
      throw new Error('A built-in skill body does not match its manifest.')
    }
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)?.[1]
    const named = frontmatter?.split(/\r?\n/).filter((line) => line.startsWith('name: '))
    const described = frontmatter?.split(/\r?\n/).filter((line) => line.startsWith('description: '))
    if (
      named?.length !== 1 ||
      named[0] !== `name: ${item.name}` ||
      described?.length !== 1 ||
      described[0] !== `description: ${item.description}`
    ) {
      throw new Error('Built-in skill frontmatter does not match its manifest.')
    }
  }
  return { catalogue, digest: skillDigest(JSON.stringify(catalogue)), bodies: new Map(bodies) }
}

/** Creation is checked again by the tool; this controls only what the launch offers. */
export function creationAllowedSkills(
  catalogue: BuiltInSkillCatalogue,
  canCreateAgents: boolean,
  isCoordinator = false,
): readonly BuiltInSkill[] {
  return catalogue.skills.filter((item) => {
    if (item.name === 'build-a-team') return canCreateAgents
    if (item.name === 'add-a-capability') return isCoordinator || canCreateAgents
    return true
  })
}
