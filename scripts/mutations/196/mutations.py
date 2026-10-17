#!/usr/bin/env python3
"""196's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **This table is checked by the harness it repairs, and that is safe for a reason worth writing
down.** `mutate.sh` sources `scripts/mutations/lib/harness.sh` once, at `.`; `bash` reads a sourced
file exactly then. So when a row below mutates that file, the functions already in memory do not
change — the mutant is measured by a PRISTINE harness, and the only process that ever executes the
mutated text is the fresh `bash` the `scripts` test project spawns. The recursion is real and it
resolves in the right direction: the instrument judging the mutation is the fixed one.

⚠️ **What this table cannot reach**, stated because a table that is silent about its edges is
claiming its edges:

  * `scripts/ui-live-smoke.mjs`, `resume-live-smoke.mjs`, `packaged-smoke.mjs` — live scripts, and
    `pnpm run ci` cannot run a live smoke. That is precisely why 196 lifted the verdict arithmetic,
    the gap-free check and the run-scoping into `scripts/lib/`: the logic those steps depend on is
    reachable even though the steps are not.
  * `scripts/mutations/census.py` — Python, and there is no Python project in `vitest.config.ts`.
    Its new inventory gate was verified by running it: it caught `188 M18` going stale during this
    dispatch, which is a live demonstration rather than a row.
  * `vitest.smoke.config.ts` / `scripts/lib/smoke-globalsetup.mjs` — only executed by a live probe
    run, same class as the first bullet.

The shape is 187/188's `(name, file, old, new)`, and `--dry-run` reads the tree without touching it
(166 §11). ⛔ **Do not apply these by hand** — `mutate.sh` owns the tree, takes the repository-global
lock this dispatch introduced, and restores from a pristine copy keyed by FULL relative path.
"""

from __future__ import annotations

import sys

HARNESS = "scripts/mutations/lib/harness.sh"
ORD = "scripts/lib/ledger-ordinals.mjs"
VERD = "scripts/lib/smoke-verdicts.mjs"
GUARD = "scripts/lib/personal-home-guard.mjs"
FAKE = "packages/runtime/src/fake-runtime.ts"

