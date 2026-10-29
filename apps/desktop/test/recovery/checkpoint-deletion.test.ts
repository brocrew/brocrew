// Independent review controls. All mutable data is fictional and temporary.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { applyMigrations } from '../../src/main/db/migrate'
import { buildLineage } from '../../src/main/recovery/database-facts'
import {
  deleteRetainedCopy,
  isIntact,
  listOfferable,
  makeCheckpoint,
  prune,
  recordSuccessfulStart,
  retainedCopyInfo,
} from '../../src/main/recovery/checkpoint'
import { nodeFs } from '../../src/main/recovery/files'
import { beginCheckpointDeletion } from '../../src/main/recovery/checkpoint-deletion'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function fixture(withTrees = false) {
  const root = mkdtempSync(join(tmpdir(), 'fictional-retention-re-review-'))
  roots.push(root)
  const userData = join(root, 'fictional-workspace')
  mkdirSync(userData)
  const migrations = new URL('../../src/main/db/migrations', import.meta.url).pathname
  const db = openDatabase(join(userData, 'brobot2.sqlite'))
  applyMigrations(db, migrations)
  db.close()
  writeFileSync(join(userData, 'drafts.json'), '{"draft":"fictional only"}')
  if (withTrees)
    for (const name of ['skills', 'skills-off']) {
      mkdirSync(join(userData, name))
      writeFileSync(join(userData, name, 'my-notes.txt'), 'fictional app-copied skill content')
    }
  const lineage = await buildLineage(migrations)
  const copy = await makeCheckpoint({
    userData,
    ownership: 'sole',
    appVersion: '0.1.9',
    build: null,
    reason: 'first-start-of-release',
    freeBytes: () => null,
    log: () => {},
  })
  const options = { ownership: 'sole' as const, currentAppVersion: '0.1.9', warn: () => {} }
  await recordSuccessfulStart(userData, lineage, options)
  return { root, userData, lineage, copy, options }
}

it.each([
  ['retry', 'before rename'],
  ['prune', 'before rename'],
  ['retry', 'after rename'],
  ['prune', 'after rename'],
])('the confirmed root stays bound through %s %s', async (operation, when) => {
  const { root, userData, lineage, copy, options } = await fixture()
  await beginCheckpointDeletion(userData, copy, nodeFs)
  const removing = join(userData, 'backups', `deleting-${copy.manifest.id}`)
  const saved = join(root, 'original-authorized-copy')
  let swapped = false
  function replace(folder: string) {
    renameSync(folder, saved)
    mkdirSync(folder)
    writeFileSync(join(folder, 'drafts.json'), 'personal replacement, not the confirmed copy')
    swapped = true
  }
  const fs = {
    ...nodeFs,
    readdir: async (path: string) => {
      if (!swapped && when === 'before rename' && path === copy.folder) replace(path)
      return nodeFs.readdir(path)
    },
    rename: async (from: string, to: string) => {
      await nodeFs.rename(from, to)
      if (!swapped && when === 'after rename' && from === copy.folder && to === removing)
        replace(to)
    },
  }
  if (operation === 'retry')
    expect(await deleteRetainedCopy(userData, lineage, copy.manifest.id, { ...options, fs })).toBe(
      false,
    )
  else expect(await prune(userData, lineage, { ...options, fs })).toEqual([])
  expect(swapped).toBe(true)
  const replacement = existsSync(removing) ? removing : copy.folder
  expect(readFileSync(join(replacement, 'drafts.json'), 'utf8')).toBe(
    'personal replacement, not the confirmed copy',
  )
  expect(readFileSync(join(saved, 'drafts.json'), 'utf8')).toBe('{"draft":"fictional only"}')
  expect(existsSync(join(saved, 'database.sqlite'))).toBe(true)
})

