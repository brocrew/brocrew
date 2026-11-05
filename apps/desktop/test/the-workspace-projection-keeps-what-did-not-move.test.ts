import { describe, expect, it } from 'vitest'
import { conversationList } from '../src/renderer/src/lib/conversation-list'
import {
  createWorkspaceProjection,
  type WorkspaceProjection,
} from '../src/renderer/src/lib/workspace-projection'
import {
  theWaitIn,
  theWorkIn,
  stoppedWorkIn,
  whenItsWaitsBeganIn,
  whoseAnswerIn,
  whoseWorkIn,
} from '../src/renderer/src/lib/conversation-waits'
import type { ResumableSessionInfo } from '../src/shared/runtime-ipc'
import {
  OWNER,
  REALISTIC,
  childId,
  otherId,
  workspaceAtScale,
  type WorkspaceAtScale,
} from './fixtures/workspace-at-scale'

/**
 * The window's one owner of workspace metadata: the listed conversations, their host states, the
 * waits, the forest and the process figures. Only its ingestion writes; every surface reads through
 * its selectors. These are the identity and semantic rules the surfaces rely on, at the size a busy
 * person's workspace reaches.
 */

/** A deep copy, as a fresh bridge answer is: equal to the last one, sharing no object with it. */
const again = <T>(value: T): T => structuredClone(value)

function projected(data: WorkspaceAtScale = workspaceAtScale()): WorkspaceProjection {
  const projection = createWorkspaceProjection({ identities: () => data.identities })
  const ticket = projection.listAsked()
  projection.listAnswered(ticket, again(data.resumable), again(data.unresumable))
  projection.waitsRead(again(data.waits))
  projection.forestRead(again(data.forest))
  projection.memoryRead(again(data.memory))
  return projection
}

describe('before anything is read', () => {
  it('says nobody has looked, never an empty workspace', () => {
    const projection = createWorkspaceProjection()
    expect(projection.listed()).toBeNull()
    expect(projection.running()).toBeNull()
    expect(projection.conversation(OWNER)).toBeUndefined()
    expect(projection.waits()).toBeNull()
    expect(projection.waitOf(OWNER).reading).toEqual({ known: 'nobody-has-looked' })
    expect(projection.forest()).toBeNull()
    expect(projection.memoryUnmeasured()).toBeNull()
    expect(projection.memoryOf(OWNER)).toBeUndefined()
  })
})

describe('the listed conversations are the one fold every surface drew before', () => {
  it('lists exactly what `conversationList` folds, newest first, without the personal one', () => {
    const data = workspaceAtScale()
    const projection = projected(data)
    const expected = conversationList({
      resumable: data.resumable,
      unresumable: data.unresumable,
      identities: data.identities,
    })
    expect(projection.listed()).toEqual(expected)
    expect(projection.listed()).toHaveLength(REALISTIC.conversations)
    expect(projection.conversation('fictional-found-at-home')).toBeUndefined()
    for (const row of expected) expect(projection.conversation(row.sessionId)).toEqual(row)
  })

  it('names the running ones with their provider and state, as the band and the Team page read them', () => {
    const data = workspaceAtScale()
    const projection = projected(data)
    const running = projection.running()!
    expect(running).toHaveLength(
      data.resumable.filter((row) => row.running !== 'not-running').length,
    )
    expect(running[0]).toEqual({ sessionId: OWNER, provider: 'codex', state: { is: 'active' } })
  })

  it('groups each identity’s conversations once, in the list’s order', () => {
    const data = workspaceAtScale()
    const projection = projected(data)
    const listed = projection.listed()!
    const identity = listed[0]!.identity
    expect(projection.ofIdentity(identity)).toEqual(
      listed.filter((row) => row.identity === identity),
    )
    expect(projection.ofIdentity('fictional-nobody')).toEqual([])
  })
})

