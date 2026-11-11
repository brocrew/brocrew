import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, ref, unref, type MaybeRef } from 'vue'
import type { Provider, ProviderProgram } from '../../src/shared/runtime-ipc'
import type {
  ProviderLaunchChoices,
  ResolvedProviderLaunch,
} from '../../src/shared/provider-launch'
import type { ClientProviderApi } from '../../src/shared/client-provider-api'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'
import ModelPicker from '../../src/renderer/src/components/ModelPicker.vue'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import { providersBridge } from '../../look/fixtures/providers'
import { mount, unmountAll } from './harness'

const FABLE = 'fable' as Provider
const FERN = 'fern' as Provider
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}
beforeEach(() => providersBridge())
afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
})

function answer(provider: Provider, ready: boolean | null = true): ProviderLaunchChoices {
  return {
    list: {
      provider,
      notAsked: { ok: false, reason: 'refused', detail: 'auth.json missing; not signed in' },
      standIn: null,
      lastPicked: null,
      startsOn: null,
      models: [
        { id: 'first', label: 'First', efforts: [], isDefault: true, addedBy: 'the-provider' },
        { id: 'supplied', label: 'Supplied', efforts: [], addedBy: 'the-provider' },
      ],
    },
    ready,
    defaultModel: { model: 'supplied', effort: null },
    defaultModelToSend: { model: 'supplied', effort: null },
  }
}
function fixture() {
  const read = vi.fn<ClientProviderApi['providerLaunchChoices']>(async ({ provider }) =>
    answer(provider),
  )
  const resolve = vi.fn<ClientProviderApi['resolveProviderLaunch']>(async () => ({
    provider: FABLE,
    pickerProvider: FABLE,
    readiness: [
      { provider: FERN, ready: true },
      { provider: FABLE, ready: true },
    ],
  }))
  const api: ClientProviderApi = {
    ...createDesktopProviderApi(
      () => window.api.runtime,
      () => undefined,
    ),
    providerLaunchChoices: read,
    resolveProviderLaunch: resolve,
  }
  const lists = createModelLists(() => api)
  return { api, lists, read, resolve }
}
function picker(
  out: ReturnType<typeof fixture>,
  take = vi.fn(async () => null),
  programs: MaybeRef<Partial<Record<Provider, ProviderProgram>> | null> = null,
) {
  const host = defineComponent({
    setup() {
      provide(CLIENT_PROVIDERS, out.api)
      return () =>
        h(ModelPicker, {
          providers: [FERN, FABLE],
          shown: null,
          lists: out.lists,
          programs: unref(programs),
          empty: 'Choose a model',
          takeWords: 'Use this',
          take,
        })
    },
  })
  return mount(host, {}, { width: 900, height: 900 })
}

it('uses the supplied nonfirst provider and model despite native-looking missing-login prose', async () => {
  const out = fixture()
  await out.lists.read(FERN)
  await out.lists.read(FABLE)
  const take = vi.fn(async () => null)
  const m = picker(out, take)
  m.q('model-picker-face').click()
  await settle()
  expect((m.q('model-picker-choose-fable') as HTMLInputElement).checked).toBe(true)
  expect((m.q('model-picker-choose-fable') as HTMLInputElement).disabled).toBe(false)
  const selected = m.host.querySelector<HTMLInputElement>(
    '[data-cy="model-picker-row"][data-model="supplied"] input',
  )!
  expect(selected.checked).toBe(true)
  m.q('model-picker-take').click()
  await settle()
  expect(take).toHaveBeenCalledExactlyOnceWith({ provider: FABLE, model: 'supplied', effort: null })
  expect(out.resolve.mock.calls[0]?.[0]).toMatchObject({
    askedProvider: null,
    providers: [
      { provider: FERN, ready: true, program: null },
      { provider: FABLE, ready: true, program: null },
    ],
  })
})

it('keeps a newer manual provider choice ahead of an older selection answer', async () => {
  const out = fixture()
  await out.lists.read(FERN)
  await out.lists.read(FABLE)
  let finish!: (value: ResolvedProviderLaunch) => void
  out.resolve.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const m = picker(out)
  m.q('model-picker-face').click()
  await settle()
  m.q('model-picker-choose-fern').click()
  await settle()
  finish({
    provider: FABLE,
    pickerProvider: FABLE,
    readiness: [
      { provider: FERN, ready: true },
      { provider: FABLE, ready: true },
    ],
  })
  await settle()
  expect((m.q('model-picker-choose-fern') as HTMLInputElement).checked).toBe(true)
  expect(m.q('model-picker-provider').getAttribute('data-provider')).toBe(FERN)
})

