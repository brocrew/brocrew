import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  query,
  type ModelInfo,
  type Options,
  type SDKUserMessage,
  type Settings,
} from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import {
  describeScan,
  pathsNaming,
  type Marker,
} from '../../../scripts/lib/personal-home-guard.mjs'
import { claudeKeychainTokenProvider, claudeProjectDirName } from '../src/index'
import { buildChildEnv } from '../src/internal/child-env'

/**
 * What a real Claude login SAYS about effort and about `ultracode` (106).
 *
 * `pnpm run probe:model-effort`. Three questions the wire had to settle, because a comment in
 * `claude-runtime.ts`, the pinned `sdk.d.ts` and 106's brief disagreed with each other:
 *
 *  1. **Does `ModelInfo` narrow effort per model?** `listModels` maps every row to all five of
 *     `CLAUDE_EFFORTS` and explains itself with *"`ModelInfo` carries nothing per-model to narrow it
 *     with"*. But `ModelInfo` at the pinned 0.3.218 declares `supportsEffort?: boolean`
 *     (`sdk.d.ts:1225`) and `supportedEffortLevels?: (…)[]` (`:1229`). ⚠️ **A declared field is not a
 *     sent field** — only a real login settles which.
 *  2. **Is "workflows are enabled" observable to us?** `Settings.enableWorkflows` is a setting we
 *     cannot read back: `SDKControlInitializeResponse` carries `commands`/`agents`/`models`/`account`
 *     and no settings echo. The one candidate signal is `SDKSystemMessage.tools`, which is reported
 *     per session at `system/init`.
 *  3. **What does the provider DO when ultracode is asked for on a model that never reported
 *     `xhigh`?** This is the question a disabled control has to be justified by. If the CLI refuses,
 *     our refusal is a mirror of the provider's; if it accepts in silence, then "a toggle that
 *     silently does nothing" is the real hazard and 076's refuse-by-name rule applies.
 *
 * The rows and the init lines are printed RAW so the next reader can re-decide rather than trust
 * this file's summary.
 *
 * ## 🔒 Nothing personal is read or written
 *
 * Every query runs against a throwaway `CLAUDE_CONFIG_DIR` under `tmpdir()`, and the run FAILS if
 * anything **it owns** turns up in a personal home (176 — see {@link firstStartTimeOf} for the
 * positive half, which is what carries the claim in a probe that never takes a turn).
 * `claudeKeychainTokenProvider` re-reads the macOS Keychain and hands over a transient token that
 * lives only on the child env; it is never printed here and no assertion touches its value.
 *
 * ⚠️ **Zero tokens and no turn.** {@link neverSends} is `listModels`' own mechanism: `supportedModels`
 * is a method on the QUERY object, so there must be a query — and a prompt that never yields a
 * message initializes the CLI (which answers control requests and emits `system/init`) without ever
 * starting a conversation.
 */

/**
 * A prompt that initializes the CLI and never sends anything. `listModels`' own trick, copied whole
 * — including the unreachable `yield`, which is there so the element type states what this is for
 * (and so `require-yield` is satisfied honestly rather than silenced).
 */
async function* neverSends(): AsyncGenerator<SDKUserMessage> {
  await new Promise<void>(() => {}) // never settles: the query stays open, no turn begins
  yield undefined as unknown as SDKUserMessage
}

/**
 * When the config in a home was BORN, in epoch ms — `0` if there is no config or no such field.
 *
 * ⚑ **This is the isolation claim's positive half, and 176 measured why it has to carry the weight
 * here.** A probe that never takes a turn leaves the provider nothing to key a file on: there is no
 * session id on `initializationResult()` and no `projects/` bucket in the home afterwards. What the
 * CLI *does* write is its config — and it writes it in exactly one of two places. A fresh
 * `CLAUDE_CONFIG_DIR` holding a config stamped inside this run says the CLI adopted OURS; an empty
 * home says it used the user's. ⛔ **That is the whole question, and no concurrent process can
 * perturb it**, unlike the three-file hash this replaced.
 */
