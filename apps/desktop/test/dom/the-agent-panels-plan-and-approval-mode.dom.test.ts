import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick, type Component } from 'vue'
// ⚠️ The MODULE, not the barrel — `@brobot2/runtime`'s index pulls in `node:fs` and the whole file
// fails to import in the browser project.
import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import { usePersistentChoice } from '../../src/renderer/src/composables/usePersistentToggle'
import { FIXED_SAYS } from '../../src/renderer/src/composables/useConversationControls'
import { DEFAULT_TAB, DRAWER_TABS, isDrawerTab } from '../../src/renderer/src/lib/drawer'
import { LEAVE_PLAN_UNAVAILABLE } from '../../src/renderer/src/lib/plan-mode'
import type {
  CreatedSession,
  SetSessionSettingInput,
  TranscriptEvent,
} from '../../src/shared/runtime-ipc'
import { META, drawerProps, mount, paneProps, record, unmountAll, visible } from './harness'
import type { Mounted } from './harness'

/**
 * The agent panel holds what the Controls tab held: plan first beside the model and effort, the
 * approval mode beside the plate with what it means opened before a change, and what is queued for
 * the next message under the run strip. A remembered Controls tab lands on Open, where they went.
 */

afterEach(unmountAll)

const EVENTS: TranscriptEvent[] = [{ type: 'assistant_message', text: 'hello' } as never]

const SETTINGS = { ...META.settings, model: 'opus', reasoningEffort: 'high' }

interface Asked {
  approval: ('ask' | 'auto')[]
  settings: SetSessionSettingInput['body'][]
}

/** The pane, its drawer on the Open tab, for a conversation with the given meta. */
function thePane(
  over: Partial<CreatedSession> = {},
  how: { fixed?: boolean } = {},
): { m: Mounted; asked: Asked } {
  const asked: Asked = { approval: [], settings: [] }
  const r = record(EVENTS)
  r.meta = {
    ...META,
    ...over,
    settings: { ...SETTINGS, ...over.settings },
    ...(how.fixed ? { settingsFixed: true } : {}),
  }
  if (how.fixed) r.phase = 'recorded'
  const Host = defineComponent({
    name: 'AgentPanelControlsHost',
    setup() {
      return () =>
        h(ConversationPane as Component, {
          ...paneProps({ record: r, drawerOpen: true, drawerTab: 'open' }),
          pickModel: async () => ({ itsAgentsDefault: true, theLastPick: true }),
          capabilities: allProviderCapabilities(),
          onSetApprovalMode: (mode: 'ask' | 'auto') => asked.approval.push(mode),
          onSetSessionSetting: (body: SetSessionSettingInput['body']) => asked.settings.push(body),
        })
    },
  })
  return { m: mount(Host, {}, { width: 1200, height: 900 }), asked }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    await nextTick()
  }
}

const said = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('plan first, beside the model and effort', () => {
  it('shows that it is off, and a press turns it on from the next message', async () => {
    const { m, asked } = thePane()
    await settle()
    const plan = m.q('card-run-plan')
    expect(plan.tagName).toBe('BUTTON')
    expect(plan.dataset.state).toBe('off')
    expect(said(plan)).toBe('Plan off')
    // Beside the model and effort, in the same row of the strip.
    expect(plan.parentElement).toBe(m.q('card-run-effort').parentElement)
    expect(plan.title).toContain('Applies from your next message.')
    expect(plan.title).toContain('not a safety gate')

    plan.click()
    await settle()
    expect(asked.settings).toEqual([{ kind: 'planMode', on: true }])
    // The control: nothing else was asked for.
    expect(asked.approval).toEqual([])
  })

  it('says it is planning, and offers no exit of its own, on either provider', async () => {
    // Planning with no go-ahead of ours: the exit is the provider's own request.
    const planning = thePane({ settings: { ...SETTINGS, planMode: true } })
    await settle()
    const chip = planning.m.q('card-run-plan')
    expect(chip.tagName).toBe('SPAN')
    expect(chip.dataset.state).toBe('planning')
    expect(said(chip)).toBe('Planning')
    expect(chip.title).toContain(LEAVE_PLAN_UNAVAILABLE)
    chip.click()
    await settle()
    expect(planning.asked.settings).toEqual([])
    planning.m.unmount()

    // Planning with the go-ahead below the transcript: the chip points there.
    const deferred = thePane({ planNeedsGoAhead: true, settings: { ...SETTINGS, planMode: true } })
    await settle()
    const there = deferred.m.q('card-run-plan')
    expect(there.tagName).toBe('SPAN')
    expect(there.dataset.state).toBe('deferred')
    expect(there.title).toContain('start work on the plan')
  })

  it('a queued start is not pressed twice, and the chip keeps what runs', async () => {
    const { m, asked } = thePane({ settings: { ...SETTINGS, pendingPlanMode: true } })
    await settle()
    const chip = m.q('card-run-plan')
    expect(chip.tagName).toBe('SPAN')
    expect(chip.dataset.state).toBe('starting')
    expect(said(chip)).toBe('Plan off')
    chip.click()
    await settle()
    expect(asked.settings).toEqual([])
  })
})

