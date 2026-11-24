import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'
import { CLAUDE_IMPLEMENTATION } from './fixtures/claude-implementation'
import { type RuntimeEvent } from '../src/index'
import { ClaudeRuntime } from '../src/claude'
import {
  FakeQuery,
  init,
  firstOfType,
  has,
  toolOpts,
  sdkToolCall,
  startFake,
} from './fake-claude-query'

/**
 * **139 · a question that takes several answers, and the answer that comes back.**
 *
 * Preserve `multiSelect: true` and `multiSelect: false` on two questions in one provider
 * call. The card handles their visible distinction; the adapter must also encode the actual
 * choices back to the model.
 */
describe('AskUserQuestion — multi-select (139)', () => {
  const twoQuestions = {
    questions: [
      {
        question: 'which capabilities?',
        header: 'Scope',
        multiSelect: true,
        options: [
          { label: 'rendering', description: 'markdown, diffs, output' },
          { label: 'interactive', description: 'checklists, pickers, prompts' },
          { label: 'agents', description: 'subagents and skills' },
        ],
      },
      {
        question: 'where should demo files go?',
        header: 'Files',
        multiSelect: false,
        options: [
          { label: 'a subfolder', description: 'keeps the root clean' },
          { label: 'the root', description: 'nothing hidden a level down' },
        ],
      },
    ],
  }

  it('carries the flag both ways, and answers each question in the shape it asked for', async () => {
    const { fq, handle, canUse, events, consumer } = await startFake()
    const answerP = canUse('AskUserQuestion', twoQuestions, toolOpts('tu_ms'))
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))

    // THE DEFECT, in one assertion: before 139 both of these read the same, because the neutral
    // shape had three members and none of them was this one.
    //
    // ⚑ **143 added three more, and this fixture was already carrying all of them.** The header and
    // every description below were in the input before this dispatch and were dropped on the floor
    // by `claudeQuestions` — which is the whole ticket in one diff: the provider had been sending
    // the compact label and the reasoning all along, and the card showed neither.
    expect(firstOfType(events, 'user_input_request').questions).toEqual([
      {
        id: 'q0',
        prompt: 'which capabilities?',
        header: 'Scope',
        options: [
          { label: 'rendering', description: 'markdown, diffs, output' },
          { label: 'interactive', description: 'checklists, pickers, prompts' },
          { label: 'agents', description: 'subagents and skills' },
        ],
        allowOther: true,
        multiSelect: true,
      },
      {
        id: 'q1',
        prompt: 'where should demo files go?',
        header: 'Files',
        options: [
          { label: 'a subfolder', description: 'keeps the root clean' },
          { label: 'the root', description: 'nothing hidden a level down' },
        ],
        allowOther: true,
        multiSelect: false,
      },
    ])

    await handle.respondUserInput('tu_ms', {
      kind: 'answer',
      answers: { q0: ['rendering', 'agents'], q1: 'a subfolder' },
    })
    // ⚑ Comma-separated is the SDK's own documented multi-select shape (`AskUserQuestionOutput`:
    // *"question text -> answer string; multi-select answers are comma-separated"*), and the
    // single-select answer beside it is the plain string it has always been.
    expect(await answerP).toMatchObject({
      behavior: 'allow',
      updatedInput: {
        answers: {
          'which capabilities?': 'rendering, agents',
          'where should demo files go?': 'a subfolder',
        },
      },
    })
    await handle.close()
    fq.end()
    await consumer
  })

  it('refuses several answers to a question that declared ONE, rather than joining them', async () => {
    // ⛔ The join above is the provider's multi-select shape. Applied to a single-select question it
    // would build `"a subfolder, the root"` — one compound choice, indistinguishable on the wire
    // from an option label that happens to contain a comma, for a question the model declared
    // mutually exclusive. Refused at the gesture (142), so the card is still there to answer.
    const { fq, handle, canUse, events, consumer } = await startFake()
    const answerP = canUse('AskUserQuestion', twoQuestions, toolOpts('tu_ms_bad'))
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))

    await expect(
      handle.respondUserInput('tu_ms_bad', {
        kind: 'answer',
        answers: { q0: ['rendering'], q1: ['a subfolder', 'the root'] },
      }),
    ).rejects.toThrow(/cannot be forwarded/)

    // …and the SAME card takes a usable answer afterwards. Without this, "refused" and "the request
    // is gone" would look identical from here, which is the difference the fix is about.
    await handle.respondUserInput('tu_ms_bad', {
      kind: 'answer',
      answers: { q0: ['rendering'], q1: ['the root'] },
    })
    expect(await answerP).toMatchObject({ behavior: 'allow' })
    await handle.close()
    fq.end()
    await consumer
  })

  /**
   * ⛔ **One bad value per test, and 141 is why** (142 §4.2). The single test this replaces sent
   * `q0: []` and `q1: '   '` in ONE response and checked only that the whole thing was refused:
   * *"accepting either bad value still leaves the other to make the test green"*. Each shape now
   * arrives alone, beside a perfectly good answer to the other question, so the refusal can only
   * have come from the one under test.
   *
   * 064 refused a question with nothing to ask because an empty `allow` let the model carry on as
   * though a human had answered. An ANSWERED question with nothing in it is that same event one
   * layer down: the id is present, so completeness passes, and what the model would be told is that
   * the user picked "".
   */
  const NOTHING_CHOSEN: readonly { what: string; value: string | string[] }[] = [
    { what: 'an empty array', value: [] },
    { what: 'an empty string', value: '' },
    { what: 'a whitespace-only string', value: '   ' },
    { what: 'an array of blanks', value: ['  ', '\t'] },
  ]

  for (const [i, { what, value }] of NOTHING_CHOSEN.entries()) {
    it(`refuses ${what} — chosen ALONE, with the other question answered properly`, async () => {
      const { fq, handle, canUse, events, consumer } = await startFake()
      const answerP = canUse('AskUserQuestion', twoQuestions, toolOpts(`tu_ms_empty_${i}`))
      await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))

      await expect(
        handle.respondUserInput(`tu_ms_empty_${i}`, {
          kind: 'answer',
          answers: { q0: value, q1: 'a subfolder' },
        }),
      ).rejects.toThrow(/cannot be forwarded/)

      // The paired positive on the SAME card: q1's answer was never the problem.
      await handle.respondUserInput(`tu_ms_empty_${i}`, {
        kind: 'answer',
        answers: { q0: ['rendering'], q1: 'a subfolder' },
      })
      expect(await answerP).toMatchObject({
        behavior: 'allow',
        updatedInput: {
          answers: {
            'which capabilities?': 'rendering',
            'where should demo files go?': 'a subfolder',
          },
        },
      })
      await handle.close()
      fq.end()
      await consumer
    })
  }

  it('forwards the value it VALIDATED — a blank member is dropped, not joined into the payload (142 §3)', async () => {
    // ⛔ 141 MEDIUM 2: `isUsableAnswer` filtered blanks to COUNT and `claudeAnswerText` joined the
    // ORIGINAL, so a mixed-blank value passed the guard and went out with the blank still in it —
    // `["the root", "   "]` → `"the root,    "`. Two readings of one answer, only one of them
    // checked. The values are now returned BY the check, so there is nothing else to forward.
    const { fq, handle, canUse, events, consumer } = await startFake()
    const answerP = canUse('AskUserQuestion', twoQuestions, toolOpts('tu_ms_mixed'))
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))

    await handle.respondUserInput('tu_ms_mixed', {
      kind: 'answer',
      answers: { q0: ['   ', 'agents', ''], q1: ['the root', '   '] },
    })
    expect(await answerP).toMatchObject({
      behavior: 'allow',
      updatedInput: {
        answers: {
          // Not `"   , agents, "`, and not `"the root,    "`.
          'which capabilities?': 'agents',
          'where should demo files go?': 'the root',
        },
      },
    })
    await handle.close()
    fq.end()
    await consumer
  })

  it('a surviving member is never TRIMMED — the label the model offered is what it gets back', async () => {
    // ⚠️ The non-vacuity of the line above. Emptiness is decided on the trimmed value; the value
    // itself is untouched, because an option label really can carry leading or trailing space and
    // answering with a string that is not one of the offered options is its own fabrication.
    //
    // ⛔ **142 reported the two layers disagreeing here; 143 papered over it; 146 removed both
    // halves.** 142 found that `UserInputCard.answer()` trims every chosen value while the adapter
    // does not — *"a pre-existing difference between the two layers, reported rather than
    // widened"*. 143 had to make membership work anyway, so it matched on the TRIMMED value and
    // substituted the option's own label. 145 MEDIUM 2 measured what that bought: a label padded
    // with NBSP, typed plainly into `Other`, was free-form on screen and a chosen label on the
    // wire, with the freeform signal dropped. The card stopped trimming, so matching can be exact,
    // and the second half below is the difference — it used to assert the substitution and now
    // asserts that no substitution happens.
    const { fq, handle, canUse, events, consumer } = await startFake()
    const padded = {
      questions: [
        {
          question: 'which indent?',
          header: 'Style',
          multiSelect: false,
          options: [{ label: '  two spaces', description: 'leading space is part of the label' }],
        },
      ],
    }
    const answerP = canUse('AskUserQuestion', padded, toolOpts('tu_pad'))
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.respondUserInput('tu_pad', { kind: 'answer', answers: { q0: ['  two spaces'] } })
    expect(await answerP).toMatchObject({
      behavior: 'allow',
      updatedInput: { answers: { 'which indent?': '  two spaces' } },
    })

    // ⛔ **The same word without the padding is a DIFFERENT answer, and it is carried as one**
    // (146). It is not the offered label — the label starts with two spaces — so it is the `Other`
    // answer this question allows, it reaches the provider as the user's own words rather than as a
    // label they never clicked, and Claude's one freeform slot says which it was. The old behaviour
    // silently rewrote this into `"  two spaces"`, telling the model a listed option had been
    // chosen.
    const trimmedP = canUse('AskUserQuestion', padded, toolOpts('tu_pad2'))
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'user_input_request').length).toBe(2),
    )
    await handle.respondUserInput('tu_pad2', { kind: 'answer', answers: { q0: 'two spaces' } })
    expect(await trimmedP).toMatchObject({
      behavior: 'allow',
      updatedInput: { answers: { 'which indent?': 'two spaces' }, response: 'two spaces' },
    })
    await handle.close()
    fq.end()
    await consumer
  })

  it('an answer that is NOT on the list is forwarded, and marked as freeform (143)', async () => {
    // ⛔ **The defect 141 MEDIUM 1 named, on the Claude half.** The pinned typings tell the model
    // *"There should be no 'Other' option, that will be provided automatically"* — so every question
    // with options has an escape the provider guarantees — while BroBot rendered a text field only
    // when `options.length === 0`, which that same instruction forbids. A user could not give an
    // answer the provider was waiting for.
    const { fq, handle, canUse, events, consumer } = await startFake()
    const answerP = canUse('AskUserQuestion', twoQuestions, toolOpts('tu_other'))
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    // The card says so, which is what lets it draw the field at all.
    expect(firstOfType(events, 'user_input_request').questions[0]!.allowOther).toBe(true)

    await handle.respondUserInput('tu_other', {
      kind: 'answer',
      answers: { q0: 'none of these — the exporter', q1: 'a subfolder' },
    })
    expect(await answerP).toMatchObject({
      behavior: 'allow',
      updatedInput: {
        // ⚑ **`answers` carries it, exactly where a label would have gone.** That is the shape the
        // model reads, and a typed answer is still the answer to its question.
        answers: {
          'which capabilities?': 'none of these — the exporter',
          'where should demo files go?': 'a subfolder',
        },
        // ⚑ **And `response` is how it is told APART from a label** — the pinned
        // `AskUserQuestionInput.response`, *"Freeform text the user typed instead of selecting a
        // structured option"*. It is the only field on Claude's shape that can carry the
        // distinction, because the per-question map is `question text → string` either way.
        response: 'none of these — the exporter',
      },
    })
    await handle.close()
    fq.end()
    await consumer
  })

  it('a chosen LABEL sets no freeform response — the paired positive (143)', async () => {
    // ⚠️ Without this, the test above passes on an adapter that stamps `response` onto every answer
    // it sends, which would tell the model every choice was typed.
    const { fq, handle, canUse, events, consumer } = await startFake()
    const answerP = canUse('AskUserQuestion', twoQuestions, toolOpts('tu_label'))
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.respondUserInput('tu_label', {
      kind: 'answer',
      answers: { q0: ['rendering', 'agents'], q1: 'a subfolder' },
    })
    const result = (await answerP) as { updatedInput: Record<string, unknown> }
    expect(result.updatedInput['answers']).toEqual({
      // Unchanged by 143: the label goes back verbatim, comma-joined for the multi-select one.
      'which capabilities?': 'rendering, agents',
      'where should demo files go?': 'a subfolder',
    })
    expect(Object.keys(result.updatedInput)).not.toContain('response')
    await handle.close()
    fq.end()
    await consumer
  })

  it('several freeform answers travel in `answers` alone — `response` is singular (143)', async () => {
    // ⛔ **The honest limit of the field, asserted rather than papered over.** `response` is one
    // string and a call carries up to four questions; the pinned typings say nothing about which
    // question a freeform response belongs to, or how two would be expressed. Joining them would
    // invent a format no provider documents — which is the mistake 142 §5 caught in the other
    // direction, where a separator WE chose had been written down as the SDK's. So both typed
    // answers go where each is already against its own question, and `response` stays absent.
    const { fq, handle, canUse, events, consumer } = await startFake()
    const answerP = canUse('AskUserQuestion', twoQuestions, toolOpts('tu_two_other'))
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.respondUserInput('tu_two_other', {
      kind: 'answer',
      answers: { q0: 'the exporter', q1: 'somewhere else entirely' },
    })
    const result = (await answerP) as { updatedInput: Record<string, unknown> }
    expect(result.updatedInput['answers']).toEqual({
      'which capabilities?': 'the exporter',
      'where should demo files go?': 'somewhere else entirely',
    })
    expect(Object.keys(result.updatedInput)).not.toContain('response')
    await handle.close()
    fq.end()
    await consumer
  })

  it('a one-element list still answers a single-select question — the guard is about SEVERAL', async () => {
    // Non-vacuity for the two refusals above. `string | string[]` has been the neutral contract since
    // 033 for EVERY question, and a card that sends `['x']` for a one-of-n question is sending one
    // answer. A guard that refused every array would have broken that contract instead of the two
    // shapes it exists to stop.
    const { fq, handle, canUse, events, consumer } = await startFake()
    const answerP = canUse('AskUserQuestion', twoQuestions, toolOpts('tu_ms_one'))
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))

    await handle.respondUserInput('tu_ms_one', {
      kind: 'answer',
      answers: { q0: ['agents'], q1: ['the root'] },
    })
    expect(await answerP).toMatchObject({
      behavior: 'allow',
      updatedInput: {
        answers: { 'which capabilities?': 'agents', 'where should demo files go?': 'the root' },
      },
    })
    await handle.close()
    fq.end()
    await consumer
  })

  it('a multi-select question is safe-rejected like any other, and the turn continues (§4)', async () => {
    // `runtime.ts` requires every `user_input_request` to support safe rejection during
    // teardown. A measured `AskUserQuestion` yielded `user_decision:rejected`, then
    // `tool_result "declined by user" ok:false`, and the turn continued. A new question mode
    // must remain rejectable or it can hang the provider.
    const { fq, handle, canUse, events, consumer } = await startFake()
    const rejectP = canUse('AskUserQuestion', twoQuestions, toolOpts('tu_ms_rej'))
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))

    await handle.respondUserInput('tu_ms_rej', { kind: 'reject' })
    expect(await rejectP).toEqual({ behavior: 'deny', message: 'declined by user' })
    await handle.close()
    fq.end()
    await consumer
  })

  it('and close() safe-rejects a multi-select question nobody answered', async () => {
    // The other half of the same contract: teardown settles it, so a pending question cannot leave
    // the provider blocked on an answer that is never coming.
    const { fq, handle, canUse, events, consumer } = await startFake()
    const pendingP = canUse('AskUserQuestion', twoQuestions, toolOpts('tu_ms_close'))
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))

    await handle.close()
    fq.end()
    await consumer
    expect(await pendingP).toMatchObject({ behavior: 'deny' })
  })
})

