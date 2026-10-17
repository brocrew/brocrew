"""522 · a stamp that skips — each row is THE DEFECT, put back (131).

⛔ **What these rows protect is one inequality**, and the failure it prevents is SILENT. `drizzle-orm`
takes the newest row of `__drizzle_migrations` (`ORDER BY created_at DESC LIMIT 1`) and runs a
migration only while `Number(lastDbMigration[2]) < migration.folderMillis`, where `folderMillis` **is**
the journal's `when`. ⚑ **`drizzle-kit` stamps that from the wall clock and this repository's stamps
have been hand-spaced 86,400,000 ms apart since `0019`**, so the generator has been writing a number
BELOW the last applied one every time.

🔴 **Measured on this tree, live, while `522` was being built.** A throwaway table was added to
`schema.ts`, `pnpm run db:generate` was run, and the numbers were read off the result before every
byte was restored from held SHA-256'd copies:

```
  drizzle wrote   1789668731633   for 0033
  0032 holds      1789928391316
  → 72.13 hours BELOW its predecessor — skipped on every already-migrated database
  wrapper wrote   1789928391317   ( = 0032 + 1 )
```

⚠️ **`379`, `380`, `383`, `509`, `511` and `516` each hit this and each corrected its own file by
hand.** `516` F3's words: *"a `db:generate` wrapper that hand-sets the stamp is a two-line script
nobody has written."*

## 🔴 The five properties these rows guard

 1. **The stamp is strictly ABOVE its predecessor, and a TIE is not above** — `M1`, `M4`. ⛔ `<` is
    strict, so a migration sharing a stamp with the newest applied row is skipped exactly like one
    below it. ⚑ This is where the two readings of the rule DIVERGE, and every row here is an
    inequality rather than a spacing (`a-bound-written-as-the-constant-cannot-pin-it`).
 2. **The wall clock WINS once it is ahead, so the stamps converge on real time** — `M2`. ⚠️ Under
    `previous + spacing` the fiction grows by that spacing per migration for ever; this repository
    reached **72.30 hours** ahead of the clock that way.
 3. **A stamp that has SHIPPED is immutable** — `M5`, `M6`, `M7`. ⛔ Rewriting an older entry is
    wrong in both directions: lowered it is skipped on every database that stopped there, and raised
    above a `created_at` some database already recorded, **that migration re-applies** — a second
    `CREATE TABLE` on a table that exists.
 4. **A run that generated nothing writes nothing, and the artefact is read back** — `M8`, `M9`,
    `M10`.
 5. **There is exactly ONE door into the generator** — `M11`, `M12`. ⚑ `516` F3 asked for the thing
    that stops a person having to notice; a second script still calling `drizzle-kit generate`
    directly is precisely the door they would find.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| `M1`, `M2` | ⚑ **`scripts/test/db-generate.test.mjs` §1** — the tie, and the head BELOW the clock |
| `M4`, `M5`, `M6`, `M7`, `M8` | ⚑ **§2** — what it refuses, each paired one fact over allowed |
| `M9`, `M10` | ⚑ **§3** — the bytes on disk, and the read-back |
| `M11`, `M12` | ⚑ **§4** — the manifest census, over every `package.json` in the repository |

⛔ **The table was NOT run.** Every row below was applied ALONE, watched go red against the gate
named above, and restored from held bytes with a SHA-256 re-check — `verify-each-mutation-row`,
which is not the same claim as a table run.

## ⚠️ What is deliberately NOT here

 * **A row on `now > previous` → `now >= previous`.** ⛔ It produces the same value as `M1` for the
   one input that distinguishes it (`now === previous` ties, and a tie is skipped), so it would be
   a second spelling of `M1` killed by the same assertion rather than a property of its own.
 * **A row on `report()`'s hours arithmetic.** ⚑ It is a sentence a person reads and nothing turns
   on it; the assertions on it are `toContain`, so a row there would measure the prose.
 * **A row that removes `refuseIfSkippable`'s CALL from `generateWithStamp`.** ⚠️ Nothing a correct
   `planStamp` can produce reaches that throw, so removing the call changes no outcome any test can
   see — `a-true-mutation-measures-nothing`. ⛔ `M10` mutates the GUARD instead, where the rule is a
   proposition; the call site is named here rather than written as a phantom survivor
   (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`).
 * **Anything in `apps/desktop/test/a-stamp-that-skips.test.ts`.** ⛔ That file's subject is drizzle,
   not this repository's code: its §2 proves the outcome by applying a sabotaged journal to a real
   database, and there is no product line to put a defect back into. ⚑ A mutation on a census is
   invisible to that census.
 * **A row on `clean-base.mjs`'s `MIGRATIONS`.** ⚑ `383 M5` owns it and `522` deliberately did not
   move it — see `scripts/db-generate.mjs`'s Q5.
"""