it('sends the supplied fictional launch pair instead of inferring a row default', async () => {
  const out = fixture()
  await out.lists.read(FABLE)
  const start = vi.fn()
  const host = defineComponent({
    setup() {
      provide(CLIENT_PROVIDERS, out.api)
      return () =>
        h(NewConversation, {
          busy: false,
          error: null,
          draft: 'Keep these typed words',
          defaultProvider: FABLE,
          providerReadiness: { [FABLE]: true },
          defaultApprovalMode: 'ask',
          approvalDefaultChosen: true,
          capabilities: null,
          choices: { ...NO_LAUNCH_CHOICES },
          lists: out.lists,
          onStart: start,
        })
    },
  })
  const m = mount(host, {}, { width: 1000, height: 900 })
  await settle()
  expect(m.q('model-picker-face').textContent).toContain('supplied')
  m.q('send-prompt').click()
  await settle()
  expect(start.mock.calls[0]?.[0]).toMatchObject({ provider: FABLE, model: 'supplied' })
  expect(start.mock.calls[0]?.[1]).toBe('Keep these typed words')
})

it('forwards an existing programme observation and uses core-returned readiness for controls', async () => {
  const out = fixture()
  await out.lists.read(FERN)
  await out.lists.read(FABLE)
  const program: ProviderProgram = {
    standing: 'missing',
    from: null,
    path: null,
    version: null,
    tested: null,
    said: 'Fictional programme unavailable',
    help: null,
    update: null,
    others: [],
    updatedFrom: null,
  }
  out.resolve.mockResolvedValue({
    provider: FABLE,
    pickerProvider: FABLE,
    readiness: [
      { provider: FERN, ready: false },
      { provider: FABLE, ready: true },
    ],
  })
  const m = picker(
    out,
    vi.fn(async () => null),
    { [FERN]: program },
  )
  m.q('model-picker-face').click()
  await settle()
  expect(out.resolve.mock.calls[0]?.[0].providers[0]).toEqual({
    provider: FERN,
    ready: true,
    program: { standing: program.standing },
  })
  expect((m.q('model-picker-choose-fern') as HTMLInputElement).disabled).toBe(true)
  expect((m.q('model-picker-choose-fable') as HTMLInputElement).checked).toBe(true)
})

it('focuses the arrived model after a deferred core selection', async () => {
  const out = fixture()
  await out.lists.read(FERN)
  await out.lists.read(FABLE)
  let finish!: (value: ResolvedProviderLaunch) => void
  out.resolve.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const m = picker(out)
  m.q('model-picker-face').click()
  await settle()
  finish({
    provider: FABLE,
    pickerProvider: FABLE,
    readiness: [
      { provider: FERN, ready: true },
      { provider: FABLE, ready: true },
    ],
  })
  await settle()
  const row = m.host.querySelector<HTMLInputElement>(
    '[data-cy="model-picker-row"][data-model="supplied"] input',
  )!
  expect(document.activeElement).toBe(row)
})

it('projects a reactive programme into a plain DTO through the actual desktop wire', async () => {
  const out = fixture()
  await out.lists.read(FERN)
  await out.lists.read(FABLE)
  const programs = ref<Partial<Record<Provider, ProviderProgram>> | null>({
    [FERN]: {
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
    },
  })
  window.api = {
    ...window.api,
    runtime: { ...window.api.runtime, resolveProviderLaunch: out.resolve },
  }
  out.api.resolveProviderLaunch = createDesktopProviderApi(
    () => window.api.runtime,
    () => undefined,
  ).resolveProviderLaunch
  const m = picker(
    out,
    vi.fn(async () => null),
    programs,
  )
  m.q('model-picker-face').click()
  await settle()
  expect((m.q('model-picker-choose-fable') as HTMLInputElement).checked).toBe(true)
  expect(out.resolve.mock.calls[0]?.[0].providers[0]?.program).toEqual({ standing: 'tested' })
  expect(out.resolve.mock.calls[0]?.[0].providers[0]?.program).not.toBe(programs.value?.[FERN])
  const delivered = out.resolve.mock.calls.length
  await expect(
    window.api.runtime.resolveProviderLaunch({
      askedProvider: null,
      providers: [{ provider: FERN, ready: true, program: programs.value?.[FERN] }],
    }),
  ).rejects.toThrow(/would not survive ipcRenderer\.invoke/)
  expect(out.resolve).toHaveBeenCalledTimes(delivered)
})

