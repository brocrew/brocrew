import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppDatabase } from '../src/main/db/connection'
import type { SessionStore } from '../src/main/db/session-store'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import { howWorkStopped } from '../src/shared/how-work-stopped'
import type { ActedBy } from '../src/shared/who-did-it'
import { derivePieces } from '../src/shared/tasks'
import type { PersistedEventInfo, TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  aHostOverScriptedCodex,
  waitFor,
  Window,
  type ScriptedAppServer,
} from './lib/scripted-codex-host'

/**
 * # 🔴 723 · what a card's press does, said by main — R81, and R80's card on the wire
 *
 * ## R81 (`720` F-B) · a card whose press cannot stop the turn does not say it will
 *
 * ⚑ *"When the frame names no turn, its line says only what the press does (the request is
 * cancelled; the turn is not asked to stop), and the host records no ask."* ⚑ **Main's half**: the
 * card carries `cancelStopsNothing`, and the one writer of a person's cancel —
 * `RuntimeHost.respondPermission` — marks the row `stopsNothing`, which every reader of an ask passes
 * over. ⛔ **Measured on `main` by §2**: the row was a plain `cancel`, and `howWorkStopped`,
 * `deriveTasks` (`derivePieces` since D-016) and `AgentCard.lastAskToStop` all named the person as
 * having asked the running turn to stop — though Codex was asked nothing. ⚠️ The words under the
 * button are the frontend's.
 * 🔴 **736 · R97** — every elicitation card is such a card now, whether or not its frame named a
 * turn: BroBot adds no stop of its own to a Cancel. ⚑ The door whose Cancel still asks is a command
 * or file approval's (Codex's own `{decision:'cancel'}`, latched), so §1's and §2's controls use one.
 *
 * ## R80 (`720` F-A) · the card for Codex's own approval survives the wire
 *
 * ⚠️ **The runtime package tests the card; this tests that the HOST's wire keeps it.** `toWireEvent`
 * parses every event against the runtime's schema and strips any key it does not declare, so a card
 * field the schema forgot would reach no window, and only a test past that door can see it.
 *
 * ⚑ The REAL `CodexRuntime`, over an app-server scripted like one (`709`'s rig).
 */

/** Codex's own approval of an MCP tool call, as the bundled 0.146.0 sends it (`probe:codex-mcp-tool-approval`). */
const CODEX_ASKS = {
  serverName: 'brobot723',
  mode: 'form',
  _meta: {
    codex_approval_kind: 'mcp_tool_call',
    persist: ['session', 'always'],
    tool_params: { note: 'one' },
    tool_params_display: [{ name: 'note', value: 'one', display_name: 'note' }],
  },
  message: 'Allow the brobot723 MCP server to run tool "note_it"?',
  requestedSchema: { type: 'object', properties: {} },
}

/** A server's own `url` elicitation — the card whose only answers are the two refusals. */
const A_SERVER_ASKS = {
  serverName: 'kibana',
  mode: 'url',
  _meta: null,
  message: 'Sign in here first.',
  url: 'https://example.invalid/auth',
  elicitationId: 'e1',
}