describe('an answer that moved nothing keeps every object it holds', () => {
  it('keeps the list, every row, every identity group and the running list identical', () => {
    const data = workspaceAtScale()
    const projection = projected(data)
    const listed = projection.listed()
    const running = projection.running()
    const rows = listed!.map((row) => projection.conversation(row.sessionId))
    const group = projection.ofIdentity(listed![0]!.identity)
    projection.listAnswered(projection.listAsked(), again(data.resumable), again(data.unresumable))
    expect(projection.listed()).toBe(listed)
    expect(projection.running()).toBe(running)
    expect(projection.ofIdentity(listed![0]!.identity)).toBe(group)
    listed!.forEach((row, index) =>
      expect(projection.conversation(row.sessionId)).toBe(rows[index]),
    )
  })

  it('keeps the waits, the forest and the process figures identical', () => {
    const data = workspaceAtScale()
    const projection = projected(data)
    const waitOfChild = projection.waitOf(childId(4))
    const waitOfOwner = projection.waitOf(OWNER)
    const pieces = projection.piecesHeldBy(childId(4))
    const forest = projection.forest()
    projection.waitsRead(again(data.waits))
    projection.forestRead(again(data.forest))
    projection.memoryRead(again(data.memory))
    expect(projection.waitOf(childId(4))).toBe(waitOfChild)
    expect(projection.waitOf(OWNER)).toBe(waitOfOwner)
    expect(projection.piecesHeldBy(childId(4))).toBe(pieces)
    expect(projection.forest()).toBe(forest)
  })

  it('hands every conversation without stopped work the one same empty list', () => {
    const projection = projected()
    const none = projection.waitOf(childId(1)).stoppedWork
    expect(none).toEqual([])
    expect(projection.waitOf(childId(2)).stoppedWork).toBe(none)
    expect(projection.waitOf('fictional-never-listed').stoppedWork).toBe(none)
    expect(projection.piecesHeldBy('fictional-never-listed')).toBe(
      projection.piecesHeldBy('fictional-also-never-listed'),
    )
  })
})

describe('a forest read again', () => {
  it('keeps every holder’s pieces when only the time it was read moved', () => {
    const data = workspaceAtScale()
    const projection = projected(data)
    const held = projection.piecesHeldBy(childId(4))
    const other = projection.piecesHeldBy(childId(5))
    projection.forestRead({ ...again(data.forest), readAt: data.forest.readAt + 30_000 })
    expect(projection.forest()?.readAt).toBe(data.forest.readAt + 30_000)
    expect(projection.piecesHeldBy(childId(4))).toBe(held)
    expect(projection.piecesHeldBy(childId(5))).toBe(other)
  })

  it('renews only the holder whose piece moved, keeping its other pieces', () => {
    const data = workspaceAtScale()
    const projection = projected(data)
    const held = projection.piecesHeldBy(childId(4))
    const other = projection.piecesHeldBy(childId(5))
    const moved = held[1]!.piece
    const forest = again(data.forest)
    const rows = forest.nodes.rows.map((node) =>
      node.node === 'a-task' && node.work.piece === moved
        ? { ...node, work: { ...node.work, title: 'A fictional retitled piece' } }
        : node,
    )
    projection.forestRead({
      ...forest,
      readAt: forest.readAt + 30_000,
      nodes: { ...forest.nodes, rows },
    })
    const after = projection.piecesHeldBy(childId(4))
    expect(after).not.toBe(held)
    expect(after[1]!.title).toBe('A fictional retitled piece')
    expect(after[0]).toBe(held[0])
    expect(projection.piecesHeldBy(childId(5))).toBe(other)
  })
})

