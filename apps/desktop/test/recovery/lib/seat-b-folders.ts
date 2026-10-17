import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, sep } from 'node:path'
import type {
  OfferedCheckpoint,
  ProgressListener,
  RecoveryService,
  StartupVerdict,
} from '../../../src/shared/recovery'
import {
  createRecoveryServiceForTests,
  type RecoveryTestOptions,
} from '../../../src/main/recovery/coordinator'
import { STEPS, type Step } from '../../../src/main/recovery/contract'
import { nodeFs, type RecoveryFs } from '../../../src/main/recovery/files'
import { journalFile } from '../../../src/main/recovery/layout'
import {
  BUILD_LINEAGE,
  MIGRATIONS_FOLDER,
  NEWER_MIGRATION,
  THIS_VERSION,
  makeRecoveryFixture,
  type RecoveryFixture,
  type RecoveryFixtureOptions,
} from './recovery-fixture'

/**
 * Helpers for the release-gate tests: real data folders laid down once and copied per case, the
 * real recovery service over them, and ways to read what a folder holds without changing it.
 */

/** Temporary folders made by one test file, removed by {@link Scratch.clear}. */
export class Scratch {
  private readonly roots: string[] = []

  async root(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'brobot2-seat-b-'))
    this.roots.push(root)
    return root
  }

  async clear(): Promise<void> {
    for (const root of this.roots.splice(0)) await rm(root, { recursive: true, force: true })
  }
}

/** A data folder laid down once, and copied for each case so every case starts the same. */
export interface Template {
  readonly userData: string
  readonly fixture: RecoveryFixture
}

export async function aTemplate(
  scratch: Scratch,
  options: RecoveryFixtureOptions,
): Promise<Template> {
  const userData = join(await scratch.root(), 'data')
  return { userData, fixture: await makeRecoveryFixture(userData, options) }
}

/** A fresh copy of `template`'s data folder, file times kept. */
export async function aCopyOf(scratch: Scratch, template: Template): Promise<string> {
  const userData = join(await scratch.root(), 'data')
  await cp(template.userData, userData, { recursive: true, preserveTimestamps: true })
  return userData
}

/** The real file system without its flushes, which a stop simulated in this process cannot see. */
export const UNFLUSHED: RecoveryFs = {
  ...nodeFs,
  open: async (path, flags, mode) => {
    const handle = await nodeFs.open(path, flags, mode)
    return { ...handle, sync: () => Promise.resolve() }
  },
}

/** The real recovery service on `userData`, as this build (its own schema, version 0.1.0) runs it. */
export function aService(
  userData: string,
  more: Partial<RecoveryTestOptions> = {},
): RecoveryService {
  return createRecoveryServiceForTests({
    userData,
    migrationsFolder: MIGRATIONS_FOLDER,
    appVersion: THIS_VERSION,
    ownership: 'sole',
    log: () => undefined,
    ...more,
  })
}

export const quiet: ProgressListener = () => undefined

/** The copy a `newer` verdict offers; throws for any other verdict. */
export function offerOf(verdict: StartupVerdict): OfferedCheckpoint {
  if (verdict.kind !== 'newer' || verdict.offers === null) {
    throw new Error(`expected a newer verdict with an offer, got ${JSON.stringify(verdict)}`)
  }
  return verdict.offers
}

export function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Every file under `root` by its `/`-separated path, with the sha256 of its bytes. */
export function filesIn(root: string): Record<string, string> {
  const files: Record<string, string> = {}
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) walk(path)
      else files[relative(root, path).split(sep).join('/')] = sha256(readFileSync(path))
    }
  }
  if (existsSync(root)) walk(root)
  return files
}

/** `files` without the entries under `folder`. */
export function without(files: Record<string, string>, folder: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).filter(([path]) => !path.startsWith(`${folder}/`)),
  )
}

/** The step the restore journal on disk names, or null when there is none. */
export function journalStep(userData: string): string | null {
  const path = journalFile(userData)
  if (!existsSync(path)) return null
  return (JSON.parse(readFileSync(path, 'utf8')) as { step: string }).step
}

/** The step a journal names when a run stops before `step` begins, or after its work: the one before. */
export function stepBefore(step: Step): Step | null {
  return STEPS[STEPS.indexOf(step) - 1] ?? null
}

/**
 * The conversation ids a database holds, oldest first, read from a scratch copy of the file and
 * whichever of its sidecars are beside it, so the folder itself is never opened.
 */
