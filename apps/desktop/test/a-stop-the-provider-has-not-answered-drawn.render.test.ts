import type { TranscriptEvent } from '../src/shared/conversation-events'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ConversationPane from '../src/renderer/src/components/ConversationPane.vue'
import NoticeEntry from '../src/renderer/src/components/NoticeEntry.vue'
import PromptComposer from '../src/renderer/src/components/PromptComposer.vue'
import ReadingPane from '../src/renderer/src/components/ReadingPane.vue'
import TranscriptView from '../src/renderer/src/components/TranscriptView.vue'
import {
  acceptEvent,
  createSessionRecord,
  openWindow,
  type SessionRecord,
} from '../src/renderer/src/lib/session-record'
import type { WindowState } from '../src/renderer/src/lib/transcript-window'
import {
  applyEvent,
  createTranscript,
  type TranscriptItem,
} from '../src/renderer/src/lib/transcript'
import { ASKED_TO_STOP, stoppedBy } from '../src/shared/how-work-stopped'
import {
  DEFAULT_PROFILE_ID,
  providerName,
  type LibraryEntry,
  type CreatedSession,
  type Provider,
} from '../src/shared/runtime-ipc'

type NoticeItem = Extract<TranscriptItem, { kind: 'notice' }>

const AT = 1_700_000_000_000

const since730 = (): Promise<typeof import('../src/renderer/src/lib/stop-unanswered')> =>
  import('../src/renderer/src/lib/stop-unanswered')

const CODEX_HAS_NOT_ANSWERED = 'Codex has not answered the stop asked for by a person'
const CODEX_STOP_JOINS =
  'Codex has not answered the stop asked for by a person — while that ask stands, Stop joins it rather than asking Codex again'

const FROZEN_TITLE = 'Stop instead of answering — the turn is asked to stop (Esc)'
const BUSY_TITLE = 'Stop — the turn is asked to stop (Esc)'

const CODEX_REF = { provider: 'codex' as const, sessionId: 'th_1', cwd: '/work', rotation: 0 }
const started = { type: 'session', state: 'started', ref: CODEX_REF } as TranscriptEvent
const asked = { type: 'user_turn', text: 'count to sixty' } as TranscriptEvent
const working = { type: 'status', state: 'working' } as TranscriptEvent
const aPersonsAsk: TranscriptEvent = { type: 'work_interrupted', by: 'a-person' }
const unanswered: TranscriptEvent = { type: 'stop_unanswered', waitedMs: 2_000, by: 'a-person' }

function folded(...events: TranscriptEvent[]): TranscriptItem[] {
  const state = createTranscript()
  events.forEach((event, index) => applyEvent(state, event, AT + index * 1_000))
  return state.items
}

const notices = (items: readonly TranscriptItem[]): NoticeItem[] =>
  items.filter((item): item is NoticeItem => item.kind === 'notice')

function theNotice(items: readonly TranscriptItem[]): NoticeItem {
  const found = notices(items).filter((one) => one.text.includes('has not answered the stop'))
  expect(found, 'the fold drew no notice for `stop_unanswered`').toHaveLength(1)
  return found[0]!
}

function theAsk(items: readonly TranscriptItem[]): NoticeItem {
  const found = notices(items).filter((one) => one.text.startsWith(`${ASKED_TO_STOP} by `))
  expect(found, 'the fold drew no notice for the ask').toHaveLength(1)
  return found[0]!
}

const render = (component: unknown, props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(component as never, props) }))

const shown = (markup: string): string => markup.replace(/<!--[\s\S]*?-->/g, '')

const decode = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const textsOf = (markup: string, cy: string): string[] =>
  [
    ...shown(markup).matchAll(new RegExp(`data-cy="${escapeRegExp(cy)}"[^>]*>([\\s\\S]*?)</`, 'g')),
  ].map((one) => decode(one[1]!.trim()))

const titlesOf = (markup: string, cy: string): string[] =>
  [...shown(markup).matchAll(new RegExp(`<[a-z]+\\b[^>]*data-cy="${escapeRegExp(cy)}"[^>]*>`, 'g'))]
    .map((tag) => /\btitle="([^"]*)"/.exec(tag[0])?.[1])
    .filter((title): title is string => title !== undefined)
    .map(decode)

const count = (markup: string, cy: string): number =>
  shown(markup).split(`data-cy="${cy}"`).length - 1