it.each(['retry', 'prune'])(
  'original P2 EIO scenario now retains visibility and finishes via %s',
  async (operation) => {
    const { userData, lineage, copy, options } = await fixture()
    let fragment = ''
    const fs = {
      ...nodeFs,
      unlink: async (path: string) => {
        await nodeFs.unlink(path)
        if (path.endsWith('/drafts.json')) {
          fragment = dirname(path)
          throw Object.assign(new Error('fictional EIO after copied draft removal'), {
            code: 'EIO',
          })
        }
      },
      rm: async (path: string, settings?: { recursive?: boolean; force?: boolean }) => {
        if (!settings?.recursive) return nodeFs.rm(path, settings)
        fragment = path
        await nodeFs.rm(join(path, 'drafts.json'), { force: true })
        throw Object.assign(new Error('fictional EIO midway through recursive removal'), {
          code: 'EIO',
        })
      },
    }
    expect(await deleteRetainedCopy(userData, lineage, copy.manifest.id, { ...options, fs })).toBe(
      false,
    )
    expect(existsSync(join(fragment, 'database.sqlite'))).toBe(true)
    expect(await retainedCopyInfo(userData, lineage, options)).toMatchObject({
      id: copy.manifest.id,
      bytes: copy.manifest.database.bytes,
    })
    expect(await listOfferable(userData, lineage)).toEqual([])
    if (operation === 'retry') {
      expect(await deleteRetainedCopy(userData, lineage, copy.manifest.id, options)).toBe(true)
      expect(await deleteRetainedCopy(userData, lineage, copy.manifest.id, options)).toBe(true)
    } else {
      expect(await prune(userData, lineage, options)).toEqual([copy.manifest.id])
    }
    expect(existsSync(fragment)).toBe(false)
    expect(await retainedCopyInfo(userData, lineage, options)).toBeNull()
  },
)

function identity(path: string, relative: string) {
  const s = statSync(path)
  return {
    path: relative,
    directory: s.isDirectory(),
    dev: s.dev,
    ino: s.ino,
    size: s.size,
    mtimeMs: s.mtimeMs,
  }
}

it.each(['retry', 'prune'])(
  'old P1 forged v1 record is refused by %s and preserves the personal UUID folder',
  async (operation) => {
    const { userData, lineage, copy, options } = await fixture()
    const id = randomUUID()
    const personal = join(userData, 'backups', id)
    mkdirSync(personal)
    const note = join(personal, 'my-notes.txt')
    writeFileSync(note, 'fictional personal file that BroCrew never copied')
    // Control: the existing personal-file/unfinished-folder safeguards protect it without intent.
    expect(await prune(userData, lineage, options)).toEqual([])
    expect(readFileSync(note, 'utf8')).toContain('fictional personal file')
    // All syntax, workspace and filesystem identity checks pass, but there was no authorized deletion.
    writeFileSync(
      join(userData, 'backups', 'deletion.json'),
      JSON.stringify({
        format: 'brocrew-recovery-delete',
        version: 1,
        manifest: { ...copy.manifest, id },
        entries: [identity(personal, ''), identity(note, 'my-notes.txt')],
      }),
    )
    if (operation === 'retry') {
      expect(await deleteRetainedCopy(userData, lineage, id, options)).toBe(false)
    } else {
      expect(await prune(userData, lineage, options)).toEqual([])
    }
    // Both original P1 proofs now require refusal and preservation.
    expect(existsSync(personal)).toBe(true)
    expect(existsSync(note)).toBe(true)
    expect(await isIntact(copy)).toBe(true)
  },
)

it('a symlink used as the deletion record is refused', async () => {
  const { root, userData, lineage, copy, options } = await fixture()
  const target = join(root, 'fictional-personal-record.json')
  writeFileSync(target, '{}')
  symlinkSync(target, join(userData, 'backups', 'deletion.json'))
  expect(await deleteRetainedCopy(userData, lineage, copy.manifest.id, options)).toBe(false)
  expect(await prune(userData, lineage, options)).toEqual([])
  expect(await isIntact(copy)).toBe(true)
  expect(readFileSync(target, 'utf8')).toBe('{}')
})

it('a fragment from before the fix remains protected when no deletion intent exists', async () => {
  const { userData, lineage, copy, options } = await fixture()
  rmSync(join(copy.folder, 'drafts.json'))
  expect(await deleteRetainedCopy(userData, lineage, copy.manifest.id, options)).toBe(false)
  expect(
    await prune(userData, lineage, {
      ...options,
      now: () => Date.parse(copy.manifest.createdAt) + 4 * 86_400_000,
    }),
  ).toEqual([])
  expect(existsSync(join(copy.folder, 'database.sqlite'))).toBe(true)
  expect(existsSync(join(userData, 'backups', 'deletion.json'))).toBe(false)
})

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

