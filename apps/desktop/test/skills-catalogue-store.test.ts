import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  verifyBuiltInSkills,
  type VerifiedBuiltInSkills,
} from '../src/main/skills/built-in-catalogue'
import {
  SqliteSkillCatalogue,
  SkillCatalogueError,
  skillAlias,
} from '../src/main/skills/catalogue-store'
import { BUILT_IN_SKILL_NAMES } from '../src/shared/built-in-skills'
import type { SkillDraft, PluginSkillBundle } from '../src/shared/skills-catalogue'

const root = dirname(fileURLToPath(import.meta.url))
const migrations = join(root, '../src/main/db/migrations')
const resources = join(root, '../resources/built-in-skills')
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
function shipped(): VerifiedBuiltInSkills {
  return verifyBuiltInSkills(
    JSON.parse(readFileSync(join(resources, 'manifest.json'), 'utf8')),
    new Map(
      BUILT_IN_SKILL_NAMES.map((name) => [
        name,
        readFileSync(join(resources, name, 'SKILL.md'), 'utf8'),
      ]),
    ),
  )
}
function draft(name = 'recipe-check', text = 'Check the fictional ingredients.'): SkillDraft {
  const description = 'Check a fictional recipe.'
  const body = `---\nname: ${name}\ndescription: ${description}\n---\n\n${text}\n`
  return {
    name,
    description,
    reminder: 'Check the quantities.',
    path: `${name}/SKILL.md`,
    body,
    bytes: Buffer.byteLength(body),
    sha256: digest(body),
  }
}
function bundle(version = '1', names = ['recipe-check']): PluginSkillBundle {
  return {
    pluginId: 'recipe-kit',
    packageVersion: version,
    packageSha256: digest(`fictional-package-${version}`),
    skills: names.map((name) => ({ ...draft(name), version: '1' })),
  }
}
function refused(action: () => unknown, code: string) {
  let failure: unknown
  try {
    action()
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(SkillCatalogueError)
  expect(failure).toHaveProperty('code', code)
}
let folder: string, db: AppDatabase, catalogue: SqliteSkillCatalogue
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'fictional-skills-'))
  db = openDatabase(join(folder, 'catalogue.sqlite'))
  applyMigrations(db, migrations)
  db.prepare('INSERT INTO agent_identity (id, slug, created_at) VALUES (?, ?, ?)').run(
    'aid:recipe-worker',
    'recipe-worker',
    1,
  )
  catalogue = new SqliteSkillCatalogue(db, shipped(), () => 1234)
})
afterEach(() => {
  db.close()
  rmSync(folder, { recursive: true, force: true })
})
const revision = () => catalogue.list().revision
const capable = { canCreateAgents: true, isCoordinator: false }

