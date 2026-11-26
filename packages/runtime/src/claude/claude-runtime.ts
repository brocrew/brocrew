import type { ManagedPluginMcpServer } from '../managed-plugin-mcp'
import { managedTranscriptSettings } from './app-transcript-retention'
import { randomUUID } from 'node:crypto'
import { claudeBuiltInSkillOptions } from './built-in-skills'
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { claudeMcpServersFor, forbiddenExternalSpellings } from './agent-tools'
import type { ExternalMcpReach } from '../external-mcp'
import { qualifyWith } from '../tool-inventory'
import { CLAUDE_TOOL_NAMING } from './tool-naming'
import { beyondItsRailsOf, type AgentToolset } from '../agent-tools'
import type { Options, SDKUserMessage, Settings } from '@anthropic-ai/claude-agent-sdk'
import {
  type ClaudeChildWitness,
  finishClaudeChild,
  spawnClaudeChild,
  type SpawnChild,
  watchClaudeChild,
} from './claude-child'
import {
  aProgramTheSdkCouldNotFind,
  aProgramThatCouldNotRun,
  ClaudeUnavailableError,
} from './claude-binary'
import {
  type BuiltInSkillsContext,
  type AgentRuntime,
  type ApprovalMode,
  isAutoApprove,
  type ModelChoice,
  type ProviderRuntimeContext,
  type ReasoningEffort,
  resolveReasoningEffort,
  ResumeError,
  type ResumeOptions,
  type SessionHandle,
  type StartOptions,
} from '../runtime'
import type { LaunchSetting } from '../launch-settings'
import type { SessionRef } from '../session-ref'
import { AsyncQueue } from '../internal/async-queue'
import { AuthUnavailableError } from '../internal/auth'
import {
  whyNoClaudeLogin,
  type ClaudeApiKeyProviderAsync,
  type ClaudeAuthTokenProvider,
  type ClaudeAuthTokenProviderAsync,
} from './auth'
import { buildChildEnv } from '../internal/child-env'
import { assertNotCancelled, cancelWith, withDeadline } from '../internal/bounded'
import type { SessionConfinement } from '../internal/confinement'
import { keptRulesForALaunch } from './persisted-rules'
import { SCHEDULING_TOOLS } from './scheduling-calls'
import { CLAUDE_DEFAULT_BY_NAME } from './default-by-name'
import {
  ClaudeSessionHandle,
  CLOSE_EXIT_RECEIPT_TIMEOUT_MS,
  claudeEffort,
  errorMessage,
  flagSettingsFor,
  permissionModeFor,
  USER_INPUT_TOOLS,
  WHY_THIS_GUARD_ASKS,
  type ClaudeQuery,
  type KeptRuleLists,
} from './claude-session-handle'
import type { ToolPermissionOptions } from './permission-offers'

export { ClaudeSessionHandle, type ClaudeQuery }

function railsAreTheWholeGate(
  toolset: AgentToolset | undefined,
): (toolName: string, toolInput: unknown) => boolean {
  if (toolset === undefined) return () => false
  const byName = new Map(
    toolset.tools.map((one) => [qualifyWith(CLAUDE_TOOL_NAMING, toolset.server, one.name), one]),
  )
  return (toolName, toolInput) => {
    const tool = byName.get(toolName)
    return (
      tool !== undefined && beyondItsRailsOf(tool, toolInput) === 'nothing-its-rails-do-not-cover'
    )
  }
}

const SEARCH_TOOLS_VOCABULARY: readonly string[] = ['preset:default', 'Grep', 'Glob']

export const CLAUDE_TOOLS_TURNED_OFF: readonly string[] = ['AskUserQuestion']

