import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { ConversationTaskPageResult } from '../src/shared/conversation-task-page'
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
})