function firstStartTimeOf(config: string): number {
  if (!existsSync(config)) return 0
  const born = (JSON.parse(readFileSync(config, 'utf8')) as { firstStartTime?: unknown })
    .firstStartTime
  if (typeof born === 'number') return born
  return typeof born === 'string' ? Date.parse(born) : 0
}

/** The isolation a real launch gets — `ClaudeRuntime.childEnvAdditions` restated, since it is private. */
function optionsFor(home: string, token: string, extra: Partial<Options>): Options {
  return {
    env: buildChildEnv({
      CLAUDE_CONFIG_DIR: home,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
      CLAUDE_CODE_OAUTH_TOKEN: token,
    }),
    strictMcpConfig: true,
    settingSources: [],
    ...extra,
  }
}

/** What the CLI answered about a session started with these options, or the error it failed with. */
interface Init {
  readonly commands?: number
  readonly models?: number
  readonly account?: string
  readonly applyUltracode?: string
  readonly applyNonsense?: string
  /** Every field the control path answered with — finding 2 is an assertion about this list (176). */
  readonly keys?: readonly string[]
  readonly error?: string
}

/** Reject rather than hang. The 300 s version of this probe learned why the hard way. */
function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${what}`)), ms)
      timer.unref?.()
    }),
  ])
}

/**
 * Start a query, ask it two CONTROL questions, close. Never sends a message: no turn, no tokens.
 *
 * ⚠️ **Control requests, not the message stream, and that is a finding rather than a technique.**
 * The first version of this probe read `system/init` off the async generator and hung for the full
 * five-minute timeout: with a prompt that never yields, the CLI initializes and answers control
 * requests but emits **no messages at all**. So `SDKSystemMessage.tools` — the one candidate signal
 * for "are workflows enabled for this login" — is **not observable without starting a conversation**.
 * `initializationResult()` is the zero-cost sibling, and it carries `commands`/`agents`/`models`/
 * `account` and no tool list and no settings echo.
 */
async function initWith(home: string, token: string, extra: Partial<Options>): Promise<Init> {
  const probe = query({ prompt: neverSends(), options: optionsFor(home, token, extra) })
  try {
    const result = await withDeadline(probe.initializationResult(), 60_000, 'initializationResult')
    // The other half of the question: does the CLI REFUSE ultracode, or take it in silence?
    const apply = async (settings: object, what: string): Promise<string> => {
      try {
        await withDeadline(
          probe.applyFlagSettings(settings as Parameters<typeof probe.applyFlagSettings>[0]),
          60_000,
          `applyFlagSettings(${what})`,
        )
        return 'accepted (no error)'
      } catch (e) {
        return `refused: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    return {
      commands: result.commands.length,
      models: result.models.length,
      account: JSON.stringify(result.account).slice(0, 80),
      keys: Object.keys(result as object),
      applyUltracode: await apply({ ultracode: true }, '{ultracode:true}'),
      // ⚠️ **The negative control, and without it "accepted" means nothing.** If a key no `Settings`
      // declares is accepted just as quietly, then the CLI is not agreeing to ultracode — it is
      // declining to validate this path at all, and neither answer can be read as confirmation.
      applyNonsense: await apply(
        { brobot2NotARealSetting: 'certainly-not' },
        '{brobot2NotARealSetting}',
      ),
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  } finally {
    try {
      probe.close()
    } catch {
      /* best-effort: a probe that cannot close cleanly is still a probe */
    }
  }
}

