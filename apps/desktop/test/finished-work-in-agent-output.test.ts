import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  lstat,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { StorageEngine, type StorageRoots } from '../src/main/storage/engine'
import { finishedWorkIn, withFinishedWork } from '../src/main/storage/finished-work'
import { registerStorageIpc } from '../src/main/storage/ipc'
import type { StorageService } from '../src/main/storage/service'
import { STORAGE_CHANNELS, type StorageDirectory } from '../src/shared/storage'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const DAY = 86_400_000
/** A fictional piece id, also the name of its worker folder. */
const piece = (letter: string) => `work_${letter.repeat(8)}-0000-4000-8000-000000000000`
const [A, B, C, D, D2, E, F, G] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(piece) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
]

let folder: string
let roots: StorageRoots
let db: AppDatabase
let store: SessionStore
let clock = 1_800_000_000_000

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'brocrew-fictional-finished-work-'))
  const data = join(folder, 'data')
  roots = {
    data,
    workspace: join(data, 'brobot-workspace'),
    providers: join(data, 'provider-homes'),
    output: join(data, 'worker-output'),
    database: [join(data, 'brobot2.sqlite')],
    backups: [join(data, 'backups')],
    plugins: null,
    cache: null,
    resources: join(data, 'resources'),
  }
  await mkdir(roots.output, { recursive: true })
  db = openDatabase(roots.database[0]!)
  applyMigrations(db, migrationsDir)
  store = createSessionStore(db, () => clock)
})
afterEach(async () => {
  db.close()
  await rm(folder, { recursive: true, force: true })
})

async function file(path: string, bytes: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, Buffer.alloc(bytes, 65))
}
/** One worker folder the way agents leave them: dependencies, a build and one piece of evidence. */
async function output(name: string): Promise<number> {
  await file(join(roots.output, name, 'node_modules', 'dep', 'index.js'), 3000)
  await file(join(roots.output, name, 'dist', 'app.js'), 2000)
  await file(join(roots.output, name, 'evidence.txt'), 100)
  return 5100
}
function conversation(id: string, cwd: string, root = false): void {
  store.create({
    id,
    provider: 'codex',
    cwd,
    profileId: 'brobot',
    approvalMode: 'ask',
    ...(root ? {} : { parentSessionId: 'giver' }),
  })
}
function give(owner: string, id: string, workFolder: string | null = null): void {
  const root = store.rootOf('giver')!
  const number = store.numberUnder(root.piece)
  const fields = {
    piece: id,
    parent: root.piece,
    givenBy: 'giver',
    title: `Fictional ${id.slice(5, 6)}`,
    brief: 'Fictional work.',
  }
  store.recordGive(
    { ...fields, number, owner, folder: workFolder, inputs: [] },
    store.nextOrdinal(owner),
    { ...fields, type: 'work_given', label: `${root.label}.${number}` },
    clock++,
  )
}
function finish(owner: string, id: string): void {
  store.append(
    owner,
    store.nextOrdinal(owner),
    {
      type: 'work_replied',
      piece: id,
      outcome: 'done',
      summary: 'Fictional answer',
      resources: [],
    },
    clock++,
  )
}
function end(conversationId: string): void {
  db.prepare("UPDATE provider_session SET status = 'ended' WHERE id = ?").run(conversationId)
}
/** Sets when everything inside `path`, and `path` itself, was last written. */
async function lastWritten(path: string, at: Date): Promise<void> {
  if ((await lstat(path)).isDirectory())
    for (const name of await readdir(path)) await lastWritten(join(path, name), at)
  await utimes(path, at, at)
}
/** Every file under the data folder, by path, with its contents' hash. */
async function tree(
  at = roots.data,
  into = new Map<string, string>(),
): Promise<Map<string, string>> {
  for (const name of await readdir(at)) {
    const path = join(at, name)
    const stat = await lstat(path)
    if (stat.isSymbolicLink() || path.startsWith(roots.database[0]!)) continue
    if (stat.isDirectory()) await tree(path, into)
    else
      into.set(
        relative(roots.data, path),
        createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
      )
  }
  return into
}
const ledger = () =>
  JSON.stringify([
    db.prepare('SELECT count(*) AS n FROM events').get(),
    db.prepare('SELECT id, cwd, status FROM provider_session ORDER BY id').all(),
    db.prepare('SELECT id, folder FROM work ORDER BY id').all(),
  ])

async function finishedWork(): Promise<StorageDirectory> {
  const listed = await new StorageEngine(roots).children(
    { part: 'agent-output', segments: [] },
    Infinity,
  )
  return withFinishedWork(listed, roots.database[0]!, () => {})
}

