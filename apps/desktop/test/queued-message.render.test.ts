import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import {
  applyEvent,
  createTranscript,
  type QueuedItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import { isVisibleIn } from '../src/renderer/src/lib/transcript-mode'
import { acceptLiveness, createSessionRecord } from '../src/renderer/src/lib/session-record'
import QueuedMessage from '../src/renderer/src/components/QueuedMessage.vue'

/**
 * The transcript half of 077: a message that has not been sent must be visible, must be visibly
 * NOT sent, and must never be lost.
 *
 * ⚠️ These are SSR renders — no DOM, no clicks. So every negative assertion is paired with a
 * positive one (086): `not.toContain('user-message')` proves nothing on its own, because it also
 * passes against a component that rendered nothing at all.
 */

const render = (item: QueuedItem & { at: number }): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(QueuedMessage as never, { item }) }))

/**
 * ⚑ **688 · a held row carries its NAME**, as every row main has written since `354` does — the
 * `messageId` a *Cancel it* takes back by. ⛔ A row with no name (a ledger before `354`) offers no
 * *Cancel it* since `688`, because main's mailbox never holds such a message and the old fallback
 * took back a different one; that case is `who-wrote-it-and-which-task.dom.test.ts` §1's.
 */
const queued = (over: Partial<QueuedItem> = {}): QueuedItem & { at: number } => ({
  kind: 'queued',
  id: 'queued_1',
  text: 'do this next',
  outcome: null,
  messageId: 'msg_1',
  at: 1_700_000_000_000,
  ...over,
})

function fold(events: Parameters<typeof applyEvent>[1][]): TranscriptState {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state
}

const kinds = (state: TranscriptState): string[] => state.items.map((item) => item.kind)

