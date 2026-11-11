import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, reactive, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { PROVIDER_DESCRIPTORS, providerDescriptor } from '@brobot2/shared'
import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'
import type { AuthState, Provider } from '../../src/shared/runtime-ipc'
import { DEFAULT_PROFILE_ID } from '../../src/shared/runtime-ipc'
import type { ClientProviderApi } from '../../src/shared/client-provider-api'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import ProviderCard from '../../src/renderer/src/components/ProviderCard.vue'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import SignInPanel from '../../src/renderer/src/components/SignInPanel.vue'
import { useProviderNames } from '../../src/renderer/src/composables/useProviderNames'
import {
  forgetProfileSignIns,
  signInFact,
} from '../../src/renderer/src/composables/useProfileSignIn'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'
import { providersBridge } from '../../look/fixtures/providers'
import { META, mount, paneProps, record, unmountAll, type Mounted } from './harness'

const absent: AuthState = { state: 'absent', reason: 'Selected account needs a sign-in.' }
const usable: AuthState = { state: 'usable', login: 'account', expiresAt: null }
const capability = { state: 'available', checkedAgainst: 'Fictional selected provider' } as const
const capabilities = allProviderCapabilities()
const selectedCapabilities = {
  ...capabilities,
  claude: { ...capabilities.claude, signIn: capability, reprovisionAuth: capability },
}
const settle = async () => {
  for (let index = 0; index < 5; index++) {
    await nextTick()
    await new Promise((done) => setTimeout(done, 0))
  }
}

beforeEach(() => {
  providersBridge()
})
afterEach(() => {
  unmountAll()
  forgetProfileSignIns()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
})

function selected(name = 'Fern', state = absent) {
  const descriptors = PROVIDER_DESCRIPTORS.map((descriptor) => ({
    ...descriptor,
    displayName: descriptor.id === 'claude' ? name : 'Birch',
  }))
  const raw = vi.spyOn(window.api.runtime, 'providerCatalogue')
  const rawAuth = vi.spyOn(window.api.runtime, 'checkProviderAuth').mockResolvedValue(usable)
  const transport = {
    ...window.api.runtime,
    providerCatalogue: vi.fn<ClientProviderApi['providerCatalogue']>(async function (this: object) {
      expect(this).toBe(transport)
      return descriptors
    }),
    checkProviderAuth: vi.fn<ClientProviderApi['checkProviderAuth']>(async function (this: object) {
      expect(this).toBe(transport)
      return state
    }),
    apiKeyStatus: vi.fn<ClientProviderApi['apiKeyStatus']>(async ({ provider }) => ({
      provider,
      set: false,
      setAt: null,
      inUse: false,
    })),
    providerLaunchChoices: vi.fn<ClientProviderApi['providerLaunchChoices']>(
      async ({ provider }) => ({
        list: {
          provider,
          models: [],
          notAsked: null,
          standIn: null,
          startsOn: null,
          lastPicked: null,
        },
        ready: true,
        defaultModel: null,
        defaultModelToSend: null,
      }),
    ),
    resolveProviderLaunch: vi.fn<ClientProviderApi['resolveProviderLaunch']>(async () => ({
      provider: 'claude',
      pickerProvider: 'claude',
      readiness: [],
    })),
  }
  const api = createDesktopProviderApi(
    () => transport,
    () => undefined,
  )
  signInFact({ provider: 'claude', profileId: DEFAULT_PROFILE_ID }, api).auth = state
  return { api, transport, descriptors, raw, rawAuth }
}

function ancestor(component: Component, props: Record<string, unknown>, api: ClientProviderApi) {
  return mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () => h(component, props)
      },
    }),
    {},
  )
}

async function caller(
  kind: 'card' | 'launcher' | 'pane',
  out: ReturnType<typeof selected>,
): Promise<{ m: Mounted; props: Record<string, unknown> }> {
  if (kind === 'card') {
    const props = reactive({
      provider: 'claude' as Provider,
      capabilities: selectedCapabilities,
      limit: null,
      limitsRead: true,
      clock: Date.now(),
      version: { version: null, reason: 'Selected program observation.' },
      readings: [],
      resources: null,
      resourcesPaused: false,
      resourcesError: null,
      loginMoved: 0,
    })
    return { m: ancestor(ProviderCard, props, out.api), props }
  }
  if (kind === 'launcher') {
    const props = reactive({
      busy: false,
      error: null as string | null,
      defaultApprovalMode: 'ask' as const,
      approvalDefaultChosen: true,
      providerReadiness: { claude: true, codex: true },
      draft: 'Keep the draft.',
      handing: createAttachmentBook().handing(NEW_CONVERSATION),
      defaultProvider: 'claude' as Provider,
      choices: NO_LAUNCH_CHOICES,
      capabilities: selectedCapabilities,
      models: null,
      onStart: (): void => {
        props.busy = true
      },
    })
    const m = ancestor(NewConversation, props, out.api)
    await settle()
    m.q('send-prompt').click()
    await nextTick()
    expect(props.busy).toBe(true)
    props.busy = false
    props.error = 'The selected launch did not start.'
    await settle()
    return { m, props }
  }
  const r = record([])
  r.meta = { ...META, provider: 'claude', profileId: DEFAULT_PROFILE_ID }
  const props = reactive(paneProps({ record: r, capabilities: selectedCapabilities }))
  return { m: ancestor(ConversationPane, props, out.api), props }
}

