"""481 · Home's queue says what each answer does — HO-030 §2, criterion 20 over every surface.

⛔ **The ruling is about habit, not coverage**, and the PO's words are the reason this table exists
at all: *"An inconsistent explanation is worse than a uniformly absent one, because it trains the
reader out of looking."* ⚑ **Home is where that costs most** — it is criterion 17's own surface,
*everything waiting on him in one place*, so a person who clears a backlog from there would meet
the press every time and the sentence never.

## 🔴 What was true before this dispatch

`478` F3, measured on the code: *"`whatThisAnswerDoes` is drawn only by `PersonsQueue`. Home's
`AttentionQueue` draws the same decisions with `LIMIT_WORDS` and `isRefusal` and NO effect line."*

⚠️ **So the rows below are not about the WORDS** — not one of them touches a sentence. `478` owns
the permission and consent vocabulary and `479` owns the proposal pair; every mutation here is
about whether Home REACHES that vocabulary, draws what it returns, and draws it where a person can
read it.

## ⛔ The two ways one sentence becomes two, and both are rows

| shape | row | why it is the defect and not a style |
|---|---|---|
| the surface says NOTHING | `M1`, `M2` | the state HO-030 §2 ruled against |
| the surface says it ITSELF | `M3` | `214` §3, `299` §1, `464` and `470` were each paid for exactly this — one fact, two files, free to drift |

## ⚑ And the conditions, which are not consequences of choosing a particular answer

⛔ **`WHAT_COMES_AFTER_IS_NOT_OURS` could not have arrived before the effect lines and must not
arrive after them.** `430`'s narrowing is that this app may state a deterministic immediate effect
and may not predict the model — so a surface that states the first and omits the second reads as
*nothing else happens*, which is the one thing nobody can promise. `M4` is that row.

⛔ **`479`'s bound is about a PROPOSAL's held call**, so it belongs on a proposal row and on no
other. `M5` puts it everywhere and `M6` nowhere: one makes a permission row carry a condition that
is false of it, the other drops a condition from the row it is true of.

## 🔴 The layout rows are repairs, not styling

⚠️ **`031`'s rule reached from the other side.** A sentence under every control cannot be a ROW of
controls: side by side each sentence gets a column narrow enough to wrap into a block, and *a
paragraph nobody reads is worse than nothing*. `M8` and `M9` are the two ways that comes back.

⛔ **And `M7` is the one a person would meet without any layout changing at all.** `color` on a
button does not reach a child that declares its own, and since this round both children do — so
without two explicit rules a row whose answer is already on its way paints its words exactly as a
live one, which is `207` M2's finding said in colour instead of in an attribute.

## ⛔ What this table deliberately does NOT contain

⚠️ **No row on any sentence's text.** They belong to `478`, `479` and `434`, and their own tables
own them. ⛔ A row here would be this dispatch holding an opinion about somebody else's repair in a
file it did not write.

⚠️ **No row on `PersonsQueue`.** It has drawn the sentence since `434` and nothing in this dispatch
touched it — it appears in `homes-queue-says-what-each-answer-does.test.ts` only as the other side
of a comparison.

⚠️ **No row planting a second COMPOSER.** A component that computed its own sentence from a
decision's shape is the `214` §3 defect proper, and the way to plant it is to write a function,
which no single-line mutation can do. ⛔ `M3` is the nearest a mutation gets, and it is the form
the defect has actually taken in this repository twice: a literal spelled in a template.

⚠️ **No row on the CARDS.** `PermissionCard` and `UserInputCard` are `482`'s, by the PO's own
sequencing — *"that is where the hands already are"*.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| `M1` | ⚑ **`apps/desktop/test/dom/homes-queue-says-what-each-answer-does.dom.test.ts`** — every one of its painted assertions, and `homes-queue-…test.ts`'s call census |
| `M2` | ⚑ the dom file's §1 (the sentence equals `whatThisAnswerDoes`) and its join against the person's queue |
| `M3` | ⚑ **`apps/desktop/test/homes-queue-says-what-each-answer-does.test.ts`** — the comment-stripped source census, with its own planted control |
| `M4` | ⚑ the dom file's gap case — one `attention-after` per row, and its words read from the constant |
| `M5`, `M6` | ⚑ the same case's paired positive and negative: the bound on the proposal row and on no other |
| `M7` | ⚑ the dom file's `207` M2 case — the painted colour of a pressed row's word and of its consequence |
| `M8`, `M9` | ⚑ the dom file's overflow case at four widths, and its stacking case |
| `M10` | ⚑ the dom file's refusal case — quieter in the WORD, identical in what it does |

🔴 **`M8` is in this table because writing it found a hole, and the hole is now closed.** ⛔ The
first draft of the dom file asserted that the effect line stays inside the control it is in — and
measured, a `<small>` told not to wrap does not spill out of its button: **the button grows to fit
it and walks off the panel.** ⚠️ So *the line is inside the control* stayed true at every width
while the control left the screen, and nothing in the repository would have failed. ⚑ The outermost
box is now asserted as well — nothing in this queue may make it scroll sideways — which is
`a-child-cannot-be-asserted-to-remove-itself` in its layout form: the containment that holds the
claim is not always the one the claim is about.

⛔ **Evidence this table is honest about what it can reach.** Every row was applied alone, its own
killer file run, and the tree restored from bytes with the hash checked — the whole table has NOT
been run under the driver, so `CENSUS.md` records it `unrun` and no verdict is claimed here.
"""

