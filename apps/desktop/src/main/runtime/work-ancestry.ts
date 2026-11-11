import type { PersistedEventInfo, TranscriptEvent } from '../../shared/conversation-events'
import type {
  WorkAncestry,
  WorkAncestryContext,
  WorkAncestryFacts,
} from '../../shared/work-ancestry'

type Agent = WorkAncestry['agents'][number]
type Tool = WorkAncestry['tools'][number]

/** Core-owned relationships; live receipts contain only the affected facts. */
export class WorkAncestryRead {
  private readonly agents = new Map<string, { dispatch?: string; order: number }>()
  private readonly tools = new Map<string, string | undefined>()
  private readonly dispatchAgents = new Map<string, Set<string>>()
  private readonly dispatchTools = new Map<string, Set<string>>()
  private readonly parents = new Map<string, string | undefined>()
  private readonly children = new Map<string, Set<string>>()
  private readonly agentFacts = new Map<string, Agent>()
  private readonly toolFacts = new Map<string, Tool>()
  private readonly dispatchFacts = new Map<string, WorkAncestry['dispatches'][number]>()
  private readonly agentSources = new Map<
    string,
    PersistedEventInfo & { event: Extract<TranscriptEvent, { type: 'sub_agent' }> }
  >()
  private readonly toolSources = new Map<
    string,
    PersistedEventInfo & { event: Extract<TranscriptEvent, { type: 'tool_call' }> }
  >()
  private sentAgents = new Set<string>()
  private sentTools = new Set<string>()
  private sentDispatches = new Set<string>()
  private missing: WorkAncestryContext['missing'] = []
  private truncated = false
  private contextChanged = false

  seed(events: Iterable<TranscriptEvent>, context: Partial<WorkAncestryContext>): void {
    for (const event of events) this.observe(event)
    this.missing = context.missing ?? []
    this.truncated = context.truncated ?? false
    this.contextChanged = true
  }

  seedRows(rows: Iterable<PersistedEventInfo>, context: Partial<WorkAncestryContext>): void {
    for (const row of rows) {
      this.observe(row.event)
      this.remember(row)
    }
    this.missing = context.missing ?? []
    this.truncated = context.truncated ?? false
    this.contextChanged = true
  }

  /** A bounded attach starts a new receiver baseline, without discarding core knowledge. */
  beginDelivery(): void {
    this.sentAgents = new Set()
    this.sentTools = new Set()
    this.sentDispatches = new Set()
  }

  remember(row: PersistedEventInfo): void {
    const event = row.event
    if (event.type === 'tool_call') {
      const previous = this.toolSources.get(event.id)
      if (previous === undefined || previous.ordinal <= row.ordinal) {
        this.toolSources.set(event.id, {
          ordinal: row.ordinal,
          at: row.at,
          event: { ...previous?.event, ...event },
        })
      }
    }
    if (event.type === 'sub_agent') {
      const previous = this.agentSources.get(event.agentId)
      if (previous !== undefined && previous.ordinal > row.ordinal) return
      this.agentSources.set(event.agentId, {
        ordinal: row.ordinal,
        at: row.at,
        event: {
          ...previous?.event,
          ...event,
          phase: previous?.event.phase === 'ended' ? 'ended' : event.phase,
        },
      })
    }
  }

