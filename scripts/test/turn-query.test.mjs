import { describe, expect, it } from 'vitest'
import {
  claudeSessionOf,
  codexThreadOf,
  howACommandArrived,
  interruptedTurnQuery,
  isClaudeTranscriptOf,
  isRolloutOf,
  promptEntriesIn,
  promptsIn,
  providerInterruptVerdict,
  providerRefQuery,
  oneTreePerRun,
  rolloutReasoningSummary,
  rolloutTurnEnding,
} from '../lib/turn-query.mjs'

/**
 * ⛔ **A step that asks someone else to check is a step with a claim and no coverage** (206 H1).
 *
 * `ui-live-smoke.mjs` step 48 interrupts a turn, replaces it, and used to end with the sentence
 * *"confirm `turn.end_reason='interrupted'` in the ledger"*. `inspectInterruptedTurn` was in the
 * same file — written for step 6 — and its query was over the WHOLE database ordered by `ordinal`,
 * which counts turns within a session. So the answer it returned was about whichever session had
 * the most turns, and step 48's claim was unassertable by construction.
 *
 * ⚑ **The scoping is the fix, so the scoping is what is testable.** The live step is not: a live run
 * is the one thing `pnpm run ci` cannot do (`smoke-verdicts.mjs` and `personal-home-guard.mjs` are
 * in `lib/` for the same reason).
 */
describe('the interrupted-turn query (206 H1)', () => {
  it('⛔ scopes to the session it was asked about', () => {
    const sql = interruptedTurnQuery('sess_12')

    expect(sql).toContain("t.session_id = 'sess_12'")
    expect(sql).toContain("t.end_reason = 'interrupted'")
    // ⚠️ Ordered within that session. `ordinal` is `(session_id, generation, ordinal)`-unique, so
    // ordering by it across sessions — which is what this did — compares turn NUMBERS, not times.
    expect(sql).toContain('ORDER BY t.ordinal DESC LIMIT 1')
  })

  it('⚑ …and the paired negative: step 6’s unscoped question is still available, and is unscoped', () => {
    // Step 6 is the first step in the file to interrupt anything, so at that point the whole-
    // database answer is the only answer it could be. Removing the option would have made 6 lie.
    const sql = interruptedTurnQuery(null)

    expect(sql).not.toContain('session_id')
    expect(sql).toContain("t.end_reason = 'interrupted'")
  })

  it('⛔ two sessions do not produce the same query — which was the entire defect', () => {
    expect(interruptedTurnQuery('sess_6')).not.toBe(interruptedTurnQuery('sess_48'))
    expect(interruptedTurnQuery('sess_6')).not.toBe(interruptedTurnQuery(null))
  })

  it('🔒 refuses an id of an unexpected shape rather than concatenating it', () => {
    // The value goes into SQL text — `queryDatabase` runs `sqlite3` with a statement, not with
    // bound parameters — so the alphabet is checked at the one place that builds the string.
    expect(() => interruptedTurnQuery("x' OR '1'='1")).toThrow(/unexpected shape/)
    expect(() => interruptedTurnQuery('sess_1; DROP TABLE turn')).toThrow(/unexpected shape/)
    // …and the ordinary shapes are not refused, or the guard would be a way to break step 48.
    expect(() => interruptedTurnQuery('sess_12')).not.toThrow()
    expect(() => interruptedTurnQuery('01d3f20a-aaaa-bbbb-cccc-ddddeeeeffff')).not.toThrow()
  })
})

/**
 * 🔴 **704 · the PROVIDER's half — because the row above was the app's verdict, relabelled until
 * `709` (R43), and Codex's own file is the copy nothing in the app can rewrite.**
 *
 * ⚑ The fixture lines keep the SHAPES 704 read off step 48's conversation in a real ledger — which
 * record types, which fields, in which order — with the long fields cut down: the person's message
 * carries the app's preamble FIRST and the words last, and a turn closes with exactly one of
 * `task_complete` / `turn_aborted`. ⛔ They are not built by the function under test.
 */
const THREAD = '01a0d18a-75bf-7a71-a0b8-27b560210606'
const COUNT = 'Count slowly from 1 to 200, one number per line.'
const line = (type, payload) =>
  JSON.stringify({ timestamp: '2026-09-24T03:52:00.643Z', type, payload })
