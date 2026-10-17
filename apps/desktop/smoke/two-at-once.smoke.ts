import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { findClaudeProgramHere } from '../src/main/runtime/claude-program'
import { createProviderRuntime } from '../src/main/runtime/provider-homes'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { runEvidence, runScratch } from '../../../packages/runtime/smoke/run-paths'

/**
 * 257 §3 · ⛔ **Two conversations at once, on two profiles, delivered to two surfaces.**
 *
 * `pnpm run probe:two-at-once`. `256` measured this and deliberately left nothing behind — correct
 * for an investigation, and it means the property it proved is now guarded by nothing. This is the
 * ONE shape worth keeping, not a re-run of the five it measured.
 *
 * ## What it asserts, and which half is the valuable one
 *
 *  1. **B starts while A is still `working`**, and both turns complete. That is the concurrency
 *     claim, and it is measured from the event stream rather than assumed from the wall clock.
 *  2. ⛔ **Every delivered message carries only its OWN sink's session id, and the other session's
 *     marker appears in nothing it was not addressed to.** This is the half that matters: cross-sink
 *     leakage would be invisible in a screenshot — two panes that both look busy and plausible — and
 *     catastrophic in use, because the thing that leaks is a conversation.
 *
 * ⚑ **Two real `RuntimeEventSink`s**, which is the main-process boundary that routes transcript
 * events to renderer owners. `256` reached for the same evidence when the in-app browser controller
 * was unavailable, and it is stronger than a pixel check anyway: a pane can only paint what its sink
 * was handed.
 *
 * ## ⚠️ What this is NOT
 *
 * It is not a test of the Codex sign-in port (`257` §1) or of the per-profile model menu (`257` §2) —
 * both are unit-tested, and neither can be provoked without a browser flow or a second real account.
 * It is not five shapes: same-profile Claude, two Codexes and the mixed pair all passed in `256` and
 * a regression guard that re-ran them would cost four more live turns to re-answer a settled
 * question.
 *
 * ## 🔒 What it touches
 *
 * A temp `userData` under this run's scratch, removed at the end; two profile homes inside it, named
 * for this probe; no session store (`NULL_SESSION_STORE`); no real profile, no `~/.claude` write
 * beyond what the CLI does inside the pinned per-profile `CLAUDE_CONFIG_DIR`. The cheapest model, one
 * short turn each — `smoke-test-policy`'s rule.
 */

/** Haiku, per the smoke policy: this measures ROUTING, and routing does not need a clever model. */
const MODEL = 'claude-haiku-4-5-20251001'

/** Long enough that a second turn can start inside it, short enough to stay cheap. */
const COUNT_TO = 40

const A = { profileId: 'two-at-once-a', marker: 'ROUTE_257_ALPHA' }
const B = { profileId: 'two-at-once-b', marker: 'ROUTE_257_BRAVO' }

function ask(marker: string): string {
  return (
    `Count from 1 to ${COUNT_TO}, one number per line, with no other words. ` +
    `Then, on the last line and by itself, write exactly: ${marker}`
  )
}

/** A sink that keeps everything it was handed, which is the whole instrument. */
class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly alive = true
  readonly messages: RuntimeEventMessage[] = []
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}

  /**
   * When this session first said `working`, and when its turn terminalized — epoch ms, or null.
   *
   * ⛔ **The two facts come from two different events, and the first draft of this read both off
   * `turn`.** `turn.state` is `completed | failed | interrupted` — endings only; *"working"* is a
   * `status`. So the probe waited sixty seconds for a word that event never carries, on a session
   * that was answering perfectly well. Found by running it, which is the only way it could be.
   */
  span(): { working: number | null; ended: number | null } {
    const working =
      this.messages.find((m) => m.event.type === 'status' && m.event.state === 'working')?.at ??
      null
    // ⚠️ EVERY ending, not just the happy one. A turn that failed or was interrupted still ended,
    // and reading only `completed` would report `never ended` for a run whose real finding is that a
    // turn failed — a silence exactly where the report needs to be loud.
    const ended = this.messages.find((m) => m.event.type === 'turn')?.at ?? null
    return { working, ended }
  }

  /** How the turn ended, in the provider's own word — `null` while it has not. */
  ending(): string | null {
    const turn = this.messages.find((m) => m.event.type === 'turn')
    return turn && turn.event.type === 'turn' ? turn.event.state : null
  }

  text(): string {
    return this.messages
      .map((m) => (m.event.type === 'assistant_message' ? m.event.text : ''))
      .join('\n')
  }
}

