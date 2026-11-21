import type { PermissionUpdate, PermissionUpdateDestination } from '@anthropic-ai/claude-agent-sdk'

import { elicitationWords, type McpElicitation } from '../mcp-elicitation'
import {
  persistenceOf,
  publishedOffer,
  type GrantRule,
  type PermissionGrants,
  type PermissionOutcome,
  type PermissionScope,
  type UserInputQuestion,
} from '../permission'
import { isWithin } from '../internal/confinement'
import { realResolve } from '../internal/real-path'

export const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

const PATH_COMPLETE_TOOLS = new Set([...FILE_TOOLS, 'Read', 'NotebookRead'])

function disclosedPaths(input: Record<string, unknown>): string[] {
  const paths: string[] = []
  for (const key of ['file_path', 'notebook_path', 'path']) {
    const value = input[key]
    if (typeof value === 'string' && value) paths.push(value)
  }
  return [...new Set(paths)].sort()
}

export interface ToolPermissionOptions {
  toolUseID: string
  title?: string
  signal?: AbortSignal

  suggestions?: PermissionUpdate[]

  decisionReason?: string

  blockedPath?: string

  suppressAlwaysAllowRule?: boolean

  defaultToNo?: boolean
}

export const ELICITATION_ID_PREFIX = 'elicitation-'

export function claudeElicitationPrompt(elicitation: McpElicitation): string {
  const saying =
    `${elicitation.serverName} is asking you something. Claude names the server and not the ` +
    `call, so BroCrew cannot tell you which of this server\u2019s tools you are answering for.`
  return `${saying}${elicitationWords(elicitation)}`
}

export function claudeAnswerText(values: readonly string[]): string {
  return values.join(', ')
}

export function claudeFreeformResponse(
  typed: ReadonlyMap<string, readonly string[]>,
): string | undefined {
  if (typed.size !== 1) return undefined
  const [only] = [...typed.values()]
  return only?.length === 1 ? only[0] : undefined
}

export const CLAUDE_AVAILABLE_DECISIONS: readonly PermissionOutcome[] = [
  'allow',
  'allow_for_session',
  'allow_all_for_session',
  'allow_always',
  'deny',
  'cancel',
]

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host || undefined
  } catch {
    return undefined
  }
}

export function claudeScope(
  cwd: string,
  toolName: string,
  input: Record<string, unknown>,
  grantsWithheld = false,

  suggestions: readonly PermissionUpdate[] = [],

  alwaysFile?: string,
): PermissionScope {
  const uniquePaths = disclosedPaths(input)
  const networkHosts: string[] = []
  const url = input['url']
  if (typeof url === 'string') {
    const host = hostOf(url)
    if (host) networkHosts.push(host)
  }

  const fullyDisclosed = PATH_COMPLETE_TOOLS.has(toolName) && uniquePaths.length > 0
  const decisions = claudeDecisionsFor(fullyDisclosed, grantsWithheld, toolName, suggestions)
  const grants = claudeGrantsOf(decisions, toolName, suggestions, alwaysFile)
  return {
    cwd: SHELL_TOOLS.has(toolName) ? undefined : cwd,
    paths: uniquePaths,
    networkHosts,

    persistence: persistenceOf(decisions),
    ...(grants === null ? {} : { grants }),
    amendments: [],

    availableDecisions: publishedOffer(decisions),

    underDisclosed: !fullyDisclosed && !theCommandIsTheWholeCall(toolName, input),
  }
}

const A_SHELL_CALLS_SHOWN_FIELDS: ReadonlySet<string> = new Set([
  'command',
  'description',
  'timeout',
  'run_in_background',
])

function theCommandIsTheWholeCall(toolName: string, input: Record<string, unknown>): boolean {
  return (
    SHELL_TOOLS.has(toolName) &&
    typeof input['command'] === 'string' &&
    Object.keys(input).every((key) => A_SHELL_CALLS_SHOWN_FIELDS.has(key))
  )
}

