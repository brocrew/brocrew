import { neutralHostDeps } from './lib/host-fixture'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeRuntime } from '@brobot2/runtime'
import { claudeAutoMemoryDir } from '@brobot2/runtime/claude'
import type { Provider } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  createMemoryAmendmentObserver,
  createSessionStore,
  type SessionStore,
} from '../src/main/db/session-store'
import { createMemoryService, type MemoryWriteSeams } from '../src/main/runtime/agent-memory'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { WINDOW_CALLER_PREFIX } from '../src/main/runtime/window-caller'
import { REFUSAL_MEANS } from '../src/shared/agent-memory'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * # 🔴 The memory door, through a real host (625, `EXT-015` §1 · §3)
 *
 * ⛔ **`memory-without-a-conversation.test.ts` proves the READER and proves nothing about the
 * wiring** — which is `318`'s own lesson, quoted by `memory-loaded-host.test.ts` one door over:
 * *"with only the unit file in the suite, deleting the host's publish left every assertion green
 * while the conversation showed nothing."* ⚠️ So every assertion here goes through a real
 * `RuntimeHost`, a real store and a real database.
 *
 * ## ⛔ The four facts this file holds
 *
 *  1. **The read needs no conversation** — the whole of `EXT-015` §1's Team-page door.
 *  2. **The act and its RECORD land together**, and the record survives the file.
 *  3. **A refusal answers a READING**, not a throw — `425`'s rule that a refusal carries its
 *     remedy, and `HO-029` §3's that a surface may not report an act it cannot confirm.
 *  4. **Criterion 12**: a slug with no identity row writes nothing and says so.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  // ⛔ **A WINDOW's owner id, not `owner:1`.** `aPersonTypedIt` is `aWindowIsAsking(ownerId)`, so
  // a sink with an arbitrary id records every act as *a caller this app cannot name* — which would
  // make §2's `{ who: 'a-person' }` assertions pass for the wrong reason, or not at all.
  readonly ownerId = `${WINDOW_CALLER_PREFIX}1`
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
  events(): TranscriptEvent[] {
    return this.messages.map((message) => message.event)
  }
}

const THE_FALSE_NOTE =
  'a deliberately parked agent is indistinguishable from a broken one in this app\n'

let userData: string
let db: AppDatabase
let host: RuntimeHost
let sink: RecordingSink

const homeOf = (provider: Provider, profileId: string): string =>
  join(userData, 'provider-homes', 'default', profileId, provider)

/**
 * ⚑ **The composition this file's hosts are built from, as a FACTORY** — so the refusing-store
 * host in §2 differs from the ordinary one in exactly one dep and in nothing else.
 *
 * ⛔ **A second literal would be a second answer to *what is this host*** — and the assertion
 * that turns on the difference would then be measuring whichever field drifted.
 */
