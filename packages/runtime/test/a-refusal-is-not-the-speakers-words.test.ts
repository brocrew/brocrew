import { readFileSync } from 'node:fs'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '../src/index'
import { claudeResultOutcome, normalizeMessage } from '../src/claude/normalize'
import { SubAgentTasks } from '../src/claude/sub-agent-tasks'
import { FileEdits } from '../src/claude/file-edits'
import { WorkflowTasks } from '../src/claude/workflow-tasks'
import { BackgroundTasks } from '../src/claude/background-tasks'
import { ClaudeMemoryStore } from '../src/claude/memory-store'
import { ToolAnswers } from '../src/tool-answer'
import { AnnouncedCli, recognisedRefusal } from '../src/claude/provider-refusal'
import { parseRuntimeEvent } from '../src/events'

/**
 * 🔴 **680 · a refusal is not the speaker's words — PM ruling R28, on the frames themselves.**
 *
 * ⚑ **Every frame below is one the SDK really handed this adapter**, kept by
 * `smoke/model-floor-refusal-probe.smoke.ts` on 2026-09-24 through the product's own `ClaudeRuntime`
 * and committed as `fixtures/claude-model-floor-refusal.json`. ⛔ The 0.3.218 refusal can never be
 * produced again once the pin is past the floor, which is why the frames are the test's input rather
 * than a description of them.
 *
 * The provider notice must not render as BroBot’s message followed by “claude reported an
 * error without saying what it was”. The notice already carries the reason and must be
 * attributed to the harness.
 */

interface Capture {
  readonly sdk: string
  readonly cli: string
  readonly arms: Record<string, SDKMessage[]>
}

const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/claude-model-floor-refusal.json', import.meta.url), 'utf8'),
) as { captures: Capture[] }

function arm(sdk: string, name: string): SDKMessage[] {
  const capture = FIXTURE.captures.find((one) => one.sdk === sdk)
  const frames = capture?.arms[name]
  if (!frames || frames.length === 0) throw new Error(`no ${name} frames at ${sdk}`)
  return frames
}

/** Every frame of one session through ONE set of registries — how the adapter reads them. */
function throughTheAdapter(frames: readonly SDKMessage[], announced = new AnnouncedCli()) {
  const tasks = new SubAgentTasks()
  const edits = new FileEdits()
  const runs = new WorkflowTasks()
  const background = new BackgroundTasks()
  const memory = new ClaudeMemoryStore()
  const answers = new ToolAnswers()
  return frames.flatMap((frame) =>
    normalizeMessage(frame, tasks, edits, runs, background, memory, answers, announced),
  )
}

const said = (events: readonly RuntimeEvent[]): string[] =>
  events.flatMap((e) => (e.type === 'assistant_message' ? [e.text] : []))
const errors = (events: readonly RuntimeEvent[]) =>
  events.flatMap((e) => (e.type === 'error' ? [e] : []))

/** The CLI's own assistant frame in an arm — the one carrying the error word. */
function refusalFrame(frames: readonly SDKMessage[]): SDKMessage & { type: 'assistant' } {
  const found = frames.find((f) => f.type === 'assistant' && typeof f.error === 'string')
  if (!found || found.type !== 'assistant') throw new Error('no refusal frame')
  return found
}

function noticeOf(frame: SDKMessage & { type: 'assistant' }): string {
  const content = frame.message.content as { type: string; text?: string }[]
  return content.map((block) => block.text ?? '').join('')
}

const FLOOR = arm('0.3.218', 'floor')
const FLOOR_NOTICE = noticeOf(refusalFrame(FLOOR))

