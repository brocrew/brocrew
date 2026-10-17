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
  ClaudeRuntime,
  CodexRuntime,
  claudeKeychainTokenProvider,
  codexAuthHealth,
  provisionCodexAuth,
  provisionProviderHome,
  type ClaudeQuery,
  type CodexIncoming,
  type CodexTransport,
  type QueryFactory,
  type RuntimeEvent,
  type SessionHandle,
  type TransportFactory,
} from '../src/index'
import { bundledCodexTransportFactory } from './bundled-codex'

/**
 * ⛔ **Does a user ever learn they are being throttled?** (177 §1)
 *
 * `pnpm run probe:throttle`. Not part of `pnpm run ci` — it spawns both real providers.
 *
 * ## What this measures, and why it is a PAIR
 *
 * `074` set the rule for Claude: a rate-limit frame fires routinely, so making every one visible
 * would be noise; only a throttle the user is actually FEELING becomes a visible non-fatal error.
 * `177` found Codex's equivalent — `account/rateLimits/updated` — filed as `lifecycle` chatter,
 * which `transcript-mode.ts` drops entirely in the mode people read in. So a Codex user learned
 * nothing at all, while the app's own stall notice was left guessing at it in prose.
 *
 * ⚑ **A capability marked ✅ that nothing has ever watched fire is the same shape 176 §12 named**,
 * so both halves are asserted here and neither can pass without the other:
 *
 *  - **the negative** — the frame the provider REALLY sends, on this machine, right now, produces
 *    no visible error;
 *  - **the positive** — *the same frame, one field apart*, does.
 *
 * ⚠️ **The positive half is injected, and the injection is the honest part.** No rate limit has to
 * be hit — a test that waits for a real wall is a test that never runs — so the throttled frame is
 * the captured one with only the field the gate reads changed, replayed **through the real
 * transport and the real adapter** rather than handed to the normalizer directly. What is measured
 * is therefore the whole chain, and the two frames differ by exactly the thing being claimed.
 *
 * 🔒 Throwaway provider homes under `tmpdir()` only; the run fails if anything it owns turns up in
 * a personal home (176's `personal-home-guard`, never a before/after hash).
 */

const CHEAP_CLAUDE = 'haiku'

/** The one field the Codex gate reads for the wall — set on the injected copy, absent on the real one. */
const INJECTED_REACHED = 'rate_limit_reached'

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

/** Every visible non-fatal error the run produced, as sentences. */
function errorLines(events: RuntimeEvent[]): string[] {
  return events.flatMap((e) => (e.type === 'error' ? [e.message] : []))
}

/**
 * The payload of every `unknown` carrying `label` — which is to say every frame of that kind the
 * adapter kept QUIET, because a frame it turned into an error never becomes an `unknown` at all.
 *
 * ⚠️ **The two providers wrap `raw` differently and this reads both**: Codex wraps
 * `{method, params}` around its notification, Claude carries the SDK message itself. A version of
 * this that only knew Codex's shape returned `undefined` for every Claude frame and took the
 * assertion below down with it.
 */
function quietPayloads(events: RuntimeEvent[], label: string): Record<string, unknown>[] {
  return events.flatMap((e) => {
    if (e.type !== 'unknown' || e.label !== label) return []
    const raw = e.raw as Record<string, unknown>
    const params = raw['params']
    return [
      (typeof params === 'object' && params !== null ? params : raw) as Record<string, unknown>,
    ]
  })
}

/**
 * A transport that passes everything through and, the FIRST time it sees `method`, appends one
 * extra copy of the same notification with `mutate` applied.
 *
 * ⚠️ **A delegating object rather than a `Proxy` or a spread**, for `reject-question-probe`'s
 * reason: the adapter drives these five members and a wrapper that rebinds `this` is a way to break
 * one in a probe whose whole value is fidelity.
 */
function injectingOnce(
  factory: TransportFactory,
  method: string,
  mutate: (params: unknown) => unknown,
  onInject: (params: unknown) => void,
): TransportFactory {
  return (context) => {
    const inner = factory(context)
    let injected = false
    const wrapper: CodexTransport = {
      request: (m, p) => inner.request(m, p),
      notify: (m, p) => inner.notify(m, p),
      respond: (id, result) => inner.respond(id, result),
      respondError: (id, code, message) => inner.respondError(id, code, message),
      close: () => inner.close(),
      get pid() {
        return inner.pid
      },
      incoming: async function* (): AsyncIterable<CodexIncoming> {
        for await (const frame of inner.incoming()) {
          yield frame
          if (injected || frame.kind !== 'notification' || frame.method !== method) continue
          injected = true
          const params = mutate(frame.params)
          onInject(params)
          yield { kind: 'notification', method, params }
        }
      },
    }
    return wrapper
  }
}

