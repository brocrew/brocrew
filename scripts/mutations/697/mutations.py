"""697 · The runtime's loose ends.

⚑ **Ordered by** the PM's runtime queue — `672` F1, H1, H2 and its reopen-grant smoke, `676` §5,
`673` F-6, `685` H3 — and `695` F-a, F-g, F-h.

## 🔴 A · `672` F1 — a card's `persistence` is what its buttons can grant (M1-M10)

⚑ Measured live by `probe:codex-reopen-grant`: on `main` 9 of 9 Codex cards said the wrong thing
(5 command cards `session` over a one-shot Allow, 4 file cards `once` beside a session button); on
`697`, 0 of 9.

## 🔴 B · `673` F-6 — a Codex resume refused before its handshake is a `ResumeError` with a cause
(M11-M14)

## 🔴 C · `676` §5 — the four reads guard their payload, and count what they passed over (M15-M24)

## ⚑ D · `672` H1/H2 — the digest spells `Task #N`, and the dead sentence stays dead (M25-M30)

## ⚑ E · `685` H3 — the runtime's prose about the two-part answer (M31-M33)

## 🔒 F · `695` F-g — today's §6 (M34)

## 🔴 G · `695` F-a and F-h — a probe's window and the README's recipe stay unseen (M35-M38)

## ⚑ H · the reopen-grant probe's verdict, pinned from `ci` (M39-M41)

## ⛔ What this table cannot reach

 * ⚠️ **The live probe itself** (`probe:codex-reopen-grant`) — not in `ci`; its reading logic is
   (section H), and the run's evidence is in `697`'s response.
 * ⚠️ **`probe:drop`'s owned lifecycle and its reap-gated cleanup** — a live Electron path; measured
   by running it (`697` response), not guarded here.
 * ⚠️ **The `CASE` in `selectSubAgentReported`** — M18's first form removed it and SURVIVED: its
   `NOT readable OR …` puts the torn test first and SQLite never parses a torn row there. Kept, and
   said, because SQLite does not promise that order (`671`'s own reason for the `CASE`); the three
   reads that also parse in their `SELECT` list (M15-M17) are killed without it.
"""