// The approved switch replaces the disclosure/confirm popup; the confirmed and queued facts stay separate.
describe('the approval switch beside the plate', () => {
  it.each(['ask', 'auto'] as const)(
    'shows confirmed %s and asks for the opposite mode',
    async (mode) => {
      const { m, asked } = thePane({ approvalMode: mode })
      await settle()
      const face = m.q('card-approval') as HTMLInputElement
      expect(face.getAttribute('role')).toBe('switch')
      expect(face.checked).toBe(mode === 'auto')
      expect(m.q('session-bot-name').parentElement?.contains(face)).toBe(true)
      face.click()
      await settle()
      expect(asked.approval).toEqual([mode === 'auto' ? 'ask' : 'auto'])
      expect(face.checked).toBe(mode === 'auto')
    },
  )
  it('cannot change a fixed conversation', async () => {
    const { m, asked } = thePane({}, { fixed: true })
    await settle()
    const face = m.q('card-approval') as HTMLInputElement
    expect(face.disabled).toBe(true)
    face.click()
    await settle()
    expect(asked.approval).toEqual([])
    expect(m.q('card-run-plan').title).toBe(FIXED_SAYS)
  })
  it('a queued change does not pretend the current turn already changed', async () => {
    const { m } = thePane({ approvalMode: 'ask', pendingApprovalMode: 'auto' })
    await settle()
    expect((m.q('card-approval') as HTMLInputElement).checked).toBe(false)
    expect(m.q('card-approval').dataset.pending).toBe('auto')
    expect(m.q('card-approval').parentElement?.title).toContain('next message')
  })
})

describe('what the pick became, and what waits for the next message', () => {
  it('says each queued change against what runs now, under the run strip', async () => {
    const { m } = thePane({
      settings: {
        ...SETTINGS,
        pendingModel: { value: 'sonnet' },
        pendingReasoningEffort: { value: 'low' },
        pendingPlanMode: true,
      },
    })
    await settle()
    const area = m.q('card-pick-became')
    // Under the strip, not in it.
    expect(m.q('card-run').contains(area)).toBe(false)
    expect(said(m.q('card-pending'))).toContain('Changes apply from your next message.')
    expect(said(m.q('card-pending-model'))).toBe('Model sonnet is asked for; opus runs now.')
    expect(said(m.q('card-pending-effort'))).toBe('Effort low is asked for; high runs now.')
    expect(said(m.q('card-pending-plan'))).toBe('Plan first is asked for; it is off now.')
    // …and the strip still says what runs.
    expect(said(m.q('card-run-model'))).toBe('opus')
    expect(said(m.q('card-run-effort'))).toBe('high')

    // The control: nothing queued, nothing said.
    const steady = thePane()
    await settle()
    expect(steady.m.all('card-pick-became')).toHaveLength(0)
  })
})

