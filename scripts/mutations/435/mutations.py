"""435 · a front door that asks nothing and offers everything — each row is THE DEFECT, put back (131).

**HO-025 §5, the ruling this dispatch implements:**

    ⛔ "HO-023 §3 deleted seven controls. What `asks nothing` meant was: do not make configuring a
    session the price of starting a conversation. It did not mean the choices should be
    unavailable, and a person who has to open a settings surface to pick a provider — or cannot,
    because the column has one writer — is worse off than before."

    ⚑ "The front door asks nothing and OFFERS EVERYTHING. Defaults applied, composer focused, the
    choices present and out of the path rather than absent."

⛔ **This is not a revert of `417`.** That dispatch deleted a 2,998-line screen which made a person
answer four questions before typing a word, and the PO reaffirmed the judgement in the same ruling
that corrected it. ⚑ **What comes back is the CHOOSING, not the ASKING** — and every row below is
one of the two halves of that distinction, broken.

## ⚑ The shape of the fix, and therefore the shape of this table

- **§1 · the payload (`M1`–`M4`)** — *asks nothing* survives as a property of the WIRE: an untouched
  door sends the three fields `417` sent, byte for byte, because `model` and `reasoningEffort` are
  written as omissions. Break the omission and the door asks for something nobody chose.
- **§2 · one provider derivation (`M5`–`M8`)** — `435 §4`: *"a second spelling of
  `asked ?? identity ?? fallback` is the drift this repo keeps paying for."* The order gained the
  asked term rather than the surface growing a second copy of it.
- **§3 · one effort derivation (`M9`–`M13`)** — `177 §4` fixed a measured on-screen drift between
  these two surfaces by COPYING the rule into the second file; `417` deleted the first copy with the
  control that read it. `435` gives them one module, and these rows break the module.
- **§4 · the four properties `435 §2` turned *out of the path* into (`M14`–`M20`)** — the composer
  focused, the column scrolling instead of pushing, and the two sentences `274`/`179 §4` paid for.
- **§5 · the censuses' own truth (`M21`–`M23`)** — the sentence that says the provider is fixed once
  it starts, the enumeration that is the only thing catching a renamed picker, and `310`'s sentence
  reaching a screen again.

## 🔴 Which gate can see each row

| row | gate | file that must go red |
|---|---|---|
| `M1` `M2` | `run_dom` | `test/dom/a-front-door-that-asks-nothing.dom.test.ts` (§2's payload equality) |
| `M3` | `run_dom` | `test/dom/a-front-door-that-offers-everything.dom.test.ts` (§3, the trimmed id) |
| `M4` | `run_dom` | `test/dom/a-front-door-that-offers-everything.dom.test.ts` (§5, the corpus) |
| `M5` `M6` | `run_suite` desktop | `test/asks-nothing-offers-everything.test.ts` (§4) |
| `M7` | `run_suite` desktop | `test/a-gesture-that-creates-an-agent.test.ts` (§2's flattened call) |
| `M8` | `run_dom` | `test/dom/a-front-door-that-offers-everything.dom.test.ts` (§3, the provider) |
| `M9` `M10` `M11` `M12` | `run_suite` desktop | `test/asks-nothing-offers-everything.test.ts` (§2) |
| `M13` | `run_dom` | `test/dom/a-front-door-that-offers-everything.dom.test.ts` (§5, rows 1–2) |
| `M14` | `run_dom` | `test/dom/a-front-door-that-offers-everything.dom.test.ts` (§1) |
| `M15` `M16` | `run_dom` | `test/dom/a-front-door-that-offers-everything.dom.test.ts` (§4) |
| `M17` `M18` | `run_dom` | `test/dom/launcher-layout.dom.test.ts` (§2, restored by this dispatch) |
| `M19` `M20` | `run_dom` | `test/dom/a-front-door-that-offers-everything.dom.test.ts` (§5's `says` column) |
| `M21` | `run_suite` desktop | `test/asks-nothing-offers-everything.test.ts` (§1) |
| `M22` | `run_dom` | `test/dom/a-front-door-that-asks-nothing.dom.test.ts` (§1's closed set) |
| `M23` | `run_dom` | `test/dom/a-front-door-that-asks-nothing.dom.test.ts` (§3's note stack) |

⛔ **The table was NOT run** (standing rule: a whole-table run is the person's call, one table at a time).
⚑ **Every row was verified individually instead** — applied alone, only its killer file run, the
tree restored from bytes held in memory and proved byte-identical by SHA-256 after every row and
once at the end. The verifier is Python, never bash: `429`'s bash one used `mapfile` over
`--files`, which prints ONE space-separated line, and silently accumulated twenty-one mutations
while printing REDs.

🔴 **Measured: 23/23 RED alone — and `M19` is not the row it started as.** Its first version turned
the note stack's `v-else-if="effortSilence"` into a `v-if`, and it SURVIVED, because
`effortHeldBack` already returns `null` wherever `effortSilence` speaks. ⛔ **That is a semantic
no-op and a phantom survivor** (`a-mutation-that-changes-nothing-reports-as-a-survivor`), and
`274`'s own table had already recorded the shape in as many words: *"two things enforce that and
they are not the same thing… `M10` and `M11` attack them separately, and only one of the two
survives."* ⚑ The template's ORDER and the computed's own guard are two enforcers of one rule, so
breaking either alone changes nothing a screen can see. **The row was re-pointed at the clause that
IS load-bearing** — *the rung was not asked for* — and re-verified RED individually.

## ⛔ What this table deliberately does NOT contain

- **No row that re-adds a control HO-025 §4 does not name.** The profile, project and folder pickers
  are gone for reasons the PO has not reversed, and a mutation that put one back would be asserting
  a ruling rather than breaking a property this dispatch built.
- **No row in `model-field.ts`.** `435` changed its CALLERS (both now hand it `providerName`, per
  `151`) and not one byte of the module; `310`'s own table already owns its rows and a row here
  would anchor on somebody else's subject.
- **No row in the live instruments.** `435` re-decided step 13's census and left the GESTURES to
  whoever owns them (`435 §6`), so there is no new instrument behaviour for a row to break — and
  `427`'s table already anchors `scripts/lib/front-door.mjs`.
- **No row on the `provider-select` hook NAME besides `M22`.** Renaming a control is one defect and
  three rows attacking three hook names would measure the same assertion three times.
  ⚠️ **And `M22` has more detectors than `435 §2.1` predicted, which is worth writing down rather
  than letting the row's label imply otherwise.** §2.1 says the enumeration is the only thing that
  can see a renamed picker, and that is true of the state before this dispatch; `435` then added two
  PRESENCE censuses — `OFFERED` in the dom file and `drawn('provider-select')` in
  `scripts/test/front-door-hook-reach.test.mjs` — plus the live instrument's own `OFFERS_EVERYTHING`
  gate. ⚑ **A rename now goes red four ways**, and the enumeration remains the only one that catches
  a control added under a name nobody wrote down at all.
"""

