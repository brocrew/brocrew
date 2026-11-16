import { expect, it, vi } from 'vitest'
import { defineComponent, h, provide, ref } from 'vue'
import type { Provider } from '@brobot2/shared'
import type { ClientProviderApi } from '../../src/shared/client-provider-api'
import type { RuntimeBridge } from '../../src/shared/runtime-ipc'
import { DEFAULT_PROFILE_ID } from '../../src/shared/runtime-ipc'
import { theList } from '../../src/shared/model-choice'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import { NO_LAUNCH_CHOICES, type LaunchChoices } from '../../src/renderer/src/lib/launch-choices'
import { createAttachmentBook, draftKey } from '../../src/renderer/src/lib/drafts'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import StartAsAgent from '../../src/renderer/src/components/StartAsAgent.vue'
import AgentModelChoice from '../../src/renderer/src/components/AgentModelChoice.vue'
import { mount, type Mounted } from './harness'
import { providerLaunchFixture, settleProviderLaunch as settle } from './provider-launch.fixture'

providerLaunchFixture()

async function fixture(provider: Provider) {
  const runtime = window.api.runtime
  const local = createDesktopProviderApi(
    () => runtime,
    () => undefined,
  )
  const rows = await runtime.providerConnections()
  const api: ClientProviderApi = {
    ...local,
    providerLaunchChoices: async (input) => ({
      ...(await local.providerLaunchChoices(input)),
      list: {
        provider: input.provider,
        notAsked: null,
        standIn: null,
        startsOn: null,
        lastPicked: null,
        models: theList([{ id: 'fictional-small', label: 'Fictional small', efforts: [] }], []),
      },
      ready: true,
      defaultModel: { model: 'fictional-small', effort: null },
      defaultModelToSend: { model: 'fictional-small', effort: null },
      connections: rows
        .filter((row) => row.provider === input.provider)
        .flatMap((row) => [
          row,
          {
            ...row,
            id: `${input.provider}:api-key`,
            name: 'Fictional key',
            authMethod: 'api-key' as const,
            credentialSource: 'provider-api-key' as const,
          },
        ]),
      defaultConnectionId: `${input.provider}:sign-in`,
    }),
    resolveProviderLaunch: async (input) => ({
      provider: input.askedProvider ?? provider,
      pickerProvider: input.askedProvider ?? provider,
      connectionId: input.askedConnectionId ?? `${input.askedProvider ?? provider}:sign-in`,
      readiness: input.providers.map(({ provider }) => ({ provider, ready: true })),
    }),
  }
  runtime.agentModelAndEffort = vi.fn(async () => null)
  const write = vi.fn<RuntimeBridge['setAgentModelAndEffort']>()
  runtime.setAgentModelAndEffort = write
  const store = createAgentStore(runtime)
  const lists = createModelLists(() => api)
  return { api, store, lists, write }
}

async function pickKey(m: Mounted, provider: Provider) {
  m.q('model-picker-face').click()
  await settle()
  const row = m
    .all('model-picker-connection')
    .find((one) => one.dataset.connection === `${provider}:api-key`)
  expect(row).toBeDefined()
  row!.querySelector<HTMLInputElement>('input')!.click()
  await settle()
  m.q('model-picker-take').click()
  await settle()
}

