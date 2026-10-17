"""650 · A permanence that is false for one arm.

⛔ **`agent-cannot-take-a-message` was priced `until-a-person-changes-it`** and its sentence said
*"Coming back will not change that on its own — a person has to put that conversation right."*
`643` F2 found one arm of that fold that clears with nobody acting; `650` counted twenty-three routes
from `queueMessage` into the catch and found two that an agent really meets.

## 🔴 A · what the dispatch CHANGED

⚑ **A launch in flight** now answers `that-conversation-has-not-started` — `INTERRUPT_RAILS`' word,
shared on purpose — typed at `RuntimeHost.sessionFor` as `SessionStillStarting`, which carries
whether the reservation is being CLOSED. ⚠️ A closed reservation stays in the fold, and
`interruptAgent` reads it as an ending, so the shared word means one thing at both doors.

⚑ **A turn another sender opened first** now answers `agent-started-a-turn-first`, typed in the
runtime package: `SessionMachine.refusedTurn()` asks whether the session takes turns BEFORE it asks
whether one is held, and hands back `TurnInProgress` only for the second. ⛔ Every adapter throws the
same text for both halves, which is why the type is the only honest carrier.

⚑ **`643` F3**: `recordAssignment` numbers a task AFTER the words have left, and a database that
could not write threw from there into the same catch — *"the message was not queued"* about words
already delivered or held. The allocation is contained and reported now, never rethrown.

⛔ **The catch-all itself is byte-identical** — its permanence, its `null` remedy and its sentence —
so `424 M10` and `347 M28` still apply unchanged.

## 🔴 A′ · what `657` did to this table

⛔ **`M16` is RETIRED, by name** — its subject, the permanence entry of `agent-started-a-turn-first`,
no longer exists, because `657` made a lost race a HOLD and retired the word. ⚑ The rule it guarded —
*the loser must not be priced as a person's* — is carried by `M9` alone (re-aimed below), the one
row that sends the loser into the catch-all's price again. ⚠️ `657`'s `M4`/`M5` guard the hold's
own failures (a second attempt that can race again; a hold on a free conversation that is never
sent) and never produce a price — the first draft of this note said they did (review of `657`).

⚑ **`M9` is RE-AIMED, not retired**: the rule it protects — a lost race must not be folded into the
catch-all — is the hold's now, so it removes the hold in `RuntimeHost.queueAs`.

## ⛔ B · what has NO row, said rather than left out

🔴 **No row on the census files** — `a-refusal-carries-its-remedy`, `what-an-agent-is-told-about-its-work`
and the interruption file's located exception. ⚠️ Weakening a census passes the census
(`a-mutation-on-a-census-is-invisible-to-that-census`); those are measured by the rows below turning
them red, which several do.

🔴 **No row on the docblock corrections** in `interrupt-rails.ts` and `shared/refusals.ts` — they are
prose, and the fact they now state is measured by `a-refusal-that-clears-on-its-own.test.ts` §2
(the retry after a failed launch meets `no-such-agent` at both doors).

## ⚠️ C · the anchor this dispatch corrected rather than retired

⛔ **`203 M8`** quotes `sessionFor`'s still-starting throw, which is typed and four lines long now.
⚑ Corrected in place and re-verified RED by hand against `window-authority.test.ts`.
"""

TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
UNAVAILABLE = "apps/desktop/src/main/runtime/session-unavailable.ts"
MACHINE = "packages/runtime/src/internal/session-machine.ts"
TURN = "packages/runtime/src/turn-in-progress.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
FAKE = "packages/runtime/src/fake-runtime.ts"

