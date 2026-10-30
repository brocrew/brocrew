"""725 · What main carried since `712`, drawn — R44 and R73 on the permission and grant cards, R71's
own ending, R62's still-closing rows, R54's second half, `711` GAP-1 / `701` F-4's kept-open
conversation on every surface, and `716` F-1's skipped sign-in check.

⚑ **The PM's §2**, nine draws: seven built here; `716` F-3 was already true on `main` (built by
`718`, one row below guards its third site); `720` F-D is a GAP for main (`StalledWork` carries no
ask) and has no row.

## 🔴 What has to be killable

 * `M1`–`M27` 🔴 **R44 / R73**: the agent's words unlabelled, unnamed, drawn as a scope line or put
   into the disclosure, read off the legacy field; the rule drawn as a reason, the provider never
   named or named from nothing; every hop (the card's props, the view's forwards, the pane's
   provider, Home's two arms and its line).
 * `M28`–`M34` 🔴 **R71**: the mark never read, read truthily, the clause on every ending or cut
   loose from its receipt, the words losing *not the provider's*, and the Events tab's `(ours)`.
 * `M35`–`M55` 🔴 **R62**: the fold dropping `closing` on either half or inventing it; the arm dead
   or outranking a press; the wait promised where no reopen is offered; the face, the hover, the
   palette's note and the Sessions page's two lines.
 * `M56`–`M64` 🔴 **R54's second half**: the arm deleted or read truthily; the quit pairing dropped,
   half-dropped or swapped; the ruled words cut.
 * `M65`–`M83` 🔴 **`716` F-1**: the store never asking, never throwing the answer back, rewording
   `said`, drawing a Cancel, writing the word for the sheet or a superseded launch or never clearing
   it; the launcher's watch blind to the word or to `sign-in` / no word; what an earlier check left
   up (a *could not check* kept, a gesture's panel taken, an *expired* never asked again); a late
   automatic *could not check* drawn, a person's own dropped, the first word deciding for later,
   and a hidden *usable* asked again.
 * `M84`–`M118` 🔴 **`711` GAP-1 · `701` F-4**: every surface's plate, words, chip and press; the
   refused row; the live list through every hop; and a row that SAID open pressed into a Reopen.
 * `M119` ⚠️ **`716` F-3**: the third take-over site, which `718`'s table left to one census.

## ⛔ What this table cannot reach

 * ⚠️ **`RuntimeScreen` is mounted by no test** (`211` §11): its bindings (`:refused-as`,
   `:kept-open`, `@open-kept-open`) are killed by censuses over its source.
 * ⚠️ **The quit pairing's cause conjunct** can be told apart only by a row the host cannot build
   (admission forces `conversation_ended` on every `'set-right'` row): its row is killed by the
   render test's one impossible-world cell, which says so.
 * ⚠️ **`720` F-D** is main's: no field carries the stall's asker to the band.

## ⚑ WRITTEN, not run as a table

⛔ **Writing rows is routine, RUNNING a table is rare and deliberate.** Each row was verified RED
alone with `scripts/mutations/verify_row.py` — one row, its killer file, restored from bytes — in an
isolated worktree, and no `mutations.txt` exists.
"""

from __future__ import annotations

ATTENTIONQUEUE = 'apps/desktop/src/renderer/src/components/AttentionQueue.vue'
CONVERSATIONPANE = 'apps/desktop/src/renderer/src/components/ConversationPane.vue'
NEWCONVERSATION = 'apps/desktop/src/renderer/src/components/NewConversation.vue'
OUTGOINGENTRY = 'apps/desktop/src/renderer/src/components/OutgoingEntry.vue'
PERMISSIONCARD = 'apps/desktop/src/renderer/src/components/PermissionCard.vue'
PROJECTWORKSPACE = 'apps/desktop/src/renderer/src/components/ProjectWorkspace.vue'
RESUMABLESESSIONS = 'apps/desktop/src/renderer/src/components/ResumableSessions.vue'
RUNTIMESCREEN = 'apps/desktop/src/renderer/src/components/RuntimeScreen.vue'
TEAMWORKSPACE = 'apps/desktop/src/renderer/src/components/TeamWorkspace.vue'
TRANSCRIPTVIEW = 'apps/desktop/src/renderer/src/components/TranscriptView.vue'
USERINPUTCARD = 'apps/desktop/src/renderer/src/components/UserInputCard.vue'
WORKREPORTENTRY = 'apps/desktop/src/renderer/src/components/WorkReportEntry.vue'
ATTENTION = 'apps/desktop/src/renderer/src/lib/attention.ts'
CLOSED_THREADS = 'apps/desktop/src/renderer/src/lib/closed-threads.ts'
DESCRIBE_EVENT = 'apps/desktop/src/renderer/src/lib/describe-event.ts'
OUTGOING_CARD = 'apps/desktop/src/renderer/src/lib/outgoing-card.ts'
PERMISSION_OFFER = 'apps/desktop/src/renderer/src/lib/permission-offer.ts'
PERSONS_QUEUE = 'apps/desktop/src/renderer/src/lib/persons-queue.ts'
PROJECT_ROSTER = 'apps/desktop/src/renderer/src/lib/project-roster.ts'
SESSION_STORE = 'apps/desktop/src/renderer/src/lib/session-store.ts'
THE_FOREST = 'apps/desktop/src/renderer/src/lib/the-forest.ts'
TRANSCRIPT = 'apps/desktop/src/renderer/src/lib/transcript.ts'
WHERE_THE_WORK_IS = 'apps/desktop/src/renderer/src/lib/where-the-work-is.ts'
WORKING_TOGETHER = 'apps/desktop/src/renderer/src/lib/working-together.ts'

