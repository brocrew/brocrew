import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import NoticeEntry from '../../src/renderer/src/components/NoticeEntry.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { ToolAnswer, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { assertDrawn, drawnReady } from './drawn'
import { META, mount, paneProps, record, unmountAll, type Mounted } from './harness'

/**
 * # 🔴 685 · §2.1 — the act a refusal carries, on the two surfaces that lacked it (`675` F-d)
 *
 * ⚑ **The fold's join is `the-act-a-refusal-carries.test.ts`**, over the real toolset and both
 * providers' real normalizers. This file is the drawing: the notice quotes what the call was told,
 * and the whole-answer panel of a REOPENED conversation shows the short form its row kept.
 *
 * ⚑ **Every positive has a planted control in the same shape**, and every expected string is a
 * literal.
 */

const REAL = { width: 1200, height: 808 }

afterEach(async () => {
  unmountAll()
  await page.viewport(REAL.width, REAL.height)
})

/** The receipt `agent-tools.ts` writes for `too-deep`, as the Claude cut leaves it. */
const RECEIPT =
  'refused (too-deep): A conversation this deep may not start another one: ask the conversation that started you, or a person, to open it instead. It would sit at depth 1, and the deepest this agent may …'
const ACT = 'ask the conversation that started you, or a person, to open it instead'

const ev = (event: Record<string, unknown>): TranscriptEvent => event as unknown as TranscriptEvent

const EVENTS: TranscriptEvent[] = [
  ev({
    type: 'tool_inventory',
    naming: { prefix: 'mcp__', separator: '__' },
    declared: {
      server: 'brobot',
      tools: [{ name: 'spawn_agent', description: '', parameters: [] }],
    },
    published: null,
  }),
  ev({ type: 'tool_call', id: 'toolu_685', name: 'mcp__brobot__spawn_agent', summary: '{}' }),
  ev({
    type: 'tool_refused',
    tool: 'spawn_agent',
    rail: 'too-deep',
    permanence: 'until-a-person-changes-it',
    retryable: false,
  }),
  ev({ type: 'tool_result', id: 'toolu_685', ok: true, summary: RECEIPT }),
]

const words = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

async function aLivePane(read: () => Promise<ToolAnswer | null>): Promise<Mounted> {
  await page.viewport(REAL.width, REAL.height)
  const r = record(EVENTS)
  r.meta = { ...META, liveness: { ...META.liveness, canReadToolAnswer: true } }
  const m = mount(ConversationPane, paneProps({ record: r, onReadToolAnswer: read }), REAL)
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 30))
  return m
}

/** Open the refused call's row, press its door, and let the read land. */
async function openTheAnswer(m: Mounted): Promise<void> {
  const toggle =
    m.host.querySelector<HTMLElement>('[data-cy^="tool-toggle-"]') ??
    m.host.querySelector<HTMLElement>('[data-cy="tool-run-toggle"]')
  if (toggle === null) throw new Error('the row drew no toggle')
  toggle.click()
  await nextTick()
  const door =
    m.host.querySelector<HTMLElement>('[data-cy^="tool-answer-open-"]') ??
    m.host.querySelector<HTMLElement>('[data-cy^="tool-run-answer-open-"]')
  if (door === null) throw new Error('the row offered no door to the whole answer')
  door.click()
  await new Promise((resolve) => setTimeout(resolve, 30))
  await nextTick()
}

