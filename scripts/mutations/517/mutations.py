"""517 · one rule, one place, and both doors narrow — each row is THE DEFECT, put back (131).

## 🔴 The field report, and it is the PO's own sentence (HO-043 §1.1)

> ⛔ **"After `510`, the person's door is bounded and the agent's is not — so an agent may read
> what a person may not, on the same column, through the same function."** ⚠️ **"That is the
> inverse of every ruling this project has made about who may do what, and it arrived by accident
> rather than by decision."**

⚑ **And on why *not a live hole* was not a reason to leave it** (HO-043 §1.3):

> ⛔ **"A rule that holds only because every current writer happens to be correct is not enforced.
> It is a coincidence with good manners."**

⚠️ **The second defect, ruled in the same section** (HO-043 §1.5): `documentBytes` answered
`document-bytes-missing` — *its file is no longer where the app put it* — for a file that is
present and too large. *"The file is gone about a file that is sitting there sends a person
looking for something that is not lost. `unreadable` is the honest relay."*

## ⚠️ What is CORRECT here and therefore carries no row

 - ⛔ **Entitlement.** `mayReadDocument` and the `no-such-document` fold are `380`'s and are right;
   `517` did not widen or narrow who may read a document. `380 M27`–`M29` own those lines. ⚑ What
   `517` owes them is an ORDERING row — `M6` — because a word this dispatch adds would confirm a
   row exists if it were ever said before the fold.
 - ⛔ **`placeResource`'s two arms.** `380 M13`/`M14`/`M15` own the lexical and real comparisons.
   ⚑ Calling that function from `documentBytes` widens what those three rows reach — they now
   break the agent's door too — which is the move working rather than a row `517` needs to write.
 - ⛔ **The hash re-check.** `380 M30` anchors `if (read.sha256 !== record.contentSha256) {` inside
   this very function and was preserved verbatim through the edit.
 - ⛔ **The person's five words.** `510` ruled them and `517` did not add a sixth; `510 M5`/`M8`
   guard the two that discriminate, and both were corrected in place when the arms changed shape.
 - ⛔ **`document-bytes-missing`'s SENTENCE.** It did not change, and that is the repair: it was
   false of five of the six things it answered for, and the rail now means the one it is true of.

## ⛔ The five properties these rows guard

 1. **Both doors narrow through one call** — `M1`, `M12`. ⚑ **`M1` is the only row in this table
    that leaves the PERSON's door correct, and that was measured rather than argued**: applied
    alone it takes `one-rule-one-place.test.ts` to seven failures and leaves
    `the-id-this-app-hands-a-person.test.ts` at **21/21 green**. ⛔ So the new suite is what
    notices the agent's door, which is the property HO-043 §1.1 is about.
    ⚠️ **`M1` and `M12` restore the `placeResource` import in the same edit.** Without it the
    module throws and the row is red because the file broke, which measures nothing — the first
    draft of both rows did exactly that and `M12` fell from one failure to six.
 2. **A row out of the tree gets its own word, and the word is priced honestly** — `M2`, `M3`,
    `M8`, `M11`.
 3. **Absent and present-but-unreadable are two answers** — `M4`, `M5`, `M9`, `M10`.
 4. **Entitlement is still decided before the boundary** — `M6`.
 5. **The refusal names the row and never the path** — `M7`.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| `M1`, `M2`, `M3`, `M7` | `apps/desktop/test/one-rule-one-place.test.ts` §1 |
| `M6` | `apps/desktop/test/one-rule-one-place.test.ts` §2 |
| `M4`, `M5`, `M9` | `apps/desktop/test/one-rule-one-place.test.ts` §3 |
| `M8`, `M10`, `M11` | `apps/desktop/test/one-rule-one-place.test.ts` §4 |
| `M12` | `apps/desktop/test/one-rule-one-place.test.ts` §5 |
| `M5` (also) | `apps/desktop/test/a-document-with-a-number-and-a-hash.test.ts` §7 |
| `M10` (also) | `apps/desktop/test/a-refusal-carries-its-remedy.test.ts` §1 |

⛔ **The table was NOT run.** Every row below was applied ALONE, watched go red against the gate
named above, and restored from bytes with a SHA-256 re-check — which is what
`verify-each-mutation-row` is for and is not the same claim as a table run.

## ⚠️ What is deliberately NOT here

 - ⛔ **No row on the SQL `CHECK` this dispatch refused.** There is nothing to mutate: the decision
   was to write no constraint, and *a mutation that changes nothing reports as a survivor*. The
   price is argued in the response and in `schema.ts`'s own column docblock.
 - ⛔ **No row that deletes the placement WITHOUT restoring the person's copy.** That is `510 M4`,
   corrected in place into this same function rather than retired — and a second table spelling
   one rule is the defect this dispatch is named after.
 - ⚠️ **No row on `readOwnFile`.** It was not touched. Its call sites include two that read
   `document_ingest` columns with the same exposure, and reconciliation's wrong OUTCOME for a
   present-but-blocked canonical file is reported as a finding rather than repaired here.
   ⚑ **521 · both of those were closed, and neither needed this function widened** — the columns
   by `placeAttempt`, the outcome by `somethingStandsAt`, with rows in table `521`. ⛔ *Its four
   call sites* was a count nothing measured and the phrase is retired rather than re-counted.
 - ⚠️ **No row on the prose corrections.** They are sentences, not behaviour; standing rule 19 is
   what makes them correctable, and no mutation can make a docblock false in a way a test sees.
 - ⛔ **No row on this dispatch's own census regeneration.** *A mutation on a census is invisible
   to that census.*
"""

