import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { SqliteSkillCatalogue, skillAlias } from '../src/main/skills/catalogue-store'
import { readBuiltInSkills, prepareBuiltInSkills } from '../src/main/skills/prepare-built-in-skills'
import { launchSkillSelections } from '../src/main/skills/launch-selection'
import { selectedSkillView } from '../src/main/skills/selected-skill-view'
import { verifyBuiltInSkills, creationAllowedSkills } from '../src/main/skills/built-in-catalogue'
import {
  registerCodexBuiltInSkills,
  verifyClaudeBuiltInSkills,
  validateBuiltInSkills,
} from '../../../packages/runtime/src/built-in-skills'
import type { SkillDetail, SkillGrants } from '../src/shared/skills-catalogue'

const resources = resolve(import.meta.dirname, '../resources/built-in-skills')
const migrations = resolve(import.meta.dirname, '../src/main/db/migrations')
const shipped = () => readBuiltInSkills(resources)
const hash = (body: string) => createHash('sha256').update(body).digest('hex')
const id = 'aid:recipe-writer'
const grants = { canCreateAgents: true, isCoordinator: false }
function draft(
  name: string,
  text = 'Check the fictional recipe.',
  description = 'Check a fictional recipe.',
) {
  const body = `---\r\nname: ${name}\r\ndescription: ${description}\r\n---\r\n\r\n${text}\r\n`
  return {
    name,
    description,
    body,
    reminder: 'Check quantities.',
    path: `${name}/SKILL.md`,
    bytes: Buffer.byteLength(body),
    sha256: hash(body),
  }
}
let root: string, home: string, db: AppDatabase, catalogue: SqliteSkillCatalogue
let select: ReturnType<typeof launchSkillSelections>
beforeEach(() => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'fictional-selected-skills-'))
  home = join(root, 'homes', 'recipe-writer')
  mkdirSync(home, { recursive: true, mode: 0o700 })
  db = openDatabase(join(root, 'catalogue.sqlite'))
  applyMigrations(db, migrations)
  db.prepare('INSERT INTO agent_identity (id, slug, created_at) VALUES (?, ?, ?)').run(
    id,
    'recipe-writer',
    1,
  )
  catalogue = new SqliteSkillCatalogue(db, shipped())
  select = launchSkillSelections(db, shipped)
})
afterEach(() => {
  db.close()
  rmSync(root, { recursive: true, force: true })
})
const revision = () => catalogue.list().revision
function add(name: string) {
  catalogue.savePersonal(draft(name), revision())
  catalogue.select(id, `person/${name}`, 'on', revision())
}

