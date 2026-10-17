"""723 · When Codex asks, a person sees it — PM rulings R80, R81 and R83 (`720` F-A, F-B, F-F).

## 🔴 A · R80 — which frame is Codex's approval (M1-M7)

⚑ *"Codex's own approval (`mcpServer/elicitation/request` with `_meta.codex_approval_kind:
'mcp_tool_call'`) becomes a card naming the server, the tool and the parameters (`tool_params_display`),
with Allow once, Allow for this conversation (when Codex offers `session`) and Deny. ⛔ Never *always*
… ⛔ It is never declined silently again; `142` §2's silent decline stays for a zero-field form that is
NOT this kind."*

## 🔴 B · the marker is a server's to copy — measured, and tied to Codex's own item (M8-M16)

⚑ `probe:codex-mcp-tool-approval`'s `spoof` arm: a server's own form wearing Codex's marker reached this
app byte for byte. ⚑ Codex asks once per call, before it runs, after its own `item/started`; so a frame
is Codex's only for a running call it has not yet asked about, and not granted (`McpCallsInFlight`).

## 🔴 C · what the card draws (M17-M28) · D · the offer and the answer (M29-M36)

## 🔴 E · R81 — a card whose press cannot stop the turn says so, and records no ask (M37-M47)

## 🔴 F · R83 — a Stop the provider does not answer is said, and a second press asks nothing (M48-M57)

## ⚑ Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M38` | ⚑ **`run_suite`** — `packages/runtime/test/codex-runtime.test.ts` |
| `M1`, `M2`, `M14`, `M15`, `M28`, `M30`, `M31`, `M34`, `M35`, `M37`-`M47` | ⚑ **`run_suite`** — `a-press-that-stops-nothing-says-so.test.ts` |
| `M48`-`M57` | ⚑ **`run_suite`** — `a-stop-codex-does-not-answer-is-said.test.ts` |

## ⛔ What this table deliberately does NOT contain

⛔ **No row on the live probe** — `probe:codex-mcp-tool-approval` (loopback, $0) is not in `ci`; its runs
are in `723`'s response. ⛔ **No row on `isCurrentLife` in the unanswered-stop check**: no test can put a
finalized life between an ask and its bound without a double of the host's own lifecycle (the review
tried: a close delivers the turn's own forced ending first). ⛔ **No row on `interrupt_agent`'s say-line**:
the scripted rig drives no agent caller through the interrupt rails, so a row there would survive
unmeasured — the same line at interrupt-and-send has M56. ⛔ **No row on the app's own ask being left
unsaid, nor on `cancelsThatStopNothing`'s two let-go lines**: Codex never reuses a request id in one
connection, so neither is observable. ⛔ **No row on the renderer's no-op for `stop_unanswered`** — the
drawing is the frontend's, after `723` lands (⚑ drawn by `730`, whose table carries its rows).
"""

CODEX = "packages/runtime/src/codex/codex-runtime.ts"
EMCP = "packages/runtime/src/codex/external-mcp.ts"
EVENTS = "packages/runtime/src/events.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
HOWSTOP = "apps/desktop/src/shared/how-work-stopped.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
DESCRIBE = "apps/desktop/src/renderer/src/lib/describe-event.ts"

