import { describe, expect, it } from 'vitest'
import { runtimeEventSchema, type RuntimeEvent } from '../src/index'
import { normalizeNotification } from '../src/codex/normalize'
import { CodexSubAgents } from '../src/codex/sub-agents'

/**
 * The half of a Codex sub-agent's life that arrives on the CHILD's own thread (033).
 *
 * The whole sequence below is replayed from a live capture, in the order it actually arrived —
 * including the `idle` that lands BEFORE the birth, which is the detail that decides the design.
 */

const PARENT = '019fc039-e13a-7c21-b1cd-5702b7b22fd2'
const ALPHA = '019fc03a-07e4-7632-a834-97f12ec75f38'
const BETA = '019fc03a-1296-72e1-ac45-f7c82178841f'

const birth = (agentThreadId: string, agentPath: string, kind = 'started'): unknown => ({
  item: { type: 'subAgentActivity', id: `call_${agentPath}`, kind, agentThreadId, agentPath },
  threadId: PARENT,
  turnId: 'tn_1',
})

const status = (threadId: string, type: string): unknown => ({ threadId, status: { type } })

/** One notification through the pair, exactly as `codex-runtime` drives them. */
function feed(agents: CodexSubAgents, method: string, params: unknown): RuntimeEvent[] {
  const normalized = normalizeNotification(method, params)
  for (const event of normalized) agents.note(event)
  return [...normalized, ...agents.status(method, params)]
}

/** Only the sub-agent events, which is what every assertion here is about. */
const cards = (events: RuntimeEvent[]): Extract<RuntimeEvent, { type: 'sub_agent' }>[] =>
  events.filter((e): e is Extract<RuntimeEvent, { type: 'sub_agent' }> => e.type === 'sub_agent')

