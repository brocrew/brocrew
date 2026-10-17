import { z } from 'zod'
import type { AgentToolAnswer, AgentToolDefinition, AgentToolset } from '../agent-tools'
import type { JsonValue } from './protocol/serde_json/JsonValue'
import type { DynamicToolCallResponse, DynamicToolSpec } from './protocol/v2'

/**
 * ⛔ **Codex's half of the tool asymmetry: tools declared IN THE PROTOCOL, on `thread/start`**
 * (348).
 *
 * ## 🔴 The brief said this needed a stdio child and a `config.toml` merge. It does not.
 *
 * `307` measured Codex acquiring MCP servers from `[mcp_servers]` in its durable home, and `348`'s
 * brief reasoned from it that a Codex child needed **a real stdio server, the wire door `341` §4
 * reserved, and a merge that could write a composite value into a file Codex co-owns**. The
 * vendored protocol carries a second door: `ThreadStartParams.dynamicTools`, answered by
 * `item/tool/call` arriving as an ordinary `ServerRequest` on the connection we already hold.
 *
 * ⚑ **So this is the exact mirror of what `347` found on the Claude side** — `createSdkMcpServer`'s
 * in-process transport — and for the same reason: no subprocess, no socket, no port, nothing to
 * authenticate, and **not one byte written into `config.toml`**. ⛔ That file has already cost this
 * project a hard parse failure (`-32600 duplicate key`) and a deleted `trust_level`; the best
 * outcome available was never to touch it, and that is what this is.
 *
 * ## ⚠️ Measured before it was built — `probe:codex-dynamic-tools`, four arms, zero tokens
 *
 * `044`'s standing rule is that presence in a generated type is a SCHEMA verdict, not proof the
 * server implements it. Against the bundled 0.146.0 binary, through `314`'s loopback capture
 * endpoint so no model turn was ever paid for:
 *
 * | arm | sent | the child's inventory |
 * |---|---|---|
 * | **A · namespace** | one `namespace` spec holding five | all five names |
 * | **B · flat** | five bare `function` specs | all five names |
 * | **C · control** | nothing | **none** |
 * | **D · resume** | on `thread/start` only, then a SECOND app-server resumed the thread | **all five, still there** |
 *
 * ⚠️ **C is what makes A and B measurements.** `thread/start` silently ignores unknown params —
 * `{brobotNotAField: "nonsense"}` is accepted where `{dynamicTools: "nonsense"}` is `-32600` — so a
 * successful call proves nothing on its own.
 *
 * 🔴 **D is the finding the design turns on.** `ThreadResumeParams` has no `dynamicTools` field at
 * all, so if the server did not remember them there would be no way to re-supply them and every
 * resumed Codex agent would silently lose its tools. It remembers them: the app-server keeps a
 * `thread_dynamic_tools` table keyed by thread, and a different process resuming that thread
 * rebuilt the same inventory. ⚑ **`307`'s asymmetry survives, with one word corrected** — Codex is
 * still *survival* rather than *re-supply*; what survives is the app-server's own thread state, not
 * a file in the home.
 *
 * ## 🔴 A namespace, and the flat arm is why — read off the child's own instructions
 *
 * Both shapes reached the model, so this looked like a preference until the two captures were read
 * side by side. **Flat specs are dropped into the same list as Codex's own built-in tools, with no
 * prefix at all:**
 *
 * ```ts
 * declare const tools: { get_goal(args: {}): …; };
 * declare const tools: { spawn_agent(args: { … }): …; };   // ← ours, indistinguishable
 * ```
 *
 * ⛔ **So a flat `interrupt_agent` sits beside `update_goal` as though the provider shipped it**, and the
 * day Codex adds a tool by one of these five names the collision is silent. The namespace form puts
 * them under their own heading with the server's name on every one:
 *
 * ```ts
 * ## brobot
 * declare const tools: { brobot__spawn_agent(args: { … }): …; };
 * ```
 *
 * ⚑ **And that string is what a transcript row is named** — see `toolItemName` in `./normalize.ts`,
 * which had `dynamicToolCall` mapped to the constant `'tool'` until this dispatch, which is `327`'s
 * *"a tool call we flatten to one word"* on a new item type.
 */