it.each([
  ['retry', 'draft'],
  ['prune', 'draft'],
  ['retry', 'tree'],
  ['prune', 'tree'],
])(
  'fixed names bound a consistent forged v2 intent through %s for a personal %s',
  async (operation, kind) => {
    const { userData, lineage, copy, options } = await fixture()
    const id = randomUUID()
    const personal = join(userData, 'backups', id)
    mkdirSync(personal)
    const body = 'fictional personal notes, never a BroCrew recovery copy'
    const name = kind === 'tree' ? 'skills/my-notes.txt' : 'drafts.json'
    if (kind === 'tree') mkdirSync(join(personal, 'skills'))
    const note = join(personal, name)
    writeFileSync(note, body)
    expect(await prune(userData, lineage, options)).toEqual([])
    expect(await deleteRetainedCopy(userData, lineage, id, options)).toBe(false)
    const trees =
      kind === 'tree'
        ? {
            skills: [
              {
                path: 'my-notes.txt',
                directory: false,
                bytes: Buffer.byteLength(body),
                executable: !!(statSync(note).mode & 0o100),
                sha256: sha(body),
              },
            ],
          }
        : {}
    const manifest = {
      ...copy.manifest,
      id,
      files: copy.manifest.files.map((file) =>
        file.name === (kind === 'tree' ? 'skills' : 'drafts.json')
          ? {
              name: file.name,
              present: true,
              bytes: Buffer.byteLength(body),
              sha256:
                kind === 'tree'
                  ? sha('brocrew-skill-tree-v1\0' + JSON.stringify(trees.skills))
                  : sha(body),
            }
          : { name: file.name, present: false },
      ),
    }
    const manifestText = JSON.stringify(manifest, null, 2) + '\n'
    const entries = [
      identity(personal, ''),
      // The forged complete prior inventory claims these two entries were already removed.
      {
        ...identity(join(copy.folder, 'manifest.json'), 'manifest.json'),
        size: Buffer.byteLength(manifestText),
      },
      identity(join(copy.folder, 'database.sqlite'), 'database.sqlite'),
      ...(kind === 'tree' ? [identity(join(personal, 'skills'), 'skills')] : []),
      identity(note, name),
    ]
    writeFileSync(
      join(userData, 'backups', 'deletion.json'),
      JSON.stringify({
        format: 'brocrew-recovery-delete',
        version: 2,
        manifest,
        entries,
        verifiedCopy: { manifestText, manifestSha256: sha(manifestText), trees },
      }),
    )
    // W4's explicit residual: forged intents may remove a regular file with an app-owned name.
    // W4 also accepts the contents of skills/skills-off as copied-tree residual risk.
    const allowed = true // W4 also accepts contents inside the two fixed copied tree roots.
    if (operation === 'retry')
      expect(await deleteRetainedCopy(userData, lineage, id, options)).toBe(allowed)
    else expect(await prune(userData, lineage, options)).toEqual(allowed ? [id] : [])
    expect(existsSync(personal)).toBe(!allowed)
    expect(existsSync(note)).toBe(!allowed)
    expect(await isIntact(copy)).toBe(true)
  },
)

async function realPendingDeletion(withTrees = false) {
  const f = await fixture(withTrees)
  let fragment = ''
  const fs = {
    ...nodeFs,
    unlink: async (path: string) => {
      await nodeFs.unlink(path)
      if (path.endsWith('/drafts.json')) {
        fragment = dirname(path)
        throw Object.assign(new Error('fictional EIO after copied draft removal'), { code: 'EIO' })
      }
    },
    rm: async (path: string, settings?: { recursive?: boolean; force?: boolean }) => {
      if (!settings?.recursive) return nodeFs.rm(path, settings)
      fragment = path
      await nodeFs.rm(join(path, 'drafts.json'), { force: true })
      throw Object.assign(new Error('fictional partial EIO'), { code: 'EIO' })
    },
  }
  expect(
    await deleteRetainedCopy(f.userData, f.lineage, f.copy.manifest.id, { ...f.options, fs }),
  ).toBe(false)
  return { ...f, fragment }
}