/** The same tee `reject-question-probe` uses, plus a one-shot rewrite of a chosen message type. */
function injectingQuery(
  factory: QueryFactory,
  type: string,
  mutate: (message: Record<string, unknown>) => Record<string, unknown>,
  onInject: (message: unknown) => void,
): QueryFactory {
  return (params) => {
    const inner = factory(params)
    let injected = false
    const wrapper: ClaudeQuery = {
      [Symbol.asyncIterator]: async function* () {
        for await (const message of inner) {
          yield message
          const record = message as unknown as Record<string, unknown>
          if (injected || record['type'] !== type) continue
          injected = true
          const copy = mutate(record)
          onInject(copy)
          yield copy as never
        }
      },
      interrupt: () => inner.interrupt(),
      close: () => inner.close(),
      ...(inner.supportedModels ? { supportedModels: () => inner.supportedModels!() } : {}),
      ...(inner.setModel ? { setModel: (model?: string) => inner.setModel!(model) } : {}),
      ...(inner.setPermissionMode
        ? {
            setPermissionMode: (
              mode: Parameters<NonNullable<ClaudeQuery['setPermissionMode']>>[0],
            ) => inner.setPermissionMode!(mode),
          }
        : {}),
    }
    return wrapper
  }
}

it('codex: the routine frame is quiet, and the same frame throttled is not', async () => {
  const scratch = join(tmpdir(), `brobot2-throttle-codex-${process.pid}`)
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })

  const managedRoot = join(tmpdir(), 'brobot2-probe-homes')
  const homeName = `codex-throttle-${process.pid}-${Date.now()}`
  const providerHome = join(managedRoot, homeName)
  await provisionProviderHome(managedRoot, providerHome)
  await provisionCodexAuth(providerHome)

  let injectedSnapshot: unknown = null
  const factory = injectingOnce(
    bundledCodexTransportFactory(),
    'account/rateLimits/updated',
    // ⚑ **Exactly one field.** Everything else — the plan, the window, the percentage, the credits
    // — is whatever the provider just sent, so the two frames differ by the gate and nothing else.
    (params) => {
      const rate = (params as { rateLimits?: Record<string, unknown> })?.rateLimits ?? {}
      return { rateLimits: { ...rate, rateLimitReachedType: INJECTED_REACHED } }
    },
    (params) => {
      injectedSnapshot = params
    },
  )

  const runtime = new CodexRuntime(factory, codexAuthHealth)
  const handle = await runtime.start({ cwd: scratch, providerHome })
  const events: RuntimeEvent[] = []
  const consumer = consume(handle, events)
  let real: Record<string, unknown>[]
  let lines: string[]
  // ⛔ **`string`, not `ReturnType<typeof pathsNaming>`** (202). The old declaration made that alias
  // `Hit[]`, so `ourRollouts` was `undefined` and `describeHits(leaked)` was called on a scan
  // object — `probe:throttle` could not reach its own isolation verdict.
  let leaked: string
  let ourRollouts: number

  try {
    await handle.send('Reply with the single word: ok')
    await waitFor(() => events.some((e) => e.type === 'turn'), 300_000, 'the turn to end')
    // The injected copy rides the same stream as the frame it was made from, so by the time the
    // turn is over both have been through the adapter.
    real = quietPayloads(events, 'account/rateLimits/updated')
    lines = errorLines(events)

    console.log('\n=== the frame the provider really sent ===')
    console.log(JSON.stringify(real[0] ?? null, null, 1))
    console.log(`\nquiet frames recorded as chatter: ${real.length}`)
    console.log(`visible non-fatal errors: ${lines.length}`)
    for (const line of lines) console.log(`  · ${line}`)

    const markers: Marker[] = [{ label: 'our provider home', value: homeName }]
    const ref = handle.ref
    if (ref) markers.push({ label: 'our thread id', value: ref.sessionId })
    ourRollouts = pathsNaming(providerHome, markers).hits.length
    leaked = describeScan(pathsNaming(join(homedir(), '.codex'), markers))
  } finally {
    await handle.close()
    await consumer
    rmSync(scratch, { recursive: true, force: true })
    rmSync(providerHome, { recursive: true, force: true })
  }

  // ── the positive CONTROL: the frame arrives at all ──────────────────────────────────────────
  // ⛔ Without this the two assertions below are a scan for nothing. 174 measured this frame
  // arriving twice in an unrelated probe; here it is the subject, so its absence must be red.
  expect(
    real.length,
    'codex sent a rate-limit frame — otherwise this measures nothing',
  ).toBeGreaterThan(0)
  expect(injectedSnapshot, 'and the throttled copy was made from it').not.toBeNull()

  // ── the negative: the ROUTINE frame stays quiet (074's rule, on Codex) ───────────────────────
  //
  // ⚑ **`real` IS the negative**, and that is why it is read off the chatter rather than off the
  // absence of an error: a frame the gate had opened for would not be in this list at all. The
  // injected copy is proof of that in the same run — it is missing from here and present below.
  const routine = real[0] as { rateLimits?: Record<string, unknown> }
  expect(
    routine.rateLimits?.['rateLimitReachedType'] ?? null,
    'the real frame reports no wall',
  ).toBeNull()
  const used = (routine.rateLimits?.['primary'] as { usedPercent?: number } | null)?.usedPercent
  console.log(`\nthe real frame reported usedPercent=${String(used)} and stayed quiet`)

  // ── the positive: the SAME frame, one field apart, is visible ───────────────────────────────
  //
  // ⚠️ **Exactly one rate-limit line in the whole run.** Two would mean the routine frame spoke as
  // well, which is what a gate that had stopped reading content would produce — and a bare
  // "at least one" could not tell those apart.
  const throttled = lines.filter((line) => line.includes('rate-limit'))
  expect(throttled, 'one throttle line — the routine frame did not also speak').toHaveLength(1)
  expect(throttled[0]).toContain(`codex is rate-limited (${INJECTED_REACHED})`)
  expect(throttled[0]).toContain('the turn may stall until it resets')
  // The reset instant survives the round trip, in seconds→ms, from the provider's own field.
  expect(throttled[0]).toMatch(/; resets \d{4}-\d{2}-\d{2}T/)

  // ── 🔒 isolation, keyed to what this run owns (176) ──────────────────────────────────────────
  expect(ourRollouts, 'the isolated home holds this run own rollout').toBeGreaterThan(0)
  expect(leaked!, 'and nothing of ours is in ~/.codex').toBe('none')
}, 600_000)

