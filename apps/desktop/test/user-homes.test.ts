import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  claudeHomeDescriptions,
  discoverUserHomeSessions,
  userProviderHomePath,
  userProviderHomes,
} from '../src/main/adopt/user-homes'
import { claudeProjectDirName } from '@brobot2/runtime'

/**
 * The user's own provider homes (Slice 2 · 046) — the one module in the main process that names
 * `~/.claude` and `~/.codex`, and the one that must never write to them.
 *
 * Everything here runs against a home built in a temp directory. The real ones are read exactly
 * once in this suite, to confirm the default path is the one that actually exists on this machine —
 * and not opened.
 */

describe('the user’s own provider homes', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-user-home-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  describe('where they are', () => {
    it('defaults to the conventional location', () => {
      expect(userProviderHomePath('claude', {})).toBe(join(homedir(), '.claude'))
      expect(userProviderHomePath('codex', {})).toBe(join(homedir(), '.codex'))
    })

    it('follows the same environment variables the adapters pin on their children', () => {
      // A machine that relocates a home is read where it lives, not where it usually is —
      // `CLAUDE_CONFIG_DIR` / `CODEX_HOME` are exactly what the adapters set.
      const env = { CLAUDE_CONFIG_DIR: '/elsewhere/claude', CODEX_HOME: '/elsewhere/codex' }
      expect(userProviderHomePath('claude', env)).toBe('/elsewhere/claude')
      expect(userProviderHomePath('codex', env)).toBe('/elsewhere/codex')
    })

    it('reports only the homes that exist', () => {
      const claude = join(dir, '.claude')
      mkdirSync(claude, { recursive: true })
      const homes = userProviderHomes({ CLAUDE_CONFIG_DIR: claude, CODEX_HOME: join(dir, 'nope') })
      expect(homes).toEqual([{ provider: 'claude', path: claude }])
    })
  })

  describe('what it finds in them', () => {
    /** A Claude home in the shape the real one has: `projects/<encoded cwd>/<id>.jsonl`. */
    function plantClaudeSession(home: string, sessionId: string, cwd: string): string {
      const projects = join(home, 'projects', claudeProjectDirName(cwd))
      mkdirSync(projects, { recursive: true })
      const path = join(projects, `${sessionId}.jsonl`)
      writeFileSync(
        path,
        `${[
          JSON.stringify({ type: 'user', sessionId, cwd, message: { content: 'hello' } }),
          JSON.stringify({ type: 'assistant', sessionId, cwd, message: { content: 'hi' } }),
        ].join('\n')}\n`,
      )
      return path
    }

    it('measures each transcript and refuses to name a profile for it', () => {
      const home = join(dir, '.claude')
      const path = plantClaudeSession(home, 'abc-123', join(dir, 'work'))

      const { found } = discoverUserHomeSessions([{ provider: 'claude', path: home }])
      expect(found).toHaveLength(1)
      expect(found[0]?.sessionId).toBe('abc-123')
      expect(found[0]?.bytes).toBeGreaterThan(0)
      // NULL, not a name. There is no home of ours that holds this, and any string here would be
      // a claim the resume path would act on.
      expect(found[0]?.profileId).toBeNull()
      expect(found[0]?.path).toBe(path)
    })

    it('is empty, not broken, for a home with nothing in it', () => {
      const home = join(dir, '.claude')
      mkdirSync(home, { recursive: true })
      expect(discoverUserHomeSessions([{ provider: 'claude', path: home }]).found).toEqual([])
    })
  })

  describe('🔒 reading Codex’s index creates nothing beside it', () => {
    /**
     * The regression for 046's review P1, and it is BEHAVIOURAL rather than structural because the
     * structural check could not see it: `new Database(path, {readonly: true})` on a WAL-mode
     * database whose `-shm` is missing CREATES that sidecar. The write happens inside SQLite's C
     * VFS, so no scan of our source for `writeFileSync` would ever have found it — and the file it
     * creates is in `~/.codex`.
     */
    it('leaves no -shm or -wal beside a WAL-mode state database', () => {
      const home = join(dir, '.codex')
      mkdirSync(home, { recursive: true })
      const statePath = join(home, 'state_5.sqlite')

      // A database in the shape Codex keeps: WAL mode, which is recorded in the file HEADER and so
      // survives every connection closing. That is what makes this the real case — a read-only
      // opener still has to coordinate through `-shm` even when no writer is running.
      const seed = new Database(statePath)
      seed.pragma('journal_mode = WAL')
      seed.exec(
        `CREATE TABLE threads (id TEXT, cwd TEXT, rollout_path TEXT, archived INTEGER,
           created_at INTEGER, created_at_ms INTEGER, updated_at INTEGER, updated_at_ms INTEGER)`,
      )
      seed
        .prepare('INSERT INTO threads VALUES (?,?,?,0,1,1000,2,2000)')
        .run('t1', dir, 'gone.jsonl')
      seed.close()
      // SQLite checkpoints and removes `-wal`/`-shm` when the last connection closes, so this is
      // the state a Codex home is really in whenever Codex is not running — the exact state in
      // which a `{readonly: true}` open recreates the sidecar.
      const before = readdirSync(home).sort()
      expect(before).toEqual(['state_5.sqlite'])

      discoverUserHomeSessions([{ provider: 'codex', path: home }])

      expect(readdirSync(home).sort(), 'reading the index must create nothing').toEqual(before)
    })

    it('reads what Codex calls a thread, from the same table `thread/list` reads', () => {
      const home = join(dir, '.codex')
      const rollout = join(dir, 'rollout.jsonl')
      mkdirSync(home, { recursive: true })
      writeFileSync(rollout, '{"type":"session_meta"}\n')
      const seed = new Database(join(home, 'state_5.sqlite'))
      seed.exec(
        `CREATE TABLE threads (id TEXT, cwd TEXT, rollout_path TEXT, archived INTEGER,
           created_at INTEGER, created_at_ms INTEGER, updated_at INTEGER, updated_at_ms INTEGER,
           title TEXT, first_user_message TEXT)`,
      )
      seed
        .prepare('INSERT INTO threads VALUES (?,?,?,0,1,1000,2,2000,?,?)')
        .run('t1', dir, rollout, 'Fix the parser', 'the parser drops a line')
      seed.close()

      const { found } = discoverUserHomeSessions([{ provider: 'codex', path: home }])
      // The captions the library shows come from here rather than from a spawned app-server:
      // starting one against a home WRITES 71 files into it — measured — which `~/.codex` cannot
      // afford. `useStateDbOnly: true` does not prevent that; it only skips the rollout rescan.
      expect(found[0]?.description).toEqual({
        title: 'Fix the parser',
        preview: 'the parser drops a line',
      })
    })

    it('still finds every thread on an OLDER state database that has no caption columns', () => {
      const home = join(dir, '.codex')
      const rollout = join(dir, 'rollout.jsonl')
      mkdirSync(home, { recursive: true })
      writeFileSync(rollout, '{"type":"session_meta"}\n')
      // `title` and `first_user_message` arrived by ALTER TABLE, so a home that has not been opened
      // by a recent Codex genuinely lacks them. Naming them unconditionally would throw, the whole
      // read would return null, and EVERY Codex session would vanish from the app — for a subtitle.
      const seed = new Database(join(home, 'state_5.sqlite'))
      seed.exec(
        `CREATE TABLE threads (id TEXT, cwd TEXT, rollout_path TEXT, archived INTEGER,
           created_at INTEGER, created_at_ms INTEGER, updated_at INTEGER, updated_at_ms INTEGER)`,
      )
      seed.prepare('INSERT INTO threads VALUES (?,?,?,0,1,1000,2,2000)').run('t1', dir, rollout)
      seed.close()

      const { found } = discoverUserHomeSessions([{ provider: 'codex', path: home }])
      expect(found.map((session) => session.sessionId)).toEqual(['t1'])
      // The caption degrades to nothing to say. It does NOT become an invented one.
      expect(found[0]?.description).toEqual({ title: '', preview: '' })
    })

    it('still reads the threads it finds there', () => {
      const home = join(dir, '.codex')
      const rollout = join(dir, 'rollout.jsonl')
      mkdirSync(home, { recursive: true })
      writeFileSync(rollout, '{"type":"session_meta"}\n')
      const seed = new Database(join(home, 'state_5.sqlite'))
      seed.pragma('journal_mode = WAL')
      seed.exec(
        `CREATE TABLE threads (id TEXT, cwd TEXT, rollout_path TEXT, archived INTEGER,
           created_at INTEGER, created_at_ms INTEGER, updated_at INTEGER, updated_at_ms INTEGER)`,
      )
      seed.prepare('INSERT INTO threads VALUES (?,?,?,0,1,1000,2,2000)').run('t1', dir, rollout)
      seed.close()

      // The copy has to be READABLE, not just harmless — a fix that protected the directory by
      // reading nothing would pass the test above and fail here.
      //
      // ⚠️ What this does NOT cover: a copy taken while Codex is mid-write, where the `-wal` is the
      // only place recent threads live. `readProviderDatabase` copies it for that reason, and a
      // test cannot stage that without holding a live writer open on the file.
      const { found } = discoverUserHomeSessions([{ provider: 'codex', path: home }])
      expect(found.map((session) => session.sessionId)).toEqual(['t1'])
      expect(found[0]?.bytes).toBeGreaterThan(0)
    })
  })

  // SEQUENTIAL, explicitly. Both tests below point `CLAUDE_CONFIG_DIR` at a temp home and restore
  // it in a `finally`. That is safe while these run one at a time and becomes a race the moment
  // anything makes the parent concurrent — the env var is process-wide, and the window between
  // setting it and awaiting the SDK is exactly where another test would read the wrong home.
  describe.sequential('what Claude’s own index says about them (047)', () => {
    it('reads the SAME home `userProviderHomePath` names, because both resolve CLAUDE_CONFIG_DIR', async () => {
      // The constraint 043 handed 047 was "`listSessions()` has no home option". True — and the
      // conclusion drawn from it, that it can only ever read `~/.claude`, is not: it resolves
      // `CLAUDE_CONFIG_DIR` at call time, which is exactly what `userProviderHomePath` computes.
      // They agree by CONSTRUCTION, and this pins that rather than trusting it.
      const home = join(dir, '.claude')
      const cwd = join(dir, 'work')
      mkdirSync(cwd, { recursive: true })
      plantClaudeSessionAt(home, '11111111-2222-4333-8444-555555555555', cwd)

      const previous = process.env['CLAUDE_CONFIG_DIR']
      process.env['CLAUDE_CONFIG_DIR'] = home
      try {
        expect(userProviderHomePath('claude')).toBe(home)
        const described = await claudeHomeDescriptions()
        // If the SDK read a different directory this map would be empty, and the two would have
        // been agreeing only by accident of both defaulting to the same place.
        expect(described.get('11111111-2222-4333-8444-555555555555')?.preview).toBe('probe prompt')
      } finally {
        if (previous === undefined) delete process.env['CLAUDE_CONFIG_DIR']
        else process.env['CLAUDE_CONFIG_DIR'] = previous
      }
    })

    it('🔒 changes nothing in the home it reads', async () => {
      const home = join(dir, '.claude')
      const cwd = join(dir, 'work')
      mkdirSync(cwd, { recursive: true })
      plantClaudeSessionAt(home, '11111111-2222-4333-8444-555555555555', cwd)
      const before = readTree(home)

      const previous = process.env['CLAUDE_CONFIG_DIR']
      process.env['CLAUDE_CONFIG_DIR'] = home
      try {
        await claudeHomeDescriptions()
      } finally {
        if (previous === undefined) delete process.env['CLAUDE_CONFIG_DIR']
        else process.env['CLAUDE_CONFIG_DIR'] = previous
      }

      // Behavioural, like the `-shm` regression below it — and for the same reason. This is the
      // only provider API in the app we call against the user's real directory, and 046 proved that
      // "it only reads" is a claim to MEASURE rather than assume.
      expect(readTree(home)).toEqual(before)
    })

    it('prefers the title the user typed over the one the SDK derived', async () => {
      const described = await claudeHomeDescriptions(async () => [
        { sessionId: 'a', summary: 'derived summary', customTitle: 'what I called it' },
      ])
      expect(described.get('a')?.title).toBe('what I called it')
    })

    it('costs captions, not sessions, when the SDK cannot read anything', async () => {
      const described = await claudeHomeDescriptions(async () => {
        throw new Error('no home here')
      })
      // Empty, not thrown. The sessions themselves come from the filesystem scan, which does not
      // need this — losing a subtitle must never cost the row it belongs to.
      expect(described.size).toBe(0)
    })
  })

  describe('🔒 it only ever reads', () => {
    it('leaves the home exactly as it found it', () => {
      const home = join(dir, '.claude')
      const projects = join(home, 'projects', claudeProjectDirName(join(dir, 'work')))
      mkdirSync(projects, { recursive: true })
      const path = join(projects, 'abc-123.jsonl')
      const before = `${JSON.stringify({
        type: 'user',
        sessionId: 'abc-123',
        cwd: join(dir, 'work'),
        message: { content: 'hello' },
      })}\n`
      writeFileSync(path, before)

      discoverUserHomeSessions([{ provider: 'claude', path: home }])

      // Asserted rather than intended. These are real transcripts on a real machine.
      expect(readTree(home)).toEqual([[path.slice(home.length), before]])
    })
  })
})