RT = "codex-runtime.test.ts"
PRESS = "a-press-that-stops-nothing-says-so.test.ts"
STOP = "a-stop-codex-does-not-answer-is-said.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        # ⚑ **728 · relabelled in place, not retired** — R93 removed the silent decline the old label
        # named; the same mutation now draws Codex's own approval as the SERVER's card.
        f"M1 · 🔴 **Codex's own approval is drawn as the server's own request** · no frame is read as one, so Codex's ask gets the server's card — Allow, no call named, no grant (`720` F-A's frame, since `728` shown rather than declined) — killed by `{RT}` and `{PRESS}`",
        [
            (CODEX, "    const read = theFramesTurn === '' ? null : codexToolApproval(params)\n", "    const read = null\n"),
        ],
    ),
    (
        f"M2 · 🔴 **the zero-field rule reaches Codex's approval again** · read and claimed, then declined before its card — killed by `{RT}` and `{PRESS}`",
        [
            (CODEX, "    if (toolApproval === null && elicitation.mode === 'form' && elicitation.fields.length === 0) {\n", "    if (elicitation.mode === 'form' && elicitation.fields.length === 0) {\n"),
        ],
    ),
    (
        f"M3 · ⛔ **every zero-field form is a question somebody asked** · R80's control: a server's own empty form reaches a person as a question with nothing on it — killed by `{RT}`",
        [
            # ⚑ **728 · re-anchored in place, not retired** — 728 (R93) turned the zero-field rule from a silent decline into the server's own card; the row still makes a server's empty form a question with nothing on it
            (CODEX, "    const confirmsAServersForm =\n      toolApproval === null && elicitation.mode === 'form' && elicitation.fields.length === 0\n", "    const confirmsAServersForm = false as boolean\n"),
        ],
    ),
    (
        f"M4 · ⛔ **another approval kind is read as a tool call** — killed by `{RT}`",
        [
            (EMCP, "  if (!isRecord(meta) || meta['codex_approval_kind'] !== CODEX_TOOL_APPROVAL_KIND) return null\n", "  if (!isRecord(meta)) return null\n"),
        ],
    ),
    (
        f"M5 · ⚠️ **a marked frame that ASKS something is read as the approval** · Allow sends an empty answer to its fields — killed by `{RT}`",
        [
            (EMCP, "  if (Object.keys(properties).length > 0) return null\n", ""),
        ],
    ),
    (
        f"M6 · ⛔ **a `url` frame wearing the marker is read as an approval** · Allow sends `accept` for a visit nobody made — killed by `{RT}`",
        [
            (EMCP, "  if (serverName === '' || readString(params, 'mode') !== 'form') return null\n", "  if (serverName === '') return null\n"),
        ],
    ),
    (
        f"M7 · 🔴 **a frame that names NO turn is read as an approval** · an Allow under a turn the provider never confirmed (`060`) — killed by `{RT}`",
        [
            (CODEX, "    const read = theFramesTurn === '' ? null : codexToolApproval(params)\n", "    const read = codexToolApproval(params)\n"),
        ],
    ),
    (
        f"M8 · 🔴 **a call Codex already asked about is claimed again** · a server's form wearing the marker becomes a Codex card (the `spoof` arm, measured) — killed by `{RT}`",
        [
            (EMCP, "        !call.asked &&\n", ""),
        ],
    ),
    (
        f"M9 · 🔴 **a tool granted for the conversation is claimed** · Codex does not ask about it again, so the frame is the server's — killed by `{RT}`",
        [
            (EMCP, "        !this.isGranted(call.server, call.tool),\n", "        true,\n"),
        ],
    ),
    (
        f"M10 · 🔴 **a question naming a tool no call is running is tied to one that is** · a card for `delete_everything` — killed by `{RT}`",
        [
            (EMCP, "        (tool === null || call.tool === tool) &&\n", ""),
        ],
    ),
    (
        f"M11 · ⚠️ **a finished call still vouches for a frame** — killed by `{RT}`",
        [
            (EMCP, "      this.running.delete(id)\n", ""),
        ],
    ),
    (
        f"M12 · ⚠️ **a question in other words is tied to one of SEVERAL waiting calls** — killed by `{RT}`",
        [
            (EMCP, "    const call = tool === null && unasked.length !== 1 ? undefined : unasked[0]\n", "    const call = unasked[0]\n"),
        ],
    ),
    (
        f"M13 · 🔴 **the claim is never marked** · every later frame wearing the marker is Codex's too — killed by `{RT}`",
        [
            (EMCP, "    call.asked = true\n", ""),
        ],
    ),
    (
        # ⚑ **728 · relabelled in place, not retired** — R93 removed the silent decline the old label
        # named; with the ledger unfed every approval is now drawn as the SERVER's card.
        f"M14 · 🔴 **the ledger of running calls is never fed** · every Codex approval is drawn as the server's own request, naming no call — killed by `{RT}` and `{PRESS}`",
        [
            (CODEX, "    this.mcpCalls.note(method, params)\n", ""),
        ],
    ),
    (
        f"M15 · 🔴 **a conversation's grant is not kept** · the header never shows it, and a frame for that tool is Codex's again — killed by `{RT}` and `{PRESS}`",
        [
            # ⚑ **736 · corrected in place, not retired** — R95's *Always allow* records the same
            # grant, so the call is written twice; the row still drops the CONVERSATION grant's.
            (CODEX, "decision.outcome === A_TOOLS_SESSION_GRANT) {\n      this.mcpCalls.grant(state.approvesATool.serverName, state.approvesATool.tool)\n", "decision.outcome === A_TOOLS_SESSION_GRANT) {\n"),
        ],
    ),
    (
        f"M16 · ⚠️ **`blanketGrants` is empty again** · the grant is made and then invisible — killed by `{RT}`",
        [
            (CODEX, "    return this.mcpCalls.grants\n", "    return []\n"),
        ],
    ),
    (
        f"M17 · ⚠️ **Codex's display names are ignored** — killed by `{RT}`",
        [
            (EMCP, "    const shown = readString(entry, 'display_name') || readString(entry, 'name')\n", "    const shown = readString(entry, 'name')\n"),
        ],
    ),
    (
        f"M18 · 🔴 **a parameter's VALUE reaches the card uncleaned** · bytes a model wrote reorder the text a person reads — killed by `{RT}`",
        [
            (EMCP, "    const value = said === '' ? '' : wordsForACard(said)\n", "    const value = said\n"),
        ],
    ),
    (
        f"M19 · 🔴 **a parameter's NAME reaches the card uncleaned** — killed by `{RT}`",
        [
            (EMCP, "    const name = shown === '' ? '' : wordsForACard(shown)\n", "    const name = shown\n"),
        ],
    ),
    (
        f"M20 · 🔴 **the TOOL reaches the card uncleaned** · a name the server chose — killed by `{RT}`",
        [
            (CODEX, "  const tool = wordsForACard(approval.tool) ?? ''\n", "  const tool = approval.tool\n"),
        ],
    ),
    (
        f"M21 · ⚠️ **Codex's question reaches the card uncleaned** · it carries the server's tool name — killed by `{RT}`",
        [
            (CODEX, "  const summary = wordsForACard(approval.question)\n", "  const summary = approval.question\n"),
        ],
    ),
    (
        f"M22 · 🔴 **a parameter too long to show is drawn EMPTY** · a 70 KB `content` reads as an empty write, and nothing counts it (review) — killed by `{RT}`",
        [
            (EMCP, "    if (name === null || value === null) return { kept, omitted: entries.length - at }\n", "    if (name === null || value === null) {\n      kept.push({ name: name ?? '', value: value ?? '' })\n      continue\n    }\n"),
        ],
    ),
    (
        f"M23 · ⚠️ **the display list is never cut** — killed by `{RT}`",
        [
            (EMCP, "    if (used > MAX_PERMISSION_DETAIL_CHARS) return { kept, omitted: entries.length - at }\n", ""),
        ],
    ),
    (
        f"M24 · ⚠️ **a cut list does not say it was cut** — killed by `{RT}`",
        [
            (CODEX, "      ...(approval.parametersOmitted > 0 ? { parametersOmitted: approval.parametersOmitted } : {}),\n", ""),
        ],
    ),
    (
        f"M25 · 🔴 **the disclosure drops the parameters** · Allow authorizes a call the card does not show whole (`071`) — killed by `{RT}`",
        [
            (EMCP, "  return `${approval.tool} ${parameters}`\n", "  return approval.tool\n"),
        ],
    ),
    (
        f"M26 · ⚠️ **the card claims it discloses the call's whole effect** — killed by `{RT}`",
        [
            (CODEX, "      availableDecisions: offer,\n      underDisclosed: true,\n      approvalMode,\n", "      availableDecisions: offer,\n      underDisclosed: false,\n      approvalMode,\n"),
        ],
    ),
    (
        f"M27 · ⚠️ **Codex's own question is not on the card** — killed by `{RT}`",
        [
            (CODEX, "    ...(summary === null ? {} : { summary }),\n", ""),
        ],
    ),
    (
        f"M28 · 🔴 **the card does not name the server, the tool or the parameters** · R80's own words — killed by `{RT}` and `{PRESS}`",
        [
            (CODEX, "    mcpToolCall: {\n      server: approval.serverName,\n      tool,\n      parameters: [...approval.parameters],\n      ...(approval.parametersOmitted > 0 ? { parametersOmitted: approval.parametersOmitted } : {}),\n    },\n    scope: {\n", "    scope: {\n"),
        ],
    ),
    (
        f"M29 · 🔴 **Codex offering only `always` gets the conversation's grant** — killed by `{RT}`",
        [
            (EMCP, "    offersSession: Array.isArray(persist) && persist.includes('session'),\n", "    offersSession: Array.isArray(persist) && persist.length > 0,\n"),
        ],
    ),
    (
        f"M30 · 🔴 **the conversation's grant is called the NARROW one** · `031`'s lie (measured: `session-2`, `session-3`) — killed by `{RT}` and `{PRESS}`",
        [
            (CODEX, "const A_TOOLS_SESSION_GRANT: PermissionOutcome = 'allow_all_for_session'\n", "const A_TOOLS_SESSION_GRANT: PermissionOutcome = 'allow_for_session'\n"),
        ],
    ),
    (
        f"M31 · 🔴 **the card offers no way to allow** · a card a person can only refuse — killed by `{RT}` and `{PRESS}`",
        [
            (CODEX, "  const offer = publishedOffer(aToolApprovalsPositives(approval))\n", "  const offer = publishedOffer([])\n"),
        ],
    ),
    (
        f"M32 · 🔴 **the gate refuses what the card offers** · Allow is drawn and refused — killed by `{RT}`",
        [
            # ⚑ **728 · re-anchored in place, not retired** — 728 (R93) gave a server's zero-field form its Allow in the same offer; the row still arms the gate with no positive while Codex's card draws Allow
            # ⚑ **W4.28 · re-anchored in place, not retired** — W4.28 added a shown link (I opened it) to the offer; the mutation is the same, the card offers nothing to allow
            (CODEX, "    const offer = publishedOffer(\n      toolApproval !== null\n        ? aToolApprovalsPositives(toolApproval)\n        : confirmsAServersForm || showsALink\n          ? ['allow']\n          : [],\n    )\n", "    const offer = publishedOffer([])\n"),
        ],
    ),
    (
        f"M33 · 🔴 **Allow runs nothing** · the press is taken and Codex is told `decline` — killed by `{RT}`",
        [
            # ⚑ **728 · re-anchored in place, not retired** — 728 (R93) lets a server's zero-field form's Allow through the same branch; the row still makes Allow run nothing
            (CODEX, "  if ((approval !== undefined || confirmsAServersForm) && decision.outcome === 'allow') {\n    return { action: 'accept', content: {}, _meta: null }\n  }\n", ""),
        ],
    ),
    (
        f"M34 · 🔴 **the conversation's grant goes back with no scope** · Codex asks again at the next call — killed by `{RT}` and `{PRESS}`",
        [
            (CODEX, "    return { action: 'accept', content: {}, _meta: { persist: 'session' } }\n", "    return { action: 'accept', content: {}, _meta: null }\n"),
        ],
    ),
    (
        f"M35 · ⛔ **the grant outlives the conversation** · `persist: 'always'`, which R80 forbids — killed by `{RT}` and `{PRESS}`",
        [
            (CODEX, "_meta: { persist: 'session' } }", "_meta: { persist: 'always' } }"),
        ],
    ),
    (
        f"M36 · 🔴 **the answer forgets it is Codex's approval** · Allow is taken, and Codex is told `decline` — killed by `{RT}`",
        [
            (CODEX, "      if (toolApproval !== null) claimed.approvesATool = toolApproval\n", ""),
        ],
    ),
    (
        f"M37 · 🔴 **no card is ever marked** · a Cancel that asks nothing reads, to a surface and the host, as a stop — killed by `{RT}` and `{PRESS}`",
        [
            # ⚑ **736 · corrected in place, not retired** — R97 marks EVERY elicitation card; the
            # row still marks none.
            (CODEX, "    const cancelStopsNothing = { cancelStopsNothing: true as const }\n", "    const cancelStopsNothing = {}\n"),
        ],
    ),
    # 🔴 **RETIRED BY RULING at `736`** — R97 (PM): *"Cancel does what the CLI's Cancel does … BroBot adds no stop of its own to a Cancel."* The elicitation Cancel's own stop (R74) and its latch are gone, so the code this row mutated is gone and what it planted is now the product. Measured: the Codex terminal's Esc on its own MCP approval lets the turn run on.
    (
        f"M38 · ⛔ **every card is marked** · a Cancel that DOES ask the turn to stop says it asks nothing — killed by `{RT}` and `{PRESS}`",
        [
            (CODEX, "    const cancelStopsNothing = theFramesTurn === '' ? { cancelStopsNothing: true as const } : {}\n", "    const cancelStopsNothing = { cancelStopsNothing: true as const }\n"),
        ],
    ),
    (
        f"M39 · 🔴 **main's wire strips the marker** · no window and no host ever sees it — killed by `{PRESS}`",
        [
            (EVENTS, "  cancelStopsNothing: z.literal(true).optional(),\n", ""),
        ],
    ),
    (
        f"M40 · 🔴 **main's wire strips the call** · the card reaches the window without its server, tool or parameters — killed by `{PRESS}`",
        [
            (EVENTS, "  mcpToolCall: z\n    .object({\n      server: z.string(),\n      tool: z.string(),\n      parameters: z.array(z.object({ name: z.string(), value: z.string() })),\n      parametersOmitted: z.number().int().positive().optional(),\n    })\n    .optional(),\n", ""),
        ],
    ),
    (
        f"M41 · 🔴 **the host forgets which cards stop nothing** · every Cancel is recorded as an ask again (`main`) — killed by `{PRESS}`",
        [
            (HOST, "    if (event.type === 'permission_request' && event.cancelStopsNothing === true) {\n      session.cancelsThatStopNothing.add(event.id)\n    }\n", ""),
        ],
    ),
    (
        f"M42 · ⚠️ **a DENY on a marked card is recorded as a cancel that stopped nothing** — killed by `{PRESS}`",
        [
            (HOST, "      decision.outcome === 'cancel' && session.cancelsThatStopNothing.has(requestId)\n", "      session.cancelsThatStopNothing.has(requestId)\n"),
        ],
    ),
    (
        f"M43 · 🔴 **the row never says it stopped nothing** · R81's *\"the host records no ask\"*, undone at the writer — killed by `{PRESS}`",
        [
            (HOST, "      ...(stopsNothing ? { stopsNothing: true as const } : {}),\n", ""),
        ],
    ),
    (
        f"M44 · 🔴 **`howWorkStopped` reads it as an ask** — killed by `{PRESS}`",
        [
            (HOWSTOP, "      if (event.stopsNothing === true) continue\n      const cancelled", "      const cancelled"),
        ],
    ),
    (
        f"M45 · 🔴 **`deriveTasks` reads it as an ask** — killed by `{PRESS}`",
        [
            (TASKS, "      if (event.stopsNothing === true) continue\n", ""),
        ],
    ),
    (
        f"M46 · 🔴 **the store's last ask reads it as an ask** · `AgentCard.lastAskToStop` names a press that asked nothing — killed by `{PRESS}`",
        [
            (STORE, "        AND NOT (type = 'user_decision' AND json_type(payload, '$.stopsNothing') IS 'true')\n", ""),
        ],
    ),
    (
        f"M47 · ⚠️ **the Events index prints it as an ask** — killed by `{PRESS}`",
        [
            (DESCRIBE, "${event.stopsNothing === true ? ' · asked nothing' : ''}", ""),
        ],
    ),
    (
        f"M48 · 🔴 **a second press asks again** · another `turn/interrupt` behind the one Codex has not answered, and another ask in the ledger (`main`) — killed by `{STOP}`",
        [
            (HOST, "    if (stillAsked !== null && session.handle.status() !== 'waiting_permission') {\n", "    if (false) {\n"),
        ],
    ),
    (
        f"M49 · ⚠️ **a joined press returns at once** · the window's `busy` drops under an ask still in flight (review) — killed by `{STOP}`",
        [
            (HOST, "      await settledWithin(stillAsked, this.interruptWaitMs)\n", ""),
        ],
    ),
    (
        f"M50 · ⚠️ **a press joins while a card is up** · the card raised after the ask survives the Stop meant to settle it (review) — killed by `{STOP}`",
        [
            (HOST, "    if (stillAsked !== null && session.handle.status() !== 'waiting_permission') {\n", "    if (stillAsked !== null) {\n"),
        ],
    ),
    (
        f"M51 · 🔴 **an unanswered stop is never said** · the Stop comes back and the conversation says nothing (`main`) — killed by `{STOP}`",
        [
            (HOST, "    this.sayWhenTheStopGoesUnanswered(session, stopping, by)\n", ""),
        ],
    ),
    (
        f"M52 · ⛔ **a stop is said unanswered when it was answered, or its turn ended** — killed by `{STOP}`",
        [
            (HOST, "      if (session.stopStillAsked !== stopping || !this.isCurrentLife(session)) return\n", "      if (!this.isCurrentLife(session)) return\n"),
        ],
    ),
    (
        f"M53 · 🔴 **a turn's ending does not end the stop** · a turn Codex ended is said to be waiting, and the next turn's Stop asks nothing — killed by `{STOP}`",
        [
            (HOST, "    if (event.type === 'turn') session.stopStillAsked = null\n", ""),
        ],
    ),
    (
        f"M54 · ⚠️ **an answered stop is never let go** · Codex heard it, and a second press is swallowed — killed by `{STOP}`",
        [
            (HOST, "    stopping.then(answered, answered)\n", ""),
        ],
    ),
    (
        f"M55 · ⚠️ **a late answer to an OLD turn's ask lets go of the NEW turn's** (review) — killed by `{STOP}`",
        [
            (HOST, "      if (session.stopStillAsked === stopping) session.stopStillAsked = null\n", "      session.stopStillAsked = null\n"),
        ],
    ),
    (
        f"M56 · 🔴 **interrupt-and-send's own ask is never said, and a Stop does not join it** (review) — killed by `{STOP}`",
        [
            (HOST, "      this.sayWhenTheStopGoesUnanswered(session, asked, by)\n", ""),
        ],
    ),
    (
        f"M57 · ⚠️ **the row does not say WHOSE ask went unanswered** · another door's ask can land between it and its own (review) — killed by `{STOP}`",
        [
            (HOST, "      by: asker.who,\n      ...(asker.who === 'an-agent' ? { agent: asker.agent } : {}),\n    }\n    session.stopStillAsked = stopping\n", "      ...(asker.who === 'an-agent' ? { agent: asker.agent } : {}),\n    }\n    session.stopStillAsked = stopping\n"),
        ],
    ),
]
