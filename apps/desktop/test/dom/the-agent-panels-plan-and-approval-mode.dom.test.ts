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
import {
  YOLO_MEANS,
  YOLO_MEANS_FOR_AGENTS_IT_STARTS,
} from '../../src/renderer/src/lib/approval-mode'
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

/** The approval mode's own panel, open — `null` while it is shut. */
const openPanel = (m: Mounted): HTMLElement | null =>
  m.host.querySelector<HTMLElement>('[data-cy="card-approval-panel"]:popover-open')

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

describe('the approval mode, beside the plate', () => {
  it('shows the mode now, and opens what the mode means before anything changes', async () => {
    const { m, asked } = thePane()
    await settle()
    const face = m.q('card-approval')
    expect(face.tagName).toBe('BUTTON')
    expect(said(face)).toBe('YOLO off')
    // Top right of the identity: in the name's row, at its end.
    expect(m.q('session-bot-name').parentElement?.contains(face)).toBe(true)
    expect(face.getAttribute('aria-haspopup')).toBe('dialog')
    expect(face.getAttribute('aria-expanded')).toBe('false')
    expect(openPanel(m)).toBeNull()

    face.click()
    await settle()
    const panel = openPanel(m)
    expect(panel, 'the press opened nothing').not.toBeNull()
    expect(face.getAttribute('aria-expanded')).toBe('true')
    // The disclosure, whole and readable, before the confirm.
    const means = m.q('yolo-means')
    expect(visible(means)).toBe(true)
    expect(said(means)).toContain(YOLO_MEANS)
    expect(said(m.q('yolo-means-descendants'))).toBe(YOLO_MEANS_FOR_AGENTS_IT_STARTS)
    const reach = allProviderCapabilities().claude.approvals
    expect(said(m.q('yolo-reach'))).toBe(reach.state === 'available' ? (reach.note ?? '') : '')
    expect(said(m.q('card-approval-now'))).toContain('Changes apply from your next message.')
    // ⛔ Opening asked for nothing: the change is the confirm.
    expect(asked.approval).toEqual([])

    const confirm = m.q('card-approval-confirm')
    expect(said(confirm)).toBe('Turn YOLO on from your next message')
    confirm.click()
    await settle()
    expect(asked.approval).toEqual(['auto'])
    expect(openPanel(m), 'the confirm left the panel open').toBeNull()
    expect(document.activeElement).toBe(face)
  })

  it('Escape closes the panel, asks for nothing, and gives focus back to the face', async () => {
    const { m, asked } = thePane()
    await settle()
    m.q('card-approval').click()
    await settle()
    expect(openPanel(m)).not.toBeNull()
    await userEvent.keyboard('{Escape}')
    await settle()
    expect(openPanel(m)).toBeNull()
    expect(document.activeElement).toBe(m.q('card-approval'))
    expect(asked.approval).toEqual([])
  })

  it('while a change waits: the mode now, and the mode from the next message, both ways', async () => {
    const toYolo = thePane({ approvalMode: 'ask', pendingApprovalMode: 'auto' })
    await settle()
    expect(said(toYolo.m.q('card-approval'))).toBe('YOLO off')
    expect(toYolo.m.q('card-approval').dataset.pending).toBe('auto')
    expect(said(toYolo.m.q('card-approval-pending'))).toBe('Ask now · YOLO from your next message')
    // Its panel takes the queued change back rather than asking for it again.
    toYolo.m.q('card-approval').click()
    await settle()
    expect(said(toYolo.m.q('card-approval-confirm'))).toBe('Keep asking')
    toYolo.m.q('card-approval-confirm').click()
    await settle()
    expect(toYolo.asked.approval).toEqual(['ask'])
    toYolo.m.unmount()

    const toAsk = thePane({
      approvalMode: 'auto',
      pendingApprovalMode: 'ask',
      approvalNote: 'approvals: YOLO',
    })
    await settle()
    expect(said(toAsk.m.q('card-approval'))).toBe('YOLO now')
    expect(said(toAsk.m.q('card-approval-pending'))).toBe('YOLO now · Ask from your next message')
    toAsk.m.unmount()

    // The control: nothing queued, no line.
    const steady = thePane()
    await settle()
    expect(steady.m.all('card-approval-pending')).toHaveLength(0)
    expect(said(steady.m.q('card-approval'))).toBe('YOLO off')
  })
})

describe('a conversation whose settings are fixed', () => {
  it('reads its approval mode and plan, and changes neither', async () => {
    const { m, asked } = thePane({}, { fixed: true })
    await settle()
    const plan = m.q('card-run-plan')
    expect(plan.tagName).toBe('SPAN')
    expect(plan.title).toBe(FIXED_SAYS)
    plan.click()

    const face = m.q('card-approval')
    expect(face.dataset.changeable).toBe('false')
    face.click()
    await settle()
    expect(openPanel(m)).not.toBeNull()
    expect(said(m.q('card-approval-fixed'))).toBe(FIXED_SAYS)
    expect(m.all('card-approval-confirm')).toHaveLength(0)
    expect(asked.approval).toEqual([])
    expect(asked.settings).toEqual([])

    // The control: the same conversation, live, offers both.
    const live = thePane()
    await settle()
    expect(live.m.q('card-run-plan').tagName).toBe('BUTTON')
    expect(live.m.q('card-approval').dataset.changeable).toBe('true')
  })
})

describe('the YOLO meaning on a conversation whose settings are fixed', () => {
  it('is shown for a pending switch to YOLO, and not for a plain Ask', async () => {
    const pendingYolo = thePane(
      { approvalMode: 'ask', pendingApprovalMode: 'auto' },
      { fixed: true },
    )
    await settle()
    pendingYolo.m.q('card-approval').click()
    await settle()
    expect(pendingYolo.m.all('yolo-means')).toHaveLength(1)

    // The control: the same fixed conversation with nothing pending says nothing about YOLO.
    const plainAsk = thePane({ approvalMode: 'ask' }, { fixed: true })
    await settle()
    plainAsk.m.q('card-approval').click()
    await settle()
    expect(plainAsk.m.all('yolo-means')).toHaveLength(0)
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

  it('the approval mode is a named button whose panel is a named dialog, worked by keys', async () => {
    const { m, asked } = thePane({ approvalMode: 'ask', pendingApprovalMode: 'auto' })
    await settle()
    const face = m.q('card-approval')
    const named = page.getByRole('button', {
      name: 'Approval mode: YOLO off; YOLO from your next message',
    })
    expect(named.elements()).toEqual([face])

    face.focus()
    await userEvent.keyboard('{Enter}')
    await settle()
    const panel = openPanel(m)
    expect(panel).not.toBeNull()
    expect(page.getByRole('dialog', { name: 'Approval mode' }).elements()).toEqual([panel])
    // Focus is on the panel, so the meaning is read before a key can change the mode.
    expect(document.activeElement).toBe(panel)
    await userEvent.tab()
    expect(document.activeElement).toBe(m.q('card-approval-confirm'))
    await userEvent.keyboard('{Escape}')
    await settle()
    expect(openPanel(m)).toBeNull()
    expect(document.activeElement).toBe(face)
    expect(asked.approval).toEqual([])
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
