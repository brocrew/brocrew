import type { SDKAssistantMessageError, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '../src/index'
import {
  claudeConversationReset,
  refAfterReset,
  claudeResultOutcome,
  claudeSessionRef,
  normalizeMessage,
} from '../src/claude/normalize'
import { SubAgentTasks } from '../src/claude/sub-agent-tasks'

// Fixtures only exercise the fields the normalizer reads.
function sdk(message: Record<string, unknown>): SDKMessage {
  return message as unknown as SDKMessage
}

/**
 * FULL frames as the SDK really sends them (068, fixing 066 F6). The first version of these
 * tests used incomplete casts — `{type:'message_start'}` with no `message` — which is exactly the
 * malformed shape the adapter should now reject, so the fixtures were asserting that a malformed
 * frame renders quietly. Faithful doubles: valid frames here, malformed ones probed separately.
 */
const FAITHFUL_FRAMES: Record<string, Record<string, unknown>> = {
  message_start: {
    type: 'message_start',
    message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: 'claude' },
  },
  message_delta: {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    // ⚠️ **The input side is here because a real frame has it** (review finding 1). This fixture is
    // named FAITHFUL and used to carry `{ output_tokens: 7 }` alone, which no observed
    // `message_delta` does — all 141 on this machine carry all three input fields. The old shape
    // also happened to be the exact payload the meter must refuse, so it was a fixture asserting a
    // defect from two directions at once.
    usage: {
      input_tokens: 2,
      cache_creation_input_tokens: 46969,
      cache_read_input_tokens: 0,
      output_tokens: 7,
    },
  },
  message_stop: { type: 'message_stop' },
  content_block_start: {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  },
  content_block_stop: { type: 'content_block_stop', index: 0 },
}

describe('normalizeMessage — Claude → content RuntimeEvents', () => {
  it('assistant text block → assistant_message', () => {
    expect(
      normalizeMessage(
        sdk({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] },
        }),
      ),
    ).toEqual([{ type: 'assistant_message', text: 'hi there' }])
  })

  it('assistant tool_use → tool_call, in SOURCE order relative to text', () => {
    expect(
      normalizeMessage(
        sdk({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'echo hi' } },
              { type: 'text', text: 'running' },
            ],
          },
        }),
      ),
    ).toEqual([
      { type: 'tool_call', id: 'tu_1', name: 'Bash', summary: 'echo hi' },
      { type: 'assistant_message', text: 'running' },
    ])
  })

  it('assistant error → non-fatal error event, IN WORDS (110)', () => {
    // ⚠️ The message changed from `assistant error: rate_limit` — deliberately, and this test is the
    // reason it is worth saying out loud. `rate_limit` is a member of the SDK's `.d.ts` union, and
    // it reached the transcript as itself; 110's rule is that no such symbol does. Everything else
    // about this event is unchanged: still an `error`, still non-fatal, still the last thing.
    expect(
      normalizeMessage(
        sdk({
          type: 'assistant',
          message: { role: 'assistant', content: [] },
          error: 'rate_limit',
        }),
      ),
    ).toEqual([{ type: 'error', message: 'claude is rate-limited', fatal: false }])
  })

  it('stream_event text_delta → assistant_delta; other frames are CLASSIFIED, never dropped (063)', () => {
    // Replaces the old "other stream events dropped" assertion, which pinned the 060 P2 bug as
    // intended behaviour: the adapter asks for partial messages, so discarding them is a loss.
    expect(
      normalizeMessage(
        sdk({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Hel' },
          },
        }),
      ),
    ).toEqual([{ type: 'assistant_delta', text: 'Hel' }])

    const start = sdk({ type: 'stream_event', event: FAITHFUL_FRAMES.message_start })
    expect(normalizeMessage(start)).toEqual([
      // `label` is the neutral KIND, so the UI can name a frame without digging into raw (072).
      {
        type: 'unknown',
        provider: 'claude',
        category: 'lifecycle',
        label: 'message_start',
        raw: start,
        passing: true,
      },
    ])
  })

  it('user tool_result → tool_result with ok from is_error', () => {
    expect(
      normalizeMessage(
        sdk({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'done' }],
          },
        }),
      ),
    ).toEqual([{ type: 'tool_result', id: 'tu_1', summary: 'done', ok: true }])
    expect(
      normalizeMessage(
        sdk({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'tu_2', content: 'x', is_error: true }],
          },
        }),
      )[0],
    ).toMatchObject({ type: 'tool_result', ok: false })
  })

  it('system/init and result emit NO content (lifecycle is machine-owned)', () => {
    // ⚑ **`init` gained exactly ONE event in 247 and it is not content** — it is the empty
    // background-work level, which the SDK requires a consumer to reset to whenever the session's
    // CLI process (re)starts. Asserted by shape rather than loosened to "some events", so a second
    // thing appearing here still fails: the claim is that init is lifecycle, and the reset is the
    // one lifecycle fact this function is the only place able to state.
    expect(
      normalizeMessage(sdk({ type: 'system', subtype: 'init', session_id: 's', cwd: '/x' })),
    ).toEqual([{ type: 'background_work', running: [], source: 'init' }])
    expect(normalizeMessage(sdk({ type: 'result', subtype: 'success', is_error: false }))).toEqual(
      [],
    )
    expect(
      normalizeMessage(sdk({ type: 'result', subtype: 'error_max_turns', is_error: true })),
    ).toEqual([])
  })

  it('unmapped message → unknown carrying raw (never throws)', () => {
    const raw = { type: 'compact_boundary', trigger: 'auto' }
    let events: RuntimeEvent[] = []
    expect(() => {
      events = normalizeMessage(sdk(raw))
    }).not.toThrow()
    expect(events[0]).toMatchObject({ type: 'unknown', provider: 'claude', raw })
  })

  it('thinking_tokens is a COUNT and a redaction, never words (027)', () => {
    // Claude reports how much it thought and never what: 20 of 20 captured `thinking_delta`s
    // carried `thinking:""`, and `Options.thinking` yields a signed-but-empty block. `redacted` is
    // what stops the UI showing an empty box as though the model had been silent.
    const raw = {
      type: 'system',
      subtype: 'thinking_tokens',
      estimated_tokens: 165,
      session_id: 's',
    }
    expect(normalizeMessage(sdk(raw))).toEqual([
      { type: 'thinking', phase: 'delta', redacted: true, tokens: 165 },
      { type: 'activity', phase: 'thinking' },
    ])
  })

  it('a thinking_tokens with no count still reports THAT it thought (027)', () => {
    const raw = { type: 'system', subtype: 'thinking_tokens', session_id: 's' }
    expect(normalizeMessage(sdk(raw))).toEqual([
      { type: 'thinking', phase: 'delta', redacted: true },
      { type: 'activity', phase: 'thinking' },
    ])
  })

  it("status carries BOTH live phases: 'requesting' → waiting, 'compacting' → compacting (097)", () => {
    // `requesting` means a request is in flight with nothing to show yet.
    const requesting = { type: 'system', subtype: 'status', status: 'requesting', session_id: 's' }
    expect(normalizeMessage(sdk(requesting))).toEqual([{ type: 'activity', phase: 'waiting' }])

    // ⚠️ **This assertion is the exact inverse of the one it replaces**, and the reason is a
    // measurement. The old test pinned `status:'compacting'` as chatter because the phase had
    // *"never been observed"*, with `compaction_delta` taken as the real signal instead.
    // `pnpm run probe:compacting` drove a session past its window twice: a
    // genuine auto-compaction each time (`before=211221 after=30747 trigger=auto`), **zero**
    // `compaction_delta` frames, and this frame, verbatim, in both.
    const compacting = { type: 'system', subtype: 'status', status: 'compacting', session_id: 's' }
    expect(normalizeMessage(sdk(compacting))).toEqual([{ type: 'activity', phase: 'compacting' }])

    // The ENDING stays chatter — `compact_boundary` is the durable record and the pill is replaced
    // by whatever comes next. Paired with the two above so "chatter" is a decision about this
    // frame rather than a normalizer that classifies everything.
    const done = {
      type: 'system',
      subtype: 'status',
      status: null,
      compact_result: 'success',
      session_id: 's',
    }
    expect(normalizeMessage(sdk(done))).toEqual([
      { type: 'unknown', provider: 'claude', category: 'activity', label: 'status', raw: done },
    ])

    // …and a status value nobody has ever sent is still not invented into a phase.
    const novel = { type: 'system', subtype: 'status', status: 'reticulating', session_id: 's' }
    expect(normalizeMessage(sdk(novel))).toEqual([
      { type: 'unknown', provider: 'claude', category: 'activity', label: 'status', raw: novel },
    ])
  })

  it('a SUB-AGENT compacting does not put THIS session’s avatar into compacting (097)', () => {
    // ⚠️ Review finding 9: `contextReading` has refused sub-agent frames since 087 for exactly this
    // reason — the pill and the meter describe the conversation on screen, and a dispatched agent
    // filling its own window is not it. The phase was raised without that guard.
    const child = {
      type: 'system',
      subtype: 'status',
      status: 'compacting',
      session_id: 's',
      parent_tool_use_id: 'toolu_dispatch',
    }
    expect(normalizeMessage(sdk(child))).toEqual([
      { type: 'unknown', provider: 'claude', category: 'activity', label: 'status', raw: child },
    ])
    // Paired with the top-level frame, so "no phase" is a fact about the CHILD rather than about a
    // guard that switched the phase off for everyone.
    expect(
      normalizeMessage(
        sdk({ type: 'system', subtype: 'status', status: 'compacting', session_id: 's' }),
      )[0],
    ).toEqual({ type: 'activity', phase: 'compacting' })

    // The same for the second, unobserved source.
    const childDelta = {
      type: 'stream_event',
      parent_tool_use_id: 'toolu_dispatch',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'compaction_delta' } },
    }
    expect(normalizeMessage(sdk(childDelta)).map((e) => e.type)).toEqual(['unknown'])
  })

  it('every non-init system subtype is CLASSIFIED chatter, never `unrecognized` (049)', () => {
    // Real SDK system subtypes. `system` messages were a large share of the `unknown` flood;
    // classifying lets the UI quiet them while `raw` still carries the whole message.
    // `thinking_tokens` and `status:'requesting'` left this list in 027 — they are first-class
    // `thinking`/`activity` now, asserted in their own tests below. What remains is still chatter.
    //
    // `task_started` is the interesting one after 029, and it stays here ON PURPOSE: the payload
    // below carries no `task_id`, and a sub-agent with no identity has nothing to correlate a
    // later phase against. The promotion is CONDITIONAL, unlike 027's and 028's, so the chatter
    // arm is still live and this is the case that proves it.
    //
    // `compact_boundary` left this list in 087 — it is a first-class `compaction` now, asserted
    // just below. Its ABSENCE here is load-bearing: a dead entry would assert that the one durable
    // record of dropped context is still chatter the reading view may hide.
    const bySubtype: Record<string, string> = {
      session_state_changed: 'lifecycle',
      files_persisted: 'lifecycle',
      task_started: 'activity',
      hook_response: 'activity',
      memory_recall: 'activity',
      permission_denied: 'activity',
    }
    for (const [subtype, category] of Object.entries(bySubtype)) {
      const raw = { type: 'system', subtype, session_id: 's' }
      const events = normalizeMessage(sdk(raw))
      expect(events, subtype).toEqual([
        { type: 'unknown', provider: 'claude', category, label: subtype, raw },
      ])
    }
  })

  it('non-content SDK message TYPES are classified too — incl. rate_limit_event (049)', () => {
    // `rate_limit_event` is the real payload that reached a live UI smoke as a PROMINENT card:
    // it is a top-level message type, not a `system` subtype, so it slipped the subtype switch.
    const byType: Record<string, string> = {
      rate_limit_event: 'lifecycle',
      auth_status: 'lifecycle',
      // ⚠️ **`conversation_reset` is still classified here, and since 199 that is only half of what
      // happens to it.** The classified copy is what keeps the verbatim payload in the debug
      // stream; the first-class `conversation_reset` event is raised beside it by the ADAPTER,
      // because a `SessionRef` needs the cwd and rotation this pure normalizer is not given. Both,
      // deliberately — see `claude-runtime.test.ts`'s "a conversation reset moves the ref".
      conversation_reset: 'lifecycle',
      tool_progress: 'activity',
      tool_use_summary: 'activity',
      prompt_suggestion: 'echo',
    }
    for (const [type, category] of Object.entries(byType)) {
      const raw = { type, session_id: 's' }
      expect(normalizeMessage(sdk(raw)), type).toEqual([
        { type: 'unknown', provider: 'claude', category, label: type, raw },
      ])
    }
  })

  it('api_retry is VISIBLE, not quiet chatter — a backoff the user can feel (074)', () => {
    // The live stall: the SDK sleeps between retries and the session just sits on "working".
    // `api_retry` used to classify as quiet `lifecycle`, so the pause had no explanation.
    const [event] = normalizeMessage(
      sdk({
        type: 'system',
        subtype: 'api_retry',
        attempt: 2,
        max_retries: 5,
        retry_delay_ms: 4000,
        error_status: 429,
      }),
    )
    expect(event).toMatchObject({ type: 'error', fatal: false })
    expect(event?.type === 'error' && event.message).toContain('retrying')
    expect(event?.type === 'error' && event.message).toMatch(/attempt 2\/5/)
    expect(event?.type === 'error' && event.message).toMatch(/4s/)
  })

  it('a NOVEL SDK message type stays `unrecognized` (loud), raw preserved (049)', () => {
    const raw = { type: 'something_the_sdk_added_later', payload: { a: 1 } }
    expect(normalizeMessage(sdk(raw))).toEqual([
      {
        type: 'unknown',
        provider: 'claude',
        category: 'unrecognized',
        label: 'something_the_sdk_added_later',
        raw,
      },
    ])
  })
})

