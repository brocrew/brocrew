"""380 · A document with a number and a hash.

⛔ **One subject with four ways of failing, and three of them read as working.**

1. **The NUMBER is wrong.** An allocator that re-uses a number a failed registration consumed, a
   counter that is not scoped to the project, a task whose two halves drift apart. ⚑ Every one of
   these produces documents that register, publish and read back perfectly — the failure is entirely
   in what a person means when they quote `041`.
2. **The HASH is of the wrong bytes.** Hashing what arrived rather than a canonical form, or
   canonicalising and forgetting to keep what arrived. ⚠️ Both hash something, and both look right
   until two editors save the same document.
3. **The CONFINEMENT has one arm.** A lexical check with no real one lets a symlink out; a real
   check with no lexical one makes the app stat a path it was never entitled to resolve.
4. **The CRASH is decided by assumption.** *Assume it worked* adopts a file nobody wrote; *assume it
   failed* throws away one this app did write. ⛔ Only the hash recorded before publication can tell
   them apart.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M5` | ⚑ **`apps/desktop/test/a-document-with-a-number-and-a-hash.test.ts`** §1 — the number |
| `M6`-`M12` | ⚑ **…** §2 — what is hashed, and what arrived |
| `M13`-`M18` | ⚑ **…** §3 — confinement, the cap and the shape |
| `M19`-`M20` | ⚑ **…** §3/§4 — the workspace the resource is measured against |
| `M21`-`M26` | ⚑ **…** §5 — the four crash states |
| `M27`-`M30` | ⚑ **…** §7 — the reader, and who may call it |
| `M31` | ⚑ **`scripts/gate-only/clean-base.test.mjs`** §3 — the documents tree goes with the ledger |

⛔ **706 · the `gate-only/` killers above run only inside `pnpm run ci`** — they spawn `clean-base`,
which standing rule §6 permits only inside the whole gate (`vitest.gate-only.config.ts`). ⚠️ **And `ci`
never applies a mutation row**: it runs these killers on the unmutated tree. So a row whose ONLY
killer is one of them can no longer be re-verified RED by anything — `verify_row.py` refuses the
killer, and no project a table run starts reaches it, so a table run reports the row SURVIVED. The
row keeps the verdict it last earned.

⚑ **717 · R45 split that file** (the PM's ruling): its tests that never spawn the script went back to
`scripts/test/clean-base-without-running-it.test.mjs`, and each row below was re-run ALONE against
it with `verify_row.py`. ⛔ **`M31` SURVIVED it**: the documents tree going with the ledger is seen only by a run of the script. Its only killer still spawns the script, and it keeps its last verdict.

## ⛔ What this table deliberately does NOT contain, and why each absence is a decision

⛔ **No row swapping `realpathSync.native` for the portable wrapper on the CANDIDATE path.** It
cannot be made red by anything this repository can stage. The two differ only in whether a caller's
case/normalisation alias survives resolution, and every candidate this suite resolves is spelled the
way the filesystem spells it — so both functions answer the same string and the row would be a no-op
reporting as a survivor. ⚑ **The ROOT side is a different matter and IS a row** (`M15`): the test
tree lives under `/var/...`, which is a symlink to `/private/var`, so a root that is not resolved
refuses every document in the suite.

⛔ **No row deleting `stat.isFile()` from `readResource`.** `readSync` on a directory descriptor
answers `EISDIR`, the `catch` beneath it returns `resource-unreadable`, and that is the same rail
the check produces — so the row could not be refused. ⚠️ **The line is kept rather than deleted**,
because the shape it actually guards is a FIFO, which `O_NONBLOCK` opens successfully and reads as
zero bytes: a different answer, and one this suite has no portable way to plant.

⛔ **No row dropping `AND state = 'open'` from `closeAttemptWithDocument`.** `finishIngestTx` reads
the attempt and refuses a non-`open` one in TypeScript before the statement runs, so the SQL guard is
the second of two and nothing can reach it alone. ⚑ It stays because the two answer different
questions — one is a decision, the other is a race — but a row on it would be measuring the first.

⛔ **No row on the ORDER of `REPORT_ORDER`'s new `DOCUMENTS` entry.** `clean-base-without-running-it.test.mjs` asserts
membership and uniqueness, not position, so a permutation could not be refused.
"""

