"""539 · A flag that kept nothing and said it did.

🔴 **The PM, twice in one day:** `--dir "<his userData>" --keep-profile-auth`, and both runs ended
*"…but you passed `--keep-profile-auth`, so `provider-homes/` still stands: every profile you made
is still in the launcher, each with the `auth.json` it already had."* ⛔ **Both runs had emptied
the directory completely.** Run 1 had three `auth.json` before it and none after; run 2 had one.

## ⛔ §0's answer, because these rows only make sense once it is settled

⚑ **Neither of the two readings the brief offered.** The flag is not broken — with `--dir` on the
userData it keeps every credential by content, and `scripts/gate-only/clean-base.test.mjs` §3 has
asserted exactly that since `352`. ⛔ **The `--dir` was the PARENT of the userData.** The whole
directory then arrives at the bottom of `planCleanBase` as ONE entry the manifest does not name,
is classified `OTHER`, and is removed recursively. ⚠️ **Reproduced on a fixture against
`2d473821`**: `removed / other — 19 paths · 98 B / desktop`, exit 0, and the false sentence.

🔴 **So it is the reporting bug — and the data loss is real, which is the part "reporting bug" is
apt to be read as excluding.** The report was not describing a survival it mis-measured; it was
describing a survival that never happened, and the person who typed the flag was told the
credentials were safe.

## ⚑ The shape, which is what these rows are actually about

⛔ **The guard and the act were measured at different DEPTHS.** `--keep-profile-auth` is keyed to
`provider-homes` being a CHILD of the anchor; the removal of an unrecognised name walks every
level under it. ⚠️ **A promise checked at depth one cannot hold a removal that reaches depth n** —
so the repair is a walk at the depth the removal reaches (M3, M4, M5), not a better sentence.

⚑ **And the sentence is the other half.** `nextLaunch` was handed `keepAuth` and nothing else
(M1, M2, M7), and the post-state it now reads has to be read AFTER the removals (M6) and must not
be read at all on a preview, which deliberately produced none (M8).

## ⛔ What this table does NOT cover

 1. **The keep itself.** `352` owns `planProviderHomes`'s `keep` predicate and `removeChecked`'s
    application of it; no row here edits either. ⚑ `scripts/gate-only/clean-base.test.mjs` §3's
    *"…and --keep-profile-auth is 351's behaviour, asked for by name"* is the positive that holds it
    (it read `:428` until `717`, a line number the file had long since moved past), and it stays
    green under every row below.
 2. **`--dry-run`'s enforcement.** Every mutating syscall reachable from this script is behind an
    `apply`/`dryRun` guard (`safe-remove.mjs:420,471,494` and `removeEmptyRoot`), and `351`/`352`
    own them. ⛔ What 539 found about `--dry-run` is that it printed the same FALSE sentence, which
    M1 and M2 cover.
 3. **The case-sensitivity of the `keep` predicate.** `keep` compares `readdir`'s spelling with
    `===` while `mayRemove` reaches the file through a case-INSENSITIVE `lstat`, so a `0600`
    `Auth.json` is counted as kept and then unlinked. ⚠️ Reported as a finding: it is unreachable
    from the product (`provisionCodexAuth` always writes `auth.json`), a fix needs a volume probe,
    and `homesOnDisk` already makes the LAST LINE honest about it.

⛔ **706 · every row here was killed only by a test that spawns `clean-base`** (until `717`, below) — `scripts/gate-only/`
and `apps/desktop/gate-only/` — and standing rule §6 permits that only inside the whole gate
(`vitest.gate-only.config.ts`). ⚠️ **And `ci` never applies a mutation row**: it runs those killers on
the unmutated tree. So, until `717`, no row here could be re-verified RED by anything — `verify_row.py`
refuses the killers, and no project a table run starts reaches them, so a table run reports these
rows SURVIVED. They keep the verdicts they last earned.

⚑ **717 · R45 split that file** (the PM's ruling): its tests that never spawn the script went back to
`scripts/test/clean-base-without-running-it.test.mjs`, and each row here was re-run ALONE against it
with `verify_row.py`. ⚑ **`M4` went RED** — the derivation test is one of the moved ones — and its
label now names its killer. ⛔ The other twelve SURVIVED it: their only killers still spawn the script.
"""

