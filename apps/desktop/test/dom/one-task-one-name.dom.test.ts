import { expandAgentCards } from './harness'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import PersonsQueue from '../../src/renderer/src/components/PersonsQueue.vue'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import { useOverlays } from '../../src/renderer/src/lib/overlay-store'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import type { AttentionRequest } from '../../src/renderer/src/lib/attention'
import {
  NOTHING_NAMED_THE_WORK,
  aPersonsSince,
  chainReading,
  chainSentence,
  escalationChain,
  type AboutWork,
  type LedgerWalk,
  type PersonsDecision,
  type PersonsQuestion,
  type RoutedRequest,
  type WorkInHand,
} from '../../src/shared/questions'
import type { StalledWork } from '../../src/shared/stalled-work'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, visible } from './harness'

/**
 * # 🔴 672 §1 · One task, one name — on a real screen
 *
 * ⚑ **Each row read as TEXT where a person reads it, beside a row that must not change** (the
 * dispatch's §4.1). The fold and the census are in `test/one-task-one-name.test.ts`.
 *
 * ⚑ **D-016 · the one name is now the piece's label** (`W1.2`); there is no *Task #N* any more.
 *
 * ⚠️ **`innerText` through {@link visible}**, because a sentence can be laid out and painted
 * nowhere — and the notice arm is drawn in DEBUG mode only (`transcript-mode.ts`: an `info` notice
 * is housekeeping in normal mode), which is the mode a person switches to to read it.
 */

const ev = (event: Record<string, unknown>): TranscriptEvent => event as unknown as TranscriptEvent

