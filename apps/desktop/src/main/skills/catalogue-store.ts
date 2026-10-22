import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AppDatabase } from '../db/connection'
import {
  PluginSkillBundle,
  SkillDraft,
  SkillOrigin,
  SkillRelease,
  SkillRequirement,
  SkillSelection,
  SKILL_LIMITS,
  type SkillCatalogue,
  type SkillChoice,
  type SkillDetail,
  type SkillGrants,
  type SkillPage,
  type SkillRefusal,
  type SkillResolution,
  type SkillSummary,
} from '../../shared/skills-catalogue'
import { verifyBuiltInSkills, type VerifiedBuiltInSkills } from './built-in-catalogue'

export class SkillCatalogueError extends Error {
  constructor(readonly code: SkillRefusal) {
    super(code)
  }
}
const refuse = (code: SkillRefusal): never => {
  throw new SkillCatalogueError(code)
}
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const revisionNumber = z.number().int().nonnegative().safe()
const metadata = SkillRelease.omit({ body: true }).extend({
  origin: SkillOrigin,
  alias: z.string(),
  requirement: SkillRequirement,
})
type Metadata = z.infer<typeof metadata>
type Row = {
  id: string
  alias: string
  active: number
  version_id: string
  skill_id: string
  version_key: string
  metadata: string
  sha256: string
  bytes: number
  created_at: number
  plugin_id: string | null
  package_version: string | null
  package_sha256: string | null
  package_manifest_sha256: string | null
  body?: string
}
const columns = `h.id, h.alias, h.active, v.id AS version_id, v.skill_id, v.version_key,
 v.metadata, v.sha256, v.bytes, v.created_at, v.plugin_id, v.package_version, v.package_sha256, v.package_manifest_sha256`
const keyFor = (origin: SkillOrigin, name: string) =>
  `${origin.kind === 'plugin' ? `plugin/${origin.pluginId}` : origin.kind}/${name}`
export function skillAlias(origin: SkillOrigin, name: string): string {
  if (origin.kind === 'built-in') return name
  return `${origin.kind === 'person' ? 'personal' : 'plugin'}-${name.slice(0, 24)}-${hash(keyFor(origin, name)).slice(0, 16)}`
}
export function skillRequirement(origin: SkillOrigin, name: string): SkillRequirement {
  if (origin.kind !== 'built-in') return null
  if (name === 'build-a-team') return 'create-agents'
  return name === 'add-a-capability' ? 'create-agents-or-coordinator' : null
}
export function checkedSkillDraft(input: SkillDraft): SkillDraft {
  const parsed = SkillDraft.safeParse(input)
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path[0])
    return refuse(
      fields.includes('path')
        ? 'path'
        : fields.includes('bytes') || fields.includes('body')
          ? 'size'
          : fields.includes('sha256')
            ? 'hash'
            : 'invalid',
    )
  }
  const draft = parsed.data
  if (draft.path !== `${draft.name}/SKILL.md`) return refuse('path')
  if (Buffer.byteLength(draft.body, 'utf8') !== draft.bytes) return refuse('size')
  if (hash(draft.body) !== draft.sha256) return refuse('hash')
  if (
    [draft.body, draft.description, draft.reminder].some(
      (text) => text.includes('\0') || Buffer.from(text, 'utf8').toString('utf8') !== text,
    )
  )
    return refuse('invalid')
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(draft.body)?.[1]
  const lines = front?.split(/\r?\n/).filter((line) => line !== '')
  if (
    lines?.length !== 2 ||
    !lines.includes(`name: ${draft.name}`) ||
    !lines.includes(`description: ${draft.description}`)
  )
    return refuse('frontmatter')
  return draft
}

function documentOf(value: Omit<SkillDraft, 'body'>, body: string): SkillDraft {
  return {
    name: value.name,
    description: value.description,
    reminder: value.reminder,
    path: value.path,
    bytes: value.bytes,
    sha256: value.sha256,
    body,
  }
}

