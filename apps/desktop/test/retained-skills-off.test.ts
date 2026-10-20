import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { nodeFs, type RecoveryFs } from '../src/main/recovery/files'
import { SharedSkillLibrary } from '../src/main/skills/shared-library'

let root: string
let home: string
let original: string
let fs: RecoveryFs
let refuseRename: boolean
const body =
  '---\nname: recipe-check\ndescription: Check a fictional recipe.\n---\n\nCheck flour.\n'
const nothing = async () => []
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fictional-retained-off-'))
  home = join(root, 'provider-homes/default/cora/codex')
  original = join(home, 'skills/recipe-check')
  await mkdir(join(original, 'assets'), { recursive: true })
  await writeFile(join(original, 'SKILL.md'), body)
  await writeFile(join(original, 'assets/map.bin'), new Uint8Array([0, 2, 255]))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  refuseRename = false
  fs = {
    ...nodeFs,
    open: async (...args) => {
      if (
        (await nodeFs.lstat(args[0]).catch(() => null))?.isDirectory() &&
        (args[0] === join(root, 'skills') || args[0].startsWith(join(root, 'skills') + sep))
      )
        throw Object.assign(new Error('fictional directory cannot be synced'), { code: 'EISDIR' })
      return nodeFs.open(...args)
    },
    rename: async (from, to) => {
      if (refuseRename && to.startsWith(join(home, 'skills-retained') + sep))
        throw Object.assign(new Error('fictional locked directory'), { code: 'EPERM' })
      return nodeFs.rename(from, to)
    },
  }
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

it('hides a complete retained original on the next offer and keeps it through repeated same-app conversions', async () => {
  const library = new SharedSkillLibrary(root, fs, Date.now, 'win32', 'first-app')
  await library.convert(nothing)
  await library.setEnabled('recipe-check', false)
  await library.beforeOffer()
  const [id] = await readdir(join(home, 'skills-retained'))
  expect(id).toBeDefined()
  const hidden = join(home, 'skills-retained', id!)
  expect(await readFile(join(hidden, 'SKILL.md'), 'utf8')).toBe(body)
  expect(await readFile(join(hidden, 'assets/map.bin'))).toEqual(Buffer.from([0, 2, 255]))
  await expect(lstat(original)).rejects.toMatchObject({ code: 'ENOENT' })
  for (let n = 0; n < 3; n++) {
    await new SharedSkillLibrary(root, fs, Date.now, 'win32', 'first-app').convert(nothing)
    await library.beforeOffer()
    await expect(lstat(hidden)).resolves.toBeDefined()
    expect(await readdir(join(home, 'skills'))).toEqual([])
  }
  const next = new SharedSkillLibrary(root, fs, Date.now, 'win32', 'second-app')
  await next.convert(nothing)
  await expect(lstat(hidden)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(join(root, 'skills-off/recipe-check/SKILL.md'), 'utf8')).toBe(body)
})

it('keeps the original after failed quarantine renames and retries without refusing the offer', async () => {
  const library = new SharedSkillLibrary(root, fs, Date.now, 'win32', 'first-app')
  await library.convert(nothing)
  await library.setEnabled('recipe-check', false)
  refuseRename = true
  for (let n = 0; n < 3; n++) await expect(library.beforeOffer()).resolves.toBeUndefined()
  expect(console.warn).toHaveBeenCalledTimes(3)
  expect(vi.mocked(console.warn).mock.calls).toEqual(
    Array.from({ length: 3 }, () => ['Could not hide a turned-off skill; trying again next turn.']),
  )
  expect(await readFile(join(original, 'SKILL.md'), 'utf8')).toBe(body)
  expect(await readdir(join(home, 'skills-retained'))).toEqual([])
  refuseRename = false
  await library.beforeOffer()
  await expect(lstat(original)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readdir(join(home, 'skills-retained'))).toHaveLength(1)
})

it('does not remove a quarantined copy when the destination is missing or has changed', async () => {
  const library = new SharedSkillLibrary(root, fs, Date.now, 'win32', 'first-app')
  await library.convert(nothing)
  await library.setEnabled('recipe-check', false)
  await library.beforeOffer()
  const hidden = join(home, 'skills-retained', (await readdir(join(home, 'skills-retained')))[0]!)
  await writeFile(join(root, 'skills-off/recipe-check/SKILL.md'), 'A different fictional skill.')
  await new SharedSkillLibrary(root, fs, Date.now, 'win32', 'next-app').beforeOffer()
  await expect(lstat(hidden)).resolves.toBeDefined()
  await rm(join(root, 'skills-off/recipe-check'), { recursive: true })
  await new SharedSkillLibrary(root, fs, Date.now, 'win32', 'later-app').beforeOffer()
  expect(await readFile(join(hidden, 'SKILL.md'), 'utf8')).toBe(body)
})