describe('680 · the frames, as measured — the premises every test below stands on', () => {
  it('⚑ the floor refusal carries the marker, an error word, zero usage — and no isApiErrorMessage', () => {
    const frame = refusalFrame(FLOOR)
    const inner = frame.message as unknown as Record<string, unknown>
    expect(frame.error).toBe('unknown')
    expect(inner['model']).toBe('<synthetic>')
    expect((inner['usage'] as { output_tokens: number }).output_tokens).toBe(0)
    expect((frame as unknown as Record<string, unknown>)['isApiErrorMessage']).toBeUndefined()
    expect(FLOOR_NOTICE).toContain(
      'does not support this model; version 2.1.280 or newer is required',
    )
    expect(FLOOR_NOTICE).toContain("Run 'claude update'")
  })

  it('⚑ its cost is zero, and the result frame says so in its own fields', () => {
    const result = FLOOR.find((f) => f.type === 'result') as unknown as Record<string, unknown>
    expect(result['subtype']).toBe('success')
    expect(result['is_error']).toBe(true)
    expect(result['total_cost_usd']).toBe(0)
    expect(result['api_error_status']).toBe(400)
    expect(result['terminal_reason']).toBe('api_error')
    expect(result['result']).toBe(FLOOR_NOTICE)
  })

  it('⚑ the unknown id is refused as model_not_found with the same marker, at BOTH pins', () => {
    for (const sdk of ['0.3.218', '0.3.281']) {
      const frame = refusalFrame(arm(sdk, 'unknown'))
      expect(frame.error, sdk).toBe('model_not_found')
      expect((frame.message as unknown as Record<string, unknown>)['model'], sdk).toBe(
        '<synthetic>',
      )
    }
  })
})

describe('680 · R28a — the notice is never drawn as the speaker’s words', () => {
  it('🔴 the floor refusal: no assistant message, and the notice is on the error', () => {
    const events = throughTheAdapter(FLOOR)
    expect(said(events)).toEqual([])
    expect(errors(events).map((e) => e.message)).toEqual([FLOOR_NOTICE])
  })

  it('🔴 an unknown model id, at both pins: the same', () => {
    for (const sdk of ['0.3.218', '0.3.281']) {
      const frames = arm(sdk, 'unknown')
      const events = throughTheAdapter(frames)
      expect(said(events), sdk).toEqual([])
      expect(
        errors(events).map((e) => e.message),
        sdk,
      ).toEqual([noticeOf(refusalFrame(frames))])
    }
  })

  it('⛔ a reply cut at its output limit: the partial text stays the model’s, the notice is the CLI’s', () => {
    // The hazard on the path the ruling names, in the shape the CLI sends: the model's partial
    // reply — ONE text block, its real model, no error word — and then the CLI's own
    // `max_output_tokens` notice. "One text block and nothing else" would take the partial reply
    // for a notice; the marker does not.
    const refusal = refusalFrame(FLOOR)
    const partial = {
      ...refusal,
      error: undefined,
      message: {
        ...refusal.message,
        model: 'claude-opus-5',
        content: [{ type: 'text', text: 'the first half of a real answer' }],
      },
    } as unknown as SDKMessage
    const cut =
      "API Error: Claude's response exceeded the 32000 output token maximum. To configure this behavior, set the CLAUDE_CODE_MAX_OUTPUT_TOKENS environment variable."
    const notice = {
      ...refusal,
      error: 'max_output_tokens',
      message: { ...refusal.message, content: [{ type: 'text', text: cut }] },
    } as unknown as SDKMessage
    const events = throughTheAdapter([partial, notice])
    expect(said(events)).toEqual(['the first half of a real answer'])
    // ⚑ R28b and R28c: the sentence on `message`; the advice — an environment variable of a child
    // this app spawns — recognised, so a surface says what is true instead.
    expect(errors(events)).toEqual([
      {
        type: 'error',
        message: cut,
        fatal: false,
        refusal: { is: 'reply-cut-at-its-output-limit', limit: '32000' },
      },
    ])
  })

  it('⛔ and the SAME real-model frame with the refusal’s word also keeps its text', () => {
    // The word does not decide either: a real model's message beside any error word is the model's.
    const refusal = refusalFrame(FLOOR)
    const real = {
      ...refusal,
      message: { ...refusal.message, model: 'claude-opus-5' },
    } as unknown as SDKMessage
    expect(said(throughTheAdapter([real]))).toEqual([FLOOR_NOTICE])
  })
})

