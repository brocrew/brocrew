import { afterEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { nextTick, reactive } from 'vue'
import QuestionCard from '../../src/renderer/src/components/QuestionCard.vue'
import OutsideCard from '../../src/renderer/src/components/OutsideCard.vue'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import type { PathsHere } from '../../src/renderer/src/composables/useMessagePaths'
import type { QuestionCardReading } from '../../src/renderer/src/lib/question-card'
import { applyEvent } from '../../src/renderer/src/lib/transcript'
import { defineComponent, h } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, paneProps, record, unmountAll, visible, type Mounted } from './harness'
import {
  agentExchangeFixture,
  agentCardEdgesFixture,
  EXCHANGE_AT,
  EXCHANGE_IDS,
  EXCHANGE_INVENTORY,
  EXCHANGE_OTHER,
  EXCHANGE_WORDS,
} from './agent-exchanges.fixture'

afterEach(() => {
  vi.restoreAllMocks()
  unmountAll()
  useWhoCalledWhom().reading.value = null
})
function pane(events: TranscriptEvent[], onOpenConversation: (id: string) => void = () => {}) {
  return mount(
    ConversationPane,
    paneProps({
      record: record(events),
      ownAgent: 'BroBot',
      identities: EXCHANGE_IDS,
      held: [],
      onOpenConversation,
    }),
    { width: 1200, height: 1000 },
  )
}
async function expand(m: Mounted, index = 0) {
  m.all('exchange-toggle')[index]!.click()
  await nextTick()
}
const reactiveRecord = (events: TranscriptEvent[]) => reactive(record(events))
const normalized = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim()

