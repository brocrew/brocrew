import { managedPluginHttpServers, type ManagedPluginMcpServer } from '../managed-plugin-mcp'
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { createAgentMcpServer } from '../agent-mcp-server'
import type { AgentToolset } from '../agent-tools'
import type { ExternalMcpReach } from '../external-mcp'
import { CLAUDE_TOOL_NAMING } from './tool-naming'
import { qualifyWith } from '../tool-inventory'

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
  managed: readonly ManagedPluginMcpServer[] = [],
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
  // Managed BroCrew routes are explicit too; provider-owned plugin discovery stays excluded.
  const pluginServers = managedPluginHttpServers(managed)
  if (ownServer === null && external.length === 0 && managed.length === 0) return undefined
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
  for (const [name, config] of Object.entries(pluginServers)) {
    if ([...taken].some((existing) => existing.toLowerCase() === name.toLowerCase()))
      throw new Error('Plugin unavailable. Try again.')
    servers[name] = config
  }
  if (ownServer === null) return servers
  return {
    ...servers,
    [ownServer]: createAgentMcpServer(toolset!),
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
