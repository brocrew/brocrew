import { describe, expect, it, vi } from 'vitest'
import { type RuntimeEvent } from '../src/index'
import { CodexSessionHandle } from '../src/codex'
import { completedTurn, turnCompletedNotification } from './fixtures/codex-protocol'
import {
  FakeTransport,
  firstOfType,
  has,
  startCodex,
  startCodexInTurn,
} from './helpers/fake-codex-transport'

/**
 * ⛔ **200 · scope by what the frame carries, not by its name.**
 *
 * 192 filed two HIGHs about the Codex scope predicate; an adversarial re-read downgraded both to
 * `PARTLY_CONFIRMED`/`MEDIUM` and found they share ONE root cause — thread scope was decided by
 * method-name MEMBERSHIP (`TURN_SCOPED_METHODS`), so everything outside those nine names got no
 * correlation at all, including methods whose generated type declares `threadId` REQUIRED. That set
 * had been widened reactively in 027, 028 and 184, and this is the dispatch that stopped widening it.
 *
 * ⚠️ **These assertions are the coverage that was missing, not decoration.** Before them, the only
 * end-to-end evidence that a foreign thread was refused anywhere was ONE test about
 * `serverRequest/resolved` — and, in the other direction, **nothing in this repo drove
 * `thread/status/changed` through a handle at all**. `codex-sub-agents.test.ts` feeds the tracker
 * directly, so implementing this dispatch's §1a as written — drop every frame naming another thread
 * — would have deleted every sub-agent ending in the app with the whole suite still green. That is
 * 193's vacuity subject on a live boundary, and the exemption below is why it did not happen.
 */