describe('the SQLite skills catalogue', () => {
  it('seeds exactly the eight shipped v24 files and preserves the source bytes', () => {
    expect(catalogue.list()).toMatchObject({ total: 8, revision: 1 })
    expect(
      catalogue
        .list()
        .items.map((one) => one.name)
        .sort(),
    ).toEqual([...BUILT_IN_SKILL_NAMES].sort())
    for (const name of BUILT_IN_SKILL_NAMES) {
      const detail = catalogue.detail(`built-in/${name}`)!
      expect(detail).toMatchObject({
        version: 'v24',
        active: true,
        defaultEnabled: true,
        alias: name,
      })
      expect(detail.body).toBe(shipped().bodies.get(name))
      expect(digest(detail.body)).toBe(detail.sha256)
    }
    new SqliteSkillCatalogue(db, shipped())
    expect(revision()).toBe(1)
  })
  it('keeps an omitted built-in source and choice, but never offers it as ready', () => {
    const legacy = draft('recipe-check')
    const id = `built-in/${legacy.name}`
    const version = 'v22'
    const versionId = `${id}@${digest(version)}`
    const { body, ...declared } = legacy
    const stored = {
      ...declared,
      version,
      origin: { kind: 'built-in' },
      alias: legacy.name,
      requirement: null,
    }
    db.prepare(
      'INSERT INTO skill_version (id, skill_id, version_key, metadata, body, sha256, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(versionId, id, version, JSON.stringify(stored), body, legacy.sha256, legacy.bytes, 1)
    db.prepare(
      'INSERT INTO skill_current (id, alias, current_version, active) VALUES (?, ?, ?, 1)',
    ).run(id, legacy.name, versionId)
    catalogue.select('aid:recipe-worker', id, 'on', revision())
    expect(
      catalogue.resolve('aid:recipe-worker', capable).choices.find((one) => one.skill.id === id),
    ).toMatchObject({ ready: true, selection: 'on' })
    const before = revision()
    catalogue = new SqliteSkillCatalogue(db, shipped())
    expect(revision()).toBe(before + 1)
    expect(catalogue.detail(id, versionId)).toMatchObject({ body, active: false, versionId })
    expect(
      catalogue.resolve('aid:recipe-worker', capable).choices.find((one) => one.skill.id === id),
    ).toMatchObject({ ready: false, selected: true, selection: 'on', reason: 'source-unavailable' })
    new SqliteSkillCatalogue(db, shipped())
    expect(revision()).toBe(before + 1)
    expect(db.prepare('SELECT choice FROM skill_selection WHERE skill_id = ?').get(id)).toEqual({
      choice: 'on',
    })
    expect(
      db.prepare('SELECT count(*) AS n FROM skill_version WHERE skill_id = ?').get(id),
    ).toEqual({ n: 1 })
  })
  it.each(['on', 'off'] as const)(
    'reactivates a returning built-in with its %s choice and history intact',
    (choice) => {
      const id = 'built-in/delegate'
      const first = catalogue.detail(id)!
      catalogue.select('aid:recipe-worker', id, choice, revision())
      // The saved workspace has the unavailable head left by a build that omitted this source.
      db.prepare('UPDATE skill_current SET active = 0 WHERE id = ?').run(id)
      expect(
        catalogue.resolve('aid:recipe-worker', capable).choices.find((one) => one.skill.id === id),
      ).toMatchObject({ ready: false, selection: choice, reason: 'source-unavailable' })
      const returning = shipped()
      const next = verifyBuiltInSkills({ ...returning.catalogue, version: 'v24' }, returning.bodies)
      catalogue = new SqliteSkillCatalogue(db, next)
      expect(catalogue.detail(id)).toMatchObject({ active: true, version: 'v24', body: first.body })
      expect(catalogue.detail(id, first.versionId)?.body).toBe(first.body)
      expect(
        catalogue.resolve('aid:recipe-worker', capable).choices.find((one) => one.skill.id === id),
      ).toMatchObject({ ready: choice === 'on', selection: choice, reason: null })
      db.close()
      db = openDatabase(join(folder, 'catalogue.sqlite'))
      catalogue = new SqliteSkillCatalogue(db, next)
      expect(
        catalogue.resolve('aid:recipe-worker', capable).choices.find((one) => one.skill.id === id),
      ).toMatchObject({ ready: choice === 'on', selection: choice, reason: null })
    },
  )
  it('separates saved choices, grant eligibility and an explicitly empty selection', () => {
    const plain = catalogue.resolve('aid:recipe-worker', {
      canCreateAgents: false,
      isCoordinator: false,
    })
    expect(plain.choices.filter((one) => one.ready)).toHaveLength(6)
    expect(
      catalogue
        .resolve('aid:recipe-worker', { canCreateAgents: false, isCoordinator: true })
        .choices.filter((one) => one.ready),
    ).toHaveLength(7)
    expect(
      catalogue.resolve('aid:recipe-worker', capable).choices.filter((one) => one.ready),
    ).toHaveLength(8)
    for (const item of catalogue.list().items)
      catalogue.select('aid:recipe-worker', item.id, 'off', revision())
    expect(
      catalogue.resolve('aid:recipe-worker', capable).choices.filter((one) => one.ready),
    ).toEqual([])
    refused(() => catalogue.resolve('missing', capable), 'identity')
  })
  it('starts personal skills off, refuses duplicate Add, and edits without losing choices/history', () => {
    catalogue.savePersonal(draft(), revision())
    const first = catalogue.detail('person/recipe-check')!
    expect(first.defaultEnabled).toBe(false)
    expect(
      catalogue
        .resolve('aid:recipe-worker', capable)
        .choices.find((one) => one.skill.id === first.id),
    ).toMatchObject({ selection: 'default', selected: false, ready: false })
    catalogue.select('aid:recipe-worker', first.id, 'on', revision())
    refused(() => catalogue.savePersonal(draft(), revision()), 'duplicate-name')
    catalogue.savePersonal(
      draft('recipe-check', 'Use a second fictional method.'),
      revision(),
      first.versionId,
    )
    const second = catalogue.detail(first.id)!
    expect(second.version).toBe('v2')
    expect(second.alias).toBe(first.alias)
    expect(catalogue.detail(first.id, first.versionId)?.body).toBe(first.body)
    expect(
      catalogue
        .resolve('aid:recipe-worker', capable)
        .choices.find((one) => one.skill.id === first.id)?.ready,
    ).toBe(true)
    refused(() => catalogue.savePersonal(draft(), revision(), first.versionId), 'stale')
    db.prepare('UPDATE agent_identity SET display_name = ? WHERE id = ?').run(
      'Recipe reviewer',
      'aid:recipe-worker',
    )
    db.close()
    db = openDatabase(join(folder, 'catalogue.sqlite'))
    catalogue = new SqliteSkillCatalogue(db, shipped())
    expect(
      catalogue
        .resolve('aid:recipe-worker', capable)
        .choices.find((one) => one.skill.id === first.id),
    ).toMatchObject({ selection: 'on', ready: true })
    expect(catalogue.detail(first.id)?.body).toBe(second.body)
  })
  it('a shipped update keeps explicit off choices and both text versions', () => {
    catalogue.select('aid:recipe-worker', 'built-in/delegate', 'off', revision())
    const previous = catalogue.detail('built-in/delegate')!
    const next = shipped()
    next.catalogue.version = 'v24'
    const verified = verifyBuiltInSkills(next.catalogue, next.bodies)
    catalogue.seedBuiltins(verified)
    const stableRevision = revision()
    new SqliteSkillCatalogue(db, verified)
    expect(revision()).toBe(stableRevision)
    expect(catalogue.detail('built-in/delegate')?.version).toBe('v24')
    expect(catalogue.detail('built-in/delegate', previous.versionId)?.body).toBe(previous.body)
    expect(
      catalogue
        .resolve('aid:recipe-worker', capable)
        .choices.find((one) => one.skill.id === previous.id),
    ).toMatchObject({ selection: 'off', ready: false })
  })
  it.each([
    ['path', { path: '../recipe-check/SKILL.md' }],
    ['path', { path: 'other/SKILL.md' }],
    ['size', { bytes: 65537 }],
    ['size', { bytes: 1 }],
    ['hash', { sha256: '0'.repeat(64) }],
    [
      'frontmatter',
      (() => {
        const body = '---\nname: wrong\ndescription: Check a fictional recipe.\n---\nText'
        return { body, bytes: Buffer.byteLength(body), sha256: digest(body) }
      })(),
    ],
  ] as const)('refuses %s without changing the catalogue', (code, over) => {
    const before = catalogue.list()
    refused(() => catalogue.savePersonal({ ...draft(), ...over }, before.revision), code)
    expect(catalogue.list()).toEqual(before)
  })
  it('refuses built-in shadowing and stale edits', () => {
    refused(() => catalogue.savePersonal(draft('delegate'), revision()), 'duplicate-name')
    const stale = revision()
    catalogue.savePersonal(draft(), stale)
    refused(
      () => catalogue.select('aid:recipe-worker', 'person/recipe-check', 'on', stale),
      'stale',
    )
    expect(
      catalogue
        .resolve('aid:recipe-worker', capable)
        .choices.find((one) => one.skill.id === 'person/recipe-check')?.selected,
    ).toBe(false)
  })
  it('ingests inert pinned plugin skills, revokes without erasure, and never regrants on reinstall', () => {
    catalogue.ingestPlugin(bundle(), revision())
    const first = catalogue.detail('plugin/recipe-kit/recipe-check')!
    expect(first).toMatchObject({
      defaultEnabled: false,
      active: true,
      package: { version: '1', sha256: bundle().packageSha256 },
    })
    expect(first.alias).not.toBe(skillAlias({ kind: 'person' }, 'recipe-check'))
    catalogue.select('aid:recipe-worker', first.id, 'on', revision())
    catalogue.ingestPlugin(bundle('2'), revision())
    expect(
      catalogue
        .resolve('aid:recipe-worker', capable)
        .choices.find((one) => one.skill.id === first.id)?.ready,
    ).toBe(true)
    catalogue.revokePlugin('recipe-kit', revision())
    expect(catalogue.detail(first.id)?.active).toBe(false)
    expect(catalogue.detail(first.id, first.versionId)?.body).toBe(first.body)
    refused(
      () => catalogue.select('aid:recipe-worker', first.id, 'on', revision()),
      'source-unavailable',
    )
    catalogue.ingestPlugin(bundle('2'), revision())
    expect(
      catalogue
        .resolve('aid:recipe-worker', capable)
        .choices.find((one) => one.skill.id === first.id),
    ).toMatchObject({ selection: 'off', ready: false })
  })
  it('pins a whole plugin package, handles omissions and rolls back failed multi-skill ingestion', () => {
    const first = bundle('1', ['first-check', 'second-check'])
    catalogue.ingestPlugin(first, revision())
    const pinnedRevision = revision()
    catalogue.ingestPlugin({ ...first, skills: [...first.skills].reverse() }, pinnedRevision)
    expect(revision()).toBe(pinnedRevision)
    catalogue.select('aid:recipe-worker', 'plugin/recipe-kit/second-check', 'on', revision())
    const before = catalogue.list()
    refused(
      () => catalogue.ingestPlugin({ ...first, packageSha256: 'a'.repeat(64) }, revision()),
      'version-conflict',
    )
    refused(
      () => catalogue.ingestPlugin(bundle('1', ['first-check']), revision()),
      'version-conflict',
    )
    expect(catalogue.list()).toEqual(before)
    catalogue.ingestPlugin(bundle('2', ['first-check']), revision())
    expect(
      catalogue
        .resolve('aid:recipe-worker', capable)
        .choices.find((one) => one.skill.id.endsWith('/second-check')),
    ).toMatchObject({ selection: 'off', eligible: false, ready: false })
    const stable = catalogue.list()
    db.exec(
      "CREATE TEMP TRIGGER fictional_skill_failure BEFORE INSERT ON skill_version WHEN NEW.skill_id = 'plugin/recipe-kit/third-check' BEGIN SELECT RAISE(ABORT, 'fictional interruption'); END",
    )
    expect(() =>
      catalogue.ingestPlugin(bundle('3', ['first-check', 'third-check']), revision()),
    ).toThrow('fictional interruption')
    expect(catalogue.list()).toEqual(stable)
    expect(
      db
        .prepare(
          "SELECT count(*) AS n FROM skill_version WHERE plugin_id = 'recipe-kit' AND package_version = '3'",
        )
        .get(),
    ).toEqual({ n: 0 })
  })
  it('two SQLite clients cannot save over each other with an old revision', () => {
    const secondDb = openDatabase(join(folder, 'catalogue.sqlite'))
    try {
      const second = new SqliteSkillCatalogue(secondDb, shipped())
      const was = revision()
      second.savePersonal(draft(), was)
      refused(() => catalogue.savePersonal(draft('other-check'), was), 'stale')
      expect(catalogue.detail('person/other-check')).toBeNull()
      expect(catalogue.detail('person/recipe-check')).not.toBeNull()
    } finally {
      secondDb.close()
    }
  })
  it('refuses a bad plugin hash or duplicate declaration before publication', () => {
    const before = catalogue.list()
    const bad = bundle('1', ['first-check', 'second-check'])
    bad.skills[1]!.sha256 = '0'.repeat(64)
    refused(() => catalogue.ingestPlugin(bad, before.revision), 'hash')
    refused(
      () => catalogue.ingestPlugin(bundle('1', ['first-check', 'first-check']), before.revision),
      'duplicate-name',
    )
    expect(catalogue.list()).toEqual(before)
  })
  it('refuses a selection beyond the complete-view bound and rolls the choice back', () => {
    for (let i = 0; i < 56; i++) {
      const item = draft(`recipe-${i}`)
      catalogue.savePersonal(item, revision())
      catalogue.select('aid:recipe-worker', `person/${item.name}`, 'on', revision())
    }
    expect(
      catalogue.resolve('aid:recipe-worker', capable).choices.filter((one) => one.ready),
    ).toHaveLength(64)
    catalogue.savePersonal(draft('one-more'), revision())
    const was = revision()
    refused(() => catalogue.select('aid:recipe-worker', 'person/one-more', 'on', was), 'limit')
    expect(revision()).toBe(was)
    expect(
      catalogue
        .resolve('aid:recipe-worker', capable)
        .choices.find((one) => one.skill.id === 'person/one-more')?.selection,
    ).toBe('default')
  })
  it('keeps versions immutable and reads only bounded metadata on the list path', () => {
    catalogue.savePersonal(draft(), revision())
    const personal = catalogue.detail('person/recipe-check')!
    expect(() =>
      db
        .prepare('UPDATE skill_version SET body = ? WHERE id = ?')
        .run('changed', personal.versionId),
    ).toThrow('immutable')
    expect(() =>
      db.prepare('DELETE FROM skill_version WHERE id = ?').run(personal.versionId),
    ).toThrow('immutable')
    expect(catalogue.list(0, 2).items).toHaveLength(2)
    expect(catalogue.list(2, 50).items).toHaveLength(7)
    expect(catalogue.list().items[0]).not.toHaveProperty('body')
    refused(() => catalogue.list(0, 51), 'limit')
    expect(catalogue.detail('missing')).toBeNull()
  })
})
