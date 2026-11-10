import type { WorkReport } from '../src/shared/task-contracts'
import type { QueuedMessageEvent, UnqueuedMessageEvent } from '../src/shared/conversation-events'
import type { UserTurnEvent } from '../src/shared/human-answer-contracts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { runtimeCommandSchema } from '../src/main/runtime/ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')

const CEILING = 200

let dir: string
let db: AppDatabase
let store: SessionStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brobot2-518-'))
  db = openDatabase(join(dir, 'db.sqlite'))
  applyMigrations(db, migrationsDir)
  store = createSessionStore(db)
  store.create({ id: 'sess_w', provider: 'claude', cwd: dir, approvalMode: 'ask', profileId: 'd' })
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** A report this app could have written. */
const legitimate = (over: Partial<WorkReport> = {}): WorkReport => ({
  piece: 'work_9f1c5b7e-0c2a-4d3e-9a10-2b6c8d4e1f00',
  label: 'W1.4',
  owner: 'sess_2b6c8d4e-1f00-4d3e-9a10-9f1c5b7e0c2a',
  state: 'answered',
  outcome: 'done',
  resources: ['res_4c2f0e1a111142228333444455556666'],
  ...over,
})

const replayed = (ordinal: number): UserTurnEvent =>
  store.events('sess_w')[ordinal]!.event as UserTurnEvent

const stored = (ordinal: number): UserTurnEvent =>
  JSON.parse(
    (
      db
        .prepare('SELECT payload FROM events WHERE session_id = ? AND ordinal = ?')
        .get('sess_w', ordinal) as { payload: string }
    ).payload,
  ) as UserTurnEvent

/** One turn, with whatever payload this test wants on it. */
const turn = (ordinal: number, over: Record<string, unknown>): void => {
  store.append(
    'sess_w',
    ordinal,
    {
      type: 'user_turn',
      text: 'the child answered',
      attribution: 'app_authored',
      ...over,
    } as never,
    1_000 + ordinal,
  )
}

describe('a stored work report is bounded', () => {
  it('drops an id too long to be one and keeps the legitimate fields beside it', () => {
    turn(0, {
      work: legitimate({ resources: ['res_'.concat('x'.repeat(1_000_000))] }),
    })
    const back = replayed(0).work
    expect(back, 'the whole report was dropped for one bad field').toBeDefined()
    expect(back).not.toHaveProperty('resources')
    expect(back?.piece).toBe(legitimate().piece)
    expect(back?.owner).toBe(legitimate().owner)
    expect(back?.label).toBe('W1.4')
    expect(back?.state).toBe('answered')
    expect(back?.outcome).toBe('done')
  })

  it('exactly at the ceiling survives and one character past it does not', () => {
    turn(0, { work: legitimate({ resources: ['d'.repeat(CEILING)] }) })
    turn(1, { work: legitimate({ resources: ['d'.repeat(CEILING + 1)] }) })
    expect(replayed(0).work?.resources).toEqual(['d'.repeat(CEILING)])
    expect(replayed(1).work).not.toHaveProperty('resources')
  })

  it('a report that cannot name its own task loses the whole key, and the turn keeps its words', () => {
    turn(0, { work: legitimate({ piece: 't'.repeat(CEILING + 1) }) })
    expect(replayed(0).work).toBeUndefined()
    expect(replayed(0).text).toBe('the child answered')
    turn(1, { work: legitimate() })
    expect(replayed(1).work?.piece).toBe(legitimate().piece)
  })

  it('every optional field that is too long is absent, one at a time', () => {
    const optional = ['owner', 'outcome', 'stalledBecause'] as const
    optional.forEach((key, index) => {
      turn(index, { work: legitimate({ [key]: 'x'.repeat(CEILING + 1) }) })
      const back = replayed(index).work
      expect(back, `${key} took the whole report with it`).toBeDefined()
      expect(back, key).not.toHaveProperty(key)
    })
    turn(optional.length, { work: legitimate({ resources: ['x'.repeat(CEILING + 1)] }) })
    expect(replayed(optional.length).work, 'resources took the whole report').toBeDefined()
    expect(replayed(optional.length).work).not.toHaveProperty('resources')
    turn(optional.length + 1, {
      work: legitimate({ stalledBecause: 'turn_ended', state: 'stalled' }),
    })
    const whole = replayed(optional.length + 1).work
    for (const key of [...optional, 'resources']) expect(whole, key).toHaveProperty(key)
  })

  it('an empty id is absent too, and a required one empty takes the report with it', () => {
    turn(0, { work: legitimate({ resources: [''] }) })
    expect(replayed(0).work).toBeDefined()
    expect(replayed(0).work).not.toHaveProperty('resources')
    turn(1, { work: legitimate({ piece: '' }) })
    expect(replayed(1).work).toBeUndefined()
  })

  it('a state too long to be one takes the whole report; an unknown short state survives', () => {
    turn(0, { work: legitimate({ state: 's'.repeat(CEILING + 1) as never }) })
    expect(replayed(0).work).toBeUndefined()
    turn(1, { work: legitimate({ state: 'sideways' as never }) })
    expect(replayed(1).work?.state).toBe('sideways')
  })

  it('lets no undeclared key ride the report into the renderer', () => {
    turn(0, { work: { ...legitimate(), blob: 'z'.repeat(50_000) } })
    expect(Object.keys(replayed(0).work!)).not.toContain('blob')
    expect(JSON.stringify(replayed(0))).not.toContain('zzzz')
  })

  it('returns an ordinary report unchanged', () => {
    const report = legitimate()
    turn(0, { work: report })
    expect(replayed(0).work).toEqual(report)
    expect(Object.keys(replayed(0).work!)).toEqual(Object.keys(report))
  })
})

