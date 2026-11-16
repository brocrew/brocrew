import { expect, it, vi } from 'vitest'
import { defineComponent, h, provide, type Component } from 'vue'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import type { ClientProviderApi } from '../../src/shared/client-provider-api'
import type { ProviderLaunchChoices } from '../../src/shared/provider-launch'
import { DEFAULT_PROFILE_ID } from '../../src/shared/runtime-ipc'
import { theList } from '../../src/shared/model-choice'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import { createAttachmentBook, draftKey } from '../../src/renderer/src/lib/drafts'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import StartAsAgent from '../../src/renderer/src/components/StartAsAgent.vue'
import AgentModelChoice from '../../src/renderer/src/components/AgentModelChoice.vue'
import { mount, type Mounted } from './harness'
import { providerLaunchFixture, settleProviderLaunch as settle } from './provider-launch.fixture'

providerLaunchFixture()

const idOf = (provider: Provider, endpoint: 'a' | 'b') =>
  `fictional-${provider}-endpoint-${endpoint}`
const modelOf = (provider: Provider, endpoint: string) => `fictional-${provider}-${endpoint}-model`

function pending() {
  let resolve!: (answer: ProviderLaunchChoices) => void
  const promise = new Promise<ProviderLaunchChoices>((release) => {
    resolve = release
  })
  return { promise, resolve }
}

async function fixture(
  provider: Provider,
  options: {
    a?: ReturnType<typeof pending>
    b?: ReturnType<typeof pending>
    builtin?: boolean
    unread?: boolean
    scopedReady?: boolean
  } = {},
) {
  let defaultEndpoint: 'a' | 'b' = 'a'
  const runtime = window.api.runtime
  const local = createDesktopProviderApi(
    () => runtime,
    () => undefined,
  )
  function answer(connectionId?: string): ProviderLaunchChoices {
    const endpoint =
      connectionId === idOf(provider, 'a')
        ? 'a'
        : connectionId === idOf(provider, 'b')
          ? 'b'
          : 'legacy'
    const model = modelOf(provider, endpoint)
    const pair = { model, effort: `${endpoint}-low` }
    const connections = (['a', 'b'] as const).map<ProviderConnection>((kind) => ({
      provider,
      id: idOf(provider, kind),
      name: `Fictional endpoint ${kind}`,
      authMethod: 'sign-in',
      credentialSource: 'provider-sign-in',
      baseUrl: null,
      enabled: true,
      contractVersion: 1,
    }))
    return {
      list: {
        provider,
        models: theList(
          [
            {
              id: model,
              label: model,
              efforts: [{ id: pair.effort, label: pair.effort }],
              defaultEffort: pair.effort,
              isDefault: true,
            },
          ],
          [],
        ),
        notAsked: null,
        standIn: connectionId === undefined ? null : 'brobot',
        lastPicked: null,
        startsOn: { ...pair, from: 'the-providers-default' },
      },
      ready: connectionId === undefined ? true : (options.scopedReady ?? true),
      ...(connectionId !== undefined && options.scopedReady === false
        ? { reason: 'Fictional selected connection needs sign-in' }
        : {}),
      connections,
      defaultConnectionId:
        connectionId ?? (options.builtin ? `${provider}:sign-in` : idOf(provider, defaultEndpoint)),
      defaultModel: pair,
      defaultModelToSend: null,
    }
  }
  const read = vi.fn<ClientProviderApi['providerLaunchChoices']>(async (input) => {
    expect(input.provider).toBe(provider)
    if (input.connectionId !== undefined && options.unread)
      throw new Error('Fictional endpoint did not answer')
    if (input.connectionId === idOf(provider, 'a') && options.a) return options.a.promise
    if (input.connectionId === idOf(provider, 'b') && options.b) return options.b.promise
    return answer(input.connectionId)
  })
  const api: ClientProviderApi = {
    ...local,
    providerLaunchChoices: read,
    resolveProviderLaunch: async (input) => ({
      provider,
      pickerProvider: provider,
      connectionId:
        input.askedConnectionId ??
        (options.builtin ? `${provider}:sign-in` : idOf(provider, defaultEndpoint)),
      readiness: [{ provider, ready: true }],
    }),
  }
  const lists = createModelLists(() => api)
  await lists.read(provider)
  await lists.read(provider, 'fern')
  const store = createAgentStore(runtime)
  return {
    api,
    lists,
    store,
    read,
    answer,
    setDefault: (endpoint: 'a' | 'b') => {
      defaultEndpoint = endpoint
    },
  }
}

