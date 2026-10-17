#!/usr/bin/env python3
"""200's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **Three of these rows are code that really existed, and one of them is a fix that was really
proposed.** M1 and M5 are the pre-200 source: no thread gate at all, and a `turn/diff/updated` that
nothing correlated. ⛔ **M6 is 192's own request** — add `error` to the turn-scoped set — and it is
here because the reason it was refused has to be a colour, not a paragraph. ⛔ **And M2 is the
DISPATCH implemented verbatim**: a universal foreign-thread drop with no exemption, which is the one
correction 200 made to its brief and the one thing no test in this repo could have caught before.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. These were taken after `format:check`
was green.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

  * **The WIRE.** Every row drives the app's own vocabulary against a `FakeTransport`, so no row can
    say whether a real Codex descendant thread emits `error` or `turn/diff/updated` on the PARENT
    connection — the measurement gap 200 §3 names. ⚑ `probe:foreign-thread` is the instrument for
    that: it tees the transport 184-style and prints every foreign frame by method, beside the app's
    own counter, so the count is checked against something the gate cannot reach. The run and its
    numbers are in the response doc.
  * **`_ref === null`.** {@link namesForeignThread} tolerates a session that does not yet know its own
    id, and a row asserting that would come back GREEN: the handshake binds `_ref` before `runLoop`
    reads its first notification, so no test — and, as far as this transport can show, no live
    session — reaches the branch. It is a type obligation discharged honestly, not a case with a
    story, and it is stated here rather than dressed as coverage.
  * **The `desktop`, `dom`, `shared` and `scripts` projects.** 200 moves code in exactly one file,
    `packages/runtime/src/codex/codex-runtime.ts`, so `runtime` is the only project this table runs
    (147 M17's rule: the filters come from the files the table TOUCHES). Nothing downstream of the
    adapter changed, and a row mutating anything there would be mutating 199's tree, not this one.
  * **Whether the gate is the RIGHT altitude.** Rows can kill a gate that stops working; none of
    them can say that deciding thread scope once, above every handler, is better than deciding it in
    three places. That argument is in the source and in §1 of the response, and it is an argument.

⛔ **Do not apply these by hand** — `mutate.sh` owns the tree, takes 196's repository-global lock,
and restores from a pristine copy keyed by FULL relative path.
"""

from __future__ import annotations

import sys

ADAPTER = "packages/runtime/src/codex/codex-runtime.ts"

GATE = """    if (this.namesForeignThread(method, params)) {
      this.countForeignDrop(method)
      return
    }
"""

SETTINGS_HEAD = "    if (method === 'thread/settings/updated') {\n"

# ⛔ **M4's SECOND anchor, and the first one is why a table is worth running at all.** The row read
# the same then as now, but it re-inserted the gate immediately ABOVE `thread/settings/updated` —
# which is exactly where the gate already sits, so the "mutation" was the identity and it came back
# **GREEN**. 198's rule is that a green row found either blindness or dead code; this one found
# neither, because it never expressed its defect (199 M15, the same shape). ⚠️ **Moving the gate
# BELOW the settings handler is what the sentence says**, and this anchor is what does it.
TURN_COMPLETED_HEAD = "    if (method === 'turn/completed') {\n"

