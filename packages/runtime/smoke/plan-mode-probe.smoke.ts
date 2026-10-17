import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import {
  buildChildEnv,
  ClaudeRuntime,
  claudeKeychainTokenProvider,
  provisionProviderHome,
  type RuntimeEvent,
  type SessionHandle,
} from '../src/index'

/**
 * 140 · **Does `permissionMode: 'plan'` still put the pinned CLI into plan mode?**
 *
 * ⛔ This probe exists because a real session, launched from the UI with plan mode ON, wrote a file
 * into the user's personal `~/.claude/plans/`. Its ledger says two things that cannot both be
 * comfortable:
 *
 *  - `provider_session.plan_mode = 1` — the launcher's request DID reach the store and the adapter;
 *  - every `type:'user'` transcript frame in that session carries `"permissionMode":"default"`, and
 *    the model's own `ExitPlanMode` came back *"You are not in plan mode. To enter plan mode, call
 *    the EnterPlanMode tool first."*
 *
 * ⚠️ **So the corpus can prove the request was made and that the CLI did not honour it, and it
 * cannot prove WHY.** The typings still document `'plan'` as *"Planning mode, no execution of
 * tools"*, which describes a version of the world where this works. That is exactly the "code and
 * SDK docs have repeatedly been wrong" trap, so this asks the provider instead.
 *
 * ## What it measures
 *
 * One session, launched through the REAL `ClaudeRuntime` with `planMode: true`, asked to write a
 * file. Three facts come back, and each is worth having on its own:
 *
 *  1. **What the CLI says the mode is** — from `system:init`, which carries `permissionMode`.
 *  2. **Whether the write happened** — `existsSync` on the canary, which is the only test that
 *     cannot be talked out of. A model that CHOOSES not to write proves nothing; a file on disk
 *     proves the read-only enforcement was not there.
 *  3. **Whether a plan file was allocated** — `<providerHome>/plans/`, which is where the CLI puts
 *     them once `CLAUDE_CONFIG_DIR` is pinned. Its absence is what made the model invent a path.
 *
 * 🔒 Temp home, temp cwd. Never `~/.claude`.
 *
 * Run: `pnpm run probe:plan-mode`. Not part of `pnpm run ci`.
 */

const CHEAP_CLAUDE = 'claude-haiku-4-5-20251001'
const CANARY = 'plan-mode-canary.txt'

/**
 * ⚠️ **Answering is part of the harness, not part of the measurement.** The first run of this probe
 * had no pump and sat in `waiting_permission` for the full 300 s — the same trap
 * `reject-question-probe` records. ⚑ **The default is Allow**, for the early probes whose question
 * was whether the CLI itself refuses a write. ⚠️ **Since `728` (R93) nothing of this app's refuses
 * one while planning — the CLI's plan mode ASKS** — so a test whose claim is *"nothing was written
 * while planning"* passes `() => 'deny'` and plays the person saying no; with Allow its claim would
 * only say the model did not try.
 */
function consume(
  handle: SessionHandle,
  sink: RuntimeEvent[],
  outcome: () => 'allow' | 'deny' = () => 'allow',
): Promise<void> {
  return (async () => {
    const seen = new Set<string>()
    for await (const event of handle.events()) {
      sink.push(event)
      if (event.type !== 'permission_request' || seen.has(event.id)) continue
      seen.add(event.id)
      await handle.respondPermission(event.id, { outcome: outcome() }).catch(() => {})
    }
  })()
}

async function waitFor(pred: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 200))
  }
}

