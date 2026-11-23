import { scriptedClaudeQuery } from './lib/scripted-claude-query'
import type { ClaudeQuery } from '@brobot2/runtime/claude'
import { ClaudeRuntime } from '@brobot2/runtime/claude'
import { neutralHostDeps, syntheticProviderHome } from './lib/host-fixture'
import type { HandedPath } from '../src/shared/attachment-contracts'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexRuntime, type CodexLaunchContext } from '@brobot2/runtime/codex'
import {
  FakeProviderSessions,
  FakeRuntime,
  capabilitiesFor,
  withDeadline,
  type AgentRuntime,
  type AgentToolset,
  type FakeSessionHandle,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { deferred, ready, route } from '../../../packages/runtime/test/fixtures/plugin-readiness'
import { ScriptedCodex, Wire } from './lib/scripted-codex-compaction'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import { classifyHandedPath } from '../src/main/runtime/handed-path'
import {
  A_PERSON_SENT_IT,
  theDirectionLine,
  THE_PERSON_AT_A_WINDOW,
  type TurnOrigin,
} from '../src/main/runtime/turn-origin'
import { theOwnerOf } from '../src/shared/piece-called'
import {
  aCommandTakesNoAttachments,
  aPersonsCompaction,
} from '../src/main/runtime/a-command-goes-as-typed'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentName, type RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { withoutWhatThisAppAdds } from './lib/what-this-app-adds'

/**
 * 🔴 **713 · compact, on both providers** — `R59` and `R60`'s runtime half.
 *
 * ## ⛔ The defect (`708` H-2), measured
 *
 * ⚠️ **A person's `/compact` on Codex did nothing, before `708` and after it.** Codex's app-server has
 * no slash commands (`279`), so the words reached the model and the model answered them
 * (`probe:codex-command-as-typed`). Its compaction is a request of its own, `thread/compact/start`.
 *
 * ## ⚑ What this file holds
 *
 * - **§1 · the host over the REAL Codex adapter**, on a transport scripted from the wire that probe
 *   measured — so the decision, the adapter's request and the turn it runs are one path here, and
 *   what crossed it is read off the transport. 🔴 RED on `main`: a person's `/compact` went out on
 *   `turn/start`, inside its frame.
 * - **§2 · every door**, on a double that compacts on request: a held message's flush,
 *   interrupt-and-send, and the refusals that must come before either.
 * - **§3 · `R60`**: both providers declare the capability, and Claude's road is `R42`'s.
 *
 * ⚠️ **What this cannot say**: whether hosted Codex summarizes well. The probe's loopback model
 * answers every request with `ok` — *"This captures what the provider put in its model-bound
 * request, not a hosted model's obedience to the text."*
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(
    readonly ownerId: string,
    readonly aPersonIsBehindIt = true,
  ) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** A FakeRuntime that keeps its handles, and makes a Codex one compact on request (§2). */
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
    if (handle.ref.provider === 'codex') handle.compactsOnRequest()
    this.handles.push(handle)
    return handle
  }
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const THE_WARNING_OPENS = 'Heads up: Long threads'

interface Harness {
  host: RuntimeHost
  store: SessionStore
  window: RecordingSink
  root: string
  ledger: (sessionId: string) => TranscriptEvent[]
}

/** ⚑ One app: its own store and folders, and the runtime a test chooses for each provider. */
function anApp(
  createRuntime: (provider: Provider) => AgentRuntime,
  cleanup: (() => Promise<void> | void)[],
): Harness {
  const userData = mkdtempSync(join(tmpdir(), 'brobot2-713-'))
  const root = mkdtempSync(join(tmpdir(), 'brobot2-713-root-'))
  const db: AppDatabase = openDatabase(join(userData, 'brobot2.sqlite'))
  applyMigrations(db, migrationsFolder)
  const store = createSessionStore(db)
  let counter = 0
  const host = new RuntimeHost({
    store,
    ...neutralHostDeps(() => userData),
    createRuntime,
    prepareProviderHome: syntheticProviderHome(() => userData),
    providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
    resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
    newSessionId: () => `sess_${String(++counter)}`,
    commandListWaitMs: 60,
    readProviderConfig: (_provider, home) => ({
      home,
      homeEnv: 'CODEX_HOME',
      model: 'm',
      authNote: null,
      files: [],
    }),
  })
  cleanup.push(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })
  return {
    host,
    store,
    window: new RecordingSink(sinkOwnerId({ id: 1 })),
    root,
    ledger: (sessionId) => store.events(sessionId).map((entry) => entry.event),
  }
}

