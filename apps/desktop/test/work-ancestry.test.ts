import { expect, it } from 'vitest'
import { serialize } from 'node:v8'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { WorkAncestryRead } from '../src/main/runtime/work-ancestry'

const agent = (agentId: string, parentToolCallId?: string): TranscriptEvent => ({
  type: 'sub_agent',
  agentId,
  phase: 'started',
  ...(parentToolCallId === undefined ? {} : { parentToolCallId }),
})
const call = (id: string, parentToolCallId?: string): TranscriptEvent => ({
  type: 'tool_call',
  id,
  name: 'Agent',
  summary: id,
  ...(parentToolCallId === undefined ? {} : { parentToolCallId }),
})

it('joins late child and grandchild relationships without borrowing an unrelated dispatch', () => {
  const read = new WorkAncestryRead()
  read.observe(agent('grandchild', 'inner'))
  read.observe(call('grandchild-read', 'inner'))
  read.observe(call('inner', 'outer'))
  read.observe(agent('unrelated', 'other'))
  expect(read.read().agents).toEqual([
    { agentId: 'grandchild', dispatch: 'inner', complete: false },
    { agentId: 'unrelated', dispatch: 'other', complete: false },
  ])
  read.observe(agent('child', 'outer'))
  const adopted = read.read()
  expect(adopted.agents).toEqual([
    { agentId: 'grandchild', dispatch: 'inner', parentAgentId: 'child', complete: false },
    { agentId: 'unrelated', dispatch: 'other', complete: false },
    { agentId: 'child', dispatch: 'outer', complete: false },
  ])
  expect(adopted.tools).toEqual([
    { callId: 'grandchild-read', agentId: 'grandchild' },
    { callId: 'inner', agentId: 'child' },
  ])
  read.observe(call('outer', 'root-dispatch'))
  read.observe(agent('root-agent', 'root-dispatch'))
  expect(read.read().agents[0]).toEqual({
    agentId: 'grandchild',
    dispatch: 'inner',
    parentAgentId: 'child',
    complete: false,
  })
  expect(adopted.agents[0]!.parentAgentId).toBe('child')
  expect(read.read().agents.find((one) => one.agentId === 'child')?.parentAgentId).toBe(
    'root-agent',
  )
  read.observe(call('root-dispatch'))
  expect(read.read().agents[0]).toMatchObject({ parentAgentId: 'child', complete: true })
})

it('preserves identity and order when a later phase supplies a missing dispatch, including replay', () => {
  const events = [agent('a'), call('inner', 'outer'), agent('b', 'inner'), agent('a', 'outer')]
  const live = new WorkAncestryRead()
  for (const event of events) live.observe(event)
  live.observe({ type: 'sub_agent', agentId: 'a', phase: 'ended', outcome: 'completed' })
  expect(live.read().agents).toEqual([
    { agentId: 'a', dispatch: 'outer', complete: false },
    { agentId: 'b', dispatch: 'inner', parentAgentId: 'a', complete: false },
  ])
  const reopened = new WorkAncestryRead()
  for (const event of events) reopened.observe(event)
  expect(reopened.read()).toEqual(live.read())
})

it('retains an already-adopted grandchild and its result when the dispatch is reclaimed late', async () => {
  const { createTranscript, everyCard, markReopened } =
    await import('../src/renderer/src/lib/transcript')
  const { applyEvent } = await import('./lib/core-transcript')
  const state = createTranscript()
  for (const event of [call('outer'), call('inner', 'outer'), agent('grandchild', 'inner')])
    applyEvent(state, event)
  const grandchild = everyCard(state).find((card) => card.agentId === 'grandchild')!
  applyEvent(state, {
    type: 'tool_call',
    id: 'read',
    parentToolCallId: 'inner',
    name: 'Read',
    summary: 'notes',
  })
  applyEvent(state, {
    type: 'tool_result',
    id: 'read',
    parentToolCallId: 'inner',
    ok: true,
    summary: 'recorded result',
  })
  applyEvent(state, call('unrelated'))
  applyEvent(state, agent('child', 'outer'))
  const child = everyCard(state).find((card) => card.agentId === 'child')!
  const dispatch = child.body.find((row) => row.kind === 'tool' && row.callId === 'inner')
  expect(dispatch?.kind === 'tool' && dispatch.subAgents?.[0]).toBe(grandchild)
  expect(grandchild.body).toEqual([
    {
      kind: 'tool',
      callId: 'read',
      name: 'Read',
      summary: 'notes',
      result: { ok: true, summary: 'recorded result' },
    },
  ])
  expect(state.items.filter((row) => row.kind === 'tool').map((row) => row.callId)).toEqual([
    'outer',
    'unrelated',
  ])
  applyEvent(state, {
    type: 'sub_agent',
    agentId: 'grandchild',
    phase: 'ended',
    outcome: 'completed',
  })
  expect(everyCard(state).find((card) => card.agentId === 'grandchild')).toBe(grandchild)
  expect(grandchild.outcome).toBe('completed')
  markReopened(state)
  expect(grandchild.running).toBe(false)
})