describe('the fold: a queued message is not a turn', () => {
  it('shows it as its own kind, never as a user bubble', () => {
    const state = fold([{ type: 'message_queued', text: 'do this next' }])

    expect(kinds(state)).toEqual(['queued'])
    // ⚠️ The whole rule in one line: *"the transcript must not show a message as sent before it
    // was."* A `user` item here would be a message claiming to have been sent.
    expect(kinds(state)).not.toContain('user')
    expect(state.items[0]).toMatchObject({ text: 'do this next', outcome: null })
  })

  it('when it is finally SENT, the placeholder goes and the real turn takes its place', () => {
    const state = fold([
      { type: 'message_queued', text: 'do this next' },
      { type: 'message_unqueued', reason: 'sent', text: 'do this next' },
      { type: 'user_turn', text: 'do this next' },
    ])

    // Exactly one bubble, and it is the sent one — the same text must never be on screen twice.
    expect(kinds(state)).toEqual(['user'])
    expect(state.items[0]).toMatchObject({ kind: 'user', text: 'do this next' })
  })

  it('a cancelled message STAYS, marked — vanishing would be indistinguishable from sending', () => {
    const state = fold([
      { type: 'message_queued', text: 'never mind' },
      { type: 'message_unqueued', reason: 'cancelled', text: 'never mind' },
    ])

    expect(kinds(state)).toEqual(['queued'])
    expect(state.items[0]).toMatchObject({ outcome: 'cancelled', text: 'never mind' })
  })

  it('an abandoned message stays too, and is never re-labelled as a cancellation', () => {
    const state = fold([
      { type: 'message_queued', text: 'this never went' },
      { type: 'message_unqueued', reason: 'abandoned', text: 'this never went' },
    ])

    expect(state.items[0]).toMatchObject({ outcome: 'abandoned' })
    // Nobody chose this ending; saying "you cancelled it" would blame the user for the app's.
    expect(state.items[0]).not.toMatchObject({ outcome: 'cancelled' })
  })

  it('an ending with no beginning still shows the message — the paged-window case (054)', () => {
    // A reader can legitimately be looking at a page that contains the `message_unqueued` and not
    // the `message_queued` above it. The event carries the text precisely so this is recoverable.
    const state = fold([
      { type: 'message_unqueued', reason: 'abandoned', text: 'written, never sent' },
    ])

    expect(kinds(state)).toEqual(['queued'])
    expect(state.items[0]).toMatchObject({ outcome: 'abandoned', text: 'written, never sent' })
  })

  it('resolves the last of TWO STILL-UNRESOLVED messages, not the older orphan', () => {
    // ⚠️ **Two unresolved queued messages in one ledger is reachable, which is why the scan runs
    // backwards.** The host allows only one at a time, but nothing can write the resolving event if
    // the process dies between queueing and teardown — a SIGKILL leaves a `message_queued` with no
    // ending in the ledger permanently. Replay it, queue something new, and there are two.
    //
    // A forward scan would then resolve the ORPHAN: the stale message would be marked sent and the
    // live one would sit unresolved forever, offering to cancel something already gone. Found by a
    // surviving mutant — the first version of this test put a RESOLVED item first, where scanning
    // either way finds the same thing and the direction is untested.
    const state = fold([
      { type: 'message_queued', text: 'orphaned by a crash' },
      { type: 'message_queued', text: 'the live one' },
      { type: 'message_unqueued', reason: 'sent', text: 'the live one' },
      { type: 'user_turn', text: 'the live one' },
    ])

    expect(kinds(state)).toEqual(['queued', 'user'])
    // The orphan is untouched and still says it was never sent, which is the truth about it.
    expect(state.items[0]).toMatchObject({ text: 'orphaned by a crash', outcome: null })
    expect(state.items[1]).toMatchObject({ kind: 'user', text: 'the live one' })
  })

  it('resolves the last unresolved one, leaving settled messages alone', () => {
    const state = fold([
      { type: 'message_queued', text: 'first' },
      { type: 'message_unqueued', reason: 'cancelled', text: 'first' },
      { type: 'message_queued', text: 'second' },
      { type: 'message_unqueued', reason: 'sent', text: 'second' },
      { type: 'user_turn', text: 'second' },
    ])

    // The first stays cancelled; the second became a turn. A fold that resolved the FIRST match
    // would have marked the cancelled one as sent and left the live one waiting forever.
    expect(kinds(state)).toEqual(['queued', 'user'])
    expect(state.items[0]).toMatchObject({ text: 'first', outcome: 'cancelled' })
    expect(state.items[1]).toMatchObject({ kind: 'user', text: 'second' })
  })
})

describe('the fold: a queued message survives the modes', () => {
  it('is shown in NORMAL mode — hiding it would hide a message the user wrote', () => {
    const item = queued()
    expect(isVisibleIn('normal', item)).toBe(true)
    expect(isVisibleIn('debug', item)).toBe(true)
  })
})

