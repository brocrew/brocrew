import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '@brobot2/runtime'

import { describeEvent } from '../src/renderer/src/lib/describe-event'
import {
  NOTHING_WAITS_FOR_THIS_ANSWER,
  applyEvent,
  createTranscript,
  isAwaitingAnswer,
  markReopened,
  markRequestFailed,
  markUserInputAnswered,
  type AssistantItem,
  type NoticeItem,
  type PermissionItem,
  type SubAgentCard,
  type ToolItem,
  type TranscriptState,
  type UserInputItem,
} from './lib/core-transcript'
import { feed, permissionRequest, ref } from './helpers/transcript-fold-fixtures'

/**
 * One Claude assistant message that mixes text and tool blocks now normalizes to MULTIPLE
 * `assistant_message` events around the `tool_call` (058, fixing 044 P3). The fold must render
 * that faithfully — every text run present exactly once, in order — because the deltas streamed
 * ALL of the message's text into a single open block before the authoritative events arrived.
 */
describe('transcript fold — mixed text/tool message (044 P3)', () => {
  it('renders [text, tool, text] in order with no duplicated or dropped text', () => {
    // The realistic stream: deltas carry every text run into ONE open block ("BEFOREAFTER"),
    // then the authoritative, source-ordered events land.
    const state = feed(
      createTranscript(),
      { type: 'assistant_delta', text: 'BEFORE' },
      { type: 'assistant_delta', text: 'AFTER' },
      { type: 'assistant_message', text: 'BEFORE' },
      { type: 'tool_call', id: 'tu_1', name: 'Bash', summary: 'echo hi' },
      { type: 'assistant_message', text: 'AFTER' },
    )

    expect(state.items.map((i) => i.kind)).toEqual(['assistant', 'tool', 'assistant'])
    // The first block is REPLACED by its authoritative run — the streamed 'AFTER' does not linger.
    expect(state.items[0]).toMatchObject({ kind: 'assistant', text: 'BEFORE', streaming: false })
    expect(state.items[1]).toMatchObject({ kind: 'tool', callId: 'tu_1' })
    expect(state.items[2]).toMatchObject({ kind: 'assistant', text: 'AFTER', streaming: false })
    expect(state.streamingId).toBeNull()

    // No text is duplicated across the fold, and nothing is lost.
    const rendered = state.items
      .filter((i): i is AssistantItem => i.kind === 'assistant')
      .map((i) => i.text)
    expect(rendered).toEqual(['BEFORE', 'AFTER'])
  })

  it('a tool result still correlates to its call when assistant text follows the call', () => {
    const state = feed(
      createTranscript(),
      { type: 'assistant_message', text: 'BEFORE' },
      { type: 'tool_call', id: 'tu_1', name: 'Bash', summary: 'echo hi' },
      { type: 'assistant_message', text: 'AFTER' },
      { type: 'tool_result', id: 'tu_1', summary: 'hi', ok: true },
    )

    const tool = state.items.find((i): i is ToolItem => i.kind === 'tool')
    expect(tool?.result).toMatchObject({ summary: 'hi', ok: true })
    expect(state.items.map((i) => i.kind)).toEqual(['assistant', 'tool', 'assistant'])
  })
})

/**
 * Claude partial-stream frames are now surfaced as classified `unknown` events instead of being
 * dropped (063). The fold must keep rendering the streamed text exactly once: the structural
 * frames arrive INTERLEAVED with the text deltas, so they must not split, duplicate, or close the
 * live assistant block.
 */
describe('transcript fold — interleaved Claude stream frames (060 P2)', () => {
  it('renders the streamed text exactly once despite classified frames between deltas', () => {
    const chatter = (category: 'lifecycle' | 'reasoning' | 'activity'): RuntimeEvent => ({
      type: 'unknown',
      provider: 'claude',
      category,
      raw: { frame: category },
    })

    const state = feed(
      createTranscript(),
      chatter('lifecycle'), // message_start
      chatter('lifecycle'), // content_block_start
      { type: 'assistant_delta', text: 'Hel' },
      chatter('reasoning'), // thinking_delta mid-stream
      { type: 'assistant_delta', text: 'lo' },
      chatter('lifecycle'), // content_block_stop
      { type: 'assistant_message', text: 'Hello' },
      chatter('lifecycle'), // message_stop
    )

    const assistants = state.items.filter((i): i is AssistantItem => i.kind === 'assistant')
    expect(assistants).toHaveLength(1) // ONE block, not one per frame boundary
    expect(assistants[0]).toMatchObject({ text: 'Hello', streaming: false })
    // The chatter is present (lossless) and quiet — it never became assistant text.
    expect(state.items.filter((i) => i.kind === 'unknown')).toHaveLength(5)
    expect(state.streamingId).toBeNull()
  })
})

/**
 * Codex warnings now arrive as NON-FATAL `error` events (065). The fold must make them visible
 * without ending the session — that distinction is the whole point of routing them here rather
 * than leaving them as quiet chatter.
 */
