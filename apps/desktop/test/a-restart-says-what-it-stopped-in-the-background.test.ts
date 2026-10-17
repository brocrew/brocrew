import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { backgroundTheRestartStoppedText } from '../src/main/runtime/runtime-host'
import { theStoppedWork, whatStoppedWithIt } from '../src/main/runtime/reply-rails'
import { clockTime } from '../src/shared/clock'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # ⚑ A restart says what it stopped in the background
 *
 * Landing coverage for the restart that used to read, to a giver, as an agent giving up. The words
 * (`theStoppedWork`, what a stall adds under its first line, what a woken conversation is told) are
 * pure; **what the restart stopped** is read off the real ledger by `backgroundTheRestartStopped`:
 * for each conversation the NEWEST quit closed — and each a crash left — the background work its
 * newest level still listed running when its life ended. ⛔ Never an older quit's, never an earlier
 * life's level, never work a later `ended` edge took away.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const at = (hour: number, minute = 0): number => new Date(2026, 9, 2, hour, minute).getTime()

describe('what stopped, in words', () => {
  it('🔴 names what the provider called each, quoted, and counts the rest after three', () => {
    expect(theStoppedWork([])).toBe('')
    expect(theStoppedWork(['make test'])).toBe('“make test”')
    expect(theStoppedWork(['a', 'b'])).toBe('“a” and “b”')
    expect(theStoppedWork(['a', 'b', 'c'])).toBe('“a”, “b” and “c”')
    expect(theStoppedWork(['a', 'b', 'c', 'd', 'e'])).toBe('“a”, “b”, “c” and 2 more')
  })

  it('⚑ a long name is cut with an ellipsis, and a short one is not', () => {
    const long = 'x'.repeat(300)
    const said = theStoppedWork([long])
    expect(said).toBe(`“${'x'.repeat(119)}…”`)
    expect(theStoppedWork(['x'.repeat(120)])).toBe(`“${'x'.repeat(120)}”`)
  })

  it('🔴 what a conversation is told on being started again: when, what, and that it is its call', () => {
    const endedAt = at(1, 57)
    const text = backgroundTheRestartStoppedText(['Run the full live test'], endedAt, at(2, 5))
    expect(text).toBe(
      `The app restarted at ${clockTime(endedAt)} and stopped your background work: ` +
        '“Run the full live test”. Start it again if it’s still needed.',
    )
    // A stop from an earlier day carries its day, as a bare time would read as today's.
    const yesterday = backgroundTheRestartStoppedText(['x'], at(1, 57) - 24 * 3_600_000, at(2, 5))
    expect(yesterday).not.toContain(`restarted at ${clockTime(at(1, 57))} and`)
    expect(yesterday).toMatch(/^The app restarted at .+ and stopped your background work: “x”\./)
  })

  it('🔴 what a giver reads under a stall: what it waited on and who stopped it — never that the agent gave up', () => {
    const stalledAt = at(11, 57)
    const piece = { stalledAt, stoppedInTheBackground: ['Run the full live test'] }
    expect(whatStoppedWithIt(piece, 'background_stopped', true)).toBe(
      `That was “Run the full live test”, which the app’s restart at ${clockTime(stalledAt)} stopped.`,
    )
    expect(whatStoppedWithIt(piece, 'background_stopped', false)).toBe(
      `That was “Run the full live test”; its conversation ended at ${clockTime(stalledAt)}.`,
    )
    // After a crash nothing ended the conversation in the ledger: only what is certain is said.
    expect(whatStoppedWithIt(piece, 'app_restarted', true)).toBe(
      `It was waiting on “Run the full live test”, which did not survive the app’s restart (it started again at ${clockTime(stalledAt)}).`,
    )
    // No time on the row: the same sentences without one.
    expect(whatStoppedWithIt({ stoppedInTheBackground: ['a'] }, 'background_stopped', true)).toBe(
      'That was “a”, which the app’s restart stopped.',
    )
  })

  it('⛔ nothing is said when nothing stopped, or for a cause that is not a stop', () => {
    expect(whatStoppedWithIt({ stalledAt: 1 }, 'background_stopped', true)).toBeNull()
    expect(whatStoppedWithIt({ stoppedInTheBackground: [] }, 'background_stopped', true)).toBeNull()
    expect(
      whatStoppedWithIt(
        { stoppedInTheBackground: ['a'] },
        'its_turn_ended_with_it_open' as never,
        true,
      ),
    ).toBeNull()
  })
})

