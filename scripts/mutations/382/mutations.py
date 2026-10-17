"""382 · The map before the move.

⛔ **A map is a document until something refuses a field it forgot.** This commit moves nothing on
screen, so every row below attacks the same one thing: the claim that
`apps/desktop/src/renderer/src/lib/design-v2-map.ts` answers for every value v2.3 draws, names a
real product source for each, and has not quietly pasted a safety sentence into the product.

## 🔴 The three ways a map fails while reading as complete

1. **It loses a field.** A row disappears and nothing notices, because the left-hand column was
   transcribed rather than derived, and the drawing is not in the repository to derive it from.
   ⚑ `M1`, `M2`, `M6`.
2. **It points at nothing.** A module that does not exist, an export that was renamed, a member
   invented while writing prose. ⚑ `M3`, `M4`. `a-pointer-clause-is-a-claim`.
3. **It goes soft on the copy.** A false sentence re-graded as supported, a quote edited until it
   stops matching the design, an exemption widened until the paste census sees nothing. ⚑ `M7`-`M12`.

## ⚠️ The drawing is not in the repository

⛔ **The design drawings stay private, so `docs/design/brobot-v2.3.html` does not exist here and no
test compares a field, a verb or a quote with it.** The map's left-hand column is the reference.
⚑ `M11`'s anchor is retired. ⚠️ `M1`, `M6` and `M9` still APPLY, because their anchors are in the
map, and no test kills them: each survives by construction, is named on its row, and is for landing
to record or retire. `M2` is killed by `the-bar-and-the-shelf.test.ts`.

## ⛔ Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`, `M2` | ⚑ **`apps/desktop/test/the-map-before-the-move.test.ts`** — the field is in the design and not in the map. ⚠️ That test cannot read the drawing, which is not in the repository: `M2` is killed by `the-bar-and-the-shelf.test.ts`, and `M1` by no test |
| `M3`, `M4` | ⚑ **…** §4 — a pointer that does not resolve |
| `M5` | ⚑ **…** §4 — a `derived`/`hole` with no reason |
| `M6` | no test kills it: a host verb the design can ask for and the map does not classify, which needs the drawing to compare against |
| `M7`, `M8` | ⚑ **…** §5 — the verdicts, in both directions |
| `M9` | no test kills it: the enumeration drifting away from the drawing, which is not in the repository |
| `M10` | ⚑ **…** §6 — the paste census, and the exemption that would blind it |
| `M11` | retired: the exclusion list used as a silencer, in a check that read the drawing |
| `M12` | ⚑ **…** §7 — a provider named in the renderer |
| `M13` | ⚑ **…** §4 — a sentence field with no source, which is standing rule 5 |
| `M14` | ⚑ **…** §4 — `unhoused` collapsing into `hole` |

## ⚠️ What this table deliberately does NOT contain

⛔ **No row on the ORDER of `V23_FIELD_MAP`.** Every check is a set operation, so a permutation
could not be refused — `a-line-no-mutation-can-kill-is-not-carrying-its-rule`, recorded rather than
shipped as a survivor.

⛔ **No row changing an `absent` string's WORDS.** §4 asserts a non-empty answer and nothing else,
which is honest: what a surface draws when the product is silent is a design decision this commit
records and does not yet enforce. ⚠️ A row here would be a no-op reporting as a survivor.

⛔ **No row on `V23_ACTIONS`' four holes becoming `bound` with a real command.** There is no command
to name — that is the finding — so the mutation could not be written without inventing an export,
which `M4` already covers from the other side.

## ⚠️ What `M5` measures, and what it cannot

⛔ **`M5` was written to say *"a derivation with no derivation stated"* and its first version
SURVIVED**, because it only stripped the emoji off the front of a paragraph that still said
everything. ⚑ Rewritten to gut the note, it kills — which is the honest scope of the check behind it:
§4 asserts a `derived` or `hole` note is SUBSTANTIAL, not that it is about the derivation. ⚠️ A note
reworded into eighty characters of nothing would pass, and no assertion here can tell the difference.
Recorded rather than left for a reader to assume otherwise.

## 🔴 The one row whose absence is a finding

⛔ **There is no row for *"a field that v2.3 draws only in a RENDER function and never in a
fixture"*.** A field comparison over the drawing's fixture block cannot see `recordKind` and
`requests[].decision` — both real, both mapped. ⚑ The map answers them anyway; nothing forces it to.
Closing it needs the renderer block parsed as well, and a regex over half a megabyte of template
literals is not an instrument to trust. ⚠️ Named here so the coverage number is not read as
exhaustive; the drawing is not in the repository, so no such comparison runs.
"""

