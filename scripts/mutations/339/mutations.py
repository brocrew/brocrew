"""339 · A project that is more than a slug — every row puts back a fact the app would otherwise invent.

⛔ **What this dispatch adds:** two columns on `project` (`description`, `cwd`), the door that reads
and writes them, and the sheet a person edits them in. ⚑ **The `cwd` is the one with a rule** —
HO-005 criterion 11: *"resolved and verified in OUR code, before create… returns our own error
naming the directory"* — and `303` C is why: with the directory gone, Codex reported `ENOENT` about
the **executable** and Claude returned a healthy-looking resumed handle and then fatalled about a
**libc mismatch**.

## 🔴 The half that was missing, measured before a line was written

`checkSessionCwd` already resolved, refused and named the directory — so the brief's *"a function
this dispatch owns and exports"* was already there, and 169 §1 forbade writing a second one. What it
did not do was ask whether a child could START there. Measured on macOS 25.3, uid 501:

| mode | `statSync().isDirectory()` | `X_OK` | `R_OK` | `spawn({ cwd })` |
|------|---------------------------|--------|--------|------------------|
| `000` | true | EACCES | EACCES | **EACCES** |
| `111` | true | ok | EACCES | **exit 0** |
| `444` | true | EACCES | ok | **EACCES** |

⚠️ **`M2` is the `111` row as a mutation**: ask for `R_OK` and the check refuses a directory that
works. ⛔ **`M1` is the whole clause removed**, which is the state this dispatch found.

## ⚠️ Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M6`, `M9`, `M11`-`M15` | `test/a-project-that-is-more-than-a-slug.test.ts` |
| `M7`, `M8` | that file's §"folds a blank field to null on the way in, and does NOT fold one on the way out" |
| `M10` | ⚑ the migration itself — `a fresh install lands in exactly the same shape as an upgraded one` |
| `M16` | ⛔ `test/profile-collision.test.ts`, which builds a store over a schema staged BEFORE `0015` |
| `M17` | `test/shutdown-door.test.ts` |
| `M18`, `M19` | `test/wire-bounds.test.ts` — the control has to carry the schema's own bound (221 §3) |
| `M20`-`M24` | `test/dom/project-sheet.dom.test.ts`, in real Chromium |
| `M25`, `M26` | `test/project-store.test.ts` |

## ⛔ What this table deliberately does NOT contain

**No row that un-pins `DEFAULT_PROJECT_ID`.** §3 of the brief forbade it and the reason stands: a
second reachable project changes where every provider home lives, which is a migration of people's
data rather than a column. There is nothing here to make red.

**No row about the refusal saying `cwd` rather than "working folder".** It is developer vocabulary
on a surface a person reads, and it is `checkSessionCwd`'s own sentence — shared verbatim with the
launcher's folder field. Rewording it HERE would create exactly the second wording 076 §3 exists to
prevent, so it is recorded in the response doc as a finding for a later dispatch rather than fixed
in one of two places.

**No row that removes the `X_OK` probe's `try`/`catch`.** `accessSync` throws by design and the
catch is the only shape that answers; a row removing it makes the function throw instead of refuse,
which is a different function rather than a weaker one — and `resolveSessionCwd`'s `throw` would
swallow the difference.

**No row on `scripts/project-sheet-probe.mjs`.** It is not in `ci` (see its own header), so a row
there would be a row no gate could see.

## 🔴 Two rows the per-row check RETIRED, because both were phantoms

⚠️ **A mutation whose behaviour is identical to the original records as a survivor**, and both of
these did — each looked like it was removing a guard and neither one changed anything observable.
They are named here rather than left in the table, because a row that cannot go red is a claim that
something is load-bearing when it is not.

**`M6` (was: the host stops folding a blank folder before asking about it).** `RuntimeHost.saveProject`
reads `edit.cwd?.trim() ?? ''` so a blank never reaches `checkCwd`. Take the `.trim()` away and a
blank *does* reach it — and `checkCwd` short-circuits blank itself, answering `ok` with an empty
path, which the STORE then folds to null through `blankToNull`. Two folds agree, and only the store's
is load-bearing (`M7` kills that one). ⚑ The host's line is kept because it states the intent where a
reader meets it; the row is not, because it asserts a strength the line does not have.

**`M12` (was: the store's *"no such project"* guard).** `saveProject` opened with
`if (readProject(slug) === null) return null`. An `UPDATE … WHERE slug = ?` against a slug nothing
matches changes nothing and raises nothing, and the read at the end then answers null on its own — so
the guard could not be made red in any form. ⛔ **The guard was DELETED rather than the row rewritten
around it**: a line no mutation can kill is a line that is not carrying the rule it looks like it is
carrying. `session-store.ts` says so where the guard used to be.
"""