describe('CodexSessionHandle — thread scope, by what the frame carries (200)', () => {
  /** Somebody else's conversation, on our connection. */
  const OTHER = 'th_SOMEBODY_ELSE'
  /**
   * The prompting profile a conformant `thread/settings/updated` echoes — anything else fails closed.
   * ⚑ 736 · R96 — its sandbox is `workspaceWrite` (was `readOnly`).
   */
  const PROMPTING = {
    approvalsReviewer: 'user',
    approvalPolicy: 'on-request',
    sandboxPolicy: { type: 'workspaceWrite' },
  }
  /** A one-file git diff, in the format `parseUnifiedDiff` reads. */
  const diffOf = (path: string, line: string): string =>
    [
      `diff --git a/${path} b/${path}`,
      'index 0000000..1111111 100644',
      `--- a/${path}`,
      `+++ b/${path}`,
      '@@ -0,0 +1 @@',
      `+${line}`,
    ].join('\n')

  const scope = (handle: unknown): { seen: number; dropped: number } =>
    (handle as CodexSessionHandle).frameScope

  /**
   * A barrier, not a sleep. The transport is ordered and `onNotification` is synchronous, so once a
   * marker sent AFTER the frames under test has been observed, those frames have been processed and
   * "nothing arrived" is a fact rather than a race. ⚠️ The marker carries no ids, so the gate cannot
   * drop it — a barrier the fix could silence would assert nothing.
   */
  async function barrier(
    transport: FakeTransport,
    events: RuntimeEvent[],
    tag: string,
  ): Promise<void> {
    transport.notification(`marker/${tag}`, {})
    await vi.waitFor(has(events, (e) => e.type === 'unknown' && e.label === `marker/${tag}`))
  }

  it('⛔ a frame naming a FOREIGN thread is dropped — for all four methods 192 named', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    // Four methods, four different consequences, none of them this conversation's business. The
    // settings one carries a NON-prompting profile, which is the serious half of 192 H3: reaching
    // `checkSettingsProfile` it becomes `finishUnexpected` + `transport.close()`, so a foreign
    // thread could KILL this session.
    transport.notification('error', {
      threadId: OTHER,
      turnId,
      error: { message: 'somebody else exploded', codexErrorInfo: 'unauthorized' },
    })
    transport.notification('turn/diff/updated', {
      threadId: OTHER,
      turnId,
      diff: diffOf('their/secret.ts', 'not ours'),
    })
    transport.notification('thread/settings/updated', {
      threadId: OTHER,
      threadSettings: { ...PROMPTING, approvalPolicy: 'never', model: 'foreign-model' },
    })
    transport.notification('model/rerouted', {
      threadId: OTHER,
      turnId,
      fromModel: 'gpt-5',
      toModel: 'foreign-model',
      reason: 'highRiskCyberActivity',
    })
    await barrier(transport, events, 'foreign')

    expect(events.filter((e) => e.type === 'error')).toEqual([])
    expect(events.filter((e) => e.type === 'file_change')).toEqual([])
    expect((handle as CodexSessionHandle).agentInfo?.model).not.toBe('foreign-model')
    // ⛔ The one that bites: the session is still alive and the transport was never torn down.
    // ⚠️ **Both terminal states, not just `ended`** — `finishUnexpected` terminalizes as `errored`,
    // so a check for `ended` alone would have let a killed session through. The mutation aimed at
    // this line found that out (200 M4, second occupant).
    expect(['ended', 'errored']).not.toContain(handle.status())
    expect(transport.closeCount).toBe(0)
    expect(scope(handle).dropped).toBe(4)

    await handle.close()
    await consumer
  })

  it('⚠️ …and the SAME four naming THIS thread all arrive — the paired positive', async () => {
    // Without this, the drop above is equally satisfied by an adapter that handles none of them.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    transport.notification('error', {
      threadId: 'th_1',
      turnId,
      error: { message: 'ours exploded' },
    })
    transport.notification('turn/diff/updated', {
      threadId: 'th_1',
      turnId,
      diff: diffOf('ours.ts', 'ours'),
    })
    transport.notification('thread/settings/updated', {
      threadId: 'th_1',
      threadSettings: { ...PROMPTING, model: 'ours-model' },
    })
    transport.notification('model/rerouted', {
      threadId: 'th_1',
      turnId,
      fromModel: 'gpt-5',
      toModel: 'rerouted-model',
      reason: 'highRiskCyberActivity',
    })
    await barrier(transport, events, 'ours')

    const messages = events.flatMap((e) => (e.type === 'error' ? [e.message] : []))
    expect(messages.some((m) => m.includes('ours exploded'))).toBe(true)
    expect(messages.some((m) => m.includes('rerouted-model'))).toBe(true)
    expect(firstOfType(events, 'file_change').changes.map((c) => c.path)).toEqual(['ours.ts'])
    // `thread/settings/updated` reports the live model, and the reroute overwrites it afterwards —
    // both reached `mergeAgentInfo`, which is what this asserts.
    expect((handle as CodexSessionHandle).agentInfo?.model).toBe('rerouted-model')
    expect(scope(handle).dropped).toBe(0)

    await handle.close()
    await consumer
  })

  it('⛔ the sub-agent ending SURVIVES the gate — the frame whose threadId is its subject', async () => {
    // ⚠️ **This is the correction 200 made to its own brief, and the test that would have caught
    // implementing it verbatim.** `ThreadStatusChangedNotification` declares `threadId` non-nullable
    // and the id it carries is the CHILD's — it is what ends a sub-agent card (033), and before 226
    // it was also the only evidence a grandchild existed (135). A universal "drop every foreign
    // thread" would have dropped every one of them, and no existing test drives this method through
    // a handle. ⚠️ **226 measured a second frame that does the same job** — the child's own
    // `turn/completed`, which says HOW it ended; see the block at the foot of this file.
    const ALPHA = 'th_alpha_child'
    const GRANDCHILD = 'th_grandchild'
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    const birth = {
      item: {
        type: 'subAgentActivity',
        id: 'call_alpha',
        kind: 'started',
        agentThreadId: ALPHA,
        agentPath: 'alpha',
      },
      threadId: 'th_1',
      turnId,
    }
    // Verbatim capture order: the empty child reports `idle` BEFORE it is announced.
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'idle' } })
    transport.notification('item/started', birth)
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'active' } })
    // 135's grandchild: announced to nobody on this connection, and known only by going active.
    transport.notification('thread/status/changed', {
      threadId: GRANDCHILD,
      status: { type: 'active' },
    })
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'idle' } })
    await barrier(transport, events, 'children')

    const cards = events.flatMap((e) => (e.type === 'sub_agent' ? [`${e.agentId}:${e.phase}`] : []))
    expect(cards).toEqual([
      `${ALPHA}:started`,
      `${ALPHA}:progress`,
      `${GRANDCHILD}:started`,
      `${ALPHA}:ended`,
    ])
    // ⚑ Nothing was dropped: every one of those frames named a thread that is not ours.
    expect(scope(handle).dropped).toBe(0)

    await handle.close()
    await consumer
  })

  it('⛔ an OUT-OF-TURN credential error is still delivered — the assertion that stops the next widening', async () => {
    // 192 asked for `error` to join the turn-scoped set. ⛔ Refused, and this is why:
    // `isCurrentProviderTurn` is false whenever there is no live turn, so a gated `error` arriving
    // between turns is silently dropped — including the one that says the credential was rejected
    // and the session can never run. There is no turn open here at all.
    const { transport, handle, events, consumer } = await startCodex()
    expect(handle.status()).not.toBe('working')
    transport.notification('error', {
      threadId: 'th_1',
      turnId: 'tn_none',
      error: { message: 'Unauthorized: your sign-in has expired', codexErrorInfo: 'unauthorized' },
    })
    await vi.waitFor(has(events, (e) => e.type === 'error' && e.cause === 'auth'))
    expect(firstOfType(events, 'error').message).toContain('sign-in has expired')

    await handle.close()
    await consumer
  })

  it('⛔ a STALE `turn/diff/updated` cannot overwrite the running turn — and the live one still wins', async () => {
    // Each payload is a FULL SNAPSHOT and `foldChanges` is later-record-wins by path, so a late
    // frame from a finished turn does not add a stale row — it REPLACES the running turn's.
    const { transport, handle, events, consumer } = await startCodex()
    await handle.send('one')
    transport.notification('turn/diff/updated', {
      threadId: 'th_1',
      turnId: 'tn_1',
      diff: diffOf('one.ts', 'from turn one'),
    })
    await vi.waitFor(has(events, (e) => e.type === 'file_change'))
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'completed'))

    await handle.send('two')
    // The stale frame: turn one's id, turn one's snapshot, arriving while turn two runs.
    transport.notification('turn/diff/updated', {
      threadId: 'th_1',
      turnId: 'tn_1',
      diff: diffOf('one.ts', 'from turn one, restated late'),
    })
    await barrier(transport, events, 'stale-diff')
    expect(events.filter((e) => e.type === 'file_change')).toHaveLength(1)

    // ⚠️ The paired positive on the same path: turn TWO's own later snapshot still arrives.
    transport.notification('turn/diff/updated', {
      threadId: 'th_1',
      turnId: 'tn_2',
      diff: diffOf('two.ts', 'from turn two'),
    })
    await vi.waitFor(
      has(events, (e) => e.type === 'file_change' && e.changes[0]?.path === 'two.ts'),
    )

    await handle.close()
    await consumer
  })

  it('⛔ `account/rateLimits/updated` still arrives — its type carries NO ids at all', async () => {
    // ⚑ The refusal of "just gate every first-class method". `AccountRateLimitsUpdatedNotification`
    // is `{ rateLimits }` and nothing else, by design: it describes the ACCOUNT, not a thread. It
    // passes on the absence rule, and it must — it is the only warning before the weekly wall (177).
    const { transport, handle, events, consumer } = await startCodex()
    transport.notification('account/rateLimits/updated', {
      rateLimits: {
        limitId: 'codex',
        primary: { usedPercent: 96, windowDurationMins: 300, resetsAt: 4_000_000_000 },
        secondary: null,
      },
    })
    await vi.waitFor(has(events, (e) => e.type === 'error' && e.message.includes('96%')))
    expect(scope(handle).dropped).toBe(0)

    await handle.close()
    await consumer
  })

  it('⚑ the counter reads what the gate refused AGAINST what the transport delivered (§3)', async () => {
    // ⚠️ Without the denominator, a gate that started dropping frames and a provider that stopped
    // sending them read identically — and they have opposite remedies. 184's precedent: gating must
    // not seal the evidence that gating was needed.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // The handshake and `turn/start` are REQUESTS, not notifications, so the count starts at zero
    // and every increment below is a frame this test put on the wire.
    const before = scope(handle).seen
    expect(before).toBe(0)
    transport.notification('error', { threadId: OTHER, error: { message: 'theirs' } })
    transport.notification('error', { threadId: OTHER, error: { message: 'theirs again' } })
    transport.notification('turn/diff/updated', {
      threadId: OTHER,
      turnId: 'tn_1',
      diff: diffOf('theirs.ts', 'x'),
    })
    await barrier(transport, events, 'counted')

    const after = (handle as CodexSessionHandle).frameScope
    expect(after.dropped).toBe(3)
    // The marker was SEEN and not dropped: the denominator counts frames the gate let through too.
    expect(after.seen).toBe(before + 4)
    expect(after.byMethod).toEqual({ error: 2, 'turn/diff/updated': 1 })

    await handle.close()
    await consumer
  })

  it('🔒 the counter is BOUNDED — its key comes off the wire (052)', async () => {
    // A diagnostic that a provider can grow without limit is a leak, and `notificationCategory`
    // already assumes nothing about how many method names exist. Past the cap the tally stays exact
    // and only the attribution is given up, which is the half that matters least.
    const { transport, handle, events, consumer } = await startCodex()
    for (let i = 0; i < 50; i++) {
      transport.notification(`invented/method${i}`, { threadId: OTHER })
    }
    await barrier(transport, events, 'bounded')

    const after = (handle as CodexSessionHandle).frameScope
    expect(after.dropped, 'every drop is still counted').toBe(50)
    expect(Object.keys(after.byMethod).length, 'but not every one is named').toBeLessThanOrEqual(33)
    expect(after.byMethod['(other)']).toBe(50 - 32)

    await handle.close()
    await consumer
  })
})