describe('agent exchanges fold inline', () => {
  for (const [kind, extra] of [
    ['work', { piece: 'work_bakery', label: 'W1.2' }],
    ['note', { says: 'note' }],
    ['follow-up', { says: 'follow-up' }],
    ['routed question', {}],
    ['routed answer', {}],
    [
      'reply',
      {
        work: {
          piece: 'work_bakery',
          label: 'W1.2',
          state: 'answered',
          outcome: 'done',
          owner: EXCHANGE_OTHER,
        },
      },
    ],
  ] as const) {
    it(`${kind}: closed summary, complete markdown on expansion, model detail stays inside`, async () => {
      const m = pane([
        {
          type: 'user_turn',
          text: EXCHANGE_WORDS,
          relayedFrom: EXCHANGE_OTHER,
          relayedFromProfile: 'ayo',
          at: EXCHANGE_AT,
          sent: EXCHANGE_WORDS,
          ...extra,
        } as unknown as TranscriptEvent,
      ])
      const toggle = m.q('exchange-toggle')
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(toggle.getAttribute('aria-label')).toContain(
        `Ayo → BroBot · ${kind.startsWith('routed') ? 'message' : kind}`,
      )
      expect(visible(m.q('exchange-body'))).toBe(false)
      const preview = m.q('exchange-preview')
      expect(preview.textContent).toContain('Bakery plan')
      expect(preview.textContent).toContain('Read the menu and guide.')
      expect(preview.textContent).not.toMatch(/\*\*|```|\[guide\]|https:/)
      const line = preview.getBoundingClientRect()
      expect(line.height).toBeLessThan(25)
      for (const model of m.all('model-got-switch')) expect(visible(model)).toBe(false)
      await expand(m)
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(visible(m.q('exchange-body'))).toBe(true)
      if (kind !== 'reply') expect(m.q('exchange-body').textContent).not.toContain('BroBot')
      expect(m.all('work-report-recipient')).toHaveLength(0)
      expect(
        m
          .q('outside-card')
          .querySelector('.exchange-heading')
          ?.textContent?.match(/BroBot/g),
      ).toHaveLength(1)
      const md = m.q('exchange-body').querySelector('.md-chat')!
      expect(md.querySelector('strong')?.textContent).toBe('Read')
      expect(md.querySelectorAll('li')).toHaveLength(2)
      expect(md.querySelector('pre code')?.textContent).toContain('const ready = true')
      expect(md.querySelector('a')?.getAttribute('href')).toBe('https://example.com/guide')
      expect(md.textContent).toContain('The whole brief ends here.')
      for (const model of m.all('model-got-switch')) expect(visible(model)).toBe(true)
      await expand(m)
      expect(visible(m.q('exchange-body'))).toBe(false)
    })
  }
  it('give: full brief survives clipped arguments; both compact links reach the other conversation through the pane', async () => {
    const opened: string[] = []
    const m = pane(agentExchangeFixture(), (id) => opened.push(id))
    expect(m.all('exchange-toggle')).toHaveLength(2)
    expect(m.all('exchange-where')).toHaveLength(2)
    for (const link of m.all('exchange-where')) {
      expect(visible(link)).toBe(true)
      link.click()
    }
    expect(opened).toEqual([EXCHANGE_OTHER, EXCHANGE_OTHER])
    expect(
      m.all('exchange-toggle').every((el) => el.getAttribute('aria-expanded') === 'false'),
    ).toBe(true)
    await expand(m)
    expect(m.q('outgoing-message').textContent).toContain('The whole brief ends here.')
    expect(m.all('outgoing-cut')).toHaveLength(0)
  })
  for (const kind of ['note', 'follow-up'] as const) {
    it(`outgoing ${kind} uses the same fold and rendered full text`, async () => {
      const m = pane([
        EXCHANGE_INVENTORY,
        {
          type: 'tool_call',
          id: 'send',
          name: 'mcp__brobot__message_agent',
          summary: JSON.stringify({ agent: EXCHANGE_OTHER, kind }),
        },
        {
          type: 'message_sent',
          to: EXCHANGE_OTHER,
          toProfile: 'ayo',
          kind,
          delivery: 'sent',
          onBehalfOfAPerson: false,
          text: EXCHANGE_WORDS,
        },
        { type: 'tool_result', id: 'send', summary: 'sent', ok: true },
      ] as TranscriptEvent[])
      expect(m.q('exchange-toggle').getAttribute('aria-label')).toContain(`BroBot → Ayo · ${kind}`)
      expect(visible(m.q('exchange-body'))).toBe(false)
      await expand(m)
      expect(m.q('outgoing-message').querySelector('strong')?.textContent).toBe('Read')
      expect(m.q('exchange-body').textContent).not.toContain('Ayo')
      expect(m.q('outside-card').textContent?.match(/Ayo/g)).toHaveLength(1)
    })
  }
  for (const tool of ['ask_question', 'pass_question_up'] as const) {
    it(`outgoing ${tool}: collapsed question and complete rendered words/options inside`, async () => {
      const m = pane([
        EXCHANGE_INVENTORY,
        {
          type: 'tool_call',
          id: 'ask',
          name: `mcp__brobot__${tool}`,
          summary: JSON.stringify({
            who_answers: 'the-parent',
            question: tool === 'pass_question_up' ? 'req_original' : EXCHANGE_WORDS,
          }),
        },
        {
          type: 'question_asked',
          requestId: 'req_bakery',
          ...(tool === 'pass_question_up' ? { passedUpFrom: 'req_original' } : {}),
          prompt: EXCHANGE_WORDS,
          context: '**Carry** the original words unchanged.',
          questions: [
            {
              id: 'choice',
              prompt: '**Choose** one.',
              options: [{ label: 'Keep' }, { label: 'Change' }],
            },
          ],
        },
        {
          type: 'request_routed',
          requestId: 'req_bakery',
          to: 'the-parent',
          parent: EXCHANGE_OTHER,
        },
        { type: 'tool_result', id: 'ask', summary: 'recorded', ok: true },
      ] as TranscriptEvent[])
      expect(m.q('exchange-toggle').getAttribute('aria-label')).toContain('question')
      expect(m.all('question-words')).toHaveLength(0)
      await expand(m)
      expect(m.q('question-words').querySelector('strong')?.textContent).toBe('Read')
      expect(m.all('question-asked-of')).toHaveLength(0)
      expect(m.q('question-context').querySelector('strong')?.textContent).toBe('Carry')
      expect(m.q('question-card').querySelector('.ask strong')?.textContent).toBe('Choose')
      expect(m.all('question-option').map((el) => el.textContent?.trim())).toEqual([
        'Keep',
        'Change',
      ])
      expect(m.all('question-option').every((el) => el.tagName !== 'BUTTON')).toBe(true)
    })
  }
  for (const reply of [false, true]) {
    it(`held ${reply ? 'reply' : 'note'}: the opened card names its recipient once`, async () => {
      const m = pane([
        {
          type: 'message_queued',
          messageId: 'held_once',
          text: EXCHANGE_WORDS,
          relayedFrom: EXCHANGE_OTHER,
          relayedFromProfile: 'ayo',
          says: 'note',
          ...(reply
            ? {
                work: {
                  piece: 'work_bakery',
                  label: 'W1.2',
                  state: 'answered',
                  outcome: 'done',
                  owner: EXCHANGE_OTHER,
                },
              }
            : {}),
        },
      ] as TranscriptEvent[])
      expect(m.q('exchange-toggle').getAttribute('aria-expanded')).toBe('false')
      expect(m.q('outside-card').textContent?.match(/BroBot/g)).toHaveLength(1)
      await expand(m)
      expect(
        m
          .q('outside-card')
          .querySelector('.exchange-heading')
          ?.textContent?.match(/BroBot/g),
      ).toHaveLength(1)
      expect(m.all('queued-recipient')).toHaveLength(0)
      if (!reply) expect(m.q('exchange-body').textContent).not.toContain('BroBot')
      expect(m.q('queued-message').textContent).toContain('The whole brief ends here.')
      expect(m.q('exchange-state').textContent).toContain('held')
    })
  }
  it('following a brief expands its fold before bringing the whole words into view', async () => {
    const r = reactiveRecord([
      {
        type: 'user_turn',
        text: EXCHANGE_WORDS,
        relayedFrom: EXCHANGE_OTHER,
        relayedFromProfile: 'ayo',
        piece: 'work_bakery',
        label: 'W1.2',
      },
    ] as TranscriptEvent[])
    const m = mount(
      ConversationPane,
      paneProps({ record: r, ownAgent: 'BroBot', identities: EXCHANGE_IDS, held: [] }),
      { width: 1200, height: 1000 },
    )
    expect(m.q('exchange-toggle').getAttribute('aria-expanded')).toBe('false')
    const scrolled: boolean[] = []
    const nativeScroll = Element.prototype.scrollIntoView
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (
      this: Element,
      options,
    ) {
      scrolled.push(
        m.q('exchange-toggle').getAttribute('aria-expanded') === 'true' &&
          visible(m.q('relayed-message')),
      )
      nativeScroll.call(this, options)
    })
    expect((m.vm.focus as (id: string) => boolean)(r.transcript.items[0]!.id)).toBe(true)
    await nextTick()
    expect(m.q('exchange-toggle').getAttribute('aria-expanded')).toBe('true')
    expect(visible(m.q('relayed-message'))).toBe(true)
    expect(m.q('relayed-message').textContent).toContain('The whole brief ends here.')
    expect(scrolled).toEqual([true])
    ;(m.vm.focus as (id: string) => boolean)(r.transcript.items[0]!.id)
    await nextTick()
    expect(scrolled).toEqual([true, true])
    expect(m.q('exchange-toggle').getAttribute('aria-expanded')).toBe('true')
  })
  it('held incoming words are folded and dashed, including a rebuild from an ending', async () => {
    for (const type of ['message_queued', 'message_unqueued'] as const) {
      unmountAll()
      const m = pane([
        {
          type,
          text: EXCHANGE_WORDS,
          relayedFrom: EXCHANGE_OTHER,
          relayedFromProfile: 'ayo',
          says: 'note',
          messageId: 'held',
          reason: 'abandoned',
          at: EXCHANGE_AT,
        } as TranscriptEvent,
      ])
      expect(m.q('exchange-toggle').getAttribute('aria-expanded')).toBe('false')
      expect(getComputedStyle(m.q('outside-card')).borderTopStyle).toBe('dashed')
      await expand(m)
      expect(m.q('queued-message').querySelector('strong')?.textContent).toBe('Read')
    }
  })
  it('incoming and outgoing share one left edge and width, closed and expanded; the person stays in place', async () => {
    const m = pane(agentCardEdgesFixture())
    const person = m.q('user-message').closest('article')!.getBoundingClientRect()
    for (const expanded of [false, true]) {
      if (expanded) {
        await expand(m, 0)
        await expand(m, 1)
      }
      const [out, incoming] = m.all('outside-card').map((el) => el.getBoundingClientRect())
      expect(Math.abs(incoming!.left - out!.left)).toBeLessThan(1)
      expect(Math.abs(incoming!.width - out!.width)).toBeLessThan(1)
      expect(Math.abs(out!.left - person.left)).toBeLessThan(2)
      const unchanged = m.q('user-message').closest('article')!.getBoundingClientRect()
      expect(unchanged.left).toBe(person.left)
      expect(unchanged.width).toBe(person.width)
    }
  })
  it('named and unnamed relayers keep navigation ids out of text and accessible names, and each link opens its own conversation', async () => {
    const ids = [EXCHANGE_OTHER, 'sess_older']
    const opened: string[] = []
    const m = pane(
      [
        {
          type: 'user_turn',
          text: 'The named bakery note.',
          relayedFrom: ids[0],
          relayedFromProfile: 'ayo',
        },
        { type: 'user_turn', text: 'The older bakery note.', relayedFrom: ids[1] },
      ] as TranscriptEvent[],
      (id) => opened.push(id),
    )
    const headings = m.all('exchange-toggle').map((one) => one.getAttribute('aria-label'))
    expect(headings[0]).toContain('Ayo → BroBot · message')
    expect(headings[1]).toContain('Another agent → BroBot · message')
    for (const expanded of [false, true]) {
      if (expanded) {
        await expand(m, 0)
        await expand(m, 1)
      }
      for (const card of m.all('outside-card')) {
        const readable = [card.textContent ?? '']
        for (const el of [card, ...card.querySelectorAll('*')]) {
          for (const attribute of ['title', 'aria-label', 'aria-description', 'alt']) {
            readable.push(el.getAttribute(attribute) ?? '')
          }
        }
        for (const id of ids) expect(readable.join(' ')).not.toContain(id)
      }
    }
    m.all('exchange-where').forEach((button) => button.click())
    expect(opened).toEqual(ids)
  })
  it('the named heading button supports Enter and Space, reports its controlled body, and preserves each mounted fold', async () => {
    const m = pane(agentExchangeFixture())
    const toggle = m.q('exchange-toggle')
    expect(toggle.tagName).toBe('BUTTON')
    expect(
      document.getElementById(toggle.getAttribute('aria-controls')!)?.getAttribute('data-cy'),
    ).toBe('exchange-body')
    toggle.focus()
    await userEvent.keyboard('{Enter}')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(m.all('exchange-toggle')[1]!.getAttribute('aria-expanded')).toBe('false')
    await userEvent.keyboard(' ')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle)
  })
  it('own held words keep their full presentation, and the app’s stall report folds to one line', async () => {
    const m = pane([
      {
        type: 'user_turn',
        text: 'An app stall',
        attribution: 'app_authored',
        work: { piece: 'work_x', label: 'W1.4', state: 'undriven', owner: EXCHANGE_OTHER },
      },
      { type: 'message_queued', text: 'My own words', messageId: 'mine' },
    ] as TranscriptEvent[])
    // The stall report is the app's own card, closed like the other cards, with its piece on the line.
    expect(m.all('exchange-toggle')).toHaveLength(1)
    expect(m.q('exchange-toggle').getAttribute('aria-expanded')).toBe('false')
    expect(normalized(m.q('exchange-toggle').textContent)).toContain(
      'W1.4 · This app · work you gave out',
    )
    expect(m.all('work-report-message')).toHaveLength(0)
    expect(visible(m.q('queued-message'))).toBe(true)
    expect(normalized(m.q('queued-message').textContent)).toBe('My own words')
  })

  for (const outcome of ['done', 'blocked', 'failed'] as const) {
    it(`closed incoming, outgoing and held replies retain ${outcome} and required action`, async () => {
      const work = {
        piece: 'work_bakery',
        label: 'W1.2',
        state: 'answered',
        outcome,
        owner: EXCHANGE_OTHER,
        needsUserAction: true,
      }
      for (const events of [
        [
          {
            type: 'user_turn',
            text: 'The prose says nothing about outcome.',
            relayedFrom: EXCHANGE_OTHER,
            work,
          },
        ],
        [
          EXCHANGE_INVENTORY,
          { type: 'work_given', piece: 'work_bakery', label: 'W1.2', givenBy: EXCHANGE_OTHER },
          { type: 'tool_call', id: 'reply', name: 'mcp__brobot__reply_to_parent', summary: '{}' },
          {
            type: 'work_replied',
            piece: 'work_bakery',
            outcome,
            needsUserAction: true,
            summary: 'The prose says nothing about outcome.',
            resources: [],
          },
          { type: 'tool_result', id: 'reply', ok: true, summary: 'recorded' },
        ],
        [
          {
            type: 'message_queued',
            messageId: 'q',
            text: 'The prose says nothing about outcome.',
            relayedFrom: EXCHANGE_OTHER,
            work,
          },
        ],
      ]) {
        unmountAll()
        const m = pane(events as TranscriptEvent[])
        // A delivered reply a person has to act on starts open; the held and outgoing forms stay
        // closed. Either way the line carries the outcome and the mark.
        expect(m.q('exchange-toggle').getAttribute('aria-expanded')).toBe(
          events[0]!.type === 'user_turn' ? 'true' : 'false',
        )
        expect(m.q('exchange-state').textContent).toContain(outcome)
        expect(m.q('exchange-state').textContent).toContain('a person has to act')
        if (events[0]!.type === 'message_queued') {
          expect(m.q('exchange-state').textContent).toContain('held')
          expect(m.q('exchange-state').textContent).toContain('not sent')
        }
      }
    })
  }
  it('the mounted held summary learns that work arrived while its words are still held; a held report becomes a delivered report', async () => {
    const r = reactiveRecord([
      { type: 'message_queued', messageId: 'q', text: EXCHANGE_WORDS, relayedFrom: EXCHANGE_OTHER },
    ] as TranscriptEvent[])
    const m = mount(ConversationPane, paneProps({ record: r, ownAgent: 'BroBot', held: [] }))
    expect(m.q('exchange-state').textContent).toBe('held · not sent')
    const toggle = m.q('exchange-toggle')
    applyEvent(r.transcript, {
      type: 'work_given',
      piece: 'work_bakery',
      label: 'W1.2',
      givenBy: EXCHANGE_OTHER,
      messageId: 'q',
    } as TranscriptEvent)
    await nextTick()
    expect(m.q('exchange-toggle')).toBe(toggle)
    expect(toggle.getAttribute('aria-label')).toContain('work · W1.2')
    expect(m.q('exchange-state').textContent).toBe('on its list · words held')
    const work = {
      piece: 'work_bakery',
      label: 'W1.2',
      state: 'answered',
      outcome: 'blocked',
      needsUserAction: true,
      owner: EXCHANGE_OTHER,
    }
    applyEvent(r.transcript, {
      type: 'message_queued',
      messageId: 'reply',
      text: 'Reply',
      relayedFrom: EXCHANGE_OTHER,
      work,
    } as TranscriptEvent)
    await nextTick()
    expect(m.all('exchange-state')[1]!.textContent).toContain(
      'blocked · a person has to act · held',
    )
    applyEvent(r.transcript, {
      type: 'message_unqueued',
      messageId: 'reply',
      reason: 'sent',
    } as TranscriptEvent)
    applyEvent(r.transcript, {
      type: 'user_turn',
      text: 'Reply',
      relayedFrom: EXCHANGE_OTHER,
      work,
    } as TranscriptEvent)
    await nextTick()
    expect(m.all('exchange-state')[1]!.textContent).toBe('blocked · a person has to act')
  })
  it('only bounded navigation ids become links; malformed targets never change relay authorship', async () => {
    for (const [value, relayed, link] of [
      [EXCHANGE_OTHER, true, true],
      ['x'.repeat(200), true, true],
      ['x'.repeat(201), true, false],
      ['', false, false],
      [undefined, false, false],
      [{ bad: true }, false, false],
      [12, false, false],
    ] as const) {
      for (const type of ['user_turn', 'message_queued', 'message_unqueued'] as const) {
        unmountAll()
        const m = pane([
          {
            type,
            text: 'Words',
            relayedFrom: value,
            messageId: 'q',
            reason: 'abandoned',
          } as unknown as TranscriptEvent,
        ])
        expect(m.all('exchange-toggle').length).toBe(relayed ? 1 : 0)
        expect(m.all('exchange-where').length).toBe(link ? 1 : 0)
        if (relayed) expect(m.q('exchange-toggle').getAttribute('aria-label')).toContain('message')
      }
    }
    unmountAll()
    const batched = pane([
      {
        type: 'user_turn',
        text: 'Several words',
        parts: [
          { text: 'Valid words', relayedFrom: EXCHANGE_OTHER, relayedFromProfile: 'ayo' },
          { text: 'Overlong target', relayedFrom: 'x'.repeat(201), relayedFromProfile: 'ayo' },
        ],
      } as TranscriptEvent,
    ])
    expect(batched.all('exchange-toggle')).toHaveLength(2)
    expect(batched.all('exchange-where')).toHaveLength(1)
    expect(
      batched.all('exchange-toggle').every((el) => el.getAttribute('aria-label')?.includes('Ayo')),
    ).toBe(true)
    unmountAll()
    const r = reactiveRecord([
      { type: 'user_turn', text: 'Words', relayedFrom: EXCHANGE_OTHER, relayedFromProfile: 'ayo' },
    ] as TranscriptEvent[])
    const m = mount(TranscriptView, {
      items: r.transcript.items,
      mode: 'normal',
      ownAgent: 'BroBot',
    })
    expect(m.all('exchange-toggle')).toHaveLength(1)
    expect(m.all('exchange-where')).toHaveLength(0)
  })
  it('model detail mounts on demand and retains the exact original text and its open state through folding', async () => {
    const original = '**An exact message**\n\n  Spaces stay.\n'
    const sent = 'Header\n' + original + '\nA reminder.'
    const m = pane([
      { type: 'user_turn', text: original, sent, relayedFrom: EXCHANGE_OTHER },
    ] as TranscriptEvent[])
    expect(m.all('model-got-switch')).toHaveLength(0)
    await expand(m)
    m.q('model-got-switch').click()
    await nextTick()
    expect(m.q('what-the-model-got-sent').textContent).toBe(sent)
    const detail = m.q('what-the-model-got')
    await expand(m)
    expect(visible(detail)).toBe(false)
    await expand(m)
    expect(m.q('what-the-model-got')).toBe(detail)
    expect(m.q('model-got-switch').getAttribute('aria-expanded')).toBe('true')
  })
  it('rendered exchange markdown keeps the existing HTML and unsafe URL protections', async () => {
    const m = pane([
      {
        type: 'user_turn',
        text: '<img src=x onerror="window.evil=1">\n\n[safe](https://example.com) [bad](javascript:alert(1))',
        relayedFrom: EXCHANGE_OTHER,
      },
    ] as TranscriptEvent[])
    await expand(m)
    const md = m.q('relayed-message')
    expect(md.querySelector('img')).toBeNull()
    expect(md.querySelector('[onerror]')).toBeNull()
    expect(md.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(md.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
    expect(md.textContent).toContain('<img src=x')
  })
  it('markdown agent questions keep confirmed path controls, leave missing paths plain, and do not open an answer rail', async () => {
    const presses: string[] = []
    const paths: PathsHere = {
      sessionId: 'sess_1',
      words: { canOpen: true, fileManager: 'Finder' },
      ask: () => {},
      known: (text) =>
        text === '/tmp/menu.md'
          ? { text, found: true, kind: 'file', absolute: text, name: 'menu.md', opens: true }
          : { text, found: false },
      press: async (text) => {
        presses.push(`open:${text}`)
        return null
      },
    }
    const reading = {
      requestId: 'req_path',
      asker: 'BroBot',
      verb: 'asks',
      askedOf: 'Ayo',
      piece: null,
      via: null,
      at: null,
      atTitle: null,
      words: '**Read** `/tmp/menu.md` and `/tmp/missing.md`.',
      wordsAreCut: false,
      wordsMissing: false,
      context: null,
      parts: [
        {
          id: 'part',
          header: null,
          prompt: '**Check** `/tmp/menu.md`.',
          options: [{ label: 'Keep', description: null }],
          multiSelect: false,
          typed: false,
          secret: false,
        },
      ],
      state: 'open',
      answeredBy: null,
      answerable: false,
      refused: null,
      note: null,
      receipt: null,
      where: null,
    } as QuestionCardReading
    const m = mount(
      defineComponent({
        setup: () => () =>
          h(
            OutsideCard,
            {
              shifted: false,
              exchange: { from: 'BroBot', to: 'Ayo', kind: 'question', text: reading.words! },
            },
            () => h(QuestionCard, { reading, markdown: true, paths }),
          ),
      }),
      {},
    )
    expect(m.all('question-words')).toHaveLength(0)
    await expand(m)
    const links = [
      ...m.q('question-words').querySelectorAll<HTMLButtonElement>('[data-message-path]'),
    ]
    expect(links).toHaveLength(1)
    expect(m.q('question-part-part').querySelector('.message-path-text')?.textContent).toBe(
      '/tmp/menu.md',
    )
    expect(links.every((el) => el.dataset.messagePath === '/tmp/menu.md')).toBe(true)
    links[0]!.click()
    await nextTick()
    expect(presses).toEqual(['open:/tmp/menu.md'])
    expect(m.q('exchange-toggle').getAttribute('aria-expanded')).toBe('true')
    expect(m.q('question-words').textContent).toContain('/tmp/missing.md')
    expect(m.all('question-option').every((el) => el.tagName !== 'BUTTON')).toBe(true)
    m.unmount()
    const readOnly = mount(QuestionCard, { reading, markdown: true, paths: null })
    expect(readOnly.host.querySelectorAll('.message-path')).toHaveLength(0)
    expect(readOnly.q('question-words').textContent).toContain('/tmp/menu.md')
  })
  it('a same-mounted route corrected to the person restores the full question and its answer controls', async () => {
    const r = reactiveRecord([
      EXCHANGE_INVENTORY,
      { type: 'tool_call', id: 'ask', name: 'mcp__brobot__ask_question', summary: '{}' },
      {
        type: 'question_asked',
        requestId: 'req_1',
        prompt: '**A choice**',
        questions: [
          { id: 'part', prompt: 'Choose', options: [{ label: 'Keep' }, { label: 'Change' }] },
        ],
      },
      { type: 'request_routed', requestId: 'req_1', to: 'the-parent', parent: EXCHANGE_OTHER },
    ] as TranscriptEvent[])
    const m = mount(ConversationPane, paneProps({ record: r, ownAgent: 'BroBot', held: [] }))
    await expand(m)
    await expand(m)
    applyEvent(r.transcript, {
      type: 'request_routed',
      requestId: 'req_1',
      to: 'a-person',
    } as TranscriptEvent)
    await nextTick()
    expect(m.all('exchange-toggle')).toHaveLength(0)
    expect(visible(m.q('question-words'))).toBe(true)
    expect(m.q('question-words').textContent).toBe('**A choice**')
    expect(m.all('question-option').every((el) => el.tagName === 'BUTTON')).toBe(true)
  })
})
