import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z, type ZodRawShape } from 'zod'
import {
  agentToolHandlerObject,
  type AgentToolset,
  type AgentToolDefinition,
  type AgentToolAnswer,
} from './agent-tools'
import { messageActMetadata } from './message-act'

export type AgentMcpDispatch = (
  tool: AgentToolDefinition,
  args: Record<string, unknown>,
  extra: unknown,
) => Promise<AgentToolAnswer>

// Both providers serve the same schemas, handlers and receipt metadata.
export function createAgentMcpServer(
  toolset: AgentToolset,
  dispatch: AgentMcpDispatch = (one, args) => one.call(args),
) {
  return createSdkMcpServer({
    name: toolset.server,
    ...(toolset.instructions === undefined ? {} : { instructions: toolset.instructions }),
    tools: toolset.tools.map((one) =>
      tool(
        one.name,
        one.description,
        looseShape(one.input, one.handlerOwnsMissingInput === true),
        async (args, extra) => {
          // ⛔ **The answer is a SUCCESS whether it grants or refuses, and `isError` is never set**
          // (307). A thrown handler becomes transport-shaped `-32603`, which *"carries no
          // machine-readable policy meaning"* — the child learns that a tool broke, not that a rail
          // stopped it. The contract this translates from says a handler must not throw; this
          // `catch` exists because "must not" is not "cannot", and a defect in one tool must not
          // reach the model wearing the costume of a policy decision.
          //
          // Only prose is model content; message receipts carry a small internal pairing field.
          try {
            const answer = await dispatch(one, args as Record<string, unknown>, extra)
            const metadata =
              one.name === 'message_agent' ? messageActMetadata(answer.structured) : undefined
            return {
              content: [{ type: 'text' as const, text: answer.text }],
              ...(metadata === undefined ? {} : { _meta: metadata }),
            }
          } catch (error) {
            // ⚠️ **`isError: true` HERE and nowhere else.** This is the one shape that really is a
            // broken tool, and saying so is what keeps the refusal payload meaning something.
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `${one.name} failed: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            }
          }
        },
      ),
    ),
  })
}

/**
 * 🔴 **The argument schema, made LOOSE so an undocumented key reaches the door** (348, correcting
 * `347`).
 *
 * ## ⛔ `347` shipped a comment that was false on the provider it was written for
 *
 * `spawn_agent` said the request was handed to `admitSpawn` *"almost verbatim"* because `303` B
 * measured eight keys parsing to seven, after which *"the agent it spawned never started, looking
 * exactly like a slow provider"* — and it ends *"anything the caller sent that neither knows about
 * survives into the request and is refused BY NAME, which is the entire point."*
 *
 * ⚠️ **On this provider it did not survive.** Measured end to end against the pinned SDK, driving
 * the in-process server through its own transport:
 *
 * | `inputSchema` | the handler saw |
 * |---|---|
 * | the raw shape (what `347` shipped) | `{profile_slug, purpose}` — **`priority` was gone** |
 * | `z.looseObject(shape)` | `{profile_slug, purpose, priority}` |
 *
 * The MCP SDK parses arguments with `z.object(shape)` before the handler is called
 * (`server/mcp.js`: `safeParseAsync(normalizeObjectSchema(inputSchema), args)`), and a zod object
 * strips unknown keys by default. So `341`'s rail 1 — `spawnRequestSchema` is `.strict()` — could
 * never fire for the one cause it exists for, and a model that sent a key it believed in got a
 * spawn that quietly ignored it. ⛔ That is `303` B in the model's hands, which is the failure
 * `348`'s brief names in one line: *"do not let a transport strip one before the door sees it."*
 *
 * ⚑ **It also changes what the child is TOLD.** The raw shape advertised no `additionalProperties`
 * at all — draft-07 for *"anything goes"* — while silently dropping whatever came. The loose object
 * advertises `additionalProperties: {}` and keeps it: say what you meant, and the door will name
 * what it will not take. The Codex adapter derives its JSON Schema from the same spelling, so the
 * two providers hand the door the same request.
 *
 * ## 🔴 The pinned SDK needs to SEE each child schema to keep its description (490)
 *
 * ⚠️ `createSdkMcpServer` copies Zod 4 descriptions into its own JSON-schema registry by
 * iterating `Object.values(inputSchema)`. That works for a raw shape and sees none of the fields in
 * a `ZodObject`; the loose-object repair above therefore made every argument description disappear
 * on Claude while Codex kept it. The enum structure itself survived, which made this especially
 * deceptive: a vocabulary was visible and none of its member meanings were.
 *
 * ⛔ The numbered enumerable references below are for that SDK walk only. They point at the SAME
 * schema objects reachable through the loose object's shape — including nested object and array
 * members — and add no parsed or advertised property. A provider test drives `tools/list` and
 * proves top-level and nested descriptions and enums arrive, then drives an unknown member through
 * `tools/call` and proves the app's handler still owns its refusal.
 */
function looseShape(shape: ZodRawShape, missingAtHandler = false): ZodRawShape {
  // ⚠️ **The SDK types this parameter as a raw shape and its runtime accepts a zod object** —
  // `getZodSchemaObject` returns a schema instance untouched and only converts a raw shape. The cast
  // is the type system meeting a measurement; the table above is the measurement.
  const loose = missingAtHandler ? agentToolHandlerObject(shape) : z.looseObject(shape)
  if (missingAtHandler) {
    // The SDK lists only schemas whose definition exposes shape. The catch still parses;
    // this alias points to its same advertised children, without adding an argument.
    Object.defineProperty(loose._zod.def, 'shape', { value: shape })
  }
  let index = 0
  const registered = new Set<object>()
  const containers = new Set<object>()
  const registerReachable = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      if (containers.has(candidate)) return
      containers.add(candidate)
      for (const member of candidate) registerReachable(member)
      return
    }
    if (typeof candidate !== 'object' || candidate === null) return
    const possible = candidate as {
      readonly _zod?: { readonly def?: unknown }
      readonly safeParse?: unknown
    }
    // A Zod schema has `safeParse`; internal checks can also carry `_zod` and must not be handed
    // to the SDK registry as if they were input schemas.
    if (typeof possible.safeParse === 'function') {
      if (registered.has(candidate)) return
      registered.add(candidate)
      Object.defineProperty(loose, `__brobot_argument_${String(index)}`, {
        value: candidate,
        enumerable: true,
      })
      index += 1
      registerReachable(possible._zod?.def)
      return
    }
    if (containers.has(candidate)) return
    containers.add(candidate)
    for (const member of Object.values(candidate)) registerReachable(member)
  }
  for (const child of Object.values(shape)) registerReachable(child)
  return loose as unknown as ZodRawShape
}
