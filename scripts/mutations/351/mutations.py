"""351 · A clean base you can run a hundred times — each row is one refusal, untold.

⛔ **Every row below removes a refusal from a script that DELETES.** That is the whole subject: the
reset's safety is not a confirmation prompt — `351` §1 rules that out, because *"a script that asks
him to confirm every time is a script he will route around"* — it is a set of things the code will
not decide. A row here is one of them going quiet.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M11`, `M37`-`M42` | ⚑ **`scripts/test/brobot-liveness.test.mjs`** |
| `M12`-`M25`, `M33`-`M36`, `M48`, `M49` | ⚑ **`scripts/test/safe-remove.test.mjs`** |
| `M26`-`M30`, `M43`-`M45`, `M47`, `M51` | ⚑ **`scripts/gate-only/clean-base.test.mjs`** |
| `M31`, `M32`, `M46` | ⚑ **`scripts/test/clean-base-without-running-it.test.mjs`** (since `717`) |
| `M50` | ⚑ **`scripts/test/pnpm-seed-cannot-be-run-by-accident.test.mjs`** (since `717`) |

⛔ **706 · the `gate-only/` killers above run only inside `pnpm run ci`** — they spawn `clean-base`,
which standing rule §6 permits only inside the whole gate (`vitest.gate-only.config.ts`). ⚠️ **And `ci`
never applies a mutation row**: it runs these killers on the unmutated tree. So a row whose ONLY
killer is one of them can no longer be re-verified RED by anything — `verify_row.py` refuses the
killer, and no project a table run starts reaches it, so a table run reports the row SURVIVED. The
row keeps the verdict it last earned.

⚑ **717 · R45 split that file** (the PM's ruling): its tests that never spawn the script went back to
`scripts/test/clean-base-without-running-it.test.mjs`, and each row below was re-run ALONE against
it with `verify_row.py`. ⚑ **`M31`, `M32`, `M46` went RED**, and so did `M50` against `pnpm seed`'s own two tests, which start `seed-demo.mjs` and never `clean-base` and came back to `scripts/test/` too; each label now names its killer. Every other gate-only row here SURVIVED that file — `M26`-`M30`, `M43`-`M45`, `M47`, `M51` —
so its only killer still spawns the script, and it keeps its last verdict.

⚠️ **Fifteen of the fifty-one are one sentence being told twice**, and that is deliberate rather than
padding: `unknown` and `not-running` are the pair this dispatch exists to keep apart, and a table
that mutated one of the two would leave the other reading as coverage.

## 🔴 §4 is what an adversarial pass over this diff found, and it is a third of the table

⛔ **`M33` is the one that mattered.** JavaScript's `realpathSync` does not canonicalise CASE, macOS
APFS is case-insensitive by default, and every forbidden-root check was a string comparison — so
`--dir /users/alex` resolved to a string equal to no forbidden root and `trustedAnchor`
returned `trusted` on a home directory. ⚠️ **Nothing in the first thirty-two rows could see it**,
because every fixture spelled its paths exactly once and exactly right.

⚠️ **W4.124 · those checks compare folders by device and inode now** (`whereItStands`), so a case no
longer opens that gap, and `M33` SURVIVED both `safe-remove.test.mjs` and `brobot-liveness.test.mjs`
(`verify_row.py`, measured). What `.native` still decides is the spelling the liveness check looks
for in a running BroBot's command line, which no test asks: for landing, a killer for that and a
new label, or a retirement by ruling. `M36` stays RED, though under it a root that could not be
resolved is now refused as one that could not be compared — its killer reads the words.

⚑ **`M37` is the one a person would have hit first**: excluding only the caller's own pid left the
`pnpm` and `sh` processes above it naming the target in their own argv, so the documented
`pnpm clean-base --dir <path>` refused every single time.

⚑ **`M41` is a new instrument, not a repaired one.** `pnpm dev` is `electron-vite dev` and passes no
`--user-data-dir`, so for the directory the person actually uses the process-table check can only ever
return `[]` — a two-instrument design whose second instrument is blind on the ordinary target.
Chromium's `SingletonLock` is inside that directory and names the pid holding it; measured on this
build as `<hostname>-<pid>` while live and `ENOENT` after a clean quit.

## ⛔ What this table deliberately does NOT contain

⛔ **No row on `mayRemove`'s `realpath(parent) === parent` recheck.** Every component from the
trusted anchor down is already `lstat`ed and refused if it is a symlink, so within one call the
recheck is redundant — it is there for the window BETWEEN the walk and the syscall, which is a
concurrent rename and which no deterministic input can drive. ⚑ **Recorded rather than removed**: the
product's own `verifyTrustedDir` narrows the same window the same way, and `safe-remove.mjs`'s header
says in as many words that the window is not closed. A reader who wants it killable should reach for
a fault-injected `realpath`, not delete the line.

⛔ **No row on `removeEmptyRoot`'s emptiness check, because there is no longer a line to mutate.**
A `readdirSync(...).length > 0` guard stood before the `rmdir` and no mutation could turn it red:
`rmdir` refuses a non-empty directory itself, atomically, so the only path that reached the guard
with anything in the directory was one the kernel would refuse anyway. ⚑ **A line nothing can kill
is not carrying its rule** — it was deleted rather than written around.

⛔ **No row on the report's wrapping, padding or byte counts.** They are real and a person reads
them, but a wrong number there is a cosmetic defect in a file whose other defects delete things.

⛔ **No row that makes `clean-base` remove MORE than it should at the top level of `userData`.**
There is nothing to break: an entry the manifest does not name is removed BY DESIGN and printed
under its own literal name (see `scripts/lib/clean-base.mjs`'s header for the measurement that
retired `350`'s fail-closed manifest). The guard that protects a future durable write is the source
census in `scripts/test/clean-base-without-running-it.test.mjs` §1 (gate-only from `706` to `717`),
which has no row here; `M31`/`M32` are rows of §2, the pins that hold the manifest's constants to the
product's.
"""

