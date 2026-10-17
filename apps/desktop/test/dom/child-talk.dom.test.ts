import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import ChildWorkViewer from '../../src/renderer/src/components/ChildWorkViewer.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type {
  ChildWorkInput,
  ChildSendResult,
  ChildStateResult,
  ChildThreadState,
  ChildWorkResult,
  TranscriptEvent,
} from '../../src/shared/runtime-ipc'
import { mount, paneProps, record, unmountAll } from './harness'

/**
 * # 296 · A child you can talk to — the half SSR cannot reach
 *
 * ⛔ **Everything in this file is a GESTURE or a CLOCK.** `child-talk.render.test.ts` proves the
 * composer is drawn and what it says; only a real browser can press its button, type into it, or let
 * two seconds pass. `169`'s rule is what makes that split matter: a control that LOOKS disabled and
 * acts anyway is the exact defect, and a string assertion cannot tell the two apart.
 *
 * ⚠️ **The timers are real.** These tests wait on the component's own 2 s interval rather than
 * mocking it, because what is being asserted is that the interval exists, fires, and STOPS — and a
 * fake clock would prove the first two about a component that never scheduled anything.
 */

afterEach(unmountAll)

const CHILD = '01a05f65-acd4-7973-a576-10bf559433b9'

const CONVERSATION: TranscriptEvent[] = [
  { type: 'user_turn', text: 'Look around and report.' } as TranscriptEvent,
  { type: 'assistant_message', text: 'Six files, none of them source.' } as TranscriptEvent,
]

const result = (over: Partial<Extract<ChildWorkResult, { ok: true }>> = {}): ChildWorkResult => ({
  ok: true,
  part: 'transcript',
  name: 'rollout.jsonl',
  runId: null,
  taskId: null,
  text: '{"x":1}\n',
  truncated: false,
  bytes: 8,
  entries: CONVERSATION,
  ...over,
})

const idle: ChildThreadState = { status: 'idle', acceptsInput: true, nickname: 'Plato', turns: 1 }
const working: ChildThreadState = { ...idle, status: 'working' }

/** A viewer with the whole channel, and a record of everything that crossed it. */
function viewer(options: {
  state?: () => ChildStateResult
  send?: (text: string) => ChildSendResult
  onRefresh?: () => void
  result?: ChildWorkResult
}): {
  view: ReturnType<typeof mount>
  sent: string[]
  reads: number
  refreshes: number
  counts: () => { reads: number; refreshes: number }
} {
  const sent: string[] = []
  let reads = 0
  let refreshes = 0
  const view = mount(
    ChildWorkViewer,
    {
      result: options.result ?? result(),
      label: 'Plato',
      agent: CHILD,
      onRefresh: () => {
        refreshes += 1
        options.onRefresh?.()
        return Promise.resolve()
      },
      onReadState: () => {
        reads += 1
        return Promise.resolve(options.state?.() ?? { ok: true, state: idle })
      },
      onSend: (_id: string, text: string) => {
        sent.push(text)
        return Promise.resolve(options.send?.(text) ?? { ok: true, turnId: 'tn_1' })
      },
    },
    { width: 900, height: 700 },
  )
  return { view, sent, reads, refreshes, counts: () => ({ reads, refreshes }) }
}

