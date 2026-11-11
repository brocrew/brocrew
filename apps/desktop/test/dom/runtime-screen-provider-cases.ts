import { expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, ref, isProxy, type Component } from 'vue'
import type { ProviderProgram, RuntimeBridge } from '../../src/shared/runtime-ipc'
import { DEFAULT_PROFILE_ID } from '../../src/shared/runtime-ipc'
import type { ResolvedProviderLaunch } from '../../src/shared/provider-launch'
import type { ClientProviderApi } from '../../src/shared/client-provider-api'
import { PROVIDER_DESCRIPTORS, type ProviderDescriptor } from '@brobot2/shared'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { createSessionStore } from '../../src/renderer/src/lib/session-store'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'
import { useProfileSignIn } from '../../src/renderer/src/composables/useProfileSignIn'
import { useOverlays } from '../../src/renderer/src/lib/overlay-store'
import { createModelLists as suppliedModelLists } from '../../src/renderer/src/lib/model-lists'
import { resolveProviderLaunch } from '../lib/provider-launch-fixture'
import { providersBridge } from '../../look/fixtures/providers'
import { mount, unmountAll } from './harness'
import {
  sessions,
  agentStore,
  runtime,
  replaceFixtureAgentStore,
  replaceFixtureSessionStore,
  replaceFixtureModelLists,
} from './runtime-screen-fixture'

