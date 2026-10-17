#!/usr/bin/env python3
"""
150 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

`suite` selects which vitest project the runner uses: `node` (runtime + desktop) or `dom`.

⚠️ **Anchors are taken from the FORMATTED source.** 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the exact string the entry was anchored on. Every target here was
copied after the last format run, and `mutate.sh` refuses rather than reporting a green if one of
them stops matching.

⛔ **Two entries here restore a REPRESENTATION rather than deleting a line** (M16, M17). §2's defect
was that a provider-chosen key indexed an ordinary object, and "revert it verbatim" means putting
back an object-backed store with the prototype hazard intact — not swapping the `Map` for something
that merely throws. The shims below reproduce the measured behaviour exactly: `o['__proto__'] = v`
hits the inherited setter and stores nothing, `o['toString']` reads back a function nobody wrote.
"""

import sys
from pathlib import Path

CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
CONFINE = "packages/runtime/src/internal/confinement.ts"
NEXTTURN = "packages/runtime/src/next-turn.ts"
PERM = "packages/runtime/src/permission.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
DBSTORE = "apps/desktop/src/main/db/session-store.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
RECORD = "apps/desktop/src/renderer/src/lib/session-record.ts"
STORE = "apps/desktop/src/renderer/src/lib/session-store.ts"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
CARD = "apps/desktop/src/renderer/src/components/UserInputCard.vue"

# The object-backed stores §2 replaced — the hazard, restored rather than approximated.
SHIM_STR = (
    "(() => { const o: Record<string, string> = {}; return { set: (k: string, v: string) => { "
    "o[k] = v }, get: (k: string) => o[k], values: () => Object.values(o), keys: () => "
    "Object.keys(o) } as unknown as Map<string, string> })()"
)
SHIM_DRAFT = (
    "(() => { const o: Record<string, RequestDraft> = {}; return { set: (k: string, v: "
    "RequestDraft) => { o[k] = v }, get: (k: string) => o[k], values: () => Object.values(o), "
    "keys: () => Object.keys(o) } as unknown as Map<string, RequestDraft> })()"
)