# (name, file, old, new)
MUTATIONS = [
    # ---- §1 · H1 — the verdict that ignored the process -----------------------------------------
    (
        "M1  · ⛔ H1 · the exit status is discarded again — the verdict is read from vitest's "
        "stdout alone, exactly as all 32 tables did",
        HARNESS,
        "  status=$?\n",
        "  status=0\n",
    ),
    (
        "M2  · ⛔ H1 · the fourth verdict is gone, so a run whose tests ALL PASSED and whose "
        "process exited 1 prints GREEN",
        HARNESS,
        '  elif [[ "$status" != "0" ]]; then\n'
        "    # ⛔ The fourth outcome. All %s tests passed and the process still said no: an unhandled\n"
        "    # rejection, a dead worker, a teardown that threw. Neither a green nor a killed mutant.\n"
        "    printf 'ERROR all %s passed but vitest exited %s in %s files' \"$tests\" \"$status\" \"${files:-?}\"\n",
        "",
    ),
    (
        "M3  · ⚠️ H1 · a short run is reported as ERROR rather than INVALID, so 'the tree is not "
        "the tree under test' is buried under 'the process was unhappy'",
        HARNESS,
        '  elif [[ "$expect" != "-" && "$tests" != "$expect" ]]; then\n'
        "    printf 'INVALID (collected %s of %s, exit %s)' \"$tests\" \"$expect\" \"$status\"\n",
        "",
    ),
    # ---- §2 · H2 — one lock, one tree -----------------------------------------------------------
    (
        "M4  · ⛔ H2 · the lock goes back inside the table's own directory, so two tables take two "
        "different locks and edit one working tree",
        HARNESS,
        '  MUTATION_TREE_LOCK="$ROOT/scripts/mutations/.tree-lock"',
        '  MUTATION_TREE_LOCK="${HERE:-$ROOT}/.lock"',
    ),
    (
        "M5  · ⛔ H2 · release drops its ownership check, so a table that never took the lock "
        "deletes the one somebody else is holding",
        HARNESS,
        '  [[ -n "${MUTATION_TREE_LOCK:-}" ]] || return 0\n'
        '  rm -rf "$MUTATION_TREE_LOCK" 2>/dev/null',
        '  rm -rf "$ROOT/scripts/mutations/.tree-lock" 2>/dev/null',
    ),
    # ---- §3 · H3 — "gap-free", tested for --------------------------------------------------------
    (
        "M6  · ⛔ H3 · the span check is gone, so a strictly increasing sequence with a hole in it "
        "is called gap-free — the exact defect 193 found",
        ORD,
        "  if (span !== ordinals.length) {",
        "  if (false && span !== ordinals.length) {",
    ),
    (
        "M7  · ⛔ H3 · an EMPTY ledger is gap-free again — `some` is false over nothing, and the "
        "export could carry no entries at all",
        ORD,
        "  if (!Array.isArray(ordinals) || ordinals.length === 0) {",
        "  if (!Array.isArray(ordinals)) {",
    ),
    (
        "M8  · ⚠️ H3 · a non-integer ordinal is no longer named — `last - first + 1` is NaN and "
        "compares false against everything, so the check silently stops checking",
        ORD,
        "    if (!Number.isInteger(value)) {",
        "    if (false && !Number.isInteger(value)) {",
    ),
    # ---- §4 · H1 (live) — the fourth outcome ----------------------------------------------------
    (
        # ⛔ **ANCHOR RESTORED at 209, not retired.** 206 H1 gave the same function a claim list, so
        # the one-line `if` this row pointed at became a block and `census.py --check` reported the
        # row as protecting nothing. The PROPERTY is unchanged and still worth a row — a
        # not-asserted return must not read as a pass — so the anchor moves with the code rather
        # than the row being regenerated away. Re-run and still RED at 209.
        "M9  · ⛔ H1 · a not-asserted return is a pass again, which is how `85/85` came to include "
        "four steps that checked nothing",
        VERD,
        "  if (isNotAsserted(outcome)) {",
        "  if (false) {",
    ),
    (
        "M10 · ⛔ H1 · the headline sums the blanks back into `passed`, so the count is honest in "
        "the cells and a lie in the one number anybody reads",
        VERD,
        "  const passed = of('PASS').length",
        "  const passed = results.length - of('FAIL').length",
    ),
    (
        "M11 · ⚠️ H1 · the headline stops NAMING the blanks, leaving a count nobody can act on",
        VERD,
        "    (blank > 0 ? ` · ⚠️ ${blank} ran but asserted nothing` : '') +",
        "    '' +",
    ),
    # ---- §5 · M2 — a walk that says when it stopped ---------------------------------------------
    (
        "M12 · ⛔ M2 · the depth bound stops being recorded, so a leak below it reports as absence",
        GUARD,
        "    if (depth > maxDepth) {\n      tooDeep.push(dir)\n      return\n    }",
        "    if (depth > maxDepth) return",
    ),
    (
        "M13 · ⛔ M2 · a directory that would not open is silent again — one unreadable folder and "
        "the whole home reads clean",
        GUARD,
        "      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') unreadable.push(dir)\n",
        "",
    ),
    (
        "M14 · ⛔ M2 · `complete` answers only the hit cap, which is the 188 state: one of three "
        "ways to stop early reported, and two silent",
        GUARD,
        "    complete: !truncated && tooDeep.length === 0 && unreadable.length === 0,",
        "    complete: !truncated,",
    ),
    (
        "M15 · ⛔ M2 · the depth bound goes back to 6 — 156 directories under `~/.claude` and 1,627 "
        "under `~/.codex` unvisited, on every run, saying nothing",
        GUARD,
        "export const DEFAULT_MAX_DEPTH = 64",
        "export const DEFAULT_MAX_DEPTH = 6",
    ),
    # ---- §6 · M4 — a double that is Claude under a Codex label ----------------------------------
    (
        "M16 · ⛔ M4 · a codex-labelled Fake publishes Claude's card again, so 55 construction "
        "sites go on certifying Claude behaviour under a Codex name",
        FAKE,
        "  return provider === 'codex' ? CODEX_OFFER : OPAQUE_OFFER",
        "  return OPAQUE_OFFER",
    ),
    (
        "M17 · ⛔ M4 · the standing grant is Claude's for both, so the codex Fake offers "
        "`allow_for_session` and then asks again — 182 H4 with a new label",
        FAKE,
        "  return provider === 'codex' ? 'allow_for_session' : 'allow_all_for_session'",
        "  return 'allow_all_for_session'",
    ),
    (
        "M18 · ⛔ M4 · both providers return one catalogue again, so a host that hands Codex's menu "
        "Claude's models cannot be caught by any assertion on it",
        FAKE,
        "        id: `fake-${this.provider}-a`,",
        "        id: `fake-model-a`,",
    ),
]


def files() -> list[str]:
    seen = []
    for (_name, path, _old, _new) in MUTATIONS:
        if path not in seen:
            seen.append(path)
    return seen


def apply(root: str, index: int, dry: bool = False) -> bool:
    import pathlib

    _name, rel, old, new = MUTATIONS[index]
    path = pathlib.Path(root) / rel
    text = path.read_text()
    if text.count(old) != 1:
        print(f"!! anchor not unique in {rel}: {text.count(old)} occurrences", file=sys.stderr)
        return False
    if not dry:
        path.write_text(text.replace(old, new))
    return True


def main() -> int:
    args = sys.argv[1:]
    if args and args[0] == "--files":
        print(" ".join(files()))
        return 0
    if args and args[0] == "--count":
        print(len(MUTATIONS))
        return 0
    if args and args[0] == "--name":
        print(MUTATIONS[int(args[1])][0])
        return 0
    if len(args) >= 2 and args[1] == "--dry-run":
        ok = True
        for index in range(len(MUTATIONS)):
            if not apply(args[0], index, dry=True):
                print(f"   ^ {MUTATIONS[index][0]}", file=sys.stderr)
                ok = False
        print("all anchors unique" if ok else "SOME ANCHORS MISSING")
        return 0 if ok else 1
    root, index = args[0], int(args[1])
    return 0 if apply(root, index) else 1


if __name__ == "__main__":
    raise SystemExit(main())
