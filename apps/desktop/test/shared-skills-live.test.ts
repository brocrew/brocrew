import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { SharedSkillDiscovery } from '../src/main/skills/shared-discovery'
import { SharedSkillLibrary } from '../src/main/skills/shared-library'
import { nodeFs } from '../src/main/recovery/files'
import { readBuiltInSkills } from '../src/main/skills/prepare-built-in-skills'

let root: string
let service: SharedSkillDiscovery
const shipped = () =>
  readBuiltInSkills(resolve(import.meta.dirname, '../resources/built-in-skills'))
const text = (name: string, body = 'Check the fictional recipe.') =>
  `---\nname: ${name}\ndescription: A fictional recipe.\n---\n\n${body}\n`
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fictional-shared-discovery-'))
  await new SharedSkillLibrary(root).convert(async () => [])
  service = new SharedSkillDiscovery(root, Promise.resolve(), shipped)
})
afterEach(async () => {
  service.close()
  await rm(root, { recursive: true, force: true })
})
it('waits for conversion before exposing one real plugin root, without copying built-ins into it', async () => {
  let ready!: () => void
  service.close()
  service = new SharedSkillDiscovery(
    root,
    new Promise<void>((done) => {
      ready = done
    }),
    shipped,
  )
  let finished = false
  const pending = service.root().then((path) => {
    finished = true
    return path
  })
  await new Promise((done) => setTimeout(done, 10))
  expect(finished).toBe(false)
  ready()
  await expect(pending).resolves.toBe(join(root, 'skills'))
  expect(
    JSON.parse(await readFile(join(root, 'skills/.claude-plugin/plugin.json'), 'utf8')),
  ).toEqual({ name: 'shared-skills', version: '1.0.0', skills: ['./'] })
  expect((await service.list()).filter((one) => one.builtIn)).toHaveLength(8)
})
it('sees additions, edits and removals through the watcher without restarting', async () => {
  await service.list()
  const library = service.library
  await library.save('recipe-check/SKILL.md', text('recipe-check'))
  await vi.waitFor(async () =>
    expect((await service.list()).filter((one) => !one.builtIn)).toHaveLength(1),
  )
  await library.save('recipe-check/SKILL.md', text('recipe-check', 'A changed recipe.'))
  await vi.waitFor(async () =>
    expect((await service.list()).find((one) => !one.builtIn)?.body).toContain('A changed recipe.'),
  )
  await rm(join(root, 'skills/recipe-check'), { recursive: true })
  await vi.waitFor(async () =>
    expect((await service.list()).filter((one) => !one.builtIn)).toEqual([]),
  )
})
it('lists more than eight shared folders, including duplicate native names, and moves an entire skill off and on', async () => {
  for (let n = 0; n < 12; n++)
    await service.library.save(`recipe-${n}/SKILL.md`, text('recipe-check'))
  await mkdir(join(root, 'skills/recipe-0/assets'))
  await writeFile(join(root, 'skills/recipe-0/assets/map.bin'), new Uint8Array([0, 255, 3]))
  expect((await service.list()).filter((one) => !one.builtIn)).toHaveLength(12)
  await expect(
    service.window({ operation: 'shared-toggle', folder: 'recipe-0', enabled: false }),
  ).resolves.toEqual({ operation: 'shared-toggle' })
  expect((await service.list()).find((one) => one.folder === 'recipe-0')?.enabled).toBe(false)
  expect(await readFile(join(root, 'skills-off/recipe-0/assets/map.bin'))).toEqual(
    Buffer.from([0, 255, 3]),
  )
  await service.window({ operation: 'shared-toggle', folder: 'recipe-0', enabled: true })
  expect((await service.list()).find((one) => one.folder === 'recipe-0')?.enabled).toBe(true)
  expect(await readFile(join(root, 'skills/recipe-0/SKILL.md'), 'utf8')).toBe(text('recipe-check'))
  await expect(
    service.window({
      operation: 'select',
      identityId: 'fictional',
      id: 'fictional',
      selection: 'on',
      revision: 0,
    }),
  ).resolves.toMatchObject({ operation: 'refused' })
})
it('a conflicting off/on move preserves both existing folders', async () => {
  await service.library.save('recipe-check/SKILL.md', text('recipe-check'))
  await service.library.setEnabled('recipe-check', false)
  await service.library.save('recipe-check/SKILL.md', text('recipe-check', 'A different recipe.'))
  await expect(service.library.setEnabled('recipe-check', true)).rejects.toThrow()
  expect(await readFile(join(root, 'skills-off/recipe-check/SKILL.md'), 'utf8')).toBe(
    text('recipe-check'),
  )
  expect(await readFile(join(root, 'skills/recipe-check/SKILL.md'), 'utf8')).toContain(
    'A different recipe.',
  )
})

