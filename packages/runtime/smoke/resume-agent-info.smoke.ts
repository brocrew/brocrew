import { mkdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  query,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import {
  describeScan,
  pathsNaming,
  type Marker,
} from '../../../scripts/lib/personal-home-guard.mjs'
import {
  ClaudeRuntime,
  claudeKeychainTokenProvider,
  claudeProjectDirName,
  provisionProviderHome,
  type AgentInfo,
  type ClaudeQuery,
  type RuntimeEvent,
  type SessionHandle,
  type SessionRef,
} from '../src/index'

/**
 * **What a RESUMED Claude session says its model is** (179).
 *
 * `pnpm run probe:resume-agent-info`.
 *
 * The report: a live Claude conversation, answering normally, whose header reads
 * `provider: claude · model: … · reasoning: …` while the ledger holds
 * `model: claude-haiku-4-5-20251001`. The `…` is `describeAgent`'s "the provider has not said", and
 * the only thing that ever fills it in is `ClaudeSessionHandle`'s one assignment to `_agentInfo`:
 *
 * ```ts
 * if (message.type === 'system' && message.subtype === 'init' && message.model) { … }
 * ```
 *
 * ⚠️ **`SDKSystemMessage.model` is declared `string` (required) at 0.3.218 and still at 0.3.281
 * (`sdk.d.ts:5713`; `:4393` at 0.3.218) — and a declared field is not a sent field.** `model-effort-probe` is in this
 * directory for exactly that lesson. So this asks the wire the one question the type cannot answer:
 * does the init of a **resumed** query carry a model, and does the handle end up able to name one?
 *
 * Two sessions, one turn each, `haiku` — the started one is the PAIRED POSITIVE (175's rule: prove
 * both ends), because "a resumed session cannot name its model" is only a finding if a started one
 * can.
 *
 * ⚑ **The raw init lines are printed**, so the next reader can re-decide rather than trust this
 * file's summary.
 *
 * 🔒 A throwaway provider home under `tmpdir()`, a throwaway cwd, and the run FAILS if anything it
 * owns turns up in `~/.claude` or `~/.codex` (176's guard).
 */

const CHEAP_CLAUDE = 'claude-haiku-4-5-20251001'
const ASK = 'Reply with exactly one word: READY'
const TURN_MS = 300_000

/** Drain a handle's events into `sink`, answering nothing — no turn here needs a tool. */
function consume(handle: SessionHandle, sink: RuntimeEvent[]): Promise<void> {
  return (async () => {
    for await (const event of handle.events()) sink.push(event)
  })()
}

async function waitFor(pred: () => boolean, label: string): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > TURN_MS) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 200))
  }
}

/**
 * The real `query`, with every message it yields copied into `sink` on the way past.
 *
 * A Proxy rather than a hand-written delegate: `ClaudeQuery` carries optional methods
 * (`supportedModels`, `setModel`, `setPermissionMode`, …) and the adapter treats an absent one as a
 * provider that cannot do that thing — so a delegate that forgot one would change the behaviour
 * this probe is measuring.
 */