/** ⚠️ **Reset per test**, so a session id never depends on how many tests ran before it. */
let counter = 0
async function hostDeps(
  options: {
    store?: SessionStore
    writes?: MemoryWriteSeams
    beforeEffect?: () => Promise<void>
    closeWaitMs?: number
    closeGate?: Promise<void>
  } = {},
): Promise<ConstructorParameters<typeof RuntimeHost>[0]> {
  const store = options.store ?? createSessionStore(db)
  const memoryKnowledge = await createMemoryService({
    store,
    inputsOf: (slug) => ({
      profileId: slug,
      homesRoot: join(userData, 'provider-homes'),
      homeOf: (provider) => homeOf(provider, slug),
    }),
    now: Date.now,
    reconcile: createMemoryAmendmentObserver(db).reconcile,
    seams: { writes: options.writes, beforeEffect: options.beforeEffect },
  })
  return {
    store,
    memoryKnowledge:
      options.closeGate !== undefined
        ? {
            ...memoryKnowledge,
            close: async () => {
              await memoryKnowledge.close(options.closeWaitMs)
              await options.closeGate
            },
          }
        : options.closeWaitMs === undefined
          ? memoryKnowledge
          : { ...memoryKnowledge, close: () => memoryKnowledge.close(options.closeWaitMs) },
    ...neutralHostDeps(() => userData),
    createRuntime: (provider: Provider) => new FakeRuntime(provider),
    prepareProviderHome: (provider, profileId) => {
      const home = homeOf(provider, profileId)
      mkdirSync(home, { recursive: true })
      return home
    },
    providerHomePath: (provider, profileId) => homeOf(provider, profileId),
    // ⛔ **The seam the containment check hangs off.** A host wired without it makes NOTHING
    // amendable — see §2's last case, which is the fail-closed direction stated as a test.
    providerHomesRoot: () => join(userData, 'provider-homes'),
    resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
    newSessionId: () => `sess_${String(++counter)}`,
    readProviderConfig: (provider, home) => ({
      home,
      homeEnv: 'CLAUDE_CONFIG_DIR',
      model: 'm',
      authNote: null,
      files: [],
    }),
    // ⛔ **The REAL launch reader, not a stub** — §3 is about what a conversation was GIVEN, and a
    // stubbed reader would make that assertion about the fixture instead of about the app.
    // ⚑ The composition root wraps it in a bundle publish; nothing here needs one, and the reader's
    // own contract is that an absent bundle is every host test that is not about instructions.
    readInstructions: (provider, cwd, providerHome) => {
      const read = readSessionInstructions({ provider, cwd, providerHome })
      // ⚑ **The composition root's own three fields**, and `systemHint` comes from the reader's
      // `composed` for its stated reason: one composition, handed to the adapter from the same
      // field the panel draws.
      return {
        instructions: read.instructions,
        systemHint: read.instructions.composed ?? undefined,
        memoryLoaded: read.memoryLoaded,
      }
    },
  }
}

beforeEach(async () => {
  counter = 0
  userData = mkdtempSync(join(tmpdir(), 'brobot2-memory-door-'))
  db = openDatabase(join(userData, 'brobot2.sqlite'))
  applyMigrations(db, migrationsFolder)
  host = new RuntimeHost(await hostDeps())
  sink = new RecordingSink()
})

afterEach(async () => {
  await host.closeAll()
  db.close()
  rmSync(userData, { recursive: true, force: true })
})

/** The night `EXT-015` §0 is about: an index with a pointer, and the false note beside it. */
const plantTheNight = (profileId: string): { note: string; index: string } => {
  const dir = claudeAutoMemoryDir(homeOf('claude', profileId))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'MEMORY.md'), '- [A parked agent](parked.md)\n')
  writeFileSync(join(dir, 'parked.md'), THE_FALSE_NOTE)
  return { note: join(dir, 'parked.md'), index: join(dir, 'MEMORY.md') }
}

const identity = (slug: string): void => {
  const made = createSessionStore(db).createAgentIdentity(
    { slug, displayName: null, provider: 'claude' },
    { by: 'a-person' },
  )
  expect(made, `no identity row for ${slug}`).not.toBeNull()
}

describe('§1 · ⛔ the read reaches the store with NO conversation open', () => {
  it('🔴 the Team page’s door answers both providers, the amendments and a moment', () => {
    identity('brobot')
    plantTheNight('brobot')

    const reading = host.agentMemory('BroBot')
    // ⚑ **Folded**, like every other slug argument on this host.
    expect(reading.profileId).toBe('brobot')
    expect(reading.stores.map((store) => store.provider)).toEqual(['claude', 'codex'])
    expect(reading.stores[0]?.entries.map((entry) => entry.text)).toContain(THE_FALSE_NOTE)
    // ⛔ **The OTHER provider is `no-home`, not an empty list** — `EXT-015` §3.4 answered by name.
    expect(reading.stores[1]?.state).toBe('no-home')
    expect(reading.amendments).toEqual([])
    expect(reading.readAt).toBeGreaterThan(0)
    // 🔴 **No conversation was created in this test at all.** That is the assertion, and it is the
    // whole of `EXT-015` §1: today's only memory reading is a conversation's.
    expect(sink.messages).toEqual([])
  })

  it('⚑ an identity with no row answers stores rather than a refusal — criterion 12 is on the WRITE', () => {
    const reading = host.agentMemory('nobody')
    expect(reading.stores.every((store) => store.state === 'no-home')).toBe(true)
    expect(reading.amendments).toEqual([])
  })
})