it('does a plan-mode launch actually reach the CLI as plan mode — probe', async () => {
  const scratch = join(tmpdir(), `brobot2-plan-probe-${process.pid}`)
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })

  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `claude-plan-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)

  // ⚠️ **A spy, so "our side asked for it" is measured rather than read off the source.** Five
  // dispatches have had a stated mechanism disproved; this one prints the option our adapter
  // actually built, which is the only way to tell a missing call from an ignored one.
  let asked: unknown
  let shape: string[] = []
  const spy: typeof query = (args) => {
    const options = (args.options ?? {}) as Record<string, unknown>
    asked = options['permissionMode']
    shape = Object.entries(options).map(
      ([key, value]) =>
        `${key}=${key === 'env' ? `{${Object.keys(value as object).length} vars}` : JSON.stringify(value)?.slice(0, 100)}`,
    )
    // ⚠️ The adapter does not surface `system:init` as an event, so the CLI's own answer to "what
    // mode am I in" is invisible from the outside. Tapping the iterator is the only place it exists.
    const real = query(args)
    // ⛔ A Proxy, not a spread. Spreading a class instance drops its prototype methods — the very
    // methods this is here to watch — and a control that quietly removes `setPermissionMode` would
    // have "proved" the adapter never calls it.
    return new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === Symbol.asyncIterator) {
          return async function* () {
            for await (const message of target) {
              if (message.type === 'system' && message.subtype === 'init') {
                const init = message as unknown as Record<string, unknown>
                system.push(`init: permissionMode=${JSON.stringify(init['permissionMode'])}`)
              }
              yield message
            }
          }
        }
        const value = Reflect.get(target, prop, receiver)
        if (typeof value !== 'function' || typeof prop !== 'string') return value
        return (...callArgs: unknown[]) => {
          calls.push(`${prop}(${callArgs.map((a) => JSON.stringify(a)).join(', ')})`)
          return (value as (...a: unknown[]) => unknown).apply(target, callArgs)
        }
      },
    })
  }
  const calls: string[] = []
  const system: string[] = []
  const runtime = new ClaudeRuntime(spy, undefined, claudeKeychainTokenProvider())
  const handle = await runtime.start({
    cwd: scratch,
    providerHome,
    model: CHEAP_CLAUDE,
    // The whole subject of this probe: the launcher's checkbox, as the host passes it.
    planMode: true,
  })
  const events: RuntimeEvent[] = []
  const consumer = consume(handle, events)

  try {
    await handle.send(
      `Create a file named ${CANARY} in the current directory containing the single word HELLO. ` +
        `Use the Write tool. Then reply with the word DONE.`,
    )
    // ⛔ **The argv of the process that is actually running.** Every layer above this is a claim
    // about what was passed along; `ps` is the only reading that cannot be wrong about it. Taken
    // while the turn is in flight, because the child is gone by the time the turn ends.
    let argv = '(not captured)'
    try {
      argv = execSync(`ps ax -o args= | grep -- '--permission-mode' | grep -v grep`)
        .toString()
        .trim()
    } catch {
      argv = '(no process carried --permission-mode)'
    }
    await waitFor(() => events.some((e) => e.type === 'turn'), 300_000, 'the turn to end')

    console.log('\n=== the CLI process argv, read from ps while it ran ===')
    for (const line of argv.split('\n')) console.log(`  ${line.slice(0, 400)}`)

    console.log('\n=== what OUR adapter asked the SDK for ===')
    console.log(`Options.permissionMode: ${JSON.stringify(asked)}`)
    console.log('\n=== every Option our adapter built ===')
    for (const line of shape) console.log(`  ${line}`)
    console.log('\n=== every method the adapter called on the query ===')
    for (const line of calls) console.log(`  ${line}`)
    console.log('\n=== every system message the CLI sent ===')
    for (const line of system) console.log(`  ${line}`)

    // ── 1 · What the CLI says the mode is ────────────────────────────────────
    const modes: string[] = []
    for (const event of events) {
      if (event.type !== 'unknown') continue
      const json = JSON.stringify(event.raw)
      for (const match of json.matchAll(/"permissionMode":"([a-zA-Z]+)"/g)) modes.push(match[1]!)
    }
    console.log('\n=== what the CLI reported its permission mode to be ===')
    console.log(modes.length > 0 ? [...new Set(modes)].join(', ') : '(no frame carried one)')

    // ── 2 · Whether the write happened ───────────────────────────────────────
    const wrote = existsSync(join(scratch, CANARY))
    console.log('\n=== did a file appear on disk ===')
    console.log(`${CANARY}: ${wrote ? '⛔ WRITTEN' : '✅ absent'}`)

    // ── 3 · Whether a plan file was allocated ────────────────────────────────
    const plansDir = join(providerHome, 'plans')
    const plans = existsSync(plansDir) ? readdirSync(plansDir) : []
    console.log('\n=== plan files allocated in the app-owned home ===')
    console.log(plans.length > 0 ? plans.join(', ') : '(none)')

    console.log('\n=== every tool the model called ===')
    for (const event of events) {
      if (event.type === 'tool_call') console.log(`  ${event.name}`)
      if (event.type === 'tool_result')
        console.log(`    → ok=${event.ok} ${event.summary.slice(0, 240)}`)
    }

    console.log('\n=== every event type this run produced ===')
    const byType = new Map<string, number>()
    for (const event of events) byType.set(event.type, (byType.get(event.type) ?? 0) + 1)
    for (const [type, count] of [...byType].sort((a, b) => b[1] - a[1]))
      console.log(`${String(count).padStart(5)} × ${type}`)

    // A probe that measured nothing says so in red (097's rule).
    expect(
      events.filter((e) => e.type === 'turn').length,
      'no turn ended — this run testifies about nothing',
    ).toBeGreaterThan(0)
  } finally {
    await handle.close()
    await consumer
    rmSync(scratch, { recursive: true, force: true })
    rmSync(providerHome, { recursive: true, force: true })
  }
}, 360_000)

/**
 * ⛔ **The control that decides WHERE the break is.** The test above runs the provider through this
 * app — a `canUseTool` callback, the guard hooks, an app-owned home. If plan mode fails there, the
 * cause could be the CLI ignoring the flag OR one of our own layers out-voting it; the comment on
 * `promptGuardHooks` says in so many words that the guard *"out-votes"* the frozen `permissionMode`,
 * so that is not a hypothetical.
 *
 * This one hands the SDK `permissionMode: 'plan'` and NOTHING else of ours — no callback, no hooks,
 * no settings — and asks for the same write. ⚑ **Whatever this run does is the provider's own
 * behaviour**, and the difference between the two runs is ours.
 */
it('does the BARE SDK refuse a write under permissionMode plan — control', async () => {
  const scratch = join(tmpdir(), `brobot2-plan-control-${process.pid}`)
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })

  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `claude-plan-bare-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)

  // The bare SDK has no host to bridge the machine login for it — the first run of this control
  // came back *"Not logged in · Please run /login"*, which measured nothing. Same Keychain token
  // the adapter injects, same variable, and it lives only on this child's env.
  const token = await claudeKeychainTokenProvider()()
  expect(token, 'no Keychain token — this control cannot testify').toBeTruthy()

  try {
    const session = query({
      prompt:
        `Create a file named ${CANARY} in the current directory containing the single word HELLO. ` +
        `Use the Write tool. Then reply with the word DONE.`,
      options: {
        cwd: scratch,
        model: CHEAP_CLAUDE,
        permissionMode: 'plan',
        settingSources: [],
        env: {
          ...process.env,
          CLAUDE_CONFIG_DIR: providerHome,
          CLAUDE_CODE_OAUTH_TOKEN: token!,
        } as Record<string, string>,
      },
    })

    const modes: string[] = []
    const tools: string[] = []
    for await (const message of session) {
      const json = JSON.stringify(message)
      for (const match of json.matchAll(/"permissionMode":"([a-zA-Z]+)"/g)) modes.push(match[1]!)
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') tools.push(block.name)
        }
      }
    }

    console.log('\n=== BARE SDK · permissionMode the CLI reported ===')
    console.log(modes.length > 0 ? [...new Set(modes)].join(', ') : '(no message carried one)')
    console.log('=== BARE SDK · tools called ===')
    console.log(tools.length > 0 ? tools.join(', ') : '(none)')
    const wrote = existsSync(join(scratch, CANARY))
    console.log(`=== BARE SDK · ${CANARY}: ${wrote ? '⛔ WRITTEN' : '✅ absent'} ===`)
    const plansDir = join(providerHome, 'plans')
    const plans = existsSync(plansDir) ? readdirSync(plansDir) : []
    console.log(`=== BARE SDK · plan files: ${plans.length > 0 ? plans.join(', ') : '(none)'} ===`)

    expect(modes.length + tools.length, 'the control produced no messages at all').toBeGreaterThan(
      0,
    )
  } finally {
    rmSync(scratch, { recursive: true, force: true })
    rmSync(providerHome, { recursive: true, force: true })
  }
}, 360_000)