SCHEMA = "apps/desktop/src/main/db/schema.ts"
CANON = "apps/desktop/src/main/documents/canonical-document.ts"
REGISTRY = "apps/desktop/src/main/documents/document-registry.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
MIGRATION = "apps/desktop/src/main/db/migrations/0022_mature_talisman.sql"
CLEAN = "scripts/lib/clean-base.mjs"
RESOURCES = "apps/desktop/src/main/resources/resources.ts"

# Resource ingestion no longer has containment refusals, so those removed-code anchors remain
# retired. The directory used to resolve a relative resource is still a separate live rule and must
# not be retired with containment.
MUTATIONS = [
    # ── §1 · the number ───────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 the counter never moves · every document in a project is `001`, and the second one "
        "collides with the first on `document_project_sequence_kind_uq`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (a
        # counter that moves, so two things under one scope never share a number) survives as the
        # piece counter: `work_sequence` replaced `project_sequence`, and its docblock says a number
        # is never handed out twice. The plant freezes the counter at 1, so the second root or the
        # second piece under a parent collides on `work_root_number_uq` / `work_parent_number_uq`,
        # the same collision the label names. Killed by `one-number-a-person-can-quote.test.ts`,
        # `a-giver-reads-its-tasks-back-in-the-order-they-were-numbered.test.ts`.
        [
            (STORE, 'ON CONFLICT(scope) DO UPDATE SET last = last + 1', 'ON CONFLICT(scope) DO UPDATE SET last = last'),
        ],
    ),
    (
        "M2 · 🔴 the number is `MAX(sequence) + 1` over the documents · exactly what `359` forbids — "
        "a registration that failed leaves no row, so its number is handed out again and a person's "
        "*“see 041”* points at a different document",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives in the piece model and is stated in the schema docblock: `work_sequence` is a
        # counter and never `max(number) + 1` over the rows, because a give whose send fails burns
        # its number and a maximum would hand it out again. The plant makes the read-back of the
        # counter a maximum over `work`, which cannot see a number that left no row. Killed by
        # `one-number-a-person-can-quote.test.ts`.
        [
            (STORE, 'last: db.prepare(`SELECT last FROM work_sequence WHERE scope = ?`),', "last: db.prepare(`SELECT COALESCE(MAX(number), 0) + 1 AS last FROM work WHERE COALESCE(parent_id, 'roots') = ?`),"),
        ],
    ),
    (
        "M3 · ⛔ the stream is app-global · a second project's first document is numbered after every "
        "document in the first, which is the state `369` and `376` made reachable",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # (numbers are scoped, and the stream is not app-global) survives as one `work_sequence` row
        # per parent plus one for the roots, so the first piece under a parent is .1 whatever else
        # exists. The plant collapses every scope onto the roots counter (ROOTS_SCOPE is already
        # imported in session-store.ts), so a parent's first piece is numbered after every root and
        # piece before it. Killed by `one-number-a-person-can-quote.test.ts`,
        # `a-giver-reads-its-tasks-back-in-the-order-they-were-numbered.test.ts`.
        [
            (STORE, 'workSql().bump.run(scope)', 'workSql().bump.run(ROOTS_SCOPE)'),
            (STORE, '(workSql().last.get(scope) as { last: number }).last', '(workSql().last.get(ROOTS_SCOPE) as { last: number }).last'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is a document
        # that takes its task's number, and both are gone on purpose. The commit says "Tasks ...
        # replaced by pieces (W1, W1.1)" and "the project, proposal, binding, home and document
        # tables go", and a-reply-and-its-absence.test.ts pins "There is no number any more — a
        # resource belongs to its piece, and the piece has the label". A resource has no number to
        # allocate, so the defect cannot be planted. Its anchor is left stale, so the census records
        # it retired.
        "M4 · ⛔ a document of a task does not take the task's number · it allocates one of its own, "
        "so a task and its prompt and its response are three numbers instead of one and *“the "
        "response to 041”* stops naming anything",
        [
            (
                STORE,
                "        sequence = number.number\n",
                "        sequence = null\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The rule is one document per
        # (task, kind), and the `document` table and the kinds went with `list_documents` (commit
        # 5e931be8: "the project, proposal, binding, home and document tables go"). A piece now
        # takes several resources (schema docblock: "Several per piece") and `work_resource` has no
        # uniqueness by role or name. The never-replace-a-kept-file rule that this label's
        # consequence points at lives in `keepResource` and is re-anchored as M24. Its anchor is
        # left stale, so the census records it retired.
        "M5 · ⛔ a second document of the same kind is not refused · a registered document is "
        "rewritten in place, and the hash other rows point at silently stops matching",
        [
            (
                STORE,
                "        if (siblings.some((one) => one.kind === input.kind)) {",
                "        if (false as boolean) {",
            )
        ],
    ),
    # ── §2 · the hash ─────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The label protects hashing
        # the canonical form so two editors' saves match. D10 reverses it on purpose: "Resources are
        # copied byte for byte, with no canonicalisation" (c3-spec.md D10), and c3-spec §4.8 says
        # "bytes are kept as read". The commit says "kept byte for byte", so hashing the arriving
        # bytes is now the intended behaviour, not the defect. Its anchor is left stale, so the
        # census records it retired.
        "M6 · 🔴 the arriving bytes are hashed instead of the canonical ones · the same document "
        "saved by two editors carries two hashes, and every reader that keys on one misses",
        [
            (
                REGISTRY,
                "    contentSha256: sha256Hex(canonical.canonical.bytes),",
                "    contentSha256: sha256Hex(read.bytes),",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** Folding CRLF to LF was part
        # of the canonical form, and that form was deleted on purpose (c3-spec §4.8: "kept as read,
        # with no canonicalisation"; commit: "kept byte for byte"). A CRLF file and its LF twin
        # being two different resources is now the intended answer. The plant would only remove code
        # that no longer exists. Its anchor is left stale, so the census records it retired.
        "M7 · ⛔ line endings are not folded · a CRLF document and its LF twin are two documents",
        [
            (
                CANON,
                "  const unixed = text.replace(/\\r\\n?/g, '\\n')",
                "  const unixed = text",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The single-trailing-newline
        # rule belonged to `canonicalDocument`, which was deleted with `main/documents/` (c3-spec:
        # "Lifted from canonical-document.ts and document-registry.ts, then both files ... are
        # deleted"). D10 keeps bytes as read, so a file a formatter touched now hashing differently
        # is the specified behaviour. Its anchor is left stale, so the census records it retired.
        "M8 · ⛔ the trailing-newline rule is dropped · a file a formatter touched and one it did not "
        "hash differently",
        [
            (
                CANON,
                "  const canonical = `${unixed.replace(/\\n+$/, '')}\\n`",
                "  const canonical = unixed",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** `ignoreBOM` only mattered
        # because the decoded text was hashed as the document's identity. `readOfferedResource` now
        # decodes only to validate UTF-8 and discards the string, and the kept bytes (BOM included)
        # are hashed as read (D10), so the option cannot change any outcome. The plant would be an
        # equivalent mutant that no test can turn red. Its anchor is left stale, so the census
        # records it retired.
        "M9 · ⚠️ the decoder keeps the byte-order mark · `ignoreBOM` is an ABSENT option with a value "
        "of its own, and turning it on makes an encoding artefact part of the document's identity",
        [
            (
                CANON,
                "    text = new TextDecoder('utf-8', { fatal: true }).decode(raw)",
                "    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw)",
            )
        ],
    ),
    (
        "M10 · 🔴 the decoder substitutes instead of refusing · bytes nobody can read are hashed and "
        "registered, and the call reports success",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule that
        # bytes nobody can read as UTF-8 are refused with `resource-not-text` survives in
        # `readOfferedResource` (c3-spec §4.8: markdown and page forms "must decode as UTF-8
        # (resource-not-text)"). The plant makes the validating decoder substitute instead of throw,
        # so an unreadable file is hashed, kept and reported as success. Killed by
        # `a-refusal-carries-its-remedy.test.ts`.
        [
            (RESOURCES, "new TextDecoder('utf-8', { fatal: true }).decode(bytes)", "new TextDecoder('utf-8', { fatal: false }).decode(bytes)"),
        ],
    ),
    (
        "M11 · ⛔ an empty document registers · a number and a hash are spent on nothing, and the "
        "task looks answered",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule that
        # an empty answer is not a resource survives as `resource-empty`, narrowed by D-016 to a
        # file with no bytes at all (whitespace is text), and backed by `work_resource_bytes_ck`.
        # The plant removes the empty check, so an empty file is read as ok and reaches the store.
        # Killed by `documents-hold-what-agents-produce.test.ts`,
        # `a-refusal-carries-its-remedy.test.ts`.
        [
            (RESOURCES, 'if (bytes.length === 0) {', 'if (false as boolean) {'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The label protects an
        # archive copy of the raw bytes kept beside the canonical copy, so that "the app changed my
        # file" stays answerable. There is now one copy, kept byte for byte (commit: "kept byte for
        # byte under <userData>/resources/<sha256>/<name>"), and `document_ingest` and
        # `<userData>/documents/` are gone (04-tree-data-model.md: "Gone: ... document_ingest ...
        # and <userData>/documents/"). Two copies that could differ no longer exist. Its anchor is
        # left stale, so the census records it retired.
        "M12 · ⛔ the archive holds the canonical bytes · *“the app changed my file”* becomes "
        "unanswerable, because both copies are the app's own",
        [
            (
                REGISTRY,
                "    writeOwn(\n      rawAt,\n      raw,\n",
                "    writeOwn(\n      rawAt,\n      canonical,\n",
            )
        ],
    ),
    # ── §3 · confinement, the cap and the shape ───────────────────────────────────────────────
    (
        "M13 · 🔴 the lexical arm goes · a path that was never entitled to be resolved is resolved, "
        "so this app stats `/etc` on a caller's say-so and answers a different rail for a path that "
        "does not exist — entitlement decided after existence",
        [
            (
                CANON,
                "  if (!within(lexicalRoot, lexicalPath)) return outside()",
                "  if (false as boolean) return outside()",
            )
        ],
    ),
    (
        "M14 · 🔴 the real arm goes · a symlink inside the workspace pointing at `~/.ssh/config` is "
        "read, hashed and registered as a document",
        [
            (
                CANON,
                "  if (!within(filesystemSpelling(lexicalRoot), realPath)) return outside()",
                "  if (false as boolean) return outside()",
            )
        ],
    ),
    (
        "M15 · 🔴 the ROOT is not resolved · one side of the comparison is the caller's spelling and "
        "the other is the filesystem's, which is `372`'s finding exactly — and under `/var`, a "
        "symlink to `/private/var`, it refuses every document there is",
        [
            (
                CANON,
                "  if (!within(filesystemSpelling(lexicalRoot), realPath)) return outside()",
                "  if (!within(lexicalRoot, realPath)) return outside()",
            )
        ],
    ),
    (
        "M16 · ⛔ anything is a document · the extension check goes, and the registry copies and "
        "hashes whatever a path names",
            # ⚑ **Re-anchored in place by `635`, not retired** (142's rule). ⛔ `HO-097` §1 made the
            # extension check an ALLOW-LIST, so the line moved. ⚠️ **The DEFECT is unchanged**:
            # nothing decides what a document may be, and the registry copies whatever it is given.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule that
        # only a name this app has a word for is kept survives in `readOfferedResource` as
        # `resource-not-a-form-this-app-keeps`. The plant deletes the form check and treats every
        # name as markdown, so anything a path names is read, hashed and kept. Killed by
        # `documents-hold-what-agents-produce.test.ts`, `a-refusal-carries-its-remedy.test.ts`.
        [
            (RESOURCES, "  const form = formOfName(name)\n  if (form === null) {\n    return {\n      ok: false,\n      refusal: refuseResource('resource-not-a-form-this-app-keeps', { path: realPath }),\n    }\n  }\n", "  const form = 'markdown' as DocumentForm\n"),
        ],
    ),
    (
        "M17 · ⚠️ the cap becomes exclusive · a document of exactly 1,048,576 bytes is refused, and "
        "the bound quietly moves by one",
            # ⚑ **Re-anchored in place by `635`, not retired** (142's rule). ⛔ The bound is the
            # FORM's now. ⚠️ **The DEFECT is unchanged**: the cap becomes exclusive and a document
            # of exactly the limit is refused.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The cap is
        # still inclusive: `readOfferedResource` refuses only when `stat.size > limit`, with a 1 MiB
        # limit for markdown and page forms. The exact-cap case died with the deleted
        # a-document-with-a-number-and-a-hash.test.ts, which had `atTheCap` at 1,048,576 bytes, and
        # was not carried into any surviving test. Killed by
        # `documents-hold-what-agents-produce.test.ts`.
        # ⚑ Landing D-016b part 2 (5e931be8) · a new test kills it — The plant turns `stat.size >
        # limit` into `>=` in readOfferedResource, so a text resource of exactly
        # MAX_TEXT_RESOURCE_BYTES (1,048,576) would be refused instead of accepted. No existing test
        # sits on the cap itself: documents-hold-what-agents-produce §4 only compares 'a picture
        # larger than a report', and a-refusal-carries-its-remedy only reads a refusal far over the
        # cap. A pure unit test on readOfferedResource with real temp .md files (exactly at the cap
        # accepted, one byte over refused with {bytes, limit}) fails the plant by an assertion, not
        # by a TypeError. Killed by `the-survivors-the-tree-landing-left.test.ts`.
        [
            (RESOURCES, '    if (stat.size > limit) {\n', '    if (stat.size >= limit) {\n'),
        ],
    ),
    (
        "M18 · ⛔ the size no longer bounds the read · a file measured at the stat is read past what "
        "was measured, so the bytes hashed are not the bytes counted",
            # ⚑ **Re-anchored in place by `635`, not retired** (142's rule). ⛔ The success arm
            # carries the form now. ⚠️ **The DEFECT is unchanged**: the read is no longer bounded by
            # the size the stat measured.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule that
        # the kept and hashed bytes are exactly the bytes read from the descriptor, bounded by the
        # stat size, survives in `readBounded`. The plant drops the read loop, so a buffer of the
        # measured length is returned without reading any of the file: the bytes hashed and kept are
        # not the file's. Killed by `documents-hold-what-agents-produce.test.ts`.
        [
            (RESOURCES, '  let filled = 0\n  while (filled < bytes.length) {\n    const got = readSync(fd, bytes, filled, bytes.length - filled, filled)\n    if (got === 0) break\n    filled += got\n  }\n  return bytes.subarray(0, filled)\n', '  return bytes\n'),
        ],
    ),
    # ── §3/§4 · which workspace the resource is measured against ──────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** `workspaceOf` and
        # `registerDocument` were deleted with the document registry (c3-spec: "both files and
        # main/documents/ are deleted"). The nearest successor, the `?? null` in `keptForAReply`, is
        # unreachable: a reply is admitted only for a caller that owns a piece, whose owner has a
        # `provider_session` row, so `recordedOne(owner)` is never absent. Under R92 a folder is
        # only the base of a relative path, so the plant `?? '/'` cannot be killed by any test. Its
        # anchor is left stale, so the census records it retired.
        "M19 · 🔴 an unknown session gets the root of the disk as its workspace · a caller that names "
        "a session id nobody ever issued may register any file on the machine",
        [
            (
                HOST,
                "    return this.deps.store.recordedOne(sessionId)?.cwd ?? null",
                "    return this.deps.store.recordedOne(sessionId)?.cwd ?? '/'",
            )
        ],
    ),
    (
        "M20 · ⛔ the workspace is the caller's rather than the offering session's · the containment "
        "rail is measured against the wrong directory, which is the whole rail",
                # ⚑ **Corrected in place at `726`** (R92 removed the containment this measured against,
                # and `726`'s review caught the retirement): ingest now RESOLVES a relative resource
                # against the offering session's folder (`resolveResource`), so the wrong directory
                # reads the wrong file, or none. The defect — the caller's directory, not the
                # offering session's — is unchanged.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — Which
        # directory a relative resource path is read from (the offering conversation's own folder)
        # is still a live rule, and 726 already kept this row alive after R92. It is now
        # `keptForAReply`'s `folder`, taken from `recordedOne(owner)?.cwd`. The plant reads it from
        # the folder's parent, using `join(at, '..')` because `dirname` is not imported in
        # runtime-host.ts and would raise a ReferenceError. Killed by `one-rule-one-place.test.ts`,
        # `the-id-this-app-hands-a-person.test.ts`, `two-withdrawals-open-what-was-scoped.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule holds: a resource path is resolved against the conversation's recorded working
        # folder. D-016c moved that read into the door-neutral keptFor, which replaced keptForAReply
        # and workspaceOf, so the old one-line anchor moved but the same line still exists once. The
        # plant points the folder one level up, so the offered files no longer resolve. Killed by
        # `one-rule-one-place.test.ts`, `the-id-this-app-hands-a-person.test.ts`,
        # `two-withdrawals-open-what-was-scoped.test.ts`.
        [
            (HOST, 'const folder = this.deps.store.recordedOne(conversation)?.cwd ?? null', "const at = this.deps.store.recordedOne(conversation)?.cwd ?? null\n    const folder = at === null ? null : join(at, '..')"),
        ],
    ),
    # ── §5 · the four crash states ────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is
        # reconciliation adopting whatever stands at the canonical path after a crash. There is no
        # reconciliation or ingest state machine any more (c3-spec §4.8: "no ingest state machine,
        # and an orphaned file is harmless"), and `document_ingest` is deleted. The live adoption
        # door is `keepResource`, and it is re-anchored as M24. Its anchor is left stale, so the
        # census records it retired.
        "M21 · 🔴 reconciliation ADOPTS whatever is at the canonical path · *“assume it worked”*, and "
        "a file this app did not write becomes a registered document with somebody else's bytes",
        [
            (
                REGISTRY,
                "      if (standing.sha256 === attempt.contentSha256) {",
                "      if (true as boolean) {",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The label protects the
        # publish step's check that a staged file hashes to the recorded attempt before it is
        # linked. That step is gone with the attempt: `keepResource` writes a temporary name and
        # renames it, with no recorded hash to compare (c3-spec §4.8: "no ingest state machine, and
        # an orphaned file is harmless"). The integrity is now checked at read time by
        # `resourceBytes` (M30). Its anchor is left stale, so the census records it retired.
        "M22 · 🔴 a half-written staged file is published · the truncated bytes are linked to the "
        "canonical name and registered under a hash they do not have",
        [
            (
                REGISTRY,
                "    if (staged.sha256 !== attempt.contentSha256) {",
                "    if (false as boolean) {",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** Held versus abandoned are
        # states of `document_ingest`, and that table and its reconciliation are deleted
        # (04-tree-data-model.md: "Gone: ... document_ingest"; c3-spec §4.8: "no ingest state
        # machine"). An undecidable attempt cannot exist: an orphaned file is harmless because
        # nothing reads a resource except through its row. Its anchor is left stale, so the census
        # records it retired.
        "M23 · ⛔ an undecidable attempt is ABANDONED rather than held · *“assume it failed”*, and the "
        "one state a person has to look at stops being reachable",
        [
            (
                REGISTRY,
                "          'held',\n"
                "          `the file at ${attempt.canonicalPath} does not hash to ${attempt.contentSha256}`,",
                "          'abandoned',\n"
                "          `the file at ${attempt.canonicalPath} does not hash to ${attempt.contentSha256}`,",
            )
        ],
    ),
    (
        "M24 · 🔴 the publish clobbers · an `EEXIST` at the canonical name is treated as ours "
        "whatever it holds, so a document this app did not write is adopted at registration time "
        "rather than at reconciliation",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule that
        # a file already standing at the kept name is adopted only if it holds the same bytes
        # survives in `keepResource`: the same bytes there is a success, something else is refused
        # and never replaced. The plant treats any readable file at the name as ours, so a file this
        # app did not write is adopted. Killed by `nothing-is-built-outside-the-tree.test.ts`.
        [
            (RESOURCES, 'if (already.ok && already.sha256 === offered.sha256) return { ok: true }', 'if (already.ok) return { ok: true }'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The CHECK
        # `document_ingest_registered_names_it_ck` lived in migration 0022, and `document_ingest`
        # and migrations 0001 to 0042 are gone (commit: "The database is ONE migration,
        # 0000_the_tree ... the project, proposal, binding, home and document tables go"). The
        # nearest live CHECKs, `work_resource_sha256_ck` and `work_resource_bytes_ck`, guard
        # different facts. The anchor file no longer exists. Its anchor is left stale, so the census
        # records it retired.
        "M25 · 🔴 the database stops holding *registered* and *names a document* together · a row can "
        "claim a registration that produced nothing, which is the CHECK's whole job",
        [
            (
                MIGRATION,
                "\tCONSTRAINT \"document_ingest_registered_names_it_ck\" CHECK((\"document_ingest\".\"state\" = 'registered') = (\"document_ingest\".\"document_id\" is not null)),\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** `INGEST_STATES` and the
        # reader that maps an unrecognised state to 'held' lived in `canonical-document.ts` for the
        # `document_ingest` state machine. Both are deleted (c3-spec: "no ingest state machine"),
        # and no resource carries a state. Its anchor is left stale, so the census records it
        # retired.
        "M26 · 🔴 an unrecognised state is believed · *“done as the absence of the states I named”*, "
        "and a hand-edited row claims a document that does not exist",
        [
            (
                CANON,
                "  return INGEST_STATES.includes(raw as IngestState) ? (raw as IngestState) : 'held'",
                "  return raw as IngestState",
            )
        ],
    ),
    # ── §7 · the reader ───────────────────────────────────────────────────────────────────────
    #
    # 🔴 **M27, M28 and M29 are RETIRED at `549`, and the subject is gone by RULING** (HO-057).
    #
    # > ⚑ *Any agent may read any document in any project. When a project can be finished,
    # > finishing it never narrows who may read its documents.* (`HO-097` §2.2 — `635`.) — *A project scopes
    # > ACTIVITY. It does not scope KNOWLEDGE.*
    #
    # ⛔ **`RuntimeHost.mayReadDocument` is deleted**, so the three arms these rows break — the
    # entitlement itself, the durable-parent derivation, and the null-source arm — have nothing left
    # to anchor on. ⚠️ **They are not re-anchored**: a predicate that returns true for every caller
    # is a line no mutation can kill, and `a-line-no-mutation-can-kill-is-not-carrying-its-rule` is
    # what re-anchoring them would have produced.
    #
    # ⚑ **M27's LABEL is what the product does now, on purpose** — *any conversation may read any
    # document* — which is the clearest form this record could take for the next reader.
    # ⛔ **M30 below is UNTOUCHED and is the row HO-057 §1.4 rests on**: the widening moved WHO may
    # read and not WHAT may be returned unverified.
    (
        "M27 · 🔴 any conversation may read any document · the entitlement goes and the registry "
        "becomes a shared drive between agents that never met",
        [
            (
                HOST,
                "      !this.mayReadDocument(record.sourceSessionId, callerSessionId)",
                "      !(true as boolean)",
            )
        ],
    ),
    (
        "M28 · 🔴 the parent relation is read off the LIVE slot · exactly `mayCommand`, and a parent "
        "is refused its child's document the moment the child ends — which is the moment criterion "
        "12 exists for",
        [
            (
                HOST,
                "    return this.deps.store.spawnProvenance(sourceSessionId)?.parentSessionId === callerSessionId",
                "    return this.slots.get(sourceSessionId)?.commandedBy === agentCallerId(callerSessionId)",
            )
        ],
    ),
    (
        "M29 · ⛔ a document no conversation registered is readable · the null arm grants instead of "
        "refusing, so an app-registered document is open to every agent in every project",
        [
            (
                HOST,
                "    if (sourceSessionId === null) return false",
                "    if (sourceSessionId === null) return true",
            )
        ],
    ),
    (
        "M30 · 🔴 the reader stops re-checking the hash · a registration's claim about its bytes "
        "quietly stops being true, and the tool hands back whatever is at the path today",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule that
        # the reader re-checks the hash of the bytes before serving them survives in
        # `resourceBytes`, which `read_document` and the person's window both go through, and it
        # refuses `resource-bytes-changed` when the file no longer hashes to its row. The plant
        # removes the re-check, so whatever is at the path today is handed back. Killed by
        # `two-withdrawals-open-what-was-scoped.test.ts`.
        [
            (RESOURCES, 'if (read.sha256 !== row.sha256) {', 'if (false as boolean) {'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The label protects the guard
        # in front of the document INSERT in `finishIngestTx`, which both settle paths and
        # reconciliation passed through. `finishIngestTx`, `readDocument` and the attempt are
        # deleted (c3-spec: "documentSql (all 14 statements) ... beginIngestTx, finishIngestTx, the
        # settle transaction"). `recordGive` now inserts a freshly minted `work_<uuid>` id, so two
        # attempts cannot hold one number. Its anchor is left stale, so the census records it
        # retired.
        "M32 · 🔴 the door in front of the INSERT goes · two attempts can hold one number, so the "
        "loser raises `document_project_sequence_kind_uq` out of a public host method where the "
        "registry owes a refusal — and comes back to reconciliation on every launch for ever",
        [
            (
                STORE,
                "      if (documentSql().readDocument.get(documentId) !== undefined) return null",
                "      if (false as boolean) return null",
            )
        ],
    ),
    # ── the reset ─────────────────────────────────────────────────────────────────────────────
    (
        "M31 · ⛔ the documents tree is kept like `exports/` · a clean base leaves every canonical "
        "file orphaned from the ledger it belonged to, and holds `001-response.md` against the fresh "
        "base for ever",
        [
            (
                CLEAN,
                "    if (rule?.name === 'exports' && !dropExports) {",
                "    if ((rule?.name === 'exports' || rule?.name === 'documents') && !dropExports) {",
            )
        ],
    ),
]
