import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  query,
  type Options,
  type SDKUserMessage,
  type SlashCommand,
} from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import {
  describeScan,
  pathsNaming,
  type Marker,
} from '../../../scripts/lib/personal-home-guard.mjs'
import { claudeKeychainTokenProvider, claudeProjectDirName } from '../src/index'
import type { CodexTransport } from '../src/index'
import { buildChildEnv } from '../src/internal/child-env'
import { bundledCodexTransportFactory } from './bundled-codex'
import { runScratch } from './run-paths'

/**
 * 279 · ⛔ **The commands the agent already has — what each provider actually publishes.**
 *
 * `pnpm run probe:provider-commands`. `279` §1 states what the pinned SDKs DECLARE and then says the
 * thing that matters: *"Do not assume these are the same thing as Claude's slash commands. Ask the
 * app-server and report what comes back."* This file is that asking, for both providers, and it is
 * the evidence the palette's copy is written against.
 *
 * ## The four questions
 *
 *  1. **Does Claude's list arrive at init, or does it cost a round trip?** `SDKControlInitializeResponse`
 *     carries `commands` (`sdk.d.ts:4365`) and `Query.initializationResult()` is documented as
 *     returning *"the cached first-connect result"* — so the answer should be free. Measured here as
 *     a latency, not asserted from the doc.
 *  2. **Is `supportedCommands()` the SAME list?** Its doc says it *"tracks the latest push"*. If the
 *     two agree at init then the adapter needs only one of them, and `279` §2's ⚑ is answerable.
 *  3. **What is IN a row?** `SlashCommand` declares `name`/`description`/`argumentHint`/`aliases?`.
 *     ⚠️ **A declared field is not a sent field** (106's rule, and `model-effort-probe` is what made
 *     it a rule) — the palette's second line is `description`, so an empty one is a design input.
 *  4. **Does Codex publish anything comparable?** ⛔ **`279` §1 permits the answer "no".** The nearest
 *     surfaces are asked in order and printed raw; the verdict is computed from what came back
 *     rather than from what the vendored types declare.
 *
 * ## 🔒 Nothing personal is read or written, and no turn is taken
 *
 * ⚑ **Zero tokens on both sides.** Claude gets `model-effort-probe`'s own mechanism — a prompt that
 * never yields, so the CLI initializes and answers control requests without a conversation ever
 * starting. Codex is asked before any `thread/start`: `skills/list` and its neighbours are
 * server-state reads, not turns.
 *
 * Both run against throwaway homes under this run's scratch, and the run FAILS if anything it owns
 * turns up in a personal home (`176`).
 */

/**
 * A prompt that initializes the CLI and never sends anything — `listModels`' own trick, copied whole
 * as `model-effort-probe` copied it, including the unreachable `yield` that states the element type.
 */
async function* neverSends(): AsyncGenerator<SDKUserMessage> {
  await new Promise<void>(() => {}) // never settles: the query stays open, no turn begins
  yield undefined as unknown as SDKUserMessage
}

