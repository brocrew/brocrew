"""521 · the writer on the columns 517 only read — each row is THE DEFECT, put back (131).

## 🔴 The field report

`517` closed the reader and reported the writer. The PO boarded it without a ruling, because
`HO-043` §1.2 transfers whole:

 > ⛔ **"`517` bounded the READER; the WRITER on the same columns is unbounded."**
 > ⚠️ **"`document_ingest.canonical_path`, `staged_path` and `raw_path` carry exactly the exposure
 > `document.canonical_path` had."** ⛔ **"`publishCanonicalBytes` joins all three to the root and
 > `mkdirSync(dirname(path), { recursive: true })` before writing; `reconcileDocuments` reads two
 > of them from rows written on a PREVIOUS launch."**

⚑ **And the two measurements this table rests on, taken at `521` on this machine:**

 1. `mkdirSync(…, { recursive: true })` through a component that is a symlink to an existing
    directory outside the tree **BUILDS THERE**.
 2. `O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW` at a symlinked LEAF answers `EEXIST` and writes
    nothing. ⛔ **So the hole was the directories, never the bytes**, and the guard belongs in
    front of the `mkdir` rather than in front of the write.

## ⚠️ What is CORRECT here and therefore carries no row

 - ⛔ **`placeResource`'s two arms.** They are `380 M13`/`M14`/`M15`, and `placeAttempt` reuses
   the arithmetic (`within`) rather than restating it.
 - ⛔ **The hash re-check at every `readOwnFile` caller.** `380 M21`/`M22`/`M24` and `M30` own
   those four comparisons, and this dispatch moved none of them.
 - ⛔ **The reader's placement.** `510 M4` and `517 M1`–`M7` live inside `documentBytes`, whose
   CODE `521` did not touch — five paragraphs of its docblock moved, and no row anchors a
   comment. ⚑ Verified: no row of any table went stale on this branch.
 - ⚠️ **`link` and not `rename`, and `EEXIST`-whose-bytes-are-ours as a success.** `380`'s
   protocol, unchanged; `521` only put a guard in front of it.
 - ⚑ **`document-bytes-missing`'s and `document-bytes-changed`'s sentences.** The words a person
   and a model read for a READ are `517`'s and did not move.
 - ⛔ **`readOwnFile` and `readResource`.** Neither was touched. The short-read finding is
   reported at `521` and repaired nowhere, so a row here would mutate something nothing asserts.

## ⛔ The nine properties these rows guard

 1. **The writer is bounded at all**, at both acts — `M1` (publication), `M8` (reconciliation).
 2. **All three columns are asked about, not just the one a given loop walks** — `M2`.
 3. **Two arms, because the reader has two** — `M3` (lexical), `M4` (real).
 4. **Both sides are spelled by one authority** — `M5`.
 5. **A name that exists and does not resolve is refused, not walked past** — `M6`, `M7`, and
    `M15` for the tree itself, `M16` for the one clause this copy diverges from `183` on.
 6. **A failure to READ is not an absence** — `M9`, `M10`, `M11`.
 7. **A person is told which column, what it read, and WHY; a caller is told none of it** —
    `M13`, `M18`, `M19`, `M20`, and `M14` for the wire.
 8. **The ledger row says what happened** — `M12` for the publish settlement's default, `M21`
    for the one cause that is a fact about the APP and not about any attempt.
 9. **The guard is FIRST, before the act it exists in front of** — `M17`.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| `M1`–`M21` | `apps/desktop/test/nothing-is-built-outside-the-tree.test.ts` |

⚑ **One file, and that is the point**: every row is a claim about one guard and one settlement,
and the suite that proves them is the suite this dispatch wrote.

⛔ **The table was NOT run.** Every row below was applied ALONE, watched go red against the file
named above, and restored from bytes with a SHA-256 re-check — which is what
`verify-each-mutation-row` is for and is not the same claim as a table run.

## ⚠️ What is deliberately NOT here

 - ⛔ **No row on the SQL `CHECK` or the unique index this dispatch REFUSED.** There is nothing to
   mutate: the decision was to write no constraint, and *a mutation that changes nothing reports
   as a survivor*. The refusal is driven in §4 of the killer file, and priced in `schema.ts`.
 - ⚠️ **No row on `placeAttempt` returning the LEXICAL path rather than the resolved one.** The
   choice is real and argued in the docblock — the reader joins the same column to the same root
   — but in this app the two spellings name one inode through the link, so no assertion can tell
   them apart. ⛔ *A line no mutation can kill is not carrying its rule*, and saying so is better
   than a row that passes for the wrong reason.
 - ⚠️ **No row on the prose corrections.** They are sentences, not behaviour; standing rule 19 is
   what makes them correctable, and no mutation can make a docblock false in a way a test sees.
 - ⛔ **No row on this dispatch's own census regeneration.** *A mutation on a census is invisible
   to that census.*
"""