describe('§2 · 🔴 the act and its record land together', () => {
  it('⛔ a person removes the false note — the file goes, the row stays, and the reading comes back', async () => {
    identity('brobot')
    const { note } = plantTheNight('brobot')

    const answered = await host.amendAgentMemory(
      {
        profileId: 'brobot',
        provider: 'claude',
        entry: note,
        confirmed: true,
        act: 'removed',
        text: '',
      },
      sink,
    )

    expect(answered?.done).toBe(true)
    expect(existsSync(note)).toBe(false)
    // 🔴 **The record carries the bytes the file no longer has.**
    expect(answered?.done === true && answered.amendment.textBefore).toBe(THE_FALSE_NOTE)
    expect(answered?.done === true && answered.amendment.act).toBe('removed')
    expect(answered?.done === true && answered.amendment.by).toEqual({ who: 'a-person' })
    expect(answered?.done === true && answered.amendment.textAfter).toBeNull()
    // ⚑ **Read BACK rather than echoed** — the reading on the answer is taken after the act, and
    // the amendment is on it.
    expect(answered?.reading.amendments.map((one) => one.entry)).toEqual([note])
    expect(JSON.stringify(answered?.reading.stores)).not.toContain(THE_FALSE_NOTE.trim())
    // ⚠️ **And a second, independent read agrees** — so the answer is not a value this method built.
    expect(host.agentMemory('brobot').amendments).toHaveLength(1)
  })

  it('⛔ a correction records what it replaced AND what it put there', async () => {
    identity('brobot')
    const { note } = plantTheNight('brobot')

    const answered = await host.amendAgentMemory(
      {
        profileId: 'brobot',
        provider: 'claude',
        entry: note,
        confirmed: true,
        act: 'corrected',
        text: 'BROBOT-625-A-PARKED-AGENT-IS-DISTINGUISHABLE\n',
      },
      sink,
    )

    expect(answered?.done).toBe(true)
    expect(readFileSync(note, 'utf8')).toBe('BROBOT-625-A-PARKED-AGENT-IS-DISTINGUISHABLE\n')
    const row = host.agentMemory('brobot').amendments[0]
    expect(row?.act).toBe('corrected')
    expect(row?.textBefore).toBe(THE_FALSE_NOTE)
    expect(row?.textAfter).toBe('BROBOT-625-A-PARKED-AGENT-IS-DISTINGUISHABLE\n')
  })

  it('🔴 a REFUSAL answers a reading and records NOTHING — it does not throw', async () => {
    identity('brobot')
    plantTheNight('brobot')

    const answered = await host.amendAgentMemory(
      {
        profileId: 'brobot',
        provider: 'claude',
        entry: join(userData, 'provider-homes', 'default', 'brobot', 'claude', 'memory', 'gone.md'),
        confirmed: true,
        act: 'removed',
        text: '',
      },
      sink,
    )

    expect(answered?.done).toBe(false)
    expect(answered?.done === false && answered.refused).toBe('changed-or-unreadable')
    // ⛔ **The store comes back either way**, so a person sees what is actually there — `425`.
    expect(JSON.stringify(answered?.reading.stores)).toContain(THE_FALSE_NOTE.trim())
    // 🔴 **And nothing was recorded**, which is `HO-029` §3: a surface may not report an act as
    // done until the act is recorded, and there was no act.
    expect(answered?.reading.amendments).toEqual([])
    expect(host.agentMemory('brobot').amendments).toEqual([])
  })

  it('🔴 an act that LANDS whose record does not is `not-recorded` — never `write-failed`', async () => {
    // ⛔ **Found reviewing this dispatch's own diff.** The branch answered `write-failed`, whose
    // sentence is *"Nothing changed and nothing was recorded"* — and in this state the file is
    // gone. ⚠️ **Two questions about one address**: one word was carrying *the filesystem refused*
    // and *the record refused*, and only the first of those sentences is ever true of both.
    //
    // ⚑ **Produced with a store whose write refuses**, which is the state an identity row going
    // away between the existence check and the write would really cause — `put-the-hazard-on-the-path-the-code-walks`
    // applied to a race a single-threaded fixture cannot run.
    identity('brobot')
    const { note } = plantTheNight('brobot')
    const store = createSessionStore(db)
    const refusing = new RuntimeHost({
      ...(await hostDeps({ store: { ...store, settleMemoryAmendment: () => false } })),
    })
    try {
      const answered = await refusing.amendAgentMemory(
        {
          profileId: 'brobot',
          provider: 'claude',
          entry: note,
          confirmed: true,
          act: 'removed',
          text: '',
        },
        sink,
      )
      expect(answered?.done).toBe(false)
      expect(answered?.done === false && answered.refused).toBe('not-recorded')
      // 🔴 **The file really is gone**, which is what makes `write-failed`'s sentence false here
      // and this word necessary.
      expect(existsSync(note)).toBe(false)
      expect(answered?.reading.amendments[0]).toMatchObject({
        outcome: 'pending',
        textBefore: THE_FALSE_NOTE,
      })
      expect(answered?.reading.needsChecking).toBe(true)
      expect(REFUSAL_MEANS['not-recorded']).toBe(
        "BroCrew couldn't record this change. Look at the entry before trying again.",
      )
      // ⚑ **The control**: the word it is NOT still promises the thing that would be false.
      expect(REFUSAL_MEANS['write-failed']).toContain('Nothing changed')
    } finally {
      void refusing.closeAll()
    }
  })

  it('⛔ a slug with no identity row writes nothing and says so — criterion 12', async () => {
    const { note } = plantTheNight('ghost')

    const answered = await host.amendAgentMemory(
      {
        profileId: 'ghost',
        provider: 'claude',
        entry: note,
        confirmed: true,
        act: 'removed',
        text: '',
      },
      sink,
    )

    expect(answered).toBeNull()
    // 🔴 **The FILE is untouched**, which is the half a null return does not state: the existence
    // check runs before anything reaches the filesystem, so a probe for an identity cannot be
    // performed by watching a store get walked.
    expect(existsSync(note)).toBe(true)
  })
})