const turnOf = (turnId, words, ending) => [
  line('event_msg', { type: 'task_started', turn_id: turnId, model_context_window: 258400 }),
  line('turn_context', { turn_id: turnId, cwd: '/tmp/queue' }),
  line('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text' }] }),
  line('event_msg', {
    type: 'user_message',
    message: `Sent by a person, typed into this app.\n\nYou are answering a person.\n\n${words}`,
  }),
  line('event_msg', { type: 'agent_message', message: '1\n2\n3' }),
  ...(ending === 'aborted'
    ? [line('event_msg', { type: 'turn_aborted', turn_id: turnId, reason: 'interrupted' })]
    : ending === 'completed'
      ? [line('event_msg', { type: 'task_complete', turn_id: turnId, last_agent_message: '3' })]
      : []),
]
const rollout = (...turns) => [line('session_meta', { id: THREAD }), ...turns.flat(), ''].join('\n')

describe('704 · what Codex did with the turn step 48 interrupted', () => {
  it('⛔ a turn Codex aborted as interrupted is the pass', () => {
    const text = rollout(
      turnOf('tn_before', 'Count slowly from 1 to 40, one number per line.', 'completed'),
      turnOf('tn_48', COUNT, 'aborted'),
      turnOf('tn_after', 'Stop. Say only the word APRICOT.', 'completed'),
    )
    const ending = rolloutTurnEnding(text, COUNT)
    expect(ending).toMatchObject({ turnId: 'tn_48', aborted: 'interrupted', completed: false })
    expect(providerInterruptVerdict(ending)).toEqual({ ok: true, turnId: 'tn_48' })
  })

  it('🔴 a turn Codex COMPLETED is red — the interrupt was not honoured (and until 709 the row said interrupted)', () => {
    // ⚑ The paired control: the SAME file with one ending changed, so the red is the ending's.
    const ending = rolloutTurnEnding(rollout(turnOf('tn_48', COUNT, 'completed')), COUNT)
    expect(ending).toMatchObject({ turnId: 'tn_48', aborted: null, completed: true })
    const verdict = providerInterruptVerdict(ending)
    expect(verdict.ok).toBe(false)
    expect(verdict.why).toMatch(/COMPLETED turn tn_48 \(task_complete\)/)
  })

  it('⛔ a completion outranks an abort for the same turn, and an abort for another reason is red', () => {
    const both = rolloutTurnEnding(
      rollout(turnOf('tn_48', COUNT, 'aborted'), [
        line('event_msg', { type: 'task_complete', turn_id: 'tn_48' }),
      ]),
      COUNT,
    )
    expect(providerInterruptVerdict(both).ok).toBe(false)
    const replaced = rolloutTurnEnding(
      rollout(turnOf('tn_48', COUNT, null), [
        line('event_msg', { type: 'turn_aborted', turn_id: 'tn_48', reason: 'replaced' }),
      ]),
      COUNT,
    )
    expect(providerInterruptVerdict(replaced)).toMatchObject({ ok: false })
    expect(providerInterruptVerdict(replaced).why).toMatch(/for "replaced"/)
  })

  it('⚑ an ending for ANOTHER turn is not this one’s, and a turn not yet ended is asked again', () => {
    const open = rolloutTurnEnding(
      rollout(turnOf('tn_before', 'something else', 'completed'), turnOf('tn_48', COUNT, null)),
      COUNT,
    )
    expect(open).toMatchObject({ turnId: 'tn_48', settled: false, completed: false })
    expect(providerInterruptVerdict(open)).toBeNull()
    // …and a file that holds no message with the words has no turn to judge.
    const absent = rolloutTurnEnding(rollout(turnOf('tn_1', 'other words', 'completed')), COUNT)
    expect(absent.turnId).toBeNull()
    expect(providerInterruptVerdict(absent)).toBeNull()
    expect(absent.seen).toContain('task_complete')
  })

  it('⚠️ a half-written LAST line is skipped, not fatal — Codex appends while the step reads', () => {
    const text = rollout(turnOf('tn_48', COUNT, 'aborted')) + '{"timestamp":"2026-09-24T03:5'
    expect(providerInterruptVerdict(rolloutTurnEnding(text, COUNT))).toEqual({
      ok: true,
      turnId: 'tn_48',
    })
  })

  it('🔒 the rollout is found by NAME, and no other file in a Codex home can pass', () => {
    expect(isRolloutOf(`rollout-2026-09-24T03-51-47-${THREAD}.jsonl`, THREAD)).toBe(true)
    // ⛔ The credential beside it, and a rollout of another thread, are never opened.
    expect(isRolloutOf('auth.json', THREAD)).toBe(false)
    expect(isRolloutOf(`rollout-2026-09-24T03-51-47-${THREAD}.jsonl.bak`, THREAD)).toBe(false)
    expect(
      isRolloutOf(`rollout-2026-09-24-01a0d18a-0000-7a71-a0b8-27b560210606.jsonl`, THREAD),
    ).toBe(false)
    // …and a thread id that is not one cannot turn the match into a wildcard.
    expect(isRolloutOf('rollout-x-.jsonl', '')).toBe(false)
    expect(isRolloutOf('rollout-x-a.jsonl', 'a')).toBe(false)
  })

  it('🔒 the thread is read off the ref only when the ref is Codex’s and the id is thread-shaped', () => {
    const ref = { provider: 'codex', sessionId: THREAD, cwd: '/tmp/queue', rotation: 0 }
    expect(codexThreadOf(JSON.stringify(ref))).toBe(THREAD)
    expect(codexThreadOf({ ...ref, provider: 'claude' })).toBeNull()
    expect(codexThreadOf(JSON.stringify({ ...ref, sessionId: '../../auth' }))).toBeNull()
    expect(codexThreadOf('not json')).toBeNull()
    expect(codexThreadOf(null)).toBeNull()
  })

  it('🔒 the ref query refuses an id of an unexpected shape, like the turn query', () => {
    expect(providerRefQuery('sess_2b8cb119-0031-40ef-825a-9f506acf5b85')).toContain(
      "WHERE id = 'sess_2b8cb119-0031-40ef-825a-9f506acf5b85'",
    )
    expect(() => providerRefQuery("x' OR '1'='1")).toThrow(/unexpected shape/)
    expect(() => providerRefQuery(null)).toThrow(/unexpected shape/)
  })
})

