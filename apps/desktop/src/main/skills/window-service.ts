import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename } from 'node:path'
import type { AppDatabase } from '../db/connection'
import type { VerifiedBuiltInSkills } from './built-in-catalogue'
import { SkillCatalogueError, SqliteSkillCatalogue } from './catalogue-store'
import { SkillName, SKILL_LIMITS } from '../../shared/skills-catalogue'
import { SkillsRequest, type ImportedSkill, type SkillsWindow } from '../../shared/skills-window'
import { DEFAULT_PROFILE_ID } from '../../shared/runtime-ipc'

/** The picker supplies a path; only a bounded regular SKILL.md is copied into memory. */
export async function copySkillFile(path: string): Promise<ImportedSkill> {
  if (basename(path) !== 'SKILL.md') throw new SkillCatalogueError('path')
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size < 1 || stat.size > SKILL_LIMITS.bodyBytes)
      throw new SkillCatalogueError('size')
    const buffer = Buffer.alloc(SKILL_LIMITS.bodyBytes + 1)
    let count = 0
    while (count < buffer.length) {
      const read = await file.read(buffer, count, buffer.length - count, null)
      count += read.bytesRead
      if (read.bytesRead === 0) break
    }
    if (count > SKILL_LIMITS.bodyBytes) throw new SkillCatalogueError('size')
    const bytes = buffer.subarray(0, count)
    const body = bytes.toString('utf8')
    if (!Buffer.from(body, 'utf8').equals(bytes) || body.includes('\0'))
      throw new SkillCatalogueError('invalid')
    const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/
      .exec(body)?.[1]
      ?.split(/\r?\n/)
      .filter((line) => line !== '')
    const name = front?.find((line) => line.startsWith('name: '))?.slice(6)
    const description = front?.find((line) => line.startsWith('description: '))?.slice(13)
    if (
      front?.length !== 2 ||
      !SkillName.safeParse(name).success ||
      !description ||
      description.length > 500
    )
      throw new SkillCatalogueError('frontmatter')
    return { name: name!, description, body }
  } finally {
    await file.close()
  }
}

/** Lazy initialization is reached only by the person's Settings page. */
export function skillsWindowService(input: {
  db: AppDatabase
  shipped: () => VerifiedBuiltInSkills
  choose: () => Promise<string | null>
  canCreateAgents: (slug: string) => boolean
}): SkillsWindow {
  let catalogue: SqliteSkillCatalogue | undefined
  return async (request) => {
    const parsed = SkillsRequest.safeParse(request)
    if (!parsed.success) return { operation: 'refused', reason: 'invalid' }
    const command = parsed.data
    try {
      if (command.operation === 'import') {
        const path = await input.choose()
        return { operation: 'import', skill: path === null ? null : await copySkillFile(path) }
      }
      const store = (catalogue ??= new SqliteSkillCatalogue(input.db, input.shipped()))
      const reading = (identityId: string) => {
        const row = input.db
          .prepare('SELECT slug FROM agent_identity WHERE id = ?')
          .get(identityId) as { slug: string } | undefined
        if (!row) throw new SkillCatalogueError('identity')
        return store.resolve(identityId, {
          canCreateAgents: input.canCreateAgents(row.slug),
          isCoordinator: row.slug === DEFAULT_PROFILE_ID,
        })
      }
      switch (command.operation) {
        case 'shared-list':
        case 'shared-toggle':
          return { operation: 'refused', reason: 'invalid' }
        case 'list':
          return { operation: 'list', page: store.list(command.offset) }
        case 'detail':
          return { operation: 'detail', skill: store.detail(command.id) }
        case 'choices': {
          return { operation: 'choices', reading: reading(command.identityId) }
        }
        case 'save': {
          const body = command.draft.body
          return {
            operation: 'save',
            revision: store.savePersonal(
              {
                ...command.draft,
                path: `${command.draft.name}/SKILL.md`,
                bytes: Buffer.byteLength(body, 'utf8'),
                sha256: createHash('sha256').update(body, 'utf8').digest('hex'),
              },
              command.revision,
              command.versionId,
            ),
          }
        }
        case 'select': {
          return input.db.transaction(() => {
            const revision = store.select(
              command.identityId,
              command.id,
              command.selection,
              command.revision,
            )
            return { operation: 'select' as const, revision, reading: reading(command.identityId) }
          })()
        }
      }
    } catch (error) {
      if (error instanceof SkillCatalogueError) return { operation: 'refused', reason: error.code }
      throw error
    }
  }
}