  /** Send each referenced dependency once per receiver, plus facts that actually changed. */
  delivery(event: TranscriptEvent, changed: WorkAncestry | undefined): WorkAncestry | undefined {
    const agents = new Map<string, Agent>(changed?.agents.map((fact) => [fact.agentId, fact]))
    const tools = new Map<string, Tool>(changed?.tools.map((fact) => [fact.callId, fact]))
    const dispatches = new Map<string, WorkAncestry['dispatches'][number]>(
      changed?.dispatches.map((fact) => [fact.callId, fact]),
    )
    const pending: { kind: 'agent' | 'tool' | 'dispatch'; id: string }[] = []
    for (const fact of agents.values()) pending.push({ kind: 'agent', id: fact.agentId })
    for (const fact of tools.values()) pending.push({ kind: 'tool', id: fact.callId })
    for (const fact of dispatches.values()) pending.push({ kind: 'dispatch', id: fact.callId })
    if (event.type === 'sub_agent') pending.push({ kind: 'agent', id: event.agentId })
    if (event.type === 'tool_call' || event.type === 'tool_result')
      pending.push({ kind: 'tool', id: event.id })
    if ('parentToolCallId' in event && event.parentToolCallId !== undefined)
      pending.push({ kind: 'dispatch', id: event.parentToolCallId })
    const visited = new Set<string>()
    const baseline = new Map<number, PersistedEventInfo>()
    for (let index = 0; index < pending.length; index++) {
      const { kind, id } = pending[index]!
      const key = `${kind}:${id}`
      if (visited.has(key)) continue
      visited.add(key)
      if (kind === 'agent') {
        const fact = this.agentFacts.get(id)
        if (fact === undefined || (this.sentAgents.has(id) && !agents.has(id))) continue
        agents.set(id, fact)
        const source = this.agentSources.get(id)
        if (!this.sentAgents.has(id) && source !== undefined) baseline.set(source.ordinal, source)
        this.sentAgents.add(id)
        if (fact.dispatch !== undefined) {
          pending.push({ kind: 'tool', id: fact.dispatch }, { kind: 'dispatch', id: fact.dispatch })
        }
        if (fact.parentAgentId !== undefined)
          pending.push({ kind: 'agent', id: fact.parentAgentId })
      } else if (kind === 'tool') {
        const fact = this.toolFacts.get(id)
        if (fact === undefined || (this.sentTools.has(id) && !tools.has(id))) continue
        tools.set(id, fact)
        const source = this.toolSources.get(id)
        if (
          !this.sentTools.has(id) &&
          source !== undefined &&
          !(event.type === 'tool_call' && event.id === id)
        )
          baseline.set(source.ordinal, source)
        this.sentTools.add(id)
        if (fact.agentId !== undefined) pending.push({ kind: 'agent', id: fact.agentId })
      } else {
        const fact = this.dispatchFacts.get(id)
        if (fact === undefined || (this.sentDispatches.has(id) && !dispatches.has(id))) continue
        dispatches.set(id, fact)
        this.sentDispatches.add(id)
        for (const agentId of fact.agentIds) pending.push({ kind: 'agent', id: agentId })
      }
    }
    if (changed === undefined && agents.size === 0 && tools.size === 0 && dispatches.size === 0)
      return undefined
    return {
      ...changed,
      update: true,
      agents: [...agents.values()],
      tools: [...tools.values()],
      dispatches: [...dispatches.values()],
      ...(baseline.size === 0
        ? {}
        : { baseline: [...baseline.values()].sort((a, b) => a.ordinal - b.ordinal) }),
    }
  }

  private members(index: Map<string, Set<string>>, key: string): Set<string> {
    let members = index.get(key)
    if (members === undefined) {
      members = new Set()
      index.set(key, members)
    }
    return members
  }

  clear(): void {
    this.agents.clear()
    this.tools.clear()
    this.dispatchAgents.clear()
    this.dispatchTools.clear()
    this.parents.clear()
    this.children.clear()
    this.agentSources.clear()
    this.toolSources.clear()
    this.beginDelivery()
    this.agentFacts.clear()
    this.toolFacts.clear()
    this.dispatchFacts.clear()
    this.missing = []
    this.truncated = false
    this.contextChanged = false
  }

  context(): WorkAncestryContext {
    return { missing: this.missing, truncated: this.truncated }
  }

