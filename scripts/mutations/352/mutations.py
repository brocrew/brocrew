"""352 · A clean base that left the profiles standing — the remove set, and the sentence about it.

⛔ **`351` shipped green with the defect this table is about.** Its own suite proved the reset
removed the paths `351` had decided to remove, and every one of those assertions still passes. What
no row could see is that the decision was wrong: the launcher's profile menu **is** the
`provider-homes/<project>/<profile>` directory listing (`listProfileIds`), so emptying each
`<provider>` leaf and keeping the directories left every profile the person had ever made in the menu —
and the managed `auth.json` it also kept was, by then, the copy the provider had already retired.

⚑ **So this table is about two things a person can check without reading any code**: what the
launcher offers after a clean base, and whether the sentences the script prints are true of the run
that printed them.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M4`-`M7`, `M10`-`M13`, `M26`, `M28`-`M34` | ⚑ **`scripts/gate-only/clean-base.test.mjs`** |
| `M1`-`M3`, `M8`, `M9`, `M14`, `M27` | ⚑ **`scripts/test/clean-base-without-running-it.test.mjs`** — the two planners' units (since `717`) |
| `M15`-`M25` | ⚑ **`scripts/gate-only/clean-base.test.mjs`** (report, mood and outcome) |
| `M35` | ⚑ **`apps/desktop/gate-only/a-clean-base-leaves-no-profiles.test.ts`** |

⛔ **706 · the `gate-only/` killers above run only inside `pnpm run ci`** — they spawn `clean-base`,
which standing rule §6 permits only inside the whole gate (`vitest.gate-only.config.ts`). ⚠️ **And `ci`
never applies a mutation row**: it runs these killers on the unmutated tree. So a row whose ONLY
killer is one of them can no longer be re-verified RED by anything — `verify_row.py` refuses the
killer, and no project a table run starts reaches it, so a table run reports the row SURVIVED. The
row keeps the verdict it last earned.

⚑ **717 · R45 split that file** (the PM's ruling): its tests that never spawn the script went back to
`scripts/test/clean-base-without-running-it.test.mjs`, and each row below was re-run ALONE against
it with `verify_row.py`. ⚑ **`M1`-`M3`, `M8`, `M9`, `M14` and `M27` went RED** — the planners' own units see them — and each label now names its killer. Every other gate-only row here SURVIVED that file — `M4`-`M7`, `M10`-`M13`, `M15`-`M26`, `M28`-`M34`, and `M35`, whose killer is the desktop gate-only test —
so its only killer still spawns the script, and it keeps its last verdict.

⚠️ **`M35` is not a row about the product; it is a row about this dispatch's own instrument.** The
acceptance test asks the launcher's own function what the menu holds, and a positive assertion must
differ from the default — so the row makes `listProfileIds` incapable of ever naming a profile. If
the paired positive were vacuous, the whole test would still pass with the answer hard-coded.

## ⚑ §5, §7 and half of §1 are an adversarial pass over this dispatch's own finished diff

⛔ **`M13` is the one that mattered.** `352`'s first draft widened the managed-credential check to
BOTH paths, on the reading that an unaccountable shape is unaccountable either way. 🔴 **That made a
`0644` `auth.json` — one a restore, a `cp` under a permissive umask or a sync tool can produce —
refuse `pnpm clean-base` in every mode**, with no flag past it: a reset a person cannot run and
cannot clear without chmod'ing a file they cannot see. The check belongs where the answer decides
something, and `351` had it right.

⛔ **`M6` is the one a person would have hit first.** `351` made the `.DS_Store` exception at the
project and profile levels and never at the leaf level — so opening `provider-homes/default/default`
in Finder, to look at your own `claude` and `codex` homes, made every subsequent run refuse and
remove nothing, permanently.

⛔ **`M22`, `M23` and `M24` are `351`'s defect arriving in new places.** A `--dry-run` said
*"provider-homes/ is gone"* after removing nothing, and a run that could not finish said the same
thing two lines under its own `left in place` block.

## ⛔ What this table deliberately does NOT contain

⛔ **No second row on the `0600` comparison itself.** `351` `M28` already mutates it; `M13` is the
row for the PATH it runs on, which is what `352` changed and changed back.

⛔ **No row on the credential being kept under the flag.** That is `351` `M27`, **corrected in place
rather than retired**: the rule it pinned (*"the managed credential is never kept"*) is the defect
`352` removes, so the row now pins the surviving half. `351`'s table has never been run, so no
verdict moved with the anchor.

⛔ **No row on a dry run mistaking a removal that would FAIL for one that succeeds.** With
`apply: false` the `unlink` that would throw `EACCES` is never called, so it counts — and there is no
honest way to close that: a permission model is not a prediction. `safe-remove.mjs` now states the
bound instead of claiming it away, and `M24` is the row for the half that IS knowable, which is what
the real run then reports.

⛔ **No row on the ORDER of the reported profile names.** `readdir` order is the filesystem's, and a
mutation of `[...profiles].sort()` is a rule measured only where both readings agree.
"""