/**
 * 🔴 **704 · steps 62 and 70 ask what the CLI RECEIVED for `/compact` and `/clear`.** From `607`
 * until `708` a person's words went out inside the app's authorship preamble, and a slash command
 * mid-prompt is words (`708`'s `R42` sends a person's command as typed). The WRAPPED fixture below is the prompt the CLI recorded on 704's run of step 62, verbatim.
 */
describe('704 · how a slash command arrived at the CLI', () => {
  const SESSION = 'c281b912-ab31-4f35-aeb2-bb95f6fc1d82'
  const WRAPPED =
    'Sent by a person, typed into this app.\n\nYou are answering a person. A question of your own goes ' +
    'to the-parent — the conversation that gave you the work — unless the work you were given says ' +
    'otherwise; ask_question takes who_answers and there is no default.\n\n/compact'
  const line = (entry) => JSON.stringify(entry)

  it('🔴 wrapped — 704’s measured prompt: the command after the preamble was never a command', () => {
    expect(howACommandArrived([WRAPPED], '/compact')).toEqual({ arrived: 'wrapped', text: WRAPPED })
  })

  it('⚑ controls: the bare command, and the CLI’s own command markup, are commands; nothing is absent', () => {
    expect(howACommandArrived(['/compact'], '/compact')).toEqual({ arrived: 'command' })
    expect(
      howACommandArrived(
        ['<command-name>/compact</command-name>\n<command-args></command-args>'],
        '/compact',
      ),
    ).toEqual({ arrived: 'command' })
    expect(howACommandArrived(['summarise this'], '/compact')).toEqual({ arrived: 'absent' })
    // ⛔ A word that merely ENDS in the command is not it — `x/compact` is not `/compact`.
    expect(howACommandArrived(['see docs/compact'], '/compact')).toEqual({ arrived: 'absent' })
    // ⚑ The LAST prompt that names it decides: a later bare command after an earlier wrapped one.
    expect(howACommandArrived([WRAPPED, '/compact'], '/compact')).toEqual({ arrived: 'command' })
  })

  it('⚑ the prompts are the CLI’s user turns — never a tool result, never a meta entry', () => {
    const jsonl = [
      line({ type: 'user', message: { content: WRAPPED } }),
      line({
        type: 'user',
        message: {
          content: [
            { type: 'text', text: 'two parts' },
            { type: 'text', text: 'of one' },
          ],
        },
      }),
      line({ type: 'user', message: { content: [{ type: 'tool_result', content: '/compact' }] } }),
      // ⚠️ A tool's result that carries a text part beside it is still not a prompt.
      line({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', content: 'ok' },
            { type: 'text', text: '/compact' },
          ],
        },
      }),
      line({ type: 'user', isMeta: true, message: { content: '/compact' } }),
      line({ type: 'assistant', message: { content: '/compact' } }),
      'not json',
      '',
    ].join('\n')
    expect(promptsIn(jsonl)).toEqual([WRAPPED, 'two parts\nof one'])
  })

  it('⚑ 715 · each prompt carries the cwd the CLI recorded beside it — where a `cd` left it', () => {
    const jsonl = [
      line({ type: 'user', cwd: '/w', message: { content: 'move' } }),
      line({
        type: 'user',
        cwd: '/w/findings',
        message: { content: [{ type: 'tool_result', content: '/w/findings' }] },
      }),
      line({ type: 'user', cwd: '/w/findings', message: { content: 'after' } }),
      line({ type: 'user', message: { content: 'no cwd' } }),
    ].join('\n')
    expect(promptEntriesIn(jsonl)).toEqual([
      { text: 'move', cwd: '/w' },
      { text: 'after', cwd: '/w/findings' },
      { text: 'no cwd', cwd: null },
    ])
    // ⚑ …and `promptsIn` is the same prompts, text only.
    expect(promptsIn(jsonl)).toEqual(['move', 'after', 'no cwd'])
  })

  it('🔒 the transcript is found by NAME, and no other file in a Claude home can pass', () => {
    expect(isClaudeTranscriptOf(`${SESSION}.jsonl`, SESSION)).toBe(true)
    expect(isClaudeTranscriptOf('.credentials.json', SESSION)).toBe(false)
    expect(isClaudeTranscriptOf(`${SESSION}.jsonl.bak`, SESSION)).toBe(false)
    // ⛔ Another conversation's transcript, in the same folder, is not this one's.
    expect(isClaudeTranscriptOf('00000000-0000-4000-8000-000000000000.jsonl', SESSION)).toBe(false)
    expect(isClaudeTranscriptOf('.jsonl', '')).toBe(false)
    expect(isClaudeTranscriptOf('x.jsonl', 'x')).toBe(false)
    const ref = { provider: 'claude', sessionId: SESSION, cwd: '/tmp/x', rotation: 0 }
    expect(claudeSessionOf(JSON.stringify(ref))).toBe(SESSION)
    expect(claudeSessionOf({ ...ref, provider: 'codex' })).toBeNull()
    expect(claudeSessionOf(JSON.stringify({ ...ref, sessionId: '../../.credentials' }))).toBeNull()
    expect(claudeSessionOf('not json')).toBeNull()
  })
})