describe('§3 · ⚠️ a change reaches the agent from its NEXT conversation', () => {
  it('🔴 the running conversation keeps the entry; a conversation started AFTER does not have it', async () => {
    // ⛔ **`EXT-015` §2.1 and §2's fourth row**, as one measurement rather than two claims: the
    // conversation's copy *"is a record; never; it is this conversation's"*, and *"an edit made now
    // reaches the agent from its NEXT conversation"*. ⚑ Both halves need the same fixture, and a
    // test that asserted only the first could be satisfied by a change that reached nothing at all.
    identity('brobot')
    const { note } = plantTheNight('brobot')

    const first = await host.createSession({ provider: 'claude', profileId: 'brobot' }, sink)
    // ⚠️ **This is the object a window draws** — `CreatedSession.instructions`, whose own docblock
    // is *"nothing here should be refreshed in place"*.
    expect(JSON.stringify(first.instructions.agentMemory)).toContain(THE_FALSE_NOTE.trim())

    expect(
      (
        await host.amendAgentMemory(
          {
            profileId: 'brobot',
            provider: 'claude',
            entry: note,
            confirmed: true,
            act: 'removed',
            text: '',
          },
          sink,
        )
      )?.done,
    ).toBe(true)

    // 🔴 **The running conversation's record is unchanged** — the removal mutated nothing it points
    // at, which is what *never* in that table cell has to mean.
    expect(JSON.stringify(first.instructions.agentMemory)).toContain(THE_FALSE_NOTE.trim())
    // ⛔ **…and the NEXT conversation does not have it**, which is the half that makes the first
    // one a property of the copy rather than of a reader that answers nothing.
    const second = await host.createSession({ provider: 'claude', profileId: 'brobot' }, sink)
    expect(JSON.stringify(second.instructions.agentMemory)).not.toContain(THE_FALSE_NOTE.trim())
  })
})