GEN = "scripts/db-generate.mjs"
ROOT_MANIFEST = "package.json"
DESKTOP_MANIFEST = "apps/desktop/package.json"

MUTATIONS = [
    # ── the inequality itself ─────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 the repaired stamp TIES with its predecessor instead of clearing it · the applier's "
        "test is `Number(lastDbMigration[2]) < migration.folderMillis` and `<` is strict, so a "
        "migration sharing a stamp with the newest applied row is skipped exactly like one below "
        "it — and the journal still reads as sorted to any check written with `<=`",
        [
            (
                GEN,
                "  return now > previous ? now : previous + 1",
                "  return now > previous ? now : previous",
            )
        ],
    ),
    (
        "M2 · ⚠️ the wall clock can never win · every stamp is the last one plus a step, so the "
        "fiction grows by that step per migration FOR EVER and `new Date(when)` never means "
        "anything again — which is exactly how this repository got 72.30 hours ahead of real time",
        [
            (
                GEN,
                "  if (previous === undefined) return now\n"
                "  return now > previous ? now : previous + 1",
                "  if (previous === undefined) return now\n  return previous + 1",
            )
        ],
    ),
    (
        "M4 · ⛔ a TIE in the history reads as ordered · two entries sharing a stamp mean the second "
        "never ran on any database that reached the first, and an `outOfOrder` written with `<` "
        "calls that journal healthy — the refusal disarms itself and the read-back stops reading",
        [
            (
                GEN,
                "entry.when <= entries[index - 1].when",
                "entry.when < entries[index - 1].when",
            )
        ],
    ),
    # ── a stamp that has shipped is immutable ─────────────────────────────────────────────────
    (
        "M5 · 🔴 a journal that was ALREADY broken is repaired rather than refused · the wrapper "
        "stamps on top of a history nobody has reconciled, so the one entry it fixes hides the two "
        "it did not — and the person never learns which installs hold what",
        [(GEN, "  const already = outOfOrder(before)", "  const already = []")],
    ),
    (
        "M6 · ⛔ the generator is allowed to have rewritten history · one changed entry slips "
        "through and is stamped over, which is the direction that RE-APPLIES a migration on every "
        "database whose `created_at` sits below the new number",
        [(GEN, "  if (moved.length > 0) {", "  if (moved.length > 1) {")],
    ),
    (
        "M7 · ⛔ more than one appended entry is stamped as if it were one · only the last of them "
        "is corrected and every other new file keeps the wall-clock number, so the run reports a "
        "stamp and ships the defect it was written to stop",
        [
            (
                GEN,
                "  if (after.length !== before.length + 1) {",
                "  if (after.length < before.length) {",
            )
        ],
    ),
    # ── the run that has nothing to do, and the artefact it leaves ────────────────────────────
    (
        "M8 · ⛔ a run that generated NOTHING is stamped anyway · drizzle prints *No schema changes* "
        "and writes no entry, and the wrapper rewrites the last SHIPPED stamp — the one edit §2 is "
        "entirely about",
        [
            (
                GEN,
                "  if (after.length === before.length) return { outcome: 'nothing-generated' }\n",
                "",
            )
        ],
    ),
    (
        "M9 · ⚠️ the committed journal loses its trailing newline · `meta/` is in `.prettierignore` "
        "so nothing in this repository would ever put it back, and every `db:generate` leaves a "
        "one-byte diff on a file nobody edited",
        [(GEN, "(was.raw.endsWith('\\n') ? '\\n' : '')", "''")],
    ),
    (
        "M10 · 🔴 the read-back never refuses · the last thing the command does is check the "
        "ARTEFACT rather than the arithmetic, and without it an edit that got the direction wrong "
        "prints a cheerful sentence over a journal whose newest migration will never run",
        [(GEN, "  if (left.length === 0) return", "  if (left.length >= 0) return")],
    ),
    # ── one door into the generator ───────────────────────────────────────────────────────────
    (
        "M11 · ⛔ `pnpm run db:generate` goes straight back to the raw generator · the supported "
        "command is the unstamped one again, and `516` F3's *thing that stops a person having to "
        "notice* is a script nobody runs",
        [
            (
                ROOT_MANIFEST,
                '    "db:generate": "node scripts/db-generate.mjs",',
                '    "db:generate": "pnpm --filter @brobot2/desktop db:generate:unstamped",',
            )
        ],
    ),
    (
        "M12 · ⚠️ the unstamped script takes the supported NAME back · a person who types "
        "`pnpm --filter @brobot2/desktop db:generate` gets a migration instead of pnpm's *no such "
        "script*, and the unstamped path is the one that looks official",
        [
            (
                DESKTOP_MANIFEST,
                '    "db:generate:unstamped": "drizzle-kit generate",',
                '    "db:generate": "drizzle-kit generate",',
            )
        ],
    ),
]
