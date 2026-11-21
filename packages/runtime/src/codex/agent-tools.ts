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
 * ⛔ **Answer one tool call** (348).
 *
 * ## 🔴 `success` is `isError` in Codex's spelling, and a refusal is not one
 *
 * `307`, on both providers: *"a refusal must be a SUCCESSFUL call whose payload says refused"*, and
 * a thrown handler becomes transport-shaped `-32603` which *"carries no machine-readable policy
 * meaning"*. The JSON-RPC response is a result either way — that is the successful call — so
 * `success` is the finer question, and it is answered exactly as {@link claudeMcpServersFor}
 * answers `isError`:
 *
 * | what happened | `success` |
 * |---|---|
 * | the tool answered — granted **or refused** | `true` |
 * | no tool ran (nothing by that name, or the arguments were not an object) | `false` |
 * | the handler threw | `false` |
 *
 * Only the prose is sent as model content. Structured facts stay inside the application.
 */
export async function answerCodexToolCall(
  /**
   * ⚠️ **`undefined` is accepted, and answers the same sentence a wrong name does.** A session that
   * declared no tools cannot be called, so a call that arrives anyway is addressing something that
   * does not exist here — which is exactly what {@link TOOL_REFUSALS}' `no-such-agent` ruling is
   * about one door over: two different sentences for *"never existed"* and *"not yours"* would let
   * a caller learn which sessions have tools from the shape of the answer.
   */
  toolset: AgentToolset | undefined,
  call: CodexToolCall,
  completed?: (answer: AgentToolAnswer) => void,
): Promise<DynamicToolCallResponse> {
  if (toolset === undefined) return failed(`${call.tool} is not a tool this session offers`)
  // ⚠️ **`null` is accepted as well as our own name.** We declare a namespace, so a call should
  // carry it; `null` is the shape a FLAT declaration produces and the live rig records which one
  // actually arrives. Accepting both costs nothing — the namespace is an address, not a
  // credential, and `serverRequestScopeProblem` has already bound this request to this thread and
  // this turn before anything here runs.
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
    // ⚠️ **`success: false` HERE and nowhere else** — this is the one shape that really is a broken
    // tool, and saying so is what keeps a refusal meaning something. The contract this translates
    // from says a handler must not throw; this exists because "must not" is not "cannot".
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
