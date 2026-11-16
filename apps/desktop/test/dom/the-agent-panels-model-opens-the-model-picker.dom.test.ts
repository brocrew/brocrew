import { compatibilityConnectionId, PROVIDER_DESCRIPTORS } from '@brobot2/shared'
import { launchFacts, resolveProviderLaunch } from '../lib/provider-launch-fixture'
import type { RuntimeBridge } from '../../src/shared/runtime-ipc'
import type { ModelList, WhatAPickBecame } from '../../src/shared/model-choice-contracts'
import type { TranscriptEvent } from '../../src/shared/conversation-events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick, provide, reactive, type Component } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import type { PickedModel } from '../../src/renderer/src/lib/model-lists'
import { theList } from '../../src/shared/model-choice'
import type { ModelChoice, Provider } from '../../src/shared/runtime-ipc'
import { META, mount, paneProps, record, unmountAll, type Mounted } from './harness'

/**
 * The model and the effort under the agent's plate, in the Agent panel, open the conversation's
 * model picker: the one its settings show, with the same Take and the same words. A conversation
 * nothing set here would reach draws them as plain facts.
 */

let previousApi: PropertyDescriptor | undefined
beforeEach(() => {
  previousApi = Object.getOwnPropertyDescriptor(window, 'api')
  Reflect.deleteProperty(window, 'api')
})
afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
  if (previousApi) Object.defineProperty(window, 'api', previousApi)
})

const levels = (...ids: string[]): { id: string; label: string }[] =>
  ids.map((id) => ({ id, label: id }))

const ROWS: ModelChoice[] = [
  {
    id: 'opus',
    label: 'Opus',
    efforts: levels('low', 'medium', 'high', 'max'),
    defaultEffort: 'high',
    isDefault: true,
  },
  {
    id: 'sonnet',
    label: 'Sonnet',
    efforts: levels('low', 'medium', 'high'),
    defaultEffort: 'medium',
  },
]

const listOf = (provider: Provider): ModelList => ({
  provider,
  notAsked: null,
  standIn: null,
  models: theList(ROWS, ['fictional-added']),
  lastPicked: null,
  startsOn: null,
})

function installBridge(alias = false) {
  const listeners = new Set<Parameters<RuntimeBridge['onProvidersChanged']>[0]>()
  const add = vi.fn(async () => undefined)
  const remove = vi.fn(async () => undefined)
  let connection = {
    id: compatibilityConnectionId('claude', 'sign-in'),
    provider: 'claude',
    name: 'subscription',
    authMethod: 'sign-in',
    credentialSource: 'provider-sign-in',
    baseUrl: null,
    enabled: true,
    contractVersion: 1,
  }
  const list = (provider: Provider) => ({
    ...listOf(provider),
    models: alias
      ? theList(
          [
            { ...ROWS[0]!, id: 'default', label: 'Default', resolvesTo: 'fictional-opus-v2' },
            ROWS[1]!,
          ],
          [],
        )
      : listOf(provider).models,
  })
  ;(window as unknown as { api: unknown }).api = {
    runtime: {
      providerCatalogue: async () => PROVIDER_DESCRIPTORS,
      providerConnections: async () => [connection],
      onProvidersChanged: (hear: Parameters<RuntimeBridge['onProvidersChanged']>[0]) => {
        listeners.add(hear)
        return () => listeners.delete(hear)
      },
      addHandAddedModel: add,
      deleteHandAddedModel: remove,
      modelList: async ({ provider }: { provider: Provider }) => list(provider),
      providerLaunchChoices: async ({ provider }: { provider: Provider }) => ({
        ...launchFacts(list(provider), { state: 'usable', login: 'account', expiresAt: null }),
        connections: provider === 'claude' ? [connection] : [],
      }),
      resolveProviderLaunch: async (input: Parameters<RuntimeBridge['resolveProviderLaunch']>[0]) =>
        resolveProviderLaunch(input, null),
    },
  }
  return {
    add,
    remove,
    rename(name: string) {
      connection = { ...connection, name }
      for (const hear of listeners) hear({ what: 'connections', provider: 'claude' })
    },
  }
}

const EVENTS: TranscriptEvent[] = [{ type: 'assistant_message', text: 'hello' } as never]

