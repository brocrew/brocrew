import {
  elicitationWords,
  isRecord,
  readString,
  type McpElicitation as CodexElicitation,
} from '../mcp-elicitation'
export {
  mcpElicitation as codexElicitation,
  elicitationContent,
  elicitationQuestions,
  elicitationWords,
  opensALink,
  serverAsks,
  SKIPPED,
  BOOLEAN_CHOICES,
  MAX_ELICITATION_URL,
  type McpElicitation as CodexElicitation,
} from '../mcp-elicitation'
import { MAX_PERMISSION_DETAIL_CHARS } from '../events'
import type { GrantRule } from '../permission'
import type { ExternalMcpReach } from '../external-mcp'
import { wordsForACard } from '../words-on-a-card'
import type { KeptToolApproval } from './kept-tool-approvals'
import type { JsonValue } from './protocol/serde_json/JsonValue'

export function codexExternalMcpConfig(
  reach: ExternalMcpReach | undefined,

  kept: readonly KeptToolApproval[] = [],
): Record<string, JsonValue> | undefined {
  if (reach === undefined || reach.servers.length === 0) return undefined
  const servers: Record<string, JsonValue> = {}
  for (const one of reach.servers) {
    const always = kept.filter(
      (approval) => approval.server === one.name && approval.url === one.url,
    )
    servers[one.name] =
      always.length === 0
        ? { url: one.url }
        : {
            url: one.url,
            tools: Object.fromEntries(
              always.map((approval) => [approval.tool, { approval_mode: 'approve' }]),
            ),
          }
  }
  return { mcp_servers: servers }
}

export function externalMcpElicitationPrompt(elicitation: CodexElicitation): string {
  const admission =
    `${elicitation.serverName} is asking you something. Codex names the server and not the ` +
    `call, so BroCrew cannot tell you which of this server\u2019s tools you are answering for.`

  return `${admission}${elicitationWords(elicitation)}`
}

export const CODEX_TOOL_APPROVAL_KIND = 'mcp_tool_call'

export interface ToolParameter {
  readonly name: string
  readonly value: string
}

export interface CodexToolApproval {
  readonly serverName: string
  readonly tool: string | null
  readonly question: string
  readonly parameters: readonly ToolParameter[]
  readonly parametersOmitted: number
  readonly toolParams: JsonValue | undefined
  readonly offersSession: boolean
  readonly offersAlways: boolean
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value) ?? ''
}

function displayedParameters(listed: unknown): { kept: ToolParameter[]; omitted: number } {
  const entries: unknown[] = Array.isArray(listed) ? listed : []
  const kept: ToolParameter[] = []
  let used = 0
  for (const [at, entry] of entries.entries()) {
    if (!isRecord(entry)) return { kept, omitted: entries.length - at }
    const shown = readString(entry, 'display_name') || readString(entry, 'name')
    const said = displayValue(entry['value'])
    const name = shown === '' ? '' : wordsForACard(shown)
    const value = said === '' ? '' : wordsForACard(said)
    if (name === null || value === null) return { kept, omitted: entries.length - at }
    used += name.length + value.length
    if (used > MAX_PERMISSION_DETAIL_CHARS) return { kept, omitted: entries.length - at }
    kept.push({ name, value })
  }
  return { kept, omitted: 0 }
}

export function codexToolApproval(params: unknown): CodexToolApproval | null {
  if (!isRecord(params)) return null
  const meta = params['_meta']
  if (!isRecord(meta) || meta['codex_approval_kind'] !== CODEX_TOOL_APPROVAL_KIND) return null
  const serverName = readString(params, 'serverName')
  if (serverName === '' || readString(params, 'mode') !== 'form') return null

  const schema = params['requestedSchema']
  const properties = isRecord(schema) && isRecord(schema['properties']) ? schema['properties'] : {}
  if (Object.keys(properties).length > 0) return null
  const question = readString(params, 'message')
  const tool = readString(meta, 'tool_name') || null
  const { kept, omitted } = displayedParameters(meta['tool_params_display'])
  const persist = meta['persist']
  return {
    serverName,
    tool,
    question,
    parameters: kept,
    parametersOmitted: omitted,
    toolParams: 'tool_params' in meta ? (meta['tool_params'] as JsonValue) : undefined,
    offersSession: Array.isArray(persist) && persist.includes('session'),
    offersAlways: Array.isArray(persist) && persist.includes('always'),
  }
}

export type ClaimedToolApproval = CodexToolApproval & { readonly tool: string }

export function codexToolApprovalDetail(approval: ClaimedToolApproval): string {
  const parameters =
    approval.toolParams === undefined
      ? '(Codex did not say which parameters)'
      : (JSON.stringify(approval.toolParams) ?? '(Codex did not say which parameters)')
  return `${approval.tool} ${parameters}`
}

/** A whole-tool rule and its identity in this adapter's blanket-grant list. */
export function codexToolGrant(server: string, tool: string) {
  return {
    kind: 'tool' as const,
    server,
    tool,
    listedAs: `mcp__${server}__${tool}`,
  } satisfies GrantRule
}

export class McpCallsInFlight {
  private readonly running = new Map<string, { server: string; tool: string; asked: boolean }>()

  private readonly granted: { server: string; tool: string }[] = []

  /** Feed every turn-scoped notification; only an `mcpToolCall` item's start and end are read. */
  note(method: string, params: unknown): void {
    if (method !== 'item/started' && method !== 'item/completed') return
    const item = isRecord(params) ? params['item'] : undefined
    if (!isRecord(item) || item['type'] !== 'mcpToolCall') return
    const id = readString(item, 'id')
    if (id === '') return
    if (method === 'item/completed') {
      this.running.delete(id)
      return
    }
    this.running.set(id, {
      server: readString(item, 'server'),
      tool: readString(item, 'tool'),
      asked: false,
    })
  }

  // The approval marker alone is forgeable; match a running, unasked call too.
  // Frames carry no call id, so simultaneous calls can only be claimed in order.
  claim(server: string, tool: string | null): string | null {
    const unasked = [...this.running.values()].filter(
      (call) =>
        !call.asked &&
        call.server === server &&
        (tool === null || call.tool === tool) &&
        !this.isGranted(call.server, call.tool),
    )
    const call = tool === null && unasked.length !== 1 ? undefined : unasked[0]
    if (call === undefined) return null
    call.asked = true
    return call.tool
  }

  grant(server: string, tool: string): void {
    if (!this.isGranted(server, tool)) this.granted.push({ server, tool })
  }

  get grants(): readonly string[] {
    return this.granted.map((one) => codexToolGrant(one.server, one.tool).listedAs)
  }

  private isGranted(server: string, tool: string): boolean {
    return this.granted.some((one) => one.server === server && one.tool === tool)
  }
}
