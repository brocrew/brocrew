"""730 · When Codex asks, drawn — R80's MCP tool card, R81's Cancel that stops nothing, R83's Stop the
provider has not answered, and a window on another data folder whose name is long.

⚑ **The PM's four draws**, all built: R80 and R81 on the card, on Home and in the person's queue (the
marker and the call are `723`'s); R83's words in the conversation and on the Stop control (the fact is
`723`'s, the join is the host's); the userData title — main composes it (`724`) and the bar already drew
it (`718`), so what is killable here is the one thing `main` got wrong with it: a long name.

## 🔴 What has to be killable

 * `M1`–`M37` 🔴 **R80 · R81**: every word the ruling fixed (*Allow once*, *Allow for this
   conversation*, *Cancel request*, *MCP tool*, who asks, what the grant covers, what the Cancel does),
   every arm read on the wrong outcome or not read, every hop of the marks (the offer, the card, Home,
   the queue) and of the provider.
 * `M38`–`M62` 🔴 **R83**: the words, the asker by its kind, the fold holding the fact and its three
   clears, the window carrying it, the notice re-said with the pane's provider, and the Stop control's
   title and foot — only while `busy`, never over the frozen words.
 * `M63`–`M69` 🔴 **the userData title**: its ceiling, its cut, its ellipsis and the whole name on the
   title — `M64`–`M69` measured in the frame `RuntimeScreen` mounts the bar in, and `M63` (the title
   attribute) caught by the SSR pin in `the-bar-says-test.render.test.ts`.
 * `M70`–`M77` 🔴 **the review**: the omitted line never calls a cut block the whole call, and counts
   one in the singular; the reading and kept-open panes hand their provider; the foot never offers a
   taken queue; the MCP grant's own line, its words for a nameless tool, and what it does not cover.

## ⛔ What this table cannot reach

 * ⚠️ **R91** changed docblocks only — the ruled words were already pinned by `725`'s render test.
 * ⚠️ **A late answer to a Stop** writes no row (`723` F-7), so no row here can say that *has not
   answered the stop* went stale before the next `turn` (the join clause is conditional, *while that
   ask stands*) — a GAP for main.

## ⚑ WRITTEN, not run as a table

⛔ **Writing rows is routine, RUNNING a table is rare and deliberate.** Each row was verified RED alone
with `scripts/mutations/verify_row.py` — one row, its killer file, restored from bytes — in an isolated
worktree, and no `mutations.txt` exists.

## ⚠️ T-003 · after D-010 (`8bc565fa`) and D-011 (`79245533`)

D-010 deleted `queueTaken`: M74 is retired (its defect became the decision); M61 was corrected in place.
"""

from __future__ import annotations

APPTITLEBAR = 'apps/desktop/src/renderer/src/components/AppTitleBar.vue'
ATTENTION = 'apps/desktop/src/renderer/src/lib/attention.ts'
CONVERSATIONPANE = 'apps/desktop/src/renderer/src/components/ConversationPane.vue'
KEPTOPENPANE = 'apps/desktop/src/renderer/src/components/KeptOpenPane.vue'
NOTICEENTRY = 'apps/desktop/src/renderer/src/components/NoticeEntry.vue'
PERMISSIONCARD = 'apps/desktop/src/renderer/src/components/PermissionCard.vue'
PERMISSION_OFFER = 'apps/desktop/src/renderer/src/lib/permission-offer.ts'
PROMPTCOMPOSER = 'apps/desktop/src/renderer/src/components/PromptComposer.vue'
STOP_UNANSWERED = 'apps/desktop/src/renderer/src/lib/stop-unanswered.ts'
READINGPANE = 'apps/desktop/src/renderer/src/components/ReadingPane.vue'
TRANSCRIPT = 'apps/desktop/src/renderer/src/lib/transcript.ts'
TRANSCRIPTVIEW = 'apps/desktop/src/renderer/src/components/TranscriptView.vue'
TRANSCRIPT_WINDOW = 'apps/desktop/src/renderer/src/lib/transcript-window.ts'
USER_INPUT_OFFER = 'apps/desktop/src/renderer/src/lib/user-input-offer.ts'

