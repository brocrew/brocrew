"""695 · What the bump moved, and the window nobody sees.

⚑ **Ordered by** the PM's rulings on `680`'s findings — R35 (F1), R36 (F2), F4, F15 — and by the person's
*"I don't want two brobot windows please.. I want only the one with my conversations."*

## 🔴 A · R35 — the launch declares the per-task stop it draws (M1-M2), and a backgrounded agent's
card outlives its turn in the stream (M3-M6), in the fold (M7-M8) and in what a model is told (M9)

⚑ Measured by `probe:per-task-stop` on CLI 2.1.281: undeclared, a conversation's Stop killed the
background agent (`stopped`); declared, it stayed in the level and the per-task stop ended it.

## 🔴 B · R36 — the two marks the CLI puts on an ask (M10-M17), and what the card and Home draw
(M18-M24)

⚑ Measured by `probe:permission-markers`: `echo r36 &` arrives marked `suppressAlwaysAllowRule`, and
on `main` the card still offered — and ACCEPTED — the wide session grant.

## 🔴 C · §1 — the app launches hidden (M25-M35), and every launcher passes it (M36-M39)

## ⚑ D · F15 — the Electron binary on install (M40) · the two copies of the test title (M41) · the
Dock (M42)

## 🔴 E · what 695's own adversarial review found (M43-M49) — a Stop that told a spared agent its
session closed, Electron's own error box, and Home's row that reordered but still dimmed Deny and
said nothing. ⚠️ And M37 SURVIVED on the first verification: the census read `ui-live-smoke.mjs`'s
multi-line import as an argv element. The census was repaired and M37 re-verified RED.
"""