CANON = "apps/desktop/src/main/documents/canonical-document.ts"
REGISTRY = "apps/desktop/src/main/documents/document-registry.ts"
RESOURCES = "apps/desktop/src/main/resources/resources.ts"

# ⚑ The publisher's guard and the three joins it replaced — shared by M1 alone, kept as a constant
# because it is the whole proposition of that row and reads better named.
PUBLISH_GUARD = (
    "  const placed = placeAttempt(root, attempt)\n"
    "  if (!placed.ok) return { ok: false, problem: problemOf(placed), detail: outside(placed) }\n"
    "  const { stagedAt, canonicalAt, rawAt } = placed\n"
)
MKDIR_LOOP = (
    "  try {\n"
    "    for (const path of [stagedAt, canonicalAt, rawAt]) {\n"
    "      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })\n"
    "    }\n"
)
PUBLISH_UNBOUNDED = (
    "  const stagedAt = join(root, attempt.stagedPath)\n"
    "  const canonicalAt = join(root, attempt.canonicalPath)\n"
    "  const rawAt = join(root, attempt.rawPath)\n"
)

# ⚑ Reconciliation's guard, and the two joins that stood there before it — M8.
RECONCILE_GUARD = (
    "    const placed = placeAttempt(deps.root, attempt)\n"
    "    if (!placed.ok) {\n"
    "      if (placed.column === 'documents_root') break\n"
    "      settle(attempt, 'held', outside(placed))\n"
    "      continue\n"
    "    }\n"
    "    const { canonicalAt, stagedAt } = placed\n"
)
RECONCILE_UNBOUNDED = (
    "    const canonicalAt = join(deps.root, attempt.canonicalPath)\n"
    "    const stagedAt = join(deps.root, attempt.stagedPath)\n"
)

# ⚑ The two presence questions 521 added to reconciliation — M9 and M10.
CANONICAL_PRESENCE = (
    "    if (somethingStandsAt(canonicalAt)) {\n"
    "      settle(\n"
    "        attempt,\n"
    "        'held',\n"
    "        `something is at ${attempt.canonicalPath} that this app could not read`,\n"
    "      )\n"
    "      continue\n"
    "    }\n"
)
STAGED_PRESENCE = (
    "      if (somethingStandsAt(stagedAt)) {\n"
    "        settle(\n"
    "          attempt,\n"
    "          'held',\n"
    "          `something is at ${attempt.stagedPath} that this app could not read`,\n"
    "        )\n"
    "        continue\n"
    "      }\n"
)

# ⚑ `183`'s two questions, copied into `spellingToBe` — M6 and M7 each take one of them, and
# M16 takes the clause that separates *not there* from *there and unfollowable*.
WALK_DISCRIMINATION = "      if (!isAbsentComponent(head)) return null\n"
WALK_PRESENCE = (
    "    lstatSync(path)\n"
    "    // It is there. Something that EXISTS made `realpathSync` fail, which is not an absence.\n"
)

# ⚑ The node:fs import line M7 has to widen before its swap means anything — a row that is red
# because the module threw measures nothing (517's own M1/M12 lesson).
FS_IMPORT = (
    "import {\n"
    "  closeSync,\n"
    "  constants,\n"
    "  fstatSync,\n"
    "  lstatSync,\n"
    "  openSync,\n"
    "  readSync,\n"
    "  realpathSync,\n"
    "} from 'node:fs'\n"
)
FS_IMPORT_WITH_STAT = (
    "import {\n"
    "  closeSync,\n"
    "  constants,\n"
    "  fstatSync,\n"
    "  lstatSync,\n"
    "  openSync,\n"
    "  readSync,\n"
    "  realpathSync,\n"
    "  statSync,\n"
    "} from 'node:fs'\n"
)