SCRATCH = "apps/desktop/src/main/runtime/scratch-cwd.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
MIGRATION = "apps/desktop/src/main/db/migrations/0016_majestic_ken_ellis.sql"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
SHEET = "apps/desktop/src/renderer/src/components/ProjectSheet.vue"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
PROJECT_STORE = "apps/desktop/src/renderer/src/lib/project-store.ts"
SESSIONLIBRARY = "apps/desktop/src/renderer/src/components/SessionLibrary.vue"

MUTATIONS = [
    (
        "M1 · 🔴 the reachability clause goes and `checkSessionCwd` is back to what 339 found · a "
        "directory that exists, is a directory, and no process can enter answers `ok` — and the "
        "failure then arrives from the provider, about the executable",
        [
            (
                SCRATCH,
                "    accessSync(cwd, constants.X_OK)",
                "    void constants",
            )
        ],
    ),
    (
        "M2 · ⛔ it asks for READ instead of SEARCH · the `111` row of the table above: a directory "
        "a session can enter but not list WORKS, so demanding readability refuses a folder that runs",
        [
            (
                SCRATCH,
                "    accessSync(cwd, constants.X_OK)",
                "    accessSync(cwd, constants.R_OK)",
            )
        ],
    ),
    (
        "M3 · ⛔ the refusal stops naming the directory · criterion 11 is not "
        "*\"our own error\"*, it is our own error **naming the directory** — a sentence a user "
        "cannot act on is the state `303` C measured, in our words instead of the provider's",
        [
            (
                SCRATCH,
                "      reason: `cwd cannot be opened: ${cwd} — it exists, but BroCrew is not allowed into it, so nothing could run there`,",
                "      reason: `cwd cannot be opened — it exists, but BroCrew is not allowed into it, so nothing could run there`,",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `throw new Error(verdict.reason)`
        # line sat in `RuntimeHost.saveProject`, which bd70d693 removed (its diff drops `const
        # verdict = this.checkCwd(typed)` with the project door). The surviving cwd rule
        # (`checkSessionCwd`, `checkCwd` for launches and spawns) is covered by the same table's
        # M1-M3 and the spawn table's criterion-11 row. Its anchor is left stale, so the census
        # records it retired.
        "M4 · 🔴 the host writes the folder without asking · the verification is what criterion 11 "
        "IS, and a save that trusts its input puts an unreachable directory in the column for every "
        "later reader to believe",
        [
            (
                HOST,
                "      if (!verdict.ok) throw new Error(verdict.reason)",
                "      if (!verdict.ok) cwd = null",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `cwd = verdict.path` was the project
        # save storing the resolved spelling; that method is deleted with the project cwd column's
        # writer (bd70d693), so there is no store-the-typed-spelling defect to plant. `checkCwd`
        # remains, but nothing writes its answer into a column now. Its anchor is left stale, so the
        # census records it retired.
        "M5 · ⚑ the typed spelling is stored instead of the resolved one · `checkCwd` answers the "
        "path `resolve(expandHome(…))` produced, and storing the raw field records `~/x` or "
        "`a/../a` as though the app had agreed to it",
        [(HOST, "      cwd = verdict.path", "      cwd = typed")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `cwdVerdict.value.path ===
        # cwd.value` staleness guard was in the deleted `ProjectSheet.vue` and is checked by the
        # deleted `project-sheet.dom.test.ts`. The sheet was removed on purpose by D-016. Its anchor
        # is left stale, so the census records it retired.
        "M6 · 🔴 the sheet keeps a refusal that is about a path the box has moved on from · a verdict "
        "carries the path it is an answer about (203); drop that and a sentence about `/work/gone` "
        "stays pinned under a folder the person has already replaced — and `blocked` keeps Save dead "
        "over a folder nobody refused",
        [
            (
                SHEET,
                "  cwdVerdict.value !== null && cwdVerdict.value.path === cwd.value",
                "  cwdVerdict.value !== null",
            )
        ],
    ),
    (
        "M7 · 🔴 a cleared field is recorded as an empty string · null is *nobody has said* and `''` "
        "is *somebody said there is nothing to say*; manufacturing the second out of a person "
        "blanking a box is 086's fabricated value in its smallest form",
        [
            (
                STORE,
                "    return trimmed === '' ? null : trimmed",
                "    return trimmed",
            )
        ],
    ),
    (
        "M8 · 🔴 the READER folds an empty string away · the other direction, and the one a reader "
        "reaches for: `?? null` is not `|| null`, and a column that permits `''` has to be read by "
        "something that can tell it from the absence",
        [
            (
                STORE,
                "      description: row.description,",
                "      description: row.description || null,",
            )
        ],
    ),
    (
        "M9 · ⛔ the write is keyed by the derived id instead of the slug · every caller holds a "
        "slug, the id is `proj:<slug>`, and a write that matches no row reports no error at all — "
        "the save returns the row it read a moment earlier, unchanged and looking saved",
        [
            (
                STORE,
                "      write: db.prepare(\n        `UPDATE project SET display_name = ?, description = ?, cwd = ? WHERE slug = ?`,\n      ),",
                "      write: db.prepare(\n        `UPDATE project SET display_name = ?, description = ?, cwd = ? WHERE id = ?`,\n      ),",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is `ALTER TABLE
        # project ADD description` in 0016_majestic_ken_ellis.sql, and neither that migration nor
        # the project table exists. Commit 5e931be8: "The database is ONE migration, 0000_the_tree,
        # on a fresh file only: the project, proposal, binding, home and document tables go". The
        # row's killer ("a fresh install lands in exactly the same shape as an upgraded one") has no
        # upgrade left to compare. Its anchor is left stale, so the census records it retired.
        "M10 · 🔴 the migration gives `description` a NOT NULL default · the decision the migration's "
        "own comment argues against, made: every existing row and every fresh install then holds "
        "`''`, and *nobody has described this project* stops being expressible at all",
        [
            (
                MIGRATION,
                "ALTER TABLE `project` ADD `description` text;",
                "ALTER TABLE `project` ADD `description` text NOT NULL DEFAULT '';",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the `cwd`
        # backfill on the project table in 0016_majestic_ken_ellis.sql, and both are removed. Commit
        # 5e931be8: "The database is ONE migration, 0000_the_tree, on a fresh file only: the
        # project, proposal, binding, home and document tables go"; "Runs on a fresh database only."
        # No existing project row can be backfilled. Its anchor is left stale, so the census records
        # it retired.
        "M11 · ⚠️ the migration backfills `cwd` with a path · the tempting line, because a session "
        "with no requested folder already runs in the workspace — and it records a choice nobody "
        "made, indistinguishable ever after from a person who picked it",
        [
            (
                MIGRATION,
                "ALTER TABLE `project` ADD `cwd` text;",
                "ALTER TABLE `project` ADD `cwd` text;--> statement-breakpoint\nUPDATE `project` SET `cwd` = '/tmp';",
            )
        ],
    ),
    (
        "M12 · ⛔ the read ignores which project was asked for · one project is reachable today, so a "
        "host that answered the pinned row for every slug would look correct for the whole of this "
        "slice and be the reason the second one arrived already broken",
        [
            (
                HOST,
                "    return this.deps.store.project(projectSlug)",
                "    return this.deps.store.project('default')",
            )
        ],
    ),
    (
        "M13 · ⚠️ the save answers what it SENT rather than what landed · the second read is the "
        "only value that has been through the folding and the column, and a composed answer is a "
        "surface adopting a row the database never agreed to",
        [
            (
                HOST,
                "    return this.deps.store.saveProject(projectSlug, { ...edit, cwd })",
                "    this.deps.store.saveProject(projectSlug, { ...edit, cwd })\n    return { ...this.deps.store.project(projectSlug)!, cwd: edit.cwd }",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `projectSlug` schema, the
        # `createProject`/`saveProject` commands and the `project` reads were deleted from ipc.ts by
        # bd70d693 ("create_project and list_projects, the project rooms... project folders and
        # their rails ... are removed"). A project slug no longer names a directory under
        # `provider-homes/` ("every provider home lives under `default`"), so the label's defect has
        # no line to live on. Its anchor is left stale, so the census records it retired.
        "M14 · ⛔ the project slug stops being a path segment · it names a DIRECTORY under "
        "`provider-homes/`, so a slug that can spell `..` or a separator is a path — and this "
        "command would be the way to send one",
        [
            (
                IPC,
                "const projectSlug = z.string().refine(isPathSegment, `must be ${PATH_SEGMENT_RULE}`)",
                "const projectSlug = z.string()",
            )
        ],
    ),
    (
        "M15 · 🔴 an omitted field is read as a clear · `.optional()` and `.nullable()` are the same "
        "value to a `Partial` and are not the same intent — HO-005 criterion 10: a payload that "
        "does not match must fail with a named error rather than being quietly reduced",
        [
            (
                IPC,
                "    description: z.string().max(PROJECT_DESCRIPTION_CHARS).nullable(),",
                "    description: z.string().max(PROJECT_DESCRIPTION_CHARS).nullish(),",
            )
        ],
    ),
    (
        "M16 · ⛔ the project statements are prepared eagerly like every other one · which is what "
        "339 found already broken: `db.prepare` compiles at construction, so a store built over a "
        "schema staged back — `profile-collision.test.ts` writes a `Developer` row before `0015`'s "
        "index exists — cannot be built at all once a migration adds a column this file reads",
        [
            (
                STORE,
                "  let projectStatements: { select: AppStatement; write: AppStatement } | null = null",
                "  let projectStatements: { select: AppStatement; write: AppStatement } | null = {\n    select: db.prepare(\n      `SELECT id, slug, display_name, description, cwd, created_at FROM project WHERE slug = ?`,\n    ),\n    write: db.prepare(`UPDATE project SET display_name = ?, description = ?, cwd = ? WHERE slug = ?`),\n  }",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `saveProject` is no longer a command:
        # the whole handler, its schema and its `saveProject: 'refused'` ledger line were removed
        # with the project door (bd70d693 diff of ipc.ts). The quit-ruling mechanism itself survives
        # for the other commands, but this row's subject, the project write, was removed on purpose.
        # Its anchor is left stale, so the census records it retired.
        "M17 · ⚠️ the write is accepted during a quit · both statements are the ledger's, and a "
        "person changing where this project's work happens in the moment the app stops being able "
        "to act on it is not a gesture to take",
        [(IPC, "  saveProject: 'refused',", "  saveProject: 'answered',")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `ProjectSheet.vue` was deleted (631
        # lines) and `PROJECT_DESCRIPTION_CHARS` has no reader left in src; the card says "the
        # project rooms, board, sheet and picker" go. The description field the row plants a literal
        # into no longer exists anywhere. Its anchor is left stale, so the census records it
        # retired.
        "M18 · ⛔ the description field spells a number of its own instead of the wire's constant · "
        "221 §3's rule — a bound the control enforces is a refusal that never has to be worded, and "
        "a field that can out-type its schema puts raw zod on a screen",
        [
            (
                SHEET,
                '          :maxlength="PROJECT_DESCRIPTION_CHARS"',
                '          maxlength="9000"',
            )
        ],
    ),
    (
        "M19 · ⛔ the folder field spells its own ceiling · the same defect one field over, and the "
        "worse half: `MAX_PATH_CHARS` is the constant the command holds, and a literal beside it is "
        "the two-places-one-rule shape 169 §1 names",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The refutation holds. ProjectSheet is gone, but the restore field
        # (`library-bundle-path`) is the remaining person-typed path control and carries the same
        # `:maxlength="MAX_PATH_CHARS"` at SessionLibrary.vue:1068; the anchor is byte-identical and
        # counts once. Expect RED in `221 §3 · the CONTROL holds the bound the wire holds` > "the
        # library's restore field carries `MAX_PATH_CHARS`" (wire-bounds.test.ts:327). The
        # `MAX_PATH_CHARS` import is left unused, which is a lint matter and not a runtime or
        # ReferenceError one.
        [
            (SESSIONLIBRARY, '            :maxlength="MAX_PATH_CHARS"', '            maxlength="8192"'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'Stored as an empty value'
        # sentence lived only in the deleted `ProjectSheet.vue` (grep of src finds it nowhere), and
        # its DOM killer `project-sheet.dom.test.ts` was deleted with it. The project record sheet
        # is gone by the card's own words. Its anchor is left stale, so the census records it
        # retired.
        "M20 · 🔴 an absent value and an empty one draw the same thing · both are an empty box, so "
        "the SENTENCE beside the label is the only thing that tells them apart (086) — and this is "
        "the row the DOM project exists for, because SSR has no painted text to compare",
        [
            (
                SHEET,
                "  if (value === '') return 'Stored as an empty value'",
                "  if (value === '') return 'Not set'",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `blankToNull` existed only in
        # `ProjectSheet.vue` (deleted); with no project description or folder field there is no
        # field a person can clear. The store-side fold (M7/M8) is a separate row in the same table
        # and was not asked here. Its anchor is left stale, so the census records it retired.
        "M21 · ⛔ the sheet sends `''` for a field the person cleared · the near half of M7, where "
        "the intent is visible: blanking a box is somebody saying there is nothing to say",
        [
            (
                SHEET,
                "  const blankToNull = (value: string): string | null => (value.trim() === '' ? null : value.trim())",
                "  const blankToNull = (value: string): string | null => value.trim()",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `blocked` and its Save button lived in
        # the deleted `ProjectSheet.vue`; the launcher's own 195 H4 rule the label cites is guarded
        # by its own rows in other tables. The project sheet was removed on purpose (bd70d693:
        # "project rooms, board, sheet and picker"). Its anchor is left stale, so the census records
        # it retired.
        "M22 · 🔴 Save is lit over a folder already refused · the launcher's own 195 H4 defect, on "
        "the second surface that types a path: Send was lit over `/Users/me/typo` and the launch it "
        "started provisioned a credential-bearing home before it refused",
        [
            (
                SHEET,
                "const blocked = computed(() => saving.value || cwdRefusal.value !== null)",
                "const blocked = computed(() => saving.value)",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The save-then-close behaviour was in
        # `ProjectSheet.vue`, deleted by bd70d693 together with its DOM test
        # `project-sheet.dom.test.ts`. There is no project sheet left to close over a refusal. Its
        # anchor is left stale, so the census records it retired.
        "M23 · ⛔ the sheet closes over a refusal · and takes the sentence with it — the sentence "
        "being the only place the directory is named",
        [
            (
                SHEET,
                "  if (saveRefusal.value === null) emit('close')",
                "  emit('close')",
            )
        ],
    ),
    (
        "M24 · ⚠️ the rail draws its derived line over an empty description · `??` and `||` are the "
        "same until a value is falsy, and an empty description is a description",
        [
            (
                RAIL,
                "              props.project.description ?? 'No description yet'",
                "              props.project.description || 'No description yet'",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The sheet drawing the window's one
        # project row was deleted with `ProjectSheet.vue` and `project-store.ts`;
        # `DEFAULT_PROJECT_ID` is no longer reachable from any surface. There is no store row or
        # slug prop left to compare. Its anchor is left stale, so the census records it retired.
        "M27 · ⛔ the sheet draws whatever row the window's one store happens to hold · the store "
        "holds ONE row and this sheet is about ONE slug, and they agree today only because "
        "`DEFAULT_PROJECT_ID` is the only project any caller can reach — so without the comparison "
        "the boxes would fill from another project and a save would write its folder onto this row",
        [
            (
                SHEET,
                "  store.project.value?.slug === props.projectSlug ? store.project.value : null,",
                "  store.project.value,",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):**
        # `apps/desktop/src/renderer/src/lib/project-store.ts` (236 lines) and its test
        # `project-store.test.ts` (278 lines) were deleted by bd70d693 as part of "projects go".
        # There is no project held on screen for a failed load to blank. Its anchor is left stale,
        # so the census records it retired.
        "M25 · 🔴 a failed load blanks the project already on screen · a refresh that could not be "
        "made has not learned the project is gone, and clearing it is this surface claiming a fact "
        "it does not have",
        [
            (
                PROJECT_STORE,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 427 — `427` §4 routed every renderer
            # surface's caught rejection through `readableError`, which moved this
            # line without changing the rule the row is about.
            "        loadError.value = readableError(error)",
                "        project.value = null\n        loadError.value = readableError(error)",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `loaded`-in-`finally` flag
        # belonged to the deleted `project-store.ts`, whose killer `project-store.test.ts` is also
        # deleted. The store, the `project === null` ambiguity and the surfaces waiting on `loaded`
        # are all gone with the project rooms. Its anchor is left stale, so the census records it
        # retired.
        "M26 · ⚠️ a load that failed never counts as ASKED · the flag moves into the success path, "
        "so a surface waiting on `loaded` waits for ever on the one path where something has gone "
        "wrong — and `project === null` goes back to meaning three things at once",
        [
            (
                PROJECT_STORE,
                "      } finally {\n        // ⚠️ In `finally`, so a failed load still counts as ASKED. Otherwise a surface waiting on\n        // `loaded` waits for ever on the one path where something has gone wrong.\n        loaded.value = true\n      }",
                "      }",
            )
        ],
    ),
]