THE_STARTING_BRANCH = "            if (error instanceof SessionStillStarting && !error.closing) {\n"
# ⚑ ANCHOR CORRECTED IN PLACE BY 657: `657` retired the tool's branch for this word and HOLDS a lost race in
# `queueAs` instead. The rule this row protects is unchanged — a lost race must not be folded into
# the catch-all — so the row now removes the HOLD: a `TurnInProgress` rethrown reaches
# `message_agent`'s catch and is told *a person has to put that conversation right* again, which is
# its label word for word. Re-verified RED by hand against `hold-the-second-message.test.ts` §1.
# ⚑ **W4.78 · re-anchored in place, not retired** — This is still queueAs's idle-branch catch. e0e93e6e added a second hold condition (aReopenCarriesIt) beside TurnInProgress, so a lost race is rethrown again while the sign-in hold stays intact. The 6-space line at ~16136 the auto-guess picked is a different catch.
# ⚑ Re-anchored in place — `aReopenCarriesIt` reads the session too (its loop guard), and prettier
# split the throw onto its own lines. The subject of every row on it is unchanged.
THE_TURN_BRANCH = (
    "        if (!(error instanceof TurnInProgress) && !this.aReopenCarriesIt(error, by, session)) {\n"
    "          throw error\n"
    "        }\n"
)

# ⚠️ **Anchors corrected in place at `659`** (this constant, `THE_INTERRUPT_READING` and `M3`'s own
# line): `659` routed every phase comparison in `runtime-host.ts` through one predicate,
# `onItsWayOut`, and prettier folded the typed throw onto one line. ⛔ The SUBJECT of every row is
# unchanged — the typed throw, whether the reservation is being closed, and the interrupt door
# reading the question before the session — and each row was re-verified RED by hand.
THE_TYPED_THROW = (
    "    if (slot.session === null)\n"
    "      throw new SessionStillStarting(`session is still starting: ${sessionId}`, onItsWayOut(slot))\n"
)

THE_INTERRUPT_READING = (
    "    const status = onItsWayOut(slot)\n"
    "      ? WHAT_AN_ACT_MEETS_ON_ITS_WAY_OUT\n"
    "      : session === null\n"
    "        ? null\n"
    "        : session.handle.status()\n"
)

THE_REFUSED_TURN = (
    "    if (!this.acceptsTurns) return new Error(TURN_REFUSED)\n"
    "    if (this.turn) return new TurnInProgress()\n"
)

