import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { verifyBuiltInSkills } from '../src/main/skills/built-in-catalogue'
import { copySkillFile, skillsWindowService } from '../src/main/skills/window-service'
import { BUILT_IN_SKILL_NAMES } from '../src/shared/built-in-skills'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { RuntimeHost, RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { SkillsReply, SkillsRequest, SkillsWindow } from '../src/shared/skills-window'

const here = dirname(fileURLToPath(import.meta.url))
const resources = join(here, '../resources/built-in-skills')
const shipped = () =>
  verifyBuiltInSkills(
    JSON.parse(readFileSync(join(resources, 'manifest.json'), 'utf8')),
    new Map(
      BUILT_IN_SKILL_NAMES.map((name) => [
        name,
        readFileSync(join(resources, name, 'SKILL.md'), 'utf8'),
      ]),
    ),
  )
let folder: string, db: AppDatabase, bridge: SkillsWindow
const source =
  '---\r\nname: recipe-check\r\ndescription: Check a fictional recipe.\r\n---\r\n\r\n# Recipe\r\nCheck the flour.\r\n'
const draft = {
  name: 'recipe-check',
  description: 'Check a fictional recipe.',
  reminder: 'Check quantities.',
  body: source,
}
const choose = vi.fn<() => Promise<string | null>>()
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'fictional-skills-window-'))
  db = openDatabase(join(folder, 'workspace.sqlite'))
  applyMigrations(db, join(here, '../src/main/db/migrations'))
  db.prepare(
    "INSERT INTO agent_identity (id, slug, created_at) VALUES ('aid:recipe-reviewer', 'recipe-reviewer', 1)",
  ).run()
  choose.mockReset().mockResolvedValue(null)
  bridge = skillsWindowService({ db, shipped, choose, canCreateAgents: () => false })
})
afterEach(() => {
  db.close()
  rmSync(folder, { recursive: true, force: true })
})
function sink(person: boolean): RuntimeEventSink {
  return {
    ownerId: person ? 'webContents:fictional' : 'agent:fictional',
    alive: true,
    aPersonIsBehindIt: person,
    send: () => {},
    sendLiveness: () => {},
  }
}
function host(run = bridge): RuntimeHost {
  return { closing: false, skillsForAPerson: run } as unknown as RuntimeHost
}
async function page() {
  const answer = await bridge({ operation: 'list', offset: 0 })
  if (answer.operation !== 'list') throw new Error('missing catalogue')
  return answer.page
}

it('initializes lazily and publishes a personal version only through the person IPC', async () => {
  expect(db.prepare('SELECT * FROM skill_current').all()).toEqual([])
  const initial = await page()
  expect(initial.total).toBe(8)
  const answer = (await executeRuntimeCommand(host(), sink(true), {
    kind: 'skills',
    request: { operation: 'save', draft, revision: initial.revision, versionId: null },
  })) as SkillsReply
  expect(answer).toMatchObject({ operation: 'save', revision: initial.revision + 1 })
  expect(await bridge({ operation: 'choices', identityId: 'aid:recipe-reviewer' })).toMatchObject({
    operation: 'choices',
    reading: {
      choices: expect.arrayContaining([
        expect.objectContaining({
          skill: expect.objectContaining({ id: 'person/recipe-check' }),
          selected: false,
          ready: false,
        }),
      ]),
    },
  })
  const detail = await bridge({ operation: 'detail', id: 'person/recipe-check' })
  if (detail.operation !== 'detail' || !detail.skill) throw new Error('missing text')
  expect(detail.skill.body).toBe(source)
  const stamp = (await page()).revision
  const edited = await bridge({
    operation: 'save',
    draft: { ...draft, reminder: 'Check the recipe twice.' },
    revision: stamp,
    versionId: detail.skill.versionId,
  })
  expect(edited.operation).toBe('save')
  expect(await bridge({ operation: 'detail', id: 'person/recipe-check' })).toMatchObject({
    operation: 'detail',
    skill: { version: 'v2' },
  })
  expect(
    db
      .prepare("SELECT count(*) AS n FROM skill_version WHERE skill_id = 'person/recipe-check'")
      .get(),
  ).toEqual({ n: 2 })
})

