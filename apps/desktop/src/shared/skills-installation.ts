import type { SkillRequirement } from './skills-catalogue'

/** Includes native aliases and escaped frontmatter for a 64 KiB source. */
export const INSTALLED_SKILL_BYTE_LIMIT = 68_608

/** The immutable source choice and the separately verified bytes installed under its alias. */
export interface InstalledSkillVersion {
  readonly id: string
  readonly versionId: string
  readonly version: string
  readonly alias: string
  readonly sourceSha256: string
  readonly sha256: string
  readonly bytes: number
  readonly requirement: SkillRequirement
  readonly textPackDigest?: string
  readonly textPackVersion?: string
  readonly textPackSourceSha256?: string
}