const userTurns = (events: TranscriptEvent[]): string[] =>
  events.flatMap((event) => (event.type === 'user_turn' ? [event.text] : []))

const compactionsIn = (events: TranscriptEvent[]) =>
  events.filter(
    (event): event is Extract<TranscriptEvent, { type: 'compaction' }> =>
      event.type === 'compaction',
  )

const turnsEnded = (events: TranscriptEvent[], state: string): number =>
  events.filter((event) => event.type === 'turn' && event.state === state).length

const callOn = async (
  toolset: AgentToolset,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const tool = toolset.tools.find((one) => one.name === name)
  if (tool === undefined) throw new Error(`no such tool: ${name}`)
  return (await tool.call(args)).structured as Record<string, unknown>
}

describe('713 §1 · R59 — the host, over the REAL Codex adapter', () => {
  const cleanup: (() => Promise<void> | void)[] = []
  let app: Harness
  let transports: ScriptedCodex[]
  let claudes: FakeSessionHandle[]
  let awaitManagedPlugin: boolean
  let heldInput:
    | { accepted: ReturnType<typeof deferred<void>>; release: ReturnType<typeof deferred<void>> }
    | undefined

  beforeEach(() => {
    transports = []
    claudes = []
    awaitManagedPlugin = false
    heldInput = undefined
    class ScriptedCodexRuntime extends CodexRuntime {
      override async start(options: StartOptions) {
        const handle = await super.start(
          awaitManagedPlugin ? { ...options, managedPluginMcp: [route] } : options,
        )
        const gate = heldInput
        if (gate !== undefined) {
          const send = handle.send.bind(handle)
          handle.send = (text, origin, onAccepted) =>
            send(text, origin, () => {
              onAccepted?.()
              gate.accepted.resolve()
            }).then(() => gate.release.promise)
        }
        return handle
      }
    }
    const sessions = new FakeProviderSessions()
    app = anApp((provider) => {
      if (provider === 'claude') return new ProviderDouble('claude', claudes, sessions)
      return new ScriptedCodexRuntime((context: CodexLaunchContext) => {
        const transport = new ScriptedCodex(context.providerHome)
        transports.push(transport)
        return transport
      })
    }, cleanup)
  })

  afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step()
  })

  /** A person opens a Codex conversation; its transport is the newest one. */
  const aPersonOpensCodex = async (): Promise<{ id: string; codex: ScriptedCodex }> => {
    const { sessionId } = await app.host.createSession(
      { provider: 'codex', approvalMode: 'auto', cwd: app.root },
      app.window,
    )
    const codex = transports.at(-1)
    if (codex === undefined) throw new Error('no Codex transport')
    return { id: sessionId, codex }
  }

  it('🔴 a person’s `/compact` runs Codex’s compaction — never a turn of words — and the transcript shows it', async () => {
    const { id, codex } = await aPersonOpensCodex()
    await app.host.send(id, '/compact', app.window)
    await waitFor(() => turnsEnded(app.ledger(id), 'completed') === 1, 'the compaction to end')

    // ⛔ The words reached no model: nothing went out on `turn/start` at all.
    expect(codex.turnTexts()).toEqual([])
    // ⚑ Codex's own request did, once, for this thread.
    expect(codex.requests.filter((one) => one.method === 'thread/compact/start')).toEqual([
      { method: 'thread/compact/start', params: { threadId: 'th_1' } },
    ])
    // ⚑ The transcript: the person's `/compact`, as they typed it, then the compaction row —
    // `manual`, the word Claude's own `/compact` boundary carries.
    const events = app.ledger(id)
    expect(userTurns(events)).toEqual(['/compact'])
    expect(compactionsIn(events)).toEqual([
      {
        type: 'compaction',
        compactionId: 'cc_tc_1',
        trigger: 'manual',
        source: 'contextCompaction',
      },
    ])
    const order = events.map((event) => event.type)
    expect(order.indexOf('user_turn')).toBeLessThan(order.indexOf('compaction'))
    // ⚠️ …and Codex's own warning, which it sends with every compaction — drawn as the non-fatal
    // notice every Codex warning is (065), because it is the provider's word and not ours to drop.
    expect(
      events.some(
        (event) =>
          event.type === 'error' && !event.fatal && event.message.includes(THE_WARNING_OPENS),
      ),
    ).toBe(true)
  })

  it.each(['Keep the settled plan and free its context', undefined])(
    'waits for native confirmation and delivers the compaction notice (%s) with the next input once',
    async (given) => {
      const { id, codex } = await aPersonOpensCodex()
      app.store.createAgentIdentity(
        { slug: 'director', displayName: 'Ada', provider: 'claude' },
        { by: 'a-person' },
      )
      const { sessionId: caller } = await app.host.createSession(
        { provider: 'claude', profileId: 'director', approvalMode: 'auto', cwd: app.root },
        app.window,
      )
      const address = app.host.addressOf(caller)
      const title = 'Plan the migration'
      expect(app.host.retitleForAPerson(address, title)).toMatchObject({ ok: true })
      const tool = agentToolsFor(app.host, caller).tools.find((one) => one.name === 'compact_agent')
      if (tool === undefined) throw new Error('no compact_agent tool')
      let confirm = (): void => {}
      codex.compactionMayFinish = new Promise<void>((resolve) => {
        confirm = resolve
      })
      const reason = given ?? 'no reason given'
      const notice = `Ada, conversation ${address} · ${title}, compacted this conversation: ${reason}.`
      const notices = () =>
        app
          .ledger(id)
          .filter(
            (event) => 'appNotice' in event && event.appNotice === 'a-conversation-was-compacted',
          )
      try {
        const requested = await tool.call({ agent: app.host.addressOf(id), reason: given })
        expect(requested.structured).toMatchObject({ outcome: 'ok', agent: id, requested: true })
        expect(requested.text).toMatch(/^Compaction requested for conversation W\d+ · /)
        expect(codex.asked('thread/compact/start')).toBe(1)
        expect(codex.turnTexts()).toEqual([])
        expect(compactionsIn(app.ledger(id))).toEqual([])
        expect(notices()).toEqual([])

        const busy = await tool.call({ agent: id, reason: given })
        expect(busy.structured).toMatchObject({
          outcome: 'ok',
          queued: true,
        })
        expect(busy.text).toMatch(/^Compaction queued for /)
        expect(codex.asked('thread/compact/start')).toBe(1)
      } finally {
        confirm()
      }
      await waitFor(() => turnsEnded(app.ledger(id), 'completed') >= 1, 'the compaction to end')
      expect(compactionsIn(app.ledger(id))).toMatchObject([{ trigger: 'manual' }])
      expect(codex.turnTexts(), 'a confirmed notice must not start a model turn').toEqual([])
      expect(notices()).toMatchObject([{ text: notice }])
      expect(userTurns(app.ledger(id))).not.toContain('/compact')

      const next = 'Check the migration plan'
      await app.host.send(id, next, app.window)
      await waitFor(() => turnsEnded(app.ledger(id), 'completed') >= 2, 'the next input to end')
      expect(codex.turnTexts()).toHaveLength(1)
      const [first = ''] = codex.turnTexts()
      expect(first).toContain(next)
      expect(first.split(notice)).toHaveLength(2)

      const later = 'List the remaining tasks'
      await app.host.send(id, later, app.window)
      await waitFor(() => turnsEnded(app.ledger(id), 'completed') >= 3, 'the later input to end')
      expect(codex.turnTexts()).toHaveLength(2)
      expect(codex.turnTexts()[1]).toContain(later)
      expect(codex.turnTexts()[1]).not.toContain(reason)
    },
  )

  it('keeps the notice when Codex stops before dispatching its carrying input', async () => {
    awaitManagedPlugin = true
    const { id, codex } = await aPersonOpensCodex()
    const { sessionId: caller } = await app.host.createSession(
      { provider: 'claude', approvalMode: 'auto', cwd: app.root },
      app.window,
    )
    const reason = 'Make room for the next comparison'
    expect(
      await callOn(agentToolsFor(app.host, caller), 'compact_agent', { agent: id, reason }),
    ).toMatchObject({ outcome: 'ok', requested: true })
    await waitFor(() => turnsEnded(app.ledger(id), 'completed') === 1, 'confirmed compaction')
    const notice = app.store
      .messagesWaitingIn(id)
      .find((row) => row.authorship.appNotice === 'a-conversation-was-compacted')
    if (notice === undefined) throw new Error('missing confirmed compaction notice')
    const receipts = () =>
      app
        .ledger(id)
        .filter((row) => row.type === 'message_unqueued' && row.messageId === notice.messageId)

    const discovery = deferred<unknown>()
    codex.pluginDiscovery = discovery.promise
    const openingTitle = 'Plugin discovery input'
    const unsentBody = 'This input waits for plugin discovery'
    const unsent = `${openingTitle}\n${unsentBody}`
    try {
      await app.host.send(id, unsent, app.window)
      await waitFor(() => codex.asked('mcpServerStatus/list') === 1, 'plugin discovery to begin')
      expect(userTurns(app.ledger(id))).toContain(unsent)
      expect(codex.turnTexts()).toEqual([])
      await app.host.interrupt(id, app.window)
      await waitFor(() => turnsEnded(app.ledger(id), 'interrupted') === 1, 'the stopped turn')
      expect(receipts()).toEqual([])
      expect(app.store.messagesWaitingIn(id).map((row) => row.messageId)).toContain(
        notice.messageId,
      )
    } finally {
      discovery.resolve(ready())
    }
    await app.host.close(id, app.window)
    expect(codex.turnTexts()).toEqual([])
    const reopened = await app.host.reopenForAPerson(id, app.window, null)
    expect(reopened.sessionId).toBe(id)
    const resumed = transports.at(-1)
    if (resumed === undefined) throw new Error('no resumed Codex transport')
    expect(resumed).not.toBe(codex)

    const next = 'Continue the comparison'
    const acceptance = deferred<void>()
    resumed.ordinaryTurnMayStart = acceptance.promise
    try {
      await app.host.send(id, next, app.window)
      await waitFor(() => resumed.asked('turn/start') === 1, 'input to reach Codex')
      expect(userTurns(app.ledger(id))).toContain(next)
      expect(receipts()).toEqual([])
    } finally {
      acceptance.resolve()
    }
    await waitFor(() => turnsEnded(app.ledger(id), 'completed') === 2, 'the accepted turn')
    expect(resumed.turnTexts()).toHaveLength(1)
    expect(resumed.turnTexts()[0]).toContain(next)
    expect(resumed.turnTexts()[0]?.split(reason)).toHaveLength(2)
    expect(resumed.turnTexts()[0]).toContain(openingTitle)
    expect(resumed.turnTexts()[0]).not.toContain(unsentBody)
    expect(receipts()).toEqual([expect.objectContaining({ reason: 'sent' })])

    await app.host.send(id, 'One more comparison', app.window)
    await waitFor(() => turnsEnded(app.ledger(id), 'completed') === 3, 'the later turn')
    expect(resumed.turnTexts()).toHaveLength(2)
    expect(resumed.turnTexts()[1]).not.toContain(reason)
    expect(receipts()).toHaveLength(1)
  })

  it.each([
    { path: 'one held message', messages: ['First queued'], abandon: false },
    {
      path: 'a batch of held messages',
      messages: ['First queued', 'Second queued'],
      abandon: false,
    },
    { path: 'an abandoned handover', messages: ['First queued'], abandon: true },
  ])(
    'settles compaction notices only after a queued turn is recorded: $path',
    async ({ messages, abandon }) => {
      const gate = { accepted: deferred<void>(), release: deferred<void>() }
      heldInput = gate
      const { id, codex } = await aPersonOpensCodex()
      const confirmation = deferred<void>()
      codex.compactionMayFinish = confirmation.promise
      const reason = 'Leave room for the queued follow-up'
      const carryingText = messages.join('\n\n')
      try {
        expect(
          await app.host.compactConversation({ conversation: id, agent: id, reason }),
        ).toMatchObject({ ok: true })
        const queuedIds: string[] = []
        for (const message of messages) {
          const queued = await app.host.queueMessage(id, message, app.window)
          if (queued.outcome !== 'queued') throw new Error('expected a held message')
          queuedIds.push(queued.messageId)
        }
        confirmation.resolve()
        await withDeadline(gate.accepted.promise, 2_000, 'Codex accepts the carrying input')
        expect(codex.turnTexts()).toHaveLength(1)
        expect(codex.turnTexts()[0]).toContain(reason)
        const notice = app.store
          .messagesWaitingIn(id)
          .find((row) => row.authorship.appNotice === 'a-conversation-was-compacted')
        if (notice === undefined) throw new Error('missing pending compaction notice')
        const carryingRows = () =>
          app.ledger(id).flatMap((row) => {
            if (row.type === 'user_turn' && row.text === carryingText) return ['input']
            if (row.type === 'message_unqueued' && row.messageId === notice.messageId)
              return [row.reason]
            return []
          })
        expect(carryingRows()).toEqual([])
        if (abandon) await app.host.close(id, app.window)
        gate.release.resolve()
        // The resumed flush publishes or takes its abandoned branch before the next macrotask.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        const messageEndings = app
          .ledger(id)
          .flatMap((row) =>
            row.type === 'message_unqueued' &&
            row.messageId !== undefined &&
            queuedIds.includes(row.messageId)
              ? [row.reason]
              : [],
          )
        expect(messageEndings).toEqual(messages.map(() => (abandon ? 'abandoned' : 'sent')))
        expect(carryingRows()).toEqual(abandon ? [] : ['input', 'sent'])
      } finally {
        confirmation.resolve()
        gate.release.resolve()
      }
    },
  )

  it('⚑ the control: a person’s ordinary message on Codex is still words, framed', async () => {
    const { id, codex } = await aPersonOpensCodex()
    await app.host.send(id, 'compact this for me please', app.window)
    await waitFor(() => turnsEnded(app.ledger(id), 'completed') === 1, 'the turn to end')
    expect(codex.asked('thread/compact/start')).toBe(0)
    const [heard] = codex.turnTexts()
    expect(heard?.startsWith(A_PERSON_SENT_IT), heard).toBe(true)
    expect(
      withoutWhatThisAppAdds(heard ?? '').endsWith('\n\ncompact this for me please'),
      heard,
    ).toBe(true)
  })

  it('⛔ the control: an AGENT’s `/compact` to a Codex worker is framed words — an agent compacts nobody', async () => {
    const workerProfile = 'worker-713'
    // ⚑ An identity whose OWN provider is Codex — what a spawn launches it on.
    app.store.createAgentIdentity(
      { slug: workerProfile, displayName: null, provider: 'codex' },
      { by: 'a-person' },
    )
    // ⚠️ `ask`: a parent in `auto` may not start a Codex child, whose `auto` would also drop the
    // sandbox (`wider-than-its-parent`) — so the worker runs the prompting profile it inherits.
    const { sessionId: pm } = await app.host.createSession(
      { provider: 'claude', profileId: 'pm-713', approvalMode: 'ask', cwd: app.root },
      app.window,
    )
    // ⚑ D-014 · the default grants start any agent this app holds and give it work.
    // ⚑ **D-016** — the give starts the worker, and its brief — the agent's `/compact` — is the
    // worker's first turn.
    const tools = agentToolsFor(app.host, pm)
    const given = await callOn(tools, 'give_work', {
      to: 'new',
      conversation_title: 'The work 713 is about',
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: 'The work 713 is about',
      brief: '/compact',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const codex = transports.at(-1)
    if (codex === undefined) throw new Error('no worker transport')
    await waitFor(
      () => codex.turnTexts().some((text) => text.includes('/compact')),
      'the agent’s words to reach Codex',
    )
    await waitFor(() => turnsEnded(app.ledger(worker), 'completed') >= 1, 'the agent’s turn to end')
    expect(codex.asked('thread/compact/start')).toBe(0)
    const heard = codex.turnTexts().find((text) => text.includes('/compact')) ?? ''
    // ⚑ D-011 — named, with its conversation's address in the direction line: ⚑ D-016 · commit 7 ·
    // R3 — the piece the pm owns, composed from the product's own parts.
    const pmNamed = app.store.workThatNames(pm)
    if (pmNamed === null) throw new Error('the pm holds no piece, so no piece addresses it')
    // ⚑ W4.178 · the agent's `/compact` is the brief of a give: a brief says nothing of a note.
    const answering = theDirectionLine(
      `${agentName('pm-713', app.store.agentIdentities())}, ${theOwnerOf(pmNamed)}`,
      'caller',
      true,
    )
    expect(heard.startsWith('Sent by ') && heard.includes(answering), heard).toBe(true)
    expect(heard).toContain('/compact')
    expect(heard).not.toBe('/compact')
  })

  it('⚑ `/compact <instructions>` compacts and says the words were not used — nothing dropped silently', async () => {
    const { id, codex } = await aPersonOpensCodex()
    const before = codex.requests.length
    await app.host.send(id, '/compact keep the test plan', app.window)
    await waitFor(() => turnsEnded(app.ledger(id), 'completed') === 1, 'the compaction to end')
    // The request carries no instructions, and no words reached the model.
    expect(
      codex.requests.slice(before).filter((one) => one.method === 'thread/compact/start'),
    ).toEqual([{ method: 'thread/compact/start', params: { threadId: 'th_1' } }])
    expect(codex.turnTexts()).toEqual([])
    expect(
      app.window.messages.some(
        (message) =>
          message.event.type === 'error' &&
          message.event.message ===
            'Codex compacts without instructions; your words were not used.',
      ),
    ).toBe(true)
  })
})

