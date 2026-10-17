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
 * ⛔ **What a rate-limit bucket actually looks like on the wire** (201 §2, from 192 H1).
 *
 * `pnpm run probe:ratelimit-baseline`. Not part of `pnpm run ci` — it spawns the real app-server on
 * a real credential.
 *
 * ## Why this exists rather than a unit fixture
 *
 * `201` had to choose whether BroBot calls `account/rateLimits/read` — the half of
 * `AccountRateLimitsUpdatedNotification`'s own sentence the app had never implemented — and then key
 * the sparse rolling updates by `limitId`. Both halves rest on facts about the provider that no
 * fixture can settle:
 *
 *  - ⛔ **does the pinned binary answer `account/rateLimits/read` at all**, and does it fill
 *    `rateLimitsByLimitId` or only the backward-compatible single-bucket `rateLimits` view;
 *  - ⛔ **does every rolling frame carry its `limitId`**, or do sparse ones drop it — which decides
 *    whether an unnamed frame can be merged into a named bucket at all;
 *  - ⚑ **and how many buckets a real account has**, which is what the multi-bucket sentence is for.
 *
 * ⚠️ **The app's own baseline is checked against an INDEPENDENT read on the same transport** — 200's
 * rule, and the only version of this claim that is not the feature certifying itself: the probe tees
 * the transport, records what the adapter asked for, and then asks the same question itself.
 *
 * 🔒 Throwaway provider home under `tmpdir()` only; the run fails if anything it owns turns up in a
 * personal home (176's `personal-home-guard`).
 */

/** One request the adapter made, with what came back. */
interface Exchange {
  method: string
  result?: unknown
  error?: string
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

/**
 * A transport that records every request the adapter makes and every notification it receives, and
 * hands the probe a way to ask its OWN question on the same connection.
 *
 * ⚠️ **A delegating object rather than a `Proxy`**, for `throttle-probe`'s reason: the adapter drives
 * these five members and a wrapper that rebinds `this` is a way to break one in a probe whose whole
 * value is fidelity.
 */
function teeing(
  factory: TransportFactory,
  exchanges: Exchange[],
  notifications: { method: string; params: unknown }[],
  onTransport: (transport: CodexTransport) => void,
): TransportFactory {
  return (context) => {
    const inner = factory(context)
    const wrapper: CodexTransport = {
      request: async (m, p) => {
        try {
          const result = await inner.request(m, p)
          exchanges.push({ method: m, result })
          return result
        } catch (error) {
          exchanges.push({ method: m, error: String(error) })
          throw error
        }
      },
      notify: (m, p) => inner.notify(m, p),
      respond: (id, result) => inner.respond(id, result),
      respondError: (id, code, message) => inner.respondError(id, code, message),
      close: () => inner.close(),
      get pid() {
        return inner.pid
      },
      incoming: async function* (): AsyncIterable<CodexIncoming> {
        for await (const frame of inner.incoming()) {
          if (frame.kind === 'notification') {
            notifications.push({ method: frame.method, params: frame.params })
          }
          yield frame
        }
      },
    }
    onTransport(inner)
    return wrapper
  }
}

/**
 * Which metered buckets a `GetAccountRateLimitsResponse` names, sorted.
 *
 * ⚠️ Reads `rateLimitsByLimitId` — *"the multi-bucket view keyed by metered `limit_id`"* — and falls
 * back to the single-bucket view's own id, which is what a server that filled only the
 * backward-compatible field would give us.
 */
function bucketsOf(response: unknown): string[] {
  const record = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  const top = record(response)
  const byId = record(top?.['rateLimitsByLimitId'])
  if (byId) return Object.keys(byId).sort()
  const id = record(top?.['rateLimits'])?.['limitId']
  return typeof id === 'string' ? [id] : []
}

/** Every `rateLimits` payload the provider pushed, in arrival order. */
function rollingFrames(
  notifications: { method: string; params: unknown }[],
): Record<string, unknown>[] {
  return notifications.flatMap((frame) => {
    if (frame.method !== 'account/rateLimits/updated') return []
    const rate = (frame.params as { rateLimits?: unknown } | null)?.rateLimits
    return typeof rate === 'object' && rate !== null ? [rate as Record<string, unknown>] : []
  })
}

it('the baseline read answers, and every rolling frame says which bucket it is about', async () => {
  const scratch = join(tmpdir(), `brobot2-ratelimit-${process.pid}`)
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })

  const managedRoot = join(tmpdir(), 'brobot2-probe-homes')
  const homeName = `codex-ratelimit-${process.pid}-${Date.now()}`
  const providerHome = join(managedRoot, homeName)
  await provisionProviderHome(managedRoot, providerHome)
  await provisionCodexAuth(providerHome)

  const exchanges: Exchange[] = []
  const notifications: { method: string; params: unknown }[] = []
  let raw: CodexTransport | null = null
  const factory = teeing(bundledCodexTransportFactory(), exchanges, notifications, (transport) => {
    raw = transport
  })

  const runtime = new CodexRuntime(factory, codexAuthHealth)
  const handle = await runtime.start({ cwd: scratch, providerHome })
  const events: RuntimeEvent[] = []
  const consumer = consume(handle, events)

  try {
    await handle.send('Reply with the single word: ok')
    await waitFor(() => events.some((e) => e.type === 'turn'), 300_000, 'the turn to end')

    // ⛔ **The independent read** — the probe's own question, on the same connection, after the
    // adapter has had its turn. Nothing the app holds can make this answer differently.
    let independent: unknown = null
    let independentError: string | null = null
    try {
      independent = await (raw as unknown as CodexTransport).request(
        'account/rateLimits/read',
        undefined,
      )
    } catch (error) {
      independentError = String(error)
    }

    const asked = exchanges.filter((e) => e.method === 'account/rateLimits/read')
    const frames = rollingFrames(notifications)

    console.log('\n=== what the ADAPTER asked for ===')
    console.log(exchanges.map((e) => `  ${e.method}${e.error ? ` !! ${e.error}` : ''}`).join('\n'))
    console.log(`\n=== the app's own baseline read (${asked.length} call(s)) ===`)
    console.log(JSON.stringify(asked[0] ?? null, null, 1))
    console.log('\n=== the INDEPENDENT read, on the same transport ===')
    console.log(independentError ?? JSON.stringify(independent, null, 1))
    console.log(`\n=== every rolling frame (${frames.length}) ===`)
    for (const [index, frame] of frames.entries()) {
      console.log(` [${index}] ${JSON.stringify(frame)}`)
    }
    console.log('\n=== bucket identity, frame by frame ===')
    for (const [index, frame] of frames.entries()) {
      const id = frame['limitId']
      console.log(
        ` [${index}] limitId=${JSON.stringify(id)} limitName=${JSON.stringify(frame['limitName'])}` +
          ` keys=${Object.keys(frame).length}`,
      )
    }
    const named = frames.filter((f) => typeof f['limitId'] === 'string' && f['limitId'] !== '')
    console.log(`\nframes carrying a limitId: ${named.length}/${frames.length}`)

    const lines = events.flatMap((e) => (e.type === 'error' ? [e.message] : []))
    console.log(`\nvisible non-fatal lines: ${lines.length}`)
    for (const line of lines) console.log(`  · ${line}`)

    // 🔒 nothing of ours in a personal home (176).
    //
    // ⛔ **The cast 200 and 201 both carried is gone** — `202` corrected the declaration, so the
    // walk's real shape is what the compiler sees and `describeScan` is what asks it.
    const markers: Marker[] = [
      { label: 'our home', value: homeName },
      { label: 'our cwd', value: `brobot2-ratelimit-${process.pid}` },
    ]
    expect(
      describeScan(pathsNaming(join(homedir(), '.codex'), markers)),
      'nothing this run made is in ~/.codex',
    ).toBe('none')

    // ⛔ **The provider answered the read at all** — §2's whole choice rests on this one fact.
    expect(independentError, 'account/rateLimits/read is a method this binary supports').toBeNull()

    // ⛔ **The run saw a rolling frame.** A capture with none measures nothing about bucket keying
    // and must be red rather than report a reassuring zero (168).
    expect(frames.length, 'codex pushed at least one rate-limit frame').toBeGreaterThan(0)

    // ⛔ **The APP asked, exactly once per handle.** Without this the whole file measures the
    // provider and says nothing about BroBot — which is what it did on its first run, before 201's
    // adapter change existed.
    expect(asked, 'the adapter fetched its own baseline').toHaveLength(1)
    expect(asked[0]?.error, 'and got an answer rather than a failure').toBeUndefined()

    // ⛔ **Checked against something the feature cannot reach** (200's rule). The app's baseline and
    // an independent read on the same connection must name the same buckets; a seed that quietly
    // read the wrong field would agree with itself and with nothing else.
    expect(bucketsOf(asked[0]?.result)).toEqual(bucketsOf(independent))
    expect(
      bucketsOf(independent).length,
      'the account has at least one metered bucket',
    ).toBeGreaterThan(0)
  } finally {
    await handle.close()
    await consumer
    rmSync(scratch, { recursive: true, force: true })
    rmSync(providerHome, { recursive: true, force: true })
  }
}, 600_000)