MUTATIONS = [
    # ── the writer is bounded at all ────────────────────────────────────────────────────────
    (
        "M1 · 🔴 the publisher goes back to joining three recorded strings to the root · "
        "a `mkdir -p` through a symlinked project directory builds outside the tree again",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives in the resource writer: `keepResource` makes `<root>/<sha256>` with a
        # non-recursive mkdir and then asks the name with `lstat` before anything is renamed into
        # it, so a symlink standing there cannot carry the kept file out of the tree. Removing that
        # lstat guard restores the hole the row guarded (a rename lands through a planted link),
        # which the rewritten killer's section 1 plants and pairs with a real-folder control. Killed
        # by `nothing-is-built-outside-the-tree.test.ts`.
        [
            (RESOURCES, "    const standing = lstatSync(folder)\n    if (!standing.isDirectory() || standing.isSymbolicLink()) {\n      return { ok: false, problem: 'something-else-is-at-that-name' }\n    }\n", ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** Reconciliation of
        # document-ingest rows written by a previous launch is gone: 5e931be8 removes the document
        # tables and says 'cases whose subject went are deleted'. A kept resource has no
        # open-attempt row to reconcile, so 'reconciliation joins the two columns it walks' has no
        # code left to plant. Its anchor is left stale, so the census records it retired.
        "M8 · 🔴 reconciliation goes back to joining the two columns it walks · "
        "rows a PREVIOUS launch wrote are acted on unbounded, which a guard at the write site "
        "never covered",
        [(REGISTRY, RECONCILE_GUARD, RECONCILE_UNBOUNDED)],
    ),
    # ── all three columns, not just the one a loop walks ────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the three
        # recorded placement columns (canonical, staging and archive paths) on a document-ingest
        # row, which were placed together. 5e931be8 states 'the project, proposal, binding, home and
        # document tables go; work, work_sequence and work_resource come', and a resource row names
        # one folder and one name. The one-column form of this rule is the reader's `resourceBytes`
        # and the writer's `keepResource`, and neither has a 'trusted the other two columns' shape
        # to plant. Its anchor is left stale, so the census records it retired.
        "M2 · ⛔ only `canonical_path` is placed; the staging and archive spellings are joined · "
        "two of the three columns carrying the exposure are trusted because one of them was not",
        [
            (
                CANON,
                "  const staged = place(attempt.stagedPath)\n"
                "  if (!staged.ok) {\n"
                "    return { ok: false, column: 'staged_path', spelled: attempt.stagedPath, why: staged.why }\n"
                "  }\n",
                "  const staged = { ok: true as const, at: resolve(lexicalRoot, attempt.stagedPath) }\n",
            ),
            (
                CANON,
                "  const raw = place(attempt.rawPath)\n"
                "  if (!raw.ok) {\n"
                "    return { ok: false, column: 'raw_path', spelled: attempt.rawPath, why: raw.why }\n"
                "  }\n",
                "  const raw = { ok: true as const, at: resolve(lexicalRoot, attempt.rawPath) }\n",
            ),
        ],
    ),
    # ── two arms, because the reader has two ────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The 'lexical arm goes, only
        # the resolved spelling is asked' plant is in `placeAttempt` in canonical-document.ts, which
        # 5e931be8 deleted with documents ('list_documents is gone and read_document reads a
        # resource'). The writer no longer takes a location to be placed: it builds `join(root,
        # sha256, name)` from a validated hash and a one-segment name, and its only lexical check
        # (`SHA256_HEX` / `isOneSegment`) has no test in the rewritten 521 killer. The reader-side
        # lexical-then-real pair belongs to the 517/380 tables. Its anchor is left stale, so the
        # census records it retired.
        "M3 · ⚠️ the LEXICAL arm goes and only the resolved spelling is asked · "
        "a row that is lexically out and really in is WRITTEN, and the reader — which asks "
        "lexically first — will never serve it",
        [
            (
                CANON,
                "    if (!within(lexicalRoot, lexical)) return { ok: false, why: 'outside-the-tree' }\n",
                "",
            )
        ],
    ),
    (
        "M4 · 🔴 the REAL arm goes and a spelling that resolves anywhere is admitted · "
        "a symlinked project directory takes the whole publication outside the tree, which is "
        "the case measured at `521` and the reason this guard exists",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The 'resolves
        # anywhere is admitted' failure has one home left in the writer: the guard on the `<sha256>`
        # folder must ask with `lstat`, which does not follow a link. Asking with `stat` instead
        # answers 'directory, not a link' for a link to a folder outside (or inside) the tree and
        # admits it, so the rename lands where the link points; `statSync` is added to the fs import
        # block so the plant loads. Killed by `nothing-is-built-outside-the-tree.test.ts`.
        [
            (RESOURCES, '    const standing = lstatSync(folder)\n', '    const standing = statSync(folder)\n'),
            (RESOURCES, '  realpathSync,\n  renameSync,\n', '  realpathSync,\n  renameSync,\n  statSync,\n'),
        ],
    ),
    # ── one authority for both sides ────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The mixed-spelling defect
        # (root kept lexical, candidate resolved: 372's finding) was in `placeAttempt`, which is
        # gone. The nearest survivor is `resourceBytes`' `within(filesystemSpelling(root),
        # realPath)` on the READ side, which is exercised by the 517/380 tests and not by this
        # table's killer, since the rewritten 521 test only drives `keepResource`. That rule should
        # be re-anchored under those tables rather than as a 521 row. Its anchor is left stale, so
        # the census records it retired.
        "M5 · ⛔ the ROOT keeps its lexical spelling while the candidate gets the filesystem's · "
        "two answers from two authorities, so every legitimate write under a symlinked data "
        "directory is refused — `372`'s finding, inverted",
        [
            (
                CANON,
                "  const realRoot = spellingToBe(lexicalRoot)\n",
                "  const realRoot: string | null = lexicalRoot\n",
            )
        ],
    ),
    # ── a name that exists and does not resolve ─────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is
        # `realResolve`'s walk that climbs past an absent path component and re-appends it, in
        # canonical-document.ts, deleted with documents. Neither `keepResource` nor `resourceBytes`
        # walks up a path: the writer makes a single non-recursive folder and the reader resolves
        # the whole path with one `realpathSync` and treats its failure as 'missing'. Nothing
        # remains to plant, and the rewritten killer does not exercise a dangling link component.
        # Its anchor is left stale, so the census records it retired.
        "M6 · ⚠️ every `realpath` failure is taken for an absent component and the walk climbs on · "
        "`183`'s own defect restored — a dangling symlink where the project directory goes is "
        "re-appended to the tree's spelling and admitted, and `mkdir` decides what it meant",
        [(CANON, WALK_DISCRIMINATION, "")],
    ),
    (
        "M7 · ⚠️ the discrimination asks presence with `stat`, which FOLLOWS the final component · "
        "a dangling symlink reads as absent and the walk climbs past it — measured: a symlink "
        "LOOP still raises `ELOOP` from `stat` and is still refused, so this row moves one of "
        "the two cases and the label says which",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # The refutation holds. The rule is that presence at the kept name is asked with lstat,
        # which does not follow the final component, so a dangling symlink standing there counts as
        # something. Today that is somethingStandsAt in resources.ts, consulted by keepResource
        # before the rename. The plant asks with statSync, which follows the link: a dangling
        # symlink reads as absent, so keepResource writes its temporary file and renames it over the
        # link and answers ok instead of 'something-else-is-at-that-name'. Two edits, as in the
        # original row: statSync is not imported today, and without the import the plant would throw
        # a ReferenceError inside the try, return false, and be red for the wrong reason. NO
        # existing test fails: the section 1 test in nothing-is-built-outside-the-tree.test.ts puts
        # the symlink on the hash DIRECTORY, which the separate lstat(folder) check catches, and the
        # section 2 test puts a regular file with other bytes at the kept name, which stat sees too.
        # MISSING TEST (nothing-is-built-outside-the-tree.test.ts section 2). It makes
        # <root>/<sha256>/ a real folder and puts a DANGLING symlink at <root>/<sha256>/<name>
        # (target does not exist). It asserts keepResource(root, offered) toEqual {ok:false,
        # problem:'something-else-is-at-that-name'}, that lstat of the kept name is still a symbolic
        # link with an unchanged readlink, and that the folder holds no temporary file. Paired
        # positive (already in the file): the same call with nothing at the name, or the same bytes
        # there, returns {ok:true}. ⚠️ No test kills it yet: the landing owes one (D-016b part 2).
        # ⚑ Landing D-016b part 2 (5e931be8) · a new test kills it — keepResource must ask presence
        # at the kept name with lstat so that a dangling symlink standing there counts as something;
        # the existing section-1 test puts the link on the hash FOLDER, which the separate
        # lstat(folder) check catches, and section 2 uses a regular file that stat also sees. The
        # plant needs both edits (the import, then the call) or it dies as a ReferenceError inside
        # the try and returns false for the wrong reason. Both old strings occur exactly once.
        # Killed by `what-the-tree-landing-left-unpinned.test.ts`.
        [
            (RESOURCES, "  renameSync,\n  unlinkSync,\n  writeSync,\n} from 'node:fs'\n", "  renameSync,\n  statSync,\n  unlinkSync,\n  writeSync,\n} from 'node:fs'\n"),
            (RESOURCES, 'function somethingStandsAt(path: string): boolean {\n  try {\n    lstatSync(path)\n    return true\n', 'function somethingStandsAt(path: string): boolean {\n  try {\n    statSync(path)\n    return true\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the one
        # clause where the deleted `isAbsentComponent` diverged from `realResolve` (a component the
        # kernel will never hold counted as absence). Both functions went with
        # canonical-document.ts, and the new code has no absent-component walk, so the divergence
        # cannot be planted. Its anchor is left stale, so the census records it retired.
        "M16 · ⛔ a component the kernel will never hold is counted as an absence · "
        "the one clause this copy diverges from `realResolve` on stops diverging, and a spelling "
        "no writer of this app could have produced is admitted instead of refused",
        [
            (
                CANON,
                "    return code === 'ENOENT' || code === 'ENOTDIR'\n",
                "    return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENAMETOOLONG'\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is a
        # `documents_root` that does not resolve being taken as its own lexical spelling, in
        # canonical-document.ts. The documents root is gone (5e931be8: 'document tables go'); the
        # resource root is `resourcesRoot(userData)`, made by the writer on demand, and the reader's
        # not-resolving-root case is a 517/380 read-side rule. Its anchor is left stale, so the
        # census records it retired.
        "M15 · ⛔ a documents tree that does not resolve is treated as its own lexical self · "
        "the one arm no door can reach is also the one that would rot silently, and a tree that "
        "is a dangling link stops being named as the thing that failed",
        [
            (
                CANON,
                "  const realRoot = spellingToBe(lexicalRoot)\n",
                "  const realRoot = spellingToBe(lexicalRoot) ?? lexicalRoot\n",
            ),
            (
                CANON,
                "  if (realRoot === null) {\n"
                "    return { ok: false, column: 'documents_root', spelled: root, why: 'did-not-resolve' }\n"
                "  }\n",
                "",
            ),
        ],
    ),
    # ── a failure to READ is not an absence ─────────────────────────────────────────────────
    (
        "M9 · 🔴 a canonical file that is SITTING THERE unreadable is settled as gone · "
        "`document_ingest.failure` reads *neither the canonical file nor the staged one is on "
        "disk* about a file a person can see — `517` F1, put back",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # The label (a canonical file sitting there unreadable is settled as gone) names a defect
        # whose old anchor, CANONICAL_PRESENCE in document-registry.ts, is gone, but the rule
        # survives in resources.ts keepResource: a name somebody else is standing on is refused
        # before the kept bytes are written. Plant: drop the somethingStandsAt(kept) guard, so
        # keepResource overwrites what stands there through writeOwn/renameSync and answers ok:true
        # instead of problem 'something-else-is-at-that-name'. Test section 2 of
        # nothing-is-built-outside-the-tree.test.ts builds a kept name with different readable bytes
        # standing on it, asserts ok:false with that problem and that the standing bytes are
        # untouched; its control (the same bytes give ok:true) stays green on the plant. Caveat: the
        # test uses a readable file with different bytes, not a mode-000 file; both fall to the same
        # branch. Killed by `nothing-is-built-outside-the-tree.test.ts`.
        [
            (RESOURCES, "    if (somethingStandsAt(kept)) return { ok: false, problem: 'something-else-is-at-that-name' }\n", ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The 'something standing on
        # the staging name is reported as nothing there' plant is in the ingest settlement, and the
        # staging directory itself is gone: a reply's files are 'kept byte for byte under
        # <userData>/resources/<sha256>/<name>' with a temporary name beside the root. The writer's
        # own 'something is at that name' answer is M11's territory and has no separate staging
        # spelling to plant. Its anchor is left stale, so the census records it retired.
        "M10 · ⚠️ the same lie survives on the STAGING name · "
        "something standing in this app's own staging directory is reported as nothing being "
        "there, and the attempt is closed silently",
        [(REGISTRY, STAGED_PRESENCE, "")],
    ),
    (
        "M11 · ⛔ presence is ASSUMED rather than measured · "
        "`abandoned` becomes unreachable, so an attempt that really left nothing on disk is "
        "sent to a person as something to go and look at",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # `somethingStandsAt` survives in resources.ts as the writer's 'is something already at the
        # kept name' question, answered with `lstat`. Assuming presence (`path.length > 0`) makes
        # every fresh keep look like something else is standing there, so a legitimate first write
        # is refused as 'something-else-is-at-that-name'; the killer's real-folder control in
        # section 1 is the admission that catches it. Killed by
        # `nothing-is-built-outside-the-tree.test.ts`.
        [
            (RESOURCES, 'function somethingStandsAt(path: string): boolean {\n  try {\n    lstatSync(path)\n    return true\n  } catch {\n    return false\n  }\n}\n', 'function somethingStandsAt(path: string): boolean {\n  return path.length > 0\n}\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the
        # settlement default (`held` versus `abandoned`) for an ingest row with a recorded location
        # outside the tree. Held and abandoned document-ingest outcomes no longer exist: 5e931be8
        # says 'the project, proposal, binding, home and document tables go', and `keepResource` has
        # only the `something-else-is-at-that-name` and `write-failed` answers. Its anchor is left
        # stale, so the census records it retired.
        "M12 · 🔴 the settlement default goes back to `abandoned` · "
        "a recorded location outside the tree closes the attempt with nothing for a person to "
        "look at, which is the silent half of the pair and the one nobody would find",
        [
            (
                REGISTRY,
                "      published.problem === 'write-failed' ? 'abandoned' : 'held',\n",
                "      published.problem === 'canonical-path-occupied' ? 'held' : 'abandoned',\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is
        # reconciliation settling every open document-ingest row `held` when the tree could not be
        # resolved (an unmounted volume), which needs the ingest rows and the launch-time reconciler
        # that 5e931be8 removed. The kept-resource path has no open rows to settle and no terminal
        # `held` state. Its anchor is left stale, so the census records it retired.
        "M21 · 🔴 reconciliation settles every open row on a tree it could not resolve · "
        "an external volume that is not mounted yet closes each of them `held` — terminally, "
        "*never repaired automatically* — for a cause that is gone at the next launch",
        [
            (
                REGISTRY,
                "      if (placed.column === 'documents_root') break\n      settle(attempt, 'held', outside(placed))\n",
                "      settle(attempt, 'held', outside(placed))\n",
            )
        ],
    ),
    # ── the guard is FIRST ──────────────────────────────────────────────────────────────────
    (
        "M17 · 🔴 the guard runs AFTER the directories are made · "
        "a refusal in front of the WRITE is a refusal after `mkdir -p` has already built outside "
        "the tree, which is the whole reason the placement is the first statement",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The ordering
        # rule survives: the writer's refusal must come before the rename, because a refusal after
        # the file has already been carried through a link is a refusal after the damage. The plant
        # moves the lstat guard (spelled differently, so the exactly-once counts do not interfere)
        # to after `renameSync`, so the call still answers 'something-else-is-at-that-name' but the
        # kept file has already landed outside the tree. Killed by
        # `nothing-is-built-outside-the-tree.test.ts`.
        [
            (RESOURCES, "    const standing = lstatSync(folder)\n    if (!standing.isDirectory() || standing.isSymbolicLink()) {\n      return { ok: false, problem: 'something-else-is-at-that-name' }\n    }\n", ''),
            (RESOURCES, '    renameSync(temporary, kept)\n    return { ok: true }\n', "    renameSync(temporary, kept)\n    const after = lstatSync(folder)\n    if (!after.isDirectory() || after.isSymbolicLink()) {\n      return { ok: false, problem: 'something-else-is-at-that-name' }\n    }\n    return { ok: true }\n"),
        ],
    ),
    # ── who is told what ────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The sentence naming which of
        # three columns escaped was a held-row refusal on the document tables, deleted with them in
        # 5e931be8. There is one location per resource and its refusal detail carries only
        # `{resource}`, so there is no column to name. Its anchor is left stale, so the census
        # records it retired.
        "M13 · ⚠️ the refusal stops naming WHICH of the three columns escaped · "
        "the only sentence a person gets about a held row says a location is wrong without "
        "saying which of three to look at",
        [
            (
                REGISTRY,
                "    ? `the location this app recorded in ${placed.column} is not inside the tree it keeps ` +\n",
                "    ? `the location this app recorded is not inside the tree it keeps ` +\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the held-row
        # refusal sentence quoting the value it read from a column, on the deleted document
        # registry. There is no column and no quoted location in a resource refusal now, whose
        # detail carries only `{resource}`. Its anchor is left stale, so the census records it
        # retired.
        "M18 · ⚠️ the refusal names the column and stops QUOTING what it read · "
        "the one sentence a person gets says a location is wrong and withholds the value, which "
        "is the half of the pair `M13` does not cover",
        [
            (
                REGISTRY,
                "        `documents in: ${placed.spelled}`\n",
                "        `documents in.`\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is reporting an
        # unresolved documents tree as a column outside it, in the ingest reconciliation and
        # settlement that 5e931be8 removed along with the document tables. The word 'column' has no
        # referent left, and the reader's own root-does-not-resolve answer is not driven by the 521
        # killer. Its anchor is left stale, so the census records it retired.
        "M19 · ⚠️ a tree that did not resolve is reported as a COLUMN that is outside it · "
        "the one sentence about the app's own documents directory blames one of three columns "
        "instead, and sends a person to look at a row",
        [
            (
                REGISTRY,
                "    return `the tree this app keeps documents in did not resolve, so nothing was written (${placed.spelled})`\n",
                "    return `the location this app recorded in ${placed.column} is not inside the tree it keeps documents in: ${placed.spelled}`\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** 'Could not be followed'
        # versus 'outside the tree' was `placeResource`'s ruling in canonical-document.ts, deleted
        # with documents. The surviving read-side analogue (`resourceBytes` mapping realpath failure
        # to missing and out-of-tree to unreadable) is covered by the 517/380 reader tests and is
        # outside what the rewritten 521 killer drives; if wanted, it should be re-anchored under
        # those tables. Its anchor is left stale, so the census records it retired.
        "M20 · 🔴 *could not be followed* collapses back into *outside the tree* · "
        "`517`'s defect shipped a third time — a dangling symlink pointing at a name INSIDE the "
        "tree is reported as a location outside it, and `placeResource`'s own ruling one function "
        "up is that those are different facts",
        [
            (
                CANON,
                "    if (real === null) return { ok: false, why: 'did-not-resolve' }\n",
                "    if (real === null) return { ok: false, why: 'outside-the-tree' }\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is a held-row
        # refusal handing the CALLER the offending path spelling, on the deleted document registry.
        # The surviving twin (a resource refusal's detail carries only `{resource}`, never a path)
        # is asserted by the reader tests of the 380/517 tables, not by the rewritten 521 killer, so
        # it does not belong to this table. Its anchor is left stale, so the census records it
        # retired.
        "M14 · ⛔ the refusal hands the CALLER the offending spelling · "
        "`380` keeps the canonical tree's paths off every wire an agent reads, and this puts one "
        "there to prove a point",
        [
            (
                REGISTRY,
                "        problem: published.problem,\n        number: documentNumber(attempt.sequence),\n",
                "        problem: published.problem,\n        number: documentNumber(attempt.sequence),\n        why: published.detail,\n",
            )
        ],
    ),
]