describe('713 §2 · R59 at every door, on a double that compacts on request', () => {
  const cleanup: (() => Promise<void> | void)[] = []
  let app: Harness
  let handles: FakeSessionHandle[]

  beforeEach(() => {
    handles = []
    const sessions = new FakeProviderSessions()
    app = anApp((provider) => new ProviderDouble(provider, handles, sessions), cleanup)
  })

  afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step()
  })

  /** What the provider heard as WORDS — the double's echo. */
  const heardAsWords = (sessionId: string): string[] =>
    app
      .ledger(sessionId)
      .flatMap((event) =>
        event.type === 'assistant_message' ? [event.text.replace(/^echo: /, '')] : [],
      )

  /** A conversation whose first turn is held on its card — something running to wait behind. */
  const busyCodex = async (): Promise<{ id: string; handle: FakeSessionHandle }> => {
    const { sessionId } = await app.host.createSession(
      { provider: 'codex', approvalMode: 'ask', cwd: app.root },
      app.window,
    )
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no double')
    await app.host.send(sessionId, 'first', app.window)
    await waitFor(
      () => app.ledger(sessionId).some((event) => event.type === 'permission_request'),
      'the first turn to hold on its card',
    )
    return { id: sessionId, handle }
  }

  const attachment = async (): Promise<HandedPath> => {
    const path = join(app.root, 'notes.md')
    writeFileSync(path, 'notes\n')
    const chosen = await classifyHandedPath(path, app.root)
    if (!('handed' in chosen)) throw new Error(chosen.refusal)
    return chosen.handed
  }

  const aPendingCard = (sessionId: string): string => {
    const card = app
      .ledger(sessionId)
      .flatMap((event) => (event.type === 'permission_request' ? [event.id] : []))
      .at(-1)
    if (card === undefined) throw new Error('no card')
    return card
  }

  it('🔴 a held `/compact` compacts when its turn comes — the flush reaches the same door', async () => {
    const { id, handle } = await busyCodex()
    const outcome = await app.host.queueMessage(id, '/compact', app.window)
    expect(outcome.outcome).toBe('queued')
    expect(handle.compactions).toBe(0)
    await app.host.respondPermission(id, aPendingCard(id), { outcome: 'allow' }, app.window)
    await waitFor(() => handle.compactions === 1, 'the held /compact to compact')
    // ⛔ …and it never went to the model as words.
    expect(heardAsWords(id).some((words) => words.includes('/compact'))).toBe(false)
  })

  it('🔴 interrupt-and-send `/compact` stops the turn, then compacts', async () => {
    const { id, handle } = await busyCodex()
    await app.host.sendInterrupting(id, '/compact', app.window)
    await waitFor(() => handle.compactions === 1, 'the replacement to compact')
    expect(turnsEnded(app.ledger(id), 'interrupted')).toBe(1)
    expect(heardAsWords(id).some((words) => words.includes('/compact'))).toBe(false)
  })

  it('⛔ with a file it is refused at EVERY door, before anything moves — `R42`’s sentence, one command over', async () => {
    const { id, handle } = await busyCodex()
    const file = await attachment()
    const sentence = aCommandTakesNoAttachments('/compact', true)
    await expect(app.host.send(id, '/compact', app.window, [file])).rejects.toThrow(sentence)
    await expect(app.host.queueMessage(id, '/compact', app.window, [file])).rejects.toThrow(
      sentence,
    )
    await expect(app.host.sendInterrupting(id, '/compact', app.window, [file])).rejects.toThrow(
      sentence,
    )
    // ⛔ Refused BEFORE the stop: the turn it would have replaced is still waiting on its card.
    expect(turnsEnded(app.ledger(id), 'interrupted')).toBe(0)
    expect(handle.compactions).toBe(0)
  })

  it('⚑ on Claude `/compact` and its instructions reach the CLI as typed, through compact()', async () => {
    const { sessionId: id } = await app.host.createSession(
      { provider: 'claude', approvalMode: 'auto', cwd: app.root },
      app.window,
    )
    await app.host.send(id, '/compact keep the test plan', app.window)
    await waitFor(() => heardAsWords(id).length === 1, 'the CLI to hear it')
    expect(heardAsWords(id)).toEqual(['/compact keep the test plan'])
  })

  it('sends a Claude conversation its own /compact with the reason as its instructions', async () => {
    const { sessionId: id } = await app.host.createSession(
      { provider: 'claude', approvalMode: 'auto', cwd: app.root },
      app.window,
    )
    const claude = handles.at(-1)
    if (claude === undefined) throw new Error('no Claude handle')
    const { sessionId: caller } = await app.host.createSession(
      { provider: 'codex', approvalMode: 'auto', cwd: app.root },
      app.window,
    )
    const sent = vi.spyOn(claude, 'send').mockResolvedValueOnce(undefined)
    const result = await callOn(agentToolsFor(app.host, caller), 'compact_agent', {
      agent: id,
      reason: 'Keep the tested plan',
    })
    expect(result).toMatchObject({ outcome: 'ok', agent: id, requested: true })
    expect(sent).toHaveBeenCalledExactlyOnceWith('/compact Keep the tested plan')
    expect(compactionsIn(app.ledger(id))).toEqual([])
  })
})