it.each(['card', 'launcher', 'pane'] as const)(
  '%s uses the selected ancestor name, supplied reason and original check gesture',
  async (kind) => {
    const out = selected()
    const { m } = await caller(kind, out)
    await settle()
    expect(m.q('sign-in-heading').textContent).toBe('Sign in to use Fern with this agent')
    expect(m.q('sign-in-reason').textContent).toBe(absent.reason)
    expect(m.q('sign-in-heading').textContent).not.toContain('Claude')
    expect((m.q('sign-in-check') as HTMLButtonElement).disabled).toBe(false)
    const before = out.transport.checkProviderAuth.mock.calls.length
    m.q('sign-in-check').click()
    await settle()
    expect(out.transport.checkProviderAuth.mock.calls.slice(before)).toEqual([
      [
        {
          provider: 'claude',
          profileId: DEFAULT_PROFILE_ID,
          ...(kind === 'card' ? { probe: true } : {}),
        },
      ],
    ])
    expect(out.raw).not.toHaveBeenCalled()
    expect(out.rawAuth).not.toHaveBeenCalled()
  },
)

it.each(['launcher', 'pane'] as const)(
  '%s keeps actions available while the selected catalogue is late, then names its answer',
  async (kind) => {
    const out = selected()
    let answer!: (value: typeof out.descriptors) => void
    out.transport.providerCatalogue.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    const { m } = await caller(kind, out)
    await settle()
    expect(m.q('sign-in-heading').textContent).toBe('Sign in to use this provider with this agent')
    expect((m.q('sign-in-check') as HTMLButtonElement).disabled).toBe(false)
    expect((m.q('sign-in-start') as HTMLButtonElement).disabled).toBe(false)
    answer(out.descriptors)
    await settle()
    expect(m.q('sign-in-heading').textContent).toBe('Sign in to use Fern with this agent')
    expect(out.transport.providerCatalogue).toHaveBeenCalledTimes(1)
    expect(out.raw).not.toHaveBeenCalled()
  },
)

it('keeps two real launcher clients distinct instead of letting the first name capture the second', async () => {
  const one = selected('Fern')
  const two = selected('Willow')
  const first = await caller('launcher', one)
  const second = await caller('launcher', two)
  await settle()
  expect(first.m.q('sign-in-heading').textContent).toContain('Fern')
  expect(second.m.q('sign-in-heading').textContent).toContain('Willow')
  expect(second.m.q('sign-in-heading').textContent).not.toContain('Fern')
  first.m.unmount()
  second.m.q('sign-in-check').click()
  await settle()
  expect(second.m.q('sign-in-heading').textContent).toContain('Willow')
})

it.each([
  ['absent', 'Sign in to use Fern with this agent'],
  ['stale', 'Sign in again to use Fern with this agent'],
  ['unknown', "Couldn't check this agent's Fern sign-in"],
] as const)('names the %s panel without rewriting the supplied reason', async (state, heading) => {
  const props = reactive({
    provider: 'claude',
    displayName: 'Fern',
    state: { state, reason: 'Exact selected reason.' },
    signIn: capability,
    reprovision: capability,
    busy: 'idle',
    notice: null,
  })
  const m = mount(SignInPanel, props)
  await settle()
  expect(m.q('sign-in-heading').textContent).toBe(heading)
  expect(m.q('sign-in-reason').textContent).toBe('Exact selected reason.')
  props.displayName = 'Willow'
  await settle()
  expect(m.q('sign-in-heading').textContent).toBe(heading.replace('Fern', 'Willow'))
})

it('the card passes its explicitly supplied descriptor name to its nested panel', async () => {
  const out = selected('Catalogue Fern')
  const props = reactive({
    provider: 'claude',
    descriptor: { ...providerDescriptor('claude'), displayName: 'Explicit Willow' },
    capabilities: selectedCapabilities,
    limit: null,
    limitsRead: true,
    clock: Date.now(),
    version: { version: null, reason: 'Selected program observation.' },
    readings: [],
    resources: null,
    resourcesPaused: false,
    resourcesError: null,
    loginMoved: 0,
  })
  const m = ancestor(ProviderCard, props, out.api)
  await settle()
  expect(m.q('sign-in-heading').textContent).toBe('Sign in to use Explicit Willow with this agent')
  props.descriptor = { ...props.descriptor, displayName: 'Later Rowan' }
  await settle()
  expect(m.q('sign-in-heading').textContent).toBe('Sign in to use Later Rowan with this agent')
})

it('updates a real card heading when the live provider key changes', async () => {
  const out = selected()
  signInFact({ provider: 'codex', profileId: DEFAULT_PROFILE_ID }, out.api).auth = absent
  const { m, props } = await caller('card', out)
  await settle()
  expect(m.q('sign-in-heading').textContent).toBe('Sign in to use Fern with this agent')
  props.provider = 'codex'
  await settle()
  expect(m.q('sign-in-heading').textContent).toBe('Sign in to use Birch with this agent')
  expect(m.q('sign-in-reason').textContent).toBe(absent.reason)
})

it('does not read names for an unmounted SSR setup, then reads once on mount', async () => {
  const out = selected()
  const Probe = defineComponent({
    setup() {
      const name = useProviderNames(out.api)
      return () => h('p', { 'data-cy': 'selected-name' }, name('claude') ?? 'this provider')
    },
  })
  expect(await renderToString(h(Probe))).toContain('this provider')
  expect(out.transport.providerCatalogue).not.toHaveBeenCalled()
  expect(out.raw).not.toHaveBeenCalled()
  const m = mount(Probe, {})
  await settle()
  expect(m.q('selected-name').textContent).toBe('Fern')
  expect(out.transport.providerCatalogue).toHaveBeenCalledTimes(1)
  expect(out.raw).not.toHaveBeenCalled()
})