function claudeDecisionsFor(
  fullyDisclosed: boolean,
  grantsWithheld = false,
  toolName = '',
  suggestions: readonly PermissionUpdate[] = [],
): readonly PermissionOutcome[] {
  if (grantsWithheld) {
    return CLAUDE_AVAILABLE_DECISIONS.filter(
      (outcome) =>
        outcome !== 'allow_for_session' &&
        outcome !== 'allow_all_for_session' &&
        outcome !== 'allow_always',
    )
  }

  const cli = sessionGrantOf(suggestions)
  return CLAUDE_AVAILABLE_DECISIONS.filter((outcome) =>
    outcome === 'allow_for_session'
      ? cli.length > 0
      : outcome === 'allow_always'
        ? suggestions.some(keptByTheCli)
        : outcome === 'allow_all_for_session'
          ? !fullyDisclosed && !isTheWholeTool(cli, toolName)
          : true,
  )
}

const KEPT_DESTINATION: PermissionUpdateDestination = 'localSettings'

const OFFERED_DESTINATIONS: ReadonlySet<PermissionUpdateDestination> = new Set([
  KEPT_DESTINATION,
  'session',
])

export function keptByTheCli(update: PermissionUpdate): boolean {
  return update.destination === KEPT_DESTINATION
}

const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

function suggestionsOf(options: ToolPermissionOptions): PermissionUpdate[] {
  return Array.isArray(options.suggestions) ? options.suggestions : []
}

export function cliRowOf(
  toolName: string,
  options: ToolPermissionOptions,
  worksIn: readonly string[],
): PermissionUpdate[] {
  const offered = suggestionsOf(options)
    .flatMap(addsAFolder(worksIn))
    .filter(
      (update) =>
        OFFERED_DESTINATIONS.has(update.destination) &&
        !(
          (update.type === 'addRules' ||
            update.type === 'replaceRules' ||
            update.type === 'removeRules') &&
          update.behavior !== 'allow'
        ),
    )
  if (!SHELL_TOOLS.has(toolName)) return offered
  const namedAFile = options.blockedPath !== undefined
  return offered.flatMap((update): PermissionUpdate[] => {
    if (update.type === 'addDirectories') return [update]
    if (update.type !== 'addRules' || update.behavior !== 'allow') return []

    const rules = namedAFile
      ? update.rules.filter((rule) => rule.toolName !== toolName)
      : update.rules
    if (rules.length === 0) return []
    if (update.destination !== KEPT_DESTINATION) return [{ ...update, rules }]

    const once = rules.filter((rule) => rule.toolName === toolName && namesOneCommand(rule))
    const kept = rules.filter((rule) => !once.includes(rule))
    return [
      ...(kept.length === 0 ? [] : [{ ...update, rules: kept }]),
      ...(once.length === 0 ? [] : [{ ...update, rules: once, destination: 'session' as const }]),
    ]
  })
}

function addsAFolder(worksIn: readonly string[]): (update: PermissionUpdate) => PermissionUpdate[] {
  const held = worksIn.flatMap((folder) => realResolve(folder) ?? [])
  return (update) => {
    if (update.type !== 'addDirectories') return [update]
    const directories = update.directories.filter((path) => {
      const real = realResolve(path)
      return real === null || !held.some((folder) => isWithin(folder, real))
    })
    return directories.length === 0 ? [] : [{ ...update, directories }]
  }
}

function namesOneCommand(rule: { readonly ruleContent?: string }): boolean {
  return rule.ruleContent !== undefined && !/(?: |:)\*$/.test(rule.ruleContent)
}

export function sessionGrantOf(row: readonly PermissionUpdate[]): PermissionUpdate[] {
  return row.map((update) => ({ ...update, destination: 'session' }))
}

export function alwaysGrantOf(row: readonly PermissionUpdate[]): PermissionUpdate[] {
  return row.flatMap((update): PermissionUpdate[] =>
    keptByTheCli(update) ? [update, { ...update, destination: 'session' }] : [update],
  )
}