describe('transcript fold — non-fatal errors are visible but not terminal (065)', () => {
  it('a warning renders a visible `warn` notice and leaves the session usable', () => {
    const state = feed(
      createTranscript(),
      { type: 'assistant_delta', text: 'working' },
      { type: 'error', message: 'guardianWarning: sandbox escape attempt', fatal: false },
    )

    const notices = state.items.filter((i): i is NoticeItem => i.kind === 'notice')
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ level: 'warn' })
    expect(notices[0]?.text).toContain('guardianWarning')
    // NOT terminal: the live assistant block is untouched and the session is still going.
    expect(state.streamingId).not.toBeNull()
  })

  it('only a FATAL error terminalizes — the contrast that makes the warning routing safe', () => {
    const warned = feed(createTranscript(), {
      type: 'error',
      message: 'configWarning: bad key',
      fatal: false,
    })
    const fatal = feed(createTranscript(), {
      type: 'error',
      message: 'provider died',
      fatal: true,
    })

    const levels = (s: TranscriptState) =>
      s.items.filter((i): i is NoticeItem => i.kind === 'notice').map((i) => i.level)
    expect(levels(warned)).toEqual(['warn'])
    expect(levels(fatal)).toEqual(['error'])
    // Many warnings in a row still never end the session.
    const many = createTranscript()
    for (let i = 0; i < 5; i++) {
      applyEvent(many, { type: 'error', message: `warning: ${i}`, fatal: false })
    }
    expect(many.items.filter((i) => i.kind === 'notice')).toHaveLength(5)
  })
})

/**
 * A streamed run interrupted by a tool must not be rendered twice (068, fixing 066 F5). The deltas
 * are provisional; the authoritative `assistant_message` is the truth. Because a `tool_call` closes
 * the streaming block, the message could no longer find it and appended a second copy.
 */
describe('transcript fold — a tool-interrupted streamed run is reconciled, not duplicated (066 F5)', () => {
  it("the reviewer's probe: delta 'AFTER' → tool_call → message 'AFTER' renders [tool, assistant]", () => {
    const state = feed(
      createTranscript(),
      { type: 'assistant_delta', text: 'AFTER' },
      { type: 'tool_call', id: 'tu_1', name: 'Bash', summary: 'ls' },
      { type: 'assistant_message', text: 'AFTER' },
    )

    expect(state.items.map((i) => i.kind)).toEqual(['tool', 'assistant'])
    const assistants = state.items.filter((i): i is AssistantItem => i.kind === 'assistant')
    expect(assistants.map((i) => i.text)).toEqual(['AFTER']) // exactly once
  })

  it('a streamed run left unconfirmed when the TURN ends is kept, not deleted by a later turn', () => {
    // Nothing may retroactively remove a finished turn's rendering.
    const state = feed(
      createTranscript(),
      { type: 'assistant_delta', text: 'turn one text' },
      { type: 'turn', state: 'completed' },
      { type: 'tool_call', id: 'tu_2', name: 'Bash', summary: 'ls' },
      { type: 'assistant_message', text: 'turn two text' },
    )
    expect(
      state.items.filter((i): i is AssistantItem => i.kind === 'assistant').map((i) => i.text),
    ).toEqual(['turn one text', 'turn two text'])
  })
})

/**
 * The neutral `label` (072): the adapter stamps the provider's own kind string, and the renderer
 * shows it WITHOUT knowing where it came from. The kind lives at a different path inside `raw` per
 * provider, so reading it in the renderer would force a Codex/Claude branch — the exact
 * provider-agnosticism this field exists to preserve.
 */
describe('transcript fold — the neutral unknown label (072)', () => {
  it('carries the label through to the item, from either provider, unchanged', () => {
    const state = feed(
      createTranscript(),
      {
        type: 'unknown',
        provider: 'codex',
        category: 'lifecycle',
        label: 'thread/compacted',
        raw: {},
      },
      {
        type: 'unknown',
        provider: 'claude',
        category: 'reasoning',
        label: 'thinking_delta',
        raw: {},
      },
    )
    expect(state.items.map((i) => (i.kind === 'unknown' ? i.label : null))).toEqual([
      'thread/compacted',
      'thinking_delta',
    ])
    // The fold does not interpret it — same field, same value, whichever provider sent it.
    expect(state.items.every((i) => i.kind === 'unknown' && i.category !== 'unrecognized')).toBe(
      true,
    )
  })

  it('degrades cleanly when the adapter had no kind to name', () => {
    const state = feed(createTranscript(), {
      type: 'unknown',
      provider: 'codex',
      category: 'activity',
      raw: {},
    })
    const item = state.items[0]
    expect(item?.kind === 'unknown' && item.label).toBeUndefined()
  })
})

describe('describeEvent — the neutral unknown label (072)', () => {
  it('shows `provider · label`, and the provider alone when there is no label', () => {
    expect(
      describeEvent({
        type: 'unknown',
        provider: 'codex',
        category: 'lifecycle',
        label: 'thread/compacted',
        raw: {},
      }),
    ).toBe('codex · thread/compacted')
    expect(
      describeEvent({ type: 'unknown', provider: 'claude', category: 'activity', raw: {} }),
    ).toBe('claude')
  })
})

/**
 * A question that outlived the thing that asked it (085).
 *
 * A resumed conversation must clear its old `ended` latch so the next close settles current
 * question cards. Otherwise `markTerminal` returns early and a three-question card remains
 * answerable after its provider request map has died, yielding `user-input request number:0
 * is not pending (already answered, settled, or unknown)` twice on screen.
 *
 * ⚠️ **084 located this in the wrong branch**, and reproducing rather than trusting the location is
 * what found it: it named the `turn` fold's missing `settlePending`, which is real and is fixed
 * here too, but it is not what bit him. The latch would have gone on silently swallowing every
 * subsequent ending in any conversation that had ever been resumed.
 */
