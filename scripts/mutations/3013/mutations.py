"""3013 · the leak guard (673bd87f) and clean-base's shared-folder line (6c0262e7).

⛔ **The subject**: two gates that protect a person. The leak guard keeps credential-like private
names out of a public tree and a public CI log: it hides every pattern it prints, whole; it fails
the command with exit 1; it runs second in `pnpm run ci`, and the one secret goes to its job
alone. clean-base, which empties a person's data, says at the head of its report when the folder
it would empty is the one every BroBot shares — on a dry run as on a real one, however the folder
was reached.

⚠️ Every pattern any killer uses is an invented one; no row here reads a real pattern list.

## ⚑ What a row here measures

 * ⚑ **M1–M3, M6 are what the guard prints** (`leak-check.mjs`'s `shown` and its lists): an
   overlapping match hidden whole, a pattern in a path hidden in the "lower the baseline" and
   "remove from the allow-list" lists, a text whose lower case changes length hidden entirely.
 * ⚑ **M4 is the exit**: a new mention fails the command, so `ci` goes red.
 * ⚑ **M5, M7, M8 are what it reads**: a blank `BROBOT_LEAK_PATTERNS_FILE` is no name; a baseline
   line it cannot read is refused; an allowed file is held to no count.
 * ⚑ **M9, M10 are where it runs**: second in the chain, and the secret handed to its job alone.
 * ⚑ **M11, M12 are clean-base's warning** (`clean-base.mjs`, today's text after dev `2264dcfd`,
   which asks `againstTheSharedFolder` of where the target leads): the warning hangs on the
   target being the shared folder and on nothing else — not on a dry run (M11) — and the
   target is asked of the FOLDER, not compared by its spelling (M12).

## ⛔ What this table does not contain

 * ⚠️ 6a78a7c6 / 5969e68a (docs moved out, a README line): no logic.
 * ⚠️ clean-base's `parsed.dir === null` condition and its early exit before the warning
   (f441ec95): their rows are table 3014's.
 * ⚠️ `againstTheSharedFolder`'s own link-following (2264dcfd): not these commits'.
"""

LEAK = "scripts/leak-check.mjs"
PKG = "package.json"
CI = ".github/workflows/ci.yml"
CLEAN = "scripts/clean-base.mjs"

READS = "leak-check-what-it-reads.test.mjs"
HIDES = "leak-check-says-nothing-it-hides-and-only-lowers.test.mjs"
SECOND = "leak-check-runs-second-and-its-lists-hold-the-tree.test.mjs"
SHARED = "clean-base-names-the-shared-folder-before-anything-else.test.mjs"
CENSUS = "clean-base-without-running-it.test.mjs"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 an overlapping occurrence leaves part of a pattern printed (`x-aaa-y` → `x-…a-y`) "
        f"· killed by `{HIDES}`",
        [(LEAK,
          "    for (let at = lower.indexOf(pattern); at >= 0; at = lower.indexOf(pattern, at + 1)) {\n",
          "    for (let at = lower.indexOf(pattern); at >= 0; at = lower.indexOf(pattern, at + pattern.length)) {\n")],
    ),
    (
        "M2 · 🔴 the \"lower the baseline\" list prints a pattern in a path into a public CI log · "
        f"killed by `{HIDES}`",
        [(LEAK,
          "      out.push(`  ${shown(path, patterns)}: ${count} now, ${listed} listed`)\n",
          "      out.push(`  ${path}: ${count} now, ${listed} listed`)\n")],
    ),
    (
        "M3 · 🔴 the \"remove from the allow-list\" list prints a pattern in a path · killed by "
        f"`{HIDES}`",
        [(LEAK,
          "    for (const path of stale) out.push(`  ${shown(path, patterns)}`)\n",
          "    for (const path of stale) out.push(`  ${path}`)\n")],
    ),
    (
        "M4 · 🔴 a new mention is reported and the command still exits 0, so `ci` goes green · "
        f"killed by `{HIDES}`",
        # ⚑ Re-anchored in place: the commit check's mode exits the same way, so the anchor names the
        # tree check's own call; the plant is unchanged.
        [(LEAK,
          "      const { passed, text } = leakCheck({ required })\n"
          "      ;(passed ? process.stdout : process.stderr).write(`${text}\\n`)\n"
          "      if (!passed) process.exit(1)\n",
          "      const { passed, text } = leakCheck({ required })\n"
          "      ;(passed ? process.stdout : process.stderr).write(`${text}\\n`)\n"
          "      if (!passed) process.exitCode = 0\n")],
    ),
    (
        "M5 · a blank `BROBOT_LEAK_PATTERNS_FILE` is taken as a file name and refused, instead of "
        f"falling through to the config file · killed by `{READS}`",
        # ⚑ Re-anchored in place: one reader now serves the leak and the commit patterns, so the
        # variable is named by the reader's parameter; the defect is the same blank taken as a name.
        [(LEAK,
          "  const named = (env[fileVariable] ?? '').trim()\n",
          "  const named = env[fileVariable] ?? ''\n")],
    ),
    (
        "M6 · a text whose lower case changes its length is hidden by guessed position, not "
        f"entirely · killed by `{HIDES}`",
        [(LEAK,
          "  if (lower.length !== text.length) return '…'\n",
          "  if (false) return '…'\n")],
    ),
    (
        "M7 · a baseline line split by a space, not a tab, is guessed at instead of refused · "
        f"killed by `{HIDES}`",
        [(LEAK,
          "    const match = /^(.+)\\t(\\d+)$/.exec(line)\n",
          "    const match = /^(.+)\\s(\\d+)$/.exec(line)\n")],
    ),
    (
        "M8 · an allowed file is held to its baseline count, so carrying fewer fails the check · "
        f"killed by `{HIDES}`",
        [(LEAK,
          "    if (allowed.has(path)) continue\n    const count = mentions.get(path)?.length ?? 0\n",
          "    const count = mentions.get(path)?.length ?? 0\n")],
    ),
    (
        "M9 · 🔴 `pnpm run ci` runs the guard after typecheck, not second · killed by "
        f"`{SECOND}`",
        [(PKG,
          "pnpm run engine:check && pnpm run leak:check && pnpm run typecheck",
          "pnpm run engine:check && pnpm run typecheck && pnpm run leak:check")],
    ),
    (
        "M10 · 🔴 the pattern secret is handed to every CI job, not to the guard's alone · killed "
        f"by `{SECOND}`",
        [(CI,
          "          BROBOT_LEAK_PATTERNS: ${{ matrix.check == 'leak:check' && secrets.BROBOT_LEAK_PATTERNS || '' }}\n",
          "          BROBOT_LEAK_PATTERNS: ${{ secrets.BROBOT_LEAK_PATTERNS }}\n")],
    ),
    (
        "M11 · 🔴 a dry run no longer tells the person whose data the real run would empty · killed "
        f"by `{SHARED}` and `{CENSUS}`",
        [(CLEAN,
          "  if (shared !== null) {\n",
          "  if (!dryRun && shared !== null) {\n")],
    ),
    (
        "M12 · 🔴 the target is compared by its SPELLING — `--dir <shared>/`, or a link to it, "
        f"empties everyone's data without the warning · killed by `{SHARED}` and `{CENSUS}`",
        [(CLEAN,
          "  const shared = againstTheSharedFolder(target)\n",
          "  const shared = target === defaultUserData() ? 'is' : null\n")],
    ),
]