describe('§1 · `NoticeEntry` re-says the fold’s facts with the conversation’s provider', () => {
  it('🔴 with `provider: codex` it draws *Codex has not answered the stop asked for by a person* — on the line and on its title', async () => {
    const item = theNotice(folded(started, asked, working, aPersonsAsk, unanswered))
    const html = await render(NoticeEntry, { item, provider: 'codex' })
    expect(textsOf(html, 'what-the-notice-says')).not.toEqual([item.text])
    expect(textsOf(html, 'what-the-notice-says')).toEqual([CODEX_HAS_NOT_ANSWERED])
    expect(titlesOf(html, 'what-the-notice-says')).toEqual([CODEX_HAS_NOT_ANSWERED])
    expect(count(html, 'notice-warn')).toBe(1)
    const { stopUnansweredSays } = await since730()
    expect(textsOf(html, 'what-the-notice-says')).toEqual([
      stopUnansweredSays({ by: 'a-person', waitedMs: 2_000 }, 'codex'),
    ])
    expect(CODEX_HAS_NOT_ANSWERED.startsWith(providerName('codex'))).toBe(true)
  })

  it('🔴 with no provider — as a surface that does not know it mounts it — it draws the fold’s own words, *The provider …*', async () => {
    const item = theNotice(folded(started, asked, working, aPersonsAsk, unanswered))
    for (const over of [{}, { provider: null }]) {
      const html = await render(NoticeEntry, { item, ...over })
      expect(textsOf(html, 'what-the-notice-says'), JSON.stringify(over)).toEqual([
        'The provider has not answered the stop asked for by a person',
      ])
      expect(textsOf(html, 'what-the-notice-says'), JSON.stringify(over)).toEqual([item.text])
    }
  })

  it('🔴 an agent’s ask, in a Codex conversation, is *asked for by an agent* — never the handle', async () => {
    const item = theNotice(
      folded(
        started,
        asked,
        working,
        { type: 'work_interrupted', by: 'an-agent', agent: 'sess_abc' },
        { type: 'stop_unanswered', waitedMs: 2_000, by: 'an-agent', agent: 'sess_abc' },
      ),
    )
    const html = await render(NoticeEntry, { item, provider: 'codex' })
    expect(textsOf(html, 'what-the-notice-says')).toEqual([
      'Codex has not answered the stop asked for by an agent',
    ])
    expect(decode(shown(html))).not.toContain('sess_')
  })

  it('⚑ THE CONTROL — an ordinary notice (the ask’s own) ignores `provider`: its text, with or without it', async () => {
    const item = theAsk(folded(started, asked, working, aPersonsAsk))
    for (const over of [{}, { provider: 'codex' }, { provider: null }]) {
      const html = await render(NoticeEntry, { item, ...over })
      expect(textsOf(html, 'what-the-notice-says'), JSON.stringify(over)).toEqual([
        `${ASKED_TO_STOP} by ${stoppedBy('a-person', null)}`,
      ])
      expect(textsOf(html, 'what-the-notice-says'), JSON.stringify(over)).not.toContain(
        CODEX_HAS_NOT_ANSWERED,
      )
    }
  })

  it('⚑ THE CONTROL — a double that carries only the TEXT (no `stopUnanswered`) keeps the old drawing: its text, provider or not', async () => {
    const item: NoticeItem = {
      kind: 'notice',
      id: 'notice-1',
      level: 'warn',
      text: 'The provider has not answered the stop asked for by a person',
      at: AT,
    }
    const html = await render(NoticeEntry, { item, provider: 'codex' })
    expect(textsOf(html, 'what-the-notice-says')).toEqual([item.text])
    expect(titlesOf(html, 'what-the-notice-says')).toEqual([item.text])
  })
})

