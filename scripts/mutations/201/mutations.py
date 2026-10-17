#!/usr/bin/env python3
"""201's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **Five of these rows are 192 H1's five sequences**, and each one is the code that really shipped
until this commit: one flat record for a keyed protocol (`M1`), a top-level merge for a nested shape
(`M2`), a `said` that survived a return to quiet (`M5`), an expiry that filtered the unknown resets
out before asking whether the rest had passed (`M7`), and no baseline at all (`M9`).

⛔ **Four rows are inherited, and the census is why.** `pnpm run mutations:check` reported `177 M1`
and `188 M7/M8/M9` stale the moment this rewrite landed: their anchors were the lines 201 replaced,
so four rows that had been protecting real behaviour were suddenly protecting nothing. Every one of
their defects is still a defect, so each is carried forward here on the new anchor — `M11` (the wall
the provider reports is ignored), `M3` (the watch keeps nothing), `M6` (the dedup goes), `M8` (the
expiry fires on every frame) — and the old rows are retired in the same census regeneration. ⚠️ **A
stale row is not a row that failed; it is a row that stopped being asked**, which is why the check
exists and why retiring one silently would be the worse half of 174's debt.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. These were taken after `format:check`
was green.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

  * **The WIRE.** Every row drives the app's own vocabulary against a `FakeTransport` or the pure
    class. No row can say whether the pinned binary answers `account/rateLimits/read`, whether it
    fills `rateLimitsByLimitId`, or whether a rolling frame always carries its `limitId` — the three
    facts §2's whole choice rests on. ⚑ `probe:ratelimit-baseline` is the instrument for that, and
    its numbers (two buckets, `codex` and `codex_bengalfox`; 1/1 frames named their bucket) are in
    the response doc. It was written and run BEFORE the design, not after it.
  * **A REAL wall.** No row here, and no test in this repo, has ever been at one. Every wall in the
    suite is a captured routine frame with `rateLimitReachedType` set by hand — 177's own method,
    and the reason `throttle-probe.smoke.ts` injects rather than waits. ⛔ A table that claimed
    otherwise would be claiming a state nobody has reached.
  * **The `desktop`, `dom`, `shared` and `scripts` projects.** 201 moves code in exactly two files,
    both inside the Codex adapter, so `runtime` is the only project this table runs (147 M17's rule:
    the filters come from the files the table TOUCHES). Nothing downstream changed: the baseline's
    answer reaches the renderer as an `unknown{lifecycle}`, a type the transcript has folded since
    049 and `ui-live-smoke.mjs` step 7 has whitelisted since before that.
  * **Whether the multi-bucket SENTENCE is the right one.** Rows can kill a qualifier that stops
    firing; none of them can say that *"on the GPT-5.3-Codex-Spark limit"* is better than a bucket
    name in parentheses, or than two lines the reader is left to tell apart. That is an argument,
    and it is in §1 of the response.
  * **Whether not awaiting the baseline is right.** `M10` kills a baseline that is fetched and
    thrown away; nothing here can measure what awaiting it would cost a session start. 175 is the
    evidence that the cost is real, and it is evidence about a different call.

⛔ **Do not apply these by hand** — `mutate.sh` owns the tree, takes 196's repository-global lock,
and restores from a pristine copy keyed by FULL relative path.
"""

from __future__ import annotations

import sys

NORMALIZE = "packages/runtime/src/codex/normalize.ts"
ADAPTER = "packages/runtime/src/codex/codex-runtime.ts"

