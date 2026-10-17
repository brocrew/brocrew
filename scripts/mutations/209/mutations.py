#!/usr/bin/env python3
"""209's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **Round 2's three MEDIUMs share one cause: PASS / FAIL / *did-not-look* is a tri-state and three
sites had a boolean.** Plus `207`'s three MEDIUMs, which are in code four days old.

The rows fall into six groups:

  * `M1`-`M8`   the typed per-claim result (206 H1) — the verdict is data, and the aggregate says so.
  * `M9`-`M11`  step 48's ledger query (206 H1) — scoped to a session, or it answers about another.
  * `M12`-`M15` `describeMissing` (206 H3) — the OTHER direction, where absence is the finding.
  * `M16`-`M18` the two false comments (208 H2) — and the fact one of them got wrong.
  * `M19`-`M22` `207` M3 — a read that deleted a good export.
  * `M23`-`M27` `207` M1/M2 — a grant that lost its scope, and buttons that stayed live.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

  * ⛔ **`packages/runtime/smoke/claude-live.smoke.ts` row 3.8 itself.** It is a LIVE smoke and
    `pnpm run ci` cannot run one — the same edge `196`'s table names about `ui-live-smoke.mjs`. That
    is exactly why 206 H3's fix is `pathsNaming` + `describeMissing` from `scripts/lib/` rather than
    a better private walk: `M12`-`M15` reach the logic even though the row is out of reach. ⚠️ **What
    stays unreached is the WIRING** — that row 3.8 calls them at all, and calls them on the right two
    roots. Nothing here can say so; a live `pnpm run smoke:claude` is the only instrument that could.
  * ⛔ **Every live STEP in `ui-live-smoke.mjs`.** `M6` and `M7` reach the file, but only through
    `smoke-claims.test.mjs`, which reads its SOURCE. No project executes a step, so step 48's own
    call, its `waitFor`, and step 58's three claims are covered by their libraries and by nothing else.
  * ⛔ **The 1 ms double-launch window** `M16` is about. `single-instance.ts` records a measurement
    made with a twenty-line Electron main; no row can reproduce a Chromium `ProcessSingleton` race,
    and `M17` reaches only the module-locality that the false comment got wrong.
  * ⛔ **A real second WINDOW causing `207` M3.** `M19` kills the destruction; what it cannot show is
    that a non-owner can start it, because `exportSession` takes no sink and there is nothing to fake.
    `window-authority.test.ts` already records the classification; the durable effect is the finding.
  * **A full disk.** `M19`-`M21` drive the failure path with a window that throws, which is what an
    unreadable archive does. ENOSPC mid-`write(2)` is the case `writeStreamed`'s loop exists for and
    no row here can produce it.
  * **Whether the overview is legible.** `M23`-`M27` kill assertions about objects and about painted
    rows at 1200px. 031's rule is a judgement and the PM's eyes are the instrument.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. These were taken after `format` ran.

⛔ **Do not apply these by hand** — `mutate.sh` owns the tree, takes 196's repository-global lock,
and restores from a pristine copy keyed by FULL relative path.
"""

from __future__ import annotations

import sys

VERD = "scripts/lib/smoke-verdicts.mjs"
SMOKE = "scripts/ui-live-smoke.mjs"
TURNQ = "scripts/lib/turn-query.mjs"
GUARD = "scripts/lib/personal-home-guard.mjs"
POLICY = "apps/desktop/src/main/single-instance.ts"
BOOT = "packages/runtime/src/codex/home-boot.ts"
HOSTS = "apps/desktop/src/main/runtime/live-hosts.ts"
EXPORT = "apps/desktop/src/main/archive/export-session.ts"
ATTN = "apps/desktop/src/renderer/src/lib/attention.ts"
QUEUE = "apps/desktop/src/renderer/src/components/AttentionQueue.vue"

