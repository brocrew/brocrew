"""329 · A boundary crossed before the screen says so — each row is THE DEFECT, put back verbatim (131).

⛔ **What 329 fixed, in one sentence.** Launching the app copies the machine's Codex credential into
a profile's folder before any conversation exists, and opening *All conversations* reads the user's
own `~/.claude` and `~/.codex` before **Check homes** is pressed — and the only place the product
said either of those things was the conversation Info panel, after the fact.

## ⚑ Neither behaviour changed, and no row here mutates one

`085` chose per-profile folders, `prepareProviderHome` creates one on first use, `provisionCodexAuth`
copies once at `0600` and never overwrites, and `257 §2` refuses to probe a profile that does not
exist. ⛔ **Every row below mutates a SENTENCE or the data a sentence is composed from.** A reader
looking for a row that weakens the guard will not find one; that is the dispatch's own §5 trap.

## 🔴 The two facts that make this table read the way it does

⚠️ **The launcher's own model probe is what performs the copy.** `RuntimeScreen` asks every known
profile for its models on mount; `prepareProviderHome` is the first thing that probe does. So the
screen that must disclose the act is the screen that commits it, and `M3`/`M4` are about the two
moments — an existing profile (already, on open) and a name being typed (not yet, by `257 §2`).

⚠️ **`Check homes` never reads the user's own folders.** `adoptSessions` walks
`<userData>/provider-homes/…` only. So `M17` is the row that puts the dispatch's own framing back:
a page telling a reader that pressing the button is how the machine gets read would be FALSE, and
it is the shape a well-meaning fix takes.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M10` | ⚑ **`run_suite`** — `test/dom/profile-credential.dom.test.ts`, `test/profile-credential.test.ts`, `test/dom/profile-picker.dom.test.ts` |

⚠️ **579 · that first row is out of date in two ways and neither is this dispatch's doing alone.**
⛔ **`test/dom/profile-picker.dom.test.ts` does not exist** — `417` deleted the picker and the file
with it, and this map was never corrected. ⛔ **And `M8`'s killer is now
`test/dom/a-front-door-that-asks-nothing.dom.test.ts`** (§4, *the credential line is behind a press
and still BEFORE*), because `579` re-aimed the row onto the WORD a person presses and the three
files named above read the credential SENTENCE rather than the opener. ⚑ Both are recorded here
rather than repaired silently, because a gate map is a claim like any other and a wrong one sends
the next run looking for a survivor that is really a mis-pointed suite.
| `M11`-`M15` | ⚑ **`run_suite`** — `test/credential-disclosure.test.ts`, which runs the real provisioning against a temp home. ⛔ This is the gate `308` did not have: its `M6` and `M12` — *"the Codex note reverts to 'copied in once'"* and *"the English lies while the table stays honest"* — **survived the whole suite** |
| `M16`-`M20` | ⚑ **`run_suite`** — `test/dom/library-scope.dom.test.ts`, the head half |
| `M21`-`M26` | ⚑ **`run_suite`** — the same file's scope half, plus its pure-function block |

## ⚑ Every row was MEASURED, one at a time — and the table was NOT run

⛔ **the person's ruling stands: a whole-table run costs hours of his machine and is his call alone.** So
each row below was applied on its own, the targeted suites were run, and the tree was restored and
hash-checked before the next one. **26 of 26 went RED.** No row here is a prediction.

⚠️ **The first pass of that measurement was worthless and is worth recording.** The library rows were
measured while `library-scope.dom.test.ts` was already failing — a parameter had been added to
`searchScopeNote` and its three direct callers in that file had not been updated — so every row read
`RED` for a reason that had nothing to do with the mutation. `310`'s lesson in a new place: a verdict
taken against a suite you have not seen green is not a measurement. They were re-measured.

🔴 **Two rows only became real during that pass**, and both were found by an adversarial review of
this dispatch's own diff rather than by re-reading it:

* **`M5`** — the row that guards `039`'s core inference — would have SURVIVED. Every assertion in
  `profile-credential.dom.test.ts` passes when the line is wired to `reprovisionAuth` instead:
  that entry is `available`/`absent` on the same providers, and the timing clause is appended
  whichever capability supplied the words. The declaration itself is the oracle now.
* **`M15`** replaced only the PREFIX of Claude's `checkedAgainst`, so the mutant kept
  `provisionCodexAuth`, `child-env.ts` and the test's own name — it still named evidence, every gate
  still passed, and the row would have recorded as a survivor describing a defect it never produced.
  Anchor corrected in place, label untouched (142).

## ⚠️ What this table deliberately does NOT contain

⛔ **No row mutates a test file.** A mutation to a gate cannot be caught by the suite the gate is
part of, so such a row records as SURVIVED and means nothing — `310`'s no-op lesson in another form.
`329` widened `provider-capabilities.render.test.ts` from a hard-coded three capability names to all
eleven, and that widening is reported in the response rather than mutated here.

⛔ **No row mutates the `Array.isArray` guard on `profileExists`.** That trap already has a row —
`310 M15` — and `329` only moved the expression into a named computed shared by two sentences. Its
anchor is corrected in place here (`142`); a second row on the same line in a second table would be
one defect counted twice.

⛔ **No row mutates `provider-config.ts`.** `308` owns that sentence and `disclosure-answers-to-the-
code.test.ts` binds it; a second table anchoring on the same line is what `142` is about.


## ⚑ ANCHORS CORRECTED IN PLACE BY `417`

⛔ **`417` removed the launcher's provider `<select>` (HO-022 §2), so `provider.value` became `props.defaultProvider` on the three capability lookups.** ⚠️ **The recorded outcome for every corrected row below was measured against the OLD text** — this table is `unrun`, so there is no artefact verdict to invalidate, and each corrected row was verified RED BY HAND at `417` (apply → run its own killer → restore from bytes). ⚑ The defect and the kill are identical; only the surrounding text moved.
"""

