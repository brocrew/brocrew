"""704 · The smokes tell the truth.

⚑ **Ordered by** the PM — `697` H-e, H-g, H-j, H-k, and `700`'s Codex finding. ⚠️ Most of 704 is
instruments; the product code that moved is the Codex adapter's interrupt (section A), so that is
where the rows are densest.

## 🔴 A · an interrupt asked before Codex has started the turn is sent again at `turn/started` (M1-M4)

⚑ Measured by `probe:codex-early-interrupt` against the bundled 0.146.0: on `main` 4 of 4 early
interrupts were refused (`-32600 "no active turn to interrupt"`) and Codex completed the turn; on
`704`, 4 of 4 were refused at the bind (that word, or `expected active turn id … but found …` while
the turn before still held Codex's active slot) and taken at `turn/started`, and Codex's word is
`interrupted`. `smoke:ui` step 48's red on the hidden `main` baseline was this.

## ⚑ B · the early-interrupt probe's verdict, pinned from `ci` (M5-M9)

## ⛔ A2 · `700`'s Codex finding — a command approval's `reason` is the MODEL's (M13)

⚑ Measured through the product's `ask` profile on the bundled 0.146.0: `reason` equals the model's
`justification`, verbatim, and is absent without one; `null` on every file approval driven. So it
is never the command's disclosure.

## ⚑ C · the README says what `pnpm run ci` runs, once (M10-M11)

## 🔒 D · today's §6 (M12)

## ⚑ E · `672`'s 14 command shapes, swept every run — `sweepVerdict`, pinned from `ci` (M14-M19)

⚑ Measured live: `probe:codex-reopen-grant`'s `sweep` arm, 14 of 14 shapes a command card offering
`allow · deny · cancel`, each saying `once` — `never-offered`.

## 🔴 F · a slash command the CLI never received is RED, not the provider's choice (M20-M23)

⚑ Since `607` a person's words reach Claude inside the app's authorship preamble, so `/compact` and
`/clear` are words; steps 62 and 70 now read what the CLI received and go red on it (live, 704:
both red, naming it). The smoke is not in `ci`, so its reading logic (`turn-query.mjs`) and its
shape (`smoke-steps-704.test.mjs`) are what these rows guard.

## ⚑ G · step 48 reads Codex's own rollout, and 62/17/18 wait for the close and the row (M24-M27)

## ⛔ What this table cannot reach

 * ⚠️ **The live probes themselves** (`probe:codex-early-interrupt`, `probe:codex-reopen-grant`'s
   sweep arm) — not in `ci`; their reading logic is (sections B and E), and the runs' evidence is in
   `704`'s response.
 * ⚠️ **`smoke:ui`'s steps 29, 48, 62, 70, 17 and 18** — a live path; their new shape is pinned by
   `scripts/test/smoke-steps-704.test.mjs` (rows M23, M26, M27 guard it) and their reading logic by
   `scripts/test/turn-query.test.mjs` (M20-M22, M24, M25); whether they are green is the batch.
 * ⚠️ **Step 29's settle detector** is page-side code inside a template literal: its shape is pinned
   by the census and its behaviour only by a live run (704 ran it green, hidden).
"""

