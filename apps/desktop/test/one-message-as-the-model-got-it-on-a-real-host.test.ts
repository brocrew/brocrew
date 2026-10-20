import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, type FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { classifyHandedPath } from '../src/main/runtime/handed-path'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { toolsToldInTextFor } from '../src/main/runtime/agent-tools'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { profileBundleSpans, thisConversationSpans } from '../src/main/runtime/factory-text'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import {
  brobotWorkspace,
  CLAUDE_INSTRUCTIONS_FILE,
  ensureWorkspace,
  workspaceOwnFilesIn,
} from '../src/main/runtime/workspace'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import type {
  HandedPath,
  RuntimeEventMessage,
  TranscriptEvent,
  UserTurnEvent,
} from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate } from './lib/provider-double'

/**
 * # 🔴 F093 · C9 d — one message as the model got it, on a real host
 *
 * ⚑ **A real host over a real ledger**, the provider a double that echoes what it was handed
 * (`what-a-turn-of-several-held-messages-says-and-keeps.test.ts`' harness), and `main/index.ts`'s
 * instruction wiring, so a launch keeps its record. What the devs' own C9 d cases do not reach:
 *
 *  - §1 · a turn of several held messages: its words one per message, and the text handed over is
 *    exactly what the provider got (its echo); a turn mixing the app's words with a person's is no
 *    one sender's.
 *  - §2 · a message with a file: the words are the person's, the text handed over names the file.
 *  - §3 · ⛔ a message never sent (held, then cancelled): no place in the record answers with it.
 *  - §4 · ⛔ the launch record not taken: a conversation brought in from elsewhere, and a record this
 *    app cannot read — each paired with the same conversation read before.
 *  - §5 · a message row that will not parse is passed over for the one before it, never read as none.
 *
 * ⛔ No real provider home is read: every folder is a temporary one made here.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** ⚑ A real macrotask pause, so a negative is measured after whatever was queued has run. */