export function claudeLaunchSettings(
  options: Pick<
    Options,
    'settingSources' | 'tools' | 'disallowedTools' | 'permissionMode' | 'env'
  > & {
    readonly settings: Settings
  },
  approval: ApprovalMode,
): LaunchSetting[] {
  const settings: Record<string, unknown> = { ...options.settings }
  return [
    { key: 'settings-sources', value: [...(options.settingSources ?? [])] },
    {
      key: 'memory-folder',
      value:
        typeof settings['autoMemoryDirectory'] === 'string'
          ? settings['autoMemoryDirectory']
          : null,
    },
    {
      key: 'built-in-tools',
      value: Array.isArray(options.tools)
        ? options.tools.filter((one) => typeof one === 'string')
        : null,
    },
    { key: 'denied-tools', value: [...(options.disallowedTools ?? [])] },
    {
      key: 'tools-off',
      value: CLAUDE_TOOLS_TURNED_OFF.filter((name) => options.disallowedTools?.includes(name)),
    },
    { key: 'mode', value: options.permissionMode ?? null },
    { key: 'connectors', value: options.env?.['ENABLE_CLAUDEAI_MCP_SERVERS'] !== 'false' },
    {
      key: 'attribution',
      value:
        'includeCoAuthoredBy' in settings || 'attribution' in settings ? 'set' : 'provider-default',
    },
    { key: 'approval', value: approval },
  ]
}

function askFor(why: keyof typeof WHY_THIS_GUARD_ASKS) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: WHY_THIS_GUARD_ASKS[why],
    },
  } as const
}

function allowFor(reason: string) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: reason,
    },
  } as const
}

function confinementFor(cwd: string, context: ProviderRuntimeContext): SessionConfinement {
  return { cwd, providerHome: context.providerHome }
}

function scheduleReaderHooks(
  note: (crons: unknown) => void,
  noteEffort: (level: string) => void,
): NonNullable<NonNullable<Options['hooks']>['Stop']> {
  return [
    {
      hooks: [
        async (input) => {
          if (input.hook_event_name === 'Stop') {
            try {
              const level = input.effort?.level
              if (typeof level === 'string' && level !== '') noteEffort(level)
            } catch {
              // An unreadable effort must not fail the turn.
            }
            try {
              note(input.session_crons)
            } catch {
              // Unreadable scheduling data must not fail the turn.
            }
          }
          return { continue: true }
        },
      ],
    },
  ]
}

/** The four tools' names as a hook matcher: names and `|` only, which the CLI reads as exact names. */
export const SCHEDULING_TOOLS_MATCHER = SCHEDULING_TOOLS.join('|')