THE_CONTAINMENT = (
    "    let number: number\n"
    "    try {\n"
    "      number = this.deps.store.allocateProjectNumber(assigning.projectSlug)\n"
    "    } catch (error) {\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · a launch in flight ─────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **a launch in flight is folded again** · `message_agent` never classifies the "
        "reservation refusal, so a caller is told *a person has to put that conversation right* "
        "about a launch seconds from ready — the defect `643` F2 named, and the exact answer "
        "`650`'s probe recorded through the tool",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a launch in flight is refused with 'that-conversation-has-not-started', a
        # clearing refusal, and not folded into agent-cannot-take-a-message. whatADeliveryMet still
        # classifies SessionStillStarting by its closing flag. The plant makes the branch never
        # fire, keeping the instanceof so the import stays used. Killed by
        # `a-refusal-that-clears-on-its-own.test.ts`.
        [
            (TOOLS, '  if (error instanceof SessionStillStarting && !error.closing) {\n', '  if (error instanceof SessionStillStarting && (false as boolean)) {\n'),
        ],
    ),
    (
        "M2 · ⛔ **a reservation being CLOSED is told to retry** · the `closing` field is not read, "
        "so a launch a person cancelled answers *make the same call again in a moment* — a retry "
        "this app already knows cannot work, because whatever arrives is handed back",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a reservation that is being CLOSED is not 'has not started' and must fold to
        # agent-cannot-take-a-message. The plant removes the closing exclusion, so a closing
        # reservation is reported as a launch in flight. whatADeliveryMet still has the
        # SessionStillStarting branch with the closing guard. Killed by
        # `a-refusal-that-clears-on-its-own.test.ts`.
        [
            (TOOLS, '  if (error instanceof SessionStillStarting && !error.closing) {\n', '  if (error instanceof SessionStillStarting) {\n'),
        ],
    ),
    (
        "M3 · ⛔ **the host stops saying the reservation is closing** · `sessionFor` reports every "
        "null session as a launch in flight, so the tool's `closing` check can never fire — the "
        "same defect as `M2` arriving from the other side of the type",
        [(HOST, "`session is still starting: ${sessionId}`, onItsWayOut(slot))\n", "`session is still starting: ${sessionId}`, false)\n")],
    ),
    (
        "M4 · 🔴 **the throw is untyped again** · `sessionFor` goes back to a plain `Error` with the "
        "same bytes, and the only way left to tell the arm apart would be its text — which is the "
        "classifier `650` refuses to write",
        [
            (
                HOST,
                THE_TYPED_THROW,
                "    if (slot.session === null) throw new Error(`session is still starting: ${sessionId}`)\n",
            )
        ],
    ),
    (
        "M5 · 🔴 **the shared word is priced as a person's at the message door** · the permanence "
        "the two doors must agree on disagrees, and a model learns `while-this-holds` from "
        "`interrupt_agent` and `until-a-person-changes-it` from `message_agent` for one fact — "
        "`374`'s *one word, two things*, which `DELIBERATELY_SHARED` exists to refuse",
        [
            (
                TOOLS,
                "  'that-conversation-has-not-started': 'while-this-holds',\n",
                "  'that-conversation-has-not-started': 'until-a-person-changes-it',\n",
            )
        ],
    ),
    (
        "M6 · ⚠️ **the retryable word loses its act** · the biconditional in `shared/refusals.ts` — "
        "*a rail carries an act if and only if this app can retry it* — is broken at the message "
        "door, and the shared word carries an act at one door and none at the other",
        [
            (
                TOOLS,
                "  'that-conversation-has-not-started': 'make-the-same-call-when-this-settles',\n",
                "  'that-conversation-has-not-started': null,\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The WHAT_AN_ACT_MEETS_ON_ITS_WAY_OUT
        # sentinel and the three-way ternary it lived in are gone from `interruptAgent` entirely
        # (confirmed absent codebase-wide). The door now short-circuits with `if (slot === undefined
        # || onItsWayOut(slot)) return this.nothingToInterrupt(sessionId)` as an unconditional first
        # guard before `session` is ever read, so the 'session read before phase' reordering this
        # row plants has no remaining byte-level anchor short of reconstructing the deleted ternary.
        # Its anchor is left stale, so the census records it retired.
        "M7 · ⛔ **a Closed reservation is 'not started' at the interrupt door again** · "
        "`interruptAgent` reads a null session before it reads the phase, so a launch a person "
        "cancelled is told *wait for it to be working* — and the shared word means two things",
        [
            (
                HOST,
                THE_INTERRUPT_READING,
                "    const status =\n"
                "      session === null\n"
                "        ? null\n"
                "        : onItsWayOut(slot)\n"
                "          ? WHAT_AN_ACT_MEETS_ON_ITS_WAY_OUT\n"
                "          : session.handle.status()\n",
            )
        ],
    ),
    (
        "M8 · 🔴 **the shared sentence says a person must act again** · the clause that makes this "
        "word true of its arm — it comes up or fails *on its own* — is replaced by the fold's, which "
        "is the false claim `650` removed",
        [
            (
                TOOLS,
                "It comes up or fails to launch on its own: make the same call again in a moment.",
                "A person has to put that conversation right: make the same call again in a moment.",
            )
        ],
    ),
    # ── B · a turn that reached the agent first ────────────────────────────────────────────────
    (
        "M9 · 🔴 **a turn another sender opened first is folded again** · the loser of two calls in "
        "one tick is told *a person has to put that conversation right* about an agent busy "
        "answering the winner — measured by `650`'s probe, and more frequent than a launch in flight · killed by `hold-the-second-message.test.ts` (named by W4.78)",
        [(HOST, THE_TURN_BRANCH, "        if (!this.aReopenCarriesIt(error, by, session)) throw error\n")],
    ),
    (
        "M10 · ⛔ **the machine asks the turn before the state** · a closing session still holding "
        "its turn is called busy, and a caller retries a conversation that is going away — the one "
        "ordering `refusedTurn`'s docblock exists to defend",
        [
            (
                MACHINE,
                THE_REFUSED_TURN,
                "    if (this.turn) return new TurnInProgress()\n"
                "    if (!this.acceptsTurns) return new Error(TURN_REFUSED)\n",
            )
        ],
    ),
    (
        "M11 · 🔴 **a held turn is never typed** · every refusal is the plain `Error`, so the host "
        "can only fold it — `M9`'s outcome arriving from the runtime package",
        [
            (
                MACHINE,
                "    if (this.turn) return new TurnInProgress()\n",
                "    if (this.turn) return new Error(TURN_REFUSED)\n",
            )
        ],
    ),
    (
        "M12 · ⛔ **every refusal is typed as busy** · a session that stopped taking turns is "
        "called busy, and the retry it invites can never succeed",
        [
            (
                MACHINE,
                "    if (!this.acceptsTurns) return new Error(TURN_REFUSED)\n",
                "    if (!this.acceptsTurns) return new TurnInProgress()\n",
            )
        ],
    ),
    (
        "M13 · ⚠️ **the Claude adapter throws its old plain Error** · the machine's answer never "
        "reaches the host on the provider the person runs most, and the race is folded again there",
        [
            (
                CLAUDE,
                "    if (turnId === null) throw this.machine.refusedTurn()\n",
                "    if (turnId === null)\n"
                "      throw new Error('cannot send: session is not active or a turn is in progress')\n",
            )
        ],
    ),
    (
        "M14 · ⚠️ **the Codex adapter throws its old plain Error** · the same, on the other provider",
        [
            (
                CODEX,
                "    if (localId === null) throw this.machine.refusedTurn()\n",
                "    if (localId === null)\n"
                "      throw new Error('cannot send: session is not active or a turn is in progress')\n",
            )
        ],
    ),
    (
        "M15 · ⚠️ **the Fake throws its old plain Error** · the double stops refusing the way both "
        "real adapters do, so the host's classification is tested against a runtime that does not "
        "exist",
        [
            (
                FAKE,
                "    if (turnId === null) throw this.machine.refusedTurn()\n",
                "    if (turnId === null)\n"
                "      throw new Error('cannot send: session is not active or a turn is in progress')\n",
            )
        ],
    ),
    (
        "M16 · ⛔ **the race is priced as a person's** · `agent-started-a-turn-first` says *make the "
        "same call again now* and carries `retryable: false`, which is two fields disagreeing",
        [
            (
                TOOLS,
                "  'agent-started-a-turn-first': 'while-this-holds',\n",
                "  'agent-started-a-turn-first': 'until-a-person-changes-it',\n",
            )
        ],
    ),
    # ── C · the wire text a person can see ─────────────────────────────────────────────────────
    (
        "M17 · ⚠️ **the class name reaches a person's screen** · `TurnInProgress` gains a `name`, "
        "Electron serialises `${name}: ${message}`, and `readableError` strips only a `\\w*Error:` "
        "prefix — so a window's send shows `TurnInProgress: cannot send…`",
        [
            (
                TURN,
                "    super(TURN_REFUSED)\n  }\n",
                "    super(TURN_REFUSED)\n    this.name = 'TurnInProgress'\n  }\n",
            )
        ],
    ),
    (
        "M18 · ⚠️ **the same, for the reservation refusal** · a person's send to a launch in flight "
        "would show `SessionStillStarting: session is still starting…`",
        [
            (
                UNAVAILABLE,
                "    readonly closing: boolean,\n  ) {\n    super(message)\n  }\n",
                "    readonly closing: boolean,\n  ) {\n    super(message)\n"
                "    this.name = 'SessionStillStarting'\n  }\n",
            )
        ],
    ),
    # ── D · 643 F3 · the number after the words have gone ──────────────────────────────────────
    (
        "M19 · 🔴 **a task that cannot be numbered after the words went out is a refusal again** · "
        "the containment rethrows, the allocation throws from `recordAssignment` into "
        "`message_agent`'s catch, and the caller is told *the message was not queued* about words "
        "already delivered — or held in a mailbox that will flush them, which invites a duplicate",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a store failure while recording a give is contained by record(), so the give
        # still returns ok/sent with the 'no piece was written' warning instead of throwing at the
        # caller. recordTheGive still writes through this.record(session, ...). The plant calls the
        # write directly, so the throw propagates. The leading semicolon guards against the
        # preceding statement having no terminator. Killed by
        # `a-refusal-that-clears-on-its-own.test.ts`.
        [
            (HOST, '    this.record(session, () =>\n      this.deps.store.recordGive(\n', '    ;((run: () => void): void => run())(() =>\n      this.deps.store.recordGive(\n'),
        ],
    ),
]