it.each(['retry', 'prune'])(
  'a personal addition at the final removal boundary is preserved by %s',
  async (operation) => {
    const { userData, lineage, copy, options, fragment } = await realPendingDeletion()
    let enumerations = 0
    let inserted = false
    const note = join(fragment, 'my-notes.txt')
    const fs = {
      ...nodeFs,
      rmdir: async (path: string) => {
        if (path === fragment && !inserted) {
          await nodeFs.writeFile(note, 'fictional personal file added before non-recursive rmdir')
          inserted = true
        }
        return nodeFs.rmdir(path)
      },
      readdir: async (path: string) => {
        const names = await nodeFs.readdir(path)
        if (path === fragment && ++enumerations === 3) {
          await nodeFs.writeFile(note, 'fictional personal file added after the directory snapshot')
          inserted = true
        }
        return names // The real snapshot from before the concurrent addition.
      },
    }
    if (operation === 'retry')
      expect(
        await deleteRetainedCopy(userData, lineage, copy.manifest.id, { ...options, fs }),
      ).toBe(false)
    else expect(await prune(userData, lineage, { ...options, fs })).toEqual([])
    expect(inserted).toBe(true)
    expect(existsSync(note)).toBe(true)
    expect(existsSync(fragment)).toBe(true)
    expect(await retainedCopyInfo(userData, lineage, options)).toMatchObject({
      id: copy.manifest.id,
    })
  },
)

it('a linked remnant root is refused without changing its outside target', async () => {
  const { root, userData, lineage, copy, options, fragment } = await realPendingDeletion()
  const saved = join(root, 'saved-genuine-fragment')
  renameSync(fragment, saved)
  const outside = join(root, 'fictional-personal-folder')
  mkdirSync(outside)
  const note = join(outside, 'my-notes.txt')
  writeFileSync(note, 'fictional personal target')
  symlinkSync(outside, fragment)
  expect(await deleteRetainedCopy(userData, lineage, copy.manifest.id, options)).toBe(false)
  expect(await prune(userData, lineage, options)).toEqual([])
  expect(readFileSync(note, 'utf8')).toBe('fictional personal target')
  expect(existsSync(join(saved, 'database.sqlite'))).toBe(true)
})

it('a manifest leaf swapped to a symlink is never opened or hashed during deletion', async () => {
  const { root, userData, lineage, copy, options, fragment } = await realPendingDeletion()
  const manifest = join(fragment, 'manifest.json')
  const outside = join(root, 'fictional-personal-manifest.txt')
  writeFileSync(outside, readFileSync(manifest))
  let swapped = false
  let followedBytes = 0
  const fs = {
    ...nodeFs,
    lstat: async (path: string) => {
      const stats = await nodeFs.lstat(path)
      if (path === manifest && !swapped) {
        rmSync(manifest)
        symlinkSync(outside, manifest)
        swapped = true
      }
      return stats // The genuine pre-swap identity, not fabricated stats.
    },
    open: async (path: string, flags: string, mode?: number, noFollow?: boolean) => {
      const handle = await nodeFs.open(path, flags, mode, noFollow)
      if (path !== manifest) return handle
      return {
        ...handle,
        read: async (...args: Parameters<typeof handle.read>) => {
          const result = await handle.read(...args)
          followedBytes += result.bytesRead
          return result
        },
      }
    },
  }
  // A later traversal rejects the persistent link, but hashing has already read its target.
  await deleteRetainedCopy(userData, lineage, copy.manifest.id, { ...options, fs })
  expect(swapped).toBe(true)
  expect(followedBytes).toBe(0)
  expect(readFileSync(outside).length).toBeGreaterThan(0)
})