it('ships one fact per unrelated tool and no relationship set for an unchanged phase', () => {
  const read = new WorkAncestryRead()
  read.observe(call('outer'))
  read.observe(agent('child', 'outer'))
  const child = read.read().agents[0]!
  let tools = 0
  let agents = 0
  let dispatches = 0
  for (let index = 0; index < 1000; index++) {
    const update = read.observe(call(`unrelated-${index}`))!
    expect(update.update).toBe(true)
    expect(update.tools).toEqual([{ callId: `unrelated-${index}` }])
    expect(update.agents).toEqual([])
    expect(update.dispatches).toEqual([])
    tools += update.tools.length
    agents += update.agents.length
    dispatches += update.dispatches.length
  }
  expect({ tools, agents, dispatches }).toEqual({ tools: 1000, agents: 0, dispatches: 0 })
  expect(read.read().agents[0]).toBe(child)
  for (let index = 0; index < 1000; index++) {
    expect(read.observe(agent('child', 'outer'))).toBeUndefined()
    expect(
      read.observe({ type: 'sub_agent', agentId: 'child', phase: 'ended', outcome: 'completed' }),
    ).toBeUndefined()
  }
  expect(read.read().agents[0]).toBe(child)
})

it('updates only the descendants affected by a late ancestor and leaves unrelated facts reusable', () => {
  const read = new WorkAncestryRead()
  for (const event of [
    call('outer'),
    call('inner', 'outer'),
    agent('grandchild', 'inner'),
    call('elsewhere'),
    agent('other', 'elsewhere'),
  ])
    read.observe(event)
  const unrelated = read.read().agents.find((one) => one.agentId === 'other')!
  const update = read.observe(agent('child', 'outer'))!
  expect(update.tools).toEqual([{ callId: 'inner', agentId: 'child' }])
  expect(update.dispatches).toEqual([{ callId: 'outer', agentIds: ['child'] }])
  expect(update.agents).toEqual([
    { agentId: 'child', dispatch: 'outer', complete: true },
    { agentId: 'grandchild', dispatch: 'inner', parentAgentId: 'child', complete: true },
  ])
  expect(read.read().agents.find((one) => one.agentId === 'other')).toBe(unrelated)
})