CODEX = "packages/runtime/src/codex/codex-runtime.ts"
EARLY = "packages/runtime/smoke/early-interrupt-evidence.ts"
# ⚑ The developer guide, which the README was until the public README took its place.
README = "docs/development.md"
BLOCK = "scripts/lib/security-block.txt"
SWEEP = "packages/runtime/smoke/reopen-grant-evidence.ts"
TURN_QUERY = "scripts/lib/turn-query.mjs"
UI_SMOKE = "scripts/ui-live-smoke.mjs"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the Codex early interrupt ───────────────────────────────────────────────────────
    (
        "M1 · 🔴 **`turn/started` sends nothing** — an interrupt Codex refused because its turn was "
        "not running is never sent again, and the turn runs to its end — killed by "
        "`codex-runtime.test.ts` (704)",
        [(CODEX, "        void this.sendInterruptRpc(startedId)\n", "")],
    ),
    (
        "M2 · 🔴 **`interrupt()` no longer marks the turn asked** — the resend has nothing to read — "
        "killed by `codex-runtime.test.ts` (704)",
        [(CODEX, "    this.currentTurn.interruptAsked = true\n", "")],
    ),
    (
        "M3 · ⛔ **the resend names whatever turn `turn/started` names** — a stale one for an old turn "
        "draws a `turn/interrupt` at the wrong id — killed by `codex-runtime.test.ts` (704)",
        [
            (
                CODEX,
                "      if (this.currentTurn?.interruptAsked && this.isCurrentProviderTurn(startedId)) {\n",
                "      if (this.currentTurn?.interruptAsked) {\n",
            )
        ],
    ),
    (
        "M4 · ⛔ **every turn starts asked** — a turn nobody interrupted is interrupted the moment "
        "Codex starts it — killed by `codex-runtime.test.ts` (704's control)",
        [
            (
                CODEX,
                "interruptPending: false,\n      interruptAsked: false,\n",
                "interruptPending: false,\n      interruptAsked: true,\n",
            )
        ],
    ),
    # ── B · the probe's verdict ─────────────────────────────────────────────────────────────
    (
        "M5 · 🔴 **a completed early turn is not `lost`** — main's shape reads as something else — "
        "killed by `codex-early-interrupt-evidence.test.ts`",
        [
            (
                EARLY,
                "  if (lost.length > 0) return { verdict: 'lost', turns: lost.map((turn) => turn.turn) }\n",
                "",
            )
        ],
    ),
    (
        "M6 · ⛔ **the window is not checked** — an interrupt Codex TOOK, the turn already running, "
        "counts as the subject — killed by `codex-early-interrupt-evidence.test.ts`",
        [
            (
                EARLY,
                "  return first !== undefined && NOT_RUNNING.test(first.answer)\n",
                "  return first !== undefined\n",
            )
        ],
    ),
    (
        "M7 · ⛔ **the uninterrupted control is not read** — a model that ended every turn itself "
        "would pass as an interrupt Codex honoured — killed by `codex-early-interrupt-evidence.test.ts`",
        [
            (
                EARLY,
                "  if (none.length === 0 || none.some((turn) => turn.providerStatus !== 'completed')) {\n",
                "  if (none.length === 0) {\n",
            )
        ],
    ),
    (
        "M8 · ⛔ **the mid-turn control is not read** — killed by `codex-early-interrupt-evidence.test.ts`",
        [
            (
                EARLY,
                "  if (late.length === 0 || late.some((turn) => turn.providerStatus !== 'interrupted')) {\n",
                "  if (late.length === 0) {\n",
            )
        ],
    ),
    (
        "M9 · ⛔ **an early turn Codex never ended is not named** — killed by "
        "`codex-early-interrupt-evidence.test.ts`",
        [
            (
                EARLY,
                "  const silent = early.filter((turn) => turn.providerStatus === null)\n",
                "  const silent = early.filter(() => false)\n",
            )
        ],
    ),
    # ── C · the README ──────────────────────────────────────────────────────────────────────
    (
        "M10 · ⚑ **the README's list drops a step** — killed by `readme-ci-steps.test.mjs`",
        [(README, "`db:check` → ", "")],
    ),
    (
        "M11 · ⚑ **the table row lists the gate again** — a second list, the one that drifted — "
        "killed by `readme-ci-steps.test.mjs`",
        [
            (
                README,
                "The whole gate — every step listed under this table, in order.                      |",
                "The Step-0 gate: `engine:check` + `typecheck` + `lint` + `test` + `build`.          |",
            )
        ],
    ),
    # ── D · §6 ──────────────────────────────────────────────────────────────────────────────
    (
        "M12 · 🔒 **§6 says a live smoke's windows appear again** — the sentence `695` made false, "
        "back in the block a live identity carries — killed by `permission-matrix-security.test.mjs`",
        [
            (
                BLOCK,
                "⚑ **Since `695` the app launches hidden:",
                "⚠️ Until the app can launch hidden (a dispatch is queued), the app launches hidden:",
            )
        ],
    ),
    # ── A2 · 700's Codex finding: a command's `reason` is the model's ────────────────────────
    (
        "M13 · ⛔ **an empty command's card discloses the model's justification** — the sentence the "
        "model wrote, where what Allow runs belongs — killed by `codex-runtime.test.ts` (704)",
        [
            (
                CODEX,
                "    const detail = kind === 'command' ? readString(params, 'command') || kind : fileDetail(targets)\n",
                "    const detail =\n      kind === 'command'\n        ? readString(params, 'command') || readString(params, 'reason') || kind\n        : fileDetail(targets)\n",
            )
        ],
    ),
    # ── E · the sweep's verdict ─────────────────────────────────────────────────────────────
    (
        "M14 · ⛔ **the kind filter dropped** — a file card's session button reads as a command "
        "card's — killed by `codex-reopen-grant-evidence.test.ts`",
        [
            (
                SWEEP,
                "    cardsIn(cards, shape, 'command').some((card) =>\n",
                "    cards.filter((card) => card.turn === shape).some((card) =>\n",
            )
        ],
    ),
    (
        "M15 · ⛔ **the turn filter dropped** — another arm's command card reads as a swept shape — "
        "killed by `codex-reopen-grant-evidence.test.ts`",
        [
            (
                SWEEP,
                "    cardsIn(cards, shape, 'command').some((card) =>\n",
                "    cards.filter((card) => card.kind === 'command').some((card) =>\n",
            )
        ],
    ),
    (
        "M16 · 🔴 **the offer read as Claude's grant** — a Codex session button is never seen — "
        "killed by `codex-reopen-grant-evidence.test.ts`",
        [
            (
                SWEEP,
                "      card.availableDecisions.includes('allow_for_session'),\n",
                "      card.availableDecisions.includes('allow_all_for_session'),\n",
            )
        ],
    ),
    (
        "M17 · ⛔ **a silent shape reads as measured** — a shape with no card is `never-offered` — "
        "killed by `codex-reopen-grant-evidence.test.ts`",
        [
            (
                SWEEP,
                "  const silent = shapes.filter((shape) => cardsIn(cards, shape, 'command').length === 0)\n",
                "  const silent = shapes.filter((shape) => cardsIn(cards, shape, 'command').length < 0)\n",
            )
        ],
    ),
    (
        "M18 · ⛔ **an unenumerated sweep is a success** — the empty guard gone — killed by "
        "`codex-reopen-grant-evidence.test.ts`",
        [
            (
                SWEEP,
                "  if (shapes.length === 0) return { verdict: 'not-performed', because: 'no shape was swept' }\n",
                "  if (shapes.length < 0) return { verdict: 'not-performed', because: 'no shape was swept' }\n",
            )
        ],
    ),
    (
        "M19 · ⚠️ **a silent shape hides an offer** — `offered` decided after `not-performed` — "
        "killed by `codex-reopen-grant-evidence.test.ts`",
        [
            (SWEEP, "  if (offering.length > 0) return { verdict: 'offered', shapes: offering }\n", ""),
            (
                SWEEP,
                "  return { verdict: 'never-offered' }\n",
                "  if (offering.length > 0) return { verdict: 'offered', shapes: offering }\n"
                "  return { verdict: 'never-offered' }\n",
            ),
        ],
    ),
    # ── F · what the CLI received ───────────────────────────────────────────────────────────
    (
        "M20 · 🔴 **a wrapped command reads as a command** — 62 and 70 go back to blaming the provider "
        "— killed by `turn-query.test.mjs`",
        [(TURN_QUERY, "      return { arrived: 'wrapped', text: prompts[at] }\n", "      return { arrived: 'command' }\n")],
    ),
    (
        "M21 · 🔒 **any transcript in the folder is this conversation's** — another session's words "
        "decide — killed by `turn-query.test.mjs`",
        [(TURN_QUERY, "    name === `${sessionId}.jsonl`\n", "    name.endsWith('.jsonl')\n")],
    ),
    (
        "M22 · ⛔ **a tool's result is a prompt** — its text part reads as what the person sent — "
        "killed by `turn-query.test.mjs`",
        [
            (
                TURN_QUERY,
                "    if (!Array.isArray(content) || content.some((part) => part?.type === 'tool_result')) continue\n",
                "    if (!Array.isArray(content)) continue\n",
            )
        ],
    ),
    (
        "M23 · 🔴 **step 62 stops asking the CLI** — the provider is blamed for the app's preamble "
        "again — killed by `smoke-steps-704.test.mjs`",
        [
            (
                UI_SMOKE,
                "      const received = await howTheCliReceived(cdp, '/compact')\n",
                "      const received = { note: 'not asked' }\n",
            )
        ],
    ),
    # ── G · the rollout, the close, the row ─────────────────────────────────────────────────
    (
        "M24 · 🔴 **a task_complete is not read as Codex finishing the turn** — the 03:04 false green "
        "comes back — killed by `turn-query.test.mjs`",
        [(TURN_QUERY, "  if (ending.completed) {\n", "  if (false) {\n")],
    ),
    (
        "M25 · 🔒 **any rollout in the home is this thread's** — another conversation's words decide — "
        "killed by `turn-query.test.mjs`",
        [(TURN_QUERY, "    name.endsWith(`-${threadId}.jsonl`)\n", "    name.endsWith('.jsonl')\n")],
    ),
    (
        "M26 · ⛔ **the close is not waited for** — step 62's race, back through the sibling — killed "
        "by `smoke-steps-704.test.mjs`",
        [
            (
                UI_SMOKE,
                "  await endTheConversation(cdp)\n  await waitFor(\n    `${closing} to finish closing`,\n",
                "  await endTheConversation(cdp)\n  void waitFor(\n    `${closing} to finish closing`,\n",
            )
        ],
    ),
    (
        "M27 · ⛔ **Resume is found and not pressed** — the reopen never happens — killed by "
        "`smoke-steps-704.test.mjs`",
        [(UI_SMOKE, "        button.click()\n        return true`),\n", "        return true`),\n")],
    ),
]
