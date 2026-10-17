"""503 · who answered it — HO-037 §2, Slice 5.

⛔ **The ruling:** *"The Requests surface shows who answered."*

⚑ **And the PO's reason, which is what every row here is really about:** *"A person can only ever
have answered a permission, but a question may have been answered by a parent agent. So the actor
is what distinguishes* I decided this *from* the project manager handled it *— which is the
escalation picture, on the surface where the escalation lands."*

## 🔴 The one property

⛔ **A settled request says what the LEDGER says about who answered it — no more, no less, and
never something a surface composed.** `UserDecisionEvent.by` is derived from the caller at the
moment the answer is taken (`477`); the fold carries it onto the card; the card draws the
vocabulary's own word. ⚠️ **Three populations and three different answers**: an actor, `465`'s
sentence for a row written before `477`, and NOTHING at all for a card a teardown settled — which
nobody answered, so neither of the other two is true of it.

## ⚠️ The fail-safe direction

⛔ **The dangerous default is the one that credits a person with a decision they never made**
(`413` §3). ⚑ Every row that can go either way goes that way here: the absent arm never names an
actor (`M11`), never goes blank (`M10`), and never reaches a card nobody answered (`M6`, `M7`).

## ⛔ The id, and where it may appear

🔴 **`413` §4 puts the answering conversation's id *"HERE and nowhere a person reads"*** — the
Events tab is the ledger made readable, a request card is not. ⚑ `didIt` draws the id and
`whoAnsweredIt` draws the KIND, and `M8` is the one edit that collapses the two.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| M1, M2 | `apps/desktop/test/who-answered-it.test.ts` §1 — the row, censused and driven |
| M3, M4, M5 | …the same file's §2, the fold |
| M6, M7 | `apps/desktop/test/dom/who-answered-it.dom.test.ts` §1 + §2, the third population |
| M8 | …the dom file's §2, and the node file's §3 |
| M9, M10, M11, M12, M13 | `apps/desktop/test/who-answered-it.test.ts` §3, the words |
| M14, M15 | …§4, the map — and `the-bar-and-the-shelf.test.ts` §2 with it |

## ⛔ What this table deliberately does NOT contain

 - ⛔ **No row on `proposal_ended.by`.** `477` wrote that field too and no surface draws it yet;
   a row here would guard a rule this dispatch did not build. ⚠️ It is reported as a finding
   instead, which is where a deferral belongs.
 - ⚠️ **No row restoring the digest's own copy of `465`'s sentence.** The bytes would be identical,
   and *a mutation that changes nothing reports as a survivor*. `M13` measures the same seam by
   changing the VERB the digest asks for, which is a difference a reader can see.
 - ⚠️ **No row on `requireToAnswer` or `mayAnswerAsAHuman`.** Those rails are `340`'s and `477`'s
   and are already carried by `the-grant-nobody-can-give.test.ts`; pinning one rule in two tables
   is how a verdict comes to be inherited rather than earned.
 - ⛔ **No CSS row.** The clause's `flex: 0 0 auto` and `white-space: nowrap` are measured by the
   dom file's §3, but every mutation of them a person could notice also changes nothing a box
   measurement can catch at the one width the cell mounts — *a style mutation's control is the
   state it falls back to*, and that fallback is here indistinguishable.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
FOLD = "apps/desktop/src/renderer/src/lib/transcript.ts"
WORDS = "apps/desktop/src/shared/who-did-it.ts"
DIGEST = "apps/desktop/src/main/runtime/digest.ts"
CARD = "apps/desktop/src/renderer/src/components/PermissionCard.vue"
QUESTION = "apps/desktop/src/renderer/src/components/UserInputCard.vue"
MAP = "apps/desktop/src/renderer/src/lib/design-v2-map.ts"

MUTATIONS = [
    # ── the row: what the ledger records ────────────────────────────────────────────────────────
    (
        "M1 · ⛔ the permission door stops recording who answered · every approval and every refusal "
        "a person makes lands in the ledger as a row nobody is recorded as having written, and the "
        "card draws `465`'s sentence over a decision taken thirty seconds ago — the discontinuity "
        "HO-029 §2.2 describes, reopened forwards",
        [
            (
                HOST,
                "      outcome: decision.outcome,\n      by: whoDidIt(by),\n",
                "      outcome: decision.outcome,\n",
            )
        ],
    ),
    (
        "M2 · 🔴 the routed answer CLAIMS a person · a parent agent's answer to its worker's question "
        "is written as a person's, so the one distinction the PO asked this surface to make — *I "
        "decided this* from *the project manager handled it* — is inverted at the exact door `463` "
        "F1 came through",
        [
            (
                HOST,
                "      // beside it gives: one row, and now it says which of the two doors wrote it.\n"
                "      by: whoDidIt(by),\n",
                "      // beside it gives: one row, and now it says which of the two doors wrote it.\n"
                "      by: { who: 'a-person' },\n",
            )
        ],
    ),
    # ── the fold: what reaches the card ─────────────────────────────────────────────────────────
    (
        "M3 · ⛔ the permission fold drops the actor · the row knows and the card does not, so every "
        "settled permission reports the ledger as silent about an answer the ledger names",
        [
            (
                FOLD,
                "        markPermissionAnswered(state, event.requestId, event.outcome, event.by)\n",
                "        markPermissionAnswered(state, event.requestId, event.outcome)\n",
            )
        ],
    ),
    (
        "M4 · ⚠️ the question fold drops it · the same silence on the card where the actor actually "
        "varies — a parent agent's answer and a person's become indistinguishable, which is the "
        "state `465` had to narrow the digest for",
        [
            (
                FOLD,
                "        markUserInputAnswered(state, event.requestId, event.outcome, event.by)\n",
                "        markUserInputAnswered(state, event.requestId, event.outcome)\n",
            )
        ],
    ),
    (
        "M5 · 🔴 the actor is assigned only when the row names one · a decision superseded by a row "
        "written before `477` keeps the earlier actor, so the card attributes a decision to somebody "
        "the ledger does not — `whoCancelledIt`'s *assigned whether or not it names anybody*, "
        "reversed",
        [
            (
                FOLD,
                "    item.outcome = outcome\n"
                "    item.note = null\n"
                "    item.refused = null\n"
                "    item.by = by\n",
                "    item.outcome = outcome\n"
                "    item.note = null\n"
                "    item.refused = null\n"
                "    if (by !== undefined) item.by = by\n",
            )
        ],
    ),
    # ── the cards: the third population ─────────────────────────────────────────────────────────
    (
        "M6 · ⛔ the permission card draws the clause over a card nobody answered · a teardown-settled "
        "request reports *nothing in the ledger records who answered it* about an answer that was "
        "never given — a true-sounding sentence about the wrong population, which is the shape "
        "criterion 18 exists to stop",
        [
            (
                CARD,
                "const answeredBy = computed(() =>\n"
                "  props.item.outcome === null ? null : whoAnsweredIt(props.item.by),\n"
                ")\n",
                "const answeredBy = computed(() => whoAnsweredIt(props.item.by))\n",
            )
        ],
    ),
    (
        "M7 · ⚠️ the question card keys on SETTLED instead of ANSWERED · `074`'s exact defect one "
        "field over — the flag that is true of a card nobody answered driving a sentence about who "
        "answered it",
        [
            (
                QUESTION,
                "const answeredBy = computed(() =>\n"
                "  props.item.answered === null ? null : whoAnsweredIt(props.item.by),\n"
                ")\n",
                "const answeredBy = computed(() =>\n"
                "  settled.value ? whoAnsweredIt(props.item.by) : null,\n"
                ")\n",
            )
        ],
    ),
    # ── the words ───────────────────────────────────────────────────────────────────────────────
    (
        "M8 · 🔴 the card's clause draws the conversation's ID · `413 §4`'s *the id is printed HERE "
        "and nowhere a person reads*, broken by collapsing the two phrasings into one — a person "
        "reading back a settled question meets `sess_503_3` where the vocabulary has a word",
        [
            (
                WORDS,
                "  return actor === undefined ? nothingRecordsWho('answered', 1) : `by ${whoDidItSays(actor.who)}`\n",
                "  return actor === undefined ? nothingRecordsWho('answered', 1) : `by ${didIt(actor)}`\n",
            )
        ],
    ),
    (
        "M9 · ⛔ a word off a replayed ledger indexes the table directly · a row written by a build "
        "whose vocabulary has moved draws the string `undefined` on the Events tab and on the card "
        "— `isWhoDidIt`'s own stated reason for existing, undone",
        [
            (
                WORDS,
                "  return actor.who === 'an-agent' ? actor.agent : whoDidItSays(actor.who)\n",
                "  return actor.who === 'an-agent' ? actor.agent : WHO_DID_IT_SAYS[actor.who]\n",
            )
        ],
    ),
    (
        "M10 · ⚠️ the absent arm goes blank · the brief's *do not draw a blank* — a row written "
        "before `477` renders as an empty space beside the verdict, which reads as a fact the app "
        "forgot rather than as one it never had",
        [
            (
                WORDS,
                "  return actor === undefined ? nothingRecordsWho('answered', 1) : `by ${whoDidItSays(actor.who)}`\n",
                "  return actor === undefined ? '' : `by ${whoDidItSays(actor.who)}`\n",
            )
        ],
    ),
    (
        "M11 · 🔴 THE DEFECT the fail-safe direction exists to prevent · the absent arm names a "
        "person, so every decision this app made before `477` is attributed to whoever is reading "
        "it — `413 §3`'s *the dangerous default is the one that credits a person with words they "
        "never wrote*, on a decision instead of a turn",
        [
            (
                WORDS,
                "  return actor === undefined ? nothingRecordsWho('answered', 1) : `by ${whoDidItSays(actor.who)}`\n",
                "  return actor === undefined\n"
                "    ? `by ${WHO_DID_IT_SAYS['a-person']}`\n"
                "    : `by ${whoDidItSays(actor.who)}`\n",
            )
        ],
    ),
    (
        "M12 · ⛔ `465`'s sentence drifts · the one sentence HO-029 §2.2 says stays right for that "
        "population for ever, reworded — and the digest, which now composes it from here, drifts "
        "with it in the same edit",
        [
            (
                WORDS,
                "  return `Nothing in the ledger records who ${verb} ${count === 1 ? 'it' : 'them'}`\n",
                "  return `No actor was recorded for ${count === 1 ? 'it' : 'them'}`\n",
            )
        ],
    ),
    (
        "M13 · ⚠️ the digest asks for the wrong verb · an answered request is reported as one nobody "
        "*settled*, which is the proposal's word — the two populations `477` deliberately counts "
        "apart, said with one sentence",
        [
            (
                DIGEST,
                "  return count === 0 ? '' : ` ${nothingRecordsWho(verb, count)}.`\n",
                "  return count === 0 ? '' : ` ${nothingRecordsWho('settled', count)}.`\n",
            )
        ],
    ),
    # ── the map, which is where the stale claims lived ───────────────────────────────────────────
    (
        "M14 · 🔴 the actor slot is re-filed as a hole · the artefact `389 §1` says every drawn fact "
        "resolves through goes back to saying the product records no actor — the sentence `494` F2 "
        "found false, restored to the one file a surface would inherit it from",
        [
            (
                MAP,
                "    path: 'requests[].actor',\n    kind: 'fact',\n    binding: {\n      state: 'derived',\n",
                "    path: 'requests[].actor',\n    kind: 'fact',\n    binding: {\n      state: 'hole',\n",
            )
        ],
    ),
    (
        "M15 · ⛔ the v2.3 sentence goes back to `false` · the audit reports *nothing is attributed to "
        "anybody* about a product that attributes every decision it records, and names no source for "
        "a claim the code supports — rule 19's corollary, undone",
        [
            (
                MAP,
                "    verdict: 'supported',\n"
                "    where: 'requestsView() — the muted line',\n"
                "    renderFrom: [ref(IPC, 'UserDecisionEvent'), ref(IPC, 'TranscriptEvent')],\n",
                "    verdict: 'false',\n"
                "    where: 'requestsView() — the muted line',\n"
                "    renderFrom: [],\n",
            )
        ],
    ),
]