describe('transcript fold — a card cannot outlive the turn or the session (085)', () => {
  const question: RuntimeEvent = {
    type: 'user_input_request',
    id: 'number:0',
    prompt: 'Which theme?',
    questions: [
      {
        id: 'ui_theme',
        prompt: 'Which theme?',
        options: [{ label: 'Midnight' }, { label: 'Daylight' }],
      },
    ],
  }
  const card = (state: TranscriptState): UserInputItem =>
    state.items.find((item): item is UserInputItem => item.kind === 'userInput')!

  it('the SECOND ending in a resumed conversation still settles — the latch is cleared', () => {
    const state = feed(
      createTranscript(),
      { type: 'session', state: 'started', ref },
      // A first life that ends. Nothing is pending, so this settles nothing — it only latches.
      { type: 'session', state: 'ended', ref },
      { type: 'status', state: 'ended' },
    )
    expect(state.ended, 'the first ending is real and must stick while it lasts').toBe(true)

    // …and a resume, which is the event that says the latch no longer describes anything.
    feed(state, { type: 'session', state: 'resumed', ref })
    expect(state.ended, 'a session that says it is open again is not over').toBe(false)

    feed(state, question)
    expect(isAwaitingAnswer(card(state)), 'positive: the card really is live first').toBe(true)

    feed(state, { type: 'session', state: 'ended', ref })
    expect(card(state).note).toBe(NOTHING_WAITS_FOR_THIS_ANSWER)
    expect(isAwaitingAnswer(card(state))).toBe(false)
  })

  it('the latch was the defect: without a resume the fold is unchanged', () => {
    // The guard still does its original job — `session:'ended'` and `status:'ended'` announce ONE
    // ending, and the second must not re-settle a card the first already spoke for. Pinned so the
    // fix above cannot be mistaken for removing the guard.
    const state = feed(createTranscript(), { type: 'session', state: 'started', ref }, question, {
      type: 'session',
      state: 'ended',
      ref,
    })
    expect(card(state).note).toBe(NOTHING_WAITS_FOR_THIS_ANSWER)
    // ⚠️ **D-017b** — a close and a failure say one sentence now, so the note cannot show the second
    // half re-settling; the answered-state below is what still would.
    feed(state, { type: 'status', state: 'errored' })
    expect(card(state).note, 'the second half of one ending changes nothing').toBe(
      NOTHING_WAITS_FOR_THIS_ANSWER,
    )
    expect(isAwaitingAnswer(card(state))).toBe(false)
  })

  it.each([
    ['interrupted' as const, 'settled when the turn was interrupted'],
    ['failed' as const, 'settled when the turn failed'],
    ['completed' as const, 'settled when the turn ended'],
  ])('a turn that %s says so on the card it killed', (turnState, expected) => {
    const state = feed(
      createTranscript(),
      { type: 'session', state: 'started', ref },
      question,
      permissionRequest('req_1'),
    )
    const permission = state.items.find(
      (item): item is PermissionItem => item.kind === 'permission',
    )!
    expect(isAwaitingAnswer(card(state)) && isAwaitingAnswer(permission)).toBe(true)

    feed(state, { type: 'turn', state: turnState })
    expect(card(state).note).toBe(expected)
    expect(permission.note, 'both kinds of card, one rule').toBe(expected)
    expect(card(state).answered, 'settled is NOT answered — nobody decided anything').toBeNull()
    expect(permission.outcome).toBeNull()
  })

  it('stays in the transcript, and an ANSWERED card is not relabelled by the turn ending', () => {
    const state = feed(createTranscript(), { type: 'session', state: 'started', ref }, question)
    markUserInputAnswered(state, 'number:0', 'answered')
    const cards = (s: TranscriptState): number =>
      s.items.filter((item) => item.kind === 'userInput').length
    expect(cards(state), 'positive: there is a card to keep').toBe(1)
    feed(state, { type: 'turn', state: 'interrupted' })
    // 063's rule in the other direction: the question does not vanish, it goes quiet visibly.
    // Counted by KIND rather than by total length, because the turn pushes its own notice too — a
    // total-length assertion would have been pinning the notice, not the card. Found by running it.
    expect(cards(state), 'nothing is removed').toBe(1)
    expect(card(state).answered).toBe('answered')
    expect(card(state).note, 'a decision that WAS made is not overwritten by teardown').toBeNull()
  })

  it('a resumed conversation does not hand back live buttons for a dead request', async () => {
    // ⚠️ **Found by review, and it is the same defect one door along.** A ledger that ends MID-TURN
    // — the app was quit, or died, while a question was on screen — has no `turn` and no
    // `session:'ended'` to settle anything, so the replay rebuilds the card with its buttons intact.
    // The adapter behind them is new and has never heard of the id, so pressing one is refused.
    // `markReadOnly` has always settled for exactly this reason; `markReopened` did not.
    const state = feed(createTranscript(), { type: 'session', state: 'started', ref }, question)
    expect(isAwaitingAnswer(card(state)), 'positive: it really was live before the resume').toBe(
      true,
    )

    markReopened(state)
    expect(card(state).note).toBe('settled when this conversation was last open')
    expect(isAwaitingAnswer(card(state))).toBe(false)
    // …and the conversation itself is open again, which is the whole point of `markReopened`.
    expect(state.ended).toBe(false)
  })

  it('a provider withdrawal does not relabel an ending that already named itself', () => {
    // ⚠️ Found by review. `request_resolved` wrote its note unconditionally, which was invisible
    // until 085 gave the `turn` fold something to write first. An adapter that withdraws its
    // requests during teardown emits both, in that order — and the vaguer sentence was winning.
    const state = feed(createTranscript(), { type: 'session', state: 'started', ref }, question, {
      type: 'turn',
      state: 'interrupted',
    })
    expect(card(state).note, 'positive: the turn named its own ending').toBe(
      'settled when the turn was interrupted',
    )
    feed(state, { type: 'request_resolved', id: 'number:0' })
    expect(card(state).note).toBe('settled when the turn was interrupted')

    // …and where nothing has spoken yet, the withdrawal still says its piece (051 unbroken).
    const fresh = feed(createTranscript(), { type: 'session', state: 'started', ref }, question, {
      type: 'request_resolved',
      id: 'number:0',
    })
    expect(fresh.items.find((i): i is UserInputItem => i.kind === 'userInput')!.note).toBe(
      'withdrawn by the provider',
    )
  })

  it('the first reason wins, so a real refusal is not overwritten by a later ending', () => {
    const state = feed(createTranscript(), { type: 'session', state: 'started', ref }, question)
    markRequestFailed(state, 'number:0', 'answering this failed: the host refused the response')
    feed(state, { type: 'turn', state: 'interrupted' }, { type: 'session', state: 'ended', ref })
    expect(card(state).note).toBe('answering this failed: the host refused the response')
  })
})

