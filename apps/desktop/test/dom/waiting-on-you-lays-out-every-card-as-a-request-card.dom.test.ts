import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { page, userEvent } from 'vitest/browser'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import { aWaitingPageWithEveryCard } from './a-waiting-page-with-every-card'
import { unmountAll, type Mounted } from './harness'

/**
 * On *Waiting on you*, every kind of card is of the same family as the request cards — stopped
 * work, questions, to-dos, work no agent is driving, recoveries, asks about an agent's rules, MCP
 * server requests and work waiting on a reply: one to a row, the same shell and the same top-line
 * type, with their words, buttons and doors unchanged. The providers' usage sits in the page head.
 */

afterEach(() => {
  unmountAll()
  usePersonsQueue().forget()
})

const cardsOf = (m: Mounted, selector: string): HTMLElement[] => [
  ...m.host.querySelectorAll<HTMLElement>(selector),
]

const SHELL = [
  'background-color',
  'border-top-width',
  'border-top-color',
  'border-radius',
  'box-shadow',
  'padding-top',
  'padding-left',
] as const

const shell = (card: HTMLElement): Record<string, string> => {
  const style = getComputedStyle(card)
  return Object.fromEntries(SHELL.map((name) => [name, style.getPropertyValue(name)]))
}

const box = (card: HTMLElement) => card.getBoundingClientRect()

/** Each kind of card besides the permission requests, by the class its own component gives it. */
const KINDS = ['.pq-row', '.pq-stall', '.wait', '.request', '.asks > .ask', '.reply'] as const

const TOP_LINES =
  '.pq-stop-who, .pq-stall > .pq-stall-says:first-child, .request-who, .ask-who, .reply-who, .todo-head'

const FEET =
  '.pq-stop-actions, .pq-stall > .pq-go, .wait-controls, .request-controls, .ask-controls, .reply-go'

const LISTS = ['questions', 'todo', 'approvals', 'work', 'reply'] as const

/** Every card of the given kinds, list by list, as a person pages through the pills. */
async function eachList(
  m: Mounted,
  look: (cards: HTMLElement[], list: (typeof LISTS)[number]) => void,
): Promise<void> {
  for (const list of LISTS) {
    m.q(`waiting-pill-${list}`).click()
    await nextTick()
    look(
      KINDS.flatMap((kind) => cardsOf(m, `[data-cy="waiting-list-${list}"] ${kind}`)),
      list,
    )
  }
}

