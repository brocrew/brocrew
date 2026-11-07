import type { MemoryNoteEvent, TranscriptEvent } from '../src/shared/conversation-events'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { codexAdHocNotesDir, FakeRuntime, type FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, NULL_SESSION_STORE } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import {
  MEMORY_NOTES_PER_EVENT,
  MEMORY_NOTE_TEXT_CAP,
  type RuntimeEventMessage,
} from '../src/shared/runtime-ipc'
import { neutralHostDeps, prepareUnprofiledHome } from './lib/host-fixture'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')
const rendererSource = (path: string): string =>
  readFileSync(join(here, '../src/renderer/src', path), 'utf8')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId = 'owner:1') {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
  events(): TranscriptEvent[] {
    return this.messages.map((message) => message.event)
  }
  notes(): MemoryNoteEvent[] {
    return this.events().filter((event): event is MemoryNoteEvent => event.type === 'memory_note')
  }

  outOfOrderArrival(): { session: string; after: number; then: number } | null {
    const highest = new Map<string, number>()
    for (const message of this.messages) {
      const previous = highest.get(message.sessionId)
      if (previous !== undefined && message.ordinal < previous) {
        return { session: message.sessionId, after: previous, then: message.ordinal }
      }
      highest.set(message.sessionId, message.ordinal)
    }
    return null
  }
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('318 · the host says what appeared while the turn ran', () => {
  let userData: string
  let host: RuntimeHost
  let sink: RecordingSink
  let recorded: { ordinal: number; event: TranscriptEvent }[]
  let breakRecordingOn: ((event: TranscriptEvent) => boolean) | null
  let fakes: Map<string, FakeSessionHandle>

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-memory-host-'))
    recorded = []
    breakRecordingOn = null
    fakes = new Map()
    let counter = 0
    let pending: FakeSessionHandle | null = null
    host = new RuntimeHost({
      store: {
        ...NULL_SESSION_STORE,
        create: (row: Parameters<typeof NULL_SESSION_STORE.create>[0]) => {
          if (pending !== null) fakes.set(row.id, pending)
          pending = null
          return NULL_SESSION_STORE.create(row)
        },
        append: (_sessionId: string, ordinal: number, event: TranscriptEvent) => {
          if (breakRecordingOn?.(event)) throw new Error('the disk went away')
          recorded.push({ ordinal, event })
        },
      },
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => {
        const runtime = new FakeRuntime(provider)
        const start = runtime.start.bind(runtime)
        runtime.start = async (...args: Parameters<typeof start>) => {
          const handle = (await start(...args)) as FakeSessionHandle
          pending = handle
          return handle
        }
        return runtime
      },
      prepareProviderHome: (provider) => prepareUnprofiledHome(userData, provider),
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
        model: `${provider} config model`,
        authNote: null,
        files: [],
      }),
    })
    sink = new RecordingSink()
  })

  afterEach(async () => {
    try {
      await host.closeAll()
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
    expect(sink.outOfOrderArrival(), 'a message arrived before the one it follows').toBeNull()
  })

  const notesDir = (): string => codexAdHocNotesDir(join(userData, 'provider-homes', 'codex'))

  function writeNote(name: string, text: string): string {
    const dir = notesDir()
    mkdirSync(dir, { recursive: true })
    const path = join(dir, name)
    writeFileSync(path, text)
    return path
  }

  const appended = (): TranscriptEvent[] => recorded.map((row) => row.event)

  const fakeFor = (sessionId: string): FakeSessionHandle => {
    const found = fakes.get(sessionId)
    expect(found, 'no fake handle was captured for ' + sessionId).toBeDefined()
    return found!
  }

  const countOf = (type: string): number =>
    sink.events().filter((event) => event.type === type).length
  const idleCount = (): number =>
    sink.events().filter((event) => event.type === 'status' && event.state === 'idle').length

  async function turnWith(sessionId: string, during: () => void): Promise<void> {
    const cardsBefore = countOf('permission_request')
    const idleBefore = idleCount()
    await host.send(sessionId, 'remember my name', sink)
    await waitFor(
      () => countOf('permission_request') > cardsBefore,
      'the turn to reach its permission card',
    )
    during()
    const card = sink
      .events()
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    await host.respondPermission(sessionId, (card as { id: string }).id, { outcome: 'allow' }, sink)
    await waitFor(() => idleCount() > idleBefore, 'the turn to go idle')
  }

  it('publishes the note that appeared, once, at the end of the turn it appeared in', async () => {
    const created = await host.createSession({ provider: 'codex' }, sink)
    await turnWith(created.sessionId, () => {
      writeNote('2026-09-04T00-00-00-user-name.md', "The user's name is Bob.")
    })

    await waitFor(() => sink.notes().length > 0, 'the memory note to be published')
    const notes = sink.notes()
    expect(notes).toHaveLength(1)
    expect(notes[0]!.notes[0]!.text).toBe("The user's name is Bob.")

    const types = sink.events().map((event) => event.type)
    expect(types.indexOf('memory_note')).toBeGreaterThan(types.indexOf('assistant_message'))
  })

  it('says it once and not again on the turns that follow', async () => {
    const created = await host.createSession({ provider: 'codex' }, sink)
    await turnWith(created.sessionId, () => {
      writeNote('2026-09-04T00-00-00-user-name.md', "The user's name is Bob.")
    })
    await waitFor(() => sink.notes().length > 0, 'the first note')

    await turnWith(created.sessionId, () => {})
    expect(sink.notes()).toHaveLength(1)

    await turnWith(created.sessionId, () => {
      writeNote('2026-09-04T00-01-00-user-full-name.md', "The user's full name is Bob Alicio.")
    })
    await waitFor(() => sink.notes().length > 1, 'the second note')
    const second = sink.notes()[1]!
    expect(second.notes).toHaveLength(1)
    expect(second.notes[0]!.text).toContain('Bob Alicio')
  })

  it('writes the row even when no window is listening', async () => {
    const created = await host.createSession({ provider: 'codex' }, sink)
    await host.send(created.sessionId, 'remember my name', sink)
    await waitFor(() => countOf('permission_request') > 0, 'the turn to reach its permission card')
    writeNote('2026-09-04T00-00-00-user-name.md', "The user's name is Bob.")
    const card = sink
      .events()
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    sink.alive = false
    await host.respondPermission(
      created.sessionId,
      (card as { id: string }).id,
      { outcome: 'allow' },
      sink,
    )
    await waitFor(
      () => appended().some((event) => event.type === 'status' && event.state === 'idle'),
      'the turn to go idle',
    )
    await waitFor(
      () => appended().some((event) => event.type === 'memory_note'),
      'the note to reach the ledger with no window attached',
    )
    expect(sink.notes(), 'a dead sink still received events').toHaveLength(0)
    const rows = appended().filter(
      (event): event is MemoryNoteEvent => event.type === 'memory_note',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.notes[0]!.text).toBe("The user's name is Bob.")
  })

  it('says what appeared even when the turn ends in an error', async () => {
    const created = await host.createSession({ provider: 'codex' }, sink)
    await host.send(created.sessionId, 'remember my name', sink)
    await waitFor(() => countOf('permission_request') > 0, 'the turn to reach its permission card')
    writeNote('2026-09-04T00-00-00-user-name.md', "The user's name is Bob.")
    fakeFor(created.sessionId).simulateError('the app-server went away', true)
    await waitFor(
      () => sink.events().some((e) => e.type === 'status' && e.state === 'errored'),
      'the turn to end in an error',
    )
    await waitFor(() => sink.notes().length > 0, 'the memory note on the error path')
    expect(sink.notes()[0]!.notes[0]!.text).toBe("The user's name is Bob.")
  })

  it('claims nothing for an ending that no turn of ours opened', async () => {
    const created = await host.createSession({ provider: 'codex' }, sink)
    writeNote('2026-09-04T00-00-00-someone-else.md', 'written by another session')
    fakeFor(created.sessionId).simulateError('nothing to do with a turn', true)
    await waitFor(
      () => sink.events().some((e) => e.type === 'status' && e.state === 'errored'),
      'the session to end',
    )
    expect(sink.notes(), 'a row claimed a turn that never ran').toHaveLength(0)
  })

  it('does not claim a note that appeared while no turn of this conversation was running', async () => {
    const created = await host.createSession({ provider: 'codex' }, sink)
    await turnWith(created.sessionId, () => {})
    writeNote('2026-09-04T00-00-00-someone-else.md', 'written by another session')
    await turnWith(created.sessionId, () => {})
    expect(sink.notes(), 'a note from between turns was claimed by this one').toHaveLength(0)

    await turnWith(created.sessionId, () => {
      writeNote('2026-09-04T00-01-00-this-turn.md', 'written during the turn')
    })
    await waitFor(() => sink.notes().length > 0, 'the in-turn note')
    expect(sink.notes()[0]!.notes.map((each) => each.path)).toEqual([
      join(notesDir(), '2026-09-04T00-01-00-this-turn.md'),
    ])
  })

  it('announces a note again after it has been deleted and rewritten', async () => {
    const created = await host.createSession({ provider: 'codex' }, sink)
    const name = '2026-09-04T00-00-00-user-name.md'
    await turnWith(created.sessionId, () => {
      writeNote(name, "The user's name is Bob.")
    })
    await waitFor(() => sink.notes().length > 0, 'the first note')

    await turnWith(created.sessionId, () => {
      rmSync(join(notesDir(), name))
    })
    expect(sink.notes()).toHaveLength(1)

    await turnWith(created.sessionId, () => {
      writeNote(name, "The user's name is Bob, again.")
    })
    await waitFor(() => sink.notes().length > 1, 'the rewritten note')
    expect(sink.notes()[1]!.notes[0]!.text).toContain('again')
  })

  it('falls back to the seed when the store cannot be listed at the start of a turn', async () => {
    writeNote('2026-01-01T00-00-00-old.md', 'written long before this conversation')
    const created = await host.createSession({ provider: 'codex' }, sink)

    const dir = notesDir()
    chmodSync(dir, 0o000)
    const cardsBefore = countOf('permission_request')
    const idleBefore = idleCount()
    await host.send(created.sessionId, 'remember my name', sink)
    await waitFor(() => countOf('permission_request') > cardsBefore, 'the card')
    chmodSync(dir, 0o700)
    writeNote('2026-09-04T00-00-00-new.md', 'written just now')
    const card = sink
      .events()
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    await host.respondPermission(
      created.sessionId,
      (card as { id: string }).id,
      { outcome: 'allow' },
      sink,
    )
    await waitFor(() => idleCount() > idleBefore, 'the turn to go idle')
    await waitFor(() => sink.notes().length > 0, 'the new note')

    const announced = sink.notes()[0]!.notes.map((each) => each.path)
    expect(announced, 'the pre-existing store was announced as this turn’s news').toEqual([
      join(dir, '2026-09-04T00-00-00-new.md'),
    ])
  })

  it('never announces what was already in the store when the session opened', async () => {
    writeNote('2026-01-01T00-00-00-old.md', 'written long ago')
    const created = await host.createSession({ provider: 'codex' }, sink)
    await turnWith(created.sessionId, () => {})
    expect(sink.notes()).toHaveLength(0)
    await turnWith(created.sessionId, () => {
      writeNote('2026-09-04T00-00-00-new.md', 'written just now')
    })
    await waitFor(() => sink.notes().length > 0, 'the new note')
    expect(sink.notes()[0]!.notes.map((each) => each.path)).toEqual([
      join(notesDir(), '2026-09-04T00-00-00-new.md'),
    ])
  })

  it('watches nothing for a provider whose writes are already reported', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    const claudeNotes = codexAdHocNotesDir(join(userData, 'provider-homes', 'claude'))
    await turnWith(created.sessionId, () => {
      mkdirSync(claudeNotes, { recursive: true })
      writeFileSync(join(claudeNotes, '2026-09-04T00-00-00-x.md'), 'nope')
    })
    expect(sink.notes()).toHaveLength(0)
    const codex = await host.createSession({ provider: 'codex' }, sink)
    await turnWith(codex.sessionId, () => {
      writeNote('2026-09-04T00-00-00-x.md', 'yes')
    })
    await waitFor(() => sink.notes().length > 0, 'the codex note')
    expect(sink.notes()).toHaveLength(1)
  })

  describe('320 · and it arrives after the turn, not before it', () => {
    it('sends the note behind the status that produced it, one ordinal later', async () => {
      const created = await host.createSession({ provider: 'codex' }, sink)
      await turnWith(created.sessionId, () => {
        writeNote('2026-09-04T00-00-00-user-name.md', "The user's name is Bob.")
      })
      await waitFor(() => sink.notes().length > 0, 'the memory note to be published')

      const index = sink.messages.findIndex((message) => message.event.type === 'memory_note')
      const note = sink.messages[index]!
      const before = sink.messages[index - 1]!
      expect(before.event.type).toBe('status')
      expect(before.event).toMatchObject({ state: 'idle' })
      expect(note.ordinal).toBe(before.ordinal + 1)
    })

    it('reports a broken ledger after the app-authored row it was recording, not before it', async () => {
      const created = await host.createSession({ provider: 'codex' }, sink)
      const cardsBefore = countOf('permission_request')
      await host.send(created.sessionId, 'remember my name', sink)
      await waitFor(
        () => countOf('permission_request') > cardsBefore,
        'the turn to reach its permission card',
      )
      breakRecordingOn = (event) => event.type === 'user_decision'
      const card = sink
        .events()
        .filter((event) => event.type === 'permission_request')
        .at(-1)
      await host.respondPermission(
        created.sessionId,
        (card as { id: string }).id,
        { outcome: 'allow' },
        sink,
      )
      await waitFor(
        () => sink.events().some((event) => event.type === 'error'),
        'the recording-failure notice',
      )

      expect(sink.outOfOrderArrival()).toBeNull()
      const kinds = sink.events().map((event) => event.type)
      expect(kinds).toContain('user_decision')
      expect(kinds.indexOf('error')).toBeGreaterThan(kinds.indexOf('user_decision'))
    })

    it('reports a broken ledger AFTER the events it was recording, not between them', async () => {
      const created = await host.createSession({ provider: 'codex' }, sink)
      const cardsBefore = countOf('permission_request')
      await host.send(created.sessionId, 'remember my name', sink)
      await waitFor(
        () => countOf('permission_request') > cardsBefore,
        'the turn to reach its permission card',
      )
      writeNote('2026-09-04T00-00-00-user-name.md', "The user's name is Bob.")
      breakRecordingOn = (event) => event.type === 'status' && event.state === 'idle'
      const card = sink
        .events()
        .filter((event) => event.type === 'permission_request')
        .at(-1)
      await host.respondPermission(
        created.sessionId,
        (card as { id: string }).id,
        { outcome: 'allow' },
        sink,
      )
      await waitFor(
        () => sink.events().some((event) => event.type === 'error'),
        'the recording-failure notice',
      )

      expect(sink.outOfOrderArrival()).toBeNull()
      const tail = sink.messages.slice(-3)
      expect(tail.map((message) => message.event.type)).toEqual(['status', 'memory_note', 'error'])
      expect(tail.map((message) => message.ordinal)).toEqual([
        tail[0]!.ordinal,
        tail[0]!.ordinal + 1,
        tail[0]!.ordinal + 2,
      ])
      expect(tail[2]!.event).toMatchObject({
        message: expect.stringContaining('no longer being recorded'),
      })
    })
  })
})

