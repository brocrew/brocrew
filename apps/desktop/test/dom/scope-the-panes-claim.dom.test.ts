import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import PersonsQueue from '../../src/renderer/src/components/PersonsQueue.vue'
import SessionPanel from '../../src/renderer/src/components/SessionPanel.vue'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import type { AttentionRequest } from '../../src/renderer/src/lib/attention'
import {
  NOTHING_NAMED_THE_WORK,
  chainReading,
  chainSentence,
  escalationChain,
  type HowItWasRaised,
  type LedgerWalk,
  type PersonsDecision,
  type PersonsQuestion,
  type RoutedRequest,
  aPersonsSince,
} from '../../src/shared/questions'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, record, unmountAll, visible } from './harness'

/**
 * 🔴 **602 · the two sentences, where a person actually reads them.**
 *
 * ## ⛔ Why a DOM file and not a render one
 *
 * ⚠️ **Both claims are about what is on the screen at the same moment as something that
 * contradicts it.** `589`'s measurement is a pane whose heading denies a question two lines under
 * the app's own notice saying one was asked, and a queue whose top line promises a card over a row
 * that has none — ⛔ **adjacency is the defect**, and a string assertion in a fold cannot see it.
 *
 * ⚑ **And `593` paid for the other half of this**: a sentence can be present, laid out and
 * invisible (`a-closed-details-keeps-layout-and-paints-nothing`), so every reading here goes
 * through {@link visible} rather than through `innerText` alone.
 */

const NAME = (id: string): string => id.replace('sess_', '')

const ASK_PARENT: TranscriptEvent[] = [
  {
    type: 'work_given',
    piece: 'work_1',
    label: 'W1.1',
    parent: 'work_root',
    givenBy: 'sess_pm',
    title: 'plan the trip',
    brief: 'plan the trip',
  },
  {
    type: 'question_asked',
    requestId: 'req_1',
    piece: 'work_1',
    label: 'W1.1',
    prompt: 'which hotel?',
    questions: [{ id: 'answer', prompt: 'which hotel?', options: [] }],
  } as unknown as TranscriptEvent,
]

function asked(raisedBy: HowItWasRaised): PersonsQuestion {
  const request: RoutedRequest = {
    requestId: 'req_1',
    askedBy: 'sess_trip-planning',
    parent: 'sess_brobot-workspace',
    went: { is: 'the-parent', to: 'the-parent' },
    at: 1_000,
    state: 'open',
    endedAt: null,
    escalatedAt: 31_000,
  }
  const chain = escalationChain(request, () => null)
  return {
    request,
    // ⚑ **611 · when it became a person's** — every row here is escalated.
    aPersonsSince: aPersonsSince(request),
    chain,
    reading: chainReading(chain, NAME),
    sentence: chainSentence(chain, NAME),
    work: [],
    about: NOTHING_NAMED_THE_WORK,
    raisedBy,
    // ⚑ **619 · `602`'s own fixture, the population with nothing to press** — since UI-009 such a
    // row is its own card, which says where its words are.
    offered: null,
    asked: null,
  }
}

const WALK = <Row>(rows: readonly Row[]): LedgerWalk<Row> => ({
  rows,
  walk: 'every-conversation-that-routed',
  ledgers: 1,
  rowsUnread: 0,
})