describe('the liveness fold carries the queue, EMPTY included', () => {
  const liveness = { state: 'live', since: 0 } as const

  const record = () => {
    const r = createSessionRecord('sess_1')
    r.meta = {
      sessionId: 'sess_1',
      provider: 'claude',
      cwd: '/work',
      providerHome: '/homes/claude',
      profileId: 'default',
      // 158: told nothing extra — the shape every fixture that is not about instructions wants.
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
      ref: null,
      config: {
        home: '/homes/claude',
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      },
      approvalMode: 'ask',
      pendingApprovalMode: null,
      approvalNote: 'approvals: ask',
      blanketGrants: [],
      planNeedsGoAhead: false,
      settings: {
        model: null,
        pendingModel: null,
        reasoningEffort: null,
        pendingReasoningEffort: null,
        planMode: false,
        pendingPlanMode: null,
      },
      queued: [],
      liveness,
      hasACommander: false,
      // 523 · a conversation a window started: it is not handed back, it is ended.
      startedWithoutAWindow: false,
      mayHandItBack: false,
    }
    return r
  }

  it('applies a newly queued message', () => {
    const r = record()
    acceptLiveness(r, {
      ...liveness,
      queued: [{ id: 'msg_a', kind: 'work', text: 'waiting on you', since: 5 }],
    })
    expect(r.meta?.queued).toMatchObject([{ text: 'waiting on you' }])
  })

  it('applies the EMPTY list when the queue empties — the update a truthiness test would swallow', () => {
    // ⚠️ This is the assertion the whole `!== undefined` guard exists for. ⛔ **`394` made the
    // empty value `[]` rather than `null`, and that is what makes the guard MORE necessary rather
    // than less**: `null` is at least falsy in the same way `undefined` is, while `[]` is truthy —
    // so a `if (liveness.queued)` written today would look like it worked, apply the empty list, and
    // then swallow the genuinely-absent case instead. Both are asserted here.
    const r = record()
    acceptLiveness(r, {
      ...liveness,
      queued: [{ id: 'msg_a', kind: 'work', text: 'waiting on you', since: 5 }],
    })
    acceptLiveness(r, { ...liveness, queued: [] })
    expect(r.meta?.queued).toEqual([])
  })

  it('leaves the current value alone when the field is genuinely ABSENT', () => {
    // A liveness message published before the session was described carries none of these; absence
    // must not be read as "the queue emptied".
    const r = record()
    acceptLiveness(r, {
      ...liveness,
      queued: [{ id: 'msg_a', kind: 'work', text: 'still waiting', since: 5 }],
    })
    acceptLiveness(r, { ...liveness })
    expect(r.meta?.queued).toMatchObject([{ text: 'still waiting' }])
  })

  it('🔴 394 · keeps the mailbox in ORDER, and a question waits beside the work', () => {
    // ⛔ **Order is a fact** (`394` §5). The wire carries delivery order, so a surface reading the
    // head is reading what goes next — and `RuntimeScreen`'s Cancel names that one.
    const r = record()
    acceptLiveness(r, {
      ...liveness,
      queued: [
        { id: 'msg_a', kind: 'work', text: 'do this next', since: 5 },
        { id: 'msg_b', kind: 'question', text: 'sess_2 is waiting on an answer', since: 7 },
      ],
    })
    expect(r.meta?.queued?.map((one) => [one.id, one.kind])).toEqual([
      ['msg_a', 'work'],
      ['msg_b', 'question'],
    ])
  })
})

describe('the bubble says it has not been sent', () => {
  it('while waiting: says so, and offers to take it back', async () => {
    const html = await render(queued())

    expect(html).toContain('data-cy="queued-entry"')
    expect(html).toContain('do this next')
    expect(html).toContain('not sent')
    expect(html).toContain('waiting for the turn to end')
    expect(html).toContain('data-cy="cancel-queued"')
    // ⚠️ Paired with the positives above: it must not be mistakable for a sent turn. `user-message`
    // is the bubble that means "this went to the agent".
    expect(html).not.toContain('data-cy="user-message"')
  })

  it('once cancelled: no longer offers a cancel, offers the text back instead', async () => {
    const html = await render(queued({ outcome: 'cancelled' }))

    expect(html).toContain('you cancelled it')
    expect(html).toContain('data-cy="restore-queued"')
    // The one that would do nothing is gone rather than disabled: there is nothing left to cancel.
    expect(html).not.toContain('data-cy="cancel-queued"')
  })

  it('once abandoned: names the conversation ending, not a choice the user made', async () => {
    const html = await render(queued({ outcome: 'abandoned' }))

    expect(html).toContain('the conversation ended first')
    expect(html).toContain('data-cy="restore-queued"')
    expect(html).not.toContain('you cancelled it')
  })

  it('the body is EXACTLY the text — no time, no label bleeding into it (001)', async () => {
    const html = await render(queued({ text: 'PINGPONG' }))

    // The same trap 001 hit on the user bubble: a timestamp rendered inside the body turned
    // "PINGPONG" into "PINGPONG00:55" for anything that read the message's text content.
    const body = html
      .match(/data-cy="queued-message"[^>]*>([\s\S]*?)<\/div>/)?.[1]
      ?.replace(/<!--[\s\S]*?-->/g, '')
      .trim()
    expect(body).toBe('PINGPONG')
  })
})
