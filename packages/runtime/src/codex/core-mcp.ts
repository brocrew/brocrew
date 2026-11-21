import type { AgentToolAnswer } from '../agent-tools'
import { answerCodexToolCall } from './agent-tools'
import { openAgentMcpHttp, type AgentMcpLaunch } from './agent-mcp-http'
import { CORE_TOOL_WAIT_SECONDS } from './core-tool-deadline'
import { handleAgentToolCall, type AgentCallContext } from './runtime-parts/agent-tool-call'
import { isRecord, readString, requestKey } from './runtime-parts/wire-values'
import type { JsonValue } from './protocol/serde_json/JsonValue'

// The endpoint owns the caller closure; native metadata binds each call to its current turn.
export async function openCodexCoreMcp(
  context: AgentCallContext,
  thread: () => string | null,
  spend: (id: string) => void,
) {
  const tools = context.tools
  if (tools === undefined || tools.tools.length === 0) return undefined
  return openAgentMcpHttp(tools, async (tool, args, extra) => {
    const metadata = isRecord(extra) && isRecord(extra['_meta']) ? extra['_meta'] : {}
    const at = metadata['x-codex-turn-metadata']
    const callId = readString(metadata, 'callId')
    const turn = context.turn()
    if (
      !callId ||
      !isRecord(at) ||
      context.isShuttingDown() ||
      turn === null ||
      readString(at, 'thread_id') !== thread() ||
      !turn.providerTurnId ||
      readString(at, 'turn_id') !== turn.providerTurnId
    )
      return { text: 'this session cannot take tool calls right now' }
    const id = `mcp:${callId}`
    const key = requestKey(id)
    if (context.states.has(key)) return { text: 'this session cannot take tool calls right now' }
    context.states.set(key, { phase: 'claimed', rawId: id, kind: { kind: 'agentTool' } })
    let answer: AgentToolAnswer | undefined
    let executed = false
    let response: unknown
    const running = handleAgentToolCall(
      context,
      id,
      {
        threadId: thread(),
        turnId: turn.providerTurnId,
        callId,
        namespace: tools.server,
        tool: tool.name,
        arguments: args,
      },
      {
        reply: (value) => {
          spend(id)
          response = value
        },
        signal: isRecord(extra) ? (extra['signal'] as AbortSignal | undefined) : undefined,
        execute: (offered, call, completed) => {
          executed = true
          return answerCodexToolCall(offered, call, (value) => {
            answer = value
            completed?.(value)
          })
        },
      },
    )
    context.track(running)
    await running
    if (answer !== undefined) return answer
    const items =
      isRecord(response) && Array.isArray(response['contentItems']) ? response['contentItems'] : []
    const text = items.map((item) => readString(item, 'text')).join('\n')
    if (executed && isRecord(response) && response['success'] === false) {
      const prefix = `${tool.name} failed: `
      throw new Error(text.startsWith(prefix) ? text.slice(prefix.length) : text)
    }
    return { text }
  })
}

// Native approval passes through only this owned transport; the app floor still decides each call.
export function withCodexCoreMcp(
  overlay: { [key: string]: JsonValue | undefined },
  launch: AgentMcpLaunch | undefined,
  names: readonly string[],
): { [key: string]: JsonValue | undefined } {
  if (launch === undefined) return overlay
  const previous = isRecord(overlay['mcp_servers']) ? overlay['mcp_servers'] : {}
  return {
    ...overlay,
    mcp_servers: {
      ...previous,
      [launch.name]: {
        url: launch.url,
        http_headers: { ...launch.headers },
        tool_timeout_sec: CORE_TOOL_WAIT_SECONDS,
        tools: Object.fromEntries(names.map((name) => [name, { approval_mode: 'approve' }])),
      },
    } as JsonValue,
  }
}
