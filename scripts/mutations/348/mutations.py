"""348 · Codex parity for the door — each row is THE DEFECT, put back verbatim (131).

⛔ **The brief this table arrives under said Codex needed a stdio child, the wire door `341` §4
reserved, and a `config.toml` merge that could carry a composite value.** It needs none of them:
`ThreadStartParams.dynamicTools` is a door on the connection the adapter already holds. So these
rows are about a TRANSLATION and a GATE, and not one of them is about a rail — `341`'s table owns
all twelve and `347`'s owns the tool layer.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M6`, `M10`-`M17` | ⚑ **`run_suite`** — `packages/runtime/test/codex-agent-tools.test.ts` |
| `M7`-`M9`, `M18`-`M24` | ⚑ **`run_suite`** — `packages/runtime/test/codex-runtime.test.ts` |
| `M25`-`M27` | ⚑ **`run_suite`** — `packages/runtime/test/codex-normalize.test.ts` |
| `M28`-`M31` | ⚑ **`run_suite`** — `apps/desktop/test/disclosure-answers-to-the-code.test.ts` |
| `M32` | ⚑ **`run_suite`** — `packages/runtime/test/claude-agent-tools.test.ts` |
| `M33`, `M34` | ⚑ **`run_suite`** — `apps/desktop/test/the-five-tools.test.ts`, which reads the two rigs' source |

## ⛔ What this table deliberately does NOT contain

⛔ **No row on a rail, on `mayCommand`, or on the five tools' own logic.** `341` and `347` own those.
The Codex adapter reaches the SAME `AgentToolset` object the Claude adapter does — that is `348`'s
whole claim — so a second copy of `347`'s rows here would be a second copy of the rule.

⛔ **No row that makes `thread/resume` send `dynamicTools`.** There is no field to send them in, and
the app-server ignores unknown params silently (measured: `{brobotNotAField: "nonsense"}` is
accepted where `{dynamicTools: "nonsense"}` is `-32600`) — so the mutation would change what goes on
the wire and nothing else, which records as a survivor while breaking nothing. `M9` is the row that
carries the same rule where it bites: the resumed HANDLE dropping the toolset it must answer with.

⛔ **No row inside `answerCodexToolCall`'s `catch`.** Its contract says a handler must not throw and
the `catch` exists because *"must not"* is not *"cannot"* — `347` retired the same row for the same
reason on the Claude side. `M14` mutates what the catch ANSWERS with, which the suite can reach.

## ⚠️ The two rows that are about instruments rather than product

`M33` and `M34` mutate the two live rigs THEMSELVES, and `the-five-tools.test.ts` is what catches
them. Neither rig runs in `ci` — one needs a login, one spawns the bundled binary — so *"a guard only
a live run can trip is dark by default"* (`310`), and the shape that makes each a measurement is
pinned from a cheap gate.

⚠️ **Both rows were first written against the CENSUS and both survived**, which is the finding worth
keeping: a mutation that weakens an assertion is invisible to the assertion it weakens. The thing a
census can catch is the INSTRUMENT drifting, so that is what these rows do.
"""

