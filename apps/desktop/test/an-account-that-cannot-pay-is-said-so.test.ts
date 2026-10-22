import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime, SessionMachine } from '@brobot2/runtime'
import type {
  FakeSessionHandle,
  ResumeOptions,
  RuntimeEvent,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import { AsyncQueue } from '../../../packages/runtime/src/internal/async-queue'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { ApiKeys, aLoginRunsWithoutAKey, type KeyCipher } from '../src/main/runtime/api-keys'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { theStallAndItsAsk } from '../src/main/runtime/reply-rails'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  applyEvent,
  billingNotice,
  createTranscript,
  type NoticeItem,
} from '../src/renderer/src/lib/transcript'
import type {
  ApiKeyCheck,
  PersistedEventInfo,
  ProvidersChangedMessage,
  RuntimeEventMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { UNDRIVEN_SENTENCES, derivePieces, type PieceRow } from '../src/shared/tasks'
import { withoutWhatThisAppAdds } from './lib/what-this-app-adds'

/**
 * # An account its provider would not bill is said so, with the key and the ways out
 *
 * A saved key whose account can't pay fails every turn. The runtime marks such a refusal by its
 * code (Claude's `billing_error`, Codex's `usageLimitExceeded` on a key); its own tests are in
 * `claude-runtime.test.ts` and `codex-runtime.test.ts`. Here, each surface:
 *
 *  - §1 the conversation's notice names the key and the ways out;
 *  - §2 the piece it was driving stalls on its own cause, at once;
 *  - §3 its giver is told why, and who has to act;
 *  - §4 Providers stops calling the key ready until a turn or a check on it works, and nothing is
 *    sent again.
 *
 * Fake values only: no key, token or login is read or written by any test here.
 */

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the conversation's own notice
// ─────────────────────────────────────────────────────────────────────────────────────────────

const BILLING = 'Credit balance is too low'

const started = (provider: Provider): RuntimeEvent => ({
  type: 'session',
  state: 'started',
  ref: { provider, sessionId: 'thread_1', cwd: '/tmp/x', rotation: 0 },
})

const noticesFor = (...events: RuntimeEvent[]): NoticeItem[] => {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state.items.filter((item): item is NoticeItem => item.kind === 'notice')
}

const refusedBill = (message: string, onAKey: boolean): RuntimeEvent => ({
  type: 'error',
  message,
  fatal: false,
  billingRefused: true,
  ...(onAKey ? { onAKey: true as const } : {}),
})

describe('§1 · the billing refusal’s notice names the key and the ways out', () => {
  it('🔴 Claude on a saved key: the key, credit for its account, another key — said once', () => {
    const notices = noticesFor(
      started('claude'),
      refusedBill(BILLING, true),
      // The turn's own ending repeats the provider's sentence; it is not drawn twice.
      { type: 'error', message: `turn failed: ${BILLING}`, fatal: false },
      { type: 'turn', state: 'failed', billingRefused: true, onAKey: true },
    )
    const errors = notices.filter((notice) => notice.level === 'error')
    expect(errors.map((notice) => notice.text)).toEqual([billingNotice('claude', true)])
    const said = billingNotice('claude', true)
    expect(said).toContain('the API key saved for Claude')
    expect(said).toContain('Add credit to that account, then send this conversation a message')
    expect(said).toContain('“API key” on the Claude card in Providers')
    // A new key reaches only conversations started after it: a running one keeps its key.
    expect(said).toContain('conversations started after that run on the new key')
    expect(notices.map((notice) => notice.text).join(' ')).not.toContain(BILLING)
  })

  it('⚑ Claude on a login: the account’s billing, never a key it does not run on', () => {
    const [notice] = noticesFor(started('claude'), refusedBill(BILLING, false)).filter(
      (one) => one.level === 'error',
    )
    expect(notice?.text).toBe(billingNotice('claude', false))
    expect(notice?.text).not.toContain('the API key saved')
  })

  it('🔴 Codex on a saved key: the same ways out, named for Codex', () => {
    const quota = 'Quota exceeded. Check your plan and billing details.'
    const [notice] = noticesFor(started('codex'), refusedBill(quota, true)).filter(
      (one) => one.level === 'error',
    )
    expect(notice?.text).toBe(billingNotice('codex', true))
    expect(notice?.text).toContain('the API key saved for Codex')
  })

  it('⚑ a second refusal in the same turn is said once', () => {
    const notices = noticesFor(
      started('claude'),
      refusedBill(BILLING, true),
      refusedBill(BILLING, true),
    ).filter((one) => one.level === 'error')
    expect(notices).toHaveLength(1)
  })

  it('⚑ control: an error the provider did not mark is its own sentence, as before', () => {
    const notices = noticesFor(started('claude'), { type: 'error', message: BILLING, fatal: false })
    expect(notices.map((notice) => notice.text)).toContain(BILLING)
    expect(notices.map((notice) => notice.text)).not.toContain(billingNotice('claude', true))
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · the piece of work it was driving
// ─────────────────────────────────────────────────────────────────────────────────────────────

let ordinal = 0
let rowClock = 9_000_000
const row = (event: TranscriptEvent): PersistedEventInfo => ({
  ordinal: ordinal++,
  at: (rowClock += 1_000),
  event,
})
const theTask = (entries: TranscriptEvent[]): PieceRow => {
  ordinal = 0
  rowClock = 9_000_000
  const found = derivePieces('sess_worker', entries.map(row), { backgroundWakesIt: true })[0]
  if (found === undefined) throw new Error('no piece was folded')
  return found
}

const itsTurn: TranscriptEvent[] = [
  {
    type: 'work_given',
    piece: 'work_7',
    label: 'W1.7',
    parent: 'work_root',
    givenBy: 'sess_giver',
    title: 'Build the index',
    brief: 'build the index',
  },
  { type: 'user_turn', text: 'build the index' },
  { type: 'status', state: 'working' },
]

describe('§2 · the piece it was driving stalls on the billing refusal', () => {
  it('🔴 a message waiting to drive it does not keep it working: the refusal is said at once', () => {
    const queued = {
      type: 'message_queued',
      messageId: 'msg_follow_up',
      kind: 'notice',
      text: 'how is it going?',
    } as TranscriptEvent
    const task = theTask([
      ...itsTurn,
      queued,
      { type: 'turn', state: 'failed', billingRefused: true, onAKey: true },
    ])
    expect(task).toMatchObject({ state: 'stalled', stalledBecause: 'billing_refused' })
    // The control: the same message beside a turn that failed for nothing in particular holds it.
    expect(theTask([...itsTurn, queued, { type: 'turn', state: 'failed' }]).state).toBe('working')
  })

  it('🔴 a turn that failed for billing: `billing_refused`, not *its turn ended*', () => {
    const task = theTask([
      ...itsTurn,
      { type: 'turn', state: 'failed', billingRefused: true, onAKey: true },
      { type: 'status', state: 'idle' },
    ])
    expect(task).toMatchObject({ state: 'stalled', stalledBecause: 'billing_refused' })
  })

  it('⚑ control: a turn that failed on anything else waits on the person who wrote', () => {
    // The words that opened both turns are a person's. A turn's own ending leaves the piece with
    // them; a billing refusal is a fact its giver is owed, so it stalls whoever wrote.
    const task = theTask([
      ...itsTurn,
      { type: 'turn', state: 'failed' },
      { type: 'status', state: 'idle' },
    ])
    expect(task).toMatchObject({
      state: 'waiting-on-the-person-who-wrote',
      stalledBecause: null,
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · what its giver is told
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · the giver is told why, and that a person has to fix it', () => {
  it('🔴 the account would not be billed, and a person has to add credit to it', () => {
    const said = theStallAndItsAsk('billing_refused', null)
    expect(said).toBe(UNDRIVEN_SENTENCES.billing_refused.replace(/\.$/, ''))
    expect(said).toContain('would not bill the account it runs on')
    expect(said).toContain('add credit to that account')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · the Providers card, through the host
// ─────────────────────────────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

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

/** The machine behind each handle, so a test ends its turns by hand, and what each was sent. */
const controls = new Map<FakeSessionHandle, { machine: SessionMachine; sent: string[] }>()

/** A turn that stays `working` until the test ends it, as the provider would. */
function heldByTheTest(handle: FakeSessionHandle): FakeSessionHandle {
  const queue = new AsyncQueue<RuntimeEvent>()
  let status = handle.status()
  const sent: string[] = []
  const machine = new SessionMachine((event) => {
    if (event.type === 'status') status = event.state
    queue.push(event)
  })
  machine.markStarting()
  machine.sessionStarted(handle.ref, 'started')
  let closing: Promise<void> | null = null
  const proxy = new Proxy(handle, {
    get(target, property) {
      if (property === 'events') return (): AsyncIterable<RuntimeEvent> => queue
      if (property === 'status') return () => status
      if (property === 'send') {
        return async (text: string): Promise<void> => {
          if (machine.beginTurn() === null) throw new Error('cannot send: a turn is in progress')
          sent.push(text)
        }
      }
      if (property === 'close') {
        return (): Promise<void> =>
          (closing ??= (async () => {
            if (machine.beginClose()) {
              if (machine.hasProviderWork) machine.forceEnd(false)
              machine.closeSession(handle.ref)
              queue.close()
            }
            await target.close()
          })())
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
  controls.set(proxy, { machine, sent })
  return proxy
}

class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = heldByTheTest(await super.start(options))
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = heldByTheTest(await super.resume(ref, options))
    this.handles.push(handle)
    return handle
  }
}

/** A stand-in for `safeStorage`: the "sealed" key is the fake value with a prefix. */
const CIPHER: KeyCipher = {
  available: () => true,
  seal: (key) => `sealed:${key}`,
  open: (sealed) => sealed.slice('sealed:'.length),
}

describe('§4 · Providers stops calling the key ready, until a turn or a check on it works', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let keys: ApiKeys
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let moved: ProvidersChangedMessage[]
  let counter: number
  let window: RecordingSink
  let keySavedAt: number
  let checkSays: ApiKeyCheck | Promise<ApiKeyCheck>
  let checksStarted: number

  beforeEach(async () => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-f101-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    // The first key is saved at 1, before every life the host starts (its clock is the real one).
    keySavedAt = 1
    keys = new ApiKeys(store, CIPHER, () => keySavedAt)
    checkSays = { ok: true }
    checksStarted = 0
    handles = []
    moved = []
    counter = 0
    const issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      apiKeys: keys,
      providersMoved: (message) => moved.push(message),
      askTheProvider: async () => {
        checksStarted++
        return checkSays
      },
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink('webContents:1')
    expect(await keys.set('claude', 'sk-ant-fake-not-a-key')).toBeNull()
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const turnsIn = (sessionId: string): number =>
    store.events(sessionId).filter((one) => one.event.type === 'turn').length

  /** A message to a conversation, and its turn as the test ends it. */
  const aTurnOn = async (
    sessionId: string,
    ending: (machine: SessionMachine) => void,
  ): Promise<string[]> => {
    const before = turnsIn(sessionId)
    const { machine, sent } = controls.get(handleOf.get(sessionId)!)!
    const count = sent.length
    await host.send(sessionId, 'hello', window)
    await waitFor(() => sent.length === count + 1, 'the message to reach the provider')
    ending(machine)
    await waitFor(() => turnsIn(sessionId) === before + 1, 'the turn row')
    return sent
  }

  const handleOf = new Map<string, FakeSessionHandle>()
  const aConversation = async (provider: Provider = 'claude'): Promise<string> => {
    const { sessionId } = await host.createSession({ provider }, window)
    handleOf.set(sessionId, handles.at(-1)!)
    return sessionId
  }

  /** A new conversation, a message sent to it, and its turn as the test ends it. */
  const aTurnEndingAs = async (
    ending: (machine: SessionMachine) => void,
  ): Promise<{ sessionId: string; sent: string[] }> => {
    const sessionId = await aConversation()
    return { sessionId, sent: await aTurnOn(sessionId, ending) }
  }

  const refusedForBilling = (machine: SessionMachine): void => {
    machine.completeTurn('failed', BILLING, undefined, undefined, {
      billingRefused: true,
      onAKey: true,
    })
  }

  it('🔴 a turn refused for billing on the key: the key says so, and the window is told', async () => {
    expect(host.apiKeyStatus('claude')).not.toHaveProperty('refusedForBilling')
    const { sent } = await aTurnEndingAs(refusedForBilling)
    expect(host.apiKeyStatus('claude').refusedForBilling).toEqual({
      at: expect.any(Number),
      aLoginRunsWithoutIt: aLoginRunsWithoutAKey('claude'),
    })
    expect(moved).toContainEqual({ what: 'key', provider: 'claude' })
    // No retry: the one message was sent once, and nothing was sent again.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(sent).toHaveLength(1)
    expect(withoutWhatThisAppAdds(sent[0] ?? '')).toMatch(/hello$/)
    // And the other provider's key is untouched.
    expect(host.apiKeyStatus('codex')).not.toHaveProperty('refusedForBilling')
  })

  it('🔴 a turn on the key that works again lets go of it', async () => {
    await aTurnEndingAs(refusedForBilling)
    moved = []
    await aTurnEndingAs((machine) => machine.completeTurn('completed'))
    expect(host.apiKeyStatus('claude')).not.toHaveProperty('refusedForBilling')
    expect(moved).toContainEqual({ what: 'key', provider: 'claude' })
  })

  it('⚑ a key replaced is not the key refused', async () => {
    await aTurnEndingAs(refusedForBilling)
    await host.setApiKey('claude', 'sk-ant-another-fake')
    expect(host.apiKeyStatus('claude')).not.toHaveProperty('refusedForBilling')
  })

  it('⚑ control: a turn that failed for another reason leaves the key as it was', async () => {
    await aTurnEndingAs((machine) => machine.completeTurn('failed', 'API Error: 500'))
    expect(host.apiKeyStatus('claude')).not.toHaveProperty('refusedForBilling')
    expect(moved.filter((one) => one.what === 'key')).toEqual([])
  })

  it('🔴 a refusal from a conversation still on a key replaced since marks nothing', async () => {
    const { sessionId } = await aTurnEndingAs(refusedForBilling)
    keySavedAt = Date.now()
    await host.setApiKey('claude', 'sk-ant-another-fake')
    expect(host.apiKeyStatus('claude')).not.toHaveProperty('refusedForBilling')
    // The same conversation, still on the first key, is refused again.
    await aTurnOn(sessionId, refusedForBilling)
    expect(host.apiKeyStatus('claude')).not.toHaveProperty('refusedForBilling')
  })

  it('🔴 a turn that works on a conversation started before the key leaves the refusal standing', async () => {
    const older = await aConversation()
    keySavedAt = Date.now()
    await host.setApiKey('claude', 'sk-ant-another-fake')
    await aTurnEndingAs(refusedForBilling)
    expect(host.apiKeyStatus('claude').refusedForBilling).toBeDefined()
    await aTurnOn(older, (machine) => machine.completeTurn('completed'))
    expect(host.apiKeyStatus('claude').refusedForBilling).toBeDefined()
  })

  it('⚑ a refusal on a login, not the key, marks nothing', async () => {
    await aTurnEndingAs((machine) =>
      machine.completeTurn('failed', BILLING, undefined, undefined, { billingRefused: true }),
    )
    expect(host.apiKeyStatus('claude')).not.toHaveProperty('refusedForBilling')
  })

  it('⚑ removing the key lets go of its refusal', async () => {
    await aTurnEndingAs(refusedForBilling)
    await host.removeApiKey('claude')
    expect(host.apiKeyStatus('claude')).not.toHaveProperty('refusedForBilling')
  })

  it('⚑ a Codex key out of quota is marked on the Codex card, not Claude’s', async () => {
    expect(await keys.set('codex', 'sk-fake-openai-not-a-key')).toBeNull()
    const sessionId = await aConversation('codex')
    await aTurnOn(sessionId, refusedForBilling)
    expect(host.apiKeyStatus('codex').refusedForBilling).toBeDefined()
    expect(host.apiKeyStatus('claude')).not.toHaveProperty('refusedForBilling')
  })

  it('🔴 a check that finds the account can’t pay marks the key; one that ran a request clears it', async () => {
    checkSays = { ok: false, cannotPay: true, reason: 'cannot pay' }
    expect(await host.checkApiKey('claude')).toMatchObject({ ok: false, cannotPay: true })
    expect(host.apiKeyStatus('claude').refusedForBilling).toBeDefined()
    expect(moved).toContainEqual({ what: 'key', provider: 'claude' })
    // A check that only listed the models says nothing about the account.
    checkSays = { ok: true }
    await host.checkApiKey('claude')
    expect(host.apiKeyStatus('claude').refusedForBilling).toBeDefined()
    checkSays = { ok: true, answeredARequest: true }
    await host.checkApiKey('claude')
    expect(host.apiKeyStatus('claude')).not.toHaveProperty('refusedForBilling')
  })

  it.each(['save', 'remove-and-save'] as const)(
    'a late check failure leaves the replacement key alone after %s, even in the same clock tick',
    async (change) => {
      let finish!: (answer: ApiKeyCheck) => void
      checkSays = new Promise((resolve) => {
        finish = resolve
      })
      const checking = host.checkApiKey('claude')
      await waitFor(() => checksStarted === 1, 'the first key check')
      if (change === 'remove-and-save') await host.removeApiKey('claude')
      await host.setApiKey('claude', 'sk-fictional-replacement')
      finish({ ok: false, cannotPay: true, reason: 'fictional billing refusal' })
      await checking
      expect(host.apiKeyStatus('claude')).not.toHaveProperty('refusedForBilling')
    },
  )

  it.each(['save', 'remove-and-save'] as const)(
    'a late check success leaves the replacement key’s refusal alone after %s',
    async (change) => {
      let finish!: (answer: ApiKeyCheck) => void
      checkSays = new Promise((resolve) => {
        finish = resolve
      })
      const checking = host.checkApiKey('claude')
      await waitFor(() => checksStarted === 1, 'the first key check')
      if (change === 'remove-and-save') await host.removeApiKey('claude')
      await host.setApiKey('claude', 'sk-fictional-replacement')
      checkSays = { ok: false, cannotPay: true, reason: 'fictional billing refusal' }
      await host.checkApiKey('claude')
      expect(host.apiKeyStatus('claude').refusedForBilling).toBeDefined()
      finish({ ok: true, answeredARequest: true })
      await checking
      expect(host.apiKeyStatus('claude').refusedForBilling).toBeDefined()
    },
  )

  it('⚑ the words for the way out follow the platform: on Windows, whether Claude Code’s login is there', () => {
    const aLogin = JSON.stringify({ claudeAiOauth: { accessToken: 'fake-token', expiresAt: 1 } })
    expect(aLoginRunsWithoutAKey('claude', 'win32', () => null)).toBe(false)
    expect(
      aLoginRunsWithoutAKey('claude', 'win32', () => aLogin),
      'an expired one is renewed',
    ).toBe(true)
    expect(aLoginRunsWithoutAKey('claude', 'darwin', () => null)).toBe(true)
    expect(aLoginRunsWithoutAKey('codex', 'win32', () => null)).toBe(true)
  })
})
