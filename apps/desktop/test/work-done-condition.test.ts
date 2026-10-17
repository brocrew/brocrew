import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, rowsUnreadOnce, type SessionStore } from '../src/main/db/session-store'
import { giveRequestSchema, takeOnWorkRequestSchema } from '../src/main/runtime/spawn-rails'
import { WorkSearchEngine } from '../src/main/db/work-search-engine'
import { workSearchInWords } from '../src/shared/work-search-words'
import { workEdge } from '../src/shared/who-called-whom'
import { workReading } from '../src/renderer/src/lib/work-report'
import type { WorkGivenEvent } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const CONDITION = 'Both fictional outputs are recorded and the comparison passes.'
const request = {
  title: 'Fictional work',
  brief: 'Read the input file.',
  definition_of_done: CONDITION,
}

describe('work has an explicit bounded done condition', () => {
  it('requires the field in both doors without extracting Done when prose', () => {
    for (const schema of [takeOnWorkRequestSchema, giveRequestSchema]) {
      const base = { profile: 'fictional-worker', ...request }
      const supplied = schema === giveRequestSchema ? base : request
      const { definition_of_done: _, ...missing } = supplied
      void _
      const read = schema.safeParse({ ...missing, brief: 'Done when: the comparison passes.' })
      expect(read.success).toBe(false)
      if (!read.success)
        expect(read.error.issues.map((issue) => issue.message)).toContain(
          'definition_of_done is required: say what done means and how to check it.',
        )
      expect(schema.safeParse(supplied).success).toBe(true)
    }
  })

  it('pins character boundaries, blanks and multiline inputs without a line cap', () => {
    for (const [schema, fields] of [
      [giveRequestSchema, { profile: 'fictional-worker' }],
      [takeOnWorkRequestSchema, {}],
    ] as const) {
      for (const condition of [' ', '\t\n', 'x'.repeat(513), '😀'.repeat(257)])
        expect(
          schema.safeParse({ ...fields, ...request, definition_of_done: condition }).success,
        ).toBe(false)
      for (const condition of ['x'.repeat(512), '😀'.repeat(256), 'evidence\n'.repeat(30)])
        expect(
          schema.safeParse({ ...fields, ...request, definition_of_done: condition }).success,
        ).toBe(true)
      expect(schema.safeParse({ ...fields, ...request, brief: 'x'.repeat(2000) }).success).toBe(
        true,
      )
      const tooLong = schema.safeParse({ ...fields, ...request, brief: 'x'.repeat(2001) })
      expect(tooLong.success).toBe(false)
      if (!tooLong.success)
        expect(tooLong.error.issues.map((issue) => issue.message)).toContain(
          'The brief is limited to 2000 characters. Put the rest in an input file.',
        )
      expect(
        schema.safeParse({ ...fields, ...request, brief: 'list item\n'.repeat(100) }).success,
      ).toBe(true)
    }
  })
})

