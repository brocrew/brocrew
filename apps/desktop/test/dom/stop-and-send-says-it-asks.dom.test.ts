import type { TranscriptEvent } from '../../src/shared/conversation-events'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick, reactive } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import {
  interruptKeyLabel,
  sendKeyLabel,
} from '../../src/renderer/src/components/PromptComposer.vue'
import {
  acceptEvent,
  createSessionRecord,
  type SessionRecord,
} from '../../src/renderer/src/lib/session-record'
import { ASKED_TO_STOP } from '../../src/shared/how-work-stopped'
import { agentName, type CreatedSession } from '../../src/shared/runtime-ipc'
import { assertDrawn, drawnReady } from './drawn'
import { META, mount, paneProps, unmountAll, visible, type Mounted } from './harness'

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

type StopWords = typeof import('../../src/renderer/src/lib/stop-unanswered')
const STOP_WORDS = import.meta.glob<StopWords>('../../src/renderer/src/lib/stop-unanswered.ts')

async function theClauses(): Promise<{ asks: string | undefined; sent: string | undefined }> {
  const load = Object.values(STOP_WORDS)[0]
  if (load === undefined) throw new Error('`lib/stop-unanswered.ts` is not on this tree')
  const words = await load()
  return { asks: words.A_STOP_ASKS_THE_TURN, sent: words.A_STOP_THEN_THIS_IS_SENT }
}

const AT = 1_700_000_000_000
const RAIL_W = 208
const PANE_W = 972
const PANE_H = 900

const SEND_KEY = sendKeyLabel(navigator.platform)
const INTERRUPT_KEY = interruptKeyLabel(navigator.platform)

const THE_LIMIT = 'comes back to you'
const STOP_THEN_SENT = 'the turn is asked to stop; this is sent once it has ended'
const TITLE = `Stop and send — the turn is asked to stop; this is sent once it has ended (${INTERRUPT_KEY})`
const FOOT_TAIL = `finishes · ${INTERRUPT_KEY} is Stop and send: the turn is asked to stop; this is sent once it has ended`
const PLAIN_STOP_TITLE = 'Stop — the turn is asked to stop (Esc)'

const CODEX_META: CreatedSession = {
  ...META,
  provider: 'codex',
  providerHome: '/homes/codex',
  ref: { provider: 'codex', sessionId: 'th_1', cwd: '/work', rotation: 0 },
}

const WHO = agentName(CODEX_META.profileId, null)
const FOOT_WAITING = `${SEND_KEY} to send when ${WHO} finishes, with what is already waiting — a command goes alone · ${INTERRUPT_KEY} is Stop and send: the turn is asked to stop; this is sent once it has ended`

const DRAFT = 'no, look at the migration first'

const started = { type: 'session', state: 'started', ref: CODEX_META.ref } as TranscriptEvent
const asked = { type: 'user_turn', text: 'count to sixty, slowly' } as TranscriptEvent
const working = { type: 'status', state: 'working' } as TranscriptEvent

function feed(record: SessionRecord, event: TranscriptEvent): void {
  const ordinal = record.nextOrdinal
  acceptEvent(record, { sessionId: record.sessionId, ordinal, at: AT + ordinal * 1_000, event })
}

function conversation(
  events: TranscriptEvent[],
  meta: Partial<CreatedSession> = {},
): SessionRecord {
  const record = reactive(createSessionRecord('sess_1')) as SessionRecord
  record.meta = { ...CODEX_META, ...meta }
  record.phase = 'open'
  for (const event of events) feed(record, event)
  return record
}

function holding(appAuthored: boolean): SessionRecord {
  const text = appAuthored ? 'Go ahead with the plan.' : 'and then run the tests'
  const attribution = appAuthored ? { attribution: 'app_authored' as const } : {}
  return conversation(
    [
      started,
      asked,
      working,
      {
        type: 'message_queued',
        messageId: 'q_1',
        kind: 'work',
        text,
        ...attribution,
      } as TranscriptEvent,
    ],
    { queued: [{ kind: 'work', id: 'q_1', text, since: AT, ...attribution }] },
  )
}

async function pane(record: SessionRecord, over: Record<string, unknown> = {}): Promise<Mounted> {
  await page.viewport(PANE_W + RAIL_W, PANE_H)
  const m = mount(ConversationPane, paneProps({ record, cwd: '/work', draft: DRAFT, ...over }), {
    width: PANE_W,
    height: PANE_H,
  })
  await nextTick()
  await drawnReady()
  return m
}

const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

const stopAndSendTitle = (m: Mounted): string | null =>
  m.q('interrupt-send-prompt').getAttribute('title')

const keyHints = (foot: HTMLElement): string[] => [...foot.querySelectorAll('strong')].map(text)