/**
 * **A launched-auto session must still reach the human for a question** (063, from 061 finding 3).
 *
 * Every test here goes through {@link sdkToolCall}. That is not a style preference — it is the
 * entire subject. The adapter has always classified `AskUserQuestion` and `ExitPlanMode` as user
 * input rather than permission, and `handleCanUseTool` has always routed them to a card. What it
 * could not do was be REACHED: a session launched in auto is built with
 * `permissionMode: 'bypassPermissions'`, the guard hook yielded on sight of the mode, and the SDK
 * then approved the call before our callback was consulted. A correct classifier behind a door that
 * never opened.
 *
 * The tests that covered this called `canUseTool` by hand, so they exercised the classifier and
 * proved nothing about the door. Both shapes are here now: the fixed behaviour, and — right beside
 * it — the same call with the guard put back the way it was, so the failure is demonstrated rather
 * than described.
 */
describe('launched-auto and the tools only a human can answer (063)', () => {
  async function autoSession() {
    const ctx = await startFake({ approvalMode: 'auto' })
    ctx.fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(ctx.events, (e) => e.type === 'session'))
    await ctx.handle.send('go')
    // The other half of the defect, pinned: nothing below is interesting unless the mode really is
    // the one that answers before the callback.
    expect(ctx.sdkOptions().permissionMode).toBe('default')
    return ctx
  }

  /**
   * Wrap `canUseTool` so a test can assert it was NEVER consulted.
   *
   * "No card appeared" is the weaker claim and the one that was already asserted; it is satisfied
   * both by a callback that allowed the tool and by a callback nobody called. Only the second is the
   * bug, so the tests distinguish them.
   */
  function watched(options: Options): { options: Options; reached: string[] } {
    const reached: string[] = []
    const inner = options.canUseTool
    if (!inner) throw new Error('no canUseTool was supplied to the query')
    return {
      options: {
        ...options,
        canUseTool: (name, input, o) => {
          reached.push(name)
          return inner(name, input, o)
        },
      },
      reached,
    }
  }

  const QUESTION = {
    questions: [
      {
        question: 'which database?',
        header: 'DB',
        options: [
          { label: 'postgres', description: '' },
          { label: 'sqlite', description: '' },
        ],
      },
    ],
  }

  it('a QUESTION reaches the user and the turn waits for a real answer', async () => {
    const { handle, events, consumer, fq, sdkOptions } = await autoSession()
    const { options, reached } = watched(sdkOptions())

    const pending = sdkToolCall(options, 'AskUserQuestion', QUESTION, toolOpts('tu_q'))
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    expect(reached, 'the callback was consulted despite bypassPermissions').toEqual([
      'AskUserQuestion',
    ])
    const card = firstOfType(events, 'user_input_request')
    expect(card.questions).toEqual([
      // 143: this fixture's options carry `description: ''`, which is dropped rather than carried —
      // "the model gave no reason" gets ONE representation, so absent and empty cannot render as
      // two different things on the card.
      {
        id: 'q0',
        prompt: 'which database?',
        header: 'DB',
        options: [{ label: 'postgres' }, { label: 'sqlite' }],
        allowOther: true,
        multiSelect: false,
      },
    ])
    // ⚠️ **It WAITS.** This is the ruling, tested: an unattended session is unattended for
    // approvals, and a question has no answer to invent. Nothing auto-continues it.
    expect(handle.status()).toBe('waiting_permission')

    await handle.respondUserInput('tu_q', { kind: 'answer', answers: { q0: 'postgres' } })
    // The user's actual words are what goes back to the model — not a fabricated default.
    await expect(pending).resolves.toMatchObject({
      behavior: 'allow',
      updatedInput: { answers: { 'which database?': 'postgres' } },
    })

    fq.end()
    await handle.close()
    await consumer
  })

  it('a PLAN reaches the user, with the plan document, and waits', async () => {
    const { handle, events, consumer, fq, sdkOptions } = await autoSession()
    const { options, reached } = watched(sdkOptions())

    const pending = sdkToolCall(
      options,
      'ExitPlanMode',
      { plan: '## Step 1\nrewrite everything' },
      toolOpts('tu_plan'),
    )
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    expect(reached).toEqual(['ExitPlanMode'])
    // The plan itself is published before the card that asks about it (030) — the user approves a
    // document they were shown, in yolo exactly as in ask.
    expect(events.some((e) => e.type === 'plan_update')).toBe(true)
    expect(handle.status()).toBe('waiting_permission')

    await handle.respondUserInput('tu_plan', { kind: 'answer', answers: {} })
    await expect(pending).resolves.toEqual({ behavior: 'allow' })

    fq.end()
    await handle.close()
    await consumer
  })

  /**
   * ⚠️ **NON-VACUITY, in the shape 050 established.** The same session, the same model of the SDK,
   * the same question — with the guard put back the way it was: yielding the moment it sees `auto`.
   * `hooks: undefined` is that policy in one line, because yielding for every tool and not being
   * installed at all are the same thing to the SDK.
   *
   * Under it the call never reaches our callback, no card is published, and the model is told the
   * tool was approved. That is what 061 found, reproduced. Without this test, the two above prove
   * only that some arrangement of the code asks the user.
   */
  it('…and with the guard yielding in auto, as it did, the question vanishes', async () => {
    const { handle, events, consumer, fq, sdkOptions } = await autoSession()
    // ⚠️ **`permissionMode` is written in explicitly, and 140 is why.** This control is a
    // reconstruction of the code 063 removed, and that code had TWO halves: no guard, and a launch
    // that asked for `bypassPermissions`. 140 stopped asking for the second — the CLI had been
    // overriding it to `default` on every launch anyway — so a control that inherited the mode from
    // production would silently stop reconstructing the defect and start reconstructing today.
    const { options, reached } = watched({
      ...sdkOptions(),
      hooks: undefined,
      permissionMode: 'bypassPermissions',
    })

    const before = events.length
    await expect(
      sdkToolCall(options, 'AskUserQuestion', QUESTION, toolOpts('tu_lost')),
      'the SDK answers for the user before anything of ours runs',
    ).resolves.toEqual({ behavior: 'allow' })
    await new Promise((r) => setTimeout(r, 20))

    expect(reached, 'the callback that classifies it was never consulted').toEqual([])
    expect(
      events.slice(before).filter((e) => e.type === 'user_input_request'),
      'nobody was asked, and the agent proceeds on an answer it invented',
    ).toHaveLength(0)
    expect(handle.status()).not.toBe('waiting_permission')

    fq.end()
    await handle.close()
    await consumer
  })

  it('ORDINARY tools still run unattended — the guard did not swallow yolo', async () => {
    // Acceptance 3, and the hazard 056 named. The user-input check sits ABOVE the mode check now, so
    // the risk is that it catches more than it should. Every one of these must be approved without a
    // card and without a question.
    //
    // ⚠️ **What it must NOT still assert is that the callback goes unconsulted** (140). That was a
    // property of `bypassPermissions`, which the SDK answers under before anything of ours runs —
    // and which this app has now stopped asking for, because the CLI was overriding it to `default`
    // on every launch regardless. Unattendedness comes from the early return INSIDE the callback,
    // which is the arrangement 034 chose and 080 measured; being consulted and allowing is the
    // point, not a regression. The claim that matters — nobody was asked — is unchanged below.
    const { handle, events, consumer, fq, sdkOptions } = await autoSession()
    const { options, reached } = watched(sdkOptions())

    const before = events.length
    for (const [i, tool] of ['Bash', 'Write', 'WebFetch', 'Task', 'SomeUnknownMcpTool'].entries()) {
      await expect(
        sdkToolCall(options, tool, { command: 'rm -rf ./build' }, toolOpts(`tu_ord_${i}`)),
        tool,
      ).resolves.toEqual({ behavior: 'allow' })
    }
    expect(reached, 'every one of them passed through the callback that allowed it').toEqual([
      'Bash',
      'Write',
      'WebFetch',
      'Task',
      'SomeUnknownMcpTool',
    ])
    expect(events.slice(before).filter((e) => e.type === 'permission_request')).toHaveLength(0)
    expect(events.slice(before).filter((e) => e.type === 'user_input_request')).toHaveLength(0)

    fq.end()
    await handle.close()
    await consumer
  })

  it('EnterPlanMode is routed to the callback and allowed there — no card, run continues (056)', async () => {
    // The narrow exemption, now reached by a longer road and arriving at the same place. The guard
    // forces `ask` for every member of USER_INPUT_TOOLS, so this call DOES consult the callback —
    // where `CONSENT_ONLY_USER_INPUT` allows it with no card, because its input is `{}` and
    // consenting to it makes the agent do less. One classifier, one decision, one outcome.
    const { handle, events, consumer, fq, sdkOptions } = await autoSession()
    const { options, reached } = watched(sdkOptions())

    const before = events.length
    await expect(sdkToolCall(options, 'EnterPlanMode', {}, toolOpts('tu_enter'))).resolves.toEqual({
      behavior: 'allow',
    })
    expect(reached, 'it went through the classifier rather than around it').toEqual([
      'EnterPlanMode',
    ])
    expect(
      events.slice(before).filter((e) => e.type === 'user_input_request'),
      'an unattended run does not stop for a tool that carries nothing to decide',
    ).toHaveLength(0)
    expect(handle.status()).not.toBe('waiting_permission')

    fq.end()
    await handle.close()
    await consumer
  })

  it('in ASK mode a question is unchanged — the guard forces the same ask it always did', async () => {
    // Acceptance 6's neighbour: the mode that was never broken must stay byte-identical. A session
    // launched in ask keeps `permissionMode: 'default'`, so the callback was always reached; the
    // guard now forces `ask` for this tool instead of falling through to the consequential-tool
    // branch, and the outcome must not move.
    const ctx = await startFake({ approvalMode: 'ask' })
    ctx.fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(ctx.events, (e) => e.type === 'session'))
    await ctx.handle.send('go')
    expect(ctx.sdkOptions().permissionMode).toBe('default')

    const pending = sdkToolCall(ctx.sdkOptions(), 'AskUserQuestion', QUESTION, toolOpts('tu_ask'))
    await vi.waitFor(has(ctx.events, (e) => e.type === 'user_input_request'))
    await ctx.handle.respondUserInput('tu_ask', { kind: 'answer', answers: { q0: 'sqlite' } })
    await expect(pending).resolves.toMatchObject({
      behavior: 'allow',
      updatedInput: { answers: { 'which database?': 'sqlite' } },
    })

    ctx.fq.end()
    await ctx.handle.close()
    await ctx.consumer
  })

  it('every consent-only tool is also a user-input tool — the invariant 063 made load-bearing', () => {
    /**
     * ⚠️ **A cross-set dependency that was documentation-only until now** (063 review).
     *
     * `CONSENT_ONLY_USER_INPUT` is consulted INSIDE the `USER_INPUT_TOOLS` branch of
     * `handleCanUseTool`, and since 063 the guard hook routes a call to that callback only if it is
     * in `USER_INPUT_TOOLS`. So a name added to the exemption alone would be doubly unreachable: in
     * a launched-auto session the guard would yield, the SDK would approve before the callback, and
     * the exemption would sit there doing nothing; in ask mode the same call would fall through to
     * the consequential-tool branch and raise a permission card — the opposite of what an entry in
     * an exemption list looks like it does.
     *
     * The sets are module-private, so this reads them off the source in the 051 style: the
     * composition root's own test proves a policy stayed out of a file it cannot import, and this
     * proves a relationship between two literals no type can express.
     */
    const src = CLAUDE_IMPLEMENTATION.map((leaf) =>
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src', leaf), 'utf8'),
    ).join('\n')
    const namesIn = (declaration: string): string[] => {
      const body = src.match(
        new RegExp(`const ${declaration} = new Set(?:<string>)?\\(\\[?([^\\)]*)`),
      )
      expect(body, `${declaration} is no longer declared the way this test reads it`).not.toBeNull()
      return [...(body?.[1] ?? '').matchAll(/'([^']+)'/g)].flatMap((m) => m[1] ?? [])
    }
    const userInput = namesIn('USER_INPUT_TOOLS')
    const consentOnly = namesIn('CONSENT_ONLY_USER_INPUT')

    // Non-vacuity: a regex that stopped matching would otherwise make the subset check trivially
    // true against two empty lists.
    expect(userInput).toContain('AskUserQuestion')
    expect(consentOnly.length).toBeGreaterThan(0)
    for (const tool of consentOnly) {
      expect(userInput, `${tool} is exempted but never routed to the callback`).toContain(tool)
    }
  })

  it('a session grant cannot answer a question — the guard checks user input first', async () => {
    // Defence in depth, and cheap. `SessionGrants` is keyed by tool name, and nothing today can put
    // `AskUserQuestion` in it (these tools never surface a permission card, so no button grants
    // them). Ordering the checks so that a grant COULD NOT exempt one is what keeps that true if a
    // later change makes grants reachable from somewhere else.
    const { handle, events, consumer, fq, sdkOptions } = await autoSession()
    // Reach past the API and grant it directly — the state a future bug would have to produce.
    ;(handle as unknown as { sessionGrants: { grantAll(t: string): void } }).sessionGrants.grantAll(
      'AskUserQuestion',
    )

    const pending = sdkToolCall(sdkOptions(), 'AskUserQuestion', QUESTION, toolOpts('tu_granted'))
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    await handle.respondUserInput('tu_granted', { kind: 'answer', answers: { q0: 'postgres' } })
    await expect(pending).resolves.toMatchObject({ behavior: 'allow' })

    fq.end()
    await handle.close()
    await consumer
  })
})

