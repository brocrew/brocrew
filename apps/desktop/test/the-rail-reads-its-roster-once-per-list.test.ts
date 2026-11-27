import { describe, expect, it } from 'vitest'
import { conversationList } from '../src/renderer/src/lib/conversation-list'
import { agentName, agentNamer } from '../src/shared/runtime-ipc'
import type { AgentIdentity, ResumableSessionInfo } from '../src/shared/runtime-ipc'

/**
 * 614 · On Chen's Default copy the rail lists 2,637 conversations, and each read named every row by
 * searching the roster, 20–28 ms of a 75 ms task. The roster is now read once per list.
 */

const identity = (slug: string, displayName: string | null): AgentIdentity => ({
  id: `aid:${slug}`,
  slug,
  displayName,
  createdAt: 0,
  createdBy: null,
  provider: null,
  externalMcpServerIds: [],
})

const row = (n: number, profileId: string | null): ResumableSessionInfo =>
  ({
    sessionId: `sess_${n}`,
    provider: 'claude',
    ref: { provider: 'claude', sessionId: `th_${n}`, cwd: '/w/one', rotation: 0 },
    cwd: '/w/one',
    status: 'ended',
    running: 'not-running',
    state: { is: 'idle' },
    approvalMode: 'ask',
    profileId,
    reasoningEffort: null,
    model: null,
    planMode: null,
    adoptedAt: null,
    hasTranscript: true,
    lastEnding: 'completed',
    child: null,
    updatedAt: n,
    resumeRefusal: null,
  }) as ResumableSessionInfo

/** The roster as a Vue reactive array would be: every element read is counted. */
function counted(roster: AgentIdentity[]): { list: AgentIdentity[]; reads: () => number } {
  let reads = 0
  const list = new Proxy(roster, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++
      return Reflect.get(target, key, receiver)
    },
  })
  return { list, reads: () => reads }
}

const ROSTER = [
  ...Array.from({ length: 40 }, (_, n) => identity(`agent-${n}`, `Agent ${n}`)),
  identity('dev', 'Ada'),
  identity('dev', 'Second Ada'),
  identity('unnamed', null),
]
const PROFILES = ['agent-3', 'Dev', 'unnamed', 'nobody-has-this', null, 'agent-39']
const ROWS = Array.from({ length: 600 }, (_, n) => row(n, PROFILES[n % PROFILES.length]!))

describe('614 · the rail names every row from one read of the roster', () => {
  it('🔴 600 rows read the roster once, not once per row', () => {
    const { list, reads } = counted(ROSTER)
    conversationList({ resumable: ROWS, unresumable: [], identities: list })
    // One pass is ROSTER.length element reads; a search per row was several thousand.
    expect(reads()).toBeLessThanOrEqual(ROSTER.length)
  })

  it('⚑ each row is named exactly as agentName names it', () => {
    const listed = conversationList({ resumable: ROWS, unresumable: [], identities: ROSTER })
    const byId = new Map(ROWS.map((one) => [one.sessionId, one.profileId]))
    for (const one of listed) expect(one.label).toBe(agentName(byId.get(one.sessionId)!, ROSTER))
  })

  it('⚑ the namer keeps agentName’s rules: folded slug, first match, unnamed, unknown, no roster', () => {
    const name = agentNamer(ROSTER)
    expect(name('Dev')).toBe('Ada')
    expect(name('unnamed')).toBe(agentName('unnamed', null))
    expect(name('nobody-has-this')).toBe(agentName('nobody-has-this', null))
    expect(agentNamer(null)(null)).toBe(agentName(null, null))
  })
})