/** The pane, its drawer on the Agent panel, for a conversation on `opus` at `high`. */
function thePane(
  over: {
    pickable?: boolean
    fixed?: boolean
    unknown?: boolean
    pending?: string
    reportedDefault?: boolean
    selectedDefault?: boolean
  } = {},
): {
  m: Mounted
  picks: PickedModel[]
  fix(value: boolean): void
  catalogue: ReturnType<typeof installBridge>
} {
  const catalogue = installBridge(over.selectedDefault)
  const client = createDesktopProviderApi(
    () => window.api.runtime,
    () => window.api?.providerSetup,
    () => window.api?.recoveryRetention,
    () => window.api.runtime,
    () => window.api,
  )
  const picks: PickedModel[] = []
  const r = reactive(record(EVENTS))
  r.meta = {
    ...META,
    ...(over.reportedDefault
      ? { connectionId: compatibilityConnectionId('claude', 'sign-in') }
      : {}),
    settings: {
      ...META.settings,
      ...(over.unknown
        ? { model: null, reasoningEffort: null }
        : { model: over.selectedDefault ? 'default' : 'opus', reasoningEffort: 'high' }),
      ...(over.reportedDefault ? { reported: { model: 'default' } } : {}),
      ...(over.pending ? { pendingModel: { value: over.pending } } : {}),
    },
    ...(over.fixed ? { settingsFixed: true } : {}),
  }
  if (over.fixed) r.phase = 'recorded'
  const pickModel = async (pick: PickedModel): Promise<WhatAPickBecame> => {
    picks.push(pick)
    return { itsAgentsDefault: true, theLastPick: true }
  }
  const Host = defineComponent({
    name: 'AgentPanelModelHost',
    setup() {
      provide(CLIENT_PROVIDERS, client)
      return () =>
        h(ConversationPane as Component, {
          ...paneProps({ record: r, drawerOpen: true, drawerTab: 'open' }),
          ...(over.pickable === false ? {} : { pickModel }),
        })
    },
  })
  return {
    m: mount(Host, {}, { width: 1200, height: 900 }),
    picks,
    catalogue,
    fix(value: boolean) {
      r.phase = value ? 'recorded' : 'open'
      if (r.meta) {
        const olderMeta = { ...r.meta, settingsFixed: value }
        r.meta = olderMeta
      }
    },
  }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    await nextTick()
  }
}

/** The card's own picker panel — not the settings tab's, which this drawer tab does not mount. */
const panel = (m: Mounted): HTMLElement | null =>
  m.host.querySelector<HTMLElement>('[data-cy="model-picker-panel"]:popover-open')

/** The checked row's model, or the checked level's effort. */
const checked = (
  within: HTMLElement,
  cy: 'model-picker-row' | 'model-picker-effort',
): string | null => {
  const row = [...within.querySelectorAll<HTMLElement>(`[data-cy="${cy}"]`)].find(
    (one) => one.querySelector<HTMLInputElement>('input')?.checked,
  )
  return (cy === 'model-picker-row' ? row?.dataset.model : row?.dataset.effort) ?? null
}