CANON = "apps/desktop/src/main/documents/canonical-document.ts"
REGISTRY = "apps/desktop/src/main/documents/document-registry.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RESOURCES = "apps/desktop/src/main/resources/resources.ts"

# ⚑ The placement, exactly as it stands in `documentBytes` — shared by the rows that remove it.
# ⚑ **Re-anchored in place at `726` (R92)**: `placeResource` answers `why` rather than borrowing the
# ingest's `resource-outside-workspace` (which R92 removed); M1, M2, M5 and M7 move with it, and M3 —
# whose defect WAS that borrowed word — retires with the word.
PLACEMENT = (
    "  const placed = placeResource(root, record.canonicalPath)\n"
    "  if (!placed.ok) {\n"
    "    return {\n"
    "      ok: false,\n"
    "      refusal: refuseDocument(\n"
    "        placed.why === 'outside-the-tree' ? 'document-path-outside-tree' : 'document-bytes-missing',\n"
    "        { document: record.documentId },\n"
    "      ),\n"
    "    }\n"
    "  }\n"
)

# ⚑ The person's door, at the line the boundary used to be asked on.
PERSON_DOOR = "    const bytes = documentBytes(deps.root, record)\n    if (!bytes.ok) {\n"

# ⚑ **The import `517` removed when the last caller in this file went away.** ⛔ Every row that
# puts a `placeResource` call back into the host restores it in the same edit — a mutation that
# left the identifier undefined would be red because the module throws, which measures nothing.
HOST_IMPORT = (
    "import {\n"
    "  refuseDocument,\n"
    "  type DocumentKind,\n"
    "  type DocumentRefusal,\n"
    "} from '../documents/canonical-document'\n"
)
HOST_IMPORT_WITH_PLACE = (
    "import {\n"
    "  placeResource,\n"
    "  refuseDocument,\n"
    "  type DocumentKind,\n"
    "  type DocumentRefusal,\n"
    "} from '../documents/canonical-document'\n"
)

# ⛔ `510`'s shape, put back: the window bounded, the tool not.
PERSON_DOOR_GUARDS = (
    "    const placed = placeResource(deps.root, record.canonicalPath)\n"
    "    if (!placed.ok) {\n"
    "      return {\n"
    "        ok: false,\n"
    "        reason: placed.why === 'outside-the-tree' ? 'outside' : 'unreadable',\n"
    "      }\n"
    "    }\n"
    "    const bytes = documentBytes(deps.root, record)\n"
    "    if (!bytes.ok) {\n"
)

