"""736 · The same choices the CLI offers.

⚑ **Ordered by** the PM, the closing wave: ui-dev's `728` F-1, F-2, F-3, F-4 and F-11, and `733` F-1,
F-4 and F-5, under R94–R98 — the person: *"simplify and make it behave like the CLIs and other desktop
apps. no new guards and remove old guards."*

## 🔴 A · R94 — a grant is the CLI's own rule — M1–M4

M1 the conversation grant writes a settings file; M2 it is offered only on a disclosed file tool
again (`728`'s gate); M3 the card stops saying what a grant installs; M4 the whole-tool button is
drawn a second time where the CLI's own rule already is the whole tool.

## 🔴 B · R95 on Claude — *always*, with the CLI's persistence, in the provider home — M5–M9

M5 always written where the CLI suggests (a person's repository); M6 always not held for the rest of
the running session; M7 never offered; M8 the kept rules not read at the next launch; M9 an oversized
settings file read whole.

## 🔴 C · R95 on Codex — *don't ask again for commands that start with …* and *Always allow* — M10–M16

M10 the prefix-rule amendment unrepresentable again; M11 its answer not the object Codex offered;
M12 *Always allow* never offered; M13 it answers `session`; M14 it is not kept in the home; M15 a kept
approval not declared with its server; M16 a kept approval declared on every server.

## 🔴 D · R96 — `ask` is the Codex CLI's default preset — M17–M19

M17 `ask` read-only again; M18 the handshake refuses the workspace echo; M19 the fallback opens the
network.

## 🔴 E · R97 — Cancel does what the CLI's does — M20–M21

M20 R81's marker only on a frame that named no turn again; M21 the elicitation's Cancel asks the turn
to stop again (R74).

## 🔴 F · R98 — no EnterPlanMode card of this app's own — M22

## 🔴 G · `733` F-1, F-4, F-5, and the words — M23–M27

M23 the `personal-home` refusal back; M24 *"a Markdown file"* back; M25 an ended conversation's
Finder answers `no-path` again; M26 the Codex approvals note says read-only's bound again; M27 the
conversation grant's line promises only *"the same thing again"*.

## 🔴 H · what `736`'s own review found — M28–M39

M28 a kept approval declared at any address; M29 a keep that writes over a file it could not read;
M30 *Always allow* sent on a card with no answer for it; M31 a kept approval not counted as granted
at the next launch; M32 a whole-tool conversation grant not disclosed; M33 a mode grant that leaves
the handle planning; M34 a surface saying the offer's persistence; M35 the conversation grant's
words gone; M36 an undrawn way to allow said as no reason; M37 a conversation grant wider than the
CLI's; M38 a conversation grant with no CLI suggestion; M39 the Cancel line without *"runs on"*.
"""

CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
KEPT_RULES = "packages/runtime/src/claude/persisted-rules.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
EXTERNAL = "packages/runtime/src/codex/external-mcp.ts"
CAPABILITIES = "packages/runtime/src/codex/capabilities.ts"
READER = "apps/desktop/src/main/runtime/instructions.ts"
REPLY = "apps/desktop/src/main/runtime/reply-rails.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
OFFER = "apps/desktop/src/renderer/src/lib/user-input-offer.ts"
KEPT = "packages/runtime/src/codex/kept-tool-approvals.ts"
PERMISSION_OFFER = "apps/desktop/src/renderer/src/lib/permission-offer.ts"