describe('claude lifecycle helpers', () => {
  it('claudeSessionRef builds a ref from system/init only', () => {
    expect(
      claudeSessionRef(
        sdk({ type: 'system', subtype: 'init', session_id: 'sess_1', cwd: '/tmp/work' }),
        '/fallback',
        0,
      ),
    ).toEqual({
      provider: 'claude',
      sessionId: 'sess_1',
      cwd: '/tmp/work',
      rotation: 0,
    })
    expect(
      claudeSessionRef(
        sdk({ type: 'assistant', message: { role: 'assistant', content: [] } }),
        '/x',
        0,
      ),
    ).toBeNull()
  })

  /**
   * **`refAfterReset` — where a reset moves the ref, from the init AFTER it** (199's rule, `721`'s
   * source: R75).
   *
   * ⚑ `199` read the destination off the reset's `new_conversation_id`; `715`'s probe measured that id
   * with no transcript, and the init after the reset naming the one that has it. `cwd` and `rotation`
   * are where the conversation stayed, and a resume matches on them (the cwd in `validateInitRef`,
   * the cwd and the rotation in `FakeRuntime.resume`), so a ref that invented either would be one
   * nothing could reopen.
   */
  describe('refAfterReset (199 · 721 R75)', () => {
    const current = {
      provider: 'claude' as const,
      sessionId: 'sess_1',
      cwd: '/tmp/work',
      rotation: 3,
    }

    it('swaps the session id and nothing else', () => {
      expect(refAfterReset(current, 'sess_3')).toEqual({
        provider: 'claude',
        sessionId: 'sess_3',
        cwd: '/tmp/work',
        rotation: 3,
      })
    })

    it('is null before the session has a ref — a defensive answer; the rule lives at the first init (721 M5)', () => {
      expect(refAfterReset(null, 'sess_3')).toBeNull()
    })

    it('is null when the id has not moved, so a re-announcement draws no seam', () => {
      expect(refAfterReset(current, 'sess_1')).toBeNull()
    })

    it('is null for an empty id — an init that names nothing moves nothing', () => {
      expect(refAfterReset(current, '')).toBeNull()
    })
  })

  /**
   * **`claudeConversationReset` — a reset frame, and the conversation it LEFT** (`721`, R75/R76).
   *
   * ⛔ It no longer names a destination: that comes from the init after it. What it reads is the
   * frame's `session_id`, R76's proof that a resume's first reset left the conversation asked for.
   */
  describe('claudeConversationReset (721)', () => {
    const reset = (from: unknown) =>
      sdk({ type: 'conversation_reset', new_conversation_id: 'sess_R', session_id: from })

    it('reads the conversation the reset LEFT, and never the id it named', () => {
      expect(claudeConversationReset(reset('sess_1'))).toEqual({ from: 'sess_1' })
      expect(JSON.stringify(claudeConversationReset(reset('sess_1')))).not.toContain('sess_R')
    })

    it('reads a missing or non-string `session_id` as nothing, never as a proof', () => {
      expect(claudeConversationReset(reset(undefined))).toEqual({ from: '' })
      expect(claudeConversationReset(reset(42))).toEqual({ from: '' })
    })

    it('is null for every other message type', () => {
      expect(
        claudeConversationReset(
          sdk({ type: 'system', subtype: 'init', session_id: 'sess_9', cwd: '/tmp/work' }),
        ),
      ).toBeNull()
    })
  })

  it('claudeResultOutcome maps result subtype to a turn outcome', () => {
    expect(
      claudeResultOutcome(sdk({ type: 'result', subtype: 'success', is_error: false })),
    ).toEqual({ outcome: 'completed' })
    const failed = claudeResultOutcome(
      sdk({ type: 'result', subtype: 'error_max_turns', is_error: true }),
    )
    expect(failed?.outcome).toBe('failed')
    expect(
      claudeResultOutcome(sdk({ type: 'assistant', message: { role: 'assistant', content: [] } })),
    ).toBeNull()
  })
})

describe('normalizeMessage — mixed content blocks keep SOURCE order (044 P3)', () => {
  const assistant = (content: unknown[]) =>
    normalizeMessage(sdk({ type: 'assistant', message: { role: 'assistant', content } }))

  it("the reviewer's probe: [text, tool, text] keeps order and does NOT merge across the tool", () => {
    // Pre-fix: [tool_call, assistant_message 'BEFOREAFTER'] — the tool jumped ahead of the text it
    // followed, and two distinct runs were concatenated into one message.
    expect(
      assistant([
        { type: 'text', text: 'BEFORE' },
        { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'echo hi' } },
        { type: 'text', text: 'AFTER' },
      ]),
    ).toEqual([
      { type: 'assistant_message', text: 'BEFORE' },
      { type: 'tool_call', id: 'tu_1', name: 'Bash', summary: 'echo hi' },
      { type: 'assistant_message', text: 'AFTER' },
    ])
  })

  it('MULTIPLE tools interleaved with text preserve order', () => {
    expect(
      assistant([
        { type: 'text', text: 'first' },
        { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'one' } },
        { type: 'text', text: 'second' },
        { type: 'tool_use', id: 'tu_2', name: 'Read', input: { file_path: '/tmp/a' } },
        { type: 'tool_use', id: 'tu_3', name: 'Bash', input: { command: 'three' } },
        { type: 'text', text: 'third' },
      ]),
    ).toEqual([
      { type: 'assistant_message', text: 'first' },
      { type: 'tool_call', id: 'tu_1', name: 'Bash', summary: 'one' },
      { type: 'assistant_message', text: 'second' },
      { type: 'tool_call', id: 'tu_2', name: 'Read', summary: '/tmp/a' },
      { type: 'tool_call', id: 'tu_3', name: 'Bash', summary: 'three' },
      { type: 'assistant_message', text: 'third' },
    ])
  })

  it('ADJACENT text runs still coalesce into ONE message (the common case is unchanged)', () => {
    expect(
      assistant([
        { type: 'text', text: 'one ' },
        { type: 'text', text: 'two ' },
        { type: 'text', text: 'three' },
      ]),
    ).toEqual([{ type: 'assistant_message', text: 'one two three' }])
  })

  it('a text run leading INTO a tool is flushed before it; a trailing tool emits no empty message', () => {
    expect(
      assistant([
        { type: 'text', text: 'about to run' },
        { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } },
      ]),
    ).toEqual([
      { type: 'assistant_message', text: 'about to run' },
      { type: 'tool_call', id: 'tu_1', name: 'Bash', summary: 'ls' },
    ])
    // Tool-only: no empty assistant_message is fabricated on either side.
    expect(
      assistant([{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } }]),
    ).toEqual([{ type: 'tool_call', id: 'tu_1', name: 'Bash', summary: 'ls' }])
  })

  it('string content (not a block array) still yields exactly one message', () => {
    expect(
      normalizeMessage(
        sdk({ type: 'assistant', message: { role: 'assistant', content: 'plain string' } }),
      ),
    ).toEqual([{ type: 'assistant_message', text: 'plain string' }])
  })

  it('a non-fatal assistant error still comes LAST, after the ordered content', () => {
    expect(
      normalizeMessage(
        sdk({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'hi' },
              { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } },
            ],
          },
          error: 'rate_limit',
        }),
      ),
    ).toEqual([
      { type: 'assistant_message', text: 'hi' },
      { type: 'tool_call', id: 'tu_1', name: 'Bash', summary: 'ls' },
      { type: 'error', message: 'claude is rate-limited', fatal: false },
    ])
  })
})