describe('685 §2.1 · the notice quotes what the refused call was told', () => {
  it('🔴 the act is ON the notice, drawn whole, inside what the notice says', async () => {
    const m = await aLivePane(async () => null)
    const told = m.q('refusal-told')
    // ⛔ The receipt was cut at the row's bound, and the cut mark is the normalizer's — so it is not
    // inside the quotation; *in part* says the words are the first part (`685`'s review).
    expect(words(told)).toBe(
      `· it was told, in part: “${RECEIPT.slice('refused (too-deep): '.length, -1)}”`,
    )
    expect(words(told)).toContain(ACT)
    expect(m.q('what-the-notice-says').contains(told)).toBe(true)
    await drawnReady()
    assertDrawn(told, 'what the refused call was told')
  })

  it('⛔ the control — a notice with nothing joined draws no quotation', async () => {
    const m = mount(
      NoticeEntry,
      {
        item: {
          kind: 'notice',
          id: 'n1',
          level: 'warn',
          text: 'refused: spawn_agent · too-deep · until somebody changes it · retrying will not help',
          at: 1,
        },
      },
      { width: 760, height: 200 },
    )
    await nextTick()
    expect(m.all('refusal-told')).toHaveLength(0)
    expect(words(m.q('what-the-notice-says'))).toBe(
      'refused: spawn_agent · too-deep · until somebody changes it · retrying will not help',
    )
  })
})

describe('685 §2.1 · a reopened panel shows the short form its row kept', () => {
  it('🔴 not holding the answer — and the row’s short form under it, act and all', async () => {
    const m = await aLivePane(async () => null)
    await openTheAnswer(m)
    expect(words(m.q('tool-answer-absence'))).toBe(
      'This app is not holding the answer to this one.',
    )
    const kept = m.q('tool-answer-short-form')
    expect(words(kept.querySelector('.short-form-head'))).toBe('The short form its row kept')
    expect(words(kept.querySelector('.short-form-body'))).toBe(RECEIPT)
    expect(words(kept)).toContain(ACT)
    // ⛔ Off the paper: the paper is where a WHOLE answer is drawn.
    expect(m.all('tool-answer-paper')).toHaveLength(0)
    await drawnReady()
    assertDrawn(kept, 'the short form the row kept')
  })

  it('⛔ the control — a receipt that carried no words draws no short form under it', async () => {
    // ⚑ `685`'s review: the row of a words-less receipt holds a placeholder, not the receipt's words.
    const m = await aLivePane(async () => ({ parts: [], partsDropped: 0 }))
    await openTheAnswer(m)
    expect(words(m.q('tool-answer-absence'))).toBe('The receipt arrived and carried no words.')
    expect(m.all('tool-answer-short-form')).toHaveLength(0)
  })

  it('⛔ the control — a held answer draws the answer, and no short form beside it', async () => {
    const m = await aLivePane(async () => ({
      parts: [{ text: RECEIPT.replace(' …', ' reach is 0.'), dropped: 0 }],
      partsDropped: 0,
    }))
    await openTheAnswer(m)
    expect(m.all('tool-answer-absence')).toHaveLength(0)
    expect(m.all('tool-answer-short-form')).toHaveLength(0)
    expect(m.all('tool-answer-paper')).toHaveLength(1)
  })
})