PERMISSION = "packages/runtime/src/permission.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
FAKE = "packages/runtime/src/fake-runtime.ts"
ATTENTION = "apps/desktop/src/renderer/src/lib/attention.ts"
CARD = "apps/desktop/src/renderer/src/components/PermissionCard.vue"
UI_SMOKE = "scripts/ui-live-smoke.mjs"
STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
DIGEST = "apps/desktop/src/main/runtime/digest.ts"
STALLED = "apps/desktop/src/shared/stalled-work.ts"
AGENT_TOOLS = "packages/runtime/src/agent-tools.ts"
TOOL_ANSWER = "packages/runtime/src/tool-answer.ts"
ANSWER_PROBE = "packages/runtime/smoke/claude-tool-answer-probe.smoke.ts"
BLOCK = "scripts/lib/security-block.txt"
DROP = "scripts/drop-hazard-probe.mjs"
# ⚑ The developer guide, which the README was until the public README took its place.
README = "docs/development.md"
EVIDENCE = "packages/runtime/smoke/reopen-grant-evidence.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · 672 F1 ───────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **`main`'s rule back** · a PROPOSED amendment makes a one-shot command card say "
        "`session` — *\"for the whole conversation\"* over an Allow that grants this once — killed by "
        "`codex-runtime.test.ts`",
        [
            (
                CODEX,
                "    persistence: persistenceOf([...(allowed ?? STANDARD_DECISIONS)]),\n",
                "    persistence:\n      amendments.length > 0 ? 'session' : persistenceOf([...(allowed ?? STANDARD_DECISIONS)]),\n",
            )
        ],
    ),
    (
        "M2 · 🔴 **the raw list, not the gate** · a session accept the gate WITHHELD (an undisplayable "
        "grant) still makes the card say `session` — killed by `codex-runtime.test.ts`",
        [
            (
                CODEX,
                "    persistence: persistenceOf([...(allowed ?? STANDARD_DECISIONS)]),\n",
                "    persistence: persistenceOf(enumerated),\n",
            )
        ],
    ),
    (
        "M3 · 🔴 **the file card's old rule** · `once` beside an *allow for this session* button unless "
        "a grant root came with it — killed by `codex-runtime.test.ts`",
        [
            (
                CODEX,
                "    persistence: persistenceOf(STANDARD_DECISIONS),\n",
                "    persistence: grantRoot ? 'session' : 'once',\n",
            )
        ],
    ),
    (
        "M4 · ⚠️ **the wholesale grant forgotten** · a Claude card offering `allow_all_for_session` says "
        "`once` — killed by `claude-runtime.test.ts`",
        [
            (
                PERMISSION,
                "    (outcome) => outcome === 'allow_for_session' || outcome === 'allow_all_for_session',\n",
                "    (outcome) => outcome === 'allow_for_session',\n",
            )
        ],
    ),
    (
        "M5 · ⛔ **`once` whatever the offer** · the derivation that can only say one thing — killed by "
        "`codex-runtime.test.ts`",
        [(PERMISSION, "    ? 'session'\n    : 'once'\n}\n", "    ? 'once'\n    : 'once'\n}\n")],
    ),
    (
        "M6 · ⚠️ **the double's literal back** · a simulated card with a session button says `once` — "
        "killed by `fake-runtime.test.ts`",
        [(FAKE, "        persistence: persistenceOf(availableDecisions),\n", "        persistence: 'once',\n")],
    ),
    (
        "M7 · ⚠️ **Claude's derivation lost** · every Claude card says `once` — killed by "
        "`claude-runtime.test.ts`",
        [(CLAUDE, "    persistence: persistenceOf(decisions),\n", "    persistence: 'once',\n")],
    ),
    (
        "M8 · 🔴 **Home says the answer applies the proposal** · *\"also changes future exec: …\"* — "
        "which no answer this app sends does — killed by `attention-queue.test.ts`",
        [
            (
                ATTENTION,
                "      `proposed for future ${amendment.kind}, not applied by any answer here: ${amendment.detail}`,\n",
                "      `also changes future ${amendment.kind}: ${amendment.detail}`,\n",
            )
        ],
    ),
    (
        "M9 · 🔴 **the card says the same** · *\"also applies to\"* over the proposal — killed by "
        "`the-ask-the-provider-marked.render.test.ts`",
        [(CARD, "          <dt>proposed, not applied here</dt>\n", "          <dt>also applies to</dt>\n")],
    ),
    (
        "M10 · 🔴 **criterion 17 demands `session` again** · step 82 goes red on every live run of the "
        "fail-closed card — killed by `permission-matrix-security.test.mjs`",
        [
            (
                UI_SMOKE,
                "              request.scope?.persistence !== 'once' ||\n",
                "              request.scope?.persistence !== 'session' ||\n",
            )
        ],
    ),
    # ── B · 673 F-6 ──────────────────────────────────────────────────────────────────────────
    (
        "M11 · 🔴 **the boundary removed** · a cancel, an abandoned boot gate or a spawn failure leaves "
        "a Codex resume as itself, and a wake rethrows it — killed by `codex-home-boot.test.ts`",
        [
            (
                CODEX,
                "      if (error instanceof ResumeError || error instanceof AuthUnavailableError) throw error\n      throw new ResumeError(ref, `resume setup failed: ${errorMessage(error)}`, { cause: error })\n",
                "      throw error\n",
            )
        ],
    ),
    (
        "M12 · 🔴 **wrapped with no cause** · the spawn failure is dropped from the `ResumeError`, so "
        "nothing past the adapter can say which failure it was — until `706` the host also read a "
        "causeless one as *the thread is gone* — killed by `codex-home-boot.test.ts`",
        [
            (
                CODEX,
                "      throw new ResumeError(ref, `resume setup failed: ${errorMessage(error)}`, { cause: error })\n",
                "      throw new ResumeError(ref, `resume setup failed: ${errorMessage(error)}`)\n",
            )
        ],
    ),
    (
        "M13 · ⛔ **a sign-in wrapped too** · an unusable credential reads as *could not be resumed* "
        "instead of *sign in again* — killed by `codex-home-boot.test.ts`",
        [
            (
                CODEX,
                "      if (error instanceof ResumeError || error instanceof AuthUnavailableError) throw error\n      throw new ResumeError(ref, `resume setup failed:",
                "      if (error instanceof ResumeError) throw error\n      throw new ResumeError(ref, `resume setup failed:",
            )
        ],
    ),
    (
        "M14 · ⚠️ **the double draws no boundary** · a host test would pass against a runtime the "
        "adapters no longer resemble — killed by `fake-runtime.test.ts`",
        [
            (
                FAKE,
                "    } catch (error) {\n      const said = error instanceof Error ? error.message : String(error)\n      throw new ResumeError(ref, `resume setup failed: ${said}`, { cause: error })\n    }\n",
                "    } catch (error) {\n      throw error\n    }\n",
            )
        ],
    ),
    # ── C · 676 §5 ───────────────────────────────────────────────────────────────────────────
    (
        "M15 · 🔴 **the output read unguarded** · one torn `workflow_run` row RAISES the workflow-output "
        "door — killed by `the-rest-of-r18-and-the-answer-with-no-bound.test.ts`",
        [
            (
                STORE,
                "            json_extract(run.body, '$.outputFile') AS path\n       FROM (SELECT ordinal, json_valid(payload) AS readable,\n                    CASE WHEN json_valid(payload) THEN payload ELSE '{}' END AS body\n",
                "            json_extract(run.body, '$.outputFile') AS path\n       FROM (SELECT ordinal, json_valid(payload) AS readable,\n                    payload AS body\n",
            )
        ],
    ),
    (
        "M16 · 🔴 **the agent's run read unguarded** · a workflow agent's transcript RAISES — killed by "
        "`the-rest-of-r18-and-the-answer-with-no-bound.test.ts`",
        [
            (
                STORE,
                "            json_extract(run.body, '$.taskId') AS taskId\n       FROM (SELECT ordinal, json_valid(payload) AS readable,\n                    CASE WHEN json_valid(payload) THEN payload ELSE '{}' END AS body\n",
                "            json_extract(run.body, '$.taskId') AS taskId\n       FROM (SELECT ordinal, json_valid(payload) AS readable,\n                    payload AS body\n",
            )
        ],
    ),
    (
        "M17 · 🔴 **the roster read unguarded** · a run's journal and script RAISE — killed by "
        "`the-rest-of-r18-and-the-answer-with-no-bound.test.ts`",
        [
            (
                STORE,
                "MIN(run.ordinal) AS seen\n       FROM (SELECT ordinal, CASE WHEN json_valid(payload) THEN payload ELSE '{}' END AS body\n",
                "MIN(run.ordinal) AS seen\n       FROM (SELECT ordinal, payload AS body\n",
            )
        ],
    ),
    (
        # ⚠️ **Re-aimed on its first verification** — it removed the guard's `CASE` and SURVIVED:
        # SQLite evaluates `NOT readable OR json_extract(…)` left to right and never parses a torn
        # row, so the `CASE` here is defence against an order SQLite does not promise and no
        # behaviour can show it (this table's "cannot reach"). What a test CAN see is below.
        "M18 · 🔴 **a torn report is not a candidate** · the sub-agent walk passes over torn rows "
        "unseen, and a `no` over one says it read everything — killed by "
        "`the-rest-of-r18-and-the-answer-with-no-bound.test.ts`",
        [
            (
                STORE,
                "      WHERE NOT reported.readable OR json_extract(reported.body, '$.agentId') = ?`,\n",
                "      WHERE json_extract(reported.body, '$.agentId') = ?`,\n",
            )
        ],
    ),
    (
        "M19 · ⚠️ **skipped in silence** · the walk passes a torn row and counts nothing — the answer "
        "looks as whole as a clean one — killed by `the-rest-of-r18-and-the-answer-with-no-bound.test.ts`",
        [
            (
                STORE,
                "      if (row.readable) return row\n      noteUnreadRow(sessionId, row.ordinal, unread?.in(sessionId))\n",
                "      if (row.readable) return row\n",
            )
        ],
    ),
    (
        "M20 · ⚠️ **a `yes` doubted** · a readable sub-agent report is counted beside the torn row it "
        "outranks — killed by `the-rest-of-r18-and-the-answer-with-no-bound.test.ts`",
        [
            (
                STORE,
                "        if (row.readable) return true\n",
                "        if (row.readable) {\n          for (const ordinal of torn) noteUnreadRow(sessionId, ordinal, unread?.in(sessionId))\n          return true\n        }\n",
            )
        ],
    ),
    (
        "M21 · ⚠️ **the roster counts nothing** · a journal answered over a torn run row says it read "
        "every row — killed by `the-rest-of-r18-and-the-answer-with-no-bound.test.ts`",
        [
            (
                STORE,
                "      for (const torn of selectTornRuns.all(sessionId, generation) as { ordinal: number }[]) {\n        noteUnreadRow(sessionId, torn.ordinal, unread?.in(sessionId))\n      }\n",
                "",
            )
        ],
    ),
    (
        "M22 · ⚠️ **`no-output` drops its count** · a run only torn rows describe reads as one that "
        "reported nothing — killed by `the-rest-of-r18-and-the-answer-with-no-bound.test.ts`",
        [
            (
                HOST,
                "    if (path === null) return { ok: false, reason: 'no-output', rowsUnread: unread.count }\n",
                "    if (path === null) return { ok: false, reason: 'no-output' }\n",
            )
        ],
    ),
    (
        "M23 · ⚠️ **the child door counts nothing** · the candidate lookup is not handed the counter — "
        "killed by `the-rest-of-r18-and-the-answer-with-no-bound.test.ts`",
        [
            (
                HOST,
                "    const found = this.childCandidates(sessionId, input, unread)\n",
                "    const found = this.childCandidates(sessionId, input)\n",
            )
        ],
    ),
    (
        "M24 · ⛔ **the walk does not stop at its answer** · torn rows OLDER than the answer are "
        "counted as passed over — killed by `the-rest-of-r18-and-the-answer-with-no-bound.test.ts`",
        [
            (
                STORE,
                "    for (const row of candidates) {\n      if (row.readable) return row\n",
                "    let found: Row | undefined\n    for (const row of candidates) {\n      if (row.readable) {\n        found ??= row\n        continue\n      }\n      if (found !== undefined) {\n        noteUnreadRow(sessionId, row.ordinal, unread?.in(sessionId))\n        continue\n      }\n",
            ),
            (
                STORE,
                "      noteUnreadRow(sessionId, row.ordinal, unread?.in(sessionId))\n    }\n    return undefined\n",
                "      noteUnreadRow(sessionId, row.ordinal, unread?.in(sessionId))\n    }\n    return found\n",
            ),
        ],
    ),
    # ── D · 672 H1/H2 ────────────────────────────────────────────────────────────────────────
    (
        "M25 · ⚑ **a bare `#3` handed out** · *\"the most recent is #3, to child\"* — killed by "
        "`the-two-projects-the-digest-still-reads-partly.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # holds: a hand-out line must name the piece by its label, never a bare number. D-016
        # replaced taskCalled(number) with pieceLine(label, title), so the plant is the bare-number
        # form of the label (last segment of W1.3, written '#3'). Killed by
        # `the-two-projects-the-digest-still-reads-partly.test.ts`.
        [
            (DIGEST, '`${pieceLine(event.label, event.title)}, to ${name(row.sessionId)}`', "`#${event.label.slice(event.label.lastIndexOf('.') + 1)}, to ${name(row.sessionId)}`"),
        ],
    ),
    (
        "M26 · ⚑ **a bare `#3` reported** · *\"child reported #3 done\"* — killed by "
        "`the-two-projects-the-digest-still-reads-partly.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule holds
        # for a reply: 'child reported W1.3 · the job done'. The named-piece arm is now
        # pieceLine(named.label, named.title), so the bare '#3' plant replaces that arm and leaves
        # the 'work it was given before this window' arm alone. The old anchor is extended over the
        # preceding line because pieceLine(named.label, named.title) occurs twice. Killed by
        # `the-two-projects-the-digest-still-reads-partly.test.ts`.
        [
            (DIGEST, "? 'work it was given before this window'\n            : pieceLine(named.label, named.title)", "? 'work it was given before this window'\n            : `#${named.label.slice(named.label.lastIndexOf('.') + 1)}`"),
        ],
    ),
    (
        "M27 · ⚑ **a bare `#3` taken back** — killed by "
        "`the-two-projects-the-digest-still-reads-partly.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # holds: the taken-back line names the piece by label and title. The arm is now `named ===
        # undefined ? null : pieceLine(named.label, named.title)`. The plant keeps the undefined
        # branch and draws the bare number for a named piece. Killed by
        # `the-two-projects-the-digest-still-reads-partly.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # digest still names a taken-back piece with pieceLine; D-016c added a `work_closed` arm
        # right after it with the identical `named === undefined ? null : pieceLine(named.label,
        # named.title),` line, so the bare old string now matches twice. The new anchor starts at
        # `'work-taken-back',\n row.at,` and is unique (count 1); the plant is the same bare `#n`
        # naming. Killed by `the-two-projects-the-digest-still-reads-partly.test.ts`.
        [
            (DIGEST, "          'work-taken-back',\n          row.at,\n          named === undefined ? null : pieceLine(named.label, named.title),\n", "          'work-taken-back',\n          row.at,\n          named === undefined ? null : `#${named.label.slice(named.label.lastIndexOf('.') + 1)}`,\n"),
        ],
    ),
    (
        "M28 · ⚑ **a bare `#3` not sent** — killed by "
        "`the-two-projects-the-digest-still-reads-partly.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # holds: a held message that was not sent names the piece it carried by label and title. The
        # arm is now bump(tally, 'work-not-sent', row.at, pieceLine(held.label, held.title)). The
        # plant draws the bare number there. Killed by
        # `the-two-projects-the-digest-still-reads-partly.test.ts`.
        [
            (DIGEST, "bump(tally, 'work-not-sent', row.at, pieceLine(held.label, held.title))", "bump(tally, 'work-not-sent', row.at, `#${held.label.slice(held.label.lastIndexOf('.') + 1)}`)"),
        ],
    ),
    (
        "M29 · ⚑ **a bare `#3` asked about** — killed by "
        "`the-two-projects-the-digest-still-reads-partly.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # holds: the question-about-work line names the piece by the label the question_asked row
        # carries. Today the arm is bump(..., event.label ?? null) with no helper, so the plant
        # draws the bare last number of that label instead, and keeps the null branch. Killed by
        # `the-two-projects-the-digest-still-reads-partly.test.ts`.
        [
            (DIGEST, "bump(tally, 'question-about-work', row.at, event.label ?? null)", "bump(tally, 'question-about-work', row.at, event.label === undefined ? null : `#${event.label.slice(event.label.lastIndexOf('.') + 1)}`)"),
        ],
    ),
    (
        "M30 · ⚠️ **the dead sentence back** · *\"Work #3 with Pam…\"*, a third name for one task, "
        "exported again — killed by `one-task-one-name.test.ts`",
        [
            (
                STALLED,
                "/*\n * ⛔ **697 · `672` H2 — `stalledWorkSays` is gone.**",
                "export const stalledWorkSays = (work: StalledWork): string =>\n  `Work #${String(work.number)} with ${work.assignedToName} is not being worked on.`\n\n/*\n * ⛔ **697 · `672` H2 — `stalledWorkSays` is gone.**",
            )
        ],
    ),
    # ── E · 685 H3 ───────────────────────────────────────────────────────────────────────────
    # RETIRED: the former JSON/order/echo contract was removed.
    (
        "M31 · ⚑ **the ambiguous claim back** · *\"Both providers deliver structured content\"* — which "
        "neither adapter sends — killed by `a-claude-answer-is-two-blocks.test.ts`",
        [
            (
                AGENT_TOOLS,
                "   * ⚑ **Both adapters hand it to the model as a SECOND TEXT part**",
                "   * ⚑ Both providers deliver structured content alongside the text. **Both adapters hand it to the model as a SECOND TEXT part**",
            )
        ],
    ),
    # RETIRED: the former JSON/order/echo contract was removed.
    (
        "M32 · ⚑ **Codex only again** · the runtime's order sentence forgets Claude's two blocks — "
        "killed by `a-claude-answer-is-two-blocks.test.ts`",
        [
            (
                TOOL_ANSWER,
                "app sends the prose first and the payload second on BOTH providers",
                "app sends the prose first and the payload second",
            )
        ],
    ),
    (
        "M33 · ⚑ **the probe quotes the retired sentence as today's** — killed by "
        "`a-claude-answer-is-two-blocks.test.ts`",
        [
            (
                ANSWER_PROBE,
                "the renderer's `tool-answer.ts` called Claude unmeasured.",
                "the renderer's `tool-answer.ts` says *\"this app has no measurement of the equivalent on Claude\"*.",
            )
        ],
    ),
    # ── F · 695 F-g ──────────────────────────────────────────────────────────────────────────
    (
        "M34 · 🔒 **the withdrawn exception back in §6** · a live identity is told one seat may use "
        "`:9444` — killed by `permission-matrix-security.test.mjs`",
        [
            (
                BLOCK,
                "> 🔴 **NO SEAT IS EXEMPT — not even the frontend**",
                "> 🔴 **ONE SEAT IS EXEMPT FROM THE FIRST SENTENCE, AND ONLY THE FIRST**",
            )
        ],
    ),
    # ── G · 695 F-a, F-h ─────────────────────────────────────────────────────────────────────
    (
        "M35 · 🔴 **`probe:drop` shows its window** · a BroBot-looking page on the person's screen for the "
        "whole run — killed by `hidden-launch.test.mjs`",
        [(DROP, "    show: false,\n", "    show: true,\n")],
    ),
    (
        "M36 · ⚠️ **…or shows it another way** · `maximize()` puts a `show: false` window on screen — "
        "killed by `hidden-launch.test.mjs`",
        [
            (
                DROP,
                "  win.webContents.setBackgroundThrottling(false)\n",
                "  win.webContents.setBackgroundThrottling(false)\n  win.maximize()\n",
            )
        ],
    ),
    (
        "M37 · 🔴 **the README's recipe on `:9222` again** — killed by `hidden-launch.test.mjs`",
        [
            (
                README,
                "  pnpm --filter @brobot2/desktop exec electron-vite dev --remoteDebuggingPort <free> \\\n",
                "  pnpm --filter @brobot2/desktop exec electron-vite dev --remoteDebuggingPort 9222 \\\n",
            )
        ],
    ),
    (
        "M38 · 🔴 **the recipe's window shown** · the switch dropped from the seat's launch — killed by "
        "`hidden-launch.test.mjs`",
        [
            (
                README,
                "  -- --user-data-dir=<a scratch directory> --brobot-hidden\n",
                "  -- --user-data-dir=<a scratch directory>\n",
            )
        ],
    ),
    # ── H · the reopen-grant verdict ─────────────────────────────────────────────────────────
    (
        "M39 · ⛔ **the F1 check blind** · no card is ever reported as promising more than it grants — "
        "killed by `codex-reopen-grant-evidence.test.ts`",
        [
            (
                EVIDENCE,
                "  return cards.filter((card) => card.persistence !== persistenceOf(card.availableDecisions))\n",
                "  return cards.filter(() => false)\n",
            )
        ],
    ),
    (
        "M40 · ⛔ **the in-server control ignored** · a grant that never held reads as one the reopen "
        "forgot — killed by `codex-reopen-grant-evidence.test.ts`",
        [
            (
                EVIDENCE,
                "  if (cardsIn(cards, turns.control, 'file').length > 0) {\n",
                "  if (cardsIn(cards, turns.control, 'file').length > 99) {\n",
            )
        ],
    ),
    (
        "M41 · ⛔ **a grant not taken reads as survived** · the answer's fate is not read — killed by "
        "`codex-reopen-grant-evidence.test.ts`",
        [
            (
                EVIDENCE,
                "      (card) => card.answer.outcome === 'allow_for_session' && card.answer.accepted === true,\n",
                "      (card) => card.answer.outcome === 'allow_for_session',\n",
            )
        ],
    ),
]