describe('normalizeMessage — partial stream frames are lossless + classified (060 P2)', () => {
  const frame = (event: unknown) => sdk({ type: 'stream_event', event })
  const one = (event: unknown) => normalizeMessage(frame(event))

  /** Every frame type in the SDK's stream-event union, and the category it must carry. */
  const STRUCTURAL: Record<string, string> = {
    message_start: 'lifecycle',
    message_delta: 'lifecycle',
    message_stop: 'lifecycle',
    content_block_start: 'lifecycle',
    content_block_stop: 'lifecycle',
  }

  /** Every non-text delta kind in the SDK's content-block delta union. */
  const DELTAS: Record<string, string> = {
    thinking_delta: 'reasoning',
    signature_delta: 'lifecycle',
    input_json_delta: 'activity',
    citations_delta: 'activity',
    compaction_delta: 'lifecycle',
  }

  it('covers the SDK unions: 6 stream-event types (5 structural + the delta) and 6 delta kinds', () => {
    expect(Object.keys(STRUCTURAL).length + 1).toBe(6)
    expect(Object.keys(DELTAS).length + 1).toBe(6)
  })

  it('NO valid frame yields [] — every structural frame is classified with raw preserved', () => {
    // The 060 P2 repro: each of these silently disappeared pre-fix.
    //
    // ⚠️ **`toContainEqual`, not `toEqual`, since 087 — and the line under the loop is what keeps
    // that from being a weakening.** The context reading is lifted out of `message_start`/
    // `message_delta` BESIDE the classified frame rather than instead of it, precisely so this
    // losslessness survives; asserting on the whole array would have forced the reading to replace
    // the chatter row, which is the regression 063 exists to prevent. So: the classified
    // `unknown{raw}` must still be there (below), and nothing else may sneak in unclassified (the
    // `filter` after the loop).
    for (const [type, category] of Object.entries(STRUCTURAL)) {
      const event = FAITHFUL_FRAMES[type]!
      const events = one(event)
      expect(events, type).toContainEqual({
        type: 'unknown',
        provider: 'claude',
        category,
        label: type,
        raw: frame(event),
        passing: true,
      })
      // Whatever ELSE a frame produces is a typed event, never a second opinion about the raw.
      expect(
        events.filter((e) => e.type === 'unknown'),
        `${type} produced more than one unknown`,
      ).toHaveLength(1)
      // ⚠️ Keyed off whether the FIXTURE carries usage, not off the frame type (review finding 27).
      // It used to say `type === 'message_delta'`, which quietly encoded a property of
      // `FAITHFUL_FRAMES` — that its `message_start` has no `usage` — into a claim about the frame
      // KIND. Adding usage to that fixture would then have failed this line for the right behaviour.
      const carriesUsage = JSON.stringify(event).includes('"usage"')
      expect(
        events.filter((e) => e.type !== 'unknown').map((e) => e.type),
        `${type} produced an unexpected extra event`,
      ).toEqual(carriesUsage ? ['context_reading'] : [])
    }
  })

  it('thinking_delta is REASONING, not dropped — and its text is preserved in raw', () => {
    const event = {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'let me consider…' },
    }
    const [emitted] = one(event)
    expect(emitted).toMatchObject({ type: 'unknown', provider: 'claude', category: 'reasoning' })
    // A later chat UI can render reasoning richly because the payload survived intact.
    expect(JSON.stringify(emitted)).toContain('let me consider')
  })

  it('every non-text delta kind is classified, none dropped', () => {
    for (const [type, category] of Object.entries(DELTAS)) {
      const event = { type: 'content_block_delta', index: 0, delta: { type } }
      // ⚠️ **The classified frame is asserted WHOLE — payload and all — and its position is
      // asserted too** (097). This used to be `toEqual([one thing])`, which was the strongest
      // possible statement until `compaction_delta` began raising an `activity` beside it. Weakening
      // it to "contains an unknown somewhere" would have given up the losslessness claim to make a
      // test green; instead the extra event is enumerated below, so the total is still exact.
      const emitted = one(event)
      expect(emitted.at(-1), type).toEqual({
        type: 'unknown',
        provider: 'claude',
        category,
        label: type,
        raw: frame(event),
        passing: true,
      })
      // `compaction_delta` is the ONE delta that adds a phase (097); every other kind is the frame
      // and nothing else. Stated as a table lookup so a second one cannot be added silently.
      expect(emitted.slice(0, -1), type).toEqual(
        type === 'compaction_delta' ? [{ type: 'activity', phase: 'compacting' }] : [],
      )
      // …and the SAME frame missing its required `index` is malformed → LOUD, not quiet.
      expect(one({ type: 'content_block_delta', delta: { type } })[0], type).toMatchObject({
        category: 'unrecognized',
      })
    }
  })

  it('a NOVEL frame or delta kind stays LOUD (unrecognized), never quiet-by-default', () => {
    expect(one({ type: 'some_future_frame' })[0]).toMatchObject({ category: 'unrecognized' })
    const novel = one({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'some_future_delta' },
    })[0]
    expect(novel).toMatchObject({ category: 'unrecognized' })
    expect(novel).not.toHaveProperty('passing')
  })

  it('⛔ thinking that carries words is KEPT: no other event holds them, so it is not a passing fragment', () => {
    const thinking = (delta: Record<string, unknown>) =>
      one({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', ...delta } })
    const kept = thinking({ thinking: 'weighing the two options' })
    expect(kept).toEqual([
      {
        type: 'unknown',
        provider: 'claude',
        category: 'reasoning',
        label: 'thinking_delta',
        raw: frame({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'weighing the two options' },
        }),
      },
    ])
    expect(kept[0]).not.toHaveProperty('passing')
    // …and every thinking delta WITHOUT words still passes: empty, absent, or not a string.
    for (const delta of [{ thinking: '' }, {}, { thinking: 7 }, { thinking: null }]) {
      expect(thinking(delta).at(-1), JSON.stringify(delta)).toMatchObject({
        category: 'reasoning',
        passing: true,
      })
    }
    // The words rule is thinking's alone: a signature or tool-input delta that carries text passes.
    for (const type of ['signature_delta', 'input_json_delta']) {
      const emitted = one({
        type: 'content_block_delta',
        index: 0,
        delta: { type, thinking: 'words', signature: 'abc', partial_json: '"x"' },
      })
      expect(emitted.at(-1), type).toMatchObject({ passing: true })
    }
  })

  it('a frame MISSING ITS REQUIRED FIELDS is loud, not quiet chatter (068, F6)', () => {
    // Each of these is a known discriminant with its payload absent — pre-fix every one was filed
    // as quiet `lifecycle`/`activity`, so a truncated or adversarial frame looked routine.
    const INCOMPLETE: Record<string, unknown>[] = [
      { type: 'message_start' }, // no `message`
      { type: 'message_start', message: 'not a record' },
      { type: 'message_delta' }, // no `delta`
      { type: 'content_block_start', index: 0 }, // no `content_block`
      { type: 'content_block_start', content_block: { type: 'text' } }, // no `index`
      { type: 'content_block_stop' }, // no `index`
      { type: 'content_block_delta', delta: { type: 'thinking_delta' } }, // no `index`
    ]
    for (const event of INCOMPLETE) {
      expect(one(event)[0], JSON.stringify(event)).toMatchObject({
        type: 'unknown',
        provider: 'claude',
        category: 'unrecognized',
      })
    }
    // `message_stop` genuinely requires nothing beyond its type — it stays quiet.
    expect(one({ type: 'message_stop' })[0]).toMatchObject({ category: 'lifecycle' })
  })

  it('a MALFORMED frame is surfaced loudly; a well-formed EMPTY text delta stays a no-op', () => {
    for (const event of [42, null, {}, { type: 7 }, { type: 'content_block_delta' }]) {
      expect(one(event)[0], JSON.stringify(event)).toMatchObject({
        type: 'unknown',
        category: 'unrecognized',
      })
    }
    // A text_delta whose text is the wrong type is malformed → surfaced (055's rule)…
    expect(
      one({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 42 } })[0],
    ).toMatchObject({ type: 'unknown', category: 'unrecognized' })
    // …but an intentional empty string is a genuine no-op, not a false `unknown`.
    expect(
      one({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '' } }),
    ).toEqual([])
  })

  it('NO DOUBLE-EMIT: classifying structural frames never produces assistant text', () => {
    // The whole point of the fix is losslessness WITHOUT re-emitting the streamed text: only
    // text_delta may ever yield an assistant_delta.
    const everyFrame = [
      ...Object.keys(STRUCTURAL).map((type) => FAITHFUL_FRAMES[type]!),
      ...Object.keys(DELTAS).map((type) => ({
        type: 'content_block_delta',
        index: 0,
        delta: { type },
      })),
    ]
    const emitted = everyFrame.flatMap((event) => one(event))
    // The claim is about TEXT, so it is stated about text. `every(unknown)` was the proxy for it
    // and stopped being true in 087, when `message_delta`'s usage began yielding a
    // `context_reading` — a number, not a word, and the meter's whole job is to keep it OUT of the
    // transcript. 097 added the second exception for the same shape of reason: `activity` is a pill
    // that is replaced and cleared, never a line in the conversation. Both are enumerated rather
    // than the guard being relaxed to "not text", because the list is what makes a THIRD one show
    // up in a diff.
    expect(
      emitted.every(
        (e) => e.type === 'unknown' || e.type === 'context_reading' || e.type === 'activity',
      ),
    ).toBe(true)
    expect(
      emitted.some((e) => e.type === 'assistant_delta' || e.type === 'assistant_message'),
    ).toBe(false)
    // Non-vacuity: the frames really did produce something, so `every`/`some` above ran over a
    // non-empty array rather than passing over nothing.
    expect(emitted.length).toBeGreaterThanOrEqual(everyFrame.length)
  })
})