export function registerRootProviderCases(RuntimeScreen: Component) {
  it('retains the actual root one-shot setup route until its deferred provider catalogue answers', async () => {
    const original = window.api
    providersBridge()
    const providerRuntime = window.api.runtime
    let answer!: (value: readonly ProviderDescriptor[]) => void
    const catalogue = new Promise<readonly ProviderDescriptor[]>((resolve) => {
      answer = resolve
    })
    const read = vi.fn(() => catalogue)
    window.api = {
      ...original,
      runtime: {
        ...providerRuntime,
        ...original.runtime,
        providerCatalogue: read,
        modelList: providerRuntime.modelList,
        checkProviderAuth: async ({ provider }) =>
          provider === 'codex'
            ? { state: 'absent', why: 'no-login', reason: 'No fictional login.' }
            : { state: 'usable', login: 'account', expiresAt: null },
      },
    }
    useProfileSignIn('codex', DEFAULT_PROFILE_ID).auth = {
      state: 'absent',
      why: 'no-login',
      reason: 'No fictional login.',
    }
    const api = createDesktopProviderApi(
      () => window.api.runtime,
      () => undefined,
    )
    const host = defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () => h(RuntimeScreen)
      },
    })
    try {
      const screen = mount(host, {})
      await expect.poll(() => screen.all('model-picker-face').length).toBe(1)
      screen.q('model-picker-face').click()
      await expect.poll(() => screen.all('model-picker-setup-codex').length).toBe(1)
      screen.q('model-picker-setup-codex').click()
      await expect.poll(() => read.mock.calls.length).toBe(1)
      // The real openProviderSettings nextTick cleanup runs before this catalogue can resolve.
      await nextTick()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(screen.all('provider-drawer')).toHaveLength(0)
      answer(PROVIDER_DESCRIPTORS)
      await expect.poll(() => screen.all('provider-card').length).toBe(1)
      expect(screen.q('provider-card').getAttribute('data-provider')).toBe('codex')
      expect(screen.q('provider-inline-setup')).toBeDefined()
    } finally {
      unmountAll()
      window.api = original
    }
  })

  it('carries actual root reactive programme facts through the desktop adapter and armed wire', async () => {
    const original = window.api
    providersBridge()
    const providerRuntime = window.api.runtime
    const program = ref<ProviderProgram>({
      standing: 'tested',
      from: null,
      path: null,
      version: null,
      tested: null,
      said: 'Fictional observed programme',
      help: null,
      update: null,
      others: [],
      updatedFrom: null,
    })
    const resolve = vi.fn<RuntimeBridge['resolveProviderLaunch']>(async (input) =>
      resolveProviderLaunch(input, null),
    )
    window.api = {
      ...original,
      runtime: {
        ...providerRuntime,
        ...original.runtime,
        modelList: providerRuntime.modelList,
        providerLaunchChoices: providerRuntime.providerLaunchChoices,
        resolveProviderLaunch: resolve,
        providerVersions: async () => ({
          claude: { version: 'fictional', program: program.value },
          codex: { version: null, reason: 'No fictional Codex version observation.' },
        }),
      },
    }
    const api = createDesktopProviderApi(
      () => window.api.runtime,
      () => undefined,
    )
    replaceFixtureModelLists(suppliedModelLists(() => api))
    const host = defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () => h(RuntimeScreen)
      },
    })
    try {
      const screen = mount(host, {})
      await expect
        .poll(() =>
          resolve.mock.calls.some(([input]) =>
            input.providers.some(
              (row) => row.provider === 'claude' && row.program?.standing === 'tested',
            ),
          ),
        )
        .toBe(true)
      const observed = resolve.mock.calls
        .flatMap(([input]) => input.providers)
        .find((row) => row.provider === 'claude' && row.program?.standing === 'tested')
      expect(observed?.program).toEqual({ standing: 'tested' })
      expect(isProxy(program.value)).toBe(true)
      expect(isProxy(observed?.program)).toBe(false)
      expect(observed?.program).not.toBe(program.value)
      await expect.poll(() => screen.all('model-picker-face').length).toBe(1)
      expect(screen.all('launch-choices-unread')).toHaveLength(0)
      const delivered = resolve.mock.calls.length
      await expect(
        window.api.runtime.resolveProviderLaunch({
          askedProvider: null,
          providers: [{ provider: 'claude', ready: true, program: program.value }],
        }),
      ).rejects.toThrow(/would not survive ipcRenderer\.invoke/)
      expect(resolve).toHaveBeenCalledTimes(delivered)
    } finally {
      unmountAll()
      replaceFixtureModelLists(null)
      window.api = original
    }
  })

  async function placedProviderScreen(resolve: ClientProviderApi['resolveProviderLaunch']) {
    const original = window.api
    providersBridge()
    const providerRuntime = window.api.runtime
    window.api = {
      ...original,
      runtime: { ...providerRuntime, ...original.runtime, modelList: providerRuntime.modelList },
    }
    sessions.dispose()
    replaceFixtureSessionStore(createSessionStore(window.api.runtime))
    replaceFixtureAgentStore(createAgentStore(window.api.runtime))
    const api: ClientProviderApi = {
      ...createDesktopProviderApi(
        () => window.api.runtime,
        () => undefined,
      ),
      resolveProviderLaunch: (input) =>
        input.profileId === DEFAULT_PROFILE_ID || input.providers.length > 0
          ? providerRuntime.resolveProviderLaunch(input)
          : resolve(input),
    }
    replaceFixtureModelLists(suppliedModelLists(() => api))
    const host = defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () => h(RuntimeScreen)
      },
    })
    const screen = mount(host, {}, { width: 1200, height: 800 })
    await expect.poll(() => agentStore.loaded.value).toBe(true)
    await expect.poll(() => screen.all('model-picker-face').length).toBe(1)
    return screen
  }
  const suppliedPlacedProvider = (provider: 'claude' | 'codex'): ResolvedProviderLaunch => ({
    provider,
    pickerProvider: null,
    readiness: [],
  })

  it('uses supplied core choice for the actual placed sheet and launch despite the saved identity', async () => {
    const resolve = vi.fn<ClientProviderApi['resolveProviderLaunch']>(async () =>
      suppliedPlacedProvider('claude'),
    )
    const screen = await placedProviderScreen(resolve)
    const create = vi.spyOn(sessions, 'create').mockResolvedValue(null)
    useOverlays().open({ kind: 'startAsAgent', profileSlug: 'editor' })
    await expect.poll(() => screen.all('start-as-agent').length).toBe(1)
    expect(screen.q('start-as-agent').textContent).toContain('It will run on Claude')
    expect(agentStore.identities.value?.identities[0]?.provider).toBe('codex')
    expect(resolve).toHaveBeenCalledWith({
      profileId: 'editor',
      askedProvider: null,
      providers: [],
    })
    const prompt = screen
      .q('start-as-agent')
      .querySelector<HTMLTextAreaElement>('[data-cy="prompt-input"]')!
    prompt.value = 'Read this fictional draft.'
    prompt.dispatchEvent(new Event('input'))
    await nextTick()
    screen.q('start-as-agent').querySelector<HTMLButtonElement>('[data-cy="send-prompt"]')!.click()
    await expect.poll(() => create.mock.calls.length).toBe(1)
    expect(create.mock.calls[0]?.[0]).toMatchObject({ profileId: 'editor', provider: 'claude' })
    expect(runtime.send).not.toHaveBeenCalled()
  })

  it('uses the same supplied provider for capability disclosure and its placed-conversation door', async () => {
    const resolve = vi.fn<ClientProviderApi['resolveProviderLaunch']>(async () =>
      suppliedPlacedProvider('claude'),
    )
    const screen = await placedProviderScreen(resolve)
    useOverlays().open({ kind: 'agentCapabilities', profileSlug: 'editor' })
    await expect.poll(() => screen.all('capabilities-sheet').length).toBe(1)
    expect(screen.q('capabilities-provider-note').textContent).toContain('Claude')
    screen.q('capabilities-start-conversation').click()
    await expect.poll(() => screen.all('start-as-agent').length).toBe(1)
    expect(screen.q('start-as-agent').textContent).toContain('It will run on Claude')
    expect(resolve.mock.calls.map(([input]) => input.profileId)).toEqual(['editor', 'editor'])
  })

  it('disowns older profile, close, same-profile reopen and unmount resolution answers', async () => {
    const answers: ((value: ResolvedProviderLaunch) => void)[] = []
    const resolve = vi.fn<ClientProviderApi['resolveProviderLaunch']>(
      () => new Promise((done) => answers.push(done)),
    )
    const screen = await placedProviderScreen(resolve)
    useOverlays().open({ kind: 'startAsAgent', profileSlug: 'first-draft' })
    await nextTick()
    expect(screen.all('start-as-agent')).toHaveLength(0)
    expect(screen.q('overlay-provider-status').textContent).toContain('Reading launch choices')
    useOverlays().open({ kind: 'startAsAgent', profileSlug: 'editor' })
    await nextTick()
    answers[0]!(suppliedPlacedProvider('codex'))
    await nextTick()
    expect(screen.all('start-as-agent')).toHaveLength(0)
    screen.q('overlay-provider-close').focus()
    answers[1]!(suppliedPlacedProvider('claude'))
    await expect.poll(() => screen.all('start-as-agent').length).toBe(1)
    expect(screen.q('start-as-agent-title').textContent).toContain('Editor')
    expect(document.activeElement).toBe(
      screen.q('start-as-agent').querySelector('[data-cy="close-overlay"]'),
    )
    useOverlays().open({ kind: 'startAsAgent', profileSlug: 'editor' })
    await nextTick()
    useOverlays().close()
    answers[2]!(suppliedPlacedProvider('codex'))
    await nextTick()
    expect(useOverlays().overlay.value).toBeNull()
    expect(screen.all('start-as-agent')).toHaveLength(0)
    useOverlays().open({ kind: 'startAsAgent', profileSlug: 'editor' })
    await nextTick()
    useOverlays().close()
    useOverlays().open({ kind: 'startAsAgent', profileSlug: 'editor' })
    await nextTick()
    answers[3]!(suppliedPlacedProvider('codex'))
    await nextTick()
    expect(screen.all('start-as-agent')).toHaveLength(0)
    answers[4]!(suppliedPlacedProvider('claude'))
    await expect.poll(() => screen.all('start-as-agent').length).toBe(1)
    useOverlays().open({ kind: 'agentCapabilities', profileSlug: 'editor' })
    await nextTick()
    unmountAll()
    answers[5]!(suppliedPlacedProvider('codex'))
    await nextTick()
    expect(screen.host.querySelector('[data-cy="capabilities-sheet"]')).toBeNull()
  })

  it('reports a refused resolution and retries without a fallback or losing a refreshed draft', async () => {
    const resolve = vi
      .fn<ClientProviderApi['resolveProviderLaunch']>()
      .mockRejectedValueOnce(new Error('Fictional launch choice unreadable'))
      .mockResolvedValueOnce(suppliedPlacedProvider('claude'))
    const screen = await placedProviderScreen(resolve)
    useOverlays().open({ kind: 'startAsAgent', profileSlug: 'editor' })
    await expect.poll(() => screen.all('overlay-provider-retry').length).toBe(1)
    expect(screen.q('overlay-provider-status').textContent).toContain(
      'Fictional launch choice unreadable',
    )
    expect(screen.all('start-as-agent')).toHaveLength(0)
    screen.q('overlay-provider-retry').click()
    await expect.poll(() => screen.all('start-as-agent').length).toBe(1)
    const prompt = screen
      .q('start-as-agent')
      .querySelector<HTMLTextAreaElement>('[data-cy="prompt-input"]')!
    prompt.value = 'Keep this draft during the roster read.'
    prompt.dispatchEvent(new Event('input'))
    let finish!: (value: ResolvedProviderLaunch) => void
    resolve.mockReturnValueOnce(
      new Promise((done) => {
        finish = done
      }),
    )
    runtime.agentIdentities.mockResolvedValueOnce({ ...agentStore.identities.value! })
    await agentStore.load()
    await nextTick()
    expect(screen.q('start-as-agent').querySelector('textarea')).toBe(prompt)
    expect(screen.q('start-as-agent').closest('[inert]')).not.toBeNull()
    finish(suppliedPlacedProvider('codex'))
    await expect
      .poll(() => screen.q('start-as-agent').textContent)
      .toContain('It will run on Codex')
    expect(prompt.value).toBe('Keep this draft during the roster read.')
    expect(screen.q('start-as-agent').closest('[inert]')).toBeNull()
  })

  async function frontDoorChoiceScreen() {
    const original = window.api
    providersBridge()
    const providerRuntime = window.api.runtime
    window.api = {
      ...original,
      runtime: { ...providerRuntime, ...original.runtime },
    }
    let identity: 'claude' | 'codex' = 'claude'
    const ready = { claude: true, codex: true }
    const resolve = vi.fn<ClientProviderApi['resolveProviderLaunch']>(async (input) =>
      resolveProviderLaunch(input, identity),
    )
    const api: ClientProviderApi = {
      ...createDesktopProviderApi(
        () => window.api.runtime,
        () => undefined,
      ),
      resolveProviderLaunch: resolve,
      providerLaunchChoices: async ({ provider }) => ({
        ready: ready[provider],
        defaultModel: { model: `${provider}-default`, effort: null },
        defaultModelToSend: null,
        list: {
          provider,
          notAsked: null,
          standIn: null,
          lastPicked: null,
          startsOn: null,
          models: ['default', 'person'].map((name) => ({
            id: `${provider}-${name}`,
            label: `${provider}-${name}`,
            ...(name === 'default' ? { isDefault: true as const } : {}),
            efforts: [],
            addedBy: 'the-provider' as const,
          })),
        },
      }),
    }
    const lists = suppliedModelLists(() => api)
    replaceFixtureModelLists(lists)
    const host = defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () => h(RuntimeScreen)
      },
    })
    const screen = mount(host, {}, { width: 1200, height: 800 })
    await expect.poll(() => agentStore.loaded.value).toBe(true)
    await expect.poll(() => screen.q('model-picker-face').textContent).toContain('claude-default')
    const prompt = screen.q('prompt-input') as HTMLTextAreaElement
    prompt.value = 'Keep this unsent provider draft.'
    prompt.dispatchEvent(new Event('input'))
    await nextTick()
    return {
      screen,
      resolve,
      prompt,
      async changeIdentity(provider: 'claude' | 'codex') {
        identity = provider
        runtime.agentIdentities.mockResolvedValueOnce({ ...agentStore.identities.value! })
        await agentStore.load()
      },
      async changeReadiness(provider: 'claude' | 'codex', value: boolean) {
        ready[provider] = value
        lists.forget(DEFAULT_PROFILE_ID)
        await Promise.all(
          ['claude', 'codex'].map((one) =>
            lists.read(one as 'claude' | 'codex', DEFAULT_PROFILE_ID),
          ),
        )
      },
    }
  }

  it('keeps an untouched root choice automatic when the core identity default changes', async () => {
    const { screen, resolve, prompt, changeIdentity } = await frontDoorChoiceScreen()
    expect(resolve.mock.calls.every(([input]) => input.askedProvider === null)).toBe(true)
    await changeIdentity('codex')
    await expect.poll(() => screen.q('model-picker-face').textContent).toContain('codex-default')
    expect(resolve.mock.calls.every(([input]) => input.askedProvider === null)).toBe(true)
    expect(screen.q('prompt-input')).toBe(prompt)
    expect(prompt.value).toBe('Keep this unsent provider draft.')
    const create = vi.spyOn(sessions, 'create').mockResolvedValue(null)
    screen.q('send-prompt').click()
    await expect.poll(() => create.mock.calls.length).toBe(1)
    expect(create.mock.calls[0]?.[0]).toMatchObject({ provider: 'codex' })
  })

  it('retains an explicit root provider and model through a temporary core fallback', async () => {
    const { screen, resolve, prompt, changeIdentity, changeReadiness } =
      await frontDoorChoiceScreen()
    screen.q('model-picker-face').click()
    await expect.poll(() => screen.all('model-picker-choose-codex').length).toBe(1)
    screen.q('model-picker-choose-codex').click()
    await nextTick()
    screen.host
      .querySelector<HTMLInputElement>(
        '[data-cy="model-picker-row"][data-model="codex-person"] input',
      )!
      .click()
    await nextTick()
    screen.q('model-picker-take').click()
    await expect.poll(() => screen.q('model-picker-face').textContent).toContain('codex-person')
    await changeIdentity('claude')
    await changeReadiness('codex', false)
    await expect.poll(() => screen.q('model-picker-face').textContent).toContain('claude-default')
    await changeReadiness('codex', true)
    await expect.poll(() => screen.q('model-picker-face').textContent).toContain('codex-person')
    expect(resolve.mock.calls.at(-1)?.[0].askedProvider).toBe('codex')
    expect(prompt.value).toBe('Keep this unsent provider draft.')
    const create = vi.spyOn(sessions, 'create').mockResolvedValue(null)
    screen.q('send-prompt').click()
    await expect.poll(() => create.mock.calls.length).toBe(1)
    expect(create.mock.calls[0]?.[0]).toMatchObject({ provider: 'codex', model: 'codex-person' })
  })
}