/**
 * A Claude transcript where the SDK's own index will find it, with a first prompt to report.
 * Module-scope because two describe blocks plant one, and the shape is the SDK's, not ours.
 */
function plantClaudeSessionAt(home: string, sessionId: string, cwd: string): string {
  const projects = join(home, 'projects', claudeProjectDirName(cwd))
  mkdirSync(projects, { recursive: true })
  const path = join(projects, `${sessionId}.jsonl`)
  writeFileSync(
    path,
    `${[
      JSON.stringify({
        type: 'user',
        sessionId,
        cwd,
        timestamp: new Date(1_700_000_000_000).toISOString(),
        message: { role: 'user', content: 'probe prompt' },
      }),
      JSON.stringify({
        type: 'assistant',
        sessionId,
        cwd,
        timestamp: new Date(1_700_000_001_000).toISOString(),
        message: { role: 'assistant', content: [{ type: 'text', text: 'a reply' }] },
      }),
    ].join('\n')}\n`,
  )
  return path
}

/** Every file under a directory, as `[relative path, contents]`, sorted — a cheap "unchanged". */
function readTree(root: string): [string, string][] {
  const out: [string, string][] = []
  const walk = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) walk(child)
      else out.push([child.slice(root.length), readFileSync(child, 'utf8')])
    }
  }
  walk(root)
  return out.sort(([a], [b]) => a.localeCompare(b))
}