function teeing(
  sink: SDKMessage[],
): (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => ClaudeQuery {
  return (params) => {
    const inner = query(params) as unknown as ClaudeQuery
    return new Proxy(inner, {
      get(target, prop, receiver) {
        if (prop === Symbol.asyncIterator) {
          return async function* teed(): AsyncGenerator<SDKMessage> {
            for await (const message of target) {
              sink.push(message)
              yield message
            }
          }
        }
        const value = Reflect.get(target, prop, receiver) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as ClaudeQuery
  }
}

/** Every `system/init` in `messages`, as the two fields this dispatch turns on. */
function inits(messages: SDKMessage[]): { model: unknown; sessionId: unknown }[] {
  return messages
    .filter((m) => m.type === 'system' && (m as { subtype?: string }).subtype === 'init')
    .map((m) => ({
      model: (m as { model?: unknown }).model,
      sessionId: (m as { session_id?: unknown }).session_id,
    }))
}

const show = (info: AgentInfo | undefined): string => (info ? JSON.stringify(info) : 'undefined')

it('179 · a resumed claude session names the model it is running', async () => {
  const root = join(tmpdir(), `brobot2-resume-agent-info-${process.pid}`)
  rmSync(root, { recursive: true, force: true })
  const cwd = join(root, 'project')
  mkdirSync(cwd, { recursive: true })

  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `claude-resume-info-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)

  const tokenProvider = claudeKeychainTokenProvider()
  expect(tokenProvider(), 'the machine Keychain login is inheritable').not.toBeNull()

  const startedMessages: SDKMessage[] = []
  const resumedMessages: SDKMessage[] = []

  let ref: SessionRef | null
  let startedInfo: AgentInfo | undefined
  let resumedBefore: AgentInfo | undefined
  let resumedAfter: AgentInfo | undefined

  // ── the paired positive: a session STARTED with a model, after one turn ──────────────────────
  const starter = new ClaudeRuntime(teeing(startedMessages), undefined, tokenProvider)
  const started = await starter.start({ cwd, providerHome, model: CHEAP_CLAUDE })
  const startedEvents: RuntimeEvent[] = []
  const startedConsumer = consume(started, startedEvents)
  try {
    await started.send(ASK)
    await waitFor(() => startedEvents.some((e) => e.type === 'turn'), 'the started turn to end')
    startedInfo = started.agentInfo
    ref = started.ref
  } finally {
    await started.close()
    await startedConsumer
  }
  expect(ref, 'the started session named its conversation').not.toBeNull()

  // ── and the same conversation, RESUMED, exactly as `reopenSession` resumes one ───────────────
  const reopener = new ClaudeRuntime(teeing(resumedMessages), undefined, tokenProvider)
  const resumed = await reopener.resume(ref as SessionRef, {
    providerHome,
    // The RECORDED model, which is what the host replays from the row (038).
    model: CHEAP_CLAUDE,
  })
  const resumedEvents: RuntimeEvent[] = []
  const resumedConsumer = consume(resumed, resumedEvents)
  try {
    // Before any turn: nothing has been reported yet, and `…` here is honest.
    resumedBefore = resumed.agentInfo
    await resumed.send(ASK)
    await waitFor(() => resumedEvents.some((e) => e.type === 'turn'), 'the resumed turn to end')
    resumedAfter = resumed.agentInfo
  } finally {
    await resumed.close()
    await resumedConsumer
  }

  console.log(
    [
      '\n── 179 · what the handle can say about its model ──',
      `  started  · init lines : ${JSON.stringify(inits(startedMessages))}`,
      `  started  · agentInfo  : ${show(startedInfo)}`,
      `  resumed  · init lines : ${JSON.stringify(inits(resumedMessages))}`,
      `  resumed  · agentInfo before its first turn : ${show(resumedBefore)}`,
      `  resumed  · agentInfo AFTER  its first turn : ${show(resumedAfter)}`,
    ].join('\n'),
  )

  // 🔒 nothing of ours in a personal home (176)
  const markers: Marker[] = [
    { label: 'our cwd', value: claudeProjectDirName(cwd) },
    { label: 'our home', value: `claude-resume-info-${process.pid}` },
  ]
  // ⛔ See `model-effort-probe.smoke.ts` — the spread threw until 202 corrected the declaration.
  expect(
    describeScan(
      pathsNaming(join(homedir(), '.claude'), markers),
      pathsNaming(join(homedir(), '.codex'), markers),
    ),
    'nothing this run made is in a personal home',
  ).toBe('none')

  // The paired positive first: without it, the negative below says nothing about resume.
  expect(startedInfo?.model, 'a STARTED session names its model after one turn').toBe(CHEAP_CLAUDE)
  // ⛔ The dispatch's question.
  expect(resumedAfter?.model, 'a RESUMED session names its model after one turn').toBe(CHEAP_CLAUDE)

  rmSync(root, { recursive: true, force: true })
  rmSync(providerHome, { recursive: true, force: true })
}, 600_000)