describe('§2 · `TranscriptView` hands its notices the provider it draws under', () => {
  const view = (items: TranscriptItem[], over: Record<string, unknown> = {}): Promise<string> =>
    render(TranscriptView, { items, mode: 'normal', ...over })

  it('🔴 a Codex transcript names Codex on the line — the ask’s own line above it unchanged', async () => {
    const html = await view(folded(started, asked, working, aPersonsAsk, unanswered), {
      provider: 'codex',
    })
    const lines = textsOf(html, 'what-the-notice-says')
    expect(lines).toContain(`${ASKED_TO_STOP} by ${stoppedBy('a-person', null)}`)
    expect(lines).toContain(CODEX_HAS_NOT_ANSWERED)
    expect(lines.indexOf(`${ASKED_TO_STOP} by a person`)).toBeLessThan(
      lines.indexOf(CODEX_HAS_NOT_ANSWERED),
    )
    expect(lines).not.toContain('The provider has not answered the stop asked for by a person')
  })

  it('🔴 a transcript told no provider draws the fold’s words', async () => {
    const html = await view(folded(started, asked, working, aPersonsAsk, unanswered))
    expect(textsOf(html, 'what-the-notice-says')).toContain(
      'The provider has not answered the stop asked for by a person',
    )
  })

  it('⚑ THE CONTROL — the same view over the rows without `stop_unanswered` draws the ask’s line and no such line', async () => {
    const html = await view(folded(started, asked, working, aPersonsAsk), { provider: 'codex' })
    const lines = textsOf(html, 'what-the-notice-says')
    expect(lines).toContain(`${ASKED_TO_STOP} by ${stoppedBy('a-person', null)}`)
    expect(lines.filter((line) => line.includes('has not answered the stop'))).toEqual([])
  })
})

describe('§3 · `PromptComposer` says, while `busy`, that Stop joins the ask the provider has not answered', () => {
  const composer = (props: Record<string, unknown>): Promise<string> =>
    render(PromptComposer, { draft: '', who: 'Codex', ...props })

  function footOf(html: string): string {
    const body = /<p[^>]*data-cy="composer-hint"[^>]*>([\s\S]*?)<\/p>/.exec(shown(html))?.[1]
    expect(body, 'no composer-hint was drawn').toBeDefined()
    return decode(body!.replace(/<[^>]+>/g, ''))
      .replace(/\s+/g, ' ')
      .trim()
  }

  it('🔴 `busy` with it: the Stop’s title is the sentence, and the foot says Esc is Stop and a message still queues', async () => {
    const html = await composer({ state: 'busy', stopUnanswered: CODEX_STOP_JOINS })
    expect(count(html, 'interrupt-session')).toBe(1)
    expect(titlesOf(html, 'interrupt-session')).not.toEqual([BUSY_TITLE])
    expect(titlesOf(html, 'interrupt-session')).toEqual([`${CODEX_STOP_JOINS} (Esc)`])
    expect(footOf(html)).toBe(`${CODEX_STOP_JOINS}. Esc is Stop; type to queue a message.`)
    expect(footOf(html)).not.toContain('Esc is Stop: the turn is asked to stop')
    const { stopJoinsThatAsk } = await since730()
    expect(CODEX_STOP_JOINS).toBe(stopJoinsThatAsk({ by: 'a-person', waitedMs: 2_000 }, 'codex'))
  })

  it('🔴 730 review · with a message already waiting, the foot still offers to queue — behind it (D-010)', async () => {
    const html = await composer({
      state: 'busy',
      stopUnanswered: CODEX_STOP_JOINS,
      hasQueued: true,
    })
    expect(footOf(html)).toBe(`${CODEX_STOP_JOINS}. Esc is Stop; type to queue a message.`)
    expect(titlesOf(html, 'interrupt-session')).toEqual([`${CODEX_STOP_JOINS} (Esc)`])
  })

  it('⚑ THE CONTROL — `busy` without it (absent or `null`) draws the busy title and foot', async () => {
    for (const over of [{}, { stopUnanswered: null }]) {
      const html = await composer({ state: 'busy', ...over })
      expect(titlesOf(html, 'interrupt-session'), JSON.stringify(over)).toEqual([BUSY_TITLE])
      expect(footOf(html), JSON.stringify(over)).toBe(
        'Codex is working — type to queue a message. Esc is Stop: the turn is asked to stop.',
      )
    }
  })

  it('⚑ THE CONTROL — `frozen` WITH it keeps the frozen title and foot: while a card is up a press is a NEW ask', async () => {
    const html = await composer({ state: 'frozen', stopUnanswered: CODEX_STOP_JOINS })
    expect(titlesOf(html, 'interrupt-session')).toEqual([FROZEN_TITLE])
    expect(footOf(html)).toBe(
      "Answer the request above to continue. A message won't answer it, but Esc is Stop: the turn is asked to stop.",
    )
    expect(footOf(html)).not.toContain('has not answered')
  })

  it('⚑ THE CONTROL — `idle` WITH it draws the idle foot and no Stop at all', async () => {
    const html = await composer({ state: 'idle', stopUnanswered: CODEX_STOP_JOINS })
    expect(count(html, 'interrupt-session')).toBe(0)
    expect(count(html, 'send-prompt')).toBe(1)
    expect(footOf(html)).toMatch(/ to send · Enter for a new line$/)
    expect(footOf(html)).not.toContain('has not answered')
  })

  it('⚑ THE CONTROL — `busy` and NOT interruptible, WITH it: no Stop, and the foot says only who is working', async () => {
    const html = await composer({
      state: 'busy',
      interruptible: false,
      stopUnanswered: CODEX_STOP_JOINS,
    })
    expect(count(html, 'interrupt-session')).toBe(0)
    expect(footOf(html)).toBe('Codex is working…')
  })

  it('⚑ THE CONTROL — `busy` with a DRAFT, WITH it: interrupt-and-send asks again (`723` F-5), so its two outcomes stand', async () => {
    const html = await composer({
      state: 'busy',
      draft: 'no, do this instead',
      stopUnanswered: CODEX_STOP_JOINS,
    })
    const without = await composer({ state: 'busy', draft: 'no, do this instead' })
    expect(count(html, 'interrupt-session')).toBe(0)
    expect(count(html, 'interrupt-send-prompt')).toBe(1)
    expect(footOf(html)).toContain('to send after Codex finishes')
    expect(footOf(html)).toBe(footOf(without))
    expect(titlesOf(html, 'interrupt-send-prompt')).toEqual(
      titlesOf(without, 'interrupt-send-prompt'),
    )
    expect(titlesOf(html, 'interrupt-send-prompt')).toHaveLength(1)
    expect(footOf(html)).not.toContain('has not answered')
  })

  it('🔴 739 · `busy` with a DRAFT, WITH it: the foot says the press’s OWN ask, in R43’s words with the host’s limit — never R83’s', async () => {
    const html = await composer({
      state: 'busy',
      draft: 'no, do this instead',
      stopUnanswered: CODEX_STOP_JOINS,
    })
    expect(footOf(html)).toContain(
      `is Stop and send: the turn is ${ASKED_TO_STOP}; this is sent once it has ended`,
    )
    expect(footOf(html)).not.toContain('has not answered')
  })

  it('⚑ THE CONTROL — `blocked` outranks it, as it outranks every state’s own sentence (169 §1)', async () => {
    const blocked = 'This conversation’s folder is gone.'
    const html = await composer({
      state: 'busy',
      blocked: [{ words: blocked }],
      stopUnanswered: CODEX_STOP_JOINS,
    })
    expect(shown(html)).toContain('data-cy="send-blocked"')
    expect(shown(html)).toContain(blocked)
    expect(shown(html)).not.toContain('data-cy="composer-hint"')
  })
})

