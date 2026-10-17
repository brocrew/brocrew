"""497 · two sentences that were never ours.

🔴 **HO-035 withdrew *"Agents never merge"* and *"PROD is read-only"* as PRODUCT INVARIANTS.** They
were one person's working discipline, read as properties of the product; the PO retracted the
premise, so there is no defect to blame and the dispatch is a sweep, a repair and a report.

⛔ **The rows fall into three kinds, and the third is the unusual one.**

| rows | what they protect |
|---|---|
| `M1`–`M3` | the two withdrawn words stay out, and the LIST that keeps them out is itself pinned |
| `M4`–`M9` | the three sentences the PO's vacation test moved — in both directions |
| `M10`, `M11` | the two EXEMPTIONS the lens flagged and the repair kept, so neither can be taken silently |
| `M12` | `364`'s measurement, which SURVIVED the withdrawal and lives in the development guide |

## ⚠️ `M4`–`M9` are two defects per sentence, not one

⛔ **A widening can fail by not happening, and it can fail by taking the rule with it.** `364`'s own
trap, restated by this dispatch's brief: *"a sweep that removes the rule and the finding together
deletes the only written record."* ⚑ So each repaired sentence gets a row that puts the domain noun
back (`M4`, `M6`, `M8`) **and** a row that keeps the generic wording while deleting the instruction
underneath it (`M5`, `M7`, `M9`) — the over-deletion this dispatch's own adversarial review named as
the likeliest way to get the repair wrong.

## 🔴 `M10` and `M11` defend sentences the lens FLAGGED, which is deliberate

⚠️ **Two candidates survived the lens and were kept anyway**, each with its reason written into
`the-text-a-child-is-actually-told.test.ts` §1.5's docblock: *"how to build and test here… what is
flaky"* (the criterion before the em-dash is domain-free and self-sufficient, and build/test
commands are the highest-yield thing a coding agent re-derives every session) and *"Do not
implement"* (ordinary English for carrying out a plan). ⛔ **An exemption with no row is a gap**: the
rows make a later widening arrive as a red test at the decision rather than as a diff nobody reads.

## ⛔ What this table deliberately does NOT contain

⛔ **No row re-introducing the withdrawn sentence into `COMMON_RULES`.** `377 M1` was RE-AIMED to
exactly that by this dispatch — its premise was overturned, not its anchor — and a second copy here
would kill on the same assertion and tell this dispatch nothing (`301` §5).

⛔ **No row reordering `## Rules` and `## Your own instructions`.** The ordering is already pinned by
`the-text-a-child-is-actually-told.test.ts` §3's index comparison; a row on it would measure
somebody else's assertion.

⛔ **No row weakening §1.5's word list.** ⚠️ **A mutation on a census is invisible to that census** —
deleting `code` from `NOT_ONE_DOMAIN` makes the assertion weaker and it still passes, which is a
phantom survivor rather than evidence. The list is protected by `M4`–`M6` instead: each puts a real
domain noun back into the shipped text, so a member that stopped working shows up as a survivor
there.

⛔ **No row on `FACTORY_TEXT_VERSION`.** `497` measured that nothing reads it — one writer,
`bundleHeader`, and `BUNDLE_MARKER` stops before the digit — so a row moving `1` to `2` changes no
answer this repository can produce. `377`'s table records the same absence from the other side.

## Gate map

| rows | killer |
|---|---|
| `M1`–`M3` | `apps/desktop/test/the-text-a-child-is-actually-told.test.ts` §1 (the member pins) |
| `M4`–`M9`, `M10`, `M11` | `apps/desktop/test/the-text-a-child-is-actually-told.test.ts` §1.5 |
| `M12` | `apps/desktop/test/a-narrowing-that-means-something.test.ts` §7 |
"""

FACTORY = "apps/desktop/src/main/runtime/factory-text.ts"
GUIDE = "docs/development.md"

CONVENTIONS = (
    # ⚑ **W4.481 · re-anchored in place, not retired** — W4.481: the v6 core replaced "How you work" and "Rules"; the same mutation, applied to the core's sentence that carries the rule
    # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The v9 core moved the anchor; original defect, ID and killer retained.
    # ⚑ **W4.669 · re-anchored in place, not retired** — verified RED alone (verify_row; 377 M4 by a plant against `a-check-in-is-a-question.test.ts` §1, whose §2 waits on request_action). v22 restores 'Follow local conventions; explain conflicts.' to the core, so the row comes back on it instead of staying retired
    "Follow local conventions; explain conflicts. "
)

