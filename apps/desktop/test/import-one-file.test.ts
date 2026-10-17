import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileEdits } from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { readLines } from '../src/main/archive/native-file'
import {
  importFromHome,
  type HomeConversation,
  type HomeImportDeps,
} from '../src/main/archive/import-from-home'
import { deriveLedger } from '../src/main/archive/derive-ledger'
import { importClaudeTranscript } from '../src/main/archive/import-claude'
import { importCodexRollout } from '../src/main/archive/import-codex'

/**
 * Importing one conversation found in a provider home, read from its file where it is.
 *
 * The fixtures are the SYNTHETIC ones 036 and 043 built, transcribed from shapes verified against
 * the real corpus. Real transcripts are never committed.
 */

const here = dirname(fileURLToPath(import.meta.url))
const CLAUDE_FIXTURE = join(here, 'fixtures/claude-transcript.jsonl')
const CODEX_FIXTURE = join(here, 'fixtures/codex-rollout.jsonl')
const migrations = join(here, '../src/main/db/migrations')

describe('importing one conversation from its file', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let issued: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-import-file-'))
    mkdirSync(join(dir, 'homes'), { recursive: true })
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    issued = 0
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** A transcript on disk, copied from a committed fixture so no real content is involved. */
  function plant(name: string, fixture: string): string {
    const path = join(dir, 'homes', name)
    writeFileSync(path, readFileSync(fixture, 'utf8'))
    return path
  }

  function source(overrides: Partial<HomeConversation> & { path: string }): HomeConversation {
    return {
      provider: 'claude',
      sessionId: 'thread-1',
      cwd: join(dir, 'work'),
      updatedAt: 1_700_000_000_000,
      createdAt: 1_699_000_000_000,
      profileId: null,
      ...overrides,
    }
  }

  function deps(overrides: Partial<HomeImportDeps> = {}): HomeImportDeps {
    return {
      store,
      newSessionId: () => `sess_${++issued}`,
      lines: (path) => (from, maxLines) => readLines(path, from, maxLines),
      ...overrides,
    }
  }

  const run = (
    from: HomeConversation,
    cancelled: () => boolean = () => false,
    overrides: Partial<HomeImportDeps> = {},
  ) => importFromHome(deps(overrides), from, cancelled)

  describe('what it imports', () => {
    it('records the conversation and derives its ledger, for either provider', async () => {
      expect(await run(source({ path: plant('claude.jsonl', CLAUDE_FIXTURE) }))).toBe('imported')
      expect(
        await run(
          source({
            path: plant('codex.jsonl', CODEX_FIXTURE),
            provider: 'codex',
            sessionId: 'thread-2',
          }),
        ),
      ).toBe('imported')

      expect(store.events('sess_1').length).toBeGreaterThan(0)
      expect(store.events('sess_2').length).toBeGreaterThan(0)
    })

    it('records how many of the file’s lines it read', async () => {
      const path = plant('claude.jsonl', CLAUDE_FIXTURE)
      await run(source({ path }))
      const lines = readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
      expect(store.ledgerStatus('sess_1').derivedThrough).toBe(lines.length)
    })

    it('dates the conversation from the PROVIDER’s own records, not from now', async () => {
      await run(source({ path: plant('codex.jsonl', CODEX_FIXTURE), provider: 'codex' }))
      const first = store.events('sess_1')[0]
      expect(first?.at).toBe(Date.parse('2026-04-22T15:48:57.000Z'))
    })

    it('does not leave an imported session claiming to be running (045)', async () => {
      await run(source({ path: plant('claude.jsonl', CLAUDE_FIXTURE) }))
      const turns = store.turns('sess_1')
      expect(turns.length).toBeGreaterThan(0)
      expect(turns.every((turn) => turn.closedAt !== null)).toBe(true)
      // `unknown`, never `completed`: the file records what was said, not how the turn ended.
      expect(turns.map((turn) => turn.endReason)).toEqual(turns.map(() => 'unknown'))
      expect(store.find('sess_1')?.status).toBe('ended')
    })
  })

  describe('running it again', () => {
    it('writes nothing the second time, and says it is already here', async () => {
      const from = source({ path: plant('claude.jsonl', CLAUDE_FIXTURE) })
      await run(from)
      const events = store.events('sess_1').length

      expect(await run(from)).toBe('up-to-date')
      expect(store.events('sess_1')).toHaveLength(events)
      expect(store.recorded()).toHaveLength(1)
    })

    it('derives a row whose ledger never started', async () => {
      // A pass that died before its ledger was promoted leaves the row and no conversation; the
      // next one must not call that "already imported".
      const path = plant('claude.jsonl', CLAUDE_FIXTURE)
      let derailed = false
      const outcome = await run(source({ path }), () => false, {
        store: {
          ...store,
          appendGeneration: () => {
            derailed = true
            throw new Error('killed mid-derive')
          },
        },
      })
      expect(derailed).toBe(true)
      expect(outcome).toBe('unreadable')
      expect(store.events('sess_1')).toHaveLength(0)

      expect(await run(source({ path }))).toBe('imported')
      expect(store.events('sess_1').length).toBeGreaterThan(0)
    })
  })

  it.each([
    ['claude', CLAUDE_FIXTURE],
    ['codex', CODEX_FIXTURE],
  ] as const)(
    'an unfinished %s tail stays retryable on the next import',
    async (provider, fixture) => {
      const path = plant(`${provider}-unfinished.jsonl`, fixture)
      const text = readFileSync(path, 'utf8')
      const last = text.lastIndexOf('\n', text.length - 2) + 1
      writeFileSync(path, text.slice(0, last + Math.max(1, Math.floor((text.length - last) / 2))))
      const from = source({ path, provider })
      const smallReads: Partial<HomeImportDeps> = {
        lines: (file) => (offset) => readLines(file, offset, 2),
      }
      expect(await run(from, () => false, smallReads)).toBe('still-writing')
      expect(store.ledgerStatus('sess_1').present).toBe(false)
      expect(store.events('sess_1')).toEqual([])
      writeFileSync(path, text)
      expect(await run(from, () => false, smallReads)).toBe('imported')
      expect(store.ledgerStatus('sess_1')).toMatchObject({
        present: true,
        derived: 'current',
        derivedThrough: text.trimEnd().split('\n').length,
      })
      expect(await run(from)).toBe('up-to-date')
    },
  )

  it('an unfinished rebuild leaves the previous projection whole and retries after completion', async () => {
    const path = plant('rebuild-unfinished.jsonl', CLAUDE_FIXTURE)
    const from = source({ path })
    expect(await run(from)).toBe('imported')
    const before = store.events('sess_1')
    const text = readFileSync(path, 'utf8')
    writeFileSync(path, text + '{"type":"user","message":{"content":"the next question')
    const rebuild = () =>
      deriveLedger(store, 'sess_1', 'claude', (offset, max) => readLines(path, offset, max), {
        fallbackAt: 1,
        rebuild: true,
      })
    expect(await rebuild()).toBe('still-writing')
    expect(store.events('sess_1')).toEqual(before)
    writeFileSync(path, text + '{"type":"user","message":{"content":"the next question"}}\n')
    expect(await rebuild()).toBe('imported')
    expect(store.events('sess_1').at(-1)?.event).toMatchObject({
      type: 'user_turn',
      text: 'the next question',
    })
  })

  describe('the guards', () => {
    it('says a file it cannot read is unreadable, and keeps the row', async () => {
      const outcome = await run(source({ path: join(dir, 'homes', 'missing.jsonl') }))
      expect(outcome).toBe('unreadable')
      expect(store.recorded()).toHaveLength(1)
      expect(store.ledgerStatus('sess_1').present).toBe(false)
    })

    it('stops when asked, and writes nothing of a conversation', async () => {
      const outcome = await run(source({ path: plant('claude.jsonl', CLAUDE_FIXTURE) }), () => true)
      expect(outcome).toBe('stopped')
      expect(store.events('sess_1')).toHaveLength(0)
    })

    it('publishes the ledger all-or-nothing, so a derive that dies leaves none of it', async () => {
      const path = plant('claude.jsonl', CLAUDE_FIXTURE)
      const lines = readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
      store.adopt({
        id: 'sess_1',
        provider: 'claude',
        sessionId: 'thread-1',
        cwd: dir,
        profileId: null,
        updatedAt: 1,
        createdAt: 1,
      })
      let batches = 0
      const failing: SessionStore = {
        ...store,
        appendGeneration: (id, generation, entries) => {
          if (batches++ > 0) throw new Error('killed mid-derive')
          store.appendGeneration(id, generation, entries)
        },
      }
      const outcome = await deriveLedger(
        failing,
        'sess_1',
        'claude',
        (from, max) => readLines(path, from, max),
        { fallbackAt: 1, batchSize: 1 },
      )
      expect(outcome).toBe('failed')
      expect(batches).toBeGreaterThan(1)
      expect(lines.length).toBeGreaterThan(1)
      expect(store.events('sess_1')).toHaveLength(0)
      expect(store.turns('sess_1')).toHaveLength(0)
      expect(store.ledgerStatus('sess_1').present).toBe(false)
    })
  })

  describe('what it declines to record', () => {
    it('does not record a bookkeeping-only file as a conversation, however long it is', async () => {
      const path = join(dir, 'homes', 'long-chatter.jsonl')
      const lines: string[] = []
      for (let n = 0; n < 40; n++) {
        lines.push(
          JSON.stringify({ type: 'queue-operation', n, timestamp: '2026-04-22T15:48:57Z' }),
        )
      }
      writeFileSync(path, `${lines.join('\n')}\n`)

      expect(await run(source({ path }))).toBe('nothing-readable')
      expect(store.events('sess_1')).toHaveLength(0)
    })

    it('recovers a conversation that only appears after a long bookkeeping prefix', async () => {
      const path = join(dir, 'homes', 'late-conversation.jsonl')
      const lines: string[] = []
      for (let n = 0; n < 30; n++) {
        lines.push(
          JSON.stringify({ type: 'queue-operation', n, timestamp: '2026-04-22T15:48:57Z' }),
        )
      }
      lines.push(
        JSON.stringify({
          type: 'user',
          timestamp: '2026-04-22T15:49:00Z',
          message: { content: 'finally, a question' },
        }),
      )
      writeFileSync(path, `${lines.join('\n')}\n`)
      store.adopt({
        id: 'sess_late',
        provider: 'claude',
        sessionId: 'thread-late',
        cwd: dir,
        profileId: null,
        updatedAt: 1,
        createdAt: 1,
      })

      await deriveLedger(store, 'sess_late', 'claude', (from, max) => readLines(path, from, max), {
        fallbackAt: 1,
        batchSize: 5,
      })

      const events = store.events('sess_late')
      // Every entry, from ordinal 0 — the chatter that preceded it included, in order.
      expect(events).toHaveLength(31)
      expect(events[0]?.event.type).toBe('unknown')
      expect(events[30]?.event).toMatchObject({ type: 'user_turn', text: 'finally, a question' })
      expect(events.map((row) => row.ordinal)).toEqual([...Array(31).keys()])
    })
  })

  describe('a session found in the user’s own home', () => {
    it('is recorded, readable, and honestly NOT resumable', async () => {
      await run(source({ path: plant('claude.jsonl', CLAUDE_FIXTURE) }))

      expect(store.resumable()).toHaveLength(0)
      const [row] = store.unresumable()
      expect(row?.reason, 'whose it is').toContain('one of your own Claude conversations')
      expect(row?.reason, 'that it can still be read').toContain('BroCrew can read it here')
      expect(row?.reason, 'why it will not reopen').toContain("BroCrew's own folder")
      expect(row?.reason, 'and the jargon is gone').not.toContain('provider home')
      expect(row?.profileId).toBeNull()
      expect(row?.reason).not.toContain('Codex')
      expect(store.find('sess_1')?.provider).toBe('claude')
      expect(store.events('sess_1').length).toBeGreaterThan(0)
      // ⛔ The ROW says so too, which is what the rail reads (151), through both mappers.
      expect(row?.hasTranscript).toBe(true)
      expect(store.recorded().find((entry) => entry.sessionId === 'sess_1')?.hasTranscript).toBe(
        true,
      )
    })

    it('leaves a session found in one of OUR homes resumable', async () => {
      await run(source({ path: plant('claude.jsonl', CLAUDE_FIXTURE), profileId: 'default' }))
      expect(store.resumable()).toHaveLength(1)
      expect(store.unresumable()).toHaveLength(0)
    })
  })

  describe('parsing in batches is parsing in one call', () => {
    /**
     * The property the streaming derive rests on. Both importers are line-local apart from what
     * they carry forward — the timestamp, and Claude's file edits awaiting a result — so a batched
     * parse must be identical to a whole-file one.
     */
    it.each([
      ['claude', CLAUDE_FIXTURE, importClaudeTranscript],
      [
        'codex',
        CODEX_FIXTURE,
        (lines: string[], at: number, carry?: FileEdits) => {
          void carry
          return importCodexRollout(lines, at)
        },
      ],
    ] as const)('holds for %s', async (provider, fixture, parse) => {
      const path = plant(`${provider}.jsonl`, fixture)
      const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
      const whole = parse(lines, 1_000)

      let carried = 1_000
      let edits: FileEdits | undefined
      const batched = lines.flatMap((line) => {
        const chunk = parse([line], carried, edits)
        carried = chunk.lastAt
        edits = chunk.edits
        return chunk.entries
      })

      expect(batched).toEqual(whole.entries)
      expect(carried).toBe(whole.lastAt)

      // And end to end: the ledger a derive writes one line at a time is the same one.
      store.adopt({
        id: 'sess_batched',
        provider,
        sessionId: 'thread-batched',
        cwd: dir,
        profileId: null,
        updatedAt: 1,
        createdAt: 1,
      })
      await deriveLedger(
        store,
        'sess_batched',
        provider,
        (from, max) => readLines(path, from, max),
        {
          fallbackAt: 1_000,
          batchSize: 1,
        },
      )
      expect(store.events('sess_batched').map((row) => ({ at: row.at, event: row.event }))).toEqual(
        whole.entries.map((entry) => ({ at: entry.at, event: entry.event })),
      )
    })
  })

  /**
   * The reader every import, rebuild and export stands on: every line, blanks included, minus the
   * empty piece a trailing newline leaves behind — which is what makes `lines.join('\n') + '\n'`
   * give the file back byte for byte.
   */
  describe('reading a file in pulls', () => {
    const write = (name: string, text: string): string => {
      const path = join(dir, 'homes', name)
      writeFileSync(path, text)
      return path
    }

    /** Every line, pulled `size` at a time — which must not depend on `size`. */
    const pullAll = (path: string, size: number): string[] => {
      const lines: string[] = []
      let from = 0
      for (;;) {
        const chunk = readLines(path, from, size)
        lines.push(...chunk.lines)
        from = chunk.offset
        if (chunk.done) return lines
      }
    }

    it.each([1, 2, 1_000])('gives the same lines whatever the pull size (%i)', (size) => {
      const path = write('mixed.jsonl', 'a\n\nb\nc\n')
      expect(pullAll(path, size)).toEqual(['a', '', 'b', 'c'])
    })

    it('keeps a final line that has no newline after it', () => {
      expect(pullAll(write('bare.jsonl', 'a\nb'), 1)).toEqual(['a', 'b'])
    })

    it('counts the offset in BYTES, not characters', () => {
      const path = write('utf8.jsonl', '汉字漢\n漢字汉\n')
      const first = readLines(path, 0, 1)
      expect(first.lines).toEqual(['汉字漢'])
      expect(first.offset).toBe(10)
      expect(readLines(path, first.offset, 1).lines).toEqual(['漢字汉'])
    })

    it('reads a line longer than its own buffer', () => {
      const long = 'x'.repeat(200_000)
      expect(pullAll(write('long.jsonl', `${long}\nshort\n`), 1)).toEqual([long, 'short'])
    })

    it('has nothing to give for an empty file', () => {
      expect(readLines(write('empty.jsonl', ''), 0, 10)).toEqual({
        lines: [],
        offset: 0,
        done: true,
        partial: false,
      })
    })
  })

  describe('the descent a second pass learns (119)', () => {
    const CHILD = { parentSessionId: 'parent-thread', depth: 1, nickname: 'Turing' }

    it('fills a row adopted before the descent could be read', async () => {
      const path = plant('legacy.jsonl', CLAUDE_FIXTURE)
      await run(source({ path }))
      expect(store.recorded()[0]?.child, 'the fixture must start from the broken state').toBeNull()

      await run(source({ path, child: CHILD }))

      expect(store.recorded()).toHaveLength(1)
      expect(store.recorded()[0]?.child).toEqual(CHILD)
    })

    it('⛔ never clears one, and never moves the row up the list', async () => {
      const path = plant('rich.jsonl', CLAUDE_FIXTURE)
      await run(source({ path, child: { ...CHILD, role: 'worker' } }))
      const before = store.recorded()[0]?.updatedAt

      await run(source({ path, child: { parentSessionId: 'parent-thread' } }))
      await run(source({ path, updatedAt: 1_900_000_000_000 }))

      expect(store.recorded()[0]?.child).toEqual({ ...CHILD, role: 'worker' })
      // ⚑ The clock is the import's to leave alone: `learnDescent`, not `refreshAdopted`.
      expect(before).toEqual(expect.any(Number))
      expect(store.recorded()[0]?.updatedAt).toBe(before)
    })
  })
})
