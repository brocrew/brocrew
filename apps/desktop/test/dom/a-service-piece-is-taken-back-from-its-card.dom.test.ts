import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { TAKE_BACK, takeBackThrough } from '../../src/renderer/src/lib/take-back'
import type { WorkTakenBackByAPerson } from '../../src/shared/piece-called'
import type { AgentIdentity, TranscriptEvent } from '../../src/shared/runtime-ipc'
import type { WorkEdge } from '../../src/shared/who-called-whom'
import { assertDrawn, drawnReady } from './drawn'
import {
  expandAgentCards,
  META,
  mount,
  paneProps,
  record,
  unmountAll,
  visible,
  type Mounted,
} from './harness'

/**
 * A person takes back the piece a service is on, from that piece's card on the giver's page. The
 * press is drawn only while the host says a person may take it back; it asks the door, and the
 * card says what the door answered, in place.
 */

const AT = new Date(2026, 9, 13, 21, 30).getTime()
const SERVICE = 'sess_7b2c1d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e'
const IDS = [
  { id: 'aid:reviewer', slug: 'reviewer', displayName: 'Milo' },
] as unknown as AgentIdentity[]

const INVENTORY = {
  type: 'tool_inventory',
  naming: { prefix: 'mcp__', separator: '__' },
  declared: {
    server: 'brobot',
    tools: [{ name: 'give_work', description: '', parameters: [] }],
  },
  published: null,
} as unknown as TranscriptEvent

const GIVES: TranscriptEvent[] = [
  INVENTORY,
  { type: 'user_turn', text: 'have Milo read it' } as TranscriptEvent,
  {
    type: 'tool_call',
    id: 'c1',
    name: 'mcp__brobot__give_work',
    summary: JSON.stringify({
      definition_of_done: 'A verdict on the piece.',
      profile: 'reviewer',
      title: 'Read the button',
      brief: 'Read the take-back button.',
    }),
  } as TranscriptEvent,
  {
    type: 'tool_result',
    id: 'c1',
    summary: 'W4.554 given to Milo (reviewer); it went to Milo straight away.',
    ok: true,
  } as TranscriptEvent,
]

/** The piece this conversation gave to the service, as the forest reads it. */
const edge = (mayTakeItBack: boolean): WorkEdge => ({
  piece: 'work_554',
  label: 'W4.554',
  title: 'Read the button',
  from: META.sessionId,
  fromIdentity: null,
  to: SERVICE,
  toIdentity: 'reviewer',
  state: 'working',
  givenAt: AT,
  endedAt: null,
  ...(mayTakeItBack ? { aPersonMayTakeItBack: true as const } : {}),
})

function castWith(gave: WorkEdge[]): void {
  const walk = <Row>(rows: Row[], kind: string) =>
    ({ rows, walk: kind, ledgers: rows.length, rowsUnread: 0 }) as never
  useWhoCalledWhom().reading.value = {
    conversation: META.sessionId,
    read: {
      conversation: META.sessionId,
      parent: null,
      children: walk([], 'every-conversation-this-one-spawned'),
      workGivenOut: walk(gave, 'every-conversation-this-one-gave-work-to'),
      workTakenIn: walk([], 'every-piece-of-work-this-one-was-given'),
      readAt: AT,
    },
    answered: true,
    atWork: null,
  }
}

afterEach(async () => {
  unmountAll()
  useWhoCalledWhom().reading.value = null
  await page.viewport(1200, 808)
})

/** The giver's page, with the door answering `answer` for whichever piece it is asked. */
async function pane(
  mayTakeItBack: boolean,
  answer: WorkTakenBackByAPerson = {
    ok: true,
    piece: 'work_554',
    label: 'W4.554',
    askedItsTurnToStop: true,
  },
  door?: (piece: string) => Promise<WorkTakenBackByAPerson>,
): Promise<{ m: Mounted; asked: string[] }> {
  castWith([edge(mayTakeItBack)])
  const asked: string[] = []
  await page.viewport(1200, 808)
  const m = mount(
    ConversationPane,
    paneProps({
      record: record(GIVES),
      identities: IDS,
      held: [],
      // The screen's own path: the door's answer in words, or a throw in the app's sentence.
      onTakeBack: (piece: string) =>
        takeBackThrough(async () => {
          asked.push(piece)
          return door === undefined ? answer : door(piece)
        }),
    }),
    { width: 1200, height: 808 },
  )
  await drawnReady()
  await expandAgentCards(m)
  return { m, asked }
}

const read = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

const press = async (m: Mounted): Promise<void> => {
  m.q('outgoing-take-back').click()
  await nextTick()
  await nextTick()
  await drawnReady()
}