function schedulingReceiptHooks(
  called: (input: unknown) => void,
  answered: (input: unknown) => void,
): {
  PreToolUse: NonNullable<NonNullable<Options['hooks']>['PreToolUse']>
  PostToolUse: NonNullable<NonNullable<Options['hooks']>['PostToolUse']>
} {
  return {
    PreToolUse: [
      {
        matcher: SCHEDULING_TOOLS_MATCHER,
        hooks: [
          async (input) => {
            if (input.hook_event_name === 'PreToolUse') called(input)
            return { continue: true }
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: SCHEDULING_TOOLS_MATCHER,
        hooks: [
          async (input) => {
            if (input.hook_event_name === 'PostToolUse') answered(input)
            return { continue: true }
          },
        ],
      },
    ],
  }
}

function promptGuardHooks(
  effectiveMode: () => ApprovalMode,

  railsGateThis: (toolName: string, toolInput: unknown) => boolean,
): { PreToolUse: NonNullable<NonNullable<Options['hooks']>['PreToolUse']> } {
  return {
    PreToolUse: [
      {
        hooks: [
          async (input) => {
            if (input.hook_event_name !== 'PreToolUse') return { continue: true }

            if (USER_INPUT_TOOLS.has(input.tool_name)) {
              return askFor('questions')
            }

            if (railsGateThis(input.tool_name, input.tool_input)) {
              return allowFor('BroCrew gates its own tools with rails, not with a card')
            }

            if (isAutoApprove({ approvalMode: effectiveMode() })) return { continue: true }

            return { continue: true }
          },
        ],
      },
    ],
  }
}

/**
 * How long listing the models may take in total, from starting the probe CLI to its answer.
 *
 * A total limit with a reason: the probe starts a throwaway CLI for a settings screen nobody is
 * watching, and a quiet pipe cannot tell a slow start (antivirus scan, cold disk)
 * from a hung child. The limit stops the child and lets the screen say it could not ask. It is far
 * above a slow PC's start, so a probe that is only slow still lists; a probe whose CLI exits is
 * rejected by the SDK at once.
 */
const MODEL_PROBE_TIMEOUT_MS = 60_000
export type QueryFactory = (params: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Options
}) => ClaudeQuery

async function* neverSends(): AsyncGenerator<SDKUserMessage> {
  await new Promise<void>(() => {})
  yield undefined as unknown as SDKUserMessage
}

export type SessionExists = (
  sessionId: string,
  cwd: string,
  providerHome: string,
) => Promise<boolean>

export function claudeProjectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

async function defaultSessionExists(
  sessionId: string,
  cwd: string,
  providerHome: string,
): Promise<boolean> {
  const projects = join(providerHome, 'projects')
  const transcript = `${sessionId}.jsonl`
  let doubt: unknown = null
  const holdsIt = (folder: string): boolean => {
    try {
      const path = join(projects, folder, transcript)
      return stillThere(path) && holdsAConversation(path)
    } catch (error) {
      doubt ??= error
      return false
    }
  }
  if (holdsIt(claudeProjectDirName(cwd))) return true
  let folders: string[]
  try {
    folders = readdirSync(projects)
  } catch (error) {
    if (!isAnAbsence(error)) throw error
    folders = []
  }
  if (folders.some(holdsIt)) return true
  if (doubt !== null) throw doubt
  return false
}

function isAnAbsence(error: unknown): boolean {
  const code = (error as { code?: unknown }).code
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENAMETOOLONG'
}

function stillThere(path: string): boolean {
  try {
    statSync(path)
    return true
  } catch (error) {
    if (isAnAbsence(error)) return false
    throw error
  }
}

const A_CONVERSATION_BUDGET_BYTES = 1024 * 1024

const A_CONVERSATION_CHUNK_BYTES = 64 * 1024

function holdsAConversation(path: string): boolean {
  let fd: number
  try {
    fd = openSync(path, 'r')
  } catch {
    return true
  }
  try {
    const chunk = Buffer.alloc(A_CONVERSATION_CHUNK_BYTES)

    const decoder = new StringDecoder('utf8')
    let partial = ''
    let at = 0
    while (at < A_CONVERSATION_BUDGET_BYTES) {
      const read = readSync(fd, chunk, 0, chunk.length, at)
      if (read === 0) return isAConversationRecord(partial + decoder.end())
      at += read
      const lines = (partial + decoder.write(chunk.subarray(0, read))).split('\n')
      partial = lines.pop() ?? ''
      if (lines.some(isAConversationRecord)) return true
    }
    return true
  } catch {
    return true
  } finally {
    closeSync(fd)
  }
}

function isAConversationRecord(line: string): boolean {
  let record: unknown
  try {
    record = JSON.parse(line)
  } catch {
    return false
  }
  if (record === null || typeof record !== 'object') return false
  const { type } = record as { type?: unknown }
  return type === 'user' || type === 'assistant'
}

export function launchTranscriptCwd(
  sessionId: string,
  cwd: string,
  providerHome: string,
): string | null {
  const projects = join(providerHome, 'projects')
  let folders: string[]
  try {
    folders = readdirSync(projects)
  } catch (error) {
    if (isAnAbsence(error)) return null
    throw error
  }
  const named = claudeProjectDirName(cwd)
  for (const folder of [named, ...folders.filter((one) => one !== named)]) {
    const recorded = recordedCwdIn(join(projects, folder, `${sessionId}.jsonl`), sessionId)
    if (recorded !== undefined) return recorded
  }
  return null
}

export function claudeTranscriptPath(
  sessionId: string,
  cwd: string,
  providerHome: string,
): string | null {
  const projects = join(providerHome, 'projects')
  const transcript = `${sessionId}.jsonl`
  const named = claudeProjectDirName(cwd)
  const at = (folder: string): string | null => {
    const path = join(projects, folder, transcript)
    return existsSync(path) ? path : null
  }
  const first = at(named)
  if (first !== null) return first
  let folders: string[]
  try {
    folders = readdirSync(projects)
  } catch {
    return null
  }
  for (const folder of folders) {
    if (folder === named) continue
    const found = at(folder)
    if (found !== null) return found
  }
  return null
}

const RECORDED_CWD_BUDGET_BYTES = 1024 * 1024

function recordedCwdIn(path: string, sessionId: string): string | null | undefined {
  let fd: number
  try {
    fd = openSync(path, 'r')
  } catch (error) {
    if (isAnAbsence(error)) return undefined
    throw error
  }
  try {
    const buffer = Buffer.alloc(RECORDED_CWD_BUDGET_BYTES)
    const read = readSync(fd, buffer, 0, buffer.length, 0)
    const lines = buffer.subarray(0, read).toString('utf8').split('\n')

    if (read === buffer.length) lines.pop()
    for (const line of lines) {
      let record: unknown
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      if (record === null || typeof record !== 'object') continue
      const { cwd, sessionId: named } = record as { cwd?: unknown; sessionId?: unknown }
      if (typeof named === 'string' && named !== sessionId) return null
      if (typeof cwd === 'string' && cwd !== '') return cwd
    }
    return null
  } finally {
    closeSync(fd)
  }
}

export class ClaudeRuntime implements AgentRuntime {
  readonly provider = 'claude' as const
  private readonly queryFactory: QueryFactory
  private readonly sessionExists: SessionExists
  private readonly authTokenProvider: ClaudeAuthTokenProvider | undefined
  private readonly authTokenProviderAsync: ClaudeAuthTokenProviderAsync | undefined

  private readonly launchTokenProvider: ClaudeAuthTokenProviderAsync | undefined

  private readonly spawnChild: SpawnChild
  private readonly apiKeyProvider: ClaudeApiKeyProviderAsync | undefined

  private readonly platform: NodeJS.Platform

  private readonly program: string | undefined

  constructor(
    queryFactory: QueryFactory = query,
    sessionExists: SessionExists = defaultSessionExists,
    authTokenProvider?: ClaudeAuthTokenProvider,
    authTokenProviderAsync?: ClaudeAuthTokenProviderAsync,
    spawnChild: SpawnChild = spawnClaudeChild,
    apiKeyProvider?: ClaudeApiKeyProviderAsync,
    platform: NodeJS.Platform = process.platform,

    whyNoLogin: () => string = () => whyNoClaudeLogin({ platform }),
    program?: string,
    launchTokenProvider?: ClaudeAuthTokenProviderAsync,
    private readonly managedProviderHomesRoot?: string,
    private readonly readableFolders: readonly string[] = [],
  ) {
    this.queryFactory = queryFactory
    this.sessionExists = sessionExists
    this.authTokenProvider = authTokenProvider
    this.authTokenProviderAsync = authTokenProviderAsync
    this.spawnChild = spawnChild
    this.apiKeyProvider = apiKeyProvider
    this.platform = platform
    this.whyNoLogin = whyNoLogin
    this.program = program
    this.launchTokenProvider = launchTokenProvider
  }

  private async authForALaunch(): Promise<{ key: string | null; login?: string | null }> {
    const key = (await this.apiKeyProvider?.()) ?? null
    if (key !== null && key !== '') return { key }
    return { key: null, login: await this.launchTokenProvider?.() }
  }

  private readonly whyNoLogin: () => string

  private queryOrWhyNot(params: Parameters<QueryFactory>[0]): ClaudeQuery {
    const program = this.program
    if (program !== undefined) params.options.pathToClaudeCodeExecutable = program
    try {
      return this.queryFactory(params)
    } catch (error) {
      throw program === undefined
        ? aProgramTheSdkCouldNotFind(error)
        : aProgramThatCouldNotRun(program, error)
    }
  }

  private spawnWitness(sessionId?: string): ClaudeChildWitness {
    return watchClaudeChild(this.spawnChild, sessionId)
  }

  async start(opts: StartOptions): Promise<SessionHandle> {
    assertNotCancelled(opts.signal, 'claude start')
    const input = new AsyncQueue<SDKUserMessage>()

    const effort = claudeEffort(resolveReasoningEffort(opts) ?? '') ?? undefined

    const handle = new ClaudeSessionHandle(
      input,
      opts.cwd,
      0,
      undefined,
      opts.approvalMode,
      effort,
      opts.model,
      opts.planMode,

      this.authTokenProviderAsync,

      opts.workFolders,
      opts.managedPluginMcp,
      opts.observeManagedPlugins,
    )
    handle.noteAlwaysRulesFile()
    const auth = await this.authForALaunch()
    assertNotCancelled(opts.signal, 'claude start')
    opts.startPhases?.('credentials-read')

    const kept = await keptRulesForALaunch(
      opts.providerHome,
      handle.launchLocalFiles(),
      opts.signal,
    )
    assertNotCancelled(opts.signal, 'claude start')
    opts.startPhases?.('rules-read')
    const options = this.optionsFor(
      handle,
      confinementFor(opts.cwd, opts),
      opts.model,
      opts.systemHint,
      effort,
      opts.planMode,

      opts.agentTools,

      opts.externalMcp,
      auth,
      kept,
      opts.builtInSkills,
      opts.sharedSkillsRoot,
      opts.managedPluginMcp,
    )
    handle.noteBuiltInSkills(opts.builtInSkills)
    handle.noteSharedSkills(opts.sharedSkillsRoot)

    if (opts.ultracode === true) {
      options.settings = { ...options.settings, ultracode: true }
      handle.askedForUltracode()
    }

    const launchedAs = randomUUID()
    const child = this.spawnWitness(launchedAs)
    options.spawnClaudeCodeProcess = child.spawn

    options.sessionId = launchedAs
    handle.holdLaunchRef(launchedAs, async () =>
      launchTranscriptCwd(launchedAs, opts.cwd, opts.providerHome),
    )
    let query: ClaudeQuery | null = null
    try {
      query = this.queryOrWhyNot({ prompt: input, options })

      const refusedAfterItsPipes = await child.spawnFailure()
      if (refusedAfterItsPipes !== null) throw refusedAfterItsPipes

      assertNotCancelled(opts.signal, 'claude start')
      if (child.pid !== undefined) opts.startPhases?.('spawned')
    } catch (error) {
      if (query !== null) {
        try {
          query.close()
        } catch {
          // Detach failure must not replace the original start failure.
        }
      }
      input.close()

      await child.close()
      const spawnFailure = await child.spawnFailure()
      if (spawnFailure === null) throw error
      throw spawnFailure
    }
    handle.attachQuery(query, child)
    handle.begin('started')
    return handle
  }

  async listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
    assertNotCancelled(context.signal, 'claude model list')
    const auth = await this.authForALaunch()
    assertNotCancelled(context.signal, 'claude model list')

    const kept = await keptRulesForALaunch(context.providerHome, null, context.signal)
    const options = this.listOptionsFor(context.providerHome, kept, auth)

    const child = this.spawnWitness()
    options.spawnClaudeCodeProcess = child.spawn
    const probe = this.queryOrWhyNot({ prompt: neverSends(), options })

    let closing: Promise<void> | null = null
    const closeProbe = (): Promise<void> => {
      if (closing === null) {
        probe.close()
        closing = finishClaudeChild(probe, child, CLOSE_EXIT_RECEIPT_TIMEOUT_MS)
      }
      return closing
    }
    const cancel = cancelWith(context.signal, closeProbe)
    try {
      if (!probe.supportedModels) {
        throw new Error('the pinned SDK query exposes no supportedModels()')
      }

      const models = await withDeadline(probe.supportedModels(), MODEL_PROBE_TIMEOUT_MS, 'claude')
      if (cancel.cancelled) throw new Error('claude model list was cancelled')
      return models.map((model) => ({
        id: model.value,
        label: model.displayName || model.value,
        ...(model.description ? { description: model.description } : {}),

        ...(model.resolvedModel && model.resolvedModel !== model.value
          ? { resolvesTo: model.resolvedModel }
          : {}),

        ...(model.value === CLAUDE_DEFAULT_BY_NAME.model ? { isDefault: true as const } : {}),

        ...(model.supportedEffortLevels && model.supportedEffortLevels.length > 0
          ? { efforts: model.supportedEffortLevels.map((level) => ({ id: level, label: level })) }
          : {}),

        // Only rows that advertise effort get BroCrew's fallback effort.
        ...(model.supportedEffortLevels?.includes(CLAUDE_DEFAULT_BY_NAME.effort)
          ? { defaultEffort: CLAUDE_DEFAULT_BY_NAME.effort }
          : {}),
      }))
    } finally {
      cancel.release()

      try {
        await closeProbe()
      } catch {
        // A probe that cannot close has no further cleanup available here.
      }
    }
  }

  private listOptionsFor(
    providerHome: string,
    kept: KeptRuleLists,
    auth?: { key: string | null; login?: string | null },
  ): Options {
    const { additions } = this.childEnvAdditions(providerHome, auth)
    const options: Options = {
      env: buildChildEnv(additions, process.env, this.platform),
      strictMcpConfig: true,

      settingSources: [],

      settings: {
        ...flagSettingsFor(providerHome, kept),
        ...managedTranscriptSettings(providerHome, this.managedProviderHomesRoot),
      },
    }
    return options
  }

  async resume(ref: SessionRef, options: ResumeOptions): Promise<SessionHandle> {
    if (ref.provider !== 'claude') {
      throw new ResumeError(ref, `wrong provider: expected claude, got ${ref.provider}`)
    }

    let input: AsyncQueue<SDKUserMessage> | null = null
    let query: ClaudeQuery | null = null

    let child: ClaudeChildWitness | null = null
    try {
      assertNotCancelled(options.signal, 'claude resume')

      if (!(await this.sessionExists(ref.sessionId, ref.cwd, options.providerHome))) {
        throw new ResumeError(ref, `session not found: ${ref.sessionId}`, { noSuchSession: true })
      }
      options.startPhases?.('transcript-found')
      const auth = await this.authForALaunch()

      assertNotCancelled(options.signal, 'claude resume')
      options.startPhases?.('credentials-read')

      const stillPlanning = options.planMode === true && options.planModeEnded !== true
      input = new AsyncQueue<SDKUserMessage>()
      const handle = new ClaudeSessionHandle(
        input,
        ref.cwd,
        ref.rotation,
        ref,
        options.approvalMode,

        claudeEffort(resolveReasoningEffort(options) ?? '') ?? undefined,

        options.model,
        stillPlanning,

        this.authTokenProviderAsync,

        options.workFolders,
        options.managedPluginMcp,
        options.observeManagedPlugins,
      )
      handle.noteAlwaysRulesFile()

      const kept = await keptRulesForALaunch(
        options.providerHome,
        handle.launchLocalFiles(),
        options.signal,
      )
      assertNotCancelled(options.signal, 'claude resume')
      options.startPhases?.('rules-read')

      const built = this.optionsFor(
        handle,

        confinementFor(ref.cwd, options),
        options.model,

        options.systemHint,
        resolveReasoningEffort(options),

        stillPlanning,

        options.agentTools,

        options.externalMcp,
        auth,
        kept,
        options.builtInSkills,
        options.sharedSkillsRoot,
        options.managedPluginMcp,
      )
      handle.noteBuiltInSkills(options.builtInSkills)
      handle.noteSharedSkills(options.sharedSkillsRoot)

      child = this.spawnWitness(ref.sessionId)
      const resumeOptions: Options = {
        ...built,
        resume: ref.sessionId,

        spawnClaudeCodeProcess: child.spawn,
      }
      query = this.queryOrWhyNot({ prompt: input, options: resumeOptions })

      const spawnFailed = await child.spawnFailure()
      if (spawnFailed !== null) throw spawnFailed

      assertNotCancelled(options.signal, 'claude resume')
      if (child.pid !== undefined) options.startPhases?.('spawned')
      handle.attachQuery(query, child)
      handle.begin('resumed')
      return handle
    } catch (error) {
      if (query) {
        try {
          query.close()
        } catch {
          // Detach failure must not replace the original resume failure.
        }
      }
      input?.close()
      await child?.close()

      if (
        error instanceof ResumeError ||
        error instanceof AuthUnavailableError ||
        error instanceof ClaudeUnavailableError
      ) {
        throw error
      }

      const spawnFailure = child === null ? null : await child.spawnFailure()
      const failed = spawnFailure ?? error
      throw new ResumeError(ref, `resume setup failed: ${errorMessage(failed)}`, { cause: failed })
    }
  }

  private optionsFor(
    handle: ClaudeSessionHandle,
    confinement: SessionConfinement,
    model: string | undefined,
    systemHint?: string,
    effort?: ReasoningEffort,
    planMode?: boolean,
    agentTools?: AgentToolset,
    externalMcp?: ExternalMcpReach,

    auth?: { key: string | null; login?: string | null },

    kept: KeptRuleLists = {},
    builtInSkills?: BuiltInSkillsContext,
    sharedSkillsRoot?: string,
    managedPluginMcp?: readonly ManagedPluginMcpServer[],
  ): Omit<Options, 'settings'> & { settings: Settings } {
    handle.noteSharedSkills(sharedSkillsRoot)

    const { cwd, providerHome } = confinement

    const { additions, onAKey } = this.childEnvAdditions(providerHome, auth)
    const injected = additions.CLAUDE_CODE_OAUTH_TOKEN
    if (injected) handle.noteLaunchCredential(injected)
    if (onAKey) handle.noteLaunchedOnAKey()

    const mcpServers = claudeMcpServersFor(agentTools, externalMcp?.servers ?? [], managedPluginMcp)
    handle.configurePluginRefresh(
      (next) => claudeMcpServersFor(agentTools, externalMcp?.servers ?? [], next) ?? {},
    )

    handle.noteDeclaredToolset(agentTools)

    const deniedToolNames = [...CLAUDE_TOOLS_TURNED_OFF, ...forbiddenExternalSpellings(externalMcp)]
    const guardHooks = promptGuardHooks(
      () => handle.approval.effective,

      railsAreTheWholeGate(agentTools),
    )
    const receiptHooks = schedulingReceiptHooks(
      (input) => handle.noteSchedulingCall(input),
      (input) => handle.noteSchedulingAnswer(input),
    )
    const options: Omit<Options, 'settings'> & { settings: Settings } = {
      cwd,
      includePartialMessages: true,

      perTaskStopAffordance: true,

      permissionMode: permissionModeFor(planMode === true),

      tools: [...SEARCH_TOOLS_VOCABULARY, ...(builtInSkills ? ['Skill'] : [])],

      disallowedTools: deniedToolNames,

      ...(effort && claudeEffort(effort) ? { effort: claudeEffort(effort)! } : {}),

      settingSources: [],
      ...(builtInSkills ? claudeBuiltInSkillOptions(builtInSkills, sharedSkillsRoot) : {}),
      // Card 483: read_document names a kept file by its path, and card 484 a long reply's file, so
      // the agent may read those folders without asking, as `--add-dir` grants; a work-folder change
      // does not reset them.
      ...(this.readableFolders.length === 0
        ? {}
        : { additionalDirectories: [...this.readableFolders] }),

      hooks: {
        // The guard decides; the receipt hook beside it only notes what it is handed.
        PreToolUse: [...guardHooks.PreToolUse, ...receiptHooks.PreToolUse],
        PostToolUse: receiptHooks.PostToolUse,
        Stop: scheduleReaderHooks(
          (crons) => handle.noteSessionCrons(crons, 'hook/Stop'),
          (level) => handle.noteReportedEffort(level),
        ),
      },

      env: buildChildEnv(additions, process.env, this.platform),
      strictMcpConfig: true,

      settings: {
        ...handle.launchFlagSettings(providerHome, kept),
        ...managedTranscriptSettings(providerHome, this.managedProviderHomesRoot),
      },

      canUseTool: (name, toolInput, o) =>
        handle.handleCanUseTool(name, toolInput, o as ToolPermissionOptions),
    }
    if (model) options.model = model

    options.onElicitation = (request, o) => handle.handleElicitation(request, o.signal, o.requestId)

    if (mcpServers) options.mcpServers = mcpServers

    options.systemPrompt = {
      type: 'preset',
      preset: 'claude_code',
      ...(systemHint ? { append: systemHint } : {}),
      snapshot: false,
    }
    handle.launchSettings = claudeLaunchSettings(options, handle.approval.effective)
    return options
  }

  private childEnvAdditions(
    providerHome: string,
    auth?: { key: string | null; login?: string | null },
  ): {
    additions: Record<string, string>
    onAKey: boolean
  } {
    if (!providerHome) {
      throw new Error(
        'refusing to launch Claude without an app-owned provider home: an empty CLAUDE_CONFIG_DIR ' +
          'would fall back to the personal ~/.claude',
      )
    }

    const additions: Record<string, string> = {
      CLAUDE_CONFIG_DIR: providerHome,
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    }

    const apiKey = auth?.key ?? null
    if (apiKey !== null && apiKey !== '') {
      additions.ANTHROPIC_API_KEY = apiKey
      return { additions, onAKey: true }
    }

    const token = auth?.login !== undefined ? auth.login : this.authTokenProvider?.()
    if (token !== undefined) {
      if (!token) {
        throw new AuthUnavailableError('claude', this.whyNoLogin())
      }

      additions.CLAUDE_CODE_OAUTH_TOKEN = token
    }
    return { additions, onAKey: false }
  }
}