BASE = "scripts/lib/clean-base.mjs"
CLI = "scripts/clean-base.mjs"
SAFE = "scripts/lib/safe-remove.mjs"
PH = "apps/desktop/src/main/runtime/provider-homes.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the tree really goes, which is the whole dispatch ────────────────────────────────
    (
        "M1 · 🔴 the provider-homes tree is never removed, so a clean base leaves every profile "
        "he ever made in the launcher · 351's defect, exactly — killed by `clean-base-without-running-it.test.mjs`",
        [
            (
                BASE,
                "  if (!keepAuth) {\n    actions.push({\n      rel: HOMES_DIRNAME,",
                "  if (false) {\n    actions.push({\n      rel: HOMES_DIRNAME,",
            )
        ],
    ),
    (
        "M2 · ⛔ the leaf actions are emitted BESIDE the tree action, so a nested removal is "
        "counted once for real and twice in the preview · the dry run stops meaning anything — killed by `clean-base-without-running-it.test.mjs`",
        [(BASE, "        if (!keepAuth) continue", "        if (false) continue")],
    ),
    (
        "M3 · ⚠️ the report names the PROJECT where the profile is what left the launcher — killed by `clean-base-without-running-it.test.mjs`",
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired — The rule
        # survives: the report's profiles list names `<folder>/<profile>`, the profile that left the
        # launcher, not just the folder. The line is unchanged apart from project renamed to folder.
        # Killed by `clean-base-without-running-it.test.mjs`.
        [
            (BASE, '        profiles.add(`${folder.name}/${profile.name}`)', '        profiles.add(folder.name)'),
        ],
    ),
    (
        "M4 · ⛔ a Finder `.DS_Store` beside the projects becomes a refusal nobody can clear again",
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired — The rule
        # survives: a Finder `.DS_Store` beside the folders is a named stray, never a permanent
        # refusal. Only the variable was renamed (`folderRel`), and the plant is the same refusal
        # with 'home folder' in place of 'project directory'. Killed by
        # `a-stray-beside-the-home-folder-is-named-and-a-folder-brobot-could-not-make-refuses.test.mjs`.
        [
            (BASE, '      else strays.push(folderRel)', '      else refusals.push(`${folderRel} is not a home folder`)'),
        ],
    ),
    (
        "M5 · ⛔ …and the same file one level down, beside the profiles",
        [
            (
                BASE,
                "        else strays.push(profileRel)",
                "        else refusals.push(`${profileRel} is not a profile directory`)",
            )
        ],
    ),
    (
        "M6 · 🔴 …and at the third level, BESIDE the provider homes — where 351 never made the "
        "exception, so opening that folder in Finder made the reset permanently unrunnable",
        [(BASE, "        if (leaf.isFile()) {", "        if (false) {")],
    ),
    (
        "M7 · ⛔ the Finder exception widens from a regular FILE to anything that is not a "
        "directory, so a symlink planted beside the homes is unlinked instead of refusing",
        [(BASE, "        if (leaf.isFile()) {", "        if (!leaf.isDirectory()) {")],
    ),
    # ── §2 · the flag reads the way its name reads ────────────────────────────────────────────
    (
        "M8 · 🔴 the planner keeps the homes unless asked not to · the default is 351's again — killed by `clean-base-without-running-it.test.mjs`",
        [
            (
                BASE,
                "export function planProviderHomes(anchor, { keepAuth = false } = {}) {",
                "export function planProviderHomes(anchor, { keepAuth = true } = {}) {",
            )
        ],
    ),
    (
        "M9 · 🔴 …and the same inversion one caller up, where nothing passes the option at all — killed by `clean-base-without-running-it.test.mjs`",
        [
            (
                BASE,
                "export function planCleanBase(anchor, { dropExports = false, keepAuth = false } = {}) {",
                "export function planCleanBase(anchor, { dropExports = false, keepAuth = true } = {}) {",
            )
        ],
    ),
    (
        "M10 · ⛔ the flag means its opposite: passing it drops the homes and omitting it keeps them",
        [
            (
                CLI,
                "  const keepAuth = parsed.flags.has('--keep-profile-auth')",
                "  const keepAuth = !parsed.flags.has('--keep-profile-auth')",
            )
        ],
    ),
    (
        "M11 · ⚠️ the retired spelling is the one the parser accepts, so the documented flag is an "
        "unknown option and the escape hatch cannot be reached",
        [(CLI, "  '--keep-profile-auth',", "  '--drop-profile-auth',")],
    ),
    (
        "M12 · ⛔ the flag is parsed, reported and never passed to the planner",
        [
            (
                BASE,
                "      const homes = planProviderHomes(anchor, { keepAuth })",
                "      const homes = planProviderHomes(anchor, {})",
            )
        ],
    ),
    # ── §3 · the question is asked where the answer decides something, and only there ──────────
    (
        "M13 · 🔴 the managed credential is checked on the path that REMOVES the whole tree too, so "
        "a 0644 auth.json makes the reset unrunnable in every mode · 352's own first draft",
        [
            (
                BASE,
                "        if (keepAuth && leaf.name === 'codex') {",
                "        if (leaf.name === 'codex') {",
            )
        ],
    ),
    (
        "M14 · ⚠️ the tree is removed by name rather than as a directory, so `mayRemove` refuses "
        "it and every run of the default stops — killed by `clean-base-without-running-it.test.mjs`",
        [
            (
                BASE,
                "      rel: HOMES_DIRNAME,\n      expect: 'dir',",
                "      rel: HOMES_DIRNAME,\n      expect: 'unlink',",
            )
        ],
    ),
    # ── §4 · the report says what this run did ────────────────────────────────────────────────
    (
        "M15 · ⛔ the footnote is attached to a group that does not exist, so nothing the reset "
        "did to the launcher is ever printed",
        [
            (
                CLI,
                "    if (why === HOMES) out.push(...homesFootnote(plan, { dryRun, keepAuth, partial: homesPartial }))",
                "    if (why === HOMES_DIRNAME) out.push(...homesFootnote(plan, { dryRun, keepAuth, partial: homesPartial }))",
            )
        ],
    ),
    (
        "M16 · ⚠️ the profile names never leave the planner",
        [(BASE, "      profiles = homes.profiles", "      profiles = []")],
    ),
    (
        "M17 · ⚠️ …and neither do the entries BroBot did not write, which go unnamed into the tree "
        "· 350: an unfamiliar entry is NAMED, never re-labelled",
        [(BASE, "      homeStrays = homes.strays", "      homeStrays = []")],
    ),
    (
        "M18 · 🔴 the report tells a person their profiles are gone on the run that kept them",
        [(CLI, "  } else if (keepAuth) {", "  } else if (false) {")],
    ),
    (
        "M19 · ⚠️ the one sentence that answers the question he asked stops being printed",
        [(CLI, "  if (!keepAuth && !partial) {", "  if (false) {")],
    ),
    # ⚠️ **539 corrected both anchors below and re-took both verdicts by hand.** `528`'s write-rail
    # reported them `anchor-absent`: `539` replaced `nextLaunch`'s positional `keepAuth` with an
    # options object and split its ternary into two returns, so the BYTES moved. ⛔ The SUBJECTS did
    # not — M20 still discards the run's own mode at the call site and M21 still drops the clause a
    # person runs this to read — so they are repaired rather than retired
    # (`a-corrected-anchor-keeps-a-verdict-it-never-earned`, and this one was re-earned).
    (
        "M20 · 🔴 the last line describes the default on every run, whatever the run did · 351's "
        "exact failure, which is what got the defect relayed as a feature",
        [
            (
                CLI,
                "    nextLaunch({ keepAuth, dryRun, partial: homesPartial, ...after }),",
                "    nextLaunch({ keepAuth, dryRun: false, partial: false, ...after }),",
            )
        ],
    ),
    (
        "M21 · ⚠️ …and it stops saying the thing a person is running this to be told",
        [
            (
                CLI,
                "`${opening} and no profiles: ${HOMES_DIRNAME}/ is gone",
                "`${opening}: ${HOMES_DIRNAME}/ is gone",
            )
        ],
    ),
    # ── §5 · mood and outcome — 351's defect arriving in new places (352 review) ───────────────
    (
        "M22 · 🔴 the PREVIEW speaks in the indicative: `--dry-run` removed nothing and the last "
        "line says provider-homes/ is gone, 18 migrations and all",
        [
            (
                CLI,
                "    `  next launch${dryRun ? ', if you run this without --dry-run' : ''}: MIGRATED AND UNSEEDED, ` +",
                "    `  next launch: MIGRATED AND UNSEEDED, ` +",
            )
        ],
    ),
    (
        "M23 · ⛔ …and the footnote above it does the same, in the sentence 352 §2.1 makes the "
        "acceptance test",
        [
            (
                CLI,
                "    lines.push(`      profile homes ${dryRun ? 'that would go' : 'gone'}:`)",
                "    lines.push('      profile homes gone:')",
            )
        ],
    ),
    (
        "M24 · 🔴 the report is computed from the PLAN rather than the outcome, so one byte that "
        "would not come off leaves a profile on disk while the run says it went",
        [
            (
                CLI,
                "  const homesPartial = done.some((a) => a.why === HOMES && a.outcome === 'partly removed')",
                "  const homesPartial = false",
            )
        ],
    ),
    (
        "M25 · ⚠️ a home under another project is claimed as a launcher entry · `listProfileIds` "
        "is scoped to the default project and `listProviderHomes` is not",
        [
            (
                CLI,
                "  const menu = plan.profiles.filter((name) => name.startsWith(prefix))",
                "  const menu = plan.profiles",
            )
        ],
    ),
    # ── §6 · the escape hatch keeps what its name promises ────────────────────────────────────
    (
        "M26 · ⛔ the kept home is removed root and all, so the credential inside it takes the "
        "removal down with it and the run exits non-zero",
        [
            (
                BASE,
                "          empty: true,\n          keep: leaf.name === 'codex' ? CODEX_AUTH : null,",
                "          empty: false,\n          keep: leaf.name === 'codex' ? CODEX_AUTH : null,",
            )
        ],
    ),
    (
        "M27 · 🔴 the report promises it kept the credential on the run that deleted it · a "
        "'kept on purpose' line for something that is gone is 351's sentence in a new place — killed by `clean-base-without-running-it.test.mjs`",
        [(BASE, "      if (keepAuth && homes.kept > 0) {", "      if (!keepAuth) {")],
    ),
    (
        "M28 · ⚠️ …and it promises it over a tree that holds no credential at all, because the "
        "entry is pushed before any codex home has been walked",
        [(BASE, "      if (keepAuth && homes.kept > 0) {", "      if (keepAuth) {")],
    ),
    (
        "M29 · ⚠️ a Codex home whose first session never ran counts as a kept credential",
        [(BASE, "          if (auth.kind === 'ok') kept += 1", "          kept += 1")],
    ),
    # ── §7 · the pasted-image root, which sits outside every group ────────────────────────────
    (
        "M30 · ⛔ the dry run predicts from a directory the dry run did not empty, so the preview "
        "says the root SURVIVES and the run it previews deletes it",
        [
            (
                BASE,
                "    return { removed: false, planned: true, why: null }",
                "    return readdirSync(anchor.real).length > 0\n"
                "      ? { removed: false, why: 'it is not empty' }\n"
                "      : { removed: true, why: null }",
            )
        ],
    ),
    (
        "M31 · 🔴 a root this reset could not remove is printed and exits 0 · the one path where a "
        "silent success and a silent partial failure look identical to `$?`",
        [
            (
                CLI,
                "  if (failed.length > 0 || rootFailed) process.exitCode = 1",
                "  if (failed.length > 0) process.exitCode = 1",
            )
        ],
    ),
    (
        "M32 · ⚠️ the root comes off disk and the total says nothing did",
        [
            (
                CLI,
                "      totalPaths += 1\n      out.push(\n        root.removed",
                "      out.push(\n        root.removed",
            )
        ],
    ),
    (
        "M33 · ⛔ the stray it KEEPS is named at the spelling that was typed, so on a symlinked "
        "userData the report points at a path nothing is at",
        [
            (
                CLI,
                "      rel: `${pastedImagesRoot(anchor.real)}/${name}`,",
                "      rel: `${pastedImagesRoot(anchor.lexical)}/${name}`,",
            )
        ],
    ),
    # ── §8 · what the script claims to know ───────────────────────────────────────────────────
    (
        "M34 · ⚠️ a path that is not there is reported as a fact about BroBot's history, with a "
        "success-shaped report and exit 0 · which is what a typo in --dir looks like",
        [
            (
                CLI,
                "      `  nothing at this path, so there is nothing to remove.` +",
                "      `  nothing here — BroBot has never written to this directory.` +",
            )
        ],
    ),
    (
        "M35 · ⚑ `listProfileIds` can never name a profile, so 'the menu holds only default' is "
        "true before the reset as well as after it · the paired positive, measured",
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired —
        # listProviderHomes now walks only HOME_FOLDER ('default') and still skips a profile id that
        # is not a path segment; the rule that a stray non-segment entry is never reported as a
        # profile survives, only the indentation and surrounding code moved (the projectId level of
        # the walk is gone). Re-anchor on the current single-line guard inside the profile loop and
        # invert it. The table's own killer is gate-only (ci-only) and must not be run, so name
        # provider-homes.test.ts as the runnable killer. Killed by `provider-homes.test.ts`,
        # `refused-launch.test.ts`, `profile-uniqueness.test.ts`.
        [
            (PH, '    if (!isPathSegment(profileId)) continue', '    if (isPathSegment(profileId)) continue'),
        ],
    ),
]
