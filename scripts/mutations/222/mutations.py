#!/usr/bin/env python3
"""222's mutation table — each row is THE DEFECT, put back verbatim (131).

`220` — the Exploration Agent — quit the app while a shell command was running, reopened it, and
looked at the rail and Sessions **before resuming anything**: *"No active row returned. Three closed
threads were hidden, and all corresponding Sessions rows said `ended`, with no interrupted or
unfinished distinction. Only after choosing Resume did the transcript reveal 'did not finish' and
'turn interrupted'."*

⛔ **The fact was in the ledger the whole time.** `045` gave `turn.end_reason` five members —
`completed | failed | interrupted | ended | unknown` — precisely so an ending nobody observed would
be recorded rather than back-filled. Nothing read it. Measured on the person's own ledger before a line
was written: **21 conversations, three distinct endings, two status words.**

The rows fall into six groups:

  * `M1`-`M8`   §2 · the derive — the newest CLOSED turn of the active generation, on every shape
    that leaves the store, and every way to get that wrong.
  * `M9`-`M10`  §3 · ⛔ **208 H3's trigger.** The finalizer hard-coded the turn's ending to `'ended'`
    on both branches of a receipt it was already reading for the archive, so a teardown that could
    confirm nothing wrote the same durable ending as one that could.
  * `M11`-`M18` §4 · the word — the vocabulary, which surface says it, and the order it is said in.
  * `M19`-`M22` the two surfaces, as markup and as paint.
  * `M23`-`M24` the vocabulary as ONE list — the shared enum against the CHECK the database
    actually enforces.
  * `M25`       ⚠️ **an older row RE-ANCHORED here so it is actually RE-RUN.** `151` M28 and `154`
    M4 are the SAME edit at the same three lines — both were anchored on the `unresumable` push this
    dispatch added a field to, and `mutations:check` reported both as protecting nothing. Restoring
    an anchor without running it is an applicability claim rather than a kill, so it is run here;
    running one edit twice would inflate the count rather than the coverage, so it is ONE row and
    both of their own tables are re-anchored.
  * `M26`       the smoke's claim shape for step `44b`.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

  * ⛔ **A REAL quit landing on a REAL running turn.** Every row here runs against a store or a
    fixture. That a genuine SIGINT mid-turn produces this state, and that a person reopening the app
    can tell it from a clean finish before pressing Resume, is step `44b` and only step `44b`.
  * ⛔ **The generation scoping.** `LAST_ENDING_COLUMN` is scoped to `coalesce(g.active, 0)` like
    every other read in that query, and no test here builds a session with turns in two generations
    — so a row that dropped the scope would survive. Named rather than left as a silent gap; the
    generation contract itself is `065`'s subject and has its own table.
  * ⛔ **`unknown` reached through 208 H3's REAL mechanism** — a provider whose `close()` resolves on
    the SDK's own two-second bound while its child is still alive. `M9` is killed by a fake whose
    close never settles, which is the same branch by a different road; the pinned SDK's timer is out
    of reach of every instrument in this repo.
"""

from pathlib import Path

CONTRACTS = "packages/shared/src/contracts.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
LIB = "apps/desktop/src/main/library/session-library.ts"
ENDING = "apps/desktop/src/renderer/src/lib/ending.ts"
FOLD = "apps/desktop/src/renderer/src/lib/closed-threads.ts"
PAGE = "apps/desktop/src/renderer/src/components/ResumableSessions.vue"
SIDERAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
SMOKE = "scripts/ui-live-smoke.mjs"

