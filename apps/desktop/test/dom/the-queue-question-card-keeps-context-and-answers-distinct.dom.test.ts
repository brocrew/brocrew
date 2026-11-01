import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import QuestionCard from '../../src/renderer/src/components/QuestionCard.vue'
import type { QuestionCardReading } from '../../src/renderer/src/lib/question-card'
import type { UserInputResponse } from '../../src/shared/runtime-ipc'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { wearTheme } from '../../look/fixtures/themes'
import { mount, unmountAll, visible } from './harness'

afterEach(() => {
  unmountAll()
  applyTheme(null)
})

const words =
  'Should the community workshop run on Saturday alone or across the full weekend? ' +
  'Mira checked the room sizes and the volunteer rota. '.repeat(12)
const context =
  'The venue has not been booked yet.\n\n' +
  'Draft timetable: https://workshop.invalid/planning/timetable\n' +
  'Room notes: https://workshop.invalid/venues/room-notes\n' +
  'Volunteer rota: https://workshop.invalid/planning/volunteers'

const reading: QuestionCardReading = {
  requestId: 'workshop-question',
  asker: 'Aster',
  verb: 'passed up to',
  askedOf: 'you',
  piece: null,
  via: null,
  at: null,
  atTitle: null,
  words,
  context,
  wordsAreCut: false,
  wordsMissing: false,
  parts: [
    {
      id: 'schedule',
      header: null,
      prompt: null,
      multiSelect: false,
      typed: true,
      secret: false,
      options: [
        { label: 'Saturday only', description: null },
        { label: 'Full weekend', description: null },
      ],
    },
  ],
  state: 'open',
  answeredBy: null,
  answerable: true,
  refused: null,
  note: null,
  receipt: null,
  where: { conversation: 'workshop', held: false, action: 'Open the conversation →' },
}

function card(width = 720, fold = true, read = reading, mode = 'light') {
  const answers: UserInputResponse[] = []
  const opened: string[] = []
  const shell = defineComponent({
    setup: () => () =>
      h(
        'div',
        {
          'data-chat-theme': mode,
          style: 'width:100%;background:var(--panel);align-self:flex-start',
        },
        h(QuestionCard, {
          reading: read,
          fold,
          onAnswer: (response: UserInputResponse) => answers.push(response),
          onOpenConversation: (id: string) => opened.push(id),
        }),
      ),
  })
  return Object.assign(mount(shell, {}, { width, height: 1600 }), { answers, opened })
}

function firstLetterTop(element: Element, phrase: string): number {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    const start = node.textContent?.indexOf(phrase) ?? -1
    if (start < 0) continue
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, start + 1)
    return range.getBoundingClientRect().top
  }
  throw new Error(`Missing context line: ${phrase}`)
}

const themes = [
  'classic-dark',
  'classic-light',
  'defined',
  'brocrew',
  'synthwave',
  'crew-night',
] as const