/**
 * 🔴 **D-039 · the longest namespace description the app-server takes, in characters** — a longer
 * one and `thread/start` is refused, so no conversation with these tools can start (F055).
 *
 * ⚑ **Read off the binary this app runs** — the bundled `codex-cli 0.146.0`
 * (`@openai/codex-darwin-arm64`, held to `CODEX_PROTOCOL_VERSION`), whose app-server validates every
 * dynamic tool on `thread/start` and carries *"dynamic tool namespace description must be at most
 * … characters"*. ⚠️ **The number is not in the binary's text** — it is formatted in at run time — so
 * it is the refusal's own: *"dynamic tool namespace description must be at most 1024 characters"*.
 * ⛔ The binary holds no such check for a TOOL's description (several of ours run past this
 * number), and a name is checked against `^[a-zA-Z0-9_-]+$` and a length this file does not rely
 * on.
 */
export const CODEX_NAMESPACE_DESCRIPTION_LIMIT = 1024

/**
 * 🔴 **D-039 · what the `brobot` namespace says about itself: one sentence, far under
 * {@link CODEX_NAMESPACE_DESCRIPTION_LIMIT}.** ASCII, so its characters and its bytes are one count.
 *
 * ⛔ **Never {@link AgentToolset.instructions}**, which this was until D-039: they grew to 1,100
 * characters and the app-server refused every conversation that carried them. ⚑ They reach a Codex
 * model whole in the conversation itself — see {@link AgentToolset.instructions}.
 */
export const CODEX_TOOLS_DESCRIPTION = 'Tools that reach the app you are running inside.'

/**
 * ⛔ **The tools this session declares, or `undefined` when it declares none** (348).
 *
 * ⚠️ **An empty toolset is not the same as no toolset, and both answer `undefined`** — the same
 * ruling {@link claudeMcpServersFor} is written under. A namespace advertising nothing would still
 * appear in the child's `exec` surface as a catalogue that lists none, which is acceptance #7's
 * *"nothing unwired implies a working state"* written as a tool declaration.
 */
export function codexDynamicToolsFor(
  toolset: AgentToolset | undefined,
): DynamicToolSpec[] | undefined {
  if (toolset === undefined || toolset.tools.length === 0) return undefined
  return [
    {
      type: 'namespace',
      name: toolset.server,
      // 🔴 **D-039 · one sentence, never the instructions** — see {@link CODEX_TOOLS_DESCRIPTION}.
      description: CODEX_TOOLS_DESCRIPTION,
      tools: toolset.tools.map((one) => ({
        type: 'function' as const,
        name: one.name,
        description: one.description,
        inputSchema: inputSchemaOf(one),
      })),
    },
  ]
}

/**
 * 🔴 **The argument schema as JSON Schema — and it is LOOSE on purpose** (348).
 *
 * ⛔ **`303` B is the reason.** A command arrived with eight keys and parsed to seven, after which
 * *"the agent it spawned never started, looking exactly like a slow provider"*. `give_work`'s door
 * refuses an undocumented key **by name** — `giveRequestSchema` is `.strict()` — and a transport
 * that drops one before the door sees it turns a refusal a model could read into a request that
 * quietly did something else. `348`'s brief says it in one line: *"do not let a transport strip one
 * before the door sees it."*
 *
 * ⚠️ **A strict object here would advertise `additionalProperties: false`**, which tells the model
 * the key is forbidden and — far worse — invites the layer in front of the door to enforce it. The
 * loose spelling says the opposite: send what you meant, and the door will name what it will not
 * take. ⚑ The same correction was owed on the Claude side, where it was measured actually
 * happening — see {@link claudeMcpServersFor}.
 */
function inputSchemaOf(tool: AgentToolDefinition): JsonValue {
  // ⚠️ `z.toJSONSchema` answers a plain JSON document by construction; the protocol types it as
  // `JsonValue`, which TypeScript cannot see through a `Record<string, unknown>`.
  return z.toJSONSchema(z.looseObject(tool.input)) as JsonValue
}

/** One `item/tool/call`, read off the wire — the fields this module needs and no others. */
export interface CodexToolCall {
  /** The namespace the model addressed, or `null` when it addressed none. */
  readonly namespace: string | null
  readonly tool: string
  /** Whatever the provider sent, UNPARSED — see {@link inputSchemaOf}. */
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