CAPS_CODEX = "packages/runtime/src/codex/capabilities.ts"
CAPS_CLAUDE = "packages/runtime/src/claude/capabilities.ts"
FIELD = "apps/desktop/src/renderer/src/lib/profile-credential.ts"
LAUNCHER = "apps/desktop/src/renderer/src/components/NewConversation.vue"
# ⚑ **384 §1.1 lifted `PROFILE_OWNS` and `PROFILE_NEW_NOTE` out of the launcher and into `lib/`**,
# so two surfaces can render one string. M1 and M9 follow the constant; every other row here is
# about the launcher's TEMPLATE and stays where it is.
WORDS = "apps/desktop/src/renderer/src/lib/profile-words.ts"
# ⚑ 579 · where the word a person presses to reach the credential sentence lives — see `M8`.
FRONT_DOOR_WORDS = "apps/desktop/src/renderer/src/lib/front-door-words.ts"
LIBRARY = "apps/desktop/src/renderer/src/components/SessionLibrary.vue"

MUTATIONS = [
    # ── the launcher's own line ───────────────────────────────────────────────────────────────
    (
        "M1 · ⛔ THE DEFECT, verbatim · `PROFILE_OWNS` promises *the sessions and sign-in kept "
        "there* again — the clause `328` read as *my sign-in would go there* and which is simply "
        "FALSE on the provider that writes nothing into the folder (015)",
        [
            (
                # ⚑ **Anchor corrected AGAIN by 384 §1.1, and again not retired** — the constant
                # moved to `lib/profile-words.ts` so `SessionInfo.vue` could render the same string
                # instead of typing it out. The text and the defect are untouched.
                WORDS,
                # ⚑ **Anchor corrected by 356, not retired.** `CLAUDE.md` was one provider's
                # filename stated for both, and 357 established this app authors neither leaf; the
                # sentence now names the THING. ⛔ The row is unchanged in what it measures: it still
                # replaces "the conversations it runs there" with "the sessions and sign-in kept
                # there", so the line stops naming what a person actually goes looking for.
                "  'A profile is an agent’s own home: the conversations it runs there, its own instruction file, ' +",
                "  'A profile is an agent’s own home: the sessions and sign-in kept there, its own instruction file, ' +",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING:** the launcher no longer says anything about a credential; sign-in moved to provider setup (daa7c0144, the approved first-run design).
        "M2 · 🔴 the launcher says nothing at all about a credential — the state the app shipped in, "
        "where the screen making the copy was the one surface silent about it. "
        "⚑ ANCHOR CORRECTED IN PLACE BY 579: the element carries a `v-if` of its own now, and a "
        "SECOND one is `Duplicate attribute.` — a compiler ERROR that `@vitejs/plugin-vue` raises "
        "through `pluginContext.error`, so the mutant would not transform and every suite "
        "importing the component would die. ⛔ That is a RED for a build break rather than for "
        "this row's defect (`a-true-mutation-measures-nothing`, one direction over), and "
        "`mutations:check` could not have seen it because the anchor still matched. "
        "⚠️ Measured with the repo's own `@vue/compiler-sfc@3.5.40`: two `v-if`s compile to the "
        "LAST one, with `errors: ['Duplicate attribute.']`. "
        "⚑ The row flips the OPENER off, not the body, and that is two corrections rather than "
        "one. ⛔ Blanking the body leaves *a press that opens nothing* — a person still reads "
        "*what this profile does with your sign-in* on screen, which is not this row's defect. "
        "⚑ With no opener there is no press, so the `v-if` on the body can never be true either: "
        "the column says NOTHING about a credential in any state, which is the shipped silence "
        "verbatim. ⚠️ **And it keeps the row off a line a source census pins**: "
        "`scripts/test/info-disclosure-reach.test.mjs` asserts the body sits behind "
        "`open.has('credential')`, so mutating THAT line would make this row killable by a grep "
        "and its RED unattributable to any behavioural gate "
        "(`a-source-census-that-pins-a-line-kills-every-row-on-it`). "
        "🔴 RE-VERIFIED BY HAND AT 579: applied alone, RED 27 of 44 across "
        "`dom/profile-credential.dom.test.ts`, `dom/a-front-door-that-asks-nothing.dom.test.ts` "
        "and `dom/the-screen-whose-job-is-start-typing.dom.test.ts`; restored from bytes and "
        "hash-checked",
        [
            (
                LAUNCHER,
                '            data-cy="launcher-why-credential"',
                '            v-if="false"\n            data-cy="launcher-why-credential"',
            )
        ],
    ),
    (
        "M3 · ⚠️ the timing clause is dropped, so the sentence states a rule and never says WHEN. "
        "⛔ *Say it before, not after* is the whole of §4.1 and this is the half that carries it",
        [(FIELD, "${said} ${timing(when)}", "${said}")],
    ),
    (
        "M4 · 🔴 the two moments are swapped: an existing profile is told *nothing has been written "
        "for this name yet* while its folder already holds the copy, and a name being typed is told "
        "the copy is made when the screen asks for models — which `257 §2` guarantees it is not",
        [(FIELD, "return when === 'new'", "return when !== 'new'")],
    ),
    (
        # ⛔ **RETIRED BY RULING:** the launcher's credential line this row reads is gone; sign-in moved to provider setup (daa7c0144, the approved first-run design).
        "M5 · ⛔ the line is read off `reprovisionAuth` instead of `homeCredential` — *you may press "
        "a button to re-copy* rendered as *a copy was already made*. ⚑ Both are `available` on one "
        "provider and `absent` on the other, which is exactly why `039` forbids the inference: the "
        "STATES agree and the sentences do not. ⚑ ANCHOR CORRECTED IN PLACE BY 417",
        [
            (
                LAUNCHER,
                "  () => props.capabilities?.[props.defaultProvider]?.homeCredential ?? pendingCapability,",
                "  () => props.capabilities?.[props.defaultProvider]?.reprovisionAuth ?? pendingCapability,",
            )
        ],
    ),
    (
        "M6 · ⚠️ the provider that writes nothing gets no sentence, so one launcher discloses and "
        "the other is silent — and a person cannot tell *nothing is copied here* from *nobody has "
        "said*, which is `310`'s defect on a second field",
        [
            (
                FIELD,
                "  return { text: status.reason, tone: 'note', copies: false }",
                "  return { text: '', tone: 'note', copies: false }",
            )
        ],
    ),
    (
        "M7 · the register collapses: a copy of the user's sign-in is drawn in the same quiet ink as "
        "*nothing is written here*. ⚑ 171 §3's rule — a consequence is not advice",
        [(FIELD, "tone: 'consequence', copies: true", "tone: 'note', copies: true")],
    ),
    (
        "M8 · ⛔ the disclosure is hidden behind a press that does NOT name it — *a disclosure a fold "
        "can hide is not a disclosure* (171 §3). "
        "🔴 RE-AIMED BY 579, and the revision is stated rather than silent. The row read *the "
        "disclosure moves INSIDE the fine-tuning fold*; `417` deleted that fold and `EXT-010` §2.1 "
        "put this sentence behind a press of its own — *\"a sign-in explanation nobody opening a "
        "conversation is wondering about… behind a disclosure.\"* ⚠️ So the row as written now "
        "measures the SHIPPED design and would report the product as the defect. "
        "⛔ Opening `171 §3` rather than quoting this label: it says the consequence *\"must be "
        "SAID, once, WHERE THE MODE IS CHOSEN — not in a changelog\"*, and cites `031` — *a "
        "paragraph nobody reads is worse than nothing* — in the same breath. It is a rule about "
        "PLACE, and this label was a stronger gloss than its own citation (standing rule 19). "
        "⚑ What survives, and what this row measures now: the DIFFERENCE between the two folds is "
        "that the opener names its subject. Blank the word a person presses and the fold becomes "
        "`M8`'s original defect exactly — something hidden behind a control that says nothing "
        "about what is in it. "
        "🔴 RE-VERIFIED BY HAND AT 579: applied alone, RED 2 of 40 — "
        "`dom/a-front-door-that-asks-nothing.dom.test.ts` §4 (the opener's own subject) and "
        "`dom/the-screen-whose-job-is-start-typing.dom.test.ts` §4 (every opener names what is "
        "behind it, walked from this table's keys); restored from bytes and hash-checked. "
        "⚠️ **Neither killer is one of the three this table's gate map names** — see the note "
        "there",
        [
            (
                FRONT_DOOR_WORDS,
                "  credential: 'what this profile does with your sign-in',",
                "  credential: 'more',",
            )
        ],
    ),
    (
        "M9 · ⚠️ the credential sentence is appended to `PROFILE_OWNS` instead of standing beside it, "
        "so the one line 031/167 §3 hold that constant to becomes two — and the per-provider truth "
        "is buried inside a line that is the same for every provider",
                # ⚑ **384 §1.1** — the constant moved to `lib/`; the row is unchanged.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: PROFILE_OWNS is still one line in profile-words.ts, and
        # profile-credential.dom.test.ts still asserts it does not promise a sign-in. Only the
        # constant's wording moved ("across every project it works in" became "in every folder it
        # works in"), so the `old` is corrected and the plant still appends the credential sentence
        # to the constant. Killed by `profile-credential.dom.test.ts`.
        [
            (WORDS, "  'and what it remembers — in every folder it works in.'\n", "  'and what it remembers — in every folder it works in.\\nIts sign-in starts as a copy of yours.'\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING:** the launcher's credential line this row reads is gone; sign-in moved to provider setup (daa7c0144, the approved first-run design).
        "M10 · 🔴 a capability that has NOT ARRIVED is presented as a confident answer — the "
        "launcher tells a person nothing of their sign-in is written here on the strength of a "
        "fetch that has not returned. ⚑ `310`'s whole lesson on a second field: a silence rendered "
        "as a fact is the one thing a person cannot argue with. ⚑ ANCHOR CORRECTED IN PLACE BY 417",
        [
            (
                LAUNCHER,
                "  () => props.capabilities?.[props.defaultProvider]?.homeCredential ?? pendingCapability,",
                "  () =>\n    props.capabilities?.[props.defaultProvider]?.homeCredential ?? {\n      state: 'absent',\n      reason: 'Nothing of your sign-in is written into this profile.',\n      checkedAgainst: 'nothing — the capability fetch has not returned',\n    },",
            )
        ],
    ),
    # ── the declarations the sentences come from ──────────────────────────────────────────────
    (
        "M11 · 🔴 the provider whose folder holds a copy declares that nothing is written into it — "
        "the disclosure inverted at its source, with the code unchanged and still copying",
        [
            (
                # Provider facts live in the shared registry; this row plants the same fault there.
                "packages/shared/src/providers/codex-capabilities.ts",
                "  homeCredential: {\n    state: 'available',",
                "  homeCredential: {\n    state: 'absent',\n    reason: 'Nothing of your sign-in is written into this profile.',\n    checkedAgainst: 'the adapter, which no longer says',",
            )
        ],
    ),
    (
        "M12 · ⚠️ the other direction — the provider that writes NOTHING claims a sign-in of its own, "
        "so a person is warned about a copy that 015 forbids anyone to make",
        [
            (
                # Provider facts live in the shared registry; this row plants the same fault there.
                "packages/shared/src/providers/claude-capabilities.ts",
                "  homeCredential: {\n    state: 'absent',",
                "  homeCredential: {\n    state: 'available',\n    note: 'This profile keeps a sign-in of its own, and it starts as a copy of yours.',",
            )
        ],
    ),
    (
        "M13 · ⛔ *never replaced on its own* is dropped while `provisionCodexAuth` still refuses to "
        "overwrite — the sentence understating a guarantee the code keeps. ⚑ This is `308 M6`'s "
        "shape, which survived the entire suite for want of a gate",
        [
            (
                # Provider facts live in the shared registry; this row plants the same fault there.
                "packages/shared/src/providers/codex-capabilities.ts",
                # ⚑ **The fallback sign-in · re-anchored in place, not retired** — the note now also says where a copy comes from when the computer has none; the plant still drops *never replaced on its own*.
                "is made once, is readable only by you, and is never replaced on its own.",
                "is made once, is readable only by you, and is refreshed from your machine when it changes.",
            )
        ],
    ),
    (
        "M14 · 🔴 the note says the profile MINTS its own sign-in rather than copying one — the exact "
        "misreading `328` reported, promoted from the reader's head into the product's own words",
        [
            (
                # Provider facts live in the shared registry; this row plants the same fault there.
                "packages/shared/src/providers/codex-capabilities.ts",
                "Where your machine’s Codex CLI has one, it starts as a copy of that",
                "It is created here, separately from the one your machine’s Codex CLI uses",
            )
        ],
    ),
    (
        "M15 · ⚠️ `checkedAgainst` becomes a restatement of the reason, so the field 029 and 030 cost "
        "this project two false absences to introduce names no evidence at all",
        [
            (
                # Provider facts live in the shared registry; this row plants the same fault there.
                "packages/shared/src/providers/claude-capabilities.ts",
                # ⚠️ **Anchor corrected in place — the LABEL is untouched** (142). The first
                # version replaced only the PREFIX, so the mutant kept `provisionCodexAuth`,
                # `child-env.ts` and the test's own name: it still named evidence, every gate
                # still passed, and the row would have recorded as a SURVIVOR describing a
                # defect it did not produce. It replaces the WHOLE literal now.
                # ⚑ Re-anchored in place: the literal now names where the login is read on Windows too.
                '      \'`provider-homes.ts`: `prepareProviderHome`’s Claude branch calls `claudeAuthHealth` and writes no file — `provisionCodexAuth` is the only writer of a credential into a folder we provision, and it is reached only when `identity.provider === "codex"`. The token comes from `claudeKeychainTokenProvider` (re-read per call, deliberately: the macOS Keychain item, or on Windows Claude Code’s own `.credentials.json`) and reaches the child through `internal/child-env.ts` alone. `credential-disclosure.test.ts` runs both branches against a temp home and asserts this one leaves nothing behind.\',',
                "      'Claude writes nothing of your sign-in into this profile. Claude sessions read your machine login at the moment they start and pass it to the agent for that run only, so there is no Claude copy here to go stale.',",
            )
        ],
    ),
    # ── the library head ──────────────────────────────────────────────────────────────────────
    (
        "M16 · ⛔ THE DEFECT, verbatim · the page says nothing about the read it performs on open. "
        "⚠️ `328` watched 2,696 conversations from the machine's own history arrive without pressing "
        "anything, and there was no sentence anywhere on the page to explain them",
        [
            (
                LIBRARY,
                '          <p class="reads" data-cy="library-reads">',
                '          <p v-if="false" class="reads" data-cy="library-reads">',
            )
        ],
    ),
    (
        "M17 · 🔴 the page tells the reader that pressing the button is how those folders get read — "
        "⛔ **FALSE**: `adoptSessions` walks only the folders this app provisioned and never opens "
        "`~/.claude` or `~/.codex`. ⚑ This is the fix the brief's own framing invites, which is why "
        "it is a row",
        [
            (
                LIBRARY,
                "            Read from {{ ALL_PROVIDER_FOLDERS }} as well as from here, every time this list loads —\n            and nothing in them is changed. {{ CHECK_HOMES }} is a different act: it looks through\n            this app’s own profile folders for conversations it has not recorded.",
                "            {{ CHECK_HOMES }} reads {{ ALL_PROVIDER_FOLDERS }} and adds what it finds to this\n            list.",
            )
        ],
    ),
    (
        "M18 · ⚠️ the read-only promise is dropped. ⚑ `listLibrary`'s own doc says *reading it touches "
        "the user's homes but changes nothing in them* — a disclosure that names the read and omits "
        "that is scarier than the truth and no more informative",
        [
            (
                LIBRARY,
                "            and nothing in them is changed. {{ CHECK_HOMES }} is a different act",
                "            {{ CHECK_HOMES }} is a different act",
            )
        ],
    ),
    (
        "M19 · 🔴 the sentence moves to the first-run empty state — where `counts.total === 0` is "
        "required and the total counts the merged host rows, so on the machine this defect was found "
        "on it can NEVER render. ⛔ The one explanation the page had, unreachable by every reader who "
        "needed it",
        [
            (
                LIBRARY,
                '          <p class="reads" data-cy="library-reads">',
                '          <p v-if="firstRun" class="reads" data-cy="library-reads">',
            )
        ],
    ),
    (
        "M20 · ⚠️ the button's label is spelled out in the prose instead of being the button's own "
        "string, and it is already stale — the sentence points at a control that is not there. "
        "⚑ `310`'s rule for `credential-words.ts`, on a second pair",
        [(LIBRARY, "{{ CHECK_HOMES }} is a different act", "Scan homes is a different act")],
    ),
    # ── what a miss may claim ─────────────────────────────────────────────────────────────────
    (
        "M21 · ⛔ THE DEFECT, verbatim · a miss claims completeness over records it could not open. "
        "⚠️ *No title, first message or working directory across your 2,696 conversations contains "
        "that* over *67 could not be read*",
        [
            (
                LIBRARY,
                "  if (page === null || page.skippedTotal <= 0) return null",
                "  if (page === null || page.skippedTotal >= 0) return null",
            )
        ],
    ),
    (
        "M22 · ⚠️ the qualification fires on a library that read everything — a disclaimer about a "
        "hazard that is not there, which is 106 in the other direction and the reason the note is "
        "gated at all",
        [
            (
                LIBRARY,
                "  if (page === null || page.skippedTotal <= 0) return null",
                "  if (page === null) return null",
            )
        ],
    ),
    (
        "M23 · 🔴 the sentence makes an arithmetic claim — *another 67* — and the two sets are NOT "
        "disjoint: a row we recorded whose provider file is now skipped is counted in `counts.total` "
        "AND in `skippedTotal`",
        [
            (
                LIBRARY,
                "`Nothing in the ${page.skippedTotal} that could not be read ${what} — they are counted at ` +",
                "`Another ${page.skippedTotal} could not be read, so nothing in them ${what} — they are counted at ` +",
            )
        ],
    ),
    (
        "M24 · ⚠️ a count of SKIP RECORDS is recast as a count of conversations. ⛔ One record — *its "
        "state database could not be read* — stands for an entire folder whose conversations were "
        "never enumerated, so the number is not a population and must not be printed as one",
        [
            (
                LIBRARY,
                "`Nothing in the ${page.skippedTotal} that could not be read ${what} — they are counted at ` +",
                "`${page.skippedTotal} conversations could not be read, so nothing in them ${what} — they are counted at ` +",
            )
        ],
    ),
    (
        "M25 · ⚠️ only the search miss is qualified and the FILTERED miss is not — the identical "
        "overclaim, one branch earlier, on a screen a facet press produces",
        [
            (
                LIBRARY,
                '          <p v-if="scopeNote" class="scope" data-cy="library-filtered-scope">{{ scopeNote }}</p>',
                '          <p v-if="false" class="scope" data-cy="library-filtered-scope">{{ scopeNote }}</p>',
            )
        ],
    ),
    (
        "M26 · ⚠️ the miss goes back to naming three of the four fields it searches. ⚑ `matches()` has "
        "tested `entry.provider` since the merge was written and nothing tested that clause, so the "
        "sentence understated the search while the paragraph beneath it overstated its reach",
        [
            (
                LIBRARY,
                "            No title, first message, working directory or provider name",
                "            No title, first message or working directory",
            )
        ],
    ),
]