function withProviders(
  component: Component,
  props: Record<string, unknown>,
  api: ClientProviderApi,
) {
  return mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () => h(component, props)
      },
    }),
    {},
    { width: 1000, height: 900 },
  )
}

function front(
  out: Awaited<ReturnType<typeof fixture>>,
  provider: Provider,
  started: ReturnType<typeof vi.fn>,
) {
  return withProviders(
    NewConversation,
    {
      choices: { ...NO_LAUNCH_CHOICES },
      defaultProvider: provider,
      providerReadiness: { [provider]: true },
      defaultApprovalMode: 'ask',
      approvalDefaultChosen: true,
      draft: 'Keep these fictional words.',
      busy: false,
      error: null,
      handing: createAttachmentBook().handing(draftKey('fictional-scoped-door')),
      capabilities: null,
      lists: out.lists,
      onStart: started,
    },
    out.api,
  )
}

function asAgent(
  out: Awaited<ReturnType<typeof fixture>>,
  provider: Provider,
  started: ReturnType<typeof vi.fn>,
) {
  return withProviders(
    StartAsAgent,
    {
      profileSlug: 'fern',
      provider,
      defaultApprovalMode: 'ask',
      capabilities: null,
      lists: out.lists,
      agents: out.store,
      onStart: started,
    },
    out.api,
  )
}