describe('an answer that moved one conversation renews only what holds it', () => {
  it('renews that row and the collections it is in, and keeps every other row', () => {
    const data = workspaceAtScale()
    const projection = projected(data)
    const listed = projection.listed()!
    const moved = childId(7)
    const before = new Map(
      listed.map((row) => [row.sessionId, projection.conversation(row.sessionId)]),
    )
    const changed = data.resumable.map((row): ResumableSessionInfo =>
      row.sessionId === moved ? { ...row, state: { is: 'active' } } : row,
    )
    projection.listAnswered(projection.listAsked(), again(changed), again(data.unresumable))
    expect(projection.conversation(moved)?.state).toEqual({ is: 'active' })
    expect(projection.conversation(moved)).not.toBe(before.get(moved))
    expect(projection.listed()).not.toBe(listed)
    for (const [id, row] of before) if (id !== moved) expect(projection.conversation(id)).toBe(row)
    const ownIdentity = projection.conversation(moved)!.identity
    const another = listed.find((row) => row.identity !== ownIdentity)!.identity
    const untouched = projection.ofIdentity(another)
    projection.listAnswered(projection.listAsked(), again(changed), again(data.unresumable))
    expect(projection.ofIdentity(another)).toBe(untouched)
  })

  it('says a pushed state at once, and keeps every other row', () => {
    const projection = projected()
    const other = projection.conversation(otherId(3))
    projection.statesMoved([{ conversation: childId(9), state: { is: 'needs-you' } }])
    expect(projection.conversation(childId(9))?.state).toEqual({ is: 'needs-you' })
    expect(projection.conversation(otherId(3))).toBe(other)
  })
})

describe('a pushed state gives way only to a list read asked after it arrived', () => {
  it('keeps a push over a read that was already in flight, and yields to the next read', () => {
    const data = workspaceAtScale()
    const projection = projected(data)
    const inFlight = projection.listAsked()
    projection.statesMoved([{ conversation: childId(3), state: { is: 'active' } }])
    projection.listAnswered(inFlight, again(data.resumable), again(data.unresumable))
    expect(projection.conversation(childId(3))?.state).toEqual({ is: 'active' })
    projection.listAnswered(projection.listAsked(), again(data.resumable), again(data.unresumable))
    expect(projection.conversation(childId(3))?.state).toEqual(
      data.resumable.find((row) => row.sessionId === childId(3))!.state,
    )
  })

  it('drops a read that lands after a newer one was asked', () => {
    const data = workspaceAtScale()
    const projection = projected(data)
    const older = projection.listAsked()
    const newer = projection.listAsked()
    const fresh = data.resumable.map((row) =>
      row.sessionId === childId(1) ? { ...row, state: { is: 'active' as const } } : row,
    )
    expect(projection.listAnswered(newer, again(fresh), [])).toBe(true)
    expect(projection.listAnswered(older, again(data.resumable), [])).toBe(false)
    expect(projection.conversation(childId(1))?.state).toEqual({ is: 'active' })
  })

  it('keeps the last good list on a refused read, and says why', () => {
    const projection = projected()
    const listed = projection.listed()
    projection.listRefused(projection.listAsked(), 'The fictional host did not answer.')
    expect(projection.listed()).toBe(listed)
    expect(projection.listError()).toBe('The fictional host did not answer.')
  })
})

