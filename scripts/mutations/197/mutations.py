#!/usr/bin/env python3
"""197's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **Five rows here exist because five OLD rows died in this dispatch.** `187 M11`-`M14` and
`188 M4` anchored on lines 197 rewrote, so `mutations:check` failed CI and named them. 188's rule is
retire-in-place-and-carry-the-protection-forward, not delete: rows **M21-M25** below are those five
defects restored in the code that replaced them, so nothing this project once proved stops being
proved.

⚠️ **What this table cannot reach**, stated because a table silent about its edges is claiming them:

  * `apps/desktop/src/renderer/**` — no renderer component moved, so project `dom` is not run.
    `NewConversation.vue`'s own guard is unchanged and is not this dispatch's boundary: 190 H2 is
    explicit that the host-side rule exists precisely because Vue cannot protect the callers that
    are not the renderer.
  * `packages/runtime/src/claude/normalize.ts` — `TOOL_SUMMARY_MAX` is now exported and the memory
    sentences are designed against it, but the only mutation of a bound like that (make it larger)
    loosens an assertion rather than breaking one. The fit is asserted; the constant is not mutated.
  * The `unscanned`/`unmeasured` sentences reach the model through the SDK's own tool-result path,
    which no test in `pnpm run ci` drives end to end (190 M6 measured that gap and it is ranked, not
    closed here).

The shape is 187/188/196's `(name, file, old, new)`, and `--dry-run` reads the tree without touching
it (166 §11). ⛔ **Do not apply these by hand** — `mutate.sh` owns the tree, takes 196's
repository-global lock, and restores from a pristine copy keyed by FULL relative path.
"""

from __future__ import annotations

import sys

BOUND = "packages/runtime/src/internal/memory-bound.ts"
CONF = "packages/runtime/src/internal/confinement.ts"
HOMES = "apps/desktop/src/main/runtime/provider-homes.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

