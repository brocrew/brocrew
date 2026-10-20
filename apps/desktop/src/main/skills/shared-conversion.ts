import { setImmediate } from 'node:timers/promises'
import type { AppDatabase } from '../db/connection'
import { SharedSkillLibrary, type SavedPersonalSkill } from './shared-library'

/** Runs after window load; each legacy catalogue page is bounded and yields before the next. */
export async function convertSharedSkills(userData: string, db: AppDatabase): Promise<void> {
  const library = new SharedSkillLibrary(userData)
  await library.convert(async () => {
    const skills: SavedPersonalSkill[] = []
    for (let offset = 0; ; offset += 16) {
      await setImmediate()
      const rows = db
        .prepare(
          `SELECT h.id, v.metadata, v.body FROM skill_current h
        JOIN skill_version v ON v.id = h.current_version AND v.skill_id = h.id
        WHERE h.id LIKE 'person/%' ORDER BY h.id LIMIT 16 OFFSET ?`,
        )
        .all(offset) as { id: string; metadata: string; body: string }[]
      for (const row of rows) {
        const metadata = JSON.parse(row.metadata) as { name: string; origin: { kind: string } }
        if (
          metadata.origin.kind !== 'person' ||
          typeof metadata.name !== 'string' ||
          row.id !== `person/${metadata.name}`
        )
          throw new Error('Skills could not be read.')
        skills.push({ id: row.id, name: metadata.name, body: row.body })
      }
      if (rows.length < 16) return skills
    }
  })
}