MAP = "apps/desktop/src/renderer/src/lib/design-v2-map.ts"
TEST = "apps/desktop/test/the-map-before-the-move.test.ts"

MUTATIONS = [
    # ── §1/§2 · a field the design draws and the map lost ─────────────────────────────────────
    (
        # ⚠️ **No test kills this row.** The field list is the reference and the drawing it came
        # from is not in the repository, so nothing refuses a renamed path. The anchor still
        # applies, so the row survives: landing records it or retires it.
        "M1 · ⛔ the tool inventory's third state is dropped from the map · `tools.inventoryExposed` "
        "is the field that decides whether a provider publishes anything at all, and a map missing "
        "it lets the binding pass with `untold` and `unpublished` collapsed",
        [
            (
                MAP,
                "    path: 'tools.inventoryExposed',",
                "    path: 'tools.inventoryExposedRENAMED',",
            )
        ],
    ),
    (
        "M2 · 🔴 the credential ownership hole is quietly renamed away · the slot v2.3 draws stops "
        "being answered for, so the next commit meets an empty chip with no record that nothing "
        "fills it",
        [
            (
                MAP,
                "    path: 'launch.credentialOwner',",
                "    path: 'launch.credentialOwnerDROPPED',",
            )
        ],
    ),
    # ── §4 · a pointer that does not resolve ──────────────────────────────────────────────────
    (
        "M3 · ⛔ a module path that no longer exists · the map claims the approvals copy lives "
        "somewhere it does not, which is the exact shape of the citation `370` got wrong and "
        "nothing could catch",
        [
            (
                MAP,
                "const APPROVALS = `${LIB}/approval-mode.ts`",
                "const APPROVALS = `${LIB}/approval-modes.ts`",
            )
        ],
    ),
    (
        "M4 · ⛔ a symbol invented while writing prose · `SPAWN_RAIL_MEANS` is the constant the "
        "consent sentence must be rendered from, and a map naming a neighbour instead sends the "
        "next commit to write its own",
        [
            (
                MAP,
                "    renderFrom: [ref(CAPS, 'SPAWN_RAIL_MEANS')],",
                "    renderFrom: [ref(CAPS, 'SPAWN_RAIL_DISCLOSURE')],",
            )
        ],
    ),
    (
        "M5 · ⚠️ a derivation with no derivation stated · the lossiest field in the map keeps its "
        "three sources and loses the paragraph saying three independent axes were flattened into "
        "one word — a reader meets a pointer and no warning",
        [
            (
                MAP,
                # ⚑ **Anchor corrected by 384 §1.2, not retired.** The note now records the
                # settlement rather than asking for it; the row is unchanged in what it measures —
                # it still guts the derivation's reason and leaves `state: 'derived'` behind.
                '      note: \'🔴 **The lossiest field in the map. `384 §1.2` SETTLED it — the view model keeps the three facets, and this field is a PROJECTION of them, computed at the moment of drawing and never the only thing on screen.** `status-projection.ts` is the decision and `one-word-and-what-it-drops.test.ts` measures its cost over the whole facet space. ⛔ **Two of the product’s nine words have no word in v2.3 at all — `background` and `scheduled` — and BOTH have a control behind them**, which is why the projection returns `null` there rather than picking the nearest lie.** v2.3 has ONE status from a flat twelve-word list. The product has `SessionStatus` (five) crossed with three INDEPENDENT facets — what the agent is DOING, what it IS, and what it NEEDS FROM YOU — which `035` split apart on purpose and `378` warned against re-collapsing: *"do not use a single busy badge or broad amber status for everything."* ⛔ A single `status` cannot say *working AND waiting on a permission*, which is the exact pair the composer-freeze rule turns on.\',',
                "      note: 'Derived.',",
            )
        ],
    ),
    # ── §3 · a verb the design can ask a host for ─────────────────────────────────────────────
    (
        # ⚠️ **No test kills this row.** The map's verbs are the reference and the drawing that
        # passes verbs to its bridge is not in the repository, so nothing refuses a renamed verb.
        # The anchor still applies, so the row survives: landing records it or retires it.
        "M6 · ⛔ the refused-spawn retry stops being classified · `retryDelegation` is a button v2.3 "
        "draws on a `permanent` refusal, and a map that does not name it lets a control that can "
        "never succeed reach the binding unremarked",
        [
            (
                MAP,
                "    action: 'retryDelegation',",
                "    action: 'retryDelegationX',",
            )
        ],
    ),
    # ── §5 · the verdicts ─────────────────────────────────────────────────────────────────────
    (
        "M7 · 🔴 the false safety sentence is re-graded as supported · *'Agent-created conversations "
        "still always ask a person before acting'* becomes shippable copy, which is `086` in the "
        "reassuring direction on the one surface where an agent created it is a certainty",
        [
            (
                MAP,
                "    quote: 'Agent-created conversations still always ask a person before acting.',\n    heldIn: ['v2.3'],\n    verdict: 'false',",
                "    quote: 'Agent-created conversations still always ask a person before acting.',\n    heldIn: ['v2.3'],\n    verdict: 'supported',",
            )
        ],
    ),
    (
        "M8 · ⛔ a supported sentence loses the constant it must be rendered from · the paste is then "
        "the only way to draw it, which is the transfer-by-hand `382 §2` forbids",
        [
            (
                MAP,
                "    renderFrom: [ref(TOOLS, 'WHY_EVERY_CONVERSATION')],\n    why: '⚑ The best sentence in v2.3",
                "    renderFrom: [],\n    why: '⚑ The best sentence in v2.3",
            )
        ],
    ),
    (
        # ⚠️ **No test kills this row.** The map's quote is the reference and the drawing it comes
        # from is not in the repository, so nothing checks it verbatim. The anchor still applies,
        # so the row survives: landing records it or retires it.
        "M9 · ⚠️ the enumeration drifts off the design · one quote is reworded so it no longer "
        "appears in `brobot-v2.3.html`, and an audit that has stopped describing the file it audits "
        "reports clean forever",
        [
            (
                MAP,
                "    quote: 'Closed and discovered sessions are inspected, not resumed.',",
                "    quote: 'Closed and discovered sessions are inspected, and not resumed.',",
            )
        ],
    ),
    # ── §6 · the paste census, and the exemption in front of it ───────────────────────────────
    (
        "M10 · 🔴 the exemption is widened from one file to a directory · every future paste into "
        "`renderer/src/lib` becomes invisible, and the count that must be zero is measured over a "
        "tree with the interesting half removed. ⚠️ **This row SURVIVED its first verification** — "
        "the paste census cannot guard its own scope, because there is nothing pasted there yet to "
        "find. The exactly-one-exemption assertion beside it is what this row bought",
        [
            (
                TEST,
                "    const files = every.filter((file) => file.file !== EXEMPT)",
                "    const files = every.filter((file) => !file.file.includes('renderer/src/lib'))",
            )
        ],
    ),
    # ── §2 · the exclusion list used as a silencer ────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (the design drawings stay private):** the exclusion list this row
        # planted `title` in only filtered the keys read out of the drawing's fixtures, and no test
        # reads the drawing. Its anchor is left stale, so the census records it retired.
        "M11 · ⛔ a real field is excluded from the coverage walk · `title` is dropped as though it "
        "were parser noise, and the still-needed check passes because the name genuinely appears — "
        "coverage shrinks with both assertions green",
        [
            (
                TEST,
                "    test: 'Inside the example command string `npm run test:ui`, not a key.',",
                "    test: 'Inside the example command string `npm run test:ui`, not a key.',\n    title: 'Excluded.',",
            )
        ],
    ),
    # ── §7 · the rule the map is written to obey ──────────────────────────────────────────────
    (
        "M12 · ⛔ a provider is named in the renderer tree · the per-provider copy map is the most "
        "tempting place in the app to write one down, and `039`'s architecture goes one reasonable "
        "line at a time",
        [
            (
                MAP,
                "    slot: '<provider>.launchDisclosure',",
                "    slot: 'codex.launchDisclosure',",
            )
        ],
    ),
    # ── §4 · standing rule 5, and the two states that must stay apart ─────────────────────────
    (
        "M13 · 🔴 a sentence field is downgraded to a hole · the tool provenance line stops naming a "
        "source, so the copy a person reads has no constant behind it — a safety sentence with no "
        "test is a comment",
        [
            (
                MAP,
                "    binding: { state: 'bound', from: [ref(TOOLS, 'InventoryReading.provenance')] },\n    absent:",
                "    binding: { state: 'hole', note: 'The provenance sentence is composed in the template.' },\n    absent:",
            )
        ],
    ),
    (
        "M14 · ⛔ an `unhoused` product fact is re-filed as a hole · `ForeignServer` exists and is "
        "drawn today, and calling it a hole turns a layout decision this design owes into a "
        "capability proposal for a later slice",
        [
            (
                MAP,
                "      state: 'unhoused',\n      from: [ref(TOOLS, 'ForeignServer'), ref(TOOLS, 'InventoryReading')],",
                "      state: 'hole',",
            )
        ],
    ),
]
