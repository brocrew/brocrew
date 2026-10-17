"""613 · the chain a question carries.

⛔ **`HO-088` §6:** ⚑ ***"When a question reaches him, it carries its chain — Ali asked · Ada could
not answer · BroBot could not answer."*** 🔴 **The SHAPE is built exactly as ruled. The VERB is
not**, and the refusal is older than the ruling: `persons-queue.ts`'s `WHY_ITS_YOURS` has said
since `403` — ⛔ ***"has not answered", never "cannot answer" — the second is an inability the walk
never establishes.***

## 🔴 The property every row here is pointed at

⛔ **A chain is a record of what CONVERSATIONS did, and every word on it is a claim about
somebody.** ⚑ A hop carries two NAMES (`ChainHop`) and no cause, so the only words this surface may
draw are ones true of every hop of their kind: the first RAISED the thing, and every later one has
a request routed to it that is still open. ⚠️ **The rows below push on each of those separately**,
because a repair that traded one for another would still read well.

## ⚑ Five claims

 1. **The act is DERIVED from the hop, not decided per surface** (M1–M4).
 2. **`null` is exactly the participant that is not a conversation** (M5–M6). ⛔ Two fields describe
    one participant and the biconditional is the only thing keeping them honest.
 3. **The word is the one the walk establishes** (M7–M10). 🔴 **M7 is the ruling's own phrasing**,
    put back, which is what makes this table worth reading.
 4. **One vocabulary, two surfaces** (M11–M13). ⚑ `KIND_WORDS`' argument from `452 relay 1`, now
    with a second table under it.
 5. **The act is said, seen and heard** (M14–M16). ⚠️ M14 is the defect this dispatch shipped into
    its own first dom run.

## 🔴 The one a reader should look at first

⛔ **M7 restores `HO-088` §6's exact words.** ⚑ Nothing breaks, nothing throws, and every hop of
every chain then tells a person that a parent COULD NOT answer a question it may still answer —
`REQUEST_IS_OPEN` is what admitted the row at all. ⚠️ It is a true-looking sentence about somebody
else's ability, drawn from a walk that only ever observed silence.

## ⛔ What this table does NOT cover, said out loud

 1. **`escalationChain`, `chainReading` and `chainSentence`.** ⚑ `613` §2.1 and §6 scope them out;
    `401`, `403` and `474` own them and this dispatch wrote no second walk.
 2. **WHO is in the chain.** ⛔ `RuntimeHost.questionsForAPerson`'s `openQuestionOf` decides that.
    ⚠️ M10 is the single exception and it is there for one reason: it is the conjunct that makes
    ONE word honest for every hop, so a table about the words owes it.
 3. **What a conversation is NAMED.** 🔴 Reported as a finding instead — `nameForAPerson` answers
    *what folder is this in* (until `734`, which names the agent), and three conversations of one
    workspace draw one word three times.
    ⛔ A row here would pin a naming this dispatch was not sent to change.
 4. **The rows, ages, kinds and buttons of the queue** — `401`, `403`, `434`, `446`, `468` and
    `533` own them, and `452 M17`'s anchor was CORRECTED IN PLACE by this dispatch, not retired.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| M1–M4 | `apps/desktop/test/the-chain-a-question-carries.test.ts` §1 · what each participant did |
| M5–M6 | `…the-chain-a-question-carries.test.ts` §1 · *null iff you*, and §4 · the limit |
| M7–M9 | `…the-chain-a-question-carries.test.ts` §2 · the word the walk establishes |
| M10 | `…the-chain-a-question-carries.test.ts` §3 · only one cause can reach a chain |
| M11–M13 | `…the-room-behind-the-door.render.test.ts` §5 · one vocabulary · and the band's own dom file |
| M14–M16 | `…dom/the-chain-a-question-carries.dom.test.ts` §1 · said, seen and heard |

⛔ **Evidence, and it is the method rather than a claim.** Every row was applied ALONE, its killer
file run, and the tree restored from the bytes kept before the edit —
`verify-each-mutation-row-without-running-the-table`. ⚠️ **The whole table has NOT been run under
the driver**, so `CENSUS.md` records it `unrun` and no verdict is claimed here. ⚑ Each red was
checked for the RIGHT reason: the output was searched for `SyntaxError`, `Transform failed` and
`error TS`, because a row red on a parse error measured nothing (`452 M8`).
"""

QUEUE = "apps/desktop/src/renderer/src/lib/persons-queue.ts"
PANEL = "apps/desktop/src/renderer/src/components/PersonsQueue.vue"
WORK = "apps/desktop/src/renderer/src/components/ProjectWorkspace.vue"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