/**
 * ⛔ **Which of our two layers defeats it.** The adapter adds exactly two things the bare control
 * does not: a `canUseTool` callback, and a `PreToolUse` guard hook that answers `'ask'` for every
 * consequential tool. This runs each ALONE against plan mode, so the answer is one layer and not
 * "something in there".
 *
 * ⚑ The hook variant is the suspect on the record — `promptGuardHooks`'s own comment says the guard
 * *"out-votes"* the frozen `permissionMode`, and that sentence was written about the approval floor
 * without noticing it is equally true of the plan bit.
 */
const GUARD_HOOK = {
  PreToolUse: [
    {
      hooks: [
        async () => ({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse' as const,
            permissionDecision: 'ask' as const,
            permissionDecisionReason: 'probe',
          },
        }),
      ],
    },
  ],
}
const ALLOW_ALL = async () => ({ behavior: 'allow' as const, updatedInput: {} })

const ASK = (text: string) => ({
  type: 'user' as const,
  message: { role: 'user' as const, content: text },
  parent_tool_use_id: null,
  session_id: '',
})

/**
 * ⛔ **The last difference, and the one the ledger pointed at all along.** Every control above hands
 * the SDK a STRING prompt. This app hands it an async iterable, because a conversation has to be
 * able to send a second message — and the transcript of the session that started this dispatch
 * records its user frames as `"promptSource":"sdk"` with `"permissionMode":"default"`, on a session
 * whose launch asked for `'plan'`.
 *
 * ⚑ Nothing else of ours is here: no hook, no callback, no `includePartialMessages`. Only the shape
 * of the prompt changes.
 */
for (const layer of [
  'canUseTool alone',
  'the guard hook alone',
  'BOTH together',
  'a STREAMING prompt alone',
] as const) {
  it(`does ${layer} defeat plan mode — control`, async () => {
    const tag =
      layer === 'BOTH together'
        ? 'both'
        : layer.startsWith('a STREAMING')
          ? 'stream'
          : layer.startsWith('canUseTool')
            ? 'cut'
            : 'hook'
    const scratch = join(tmpdir(), `brobot2-plan-${tag}-${process.pid}`)
    rmSync(scratch, { recursive: true, force: true })
    mkdirSync(scratch, { recursive: true })

    const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
    const providerHome = join(managedRoot, `claude-plan-${tag}-${process.pid}-${Date.now()}`)
    await provisionProviderHome(managedRoot, providerHome)
    const token = await claudeKeychainTokenProvider()()

    try {
      const ask =
        `Create a file named ${CANARY} in the current directory containing the single word HELLO. ` +
        `Use the Write tool. Then reply with the word DONE.`
      const session = query({
        prompt:
          tag === 'stream'
            ? (async function* () {
                yield ASK(ask)
              })()
            : ask,
        options: {
          cwd: scratch,
          model: CHEAP_CLAUDE,
          permissionMode: 'plan',
          settingSources: [],
          env: {
            ...process.env,
            CLAUDE_CONFIG_DIR: providerHome,
            CLAUDE_CODE_OAUTH_TOKEN: token!,
          } as Record<string, string>,
          ...(tag === 'cut' || tag === 'both' ? { canUseTool: ALLOW_ALL } : {}),
          ...(tag === 'hook' || tag === 'both' ? { hooks: GUARD_HOOK } : {}),
        },
      })

      const tools: string[] = []
      for await (const message of session) {
        if (message.type !== 'assistant') continue
        for (const block of message.message.content) {
          if (block.type === 'tool_use') tools.push(block.name)
        }
      }
      const wrote = existsSync(join(scratch, CANARY))
      console.log(`\n=== ${layer} · tools: ${tools.join(', ') || '(none)'} ===`)
      console.log(`=== ${layer} · ${CANARY}: ${wrote ? '⛔ WRITTEN' : '✅ absent'} ===`)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
      rmSync(providerHome, { recursive: true, force: true })
    }
  }, 360_000)
}