DOOR = "apps/desktop/src/renderer/src/components/NewConversation.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
STORE = "apps/desktop/src/renderer/src/lib/agent-store.ts"
MENU = "apps/desktop/src/renderer/src/lib/effort-menu.ts"
CHOICES = "apps/desktop/src/renderer/src/lib/launch-choices.ts"
WORDS = "apps/desktop/src/renderer/src/lib/front-door-words.ts"

# ⚑ **W4.78 · re-anchored in place, not retired** — 6d2d195d replaced modelAsked with `sends` (theFormSends); the conditional spread is the same omission rule. Replacement makes model unconditional, so an untouched form with no last pick sends model: ''.
MODEL_OMITTED = "  ...(sends.value === null ? {} : { model: sends.value.model }),\n"
# ⚑ **W4.78 · re-anchored in place, not retired** — 6d2d195d replaced effortAsked with `sends` (theFormSends); the conditional spread is the same omission rule. Replacement sends reasoningEffort: '' when nothing was asked.
EFFORT_OMITTED = "  ...(sends.value?.effort == null ? {} : { reasoningEffort: sends.value.effort }),\n"

MUTATIONS = [
    # ── §1 · the payload: *asks nothing* as a fact about the wire ──────────────────────────────
    (
        "M1 · 🔴 the model is sent whether or not anybody chose one — an untouched front door "
        "asks for the empty model, and `292 §3`'s rule that an ABSENT field is what the stack "
        "reads as *leave the default alone* stops being expressible · killed by `asks-nothing-offers-everything.test.ts` (named by W4.78)",
        [(DOOR, MODEL_OMITTED, "  model: sends.value?.model ?? '',\n")],
    ),
    (
        "M2 · 🔴 the same for the reasoning level, which is worse because `''` is a LEGAL "
        "`ReasoningEffort` (the type is `string`) — so *we did not ask* arrives on the wire as a "
        "request for the empty level rather than as silence · killed by `asks-nothing-offers-everything.test.ts` (named by W4.78)",
        [(DOOR, EFFORT_OMITTED, "  reasoningEffort: sends.value?.effort ?? '',\n")],
    ),
    (
        "M3 · ⛔ the model id is sent untrimmed, so a stray space a person never sees becomes part "
        "of a provider id and the launch fails loudly at a place nobody will connect to this box · killed by `the-one-model-picker-holds-and-sends.test.ts` (named by W4.78)",
        [
            (
                "apps/desktop/src/renderer/src/lib/model-lists.ts",
                # ⚑ **W4.78 · re-anchored in place, not retired** — 6d2d195d moved the payload's model trimming from NewConversation's modelAsked into theFormSends in lib/model-lists.ts. NewConversation's shownPick still trims, but only for the face. (moved from NewConversation.vue)
                "  const model = choices.model.trim()\n",
                "  const model = choices.model\n",
            )
        ],
    ),
    (
        "M4 · 🔴 `274 §2` exactly: the payload reads the HELD rung rather than the one the control "
        "can show, so a launcher offering nothing sends `medium` under a sentence saying nothing "
        "was chosen — measured live on a running app, three states out of four wrong",
        [
            (
                DOOR,
                "  effortAskedFor(effortOptions.value, props.choices.reasoningEffort),",
                "  props.choices.reasoningEffort,",
            )
        ],
    ),
    # ── §2 · one provider derivation, with the asked term first ────────────────────────────────
    (
        "M5 · 🔴 the person's choice is dropped from the one derivation, so the provider select "
        "moves nothing: HO-025 §4's *a person chooses provider when a conversation starts* becomes "
        "a control that reports the default back to itself",
        [
            (
                STORE,
                # ⚑ **an agent keeps its provider · re-anchored in place, not retired** — the launch's rule reads what the agent runs on (runsOnIn) instead of the identity's raw column; same order, same plant.
                "  return asked ?? runsOnIn(list, slug)?.provider ?? fallback",
                "  return runsOnIn(list, slug)?.provider ?? fallback",
            )
        ],
    ),
    (
        "M6 · ⛔ the asked term is ranked SECOND, so an identity that has named a provider "
        "overrules the person in front of the screen — the direction HO-025 §4 is about, since a "
        "seeded value *is a first-run convenience, not an opinion about which model orchestrates*",
        [
            (
                STORE,
                # ⚑ **an agent keeps its provider · re-anchored in place, not retired** — the launch's rule reads what the agent runs on (runsOnIn) instead of the identity's raw column; same order, same plant.
                "  return asked ?? runsOnIn(list, slug)?.provider ?? fallback",
                "  return runsOnIn(list, slug)?.provider ?? asked ?? fallback",
            )
        ],
    ),
    (
        "M7 · ⛔ the screen stops passing what the person asked for, which is the same defect one "
        "layer out — and the shape a reviewer is likeliest to read as tidying, because the call "
        "still compiles and the sentence on screen still agrees with the payload",
        [
            (
                SCREEN,
                "    DEFAULT_PROVIDER,\n    launchChoices.value.provider,\n  ),",
                "    DEFAULT_PROVIDER,\n  ),",
            )
        ],
    ),
    (
        "M8 · ⛔ the provider control answers *nobody asked* whatever is picked, so the select "
        "snaps back to the resolved default and a person cannot start a conversation on the other "
        "provider at all — HO-025 §5's *worse off than before*, restored · killed by `a-front-door-that-offers-everything.dom.test.ts` (named by W4.78)",
        [
            (
                DOOR,
                # ⚑ **W4.78 · re-anchored in place, not retired** — 6d2d195d folded chooseProvider into the picker's Take (startOn); picking a provider's model is how the provider is chosen (R-3). Writing provider: null snaps back to the resolved default.
                "  choose({ provider: pick.provider, model: pick.model, reasoningEffort: pick.effort ?? '' })\n",
                "  choose({ provider: null, model: pick.model, reasoningEffort: pick.effort ?? '' })\n",
            )
        ],
    ),
    # ── §3 · one effort derivation, shared with the drawer ─────────────────────────────────────
    (
        "M9 · 🔴 the menu stops scoping to the model in the box, so every level any model accepts "
        "is offered for the one named — the confident wrong list `076 §2` rejected, presented as "
        "this model's own · killed by `an-agents-model-on-screen.test.ts` (named by W4.78)",
        # ⚑ **W4.78 · re-anchored in place, not retired** — effort-menu.ts was deleted in 6d2d195d (UI-012). Scoping the levels to the named model is now theEffortsOffered in model-lists.ts, which the front door, the drawer and the sheet all reach through ModelPicker. The replacement offers every level any row lists for the named model. §4's levelsOf('gpt-5.6-luna') toEqual(['low','medium','high']) then picks up 'ultra', and haiku's {known:true, levels:[]} becomes non-empty. (moved from effort-menu.ts)
        [("apps/desktop/src/renderer/src/lib/model-lists.ts", "  return { known: true, levels: row.efforts ?? [] }\n", "  return { known: true, levels: theEffortLadder(list.models).map((level) => ({ id: level, label: level })) }\n")],
    ),
    (
        "M10 · ⛔ `177 §4` inverted: an id the catalogue does not list EMPTIES the menu instead of "
        "pooling, which is the measured defect — a session launched with a full model id opened a "
        "dead control whose title blamed a provider that had answered perfectly well · killed by `the-one-model-picker-holds-and-sends.test.ts` (named by W4.78)",
        # ⚑ **W4.78 · re-anchored in place, not retired** — effort-menu.ts was deleted in 6d2d195d (UI-012). In the picker, an id the list does not name gets the provider's whole ladder (theEffortsOffered, model-lists.ts). The replacement EMPTIES it instead, which is the inverted 177 §4. theDraftEffort(list(), 'gpt-hand-added', 'high') then returns null where 'high' is expected. (moved from effort-menu.ts)
        [("apps/desktop/src/renderer/src/lib/model-lists.ts", "      levels: theEffortLadder(list.models).map((level) => ({ id: level, label: level })),\n", "      levels: [],\n")],
    ),
    (
        "M11 · ⛔ the pooled DISCLOSURE goes: a menu assembled from other models is presented as "
        "this one's without a word, which is the undisclosed-pooling defect `177` removed from the "
        "drawer arriving on the front door",
        [
            (
                MENU,
                "  return listed.length > 1 && !listed.some((row) => row.id === named)",
                "  return false",
            )
        ],
    ),
    (
        "M12 · ⚠️ the *(medium)* hint beside *provider default* stops requiring every candidate to "
        "agree, so one model's default is shown as the answer for a pooled list — and it is shown "
        "next to the option whose whole meaning is that nothing was asked for",
        [
            (
                MENU,
                "  return defaults.size === 1 ? ` (${[...defaults][0]})` : ''",
                "  return defaults.size >= 1 ? ` (${[...defaults][0]})` : ''",
            )
        ],
    ),
    (
        "M13 · 🔴 `179 §4` inverted: with no catalogue at all the held rung is dropped instead of "
        "offered, so a refused re-probe silently un-asks a level a person already chose — silence "
        "narrowing something, which is the one thing it may never do · killed by `asks-nothing-offers-everything.test.ts` (named by W4.78)",
        # ⚑ **W4.78 · re-anchored in place, not retired** — 6d2d195d (UI-012) deleted effortsForALaunch from launch-choices.ts. The 179 §4 rule (with no list, the held rung is still sent) now lives in model-lists.ts theFormSends. The replacement drops the rung when the list is null. That test is the one that cites 179 §4: theFormSends({...opus, medium}, null) is expected to equal {model:'opus', effort:'medium'}. (moved from launch-choices.ts)
        [("apps/desktop/src/renderer/src/lib/model-lists.ts", "    return { model, effort: choices.reasoningEffort === '' ? null : choices.reasoningEffort }\n", "    return { model, effort: choices.reasoningEffort === '' || list === null ? null : choices.reasoningEffort }\n")],
    ),
    # ── §4 · the four properties *out of the path* was turned into ─────────────────────────────
    (
        "M14 · 🔴 the caret no longer starts in the composer, so HO-025 §5's *defaults applied, "
        "composer focused* is half-implemented — and the half that is missing is the one that "
        "tells a person, on mount, that nothing below is being asked of them",
        [(DOOR, "  void nextTick(() => composer.value?.focus())\n", "")],
    ),
    (
        "M15 · ⛔ the stage stops scrolling, so a long provider sentence or a wrapped control row "
        "pushes the box a person is typing into — property 4 of `435 §2`, broken by one word in a "
        "stylesheet nobody would connect to the composer",
        [(DOOR, "  padding: var(--space-12) var(--space-12) var(--space-10);\n  overflow: auto;", "  padding: var(--space-12) var(--space-12) var(--space-10);\n  overflow: visible;")],
    ),
    (
        "M16 · ⛔ the stage stops absorbing its share of the pane, so the column's height reaches "
        "the composer directly — the same property from the other side, and the shape a layout "
        "refactor produces without touching a single control · killed by `a-front-door-that-offers-everything.dom.test.ts`",
        [
            (
                DOOR,
                # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · e6470809 put recent conversations beside the new message and top-aligned the stage; the plant still stops the stage absorbing its share of the pane.
                "  min-height: 0;\n  flex: 1;\n  flex-direction: column;\n  align-items: center;\n  justify-content: flex-start;",
                "  min-height: 0;\n  flex: 0 0 auto;\n  flex-direction: column;\n  align-items: center;\n  justify-content: flex-start;",
            )
        ],
    ),
    (
        "M17 · ⛔ `101 §2` restored: the provider's description goes back inside the `<option>` "
        "TEXT, so the control's intrinsic min-width becomes its longest SENTENCE — a couple of "
        "hundred pixels, and nothing but a measured box can see it",
        [(DOOR, "                  {{ effort.label }}\n", "                  {{ effort.label }}{{ effort.description ? ` — ${effort.description}` : '' }}\n")],
    ),
    (
        "M18 · ⛔ the option's accessible name loses the provider's sentence, so arrowing through "
        "the menu announces five bare rungs — the review finding `103 §1` recorded: sighted users "
        "keep a description per candidate and everybody else gets one for the row already chosen",
        [
            (
                DOOR,
                "                  :aria-label=\"\n                    effort.description ? `${effort.label} — ${effort.description}` : effort.label\n                  \"\n",
                "",
            )
        ],
    ),
    (
        "M19 · ⚠️ the held-back sentence loses the clause that says the rung was NOT asked for, so a "
        "person who successfully chose `high` is told their `high` is being dropped — `171`'s class "
        "of defect, on the one sentence whose whole job is to report an omission truthfully",
        [
            (
                DOOR,
                "  if (held === '' || effortAsked.value !== '' || effortOptions.value.length === 0) return null",
                "  if (held === '' || effortOptions.value.length === 0) return null",
            )
        ],
    ),
    (
        "M20 · 🔴 the silence sentence drops its *did the provider actually answer* clause, so a "
        "probe that never returned is reported as a provider that named no levels — inventing a "
        "limit from a fact about US, which is the trap `310` was dispatched to close · killed by `a-front-door-that-offers-everything.dom.test.ts` (named by W4.78)",
        [
            (
                "apps/desktop/src/renderer/src/components/ModelPicker.vue",
                # ⚑ **W4.78 · re-anchored in place, not retired** — 6d2d195d moved the effort silence sentence into ModelPicker's effortSilence; its 'did anybody answer' clause is the !offered.known branch. Replacement reports an unanswered list as a model with no levels. (moved from NewConversation.vue)
                "  if (!offered.value.known) {\n    return `${PROVIDER_NAME[drafted.provider]} could not be asked which efforts “${drafted.model}” offers.`\n  }\n",
                "  if (!offered.value.known) {\n    return `“${drafted.model}” has no effort levels.`\n  }\n",
            )
        ],
    ),
    # ── §5 · the censuses' own truth ───────────────────────────────────────────────────────────
    (
        "M21 · ⛔ the one sentence HO-025 §4 requires — *changing the provider means a new "
        "conversation, and the app should SAY that* — loses the clause that says so, leaving a "
        "control that reads like every other setting on the screen",
        [
            (
                WORDS,
                "`change later, in ${CHANGEABLE_LIVE_IN} — the provider you cannot: it is fixed when the ` +\n    `conversation starts.`",
                "`change later, in ${CHANGEABLE_LIVE_IN}.`",
            )
        ],
    ),
    (
        "M22 · ⛔ the provider control is re-added under a NEW name, which is `435 §2.1`'s blind "
        "spot: the two named-ABSENCE lists both pass, and what catches it is the column's own "
        "enumeration — plus the two PRESENCE censuses this dispatch added beside it · killed by `a-front-door-that-asks-nothing.dom.test.ts` (named by W4.78)",
        # ⚑ **W4.78 · re-anchored in place, not retired** — 6d2d195d folded the provider control into the model picker's face; the control re-added under a new name is the same blind spot (moved from NewConversation.vue) (W4.78 reviewer disagreed with retiring it)
        [("apps/desktop/src/renderer/src/components/ModelPicker.vue", "data-cy=\"model-picker-face\"\n      aria-haspopup=\"dialog\"", "data-cy=\"identity-select\"\n      aria-haspopup=\"dialog\"")],
    ),
    (
        "M23 · 🔴 `310`'s sentence is shown only where there is something to DO about it, so every "
        "state that resolves itself goes silent again — which is precisely the state that made a "
        "provider with seven models read as having none, and the gap `SessionSettings.vue` "
        "recorded `417` leaving open · killed by `a-front-door-that-offers-everything.dom.test.ts` (named by W4.78)",
        # ⚑ **W4.78 · re-anchored in place, not retired** — 6d2d195d moved the model-say paragraph (catalogue.message plus remedy) into each ModelPicker provider section as model-picker-said, on the same modelField. Gating on remedy silences 'Asking X…', empty and closing again. (moved from NewConversation.vue)
        [("apps/desktop/src/renderer/src/components/ModelPicker.vue", "            v-if=\"section.field.message\"\n", "            v-if=\"section.field.remedy\"\n")],
    ),
]