const settle = async (ms = 0): Promise<void> => {
  if (ms > 0) await new Promise((done) => setTimeout(done, ms))
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

const box = (view: ReturnType<typeof mount>): HTMLTextAreaElement =>
  view.host.querySelector('[data-cy=child-talk-input]') as HTMLTextAreaElement
const button = (view: ReturnType<typeof mount>): HTMLButtonElement =>
  view.host.querySelector('[data-cy=child-talk-send]') as HTMLButtonElement
const note = (view: ReturnType<typeof mount>): string =>
  view.host.querySelector('[data-cy=child-talk-note]')?.textContent?.trim() ?? ''

async function type(view: ReturnType<typeof mount>, text: string): Promise<void> {
  const input = box(view)
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
}

describe('296 · the button is dark for exactly the states that refuse', () => {
  it('🔴 a WORKING child: the button will not press, and the click does nothing either', async () => {
    const talk = viewer({ state: () => ({ ok: true, state: working }) })
    await settle(50)
    await type(talk.view, 'are you nearly done?')
    // ⛔ **Both halves, because 223's rule is that they must agree.** A dimmed button that still
    // fires on click is the defect; `disabled` is what makes the keyboard and the mouse reach the
    // same thing, and the click below proves it rather than trusting the attribute.
    expect(button(talk.view).disabled).toBe(true)
    button(talk.view).click()
    await settle()
    expect(talk.sent, 'a click on a disabled Send reached the child').toEqual([])
    // …and the person is told WHICH fact refused them, not merely shown a dark box.
    expect(note(talk.view)).toContain('still working')
  })

  it('⚑ an IDLE child: the button presses and the message goes — the paired positive', async () => {
    const talk = viewer({})
    await settle(50)
    await type(talk.view, 'how did it go?')
    expect(button(talk.view).disabled).toBe(false)
    button(talk.view).click()
    await settle()
    expect(talk.sent).toEqual(['how did it go?'])
    expect(talk.view.host.querySelector('[data-cy=child-talk-sent]')?.textContent).toContain('Sent')
    // ⚠️ **The box is cleared only on the way through.** A sent message must not sit there waiting
    // to be sent twice into a conversation the person is not watching.
    expect(box(talk.view).value).toBe('')
  })

  it('an EMPTY draft cannot be sent to an idle child — the same rule the wire holds', async () => {
    const talk = viewer({})
    await settle(50)
    expect(button(talk.view).disabled, 'nothing typed yet').toBe(true)
    await type(talk.view, '   ')
    expect(button(talk.view).disabled, 'whitespace is not a message').toBe(true)
    await type(talk.view, 'x')
    expect(button(talk.view).disabled, 'and one real character is').toBe(false)
  })

  it('⛔ a refusal from the HOST keeps the draft, because the person still wants to send it', async () => {
    // The race the component cannot close: drawn from a state up to two seconds old, refused by the
    // answer the main process actually got. What the person must not lose is what they typed.
    const talk = viewer({
      state: () => ({ ok: true, state: idle }),
      send: () => ({ ok: false, reason: 'working', state: working }),
    })
    await settle(50)
    await type(talk.view, 'still there?')
    button(talk.view).click()
    await settle()
    expect(talk.sent).toEqual(['still there?'])
    expect(box(talk.view).value, 'a refused message was thrown away').toBe('still there?')
    expect(talk.view.host.querySelector('[data-cy=child-talk-refused]')?.textContent).toContain(
      'still working',
    )
    expect(talk.view.host.querySelector('[data-cy=child-talk-sent]')).toBeNull()
  })
})

describe('296 · the follow', () => {
  it('⚑ re-reads the record on its own, without anybody touching anything', async () => {
    const talk = viewer({})
    await settle(50)
    const first = talk.counts()
    expect(first.refreshes, 'the viewer read once on mount').toBeGreaterThanOrEqual(1)
    // Just past two ticks of the component's own interval.
    await settle(4_500)
    const later = talk.counts()
    expect(later.refreshes, 'the record was not re-read').toBeGreaterThan(first.refreshes)
    expect(later.reads, 'the child was not asked about again').toBeGreaterThan(first.reads)
  })

  it('⛔ and STOPS when the viewer closes — a timer nobody clears is a leak', async () => {
    const talk = viewer({})
    await settle(50)
    await settle(2_500)
    const atClose = talk.counts()
    expect(atClose.refreshes).toBeGreaterThan(1)
    talk.view.unmount()
    await settle(4_500)
    expect(talk.counts().refreshes, 'the interval kept firing after the component was gone').toBe(
      atClose.refreshes,
    )
  })

  it('⚠️ a refusal that cannot change stops the ASKING, and the record is still followed', async () => {
    // ⛔ The distinction that keeps this from being a request every two seconds that cannot produce
    // news: `unsupported` is a fact about the provider and will not move while a window is open, so
    // the state poll stops. The RECORD is still re-read, because a Claude child's file grows whether
    // or not anything can be said to it — which is 296's own correction to its brief.
    const talk = viewer({ state: () => ({ ok: false, reason: 'unsupported' }) })
    await settle(50)
    await settle(4_500)
    const counts = talk.counts()
    expect(counts.reads, 'the unanswerable question was asked more than once').toBe(1)
    expect(counts.refreshes, 'the follow stopped along with the asking').toBeGreaterThan(1)
    expect(note(talk.view)).toContain('cannot be spoken to')
  })

  it('an UNREACHABLE provider is asked again — it is the one refusal that can change', async () => {
    let answers = 0
    const talk = viewer({
      state: () => {
        answers += 1
        return answers > 2 ? { ok: true, state: idle } : { ok: false, reason: 'unreachable' }
      },
    })
    await settle(50)
    expect(note(talk.view)).toContain('did not answer')
    await settle(6_500)
    // It recovered on its own, which is the whole reason this one is not latched.
    expect(note(talk.view)).toContain('idle')
    expect(talk.counts().reads).toBeGreaterThan(2)
  })
})

/**
 * ⛔ **The stale-read guard, and this block exists because a MEASUREMENT said it had to.**
 *
 * `scripts/mutations/296/mutations.py` M15 deletes the guard in `ConversationPane.refreshChildWork`.
 * The table predicted `desktop 1 red`; the row was actually applied and the whole suite stayed
 * GREEN — a survivor, protecting nothing. ⚑ **A row that cannot die is a claim, not a test**, so the
 * coverage is written rather than the prediction corrected.
 *
 * ⚠️ **The guard has two halves and only one is reachable from a mount**: the conversation can change
 * under a refresh (the pane's `record` prop, which `mount` fixes at creation), and the open CHILD can
 * change (a second card, clicked while the first read is in flight). This drives the second, and the
 * `sessionId` half is left to the SSR/host tests — stated rather than implied.
 */
describe('296 · a refresh that lands late must not overwrite a different child', () => {
  const A = 'a1111111111111111'
  const B = 'b2222222222222222'

  const card = (agentId: string, tool: string): TranscriptEvent[] => {
    const base = { type: 'sub_agent', agentId, parentToolCallId: tool }
    return [
      { type: 'tool_call', id: tool, name: 'Task', summary: 'Explore' } as TranscriptEvent,
      {
        ...base,
        phase: 'started',
        kind: 'Explore',
        title: `child ${agentId}`,
      } as unknown as TranscriptEvent,
      {
        ...base,
        phase: 'ended',
        outcome: 'completed',
        summary: 'done',
      } as unknown as TranscriptEvent,
    ]
  }

  const childFor = (agentId: string, text: string): ChildWorkResult => ({
    ok: true,
    part: 'transcript',
    name: `agent-${agentId}.jsonl`,
    runId: null,
    taskId: null,
    text,
    truncated: false,
    bytes: text.length,
    entries: [{ type: 'assistant_message', text } as TranscriptEvent],
  })

  it('⛔ opening a SECOND child while the first is refreshing keeps the second on screen', async () => {
    // One read is held open on purpose: the pane starts A's refresh, the reader opens B, and A's
    // answer then arrives for a child nobody is looking at any more.
    let releaseA: (() => void) | null = null
    const view = mount(
      ConversationPane,
      paneProps({
        record: record([
          { type: 'user_turn', text: 'Dispatch two.' } as TranscriptEvent,
          ...card(A, 'toolu_a'),
          ...card(B, 'toolu_b'),
        ]),
        mode: 'normal',
        debug: false,
        onReadChildWork: async (what: ChildWorkInput): Promise<ChildWorkResult> => {
          if (what.part !== 'transcript') throw new Error('unexpected part')
          if (what.agentId === A && releaseA === null) {
            // The FIRST A read resolves at once (it is the open); later A reads are the refresh.
            return childFor(A, 'ALPHA SAYS HELLO')
          }
          if (what.agentId === A) {
            await new Promise<void>((done) => {
              const prior = releaseA
              releaseA = () => {
                prior?.()
                done()
              }
            })
            return childFor(A, 'ALPHA SAYS HELLO')
          }
          return childFor(B, 'BRAVO SAYS HELLO')
        },
      }),
      { width: 1200, height: 900 },
    )

    const opens = [...view.host.querySelectorAll('[data-cy=subagent-open-transcript]')]
    expect(opens.length, 'the fixture did not produce two openable children').toBe(2)
    opens[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(50)
    expect(view.host.querySelector('[data-cy=child-work-viewer]')?.textContent).toContain('ALPHA')

    // Let the follow start an A refresh, then hold it open and open B on top.
    releaseA = () => {}
    await settle(2_300)
    opens[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(50)
    const showingB = view.host.querySelector('[data-cy=child-work-viewer]')?.textContent ?? ''
    expect(showingB, 'B did not open').toContain('BRAVO')

    // …and now A's held refresh lands.
    releaseA?.()
    await settle(200)
    const after = view.host.querySelector('[data-cy=child-work-viewer]')?.textContent ?? ''
    expect(after, "A's late refresh replaced the child on screen").toContain('BRAVO')
    expect(after).not.toContain('ALPHA')
  })
})

describe('296 · a record with no channel is the pre-296 viewer, exactly', () => {
  it('⛔ no composer, no field, and NOTHING is polled', async () => {
    let refreshes = 0
    const view = mount(
      ChildWorkViewer,
      {
        result: result(),
        label: 'Plato',
        onRefresh: () => {
          refreshes += 1
          return Promise.resolve()
        },
      },
      { width: 900, height: 700 },
    )
    await settle(50)
    // The paired positive first: the viewer really rendered a conversation.
    expect(view.host.querySelectorAll('.entry[data-item]').length).toBeGreaterThan(0)
    expect(view.host.querySelector('[data-cy=child-talk]')).toBeNull()
    expect(view.host.querySelectorAll('textarea').length).toBe(0)
    // ⚠️ `onRefresh` alone still follows — that is the Claude case, and it is deliberate: the record
    // grows for both providers, and only the direction BACK is asymmetric.
    await settle(2_500)
    expect(refreshes).toBeGreaterThan(1)
  })
})