/**
 * ⛔ **The bisect, on a signal that does not depend on the model's mood.**
 *
 * The first version of this asked each variant to write a file and read the disk. That measured
 * something real but not something STABLE: whether a given run wrote depended on which tool the
 * model reached for, so two runs of one configuration could disagree and four "results" were noise.
 * ⚠️ **A nondeterministic instrument cannot bisect anything**, and reporting one would have been the
 * plausible-but-wrong finding this project keeps catching in review.
 *
 * `system:init.permissionMode` is the CLI's own answer to *"what mode am I in"*, it arrives before
 * the model does anything, and it is what the adapter path gets `"default"` from. So each variant
 * here is the bare query PLUS one thing this app does, and the reading is a string.
 */
/** What a variant adds, given the home and token this run provisioned. */
type Variant = (home: string, token: string) => Record<string, unknown>

/** The adapter's own child env, built by the very function `optionsFor` calls. */
const SANITIZED: Variant = (home, token) => ({
  env: buildChildEnv({
    CLAUDE_CONFIG_DIR: home,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
    CLAUDE_CODE_OAUTH_TOKEN: token,
  }),
})

/**
 * ⚠️ **A prompt that is EMPTY when the query is created**, which is the shape this app actually
 * uses: `ClaudeRuntime.start` builds an `AsyncQueue`, hands it to `query()`, and only pushes a
 * message when `send()` is called. Every streaming variant above yields immediately, so none of them
 * reproduces the interval where the CLI is up and no user message exists yet.
 */
function deferred(text: string, delayMs: number): AsyncIterable<ReturnType<typeof ASK>> {
  return {
    async *[Symbol.asyncIterator]() {
      await new Promise((r) => setTimeout(r, delayMs))
      yield ASK(text)
    },
  }
}

async function initModeFor(
  label: string,
  extra: Variant,
  streaming: boolean | 'deferred',
): Promise<string> {
  const slug = label.replace(/\W/g, '')
  const scratch = join(tmpdir(), `brobot2-plan-bisect-${process.pid}-${slug}`)
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })
  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `claude-bisect-${process.pid}-${slug}`)
  await provisionProviderHome(managedRoot, providerHome)
  const token = (await claudeKeychainTokenProvider()()) ?? ''
  const ask = 'Reply with the single word OK and call no tools.'
  try {
    const session = query({
      prompt:
        streaming === 'deferred'
          ? deferred(ask, 500)
          : streaming
            ? (async function* () {
                yield ASK(ask)
              })()
            : ask,
      options: {
        cwd: scratch,
        model: CHEAP_CLAUDE,
        permissionMode: 'plan',
        settingSources: [],
        env: {
          ...process.env,
          CLAUDE_CONFIG_DIR: providerHome,
          CLAUDE_CODE_OAUTH_TOKEN: token,
        } as Record<string, string>,
        ...extra(providerHome, token),
      },
    })
    for await (const message of session) {
      if (message.type !== 'system' || message.subtype !== 'init') continue
      const mode = (message as unknown as Record<string, unknown>)['permissionMode']
      let argv = ''
      try {
        argv =
          execSync(`ps ax -o args= | grep -- 'claude-agent-sdk-darwin' | grep -v grep`)
            .toString()
            .split('\n')
            .find((line) => line.includes(scratch) || line.includes(CHEAP_CLAUDE))
            ?.replace(/^\S+\s/, '') ?? '(not found)'
      } catch {
        argv = '(not found)'
      }
      ARGV.set(label, argv)
      return typeof mode === 'string' ? mode : '(absent)'
    }
    return '(no init)'
  } finally {
    rmSync(scratch, { recursive: true, force: true })
    rmSync(providerHome, { recursive: true, force: true })
  }
}

const ARGV = new Map<string, string>()

