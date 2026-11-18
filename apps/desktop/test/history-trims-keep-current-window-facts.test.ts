import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { aServiceWorld } from './helpers/a-service-world'
import { aLibraryHost } from './helpers/files-library-fixture'
import { adoptOwnerWithChild } from './helpers/adopt-owner-with-child'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import type { WindowReadQuery } from '../src/main/db/window-read-protocol'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { sameWindowWriter } from '../src/main/db/window-routing-reads'
import { eventTrimWriter } from '../src/main/db/event-retention'
import type { TranscriptEvent } from '../src/shared/conversation-events'

function fixture() {
  const world = aServiceWorld()
  adoptOwnerWithChild(world.store, 'alpha', world.folder, 'Fictional open work')
  const engine = new WindowReadEngine(join(world.folder, 'brobot2.sqlite'))
  const read = vi.fn(async (query: WindowReadQuery) => engine.read(query))
  const announce = vi.fn()
  const statesMoved = vi.fn()
  const sample = windowWriterSampler(world.db, () => true)
  const host = aLibraryHost(world.folder, {
    store: world.store,
    afterFirstWindowLoad: new Promise<void>(() => {}),
    windowReader: { read, close: async () => engine.close() },
    windowWriterStamp: sample,
    announce,
    statesMoved,
  })
  const add = (event: TranscriptEvent) => {
    const ordinal = world.store.nextOrdinal('alpha')
    world.store.append('alpha', ordinal, event, 1)
    return (
      world.db
        .prepare('SELECT id FROM events WHERE session_id=? AND ordinal=?')
        .get('alpha', ordinal) as { id: string }
    ).id
  }
  const trim = eventTrimWriter(world.db)
  const remove = (...ids: string[]) => trim({ session: 'alpha', active: 0, ids, before: 2 })
  const settle = async () => {
    for (let n = 0; n < 4; n++) await new Promise((resolve) => setImmediate(resolve))
  }
  const listing = async () => {
    const result = await host.listConversations()
    if ('refused' in result) throw new Error(result.refused)
    expect(result.unresumable.map((one) => one.sessionId)).toEqual(['alpha'])
    return result
  }
  const close = async () => {
    await host.closeAll()
    await world.cleanUp()
  }
  return { world, host, read, sample, announce, statesMoved, add, remove, settle, listing, close }
}

it.each<TranscriptEvent>([
  { type: 'thinking', phase: 'delta', text: 'Fictional history' },
  { type: 'assistant_delta', text: 'Fictional history' },
])(
  'a pure $type trim refreshes history without re-reading unchanged current facts',
  async (event) => {
    const f = fixture()
    try {
      const old = f.add(event)
      f.add({ type: 'status', state: 'ended' })
      await f.settle()
      const before = await f.listing()
      const stamp = f.sample({ kind: 'listing' })
      const reads = f.read.mock.calls.length
      f.announce.mockClear()
      f.statesMoved.mockClear()
      expect(f.remove(old).changed).toBe(1)
      await f.settle()
      const after = await f.listing()
      expect(after.unresumable).toEqual(before.unresumable)
      expect(sameWindowWriter(stamp, f.sample({ kind: 'listing' }))).toBe(true)
      expect(f.read.mock.calls.length).toBe(reads)
      expect(f.announce).toHaveBeenCalledWith({ what: 'conversations' })
      expect(f.statesMoved).not.toHaveBeenCalled()
      expect(f.world.db.prepare('SELECT id FROM events WHERE id=?').get(old)).toBeUndefined()
    } finally {
      await f.close()
    }
  },
)

it('a real metadata change in the outer commit is not hidden by a nested history trim', async () => {
  const f = fixture()
  try {
    const old = f.add({ type: 'assistant_delta', text: 'Fictional history' })
    await f.settle()
    await f.listing()
    const reads = f.read.mock.calls.length
    const stamp = f.sample({ kind: 'listing' })
    f.world.db.transaction(() => {
      f.remove(old)
      f.world.db
        .prepare("UPDATE provider_session SET cwd=? WHERE id='alpha'")
        .run(join(f.world.folder, 'changed'))
    })()
    await f.settle()
    await f.listing()
    expect(sameWindowWriter(stamp, f.sample({ kind: 'listing' }))).toBe(false)
    expect(f.read.mock.calls.length).toBeGreaterThan(reads)
    expect(f.world.db.prepare("SELECT cwd FROM provider_session WHERE id='alpha'").get()).toEqual({
      cwd: join(f.world.folder, 'changed'),
    })
  } finally {
    await f.close()
  }
})

