import { existsSync } from 'node:fs'
import type {
  AccountInfo,
  CanUseTool,
  ModelInfo,
  Options,
  PermissionResult,
  PermissionUpdate,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { beforeAll, expect } from 'vitest'
import { type AgentToolset, type RuntimeEvent } from '../src/index'
import { ClaudeRuntime, type ClaudeQuery } from '../src/claude'
import { TheCliAnswersInOrder } from './the-cli-answers-in-order'
import { AsyncQueue } from '../src/internal/async-queue'

/**
 * ⚠️ **736 · every launch in this file now reads the kept rules of `/tmp/x/home`** — Claude's
 * `settings.json`, Codex's `brobot-kept-tool-approvals.json`. On a machine where that path held one,
 * dozens of launch assertions would change underneath; this says so loudly instead of flaking.
 */
beforeAll(() => {
  for (const kept of ['settings.json', 'brobot-kept-tool-approvals.json']) {
    expect(existsSync(`/tmp/x/home/${kept}`), `/tmp/x/home/${kept} exists on this machine`).toBe(
      false,
    )
  }
  // ⚑ 740 · …and the project's local settings of `/tmp/x`, which every launch now reads too.
  expect(existsSync('/tmp/x/.claude/settings.local.json')).toBe(false)
})

// A controllable stand-in for the SDK Query: emit scripted messages, capture
// interrupt() calls, end the stream on demand.
export class FakeQuery implements ClaudeQuery {
  private readonly messages = new AsyncQueue<SDKMessage>()
  interruptCount = 0
  closeCount = 0
  emit(message: Record<string, unknown>): void {
    this.messages.push(message as unknown as SDKMessage)
  }
  end(): void {
    this.messages.close()
  }
  /**
   * ⛔ **The OTHER unexpected ending** (240 §3): the stream THROWS rather than closing.
   *
   * `runLoop` has two exits that reach `finishUnexpected` — the `for await` completing, and it
   * throwing — and a fake that could only model the first is how a fix reaches one call site and not
   * the other. `AsyncQueue.fail` is the production error channel, so this is the real path.
   */
  fail(error: unknown): void {
    this.messages.fail(error)
  }
  async interrupt(): Promise<unknown> {
    this.interruptCount++
    return undefined
  }
  /**
   * The three live-setting control requests (076), recorded in call order.
   *
   * ⚠️ They are OPTIONAL on `ClaudeQuery` so that fakes written before 076 keep compiling — which
   * means the adapter's `if (!this.query?.setModel)` guards are the only thing between a missing
   * method and a queued change that never lands. A fake without them makes the adapter refuse BY
   * NAME rather than silently succeed, which is how the conformance suite caught their absence.
   */
  readonly calls: string[] = []
  async setModel(model?: string): Promise<void> {
    this.calls.push(`setModel:${model ?? '(default)'}`)
    if (this.holdSettings) await this.holdSettings
  }
  /**
   * 🔴 **W4.189 · every `applyFlagSettings` payload, whole and in order** — a work-folder change is
   * asserted by what it SENT, kept rules included, since a `permissions` call replaces the launch's.
   * Such a call is recorded here alone: it carries no effort, and {@link calls} stays the effort log.
   */
  readonly flagSettings: Record<string, unknown>[] = []
  async applyFlagSettings(settings: {
    effortLevel?: string | null
    permissions?: unknown
  }): Promise<void> {
    this.flagSettings.push(settings)
    if ('permissions' in settings) return
    // ⚠️ `null` and `undefined` are recorded DISTINCTLY, and that is the whole value of this line.
    // The SDK documents `undefined` as "dropped by JSON serialization and has no effect" and `null`
    // as "clear it from the flag layer" — so a fake that folded both into one label could not tell
    // "cleared" from "silently did nothing", which is exactly the bug worth catching. (It did not,
    // until a mutation showed the assertion passing with `undefined` in place of `null`.)
    const level =
      settings.effortLevel === null
        ? '(null)'
        : settings.effortLevel === undefined
          ? '(undefined)'
          : settings.effortLevel
    this.calls.push(`effort:${level}`)
  }
  async setPermissionMode(mode: string): Promise<void> {
    this.calls.push(`permissionMode:${mode}`)
  }
  /**
   * **The exit receipt** (202, 191 H3) — `Query.return()`, which the pinned SDK implements as
   * `await this.cleanup()` and which therefore waits on the CLI's exit where `close()` does not.
   *
   * Optional on {@link ClaudeQuery}, so this fake models a query that HAS one; `NoReturnQuery`
   * models one that does not.
   */
  returnCount = 0
  /** When set, `return()` does not settle until it resolves — a CLI that is still exiting. */
  holdReturn: Promise<void> | null = null
  /** When set, the next settings control request waits on it — 202's `send` window (191 H5). */
  holdSettings: Promise<void> | null = null
  /** What `accountInfo()` answers: by default a login that names no account. */
  whoAmI: () => Promise<AccountInfo> = async () => ({})
  async accountInfo(): Promise<AccountInfo> {
    return this.whoAmI()
  }
  /** What `supportedModels()` answers, when a test needs the probe path (202, 191 H3). */
  models: ModelInfo[] | null = null
  async supportedModels(): Promise<ModelInfo[]> {
    if (this.models === null) throw new Error('this fake was not given a model list')
    return this.models
  }
  /**
   * The two background controls (247) — `Query.backgroundTasks()` and `Query.stopTask()`.
   *
   * ⚑ **`backgroundedIds` answers `false` for an id it does not hold**, because that is the SDK's
   * own contract — *"false only when `toolUseId` was given and it matched no foreground task"* — and
   * a fake that always said `true` would let the adapter's honest `false` path go untested.
   */
  readonly backgroundedIds = new Set<string>()
  async backgroundTasks(toolUseId?: string): Promise<boolean> {
    this.calls.push(`backgroundTasks:${toolUseId ?? '(all)'}`)
    if (toolUseId === undefined) return this.backgroundedIds.size > 0
    return this.backgroundedIds.has(toolUseId)
  }
  async stopTask(taskId: string): Promise<void> {
    this.calls.push(`stopTask:${taskId}`)
    if (taskId === 'refused') throw new Error('the provider refused to stop that task')
  }
  close(): void {
    this.closeCount++
    this.messages.close()
  }
  async return(): Promise<unknown> {
    this.returnCount++
    this.messages.close()
    if (this.holdReturn) await this.holdReturn
    return undefined
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.cli.over(this.messages[Symbol.asyncIterator]())
  }
  /** ⚑ **F080** — results name the message they answer, as the CLI's do. */
  readonly cli = new TheCliAnswersInOrder()
}

export const init = (sessionId: string, cwd: string) => ({
  type: 'system',
  subtype: 'init',
  session_id: sessionId,
  cwd,
})

export function collect(
  handle: { events(): AsyncIterable<RuntimeEvent> },
  sink: RuntimeEvent[],
): Promise<void> {
  return (async () => {
    for await (const event of handle.events()) sink.push(event)
  })()
}

export function firstOfType<T extends RuntimeEvent['type']>(
  events: RuntimeEvent[],
  type: T,
): Extract<RuntimeEvent, { type: T }> {
  const found = events.find((e): e is Extract<RuntimeEvent, { type: T }> => e.type === type)
  if (!found) throw new Error(`no ${type} event found`)
  return found
}

export const has = (events: RuntimeEvent[], pred: (e: RuntimeEvent) => boolean) => () =>
  expect(events.some(pred)).toBe(true)

export const toolOpts = (toolUseID: string, suggestions?: PermissionUpdate[]) => ({
  toolUseID,
  signal: new AbortController().signal,
  requestId: `req_${toolUseID}`,
  ...(suggestions ? { suggestions } : {}),
})

/**
 * ⚑ **736 · the Claude SDK's suggestions, as MEASURED** (`736`'s loopback, bundled CLI 2.1.281, this
 * app's hook out): for a `Write` in the folder, its *allow all edits* mode; for a `Read` outside it,
 * its DIRECTORY rule; for an `rm`, the command into `localSettings` plus the folder and the edit mode
 * for the session. ⚠️ `740` (R99): that is the SDK's whole SET; the interactive CLI's own choice out
 * of it is narrower — for an `rm`, only the folder (`cliRowOf`).
 */
/**
 * ⚑ **736 · a call that must settle AT ONCE, raced** — where it parks instead (on `main`, an
 * `EnterPlanMode` in `ask` waited on a card of this app's own) the RED is the assertion on
 * `'still pending'`, never a test that hangs to its timeout (`736`'s review).
 */
export const atOnce = <T>(call: Promise<T>): Promise<T | 'still pending'> =>
  Promise.race([
    call,
    new Promise<'still pending'>((resolve) => setTimeout(() => resolve('still pending'), 200)),
  ])

export const CLI_SUGGESTS = {
  write: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] as PermissionUpdate[],
  readOutside: [
    {
      type: 'addRules',
      rules: [{ toolName: 'Read', ruleContent: '//elsewhere/**' }],
      behavior: 'allow',
      destination: 'session',
    },
  ] as PermissionUpdate[],
  rm: [
    {
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'rm -f zz736.txt' }],
      behavior: 'allow',
      destination: 'localSettings',
    },
    { type: 'addDirectories', directories: ['/tmp/x'], destination: 'session' },
    { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
  ] as PermissionUpdate[],
  /** ⚑ 740 · `make build`, as the SDK hands it (measured, `probe:tool-calls-as-the-cli` `bash-make`). */
  make: [
    {
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'make build *' }],
      behavior: 'allow',
      destination: 'localSettings',
    },
  ] as PermissionUpdate[],
}