describe('727 · what Codex wrote about its reasoning, and one tree per run', () => {
  /** A rollout line, in the shape `722`'s two batches recorded. */
  const reasoningLine = (summary) =>
    JSON.stringify({
      timestamp: '2026-09-25T17:30:48.149Z',
      type: 'response_item',
      payload: { type: 'reasoning', id: 'rs_1', summary, encrypted_content: 'gAAA' },
    })
  const WORDED = [{ type: 'summary_text', text: '**Planning puzzle solution steps**' }]

  it('🔴 counts reasoning items, and only the ones whose summary carries words', () => {
    const text = [
      JSON.stringify({ type: 'session_meta', payload: { id: 'x' } }),
      reasoningLine([]),
      reasoningLine(WORDED),
      reasoningLine([{ type: 'summary_text', text: '   ' }]),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', summary: WORDED } }),
      '{"type":"response_item","payload":{"type":"reasoning"', // a half-written last line
    ].join('\n')
    expect(rolloutReasoningSummary(text)).toEqual({ reasoning: 3, worded: 1 })
  })

  it('⚑ a batch-2 rollout — reasoning, and not a word — reads as exactly that', () => {
    expect(rolloutReasoningSummary(reasoningLine([]))).toEqual({ reasoning: 1, worded: 0 })
    expect(rolloutReasoningSummary('')).toEqual({ reasoning: 0, worded: 0 })
  })

  it('🔴 one tree per run: distinct task ids pass; a run drawn twice, or a tree with none, does not', () => {
    expect(oneTreePerRun(['wydc6p7jd'])).toBeNull()
    expect(oneTreePerRun(['wydc6p7jd', 'wbd82qw8g'])).toBeNull()
    expect(oneTreePerRun(['wydc6p7jd', 'wydc6p7jd'])).toMatch(/two trees draw ONE run/)
    expect(oneTreePerRun(['wydc6p7jd', ''])).toMatch(/names no run/)
  })
})
