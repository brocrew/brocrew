import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, type Component } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { DRAWER_TABS } from '../../src/renderer/src/lib/drawer'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { CAPABILITY_FIXTURE } from '../provider-capability-fixture'
import { mount, paneProps, record, unmountAll, type Mounted } from './harness'

/**
 * # 🔴 W4.208 — the Context tab, retired into a popup
 *
 * The card’s context figure opens a Context popup containing the gauge, reading, source,
 * every compaction and its jump, and “Compact now…”. The Context tab is absent from the
 * strip.
 */

afterEach(unmountAll)

const EVENTS: TranscriptEvent[] = [
  { type: 'assistant_message', text: 'before' } as never,
  {
    type: 'compaction',
    source: 'compact_boundary',
    compactionId: 'c1',
    before: 180_000,
    after: 96_000,
  } as never,
  { type: 'assistant_message', text: 'between' } as never,
  {
    type: 'compaction',
    source: 'compact_boundary',
    compactionId: 'c2',
    before: 176_000,
    after: 88_000,
  } as never,
  {
    type: 'context_reading',
    reading: { kind: 'proportional', used: 128_000, window: 200_000 },
    source: 'thread/tokenUsage/updated',
  } as never,
]

function thePane() {
  const pressed: string[] = []
  const Host = defineComponent({
    name: 'ContextPopupHost',
    setup() {
      return () =>
        h(ConversationPane as Component, {
          ...paneProps({
            record: record(EVENTS),
            drawerOpen: true,
            drawerTab: 'open',
            capabilities: CAPABILITY_FIXTURE,
          }),
          onCompactNow: (intent: string) => pressed.push(intent),
        })
    },
  })
  const m = mount(Host, {}, { width: 1200, height: 900 })
  return { m, pressed }
}

const dialog = (m: Mounted) => m.host.querySelector<HTMLElement>('[data-cy="context-dialog"]')

async function openIt(m: Mounted): Promise<HTMLElement> {
  await nextTick()
  const figure = m.q('card-run-context')
  expect(figure.tagName, 'the figure is not a press').toBe('BUTTON')
  expect(figure.getAttribute('aria-haspopup')).toBe('dialog')
  figure.click()
  await nextTick()
  expect(dialog(m), 'the figure opened nothing').not.toBeNull()
  return dialog(m)!
}

describe('W4.208 · the Context popup', () => {
  it('⛔ the strip has no Context tab any more', async () => {
    const { m } = thePane()
    await nextTick()
    expect(DRAWER_TABS.map((tab) => tab.id)).not.toContain('context')
    expect(m.host.querySelector('[data-cy="drawer-tab-context"]')).toBeNull()
    expect(m.host.querySelector('[data-cy="drawer-tab-level"]')).toBeNull()
    // …and the meter is drawn nowhere until the figure is pressed.
    expect(m.host.querySelector('[data-cy="session-context"]')).toBeNull()
  })

  it('🔴 the figure opens it, with the gauge, its source and the whole history', async () => {
    const { m } = thePane()
    const popup = await openIt(m)
    expect(popup.querySelector('#context-title')?.textContent?.trim()).toBe('Context')
    const inside = (cy: string) => popup.querySelector<HTMLElement>(`[data-cy="${cy}"]`)
    expect(inside('context-figure')?.textContent).toContain('64')
    expect(inside('context-figure')?.textContent).toContain('%')
    expect(inside('context-fill')).not.toBeNull()
    expect(inside('context-reading-line')?.textContent?.trim()).not.toBe('')
    expect(inside('context-source')?.textContent).toContain('thread/tokenUsage/updated')
    expect(inside('context-tally')?.textContent?.trim()).toBe('2')
    expect(popup.querySelectorAll('[data-cy^="context-compaction-"]')).toHaveLength(2)
    expect(inside('context-last-compaction')).not.toBeNull()
    expect(inside('context-reclaimed')?.textContent).toContain('reclaimed')
    expect(inside('context-compact-why')?.textContent?.trim()).not.toBe('')
  })

  it('🔴 a history row jumps to its boundary, and the popup shuts so the transcript is seen', async () => {
    const { m } = thePane()
    const popup = await openIt(m)
    const row = popup.querySelector<HTMLButtonElement>('[data-cy^="context-compaction-"]')!
    expect(row.disabled).toBe(false)
    row.click()
    await nextTick()
    expect(dialog(m), 'the jump left the popup over the transcript').toBeNull()
  })

  it('🔴 "Compact now…" works from it: asks first, then sends the person’s /compact once', async () => {
    const { m, pressed } = thePane()
    const popup = await openIt(m)
    const press = popup.querySelector<HTMLButtonElement>('[data-cy="context-compact-now"]')!
    expect(press.disabled).toBe(false)
    press.click()
    await nextTick()
    expect(pressed, 'the first press sent something').toEqual([])
    popup.querySelector<HTMLElement>('[data-cy="compact-it"]')!.click()
    await nextTick()
    expect(pressed).toEqual(['now'])
    expect(dialog(m), 'the popup stayed up after the send').toBeNull()
  })

  it('⚑ the row keeps its own "Compact now…" beside the figure', async () => {
    const { m } = thePane()
    await nextTick()
    expect(m.q('card-run-compact')).toBeTruthy()
  })

  it('⚑ its close button shuts it and sends nothing', async () => {
    const { m, pressed } = thePane()
    const popup = await openIt(m)
    popup.querySelector<HTMLElement>('[data-cy="close-overlay"]')!.click()
    await nextTick()
    expect(dialog(m)).toBeNull()
    expect(pressed).toEqual([])
  })
})