describe('680 · a notice with NO error word — the CLI’s own, by its flag', () => {
  // ⚑ Three notices carry `<synthetic>` and the frame's `is_api_error_message` and no `error`: a
  // tool call the model could not form twice, a raw model error, and a model-policy refusal. The
  // first, as the CLI writes it.
  const base = refusalFrame(arm('0.3.281', 'unknown'))
  const noWord = (flag: boolean) =>
    ({
      ...base,
      error: undefined,
      ...(flag ? {} : { is_api_error_message: undefined }),
      message: {
        ...base.message,
        content: [
          { type: 'text', text: "The model's tool call could not be parsed (retry also failed)." },
        ],
      },
    }) as unknown as SDKMessage

  it('⚑ the premise — the 0.3.281 frame carries the flag, snake-case, beside the marker', () => {
    expect((base as unknown as Record<string, unknown>)['is_api_error_message']).toBe(true)
  })

  it('🔴 it is not drawn as the speaker’s words, and its sentence is on the error', () => {
    const events = throughTheAdapter([noWord(true)])
    expect(said(events)).toEqual([])
    expect(errors(events)).toEqual([
      {
        type: 'error',
        message: "The model's tool call could not be parsed (retry also failed).",
        fatal: false,
      },
    ])
  })

  it('⛔ the control — the CLI’s own message WITHOUT the flag (a `/context` reply) stays where it is', () => {
    expect(said(throughTheAdapter([noWord(false)]))).toEqual([
      "The model's tool call could not be parsed (retry also failed).",
    ])
  })
})

describe('680 · R28b — our line never says the provider said nothing when it said something', () => {
  it('🔴 the floor refusal’s error is not "without saying what it was"', () => {
    for (const error of errors(throughTheAdapter(FLOOR))) {
      expect(error.message).not.toContain('without saying what it was')
      expect(error.fatal).toBe(false)
    }
  })

  it('⚑ a CLI message with no words at all still says the true thing', () => {
    const refusal = refusalFrame(FLOOR)
    const empty = {
      ...refusal,
      message: { ...refusal.message, content: [{ type: 'text', text: '  ' }] },
    } as unknown as SDKMessage
    expect(errors(throughTheAdapter([empty]))).toEqual([
      {
        type: 'error',
        message: 'claude reported an error without saying what it was',
        fatal: false,
      },
    ])
  })
})