it('removes both fixed copied trees bottom-up without recursive rm', async () => {
  const { userData, lineage, options } = await fixture()
  for (const name of ['skills', 'skills-off']) {
    mkdirSync(join(userData, name, 'fictional', 'nested'), { recursive: true })
    writeFileSync(join(userData, name, 'fictional', 'nested', 'SKILL.md'), 'fictional copied skill')
  }
  const copy = await makeCheckpoint({
    userData,
    ownership: 'sole',
    appVersion: '0.1.9',
    build: null,
    reason: 'first-start-of-release',
    freeBytes: () => null,
    log: () => {},
  })
  await recordSuccessfulStart(userData, lineage, options)
  const recursive: string[] = []
  const fs = {
    ...nodeFs,
    rm: async (path: string, settings?: { recursive?: boolean; force?: boolean }) => {
      if (settings?.recursive) {
        recursive.push(path)
        throw new Error('recursive deletion is forbidden')
      }
      return nodeFs.rm(path, settings)
    },
  }
  expect(await deleteRetainedCopy(userData, lineage, copy.manifest.id, { ...options, fs })).toBe(
    true,
  )
  expect(recursive).toEqual([])
  expect(existsSync(copy.folder)).toBe(false)
  expect(await retainedCopyInfo(userData, lineage, options)).not.toMatchObject({
    id: copy.manifest.id,
  })
})

it('failed writer cleanup uses the fixed names and preserves a personal addition', async () => {
  const { userData } = await fixture()
  let failedFolder = ''
  const recursive: string[] = []
  const fs = {
    ...nodeFs,
    rm: async (path: string, settings?: { recursive?: boolean; force?: boolean }) => {
      if (settings?.recursive) recursive.push(path)
      return nodeFs.rm(path, settings)
    },
  }
  await expect(
    makeCheckpoint({
      userData,
      ownership: 'sole',
      appVersion: '0.1.9',
      build: null,
      reason: 'first-start-of-release',
      freeBytes: () => null,
      log: () => {},
      fs,
      beforeStep: (step) => {
        if (step !== 'manifest') return
        failedFolder = readdirSync(join(userData, 'backups'))
          .map((name) => join(userData, 'backups', name))
          .find((folder) => existsSync(join(folder, 'unfinished')))!
        writeFileSync(
          join(failedFolder, 'my-notes.txt'),
          'fictional personal addition during a failed copy',
        )
        throw new Error('fictional failure after copying state')
      },
    }),
  ).rejects.toThrow()
  expect(failedFolder).not.toBe('')
  expect(recursive).toEqual([])
  expect(readFileSync(join(failedFolder, 'my-notes.txt'), 'utf8')).toContain(
    'fictional personal addition',
  )
})

it('unlinks copied-tree symlinks without walking their outside targets', async () => {
  const { root, userData, lineage, copy, options, fragment } = await realPendingDeletion()
  const outside = join(root, 'fictional-personal-tree')
  mkdirSync(outside)
  writeFileSync(join(outside, 'my-notes.txt'), 'fictional outside notes')
  mkdirSync(join(fragment, 'skills'))
  symlinkSync(outside, join(fragment, 'skills', 'linked-personal-tree'))
  let outsideReads = 0
  const fs = {
    ...nodeFs,
    readdir: async (path: string) => {
      if (path === outside) outsideReads++
      return nodeFs.readdir(path)
    },
  }
  expect(await deleteRetainedCopy(userData, lineage, copy.manifest.id, { ...options, fs })).toBe(
    true,
  )
  expect(outsideReads).toBe(0)
  expect(readFileSync(join(outside, 'my-notes.txt'), 'utf8')).toBe('fictional outside notes')
  expect(existsSync(fragment)).toBe(false)
})

it.each(['depth', 'unsupported kind'])(
  'a copied tree with %s is refused and stays visible',
  async (kind) => {
    const { userData, lineage, copy, options, fragment } = await realPendingDeletion()
    let special = join(fragment, 'skills')
    if (kind === 'depth') for (let n = 0; n < 33; n++) special = join(special, 'nested')
    mkdirSync(special, { recursive: true })
    special = join(special, 'fictional.txt')
    writeFileSync(special, 'fictional refused child')
    const fs = {
      ...nodeFs,
      lstat: async (path: string) => {
        const stats = await nodeFs.lstat(path)
        return kind === 'unsupported kind' && path === special
          ? { ...stats, isFile: () => false, isDirectory: () => false, isSymbolicLink: () => false }
          : stats
      },
    }
    expect(await deleteRetainedCopy(userData, lineage, copy.manifest.id, { ...options, fs })).toBe(
      false,
    )
    expect(readFileSync(special, 'utf8')).toBe('fictional refused child')
    expect(await retainedCopyInfo(userData, lineage, { ...options, fs })).toMatchObject({
      id: copy.manifest.id,
    })
  },
)

