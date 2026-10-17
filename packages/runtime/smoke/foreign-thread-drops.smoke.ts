import { mkdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  describeScan,
  pathsNaming,
  type Marker,
} from '../../../scripts/lib/personal-home-guard.mjs'
import {
  CodexRuntime,
  CodexSessionHandle,
  codexAuthHealth,
  provisionCodexAuth,
  provisionProviderHome,
  type CodexIncoming,
  type CodexTransport,
  type RuntimeEvent,
  type SessionHandle,
  type TransportFactory,
} from '../src/index'
import { bundledCodexTransportFactory } from './bundled-codex'

/**
 * ⛔ **200 §3 · what does the thread gate actually refuse, on a real connection with real children?**
 *
 * `pnpm run probe:foreign-thread`.
 *
 * 200 replaced Codex's method-name scope predicate with a universal one: a notification whose
 * `threadId` is PRESENT and is not this session's is dropped before anything reads it. ⚠️ **A gate
 * is the one kind of fix that can hide the evidence it was needed** — after it lands, a provider
 * that stopped sending a frame and a gate that started eating it look identical from every surface
 * downstream. 184 hit exactly this (`probe:file-change` decided "did it arrive?" from the normalized
 * stream, and a gated frame never reaches the normalizer) and fixed it by counting at the transport.
 *
 * This run does both halves of that, deliberately:
 *
 *  * **the app's own counter** — `CodexSessionHandle.frameScope`, read at the first statement of
 *    `onNotification`, reporting `dropped` against the `seen` denominator; and
 *  * **an independent tee of the same wire**, which the gate cannot touch, so the counter is checked
 *    against something outside itself rather than believed.
 *
 * ## ⛔ The question 200 could not answer from the types, and named as the gap
 *
 * `135` established that DESCENDANT-thread frames arrive on the parent connection — that is how a
 * grandchild is known at all. ⚠️ **Nothing in this repo measures WHICH methods they arrive as.** If a
 * child's `error` or `turn/diff/updated` lands here, the gate now drops it, and that is a real
 * behaviour change hiding behind "it should not happen". So the tee below classifies every foreign
 * frame by method and prints them, whatever the answer turns out to be.
 *
 * ## ⛔ And the correction this run is the live proof of
 *
 * `thread/status/changed` carries a `threadId` that is deliberately NOT ours — the CHILD's — and it
 * is what ends a sub-agent card (033). A universal drop with no exemption would delete every
 * sub-agent card in the app. ⚠️ **This header used to add "the only completion signal Codex sends"
 * and "the only evidence a grandchild exists"; 226 measured both false** — the child's own
 * `turn/completed` says HOW it ended, and its birth announces the grandchild. Both are dropped here
 * as content and read as reports, which is what `adopted` below counts. ⚠️ **No test in this repo drove that method through a handle before 200**, so the whole
 * suite would have stayed green. This run asks a real Codex for two real sub-agents and fails if
 * their cards do not appear.
 *
 * 🔒 A throwaway provider home under `tmpdir()`, a throwaway cwd, and the run FAILS if anything it
 * owns turns up in `~/.claude` or `~/.codex` (176's guard).
 */

/** One incoming wire message, stamped with its arrival order. */
type Frame = CodexIncoming & { seq: number }