describe('the Agent panel’s model and effort open the model picker', () => {
  it('the model is a button with its name; a press opens the picker at the models', async () => {
    const { m } = thePane()
    await settle()
    const model = m.q('card-run-model')
    expect(model.tagName).toBe('BUTTON')
    expect(model.getAttribute('aria-label')).toBe('Change model, now opus')
    expect(model.getAttribute('aria-haspopup')).toBe('dialog')
    expect(model.getAttribute('aria-expanded')).toBe('false')
    expect(panel(m)).toBeNull()

    model.click()
    await settle()
    const open = panel(m)
    expect(open, 'the press opened nothing').not.toBeNull()
    expect(model.getAttribute('aria-expanded')).toBe('true')
    expect(checked(open!, 'model-picker-row')).toBe('opus')
    expect(document.activeElement?.closest('[data-cy="model-picker-row"]')).not.toBeNull()
  })

  it('shows the recorded connection and keeps a real model control after repeated Cancel', async () => {
    const { m, picks } = thePane({ reportedDefault: true })
    await settle()
    expect(m.q('provider-chip').textContent?.trim()).toBe('Claude · subscription')
    expect(m.q('card-run-model').textContent?.trim()).toContain('opus')
    expect(m.q('card-run-model').textContent).not.toContain('default')
    expect(m.q('card-run-model').title).toContain('Claude reports default')
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const model = m.q('card-run-model')
      expect(model.tagName).toBe('BUTTON')
      model.click()
      await settle()
      const opened = panel(m)
      expect(opened, `Cancel cycle ${attempt} cannot reopen`).not.toBeNull()
      expect(opened!.textContent).toContain('subscription')
      opened!.querySelector<HTMLButtonElement>('[data-cy="model-picker-cancel"]')!.click()
      await settle()
      expect(panel(m)).toBeNull()
      expect(m.q('card-run-model').tagName).toBe('BUTTON')
      expect(m.q('card-run-model').textContent?.trim()).toContain('opus')
    }
    expect(picks).toEqual([])
  })

  it('a generic reported default does not replace the model selected for this conversation', async () => {
    const { m } = thePane({ reportedDefault: true })
    await settle()
    expect(m.q('card-run-model').textContent?.trim()).toContain('opus')
    expect(m.q('card-run-model').textContent).not.toContain('default')
  })

  it('shows the supplied target of a selected default alias without changing its identity', async () => {
    const { m, picks } = thePane({ reportedDefault: true, selectedDefault: true })
    await settle()
    expect(m.q('card-run-model').textContent).toContain('default → fictional-opus-v2')
    m.q('card-run-model').click()
    await settle()
    expect(checked(panel(m)!, 'model-picker-row')).toBe('default')
    panel(m)!.querySelector<HTMLButtonElement>('[data-cy="model-picker-take"]')!.click()
    await settle()
    expect(picks).toEqual([
      {
        provider: 'claude',
        connectionId: compatibilityConnectionId('claude', 'sign-in'),
        model: 'default',
        effort: 'high',
      },
    ])
  })

  it('a metadata rename updates the header and existing picker without another model probe', async () => {
    const { m, picks, catalogue } = thePane({ reportedDefault: true })
    await settle()
    const choices = vi.spyOn(window.api.runtime, 'providerLaunchChoices')
    const before = choices.mock.calls.length
    catalogue.rename('Evening subscription')
    await settle()
    expect(m.q('provider-chip').textContent).toContain('Evening subscription')
    expect(m.q('card-run-model').textContent).toContain('Evening subscription')
    m.q('card-run-model').click()
    await settle()
    expect(panel(m)!.querySelector('[data-cy=model-picker-connection]')!.textContent).toContain(
      'Evening subscription',
    )
    expect(choices.mock.calls.length).toBe(before)
    expect(picks).toEqual([])
  })

  it('Cancel alone keeps the unchanged running model clickable', async () => {
    const { m, picks } = thePane()
    await settle()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      m.q('card-run-model').click()
      await settle()
      const opened = panel(m)
      expect(opened).not.toBeNull()
      opened!.querySelector<HTMLButtonElement>('[data-cy="model-picker-cancel"]')!.click()
      await settle()
      expect(panel(m)).toBeNull()
      expect(m.q('card-run-model').tagName).toBe('BUTTON')
    }
    expect(picks).toEqual([])
  })

  it('recorded refreshes keep the picker editable through Cancel and Enter', async () => {
    const { m, picks, fix, catalogue } = thePane({ reportedDefault: true })
    await settle()
    for (let cycle = 0; cycle < 3; cycle++) {
      fix(cycle !== 1)
      await settle()
      m.q('card-run-model').focus()
      m.q('card-run-model').click()
      await settle()
      const open = panel(m)!
      expect(open).not.toBeNull()
      expect(m.q('card-run-model').getAttribute('aria-label')).toContain('Change model')
      expect(open.querySelector<HTMLButtonElement>('[data-cy="model-picker-take"]')!.disabled).toBe(
        false,
      )
      expect(open.querySelector('[data-cy="model-picker-add-open"]')).not.toBeNull()
      expect(open.querySelector('[data-cy="model-picker-delete"]')).not.toBeNull()
      open.querySelector<HTMLButtonElement>('[data-cy="model-picker-cancel"]')!.click()
      await settle()
      expect(panel(m)).toBeNull()
      expect(document.activeElement).toBe(m.q('card-run-model'))
    }
    expect(picks).toEqual([])
    expect(catalogue.add).not.toHaveBeenCalled()
    expect(catalogue.remove).not.toHaveBeenCalled()
    fix(true)
    m.q('card-run-model').click()
    await settle()
    const row = panel(m)!.querySelector<HTMLInputElement>('[data-cy="model-picker-row"] input')!
    row.focus()
    await userEvent.keyboard('{Enter}')
    await settle()
    expect(picks).toEqual([
      {
        provider: 'claude',
        connectionId: compatibilityConnectionId('claude', 'sign-in'),
        model: 'opus',
        effort: 'high',
      },
    ])
    expect(panel(m)).toBeNull()
  })

  it('the effort opens the same picker, with focus on the effort levels', async () => {
    const { m } = thePane()
    await settle()
    const effort = m.q('card-run-effort')
    expect(effort.tagName).toBe('BUTTON')
    expect(effort.getAttribute('aria-label')).toBe('Change effort, now high')
    effort.click()
    await settle()
    const open = panel(m)
    expect(open).not.toBeNull()
    expect(checked(open!, 'model-picker-effort')).toBe('high')
    expect(document.activeElement?.closest('[data-cy="model-picker-effort"]')).not.toBeNull()
  })

  it('a pick is carried out through the conversation’s own pick, and its answer is said', async () => {
    const { m, picks } = thePane()
    await settle()
    m.q('card-run-model').click()
    await settle()
    const open = panel(m)!
    const sonnet = [...open.querySelectorAll<HTMLElement>('[data-cy="model-picker-row"]')].find(
      (row) => row.dataset.model === 'sonnet',
    )
    sonnet!.querySelector('input')!.click()
    await settle()
    const take = open.querySelector<HTMLButtonElement>('[data-cy="model-picker-take"]')!
    expect(take.textContent?.trim()).toBe('Switch from your next message')
    take.click()
    await settle()
    // The effort a person had is kept where the new model offers it, as the picker always does.
    expect(picks).toEqual([{ provider: 'claude', model: 'sonnet', effort: 'high' }])
    expect(panel(m), 'Take left the picker open').toBeNull()
    expect(m.q('card-pick-became').textContent?.trim()).toBe(
      'This conversation, this agent’s default for new conversations, and your last pick for Claude.',
    )
    expect(document.activeElement, 'focus did not come back to the model').toBe(
      m.q('card-run-model'),
    )
  })

  it('Escape closes it and gives focus back to the effort that opened it', async () => {
    const { m, picks } = thePane()
    await settle()
    m.q('card-run-effort').click()
    await settle()
    expect(panel(m)).not.toBeNull()
    await userEvent.keyboard('{Escape}')
    await settle()
    expect(panel(m)).toBeNull()
    expect(document.activeElement).toBe(m.q('card-run-effort'))
    expect(picks).toEqual([])
  })

  it('recorded conversations keep editable model and effort, while a missing callback permits inspection only', async () => {
    const fixed = thePane({ fixed: true })
    await settle()
    expect(fixed.m.q('card-run-model').tagName).toBe('BUTTON')
    expect(fixed.m.q('card-run-effort').tagName).toBe('BUTTON')
    fixed.m.q('card-run-model').click()
    await settle()
    expect(panel(fixed.m)).not.toBeNull()
    expect(
      panel(fixed.m)!.querySelector<HTMLButtonElement>('[data-cy="model-picker-take"]')!.disabled,
    ).toBe(false)
    fixed.m.unmount()

    // A missing write callback still permits inspection.
    const unpickable = thePane({ pickable: false })
    await settle()
    expect(unpickable.m.q('card-run-model').tagName).toBe('BUTTON')
    expect(unpickable.m.q('card-run-effort').tagName).toBe('SPAN')

    // The control: the same conversation with a pick is a button.
    const pickable = thePane()
    await settle()
    expect(pickable.m.q('card-run-model').tagName).toBe('BUTTON')
  })

  it('with no model known yet, a conversation that can change it still opens the picker', async () => {
    const { m, picks } = thePane({ unknown: true })
    await settle()
    const model = m.q('card-run-model')
    expect(model.tagName).toBe('BUTTON')
    expect(model.getAttribute('aria-label')).toBe('Choose a model')
    expect(model.textContent?.trim()).toBe('Choose model')
    // No effort is known either, and the model's button reaches both choices.
    expect(m.host.querySelector('[data-cy="card-run-effort"]')).toBeNull()

    model.focus()
    await userEvent.keyboard('{Enter}')
    await settle()
    const open = panel(m)
    expect(open, 'the press opened nothing').not.toBeNull()
    const sonnet = [...open!.querySelectorAll<HTMLElement>('[data-cy="model-picker-row"]')].find(
      (row) => row.dataset.model === 'sonnet',
    )
    sonnet!.querySelector('input')!.click()
    await settle()
    open!.querySelector<HTMLButtonElement>('[data-cy="model-picker-take"]')!.click()
    await settle()
    expect(picks).toHaveLength(1)
    expect(picks[0]).toMatchObject({ provider: 'claude', model: 'sonnet' })
  })

  it('…and still does while a model is already asked for', async () => {
    const { m } = thePane({ unknown: true, pending: 'sonnet' })
    await settle()
    expect(m.q('card-run-model').tagName).toBe('BUTTON')
    expect(m.q('card-run-model').getAttribute('aria-label')).toBe('Choose a model')
  })

  it('…and a fixed conversation with no model known can inspect the list without changing it', async () => {
    const { m } = thePane({ unknown: true, fixed: true })
    await settle()
    expect(m.q('card-run-model').tagName).toBe('BUTTON')
    m.q('card-run-model').click()
    await settle()
    expect(
      panel(m)!.querySelector<HTMLButtonElement>('[data-cy="model-picker-take"]')!.disabled,
    ).toBe(true)
  })
})