// ⚠️ **"the only completion signal" until 226**, which measured the child's own `turn/completed` on
// the same connection. This file still covers the status stream — the signal that ends a card whose
// turn we never see complete — and the reports are covered where they are read, through a real
// handle, in `codex-runtime.test.ts`.
describe('CodexSubAgents — the child thread ends the card (033)', () => {
  it('replays a real two-agent turn: one card each, born, working, ended — and nothing else', () => {
    const agents = new CodexSubAgents(() => PARENT)
    // Verbatim ordering from the capture: the empty child thread reports `idle` BEFORE it is
    // announced, both agents run concurrently, and each ends on its own `idle`.
    const events = [
      ...feed(agents, 'thread/status/changed', status(PARENT, 'active')),
      ...feed(agents, 'thread/status/changed', status(ALPHA, 'idle')),
      ...feed(agents, 'item/started', birth(ALPHA, 'alpha')),
      ...feed(agents, 'item/completed', birth(ALPHA, 'alpha')),
      ...feed(agents, 'thread/status/changed', status(ALPHA, 'active')),
      ...feed(agents, 'thread/status/changed', status(BETA, 'idle')),
      ...feed(agents, 'item/started', birth(BETA, 'beta')),
      ...feed(agents, 'item/completed', birth(BETA, 'beta')),
      ...feed(agents, 'thread/status/changed', status(BETA, 'active')),
      ...feed(agents, 'thread/status/changed', status(ALPHA, 'idle')),
      ...feed(agents, 'thread/status/changed', status(BETA, 'idle')),
      ...feed(agents, 'thread/status/changed', status(PARENT, 'idle')),
    ]
    // Only the BIRTH names the agent; later phases carry the id alone, because the fold correlates
    // on it and restating a name that cannot have changed is noise.
    const named: Record<string, string> = { [ALPHA]: 'alpha', [BETA]: 'beta' }
    expect(cards(events).map((e) => `${named[e.agentId]}:${e.phase}`)).toEqual([
      'alpha:started',
      'alpha:progress',
      'beta:started',
      'beta:progress',
      'alpha:ended',
      'beta:ended',
    ])
    // TWO cards, from six events — the fold correlates on agentId, so the count that matters is
    // the number of distinct ids, and it must be the number of agents that actually ran.
    expect(new Set(cards(events).map((e) => e.agentId)).size).toBe(2)
    for (const event of events) expect(runtimeEventSchema.parse(event)).toBeTruthy()
  })

  it("the child's FIRST idle arrives before its birth, and must not end a card at the instant it opens", () => {
    // This is the reason an ending requires a prior `active`. Reading "idle means finished" on its
    // own would have ended every sub-agent in every session before it did any work.
    const agents = new CodexSubAgents(() => PARENT)
    expect(cards(feed(agents, 'thread/status/changed', status(ALPHA, 'idle')))).toEqual([])
    const born = cards(feed(agents, 'item/started', birth(ALPHA, 'alpha')))
    expect(born).toHaveLength(1)
    expect(born[0]?.phase).toBe('started')
    // Even AFTER the birth, an idle it never went active from is not an ending.
    expect(cards(feed(agents, 'thread/status/changed', status(ALPHA, 'idle')))).toEqual([])
  })

  it('ends WITHOUT an outcome: an idle thread says it stopped, never that it succeeded', () => {
    const agents = new CodexSubAgents(() => PARENT)
    feed(agents, 'item/started', birth(ALPHA, 'alpha'))
    feed(agents, 'thread/status/changed', status(ALPHA, 'active'))
    const [ended] = cards(feed(agents, 'thread/status/changed', status(ALPHA, 'idle')))
    expect(ended).toEqual({ type: 'sub_agent', phase: 'ended', agentId: ALPHA })
    expect(ended).not.toHaveProperty('outcome')
    // Nor a summary: the child's answer goes to the parent MODEL as an inter-agent message and
    // never reaches this connection, so there is nothing truthful to put there.
    expect(ended).not.toHaveProperty('summary')
  })

  it('reports TRANSITIONS, so a repeated status does not fill the ledger with nothing', () => {
    const agents = new CodexSubAgents(() => PARENT)
    feed(agents, 'item/started', birth(ALPHA, 'alpha'))
    expect(cards(feed(agents, 'thread/status/changed', status(ALPHA, 'active')))).toHaveLength(1)
    expect(cards(feed(agents, 'thread/status/changed', status(ALPHA, 'active')))).toEqual([])
    expect(cards(feed(agents, 'thread/status/changed', status(ALPHA, 'idle')))).toHaveLength(1)
    expect(cards(feed(agents, 'thread/status/changed', status(ALPHA, 'idle')))).toEqual([])
  })

  it('an interrupted birth is already ended, and the trailing idle cannot end it twice', () => {
    const agents = new CodexSubAgents(() => PARENT)
    feed(agents, 'item/started', birth(ALPHA, 'alpha'))
    feed(agents, 'thread/status/changed', status(ALPHA, 'active'))
    const stopped = cards(feed(agents, 'item/started', birth(ALPHA, 'alpha', 'interrupted')))
    expect(stopped[0]).toMatchObject({ phase: 'ended', outcome: 'interrupted' })
    // The thread still goes idle afterwards. A second `ended` would overwrite the honest
    // `interrupted` with an outcome-less one — a real regression, not a cosmetic duplicate.
    expect(cards(feed(agents, 'thread/status/changed', status(ALPHA, 'idle')))).toEqual([])
  })

  it("OUR OWN thread's status is still not a card, however it behaves", () => {
    // ⛔ The condition 135 loosened is the one that protects this, so it is asserted in both
    // directions. A session opening a card about ITSELF is the regression to fear, and every state
    // of the parent thread — including the `active` that now opens one for anybody else — has to
    // stay silent. This, and the fact that we only see our own descendants, is what keeps
    // `thread/status/changed` safe outside the turn-scope gate.
    const agents = new CodexSubAgents(() => PARENT)
    for (const state of ['active', 'idle', 'active', 'someFutureState']) {
      expect(cards(feed(agents, 'thread/status/changed', status(PARENT, state))), state).toEqual([])
    }
    // Nor an unidentifiable one: no id, nothing to correlate on, nothing to show.
    expect(cards(feed(agents, 'thread/status/changed', status('', 'active')))).toEqual([])
  })

  it('a thread that never goes active is not a card either — the leading idle opens nothing', () => {
    // Every Codex thread announces itself idle before it does anything. Opening on that would put a
    // card on screen for a thread that may never run, and one for every thread ever mentioned.
    const agents = new CodexSubAgents(() => PARENT)
    expect(cards(feed(agents, 'thread/status/changed', status(BETA, 'idle')))).toEqual([])
    expect(cards(feed(agents, 'thread/status/changed', status(BETA, 'idle')))).toEqual([])
  })

  it('refuses to guess while it does not know its OWN thread — a card for ourselves is worse', () => {
    // Before the handshake there is no way to tell our status from a descendant's, so nothing opens.
    const agents = new CodexSubAgents(() => undefined)
    expect(cards(feed(agents, 'thread/status/changed', status(BETA, 'active')))).toEqual([])
    // And an announced child still works throughout: the refusal is about the third case only.
    feed(agents, 'item/started', birth(ALPHA, 'alpha'))
    expect(cards(feed(agents, 'thread/status/changed', status(ALPHA, 'active')))).toHaveLength(1)
  })

  it('a status it cannot read moves nothing', () => {
    const agents = new CodexSubAgents(() => PARENT)
    feed(agents, 'item/started', birth(ALPHA, 'alpha'))
    feed(agents, 'thread/status/changed', status(ALPHA, 'active'))
    for (const params of [
      { threadId: ALPHA }, // no status at all
      { threadId: ALPHA, status: { type: 'someFutureState' } },
      { threadId: ALPHA, status: 'idle' }, // not the nested shape
      'not even a record',
      undefined,
    ]) {
      expect(cards(feed(agents, 'thread/status/changed', params)), JSON.stringify(params)).toEqual(
        [],
      )
    }
    // …and the real ending still works afterwards, so refusing the unreadable did not break it.
    expect(cards(feed(agents, 'thread/status/changed', status(ALPHA, 'idle')))).toHaveLength(1)
  })

  it('only `thread/status/changed` drives it — no other method can move a card', () => {
    const agents = new CodexSubAgents(() => PARENT)
    feed(agents, 'item/started', birth(ALPHA, 'alpha'))
    for (const method of ['thread/started', 'thread/closed', 'turn/completed', 'item/completed']) {
      expect(agents.status(method, status(ALPHA, 'idle')), method).toEqual([])
    }
  })

  it('each session tracks its own agents: a fresh instance knows nothing of the last one', () => {
    const first = new CodexSubAgents(() => PARENT)
    feed(first, 'item/started', birth(ALPHA, 'alpha'))
    feed(first, 'thread/status/changed', status(ALPHA, 'active'))
    const second = new CodexSubAgents(() => PARENT)
    expect(cards(feed(second, 'thread/status/changed', status(ALPHA, 'idle')))).toEqual([])
    expect(cards(feed(first, 'thread/status/changed', status(ALPHA, 'idle')))).toHaveLength(1)
  })
})

