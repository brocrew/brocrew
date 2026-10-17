import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick, type Component } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { PickedModel } from '../../src/renderer/src/lib/model-lists'
import { theList } from '../../src/shared/model-choice'
import type {
  ModelChoice,
  ModelList,
  Provider,
  TranscriptEvent,
  WhatAPickBecame,
} from '../../src/shared/runtime-ipc'
import { META, mount, paneProps, record, unmountAll, type Mounted } from './harness'

/**
 * The model and the effort under the agent's plate, in the Agent panel, open the conversation's
 * model picker: the one its settings show, with the same Take and the same words. A conversation
 * nothing set here would reach draws them as plain facts.
 */

afterEach(unmountAll)

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
  models: theList(ROWS, []),
  lastPicked: null,
  startsOn: null,
})

function installBridge(): void {
  ;(window as unknown as { api: unknown }).api = {
    runtime: { modelList: async ({ provider }: { provider: Provider }) => listOf(provider) },
  }
}

const EVENTS: TranscriptEvent[] = [{ type: 'assistant_message', text: 'hello' } as never]

/** The pane, its drawer on the Agent panel, for a conversation on `opus` at `high`. */
function thePane(
  over: { pickable?: boolean; fixed?: boolean; unknown?: boolean; pending?: string } = {},
): {
  m: Mounted
  picks: PickedModel[]
} {
  installBridge()
  const picks: PickedModel[] = []
  const r = record(EVENTS)
  r.meta = {
    ...META,
    settings: {
      ...META.settings,
      ...(over.unknown
        ? { model: null, reasoningEffort: null }
        : { model: 'opus', reasoningEffort: 'high' }),
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
      return () =>
        h(ConversationPane as Component, {
          ...paneProps({ record: r, drawerOpen: true, drawerTab: 'open' }),
          ...(over.pickable === false ? {} : { pickModel }),
        })
    },
  })
  return { m: mount(Host, {}, { width: 1200, height: 900 }), picks }
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

  it('a conversation nothing set here would reach draws its model and effort as facts', async () => {
    const fixed = thePane({ fixed: true })
    await settle()
    expect(fixed.m.q('card-run-model').tagName).toBe('SPAN')
    expect(fixed.m.q('card-run-effort').tagName).toBe('SPAN')
    expect(fixed.m.host.querySelector('[data-cy="model-picker-panel"]')).toBeNull()
    fixed.m.unmount()

    // …and so does one with no pick to carry it out.
    const unpickable = thePane({ pickable: false })
    await settle()
    expect(unpickable.m.q('card-run-model').tagName).toBe('SPAN')
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

  it('…but a fixed conversation with no model known offers no change and draws no model', async () => {
    const { m } = thePane({ unknown: true, fixed: true })
    await settle()
    expect(m.host.querySelector('[data-cy="card-run-model"]')).toBeNull()
    expect(m.host.querySelector('[data-cy="model-picker-panel"]')).toBeNull()
  })
})
