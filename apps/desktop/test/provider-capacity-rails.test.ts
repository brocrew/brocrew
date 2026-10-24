import { describe, expect, it } from 'vitest'
import { DEFAULT_CAPABILITIES } from '../src/main/db/session-store'
import { admitGive, type GiveFacts } from '../src/main/runtime/spawn-rails'

const facts: GiveFacts = {
  giver: () => ({
    sessionId: 'giver',
    profileId: 'lead',
    provider: 'claude',
    cwd: '/fictional',
    approvalMode: 'auto',
  }),
  held: () => [{ piece: 'root', label: 'W1', root: true, giver: null, received: true }],
  drivenByTheTurn: () => null,
  isAHelper: () => false,
  mayGiveWork: () => null,
  depthOf: () => 0,
  capabilitiesOf: () => DEFAULT_CAPABILITIES,
  helperAs: () => null,
  workerAt: () => ({ is: 'full' }),
  serviceAt: () => ({ is: 'normal' }),
  spawningEnabled: () => true,
  mayCreateAgents: () => null,
  itsProvider: () => ({ provider: 'claude', from: 'saved' }),
  theNamedModelsProvider: () => null,
  modelChoiceOf: () => null,
  checkFolder: () => ({ ok: true, path: '/fictional' }),
}
const give = (parallel: boolean, when: GiveFacts = facts) =>
  admitGive(
    {
      profile: 'draft-reader',
      provider: 'codex',
      parallel,
      title: 'Check the draft',
      brief: 'Read it',
      definition_of_done: 'The draft is checked.',
    },
    { ownerId: 'agent:giver' },
    when,
  )

describe('the shared normal-worker capacity and a new provider', () => {
  it('does not promise that waiting frees a bound pool for an ordinary conversation on another provider', () => {
    expect(give(false)).toMatchObject({
      ok: false,
      refusal: {
        rail: 'no-room-for-provider-conversation',
        permanence: 'until-a-person-changes-it',
        retryable: false,
        remedy: null,
        detail: { provider: 'codex', profileId: 'draft-reader' },
      },
    })
  })
  it('keeps the current retryable refusal for parallel work whose existing workers can become free', () => {
    expect(give(true)).toMatchObject({
      ok: false,
      refusal: {
        rail: 'no-free-worker-at-capacity',
        permanence: 'while-this-holds',
        retryable: true,
      },
    })
  })

  it('does not promise a retry for parallel work when no bound worker has the chosen provider', () => {
    expect(
      give(true, { ...facts, workerAt: () => ({ is: 'full', noProvider: true }) }),
    ).toMatchObject({
      ok: false,
      refusal: {
        rail: 'no-room-for-provider-conversation',
        permanence: 'until-a-person-changes-it',
        retryable: false,
        remedy: null,
      },
    })
  })
})