# The resource-outside-workspace refusal no longer exists. Retain its absent anchor as retired
# instead of claiming to test a removed guard.
MUTATIONS = [
    # ── the asymmetry HO-043 §1.1 names ────────────────────────────────────────────────────────
    (
        "M1 · 🔴 the boundary goes back to the WINDOW only · the person's door is bounded and the "
        "agent's is not, so an agent may read what a person may not on the same column through "
        "the same function — `510`'s world, which is the state the PO ruled was backwards",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives and is asserted in one-rule-one-place §1: both doors go through the one reader,
        # resourceBytes, so an agent may not read what a person may not. placeResource and
        # documentBytes are gone, so the plant makes the AGENT door (readResource) read join(root,
        # sha256, name) unbounded through readOfferedResource, an existing host import, and leaves
        # the person's door bounded. Killed by `one-rule-one-place.test.ts`.
        [
            (HOST, '    const read = resourceBytes(root, row)\n    if (!read.ok) return { ok: false, refusal: read.refusal }\n', "    const offered = readOfferedResource(join(root, row.sha256, row.name))\n    if (!offered.ok) return { ok: false, refusal: offered.refusal }\n    const read = {\n      form: offered.form,\n      content: { as: 'markdown' as const, text: offered.bytes.toString('utf8') },\n    }\n"),
        ],
    ),
    # ── the word a row out of the tree gets ────────────────────────────────────────────────────
    (
        "M2 · ⛔ a row that points out of the tree is reported as *the file is gone* · the one "
        "refusal that names a defect in the app's own data is spelled as an ordinary absence, and "
        "nobody looks for it",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives on the merged rail: a row that points out of the tree is
        # `resource-bytes-unreadable` (the separate outside-tree rail was folded into it), and only
        # an absent file is `resource-bytes-missing`. The plant makes the three containment guards
        # in resourceBytes report 'resource-bytes-missing', i.e. 'the file is gone'. Killed by
        # `one-rule-one-place.test.ts`.
        [
            (RESOURCES, "  if (!SHA256_HEX.test(row.sha256) || !isOneSegment(row.name)) {\n    return refused('resource-bytes-unreadable')\n  }\n", "  if (!SHA256_HEX.test(row.sha256) || !isOneSegment(row.name)) {\n    return refused('resource-bytes-missing')\n  }\n"),
            (RESOURCES, "  if (!within(lexicalRoot, lexicalPath)) return refused('resource-bytes-unreadable')\n", "  if (!within(lexicalRoot, lexicalPath)) return refused('resource-bytes-missing')\n"),
            (RESOURCES, "  if (!within(filesystemSpelling(lexicalRoot), realPath)) {\n    return refused('resource-bytes-unreadable')\n  }\n", "  if (!within(filesystemSpelling(lexicalRoot), realPath)) {\n    return refused('resource-bytes-missing')\n  }\n"),
        ],
    ),
    (
        "M3 · 🔴 the boundary reaches for the nearest existing rail · `resource-outside-workspace` "
        "tells a model *that path is not inside the working directory of the conversation that "
        "offered it, so nothing was read and no document was registered* — three clauses, all "
        "three false at a door that took an id for a document that IS registered",
        [
            (
                REGISTRY,
                "          ? 'document-path-outside-tree'\n",
                "          ? 'resource-outside-workspace'\n",
            )
        ],
    ),
    # ── absent, and present-but-unreadable ─────────────────────────────────────────────────────
    (
        "M4 · ⛔ a file that is SITTING THERE is told it is gone · HO-043 §1.5's defect restored — "
        "*its file is no longer where the app put it*, said about a file with the app's own name "
        "on it, which sends its reader looking for something that is not lost",
            # ⚑ **Re-anchored in place by `635`, not retired** (142's rule,
            # `correct-a-stale-mutation-anchor-dont-retire-it`). ⛔ `635` gave `documentBytes` a
            # SECOND `document-bytes-unreadable` arm — a canonical name this build has no word for —
            # so the one-line anchor became AMBIGUOUS and the row went dark. ⚠️ **The DEFECT is
            # unchanged**: the READ-failure arm tells a person a file that is sitting there is gone.
            # ⚑ The anchor now carries the `if (!read.ok)` above it, which is what makes it the
            # read's arm and not the form's.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The split
        # survives: a file that is sitting there but cannot be read (directory, symlink, too large)
        # is `resource-bytes-unreadable`, and HO-043 §1.5's defect was saying 'gone' about it. The
        # plant changes the readOwnFile failure in resourceBytes from 'resource-bytes-unreadable' to
        # 'resource-bytes-missing'. Killed by `one-rule-one-place.test.ts`.
        [
            (RESOURCES, "  if (!read.ok) return refused('resource-bytes-unreadable')\n", "  if (!read.ok) return refused('resource-bytes-missing')\n"),
        ],
    ),
    (
        "M5 · ⚠️ a file that is GONE is told it is present · the split inverted, so a model is sent "
        "to ask a person to look at a name where there is nothing to look at",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The inverse
        # arm of the same split survives: a file that is absent is `resource-bytes-missing`, and
        # only absent. The plant changes the realpathSync.native catch in resourceBytes to answer
        # 'resource-bytes-unreadable'. Killed by `one-rule-one-place.test.ts`.
        [
            (RESOURCES, "    return refused('resource-bytes-missing')\n", "    return refused('resource-bytes-unreadable')\n"),
        ],
    ),
    # ── the ordering the new word depends on ───────────────────────────────────────────────────
    #
    # 🔴 **M6 is RETIRED at `549`, and the subject is gone by RULING** (HO-057). ⛔ Its leak is *a
    # caller who may not read a document is told its row points out of the tree*, and there is no
    # such caller any more — any agent may read any document, in any project. ⚠️ **The ORDERING it
    # protected is gone with it**: `readDocument` asks the registry, then existence, then the bytes,
    # and there is no entitlement left for a boundary to be hoisted above.
    (
        "M6 · 🔴 the boundary is asked BEFORE entitlement · a caller who may not read a document "
        "is told its row points out of the tree, which confirms the row exists — the one leak a "
        "distinct containment word can open, and it is one line away",
        [
            (
                HOST,
                "    const record = this.deps.store.documentRecord(documentId)\n    if (\n",
                "    const record = this.deps.store.documentRecord(documentId)\n"
                "    if (deps !== null && record !== null) {\n"
                "      const early = documentBytes(deps.root, record)\n"
                "      if (!early.ok) return { ok: false, refusal: early.refusal }\n"
                "    }\n"
                "    if (\n",
            )
        ],
    ),
    # ── what the refusal may carry ─────────────────────────────────────────────────────────────
    (
        "M7 · ⛔ the refusal quotes the offending PATH · `380` keeps the canonical tree's spelling "
        "off every wire because it is the one string a caller may not use, and a refusal ABOUT "
        "that string hands it over to prove its point",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — 380's rule
        # survives in resourceBytes' docblock ('The detail carries the resource id and nothing
        # else... a refusal that quoted the path would hand the tree's spelling over'). The plant
        # adds the kept path to the refusal detail; it uses join(root, ...) rather than lexicalPath,
        # which is still in its temporal dead zone when `refused` is defined. Killed by
        # `one-rule-one-place.test.ts`.
        [
            (RESOURCES, '    refusal: refuseResource(rail, { resource: row.resource }),', '    refusal: refuseResource(rail, {\n      resource: row.resource,\n      path: join(root, row.sha256, row.name),\n    }),'),
        ],
    ),
    # ── the two sentences, and what they promise ───────────────────────────────────────────────
    (
        "M8 · ⚠️ the boundary sentence drops the clause that says not to come back · `424`'s rule "
        "is that a caller reading only the app's failure has no way to know whether retrying "
        "helps, and here it never will",
            # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads (675 §1); The DEFECT this row plants is unchanged.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The separate
        # boundary sentence ('No call you can make moves it back inside') went with its rail,
        # because an out-of-tree row is now `resource-bytes-unreadable`. The 424 rule (a caller must
        # be able to tell that retrying will not help) lives on in that rail's sentence, 'Asking
        # again will not help until a person has looked at what stands where this app keeps it.', so
        # the plant drops that clause. Killed by `one-rule-one-place.test.ts`.
        [
            (RESOURCES, " Asking again will not help until a person has looked at what stands where this app keeps it.',", "',"),
        ],
    ),
    (
        "M9 · 🔴 the unreadable sentence claims the file is gone again · the rail is split and the "
        "words are not, which is the same lie arriving through the other half of the repair",
            # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads (675 §1); The DEFECT this row plants is unchanged.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The unreadable
        # sentence must not claim the file is gone; its words were split along with its rail and the
        # tests still assert the false claim is absent. The plant swaps the opening of the
        # `resource-bytes-unreadable` sentence for the missing rail's 'no longer where this app
        # keeps it' claim. Killed by `one-rule-one-place.test.ts`.
        [
            (RESOURCES, "    'that resource could not be read, so nothing was returned.", "    'that resource is recorded, but its file is no longer where this app keeps it, so nothing was returned."),
        ],
    ),
    (
        "M10 · ⛔ *something is standing at that name* promises a retry · `while-this-holds` means "
        "the identical call may work later without anybody acting, and nothing the caller does "
        "clears a directory somebody planted inside this app's own tree",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The pricing
        # survives: `resource-bytes-unreadable` is 'until-a-person-changes-it', never
        # 'while-this-holds', because nothing the caller does clears what stands at that name. The
        # plant flips its RESOURCE_PERMANENCE entry, which also flips its derived retryable flag.
        # Killed by `one-rule-one-place.test.ts`.
        [
            (RESOURCES, "  'resource-bytes-unreadable': 'until-a-person-changes-it',", "  'resource-bytes-unreadable': 'while-this-holds',"),
        ],
    ),
    (
        "M11 · ⚠️ the two new rails take ONE price · a row out of the tree is nobody's to repair "
        "through this app and a blocked name is a person's, so a pair that agreed would mean one "
        "of the two was never argued",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The two-price
        # rule survives on the new pair: §4 asserts `resource-bytes-missing` is 'permanent' and
        # `resource-bytes-unreadable` is 'until-a-person-changes-it', because 'a pair that agreed
        # would mean one of them is unargued'. The plant gives the missing rail the unreadable
        # rail's price. Killed by `one-rule-one-place.test.ts`.
        [
            (RESOURCES, "  'resource-bytes-missing': 'permanent',", "  'resource-bytes-missing': 'until-a-person-changes-it',"),
        ],
    ),
    # ── one rule, one place ────────────────────────────────────────────────────────────────────
    (
        "M12 · 🔴 the placement is spelled TWICE · the guard stays in `documentBytes` AND the "
        "person's door keeps its own copy, so nothing a person or an agent can observe changes "
        "and the only thing that notices is a census — `169` §1, and the reason this table has a "
        "row whose whole subject is a second spelling",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The 'placement
        # exists once' census survives as one-rule-one-place §5: resourceBytes places, and the host
        # contains no `within(` and no `realpathSync`. The plant gives the person's door its own
        # second copy of the placement, using a local `within` helper so it cannot throw and so
        # behaviour does not change: an escaping row still answers 'unreadable' and the census is
        # the only thing that notices. Killed by `one-rule-one-place.test.ts`.
        [
            (HOST, '    const read = resourceBytes(root, row)\n    if (!read.ok) {\n', "    const within = (parent: string, child: string): boolean =>\n      child === parent || child.startsWith(`${parent}/`)\n    if (!within(join(root, row.sha256), join(root, row.sha256, row.name))) {\n      return { ok: false, reason: 'unreadable' }\n    }\n    const read = resourceBytes(root, row)\n    if (!read.ok) {\n"),
        ],
    ),
]