/**
 * The measured grandchild event sequence is replayed from the ledger.
 *
 * ⚑ **`sess_d5c8c9ca`, 13 Aug 00:37: `/root → /root/ui_test → /root/ui_test/nested_test`.** The ids
 * and the ORDER below are transcribed from `events` ordinals 8–139 of that session, and the shape
 * is the whole finding: the depth-2 thread produced three `thread/status/changed` frames and no
 * birth, because its birth — `sub_agent_activity{agent_path:'/root/ui_test/nested_test'}` — was
 * announced on the CHILD's connection, which this app does not hold. The root's own rollout names
 * that thread zero times.
 *
 * ⛔ **What the wire does NOT say is asserted here too**, because it is what decides the design:
 * the grandchild's frames carry no parent, so the card cannot be nested under the depth-1 child
 * without inventing the one fact nobody sent.
 */
describe('CodexSubAgents — the depth-2 agent nobody announced (135)', () => {
  const ROOT = '019ff855-7d26-7090-a243-99a1f8782e9a'
  const CHILD = '019ff855-9c0d-7951-bd56-f7e914581198'
  const GRAND = '019ff856-3833-7d11-bd85-c3bd5a0368c0'

  /** The birth Codex DID send us, on the root's item stream: the depth-1 child, named. */
  const childBirth = (kind = 'started'): unknown => ({
    item: {
      type: 'subAgentActivity',
      id: 'call_LmwDmS9Oiq9Bov0hAVqRAT3Q',
      kind,
      agentThreadId: CHILD,
      agentPath: '/root/ui_test',
    },
    threadId: ROOT,
    turnId: 'tn_1',
  })

  /** Ordinals 8 → 139, every frame that touched a thread, in the order the app recorded them. */
  function replay(): RuntimeEvent[] {
    const agents = new CodexSubAgents(() => ROOT)
    return [
      ...feed(agents, 'thread/status/changed', status(ROOT, 'active')), // 8
      ...feed(agents, 'thread/status/changed', status(CHILD, 'idle')), // 25
      ...feed(agents, 'item/started', childBirth()), // 26
      ...feed(agents, 'thread/status/changed', status(CHILD, 'active')), // 30
      ...feed(agents, 'thread/status/changed', status(CHILD, 'idle')), // 46
      ...feed(agents, 'thread/status/changed', status(ROOT, 'idle')), // 68
      ...feed(agents, 'thread/status/changed', status(ROOT, 'active')), // 73
      ...feed(agents, 'item/started', childBirth('interacted')), // 91
      ...feed(agents, 'thread/status/changed', status(CHILD, 'active')), // 92
      ...feed(agents, 'thread/status/changed', status(GRAND, 'idle')), // 103
      ...feed(agents, 'thread/status/changed', status(GRAND, 'active')), // 105
      ...feed(agents, 'thread/status/changed', status(GRAND, 'idle')), // 109
      ...feed(agents, 'thread/status/changed', status(CHILD, 'idle')), // 112
      ...feed(agents, 'thread/status/changed', status(ROOT, 'idle')), // 139
    ]
  }

  it('gives the depth-2 agent a card of its own — born when it works, ended when it stops', () => {
    const grand = cards(replay()).filter((e) => e.agentId === GRAND)
    expect(grand.map((e) => e.phase)).toEqual(['started', 'ended'])
    // Opened by the `active` at 105, NOT by the `idle` at 103 that merely announced the thread.
    expect(grand[0]).toEqual({
      type: 'sub_agent',
      agentId: GRAND,
      idKind: 'thread',
      phase: 'started',
      origin: 'observed',
    })
    // ⛔ No `kind`, no `parentToolCallId`: both live in a birth that was announced to somebody else.
    // Carrying either would be the fabrication, and `origin` is what says so out loud instead.
    expect(grand[0]).not.toHaveProperty('kind')
    expect(grand[0]).not.toHaveProperty('parentToolCallId')
    // The ending is the ordinary one — it stopped, and nothing said how it went.
    expect(grand[1]).toEqual({ type: 'sub_agent', phase: 'ended', agentId: GRAND })
    for (const event of replay()) expect(runtimeEventSchema.parse(event)).toBeTruthy()
  })

  it("the depth-1 card carries only the depth-1 thread's own events, before and after", () => {
    // ⚠️ **The ticket's reading needed correcting and the correction is worth pinning.** Ordinal 91
    // is the depth-1 child's own `interacted` — the root messaging `ui_test` to spawn the nested
    // agent — so it is progress on that card and always was. Nothing of the grandchild's ever
    // landed on it; what was wrong is that the grandchild had no card at all. Both halves are
    // asserted, because a fix that moved the depth-1 events onto the new card would be a new defect.
    const child = cards(replay()).filter((e) => e.agentId === CHILD)
    expect(child.map((e) => e.phase)).toEqual([
      'started', // 26 — announced, named
      'progress', // 30 — its thread went active
      'ended', // 46 — and idle again
      'progress', // 91 — `interacted`: the root talking to it
      'progress', // 92 — active again for the nested work
      'ended', // 112
    ])
    expect(child[0]).toMatchObject({
      kind: 'ui_test',
      parentToolCallId: 'call_LmwDmS9Oiq9Bov0hAVqRAT3Q',
    })
    // ⛔ And the depth-1 card is never told it is `observed`: it was announced, in full.
    for (const event of child) expect(event).not.toHaveProperty('origin')
  })

  it('the ROOT thread runs through the whole session and never becomes a card', () => {
    // Four root transitions, two of them `active` — the state that now opens a card for a stranger.
    const ids = new Set(cards(replay()).map((e) => e.agentId))
    expect(ids).toEqual(new Set([CHILD, GRAND]))
    // Exactly two agents, matching the measured state database.
    expect(ids.size).toBe(2)
  })

  it('depth 3 adds a card, never a level — the tree cannot nest without bound (078)', () => {
    // A great-grandchild is announced one connection further away than a grandchild, and reaches us
    // the same way: a thread that goes active. It gets the same flat, parentless card. That is the
    // BOUND — the depth of what we render is one, whatever the provider's depth is, because the
    // wire never tells us who spawned whom. Nothing recursive is introduced for a reader to fall
    // into, and the count of cards is the count of threads that actually did work.
    const agents = new CodexSubAgents(() => ROOT)
    const GREAT = '019ff857-0000-7d11-bd85-c3bd5a0368c0'
    const opened = [GRAND, GREAT].flatMap((id) =>
      cards(feed(agents, 'thread/status/changed', status(id, 'active'))),
    )
    expect(opened.map((e) => e.phase)).toEqual(['started', 'started'])
    expect(opened.every((e) => e.origin === 'observed')).toBe(true)
    expect(opened.some((e) => 'parentToolCallId' in e)).toBe(false)
  })
})