# (name, file, old, new)
MUTATIONS = [
    # ---- §1 · H1 — two classifiers for one fact -------------------------------------------------
    (
        "M1  · ⛔ H1 · the classifier stops asking whether the string could name a file at all, "
        "so 190 H1's over-long payload is a TARGET again and spends zero bytes",
        CONF,
        "  return canNameAFile(value) && isAbsolute(value) && key !== null && PATH_FIELDS.has(key)",
        "  return isAbsolute(value) && key !== null && PATH_FIELDS.has(key)",
    ),
    (
        "M2  · ⛔ H1 · the classifier stops asking WHICH FIELD, so an absolute `content` is a "
        "target again — 168 L3, in the accounting this time",
        CONF,
        "  return canNameAFile(value) && isAbsolute(value) && key !== null && PATH_FIELDS.has(key)",
        "  return canNameAFile(value) && isAbsolute(value)",
    ),
    (
        "M3  · ⛔ H1 · the BOUND grows its own second classifier again — `isAbsolute` in all but "
        "name, which is exactly the state 190 measured",
        BOUND,
        "      if (namesATarget(node, key)) targets.push(node)",
        "      if (node.startsWith('/')) targets.push(node)",
    ),
    (
        "M4  · ⛔ H1 · a stat that FAILED is zero bytes again — the last step of the bypass",
        BOUND,
        "    return notThere(error) ? { kind: 'absent' } : { kind: 'unmeasured' }",
        "    return { kind: 'absent' }",
    ),
    (
        "M5  · ⛔ H1 · a target nobody could weigh is allowed through rather than refused",
        BOUND,
        "  if (targets.some((target) => target.kind === 'unmeasured')) return 'unmeasured'\n",
        "",
    ),
    (
        "M6  · ⚠️ H1 · the key stops travelling with the value, so every string is judged under "
        "no key and the grant and the bound part company again",
        BOUND,
        "      for (const [name, child] of Object.entries(node)) walk(child, name)",
        "      for (const child of Object.values(node)) walk(child, null)",
    ),
    # ---- §3 · M5 — a bound that reported the answer it would have given -------------------------
    (
        "M7  · ⛔ M5 · the walk stops at the FILE limit again, so 5,001 files hide every byte "
        "after them and a directory over 64 MiB keeps growing",
        BOUND,
        "      if (++visited > MEMORY_SCAN_LIMIT) {",
        "      if (files > MEMORY_FILE_LIMIT) {",
    ),
    (
        "M8  · ⛔ M5 · the walk stops SAYING it stopped — a partial byte total reported as whole",
        BOUND,
        "      if (++visited > MEMORY_SCAN_LIMIT) {\n        complete = false\n        return true\n      }",
        "      if (++visited > MEMORY_SCAN_LIMIT) {\n        return true\n      }",
    ),
    (
        "M9  · ⛔ M5 · a partial sum is allowed to say 'under', which is the one direction it "
        "cannot be sound in",
        BOUND,
        "  if (!held.complete) return 'unmeasured'\n",
        "",
    ),
    (
        "M10 · ⚠️ M5 · a dirent the stat then refused to weigh is counted as zero rather than "
        "voiding the measurement",
        BOUND,
        "      if (state.kind === 'unmeasured') return false\n",
        "",
    ),
    # ---- §3 · M6 — a denial that misdescribed itself --------------------------------------------
    (
        "M11 · ⛔ M6 · the sentence promises that every other write still asks — false in auto "
        "mode, and read as an assurance",
        BOUND,
        "  const untouched = ' Nothing already written there has been changed; it can be pruned by hand.'",
        "  const untouched =\n"
        "    ' Nothing already written there has been changed, and it can be pruned by hand.' +\n"
        "    ' Every other write takes its ordinary route and still asks.'",
    ),
    (
        "M12 · ⛔ M6 · the folder moves to the END of the sentence, past the 200 code units the "
        "ledger keeps — the row stops before the one thing a person can act on",
        BOUND,
        "  const where = (claim: string): string => `${claim}: ${dir}.`",
        "  const where = (claim: string): string =>\n"
        "    `${claim}. It is a bound brobot2 keeps per profile, measured across every file in the "
        "folder, and the folder is ${dir}.`",
    ),
    (
        "M13 · ⛔ M6 · 'we could not measure it' is announced as 'this write is over 64 MB' — a "
        "number nobody compared it to",
        BOUND,
        "  if (held === null) return 'unmeasured'",
        "  if (held === null) return 'total-bytes'",
    ),
    (
        "M14 · ⛔ M6 · 'we could not read your call' is announced as 'over 256 KB', for the same "
        "reason and in the other direction",
        BOUND,
        "  if (proposal === null) return 'unscanned'",
        "  if (proposal === null) return 'file-bytes'",
    ),
    # ---- §2 · H2 — the door that was not a launch ------------------------------------------------
    (
        "M15 · ⛔ H2 · the credential door stops asking the rule — 190 H2 exactly: a read-looking "
        "question provisions a second spelling of an existing profile",
        "apps/desktop/src/main/providers/codex/index.ts",
        "    paths.assertMayOpen(profileId)\n",
        "",
    ),
    (
        "M16 · ⛔ H2 · the door accepts a profile nobody has ever started, so a gesture creates "
        "one as a side effect of asking about it",
        HOMES,
        "  if (owner === profileId) return\n  throw new ProfileUnopenable(",
        "  if (owner === profileId || owner === null) return\n  throw new ProfileUnopenable(",
    ),
    (
        "M17 · ⛔ H2 · the door FOLDS a case variant instead of refusing it — the answer 187 "
        "ruled against, because it sends a value that is not the one on screen",
        HOMES,
        "  const owner = profileAlreadyNamed(profileId, existing)\n"
        "  if (owner === profileId) return",
        "  const owner = profileAlreadyNamed(profileId, existing) ?? profileId\n"
        "  if (owner !== null) return",
    ),
    (
        "M18 · ⛔ H2 · the rule runs AFTER the directory is made, so a refused gesture still "
        "leaves the spelling behind and the next attempt is an exact match",
        "apps/desktop/src/main/providers/codex/index.ts",
        "    paths.assertMayOpen(profileId)\n    return paths.homeOf(profileId)\n  }\n  const homeFor = async (profileId: string): Promise<string> => {\n    const home = homePathFor(profileId)\n    await provisionProviderHome(paths.managedRoot, home)",
        "    return paths.homeOf(profileId)\n  }\n  const homeFor = async (profileId: string): Promise<string> => {\n    const home = homePathFor(profileId)\n    await provisionProviderHome(paths.managedRoot, home)\n    paths.assertMayOpen(profileId)",
    ),
    (
        "M19 · ⚠️ H2 · the host folds the refusal into 'could not ask', so the app's own decision "
        "is reported as the provider failing to answer (086)",
        HOST,
        "      if (error instanceof ProfileUnopenable) return { state: 'unknown', reason: error.message }\n",
        "",
    ),
    (
        "M20 · ⛔ H2 · the rule moves onto `prepareProviderHome`, which is the RESUME path — "
        "187's measured trap, and it strands every pre-187 row",
        "apps/desktop/src/main/providers/home.ts",
        "  const home = paths.homeOf(profileId)\n  await (provision ?? provisionProviderHome)(paths.managedRoot, home)",
        "  paths.assertMayOpen(profileId)\n  const home = paths.homeOf(profileId)\n  await (provision ?? provisionProviderHome)(paths.managedRoot, home)",
    ),
    # ---- the five rows this dispatch retired, carried forward into the code that replaced them ---
    (
        "M21 · ⛔ 187 M11, re-anchored · the file already on disk is not charged, so an Edit "
        "grows one memory past the cap a kilobyte at a time",
        BOUND,
        "  if (proposal.bytes + existing > MEMORY_FILE_CAP) return 'file-bytes'",
        "  if (proposal.bytes > MEMORY_FILE_CAP) return 'file-bytes'",
    ),
    (
        "M22 · ⛔ 187 M12, re-anchored · an EXISTING file spends the count bound, so a full "
        "directory can never be consolidated — the only pruning move the agent has",
        BOUND,
        "  if (held.files >= MEMORY_FILE_LIMIT && targets.some((target) => target.kind !== 'file')) {",
        "  if (held.files >= MEMORY_FILE_LIMIT) {",
    ),
    (
        "M23 · ⛔ 187 M13, re-anchored · an input too large to walk PASSES instead of failing "
        "closed — 'we stopped looking' read as 'we found nothing'",
        BOUND,
        "  if (proposal === null) return 'unscanned'",
        "  if (proposal === null) return null",
    ),
    (
        "M24 · ⛔ 187 M14, re-anchored · a directory that cannot be read is reported as empty",
        BOUND,
        "  if (held === null) return 'unmeasured'",
        "  if (held === null) return null",
    ),
    (
        "M25 · ⛔ 188 M4, re-anchored · every ABSOLUTE string grants again, so a path-shaped "
        "`content` is the reason a write outside the directory is allowed (168 L3)",
        CONF,
        "      if (namesATarget(node, key)) named += 1",
        "      if (isAbsolute(node)) named += 1",
    ),
    # ---- the two PAIRED assertions, which a table of refusals would otherwise never test --------
    (
        "M26 · ⚑ the paired POSITIVE · every memory write is refused, so the fix is 'deny "
        "everything' — which every row above would still call a success",
        BOUND,
        "  if (proposal.bytes + existing > MEMORY_FILE_CAP) return 'file-bytes'",
        "  if (proposal.bytes + existing >= 0) return 'file-bytes'",
    ),
    (
        "M27 · ⚑ the paired NEGATIVE · nothing is ever refused for size, so 166's cardless write "
        "is unbounded again — the state 187 §3 exists to end",
        BOUND,
        "  if (proposal.bytes + existing > MEMORY_FILE_CAP) return 'file-bytes'\n",
        "",
    ),
]


def apply(root, index: int, dry: bool) -> int:
    name, rel, find, replace = MUTATIONS[index]
    path = root / rel
    text = path.read_text()
    hits = text.count(find)
    if hits != 1:
        print(f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)", file=sys.stderr)
        return 1
    if not dry:
        path.write_text(text.replace(find, replace, 1))
    return 0


def main() -> int:
    from pathlib import Path

    args = sys.argv[1:]
    if args[:1] == ["--count"]:
        print(len(MUTATIONS))
        return 0
    if args[:1] == ["--files"]:
        seen = []
        for _name, rel, _find, _replace in MUTATIONS:
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