/**
 * Child-thread frames report names, ancestry, token usage, outcomes and durations, including
 * depth-two agents. They remain excluded from parent content but must reach the report tracker.
 * Exercise the real handle: testing CodexSubAgents alone cannot detect a gate that drops reports.
 */
describe('CodexSessionHandle — a child reports on itself (226)', () => {
  /** This session's own thread, as `startCodex` binds it. */
  const OURS = 'th_1'
  /** A child of ours, announced on our thread. */
  const ALPHA = 'th_alpha'
  /** A child of ALPHA's, announced on ALPHA's thread — 135's grandchild, with a name. */
  const GAMMA = 'th_gamma'
  /** Somebody else's conversation. Never a child, and the reason this is not a hole. */
  const STRANGER = 'th_stranger'

  const scope = (handle: unknown): { seen: number; dropped: number; adopted: number } =>
    (handle as CodexSessionHandle).frameScope

  /**
   * A birth announcement, on whichever thread announced it.
   *
   * ⚠️ **`turnId` is the caller's, and on OUR thread it must be the BOUND one.** `item/started` is
   * turn-scoped content: a birth carrying some other turn's id is refused before the tracker ever
   * sees it, the child is then known only by going active, and the card that results is the
   * `observed` one this dispatch exists to stop producing. These fixtures had exactly that mistake
   * on their first run, and it passed three of five assertions — which is what a fixture that
   * reaches the wrong branch looks like from the outside.
   */
  const birthOn = (
    threadId: string,
    agentThreadId: string,
    agentPath: string,
    turnId = 'tn_child',
  ): unknown => ({
    item: {
      type: 'subAgentActivity',
      id: `call_${agentThreadId}`,
      kind: 'started',
      agentThreadId,
      agentPath,
    },
    threadId,
    turnId,
  })

  const usageOn = (threadId: string, totalTokens: number): unknown => ({
    threadId,
    turnId: 'tn_child',
    tokenUsage: {
      total: { totalTokens, inputTokens: totalTokens, outputTokens: 0 },
      // ⚠️ Deliberately larger than `total`, which cannot happen on the wire: it is here so a
      // reading of the wrong field is a visible number rather than a coincidence.
      last: { totalTokens: totalTokens * 10, inputTokens: 0, outputTokens: 0 },
      modelContextWindow: 258_400,
    },
  })

  const completedOn = (
    threadId: string,
    status: string,
    durationMs: number | null,
    turnId = 'tn_child',
  ): unknown => ({
    threadId,
    turn: { id: turnId, items: [], itemsView: 'summary', status, error: null, durationMs },
  })

  /** The child announcing which of its own turns it is on — the correlation an outcome is checked against. */
  const startedOn = (threadId: string, turnId: string): unknown => ({
    threadId,
    turn: {
      id: turnId,
      items: [],
      itemsView: 'notLoaded',
      status: 'inProgress',
      error: null,
      durationMs: null,
    },
  })

  async function barrier(
    transport: FakeTransport,
    events: RuntimeEvent[],
    tag: string,
  ): Promise<void> {
    transport.notification(`marker/${tag}`, {})
    await vi.waitFor(has(events, (e) => e.type === 'unknown' && e.label === `marker/${tag}`))
  }

  const subAgents = (events: RuntimeEvent[]): Extract<RuntimeEvent, { type: 'sub_agent' }>[] =>
    events.filter((e): e is Extract<RuntimeEvent, { type: 'sub_agent' }> => e.type === 'sub_agent')

  it('⛔ the GRANDCHILD is announced, named and parented — 225 finding 1, at its cause', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // Capture order, verbatim: the empty thread reports `idle` before it is announced, and the
    // grandchild's birth lands on ALPHA's thread rather than ours.
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'idle' } })
    transport.notification(
      'item/started',
      birthOn(OURS, ALPHA, '/root/alpha', transport.lastTurnId),
    )
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'active' } })
    transport.notification('thread/status/changed', { threadId: GAMMA, status: { type: 'idle' } })
    transport.notification('item/started', birthOn(ALPHA, GAMMA, '/root/alpha/gamma'))
    // ⛔ **The byte-identical repeat 033 was dispatched over**, and it arrives for a grandchild
    // exactly as it does for a child: `item/started` and `item/completed` carry the same item, so
    // reading both announces every descendant twice.
    transport.notification('item/completed', birthOn(ALPHA, GAMMA, '/root/alpha/gamma'))
    transport.notification('thread/status/changed', { threadId: GAMMA, status: { type: 'active' } })
    await barrier(transport, events, 'grandchild')

    const gamma = subAgents(events).filter((e) => e.agentId === GAMMA)
    // Born from the announcement, then working from its own status — the same two events a
    // depth-1 child produces, which is the point.
    expect(gamma.map((e) => e.phase)).toEqual(['started', 'progress'])
    // ⛔ The four blanks 225 reported, all four now answered by the provider's own words.
    expect(gamma[0]?.kind, 'the name the model coined, lineage and all').toBe('alpha/gamma')
    expect(gamma[0]?.parentToolCallId, 'the call that dispatched it').toBe(`call_${GAMMA}`)
    expect(gamma[0]?.idKind).toBe('thread')
    // ⛔ **NOT observed.** `origin: 'observed'` is what makes the card say `nested agent` and
    // `nested — parent not reported`; a card that carries a name must not also carry that.
    expect(gamma[0]?.origin).toBeUndefined()
    // ⚑ Its own `active` did not open a SECOND card: `report` registered it, so `status` finds it.
    expect(
      subAgents(events).filter((e) => e.agentId === GAMMA && e.phase === 'started'),
    ).toHaveLength(1)
    // The accounting: the birth frame was still refused as content, and counted as adopted once.
    // Both birth frames were refused as content; only the first was read as an announcement.
    expect(scope(handle).dropped, "the child's frames are still not our content").toBe(2)
    expect(scope(handle).adopted, 'the repeat announced nothing').toBe(1)

    await handle.close()
    await consumer
  })

  it('⛔ the outcome and the usage reach the card — and the idle that precedes them still ends it', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'item/started',
      birthOn(OURS, ALPHA, '/root/alpha', transport.lastTurnId),
    )
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'active' } })
    transport.notification('thread/tokenUsage/updated', usageOn(ALPHA, 34_483))
    // ⛔ **A reading with no `total` in it is not a zero.** `readNumber` refuses it and nothing is
    // emitted, so a malformed frame cannot write `0k tokens` over a real measurement.
    transport.notification('thread/tokenUsage/updated', { threadId: ALPHA, tokenUsage: {} })
    // ⚠️ **STARTED then COMPLETED, and the count must move once.** Counting the start would report
    // work the child has begun as work it has done — `074`'s reading, one surface over.
    transport.notification('item/started', {
      threadId: ALPHA,
      turnId: 'tn_child',
      item: { type: 'commandExecution', id: 'exec-1', command: 'uname -s', status: 'inProgress' },
    })
    transport.notification('item/completed', {
      threadId: ALPHA,
      turnId: 'tn_child',
      item: { type: 'commandExecution', id: 'exec-1', command: 'uname -s', status: 'completed' },
    })
    // ⛔ **A tool the child STARTED and never finished**, so the count below is a count of what it
    // has done rather than of what it reached for.
    transport.notification('item/started', {
      threadId: ALPHA,
      turnId: 'tn_child',
      item: { type: 'commandExecution', id: 'exec-2', command: 'sleep 60', status: 'inProgress' },
    })
    // …and a second one that DOES finish, so the count is proven to accumulate. `mergeUsage` keeps
    // the larger of what it holds, so a constant `1` would leave the card reading "1 tool" forever
    // — and every assertion below would still pass.
    transport.notification('item/completed', {
      threadId: ALPHA,
      turnId: 'tn_child',
      item: { type: 'fileChange', id: 'patch-1', status: 'completed' },
    })
    // ⛔ **A THIRD start with no completion, and the asymmetry is the whole point.** With two starts
    // and two completions, counting the wrong one gives the identical answer — `M14` survived its
    // first run for exactly that reason, the same shape as 224's `M8`. Three starts against two
    // completions is what makes the two readings distinguishable.
    transport.notification('item/started', {
      threadId: ALPHA,
      turnId: 'tn_child',
      item: { type: 'webSearch', id: 'search-1', query: 'anything', status: 'inProgress' },
    })
    // ⛔ **A NEGATIVE reading, which the schema would happily validate.** `usage` has no lower
    // bound, so a number that cannot be a measurement would survive `mergeUsage` and draw on the
    // card. It must be refused where it is read, and the honest blank is the fallback (111).
    transport.notification('thread/tokenUsage/updated', {
      threadId: ALPHA,
      tokenUsage: { total: { totalTokens: -1 }, last: { totalTokens: -1 } },
    })
    // ⚠️ **A frame this reader has no branch for, and the wire really sends it** — two per child in
    // the 226 capture. A child's thread is not a licence to read everything on it: an unhandled
    // method must contribute nothing rather than something shaped like progress.
    transport.notification('mcpServer/startupStatus/updated', {
      threadId: ALPHA,
      name: 'codex_apps',
      status: 'ready',
      error: null,
      failureReason: null,
    })
    // Measured order: `idle` lands ONE frame before `turn/completed`, so the ending arrives with no
    // outcome and the outcome follows it.
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'idle' } })
    // ⛔ **A reading that arrives AFTER the card ended.** `status` has refused to speak about a
    // closed card since 033, and the progress paths 226 added must refuse it for the same reason: a
    // `progress` for an ended card puts it back in `openSubAgents`, to be closed a second time at
    // the next turn boundary. Nothing in this run had exercised that, and `M25` survived on it.
    transport.notification('thread/tokenUsage/updated', usageOn(ALPHA, 999_999))
    transport.notification('turn/completed', completedOn(ALPHA, 'completed', 7610))
    await barrier(transport, events, 'ended')

    const alpha = subAgents(events).filter((e) => e.agentId === ALPHA)
    expect(alpha.map((e) => e.phase)).toEqual([
      'started',
      'progress',
      'progress',
      'progress',
      'progress',
      'ended',
      'ended',
    ])
    // ⛔ `total`, never `last` — the fixture's `last` is ten times larger precisely so this cannot
    // pass by accident.
    expect(alpha.find((e) => e.usage?.tokens)?.usage?.tokens).toBe(34_483)
    // ⛔ **Exactly one token reading reached the card, out of four sent.** The empty one carried no
    // number, the negative one carried one that cannot be a measurement, and the last one arrived
    // after the card had ended — so `999_999` must appear nowhere.
    const tokenReadings = alpha.filter((e) => e.usage?.tokens !== undefined)
    expect(tokenReadings.map((e) => e.usage?.tokens)).toEqual([34_483])
    // …and a count that MOVES, once per completion and never for the start beside it.
    const counted = alpha.filter((e) => e.usage?.toolCalls !== undefined)
    expect(counted.map((e) => e.usage?.toolCalls)).toEqual([1, 2])
    const last = alpha.at(-1)
    expect(last?.phase).toBe('ended')
    expect(last?.outcome).toBe('completed')
    expect(last?.usage?.ms).toBe(7610)
    // ⚑ **The counter, on the paths that are not a birth.** Four frames reported something — one
    // token reading, two tool completions, one outcome — and five did not: the empty reading, the
    // two tool STARTS, and the `mcpServer` frame nothing reads. Without this, `adopted` is only ever
    // proven to move on the announcement path.
    expect(scope(handle).adopted).toBe(4)
    // ⚠️ **Eleven refused, four of them read.** The two `thread/status/changed` frames are not in
    // either number: they are SUBJECT-method frames, so the gate never refuses them and they reach
    // `status()` whole. The counter is about the other kind.
    expect(scope(handle).dropped).toBe(11)

    // A repeat says nothing new: one outcome per child, however many times the provider sends it.
    transport.notification('turn/completed', completedOn(ALPHA, 'completed', 7610))
    await barrier(transport, events, 'repeat')
    expect(subAgents(events).filter((e) => e.agentId === ALPHA && e.outcome)).toHaveLength(1)
    // …and a frame that reported nothing is refused, not adopted.
    expect(scope(handle).adopted, 'a repeat is read and not counted').toBe(4)

    await handle.close()
    await consumer
  })

  it('⛔ a REPEATED `active` after an ending says nothing (transitions, not states)', async () => {
    // ⚠️ **The provider repeats a status freely** — that premise is why `working` exists. It mirrors
    // the status stream and nothing else, so anything that writes it from outside makes the next
    // repeat read as a fresh transition: a spurious `progress`, a cleared `ended`, and then a second
    // outcome-less `ended` on the following idle. `M28` survived until this test existed.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'item/started',
      birthOn(OURS, ALPHA, '/root/alpha', transport.lastTurnId),
    )
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'active' } })
    transport.notification('turn/started', startedOn(ALPHA, 'tn_one'))
    transport.notification('turn/completed', completedOn(ALPHA, 'completed', 1000, 'tn_one'))
    // The thread is still active as far as the status stream is concerned, so this changes nothing.
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'active' } })
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'idle' } })
    await barrier(transport, events, 'repeat-active')

    expect(subAgents(events).map((e) => `${e.phase}:${e.outcome ?? '-'}`)).toEqual([
      'started:-',
      'progress:-',
      'ended:completed',
    ])

    await handle.close()
    await consumer
  })

  it('⛔ a child that runs a SECOND turn reports how THAT one went', async () => {
    // ⚠️ **The flag that stops a repeat must not stop a sequel.** `turn/completed` is reported once
    // per ending, not once per child — a thread that goes active again is running another turn, and
    // that turn has an outcome of its own. `status`'s own comment already commits to this for the
    // ENDING (*"a child that goes active again … is reported as working again"*); an outcome flag
    // that stayed latched beside it would have made the two disagree.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'item/started',
      birthOn(OURS, ALPHA, '/root/alpha', transport.lastTurnId),
    )
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'active' } })
    transport.notification('turn/started', startedOn(ALPHA, 'tn_one'))
    transport.notification('turn/completed', completedOn(ALPHA, 'completed', 1000, 'tn_one'))
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'idle' } })
    // …and it is asked to do something else.
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'active' } })
    transport.notification('turn/started', startedOn(ALPHA, 'tn_two'))
    // ⛔ **A DELAYED frame from the first turn, arriving during the second.** It must not report
    // turn one's outcome — or turn one's duration — as turn two's. A boolean latch cleared on
    // `active` would have let this through; correlating on the turn id is what refuses it.
    transport.notification('turn/completed', completedOn(ALPHA, 'interrupted', 99_999, 'tn_one'))
    transport.notification('turn/completed', completedOn(ALPHA, 'failed', 2000, 'tn_two'))
    await barrier(transport, events, 'second-turn')

    const ended = subAgents(events).filter((e) => e.agentId === ALPHA && e.outcome)
    expect(ended.map((e) => e.outcome)).toEqual(['completed', 'failed'])
    // ⚑ And the duration is the child's whole life, not whichever turn was longest: 1000 + 2000,
    // with the stale frame's 99,999 nowhere in it.
    expect(ended.map((e) => e.usage?.ms)).toEqual([1000, 3000])

    await handle.close()
    await consumer
  })

  it('⛔ a child that FAILED says so, and `inProgress` fails closed (055, inherited)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const BETA = 'th_beta'
    transport.notification(
      'item/started',
      birthOn(OURS, ALPHA, '/root/alpha', transport.lastTurnId),
    )
    transport.notification('item/started', birthOn(OURS, BETA, '/root/beta', transport.lastTurnId))
    transport.notification(
      'item/started',
      birthOn(OURS, GAMMA, '/root/gamma', transport.lastTurnId),
    )
    transport.notification('turn/completed', completedOn(ALPHA, 'failed', null))
    // ⛔ A `turn/completed` claiming the turn is still running is a contradiction, and the one
    // reading that must never be picked is "it succeeded".
    transport.notification('turn/completed', completedOn(BETA, 'inProgress', null))
    // ⚑ The third word in the provider's union, which nothing else in this file reaches — and the
    // one the smoke's vocabulary guard admits without ever having seen it produced.
    transport.notification('turn/completed', completedOn(GAMMA, 'interrupted', 42))
    await barrier(transport, events, 'failed')

    expect(subAgents(events).find((e) => e.agentId === ALPHA && e.outcome)?.outcome).toBe('failed')
    expect(subAgents(events).find((e) => e.agentId === BETA && e.outcome)?.outcome).toBe('failed')
    const stopped = subAgents(events).find((e) => e.agentId === GAMMA && e.outcome)
    expect(stopped?.outcome).toBe('interrupted')
    expect(stopped?.usage?.ms).toBe(42)
    // No `durationMs` on the wire means no `ms` on the card — never a zero.
    expect(subAgents(events).find((e) => e.agentId === ALPHA && e.outcome)?.usage).toBeUndefined()
    // ⛔ **And the trailing `idle` adds NOTHING** — the whole phase list, not just the outcomes, so
    // a second outcome-less `ended` cannot hide behind a filter that only looks at cards with one.
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'idle' } })
    await barrier(transport, events, 'after-failed')
    expect(
      subAgents(events)
        .filter((e) => e.agentId === ALPHA)
        .map((e) => e.phase),
    ).toEqual(['started', 'ended'])

    await handle.close()
    await consumer
  })

  it('🔒 a thread that is NOT one of ours reports NOTHING — the door is membership, not method', async () => {
    // ⚠️ **This is the assertion that keeps 226 from being a hole in 200.** The four methods below
    // are exactly the ones a child is read for; sent by a conversation this session was never told
    // about, every one must be refused as before, with nothing emitted and nothing adopted.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const before = events.length
    // ⛔ **The door that actually opens, opened first.** `observe` fails OPEN — any thread that goes
    // active and is not ours gets an entry — so a test that never sends `active` exercises the case
    // where the door was already shut and proves nothing about the one that is reachable. This gets
    // its card, exactly as before 226, and then everything else must still be refused.
    transport.notification('thread/status/changed', {
      threadId: STRANGER,
      status: { type: 'active' },
    })
    transport.notification('item/started', birthOn(STRANGER, 'th_theirs', '/root/theirs'))
    transport.notification('item/completed', {
      threadId: STRANGER,
      item: { type: 'commandExecution', id: 'exec-x', command: 'rm -rf /', status: 'completed' },
    })
    transport.notification('thread/tokenUsage/updated', usageOn(STRANGER, 99_999))
    transport.notification('turn/completed', completedOn(STRANGER, 'completed', 1))
    await barrier(transport, events, 'stranger')

    // The observed card, and nothing else: no name, no descendant, no tokens, no tool count, no
    // outcome. `origin: 'observed'` is the whole of what an unannounced thread may put on screen.
    const theirs = subAgents(events.slice(before))
    expect(theirs.map((e) => `${e.agentId}:${e.phase}:${e.origin ?? '-'}`)).toEqual([
      `${STRANGER}:started:observed`,
    ])
    expect(theirs[0]?.usage).toBeUndefined()
    expect(theirs[0]?.outcome).toBeUndefined()
    expect(scope(handle).adopted, 'nothing an unannounced thread said was read').toBe(0)
    expect(scope(handle).dropped).toBe(4)

    await handle.close()
    await consumer
  })

  it('🔒 a birth may not name OUR OWN thread, or the thread announcing it', async () => {
    // ⛔ **The one door that writes an id it did not read from `threadId`.** Every other path keys
    // on the id the gate already checked; `descendant` takes `agentThreadId` out of the payload. An
    // item naming our own thread would put this session into `children` — after which its own
    // `thread/status/changed`, exempt from the foreign gate by design, would stop reaching
    // `observe`'s refusal and start driving a sub-agent card of the conversation itself.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'item/started',
      birthOn(OURS, ALPHA, '/root/alpha', transport.lastTurnId),
    )
    // ⚠️ **The marker is taken AFTER a barrier, never straight after the send.** `events.length`
    // read on the next line counts a queue that has not drained, so ALPHA's own birth lands inside
    // the window and reads as a card this test provoked — 201's lesson, in miniature.
    await barrier(transport, events, 'self-setup')
    const before = events.length
    transport.notification('item/started', birthOn(ALPHA, OURS, '/root/alpha/ourselves'))
    transport.notification('item/started', birthOn(ALPHA, ALPHA, '/root/alpha/itself'))
    await barrier(transport, events, 'self')

    expect(
      subAgents(events.slice(before)),
      'no card for ourselves, and none for the announcer',
    ).toEqual([])
    // …and the paired positive: an ordinary descendant on the same thread IS taken, so the refusal
    // above is about the two ids and not about the path being dead.
    transport.notification('item/started', birthOn(ALPHA, GAMMA, '/root/alpha/gamma'))
    await barrier(transport, events, 'self-positive')
    expect(subAgents(events).filter((e) => e.agentId === GAMMA)).toHaveLength(1)

    await handle.close()
    await consumer
  })

  it('⛔ a card the PARENT turn closed hears nothing more (075)', async () => {
    // ⚠️ **An interrupt is the ordinary way to reach this.** The parent's terminal `turn` closes
    // every open child card so the ledger cannot read "the turn ended, and then a sub-agent
    // stopped". Three of the child's own reports arrive after that boundary, and each would speak
    // about a card the app has already closed — the token reading worst of all, because a
    // `progress` puts it back in `open` to be closed a second time on the next turn.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'item/started',
      birthOn(OURS, ALPHA, '/root/alpha', transport.lastTurnId),
    )
    transport.notification('thread/status/changed', { threadId: ALPHA, status: { type: 'active' } })
    // The parent's turn ends while the child is still running. ⚠️ The BOUND turn id, or
    // `isCurrentProviderTurn` ignores it and this test would wait for a boundary that never comes.
    transport.notification(
      'turn/completed',
      completedOn(OURS, 'interrupted', 10, transport.lastTurnId),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn'))
    const before = events.length
    transport.notification('thread/tokenUsage/updated', usageOn(ALPHA, 12_345))
    transport.notification('turn/completed', completedOn(ALPHA, 'completed', 500))
    transport.notification('item/completed', {
      threadId: ALPHA,
      item: { type: 'commandExecution', id: 'exec-late', command: 'ls', status: 'completed' },
    })
    await barrier(transport, events, 'sealed')

    expect(subAgents(events.slice(before)), 'the card was closed with the turn').toEqual([])
    // …and the card DID get its honest ending from the boundary, so this is a refusal of late
    // reports rather than a card that never existed.
    expect(
      subAgents(events).filter((e) => e.agentId === ALPHA && e.phase === 'ended'),
    ).toHaveLength(1)

    await handle.close()
    await consumer
  })

  it("🔒 a child's WORDS stay out of the parent's transcript (128)", async () => {
    // The same frames carry the child's prose and its final answer. They are not forwarded: the
    // card has no body to own them, and unowned speech reading as the parent's own is what 128
    // exists to have stopped.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'item/started',
      birthOn(OURS, ALPHA, '/root/alpha', transport.lastTurnId),
    )
    transport.notification('item/agentMessage/delta', {
      threadId: ALPHA,
      turnId: 'tn_child',
      itemId: 'msg_child',
      delta: 'I am the child speaking',
    })
    transport.notification('item/completed', {
      threadId: ALPHA,
      turnId: 'tn_child',
      item: { type: 'agentMessage', id: 'msg_child', text: 'Darwin', phase: 'final_answer' },
    })

    // ⛔ **The paired positive, and without it this proves nothing.** The identical message on OUR
    // thread, with the bound turn, DOES reach the transcript — so "the child's words are absent" is
    // a fact about whose thread they arrived on, not about a haystack that was empty either way.
    transport.notification('item/completed', {
      threadId: OURS,
      turnId: transport.lastTurnId,
      item: {
        type: 'agentMessage',
        id: 'msg_ours',
        text: 'PARENT SPEAKING',
        phase: 'final_answer',
      },
    })
    await barrier(transport, events, 'quiet')

    const text = events
      .map((e) =>
        e.type === 'assistant_message' ? e.text : e.type === 'assistant_delta' ? e.text : '',
      )
      .join('')
    expect(text, 'the instrument can see a message at all').toContain('PARENT SPEAKING')
    expect(text).not.toContain('child speaking')
    expect(text).not.toContain('Darwin')
    // …and the child's frames really did travel the adopted path rather than being ignored wholesale.
    expect(scope(handle).dropped, "the child's two frames were refused as content").toBe(2)
    // …and the agentMessage did not count as a tool call either.
    expect(subAgents(events).some((e) => e.usage?.toolCalls !== undefined)).toBe(false)

    await handle.close()
    await consumer
  })
})