describe('memory edits from colleagues keep selected-target and confirmation controls', () => {
  it('records the peer initiator and settler through IPC and reverses only the selected change', async () => {
    identity('brobot')
    const { note } = plantTheNight('brobot')
    const peer: RuntimeEventSink = {
      ownerId: 'agent:peer',
      aPersonIsBehindIt: false,
      alive: true,
      send() {},
      sendLiveness() {},
    }
    const asked = {
      kind: 'amendAgentMemory',
      profileId: 'brobot',
      provider: 'claude',
      entry: note,
      confirmed: true,
      act: 'removed',
      text: '',
    }
    expect(await executeRuntimeCommand(host, peer, { ...asked, confirmed: false })).toMatchObject({
      done: false,
      refused: 'confirmation-required',
    })
    expect(readFileSync(note, 'utf8')).toBe(THE_FALSE_NOTE)
    expect(host.agentMemory('brobot').amendments).toEqual([])
    const result = (await executeRuntimeCommand(host, peer, asked)) as {
      done: boolean
      amendment: { id: string }
    }
    expect(result).toMatchObject({
      done: true,
      amendment: {
        by: { who: 'an-agent', agent: 'peer' },
        settlement: { by: { who: 'an-agent', agent: 'peer' } },
      },
    })
    expect(existsSync(note)).toBe(false)
    expect(host.agentMemory('brobot').amendments[0]).toMatchObject({
      by: { who: 'an-agent', agent: 'peer' },
    })
    expect(
      await executeRuntimeCommand(host, peer, {
        kind: 'undoAgentMemory',
        profileId: 'brobot',
        sourceId: result.amendment.id,
        confirmed: true,
      }),
    ).toMatchObject({ done: true })
    expect(readFileSync(note, 'utf8')).toBe(THE_FALSE_NOTE)
    expect(
      await executeRuntimeCommand(host, peer, {
        kind: 'checkInterruptedMemory',
        profileId: 'brobot',
        confirmed: true,
      }),
    ).toMatchObject({ done: true })
    await expect(
      executeRuntimeCommand(host, peer, { ...asked, extra: 'malformed' }),
    ).rejects.toThrow()
  })

  it('records an app-initiated ordinary edit without changing startup reconciliation admission', async () => {
    identity('brobot')
    const { note } = plantTheNight('brobot')
    expect(
      await host.amendAgentMemory(
        {
          profileId: 'brobot',
          provider: 'claude',
          entry: note,
          confirmed: true,
          act: 'removed',
          text: '',
        },
        THE_APP_ITSELF,
      ),
    ).toMatchObject({ done: true, amendment: { by: { who: 'the-app-itself' } } })
    expect(existsSync(note)).toBe(false)
  })
})

