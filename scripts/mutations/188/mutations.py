#!/usr/bin/env python3
"""188's mutation table — each row is THE DEFECT, put back verbatim (131).

Every row here is one of 168's or 182's findings restored, so a GREEN cell is a statement that the
fix has no test behind it. The shape is 187's `(name, file, old, new)`, and `--dry-run` reads the
tree without touching it (166 §11): an anchor is the FIXED text, so a mutation left stuck in the
tree shows up as a MISSING anchor rather than as a clean dry-run.

⛔ **Do not apply these by hand** — `mutate.sh` owns the tree, takes a lock, and restores from a
pristine copy keyed by FULL relative path (147: this repo has two `session-store.ts`).
"""

from __future__ import annotations

import sys

CODEX = "packages/runtime/src/codex/codex-runtime.ts"
STALE = "packages/runtime/src/codex/stale-permission-config.ts"
CONF = "packages/runtime/src/internal/confinement.ts"
NORM = "packages/runtime/src/codex/normalize.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
HOMES = "apps/desktop/src/main/runtime/provider-homes.ts"
INSTR = "apps/desktop/src/main/runtime/instructions.ts"
CHANGES = "apps/desktop/src/renderer/src/components/SessionChanges.vue"
GUARD = "scripts/lib/personal-home-guard.mjs"
RUN = "scripts/lib/smoke-run.mjs"

# (name, file, old, new)
# ⚑ **314's block, quoted here so M1 can move the WHOLE migration prologue below the attestation.**
# It is read as one string rather than reconstructed, so a later edit to that prologue reddens this
# anchor — which is the point of `mutations:check` — instead of silently mutating something else.
# ⚑ **the launch settings are recorded · re-anchored in place, NOT VERIFIED and HELD (its killer reads provider-home code, where no mutant runs without a written lift)** — a start now keeps what the memory write answered, for its launch settings, so the write's line names that; the row's edit and claim are unchanged
LAUNCH_MIGRATIONS_THEN_ATTEST = (
    "    removeStaleCodexPermissionConfig(opts.providerHome)\n"
    "    // \u26d4 **The two gates, on EVERY launch and not only on provisioning** (314). A profile created\n"
    "    // before this existed has no memory config at all, and there is no migration hook \u2014 so the only\n"
    "    // place that reaches every home is the place the 157 migration above already stands.\n"
    "    //\n"
    "    // \u26a0\ufe0f **Below the stale sweep and above the attestation**, and both halves of that ordering are\n"
    "    // load-bearing: merging into a file the line above is about to delete would be work thrown away,\n"
    "    // and `assertCodexSqliteHomeContained` parses this very file, so it must see the bytes the child\n"
    "    // will. \u2691 It never throws \u2014 see {@link ensureCodexMemoryConfig}; a home whose config cannot be\n"
    "    // merged launches without memory rather than not launching.\n"
    "    const memoryConfig = ensureCodexMemoryConfig(opts.providerHome)\n"
    "    this.assertLaunchPreconditions(opts.providerHome) // fail closed BEFORE spawning (022 + 041)"
)

