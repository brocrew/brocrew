import { describe, expect, it } from 'vitest'
import { admitGive, type GiveFacts } from '../src/main/runtime/spawn-rails'

const facts: GiveFacts = {
  giver: () => ({
    sessionId: 'sess_giver',
    profileId: 'lead',
    provider: 'claude',
    cwd: '/fictional',
    approvalMode: 'auto',
  }),
  held: () => [{ piece: 'root', label: 'W1', root: true, giver: null, received: true }],
  drivenByTheTurn: () => null,
  agentExists: (profile) => profile === 'reader',
  conversationAt: (address) =>
    address === 'W1.4'
      ? { conversation: 'sess_reader', profileId: 'reader', provider: 'claude' }
      : address === 'W1.9'
        ? { conversation: 'sess_writer', profileId: 'writer', provider: 'claude' }
        : null,
  recentWith: () => ({
    rows: [
      { address: 'W1.4', title: 'Lisbon trip' },
      { address: 'W1.2', title: null },
    ],
    more: true,
  }),
  serviceAt: () => ({ is: 'normal' }),
  itsProvider: () => ({ provider: 'claude', from: 'saved' }),
  theNamedModelsProvider: () => null,
  modelChoiceOf: () => null,
  checkFolder: (path) => ({ ok: true, path }),
}
const task = {
  profile: 'reader',
  title: 'Book the hotel',
  brief: 'Find a hotel near the centre.',
  definition_of_done: 'A hotel is booked.',
}
const give = (asked: Record<string, unknown>, when: GiveFacts = facts) =>
  admitGive({ ...task, ...asked }, { ownerId: 'agent:sess_giver' }, when)

describe('give_work names where the work goes', () => {
  it('refuses a give that names no conversation and lists the recent ones', () => {
    const refused = give({})
    expect(refused).toMatchObject({
      ok: false,
      refusal: { rail: 'name-the-conversation', detail: { more: true } },
    })
    if (refused.ok) throw new Error('expected a refusal')
    expect(refused.refusal.reason).toMatch(/^Not sent: /)
    expect(refused.refusal.reason).toContain('W1.4 · Lisbon trip')
    expect(refused.refusal.reason).toContain('W1.2')
  })

  it('starts a new conversation for to: "new", carrying its title', () => {
    expect(give({ to: 'new', conversation_title: 'Lisbon trip, March' })).toMatchObject({
      ok: true,
      goes: { to: 'a-new-conversation', title: 'Lisbon trip, March' },
    })
  })

  it('refuses to: "new" without a conversation title', () => {
    expect(give({ to: 'new' })).toMatchObject({
      ok: false,
      refusal: { rail: 'conversation-title-needed' },
    })
  })

  it('continues the conversation an address names', () => {
    expect(give({ to: 'W1.4' })).toMatchObject({
      ok: true,
      goes: { to: 'the-one-it-has', conversation: 'sess_reader' },
    })
  })

  it('refuses an address no conversation answers to', () => {
    expect(give({ to: 'W1.77' })).toMatchObject({
      ok: false,
      refusal: {
        rail: 'no-conversation-by-that-address',
        detail: { address: 'W1.77' },
        reason:
          'Not sent: no conversation has the address W1.77. list_agents lists conversations; to: "new" starts one.',
      },
    })
  })

  it("refuses an address of another agent's conversation", () => {
    expect(give({ to: 'W1.9' })).toMatchObject({
      ok: false,
      refusal: { rail: 'not-that-agents-conversation', detail: { ownerProfile: 'writer' } },
    })
  })

  it('keeps the provider of an existing conversation, and lets model and effort change', () => {
    expect(give({ to: 'W1.4', provider: 'codex' })).toMatchObject({
      ok: false,
      refusal: { rail: 'its-provider-is-fixed', detail: { provider: 'claude' } },
    })
    expect(give({ to: 'W1.4', model: 'fictional-model', effort: 'high' })).toMatchObject({
      ok: true,
      goes: { to: 'the-one-it-has', conversation: 'sess_reader' },
    })
  })

  it('takes a service’s matching address or its profile alone', () => {
    const service: GiveFacts = {
      ...facts,
      conversationAt: (address) =>
        address === 'W2'
          ? {
              conversation: 'sess_service',
              profileId: task.profile,
              provider: 'claude',
            }
          : facts.conversationAt(address),
      serviceAt: () => ({
        is: 'service',
        conversation: 'sess_service',
        provider: 'claude',
      }),
    }
    expect(give({}, service)).toMatchObject({
      ok: true,
      goes: { to: 'a-service', conversation: 'sess_service' },
    })
    expect(give({ to: 'W2' }, service)).toMatchObject({
      ok: true,
      goes: { to: 'a-service', conversation: 'sess_service' },
    })
    for (const to of ['new', 'W1.9']) {
      expect(give({ to }, service)).toMatchObject({
        ok: false,
        refusal: { rail: 'a-service-has-one-conversation' },
      })
    }
  })

  it('hangs the task under the task the giver names', () => {
    const held: GiveFacts = {
      ...facts,
      held: () => [
        { piece: 'root', label: 'W1', root: true, giver: null, received: true },
        { piece: 'work_a', label: 'W1.3', root: false, giver: 'sess_boss', received: true },
      ],
    }
    expect(give({ to: 'W1.4', under: 'W1.3' }, held)).toMatchObject({
      ok: true,
      under: { piece: 'work_a' },
    })
  })

  it('uses the giver’s root when its other brief has not arrived', () => {
    const held: GiveFacts = {
      ...facts,
      held: () => [
        { piece: 'root', label: 'W1', root: true, giver: null, received: true },
        { piece: 'work_a', label: 'W2.1', root: false, giver: 'sess_boss', received: false },
      ],
    }
    expect(give({ to: 'W1.4' }, held)).toMatchObject({ ok: true, under: { piece: 'root' } })
    expect(give({ to: 'W1.4', under: 'W2.1' }, held)).toMatchObject({
      ok: true,
      under: { piece: 'work_a' },
    })
    expect(
      give(
        { to: 'W1.4' },
        { ...held, held: (giver) => held.held(giver).filter((one) => !one.root) },
      ),
    ).toMatchObject({
      ok: false,
      refusal: { rail: 'name-the-piece-you-give-from', detail: { held: ['W2.1'] } },
    })
  })

  it('names each removed give field in its refusal', () => {
    for (const [field, value] of Object.entries({ parallel: true, new: true, piece: 'W1' })) {
      expect(give({ to: 'W1.4', [field]: value })).toMatchObject({
        ok: false,
        refusal: { rail: 'malformed-request', detail: { unknownFields: [field] } },
      })
    }
  })

  it('refuses a profile that does not exist and points to create_agent', () => {
    const refused = give({ profile: 'nobody', to: 'new', conversation_title: 'X' })
    expect(refused).toMatchObject({ ok: false, refusal: { rail: 'no-such-profile' } })
    if (refused.ok) throw new Error('expected a refusal')
    expect(refused.refusal.reason).toContain('create_agent')
  })
})
