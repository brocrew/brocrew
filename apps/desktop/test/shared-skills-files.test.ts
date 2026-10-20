import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { SharedSkillLibrary } from '../src/main/skills/shared-library'
import { nodeFs, type RecoveryFs } from '../src/main/recovery/files'
import { copySkillTree, readSkillTree } from '../src/main/recovery/trees'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fictional-shared-skills-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
const body = (text = 'Check the fictional recipe.') =>
  `---\nname: recipe-check\ndescription: Check a fictional recipe.\n---\n\n${text}\n`
const personal = () =>
  Promise.resolve([{ id: 'person/recipe-check', name: 'recipe-check', body: body() }])
async function source(profile: string, text = body()) {
  const folder = join(root, 'provider-homes/default', profile, 'codex/skills/recipe-check')
  await mkdir(join(folder, 'assets'), { recursive: true })
  await mkdir(join(folder, 'empty'), { recursive: true })
  await writeFile(join(folder, 'SKILL.md'), text)
  await writeFile(join(folder, 'assets', 'map.bin'), new Uint8Array([0, 255, 3, 0]))
  await writeFile(join(folder, 'check.sh'), '#!/bin/sh\nexit 0\n')
  await chmod(join(folder, 'check.sh'), 0o700)
  return folder
}
const folders = async (path: string) =>
  (await readdir(path)).filter((one) => !one.startsWith('.')).sort()
const marker = () => readFile(join(root, 'skills-conversion.json'), 'utf8')