# (name, suite, [(file, old, new), ...])
MUTATIONS = [
    # ---- §0 · the floor that never lifted -------------------------------------------------------
    (
        "M1 · an APPROVED plan no longer lifts the floor (THE FIELD DEFECT — the bricked session)",
        "node",
        [
            (
                CLAUDE,
                "    if (planGesture !== undefined && response.kind === 'answer') this.plan.settle(planGesture)",
                "    if (false && planGesture !== undefined && response.kind === 'answer')\n      this.plan.settle(planGesture)",
            )
        ],
    ),
    (
        "M2 · a REJECTED plan lifts it too — approval stops being the thing that matters",
        "node",
        [
            (
                CLAUDE,
                "if (planGesture !== undefined && response.kind === 'answer') this.plan.settle(planGesture)",
                "if (planGesture !== undefined) this.plan.settle(planGesture)",
            )
        ],
    ),
    (
        "M3 · EnterPlanMode stops RAISING the floor (the other edge, unsynchronized again)",
        "node",
        [
            (
                CLAUDE,
                "  ['ExitPlanMode', false],\n  ['EnterPlanMode', true],\n",
                "  ['ExitPlanMode', false],\n",
            )
        ],
    ),
    (
        "M4 · the release is REQUESTED, not settled — pending forever, and the next turn puts it back",
        "node",
        [(CLAUDE, "this.plan.settle(planGesture)", "this.plan.request(planGesture)")],
    ),
    (
        "M5 · no card is ever recorded as a plan gesture, so nothing can move plan mode",
        "node",
        [
            (
                CLAUDE,
                "    if (planGesture !== undefined) this.planGestures.set(id, planGesture)",
                "    if (false) this.planGestures.set(id, planGesture)",
            )
        ],
    ),
    (
        "M6 · `settle` moves only `effective`, so `requested` drags the floor back up",
        "node",
        [
            (
                NEXTTURN,
                "  settle(value: T): void {\n    this._effective = value\n    this._requested = value\n  }",
                "  settle(value: T): void {\n    this._effective = value\n  }",
            )
        ],
    ),
    # ⚑ **740 · M7's anchor corrected, not retired**: `recordPlanPhase` compares the handle against
    # what the ledger holds (`planAsRecorded`), so `respondUserInput` no longer reads a `planBefore`
    # to pass it. The row still removes the durable half from the plan card's answer.
    # ⚠️ **740 · M7 SURVIVES, measured** (`verify_row.py`, killers `plan-floor-durable.test.ts` and
    # `runtime-host.test.ts`): since R99 the same compare runs on every delivered event, and the event
    # the answer produces writes the release before any test reads the row. The door's own call is
    # kept — it makes the write precede the door's return — but nothing outside can tell the two
    # apart. ⛔ Not retired: its anchor stands, and it is named in `740`'s response.
    (
        "M7 · the DURABLE half never runs — a resume after approval comes back planning",
        "node",
        [
            (
                HOST,
                "    this.recordPlanPhase(session)\n    this.publishOurs(session, {\n",
                "    this.publishOurs(session, {\n",
            )
        ],
    ),
    # ⚠️ **736 · R98 — M8 SURVIVED, measured** (`verify_row.py` at `736`): the one card that RAISED
    # plan mode was gone by ruling, so the `startPlanMode` arm was unreachable. 🔴 **740 · R99 (`736`
    # F-8) — reachable again**: a plan the model starts is written down by the next event
    # (`recordPlanPhase` from `deliver`), so this arm is what a reopen resumes planning FROM.
    (
        "M8 · every plan move is recorded as a RELEASE, whichever way it went",
        "node",
        [
            (
                HOST,
                "        ? this.deps.store.startPlanMode(session.id, this.now())\n        : this.deps.store.endPlanMode(session.id, this.now()),",
                "        ? this.deps.store.endPlanMode(session.id, this.now())\n        : this.deps.store.endPlanMode(session.id, this.now()),",
            )
        ],
    ),
    # ---- §0b · the plan file, which plan mode exists to have written ------------------------------
    (
        "M9 · the plan file is refused again (THE §0b DEFECT — plans in one shot, from memory)",
        "node",
        [(CLAUDE, "                FILE_TOOLS.has(input.tool_name) &&", "                false &&")],
    ),
    (
        "M10 · a call naming NO path is vacuously allowed through the plan-file hole",
        "node",
        [(CONFINE, "  return walk(input) && named > 0", "  return walk(input)")],
    ),
    (
        "M11 · the hole stops checking WHERE the path is, so any write passes as a plan write",
        "node",
        [
            (
                CONFINE,
                "      if (!isWithin(lexicalRoot, lexical) || !isWithin(realRoot, realResolve(lexical))) return false",
                "      if (false) return false",
            )
        ],
    ),
    (
        "M12 · the exemption widens from the plans directory to the whole provider home",
        "node",
        [(CONFINE, "  return join(confinement.providerHome, 'plans')", "  return confinement.providerHome")],
    ),
    # ---- §1 · the floor that blocked the reads it promised ---------------------------------------
    (
        "M13 · `ToolSearch` is denied again (THE §1 DEFECT — Grep and Glob unreachable)",
        "node",
        [(CLAUDE, "  'BashOutput',\n  'ToolSearch',\n", "  'BashOutput',\n")],
    ),
    (
        "M14 · the refusal goes back to promising reads it refuses (086)",
        "node",
        [
            (
                CLAUDE,
                "    'brobot2 is planning this conversation: it may read and search files, and write its own plan ' +\n    'file, but it may not run commands or change anything else until you approve its plan'",
                "    'brobot2 is planning this conversation: it may read, but it may not change anything until you ' +\n    'approve its plan'",
            )
        ],
    ),
    (
        "M15 · `Bash` joins the exemption list — the ruling, reversed",
        "node",
        [(CLAUDE, "  'ToolSearch',\n  ...TODO_TOOLS,", "  'ToolSearch',\n  'Bash',\n  ...TODO_TOOLS,")],
    ),
    # ---- §2 · 148 H3 · the request id AROUND the card ---------------------------------------------
    (
        "M16 · the transcript's request index is an ordinary object again (THE 148 H3 DEFECT)",
        "node",
        [(TRANSCRIPT, "    requestItems: new Map(),", f"    requestItems: {SHIM_STR},")],
    ),
    (
        "M17 · the record's draft store is an ordinary object again — `__proto__` as a draft",
        "node",
        [(RECORD, "    requests: new Map(),", f"    requests: {SHIM_DRAFT},")],
    ),
    # ---- §3 · the dead control (148 M6) -----------------------------------------------------------
    (
        "M18 · a blank option label becomes a card again on CLAUDE",
        "node",
        [
            (
                CLAUDE,
                "    if (toolName === 'AskUserQuestion' && unanswerable !== null) {",
                "    if (false && toolName === 'AskUserQuestion' && unanswerable !== null) {",
            )
        ],
    ),
    (
        "M19 · …and on CODEX",
        "node",
        [
            (
                CODEX,
                "    if (!isPermission && unanswerableOptionLabel(codexQuestions(params)) !== null) {",
                "    if (false && !isPermission && unanswerableOptionLabel(codexQuestions(params)) !== null) {",
            )
        ],
    ),
    (
        "M20 · only an EXACTLY empty label counts, so `\"   \"` sails through both adapters",
        "node",
        [(PERM, "      if (option.label.trim() === '') return option.label", "      if (option.label === '') return option.label")],
    ),
    (
        "M21 · the predicate TRIMS the provider's labels instead of refusing the call (143/146)",
        "node",
        [
            (
                PERM,
                "      if (option.label.trim() === '') return option.label",
                "      if (option.label !== option.label.trim()) return option.label",
            )
        ],
    ),
    # ---- §4 · the Codex id that cannot carry an answer (148 M5) -----------------------------------
    (
        "M22 · a question with a MISSING id is published again (THE 148 M5 DEFECT)",
        "node",
        [
            (
                CODEX,
                "    if (!isPermission && hasUndeliverableQuestionId(params)) {",
                "    if (false && hasUndeliverableQuestionId(params)) {",
            )
        ],
    ),
    (
        "M23 · the empty-id test stops agreeing with the writer it mirrors",
        "node",
        [
            (
                CODEX,
                "  return questions.some((q) => !(isRecord(q) && readString(q, 'id')))",
                "  return questions.some((q) => !isRecord(q))",
            )
        ],
    ),
    (
        "M24 · the DUPLICATE-id refusal is removed — and 150's own check must not cover for it",
        "node",
        [
            (
                CODEX,
                "    if (!isPermission && duplicateAnswerKey(codexQuestions(params), (q) => q.id) !== null) {",
                "    if (false && duplicateAnswerKey(codexQuestions(params), (q) => q.id) !== null) {",
            )
        ],
    ),
    # ---- §5 · the LOWs ----------------------------------------------------------------------------
    (
        "M25 · the interrupt breadcrumb is gone entirely (085's original report)",
        "node",
        [(HOST, "    this.noteUserCommand(sessionId, 'interrupted_to_send')", "    void 0")],
    ),
    (
        "M26 · …and written ABOVE the gate again, so a refused turn claims a gesture (148 L2, 039)",
        "node",
        [
            (
                HOST,
                "    const session = this.require(sessionId)\n    await this.assertCanTakeTurn(session, 'send')\n    // ⛔ **085's breadcrumb",
                "    const session = this.require(sessionId)\n    this.noteUserCommand(sessionId, 'interrupted_to_send')\n    await this.assertCanTakeTurn(session, 'send')\n    // ⛔ **085's breadcrumb",
            )
        ],
    ),
    (
        "M27 · Codex is handed an explicit `signInSuperseded: false` again (148 L3)",
        "node",
        [
            (
                HOST,
                "    ...(session.handle.signInSuperseded === undefined\n      ? {}\n      : { signInSuperseded: session.handle.signInSuperseded }),",
                "    signInSuperseded: session.handle.signInSuperseded === true,",
            )
        ],
    ),
    (
        "M28 · an unclassified answer fault stops reaching the session banner (148 L5)",
        "node",
        # ⚠️ **Re-anchored by 248, and the move is the point.** The line had been copied into a
        # second `catch` — `stopBackgroundWork`, which needs the banner and must NOT flip `busy` —
        # so the anchor matched twice and `census.py --check` called the row stale. It is one
        # `noteFailure` helper now, at one indentation, read by both callers: this row therefore
        # guards MORE than it did, and re-running it is what says so rather than assuming it.
        [(STORE, "    record.error = readableError(cause)", "    record.error = null")],
    ),
    (
        "M29 · a skipped ledger row goes back to being silent to everyone (150's §6 ruling)",
        "node",
        [
            (
                DBSTORE,
                "      console.warn(\n        `session ledger: ordinal ${row.ordinal} could not be read and was skipped ` +\n          `(${error instanceof Error ? error.message : String(error)})`,\n      )",
                "      void error",
            )
        ],
    ),
    # ---- §5 · the two the DOM suite owns ----------------------------------------------------------
    (
        "M30 · the bar's clauses are reordered — the remedy before what went wrong (148 L6)",
        "dom",
        [
            (
                PANE,
                '            <p class="sign-in-bar-note">\n              This conversation is holding {{ signInOf }} it started with, and that sign-in has\n              changed since. No more turns can go out on the old one.\n            </p>\n            <p class="sign-in-bar-cost" data-cy="sign-in-cost">{{ signInBarCost }}</p>',
                '            <p class="sign-in-bar-cost" data-cy="sign-in-cost">{{ signInBarCost }}</p>\n            <p class="sign-in-bar-note">\n              This conversation is holding {{ signInOf }} it started with, and that sign-in has\n              changed since. No more turns can go out on the old one.\n            </p>',
            )
        ],
    ),
    (
        "M31 · the option chips are in the DOM but not on screen (148 L4's false green)",
        "dom",
        [(CARD, ".choice {\n  height: 28px;", ".choice {\n  display: none;\n  height: 28px;")],
    ),
]


def main() -> int:
    if sys.argv[1] == "--count":
        print(len(MUTATIONS))
        return 0
    if sys.argv[1] == "--name":
        print(MUTATIONS[int(sys.argv[2])][0])
        return 0
    if sys.argv[1] == "--suite":
        print(MUTATIONS[int(sys.argv[2])][1])
        return 0

    root = Path(sys.argv[1])
    index = int(sys.argv[2])
    _, _, edits = MUTATIONS[index]
    for rel, old, new in edits:
        path = root / rel
        text = path.read_text()
        found = text.count(old)
        if found != 1:
            print(f"MUTATION DID NOT APPLY: {rel} matched {found} times, expected 1", file=sys.stderr)
            return 2
        path.write_text(text.replace(old, new, 1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
