import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { expect, it } from 'vitest'
import { WindowReadEngine } from '../src/main/db/window-read-engine'
import { createSessionStore } from '../src/main/db/session-store'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import type { WindowStoreReader } from '../src/main/db/window-read-protocol'
import { aLibraryHost } from './helpers/files-library-fixture'
import { fixtureFolder, fixtureDatabase } from './lib/host-fixture'

it('actual person requests determine attention in direct and window snapshot reads', async () => {
  const directory = fixtureFolder('fictional-person-attention-')
  const db = fixtureDatabase(directory)
  const store = createSessionStore(db)
  const engine = new WindowReadEngine(join(directory, 'brobot2.sqlite'))
  const hosts: RuntimeHost[] = []
  let ordinal = 0
  const row = (owner: string, event: Parameters<typeof store.append>[2]) =>
    store.append(owner, store.nextOrdinal(owner), event, 1000 + ordinal++)
  const hostWith = (reader?: WindowStoreReader) => {
    const host = aLibraryHost(directory, {
      store,
      windowReader: reader,
      limitsWriterStamp: limitsWriterSampler(db, () => true),
      windowWriterStamp: windowWriterSampler(db, () => true),
    })
    hosts.push(host)
    return { host }
  }
  try {
    for (const id of ['alpha', 'beta'])
      store.create({
        id,
        provider: 'codex',
        cwd: directory,
        approvalMode: 'ask',
        profileId: 'fictional',
      })
    row('alpha', {
      type: 'question_asked',
      requestId: 'first',
      prompt: 'Which fictional option?',
      questions: [{ id: 'part', prompt: 'Which option?', options: [] }],
    })
    row('alpha', { type: 'request_routed', requestId: 'first', to: 'the-parent', parent: 'beta' })
    row('alpha', { type: 'request_escalated', requestId: 'first' })
    row('alpha', { type: 'request_resolved', id: 'first' })
    const root = store.ensurePersonalRoot('alpha', 1000 + ordinal++)
    store.recordGive(
      {
        piece: 'fictional-open-work',
        parent: root.piece,
        number: 1,
        owner: 'beta',
        givenBy: 'alpha',
        title: 'Completed result with work still open',
        brief: 'Keep the agreed task state.',
        folder: null,
        inputs: [],
      },
      store.nextOrdinal('beta'),
      {
        type: 'work_given',
        piece: 'fictional-open-work',
        label: `${root.label}.1`,
        parent: root.piece,
        givenBy: 'alpha',
        title: 'Completed result with work still open',
        brief: 'Keep the agreed task state.',
      },
      1000 + ordinal++,
    )
    for (const event of [
      { type: 'user_turn', text: 'Thanks for completing it.' },
      { type: 'turn', state: 'completed' },
      { type: 'status', state: 'idle' },
    ] as const) {
      store.append('beta', store.nextOrdinal('beta'), event, 1000 + ordinal++)
    }
    expect(store.workById('fictional-open-work')?.owner).toBe('beta')
    expect(store.piecesOwnedBy('beta')[0]?.state).toBe('waiting-on-the-person-who-wrote')
    const direct = hostWith().host
    const { host } = hostWith({ read: async (query) => engine.read(query), close: async () => {} })
    const attention = (reading: RuntimeHost) => {
      const card = reading.agentCard('beta', THE_APP_ITSELF, null)
      expect(card).not.toBeNull()
      return {
        replies: reading.waitingOnWhoWroteForAPerson().rows,
        count: reading.readWorkspace().needsYou,
        needsYou: card!.state.is === 'needs-you',
      }
    }
    const expected = { replies: [], count: { counted: 'in-full', count: 0 }, needsYou: false }
    const directAttention = attention(direct)
    const snapshot = engine.read({ kind: 'routes' })
    if (snapshot.kind !== 'routes') throw new Error('wrong result')
    expect(
      snapshot.work?.owners.find((one) => one.id === 'beta')?.waitsOnWhoWrote.value,
    ).toHaveLength(1)
    const windowAttention = await host.readForWindow(() => attention(host))
    expect({ direct: directAttention, window: windowAttention }).toEqual({
      direct: expected,
      window: expected,
    })
    expect(store.piecesOwnedBy('beta')[0]?.state).toBe('waiting-on-the-person-who-wrote')
  } finally {
    for (const host of hosts) await host.closeAll()
    engine.close()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
