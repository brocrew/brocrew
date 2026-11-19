import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import type {
  AllConversationTasksInput,
  AllConversationTasksResult,
  ConversationTaskPageResult,
} from '../src/shared/conversation-task-page'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

describe('the selected conversation task panel', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  let giver: string
  let target: string

  beforeEach(async () => {
    world = aServiceWorld()
    world.anAgent('giver', 'normal')
    world.anAgent('holder', 'normal')
    host = world.aHost()
    giver = await world.aPersonOpens(host, 'giver')
    target = await world.aPersonOpens(host, 'holder')
  })

  afterEach(async () => world.cleanUp())

  const read = async (sessionId: string, cursor?: string) =>
    (await executeRuntimeCommand(host, world.window, {
      kind: 'readConversationTasks',
      sessionId,
      cursor,
    })) as ConversationTaskPageResult

  it('selects the newest open task and pages five other tasks in give order with exact status time', async () => {
    const root = world.store.rootOf(giver)!
    const givenAt = world.clock + 100
    const pieces = Array.from({ length: 7 }, (_, i) => {
      const piece = `work_panel_${i}`
      const number = world.store.numberUnder(root.piece)
      const label = `${root.label}.${number}`
      const given = {
        piece,
        label,
        parent: root.piece,
        givenBy: giver,
        title: `Task ${i}`,
        brief: 'Read and sort',
      }
      world.store.recordGive(
        { ...given, number, owner: target, folder: null, inputs: [] },
        world.store.nextOrdinal(target),
        {
          type: 'work_given',
          ...given,
          definitionOfDone: 'Sorted and checked',
          ...(i === 0 ? { messageId: 'msg_panel_waiting' } : {}),
        },
        givenAt,
      )
      return { piece, label }
    })
    const closeTask = (piece: string) =>
      world.store.append(
        target,
        world.store.nextOrdinal(target),
        { type: 'work_replied', piece, outcome: 'done', summary: 'Checked', resources: [] },
        givenAt + 30,
      )
    closeTask(pieces[6]!.piece)
    const statusAt = givenAt + 55
    const statusOrdinal = world.store.nextOrdinal(target)
    world.store.append(
      target,
      statusOrdinal,
      { type: 'work_status_set', piece: pieces[5]!.piece, line: 'Sorting', by: target },
      statusAt,
    )
    const ledger = world.store.events(target)
    const starts = world.handles.length

    const page = await read(target)
    if (!page.ok || page.next === null || page.counts === null) throw new Error('missing task page')
    expect(page.current).toMatchObject({
      ...pieces[5],
      kind: 'held',
      title: 'Task 5',
      brief: 'Read and sort',
      giver,
      definitionOfDone: 'Sorted and checked',
      givenAt,
      statusLine: { text: 'Sorting', at: statusAt },
    })
    expect(page.other.map(({ piece }) => piece)).toEqual(
      [6, 4, 3, 2, 1].map((i) => pieces[i]!.piece),
    )
    expect(page.counts).toEqual({ active: 5, open: 1, closed: 1 })
    expect(await read(target, page.next)).toMatchObject({
      ok: true,
      other: [{ ...pieces[0], state: 'waiting' }],
      next: null,
    })
    expect(await read(giver, page.next)).toEqual({ ok: false, reason: 'invalid-cursor' })
    expect(world.store.events(target)).toEqual(ledger)
    expect(world.handles).toHaveLength(starts)

    closeTask(pieces[5]!.piece)
    expect(await read(target, page.next)).toEqual({ ok: false, reason: 'invalid-cursor' })
    world.db
      .prepare('UPDATE events SET payload = ? WHERE session_id = ? AND ordinal = ?')
      .run('invalid json', target, statusOrdinal)
    expect(await read(target)).toMatchObject({ ok: true, counts: null, rowsUnread: 1 })
  })

  it('shows the person root separately and refuses an unknown selected ID', async () => {
    const root = world.store.rootOf(target)!
    const at = world.clock + 23
    world.store.append(
      target,
      world.store.nextOrdinal(target),
      { type: 'work_status_set', piece: root.piece, line: 'Person task status', by: target },
      at,
    )
    expect(await read(target)).toMatchObject({
      ok: true,
      current: {
        kind: 'root',
        piece: root.piece,
        label: root.label,
        statusLine: { text: 'Person task status', at },
      },
      other: [],
      counts: { active: 0, open: 0, closed: 0 },
      next: null,
    })
    expect(await read('sess_missing')).toEqual({ ok: false, reason: 'unknown-conversation' })
  })

  it('pages All tasks in recorded order with the root and full filtered counts', async () => {
    const subject = world.store.rootOf(target)!
    const parent = world.store.rootOf(giver)!
    const at = world.clock + 200
    const legacyTitle = 'x'.repeat(1600)
    const pieces = Array.from({ length: 22 }, (_, index) => {
      const piece = `work_all_${String(22 - index).padStart(2, '0')}`
      const number = world.store.numberUnder(parent.piece)
      const task = {
        piece,
        label: `${parent.label}.${number}`,
        parent: parent.piece,
        givenBy: giver,
        title: `${legacyTitle} ${index === 0 || index === 20 ? 'Index sources' : 'Read files'}`,
        brief: 'The original brief',
      }
      world.store.recordGive(
        { ...task, number, owner: target, folder: null, inputs: [] },
        world.store.nextOrdinal(target),
        {
          type: 'work_given',
          ...task,
          definitionOfDone: 'Sources checked',
          ...(index === 0 ? { messageId: 'msg_all_held' } : {}),
        },
        index === 21 ? at - 1 : at,
      )
      return piece
    })
    world.store.append(
      target,
      world.store.nextOrdinal(target),
      {
        type: 'work_replied',
        piece: pieces[20]!,
        outcome: 'done',
        summary: 'Indexed',
        resources: [],
      },
      at + 1,
    )
    const all = async (
      options: Partial<AllConversationTasksInput> = {},
    ): Promise<AllConversationTasksResult> =>
      (await executeRuntimeCommand(host, world.window, {
        kind: 'readAllConversationTasks',
        sessionId: target,
        filter: 'all',
        ...options,
      })) as AllConversationTasksResult
    const ledger = world.store.events(target)
    const starts = world.handles.length
    const first = await all()
    if (!first.ok || first.next === null) throw new Error('missing All tasks cursor')
    expect(first.root).toMatchObject({ label: subject.label })
    expect(first.tasks.map(({ piece }) => piece)).toEqual(pieces.slice(0, 20))
    expect(first.tasks[0]).toMatchObject({
      from: giver,
      fromIdentity: 'giver',
      state: 'waiting',
      definitionOfDone: 'Sources checked',
    })
    const counts = { all: 23, active: 20, open: 2, closed: 1 }
    expect(first).toMatchObject({ counts, matched: 23, newestOpenMatch: pieces[21] })
    const last = await all({ cursor: first.next })
    if (!last.ok) throw new Error('missing All tasks continuation')
    expect(last.tasks.map(({ piece }) => piece)).toEqual(pieces.slice(20))
    expect(last.tasks[0]).toMatchObject({ state: 'answered', outcome: 'done' })
    expect(last).toMatchObject({
      root: null,
      counts,
      matched: 23,
      newestOpenMatch: pieces[21],
      next: null,
    })
    expect(await all({ filter: 'closed', text: ' INDEX ' })).toMatchObject({
      root: null,
      tasks: [{ piece: pieces[20] }],
      counts,
      matched: 1,
      newestOpenMatch: null,
    })
    expect(await all({ filter: 'open' })).toMatchObject({
      root: { label: subject.label },
      tasks: [{ piece: pieces[0] }],
      counts,
      matched: 2,
      newestOpenMatch: pieces[0],
    })
    expect(await all({ text: subject.label })).toMatchObject({
      root: { label: subject.label },
      tasks: [],
      counts,
      matched: 1,
      newestOpenMatch: null,
    })
    const invalid = { ok: false, reason: 'invalid-cursor' }
    expect(await all({ cursor: first.next, text: 'Read files' })).toEqual(invalid)
    expect(await all({ cursor: first.next, filter: 'active' })).toEqual(invalid)
    expect(await all({ cursor: first.next, sessionId: giver })).toEqual(invalid)
    const longSearch = await all({ text: legacyTitle })
    if (!longSearch.ok || longSearch.next === null) throw new Error('missing long search cursor')
    expect(longSearch.next.length).toBeGreaterThan(2048)
    expect(await all({ text: legacyTitle, cursor: longSearch.next })).toMatchObject({
      ok: true,
      tasks: [{ piece: pieces[20] }, { piece: pieces[21] }],
      next: null,
    })
    expect(await all({ sessionId: 'sess_missing' })).toEqual({
      ok: false,
      reason: 'unknown-conversation',
    })
    expect(world.store.events(target)).toEqual(ledger)
    expect(world.handles).toHaveLength(starts)

    await host.close(target, world.window)
    const running = () => host.resumableSessions().find((one) => one.sessionId === target)?.running
    expect(running()).toBe('not-running')
    const stoppedLedger = world.store.events(target)
    const giverLedger = world.store.events(giver)
    const stoppedStarts = world.handles.length
    expect(await all()).toMatchObject({ ok: true })
    expect(running()).toBe('not-running')
    expect(world.handles).toHaveLength(stoppedStarts)
    expect(world.store.events(target)).toEqual(stoppedLedger)
    expect(world.store.events(giver)).toEqual(giverLedger)

    world.db
      .prepare(
        "UPDATE events SET payload = 'invalid json' WHERE session_id = ? AND type = 'work_given' AND json_extract(payload, '$.piece') = ?",
      )
      .run(target, pieces[19])
    expect(await all({ cursor: first.next })).toEqual(invalid)
    expect(await all()).toMatchObject({ ok: true, counts: null, matched: null, rowsUnread: 1 })
  })
})