describe('the Controls tab is gone', () => {
  it('the strip has no Controls tab, and a remembered one lands on Open', async () => {
    const m = mount(SessionDrawer, drawerProps({ tab: 'open' }), { width: 380, height: 700 })
    await nextTick()
    expect(m.all('drawer-tab-controls')).toHaveLength(0)
    const tabs = [...m.q('drawer-tabs').querySelectorAll<HTMLElement>('[data-cy^="drawer-tab-"]')]
    expect(tabs.map((tab) => tab.dataset.cy)).toEqual(
      DRAWER_TABS.map((tab) => `drawer-tab-${tab.id}`),
    )
    m.unmount()

    // The screen's own call, over a machine that remembered the Controls tab.
    const key = 'brobot2.drawerTab'
    const before = localStorage.getItem(key)
    localStorage.setItem(key, 'controls')
    try {
      const remembered = usePersistentChoice(key, DEFAULT_TAB, isDrawerTab)
      expect(remembered.value).toBe('open')
      const landed = mount(SessionDrawer, drawerProps({ tab: remembered.value }), {
        width: 380,
        height: 700,
      })
      await nextTick()
      expect(landed.q('drawer-tab-open').dataset.active).toBe('true')
      expect(visible(landed.q('session-panel'))).toBe(true)
      // …where its settings are.
      expect(visible(landed.q('card-approval'))).toBe(true)
      expect(visible(landed.q('card-run-plan'))).toBe(true)

      // The control: a tab that still exists is remembered by the same call.
      localStorage.setItem(key, 'info')
      expect(usePersistentChoice(key, DEFAULT_TAB, isDrawerTab).value).toBe('info')
    } finally {
      if (before === null) localStorage.removeItem(key)
      else localStorage.setItem(key, before)
    }
  })
})

describe('keyboard reach and accessible names', () => {
  it('plan first is reached and pressed from the keyboard, by its name', async () => {
    const { m, asked } = thePane()
    await settle()
    const named = page.getByRole('button', {
      name: 'Plan first is off. Turn it on from your next message',
    })
    expect(named.elements()).toEqual([m.q('card-run-plan')])
    // Reached by Tab from the effort beside it.
    m.q('card-run-effort').focus()
    await userEvent.tab()
    expect(document.activeElement).toBe(m.q('card-run-plan'))
    await userEvent.keyboard('{Enter}')
    await settle()
    expect(asked.settings).toEqual([{ kind: 'planMode', on: true }])
  })

  it('the switch is reachable and works with Space', async () => {
    const { m, asked } = thePane()
    await settle()
    const face = m.q('card-approval')
    expect(page.getByRole('switch', { name: 'Auto mode' }).elements()).toEqual([face])
    face.focus()
    await userEvent.keyboard(' ')
    await settle()
    expect(asked.approval).toEqual(['auto'])
  })
})

describe('the identity and the run strip keep their size', () => {
  /** The drawer at a width, with the conversation's settings in the strip. */
  async function drawerAt(width: number): Promise<Mounted> {
    await page.viewport(1440, 1000)
    await document.fonts.ready
    const m = mount(
      SessionDrawer,
      drawerProps({
        session: { ...META, settings: { ...SETTINGS, model: 'claude-opus-5-5[1m]' } },
        pickModel: () => Promise.resolve(),
        tab: 'open',
      }),
      { width, height: 900 },
    )
    await settle()
    return m
  }

  const height = (el: Element): number => el.getBoundingClientRect().height

  it.each([535, 368])('at %ipx, Plan and the approval mode add no height', async (width) => {
    const m = await drawerAt(width)
    const strip = m.q('card-run')
    const head = m.q('session-bot-name').parentElement!
    const plan = m.q('card-run-plan')
    const face = m.q('card-approval')
    expect(visible(plan)).toBe(true)
    expect(visible(face)).toBe(true)
    const withBoth = { strip: height(strip), head: height(head) }

    plan.style.display = 'none'
    face.style.display = 'none'
    try {
      // The control: the reading moves with the content, so the equality is a measurement.
      expect(height(strip)).toBeGreaterThan(0)
      expect(height(strip)).toBe(withBoth.strip)
      expect(height(head)).toBe(withBoth.head)
    } finally {
      plan.style.removeProperty('display')
      face.style.removeProperty('display')
    }
    // Plan sits in the model's row, and the strip is at most the two rows it already had.
    expect(Math.round(plan.getBoundingClientRect().top)).toBe(
      Math.round(m.q('card-run-effort').getBoundingClientRect().top),
    )
    // Items of different heights are centred on one row, so a row starts only where an item
    // begins below the bottom of the row before it.
    const boxes = [...strip.querySelectorAll<HTMLElement>('.run-item')]
      .filter(visible)
      .map((el) => el.getBoundingClientRect())
      .sort((a, b) => a.top - b.top)
    let rows = 0
    let rowBottom = -Infinity
    for (const box of boxes) {
      if (box.top >= rowBottom - 1) rows += 1
      rowBottom = Math.max(rowBottom, box.bottom)
    }
    expect(boxes.length, 'the strip drew nothing to count').toBeGreaterThan(3)
    // At the wide panel one row; where the card folds (its 430px container rule), the two it had.
    expect(rows).toBe(width > 430 ? 1 : 2)
  })
})