export function wholeToolsOf(updates: readonly PermissionUpdate[]): string[] {
  return updates.flatMap((update) =>
    update.type === 'addRules' && update.behavior === 'allow'
      ? update.rules.filter((rule) => rule.ruleContent === undefined).map((rule) => rule.toolName)
      : [],
  )
}

function isTheWholeTool(updates: readonly PermissionUpdate[], toolName: string): boolean {
  return updates.some(
    (update) =>
      update.type === 'addRules' &&
      update.behavior === 'allow' &&
      update.rules.some((rule) => rule.toolName === toolName && rule.ruleContent === undefined),
  )
}

function grantRulesOf(updates: readonly PermissionUpdate[]): GrantRule[] {
  return updates.flatMap((update): GrantRule[] => {
    if (update.type === 'addRules' && update.behavior === 'allow') {
      return update.rules.map((rule) => ({
        kind: 'tool',
        tool: rule.toolName,
        ...(rule.ruleContent === undefined ? {} : { content: rule.ruleContent }),
      }))
    }
    if (update.type === 'setMode') return [{ kind: 'mode', mode: update.mode }]
    if (update.type === 'addDirectories') {
      return update.directories.map((path) => ({ kind: 'directory', path }))
    }
    return []
  })
}

function claudeGrantsOf(
  decisions: readonly PermissionOutcome[],
  toolName: string,
  suggestions: readonly PermissionUpdate[],
  alwaysFile: string | undefined,
): PermissionGrants | null {
  const grants: PermissionGrants = {}
  if (decisions.includes('allow_for_session')) {
    grants.allow_for_session = grantRulesOf(sessionGrantOf(suggestions))
  }
  if (decisions.includes('allow_all_for_session')) {
    grants.allow_all_for_session = [{ kind: 'tool', tool: toolName }]
  }
  if (decisions.includes('allow_always')) {
    grants.allow_always = grantRulesOf(suggestions.filter(keptByTheCli))
    if (alwaysFile !== undefined) grants.alwaysFile = alwaysFile
  }
  return Object.keys(grants).length === 0 ? null : grants
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function planDocument(toolName: string, input: Record<string, unknown>): string {
  if (toolName !== 'ExitPlanMode') return ''
  const plan = input['plan']
  return typeof plan === 'string' ? plan.trim() : ''
}

export function userInputPrompt(
  toolName: string,
  title: string | undefined,
  hasPlan: boolean,
): string {
  if (title !== undefined && title !== '') return title
  switch (toolName) {
    case 'ExitPlanMode':
      return hasPlan
        ? 'The agent has finished planning and asks you to approve its plan.'
        : 'The agent asks you to approve its plan — but did not send the plan itself.'

    default:
      return toolName
  }
}

export function claudeQuestions(
  toolName: string,
  input: Record<string, unknown>,
): UserInputQuestion[] {
  if (toolName !== 'AskUserQuestion' || !Array.isArray(input['questions'])) return []
  return input['questions'].map((q, i) => ({
    id: `q${i}`,
    prompt: isRecord(q) && typeof q['question'] === 'string' ? q['question'] : `question ${i + 1}`,

    header: (isRecord(q) && typeof q['header'] === 'string' ? q['header'] : '') || undefined,

    options:
      isRecord(q) && Array.isArray(q['options'])
        ? q['options'].map((o) =>
            isRecord(o) && typeof o['label'] === 'string'
              ? {
                  label: o['label'],

                  ...(typeof o['description'] === 'string' && o['description'] !== ''
                    ? { description: o['description'] }
                    : {}),
                }
              : { label: String(o) },
          )
        : [],

    allowOther: (isRecord(q) && Array.isArray(q['options']) ? q['options'].length : 0) > 0,

    multiSelect: isRecord(q) && q['multiSelect'] === true,
  }))
}

export function summarizeForDetail(toolName: string, input: Record<string, unknown>): string {
  const command = input['command']

  if (typeof command === 'string') return command
  const filePath = input['file_path']
  if (typeof filePath === 'string') return filePath
  return toolName
}