MUTATIONS = [
    # ------------------------------------------------- 206 H1 · the typed per-claim result
    (
        "M1  · ⛔ THE DEFECT, verbatim · a step's claim list is ignored, so three claims are one "
        "PASS again — the shape that made 138's run report `1 ASSERTED, 2 ASSERTED, 3 NOT ASSERTED` "
        "as a clean step",
        [(VERD, "  if (isClaims(outcome)) {", "  if (false) {")],
    ),
    (
        "M2  · ⛔ H1 · a step whose EVERY claim went unreached reads as a PASS — the fourth cell "
        "erased one level down",
        [
            (
                VERD,
                "      verdict: entries.some((entry) => entry.verdict === 'ASSERTED') ? 'PASS' : 'NOT ASSERTED',",
                "      verdict: 'PASS',",
            )
        ],
    ),
    (
        "M3  · ⛔ H1 · the claims never leave `outcomeVerdict`, so the run counts steps and nothing "
        "else — the mechanism present and inert",
        [(VERD, "      claims: entries,", "      claims: [],")],
    ),
    (
        "M4  · ⛔ H1 · the headline stops reporting claims at all, which is the sentence 206 asked "
        "for",
        [
            (
                VERD,
                "    (claimsTotal > 0 ? ` · ${claimsAsserted}/${claimsTotal} claims asserted` : '') +",
                "    '' +",
            )
        ],
    ),
    (
        "M5  · ⚠️ H1 · the headline stops NAMING the unreached claims, leaving a count nobody can act "
        "on (196's own rule, one level down)",
        [(VERD, "  const blankClaims = results.flatMap((r) =>", "  const blankClaims = [].map((r) =>")],
    ),
    (
        "M6  · ⛔ H1 · `claims()` accepts an empty list — a step whose claims filtered down to none "
        "reports as an honest blank and counts zero in both columns (129's trap)",
        [(VERD, "  if (entries.length === 0) {", "  if (false) {")],
    ),
    (
        "M7  · ⛔ H1 · a claim with no verdict is accepted, so `{claim, verdict: 'PROBABLY'}` counts "
        "as neither asserted nor unasserted and silently shrinks the denominator",
        [
            (
                VERD,
                "    if (entry.verdict !== 'ASSERTED' && entry.verdict !== 'NOT ASSERTED') {",
                "    if (false) {",
            )
        ],
    ),
    (
        "M8  · ⛔ H1 · a step writes its verdict into a sentence again — the exact form 206 H1 found, "
        "put back on step 63",
        [
            (
                SMOKE,
                "      : unasserted('the counts line — it did not use the noun either way this run')",
                "      : asserted('counts line NOT ASSERTED')",
            )
        ],
    ),
    # --------------------------------------------- 206 H1 · step 48's ledger query
    (
        "M9  · ⛔ THE DEFECT, verbatim · the query is unscoped again, so it answers about whichever "
        "session has the most turns — step 6's, on any run where 6 went further than 48",
        [
            (
                TURNQ,
                "  const scope = sessionId === null ? '' : ` AND t.session_id = '${sessionId}'`",
                "  const scope = ''",
            )
        ],
    ),
    (
        "M10 · ⚠️ H1 · the scope is built but the ORDER still crosses sessions — `ordinal` counts "
        "turns within a session, so ordering by it over the whole table compares turn NUMBERS",
        [
            (
                TURNQ,
                "      FROM turn t WHERE t.end_reason = 'interrupted'${scope} ORDER BY t.ordinal DESC LIMIT 1;`",
                "      FROM turn t WHERE t.end_reason = 'interrupted' ORDER BY t.ordinal DESC LIMIT 1;`",
            )
        ],
    ),
    (
        "M11 · 🔒 H1 · an id of any shape is concatenated into the SQL — `queryDatabase` runs a "
        "statement, not a bound parameter",
        [
            (
                TURNQ,
                "  if (sessionId !== null && !SESSION_ID_SHAPE.test(sessionId)) {",
                "  if (false) {",
            )
        ],
    ),
    # ------------------------------------------------- 206 H3 · the other direction
    (
        "M12 · ⛔ THE DEFECT, verbatim · a missing marker reads as nothing missing — `hasTranscript`'s "
        "boolean, where a session that is NOT in the isolated home is indistinguishable from one that is",
        [(GUARD, "  if (missing.length === 0) return 'none'", "  if (true) return 'none'")],
    ),
    (
        "M13 · ⛔ H3 · an UNFINISHED walk asserts absence — the whole finding: 'I looked and it is "
        "not there' and 'I could not look' become one sentence again",
        [
            (
                GUARD,
                "  return why === null\n    ? named\n    : `${named} — but the walk did not finish, so they are NOT known to be absent: ${why}`",
                "  return named",
            )
        ],
    ),
    (
        "M14 · ⚠️ H3 · the asymmetry is lost — a marker that WAS found fails because the walk also "
        "stopped somewhere else, which is a red nobody could act on (176's rule)",
        [
            (
                GUARD,
                "  const missing = markers.filter((marker) => !found.has(marker.label)).map((m) => m.label)",
                "  const missing = scan.complete\n    ? markers.filter((marker) => !found.has(marker.label)).map((m) => m.label)\n    : markers.map((m) => m.label)",
            )
        ],
    ),
    (
        "M15 · ⛔ H3 · a scan for NO markers reports nothing missing, forever — 129's trap on the "
        "side of the guard where an empty list looks most like a pass",
        [
            (
                GUARD,
                "export function describeMissing(scan, markers) {\n  requireMarkers(markers)",
                "export function describeMissing(scan, markers) {",
            )
        ],
    ),
    # ------------------------------------------------- 208 H2 · two false comments
    (
        "M16 · ⛔ THE DEFECT, verbatim · `single-instance.ts` states again, unattributed, that "
        "`live-hosts.ts` is cross-process — telling a future implementer a backstop exists that does not",
        [
            (
                POLICY,
                " * It read: *\"The other half of the answer, `live-hosts.ts`, is cross-process and still holds.\"*",
                " * The other half of the answer, `live-hosts.ts`, is cross-process and still holds.",
            )
        ],
    ),
    (
        "M17 · ⛔ H2 · the live-host directory really IS shared beyond its module, so the fact the "
        "corrected comment states is false — asserted rather than believed",
        [
            (
                HOSTS,
                "const directory = new Set<LiveHost>()",
                "const directory = ((globalThis as Record<string, unknown>).__brobot2Hosts ??=\n  new Set<LiveHost>()) as Set<LiveHost>",
            )
        ],
    ),
    (
        "M18 · ⛔ H2 · `home-boot.ts` says again, unattributed, that the app does NOT call "
        "`requestSingleInstanceLock` — false since 198, at `index.ts:791`",
        [
            (
                BOOT,
                " * ⛔ **This paragraph used to say the app does NOT call `requestSingleInstanceLock`. It does** (208",
                " * ⚠️ **The app does NOT call `requestSingleInstanceLock`, so that is not impossible** (208",
            )
        ],
    ),
    # ------------------------------------------------- 207 M3 · a read that deleted
    (
        "M19 · ⛔ THE DEFECT, verbatim · the export truncates the final pathname in its first syscall "
        "and removes it on failure — a second export destroying the first one's bytes",
        [
            (
                EXPORT,
                "  const partial = partialPathFor(path)\n  const fd = openSync(partial, 'w')",
                "  const partial = partialPathFor(path)\n  const fd = openSync(path, 'w')",
            ),
            (EXPORT, "      rmSync(partial, { force: true })", "      rmSync(path, { force: true })"),
        ],
    ),
    (
        "M20 · ⛔ M3 · only the DELETE half is put back: the good export survives the truncation and "
        "is removed by the failure path anyway",
        [(EXPORT, "      rmSync(partial, { force: true })", "      rmSync(path, { force: true })")],
    ),
    (
        "M21 · ⛔ M3 · the scratch file is never renamed, so a SUCCESSFUL export writes nothing where "
        "it said it did — the fix breaking the feature it protects",
        [(EXPORT, "  renameSync(partial, path)", "  ")],
    ),
    (
        "M22 · ⚠️ M3 · the scratch file wears the provider's own extension, so a native export leaves "
        "something `discoverSessionsIn` and the provider both offer as a conversation",
        [
            (
                EXPORT,
                "  return `${path}.partial-${process.pid}-${++partialCounter}`",
                "  return `${path}.${++partialCounter}.jsonl`",
            )
        ],
    ),
    # ------------------------------------------------- 207 M1/M2 · the overview
    (
        "M23 · ⛔ THE DEFECT, verbatim · a pure permission GRANT falls through to the question "
        "branch — no scope, 'asks more than one question', and Reject as the only decision",
        [
            (
                ATTN,
                "      if (questions.length === 0 && grant !== undefined) {",
                "      if (false) {",
            )
        ],
    ),
    (
        "M24 · ⛔ M1 · the grant's scope lines are empty, so the row shows nothing a person could "
        "weigh while offering them an Approve",
        [
            (
                ATTN,
                "  if (grant.paths.length > 0) lines.push(`paths: ${grant.paths.join(', ')}`)",
                "  if (false) lines.push(`paths: ${grant.paths.join(', ')}`)",
            )
        ],
    ),
    (
        "M25 · ⛔ M1 · zero questions maps to the `multiple` limit again — the sentence 'asks more "
        "than one question' about a request that asks none",
        [
            (
                ATTN,
                "  if (questions.length === 0) return 'no-question'",
                "  if (questions.length === 0 && false) return 'no-question'",
            )
        ],
    ),
    (
        "M26 · ⛔ THE DEFECT, verbatim · the projection never reads the sent flag, so every button "
        "stays live after the first click and the last visible choice can lose to the first",
        [(ATTN, "        sent: record.requests.get(requestId)?.sent === true,", "        sent: false,")],
    ),
    (
        "M27 · ⛔ M2 · the flag reaches the row and the BUTTONS ignore it — the same defect one "
        "component along, where nothing else would notice",
        [(QUEUE, '            :disabled="request.sent"\n', "")],
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