describe('backgroundTheRestartStopped, off the real ledger', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  const ordinals = new Map<string, number>()
  const LAUNCH = at(2, 0)
  const NOT_BEFORE = LAUNCH - 24 * 3_600_000

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-restart-bg-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    ordinals.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const conversation = (id: string): string => {
    store.create({ id, provider: 'claude', cwd: userData, approvalMode: 'ask', profileId: 'agent' })
    return id
  }
  const append = (id: string, event: Record<string, unknown>, when: number): void => {
    const next = ordinals.get(id) ?? 0
    ordinals.set(id, next + 1)
    store.append(id, next, event as unknown as TranscriptEvent, when)
  }
  const running = (id: string, ...work: { id: string; description?: string; kind?: string }[]) =>
    append(id, { type: 'background_work', running: work, source: 'test' }, at(1, 30))
  const found = (died: string[] = [], before = LAUNCH, notBefore = NOT_BEFORE) =>
    store
      .backgroundTheRestartStopped(died, before, notBefore)
      .map((one) => ({ ...one }))
      .sort((a, b) => a.conversation.localeCompare(b.conversation))

  it('🔴 a conversation the newest quit closed, with work still listed running, is named with what the provider called it and when it stopped', () => {
    conversation('sess_a')
    running(
      'sess_a',
      { id: 't1', description: 'Run the full live test' },
      { id: 't2', kind: 'local_bash' },
    )
    append('sess_a', { type: 'status', state: 'idle' }, at(1, 57))
    store.closedByTheQuit(['sess_a'], at(1, 58))
    expect(found()).toEqual([
      {
        conversation: 'sess_a',
        stopped: ['Run the full live test', 'local_bash'],
        endedAt: at(1, 57),
      },
    ])
  })

  it('⚑ a work item the provider named by neither description nor kind is named by its id', () => {
    conversation('sess_a')
    running('sess_a', { id: 'bash_7' })
    store.closedByTheQuit(['sess_a'], at(1, 58))
    expect(found()[0]?.stopped).toEqual(['bash_7'])
  })

  it('⛔ a conversation with nothing running, or whose level was emptied, is not named', () => {
    conversation('sess_none')
    conversation('sess_emptied')
    running('sess_emptied', { id: 't1', description: 'x' })
    append('sess_emptied', { type: 'background_work', running: [], source: 'test' }, at(1, 40))
    store.closedByTheQuit(['sess_none', 'sess_emptied'], at(1, 58))
    expect(found()).toEqual([])
  })

  it('🔴 the newest level REPLACES, and an ended edge after it takes one item away', () => {
    conversation('sess_a')
    running('sess_a', { id: 't1', description: 'first' })
    running('sess_a', { id: 't2', description: 'second' }, { id: 't3', description: 'third' })
    append(
      'sess_a',
      { type: 'background_work', ended: { id: 't3', outcome: 'completed' }, source: 'test' },
      at(1, 45),
    )
    store.closedByTheQuit(['sess_a'], at(1, 58))
    expect(found()[0]?.stopped).toEqual(['second'])
  })

  it('⛔ a level stated before the newest `launched` row is an earlier life’s, which a stop already took', () => {
    conversation('sess_a')
    running('sess_a', { id: 't1', description: 'an earlier life’s work' })
    append('sess_a', { type: 'launched', source: 'test' }, at(1, 35))
    store.closedByTheQuit(['sess_a'], at(1, 58))
    expect(found()).toEqual([])
    // …and one stated AFTER the launch is this life's.
    append(
      'sess_a',
      {
        type: 'background_work',
        running: [{ id: 't9', description: 'this life’s' }],
        source: 'test',
      },
      at(1, 40),
    )
    expect(found()[0]?.stopped).toEqual(['this life’s'])
  })

  it('⛔ only the NEWEST quit, and only one newer than the bound: an older quit’s stamp wakes nobody', () => {
    conversation('sess_old')
    conversation('sess_new')
    running('sess_old', { id: 't1', description: 'old' })
    running('sess_new', { id: 't2', description: 'new' })
    store.closedByTheQuit(['sess_old'], at(1, 0))
    store.closedByTheQuit(['sess_new'], at(1, 58))
    // sess_old keeps its older stamp, but only the newest quit's conversations are read.
    expect(found().map((one) => one.conversation)).toEqual(['sess_new'])
    // A newest quit older than the bound wakes nobody at all.
    expect(found([], LAUNCH, at(1, 59))).toEqual([])
  })

  it('🔴 a crash’s conversations are read too, quit or no quit', () => {
    conversation('sess_crashed')
    running('sess_crashed', { id: 't1', description: 'a command that died with the app' })
    expect(found([])).toEqual([])
    expect(found(['sess_crashed']).map((one) => one.conversation)).toEqual(['sess_crashed'])
  })

  it('⚑ a conversation both quit-closed and crashed is named once, and its stop is its last moment BEFORE the launch', () => {
    conversation('sess_a')
    running('sess_a', { id: 't1', description: 'x' })
    append('sess_a', { type: 'status', state: 'idle' }, at(1, 50))
    // The launch has already written to the ledger by the time it is read: that is no stop.
    append('sess_a', { type: 'status', state: 'idle' }, LAUNCH + 5_000)
    store.closedByTheQuit(['sess_a'], at(1, 58))
    const read = found(['sess_a'])
    expect(read).toHaveLength(1)
    expect(read[0]?.endedAt).toBe(at(1, 50))
  })

  it('⚑ a row that cannot be read costs only its own conversation', () => {
    conversation('sess_torn')
    conversation('sess_ok')
    db.prepare(
      `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
       VALUES ('evt_torn', 'sess_torn', 0, 900, 'background_work', 'not json', ?)`,
    ).run(at(1, 30))
    running('sess_ok', { id: 't1', description: 'fine' })
    store.closedByTheQuit(['sess_torn', 'sess_ok'], at(1, 58))
    expect(found().map((one) => one.conversation)).toEqual(['sess_ok'])
  })
})