describe('the queue question separates its context from answering', () => {
  for (const theme of themes) {
    it(`${theme}: round badge, folded and expanded context, distinct answer area at both widths`, async () => {
      if (theme === 'classic-dark' || theme === 'classic-light') applyTheme(null)
      else wearTheme(theme)
      const m = card(720, true, reading, theme === 'classic-dark' ? 'dark' : 'light')
      const badge = m.q('question-head').querySelector('svg')!
      expect(badge.querySelector('use')?.getAttribute('href')).toBe('#i-question')
      expect(badge.getAttribute('aria-hidden')).toBe('true')
      expect(badge.getBoundingClientRect().width).toBe(24)
      expect(badge.getBoundingClientRect().height).toBe(24)
      expect(parseFloat(getComputedStyle(badge).borderRadius)).toBeGreaterThanOrEqual(12)
      expect(getComputedStyle(badge).borderTopStyle).toBe('solid')

      expect(m.q('question-words').getAttribute('data-folded')).toBe('true')
      expect(m.q('question-words').scrollHeight).toBeGreaterThan(m.q('question-words').clientHeight)
      expect(m.all('question-context')).toHaveLength(0)
      expect(m.q('question-more').textContent?.trim()).toBe('Read full question')
      expect(m.q('question-more').getAttribute('aria-expanded')).toBe('false')
      expect(getComputedStyle(m.q('question-more')).borderTopStyle).toBe('solid')
      expect(m.all('question-option').map((option) => option.textContent?.trim())).toEqual([
        'Saturday only',
        'Full weekend',
      ])
      for (const option of m.all('question-option')) expect(visible(option)).toBe(true)

      m.q('question-more').click()
      await nextTick()
      expect(m.q('question-words').getAttribute('data-folded')).toBe('false')
      expect(m.q('question-words').textContent).toBe(words)
      expect(m.q('question-more').textContent?.trim()).toBe('Show less')
      expect(m.q('question-more').getAttribute('aria-expanded')).toBe('true')
      const quote = m.q('question-context')
      expect(quote.textContent).toContain(context)
      expect(quote.querySelector('.lead')?.textContent).toContain('Added')
      expect(getComputedStyle(quote).whiteSpace).toBe('pre-wrap')
      expect(getComputedStyle(quote).borderLeftWidth).toBe('2px')
      expect(getComputedStyle(quote).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
      expect(getComputedStyle(quote.querySelector('.lead')!).display).toBe('block')
      const lineTops = ['Draft timetable:', 'Room notes:', 'Volunteer rota:'].map((line) =>
        firstLetterTop(quote, line),
      )
      expect(lineTops[1]!).toBeGreaterThan(lineTops[0]!)
      expect(lineTops[2]!).toBeGreaterThan(lineTops[1]!)
      expect(getComputedStyle(m.q('question-part-schedule')).borderTopStyle).toBe('solid')
      expect(getComputedStyle(m.q('question-part-schedule')).borderTopWidth).toBe('1px')
      expect(getComputedStyle(m.q('question-where')).textDecorationLine).toBe('none')
      expect(getComputedStyle(m.q('question-where')).textAlign).toBe('left')

      for (const width of [720, 360]) {
        m.host.style.width = `${width}px`
        await nextTick()
        expect(m.q('question-card').scrollWidth).toBeLessThanOrEqual(
          m.q('question-card').clientWidth,
        )
        expect(quote.scrollWidth).toBeLessThanOrEqual(quote.clientWidth)
        expect(m.q('question-where').textContent?.trim()).toBe('Open the conversation →')
      }
      m.q('question-more').click()
      await nextTick()
      expect(m.all('question-context')).toHaveLength(0)
      expect(m.q('question-more').getAttribute('aria-expanded')).toBe('false')
      expect(m.q('question-more').textContent?.trim()).toBe('Read full question')
      for (const option of m.all('question-option')) expect(visible(option)).toBe(true)
      expect(m.q('question-card').scrollWidth).toBeLessThanOrEqual(m.q('question-card').clientWidth)
    })
  }

  it('keeps choice, typed answer and conversation handlers through a fold cycle', async () => {
    const m = card()
    m.q('question-more').click()
    await nextTick()
    m.all('question-option')[1]!.click()
    expect(m.answers).toEqual([{ kind: 'answer', answers: { schedule: ['Full weekend'] } }])
    const box = m.q('question-box') as HTMLTextAreaElement
    box.value = 'Saturday morning'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    m.q('question-more').click()
    await nextTick()
    expect(box.value).toBe('Saturday morning')
    m.q('question-send').click()
    expect(m.answers[1]).toEqual({ kind: 'answer', answers: { schedule: ['Saturday morning'] } })
    m.q('question-where').click()
    expect(m.opened).toEqual(['workshop'])
  })

  it('keeps answer controls disabled while sending', async () => {
    const m = card(720, true, { ...reading, state: 'sending' })
    for (const option of m.all('question-option')) {
      expect((option as HTMLButtonElement).disabled).toBe(true)
      option.click()
    }
    expect((m.q('question-box') as HTMLTextAreaElement).disabled).toBe(true)
    expect(m.answers).toEqual([])
    m.q('question-more').click()
    await nextTick()
    expect(m.q('question-context').textContent).toContain(context)
  })

  it('leaves the conversation card outside the queue styling and fully expanded', () => {
    const m = card(720, false)
    expect(m.q('question-card').classList.contains('queue-question')).toBe(false)
    expect(m.all('question-more')).toHaveLength(0)
    expect(m.q('question-context').textContent).toContain(context)
    const badge = m.q('question-head').querySelector('svg')!
    expect(badge.getBoundingClientRect().width).toBe(11)
    expect(getComputedStyle(m.q('question-part-schedule')).borderTopWidth).toBe('0px')
  })
})