MUTATIONS = [
    # ---- §1a · the universal thread predicate ----------------------------------------------------
    (
        "M1 · ⛔ THE DEFECT, verbatim · no thread gate at all — scope decided by method NAME, so "
        "every method outside the nine gets no correlation (the pre-200 code)",
        [(ADAPTER, GATE, "")],
    ),
    (
        "M2 · ⛔ THE BRIEF, verbatim · the gate has no exemption, so every frame naming another "
        "thread dies — including the CHILD's `thread/status/changed`, which is every sub-agent ending",
        [
            (
                ADAPTER,
                "    if (THREAD_SUBJECT_METHODS.has(method)) return false\n",
                "",
            )
        ],
    ),
    (
        "M3 · absence is read as a foreign thread · a frame that names no thread is dropped, which "
        "is every id-less diagnostic AND `account/rateLimits/updated` — the only warning before the wall",
        [
            (
                ADAPTER,
                "    return threadId !== '' && threadId !== ref.sessionId\n",
                "    return threadId !== ref.sessionId\n",
            )
        ],
    ),
    (
        "M4 · ⛔ the gate sits BELOW `thread/settings/updated` · the half of 192 H3 that bites — a "
        "foreign thread's non-prompting profile reaches `checkSettingsProfile` and KILLS the session",
        [
            (ADAPTER, GATE, ""),
            (ADAPTER, TURN_COMPLETED_HEAD, GATE + TURN_COMPLETED_HEAD),
        ],
    ),
    (
        "M5 · the gate reads the wrong id · `turnId` where `threadId` belongs, so a foreign thread "
        "running the same turn id passes and the predicate answers a question nobody asked",
        [
            (
                ADAPTER,
                "    if (!ref) return false\n"
                "    const threadId = readString(params, 'threadId')\n",
                "    if (!ref) return false\n"
                "    const threadId = readString(params, 'turnId')\n",
            )
        ],
    ),
    (
        "M6 · the exemption is WIDENED to `error` · one method's 'the id is my subject' reading "
        "applied to a frame whose id is its scope, so somebody else's error becomes ours",
        [
            (
                ADAPTER,
                "const THREAD_SUBJECT_METHODS = new Set(['thread/status/changed'])\n",
                "const THREAD_SUBJECT_METHODS = new Set(['thread/status/changed', 'error'])\n",
            )
        ],
    ),
    # ---- §1b · turn correlation, by membership, plus exactly one name -----------------------------
    (
        "M7 · `turn/diff/updated` is not turn-scoped (the pre-200 set) · a late full snapshot from a "
        "finished turn OVERWRITES the running turn's Changes, because the fold is later-record-wins",
        [(ADAPTER, "  'turn/diff/updated',\n", "")],
    ),
    (
        "M8 · ⛔ 192's OTHER request, granted · `error` joins the turn-scoped set, and an out-of-turn "
        "credential error is silently dropped — `isCurrentProviderTurn` is false when no turn is bound",
        [
            (
                ADAPTER,
                "  'item/fileChange/patchUpdated',\n",
                "  'item/fileChange/patchUpdated',\n  'error',\n",
            )
        ],
    ),
    # ---- §3 · the counter, which is what stops the gate sealing its own evidence -------------------
    (
        "M9 · ⛔ the drop is not counted · the gate works and says nothing, so a gate that starts "
        "dropping frames and a provider that stopped sending them read identically (184's failure)",
        [
            (
                ADAPTER,
                "      this.countForeignDrop(method)\n",
                "",
            )
        ],
    ),
    (
        "M10 · the denominator is counted AFTER the drop · `seen` stops being what the transport "
        "delivered and becomes what survived, which is the one number that cannot answer §3's question",
        [
            (ADAPTER, "    this.notificationsSeen += 1\n", ""),
            (ADAPTER, GATE + SETTINGS_HEAD, GATE + "    this.notificationsSeen += 1\n" + SETTINGS_HEAD),
        ],
    ),
    (
        "M11 · the breakdown collapses into one bucket · the counter says how many were refused and "
        "never which method, so the report cannot say what the provider is actually sending",
        [
            (
                ADAPTER,
                "    this.foreignThreadDrops.set(key, (this.foreignThreadDrops.get(key) ?? 0) + 1)\n",
                "    this.foreignThreadDrops.set('all', (this.foreignThreadDrops.get('all') ?? 0) + 1)\n",
            )
        ],
    ),
    (
        "M12 · 🔒 the counter is UNBOUNDED · its key is a string off the wire, so a provider emitting "
        "distinct method names grows a diagnostic map without limit (052's subject on 200's surface)",
        [
            (
                ADAPTER,
                "      this.foreignThreadDrops.has(method) ||\n"
                "      this.foreignThreadDrops.size < MAX_ATTRIBUTED_DROP_METHODS\n"
                "        ? method\n"
                "        : OTHER_DROP_METHODS\n",
                "      method\n",
            )
        ],
    ),
]


def apply(root, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(
                f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)",
                file=sys.stderr,
            )
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace, 1))
    return 1 if bad else 0


def main() -> int:
    from pathlib import Path

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