it(
  '257 §3 · two profiles, two sessions, two sinks — overlapped, and nothing crosses',
  { timeout: 5 * 60_000 },
  async () => {
    const home = runScratch('two-at-once')
    mkdirSync(home, { recursive: true })
    const userData = mkdtempSync(join(home, 'user-'))
    mkdirSync(join(userData, 'scratch'), { recursive: true })
    const cwdFor = (name: string): string => {
      const dir = join(userData, 'scratch', name)
      mkdirSync(dir, { recursive: true })
      return dir
    }
    let counter = 0
    const host = new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider) =>
        createProviderRuntime(provider, {
          codexCommand: () => {
            throw new Error('this probe runs Claude only')
          },
          // The Claude Code a development checkout runs, found by the app's own lookup.
          claudeProgram: () => findClaudeProgramHere({ isPackaged: false, given: undefined }).path,
        }),
      // ⛔ Two real, separate per-profile homes — the isolation the concurrency claim is about. They
      // are created here rather than by `prepareProviderHome`'s production path so that nothing this
      // probe does can reach the managed root under the real `userData`.
      prepareProviderHome: (provider, profileId) => {
        const home = join(userData, 'provider-homes', profileId, provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider, profileId) =>
        join(userData, 'provider-homes', profileId, provider),
      listProfiles: () => [A.profileId, B.profileId],
      resolveCwd: (sessionId, requested) => requested ?? cwdFor(sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: MODEL,
        authNote: null,
        files: [],
      }),
    })

    const sinkA = new RecordingSink('surface:a')
    const sinkB = new RecordingSink('surface:b')
    try {
      const a = await host.createSession(
        { provider: 'claude', profileId: A.profileId, cwd: cwdFor('a'), model: MODEL },
        sinkA,
      )
      // ⚠️ **Not awaited, but never unobserved.** `send` resolves once the provider has taken the
      // turn, which is at or after the `working` this then waits for — so awaiting it here would
      // serialize the very thing under test. ⛔ A rejection dropped on the floor, though, is how a
      // probe reports *"A never started working"* for a send that was refused in one sentence.
      const sentA = fireAndRemember(host.send(a.sessionId, ask(A.marker), sinkA))

      // ⛔ **B is started only once A is genuinely `working`** — the ordering `256` used, and the one
      // that makes "at once" a measurement rather than a hope. A poll, because the sink is a push
      // channel with nothing to await on.
      await until(
        () => sinkA.span().working !== null,
        60_000,
        () => why('A', sinkA, sentA),
      )
      const b = await host.createSession(
        { provider: 'claude', profileId: B.profileId, cwd: cwdFor('b'), model: MODEL },
        sinkB,
      )
      const sentB = fireAndRemember(host.send(b.sessionId, ask(B.marker), sinkB))
      await until(
        () => sinkB.span().working !== null,
        60_000,
        () => why('B', sinkB, sentB),
      )

      await until(
        () => sinkA.span().ended !== null,
        180_000,
        () => why('A', sinkA, sentA),
      )
      await until(
        () => sinkB.span().ended !== null,
        180_000,
        () => why('B', sinkB, sentB),
      )

      const spanA = sinkA.span()
      const spanB = sinkB.span()
      report({ a, b, sinkA, sinkB, spanA, spanB })

      // 1 · the overlap, stated as the inequality it is: B began before A was over.
      expect(spanB.working!, 'B started while A was still working').toBeLessThan(spanA.ended!)

      // 2 · both really answered, both COMPLETED, and each said its OWN marker. The ending is
      // asserted separately from the text because a turn can fail after saying something.
      expect([sinkA.ending(), sinkB.ending()]).toEqual(['completed', 'completed'])
      expect(sinkA.text()).toContain(A.marker)
      expect(sinkB.text()).toContain(B.marker)

      // 3 · ⛔ the routing assertion. Two claims, because one of them alone is weak: every message a
      // sink received is addressed to its own session, AND the other conversation's words are not in
      // it. The second is what a leak would actually look like — a correctly addressed envelope
      // carrying somebody else's text.
      expect(new Set(sinkA.messages.map((m) => m.sessionId))).toEqual(new Set([a.sessionId]))
      expect(new Set(sinkB.messages.map((m) => m.sessionId))).toEqual(new Set([b.sessionId]))
      expect(sinkA.text()).not.toContain(B.marker)
      expect(sinkB.text()).not.toContain(A.marker)
    } finally {
      await host.closeAll()
      rmSync(userData, { recursive: true, force: true })
    }
  },
)