describe('a refused give’s card offers the whole reason when its receipt was cut', () => {
  /** A refusal of about 400 characters: its remedy starts after the row's 200-character bound. */
  const WHOLE =
    'refused (agent-did-not-start): that agent’s conversation could not be started, so nothing was given. Giving it again will not help until a person has looked: its Codex sign-in could not be used. A person can sign that agent’s profile in to Codex again on its card in Providers, or save an API key for Codex there, and then this work can be given again.'
  const CUT = `${WHOLE.slice(0, 199)}…`
  const REMEDY = 'A person can sign that agent’s profile in to Codex again on its card in Providers'

  const refusedGive = (
    summary: string,
    told?: { text: string; dropped: number },
  ): TranscriptEvent[] => [
    ev({
      type: 'tool_inventory',
      naming: { prefix: 'mcp__', separator: '__' },
      declared: {
        server: 'brobot',
        tools: [{ name: 'give_work', description: '', parameters: [] }],
      },
      published: null,
    }),
    ev({
      type: 'tool_call',
      id: 'toolu_give',
      name: 'mcp__brobot__give_work',
      summary: JSON.stringify({
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'farah',
        title: 'Read the listings',
        brief: 'Read them.',
      }),
    }),
    ev({
      type: 'tool_refused',
      tool: 'give_work',
      rail: 'agent-did-not-start',
      permanence: 'until-a-person-changes-it',
      retryable: false,
      ...(told === undefined ? {} : { told }),
    }),
    ev({ type: 'tool_result', id: 'toolu_give', ok: true, summary }),
  ]

  async function theCard(
    summary: string,
    holdsAnswers: boolean,
    read: () => Promise<ToolAnswer | null> = async () => null,
    told?: { text: string; dropped: number },
  ): Promise<Mounted> {
    await page.viewport(REAL.width, REAL.height)
    const r = record(refusedGive(summary, told))
    r.meta = { ...META, liveness: { ...META.liveness, canReadToolAnswer: holdsAnswers } }
    const m = mount(ConversationPane, paneProps({ record: r, onReadToolAnswer: read }), REAL)
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 30))
    m.q('exchange-toggle').click()
    await nextTick()
    return m
  }

  it('🔴 opened, the cut reason is drawn whole as far as it goes, and one press shows all of it', async () => {
    expect(WHOLE.length).toBeGreaterThan(330)
    expect(CUT).not.toContain(REMEDY)
    let asked = 0
    const m = await theCard(CUT, true, async () => {
      asked += 1
      return { parts: [{ text: WHOLE, dropped: 0 }], partsDropped: 0 }
    })
    const receipt = m.q('outgoing-receipt')
    expect(words(receipt)).toBe(CUT)
    await drawnReady()
    // Every character the row kept is on the card: wrapped, nothing clipped.
    assertDrawn(receipt, 'the refusal reason on the opened card')

    const door = m.q('outgoing-whole-answer')
    expect(words(door)).toBe('Show the whole answer')
    expect(asked).toBe(0)
    door.click()
    await new Promise((resolve) => setTimeout(resolve, 30))
    await nextTick()
    expect(asked).toBe(1)
    const paper = m.q('tool-answer-paper')
    expect(words(paper)).toContain(REMEDY)
    expect(words(paper)).toContain('and then this work can be given again.')
  })

  it('🔴 a conversation that no longer holds the answer says the card shows the short form', async () => {
    const m = await theCard(CUT, false)
    expect(m.all('outgoing-whole-answer')).toHaveLength(0)
    expect(words(m.q('outgoing-receipt-cut'))).toBe(
      'This is the short form of what the tool answered.',
    )
  })

  it('⛔ the control: a reason that fits its row is whole already, and offers nothing more', async () => {
    const short = 'refused (agent-did-not-start): that agent’s conversation could not be started.'
    const m = await theCard(short, true)
    expect(words(m.q('outgoing-receipt'))).toBe(short)
    expect(m.all('outgoing-receipt-cut')).toHaveLength(0)
    expect(m.all('outgoing-whole-answer')).toHaveLength(0)
  })
})