# The `unresumable` push both re-anchored rows below target — 222 added `lastEnding` to it.
# ⚑ **Re-anchored by `449`, not retired** (142's rule): the fold now carries `profileId` so a row can say WHO is in it, which put a line inside every anchor that spelled one of these pushes. The rule each row protects is unchanged.
HIDE_OPEN_UNRESUMABLE = """    if (hidden.has(session.sessionId)) continue
    rows.push({
      sessionId: session.sessionId,
      provider: session.provider,
      cwd: session.cwd,
      profileId: session.profileId,
      status: session.status,
      // ⚑ **Both halves"""

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- §2 · the derive -------------------------------------------------------------------------
    (
        "M1 · ⛔ THE DEFECT · nothing derives the ending, so every closed conversation is described "
        "by its status alone — 220's three threads behind one word",
        [(STORE, "    lastEnding: resolveEndReason(row.last_end_reason),\n  }\n}", "    lastEnding: null,\n  }\n}")],
    ),
    (
        "M2 · …and the same on the offerable half, so the reopen list loses it while the library "
        "keeps it — one conversation, two answers",
        [
            (
                STORE,
                "      // 222 — the same read `describeRow` makes for the other two shapes, off the same column.\n      lastEnding: resolveEndReason(row.last_end_reason),",
                "      lastEnding: null,",
            )
        ],
    ),
    (
        "M3 · an OPEN turn's null erases the ending before it, so a conversation that is running "
        "again looks like one we hold no turns for",
        [(STORE, "                                  AND t.closed_at IS NOT NULL\n", "")],
    ),
    (
        "M4 · the FIRST ending wins instead of the last, so work already redone is still reported "
        "as unfinished",
        [(STORE, "                                ORDER BY t.ordinal DESC LIMIT 1", "                                ORDER BY t.ordinal ASC LIMIT 1")],
    ),
    (
        "M5 · a stored reason the enum does not know is handed out as itself, so an older build's "
        "value reaches a surface that has no word for it",
        [
            (
                STORE,
                "  return turnEndingSchema.safeParse(value).success ? (value as TurnEndReason) : 'unknown'",
                "  return value as TurnEndReason",
            )
        ],
    ),
    (
        "M6 · …and the other direction: every stored reason reads as `unknown`, so a clean finish "
        "is reported as an ending nobody saw",
        [
            (
                STORE,
                "  return turnEndingSchema.safeParse(value).success ? (value as TurnEndReason) : 'unknown'",
                "  return 'unknown'",
            )
        ],
    ),
    (
        "M7 · the library's own row loses it, so the Sessions page and the reopen list disagree "
        "about the same conversation",
        [(LIB, "    lastEnding: row.lastEnding,\n    unresumableReason: row.unresumableReason,", "    lastEnding: null,\n    unresumableReason: row.unresumableReason,")],
    ),
    (
        "M8 · a conversation the provider holds and we never ran is back-filled as `completed` — "
        "the exact fabrication 045 added `unknown` to refuse",
        [(LIB, "      lastEnding: row?.lastEnding ?? null,", "      lastEnding: row?.lastEnding ?? 'completed',")],
    ),
    # ---- §3 · 208 H3's trigger -------------------------------------------------------------------
    (
        "M9 · ⛔ 208 H3 · the turn's ending is hard-coded `ended` again, so a teardown that could "
        "NOT confirm the provider stopped writes the same durable ending as one that could",
        [(HOST, "        stopped ? 'ended' : 'unknown',", "        'ended',")],
    ),
    (
        "M10 · …and the same lie pointed the other way: every close records `unknown`, so a "
        "conversation you closed yourself comes back saying nobody saw it end",
        [(HOST, "        stopped ? 'ended' : 'unknown',", "        'unknown',")],
    ),
    # ---- §4 · the word ---------------------------------------------------------------------------
    (
        "M11 · `completed` is not a finish, so a clean conversation wears an unfinished word",
        [(ENDING, "  return ending !== null && ending !== 'completed'", "  return ending !== null")],
    ),
    (
        "M12 · nothing is ever unfinished, so 220's three threads read exactly as they did",
        [(ENDING, "  return ending !== null && ending !== 'completed'", "  return false")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Deleted on purpose. `endingNote`, the
        # function whose `<ending word> <ago>` column this row plants against, was removed from
        # ending.ts by D-017b: 'One Conversations list in the rail and the palette, each row with
        # the shared state: no open / closed / kept-open split.' and 'No sentence says whether a
        # process runs.' A rail row now draws the host's one state (agentStateWords) and never an
        # ending word. ENDING_WORD survives only on the Sessions page (ResumableSessions.vue), which
        # this anchor never reached. Its anchor is left stale, so the census records it retired.
        "M13 · the rail never names an ending, so the column that answers *what can I pick up* "
        "goes back to saying only when",
        [(ENDING, "  return endedUnfinished(ending) ? `${ENDING_WORD[ending as TurnEnding]} ${ago}` : ago", "  return ago")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Deleted on purpose. This is the same
        # `endingNote` line as M13, and `endingNote` is gone from ending.ts. Its only caller was the
        # closed list's note column, removed with 'no open / closed / kept-open split' and 'No
        # sentence says whether a process runs.' An ending word ('failed 2h ago') on a rail row is a
        # statement about how a process stopped. The rail no longer says that. Its anchor is left
        # stale, so the census records it retired.
        "M14 · …and the rail names EVERY ending, which is the noise 151 took out of that column",
        [
            (
                ENDING,
                "  return endedUnfinished(ending) ? `${ENDING_WORD[ending as TurnEnding]} ${ago}` : ago",
                "  return ending === null ? ago : `${ENDING_WORD[ending]} ${ago}`",
            )
        ],
    ),
    (
        "M15 · the Sessions page says nothing for a finish, so an empty cell means BOTH *it "
        "finished* and *we hold no closed turn* — the ambiguity `completed`'s word exists to end",
        [
            (
                ENDING,
                "  return ending === null ? null : { word: ENDING_WORD[ending], sentence: ENDING_SENTENCE[ending] }",
                "  return ending === null || ending === 'completed'\n    ? null\n    : { word: ENDING_WORD[ending], sentence: ENDING_SENTENCE[ending] }",
            )
        ],
    ),
    (
        "M16 · two endings share one word — 220's complaint, reproduced one layer up",
        [(ENDING, "  ended: 'cut off',", "  ended: 'finished',")],
    ),
    (
        "M17 · ⛔ 208 H3 · `unknown` claims the turn never finished, rather than that nobody saw it "
        "— a statement about a provider we stopped watching",
        [
            (
                ENDING,
                "  unknown: 'a turn was still running, and this app never saw how it ended',",
                "  unknown: 'a turn was still running, and it never finished',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Deleted on purpose. The
        # refusal-versus-ending ordering lived in closed-threads.ts (the closed row's one-fact note,
        # `row.refusal` then `row.lastEnding`), and that file is deleted. The commit says: 'no
        # Reopen / Take it over / Read the recording presses: one press, "Open the conversation"'.
        # With no Reopen press there is no refusal sentence on a row to outrank, so the ordering has
        # no subject. Its anchor is left stale, so the census records it retired.
        "M18 · the ending outranks the REFUSAL on the rail, so the row stops saying what you can do "
        "with it and says how it ended instead (151's stated order, reversed)",
        [
            (
                FOLD,
                "  if (row.refusal !== null) return { note: row.refusal, title: row.refusal }\n  // ⛔ **222 · the ending",
                "  // ⛔ **222 · the ending",
            )
        ],
    ),
    # ---- the two surfaces ------------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Deleted on purpose. The rail hover
        # `title: ENDING_SENTENCE[row.lastEnding]` was drawn by the closed list's row in
        # closed-threads.ts, now deleted. D-017b: 'no open / closed / kept-open split' and 'No
        # sentence says whether a process runs.' ENDING_SENTENCE now has one caller left, the
        # Sessions page (ResumableSessions.vue), which is not the rail. Its anchor is left stale, so
        # the census records it retired.
        "M19 · the rail's hover loses the whole sentence, so the 200px column's one word is all "
        "there is (219's rule: a label a person can act on)",
        [(FOLD, "        title: ENDING_SENTENCE[row.lastEnding as TurnEnding],", "        title: '',")],
    ),
    (
        "M20 · the Sessions page's offerable half loses its ending cell entirely",
        [
            (
                PAGE,
                '            v-if="endingLabel(session.lastEnding)"\n            :data-cy="`resumable-ending-${session.sessionId}`"',
                '            v-if="false"\n            :data-cy="`resumable-ending-${session.sessionId}`"',
            )
        ],
    ),
    (
        "M21 · …and the UNRESUMABLE half loses its cell — the only surface where that half's "
        "ending is readable at all, because its rail row spends its one line on the refusal",
        [
            (
                PAGE,
                '            v-if="endingLabel(session.lastEnding)"\n            :data-cy="`unresumable-ending-${session.sessionId}`"',
                '            v-if="false"\n            :data-cy="`unresumable-ending-${session.sessionId}`"',
            )
        ],
    ),
    (
        "M22 · every ending is painted in the attention channel, so a list of finished "
        "conversations shouts at its own ordinary case (081's one colour, spent)",
        [
            (
                PAGE,
                ':data-cy="`resumable-ending-${session.sessionId}`"\n            :data-ending="session.lastEnding"\n            :class="{ unfinished: endedUnfinished(session.lastEnding) }"',
                ':data-cy="`resumable-ending-${session.sessionId}`"\n            :data-ending="session.lastEnding"\n            :class="{ unfinished: true }"',
            )
        ],
    ),
    # ---- the vocabulary is ONE list --------------------------------------------------------------
    (
        "M23 · the shared enum loses `unknown`, so the member 045 added for *we did not observe how "
        "it went* stops existing above the database that still stores it",
        [
            (
                CONTRACTS,
                "export const turnEndingSchema = z.enum(['completed', 'failed', 'interrupted', 'ended', 'unknown'])",
                "export const turnEndingSchema = z.enum(['completed', 'failed', 'interrupted', 'ended'])",
            )
        ],
    ),
    (
        "M24 · …and it gains a sixth the CHECK constraint has never heard of, which is the drift "
        "the census exists to catch in the direction nobody expects",
        [
            (
                CONTRACTS,
                "export const turnEndingSchema = z.enum(['completed', 'failed', 'interrupted', 'ended', 'unknown'])",
                "export const turnEndingSchema = z.enum([\n  'completed',\n  'failed',\n  'interrupted',\n  'ended',\n  'unknown',\n  'abandoned',\n])",
            )
        ],
    ),
    # ---- re-anchored, and RE-RUN -----------------------------------------------------------------
    (
        "M25 · ⚑ 151 M28 AND 154 M4, re-anchored and re-run · a running conversation is offered for "
        "reopening from the unresumable half, because `hideOpen` stops reaching it",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives, with
        # a new subject. A conversation this window holds must be drawn once, from its own record,
        # and not again from the host's row. `hideOpen` and the closed list are gone, and their job
        # now belongs to the `drawn.has(host.sessionId)` guard in SideRail's rows computation, which
        # covers both host halves in one loop. The DOM test was re-aimed at it (D-017b: 'drawn ONCE,
        # from its record — never twice').
        [
            (SIDERAIL, '    if (drawn.has(host.sessionId)) continue\n', ''),
        ],
    ),
    # ---- the live step's claim shape --------------------------------------------------------------
    (
        "M26 · ⛔ · step 44b reports a bare sentence instead of per-claim verdicts, so the one live "
        "step that presses 220's gesture can go green while asserting nothing (209 §9, 206 H1)",
        [
            (
                SMOKE,
                "          return claims(...said)",
                "          return `ASSERTED: ` + said.map((entry) => entry.claim).join(' · ')",
            )
        ],
    ),
]


def apply(root, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = Path(root) / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)")
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace))
    return bad


def main() -> int:
    import sys

    args = sys.argv[1:]
    if args[:1] == ["--count"]:
        print(len(MUTATIONS))
        return 0
    if args[:1] == ["--files"]:
        seen = []
        for _name, edits in MUTATIONS:
            for rel, _find, _replace in edits:
                if rel not in seen:
                    seen.append(rel)
        print(" ".join(seen))
        return 0
    if args[:1] == ["--name"]:
        print(MUTATIONS[int(args[1])][0])
        return 0
    if args[:1] == ["--dry-run"]:
        root = Path(args[1]).resolve()
        bad = 0
        for index in range(len(MUTATIONS)):
            bad += apply(root, index, dry=True)
        print(f"{len(MUTATIONS) - bad}/{len(MUTATIONS)} anchors found exactly once")
        return 1 if bad else 0
    root = Path(args[0]).resolve()
    return apply(root, int(args[1]), dry=False)


if __name__ == "__main__":
    raise SystemExit(main())
