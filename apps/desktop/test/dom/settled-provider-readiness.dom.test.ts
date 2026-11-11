import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide } from 'vue'
import type { AuthState } from '@brobot2/runtime'
import type { Provider } from '../../src/shared/runtime-ipc'
import { DEFAULT_PROFILE_ID, PROVIDER_NAME } from '../../src/shared/runtime-ipc'
import type { ModelList } from '../../src/shared/model-choice-contracts'
import type { ProviderLaunchChoices } from '../../src/shared/provider-launch'
import { providerLaunchChoices } from '../../src/main/runtime/provider-launch'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import { providersBridge } from '../../look/fixtures/providers'
import { mount, unmountAll } from './harness'

const providers = Object.keys(PROVIDER_NAME) as Provider[]
const unknown: AuthState = { state: 'unknown', reason: 'Fictional auth check could not be read.' }
const usable: AuthState = { state: 'usable', login: 'account', expiresAt: null }
const list = (provider: Provider, notAsked: ModelList['notAsked']): ModelList => ({
  provider,
  notAsked,
  standIn: null,
  lastPicked: { model: 'manual', effort: null },
  startsOn: null,
  models: [{ id: 'manual', label: 'Manual choice', addedBy: 'a-person' }],
})
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

it.each(['unknown auth', 'refused catalogue', 'rejected read', 'omitted reason'] as const)(
  'ends checking on settled %s, preserves supplied facts, and updates after recovery',
  async (failure) => {
    const gates = new Map<
      Provider,
      {
        resolve: (value: ProviderLaunchChoices) => void
        reject: (error: Error) => void
      }
    >()
    const read = vi.fn(
      ({ provider }: { provider: Provider }) =>
        new Promise<ProviderLaunchChoices>((resolve, reject) => {
          gates.set(provider, { resolve, reject })
        }),
    )
    const api = {
      ...createDesktopProviderApi(
        () => window.api.runtime,
        () => undefined,
      ),
      providerLaunchChoices: read,
    }
    const lists = createModelLists(() => api)
    const start = vi.fn()
    const handing = createAttachmentBook().handing(NEW_CONVERSATION)
    const host = defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () =>
          h(NewConversation, {
            busy: false,
            error: null,
            draft: 'Keep my draft.',
            handing,
            defaultProvider: 'codex',
            providerReadiness: Object.fromEntries(
              providers.map((provider) => [provider, lists.choices(provider)?.ready ?? null]),
            ),
            defaultApprovalMode: 'ask',
            approvalDefaultChosen: true,
            capabilities: null,
            choices: { ...NO_LAUNCH_CHOICES },
            lists,
            onStart: start,
          })
      },
    })
    const view = mount(host, {}, { width: 1000, height: 900 })
    const reads = providers.map((provider) => lists.read(provider))
    await settle()
    expect(view.host.innerText).toContain('Checking providers…')
    expect(view.all('provider-readiness-failure')).toHaveLength(0)
    for (const provider of providers) expect(lists.readiness(provider).state).toBe('pending')

    const reason =
      failure === 'unknown auth'
        ? unknown.reason
        : failure === 'refused catalogue'
          ? 'Fictional catalogue denied this read.'
          : 'Fictional IPC read rejected.'
    for (const provider of providers) {
      const gate = gates.get(provider)!
      if (failure === 'omitted reason')
        gate.resolve({
          list: list(provider, { ok: false, reason: 'no-profile' }),
          ready: null,
          defaultModel: null,
          defaultModelToSend: null,
        })
      else if (failure === 'rejected read') gate.reject(new Error(reason))
      else
        gate.resolve(
          providerLaunchChoices(
            list(
              provider,
              failure === 'refused catalogue'
                ? { ok: false, reason: 'refused', detail: reason }
                : { ok: false, reason: 'no-profile' },
            ),
            unknown,
          ),
        )
    }
    await Promise.all(reads)
    await settle()
    expect(view.host.innerText).not.toMatch(/checking/i)
    expect(view.all('send-prompt')).toHaveLength(0)
    const expectedReason = failure === 'omitted reason' ? null : reason
    expect(view.all('provider-readiness-failure')).toHaveLength(
      expectedReason === null ? 0 : providers.length,
    )
    for (const row of view.all('provider-readiness-failure'))
      expect(row.textContent).toContain(reason)
    for (const provider of providers)
      expect(lists.readiness(provider)).toEqual({
        state: 'settled',
        ready: null,
        reason: expectedReason,
      })
    for (const provider of providers) expect(lists.choices(provider)?.ready ?? null).toBeNull()
    expect(start).not.toHaveBeenCalled()

    read.mockImplementation(async ({ provider }) =>
      providerLaunchChoices(list(provider, null), usable),
    )
    lists.forget(DEFAULT_PROFILE_ID)
    await Promise.all(providers.map((provider) => lists.read(provider)))
    await settle()
    expect(view.all('provider-readiness-failure')).toHaveLength(0)
    expect(view.host.innerText).not.toMatch(/checking/i)
    expect(view.q('model-picker-face').textContent).toContain('manual')
    view.q('send-prompt').click()
    await settle()
    expect(start.mock.calls[0]?.[0]).toMatchObject({ provider: 'codex', model: 'manual' })
    expect(start.mock.calls[0]?.[1]).toBe('Keep my draft.')
  },
)
