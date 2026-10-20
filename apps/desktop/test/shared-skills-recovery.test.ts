import { createHash } from 'node:crypto'
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { BUILT_IN_SKILL_NAMES } from '../src/shared/built-in-skills'
import { verifyBuiltInSkills } from '../src/main/skills/built-in-catalogue'
import { SqliteSkillCatalogue } from '../src/main/skills/catalogue-store'
import { SharedSkillLibrary } from '../src/main/skills/shared-library'
import { convertSharedSkills } from '../src/main/skills/shared-conversion'
import { makeCheckpoint, isIntact, listCheckpoints } from '../src/main/recovery/checkpoint'
import { readSkillTree } from '../src/main/recovery/trees'
import { nodeFs, type RecoveryFs } from '../src/main/recovery/files'
import { restore, returnToNewer, recoverInterrupted } from '../src/main/recovery/restore'
import { buildLineage, isLineagePrefix } from '../src/main/recovery/database-facts'
import { howTheDatabaseFits } from '../src/main/db/newer-database'
import { readStateEntry, skillTreeStateDigest } from '../../../scripts/lib/skill-tree-state.mjs'
import { stateFileNames, verifyCheckpoint, stateKept } from '../../../scripts/lib/upgrade-path.mjs'
import {
  dataOf,
  copyHoldsTheData,
  verifyCheckpoint as rehearsalCheckpoint,
} from '../../../scripts/lib/update-rehearsal-data.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const migrations = join(here, '../src/main/db/migrations')
const resources = join(here, '../resources/built-in-skills')
let root: string
let handles: AppDatabase[]
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fictional-skills-recovery-'))
  handles = []
})
afterEach(async () => {
  for (const db of handles) if (db.open) db.close()
  await rm(root, { recursive: true, force: true })
})
function database(file = join(root, 'brobot2.sqlite')) {
  const db = openDatabase(file)
  handles.push(db)
  return db
}
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const body =
  '---\nname: recipe-check\ndescription: Check a fictional recipe.\n---\n\nA fictional personal skill.\n'
const draft = {
  name: 'recipe-check',
  description: 'Check a fictional recipe.',
  reminder: 'Check the recipe.',
  body,
  bytes: Buffer.byteLength(body),
  path: 'recipe-check/SKILL.md',
  sha256: sha256(body),
}
async function shipped() {
  return verifyBuiltInSkills(
    JSON.parse(await readFile(join(resources, 'manifest.json'), 'utf8')),
    new Map(
      await Promise.all(
        BUILT_IN_SKILL_NAMES.map(
          async (name) =>
            [name, await readFile(join(resources, name, 'SKILL.md'), 'utf8')] as const,
        ),
      ),
    ),
  )
}
const checkpoint = (fs: RecoveryFs = nodeFs) =>
  makeCheckpoint({
    userData: root,
    ownership: 'sole',
    appVersion: 'fictional-shared-skills',
    build: 'fictional-build',
    reason: 'first-start-of-release',
    freeBytes: () => 10_000_000_000,
    log: () => {},
    fs,
  })
async function initialize() {
  const db = database()
  applyMigrations(db, migrations)
  const source = await shipped()
  const store = new SqliteSkillCatalogue(db, source)
  store.savePersonal(draft, store.list().revision)
  return { db, source, store }
}