BROBOT_ABSTAINS = (
    "            'Do not do the work or investigate deeply yourself. Delegate that to a project manager.',\n"
)

PM_SCOPES = (
    "            'Investigate only far enough to scope the work: read what you were given and skim ' +\n"
    "              'what it points at. When you need more than that, delegate it.',\n"
)

MEMORY_RULE = (
    "  \"Keep this provider's memory for what a later conversation of this profile will need — how to \" +\n"
    "    'build and test here, what surprised you, what is flaky. Not this piece of work’s details.',\n"
)

PM_IMPLEMENTS = (
    "            'Do not implement or investigate deeply yourself. Delegate focused work so that it ' +\n"
    "              'gets its own context.',\n"
)

# ⚠️ **RE-ANCHORED at launch item 8, not retired.** The roadmap's §11 lost its ruling log and its
# dispatch numbers, and the measurement is now one plain sentence (projects are gone, so the
# middle clause went too). ⚑ The DEFECT is unchanged: the sentence leaves the roadmap. Landing:
# re-verify RED alone.
# ⚑ **Moved with its sentence, not retired.** The roadmap left the public tree; the sentence, word
# for word, is in the development guide's "Where an agent can reach", which the killer now reads.
# The DEFECT is the same: the sentence leaves the guide. Verified RED alone there (verify_row).
REACHABILITY = (
    "`checkSessionCwd` admits any existing searchable directory, and a spawned session takes its "
    "parent's folder unless it names one — so a conversation can be pointed at a real repository "
    "today."
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the two withdrawn words, and the list that keeps them out ─────────────────────────
    (
        "M1 · 🔴 `merge` leaves the forbidden list · the census in §2 walks that list, so it goes "
        "GREEN the moment a member is deleted — the sentence can then come back with nothing to "
        "notice, which is precisely why a deletion was refused in favour of a member "
        "(`a-bound-written-as-the-constant-cannot-pin-it`, one subject over)",
        [(FACTORY, "  'merge',\n", "")],
    ),
    (
        "M2 · 🔴 `production` leaves the forbidden list · the other half of HO-035, unpinned the "
        "same way and with the same silence",
        [(FACTORY, "  'production',\n", "")],
    ),
    (
        "M3 · ⛔ the member becomes the SENTENCE instead of the word · the list's own rule is *a "
        "list of WORDS rather than a list of sentences, because the thing to keep out is the "
        "mechanism, not one phrasing of it* — and every paraphrase HO-035 withdrew (*never land a "
        "branch*, *no PR merge*, *propose and let a person integrate*) walks straight through",
        [(FACTORY, "  'merge',\n", "  'Never merge, and never modify production.',\n")],
    ),
    # ── §2 · the three sentences the vacation test moved ───────────────────────────────────────
    (
        "M4 · 🔴 the conventions rule goes back to CODE and A REPOSITORY · HO-035's test, failed "
        "in the layer every agent of every project reads: an agent planning a holiday has neither, "
        "so the one sentence telling it what to do when two halves of its instructions disagree "
        "has no referent at all",
        [
            (
                FACTORY,
                CONVENTIONS,
                "Follow the conventions of the code you are working in. A repository may add its own instructions; explain conflicts. ",
            )
        ],
    ),
    (
        "M5 · ⛔ the widening takes the RULE with it · the nouns are gone and so is the "
        "conflict-disclosure clause HO-009 §3 asked for by name — *an agent's effective "
        "instructions are ours plus a place's, and we control only one half* — which is the "
        "over-deletion this dispatch's own review named as the likeliest way to get a sweep wrong",
        [
            (
                FACTORY,
                CONVENTIONS,
                "Follow local conventions. ",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-002): PE-003 (one situational instruction set for every agent; the role column is no longer read) removed BroBot's role sentence *Do not do the work or investigate deeply yourself*.**
        # Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M6 · 🔴 BroBot is told not to WRITE CODE and RUN COMMANDS again · two of the three "
        "prohibited acts are software, so the agent this branch addresses reads two thirds of its "
        "only prohibition as somebody else's — and the same rule one tier down has always shipped "
        "verb-generic, which is the product's own proof the software verbs bought nothing",
        [
            (
                FACTORY,
                BROBOT_ABSTAINS,
                "            'Do not write code, run commands, or investigate deeply yourself. Delegate that to a ' +\n"
                "              'project manager.',\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-002): PE-003 (one situational instruction set for every agent; the role column is no longer read) removed BroBot's role sentence *Do not do the work or investigate deeply yourself*.**
        # Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M7 · ⛔ `deeply` comes off the widened verb · the rule becomes absolute and contradicts "
        "the three neighbours that tell this identity to understand what the person wants, to read "
        "a stall with `list_tasks` and to relay a person's rule — a widening that changed the "
        "meaning while passing every domain-noun assertion",
        [
            (
                FACTORY,
                BROBOT_ABSTAINS,
                "            'Do not do the work or investigate yourself. Delegate that to a project manager.',\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-002): PE-003 (one situational instruction set for every agent; the role column is no longer read) removed the project manager's scoping sentence.**
        # Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M8 · 🔴 the project manager scopes by TICKET, SPEC and REPOSITORY OUTLINE again · the "
        "colon makes those three the whole of the bound, so a manager outside software is handed a "
        "limit measured in artefacts it does not have and either cannot scope at all or scopes "
        "without any bound",
        [
            (
                FACTORY,
                PM_SCOPES,
                "            'Investigate only far enough to scope the work: read the ticket, read a spec, look ' +\n"
                "              'at a repository outline. When you need more than that, delegate it.',\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-002): PE-003 (one situational instruction set for every agent; the role column is no longer read) removed the project manager's scoping sentence.**
        # Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M9 · ⛔ the scoping line keeps its generic words and loses its BOUND · *investigate only "
        "far enough* with nothing saying how far is the sentence doing none of its work, and it "
        "passes every noun census in this table",
        [
            (
                FACTORY,
                PM_SCOPES,
                "            'Investigate the work, then delegate it.',\n",
            )
        ],
    ),
    # ── §3 · the two exemptions, which are decisions rather than gaps ──────────────────────────
    (
        "M10 · 🔴 the memory rule's examples are widened SILENTLY · `497`'s lens flagged *how to "
        "build and test here… what is flaky* and the repair kept it deliberately — the criterion "
        "before the em-dash is domain-free and self-sufficient, and build and test commands are "
        "the highest-yield thing a coding agent re-derives every session. ⛔ This row is the "
        "difference between reversing that decision and drifting past it",
        # These obsolete memory examples are no longer requested. Current instructions require
        # project-labelled notes, costly pitfalls and separate transferable lessons; keep this
        # absent anchor retired, with the current wording pinned by memory and launch-text tests.
        [
            (
                FACTORY,
                MEMORY_RULE,
                "  \"Keep this provider's memory for what a later conversation of this profile will need — how \" +\n"
                "    'things are done here, what surprised you, what turned out to be unreliable. Not this ' +\n"
                "    'piece of work’s details.',\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-002): PE-003 (one situational instruction set for every agent; the role column is no longer read) removed the project manager's *Do not implement or investigate deeply* sentence.**
        # Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M11 · ⚠️ the project manager's `implement` is widened silently · the second exemption, "
        "kept because two independent readers refused to call it domain-specific — and kept "
        "VISIBLY, so the day somebody disagrees it is a decision at a test rather than a word in a "
        "diff",
        [
            (
                FACTORY,
                PM_IMPLEMENTS,
                "            'Do not do the work or investigate deeply yourself. Delegate focused work so that ' +\n"
                "              'it gets its own context.',\n",
            )
        ],
    ),
    # ── §4 · the measurement that survived the withdrawal ──────────────────────────────────────
    (
        "M12 · 🔴 the sweep takes `364`'s reachability out with the rule · the withdrawn rule and "
        "the true measurement lived in the same paragraph, and the measurement was never about "
        "merging — *a conversation can be pointed at a real repository today* is where an agent "
        "can be POINTED, is still true, and is what the unattended-autonomy question rests on. ⛔ "
        "Removing both is the one way this sweep could have made the product less safe",
        [(GUIDE, REACHABILITY, "")],
    ),
]
