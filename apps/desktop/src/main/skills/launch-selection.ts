import type { AppDatabase } from '../db/connection'
import { BUILT_IN_SKILL_NAMES } from '../../shared/built-in-skills'
import type { SkillDetail, SkillGrants } from '../../shared/skills-catalogue'
import type { VerifiedBuiltInSkills } from './built-in-catalogue'
import { SqliteSkillCatalogue } from './catalogue-store'

export interface SkillLaunchSelection {
  readonly revision: number
  readonly skills: readonly SkillDetail[]
  readonly isCurrent: () => boolean
}

/** One bounded database snapshot, with its source versions kept until the launch finishes. */
export function launchSkillSelections(db: AppDatabase, shipped: () => VerifiedBuiltInSkills) {
  let catalogue: SqliteSkillCatalogue | undefined
  const revision = () =>
    (
      db.prepare('SELECT revision FROM skill_catalogue_state WHERE id = 1').get() as {
        revision: number
      }
    ).revision
  const identity = (profileId: string | null) =>
    profileId === null
      ? undefined
      : (
          db.prepare('SELECT id FROM agent_identity WHERE slug = ?').get(profileId) as
            { id: string } | undefined
        )?.id
  return (profileId: string | null, grants: SkillGrants): SkillLaunchSelection => {
    const store = (catalogue ??= new SqliteSkillCatalogue(db, shipped()))
    return db.transaction(() => {
      const id = identity(profileId)
      const summaries =
        id === undefined
          ? BUILT_IN_SKILL_NAMES.flatMap((name) => {
              const skill = store.detail(`built-in/${name}`)
              return skill ? [skill] : []
            }).filter(
              (skill) =>
                skill.active &&
                (skill.requirement === null ||
                  grants.canCreateAgents ||
                  (skill.requirement === 'create-agents-or-coordinator' && grants.isCoordinator)),
            )
          : store
              .resolve(id, grants)
              .choices.filter((choice) => choice.ready)
              .map((choice) => choice.skill)
      const stamp = revision()
      const skills = summaries
        .map((skill) => {
          const detail = store.detail(skill.id, skill.versionId)
          if (!detail) throw new Error('Skill source unavailable.')
          return detail
        })
        .sort((a, b) => {
          const order = (one: SkillDetail) =>
            one.origin.kind === 'built-in'
              ? BUILT_IN_SKILL_NAMES.indexOf(one.name as (typeof BUILT_IN_SKILL_NAMES)[number])
              : BUILT_IN_SKILL_NAMES.length
          return order(a) - order(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        })
      return {
        revision: stamp,
        skills,
        isCurrent: () => revision() === stamp && identity(profileId) === id,
      }
    })()
  }
}
