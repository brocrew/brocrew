import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
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
  describeHits,
  describeScan,
  pathsNaming,
  type Hit,
  type Marker,
} from '../../../scripts/lib/personal-home-guard.mjs'
import { claudeKeychainTokenProvider, claudeProjectDirName } from '../src/index'
import { buildChildEnv } from '../src/internal/child-env'

/**
 * **What tools the child ACTUALLY has, and whether this app controls that** (164 §1).
 *
 * `pnpm run probe:toolset`. The question this settles was answered wrongly once already, and the
 * wrong answer shipped: 150 §1 wrote *"`Grep`, `Glob`, `NotebookRead` and `BashOutput` are not in
 * `SDK_TOOLS` at all, **because they are deferred**"*, exempted `ToolSearch` on the strength of it,
 * and closed the ticket. A live planning session then reported the opposite —
 *
 * ```
 * Error: No such tool available: Glob. Glob is not available in this session —
 *   find files with `find` via the Bash tool instead.
 * ```
 *
 * — which is not a deferred tool awaiting a schema. It is a tool that does not exist here, and the
 * route it points at is the one the plan-mode floor denies. So plan mode had **no** way to discover
 * a path it did not already know, and 150's fix could not have restored it.
 *
 * ## The mechanism, as the SDK's own type states it
 *
 * `Options.tools` (`sdk.d.ts:1572`) says it outright: *"native builds may provide search via Bash
 * `find`/`grep` instead of the dedicated Grep/Glob tools. **List Grep/Glob here or in
 * `allowedTools` to get them.**"* The CLI drops both names from its base pool on every platform
 * where Bash exists, and re-admits them only when a launch NAMES one of them.
 *
 * ⚠️ **The two levers are not equivalent, and the difference is a permission.** The SDK warns
 * (`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`) that *"bare `allowedTools` entries auto-approve the whole
 * tool before the callback is consulted"* — which is 001 non-negotiable 1, in the SDK's own words.
 * `tools` is a VOCABULARY option: it says which built-ins exist, grants nothing, and leaves every
 * call to go through the guard hook and `canUseTool` exactly as it does today. Variant `c` below is
 * here to keep that difference measured rather than argued.
 *
 * ## 🔒 Nothing personal is read or written
 *
 * Every query runs against a throwaway `CLAUDE_CONFIG_DIR` under `tmpdir()`, and the run FAILS if
 * anything **it owns** turns up in a personal home — see {@link ownedMarkers} and 176.
 *
 * ⚠️ **This one COSTS, unlike `model-effort-probe`, and 106 is why.** That probe established that a
 * prompt which never yields emits **no messages at all**: `initializationResult()` carries
 * `commands`/`agents`/`models`/`account` and no tool list. `SDKSystemMessage.tools` is the only
 * place the vocabulary is reported, and it rides the message stream — so reading it needs a real
 * turn. The bill is kept to nothing that matters: `haiku`, a three-word prompt, and the query is
 * closed the moment `system:init` lands, usually before the model has answered at all.
 */

/** The isolation a real launch gets — `ClaudeRuntime.childEnvAdditions` restated, since it is private. */
function optionsFor(home: string, token: string, extra: Partial<Options>): Options {
  return {
    model: 'haiku',
    // ⚠️ **Present so the SDK's shadow check has something to check** — without it, variant `c`'s
    // "no warning" would be a vacuous pass. The SDK emits `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` only
    // when a callback exists to be shadowed, so a probe that passes none measures nothing about
    // whether `allowedTools` bypasses it. Never called here:
    // the query is closed at `system:init`, before any tool can run.
    canUseTool: () => Promise.resolve({ behavior: 'deny' as const, message: 'probe: no tools' }),
    env: buildChildEnv({
      CLAUDE_CONFIG_DIR: home,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
      CLAUDE_CODE_OAUTH_TOKEN: token,
    }),
    strictMcpConfig: true,
    settingSources: [],
    ...extra,
  }
}

/**
 * ⛔ **What this run OWNS**, which is what the personal homes are scanned for (176).
 *
 * This replaced a before/after hash of `~/.claude.json`, `~/.codex/auth.json` and
 * `~/.codex/config.toml`. That control failed on `174` because `~/.claude.json` rewrote **itself**
 * while the probe ran — the machine has many concurrent `claude` processes, and the file belongs to
 * all of them. ⚠️ **It is a race, not a threshold:** red at 8.0 s, green at 8.6 s and 8.4 s.
 *
 * ⚑ **Measured, not assumed** (176): a query closed at `system:init` leaves exactly
 * `projects/<sanitized cwd>/<session id>.jsonl` behind in the home it was given. So the session id
 * and the sanitized cwd are things this run made, they are written on the very path a leak would
 * take, and no other process on this machine can produce either.
 *
 * ⛔ **Why the replacement is not weaker.** The old check saw three named files; this one walks both
 * personal trees. The old check could only catch a write that landed inside its window; this one
 * catches ours whenever it happened. And a leak to any path outside those three — `projects/`,
 * `todos/`, `tasks/`, `history.jsonl` — was **invisible** to the old check and is caught here.
 * ⚠️ The `~/.codex` rows are KEPT rather than dropped: a Claude query has no business writing
 * Codex's home either, and scanning that tree for our markers says so without depending on whether
 * a concurrent `codex` happened to refresh a token while we ran.
 */