/** ⚑ 740 · the file an `rm` names — the SDK's `blockedPath` on it (measured, `bash-rm`). */
export const RM_NAMES = { blockedPath: '/tmp/x/zz736.txt' }

/**
 * **What the SDK does with a tool call, modelled — because calling `canUseTool` directly does not**
 * (050, from 048 §1 finding 1).
 *
 * Every approval test in this file used to reach past the SDK and invoke our callback by hand. That
 * is a fine way to test the callback and a useless way to test a POLICY, because the policy's whole
 * job is deciding whether the callback is reached at all. The vacuous test 050 replaced switched a
 * session from auto to ask, called `canUseTool`, saw a card, and passed — while the real SDK, given
 * the same `Options`, would never have called it.
 *
 * Three steps, and they are NOT equally well evidenced. Which is which matters more than the model:
 *
 * 1. **`PreToolUse` hooks run first**, ahead of the permission decision. INFERRED, and the inference
 *    is short: the SDK recommends a hook as the way to gate a call the mode would otherwise approve,
 *    which is only true if hooks are consulted before that approval happens. 007 P1-6 relies on the
 *    same ordering against allow rules and has held in production since.
 * 2. **A hook that forces `ask` routes the call through `canUseTool`.** INFERRED from the same
 *    advice, plus one live measurement: 080 observed cards in a yolo session that still had this
 *    guard installed — the arrangement this whole change depends on, running against the real
 *    provider.
 * 3. **Otherwise `permissionMode` decides, and `bypassPermissions` answers before the callback.**
 *    In `bypassPermissions` every tool call is auto-approved (except explicit deny rules) before
 *    the callback is consulted, so `canUseTool` is not invoked; a PreToolUse hook is the way to
 *    gate every call. ⚠️ **This is the step the old test did not have**, and the one the fix is
 *    measured against.
 *
 * ⚠️ **What this model is NOT: proof of what the CLI does.** The decision lives in the `claude`
 * program the SDK spawns; the SDK is only a transport. So steps 1 and 2 cannot be verified here at
 * any cost. `ui-live-smoke.mjs` step 22 tests them end to end against the real provider, and is
 * unrun.
 *
 * It fails LOUDLY on anything it does not model rather than falling through to a default: a silent
 * default is how the test it replaced came to pass while production was broken.
 */