describe('the event types that carry a work report', () => {
  it('bounds a held message and an abandoned one, not only the turn', () => {
    const tooLong = { work: legitimate({ resources: ['d'.repeat(CEILING + 1)] }) }
    store.append(
      'sess_w',
      0,
      { type: 'message_queued', messageId: 'msg_1', text: 'held', ...tooLong } as never,
      1_000,
    )
    store.append(
      'sess_w',
      1,
      { type: 'message_unqueued', messageId: 'msg_1', reason: 'cancelled', ...tooLong } as never,
      1_001,
    )
    const held = store.events('sess_w')[0]!.event as QueuedMessageEvent
    const gone = store.events('sess_w')[1]!.event as UnqueuedMessageEvent
    expect(held.work).not.toHaveProperty('resources')
    expect(gone.work).not.toHaveProperty('resources')
    expect(held.text).toBe('held')
    expect(gone.reason).toBe('cancelled')
  })

  it('bounds the report and the attachments of one turn on the way in', () => {
    // Read off the row on disk: the replay bounds again on the way out and would hide a miss here.
    turn(0, {
      work: legitimate({ resources: ['d'.repeat(CEILING + 1)] }),
      attachments: [
        { path: '/tmp/ok.png', kind: 'file', outsideCwd: false },
        { path: `/tmp/${'p'.repeat(9_000)}.png`, kind: 'file', outsideCwd: false },
      ],
    })
    const onDisk = stored(0)
    expect(onDisk.work, 'the report was not bounded on the way in').not.toHaveProperty('resources')
    expect(onDisk.attachments?.map((each) => each.path)).toEqual(['/tmp/ok.png'])
    expect(onDisk.text).toBe('the child answered')
  })
})

describe('a `work` that is not a report at all', () => {
  it('is dropped and the turn is kept', () => {
    const forged = [null, 'hello', 42, [], true, {}, { piece: 't' }]
    forged.forEach((each, index) => {
      turn(index, { work: each })
      expect(replayed(index).work, JSON.stringify(each)).toBeUndefined()
      expect(replayed(index).text).toBe('the child answered')
    })
    turn(forged.length, { work: legitimate() })
    expect(replayed(forged.length).work?.piece).toBe(legitimate().piece)
  })

  it('a label that is not a piece label takes the report', () => {
    for (const [index, label] of ['WNaN', 'W1.Infinity', 'Task #4', 'W0', 'W1.0'].entries()) {
      turn(index, { work: { ...legitimate(), label } })
      expect(replayed(index).work, label).toBeUndefined()
    }
    turn(5, { work: legitimate({ label: 'W1' }) })
    expect(replayed(5).work?.label).toBe('W1')
    turn(6, { work: legitimate({ label: 'W12.3.40' }) })
    expect(replayed(6).work?.label).toBe('W12.3.40')
  })
})

describe('the stored ceiling is the command wire’s own', () => {
  it('the ids a report hands back are accepted by their commands up to the same ceiling', () => {
    const ok = (resourceId: string): boolean =>
      runtimeCommandSchema.safeParse({ kind: 'readResource', resourceId }).success
    expect(ok('d'.repeat(CEILING))).toBe(true)
    expect(ok('d'.repeat(CEILING + 1))).toBe(false)
    const claim = (sessionId: string): boolean =>
      runtimeCommandSchema.safeParse({ kind: 'claim', sessionId }).success
    expect(claim('s'.repeat(CEILING))).toBe(true)
    expect(claim('s'.repeat(CEILING + 1))).toBe(false)
    const task = (taskId: string): boolean =>
      runtimeCommandSchema.safeParse({
        kind: 'readWorkflowOutput',
        sessionId: 'sess_1',
        taskId,
      }).success
    expect(task('t'.repeat(CEILING))).toBe(true)
    expect(task('t'.repeat(CEILING + 1))).toBe(false)
  })
})
