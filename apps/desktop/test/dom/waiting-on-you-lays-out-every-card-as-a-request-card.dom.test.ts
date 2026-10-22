import { afterEach, describe, expect, it } from 'vitest'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import { aWaitingPageWithEveryCard } from './a-waiting-page-with-every-card'
import { unmountAll, type Mounted } from './harness'

/**
 * On *Waiting on you*, every kind of card is of the same family as the request cards — stopped
 * work, the providers' usage, questions, to-dos, work no agent is driving, recoveries, asks about an
 * agent's rules, MCP server requests and work waiting on a reply: the same grid, the same shell and
 * the same top-line type, with their words, buttons and doors unchanged.
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
const KINDS = ['.pq-stall', '.usage-limit', '.wait', '.request', '.asks > .ask', '.reply'] as const

/** Each kind's top line, set in the request card's caption type. */
const TOP_LINES =
  '.pq-stop-who, .pq-stall > .pq-stall-says:first-child, .usage-says, .wait-head, .request-who, .ask-who, .reply-who'

/** Each kind's controls, which sit at the card's foot. */
const FEET =
  '.pq-stop-actions, .pq-stall > .pq-go, .wait-controls, .request-controls, .ask-controls, .reply-go'

describe('every kind of card is a card like the request cards', () => {
  it('in a list 832px or wider, every kind sits two to a row, at the request cards’ width', async () => {
    const m = await aWaitingPageWithEveryCard(1180)
    const requests = cardsOf(m, '.pq-row')
    const stopped = cardsOf(m, '[data-cy^="persons-queue-stopped-"].pq-stall')
    const usage = cardsOf(m, '[data-cy^="persons-queue-wall-"].usage-limit')
    const stalled = cardsOf(m, '[data-cy="persons-queue-stall"]')
    expect([requests.length, stopped.length, usage.length, stalled.length]).toEqual([3, 2, 2, 1])
    const width = box(requests[0]!).width
    expect(width).toBeLessThan(box(m.q('waiting-on-you')).width / 2)
    for (const card of [...stopped, ...usage, ...stalled])
      expect(Math.abs(box(card).width - width), card.dataset.cy).toBeLessThan(1)
    // Two to a row: the pair shares its top and its height, and the second sits right of the first.
    for (const pair of [stopped, usage]) {
      expect(box(pair[1]!).top).toBeCloseTo(box(pair[0]!).top, 0)
      expect(box(pair[1]!).height).toBeCloseTo(box(pair[0]!).height, 0)
      expect(box(pair[1]!).left).toBeGreaterThan(box(pair[0]!).right)
    }
  })

  it('in a narrower list, each is one to a row, as the request cards are', async () => {
    const m = await aWaitingPageWithEveryCard(720)
    const width = box(m.host.querySelector<HTMLElement>('.pq-row')!).width
    const [first, second] = cardsOf(m, '[data-cy^="persons-queue-stopped-"].pq-stall')
    expect(Math.abs(box(first!).width - width)).toBeLessThan(1)
    expect(box(second!).top).toBeGreaterThan(box(first!).bottom)
  })

  it('wears the request card’s shell, and its top line in the request card’s type', async () => {
    const m = await aWaitingPageWithEveryCard(1180, 3200, true)
    const top = m.host.querySelector<HTMLElement>('.pq-row .pq-hop')!
    const request = top.closest<HTMLElement>('.pq-row')!
    for (const kind of KINDS) {
      const cards = cardsOf(m, `.attention-list ${kind}`)
      expect(cards.length, `${kind} is drawn`).toBeGreaterThan(0)
      for (const card of cards) expect(shell(card), kind).toEqual(shell(request))
    }
    for (const line of cardsOf(m, TOP_LINES))
      expect(getComputedStyle(line).fontSize, line.className).toBe(getComputedStyle(top).fontSize)
  })

  it('lays every kind out at the request cards’ width in a list 832px or wider', async () => {
    const m = await aWaitingPageWithEveryCard(1180, 3200, true)
    const width = box(m.host.querySelector<HTMLElement>('.pq-row')!).width
    for (const kind of KINDS)
      for (const card of cardsOf(m, `.attention-list ${kind}`))
        expect(Math.abs(box(card).width - width), kind).toBeLessThan(1)
  })

  it('puts every card’s controls at its foot', async () => {
    const m = await aWaitingPageWithEveryCard(1180, 3200, true)
    for (const foot of cardsOf(m, FEET)) {
      const card = foot.closest<HTMLElement>(
        '.pq-stall, .usage-limit, .wait, .request, .ask, .reply',
      )!
      expect(box(card).bottom - box(foot).bottom, foot.className).toBeLessThan(
        parseFloat(getComputedStyle(card).paddingBottom) + 2,
      )
    }
  })

  it('keeps the rules an agent asked for readable, in the request card’s code box', async () => {
    const m = await aWaitingPageWithEveryCard(1180, 3200, true)
    const text = m.host.querySelector<HTMLElement>('.ask-text')!
    const code = m.host.querySelector<HTMLElement>('.pq-request-line')!
    expect(text.textContent).toBe('Always show prices with two decimals.')
    for (const name of ['background-color', 'color', 'border-top-color'] as const)
      expect(getComputedStyle(text).getPropertyValue(name), name).toBe(
        getComputedStyle(code).getPropertyValue(name),
      )
  })

  it('lets one provider’s usage take the whole row, where two share it', async () => {
    const one = await aWaitingPageWithEveryCard(1180, 1400, false, true)
    const list = one.q('persons-queue-walls')
    const lone = one.q('persons-queue-wall-claude')
    expect(Math.abs(box(lone).width - box(list).width)).toBeLessThan(1)
  })

  it('keeps every word, button and door, with the controls at each card’s foot', async () => {
    const m = await aWaitingPageWithEveryCard(1180)
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