describe('§1 · a running Codex conversation with a draft: Stop and send says the turn is asked to stop', () => {
  it('🔴 the button’s title and the foot say it in R43’s words, the host’s limit in each — the foot drawn whole at the composer’s width', async () => {
    const m = await pane(conversation([started, asked, working]))
    expect(visible(m.q('interrupt-send-prompt'))).toBe(true)
    expect(visible(m.q('queue-prompt'))).toBe(true)
    expect(m.all('interrupt-session')).toEqual([])
    expect((m.q('prompt-input') as HTMLTextAreaElement).value).toBe(DRAFT)

    expect(stopAndSendTitle(m)).toBe(TITLE)
    const foot = m.q('composer-hint')
    expect(text(foot)).toBe(`${SEND_KEY} to send after ${WHO} ${FOOT_TAIL}`)
    expect(text(foot)).not.toContain(THE_LIMIT)
    expect(keyHints(foot)).toEqual([SEND_KEY, INTERRUPT_KEY])
    expect(visible(foot)).toBe(true)
    assertDrawn(foot, 'the busy foot with a draft, in R43’s words', m.host)

    const { asks, sent } = await theClauses()
    expect(asks).toBe(`the turn is ${ASKED_TO_STOP}`)
    expect(sent).toBe(`${asks}; this is sent once it has ended`)
    expect(sent).toBe(STOP_THEN_SENT)
    expect(stopAndSendTitle(m)).toBe(`Stop and send — ${sent} (${INTERRUPT_KEY})`)
    expect(text(foot)).toBe(
      `${SEND_KEY} to send after ${WHO} finishes · ${INTERRUPT_KEY} is Stop and send: ${sent}`,
    )
  })

  it('⚑ THE CONTROL — the same conversation with NO draft: the plain Stop, titled as `737` left it, and no pair', async () => {
    const m = await pane(conversation([started, asked, working]), { draft: '' })
    expect(m.all('interrupt-send-prompt')).toEqual([])
    expect(m.all('queue-prompt')).toEqual([])
    expect(m.q('interrupt-session').getAttribute('title')).toBe(PLAIN_STOP_TITLE)
    expect(text(m.q('composer-hint'))).not.toContain('Stop and send')
  })
})

describe('§2 · with a message already waiting, the foot queues behind it and still says ⇧⌘↵ asks', () => {
  it('🔴 whoever wrote what waits: queue behind it, then Stop and send, limit and all — drawn whole', async () => {
    for (const notYours of [false, true]) {
      const m = await pane(holding(notYours))
      expect(m.all('queued-entry')).toHaveLength(1)
      const foot = m.q('composer-hint')
      expect(text(foot)).toBe(FOOT_WAITING)
      expect(text(foot)).not.toContain(THE_LIMIT)
      expect(text(foot)).not.toContain('Cancel it')
      expect(keyHints(foot)).toEqual([SEND_KEY, INTERRUPT_KEY])
      assertDrawn(foot, `the foot with a message waiting (not yours: ${String(notYours)})`, m.host)
      expect(stopAndSendTitle(m)).toBe(TITLE)
      const { sent } = await theClauses()
      expect(text(foot).endsWith(`is Stop and send: ${sent}`)).toBe(true)
      unmountAll()
    }
  })
})

describe('§3 · beside the drawer — the narrowest the composer is drawn at', () => {
  it('🔴 the foot with a draft — the limit in it — is still drawn whole', async () => {
    const m = await pane(conversation([started, asked, working]), { drawerOpen: true })
    expect(visible(m.q('session-drawer'))).toBe(true)
    const foot = m.q('composer-hint')
    expect(text(foot)).toBe(`${SEND_KEY} to send after ${WHO} ${FOOT_TAIL}`)
    expect(visible(foot)).toBe(true)
    assertDrawn(foot, 'the busy foot with a draft, beside the drawer', m.host)
  })

  it('🔴 the longer of the two feet — a message already waiting, the limit in it — is still drawn whole', async () => {
    const m = await pane(holding(true), { drawerOpen: true })
    expect(visible(m.q('session-drawer'))).toBe(true)
    const foot = m.q('composer-hint')
    expect(text(foot)).toBe(FOOT_WAITING)
    expect(visible(foot)).toBe(true)
    assertDrawn(foot, 'the waiting foot beside the drawer', m.host)
  })
})

describe('§4 · the press is unchanged — only its words moved', () => {
  it('⚑ THE CONTROL — one send with intent `interrupt` per click and per ⇧⌘↵, the draft’s words each time; ⌘↵ alone queues', async () => {
    const sends: { text: string; intent: string }[] = []
    const m = await pane(conversation([started, asked, working]), {
      onSend: (words: string, intent: string) => sends.push({ text: words, intent }),
    })
    m.q('interrupt-send-prompt').click()
    await nextTick()
    await drawnReady()
    expect(sends).toEqual([{ text: DRAFT, intent: 'interrupt' }])

    const box = m.q('prompt-input')
    const chord = (shiftKey: boolean): void => {
      box.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          metaKey: true,
          shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      )
    }
    chord(true)
    await nextTick()
    await drawnReady()
    expect(sends).toEqual([
      { text: DRAFT, intent: 'interrupt' },
      { text: DRAFT, intent: 'interrupt' },
    ])

    chord(false)
    await nextTick()
    await drawnReady()
    expect(sends.map((each) => each.intent)).toEqual(['interrupt', 'interrupt', 'queue'])
  })
})