describe('shared skills follow checkpoint, restore, return and upgrade', () => {
  it('exports saved personal skills once without exporting built-ins or changing their sources', async () => {
    const { db, source, store } = await initialize()
    const before = db.prepare('SELECT * FROM skill_version ORDER BY id').all()
    const builtin = store.detail('built-in/delegate')!
    await expect(convertSharedSkills(root, db)).resolves.toBeUndefined()
    expect(await readdir(join(root, 'skills'))).toEqual(['recipe-check'])
    expect(await readFile(join(root, 'skills/recipe-check/SKILL.md'), 'utf8')).toBe(body)
    expect(store.detail('built-in/delegate')).toEqual(builtin)
    expect(db.prepare('SELECT * FROM skill_version ORDER BY id').all()).toEqual(before)
    expect(await shipped()).toEqual(source)
    await new SharedSkillLibrary(root).save('recipe-check/SKILL.md', 'Edited shared bytes.')
    await convertSharedSkills(root, db)
    expect(await readFile(join(root, 'skills/recipe-check/SKILL.md'), 'utf8')).toBe(
      'Edited shared bytes.',
    )
  })
  it('recovers active/off folders, binary assets, executable scripts and import receipts, then returns to newer bytes', async () => {
    const { db } = await initialize()
    await convertSharedSkills(root, db)
    const library = new SharedSkillLibrary(root)
    await library.save('recipe-check/assets/picture.bin', new Uint8Array([0, 255, 9]))
    await library.save('recipe-check/check.sh', '#!/bin/sh\nexit 0\n')
    await chmod(join(library.active, 'recipe-check/check.sh'), 0o700)
    await mkdir(join(library.off, 'later-skill'))
    await writeFile(join(library.off, 'later-skill/SKILL.md'), 'A fictional off skill.')
    const older = await readSkillTree(library.active)
    const olderOff = await readSkillTree(library.off)
    const olderMarker = await readFile(join(root, 'skills-conversion.json'), 'utf8')
    db.close()
    const saved = await checkpoint()
    expect(await isIntact(saved)).toBe(true)
    await library.save('recipe-check/SKILL.md', 'Newer shared bytes.')
    await rename(join(library.off, 'later-skill'), join(library.active, 'later-skill'))
    const newSource = join(root, 'provider-homes/default/cora/codex/skills/another-skill')
    await mkdir(newSource, { recursive: true })
    await writeFile(join(newSource, 'SKILL.md'), 'A new fictional imported skill.')
    await library.convert(async () => [])
    const newerMarker = await readFile(join(root, 'skills-conversion.json'), 'utf8')
    expect(newerMarker).not.toBe(olderMarker)
    const newer = await readSkillTree(library.active)
    const newerOff = await readSkillTree(library.off)
    const lineage = await buildLineage(migrations)
    await restore({
      userData: root,
      checkpointId: saved.manifest.id,
      canOpen: (one) => isLineagePrefix(one, lineage),
    })
    expect((await readSkillTree(library.active)).sha256).toBe(older.sha256)
    expect((await readSkillTree(library.off)).sha256).toBe(olderOff.sha256)
    expect(await readFile(join(root, 'skills-conversion.json'), 'utf8')).toBe(olderMarker)
    await returnToNewer({ userData: root })
    expect((await readSkillTree(library.active)).sha256).toBe(newer.sha256)
    expect((await readSkillTree(library.off)).sha256).toBe(newerOff.sha256)
    expect(await readFile(join(root, 'skills-conversion.json'), 'utf8')).toBe(newerMarker)
    await convertSharedSkills(root, database())
    expect((await readSkillTree(library.active)).sha256).toBe(newer.sha256)
  })
  it('can restore an older checkpoint with no skill directories and return without losing them', async () => {
    const db = database()
    applyMigrations(db, migrations)
    db.close()
    const old = await checkpoint()
    const library = new SharedSkillLibrary(root)
    await library.convert(async () => [{ id: 'person/recipe-check', name: 'recipe-check', body }])
    const before = await readSkillTree(library.active)
    await restore({ userData: root, checkpointId: old.manifest.id, canOpen: () => true })
    await expect(readFile(join(root, 'skills-conversion.json'))).rejects.toHaveProperty(
      'code',
      'ENOENT',
    )
    await expect(readdir(library.active)).rejects.toHaveProperty('code', 'ENOENT')
    await returnToNewer({ userData: root })
    expect((await readSkillTree(library.active)).sha256).toBe(before.sha256)
    await library.convert(async () => {
      throw new Error('must not export again')
    })
    expect((await readSkillTree(library.active)).sha256).toBe(before.sha256)
  })
  it('settles an interruption after a skill directory rename with all tree bytes intact', async () => {
    const { db } = await initialize()
    await convertSharedSkills(root, db)
    db.close()
    const saved = await checkpoint()
    const library = new SharedSkillLibrary(root)
    await library.save('recipe-check/SKILL.md', 'Newer bytes.')
    const newer = await readSkillTree(library.active)
    await expect(
      restore({
        userData: root,
        checkpointId: saved.manifest.id,
        canOpen: () => true,
        afterMove: (moved) => {
          if (moved.live === 'skills' && moved.to === 'aside') throw new Error('fictional stop')
        },
      }),
    ).rejects.toThrow()
    expect(await recoverInterrupted({ userData: root })).toHaveProperty('kind', 'finished')
    expect(await readFile(join(library.active, 'recipe-check/SKILL.md'), 'utf8')).toBe(body)
    await returnToNewer({ userData: root })
    expect((await readSkillTree(library.active)).sha256).toBe(newer.sha256)
  })
  it('retries a changing tree before publishing a checked recovery copy', async () => {
    const { db } = await initialize()
    await convertSharedSkills(root, db)
    db.close()
    let changed = false
    const fs: RecoveryFs = {
      ...nodeFs,
      open: async (...args) => {
        const handle = await nodeFs.open(...args)
        if (
          changed ||
          !args[0].includes(`${sep}backups${sep}`) ||
          !args[0].endsWith(join('skills', 'recipe-check', 'SKILL.md')) ||
          args[1] !== 'wx'
        )
          return handle
        changed = true
        return {
          ...handle,
          close: async () => {
            await handle.close()
            await writeFile(
              join(root, 'skills/recipe-check/SKILL.md'),
              'Changed during checkpoint.',
            )
          },
        }
      },
    }
    const saved = await checkpoint(fs)
    expect(changed).toBe(true)
    expect(await isIntact(saved)).toBe(true)
    expect(await readFile(join(saved.folder, 'skills/recipe-check/SKILL.md'), 'utf8')).toBe(
      'Changed during checkpoint.',
    )
  })
  it('finishes an interrupted previous-build restore whose journal predates shared skills', async () => {
    const db = database()
    applyMigrations(db, migrations)
    db.close()
    const saved = await checkpoint()
    await expect(
      restore({
        userData: root,
        checkpointId: saved.manifest.id,
        canOpen: () => true,
        beforeStep: (step) => {
          if (step === 'gate-installed') throw new Error('fictional older restore stop')
        },
      }),
    ).rejects.toThrow()
    const path = join(root, 'recovery/restore-journal.json')
    const journal = JSON.parse(await readFile(path, 'utf8'))
    const added = ['skills', 'skills-off', 'skills-conversion.json']
    journal.participants = journal.participants.filter(
      (one: { live: string }) => !added.includes(one.live),
    )
    await writeFile(path, JSON.stringify(journal))
    await expect(recoverInterrupted({ userData: root })).resolves.toEqual({
      kind: 'finished',
      what: 'restore',
    })
    await expect(returnToNewer({ userData: root })).resolves.toHaveProperty(
      'database',
      join(root, 'brobot2.sqlite'),
    )
  })
  it('retries the tree and receipt together if a writer changes a tree after its copy', async () => {
    const { db } = await initialize()
    await convertSharedSkills(root, db)
    db.close()
    let changed = false
    const fs: RecoveryFs = {
      ...nodeFs,
      copyFile: async (from, to, mode) => {
        await nodeFs.copyFile(from, to, mode)
        if (changed || from !== join(root, 'skills-conversion.json')) return
        changed = true
        await writeFile(
          join(root, 'skills/recipe-check/SKILL.md'),
          'Changed between tree and receipt copies.',
        )
      },
    }
    const saved = await checkpoint(fs)
    expect(changed).toBe(true)
    expect(await isIntact(saved)).toBe(true)
    expect(await readFile(join(saved.folder, 'skills/recipe-check/SKILL.md'), 'utf8')).toBe(
      'Changed between tree and receipt copies.',
    )
  })
  it('detects altered supporting files and refuses to restore a damaged tree', async () => {
    const { db } = await initialize()
    await convertSharedSkills(root, db)
    db.close()
    await new SharedSkillLibrary(root).save(
      'recipe-check/assets/map.bin',
      new Uint8Array([1, 2, 3]),
    )
    const saved = await checkpoint()
    await writeFile(
      join(saved.folder, 'skills/recipe-check/assets/map.bin'),
      new Uint8Array([3, 2, 1]),
    )
    expect(await isIntact(saved)).toBe(false)
    await expect(
      restore({ userData: root, checkpointId: saved.manifest.id, canOpen: () => true }),
    ).rejects.toThrow()
    expect(await readFile(join(root, 'skills/recipe-check/assets/map.bin'))).toEqual(
      Buffer.from([1, 2, 3]),
    )
  })
  it('includes trees in the upgrade snapshot and checkpoint assertion', async () => {
    const { db } = await initialize()
    await convertSharedSkills(root, db)
    db.close()
    const saved = await checkpoint()
    const registry = await readFile(join(here, '../src/main/recovery/state-files.ts'), 'utf8')
    const names = stateFileNames(registry)
    const state = Object.fromEntries(
      await Promise.all(
        names.map(async (name) => {
          try {
            return [name, readStateEntry(join(root, name))]
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [name, undefined]
            throw error
          }
        }),
      ),
    )
    const files = {
      ...state,
      'database.sqlite': await readFile(join(saved.folder, 'database.sqlite')),
    }
    expect(skillTreeStateDigest(files.skills)).toEqual({
      bytes: (await readSkillTree(join(root, 'skills'))).bytes,
      sha256: (await readSkillTree(join(root, 'skills'))).sha256,
    })
    expect(() =>
      verifyCheckpoint(saved.manifest, files, {
        folder: saved.manifest.id,
        workspaceId: saved.manifest.workspaceId,
        reason: saved.manifest.reason,
        version: saved.manifest.madeBy.appVersion,
        build: saved.manifest.madeBy.build,
        lineage: saved.manifest.database.migrations,
        stateFiles: names,
        state,
      }),
    ).not.toThrow()
    expect(stateKept(state, state, names).lost).toEqual([])
    const rehearsal = dataOf(root)
    const copy = { dir: saved.folder, id: saved.manifest.id }
    expect(rehearsal.summary.state.skills).toEqual(skillTreeStateDigest(files.skills))
    expect(rehearsalCheckpoint(copy).problems).toEqual([])
    expect(copyHoldsTheData(copy, rehearsal)).toEqual([])

    const listed = await listCheckpoints(root)
    expect(JSON.stringify(listed)).toContain(saved.manifest.id)
  })
  it('upgrades the prior schema, exports once, and retains the newer-database refusal', async () => {
    const prior = join(root, 'prior-migrations')
    await cp(migrations, prior, { recursive: true })
    const journal = JSON.parse(await readFile(join(prior, 'meta/_journal.json'), 'utf8'))
    const full = [...journal.entries]
    journal.entries.pop()
    await writeFile(join(prior, 'meta/_journal.json'), JSON.stringify(journal))
    const db = database()
    applyMigrations(db, prior)
    applyMigrations(db, migrations)
    const store = new SqliteSkillCatalogue(db, await shipped())
    store.savePersonal(draft, store.list().revision)
    await convertSharedSkills(root, db)
    expect(await readFile(join(root, 'skills/recipe-check/SKILL.md'), 'utf8')).toBe(body)
    const current = await buildLineage(migrations)
    db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(
      sha256('fictional-newer'),
      full.at(-1).when + 1,
    )
    expect(howTheDatabaseFits(db, current).kind).toBe('newer')
    db.close()
  })
})