afterEach(async () => {
  unmountAll()
  usePersonsQueue().forget()
  useOverlays().overlay.value = null
  await page.viewport(1100, 900)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the transcript — the notice, and held words whose work already arrived
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · the transcript', () => {
  const given = (piece: string, label: string, over: Record<string, unknown> = {}) =>
    ev({
      type: 'work_given',
      piece,
      label,
      parent: 'work_root',
      givenBy: 'sess_ada',
      title: 'Build the world clock page.',
      brief: 'Build the world clock page.',
      ...over,
    })
  /** ⚑ `question_asked` — the row carries its piece's label beside the id, or no label at all. */
  const asked = (requestId: string, piece: string, label?: string) =>
    ev({
      type: 'question_asked',
      requestId,
      piece,
      ...(label === undefined ? {} : { label }),
      prompt: 'Which time zones?',
      questions: [{ id: 'answer', prompt: 'Which time zones?', options: [] }],
    })
  const queued = (messageId: string) =>
    ev({
      type: 'message_queued',
      messageId,
      kind: 'work',
      text: 'Add French and English to the world clock page.',
      relayedFrom: 'sess_ada',
    })

  const view = async (events: readonly TranscriptEvent[]) => {
    const state = createTranscript()
    for (const event of events) applyEvent(state, event)
    await page.viewport(760, 520)
    const m = mount(
      TranscriptView,
      { items: state.items, mode: 'debug', ownAgent: null },
      { width: 720, height: 480 },
    )
    await nextTick()
    return expandAgentCards(m)
  }

  const noticeTexts = (host: HTMLElement): string[] =>
    [...host.querySelectorAll<HTMLElement>('[data-cy="what-the-notice-says"]')]
      .filter(visible)
      .map((el) => el.innerText.trim())

  it('🔴 a question about W1.3 says W1.3 — and a question whose row spells no label does not guess', async () => {
    const m = await view([
      given('work_1', 'W1.3'),
      asked('req_1', 'work_1', 'W1.3'),
      asked('req_2', 'work_9'),
    ])
    const said = noticeTexts(m.host)
    expect(said).toContain('asked about W1.3')
    // ⛔ the old spellings, gone from the screen
    expect(said.some((one) => /asked about #\d/.test(one))).toBe(false)
    expect(said.some((one) => one.includes('Task #'))).toBe(false)
    // ⚑ **the planted control** — a row with no label to spell keeps its own sentence
    expect(said).toContain('asked about a piece of work')
  })

  it('🔴 held words whose work arrived say W1.4 — and words that never went keep their sentence', async () => {
    const m = await view([
      queued('msg_1'),
      given('work_2', 'W1.4', { messageId: 'msg_1' }),
      queued('msg_2'),
      ev({ type: 'message_unqueued', messageId: 'msg_2', reason: 'cancelled', text: 'x' }),
    ])
    const states = m
      .all('queued-state')
      .filter(visible)
      .map((el) => el.innerText.trim())
    expect(states).toContain('on its list as W1.4 · these words go when the turn ends')
    // ⚑ **the planted control** — a cancelled row names no piece and is unchanged
    expect(states).toContain('not sent · you cancelled it')
    expect(states).toHaveLength(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · the person's queue — which work a question is about
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · the person’s queue', () => {
  const NAME = (id: string): string => id.replace('sess_', '')

  const question = (
    requestId: string,
    askedBy: string,
    work: readonly WorkInHand[],
    about: AboutWork,
  ): PersonsQuestion => {
    const request = {
      requestId,
      askedBy,
      parent: 'sess_brobot',
      went: { is: 'the-parent', to: 'the-parent' },
      at: 1_000,
      state: 'open',
      endedAt: null,
      escalatedAt: 31_000,
    } as RoutedRequest
    const chain = escalationChain(request, () => null)
    return {
      request,
      aPersonsSince: aPersonsSince(request),
      chain,
      reading: chainReading(chain, NAME),
      sentence: chainSentence(chain, NAME),
      work,
      about,
      raisedBy: 'this-app',
      offered: null,
      asked: null,
    } as unknown as PersonsQuestion
  }

  const WALK = <Row>(rows: readonly Row[]): LedgerWalk<Row> =>
    ({ rows, walk: 'every-conversation-that-routed', ledgers: 1, rowsUnread: 0 }) as LedgerWalk<Row>

  it('🔴 the row says W1.12 — and a row that names no work says what it always said', async () => {
    const twelve = { label: 'W1.12' }
    usePersonsQueue().supply(
      WALK([
        question('req_1', 'sess_worker-7', [twelve, { label: 'W1.13' }], {
          is: 'the-asker-named-it',
          work: twelve,
        }),
        question('req_2', 'sess_worker-8', [], NOTHING_NAMED_THE_WORK),
      ]),
      WALK<PersonsDecision>([]),
      {
        held: new Set(['sess_worker-7', 'sess_worker-8']),
        answerable: new Map<string, AttentionRequest>(),
        now: 900_000,
        lastLookAnswered: { questions: true, decisions: true },
        answeredFromHere: new Set<string>(),
      },
      { open: () => {}, takeOver: () => {}, openWork: () => {} } as never,
    )
    await page.viewport(900, 700)
    const m = mount(PersonsQueue as never, { floating: true }, { width: 880, height: 680 })
    await nextTick()
    // ⚑ **UI-009 (F052)** — a question this app asked is its card, and the card's head names the
    // piece by its label (*"… asked you · W1.12"*); *"that conversation is working on …"* went.
    const piece = (key: string): HTMLElement | null =>
      m.q(`persons-queue-row-${key}`).querySelector<HTMLElement>('[data-cy="question-piece"]')
    const named = piece('sess_worker-7:req_1')
    expect(named !== null && visible(named)).toBe(true)
    expect(named?.innerText.trim()).toBe('W1.12')
    // ⚑ **the planted control** — nothing named the work, so there is no label to spell
    expect(piece('sess_worker-8:req_2')).toBeNull()
  })
})

describe('§2b · the person’s queue — the stalled band, which the review found still saying *Work #3*', () => {
  it('🔴 the stalled row says W1.3 — the question rows’ spelling, on the same card', async () => {
    const WALK = <Row>(rows: readonly Row[]): LedgerWalk<Row> =>
      ({
        rows,
        walk: 'every-conversation-that-routed',
        ledgers: 1,
        rowsUnread: 0,
      }) as LedgerWalk<Row>
    const stalled = {
      piece: 'work_x',
      label: 'W1.3',
      title: 'Build the world clock page.',
      owner: 'sess_pam',
      ownerName: 'Pam',
      giver: 'sess_ada',
      giverName: 'Ada',
      because: 'turn_ended',
      stalledAt: 1_000,
    } as StalledWork
    usePersonsQueue().supply(
      WALK<PersonsQuestion>([]),
      WALK<PersonsDecision>([]),
      {
        held: new Set<string>(),
        answerable: new Map<string, AttentionRequest>(),
        now: 900_000,
        lastLookAnswered: { questions: true, decisions: true },
        answeredFromHere: new Set<string>(),
      },
      { open: () => {}, takeOver: () => {}, openWork: () => {} } as never,
      undefined,
      { walked: WALK([stalled]), lastLookAnswered: true },
    )
    await page.viewport(900, 700)
    const m = mount(PersonsQueue as never, { floating: true }, { width: 880, height: 680 })
    await nextTick()
    const says = m.q('persons-queue-stall-says-work_x')
    expect(visible(says)).toBe(true)
    expect(says.innerText.trim()).toBe(
      'W1.3 with Pam is not being worked on, and Ada — which gave it out — has not been told.',
    )
    expect(m.q('persons-queue').innerText).not.toContain('Work #')
    expect(m.q('persons-queue').innerText).not.toContain('Task #')
  })
})
