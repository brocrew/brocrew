import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { clockTime } from '../../src/shared/clock'
import { fullTime } from '../../src/renderer/src/lib/clock'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { wearTheme } from '../../look/fixtures/themes'
import SummaryEntry from '../../src/renderer/src/components/SummaryEntry.vue'
import NoticeEntry from '../../src/renderer/src/components/NoticeEntry.vue'
import OutsideCard from '../../src/renderer/src/components/OutsideCard.vue'
import { mount, unmountAll } from './harness'

const AT = Date.UTC(2026, 10, 11, 15, 51)
const COMMAND = 'Ran the fictional checks and kept every result. '.repeat(12)
const DETAIL = 'Reviewed the fictional change and recorded the result. '.repeat(12)
const WARNINGS = [
  'The fictional provider is approaching its rate limit.',
  'The fictional command stopped before its result was saved.',
]
const summaries = [
  { kind: 'commandSummary', id: 'command', description: COMMAND, at: AT },
  { kind: 'turnSummary', id: 'turn', status: 'completed', detail: DETAIL, needsAction: '', at: AT },
] as const

function stage() {
  return defineComponent(() => () =>
    h('div', { style: 'width:100%' }, [
      h(OutsideCard, {
        shifted: true,
        exchange: { from: 'Mira', to: 'Noor', kind: 'message', text: 'The fictional note', at: AT },
      }),
      ...summaries.map((item) => h(SummaryEntry, { item })),
      ...WARNINGS.map((text, index) =>
        h(NoticeEntry, { item: { kind: 'notice', id: `warning-${index}`, level: 'warn', text, at: AT } }),
      ),
    ]),
  )
}

afterEach(() => {
  unmountAll()
  applyTheme(null)
})

for (const theme of ['classic', 'crew-night'] as const) {
  describe(theme, () => {
    for (const width of [1180, 760]) {
      it(`keeps both summaries on the note-card edge with icons, time and full hover text at ${width}`, () => {
        if (theme === 'crew-night') wearTheme(theme)
        const view = mount(stage(), {}, { width })
        const note = view.q('outside-card')
        const noteBox = note.getBoundingClientRect()
        const noteStyle = getComputedStyle(note)
        for (const [kind, text, icon] of [
          ['command-summary', COMMAND, '#i-terminal'],
          ['turn-summary', `completed · ${DETAIL}`, '#i-check'],
        ]) {
          const row = view.q(kind!)
          const style = getComputedStyle(row)
          expect(style.borderTopWidth).toBe(noteStyle.borderTopWidth)
          expect(style.borderTopStyle).toBe('solid')
          expect(style.borderRadius).toBe(noteStyle.borderRadius)
          expect(style.backgroundColor).toBe(noteStyle.backgroundColor)
          expect(row.getBoundingClientRect().left).toBeCloseTo(noteBox.left, 1)
          expect(row.getBoundingClientRect().width).toBeCloseTo(noteBox.width, 1)
          expect(row.querySelector('use')?.getAttribute('href')).toBe(icon)
          const words = row.querySelector<HTMLElement>('[data-cy="summary-words"]')
          expect(words).not.toBeNull()
          expect(words!.textContent?.trim()).toBe(text!.trim())
          expect(words!.title).toBe(text)
          expect(getComputedStyle(words!).whiteSpace).toBe('nowrap')
          expect(getComputedStyle(words!).textOverflow).toBe('ellipsis')
          expect(words!.scrollWidth).toBeGreaterThan(words!.clientWidth)
          const time = row.querySelector<HTMLElement>('[data-cy="summary-time"]')
          expect(time?.textContent?.trim()).toBe(clockTime(AT))
          expect(time?.title).toBe(fullTime(AT))
          expect(time!.getBoundingClientRect().left).toBeGreaterThan(words!.getBoundingClientRect().right)
        }
      })

      it(`frames every warning with amber, a clock and time without changing words at ${width}`, () => {
        if (theme === 'crew-night') wearTheme(theme)
        const view = mount(stage(), {}, { width })
        const note = view.q('outside-card')
        const warnings = view.all('notice-warn')
        expect(warnings).toHaveLength(WARNINGS.length)
        for (const [index, row] of warnings.entries()) {
          const style = getComputedStyle(row)
          const token = document.createElement('span')
          token.style.color = 'var(--waiting-card-border)'
          row.append(token)
          expect(style.borderTopColor).toBe(getComputedStyle(token).color)
          token.remove()
          expect(style.borderTopWidth).toBe(getComputedStyle(note).borderTopWidth)
          expect(style.borderTopStyle).toBe('solid')
          expect(row.getBoundingClientRect().left).toBeCloseTo(note.getBoundingClientRect().left, 1)
          expect(row.querySelector('use')?.getAttribute('href')).toBe('#i-clock')
          expect(row.querySelector('[data-cy="what-the-notice-says"]')?.textContent).toBe(WARNINGS[index])
          expect(row.querySelector('.time')?.textContent).toBe(clockTime(AT))
        }
      })
    }
  })
}

it('retains the existing info and error presentation', () => {
  for (const level of ['info', 'error'] as const) {
    const view = mount(NoticeEntry, {
      item: { kind: 'notice', id: level, level, text: 'The fictional notice', at: AT },
    })
    const row = view.q(`notice-${level}`)
    expect(getComputedStyle(row).borderTopWidth).toBe('0px')
    expect(row.querySelector('use')).toBeNull()
    expect(view.q('what-the-notice-says').textContent).toBe('The fictional notice')
  }
})

