import type { AgentIdentity, ResumableSessionInfo } from '../../src/shared/runtime-ipc'
import type { AgentPanelSubAgent } from '../../src/renderer/src/lib/agent-panel'
import type { CastReading } from '../../src/renderer/src/lib/working-together'
import { facetsOfState, type RailSays } from '../../src/renderer/src/lib/agent-state'
import { agentStateWords, type AgentState } from '../../src/shared/agent-state'
import { panelIdentities } from './sub-agents-workers-fixture'
import { workerRows } from './parallel-workers-fixture'

export const OWNER = 'fictional-editor'

export function idlePanel(ordinary = 3, workers = 0) {
  const identities: AgentIdentity[] = Array.from({ length: Math.max(ordinary, 1) }, (_, index) => ({
    ...panelIdentities()[0]!,
    id: `aid:reader-${index + 1}`,
    slug: `reader-${index + 1}`,
    displayName: ['Maple', 'Cedar', 'Willow', 'Aspen', 'Hazel'][index] ?? `Reader ${index + 1}`,
  }))
  const rows: ResumableSessionInfo[] = workerRows(ordinary + workers).map((row, index) => ({
    ...row,
    sessionId: `fictional-reader-${index + 1}`,
    profileId: index < ordinary ? identities[index]!.slug : identities[0]!.slug,
    worker:
      index < ordinary
        ? undefined
        : {
            identity: identities[0]!.id,
            giver: OWNER,
            number: index - ordinary + 2,
            bornAs: `fictional-reader-${index + 1}`,
          },
    state: { is: 'idle' },
    named: { label: `W95.${index + 1}`, title: `Fictional draft ${index + 1}`, ended: 'answered' },
    running: 'not-running',
  }))
  const reading: CastReading = {
    conversation: OWNER,
    answered: true,
    atWork: null,
    read: {
      conversation: OWNER,
      parent: null,
      readAt: 1800000000000,
      children: {
        rows: rows.map((row) => ({
          conversation: row.sessionId,
          identity: row.profileId,
          provider: 'codex',
          running: 'not-running',
        })),
        walk: 'every-conversation-this-one-spawned',
        ledgers: rows.length,
        rowsUnread: 0,
      },
      workGivenOut: {
        rows: [],
        walk: 'every-conversation-this-one-gave-work-to',
        ledgers: 0,
        rowsUnread: 0,
      },
      workTakenIn: {
        rows: [],
        walk: 'every-piece-of-work-this-one-was-given',
        ledgers: 0,
        rowsUnread: 0,
      },
    },
  }
  const rail = (): ReadonlyMap<string, RailSays> =>
    new Map(
      rows.map((row) => [
        row.sessionId,
        {
          facets: facetsOfState(row.state),
          word:
            row.waitingOnPurpose && row.state.is === 'idle'
              ? 'waiting on purpose'
              : agentStateWords(row.state),
        },
      ]),
    )
  const telemetry = new Map<string, AgentPanelSubAgent>(
    rows.map((row) => [
      row.sessionId,
      {
        conversation: row.sessionId,
        name: row.sessionId,
        profile: row.profileId,
        facets: facetsOfState(row.state),
        word: 'idle',
        active: false,
        model: { value: null, why: 'Not recorded' },
        effort: { value: null, why: 'Not recorded' },
        context: { value: null, why: 'Not recorded' },
        memory: { value: null, why: 'Not recorded' },
        from: {},
      },
    ]),
  )
  const state = (index: number, next: AgentState) => {
    rows[index] = { ...rows[index]!, state: next }
  }
  return { rows, identities, reading, rail, telemetry, state }
}