describe('rate-limit visibility — only a throttle the user feels (074)', () => {
  const rateLimit = (info: Record<string, unknown>) =>
    normalizeMessage(sdk({ type: 'rate_limit_event', rate_limit_info: info, session_id: 's' }))[0]

  it('a REJECTED rate limit is a visible non-fatal error, naming the limit and its reset', () => {
    const event = rateLimit({
      status: 'rejected',
      rateLimitType: 'seven_day',
      resetsAt: 1800000000,
    })
    expect(event).toMatchObject({ type: 'error', fatal: false })
    expect(event?.type === 'error' && event.message).toContain('rate-limited')
    expect(event?.type === 'error' && event.message).toContain('seven_day')
  })

  it('an allowed_warning is visible too — the signal that arrives BEFORE the wall', () => {
    const event = rateLimit({ status: 'allowed_warning', rateLimitType: 'five_hour' })
    expect(event).toMatchObject({ type: 'error', fatal: false })
    expect(event?.type === 'error' && event.message).toContain('approaching')
  })

  it('⚑ F096 · an allowed_warning says how much of the window is used, when the frame does', () => {
    const said = (info: Record<string, unknown>): string | false => {
      const event = rateLimit({ status: 'allowed_warning', rateLimitType: 'seven_day', ...info })
      return event?.type === 'error' && event.message
    }
    expect(said({ utilization: 0.92, resetsAt: 1_800_000_000 })).toBe(
      'claude is approaching its rate limit (seven_day) — 92% used; resets 2027-01-15T08:00:00.000Z',
    )
    // ⛔ A frame that says no figure says none.
    expect(said({})).toBe('claude is approaching its rate limit (seven_day)')
  })

  it('🔴 586 · the ROUTINE allowed heartbeat is a WALL-ENDING RECORD, and still draws nothing', () => {
    // ⛔ **`074` said *this fires constantly; surfacing every one would drown the signal*, and that
    // is still true and still obeyed** — `provider_limit_clear` produces no transcript item in
    // either mode, exactly as `unknown{lifecycle}` produced none in the reading view.
    // 🔴 **What `HO-080` §1.3 changed is what the LEDGER can be asked.** *"It is the provider
    // stating the thing we are asking about"* — so it stops being untyped chatter and becomes the
    // record `foldProviderLimits` matches against a wall.
    // ⚠️ **The window is carried as the provider spells it**, because it is matched against the
    // `(five_hour)` `readProviderLimit` takes out of this same adapter's own wall sentence.
    expect(rateLimit({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.4 })).toEqual({
      type: 'provider_limit_clear',
      window: 'five_hour',
      source: 'rate_limit_event',
    })
  })

  it('⚑ 586 · …and a provider that named no window says so, rather than guessing one', () => {
    // ⛔ **`''` is *the provider as a whole*** — the same reading `readProviderLimit` gives a wall
    // with no parenthetical, and the widest honest claim a record with no window can make.
    expect(rateLimit({ status: 'allowed', utilization: 0.4 })).toEqual({
      type: 'provider_limit_clear',
      window: '',
      source: 'rate_limit_event',
    })
  })

  it('a malformed or absent rate_limit_info degrades to quiet chatter, never a fabricated throttle', () => {
    expect(normalizeMessage(sdk({ type: 'rate_limit_event', session_id: 's' }))[0]).toMatchObject({
      type: 'unknown',
      category: 'lifecycle',
    })
    expect(rateLimit({ status: 'something_new' })).toMatchObject({ type: 'unknown' })
  })
})

/**
 * **A refusal the user can see** (199, from 192 H6).
 *
 * The defect had no visible symptom at all: `model_refusal_no_fallback` landed in the `'activity'`
 * arm of `systemCategory`, which the reading view drops, and the SDK's other channel does not exist
 * here — `stop_reason` is never read as data and `SDKAssistantMessageError` has no `'refusal'`
 * member. What the reader got was an empty turn and nothing to explain it.
 */
describe('a model refusal is VISIBLE (199)', () => {
  const refusal = (fields: Record<string, unknown>) =>
    normalizeMessage(
      sdk({
        type: 'system',
        subtype: 'model_refusal_no_fallback',
        original_model: 'claude-x',
        request_id: null,
        session_id: 's',
        ...fields,
      }),
    )[0]

  it('carries the structured category AND the explanation, as a non-fatal error', () => {
    const event = refusal({
      api_refusal_category: 'cyber',
      api_refusal_explanation: 'the request asked for working exploit code',
      content: 'the CLI banner nobody needs here',
    })
    expect(event).toMatchObject({ type: 'error', fatal: false })
    const message = event?.type === 'error' ? event.message : ''
    expect(message).toContain('declined')
    // The category is QUOTED rather than mapped to a phrase of ours: the SDK calls it an open
    // string and says new ones ship ahead of schema updates, so a table would print the wrong word
    // for the first category invented after this line.
    expect(message).toContain('cyber')
    expect(message).toContain('the request asked for working exploit code')
    // …and it says the thing the reader is actually confused about: why the turn is empty.
    expect(message).toContain('produced nothing')
  })

  it('falls back to the CLI banner when the structured fields are absent — an older CLI still explains itself', () => {
    const event = refusal({ content: 'I can’t help with that.' })
    const message = event?.type === 'error' ? event.message : ''
    expect(message).toContain('I can’t help with that.')
    // No category, so no empty parentheses where one would have gone.
    expect(message).not.toContain('()')
  })

  it('…and still says SOMETHING when the provider gave nothing at all', () => {
    // `api_refusal_category` and `api_refusal_explanation` are both `string | null` AND documented
    // absent on older CLIs, so "we were told nothing about why" is an ordinary outcome. A refusal
    // with no account of itself is still better than an unexplained empty turn.
    const event = refusal({
      api_refusal_category: null,
      api_refusal_explanation: null,
      content: '',
    })
    expect(event).toMatchObject({ type: 'error', fatal: false })
    expect(event?.type === 'error' ? event.message : '').toBe(
      'claude declined to answer — no fallback model was tried, so this turn produced nothing.',
    )
  })

  it('bounds an unstable explanation so one line stays one line (031)', () => {
    const event = refusal({ api_refusal_explanation: 'x'.repeat(5_000) })
    const message = event?.type === 'error' ? event.message : ''
    expect(message.length).toBeLessThan(400)
    expect(message.endsWith('…')).toBe(true)
  })

  /**
   * ⛔ **The leg that is deliberately NOT surfaced, asserted so the decision is visible rather than
   * an omission.** `model_refusal_fallback` announces a turn RETRIED on a fallback model with the
   * refused partial retracted — and neither half is reachable or expressible here: `fallbackModel`
   * is set nowhere in this repo and `settingSources: []` blocks it being inherited, and
   * `retracted_message_uuids` names wire uuids that `RuntimeEvent` has no field to carry. Surfacing
   * it would announce a retraction the transcript then fails to perform.
   */
  it('the FALLBACK leg stays classified chatter — a retraction we cannot perform is not announced', () => {
    const raw = {
      type: 'system',
      subtype: 'model_refusal_fallback',
      trigger: 'refusal',
      direction: 'retry',
      original_model: 'claude-x',
      fallback_model: 'claude-y',
      request_id: null,
      retracted_message_uuids: ['u1', 'u2'],
      content: 'switched models',
      session_id: 's',
    }
    expect(normalizeMessage(sdk(raw))).toEqual([
      {
        type: 'unknown',
        provider: 'claude',
        category: 'activity',
        label: 'model_refusal_fallback',
        raw,
      },
    ])
  })

  /**
   * ⚠️ **The paired negative (049), and without it the test above proves only that SOMETHING is
   * loud.** Making a refusal visible is worth nothing if it came at the price of making ordinary
   * chatter visible too — that is the noise 049 exists to prevent, and the same file has already
   * had to defend it once for `rate_limit_event`.
   */
  it('…while ordinary recognized activity is still quiet chatter', () => {
    for (const subtype of ['memory_recall', 'hook_response', 'informational', 'notification']) {
      const raw = { type: 'system', subtype, session_id: 's' }
      expect(normalizeMessage(sdk(raw)), subtype).toEqual([
        { type: 'unknown', provider: 'claude', category: 'activity', label: subtype, raw },
      ])
    }
  })

  it('provider follow-ups 1 · a CLI WARNING mid-turn is seen, as Codex’s are — and only a warning', () => {
    const warning = {
      type: 'system',
      subtype: 'informational',
      content: 'Retrying on claude-opus-5-5 — the requested model was refused',
      level: 'warning',
      session_id: 's',
    }
    expect(normalizeMessage(sdk(warning))).toEqual([
      {
        type: 'error',
        message: 'claude warned: Retrying on claude-opus-5-5 — the requested model was refused',
        fatal: false,
      },
    ])
    // The CLI keeps its other levels quiet, and so do we.
    for (const level of ['info', 'notice', 'suggestion']) {
      const raw = { ...warning, level }
      expect(normalizeMessage(sdk(raw)), level).toEqual([
        { type: 'unknown', provider: 'claude', category: 'activity', label: 'informational', raw },
      ])
    }
  })
})

/**
 * An agent the agent dispatched (029), against the payloads the 026 capture actually recorded.
 *
 * Nothing here is invented. `task_started` really does carry the parent's `tool_use_id` while
 * `task_updated` really does not; the usage keys really are `total_tokens`/`tool_uses`/
 * `duration_ms`; and the SDK really does forward a sub-agent's tool blocks into the parent stream
 * with `parent_tool_use_id` set, which is the misattribution this task found.
 */