describe('§4 · `stop-unanswered.ts` — the two sentences, composed, never typed', () => {
  it('⚑ rule 5 — the provider named by `providerName`, *the provider* when unknown, the asker by its kind', async () => {
    const { stopUnansweredSays, stopJoinsThatAsk } = await since730()
    const aPerson = { by: 'a-person' as const, waitedMs: 2_000 }
    const anAgent = { by: 'an-agent' as const, waitedMs: 2_000, agent: 'sess_abc' }
    expect(stopUnansweredSays(aPerson, 'codex')).toBe(CODEX_HAS_NOT_ANSWERED)
    expect(stopUnansweredSays(aPerson, 'claude')).toBe(
      `${providerName('claude')} has not answered the stop asked for by a person`,
    )
    expect(stopUnansweredSays(aPerson, null)).toBe(
      'The provider has not answered the stop asked for by a person',
    )
    expect(stopUnansweredSays(anAgent, 'codex')).toBe(
      'Codex has not answered the stop asked for by an agent',
    )
    expect(stopJoinsThatAsk(aPerson, 'codex')).toBe(CODEX_STOP_JOINS)
    expect(stopJoinsThatAsk(aPerson, null)).toBe(
      'The provider has not answered the stop asked for by a person — while that ask stands, Stop joins it rather than asking the provider again',
    )
    expect(stopJoinsThatAsk(anAgent, 'codex')).not.toContain('sess_')
    expect(stopUnansweredSays({ ...aPerson, waitedMs: 40 }, 'codex')).toBe(CODEX_HAS_NOT_ANSWERED)
  })
})