it('accepts newer unready facts after a person edits the still-enabled old model', async () => {
  const out = fixture()
  await out.lists.read(FERN)
  await out.lists.read(FABLE)
  const programs = ref<Partial<Record<Provider, ProviderProgram>> | null>(null)
  const m = picker(
    out,
    vi.fn(async () => null),
    programs,
  )
  m.q('model-picker-face').click()
  await settle()
  let finish!: (value: ResolvedProviderLaunch) => void
  out.resolve.mockReturnValueOnce(
    new Promise((done) => {
      finish = done
    }),
  )
  programs.value = {
    [FABLE]: {
      standing: 'missing',
      from: null,
      path: null,
      version: null,
      tested: null,
      said: 'Fictional programme removed',
      help: null,
      update: null,
      others: [],
      updatedFrom: null,
    },
  }
  await settle()
  const first = m.host.querySelector<HTMLInputElement>(
    '[data-cy="model-picker-row"][data-model="first"] input',
  )!
  first.click()
  await settle()
  expect(first.checked).toBe(true)
  finish({
    provider: FERN,
    pickerProvider: FERN,
    readiness: [
      { provider: FERN, ready: true },
      { provider: FABLE, ready: false },
    ],
  })
  await settle()
  expect(first.checked).toBe(true)
  expect((m.q('model-picker-choose-fable') as HTMLInputElement).checked).toBe(true)
  expect((m.q('model-picker-choose-fable') as HTMLInputElement).disabled).toBe(true)
  expect((m.q('model-picker-take') as HTMLButtonElement).disabled).toBe(true)
})

async function waitingForFirstLists() {
  const out = fixture()
  const lists = new Map<Provider, (answer: ProviderLaunchChoices) => void>()
  out.read.mockImplementation(({ provider }) => new Promise((done) => lists.set(provider, done)))
  const selections: ((value: ResolvedProviderLaunch) => void)[] = []
  out.resolve
    .mockResolvedValueOnce({
      provider: FABLE,
      pickerProvider: null,
      readiness: [
        { provider: FERN, ready: null },
        { provider: FABLE, ready: null },
      ],
    })
    .mockImplementation(() => new Promise((done) => selections.push(done)))
  const m = picker(out)
  m.q('model-picker-face').click()
  await settle()
  expect(m.all('model-picker-row')).toHaveLength(0)
  lists.get(FERN)!(answer(FERN))
  lists.get(FABLE)!(answer(FABLE))
  await settle()
  expect(selections.length).toBeGreaterThan(0)
  expect(m.all('model-picker-row')).toHaveLength(0)
  return {
    m,
    finish() {
      selections.at(-1)!({
        provider: FABLE,
        pickerProvider: FABLE,
        readiness: [
          { provider: FERN, ready: true },
          { provider: FABLE, ready: true },
        ],
      })
    },
  }
}

it('focuses the current selection when first list arrival replaces the initial null selection', async () => {
  const { m, finish } = await waitingForFirstLists()
  finish()
  await settle()
  const row = m.host.querySelector<HTMLInputElement>(
    '[data-cy="model-picker-row"][data-model="supplied"] input',
  )!
  expect(row.checked).toBe(true)
  expect(document.activeElement).toBe(row)
})

it.each(['move', 'close', 'unmount'] as const)(
  'a first-list replacement selection respects a newer focus or lifetime: %s',
  async (action) => {
    const { m, finish } = await waitingForFirstLists()
    const outside = document.createElement('button')
    outside.textContent = 'Another action'
    document.body.append(outside)
    try {
      if (action === 'close') m.q('model-picker-face').click()
      if (action === 'unmount') unmountAll()
      outside.focus()
      await settle()
      finish()
      await settle()
      expect(document.activeElement).toBe(outside)
      if (action !== 'move') expect(m.all('model-picker-row')).toHaveLength(0)
    } finally {
      outside.remove()
    }
  },
)