describe('680 · R28c — the version floor, from the wire, with advice that works here', () => {
  it('🔴 the floor carries the model and both versions, read off the turn’s own system/init', () => {
    const [error] = errors(throughTheAdapter(FLOOR))
    expect(error?.refusal).toEqual({
      is: 'model-needs-a-newer-cli',
      model: 'claude-opus-5-5[1m]',
      needs: '2.1.280',
      runs: '2.1.218',
    })
    // …and the session stays open: the model is the conversation's own setting.
    expect(error?.fatal).toBe(false)
  })

  it('⚑ `runs` is the version the init ANNOUNCED — not a constant, not the notice’s own number', () => {
    // One fact apart: the init claims another version. A constant, or a read of the notice's
    // "Claude Code 2.1.218", would still say 2.1.218 here.
    const moved = FLOOR.map((frame) =>
      frame.type === 'system' && frame.subtype === 'init'
        ? ({ ...frame, claude_code_version: '2.1.999', model: 'claude-x[1m]' } as SDKMessage)
        : frame,
    )
    const [error] = errors(throughTheAdapter(moved))
    expect(error?.refusal).toEqual({
      is: 'model-needs-a-newer-cli',
      model: 'claude-x[1m]',
      needs: '2.1.280',
      runs: '2.1.999',
    })
  })

  it('⚑ the values survive the event contract — the parse the app runs before it stores or draws', () => {
    // ⛔ `apps/desktop`'s `toWireEvent` re-parses every event through this schema before the
    // ledger stores it, and a key the schema does not declare is stripped in silence — so a field
    // the adapter sets and the contract forgets would reach no reader at all.
    const [error] = errors(throughTheAdapter(FLOOR))
    expect(error?.refusal).toBeDefined()
    const parsed = parseRuntimeEvent(JSON.parse(JSON.stringify(error)))
    expect(parsed).toEqual({ ok: true, event: error })
  })

  it('⛔ no init seen — a replay — recognises nothing, and the reader gets the provider’s sentence', () => {
    const noInit = FLOOR.filter((f) => !(f.type === 'system' && f.subtype === 'init'))
    const [error] = errors(throughTheAdapter(noInit))
    expect(error?.refusal).toBeUndefined()
    expect(error?.message).toBe(FLOOR_NOTICE)
  })

  it('⛔ an unrecognised refusal carries no values: the unknown id is not a floor', () => {
    for (const sdk of ['0.3.218', '0.3.281']) {
      const [error] = errors(throughTheAdapter(arm(sdk, 'unknown')))
      expect(error?.refusal, sdk).toBeUndefined()
    }
  })

  it('⚑ the clause is what is read, so a rewording of the advice after it moves nothing', () => {
    const announced = new AnnouncedCli()
    announced.version = '2.1.218'
    announced.model = 'm'
    const reworded = FLOOR_NOTICE.replace(/Run .*$/, 'Some other advice entirely.')
    expect(reworded).not.toBe(FLOOR_NOTICE)
    const read = recognisedRefusal(reworded, announced)
    expect(read?.is === 'model-needs-a-newer-cli' ? read.needs : null).toBe('2.1.280')
    expect(recognisedRefusal('API Error: 400 something else entirely', announced)).toBeNull()
  })
})

describe('680 · the control — the same session, moved to a model this CLI can run, answers', () => {
  it('⚑ one reply, no error', () => {
    const events = throughTheAdapter(arm('0.3.218', 'changed'))
    expect(said(events)).toEqual(['ok'])
    expect(errors(events)).toEqual([])
  })

  it('the same conversation shape answers at 0.3.281 on the model refused by the 0.3.218 CLI', () => {
    const frames = arm('0.3.281', 'floor')
    const init = frames.find((f) => f.type === 'system' && f.subtype === 'init') as unknown as {
      model: string
      claude_code_version: string
    }
    expect(init.model).toBe('claude-opus-5-5[1m]')
    expect(init.claude_code_version).toBe('2.1.281')
    const events = throughTheAdapter(frames)
    expect(said(events)).toEqual(['ok'])
    expect(errors(events)).toEqual([])
  })
})

describe('680 · the refused turn FAILED — `is_error` on a `success` result', () => {
  const resultOf = (frames: readonly SDKMessage[]) => {
    const found = frames.find((f) => f.type === 'result')
    if (!found) throw new Error('no result frame')
    return found
  }

  it('🔴 the floor refusal’s result closes the turn failed, carrying the notice', () => {
    // `subtype: 'success'` means the CLI's loop exited normally; `is_error: true` says the turn
    // ended on the CLI's own notice. Read alone, the subtype told a parent *"it finished"*.
    expect(claudeResultOutcome(resultOf(FLOOR))).toEqual({
      outcome: 'failed',
      message: `turn failed: ${FLOOR_NOTICE}`,
    })
  })

  it('⚑ the control — the answered turn’s result, one field apart, closes completed', () => {
    const answered = resultOf(arm('0.3.218', 'changed')) as unknown as Record<string, unknown>
    expect(answered['subtype']).toBe('success')
    expect(answered['is_error']).toBe(false)
    expect(claudeResultOutcome(answered as unknown as SDKMessage)).toEqual({ outcome: 'completed' })
  })

  it('⚑ a failed success with no words still fails — and says nothing it does not have', () => {
    const bare = { ...resultOf(FLOOR), result: '' } as unknown as SDKMessage
    expect(claudeResultOutcome(bare)).toEqual({ outcome: 'failed' })
  })
})