function ownedMarkers(sessionIds: readonly string[], cwd: string): Marker[] {
  return [
    ...sessionIds.map((id) => ({ label: `session ${id.slice(0, 8)}`, value: id })),
    // ⚠️ **`realpathSync`, and the first version of this was red without it.** `tmpdir()` answers
    // `/var/folders/…` on macOS; the CLI resolves the symlink and files the bucket under
    // `-private-var-folders-…`. Deriving the name from the unresolved path looked for a directory
    // that never exists — which is the vacuous half of a scan, caught here only because the
    // positive control asserts the marker IS findable where the work landed.
    { label: 'our cwd', value: claudeProjectDirName(realpathSync(cwd)) },
  ]
}

/**
 * When the config in a home was BORN, in epoch ms — `0` if there is no config or no such field.
 *
 * ⚑ **The positive half of the isolation claim, and the one no other process can perturb.** A fresh
 * `CLAUDE_CONFIG_DIR` that the CLI actually adopted comes back with a config stamped inside this
 * run. A config stamped BEFORE it is the user's own, copied in — which is the read half of the same
 * boundary the scan below guards the write half of.
 */
function firstStartTimeOf(config: string): number {
  if (!existsSync(config)) return 0
  const born = (JSON.parse(readFileSync(config, 'utf8')) as { firstStartTime?: unknown })
    .firstStartTime
  if (typeof born === 'number') return born
  return typeof born === 'string' ? Date.parse(born) : 0
}

/** One user message and then silence: enough to make the CLI emit `system:init`, and no more. */
async function* saysHello(): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    session_id: '',
    parent_tool_use_id: null,
    message: { role: 'user', content: 'Reply with the single word OK.' },
  } as unknown as SDKUserMessage
  await new Promise<void>(() => {}) // never a second turn
}

/** The `tools` array off `system:init`, plus whatever the SDK warned about on the way. */
interface Toolset {
  readonly tools: readonly string[]
  readonly warnings: readonly string[]
  /** The id the CLI gave this session — the marker the isolation check is keyed on (176). */
  readonly sessionId?: string
  readonly error?: string
}

async function toolsetOf(
  home: string,
  cwd: string,
  token: string,
  extra: Partial<Options>,
): Promise<Toolset> {
  const warnings: string[] = []
  const onWarning = (warning: Error): void => {
    // The one that matters is `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`; record any, so a NEW warning
    // introduced by a launch option cannot slip past unnoticed.
    warnings.push(
      `${(warning as Error & { code?: string }).code ?? warning.name}: ${warning.message}`,
    )
  }
  process.on('warning', onWarning)
  const probe = query({ prompt: saysHello(), options: optionsFor(home, token, { cwd, ...extra }) })
  try {
    for await (const message of probe as AsyncIterable<SDKMessage>) {
      if (message.type === 'system' && message.subtype === 'init') {
        // Close on the FIRST init and do not wait for the answer: the vocabulary is already here,
        // and every further token is one this probe did not need.
        return { tools: [...message.tools], warnings, sessionId: message.session_id }
      }
    }
    return { tools: [], warnings, error: 'the stream ended before system:init' }
  } catch (e) {
    return { tools: [], warnings, error: e instanceof Error ? e.message : String(e) }
  } finally {
    try {
      probe.close()
    } catch {
      /* best-effort: a probe that cannot close cleanly is still a probe */
    }
    // Warnings are emitted asynchronously; give the loop one tick to deliver them before reading.
    await new Promise((resolve) => setImmediate(resolve))
    process.off('warning', onWarning)
  }
}