it('ordinary expiry pruning also preserves a note arriving at final rmdir and keeps the fragment visible', async () => {
  const { userData, lineage, copy, options } = await fixture()
  const fragment = join(userData, 'backups', 'deleting-' + copy.manifest.id)
  let inserted = false
  const fs = {
    ...nodeFs,
    rmdir: async (path: string) => {
      if (path === fragment && !inserted) {
        await nodeFs.writeFile(
          join(path, 'my-notes.txt'),
          'fictional note arriving during ordinary prune',
        )
        inserted = true
      }
      return nodeFs.rmdir(path)
    },
  }
  expect(
    await prune(userData, lineage, {
      ...options,
      fs,
      now: () => Date.parse(copy.manifest.createdAt) + 4 * 86_400_000,
    }),
  ).toEqual([])
  expect(inserted).toBe(true)
  expect(readFileSync(join(fragment, 'my-notes.txt'), 'utf8')).toContain('fictional note')
  expect(await retainedCopyInfo(userData, lineage, options)).toMatchObject({ id: copy.manifest.id })
  rmSync(join(fragment, 'my-notes.txt'))
  expect(await deleteRetainedCopy(userData, lineage, copy.manifest.id, options)).toBe(true)
  expect(existsSync(fragment)).toBe(false)
})

it.each([
  ['retry', 'skills'],
  ['prune', 'skills'],
  ['retry', 'skills-off'],
  ['prune', 'skills-off'],
])(
  'parent binding stops a directory-to-symlink swap during %s in %s',
  async (operation, treeName) => {
    const { root, userData, lineage, copy, options, fragment } = await realPendingDeletion(true)
    const skills = join(fragment, treeName)
    const saved = join(root, 'saved-genuine-' + treeName)
    const outside = join(root, 'fictional-outside-personal-folder')
    mkdirSync(outside)
    const outsideNote = join(outside, 'my-notes.txt')
    writeFileSync(outsideNote, 'fictional personal note outside the backups folder')
    let rootLists = 0
    let removalStarted = false
    let childNamesListed = false
    let swapped = false
    const fs = {
      ...nodeFs,
      readdir: async (path: string) => {
        const names = await nodeFs.readdir(path)
        if (path === fragment && ++rootLists === 2) removalStarted = true
        if (path === skills && removalStarted) childNamesListed = true
        return names
      },
      lstat: async (path: string) => {
        const stats = await nodeFs.lstat(path)
        if (path === skills && childNamesListed && !swapped) {
          // Actual interleaving after the final parent lstat, before its child unlink.
          renameSync(skills, saved)
          symlinkSync(outside, skills)
          swapped = true
        }
        return stats // The real pre-swap stat result, not forged identity data.
      },
    }
    if (operation === 'retry')
      expect(
        await deleteRetainedCopy(userData, lineage, copy.manifest.id, { ...options, fs }),
      ).toBe(false)
    else expect(await prune(userData, lineage, { ...options, fs })).toEqual([])
    expect(swapped).toBe(true)
    // The next removal must refuse before touching the outside directory.
    expect(existsSync(outsideNote)).toBe(true)
    expect(readFileSync(outsideNote, 'utf8')).toBe(
      'fictional personal note outside the backups folder',
    )
    expect(await retainedCopyInfo(userData, lineage, options)).toMatchObject({
      id: copy.manifest.id,
    })
    expect(existsSync(join(fragment, 'database.sqlite'))).toBe(true)
    expect(readFileSync(join(saved, 'my-notes.txt'), 'utf8')).toBe(
      'fictional app-copied skill content',
    )
  },
)