describe('durable memory operations through the person window doors', () => {
  it('requires primary confirmation before recording an intent', async () => {
    identity('lark')
    const { note } = plantTheNight('lark')
    const asked = {
      profileId: 'lark',
      provider: 'claude' as const,
      entry: note,
      act: 'removed' as const,
      text: '',
      confirmed: true,
    }
    const no = await host.amendAgentMemory({ ...asked, confirmed: false }, sink)
    expect(no?.done === false && no.refused).toBe('confirmation-required')
    expect(readFileSync(note, 'utf8')).toBe(THE_FALSE_NOTE)
    expect(host.agentMemory('lark').amendments).toEqual([])
  })

  it('restores the exact saved text and reverses that restoration, through the host', async () => {
    identity('lark')
    const { note } = plantTheNight('lark')
    const removed = await host.amendAgentMemory(
      {
        profileId: 'lark',
        provider: 'claude',
        entry: note,
        act: 'removed',
        text: '',
        confirmed: true,
      },
      sink,
    )
    expect(removed?.done).toBe(true)
    if (!removed?.done) throw new Error('Expected a recorded removal')
    const asked = { profileId: 'lark', sourceId: removed.amendment.id, confirmed: true }
    const restored = await host.undoAgentMemory(asked, THE_APP_ITSELF)
    expect(restored?.done).toBe(true)
    expect(readFileSync(note, 'utf8')).toBe(THE_FALSE_NOTE)
    if (!restored?.done) throw new Error('Expected a recorded restoration')
    expect(restored.amendment).toMatchObject({
      act: 'restored',
      sourceId: removed.amendment.id,
      by: { who: 'the-app-itself' },
      settlement: { by: { who: 'the-app-itself' } },
    })
    expect(
      (await host.undoAgentMemory({ ...asked, sourceId: restored.amendment.id }, sink))?.done,
    ).toBe(true)
    expect(existsSync(note)).toBe(false)
  })

  it('uses the same unfinished-memory reason in the roster and removal, until an ordinary caller checks it', async () => {
    identity('lark')
    const { note } = plantTheNight('lark')
    const store = createSessionStore(db)
    expect(
      store.beginMemoryAmendment(
        {
          profileSlug: 'lark',
          provider: 'claude',
          entry: note,
          act: 'removed',
          by: { who: 'a-person' },
          textBefore: THE_FALSE_NOTE,
          textAfter: null,
        },
        Date.now(),
      ),
    ).not.toBeNull()
    expect(host.agentMemory('lark').needsChecking).toBe(true)
    expect(
      host.agentIdentities().use.find((one) => one.slug === 'lark')?.hasUnfinishedMemoryChange,
    ).toBe(true)
    expect(host.removeAgent('lark')).toMatchObject({
      ok: false,
      rail: 'it-is-still-held',
      held: ['unfinished-memory-change'],
    })
    expect(
      await host.checkInterruptedMemory({ profileId: 'lark', confirmed: true }, THE_APP_ITSELF),
    ).toMatchObject({ done: true })
    const reading = host.agentMemory('lark')
    expect(reading.needsChecking).toBeUndefined()
    expect(reading.amendments[0]).toMatchObject({
      outcome: 'unchanged',
      by: { who: 'a-person' },
      settlement: { by: { who: 'the-app-itself' } },
    })
    expect(host.removeAgent('lark')).toEqual({ ok: true, slug: 'lark' })
  })

  it('rechecks a memory intent that appears at the transactional removal guard', async () => {
    identity('lark')
    const { note } = plantTheNight('lark')
    const store = createSessionStore(db)
    const racing = new RuntimeHost(
      await hostDeps({
        store: {
          ...store,
          removeAgentIdentity: (slug) => {
            store.beginMemoryAmendment(
              {
                profileSlug: slug,
                provider: 'claude',
                entry: note,
                act: 'removed',
                by: { who: 'a-person' },
                textBefore: THE_FALSE_NOTE,
                textAfter: null,
              },
              Date.now(),
            )
            return store.removeAgentIdentity(slug)
          },
        },
      }),
    )
    try {
      expect(racing.removeAgent('lark')).toMatchObject({
        ok: false,
        rail: 'it-is-still-held',
        held: ['unfinished-memory-change'],
      })
      expect(racing.agentIdentities().identities.some((one) => one.slug === 'lark')).toBe(true)
      expect(readFileSync(note, 'utf8')).toBe(THE_FALSE_NOTE)
    } finally {
      await racing.closeAll()
    }
  })

  it('makes no late reading after a bounded quit while an intent is in flight', async () => {
    identity('lark')
    const { note } = plantTheNight('lark')
    let release!: () => void
    let entered!: () => void
    const paused = new Promise<void>((yes) => {
      release = yes
    })
    const waiting = new Promise<void>((yes) => {
      entered = yes
    })
    const store = createSessionStore(db)
    const reads = vi.fn(store.memoryAmendmentsOf)
    const quitting = new RuntimeHost(
      await hostDeps({
        store: { ...store, memoryAmendmentsOf: reads },
        closeWaitMs: 0,
        beforeEffect: async () => {
          entered()
          await paused
        },
      }),
    )
    try {
      const change = quitting.amendAgentMemory(
        {
          profileId: 'lark',
          provider: 'claude',
          entry: note,
          act: 'removed',
          text: '',
          confirmed: true,
        },
        sink,
      )
      await waiting
      expect(
        quitting.agentIdentities().use.find((one) => one.slug === 'lark')?.isChangingMemory,
      ).toBe(true)
      await quitting.closeAll()
      const before = reads.mock.calls.length
      release()
      expect(await change).toBeNull()
      expect(reads.mock.calls.length).toBe(before)
      expect(readFileSync(note, 'utf8')).toBe(THE_FALSE_NOTE)
      expect(store.hasPendingMemoryAmendment('lark')).toBe(true)
    } finally {
      release()
      await quitting.closeAll()
    }
  })
})

