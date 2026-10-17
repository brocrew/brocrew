"""595 · The card he cannot read.

⛔ **the person, holding the `Trip Planning` card:** *"I have no clue how to read the project."*
⚑ **`EXT-011` §1 counted NINE blocks between the heading strip and the two buttons** and found
five of them explaining the app rather than the proposal — ⚠️ *"Each sentence is true and was
written for a good reason… Together they bury the thing being approved."*

🔴 **So this is a REGROUPING and not a deletion**, and the table is about the two ways a
regrouping goes wrong: **something load-bearing ends up behind the press**, and **the one line
that replaced five paragraphs says something the app will not do.**

## 🔴 A · `HO-027` §1.2 is the one rule a disclosure may not break

> ⛔ ***Approval must never create something the person did not see declared.***

⚑ **`EXT-011` §3.1 makes it the part that must survive the edit** — *"It must stay ABOVE the fold,
beside the path. A disclosure that hides either of them is a regression."*

⚠️ **M1, M2 and M16 are the three ways it comes back**, and none of them looks like a regression
in a diff: a `v-if` gains a conjunct, a `v-for` gains a ternary, and a deleted sentence returns.
⛔ **M2 is the one worth reading twice.** `PROPOSAL_NOTICES` is *"what approving does BEYOND making
the row"* — an adopted folder brings **whatever is already in it** — so a card that folds them
away is hiding a durable consequence behind a control labelled *what could stop this*.

## ⛔ B · the ONE line, and the shape it is FALSE over

🔴 **`SHAPE_MEANS['standing-agent']` is *no project at all*, and `bringItIntoExistence` returns
before it reaches a folder for that shape.** ⚑ `agent-tools.ts` refuses the CREATING arm there —
*"there would be nothing for a folder to belong to"* — and names the other arm as a standing
finding: **a `standing-agent` proposal naming a folder that is already there has its declaration
drawn on the card and then discarded.**

⚠️ **M3 is that finding arriving through a LAYOUT rather than through a sentence**: a path drawn
under *Approving creates an agent* promises a durable act this app does not perform. ⛔ **M4, M5
and M6 are the composition itself** — the clause dropped, the clause taken from the wrong key, and
the path arm widened until a project declared to have none draws one.

## ⚠️ C · a control that says what is under it, or it is a bare chevron

⚑ **`EXT-011` §4.1: *"A bare chevron is not an answer."*** ⛔ **M7 is one character wide** —
`alsoSays` joins every name but the last and appends it, so a control that dropped it would still
read as a sentence and would still be wrong. ⚠️ **M9 takes the row's own name**, which is the other
half of the same claim: the test reads the control's words and the rows' names as two populations
and asserts they are one.

🔴 **M8 is `458`'s rule, which this card already followed for the two conditions**: a bounce on a
decided card is a sentence with nothing left to condition.

## ⛔ D · the clamp, and `106`

> ⚠️ **`EXT-011` §2.1, via the brief:** *"Do NOT truncate it with an ellipsis. That is `106`'s
> shape — a control that hides something and gives no reason to press it."*

⚑ **M10 cuts at the budget** (a head that stops mid-clause reads as a rendering fault), **M12
takes the count** (`106` exactly), and **M13 draws the control over nothing**. ⛔ **M11 is the
defect this dispatch found in its own first draft**: the head was rebuilt by joining sentences
with one space, so a description written in paragraphs produced a head that was not a prefix of
its own source and every slice after it was off by that difference.

## ⚑ E · two words a person does not know

⛔ **M14 · `claimed`'s sentence goes back to being hover-only.** A `title` on a desktop app with no
cursor resting on the chip reaches nobody and no keyboard — `438` settled the register and the
DELIVERY is what failed. ⚠️ **M15 · the shape key and its English separate again**, which is
`EXT-011` §4.1's own finding: they were both on the card, four blocks apart, so a person read the
jargon first and the meaning fourth.

## 🔴 F · the ninth block, which is NOT this dispatch's

⛔ **`THE_AGENT_HEARS_IT_ONLY_IF_WAITING` was deleted by `591`** because `HO-082` §2 removed its
subject — *a question outlives the turn that asked it, and an answer given hours later reaches the
agent.* ⚑ **595 rewrote the template it lived in**, and `595` relay 1 is the rail on exactly that:

> 🔴 ***"A conflict git resolves in your favour is how a deleted sentence comes back."***

⚠️ **M16 puts it back as a LITERAL and not through the constant** — deliberately, because `591`
deleted the constant and a row that reached for it would not compile. ⛔ **A rule is proven by
violating it** (rule 20's closure): a removed element that nothing checks for is an element that
returns.

🔴 **The record of who removed it, corrected at relay 2.** ⚠️ While `591` was unmerged, `595` was
the commit that deleted this card's render and the sentence was still live on both queues — so
`479` M6's own defect, *the queue keeps the sentence and the card loses it*, described the state
this branch shipped. ⛔ **`595` then rebased onto `591` (`98e1a529`) and that stopped being
true**: `591` deleted the constant, the import and both queue renders, and retired `479` M6
itself on `main`. ⚑ **So this table names ONE retirement and not two** — see below.

## ⛔ What this table does NOT cover

 1. **The wording.** `PROPOSED_FOLDER_CREATES`, `NOTHING_IS_STARTED` and `FOLDED_AWAY`'s names are
    pinned as literals where a person reads them (169 §2); every row here is about a SHAPE.
 2. **`PROPOSED_FOLDER_MEANS` being false over `standing-agent`.** ⚠️ *"This project works in a
    folder"* on a shape with no project predates this dispatch, is named in `agent-tools.ts`, and
    is **reported as a finding rather than changed under cover of a regrouping.**
 3. **The other tables — counted, because a count in a docstring is a claim, and this count was
    wrong twice.** ⚑ **FIVE tables hold a row in `ProposalCard.vue`** — `441`, `471`, `479`,
    `489` and this one — **21 rows between them**, derived from the tables rather than listed.
    ⛔ **Twenty apply, and every one was re-verified RED by hand, alone, on the rebased tree.**

    | | |
    |---|---|
    | **re-anchored by `595`** | `441` M30 · `471` M6 · `479` M7 · `479` M8 · `479` M9 |
    | **untouched, re-verified anyway** | `441` M28 · `441` M29 · `471` M7 · `489` M13 — ⚠️ M28's anchor sits inside the element `595` turned from a `<span>` into a `<button>`, and *a row whose anchor still applies is not a row that still measures* |
    | **dark** | `479` M6 only — ⚑ **retired by `591`, on `main`.** `595` does not name it again: `--retire` records that a person opened the file and looked, and claiming that twice would record one inspection as two (relay 2 §3.4) |

    🔴 **`595` NAMES NO RETIREMENT AT ALL, and the first two drafts of this paragraph both said
    otherwise.** ⛔ `441` M30 was going to be struck on the reading that its subject was the
    CLAUSE *"and nothing else"*, which `595` deleted. ⚑ **Relay 3 ruled the subject is the
    DISCLOSURE** — *an adopted folder brings whatever is already in it* — **and that is still on
    the card, so the bytes moved and the rule did not.** ⚠️ It is re-anchored at the `v-for`'s
    source, which is where the card stops disclosing at all; see `441`'s own note for why not at
    the rename and why not at the `v-if` this table already owns both arms of.
"""