/**
 * **Two open cards are one waiting session** (063, from 061 finding 7).
 *
 * Both brokers accept concurrent requests on purpose, and both adapters used to bracket each one
 * with its own `waiting_permission` → `working` pair. So answering either of two open cards told the
 * app the session was working again while the other was still on screen — the renderer showing a
 * card, the durable status saying running, and the stall watchdog counting the user's thinking time
 * as provider silence.
 *
 * ⚠️ **Every assertion here reads the delivered EVENTS, not `handle.status()`.** The cached status
 * moves the moment the adapter emits; the event reaches a consumer a queue-hop later. A negative
 * assertion taken between the two would pass on a broken build, so the waits below are on the event
 * list itself and each negative one is preceded by a flush.
 */
describe('the combined wait lease — Claude (063)', () => {
  async function twoCards() {
    const ctx = await startFake()
    ctx.fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(ctx.events, (e) => e.type === 'session'))
    await ctx.handle.send('go')
    return ctx
  }

  const statuses = (events: RuntimeEvent[], from: number): string[] =>
    events
      .slice(from)
      .filter((e) => e.type === 'status')
      .map((e) => e.state)

  /** Let every pending queue hop land, so "no `working` yet" means it, rather than "not yet". */
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

  it('a permission and a question: answering one leaves the session waiting', async () => {
    const { handle, events, consumer, fq, canUse } = await twoCards()
    const before = events.length

    const perm = canUse('Write', { file_path: '/tmp/x/f.txt' }, toolOpts('tu_perm'))
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const question = canUse(
      'AskUserQuestion',
      { questions: [{ question: 'which?', options: ['a', 'b'] }] },
      toolOpts('tu_q'),
    )
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))

    // ONE `waiting_permission`, not two. The second card changed the count and said nothing.
    expect(statuses(events, before)).toEqual(['waiting_permission'])
    expect(handle.status()).toBe('waiting_permission')

    await handle.respondPermission('tu_perm', { outcome: 'allow' })
    await expect(perm).resolves.toEqual({ behavior: 'allow' })
    await flush()
    // ⚠️ The finding, asserted: the question is still open, so the session is still waiting.
    expect(statuses(events, before), 'no `working` while a card is unanswered').toEqual([
      'waiting_permission',
    ])
    expect(handle.status()).toBe('waiting_permission')

    await handle.respondUserInput('tu_q', { kind: 'answer', answers: { q0: 'a' } })
    await question
    await vi.waitFor(() =>
      expect(statuses(events, before)).toEqual(['waiting_permission', 'working']),
    )

    fq.end()
    await handle.close()
    await consumer
  })

  it('…and the other way round: answering the QUESTION first also leaves it waiting', async () => {
    /**
     * ⚠️ **This test exists because its absence let a mutation live** (063 mutation M12). The test
     * above answers the permission first, so the user-input path is only ever the LAST wait to
     * close — and the last one closing is the one case where publishing per request and publishing
     * on the edge look identical. Reverting `handleUserInput` to its own bare `working` emit passed
     * the whole suite.
     *
     * Both adapters hold two brokers, so both have two orders, and a lease proven in one order is a
     * lease proven for one of the two paths that use it.
     */
    const { handle, events, consumer, fq, canUse } = await twoCards()
    const before = events.length

    const perm = canUse('Write', { file_path: '/tmp/x/g.txt' }, toolOpts('tu_pl'))
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const question = canUse(
      'AskUserQuestion',
      { questions: [{ question: 'which?', options: ['a', 'b'] }] },
      toolOpts('tu_ql'),
    )
    await vi.waitFor(has(events, (e) => e.type === 'user_input_request'))
    expect(statuses(events, before)).toEqual(['waiting_permission'])

    // The QUESTION settles first, and the permission card is still on screen.
    await handle.respondUserInput('tu_ql', { kind: 'answer', answers: { q0: 'b' } })
    await question
    await flush()
    expect(statuses(events, before), 'no `working` while the permission is unanswered').toEqual([
      'waiting_permission',
    ])

    await handle.respondPermission('tu_pl', { outcome: 'allow' })
    await perm
    await vi.waitFor(() =>
      expect(statuses(events, before)).toEqual(['waiting_permission', 'working']),
    )

    fq.end()
    await handle.close()
    await consumer
  })

  it('two permissions, resolved in the other order — same answer', async () => {
    // The count, not the kind. Two of one broker must behave exactly like one of each, or the lease
    // would only have fixed the case that happened to be tested.
    const { handle, events, consumer, fq, canUse } = await twoCards()
    const before = events.length

    const first = canUse('Bash', { command: 'echo one' }, toolOpts('tu_a'))
    const second = canUse('Bash', { command: 'echo two' }, toolOpts('tu_b'))
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(2),
    )
    expect(statuses(events, before)).toEqual(['waiting_permission'])

    await handle.respondPermission('tu_b', { outcome: 'deny' })
    await expect(second).resolves.toMatchObject({ behavior: 'deny' })
    await flush()
    expect(statuses(events, before)).toEqual(['waiting_permission'])

    await handle.respondPermission('tu_a', { outcome: 'allow' })
    await first
    await vi.waitFor(() =>
      expect(statuses(events, before)).toEqual(['waiting_permission', 'working']),
    )

    fq.end()
    await handle.close()
    await consumer
  })

  it('one card behaves exactly as it always did — waiting, then working', async () => {
    // The regression guard for the fix itself. A lease that never published would satisfy every
    // assertion above about `working` NOT appearing.
    const { handle, events, consumer, fq, canUse } = await twoCards()
    const before = events.length

    const only = canUse('Bash', { command: 'echo solo' }, toolOpts('tu_solo'))
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    expect(statuses(events, before)).toEqual(['waiting_permission'])

    await handle.respondPermission('tu_solo', { outcome: 'allow' })
    await only
    await vi.waitFor(() =>
      expect(statuses(events, before)).toEqual(['waiting_permission', 'working']),
    )

    fq.end()
    await handle.close()
    await consumer
  })

  it('closing under two open cards never claims the session went back to work', async () => {
    // `settleAll()` resolves both waits at once on teardown. Each takes the shutting-down exit,
    // which brings the count down WITHOUT publishing — a `working` on the way out would re-arm the
    // watchdog and rewrite the durable status of a session that is ending.
    const { handle, events, consumer, fq, canUse } = await twoCards()
    const before = events.length

    const perm = canUse('Bash', { command: 'echo one' }, toolOpts('tu_c1'))
    const question = canUse(
      'AskUserQuestion',
      { questions: [{ question: 'which?', options: ['a', 'b'] }] },
      toolOpts('tu_c2'),
    )
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(1),
    )

    await handle.close()
    await expect(perm).resolves.toMatchObject({ behavior: 'deny' })
    await expect(question).resolves.toMatchObject({ behavior: 'deny' })
    // Not an exact list: teardown legitimately emits the session's own terminal statuses after
    // this. What must never appear is `working` — the claim that the provider is driving again,
    // made on the way out of a session that is ending.
    expect(statuses(events, before)[0]).toBe('waiting_permission')
    expect(statuses(events, before), 'nothing said the session went back to work').not.toContain(
      'working',
    )
    expect(statuses(events, before).at(-1)).toBe('ended')

    fq.end()
    await consumer
  })
})