it('claude: the routine frame is quiet, and the same frame rejected is not', async () => {
  const scratch = join(tmpdir(), `brobot2-throttle-claude-${process.pid}`)
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })

  const managedRoot = join(tmpdir(), 'brobot2-probe-homes')
  const homeName = `claude-throttle-${process.pid}-${Date.now()}`
  const providerHome = join(managedRoot, homeName)
  await provisionProviderHome(managedRoot, providerHome)

  let injectedMessage: unknown = null
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const factory = injectingQuery(
    query as unknown as QueryFactory,
    'rate_limit_event',
    (message) => {
      const info = (message['rate_limit_info'] ?? {}) as Record<string, unknown>
      // ⚑ One field again: `status`, which is the whole of `rateLimitThrottle`'s gate.
      return { ...message, rate_limit_info: { ...info, status: 'rejected' } }
    },
    (message) => {
      injectedMessage = message
    },
  )

  const runtime = new ClaudeRuntime(factory, undefined, claudeKeychainTokenProvider())
  const handle = await runtime.start({ cwd: scratch, providerHome, model: CHEAP_CLAUDE })
  const events: RuntimeEvent[] = []
  const consumer = consume(handle, events)
  let real: Record<string, unknown>[]
  let lines: string[]
  let leaked: string

  try {
    await handle.send('Reply with the single word: ok')
    await waitFor(() => events.some((e) => e.type === 'turn'), 300_000, 'the turn to end')
    real = quietPayloads(events, 'rate_limit_event')
    lines = errorLines(events)

    console.log('\n=== the frame the provider really sent ===')
    console.log(JSON.stringify(real[0] ?? null, null, 1))
    console.log(`\nquiet frames recorded as chatter: ${real.length}`)
    console.log(`visible non-fatal errors: ${lines.length}`)
    for (const line of lines) console.log(`  · ${line}`)

    const id = handle.ref?.sessionId
    const markers: Marker[] = [
      { label: 'our provider home', value: homeName },
      ...(id ? [{ label: 'our session id', value: id }] : []),
    ]
    leaked = describeScan(pathsNaming(join(homedir(), '.claude'), markers))
  } finally {
    await handle.close()
    await consumer
    rmSync(scratch, { recursive: true, force: true })
    rmSync(providerHome, { recursive: true, force: true })
  }

  // ⚠️ `quietPayloads` reads the CHATTER, so the count below is the quiet half by construction:
  // a frame the adapter turned into an error never becomes an `unknown` at all.
  expect(
    real.length,
    'claude sent a rate-limit frame — otherwise this measures nothing',
  ).toBeGreaterThan(0)
  expect(injectedMessage, 'and the rejected copy was made from it').not.toBeNull()

  const info = real[0]?.['rate_limit_info'] as { status?: unknown } | undefined
  expect(info?.status, 'the real frame is the routine `allowed` one').toBe('allowed')
  expect(
    lines.filter((line) => line.includes('approaching')),
    'a routine heartbeat produced no warning either',
  ).toEqual([])

  const throttled = lines.filter((line) => line.includes('claude is rate-limited'))
  expect(throttled, 'the rejected copy reached the user as a visible line').toHaveLength(1)
  expect(throttled[0]).toContain('the turn may stall until it resets')

  expect(leaked!, 'nothing of ours is in ~/.claude').toBe('none')
}, 600_000)