CODEX_TOOLS = "packages/runtime/src/codex/agent-tools.ts"
CODEX_ADAPTER = "packages/runtime/src/codex/codex-runtime.ts"
NORMALIZE = "packages/runtime/src/codex/normalize.ts"
CLAUDE_TOOLS = "packages/runtime/src/claude/agent-tools.ts"
CFG = "apps/desktop/src/main/runtime/provider-config.ts"
FIVE = "apps/desktop/test/the-five-tools.test.ts"
CODEX_RIG = "apps/desktop/smoke/a-codex-agent-spawns-an-agent.smoke.ts"
PROBE = "packages/runtime/smoke/codex-dynamic-tools-probe.smoke.ts"
INDEX = "apps/desktop/src/main/index.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the tools stop being declared the way the provider reads them ─────────────────────
    (
        "M1 · ⛔ an EMPTY toolset becomes an empty namespace instead of no declaration · a "
        "catalogue that promises tools and lists none is acceptance #7's *nothing unwired implies a "
        "working state*, written as a tool declaration",
        [
            (
                CODEX_TOOLS,
                "  if (toolset === undefined || toolset.tools.length === 0) return undefined",
                "  if (toolset === undefined) return undefined",
            )
        ],
    ),
    (
        "M2 · 🔴 the namespace is named a constant instead of the toolset's server · the model reads "
        "`<namespace>__<tool>`, so the server's name IS part of every tool name it sees",
        [
            (
                CODEX_TOOLS,
                "      type: 'namespace',\n      name: toolset.server,",
                "      type: 'namespace',\n      name: 'tools',",
            )
        ],
    ),
    (
        "M3 · ⚠️ the toolset's instructions are dropped · Claude hands them to the MCP server; this "
        "is the only place Codex takes them, and they are the sentence that tells a model a refusal "
        "is an answer rather than a broken tool",
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — D-039 (17a9220d) deliberately stopped using the toolset's instructions as the
        # Codex namespace description (1,100 chars exceeded the 1,024 limit), so the old plant is
        # the design now. The rule (a Codex model must still be told how to use the tools) survives
        # in the composition root: `thisConversationSpans(context, toolsToldInTextFor(provider))` in
        # main/index.ts feeds the "## The brobot tools" section of the first-turn lead. The only
        # test that pins it today is the source census in
        # a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts (section 6), which
        # requires that exact call; dropping the tools argument turns it red. Killed by
        # `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts`.
        [
            # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The saved-methods reading rides a context of its own at this call; original defect, ID and killer retained.
            (INDEX, 'thisConversation: thisConversationSpans(launchContext, toolsToldInTextFor(provider)),', 'thisConversation: thisConversationSpans(launchContext),'),
        ],
    ),
    (
        "M4 · ⛔ the tools are declared FLAT instead of under a namespace · measured: a flat spec is "
        "dropped into the same list as Codex's own built-ins with no prefix at all, so `end_agent` "
        "sits beside `update_goal` and the day Codex ships one of these names the collision is silent",
        [
            (
                CODEX_TOOLS,
                "  return [\n    {\n      type: 'namespace',",
                "  return toolset.tools.map((one) => ({\n    type: 'function' as const,\n"
                "    name: one.name,\n    description: one.description,\n"
                "    inputSchema: inputSchemaOf(one),\n  })) as DynamicToolSpec[]\n"
                "  return [\n    {\n      type: 'namespace',",
            )
        ],
    ),
    (
        "M5 · 🔴 the argument schema is STRICT, so the provider is told an undocumented key is "
        "forbidden · `303` B: eight keys arrive, seven parse, and the agent never starts, *looking "
        "exactly like a slow provider*. `341`'s rail 1 refuses that key BY NAME and can only do it "
        "if the key reaches the door",
        [
            (
                CODEX_TOOLS,
                "  return z.toJSONSchema(z.looseObject(tool.input)) as JsonValue",
                "  return z.toJSONSchema(z.object(tool.input)) as JsonValue",
            )
        ],
    ),
    (
        "M6 · ⚠️ every tool is declared with the SAME name · the five become one, and four acts "
        "become unreachable while the declaration still looks full",
        [
            (
                CODEX_TOOLS,
                "        name: one.name,\n        description: one.description,",
                "        name: 'spawn_agent',\n        description: one.description,",
            )
        ],
    ),
    # ── §2 · the declaration stops reaching the wire ───────────────────────────────────────────
    (
        "M7 · ⛔ `thread/start` stops carrying the tools · the child's inventory is empty and every "
        "call it might have made never happens — which looks exactly like a model that chose not to",
        [
            (
                CODEX_ADAPTER,
                "  if (dynamicTools) params.dynamicTools = dynamicTools",
                "  void dynamicTools",
            )
        ],
    ),
    (
        "M8 · ⚠️ the START path stops passing the session's toolset · the field is still wired and "
        "still empty, which is the failure one layer up from `M7`",
        [
            (
                CODEX_ADAPTER,
                "              codexDynamicToolsFor(this.agentTools),",
                "              codexDynamicToolsFor(undefined),",
            )
        ],
    ),
    (
        "M9 · 🔴 a RESUME drops the toolset · `307`: *forgetting it on a resume is how a spawned "
        "agent silently loses its tools*. The app-server still rebuilds the child's inventory from "
        "its own `thread_dynamic_tools` table, so the child sees five tools nothing on this side can "
        "answer — the quietest shape this failure has",
        [
            (
                # ⚠️ **ANCHOR CORRECTED at `605`, and the SUBJECT is untouched** — the row still
                # drops the toolset on the resume path. ⛔ `605` added a second argument after
                # `options.agentTools` on that call (the granted external MCP servers), so the
                # two-line anchor stopped matching. ⚑ A moved anchor is a repair, never a
                # retirement (`correct-a-stale-mutation-anchor-dont-retire-it`) — and the row was
                # re-verified RED by hand after the correction, because
                # `a-corrected-anchor-keeps-a-verdict-it-never-earned`.
                CODEX_ADAPTER,
                "      options.agentTools,",
                "      undefined,",
            )
        ],
    ),
    # ── §3 · the answer stops meaning what it means ────────────────────────────────────────────
    # Re-anchored, NOT VERIFIED; no mutant or killer was run.
    (
        "M10 · 🔴 a RAIL's refusal is answered `success: false` · `307` measured both shapes on both "
        "providers: `success` is this provider's `isError`, and a rule that arrives wearing it is "
        "read as a broken tool rather than as policy",
        [('packages/runtime/src/codex/agent-tools.ts', "  return { contentItems: [{ type: 'inputText', text: answer.text }], success: true }", "  return { contentItems: [{ type: 'inputText', text: answer.text }], success: false }")],
    ),
    # RETIRED: the former JSON/order/echo contract was removed.
    (
        "M11 · ⛔ the structured payload is dropped · the rail, its permanence and its retryability "
        "stop being fields and become prose the model has to parse — and this provider has no "
        "`structuredContent`, so the text is the only place they can ride",
        [
            (
                CODEX_TOOLS,
                "      ...(answer.text ? [{ type: 'inputText' as const, text: answer.text }] : []),\n      ...(answer.structured === undefined\n        ? []\n        : [{ type: 'inputText' as const, text: JSON.stringify(answer.structured) }]),",
                "      ...(answer.text ? [{ type: 'inputText' as const, text: answer.text }] : []),",
            )
        ],
    ),
    # Re-anchored, NOT VERIFIED; no mutant or killer was run.
    (
        "M12 · 🔴 the arguments are REBUILT from the declared keys before the tool sees them · the "
        "strip `303` B measured, moved into the transport this dispatch added",
        [('packages/runtime/src/codex/agent-tools.ts', '    const answer = await tool.call(call.arguments)', '    const declared = Object.fromEntries(\n      Object.keys(tool.input).map((key) => [key, call.arguments[key]]),\n    )\n    const answer = await tool.call(declared)')],
    ),
    (
        "M13 · ⛔ a call addressed to somebody else's namespace is answered by ours · the namespace "
        "is the address the model was given, and answering under another one is answering for a "
        "server we did not declare",
        [
            (
                CODEX_TOOLS,
                "  if (call.namespace !== null && call.namespace !== toolset.server) {",
                "  if (false) {",
            )
        ],
    ),
    (
        "M14 · ⚠️ a handler that threw is reported as a successful call · the one shape that really "
        "IS a broken tool stops saying so, and every refusal in the vocabulary loses its meaning "
        "with it",
        [
            (
                CODEX_TOOLS,
                "    return failed(`${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`)",
                "    return succeeded({ text: `${tool.name} failed: ${String(error)}` })",
            )
        ],
    ),
    (
        "M15 · ⛔ arguments that are not an object are coerced to `{}` and the tool runs · a tool "
        "asked with nothing is not a tool asked with an empty request, and the door would be handed "
        "a request the model never made",
        [
            (
                CODEX_TOOLS,
                "  if (!isPlainObject(call.arguments)) {\n    return failed(`${call.tool} was called with arguments that are not an object`)\n  }",
                "  if (!isPlainObject(call.arguments)) {\n    return succeeded(await tool.call({}))\n  }",
            )
        ],
    ),
    (
        "M16 · ⚠️ a name this session does not offer is answered as though it ran · the model is "
        "told a tool it invented worked",
        [
            (
                CODEX_TOOLS,
                "  if (tool === undefined) return failed(`${call.tool} is not a tool this session offers`)",
                "  if (tool === undefined) return succeeded({ text: 'ok' })",
            )
        ],
    ),
    (
        "M17 · ⛔ a session with NO toolset answers a call differently from one with a wrong name · "
        "two sentences for *never existed* and *not offered here* let a caller learn which sessions "
        "carry tools from the shape of the answer — `341`'s entitlement-before-existence, one door over",
        [
            (
                CODEX_TOOLS,
                "  if (toolset === undefined) return failed(`${call.tool} is not a tool this session offers`)",
                "  if (toolset === undefined) return failed('this session declared no tools at all')",
            )
        ],
    ),
    # ── §4 · the gate ─────────────────────────────────────────────────────────────────────────
    # Re-anchored, NOT VERIFIED and HELD; its test reaches a held path.
    (
        "M18 · 🔴 the tool runs with NO card in `ask` · a Codex agent spawns agents unprompted while "
        "the same agent on Claude has to be allowed. `347`: *spawning an agent is not a thing this "
        "app decided to stop asking about*",
        [('packages/runtime/src/codex/codex-runtime.ts', '    if (isAutoApprove({ approvalMode: this.approvals.effective })) {\n      this.respondToProvider(id, await answerCodexToolCall(this.agentTools, call, completed))\n      return\n    }', '    {\n      this.respondToProvider(id, await answerCodexToolCall(this.agentTools, call, completed))\n      return\n    }')],
    ),
    (
        "M19 · ⚠️ a card is published in `auto` too · a session promised it would never be asked is "
        "asked, and there is nobody watching an unattended one to answer it",
        [
            (
                CODEX_ADAPTER,
                "    if (isAutoApprove({ approvalMode: this.approvals.effective })) {\n      this.respondToProvider",
                "    if (false) {\n      this.respondToProvider",
            )
        ],
    ),
    (
        "M20 · ⛔ a session-wide grant is offered for these tools · `001` non-negotiable 1: a tool "
        "pre-approved before anybody looks at its arguments. The Claude side's allow is one-shot for "
        "exactly this reason",
        [
            (
                CODEX_ADAPTER,
                "      claimed.allowed = new Set<PermissionOutcome>(['allow', 'deny'])",
                "      claimed.allowed = new Set<PermissionOutcome>(['allow', 'deny', 'allow_for_session'])",
            )
        ],
    ),
    (
        "M21 · 🔴 a person's Deny still runs the tool · the card becomes decoration, which is worse "
        "than no card at all: it says the answer mattered",
        [
            (
                CODEX_ADAPTER,
                "    if (decision.outcome !== 'allow') {",
                "    if (false) {",
            )
        ],
    ),
    (
        "M22 · ⛔ a person's Deny is answered in a RAIL's shape · *a rule said no* and *a person said "
        "no* arrive identically, and the model cannot tell which it met",
        [
            (
                CODEX_ADAPTER,
                "            text: `the person using this app declined the ${call.tool} call, so nothing was done`,\n          },\n        ],\n        success: false,",
                "            text: `the person using this app declined the ${call.tool} call, so nothing was done`,\n          },\n        ],\n        success: true,",
            )
        ],
    ),
    (
        "M23 · 🔴 `respondPermission` writes the APPROVAL payload for a tool call · the provider "
        "asked for a tool result and is handed `{decision:'accept'}`, and the tool never runs. The "
        "one place `067`'s atomic spend-and-write cannot be right",
        [
            (
                CODEX_ADAPTER,
                "    if (state.kind.kind === 'agentTool') {\n      this.permissions.respond(id, decision)\n      return\n    }",
                "    if (false) {\n      this.permissions.respond(id, decision)\n      return\n    }",
            )
        ],
    ),
    (
        "M24 · ⚠️ an out-of-scope tool call is refused as a SUCCESS · a foreign thread's call is "
        "answered *this worked*, and `061`'s scope gate stops being visible in the answer",
        [
            (
                CODEX_ADAPTER,
                "      contentItems: [{ type: 'inputText', text: 'this session cannot take tool calls right now' }],\n      success: false,",
                "      contentItems: [{ type: 'inputText', text: 'this session cannot take tool calls right now' }],\n      success: true,",
            )
        ],
    ),
    # ── §5 · the transcript ───────────────────────────────────────────────────────────────────
    (
        "M25 · 🔴 a dynamic tool call is flattened to the word `tool` · `327`'s defect on the item "
        "type this dispatch introduced: five different acts, five identical rows",
        [
            (
                NORMALIZE,
                "  if (type === 'dynamicToolCall') {\n    const tool = readString(item, 'tool')",
                "  if (false) {\n    const tool = readString(item, 'tool')",
            )
        ],
    ),
    (
        "M26 · ⛔ the row is prefixed `mcp__` · a claim about WHERE the call went. Codex does not "
        "call this MCP, and `327` §2.4's rule is each provider's OWN qualified name",
        [
            (
                NORMALIZE,
                "      return truncate(namespace ? `${namespace}__${tool}` : tool)",
                "      return truncate(namespace ? `mcp__${namespace}__${tool}` : tool)",
            )
        ],
    ),
    (
        "M27 · ⚠️ a malformed item assembles a name out of half of one · `tool` is non-null in the "
        "generated `ThreadItem`, so this is a broken item — and the honest answer is the word it "
        "always had, never `undefined__something`",
        [
            (
                NORMALIZE,
                "    const tool = readString(item, 'tool')\n    if (tool) {\n      const namespace = readString(item, 'namespace')",
                "    const tool = readString(item, 'tool')\n    {\n      const namespace = readString(item, 'namespace')",
            )
        ],
    ),
    # ── §6 · the disclosure ───────────────────────────────────────────────────────────────────
    (
        "M28 · ⛔ the Codex block stops claiming anything about `thread/start` · a user looking for "
        "this session's five tools goes to `config.toml` and finds nothing there",
        [
            (
                # Provider facts live in the shared registry; this row plants the same fault there.
                "packages/shared/src/providers/configuration.ts",
                "export const CODEX_THREAD_START_CLAIMS: readonly SdkOptionClaim[] = [\n  {\n    option: 'dynamicTools',",
                "export const CODEX_THREAD_START_CLAIMS: readonly SdkOptionClaim[] = []\nconst UNUSED_348: readonly SdkOptionClaim[] = [\n  {\n    option: 'dynamicTools',",
            )
        ],
    ),
    (
        "M29 · ⚠️ the block claims a field the adapter never sets · `308`'s original defect, in the "
        "other provider's block",
        # Provider facts live in the shared registry; this row plants the same fault there.
        [("packages/shared/src/providers/configuration.ts", "    option: 'dynamicTools',", "    option: 'mcpServers',")],
    ),
    (
        "M30 · 🔴 the sentence stops naming what rides on the wire · the table still says it and the "
        "one line a person reads no longer does",
        [
            (
                # Provider facts live in the shared registry; this row plants the same fault there.
                "packages/shared/src/providers/configuration.ts",
                # ⚠️ **ANCHOR CORRECTED at `605`, SUBJECT untouched** — the row still deletes the
                # whole wire clause. ⛔ `605` added a second claim to the table and SPLIT the
                # trailing sentence, because the app-server remembers `dynamicTools` and does not
                # remember a `config` overlay; one clause could not be true of both.
                # ⚑ Re-verified RED by hand after the correction.
                # ⚑ **provider-followups-1 · re-anchored in place, not retired** — provider follow-ups 1 adds the planning switch to the clause; the mutation is the same, the clause is gone
                "  `touched — and ${humanList(CODEX_THREAD_START_CLAIMS.map((claim) => claim.label))} are not in ` +\n  'that file at all: they are declared on the wire when the conversation starts. The tools the ' +\n  'app-server remembers, so a resumed conversation comes back with the same ones; the servers and ' +\n  'the planning switch it does not, so BroCrew sends them again every time it reopens the conversation'",
                "  ''",
            )
        ],
    ),
    (
        "M31 · ⛔ the block says the tools ARE in `config.toml` · exactly the promise `348`'s brief "
        "warned about, made by a dispatch that writes nothing into that file",
        [
            (
                # Provider facts live in the shared registry; this row plants the same fault there.
                "packages/shared/src/providers/configuration.ts",
                # ⚠️ **ANCHOR CORRECTED at `605`, SUBJECT untouched** — the row still makes the
                # sentence claim the wire payloads live in `config.toml`, which is the promise
                # `348`'s brief warned about. ⚑ Re-verified RED by hand.
                "'that file at all: they are declared on the wire when the conversation starts. The tools the '",
                "'that file at all: they are declared in that file. The tools the '",
            )
        ],
    ),
    # ── §7 · the Claude half of the same rule ─────────────────────────────────────────────────
    (
        "M32 · 🔴 the Claude schema goes back to stripping · the defect `347` shipped: the MCP SDK "
        "parses with `z.object(shape)` before the handler is called, so `341`'s rail 1 could never "
        "fire for the one cause it exists for",
        [
            (
                CLAUDE_TOOLS,
                # ⚑ **619 · re-anchored in place, not retired** — NOT VERIFIED. The ordinary MCP schema is now beside a reply-only opt-in catch. The same stripping defect affects the ordinary spawn schema checked by the existing killer; the reply catch is preserved.
                "  const loose = missingAtHandler ? agentToolHandlerObject(shape) : z.looseObject(shape)",
                "  const loose = missingAtHandler ? agentToolHandlerObject(shape) : z.object(shape)",
            )
        ],
    ),
    # ── §8 · the instruments, pinned where a cheap gate can see them ──────────────────────────
    (
        "M33 · ⛔ the live Codex rig accepts any row CONTAINING the tool name · `toolItemName` mapped "
        "this item type to the constant `tool`, so `includes` goes green on a row that never named "
        "the server. ⚑ **The row mutates the RIG, not the census that reads it** — a mutation that "
        "merely weakens a census passes the census, and would have recorded as a survivor",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The live Codex
        # rig survives and now drives `give_work` (its header says "the verb is give_work"); the
        # line to weaken is the exact-equality expectation on `brobot__give_work`. The row mutates
        # the RIG, and the-five-tools reads the rig's source and demands that exact line. Killed by
        # `the-five-tools.test.ts`.
        [
            (CODEX_RIG, "      expect(parentToolCalls().some((name) => name === 'brobot__give_work')).toBe(true)", "      expect(parentToolCalls().some((name) => name.includes('give_work'))).toBe(true)"),
        ],
    ),
    (
        "M34 · 🔴 the capture probe's CONTROL arm stops being able to fail · `thread/start` ignores "
        "unknown params silently, so an arm that finds five names proves nothing without the arm "
        "that sent none and found none. ⚑ Same shape as `M33`: the INSTRUMENT is mutated, and the "
        "cheap gate that reads it is what says no",
        [
            (
                PROBE,
                "  expect(namesIn(control.bodies[0]), 'C · no dynamicTools sent, so no name may appear').toEqual([])",
                "  expect(namesIn(control.bodies[0]).length).toBeLessThan(6)",
            )
        ],
    ),
]