it('keeps a confirmed notice when Claude stops before pushing its carrying input', async () => {
  type Frame = ClaudeQuery extends AsyncIterable<infer Message> ? Message : never
  const cleanup: (() => Promise<void> | void)[] = []
  let outgoing: (() => Promise<{ text: string; uuid: string } | null>) | undefined
  let incoming: Wire<Frame> | undefined
  let releaseSettings = (): void => {}
  const setPermissionMode = vi.fn(async () => {})
  const claude = new ClaudeRuntime(
    ({ prompt, options }) => {
      const wire = new Wire<Frame>()
      incoming = wire
      const next = prompt[Symbol.asyncIterator]()
      outgoing = async () => {
        const message = await next.next()
        if (message.done === true) return null
        const { content } = message.value.message
        const { uuid } = message.value
        if (typeof content !== 'string' || typeof uuid !== 'string') {
          throw new Error('expected a scripted Claude text input')
        }
        return { text: content, uuid }
      }
      wire.push({
        type: 'system',
        subtype: 'init',
        session_id: 'fixture_compaction_session',
        cwd: options.cwd,
      } as Frame)
      return scriptedClaudeQuery(wire, {
        setPermissionMode,
        supportedCommands: async () => [{ name: 'compact', description: 'Compact context' }],
      })
    },
    async () => true,
    undefined,
    undefined,
    undefined,
    async () => 'fictional-test-key',
  )
  const app = anApp(
    (provider) => (provider === 'claude' ? claude : new FakeRuntime(provider)),
    cleanup,
  )
  const readInput = () => {
    if (outgoing === undefined) throw new Error('Claude was not started')
    return outgoing()
  }
  const emit = (frame: Frame): void => {
    if (incoming === undefined) throw new Error('Claude was not started')
    incoming.push(frame)
  }
  const finish = (uuid: string): void =>
    emit({ type: 'result', subtype: 'success', is_error: false, user_message_uuid: uuid } as Frame)

  try {
    const { sessionId: id } = await app.host.createSession(
      { provider: 'claude', approvalMode: 'auto', cwd: app.root },
      app.window,
    )
    const { sessionId: caller } = await app.host.createSession(
      { provider: 'codex', approvalMode: 'auto', cwd: app.root },
      app.window,
    )
    const reason = 'Retain the evidence for the review'
    expect(
      await callOn(agentToolsFor(app.host, caller), 'compact_agent', { agent: id, reason }),
    ).toMatchObject({ outcome: 'ok', requested: true })
    const compaction = await withDeadline(readInput(), 2_000, 'scripted Claude compaction input')
    if (compaction === null) throw new Error('Claude did not receive the compaction command')
    expect(compaction.text).toBe('/compact Retain the evidence for the review')
    emit({
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: { trigger: 'manual', pre_tokens: 1200 },
    } as Frame)
    finish(compaction.uuid)

    const notices = () =>
      app.store
        .messagesWaitingIn(id)
        .filter((row) => row.authorship.appNotice === 'a-conversation-was-compacted')
    await waitFor(
      () => notices().length === 1 && turnsEnded(app.ledger(id), 'completed') === 1,
      'confirmed compaction',
    )
    const [notice] = notices()
    if (notice === undefined) throw new Error('missing confirmed compaction notice')
    const receipts = () =>
      app
        .ledger(id)
        .filter((row) => row.type === 'message_unqueued' && row.messageId === notice.messageId)

    const nextOnTheOldQuery = readInput()
    setPermissionMode.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseSettings = resolve)),
    )
    await app.host.setSessionSetting(id, { kind: 'planMode', on: true }, app.window)
    const refused = expect(
      app.host.send(id, 'This input never leaves the app', app.window),
    ).rejects.toThrow('stopped before its message could be sent')
    try {
      await vi.waitFor(() => expect(setPermissionMode).toHaveBeenCalledTimes(1))
      await app.host.interrupt(id, app.window)
      await waitFor(() => turnsEnded(app.ledger(id), 'interrupted') === 1, 'the stopped turn')
    } finally {
      releaseSettings()
    }
    await refused
    expect(receipts()).toEqual([])
    expect(notices().map((row) => row.messageId)).toEqual([notice.messageId])

    await withDeadline(app.host.close(id, app.window), 5_000, 'close the stopped Claude session')
    expect(
      await withDeadline(nextOnTheOldQuery, 2_000, 'old Claude input stream closes'),
    ).toBeNull()
    const reopened = await withDeadline(
      app.host.reopenForAPerson(id, app.window, null),
      5_000,
      'reopen the same Claude session',
    )
    expect(reopened.sessionId).toBe(id)
    await withDeadline(app.host.send(id, 'Continue now', app.window), 5_000, 'send after reopen')
    const continued = await withDeadline(readInput(), 2_000, 'scripted Claude input after reopen')
    if (continued === null) throw new Error('Claude did not receive the next input')
    expect(continued.text).toContain('Continue now')
    expect(continued.text.split(reason)).toHaveLength(2)
    expect(continued.text).not.toContain('This input never leaves the app')
    expect(receipts()).toEqual([expect.objectContaining({ reason: 'sent' })])
    expect(notices()).toEqual([])
    finish(continued.uuid)
  } finally {
    releaseSettings()
    for (const step of cleanup.splice(0).reverse()) await step()
  }
})