/**
 * 110 · Two rejected credentials, two different things to do about them.
 *
 * ⛔ **This is the branch 098 built the `cause` field for, and until now nothing tested it at all** —
 * the fold's `auth` arm shipped with no coverage, so `auth_stale` arriving beside it could have
 * fallen through to the raw provider text and no assertion would have moved.
 *
 * A session can be refused while the machine login remains healthy: a measured session
 * authenticated 22 seconds later. The notice must distinguish that condition from needing
 * another sign-in, which would discard five hours without fixing the cause.
 */
describe('transcript fold — a rejected credential says which remedy (110)', () => {
  const CLAUDE_TEXT = 'Failed to authenticate. API Error: 401 OAuth access token has been revoked.'

  const noticeOf = (state: TranscriptState): NoticeItem => {
    const notices = state.items.filter((i): i is NoticeItem => i.kind === 'notice')
    if (notices.length !== 1) throw new Error(`expected one notice, got ${notices.length}`)
    return notices[0] as NoticeItem
  }

  it('a cause-less error still shows the provider’s message — the fall-through that must survive', () => {
    // The `default` arm. Without this, routing both causes could quietly swallow every OTHER error.
    const notice = noticeOf(
      feed(createTranscript(), { type: 'error', message: 'disk full', fatal: false }),
    )
    expect(notice.text).toBe('disk full')
    expect(notice.level).toBe('warn')
  })

  it('the transcript is over, and its open cards are settled', () => {
    // ⚠️ The whole reason the error is `fatal` rather than a visible warning: a card left
    // answerable on a session that cannot take an answer is what 085 traced a request key to.
    const state = feed(createTranscript(), permissionRequest('req_1'), {
      type: 'error',
      message: CLAUDE_TEXT,
      fatal: true,
      cause: 'auth_stale',
    })
    expect(state.ended).toBe(true)
    const card = state.items.find((i): i is PermissionItem => i.kind === 'permission')
    // The EXACT reason, as every sibling test in this file pins it (review): `toBeTruthy()` would
    // have accepted any note at all. ⚑ **D-017b** — a failure and a close say ONE sentence now.
    expect(card?.note).toBe(NOTHING_WAITS_FOR_THIS_ANSWER)
    // …and the paired positive: the same card is still live when nothing has ended.
    const open = feed(createTranscript(), permissionRequest('req_2'))
    expect(open.items.find((i): i is PermissionItem => i.kind === 'permission')?.note).toBeNull()
  })
})