describe('sub-agents — Claude system events → sub_agent (029)', () => {
  const PARENT = 'toolu_01Vy9DHCo9ANEMehzr8fMTtz'
  const AGENT = 'a018b6340ee11bc0a'

  /**
   * A session registry that has already seen this agent START (035) — which is what makes its later
   * phases legible, since none of them carries the discriminator.
   */
  function startedAgent(): SubAgentTasks {
    const tasks = new SubAgentTasks()
    normalizeMessage(
      sdk({
        type: 'system',
        subtype: 'task_started',
        task_id: AGENT,
        tool_use_id: PARENT,
        description: 'Report working directory',
        subagent_type: 'general-purpose',
        task_type: 'local_agent',
        session_id: 's',
      }),
      tasks,
    )
    return tasks
  }

  it('task_started → started, carrying the parent tool-use that nests it', () => {
    expect(
      normalizeMessage(
        sdk({
          type: 'system',
          subtype: 'task_started',
          task_id: AGENT,
          tool_use_id: PARENT,
          description: 'Report working directory',
          subagent_type: 'general-purpose',
          task_type: 'local_agent',
          prompt: 'Run `pwd` and report the current working directory.',
          session_id: 's',
        }),
      ),
    ).toEqual([
      {
        type: 'sub_agent',
        phase: 'started',
        agentId: AGENT,
        idKind: 'task',
        parentToolCallId: PARENT,
        kind: 'general-purpose',
        title: 'Report working directory',
      },
    ])
  })

  it('task_progress → progress with the tool it is on, and NOT a rewritten title', () => {
    // `description` means something different on this subtype: "Running List directory contents" is
    // what the sub-agent is doing NOW, not what it was asked to do. Writing it into `title` would
    // rewrite the card's heading on every heartbeat, so it is deliberately not mapped.
    const event = normalizeMessage(
      sdk({
        type: 'system',
        subtype: 'task_progress',
        task_id: AGENT,
        tool_use_id: PARENT,
        description: 'Running List directory contents',
        subagent_type: 'Explore',
        usage: { total_tokens: 6997, tool_uses: 1, duration_ms: 7798 },
        last_tool_name: 'Bash',
        session_id: 's',
      }),
    )[0]
    expect(event).toEqual({
      type: 'sub_agent',
      phase: 'progress',
      agentId: AGENT,
      idKind: 'task',
      parentToolCallId: PARENT,
      kind: 'Explore',
      lastTool: 'Bash',
      usage: { tokens: 6997, toolCalls: 1, ms: 7798 },
    })
    expect(event).not.toHaveProperty('title')
  })

  it('BOTH endings map — task_updated (no tool_use_id) and task_notification (with summary)', () => {
    // Deliberate redundancy: whichever arrives ends the card, and a run that produced only one of
    // them still cannot leave a card spinning. `task_updated` genuinely has no `tool_use_id`, which
    // is why parentage is optional and correlation is on `agentId`.
    //
    // Both endings are fed through the session's OWN registry, opened by the `task_started` above,
    // because that is the only thing that can vouch for them (035): neither ending carries a
    // `subagent_type` or a `task_type`, so out of context they are indistinguishable from a Bash
    // call's. The next test pins exactly that.
    const tasks = startedAgent()
    const updated = normalizeMessage(
      sdk({
        type: 'system',
        subtype: 'task_updated',
        task_id: AGENT,
        patch: { status: 'completed', end_time: 1785612563054 },
        session_id: 's',
      }),
      tasks,
    )[0]
    expect(updated).toEqual({
      type: 'sub_agent',
      phase: 'ended',
      agentId: AGENT,
      idKind: 'task',
      outcome: 'completed',
    })
    expect(updated).not.toHaveProperty('parentToolCallId')

    expect(
      normalizeMessage(
        sdk({
          type: 'system',
          subtype: 'task_notification',
          task_id: AGENT,
          tool_use_id: PARENT,
          status: 'completed',
          output_file: '/tmp/x.output',
          summary: '/Users/alex/brobot2-scratch/capture-026',
          usage: { total_tokens: 8944, tool_uses: 0, duration_ms: 2041 },
          session_id: 's',
        }),
        tasks,
      )[0],
    ).toEqual({
      type: 'sub_agent',
      phase: 'ended',
      agentId: AGENT,
      idKind: 'task',
      parentToolCallId: PARENT,
      outcome: 'completed',
      summary: '/Users/alex/brobot2-scratch/capture-026',
      usage: { tokens: 8944, toolCalls: 0, ms: 2041 },
    })
  })

  it('a NON-terminal task_updated does not close the card — it stays chatter', () => {
    // A patch is not necessarily an ending. Closing a card on `{status:'in_progress'}` would report
    // a sub-agent as finished while it is still working, so the unrecognized case falls through to
    // chatter and lets the notification (or the end of the turn) close it honestly.
    for (const patch of [{ status: 'in_progress' }, { end_time: 1 }, {}]) {
      expect(
        normalizeMessage(
          sdk({ type: 'system', subtype: 'task_updated', task_id: AGENT, patch, session_id: 's' }),
        )[0],
        JSON.stringify(patch),
      ).toMatchObject({ type: 'unknown', category: 'activity', label: 'task_updated' })
    }
  })

  it('an ending with an UNRECOGNIZED status ends the card without accusing it of failing', () => {
    // "We were not told how it went" is a different fact from "it failed", and rounding the first
    // to the second would put a red card on screen for a sub-agent that may well have succeeded.
    const event = normalizeMessage(
      sdk({
        type: 'system',
        subtype: 'task_notification',
        task_id: AGENT,
        status: 'something_new',
        session_id: 's',
      }),
      startedAgent(),
    )[0]
    expect(event).toMatchObject({ type: 'sub_agent', phase: 'ended' })
    expect(event).not.toHaveProperty('outcome')
  })

  it('a task event with NO task_id has no identity, so it stays chatter', () => {
    // Correlation is the whole mechanism: a card that can never be found again could never be
    // updated or ended, so it is better not to open one.
    expect(
      normalizeMessage(sdk({ type: 'system', subtype: 'task_progress', session_id: 's' }))[0],
    ).toMatchObject({ type: 'unknown', category: 'activity', label: 'task_progress' })
  })

  it("attributes a SUB-AGENT's tool call to it, instead of to the parent that dispatched it", () => {
    // The live misattribution. `forwardSubagentText` is OFF and these blocks arrive anyway — the
    // SDK forwards a sub-agent's tool_use/tool_result by default — so before 029 the child's Bash
    // rendered in the parent conversation as the parent's own work.
    expect(
      normalizeMessage(
        sdk({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'child_1', name: 'Bash', input: { command: 'ls' } }],
          },
          parent_tool_use_id: PARENT,
          session_id: 's',
        }),
      ),
    ).toEqual([
      { type: 'tool_call', id: 'child_1', name: 'Bash', summary: 'ls', parentToolCallId: PARENT },
    ])

    expect(
      normalizeMessage(
        sdk({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'child_1', content: 'notes.txt' }],
          },
          parent_tool_use_id: PARENT,
          session_id: 's',
        }),
      ),
    ).toEqual([
      {
        type: 'tool_result',
        id: 'child_1',
        summary: 'notes.txt',
        ok: true,
        parentToolCallId: PARENT,
      },
    ])
  })

  it("attributes a SUB-AGENT's WORDS to it too — the half 029 left behind (128)", () => {
    // A background child can publish six text-only messages. Its transcript has `[text]` at
    // record 3 and `[tool_use(Bash)]` separately at record 4, so parent attribution cannot
    // depend on a tool block. Assert that the text envelope itself carries the parent.
    expect(
      normalizeMessage(
        sdk({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: '[GAPS-BG] Starting the coverage audit.' }],
          },
          parent_tool_use_id: PARENT,
          session_id: 's',
        }),
      ),
    ).toEqual([
      {
        type: 'assistant_message',
        text: '[GAPS-BG] Starting the coverage audit.',
        parentToolCallId: PARENT,
      },
    ])

    // ⛔ **The paired positive, and it is the whole reason the field is OPTIONAL.** The parent's own
    // prose must come back with no owner at all — an `assistant_message` carrying
    // `parentToolCallId: undefined` would be a different object from the one every other test in
    // this repo compares against, and a card lookup on `''` would be a lookup for a card that
    // cannot exist.
    expect(
      normalizeMessage(
        sdk({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: '[MAIN] Both back.' }] },
          parent_tool_use_id: null,
          session_id: 's',
        }),
      ),
    ).toEqual([{ type: 'assistant_message', text: '[MAIN] Both back.' }])

    // 058's ordering, with the attribution on every part of it: a child that says something, runs a
    // tool, then says something else produces three events, in that order, all three owned.
    expect(
      normalizeMessage(
        sdk({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'before' },
              { type: 'tool_use', id: 'child_2', name: 'Bash', input: { command: 'ls' } },
              { type: 'text', text: 'after' },
            ],
          },
          parent_tool_use_id: PARENT,
          session_id: 's',
        }),
      ),
    ).toEqual([
      { type: 'assistant_message', text: 'before', parentToolCallId: PARENT },
      { type: 'tool_call', id: 'child_2', name: 'Bash', summary: 'ls', parentToolCallId: PARENT },
      { type: 'assistant_message', text: 'after', parentToolCallId: PARENT },
    ])
  })

  /**
   * Not every tracked task is an agent (035).
   *
   * One session can produce two cards even though the second is background Bash rather than
   * an agent:
   *
   * ```
   * 48  tool_call  Agent  toolu_014ct2…                          ← the real dispatch
   * 56  sub_agent  af289d2b1eec1c1bc  started  kind=general-purpose
   * 58  tool_call  Bash   toolu_01VXe1…  parent=toolu_014ct2…    ← the real agent's OWN call
   * 63  sub_agent  bmlziuxqj  started  (no kind)  parent=toolu_01VXe1…
   * ```
   *
   * The second card's parent is the Bash call itself, and its title is that call's `description`
   * argument. Note the id shapes too — 17-hex for a real agent, 9-char base36 for a tool task —
   * which is corroboration, not the test: ids are not a contract, `subagent_type` is.
   */
  describe('a tracked task that is NOT an agent (035)', () => {
    const BASH_CALL = 'toolu_01VXe1V6g1XPuZ69XaYZbMfC'
    const TASK = 'bmlziuxqj'

    const started = (over: Record<string, unknown> = {}): SDKMessage =>
      sdk({
        type: 'system',
        subtype: 'task_started',
        task_id: TASK,
        tool_use_id: BASH_CALL,
        description: 'Gather RAM size and memory usage stats',
        session_id: 's',
        ...over,
      })

    it('renders as the tool call it already is — no card is opened at all', () => {
      // Remove the extra agent-shaped card entirely. The Bash call already has its own
      // transcript row; redrawing it as an agent is the defect.
      expect(normalizeMessage(started(), new SubAgentTasks())[0]).toMatchObject({
        type: 'unknown',
        category: 'activity',
        label: 'task_started',
      })
    })

    it('and neither is its ENDING, which carries nothing to identify itself with', () => {
      // This is the half a per-message gate could not do: `task_updated` has no `subagent_type`, no
      // `task_type`, not even a `tool_use_id`. Only the registry knows no card was ever opened.
      const tasks = new SubAgentTasks()
      normalizeMessage(started(), tasks)
      for (const ending of [
        sdk({
          type: 'system',
          subtype: 'task_updated',
          task_id: TASK,
          patch: { status: 'completed' },
          session_id: 's',
        }),
        sdk({
          type: 'system',
          subtype: 'task_notification',
          task_id: TASK,
          tool_use_id: BASH_CALL,
          status: 'completed',
          output_file: '/tmp/x',
          summary: 'Gather RAM size and memory usage stats',
          session_id: 's',
        }),
      ]) {
        expect(normalizeMessage(ending, tasks)[0]).toMatchObject({ type: 'unknown' })
      }
    })

    it('a REAL agent in the same session is untouched — both live in one registry', () => {
      // The two tasks run concurrently, so classify each task independently rather than
      // switching the session into a mode.
      const tasks = new SubAgentTasks()
      normalizeMessage(started(), tasks)
      const real = normalizeMessage(
        sdk({
          type: 'system',
          subtype: 'task_started',
          task_id: 'af289d2b1eec1c1bc',
          tool_use_id: 'toolu_014ct2GztZsiTnBnDAhA4JeV',
          description: 'Investigate Mac memory',
          subagent_type: 'general-purpose',
          task_type: 'local_agent',
          session_id: 's',
        }),
        tasks,
      )[0]
      expect(real).toMatchObject({ type: 'sub_agent', phase: 'started', kind: 'general-purpose' })
      expect(normalizeMessage(started(), tasks)[0]).toMatchObject({ type: 'unknown' })
    })

    it('EITHER discriminator is enough — subagent_type alone, or task_type alone', () => {
      // A real agent can carry `subagent_type`, also available later through `task_progress`;
      // the captured fixture carries `task_type: 'local_agent'`. Requiring both drops an
      // agent because of a field the SDK marks optional.
      for (const over of [{ subagent_type: 'Explore' }, { task_type: 'local_agent' }]) {
        expect(normalizeMessage(started(over), new SubAgentTasks())[0]).toMatchObject({
          type: 'sub_agent',
          phase: 'started',
        })
      }
      // …and a `local_workflow` is still NOT a sub-agent. 035's rule is unchanged: no card is
      // invented for it, because a card is a claim about a dispatched agent.
      //
      // ⚠️ **What changed in 108 is the other half of this sentence.** It used to end *"a workflow is
      // dispatched by a tool call that renders fine as itself"* — and that turned out to be false in
      // the way that matters. The `Workflow` row rendered fine; the 22 agents underneath it were
      // invisible, which is the ticket. So the payload is no longer chatter: it is a `workflow_run`,
      // a third reading of the same four subtypes, and both facts are asserted here so neither can
      // quietly become the other.
      const workflowStart = started({ task_type: 'local_workflow' })
      expect(normalizeMessage(workflowStart, new SubAgentTasks())[0]).toMatchObject({
        type: 'workflow_run',
      })
      expect(normalizeMessage(workflowStart, new SubAgentTasks())[0]).not.toMatchObject({
        type: 'sub_agent',
      })
    })

    it('a task nobody started can still name ITSELF on a progress heartbeat', () => {
      // Joining a session mid-flight is the one case where the start is genuinely gone. A
      // `task_progress` carries `subagent_type`, so it can vouch for itself; the endings cannot,
      // and this is exactly why they are not allowed to.
      const tasks = new SubAgentTasks()
      const progress = sdk({
        type: 'system',
        subtype: 'task_progress',
        task_id: 'joined_late',
        description: 'Running List directory contents',
        subagent_type: 'Explore',
        usage: { total_tokens: 1, tool_uses: 1, duration_ms: 1 },
        session_id: 's',
      })
      expect(normalizeMessage(progress, tasks)[0]).toMatchObject({
        type: 'sub_agent',
        phase: 'progress',
      })
      // …and having named itself once, its ending is now legible.
      expect(
        normalizeMessage(
          sdk({
            type: 'system',
            subtype: 'task_updated',
            task_id: 'joined_late',
            patch: { status: 'completed' },
            session_id: 's',
          }),
          tasks,
        )[0],
      ).toMatchObject({ type: 'sub_agent', phase: 'ended' })
    })

    it('an admitted agent is never UN-admitted by a weaker restart (035 review)', () => {
      // The registry answers for a card that is already on screen, whatever a second `task_started`
      // carries. Re-deciding would evict it — and since only the registry can vouch for an ending,
      // the card the user is looking at would then have no way to close.
      const tasks = new SubAgentTasks()
      normalizeMessage(
        sdk({
          type: 'system',
          subtype: 'task_started',
          task_id: 'restarted',
          description: 'Investigate',
          subagent_type: 'general-purpose',
          session_id: 's',
        }),
        tasks,
      )
      for (const weaker of [{}, { skip_transcript: true }]) {
        normalizeMessage(
          sdk({
            type: 'system',
            subtype: 'task_started',
            task_id: 'restarted',
            description: 'Investigate',
            session_id: 's',
            ...weaker,
          }),
          tasks,
        )
        expect(
          normalizeMessage(
            sdk({
              type: 'system',
              subtype: 'task_updated',
              task_id: 'restarted',
              patch: { status: 'completed' },
              session_id: 's',
            }),
            tasks,
          )[0],
          JSON.stringify(weaker),
        ).toMatchObject({ type: 'sub_agent', phase: 'ended' })
      }
    })

    it('a NON-terminal patch on an admitted agent is still chatter, not an ending (035 review)', () => {
      // The gate must not have quietly turned "we do not recognize this status" into an ending. That
      // rule is 029's and it is the difference between "still working" and "finished, unreported".
      const tasks = new SubAgentTasks()
      normalizeMessage(
        sdk({
          type: 'system',
          subtype: 'task_started',
          task_id: 'live',
          description: 'Investigate',
          subagent_type: 'general-purpose',
          session_id: 's',
        }),
        tasks,
      )
      expect(
        normalizeMessage(
          sdk({
            type: 'system',
            subtype: 'task_updated',
            task_id: 'live',
            patch: { status: 'in_progress' },
            session_id: 's',
          }),
          tasks,
        )[0],
      ).toMatchObject({ type: 'unknown', category: 'activity' })
    })

    it('a shown card can always be CLOSED, whatever the notification carries (035 review)', () => {
      // `skip_transcript` decides whether to SHOW a task. Honouring it on an ending would suppress
      // the close of a card already on screen and leave it spinning — hiding a thing and orphaning
      // it are not the same instruction.
      const tasks = new SubAgentTasks()
      normalizeMessage(
        sdk({
          type: 'system',
          subtype: 'task_started',
          task_id: 'shown',
          description: 'Investigate',
          subagent_type: 'general-purpose',
          session_id: 's',
        }),
        tasks,
      )
      expect(
        normalizeMessage(
          sdk({
            type: 'system',
            subtype: 'task_notification',
            task_id: 'shown',
            status: 'completed',
            output_file: '/tmp/x',
            summary: 'done',
            skip_transcript: true,
            session_id: 's',
          }),
          tasks,
        )[0],
      ).toMatchObject({ type: 'sub_agent', phase: 'ended', outcome: 'completed' })
    })

    it('skip_transcript hides an ambient task for its whole life, not just at birth', () => {
      // The SDK: "Ambient/housekeeping task. Consumers should hide this from the inline transcript."
      // ⚠️ Never observed on the wire in any capture in this repo — written from the type, which is
      // why it only ever SUPPRESSES. The worst a misreading can do is hide a card, never invent one.
      const tasks = new SubAgentTasks()
      expect(
        normalizeMessage(
          started({ subagent_type: 'general-purpose', skip_transcript: true }),
          tasks,
        )[0],
      ).toMatchObject({ type: 'unknown' })
      expect(
        normalizeMessage(
          sdk({
            type: 'system',
            subtype: 'task_updated',
            task_id: TASK,
            patch: { status: 'completed' },
            session_id: 's',
          }),
          tasks,
        )[0],
        'the ending of a task that was never shown',
      ).toMatchObject({ type: 'unknown' })
    })
  })

  it("the MAIN agent's own calls stay unattributed — parent_tool_use_id is null on the parent", () => {
    expect(
      normalizeMessage(
        sdk({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'own_1', name: 'Read', input: { file_path: '/x' } }],
          },
          parent_tool_use_id: null,
          session_id: 's',
        }),
      )[0],
    ).toEqual({ type: 'tool_call', id: 'own_1', name: 'Read', summary: '/x' })
  })

  it('a Task dispatch row reads as its description, not as a JSON blob', () => {
    // The parent row sits directly above the nested card, so an anonymous `{"description":…}` dump
    // was the worst possible heading for it.
    expect(
      normalizeMessage(
        sdk({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: PARENT,
                name: 'Task',
                input: {
                  description: 'Report working directory',
                  prompt: 'Run `pwd` …',
                  subagent_type: 'general-purpose',
                },
              },
            ],
          },
          session_id: 's',
        }),
      )[0],
    ).toMatchObject({ type: 'tool_call', name: 'Task', summary: 'Report working directory' })
  })
})