describe('the Take back press on a service’s current piece', () => {
  it('is drawn whole beside the piece while a person may take it back, and not otherwise', async () => {
    const { m } = await pane(true)
    const button = m.q('outgoing-take-back')
    expect(button.tagName).toBe('BUTTON')
    expect(read(button)).toBe(TAKE_BACK)
    expect(visible(button)).toBe(true)
    assertDrawn(button, 'the Take back press')
    expect(m.all('outgoing-taken-back')).toEqual([])
    unmountAll()

    // One fact over: the same piece, with no word from the host that a person may take it back.
    const plain = await pane(false)
    expect(plain.m.all('outgoing-take-back')).toEqual([])
    expect(visible(plain.m.q('outgoing-where'))).toBe(true)
  })

  it('takes the piece back and says so in place, drawn whole', async () => {
    const { m, asked } = await pane(true)
    await press(m)
    expect(asked).toEqual(['work_554'])
    const said = m.q('outgoing-taken-back')
    expect(read(said)).toBe('Taken back; its turn was asked to stop.')
    expect(said.getAttribute('role')).toBe('status')
    assertDrawn(said, 'what the take-back answered')
    unmountAll()

    const quiet = await pane(true, {
      ok: true,
      piece: 'work_554',
      label: 'W4.554',
      askedItsTurnToStop: false,
    })
    await press(quiet.m)
    expect(read(quiet.m.q('outgoing-taken-back'))).toBe('Taken back.')
  })

  it('says each refusal in its own words, in place, drawn whole', async () => {
    const refusals = [
      ['not-a-piece-a-service-is-on', 'Not taken back: the service is no longer on this piece.'],
      [
        'that-conversation-has-not-started',
        'Not taken back: the service is still starting. Try again in a moment.',
      ],
      [
        'that-work-is-being-sent',
        'Not taken back: the brief is still on its way to the service. Try again in a moment.',
      ],
      [
        'a-conversation-with-its-questions-is-starting',
        'Not taken back: a conversation with a question about it is still starting. Try again in a moment.',
      ],
      [
        'its-questions-could-not-all-be-read',
        "Not taken back: its questions couldn't all be read. Try again.",
      ],
    ] as const
    for (const [rail, words] of refusals) {
      const { m, asked } = await pane(true, { ok: false, rail })
      await press(m)
      expect(asked).toEqual(['work_554'])
      const said = m.q('outgoing-taken-back')
      expect(read(said)).toBe(words)
      assertDrawn(said, `the refusal ${rail}`)
      unmountAll()
    }
  })

  it('a second press while the first is on its way sends nothing more', async () => {
    let answer: (value: WorkTakenBackByAPerson) => void = () => {}
    const pending = new Promise<WorkTakenBackByAPerson>((done) => (answer = done))
    const { m, asked } = await pane(true, undefined, () => pending)
    const button = m.q('outgoing-take-back') as HTMLButtonElement
    // Two presses before the window has drawn anything: only the card's own guard stands between.
    button.click()
    button.click()
    await nextTick()
    expect(asked).toEqual(['work_554'])
    expect(button.disabled).toBe(true)
    button.click()
    await nextTick()
    expect(asked).toEqual(['work_554'])

    answer({ ok: true, piece: 'work_554', label: 'W4.554', askedItsTurnToStop: true })
    await nextTick()
    await nextTick()
    await drawnReady()
    expect(read(m.q('outgoing-taken-back'))).toBe('Taken back; its turn was asked to stop.')
    expect(button.disabled).toBe(false)
  })

  it('a refusal the door threw is said in the app’s own sentence, and the press still works', async () => {
    let throwsNext = true
    const { m, asked } = await pane(true, undefined, async () => {
      if (throwsNext) {
        throwsNext = false
        throw new Error(
          "Error invoking remote method 'runtime:command': Error: this app is closing, so nothing more can be taken back",
        )
      }
      return { ok: true, piece: 'work_554', label: 'W4.554', askedItsTurnToStop: false }
    })
    await press(m)
    const said = m.q('outgoing-taken-back')
    expect(read(said)).toBe('this app is closing, so nothing more can be taken back')
    assertDrawn(said, 'the thrown refusal')
    const button = m.q('outgoing-take-back') as HTMLButtonElement
    expect(button.disabled).toBe(false)

    await press(m)
    expect(asked).toEqual(['work_554', 'work_554'])
    expect(read(m.q('outgoing-taken-back'))).toBe('Taken back.')
  })

  it('the press goes when a later reading no longer says a person may take it back; what it said stays', async () => {
    const { m } = await pane(true)
    await press(m)
    expect(visible(m.q('outgoing-take-back'))).toBe(true)

    // The cast is read again after the take-back, and the piece has left the service.
    castWith([edge(false)])
    await nextTick()
    await drawnReady()
    expect(m.all('outgoing-take-back')).toEqual([])
    expect(read(m.q('outgoing-taken-back'))).toBe('Taken back; its turn was asked to stop.')
  })
})