CLI = "scripts/clean-base.mjs"
CLI_LIB_HOLDER = "scripts/lib/clean-base.mjs"
LIB = "scripts/lib/clean-base.mjs"

MUTATIONS = [
    # ---- the shipped lie, put back ---------------------------------------------------------------
    (
        "M1 · 🔴 THE SHIPPED LIE, PUT BACK · the verdict reads the FLAG again. ⛔ A run that kept "
        "nothing prints *\"provider-homes/ still stands … each with the auth.json it already had\"*, "
        "which is what the PM saw twice. ⚑ Killed by §11 arm two, where the flag is passed at a "
        "userData that has no provider-homes at all",
        [
            (
                CLI,
                "  const after = dryRun\n"
                "    ? { standing: keepAuth && plan.sawHomes, credentials: plan.kept }\n"
                "    : homesOnDisk(anchor)\n",
                "  const after = { standing: keepAuth, credentials: plan.kept }\n",
            )
        ],
    ),
    (
        "M2 · ⛔ the two arms of the verdict are swapped, so a run that kept the tree says it is gone "
        "and a run that removed it says it stands. ⚠️ A sentence selected by the right VALUE and the "
        "wrong SENSE is the same defect one negation over",
        [(CLI, "  if (!standing) {\n", "  if (standing) {\n")],
    ),
    (
        "M3 · 🔴 THE CLASSIFICATION, REMOVED · an unrecognised directory is removed whole again "
        "without being asked whether a userData is inside it. ⛔ This is the run the PM made: the "
        "credentials go, the exports go, the ledger goes, and exit is 0",
        [
            (
                LIB,
                "    if (entry.isDirectory()) {\n"
                "      const nested = firstNestedSign(`${anchor.real}/${entry.name}`, entry.name)\n",
                "    if (false) {\n"
                "      const nested = firstNestedSign(`${anchor.real}/${entry.name}`, entry.name)\n",
            )
        ],
    ),
    (
        "M4 · ⚠️ `provider-homes` drops out of the signs, so the one directory the flag is ABOUT no "
        "longer marks a nested userData. ⚑ Killed only by the derivation test, which is the point of "
        "having one: the fixtures also carry a ledger, so every other row would still refuse — killed by `clean-base-without-running-it.test.mjs`",
        [
            (
                LIB,
                "  'brobot-workspace',\n  HOMES_DIRNAME,\n  'one-host.sock',\n",
                "  'brobot-workspace',\n  'one-host.sock',\n",
            )
        ],
    ),
    (
        "M5 · ⛔ a directory the walk cannot READ becomes `clean` instead of a refusal, so a tree this "
        "reset could not account for is removed as if it had been accounted for. ⚑ `unknown` is a "
        "refusal is this file's own rule and it has to hold in the new walk too",
        [
            (
                LIB,
                "    if (here.kind === 'unknown') return { kind: 'unknown', why: here.why }\n",
                "    if (here.kind === 'unknown') return { kind: 'clean' }\n",
            )
        ],
    ),
    (
        "M6 · 🔴 THE ORDER · the post-state is read BEFORE the removals, so every run reports the "
        "tree it was about to delete. ⛔ `a-report-must-be-computed-from-the-outcome` is an ordering "
        "claim as much as a source claim, and a measurement taken in the wrong place is not a "
        "measurement. ⚑ Killed by the default run's own last line, which would start saying the "
        "profiles stand",
        [
            (
                CLI,
                "  const after = dryRun\n"
                "    ? { standing: keepAuth && plan.sawHomes, credentials: plan.kept }\n"
                "    : homesOnDisk(anchor)\n\n",
                "",
            ),
            (
                CLI,
                "  const done = applyChecked(inUserData.checked, { dryRun })\n",
                "  const after = dryRun\n"
                "    ? { standing: keepAuth && plan.sawHomes, credentials: plan.kept }\n"
                "    : homesOnDisk(anchor)\n"
                "  const done = applyChecked(inUserData.checked, { dryRun })\n",
            ),
        ],
    ),
    (
        "M7 · ⚠️ the credential clause fires at zero, so a tree of Claude-only homes is told that "
        "`0 managed auth.json were kept`. ⛔ The staleness warning that follows it is advice about a "
        "file that is not there",
        [(CLI, "    (credentials > 0\n", "    (credentials >= 0\n")],
    ),
    (
        "M9 · 🔴 an export bundle stops being a sign, so a userData this reset itself cleaned — "
        "whose only remaining content is the one file that cannot be regenerated — is invisible "
        "again. ⛔ Reset on Monday, `--dir` one level too high on Tuesday, exports gone at exit 0",
        [
            (
                LIB,
                "      if (entry.isFile() && BUNDLE_NAME.test(entry.name) && at.endsWith(`/${EXPORTS_DIRNAME}`)) {",
                "      if (false && entry.isFile() && BUNDLE_NAME.test(entry.name)) {",
            )
        ],
    ),
    (
        "M10 · ⚠️ the bundle's HOLDER becomes the directory the sign sits in, so the remedy points "
        "at `<userData>/exports` rather than at the userData. ⛔ Advice that re-runs the mistake one "
        "directory down is worse than none",
        [(LIB, "          holder: at.slice(0, at.length - EXPORTS_DIRNAME.length - 1),", "          holder: at,")],
    ),
    (
        "M11 · ⛔ the refusal names the top-level ENTRY again instead of the holder the walk "
        "computed, which is the userData only when the nesting is exactly one level. ⚠️ At two it "
        "sends a person one directory too high — into the mistake they are being warned about",
        [(CLI_LIB_HOLDER, "        const userData = `${anchor.real}/${nested.holder}`", "        const userData = `${anchor.real}/${entry.name}`")],
    ),
    (
        "M12 · ⚠️ a bundle name anywhere becomes a sign, not only under `exports/` — so a stray copy "
        "in a Chromium cache refuses the run and the holder is computed from a path that is not a "
        "userData. ⚑ The control plants exactly that and requires the run to finish",
        [
            (
                LIB,
                " && at.endsWith(`/${EXPORTS_DIRNAME}`)) {",
                ") {",
            )
        ],
    ),
    (
        "M13 · ⚑ the scan sorts by the runtime's COLLATION again, so which sign a refusal names "
        "depends on the machine's locale and ICU build rather than on the tree. ⛔ `REPORT_ORDER` "
        "exists one report over for this exact drift, and a refusal a person cannot reproduce is a "
        "refusal they cannot act on",
        [
            (
                LIB,
                "    const entries = [...here.entries].sort((a, b) =>\n      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,\n    )",
                "    const entries = [...here.entries].sort((a, b) => a.name.localeCompare(b.name))",
            )
        ],
    ),
    (
        "M8 · ⛔ the PREVIEW reads the disk it deliberately did not change, so `--dry-run` describes "
        "the state before the run instead of the one a real run would produce. ⚑ This is `352`'s "
        "pasted-root defect in a new place: a preview may not predict from a directory the preview "
        "did not empty",
        [
            (
                CLI,
                "  const after = dryRun\n"
                "    ? { standing: keepAuth && plan.sawHomes, credentials: plan.kept }\n"
                "    : homesOnDisk(anchor)\n",
                "  const after = homesOnDisk(anchor)\n",
            )
        ],
    ),
]