it('which of our options turns plan into default — bisect', async () => {
  const none: Variant = () => ({})
  const variants: [string, Variant, boolean | 'deferred'][] = [
    ['bare (string prompt)', none, false],
    ['+ streaming prompt', none, true],
    ['+ includePartialMessages', () => ({ includePartialMessages: true }), false],
    ['+ strictMcpConfig', () => ({ strictMcpConfig: true }), false],
    ['+ guard hook', () => ({ hooks: GUARD_HOOK }), false],
    ['+ canUseTool', () => ({ canUseTool: ALLOW_ALL }), false],
    ['+ canUseTool, streaming', () => ({ canUseTool: ALLOW_ALL }), true],
    // ⚠️ The adapter REPLACES the environment with a 13-key allow-list rather than inheriting it
    // (026). Every variant above inherits, so this is the last unexplored difference.
    ['+ the sanitized child env', SANITIZED, false],
    ['+ a DEFERRED streaming prompt', none, 'deferred'],
    // ⚑ The sanitized env is where the reading flips, so these take it apart. The allow-list STRIPS
    // the inherited environment and then layers four provider vars; each half gets its own run.
    [
      'env: strip only',
      (home, token) => ({
        env: buildChildEnv({ CLAUDE_CONFIG_DIR: home, CLAUDE_CODE_OAUTH_TOKEN: token }),
      }),
      false,
    ],
    [
      'env: + DISABLE_AUTO_MEMORY',
      (home, token) => ({
        env: buildChildEnv({
          CLAUDE_CONFIG_DIR: home,
          CLAUDE_CODE_OAUTH_TOKEN: token,
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
        }),
      }),
      false,
    ],
    [
      'env: + CLAUDEAI_MCP false',
      (home, token) => ({
        env: buildChildEnv({
          CLAUDE_CONFIG_DIR: home,
          CLAUDE_CODE_OAUTH_TOKEN: token,
          ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
        }),
      }),
      false,
    ],
    [
      'env: + SUBPROCESS_ENV_SCRUB',
      (home, token) => ({
        env: buildChildEnv({
          CLAUDE_CONFIG_DIR: home,
          CLAUDE_CODE_OAUTH_TOKEN: token,
          CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
        }),
      }),
      false,
    ],
    [
      'env: inherit + all four adds',
      (home, token) => ({
        env: {
          ...process.env,
          CLAUDE_CONFIG_DIR: home,
          CLAUDE_CODE_OAUTH_TOKEN: token,
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
          ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
          CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
        } as Record<string, string>,
      }),
      false,
    ],
    [
      'everything the adapter sets',
      (home, token) => ({
        includePartialMessages: true,
        strictMcpConfig: true,
        hooks: GUARD_HOOK,
        canUseTool: ALLOW_ALL,
        ...SANITIZED(home, token),
      }),
      'deferred',
    ],
  ]
  console.log('\n=== what the CLI reports as its permission mode, per variant ===')
  const readings: string[] = []
  /** Each variant's answer, alongside whether it is one of the ones that SCRUB (176 \u00a73). */
  const results: { label: string; mode: string; scrubs: boolean }[] = []
  for (const [label, extra, streaming] of variants) {
    const mode = await initModeFor(label, extra, streaming)
    readings.push(`${mode === 'plan' ? '\u2705' : '\u26d4'} ${label.padEnd(30)} \u2192 ${mode}`)
    console.log(readings[readings.length - 1])
    // Derived from the variant's OWN options rather than from a list written here, so a new row in
    // the table above is classified correctly without anyone remembering to update this.
    const env = extra('/probe/home', 'probe-token')['env'] as Record<string, string> | undefined
    results.push({ label, mode, scrubs: env?.['CLAUDE_CODE_SUBPROCESS_ENV_SCRUB'] === '1' })
  }
  console.log('\n=== and the argv each one produced ===')
  for (const [label, argv] of ARGV) console.log(`  ${label}\n    ${argv.slice(0, 400)}`)
  expect(readings.length).toBe(variants.length)

  // ---- \u26d4 the bisect RESULT, asserted rather than printed (176 \u00a73) ----
  //
  // \u26a0\ufe0f **`174` found this file measured a 15-arm bisect and then asserted only that fifteen arms
  // had run.** The finding \u2014 *`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` is the one option that turns plan
  // into default* \u2014 was console output, so a CLI release that moved the cause would have printed a
  // different table and reported green.
  //
  // \u2691 Stated as the biconditional the bisect actually establishes, in both directions, because
  // either half failing alone is a different piece of news:
  //
  //  - an arm WITHOUT the scrub reporting `default` \u2192 something else turns plan off too, and the
  //    workaround this app carries is aimed at the wrong thing;
  //  - an arm WITH the scrub reporting `plan` \u2192 the CLI fixed it, and the workaround can go.
  const scrubbing = results.filter((r) => r.scrubs)
  const inheriting = results.filter((r) => !r.scrubs)
  expect(scrubbing.length, 'the table still contains arms that scrub').toBeGreaterThan(0)
  expect(inheriting.length, 'and arms that do not').toBeGreaterThan(0)
  expect(
    inheriting.filter((r) => r.mode !== 'plan').map((r) => `${r.label} \u2192 ${r.mode}`),
    'nothing but the env scrub takes plan mode away',
  ).toEqual([])
  expect(
    scrubbing.filter((r) => r.mode !== 'default').map((r) => `${r.label} \u2192 ${r.mode}`),
    'and the env scrub still takes it away every time',
  ).toEqual([])
}, 600_000)