/** Bounded SQLite reads and transactional writes; no filesystem or provider is opened. */
export class SqliteSkillCatalogue implements SkillCatalogue {
  constructor(
    private readonly db: AppDatabase,
    shipped: VerifiedBuiltInSkills,
    private readonly now = Date.now,
  ) {
    this.seedBuiltins(shipped)
  }
  private revision(): number {
    const row = this.db.prepare('SELECT revision FROM skill_catalogue_state WHERE id = 1').get() as
      { revision: number } | undefined
    if (row === undefined) return 0
    if (!revisionNumber.safeParse(row.revision).success) return refuse('corrupt')
    return row.revision
  }
  private change(expected: number | undefined, apply: () => boolean): number {
    return this.db
      .transaction(() => {
        this.db
          .prepare('INSERT OR IGNORE INTO skill_catalogue_state (id, revision) VALUES (1, 0)')
          .run()
        const before = this.revision()
        if (
          expected !== undefined &&
          (!revisionNumber.safeParse(expected).success || expected !== before)
        )
          return refuse('stale')
        if (!apply()) return before
        if (before >= Number.MAX_SAFE_INTEGER) return refuse('limit')
        this.db
          .prepare('UPDATE skill_catalogue_state SET revision = ? WHERE id = 1')
          .run(before + 1)
        return before + 1
      })
      .immediate()
  }
  private identity(id: string): void {
    if (
      typeof id !== 'string' ||
      this.db.prepare('SELECT 1 FROM agent_identity WHERE id = ?').get(id) === undefined
    )
      refuse('identity')
  }
  private row(id: string, versionId?: string): Row | undefined {
    return this.db
      .prepare(
        `SELECT ${columns}, v.body FROM skill_current h JOIN skill_version v
      ON v.skill_id = h.id AND v.id = ${versionId === undefined ? 'h.current_version' : '?'} WHERE h.id = ?`,
      )
      .get(...(versionId === undefined ? [id] : [versionId, id])) as Row | undefined
  }
  private summary(row: Row): SkillSummary {
    let value: unknown
    try {
      value = JSON.parse(row.metadata)
    } catch {
      return refuse('corrupt')
    }
    const parsed = metadata.safeParse(value)
    if (!parsed.success) return refuse('corrupt')
    const m = parsed.data
    const sourcePackage =
      row.plugin_id === null ? null : { version: row.package_version!, sha256: row.package_sha256! }
    if (
      row.id !== row.skill_id ||
      row.id !== keyFor(m.origin, m.name) ||
      row.alias !== m.alias ||
      m.alias !== skillAlias(m.origin, m.name) ||
      m.path !== `${m.name}/SKILL.md` ||
      m.sha256 !== row.sha256 ||
      m.bytes !== row.bytes ||
      m.requirement !== skillRequirement(m.origin, m.name) ||
      (m.origin.kind === 'plugin'
        ? row.plugin_id !== m.origin.pluginId ||
          !sourcePackage ||
          !SkillRelease.shape.version.safeParse(sourcePackage.version).success ||
          !/^[a-f0-9]{64}$/.test(sourcePackage.sha256) ||
          !/^[a-f0-9]{64}$/.test(row.package_manifest_sha256 ?? '')
        : row.plugin_id !== null || row.package_version !== null || row.package_sha256 !== null) ||
      row.version_key !== (sourcePackage ? `${sourcePackage.version}/${m.version}` : m.version) ||
      row.version_id !== `${row.id}@${hash(row.version_key)}`
    )
      return refuse('corrupt')
    return {
      id: row.id,
      origin: m.origin,
      name: m.name,
      alias: m.alias,
      version: m.version,
      versionId: row.version_id,
      description: m.description,
      reminder: m.reminder,
      bytes: m.bytes,
      sha256: m.sha256,
      package: sourcePackage,
      requirement: m.requirement,
      active: row.active === 1,
      defaultEnabled: m.origin.kind === 'built-in',
    }
  }
  list(offset: number = 0, limit: number = SKILL_LIMITS.page): SkillPage {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > SKILL_LIMITS.page
    )
      return refuse('limit')
    return this.db.transaction(() => {
      const total = (
        this.db.prepare('SELECT count(*) AS n FROM skill_current').get() as { n: number }
      ).n
      if (total > SKILL_LIMITS.skills) return refuse('limit')
      const rows = this.db
        .prepare(
          `SELECT ${columns} FROM skill_current h JOIN skill_version v ON v.id = h.current_version AND v.skill_id = h.id ORDER BY h.id LIMIT ? OFFSET ?`,
        )
        .all(limit, offset) as Row[]
      return { revision: this.revision(), total, items: rows.map((row) => this.summary(row)) }
    })()
  }
  detail(id: string, versionId?: string): SkillDetail | null {
    const row = this.row(id, versionId)
    if (row === undefined) return null
    const summary = this.summary(row)
    if (row.body === undefined) return refuse('corrupt')
    const m = metadata.parse(JSON.parse(row.metadata))
    try {
      checkedSkillDraft(documentOf(m, row.body))
    } catch {
      return refuse('corrupt')
    }
    return { ...summary, path: m.path, body: row.body, createdAt: row.created_at }
  }
  resolve(identityId: string, grants: SkillGrants): SkillResolution {
    return this.db.transaction(() => {
      this.identity(identityId)
      const rows = this.db
        .prepare(
          `SELECT ${columns}, coalesce(s.choice, 'default') AS choice FROM skill_current h
        JOIN skill_version v ON v.id = h.current_version AND v.skill_id = h.id
        LEFT JOIN skill_selection s ON s.skill_id = h.id AND s.identity_id = ? ORDER BY h.id LIMIT ?`,
        )
        .all(identityId, SKILL_LIMITS.skills + 1) as (Row & { choice: string })[]
      if (rows.length > SKILL_LIMITS.skills) return refuse('limit')
      const choices: SkillChoice[] = rows.map((row) => {
        const skill = this.summary(row)
        const parsed = SkillSelection.safeParse(row.choice)
        if (!parsed.success) return refuse('corrupt')
        const selection = parsed.data
        const selected = selection === 'on' || (selection === 'default' && skill.defaultEnabled)
        const eligible =
          skill.active &&
          (skill.requirement === null ||
            grants.canCreateAgents ||
            (skill.requirement === 'create-agents-or-coordinator' && grants.isCoordinator))
        return {
          skill,
          selection,
          selected,
          eligible,
          ready: selected && eligible,
          reason: !skill.active ? 'source-unavailable' : !eligible ? 'create-agents' : null,
        }
      })
      const ready = choices.filter((choice) => choice.ready)
      if (
        ready.length > SKILL_LIMITS.selected ||
        ready.reduce((sum, one) => sum + one.skill.bytes, 0) > SKILL_LIMITS.selectedBytes
      )
        return refuse('limit')
      return { revision: this.revision(), identityId, choices }
    })()
  }
  private put(
    origin: SkillOrigin,
    release: z.infer<typeof SkillRelease>,
    sourcePackage: SkillSummary['package'] = null,
    packageManifest: string | null = null,
  ): boolean {
    const draft = checkedSkillDraft(documentOf(release, release.body))
    const id = keyFor(origin, draft.name),
      alias = skillAlias(origin, draft.name)
    const versionKey = sourcePackage
      ? `${sourcePackage.version}/${release.version}`
      : release.version
    const versionId = `${id}@${hash(versionKey)}`
    const { body, ...declared } = draft
    const stored: Metadata = {
      ...declared,
      version: release.version,
      origin,
      alias,
      requirement: skillRequirement(origin, draft.name),
    }
    const encoded = JSON.stringify(stored)
    const previous = this.db
      .prepare(
        'SELECT metadata, body, package_sha256 FROM skill_version WHERE skill_id = ? AND version_key = ?',
      )
      .get(id, versionKey) as
      { metadata: string; body: string; package_sha256: string | null } | undefined
    if (
      previous &&
      (previous.metadata !== encoded ||
        previous.body !== draft.body ||
        previous.package_sha256 !== (sourcePackage?.sha256 ?? null))
    )
      return refuse('version-conflict')
    const head = this.row(id)
    if (!head) {
      if (
        (this.db.prepare('SELECT count(*) AS n FROM skill_current').get() as { n: number }).n >=
        SKILL_LIMITS.skills
      )
        return refuse('limit')
      const collision = this.db
        .prepare('SELECT id FROM skill_current WHERE alias = ?')
        .get(alias) as { id: string } | undefined
      if (collision && collision.id !== id) return refuse('duplicate-name')
    }
    if (!previous)
      this.db
        .prepare(
          `INSERT INTO skill_version (id, skill_id, version_key, metadata, body, sha256, bytes, plugin_id, package_version, package_sha256, package_manifest_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          versionId,
          id,
          versionKey,
          encoded,
          body,
          draft.sha256,
          draft.bytes,
          origin.kind === 'plugin' ? origin.pluginId : null,
          sourcePackage?.version ?? null,
          sourcePackage?.sha256 ?? null,
          packageManifest,
          this.now(),
        )
    if (head?.version_id === versionId && head.active === 1) return false
    this.db
      .prepare(
        'INSERT INTO skill_current (id, alias, current_version, active) VALUES (?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET current_version = excluded.current_version, active = 1',
      )
      .run(id, alias, versionId)
    return true
  }
  seedBuiltins(bundle: VerifiedBuiltInSkills): number {
    const verified = verifyBuiltInSkills(bundle.catalogue, bundle.bodies)
    if (verified.digest !== bundle.digest) return refuse('hash')
    return this.change(undefined, () => {
      const currentIds = verified.catalogue.skills.map((item) => `built-in/${item.name}`)
      const omitted = this.db
        .prepare(
          `UPDATE skill_current SET active = 0 WHERE active = 1 AND id LIKE 'built-in/%' AND id NOT IN (${currentIds.map(() => '?').join(', ')})`,
        )
        .run(...currentIds)
      let changed = omitted.changes > 0
      for (const item of verified.catalogue.skills) {
        if (this.row(`person/${item.name}`)) return refuse('duplicate-name')
        changed =
          this.put(
            { kind: 'built-in' },
            {
              name: item.name,
              description: item.description,
              reminder: item.reminder.slice(`${item.name} — `.length),
              path: `${item.name}/SKILL.md`,
              body: verified.bodies.get(item.name)!,
              bytes: item.bytes,
              sha256: item.sha256,
              version: verified.catalogue.version,
            },
          ) || changed
      }
      return changed
    })
  }
  savePersonal(
    input: SkillDraft,
    expectedRevision: number,
    expectedVersionId: string | null = null,
  ): number {
    const draft = checkedSkillDraft(input)
    return this.change(expectedRevision, () => {
      if (this.row(`built-in/${draft.name}`)) return refuse('duplicate-name')
      const previous = this.row(`person/${draft.name}`)
      if (expectedVersionId === null && previous) return refuse('duplicate-name')
      if (expectedVersionId !== null && previous?.version_id !== expectedVersionId)
        return refuse('stale')
      const current = previous ? this.summary(previous).version : 'v0'
      const number = /^v(\d+)$/.exec(current)?.[1]
      const next = number === undefined ? NaN : Number(number) + 1
      if (!Number.isSafeInteger(next)) return refuse('corrupt')
      return this.put({ kind: 'person' }, { ...draft, version: `v${next}` })
    })
  }
  select(identityId: string, id: string, value: SkillSelection, expectedRevision: number): number {
    return this.change(expectedRevision, () => {
      this.identity(identityId)
      const choice = SkillSelection.safeParse(value)
      if (!choice.success) return refuse('invalid')
      const head = this.row(id)
      if (!head) return refuse('missing')
      if (choice.data === 'on' && head.active !== 1) return refuse('source-unavailable')
      const before = this.db
        .prepare('SELECT choice FROM skill_selection WHERE identity_id = ? AND skill_id = ?')
        .get(identityId, id) as { choice: string } | undefined
      if ((before?.choice ?? 'default') === choice.data) return false
      this.db
        .prepare(
          'INSERT INTO skill_selection (identity_id, skill_id, choice) VALUES (?, ?, ?) ON CONFLICT(identity_id, skill_id) DO UPDATE SET choice = excluded.choice',
        )
        .run(identityId, id, choice.data)
      this.resolve(identityId, { canCreateAgents: true, isCoordinator: true })
      return true
    })
  }
  private deactivate(id: string): boolean {
    const changed = this.db
      .prepare('UPDATE skill_current SET active = 0 WHERE id = ? AND active = 1')
      .run(id).changes
    const choices = this.db
      .prepare("UPDATE skill_selection SET choice = 'off' WHERE skill_id = ? AND choice != 'off'")
      .run(id).changes
    return changed + choices > 0
  }
  ingestPlugin(input: PluginSkillBundle, expectedRevision: number): number {
    const parsed = PluginSkillBundle.safeParse(input)
    if (!parsed.success) return refuse('invalid')
    const bundle = parsed.data
    const names = new Set(bundle.skills.map((one) => one.name))
    if (names.size !== bundle.skills.length) return refuse('duplicate-name')
    for (const release of bundle.skills) checkedSkillDraft(documentOf(release, release.body))
    const packageManifest = hash(
      JSON.stringify(
        [...bundle.skills]
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
          .map((one) => ({
            name: one.name,
            description: one.description,
            reminder: one.reminder,
            version: one.version,
            path: one.path,
            bytes: one.bytes,
            sha256: one.sha256,
          })),
      ),
    )
    return this.change(expectedRevision, () => {
      const pin = this.db
        .prepare(
          'SELECT package_sha256, package_manifest_sha256 FROM skill_version WHERE plugin_id = ? AND package_version = ? LIMIT 1',
        )
        .get(bundle.pluginId, bundle.packageVersion) as
        { package_sha256: string; package_manifest_sha256: string } | undefined
      if (
        pin &&
        (pin.package_sha256 !== bundle.packageSha256 ||
          pin.package_manifest_sha256 !== packageManifest)
      )
        return refuse('version-conflict')
      let changed = false
      const heads = this.listAll()
      for (const head of heads)
        if (
          head.origin.kind === 'plugin' &&
          head.origin.pluginId === bundle.pluginId &&
          !names.has(head.name)
        )
          changed = this.deactivate(head.id) || changed
      for (const release of bundle.skills)
        changed =
          this.put(
            { kind: 'plugin', pluginId: bundle.pluginId },
            release,
            { version: bundle.packageVersion, sha256: bundle.packageSha256 },
            packageManifest,
          ) || changed
      return changed
    })
  }
  private listAll(): readonly SkillSummary[] {
    const all: SkillSummary[] = []
    for (let offset = 0; offset < SKILL_LIMITS.skills; offset += SKILL_LIMITS.page) {
      const page = this.list(offset)
      all.push(...page.items)
      if (all.length >= page.total) break
    }
    return all
  }
  revokePlugin(pluginId: string, expectedRevision: number): number {
    if (!SkillOrigin.safeParse({ kind: 'plugin', pluginId }).success) return refuse('invalid')
    return this.change(expectedRevision, () => {
      let changed = false
      for (const head of this.listAll())
        if (head.origin.kind === 'plugin' && head.origin.pluginId === pluginId)
          changed = this.deactivate(head.id) || changed
      return changed
    })
  }
}