CLAUDE_TESTS = "claude-runtime.test.ts"
CLI_TESTS = "the-cli-decides-what-to-ask.test.ts"
CODEX_TESTS = "codex-runtime.test.ts"
STORES = "the-same-choices-the-cli-offers.test.ts"
# ⚑ Its desktop half has its own name: a killer label names ONE file (`verify_row.py` refuses two).
DESKTOP = "finder-on-an-ended-conversation-and-the-kinds-held.test.ts"
MODE = "a-mode-that-says-what-it-does.test.ts"
WALK = "instructions.test.ts"
CUT = "the-act-inside-the-cut.test.ts"
QUEUE = "persons-queue.test.ts"
GRANT_WORDS = "what-a-grant-covers.render.test.ts"
MCP_CARD = "when-codex-asks-to-run-an-mcp-tool.render.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · R94 ──────────────────────────────────────────────────────────────────────────────────
    # ⚑ **740 · M1's and M37's anchor corrected, not retired**: `sessionGrantOf` holds the CLI's own
    # choice (`cliRowOf`, R99) rather than the SDK's whole set; the mutation is the same one. ⚠️ M1's
    # label names an `rm`; since R99 an `rm`'s choice is its folder (already `session`), so M1 is seen
    # on a kept prefix rule — `make build`'s — and not on an `rm`.
    (
        "M1 · 🔴 **the conversation grant WRITES a settings file** — the CLI's suggestion echoed with "
        "its own destination, so *allow for this conversation* on an `rm` writes the person's "
        f"repository — killed by `{CLAUDE_TESTS}` (736)",
        [
            (
                CLAUDE,
                "  return row.map((update) => ({ ...update, destination: 'session' }))\n",
                "  return row.map((update) => ({ ...update }))\n",
            )
        ],
    ),
    (
        "M2 · 🔴 **the CLI's rule is offered only on a DISCLOSED file tool again** — `728`'s gate, so an "
        f"opaque card whose CLI suggested a rule offers none of it — killed by `{CLAUDE_TESTS}` (736)",
        [(CLAUDE, "      ? cli.length > 0\n", "      ? cli.length > 0 && fullyDisclosed\n")],
    ),
    (
        "M3 · ⚠️ **the card stops saying what a grant installs** — no `grants`, so no surface can say "
        f"what the rule covers (R94) — killed by `{CLAUDE_TESTS}` (736)",
        [
            (
                CLAUDE,
                "  const grants = claudeGrantsOf(decisions, toolName, suggestions, alwaysFile)\n",
                "  const grants = claudeGrantsOf([], toolName, suggestions, alwaysFile)\n",
            )
        ],
    ),
    (
        "M4 · ⚠️ **the whole-tool button is drawn twice** where the CLI's own conversation rule already "
        f"IS the whole tool (an MCP tool's) — killed by `{CLAUDE_TESTS}` (736)",
        [
            (
                CLAUDE,
                "          ? !fullyDisclosed && !isTheWholeTool(cli, toolName)\n",
                "          ? !fullyDisclosed\n",
            )
        ],
    ),
    # ── B · R95 on Claude ────────────────────────────────────────────────────────────────────────
    # ⛔ **740 · M5 RETIRED BY RULING, not re-anchored** (R99, `736` F-4): *"an always rule is kept
    # where the CLI keeps it"* — `localSettings`, the project — is now the DECISION this row called a
    # defect. Its anchor (`destination: 'userSettings'`) is gone with R95's provider-home keep; `740 M10`
    # is its inverse: *always* sent to the provider home again.
    (
        "M5 · 🔴 **always is written where the CLI suggests** — `localSettings`, the person's own "
        f"repository — and not the provider home R95 names — killed by `{CLAUDE_TESTS}` (736)",
        [(CLAUDE, "          { ...update, destination: 'userSettings' },\n", "          { ...update },\n")],
    ),
    (
        "M6 · 🔴 **always is not held for the rest of THIS session** — with `settingSources: []` the "
        "CLI does not apply a rule it wrote to a file, so the same `rm` is asked again in the "
        f"conversation it was pressed in (measured) — killed by `{CLAUDE_TESTS}` (736)",
        [
            (
                CLAUDE,
                # ⚑ 740 · re-anchored: *always* keeps at the CLI's own destination now (R99). ⚠️ The
                # label's `rm` is `make build` since R99 — an `rm` has no *always* to hold.
                "    keptByTheCli(update) ? [update, { ...update, destination: 'session' }] : [update],\n",
                "    keptByTheCli(update) ? [update] : [update],\n",
            )
        ],
    ),
    (
        "M7 · 🔴 **always is never offered** — R80's *\"never always\"* back, on Claude — killed by "
        f"`{CLAUDE_TESTS}` (736)",
        # ⚑ 740 · re-anchored: the predicate is `keptByTheCli` now (R99).
        [(CLAUDE, "        ? suggestions.some(keptByTheCli)\n", "        ? false\n")],
    ),
    (
        "M8 · 🔴 **a kept rule is not read at the next launch** — `settingSources: []` loads no settings "
        f"file, so the CLI asks again (measured) — killed by `{STORES}` (736)",
        # ⚑ 740 · re-anchored: every kept rule list, from both files (R99).
        [
            (
                CLAUDE,
                # ⚑ W4.189 · re-anchored in place: the permissions carry the work folders beside the
                # kept rules (`flagPermissionsOf`), absent when there are neither.
                "    ...(permissions === null ? {} : { permissions }),\n",
                "    ...{},\n",
            )
        ],
    ),
    (
        "M9 · ⚠️ **an oversized settings file is read whole** — a home the workload can write decides "
        f"how much this process spends — killed by `{STORES}` (736)",
        [
            (
                KEPT_RULES,
                # ⚑ Re-anchored at `736`'s review: the stat is taken once now (the FIFO fix).
                # ⚑ 740 · and again: one bounded reader for both kept files (`readSmall`).
                "    if (!stat.isFile() || size > MAX_SETTINGS_BYTES) return undefined\n",
                "    if (!stat.isFile()) return undefined\n",
            )
        ],
    ),
    # ── C · R95 on Codex ─────────────────────────────────────────────────────────────────────────
    (
        "M10 · 🔴 **the prefix-rule amendment is unrepresentable again** — *don't ask again for "
        f"commands that start with …* has no button — killed by `{CODEX_TESTS}` (736)",
        [
            (
                CODEX,
                "  if (execPolicyAmendmentOf(decision) !== null) return 'allow_always'\n",
                "  if (false) return 'allow_always'\n",
            )
        ],
    ),
    (
        "M11 · 🔴 **its answer is not the object Codex offered** — `allow_always` falls to the plain "
        f"mapping and declines — killed by `{CODEX_TESTS}` (736)",
        [
            (
                CODEX,
                "          decision.outcome === 'allow_always' && state.alwaysAnswer !== undefined\n",
                "          false && state.alwaysAnswer !== undefined\n",
            )
        ],
    ),
    (
        "M12 · 🔴 **Codex's *Always allow* is never offered** on its MCP approval — R80's *\"never "
        f"always\"* back — killed by `{CODEX_TESTS}` (736)",
        [
            (
                CODEX,
                "    ...(approval.offersAlways ? (['allow_always'] as const) : []),\n",
                "    ...(false ? (['allow_always'] as const) : []),\n",
            )
        ],
    ),
    (
        "M13 · 🔴 **Always allow answers `session`** — the conversation's scope, under the always "
        f"button — killed by `{CODEX_TESTS}` (736)",
        [
            (
                CODEX,
                "    return { action: 'accept', content: {}, _meta: { persist: 'always' } }\n",
                "    return { action: 'accept', content: {}, _meta: { persist: 'session' } }\n",
            )
        ],
    ),
    (
        "M14 · 🔴 **Always allow is not KEPT** — on this path Codex keeps nothing itself (measured), so "
        f"the next launch asks again — killed by `{CODEX_TESTS}` (736)",
        [
            (
                CODEX,
                # ⚑ Re-anchored at `736`'s review: the keep now names the server's address.
                "decision.outcome === 'allow_always') {\n      const { serverName, tool } = state.approvesATool\n",
                "decision.outcome === 'never-kept') {\n      const { serverName, tool } = state.approvesATool\n",
            )
        ],
    ),
    (
        "M15 · 🔴 **a kept approval is not declared with its server** — kept, and never read — killed "
        f"by `{STORES}` (736)",
        [
            (
                EXTERNAL,
                # ⚑ Re-anchored at `736`'s review: the match is the name AND the address.
                "      (approval) => approval.server === one.name && approval.url === one.url,\n",
                "      () => false,\n",
            )
        ],
    ),
    (
        "M16 · ⚠️ **a kept approval is declared on EVERY server** — one server's always grants another's "
        f"tool of the same name — killed by `{STORES}` (736)",
        [
            (
                EXTERNAL,
                "      (approval) => approval.server === one.name && approval.url === one.url,\n",
                "      (approval) => approval.server !== '',\n",
            )
        ],
    ),
    # ── D · R96 ──────────────────────────────────────────────────────────────────────────────────
    (
        "M17 · 🔴 **`ask` is the CLI's *Read Only* preset again** — every in-folder write carded "
        f"where a default Codex writes unasked — killed by `{CODEX_TESTS}` (736)",
        [
            (
                CODEX,
                "  ask: { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write' },\n",
                "  ask: { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only' },\n",
            )
        ],
    ),
    (
        "M18 · 🔴 **the handshake refuses the workspace echo** — every `ask` launch fails closed on the "
        f"preset it asked for — killed by `{CODEX_TESTS}` (736)",
        [
            (
                CODEX,
                "    : { reviewer: 'user', policy: 'on-request', sandbox: 'workspaceWrite' }\n",
                "    : { reviewer: 'user', policy: 'on-request', sandbox: 'readOnly' }\n",
            )
        ],
    ),
    (
        "M19 · ⚠️ **the fallback opens the network** — a thread switched from `auto` to `ask` re-pinned "
        f"with network the preset does not have — killed by `{CODEX_TESTS}` (736)",
        [
            (
                CODEX,
                "  writableRoots: [],\n  networkAccess: false,\n  excludeTmpdirEnvVar: false,\n",
                "  writableRoots: [],\n  networkAccess: true,\n  excludeTmpdirEnvVar: false,\n",
            )
        ],
    ),
    # ── E · R97 ──────────────────────────────────────────────────────────────────────────────────
    (
        "M20 · 🔴 **R81's marker only on a frame that named no turn again** — a named-turn card's "
        f"Cancel says it stops the turn, which nothing now asks — killed by `{CODEX_TESTS}` (736)",
        [
            (
                CODEX,
                "    const cancelStopsNothing = { cancelStopsNothing: true as const }\n",
                "    const cancelStopsNothing =\n      theFramesTurn === '' ? { cancelStopsNothing: true as const } : {}\n",
            )
        ],
    ),
    (
        # ⚑ Relabelled at `736`'s review: the planted stop follows EVERY elicitation answer, a Cancel's too.
        "M21 · 🔴 **every elicitation answer asks the turn to stop, a Cancel's included** — R74's stop, which R97 amended: "
        f"*\"BroBot adds no stop of its own to a Cancel\"* — killed by `{CODEX_TESTS}` (736)",
        [
            (
                CODEX,
                "    // 🔴 **736 · R97 — and nothing more for a Cancel.**",
                "    await this.askTheTurnToStop(isRecord(params) && typeof params['turnId'] === 'string' ? params['turnId'] : '')\n    // 🔴 **736 · R97 — and nothing more for a Cancel.**",
            )
        ],
    ),
    # ── F · R98 ──────────────────────────────────────────────────────────────────────────────────
    (
        "M22 · 🔴 **the EnterPlanMode consent card is back in `ask`** — an ask of this app's own, which "
        f"the CLI does not make (measured) — killed by `{CLAUDE_TESTS}` and `{CLI_TESTS}` (736)",
        [
            (
                CLAUDE,
                "      if (CONSENT_ONLY_USER_INPUT.has(toolName)) {\n",
                "      if (\n        CONSENT_ONLY_USER_INPUT.has(toolName) &&\n        isAutoApprove({ approvalMode: this.approvals.effective })\n      ) {\n",
            )
        ],
    ),
    # ── G · `733` F-1, F-4, F-5, and the words ───────────────────────────────────────────────────
    (
        "M23 · 🔴 **a project link into the person's own home is refused again** — `733`'s "
        f"`personal-home`, which the CLI does not do (measured) — killed by `{WALK}` (736)",
        [
            (
                READER,
                "    const real = read.real ?? realPath(path)\n",
                "    const real = read.real ?? realPath(path)\n"
                # ⚑ Through `realPath`, as `733`'s predicate was: a home under `/var` is really
                # `/private/var`, and a bare `resolve` never matches (measured: the row SURVIVED).
                "    if (dirname(real) === realPath(home) || dirname(real) === join(realPath(home), '.claude')) {\n"
                "      refused.push({ path, reason: 'personal-home', link: real })\n"
                "      return\n"
                "    }\n",
            )
        ],
    ),
    (
        "M24 · 🔴 **the long form must be *a Markdown file* again** — the store holds pages, images and "
        f"PDFs (`733` F-4) — killed by `{DESKTOP}`, and killed by `{CUT}` (736)",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The words a
        # reply refusal says to the model survive: `summary-too-long` still tells the model to put
        # the long form in the held forms. The plant replaces the held-forms sentence with a literal
        # "a Markdown file", the defect of naming a kind the app no longer holds. Killed by
        # `finder-on-an-ended-conversation-and-the-kinds-held.test.ts`,
        # `the-act-inside-the-cut.test.ts`.
        [
            # ⚑ **602 · re-anchored in place, not retired** — Held-form remedy moved to LONG_SUMMARY_REMEDY; still narrows the supported form list to Markdown only. Source-only, NOT VERIFIED.
            (REPLY, "Put the rest in ${HELD_FORMS_SAID} and name its path in resource_paths", "Put the rest in a Markdown file and name its path in resource_paths"),
        ],
    ),
    (
        "M25 · 🔴 **an ENDED conversation's Finder answers `no-path` again** — the panel draws the row "
        f"and its Open reads it (`733` F-5) — killed by `{DESKTOP}` (736)",
        [
            (
                HOST,
                "    const session = this.slots.get(sessionId)?.session ?? this.endedPlacesOf(sessionId)\n",
                "    const session = this.slots.get(sessionId)?.session ?? null\n",
            )
        ],
    ),
    (
        "M26 · 🔴 **the Codex approvals note says read-only's bound again** — *\"cannot write outside "
        f"your folder\"*, false of the default preset (measured: `/tmp` written unasked) — killed by `{MODE}` (736)",
        [
            (
                CAPABILITIES,
                # ⚑ Re-anchored at `736`'s review: the note now also says the home's config can open it.
                "with approvals on it writes in your folder and the temporary folders without asking, and cannot write anywhere else or reach the network unless you approve it or the config.toml of this identity opens it;",
                "with approvals on it cannot write outside your folder or reach the network, and",
            )
        ],
    ),
    (
        "M27 · ⚠️ **the conversation grant's line promises only *\"the same thing again\"*** — `728`'s "
        f"file rule, where the CLI's rule may be a folder or every edit — killed by `{QUEUE}` (736)",
        [
            (
                OFFER,
                "    'the agent may do this, and what the provider’s own rule for it covers, for this conversation',\n",
                "    'the agent may do this, and the same thing again, for this conversation',\n",
            )
        ],
    ),
    # ── H · what `736`'s own review found ─────────────────────────────────────────────────────
    (
        "M28 · 🔴 **a kept approval is declared at ANY address** — a server removed and registered again "
        f"under the same name elsewhere inherits the first one's *Always allow* — killed by `{STORES}` (736)",
        [
            (
                EXTERNAL,
                "      (approval) => approval.server === one.name && approval.url === one.url,\n",
                "      (approval) => approval.server === one.name,\n",
            )
        ],
    ),
    (
        "M29 · ⚠️ **a keep writes over a file it could not read** — the approvals already kept there "
        f"are lost — killed by `{STORES}` (736)",
        [(KEPT, "  if (now.state === 'unreadable') {\n", "  if (now.state === 'never') {\n")],
    ),
    (
        "M30 · 🔴 **Always allow goes out on a card that carries no answer for it** — a file approval "
        f"sends `decline` while the ledger records *Always allow* — killed by `{CODEX_TESTS}` (736)",
        [
            (
                CODEX,
                "    if (decision.outcome === 'allow_always' && !sendsAlways) {\n",
                "    if (decision.outcome === 'allow_always' && sendsAlways === null) {\n",
            )
        ],
    ),
    (
        "M31 · ⚠️ **a kept approval is not counted as granted at the next launch** — a frame wearing "
        f"Codex's marker for that tool is read as Codex asking — killed by `{CODEX_TESTS}` (736)",
        [
            (
                CODEX,
                "      if (declared === true) this.mcpCalls.grant(approval.server, approval.tool)\n",
                "      if (declared === null) this.mcpCalls.grant(approval.server, approval.tool)\n",
            )
        ],
    ),
    (
        "M32 · 🔴 **a conversation grant of the WHOLE tool is not disclosed** — the header's chip never "
        f"appears for the CLI's own whole-tool rule (an MCP tool's) — killed by `{CLAUDE_TESTS}` (736)",
        [
            (
                CLAUDE,
                "        for (const whole of wholeToolsOf(updates)) this.sessionGrants.grantAll(whole)\n",
                "        for (const whole of wholeToolsOf([])) this.sessionGrants.grantAll(whole)\n",
            )
        ],
    ),
    (
        "M33 · 🔴 **a grant that switches the CLI's mode leaves the handle PLANNING** — over a CLI that "
        f"is not — killed by `{CLAUDE_TESTS}` (736)",
        [
            (
                CLAUDE,
                "    if (leaves && this.plan.effective) this.plan.settle(false)\n",
                "    if (leaves && !this.plan.effective) this.plan.settle(false)\n",
            )
        ],
    ),
    (
        "M34 · 🔴 **a surface says the OFFER's persistence again** — *always* over buttons that are "
        f"not — killed by `{GRANT_WORDS}`, and killed by `{MCP_CARD}` (736)",
        # ⛔ RETIRED BY `739` (`736` F-1, R95), anchor-absent: `drawnPersistence` is gone because every
        # button the offer's `persistence` summarises is DRAWN since `739` put *Always allow* in the
        # row — the subject (*always* said over buttons that are not) has no case left. The card's
        # persistence row reads the offer's own word; Home keeps its conversation line where a
        # conversation grant is offered beside *Always allow* (`attention.ts`, pinned by `739`).
        [
            (
                PERMISSION_OFFER,
                "  if (scope.persistence !== 'always') return scope.persistence\n",
                "  return scope.persistence\n",
            )
        ],
    ),
    (
        "M35 · 🔴 **the conversation grant says nothing of what it covers** — R94's *\"The card's words "
        f"say what the rule covers\"* — killed by `{GRANT_WORDS}` (736)",
        [(PERMISSION_OFFER, "  if (rules.length === 0) return null\n", "  return null\n")],
    ),
    (
        "M36 · ⚠️ **a way to allow that no surface draws is said as no reason recorded** — killed by "
        f"`{GRANT_WORDS}` (736)",
        # ⛔ RETIRED BY `739` (`736` F-1, R95), anchor-absent: no way to allow is undrawn since `739`
        # drew *Always allow* — `undrawn`, its arm and `ONLY_AN_UNDRAWN_WAY_TO_ALLOW` are gone, and an
        # always-only Codex command card offers the drawn button (pinned by `739`).
        [
            (
                PERMISSION_OFFER,
                "  if (offer.undrawn.some(outcomeAllows))\n",
                "  if (offer.undrawn.some(() => false))\n",
            )
        ],
    ),
    (
        "M37 · 🔴 **the conversation grant is WIDER than the CLI suggested** — a rule's content dropped, "
        f"so a read's folder rule becomes every read — killed by `{CLAUDE_TESTS}` (736)",
        [
            (
                CLAUDE,
                "  return row.map((update) => ({ ...update, destination: 'session' }))\n",
                "  return row.map((update) =>\n"
                "    update.type === 'addRules'\n"
                "      ? { ...update, rules: update.rules.map(({ toolName }) => ({ toolName })), destination: 'session' }\n"
                "      : { ...update, destination: 'session' },\n"
                "  )\n",
            )
        ],
    ),
    (
        "M38 · ⚠️ **a conversation grant is offered where the CLI suggested none** — `728`'s old gate, "
        f"a rule of this app's own — killed by `{CLAUDE_TESTS}`, and killed by `{CLI_TESTS}` (736)",
        [(CLAUDE, "      ? cli.length > 0\n", "      ? cli.length > 0 || fullyDisclosed\n")],
    ),
    (
        "M39 · ⚠️ **the Cancel line says only what did NOT happen again** — R97: *\"its line says "
        f"exactly that\"*, the request cancelled and the turn running on — killed by `{MCP_CARD}` (736)",
        [
            (
                OFFER,
                "export const CANCEL_STOPS_NOTHING = `the request is cancelled and the turn runs on — it is not ${ASKED_TO_STOP}`",
                "export const CANCEL_STOPS_NOTHING = `the request is cancelled, and the turn is not ${ASKED_TO_STOP}`",
            )
        ],
    ),
]