/**
 * **The context meter's Claude half** (087).
 *
 * 086 asked for four provider signals to be extracted. Two of them are Claude's, and only one of
 * them turned out to carry anything — which is a finding rather than a shortfall, and the tests
 * below pin both halves of it.
 */
describe('context readings and compaction boundaries (087)', () => {
  const frame = (event: unknown, rest: Record<string, unknown> = {}) =>
    sdk({ type: 'stream_event', event, session_id: 's', ...rest })
  const readings = (message: SDKMessage) =>
    normalizeMessage(message).filter((e) => e.type === 'context_reading')

  /** A real `message_start` usage block, copied field for field off this machine's database. */
  const USAGE = {
    input_tokens: 2,
    cache_creation_input_tokens: 46969,
    cache_read_input_tokens: 0,
    output_tokens: 4,
  }

  it('sums the cached prompt too — reading `input_tokens` alone would say 2 for a 46,975-token turn', () => {
    // ⚠️ This is the whole test. On the observed frame `input_tokens` is **2** and
    // `cache_creation_input_tokens` is **46,969**, because almost the entire prompt is cached.
    // Cached tokens are priced differently and occupy exactly the same window, so a meter reading
    // the fresh count alone would sit at 2 on a context that is nearly full.
    expect(readings(frame({ type: 'message_start', message: { usage: USAGE } }))).toEqual([
      {
        type: 'context_reading',
        reading: { kind: 'tokens', used: 46975 },
        source: 'message_start',
      },
    ])
  })

  it('is `tokens`, never `proportional` — Claude reports no window at our pin', () => {
    // Measured: no Claude frame the meter reads reports a window. (The string `contextWindow` does
    // appear in exactly one Claude payload — a `queue-operation` echoing back a message someone
    // typed about this feature, which is a fact about the ledger and not about the provider. The
    // first version of this comment said "zero" and was wrong by one; found by re-checking my own
    // numbers before writing them down.) Every Codex reading carries one, 199 of 199. So there is no
    // denominator to divide by, and the `kind` is what stops anything downstream inventing one.
    const [reading] = readings(frame({ type: 'message_start', message: { usage: USAGE } }))
    expect(reading?.type).toBe('context_reading')
    // Narrowed, not `&&`-ed — see the note in `codex-normalize.test.ts` (review findings 21/25).
    if (reading?.type === 'context_reading') expect(reading.reading.kind).toBe('tokens')
    // The negative, paired with its positive: no `window` key at all, on an event that DID arrive.
    expect(reading && JSON.stringify(reading)).not.toContain('window')
  })

  it('reads `message_delta`’s top-level usage as well as `message_start`’s nested one', () => {
    // The two frames put usage at different depths and a single path would silently miss one.
    //
    // ⚠️ **This fixture used to be `{ output_tokens: 688 }` and that was the defect** (review
    // finding 1): it asserted that a 688-token reading is the right answer for a frame, which is
    // the meter collapsing 70× at the end of every turn, written down as intended behaviour. A real
    // `message_delta` carries the whole prompt — verified on all 141 of them in this machine's
    // database, none missing an input field — so the fixture is one of those now.
    expect(
      readings(
        frame({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: {
            input_tokens: 2,
            cache_creation_input_tokens: 46969,
            cache_read_input_tokens: 0,
            output_tokens: 688,
          },
        }),
      ),
    ).toEqual([
      {
        type: 'context_reading',
        reading: { kind: 'tokens', used: 47659 },
        source: 'message_delta',
      },
    ])
  })

  it('an OUTPUT-ONLY frame is no reading — it is a counter, not a context size', () => {
    // ⚠️ The guard review finding 1 asked for. The prompt is what fills the window and it is almost
    // entirely cached; `output_tokens` alone is a few hundred beside ~47,000. Since the meter takes
    // the LATEST reading, emitting one here would replace the real figure with a number 70× smaller
    // at the exact moment a turn finishes. No input side, no reading.
    expect(
      readings(frame({ type: 'message_delta', delta: {}, usage: { output_tokens: 688 } })),
    ).toEqual([])
    // Paired: the same frame WITH an input side does produce one, so the refusal is about the
    // missing prompt rather than about `message_delta` having been switched off.
    expect(
      readings(
        frame({
          type: 'message_delta',
          delta: {},
          usage: { cache_read_input_tokens: 46969, output_tokens: 688 },
        }),
      ),
    ).toEqual([
      {
        type: 'context_reading',
        reading: { kind: 'tokens', used: 47657 },
        source: 'message_delta',
      },
    ])
  })

  it('refuses a SUB-AGENT’s frames — a child’s context is not the session’s', () => {
    // Every frame observed carried `parent_tool_use_id: null`, so this guards the case that has NOT
    // been seen rather than the one that has. Paired with the identical frame at top level, so
    // "produced nothing" is a statement about the parentage and not about the fixture.
    const child = frame(
      { type: 'message_start', message: { usage: USAGE } },
      {
        parent_tool_use_id: 'toolu_01',
      },
    )
    expect(readings(child)).toEqual([])
    expect(readings(frame({ type: 'message_start', message: { usage: USAGE } }))).toHaveLength(1)
    // Still lossless: refusing the READING never drops the frame.
    expect(normalizeMessage(child).map((e) => e.type)).toEqual(['unknown'])
  })

  it('an empty usage object is NO reading, not a reading of zero', () => {
    // The failure this whole feature is named after: `0` and "we were not told" must never look
    // alike. An absent field contributes nothing rather than zero, and a usage block with no
    // readable field at all produces no event, leaving the meter at `unknown`.
    expect(readings(frame({ type: 'message_start', message: { usage: {} } }))).toEqual([])
    expect(readings(frame({ type: 'message_start', message: {} }))).toEqual([])
    // …and a genuine zero IS reported, because that is a measurement.
    expect(
      readings(frame({ type: 'message_start', message: { usage: { input_tokens: 0 } } })),
    ).toEqual([
      { type: 'context_reading', reading: { kind: 'tokens', used: 0 }, source: 'message_start' },
    ])
  })

  it('`compact_boundary` carries its magnitudes — Claude is the provider that says how much', () => {
    const boundary = sdk({
      type: 'system',
      subtype: 'compact_boundary',
      session_id: 's',
      compact_metadata: { trigger: 'auto', pre_tokens: 128000, post_tokens: 24000 },
    })
    expect(normalizeMessage(boundary)).toEqual([
      {
        type: 'compaction',
        before: 128000,
        after: 24000,
        trigger: 'auto',
        source: 'compact_boundary',
      },
      // ⚑ …and the size it left is the context's newest reading.
      {
        type: 'context_reading',
        reading: { kind: 'tokens', used: 24000 },
        source: 'compact_boundary',
      },
    ])
  })

  it('⛔ a sub-agent’s boundary is kept as its compaction, and its size is not this conversation’s reading', () => {
    const fromAChild = normalizeMessage(
      sdk({
        type: 'system',
        subtype: 'compact_boundary',
        session_id: 's',
        parent_tool_use_id: 'toolu_child',
        compact_metadata: { trigger: 'auto', pre_tokens: 128000, post_tokens: 24000 },
      }),
    )
    expect(fromAChild.map((event) => event.type)).toEqual(['compaction'])
    expect(fromAChild.some((event) => event.type === 'context_reading')).toBe(false)
    // ⚑ …and the compaction names the sub-agent call it is of, sized or not.
    expect(fromAChild[0]).toMatchObject({ type: 'compaction', parentToolCallId: 'toolu_child' })
    const unsizedFromAChild = normalizeMessage(
      sdk({
        type: 'system',
        subtype: 'compact_boundary',
        session_id: 's',
        parent_tool_use_id: 'toolu_child',
        compact_metadata: { trigger: 'auto', pre_tokens: 128000 },
      }),
    )
    expect(unsizedFromAChild).toEqual([
      {
        type: 'compaction',
        parentToolCallId: 'toolu_child',
        before: 128000,
        trigger: 'auto',
        source: 'compact_boundary',
      },
    ])
  })

  it('`post_tokens` is optional in the SDK, so `after` is ABSENT rather than zero', () => {
    const [event] = normalizeMessage(
      sdk({
        type: 'system',
        subtype: 'compact_boundary',
        session_id: 's',
        compact_metadata: { trigger: 'manual', pre_tokens: 128000 },
      }),
    )
    expect(event).toEqual({
      type: 'compaction',
      before: 128000,
      trigger: 'manual',
      source: 'compact_boundary',
    })
    // ⚠️ The second assertion used to be `expect(event?.type === 'compaction' && event.after)` —
    // which short-circuits to `false`, not `undefined`, whenever the guard fails, so it could not
    // fail independently of the `toEqual` above (review finding 31). Narrowed first, so the claim
    // is about `after` and nothing else.
    expect(event?.type).toBe('compaction')
    if (event?.type === 'compaction') expect(event.after).toBeUndefined()
    // ⛔ …and with no size, no reading is made up.
    expect(
      normalizeMessage(
        sdk({
          type: 'system',
          subtype: 'compact_boundary',
          session_id: 's',
          compact_metadata: { trigger: 'manual', pre_tokens: 128000 },
        }),
      ),
    ).toHaveLength(1)
  })

  it('a boundary with no metadata at all is still a boundary', () => {
    // Losing the numbers must never lose the FACT — silent context loss is the thing this row
    // exists to prevent, and a provider that says less is not a provider that said nothing.
    expect(
      normalizeMessage(sdk({ type: 'system', subtype: 'compact_boundary', session_id: 's' })),
    ).toEqual([{ type: 'compaction', source: 'compact_boundary' }])
  })

  it('`compaction_delta` carries no MAGNITUDE, and its raw frame is still classified', () => {
    // ⚠️ The fourth signal 086 asked to extract, and the honest answer is that there is nothing in
    // it to extract. Its `delta.content` is a STRING: no `pre_tokens`, no window, no id. Lifting a
    // guess would be the one thing that task forbade, so the frame stays classified and lossless —
    // and 097 did not change that. It added an `activity` BESIDE it; nothing here is consumed.
    const events = normalizeMessage(
      frame({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'compaction_delta', content: 'Summarising the earlier turns…' },
      }),
    )
    expect(events.map((e) => e.type)).toEqual(['activity', 'unknown'])
    expect(events[1]).toMatchObject({ category: 'lifecycle', label: 'compaction_delta' })
    // No magnitude is invented from it: the numbers live on the boundary, and only there.
    expect(events[0]).not.toHaveProperty('before')
    // Paired: the frame that DOES carry a magnitude produces a typed event, so "no magnitude here"
    // is a fact about this payload rather than about the extraction being switched off.
    expect(
      normalizeMessage(
        sdk({
          type: 'system',
          subtype: 'compact_boundary',
          session_id: 's',
          compact_metadata: { pre_tokens: 1 },
        }),
      ).map((e) => e.type),
    ).toEqual(['compaction'])
  })

  /**
   * **081's avatar becomes reachable** (097, named by 087 §3).
   *
   * `compacting` was in the vocabulary from 027 and no adapter had ever emitted it, so the phase and
   * the avatar 082 built for it were unreachable code. `compaction_delta` is the one frame either
   * provider sends *during* a compaction rather than after one, which makes it the signal.
   */
  it('`compaction_delta` raises the `compacting` phase — and nothing else does', () => {
    const compacting = normalizeMessage(
      frame({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'compaction_delta', content: 'Summarising…' },
      }),
    )
    expect(compacting[0]).toEqual({ type: 'activity', phase: 'compacting' })

    // ⚠️ **The negative half, and it is the load-bearing one**: every OTHER delta kind must leave
    // the phase alone. A `compactingActivity` that returned the pill for anything would have made
    // the avatar appear during ordinary reasoning, which is a worse lie than never showing it.
    for (const type of [
      'thinking_delta',
      'signature_delta',
      'input_json_delta',
      'citations_delta',
    ]) {
      const events = normalizeMessage(
        frame({ type: 'content_block_delta', index: 0, delta: { type } }),
      )
      expect(
        events.filter((e) => e.type === 'activity' && e.phase === 'compacting'),
        type,
      ).toEqual([])
      // …and each of those frames really did produce something, so the emptiness above is about the
      // phase rather than about a normalizer that returned nothing at all.
      expect(events.length, type).toBeGreaterThan(0)
    }
  })

  it('a partial `compaction_delta` with no content is still the phase', () => {
    // The pill is about the phase, not the summary — the SDK reducer treats missing content as an
    // empty string, and a compaction whose first delta happens to be empty is still a compaction.
    expect(
      normalizeMessage(
        frame({ type: 'content_block_delta', index: 0, delta: { type: 'compaction_delta' } }),
      )[0],
    ).toEqual({ type: 'activity', phase: 'compacting' })
  })
})

