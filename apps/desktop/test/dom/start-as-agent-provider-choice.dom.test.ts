import { afterEach, describe, expect, it } from 'vitest'
import { nextTick, ref, type Component } from 'vue'
import StartAsAgent from '../../src/renderer/src/components/StartAsAgent.vue'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { theList } from '../../src/shared/model-choice'
import type {
  CreateSessionInput,
  Provider,
  ProviderCapabilityMap,
} from '../../src/shared/runtime-ipc'
import { CAPABILITY_FIXTURE } from '../provider-capability-fixture'
import { mount, unmountAll } from './harness'

afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
})
async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}

function opened(
  options: {
    approvalMode?: 'ask' | 'auto'
    capabilities?: ProviderCapabilityMap
    defaultConnection?: string
    provider?: Provider
  } = {},
) {
  Reflect.set(window, 'api', {
    runtime: {
      providerConnections: async () =>
        (['claude', 'codex'] as const).map((provider) => ({
          id: `${provider}:sign-in`,
          provider,
          name: 'Fictional subscription',
          authMethod: 'sign-in',
          credentialSource: 'provider-sign-in',
          baseUrl: null,
          enabled: true,
          contractVersion: 1,
        })),
    },
  })
  if (options.defaultConnection !== undefined) {
    const declared = window.api.runtime.providerConnections
    window.api.runtime.providerConnections = async () => [
      ...(await declared()),
      {
        id: 'codex:api-key',
        provider: 'codex',
        name: 'API key',
        authMethod: 'api-key',
        credentialSource: 'provider-api-key',
        baseUrl: null,
        enabled: true,
        contractVersion: 1,
      },
    ]
  }
  const started: CreateSessionInput[] = []
  const reads: { provider: Provider; profileId?: string }[] = []
  const lists = createModelLists(() => ({
    modelList: async (input) => {
      reads.push(input)
      return {
        provider: input.provider,
        notAsked: null,
        standIn: null,
        models: theList(
          [
            {
              id: `fictional-${input.provider}`,
              label: `Fictional ${input.provider}`,
              isDefault: true,
              efforts: [{ id: 'low', label: 'low' }],
              defaultEffort: 'low',
            },
          ],
          [],
        ),
        lastPicked: null,
        startsOn: null,
      }
    },
    addHandAddedModel: async () => [],
    deleteHandAddedModel: async () => [],
  }))
  const agents = {
    identities: ref(
      options.defaultConnection === undefined
        ? null
        : {
            identities: [
              {
                slug: 'draft-reader',
                provider: options.provider ?? 'claude',
                connectionId: options.defaultConnection,
              },
            ],
          },
    ),
  } as unknown as AgentStore
  const m = mount(
    StartAsAgent as Component,
    {
      profileSlug: 'draft-reader',
      provider: options.provider ?? 'claude',
      defaultApprovalMode: options.approvalMode ?? 'ask',
      capabilities: options.capabilities ?? null,
      agents,
      lists,
      onStart: (input: CreateSessionInput) => started.push(input),
    },
    { width: 700, height: 750 },
  )
  return { m, started, reads }
}

describe('choosing a provider for a new conversation as an existing agent', () => {
  it('keeps an untouched launch byte-identical and reads no model list on mount', async () => {
    const { m, started, reads } = opened()
    await settle()
    expect(reads).toEqual([])
    const prompt = m.q('prompt-input') as HTMLTextAreaElement
    prompt.value = 'Read the fictional draft.'
    prompt.dispatchEvent(new Event('input'))
    await settle()
    m.q('send-prompt').click()
    await settle()
    expect(started).toEqual([
      { profileId: 'draft-reader', provider: 'claude', approvalMode: 'ask' },
    ])
  })

  it('uses another provider and model for this conversation without changing the agent default', async () => {
    const { m, started, reads } = opened()
    m.q('model-picker-face').click()
    await settle()
    const connection = m.q('model-picker-connection') as HTMLSelectElement
    connection.value = 'codex:sign-in'
    connection.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    const row = m
      .q('model-picker-panel')
      .querySelector<HTMLInputElement>(
        '[data-cy="model-picker-provider"][data-provider="codex"] input[type="radio"]',
      )
    expect(row).not.toBeNull()
    row!.click()
    await settle()
    m.q('model-picker-take').click()
    await settle()
    expect(m.host.textContent).toContain('It will run on Codex')
    const prompt = m.q('prompt-input') as HTMLTextAreaElement
    prompt.value = 'Read the fictional draft.'
    prompt.dispatchEvent(new Event('input'))
    await settle()
    m.q('send-prompt').click()
    await settle()
    expect(started).toEqual([
      {
        profileId: 'draft-reader',
        provider: 'codex',
        connectionId: 'codex:sign-in',
        model: 'fictional-codex',
        reasoningEffort: 'low',
        approvalMode: 'ask',
      },
    ])
    expect(reads.every((read) => read.profileId === 'draft-reader')).toBe(true)
  })

  it('shows the selected provider’s approval reach before any launch', async () => {
    const claude = CAPABILITY_FIXTURE.claude.approvals
    const codex = CAPABILITY_FIXTURE.codex.approvals
    if (claude.state !== 'available' || codex.state !== 'available') {
      throw new Error('the fictional approval notes are not available')
    }
    const { m, started } = opened({ approvalMode: 'auto', capabilities: CAPABILITY_FIXTURE })
    expect(m.q('yolo-reach').textContent?.trim()).toBe(claude.note)
    m.q('model-picker-face').click()
    await settle()
    const connection = m.q('model-picker-connection') as HTMLSelectElement
    connection.value = 'codex:sign-in'
    connection.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    const row = m
      .q('model-picker-panel')
      .querySelector<HTMLInputElement>(
        '[data-cy="model-picker-provider"][data-provider="codex"] input[type="radio"]',
      )
    expect(row).not.toBeNull()
    row!.click()
    await settle()
    m.q('model-picker-take').click()
    await settle()
    expect(m.q('yolo-reach').textContent?.trim()).toBe(codex.note)
    expect(started).toEqual([])
  })
})

it('a stored connection without a model preselects its route before a new conversation', async () => {
  const { m, reads } = opened({ provider: 'codex', defaultConnection: 'codex:sign-in' })
  await settle()
  expect(reads).toEqual([])
  m.q('model-picker-face').click()
  await settle()
  expect((m.q('model-picker-connection') as HTMLSelectElement).value).toBe('codex:sign-in')
  expect(reads).toEqual([
    { provider: 'codex', profileId: 'draft-reader', connectionId: 'codex:sign-in' },
  ])
})
