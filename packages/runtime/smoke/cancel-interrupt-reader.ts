import type { CodexIncoming } from '../src/codex/codex-transport'

/**
 * 🔴 **The cancel-interrupt probe's reader, lifted out so a fixture can drive it** (`655`, from
 * `649` F1).
 *
 * ⛔ **`495` moved arm B's `turn/interrupt` INTO the reader and awaited it there.** The request
 * went out in the right continuation — directly after the declined result, as `codex-runtime.ts`'s
 * `handleAgentToolCall` sends it — but the reader then stopped reading until the interrupt
 * answered. Every frame the app-server sent in that window was stamped when it was DEQUEUED, so arm
 * B's `turn/completed` could never precede `interruptResolvedAt`, and the arrival window counted the
 * interrupt's round trip. ⚑ **An instrument whose timestamps are produced by its own await measures
 * itself.**
 *
 * ⚑ **Now the interrupt is sent in the same continuation and NOT awaited here.** Its settlement is
 * recorded when it happens, `interruptSettled()` lets the capture wait for it before tearing the
 * transport down, and the reader goes on stamping each frame as it arrives.
 * `test/cancel-interrupt-reader.test.ts` drives a `turn/completed` in while the interrupt is still
 * pending — the ordering the old reader could not produce.
 */

export type Plan =
  'never-answer' | 'answer-then-interrupt' | 'answer-only' | 'two-answer-one-then-interrupt'

export interface Stamped {
  readonly at: number
  readonly method: string
  readonly params: unknown
}

/** What the reader needs of a transport: the probe's `SpawnCodexTransport`, or a fixture's. */
export interface ReaderTransport {
  incoming(): AsyncIterable<CodexIncoming>
  respond(id: string | number, result: unknown): void
  respondError(id: string | number, code: number, message: string): void
  request(method: string, params: unknown): Promise<unknown>
}

/** Everything the reader saw, stamped by `since()` at the moment it saw it. */
export interface ArmReading {
  readonly notifications: Stamped[]
  readonly requests: Stamped[]
  toolCalls: number
  toolCallId: string | number | null
  toolCallAt: number | null
  answeredAt: number | null
  /** ⚠️ Whether the provider itself cleared an outstanding tool call, and when. */
  serverRequestResolvedAt: number | null
  interruptSentAt: number | null
  interruptResolvedAt: number | null
  interruptError: string | null
  failure: string | null
}

export interface ArmReader {
  readonly reading: ArmReading
  /** Settles when the plan's wanted number of `item/tool/call`s has arrived. */
  readonly wantedCallsReached: Promise<void>
  /** Arm B's interrupt, answered or its error recorded. Already settled for every other plan. */
  interruptSettled(): Promise<void>
  /** The loop itself; ends when the transport's incoming stream does. */
  readonly done: Promise<void>
}

/** ⚑ Arm D holds TWO calls open; every other arm waits for one. */
export const wantedCalls = (plan: Plan): number =>
  plan === 'two-answer-one-then-interrupt' ? 2 : 1

/** ⚠️ A bound on one promise (rule 13): a stalled call is NOT PERFORMED, never waited on. */
export async function bounded<T>(what: string, work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`NOT PERFORMED — ${what} did not answer in ${ms}ms`)),
          ms,
        )
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export function readArm(
  transport: ReaderTransport,
  options: {
    readonly plan: Plan
    /** The product's declined payload, which arms B, C and D answer with. */
    readonly declined: unknown
    /** Milliseconds since `turn/start` went out — the probe's one clock. */
    readonly since: () => number
    /** The thread and turn ids as bound so far; arm B needs both to interrupt. */
    readonly turn: () => { readonly threadId: string; readonly turnId: string }
    readonly rpcDeadlineMs: number
    /** For the JSON-RPC error answering a request this probe does not implement. */
    readonly probe: string
  },
): ArmReader {
  const { plan, since } = options
  const wanted = wantedCalls(plan)
  const reading: ArmReading = {
    notifications: [],
    requests: [],
    toolCalls: 0,
    toolCallId: null,
    toolCallAt: null,
    answeredAt: null,
    serverRequestResolvedAt: null,
    interruptSentAt: null,
    interruptResolvedAt: null,
    interruptError: null,
    failure: null,
  }
  let resolveWantedCalls!: () => void
  const wantedCallsReached = new Promise<void>((resolve) => {
    resolveWantedCalls = resolve
  })
  let interruptSettled: Promise<void> = Promise.resolve()

  const done = (async () => {
    for await (const incoming of transport.incoming()) {
      if (incoming.kind === 'notification') {
        reading.notifications.push({
          at: since(),
          method: incoming.method,
          params: incoming.params,
        })
        // ⚑ **The provider clearing its own outstanding request** — `051`'s `serverRequest/resolved`.
        if (
          incoming.method === 'serverRequest/resolved' &&
          reading.serverRequestResolvedAt === null
        ) {
          reading.serverRequestResolvedAt = since()
        }
        continue
      }
      reading.requests.push({ at: since(), method: incoming.method, params: incoming.params })
      if (incoming.method !== 'item/tool/call') {
        transport.respondError(
          incoming.id,
          -32601,
          `the ${options.probe} does not implement ${incoming.method}`,
        )
        continue
      }
      reading.toolCalls += 1
      reading.toolCallId = incoming.id
      if (reading.toolCallAt === null) reading.toolCallAt = since()
      // ⛔ **Arm A answers NOTHING here**, which is the blocked state the question is about.
      // ⚠️ **Arm D answers the FIRST and leaves the second outstanding**, which is the card the
      // person did not press anything on.
      const answers =
        plan === 'never-answer'
          ? false
          : plan === 'two-answer-one-then-interrupt'
            ? reading.toolCalls === 1
            : true
      if (answers) {
        transport.respond(incoming.id, options.declined)
        if (reading.answeredAt === null) reading.answeredAt = since()
      }
      // 🔴 **Arm B is the adapter's sequence**: the declined result and `turn/interrupt` in ONE
      // continuation, nothing asynchronous between them — and the interrupt is NOT awaited here.
      if (plan === 'answer-then-interrupt') {
        const { threadId, turnId } = options.turn()
        if (!threadId || !turnId) {
          reading.failure =
            'NOT PERFORMED — answer-then-interrupt reached the tool before turn/start bound its ids'
        } else {
          reading.interruptSentAt = since()
          const interrupt = transport.request('turn/interrupt', { threadId, turnId })
          interruptSettled = bounded('turn/interrupt', interrupt, options.rpcDeadlineMs).then(
            () => {
              reading.interruptResolvedAt = since()
            },
            (error: unknown) => {
              reading.interruptError = error instanceof Error ? error.message : String(error)
            },
          )
        }
      }
      if (reading.toolCalls >= wanted) resolveWantedCalls()
    }
  })()

  return { reading, wantedCallsReached, interruptSettled: () => interruptSettled, done }
}
