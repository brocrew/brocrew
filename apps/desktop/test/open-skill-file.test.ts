import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { flushSkillTree } from '../src/main/skills/flush-skill-tree'
import { openWritableSkillFile } from '../src/main/skills/open-skill-file'
import { nodeFs } from '../src/main/recovery/files'
let root: string
let path: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fictional-skill-handle-'))
  path = join(root, 'skills/recipe-check/SKILL.md')
  await mkdir(join(root, 'skills/recipe-check'), { recursive: true })
  await writeFile(path, 'A fictional recipe.')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

it('opens ordinary writable files and linked files with real flush access', async () => {
  const other = join(root, 'linked.txt')
  await symlink(path, other)
  const file = await openWritableSkillFile(root, other, nodeFs)
  try {
    await file.writeFile('Another fictional recipe.')
    await file.sync()
  } finally {
    await file.close()
  }
  expect(await readFile(path, 'utf8')).toBe('Another fictional recipe.')
})

it('names the actual failed file and OS cause', async () => {
  const missing = join(root, 'missing.txt')
  await expect(openWritableSkillFile(root, missing, nodeFs)).rejects.toThrow(missing)
  await expect(
    openWritableSkillFile(root, path, nodeFs, async () => {
      throw Object.assign(new Error('fictional EACCES'), { code: 'EACCES' })
    }),
  ).rejects.toThrow(`${path}: Error: fictional EACCES`)
})

it('flushes production Windows file handles without using recovery’s read-only no-follow translation', async () => {
  await expect(flushSkillTree(dirname(path), nodeFs, 'win32', root)).resolves.toBeTypeOf('boolean')
  expect(await readFile(path, 'utf8')).toBe('A fictional recipe.')
})
