import { agentCardRecipient } from './harness'
import { expandAgentCards } from './harness'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { BODY_WAS_CUT, AN_UNNAMED_RECIPIENT } from '../../src/renderer/src/lib/outgoing-card'
import { applyEvent } from '../../src/renderer/src/lib/transcript'
import {
  jsonInWords,
  SHORTEST_JSON_DRAWN,
  type WordsPart,
} from '../../src/renderer/src/lib/words-with-json'
import type { AgentIdentity, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, paneProps, record, unmountAll, visible, type Mounted } from './harness'

/**
 * # ⚑ A card draws what it read, and nothing it guessed
 *
 * ⚑ The give card (`3e73c885`, `7b233ff4`) and the Readable | Raw toggle (`9811c3f4`) each shipped
 * with a test of the ordinary case. This file pins what those left to chance — the edges where a
 * card either says a true thing or a plausible false one:
 *
 * - ⚑ **Where the toggle sits** — the meta row's far end with the clock one gap after it, on the
 *   sender's card and on the recipient's, measured in pixels rather than named.
 * - ⚑ **What Readable trims** — only the whitespace that touches a block, and no empty paragraph
 *   left behind; Raw keeps every character.
 * - ⚑ **Which view is on** — `aria-pressed` and the painted pill, both buttons in both states.
 * - ⚑ **A give's brief that carries JSON** — two views, the title above them, and the cut sentence
 *   in BOTH.
 * - ⛔ **What is never guessed** — a stretch is drawn as JSON only where it parses and only inside
 *   the scan's bounds; a give whose arguments were cut inside its title or its profile draws no
 *   half-title and no recipient made of the head of a name; a held give says it is held.
 *
 * ⚠️ Every negative below is measured beside a positive from the same reader — the same pane, the
 * same function or the sibling arm — so a page that draws nothing at all cannot pass.
 */

afterEach(() => unmountAll())

const PAYLOAD = {
  outcome: 'ok',
  agent: { name: 'BroBot', state: 'idle', pieces: [{ label: 'W1', title: 'Test it' }] },
}
const PROSE = 'BroBot (brobot) · idle · holds W1 · Test it'
const NOTE = `${PROSE}${JSON.stringify(PAYLOAD)}`

const inventory = (tools: readonly string[]): TranscriptEvent =>
  ({
    type: 'tool_inventory',
    naming: { prefix: 'mcp__', separator: '__' },
    declared: {
      server: 'brobot',
      tools: tools.map((name) => ({ name, description: '', parameters: [] })),
    },
    published: null,
  }) as unknown as TranscriptEvent

/** ⚑ Ada's own page: the call, the host's row carrying the words, and its receipt. */
const sent = (text: string): TranscriptEvent[] => [
  inventory(['message_agent']),
  {
    type: 'tool_call',
    id: 'c1',
    name: 'mcp__brobot__message_agent',
    summary: JSON.stringify({ agent: 'sess_brobot', kind: 'note' }),
  } as TranscriptEvent,
  {
    type: 'message_sent',
    to: 'sess_brobot',
    toProfile: 'brobot',
    kind: 'note',
    delivery: 'sent',
    onBehalfOfAPerson: false,
    text,
  } as TranscriptEvent,
  { type: 'tool_result', id: 'c1', summary: 'sent', ok: true } as TranscriptEvent,
]

/** ⚑ BroBot's page: the same words, arrived as a turn relayed from Ada. */
const arrived = (text: string): TranscriptEvent[] => [
  {
    type: 'user_turn',
    text,
    relayedFrom: 'sess_ada',
    relayedFromProfile: 'ada',
  } as TranscriptEvent,
]

const SENT_RECEIPT = 'W1.2 given to Ayo (dev); it went to Ayo straight away.'
/**
 * ⚑ `give_work`'s held receipt as it words it — ⚑ **D-027 moved its tail**: a held give no longer
 * *"goes out as its own turn"*, it goes out with whatever else is held for Ayo, in one turn, oldest
 * first. ⚠️ The card reads only the head (*"is held until Ayo is free"*), so the old tail passed too
 * — this keeps the fixture the sentence the tool writes (`a-piece-given-is-a-card.test.ts` §1 pins
 * the template).
 */
const HELD_RECEIPT =
  'W1.2.3 given to Ayo (dev); it is held until Ayo is free, then goes out with whatever else is held for it, oldest first (a person’s command goes on its own).'

