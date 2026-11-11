import { reactive } from 'vue'
import type { ClientSessionApi } from '../../../shared/client-session-api'
import type { AgentState } from '../../../shared/agent-state-contracts'
import { epochDecision, type PublicationEpoch } from '../../../shared/data-version'
import type { RuntimeEventMessage, RuntimeStatesMessage } from '../../../shared/runtime-ipc'
import { acceptProviderBlock, createSessionRecord, type SessionRecord } from './session-record'

export function createLiveSessionRecords(bridge: ClientSessionApi) {
  /**
   * `reactive` proxies a Map's own methods, so `set`/`delete` are tracked and the open list
   * recomputes. Insertion order is the Map's, which is the order sessions were started in.
   */
  const sessions = reactive(new Map<string, SessionRecord>())
  let stateEpoch: PublicationEpoch | null = null
  let stateRead = 0
  let stateReading = false
  let statesDisposed = false

  function hearAgentState(
    record: SessionRecord,
    value: AgentState | null,
    published: RuntimeStatesMessage['published'],
  ): void {
    if (statesDisposed) return
    if (published === undefined) {
      record.agentState = null
      return
    }
    const decision = epochDecision(stateEpoch, published.epoch)
    if (decision === 'drop') return
    if (decision === 'hold') {
      record.agentState = null
      return
    }
    if (decision === 'advance') {
      void readAgentStates()
      return
    }
    const before = record.agentStatePublication
    if (before !== undefined && published.seq <= before.seq) return
    record.agentState = value
    record.agentStatePublication = published
  }

  async function readAgentStates(): Promise<void> {
    if (typeof bridge.currentEpoch !== 'function' || typeof bridge.listConversations !== 'function')
      return
    const mine = ++stateRead
    stateReading = true
    stateEpoch = null
    for (const record of sessions.values()) {
      if (record.agentState !== undefined) record.agentState = null
      delete record.agentStatePublication
    }
    try {
      const epoch = await bridge.currentEpoch()
      if (statesDisposed || mine !== stateRead) return
      stateEpoch = epoch
      await readAgentListing(mine)
    } catch (error) {
      if (!statesDisposed && mine === stateRead)
        console.warn('Current agent states could not be read:', error)
    } finally {
      if (mine === stateRead) stateReading = false
    }
  }

  async function readAgentListing(mine = stateRead): Promise<void> {
    if (stateEpoch === null || statesDisposed) return
    try {
      const answer = await bridge.listConversations()
      if (statesDisposed || mine !== stateRead || 'refused' in answer) return
      for (const row of [...answer.resumable, ...answer.unresumable]) {
        const record = sessions.get(row.sessionId)
        if (record) hearAgentState(record, row.state, answer.published)
      }
    } catch (error) {
      if (!statesDisposed && mine === stateRead)
        console.warn('Current agent states could not be read:', error)
    }
  }

  function seedAgentState(record: SessionRecord): void {
    if (typeof bridge.currentEpoch !== 'function' || typeof bridge.listConversations !== 'function')
      return
    if (record.agentState === undefined) record.agentState = null
    if (stateEpoch === null) {
      if (!stateReading) void readAgentStates()
    } else void readAgentListing()
  }
  /**
   * A slot for a session, created on first sight — which may be an event that arrives before
   * the host has finished telling us what the session is.
   */
  function slot(sessionId: string): SessionRecord {
    const existing = sessions.get(sessionId)
    if (existing) return existing
    const record = reactive(createSessionRecord(sessionId)) as SessionRecord
    sessions.set(sessionId, record)
    return record
  }

  function hearEvent(message: RuntimeEventMessage): void {
    const record = sessions.get(message.sessionId)
    if (message.agentState !== undefined)
      hearAgentState(record ?? slot(message.sessionId), message.agentState, message.published)
    else if (record && message.ordinal >= record.nextOrdinal) {
      delete record.agentState
      delete record.agentStatePublication
    }
  }

  function hearMoved(message: RuntimeStatesMessage): void {
    if (
      !statesDisposed &&
      message.published !== undefined &&
      stateEpoch === null &&
      !stateReading
    )
      void readAgentStates()
    for (const moved of message.moved) {
      const record = sessions.get(moved.conversation)
      if (record) {
        acceptProviderBlock(record, moved)
        if (message.published !== undefined)
          hearAgentState(record, moved.state, message.published)
      }
    }
  }

  return {
    sessions,
    slot,
    read: readAgentStates,
    seed: seedAgentState,
    hearEvent,
    hearMoved,
    dispose() {
      statesDisposed = true
      stateRead++
      stateEpoch = null
    },
  }
}