it.each(['launched', 'context_reading', 'unknown', 'torn-thinking', 'invalid-thinking'])(
  'retains broad invalidation for %s',
  async (kind) => {
    const f = fixture()
    try {
      const ordinal = f.world.store.nextOrdinal('alpha')
      const type = kind.endsWith('thinking') ? 'thinking' : kind
      f.world.db
        .prepare(
          `INSERT INTO events(id,session_id,generation,ordinal,type,payload,created_at)
      VALUES('unsafe','alpha',0,?,?,?,1)`,
        )
        .run(ordinal, type, kind === 'torn-thinking' ? '{' : JSON.stringify({ type }))
      await f.settle()
      await f.listing()
      const reads = f.read.mock.calls.length
      expect(f.remove('unsafe').changed).toBe(1)
      await f.settle()
      await f.listing()
      expect(f.read.mock.calls.length).toBeGreaterThan(reads)
    } finally {
      await f.close()
    }
  },
)

it('does not hide an unsafe deletion in the same native batch', async () => {
  const f = fixture()
  try {
    const old = f.add({ type: 'assistant_delta', text: 'Fictional history' })
    const context = f.add({
      type: 'context_reading',
      reading: { kind: 'tokens', used: 1 },
      source: 'fictional',
    })
    await f.settle()
    await f.listing()
    const reads = f.read.mock.calls.length
    expect(f.remove(old, context).changed).toBe(2)
    await f.settle()
    await f.listing()
    expect(f.read.mock.calls.length).toBeGreaterThan(reads)
  } finally {
    await f.close()
  }
})

it('keeps a real work change visible when its outer commit also trims history', async () => {
  const f = fixture()
  try {
    const old = f.add({ type: 'assistant_delta', text: 'Fictional history' })
    const piece = f.world.store.rootOf('alpha')!.piece
    await f.settle()
    await f.listing()
    const reads = f.read.mock.calls.length
    f.world.db.transaction(() => {
      f.remove(old)
      f.add({ type: 'work_retitled', piece, title: 'Changed fictional work', by: null })
    })()
    await f.settle()
    const answer = await f.listing()
    expect(answer.unresumable[0]?.named?.title).toBe('Changed fictional work')
    expect(f.read.mock.calls.length).toBeGreaterThan(reads)
  } finally {
    await f.close()
  }
})

it.each(['exec', 'all', 'iterate'])(
  'does not hide outer metadata SQL written through %s',
  async (method) => {
    const f = fixture()
    try {
      const old = f.add({ type: 'assistant_delta', text: 'Fictional history' })
      await f.settle()
      await f.listing()
      const reads = f.read.mock.calls.length
      f.announce.mockClear()
      f.world.db.transaction(() => {
        f.remove(old)
        const sql = "UPDATE agent_identity SET display_name='Changed fictional identity'"
        if (method === 'exec') f.world.db.exec(sql)
        else {
          const statement = f.world.db.prepare(sql + ' RETURNING id')
          if (method === 'all') statement.all()
          else for (const _row of statement.iterate()) void _row
        }
      })()
      await f.settle()
      await f.listing()
      expect(f.read.mock.calls.length).toBeGreaterThan(reads)
      expect(f.announce.mock.calls.some(([notice]) => notice.what === 'persons')).toBe(true)
      expect(
        f.world.store
          .agentIdentities()
          .every((one) => one.displayName === 'Changed fictional identity'),
      ).toBe(true)
    } finally {
      await f.close()
    }
  },
)

it('a rolled-back trim publishes nothing and leaves the warm answer usable', async () => {
  const f = fixture()
  try {
    const old = f.add({ type: 'assistant_delta', text: 'Fictional history' })
    await f.settle()
    await f.listing()
    const reads = f.read.mock.calls.length
    const stamp = f.sample({ kind: 'listing' })
    f.announce.mockClear()
    expect(() =>
      f.world.db.transaction(() => {
        f.remove(old)
        throw new Error('fictional rollback')
      })(),
    ).toThrow('fictional rollback')
    await f.settle()
    expect(f.world.db.prepare('SELECT id FROM events WHERE id=?').get(old)).toBeDefined()
    await f.listing()
    expect(sameWindowWriter(stamp, f.sample({ kind: 'listing' }))).toBe(true)
    expect(f.read.mock.calls.length).toBe(reads)
    expect(f.announce).not.toHaveBeenCalled()
  } finally {
    await f.close()
  }
})