/** ⚑ A give: the call whose arguments are `summary` (as the adapters keep them), and its receipt. */
const gave = (summary: string, receipt: string = SENT_RECEIPT): TranscriptEvent[] => [
  inventory(['give_work']),
  { type: 'user_turn', text: 'have Ayo fix the rail' },
  {
    type: 'tool_call',
    id: 'c1',
    name: 'mcp__brobot__give_work',
    summary,
  } as TranscriptEvent,
  { type: 'tool_result', id: 'c1', summary: receipt, ok: true } as TranscriptEvent,
]

const ARGS = {
  profile: 'dev',
  title: 'Make the rail say what the card says',
  brief: 'The rail and the card disagree about an agent. Find why and make them agree.',
  definition_of_done: 'The requested result and its checks are recorded.',
}

const IDS = [
  { id: 'aid:ada', slug: 'ada', displayName: 'Ada' },
  { id: 'aid:brobot', slug: 'brobot', displayName: 'BroBot' },
  { id: 'aid:dev', slug: 'dev', displayName: 'Ayo' },
] as unknown as AgentIdentity[]

/**
 * ⚑ **Every event carries a moment**, so each card's clock has a time to say: with none, the clock is
 * an empty span with no width, and a measurement of where it sits would be of nothing.
 */
const AT = new Date(2026, 8, 30, 9, 41).getTime()
function recorded(events: TranscriptEvent[]) {
  const r = record([])
  events.forEach((event, i) => applyEvent(r.transcript, event, AT + i * 1_000))
  return r
}

const pane = (events: TranscriptEvent[]) =>
  expandAgentCards(
    mount(ConversationPane, paneProps({ record: recorded(events), identities: IDS, held: [] }), {
      width: 1200,
      height: 808,
    }),
  )

async function press(m: Mounted, cy: string): Promise<void> {
  ;(m.q(cy) as HTMLButtonElement).click()
  await nextTick()
}

const box = (el: Element): DOMRect => el.getBoundingClientRect()

/** ⚑ Two payloads, each over the 30 characters a block is worth drawing at. */
const J1 = JSON.stringify({ outcome: 'ok', agent: 'BroBot', state: 'idle' })
const J2 = JSON.stringify({ outcome: 'failed', agent: 'Ada', state: 'busy' })

/* ------------------------------------------------------------------ the toggle's place */

describe('where the toggle sits in the meta row', () => {
  /** ⚑ One end of the message: the clock at the far edge, the toggle one gap before it. */
  function measuredRow(
    m: Mounted,
    end: 'outgoing' | 'relayed',
  ): { meta: HTMLElement; time: HTMLElement; gap: number } {
    const card = m.q(end)
    const meta = card.querySelector<HTMLElement>('.msg-meta')
    const time = card.querySelector<HTMLElement>('.time')
    expect(meta, `the ${end} card has a meta row`).not.toBeNull()
    expect(time, `the ${end} card has a clock`).not.toBeNull()
    expect(visible(time!)).toBe(true)
    const gap = parseFloat(getComputedStyle(meta!).columnGap)
    expect(gap).toBeGreaterThan(0)
    return { meta: meta!, time: time!, gap }
  }

  async function toggleRidesTheEdge(m: Mounted, end: 'outgoing' | 'relayed'): Promise<void> {
    const { meta, time, gap } = measuredRow(m, end)
    const views = m.q('words-views')
    const heading = m.q(`${end}-heading`)
    expect(visible(views)).toBe(true)
    // ⚑ The clock keeps the far edge of the row…
    expect(Math.abs(box(time).right - box(meta).right)).toBeLessThanOrEqual(1)
    // …the toggle sits exactly ONE gap before it, not floating mid-row…
    expect(Math.abs(box(time).left - box(views).right - gap)).toBeLessThanOrEqual(1)
    // …and is pushed to the far end, not stuck to the heading.
    expect(box(views).left - box(heading).right).toBeGreaterThanOrEqual(3 * gap)
    // ⚑ One line: the toggle sits inside the row's box, top and bottom.
    expect(box(views).top).toBeGreaterThanOrEqual(box(meta).top - 1)
    expect(box(views).bottom).toBeLessThanOrEqual(box(meta).bottom + 1)
  }

  it('🔴 the toggle rides the meta row’s right edge with the clock one gap after it — on the sender’s card and on the recipient’s', async () => {
    await toggleRidesTheEdge(await pane(sent(NOTE)), 'outgoing')
    unmountAll()
    await toggleRidesTheEdge(await pane(arrived(NOTE)), 'relayed')
    unmountAll()

    // ⚑ THE PAIRED POSITIVE — the same two ends with words that carry no JSON: no toggle, and the
    // clock is at the row's edge all the same, so the numbers above are not an accident of the row.
    for (const [end, events] of [
      ['outgoing', sent('Done — sent it as a note, word for word.')],
      ['relayed', arrived('Done — sent it as a note, word for word.')],
    ] as const) {
      const m = await pane(events)
      const { meta, time } = measuredRow(m, end)
      expect(m.all('words-views')).toHaveLength(0)
      expect(Math.abs(box(time).right - box(meta).right)).toBeLessThanOrEqual(1)
      unmountAll()
    }
  })
})