MUTATIONS = [
    # ── §1 · the act is derived from the hop ───────────────────────────────────────────────────
    (
        "M1 · ⛔ the asker is drawn as a silent parent · the first participant RAISED the thing and the chain then says it *has not answered* its own question. ⚑ `HO-088` §6's first clause — *Ali asked* — is the one word on the chain that is not about silence, and this is it gone",
        [(QUEUE, "    { name: first.waiting, you: false, did: raised },", "    { name: first.waiting, you: false, did: HAS_NOT_ANSWERED },")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The anchor `'a-proposal': 'proposed'`
        # in persons-queue.ts is gone, because the proposal population was removed ('Proposals go
        # end to end'). The queue's remaining populations are questions and decisions. Its anchor is
        # left stale, so the census records it retired.
        "M2 · ⚠️ a proposal is drawn as a question · `RAISED_IT` answers *asked* for the population `WHY_ITS_YOURS` describes as *nothing exists until you decide*. ⛔ A chain that says *asked* over a proposal names the question channel under a row that never entered it",
        [(QUEUE, "  'a-proposal': 'proposed',", "  'a-proposal': 'asked',")],
    ),
    (
        "M3 · ⚠️ …and a permission is drawn as a proposal · ⚑ SEPARATE from M2 because the two arms are one table and a repair that swapped them would pass a test asserting only that they DIFFER. 🔴 A permission IS a `RoutedRequest`: what it was refused is entry to the channel, not the asking",
        [(QUEUE, "  'a-decision': 'asked',", "  'a-decision': 'proposed',")],
    ),
    (
        "M4 · ⛔ every later participant is drawn as an asker · the chain becomes four conversations that each *asked* and nobody who owes anything. ⚑ The constant exists so the claim is made once; this is what it would mean for it to be made wrongly once",
        [(QUEUE, "const HAS_NOT_ANSWERED: PersonsQueueDid = 'has-not-answered'", "const HAS_NOT_ANSWERED: PersonsQueueDid = 'asked'")],
    ),
    # ── §2 · null is exactly the one that is not a conversation ────────────────────────────────
    (
        "M5 · 🔴 the PERSON is given an act · `you` is the one answerer that is not a conversation, and every member of this vocabulary is a conversation's act. ⛔ The chain then ends *you has not answered* — an accusation drawn from a walk whose whole conclusion is that the answer is now theirs",
        [(QUEUE, "      did: hop.on === null ? null : HAS_NOT_ANSWERED,", "      did: HAS_NOT_ANSWERED,")],
    ),
    (
        "M6 · ⛔ an EMPTY reading draws a bare `you` · `persons-queue.ts`'s own rule since `401` — *an empty reading gives an empty chain, and never a bare `you`* — with a hop that names a person as the answerer of a walk that has no hops in it. ⚠️ Unreachable from `escalationChain` and legal on the wire, which is why the guard is there at all",
        [(QUEUE, "  if (first === undefined) return []", "  if (first === undefined) return [{ name: YOU, you: true, did: null }]")],
    ),
    # ── §3 · the word the walk establishes ─────────────────────────────────────────────────────
    (
        "M7 · 🔴 **`HO-088` §6'S OWN WORDS, PUT BACK** · every hop then claims a parent COULD NOT answer. ⛔ `WHY_ITS_YOURS` refused exactly this in `403`: *the second is an inability the walk never establishes* — escalating ends nothing, `REQUEST_IS_OPEN` is what admitted the row, and the parent may still answer. ⚑ Nothing throws; it is a true-looking sentence about somebody else's ability",
        [(QUEUE, "  'has-not-answered': 'has not answered',", "  'has-not-answered': 'could not answer',")],
    ),
    (
        "M8 · ⚠️ the act says less than the row it sits on · *waiting* is true of a hop and is not the claim the row makes; `KIND_WORDS.escalated` says *nobody above has answered* one line up. ⛔ Two strengths of one claim on one card, and the weaker one is beside the names",
        [(QUEUE, "  'has-not-answered': 'has not answered',", "  'has-not-answered': 'waiting',")],
    ),
    (
        "M9 · ⛔ the asker's word drifts from the ruling's · `HO-088` §6 words it *asked*, the shape the person has said reads well. ⚑ A table whose words are only ever read back through itself would not notice — which is why the words are asserted as independent literals",
        [(QUEUE, "  asked: 'asked',", "  asked: 'raised a question',")],
    ),
    (
        "M10 · 🔴 a request ALREADY A PERSON'S becomes a hop · the walk's lookup stops asking where the question went, so a permission — a request no parent was ever allowed to be asked — is drawn as a conversation that *has not answered*. ⛔ This is `613` §4.1's causes flattened into one word, and the narrowing is the only thing that ever kept them apart ⚑ ANCHOR CORRECTED IN PLACE BY 611 — and the row got WIDER: `611` gave the destination three named arms, so flattening now admits BOTH a permission and a question its asker ADDRESSED to a person, whose parent was never asked either",
        # ⚠️ **611 · CORRECTED IN PLACE, never retired.** The conjunct this row deletes is
        # spelled by {@link WhereARequestWent} now (HO-088 §2). ⛔ **The subject MOVED and did
        # not die**: flattening is still writable, still type-correct, and the defect it
        # creates is strictly WIDER than the one `613` measured.
        [(HOST, ".find((one) => REQUEST_IS_OPEN[one.state] && one.went.to === 'the-parent') ?? null", ".find((one) => REQUEST_IS_OPEN[one.state]) ?? null")],
    ),
    # ── §4 · one vocabulary, two surfaces ──────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row removes the act (`DID_WORDS`)
        # from the project band in ProjectWorkspace.vue, which was deleted (count_now -1). The
        # project rooms and band went with the card line 'the project rooms, board, sheet and picker
        # … are removed'. The queue's own rendering of the hop is a separate subject. Its anchor is
        # left stale, so the census records it retired.
        "M11 · ⛔ the project band loses the act · the same hop reads *Ali asked · Ada has not answered* in the queue and *Ali · Ada* in the band. ⚑ `452 relay 1` moved `KIND_WORDS` into the module for exactly this: two sentences for one fact, free to disagree",
        [(WORK, "                  <span\n                    v-if=\"hop.did !== null\"\n                    class=\"decision-did\"\n                    data-cy=\"project-decision-did\"\n                    >{{ DID_WORDS[hop.did] }}</span\n                  >\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row removes the `DID_WORDS` import
        # from ProjectWorkspace.vue, which no longer exists. The project band it planted a defect in
        # was removed on purpose with the project rooms. Its anchor is left stale, so the census
        # records it retired.
        "M12 · ⚠️ the band reads its own table · the import goes and the component draws from a name nothing defines. ⛔ The census that would have caught a SECOND spelling is scoped to declarations; this is the other direction, and it is what makes the positive half of that census load-bearing",
        [(WORK, "  DID_WORDS,\n  KIND_WORDS,\n  rowsInProject,", "  KIND_WORDS,\n  rowsInProject,")],
    ),
    (
        "M13 · ⛔ the queue reads its own table · M12's mirror on the surface the module was written for. ⚑ SEPARATE because a repair that restored one import would leave the other, and `an-exception-made-at-one-depth-of-a-walk` is what one-of-two costs · killed by `the-room-behind-the-door.render.test.ts`",
        # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · ee796dfa added actionLinesOf, broaderLinesOf and isAPrimaryAnswer to the import between KIND_WORDS and sinceWords; the plant still removes the shared DID_WORDS import while the chain still draws from it.
        # ⚑ **W4.584 · re-anchored in place, not retired** — the stopped band's press words joined the import beside DID_WORDS; the plant still removes the shared DID_WORDS import while the chain still draws from it
        # ⚑ **W4.631 · re-anchored in place, not retired** — the stopped band's take-back press now reads TAKE_BACK from take-back.ts, so DID_WORDS sits beside KIND_WORDS again; the plant still removes the shared DID_WORDS import while the chain still draws from it
        [(PANEL, "  DID_WORDS,\n  KIND_WORDS,\n  LOOK,\n", "  KIND_WORDS,\n  LOOK,\n")],
    ),
    # ── §5 · said, seen and heard ──────────────────────────────────────────────────────────────
    (
        "M14 · 🔴 **THE DEFECT THIS DISPATCH SHIPPED INTO ITS OWN FIRST DOM RUN** · the space node goes, Vue's `condense` pass drops the newline between the two spans, and the hop reads `Aliasked` to anything with no screen. ⛔ The margin still paints the gap, so every screenshot looks right and only `innerText` says otherwise",
        [(PANEL, "              {{ ' ' }}\n", "")],
    ),
    (
        "M15 · ⚠️ the arm comes off the row · a reader can then only tell two acts apart by matching prose, which `SINCE_PHRASE`'s own rule on this card forbids — and the person's hop stops being distinguishable from a hop whose act nobody wrote",
        [(PANEL, '              :data-did="hop.did"\n', "")],
    ),
    (
        "M16 · ⛔ the act is painted as loudly as the name · the chain becomes eight equal words and the NAMES stop being the thing a person scans. ⚑ Asserted as contrast against the card behind both rather than as a class, so a token retune moves with it and this does not",
        [(PANEL, ".pq-did {\n  margin-left: var(--space-2);\n  color: var(--faint);", ".pq-did {\n  margin-left: var(--space-2);\n  color: var(--text-soft);")],
    ),
]