RUNTIME = "packages/runtime/src/claude/claude-runtime.ts"
OPEN = "packages/runtime/src/internal/open-sub-agents.ts"
EVENTS = "packages/runtime/src/events.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
OFFER = "apps/desktop/src/renderer/src/lib/permission-offer.ts"
CARD = "apps/desktop/src/renderer/src/components/PermissionCard.vue"
ATTENTION = "apps/desktop/src/renderer/src/lib/attention.ts"
PRESENT = "apps/desktop/src/main/launch-presentation.ts"
INDEX = "apps/desktop/src/main/index.ts"
BAR = "apps/desktop/src/renderer/src/components/AppTitleBar.vue"
WINDOW_CHECK = "scripts/window-opens-check.mjs"
UI_SMOKE = "scripts/ui-live-smoke.mjs"
RESUME = "scripts/resume-live-smoke.mjs"
PACKAGED = "scripts/packaged-smoke.mjs"
DESKTOP_PKG = "apps/desktop/package.json"
SCRIPTS_HIDDEN = "scripts/lib/hidden-launch.mjs"
BROKER = "packages/runtime/src/internal/request-broker.ts"
HOME = "apps/desktop/src/renderer/src/components/AttentionQueue.vue"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · R35 ──────────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **declared false** · the CLI reads `=== true`, so a Stop kills the background agent "
        "again — killed by `claude-runtime.test.ts`",
        [(RUNTIME, "      perTaskStopAffordance: true,\n", "      perTaskStopAffordance: false,\n")],
    ),
    (
        "M2 · 🔴 **not declared at all** · the CLI's fail-closed kill — killed by `claude-runtime.test.ts`",
        [(RUNTIME, "      perTaskStopAffordance: true,\n", "")],
    ),
    (
        "M3 · 🔴 **a turn spares nothing** · the stream ends a card whose agent is still running in the "
        "background — killed by `sub-agent-turn-end.test.ts`",
        [
            (
                OPEN,
                "    const sparing = boundary?.type === 'turn' ? this.backgrounded : new Set<string>()\n",
                "    const sparing = new Set<string>()\n",
            )
        ],
    ),
    (
        "M4 · ⛔ **the level is never read** · nothing is known to be in the background — killed by "
        "`sub-agent-turn-end.test.ts`",
        [
            (
                OPEN,
                "      this.backgrounded = new Set(event.running.map((one) => one.id))\n",
                "      this.backgrounded = new Set<string>()\n",
            )
        ],
    ),
    (
        "M5 · ⛔ **every boundary spares** · a session's end leaves a backgrounded card open forever — "
        "killed by `sub-agent-turn-end.test.ts`",
        [
            (
                OPEN,
                "    const sparing = boundary?.type === 'turn' ? this.backgrounded : new Set<string>()\n",
                "    const sparing = boundary !== undefined ? this.backgrounded : new Set<string>()\n",
            )
        ],
    ),
    (
        "M6 · 🔴 **the adapter names no boundary** · Claude closes like Codex, sparing nothing — killed by "
        "`sub-agent-turn-end.test.ts`",
        [
            (
                RUNTIME,
                "      for (const closing of this.openSubAgents.closeAll(event)) this.eventQueue.push(closing)\n",
                "      for (const closing of this.openSubAgents.closeAll()) this.eventQueue.push(closing)\n",
            )
        ],
    ),
    (
        "M7 · 🔴 **the fold spares nothing** · *finished* is drawn over a spared agent the bar still lists "
        "— killed by `a-backgrounded-agent-outlives-its-turn.test.ts`",
        [(TRANSCRIPT, "    if (sparing?.has(card.agentId) === true) continue\n", "")],
    ),
    (
        "M8 · ⛔ **the turn passes no level** — killed by `a-backgrounded-agent-outlives-its-turn.test.ts`",
        [
            (
                TRANSCRIPT,
                # ⚑ **T-001 · ANCHOR CORRECTED in place (rule 27)** — D-003 named the level's set
                # `stillListed` so `stopOpenToolCalls` could take it too; the sub-agent sweep still
                # takes it, and this row still drops it from that sweep alone. Re-verified RED.
                "      stopRunningSubAgents(state, stillListed)\n",
                "      stopRunningSubAgents(state)\n",
            )
        ],
    ),
    (
        "M9 · ⚠️ **the model is told its background work is thrown away** (rule 8.1) — killed by "
        "`a-backgrounded-agent-outlives-its-turn.test.ts`",
        [
            (
                TOOLS,
                # ⚑ **720 · ANCHOR CORRECTED in place (rule 27)** — `709` F-9 rewrote the sentence to
                # ASK the turn to stop and name `get_agent_status`; its background clause is
                # unchanged, and this row still drops it — the defect R35 is about. Re-verified RED.
                # ⚑ **W4.135 · re-anchored in place, not retired** — W4.135 · F084 replaced the background sentence with the per-provider stop clause; the plant still says the turn's work is all thrown away
                "It asks the turn it is in to stop: that turn may end there, throwing away whatever it was part-way through, or it may be finished anyway — once the agent is no longer working, get_agent_status says which, so read it there before you rely on either.",
                "Whatever it was part-way through is thrown away.",
            )
        ],
    ),
    # ── B · R36 ──────────────────────────────────────────────────────────────────────────────
    (
        "M10 · 🔴 **the first mark is never read** · a marked ask offers the session grant the CLI will "
        "strip — killed by `claude-runtime.test.ts`",
        [
            (
                RUNTIME,
                "    ...(options.suppressAlwaysAllowRule === true ? { suppressAlwaysAllowRule: true as const } : {}),\n",
                "",
            )
        ],
    ),
    (
        "M11 · 🔴 **the second mark is never read** · a `defaultToNo` card draws Approve first — killed by "
        "`claude-runtime.test.ts`",
        [(RUNTIME, "    ...(options.defaultToNo === true ? { defaultToNo: true as const } : {}),\n", "")],
    ),
    (
        "M12 · 🔴 **the mark rides the card and not the offer** · the grant is still offered — killed by "
        "`claude-runtime.test.ts`",
        [
            (
                RUNTIME,
                # ⚑ **728 · re-anchored in place, not retired** — 728 (R93) also withholds the grant for the CLI's own plan-mode ask, in the same argument; the row still takes the provider's mark off the offer
                # ⚑ **always allow that recurs · re-anchored in place, not retired** — the card's grants are also withheld for this app's own tools, so the condition spread over three lines; the plant still drops the provider's mark, so a marked card is offered a grant
                "      marks.suppressAlwaysAllowRule === true ||\n        (this.planning && !offersAStandingRule(options)) ||\n",
                "        (this.planning && !offersAStandingRule(options)) ||\n",
            )
        ],
    ),
    (
        "M13 · 🔴 **the withholding branch never runs** — killed by `claude-runtime.test.ts`",
        [(RUNTIME, "  if (grantsWithheld) {\n", "  if (false) {\n")],
    ),
    (
        "M14 · ⛔ **only the WIDE grant is withheld** · a marked file ask still offers the narrow one, "
        "a whole-tool rule too — killed by `claude-runtime.test.ts`",
        [
            (
                RUNTIME,
                # ⚑ **736 · corrected in place, not retired** — the withheld set gained R95's
                # `allow_always`, which the mutant keeps withheld: ONE defect, the narrow grant
                # offered again (`736`'s review — it planted two)
                "        outcome !== 'allow_for_session' &&\n        outcome !== 'allow_all_for_session' &&\n        outcome !== 'allow_always',\n",
                "        outcome !== 'allow_all_for_session' &&\n        outcome !== 'allow_always',\n",
            )
        ],
    ),
    (
        "M15 · ⚠️ **the marks never reach the card** · the offer obeys, and no surface can say why — "
        "killed by `claude-runtime.test.ts`",
        [(RUNTIME, "      ...marks,\n", "")],
    ),
    (
        "M16 · ⛔ **`false` is read as a mark** · an unmarked ask loses its grant — killed by "
        "`claude-runtime.test.ts`",
        [
            (
                RUNTIME,
                "    ...(options.suppressAlwaysAllowRule === true ? { suppressAlwaysAllowRule: true as const } : {}),\n",
                "    ...(options.suppressAlwaysAllowRule !== undefined ? { suppressAlwaysAllowRule: true as const } : {}),\n",
            )
        ],
    ),
    (
        "M17 · 🔴 **the wire strips the mark** · zod drops an undeclared key before the ledger — killed by "
        "`claude-runtime.test.ts`",
        [(EVENTS, "  suppressAlwaysAllowRule: z.literal(true).optional(),\n", "")],
    ),
    (
        "M18 · 🔴 **no order moves** · a `defaultToNo` row leads with Approve — killed by "
        "`the-ask-the-provider-marked.render.test.ts`",
        [(OFFER, "  const refusesFirst = marks.defaultToNo === true\n", "  const refusesFirst = false\n")],
    ),
    (
        "M19 · ⛔ **the default is always Approve** · the order moves and the fill does not — killed by "
        "`the-ask-the-provider-marked.render.test.ts`",
        [(OFFER, "    primary: refusesFirst ? 'refuses' : 'allows',\n", "    primary: 'allows',\n")],
    ),
    (
        "M20 · 🔴 **Approve is filled on a card whose default is no** — killed by "
        "`the-ask-the-provider-marked.render.test.ts`",
        [
            (
                CARD,
                # ⚑ 739 · ANCHOR CORRECTED IN PLACE — *Always allow* is never filled either (`739`);
                # the subject, Approve filled on a card whose default is no, is unchanged.
                "            approve: outcomeAllows(outcome) && offer.primary === 'allows' && !keptBeyond(outcome),\n",
                "            approve: outcomeAllows(outcome) && !keptBeyond(outcome),\n",
            )
        ],
    ),
    (
        "M21 · ⚠️ **the missing grant is not explained** — killed by `the-ask-the-provider-marked.render.test.ts`",
        [
            (
                CARD,
                '        <p v-if="marksSay.grantWithheld" class="after" data-cy="permission-grant-withheld">\n',
                '        <p v-if="false" class="after" data-cy="permission-grant-withheld">\n',
            )
        ],
    ),
    (
        "M22 · ⚠️ **the order is not explained** — killed by `the-ask-the-provider-marked.render.test.ts`",
        [
            (
                CARD,
                '        <p v-if="marksSay.defaultIsNo" class="after" data-cy="permission-default-no">\n',
                '        <p v-if="false" class="after" data-cy="permission-default-no">\n',
            )
        ],
    ),
    (
        "M23 · 🔴 **the card's offer ignores the request's marks** — killed by "
        "`the-ask-the-provider-marked.render.test.ts`",
        [
            (
                CARD,
                "  permissionOffer(scope.value.availableDecisions, props.item.request.action, props.item.request),\n",
                "  permissionOffer(scope.value.availableDecisions, props.item.request.action),\n",
            )
        ],
    ),
    (
        "M24 · 🔴 **Home's row ignores them** · the overview leads with Allow where the card leads with Deny "
        "— killed by `the-ask-the-provider-marked.render.test.ts`",
        [
            (
                ATTENTION,
                "        const offer = permissionOffer(scope.availableDecisions, item.request.action, item.request)\n",
                "        const offer = permissionOffer(scope.availableDecisions, item.request.action)\n",
            )
        ],
    ),
    # ── C · §1 ───────────────────────────────────────────────────────────────────────────────
    (
        "M25 · 🔴 **no launch is hidden** · the switch is read and ignored — killed by `a-window-nobody-sees.test.ts`",
        [(PRESENT, "  return { hidden: hasSwitch(HIDDEN_LAUNCH_SWITCH) }\n", "  return { hidden: false }\n")],
    ),
    (
        "M26 · 🔴 **a test window wears a person's name** — killed by `a-window-nobody-sees.test.ts`",
        [(PRESENT, "  window.setTitle(HIDDEN_TITLE)\n", "  window.setTitle(PERSONS_TITLE)\n")],
    ),
    (
        "M27 · ⛔ **the page retitles it BroBot** — killed by `a-window-nobody-sees.test.ts`",
        [(PRESENT, "  window.on('page-title-updated', (event) => event.preventDefault())\n", "")],
    ),
    (
        "M28 · ⛔ **a hidden window is throttled** · its timers run at a pace no person sees — killed by "
        "`a-window-nobody-sees.test.ts`",
        [
            (
                PRESENT,
                "  window.webContents.setBackgroundThrottling(false)\n",
                "  window.webContents.setBackgroundThrottling(true)\n",
            )
        ],
    ),
    (
        "M29 · 🔴 **every window is shown on ready** — killed by `a-window-nobody-sees.test.ts`",
        [(INDEX, "    if (!presentation.hidden) window.show()\n", "    window.show()\n")],
    ),
    (
        "M30 · 🔴 **a hidden window is never kept out of sight** — killed by `a-window-nobody-sees.test.ts`",
        [(INDEX, "  if (presentation.hidden) keepOutOfSight(window)\n", "")],
    ),
    (
        "M31 · ⛔ **a second launch raises the hidden app and steals focus** — killed by "
        "`a-window-nobody-sees.test.ts`",
        [
            (
                INDEX,
                "    if (presentation.hidden) {\n      console.info(`${KEPT_OUT_OF_SIGHT} a second launch asked this app to come forward`)\n      return\n    }\n",
                "",
            )
        ],
    ),
    (
        "M32 · ⛔ **a second launch puts a dialog on screen** — killed by `a-window-nobody-sees.test.ts`",
        [
            (
                INDEX,
                "    if (presentation.hidden) {\n      console.info(`${KEPT_OUT_OF_SIGHT} ${message}`)\n      return\n    }\n",
                "",
            )
        ],
    ),
    (
        "M33 · ⛔ **a picker opens a native dialog on a hidden launch** — killed by `a-window-nobody-sees.test.ts`",
        [
            (
                INDEX,
                "  if (presentation.hidden) {\n    console.info(`${KEPT_OUT_OF_SIGHT} a picker was asked for and answered cancelled`)\n    return { canceled: true, filePaths: [] }\n  }\n",
                "",
            )
        ],
    ),
    (
        "M34 · 🔴 **the bar is told a person's name** — killed by `a-window-nobody-sees.test.ts`",
        [
            (
                INDEX,
                # ⚑ Re-anchored by `724` (`718` F-1): the title is `windowTitleFor`'s; the row still tells
                # every launch a person's name, a hidden one included.
                "    windowTitle: windowTitleFor(presentation, dataFolder),\n",
                "    windowTitle: windowTitleFor({ hidden: false }, dataFolder),\n",
            )
        ],
    ),
    (
        "M35 · 🔴 **the bar draws BroBot whatever it is told** — killed by `the-bar-says-test.render.test.ts`",
        # ⚑ **W4.428 · re-anchored in place, not retired** — the window's words now name the product BroCrew, or say "This app" for the app's own acts; the row plants the same defect in the renamed text.
        [(BAR, "      <strong>{{ info?.windowTitle ?? 'BroCrew' }}</strong>\n", "      <strong>BroCrew</strong>\n")],
    ),
    (
        "M36 · 🔴 **window:check's window is on a person's screen** — killed by `hidden-launch.test.mjs`",
        [
            (
                WINDOW_CHECK,
                "      HIDDEN_LAUNCH_ARG,\n      '.',\n",
                "      '.',\n",
            )
        ],
    ),
    (
        "M37 · 🔴 **smoke:ui's windows are** · and the switch is still NAMED in a message, which is what "
        "the census's first shape counted — killed by `hidden-launch.test.mjs`",
        [(UI_SMOKE, "      HIDDEN_LAUNCH_ARG,\n      ...electronArgs,\n", "      ...electronArgs,\n")],
    ),
    (
        "M38 · 🔴 **smoke:resume's windows are** — killed by `hidden-launch.test.mjs`",
        [(RESUME, "      HIDDEN_LAUNCH_ARG,\n    ],\n", "    ],\n")],
    ),
    (
        "M39 · 🔴 **the packaged app's window is** — killed by `hidden-launch.test.mjs`",
        [
            (
                PACKAGED,
                "`--user-data-dir=${USER_DATA}`, HIDDEN_LAUNCH_ARG]",
                "`--user-data-dir=${USER_DATA}`]",
            )
        ],
    ),
    (
        "M42 · ⛔ **a hidden launch is still an app in the Dock** · a second `Electron` icon beside a "
        "person's own — killed by `a-window-nobody-sees.test.ts`",
        [(INDEX, "      if (presentation.hidden) app.dock?.hide()\n", "")],
    ),
    # ── D · F15 and the shared title ─────────────────────────────────────────────────────────
    (
        "M40 · 🔴 **a fresh worktree has no Electron binary** (680 F15) — killed by `hidden-launch.test.mjs`",
        [
            (
                DESKTOP_PKG,
                # ⚑ **F072 · re-anchored in place, not retired** — F072 · the postinstall is a Node script now, so the install also runs under Windows' cmd; the row still drops it.
                "    \"postinstall\": \"node ../../scripts/install-electron.mjs\",\n",
                "",
            )
        ],
    ),
    (
        "M41 · ⛔ **the launchers' copy of the test title drifts** — killed by `a-window-nobody-sees.test.ts`",
        [(SCRIPTS_HIDDEN, "export const HIDDEN_TITLE = 'BroCrew — test'\n", "export const HIDDEN_TITLE = 'BroCrew'\n")],
    ),
    # ── E · what 695's own review found (M43-M49) ────────────────────────────────────────────
    (
        "M43 · 🔴 **a Stop tells a spared agent its session closed** · the pending ask of an agent the "
        "CLI now spares is denied with a reason that is false — killed by `claude-runtime.test.ts`",
        [(RUNTIME, "    this.settleRequests(STOPPED_INSTEAD_OF_ANSWERING)\n", "    this.settleRequests()\n")],
    ),
    (
        "M44 · ⛔ **the broker ignores the reason it is handed** — killed by `claude-runtime.test.ts`",
        [(BROKER, "      resolve(answer())\n", "      resolve(this.safeReject())\n")],
    ),
    (
        "M45 · ⛔ **a hidden launch's uncaught error puts Electron's box on screen** — killed by "
        "`a-window-nobody-sees.test.ts`",
        [
            (
                INDEX,
                "if (presentation.hidden) {\n  process.on('uncaughtException', (error) => {\n",
                "if (false) {\n  process.on('uncaughtException', (error) => {\n",
            )
        ],
    ),
    (
        "M46 · 🔴 **Home dims Deny on a row whose default is no** — killed by "
        "`the-ask-the-provider-marked.render.test.ts`",
        [
            (
                HOME,
                ':class="{ deny: isRefusal(decision) && request.refusesFirst !== true }"',
                ':class="{ deny: isRefusal(decision) }"',
            )
        ],
    ),
    (
        "M47 · ⚠️ **Home says nothing about the marks** · the card explains itself and the row beside it "
        "does not — killed by `the-ask-the-provider-marked.render.test.ts`",
        [(HOME, 'v-for="line in request.marksSay ?? []"', 'v-for="line in []"')],
    ),
    (
        "M48 · ⛔ **the row never says refusal leads** — killed by `the-ask-the-provider-marked.render.test.ts`",
        [(ATTENTION, "    ...(offer.primary === 'refuses' ? { refusesFirst: true as const } : {}),\n", "")],
    ),
    (
        "M49 · ⛔ **the no-grant sentence follows the mark alone** · it would sit beside a grant button "
        "— killed by `the-ask-the-provider-marked.render.test.ts`",
        [
            (
                OFFER,
                "marks.suppressAlwaysAllowRule === true && !offersAGrant ? GRANT_WITHHELD : null",
                "marks.suppressAlwaysAllowRule === true ? GRANT_WITHHELD : null",
            )
        ],
    ),
]