CARD = "apps/desktop/src/renderer/src/components/ProposalCard.vue"
FOLD = "apps/desktop/src/shared/proposals.ts"
READING = "apps/desktop/src/renderer/src/lib/proposal-reading.ts"

MUTATIONS = [
    # ── A · HO-027 §1.2 · the consequence may not hide ────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** D-016 deleted ProposalCard.vue (-895
        # lines) on purpose: the commit says 'Proposals go end to end'. No card is left whose
        # consequence block could move behind a disclosure. Its killer test
        # the-card-he-cannot-read.test.ts is deleted too. Its anchor is left stale, so the census
        # records it retired.
        "M1 · 🔴 THE WHOLE DISPATCH, INVERTED · the one consequence a person must read before "
        "pressing moves BEHIND the disclosure, so Approve sits under a card that has not said "
        "what approving makes — `HO-027` §1.2 exactly, arriving as one extra conjunct",
        [
            (
                CARD,
                '<div v-if="predicts || notices.length > 0" class="consequence" data-cy="proposal-consequence">',
                '<div v-if="open" class="consequence" data-cy="proposal-consequence">',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The notices fold lived in
        # ProposalCard.vue, deleted with 'Proposals go end to end'. PROPOSAL_NOTICES (an adopted
        # folder brings what is already in it) described approving a proposal, which no longer
        # exists. Its anchor is left stale, so the census records it retired.
        "M2 · ⛔ the NOTICES fold away · `PROPOSAL_NOTICES` is *what approving does BEYOND making "
        "the row* — an adopted folder brings whatever is already in it — so this hides a durable "
        "consequence behind a control whose label promises only *what could stop this*",
        [(CARD, 'v-for="notice in notices"', 'v-for="notice in open ? notices : []"')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row plants a defect in
        # shared/proposals.ts (-700 lines, deleted), where the standing-agent shape drew a path with
        # no sentence beside it. Proposal shapes and their folder declarations are removed with
        # proposals, and so is the project-folder machinery ('project folders and their rails'
        # removed). Its anchor is left stale, so the census records it retired.
        "M3 · 🔴 a shape that creates NO PROJECT draws the path it was handed and says NOTHING "
        "about it · a directory under *Approving creates an agent* reads as a promise, and "
        "`bringItIntoExistence` returns before it reaches a folder for that shape — `489` / "
        "`HO-031` §2.6's defect arriving through a LAYOUT rather than through a sentence. "
        "⚑ The path is not hidden either (that would fail `HO-027` §1.2 the other way); what "
        "makes the adjacency honest is the sentence beside it",
        [
            (
                FOLD,
                "      aboutTheFolder: at === null ? null : A_FOLDER_AN_AGENT_IS_NOT_GIVEN,",
                "      aboutTheFolder: null,",
            )
        ],
    ),
    # ── B · the one line, composed ────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'Approving creates ...' line was
        # composed in shared/proposals.ts, which D-016 deleted. There is no approval and no
        # folder-creating act left to disclose, since projects and proposals both go. Its anchor is
        # left stale, so the census records it retired.
        "M4 · ⛔ the folder clause is dropped from the line · *Approving creates a project.* over "
        "a declaration that approving MAKES a directory — the one sentence `HO-031` §2.6 makes "
        "load-bearing, silently absent",
        [
            (
                FOLD,
                "creates: `Approving creates ${creates} ${PROPOSED_FOLDER_CREATES[folderIs]}.`,",
                "creates: `Approving creates ${creates}.`,",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** PROPOSED_FOLDER_CREATES and the
        # folderIs key lived in the deleted shared/proposals.ts. The declared-folder-on-a-proposal
        # subject is gone ('project folders and their rails' and proposals removed). Its anchor is
        # left stale, so the census records it retired.
        "M5 · 🔴 the clause is read from a FIXED key · every proposal reads *in the folder below*, "
        "so a folder that does not exist yet is drawn as one that is already there and a person "
        "approves a creation nobody declared",
        [
            (
                FOLD,
                "${PROPOSED_FOLDER_CREATES[folderIs]}",
                "${PROPOSED_FOLDER_CREATES['a-folder-was-chosen']}",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** folderProposedIs and the path arm
        # existed only for a proposal's declared project folder. Both shared/proposals.ts and the
        # project-folder shared module (project-folder.ts, -375) were deleted on purpose. Its anchor
        # is left stale, so the census records it retired.
        "M6 · ⚠️ the path arm widens to every word · a project declared `no-folder-on-purpose` "
        "draws a directory beside the sentence saying it has none, which is the pair "
        "`folderProposedIs` exists so that nothing can construct",
        [
            (
                FOLD,
                "  const at = folderHasAPath(folderIs) && folder !== null && folder.trim() !== '' ? folder : null",
                "  const at = folder",
            )
        ],
    ),
    # ── C · the control says what is under it ─────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** alsoSays labelled the fold over a
        # proposal card's rows, in the deleted proposal-reading.ts (-217). Nothing in today's code
        # builds an 'Also: a, b and c' control; git grep finds no trace of it. Its anchor is left
        # stale, so the census records it retired.
        "M7 · 🔴 the control drops the LAST thing it hides · one character wide, and the label "
        "still reads as a sentence — `EXT-011` §4.1's *a bare chevron is not an answer* satisfied "
        "in form while a person is told about two of three folded rows",
        [
            (
                READING,
                "  return `Also: ${named.slice(0, -1).join(', ')} and ${named[named.length - 1]!}`",
                "  return `Also: ${named.slice(0, -1).join(', ')}`",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'If you approve' label sat in
        # ProposalCard.vue's consequence block over a proposal about to be decided. The card and the
        # approve/decline act are deleted ('proposals and their card ... approving'), so no settled
        # card exists to be mislabelled. Its anchor is left stale, so the census records it retired.
        "M8 · ⛔ a SETTLED card is headed *If you approve* · a prediction over a record of what "
        "already happened, and a person reading it cannot tell whether it is a warning about the "
        "row in front of them — `458`'s live-cardinality rule in prose form, at the block this "
        "dispatch built. ⚠️ **`479` M8 owns the same rule for the BOUNCE row**, which is a "
        "separate guard in the script; this one is the consequence block's own",
        [
            (
                CARD,
                '        <p v-if="predicts" class="consequence-label">{{ IF_YOU_APPROVE }}</p>',
                '        <p class="consequence-label">{{ IF_YOU_APPROVE }}</p>',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row's file, ProposalCard.vue, was
        # deleted (count_now -1). The commit message says 'Proposals go end to end', and the
        # folded-row name on a proposal card has no surviving surface. Its anchor is left stale, so
        # the census records it retired.
        "M9 · ⚠️ the folded row stops carrying the NAME the control used for it · the two readings "
        "collapse into one, so a control that named two of three rows would agree with itself",
        [(CARD, ':data-fold="row.label"', ':data-fold="\'\'"')],
    ),
    # ── D · the clamp, and 106 ────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The sentence-boundary head cut was in
        # proposal-reading.ts, deleted with proposals. It clamped a proposal's description behind
        # 'Show the rest'; git grep finds no 'Show the rest' or equivalent clamp anywhere in apps/
        # or scripts/ outside the table. Its anchor is left stale, so the census records it retired.
        "M10 · 🔴 the head is cut at the BUDGET instead of at a sentence · a description that "
        "stops mid-clause reads as a rendering fault rather than as a fold, which is worse than "
        "the paragraph it replaced",
        [
            (
                READING,
                "  let end = ends.length === 0 ? whole.length : (ends.filter((at) => at <= budget).pop() ?? ends[0]!)",
                "  let end = budget",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The head-must-be-a-prefix rule
        # belonged to the proposal description clamp in the deleted proposal-reading.ts. No
        # surviving surface slices a description into a head and a rest. Its anchor is left stale,
        # so the census records it retired.
        "M11 · 🔴 THE DEFECT THIS DISPATCH FOUND IN ITS OWN DRAFT, PUT BACK · the head is REBUILT "
        "with its whitespace normalised instead of sliced out of the source, so a description "
        "written in paragraphs produces a head that is not a prefix of its own text — and every "
        "offset after it is off by the difference, which is a person pressing *Show the rest* and "
        "reading a word that was never written. ⚠️ **The first row written here was a no-op**: "
        "`slice(end + 1)` skips a character `trim()` was going to remove anyway, so it SURVIVED "
        "and reported as a passing guard — `a-mutation-that-changes-nothing-reports-as-a-survivor`",
        [
            (
                READING,
                "  const head = whole.slice(0, end).trimEnd()",
                "  const head = whole.slice(0, end).split(/\\s+/).join(' ').trimEnd()",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'Show the rest (+N words)' label
        # was proposal-reading.ts's, which the commit deleted. No other control in the renderer has
        # this label or a restWords count. Its anchor is left stale, so the census records it
        # retired.
        "M12 · ⛔ the control loses its COUNT on the PROSE arm · `106` exactly — a control that "
        "hides something and gives no reason to press it, which is the shape the brief forbids "
        "by name",
        [
            (
                READING,
                "  return `Show the rest (+${String(read.restWords)} ${read.restWords === 1 ? 'word' : 'words'})`",
                "  return 'Show the rest'",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The characters arm of the 'Show the
        # rest' label was in the deleted proposal-reading.ts. The clamp went with proposals, and
        # restChars appears nowhere in today's code. Its anchor is left stale, so the census records
        # it retired.
        "M12b · ⛔ the control loses its COUNT on the CHARACTERS arm · the arm that exists "
        "BECAUSE the word count lied — a pasted path or a script with no spaces — is the one a "
        "row on the prose arm alone leaves unguarded, which is "
        "`a-file-level-contains-cannot-tell-sibling-declarations-apart` one function over",
        [
            (
                READING,
                "  if (!prose) return `Show the rest (+${String(read.restChars)} characters)`",
                "  if (!prose) return 'Show the rest'",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The words-versus-characters unit
        # choice was a branch in the deleted proposal-reading.ts. The whole reading module went with
        # 'Proposals go end to end'. Its anchor is left stale, so the census records it retired.
        "M12c · 🔴 the unit stops being chosen · every remainder counts WORDS again, so three "
        "hundred characters of an unbroken path read *+1 word* — `106` with a number filled in, "
        "which is worse than no number because it is checkable and wrong",
        [(READING, "  if (!prose) return", "  if (prose && false) return")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The reading.rest !== '' guard was a
        # v-if in the deleted ProposalCard.vue on its 'Show the rest' control. That control and its
        # card are gone. Its anchor is left stale, so the census records it retired.
        "M13 · ⚠️ the control is drawn with NOTHING behind it · a description already whole offers "
        "a press that reveals nothing, which is the same broken promise `106` is about from the "
        "other side",
        [(CARD, "          v-if=\"reading.rest !== ''\"", '          v-if="true"')],
    ),
    # ── E · two words a person does not know ──────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'claimed' chip button (whoSaidIt)
        # was in the deleted ProposalCard.vue. It said an agent claimed a proposal's role and
        # grants; proposals are removed, and whoSaidIt has no other match in apps/ or scripts/. Its
        # anchor is left stale, so the census records it retired.
        "M14 · 🔴 `claimed` goes back to being HOVER-ONLY · a `title` on a desktop app with no "
        "cursor resting on the chip reaches nobody and no keyboard, so the one sentence saying "
        "*an agent said this — nothing in this app checked it* is delivered to no one",
        [(CARD, '@click="whoSaidIt = !whoSaidIt"', '@click="whoSaidIt = false"')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The shape key (bounded-project etc.)
        # and its English meaning were a proposal card element in the deleted ProposalCard.vue.
        # Proposal shapes go with proposals. Its anchor is left stale, so the census records it
        # retired.
        "M15 · ⛔ the shape KEY and its English separate again · `EXT-011` §4.1's own finding "
        "restored — `bounded-project` on the card and its meaning nowhere, so a person reads "
        "internal vocabulary and is given no way to learn what it means",
        [
            (
                CARD,
                '        <span v-if="meaning !== null" class="kind-means" data-cy="proposal-shape-means">{{\n'
                "          meaning\n"
                "        }}</span>\n",
                "",
            )
        ],
    ),
    # ── F · the ninth block, which is 591's ───────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** It guarded a deleted sentence from
        # returning to ProposalCard.vue's template. The whole template is deleted, so the sentence
        # has nowhere to come back to. Its subject (a later answer not reaching the agent) was
        # already removed by 591. Its anchor is left stale, so the census records it retired.
        "M16 · 🔴 THE DELETED SENTENCE COMES BACK · `591` removed *a later answer does not reach "
        "it* because `HO-082` §2 removed its subject, and `595` rewrote the template it lived in. "
        "⚠️ `595` relay 1: *a conflict git resolves in your favour is how a deleted sentence comes "
        "back* — so the negative is asserted rather than assumed",
        [
            (
                CARD,
                '        <p v-if="predicts" class="creates quiet" data-cy="proposal-starts-nothing">\n'
                "          {{ NOTHING_IS_STARTED }}\n"
                "        </p>\n",
                '        <p v-if="predicts" class="creates quiet" data-cy="proposal-starts-nothing">\n'
                "          {{ NOTHING_IS_STARTED }}\n"
                "        </p>\n"
                '        <p class="creates quiet" data-cy="proposal-heard">\n'
                "          The agent hears your answer only while it is still waiting for it, and a later\n"
                "          answer does not reach it.\n"
                "        </p>\n",
            )
        ],
    ),
    # ── G · the guards this dispatch's own review put there ───────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The rule was that a settled proposal
        # card keeps its notices. Both the card and PROPOSAL_NOTICES are deleted with proposals; the
        # killer the-card-he-cannot-read.test.ts is gone too. Its anchor is left stale, so the
        # census records it retired.
        "M17 · 🔴 a SETTLED card loses the notices · at the base they were a body-level block and "
        "survived the ending; `595` moved them into the consequence and nearly took them with "
        "it. ⛔ A record that drops *it comes with the role and the grants this app gives it* is "
        "`EXT-011` §5 broken on the one block a person scrolls back for — and it is the rule "
        "`441` M30 carried before its own clause stopped existing",
        [
            (
                CARD,
                '<div v-if="predicts || notices.length > 0" class="consequence" data-cy="proposal-consequence">',
                '<div v-if="predicts" class="consequence" data-cy="proposal-consequence">',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The fold of an unreadable shape word
        # was in shared/proposals.ts, alongside bringItIntoExistence and the ledger's proposal rows.
        # Proposals are removed end to end, so no shape word is read or folded. Its anchor is left
        # stale, so the census records it retired.
        "M18 · 🔴 the SHAPE stops being folded · the row is a ledger event and `importBundle` "
        "checks nothing between `JSON.parse` and here, so a word this build cannot read makes "
        "`SHAPE_CREATES[shape]` undefined — the card composes *Approving creates undefined.* with "
        "no folder clause and no path, while `bringItIntoExistence` falls through to the PROJECT "
        "arm and MAKES the directory. ⛔ `HO-027` §1.2 with the declaration missing on the one "
        "press that creates two things",
        [
            (
                FOLD,
                "  const creates = isProjectShape(shape) ? SHAPE_CREATES[shape] : 'a project'\n  // ⚑ **Only the words",
                "  const creates = SHAPE_CREATES[shape as ProjectShape]\n  // ⚑ **Only the words",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** PROPOSED_FOLDER_MEANS and its 'This
        # project works in a folder' sentence lived in the deleted shared/proposals.ts. The project
        # and its folder are removed, and this is the subject of the deleted
        # the-folder-a-proposal-declares.test.ts. Its anchor is left stale, so the census records it
        # retired.
        "M19 · ⛔ the FOLD's folder sentence stops asking about the shape · "
        "`PROPOSED_FOLDER_MEANS` is keyed by the folder word alone and its first arm reads *This "
        "project works in a folder, and a conversation started in it…* — over a shape with no "
        "project there is no project and no conversation, so the disclosure contradicts the "
        "consequence line above it and the wrong one is the more detailed one",
        [
            (
                FOLD,
                "  return creates === 'a project' ? PROPOSED_FOLDER_MEANS[folderIs] : null",
                "  return PROPOSED_FOLDER_MEANS[folderIs]",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The hard-cut floor was in
        # proposal-reading.ts's clamp of a proposal description, now deleted. cutAt and the 'Go '
        # plus unbroken-run scenario have no counterpart in today's code. Its anchor is left stale,
        # so the census records it retired.
        "M20 · 🔴 the hard cut loses its FLOOR · `lastIndexOf(' ', hard)` has no floor of its "
        "own, so over `Go ` followed by a thousand unbroken characters the *shape of the work* "
        "is the word **Go** and everything else goes behind the control — a fold that hides the "
        "description rather than clamping it",
        [(READING, "    end = at >= budget ? at : cutAt(whole, hard)", "    end = at > 0 ? at : cutAt(whole, hard)")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The surrogate-pair guard was in the
        # deleted proposal-reading.ts clamp. runtime-host.ts has a similar 0xd800 guard, but for
        # another subject and another table's rows; this row's subject went with proposals. Its
        # anchor is left stale, so the census records it retired.
        "M21 · ⛔ the hard cut lands between a SURROGATE PAIR · `slice` counts UTF-16 code units "
        "and an emoji is two of them, so the head ends on a lone high surrogate and the rest "
        "starts on its partner — a replacement character on both sides of the fold, which is the "
        "cheapest way to make a clamp look like a rendering fault",
        [(READING, "  return before >= 0xd800 && before <= 0xdbff ? at - 1 : at", "  return at")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The aria-controls pair was on the
        # 'claimed' register button in the deleted ProposalCard.vue. PermissionCard.vue and other
        # components have the same accessibility rule but under their own rows; this control no
        # longer exists. Its anchor is left stale, so the census records it retired.
        "M22 · ⚠️ the register's press loses the other half of its ARIA pair · the whole reason "
        "`595` turned the chip into a button is that *a `title` is a tooltip a keyboard never "
        "reaches*. ⛔ Announced as a collapsed button and controlling nothing, the press inserts "
        "a paragraph associated with no control — the sentence is still not delivered to the "
        "population the change was made for (`PermissionCard.vue`'s stated rule)",
        [(CARD, ':aria-controls="whoSaidIt ? saysId : undefined"', ':aria-controls="undefined"')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The aria-controls on the card's single
        # disclosure chevron (foldedId) was in the deleted ProposalCard.vue. The disclosure and its
        # card are gone with proposals. Its anchor is left stale, so the census records it retired.
        "M23 · ⚠️ the ONE disclosure loses it too · same rule, on the control `EXT-011` §4.1 is "
        "actually about: a screen reader is told a chevron is expanded and never told what it "
        "expanded",
        [(CARD, ':aria-controls="open ? foldedId : undefined"', ':aria-controls="undefined"')],
    ),
]
