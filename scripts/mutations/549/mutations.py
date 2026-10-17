"""549 · Two withdrawals — open what was scoped.

🔴 **Two PO rulings, landed together because they are the same argument and the same rails file.**

> ⚑ **HO-057, in `HO-097` §2.2's wording (`635`):** *Any agent may read any document in any
> project. When a project can be finished, finishing it never narrows who may read its documents.*
> — *A project
> scopes ACTIVITY. It does not scope KNOWLEDGE.*
>
> ⚑ **HO-058 §1:** *`can_message` defaults to everyone, across projects.* — *A message consumes
> nothing, destroys nothing, and transfers no authority.*

## ⛔ A · what a WIDENING's rows have to be about

⚠️ **A table for a dispatch that removes a rail cannot mutate the rail it removed.** There is no
`mayReadDocument` left to break, and `380 M27`-`M29` — the three rows that WERE about it — are
retired in this commit with the measurement quoted. ⛔ **So every row here is about a property the
widening had to KEEP**, and each one puts back a narrower or wider world than HO-057 and HO-058
ruled.

## 🔴 B · the two halves that must not be conflated

⚑ **`M4`-`M7` are the LISTING**, which is the half of HO-057 that did NOT become unconditional:
*an agent asking "what documents exist" gets its own project's … reaching wider is asking for it.*
⛔ **A listing that returned every document in the app by default is not this ruling**, and it is
the easiest thing in this dispatch to get wrong in the quiet direction.

## ⚠️ C · what this table does NOT cover, and where it is covered

 1. **The hash.** ⛔ `380 M30` anchors `if (read.sha256 !== record.contentSha256) {` inside
    `documentBytes`, and it is UNMOVED by this dispatch — which is the whole of HO-057 §1.4. ⚑ A
    second row here would be two rows on one line.
 2. **`no-such-document`'s permanence.** `424 M16` owns it; `549` changed that word's DERIVATION
    and not the word, so the row still applies exactly.
 3. **`REACHES_WHAT_IT_DID_NOT_START`'s table.** `431 M4`/`M13` own both arms and neither moved.
 4. **The published inventory.** *No tool queues work for somebody not named yet* is an exhaustive
    `Record<ToolName, …>` in `the-five-tools.test.ts`, which is a COMPILE error before any suite
    runs — a stronger instrument than a row.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
CANON = "apps/desktop/src/main/documents/canonical-document.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
CAPS = "apps/desktop/src/shared/capabilities.ts"
RESOURCES = "apps/desktop/src/main/resources/resources.ts"

MUTATIONS = [
    # ---- A · the read, and the fold that was unpicked ----------------------------------------
    (
        "M1 · 🔴 **MAIN'S BEHAVIOUR, PUT BACK** · the read asks who is calling again — a document "
        "whose source session is not this caller is refused, which is `mayReadDocument`'s first two "
        "arms without the third. ⛔ HO-057 is *any agent, any project*, so every "
        "cross-project read in the suite goes red and the same-project control stays green",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — HO-057
        # survives for resources, carried into `readResource`: 'it asks NOTHING about who is
        # calling', so any agent may read any resource. The plant uses `row.addedBy !== null`, the
        # resource analogue of the old `sourceSessionId !== null`, so a resource an agent kept is
        # refused as absent. The anchor is the `no-such-resource` arm of `readResource`. Killed by
        # `two-withdrawals-open-what-was-scoped.test.ts`, `one-rule-one-place.test.ts`.
        [
            (HOST, "    if (row === null) {\n      return { ok: false, refusal: refuseResource('no-such-resource', { resource: resourceId }) }", "    if (row === null || row.addedBy !== null) {\n      return { ok: false, refusal: refuseResource('no-such-resource', { resource: resourceId }) }"),
        ],
    ),
    (
        "M2 · ⛔ the registry's absence is folded back into `no-such-document` · HO-057 §3.2's unpick "
        "reversed. ⚠️ **A disguise whose purpose has gone** — *this app has no documents tree* and "
        "*there is no such document* become one answer again, and the only caller it still lies to "
        "is a model deciding whether to stop",
                # ⚠️ **Three lines, because the one-line anchor matches `registerDocument`'s arm
                # too** — found by the dry run, which is what that step is for.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives in `readResource`: a host with no resources tree answers
        # `resource-store-unavailable`, its own word, not `no-such-resource` (HO-057 §3.2). The
        # registry check is now `this.deps.resourcesRoot?.()`, and the one-line refusal also appears
        # in `keptForAReply`, so the anchor runs through the following `const row = ...` line.
        # Killed by `one-rule-one-place.test.ts`.
        [
            (HOST, "    if (root === undefined) {\n      return { ok: false, refusal: refuseResource('resource-store-unavailable') }\n    }\n    const row = this.deps.store.resource(resourceId)", "    if (root === undefined) {\n      return { ok: false, refusal: refuseResource('no-such-resource', { resource: resourceId }) }\n    }\n    const row = this.deps.store.resource(resourceId)"),
        ],
    ),
    (
        "M3 · ⚠️ the refusal SENTENCE promises the rule again · the model-facing half of the same "
        "withdrawal. ⛔ **Standing rule 8**: a sentence that DESCRIBES a capability drifts every "
        "time the capability changes, and this is the exact string HO-057 made false",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the `no-such-resource` sentence is model-facing text and must not promise an
        # entitlement that HO-057 withdrew. The string moved from canonical-document.ts to
        # `RESOURCE_REASONS` in resources.ts and now says 'there is no resource by that id, so
        # nothing was returned.'. The plant restores the 'you may read ... an agent you spawned'
        # promise. Killed by `one-rule-one-place.test.ts`.
        # ⚑ Landing PE-006, D-018 and D-025 · re-anchored in place, not retired — PE-006 (3c0c4280)
        # reworded `no-such-resource` to 'check the id in the reply or piece record. There is no
        # resource by the id you gave, ...', so the old one-line anchor is gone. The rule survives:
        # one-rule-one-place.test.ts still asserts the absent-resource reason does not contain 'you
        # may read' or 'spawned', which are the entitlement HO-057 withdrew. The plant puts that
        # promise back, and the new sentence passes the test only because it does not make it.
        # Killed by `one-rule-one-place.test.ts`.
        [
            (RESOURCES, "  'no-such-resource':\n    'check the id in the reply or piece record. There is no resource by the id you gave, so nothing was returned and retrying that id cannot work.',", "  'no-such-resource':\n    'there is no resource by that id that you may read, so nothing was returned. A resource kept by you, or by an agent you spawned, is one you may read.',"),
        ],
    ),
    (
        "M4 · ⛔ the tool's DESCRIPTION keeps the one-hop rule · `370`'s eight false sentences, "
        "shape for shape. ⚑ A model told it may read *a document you registered, and one registered "
        "by an agent you spawned* does not go and ask for one it was handed the id of, so the "
        "widening ships and nothing uses it",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives:
        # `read_document`'s description must not state an entitlement narrower than 'any document'.
        # D-016 removed only ', in any project' from the sentence, so the old one-line anchor no
        # longer matches. I use the short clause `Any document — you do not have to have registered
        # it, and list_documents says which exist.` and put the one-hop sentence in its place.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives on `read_document`'s description: it must not state an entitlement narrower than
        # 'any resource'. The description now opens 'Read a resource this app keeps for a piece of
        # work — a file an agent handed back with its reply.'. The plant puts the one-hop sentence
        # in its place. Killed by `two-withdrawals-open-what-was-scoped.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule holds: read_document's description must not state an entitlement narrower than any
        # resource. D-016c reworded the first sentence to name an input its giver handed over, or a
        # file the agent holding it kept or handed back, so the old anchor stopped matching. The
        # full first sentence matches once. The plant puts the one-hop sentence in its place. Killed
        # by `two-withdrawals-open-what-was-scoped.test.ts`.
        [
            (TOOLS, 'Read a resource this app keeps for a piece of work — an input its giver handed over, or a file the agent holding it kept or handed back with its reply.', 'You can read a resource you kept, and one kept by an agent you gave work to.'),
        ],
    ),
    # ---- B · the LISTING, which is the half that did not become unconditional -----------------
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The defect is now the decision. The
        # commit says 'list_documents takes no argument' and the card says the same.
        # `listDocuments()` returns `store.everyDocument()`, and its doc comment says 'every
        # document this app registered ... the projects a listing was once scoped to are gone', so
        # an app-wide listing by default is the only behaviour left. The row's subject, the caller's
        # own project deciding the answer, is gone with projects. Its anchor is left stale, so the
        # census records it retired.
        "M5 · 🔴 **the listing goes APP-WIDE by default** · the quiet direction, and the one the "
        "brief names: *a listing that returns every document in the app by default is not this "
        "ruling.* ⛔ The caller's own project stops deciding anything and every answer is every "
        "document this app holds",
        [
            (
                HOST,
                "    const named = project === null ? mine : foldProfileName(project)\n"
                "    if (named === null) {\n"
                "      return { project: null, scope: 'your-project', documents: [] }\n"
                "    }",
                "    const named = project === null ? mine : foldProfileName(project)\n"
                "    if (named === null) {\n"
                "      return { project: null, scope: 'your-project', documents: [] }\n"
                "    }\n"
                "    if (project === null) {\n"
                "      return {\n"
                "        project: named,\n"
                "        scope: 'your-project',\n"
                "        documents: this.deps.store\n"
                "          .projects()\n"
                "          .flatMap((row) => this.deps.store.documentsIn(row.slug)),\n"
                "      }\n"
                "    }",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** There is no 'pinned default project'
        # to plant. `listDocuments()` takes no caller and reads no `identityOf(...).projectSlug`,
        # and the row's anchor line is deleted. D-016 removed projects as something a caller works
        # in, and the 'a caller in another project is told it is the project you are working in'
        # answer no longer exists. Its anchor is left stale, so the census records it retired.
        "M6 · ⛔ the default project becomes the PINNED one · a caller working anywhere else is "
        "answered about `default` and told it is *the project you are working in*. ⚑ It is the "
        "shape that passes every assertion taken from a conversation that happens to be in the "
        "pinned project — `a-comparison-tested-where-both-sides-agree-measures-nothing`",
        [
            (
                HOST,
                "    const mine = this.deps.store.identityOf(askedBy)?.projectSlug ?? null",
                "    const mine = DEFAULT_PROJECT_ID as string | null",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the `covers`
        # sentence of the `list_documents` answer, and the tool is gone. Commit 5e931be8 says
        # 'list_documents is gone and read_document reads a resource'. The killer test's docblock
        # says '`list_documents` went with the registry, so the listing §2 measured has no subject
        # and §2 is gone'. No other tool answers 'which place is this list of'. Its anchor is left
        # stale, so the census records it retired.
        "M7 · ⚠️ the answer stops saying WHICH place it is of · `448`'s defect, one subject over: a "
        "caller that left the argument out and one that named its own project get the same rows, "
        "and *there are two documents* is a true sentence about a project and a false one about the "
        "app. ⛔ With one word for both, no model can write a true sentence from this payload",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — After D-016a `list_documents` has one place, so `scope: your-project`
        # versus `the-one-you-named` is gone. The rule that the answer says WHICH place its count is
        # of (448) now lives in `count_covers`, which `covers` supplies for both the structured
        # answer and the first text line. The plant leaves the count intact but stops saying what it
        # counts, so a model could relay a true-sounding sentence about the wrong population. It is
        # red today on `two-withdrawals-open-what-was-scoped.test.ts`
        # (`expect(listed.count_covers).toContain('every document registered in this app')`) and on
        # the empty-listing assertion in
        # `a-task-number-names-no-project-and-comes-from-default.test.ts`. The anchor is unique and
        # n
        [
            (TOOLS, "          const covers = 'every document registered in this app, oldest first'", "          const covers = 'the documents this list holds'"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is the
        # `list_documents` projection that must not spread a `DocumentRecord` (with
        # `canonical_path`) onto the wire. Commit 5e931be8 says 'list_documents is gone and
        # read_document reads a resource', and c3-spec.md says '`list_documents` is deleted with
        # `host.listDocuments` and `store.everyDocument`'. The successor `read_document` builds its
        # answer from named fields, and a `ResourceRow` carries no path, so a spread there cannot
        # leak the string and would survive as a mutation. Its anchor is left stale, so the census
        # records it retired.
        "M8 · 🔴 the projection is replaced by a SPREAD of the row · `380`'s rule, at the newest "
        "door: `DocumentRecord` carries `canonical_path`, which is the one string this app keeps "
        "off every wire — and the tree is inside `protectedRoots` precisely so an agent cannot name "
        "it. ⛔ A spread hands it over",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives and is
        # asserted: `list_documents` must project the row and never spread it, because
        # `DocumentRecord.canonicalPath` is the one string kept off every wire. Only the receiver
        # changed, from `listing.documents.map` to `listing.map`, because `listDocuments()` now
        # returns the bare array.
        [
            (TOOLS, '          const documents = listing.map((record) => ({\n            document: record.documentId,', '          const documents = listing.map((record) => ({\n            ...record,\n            document: record.documentId,'),
        ],
    ),
    (
        "M9 · ⛔ discovery is GATED on `can_message` · HO-057 §3.1's *nothing refuses; the default "
        "is helpfulness, not permission*, reversed. ⚠️ It re-scopes KNOWLEDGE by an ACTIVITY grant, "
        "which is the sentence the ruling withdrew — and it is invisible while the ruled default is "
        "wide, so the killer is a caller a person NARROWED",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives:
        # discovery asks no grant, and the killer test narrows `can_message` to `none` and expects
        # `list_documents` to still answer. The old anchor is gone because
        # `host.listDocuments(project ?? null, me)` is now `host.listDocuments()`. The plant needs
        # `'message'` and not `'read'`: `MESSAGING_ACTS` is now `['message','assign']`, so
        # `mayReachAtAll('read', by)` would look up undefined tables, return null and stay green for
        # the wrong reason. `host`, `by`, `answer` and `carryMessageRefusal` are all in scope in
        # `agentToolsFor`.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # The label (discovery gated on can_message) named list_documents, which is gone. The
        # surviving reader is read_document in agent-tools.ts, which by rule has no standing wall.
        # Plant: put a can_message wall (host.mayReachAtAll('message', by), refused with
        # carryMessageRefusal) in front of host.readResource in the read_document handler. Killer:
        # the census in the-doors-our-own-verbs-do-not-need.test.ts ('the doors that ask a wall ask
        # it FIRST, and the ones with no wall do not ask at all'), whose complement loop asserts
        # 'read_document has no standing wall' with
        # not.toMatch(/host\.may(CreateAgents|ReachAtAll)\(/) over the first 700 chars of each
        # door's body; I emulated the regex in memory and it matches with the plant and not without
        # it. Honest gap: this is a structural census. No behaviour test narrows can_message to none
        # and calls read_document (two-withdrawals-open-what-was-scoped.test.ts section 6 reads with
        # the default set only); that behaviour test is missing, and its paired positive would be
        # the same caller with can_message default reading the document. Killed by
        # `the-doors-our-own-verbs-do-not-need.test.ts`.
        [
            (TOOLS, '          const read = host.readResource(resource)\n', "          const wall = host.mayReachAtAll('message', by)\n          if (wall !== null) {\n            return answer(carryMessageRefusal(wall), `refused (${wall.rail}): ${wall.reason}`)\n          }\n          const read = host.readResource(resource)\n"),
        ],
    ),
    # ---- C · the messaging default, and the field beside it that must not move ----------------
    (
        "M10 · 🔴 **MAIN'S BEHAVIOUR, PUT BACK** · `can_message` rules to `same-project` again. ⛔ "
        "HO-058 §1 is *defaults to everyone, across projects*; with the word back, every identity a "
        "person has not granted reaches only what it started, and the freshly created agent of §6 "
        "cannot send a message without somebody opening a sheet",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule still holds: canMessage
        # `ruled: 'any'` is untouched by D-014, which made canAssignWork `ruled: 'any'` as well. The
        # old anchor now matches twice (canMessage and canAssignWork). Re-verified RED alone.
        [
            (CAPS, "    ruled: 'any',\n    narrowest: 'none',\n    vocabulary: [...MESSAGING_REACH],\n    whenItTakesEffect: null,\n  },\n  {\n    key: 'canAssignWork',", "    ruled: 'same-project',\n    narrowest: 'none',\n    vocabulary: [...MESSAGING_REACH],\n    whenItTakesEffect: null,\n  },\n  {\n    key: 'canAssignWork',"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** canInterrupt was deleted from
        # CAPABILITY_FIELDS, and the can_interrupt column is "unread and unwritten" (commit). The
        # commit also says "End and interrupt reach the chain below the caller, with no grant and no
        # project floor", so no grant is left to widen. Its anchor is left stale, so the census
        # records it retired.
        "M11 · ⛔ `can_interrupt` is widened WITH it · the one thing HO-058 §2.1 says must not move, "
        "moved: *a reach grant lets you speak; only a command relationship lets you destroy "
        "in-flight work* (HO-026 §2). ⚑ Two columns, two gates — and this makes them one",
        [
            (
                CAPS,
                "    ruled: 'same-project',\n"
                "    narrowest: 'none',\n"
                "    vocabulary: [...MESSAGING_REACH],\n"
                "    whenItTakesEffect: null,\n"
                "  },\n"
                "  {\n"
                "    key: 'canCreateAgents',",
                "    ruled: 'any',\n"
                "    narrowest: 'none',\n"
                "    vocabulary: [...MESSAGING_REACH],\n"
                "    whenItTakesEffect: null,\n"
                "  },\n"
                "  {\n"
                "    key: 'canCreateAgents',",
            )
        ],
    ),
]