MUTATIONS = [
    # ---- §1 · 168 M4 / L2 — the stale 157 config ------------------------------------------------
    # ⚑ **ANCHOR CORRECTED IN PLACE BY 314** (142). 314 put `ensureCodexMemoryConfig` between the
    # removal and the attestation, so the two lines this row used to reorder are no longer adjacent.
    # ⛔ **The row's claim is unchanged and its edit is the same edit** — the removal ends up below
    # the attestation, which is the 168 M4 defect — and the block that sits between them travels with
    # it, because 314's write has the same reason to be below the sweep as the sweep has to be above
    # the attestation. Nothing is retired: the row still kills, and it still kills the same tests.
    (
        "M1  · ⛔ 168 M4 · the removal runs AFTER the attestation again, so an unparseable "
        "generated config can never be cleaned",
        CODEX,
        LAUNCH_MIGRATIONS_THEN_ATTEST,
        "    this.assertLaunchPreconditions(opts.providerHome) // fail closed BEFORE spawning (022 + 041)\n"
        + LAUNCH_MIGRATIONS_THEN_ATTEST.rsplit(
            "\n    this.assertLaunchPreconditions(opts.providerHome)", 1
        )[0],
    ),
    (
        "M2  · ⛔ the generated-header fail-safe is dropped — it now deletes ANY `config.toml` "
        "out of a Codex home, including one this app never wrote",
        STALE,
        "  if (!text.startsWith(GENERATED_HEADER)) return null // somebody else's config; not ours to delete\n",
        "",
    ),
    (
        "M3  · ⛔ 168 L2 · a home that is only PREPARED keeps its stale policy — adoption-only and "
        "never-relaunched homes go back to being unreachable",
        "apps/desktop/src/main/providers/codex/index.ts",
        "  removeStaleCodexPermissionConfig(home)\n",
        "",
    ),
    # ---- §2 · 168 L3 — what may grant the cardless write ---------------------------------------
    (
        "M4  · ⛔ 168 L3 · every ABSOLUTE string grants again, so a path-shaped `content` is the "
        "reason a write outside the directory is allowed",
        CONF,
        "      if (isAbsolute(node) && key !== null && PATH_FIELDS.has(key)) named += 1",
        "      if (isAbsolute(node)) named += 1",
    ),
    (
        "M5  · ⛔ …and the mirror: the REFUSAL narrows to declared fields too, so `{file_path: "
        "<inside>, path: '../../out.txt'}` sails through on the file beside it",
        CONF,
        "      if (!canNameAFile(node)) return true",
        "      if (!canNameAFile(node) || key === null || !PATH_FIELDS.has(key)) return true",
    ),
    # ---- §3 · 182 M4 — the rate-limit contract --------------------------------------------------
    (
        "M6  · ⛔ 182 M4 · the reset goes back to `Math.max` across BOTH windows, beside a "
        "percentage that belongs to one of them",
        NORM,
        "  const resets = windowResetsAt(worst?.window)",
        "  const resets = Math.max(\n"
        "    windowResetsAt(readField(snapshot, 'primary')),\n"
        "    windowResetsAt(readField(snapshot, 'secondary')),\n"
        "  )",
    ),
    (
        "M7  · ⛔ the watch keeps nothing — every frame is judged alone again, so a sparse frame "
        "downgrades a wall the provider never withdrew",
        NORM,
        "    const merged: Record<string, unknown> = { ...(this.held ?? {}) }",
        "    const merged: Record<string, unknown> = {}",
    ),
    (
        "M8  · ⛔ …and the dedup goes, so a hundred-turn conversation gets a hundred identical "
        "warnings (177 measured one or two frames per turn)",
        NORM,
        "    if (line === null || line === this.said) return null",
        "    if (line === null) return null",
    ),
    (
        "M9  · ⛔ the expiry fires on every frame, so the merge never happens at all",
        NORM,
        "    return resets.length > 0 && resets.every((at) => at * 1000 <= now)",
        "    return true",
    ),
    # Re-anchored, NOT VERIFIED and HELD; its test reaches a held path.
    (
        "M10 · ⛔ the handle stops passing its watch — the wiring, not the class: production goes "
        "back to the per-frame reading while the class's own tests stay green",
        'packages/runtime/src/codex/codex-runtime.ts',
        '    for (const normalized of normalizeNotification(method, params, this.rateLimits)) {',
        '    for (const normalized of normalizeNotification(method, params)) {',
    ),
    # ---- §4 · 182 M5 — safety buffering ---------------------------------------------------------
    (
        "M11 · ⛔ 182 M5 · `showBufferingUi: true` is chatter again — the turn pauses and the app "
        "says nothing",
        NORM,
        "      if (readField(params, 'showBufferingUi') !== true) {",
        "      if (true as boolean) {",
    ),
    (
        "M12 · ⛔ …and the other way: the flag stops gating, so the provider's own `false` becomes "
        "a transcript line on every routine frame",
        NORM,
        "      if (readField(params, 'showBufferingUi') !== true) {\n"
        "        return [wrapUnknown('codex', { method, params }, 'lifecycle', method)]\n"
        "      }\n",
        "",
    ),
    # ---- §5 · 168 M6 / L5 — the two nulls --------------------------------------------------------
    (
        "M13 · ⛔ 168 M6 · a null profile is refused whatever it means, so a pre-profile Codex row "
        "loses every generated image on re-derivation",
        HOST,
        "  if (row.adoptedAt !== null && row.profileId === null) return null // the user's own home\n"
        "  return row.profileId ?? DEFAULT_PROFILE_ID",
        "  return row.profileId",
    ),
    (
        "M14 · ⛔ …and the mirror: a USER-HOME row is read as `default`, so the app claims to serve "
        "files it never owned",
        HOST,
        "  if (row.adoptedAt !== null && row.profileId === null) return null // the user's own home\n",
        "",
    ),
    (
        "M15 · ⛔ 168 L5 · an explicit null in a bundle collapses to `default` again, so a "
        "`~/.claude` conversation comes back claiming a home of ours",
        HOST,
        "        profileId:\n"
        "          profileId ??\n"
        "          (bundle.meta.profileId === undefined ? DEFAULT_PROFILE_ID : bundle.meta.profileId),",
        "        profileId: profileId ?? bundle.meta.profileId ?? DEFAULT_PROFILE_ID,",
    ),
    # ---- §6 · 182 L2 — the helper that overpromised ----------------------------------------------
    (
        "M16 · ⚠️ 182 L2 · `realPath` climbs ONE level again — the contract its own comment states "
        "is false, and no current call site is deep enough to notice",
        "apps/desktop/src/main/providers/instruction-io.ts",
        "      return join(realpathSync.native(at), ...tail)",
        "      return tail.length > 1 ? absolute : join(realpathSync(at), ...tail)",
    ),
    # ---- §7 · 182 L3/L4 — a basename is a path ---------------------------------------------------
    (
        "M17 · ⛔ 182 L3 · the under-disclosed row leaks a BASENAME — no separator, so the old "
        "assertion could not see it",
        CHANGES,
        '<span class="path"><span class="name">content not reported</span></span>',
        '<span class="path"><span class="name">content not reported: secrets.env</span></span>',
    ),
    # ---- §8 · 182 M7/M8 — the instruments ---------------------------------------------------------
    (
        "M18 · ⛔ 182 M8 · the leak scan stops looking without saying so, so a truncated walk and a "
        "clean one are the same answer again",
        GUARD,
        "  return { hits, truncated }",
        "  return { hits, truncated: false }",
    ),
    (
        "M19 · ⛔ 182 M7 · the run lock is not taken, so two smokes can own one evidence tree",
        RUN,
        "  try {\n    mkdirSync(lock)\n  } catch {",
        "  try {\n    mkdirSync(lock, { recursive: true })\n  } catch {",
    ),
    (
        "M20 · ⛔ …and provenance is unbounded: nothing is ever pruned, so `keep` is a number the "
        "caller passes and nobody honours",
        RUN,
        "  for (const name of runs.slice(0, Math.max(0, runs.length - keep))) {",
        "  for (const name of runs.slice(0, 0)) {",
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