function typeFirstMessage(m: Mounted) {
  const prompt = m.q('prompt-input') as HTMLTextAreaElement
  prompt.value = 'Keep these fictional words.'
  prompt.dispatchEvent(new Event('input'))
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: a front-door pick reaches the actual first-message settings`, async () => {
    const out = await fixture(provider)
    const choices = ref<LaunchChoices>({ ...NO_LAUNCH_CHOICES })
    const started = vi.fn()
    const shownProvider = ref<Provider>(provider)
    const handing = createAttachmentBook().handing(draftKey('fictional-connection-launch'))
    const frame = defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, out.api)
        return () =>
          h(NewConversation, {
            choices: choices.value,
            'onUpdate:choices': (next: LaunchChoices) => {
              choices.value = next
            },
            defaultProvider: shownProvider.value,
            providerReadiness: { claude: true, codex: true },
            draft: 'Keep these fictional words.',
            busy: false,
            error: null,
            handing,
            defaultApprovalMode: 'ask',
            approvalDefaultChosen: true,
            capabilities: null,
            lists: out.lists,
            onStart: started,
          })
      },
    })
    const m = mount(frame, {}, { width: 1000, height: 900 })
    await pickKey(m, provider)
    expect(Reflect.get(choices.value, 'connectionId')).toBe(`${provider}:api-key`)
    m.q('send-prompt').click()
    await settle()
    expect(started).toHaveBeenCalledExactlyOnceWith(
      {
        provider,
        profileId: DEFAULT_PROFILE_ID,
        approvalMode: 'ask',
        model: 'fictional-small',
        connectionId: `${provider}:api-key`,
      },
      'Keep these fictional words.',
      [],
    )
    started.mockClear()
    const other = provider === 'claude' ? 'codex' : 'claude'
    shownProvider.value = other
    await settle()
    typeFirstMessage(m)
    await settle()
    m.q('send-prompt').click()
    await settle()
    expect(started).toHaveBeenCalledExactlyOnceWith(
      {
        provider: other,
        profileId: DEFAULT_PROFILE_ID,
        approvalMode: 'ask',
        model: 'fictional-small',
      },
      'Keep these fictional words.',
      [],
    )
  })

  it(`${provider}: Start as agent carries the picked connection without editing its default`, async () => {
    const out = await fixture(provider)
    const started = vi.fn()
    const frame = defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, out.api)
        return () =>
          h(StartAsAgent, {
            profileSlug: 'fern',
            provider,
            defaultApprovalMode: 'ask',
            capabilities: null,
            lists: out.lists,
            agents: out.store,
            onStart: started,
          })
      },
    })
    const m = mount(frame, {}, { width: 900, height: 900 })
    await pickKey(m, provider)
    typeFirstMessage(m)
    await settle()
    m.q('send-prompt').click()
    await settle()
    expect(started).toHaveBeenCalledExactlyOnceWith(
      {
        provider,
        profileId: 'fern',
        approvalMode: 'ask',
        model: 'fictional-small',
        connectionId: `${provider}:api-key`,
      },
      'Keep these fictional words.',
      [],
    )
    expect(out.write).not.toHaveBeenCalled()
  })

  it(`${provider}: default Save carries its connection through the actual store and flat bridge`, async () => {
    const out = await fixture(provider)
    out.write.mockResolvedValue({
      ok: true,
      choice: {
        provider,
        model: 'fictional-small',
        effort: null,
        connectionId: `${provider}:api-key`,
      },
    })
    const frame = defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, out.api)
        return () =>
          h(AgentModelChoice, {
            profileSlug: 'fern',
            runsOn: provider,
            itsProvider: provider,
            store: out.store,
            lists: out.lists,
            capabilities: null,
          })
      },
    })
    const m = mount(frame, {}, { width: 900, height: 900 })
    await settle()
    await pickKey(m, provider)
    expect(out.write).toHaveBeenCalledExactlyOnceWith({
      profileId: 'fern',
      provider,
      model: 'fictional-small',
      effort: null,
      connectionId: `${provider}:api-key`,
    })
  })

  it(`${provider}: the store forwards an explicit connection even without the drawing`, async () => {
    const out = await fixture(provider)
    out.write.mockResolvedValue({
      ok: true,
      choice: {
        provider,
        model: 'fictional-small',
        effort: null,
        connectionId: `${provider}:api-key`,
      },
    })
    await out.store.chooseModelFor('fern', {
      provider,
      model: 'fictional-small',
      effort: null,
      connectionId: `${provider}:api-key`,
    })
    expect(out.write).toHaveBeenCalledExactlyOnceWith({
      profileId: 'fern',
      provider,
      model: 'fictional-small',
      effort: null,
      connectionId: `${provider}:api-key`,
    })
  })

  it(`${provider}: model-only defaults and full clear preserve the old flat payloads`, async () => {
    const out = await fixture(provider)
    out.write.mockResolvedValueOnce({
      ok: true,
      choice: { provider, model: 'fictional-small', effort: null },
    })
    out.write.mockResolvedValueOnce({ ok: true, choice: null })
    await out.store.chooseModelFor('fern', { provider, model: 'fictional-small', effort: null })
    await out.store.chooseModelFor('fern', null)
    expect(out.write.mock.calls.map(([input]) => input)).toEqual([
      { profileId: 'fern', provider, model: 'fictional-small', effort: null },
      { profileId: 'fern', provider: null, model: null, effort: null },
    ])
  })
}