it('keeps retained facts, construction and actual serialized bytes linear for flat tools and a deep chain', () => {
  const cost = (size: number, chain: boolean) => {
    const read = new WorkAncestryRead()
    const updates: NonNullable<ReturnType<WorkAncestryRead['observe']>>[] = []
    let rootReads = 0
    let root: object | undefined
    for (let index = 0; index < size; index++) {
      const id = String(index).padStart(4, '0')
      const parent = index === 0 ? undefined : `d-${String(index - 1).padStart(4, '0')}`
      const callEvent = call(`d-${id}`, chain ? parent : undefined)
      const tool = read.observe(callEvent)!
      read.remember({ event: callEvent, ordinal: index * 2, at: index * 2 })
      updates.push(read.delivery(callEvent, tool)!)
      if (!chain) continue
      const agentEvent = agent(`a-${id}`, `d-${id}`)
      const update = read.observe(agentEvent)!
      read.remember({ event: agentEvent, ordinal: index * 2 + 1, at: index * 2 + 1 })
      updates.push(read.delivery(agentEvent, update)!)
      if (index === 0) {
        root = update.agents[0]!
        Object.defineProperty(root, 'complete', {
          get() {
            rootReads++
            return true
          },
        })
      }
      expect(update.agents).toHaveLength(1)
      expect(update.agents[0]?.parentAgentId).toBe(
        index === 0 ? undefined : `a-${String(index - 1).padStart(4, '0')}`,
      )
      expect(update.tools).toHaveLength(0)
      expect(update.dispatches).toHaveLength(1)
    }
    // The next child needs its parent's completeness once; unrelated/deeper appends do not revisit root.
    const constructionReads = rootReads
    const snapshot = read.read()
    if (chain) expect(snapshot.agents[0]).toBe(root)
    const records = updates.reduce(
      (total, update) =>
        total + update.agents.length + update.tools.length + update.dispatches.length,
      0,
    )
    return {
      constructionReads,
      records,
      retainedRecords: snapshot.agents.length + snapshot.tools.length + snapshot.dispatches.length,
      retainedProjectionBytes: serialize(read).byteLength,
      retainedBytes: Buffer.byteLength(JSON.stringify(snapshot), 'utf8'),
      wireBytes: Buffer.byteLength(JSON.stringify(updates), 'utf8'),
      largestReceipt: Math.max(
        ...updates.map((update) => Buffer.byteLength(JSON.stringify(update), 'utf8')),
      ),
    }
  }
  for (const chain of [false, true]) {
    const small = cost(128, chain)
    const large = cost(256, chain)
    expect(small.constructionReads).toBe(chain ? 1 : 0)
    expect(large.constructionReads).toBe(chain ? 1 : 0)
    expect(large.records).toBe(small.records * 2)
    expect(large.retainedRecords).toBe(small.retainedRecords * 2)
    expect(large.retainedProjectionBytes).toBeLessThanOrEqual(small.retainedProjectionBytes * 2.1)
    expect(large.retainedBytes).toBeLessThanOrEqual(small.retainedBytes * 2.1)
    expect(large.wireBytes).toBeLessThanOrEqual(small.wireBytes * 2.1)
    expect(large.largestReceipt).toBe(small.largestReceipt)
  }
})

it('delivers a fresh receiver dependency chain once, and clears that baseline at a real reset', () => {
  const cost = (size: number) => {
    const read = new WorkAncestryRead()
    let ordinal = 0
    const publish = (event: TranscriptEvent) => {
      const changed = read.observe(event)
      read.remember({ event, ordinal, at: ordinal++ })
      return read.delivery(event, changed)
    }
    for (let index = 0; index < size; index++) {
      const id = String(index).padStart(4, '0')
      publish(call(`d-${id}`, index === 0 ? undefined : `d-${String(index - 1).padStart(4, '0')}`))
      publish(agent(`a-${id}`, `d-${id}`))
    }
    read.beginDelivery()
    const tail = `d-${String(size - 1).padStart(4, '0')}`
    const baseline = publish(call('first-fresh', tail))!
    expect(baseline.agents).toHaveLength(size)
    expect(baseline.baseline?.filter((row) => row.event.type === 'sub_agent')).toHaveLength(size)
    const next = publish(call('next--fresh', tail))!
    expect(next.tools).toEqual([
      { callId: 'next--fresh', agentId: `a-${String(size - 1).padStart(4, '0')}` },
    ])
    expect(next.agents).toEqual([])
    expect(next.baseline).toBeUndefined()
    expect(
      publish({
        type: 'sub_agent',
        agentId: `a-${String(size - 1).padStart(4, '0')}`,
        phase: 'ended',
      }),
    ).toBeUndefined()
    const bytes = Buffer.byteLength(JSON.stringify(baseline), 'utf8')
    const nextBytes = Buffer.byteLength(JSON.stringify(next), 'utf8')
    read.clear()
    const unknown = publish(call('after-reset', tail))!
    expect(unknown.agents).toEqual([])
    expect(unknown.baseline).toBeUndefined()
    return { bytes, nextBytes }
  }
  const small = cost(128)
  const large = cost(256)
  expect(large.bytes).toBeLessThanOrEqual(small.bytes * 2.1)
  expect(large.nextBytes).toBe(small.nextBytes)
})