it('imports a replacement at the old native name separately without overwriting quarantine', async () => {
  const library = new SharedSkillLibrary(root, fs, Date.now, 'win32', 'first-app')
  await library.convert(nothing)
  await library.setEnabled('recipe-check', false)
  await library.beforeOffer()
  await mkdir(original)
  await writeFile(join(original, 'SKILL.md'), 'A new fictional recipe.')
  await library.convert(nothing)
  expect(await readFile(join(root, 'skills/recipe-check-2/SKILL.md'), 'utf8')).toBe(
    'A new fictional recipe.',
  )
  const hidden = join(home, 'skills-retained', (await readdir(join(home, 'skills-retained')))[0]!)
  expect(await readFile(join(hidden, 'SKILL.md'), 'utf8')).toBe(body)
  await expect(lstat(hidden)).resolves.toBeDefined()
  await new SharedSkillLibrary(root, fs, Date.now, 'win32', 'second-app').convert(nothing)
  await expect(lstat(hidden)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(join(root, 'skills/recipe-check-2/SKILL.md'), 'utf8')).toBe(
    'A new fictional recipe.',
  )
})

it('rejects a receipt which would address a home outside managed profiles before renaming anything', async () => {
  const library = new SharedSkillLibrary(root, fs, Date.now, 'win32', 'first-app')
  await library.convert(nothing)
  await library.setEnabled('recipe-check', false)
  const marker = join(root, 'skills-conversion.json')
  const state = JSON.parse(await readFile(marker, 'utf8'))
  state.receipts.find((one: { retained?: boolean }) => one.retained).source =
    'moved/../recipe-check/fictional'
  await writeFile(marker, JSON.stringify(state))
  await expect(library.beforeOffer()).rejects.toThrow()
  await expect(lstat(original)).resolves.toBeDefined()
  await expect(lstat(join(home, 'skills-retained'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('refuses a linked quarantine directory without reading or changing its target', async () => {
  const library = new SharedSkillLibrary(root, fs, Date.now, 'win32', 'first-app')
  await library.convert(nothing)
  await library.setEnabled('recipe-check', false)
  const outside = join(root, 'fictional-unrelated')
  await mkdir(outside)
  await writeFile(join(outside, 'keep.txt'), 'Fictional untouched bytes.')
  await symlink(
    outside,
    join(home, 'skills-retained'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  await expect(library.beforeOffer()).rejects.toThrow('Skills could not be read.')
  expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('Fictional untouched bytes.')
  await expect(lstat(original)).resolves.toBeDefined()
})

it('reconciles a committed quarantine intent after a failed rename without treating that rename as an earlier app publication', async () => {
  const first = new SharedSkillLibrary(root, fs, Date.now, 'win32', 'first-app')
  await first.convert(nothing)
  await first.setEnabled('recipe-check', false)
  refuseRename = true
  await expect(first.beforeOffer()).resolves.toBeUndefined()
  refuseRename = false
  const next = new SharedSkillLibrary(
    root,
    {
      ...fs,
      rename: async (from, to) => {
        if (to.startsWith(join(home, 'skills-retained') + sep)) {
          const state = JSON.parse(await readFile(join(root, 'skills-conversion.json'), 'utf8'))
          expect(state.receipts.find((one: { retained?: boolean }) => one.retained).startId).toBe(
            'second-app',
          )
        }
        await fs.rename(from, to)
      },
    },
    Date.now,
    'win32',
    'second-app',
  )
  await next.convert(nothing)
  const hidden = join(home, 'skills-retained', (await readdir(join(home, 'skills-retained')))[0]!)
  await expect(lstat(original)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(lstat(hidden)).resolves.toBeDefined()
  await next.beforeOffer()
  await expect(lstat(hidden)).resolves.toBeDefined()
  await new SharedSkillLibrary(root, fs, Date.now, 'win32', 'third-app').convert(nothing)
  await expect(lstat(hidden)).rejects.toMatchObject({ code: 'ENOENT' })
})