describe('done conditions replay without changing old work or its state', () => {
  let folder: string
  let db: AppDatabase
  let store: SessionStore
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'brobot-work-condition-'))
    db = openDatabase(join(folder, 'test.sqlite'))
    applyMigrations(db, join(here, '../src/main/db/migrations'))
    store = createSessionStore(db)
    store.create({
      id: 'fictional-parent',
      provider: 'claude',
      profileId: 'parent',
      cwd: folder,
      approvalMode: 'auto',
    })
    store.create({
      id: 'fictional-worker',
      provider: 'claude',
      profileId: 'worker',
      cwd: folder,
      approvalMode: 'auto',
      parentSessionId: 'fictional-parent',
    })
  })
  afterEach(() => {
    db.close()
    rmSync(folder, { recursive: true, force: true })
    vi.restoreAllMocks()
  })
  const give = (condition?: string) => {
    const parent = store.rootOf('fictional-parent')!
    const number = store.numberUnder(parent.piece)
    const piece = `fictional-piece-${number}`
    const label = `${parent.label}.${number}`
    const event: WorkGivenEvent = {
      type: 'work_given',
      piece,
      label,
      parent: parent.piece,
      givenBy: 'fictional-parent',
      title: request.title,
      brief: 'A historical long brief. '.repeat(200),
      ...(condition === undefined ? {} : { definitionOfDone: condition }),
    }
    store.recordGive(
      {
        piece,
        parent: parent.piece,
        number,
        owner: 'fictional-worker',
        givenBy: 'fictional-parent',
        title: event.title,
        brief: event.brief,
        folder: null,
        inputs: [],
      },
      store.nextOrdinal('fictional-worker'),
      event,
      1,
    )
    return { piece, label }
  }
  it('keeps absent historical fields, changes only the condition, and preserves it across old rebriefs', () => {
    const legacy = give()
    const current = give(CONDITION)
    store.append(
      'fictional-worker',
      store.nextOrdinal('fictional-worker'),
      {
        type: 'work_status_set',
        piece: current.piece,
        line: 'Waiting for fictional evidence.',
        by: 'fictional-worker',
        waiting: true,
      },
      1,
    )
    expect(
      store.piecesOwnedBy('fictional-worker').find((row) => row.piece === legacy.piece)
        ?.definitionOfDone,
    ).toBeNull()
    const before = store
      .piecesOwnedBy('fictional-worker')
      .find((row) => row.piece === current.piece)!
    expect(before.state).toBe('waiting-on-purpose')
    store.append(
      'fictional-worker',
      store.nextOrdinal('fictional-worker'),
      {
        type: 'work_rebriefed',
        piece: current.piece,
        definitionOfDone: 'Independent evidence: violet.',
        by: 'fictional-parent',
      },
      2,
    )
    const changed = store
      .piecesOwnedBy('fictional-worker')
      .find((row) => row.piece === current.piece)!
    expect(changed.brief).toBe(before.brief)
    expect(changed.state).toBe(before.state)
    expect(changed.statusLine).toEqual(before.statusLine)
    expect(changed.definitionOfDone).toBe('Independent evidence: violet.')
    store.append(
      'fictional-worker',
      store.nextOrdinal('fictional-worker'),
      {
        type: 'work_rebriefed',
        piece: current.piece,
        brief: 'A revised brief.',
        by: 'fictional-parent',
      },
      3,
    )
    const replay = store
      .piecesOwnedBy('fictional-worker')
      .find((row) => row.piece === current.piece)!
    expect(replay.definitionOfDone).toBe('Independent evidence: violet.')
    expect(replay.brief).toBe('A revised brief.')
    expect(workReading(workEdge(replay, 'worker', 'parent')).definitionOfDone).toBe(
      replay.definitionOfDone,
    )
  })
  it('reads root revisions and preserves them after a brief-only revision', () => {
    const root = store.rootOf('fictional-parent')!
    expect(store.rootDoneCondition(root.piece)).toBeNull()
    store.append(
      root.owner,
      store.nextOrdinal(root.owner),
      { type: 'work_rebriefed', piece: root.piece, definitionOfDone: CONDITION, by: root.owner },
      2,
    )
    store.append(
      root.owner,
      store.nextOrdinal(root.owner),
      { type: 'work_rebriefed', piece: root.piece, brief: 'Root brief.', by: root.owner },
      3,
    )
    expect(store.rootDoneCondition(root.piece)).toBe(CONDITION)
    expect(store.workThatNames(root.owner)?.definitionOfDone).toBe(CONDITION)
  })
  it('searches the condition through the bounded real engine and keeps title/result matching', () => {
    const { piece } = give('Only the condition contains ambercheck.')
    const engine = new WorkSearchEngine(join(folder, 'test.sqlite'), () => 10)
    try {
      const result = engine.read('fictional-parent', {
        scope: 'this-conversation',
        words: 'ambercheck',
        limit: 1,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('fictional search failed')
      expect(result.page.hits.map((hit) => hit.piece)).toEqual([piece])
      expect(result.page.hits[0]?.definition_of_done).toBe(
        'Only the condition contains ambercheck.',
      )
      expect(workSearchInWords(result.page)).toContain(
        'Done when: Only the condition contains ambercheck.',
      )
      const absent = engine.read('fictional-parent', {
        scope: 'this-conversation',
        words: 'not_in_any_field',
        limit: 1,
      })
      expect(absent.ok && absent.page.hits).toEqual([])
    } finally {
      engine.close()
    }
  })
  it('reports a malformed condition as unread instead of a known absent condition', () => {
    const { piece } = give(CONDITION)
    store.append(
      'fictional-worker',
      store.nextOrdinal('fictional-worker'),
      {
        type: 'work_rebriefed',
        piece,
        definitionOfDone: 'Initially readable.',
        by: 'fictional-parent',
      },
      2,
    )
    db.prepare(
      "UPDATE events SET payload = json_set(payload, '$.definitionOfDone', 17) WHERE session_id = ? AND type = 'work_rebriefed'",
    ).run('fictional-worker')
    const unread = rowsUnreadOnce()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const counted = store.piecesOwnedBy('fictional-worker', unread)
    expect(unread.count).toBe(1)
    expect(counted.find((row) => row.piece === piece)).not.toHaveProperty('definitionOfDone')
    expect(
      store.piecesOwnedBy('fictional-worker').find((row) => row.piece === piece),
    ).not.toHaveProperty('definitionOfDone')
  })
})