describe('memory shutdown and missing-service boundaries', () => {
  it('waits for memory to close even when a session close rejects', async () => {
    identity('lark')
    let release!: () => void
    const gate = new Promise<void>((yes) => {
      release = yes
    })
    const gated = new RuntimeHost(await hostDeps({ closeWaitMs: 0, closeGate: gate }))
    const failure = new Error('Fictional session close failure')
    let sessionId: string | undefined
    let closing: Promise<void> | undefined
    let restoreClose = (): void => {}
    try {
      sessionId = (await gated.createSession({ provider: 'claude', profileId: 'lark' }, sink))
        .sessionId
      const close = vi.spyOn(gated, 'close').mockRejectedValueOnce(failure)
      restoreClose = () => {
        close.mockRestore()
      }
      closing = gated.closeAll()
      let settled = false
      void closing.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        },
      )
      await new Promise<void>((yes) => setImmediate(yes))
      expect(settled).toBe(false)
      release()
      await expect(closing).rejects.toMatchObject({
        name: 'AggregateError',
        message: 'Runtime shutdown did not finish',
        errors: [failure],
      })
      expect(gated.closeAll()).toBe(closing)
    } finally {
      release()
      restoreClose()
      try {
        if (closing === undefined) await gated.closeAll()
        else {
          expect(gated.closeAll()).toBe(closing)
          await expect(closing).rejects.toMatchObject({
            name: 'AggregateError',
            message: 'Runtime shutdown did not finish',
            errors: [failure],
          })
        }
      } finally {
        if (closing !== undefined && sessionId !== undefined)
          await gated.close(sessionId, THE_APP_ITSELF)
      }
    }
  })
  it('does not attempt a change when no durable service was bound', async () => {
    identity('lark')
    const { note } = plantTheNight('lark')
    const deps = await hostDeps()
    const unbound = new RuntimeHost({ ...deps, memoryKnowledge: undefined })
    try {
      expect(
        await unbound.amendAgentMemory(
          {
            profileId: 'lark',
            provider: 'claude',
            entry: note,
            act: 'removed',
            text: '',
            confirmed: true,
          },
          sink,
        ),
      ).toBeNull()
      expect(readFileSync(note, 'utf8')).toBe(THE_FALSE_NOTE)
      expect(host.agentMemory('lark').amendments).toEqual([])
    } finally {
      await unbound.closeAll()
      await deps.memoryKnowledge?.close(0)
    }
  })
})