describe('one writable shared skills tree', () => {
  it('saves through a temporary file and rename, leaving the previous bytes on a failed save', async () => {
    const library = new SharedSkillLibrary(root)
    await library.save('recipe-check/SKILL.md', body())
    const renameFile = nodeFs.rename
    const broken: RecoveryFs = {
      ...nodeFs,
      rename: async (from, to) => {
        if (basename(to) === 'SKILL.md') throw new Error('fictional interrupted save')
        await renameFile(from, to)
      },
    }
    await expect(
      new SharedSkillLibrary(root, broken).save('recipe-check/SKILL.md', body('Changed.')),
    ).rejects.toThrow('fictional interrupted save')
    expect(await readFile(join(library.active, 'recipe-check/SKILL.md'), 'utf8')).toBe(body())
    expect(await readdir(join(library.active, 'recipe-check'))).toEqual(['SKILL.md'])
    await library.save('recipe-check/SKILL.md', body('Changed.'))
    expect(await readFile(join(library.active, 'recipe-check/SKILL.md'), 'utf8')).toBe(
      body('Changed.'),
    )
    await expect(library.save('../escape/SKILL.md', body())).rejects.toThrow()
  })
  it('moves complete managed Codex folders, deduplicates identical sources and keeps differing collisions', async () => {
    const a = await source('cora')
    await source('davi')
    const different = await source('elin', body('A different recipe.'))
    const original = await readSkillTree(a)
    const changed = await readSkillTree(different)
    const library = new SharedSkillLibrary(root)
    await expect(library.convert(async () => [])).resolves.toBeUndefined()
    if (process.platform === 'win32')
      await new SharedSkillLibrary(root, nodeFs, Date.now, 'win32', 'next-app').convert(
        async () => [],
      )
    const names = await folders(library.active)
    expect(names).toHaveLength(2)
    expect(names[0]).toBe('recipe-check')
    expect(names[1]).toBe('recipe-check-2')
    expect((await readSkillTree(join(library.active, names[0]!))).sha256).toBe(original.sha256)
    expect((await readSkillTree(join(library.active, names[1]!))).sha256).toBe(changed.sha256)
    expect(await readFile(join(library.active, names[0]!, 'assets/map.bin'))).toEqual(
      Buffer.from([0, 255, 3, 0]),
    )
    expect(await readdir(join(library.active, names[0]!, 'empty'))).toEqual([])
    if (process.platform !== 'win32')
      expect((await lstat(join(library.active, names[0]!, 'check.sh'))).mode & 0o100).toBe(0o100)
    await expect(lstat(a)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(different)).rejects.toMatchObject({ code: 'ENOENT' })
    await new SharedSkillLibrary(root).convert(async () => [])
    expect(await folders(library.active)).toEqual(names)
  })
  it('uses readable numbered collision names and records each completed difference once across restarts', async () => {
    await source('cora')
    await source('davi')
    await source('elin', body('Different recipe.'))
    await source('fara', body('Third recipe.'))
    const library = new SharedSkillLibrary(root, nodeFs, () => 500)
    expect(await library.recentImports(0, 1000)).toEqual([])
    await expect(library.convert(async () => [])).resolves.toBeUndefined()
    expect(await folders(library.active)).toEqual([
      'recipe-check',
      'recipe-check-2',
      'recipe-check-3',
    ])
    const notices = await library.recentImports(0, 1000)
    expect(notices.map((one) => one.imported).sort()).toEqual(['recipe-check-2', 'recipe-check-3'])
    expect(notices.every((one) => one.existing === 'recipe-check' && one.at === 500)).toBe(true)
    expect(await library.recentImports(0, 500)).toEqual([])
    expect(await library.recentImports(500, 501)).toEqual(notices)
    const restarted = new SharedSkillLibrary(root, nodeFs, () => 800)
    await restarted.convert(async () => [])
    expect(await restarted.recentImports(0, 1000)).toEqual(notices)
    await source('gita', body('Fourth recipe.'))
    await restarted.convert(async () => [])
    expect((await restarted.recentImports(0, 1000)).map((one) => one.imported).sort()).toEqual([
      'recipe-check-2',
      'recipe-check-3',
      'recipe-check-4',
    ])
  })
  it('does not announce a collision until publication completes, and refuses an unreadable notice history', async () => {
    await source('cora')
    const library = new SharedSkillLibrary(root, nodeFs, () => 500)
    await library.convert(async () => [])
    await source('davi', body('A different recipe.'))
    const broken: RecoveryFs = {
      ...nodeFs,
      rename: async (from, to) => {
        if (dirname(to) === library.active) throw new Error('fictional publication stop')
        await nodeFs.rename(from, to)
      },
    }
    await expect(
      new SharedSkillLibrary(root, broken, () => 600).convert(async () => []),
    ).rejects.toThrow('fictional publication stop')
    expect(await library.recentImports(0, 1000)).toEqual([])
    await library.convert(async () => [])
    expect(await library.recentImports(0, 1000)).toHaveLength(1)
    await writeFile(join(root, 'skills-conversion.json'), '{broken')
    await expect(library.recentImports(0, 1000)).rejects.toThrow()
  })
  it('exports personal sources once, does not overwrite later edits or resurrect deleted imports, and finds new source folders', async () => {
    await source('cora')
    const library = new SharedSkillLibrary(root)
    await library.convert(personal)
    if (process.platform === 'win32')
      await new SharedSkillLibrary(root, nodeFs, Date.now, 'win32', 'next-app').convert(personal)
    const names = await folders(library.active)
    expect(names).toHaveLength(2)
    await library.save('recipe-check/SKILL.md', body('Edited in the shared folder.'))
    await rm(join(library.active, names[1]!), { recursive: true })
    await new SharedSkillLibrary(root).convert(async () => {
      throw new Error('must not export again')
    })
    expect(await folders(library.active)).toEqual(['recipe-check'])
    expect(await readFile(join(library.active, 'recipe-check/SKILL.md'), 'utf8')).toBe(
      body('Edited in the shared folder.'),
    )
    await source('fara', body('A new source.'))
    await library.convert(personal)
    expect(await folders(library.active)).toHaveLength(2)
  })
  it('deduplicates against an off skill without turning it on', async () => {
    const home = await source('cora')
    const original = await readSkillTree(home)
    const library = new SharedSkillLibrary(root)
    await library.convert(async () => [])
    await rename(join(library.active, 'recipe-check'), join(library.off, 'recipe-check'))
    await source('davi')
    await library.convert(personal)
    expect(await folders(library.active)).toEqual([])
    expect((await readSkillTree(join(library.off, 'recipe-check'))).sha256).toBe(original.sha256)
  })
  it('finishes a recorded staged import after interruption without replacing a conflicting folder', async () => {
    const broken: RecoveryFs = {
      ...nodeFs,
      rename: async (from, to) => {
        if (dirname(to) === join(root, 'skills')) throw new Error('fictional publication stop')
        await nodeFs.rename(from, to)
      },
    }
    await expect(new SharedSkillLibrary(root, broken).convert(personal)).rejects.toThrow(
      'fictional publication stop',
    )
    await new SharedSkillLibrary(root).save('recipe-check/SKILL.md', body('Written meanwhile.'))
    await new SharedSkillLibrary(root).convert(personal)
    expect(await folders(join(root, 'skills'))).toHaveLength(2)
    expect(await readFile(join(root, 'skills/recipe-check/SKILL.md'), 'utf8')).toBe(
      body('Written meanwhile.'),
    )
    const receipts = JSON.parse(await marker()).receipts as { done: boolean }[]
    expect(receipts.every((one) => one.done)).toBe(true)
  })
  it('does not resurrect a published then deleted folder when the last receipt write was interrupted', async () => {
    let published = false
    const broken: RecoveryFs = {
      ...nodeFs,
      rename: async (from, to) => {
        if (published && basename(to) === 'skills-conversion.json')
          throw new Error('fictional receipt stop')
        await nodeFs.rename(from, to)
        if (dirname(to) === join(root, 'skills')) published = true
      },
    }
    await expect(new SharedSkillLibrary(root, broken).convert(personal)).rejects.toThrow(
      'fictional receipt stop',
    )
    expect(await folders(join(root, 'skills'))).toEqual(['recipe-check'])
    await rm(join(root, 'skills/recipe-check'), { recursive: true })
    await new SharedSkillLibrary(root).convert(personal)
    expect(await folders(join(root, 'skills'))).toEqual([])
  })
  it('deduplicates an identical folder created while a recorded import was waiting to publish', async () => {
    const broken: RecoveryFs = {
      ...nodeFs,
      rename: async (from, to) => {
        if (dirname(to) === join(root, 'skills')) throw new Error('fictional publication stop')
        await nodeFs.rename(from, to)
      },
    }
    await expect(new SharedSkillLibrary(root, broken).convert(personal)).rejects.toThrow(
      'fictional publication stop',
    )
    await new SharedSkillLibrary(root).save('recipe-check/SKILL.md', body())
    await expect(new SharedSkillLibrary(root).convert(personal)).resolves.toBeUndefined()
    expect(await folders(join(root, 'skills'))).toEqual(['recipe-check'])
    expect(await readdir(join(root, 'skills-off/.imports'))).toEqual([])
  })
  it.each(['codex', 'skills'] as const)(
    'refuses a pre-existing managed %s directory link before reading any skill',
    async (linked) => {
      const profile = join(root, 'provider-homes/default/cora')
      const outside = join(root, 'fictional-outside')
      const target =
        linked === 'codex' ? join(outside, 'skills/recipe-check') : join(outside, 'recipe-check')
      await mkdir(target, { recursive: true })
      await writeFile(join(target, 'SKILL.md'), body('Outside the managed source.'))
      await mkdir(linked === 'codex' ? profile : join(profile, 'codex'), { recursive: true })
      await symlink(
        outside,
        join(profile, linked === 'codex' ? 'codex' : 'codex/skills'),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
      const opened: string[] = []
      const fs: RecoveryFs = {
        ...nodeFs,
        open: async (...args) => {
          opened.push(args[0])
          return nodeFs.open(...args)
        },
      }
      const library = new SharedSkillLibrary(root, fs)
      await expect(library.convert(async () => [])).rejects.toThrow('Skills could not be read.')
      expect(opened.filter((one) => one.endsWith('SKILL.md'))).toEqual([])
      expect(await folders(library.active)).toEqual([])
      expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe(
        body('Outside the managed source.'),
      )
    },
  )
  it.skipIf(process.platform === 'win32')(
    'never follows a managed skill link to read outside its folder',
    async () => {
      const home = await source('cora')
      const outside = join(root, 'fictional-outside.txt')
      await writeFile(outside, 'fictional outside bytes')
      await symlink(outside, join(home, 'linked.txt'))
      const opened: string[] = []
      const fs: RecoveryFs = {
        ...nodeFs,
        open: async (...args) => {
          opened.push(args[0])
          return nodeFs.open(...args)
        },
      }
      await expect(new SharedSkillLibrary(root, fs).convert(async () => [])).rejects.toThrow()
      expect(opened).not.toContain(outside)
      expect(opened).not.toContain(join(home, 'linked.txt'))
    },
  )
  it('flushes a prepared personal import directory before recording the pending publication', async () => {
    const imports = join(root, 'skills-off/.imports')
    let flushed = false
    const publications: boolean[] = []
    const fs: RecoveryFs = {
      ...nodeFs,
      open: async (...args) => {
        const handle = await nodeFs.open(...args)
        return args[0] !== imports
          ? handle
          : {
              ...handle,
              sync: async () => {
                flushed = true
                await handle.sync()
              },
            }
      },
      rename: async (from, to) => {
        if (to === join(root, 'skills-conversion.json')) {
          const state = JSON.parse(await readFile(from, 'utf8'))
          if (state.receipts.some((one: { done: boolean }) => !one.done)) publications.push(flushed)
        }
        await nodeFs.rename(from, to)
      },
    }
    await expect(new SharedSkillLibrary(root, fs).convert(personal)).resolves.toBeUndefined()
    if (process.platform !== 'win32') expect(publications).toEqual([true])
  })
  it.each(
    process.platform === 'win32' ? (['win32'] as const) : ([process.platform, 'win32'] as const),
  )(
    'moves a new folder at a previously imported name again, deduplicating or keeping differing bytes (%s)',
    async (platform) => {
      const fs: RecoveryFs =
        platform === 'win32' && process.platform !== 'win32'
          ? {
              ...nodeFs,
              open: async (...args) => {
                if (args[1] === 'r' && args[0] === join(root, 'skills'))
                  throw Object.assign(new Error('fictional Windows directory'), {
                    code: 'EISDIR',
                  })
                return nodeFs.open(...args)
              },
            }
          : nodeFs
      const library = new SharedSkillLibrary(root, fs, Date.now, platform, 'first-app')
      const moved = async (path: string) => {
        if (platform === 'win32') {
          expect((await lstat(path)).isDirectory()).toBe(true)
          await new SharedSkillLibrary(root, fs, Date.now, platform, 'first-app').convert(
            async () => [],
          )
          expect((await lstat(path)).isDirectory()).toBe(true)
          await new SharedSkillLibrary(root, fs, Date.now, platform, 'next-app').convert(
            async () => [],
          )
        }
        await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' })
      }
      const original = await source('cora')
      await library.convert(async () => [])
      await moved(original)
      const duplicate = await source('cora')
      await library.convert(async () => [])
      expect(await folders(library.active)).toEqual(['recipe-check'])
      await moved(duplicate)
      const old = JSON.parse(await marker())
      old.receipts.push({
        source: 'codex/cora/recipe-check',
        target: 'recipe-check',
        stage: null,
        done: true,
      })
      await writeFile(join(root, 'skills-conversion.json'), JSON.stringify(old))
      const replacement = await source('cora', body('A new skill at an old name.'))
      await library.convert(async () => [])
      expect(await folders(library.active)).toEqual(['recipe-check', 'recipe-check-2'])
      await moved(replacement)
      expect(await readFile(join(library.active, 'recipe-check-2/SKILL.md'), 'utf8')).toBe(
        body('A new skill at an old name.'),
      )
      expect(await library.recentImports(0, Date.now() + 1)).toHaveLength(1)
    },
  )
  it('never moves or opens Codex .system skills', async () => {
    const path = join(root, 'provider-homes/default/cora/codex/skills/.system/recipe-check')
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'SKILL.md'), body('Owned by Codex.'))
    const library = new SharedSkillLibrary(root)
    await library.convert(async () => [])
    expect(await folders(library.active)).toEqual([])
    expect(await readFile(join(path, 'SKILL.md'), 'utf8')).toBe(body('Owned by Codex.'))
  })
  it('verifies a cross-volume copy before removing the source and preserves it on failure', async () => {
    const home = await source('cora')
    const original = await readSkillTree(home)
    const cross: RecoveryFs = {
      ...nodeFs,
      rename: async (from, to) => {
        if (from === home)
          throw Object.assign(new Error('fictional other volume'), { code: 'EXDEV' })
        await nodeFs.rename(from, to)
      },
    }
    let verifiedBeforeRemoval = false
    cross.rm = async (path, options) => {
      if (path === home) {
        expect((await readSkillTree(join(root, 'skills/recipe-check'))).sha256).toBe(
          (await readSkillTree(home)).sha256,
        )
        verifiedBeforeRemoval = true
      }
      return nodeFs.rm(path, options)
    }
    const library = new SharedSkillLibrary(root, cross)
    await library.convert(async () => [])
    if (process.platform === 'win32')
      await new SharedSkillLibrary(root, cross, Date.now, 'win32', 'next-app').convert(
        async () => [],
      )
    await expect(lstat(home)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(verifiedBeforeRemoval).toBe(true)
    expect((await readSkillTree(join(library.active, 'recipe-check'))).sha256).toBe(original.sha256)
    await source('cora', body('A later source.'))
    const failCopy: RecoveryFs = {
      ...cross,
      open: async (...args) => {
        if (args[0].includes('.imports') && args[0].endsWith('SKILL.md'))
          throw new Error('fictional copy stop')
        return nodeFs.open(...args)
      },
    }
    await expect(new SharedSkillLibrary(root, failCopy).convert(async () => [])).rejects.toThrow(
      'fictional copy stop',
    )
    expect(await readFile(join(home, 'SKILL.md'), 'utf8')).toBe(body('A later source.'))
    expect(await folders(library.active)).toEqual(['recipe-check'])
  })
  it.skipIf(process.platform === 'win32').each(['dedupe', 'rename', 'cross-volume'] as const)(
    'flushes destination files and directories before source deletion on %s',
    async (mode) => {
      const home = await source('cora')
      const target = join(root, 'skills/recipe-check')
      await mkdir(join(root, 'skills'), { recursive: true })
      if (mode === 'dedupe') await copySkillTree(home, target)
      const flushed = new Set<string>()
      let removed = false
      let renamed = false
      const required = (at: string) =>
        ['SKILL.md', 'assets/map.bin', 'check.sh', 'assets', 'empty', ''].map((part) =>
          join(at, part),
        )
      const fs: RecoveryFs = {
        ...nodeFs,
        open: async (...args) => {
          const handle = await nodeFs.open(...args)
          return {
            ...handle,
            sync: async () => {
              await handle.sync()
              flushed.add(args[0])
            },
          }
        },
        rename: async (from, to) => {
          if (from === home) {
            if (mode === 'cross-volume')
              throw Object.assign(new Error('fictional other volume'), { code: 'EXDEV' })
            expect(required(home).every((path) => flushed.has(path))).toBe(true)
            renamed = true
          }
          await nodeFs.rename(from, to)
        },
        rm: async (path, options) => {
          if (path === home) {
            expect(required(target).every((file) => flushed.has(file))).toBe(true)
            expect(flushed.has(dirname(target))).toBe(true)
            expect(flushed.has(root)).toBe(true)
            removed = true
          }
          await nodeFs.rm(path, options)
        },
      }
      await new SharedSkillLibrary(root, fs, Date.now, 'darwin').convert(async () => [])
      expect(required(target).every((path) => flushed.has(path))).toBe(true)
      expect(flushed.has(dirname(target))).toBe(true)
      expect(mode === 'rename' ? renamed : removed).toBe(true)
      await expect(lstat(home)).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )
  it.skipIf(process.platform === 'win32')(
    'retains the source when a published target fails to flush, then reflushes a deduped target on retry',
    async () => {
      const home = await source('cora')
      const target = join(root, 'skills/recipe-check')
      let stop = true
      let fileFlushed = false
      let directoryFlushed = false
      const fs: RecoveryFs = {
        ...nodeFs,
        rename: async (from, to) => {
          if (from === home)
            throw Object.assign(new Error('fictional other volume'), { code: 'EXDEV' })
          await nodeFs.rename(from, to)
        },
        open: async (...args) => {
          const handle = await nodeFs.open(...args)
          return {
            ...handle,
            sync: async () => {
              if (args[0] === dirname(target) && stop)
                throw new Error('fictional destination flush stop')
              await handle.sync()
              if (args[0] === join(target, 'SKILL.md')) fileFlushed = true
              if (args[0] === dirname(target)) directoryFlushed = true
            },
          }
        },
        rm: async (path, options) => {
          if (path === home) expect(fileFlushed && directoryFlushed).toBe(true)
          await nodeFs.rm(path, options)
        },
      }
      const library = new SharedSkillLibrary(root, fs, Date.now, 'darwin')
      await expect(library.convert(async () => [])).rejects.toThrow(
        'fictional destination flush stop',
      )
      expect(await readFile(join(home, 'SKILL.md'), 'utf8')).toBe(body())
      expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe(body())
      stop = false
      fileFlushed = false
      await library.convert(async () => [])
      await expect(lstat(home)).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )
  it('flushes Windows handles but retains the source until a later start confirms the matching destination', async () => {
    const home = await source('cora')
    const target = join(root, 'skills/recipe-check')
    let fileFlushed = false
    const fs: RecoveryFs = {
      ...nodeFs,
      open: async (...args) => {
        if (
          args[0] === dirname(target) ||
          args[0] === target ||
          args[0] === join(target, 'assets') ||
          args[0] === join(target, 'empty')
        )
          throw Object.assign(new Error('fictional Windows directory'), { code: 'EISDIR' })
        const handle = await nodeFs.open(...args)
        return {
          ...handle,
          sync: async () => {
            await handle.sync()
            if (args[0] === join(target, 'SKILL.md')) fileFlushed = true
          },
        }
      },
      rm: async (path, options) => {
        if (path === home) expect(fileFlushed).toBe(true)
        await nodeFs.rm(path, options)
      },
    }
    await new SharedSkillLibrary(root, fs, Date.now, 'win32', 'first-app').convert(async () => [])
    expect(fileFlushed).toBe(true)
    await expect(lstat(home)).resolves.toBeDefined()
    expect(await readFile(join(home, 'SKILL.md'), 'utf8')).toBe(body())
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe(body())
    fileFlushed = false
    await new SharedSkillLibrary(root, fs, Date.now, 'win32', 'first-app').convert(async () => [])
    await expect(lstat(home)).resolves.toBeDefined()
    await new SharedSkillLibrary(root, fs, Date.now, 'win32', 'second-app').convert(async () => [])
    expect(fileFlushed).toBe(true)
    await expect(lstat(home)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('never removes a Windows source on an old receipt when the published bytes no longer match', async () => {
    const home = await source('cora')
    const target = join(root, 'skills/recipe-check')
    const fs: RecoveryFs = {
      ...nodeFs,
      open: async (...args) => {
        if (
          (args[0] === join(root, 'skills') || args[0].startsWith(join(root, 'skills') + '/')) &&
          (await nodeFs.lstat(args[0])).isDirectory()
        )
          throw Object.assign(new Error('fictional Windows directory'), { code: 'EISDIR' })
        return nodeFs.open(...args)
      },
    }
    await new SharedSkillLibrary(root, fs, Date.now, 'win32').convert(async () => [])
    await writeFile(join(target, 'SKILL.md'), body('Changed in shared.'))
    await new SharedSkillLibrary(root, fs, Date.now, 'win32').convert(async () => [])
    expect(await readFile(join(home, 'SKILL.md'), 'utf8')).toBe(body())
    expect(await readFile(join(root, 'skills/recipe-check-2/SKILL.md'), 'utf8')).toBe(body())
  })
  it('does not use an old Windows receipt to remove newly replaced but matching source and destination bytes', async () => {
    const home = await source('cora')
    const target = join(root, 'skills/recipe-check')
    const fs: RecoveryFs = {
      ...nodeFs,
      open: async (...args) => {
        if (
          args[0] === dirname(target) ||
          args[0] === target ||
          args[0] === join(target, 'assets') ||
          args[0] === join(target, 'empty')
        )
          throw Object.assign(new Error('fictional Windows directory'), { code: 'EISDIR' })
        return nodeFs.open(...args)
      },
    }
    await new SharedSkillLibrary(root, fs, Date.now, 'win32', 'first-app').convert(async () => [])
    await writeFile(join(home, 'SKILL.md'), body('New matching bytes.'))
    await writeFile(join(target, 'SKILL.md'), body('New matching bytes.'))
    await new SharedSkillLibrary(root, fs, Date.now, 'win32', 'second-app').convert(async () => [])
    await expect(lstat(home)).resolves.toBeDefined()
    expect(await readFile(join(home, 'SKILL.md'), 'utf8')).toBe(body('New matching bytes.'))
    await new SharedSkillLibrary(root, fs, Date.now, 'win32', 'third-app').convert(async () => [])
    await expect(lstat(home)).rejects.toMatchObject({ code: 'ENOENT' })
    await source('cora')
    await writeFile(join(target, 'SKILL.md'), body())
    await new SharedSkillLibrary(root, fs, Date.now, 'win32', 'third-app').convert(async () => [])
    await expect(lstat(home)).resolves.toBeDefined()
  })
  it('keeps a Windows source when a published file handle cannot flush', async () => {
    const home = await source('cora')
    const target = join(root, 'skills/recipe-check')
    const fs: RecoveryFs = {
      ...nodeFs,
      open: async (...args) => {
        const handle = await nodeFs.open(...args)
        return {
          ...handle,
          sync: async () => {
            if (args[0] === join(target, 'SKILL.md') && args[1] === 'r+')
              throw new Error('fictional file flush stop')
            await handle.sync()
          },
        }
      },
    }
    await expect(
      new SharedSkillLibrary(root, fs, Date.now, 'win32').convert(async () => []),
    ).rejects.toThrow('fictional file flush stop')
    expect(await readFile(join(home, 'SKILL.md'), 'utf8')).toBe(body())
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe(body())
  })
  it('refuses an unreadable conversion record and leaves the existing tree intact', async () => {
    const library = new SharedSkillLibrary(root)
    await library.save('recipe-check/SKILL.md', body())
    await writeFile(join(root, 'skills-conversion.json'), '{broken')
    await expect(library.convert(personal)).rejects.toThrow()
    expect(await readFile(join(library.active, 'recipe-check/SKILL.md'), 'utf8')).toBe(body())
  })
  it('refuses a copy whose source changes while its files are read', async () => {
    const home = await source('cora')
    let reads = 0
    const fs: RecoveryFs = {
      ...nodeFs,
      open: async (...args) => {
        const handle = await nodeFs.open(...args)
        if (args[0] !== join(home, 'SKILL.md')) return handle
        reads++
        if (reads !== 2) return handle
        return {
          ...handle,
          close: async () => {
            await handle.close()
            await writeFile(join(home, 'SKILL.md'), body('Changed during copy.'))
          },
        }
      },
    }
    await expect(copySkillTree(home, join(root, 'fictional-copy'), fs)).rejects.toThrow()
  })
})