LIVE = "scripts/lib/brobot-liveness.mjs"
SAFE = "scripts/lib/safe-remove.mjs"
BASE = "scripts/lib/clean-base.mjs"
CLI = "scripts/clean-base.mjs"
SEED = "scripts/seed-demo.mjs"
UD = "scripts/lib/user-data.mjs"

CLEAN_BASE = "scripts/lib/clean-base.mjs"
MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · unknown is a refusal, never translated to stopped ────────────────────────────────
    (
        "M1 · 🔴 a regular file wearing the gate's name reads as 'nothing is listening' · "
        "ENOTSOCK joins the two errnos that mean absence",
        [
            (
                LIVE,
                "export const NOT_LISTENING_CODES = Object.freeze(['ENOENT', 'ECONNREFUSED'])",
                "export const NOT_LISTENING_CODES = Object.freeze([\n  'ENOENT',\n  'ECONNREFUSED',\n  'ENOTSOCK',\n])",
            )
        ],
    ),
    (
        "M2 · ⛔ the ordinary stale socket becomes unknown, so the reset refuses every single run "
        "· ECONNREFUSED leaves the list",
        [
            (
                LIVE,
                "export const NOT_LISTENING_CODES = Object.freeze(['ENOENT', 'ECONNREFUSED'])",
                "export const NOT_LISTENING_CODES = Object.freeze(['ENOENT'])",
            )
        ],
    ),
    (
        "M3 · 🔴 something holds the name and will not say what — and that is read as absence · "
        "the answer timeout settles as nothing-listening",
        [
            (
                LIVE,
                "        settle({\n          kind: 'unknown',\n          why: `nothing answered within",
                "        settle({\n          kind: 'nothing-listening',\n          why: `nothing answered within",
            )
        ],
    ),
    (
        "M4 · ⛔ a connection that opens and says NOTHING is taken for a live BroBot's answer",
        [
            (
                LIVE,
                "        settle({ kind: 'unknown', why: 'the connection opened and closed without a word' })",
                "        settle({ kind: 'answered', token: said })",
            )
        ],
    ),
    (
        "M5 · ⛔ anything at all is accepted as the gate's token, so a stranger on that name reads "
        "as our own app",
        [
            (
                LIVE,
                "const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/",
                "const TOKEN = /^.+$/",
            )
        ],
    ),
    (
        "M6 · 🔴 **321's defect, in the module that deletes** · a `ps` that cannot be RUN returns an "
        "empty table instead of unknown",
        [
            (
                LIVE,
                "    return { kind: 'unknown', why: `ps could not be read: ${error?.message ?? String(error)}` }",
                "    return { kind: 'read', rows: [] }",
            )
        ],
    ),
    (
        "M7 · ⛔ a `ps` that answered with nothing parseable is reported as a machine with nothing "
        "running on it",
        [
            (
                LIVE,
                "  if (rows.length === 0) return { kind: 'unknown', why: 'ps answered, and no row could be parsed' }",
                "  if (rows.length === 0) return { kind: 'read', rows }",
            )
        ],
    ),
    (
        "M8 · ⛔ a gate that could not be asked stops being a refusal · the verdict falls through "
        "to the process table",
        [
            (
                LIVE,
                "  if (gate.kind !== 'nothing-listening') {",
                "  if (gate.kind === 'never') {",
            )
        ],
    ),
    (
        "M9 · 🔴 **the load-bearing one** · a process table that could not be read is translated "
        "to not-running, and the reset deletes on the strength of its own bad minute",
        [
            (
                LIVE,
                "    return { verdict: 'unknown', reasons: [...reasons, table.why], processes: [] }",
                "    return { verdict: 'not-running', reasons: [...reasons, table.why], processes: [] }",
            )
        ],
    ),
    (
        "M10 · 🔴 **the documented invocation refuses every time** · only the caller's own pid is "
        "excluded, so `pnpm clean-base --dir X` finds the `pnpm` and `sh` above it naming X",
        [
            (
                LIVE,
                "    (row) => !mine.has(row.pid) && wanted.some((spelling) => namesPath(row.command, spelling)),",
                "    (row) => row.pid !== self && wanted.some((spelling) => namesPath(row.command, spelling)),",
            )
        ],
    ),
    (
        "M11 · ⛔ an EMPTY spelling survives the filter, and `''.includes` matches every row in the "
        "table — the reset refuses forever",
        [
            (
                LIVE,
                "    ...new Set(spellings.filter((value) => typeof value === 'string' && value !== '')),",
                "    ...new Set(spellings.filter((value) => typeof value === 'string')),",
            )
        ],
    ),
    # ── §2 · the predicate ────────────────────────────────────────────────────────────────────
    (
        "M12 · 🔴 **170 §3, put back** · a symlinked PARENT component stops being refused, so a "
        "link inside the userData walks the reset into somebody's personal home",
        [
            (
                SAFE,
                "    if (stat.isSymbolicLink()) {\n      return { kind: 'refused', why: `${next} is a symlink, and this walk never follows one` }",
                "    if (false) {\n      return { kind: 'refused', why: `${next} is a symlink, and this walk never follows one` }",
            )
        ],
    ),
    (
        "M13 · ⛔ `..` stops being a traversal segment, so a relative path can climb out of the "
        "anchor it was proved against",
        [
            (
                SAFE,
                "  if (parts.some((part) => part === '.' || part === '..')) {",
                "  if (parts.some((part) => part === '.')) {",
            )
        ],
    ),
    (
        "M14 · ⛔ a FILE where a directory belongs is walked through instead of refused",
        [
            (
                SAFE,
                "    if (!stat.isDirectory()) return { kind: 'refused', why: `${next} is not a directory` }",
                "    if (false) return { kind: 'refused', why: `${next} is not a directory` }",
            )
        ],
    ),
    (
        "M15 · ⛔ a target owned by another user is removed anyway",
        [
            (
                SAFE,
                "  if (uid !== null && stat.uid !== uid) {\n    return {\n      kind: 'refused',",
                "  if (false && stat.uid !== uid) {\n    return {\n      kind: 'refused',",
            )
        ],
    ),
    (
        "M16 · 🔴 the manifest's expected kind stops being checked, so a directory is unlinked and "
        "a socket is walked",
        [
            (
                SAFE,
                "  const allowed = expect === 'unlink' ? actual !== 'dir' : actual === expect",
                "  const allowed = true",
            )
        ],
    ),
    (
        "M17 · ⛔ a removal no longer has to NAME what it expects to find · the missing kind "
        "defaults to a permissive one",
        [
            (
                SAFE,
                "  if (!KINDS.includes(expect)) {\n    return {\n      kind: 'refused',",
                "  if (false) {\n    return {\n      kind: 'refused',",
            )
        ],
    ),
    (
        "M18 · 🔴 the walker DESCENDS through a symlink, turning a bounded removal into an "
        "unbounded one",
        [
            (
                SAFE,
                "      if (stat.isSymbolicLink()) {\n        if (unlink(child, 'links')) continue",
                "      if (false) {\n        if (unlink(child, 'links')) continue",
            ),
            (
                SAFE,
                "      if (stat.isDirectory()) {\n        const childEmptied = walk(child, childRelative)",
                "      if (stat.isDirectory() || stat.isSymbolicLink()) {\n        const childEmptied = walk(child, childRelative)",
            ),
        ],
    ),
    (
        "M19 · ⛔ `keep` is ignored, so the managed Codex credential goes with the rest of the home",
        [
            (
                SAFE,
                "      if (keep(childRelative)) {",
                "      if (false) {",
            )
        ],
    ),
    (
        "M20 · 🔴 the DRY RUN removes · `apply` stops guarding the unlink",
        [
            (
                SAFE,
                "      if (apply) unlinkSync(target)",
                "      unlinkSync(target)",
            )
        ],
    ),
    (
        "M21 · ⛔ a directory replaced between the check and the removal is removed anyway · the "
        "dev+ino recheck always says same",
        [
            (
                SAFE,
                "  return now.dev === pinned.dev && now.ino === pinned.ino ? 'same' : 'replaced'",
                "  return 'same'",
            )
        ],
    ),
    (
        "M22 · ⛔ `isAncestor` loses its separator, so `/a/b-evil` counts as inside `/a/b`",
        [
            (
                SAFE,
                "  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep)",
                "  return child.startsWith(parent)",
            )
        ],
    ),
    (
        "M23 · ⛔ an EMPTY `CODEX_HOME` becomes a forbidden root, and every target then contains it",
        [
            (
                SAFE,
                "  if (typeof env.CODEX_HOME === 'string' && env.CODEX_HOME.trim() !== '') {",
                "  if (typeof env.CODEX_HOME === 'string') {",
            )
        ],
    ),
    (
        "M24 · 🔴 a target that CONTAINS a never-touch root is accepted, so `--dir ~/Library` takes "
        "the conventional provider homes with it",
        [
            (
                SAFE,
                # ⚑ **W4.124 · re-anchored in place, not retired** — the containment check compares folders by identity now (whereItStands), not real-path strings
                "    if (where === 'holds') {",
                "    if (false) {",
            )
        ],
    ),
    (
        "M25 · ⛔ a directory CONTAINING the working directory stops being refused",
        [
            (
                SAFE,
                # ⚑ **W4.124 · re-anchored in place, not retired** — the working-directory check compares folders by identity now (whereItStands); the mutation still drops 'contains'
                "  if (fromHere === 'is' || fromHere === 'holds') {",
                "  if (fromHere === 'is') {",
            )
        ],
    ),
    # ── §3 · the manifest, the plan, and the two things kept by default ────────────────────────
    (
        "M26 · 🔴 `exports/` is removed by default · the one thing in the userData that cannot be "
        "regenerated once `raw_frame` is gone",
        [
            (
                BASE,
                "    if (rule?.name === 'exports' && !dropExports) {",
                "    if (rule?.name === 'exports' && dropExports) {",
            )
        ],
    ),
    (
        # ⚠️ **Corrected in place at 352, because 352 RETIRED the rule this row pinned.** It read
        # "the managed Codex credential is never kept", and keeping it by default is the defect
        # `352` §1 exists to remove: the copy shares one rotating refresh token with `~/.codex`, so
        # the preserved copy is the retired one. ⛔ The subject survives with its polarity reversed —
        # the credential is kept when, and only when, `--keep-profile-auth` asks — and that is what
        # this row pins now. ⚑ It was never run, so no verdict moved with it.
        "M27 · 🔴 `--keep-profile-auth` keeps the profile directory and drops the credential inside "
        "it · the one thing the flag exists to keep is the one thing it loses",
        [
            (
                BASE,
                "          keep: leaf.name === 'codex' ? CODEX_AUTH : null,",
                "          keep: null,",
            )
        ],
    ),
    (
        "M28 · ⛔ an `auth.json` at any mode is treated as the managed credential",
        [
            (
                BASE,
                "          if (auth.kind === 'ok' && (auth.stat.mode & 0o777) !== CODEX_AUTH_MODE) {",
                "          if (auth.kind === 'ok' && false) {",
            )
        ],
    ),
    (
        "M29 · 🔴 a project directory BroBot could not have created is stepped over instead of "
        "refusing the run",
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired — The rule
        # survives: a directory under provider-homes/ whose name BroBot could not have created must
        # refuse the run. a5d66e92 only renamed project to folder (`isSegment(folder.name)` now
        # guards the top level, message 'is not a valid folder name'), so the same `if (false)`
        # plant applies on the renamed line. Killed by
        # `a-stray-beside-the-home-folder-is-named-and-a-folder-brobot-could-not-make-refuses.test.mjs`.
        [
            (CLEAN_BASE, '    if (!isSegment(folder.name)) {\n      refusals.push(', '    if (false) {\n      refusals.push('),
        ],
    ),
    (
        "M30 · 🔴 anything at all in a profile directory is treated as a provider home and emptied",
        [
            (
                BASE,
                "        if (!leaf.isDirectory() || !PROVIDERS.includes(leaf.name)) {\n          refusals.push(",
                "        if (false) {\n          refusals.push(",
            )
        ],
    ),
    (
        "M31 · ⛔ the pasted-image pattern drifts from the product's own, and the reset starts "
        "removing names the sweeper leaves alone — killed by `clean-base-without-running-it.test.mjs`",
        [
            (
                BASE,
                "export const PASTED_IMAGE_NAME = /^pasted-[0-9a-f]{32}\\.png$/",
                "export const PASTED_IMAGE_NAME = /^pasted-[0-9a-f]+\\.png$/",
            )
        ],
    ),
    (
        "M32 · ⛔ the path-segment rule drifts from the app's, so a directory name the app can "
        "never have produced passes as one it did — killed by `clean-base-without-running-it.test.mjs`",
        [
            (
                BASE,
                "export const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/",
                "export const PATH_SEGMENT = /^[A-Za-z0-9.][A-Za-z0-9._-]*$/",
            )
        ],
    ),
    # ── §4 · the rows a review put here, each one a refusal the first draft did not have ───────
    (
        "M33 · ⛔ the anchor keeps the CASE that was typed · `realpathSync` does not canonicalise "
        "case on an insensitive volume, so the liveness check looks for `/users/alex` in a BroBot "
        "started on `/Users/alex` (the forbidden roots compare by identity since W4.124) · killed by "
        "`an-anchor-is-spelled-as-the-disk-spells-it.test.mjs` (named by W4.135)",
        [(SAFE, "    return realpathSync.native(path)", "    return realpathSync(path)")],
    ),
    (
        "M34 · 🔴 a target INSIDE a never-touch root stops being refused · `--dir ~/.claude/projects` "
        "is neither equal to nor containing `~/.claude`",
        [
            (
                SAFE,
                # ⚑ **W4.124 · re-anchored in place, not retired** — the inside check compares folders by identity now (whereItStands), not real-path strings
                "    if (forbidden.inside && where === 'inside') {",
                "    if (false && where === 'inside') {",
            )
        ],
    ),
    (
        "M35 · ⛔ the home directory starts forbidding everything INSIDE it, and the userData lives "
        "there — so every ordinary run refuses",
        [
            (
                SAFE,
                "    { path: home, why: 'your home directory', inside: false },",
                "    { path: home, why: 'your home directory', inside: true },",
            )
        ],
    ),
    (
        "M36 · ⛔ a forbidden root that could not be RESOLVED is not said as such · since W4.124 the "
        "guard still refuses, as a root that could not be compared, and the words a person reads no "
        "longer name the cause · killed by `safe-remove.test.mjs` (relabelled by W4.135)",
        [
            (
                SAFE,
                "    if (forbiddenReal === undefined) {",
                "    if (false) {",
            )
        ],
    ),
    (
        "M37 · 🔴 **the documented invocation refuses forever** · only the caller's own pid is "
        "excluded, and `pnpm` and `sh` above it both name the target in their argv",
        [
            (
                LIVE,
                "  const mine = ownAncestry(rows, self)",
                "  const mine = new Set([self])",
            )
        ],
    ),
    (
        "M38 · ⛔ a path is matched as a substring again, so a live app on `/tmp/ud2` reads as one "
        "on `/tmp/ud`",
        [
            (
                LIVE,
                "    (row) => !mine.has(row.pid) && wanted.some((spelling) => namesPath(row.command, spelling)),",
                "    (row) => !mine.has(row.pid) && wanted.some((spelling) => row.command.includes(spelling)),",
            )
        ],
    ),
    (
        "M39 · 🔴 a `SingletonLock` written by ANOTHER MACHINE is evaluated as if its pid were "
        "local · a network-share userData then reads as free because that pid is not in our table",
        [
            (
                LIVE,
                "  if (match[1] !== host) {",
                "  if (false) {",
            )
        ],
    ),
    (
        "M40 · ⛔ a `SingletonLock` whose target will not parse is reported as absence rather than "
        "as something at a name Chromium owns",
        [
            (
                LIVE,
                "    return { kind: 'unknown', why: `SingletonLock points at ${JSON.stringify(target)}` }",
                "    return { kind: 'absent' }",
            )
        ],
    ),
    (
        "M41 · 🔴 a lock naming a LIVE process stops meaning the app is running — which is the only "
        "instrument that can see the DEFAULT userData at all",
        [
            (
                LIVE,
                "    const holder = table.rows.find((row) => row.pid === lock.pid)",
                "    const holder = undefined",
            )
        ],
    ),
    (
        "M42 · ⛔ a gate answer of a kind nobody handled falls through to the process table instead "
        "of refusing",
        [
            (
                LIVE,
                "  if (gate.kind !== 'nothing-listening') {",
                "  if (gate.kind === 'never') {",
            )
        ],
    ),
    (
        "M43 · 🔴 **the refusal arrives mid-removal again** · actions are checked one at a time as "
        "they are applied, so everything alphabetically before the bad one is already gone",
        [
            (
                BASE,
                "    if (verdict.kind === 'refused') {\n      refusals.push(verdict.why)",
                "    if (false) {\n      refusals.push(verdict.why)",
            )
        ],
    ),
    (
        # ⚑ Landing D-016a (bd70d693) · killer:
        # `a-dropped-exports-folder-is-named-in-the-report-and-counted-in-its-total.test.mjs` (the
        # landing added it; no existing test observed this plant).
        "M44 · 🔴 `exports/` is deleted by `--drop-exports` and named in no section and counted in "
        "no total · EXPORTS leaves the report order",
                # ⚠️ **Re-anchored by `383`.** `380` inserted `DOCUMENTS` between `WORKSPACE` and
                # `EXPORTS`, so this row went dark on its branch. The rule is unchanged: `EXPORTS`
                # leaves the report order while still being deleted.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — `--drop-exports` and
        # `exports/` still exist, and `EXPORTS` is still in `REPORT_ORDER`; only the neighbour
        # changed, because D-016 removed `SEED` from the order. The plant is the same, dropping
        # `EXPORTS` from the report order, with the anchor re-cut to today's `LEDGER, WORKSPACE,
        # DOCUMENTS, EXPORTS, HOMES` run.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: `--drop-exports` and `exports/` still exist and `EXPORTS` is still in
        # `REPORT_ORDER` (commit 5e931be8 kept it). D-016 turned the neighbouring `DOCUMENTS` group
        # into `RESOURCES` ("documents end to end (replaced by resources)"), so the D-016a anchor
        # `LEDGER, WORKSPACE, DOCUMENTS, EXPORTS, HOMES` no longer occurs. The plant is the same,
        # dropping `EXPORTS` from the order, re-cut on today's `RESOURCES, EXPORTS` run. Killed by
        # `a-dropped-exports-folder-is-named-in-the-report-and-counted-in-its-total.test.mjs`.
        [
            (CLEAN_BASE, '  LEDGER,\n  WORKSPACE,\n  RESOURCES,\n  EXPORTS,\n  HOMES,', '  LEDGER,\n  WORKSPACE,\n  RESOURCES,\n  HOMES,'),
        ],
    ),
    (
        "M45 · ⛔ a `.DS_Store` beside the projects refuses the whole reset, permanently, on every "
        "machine where a person has opened that folder in Finder",
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired — The rule
        # survives: a `.DS_Store` beside the folders under provider-homes/ must be removed and
        # named, not refuse the run. The old anchor `if (!project.isDirectory())` was the .DS_Store
        # exception at 351, but b503be16 (352) put `if (project.isFile())` ahead of it. A plain
        # rename to `!folder.isDirectory()` would therefore plant a different defect (a symlink or
        # socket stepped over), so the plant now goes on the `isFile()` exception, which plants the
        # label exactly. Killed by
        # `a-stray-beside-the-home-folder-is-named-and-a-folder-brobot-could-not-make-refuses.test.mjs`.
        [
            (CLEAN_BASE, '    if (folder.isFile()) {', '    if (false) {'),
        ],
    ),
    (
        "M46 · 🔴 **the report is truncated by its own exit** · a piped stdout is asynchronous and "
        "`process.exit` does not drain it — measured at 937 lines of 20 000 — killed by `clean-base-without-running-it.test.mjs`",
        [
            (
                CLI,
                "    process.exitCode = 1\n    return\n  }\n\n  const done = applyChecked",
                "    process.exit(1)\n  }\n\n  const done = applyChecked",
            )
        ],
    ),
    (
        "M47 · ⛔ a second `--dir` silently wins, so a person watches the wrong directory empty",
        [
            (
                CLI,
                "      if (sawDir) return { error: '--dir was given twice, and it names what gets deleted' }",
                "      if (false) return { error: '--dir was given twice, and it names what gets deleted' }",
            )
        ],
    ),
    (
        "M48 · ⛔ an unreadable path between the check and the removal is reported as removed",
        [
            (
                SAFE,
                "    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return 'gone'\n    return 'unreadable'",
                "    return 'gone'",
            )
        ],
    ),
    (
        "M49 · ⛔ the anchor stops being re-read, so every removal is proved against a directory "
        "that may have been replaced since",
        [
            (
                SAFE,
                "  if (anchorNow === null || anchorNow.dev !== anchor.dev || anchorNow.ino !== anchor.ino) {",
                "  if (false) {",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `scripts/seed-demo.mjs` and its killer
        # `pnpm-seed-cannot-be-run-by-accident.test.mjs` are both deleted: D-016a removes the demo
        # seed ('proposals end to end (cards, approving, demo seed, renderer fixtures)') and the
        # `seed` script left package.json. Its anchor is left stale, so the census records it
        # retired.
        "M50 · ⛔ `pnpm seed --dir --clear` both escapes the unknown-option guard and flips the "
        "mode · `--clear` is read from the value position again — killed by `pnpm-seed-cannot-be-run-by-accident.test.mjs`",
        [
            (
                SEED,
                "const clear = args.some((arg, index) => arg === '--clear' && index !== valueIndex)",
                "const clear = args.includes('--clear')",
            )
        ],
    ),
    (
        "M51 · ⛔ `pastedImagesRoot` is derived from the spelling the person typed rather than the "
        "one the app resolves, so a symlinked userData skips the whole clipboard sweep",
        [
            (
                CLI,
                "  const pastedRoot = trustedAnchor(pastedImagesRoot(anchor.real), { repoRoot: REPO_ROOT })",
                "  const pastedRoot = trustedAnchor(pastedImagesRoot(anchor.lexical), { repoRoot: REPO_ROOT })",
            )
        ],
    ),
]
