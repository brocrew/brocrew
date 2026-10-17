import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isTheProvidersRecord, readProviderDatabase } from '../src/main/archive/native-file'

/**
 * # b9607dc1 · 5dbf25b2 · F093 R1 — the provider's record guard, and the database copy it reads through
 *
 * `turn-as-sent.test.ts` reaches `isTheProvidersRecord` only through the host, with one Claude file
 * under `projects/` and one outside it; nothing reads its Codex branch, a link, or a folder whose
 * name only starts like `projects`. `user-homes.test.ts` checks that a provider's database gets no
 * `-shm` beside it, never that the private copy is removed after. These are the guard's own edges:
 *
 *  - §1 · ⛔ Claude Code: only under `projects/` — not `projects-old/`, not `projects.jsonl` — ⚑ and
 *    every link followed: a link named like a record that leads elsewhere is not one; a home reached
 *    through a link is still the home.
 *  - §2 · ⛔ Codex: only a `rollout-….jsonl`, only under `sessions/` or `archived_sessions/`.
 *  - §3 · ⛔ `readProviderDatabase` leaves no copy behind, read or failed — ⚑ beside the copy seen
 *    while it is read, so the folder watched is the one it writes to.
 *
 * ⛔ Every folder is a `mkdtemp` one, removed after; §3 points `TMPDIR` at its own and restores it.
 */

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brobot2-record-guard-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A file at `path`, its folders made. */
const aFile = (path: string): string => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '{}\n')
  return path
}

describe('§1 · ⛔ Claude Code: only under projects/, every link followed', () => {
  it('⛔ a folder whose name only starts like projects is not it — ⚑ projects/ itself is', () => {
    const home = join(root, 'home')
    const record = aFile(join(home, 'projects', 'p', 'x.jsonl'))
    expect(isTheProvidersRecord('claude', home, record)).toBe(true)
    expect(isTheProvidersRecord('claude', home, aFile(join(home, 'projects-old', 'x.jsonl')))).toBe(
      false,
    )
    expect(isTheProvidersRecord('claude', home, aFile(join(home, 'projects.jsonl')))).toBe(false)
    // ⛔ …and under projects/, only a `.jsonl`.
    expect(isTheProvidersRecord('claude', home, aFile(join(home, 'projects', 'p', 'x.txt')))).toBe(
      false,
    )
  })

  it('⛔ a link named like a record that leads outside is not one — ⚑ a home reached through a link is still the home', () => {
    const home = join(root, 'home')
    const record = aFile(join(home, 'projects', 'p', 'x.jsonl'))
    const outside = aFile(join(root, 'outside.jsonl'))
    const link = join(home, 'projects', 'p', 'link.jsonl')
    symlinkSync(outside, link)
    // ⚑ The control: the real file beside it is a record.
    expect(isTheProvidersRecord('claude', home, record)).toBe(true)
    // ⛔ The link leads outside the home: not a record.
    expect(isTheProvidersRecord('claude', home, link)).toBe(false)
    // ⚑ The home through a link, the record by its real path — and the other way round.
    const linkedHome = join(root, 'linked-home')
    symlinkSync(home, linkedHome)
    expect(isTheProvidersRecord('claude', linkedHome, record)).toBe(true)
    expect(isTheProvidersRecord('claude', home, join(linkedHome, 'projects', 'p', 'x.jsonl'))).toBe(
      true,
    )
  })
})

describe('§2 · ⛔ Codex: a rollout, under sessions/ or archived_sessions/', () => {
  it('⚑ a rollout in either folder is a record — ⛔ another name, another folder, or Claude’s guard is not', () => {
    const home = join(root, 'home')
    const dated = aFile(join(home, 'sessions', '2026', '10', '05', 'rollout-a.jsonl'))
    const archived = aFile(join(home, 'archived_sessions', 'rollout-b.jsonl'))
    expect(isTheProvidersRecord('codex', home, dated)).toBe(true)
    expect(isTheProvidersRecord('codex', home, archived)).toBe(true)
    // ⛔ Not named as a rollout.
    expect(isTheProvidersRecord('codex', home, aFile(join(home, 'sessions', 'notes.jsonl')))).toBe(
      false,
    )
    expect(
      isTheProvidersRecord('codex', home, aFile(join(home, 'sessions', 'rollout-c.json'))),
    ).toBe(false)
    // ⛔ Not in Codex's folders: Claude's, or one whose name only starts like Codex's.
    expect(
      isTheProvidersRecord('codex', home, aFile(join(home, 'projects', 'rollout-d.jsonl'))),
    ).toBe(false)
    expect(
      isTheProvidersRecord('codex', home, aFile(join(home, 'sessions-old', 'rollout-e.jsonl'))),
    ).toBe(false)
    // ⛔ A Codex rollout is not Claude's record, nor Claude's transcript Codex's.
    expect(isTheProvidersRecord('claude', home, dated)).toBe(false)
    expect(isTheProvidersRecord('codex', home, aFile(join(home, 'projects', 'p', 'x.jsonl')))).toBe(
      false,
    )
  })
})

describe.sequential(
  '§3 · ⛔ the provider database is read through a copy, and the copy removed',
  () => {
    it('⛔ no brobot2-provider-db- folder is left, after a read or a failed one — ⚑ one is there while it reads', () => {
      const scratchTmp = join(root, 'tmp')
      mkdirSync(scratchTmp)
      const state = join(root, 'state_5.sqlite')
      const seed = new Database(state)
      seed.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT)')
      seed.prepare('INSERT INTO threads (id, rollout_path) VALUES (?, ?)').run('t1', 'r.jsonl')
      seed.close()
      const saved = process.env['TMPDIR']
      // ⚑ `os.tmpdir()` reads TMPDIR at each call: the copy is made in the folder this test watches.
      process.env['TMPDIR'] = scratchTmp
      try {
        expect(tmpdir()).toBe(scratchTmp)
        let during: string[] = []
        const got = readProviderDatabase(state, (db) => {
          during = readdirSync(scratchTmp)
          const row = db.prepare('SELECT rollout_path FROM threads WHERE id = ?').get('t1') as
            { rollout_path: unknown } | undefined
          return row?.rollout_path ?? null
        })
        expect(got).toBe('r.jsonl')
        // ⚑ The control: while it read, its copy was there.
        expect(during.filter((name) => name.startsWith('brobot2-provider-db-'))).toHaveLength(1)
        // ⛔ …and is gone.
        expect(readdirSync(scratchTmp)).toEqual([])
        // ⛔ A database that cannot be copied: nothing read, and the folder made for it gone too.
        expect(readProviderDatabase(join(root, 'missing.sqlite'), () => 1)).toBeNull()
        expect(readdirSync(scratchTmp)).toEqual([])
      } finally {
        if (saved === undefined) delete process.env['TMPDIR']
        else process.env['TMPDIR'] = saved
      }
    })
  },
)
