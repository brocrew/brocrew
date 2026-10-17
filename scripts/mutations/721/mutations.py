"""721 · A cleared conversation can be reopened.

⚑ **Ordered by** the PM — `715` F-1, F-2 and F-6, ruled `R75`, `R76` and `R77`.

## 🔴 A · `R75` — after a `/clear`, the ref follows the transcript (M1-M6)

A `conversation_reset` frame no longer moves the ref: the Claude adapter remembers it
(`resetPending`) and the NEXT `system/init` of the launch moves the ref to ITS id, keeping the cwd and
rotation the ref is on (`refAfterReset`). Measured (`probe:claude-resume-after-cd`): the reset's own
`new_conversation_id` has no transcript and no resume opens it. `199 M2` and `M7` are retired by
this ruling, and `199 M3`/`M5` were re-anchored in place onto the new door.

## 🔴 B · `R76` — a reset before the first init is the person's own command (M7-M12)

On a resume, a first init after a reset whose `session_id` IS the conversation asked for is let
through the barrier with a different id (never a different cwd); the session opens naming the target
and moves, with a seam, to the init's id.

## 🔴 C · `R77` — the scan places a path from where the CLI will run it, too (M13-M25, M27-M31)

The `PreToolUse` hook records the `cwd` the CLI hands it, per call and AS REPORTED
(`WhereCallsRun.record`; a `Bash` call records none); the second door recalls it by the call's
tool-use id. Every relative path is placed from the launch folder AND from that folder — resolved
there exactly as the CLI resolves it, the RESULT then re-spelled under an own root's host spelling
(`inTheOwnSpelling`) — and the worse answer stands (`placeWhereItRuns`): `721`'s review, a server
resolving from its own launch folder was not measured. The carve-out still reads the launch `cwd`.

## ⚑ D · the reset row cites both frames (M26)

## ⛔ What this table cannot reach

 * ⚠️ **The provider.** Every row drives scripted frames or a scripted hook input. What the CLI
   sends was measured by the probes (`probe:claude-resume-after-cd`, `probe:claude-scan-after-cd`,
   loopback, $0) and by `ui-live-smoke` steps `84` and `85` (hidden, Haiku) — not in `ci`; their
   runs are in `721`'s response.
 * ⚠️ **Three pre-existing holes the probe measured beside R77** — arm F (an ancestor, `../..`), G (a
   `~/` path: the CLI expands it, the scan does not) and H (a leading space: the CLI trims it, the
   scan does not) all read the protected root on this branch as on `main`; no row here claims them.
   Reported.
"""

ADAPTER = "packages/runtime/src/claude/claude-runtime.ts"
CONFINEMENT = "packages/runtime/src/internal/confinement.ts"

MOVE_EMIT = "          if (moved) this.emit({ type: 'conversation_reset', ref: moved, source: RESET_SOURCE })\n"