async function until(ok: () => boolean, withinMs: number, complaint: () => string): Promise<void> {
  const deadline = Date.now() + withinMs
  while (!ok()) {
    if (Date.now() > deadline) throw new Error(`${complaint()} (waited ${withinMs} ms)`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/** A send whose refusal is REMEMBERED rather than swallowed — see the call site for why. */
function fireAndRemember(sent: Promise<void>): { refusal: string | null } {
  const held: { refusal: string | null } = { refusal: null }
  sent.catch((error: unknown) => {
    held.refusal = error instanceof Error ? error.message : String(error)
  })
  return held
}

/**
 * ⛔ **What a probe that timed out has to say.** *"A never started working"* on its own describes
 * every failure identically — a refused send, a provider that never launched, a turn word this file
 * spells differently from the app. The event types it DID receive are the difference.
 */
function why(which: string, sink: RecordingSink, sent: { refusal: string | null }): string {
  const kinds = [...new Set(sink.messages.map((m) => m.event.type))].join(', ') || 'nothing'
  return (
    `${which} did not get there: ${sink.messages.length} message(s) [${kinds}]` +
    `${sent.refusal ? ` · the send was refused: ${sent.refusal}` : ''}`
  )
}

function report(run: {
  a: { sessionId: string }
  b: { sessionId: string }
  sinkA: RecordingSink
  sinkB: RecordingSink
  spanA: { working: number | null; ended: number | null }
  spanB: { working: number | null; ended: number | null }
}): void {
  const overlap =
    run.spanA.ended !== null && run.spanB.working !== null ? run.spanA.ended - run.spanB.working : 0
  const lines = [
    '=== 257 §3 · two at once ===',
    `A ${run.a.sessionId} (${A.profileId}): ${run.sinkA.messages.length} messages, ` +
      `turn ${span(run.spanA)} → ${run.sinkA.ending() ?? 'still running'}`,
    `B ${run.b.sessionId} (${B.profileId}): ${run.sinkB.messages.length} messages, ` +
      `turn ${span(run.spanB)} → ${run.sinkB.ending() ?? 'still running'}`,
    `overlap: ${overlap} ms of A's turn ran with B's already started`,
    `cross-sink: A holds ${foreign(run.sinkA, run.a.sessionId)}, ` +
      `B holds ${foreign(run.sinkB, run.b.sessionId)} message(s) addressed elsewhere`,
  ]
  console.log(`\n${lines.join('\n')}\n`)
  writeFileSync(runEvidence('two-at-once.txt'), `${lines.join('\n')}\n`)
}

const span = (at: { working: number | null; ended: number | null }): string =>
  at.working !== null && at.ended !== null ? `${at.ended - at.working} ms` : 'never completed'

const foreign = (sink: RecordingSink, own: string): number =>
  sink.messages.filter((m) => m.sessionId !== own).length