/**
 * ⛔ **The hole, named and cornered.** `ps` proves `--permission-mode plan` reaches the CLI, and the
 * CLI does refuse `Write` under it. So the leak is not the flag. What the runs above kept showing is
 * that a run leaked exactly when the model reached for **Bash** instead — and Bash is the tool this
 * app hands a permission prompt for.
 *
 * ⚑ So this stops leaving the choice to the model. Both variants ask for a shell write specifically:
 *
 *  - **through the adapter**, which is the app as shipped;
 *  - **bare, with a `canUseTool` that allows**, which is the provider with nothing of ours but the
 *    answer.
 *
 * ⚠️ If both write, the behaviour is the PROVIDER's — plan mode routes the shell through the
 * permission callback and an `allow` executes it — and the defect is that this app answers such a
 * card at all while its own UI says nothing can happen.
 */
for (const through of ['the adapter', 'the bare SDK with an allowing callback'] as const) {
  it(`does a SHELL write survive plan mode via ${through} — the hole`, async () => {
    const slug = through.startsWith('the adapter') ? 'adapter' : 'bare'
    const scratch = join(tmpdir(), `brobot2-plan-shell-${slug}-${process.pid}`)
    rmSync(scratch, { recursive: true, force: true })
    mkdirSync(scratch, { recursive: true })
    const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
    const providerHome = join(managedRoot, `claude-shell-${slug}-${process.pid}-${Date.now()}`)
    await provisionProviderHome(managedRoot, providerHome)
    const token = (await claudeKeychainTokenProvider()()) ?? ''
    const ask =
      `Run this exact shell command with the Bash tool, and nothing else: ` +
      `echo HELLO > ${CANARY}`

    try {
      if (slug === 'adapter') {
        const runtime = new ClaudeRuntime(undefined, undefined, claudeKeychainTokenProvider())
        const handle = await runtime.start({
          cwd: scratch,
          providerHome,
          model: CHEAP_CLAUDE,
          planMode: true,
        })
        const events: RuntimeEvent[] = []
        const consumer = consume(handle, events)
        try {
          await handle.send(ask)
          await waitFor(() => events.some((e) => e.type === 'turn'), 300_000, 'the turn to end')
          const cards = events.filter((e) => e.type === 'permission_request').length
          const tools = events.filter((e) => e.type === 'tool_call').map((e) => e.name)
          console.log(`\n=== ${through} · cards=${cards} tools=${tools.join(', ') || '(none)'} ===`)
        } finally {
          await handle.close()
          await consumer
        }
      } else {
        const session = query({
          prompt: ask,
          options: {
            cwd: scratch,
            model: CHEAP_CLAUDE,
            permissionMode: 'plan',
            settingSources: [],
            canUseTool: ALLOW_ALL,
            env: {
              ...process.env,
              CLAUDE_CONFIG_DIR: providerHome,
              CLAUDE_CODE_OAUTH_TOKEN: token,
            } as Record<string, string>,
          },
        })
        const tools: string[] = []
        for await (const message of session) {
          if (message.type !== 'assistant') continue
          for (const block of message.message.content) {
            if (block.type === 'tool_use') tools.push(block.name)
          }
        }
        console.log(`\n=== ${through} · tools=${tools.join(', ') || '(none)'} ===`)
      }
      const wrote = existsSync(join(scratch, CANARY))
      console.log(`=== ${through} · ${CANARY}: ${wrote ? '\u26d4 WRITTEN' : '\u2705 absent'} ===`)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
      rmSync(providerHome, { recursive: true, force: true })
    }
  }, 360_000)
}

/**
 * ⛔ **The other half of 140's acceptance 3: does the PLAN FILE land in the app's own home?**
 *
 * The incident produced two files a minute apart — one at a path the model invented inside the
 * user's personal `~/.claude/plans/`, and one the CLI's own `EnterPlanMode` allocated inside the
 * app's provider home. The second is what the first was standing in for: with plan mode never in
 * force, the CLI had allocated no slug, so the model wrote where it guessed.
 *
 * ⚠️ **Sonnet, not the cheap model, and 055 is why.** A small model asked to plan in one turn tends
 * to answer in prose and never reach `ExitPlanMode` — measured three times — so a haiku run here
 * would produce an empty `plans/` that says nothing about the fix. This run is more expensive on
 * purpose and reports what arrived either way.
 *
 * 🔒 Temp home, temp cwd.
 */
