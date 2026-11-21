import type { AgentToolAnswer, AgentToolset } from '../agent-tools'
import type { DynamicToolCallResponse } from './protocol/v2'

/** One `item/tool/call`, read off the wire — the fields this module needs and no others. */
export interface CodexToolCall {
  /** The namespace the model addressed, or `null` when it addressed none. */
  readonly namespace: string | null
  readonly tool: string
  /** Whatever the provider sent, before the shared handler checks it. */
  readonly arguments: unknown
  readonly callId?: string
}

/**
 * Answer one tool call. `success` is `isError` in Codex's spelling, and a refusal is not one: a
 * refusal is a successful call whose payload says refused.
 *
 * | what happened | `success` |
 * |---|---|
 * | the tool answered, granted or refused | `true` |
 * | no tool ran (unknown name, or arguments not an object) | `false` |
 * | the handler threw | `false` |
 *
 * Only the prose is sent as model content; structured facts stay inside the application.
 */
export async function answerCodexToolCall(
  /**
   * `undefined` (a session that declared no tools) answers the same sentence as a wrong name, so
   * the answer does not reveal which sessions have tools.
   */
  toolset: AgentToolset | undefined,
  call: CodexToolCall,
  completed?: (answer: AgentToolAnswer) => void,
): Promise<DynamicToolCallResponse> {
  if (toolset === undefined) return failed(`${call.tool} is not a tool this session offers`)
  // `null` is accepted as well as our own name: a flat declaration produces a null namespace. The
  // namespace is an address, not a credential; `serverRequestScopeProblem` has already bound this
  // request to its thread and turn.
  if (call.namespace !== null && call.namespace !== toolset.server) {
    return failed(`${call.namespace}/${call.tool} is not a tool this session offers`)
  }
  const tool = toolset.tools.find((one) => one.name === call.tool)
  if (tool === undefined) return failed(`${call.tool} is not a tool this session offers`)
  if (!isPlainObject(call.arguments)) {
    return failed(`${call.tool} was called with arguments that are not an object`)
  }
  try {
    const answer = await tool.call(call.arguments)
    try {
      completed?.(answer)
    } catch {
      // Receipt bookkeeping cannot change an action that already completed.
    }
    return succeeded(answer)
  } catch (error) {
    // `success: false` only here: a throwing handler is a broken tool, and keeping it distinct
    // keeps a refusal meaningful.
    return failed(`${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** A completed answer has one prose item, including an intentionally empty document. */
function succeeded(answer: AgentToolAnswer): DynamicToolCallResponse {
  return { contentItems: [{ type: 'inputText', text: answer.text }], success: true }
}

function failed(text: string): DynamicToolCallResponse {
  return { contentItems: [{ type: 'inputText', text }], success: false }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