MUTATIONS = [
    # ── R80 · R81 — the card, Home and the queue ────────────────────────────────────────────────────────
    (
        "M1 · R80 · wideGrantLabel's MCP arm dropped (the card's wide button says Always allow … this session) — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSION_OFFER, "  if (marks.mcpToolCall !== undefined) return ALLOW_FOR_THIS_CONVERSATION\n", "")],
    ),
    (
        "M2 · R80 · permissionOffer stops handing the request's marks to wideGrantLabel — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSION_OFFER, "label: wideGrantLabel(action, marks) }", "label: wideGrantLabel(action) }")],
    ),
    (
        "M3 · R80 · wideGrantElsewhere's MCP arm never taken (Home says Always allow … this session) — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        # ⚑ ANCHOR CORRECTED IN PLACE BY 743 — `739` F-1, ruled: Home offers the grant under the card's
        # warning (`wideGrantWarning`, which replaced `wideGrantElsewhere`); the MCP arm never taken
        # still says the plain grant's words on the MCP row — the subject, one sentence over.
        [(PERMISSION_OFFER, "  if (call !== undefined) return mcpToolGrantCovers(call, provider)\n", "  if (call === null) return mcpToolGrantCovers(call, provider)\n")],
    ),
    (
        "M4 · R80 · ALLOW_ONCE's words — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSION_OFFER, "export const ALLOW_ONCE = 'Allow once'", "export const ALLOW_ONCE = 'Allow'")],
    ),
    (
        "M5 · R80 · ALLOW_FOR_THIS_CONVERSATION says always — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSION_OFFER, "export const ALLOW_FOR_THIS_CONVERSATION = 'Allow for this conversation'", "export const ALLOW_FOR_THIS_CONVERSATION = 'Always allow for this conversation'")],
    ),
    (
        "M6 · R81 · CANCEL_REQUEST's words back to Cancel turn — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSION_OFFER, "export const CANCEL_REQUEST = 'Cancel request'", "export const CANCEL_REQUEST = 'Cancel turn'")],
    ),
    (
        "M7 · R80 · MCP_TOOL_KIND says command — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSION_OFFER, "export const MCP_TOOL_KIND = 'MCP tool'", "export const MCP_TOOL_KIND = 'command'")],
    ),
    (
        "M8 · R80 · mcpToolAsker never names the provider — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSION_OFFER, "  const who = provider === null ? `The provider` : providerName(provider)\n", "  const who = `The provider`\n")],
    ),
    (
        "M9 · R80 · mcpToolAsker's null arm swapped (no provider named as one) — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSION_OFFER, "  const who = provider === null ? `The provider` : providerName(provider)\n", "  const who = provider !== null ? `The provider` : providerName(provider as never)\n")],
    ),
    (
        "M10 · R80 · mcpToolAsker's sentence — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSION_OFFER, "  return `${who} asks to run an MCP tool`", "  return `${who} asks to run a tool`")],
    ),
    (
        "M11 · R80 · mcpToolGrantCovers never names the provider — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSION_OFFER, "  const asker = provider === null ? `The provider` : providerName(provider)\n", "  const asker = `The provider`\n")],
    ),
    (
        "M12 · R80 · mcpToolGrantCovers says session, not conversation — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSION_OFFER, "for the rest of this conversation, ` +", "for the rest of this session, ` +")],
    ),
    (
        "M13 · R80 · the card's mcpCall is never read — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSIONCARD, "const mcpCall = computed(() => props.item.request.mcpToolCall)", "const mcpCall = computed(() => undefined as typeof props.item.request.mcpToolCall)")],
    ),
    (
        "M14 · R80 · labelOf's Allow once arm dropped — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSIONCARD, "  if (outcome === 'allow' && mcpCall.value !== undefined) return ALLOW_ONCE\n", "")],
    ),
    (
        "M15 · R80 · labelOf's Allow once arm takes every outcome — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSIONCARD, "if (outcome === 'allow' && mcpCall.value !== undefined) return ALLOW_ONCE", "if (mcpCall.value !== undefined) return ALLOW_ONCE")],
    ),
    (
        "M16 · R81 · labelOf's Cancel request arm dropped — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSIONCARD, "  if (outcome === 'cancel' && props.item.request.cancelStopsNothing === true) return CANCEL_REQUEST\n", "")],
    ),
    (
        "M17 · R81 · labelOf's Cancel request arm takes every outcome — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSIONCARD, "if (outcome === 'cancel' && props.item.request.cancelStopsNothing === true) return CANCEL_REQUEST", "if (props.item.request.cancelStopsNothing === true) return CANCEL_REQUEST")],
    ),
    (
        "M18 · R81 · saysOf's R81 arm takes every outcome (Deny says the Cancel's line) — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        # ⚑ **728 · re-anchored in place, not retired** — 728 folds the R81 condition into one constant both of saysOf's arms read (a server's card's and the rest); the row still hands the Cancel's marker to every outcome
        [(PERMISSIONCARD, "  const stopsNothing = outcome === 'cancel' && props.item.request.cancelStopsNothing === true\n", "  const stopsNothing = props.item.request.cancelStopsNothing === true\n")],
    ),
    (
        "M19 · R81 · saysOf's R81 arm stops handing the marker — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSIONCARD, "      stopsNothing: true,\n    })\n", "    })\n")],
    ),
    (
        "M20 · R80 · the settled verdict says always again — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        # ⚑ 739 · ANCHOR CORRECTED IN PLACE — the plain card's arm no longer says *always* either (`739`:
        # R95's *Always allow* is the kept grant); the subject — the MCP card's conversation grant read
        # back as the plain card's — is unchanged, and the replacement is still the plain arm alone.
        [
            (
                PERMISSIONCARD,
                "      mcpCall.value === undefined\n        ? `Allowed every ${props.item.request.action} call for this conversation`\n        : 'Allowed for this conversation',\n",
                "      `Allowed every ${props.item.request.action} call for this conversation`,\n",
            )
        ],
    ),
    (
        "M21 · R80 · the kind chip says command — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSIONCARD, "{{ mcpCall ? MCP_TOOL_KIND : item.request.kind }}", "{{ item.request.kind }}")],
    ),
    (
        "M22 · R80 · the server/tool/parameter block never drawn — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSIONCARD, "<div v-if=\"mcpCall\" class=\"mcp-call\" data-cy=\"permission-mcp-call\">", "<div v-if=\"false && mcpCall\" class=\"mcp-call\" data-cy=\"permission-mcp-call\">")],
    ),
    (
        "M23 · R80 · the asker line is not handed the provider (hop) — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSIONCARD, "{{ mcpToolAsker(provider ?? null) }}", "{{ mcpToolAsker(null) }}")],
    ),
    (
        "M24 · R80 · the tool row drawn even when the tool is '' — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSIONCARD, "<template v-if=\"mcpCall.tool\">", "<template v-if=\"true\">")],
    ),
    (
        "M25 · R80 · only the first parameter drawn — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSIONCARD, "<template v-for=\"(parameter, index) in mcpCall.parameters\" :key=\"index\">", "<template v-for=\"(parameter, index) in mcpCall.parameters.slice(0, 1)\" :key=\"index\">")],
    ),
    (
        "M26 · R80 · a parameter's value drawn as its name — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSIONCARD, "<dd data-cy=\"permission-mcp-parameter-value\">{{ parameter.value }}</dd>", "<dd data-cy=\"permission-mcp-parameter-value\">{{ parameter.name }}</dd>")],
    ),
    (
        "M27 · R80 · the omitted-parameters line never drawn — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSIONCARD, "v-if=\"mcpCall.parametersOmitted\"", "v-if=\"false && mcpCall.parametersOmitted\"")],
    ),
    (
        "M28 · R80 · the MCP grant warning never drawn (old 'any … command' warning instead) — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSIONCARD, "<p v-if=\"mcpCall\" class=\"warn\" data-cy=\"permission-wide-warning\">", "<p v-if=\"false && mcpCall\" class=\"warn\" data-cy=\"permission-wide-warning\">")],
    ),
    (
        "M29 · R80 · the MCP grant warning is not handed the provider (hop) — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSIONCARD, "{{ mcpToolGrantCovers(mcpCall, provider ?? null) }}", "{{ mcpToolGrantCovers(mcpCall, null) }}")],
    ),
    (
        "M30 · R80 · Home stops handing the request's marks to wideGrantElsewhere — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        # ⚑ ANCHOR CORRECTED IN PLACE BY 743 — the function Home hands the marks to is `wideGrantWarning`
        # since `739` F-1 was ruled; the subject (the MCP row warned of in the plain words) is kept.
        [(ATTENTION, "wideGrantWarning(item.request.action, item.request, common.provider)", "wideGrantWarning(item.request.action)")],
    ),
    (
        "M31 · R80 · Home's Allow once arm never taken — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        # ⚑ **W4.28 · re-anchored in place, not retired** — W4.28 put the I opened it arm before it; the mutation is the same
        [(ATTENTION, "                : outcome === 'allow' && item.request.mcpToolCall !== undefined\n", "                : false && item.request.mcpToolCall !== undefined\n")],
    ),
    (
        "M32 · R80 · Home's Allow once arm takes every outcome — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        # ⚑ **W4.28 · re-anchored in place, not retired** — W4.28 put the I opened it arm before it; the mutation is the same
        [(ATTENTION, "                : outcome === 'allow' && item.request.mcpToolCall !== undefined\n", "                : item.request.mcpToolCall !== undefined\n")],
    ),
    (
        "M33 · R81 · Home's decision marks every outcome of a marked card — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(ATTENTION, "...(outcome === 'cancel' && item.request.cancelStopsNothing === true", "...(item.request.cancelStopsNothing === true")],
    ),
    (
        "M34 · R81 · Home's Cancel decision never carries the marker — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(ATTENTION, "              ? { stopsNothing: true as const }\n", "              ? {}\n")],
    ),
    (
        "M35 · R81 · whatThisAnswerDoes reads the marker beside any outcome — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(USER_INPUT_OFFER, "  if (decision.decision.outcome === 'cancel' && decision.stopsNothing === true) {\n", "  if (decision.stopsNothing === true) {\n")],
    ),
    (
        "M36 · R81 · whatThisAnswerDoes ignores the marker — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(USER_INPUT_OFFER, "    return CANCEL_STOPS_NOTHING\n", "    return PERMISSION_EFFECTS[decision.decision.outcome]\n")],
    ),
    (
        "M37 · R81 · CANCEL_STOPS_NOTHING's words lose their negation — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        # ⚑ **736 · corrected in place, not retired** — R97 made the line say the CLI's effect (*"the
        # turn runs on"*) beside the negation; the row still strips both to the bare request.
        [(USER_INPUT_OFFER, "export const CANCEL_STOPS_NOTHING = `the request is cancelled and the turn runs on — it is not ${ASKED_TO_STOP}`", "export const CANCEL_STOPS_NOTHING = `the request is cancelled`")],
    ),
    # ── R83 — a Stop the provider has not answered ──────────────────────────────────────────────────────
    (
        "M38 · R83 · the sentence names the asker by its sess_ handle — killed by `a-stop-the-provider-has-not-answered-drawn.test.ts`",
        # ⚑ **Re-anchored in place by `737`** (`734` F-2): the asker is named through `whoAskedItToStop`
        # (the category, or the agent's name with a roster); the row still hands `stoppedBy` the handle.
        [(STOP_UNANSWERED, "  return `${who} has not answered the stop asked for by ${whoAskedItToStop(fact, identities)}`\n", "  return `${who} has not answered the stop asked for by ${stoppedBy(fact.by, fact.agent ?? null)}`\n")],
    ),
    (
        "M39 · R83 · the notice sentence never names the provider — killed by `a-stop-the-provider-has-not-answered-drawn.render.test.ts`",
        [(STOP_UNANSWERED, "  const who = provider === null ? `The provider` : providerName(provider)\n", "  const who = `The provider`\n")],
    ),
    (
        "M40 · R83 · the Stop's words never name the provider in 'rather than asking … again' — killed by `a-stop-the-provider-has-not-answered-drawn.render.test.ts`",
        [(STOP_UNANSWERED, "  const who = provider === null ? `the provider` : providerName(provider)\n", "  const who = `the provider`\n")],
    ),
    (
        "M41 · R83 · the Stop's words drop 'while that ask stands, Stop joins it' — killed by `a-stop-the-provider-has-not-answered-drawn.render.test.ts`",
        # ⚑ **Re-anchored in place by `737`** (`734` F-2): the words take the roster too.
        [(STOP_UNANSWERED, "  return `${stopUnansweredSays(fact, provider, identities)} — while that ask stands, Stop joins it rather than asking ${who} again`\n", "  return stopUnansweredSays(fact, provider, identities)\n")],
    ),
    (
        "M42 · R83 · the fold does not hold the standing fact — killed by `a-stop-the-provider-has-not-answered-drawn.test.ts`",
        [(TRANSCRIPT, "      state.stopUnanswered = fact\n", "")],
    ),
    (
        "M43 · R83 · the fold's text names the ref's provider — killed by `a-stop-the-provider-has-not-answered-drawn.test.ts`",
        [(TRANSCRIPT, "        text: stopUnansweredSays(fact, null),\n", "        text: stopUnansweredSays(fact, state.ref?.provider ?? null),\n")],
    ),
    (
        "M44 · R83 · the notice item carries no facts, so NoticeEntry cannot re-say it — killed by `a-stop-the-provider-has-not-answered-drawn.render.test.ts`",
        [(TRANSCRIPT, "        stopUnanswered: fact,\n", "")],
    ),
    (
        "M45 · R83 · the fact drops the asking conversation — killed by `a-stop-the-provider-has-not-answered-drawn.test.ts`",
        [(TRANSCRIPT, "        ...(event.agent === undefined ? {} : { agent: event.agent }),\n", "")],
    ),
    (
        "M46 · R83 · the notice is info (dropped by the reading view and the export) — killed by `a-stop-the-provider-has-not-answered-drawn.test.ts`",
        [(TRANSCRIPT, "        level: 'warn',\n        text: stopUnansweredSays(fact, null),\n", "        level: 'info',\n        text: stopUnansweredSays(fact, null),\n")],
    ),
    (
        "M47 · R83 · a turn row does not clear the fact — killed by `a-stop-the-provider-has-not-answered-drawn.test.ts`",
        [(TRANSCRIPT, "      // standing ask only while its turn runs (`RuntimeHost.interrupt`).\n      state.stopUnanswered = null\n", "      // standing ask only while its turn runs (`RuntimeHost.interrupt`).\n")],
    ),
    (
        "M48 · R83 · a newer ask does not clear the fact — killed by `a-stop-the-provider-has-not-answered-drawn.test.ts`",
        [(TRANSCRIPT, "      // ⚑ **730 · R83 — a newer ask is the one a Stop would join**, and nobody has yet waited on it.\n      state.stopUnanswered = null\n", "      // ⚑ **730 · R83 — a newer ask is the one a Stop would join**, and nobody has yet waited on it.\n")],
    ),
    (
        "M49 · R83 · a reopen does not clear the fact — killed by `a-stop-the-provider-has-not-answered-drawn.test.ts`",
        [(TRANSCRIPT, "  state.stopUnanswered = null // …and so did any ask to stop it (730, R83): a new life asks afresh\n", "")],
    ),
    (
        "M50 · R83 · carryForward drops the fact — killed by `a-stop-the-provider-has-not-answered-drawn.test.ts`",
        [(TRANSCRIPT_WINDOW, "    stopUnanswered: state.stopUnanswered,\n", "    stopUnanswered: null,\n")],
    ),
    (
        "M51 · R83 · foldWindow does not restore the carried fact — killed by `a-stop-the-provider-has-not-answered-drawn.test.ts`",
        [(TRANSCRIPT_WINDOW, "    state.stopUnanswered = carry.stopUnanswered\n", "")],
    ),
    (
        "M52 · R83 · NoticeEntry re-says it without the pane's provider — killed by `a-stop-the-provider-has-not-answered-drawn.render.test.ts`",
        # ⚑ **Re-anchored in place by `737`** (`734` F-2): the call takes the roster as a third line.
        [(NOTICEENTRY, "        props.item.stopUnanswered,\n        props.provider ?? null,\n", "        props.item.stopUnanswered,\n        null,\n")],
    ),
    (
        "M53 · R83 · NoticeEntry skips the re-said branch — killed by `a-stop-the-provider-has-not-answered-drawn.render.test.ts`",
        [(NOTICEENTRY, "    ? stopOrAsked.value\n", "    ? askedOrText.value\n")],
    ),
    (
        "M54 · R83 · TranscriptView does not hand its notices the provider — killed by `a-stop-the-provider-has-not-answered-drawn.render.test.ts`",
        [(TRANSCRIPTVIEW, "          :identities=\"props.identities ?? null\"\n          :provider=\"props.provider\"\n          :can-recover-sign-in=", "          :identities=\"props.identities ?? null\"\n          :can-recover-sign-in=")],
    ),
    (
        "M55 · R83 · ConversationPane does not pass the words to the composer — killed by `a-stop-the-provider-has-not-answered-drawn.dom.test.ts`",
        [(CONVERSATIONPANE, "          :stop-unanswered=\"stopUnansweredWords\"\n", "")],
    ),
    (
        "M56 · R83 · ConversationPane composes the words without the record's provider — killed by `a-stop-the-provider-has-not-answered-drawn.dom.test.ts`",
        # ⚑ **Re-anchored in place by `737`** (`734` F-2): the call takes the roster as a third line.
        [(CONVERSATIONPANE, "        control.value.stopUnanswered,\n        props.record.meta?.provider ?? null,\n", "        control.value.stopUnanswered,\n        null,\n")],
    ),
    (
        "M57 · R83 · the busy Stop title ignores stopUnanswered — killed by `a-stop-the-provider-has-not-answered-drawn.render.test.ts`",
        # ⚑ **Re-anchored in place by `737`** (`730` F-3): the busy title is R43's words now.
        [(PROMPTCOMPOSER, "              : props.stopUnanswered !== null\n                ? `${props.stopUnanswered} (Esc)`\n                : `Stop — ${A_STOP_ASKS_THE_TURN} (Esc)`\n", "              : `Stop — ${A_STOP_ASKS_THE_TURN} (Esc)`\n")],
    ),
    (
        "M58 · R83 · the R83 title outranks the frozen title — killed by `a-stop-the-provider-has-not-answered-drawn.render.test.ts`",
        # ⚑ **Re-anchored in place by `737`** (`730` F-3): the frozen title is R43's words now.
        [(PROMPTCOMPOSER, "            state === 'frozen'\n              ? `Stop instead of answering — ${A_STOP_ASKS_THE_TURN} (Esc)`\n", "            state === 'frozen' && props.stopUnanswered === null\n              ? `Stop instead of answering — ${A_STOP_ASKS_THE_TURN} (Esc)`\n")],
    ),
    (
        "M59 · R83 · the foot's branch is not gated on busy — killed by `a-stop-the-provider-has-not-answered-drawn.render.test.ts`",
        [(PROMPTCOMPOSER, "          v-else-if=\"state === 'busy' && props.interruptible && props.stopUnanswered !== null\"\n", "          v-else-if=\"props.interruptible && props.stopUnanswered !== null\"\n")],
    ),
    (
        "M60 · R83 · the foot's branch is not gated on interruptible — killed by `a-stop-the-provider-has-not-answered-drawn.render.test.ts`",
        [(PROMPTCOMPOSER, "          v-else-if=\"state === 'busy' && props.interruptible && props.stopUnanswered !== null\"\n", "          v-else-if=\"state === 'busy' && props.stopUnanswered !== null\"\n")],
    ),
    (
        "M61 · R83 · the foot drops 'Esc is Stop; type to queue a message' — killed by `a-stop-the-provider-has-not-answered-drawn.render.test.ts`",
        # ⚑ **T-003 · re-anchored in place, not retired** — D-010 removed the `queueTaken` sub-template; the row still drops the foot's clause. Re-verified RED alone.
        [(PROMPTCOMPOSER, "          {{ props.stopUnanswered }}. <strong>Esc</strong> is Stop; type to queue a message.\n", "          {{ props.stopUnanswered }}.\n")],
    ),
    (
        "M62 · R83 · the stopUnanswered default is removed (an absent prop reads as set) — killed by `a-stop-the-provider-has-not-answered-drawn.render.test.ts`",
        [(PROMPTCOMPOSER, "    stopUnanswered: null,\n    blocked: null,\n", "    blocked: null,\n")],
    ),
    # ── the userData title — a long data folder ─────────────────────────────────────────────────────────
    (
        "M63 · userData · the whole name leaves .window-title's title attribute — killed by `the-bar-says-test.render.test.ts`",
        [(APPTITLEBAR, "<div class=\"window-title\" data-cy=\"window-title\" :title=\"info?.windowTitle\">", "<div class=\"window-title\" data-cy=\"window-title\">")],
    ),
    (
        "M64 · userData · the title attribute reads the app's name, not the window's — killed by `a-window-on-another-data-folder-says-so.dom.test.ts`",
        [(APPTITLEBAR, ":title=\"info?.windowTitle\"", ":title=\"info?.name\"")],
    ),
    (
        "M65 · userData · the ceiling on .window-title removed — killed by `a-window-on-another-data-folder-says-so.dom.test.ts`",
        [(APPTITLEBAR, "  max-width: 50vw;\n", "")],
    ),
    (
        "M66 · userData · the ceiling as a percentage, which resolves against the auto track it sizes — killed by `a-window-on-another-data-folder-says-so.dom.test.ts`",
        [(APPTITLEBAR, "  max-width: 50vw;\n", "  max-width: 50%;\n")],
    ),
    (
        "M67 · userData · a ceiling too wide to leave the sync cluster its room — killed by `a-window-on-another-data-folder-says-so.dom.test.ts`",
        [(APPTITLEBAR, "  max-width: 50vw;\n", "  max-width: 80vw;\n")],
    ),
    (
        "M68 · userData · the name is no longer cut (overflow visible) — killed by `a-window-on-another-data-folder-says-so.dom.test.ts`",
        [(APPTITLEBAR, ".window-title strong {\n  overflow: hidden;\n", ".window-title strong {\n")],
    ),
    (
        "M69 · userData · the cut is a hard edge, with no ellipsis — killed by `a-window-on-another-data-folder-says-so.dom.test.ts`",
        [(APPTITLEBAR, "  font-weight: var(--fw-semibold);\n  text-overflow: ellipsis;\n}\n", "  font-weight: var(--fw-semibold);\n}\n")],
    ),
    # ── the review — the omitted line ───────────────────────────────────────────────────────────────────
    (
        "M70 · 730 review · the omitted line calls a CUT block the whole call — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSIONCARD, "            item.request.detailOmitted\n              ? 'the block below holds the call, and says where it is cut.'", "            false\n              ? 'the block below holds the call, and says where it is cut.'")],
    ),
    (
        "M71 · 730 review · one omitted parameter is counted in the plural — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSIONCARD, "mcpCall.parametersOmitted === 1 ? 'parameter is' : 'parameters are'", "'parameters are'")],
    ),
    # ── the review — what round 1 confirmed ───────────────────────────────────────────────────
    (
        "M72 · 730 review · R83 · the reading pane stops handing its transcript the provider — killed by `a-stop-the-provider-has-not-answered-drawn.render.test.ts`",
        [(READINGPANE, "      :provider=\"props.entry.provider\"\n", "")],
    ),
    (
        "M73 · 730 review · R83 · the kept-open pane stops handing its transcript the provider — killed by `a-stop-the-provider-has-not-answered-drawn.render.test.ts`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — KeptOpenPane.vue was
        # deleted, but the rule survives. The R83 test §5 was re-aimed on purpose from the kept-open
        # pane to `ConversationPane`, the one full view a recorded conversation now opens in, and
        # asserts it hands its transcript the conversation's own provider. The plant is
        # ConversationPane's `:provider` binding on TranscriptView (count 1). Note that 725:M21
        # plants the identical edit with a different killer (the dom test).
        [
            (CONVERSATIONPANE, '          :provider="props.record.meta?.provider ?? null"\n', ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The row's defect is now the decision.
        # M74 planted 'the foot offers to queue a message while one is already waiting' by forcing
        # the `!queueTaken` gate true. Its anchor is left stale, so the census records it retired
        # (`anchor-absent`).
        "M74 · 730 review · R83 · the foot offers to queue a message while one is already waiting — killed by `a-stop-the-provider-has-not-answered-drawn.render.test.ts`",
        [(PROMPTCOMPOSER, "is Stop<template v-if=\"!queueTaken\"", "is Stop<template v-if=\"true\"")],
    ),
    (
        "M75 · 730 review · R80 · the line under the MCP grant is PERMISSION_EFFECTS' *anything of this kind* again — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSIONCARD, "  if (outcome === 'allow_all_for_session' && mcpCall.value !== undefined) {\n", "  if (false) {\n")],
    ),
    (
        "M76 · 730 review · R80 · an empty tool name leaves a gap in the grant's sentences — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSION_OFFER, "  return call.tool === '' ? `this tool` : call.tool\n", "  return call.tool\n")],
    ),
    (
        "M77 · 730 review · R80 · the warning promises the server's other tools are still asked about — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(PERMISSION_OFFER, "    `the grant does not cover ${call.server}’s other tools.`\n", "    `${call.server}’s other tools are still asked about.`\n")],
    ),
]