export async function conversationsIn(database: string): Promise<string[]> {
  const folder = await mkdtemp(join(tmpdir(), 'brobot2-seat-b-read-'))
  try {
    const copy = join(folder, basename(database))
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      if (existsSync(`${database}${suffix}`))
        await copyFile(`${database}${suffix}`, `${copy}${suffix}`)
    }
    const db = new Database(copy)
    try {
      const rows = db.prepare('SELECT id FROM provider_session ORDER BY created_at, id').all() as {
        id: string
      }[]
      return rows.map((row) => row.id)
    } finally {
      db.close()
    }
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

/** A migrations folder holding this build's migrations and one more after them. */
export async function aBuildWithOneMoreMigration(scratch: Scratch): Promise<string> {
  const folder = join(await scratch.root(), 'migrations')
  await mkdir(join(folder, 'meta'), { recursive: true })
  for (const name of await readdir(MIGRATIONS_FOLDER)) {
    if (name.endsWith('.sql')) await copyFile(join(MIGRATIONS_FOLDER, name), join(folder, name))
  }
  // The text whose hash a database one migration newer records for its newest migration.
  const tag = `${String(BUILD_LINEAGE.length).padStart(4, '0')}_one_more`
  await writeFile(join(folder, `${tag}.sql`), '-- a migration only a newer BroBot carries\n')
  const journal = JSON.parse(
    await readFile(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Record<string, unknown>[] }
  const last = journal.entries.at(-1) ?? {}
  journal.entries.push({
    ...last,
    idx: journal.entries.length,
    when: NEWER_MIGRATION.createdAt,
    tag,
  })
  await writeFile(join(folder, 'meta', '_journal.json'), JSON.stringify(journal))
  return folder
}

/** One rename of a restore or return: a participant, by its live name, and where it went. */
export interface Move {
  readonly live: string
  readonly to: 'aside' | 'live'
}

/**
 * The move a rename makes, read from its paths: into the data folder is a file arriving live, out
 * of it a file set aside. Renames inside `recovery/` (the records) are not moves.
 */
export function moveOf(userData: string, from: string, to: string): Move | null {
  if (dirname(to) === userData) return { live: basename(to), to: 'live' }
  if (dirname(from) === userData) return { live: basename(from), to: 'aside' }
  return null
}

/** Where a simulated crash ends the process. */
export type CrashPoint =
  | { readonly before: Step }
  | { readonly after: Step }
  | { readonly move: Move; readonly when: 'before' | 'after' }

export function saidOf(point: CrashPoint): string {
  if ('before' in point) return `before ${point.before}`
  if ('after' in point) return `after ${point.after}, before its journal names it`
  return `${point.when} ${point.move.live} moves ${point.move.to}`
}

export interface Crashing {
  readonly fs: RecoveryFs
  /** Whether the crash point was reached. */
  readonly crashed: () => boolean
  /** Every move made, in order. */
  readonly moves: readonly Move[]
}

function crash(): Error {
  return Object.assign(new Error('ECRASH: the process stopped here'), { code: 'ECRASH' })
}

/**
 * A file system that stops changing anything once `point` is reached, as if the process ended
 * there; reads keep working, so the in-process clean-up that follows a stop finds the disk as the
 * crash left it and cannot change it. With `point` null it never stops, and only records moves.
 *
 * - `before` a step: the first change after the journal naming the step before it is in place;
 * - `after` a step: the rename that would put the journal naming it in place;
 * - a move: just before or just after that rename.
 */
export function crashingAt(userData: string, point: CrashPoint | null): Crashing {
  const real = UNFLUSHED
  const journal = journalFile(userData)
  const moves: Move[] = []
  let dead = false
  let published: Step | null = null

  const change = async <T>(op: () => Promise<T>): Promise<T> => {
    if (!dead && point !== null && 'before' in point && published === stepBefore(point.before)) {
      dead = true
    }
    if (dead) throw crash()
    return op()
  }

  const rename = async (from: string, to: string): Promise<void> => {
    await change(() => Promise.resolve())
    if (to === journal) {
      const step = (JSON.parse(await real.readFile(from)) as { step: Step }).step
      if (point !== null && 'after' in point && step === point.after) {
        dead = true
        throw crash()
      }
      await real.rename(from, to)
      published = step
      return
    }
    const move = moveOf(userData, from, to)
    const here =
      move !== null &&
      point !== null &&
      'move' in point &&
      point.move.live === move.live &&
      point.move.to === move.to
    if (here && point.when === 'before') {
      dead = true
      throw crash()
    }
    await real.rename(from, to)
    if (move !== null) moves.push(move)
    if (here) dead = true
  }

  const fs: RecoveryFs = {
    ...real,
    rename,
    copyFile: (from, to, mode) => change(() => real.copyFile(from, to, mode)),
    link: (existing, name) => change(() => real.link(existing, name)),
    unlink: (path) => change(() => real.unlink(path)),
    rm: (path, options) => change(() => real.rm(path, options)),
    mkdir: (path, options) => change(() => real.mkdir(path, options)),
    rmdir: (path) => change(() => real.rmdir(path)),
    mkdtemp: (prefix) => change(() => real.mkdtemp(prefix)),
    writeFile: (path, data, options) => change(() => real.writeFile(path, data, options)),
    chmod: (path, mode) => change(() => real.chmod(path, mode)),
    open: async (path, flags, mode) => {
      if (flags === 'r') return real.open(path, flags, mode)
      const handle = await change(() => real.open(path, flags, mode))
      return { ...handle, writeFile: (data) => change(() => handle.writeFile(data)) }
    },
  }
  return { fs, crashed: () => dead, moves }
}
