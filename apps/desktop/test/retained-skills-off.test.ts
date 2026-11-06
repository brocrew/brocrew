import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

it('keeps the original after failed quarantine renames and retries without refusing the offer', async () => {
  const library = new SharedSkillLibrary(root, fs, Date.now, 'win32')
  await library.convert(nothing)
  // A historical completed import left its native source behind on an older Windows build.
  await mkdir(join(original, 'assets'), { recursive: true })
  await writeFile(join(original, 'SKILL.md'), body)
  await writeFile(join(original, 'assets/map.bin'), new Uint8Array([0, 2, 255]))
  const marker = join(root, 'skills-conversion.json')
  const state = JSON.parse(await readFile(marker, 'utf8'))
  state.receipts.find((one: { target: string }) => one.target === 'recipe-check').retained = true
  await writeFile(marker, JSON.stringify(state))
  await library.setEnabled('recipe-check', false)
  refuseRename = true
  for (let i = 0; i < 3; i++) await expect(library.beforeOffer()).resolves.toBeUndefined()
  expect(console.warn).toHaveBeenCalledTimes(3)
  expect(
    vi
      .mocked(console.warn)
      .mock.calls.every(
        (call) =>
          String(call[0]).includes(original) &&
          String(call[0]).includes('fictional locked directory'),
      ),
  ).toBe(true)
  expect(await readFile(join(original, 'SKILL.md'), 'utf8')).toBe(body)
  refuseRename = false
  await library.beforeOffer()
  await expect(lstat(original)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(join(root, 'skills-off/recipe-check/SKILL.md'), 'utf8')).toBe(body)
})