describe('transcript fold — a voice with an owner (128)', () => {
  /**
   * Use two children in one turn, only one forwarding prose. Forwarding produces six loose
   * top-level turns wearing the parent’s voice, or about 42 in a seven-agent fan-out. Keep
   * the measured event order `dispatch → started → says → tool → says` to check authorship
   * across that path.
   */
  const dispatch = (callId: string, title: string): RuntimeEvent => ({
    type: 'tool_call',
    id: callId,
    name: 'Agent',
    summary: title,
  })

  const started = (agentId: string, parentToolCallId: string): RuntimeEvent => ({
    type: 'sub_agent',
    agentId,
    phase: 'started',
    parentToolCallId,
    kind: 'general-purpose',
    title: 'audit the workspace',
  })

  const says = (text: string, parentToolCallId?: string): RuntimeEvent => ({
    type: 'assistant_message',
    text,
    ...(parentToolCallId ? { parentToolCallId } : {}),
  })

  const cardOn = (state: TranscriptState, callId: string): SubAgentCard | undefined => {
    const tool = state.items.find(
      (item): item is ToolItem => item.kind === 'tool' && item.callId === callId,
    )
    return tool?.subAgents?.[0]
  }

  const spoken = (state: TranscriptState): string[] =>
    state.items.flatMap((item) => (item.kind === 'assistant' ? [item.text] : []))

  it('a FAN-OUT adds no top-level turns at all — four children talking at once (078)', () => {
    // 078's rule, applied to speech: N agents must add N cards, never N turns. The parent speaks
    // twice here and the four children speak three times EACH, so the difference between the two
    // readings is 12 rows against 0.
    const kids = ['one', 'two', 'three', 'four']
    const state = feed(
      createTranscript(),
      says('[MAIN] Fanning out.'),
      ...kids.flatMap((k) => [dispatch(`toolu_${k}`, k), started(`agent_${k}`, `toolu_${k}`)]),
      ...[1, 2, 3].flatMap((round) =>
        kids.map((k) => says(`[${k.toUpperCase()}] round ${round}`, `toolu_${k}`)),
      ),
      says('[MAIN] All back.'),
    )

    expect(spoken(state), 'the parent still owns the conversation').toEqual([
      '[MAIN] Fanning out.',
      '[MAIN] All back.',
    ])
    // …and every one of the twelve sentences is somewhere, on the card of the child that said it.
    for (const k of kids) {
      expect(
        cardOn(state, `toolu_${k}`)?.body.map((row) =>
          row.kind === 'prose' ? row.text : row.name,
        ),
      ).toEqual([
        `[${k.toUpperCase()}] round 1`,
        `[${k.toUpperCase()}] round 2`,
        `[${k.toUpperCase()}] round 3`,
      ])
    }
    // The count 078 is about, stated as a ratio rather than a constant: four talking children cost
    // the transcript exactly what the parent's own two turns cost it, and nothing more.
    expect(spoken(state)).toHaveLength(2)
  })

  it('keeps the child’s words and its work in SOURCE ORDER (058)', () => {
    // 044 P3's defect, one component in: text before a tool must stay before it, and text after it
    // must stay a SECOND run rather than being merged into the first.
    const state = feed(
      createTranscript(),
      dispatch('toolu_bg', 'audit'),
      started('a1', 'toolu_bg'),
      says('before', 'toolu_bg'),
      {
        type: 'tool_call',
        id: 'child_1',
        name: 'Bash',
        summary: 'ls',
        parentToolCallId: 'toolu_bg',
      },
      says('after', 'toolu_bg'),
      {
        type: 'tool_result',
        id: 'child_1',
        summary: 'notes.txt',
        ok: true,
        parentToolCallId: 'toolu_bg',
      },
    )
    expect(
      cardOn(state, 'toolu_bg')?.body.map((row) =>
        row.kind === 'prose' ? `says:${row.text}` : `${row.name}:${row.result?.summary ?? '…'}`,
      ),
    ).toEqual(['says:before', 'Bash:notes.txt', 'says:after'])
  })

  it("never overwrites the PARENT's open streamed block with a child's message", () => {
    // ⛔ **A live defect this routing removes, not merely a case it handles.** `assistant_message`
    // reconciles against `state.streamingId` — so before 128 a child's forwarded message reaching
    // that code would have found the parent's half-written block and replaced its text with the
    // child's, one turn's words silently becoming another's.
    //
    // ⚠️ **The delta comes AFTER the dispatch, and that ordering is what makes this reachable.** A
    // `tool_call` closes the open block (`closeStreaming`), so the parent cannot still be mid-word
    // from before the dispatch — but a BACKGROUND child keeps talking while the parent writes its
    // next sentence, which is exactly what `sess_6b4380fa` recorded, and then the two overlap.
    const state = feed(
      createTranscript(),
      dispatch('toolu_bg', 'audit'),
      started('a1', 'toolu_bg'),
      { type: 'assistant_delta', text: '[MAIN] Still writ' },
      says('[GAPS-BG] done', 'toolu_bg'),
    )
    expect(spoken(state)).toEqual(['[MAIN] Still writ'])
    const open = state.items.find((item) => item.kind === 'assistant')
    expect(open?.kind === 'assistant' && open.streaming, 'the parent is still mid-sentence').toBe(
      true,
    )
    expect(state.streamingId, 'and the child did not close it').not.toBeNull()
  })

  it('speaks in the conversation when there is no card to own it — the honest fallback', () => {
    // Same rule the unclaimed tool call follows (029): an id naming a card that has not arrived is
    // not a reason to swallow what was said. It renders — and since 131 it renders REMEMBERING
    // whose it is, so the window is one a card can close rather than a permanent misattribution.
    const state = feed(createTranscript(), says('[GAPS-BG] early', 'toolu_unknown'))
    expect(spoken(state)).toEqual(['[GAPS-BG] early'])
    // ⛔ **The paired positive.** Without this the line above passes over a fold that dropped the
    // owner on the floor — which is exactly what 128 did, and why nothing could reclaim it.
    const loose = state.items.find((item) => item.kind === 'assistant')
    expect(loose?.kind === 'assistant' && loose.parentToolCallId).toBe('toolu_unknown')
  })

  it("⛔ an unresolved owner does not overwrite the PARENT's open block — both premises, ONE fixture (131)", () => {
    // ⚑ **130's reproducer, by event order.** 128 said this defect was removed and it was not: the
    // routing returned only on a `cardFor` HIT, so a miss fell through to the reconciler below it
    // and ran `open.text = event.text` on the parent's half-written turn. `cardFor` cannot find a
    // card that does not exist yet, and the child speaking BEFORE its `sub_agent` is the ordinary
    // background shape — the one `sess_6b4380fa` recorded.
    //
    // ⛔ **The two premises are held together here on purpose.** 128's tests split them: one made
    // the card before the delta, the other had no parent stream at all. Both passed, while their
    // combined production sequence corrupted the transcript. This fixture is that sequence.
    const state = feed(
      createTranscript(),
      dispatch('toolu_bg', 'audit'),
      { type: 'assistant_delta', text: '[MAIN] Still writ' },
      says('[GAPS-BG] early', 'toolu_bg'),
      started('a1', 'toolu_bg'),
    )

    // The words the parent wrote are the words the parent wrote.
    expect(spoken(state), "the parent's turn is intact and the child's is not in it").toEqual([
      '[MAIN] Still writ',
    ])
    const open = state.items.find((item) => item.kind === 'assistant')
    expect(open?.kind === 'assistant' && open.streaming, 'still mid-sentence').toBe(true)
    expect(state.streamingId, 'and the child did not close it').not.toBeNull()
    // …and the sentence is not lost either: the card took it back the moment it appeared.
    expect(cardOn(state, 'toolu_bg')?.body).toEqual([
      { kind: 'prose', id: expect.stringMatching(/^says_\d+$/), text: '[GAPS-BG] early' },
    ])
  })

  it('reclaims early words INTERLEAVED with early work, in arrival order (131 §4)', () => {
    // 127's altitude rule — *"owned by the child's card, never a loose top-level turn"* — for the
    // window 128 left open. 130 named the cost of closing it: *"two reclaimed sequences have to be
    // interleaved, and neither remembers when it arrived."* They do not have to: `state.items` IS
    // arrival order, so ONE backward walk taking both kinds finds them already interleaved. This is
    // the test that would go red if that walk were ever split into two sweeps.
    const state = feed(
      createTranscript(),
      dispatch('toolu_bg', 'audit'),
      says('[GAPS-BG] before', 'toolu_bg'),
      {
        type: 'tool_call',
        id: 'child_1',
        name: 'Bash',
        summary: 'ls',
        parentToolCallId: 'toolu_bg',
      },
      says('[GAPS-BG] after', 'toolu_bg'),
      started('a1', 'toolu_bg'),
    )
    expect(spoken(state), 'nothing of the child is left in the conversation').toEqual([])
    expect(
      cardOn(state, 'toolu_bg')?.body.map((row) =>
        row.kind === 'prose' ? `says:${row.text}` : row.name,
      ),
    ).toEqual(['says:[GAPS-BG] before', 'Bash', 'says:[GAPS-BG] after'])
  })

  it("⛔ a child's final answer is on the card ONCE, not twice (131 §2)", () => {
    // ⚑ **Measured after 128 shipped**, in `sess_6b4380fa`: ordinal 1776 is the forwarded child
    // message and ordinal 1779 is the terminal summary — 357 characters, byte-for-byte equal. An
    // older run holds the same collision at 3,970. The fold appended one to `body` and copied the
    // other to `summary`, and `SubAgentEntry` renders both, so the answer was drawn twice inside
    // one expanded card.
    const ANSWER = 'The coverage audit found three files with no tests.'
    const state = feed(
      createTranscript(),
      dispatch('toolu_bg', 'audit'),
      started('a1', 'toolu_bg'),
      says('[GAPS-BG] working…', 'toolu_bg'),
      says(ANSWER, 'toolu_bg'),
      {
        type: 'sub_agent',
        agentId: 'a1',
        phase: 'ended',
        parentToolCallId: 'toolu_bg',
        summary: ANSWER,
        outcome: 'completed',
      },
    )
    const card = cardOn(state, 'toolu_bg')
    expect(card?.summary, 'the answer is kept — in the one place the card draws an answer').toBe(
      ANSWER,
    )
    expect(
      card?.body.map((row) => (row.kind === 'prose' ? row.text : row.name)),
      'and the echo of it is gone, while everything else the child said stays',
    ).toEqual(['[GAPS-BG] working…'])
  })

  it('…and a summary with NO matching prose still renders — the paired positive (131 §2)', () => {
    // ⛔ Without this the rule above is satisfiable by dropping every summary. This is the
    // overwhelmingly common case: `forwardSubagentText` is off, so the terminal summary is usually
    // the ONLY thing the child ever says on its card.
    const state = feed(
      createTranscript(),
      dispatch('toolu_bg', 'audit'),
      started('a1', 'toolu_bg'),
      says('[GAPS-BG] working…', 'toolu_bg'),
      {
        type: 'sub_agent',
        agentId: 'a1',
        phase: 'ended',
        parentToolCallId: 'toolu_bg',
        summary: 'Three files have no tests.',
        outcome: 'completed',
      },
    )
    const card = cardOn(state, 'toolu_bg')
    expect(card?.summary).toBe('Three files have no tests.')
    expect(card?.body.map((row) => (row.kind === 'prose' ? row.text : row.name))).toEqual([
      '[GAPS-BG] working…',
    ])
  })

  it('drops the echo in the OTHER order too — the ending first, the words after (131 §2)', () => {
    // The late-card shape: the summary is already on the card when the reclaimed prose arrives. A
    // de-duplication that only ran when the summary landed second would put the answer back twice
    // for exactly the sessions 131 §1 exists to repair.
    const ANSWER = 'Three files have no tests.'
    const state = feed(
      createTranscript(),
      dispatch('toolu_bg', 'audit'),
      says(ANSWER, 'toolu_bg'),
      {
        type: 'sub_agent',
        agentId: 'a1',
        phase: 'ended',
        parentToolCallId: 'toolu_bg',
        summary: ANSWER,
        outcome: 'completed',
      },
    )
    const card = cardOn(state, 'toolu_bg')
    expect(card?.summary).toBe(ANSWER)
    expect(card?.body, 'reclaimed, then recognised as the same sentence').toEqual([])
  })

  it('keeps a sentence the child genuinely said TWICE with work in between (131 §2)', () => {
    // The negative bound on the rule above: identical text is not by itself an echo. Only the run
    // that repeats the FINAL answer goes; a child that says the same thing before and after a tool
    // said it twice, and the card is the record of what it said.
    const LINE = 'Checking the fixtures.'
    const state = feed(
      createTranscript(),
      dispatch('toolu_bg', 'audit'),
      started('a1', 'toolu_bg'),
      says(LINE, 'toolu_bg'),
      {
        type: 'tool_call',
        id: 'child_1',
        name: 'Bash',
        summary: 'ls',
        parentToolCallId: 'toolu_bg',
      },
      says(LINE, 'toolu_bg'),
      {
        type: 'sub_agent',
        agentId: 'a1',
        phase: 'ended',
        parentToolCallId: 'toolu_bg',
        summary: LINE,
        outcome: 'completed',
      },
    )
    expect(
      cardOn(state, 'toolu_bg')?.body.map((row) =>
        row.kind === 'prose' ? `says:${row.text}` : row.name,
      ),
      'exactly one of the two runs is the echo of the summary',
    ).toEqual([`says:${LINE}`, 'Bash'])
  })

  /**
   * **What text equality alone deletes (137, from 136's review).**
   *
   * ⛔ 136's verdict on the rule 131 shipped, verbatim: *"It has no provenance saying that row was
   * the completion echo, no adjacency requirement, and no memory that an echo has already been
   * removed."* Three deterministic failures follow, and all three are below. ⚠️ **Why no test saw
   * them:** the "said twice" fixture above places both matching rows BEFORE one summary event, so
   * the removal runs exactly once and one row survives by arithmetic rather than by rule.
   *
   * ⛔ **132 measured that this is invisible from outside** — the echo is removed before paint — so
   * the correctness of the whole thing rests on these.
   */
  describe('the echo, and the three things it is not (137)', () => {
    const S = 'Three files have no tests.'
    const ended = (summary: string): RuntimeEvent => ({
      type: 'sub_agent',
      agentId: 'a1',
      phase: 'ended',
      parentToolCallId: 'toolu_bg',
      summary,
      outcome: 'completed',
    })
    const childTool = (id: string): RuntimeEvent => ({
      type: 'tool_call',
      id,
      name: 'Bash',
      summary: 'ls',
      parentToolCallId: 'toolu_bg',
    })
    const rows = (state: TranscriptState): string[] =>
      (cardOn(state, 'toolu_bg')?.body ?? []).map((row) =>
        row.kind === 'prose' ? `says:${row.text}` : row.name,
      )

    it('⛔ (a) removes ONE echo, not every sentence that matches the summary', () => {
      // 136 §3, sequence one — the late-card order, where the ending is already on the card when the
      // child's forwarded words arrive. Each arriving copy was appended and immediately removed, so
      // a child that genuinely said the same thing twice ended up with a card holding a tool and
      // nothing it had said. An echo is ONE event said twice; the second copy is the child speaking.
      const state = feed(
        createTranscript(),
        dispatch('toolu_bg', 'audit'),
        started('a1', 'toolu_bg'),
        ended(S),
        says(S, 'toolu_bg'),
        childTool('child_1'),
        says(S, 'toolu_bg'),
      )

      expect(rows(state)).toEqual(['Bash', `says:${S}`])
      expect(cardOn(state, 'toolu_bg')?.summary, 'and the answer is still the answer').toBe(S)
    })

    it('⛔ (b) does not reach back across the work to move a sentence into the summary', () => {
      // 136 §3, sequence two: *"the displayed sentence is effectively moved from before the work to
      // the terminal summary, corrupting chronology."* The backward scan crossed a tool AND a later,
      // different sentence to delete the earlier one. A sentence with the child's own work after it
      // is not the last thing the child said, so it cannot be the echo of the last thing it said.
      const D = 'Starting with the importer.'
      const state = feed(
        createTranscript(),
        dispatch('toolu_bg', 'audit'),
        started('a1', 'toolu_bg'),
        says(S, 'toolu_bg'),
        childTool('child_1'),
        says(D, 'toolu_bg'),
        ended(S),
      )

      expect(rows(state), 'the child said it before the work, and that is where it stays').toEqual([
        `says:${S}`,
        'Bash',
        `says:${D}`,
      ])
    })

    it('⛔ (c) takes the whole trailing run when the answer arrived in two messages', () => {
      // The failure in the OTHER direction, and the one this function exists to prevent: an answer
      // forwarded as two blocks matched no single row, so both rows AND the summary rendered — the
      // duplicate, in the shape 131 did not test for.
      const B = 'The importer is the worst of them.'
      const state = feed(
        createTranscript(),
        dispatch('toolu_bg', 'audit'),
        started('a1', 'toolu_bg'),
        says(S, 'toolu_bg'),
        says(B, 'toolu_bg'),
        ended(`${S}\n\n${B}`),
      )

      expect(rows(state), 'said once, in the one place the card draws an answer').toEqual([])
      expect(cardOn(state, 'toolu_bg')?.summary).toBe(`${S}\n\n${B}`)
    })

    it('…and leaves a trailing run that is NOT the answer alone — the paired positive', () => {
      // ⛔ Without this, (c) is satisfiable by deleting any run of prose at the end of a card. The
      // rule is that the run IS the answer, not that the answer is long.
      const OTHER = 'I will look at the importer next.'
      const state = feed(
        createTranscript(),
        dispatch('toolu_bg', 'audit'),
        started('a1', 'toolu_bg'),
        says(S, 'toolu_bg'),
        says(OTHER, 'toolu_bg'),
        ended(`${S}\n\nThe importer is the worst of them.`),
      )

      expect(rows(state)).toEqual([`says:${S}`, `says:${OTHER}`])
    })

    it('remembers the ANSWER it took, so a summary that grows may still lose its own echo', () => {
      // Why the memory is the answer rather than a flag. A restated, longer summary is a different
      // sentence, and the card has not de-duplicated THAT one — a single "already done" bit would
      // leave the second echo on screen for the rest of the session.
      const MORE = `${S} The importer is the worst of them.`
      const state = feed(
        createTranscript(),
        dispatch('toolu_bg', 'audit'),
        started('a1', 'toolu_bg'),
        says(S, 'toolu_bg'),
        {
          type: 'sub_agent',
          agentId: 'a1',
          phase: 'progress',
          parentToolCallId: 'toolu_bg',
          summary: S,
        },
        says(MORE, 'toolu_bg'),
        ended(MORE),
      )

      expect(rows(state), 'each answer answered once').toEqual([])
      expect(cardOn(state, 'toolu_bg')?.summary).toBe(MORE)
    })
  })

  it('a run of prose is not a tool row, so nothing marks it unfinished (074)', () => {
    // `stopOpenToolCalls` walks the card body looking for calls with no result. Prose has no result
    // and never will; a sweep that could not tell the two apart would stamp `unfinished` on a
    // sentence — a claim about a process, made about a paragraph.
    const state = feed(
      createTranscript(),
      dispatch('toolu_bg', 'audit'),
      started('a1', 'toolu_bg'),
      says('half a thought', 'toolu_bg'),
      {
        type: 'tool_call',
        id: 'child_1',
        name: 'Bash',
        summary: 'ls',
        parentToolCallId: 'toolu_bg',
      },
      { type: 'turn', state: 'interrupted' },
    )
    const body = cardOn(state, 'toolu_bg')?.body ?? []
    expect(body.map((row) => row.kind)).toEqual(['prose', 'tool'])
    expect(body.every((row) => !('unfinished' in row) || row.kind === 'tool')).toBe(true)
    expect(body[1]?.kind === 'tool' && body[1].unfinished).toBe(true)
  })
})