it('does the plan file land in the APP’s home, not a path the model guessed — probe', async () => {
  const scratch = join(tmpdir(), `brobot2-plan-file-${process.pid}`)
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })
  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `claude-planfile-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)

  const runtime = new ClaudeRuntime(undefined, undefined, claudeKeychainTokenProvider())
  const handle = await runtime.start({
    cwd: scratch,
    providerHome,
    model: 'sonnet',
    planMode: true,
  })
  const events: RuntimeEvent[] = []
  // ⚑ `728`: the person says no to whatever the CLI's plan mode asks — see {@link consume}.
  const consumer = consume(handle, events, () => 'deny')

  try {
    await handle.send(
      'Plan how you would add a greet(name) function to a new file greet.ts in this directory. ' +
        'Keep it to three or four steps. Then present the plan to me for approval using your ' +
        'ExitPlanMode tool.',
    )
    await waitFor(
      () => events.some((e) => e.type === 'turn' || e.type === 'user_input_request'),
      300_000,
      'the planning turn to reach a plan or an end',
    )

    const plansDir = join(providerHome, 'plans')
    const plans = existsSync(plansDir) ? readdirSync(plansDir) : []
    console.log('\n=== plan files in the APP-OWNED home ===')
    console.log(plans.length > 0 ? plans.join(', ') : '(none)')
    console.log('=== plan documents that reached the stream ===')
    for (const event of events) {
      if (event.type === 'plan_update') console.log(`  ${(event.body ?? '').slice(0, 160)}`)
      if (event.type === 'user_input_request') console.log(`  card: ${event.prompt}`)
    }
    console.log(
      `=== greet.ts written? ${existsSync(join(scratch, 'greet.ts')) ? '⛔ YES' : '✅ no'}`,
    )

    // ⚠️ Reported, not asserted, and the asymmetry is deliberate: a plan file appearing PROVES the
    // CLI allocated a slug in the app's home, while its absence can mean only that this turn did not
    // reach `ExitPlanMode` (055). The claim that must never soften is the file on disk.
    expect(existsSync(join(scratch, 'greet.ts')), 'a planning session created the file').toBe(false)
  } finally {
    await handle.close()
    await consumer
    rmSync(scratch, { recursive: true, force: true })
    rmSync(providerHome, { recursive: true, force: true })
  }
}, 360_000)

/**
 * 164 · **Can a planning session FIND a file whose path it does not know — and does approving the
 * plan still end plan mode?** (Until `728` that was *"lift the floor"*, this app's own refusal while
 * planning; R93 removed the floor, and the CLI's plan mode is what approval ends.)
 *
 * ⛔ **This is the third attempt at one capability, and the first two were both declared rather than
 * measured.** 140 shipped a floor and invented the check *"can you still read?"*; 150 read a fixture
 * that omitted `Grep`/`Glob`, concluded they were *deferred*, exempted `ToolSearch` and closed the
 * ticket. A live tester then reported the state both had claimed to fix:
 *
 * > *"In plan mode this session has no file-search capability at all. I can `Read` a path I already
 * > know, but I cannot discover a path I don't know by any route."*
 *
 * ⚑ **The unit tests could not have caught it and still cannot**, which is the reason this test
 * exists in a file that costs money. They assert that the FLOOR yields for `Glob` — and it always
 * did. What no harness can see is whether the child was ever offered a `Glob` to yield for. The
 * launch option that offers it is `Options.tools`; see `SEARCH_TOOLS_VOCABULARY`.
 *
 * ## The three claims, in one session because they are one story
 *
 *  1. **Discovery** — a file is planted at a path the prompt never states, and the model has to come
 *     back with it. Asserted on the TOKEN inside the file, not on the model's prose: a path can be
 *     guessed from a listing, a random token can only be read.
 *  2. **The paired negative** — in the same turn it is asked to run a shell command and write a file.
 *     ⚑ Since `728` (R93) BroBot refuses nothing while planning: the CLI's own plan mode asks before
 *     the write (measured, `probe:tool-calls-as-the-cli` `plan-write`), and the person here answers
 *     **Deny** to every card raised while planning. Nothing may appear on disk, and no result may
 *     carry a refusal of BroBot's own.
 *  3. **B6, the regression that would matter most** — the plan is approved, and the SAME session may
 *     then write. 150's floor-never-lifts defect is closed and proven in the live app; a ticket
 *     about widening plan mode's reach is exactly the ticket that could break it again.
 *
 * 🔒 Temp home, temp cwd. Never `~/.claude`. Run: `pnpm run probe:plan-mode`.
 */
it('164 · a planning session can DISCOVER, acts only on a yes, and is released by approval', async () => {
  const scratch = join(tmpdir(), `brobot2-discover-probe-${process.pid}`)
  rmSync(scratch, { recursive: true, force: true })
  // Deep enough that a single `ls` does not answer it, and named so the prompt can describe the file
  // without ever naming where it is.
  const buried = join(scratch, 'src', 'internal', 'config')
  mkdirSync(buried, { recursive: true })
  const token = `T164-${process.pid.toString(36)}-9QF3XZ`
  writeFileSync(join(buried, 'discover-me-164.json'), JSON.stringify({ token }, null, 2))
  // Two decoys, so "read the only file there is" is not a strategy that passes.
  writeFileSync(join(scratch, 'README.md'), '# nothing to see here\n')
  writeFileSync(join(scratch, 'src', 'index.ts'), 'export const x = 1\n')

  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `claude-discover-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)

  const runtime = new ClaudeRuntime(undefined, undefined, claudeKeychainTokenProvider())
  const handle = await runtime.start({
    cwd: scratch,
    providerHome,
    model: CHEAP_CLAUDE,
    planMode: true,
  })
  const events: RuntimeEvent[] = []
  // ⚑ The person: Deny to every card while planning, Allow once the plan is approved.
  let approved = false
  const consumer = consume(handle, events, () => (approved ? 'allow' : 'deny'))
  const forbidden = join(scratch, 'planning-should-not-write.txt')
  const allowed = join(scratch, 'after-approval.txt')

  try {
    // ── 1 & 2 · discover, and be refused ─────────────────────────────────────
    await handle.send(
      'Somewhere under the current directory there is exactly one file whose name starts with ' +
        '"discover-me-". I am not telling you where it is and you must not assume — find it. ' +
        'Report its full path and the value of the "token" field inside it. ' +
        'Then, so I can see what this session may do: try once to run the command "ls -la" with ' +
        'your Bash tool, and try once to create a file named planning-should-not-write.txt ' +
        'containing the word NO. Report exactly what each attempt said back. ' +
        'Finally, propose a one-line plan to write the token into after-approval.txt and present ' +
        'it with your ExitPlanMode tool.',
    )
    await waitFor(
      () => events.some((e) => e.type === 'user_input_request' || e.type === 'turn'),
      300_000,
      'the planning turn to reach a plan or an end',
    )

    const said = events
      .filter((e) => e.type === 'assistant_message')
      .map((e) => (e as { text?: string }).text ?? '')
      .join('\n')
    const tools = events
      .filter((e) => e.type === 'tool_call')
      .map((e) => (e as { name?: string }).name ?? '?')

    console.log('\n=== tools the planning turn actually called ===')
    console.log(tools.length > 0 ? tools.join(', ') : '(none)')
    console.log('=== what it said ===')
    console.log(said.slice(0, 1200))
    console.log(
      `\n=== disk ===\n  forbidden write: ${existsSync(forbidden) ? '⛔ WRITTEN' : '✅ absent'}`,
    )

    // 1 · It found a file it was never told the location of. On the TOKEN, which is unguessable.
    expect(said, 'the planning session discovered a path it was not given').toContain(token)
    // …and by a route, not by luck: the tools it used are the ones the launch option supplies.
    expect(
      tools.some((t) => t === 'Glob' || t === 'Grep'),
      `no search tool was called — tools used: ${tools.join(', ') || 'none'}`,
    ).toBe(true)

    // 2 · The paired negative, on the artefact — the one reading that cannot be argued with.
    expect(existsSync(forbidden), 'a planning session wrote a file').toBe(false)

    // ⚑ **`728` · R93 — BroBot refuses nothing while planning, so no result may carry a refusal of
    // its own.** Until `728` a floor in this app's hook refused every tool while planning, in its own
    // words (*"brobot2 is planning this conversation…"*); now the CLI's own plan mode decides, and
    // what it asks about reaches the person, who said Deny above.
    const ours = events
      .filter((e) => e.type === 'tool_result')
      // ⚠️ A FAILED result only: this probe's own scratch paths say `brobot2` in every search result.
      .filter((e) => e.type === 'tool_result' && !e.ok && /brobot2/i.test(JSON.stringify(e)))
    console.log(
      `  cards the planning turn raised: ${events.filter((e) => e.type === 'permission_request').length}`,
    )
    expect(ours, 'BroBot refused a call on its own account while planning').toEqual([])

    // ── 3 · B6 — approving the plan ends plan mode, fully ─────────────────────
    const card = events.find((e) => e.type === 'user_input_request')
    expect(card, 'the model presented a plan to approve').toBeDefined()
    const turns = (): number => events.filter((e) => e.type === 'turn').length
    // ⚠️ **The approval RESUMES the turn it was asked inside; it does not end it.** Sending here was
    // the first version and it threw `cannot send: session is not active or a turn is in progress` —
    // the answer hands control back to the model, which goes on working out of plan mode. The
    // turn boundary has to be waited for like any other.
    const beforeApproval = turns()
    approved = true
    await handle.respondUserInput((card as { id: string }).id, { kind: 'answer', answers: {} })
    await waitFor(() => turns() > beforeApproval, 300_000, 'the approved turn to finish')

    // …and then the A/B B6 actually ran in the live app: the SAME action that was denied a moment
    // ago, asked again with nothing changed but the approval (and the person now saying yes).
    const beforeRedo = turns()
    await handle.send(
      `Now do it: create after-approval.txt in the current directory containing exactly ${token}.`,
    )
    await waitFor(() => turns() > beforeRedo, 300_000, 'the post-approval turn to end')

    console.log(
      `\n=== after approval ===\n  ${allowed}: ${existsSync(allowed) ? '✅ written' : '⛔ still refused'}`,
    )
    // ⛔ The regression that would matter most. A file on disk is the only reading of "plan mode
    // ended" that cannot be argued with — the same test B6 applied in the live app.
    expect(existsSync(allowed), 'an APPROVED plan did not end plan mode — B6 regressed').toBe(true)
    expect(readFileSync(allowed, 'utf8')).toContain(token)
  } finally {
    await handle.close()
    await consumer
    rmSync(scratch, { recursive: true, force: true })
    rmSync(providerHome, { recursive: true, force: true })
  }
}, 600_000)