it('reads ordinary quoted and multiline descriptions without changing the source bytes', async () => {
  const original =
    '---\nname: "recipe-check"\ndescription: >\n  Check the flour,\n  then the water.\n---\n\nCheck the quantities.\n'
  await service.library.save('recipe-check/SKILL.md', original)
  const skill = (await service.list()).find((one) => !one.builtIn)
  expect(skill?.name).toBe('recipe-check')
  expect(skill?.description).toBe('Check the flour, then the water.')
  expect(skill?.body).toBe(original)
})

it('moves new native folders before discovery on every start or resume, for all profiles', async () => {
  const home = join(root, 'provider-homes/default/cora/codex')
  const original = join(home, 'skills/recipe-check')
  await mkdir(original, { recursive: true })
  await writeFile(join(original, 'SKILL.md'), text('recipe-check'))
  await service.prepareLaunch()
  if (process.platform === 'win32')
    await new SharedSkillLibrary(root, undefined, Date.now, 'win32', 'next-app').convert(
      async () => [],
    )
  await expect(lstat(original)).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await service.list()).find((one) => one.folder === 'recipe-check')?.body).toBe(
    text('recipe-check'),
  )
  await service.prepareLaunch()
  expect((await service.list()).filter((one) => !one.builtIn)).toHaveLength(1)
  await service.library.setEnabled('recipe-check', false)
  await mkdir(original, { recursive: true })
  await writeFile(join(original, 'SKILL.md'), text('recipe-check', 'A replacement recipe.'))
  await service.prepareLaunch()
  if (process.platform === 'win32')
    await new SharedSkillLibrary(root, undefined, Date.now, 'win32', 'next-app').convert(
      async () => [],
    )
  await expect(lstat(original)).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await service.list()).find((one) => one.folder === 'recipe-check')?.enabled).toBe(false)
  expect((await service.list()).find((one) => one.folder === 'recipe-check-2')?.body).toContain(
    'A replacement recipe.',
  )
})

it('keeps a retained native original through startup and repeated prepareLaunch calls in the same app', async () => {
  const home = join(root, 'provider-homes/default/cora/codex/skills/recipe-check')
  await mkdir(home, { recursive: true })
  await writeFile(join(home, 'SKILL.md'), text('recipe-check'))
  const fs = {
    ...nodeFs,
    open: async (...args: Parameters<typeof nodeFs.open>) => {
      if (
        (await nodeFs.lstat(args[0]).catch(() => null))?.isDirectory() &&
        (args[0] === join(root, 'skills') || args[0].startsWith(join(root, 'skills') + sep))
      )
        throw Object.assign(new Error('fictional Windows directory'), { code: 'EISDIR' })
      return nodeFs.open(...args)
    },
  }
  const first = new SharedSkillLibrary(root, fs, Date.now, 'win32', 'one-app')
  await first.convert(async () => [])
  service.close()
  service = new SharedSkillDiscovery(
    root,
    Promise.resolve(),
    shipped,
    new SharedSkillLibrary(root, fs, Date.now, 'win32', 'one-app'),
  )
  await service.prepareLaunch()
  await service.prepareLaunch()
  await expect(lstat(home)).resolves.toBeDefined()
  // Even if directory sync becomes available, this app cannot confirm its own publication.
  await new SharedSkillLibrary(root, nodeFs, Date.now, 'win32', 'one-app').convert(async () => [])
  await expect(lstat(home)).resolves.toBeDefined()
  const next = new SharedSkillLibrary(root, fs, Date.now, 'win32', 'another-app')
  await next.convert(async () => [])
  await expect(lstat(home)).rejects.toMatchObject({ code: 'ENOENT' })
})