it.each<SkillsRequest>([
  { operation: 'list', offset: 0 },
  { operation: 'detail', id: 'person/recipe-check' },
  { operation: 'choices', identityId: 'aid:recipe-reviewer' },
  { operation: 'import' },
  { operation: 'save', draft, revision: 0, versionId: null },
  {
    operation: 'select',
    identityId: 'aid:recipe-reviewer',
    id: 'built-in/remember',
    revision: 0,
    selection: 'off',
  },
])(
  'refuses a non-person before the %j operation can touch storage or the picker',
  async (request) => {
    const run = vi.fn(bridge)
    await expect(
      executeRuntimeCommand(host(run), sink(false), { kind: 'skills', request }),
    ).rejects.toThrow('unless a person is asking')
    expect(run).not.toHaveBeenCalled()
    expect(choose).not.toHaveBeenCalled()
    expect(db.prepare('SELECT * FROM skill_current').all()).toEqual([])
  },
)

it('refuses writes and imports during quit before calling the service', async () => {
  const run = vi.fn(bridge)
  const quitting = { closing: true, skillsForAPerson: run } as unknown as RuntimeHost
  await expect(
    executeRuntimeCommand(quitting, sink(true), {
      kind: 'skills',
      request: { operation: 'import' },
    }),
  ).rejects.toThrow()
  expect(run).not.toHaveBeenCalled()
})

it('copies exactly one chosen file, never watches it or changes the source', async () => {
  const path = join(folder, 'SKILL.md')
  writeFileSync(path, source)
  choose.mockResolvedValue(path)
  const result = await bridge({ operation: 'import' })
  expect(result).toEqual({
    operation: 'import',
    skill: { name: draft.name, description: draft.description, body: source },
  })
  expect(readFileSync(path, 'utf8')).toBe(source)
  const initial = await page()
  if (result.operation !== 'import' || !result.skill) throw new Error('missing copy')
  writeFileSync(path, 'A later edit to the original file.')
  await bridge({
    operation: 'save',
    draft: { ...result.skill, reminder: draft.reminder },
    revision: initial.revision,
    versionId: null,
  })
  expect(await bridge({ operation: 'detail', id: 'person/recipe-check' })).toMatchObject({
    operation: 'detail',
    skill: { body: source },
  })
  expect(readFileSync(path, 'utf8')).toBe('A later edit to the original file.')
  expect(choose).toHaveBeenCalledTimes(1)
})

it('cancelling import leaves the database unseeded and no path crosses the reply', async () => {
  expect(await bridge({ operation: 'import' })).toEqual({ operation: 'import', skill: null })
  expect(db.prepare('SELECT * FROM skill_current').all()).toEqual([])
})

it.each([
  source.replace(
    'name: recipe-check\r\ndescription: Check a fictional recipe.',
    'description: Check a fictional recipe.\r\nname: recipe-check',
  ),
  source.replace('name: recipe-check\r\ndescription:', 'name: recipe-check\r\n\r\ndescription:'),
])('copies the catalogue’s accepted frontmatter without rewriting it', async (body) => {
  const path = join(folder, 'SKILL.md')
  writeFileSync(path, body)
  expect(await copySkillFile(path)).toEqual({
    name: draft.name,
    description: draft.description,
    body,
  })
  expect(readFileSync(path, 'utf8')).toBe(body)
})

it.each(['size', 'name', 'utf8', 'frontmatter', 'directory'])(
  'refuses a bad %s import before publication',
  async (fault) => {
    const path = join(folder, fault === 'name' ? 'other.md' : 'SKILL.md')
    if (fault === 'directory') mkdirSync(path)
    else
      writeFileSync(
        path,
        fault === 'size'
          ? source + 'x'.repeat(65537)
          : fault === 'utf8'
            ? Buffer.from([0xff])
            : fault === 'frontmatter'
              ? 'No frontmatter'
              : source,
      )
    await expect(copySkillFile(path)).rejects.toMatchObject({
      code:
        fault === 'name'
          ? 'path'
          : fault === 'size' || fault === 'directory'
            ? 'size'
            : fault === 'utf8'
              ? 'invalid'
              : 'frontmatter',
    })
    expect(db.prepare('SELECT * FROM skill_current').all()).toEqual([])
  },
)

it('strictly refuses forged grants and oversized editor payloads at the wire', async () => {
  const run = vi.fn(bridge)
  for (const request of [
    { operation: 'choices', identityId: 'aid:recipe-reviewer', canCreateAgents: true },
    {
      operation: 'save',
      draft: { ...draft, body: 'x'.repeat(65537) },
      revision: 0,
      versionId: null,
    },
  ])
    await expect(
      executeRuntimeCommand(host(run), sink(true), { kind: 'skills', request }),
    ).rejects.toThrow('invalid runtime command')
  expect(run).not.toHaveBeenCalled()
})