describe('a refusal whose whole sentence the host kept is read whole on the card', () => {
  const LEAD = 'refused (agent-did-not-start): '
  const SENTENCE =
    'that agent’s conversation could not be started, so nothing was given. Giving it again will not help until a person has looked: its Codex sign-in could not be used. A person can sign that agent’s profile in to Codex again on its card in Providers, or save an API key for Codex there, and then this work can be given again.'
  const CUT = `${(LEAD + SENTENCE).slice(0, 199)}…`
  const REMEDY = 'A person can sign that agent’s profile in to Codex again on its card in Providers'

  const opened = async (
    told: { text: string; dropped: number },
    holds = true,
  ): Promise<Mounted> => {
    await page.viewport(REAL.width, REAL.height)
    const r = record([
      ev({
        type: 'tool_inventory',
        naming: { prefix: 'mcp__', separator: '__' },
        declared: {
          server: 'brobot',
          tools: [{ name: 'give_work', description: '', parameters: [] }],
        },
        published: null,
      }),
      ev({
        type: 'tool_call',
        id: 'toolu_give',
        name: 'mcp__brobot__give_work',
        summary: JSON.stringify({
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'farah',
          title: 'Read the listings',
          brief: 'Read them.',
        }),
      }),
      ev({
        type: 'tool_refused',
        tool: 'give_work',
        rail: 'agent-did-not-start',
        permanence: 'until-a-person-changes-it',
        retryable: false,
        told,
      }),
      ev({ type: 'tool_result', id: 'toolu_give', ok: true, summary: CUT }),
    ])
    r.meta = { ...META, liveness: { ...META.liveness, canReadToolAnswer: holds } }
    const m = mount(
      ConversationPane,
      paneProps({ record: r, onReadToolAnswer: async () => null }),
      REAL,
    )
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 30))
    m.q('exchange-toggle').click()
    await nextTick()
    return m
  }

  it('🔴 the opened card says the whole reason, remedy and all, with nothing more to press', async () => {
    const m = await opened({ text: SENTENCE, dropped: 0 })
    const receipt = m.q('outgoing-receipt')
    expect(words(receipt)).toBe(LEAD + SENTENCE)
    expect(words(receipt)).toContain(REMEDY)
    expect(words(receipt)).not.toContain('…')
    expect(m.all('outgoing-receipt-cut')).toHaveLength(0)
    expect(m.all('outgoing-whole-answer')).toHaveLength(0)
    await drawnReady()
    assertDrawn(receipt, 'the whole refusal reason on the opened card')
  })

  it('🔴 one the host had to cut says so, and still offers the whole answer', async () => {
    const m = await opened({ text: SENTENCE.slice(0, 120), dropped: SENTENCE.length - 120 })
    expect(words(m.q('outgoing-receipt'))).toBe(LEAD + SENTENCE.slice(0, 120))
    expect(words(m.q('outgoing-whole-answer'))).toBe('Show the whole answer')
  })

  it('⚑ the control: the same refusal kept by no host still reads the row’s cut receipt and its press', async () => {
    const m = await theCardOf(CUT)
    expect(words(m.q('outgoing-receipt'))).toBe(CUT)
    expect(words(m.q('outgoing-whole-answer'))).toBe('Show the whole answer')
  })

  /** The older card, through the previous describe's own fixture. */
  async function theCardOf(summary: string): Promise<Mounted> {
    await page.viewport(REAL.width, REAL.height)
    const r = record([
      ev({
        type: 'tool_inventory',
        naming: { prefix: 'mcp__', separator: '__' },
        declared: {
          server: 'brobot',
          tools: [{ name: 'give_work', description: '', parameters: [] }],
        },
        published: null,
      }),
      ev({
        type: 'tool_call',
        id: 'toolu_give',
        name: 'mcp__brobot__give_work',
        summary: JSON.stringify({
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'farah',
          title: 'Read the listings',
          brief: 'Read them.',
        }),
      }),
      ev({
        type: 'tool_refused',
        tool: 'give_work',
        rail: 'agent-did-not-start',
        permanence: 'until-a-person-changes-it',
        retryable: false,
      }),
      ev({ type: 'tool_result', id: 'toolu_give', ok: true, summary }),
    ])
    r.meta = { ...META, liveness: { ...META.liveness, canReadToolAnswer: true } }
    const m = mount(
      ConversationPane,
      paneProps({ record: r, onReadToolAnswer: async () => null }),
      REAL,
    )
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 30))
    m.q('exchange-toggle').click()
    await nextTick()
    return m
  }
})

describe('a refusal whose whole sentence the host kept is quoted whole on its notice', () => {
  it('🔴 the notice quotes the kept sentence, not the row’s cut receipt', async () => {
    const sentence = `${RECEIPT.slice('refused (too-deep): '.length, -2)} is 1, so ask a person to start it.`
    const r = record(
      EVENTS.map((event) =>
        event.type === 'tool_refused'
          ? ev({
              ...(event as unknown as Record<string, unknown>),
              told: { text: sentence, dropped: 0 },
            })
          : event,
      ),
    )
    await page.viewport(REAL.width, REAL.height)
    const m = mount(ConversationPane, paneProps({ record: r }), REAL)
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(words(m.q('refusal-told'))).toBe(`· it was told: “${sentence}”`)
  })
})