describe('transcript fold', () => {
  it('correlates a tool result to its call', () => {
    const state = feed(
      createTranscript(),
      { type: 'tool_call', id: 'tool_1', name: 'Bash', summary: 'ls' },
      { type: 'tool_result', id: 'tool_1', summary: '3 files', ok: true },
    )

    expect(state.items).toHaveLength(1)
    expect(state.items[0]).toMatchObject({
      kind: 'tool',
      name: 'Bash',
      result: { summary: '3 files', ok: true },
    })
  })

  it('keeps both ends of a tool call, so how long it took is measured and not invented', () => {
    // The surface shows a duration on every tool row (Slice 2 · 005). A `tool_result` MUTATES the
    // call's item rather than adding one, so without carrying its time here there would be nothing
    // to subtract from — and a rendered "210 ms" would be a number nobody measured.
    const state = createTranscript()
    applyEvent(state, { type: 'tool_call', id: 'tool_1', name: 'Bash', summary: 'ls' }, 1_000)
    applyEvent(state, { type: 'tool_result', id: 'tool_1', summary: '3 files', ok: true }, 1_210)

    const tool = state.items[0] as ToolItem & { at?: number }
    expect(tool.at).toBe(1_000) // the call keeps the time it started
    expect(tool.result?.at).toBe(1_210) // …and the result the time it landed
  })

  it('leaves a result with no call without a duration rather than guessing one', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'tool_result', id: 'tool_9', summary: 'orphan', ok: false }, 5_000)

    const tool = state.items[0] as ToolItem & { at?: number }
    // The item is stamped with when the result arrived; there is no call to measure from, so the
    // pair cannot produce a duration — and the row shows none.
    expect(tool.at).toBe(5_000)
    expect(tool.result?.at).toBe(undefined)
  })

  it('surfaces a result whose call was never seen instead of dropping it', () => {
    const state = feed(createTranscript(), {
      type: 'tool_result',
      id: 'tool_9',
      summary: 'orphan',
      ok: false,
    })

    const tool = state.items[0] as ToolItem
    expect(tool.kind).toBe('tool')
    expect(tool.callId).toBe('tool_9')
    expect(tool.result).toEqual({ summary: 'orphan', ok: false })
  })
})