export async function sdkToolCall(
  options: Options,
  toolName: string,
  input: Record<string, unknown>,
  opts: ReturnType<typeof toolOpts>,
): Promise<PermissionResult | null> {
  const call = (): Promise<PermissionResult | null> => {
    if (!options.canUseTool) throw new Error('no canUseTool was supplied to the query')
    return options.canUseTool(toolName, input, opts as never)
  }
  // Every matcher, and every hook within it — not `[0][0]`: the adapter installs the guard and,
  // beside it, the scheduling receipts' reader, which decides nothing; a decision any of them
  // returns is the one modelled.
  let decision: string | undefined
  for (const matcher of options.hooks?.PreToolUse ?? []) {
    for (const hook of matcher.hooks) {
      const output = await hook(
        {
          hook_event_name: 'PreToolUse',
          tool_name: toolName,
          tool_input: input,
          // The real input carries this; the guard does not read it, and the point of sending it is
          // that the model must not be the reason a future hook that DOES read it appears to work.
          tool_use_id: opts.toolUseID,
        } as never,
        opts.toolUseID,
        { signal: opts.signal },
      )
      const said = (output as { hookSpecificOutput?: { permissionDecision?: string } })
        ?.hookSpecificOutput?.permissionDecision
      if (said !== undefined) decision = said
    }
  }
  if (decision === 'ask') return call()
  if (decision === 'allow') return { behavior: 'allow' }
  if (decision === 'deny') return { behavior: 'deny', message: 'denied by hook' }
  // `HookPermissionDecision` also has `'defer'`, which nothing here emits and this model does not
  // know what to do with. Refusing to guess is the point: folded into the branch below it would
  // become "auto-approve under bypass", which is not what deferring means.
  if (decision !== undefined)
    throw new Error(`sdkToolCall does not model permissionDecision '${decision}'`)
  if (options.permissionMode === 'bypassPermissions') return { behavior: 'allow' }
  return call()
}