/* ------------------------------------------------------------------ what Readable trims */

describe('what the Readable view trims', () => {
  it('🔴 Readable trims only the whitespace that touches a block and draws no empty paragraph — Raw keeps every character', async () => {
    const text = `A note.\n\n${JSON.stringify(PAYLOAD)}\n\nAfter it.`
    const m = await pane(sent(text))
    // ⚑ The words beside the block lose the line breaks that touch it — and only those.
    const readable = m.q('outgoing-readable')
    const paragraphs = [...readable.querySelectorAll('.md-chat p')].map((p) => p.textContent)
    expect(paragraphs).toEqual(['A note.', 'After it.'])
    expect(m.all('words-json')).toHaveLength(1)
    // ⚑ Raw is every character as sent, the inner blank lines included, and no block.
    await press(m, 'words-view-raw')
    expect(m.q('outgoing-message').textContent?.trim()).toBe(text)
    expect(m.all('words-json')).toHaveLength(0)
    unmountAll()

    // ⚑ Whitespace alone between two blocks is no paragraph — on both ends of the message. The two
    // blocks prove the card is not simply empty.
    const between = `${J1} \n ${J2}`
    for (const [end, events] of [
      ['outgoing', sent(between)],
      ['relayed', arrived(between)],
    ] as const) {
      const both = await pane(events)
      expect(both.all('words-json')).toHaveLength(2)
      expect(both.q(`${end}-readable`).querySelectorAll('.md-chat p')).toHaveLength(0)
      unmountAll()
    }
  })
})

/* ------------------------------------------------------------------ which view is on */

describe('the toggle says which view is on', () => {
  it('🔴 the toggle says which view is on — aria-pressed and a painted pill — and the mark moves when pressed', async () => {
    const m = await pane(sent(NOTE))
    const read = (): {
      pressed: [string | null, string | null]
      fill: [string, string]
      ink: [string, string]
    } => {
      const readable = m.q('words-view-readable')
      const raw = m.q('words-view-raw')
      return {
        pressed: [readable.getAttribute('aria-pressed'), raw.getAttribute('aria-pressed')],
        fill: [getComputedStyle(readable).backgroundColor, getComputedStyle(raw).backgroundColor],
        ink: [getComputedStyle(readable).color, getComputedStyle(raw).color],
      }
    }

    // ⚑ Readable is on at first paint: pressed, painted, and unlike the other button in both.
    const first = read()
    expect(first.pressed).toEqual(['true', 'false'])
    expect(first.fill[0]).not.toBe(first.fill[1])
    expect(first.ink[0]).not.toBe(first.ink[1])

    // ⚑ Pressing Raw swaps every reading: the pill and the ink move to it.
    await press(m, 'words-view-raw')
    const raw = read()
    expect(raw.pressed).toEqual(['false', 'true'])
    expect(raw.fill[0]).toBe(first.fill[1])
    expect(raw.fill[1]).toBe(first.fill[0])
    expect(raw.ink[0]).toBe(first.ink[1])
    expect(raw.ink[1]).toBe(first.ink[0])

    // ⚑ …and back, to exactly the first reading.
    await press(m, 'words-view-readable')
    expect(read()).toEqual(first)
  })
})

/* ------------------------------------------------------------------ a give's brief with JSON */