describe.each(['claude', 'codex'] as const)(
  'the selected %s launch view in a fictional home',
  (provider) => {
    function prepare(currentGrants: SkillGrants = grants, current?: () => boolean) {
      const selection = select('recipe-writer', currentGrants)
      return prepareBuiltInSkills({
        provider,
        managedRoot: root,
        providerHome: home,
        shipped,
        ...currentGrants,
        selection,
        isCurrent: () => selection.isCurrent() && (current?.() ?? true),
      })
    }
    it.each([
      { canCreateAgents: false, isCoordinator: false },
      { canCreateAgents: false, isCoordinator: true },
      grants,
    ])(
      'keeps unchanged defaults for $canCreateAgents creation and $isCoordinator coordination',
      async (currentGrants) => {
        const legacy = await prepareBuiltInSkills({
          provider,
          managedRoot: root,
          providerHome: home,
          shipped,
          ...currentGrants,
          isCurrent: () => true,
        })
        const selected = await prepare(currentGrants)
        expect(selected.context.skills.map((one) => [one.name, one.description])).toEqual(
          legacy.context.skills.map((one) => [one.name, one.description]),
        )
        expect(selected.reminder).toBe(legacy.reminder)
        for (const [index, item] of selected.context.skills.entries()) {
          const old = legacy.context.skills[index]
          if (!old) throw new Error('Missing fictional launch entry')
          expect(readFileSync(item.path, 'utf8')).toBe(readFileSync(old.path, 'utf8'))
        }
        expect(selected.context.skills.map((one) => one.name.replace(/^brobot:/, ''))).toEqual(
          creationAllowedSkills(
            shipped().catalogue,
            currentGrants.canCreateAgents,
            currentGrants.isCoordinator,
          ).map((one) => one.name),
        )
        expect(selected.versions).toHaveLength(legacy.context.skills.length)
      },
    )
    it('publishes an existing empty discovery root and verifies exactly zero owned skills', async () => {
      for (const skill of catalogue.list().items) catalogue.select(id, skill.id, 'off', revision())
      const prepared = await prepare()
      expect(prepared.context.skills).toEqual([])
      expect(prepared.reminder).toBe('')
      expect(prepared.versions).toEqual([])
      expect(existsSync(prepared.context.root)).toBe(true)
      if (provider === 'claude') {
        expect(readdirSync(prepared.context.root)).toEqual(['.claude-plugin'])
        expect(() =>
          verifyClaudeBuiltInSkills(
            { plugins: [{ name: 'brobot', path: prepared.context.root }], skills: [] },
            prepared.context,
          ),
        ).not.toThrow()
      } else {
        expect(readdirSync(prepared.context.root)).toEqual([])
        const methods: string[] = []
        await expect(
          registerCodexBuiltInSkills(prepared.context, root, async (method) => {
            methods.push(method)
            return method === 'skills/list' ? { data: [{ cwd: root, skills: [], errors: [] }] } : {}
          }),
        ).resolves.toBeUndefined()
        expect(methods).toEqual(['skills/extraRoots/set', 'skills/list'])
      }
    })
    it('installs more than eight personal/plugin versions under aliases, without editing their sources', async () => {
      for (const name of ['crumb-check', 'oven-check', 'flour-check']) add(name)
      const plugin = {
        pluginId: 'recipe-kit',
        packageVersion: '1',
        packageSha256: hash('fictional package'),
        skills: [{ ...draft('timing-check'), version: '1' }],
      }
      catalogue.ingestPlugin(plugin, revision())
      catalogue.select(id, 'plugin/recipe-kit/timing-check', 'on', revision())
      const first = await prepare()
      expect(first.context.skills).toHaveLength(12)
      for (const version of first.versions ?? []) {
        const source = catalogue.detail(version.id, version.versionId)
        const installed = first.context.skills.find(
          (one) => one.name === `${provider === 'claude' ? 'brobot:' : ''}${version.alias}`,
        )
        if (!source || !installed) throw new Error('Missing fictional skill')
        const body = readFileSync(installed.path, 'utf8')
        expect(body).toContain(`name: ${version.alias}`)
        expect(hash(body)).toBe(version.sha256)
        expect(hash(source.body)).toBe(version.sourceSha256)
        expect(catalogue.detail(version.id, version.versionId)?.body).toBe(source.body)
      }
      const source = catalogue.detail('person/crumb-check')!
      const original = first.context.skills.find((one) => one.name.endsWith(source.alias))!
      const before = readFileSync(original.path, 'utf8')
      catalogue.savePersonal(
        draft('crumb-check', 'A second fictional recipe.'),
        revision(),
        source.versionId,
      )
      const resumed = await prepare()
      expect(readFileSync(original.path, 'utf8')).toBe(before)
      expect(resumed.context.root).not.toBe(first.context.root)
      const next = resumed.context.skills.find((one) => one.name.endsWith(source.alias))!
      expect(readFileSync(next.path, 'utf8')).toContain('A second fictional recipe.')
      expect(resumed.versions?.find((one) => one.id === source.id)?.version).toBe('v2')
      const names = resumed.context.skills.map((one) => one.name)
      if (provider === 'claude')
        expect(() =>
          verifyClaudeBuiltInSkills(
            { plugins: [{ name: 'brobot', path: resumed.context.root }], skills: names },
            resumed.context,
          ),
        ).not.toThrow()
      else
        await expect(
          registerCodexBuiltInSkills(resumed.context, root, async (method) =>
            method === 'skills/list'
              ? {
                  data: [
                    {
                      cwd: root,
                      skills: resumed.context.skills.map((one) => ({ ...one, enabled: true })),
                      errors: [],
                    },
                  ],
                }
              : {},
          ),
        ).resolves.toBeUndefined()
    })
    it.each(['person', 'plugin'] as const)(
      'quotes native %s descriptions without changing the source',
      async (origin) => {
        for (const [index, description] of [
          'Recipe: "one" # note, \\pan, $&',
          'Recipe\u0085one\u2028two\u2029three',
          '\u0001'.repeat(500),
          'Recipe\u007fone',
          'Recipe\u009bone',
        ].entries()) {
          const name = `quoted-recipe-${index}`
          const source = draft(name, 'Check the fictional recipe.', description)
          if (index === 2) {
            source.body += '.'.repeat(65_536 - source.bytes)
            source.bytes = Buffer.byteLength(source.body)
            source.sha256 = hash(source.body)
          }
          if (origin === 'person') catalogue.savePersonal(source, revision())
          else
            catalogue.ingestPlugin(
              {
                pluginId: `recipe-kit-${index}`,
                packageVersion: '1',
                packageSha256: hash('fictional recipe package'),
                skills: [{ ...source, version: '1' }],
              },
              revision(),
            )
          const skillId =
            origin === 'person' ? `person/${name}` : `plugin/recipe-kit-${index}/${name}`
          catalogue.select(id, skillId, 'on', revision())
          const prepared = await prepare()
          const version = prepared.versions?.find((one) => one.id === skillId)
          const installed = prepared.context.skills.find((one) =>
            one.name.endsWith(version?.alias ?? '!'),
          )
          if (!version || !installed) throw new Error('Missing fictional quoted skill')
          const body = readFileSync(installed.path, 'utf8')
          const scalar = /^description: ([^\r\n]+)/m.exec(body)?.[1]
          if (!scalar) throw new Error('Missing fictional description')
          expect(scalar.startsWith('"')).toBe(true)
          expect(scalar).not.toMatch(/[\u007f-\u009f\u2028\u2029]/)
          for (const character of ['\u007f', '\u009b'])
            if (description.includes(character))
              expect(scalar).toContain(
                `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
              )
          expect(JSON.parse(scalar)).toBe(description)
          expect(installed.description).toBe(description)
          expect(body.slice(body.indexOf('\r\n---\r\n') + 7)).toBe(
            source.body.slice(source.body.indexOf('\r\n---\r\n') + 7),
          )
          expect(catalogue.detail(skillId)?.body).toBe(source.body)
          expect(version.sourceSha256).toBe(source.sha256)
          expect(version.sha256).toBe(hash(body))
          if (index === 2) expect(version.bytes).toBeGreaterThan(65_600)
        }
      },
    )
    it.each(['revision', 'grant', 'cancel'] as const)(
      'does not publish after a mid-write %s change',
      async (change) => {
        const selection = select('recipe-writer', grants)
        let checks = 0,
          current = true
        const isCurrent = () => {
          if (++checks === 20) {
            if (change === 'revision') catalogue.select(id, 'built-in/remember', 'off', revision())
            else current = false
          }
          return current && selection.isCurrent()
        }
        await expect(
          prepareBuiltInSkills({
            provider,
            managedRoot: root,
            providerHome: home,
            shipped,
            ...grants,
            selection,
            isCurrent,
          }),
        ).rejects.toThrow('Nothing was overwritten.')
        expect(checks).toBeGreaterThanOrEqual(20)
        expect(catalogue.detail('built-in/remember')?.body).toBe(shipped().bodies.get('remember'))
      },
    )
    it('refuses a stale empty selection before allocating a new view', async () => {
      for (const skill of catalogue.list().items) catalogue.select(id, skill.id, 'off', revision())
      const selection = select('recipe-writer', grants)
      catalogue.select(id, 'built-in/remember', 'on', revision())
      const before = readdirSync(home)
      await expect(
        prepareBuiltInSkills({
          provider,
          managedRoot: root,
          providerHome: home,
          shipped,
          ...grants,
          selection,
          isCurrent: selection.isCurrent,
        }),
      ).rejects.toThrow()
      expect(readdirSync(home)).toEqual(before)
    })
    it('keeps a text-pack override out of saved sources and selections', async () => {
      add('crumb-check')
      const source = shipped()
      const bodies = new Map(source.bodies)
      const delegate = bodies.get('delegate')! + '\nA fictional newer line.\n'
      bodies.set('delegate', delegate)
      const pack = verifyBuiltInSkills(
        {
          ...source.catalogue,
          version: 'v99',
          skills: source.catalogue.skills.map((one) =>
            one.name === 'delegate'
              ? { ...one, sha256: hash(delegate), bytes: Buffer.byteLength(delegate) }
              : one,
          ),
        },
        bodies,
      )
      const selection = select('recipe-writer', grants)
      const prepared = await prepareBuiltInSkills({
        provider,
        managedRoot: root,
        providerHome: home,
        shipped,
        skills: pack,
        ...grants,
        selection,
        isCurrent: selection.isCurrent,
      })
      expect(prepared.version).toBe('v99')
      expect(
        prepared.versions
          ?.filter((one) => one.id.startsWith('built-in/'))
          .every(
            (one) =>
              one.version === 'v24' &&
              one.textPackVersion === 'v99' &&
              one.textPackDigest === pack.digest,
          ),
      ).toBe(true)
      expect(
        prepared.versions?.find((one) => one.id === 'person/crumb-check')?.textPackDigest,
      ).toBeUndefined()
      const projected = prepared.versions?.find((one) => one.id === 'built-in/delegate')
      expect(projected?.sourceSha256).toBe(
        source.catalogue.skills.find((one) => one.name === 'delegate')?.sha256,
      )
      expect(projected?.textPackSourceSha256).toBe(hash(delegate))
      expect(projected?.sourceSha256).not.toBe(projected?.textPackSourceSha256)
      expect(catalogue.detail('built-in/delegate')?.version).toBe('v24')
      expect((await prepare()).version).toBe('v24')
    })
  },
)
it('keeps new/anonymous defaults grant-limited and detects a newly replaced identity', () => {
  for (const name of ['new-recipe-writer', null]) {
    const selection = select(name, { canCreateAgents: false, isCoordinator: false })
    expect(selection.skills).toHaveLength(6)
    expect(
      selection.skills.some(
        (one) => one.name === 'build-a-team' || one.name === 'add-a-capability',
      ),
    ).toBe(false)
    expect(selection.isCurrent()).toBe(true)
  }
  const selection = select('new-recipe-writer', grants)
  db.prepare('INSERT INTO agent_identity (id, slug, created_at) VALUES (?, ?, ?)').run(
    'aid:new-recipe-writer',
    'new-recipe-writer',
    1,
  )
  expect(selection.isCurrent()).toBe(false)
})
it('refuses duplicate aliases, changed source bytes, unavailable sources and overfull views', () => {
  const source = catalogue.detail('built-in/delegate')!
  for (const skills of [
    [source, source],
    [{ ...source, alias: '../elsewhere' }],
    [{ ...source, body: source.body + 'x' }],
    [{ ...source, active: false }],
    Array(65).fill(source),
  ])
    expect(() => selectedSkillView('codex', skills, shipped())).toThrow()
})

function personalSource(index: number, maximum = false): SkillDetail {
  const name = `recipe-${index}`
  const value = draft(name)
  if (maximum) {
    value.body += '.'.repeat(65_536 - value.bytes)
    value.bytes = Buffer.byteLength(value.body)
    value.sha256 = hash(value.body)
  }
  const id = `person/${name}`
  return {
    ...value,
    id,
    versionId: `${id}@${hash('v1')}`,
    version: 'v1',
    origin: { kind: 'person' },
    alias: skillAlias({ kind: 'person' }, name),
    createdAt: 1,
    active: true,
    defaultEnabled: false,
    requirement: null,
    package: null,
  }
}
it.each(['claude', 'codex'] as const)(
  'supports exactly64 %s skills and refuses65 before writing a view',
  async (provider) => {
    const skills = Array.from({ length: 64 }, (_, index) => personalSource(index))
    const prepared = await prepareBuiltInSkills({
      provider,
      managedRoot: root,
      providerHome: home,
      shipped,
      ...grants,
      selection: { revision: 1, skills },
      isCurrent: () => true,
    })
    expect(prepared.context.skills).toHaveLength(64)
    expect(prepared.versions).toHaveLength(64)
    expect(() => validateBuiltInSkills(prepared.context, provider)).not.toThrow()
    const extra = {
      name: `${provider === 'claude' ? 'brobot:' : ''}personal-extra`,
      description: 'A fictional extra skill.',
      path: join(
        prepared.context.root,
        provider === 'claude' ? 'skills' : '',
        'personal-extra',
        'SKILL.md',
      ),
    }
    expect(() =>
      validateBuiltInSkills(
        { ...prepared.context, skills: [...prepared.context.skills, extra] },
        provider,
      ),
    ).toThrow()
    const before = readdirSync(home)
    await expect(
      prepareBuiltInSkills({
        provider,
        managedRoot: root,
        providerHome: home,
        shipped,
        ...grants,
        selection: { revision: 1, skills: [...skills, personalSource(64)] },
        isCurrent: () => true,
      }),
    ).rejects.toThrow()
    expect(readdirSync(home)).toEqual(before)
  },
)
it('enforces the actual projected byte bound, including alias expansion', () => {
  const skills = Array.from({ length: 64 }, (_, index) => personalSource(index, true))
  expect(skills.reduce((sum, one) => sum + one.bytes, 0)).toBe(4 * 1024 * 1024)
  expect(() => selectedSkillView('codex', skills, shipped())).toThrow('view bound')
})

it('the shared-folder flow keeps every app-owned built-in without per-agent choices', async () => {
  const prepared = await prepareBuiltInSkills({
    provider: 'codex',
    providerHome: home,
    managedRoot: root,
    shipped,
    canCreateAgents: false,
    isCoordinator: false,
    allShipped: true,
    isCurrent: () => true,
  })
  expect(prepared.context.skills).toHaveLength(8)
})