/** Reject rather than hang — every wait in this file is bounded, `listModels`' rule. */
function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${what}`)), ms)
      timer.unref?.()
    }),
  ])
}

/** The isolation a real launch gets — `ClaudeRuntime.childEnvAdditions` restated, since it is private. */
function optionsFor(home: string, token: string, cwd: string): Options {
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
    cwd,
  }
}

/**
 * When the config in a home was BORN — `model-effort-probe`'s positive isolation half, whole.
 *
 * A zero-turn probe leaves the provider nothing to key a file on, so the negative scan is wide and
 * thin; what discriminates is that the CLI writes its config to exactly one home.
 */
function firstStartTimeOf(config: string): number {
  if (!existsSync(config)) return 0
  const born = (JSON.parse(readFileSync(config, 'utf8')) as { firstStartTime?: unknown })
    .firstStartTime
  if (typeof born === 'number') return born
  return typeof born === 'string' ? Date.parse(born) : 0
}

/** One command row, rendered so the next reader can re-decide rather than trust a summary. */
function describeRow(row: SlashCommand): string {
  return JSON.stringify(row)
}

/** One Codex request, rendered as the sentence it settled to — answer or rejection. */
async function ask(wire: CodexTransport, method: string, params: unknown): Promise<string> {
  try {
    const answer = await withDeadline(wire.request(method, params), 20_000, method)
    return JSON.stringify(answer)
  } catch (error) {
    return `REJECTED ${error instanceof Error ? error.message : String(error)}`
  }
}

/** One row of `skills/list`, as the generated `SkillMetadata` declares it. */
interface CodexSkill {
  readonly name: string
  readonly description: string
  readonly scope?: string
  readonly enabled?: boolean
  readonly interface?: { readonly shortDescription?: string; readonly defaultPrompt?: string }
}

/** `skills/list`'s per-cwd envelope, flattened to the rows it named. */
function skillsIn(answer: unknown): CodexSkill[] {
  const data = (answer as { data?: { skills?: CodexSkill[] }[] } | undefined)?.data ?? []
  return data.flatMap((entry) => entry.skills ?? [])
}

it('what each provider publishes as its own command list', async () => {
  const startedAt = Date.now()
  const token = claudeKeychainTokenProvider()()
  expect(
    token,
    'the machine Keychain login must be inheritable or the Claude half measures nothing',
  ).not.toBeNull()

  const home = runScratch(`commands-claude-home-${process.pid}`)
  const cwd = runScratch(`commands-claude-cwd-${process.pid}`)
  const codexHome = runScratch(`commands-codex-home-${process.pid}`)
  for (const dir of [home, cwd, codexHome]) {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  // ⛔ Resolved WHILE the directory exists (177): `realpathSync` on a deleted path throws ENOENT,
  // and deriving the marker in the `finally` is how 176's guard went red the next time it ran.
  const cwdReal = realpathSync(cwd)

  // ⚠️ Declared without an initializer: every one of these is assigned exactly once inside the
  // `try` below and read only after it, so seeding them would be a value nothing can observe —
  // which `no-useless-assignment` is right to refuse. `initCommands` keeps its `[]` because the
  // assertions after the `finally` read it whether or not the Claude half got that far.
  let initCommands: SlashCommand[] = []
  let fetched: SlashCommand[]
  let codexSkills: CodexSkill[]
  let initMs: number
  let fetchMs: number
  let configBornAt: number

  try {
    // ================= Claude =================
    const probe = query({ prompt: neverSends(), options: optionsFor(home, token as string, cwd) })
    try {
      expect(
        (probe as { initializationResult?: unknown }).initializationResult,
        'the pinned SDK query exposes initializationResult()',
      ).toBeTypeOf('function')
      const at = Date.now()
      const result = await withDeadline(
        probe.initializationResult(),
        60_000,
        'initializationResult',
      )
      initMs = Date.now() - at
      initCommands = result.commands

      // ⚠️ **The SECOND read is the one that answers question 2**, and it is timed separately: if
      // `supportedCommands()` costs a round trip while `initializationResult()` does not, then
      // §2's ⚑ ("take it from init") is a real saving rather than a phrasing.
      const at2 = Date.now()
      fetched = await withDeadline(probe.supportedCommands(), 60_000, 'supportedCommands')
      fetchMs = Date.now() - at2
    } finally {
      try {
        probe.close()
      } catch {
        /* best-effort: a probe that cannot close cleanly is still a probe */
      }
    }

    console.log(`\n── claude · initializationResult().commands (${initMs} ms) ──`)
    for (const row of initCommands) console.log(describeRow(row))
    console.log(`\n── claude · supportedCommands() (${fetchMs} ms) ──`)
    console.log(
      `${fetched.length} row(s) · same names as init: ` +
        `${JSON.stringify(fetched.map((c) => c.name)) === JSON.stringify(initCommands.map((c) => c.name))}`,
    )
    console.log(
      `\n── claude · what a row carries ──\n` +
        `  rows                      : ${initCommands.length}\n` +
        `  with a non-empty description: ${initCommands.filter((c) => c.description.trim() !== '').length}\n` +
        `  with a non-empty argumentHint: ${initCommands.filter((c) => c.argumentHint.trim() !== '').length}\n` +
        `  with aliases              : ${initCommands.filter((c) => (c.aliases?.length ?? 0) > 0).length}\n` +
        `  longest name              : ${Math.max(0, ...initCommands.map((c) => c.name.length))}\n` +
        `  longest description       : ${Math.max(0, ...initCommands.map((c) => c.description.length))}\n` +
        // ⚑ **The bound is picked from this line rather than from a habit.** `background_work` uses
        // 201 because its strings are summary-sized; these are not, and a bound that cut
        // `/code-review` mid-sentence would lose the half naming `--fix`. Each candidate below is
        // "how many of the 44 survive whole".
        `  whole at 200 / 500 / 1000 : ` +
        [200, 500, 1000]
          .map((at) => initCommands.filter((c) => c.description.length <= at).length)
          .join(' / ') +
        `\n  descriptions with a newline : ${initCommands.filter((c) => c.description.includes('\n')).length}`,
    )

    configBornAt = firstStartTimeOf(join(home, '.claude.json'))

    // ================= Codex =================
    //
    // ⛔ **Asked, not assumed.** 279 §1 names three candidate surfaces and explicitly permits the
    // answer *"Codex publishes no comparable list"*. Each is sent against a server that has started
    // no thread; the raw answer is printed and the verdict is read off it.
    const wire = bundledCodexTransportFactory()({ cwd: codexHome, providerHome: codexHome })
    let plugins = 'not reached'
    let modes = 'not reached'
    let hooks = 'not reached'
    let elsewhere = 'not reached'
    try {
      await withDeadline(
        wire.request('initialize', {
          clientInfo: { name: 'brobot2-probe', title: null, version: '0.0.0' },
          capabilities: { experimentalApi: true, requestAttestation: false },
        }),
        30_000,
        'codex initialize',
      )
      wire.notify('initialized', {})
      const listed = await withDeadline(wire.request('skills/list', {}), 20_000, 'skills/list')
      codexSkills = skillsIn(listed)
      // ⚠️ **The same question asked about a DIFFERENT directory**, because Claude's own
      // `commands_changed` doc says the list moves *"as the agent works in a subdirectory"* and
      // `SkillsListParams.cwds` says the default is the session working directory. If the answer
      // varies by cwd on this side too, then a Codex command list is session-scoped exactly as
      // Claude's is, and neither belongs to the provider as a whole.
      elsewhere = JSON.stringify(
        skillsIn(
          await withDeadline(wire.request('skills/list', { cwds: [cwd] }), 20_000, 'cwds'),
        ).map((s) => s.name),
      )
      plugins = await ask(wire, 'plugin/list', {})
      modes = await ask(wire, 'collaborationMode/list', {})
      // ⚠️ A fourth, deliberately: `hooks/list` is the other `*/list` in `ClientRequest` that could
      // plausibly hold user-invocable verbs. Asking it is what makes "no comparable list" a search
      // rather than an assertion about the three the dispatch happened to name.
      hooks = await ask(wire, 'hooks/list', {})
    } finally {
      await wire.close()
    }

    console.log(`\n── codex · skills/list, every row ──`)
    for (const skill of codexSkills) {
      console.log(
        JSON.stringify({
          name: skill.name,
          scope: skill.scope,
          enabled: skill.enabled,
          short: skill.interface?.shortDescription,
          defaultPrompt: skill.interface?.defaultPrompt,
          description: skill.description.slice(0, 100),
        }),
      )
    }
    console.log(
      `\n── codex · the other nearest surfaces, raw ──\n` +
        `  skills/list rows       : ${codexSkills.length}\n` +
        `  …with a defaultPrompt  : ${codexSkills.filter((s) => s.interface?.defaultPrompt).length}\n` +
        `  …whose defaultPrompt names $name: ` +
        `${codexSkills.filter((s) => s.interface?.defaultPrompt?.includes(`$${s.name}`)).length}\n` +
        `  …whose defaultPrompt names /name: ` +
        `${codexSkills.filter((s) => s.interface?.defaultPrompt?.includes(`/${s.name}`)).length}\n` +
        `  skills/list for another cwd: ${elsewhere.slice(0, 300)}\n` +
        `  plugin/list            → ${plugins.slice(0, 800)}\n` +
        `  collaborationMode/list → ${modes.slice(0, 800)}\n` +
        `  hooks/list             → ${hooks.slice(0, 800)}`,
    )
  } finally {
    for (const dir of [home, cwd, codexHome]) rmSync(dir, { recursive: true, force: true })
  }

  // ---- the findings, ASSERTED rather than printed (176 §3, 174's rule) ----

  // 1 · Claude publishes a list at all, and the palette's band would have rows.
  expect(initCommands.length, 'a real Claude login publishes commands at init').toBeGreaterThan(0)

  // 2 · the two reads agree, which is what lets the adapter take one and not both.
  expect(
    fetched.map((c) => c.name),
    'supportedCommands() returns the same list init already carried',
  ).toEqual(initCommands.map((c) => c.name))

  // 3 · the second line of a palette row is real. ⚠️ Not "every row has one" — a provider that
  //     shipped one undescribed command would be a fact to render, not a regression to redden on.
  expect(
    initCommands.filter((c) => c.description.trim() !== '').length,
    'rows carry the description the palette draws as its second line',
  ).toBeGreaterThan(0)

  // 4 · ⛔ **Codex answers, and the answer is NOT Claude's list.** 279 §1 permits "no comparable
  //     list"; the measured answer is subtler and it is what the palette's copy rests on — Codex
  //     publishes SKILLS and no slash commands at all, so a Codex session's band is a different
  //     kind of thing from a Claude session's and must not be labelled as the same one.
  expect(codexSkills.length, 'codex answers skills/list with rows').toBeGreaterThan(0)
  expect(
    codexSkills.map((s) => s.name).filter((name) => initCommands.some((c) => c.name === name)),
    'and none of them is a command Claude publishes: these are two different vocabularies',
  ).toEqual([])

  // ---- 🔒 isolation, keyed to what this run owns (176) ----
  const markers: Marker[] = [
    { label: 'our cwd', value: claudeProjectDirName(cwdReal) },
    { label: 'our home', value: `commands-claude-home-${process.pid}` },
  ]
  console.log(`\n── 🔒 isolation ──\n  config born at : ${configBornAt} (run started ${startedAt})`)
  expect(
    configBornAt,
    'the CLI wrote its config into OUR home rather than the user’s',
  ).toBeGreaterThanOrEqual(startedAt)
  expect(
    describeScan(
      pathsNaming(join(homedir(), '.claude'), markers),
      pathsNaming(join(homedir(), '.codex'), markers),
    ),
    'nothing this run made is in a personal home',
  ).toBe('none')
}, 300_000)