/** ⚠️ Kept in step with `THREAD_SUBJECT_METHODS` — the frames whose `threadId` is their subject. */
const SUBJECT_METHODS = new Set(['thread/status/changed'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function threadIdOf(params: unknown): string | undefined {
  if (!isRecord(params)) return undefined
  const value = params['threadId']
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * The real transport with every incoming frame copied into `sink` on the way past — 184's Proxy,
 * verbatim, for its reason: {@link CodexTransport} carries an optional `pid` accessor the host
 * reads, and a hand-written delegate that forgot it would change the thing being measured.
 */
function teeing(inner: TransportFactory, sink: Frame[]): TransportFactory {
  return (context) => {
    const transport = inner(context)
    return new Proxy(transport, {
      get(target, prop) {
        if (prop === 'incoming') {
          return (): AsyncIterable<CodexIncoming> => ({
            async *[Symbol.asyncIterator](): AsyncGenerator<CodexIncoming> {
              for await (const message of target.incoming()) {
                sink.push({ ...message, seq: sink.length + 1 })
                yield message
              }
            },
          })
        }
        const value = Reflect.get(target, prop, target) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as CodexTransport
  }
}

function consume(handle: SessionHandle, sink: RuntimeEvent[]): Promise<void> {
  return (async () => {
    for await (const event of handle.events()) sink.push(event)
  })()
}

async function waitFor(pred: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 200))
  }
}

/** `n` as a count with its own noun, so a zero never reads as a missing measurement. */
const tally = (entries: [string, number][]): string =>
  entries.length === 0 ? '(none)' : entries.map(([k, v]) => `${k} ×${v}`).join(', ')

it('200 · what the thread gate refuses on a real connection, and what the children send', async () => {
  const scratch = join(tmpdir(), `brobot2-foreign-thread-${process.pid}`)
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })

  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `codex-foreign-thread-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)
  await provisionCodexAuth(providerHome)

  const frames: Frame[] = []
  const runtime = new CodexRuntime(teeing(bundledCodexTransportFactory(), frames), codexAuthHealth)
  const handle = await runtime.start({ cwd: scratch, providerHome, approvalMode: 'ask' })
  const events: RuntimeEvent[] = []
  const consumer = consume(handle, events)

  try {
    // The ui smoke's step-17 prompt, because it is the one measured to actually produce two children
    // on this provider. No effort is requested — the ordinary default is what a user runs.
    await handle.send(
      'Spawn two sub-agents to work in parallel. Name the first `alpha` and ask it to report ' +
        'the operating system name. Name the second `beta` and ask it to report how many files ' +
        'are in the current working directory. Wait for both to finish, then give me their two ' +
        'answers as two bullet points. Do not write any files.',
    )
    // Approvals are answered as they arrive: `ask`'s sandbox (`workspace-write` since `736`, R96;
    // `read-only` before) may raise a card for a child's shell command, and an unanswered card
    // stalls the turn this run is waiting on.
    let answered = 0
    await waitFor(
      () => {
        for (const event of events.slice(answered)) {
          if (event.type === 'permission_request') {
            answered += 1
            void handle.respondPermission(event.id, {
              outcome: event.scope.availableDecisions.includes('allow') ? 'allow' : 'deny',
            })
          }
        }
        return events.some((e) => e.type === 'turn')
      },
      300_000,
      'the sub-agent turn to end',
    )

    const own = handle.ref?.sessionId ?? '(unknown)'
    const notifications = frames.filter((f) => f.kind === 'notification')
    const foreign = notifications.filter((f) => {
      const id = threadIdOf(f.params)
      return id !== undefined && id !== own
    })
    const byMethod = new Map<string, number>()
    const byThread = new Map<string, number>()
    for (const frame of foreign) {
      const method = frame.kind === 'notification' ? frame.method : ''
      byMethod.set(method, (byMethod.get(method) ?? 0) + 1)
      const id = threadIdOf(frame.params) ?? ''
      byThread.set(id, (byThread.get(id) ?? 0) + 1)
    }
    /** What the gate should have dropped: every foreign frame that is not a subject-method frame. */
    const droppable = foreign.filter(
      (f) => f.kind === 'notification' && !SUBJECT_METHODS.has(f.method),
    )
    const scope = (handle as CodexSessionHandle).frameScope
    const cards = events.filter((e) => e.type === 'sub_agent')

    console.log(
      [
        '\n── 200 §3 · the app’s own counter ──',
        `  our thread            : ${own}`,
        `  frames seen (gate)    : ${scope.seen}`,
        `  frames dropped (gate) : ${scope.dropped}`,
        // ⚑ **226's third number.** A dropped frame can still be a REPORT about one of our own
        // children — its birth, its token usage, its `turn/completed` — and this says how many were
        // read that way. It is a subset of `dropped`, never a deduction from it, which is what
        // keeps the equality below meaning what it meant.
        `  …of which adopted     : ${scope.adopted} (reports about our own children)`,
        `  dropped, by method    : ${tally(Object.entries(scope.byMethod))}`,
        '\n── …and the independent tee of the same wire ──',
        `  notifications teed    : ${notifications.length}`,
        `  naming another thread : ${foreign.length}`,
        `  …of which droppable   : ${droppable.length} (the rest are subject-method frames)`,
        `  foreign, by method    : ${tally([...byMethod.entries()])}`,
        `  foreign threads seen  : ${byThread.size} · ${tally([...byThread.entries()])}`,
        '\n── ⛔ the gap 200 named: do descendants send these on OUR connection? ──',
        `  error                 : ${byMethod.get('error') ?? 0}`,
        `  turn/diff/updated     : ${byMethod.get('turn/diff/updated') ?? 0}`,
        `  thread/settings/updated: ${byMethod.get('thread/settings/updated') ?? 0}`,
        `  model/rerouted        : ${byMethod.get('model/rerouted') ?? 0}`,
        '\n── and the cards the exemption exists for ──',
        `  sub-agent events      : ${cards.length} · ${cards
          .map((e) => (e.type === 'sub_agent' ? `${e.agentId.slice(0, 8)}:${e.phase}` : ''))
          .join(', ')}`,
      ].join('\n'),
    )

    // 🔒 nothing of ours in a personal home (176)
    //
    // ⛔ **This is where the broken declaration was FOUND**, by this probe throwing `its return
    // value is not iterable` on its first live run — reported in `200` §8, carried by `201` §8, and
    // corrected in `202`, because the same defect made `credential-ownership.smoke.ts` unrunnable
    // and that is the instrument `202`'s own acceptance 2 is measured by. The cast this block used
    // to carry is gone: `pathsNaming` is declared as returning a {@link Scan}, and `describeScan`
    // is the idiom — it cannot be spelled in a way that reads an unfinished walk as clean, which
    // was `196` M2's subject and the reason the fields exist at all.
    const markers: Marker[] = [
      { label: 'our home', value: `codex-foreign-thread-${process.pid}` },
      { label: 'our cwd', value: `brobot2-foreign-thread-${process.pid}` },
    ]
    expect(
      describeScan(
        pathsNaming(join(homedir(), '.claude'), markers),
        pathsNaming(join(homedir(), '.codex'), markers),
      ),
      'nothing this run made is in a personal home',
    ).toBe('none')

    // ⛔ **This run saw children at all.** A capture that spawned none measures nothing about a
    // thread gate and must fail rather than report a reassuring zero (168).
    expect(byThread.size, 'a foreign thread was on the wire at all').toBeGreaterThan(0)

    // ⛔ **The exemption, proved live.** Without it every one of these cards is gone — and the whole
    // unit suite stays green, because nothing else drives `thread/status/changed` through a handle.
    expect(cards.length, 'sub-agent cards survived the gate').toBeGreaterThan(0)

    // ⛔ **The counter is honest.** The app's own drop count is checked against a tee the gate cannot
    // reach, which is the only version of this claim that is not the gate certifying itself.
    //
    // ⚠️ **226 added a reader downstream of this counter and deliberately did NOT subtract from
    // it.** A frame naming a child's thread is still refused as content — that is what `dropped`
    // counts — and is additionally read for what it says about that child's card. Had `adopted`
    // been a deduction, this equality would have started failing against the wire and the only
    // check keeping the counter honest would have had to be relaxed to accommodate the change.
    expect(scope.dropped, 'the counter agrees with the wire').toBe(droppable.length)
    expect(
      scope.adopted,
      'a report is a subset of the refusals, never a deduction',
    ).toBeLessThanOrEqual(scope.dropped)
    // ⛔ **And it MOVED.** The inequality above holds by construction — `adopted` is incremented one
    // statement after `dropped`, so it passes with the whole 226 reader dead. This run has real
    // children (asserted above), every one of which sends its own token readings and its own
    // `turn/completed` naming its own thread; if none of them were read, that is the feature gone
    // and this is the only live instrument that would notice. Same argument, verbatim, as the
    // `cards.length > 0` assertion above it.
    expect(
      scope.adopted,
      "the children's own reports were read, not merely refused",
    ).toBeGreaterThan(0)
    expect(scope.seen, 'the denominator counts every notification the transport delivered').toBe(
      notifications.length,
    )
  } finally {
    await handle.close()
    await consumer
    rmSync(scratch, { recursive: true, force: true })
    rmSync(providerHome, { recursive: true, force: true })
  }
}, 600_000)