describe('every kind of card is a card like the request cards', () => {
  it('in every list, each card is one to a row, at one width', async () => {
    const m = await aWaitingPageWithEveryCard(1180, 3200, true)
    const width = box(m.host.querySelector<HTMLElement>('.pq-row')!).width
    let seen = 0
    await eachList(m, (cards, list) => {
      for (const card of cards) {
        expect(Math.abs(box(card).width - width), `${list} ${card.className}`).toBeLessThan(1)
        seen++
      }
      // One to a row: in the order they are drawn, each starts below the one before it ends.
      const down = [...cards].sort((a, b) => box(a).top - box(b).top)
      for (let at = 1; at < down.length; at++)
        expect(box(down[at]!).top, list).toBeGreaterThanOrEqual(box(down[at - 1]!).bottom - 1)
    })
    expect(seen).toBeGreaterThan(10)
  })

  it('in a narrower list, each is still one to a row, as wide as the list', async () => {
    const m = await aWaitingPageWithEveryCard(720)
    m.q('waiting-pill-work').click()
    await nextTick()
    const [first, second] = cardsOf(m, '[data-cy^="persons-queue-stopped-"].pq-stall')
    const list = m.host.querySelector<HTMLElement>('.attention-list')!
    expect(box(first!).width).toBeGreaterThan(box(list).width * 0.8)
    expect(box(second!).top).toBeGreaterThan(box(first!).bottom)
  })

  it('wears the request card’s shell, and its top line in one type', async () => {
    const m = await aWaitingPageWithEveryCard(1180, 3200, true)
    m.q('waiting-pill-approvals').click()
    await nextTick()
    const request = m.host.querySelector<HTMLElement>('.pq-row')!
    const theShell = shell(request)
    const sizes = new Set<string>()
    await eachList(m, (cards, list) => {
      for (const card of cards) expect(shell(card), `${list} ${card.className}`).toEqual(theShell)
      for (const line of cardsOf(m, TOP_LINES)) sizes.add(getComputedStyle(line).fontSize)
    })
    expect([...sizes]).toHaveLength(1)
    expect(parseFloat([...sizes][0]!)).toBeGreaterThanOrEqual(13)
  })

  it('puts every card’s controls at its foot', async () => {
    const m = await aWaitingPageWithEveryCard(1180, 3200, true)
    await eachList(m, () => {
      for (const foot of cardsOf(m, FEET)) {
        const card = foot.closest<HTMLElement>('.pq-stall, .wait, .request, .ask, .reply')!
        expect(box(card).bottom - box(foot).bottom, foot.className).toBeLessThan(
          parseFloat(getComputedStyle(card).paddingBottom) + 2,
        )
      }
    })
  })

  it('keeps the rules an agent asked for readable, in the request card’s code box', async () => {
    const m = await aWaitingPageWithEveryCard(1180, 3200, true)
    m.q('waiting-pill-approvals').click()
    await nextTick()
    const text = m.host.querySelector<HTMLElement>('.ask-text')!
    const code = m.q('permission-detail')
    expect(text.textContent).toBe('Always show prices with two decimals.')
    for (const name of ['background-color', 'color', 'border-top-color'] as const)
      expect(getComputedStyle(text).getPropertyValue(name), name).toBe(
        getComputedStyle(code).getPropertyValue(name),
      )
  })

  it('draws the providers’ usage in the page head, above every list', async () => {
    const m = await aWaitingPageWithEveryCard(1180, 1400)
    const walls = m.q('persons-queue-walls')
    expect(walls.closest('.page-head')).not.toBeNull()
    const list = m.host.querySelector<HTMLElement>('.attention-list')!
    for (const provider of ['claude', 'codex'])
      expect(box(m.q(`persons-queue-wall-${provider}`)).bottom).toBeLessThanOrEqual(box(list).top)
    unmountAll()
    for (const width of [720, 1180, 1677]) {
      const positions: number[] = []
      for (const notices of [0, 1, 2, 3]) {
        const view = await aWaitingPageWithEveryCard(width, 900, true, false, notices)
        const card = view.host.querySelector<HTMLElement>('.pq-row')!
        const band = view.host.querySelector<HTMLElement>('.head-chips')!
        expect(band.querySelectorAll('.chip')).toHaveLength(notices)
        positions.push(box(card).top)
        expect(box(band).bottom).toBeLessThanOrEqual(
          box(view.host.querySelector<HTMLElement>('.pills')!).top,
        )
        if (notices === 3) {
          if (width === 720) {
            expect(band.scrollWidth).toBeGreaterThan(band.clientWidth)
            band.focus()
            expect(document.activeElement).toBe(band)
            await userEvent.keyboard('{ArrowRight}')
            await expect.poll(() => band.scrollLeft).toBeGreaterThan(0)
          }
          band.scrollLeft = band.scrollWidth
          await nextTick()
          const last = view.q('persons-queue-wall-codex')
          expect(box(last).left).toBeGreaterThanOrEqual(box(band).left - 1)
          expect(box(last).right).toBeLessThanOrEqual(box(band).right + 1)
        }
        if (import.meta.env.VITE_WAITING_HEADER_CAPTURE)
          await page.screenshot({
            element: view.host,
            path: `${import.meta.env.VITE_WAITING_HEADER_CAPTURE}/waiting-${width}-${notices}.png`,
          })
        unmountAll()
      }
      expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(1)
    }
  })

  it('keeps every word, button and door, with the controls at each card’s foot', async () => {
    const m = await aWaitingPageWithEveryCard(1180)
    m.q('waiting-pill-work').click()
    await nextTick()
    for (const key of ['work_41', 'work_42']) {
      const card = m.q(`persons-queue-stopped-${key}`)
      expect(m.q(`persons-queue-stopped-look-${key}`).textContent).toContain('Look')
      expect(m.q(`persons-queue-stopped-hand-back-${key}`).textContent).toContain('Take back')
      const actions = card.querySelector<HTMLElement>('.pq-stop-actions')!
      expect(box(card).bottom - box(actions).bottom).toBeLessThan(
        parseFloat(getComputedStyle(card).paddingBottom) + 2,
      )
    }
    const stall = m.q('persons-queue-stall')
    const door = stall.querySelector<HTMLElement>('.pq-go')!
    expect(door.textContent).toContain('Open the conversation')
    expect(box(stall).right - box(door).right).toBeLessThan(
      parseFloat(getComputedStyle(stall).paddingRight) + 2,
    )
    expect(m.q('persons-queue-wall-says-claude').textContent).toContain(
      'Claude is near its weekly limit',
    )
    expect(m.q('persons-queue-wall-says-codex').title).not.toBe('')
  })
})
