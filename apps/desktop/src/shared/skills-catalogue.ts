import { z } from 'zod'

export const SKILL_LIMITS = {
  skills: 200,
  bodyBytes: 65_536,
  selected: 64,
  selectedBytes: 4 * 1024 * 1024,
  page: 50,
} as const

export const SkillName = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
export const SkillDigest = z.string().regex(/^[a-f0-9]{64}$/)
export const SkillOrigin = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('built-in') }),
  z.strictObject({ kind: z.literal('person') }),
  z.strictObject({ kind: z.literal('plugin'), pluginId: SkillName }),
])
export type SkillOrigin = z.infer<typeof SkillOrigin>
export const SkillRequirement = z.enum(['create-agents', 'create-agents-or-coordinator']).nullable()
export type SkillRequirement = z.infer<typeof SkillRequirement>
export const SkillSelection = z.enum(['default', 'on', 'off'])
export type SkillSelection = z.infer<typeof SkillSelection>

/** Source bytes, not a provider-home path or an executable package. */
export const SkillDraft = z.strictObject({
  name: SkillName,
  description: z
    .string()
    .min(1)
    .max(500)
    .regex(/^[^\r\n]+$/),
  reminder: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[^\r\n]+$/),
  path: z.string().regex(/^[a-z][a-z0-9-]{0,63}\/SKILL\.md$/),
  body: z.string().min(1).max(SKILL_LIMITS.bodyBytes),
  bytes: z.number().int().min(1).max(SKILL_LIMITS.bodyBytes),
  sha256: SkillDigest,
})
export type SkillDraft = z.infer<typeof SkillDraft>
export const SkillRelease = SkillDraft.extend({
  version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,79}$/),
})
export type SkillRelease = z.infer<typeof SkillRelease>

export const PluginSkillBundle = z.strictObject({
  pluginId: SkillName,
  packageVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,79}$/),
  packageSha256: SkillDigest,
  skills: z.array(SkillRelease).min(1).max(SKILL_LIMITS.skills),
})
export type PluginSkillBundle = z.infer<typeof PluginSkillBundle>

export interface SkillSummary {
  readonly id: string
  readonly origin: SkillOrigin
  readonly name: string
  readonly alias: string
  readonly version: string
  readonly versionId: string
  readonly description: string
  readonly reminder: string
  readonly bytes: number
  readonly sha256: string
  readonly package: { readonly version: string; readonly sha256: string } | null
  readonly requirement: SkillRequirement
  readonly active: boolean
  readonly defaultEnabled: boolean
}
export interface SkillDetail extends SkillSummary {
  readonly path: string
  readonly body: string
  readonly createdAt: number
}
export interface SkillChoice {
  readonly skill: SkillSummary
  readonly selection: SkillSelection
  readonly selected: boolean
  readonly eligible: boolean
  readonly ready: boolean
  readonly reason: 'source-unavailable' | 'create-agents' | null
}
export interface SkillPage {
  readonly revision: number
  readonly total: number
  readonly items: readonly SkillSummary[]
}
export interface SkillResolution {
  readonly revision: number
  readonly identityId: string
  readonly choices: readonly SkillChoice[]
}
export interface SkillGrants {
  readonly canCreateAgents: boolean
  readonly isCoordinator: boolean
}
export type SkillRefusal =
  | 'invalid'
  | 'duplicate-name'
  | 'path'
  | 'size'
  | 'hash'
  | 'frontmatter'
  | 'version-conflict'
  | 'stale'
  | 'missing'
  | 'identity'
  | 'source-unavailable'
  | 'limit'
  | 'corrupt'

/** Private host service; none of these methods grants tools or starts a provider. */
export interface SkillCatalogue {
  list(offset?: number, limit?: number): SkillPage
  detail(id: string, versionId?: string): SkillDetail | null
  resolve(identityId: string, grants: SkillGrants): SkillResolution
  savePersonal(
    draft: SkillDraft,
    expectedRevision: number,
    expectedVersionId?: string | null,
  ): number
  select(identityId: string, id: string, value: SkillSelection, expectedRevision: number): number
  ingestPlugin(bundle: PluginSkillBundle, expectedRevision: number): number
  revokePlugin(pluginId: string, expectedRevision: number): number
}
