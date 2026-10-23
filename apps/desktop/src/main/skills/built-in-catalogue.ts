import { legacySkillReminderFormats } from '../providers/knowledge-definitions'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { providerDescriptor, type Provider } from '@brobot2/shared'
import { BUILT_IN_SKILL_NAMES } from '../../shared/built-in-skills'

/**
 * A version label the shipped texts may carry, `v6` or `v9.1`. Any such label is taken: a running
 * build reads the folder a newer commit wrote, so a label it cannot know must not stop a launch.
 * The format is `formatVersion`; this build reads the neutral format and normalizes legacy pairs.
 */
export const SKILLS_VERSION_LABEL = /^v\d+(?:\.\d+)?$/

const legacySkill = z.strictObject({
  name: z.enum(BUILT_IN_SKILL_NAMES),
  description: z.string().min(1).max(500),
  reminder: z.strictObject(
    Object.fromEntries(legacySkillReminderFormats.map((format) => [format.field, format.schema])),
  ),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().min(1).max(65_536),
})

const legacyCatalogue = z
  .strictObject({
    formatVersion: z.literal(1),
    version: z.string().regex(SKILLS_VERSION_LABEL),
    skills: z.array(legacySkill).length(BUILT_IN_SKILL_NAMES.length),
  })
  .superRefine((catalogue, context) => {
    for (const [index, item] of catalogue.skills.entries()) {
      const reminders = legacySkillReminderFormats.map((format) =>
        format.canonical(item.name, item.reminder[format.field]!),
      )
      if (
        item.name !== BUILT_IN_SKILL_NAMES[index] ||
        reminders.some((one) => one === null) ||
        reminders.some((one) => one !== reminders[0]) ||
        /[\r\n]/.test(item.description)
      ) {
        context.addIssue({ code: 'custom', message: 'The built-in skill catalogue must agree.' })
      }
    }
  })

const neutralSkill = z.strictObject({
  name: z.enum(BUILT_IN_SKILL_NAMES),
  description: z.string().min(1).max(500),
  reminder: z.string().min(1).max(240),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().min(1).max(65_536),
})

const neutralCatalogue = z
  .strictObject({
    formatVersion: z.literal(2),
    version: z.string().regex(SKILLS_VERSION_LABEL),
    skills: z.array(neutralSkill).length(BUILT_IN_SKILL_NAMES.length),
  })
  .superRefine((catalogue, context) => {
    for (const [index, item] of catalogue.skills.entries()) {
      if (
        item.name !== BUILT_IN_SKILL_NAMES[index] ||
        !item.reminder.startsWith(`${item.name} — `) ||
        /[\r\n]/.test(item.description + item.reminder)
      ) {
        context.addIssue({ code: 'custom', message: 'The built-in skill catalogue must agree.' })
      }
    }
  })

/** Old pairs are checked before normalization; both formats have the same canonical digest. */
export const BuiltInSkillCatalogueSchema = z
  .union([
    neutralCatalogue,
    legacyCatalogue.transform((catalogue) => ({
      ...catalogue,
      formatVersion: 2 as const,
      skills: catalogue.skills.map((item) => ({
        ...item,
        reminder: legacySkillReminderFormats[0].canonical(
          item.name,
          item.reminder[legacySkillReminderFormats[0].field]!,
        )!,
      })),
    })),
  ])
  .pipe(neutralCatalogue)

export type BuiltInSkillCatalogue = z.infer<typeof BuiltInSkillCatalogueSchema>
export type BuiltInSkill = BuiltInSkillCatalogue['skills'][number]

export function builtInSkillReminders(provider: Provider, skills: readonly BuiltInSkill[]): string {
  const prefix = providerDescriptor(provider).skillReminderPrefix
  return skills.length === 0 ? '' : skills.map((item) => prefix + item.reminder).join('\n') + '\n'
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