  observe(event: TranscriptEvent): WorkAncestry | undefined {
    if (event.type === 'conversation_reset') {
      this.clear()
      return {
        update: true,
        reset: true,
        agents: [],
        tools: [],
        dispatches: [],
        missing: [],
        truncated: false,
      }
    }
    if (event.type !== 'tool_call' && event.type !== 'sub_agent') return undefined
    const tools = new Set<string>()
    const agents = new Set<string>()
    const dispatches = new Set<string>()
    if (event.type === 'tool_call') {
      const previous = this.tools.get(event.id)
      const parent = event.parentToolCallId ?? previous
      if (this.tools.has(event.id) && previous === parent) return undefined
      if (previous !== undefined) this.dispatchTools.get(previous)?.delete(event.id)
      this.tools.set(event.id, parent)
      if (parent !== undefined) this.members(this.dispatchTools, parent).add(event.id)
      tools.add(event.id)
    } else if (event.type === 'sub_agent') {
      const previous = this.agents.get(event.agentId)
      const dispatch = event.parentToolCallId ?? previous?.dispatch
      if (previous !== undefined && previous.dispatch === dispatch) return undefined
      this.agents.set(event.agentId, { dispatch, order: previous?.order ?? this.agents.size })
      agents.add(event.agentId)
      if (previous?.dispatch !== undefined) {
        this.dispatchAgents.get(previous.dispatch)?.delete(event.agentId)
        dispatches.add(previous.dispatch)
      }
      if (dispatch !== undefined) {
        this.members(this.dispatchAgents, dispatch).add(event.agentId)
        dispatches.add(dispatch)
      }
    } else return undefined

    const changedDispatches: WorkAncestry['dispatches'][number][] = []
    for (const callId of dispatches) {
      const agentIds = [...(this.dispatchAgents.get(callId) ?? [])].sort(
        (a, b) => this.agents.get(a)!.order - this.agents.get(b)!.order,
      )
      const previous = this.dispatchFacts.get(callId)
      const fact = { callId, agentIds }
      this.dispatchFacts.set(callId, fact)
      changedDispatches.push(fact)
      if (previous?.agentIds[0] !== agentIds[0]) {
        for (const tool of this.dispatchTools.get(callId) ?? []) tools.add(tool)
      }
    }
    const changedTools: Tool[] = []
    for (const callId of tools) {
      const dispatch = this.tools.get(callId)
      const agentId =
        dispatch === undefined ? undefined : this.dispatchFacts.get(dispatch)?.agentIds[0]
      const previous = this.toolFacts.get(callId)
      if (previous === undefined || previous.agentId !== agentId) {
        const fact = { callId, ...(agentId === undefined ? {} : { agentId }) }
        this.toolFacts.set(callId, fact)
        changedTools.push(fact)
      }
      for (const agent of this.dispatchAgents.get(callId) ?? []) agents.add(agent)
    }
    for (const agent of agents) {
      const previous = this.parents.get(agent)
      const dispatch = this.agents.get(agent)!.dispatch
      const parent = dispatch === undefined ? undefined : this.toolFacts.get(dispatch)?.agentId
      if (previous !== parent) {
        if (previous !== undefined) this.children.get(previous)?.delete(agent)
        if (parent !== undefined) this.members(this.children, parent).add(agent)
      }
      this.parents.set(agent, parent)
    }
    const affected = [...agents]
    for (let index = 0; index < affected.length; index++) {
      for (const child of this.children.get(affected[index]!) ?? []) {
        if (agents.has(child)) continue
        agents.add(child)
        affected.push(child)
      }
    }
    const resolved = new Map<string, Agent>()
    const resolve = (agentId: string): Agent => {
      const path: string[] = []
      const positions = new Map<string, number>()
      let cursor: string | undefined = agentId
      while (cursor !== undefined && agents.has(cursor) && !resolved.has(cursor)) {
        const cycle = positions.get(cursor)
        if (cycle !== undefined) {
          for (const member of path.splice(cycle))
            resolved.set(member, {
              agentId: member,
              dispatch: this.agents.get(member)!.dispatch,
              parentAgentId: this.parents.get(member),
              complete: false,
            })
          break
        }
        positions.set(cursor, path.length)
        path.push(cursor)
        cursor = this.parents.get(cursor)
      }
      for (let index = path.length - 1; index >= 0; index--) {
        const member = path[index]!
        const { dispatch } = this.agents.get(member)!
        const parentId = this.parents.get(member)
        const parent =
          parentId === undefined
            ? undefined
            : (resolved.get(parentId) ?? this.agentFacts.get(parentId))
        const parentDispatch = dispatch === undefined ? undefined : this.tools.get(dispatch)
        resolved.set(member, {
          agentId: member,
          ...(dispatch === undefined ? {} : { dispatch }),
          ...(parentId === undefined ? {} : { parentAgentId: parentId }),
          complete:
            dispatch !== undefined &&
            this.tools.has(dispatch) &&
            (parentDispatch === undefined || parent !== undefined) &&
            (parent?.complete ?? true),
        })
      }
      return resolved.get(agentId)!
    }
    const changedAgents: Agent[] = []
    for (const agentId of affected) {
      const fact = resolve(agentId)
      const previous = this.agentFacts.get(agentId)
      if (
        previous !== undefined &&
        previous.dispatch === fact.dispatch &&
        previous.complete === fact.complete &&
        previous.parentAgentId === fact.parentAgentId
      )
        continue
      this.agentFacts.set(agentId, fact)
      changedAgents.push(fact)
    }
    if (changedAgents.length === 0 && changedTools.length === 0 && changedDispatches.length === 0)
      return undefined
    const context = this.contextChanged ? { missing: this.missing, truncated: this.truncated } : {}
    this.contextChanged = false
    return {
      update: true,
      agents: changedAgents,
      tools: changedTools,
      dispatches: changedDispatches,
      ...context,
    }
  }

  /** Full reads are for a separately bounded history/context projection. */
  read(
    missing: WorkAncestryContext['missing'] = this.missing,
    truncated = this.truncated,
  ): WorkAncestryFacts & WorkAncestryContext {
    return {
      missing,
      truncated,
      agents: [...this.agentFacts.values()],
      tools: [...this.toolFacts.values()],
      dispatches: [...this.dispatchFacts.values()],
    }
  }
}