function typeFirstMessage(m: Mounted) {
  const prompt = m.q('prompt-input') as HTMLTextAreaElement
  prompt.value = 'Keep these fictional words.'
  prompt.dispatchEvent(new Event('input'))
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: the untouched front door waits for its additional default connection and sends its identity`, async () => {
    const a = pending()
    const out = await fixture(provider, { a })
    const started = vi.fn()
    const m = front(out, provider, started)
    try {
      await settle()
      expect(out.read).toHaveBeenCalledWith({ provider, connectionId: idOf(provider, 'a') })
      expect(m.q('model-picker-face').textContent).not.toContain(modelOf(provider, 'legacy'))
      expect((m.q('send-prompt') as HTMLButtonElement).disabled).toBe(true)
      m.q('send-prompt').click()
      expect(started).not.toHaveBeenCalled()
    } finally {
      a.resolve(out.answer(idOf(provider, 'a')))
      await settle()
    }
    expect(m.q('model-picker-face').textContent).toContain(modelOf(provider, 'a'))
    m.q('send-prompt').click()
    await settle()
    expect(started).toHaveBeenCalledExactlyOnceWith(
      {
        provider,
        profileId: DEFAULT_PROFILE_ID,
        approvalMode: 'ask',
        connectionId: idOf(provider, 'a'),
      },
      'Keep these fictional words.',
      [],
    )
  })

  it(`${provider}: the front door uses an unready selected connection despite legacy/global readiness`, async () => {
    const out = await fixture(provider, { scopedReady: false })
    const started = vi.fn()
    const m = front(out, provider, started)
    await settle()
    expect(out.lists.choices(provider)?.ready).toBe(true)
    expect(out.read).toHaveBeenCalledWith({ provider, connectionId: idOf(provider, 'a') })
    expect((m.q('send-prompt') as HTMLButtonElement).disabled).toBe(true)
    expect(m.host.textContent).toContain('Fictional selected connection needs sign-in')
    m.q('send-prompt').click()
    expect(started).not.toHaveBeenCalled()
  })

  it(`${provider}: a late inherited A answer cannot supply a changed default B`, async () => {
    const a = pending(),
      b = pending()
    const out = await fixture(provider, { a, b })
    const started = vi.fn()
    const m = front(out, provider, started)
    try {
      await settle()
      out.setDefault('b')
      await out.lists.reread()
      await settle()
      expect(out.read).toHaveBeenCalledWith({ provider, connectionId: idOf(provider, 'b') })
      expect((m.q('send-prompt') as HTMLButtonElement).disabled).toBe(true)
      b.resolve(out.answer(idOf(provider, 'b')))
      await settle()
    } finally {
      a.resolve(out.answer(idOf(provider, 'a')))
      b.resolve(out.answer(idOf(provider, 'b')))
      await settle()
    }
    expect(m.q('model-picker-face').textContent).toContain(modelOf(provider, 'b'))
    expect(m.q('model-picker-face').textContent).not.toContain(modelOf(provider, 'a'))
    m.q('send-prompt').click()
    await settle()
    expect(started).toHaveBeenCalledExactlyOnceWith(
      {
        provider,
        profileId: DEFAULT_PROFILE_ID,
        approvalMode: 'ask',
        connectionId: idOf(provider, 'b'),
      },
      'Keep these fictional words.',
      [],
    )
  })

  it(`${provider}: Start as agent waits for its inherited connection and keeps the unpicked model omitted`, async () => {
    const a = pending()
    const out = await fixture(provider, { a })
    const started = vi.fn()
    const m = asAgent(out, provider, started)
    typeFirstMessage(m)
    try {
      await settle()
      expect(out.read).toHaveBeenCalledWith({
        provider,
        profileId: 'fern',
        connectionId: idOf(provider, 'a'),
      })
      expect((m.q('send-prompt') as HTMLButtonElement).disabled).toBe(true)
      m.q('send-prompt').click()
      expect(started).not.toHaveBeenCalled()
    } finally {
      a.resolve(out.answer(idOf(provider, 'a')))
      await settle()
    }
    m.q('send-prompt').click()
    await settle()
    expect(started).toHaveBeenCalledExactlyOnceWith(
      { provider, profileId: 'fern', approvalMode: 'ask', connectionId: idOf(provider, 'a') },
      'Keep these fictional words.',
      [],
    )
  })

  for (const example of [
    {
      name: 'a settled unready selected connection keeps the existing agent-launch attempt',
      options: { scopedReady: false },
      ready: false,
      reason: 'Fictional selected connection needs sign-in',
    },
    {
      name: 'a settled unread additional route keeps the existing agent-launch attempt',
      options: { unread: true },
      ready: null,
      reason: 'Fictional endpoint did not answer',
    },
  ]) {
    it(`${provider}: ${example.name}`, async () => {
      const out = await fixture(provider, example.options)
      const started = vi.fn()
      const m = asAgent(out, provider, started)
      typeFirstMessage(m)
      await settle()
      expect(out.lists.choices(provider, 'fern')?.ready).toBe(true)
      expect(out.lists.readiness(provider, 'fern', idOf(provider, 'a'))).toMatchObject({
        state: 'settled',
        ready: example.ready,
        reason: example.reason,
      })
      expect((m.q('send-prompt') as HTMLButtonElement).disabled).toBe(false)
      m.q('send-prompt').click()
      await settle()
      expect(started).toHaveBeenCalledExactlyOnceWith(
        { provider, profileId: 'fern', approvalMode: 'ask', connectionId: idOf(provider, 'a') },
        'Keep these fictional words.',
        [],
      )
    })
  }

  it(`${provider}: an untouched built-in default keeps the existing Start-as-agent wire omission`, async () => {
    const out = await fixture(provider, { builtin: true })
    const started = vi.fn()
    const m = asAgent(out, provider, started)
    typeFirstMessage(m)
    await settle()
    m.q('send-prompt').click()
    await settle()
    expect(started).toHaveBeenCalledExactlyOnceWith(
      { provider, profileId: 'fern', approvalMode: 'ask' },
      'Keep these fictional words.',
      [],
    )
  })

  it(`${provider}: the agent default editor names the stand-in from its held connection's list`, async () => {
    const out = await fixture(provider)
    window.api.runtime.agentModelAndEffort = vi.fn(async () => ({
      provider,
      connectionId: idOf(provider, 'a'),
      model: modelOf(provider, 'a'),
      effort: 'a-low',
    }))
    const write = vi.fn(window.api.runtime.setAgentModelAndEffort)
    window.api.runtime.setAgentModelAndEffort = write
    const m = withProviders(
      AgentModelChoice,
      {
        profileSlug: 'fern',
        runsOn: provider,
        itsProvider: provider,
        store: out.store,
        lists: out.lists,
        capabilities: null,
      },
      out.api,
    )
    await settle()
    m.q('model-picker-face').click()
    await settle()
    expect(m.q('model-picker-note').textContent).toBe(
      'This is BroBot’s list: this agent has no list of its own to ask.',
    )
    expect(m.all('model-picker-row').map((row) => row.dataset.model)).toEqual([
      modelOf(provider, 'a'),
    ])
    expect(write).not.toHaveBeenCalled()
  })
}