/**
 * 110 · A credential that was refused mid-session — the three real refusals, and what each becomes.
 *
 * ⛔ **Every text here was read out of this machine's own ledger, not invented.** Three incidents,
 * six weeks apart, three different sentences from the same `error: 'authentication_failed'`:
 *
 * ```
 * 2026-07-01  "Failed to authenticate. API Error: 401 Invalid authentication credentials"
 * 2026-07-22  "Not logged in · Please run /login"
 * 2026-08-10  "Failed to authenticate. API Error: 401 OAuth access token has been revoked."
 * ```
 *
 * That spread is the argument for never matching the English: three wordings, one fact, and the
 * only stable thing on the wire is the error WORD. In 7 of 7 such messages the whole content was
 * the notice — no tool call, no sentence the model wrote — which is what makes diverting the text
 * safe rather than lossy.
 */
const REAL_REFUSALS = [
  'Failed to authenticate. API Error: 401 Invalid authentication credentials',
  'Not logged in · Please run /login',
  'Failed to authenticate. API Error: 401 OAuth access token has been revoked.',
]

describe('a refused credential (110)', () => {
  // ⚑ **The frame as the SDK sends it** (680): the CLI wrote this message and says so with its model,
  // `<synthetic>` — measured on the SDK frame by `680` §1, and on the archived copy by 110. The marker,
  // not the one-text-block shape, is what diverts it now; see `a refusal is not the speaker's words`.
  const refused = (text: string): RuntimeEvent[] =>
    normalizeMessage(
      sdk({
        type: 'assistant',
        message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text }] },
        error: 'authentication_failed',
      }),
    )

  it('every real refusal becomes ONE fatal error carrying the provider’s own words', () => {
    for (const text of REAL_REFUSALS) {
      expect(refused(text), text).toEqual([
        { type: 'error', message: text, fatal: true, cause: 'auth_stale' },
      ])
    }
  })

  it('⚠️ the SDK’s notice is NOT published as something the assistant said', () => {
    for (const text of REAL_REFUSALS) {
      const events = refused(text)
      expect(
        events.filter((e) => e.type === 'assistant_message'),
        text,
      ).toEqual([])
      // …and the paired positive, or the assertion above passes over a normalizer that returned
      // nothing at all: the words still exist, on the error, verbatim.
      expect(events.filter((e) => e.type === 'error').map((e) => e.message)).toEqual([text])
    }
  })

  it('⚠️ a refusal that arrives BESIDE real content does not delete it (review)', () => {
    // ⚑ Since 680 the diversion is a rule about the MARKER — `model: "<synthetic>"` — and no longer
    // 110's shape ("the notice is the whole message"). This frame names no model, so it is not the
    // CLI's: its reply and its tool call stay, and the ending still lands. Written as "divert every
    // text run", both would have been swallowed into an `error.message` to make room for a notice.
    expect(
      normalizeMessage(
        sdk({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Let me check the logs…' },
              { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } },
            ],
          },
          error: 'authentication_failed',
        }),
      ),
    ).toEqual([
      { type: 'assistant_message', text: 'Let me check the logs…' },
      { type: 'tool_call', id: 'tu_1', name: 'Bash', summary: 'ls' },
      // …and the ending still lands, because it never depended on the diversion.
      {
        type: 'error',
        message: 'claude could not authenticate',
        fatal: true,
        cause: 'auth_stale',
      },
    ])
  })

  it('⚠️ the other unrecoverable-looking words do NOT end the session', () => {
    // `oauth_org_not_allowed` and `billing_error` are the two most easily mistaken for this, and
    // review argued both should end the session too. They must not: reopening cannot change which
    // account you are, and it cannot pay a bill — so the offer `auth_stale` makes would be wrong
    // advice, and a session ended on wrong advice is worse than one left open with a visible error.
    for (const word of ['oauth_org_not_allowed', 'billing_error']) {
      const events = normalizeMessage(
        sdk({ type: 'assistant', message: { role: 'assistant', content: [] }, error: word }),
      )
      const error = events.find((e) => e.type === 'error')
      if (!error || error.type !== 'error') throw new Error(`no error event for ${word}`)
      expect(error.fatal, word).toBe(false)
      expect(error.cause, word).toBeUndefined()
    }
  })

  it('a message that is not the CLI’s keeps its words, whatever its error word', () => {
    // ⚑ No marker, so not the CLI's notice (680). ⚠️ This is the control, not the CLI's shape: a
    // real reply cut at its limit arrives WITHOUT an error word, and the CLI's `max_output_tokens`
    // notice after it is `<synthetic>` — `a-refusal-is-not-the-speakers-words.test.ts` has both.
    expect(
      normalizeMessage(
        sdk({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'half an answer' }] },
          error: 'max_output_tokens',
        }),
      ),
    ).toEqual([
      { type: 'assistant_message', text: 'half an answer' },
      { type: 'error', message: 'the reply hit its maximum length', fatal: false },
    ])
  })

  it('a refusal with no text at all still says something a person can read', () => {
    expect(
      normalizeMessage(
        sdk({
          type: 'assistant',
          message: { role: 'assistant', content: [] },
          error: 'authentication_failed',
        }),
      ),
    ).toEqual([
      { type: 'error', message: 'claude could not authenticate', fatal: true, cause: 'auth_stale' },
    ])
  })

  it('no `.d.ts` symbol survives the translation — for ANY of the thirteen error words', () => {
    // The union, spelled out. If the SDK grows another member the `Record` in `assistant-error.ts`
    // fails to compile, which is the guard — it did, on the 0.3.281 bump, for the three marked (680)
    // — and this is the other half: that nothing in the thirteen reaches a reader as itself.
    const EXPECTED_WORDS = {
      authentication_failed: 'claude could not authenticate',
      oauth_org_not_allowed: 'this account is not allowed to use this organization',
      account_on_hold: 'this account is on hold and claude will not answer it', // 680
      verification_required: 'claude will not answer until this account is verified', // 680
      cloud_credential_error: 'claude could not load the cloud credentials it runs on', // 680
      billing_error: 'claude reported a billing problem with this account',
      rate_limit: 'claude is rate-limited',
      overloaded: 'claude is overloaded',
      invalid_request: 'claude rejected the request as invalid',
      model_not_found: 'the model this conversation asks for is not available',
      server_error: 'claude had a server-side error',
      unknown: 'claude reported an error without saying what it was',
      max_output_tokens: 'the reply hit its maximum length',
      // ⚑ `satisfies` the union (680): a word the SDK adds and this list lacks is a type error here too.
    } satisfies Record<SDKAssistantMessageError, string>
    for (const word of Object.keys(EXPECTED_WORDS) as SDKAssistantMessageError[]) {
      const events = normalizeMessage(
        sdk({ type: 'assistant', message: { role: 'assistant', content: [] }, error: word }),
      )
      const error = events.find((e) => e.type === 'error')
      if (!error || error.type !== 'error') throw new Error(`no error event for ${word}`)
      // ⚠️ **The symbol, not the English.** `overloaded` and `unknown` are also ordinary words, and
      // asserting their absence would forbid the sentence from saying what it means. What must
      // never appear is a snake_case identifier, and what must never happen is the message BEING
      // the word — the two together are exactly "no `.d.ts` symbol reached a reader".
      expect(error.message, word).not.toContain('_')
      expect(error.message, word).not.toBe(word)
      expect(error.message.length, word).toBeGreaterThan(word.length)
      // …and the exact sentence, because the three checks above are about FORM and would accept a
      // well-formed translation of the wrong error (review). Pinned here so a mis-mapped `Record`
      // entry — the one mistake the compile-time guard cannot catch — fails a test.
      expect(error.message, word).toBe(EXPECTED_WORDS[word])
    }
  })

  it('a RETRY names the same cause in words, and deliberately does not end anything', () => {
    // Read `error` beside `error_status`; otherwise the frame shows only “API error (HTTP
    // 401)” until the ending arrives two seconds later.
    const events = normalizeMessage(
      sdk({
        type: 'system',
        subtype: 'api_retry',
        attempt: 1,
        max_retries: 10,
        retry_delay_ms: 600,
        error_status: 401,
        error: 'authentication_failed',
      }),
    )
    expect(events).toEqual([
      {
        type: 'error',
        message:
          'claude could not authenticate; retrying (attempt 1/10, retrying in 0.6s, HTTP 401)',
        fatal: false,
      },
    ])
    // No `cause`, and that is the ruling, not an oversight: a retry may still succeed, and dressing
    // it as the terminal state would end a session the SDK had not given up on.
    const retry = events[0]
    if (!retry || retry.type !== 'error') throw new Error('no error event')
    expect(retry.cause).toBeUndefined()
    expect(retry.fatal).toBe(false)
  })

  it('a retry frame that names no error still explains the pause', () => {
    // `error_status: null` is documented for connection errors with no HTTP response.
    expect(
      normalizeMessage(
        sdk({
          type: 'system',
          subtype: 'api_retry',
          attempt: 2,
          max_retries: 10,
          retry_delay_ms: 1100,
          error_status: null,
        }),
      ),
    ).toEqual([
      {
        type: 'error',
        message: 'claude hit an API error; retrying (attempt 2/10, retrying in 1.1s)',
        fatal: false,
      },
    ])
  })
})