MUTATIONS = [
    # ── R44 · R73 — the agent’s words by its name, and a policy’s rule as its rule ──────────────────────
    (
        "M1 · R44 words: drop 'says' — killed by `the-agents-words-and-the-providers-rule.render.test.ts`",
        [(PERMISSION_OFFER, '  return `${name ?? THE_AGENT} says: “${words}”`\n', '  return `${name ?? THE_AGENT}: “${words}”`\n')],
    ),
    (
        'M2 · R44 name ignored — always THE_AGENT — killed by `the-agents-words-and-the-providers-rule.render.test.ts`',
        [(PERMISSION_OFFER, '  return `${name ?? THE_AGENT} says: “${words}”`\n', '  return `${THE_AGENT} says: “${words}”`\n')],
    ),
    (
        'M3 · R44 fallback word — killed by `the-agents-words-and-the-providers-rule.render.test.ts`',
        [(PERMISSION_OFFER, "export const THE_AGENT = 'The agent'\n", "export const THE_AGENT = 'this conversation'\n")],
    ),
    (
        'M4 · R73 branch key inverted — killed by `the-agents-words-and-the-providers-rule.render.test.ts`',
        [(PERMISSION_OFFER, "      : marks.providerReasonFrom === 'a-policy-rule'\n", "      : marks.providerReasonFrom !== 'a-policy-rule'\n")],
    ),
    (
        'M5 · R73 branch arm drawn as a reason — killed by `the-agents-words-and-the-providers-rule.render.test.ts`',
        [(PERMISSION_OFFER, '        ? inItsRulesWords(marks.providerReason, provider)\n', '        ? inTheProvidersWords(marks.providerReason)\n')],
    ),
    (
        'M6 · R73 provider not handed to the label — killed by `the-agents-words-and-the-providers-rule.render.test.ts`',
        [(PERMISSION_OFFER, '        ? inItsRulesWords(marks.providerReason, provider)\n', '        ? inItsRulesWords(marks.providerReason, null)\n')],
    ),
    (
        'M7 · R73 provider never named — killed by `the-agents-words-and-the-providers-rule.render.test.ts`',
        [(PERMISSION_OFFER, '  return provider === null\n', '  return true\n')],
    ),
    (
        'M8 · R73 unnamed label says reason — killed by `the-agents-words-and-the-providers-rule.render.test.ts`',
        [(PERMISSION_OFFER, '    ? `The provider’s rule: “${rule}”`\n', '    ? `The provider’s reason: “${rule}”`\n')],
    ),
    (
        'M9 · R73 named label says reason — killed by `the-agents-words-and-the-providers-rule.render.test.ts`',
        [(PERMISSION_OFFER, '    : `${providerName(provider)}’s rule: “${rule}”`\n', '    : `${providerName(provider)}’s reason: “${rule}”`\n')],
    ),
    (
        'M10 · card: provider prop not read — killed by `the-agents-words-and-the-providers-rule.render.test.ts`',
        [(PERMISSIONCARD, '  whatTheMarksSay(props.item.request, offer.value, props.provider ?? null),\n', '  whatTheMarksSay(props.item.request, offer.value, null),\n')],
    ),
    (
        'M11 · card: ownAgent prop not read — killed by `the-agents-words-and-the-providers-rule.render.test.ts`',
        [(PERMISSIONCARD, '    ? inTheAgentsWords(props.ownAgent ?? null, props.item.request.agentReason)\n', '    ? inTheAgentsWords(null, props.item.request.agentReason)\n')],
    ),
    (
        'M12 · card: agent line never drawn — killed by `the-agents-words-and-the-providers-rule.render.test.ts`',
        [(PERMISSIONCARD, '      <p v-if="agentSays" class="request-summary" data-cy="permission-agent-reason">\n', '      <p v-if="false" class="request-summary" data-cy="permission-agent-reason">\n')],
    ),
    (
        "M13 · card: the agent's words put INTO the disclosure — killed by `the-agents-words-and-the-providers-rule.render.test.ts`",
        # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · 619f250d draws the disclosure through PathsInText so a path in it can be opened; the plant still puts the agent's words inside the disclosure.
        [(PERMISSIONCARD, "        <PathsInText :text=\"item.request.detail\" :found=\"paths\" />\n", "        <PathsInText :text=\"item.request.detail\" :found=\"paths\" /> {{ agentSays }}\n")],
    ),
    (
        'M14 · grant card: reads the legacy unlabelled field — killed by `the-agents-words-and-the-providers-rule.render.test.ts`',
        [(USERINPUTCARD, '  const words = props.item.request.permission?.agentReason\n', '  const words = props.item.request.permission?.reason\n')],
    ),
    (
        'M15 · grant card: ownAgent prop not read — killed by `the-agents-words-and-the-providers-rule.render.test.ts`',
        [(USERINPUTCARD, '  return words ? inTheAgentsWords(props.ownAgent ?? null, words) : null\n', '  return words ? inTheAgentsWords(null, words) : null\n')],
    ),
    (
        'M16 · grant card: agent line never drawn — killed by `the-agents-words-and-the-providers-rule.render.test.ts`',
        [(USERINPUTCARD, '      <p v-if="agentSays" data-cy="user-input-agent-reason">{{ agentSays }}</p>\n', '')],
    ),
    (
        "M17 · grant card: the agent's words drawn as a scope line — killed by `the-agents-words-and-the-providers-rule.render.test.ts`",
        [(USERINPUTCARD, '        <div v-if="item.request.permission.reason">{{ item.request.permission.reason }}</div>\n', '        <div v-if="item.request.permission.reason">{{ item.request.permission.reason }}</div>\n        <div v-if="agentSays">{{ agentSays }}</div>\n')],
    ),
    (
        'M18 · view: PermissionCard not handed own-agent — killed by `the-agents-words-and-the-providers-rule.render.test.ts`',
        [(TRANSCRIPTVIEW, '          :own-agent="props.ownAgent ?? null"\n          :provider="props.provider ?? null"\n', '          :provider="props.provider ?? null"\n')],
    ),
    (
        'M19 · view: PermissionCard not handed provider — killed by `the-agents-words-and-the-providers-rule.render.test.ts`',
        [(TRANSCRIPTVIEW, '          :provider="props.provider ?? null"\n', '')],
    ),
    (
        'M20 · view: UserInputCard not handed own-agent — killed by `the-agents-words-and-the-providers-rule.render.test.ts`',
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule is unchanged:
        # `TranscriptView` must hand `UserInputCard` the view's `ownAgent`. D-017b only inserted
        # `:taken-without-this-window` between `:own-agent` and `@respond`, so the old two-line
        # anchor stopped matching. Killer `the-agents-words-and-the-providers-rule.render.test.ts`
        # §5 '🔴 the grant card in a transcript is named by the view's ownAgent' is unchanged by the
        # commit and pins it.
        [
            # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · 619f250d hands the user-input card the found paths between the window prop and the respond handler; the plant still stops the view handing that card its agent's name.
            (TRANSCRIPTVIEW, "          :own-agent=\"props.ownAgent ?? null\"\n          :taken-without-this-window=\"props.takenWithoutThisWindow\"\n          :paths=\"props.paths\"\n          @respond=", "          :taken-without-this-window=\"props.takenWithoutThisWindow\"\n          :paths=\"props.paths\"\n          @respond="),
        ],
    ),
    (
        "M21 · pane: TranscriptView not handed the conversation's provider — killed by `the-agents-words-and-the-providers-rule.dom.test.ts`",
        [(CONVERSATIONPANE, '          :provider="props.record.meta?.provider ?? null"\n', '')],
    ),
    (
        "M22 · Home: marks read without the row's provider — killed by `the-agents-words-and-the-providers-rule.render.test.ts`",
        [(ATTENTION, '          ...markFields(whatTheMarksSay(item.request, offer, common.provider), offer),\n', '          ...markFields(whatTheMarksSay(item.request, offer), offer),\n')],
    ),
    (
        'M23 · Home command arm: reads the wrong field — killed by `the-agents-words-and-the-providers-rule.render.test.ts`',
        [(ATTENTION, '          ...(item.request.agentReason\n', '          ...(item.request.summary\n')],
    ),
    (
        'M24 · Home command arm: unnamed — killed by `the-agents-words-and-the-providers-rule.render.test.ts`',
        [(ATTENTION, '            ? { agentSays: inTheAgentsWords(common.who, item.request.agentReason) }\n', '            ? { agentSays: inTheAgentsWords(null, item.request.agentReason) }\n')],
    ),
    (
        'M25 · Home grant arm: reads the legacy unlabelled field — killed by `the-agents-words-and-the-providers-rule.render.test.ts`',
        [(ATTENTION, '        ...(grant?.agentReason\n          ? { agentSays: inTheAgentsWords(common.who, grant.agentReason) }\n', '        ...(grant?.reason\n          ? { agentSays: inTheAgentsWords(common.who, grant.reason) }\n')],
    ),
    (
        'M26 · Home grant arm: unnamed — killed by `the-agents-words-and-the-providers-rule.render.test.ts`',
        [(ATTENTION, '          ? { agentSays: inTheAgentsWords(common.who, grant.agentReason) }\n', '          ? { agentSays: inTheAgentsWords(null, grant.agentReason) }\n')],
    ),
    (
        'M27 · Home: agent line never drawn — killed by `the-agents-words-and-the-providers-rule.render.test.ts`',
        [(ATTENTIONQUEUE, '        <p v-if="request.agentSays" class="request-agent" data-cy="attention-agent-reason">\n', '        <p v-if="false" class="request-agent" data-cy="attention-agent-reason">\n')],
    ),
    # ── R71 — an ending this app wrote, said as its own word ────────────────────────────────────────────
    (
        "M28 · R71 · the notice never reads the mark (main's drawing) — killed by `the-apps-own-ending-is-drawn.test.ts`",
        # ⚑ **F074 · re-anchored in place, not retired** — F074 put a usage limit's ending beside the plain one; the row still never reads the mark.
        [(TRANSCRIPT, "        event.wordOf === 'this-app'\n          ? `turn ${event.state} — ${THE_APPS_OWN_WORD}`\n          : event.state === 'failed' && event.limit !== undefined\n", "        event.state === 'failed' && event.limit !== undefined\n")],
    ),
    (
        'M29 · R71 · every non-completed ending gains the clause — killed by `the-apps-own-ending-is-drawn.test.ts`',
        [(TRANSCRIPT, "        event.wordOf === 'this-app'\n          ? `turn ${event.state} — ${THE_APPS_OWN_WORD}`\n", "        event.wordOf === 'this-app' || event.state !== 'completed'\n          ? `turn ${event.state} — ${THE_APPS_OWN_WORD}`\n")],
    ),
    (
        'M30 · R71 · a truthy read accepts a cast foreign value — killed by `the-apps-own-ending-is-drawn.test.ts`',
        [(TRANSCRIPT, "        event.wordOf === 'this-app'\n          ? `turn ${event.state} — ${THE_APPS_OWN_WORD}`\n", '        Boolean(event.wordOf)\n          ? `turn ${event.state} — ${THE_APPS_OWN_WORD}`\n')],
    ),
    (
        'M31 · R71 · the clause stands without the receipt — killed by `the-apps-own-ending-is-drawn.test.ts`',
        [(TRANSCRIPT, "        event.wordOf === 'this-app'\n          ? `turn ${event.state} — ${THE_APPS_OWN_WORD}`\n", "        event.wordOf === 'this-app'\n          ? THE_APPS_OWN_WORD\n")],
    ),
    (
        "M32 · R71 · the words drop 'not the provider’s' — killed by `the-apps-own-ending-is-drawn.test.ts`",
        [(TRANSCRIPT, "export const THE_APPS_OWN_WORD = 'this app’s word, not the provider’s'\n", "export const THE_APPS_OWN_WORD = 'this app’s word'\n")],
    ),
    (
        'M33 · R71 · the Events tab never says (ours) — killed by `the-apps-own-ending-is-drawn.test.ts`',
        # ⚑ **F080 · re-anchored in place, not retired** — F080 added the provider's own turn to the same expression, so the condition is its own line.
        [(DESCRIBE_EVENT, "      return event.wordOf === 'this-app'\n", "      return false\n")],
    ),
    (
        'M34 · R71 · the Events tab says (ours) of every ending — killed by `the-apps-own-ending-is-drawn.test.ts`',
        # ⚑ **F080 · re-anchored in place, not retired** — F080 added the provider's own turn to the same expression, so the condition is its own line.
        [(DESCRIBE_EVENT, "      return event.wordOf === 'this-app'\n", "      return true\n")],
    ),
    # ── R62 — a row still closing says so, and keeps its reopen ─────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The file the row edits,
        # `lib/closed-threads.ts`, was deleted, together with the killer
        # `a-row-still-closing-says-so.render.test.ts` and its dom twin; the Sessions page's
        # `resumable-closing-` / `unresumable-closing-` lines went too. "Still closing" is a
        # sentence about whether a process runs, which the commit removed: "No sentence says whether
        # a process runs", one Conversations list with no closed-list fold. Its anchor is left
        # stale, so the census records it retired.
        'M35 · R62 · the fold drops `closing` on the resumable half — killed by `a-row-still-closing-says-so.render.test.ts`',
        [(CLOSED_THREADS, '      // ⚑ **725 · R62 — `=== true`** for the same reason: a hand-built fixture can leave it out.\n      closing: session.closing === true,\n', '      // ⚑ **725 · R62 — `=== true`** for the same reason: a hand-built fixture can leave it out.\n      closing: false,\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** D-017b deleted `closed-threads.ts`
        # (the Closed conversations list and its `closing` face) and its killer
        # `a-row-still-closing-says-so.render.test.ts`, and dropped `closing` from the wire. Card:
        # "no sentence about whether anything is running, since that's a process fact (`05` rule
        # 5)"; commit: "No sentence says whether a process runs". Its anchor is left stale, so the
        # census records it retired.
        'M36 · R62 · a field a double omits is read as closing (resumable half) — killed by `a-row-still-closing-says-so.render.test.ts`',
        [(CLOSED_THREADS, '      // ⚑ **725 · R62 — `=== true`** for the same reason: a hand-built fixture can leave it out.\n      closing: session.closing === true,\n', '      // ⚑ **725 · R62 — `=== true`** for the same reason: a hand-built fixture can leave it out.\n      closing: session.closing !== false,\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The fold that carried `closing` onto
        # the unresumable half lived in the deleted `closed-threads.ts`. The `closing` field is gone
        # from `ResumableSessionInfo` and `UnresumableSessionInfo`. The rewritten test says "D-017b
        # retired the field (`05` rule 5): still closing is a sentence about a process, and the
        # window says none". Its anchor is left stale, so the census records it retired.
        'M37 · R62 · the fold drops `closing` on the unresumable half — killed by `a-row-still-closing-says-so.render.test.ts`',
        [(CLOSED_THREADS, '      // Claude conversation closed before its first turn named it has no ref, so it is here.\n      closing: session.closing === true,\n', '      // Claude conversation closed before its first turn named it has no ref, so it is here.\n      closing: false,\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `noteFor`'s closing arm was in the
        # deleted `closed-threads.ts`, together with the separate Closed conversations rail that
        # drew it. The commit removes the open / closed / kept-open split and every sentence about a
        # running process; the killer render test is deleted. Its anchor is left stale, so the
        # census records it retired.
        'M38 · R62 · the closing arm of noteFor is dead — killed by `a-row-still-closing-says-so.render.test.ts`',
        [(CLOSED_THREADS, "  if (row.closing) {\n    if (row.gesture === 'reopen') {\n", "  if (row.closing && row.reopening) {\n    if (row.gesture === 'reopen') {\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The 'reopen waits' promise on a row's
        # gesture belonged to the closed-thread rows and the Reopen press, both removed. The commit
        # says "no Reopen / Take it over / Read the recording presses: one press, 'Open the
        # conversation'", so there is no reopen gesture left to promise a wait on. Its anchor is
        # left stale, so the census records it retired.
        'M39 · R62 · the wait is promised on a row with no reopen — killed by `a-row-still-closing-says-so.render.test.ts`',
        [(CLOSED_THREADS, "    if (row.gesture === 'reopen') {\n      return {\n        note: STILL_CLOSING_NOTE,\n", '    if (row.gesture !== null) {\n      return {\n        note: STILL_CLOSING_NOTE,\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `STILL_CLOSING_FACE`, the rail's short
        # face for a closing closed-thread row, went with `closed-threads.ts`. Its killer
        # `dom/a-row-still-closing-says-so.dom.test.ts` is deleted. The rail is now one
        # Conversations list with a shared state word, and no row says whether a process is closing.
        # Its anchor is left stale, so the census records it retired.
        'M40 · R62 · the rail gets no short face (the long note leads the line) — killed by `a-row-still-closing-says-so.dom.test.ts`',
        [(CLOSED_THREADS, '        face: STILL_CLOSING_FACE,\n      }\n    }\n', '      }\n    }\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The hover title `STILL_CLOSING_WHY`
        # plus `A_REOPEN_WAITS` was built in the deleted `closed-threads.ts`. D-017b retired the
        # sentence with the field (`05` rule 5, 'no sentence says whether a process runs'). Its
        # anchor is left stale, so the census records it retired.
        'M41 · R62 · the hover loses the wait — killed by `a-row-still-closing-says-so.render.test.ts`',
        [(CLOSED_THREADS, '        title: `${STILL_CLOSING_WHY} ${A_REOPEN_WAITS}`,\n', '        title: STILL_CLOSING_WHY,\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The refused-closing-row hover is a
        # `closed-threads.ts` `noteFor` arm, and that file is deleted. The refusal that survives, at
        # the new `look` door and `startAndSend`, is a different surface. The 'still closing'
        # sentence it planted on is retired by D-017b (`05` rule 5). Its anchor is left stale, so
        # the census records it retired.
        'M42 · R62 · a refused closing row loses its refusal from the hover — killed by `a-row-still-closing-says-so.render.test.ts`',
        [(CLOSED_THREADS, '    return { note: STILL_CLOSING, title: `${STILL_CLOSING_WHY}${refused}` }\n', '    return { note: STILL_CLOSING, title: STILL_CLOSING_WHY }\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `STILL_CLOSING_NOTE` was exported from
        # the deleted `closed-threads.ts` and drawn only on a closing closed-thread row. Both the
        # note and the row are gone, and the killer render test is deleted. Its anchor is left
        # stale, so the census records it retired.
        'M43 · R62 · a refused closing row promises the wait in its note — killed by `a-row-still-closing-says-so.render.test.ts`',
        [(CLOSED_THREADS, '    return { note: STILL_CLOSING, title: `${STILL_CLOSING_WHY}${refused}` }\n', '    return { note: STILL_CLOSING_NOTE, title: `${STILL_CLOSING_WHY}${refused}` }\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Closing outranking a failed or
        # in-flight reopen press was `noteFor`'s ordering in the deleted `closed-threads.ts`. The
        # Reopen press, its failure note and the closing note are all removed by D-017b, so there is
        # no ordering left to plant against. Its anchor is left stale, so the census records it
        # retired.
        'M44 · R62 · closing outranks a press just made (failed or in-flight reopen) — killed by `a-row-still-closing-says-so.render.test.ts`',
        [(CLOSED_THREADS, '  if (row.failure !== null && !row.reopening) return { note: row.failure, title: row.failure }\n', "  if (row.closing && row.gesture === 'reopen')\n    return { note: STILL_CLOSING_NOTE, title: '', face: STILL_CLOSING_FACE }\n  if (row.failure !== null && !row.reopening) return { note: row.failure, title: row.failure }\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The rail-width limit on the
        # still-closing face concerned `STILL_CLOSING_FACE` in the deleted `closed-threads.ts`. Its
        # dom killer is deleted, and no rail row carries a closing face any more. Its anchor is left
        # stale, so the census records it retired.
        "M45 · R62 · a face too long for the rail's real widths — killed by `a-row-still-closing-says-so.dom.test.ts`",
        [(CLOSED_THREADS, 'export const STILL_CLOSING_FACE = `${STILL_CLOSING} · reopen waits`\n', 'export const STILL_CLOSING_FACE = `${STILL_CLOSING} · a reopen waits for the close to finish`\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The ruled word 'still closing' was
        # `STILL_CLOSING` in the deleted `closed-threads.ts`. D-017b removed every sentence about
        # whether a process runs, and the word is a process fact. Its only killer test is deleted.
        # Its anchor is left stale, so the census records it retired.
        "M46 · R62 · the ruled word 'still closing' changes — killed by `a-row-still-closing-says-so.render.test.ts`",
        [(CLOSED_THREADS, "export const STILL_CLOSING = 'still closing'\n", "export const STILL_CLOSING = 'closing'\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `RESUME_WAITS` (the Sessions page's
        # 'Resume waits…' line) was in the deleted `closed-threads.ts`. Its only importer, the
        # `closing` lines in `ResumableSessions.vue`, was removed in the same commit, and the Resume
        # press is now the one 'Open the conversation' press. Its anchor is left stale, so the
        # census records it retired.
        "M47 · R62 · the Sessions page's wait drops the word Resume — killed by `a-row-still-closing-says-so.render.test.ts`",
        [(CLOSED_THREADS, "export const RESUME_WAITS = 'Resume waits for the close to finish.'\n", "export const RESUME_WAITS = 'It waits for the close to finish.'\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `A_REOPEN_WAITS` was in the deleted
        # `closed-threads.ts` and was used only by the closed-thread hover. That hover and the
        # Reopen press are removed by D-017b. Its anchor is left stale, so the census records it
        # retired.
        "M48 · R62 · the rail's wait sentence says something else — killed by `a-row-still-closing-says-so.render.test.ts`",
        [(CLOSED_THREADS, "export const A_REOPEN_WAITS = 'A reopen waits for the close to finish.'\n", "export const A_REOPEN_WAITS = 'A reopen may be refused.'\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `STILL_CLOSING_NOTE`, the palette's
        # closing note, was in the deleted `closed-threads.ts`. The palette now lists one
        # Conversations list with the shared state word, and the killer render test is deleted. Its
        # anchor is left stale, so the census records it retired.
        "M49 · R62 · the palette's note loses the wait — killed by `a-row-still-closing-says-so.render.test.ts`",
        [(CLOSED_THREADS, 'export const STILL_CLOSING_NOTE = `${STILL_CLOSING} — a reopen waits for the close to finish`\n', 'export const STILL_CLOSING_NOTE = STILL_CLOSING\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The `resumable-closing-<id>` line was
        # deleted from `ResumableSessions.vue`, which is why `count_now` is 0. The `closing` field
        # it read is gone from `ResumableSessionInfo`, and the killer
        # `a-row-still-closing-says-so.dom.test.ts` is deleted. D-017b: "still closing is a sentence
        # about a process, and the window says none". Its anchor is left stale, so the census
        # records it retired.
        'M50 · R62 · the Sessions page draws no closing line on the resumable half — killed by `a-row-still-closing-says-so.dom.test.ts`',
        [(RESUMABLESESSIONS, '          v-if="session.closing === true"\n          class="muted row-error"\n          :data-cy="`resumable-closing-${session.sessionId}`"\n', '          v-if="false"\n          class="muted row-error"\n          :data-cy="`resumable-closing-${session.sessionId}`"\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Reading a missing `closing` as true
        # planted on the removed `session.closing === true` line in `ResumableSessions.vue`. The
        # field is removed from the wire, and the rewritten
        # `a-conversation-still-closing-keeps-resume.test.ts` now asserts the row has no `closing`
        # property at all. Its anchor is left stale, so the census records it retired.
        'M51 · R62 · the Sessions page reads a missing field as closing — killed by `a-row-still-closing-says-so.dom.test.ts`',
        [(RESUMABLESESSIONS, '          v-if="session.closing === true"\n          class="muted row-error"\n          :data-cy="`resumable-closing-${session.sessionId}`"\n', '          v-if="session.closing !== false"\n          class="muted row-error"\n          :data-cy="`resumable-closing-${session.sessionId}`"\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The line 'STILL_CLOSING_WHY
        # RESUME_WAITS' was removed from `ResumableSessions.vue` along with the `closing` block, and
        # both constants went with `closed-threads.ts`. The Sessions page draws no closing sentence,
        # by D-017b (`05` rule 5). Its anchor is left stale, so the census records it retired.
        'M52 · R62 · the Sessions page never says Resume waits — killed by `a-row-still-closing-says-so.dom.test.ts`',
        [(RESUMABLESESSIONS, '          {{ session.resumeRefusal ? STILL_CLOSING_WHY : `${STILL_CLOSING_WHY} ${RESUME_WAITS}` }}\n', '          {{ STILL_CLOSING_WHY }}\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** This plants the wait sentence beside a
        # Resume press on the removed `closing` block of `ResumableSessions.vue`. The block, the
        # constants, the field and the killer dom test are all removed, and the press is now 'Open
        # the conversation'. Its anchor is left stale, so the census records it retired.
        'M53 · R62 · the Sessions page says the wait beside no Resume — killed by `a-row-still-closing-says-so.dom.test.ts`',
        [(RESUMABLESESSIONS, '          {{ session.resumeRefusal ? STILL_CLOSING_WHY : `${STILL_CLOSING_WHY} ${RESUME_WAITS}` }}\n', '          {{ `${STILL_CLOSING_WHY} ${RESUME_WAITS}` }}\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The unresumable half's
        # `unresumable-closing-<id>` line was deleted from `ResumableSessions.vue`, and
        # `UnresumableSessionInfo.closing` is gone from the wire. The card says no sentence may say
        # whether anything is running (`05` rule 5). Its anchor is left stale, so the census records
        # it retired.
        'M54 · R62 · the unresumable half draws no closing line — killed by `a-row-still-closing-says-so.dom.test.ts`',
        [(RESUMABLESESSIONS, '          v-if="session.closing === true"\n          class="muted row-error"\n          :data-cy="`unresumable-closing-${session.sessionId}`"\n        >\n          {{ STILL_CLOSING_WHY }}\n', '          v-if="false"\n          class="muted row-error"\n          :data-cy="`unresumable-closing-${session.sessionId}`"\n        >\n          {{ STILL_CLOSING_WHY }}\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Promising a Resume the unresumable
        # half lacks was a defect in the `closing` line of `ResumableSessions.vue`, which is
        # deleted. `STILL_CLOSING_WHY` and `RESUME_WAITS` no longer exist, and the killer dom test
        # is deleted with the 'reduced' presses. Its anchor is left stale, so the census records it
        # retired.
        'M55 · R62 · the unresumable half promises a Resume it does not have — killed by `a-row-still-closing-says-so.dom.test.ts`',
        [(RESUMABLESESSIONS, '          v-if="session.closing === true"\n          class="muted row-error"\n          :data-cy="`unresumable-closing-${session.sessionId}`"\n        >\n          {{ STILL_CLOSING_WHY }}\n', '          v-if="session.closing === true"\n          class="muted row-error"\n          :data-cy="`unresumable-closing-${session.sessionId}`"\n        >\n          {{ `${STILL_CLOSING_WHY} ${RESUME_WAITS}` }}\n')],
    ),
    # ── R54’s second half — a giver told it started again ───────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # Table 725 plants the started-again lead on the stalled-work band (persons-queue.ts
        # toldItStartedAgain / TOLD_IT_STARTED_AGAIN), which was deleted; stalledWorkLead now
        # returns only the "has not been told" sentence. Commit 8d54d6dc: "Gone with it: ... the two
        # R54 leads on the stalled-work band" and "4 go with their subject (the kept-open notice,
        # the started-again lead drawn and in the DOM, a correction drawn as a wait)". Both killers
        # (a-giver-told-it-started-again.render.test.ts and
        # test/dom/a-giver-told-it-started-again.dom.test.ts) are deleted. Its anchor is left stale,
        # so the census records it retired.
        'M56 · 725 R54 · the lead reads toldItStartedAgain (arm deleted) — killed by `a-giver-told-it-started-again.render.test.ts`',
        [(PERSONS_QUEUE, '  if (work.toldItStartedAgain === true) return aGiverToldItStartedAgainLeads(work)\n', '')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The started-again lead code (toldItStartedAgain / TOLD_IT_STARTED_AGAIN* in
        # persons-queue.ts) is gone, so the plant has no subject. Commit 8d54d6dc: "Gone with it:
        # ... the two R54 leads on the stalled-work band"; "4 go with their subject (... the
        # started-again lead drawn and in the DOM ...)". Its render and DOM killer files were
        # deleted in the same commit. Its anchor is left stale, so the census records it retired.
        'M57 · 725 R54 · the read is === true (a cast row without the field keeps the old sentence) — killed by `a-giver-told-it-started-again.render.test.ts`',
        [(PERSONS_QUEUE, '  if (work.toldItStartedAgain === true) return aGiverToldItStartedAgainLeads(work)\n', '  if (work.toldItStartedAgain !== false) return aGiverToldItStartedAgainLeads(work)\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # This row plants the deleted started-again lead in persons-queue.ts, which no longer exists
        # after "the two R54 leads on the stalled-work band" were removed in 8d54d6dc. The killers
        # (a-giver-told-it-started-again.render.test.ts,
        # test/dom/a-giver-told-it-started-again.dom.test.ts) are among the "4 go with their
        # subject" and no longer exist. Nothing else asserts the deleted wording. Its anchor is left
        # stale, so the census records it retired.
        "M58 · 725 R54 · the quit pairing dropped (R54's plain words for the quit subset too) — killed by `a-giver-told-it-started-again.render.test.ts`",
        [(PERSONS_QUEUE, "    work.holderKeptOpen === true && work.because === 'conversation_ended'\n", '    false\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The subject (the started-again lead wording/selection in stalledWorkLead) was deleted by
        # design: "Gone with it: ... the two R54 leads on the stalled-work band" (8d54d6dc). The
        # killing render and DOM tests were removed with it ("the started-again lead drawn and in
        # the DOM"), so a re-anchor would have no test to kill it. Its anchor is left stale, so the
        # census records it retired.
        "M59 · 725 R54 · the pairing's holderKeptOpen conjunct dropped — killed by `a-giver-told-it-started-again.render.test.ts`",
        [(PERSONS_QUEUE, "    work.holderKeptOpen === true && work.because === 'conversation_ended'\n", "    work.because === 'conversation_ended'\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The plant targets code in the removed started-again lead (persons-queue.ts), which is
        # gone: stalledWorkLead now has a single "has not been told" branch. Commit message: "the
        # two R54 leads on the stalled-work band" are gone and "4 go with their subject (... the
        # started-again lead drawn and in the DOM ...)". Killer files no longer exist. Its anchor is
        # left stale, so the census records it retired.
        "M60 · 725 R54 · the pairing's cause conjunct dropped (only §2's impossible-world cell kills it; no host row can) — killed by `a-giver-told-it-started-again.render.test.ts`",
        [(PERSONS_QUEUE, "    work.holderKeptOpen === true && work.because === 'conversation_ended'\n", '    work.holderKeptOpen === true\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # Same subject as the rest of 725: the started-again lead on the stalled-work band and its
        # `toldItStartedAgain` input were removed on purpose in 8d54d6dc ("the two R54 leads on the
        # stalled-work band"). Its killers a-giver-told-it-started-again.render.test.ts and the dom
        # test were deleted ("4 go with their subject"). Its anchor is left stale, so the census
        # records it retired.
        'M61 · 725 R54 · the two tellings swapped — killed by `a-giver-told-it-started-again.render.test.ts`',
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The ternary in
        # `aGiverToldItStartedAgainLeads` is unchanged in shape; only the constant was renamed
        # (`TOLD_IT_STARTED_AGAIN_BEFORE_THE_QUIT` → `TOLD_IT_STARTED_AGAIN_BEFORE_IT_STOPPED`,
        # D-017 R2 generalizing quit to any stop). Swapping the two branches is the same 'two
        # tellings swapped' defect, still killed by explicit literal assertions in the test for both
        # arms.
        [
            (PERSONS_QUEUE, '      ? TOLD_IT_STARTED_AGAIN_BEFORE_IT_STOPPED\n      : TOLD_IT_STARTED_AGAIN\n', '      ? TOLD_IT_STARTED_AGAIN\n      : TOLD_IT_STARTED_AGAIN_BEFORE_IT_STOPPED\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The rule this row guards (the lead is drawn for a giver that was told the work started
        # again) has no code left: the started-again lead was deleted with the kept-open / set-right
        # receipts ("Gone with it: ... the two R54 leads on the stalled-work band", "every
        # set-right, correction and wake take-back"). The DOM/render killers are deleted. Its anchor
        # is left stale, so the census records it retired.
        'M62 · 725 R54 · the ruled words cut — killed by `a-giver-told-it-started-again.render.test.ts`',
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — `TOLD_IT_STARTED_AGAIN`
        # still exists and is still asserted verbatim by the render test; only its text changed from
        # '...not told it has ended since' to '...not told what stopped it since' (the file's own
        # comment: 'D-017 · °05 rule 2 — R54 said "...not told it has ended since", and nothing ends
        # a conversation'). The row's defect — dropping the qualifying clause — re-plants cleanly on
        # the reworded string.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — R54's rule survives: the
        # giver's lead must say what the giver was NOT told (the second clause). D-017b only
        # reworded it in place to 'told it took the work up again; not told what held it up since'
        # (no process words), and the render test still pins it verbatim. The constant is now split
        # over two lines by prettier, so the edit anchors on the two-line form. The dom test
        # `dom/a-giver-told-it-started-again.dom.test.ts` also goes red.
        [
            (PERSONS_QUEUE, "export const TOLD_IT_STARTED_AGAIN =\n  'told it took the work up again; not told what held it up since'\n", "export const TOLD_IT_STARTED_AGAIN =\n  'told it took the work up again'\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The plant lives in the deleted started-again lead of persons-queue.ts, whose whole call
        # graph was removed in 8d54d6dc ("the two R54 leads on the stalled-work band"; "the
        # started-again lead drawn and in the DOM" tests go with their subject). No test remains
        # that could kill a re-anchored version. Its anchor is left stale, so the census records it
        # retired.
        "M63 · 725 R54 · the quit subset's words lose the quit — killed by `a-giver-told-it-started-again.render.test.ts`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Same rename as M61: the
        # constant is now `TOLD_IT_STARTED_AGAIN_BEFORE_IT_STOPPED = \`told it started again; not
        # told ${IT_HAS_STOPPED}\``. Replacing the dynamic `${IT_HAS_STOPPED}` reference with
        # hardcoded words borrowed from the other constant is the same 'stopped subset's words lose
        # the stop' defect, still pinned verbatim by the test.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The quit / idle subset's
        # words still exist as `TOLD_IT_STARTED_AGAIN_BEFORE_IT_STOPPED`, reworded by D-017b to
        # 'told it took the work up again; not told it went idle'. The render test pins it verbatim
        # and against `IDLE`. The plant swaps the idle clause for R54's old 'has ended' words, which
        # is the same 'subset's words lose the stop' defect. The label is kept as is (it keys the
        # recorded run); the 'quit' in it now means 'idle', which a `#` comment can say.
        [
            (PERSONS_QUEUE, "export const TOLD_IT_STARTED_AGAIN_BEFORE_IT_STOPPED =\n  'told it took the work up again; not told it went idle'\n", "export const TOLD_IT_STARTED_AGAIN_BEFORE_IT_STOPPED =\n  'told it took the work up again; not told it has ended since'\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # Last of the 725 rows on the started-again lead: the lead and every helper it used
        # (TOLD_IT_STARTED_AGAIN*, the toldItStartedAgain input) were deleted on purpose, per "the
        # two R54 leads on the stalled-work band" and "4 go with their subject (... the
        # started-again lead drawn and in the DOM ...)" in 8d54d6dc. Both killer files no longer
        # exist. Its anchor is left stale, so the census records it retired.
        "M64 · 725 R54 · the sentence's verb (was → has been) — killed by `a-giver-told-it-started-again.dom.test.ts`",
        [(PERSONS_QUEUE, '— which gave it out — was ${told}.`', '— which gave it out — has been ${told}.`')],
    ),
    # ── `716` F-1 — a refusal that said why is not asked about again ────────────────────────────────────
    (
        'M65 · 725 716 F-1 · the store asks for the word — killed by `a-refusal-that-said-why-is-not-asked-again.test.ts`',
        [(SESSION_STORE, 'bridge.createSession({ ...input, launchKey, answerARefusal: true })', 'bridge.createSession({ ...input, launchKey })')],
    ),
    (
        'M66 · 725 716 F-1 · an answered refusal is thrown back into forLaunch — killed by `a-refusal-that-said-why-is-not-asked-again.test.ts`',
        [(SESSION_STORE, '            throw new AnsweredRefusal(answer.refused.reason, answer.refused.said)\n', '            return null as never\n')],
    ),
    (
        "M67 · 725 716 F-1 · the sentence is main's said, byte for byte — killed by `a-refusal-that-said-why-is-not-asked-again.test.ts`",
        [(SESSION_STORE, '    super(said)\n', '    super(reason)\n')],
    ),
    (
        'M68 · 725 716 F-1 · cancelled is a Cancel — killed by `a-refusal-that-said-why-is-not-asked-again.test.ts`',
        [(SESSION_STORE, "      if (answered === 'cancelled') return undefined\n", '')],
    ),
    (
        'M69 · 725 716 F-1 · the word is written — killed by `a-refusal-that-said-why-is-not-asked-again.test.ts`',
        [(SESSION_STORE, '        if (gesture === NEW_LAUNCH && inFlight.get(gesture) === key) launchRefusal.value = answered\n', '        if (gesture === NEW_LAUNCH && inFlight.get(gesture) === key) launchRefusal.value = null\n')],
    ),
    (
        "M70 · 725 716 F-1 · the word is the front door's only (the sheet's is not) — killed by `a-refusal-that-said-why-is-not-asked-again.test.ts`",
        [(SESSION_STORE, '        if (gesture === NEW_LAUNCH && inFlight.get(gesture) === key) launchRefusal.value = answered\n', '        if (inFlight.get(gesture) === key) launchRefusal.value = answered\n')],
    ),
    (
        "M71 · 725 716 F-1 · the word is the current launch's only — killed by `a-refusal-that-said-why-is-not-asked-again.test.ts`",
        [(SESSION_STORE, '        if (gesture === NEW_LAUNCH && inFlight.get(gesture) === key) launchRefusal.value = answered\n', '        if (gesture === NEW_LAUNCH) launchRefusal.value = answered\n')],
    ),
    (
        'M72 · 725 716 F-1 · the word is cleared on every attempt — killed by `a-refusal-that-said-why-is-not-asked-again.test.ts`',
        [(SESSION_STORE, '    launchRefusal.value = null\n', '')],
    ),
    (
        'M73 · 725 716 F-1 · the screen hands the launcher the word — killed by `a-refusal-that-said-why-is-not-asked-again.test.ts`',
        [(RUNTIMESCREEN, '          :refused-as="store.launchRefusal.value"\n', '')],
    ),
    (
        "M74 · 725 716 F-1 · the launcher's watch never reads the word (the check runs after every failure, as on main) — killed by `a-refusal-that-said-why-is-not-asked-again.dom.test.ts`",
        [(NEWCONVERSATION, '    lastSaidWhy = !theCheckCanSayMore(props.refusedAs)\n', '    lastSaidWhy = false\n')],
    ),
    (
        'M75 · 725 716 F-1 · sign-in keeps the check — killed by `a-refusal-that-said-why-is-not-asked-again.dom.test.ts`',
        [(NEWCONVERSATION, "  return refusedAs == null || refusedAs === 'sign-in'\n", '  return refusedAs == null\n')],
    ),
    (
        'M76 · 725 716 F-1 · no word (absent as well as null) keeps the check — killed by `a-refusal-that-said-why-is-not-asked-again.dom.test.ts`',
        [(NEWCONVERSATION, "  return refusedAs == null || refusedAs === 'sign-in'\n", "  return refusedAs === null || refusedAs === 'sign-in'\n")],
    ),
    (
        'M77 · 725 716 F-1 · an earlier *could not check* is left up under the refusal (and asked again) — killed by `a-refusal-that-said-why-is-not-asked-again.dom.test.ts`',
        [(NEWCONVERSATION, "    if (authState.value?.state === 'unknown') {\n      authState.value = null\n      return\n    }\n", '')],
    ),
    (
        "M78 · 725 716 F-1 · a person's gesture in flight loses its panel to the drop — killed by `a-refusal-that-said-why-is-not-asked-again.dom.test.ts`",
        [(NEWCONVERSATION, "    //  - *usable* draws nothing, so nothing is asked (review, round three).\n    if (authBusy.value !== 'idle') return\n", '    //  - *usable* draws nothing, so nothing is asked (review, round three).\n')],
    ),
    (
        'M79 · 725 review · an earlier *expired* / *not signed in* is left up unasked (the provider never asked again) — killed by `a-refusal-that-said-why-is-not-asked-again.dom.test.ts`',
        [(NEWCONVERSATION, "    if (authState.value !== null && authState.value.state !== 'usable') void checkAuth(true)\n", '')],
    ),
    (
        "M80 · 725 review · an automatic *could not check* after a refusal that said why is drawn — `710` F-7's second box — killed by `a-refusal-that-said-why-is-not-asked-again.dom.test.ts`",
        [(NEWCONVERSATION, "    automatic && lastSaidWhy && said.state === 'unknown' ? null : said\n", '    said\n')],
    ),
    (
        "M81 · 725 review · a person's own *Check again* is dropped too when it could not check — killed by `a-refusal-that-said-why-is-not-asked-again.dom.test.ts`",
        [(NEWCONVERSATION, "    automatic && lastSaidWhy && said.state === 'unknown' ? null : said\n", "    lastSaidWhy && said.state === 'unknown' ? null : said\n")],
    ),
    (
        "M82 · 725 review · the first refusal that said why decides for every later failure (a later no-word or `sign-in` loses its check's answer) — killed by `a-refusal-that-said-why-is-not-asked-again.dom.test.ts`",
        [(NEWCONVERSATION, '    lastSaidWhy = !theCheckCanSayMore(props.refusedAs)\n', '    lastSaidWhy = lastSaidWhy || !theCheckCanSayMore(props.refusedAs)\n')],
    ),
    (
        'M83 · 725 review · a hidden *usable* is asked again after a refusal that said why (the check `716` F-1 skips) — killed by `a-refusal-that-said-why-is-not-asked-again.dom.test.ts`',
        [(NEWCONVERSATION, "    if (authState.value !== null && authState.value.state !== 'usable') void checkAuth(true)\n", '    if (authState.value !== null) void checkAuth(true)\n')],
    ),
    # ── `711` GAP-1 · `701` F-4 — a conversation the quit left open, everywhere ─────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The card removes the kept-open
        # population: 'no open / closed / kept-open split'. `keptOpenAcrossAQuit` is gone from every
        # src type and `project-roster.ts` no longer has a `keptOpen` local, so there is nothing for
        # `!== false` to misread. The test was deliberately re-aimed at 'ANY conversation nothing
        # runs'. Its anchor is left stale, so the census records it retired.
        'M84 · 725-d6 roster · the field read !== false, so a double without it reads kept open — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`',
        [(PROJECT_ROSTER, '  const keptOpen = row.keptOpenAcrossAQuit === true\n', '  const keptOpen = row.keptOpenAcrossAQuit !== false\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The 'Reopen' and 'Read' presses are
        # deliberately removed: 'no Reopen / Take it over / Read the recording presses: one press,
        # "Open the conversation"'. `rowOf` now sets `action: OPEN_THE_CONVERSATION`
        # unconditionally, so there is no reopen/read gesture or kept-open branch left to plant. Its
        # anchor is left stale, so the census records it retired.
        'M85 · 725-d6 roster · a kept-open row that cannot reopen is pressed as an open (its Read lost) — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`',
        [(PROJECT_ROSTER, "    action: keptOpen && gesture === 'reopen' ? openingAction(true) : actionFor(gesture),\n", '    action: keptOpen ? openingAction(true) : actionFor(gesture),\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `started` was removed from
        # `SessionFacetInput` and the `unstarted` standing and `Not started` label were deleted from
        # agent-state.ts. The commit says 'no sentence says whether a process runs', so a 'plate is
        # not started' defect no longer exists on any surface. Its anchor is left stale, so the
        # census records it retired.
        'M86 · 725-d6 roster · the plate is not started — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`',
        [(PROJECT_ROSTER, '    started: !keptOpen,\n', '    started: true,\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The kept-open note is a deliberately
        # removed process sentence. `KEPT_OPEN_WORD` and `kept-open.ts`'s window words are gone, and
        # a row's `says` is now only `OPEN_IN_ANOTHER_WINDOW` when another window holds it. The
        # re-aimed test asserts that no row says 'ended', 'not running' or 'reopen'. Its anchor is
        # left stale, so the census records it retired.
        'M87 · 725-d6 roster · says the kept-open note — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`',
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same rename as M100 —
        # `KEPT_OPEN_NOTE`→`KEPT_OPEN_WORD` — with `project-roster.ts`'s `says: keptOpen ?
        # KEPT_OPEN_WORD : HERE_IS_WORDS[hereIs]` otherwise identical to the original shape.
        [
            (PROJECT_ROSTER, '    says: keptOpen ? KEPT_OPEN_WORD : HERE_IS_WORDS[hereIs],\n', '    says: HERE_IS_WORDS[hereIs],\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row's `keptOpen` field no longer
        # exists on `ProjectRosterRow`. `ProjectRosterRow` now carries `elsewhere`, `says` and
        # `action`, per the removal of the 'open / closed / kept-open split'. The plant anchors on
        # `keptOpen,\n    gesture,`, which the commit deleted. Its anchor is left stale, so the
        # census records it retired.
        'M88 · 725-d6 roster · the row carries keptOpen — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`',
        [(PROJECT_ROSTER, '    keptOpen,\n    gesture,\n', '    keptOpen: false,\n    gesture,\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The plain open versus the kept-open
        # open is no longer a distinction. The commit collapses it to 'one press, "Open the
        # conversation"' and `gesture` / `actionFor` are deleted. Any plant on `action` now would be
        # a different defect, not this label's. Its anchor is left stale, so the census records it
        # retired.
        'M89 · 725-d6 roster · the plain open for a kept-open row — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`',
        [(PROJECT_ROSTER, "    action: keptOpen && gesture === 'reopen' ? openingAction(true) : actionFor(gesture),\n", '    action: actionFor(gesture),\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The `v-if="!row.keptOpen"` guard on
        # the room's standing chip was deleted on purpose. The chip is now drawn on every row, and
        # the re-aimed dom test asserts `visible(chip)` for a row nothing runs. The row's defect, a
        # chip drawn on such a row, is now the decision. Its anchor is left stale, so the census
        # records it retired.
        'M90 · 725-d6 room · no standing chip on a kept-open row — killed by `a-conversation-the-quit-left-open-said-everywhere.dom.test.ts`',
        [(PROJECTWORKSPACE, '                  v-if="!row.keptOpen"\n                  class="roster-standing"\n', '                  class="roster-standing"\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The `v-if="!row.keptOpen"` guard on
        # the Team shelf's `.team-now` chip is gone. The chip is drawn unconditionally, and the
        # re-aimed dom test requires it on 'a row nothing runs'. The kept-open split it guarded was
        # removed by D-017b. Its anchor is left stale, so the census records it retired.
        'M91 · 725-d6 team shelf · no standing chip on a kept-open row — killed by `a-conversation-the-quit-left-open-said-everywhere.dom.test.ts`',
        [(TEAMWORKSPACE, '                              v-if="!row.keptOpen"\n                              class="team-now"\n', '                              class="team-now"\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The shelf note's condition (`hereIs
        # !== 'not-running-in-this-app' || keptOpen`) was replaced by `v-if="row.says"`, which only
        # says 'open in another window'. `hereIs` and `keptOpen` are removed from the row. The 'not
        # running' note is a removed process sentence. Its anchor is left stale, so the census
        # records it retired.
        'M92 · 725-d6 team shelf · the note is said on a kept-open row — killed by `a-conversation-the-quit-left-open-said-everywhere.dom.test.ts`',
        [(TEAMWORKSPACE, 'v-if="row.hereIs !== \'not-running-in-this-app\' || row.keptOpen"', 'v-if="row.hereIs !== \'not-running-in-this-app\'"')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The forest's `started:
        # !leftOpenByTheQuit(node)` and `leftOpenByTheQuit` itself were deleted. `started` no longer
        # exists in the plate input, and the 'unstarted' standing is gone. This is the kept-open
        # plate the commit removed with the population. Its anchor is left stale, so the census
        # records it retired.
        'M93 · 725-d6 forest · the plate is not started — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`',
        [(THE_FOREST, '    started: !leftOpenByTheQuit(node),\n', '    started: true,\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `leftOpenByTheQuit` in the-forest.ts
        # and `ForestConversation.keptOpenAcrossAQuit` are removed. There is no field for `!==
        # false` to misread. The kept-open node is no longer a category on any surface. Its anchor
        # is left stale, so the census records it retired.
        'M94 · 725-d6 forest · the field read !== false — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`',
        [(THE_FOREST, '  return node.keptOpenAcrossAQuit === true\n', '  return node.keptOpenAcrossAQuit !== false\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The `const leftOpen = known ===
        # undefined && leftOpenByTheQuit(node)` line is deleted along with the kept-open node. 668's
        # rule that a node the window holds is drawn from the window's own record still holds
        # through `known`, but this row's defect (a live record not outranking the poll's kept-open
        # flag) has no flag left to plant. Its anchor is left stale, so the census records it
        # retired.
        'M95 · 725-d6 forest · the window’s live record outranks the poll — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`',
        [(THE_FOREST, '    const leftOpen = known === undefined && leftOpenByTheQuit(node)\n', '    const leftOpen = leftOpenByTheQuit(node)\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `says` on a forest conversation row is
        # now unconditionally `STANDING_LABEL[standing]`, and the `leftOpen ? null` and
        # `theAppStoppedUnderIt` arms were deleted. A node nothing runs wears its standing word by
        # decision, and the re-aimed test asserts it. The row's defect is now the decision. Its
        # anchor is left stale, so the census records it retired.
        'M96 · 725-d6 forest · no standing word on a kept-open node — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`',
        # ⚑ **T-002 · re-anchored in place, not retired** — D-007 added a middle arm (a conversation the
        # app stopped under). The row switches off the kept-open test, so a kept-open node wears its
        # standing word again. Re-verified RED alone.
        [(THE_FOREST, '      says: leftOpen\n        ? null\n', '      says: false\n        ? null\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `hereIsSays` and `KEPT_OPEN_WORD` were
        # replaced by `whereSays: elsewhere ? OPEN_IN_ANOTHER_WINDOW : null`. The kept-open sentence
        # is a process sentence the commit removed: 'No sentence says whether a process runs'. Its
        # anchor is left stale, so the census records it retired.
        'M97 · 725-d6 forest · says the kept-open note — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`',
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same rename again, in
        # `the-forest.ts`'s `hereIsSays: leftOpen ? KEPT_OPEN_WORD : HERE_IS_WORDS[hereIs]` —
        # unchanged shape, unaffected by D-017.
        [
            (THE_FOREST, '        hereIsSays: leftOpen ? KEPT_OPEN_WORD : HERE_IS_WORDS[hereIs],\n', '        hereIsSays: HERE_IS_WORDS[hereIs],\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `cardOf` in working-together.ts no
        # longer reads `edge.keptOpenAcrossAQuit`, and the `leftOpen` local is deleted. The cast
        # card carries `elsewhere` instead of `hereIs`, so the kept-open reading has no anchor left.
        # Its anchor is left stale, so the census records it retired.
        'M98 · 725-d6 cast · the field read !== false — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`',
        [(WORKING_TOGETHER, '  const leftOpen = edge.keptOpenAcrossAQuit === true\n', '  const leftOpen = edge.keptOpenAcrossAQuit !== false\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `plateOf` lost its `started`
        # parameter: it is now `plateOf(nothingRunsIt, atWork, at)`, and the 'not started' plate
        # went with the removed kept-open population. The plant's anchor `edge.provider !== null &&
        # !leftOpen,` is deleted. Its anchor is left stale, so the census records it retired.
        'M99 · 725-d6 cast · the plate is not started — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`',
        [(WORKING_TOGETHER, '    edge.provider !== null && !leftOpen,\n', '    edge.provider !== null,\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The cast card no longer has a
        # kept-open word: `cardOf` now says `says: elsewhere ? OPEN_IN_ANOTHER_WINDOW : null`, and
        # `KEPT_OPEN_WORD` / `keptOpenAcrossAQuit` no longer exist anywhere in src. Commit 3af91dcb:
        # "One Conversations list in the rail and the palette… no open / closed / kept-open split"
        # and "No sentence says whether a process runs." Its anchor is left stale, so the census
        # records it retired.
        'M100 · 725-d6 cast · says the kept-open note — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`',
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — `KEPT_OPEN_NOTE` was
        # renamed to `KEPT_OPEN_WORD` (kept-open.ts, value `'open'`) but the exact ternary `leftOpen
        # ? KEPT_OPEN_WORD : HERE_IS_WORDS[hereIs]` still drives `working-together.ts`'s `says`. The
        # rule (a kept-open row must say the kept-open word) is untouched; only the constant's name
        # moved, unrelated to D-017.
        [
            (WORKING_TOGETHER, '    says: leftOpen ? KEPT_OPEN_WORD : HERE_IS_WORDS[hereIs],\n', '    says: HERE_IS_WORDS[hereIs],\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `workIsWith` is now `(report, held)`
        # with a single return; the `keptOpen` parameter and its arm are deleted, and the killer
        # test's §4 asserts the lib has no `holderKeptOpen` and hands one press for every holder.
        # Removed on purpose: "no kept-open pane… one press, 'Open the conversation'". Its anchor is
        # left stale, so the census records it retired.
        'M101 · 725-d6 link · held wins over the kept-open list — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`',
        [(WHERE_THE_WORK_IS, '  if (!mine && keptOpen?.has(conversation) === true) {\n', '  if (keptOpen?.has(conversation) === true) {\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Same subject as M101: the kept-open
        # list argument to `workIsWith` is gone, so "an absent list is not a kept-open one" has
        # nothing to plant on. The commit removed the kept-open population, not just its words. Its
        # anchor is left stale, so the census records it retired.
        'M102 · 725-d6 link · an absent list is not a kept-open one — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`',
        [(WHERE_THE_WORK_IS, '  if (!mine && keptOpen?.has(conversation) === true) {\n', '  if (!mine && keptOpen?.has(conversation) !== false) {\n')],
    ),
    (
        'M103 · 725-d6 link · the plain open’s words — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`',
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The label's rule (a
        # report's link to a holder says the plain open's words) survives as D-017b's decision:
        # `workIsWith` returns `action: OPEN_THE_CONVERSATION` for every holder, one line, and the
        # killer test's §4 pins it (`toEqual({... action: OPEN_THE_CONVERSATION})` for a holder the
        # window does not hold). The plant puts the old take-over words back on a holder this window
        # does not run, which is the defect the row planted, on the only line left. Label wording
        # still fits; nothing else in the tables plants this line (506 M3/M4/M7 are dark and about
        # the deleted fork).
        [
            (WHERE_THE_WORK_IS, '  return { conversation, held: held.has(conversation), action: OPEN_THE_CONVERSATION }\n', "  return {\n    conversation,\n    held: held.has(conversation),\n    action: held.has(conversation) ? OPEN_THE_CONVERSATION : 'Take it over and open it',\n  }\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `outgoingCard(item, words, identities,
        # held)` no longer takes a kept-open list, so the reply arm cannot 'read the list'; today's
        # arm is `workIsWith({ assignedTo: reply.toConversation }, held)`. The kept-open population
        # was removed on purpose (commit: "no open / closed / kept-open split"). Its anchor is left
        # stale, so the census records it retired.
        'M104 · 725-d6 outgoing · the reply arm reads the list — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`',
        [(OUTGOING_CARD, '          : workIsWith({ assignedTo: reply.toConversation }, held, keptOpen),\n', '          : workIsWith({ assignedTo: reply.toConversation }, held),\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Same as M104 for the message arm: the
        # `keptOpen` argument was deleted from `outgoingCard` and from `workIsWith`. The arm's
        # hand-off of `held` has no live row, but that is a new rule for a new row, not this label.
        # Its anchor is left stale, so the census records it retired.
        'M105 · 725-d6 outgoing · the message arm reads the list — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`',
        [(OUTGOING_CARD, '    where: sent === null ? null : workIsWith({ assignedTo: sent.toConversation }, held, keptOpen),\n', '    where: sent === null ? null : workIsWith({ assignedTo: sent.toConversation }, held),\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `WorkReportEntry` now calls
        # `workIsWith(props.item.report, props.held ?? null)`; the `keptOpen` prop and its hop are
        # deleted. The killer test's §6 now asserts the list is absent from every hop ("held travels
        # alone"), so the row's subject was removed on purpose. Its anchor is left stale, so the
        # census records it retired.
        'M106 · 725-d6 hop · the report entry hands its lib the list — killed by `a-conversation-the-quit-left-open-said-everywhere.dom.test.ts`',
        [(WORKREPORTENTRY, '  workIsWith(props.item.report, props.held ?? null, props.keptOpen ?? null),\n', '  workIsWith(props.item.report, props.held ?? null, null),\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `OutgoingEntry` no longer takes or
        # hands a `keptOpen` argument (its `outgoingCard` call ends at `props.held ?? null`), and
        # the killer test regexes that exact call. The hop the row cut was removed with the
        # kept-open list. Its anchor is left stale, so the census records it retired.
        'M107 · 725-d6 hop · the outgoing entry hands its lib the list — killed by `a-conversation-the-quit-left-open-said-everywhere.dom.test.ts`',
        [(OUTGOINGENTRY, '    props.keptOpen ?? null,\n', '    null,\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `TranscriptView` has no `keptOpen`
        # prop and no `keptOpenIds` computed any more (commit diff deletes both). Nothing remains to
        # plant "builds the set from the prop" on. Its anchor is left stale, so the census records
        # it retired.
        'M108 · 725-d6 hop · the transcript builds the set from the prop — killed by `a-conversation-the-quit-left-open-said-everywhere.dom.test.ts`',
        [(TRANSCRIPTVIEW, '  props.keptOpen === undefined ? null : new Set(props.keptOpen),\n', '  props.keptOpen === undefined ? null : new Set<string>(),\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `TranscriptView` no longer passes
        # `:kept-open` to `WorkReportEntry`; the killer test asserts `not.toContain(':kept-open=')`
        # on that tag. The hop is gone on purpose. Its anchor is left stale, so the census records
        # it retired.
        'M109 · 725-d6 hop · the transcript hands the report entry the set — killed by `a-conversation-the-quit-left-open-said-everywhere.dom.test.ts`',
        [(TRANSCRIPTVIEW, '          :own-agent="props.ownAgent ?? null"\n          :kept-open="keptOpenIds"\n', '          :own-agent="props.ownAgent ?? null"\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `TranscriptView` no longer passes
        # `:kept-open` to `OutgoingEntry`; the killer test asserts its absence. The hop is gone on
        # purpose. Its anchor is left stale, so the census records it retired.
        'M110 · 725-d6 hop · the transcript hands the outgoing entry the set — killed by `a-conversation-the-quit-left-open-said-everywhere.dom.test.ts`',
        [(TRANSCRIPTVIEW, '          :held="heldIds"\n          :kept-open="keptOpenIds"\n', '          :held="heldIds"\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `ConversationPane` no longer forwards
        # `:kept-open` to its transcript, and the killer test asserts `codeOf(pane)` contains no
        # `keptOpen`. The line the row deleted no longer exists. Its anchor is left stale, so the
        # census records it retired.
        'M111 · 725-d6 hop · the pane forwards the list to its transcript — killed by `a-conversation-the-quit-left-open-said-everywhere.dom.test.ts`',
        [(CONVERSATIONPANE, '          :kept-open="props.keptOpen"\n', '')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `RuntimeScreen` no longer hands
        # `ConversationPane` a kept-open list (`SideRail` has no `keptOpenIds` either); the test
        # asserts the tag has `:held="heldHere"` and no `:kept-open=`. Removed by "no kept-open
        # pane… one Conversations list". Its anchor is left stale, so the census records it retired.
        'M112 · 725-d6 hop · the screen hands the pane the rail’s list — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`',
        [(RUNTIMESCREEN, '          :kept-open="rail?.keptOpenIds ?? []"\n', '')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The room no longer emits
        # `openKeptOpen` and its rows carry no `keptOpen` field; one press raises `open` for every
        # row. Commit 3af91dcb: "no Reopen / Take it over / Read the recording presses: one press,
        # 'Open the conversation'". Its anchor is left stale, so the census records it retired.
        'M113 · 725 review · the room presses a row that SAID open into a Reopen — killed by `a-conversation-the-quit-left-open-said-everywhere.dom.test.ts`',
        [(PROJECTWORKSPACE, "      if (row.keptOpen) return emit('openKeptOpen', row.conversation)\n", '')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The Team shelf's `reopen` case and
        # `openKeptOpen` emit are gone with the Reopen press; every shelf row raises the one open.
        # Removed on purpose, per the commit's one-press line. Its anchor is left stale, so the
        # census records it retired.
        'M114 · 725 review · the Team shelf presses a row that SAID open into a Reopen — killed by `a-conversation-the-quit-left-open-said-everywhere.dom.test.ts`',
        [(TEAMWORKSPACE, "    case 'reopen':\n      // ⚑ 725 · a row that SAID *Open the conversation* raises the gesture that cannot start it.\n      if (row.keptOpen) return emit('openKeptOpen', row.conversation)\n", "    case 'reopen':\n      // ⚑ 725 · a row that SAID *Open the conversation* raises the gesture that cannot start it.\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The forest row has no
        # `conversationRow.keptOpen` and `TeamWorkspace` emits no `openKeptOpen`; a node opens
        # through the one door. Removed on purpose (no kept-open split, no Reopen press). Its anchor
        # is left stale, so the census records it retired.
        "M115 · 725 review · the forest presses a node the quit left open into the library's reopen — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`",
        [(TEAMWORKSPACE, "      if (row.conversationRow?.keptOpen === true) return emit('openKeptOpen', row.conversation)\n", '')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `RuntimeScreen` no longer has an
        # `@open-kept-open` binding or `openKeptOpenFromTheRail`; the Team page's `@reopen` /
        # `@take-over` bindings went with the presses. The wiring the row dropped was deleted by the
        # commit. Its anchor is left stale, so the census records it retired.
        "M116 · 725 review · the screen drops the Team page's kept-open press — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`",
        [(RUNTIMESCREEN, '          @take-over="takeOver"\n          @reopen="pressReopen"\n          @open-kept-open="(sessionId) => void openKeptOpenFromTheRail(sessionId)"\n', '          @take-over="takeOver"\n          @reopen="pressReopen"\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Same as M116 for the project room:
        # `@open-kept-open` and `@reopen="pressReopen"` are gone from the room's mount in
        # `RuntimeScreen`, since the room now raises only `open`. Its anchor is left stale, so the
        # census records it retired.
        "M117 · 725 review · the screen drops the room's kept-open press — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`",
        [(RUNTIMESCREEN, '          @open="openFromTheRoom"\n          @reopen="pressReopen"\n          @open-kept-open="(sessionId) => void openKeptOpenFromTheRail(sessionId)"\n', '          @open="openFromTheRoom"\n          @reopen="pressReopen"\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `the-forest.ts` no longer computes
        # `leftOpen` or a `keptOpen` field on its rows (`leftOpenByTheQuit` is deleted); a node
        # nothing runs draws its standing like any other. The commit removed the kept-open
        # population from the forest. Its anchor is left stale, so the census records it retired.
        "M118 · 725 review · the forest's node never says it is kept open — killed by `a-conversation-the-quit-left-open-said-everywhere.test.ts`",
        [(THE_FOREST, '        keptOpen: leftOpen,\n', '        keptOpen: false,\n')],
    ),
    # ── `716` F-3 — already built by `718`; its one unguarded site ──────────────────────────────────────
    (
        'M119 · 718 · `716` F-3 — the third take-over site (goToTheWork) back to *try again in a moment* — killed by `compact-now-and-what-main-now-carries.render.test.ts`',
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `goToTheWork` still has
        # the third take-over site with `HANDED_BACK_AS_IT_WAS_TAKEN` after `store.get(sessionId)
        # === null`, and `openKeptOpen` still guards it — but D-017 inserted a new
        # `startedForThisWindow` retry block between the `openKeptOpen` check and that line, so the
        # old exact text no longer matches. Reverting the final `say(...)` line to the old 'try
        # again in a moment' wording is the same regression the row protected.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — Rule 8.4 (never 'try
        # again in a moment') survives at the same door: `goToTheWork` is now `await
        # openConversation(sessionId)`, and `compact-now-and-what-main-now-carries.render.test.ts`
        # §4 reads its body for `openConversation(` and `not.toMatch(/try again/i)`, and asserts the
        # whole screen has no 'try again in a moment'. The take-over site and
        # `HANDED_BACK_AS_IT_WAS_TAKEN` are gone, so the plant puts the ruled-out sentence back on
        # goToTheWork's refusal path. The label's 'take-over site' wording is now stale; it is the
        # work-report link's door.
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # UI-011 (128203e6) changed goToTheWork's signature to `(sessionId, briefOf?)` and its first
        # line to `if (!(await openConversation(sessionId)) || briefOf === undefined) return`, so
        # the old exact text is gone. Rule 8.4 (never 'try again in a moment') still holds at this
        # door and compact-now...§4 still reads goToTheWork's body, so the plant puts the ruled-out
        # sentence back on its refusal path. Killed by
        # `compact-now-and-what-main-now-carries.render.test.ts`.
        [
            (RUNTIMESCREEN, 'async function goToTheWork(sessionId: string, briefOf?: string): Promise<void> {\n  if (!(await openConversation(sessionId)) || briefOf === undefined) return\n', "async function goToTheWork(sessionId: string, briefOf?: string): Promise<void> {\n  if (!(await openConversation(sessionId))) {\n    say('That conversation is being taken over — try again in a moment.')\n    return\n  }\n  if (briefOf === undefined) return\n"),
        ],
    ),
]