describe('a give’s brief that carries JSON', () => {
  const INNER = { outcome: 'ok', state: 'idle', holds: 'W1' }
  const cut = (args: object): string => JSON.stringify(args).slice(0, 200) + '…'

  it('🔴 a give’s brief that carries JSON reads two ways too, keeps its title above, and says it was cut in BOTH views', async () => {
    const brief = `${JSON.stringify(INNER)} and then a long tail of prose. ${'x'.repeat(400)}`
    const m = await pane(
      gave(
        cut({
          profile: 'dev',
          title: 'Read the status',
          brief,
          definition_of_done: 'The requested result and its checks are recorded.',
        }),
      ),
    )

    // ⚑ Readable: the toggle in the meta row, the payload as a block, the title above the words.
    const views = m.q('words-views')
    expect(visible(views)).toBe(true)
    expect(m.q('outgoing').querySelector('.msg-meta')?.contains(views)).toBe(true)
    const readable = m.q('outgoing-readable')
    expect(visible(readable)).toBe(true)
    expect(m.q('words-json').textContent).toBe(JSON.stringify(INNER, null, 2))
    expect(box(m.q('outgoing-title')).bottom).toBeLessThanOrEqual(box(readable).top + 1)
    expect(m.q('outgoing-title').textContent?.trim()).toBe('Read the status')
    expect(m.all('outgoing-message')).toHaveLength(0)
    // ⛔ The brief is the head of a longer text, and Readable says so.
    expect(visible(m.q('outgoing-cut'))).toBe(true)
    expect(m.q('outgoing-cut').textContent?.trim()).toBe(BODY_WAS_CUT)

    // ⚑ Raw: the words as the call carried them, no block — and STILL the cut sentence.
    await press(m, 'words-view-raw')
    const rawWords = m.q('outgoing-message').textContent?.trim() ?? ''
    expect(rawWords.startsWith(JSON.stringify(INNER))).toBe(true)
    expect(rawWords.endsWith('x')).toBe(true)
    expect(m.all('words-json')).toHaveLength(0)
    expect(visible(m.q('outgoing-cut'))).toBe(true)
    expect(m.q('outgoing-cut').textContent?.trim()).toBe(BODY_WAS_CUT)
    unmountAll()

    // ⛔ THE CONTROL — a JSON value the 200-character bound cut through is no JSON: no toggle, the
    // brief drawn as written, and the cut sentence all the same.
    const items = JSON.stringify({ items: Array.from({ length: 40 }, (_, id) => ({ id })) })
    const half = await pane(
      gave(
        cut({
          profile: 'dev',
          title: 'Read the status',
          brief: items,
          definition_of_done: 'The requested result and its checks are recorded.',
        }),
      ),
    )
    expect(half.all('words-views')).toHaveLength(0)
    expect(visible(half.q('outgoing-message'))).toBe(true)
    expect(visible(half.q('outgoing-cut'))).toBe(true)
    expect(half.q('outgoing-cut').textContent?.trim()).toBe(BODY_WAS_CUT)
  })
})

/* ------------------------------------------------------------------ jsonInWords' bounds */

describe('where words are read for JSON', () => {
  const kinds = (parts: readonly WordsPart[] | null): string[] => (parts ?? []).map((p) => p.kind)
  const found = (parts: readonly WordsPart[] | null): string[] =>
    (parts ?? []).flatMap((p) => (p.kind === 'json' ? [p.text] : []))

  /** An object of exactly `length` characters. */
  const objectOf = (length: number): string => {
    const value = 'x'.repeat(length - '{"a":""}'.length)
    return JSON.stringify({ a: value })
  }

  it('⛔ jsonInWords draws a stretch only where it parses and only inside its bounds', () => {
    // ⚑ THE POSITIVE the rest are measured against: a payload in prose is found, whole.
    const J = JSON.stringify({ note: 'a value long enough', outcome: 'ok' })
    expect(J.length).toBeGreaterThanOrEqual(SHORTEST_JSON_DRAWN)
    expect(kinds(jsonInWords(`see ${J}`))).toEqual(['words', 'json'])
    expect(found(jsonInWords(`see ${J}`))).toEqual([J])

    // (a) ⚑ The shortest stretch worth a block: 30 characters is found, 29 stays words.
    expect(SHORTEST_JSON_DRAWN).toBe(30)
    expect(objectOf(30)).toHaveLength(30)
    expect(found(jsonInWords(objectOf(30)))).toEqual([objectOf(30)])
    expect(objectOf(29)).toHaveLength(29)
    expect(jsonInWords(objectOf(29))).toBeNull()

    // (b) ⚑ The longest text read: 100,000 characters is scanned, one more is words.
    expect(kinds(jsonInWords(J + ' '.repeat(100_000 - J.length)))).toEqual(['json', 'words'])
    expect(jsonInWords(J + ' '.repeat(100_001 - J.length))).toBeNull()

    // (c) ⚑ The most brackets tried: a payload at the 200th start is found, at the 201st it stays words.
    expect(found(jsonInWords('[1] '.repeat(199) + J))).toEqual([J])
    expect(jsonInWords('[1] '.repeat(200) + J)).toBeNull()

    // (d) ⚑ A bracket run that does not parse hides nothing inside it.
    const wrapped = jsonInWords(`[note ${J}]`)
    expect(kinds(wrapped)).toEqual(['words', 'json', 'words'])
    expect(found(wrapped)).toEqual([J])

    // (e) ⚑ A brace inside a string, after an escaped quote, does not end the value.
    const braced = JSON.stringify({ note: 'she said "}" and left', other: 'a value long enough' })
    expect(braced).toContain('\\"}\\"')
    const inProse = jsonInWords(`see ${braced}`)
    expect(kinds(inProse)).toEqual(['words', 'json'])
    expect(found(inProse)).toEqual([braced])
  })
})