it('claude model-effort + ultracode probe — what the CLI reports', async () => {
  const startedAt = Date.now()
  const token = claudeKeychainTokenProvider()()
  expect(
    token,
    'the machine Keychain login must be inheritable or the probe measures nothing',
  ).not.toBeNull()

  const home = join(tmpdir(), `brobot2-model-effort-probe-${process.pid}`)
  const cwd = join(tmpdir(), `brobot2-model-effort-cwd-${process.pid}-${startedAt}`)
  rmSync(home, { recursive: true, force: true })
  mkdirSync(home, { recursive: true, mode: 0o700 })
  mkdirSync(cwd, { recursive: true })
  // ⛔ **Resolved WHILE the directory exists** (177). `tmpdir()` answers `/var/folders/…` and the
  // CLI files its project bucket under the resolved `-private-var-folders-…`, so the marker has to
  // be derived from the real path — but 176 derived it at the END, after the `finally` had already
  // deleted the directory, and `realpathSync` on a path that is gone throws `ENOENT`. The probe was
  // green in 176 and red the next time it ran, which is the worst way for an instrument to fail.
  const cwdReal = realpathSync(cwd)

  let models: ModelInfo[]
  let plain: Init
  let configBornAt: number
  try {
    // ---- 1 · does ModelInfo narrow effort per model? ----
    const lister = query({
      prompt: neverSends(),
      options: optionsFor(home, token as string, { cwd }),
    })
    try {
      expect(lister.supportedModels, 'the pinned SDK query exposes supportedModels()').toBeTypeOf(
        'function',
      )
      models = await lister.supportedModels!()
    } finally {
      try {
        lister.close()
      } catch {
        /* best-effort */
      }
    }
    console.log('\n── 1 · supportedModels(), raw ──')
    for (const model of models) console.log(JSON.stringify(model))
    console.log(
      `${models.length} row(s) · supportsEffort on ${models.filter((m) => m.supportsEffort !== undefined).length} · ` +
        `supportedEffortLevels on ${models.filter((m) => m.supportedEffortLevels !== undefined).length} · ` +
        `naming xhigh: ${models
          .filter((m) => m.supportedEffortLevels?.includes('xhigh'))
          .map((m) => m.value)
          .join(', ')}`,
    )

    // ---- 2 · is "workflows are enabled" observable, and does ultracode move anything? ----
    const ultra: Settings = { ultracode: true }
    const [first, asked, onHaiku] = [
      await initWith(home, token as string, { cwd }),
      await initWith(home, token as string, { cwd, settings: ultra }),
      await initWith(home, token as string, { cwd, settings: ultra, model: 'haiku' }),
    ]
    plain = first
    const report = (label: string, init: Init): void => {
      console.log(
        `\n── ${label} ──\n  launch error : ${init.error ?? 'none'}\n` +
          `  commands     : ${init.commands}\n  models       : ${init.models}\n` +
          `  account      : ${init.account}\n` +
          `  applyFlagSettings({ultracode:true})          → ${init.applyUltracode}\n` +
          `  applyFlagSettings({notARealSetting}) CONTROL → ${init.applyNonsense}`,
      )
    }
    report('2a · baseline, no settings', plain)
    report('2b · settings:{ultracode:true}', asked)
    report('2c · settings:{ultracode:true} + model:haiku', onHaiku)

    const withoutNarrowing = models
      .filter((m) => m.supportedEffortLevels === undefined)
      .map((m) => m.value)
    console.log(
      `\n── verdicts ──\n` +
        `  per-model narrowing sent : ${models.some((m) => m.supportedEffortLevels !== undefined)}\n` +
        `  rows WITHOUT it          : ${withoutNarrowing.join(', ') || 'none'}\n` +
        `  ultracode at LAUNCH      : ${asked.error ?? 'accepted, no launch error'}\n` +
        `  ultracode on haiku       : ${onHaiku.error ?? onHaiku.applyUltracode}\n` +
        `  workflows-enabled readable at zero cost: NO — no tool list and no settings echo on the ` +
        `control path (see initWith)`,
    )
    configBornAt = firstStartTimeOf(join(home, '.claude.json'))
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  }

  expect(models.length, 'a real login lists at least one model').toBeGreaterThan(0)

  // ---- the three findings this probe exists for, ASSERTED rather than printed (176 §3) ----
  //
  // ⚠️ **`174` found all three were console output and nothing else**, which makes this a
  // measurement wrapped in a test rather than a test. Each is now the claim the app rests on, and
  // each goes red on the change that would break that claim — not on the provider merely differing
  // from what it said in August.

  // 1 · the narrowing is SENT. `claude-runtime.ts` maps `ModelChoice.efforts` straight from it, and
  //     `NewConversation.vue`'s `ultracodeBlocker` asks whether the named model reports `xhigh`. If
  //     the provider stopped sending the field, every row would lose its efforts, the menu would
  //     empty and the blocker could never fire — silently, and on a surface nobody tests by hand.
  const narrowed = models.filter((m) => m.supportedEffortLevels !== undefined)
  expect(
    narrowed.length,
    'the provider narrows effort per model — the field is SENT',
  ).toBeGreaterThan(0)
  expect(
    models.filter((m) => m.supportedEffortLevels?.includes('xhigh')).map((m) => m.value),
    'and at least one model names xhigh, which is the level ultracode WAS blocked on — ⚠️ 417 removed the launcher control that read it, so nothing in the renderer asks for ultracode today',
  ).not.toEqual([])
  // ⚠️ Deliberately NOT asserted: that some row LACKS the field. Three carry it and haiku does not,
  // and `claude-runtime.ts` reads that difference — but a provider that described every model would
  // be an improvement, not a regression, and a test that reddened on it would be wrong.

  // 2 · "the CLI accepted ultracode" is not confirmation, because it accepts a key no `Settings`
  //     declares just as quietly. This is the negative control 106 reasoned from; if the CLI ever
  //     starts validating, `accepted` becomes meaningful and that reasoning has to be redone.
  expect(
    plain.applyNonsense,
    'the CONTROL: an invented setting is accepted just as quietly',
  ).toMatch(/^accepted/)

  // 3 · "are workflows enabled for this login" is still not readable at zero cost: the control path
  //     answers with no tool list and no settings echo. A key appearing here is a new capability.
  expect(plain.keys ?? [], 'the control path still reports no tool list').not.toContain('tools')
  expect(plain.keys ?? [], 'and still echoes no settings').not.toContain('settings')

  // ---- 🔒 isolation, keyed to what this run owns (176) ----
  //
  // ⛔ This replaced a before/after hash of `~/.claude.json`, `~/.codex/auth.json` and
  // `~/.codex/config.toml`. `174` failed on it because `~/.claude.json` rewrote **itself** mid-run:
  // the machine has many concurrent `claude` processes and that file belongs to all of them.
  //
  // ⚠️ **The positive half is doing most of the work here, and that is worth saying plainly.** A
  // zero-turn probe gives the provider nothing to name a file after, so the negative scan below is
  // wide (both trees, every depth — where the old check saw three files) but thin: there is little
  // it could realistically find. What discriminates is `configBornAt` — the CLI writes its config
  // to exactly one home, and a config born in ours is proof it did not write to the user's.
  const markers: Marker[] = [
    // ⚠️ `cwdReal`, resolved at the top while the directory still existed — see there for why.
    { label: 'our cwd', value: claudeProjectDirName(cwdReal) },
    { label: 'our home', value: `brobot2-model-effort-probe-${process.pid}` },
  ]
  console.log(`\n── 🔒 isolation ──\n  config born at : ${configBornAt} (run started ${startedAt})`)
  expect(
    configBornAt,
    'the CLI wrote its config into OUR home, and wrote it fresh rather than copying the user config',
  ).toBeGreaterThanOrEqual(startedAt)
  // ⛔ **`describeScan`, and this line used to spread a non-array** (202). `pathsNaming` returns a
  // scan; the `.d.mts` said `Hit[]`, so this threw `is not iterable` on the one line that proves
  // nothing leaked — the guard has not run here since 196 gave the walk its completeness fields.
  expect(
    describeScan(
      pathsNaming(join(homedir(), '.claude'), markers),
      pathsNaming(join(homedir(), '.codex'), markers),
    ),
    'nothing this run made is in a personal home',
  ).toBe('none')
}, 300_000)
