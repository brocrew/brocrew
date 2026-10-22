"""713 · Compact, on both providers.

⚑ **Ordered by** the PM — `708` H-2, H-3, H-4, H-5 (ruled `R58`, `R59`, `R60`).

## 🔴 A · `R59` — Codex's own compaction, asked for, and run as the turn it is (M1-M10, M21-M26)

⚑ Measured by `probe:codex-command-as-typed` against the bundled 0.146.0: `thread/compact/start`
answers `{}`, then runs as a turn of its own — `turn/started` under a NEW id, a `contextCompaction`
item, `turn/completed` — so the adapter binds that turn from its `turn/started` (the one bind it
takes from a notification), refuses the previous turn's id there, bounds a compaction that never
starts, and marks the compaction it asked for `manual`.

## 🔴 B · `R59` at the host — a person's `/compact`, on a handle that compacts on request (M11-M16)

## 🔴 C · `708` H-4 — interrupt-and-send carries its first gate's answer (M17-M19)

## ⚑ D · `R60` — the capability's note says what the road takes (M20)

## ⛔ What this table cannot reach

 * ⚠️ **The live probe** (`probe:codex-command-as-typed`, nine arms, loopback, $0) — not in `ci`;
   its table is in `713`'s response.
 * ⚠️ **`smoke:ui` step 7d's normalisation** (`708` H-5) — a live path, run hidden for `713` on
   `main` (RED: *"the screen is not in debug: normal"*) and on this branch (green), with its control.
 * ⚠️ **The fake runtime's `compactsOnRequest`** — a double; what it stands for is the Codex adapter,
   which section A mutates directly.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RULE = "apps/desktop/src/main/runtime/a-command-goes-as-typed.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
CODEX_CAPS = "packages/runtime/src/codex/capabilities.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the Codex adapter ───────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **a compaction's turn never binds** — Codex's `turn/started` is read the old way, so "
        "its item is dropped by the turn gate and the turn never ends — killed by "
        "`codex-runtime.test.ts` (713)",
        [(CODEX, "      if (this.bindsACompactionAt(startedId)) {\n        this.bindProviderTurn(startedId)\n", "      if (false) {\n        this.bindProviderTurn(startedId)\n")],
    ),
    (
        "M2 · ⛔ **a late duplicate of the turn BEFORE binds the compaction** — 037's hazard, on the "
        "one bind that reads a notification — killed by `codex-runtime.test.ts` (713)",
        [(CODEX, "      startedId !== '' &&\n      startedId !== this.lastBoundTurnId\n", "      startedId !== ''\n")],
    ),
    (
        "M3 · ⛔ **the id bound last is never recorded** — so nothing can refuse it at a compaction's "
        "bind — killed by `codex-runtime.test.ts` (713)",
        [(CODEX, "    turn.providerTurnId = providerTurnId\n    this.lastBoundTurnId = providerTurnId\n", "    turn.providerTurnId = providerTurnId\n")],
    ),
    (
        "M4 · 🔴 **an accepted compaction that never starts is left `working` forever** — the bound "
        "fails nothing — killed by `codex-runtime.test.ts` (713)",
        [(CODEX, "      this.compactionOutstanding = true\n      this.machine.failTurn(\n        `Codex accepted the compaction and did not start it within ` +", "      this.compactionOutstanding = true\n      void this.machine.failTurn.name.concat(\n        `Codex accepted the compaction and did not start it within ` +")],
    ),
    (
        "M5 · ⛔ **the bound fails a compaction that DID start** — its guard stops asking whether the "
        "turn bound — killed by `codex-runtime.test.ts` (713)",
        [(CODEX, "      if (this.terminated || this.currentTurn !== turn || turn.providerTurnId !== null) return\n", "      if (this.terminated || this.currentTurn !== turn) return\n")],
    ),
    (
        "M6 · ⛔ **a request Codex refuses leaves the turn open** — the session sits `working` with "
        "nothing driving it — killed by `codex-runtime.test.ts` (713)",
        [(CODEX, "        this.machine.failTurn(`thread/compact/start failed: ${errorMessage(error)}`)\n", "")],
    ),
    (
        "M7 · 🔴 **the compaction BroBot asked for says nothing about who asked** — Claude's row reads "
        "*at someone's request* and Codex's does not — killed by `codex-runtime.test.ts` (713)",
        [(CODEX, "    return { ...event, trigger: 'manual' }\n", "    return event\n")],
    ),
    (
        "M8 · ⛔ **every compaction is marked `manual`** — Codex's automatic one inside an ordinary "
        "turn claims a person asked — killed by `codex-runtime.test.ts` (713)",
        [(CODEX, "    if (event.type !== 'compaction' || this.currentTurn?.bindsAtItsStart !== true) return event\n", "    if (event.type !== 'compaction') return event\n")],
    ),
    (
        "M9 · ⛔ **a compaction starts over a running turn** — the refusal `send` makes is not made "
        "— killed by `codex-runtime.test.ts` (713)",
        [(CODEX, "    if (turn === null) throw this.machine.refusedTurn()\n", "")],
    ),
    (
        "M10 · ⛔ **the request names no thread** — Codex is asked to compact nothing in particular "
        "— killed by `codex-runtime.test.ts` (713)",
        [(CODEX, "    const params: ThreadCompactStartParams = { threadId: this._ref!.sessionId }\n", "    const params: ThreadCompactStartParams = { threadId: '' }\n")],
    ),
    # ── B · the host decides `R59` ──────────────────────────────────────────────────────────
    (
        "M11 · 🔴 **a person's `/compact` on Codex goes to the model as words again** — `708` H-2's "
        "defect — killed by `compact-on-both-providers.test.ts` (713)",
        # ⚑ **W4.475 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. The compaction's branch now writes whose turn it is just before its call; the same plant, the same killer. No plant or table run.
        [(HOST, "    if (session.handle.compact !== undefined && aPersonsCompaction(text, from) !== null) {\n      this.aTurnIsHandedOver(session, whose, askedForTheStop)\n      return session.handle.compact()\n", "    if (session.handle.compact !== undefined && aPersonsCompaction(text, from) !== null && false) {\n      this.aTurnIsHandedOver(session, whose, askedForTheStop)\n      return session.handle.compact()\n")],
    ),
    (
        "M12 · ⛔ **any sender's `/compact` runs the compaction** — an agent compacts another "
        "conversation by messaging it — killed by `compact-on-both-providers.test.ts` (713)",
        [(RULE, "  if (from?.who !== 'a-person') return null\n", "  if (from === undefined) return null\n")],
    ),
    (
        "M13 · 🔴 **`/compact <instructions>` compacts and drops them in silence** — `R59`'s last "
        "clause — killed by `compact-on-both-providers.test.ts` (713)",
        [(HOST, "        if (compaction.instructions !== null) {\n          throw new ACompactionTakesNoInstructions(session.provider)\n        }\n", "")],
    ),
    (
        "M14 · ⛔ **`/compact` with a file compacts and drops the file in silence** — `R42`'s fourth "
        "clause, one command over — killed by `compact-on-both-providers.test.ts` (713)",
        [(HOST, "        if (content.attached > 0) throw new ACommandTakesNoAttachments(compaction.word, true)\n", "")],
    ),
    (
        "M15 · ⛔ **the gate asks the provider's NAME's question of every handle** — Claude's "
        "`/compact <instructions>`, which its CLI takes, is refused — killed by "
        "`compact-on-both-providers.test.ts` (713)",
        [(HOST, "    if (session.handle.compact !== undefined) {\n      const compaction = aPersonsCompaction(content.text, content.from)\n", "    if (true) {\n      const compaction = aPersonsCompaction(content.text, content.from)\n")],
    ),
    (
        "M16 · ⛔ **the handover calls a door Claude does not have** — a person's `/compact` on Claude "
        "throws instead of going as typed — killed by `compact-on-both-providers.test.ts` (713)",
        # ⚑ **W4.475 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. The compaction's branch now writes whose turn it is just before its call; the same plant, the same killer. No plant or table run.
        [(HOST, "    if (session.handle.compact !== undefined && aPersonsCompaction(text, from) !== null) {\n      this.aTurnIsHandedOver(session, whose, askedForTheStop)\n      return session.handle.compact()\n", "    if (aPersonsCompaction(text, from) !== null) {\n      this.aTurnIsHandedOver(session, whose, askedForTheStop)\n      return session.handle.compact!()\n")],
    ),
    # ── C · `708` H-4 ───────────────────────────────────────────────────────────────────────
    (
        "M17 · 🔴 **the second gate asks the moved list again** — a command with files is refused "
        "AFTER the running turn was stopped — killed by `a-command-goes-as-typed.test.ts` (713)",
        [(HOST, "    if (content.decided !== undefined) return content.decided\n", "")],
    ),
    (
        "M18 · ⛔ **the handover decides again** — a command the first gate let through is framed "
        "after the stop — killed by `a-command-goes-as-typed.test.ts` (713)",
        [(HOST, "      decided !== undefined\n        ? decided.command\n        : aPersonsCommand(", "      decided === null\n        ? decided\n        : aPersonsCommand(")],
    ),
    (
        "M19 · ⛔ **interrupt-and-send carries a verdict nobody reached** — every replacement is an "
        "ordinary message, so a person's `/compact` there is framed — killed by "
        "`a-command-goes-as-typed.test.ts` (713)",
        # ⚑ Re-anchored in place, not retired — the call also hands down whether the first gate found the
        # sign-in moved. Same defect.
        [(HOST, "      await this.runSendInterrupting(session, text, attachments, by, decided, itsSignInMoved)\n", "      await this.runSendInterrupting(session, text, attachments, by, { command: null }, itsSignInMoved)\n")],
    ),
    # ── D · `R60` ───────────────────────────────────────────────────────────────────────────
    (
        "M20 · ⛔ **Codex's note stops saying its road takes no instructions** — the one place a "
        "person reads it before the refusal does — killed by `compact-on-both-providers.test.ts` (713)",
        # Provider facts live in the shared registry; this row plants the same fault there.
        [("packages/shared/src/providers/codex-capabilities.ts", "compaction request — Codex takes no instructions for one',", "compaction request',")],
    ),
    # ── A, from 713's review · a compaction the bound gave up on (M22-M26) ─────────────────
    (
        "M22 · 🔴 **a second compaction begins while a given-up one may still start** — the first's "
        "late start is then bound to the second's request and drawn as it — killed by "
        "`codex-runtime.test.ts` (713)",
        [(CODEX, "    if (this.compactionOutstanding) throw new Error(A_COMPACTION_IS_STILL_OUTSTANDING)\n", "")],
    ),
    (
        "M23 · ⛔ **the give-up forgets what it gave up on** — nothing marks the accepted compaction as "
        "outstanding, so the next one is let through — killed by `codex-runtime.test.ts` (713)",
        [(CODEX, "      this.currentTurn = null\n      this.compactionOutstanding = true\n", "      this.currentTurn = null\n")],
    ),
    (
        "M24 · ⛔ **the stray showing itself clears nothing** — a compaction stays refused after the one "
        "it waited for has started — killed by `codex-runtime.test.ts` (713)",
        [(CODEX, "      if (!this.isCurrentProviderTurn(startedId)) this.compactionOutstanding = false\n", "")],
    ),
    (
        "M25 · ⛔ **our OWN turn's start is taken for the stray** — the wait clears on the wrong "
        "`turn/started` — killed by `codex-runtime.test.ts` (713)",
        [(CODEX, "      if (!this.isCurrentProviderTurn(startedId)) this.compactionOutstanding = false\n", "      this.compactionOutstanding = false\n")],
    ),
    (
        "M26 · ⛔ **a turn of ours running to its end clears nothing** — `send a message` is no way out "
        "of the wait, as the sentence says it is — killed by `codex-runtime.test.ts` (713)",
        [(CODEX, "      if (ours) this.compactionOutstanding = false\n", "")],
    ),
    # ── A, once more · the early interrupt at the bind ──────────────────────────────────────
    (
        "M21 · ⛔ **the bind's early interrupt is sent AGAIN by the `turn/started` resend** — two "
        "`turn/interrupt`s for one Stop — killed by `codex-runtime.test.ts` (713)",
        [(CODEX, "        this.bindProviderTurn(startedId)\n        return\n      }\n", "        this.bindProviderTurn(startedId)\n      }\n")],
    ),
]


if __name__ == "__main__":
    raise SystemExit("run through mutate.sh, never directly")
