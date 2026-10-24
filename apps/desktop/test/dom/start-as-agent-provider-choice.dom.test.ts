import { afterEach, describe, expect, it } from 'vitest'
import { nextTick, ref, type Component } from 'vue'
import StartAsAgent from '../../src/renderer/src/components/StartAsAgent.vue'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { theList } from '../../src/shared/model-choice'
import type { CreateSessionInput, Provider } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

afterEach(unmountAll)
async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}

function opened() {
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
  const m = mount(
    StartAsAgent as Component,
    {
      profileSlug: 'draft-reader',
      provider: 'claude',
      defaultApprovalMode: 'ask',
      capabilities: null,
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
        model: 'fictional-codex',
        reasoningEffort: 'low',
        approvalMode: 'ask',
      },
    ])
    expect(reads.every((read) => read.profileId === 'draft-reader')).toBe(true)
  })
})