describe('602 · what the screen says about a question with no card', () => {
  let viewport: { width: number; height: number }

  beforeEach(() => {
    viewport = { width: window.innerWidth, height: window.innerHeight }
  })

  afterEach(async () => {
    unmountAll()
    usePersonsQueue().forget()
    await page.viewport(viewport.width, viewport.height)
  })

  /**
   * 🔴 **The pane, with the notice and the heading on one screen.** ⛔ The heading may not deny
   * that a question was raised while the app's own notice saying one was is six lines above it.
   */
  it('🔴 the notice and the heading are drawn together, and they do not contradict', async () => {
    await page.viewport(420, 300)
    const m = mount(
      SessionPanel,
      { state: record(ASK_PARENT).transcript, mode: 'normal' as const },
      { width: 380, height: 280 },
    )
    await nextTick()
    // The empty-section paragraph and heading are absent, so the panel says nothing that
    // could contradict the notice.
    expect(visible(m.q('session-panel'))).toBe(true)
    expect(m.all('session-panel-empty')).toEqual([])
    // ⛔ **The claim it may not make**, named as the string that shipped.
    expect(m.q('session-panel').innerText).not.toContain('have been raised here')
  })

  /**
   * ⛔ **The queue, both sentences at once.** ⚠️ The top line and the row line are different
   * elements; before `602` they made the same promise twice, and the row's was the one `589`
   * watched a person follow.
   */
  it('⛔ a cardless row sends nobody to a card — neither the row nor the line above it', async () => {
    usePersonsQueue().supply(
      WALK([asked('this-app')]),
      WALK<PersonsDecision>([]),
      {
        held: new Set(['sess_trip-planning']),
        answerable: new Map<string, AttentionRequest>(),
        now: 900_000,
        lastLookAnswered: { questions: true, decisions: true },
        answeredFromHere: new Set<string>(),
      },
      { open: () => {}, takeOver: () => {}, openWork: () => {} } as never,
    )
    await page.viewport(900, 420)
    // ⚑ **`floating: true`, because the header and the top LINE belong to that copy** — see
    // `PersonsQueue.vue`'s own note. ⛔ Mounted directly rather than through `OverlayHost`, so one
    // element carries every sentence this case is about and `innerText` reads them all.
    const m = mount(PersonsQueue as never, { floating: true }, { width: 900, height: 420 })
    await nextTick()
    m.q('persons-queue-toggle').click()
    await nextTick()

    // ⚑ **UI-009 · the row is the question's own card**, and with its words in no conversation
    // this window holds (D-046) it says where they are.
    const said = m.q('question-not-here')
    expect(visible(said)).toBe(true)
    expect(said.innerText).toContain(
      'BroCrew couldn’t find the question’s words. Open the asking conversation to read them.',
    )
    // ⛔ **Nowhere on this card** — not on the row, not above it (UI-009 took that line out), not on
    // a button.
    const queue = m.q('persons-queue')
    expect(visible(queue)).toBe(true)
    expect(queue.innerText).not.toContain('open it to answer')
    expect(queue.innerText).not.toContain('the card is where you answer')
    expect(m.all('persons-queue-line')).toEqual([])
    // ⚑ **The arrival is still offered**, which is the half that was true all along.
    expect(m.q('persons-queue-go-sess_trip-planning:req_1').innerText).toContain('Open')
  })

  /**
   * ⚑ **The paired positive, one fact over.** ⛔ The same row, raised by the provider, still gets
   * both sentences — so the absences above are a fact about the population and not about a hook
   * this component stopped rendering.
   */
  it('⚑ …and a provider-raised row in the same window still says open it to answer', async () => {
    usePersonsQueue().supply(
      WALK([asked('the-provider')]),
      WALK<PersonsDecision>([]),
      {
        held: new Set(['sess_trip-planning']),
        answerable: new Map<string, AttentionRequest>(),
        now: 900_000,
        lastLookAnswered: { questions: true, decisions: true },
        answeredFromHere: new Set<string>(),
      },
      { open: () => {}, takeOver: () => {}, openWork: () => {} } as never,
    )
    await page.viewport(900, 420)
    const m = mount(PersonsQueue as never, { floating: true }, { width: 900, height: 420 })
    await nextTick()
    m.q('persons-queue-toggle').click()
    await nextTick()
    const queue = m.q('persons-queue')
    expect(queue.innerText).toContain('open it to answer')
    // ⚑ **UI-009** — the line above the rows is gone for every population; the row keeps its own.
    expect(m.all('persons-queue-line')).toEqual([])
    expect(m.all('question-card')).toEqual([])
  })
})
