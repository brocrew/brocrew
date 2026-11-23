import { afterEach, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import ToolEntry from '../../src/renderer/src/components/ToolEntry.vue'
import { applyEvent } from '../../src/renderer/src/lib/transcript'
import { mount, paneProps, record, unmountAll } from './harness'

afterEach(unmountAll)
const tick = async (): Promise<void> => {
  await nextTick()
  await nextTick()
  await nextTick()
}

it.each(['command', 'job', 'monitor'] as const)(
  'opens the same %s call in the conversation, Running now and Past runs',
  async (kind) => {
    const input = 'node check-map.mjs\nDirectory: /sample/maps'
    const session = ref(
      record([
        { type: 'user_turn', text: 'Check the route' },
        {
          type: 'tool_call',
          id: 'map-check',
          name: 'Run check',
          summary: 'Short input',
          run: { kind, input, progress: 'Checking the footpath' },
        },
      ]),
    )
    const Host = defineComponent({
      setup: () => () =>
        h(ConversationPane, paneProps({ record: session.value, drawerOpen: true })),
    })
    const m = mount(Host, {}, { width: 1400, height: 900 })
    const scope = (ToolEntry as { __scopeId?: string }).__scopeId!
    function checkCall(place: Element): void {
      const calls = place.querySelectorAll('[data-cy=tool-entry]')
      expect(calls).toHaveLength(1)
      expect(calls[0]!.hasAttribute(scope)).toBe(true)
      expect(calls[0]!.querySelector('[data-cy=tool-input]')?.textContent).toBe(input)
      expect(calls[0]!.querySelectorAll('[data-cy=tool-input]')).toHaveLength(1)
    }
    const conversationCall = m.q('tool-entry')
    const chevron = conversationCall.querySelector<SVGElement>('.chevron')!
    expect(getComputedStyle(chevron).transform).toBe('none')
    const name = conversationCall.querySelector('strong')!.getBoundingClientRect()
    const summary = conversationCall.querySelector('code')!.getBoundingClientRect()
    expect(summary.left).toBeGreaterThan(name.right)
    conversationCall.querySelector<HTMLButtonElement>('[data-cy^=tool-toggle-]')!.click()
    await tick()
    checkCall(conversationCall.parentElement!)
    await expect.poll(() => getComputedStyle(chevron).transform).toBe('matrix(0, 1, -1, 0, 0, 0)')
    expect(conversationCall.querySelector('[data-cy=run-state]')?.textContent).toContain(
      'Checking the footpath',
    )
    m.q('panel-row').click()
    await tick()
    checkCall(m.q('close-overlay').closest('.sheet-shell')!)
    expect(m.q('close-overlay').closest('.sheet-shell')!.textContent).toContain(
      'Checking the footpath',
    )
    m.q('close-overlay').click()
    await tick()
    applyEvent(session.value.transcript, {
      type: 'tool_result',
      id: 'map-check',
      ok: true,
      summary: 'Three paths checked.',
      run: { result: 'Map checked' },
    })
    await tick()
    expect(m.q('running-now-rows').querySelectorAll('[data-cy=panel-row]')).toHaveLength(0)
    m.q('past-runs-open').click()
    await tick()
    expect(m.q('past-runs-dialog').textContent).toContain('Map checked')
    m.q('panel-row').click()
    await tick()
    const sheet = m.q('close-overlay').closest('.sheet-shell')!
    checkCall(sheet)
    expect(sheet.querySelector('[data-cy=run-state]')?.textContent).toContain('Map checked')
    expect(sheet.querySelector('[data-cy=run-state]')?.textContent).not.toContain(
      'Checking the footpath',
    )
    expect(sheet.querySelector('[data-cy=tool-output]')?.textContent).toContain(
      'Three paths checked.',
    )
  },
)
