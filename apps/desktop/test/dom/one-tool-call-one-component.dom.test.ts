import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { page } from 'vitest/browser'

import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import ToolEntry from '../../src/renderer/src/components/ToolEntry.vue'
import type { ToolAnswer } from '../../src/shared/runtime-ipc'
import type { TranscriptEvent } from '../../src/shared/conversation-events'
import { mount, paneProps, record, unmountAll, type Mounted } from './harness'

/**
 * A tool call is drawn by one component wherever it appears: on its own, inside a run, and in the
 * whole-answer panel. Each place is opened from the same fixture call and must mount `ToolEntry`.
 */

afterEach(unmountAll)

const PANE = { width: 992, height: 808 }
const NAME = 'mcp__brobot__message_agent'
const SUMMARY = '{"agent":"W3.2","text":"Which bakeries take orders?"}'

const asked: TranscriptEvent = {
  type: 'tool_call',
  id: 'call_1',
  name: NAME,
  summary: SUMMARY,
} as TranscriptEvent
const answered = (summary: string, ok = true): TranscriptEvent =>
  ({ type: 'tool_result', id: 'call_1', summary, ok }) as TranscriptEvent
const held = (...texts: string[]): ToolAnswer => ({
  parts: texts.map((text) => ({ text, dropped: 0 })),
  partsDropped: 0,
})

async function pane(events: TranscriptEvent[], answer: ToolAnswer | null): Promise<Mounted> {
  await page.viewport(PANE.width, PANE.height)
  const r = record([{ type: 'status', state: 'working' } as TranscriptEvent, ...events])
  r.meta = { ...r.meta!, liveness: { ...r.meta!.liveness, canReadToolAnswer: true } }
  const m = mount(
    ConversationPane,
    paneProps({ record: r, drawerOpen: false, onReadToolAnswer: async () => answer }),
    PANE,
  )
  await nextTick()
  return m
}

async function press(el: Element | null, what: string): Promise<void> {
  expect(el, `no ${what} to press`).not.toBeNull()
  ;(el as HTMLElement).click()
  await nextTick()
  await new Promise((done) => setTimeout(done, 30))
  await nextTick()
}

/** `ToolEntry`'s scope attribute: only elements its own template draws carry it. */
const TOOL_ENTRY_SCOPE = (ToolEntry as { __scopeId?: string }).__scopeId

/** The one drawing of the call inside `place`: exactly one, by `ToolEntry`, naming the call. */
function theOneDrawing(place: Element, where: string): Element {
  const entries = [...place.querySelectorAll('[data-cy="tool-entry"]')]
  expect(entries, `${where}: one drawing of the call`).toHaveLength(1)
  const entry = entries[0]!
  expect(TOOL_ENTRY_SCOPE, 'ToolEntry has a scope attribute').toMatch(/^data-v-/)
  expect(entry.hasAttribute(TOOL_ENTRY_SCOPE!), `${where}: drawn by ToolEntry`).toBe(true)
  expect(entry.textContent, `${where}: names the call`).toContain(NAME)
  expect(entry.querySelector('[data-cy="tool-input"]')?.textContent, `${where}: as sent`).toBe(
    SUMMARY,
  )
  return entry
}

const idOf = (entry: Element): string | null =>
  entry.querySelector('[data-cy^="tool-toggle-"]')?.getAttribute('data-cy') ?? null

/** The settled call's run, opened, and the whole-answer panel opened from its card. */
async function panelFor(result: TranscriptEvent, answer: ToolAnswer | null) {
  const m = await pane([asked, result], answer)
  const run = m.q('tool-run')
  await press(run.querySelector('[data-cy="tool-run-toggle"]'), 'run toggle')
  const inRun = theOneDrawing(run, 'in a run')
  await press(inRun.querySelector('[data-cy^="tool-answer-open-"]'), 'whole-answer door')
  const panel = m.q('tool-answer-viewer')
  const inPanel = theOneDrawing(panel, 'in the panel')
  expect(idOf(inPanel), 'the panel draws the same call').toBe(idOf(inRun))
  return { m, panel, inPanel }
}

const words = (el: Element, cy: string): string =>
  el.querySelector(`[data-cy="${cy}"]`)?.textContent?.trim() ?? ''

describe('one tool call, one component', () => {
  it('on its own, in a run and in the whole-answer panel, the call is drawn by ToolEntry', async () => {
    const alone = await pane([asked], null)
    const aloneEntry = theOneDrawing(alone.host, 'on its own')
    const chevron = aloneEntry.querySelector('.chevron')!
    const name = aloneEntry.querySelector('.tool-summary strong')!.getBoundingClientRect()
    const summary = aloneEntry.querySelector('.tool-summary code')!.getBoundingClientRect()
    expect(summary.left - name.right, 'the name and the summary are apart').toBeGreaterThan(0)
    // The chevron points right while folded and down once opened, as its neighbours do; the poll
    // waits out the turn's transition.
    expect(getComputedStyle(chevron).transform, 'folded points right').toBe('none')
    await press(aloneEntry.querySelector('[data-cy^="tool-toggle-"]'), 'toggle on its own')
    await expect.poll(() => getComputedStyle(chevron).transform).not.toBe('none')
    const id = idOf(theOneDrawing(alone.host, 'on its own, opened'))
    alone.unmount()

    const { panel, inPanel } = await panelFor(answered('sent'), held('sent'))
    expect(idOf(inPanel), 'the same call everywhere').toBe(id)
    // The whole answer takes the place of the short one, inside the card.
    expect(inPanel.querySelector('[data-cy="tool-answer-paper"]')).not.toBeNull()
    expect(inPanel.querySelector('[data-cy="tool-output"]')).toBeNull()
    expect(panel.querySelector('[data-cy="tool-answer-name"]')).toBeNull()
  })

  it('keeps the whole-answer panel’s states inside the card', async () => {
    const notHeld = await panelFor(answered('Sent to Ada.'), null)
    expect(words(notHeld.inPanel, 'tool-answer-absence')).toContain('not holding')
    expect(words(notHeld.inPanel, 'tool-answer-short-form')).toContain('Sent to Ada.')
    notHeld.m.unmount()

    const noWords = await panelFor(answered('done'), held())
    expect(words(noWords.inPanel, 'tool-answer-absence')).toContain('carried no words')
    noWords.m.unmount()

    const failed = await panelFor(answered('No such conversation.', false), held('Not found.'))
    expect(failed.inPanel.getAttribute('data-status')).toBe('error')
    expect(words(failed.inPanel, 'tool-amiss')).toBe('failed')
    expect(words(failed.inPanel, 'tool-answer-body-0')).toBe('Not found.')
  })
})