/**
 * 🔴 **695 · what the 0.3.281 bump asks of the launch and of the ask** — R35 and R36, pinned at the
 * adapter. The CLI's own behaviour on each is measured live by `probe:per-task-stop` and
 * `probe:permission-markers`; these pin what the product builds and emits.
 */
describe('695 · R35 — the launch declares the per-task stop it draws', () => {
  it('on a START and on a RESUME — both launches a person can press Stop in', async () => {
    const captured: Options[] = []
    const runtime = new ClaudeRuntime(
      (params) => {
        captured.push(params.options)
        return new FakeQuery()
      },
      async () => true,
    )
    const started = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    await started.close()
    const resumed = await runtime.resume(
      { provider: 'claude', sessionId: 'sess_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home' },
    )
    await resumed.close()
    expect(captured).toHaveLength(2)
    // ⚑ `true` and not merely present: the CLI reads `=== true`, and absence is the kill.
    for (const options of captured) expect(options.perTaskStopAffordance).toBe(true)
  })
})

describe('695 · R35 — a Stop tells a pending ask it was a Stop, not a closed session', () => {
  it('the ask is still refused, with the reason that is true for an agent the Stop spared', async () => {
    const { fq, handle, canUse, events, consumer } = await startFake()
    const pending = canUse('Write', { file_path: '/tmp/x/f' }, toolOpts('tu_stop'))
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    await handle.interrupt()
    expect(await pending).toEqual({
      behavior: 'deny',
      message: 'The person pressed Stop instead of answering this request.',
    })
    // ⚑ The control is `close() safe-rejects a pending permission` above: a close still says
    // *"session closed"*, because at a close that is true.
    await handle.close()
    fq.end()
    await consumer
  })
})
