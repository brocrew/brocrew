import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, reactive, type Component } from 'vue'
import AgentCard from '../../src/renderer/src/components/AgentCard.vue'
import AssistantMessage from '../../src/renderer/src/components/AssistantMessage.vue'
import HumanAnswerDialog from '../../src/renderer/src/components/HumanAnswerDialog.vue'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { resolveTheme, type Theme } from '../../src/shared/themes/theme'
import { validateTheme } from '../../src/shared/themes/validate'
import DEFINED from '../../resources/themes/defined/theme.json'
import BROCREW from '../../resources/themes/brocrew/theme.json'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, parseColor, paintedBackground, contrast } from './harness'

afterEach(() => { unmountAll(); applyTheme(null) })
function stateOf(events: TranscriptEvent[]) {
  const state = reactive(createTranscript())
  events.forEach((event, ordinal) => applyEvent(state, event, 1000 + ordinal, ordinal))
  return state
}
const first: TranscriptEvent[] = [
  { type: 'user_turn', text: 'My **human prompt**\n\n`detail`', humanInitiated: true },
  { type: 'assistant_message', text: 'Working', phase: 'commentary' },
  { type: 'assistant_message', text: '## Human answer\n\n- Item\n\n[Recipe notes](https://example.org/recipes)\n\n```js\nconst ok = true\n```\n\n<script>bad()</script>', phase: 'final' },
  { type: 'turn', state: 'completed' },
  { type: 'user_turn', text: 'Agent update', attribution: 'app_authored', relayedFrom: 'sess_other' },
  { type: 'assistant_message', text: 'Later app answer', phase: 'final' },
  { type: 'turn', state: 'completed' },
]

describe('human final answer surfaces', () => {
  it('opens the matching full prompt and final Markdown, keeps the popup paired, and closes with Escape', async () => {
    const state = stateOf(first)
    const navigated: string[] = []
    const host = defineComponent({ setup: () => () => h(AgentCard as Component, {
      state, shown: state, mode: 'normal', conversation: 's', who: 'Fictional agent',
      onNavigate: (id: string) => navigated.push(id),
    }) })
    const m = mount(host, {}, { width: 360, height: 900 })
    expect(m.q('card-latest-words').textContent).toContain('Human answer')
    m.q('card-latest').focus()
    m.q('card-latest').click(); await nextTick(); await nextTick()
    expect(m.q('human-answer-dialog').contains(document.activeElement)).toBe(true)
    expect(m.q('human-answer-prompt').querySelector('strong')?.textContent).toBe('human prompt')
    expect(m.q('human-answer-final').querySelector('h2')?.textContent).toBe('Human answer')
    expect(m.q('human-answer-final').querySelector('pre code')?.textContent).toContain('const ok = true')
    expect(m.q('human-answer-final').querySelector('script')).toBeNull()
    expect(m.q('human-answer-final').textContent).not.toContain('Later app answer')
    applyEvent(state, { type: 'user_turn', text: 'Second question', humanInitiated: true }, 2000, 7)
    applyEvent(state, { type: 'assistant_message', text: 'Second answer', phase: 'final' }, 2001, 8)
    await nextTick()
    expect(m.q('human-answer-prompt').textContent).toContain('human prompt')
    expect(m.q('card-latest-words').textContent).toBe('Second answer')
    expect(navigated).toEqual([])
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(m.all('human-answer-dialog')).toHaveLength(0)
    expect(document.activeElement).toBe(m.q('card-latest'))
  })

  it.each(['no human', 'pending', 'interrupted'] as const)('preserves the existing click for %s', async (which) => {
    const events: TranscriptEvent[] = [{ type: 'assistant_message', text: 'Current response' }]
    if (which !== 'no human') events.push({ type: 'user_turn', text: 'Question', humanInitiated: true })
    if (which === 'interrupted') events.push({ type: 'turn', state: 'interrupted' })
    const state = stateOf(events)
    const navigated: string[] = []
    const m = mount(AgentCard, { state, shown: state, mode: 'normal', conversation: 's', onNavigate: (id: string) => navigated.push(id) }, { width: 360, height: 800 })
    m.q('card-latest').click(); await nextTick()
    expect(m.q('card-latest-words').textContent).toBe('Current response')
    expect(navigated).toEqual([state.items.find((item) => item.kind === 'assistant')!.id])
    expect(m.all('human-answer-dialog')).toHaveLength(0)
  })

  it.each(['Classic dark', 'Classic light', 'Defined', 'BroCrew'] as const)('reads history and the paired popup using the actual %s theme cascade', async (theme) => {
    const base = validateTheme(DEFINED, { assets: new Map(), builtIns: new Map(), builtIn: true })
    if (!base.ok) throw new Error(JSON.stringify(base.problems))
    if (theme === 'Defined') applyTheme(base.theme)
    else if (theme === 'BroCrew') applyTheme(resolveTheme(BROCREW as Theme, base.theme))
    else applyTheme(null)
    const state = stateOf(first)
    const assistants = state.items.filter((item) => item.kind === 'assistant')
    const host = defineComponent({ setup: () => () => h('div', {
      'data-chat-theme': theme === 'Classic dark' ? undefined : 'light',
    }, [
      ...assistants.map((item) => h(AssistantMessage as Component, { item })),
      h(HumanAnswerDialog, { answer: state.humanAnswers.latest! }),
    ]) })
    const m = mount(host, {}, { width: 900, height: 900 })
    await nextTick()
    const highlighted = m.host.querySelectorAll('[data-human-final="true"]')
    expect(highlighted).toHaveLength(1)
    expect(highlighted[0]!.textContent).toContain('Answer to you')
    const column = highlighted[0]!.querySelector('.msg-column')!
    expect(getComputedStyle(column).borderInlineStartWidth).toBe('3px')
    expect(getComputedStyle(column).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    for (const selector of ['.final-label', '.msg-body p', '.msg-body a', '.msg-body pre code', '.time']) {
      const element = highlighted[0]!.querySelector(selector)!
      expect(element, selector).not.toBeNull()
      const ink = parseColor(getComputedStyle(element).color)
      expect(ink, selector).not.toBeNull()
      expect(contrast(ink!, paintedBackground(element)), `${theme} history ${selector}`).toBeGreaterThanOrEqual(4.5)
    }
    const dialog = m.q('human-answer-dialog')
    expect(getComputedStyle(dialog).borderTopWidth).toBe('1px')
    for (const selector of ['h2', 'h3', '[data-cy="human-answer-prompt"] p', '[data-cy="human-answer-final"] p', '[data-cy="human-answer-final"] a', 'pre code']) {
      const element = dialog.querySelector(selector)!
      expect(element, selector).not.toBeNull()
      const ink = parseColor(getComputedStyle(element).color)
      expect(ink, selector).not.toBeNull()
      expect(contrast(ink!, paintedBackground(element)), `${theme} popup ${selector}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