/* ------------------------------------------------------------------ a give cut inside its head */

describe('a give whose arguments were cut', () => {
  it('⛔ a give whose summary was cut inside its title or its profile draws no half-title and no guessed recipient', async () => {
    const whole = JSON.stringify(ARGS)

    // ⚑ THE POSITIVE — the whole summary names Ayo and the whole title.
    const all = await pane(gave(whole))
    expect(agentCardRecipient(all)).toBe('Ayo')
    expect(all.q('outgoing-title').textContent?.trim()).toBe(ARGS.title)
    expect(all.q('outgoing').textContent).toContain('Make the rail')
    unmountAll()

    // ⛔ Cut inside the title: Ayo is still named, and the head of the title is not drawn as the title.
    const inTitle = whole.slice(0, 40) + '…'
    expect(inTitle).toContain('"title":"Make the rail ')
    expect(inTitle).not.toContain('"brief"')
    const titleCut = await pane(gave(inTitle))
    expect(visible(titleCut.q('outgoing'))).toBe(true)
    expect(agentCardRecipient(titleCut)).toBe('Ayo')
    expect(titleCut.all('outgoing-title')).toHaveLength(0)
    expect(titleCut.q('outgoing').textContent).not.toContain('Make the rail')
    expect(titleCut.all('outgoing-message')).toHaveLength(0)
    unmountAll()

    // ⛔ Cut inside the profile: no recipient is made of the head of 'dev'.
    const inProfile = whole.slice(0, 14) + '…'
    expect(inProfile).toBe('{"profile":"de…')
    const profileCut = await pane(gave(inProfile))
    expect(visible(profileCut.q('outgoing'))).toBe(true)
    const recipient = agentCardRecipient(profileCut)
    expect(recipient).toBe(AN_UNNAMED_RECIPIENT)
    expect(recipient).not.toContain('de')
    expect(profileCut.q('outgoing-heading').textContent).not.toMatch(/\bde\b/)
  })
})

/* ------------------------------------------------------------------ held and sent */

describe('how a give went', () => {
  it('🔴 a give held for a busy agent says “held · goes when its turn ends” and a sent one says “sent”', async () => {
    const summary = JSON.stringify(ARGS)

    const held = await pane(gave(summary, HELD_RECEIPT))
    expect(held.q('outgoing').getAttribute('data-state')).toBe('held')
    expect(held.q('outgoing-state').textContent?.trim()).toBe('held · goes when its turn ends')
    expect(held.q('outgoing-task').textContent?.trim()).toBe('W1.2.3')
    unmountAll()

    // ⚑ THE POSITIVE for the held pane: the same call on the same page, and the word differs only
    // because the receipt does.
    const went = await pane(gave(summary, SENT_RECEIPT))
    expect(went.q('outgoing').getAttribute('data-state')).toBe('sent')
    expect(went.q('outgoing-state').textContent?.trim()).toBe('sent')
    expect(went.q('outgoing-task').textContent?.trim()).toBe('W1.2')
  })
})

/* ------------------------------------------------------------------ a long unbroken value */

describe('a payload with one long unbroken value', () => {
  it('⛔ a payload with one long unbroken value wraps inside the card and is drawn whole', async () => {
    const drawnWhole = async (payload: object): Promise<void> => {
      const m = await pane(sent(`Look: ${JSON.stringify(payload)}`))
      const block = m.q('words-json')
      expect(visible(block)).toBe(true)
      expect(box(block).right).toBeLessThanOrEqual(box(m.q('outgoing')).right + 1)
      expect(block.scrollWidth).toBeLessThanOrEqual(block.clientWidth + 1)
      // ⚑ Nothing was cut to make it fit.
      expect(block.textContent).toBe(JSON.stringify(payload, null, 2))
      unmountAll()
    }
    // ⚑ THE POSITIVE — an ordinary block passes the same three readings, so they are not a property
    // of a block that was never laid out.
    await drawnWhole({ token: 'short', outcome: 'ok', state: 'idle', holds: 'W1' })
    await drawnWhole({ token: 'x'.repeat(400), outcome: 'ok' })
  })
})
