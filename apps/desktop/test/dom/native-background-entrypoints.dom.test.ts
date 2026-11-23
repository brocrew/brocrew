import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, ref } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import RunInput from '../../src/renderer/src/components/RunInput.vue'
import { applyEvent } from '../../src/renderer/src/lib/transcript'
import { mount, paneProps, record, unmountAll } from './harness'

afterEach(unmountAll)
const tick = async (): Promise<void> => {
  await nextTick()
  await nextTick()
  await nextTick()
}

it.each([
  [undefined, false],
  [undefined, true],
  ['unloaded-call', false],
  ['unloaded-call', true],
] as const)(
  'opens native facts from Running now and Past with binding %s and unfinished %s',
  async (toolCallId, unfinished) => {
    const input = 'Read the route notes. Keep the footpath open.'
    const session = ref(
      record([
        {
          type: 'background_work',
          source: 'fixture',
          running: [
            {
              id: 'route-task',
              toolCallId,
              description: 'Route notes',
              run: { kind: 'command', input, progress: 'Reading notes' },
            },
          ],
        },
      ]),
    )
    const Host = defineComponent({
      setup: () => () =>
        h(ConversationPane, paneProps({ record: session.value, drawerOpen: true })),
    })
    const m = mount(Host, {}, { width: 1400, height: 900 })
    const scope = (RunInput as { __scopeId?: string }).__scopeId!
    const checkInput = (): Element => {
      const sheet = m.q('close-overlay').closest('.sheet-shell')!
      const drawn = sheet.querySelectorAll('[data-cy=run-input]')
      expect(drawn).toHaveLength(1)
      expect(drawn[0]!.hasAttribute(scope)).toBe(true)
      expect(drawn[0]!.textContent).toContain(input)
      expect(sheet.querySelectorAll('[data-cy=tool-entry]')).toHaveLength(0)
      return sheet
    }
    m.q('panel-row').click()
    await tick()
    expect(checkInput().querySelector('[data-cy=run-state]')?.textContent).toContain(
      'Reading notes',
    )
    m.q('close-overlay').click()
    await tick()
    if (unfinished) {
      applyEvent(session.value.transcript, { type: 'status', state: 'ended' })
    } else {
      applyEvent(session.value.transcript, {
        type: 'background_work',
        source: 'fixture',
        running: [],
        ended: {
          id: 'route-task',
          outcome: 'completed',
          run: { result: 'Route checked' },
        },
      })
    }
    await tick()
    m.q('past-runs-open').click()
    await tick()
    if (unfinished) expect(m.q('panel-row').textContent).toContain('did not finish')
    m.q('panel-row').click()
    await tick()
    const result = checkInput().querySelector('[data-cy=run-state]')?.textContent
    if (unfinished) {
      expect(result).toContain('Reading notes')
      expect(result).not.toContain('Route checked')
    } else {
      expect(result).toContain('Route checked')
      expect(result).not.toContain('Reading notes')
    }
  },
)

it('keeps six long native history rows readable in the 360-pixel Past runs popup', async () => {
  await page.viewport(392, 900)
  try {
    const session = record([])
    for (let index = 0; index < 6; index++) {
      applyEvent(session.transcript, {
        type: 'background_work',
        source: 'fixture',
        ended: {
          id: `route-${index}`,
          outcome: 'completed',
          run: { kind: 'command', input: 'LongRouteName'.repeat(25), result: 'Route checked' },
        },
      })
    }
    const m = mount(ConversationPane, paneProps({ record: session, drawerOpen: true }), {
      width: 392,
      height: 900,
    })
    m.q('past-runs-open').click()
    await tick()
    const past = m.q('past-runs-dialog')
    expect(past.getBoundingClientRect().width).toBe(360)
    expect(past.scrollWidth).toBeLessThanOrEqual(past.clientWidth)
    expect(past.querySelectorAll('[data-cy=panel-row]')).toHaveLength(6)
    for (const row of past.querySelectorAll<HTMLElement>('[data-cy=panel-row]')) {
      expect(row.clientWidth).toBeGreaterThan(0)
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth)
    }
  } finally {
    await page.viewport(1280, 900)
  }
})