it('lists only ended, unreferenced output, and removes only what the person left ticked', async () => {
  const outside = join(folder, 'elsewhere')
  await file(join(outside, 'precious.txt'), 10)
  await file(join(roots.workspace, 'projects', 'p', 'notes.md'), 10)
  await file(join(roots.resources, 'f'.repeat(64), 'kept.txt'), 10)
  await file(join(roots.providers, 'default', 'projects', 'x.jsonl'), 10)
  await file(join(roots.backups[0]!, 'backup.sqlite'), 10)

  conversation('giver', roots.workspace, true)
  const sizes = new Map<string, number>()
  for (const name of [A, B, C, D, D2, E, G]) sizes.set(name, await output(name))
  await mkdir(join(roots.output, 'card197-x'))
  await file(join(roots.output, 'card197-x', 'notes.txt'), 50)
  await symlink(outside, join(roots.output, F))

  // A: ended, and so is its conversation.
  conversation('holder-a', roots.workspace)
  give('holder-a', A)
  finish('holder-a', A)
  end('holder-a')
  // B: ended, but an idle conversation still works inside it, as a release gate does.
  conversation('holder-b', roots.workspace)
  give('holder-b', B)
  finish('holder-b', B)
  conversation('idler', join(roots.output, B, 'repo'))
  // C: still open.
  conversation('holder-c', roots.workspace)
  give('holder-c', C)
  // D and D2: ended, but an open piece names each as its folder, one relative and one absolute.
  conversation('holder-d', roots.workspace)
  give('holder-d', D)
  finish('holder-d', D)
  give('holder-d', D2)
  finish('holder-d', D2)
  conversation('holder-x', roots.workspace)
  give('holder-x', piece('x'), join('worker-output', D))
  give('holder-x', piece('y'), join(roots.output, D2))
  // E: ended, written to yesterday: still offered, showing when.
  conversation('holder-e', roots.workspace)
  give('holder-e', E)
  finish('holder-e', E)
  await lastWritten(join(roots.output, E), new Date(Date.now() - DAY))
  // G: ended, and so is the conversation that worked inside it.
  conversation('holder-g', join(roots.output, G))
  give('holder-g', G)
  finish('holder-g', G)
  end('holder-g')

  const before = await tree()
  const recorded = ledger()
  const listed = await finishedWork()
  const offered = listed.entries.filter((entry) => !entry.isLink && entry.finished)
  expect(offered.map((entry) => entry.name).sort()).toEqual([A, E, G].sort())
  for (const entry of offered) expect(entry.bytes).toBe(sizes.get(entry.name))
  expect(offered.find((entry) => entry.name === A)).toMatchObject({
    finished: { label: expect.stringMatching(/^W\d+\.\d+$/), title: 'Fictional a' },
  })
  const e = offered.find((entry) => entry.name === E)!
  expect(e.isLink).not.toBe(true)
  const written = e.isLink ? 0 : (e.lastWrittenAt ?? 0)
  expect(written).toBeGreaterThan(Date.now() - 2 * DAY)
  expect(written).toBeLessThan(Date.now() - DAY / 2)
  expect(listed.entries.find((entry) => entry.name === F)).toMatchObject({ isLink: true })
  expect(listed.entries.find((entry) => entry.name === 'card197-x')).not.toHaveProperty('finished')
  // Looking changes nothing.
  expect(await tree()).toEqual(before)
  expect(ledger()).toBe(recorded)

  // While the list stands open, an old conversation reopens in A. The person unticks E and
  // presses Remove: G goes, and A is kept because it is in use again.
  conversation('reopened', join(roots.output, A, 'repo'))
  const reopened = ledger()
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const ipc = {
    handle: (
      channel: string,
      handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
    ) => handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  } as unknown as Pick<IpcMain, 'handle' | 'removeHandler'>
  const service = {
    roots,
    close: () => {},
    run: async (request: { names: readonly string[] }) => ({
      ok: true,
      value: { finished: [...finishedWorkIn(roots.database[0]!, request.names).keys()] },
    }),
  } as unknown as StorageService
  const stop = registerStorageIpc(ipc, service, {
    reveal: () => {},
    clearCache: async () => {},
    pruneBackups: async () => {},
    isAppWindow: () => true,
  })
  const remove = (names: unknown) =>
    handlers.get(STORAGE_CHANNELS.removeFinished)!({} as IpcMainInvokeEvent, names)
  expect(await remove(['../brobot-workspace'])).toEqual({ ok: false, error: 'invalid-location' })
  expect(await remove([A, G])).toEqual({ ok: true, kept: [A] })
  stop()

  const after = await tree()
  const gone = [...before.keys()].filter((path) => !after.has(path))
  expect(gone.sort()).toEqual(
    ['dist/app.js', 'evidence.txt', 'node_modules/dep/index.js'].map((file) =>
      join('worker-output', G, file),
    ),
  )
  for (const [path, hash] of after) expect(before.get(path), path).toBe(hash)
  expect(await readFile(join(outside, 'precious.txt'), 'utf8')).toBe('A'.repeat(10))
  expect(ledger()).toBe(reopened)
  expect(
    (await finishedWork()).entries
      .filter((entry) => !entry.isLink && entry.finished)
      .map((entry) => entry.name),
  ).toEqual([E])
})