# The scan from the CLI’s own folder no longer exists. Keep these removed-code anchors recorded as
# retired because their planted behavior is now intended.
MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · R75, the ref follows the transcript ─────────────────────────────────────────────────
    (
        "M1 · 🔴 **the reset is never remembered** — a `/clear` moves no ref, and a reopen whose first "
        "message is `/clear` dies at the barrier — killed by `claude-runtime.test.ts` (721 R75, R76)",
        [(ADAPTER, "        if (reset) this.resetPending = reset\n", "")],
    ),
    (
        "M2 · 🔴 **the move is never emitted** — the reset is remembered and spent, and the row goes on "
        "naming the conversation the `/clear` left — killed by `claude-runtime.test.ts` (721 R75)",
        [
            (
                ADAPTER,
                "          const moved = refAfterReset(this._ref, candidate.sessionId)\n" + MOVE_EMIT,
                "          refAfterReset(this._ref, candidate.sessionId)\n",
            )
        ],
    ),
    (
        "M3 · 🔴 **`199`'s source, restored: the reset moves the ref to its OWN id** — the one with no "
        "transcript, which no Resume opens — killed by `claude-runtime.test.ts` (721 R75)",
        [
            (
                ADAPTER,
                "        if (reset) this.resetPending = reset\n",
                "        if (reset) {\n"
                "          this.resetPending = reset\n"
                "          const own = (message as { new_conversation_id?: unknown }).new_conversation_id\n"
                "          const named = refAfterReset(this._ref, typeof own === 'string' ? own : '')\n"
                "          if (named) this.emit({ type: 'conversation_reset', ref: named, source: 'conversation_reset' })\n"
                "        }\n",
            )
        ],
    ),
    (
        "M4 · ⛔ **the R75 arm never spends the reset** — every later init moves the ref, which is R64's "
        "defect back — killed by `claude-runtime.test.ts` (721 R75, one reset moves the ref ONCE)",
        [
            (
                ADAPTER,
                "          this.resetPending = null\n"
                "          const moved = refAfterReset(this._ref, candidate.sessionId)\n",
                "          const moved = refAfterReset(this._ref, candidate.sessionId)\n",
            )
        ],
    ),
    (
        "M5 · ⛔ **the opening init never spends the reset** — a reset before the handshake hands the "
        "NEXT later init the ref — killed by `claude-runtime.test.ts` (721, a reset before the "
        "handshake is spent on the init that opens the session)",
        [
            (
                ADAPTER,
                "          this.resetPending = null\n"
                "          const validated = this.validateInitRef(candidate, rawInitCwd, afterTheirReset)\n",
                "          const validated = this.validateInitRef(candidate, rawInitCwd, afterTheirReset)\n",
            )
        ],
    ),
    (
        "M6 · ⛔ **the moved ref is the init's own** — it carries the folder the model `cd`'d into, and "
        "a resume asks for a transcript in the wrong place (715) — killed by `claude-runtime.test.ts` "
        "(721 R75, keeps the LAUNCH cwd)",
        [
            (
                ADAPTER,
                "          const moved = refAfterReset(this._ref, candidate.sessionId)\n",
                "          const moved = candidate.sessionId === this._ref?.sessionId ? null : candidate\n",
            )
        ],
    ),
    # ── B · R76, a reopen's own /clear ──────────────────────────────────────────────────────────
    (
        "M7 · 🔴 **THE DEFECT, restored: the first init after the target's own reset is held to the "
        "exact id** (`main`, `715` F-2: *\"resume mismatch\"*) — killed by `claude-runtime.test.ts` "
        "(721 R76)",
        [
            (
                ADAPTER,
                "      const sameConversation = afterTheirReset || candidate.sessionId === this._targetRef.sessionId\n",
                "      const sameConversation = candidate.sessionId === this._targetRef.sessionId\n",
            )
        ],
    ),
    (
        "M8 · ⛔ **any reset lets another conversation in** — the proof that the CLI resumed THIS one is "
        "not read — killed by `claude-runtime.test.ts` (721 R76 CONTROL, a reset from ANOTHER "
        "conversation)",
        [
            (
                ADAPTER,
                "            this.resetPending?.from === this._targetRef.sessionId\n",
                "            this.resetPending !== null\n",
            )
        ],
    ),
    (
        "M9 · ⛔ **no reset needed** — every reopen's first init may name any conversation, which is "
        "the barrier gone — killed by `claude-runtime.test.ts` (715 R64 / 011 controls)",
        [
            (
                ADAPTER,
                "            this._targetRef !== null &&\n"
                "            this.resetPending?.from === this._targetRef.sessionId\n",
                "            this._targetRef !== null\n",
            )
        ],
    ),
    (
        "M10 · ⛔ **the cwd is waived after a reset** — the ruling relaxed the id and nothing else — "
        "killed by `claude-runtime.test.ts` (721 R76 CONTROL, must still name the LAUNCH folder)",
        [
            (
                ADAPTER,
                "      if (!sameConversation || rawInitCwd !== this._targetRef.cwd) {\n",
                "      if (!sameConversation || (!afterTheirReset && rawInitCwd !== this._targetRef.cwd)) {\n",
            )
        ],
    ),
    (
        "M11 · ⛔ **the reopen opens AS the new conversation** — `session resumed` names one nothing "
        "resumed, and no seam is drawn — killed by `claude-runtime.test.ts` (721 R76)",
        [
            (
                ADAPTER,
                "          if (afterTheirReset && validated.sessionId !== this._targetRef?.sessionId) {\n",
                "          if (afterTheirReset && validated.sessionId === '') {\n",
            )
        ],
    ),
    (
        "M12 · ⛔ **no move after the opening** — the row keeps the conversation the `/clear` emptied — "
        "killed by `claude-runtime.test.ts` (721 R76)",
        [
            (
                ADAPTER,
                "            this.emit({ type: 'conversation_reset', ref: validated, source: RESET_SOURCE })\n",
                "",
            )
        ],
    ),
    # ── C · R77, where a path is placed from ────────────────────────────────────────────────
    (
        "M13 · 🔴 **THE DEFECT, restored: a relative path is placed from the launch folder alone** "
        "(`main`, `715` F-6) — killed by `confinement.test.ts` and `claude-runtime.test.ts` (721 R77)",
        [
            (
                CONFINEMENT,
                "  if (running === null || isAbsolute(raw)) return fromLaunch\n",
                "  return fromLaunch\n",
            )
        ],
    ),
    (
        "M14 · ⛔ **the hook never records where the CLI runs** — killed by `claude-runtime.test.ts` "
        "(721 R77)",
        [
            (
                ADAPTER,
                "            confinement.runningIn?.record(\n"
                "              input.tool_use_id,\n"
                "              input.tool_name === 'Bash' ? null : input.cwd,\n"
                "            )\n",
                "",
            )
        ],
    ),
    (
        "M15 · ⛔ **a relative folder is trusted** — resolved from this process's own cwd, a guess — "
        "killed by `claude-runtime.test.ts` (721 R77 CONTROLS, the long way round)",
        [
            (
                CONFINEMENT,
                "    const folder = typeof reported === 'string' && isAbsolute(reported) ? resolve(reported) : null\n",
                "    const folder = typeof reported === 'string' ? resolve(reported) : null\n",
            )
        ],
    ),
    (
        "M16 · ⛔ **the last folder sticks** — a call that reports none is placed from the previous "
        "call's — killed by `claude-runtime.test.ts` (721 R77 CONTROLS)",
        [(CONFINEMENT, "    this.cwd = folder\n", "    if (folder !== null) this.cwd = folder\n")],
    ),
    (
        "M17 · ⛔ **the carve-out moves with the shell** — the running folder REPLACES the launch "
        "folder as an own root — killed by `confinement.test.ts` (721 R77, a path inside the moved "
        "folder is still the session's own: the launch folder is no longer one)",
        [
            (
                CONFINEMENT,
                "  for (const root of [confinement.cwd, confinement.providerHome]) {\n",
                "  for (const root of [confinement.runningIn?.cwd ?? confinement.cwd, confinement.providerHome]) {\n",
            )
        ],
    ),
    (
        "M18 · ⛔ **the launch never arms the record** — the hook has nowhere to write, and places from "
        "the launch folder as `main` did — killed by `claude-runtime.test.ts` (721 R77)",
        [(ADAPTER, "    runningIn: new WhereCallsRun(),\n", "")],
    ),
    (
        "M19 · ⛔ **the result is never re-spelled** — under a symlinked `userData` every relative path "
        "from the CLI's real folder lands in the protected root's real half, and a session refuses "
        "everything — killed by `confinement.test.ts` (721 R77, re-spelled under the launch folder)",
        [
            (
                CONFINEMENT,
                "  const fromRunning = place(inTheOwnSpelling(resolve(running, raw), roots), running, roots)\n",
                "  const fromRunning = place(resolve(running, raw), running, roots)\n",
            )
        ],
    ),
    (
        "M20 · ⛔ **the moved folder REPLACES the launch folder** — a string `main` refused, which a "
        "server launched in the cwd would resolve into the root, passes — killed by `confinement.test.ts` "
        "and `claude-runtime.test.ts` (721 R77, the launch folder still counts)",
        [
            (
                CONFINEMENT,
                "  return WORSE[fromRunning] > WORSE[fromLaunch] ? fromRunning : fromLaunch\n",
                "  return fromRunning\n",
            )
        ],
    ),
    (
        "M21 · ⛔ **the better answer stands** — `own` from either folder is own — killed by "
        "`confinement.test.ts` and `claude-runtime.test.ts` (721 R77)",
        [
            (
                CONFINEMENT,
                "  return WORSE[fromRunning] > WORSE[fromLaunch] ? fromRunning : fromLaunch\n",
                "  return WORSE[fromRunning] < WORSE[fromLaunch] ? fromRunning : fromLaunch\n",
            )
        ],
    ),
    (
        "M22 · ⛔ **the second door recalls nothing** — it places a call from whatever the LAST hook "
        "heard — killed by `claude-runtime.test.ts` (721 R77, the folder the hook recorded for THAT "
        "call)",
        [(ADAPTER, "        confinement.runningIn?.recall(o.toolUseID)\n", "")],
    ),
    (
        "M23 · ⛔ **the second door ignores its own call** — always the last folder reported — killed "
        "by `claude-runtime.test.ts` (721 R77, the folder the hook recorded for THAT call)",
        [
            (
                CONFINEMENT,
                "      typeof toolUseId === 'string' && this.byCall.has(toolUseId)\n",
                "      typeof toolUseId === 'string' && this.byCall.has(toolUseId) && false\n",
            )
        ],
    ),
    (
        "M24 · ⛔ **a call no hook saw is placed from the launch folder alone** — the second door's "
        "fallback lost — killed by `claude-runtime.test.ts` (721 R77, a call no hook saw)",
        [(CONFINEMENT, "        : this.last\n", "        : null\n")],
    ),
    (
        "M25 · ⛔ **the CARD is placed from the launch folder alone** — in `ask`, a read after `cd` "
        "elsewhere is the session's own — killed by `claude-runtime.test.ts` (721 R77, in `ask`) and "
        "`confinement.test.ts`",
        [
            (
                CONFINEMENT,
                "    const placement = placeWhereItRuns(path, confinement, roots)\n",
                "    const placement = place(path, confinement.cwd, roots)\n",
            )
        ],
    ),
    (
        "M27 · 🔴 **the FOLDER is re-spelled before resolving** — `721`'s first rework, restored: a "
        "`..` above a linked project collapses against the host's spelling, not where the CLI runs, "
        "and R77's hole reopens — killed by `confinement.test.ts` (721 R77, a `..` climbs from the "
        "folder the CLI REALLY runs in)",
        [
            (
                CONFINEMENT,
                "  const fromRunning = place(inTheOwnSpelling(resolve(running, raw), roots), running, roots)\n",
                "  const fromRunning = place(raw, inTheOwnSpelling(running, roots), roots)\n",
            )
        ],
    ),
    (
        "M28 · ⛔ **the carve-out grows with the shell** — the running folder is ADDED to the own "
        "roots, so a protected folder the shell reached is owned — killed by `confinement.test.ts` "
        "(721 R77, the carve-out does not move)",
        [
            (
                CONFINEMENT,
                "  for (const root of [confinement.cwd, confinement.providerHome]) {\n",
                "  for (const root of [confinement.cwd, ...(confinement.runningIn?.cwd ? [confinement.runningIn.cwd] : []), confinement.providerHome]) {\n",
            )
        ],
    ),
    (
        "M29 · ⛔ **a call whose hook reported no folder borrows the last one** — killed by "
        "`claude-runtime.test.ts` (721 R77, the folder the hook recorded for THAT call)",
        [
            (
                CONFINEMENT,
                "        ? (this.byCall.get(toolUseId) ?? null)\n",
                "        ? (this.byCall.get(toolUseId) ?? this.last)\n",
            )
        ],
    ),
    (
        "M30 · ⛔ **`unresolvable` ranks below `own`** — a link in the moved folder that cannot be "
        "followed passes on the launch folder's word (183's hole, from the moved folder) — killed "
        "by `confinement.test.ts` (721 R77, a link that cannot be followed)",
        [(CONFINEMENT, "  unresolvable: 2,\n", "  unresolvable: 0,\n")],
    ),
    (
        "M31 · ⛔ **a `Bash` command is placed from the shell's folder** — a shell inside the app's "
        "data refuses the `cd` that leaves it — killed by `claude-runtime.test.ts` (721 R77, a shell "
        "INSIDE the app's data)",
        [
            (
                ADAPTER,
                "              input.tool_name === 'Bash' ? null : input.cwd,\n",
                "              input.cwd,\n",
            )
        ],
    ),
    # ── D · the reset row's citation ────────────────────────────────────────────────────────────
    (
        "M26 · ⛔ **the row cites the reset alone** — it names an id that frame does not carry — "
        "killed by `claude-runtime.test.ts` (721 R75, R76)",
        [
            (
                ADAPTER,
                "const RESET_SOURCE = 'conversation_reset + system/init'\n",
                "const RESET_SOURCE = 'conversation_reset'\n",
            )
        ],
    ),
]


if __name__ == "__main__":
    raise SystemExit("run through mutate.sh, never directly")