describe('318 · a memory note is bounded on the way back out of the ledger', () => {
  it('keeps the row, cuts what is oversized, and lets no undeclared key ride along', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-memory-replay-')))
    const db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrationsDir)
    const store = createSessionStore(db)
    store.create({ id: 'sess_m', provider: 'codex', cwd: dir, approvalMode: 'ask', profileId: 'd' })

    const malformed = [
      { path: 'x'.repeat(9000), bytes: 1, text: 'too long a path' },
      { path: 42, bytes: 1, text: 'not a path at all' },
      { path: '', bytes: 1, text: 'no path' },
    ]
    const valid = Array.from({ length: MEMORY_NOTES_PER_EVENT + 20 }, (_, index) => ({
      path: `/homes/codex/memories/extensions/ad_hoc/notes/n${index}.md`,
      bytes: 3,
      text: 'ok',
    }))
    store.append('sess_m', 0, { type: 'memory_note', notes: [...malformed, ...valid] } as never, 1)
    store.append(
      'sess_m',
      1,
      {
        type: 'memory_note',
        notes: [
          {
            path: '/homes/codex/memories/extensions/ad_hoc/notes/big.md',
            bytes: -5,
            text: 'y'.repeat(MEMORY_NOTE_TEXT_CAP + 4000),
            blob: 'z'.repeat(5000),
          },
        ],
      } as never,
      2,
    )

    const replayed = store.events('sess_m').map(({ event }) => event as MemoryNoteEvent)
    expect(replayed[0]!.notes).toHaveLength(MEMORY_NOTES_PER_EVENT)
    expect(replayed[0]!.notes.map((each) => each.path)).toEqual(
      valid.slice(0, MEMORY_NOTES_PER_EVENT).map((each) => each.path),
    )

    const big = replayed[1]!.notes[0]!
    expect(big.text!.length).toBe(MEMORY_NOTE_TEXT_CAP)
    expect(big.truncated).toBe(true)
    expect(big.bytes).toBeUndefined()
    expect(Object.keys(big).sort()).toEqual(['path', 'text', 'truncated'])
    expect(replayed[0]!.dropped, 'the replay cap went silent').toBe(
      malformed.length + valid.length - MEMORY_NOTES_PER_EVENT,
    )

    store.append(
      'sess_m',
      2,
      {
        type: 'memory_note',
        notes: [
          { path: '/homes/codex/memories/extensions/ad_hoc/notes/ok.md', bytes: 3, text: 'hi' },
        ],
      } as never,
      3,
    )
    expect((store.events('sess_m')[2]!.event as MemoryNoteEvent).notes).toEqual([
      { path: '/homes/codex/memories/extensions/ad_hoc/notes/ok.md', bytes: 3, text: 'hi' },
    ])
    db.close()
  })
})

describe('318 §2.3 · the gesture SETS the drawer and the tab hint names memory', () => {
  it('the show-instructions handler opens the drawer rather than flipping it', () => {
    const screen = rendererSource('components/RuntimeScreen.vue')
    const at = screen.indexOf('@show-instructions=')
    expect(at, 'RuntimeScreen no longer handles the request').toBeGreaterThan(-1)
    const body = screen.slice(at, screen.indexOf('"', screen.indexOf('"', at) + 1) + 1)
    expect(body).toContain('drawerOpen = true')
    expect(body).toContain("drawerTab = 'info'")
    expect(body).not.toContain('!drawerOpen')
    expect(body.startsWith('@show-instructions="')).toBe(true)
    expect(body.endsWith('"')).toBe(true)
    expect(body.length).toBeLessThan(screen.length / 10)
  })

  it('the Info tab says it holds what the profile remembers', () => {
    const drawer = rendererSource('lib/drawer.ts')
    const info = drawer.slice(drawer.indexOf("id: 'info'"), drawer.indexOf("id: 'changes'"))
    expect(info).toContain('remembers')
    expect(info).toContain('hint:')
    expect(info).toContain('Paths, the profile')
  })
})