/**
 * A ClaudeRuntime over a FakeQuery whose factory records the SDK options of its latest launch, for
 * tests about what a start or a resume asks the SDK for. `options()` reads them after the launch.
 */
export function recordingClaudeRuntime() {
  const fq = new FakeQuery()
  let launched: Options | undefined
  const runtime = new ClaudeRuntime(
    (params) => {
      launched = params.options
      return fq
    },
    async () => true,
  )
  return { fq, runtime, options: () => launched }
}

/** Start a ClaudeRuntime backed by a FakeQuery. `start()` returns immediately;
 *  the session/init arrives when the test emits it (streaming reality). */
export async function startFake(
  opts: {
    approvalMode?: 'ask' | 'auto'
    // ⚠️ No longer narrowed to the three 024 levels (076): `ReasoningEffort` is an open string now,
    // and a test that could not pass `xhigh` could not exercise the levels the task was about.
    reasoningEffort?: string
    planMode?: boolean
    /** 358 · the toolset this session is declared with, when a test is about the inventory. */
    agentTools?: AgentToolset
    /** A FAKE API key the launch runs on, when a test is about which credential was refused. */
    apiKey?: string
    /** A FAKE machine login token, when a test is about which credential was refused. */
    login?: string
    currentLogin?: () => Promise<string | null>
    /** W4.189 · the launch's work folders, when a test is about them. */
    workFolders?: readonly string[]
    /** A scratch folder launched in AND used as the provider home, for kept rules on disk. */
    home?: string
    /**
     * What the CLI answers when asked who is signed in, when a test is about the account; `null`
     * for a query that cannot be asked.
     */
    whoAmI?: (() => Promise<AccountInfo>) | null
  } = {},
): Promise<{
  fq: FakeQuery
  handle: Awaited<ReturnType<ClaudeRuntime['start']>>
  canUse: CanUseTool
  events: RuntimeEvent[]
  consumer: Promise<void>
  /** The SDK options the runtime actually built — the write-path proof (024). */
  sdkOptions: () => Options
}> {
  const fq = new FakeQuery()
  if (opts.whoAmI === null) Object.assign(fq, { accountInfo: undefined })
  else if (opts.whoAmI !== undefined) fq.whoAmI = opts.whoAmI
  let canUse: CanUseTool | undefined
  let options: Options | undefined
  const runtime = new ClaudeRuntime(
    (params) => {
      canUse = params.options.canUseTool
      options = params.options
      fq.cli.listen(params.prompt)
      return fq
    },
    async () => true,
    opts.login === undefined ? undefined : () => opts.login ?? null,
    opts.currentLogin,
    undefined,
    opts.apiKey === undefined ? undefined : () => opts.apiKey ?? null,
  )
  const handle = await runtime.start({
    cwd: opts.home ?? '/tmp/x',
    providerHome: opts.home ?? '/tmp/x/home',
    ...(opts.approvalMode ? { approvalMode: opts.approvalMode } : {}),
    ...(opts.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
    ...(opts.planMode === undefined ? {} : { planMode: opts.planMode }),
    ...(opts.agentTools === undefined ? {} : { agentTools: opts.agentTools }),
    ...(opts.workFolders === undefined ? {} : { workFolders: opts.workFolders }),
  })
  const events: RuntimeEvent[] = []
  const consumer = collect(handle, events)
  if (!canUse) throw new Error('canUseTool was not wired into options')
  return {
    fq,
    handle,
    canUse,
    events,
    consumer,
    sdkOptions: () => {
      if (!options) throw new Error('the query was never built')
      return options
    },
  }
}