describe('the waits keep their three absences', () => {
  it('answers each conversation as `conversation-waits` did, out of one indexed reading', () => {
    const data = workspaceAtScale()
    const projection = projected(data)
    for (const id of [OWNER, childId(0), childId(7), otherId(0), 'fictional-never-listed']) {
      const one = projection.waitOf(id)
      expect(one.wait).toEqual(theWaitIn(data.waits, id))
      expect(one.work).toEqual(theWorkIn(data.waits, id))
      expect(one.answerFrom).toEqual(whoseAnswerIn(data.waits, id))
      expect(one.workWith).toEqual(whoseWorkIn(data.waits, id))
      expect(one.stoppedWork).toEqual(stoppedWorkIn(data.waits, id))
      expect(one.began).toEqual(whenItsWaitsBeganIn(data.waits, id))
    }
  })

  it('tells not-in-the-reading from a read that says nothing is outstanding', () => {
    const projection = projected()
    expect(projection.waitOf('fictional-never-listed').reading).toEqual({
      known: 'not-in-the-reading',
    })
    expect(projection.waitOf(childId(1)).reading).toEqual({ known: 'read', waiting: null })
    expect(projection.waits()?.rowsUnread).toBe(2)
  })

  it('keeps the last good reading when a read does not answer', () => {
    const projection = projected()
    const waits = projection.waits()
    projection.waitsRead(null)
    expect(projection.waits()).toBe(waits)
  })

  it('records a fresh reading’s time even when no conversation’s wait moved', () => {
    const data = workspaceAtScale()
    const projection = projected(data)
    const one = projection.waitOf(childId(4))
    projection.waitsRead({ ...again(data.waits), readAt: data.waits.readAt + 30_000 })
    expect(projection.waits()?.readAt).toBe(data.waits.readAt + 30_000)
    expect(projection.waitOf(childId(4))).toBe(one)
  })
})

describe('the forest and the process figures', () => {
  it('names the open pieces each conversation holds', () => {
    const projection = projected()
    const held = projection.piecesHeldBy(childId(4))
    expect(held.map((piece) => piece.to)).toEqual(held.map(() => childId(4)))
    expect(held).toHaveLength(REALISTIC.piecesPerConversation)
  })

  it('names a running conversation’s memory, and nothing for one it did not measure', () => {
    const projection = projected()
    expect(projection.memoryOf(OWNER)).toBeGreaterThan(0)
    expect(projection.memoryOf('fictional-never-listed')).toBeUndefined()
    projection.memoryRead({
      conversations: [],
      unmeasured: 'This fictional system lists no processes.',
    })
    expect(projection.memoryOf(OWNER)).toBeUndefined()
    expect(projection.memoryUnmeasured()).toBe('This fictional system lists no processes.')
  })

  it('draws no figure after a read that did not answer', () => {
    const projection = projected()
    projection.memoryRead(null)
    expect(projection.memoryOf(OWNER)).toBeUndefined()
    expect(projection.memoryUnmeasured()).toBeNull()
  })
})

describe('reset', () => {
  it('goes back to nobody has looked, and drops a read that was in flight', () => {
    const data = workspaceAtScale()
    const projection = projected(data)
    const inFlight = projection.listAsked()
    projection.reset()
    expect(projection.listed()).toBeNull()
    expect(projection.waits()).toBeNull()
    expect(projection.forest()).toBeNull()
    expect(projection.memoryOf(OWNER)).toBeUndefined()
    expect(projection.listAnswered(inFlight, again(data.resumable), [])).toBe(false)
    expect(projection.listed()).toBeNull()
  })
})

describe('the work grows with the workspace, never with its square', () => {
  /** How many times a row's id is read while one answer is taken in and every card is looked up. */
  function idReads(children: number, conversations: number): number {
    const data = workspaceAtScale({ ...REALISTIC, children, conversations })
    let reads = 0
    const counted = data.resumable.map((row) => {
      const copy = { ...row }
      const id = copy.sessionId
      Object.defineProperty(copy, 'sessionId', {
        enumerable: true,
        get: () => {
          reads += 1
          return id
        },
      })
      return copy
    })
    const projection = createWorkspaceProjection({ identities: () => data.identities })
    projection.listAnswered(projection.listAsked(), counted, [])
    for (let index = 0; index < children; index++) {
      for (let look = 0; look < 6; look++) projection.conversation(childId(index))
    }
    return reads
  }

  it('reads each row a bounded number of times, and twice the workspace costs at most twice', () => {
    const base = idReads(REALISTIC.children, REALISTIC.conversations)
    const doubled = idReads(REALISTIC.children * 2, REALISTIC.conversations * 2)
    expect(base).toBeLessThanOrEqual(4 * REALISTIC.conversations)
    expect(doubled / base).toBeLessThanOrEqual(2.2)
  })
})