const letItSettle = async (ticks = 20): Promise<void> => {
  for (let i = 0; i < ticks; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
}

describe('F093 · C9 d · one message as the model got it, on a real host', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let window: RecordingSink
  let hosts: RuntimeHost[]
  let counter: number

  const buildHost = (): RuntimeHost => {
    const handles: FakeSessionHandle[] = []
    const issued = new FakeProviderSessions()
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new ProviderDouble(provider, handles, issued, anOpenGate()),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider, profileId: string) =>
        join(userData, 'provider-homes', profileId, provider),
      providerHomesRoot: () => join(userData, 'provider-homes'),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++counter)}`,
      commandListWaitMs: 200,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      whichBuild: () => ({ id: 'abc1234', commit: 'abc1234def', dirty: false, schema: 7 }),
      // ⚑ `main/index.ts`'s own wiring, copied: compile, publish, read — so a launch keeps a record.
      readInstructions: (provider, cwd, providerHome, context) => {
        const composed = profileBundleSpans(context)
        const bundle = publishProfileBundle(provider, providerHome, composed.text)
        const read = readSessionInstructions({
          provider,
          cwd,
          providerHome,
          bundle,
          bundleComposed: composed,
          thisConversation: thisConversationSpans(context, toolsToldInTextFor(provider)),
          workspaceFile: join(brobotWorkspace(userData), CLAUDE_INSTRUCTIONS_FILE),
          workspaceOwnFiles: workspaceOwnFilesIn(userData),
          home: userData,
        })
        return {
          instructions: read.instructions,
          systemHint: read.systemHint ?? undefined,
          ...(read.firstTurnLead === null ? {} : { firstTurnLead: read.firstTurnLead }),
          memoryLoaded: read.memoryLoaded,
          profileFile: read.profileFile,
        }
      },
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-c9d-'))
    root = join(userData, 'project')
    mkdirSync(root, { recursive: true })
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    ensureWorkspace(userData)
    hosts = []
    counter = 0
    window = new RecordingSink(sinkOwnerId({ id: 1 }))
    host = buildHost()
  })

  afterEach(async () => {
    for (const built of [...hosts].reverse()) await built.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  // ── what the ledger holds ──

  const ledger = (sessionId: string) => store.events(sessionId)
  const turns = (sessionId: string): { ordinal: number; event: UserTurnEvent }[] =>
    ledger(sessionId).flatMap((entry) =>
      entry.event.type === 'user_turn' ? [{ ordinal: entry.ordinal, event: entry.event }] : [],
    )
  const ofType = (sessionId: string, type: TranscriptEvent['type']): number[] =>
    ledger(sessionId)
      .filter((entry) => entry.event.type === type)
      .map((entry) => entry.ordinal)
  /** ⚑ What the provider was handed, as the double echoes it. */
  const echoes = (sessionId: string): string[] =>
    ledger(sessionId)
      .map((entry) => entry.event)
      .flatMap((event) =>
        event.type === 'assistant_message' && event.text.startsWith('echo: ')
          ? [event.text.slice('echo: '.length)]
          : [],
      )
  const cards = (sessionId: string): string[] =>
    ledger(sessionId)
      .map((entry) => entry.event)
      .flatMap((event) => (event.type === 'permission_request' ? [event.id] : []))

  // ── what a person does ──

  /** ⚑ A conversation whose first turn is parked on its card: something running to wait behind. */
  const busySession = async (provider: Provider = 'claude'): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider, profileId: 'lead', approvalMode: 'ask', cwd: root },
      window,
    )
    await host.send(sessionId, 'the first thing', window)
    await waitFor(() => cards(sessionId).length === 1, 'the first turn to park on its card')
    return sessionId
  }

  const hold = async (
    sessionId: string,
    text: string,
    files: readonly HandedPath[] = [],
  ): Promise<string> => {
    const outcome = await host.queueMessage(sessionId, text, window, files)
    if (outcome.outcome !== 'queued') throw new Error(`"${text}" was not held: ${outcome.outcome}`)
    return outcome.messageId
  }

  const answerTheCard = async (sessionId: string): Promise<void> => {
    const card = cards(sessionId).at(-1)
    if (card === undefined) throw new Error(`${sessionId} is not parked on a card`)
    await host.respondPermission(sessionId, card, { outcome: 'allow' }, window)
  }

  const anAttachment = async (name: string): Promise<HandedPath> => {
    const path = join(root, name)
    writeFileSync(path, 'notes\n')
    const chosen = await classifyHandedPath(path, root)
    if (!('handed' in chosen)) throw new Error(chosen.refusal)
    return chosen.handed
  }

  describe('§1 · a turn of several held messages', () => {
    it('🔴 its words one per message, oldest first; the text handed over is exactly what the provider got', async () => {
      const id = await busySession()
      await hold(id, 'p1')
      await hold(id, 'p2')
      await answerTheCard(id)
      await waitFor(() => turns(id).length === 2 && echoes(id).length === 2, 'the turn of two')

      const together = turns(id)[1]
      if (together === undefined) throw new Error('no turn of two')
      // ⚑ Premise: ONE turn carried both, as its parts.
      expect(together.event.parts?.map((one) => one.text)).toEqual(['p1', 'p2'])

      const got = await host.whatTheModelGot(id, together.ordinal)
      expect(got.ordinal).toBe(together.ordinal)
      expect(got.words).toEqual(['p1', 'p2'])
      expect(got.firstOfItsLaunch).toBe(false)
      const message = got.parts.at(-1)
      expect(message).toMatchObject({ kind: 'the-message', origin: 'a-person', why: null })
      // ⛔ Exactly what the provider was handed: every heading, every sender line, both messages.
      expect(message?.text).toBe(together.event.sent)
      expect(message?.text).toBe(echoes(id)[1])
      expect(message?.text).toContain('Message 2 of 2.')

      // ⚑ The control: the first turn, a message of one, answers with its own words only.
      const [alone] = turns(id)
      if (alone === undefined) throw new Error('no first turn')
      expect((await host.whatTheModelGot(id, alone.ordinal)).words).toEqual(['the first thing'])
    })

    it('⛔ the app’s own words held beside a person’s: the turn is no one sender’s', async () => {
      const id = await busySession()
      await hold(id, 'p1')
      const notice = await host.queueMessage(id, 'the app says X', THE_APP_ITSELF, [], 'notice')
      expect(notice.outcome).toBe('queued')
      await answerTheCard(id)
      await waitFor(() => turns(id).length === 2, 'the turn of two')
      const together = turns(id)[1]
      if (together === undefined) throw new Error('no turn of two')

      const got = await host.whatTheModelGot(id, together.ordinal)
      expect(got.words).toEqual(['p1', 'the app says X'])
      expect(got.parts.at(-1)).toMatchObject({ kind: 'the-message', origin: 'unknown' })
      expect(got.parts.at(-1)?.text).toContain('written by this app')
    })
  })

  describe('§2 · a message with a file', () => {
    it('🔴 the words are the person’s alone; the text handed over names the file, as the provider got it', async () => {
      const id = await busySession()
      const file = await anAttachment('notes.md')
      await hold(id, 'look at this', [file])
      await answerTheCard(id)
      await waitFor(() => turns(id).length === 2 && echoes(id).length === 2, 'the turn with a file')
      const withFile = turns(id)[1]
      if (withFile === undefined) throw new Error('no turn with a file')
      // ⚑ Premise: the file is on the turn's own row, apart from the words.
      expect(withFile.event.attachments?.map((one) => one.path)).toEqual([file.path])

      const got = await host.whatTheModelGot(id, withFile.ordinal)
      expect(got.words).toEqual(['look at this'])
      expect(got.words.join('\n')).not.toContain(file.path)
      const message = got.parts.at(-1)
      expect(message?.text).toContain(JSON.stringify(file.path))
      expect(message?.text).toBe(echoes(id)[1])
    })
  })

  describe('§3 · ⛔ a message never sent', () => {
    it('⛔ held, then cancelled: its own rows answer for the message before it, and no answer holds its words', async () => {
      const id = await busySession()
      const never = await hold(id, 'these words never went')
      await host.cancelQueuedMessage(id, never, window)
      await answerTheCard(id)
      await letItSettle()

      // ⚑ Presence first: the record says it was taken back, and no turn carried it.
      const cancelled = ledger(id).filter(
        (entry) => entry.event.type === 'message_unqueued' && entry.event.reason === 'cancelled',
      )
      expect(cancelled).toHaveLength(1)
      expect(turns(id)).toHaveLength(1)
      const [first] = turns(id)
      if (first === undefined) throw new Error('no first turn')

      const newest = ledger(id).at(-1)?.ordinal
      if (newest === undefined) throw new Error('an empty ledger')
      const places = [
        ...ofType(id, 'message_queued'),
        ...cancelled.map((entry) => entry.ordinal),
        newest,
      ]
      expect(places.length).toBeGreaterThan(1)
      for (const at of places) {
        const got = await host.whatTheModelGot(id, at)
        expect(got.ordinal, String(at)).toBe(first.ordinal)
        expect(got.words, String(at)).toEqual(['the first thing'])
        for (const part of got.parts) {
          expect(part.text ?? '', `${String(at)} ${part.kind}`).not.toContain(
            'these words never went',
          )
        }
      }

      // ⚑ The control: words that DID go are in the next message's answer.
      await host.send(id, 'these words went', window)
      await waitFor(() => turns(id).length === 2, 'the next turn')
      const next = turns(id)[1]
      if (next === undefined) throw new Error('no next turn')
      expect((await host.whatTheModelGot(id, next.ordinal)).words).toEqual(['these words went'])
    })
  })

  describe('§4 · ⛔ a launch record not taken', () => {
    /** ⚑ A Claude conversation whose launch kept its record, one message handed over, then closed. */
    const aClosedConversation = async (): Promise<{ id: string; at: number }> => {
      const { sessionId } = await host.createSession(
        { provider: 'claude', profileId: 'lead', approvalMode: 'auto', cwd: root },
        window,
      )
      await host.send(sessionId, 'please plan the next release', window)
      await waitFor(() => turns(sessionId).length === 1, 'the turn')
      await host.close(sessionId, window)
      const at = turns(sessionId)[0]?.ordinal
      if (at === undefined) throw new Error('no turn')
      return { id: sessionId, at }
    }

    it('⛔ a conversation brought in from elsewhere: described by its message alone, and said why', async () => {
      const { id, at } = await aClosedConversation()
      // ⚑ The control, read first: this app made the launch, and its record is taken.
      const before = await host.whatTheModelGot(id, at)
      expect(before.launch?.recorded).toBe(true)
      expect(before.parts[0]).toMatchObject({ kind: 'profile-instructions', why: null })
      expect(before.parts[0]?.text).toContain('## How you work')

      // ⚑ The same row, as a bundle restored it.
      db.prepare('UPDATE provider_session SET restored_at = ? WHERE id = ?').run(1, id)
      expect(store.recordedOne(id)?.restoredFromBundle).toBe(true)

      const after = await host.whatTheModelGot(id, at)
      const IMPORTED =
        'This conversation was brought in from elsewhere, and this app describes only the launches it made itself.'
      expect(after.launch?.recorded).toBe(false)
      expect(after.parts.map((one) => one.kind)).toEqual([
        'profile-instructions',
        'this-conversation',
        'the-message',
      ])
      expect(after.parts.slice(0, 2)).toMatchObject([
        { text: null, why: IMPORTED },
        { text: null, why: IMPORTED },
      ])
      // ⚑ …and the message itself, as it was handed over, is still there.
      expect(after.parts.at(-1)?.text).toBe(turns(id)[0]?.event.sent)
      expect(after.parts.map((one) => one.text ?? '').join('')).not.toContain('## How you work')
    })

    it('⛔ a launch record this app cannot read: said so — never read as no record', async () => {
      const { id, at } = await aClosedConversation()
      expect((await host.whatTheModelGot(id, at)).launch?.recorded).toBe(true)

      db.prepare(
        `UPDATE events SET payload = json_set(payload, '$.given', json('{"placement":"nowhere"}'))
          WHERE session_id = ? AND type = 'launched'`,
      ).run(id)
      // ⚑ Premise: the row still parses, and still holds a record — one of no known shape.
      const launched = store.newestOfType?.(id, 'launched')
      expect(launched?.event.type).toBe('launched')

      const got = await host.whatTheModelGot(id, at)
      expect(got.launch?.recorded).toBe(false)
      expect(got.parts[0]).toMatchObject({
        kind: 'profile-instructions',
        text: null,
        why: 'This message’s launch kept a record this app could not read.',
      })
    })
  })

  describe('§5 · a message row that will not parse', () => {
    it('🔴 passed over for the message before it — by the read and by the store — never read as none', async () => {
      const { sessionId: id } = await host.createSession(
        { provider: 'claude', profileId: 'lead', approvalMode: 'auto', cwd: root },
        window,
      )
      await host.send(id, 'one', window)
      await waitFor(() => turns(id).length === 1 && echoes(id).length === 1, 'the first turn')
      await host.send(id, 'two', window)
      await waitFor(() => turns(id).length === 2 && echoes(id).length === 2, 'the second turn')
      const [one, two] = turns(id)
      const last = ledger(id).at(-1)?.ordinal
      if (one === undefined || two === undefined || last === undefined) throw new Error('no turns')
      expect(last).toBeGreaterThan(two.ordinal)

      // ⚑ The control: the newest row answers for the second message.
      expect((await host.whatTheModelGot(id, last)).ordinal).toBe(two.ordinal)

      db.prepare('UPDATE events SET payload = ? WHERE session_id = ? AND ordinal = ?').run(
        '{ not json',
        id,
        two.ordinal,
      )
      expect(store.newestOfType?.(id, 'user_turn')?.ordinal).toBe(one.ordinal)
      const got = await host.whatTheModelGot(id, last)
      expect(got.ordinal).toBe(one.ordinal)
      expect(got.words).toEqual(['one'])
    })
  })
})
