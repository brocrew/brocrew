import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { applyEvent } from '../../src/renderer/src/lib/transcript'
import type { KeptFile, ResourceReading, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { mount, paneProps, record, unmountAll, visible } from './harness'
import { EXCHANGE_IDS } from './agent-exchanges.fixture'
import {
  EXCHANGE_INVENTORY,
  EXCHANGE_OTHER,
  MESSAGE_ACT,
  messageCall,
  messageReceipt,
  messageResult,
  answerNotice,
  questionFixture,
  ANSWER_NOTICE,
} from './agent-card-facts.fixture'
afterEach(() => {
  unmountAll()
  vi.restoreAllMocks()
  useWhoCalledWhom().treeFiles.value = null
})
function pane(
  events: TranscriptEvent[],
  opened: string[] = [],
  over: Record<string, unknown> = {},
) {
  const r = reactive(record(events))
  const m = mount(
    ConversationPane,
    paneProps({
      record: r,
      ownAgent: 'BroBot',
      cwd: '/fictional/bakery',
      identities: EXCHANGE_IDS,
      held: [],
      onOpenConversation: (id: string) => opened.push(id),
      ...over,
    }),
    { width: 1200, height: 1000 },
  )
  return { m, r }
}
function header(card: HTMLElement) {
  return card.querySelector('.exchange-heading')?.textContent?.trim()
}
const normalized = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim()
describe('durable card facts in the conversation', () => {
  for (const kind of ['note', 'follow-up'] as const)
    it(`${kind}: exact receiver, kind and both closed/open links`, async () => {
      const opened: string[] = []
      const { m } = pane(
        [EXCHANGE_INVENTORY, messageCall(), messageReceipt(MESSAGE_ACT, { kind }), messageResult()],
        opened,
      )
      expect(header(m.q('outgoing'))).toBe(`BroBot → Ayo · ${kind}`)
      expect(m.q('exchange-preview').textContent).toContain('Check the fictional menu.')
      m.q('exchange-where').click()
      expect(opened).toEqual([EXCHANGE_OTHER])
      m.q('exchange-toggle').click()
      await nextTick()
      expect(m.q('outgoing-message').querySelector('strong')?.textContent).toBe('Check')
      expect(m.q('outgoing-message').textContent).toContain('The note ends here.')
      expect(m.all('outgoing-recipient')).toHaveLength(0)
      expect(header(m.q('outgoing'))).toBe(`BroBot → Ayo · ${kind}`)
      m.q('exchange-where').click()
      expect(opened).toEqual([EXCHANGE_OTHER, EXCHANGE_OTHER])
    })
  it('two conversations with the same display name show the recorded receiver label, not the subject piece', async () => {
    const { m } = pane([
      EXCHANGE_INVENTORY,
      messageCall(),
      messageResult(),
      messageReceipt(MESSAGE_ACT, {
        toProfile: 'brobot',
        toLabel: 'W1',
        piece: 'work_bakery',
        label: 'W4.2',
      }),
    ])
    expect(header(m.q('outgoing'))).toBe('BroBot → BroBot · W1 · note · W4.2')
    m.q('exchange-toggle').click()
    await nextTick()
    expect(header(m.q('outgoing'))).toBe('BroBot → BroBot · W1 · note · W4.2')
    expect(m.q('exchange-body').textContent).not.toContain('sess_')
  })
  it('the only visible alias call remains unnamed until its exact result arrives; conflicts retract it in place', async () => {
    const { m, r } = pane([EXCHANGE_INVENTORY, messageCall(), messageReceipt()])
    expect(header(m.q('outgoing'))).toBe('BroBot → the named agent · message')
    expect(m.all('exchange-where')).toHaveLength(0)
    applyEvent(r.transcript, messageResult())
    await nextTick()
    expect(header(m.q('outgoing'))).toBe('BroBot → Ayo · note')
    expect(m.all('exchange-where')).toHaveLength(1)
    applyEvent(r.transcript, messageReceipt(MESSAGE_ACT, { toProfile: 'brobot' }))
    await nextTick()
    expect(header(m.q('outgoing'))).toBe('BroBot → the named agent · message')
    expect(m.all('exchange-where')).toHaveLength(0)
  })
  for (const by of [null, EXCHANGE_OTHER])
    it(`${by === null ? 'person' : 'agent'}: folded line contains the answer, and expansion retains the whole notice`, async () => {
      const { m } = pane([answerNotice(by)])
      const card = m.q('answered-question')
      expect(header(card)).toBe(`${by === null ? 'A person' : 'Ayo'} → BroBot · answer`)
      expect(card.querySelector('[data-cy="exchange-toggle"]')?.getAttribute('aria-expanded')).toBe(
        'false',
      )
      expect(card.querySelector('[data-cy="exchange-preview"]')?.textContent).toBe(
        'Keep the bakery menu. The ovens stay off.',
      )
      expect(card.textContent).not.toContain('Which menu?')
      expect(m.all('answer-question-link')).toHaveLength(0)
      card.querySelector<HTMLButtonElement>('[data-cy="exchange-toggle"]')!.click()
      await nextTick()
      const body = card.querySelector('[data-cy="exchange-body"]')!
      expect(visible(body)).toBe(true)
      expect(body.textContent).toContain('Which menu?')
      expect(body.textContent).toContain('The full notice ends here.')
      if (by === null) {
        expect(m.q('app-notice-message').textContent?.trim()).toBe(ANSWER_NOTICE)
        // An app notice opens to what the model got too, closed by default and outside its words.
        expect(visible(m.q('model-got-switch'))).toBe(true)
        expect(m.q('app-notice-message').contains(m.q('model-got-switch'))).toBe(false)
      } else {
        expect(m.q('relayed-message').querySelector('strong')?.textContent).toBe('Keep')
        expect(visible(m.q('model-got-switch'))).toBe(true)
        m.q('model-got-switch').click()
        await nextTick()
        expect(body.textContent).toContain('Hide what the model got')
      }
      expect(m.all('outside-card')).toHaveLength(1)
    })
  it('the line press and explicit link scroll to the matching question, expand it and mark that exact card', async () => {
    const fillers: TranscriptEvent[] = Array.from(
      { length: 35 },
      (_, i) =>
        ({
          type: 'assistant_message',
          text: `Fictional bakery progress ${i}.\n\nNo action required.`,
          role: 'assistant',
        }) as TranscriptEvent,
    )
    const { m, r } = pane([...questionFixture(), ...fillers, answerNotice()])
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const target = r.transcript.items.find(
      (item) => item.kind === 'tool' && item.outgoing && 'asked' in item.outgoing,
    )!
    const entry = m.host.querySelector<HTMLElement>(`.entry[data-item="${target.id}"]`)!
    const stream = m.q('transcript')
    expect(entry.getBoundingClientRect().bottom).toBeLessThan(stream.getBoundingClientRect().top)
    m.q('answer-question-link').click()
    await nextTick()
    await vi.waitFor(() => {
      const b = entry.getBoundingClientRect(),
        s = stream.getBoundingClientRect()
      expect(b.bottom).toBeGreaterThan(s.top)
      expect(b.top).toBeLessThan(s.bottom)
    })
    expect(entry.classList.contains('flash')).toBe(true)
    expect(entry.querySelector('[data-cy="question-words"]')?.textContent).toBe('Which menu?')
    stream.scrollTop = stream.scrollHeight
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    m.q('answered-question')
      .querySelector<HTMLButtonElement>('[data-cy="exchange-toggle"]')!
      .click()
    await nextTick()
    await vi.waitFor(() =>
      expect(entry.getBoundingClientRect().bottom).toBeGreaterThan(
        stream.getBoundingClientRect().top,
      ),
    )
    expect(entry.classList.contains('flash')).toBe(true)
  })
  for (const by of [null, EXCHANGE_OTHER])
    it(`${by === null ? 'person' : 'agent'} queued answer and its accepted turn retain the preview and original body treatment`, async () => {
      const raw = answerNotice(by) as Extract<TranscriptEvent, { type: 'user_turn' }>
      const { type, ...facts } = raw
      void type
      const { m, r } = pane([
        { ...facts, type: 'message_queued', messageId: 'message_answer' } as TranscriptEvent,
      ])
      expect(m.q('exchange-preview').textContent).toContain('Keep the bakery menu.')
      m.q('exchange-toggle').click()
      await nextTick()
      expect(m.all('queued-cancel')).toHaveLength(0)
      expect(m.q('queued-state').textContent).toContain('not sent')
      expect(m.all('outside-card')).toHaveLength(1)
      expect(m.q('queued-entry').getAttribute('data-carded')).toBe(by === null ? 'false' : 'true')
      expect(m.q('queued-entry').querySelectorAll('.msg-avatar')).toHaveLength(by === null ? 1 : 0)
      applyEvent(r.transcript, {
        type: 'message_unqueued',
        messageId: 'message_answer',
        reason: 'sent',
        text: ANSWER_NOTICE,
      } as TranscriptEvent)
      applyEvent(r.transcript, raw)
      await nextTick()
      expect(m.all('answered-question')).toHaveLength(1)
      expect(m.q('exchange-preview').textContent).toBe('Keep the bakery menu. The ovens stay off.')
      expect(m.all('queued-entry')).toHaveLength(0)
    })
  it('batched notices show each typed answer while a person message keeps its full bubble', () => {
    const { type, ...part } = answerNotice(EXCHANGE_OTHER) as Extract<
      TranscriptEvent,
      { type: 'user_turn' }
    >
    void type
    const { m } = pane([
      {
        type: 'user_turn',
        text: 'Person and answer',
        parts: [{ text: 'Keep my own message visible.' }, part],
      },
    ])
    expect(m.all('answered-question')).toHaveLength(1)
    expect(m.host.textContent).toContain('Keep my own message visible.')
    expect(m.q('exchange-preview').textContent).toContain('Keep the bakery menu.')
  })
  it('an expanded agent answer keeps the input file and its exact document action', async () => {
    const file: KeptFile = {
      resourceId: 'res_bakery',
      title: 'Bakery menu',
      name: 'bakery.md',
      form: 'markdown',
      bytes: 13,
      role: 'input',
      keptAt: 1,
      sha256: 'a'.repeat(64),
      addedBy: { conversation: EXCHANGE_OTHER, name: 'Ayo', identity: 'ayo' },
      piece: 'work_bakery',
      label: 'W4.2',
      pieceTitle: 'Bakery menu',
    }
    useWhoCalledWhom().treeFiles.value = { conversation: 'sess_1', files: [file], answered: true }
    const read: string[] = []
    const { m } = pane(
      [{ ...answerNotice(EXCHANGE_OTHER), piece: 'work_bakery', label: 'W4.2' } as TranscriptEvent],
      [],
      {
        onReadResource: async (resourceId: string): Promise<ResourceReading> => {
          read.push(resourceId)
          return {
            ok: true,
            form: 'markdown',
            resourceId,
            name: 'bakery.md',
            text: '# Bakery menu',
            bytes: 13,
          }
        },
      },
    )
    expect(m.all('file-row')).toHaveLength(0)
    m.q('exchange-toggle').click()
    await nextTick()
    expect(m.q('file-row').textContent).toContain('Bakery menu')
    expect(m.q('file-row').tagName).toBe('BUTTON')
    m.q('file-row').click()
    await nextTick()
    await nextTick()
    expect(read).toEqual(['res_bakery'])
    expect(visible(m.q('canonical-document-viewer'))).toBe(true)
    expect(m.q('canonical-document-name').textContent).toContain('bakery.md')
  })
  it('cannot-answer and clipped answers retain their declared meaning, not the question prose', async () => {
    const { m } = pane([
      answerNotice(EXCHANGE_OTHER, {
        cannotAnswer: true,
        clipped: true,
        answer: 'I cannot settle this bakery choice.',
      }),
    ])
    expect(header(m.q('answered-question'))).toBe('Ayo → BroBot · cannot answer')
    expect(m.q('exchange-preview').textContent).toBe('I cannot settle this bakery choice.')
    expect(m.q('exchange-state').textContent).toContain('Cut at the size limit')
    m.q('exchange-toggle').click()
    await nextTick()
    expect(normalized(m.q('exchange-body').textContent)).toContain('The full notice ends here.')
  })
  it('historical app notices keep the full reading and do not invent an answer from prose', () => {
    const old = answerNotice()
    delete (old as { answeredQuestion?: unknown }).answeredQuestion
    const { m } = pane([old])
    expect(m.all('answered-question')).toHaveLength(0)
    expect(m.q('app-notice-message').textContent?.trim()).toBe(ANSWER_NOTICE)
    expect(m.all('app-notice-why')).toHaveLength(0)
  })
})
