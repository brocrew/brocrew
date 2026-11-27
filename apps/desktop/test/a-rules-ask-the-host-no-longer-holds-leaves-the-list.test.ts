import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { oneReadAtATime } from '../src/renderer/src/lib/one-read-at-a-time'
import { limitsReadCadence } from '../src/renderer/src/lib/persons-queue'
import type { AnswerAck } from '../src/shared/runtime-ipc'
import { readScreenModules } from './lib/runtime-screen-source'

/**
 * 352 · *Waiting on you* keeps the last good asks when its look is refused. An ask that was ended
 * elsewhere (a rules write superseded it, another window settled it) then stays drawn, and its
 * Approve says "there is no request waiting by that name" for as long as the reads keep failing.
 * These run the screen's own look and decision against a look that is refused after the first.
 */

const SCREEN = readScreenModules('useRuntimeAttention', 'useRuntimeQueueActions')

function slice(from: string, to: string): string {
  const start = SCREEN.indexOf(from)
  const last = SCREEN.indexOf(to, start)
  const end = SCREEN.indexOf('\n}\n', last)
  if (start < 0 || last < 0 || end < 0) throw new Error(`the screen lost ${from}`)
  return SCREEN.slice(start, end + 2)
}

const LOOK = slice('let queueNoticePending = false', 'async function refreshLimitsDisplay(')
const DECIDE = slice('async function decideInstructionAsk(', 'async function decideInstructionAsk(')
/** Every ref the look and the decision write, each handed in as `{ value: null }`. */
const REFS = [...new Set([...`${LOOK}${DECIDE}`.matchAll(/\b(\w+)\.value\b/g)].map((m) => m[1]!))]

function javascript(source: string): string {
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
}

const NOT_WAITING: AnswerAck = {
  outcome: 'refused',
  reason: 'there is no request waiting by that name, so nothing was written',
  stillOpen: false,
}

function anAsk(askId: string) {
  return { conversation: 'sess_pm', at: 1, asked: { askId, about: 'worker', proposedBy: 'pm' } }
}

/** A screen whose first look lists `asks` and whose every later look is refused. */
function aScreen(asks: readonly ReturnType<typeof anAsk>[], ack: AnswerAck) {
  let looks = 0
  const store = {
    personsQueue: vi.fn(async () => {
      looks += 1
      if (looks > 1) return { refused: 'could not be read', published: { epoch: 'e', seq: looks } }
      return {
        questions: null,
        decisions: null,
        stalled: null,
        stopped: null,
        waitingOnWhoWrote: null,
        incidents: null,
        mcpServerRequests: null,
        instructionAsks: { rows: asks, rowsUnread: 0 },
        published: { epoch: 'e', seq: looks, covers: { instructionAsks: { complete: true } } },
      }
    }),
    readLimitsDisplay: vi.fn(async () => null),
  }
  const refs = Object.fromEntries(REFS.map((name) => [name, { value: null as unknown }]))
  const said: string[] = []
  const agentStore = { decideInstruction: vi.fn(async () => ack) }
  const context: Record<string, unknown> = {
    ...refs,
    store,
    agentStore,
    say: (words: string) => said.push(words),
    oneReadAtATime,
    lookAtLimits: limitsReadCadence(),
    limitsLane: { refresh: (read: () => Promise<unknown>) => read() },
    actionableReadsClosed: false,
    queueMicrotask,
  }
  const run = (body: string, name: string): unknown =>
    runInNewContext(`${javascript(body)}\n;${name}`, context)
  context.lookForWhatIsYours = run(LOOK, 'lookForWhatIsYours')
  const decide = run(DECIDE, 'decideInstructionAsk') as (
    askId: string,
    approve: boolean,
  ) => Promise<void>
  const listed = () =>
    ((refs.instructionAsks!.value ?? []) as ReturnType<typeof anAsk>[]).map(
      (one) => one.asked.askId,
    )
  return {
    look: context.lookForWhatIsYours as () => Promise<void>,
    decide,
    listed,
    said,
    agentStore,
    store,
    lastAskLookAnswered: () => refs.lastAskLookAnswered!.value,
  }
}

describe('352 · an ask the host no longer holds leaves Waiting on you', () => {
  it('drops an ask that was already ended, though the look after it is refused', async () => {
    const screen = aScreen([anAsk('iprop_gone'), anAsk('iprop_open')], NOT_WAITING)
    await screen.look()
    expect(screen.listed()).toEqual(['iprop_gone', 'iprop_open'])

    await screen.decide('iprop_gone', true)

    // Only the ask the host refused leaves; the other is still offered.
    expect(screen.listed()).toEqual(['iprop_open'])
    expect(screen.agentStore.decideInstruction).toHaveBeenCalledWith('iprop_gone', true)
    expect(screen.said).toEqual([NOT_WAITING.reason])
    expect(screen.store.personsQueue).toHaveBeenCalledTimes(2)
    expect(screen.lastAskLookAnswered()).toBe(false)
  })

  it.each([true, false])(
    'an Approve or Refuse it took (approve %s) leaves at once',
    async (approve) => {
      const screen = aScreen([anAsk('iprop_1')], { outcome: 'taken' })
      await screen.look()

      await screen.decide('iprop_1', approve)

      expect(screen.listed()).toEqual([])
      expect(screen.agentStore.decideInstruction).toHaveBeenCalledWith('iprop_1', approve)
      expect(screen.said).toEqual([])
      expect(screen.store.personsQueue).toHaveBeenCalledTimes(2)
    },
  )

  it('keeps an ask the host says is still open', async () => {
    const failed: AnswerAck = { outcome: 'refused', reason: 'the call failed', stillOpen: true }
    const screen = aScreen([anAsk('iprop_1')], failed)
    await screen.look()

    await screen.decide('iprop_1', true)

    expect(screen.said).toEqual(['the call failed'])
    expect(screen.listed()).toEqual(['iprop_1'])
  })
})