describe('§5 · 730 review — the reading pane and the full view hand their transcript the provider they know', () => {
  const SESSION = 'sess_r83'
  const ROWS: TranscriptEvent[] = [
    { type: 'user_turn', text: 'count to sixty, slowly' } as TranscriptEvent,
    { type: 'work_interrupted', by: 'a-person' } as TranscriptEvent,
    { type: 'stop_unanswered', waitedMs: 2_000, by: 'a-person' } as TranscriptEvent,
  ]
  const page = (rows: TranscriptEvent[]): WindowState => ({
    entries: rows.map((event, ordinal) => ({
      sessionId: SESSION,
      ordinal,
      at: AT + ordinal,
      event,
    })),
    from: 0,
    hasOlder: false,
    turnAligned: true,
    atTail: true,
    behind: 0,
  })
  const entry = (provider: Provider): LibraryEntry => ({
    id: SESSION,
    provider,
    providerSessionId: 'thread-r83',
    recordId: SESSION,
    cwd: '/work/checkout',
    title: 'Count to sixty',
    preview: 'count to sixty, slowly',
    createdAt: AT,
    updatedAt: AT + 60_000,
    bytes: 4_096,
    origin: 'ours',
    onDisk: true,
    readable: true,
    derived: null,
    lastEnding: 'interrupted',
    unresumableReason: null,
    child: null,
  })
  const recorded = (provider: Provider, rows: TranscriptEvent[]): SessionRecord => {
    const record = createSessionRecord(SESSION)
    const history = page(rows)
    openWindow(record, history)
    for (const one of history.entries) acceptEvent(record, one)
    record.meta = {
      sessionId: SESSION,
      provider,
      cwd: '/work/checkout',
      providerHome: '/homes/one',
      profileId: DEFAULT_PROFILE_ID,
      instructions: {
        injected: [],
        agentMemory: [],
        provider: [],
        refused: [],
        note: '',
        recallsReported: false,
        writesReported: false,
        composed: null,
      },
      ref: { provider, sessionId: 'thread-r83', cwd: '/work/checkout', rotation: 0 },
      config: { home: '/homes/one', homeEnv: 'HOME', model: 'files', authNote: null, files: [] },
      approvalMode: 'ask',
      pendingApprovalMode: null,
      approvalNote: 'approvals: ask',
      blanketGrants: [],
      planNeedsGoAhead: false,
      queued: [],
      settings: {
        model: null,
        pendingModel: null,
        reasoningEffort: null,
        pendingReasoningEffort: null,
        planMode: false,
        pendingPlanMode: null,
      },
      liveness: { state: 'live', since: AT },
      hasACommander: false,
      startedWithoutAWindow: false,
      mayHandItBack: false,
    } as unknown as CreatedSession
    record.phase = 'recorded'
    return record
  }
  const reading = (provider: Provider, rows = ROWS): Promise<string> =>
    render(ReadingPane, { entry: entry(provider), history: page(rows), mode: 'normal' })
  const fullView = (provider: Provider, rows = ROWS): Promise<string> =>
    render(ConversationPane, {
      record: recorded(provider, rows),
      mode: 'normal',
      debug: false,
      drawerOpen: false,
      drawerTab: 'open',
      draft: '',
    })
  const unanswered = (html: string): string[] =>
    textsOf(html, 'what-the-notice-says').filter((one) => one.includes('has not answered the stop'))

  for (const [pane, draw] of [
    ['the reading pane', reading],
    ['the full view of a conversation drawn from its ledger', fullView],
  ] as const) {
    it(`🔴 ${pane} names the conversation’s own provider — Codex for a Codex conversation, Claude for a Claude one`, async () => {
      expect(unanswered(await draw('codex'))).toEqual([CODEX_HAS_NOT_ANSWERED])
      expect(unanswered(await draw('claude'))).toEqual([
        `${providerName('claude')} has not answered the stop asked for by a person`,
      ])
    })

    it(`⚑ THE CONTROL — ${pane} over the same ledger without the row draws no such notice`, async () => {
      const html = await draw('codex', ROWS.slice(0, 2))
      expect(unanswered(html)).toEqual([])
      expect(textsOf(html, 'what-the-notice-says')).toContain(
        `${ASKED_TO_STOP} by ${stoppedBy('a-person', null)}`,
      )
    })
  }
})
