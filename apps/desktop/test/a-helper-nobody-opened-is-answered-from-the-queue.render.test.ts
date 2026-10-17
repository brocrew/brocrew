import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, FakeSessionHandle, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import PersonsQueue from '../src/renderer/src/components/PersonsQueue.vue'
import {
  attentionQueue,
  attentionToACardNobodyHolds,
  type AttentionRequest,
  type ConversationWithCards,
} from '../src/renderer/src/lib/attention'
import {
  usePersonsQueue,
  type PersonsQueueDoors,
  type PersonsQueueRow,
} from '../src/renderer/src/lib/persons-queue'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import type { CardNobodyHolds, LedgerWalk, PersonsDecision } from '../src/shared/questions'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * A helper an agent started in Ask mode, parked on a permission, that no window has opened: its row
 * on Waiting on you says what is asked and offers the answers its own card offers, from the host's
 * record alone, and a person's press answers it without taking the conversation over. Never an
 * agent, never the conversation's commander, never a window other than the one holding it.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const NOW = 9_000_000

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

class Window implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    void message
  }
  sendLiveness(): void {}
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
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
}

const DOORS: PersonsQueueDoors = {
  travel: () => {},
  settle: () => {},
  takeOver: () => {},
  open: () => {},
}

describe('a helper nobody opened is answered from Waiting on you', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let window: Window
  let counter: number
  let clock: number

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-nobody-holds-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-nobody-holds-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 8_000_000
    const tick = (): number => clock++
    store = createSessionStore(db, tick)
    counter = 0
    const handles: FakeSessionHandle[] = []
    const issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++counter)}`,
      now: tick,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new Window('webContents:1')
  })

  afterEach(async () => {
    usePersonsQueue().forget()
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const callOn = async (
    toolset: AgentToolset,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /** A PM in Ask mode gives a helper work; the helper's first turn parks on a permission. */
  const aHelperParks = async (): Promise<{ pm: string; helper: string; card: string }> => {
    const opened = await host.createSession(
      { provider: 'claude', profileId: 'the-helper', approvalMode: 'ask', cwd: root },
      window,
    )
    await host.close(opened.sessionId, window)
    const { sessionId: pm } = await host.createSession(
      { provider: 'claude', profileId: 'the-pm', approvalMode: 'ask', cwd: root },
      window,
    )
    const given = await callOn(agentToolsFor(host, pm), 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'the-helper',
      title: 'Make the probe file',
      brief: 'touch /tmp/f106-probe.txt',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const helper = given.agent as string
    await waitFor(
      () =>
        ledger(helper).some((event) => event.type === 'permission_request') &&
        ledger(helper).some((event) => event.type === 'request_routed'),
      'the helper to park on its card',
    )
    const asked = ledger(helper).find((event) => event.type === 'permission_request')
    if (asked?.type !== 'permission_request') throw new Error('no card')
    return { pm, helper, card: asked.id }
  }

  /** The row the helper's own card gets once a window has loaded its whole ledger. */
  const theOpenedCard = (helper: string, card: CardNobodyHolds): AttentionRequest => {
    const control = createTranscript()
    for (const entry of store.events(helper)) applyEvent(control, entry.event, entry.at)
    const conversation: ConversationWithCards = {
      sessionId: helper,
      meta: { provider: card.provider, profileId: card.profileId },
      control,
      requests: new Map(),
    }
    const [row] = attentionQueue([conversation], () => '')
    if (row === undefined) throw new Error('the opened card drew no row')
    return row
  }

  const supply = (
    decisions: readonly PersonsDecision[],
    nobodyHolds: ReadonlyMap<string, AttentionRequest>,
  ): readonly PersonsQueueRow[] => {
    const walked: LedgerWalk<PersonsDecision> = {
      rows: decisions,
      walk: 'every-conversation-that-routed',
      ledgers: decisions.length,
      rowsUnread: 0,
    }
    const queue = usePersonsQueue()
    queue.supply(
      null,
      walked,
      {
        held: new Set<string>(),
        answerable: new Map(),
        nobodyHolds,
        answeredFromHere: new Set<string>(),
        now: NOW,
        lastLookAnswered: { questions: true, decisions: true },
      },
      DOORS,
    )
    return queue.view.value?.rows ?? []
  }

  const shown = (markup: string): string =>
    markup
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')

  it('the row says what is asked and offers the card’s own answers, from the host’s record alone', async () => {
    const { helper, card } = await aHelperParks()
    const [decision] = host.decisionsForAPerson().rows
    if (decision === undefined) throw new Error('no row')
    expect(decision.request.requestId).toBe(card)
    const record = decision.card
    if (record === undefined) throw new Error('the row carried no card')
    expect(record.asked).toMatchObject({ type: 'permission_request', id: card })
    expect(record.provider).toBe('claude')
    expect(record.profileId).toBe('the-helper')

    const fromTheRecord = attentionToACardNobodyHolds(
      helper,
      record,
      { sent: false, refused: null },
      (slug) => slug,
    )
    if (fromTheRecord === undefined) throw new Error('the record drew no row')
    const opened = theOpenedCard(helper, record)
    for (const field of [
      'asked',
      'scope',
      'decisions',
      'limit',
      'noPositive',
      'marksSay',
      'refusesFirst',
      'underDisclosed',
      'detailOmitted',
    ] as const) {
      expect(fromTheRecord[field], field).toEqual(opened[field])
    }

    const [row] = supply([decision], new Map([[fromTheRecord.key, fromTheRecord]]))
    expect(row?.noAnswerHere).toBeNull()
    expect(row?.alsoOnScreen).toBe(false)
    expect(row?.answers.map((one) => one.label)).toEqual(opened.decisions.map((one) => one.label))
    expect(row?.disclosed).toMatchObject({ asked: opened.asked, scope: opened.scope })

    const text = shown(await renderToString(createSSRApp({ render: () => h(PersonsQueue, {}) })))
    expect(text).toContain('touch /tmp/f106-probe.txt')
    for (const one of opened.decisions) expect(text).toContain(one.label)
    expect(text).not.toContain('Nobody is holding that conversation')
  })

  it('without the card the row offers no answer, and says how to take it over', async () => {
    await aHelperParks()
    const [decision] = host.decisionsForAPerson().rows
    if (decision === undefined) throw new Error('no row')
    const withoutTheCard: PersonsDecision = { ...decision }
    delete (withoutTheCard as { card?: CardNobodyHolds }).card
    const [row] = supply([withoutTheCard], new Map())
    expect(row?.answers).toEqual([])
    expect(row?.disclosed).toBeNull()
    expect(row?.noAnswerHere).toBe('not-yours-yet')
  })

  it('a person’s press answers it without taking it over, and the row leaves', async () => {
    const { helper, card } = await aHelperParks()
    const person = new Window('webContents:9')
    await expect(
      host.respondPermission(helper, card, { outcome: 'allow' }, person),
    ).resolves.toMatchObject({ outcome: 'taken' })
    expect(ledger(helper).filter((event) => event.type === 'user_decision')).toMatchObject([
      { requestId: card, outcome: 'allow', by: { who: 'a-person' } },
    ])
    const slots = (host as unknown as { slots: Map<string, { ownerId: string | null }> }).slots
    expect(slots.get(helper)?.ownerId).toBeNull()
    expect(host.decisionsForAPerson().rows).toEqual([])
  })

  it('never its commander, and never a window other than the one holding it', async () => {
    const { pm, helper, card } = await aHelperParks()
    await expect(
      host.respondPermission(helper, card, { outcome: 'allow' }, { ownerId: `agent:${pm}` }),
    ).rejects.toThrow(/a person’s decision/)

    const holder = new Window('webContents:3')
    host.claimSession(helper, holder)
    expect(host.decisionsForAPerson().rows[0]?.card).toBeUndefined()
    await expect(
      host.respondPermission(helper, card, { outcome: 'allow' }, new Window('webContents:9')),
    ).rejects.toThrow()
    await expect(
      host.respondPermission(helper, card, { outcome: 'allow' }, holder),
    ).resolves.toMatchObject({ outcome: 'taken' })
  })

  it('a press after the request closed is told nobody is waiting on it', async () => {
    const { helper, card } = await aHelperParks()
    const person = new Window('webContents:9')
    await host.respondPermission(helper, card, { outcome: 'allow' }, person)
    await expect(
      host.respondPermission(helper, card, { outcome: 'deny' }, person),
    ).resolves.toEqual({
      outcome: 'refused',
      reason: 'the agent is no longer waiting for an answer to this',
      stillOpen: false,
    })
  })
})
