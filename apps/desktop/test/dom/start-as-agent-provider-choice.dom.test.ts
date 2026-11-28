import { createModelLists } from '../lib/provider-launch-fixture'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, provide, ref, type Component } from 'vue'
import { SUPPORTED_PROVIDERS, providerDescriptor } from '@brobot2/shared'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { desktopProviderApi } from '../../src/renderer/src/client-provider/window'
import { TeamLauncherFixture } from './team-launcher.fixture'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'

import { theList } from '../../src/shared/model-choice'
import type {
  CreateSessionInput,
  Provider,
  ProviderCapabilityMap,
} from '../../src/shared/runtime-ipc'
import { CAPABILITY_FIXTURE } from '../provider-capability-fixture'
import { mount, unmountAll } from './harness'

afterEach(unmountAll)
async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}

function opened(
  options: { approvalMode?: 'ask' | 'auto'; capabilities?: ProviderCapabilityMap } = {},
) {
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
  const agents = { identities: ref(null) } as unknown as AgentStore
  const catalogueClient = Object.create(desktopProviderApi, {
    providerCatalogue: { value: async () => SUPPORTED_PROVIDERS.map(providerDescriptor) },
  })
  const m = mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, catalogueClient)
        return () =>
          h(TeamLauncherFixture as Component, {
            profileSlug: 'draft-reader',
            provider: 'claude',
            defaultApprovalMode: options.approvalMode ?? 'ask',
            capabilities: options.capabilities ?? null,
            agents,
            lists,
            onStart: (input: CreateSessionInput) => started.push(input),
          })
      },
    }),
    {},
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
    m.q('model-picker-choose-codex').click()
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
    expect(m.q('model-picker-face').textContent).toContain('fictional-codex')
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
        model: 'fictional-codex',
        reasoningEffort: 'low',
        approvalMode: 'ask',
      },
    ])
    expect(reads.every((read) => read.profileId === 'draft-reader')).toBe(true)
  })

  it('keeps the short Auto wording when the provider changes', async () => {
    const { m } = opened({ approvalMode: 'auto', capabilities: CAPABILITY_FIXTURE })
    const note = m.q('first-approval-description').textContent
    expect(note).toContain('Runs without asking.')
    m.q('model-picker-face').click()
    await settle()
    m.q('model-picker-choose-codex').click()
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
    expect(m.q('first-approval-description').textContent).toBe(note)
  })
})
