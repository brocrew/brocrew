import type { ChildProcess } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { query, type Options, type Query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import type { RuntimeEvent } from '../src/events'
import type { SessionHandle } from '../src/runtime'
import type { SessionRef } from '../src/session-ref'
import {
  announcedVersion,
  closeBounded,
  loopbackRuntime,
  startLoopback,
  until,
  type Loopback,
  type LoopbackRuntime,
  type SeenRequest,
} from './loopback-claude'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **W4.189 · shipping gate 2 — does a work folder given to an existing Claude conversation reach
 * the CLI's own permission engine, live, without dropping a kept rule, and on resume?**
 *
 * ## ⚑ The subject
 *
 * `SessionHandle.setWorkFolders(list)` is next-turn. At launch `ClaudeRuntime.optionsFor` puts the
 * list in the flag settings as `permissions.additionalDirectories`, beside the rules the person kept
 * (`keptRulesFor`, the provider home's `settings.json`). At the turn boundary `applyPendingSettings`
 * re-sends the WHOLE `permissions` object through `Query.applyFlagSettings`, because a `permissions`
 * call replaces the object the launch put there.
 *
 * ## ⚑ The instrument — the product adapter, and the SDK's own read gate
 *
 * `loopback-claude.ts`'s `loopbackRuntime` in `approvalMode: 'ask'`, against a loopback model that
 * answers *"Noted."* to everything — so no model decides anything. The SDK `Query` the adapter makes
 * is KEPT (an `sdkQuery` that returns the real query, unchanged; its `applyFlagSettings` is wrapped
 * only to record what the adapter sent), and the permission state is read through the public
 * `Query.readFile(path)`: *"gated by the same read-permission rules as the Read tool. Returns null on
 * permission denial, missing file, or transport error"* (`sdk.d.ts` 0.3.287, `Query.readFile`).
 *
 * ⚠️ `null` cannot tell *ask* from *deny* — both are "not without asking". Every phase therefore reads
 * six files, so each `null` sits beside the control that explains it:
 *
 * | file | why |
 * |---|---|
 * | `cwd/inside.txt` | ⚑ positive control — the transport answers, every phase |
 * | `cwd/denied.txt` | ⚑ a kept deny rule inside the working folder — the rule syntax works at all |
 * | `A/ok.txt` | the subject: reachable only while `A` is a work folder |
 * | `A/secret.txt` | the kept deny rule, inside the work folder — must stay `null` throughout |
 * | `A/secret-copy.txt` | ⚑ same folder, near name, NOT covered by the exact deny — so a `null` on `secret.txt` is the rule, not the name |
 * | `B/x.txt` | an unrelated folder — never granted |
 *
 * Phases: **before-grant** (start, one turn) · **granted** (`setWorkFolders([A])`, one turn) ·
 * **removed** (`setWorkFolders([])`, one turn) · close · **resumed** (`resume(…, workFolders: [A])`,
 * one turn). Every request body is searched for what the CLI TELLS the model about directories.
 * ⚑ Arm 7 runs the first three phases again in a second conversation with NO kept rule, where the
 * removal is `permissions: null` rather than the kept rules alone — see {@link VARIANTS}.
 *
 * Use scratch config and `HOME`, literal `probe-only`, and `ANTHROPIC_BASE_URL` on 127.0.0.1.
 * A fake `security` first on `PATH` logs the lookup and returns not found (exit 44). Do not
 * perform the probe if the product-built environment carries any other credential-shaped
 * variable. Write no headers; use no real token or spend and touch no personal state.
 *
 * Run: `pnpm exec vitest run --config vitest.smoke.config.ts
 * packages/runtime/smoke/claude-work-folders-probe.smoke.ts`. Not part of `pnpm run ci`.
 */

const KEY = 'probe-only'
const MODEL = 'claude-haiku-4-5'
const WORDS = 'W4.189 work-folders probe'

/** What the CLI might tell the model when its working directories move (evidence, not asserted). */
const TOLD_MARKERS = [
  '# Environment update',
  'Additional working directories added:',
  'Additional working directories removed:',
  'Additional working directories:',
] as const

type PhaseName = 'before-grant' | 'granted' | 'removed' | 'resumed'
const TARGETS = ['inside', 'denied', 'ok', 'secret', 'secretCopy', 'unrelated'] as const
type Target = (typeof TARGETS)[number]

/**
 * ⚑ **Two conversations.** `kept` is the subject: two kept deny rules beside the folders, four
 * phases, a resume. `none` is arm 7: NO kept rule, so the grant sends `additionalDirectories` alone
 * and the removal sends `permissions: null` (`flagPermissionsOf`) — a different call from `kept`'s,
 * and the one a conversation with no kept rule (most of them) makes. ⚑ It is also the control for
 * `kept`'s deny: with no rule, `A/secret.txt` and `cwd/denied.txt` read like their neighbours.
 */
const VARIANTS = {
  kept: { keptRules: true, phases: ['before-grant', 'granted', 'removed', 'resumed'] },
  none: { keptRules: false, phases: ['before-grant', 'granted', 'removed'] },
} as const satisfies Record<string, { keptRules: boolean; phases: readonly PhaseName[] }>
type Variant = keyof typeof VARIANTS

/** ⛔ Bounded, standing rule 13 — a wait that runs out is NOT PERFORMED. */
const TURN_MS = 20_000
const READ_MS = 2_000
const TEARDOWN_MS = 8_000
/** How long a closed launch's CLI child is given to exit, and then killed by pid. */
const EXIT_MS = 8_000
/**
 * Per conversation: one turn and six reads per phase, and a close and an exit wait per launch (the
 * start, and the resume when there is one). Then the table's one wait for every child to be gone.
 */
const WAITS = [
  ...Object.values(VARIANTS).flatMap((variant) => [
    ...variant.phases.flatMap(() => [TURN_MS, ...TARGETS.map(() => READ_MS)]),
    ...variant.phases
      .filter((phase) => phase === 'before-grant' || phase === 'resumed')
      .flatMap(() => [TEARDOWN_MS, EXIT_MS]),
  ]),
  EXIT_MS,
]
const deadline = probeRunDeadline(
  'W4.189 claude work-folders probe',
  runBudgetMs(WAITS),
  TEARDOWN_MS,
)

/** `true` is the file's content, `false` is `null`. */
type Reads = Record<Target, boolean>
const NOTHING_OUTSIDE: Reads = {
  inside: true,
  denied: false,
  ok: false,
  secret: false,
  secretCopy: false,
  unrelated: false,
}
const A_GRANTED_RULE_KEPT: Reads = {
  inside: true,
  denied: false,
  ok: true,
  secret: false,
  secretCopy: true,
  unrelated: false,
}

/** ⚑ What each file must read as, conversation by conversation and phase by phase. */
const EXPECTED: Record<Variant, Partial<Record<PhaseName, Reads>>> = {
  kept: {
    'before-grant': NOTHING_OUTSIDE,
    granted: A_GRANTED_RULE_KEPT,
    removed: NOTHING_OUTSIDE,
    resumed: A_GRANTED_RULE_KEPT,
  },
  none: {
    'before-grant': { ...NOTHING_OUTSIDE, denied: true },
    granted: { ...A_GRANTED_RULE_KEPT, denied: true, secret: true },
    removed: { ...NOTHING_OUTSIDE, denied: true },
  },
}

/** The two kept rules, as the evidence spells them (scrubbed). */
const KEPT_DENY = ['Read(/<A>/secret.txt)', 'Read(/<cwd>/denied.txt)']

type Body = Record<string, unknown>

interface ReadSeen {
  readonly target: Target
  readonly path: string
  /** `content`, `null`, `timeout`, or `threw: …`. */
  readonly result: string
  readonly contents: string | null
}

interface Told {
  readonly request: number
  readonly marker: string
  readonly where: string
  /** Whether the snippet sits after the request's last assistant message — THIS turn's news. */
  readonly thisTurn: boolean
  readonly text: string
}

interface PhaseSeen {
  readonly phase: PhaseName
  readonly launch: 'start' | 'resume'
  readonly workFolders: { effective: readonly string[]; requested: readonly string[] } | null
  readonly turnEnded: string[]
  readonly fatal: string[]
  readonly sendFailed: string | null
  readonly reads: ReadSeen[]
  readonly requests: number
  readonly told: Told[]
  /** Every text of this phase's new turns that mentions a directory at all — no marker filter. */
  readonly directoryMentions: { request: number; where: string; text: string }[]
}

interface LaunchSeen {
  readonly launch: 'start' | 'resume'
  readonly cli: string | null
  readonly askedPermissionMode: unknown
  readonly launchAdditionalDirectories: unknown
  readonly flagSettings: unknown
  readonly configuredPort: number | null
  readonly announcedModes: string[]
}

interface Drive {
  readonly variant: Variant
  readonly listenedOn: number
  readonly requestPorts: (number | null)[]
  readonly keptSettingsFile: unknown
  readonly launches: LaunchSeen[]
  readonly phases: PhaseSeen[]
  readonly flagCalls: { query: number; settings: unknown }[]
  readonly queries: number
  readonly permissionRequests: string[]
  readonly security: string
  readonly children: { pid: number; exited: boolean; killed: boolean }[]
  readonly failure: string | null
  readonly stderr: string
}

const drives: Partial<Record<Variant, Drive>> = {}
const roots: string[] = []
const held = new Set<string>()

/** A CLI child this probe launched through the product, by pid. */
interface Owned {
  readonly pid: number
  exited: boolean
  killed: boolean
  readonly exit: Promise<void>
}

/**
 * 🔒 `741`'s containment on top of the rig's: a scratch `HOME`, a `security` that answers nothing
 * first on `PATH`, and NOT PERFORMED if the environment carries a credential but the probe's literal.
 */
function containment(options: Options): void {
  const env = { ...(options.env ?? {}) } as Record<string, string | undefined>
  const configDir = env['CLAUDE_CONFIG_DIR']
  if (configDir === undefined) throw new Error('NOT PERFORMED — no CLAUDE_CONFIG_DIR to contain')
  for (const [name, value] of Object.entries(env)) {
    if (!/API_KEY|AUTH_TOKEN|OAUTH|BEARER|CREDENTIAL|SECRET|PASSWORD/i.test(name)) continue
    if (name === 'CLAUDE_CODE_OAUTH_TOKEN' && value === KEY) continue
    throw new Error(`NOT PERFORMED — the child's environment carries ${name}`)
  }
  const root = dirname(dirname(configDir))
  const bin = join(root, 'bin')
  const home = join(root, 'home')
  mkdirSync(bin, { recursive: true })
  mkdirSync(home, { recursive: true })
  writeFileSync(
    join(bin, 'security'),
    '#!/bin/sh\necho "$@" >> "$(dirname "$0")/security.log"\nexit 44\n',
  )
  chmodSync(join(bin, 'security'), 0o755)
  env['HOME'] = home
  env['PATH'] = `${bin}:${env['PATH'] ?? '/usr/bin:/bin'}`
  options.env = env
}

/** ⚑ OBSERVE the product's own spawn: record each child's pid, unchanged, so it can be waited for. */
function ownChildren(options: Options, owned: Owned[]): void {
  const productSpawn = options.spawnClaudeCodeProcess
  if (productSpawn === undefined) throw new Error('NOT PERFORMED — the product spawns no child')
  options.spawnClaudeCodeProcess = (spawnOptions) => {
    const child = productSpawn(spawnOptions) as unknown as ChildProcess
    const pid = child.pid
    if (pid !== undefined) {
      const one: Owned = {
        pid,
        exited: child.exitCode !== null || child.signalCode !== null,
        killed: false,
        exit: new Promise<void>((resolve) => {
          child.once('exit', () => {
            one.exited = true
            resolve()
          })
        }),
      }
      owned.push(one)
    }
    return child as unknown as ReturnType<typeof productSpawn>
  }
}

/** ⛔ Bounded: wait up to `ms` for every owned child to exit. */
async function exitedWithin(owned: readonly Owned[], ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.all(owned.filter((one) => !one.exited).map((one) => one.exit)),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** ⛔ Kill, by pid, every owned child that has not exited. */
function killLeft(owned: readonly Owned[]): void {
  for (const one of owned) {
    if (one.exited) continue
    try {
      process.kill(one.pid, 'SIGKILL')
      one.killed = true
    } catch {
      // ⚑ Already gone.
    }
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** ⛔ Bounded — one `readFile`, through the SDK's public method, answered or timed out. */
async function readThrough(live: Query, target: Target, path: string): Promise<ReadSeen> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const got = await Promise.race([
      live.readFile(path).then(
        (answer) => ({ kind: 'answered' as const, answer }),
        (error: unknown) => ({
          kind: 'threw' as const,
          message: error instanceof Error ? error.message : String(error),
        }),
      ),
      new Promise<{ kind: 'timeout' }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), READ_MS)
        timer.unref?.()
      }),
    ])
    if (got.kind === 'timeout') return { target, path, result: 'timeout', contents: null }
    if (got.kind === 'threw') {
      return { target, path, result: `threw: ${got.message}`, contents: null }
    }
    if (got.answer === null) return { target, path, result: 'null', contents: null }
    return { target, path, result: 'content', contents: got.answer.contents }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Every text of a request — where it sits, and which message it is in (`null` for `system`). */
function textsOf(body: Body): { where: string; message: number | null; text: string }[] {
  const out: { where: string; message: number | null; text: string }[] = []
  const system = body['system']
  if (typeof system === 'string') out.push({ where: 'system', message: null, text: system })
  else if (Array.isArray(system)) {
    for (const [i, block] of (system as { text?: string }[]).entries()) {
      if (typeof block.text === 'string')
        out.push({ where: `system[${String(i)}]`, message: null, text: block.text })
    }
  }
  const messages = (body['messages'] ?? []) as { role?: string; content?: unknown }[]
  for (const [j, message] of messages.entries()) {
    const at = `messages[${String(j)}] (${message.role ?? '?'})`
    if (typeof message.content === 'string') {
      out.push({ where: `${at}.content`, message: j, text: message.content })
      continue
    }
    if (!Array.isArray(message.content)) continue
    for (const [k, block] of (
      message.content as { type?: string; text?: string; content?: unknown }[]
    ).entries()) {
      if (block.type === 'text' && typeof block.text === 'string')
        out.push({ where: `${at}.content[${String(k)}] text`, message: j, text: block.text })
      if (block.type === 'tool_result') {
        const inner = block.content
        const parts =
          typeof inner === 'string'
            ? [inner]
            : Array.isArray(inner)
              ? (inner as { type?: string; text?: string }[]).flatMap((one) =>
                  one.type === 'text' && typeof one.text === 'string' ? [one.text] : [],
                )
              : []
        for (const text of parts)
          out.push({ where: `${at}.content[${String(k)}] tool_result`, message: j, text })
      }
    }
  }
  return out
}

function lastAssistant(body: Body): number {
  const messages = (body['messages'] ?? []) as { role?: string }[]
  let last = -1
  for (const [j, message] of messages.entries()) if (message.role === 'assistant') last = j
  return last
}

/** A long text cut to the part around `at` — the system prompt is tens of thousands of characters. */
function around(text: string, at: number): string {
  if (text.length <= 4_000) return text
  return `…${text.slice(Math.max(0, at - 400), at + 1_200)}…`
}

function toldIn(
  requests: readonly SeenRequest[],
  from: number,
  scrub: (text: string) => string,
): { told: Told[]; mentions: { request: number; where: string; text: string }[] } {
  const told: Told[] = []
  const mentions: { request: number; where: string; text: string }[] = []
  for (const [offset, request] of requests.entries()) {
    const body = request.body
    if (body === null || typeof body !== 'object') continue
    const last = lastAssistant(body as Body)
    for (const one of textsOf(body as Body)) {
      const thisTurn = one.message !== null && one.message > last
      for (const marker of TOLD_MARKERS) {
        const at = one.text.indexOf(marker)
        if (at < 0) continue
        told.push({
          request: from + offset,
          marker,
          where: one.where,
          thisTurn,
          text: scrub(around(one.text, at)),
        })
      }
      if (thisTurn && /director/i.test(one.text)) {
        mentions.push({
          request: from + offset,
          where: one.where,
          text: scrub(around(one.text, one.text.search(/director/i))),
        })
      }
    }
  }
  return { told, mentions }
}

function announcedModes(frames: readonly SDKMessage[]): string[] {
  const modes: string[] = []
  for (const frame of frames) {
    const f = frame as { type?: string; subtype?: string; permissionMode?: string }
    if (f.type === 'system' && typeof f.permissionMode === 'string')
      modes.push(`${f.subtype ?? '?'}:${f.permissionMode}`)
  }
  return modes
}

/**
 * One conversation: start → before-grant → granted → removed → close, and for `kept` → resume →
 * resumed → close. Its own loopback, rig and provider home.
 */
async function driveIt(variant: Variant): Promise<Drive> {
  deadline.refuse(`starting the ${variant} drive`)
  const plan = VARIANTS[variant]
  const loopback: Loopback = await startLoopback(() => ({ kind: 'text', text: 'Noted.' }))
  const owned: Owned[] = []
  const queries: Query[] = []
  const flagCalls: { query: number; settings: unknown }[] = []
  const permissionRequests: string[] = []
  let handle: SessionHandle | null = null
  const release = deadline.own(async () => {
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    await loopback.close()
    killLeft(owned)
  })
  const launches: LaunchSeen[] = []
  const phases: PhaseSeen[] = []
  let failure: string | null = null
  let rig: LoopbackRuntime | null = null
  let keptSettingsFile: unknown = null
  let scrub = (text: string): string => text
  /**
   * ⚑ The SDK's own `query`, kept: the returned object IS the real query, so `readFile` is the
   * SDK's public method on the adapter's live session. `applyFlagSettings` is wrapped to RECORD what
   * the adapter sent and passes it through unchanged.
   */
  const keepingQuery: typeof query = (params) => {
    const live = query(params)
    const index = queries.length
    const original = live.applyFlagSettings.bind(live)
    Object.defineProperty(live, 'applyFlagSettings', {
      configurable: true,
      writable: true,
      value: (settings: Parameters<Query['applyFlagSettings']>[0]) => {
        flagCalls.push({
          query: index,
          settings: JSON.parse(scrub(JSON.stringify(settings))) as unknown,
        })
        return original(settings)
      },
    })
    queries.push(live)
    return live
  }
  try {
    rig = await loopbackRuntime({
      scratch: runScratch('claude-work-folders'),
      label: `w4-189-${variant}`,
      port: loopback.port,
      maxRetries: 0,
      sdkQuery: keepingQuery,
      rewrite: (options) => {
        containment(options)
        ownChildren(options, owned)
      },
    })
    roots.push(rig.root)
    const cwd = realpathSync(rig.cwd)
    const folderA = join(realpathSync(rig.root), 'A')
    const folderB = join(realpathSync(rig.root), 'B')
    mkdirSync(folderA, { recursive: true })
    mkdirSync(folderB, { recursive: true })
    writeFileSync(join(cwd, 'inside.txt'), 'inside the working folder\n')
    writeFileSync(join(cwd, 'denied.txt'), 'kept out by a kept rule\n')
    writeFileSync(join(folderA, 'ok.txt'), 'granted by a work folder\n')
    writeFileSync(join(folderA, 'secret.txt'), 'kept out by a kept rule, inside a work folder\n')
    writeFileSync(join(folderA, 'secret-copy.txt'), 'a near name the rule does not cover\n')
    writeFileSync(join(folderB, 'x.txt'), 'never granted\n')
    const root = realpathSync(rig.root)
    scrub = (text: string): string =>
      text
        .replaceAll(folderA, '<A>')
        .replaceAll(folderB, '<B>')
        .replaceAll(cwd, '<cwd>')
        .replaceAll(root, '<root>')
        .replaceAll(rig!.root, '<root>')
    const paths: Record<Target, string> = {
      inside: join(cwd, 'inside.txt'),
      denied: join(cwd, 'denied.txt'),
      ok: join(folderA, 'ok.txt'),
      secret: join(folderA, 'secret.txt'),
      secretCopy: join(folderA, 'secret-copy.txt'),
      unrelated: join(folderB, 'x.txt'),
    }
    // ⚑ The kept rules, in the shape `keptRulesIn` reads (`permissions.deny`, strings), with the
    // CLI's absolute-path spelling `//…`. Two of them: one inside the work folder (the subject), and
    // one inside the working folder (the control that the spelling denies at all). `none` keeps none.
    const settingsFile = join(rig.providerHome, 'settings.json')
    if (existsSync(settingsFile))
      throw new Error('NOT PERFORMED — the provisioned home has settings')
    if (plan.keptRules) {
      const kept = {
        permissions: {
          deny: [`Read(/${paths.secret})`, `Read(/${paths.denied})`],
        },
      }
      writeFileSync(settingsFile, `${JSON.stringify(kept, null, 2)}\n`)
      keptSettingsFile = JSON.parse(scrub(JSON.stringify(kept))) as unknown
    }
    const context = { providerHome: rig.providerHome, model: MODEL, approvalMode: 'ask' as const }

    /** Each launch's own events — a closed launch's listener can never feed the next one's. */
    const listen = (opened: SessionHandle): RuntimeEvent[] => {
      const events: RuntimeEvent[] = []
      void (async () => {
        for await (const event of opened.events()) {
          events.push(event)
          // ⚑ Nothing here should ask; if anything does, it is recorded and refused.
          if (event.type === 'permission_request') {
            permissionRequests.push(scrub(JSON.stringify(event).slice(0, 2_000)))
            void opened
              .respondPermission(event.id, { outcome: 'deny', message: 'W4.189 probe' })
              .catch(() => {})
          }
        }
      })()
      return events
    }
    const launchSeen = (launch: 'start' | 'resume', framesFrom: number): void => {
      const options = rig!.recorded.options as Options | null
      launches.push({
        launch,
        cli: announcedVersion(rig!.recorded.frames.slice(framesFrom)),
        askedPermissionMode: options?.permissionMode ?? null,
        launchAdditionalDirectories: options?.additionalDirectories ?? null,
        flagSettings:
          options?.settings === undefined
            ? null
            : (JSON.parse(scrub(JSON.stringify(options.settings))) as unknown),
        configuredPort: rig!.recorded.configuredPort,
        announcedModes: announcedModes(rig!.recorded.frames.slice(framesFrom)),
      })
    }
    const phase = async (
      name: PhaseName,
      launch: 'start' | 'resume',
      live: SessionHandle,
      events: RuntimeEvent[],
    ): Promise<void> => {
      deadline.refuse(`phase ${name}`)
      const requestsBefore = loopback.requests.length
      const eventsBefore = events.length
      const mine = (): RuntimeEvent[] => events.slice(eventsBefore)
      let sendFailed: string | null = null
      try {
        await live.send(`${WORDS} · ${name}`)
        await until(
          () =>
            mine().some((one) => one.type === 'turn') ||
            mine().some((one) => one.type === 'error' && one.fatal),
          TURN_MS,
          `${name}: the turn to end`,
        )
      } catch (error) {
        sendFailed = scrub(error instanceof Error ? error.message : String(error))
      }
      const current = queries.at(-1)
      if (current === undefined) throw new Error('NOT PERFORMED — no SDK query was kept')
      const reads: ReadSeen[] = []
      for (const target of TARGETS) {
        const seen = await readThrough(current, target, paths[target])
        reads.push({ ...seen, path: scrub(seen.path) })
      }
      const fresh = loopback.requests.slice(requestsBefore)
      const { told, mentions } = toldIn(fresh, requestsBefore, scrub)
      phases.push({
        phase: name,
        launch,
        workFolders: {
          effective: live.workFolders.effective.map(scrub),
          requested: live.workFolders.requested.map(scrub),
        },
        turnEnded: mine().flatMap((one) => (one.type === 'turn' ? [one.state] : [])),
        fatal: mine().flatMap((one) =>
          one.type === 'error' && one.fatal ? [scrub(one.message)] : [],
        ),
        sendFailed,
        reads,
        requests: fresh.length,
        told,
        directoryMentions: mentions,
      })
    }

    // ── start: no work folder; the kept rules alone ─────────────────────────────────────────────
    const startFrames = rig.recorded.frames.length
    const started = await rig.runtime.start({ cwd: rig.cwd, ...context })
    handle = started
    const startEvents = listen(started)
    await phase('before-grant', 'start', started, startEvents)
    launchSeen('start', startFrames)
    // ── the grant, live ──────────────────────────────────────────────────────────────────────────
    started.setWorkFolders([folderA])
    await phase('granted', 'start', started, startEvents)
    // ── the removal, live ────────────────────────────────────────────────────────────────────────
    started.setWorkFolders([])
    await phase('removed', 'start', started, startEvents)
    // ── close, and (for `kept`) resume with the grant ────────────────────────────────────────────
    const startModes = announcedModes(rig.recorded.frames.slice(startFrames))
    launches[0] = { ...launches[0]!, announcedModes: startModes }
    const ref: SessionRef | null = started.ref
    await closeBounded(started, TEARDOWN_MS)
    handle = null
    await exitedWithin(owned, EXIT_MS)
    killLeft(owned)
    if ((plan.phases as readonly PhaseName[]).includes('resumed')) {
      if (ref === null) throw new Error('NOT PERFORMED — the start left no ref to resume')
      deadline.refuse('resume')
      rig.recorded.options = null
      rig.recorded.configuredPort = null
      const resumeFrames = rig.recorded.frames.length
      const resumed = await rig.runtime.resume(ref, { ...context, workFolders: [folderA] })
      handle = resumed
      await phase('resumed', 'resume', resumed, listen(resumed))
      launchSeen('resume', resumeFrames)
      await closeBounded(resumed, TEARDOWN_MS)
      handle = null
    }
  } catch (error) {
    failure = scrub(error instanceof Error ? error.message : String(error))
  } finally {
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    await loopback.close()
    await exitedWithin(owned, EXIT_MS)
    killLeft(owned)
    release()
  }
  const securityLog = rig === null ? null : join(rig.root, 'bin', 'security.log')
  const seen: Drive = {
    variant,
    listenedOn: loopback.port,
    requestPorts: loopback.requests.map((one) => one.localPort ?? null),
    keptSettingsFile,
    launches,
    phases,
    flagCalls,
    queries: queries.length,
    permissionRequests,
    security:
      securityLog !== null && existsSync(securityLog) ? readFileSync(securityLog, 'utf8') : '',
    children: owned.map((one) => ({ pid: one.pid, exited: one.exited, killed: one.killed })),
    failure,
    stderr: scrub(rig?.recorded.stderr ?? ''),
  }
  const evidence = runEvidence('claude-work-folders')
  mkdirSync(evidence, { recursive: true })
  writeFileSync(join(evidence, `drive-${variant}.json`), `${JSON.stringify(seen, null, 2)}\n`)
  return seen
}

function driven(variant: Variant): Drive {
  const seen = drives[variant]
  if (seen === undefined) throw new Error(`NOT PERFORMED — the ${variant} drive did not run`)
  return seen
}

function phaseOf(variant: Variant, name: PhaseName): PhaseSeen {
  const found = driven(variant).phases.find((one) => one.phase === name)
  if (found === undefined) throw new Error(`NOT PERFORMED — ${variant} · ${name} was not reached`)
  return found
}

/** ⚑ The reads of one phase against {@link EXPECTED}, as `target: result`. */
function readsHold(variant: Variant, name: PhaseName): void {
  const seen = phaseOf(variant, name)
  expect(seen.sendFailed, `${variant} · ${name}: the turn's send`).toBeNull()
  expect(seen.turnEnded, `${variant} · ${name}: the turn`).toContain('completed')
  const got = Object.fromEntries(seen.reads.map((one) => [one.target, one.result]))
  const expected = EXPECTED[variant][name]
  if (expected === undefined) throw new Error(`no expectation for ${variant} · ${name}`)
  const wanted = Object.fromEntries(
    TARGETS.map((target) => [target, expected[target] ? 'content' : 'null']),
  )
  expect(got, `${variant} · ${name}: what readFile answered`).toEqual(wanted)
}

/** ⚑ What every drive must show before any arm reads it: it ran, on this port, through kept queries. */
function driveHolds(seen: Drive, launches: number): void {
  expect(seen.failure, `NOT PERFORMED\n${seen.stderr}`).toBeNull()
  // ⚑ Rule 40: configured with this port AND reached it, on every launch.
  expect(seen.launches.length).toBe(launches)
  for (const launch of seen.launches) {
    expect(launch.configuredPort, launch.launch).toBe(seen.listenedOn)
  }
  expect(seen.requestPorts.length).toBeGreaterThan(0)
  expect(seen.requestPorts.every((port) => port === seen.listenedOn)).toBe(true)
  expect(seen.queries, 'one kept SDK query per launch').toBe(launches)
  // ⚑ The premise of every arm: the transport answers.
  for (const one of seen.phases) {
    const by = Object.fromEntries(one.reads.map((r) => [r.target, r.result]))
    expect(by['inside'], `${one.phase}: the positive control`).toBe('content')
  }
}

it(
  'W4.189 · drive: start, grant, remove, resume — through the product adapter, rules kept',
  () =>
    deadline.within('the kept drive', async () => {
      const seen = await driveIt('kept')
      drives.kept = seen
      driveHolds(seen, 2)
      // ⚑ …and the kept spelling denies at all, in every phase.
      for (const one of seen.phases) {
        const denied = one.reads.find((r) => r.target === 'denied')?.result
        expect(denied, `${one.phase}: the kept rule inside the working folder`).toBe('null')
      }
      held.add('drive')
    }),
  deadline.testTimeoutMs,
)

it(
  'W4.189 · arm 1 · before any grant, A is not readable without asking',
  () =>
    deadline.within('arm 1', async () => {
      readsHold('kept', 'before-grant')
      // ⚑ The launch put the kept rules in the flag layer, and no work folder.
      const seen = driven('kept')
      const start = seen.launches.find((one) => one.launch === 'start')
      expect(seen.keptSettingsFile).toEqual({ permissions: { deny: KEPT_DENY } })
      expect(start?.flagSettings).toMatchObject({ permissions: { deny: KEPT_DENY } })
      expect(
        (start?.flagSettings as { permissions?: Record<string, unknown> }).permissions?.[
          'additionalDirectories'
        ],
      ).toBeUndefined()
      held.add('arm 1')
    }),
  deadline.testTimeoutMs,
)

it(
  'W4.189 · arm 2 · the grant, live: A readable, the kept deny rule survives, B untouched',
  () =>
    deadline.within('arm 2', async () => {
      readsHold('kept', 'granted')
      expect(phaseOf('kept', 'granted').workFolders?.effective).toEqual(['<A>'])
      // ⚑ What the adapter SENT: the kept rules beside the list, in one `permissions`.
      expect(driven('kept').flagCalls[0]).toEqual({
        query: 0,
        settings: { permissions: { deny: KEPT_DENY, additionalDirectories: ['<A>'] } },
      })
      held.add('arm 2')
    }),
  deadline.testTimeoutMs,
)

it(
  'W4.189 · arm 3 · the removal, live: A is not readable again',
  () =>
    deadline.within('arm 3', async () => {
      readsHold('kept', 'removed')
      expect(phaseOf('kept', 'removed').workFolders?.effective).toEqual([])
      expect(driven('kept').flagCalls[1]).toEqual({
        query: 0,
        settings: { permissions: { deny: KEPT_DENY } },
      })
      expect(driven('kept').flagCalls.length, 'no other flag call').toBe(2)
      held.add('arm 3')
    }),
  deadline.testTimeoutMs,
)

it(
  'W4.189 · arm 4 · ask mode unchanged: every announced permission mode is `default`',
  () =>
    deadline.within('arm 4', async () => {
      const seen = driven('kept')
      expect(seen.launches.map((one) => one.askedPermissionMode)).toEqual(['default', 'default'])
      for (const launch of seen.launches) {
        expect(launch.announcedModes.length, `${launch.launch}: no mode announced`).toBeGreaterThan(
          0,
        )
        expect(
          launch.announcedModes.every((mode) => mode.endsWith(':default')),
          `${launch.launch}: ${launch.announcedModes.join(', ')}`,
        ).toBe(true)
      }
      expect(seen.permissionRequests, 'nothing asked').toEqual([])
      held.add('arm 4')
    }),
  deadline.testTimeoutMs,
)

it(
  'W4.189 · arm 5 · resume carries the grant and the kept rule',
  () =>
    deadline.within('arm 5', async () => {
      readsHold('kept', 'resumed')
      const resume = driven('kept').launches.find((one) => one.launch === 'resume')
      expect(resume?.flagSettings).toMatchObject({
        permissions: { deny: KEPT_DENY, additionalDirectories: ['<A>'] },
      })
      held.add('arm 5')
    }),
  deadline.testTimeoutMs,
)

it(
  'W4.189 · arm 7 · no kept rule: the grant alone, and the removal as `permissions: null`',
  () =>
    deadline.within('arm 7', async () => {
      const seen = await driveIt('none')
      drives.none = seen
      driveHolds(seen, 1)
      for (const name of VARIANTS.none.phases) readsHold('none', name)
      // ⚑ The launch wrote no `permissions` key at all, and the two calls are the list alone and
      // then `null` — the branch `kept` never takes.
      const start = seen.launches.find((one) => one.launch === 'start')
      expect(seen.keptSettingsFile).toBeNull()
      expect(start?.flagSettings).not.toHaveProperty('permissions')
      expect(seen.flagCalls).toEqual([
        { query: 0, settings: { permissions: { additionalDirectories: ['<A>'] } } },
        { query: 0, settings: { permissions: null } },
      ])
      expect(seen.launches[0]?.announcedModes.every((mode) => mode.endsWith(':default'))).toBe(true)
      expect(seen.permissionRequests, 'nothing asked').toEqual([])
      held.add('arm 7')
    }),
  deadline.testTimeoutMs,
)

it(
  'W4.189 · arm 6 · what the model is told (evidence), and the table',
  () =>
    deadline.within('the table', async () => {
      const tableOf = (seen: Drive | undefined): Record<string, unknown> => ({
        cli: seen?.launches.map((one) => `${one.launch}: ${one.cli ?? '?'}`) ?? [],
        failure: seen === undefined ? 'the drive did not run' : seen.failure,
        reads: Object.fromEntries(
          (seen?.phases ?? []).map((one) => [
            one.phase,
            Object.fromEntries(one.reads.map((r) => [r.target, r.result])),
          ]),
        ),
        modes: seen?.launches.map((one) => ({ [one.launch]: one.announcedModes })) ?? [],
        flagCalls: seen?.flagCalls ?? [],
        // ⚑ Arm 6: the CLI's own words to the model about its directories, phase by phase.
        told: Object.fromEntries(
          (seen?.phases ?? []).map((one) => [
            one.phase,
            one.told.length === 0
              ? 'absent'
              : one.told.map((t) => ({
                  request: t.request,
                  marker: t.marker,
                  where: t.where,
                  thisTurn: t.thisTurn,
                  text: t.text,
                })),
          ]),
        ),
        directoryMentions: Object.fromEntries(
          (seen?.phases ?? []).map((one) => [one.phase, one.directoryMentions]),
        ),
        security: (seen?.security ?? '')
          .trim()
          .split('\n')
          .filter((one) => one !== ''),
        children: seen?.children ?? [],
      })
      const table = {
        kept: tableOf(drives.kept),
        none: tableOf(drives.none),
        held: [...held],
      }
      mkdirSync(runEvidence('claude-work-folders'), { recursive: true })
      writeFileSync(
        join(runEvidence('claude-work-folders'), 'table.json'),
        `${JSON.stringify(table, null, 2)}\n`,
      )
      console.log('[W4.189 · table]', JSON.stringify(table, null, 2))
      // ⛔ Every CLI child this probe caused is gone — by its own exit event, and by pid.
      const children = [...(drives.kept?.children ?? []), ...(drives.none?.children ?? [])]
      for (const child of children) {
        expect(child.exited || child.killed, `pid ${String(child.pid)}`).toBe(true)
      }
      await until(
        () => children.every((child) => !alive(child.pid)),
        EXIT_MS,
        'every owned child to be gone by pid',
      )
      expect(drives.kept, 'the kept drive did not run').toBeDefined()
      expect(drives.none, 'the none drive did not run').toBeDefined()
      expect(children.length, 'a child per launch').toBeGreaterThanOrEqual(3)
      // ⚠️ Only a run whose every arm held deletes its roots; a failing one leaves them (`649` F6).
      const all = ['drive', 'arm 1', 'arm 2', 'arm 3', 'arm 4', 'arm 5', 'arm 7']
      if (all.every((one) => held.has(one))) {
        for (const root of roots) rmSync(root, { recursive: true, force: true })
      }
    }),
  deadline.testTimeoutMs,
)