describe('713 §3 · R60 — "Compact now…" has a road on both providers', () => {
  it('⚑ both declare it `available`, and each note names its own road', () => {
    const claude = capabilitiesFor('claude').requestCompaction
    const codex = capabilitiesFor('codex').requestCompaction
    if (claude.state !== 'available' || codex.state !== 'available') {
      throw new Error(`both compact now: ${claude.state} / ${codex.state}`)
    }
    // ⚑ The two roads differ, and the notes are what say how — the Dropped tab draws them.
    expect(claude.note).toContain('/compact')
    expect(claude.note).toContain('exactly as you type it')
    expect(codex.note).toContain('Codex’s own compaction request')
    expect(codex.note).toContain('no instructions')
  })

  it('⛔ "a person’s /compact" is the whole road — an agent’s and the app’s own words are not one', () => {
    const person = THE_PERSON_AT_A_WINDOW
    expect(aPersonsCompaction('/compact', person)).toEqual({ word: '/compact', instructions: null })
    expect(aPersonsCompaction('  /compact  focus on tests ', person)).toEqual({
      word: '/compact',
      instructions: 'focus on tests',
    })
    expect(aPersonsCompaction('/compact', null)).toBeNull()
    // ⛔ …and an AGENT's — even one a person stands behind, which is the arm that most looks like one.
    const anAgent: TurnOrigin = {
      who: 'a-caller-with-an-id',
      caller: 'sess_pm',
      profile: 'pm',
      aPersonIsBehindIt: true,
    }
    expect(aPersonsCompaction('/compact', anAgent)).toBeNull()
    expect(aPersonsCompaction('/compactor', person)).toBeNull()
    expect(aPersonsCompaction('please /compact', person)).toBeNull()
  })
})
