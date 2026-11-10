import { describe, expect, it } from 'vitest'
import { conversationList } from '../src/renderer/src/lib/conversation-list'
import type { ConversationListInput } from '../src/renderer/src/lib/conversation-list'
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_LABEL,
  agentName,
  foldProfileName,
  profileLabel,
} from '../src/shared/runtime-ipc'
import type { AgentIdentity, ResumableSessionInfo } from '../src/shared/runtime-ipc'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'

const identity = (slug: string, displayName: string | null): AgentIdentity => ({
  id: `aid:${slug}`,
  slug,
  displayName,
  createdAt: 0,
  createdBy: null,
  capabilities: DEFAULT_CAPABILITIES,
  chosen: {} as AgentIdentity['chosen'],
  provider: null,
  externalMcpServerIds: [],
})

const ROSTER = [
  identity(DEFAULT_PROFILE_ID, null),
  identity('project-manager', 'Project manager'),
  identity('worker', null),
]

describe('§0 · 592 · the seeded slug IS the product’s own name', () => {
  it('🔴 the slug is {@link DEFAULT_PROFILE_LABEL} folded — so the label adds a capital and nothing else', () => {
    expect(foldProfileName(DEFAULT_PROFILE_LABEL)).toBe(DEFAULT_PROFILE_ID)
    expect(DEFAULT_PROFILE_LABEL).not.toBe(DEFAULT_PROFILE_ID)
  })

  it('⛔ …and it is a special case about ONE slug, which is the half that survived the rename', () => {
    expect(profileLabel(DEFAULT_PROFILE_ID)).toBe(DEFAULT_PROFILE_LABEL)
    expect(profileLabel('some-other-agent')).toBe('some-other-agent')
  })
})

describe('§1 · one derivation, and it is the old one plus the roster', () => {
  it('🔴 with nothing to add, it IS profileLabel — over every shape of input', () => {
    for (const id of [null, DEFAULT_PROFILE_ID, 'project-manager', 'worker', 'never-seen']) {
      for (const roster of [null, [], ROSTER.filter((one) => one.slug === 'nobody')]) {
        expect(agentName(id, roster), `${String(id)} with ${JSON.stringify(roster)}`).toBe(
          profileLabel(id),
        )
      }
    }
    expect(agentName(null, null)).toBe(DEFAULT_PROFILE_LABEL)
    expect(agentName('worker', null)).toBe('worker')
    expect(agentName(null, null)).not.toBe(agentName('worker', null))
  })

  it('🔴 a capitalised spelling finds the identity it IS, and an unnamed one reads its ONE spelling', () => {
    const named: readonly AgentIdentity[] = [identity('dev', 'Ada')]
    expect(agentName('Dev', named)).toBe('Ada')
    expect(agentName('dev', named)).toBe('Ada')
    expect(agentName('Dev', [])).toBe('dev')
    expect(agentName('Dev', null)).toBe('dev')
    expect(agentName('dev', null)).toBe(agentName('Dev', null))
    expect(agentName('Dev', [identity('dev', 'Ada Lovelace')])).toBe('Ada Lovelace')
  })

  it('⛔ a display name a person set is what the row says, and only for that identity', () => {
    expect(agentName('project-manager', ROSTER)).toBe('Project manager')
    expect(agentName('worker', ROSTER)).toBe('worker')
    expect(agentName(DEFAULT_PROFILE_ID, ROSTER)).toBe(DEFAULT_PROFILE_LABEL)
  })

  it('⚑ a row recorded before profiles could be chosen is named as the default, not as nothing', () => {
    expect(agentName(null, ROSTER)).toBe(DEFAULT_PROFILE_LABEL)
    expect(agentName(null, ROSTER)).toBe(agentName(DEFAULT_PROFILE_ID, ROSTER))
  })
})

describe('§2 · the rail’s one list carries both facts, and the one that can be absent is the place', () => {
  const base: ResumableSessionInfo = {
    sessionId: 'sess_1',
    provider: 'claude',
    ref: { provider: 'claude', sessionId: 'th_1', cwd: '/w/one', rotation: 0 },
    cwd: '/w/one',
    status: 'ended',
    running: 'not-running',
    state: { is: 'idle' },
    approvalMode: 'ask',
    profileId: 'project-manager',
    reasoningEffort: null,
    model: null,
    planMode: null,
    adoptedAt: null,
    hasTranscript: true,
    lastEnding: 'completed',
    child: null,
    updatedAt: 0,
    resumeRefusal: null,
  } as ResumableSessionInfo

  const fold = (
    rows: ResumableSessionInfo[],
    identities: ConversationListInput['identities'] = ROSTER,
  ): ReturnType<typeof conversationList> =>
    conversationList({
      resumable: rows,
      unresumable: [],
      identities,
    })

  it('🔴 the row is named by the identity and placed by the folder — two fields, never one', () => {
    const [row] = fold([base])
    expect(row!.label).toBe('Project manager')
    expect(row!.place).toBe('one')
  })

  it('⛔ two conversations of one identity in two places do not fold to the same row', () => {
    const folded = fold([
      base,
      { ...base, sessionId: 'sess_2', cwd: '/w/two' } as ResumableSessionInfo,
    ])
    expect(folded).toHaveLength(2)
    expect(folded[0]!.label).toBe(folded[1]!.label)
    expect(folded[0]!.place).not.toBe(folded[1]!.place)
  })

  it('⚑ with no roster the row still says who, in the words the rest of the app uses', () => {
    const [row] = fold([base], null)
    expect(row!.label).toBe(profileLabel('project-manager'))
  })

  it('⛔ a row with no directory has no place at all — not an empty one', () => {
    const [row] = fold([{ ...base, cwd: '' } as ResumableSessionInfo])
    expect(row!.place).toBeNull()
    expect(row!.label).toBe('Project manager')
  })
})
