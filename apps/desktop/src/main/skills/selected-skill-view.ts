import { providerKnowledge } from '../providers/knowledge-definitions'
import { providerDescriptor, type Provider } from '@brobot2/shared'
import {
  SkillOrigin,
  SkillRelease,
  SKILL_LIMITS,
  type SkillDetail,
} from '../../shared/skills-catalogue'
import {
  INSTALLED_SKILL_BYTE_LIMIT,
  type InstalledSkillVersion,
} from '../../shared/skills-installation'
import { checkedSkillDraft, skillAlias, skillRequirement } from './catalogue-store'
import { skillDigest, verifyBuiltInSkills, type VerifiedBuiltInSkills } from './built-in-catalogue'
import type { BuiltInSkillView } from './skill-view'

/** Native frontmatter is projected; the saved source and its digest remain unchanged. */
export function selectedSkillView(
  provider: Provider,
  selected: readonly SkillDetail[],
  bundle: VerifiedBuiltInSkills,
  textPack = false,
): BuiltInSkillView & { reminder: string; versions: readonly InstalledSkillVersion[] } {
  const verified = verifyBuiltInSkills(bundle.catalogue, bundle.bodies)
  if (verified.digest !== bundle.digest || selected.length > SKILL_LIMITS.selected)
    throw new Error('Invalid selected skill catalogue.')
  const files = providerKnowledge[provider].skills.initialFiles()

  const skills: BuiltInSkillView['skills'][number][] = []
  const versions: InstalledSkillVersion[] = []
  const reminders: string[] = []
  const ids = new Set<string>(),
    aliases = new Set<string>()
  let total = [...files.values()].reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8'), 0)
  for (const source of selected) {
    const original = checkedSkillDraft({
      name: source.name,
      description: source.description,
      reminder: source.reminder,
      path: source.path,
      body: source.body,
      bytes: source.bytes,
      sha256: source.sha256,
    })
    SkillRelease.parse({ ...original, version: source.version })
    const origin = SkillOrigin.parse(source.origin)
    const expectedId = `${origin.kind === 'plugin' ? `plugin/${origin.pluginId}` : origin.kind}/${source.name}`
    if (
      !source.active ||
      source.id !== expectedId ||
      source.alias !== skillAlias(origin, source.name) ||
      source.requirement !== skillRequirement(origin, source.name) ||
      ids.has(source.id) ||
      aliases.has(source.alias)
    )
      throw new Error('Invalid selected skill identity.')
    ids.add(source.id)
    aliases.add(source.alias)
    let body = source.body,
      description = source.description,
      reminder = source.reminder,
      version = source.version
    if (source.origin.kind === 'built-in') {
      const item = verified.catalogue.skills.find((one) => one.name === source.name)
      if (!item) throw new Error('Unavailable shipped skill.')
      if (
        !textPack &&
        (source.version !== verified.catalogue.version ||
          source.sha256 !== item.sha256 ||
          source.bytes !== item.bytes ||
          source.description !== item.description ||
          source.reminder !== item.reminder.slice(`${item.name} — `.length))
      )
        throw new Error('Changed shipped skill source.')
      if (textPack) {
        body = verified.bodies.get(item.name)!
        description = item.description
        reminder = item.reminder.slice(`${item.name} — `.length)
        version = verified.catalogue.version
      }
    }
    const draft = checkedSkillDraft({
      name: source.name,
      description,
      reminder,
      path: `${source.name}/SKILL.md`,
      body,
      bytes: Buffer.byteLength(body, 'utf8'),
      sha256: skillDigest(body),
    })
    SkillRelease.parse({ ...draft, version })
    if (!textPack || source.origin.kind !== 'built-in') {
      if (source.sha256 !== draft.sha256 || source.bytes !== draft.bytes)
        throw new Error('Changed selected skill source.')
    }
    const header = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n)/.exec(body)
    if (!header) throw new Error('Missing skill frontmatter.')
    let fields = header[2]!.replace(/^name: [^\r\n]+/m, `name: ${source.alias}`)
    if (source.origin.kind !== 'built-in') {
      const quoted = JSON.stringify(description).replace(
        /[\u007f-\u009f\u2028\u2029]/g,
        (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
      )
      fields = fields.replace(/^description: [^\r\n]+/m, () => `description: ${quoted}`)
    }
    const projected = header[1]! + fields + header[3]! + body.slice(header[0].length)
    const bytes = Buffer.byteLength(projected, 'utf8')
    total += bytes
    if (bytes > INSTALLED_SKILL_BYTE_LIMIT || total > SKILL_LIMITS.selectedBytes)
      throw new Error('Selected skills exceed the view bound.')
    const installed = { name: source.alias, description, sha256: skillDigest(projected), bytes }
    skills.push(installed)
    files.set(providerKnowledge[provider].skills.fileFor(source.alias), projected)
    versions.push({
      id: source.id,
      versionId: source.versionId,
      version: source.version,
      alias: source.alias,
      sourceSha256: source.sha256,
      sha256: installed.sha256,
      bytes,
      requirement: source.requirement,
      ...(textPack && source.origin.kind === 'built-in'
        ? {
            textPackDigest: verified.digest,
            textPackVersion: verified.catalogue.version,
            textPackSourceSha256: draft.sha256,
          }
        : {}),
    })
    reminders.push(
      `${providerDescriptor(provider).skillReminderPrefix}${source.alias} — ${reminder}`,
    )
  }
  const digest = skillDigest(JSON.stringify({ provider, versions }))
  return {
    provider,
    digest,
    files,
    skills,
    discoveryRoot: providerKnowledge[provider].skills.discoveryRoot,
    versions,
    reminder: reminders.length ? reminders.join('\n') + '\n' : '',
  }
}