MUTATIONS = [
    # ---- §1 · key it by bucket ---------------------------------------------------------------
    (
        "M1 · ⛔ THE DEFECT, verbatim · ONE flat record for a keyed protocol — the `limitId` is "
        "never consulted, so a frame for another bucket inherits ours and describes no real bucket",
        [
            (
                NORMALIZE,
                "    if (named !== '') return this.buckets.has(named) ? named : this.room(named)\n",
                "    if (false && named !== '') return this.room(named)\n",
            )
        ],
    ),
    (
        "M2 · ⛔ THE DEFECT, verbatim · the merge is TOP-LEVEL again — a fresh `primary` replaces "
        "the held one whole, taking the `windowDurationMins` and `resetsAt` that were merely unsent",
        [
            (
                NORMALIZE,
                "    merged[key] =\n"
                "      isMergeable(held) && isMergeable(value) ? mergeSparse(held, value) : structuredCopy(value)\n",
                "    merged[key] = isMergeable(held) && false ? merged[key] : structuredCopy(value)\n",
            )
        ],
    ),
    (
        "M3 · ⛔ 188 M7, carried forward · the watch keeps NOTHING — every frame is judged alone, so "
        "a sparse frame downgrades a wall the provider never withdrew",
        [
            (
                NORMALIZE,
                "    bucket.snapshot = mergeSparse(bucket.snapshot, incoming)\n",
                "    bucket.snapshot = mergeSparse({}, incoming)\n",
            )
        ],
    ),
    (
        "M4 · a null CLEARS what was observed · 165's rule inverted, which is the reading the "
        "contract names twice and refuses twice",
        [
            (
                NORMALIZE,
                "    if (value === null || value === undefined) continue\n",
                "    if (value === undefined) continue\n",
            )
        ],
    ),
    # ---- §4 · the dedup that outlived its state -------------------------------------------------
    (
        "M5 · ⛔ THE DEFECT, verbatim · `said` survives a return to quiet, so a wall that lifts and "
        "comes back word-for-word is deduped against a limit that had already ended",
        [
            (
                NORMALIZE,
                "    if (line === null) {\n      bucket.said = null\n      return null\n    }\n",
                "    if (line === null) return null\n",
            )
        ],
    ),
    (
        "M6 · ⛔ 188 M8, carried forward · the dedup goes entirely, so a hundred-turn conversation "
        "collects a hundred identical warnings (177 measured one or two frames per turn)",
        [(NORMALIZE, "    if (line === bucket.said) return null\n", "")],
    ),
    # ---- §5 · the expiry ------------------------------------------------------------------------
    (
        "M7 · ⛔ THE DEFECT, verbatim · the unknown reset is filtered out BEFORE asking whether the "
        "rest have passed, so a snapshot expires on the strength of a window it chose to ignore",
        [
            (
                NORMALIZE,
                "  const resets = windows.map(windowResetsAt)\n"
                "  if (resets.some((at) => at === 0)) return false\n"
                "  return resets.every((at) => at * 1000 <= now)\n",
                "  const resets = windows.map(windowResetsAt).filter((at) => at > 0)\n"
                "  return resets.length > 0 && resets.every((at) => at * 1000 <= now)\n",
            )
        ],
    ),
    (
        "M8 · ⛔ 188 M9, carried forward · the expiry fires on every frame, so the merge never "
        "happens at all and every frame is the first one this session ever saw",
        [(NORMALIZE, "  return resets.every((at) => at * 1000 <= now)\n", "  return true\n")],
    ),
    # ---- §2 · the baseline ----------------------------------------------------------------------
    (
        "M9 · ⛔ THE DEFECT, verbatim · nothing calls `account/rateLimits/read` (the pre-201 code) — "
        "a user already at the wall opens a fresh conversation with an empty watch",
        [(ADAPTER, "    this.readRateLimitBaseline()\n", "")],
    ),
    (
        "M10 · the baseline is fetched and thrown away · seeded but never SPOKEN, so the state is "
        "right and the user at the wall still learns nothing until a frame happens to arrive",
        [
            (
                ADAPTER,
                # ⚑ **provider-followups-1 · re-anchored in place, not retired** — provider follow-ups 1 passes the read's own times to seed; the mutation is the same, the lines are not said
                "      for (const line of this.rateLimits.seed(response, Date.now(), askedAt)) {\n        // Non-fatal, always: a throttle pauses a turn, it does not end a session (065's rule).\n        this.emit({ type: 'error', message: line, fatal: false })\n      }\n",
                "      this.rateLimits.seed(response, Date.now(), askedAt)\n",
            )
        ],
    ),
    (
        "M11 · ⛔ 177 M1, carried forward · the wall the provider reports DIRECTLY is ignored and "
        "only a percentage can speak — the whole subject of 177 §1",
        [
            (
                NORMALIZE,
                "  if (reached) {\n"
                "    return `codex is rate-limited (${reached})${where} — the turn may stall until it resets${when}`\n"
                "  }\n",
                "  if (false && reached) {\n"
                "    return `codex is rate-limited (${reached})${where} — the turn may stall until it resets${when}`\n"
                "  }\n",
            )
        ],
    ),
    (
        "M12 · the baseline OVERWRITES what was observed · a response that arrives after a rolling "
        "frame resurrects the state the session has just left",
        [
            (
                NORMALIZE,
                # ⚑ **provider-followups-1 · re-anchored in place, not retired** — provider follow-ups 1 puts a LATER read on top; the mutation is the same, the first read overwrites what rolling frames said
                "      bucket.snapshot = this.seeded\n        ? mergeSparse(bucket.snapshot, snapshot)\n        : mergeSparse(snapshot, bucket.snapshot)\n",
                "      bucket.snapshot = mergeSparse(bucket.snapshot, snapshot)\n",
            )
        ],
    ),
    (
        "M13 · the baseline speaks for EVERY bucket · a warning about a metered limit this "
        "conversation has never touched, on every session open (074's noise, restored)",
        [
            (
                NORMALIZE,
                # ⚑ **provider-followups-1 · re-anchored in place, not retired** — provider follow-ups 1 names the main bucket through mainKey(); the mutation is the same, every bucket speaks from the baseline
                "    const key = this.mainKey()\n    const bucket = key === null ? undefined : this.buckets.get(key)\n    if (key === null || bucket === undefined) return []\n    const line = this.speak(key, bucket)\n    return line === null ? [] : [line]\n",
                "    const lines: string[] = []\n"
                "    for (const [each, bucket] of this.buckets) {\n"
                "      const line = this.speak(each, bucket)\n"
                "      if (line !== null) lines.push(line)\n"
                "    }\n"
                "    return lines\n",
            )
        ],
    ),
    # ---- the sentence, and the bound ------------------------------------------------------------
    (
        "M14 · the sentence never names its bucket · two metered limits, two unqualified sentences, "
        "and a reader with no way to tell which one stopped the turn",
        [
            (
                NORMALIZE,
                "    return this.buckets.size > 1 && key !== this.primaryLimitId\n",
                "    return false\n",
            )
        ],
    ),
    (
        "M15 · EVERY bucket names itself, including the only one · §3's shape moves for every user "
        "with a single limit, which is every user 177 was written for",
        [
            (
                NORMALIZE,
                "    return this.buckets.size > 1 && key !== this.primaryLimitId\n",
                "    return true\n",
            )
        ],
    ),
    (
        "M16 · an unnamed frame gets a bucket of its OWN · a sparse frame with no `limitId` starts "
        "from nothing and says 'approaching' while a wall stands in the bucket it belongs to",
        [
            (
                NORMALIZE,
                "    if (this.primaryLimitId !== null && this.buckets.has(this.primaryLimitId)) {\n"
                "      return this.primaryLimitId\n"
                "    }\n"
                "    if (this.buckets.size === 1) return [...this.buckets.keys()][0] ?? null\n",
                "",
            )
        ],
    ),
    (
        "M17 · 🔒 the bucket map is UNBOUNDED · its key is a `limitId` off the wire, so a provider "
        "emitting distinct ids grows one session's memory without limit (052's subject, 200 M12's shape)",
        [
            (
                NORMALIZE,
                "    if (named !== '') return this.buckets.has(named) ? named : this.room(named)\n",
                "    if (named !== '') return named\n",
            )
        ],
    ),
    (
        "M18 · the merge's BASE is spread, not copied · what the watch retains aliases the provider "
        "payload the raw history also carries, for the life of the session (found by self-review)",
        [(NORMALIZE, "  const merged = copyRecord(base)\n", "  const merged = { ...base }\n")],
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