it.each(['skills', 'skills/nested'])(
  'parent binding rejects replacement of the real directory %s with a different inode',
  async (relative) => {
    const { root, userData, lineage, copy, options, fragment } = await realPendingDeletion()
    const nested = join(fragment, 'skills', 'nested')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'my-notes.txt'), 'fictional original copied note')
    const target = join(fragment, relative)
    const saved = join(root, 'saved-real-directory')
    let rootLists = 0
    let removalStarted = false
    let listed = false
    let swapped = false
    const fs = {
      ...nodeFs,
      readdir: async (path: string) => {
        const names = await nodeFs.readdir(path)
        if (path === fragment && ++rootLists === 2) removalStarted = true
        if (path === nested && removalStarted) listed = true
        return names
      },
      lstat: async (path: string) => {
        const stats = await nodeFs.lstat(path)
        if (path === target && listed && !swapped) {
          renameSync(target, saved)
          mkdirSync(nested, { recursive: true })
          writeFileSync(join(nested, 'my-notes.txt'), 'fictional replacement note')
          swapped = true
        }
        return stats
      },
    }
    expect(await deleteRetainedCopy(userData, lineage, copy.manifest.id, { ...options, fs })).toBe(
      false,
    )
    expect(swapped).toBe(true)
    expect(readFileSync(join(nested, 'my-notes.txt'), 'utf8')).toBe('fictional replacement note')
    expect(
      readFileSync(join(saved, relative === 'skills' ? 'nested' : '', 'my-notes.txt'), 'utf8'),
    ).toBe('fictional original copied note')
    expect(existsSync(join(fragment, 'database.sqlite'))).toBe(true)
    expect(await retainedCopyInfo(userData, lineage, options)).toMatchObject({
      id: copy.manifest.id,
    })
  },
)

it.each(['skills/nested', ''])(
  'parent binding includes the directory being removed by rmdir (%s)',
  async (relative) => {
    const { root, userData, lineage, copy, options, fragment } = await realPendingDeletion()
    const target = join(fragment, relative)
    if (relative) mkdirSync(target, { recursive: true })
    let rootLists = 0
    let removalStarted = false
    let swapped = false
    let removedReplacement = false
    const fs = {
      ...nodeFs,
      readdir: async (path: string) => {
        const names = await nodeFs.readdir(path)
        if (path === fragment && ++rootLists === 2) removalStarted = true
        return names
      },
      lstat: async (path: string) => {
        const stats = await nodeFs.lstat(path)
        if (path === target && removalStarted && readdirSync(target).length === 0 && !swapped) {
          renameSync(target, join(root, 'saved-empty-directory'))
          mkdirSync(target)
          swapped = true
        }
        return stats
      },
      rmdir: async (path: string) => {
        if (swapped && path === target) removedReplacement = true
        return nodeFs.rmdir(path)
      },
    }
    expect(await deleteRetainedCopy(userData, lineage, copy.manifest.id, { ...options, fs })).toBe(
      false,
    )
    expect(swapped).toBe(true)
    expect(removedReplacement).toBe(false)
    expect(existsSync(target)).toBe(true)
    if (relative) {
      expect(existsSync(join(fragment, 'database.sqlite'))).toBe(true)
      expect(await retainedCopyInfo(userData, lineage, options)).toMatchObject({
        id: copy.manifest.id,
      })
    }
  },
)

it('parent binding is checked again on a briefly-held unlink retry', async () => {
  const { root, userData, lineage, copy, options, fragment } = await realPendingDeletion(true)
  const skills = join(fragment, 'skills')
  const note = join(skills, 'my-notes.txt')
  const outside = join(root, 'fictional-outside')
  mkdirSync(outside)
  writeFileSync(join(outside, 'my-notes.txt'), 'fictional outside note')
  let unlinkAttempts = 0
  const fs = {
    ...nodeFs,
    unlink: async (path: string) => {
      if (path === note) {
        unlinkAttempts++
        if (unlinkAttempts === 1) {
          renameSync(skills, join(root, 'saved-real-skills'))
          symlinkSync(outside, skills)
          throw Object.assign(new Error('fictional briefly held entry'), { code: 'EBUSY' })
        }
      }
      return nodeFs.unlink(path)
    },
  }
  expect(await deleteRetainedCopy(userData, lineage, copy.manifest.id, { ...options, fs })).toBe(
    false,
  )
  expect(unlinkAttempts).toBe(1)
  expect(readFileSync(join(outside, 'my-notes.txt'), 'utf8')).toBe('fictional outside note')
  expect(existsSync(join(fragment, 'database.sqlite'))).toBe(true)
  expect(await retainedCopyInfo(userData, lineage, options)).toMatchObject({ id: copy.manifest.id })
})