HOME = "apps/desktop/src/renderer/src/components/AttentionQueue.vue"

MUTATIONS = [
    # ── §1 · does Home say anything at all ──────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, verbatim · the effect line is gone from Home's answers, so the queue "
        "criterion 17 exists for offers a row of words a person has to already know the meaning of "
        "— *Cancel* beside *Deny*, with nothing saying that one of them stops everything the agent "
        "is doing",
        [
            (
                HOME,
                '            <small class="request-effect" data-cy="attention-effect">{{\n'
                "              whatThisAnswerDoes(decision)\n"
                "            }}</small>\n",
                "",
            )
        ],
    ),
    (
        "M2 · ⛔ the consequence is the word again · the `<small>` survives and draws the label, so "
        "every button carries a second copy of its own name where its effect should be — the shape "
        "that passes a *there is a sentence here* check and tells a person nothing",
        [(HOME, "whatThisAnswerDoes(decision)", "decision.label")],
    ),
    (
        "M3 · 🔴 THE DEFECT ONE LEVEL UP · the component spells a sentence itself, which is `214` "
        "§3 and `470` exactly: one fact about a request written down in two files, free to drift "
        "the next time somebody corrects the vocabulary and not the copy",
        [
            (
                HOME,
                '            <strong data-cy="attention-decide-word">{{ decision.label }}</strong>\n',
                '            <strong data-cy="attention-decide-word">{{ decision.label }}</strong>\n'
                "            <i>the agent is refused this one thing</i>\n",
            )
        ],
    ),
    # ── §2 · the conditions that hold however you answer ────────────────────────────────────────
    (
        "M4 · ⛔ the gap is dropped · Home states an immediate effect and stops, which reads as "
        "*nothing else happens* — the one claim `430` ruled this app may never imply, arriving the "
        "moment the surface started making the claims that need bounding",
        [
            (
                HOME,
                '          <p v-if="request.decisions.length > 0" class="request-after" data-cy="attention-after">\n'
                "            {{ WHAT_COMES_AFTER_IS_NOT_OURS }}\n"
                "          </p>\n",
                "",
            )
        ],
    ),
    (
        "M5 · ⚠️ `479`'s bound is drawn on every row · a permission row is told the agent hears the "
        "answer only while it is still waiting, which is true of a proposal's held call and false "
        "of a provider request the adapter is blocked on",
        [
            (
                HOME,
                '          <p v-if="request.kind === \'proposal\'" class="request-after" data-cy="attention-heard">',
                '          <p v-if="request.decisions.length > 0" class="request-after" data-cy="attention-heard">',
            )
        ],
    ),
    (
        "M6 · ⛔ …and gone from the row it IS about · a proposal is answered from Home with no "
        "mention that the answer may reach nobody, which is HO-024 §5.3 the other way up: a "
        "surface omitting the unanswerable thing rather than naming it",
        [
            (
                HOME,
                '          <p v-if="request.kind === \'proposal\'" class="request-after" data-cy="attention-heard">\n'
                "            {{ THE_AGENT_HEARS_IT_ONLY_IF_WAITING }}\n"
                "          </p>\n",
                "",
            )
        ],
    ),
    # ── §3 · what a person can actually read ────────────────────────────────────────────────────
    (
        "M7 · 🔴 a pressed row keeps painting live words · `color` on the button never reached the "
        "children once they declared their own, so removing the two `:disabled` rules leaves four "
        "dead controls drawn exactly as live ones — `207` M2's finding, which is about what a "
        "person SEES and not about the attribute",
        [
            (
                HOME,
                ".request-decide:disabled strong,\n"
                ".request-decide:disabled .request-effect {\n"
                "  color: var(--faint);\n"
                "}\n",
                "",
            )
        ],
    ),
    (
        "M8 · ⚠️ the sentence stops wrapping · one line inside a control that cannot grow, so the "
        "longest of them — `479`'s Approve, which carries its bounce clause — runs out of its own "
        "button and a person cannot finish reading the press they were unsure about",
        [
            (
                HOME,
                ".request-effect,\n.request-after {\n  color: var(--muted);",
                ".request-effect,\n.request-after {\n  white-space: nowrap;\n  color: var(--muted);",
            )
        ],
    ),
    (
        "M9 · ⛔ the answers go back to a ROW · each sentence gets a column narrow enough to wrap "
        "into a block and a person scanning for a word reads blocks instead — `031`'s *a paragraph "
        "nobody reads is worse than nothing*, arrived at by adding the thing that was missing",
        [
            (
                HOME,
                ".request-actions {\n"
                "  display: flex;\n"
                "  flex-direction: column;\n"
                "  align-items: stretch;\n"
                "  gap: var(--space-2);\n"
                "}",
                ".request-actions {\n"
                "  display: flex;\n"
                "  flex-wrap: wrap;\n"
                "  align-items: center;\n"
                "  gap: var(--space-2);\n"
                "}",
            )
        ],
    ),
    (
        "M10 · ⚠️ the refusal is dimmed whole · `isRefusal` has always quietened the refusing "
        "control, and until this round the control was only a word — dimming the button now dims "
        "what it DOES as well, so the largest consequence this surface states is drawn as the "
        "smallest",
        [
            (
                HOME,
                ".request-decide.deny strong {\n  color: var(--text-soft);\n}",
                ".request-decide.deny {\n  color: var(--text-soft);\n}",
            )
        ],
    ),
]