it('claude toolset probe — is Grep/Glob absence ours to change', async () => {
  const startedAt = Date.now()
  const token = claudeKeychainTokenProvider()()
  expect(
    token,
    'the machine Keychain login must be inheritable or the probe measures nothing',
  ).not.toBeNull()

  const home = join(tmpdir(), `brobot2-toolset-probe-${process.pid}`)
  const cwd = join(tmpdir(), `brobot2-toolset-cwd-${process.pid}-${startedAt}`)
  rmSync(home, { recursive: true, force: true })
  mkdirSync(home, { recursive: true, mode: 0o700 })
  mkdirSync(cwd, { recursive: true })

  let baseline: Toolset
  let vocabulary: Toolset
  /** Everything this run made, gathered before the home is deleted (176). */
  let markers: Marker[]
  let isolatedHits: Hit[]
  let configBornAt: number
  try {
    // a · what a launch built exactly like ours offers today
    baseline = await toolsetOf(home, cwd, token as string, {})
    // b · the vocabulary lever: `preset:default` keeps the whole default pool, the two names add to
    //     it. No permission rule is created — this option cannot approve anything.
    vocabulary = await toolsetOf(home, cwd, token as string, {
      tools: ['preset:default', 'Grep', 'Glob'],
    })
    // c · the permission lever, measured and NOT adopted — see the header.
    const permission = await toolsetOf(home, cwd, token as string, {
      allowedTools: ['Grep', 'Glob'],
    })

    const report = (label: string, set: Toolset): void => {
      console.log(
        `\n── ${label} ──\n  error    : ${set.error ?? 'none'}\n` +
          `  count    : ${set.tools.length}\n` +
          `  Grep     : ${set.tools.includes('Grep')}\n  Glob     : ${set.tools.includes('Glob')}\n` +
          `  warnings : ${set.warnings.length === 0 ? 'none' : set.warnings.join(' | ')}\n` +
          `  tools    : ${set.tools.join(', ')}`,
      )
    }
    report('a · baseline — the options this app launches with', baseline)
    report("b · tools: ['preset:default','Grep','Glob']", vocabulary)
    report("c · allowedTools: ['Grep','Glob'] — NOT adopted", permission)

    const added = vocabulary.tools.filter((t) => !baseline.tools.includes(t))
    const lost = baseline.tools.filter((t) => !vocabulary.tools.includes(t))
    console.log(
      `\n── verdicts ──\n` +
        `  search available today  : ${baseline.tools.some((t) => t === 'Grep' || t === 'Glob')}\n` +
        `  b adds                  : ${added.join(', ') || 'nothing'}\n` +
        `  b LOSES                 : ${lost.join(', ') || 'nothing'}\n` +
        `  b shadows canUseTool    : ${vocabulary.warnings.length > 0}\n` +
        `  c shadows canUseTool    : ${permission.warnings.length > 0}`,
    )

    // `preset:default` must mean "everything, plus these" and not "only these" — an option that
    // silently narrowed the pool would trade one missing capability for several.
    expect(lost, '`preset:default` keeps every tool the baseline had').toEqual([])
    expect(added.slice().sort(), 'and adds exactly the two search tools').toEqual(['Glob', 'Grep'])
    expect(vocabulary.warnings, 'the vocabulary lever shadows no permission callback').toEqual([])

    // ---- what this run OWNS, read off the isolated home before it is deleted (176) ----
    markers = ownedMarkers(
      [baseline, vocabulary, permission].map((set) => set.sessionId ?? '').filter(Boolean),
      cwd,
    )
    // ⚑ The SAME scan that hunts the personal homes below, pointed at the home the work was meant
    // to land in. Running one function in both directions is what makes "found nothing" mean
    // something: the identical call finds every marker here.
    // ⛔ `.hits` — the walk returns a scan, and the declaration said otherwise until 202.
    isolatedHits = pathsNaming(home, markers).hits
    configBornAt = firstStartTimeOf(join(home, '.claude.json'))
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }

  expect(baseline.error ?? 'none', 'the baseline launch must succeed').toBe('none')
  expect(
    baseline.tools.includes('Grep') || baseline.tools.includes('Glob'),
    'the defect: a session launched the way this app launches has no search tool',
  ).toBe(false)
  expect(
    baseline.tools,
    'and Bash — the route the error points at — is what plan mode denies',
  ).toContain('Bash')

  // ---- 🔒 isolation, and it is the reason this file may be run at all (176) ----
  //
  // ⚠️ **Three assertions, and the negative one is worthless without the other two.** The retired
  // control had only the negative half, which is how it could be simultaneously too loud (any
  // concurrent `claude` failed it) and too quiet (a leak to a fourth path was invisible).
  const claudeHome = join(homedir(), '.claude')
  const codexHome = join(homedir(), '.codex')

  // 1 · positive: the markers are real. The provider WROTE a transcript per session, on exactly the
  //     path a leak would take — so the scan below is hunting a string this code path demonstrably
  //     produces, rather than one that never existed.
  expect(markers.length, 'every session reported an id to key the isolation on').toBe(4)
  expect(
    isolatedHits.filter((hit) => hit.label.startsWith('session')).length,
    'the provider wrote a transcript for EVERY session, into the isolated home',
  ).toBe(3)
  expect(
    isolatedHits.filter((hit) => hit.label === 'our cwd').length,
    'and filed them under a project bucket named after our cwd',
  ).toBe(1)

  // 2 · positive: the config in that home was born here, so nothing of the user's was copied in.
  console.log(
    `\n── 🔒 isolation ──\n  in the isolated home : ${describeHits(isolatedHits)}\n` +
      `  config born at       : ${configBornAt} (run started ${startedAt})`,
  )
  expect(
    configBornAt,
    'the isolated config was created by this run, not copied from the user',
  ).toBeGreaterThanOrEqual(startedAt)

  // 3 · negative: and none of it is anywhere in either personal tree. Whole trees, not three files.
  expect(
    describeScan(pathsNaming(claudeHome, markers), pathsNaming(codexHome, markers)),
    'nothing this run made is in a personal home',
  ).toBe('none')
}, 300_000)
