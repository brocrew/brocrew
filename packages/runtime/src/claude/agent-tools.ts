import { createSdkMcpServer, tool, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { z, type ZodRawShape } from 'zod'
import { agentToolHandlerObject, type AgentToolset } from '../agent-tools'
import { messageActMetadata } from '../message-act'
import type { ExternalMcpReach } from '../external-mcp'
import { CLAUDE_TOOL_NAMING, qualifyWith } from '../tool-inventory'

/**
 * ⛔ **Claude's half of the tool asymmetry: an IN-PROCESS MCP server, rebuilt on every query**
 * (347).
 *
 * ⚑ **`createSdkMcpServer` is the whole reason this dispatch did not need a wire door.** The SDK
 * ships an in-process transport, so the five tools run in the same process as the chokepoint they
 * call — no subprocess, no stdio, no socket, no port, and nothing to authenticate. `307` had to
 * stand up a real stdio server to prove the doorway existed; the doorway it proved is reachable
 * from here without one.
 *
 * ## ⚠️ Rebuilt per query, and that is the contract rather than an oversight
 *
 * `307`: *"For Claude, resume necessarily constructed a new query… this is re-supply at cold
 * launch, not a claim that an old process or file survived."* The `Options` of a query are fixed
 * for the life of a session, so the instance built here belongs to exactly one query and a resume
 * builds another. ⛔ **Nothing may cache it across launches** — the closures inside it would answer
 * for a session that has ended.
 *
 * ## 🔴 `strictMcpConfig` stays pinned, and 516 is what makes saying so necessary
 *
 * ⛔ **The rule was NOT abandoned when this function started returning more than one server.** The
 * pinned SDK's own words for the flag are *"Only use MCP servers passed via the `mcpServers`
 * option"* (`sdk.d.ts:2228-2234`). ⚑ **The replacement invariant, which `507` §3.1 wrote and
 * HO-040 §4.4 approved:**
 *
 * > `strictMcpConfig` remains true. It does not mean *"no MCP"*; it means this child may load MCP
 * > only from the app-known `Options.mcpServers` assembled for this launch: BroBot's per-session
 * > in-process server and globally registered external servers granted to this identity. Project
 * > `.mcp.json`, user settings, plugins and on-disk agent/frontmatter MCP remain excluded. The
 * > model-list probe receives neither set because it starts no turn, but retains the pin.
 *
 * ⚠️ **HO-040 §4.4 is the argument in one line:** *"That flag exists so nothing UNINTENDED re-enters
 * a child … A registry a person filled in deliberately is not that. Adding a second KNOWN source is
 * not undoing the property; admitting an UNKNOWN one would be."* ⛔ **The next reader will think the
 * rule was dropped, which is why this paragraph names it rather than leaving the flag to speak.**
 *
 * ## ⛔ An external server can never replace `brobot`, and the check is before construction
 *
 * ⚑ **This function refuses the whole launch rather than building the record**, and
 * the ordering is the security property: written as a spread, an external row named `brobot` would
 * OVERWRITE the in-process server and every one of this app's own tools would be answered by
 * somebody else's endpoint — a substitution nothing downstream could see. ⚠️ Registration already
 * reserves the name, so the only way here is a hand-edited database; failing loudly is the answer to
 * that, because the alternative is a child silently impersonated.
 *
 * ## ⚠️ `Options.tools` does not gate these, and must not be widened for them
 *
 * `Options.tools` is *"the base set of available **built-in** tools"*. MCP tools are not built-in
 * and are not filtered by it, so `SEARCH_TOOLS_VOCABULARY` is left exactly as it is. ⛔ **And
 * `allowedTools` is deliberately not touched either**: that option auto-allows without prompting,
 * and these tools reach `canUseTool` like every other consequential call. Spawning an agent is not
 * a thing this app decided to stop asking about.
 */
export function claudeMcpServersFor(
  toolset: AgentToolset | undefined,
  external: readonly { readonly name: string; readonly url: string }[] = [],
): Record<string, McpServerConfig> | undefined {
  // ⚠️ **An empty toolset is not the same as no toolset, and both answer `undefined` here.** A
  // server advertising nothing would still appear in the child's inventory and in its prompt — a
  // capability block that promises a catalogue and then lists none, which is acceptance #7's
  // "nothing unwired implies a working state" written as an MCP handshake.
  //
  // ⚑ **516 · …and a launch with NO toolset and a granted server still gets the server.** The two
  // halves are independent: `agentTools` is what this app offers, and a registry grant is what a
  // person gave. ⛔ A session holding neither answers `undefined` exactly as it always has, so
  // nothing changes for a launch nobody granted anything.
  const ownServer = toolset === undefined || toolset.tools.length === 0 ? null : toolset.server
  if (ownServer === null && external.length === 0) return undefined
  const servers: Record<string, McpServerConfig> = {}
  // ⛔ **Every external name checked BEFORE anything is constructed** — see the docblock. A
  // duplicate is a throw and never a silent overwrite.
  const taken = new Set<string>(ownServer === null ? [] : [ownServer])
  for (const one of external) {
    if (taken.has(one.name)) {
      throw new Error(
        `external MCP server "${one.name}" collides with a server this launch already has; ` +
          `refusing to build a child whose tools could come from either`,
      )
    }
    taken.add(one.name)
  }
  for (const one of external) {
    // ⛔ **`{type:'http', url}` and nothing else.** No `headers` — stage 1 is unauthenticated
    // loopback only — and no `tools` policy: an external tool is NOT auto-allowed, it reaches
    // `canUseTool` like every other consequential call, which is the whole reason HO-040 §4.1 says
    // external tools are governed by permissions rather than by our rails.
    servers[one.name] = { type: 'http', url: one.url }
  }
  if (ownServer === null) return servers
  return {
    ...servers,
    [ownServer]: createSdkMcpServer({
      name: ownServer,
      ...(toolset?.instructions === undefined ? {} : { instructions: toolset.instructions }),
      tools: (toolset?.tools ?? []).map((one) =>
        tool(
          one.name,
          one.description,
          looseShape(one.input, one.handlerOwnsMissingInput === true),
          async (args) => {
            // ⛔ **The answer is a SUCCESS whether it grants or refuses, and `isError` is never set**
            // (307). A thrown handler becomes transport-shaped `-32603`, which *"carries no
            // machine-readable policy meaning"* — the child learns that a tool broke, not that a rail
            // stopped it. The contract this translates from says a handler must not throw; this
            // `catch` exists because "must not" is not "cannot", and a defect in one tool must not
            // reach the model wearing the costume of a policy decision.
            //
            // Only prose is model content; message receipts carry a small internal pairing field.
            try {
              const answer = await one.call(args as Record<string, unknown>)
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
    }),
  }
}

/**
 * 🔴 **Every spelling of one of OUR tool names an external server could publish** (516, HO-040 §4.3,
 * `HO-042` §2) — Claude's provider-side deny vocabulary, derived and never written down.
 *
 * ## ⛔ This is where the ruled security property actually rests
 *
 * `HO-042` §2: *"The property I ruled is none of our verb names reaches the model, and your rail
 * guarantees it."* ⚠️ **The registration preflight and Claude's own handshake are two independent
 * asks** — `507` §4.2 says so in as many words — so a server that changes its roster between them
 * would offer Claude a name the preflight never saw. ⛔ **This set does not depend on asking the
 * server anything.** The pinned SDK says a `disallowedTools` name *"is removed from the model's
 * context and cannot be used even if otherwise allowed"*, and it also *"blocks harness-internal
 * direct calls that hold the tool object without a name lookup"* — so the leaf is gone whatever the
 * server answers.
 *
 * ⚑ **`qualifyWith(CLAUDE_TOOL_NAMING, …)` and not a template literal**, because only this package
 * knows how each provider spells `<server>__<tool>` and `tool-inventory.ts` is where that was
 * MEASURED (`mcp__brobot__spawn_agent`, 5 of 5, off a real `system/init`). A second spelling here
 * would be `169` §1's two statements of one rule, with the copy further from the measurement.
 *
 * ⛔ **It blocks a NAME and does not refuse a server.** Refusing the whole server is the
 * registration door's act; this is the race backstop the PO accepted in place of a proxy, and it
 * filters the forbidden leaf rather than detecting that the remote roster moved. ⚠️ Saying which of
 * the two this is is the difference between a guarantee and a hope.
 *
 * ⚑ **Empty when nothing was granted**, so a launch with no registry grant carries no
 * `disallowedTools` it did not carry before this build.
 */
export function forbiddenExternalSpellings(reach: ExternalMcpReach | undefined): readonly string[] {
  if (reach === undefined) return []
  return reach.servers.flatMap((server) =>
    reach.reservedToolNames.map((leaf) => qualifyWith(CLAUDE_TOOL_NAMING, server.name, leaf)),
  )
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