describe('723 · a press that stops nothing says so, and R80’s card reaches the window', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let servers: ScriptedAppServer[]
  const window = new Window('webContents:1')

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-723-press-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-723-press-root-'))
    window.messages.length = 0
    ;({ host, db, store, servers } = aHostOverScriptedCodex(userData, { interruptWaitMs: 40 }))
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const aRunningTurn = async (): Promise<{ id: string; server: ScriptedAppServer }> => {
    const { sessionId: id } = await host.createSession(
      { provider: 'codex', approvalMode: 'ask', cwd: root },
      window,
    )
    const server = servers.at(-1)
    if (server === undefined) throw new Error('no app-server was opened')
    await host.send(id, 'look something up', window)
    await waitFor(() => server.sent('turn/start').length === 1, 'the first turn')
    await new Promise((resolve) => setTimeout(resolve, 20))
    return { id, server }
  }

  const ledger = (id: string): TranscriptEvent[] => store.events(id).map((entry) => entry.event)
  const decisions = (id: string): TranscriptEvent[] =>
    ledger(id).filter((event) => event.type === 'user_decision')
  const cardsSent = (): Extract<TranscriptEvent, { type: 'permission_request' }>[] =>
    window.messages
      .map((message) => message.event)
      .filter(
        (event): event is Extract<TranscriptEvent, { type: 'permission_request' }> =>
          event.type === 'permission_request',
      )

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §1 · R81 on the product path — the card, the press, the row
  // ─────────────────────────────────────────────────────────────────────────────────────────

  it('🔴 §1 · a card from a frame that named NO turn reaches the window marked, and its Cancel is recorded as NO ask', async () => {
    const { id, server } = await aRunningTurn()
    server.raise(50, 'mcpServer/elicitation/request', { ...A_SERVER_ASKS, turnId: null })
    await waitFor(() => cardsSent().length === 1, 'the card')
    // ⚑ The marker crossed the wire — the schema declares it, so `toWireEvent` kept it.
    expect(cardsSent()[0]?.cancelStopsNothing).toBe(true)
    await host.respondPermission(id, 'number:50', { outcome: 'cancel' }, window)
    // ⛔ **On `main` this row is a plain `cancel`**, which every reader below took as an ask.
    expect(decisions(id)).toEqual([
      {
        type: 'user_decision',
        requestId: 'number:50',
        outcome: 'cancel',
        by: { who: 'a-person' },
        stopsNothing: true,
      },
    ])
    // ⚑ …and the store's own read of the last ask does not find one.
    expect(store.lastAskToStop(id)).toBeNull()
    // ⚑ …and the raw Events index says so, rather than print it as the ask it is not (review).
    expect(describeEvent(decisions(id)[0] as TranscriptEvent)).toBe(
      'number:50 · cancel · asked nothing · a person (ours)',
    )
    // ⚑ The press asked Codex nothing — the marker and the press agree.
    expect(server.sent('turn/interrupt')).toEqual([])
  })

  it('🔴 736 · R97 — §1 · the same card from a frame that NAMED its turn is marked too, and its Cancel is the answer and nothing else — ⚑ the control is a COMMAND approval, whose Cancel still is an ask', async () => {
    // ⛔ On `main`: this card carried no marker, its Cancel was recorded as a person's ask, and the
    // adapter also sent `turn/interrupt` to the frame's turn (R74).
    const { id, server } = await aRunningTurn()
    server.raise(51, 'mcpServer/elicitation/request', A_SERVER_ASKS)
    await waitFor(() => cardsSent().length === 1, 'the card')
    expect(cardsSent()[0]?.cancelStopsNothing).toBe(true)
    await host.respondPermission(id, 'number:51', { outcome: 'cancel' }, window)
    expect(decisions(id)).toEqual([
      {
        type: 'user_decision',
        requestId: 'number:51',
        outcome: 'cancel',
        by: { who: 'a-person' },
        stopsNothing: true,
      },
    ])
    expect(store.lastAskToStop(id)).toBeNull()
    // ⚑ What Codex was sent: the elicitation's own cancel, and nothing else.
    expect(server.responses).toEqual([
      { id: 51, result: { action: 'cancel', content: null, _meta: null } },
    ])
    // ⚑ **THE CONTROL, one door over** — a command approval in the same running turn: no marker,
    // and its Cancel IS an ask (the latch; Codex ends that turn itself). ⚠️ Its answer is written
    // after the elicitation's handler has run on, so the absence of `turn/interrupt` below is read
    // after the point where `main` sent it.
    server.raise(52, 'item/commandExecution/requestApproval', { itemId: 'i52', command: 'ls' })
    await waitFor(() => cardsSent().length === 2, 'the command card')
    expect(cardsSent()[1]?.cancelStopsNothing).toBeUndefined()
    await host.respondPermission(id, 'number:52', { outcome: 'cancel' }, window)
    expect(decisions(id).at(-1)).toEqual({
      type: 'user_decision',
      requestId: 'number:52',
      outcome: 'cancel',
      by: { who: 'a-person' },
    })
    expect(store.lastAskToStop(id)).toMatchObject({ by: 'a-person', asker: null })
    expect(server.responses.at(-1)).toEqual({ id: 52, result: { decision: 'cancel' } })
    expect(server.sent('turn/interrupt')).toEqual([])
  })

  it('⚑ §1 CONTROL · a DENY on the marked card is recorded as it always was — the marker is about a Cancel', async () => {
    const { id, server } = await aRunningTurn()
    server.raise(52, 'mcpServer/elicitation/request', { ...A_SERVER_ASKS, turnId: null })
    await waitFor(() => cardsSent().length === 1, 'the card')
    await host.respondPermission(id, 'number:52', { outcome: 'deny' }, window)
    expect(decisions(id)).toEqual([
      { type: 'user_decision', requestId: 'number:52', outcome: 'deny', by: { who: 'a-person' } },
    ])
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the readers of an ask, where the two readings DIVERGE
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · every reader of an ask passes a cancel that stopped nothing', () => {
    let ordinal = 0
    const row = (event: TranscriptEvent): PersistedEventInfo => ({
      ordinal: ordinal++,
      at: 1_700_000_000_000 + ordinal * 1_000,
      event,
    })
    const person: ActedBy = { who: 'a-person' }
    const assigned: TranscriptEvent = {
      type: 'work_given',
      piece: 'work_1',
      label: 'W1.1',
      parent: 'work_root',
      givenBy: 'sess_pm',
      title: 'the work',
      brief: 'the work',
    }
    const cancelled = (stopsNothing: boolean): TranscriptEvent =>
      ({
        type: 'user_decision',
        requestId: 'number:50',
        outcome: 'cancel',
        by: person,
        ...(stopsNothing ? { stopsNothing: true } : {}),
      }) as TranscriptEvent

    it('🔴 an AGENT asked, then a person cancelled a card that stopped nothing — the agent’s ask stands', () => {
      // ⛔ **The divergence** (standing rule 3): read as an ask, the cancel names the PERSON; passed
      // over, the agent's earlier ask is the last one — *the last ask wins*, and this was none.
      ordinal = 0
      const entries = [
        row(assigned),
        row({ type: 'work_interrupted', by: 'an-agent', agent: 'sess_pm' }),
        row(cancelled(true)),
        row({ type: 'turn', state: 'interrupted' }),
      ]
      expect(derivePieces('sess_worker', entries)[0]).toMatchObject({
        stalledBecause: 'turn_interrupted',
        stalledBy: { by: 'an-agent', asker: 'sess_pm' },
      })
      expect(howWorkStopped(entries)).toMatchObject({ who: 'an-agent', asker: 'sess_pm' })
    })

    it('⚑ CONTROL · the same ledger one fact over — a cancel that ASKED — names the person', () => {
      ordinal = 0
      const entries = [
        row(assigned),
        row({ type: 'work_interrupted', by: 'an-agent', agent: 'sess_pm' }),
        row(cancelled(false)),
        row({ type: 'turn', state: 'interrupted' }),
      ]
      expect(derivePieces('sess_worker', entries)[0]).toMatchObject({
        stalledBy: { by: 'a-person', asker: null },
      })
      expect(howWorkStopped(entries)).toMatchObject({ who: 'a-person', asker: null })
    })

    it('🔴 alone, it is NOBODY’s ask — a turn that ended after it names no one', () => {
      ordinal = 0
      const entries = [
        row(assigned),
        row(cancelled(true)),
        row({ type: 'turn', state: 'completed' }),
      ]
      expect(derivePieces('sess_worker', entries)[0]).toMatchObject({
        stalledBecause: 'turn_ended',
        stalledBy: null,
      })
      expect(howWorkStopped(entries)).toMatchObject({ who: null })
    })

    it('🔴 the store’s last ask passes it for the REAL ask behind it — and the control finds the newer one', async () => {
      // ⚑ **All through the host's own doors.** A person's Stop that Codex does not answer leaves the
      // turn running, so a server can still ask; a Cancel on a card whose frame named no turn is then
      // the NEWEST row. ⛔ Read as an ask it would answer; passed over, the Stop does.
      const { id, server } = await aRunningTurn()
      server.interruptAnswer = 'never'
      await host.interrupt(id, window)
      const theStop = store.lastAskToStop(id)
      expect(theStop).toMatchObject({ by: 'a-person' })
      await new Promise((resolve) => setTimeout(resolve, 15))
      server.raise(53, 'mcpServer/elicitation/request', { ...A_SERVER_ASKS, turnId: null })
      await waitFor(() => cardsSent().length === 1, 'the card that named no turn')
      await host.respondPermission(id, 'number:53', { outcome: 'cancel' }, window)
      expect(decisions(id).at(-1)).toMatchObject({ outcome: 'cancel', stopsNothing: true })
      expect(store.lastAskToStop(id)?.at).toBe(theStop?.at)
      // ⚑ **One fact over**: a Cancel that DOES ask — its row is the newest ask. ⚑ 736 · R97 — no
      // elicitation card's Cancel asks now (the one whose frame named the turn is marked too), so
      // the control is a command approval's Cancel, the door whose Cancel still is an ask.
      await new Promise((resolve) => setTimeout(resolve, 15))
      server.raise(54, 'item/commandExecution/requestApproval', { itemId: 'i54', command: 'ls' })
      await waitFor(() => cardsSent().length === 2, 'the command card')
      await host.respondPermission(id, 'number:54', { outcome: 'cancel' }, window)
      const newest = store.lastAskToStop(id)
      expect(newest?.by).toBe('a-person')
      expect(newest?.at).toBeGreaterThan(theStop?.at ?? Number.POSITIVE_INFINITY)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §3 · R80 — Codex's own approval, through the host's wire and back
  // ─────────────────────────────────────────────────────────────────────────────────────────

  it('🔴 §3 · R80 — Codex’s own approval reaches the window as a card that NAMES the call, and the grant goes back scoped', async () => {
    const { id, server } = await aRunningTurn()
    // ⚑ Codex's own item for the call comes first, as measured — the card is tied to it.
    server.announce('item/started', {
      item: {
        type: 'mcpToolCall',
        id: 'call_1',
        server: 'brobot723',
        tool: 'note_it',
        status: 'inProgress',
        arguments: { note: 'one' },
        appContext: null,
        result: null,
        error: null,
        durationMs: null,
      },
    })
    server.raise(60, 'mcpServer/elicitation/request', CODEX_ASKS)
    // ⛔ **On `main` no card reaches the window**: the adapter declined it with none.
    await waitFor(() => cardsSent().length === 1, 'the card')
    const card = cardsSent()[0]
    expect(card?.mcpToolCall).toEqual({
      server: 'brobot723',
      tool: 'note_it',
      parameters: [{ name: 'note', value: 'one' }],
    })
    // ⚑ 736 · R95 — Codex offered `always`, so the card offers *Always allow* too…
    expect(card?.scope.availableDecisions).toEqual([
      'allow',
      'allow_all_for_session',
      'allow_always',
      'deny',
      'cancel',
    ])
    // ⚑ …and what each standing button installs crosses the wire with it (R94): the schema declares
    // `scope.grants`, so `toWireEvent` kept it — the kept file is in this conversation's home.
    expect(card?.scope.grants).toEqual({
      allow_all_for_session: [{ kind: 'tool', tool: 'note_it', server: 'brobot723' }],
      allow_always: [{ kind: 'tool', tool: 'note_it', server: 'brobot723' }],
      alwaysFile: join(server.home, 'brobot-kept-tool-approvals.json'),
    })
    await host.respondPermission(id, 'number:60', { outcome: 'allow_all_for_session' }, window)
    expect(server.responses).toEqual([
      { id: 60, result: { action: 'accept', content: {}, _meta: { persist: 'session' } } },
    ])
    expect(decisions(id)).toEqual([
      {
        type: 'user_decision',
        requestId: 'number:60',
        outcome: 'allow_all_for_session',
        by: { who: 'a-person' },
      },
    ])
    // ⚑ …and the grant reaches the window's state, where the header shows it (`723`'s review).
    await waitFor(
      () => (window.liveness.at(-1)?.liveness.approval?.blanketGrants ?? []).length > 0,
      'the grant in the window’s state',
    )
    expect(window.liveness.at(-1)?.liveness.approval?.blanketGrants).toEqual([
      'mcp__brobot723__note_it',
    ])
  })

  it('🔴 §3 CONTROL, 728 re-aimed · a server’s own zero-field form reaches the window as the SERVER’s card, and Allow goes back as `accept`', async () => {
    // ⛔ `723` pinned the opposite here — *"still reaches NO window, and is declined"* — `142` §2's
    // gate, which R93 removed (`728`): the Codex CLI's own terminal UI shows this form with Allow,
    // Deny and Cancel. ⚑ What `723`'s control still pins is WHOSE card it is: the server's, naming
    // no call, never Codex's approval.
    const { id, server } = await aRunningTurn()
    server.raise(61, 'mcpServer/elicitation/request', { ...CODEX_ASKS, _meta: null })
    await waitFor(() => cardsSent().length === 1, 'the server’s card')
    const card = cardsSent()[0]
    expect(card?.mcpToolCall).toBeUndefined()
    expect(card?.action).toBe('brobot723')
    expect(card?.scope.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
    expect(server.responses).toEqual([])
    await host.respondPermission(id, 'number:61', { outcome: 'allow' }, window)
    expect(server.responses).toEqual([
      { id: 61, result: { action: 'accept', content: {}, _meta: null } },
    ])
  })
})
