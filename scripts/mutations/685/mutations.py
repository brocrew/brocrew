"""685 · Choose each agent's model on screen — `677`'s doors reached by a control, and four smaller
things a person reads made true.

⚑ **The PM's §1:** `677` built the doors — read, set, clear, a refusal with a `reason`, the sentence
of what a choice reaches — and nothing on screen reached them. **§2:** the act a refusal carries on
the notice and the reopened panel (`675` F-d); `tool-answer.ts`' Claude prose (`675` F-e); the waits
reading's unread rows drawn by nobody (`676` F-R18a); `678` F3 (a wall alone) and F4 (the long card).

## 🔴 What has to be killable

 * `M1`–`M21` 🔴 **§1 · the control**: the effort menu pools; a held-but-unlisted model dropped; the
   check before the press never speaks, or speaks other words than the door; a name with no agent
   given the wrong sentence or an empty menu (a never-run agent, until `691` re-aimed them); the provider's diagnostic dropped; a clear sent as a
   choice; the folder's own spelling lost; the door's reason rewritten; a failed read turned into
   *nobody chose*; the idle control probing; the roster re-read gone; the menus left open over a
   save; the refusal not drawn; Save alive under the door's own sentence; a dead effort kept; the
   sentence beside the choice gone; a choice for another provider seeded into menus that cannot
   hold it; the control unmounted; the menus for the column instead of the resolved provider.
 * `M22`–`M33` 🔴 **§2.1 · F-d**: the notice never waits; the join ignores the rail, guesses between
   two, trusts a name alone, speaks over an outgoing card, outlives the run, prints a handle; the
   notice or the export drops the words; the panel draws no short form, is handed none, or draws it
   over a whole answer.
 * `M34` ⚑ **§2.2 · F-e**: the retired Claude claim back in the prose.
 * `M35`–`M39` 🔴 **§2.3 · F-R18a**: the gate on drawn plates gone; the rail's line never drawn, or
   read from nothing; the forest's count dropped, or summed into its own.
 * `M40`–`M42` ⚑ **§2.4**: a wall's unanswered look folded into *quiet* (the ruling `685` pins); a
   call site reaching past the one field; a height bound that cuts the 1,280-unit card.
 * `M43`–`M52` 🔴 **found by `685`'s review**: the normalizer's cut mark inside the quotation, and a
   part quoted as the whole; a sub-agent's kept receipt not found; a failed first read drawn as
   *nobody chose*; Save armed as a silent clear; *Runs on* moving mid-edit dropping a choice the
   menus can hold; a choice for another provider drawn as though its own reads it, on the control
   and through the sheet; the waits line claiming work may be missing.
 * `M53`–`M54` 🔴 **added by `691`** (`682` lands second): a never-run agent's stand-in list read as
   no list; the sentence beside a held choice drawn for one that is not in force.

## ⚠️ One row DROPPED before it was committed

 * `M52` — deleting the select's `min-width: 0; max-width: 100%` SURVIVED: the flex column already
   stretches the select to its box, so the rule carried nothing and was removed with its row. ⚑ The
   long-label fit stays in the DOM suite as a claim a real regression can fail.

## ⛔ What this table cannot reach

 * ⚠️ **`682`'s R31b** — a provider change clearing a choice — is the host's, and `682`'s own table
   measures it; nothing in this renderer table can plant its absence. (`685` wrote this before `682`
   landed; `691` corrected it.)
 * ⚠️ **The window photographs** are evidence, not assertions: what they show is pinned by the DOM
   rows above.

## ⚑ WRITTEN, not run as a table

⛔ **Writing rows is routine, RUNNING a table is rare and deliberate.** Each row was verified RED
alone with `scripts/mutations/verify_row.py` — one row, its killer file, restored from bytes — in an
isolated worktree, never the tree a dev server watches, and no `mutations.txt` exists.
"""

from __future__ import annotations

LIB = "apps/desktop/src/renderer/src/lib"
COMPONENTS = "apps/desktop/src/renderer/src/components"
ROWS_UNREAD = "apps/desktop/src/renderer/src/lib/rows-unread.ts"

CHOICE = f"{LIB}/agent-model-choice.ts"
STORE = f"{LIB}/agent-store.ts"
CONTROL = f"{COMPONENTS}/AgentModelChoice.vue"
SHEET = f"{COMPONENTS}/CapabilitiesSheet.vue"
FOLD = f"{LIB}/transcript.ts"
NOTICE = f"{COMPONENTS}/NoticeEntry.vue"
EXPORT = f"{LIB}/readable-export.ts"
VIEWER = f"{COMPONENTS}/ToolAnswerViewer.vue"
PANE = f"{COMPONENTS}/ConversationPane.vue"
ANSWER = f"{LIB}/tool-answer.ts"
WAITS = f"{LIB}/conversation-waits.ts"
RAIL = f"{COMPONENTS}/SideRail.vue"
FOREST = f"{LIB}/the-forest.ts"
TEAM_FOREST = f"{COMPONENTS}/TeamForest.vue"
QUEUE = f"{LIB}/persons-queue.ts"
WAITING = f"{COMPONENTS}/WaitingOnYou.vue"
OUTGOING = f"{COMPONENTS}/OutgoingEntry.vue"
UNREAD = f"{LIB}/rows-unread.ts"

MUTATIONS = [
    # ── §1 · the control ────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **the effort menu POOLS** · the launcher's union where the door takes the "
        "intersection, so a person is offered a level Save refuses (`677` §7.2) — "
        "killed by `an-agents-model-on-screen.test.ts`",
        [
            (
                "apps/desktop/src/renderer/src/lib/model-lists.ts",
                # ⚑ **W4.78 · re-anchored in place, not retired** — effortsAChoiceMayName went in 0c50fe0b (D-042), and the sheet's effort menu went in 6d2d195d (UI-012). The sheet's levels are now theEffortsOffered in model-lists.ts. The replacement plants the launcher's UNION of every row's levels for a named model. The named killer still asserts this (§4: luna's levels exactly; haiku known and none), as its own comment says. Same anchor as 435 M9 with a differently built union. (moved from agent-model-choice.ts)
                "  return { known: true, levels: row.efforts ?? [] }\n",
                "  return { known: true, levels: list.models.flatMap((one) => one.efforts ?? []).filter((one, at, all) => all.findIndex((other) => other.id === one.id) === at) }\n",
            )
        ],
    ),
    (
        "M2 · ⛔ **a held model the catalogue no longer lists is dropped from the menu** · the "
        "control reads *provider default* over a specific choice (`076`'s rule) — "
        "killed by `an-agents-model-on-screen.test.ts`",
        # ⚑ **W4.78 · re-anchored in place, not retired** — modelOptions went in 6d2d195d (UI-012). Keeping a held model the list does not hold is now thePickerRows in model-lists.ts, which adds a row:null entry (marked '(no longer listed)'). The named killer still asserts it (§3: thePickerRows(list,'gpt-5.4').at(-1) equals {id:'gpt-5.4', row:null}). (moved from agent-model-choice.ts)
        [("apps/desktop/src/renderer/src/lib/model-lists.ts", "    : [...rows, { id: current, row: null }]\n", "    : rows\n")],
    ),
    (
        "M3 · 🔴 **the check before the press never speaks** · Save is alive over a choice the door "
        "will refuse — killed by `an-agents-model-on-screen.test.ts` · killed by `an-agents-model-on-screen.dom.test.ts` (named by W4.78)",
        # ⚑ **W4.78 · re-anchored in place, not retired** — whyNotSaved went in 6d2d195d (UI-012). The model-not-offered half of the pre-press check was dropped on purpose: Take is live over a '(no longer listed)' model and the door refuses it. The effort half remains: theDraftEffort returns `undefined` when the model offers levels and none is named, which keeps pick null (Take dead) and draws effortWanted. The replacement turns that into null, so Take goes live and silent over an effort the door then refuses (effort-not-offered). KILLER GAP: the named killer's own §3 comment says the pre-press sentence went with the <select>s, and no test reaches theDraftEffort's `undefined` arm. Expect a survivor until one does, e.g. a theDraftEffort case in the-one-model-picker-holds-and-sends.test.ts on a row with efforts and no defaultEffort, expecting toBeUndefined(). (moved from agent-model-choice.ts)
        [("apps/desktop/src/renderer/src/lib/model-lists.ts", "  return theEffortWhenNoneIsNamed(row, list?.models ?? [])\n", "  return theEffortWhenNoneIsNamed(row, list?.models ?? []) ?? null\n")],
    ),
    (
        "M4 · ⛔ **the words before the press are not the door's** · the detail drops the model, so "
        "the sentence reads `“?”` where the door names it — "
        "killed by `an-agents-model-on-screen.test.ts` · killed by `an-agents-model-on-screen.dom.test.ts` (named by W4.78)",
        # ⚑ **W4.78 · re-anchored in place, not retired** — detailOf's model spread went in 0c50fe0b (D-042) and detailOf itself in 6d2d195d (UI-012). The one door sentence the picker draws before a press is effortWanted, built from MODEL_CHOICE_SAID['effort-not-offered']({profileId, model, offered}). Dropping `model` makes it read “?” where the door names the model. KILLER GAP: the named killer no longer reaches pre-press words, and no test draws model-picker-effort-wanted, so this survives until one does. (moved from agent-model-choice.ts)
        [("apps/desktop/src/renderer/src/components/ModelPicker.vue", "        model: draft.value.model,\n", "")],
    ),
    # ⚑ **RE-AIMED IN PLACE BY 691** — `682` (`R31d`) retired `has-never-run`, so the `no-profile`
    # arm no longer meets an agent that has never run (it has a menu now — `M53`); the one name that
    # reaches it is one with no identity row, and the door's answer there is `no-such-agent`. ⚑ The
    # row plants the same defect it always did: the arm's sentence is not the door's.
    (
        "M5 · 🔴 **a name with no agent gets the wrong sentence** · *could not be asked* where the "
        "door says *there is no agent called* — killed by `an-agents-model-on-screen.test.ts`",
        [
            (
                "apps/desktop/src/main/runtime/runtime-host.ts",
                # ⚑ **W4.78 · re-anchored in place, not retired** — 6d2d195d moved the choice between the two refusals from the renderer into main's door, setAgentModelAndEffort (moved from agent-model-choice.ts) (W4.78 reviewer disagreed with retiring it)
                "    if (this.deps.store.capabilitiesOf(profileSlug) === null) {\n      return refuseModelChoice('no-such-agent', said)\n",
                "    if (this.deps.store.capabilitiesOf(profileSlug) === null) {\n      return refuseModelChoice('models-unavailable', said)\n",
            )
        ],
    ),
    # Source-only anchor repair; NOT VERIFIED.
    (
        "M6 · ⚑ **the provider's own diagnostic is dropped** · *not signed in* was the only copy — "
        "killed by `an-agents-model-on-screen.test.ts` · killed by `an-agents-model-on-screen.dom.test.ts` (named by W4.78)",
        [
            (
                "apps/desktop/src/renderer/src/lib/model-field.ts",
                # ⚑ **W4.78 · re-anchored in place, not retired** — whatTheCatalogueLets went in 6d2d195d (UI-012). The picker now hands list.notAsked to modelField, which is where a refused list's own diagnostic ('not signed in') is drawn. The NAMED node killer only pins the host's list.notAsked.detail and the door's refusal, so it would not kill. The DOM twin does ('Codex answered while Claude refused' expects 'Claude could not be asked what it can run: not signed in'), and so does model-field.test.ts. (moved from agent-model-choice.ts)
                '    detail: said,\n',
                "    detail: '',\n",
            )
        ],
    ),
    # ⚑ **RELABELLED IN PLACE BY 691** — since `682` the `no-profile` this control meets is a name
    # with no identity row (a never-run agent is answered from BroBot's home). ⚑ Same decision
    # measured: *nothing was asked* rendered as *it listed none*.
    (
        "M7 · 🔴 **a name with no agent is drawn an EMPTY menu** · *nothing was asked* rendered as *it "
        "listed none* — killed by `an-agents-model-on-screen.test.ts` · killed by `an-agents-model-on-screen.dom.test.ts` (named by W4.78)",
        [
            (
                "apps/desktop/src/renderer/src/components/ModelPicker.vue",
                # ⚑ ANCHOR CORRECTED IN PLACE BY 696: the menu arm carries the list's `standIn` now
                # (`688` §1b); the row — `no-profile` drawn as an empty menu — is unchanged.
                # ⚑ **W4.78 · re-anchored in place, not retired** — whatTheCatalogueLets went in 6d2d195d (UI-012). The picker now builds the catalogue it hands modelField from list.notAsked. The replacement turns a no-profile answer into an ok, empty catalogue, so 'nothing was asked' is drawn as 'listed no models'. KILLER GAP: the named node killer pins only list.notAsked. The DOM no-profile case checks only that model-picker-said has length 1, rows are [] and Take is dead, all of which still hold. Adding an assertion on that case's said words ('arrives once this profile exists' / not 'listed no models') would kill it. (moved from agent-model-choice.ts)
                "                : (list.notAsked ?? {\n",
                "                : ((list.notAsked?.reason === 'no-profile' ? null : list.notAsked) ?? {\n",
            )
        ],
    ),
    (
        "M8 · ⛔ **two *provider default*s are sent as a choice** · a provider with nothing beside "
        "it, where the door's clear is three `null`s — killed by `an-agents-model-on-screen.test.ts`",
        [(CHOICE, "  if (model === '' && effort === '') return null\n", "")],
    ),
    (
        # ⚑ **RELABELLED IN PLACE BY 691** — under the mutant the host answers `no-profile`, which this
        # control now draws as the door's `no-such-agent`, not 677's *never run*: same defect, a worse
        # sentence.
        "M9 · 🔴 **the catalogue is asked under the SLUG** · `Developer/` is not `developer`, so an "
        "agent whose folder exists is told *there is no agent called* it (`187`) — "
        "killed by `an-agents-model-on-screen.test.ts`",
        [
            (
                "apps/desktop/src/main/runtime/runtime-host.ts",
                # ⚑ **W4.78 · re-anchored in place, not retired** — 6d2d195d (UI-012) deleted agent-store.ts' modelsFor. Finding the folder's own spelling by its fold (187) moved to the host's theListFor, which D-042's modelList door (and the save door) use. The replacement asks under the slug as given. The named killer still asserts this: §6 menuFor('developer','claude') would get no-profile for Developer/ and throw. (moved from agent-store.ts)
                "    const catalogue = await this.providerModels(own, provider).catch((): ModelCatalogue => ({\n",
                "    const catalogue = await this.providerModels(profileId, provider).catch((): ModelCatalogue => ({\n",
            )
        ],
    ),
    (
        "M10 · 🔴 **the door's reason is rewritten by the store** · the sentence written for the "
        "person replaced by a generic one — killed by `an-agents-model-on-screen.test.ts`",
        [
            (
                STORE,
                "{ ok: false, reason: saved.reason }",
                "{ ok: false, reason: 'Nothing was saved.' }",
            )
        ],
    ),
    (
        "M11 · ⛔ **a failed read becomes *nobody has chosen*** (086) — "
        "killed by `an-agents-model-on-screen.test.ts`",
        [
            (
                STORE,
                "        return { held: await bridge.agentModelAndEffort({ profileId }) }\n"
                "      } catch {\n"
                "        return null\n",
                "        return { held: await bridge.agentModelAndEffort({ profileId }) }\n"
                "      } catch {\n"
                "        return { held: null }\n",
            )
        ],
    ),
    (
        "M12 · 🔴 **the idle control PROBES** · a catalogue read is a launch, and opening a sheet "
        "would spawn one per provider — killed by `an-agents-model-on-screen.dom.test.ts`",
        [
            (
                CONTROL,
                "watch(() => props.profileSlug, read, { immediate: true })\n",
                "watch(\n"
                "  () => props.profileSlug,\n"
                "  () => {\n"
                "    void read()\n"
                "    void store.value.modelsFor(props.profileSlug)\n"
                "  },\n"
                "  { immediate: true },\n"
                ")\n",
            )
        ],
    ),
    (
        "M13 · 🔴 **a choice made in another window never reaches this one** · the roster re-read "
        "`runtime:changed agents` drives is not watched — "
        "killed by `an-agents-model-on-screen.dom.test.ts`",
        [(CONTROL, "  () => void read(),\n", "  () => undefined,\n")],
    ),
    (
        "M14 · ⚑ **the menus stay open over a save** · the row never says what was stored — "
        "killed by `an-agents-model-on-screen.dom.test.ts`",
        [
            (
                "apps/desktop/src/renderer/src/components/ModelPicker.vue",
                # ⚑ **W4.78 · re-anchored in place, not retired** — UI-012 (6d2d195d) took out `editing`. On a successful save the picker's panel now closes in ModelPicker commit() (AgentModelChoice's save returns null). The replacement leaves the panel open over the save. The named DOM killer still asserts this: §2 expects model-picker-row to have length 0 after Take. (moved from AgentModelChoice.vue)
                # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · 54b67308 gives focus back to whichever control opened the picker instead of always its face; the plant still leaves the picker open over a save.
                "  if (refusal.value === null) {\n    hide()\n    giveFocusBack()\n  }\n",
                "  if (refusal.value === null) {\n    giveFocusBack()\n  }\n",
            )
        ],
    ),
    (
        "M15 · 🔴 **a refusal is not drawn** · the door's `reason` reaches no screen (`677` §7.3) — "
        "killed by `an-agents-model-on-screen.dom.test.ts`",
        [(CONTROL, "    refusal.value = answer.reason\n", "")],
    ),
    (
        "M16 · ⛔ **Save is alive under the door's own sentence** · the check before the press drawn "
        "and ignored, on an EDITED draft `!changed` does not hold (`685`'s review found the first "
        "killer passing either way) — killed by `an-agents-model-on-screen.dom.test.ts`",
        [
            (
                "apps/desktop/src/renderer/src/components/ModelPicker.vue",
                # ⚑ **W4.78 · re-anchored in place, not retired** — UI-012 (6d2d195d) replaced notSaved/whyNotSaved. The one pre-press door sentence left is ModelPicker's effortWanted (MODEL_CHOICE_SAID['effort-not-offered']): it is drawn while pick is null and Take is disabled. The replacement leaves Take alive under that sentence. KILLER GAP: the named DOM killer never reaches effort-wanted. Every takeIsDead case there has draft === null, and no test anywhere uses a row whose effort nothing names. Expect this row to survive until a case is added, e.g. a Codex row with efforts and no defaultEffort in an-agents-model-on-screen.dom.test.ts. (moved from AgentModelChoice.vue)
                ":disabled=\"busy || pick === null\"",
                ":disabled=\"busy || draft === null\"",
            )
        ],
    ),
    (
        "M17 · ⚑ **a model change keeps an effort the new model does not list** · the draft becomes "
        "one the door refuses — killed by `an-agents-model-on-screen.dom.test.ts`",
        [
            (
                "apps/desktop/src/renderer/src/lib/model-lists.ts",
                # ⚑ **W4.78 · re-anchored in place, not retired** — UI-012 (6d2d195d) removed onModel. On a model change, the picker's draft effort comes from theDraftEffort in model-lists.ts: the held level is kept only where the new model offers it. The named DOM killer still asserts this (§2: drafting 'ultra' then luna expects 'medium'). asks-nothing-offers-everything.test.ts also kills it: theDraftEffort(opus,haiku,'opus','medium') is expected to be 'high'. (moved from AgentModelChoice.vue)
                "  if (held !== null && offered.levels.some((level) => level.id === held)) return held\n",
                "  if (held !== null) return held\n",
            )
        ],
    ),
    (
        "M18 · 🔴 **the sentence beside a held choice is gone** · what it reaches — and what it does "
        "not — is said nowhere (`677` §7.4) — killed by `an-agents-model-on-screen.dom.test.ts`",
        # ⚑ **ANCHOR CORRECTED IN PLACE BY 691** — the idle sentence is `heldReaches` now: the same
        # `whatAModelChoiceReaches`, drawn only for a choice in force (`M54` measures that gate).
        [(CONTROL, "        {{ heldReaches }}\n", "")],
    ),
    (
        "M19 · ⛔ **a choice for ANOTHER provider seeds the menus** · a Claude model offered as *no "
        "longer listed* on Codex, with the door's refusal under it — "
        "killed by `an-agents-model-on-screen.dom.test.ts`",
        [
            (
                CONTROL,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 696: the seed compares with `menusFor` now (a
                # no-provider agent's menus are its choice's provider); the row is unchanged.
                "held.value !== null && held.value.provider === menusFor.value ? held.value : null",
                "held.value",
            )
        ],
    ),
    (
        "M20 · 🔴 **the control is not on the agent's sheet** · the doors reached by nothing again — "
        "killed by `an-agents-model-on-screen.dom.test.ts`",
        [
            (
                SHEET,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 712 — R56: the mount gained `@held`, the choice the
                # provider row warns about before its press; the defect planted is unchanged: the
                # control is not on the sheet.
                # ⚑ **W4.78 · re-anchored in place, not retired** — 6d2d195d (UI-012) added the :capabilities and :lists props to the mount. Same deletion. The named killer still asserts it: §7 mounts CapabilitiesSheet and queries agent-model.
                # ⚑ **an agent keeps its provider · re-anchored in place, not retired** — the sheet hands the control the provider the agent runs on (runsOnNow), not the raw column.
                "      <AgentModelChoice\n        :profile-slug=\"profileSlug\"\n        :runs-on=\"props.runsOn\"\n        :its-provider=\"runsOnNow?.provider ?? null\"\n        :capabilities=\"props.capabilities\"\n        :store=\"props.store\"\n        :lists=\"props.lists\"\n        @held=\"(choice) => (heldChoice = choice)\"\n      />\n",
                "",
            )
        ],
    ),
    (
        "M21 · ⛔ **the menus are for the column, not the provider the sheet resolves** · *Nobody has "
        "said* on an agent that runs on Codex opens Claude's list — "
        "killed by `an-agents-model-on-screen.dom.test.ts`",
        [
            (
                SHEET,
                '        :runs-on="props.runsOn"\n        :its-provider',
                "        :runs-on=\"identity.provider ?? 'claude'\"\n        :its-provider",
            )
        ],
    ),
    # ── §2.1 · F-d — the act a refusal carries ──────────────────────────────────────────────────
    (
        "M22 · 🔴 **the notice never waits for its receipt** · the act stays on the folded row "
        "(`675` F-d) — killed by `the-act-a-refusal-carries.test.ts`",
        # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. The wait gained host-kept text; omit only registration of the refusal awaiting its receipt.
        [(FOLD, "      awaitItsReceipt(state, event.tool, event.rail, event.told ?? null)\n", "")],
    ),
    (
        "M23 · ⛔ **the join ignores the rail** · another rail's words quoted on this notice — "
        "killed by `the-act-a-refusal-carries.test.ts`",
        [
            (
                FOLD,
                "(waiting) => waiting.tool === split.tool && summary.startsWith(`refused (${waiting.rail}): `),",
                "(waiting) => waiting.tool === split.tool,",
            )
        ],
    ),
    (
        "M24 · ⛔ **the join GUESSES between two** · two refusals of one tool on one rail, and the "
        "first receipt handed to whichever waited first — "
        "killed by `the-act-a-refusal-carries.test.ts`",
        [
            (
                FOLD,
                "  const only = matching.length === 1 ? matching[0] : undefined\n",
                "  const only = matching[0]\n",
            )
        ],
    ),
    (
        "M25 · ⛔ **a name alone is enough** · a server this conversation was not declared, sharing a "
        "tool's name, joins — killed by `the-act-a-refusal-carries.test.ts`",
        [
            (
                FOLD,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. The receipt helper now returns optional kept text; bypass only the declared-server guard in that helper.
                "  if (split === null || split.server !== set.declared.server) return null\n  const matching = state.refusalsAwaitingReceipt.filter(\n",
                "  if (split === null) return null\n  const matching = state.refusalsAwaitingReceipt.filter(\n",
            )
        ],
    ),
    (
        "M26 · ⚑ **the notice speaks over an outgoing card** · two accounts of one call — "
        "killed by `the-act-a-refusal-carries.test.ts`",
        # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. The early exit now hands back kept text; removing it still lets the notice duplicate the outgoing card.
        [(FOLD, "  if (printedElsewhere) return only.told\n", "")],
    ),
    (
        "M27 · ⛔ **a refusal outlives its run** · a later call's receipt claims a notice from a run "
        "that ended — killed by `the-act-a-refusal-carries.test.ts`",
        [(FOLD, "  state.refusalsAwaitingReceipt = []\n", "")],
    ),
    (
        "M28 · ⚑ **a `sess_` handle printed to a person** · the card's rule not applied one surface "
        "over (`624` §6) — killed by `the-act-a-refusal-carries.test.ts`",
        [
            (
                FOLD,
                "only.notice.told = withoutHandles(cut === null ? words : words.slice(0, cut.index))",
                "only.notice.told = cut === null ? words : words.slice(0, cut.index)",
            )
        ],
    ),
    (
        "M29 · 🔴 **the notice draws nothing it was told** · the fold joined it and no pixel shows "
        "it — killed by `the-act-a-refusal-carries.dom.test.ts`",
        [
            (
                NOTICE,
                '<span v-if="told" class="told" data-cy="refusal-told">',
                '<span v-if="false" class="told" data-cy="refusal-told">',
            )
        ],
    ),
    (
        "M30 · ⚑ **the readable export drops it** · a reader of the file reads less than the person "
        "on screen — killed by `the-act-a-refusal-carries.test.ts`",
        [(EXPORT, "`${item.text}${toldClause(item.told, item.toldInPart === true)}`", "item.text")],
    ),
    (
        "M31 · 🔴 **a reopened panel draws no short form** · *not holding it* over a row that still "
        "carries the act — killed by `the-act-a-refusal-carries.dom.test.ts`",
        [(VIEWER, 'v-if="props.answer === null && props.canAsk && props.shortForm"', 'v-if="false"')],
    ),
    (
        "M32 · ⛔ **the pane hands the panel no short form** · the viewer's prop reached by nothing — "
        "killed by `the-act-a-refusal-carries.dom.test.ts`",
        [(PANE, '        :short-form="answerFor.shortForm"\n', "")],
    ),
    (
        "M33 · ⛔ **the short form drawn over a WHOLE answer, or under *no words*** · a second, shorter "
        "copy beside the paper, or a placeholder word shown as the receipt's (`685`'s review) — "
        "killed by `the-act-a-refusal-carries.dom.test.ts`",
        [
            (
                VIEWER,
                'v-if="props.answer === null && props.canAsk && props.shortForm"',
                'v-if="props.shortForm"',
            )
        ],
    ),
    # ── §2.2 · F-e — the Claude prose ───────────────────────────────────────────────────────────
    (
        "M34 · ⚑ **the retired Claude claim is back** · *no measurement of the equivalent on Claude*, "
        "which `675` measured — killed by `a-claude-answer-is-two-blocks.test.ts`",
        [
            (
                ANSWER,
                "⚑ **685 · and\n * `675` measured Claude**",
                "— **and this app has no measurement of the equivalent on Claude**; ⚑ **685 · and\n"
                " * `675` measured Claude**",
            )
        ],
    ),
    # ── §2.3 · F-R18a — the waits reading's unread rows ─────────────────────────────────────────
    (
        "M35 · ⛔ **the gate on drawn plates is gone** · a reading that covers none of this surface's "
        "rows speaks under them — killed by `the-waits-say-what-they-could-not-read.test.ts`",
        [
            (
                WAITS,
                "    if (waitReadingFor(reading, conversation).known === 'read') {\n",
                "    if (conversation !== '') {\n",
            )
        ],
    ),
    (
        "M36 · 🔴 **the rail never draws the line** · `676`'s count reaches no pixel on the rail — "
        "killed by `the-waits-say-what-they-could-not-read.dom.test.ts`",
        [(RAIL, '<p v-if="waitsShort" class="rail-unread"', '<p v-if="false" class="rail-unread"')],
    ),
    (
        "M37 · ⛔ **the rail reads its line from nothing** · the reading the rows were drawn from is "
        "not the one asked — killed by `the-waits-say-what-they-could-not-read.dom.test.ts`",
        [(RAIL, "    props.waiting ?? null,\n", "    null,\n")],
    ),
    (
        "M38 · 🔴 **the forest drops the waits count** · the Team page's plates qualified by nothing — "
        "killed by `the-waits-say-what-they-could-not-read.test.ts`",
        [(FOREST, "      waitsShort: whatTheWaitsCouldNotRead(\n", "      waitsShort: null && whatTheWaitsCouldNotRead(\n")],
    ),
    (
        "M39 · ⛔ **the two counts SUMMED** · one torn row counted twice, `678`'s one count one "
        "sentence broken — killed by `the-waits-say-what-they-could-not-read.test.ts`",
        [
            (
                FOREST,
                "        input.waits,\n",
                "        input.waits && {\n"
                "          ...input.waits,\n"
                "          rowsUnread: input.waits.rowsUnread + forest.nodes.rowsUnread,\n"
                "        },\n",
            )
        ],
    ),
    # ── §2.4 · `678` F3 and F4 ──────────────────────────────────────────────────────────────────
    (
        "M40 · 🔴 **a wall's unanswered look forbids *quiet*** · the option `685` ruled against: the "
        "page says a list that would say what needs you could not be read, of a list `533` rules is "
        "not one — killed by `a-wall-he-finds-out-about.dom.test.ts`",
        [
            (
                QUEUE,
                "      (view.value?.mayBeShort ?? false) ||\n",
                "      (view.value?.mayBeShort ?? false) ||\n      limits.value?.unread === true ||\n",
            )
        ],
    ),
    (
        "M41 · ⛔ **a call site reaches past the one field** · the page names a band's own field, the "
        "drift `453` built the census against — killed by `persons-queue.test.ts`",
        [
            (
                WAITING,
                "    unread: persons.mayBeShort.value,\n",
                "    unread: persons.mayBeShort.value || persons.limits.value?.unread === true,\n",
            )
        ],
    ),
    (
        "M42 · 🔴 **a height bound CUTS the 1,280-unit card** · the card's own sentence — *this much "
        "of it is shown here* — made false (`678` F4) — "
        "killed by `what-main-now-hands-you.dom.test.ts`",
        [
            (
                OUTGOING,
                ".msg-body {\n  padding-top: var(--space-2);\n",
                ".msg-body {\n  max-height: 120px;\n  overflow: hidden;\n  padding-top: var(--space-2);\n",
            )
        ],
    ),
    # ── found by `685`'s review ────────────────────────────────────────────────────────────────
    (
        "M43 · 🔴 **the normalizer's cut mark inside the quotation** · `…` or `(200 of N characters)` "
        "presented as the model's words (`685`'s review) — "
        "killed by `the-act-a-refusal-carries.test.ts`",
        [(FOLD, "const RECEIPT_CUT = /…(?: \\(\\d+ of \\d+ characters\\))?$/", "const RECEIPT_CUT = /$^/")],
    ),
    (
        "M44 · ⛔ **a part quoted as the whole** · the cut words drawn without *in part* — "
        "killed by `the-act-a-refusal-carries.test.ts`",
        [
            (
                FOLD,
                "  return inPart ? ` · it was told, in part: “${told}”` : ` · it was told: “${told}”`\n",
                "  return ` · it was told: “${told}”`\n",
            )
        ],
    ),
    (
        "M45 · ⛔ **a sub-agent's kept receipt is not found** · the reopened panel stops at *not "
        "holding it* over a card row that keeps the act (`685`'s review) — "
        "killed by `the-act-a-refusal-carries.test.ts`",
        [
            (
                FOLD,
                "  for (const row of everyToolRow(state))\n",
                "  for (const row of state.items.filter((item): item is ToolItem => item.kind === 'tool'))\n",
            )
        ],
    ),
    (
        "M46 · 🔴 **a failed first read draws *Nobody has chosen*** · beside *could not read*, with "
        "Choose… over a choice never learned (`685`'s review; 086) — "
        "killed by `an-agents-model-on-screen.dom.test.ts`",
        [(CONTROL, "const readOnce = ref(false)\n", "const readOnce = ref(true)\n")],
    ),
    (
        "M47 · 🔴 **Save armed as a silent clear** · two *provider default*s over a choice for another "
        "provider, and one press erases it (`685`'s review) — "
        "killed by `an-agents-model-on-screen.dom.test.ts`",
        [
            (
                CONTROL,
                "const changed = computed(() => draft.value !== null && !sameChoice(draft.value, held.value))",
                "const changed = computed(() => !sameChoice(draft.value, held.value))",
            )
        ],
    ),
    (
        "M48 · ⚑ ***Runs on* moving mid-edit drops the choice that is now the menus'** · the menus "
        "left at *provider default* over a choice they can hold — "
        "killed by `an-agents-model-on-screen.dom.test.ts`",
        [
            (
                "apps/desktop/src/renderer/src/components/ModelPicker.vue",
                # ⚑ ANCHOR CORRECTED IN PLACE BY 696: the re-seed watches `menusFor`, which moves
                # with *Runs on* and with a choice that holds it; the row is unchanged.
                # ⚑ **W4.78 · re-anchored in place, not retired** — UI-012 (6d2d195d) took out watch(menusFor, seed). AgentModelChoice now hands [menusFor] to ModelPicker as `providers`, and ModelPicker's providers watch re-seeds the open draft from what the face shows. The replacement clears it instead. The named killer still asserts this ('Runs on moving while the picker is open': drafted 'opus', effort 'max'). (moved from AgentModelChoice.vue)
                "    if (!isOpen.value) return\n    seed()\n",
                "    if (!isOpen.value) return\n    draft.value = null\n    chosenEffort.value = null\n",
            )
        ],
    ),
    (
        "M49 · ⛔ **a choice for another provider drawn as though its own reads it** · the sentence "
        "under the row never says what a choice not in force means — that no launch reads it, and "
        "what Change… and Clear do (relabelled by `696`; the row's *not in force* mark is `696` M9/M10) — "
        "killed by `an-agents-model-on-screen.test.ts`",
        [
            (
                CHOICE,
                # ⚑ **ANCHOR CORRECTED IN PLACE BY 691** — the question is now `682`'s own
                # `aChoiceIsInForce` (`R31b`); the row still takes the sentence away.
                "  if (itsProvider === null || aChoiceIsInForce(choice, itsProvider)) return null\n",
                "  return null\n",
            )
        ],
    ),
    (
        "M50 · ⛔ **the sheet hands the control no provider column** · the sentence above reached by "
        "nothing on the sheet — killed by `an-agents-model-on-screen.dom.test.ts`",
        # ⚑ **an agent keeps its provider · re-anchored in place, not retired** — the sheet hands the control the provider the agent runs on (runsOnNow), not the raw column.
        [(SHEET, "        :its-provider=\"runsOnNow?.provider ?? null\"\n", "")],
    ),
    (
        "M51 · 🔴 **the waits line claims work may be MISSING** · no row the rail or the forest draws "
        "comes from that reading (`685`'s review) — "
        "killed by `the-waits-say-what-they-could-not-read.test.ts`",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — 685's review still holds:
        # the waits line must never claim work is missing, only that a conversation may be waiting
        # without saying so. D-017 added a sibling sentence (`waitsNotReadSays`) that reuses the
        # same base string via `waitsUnreadSays`; anchoring the swap on `waitsUnreadSays`'s own
        # return (rather than the now-duplicated bare phrase) reproduces the exact original defect
        # through every caller, including the new one.
        [
            (ROWS_UNREAD, '    ? `${rowsOfTheRecord(count)} could not be read, so a conversation shown here may be waiting without saying so.`', '    ? `${rowsOfTheRecord(count)} could not be read, so a piece of work may be missing here, or its state may be wrong.`'),
        ],
    ),
    # ── 691 · 682 lands second ─────────────────────────────────────────────────────────────────
    (
        "M53 · 🔴 **a never-run agent's stand-in list is read as NO list** · BroBot's list marked "
        "`standIn` (`682`, `R31d`) drawn as *could not be asked*, where the door gives a menu and "
        "saves — killed by `an-agents-model-on-screen.test.ts` · killed by `an-agents-model-on-screen.dom.test.ts` (named by W4.78)",
        [
            (
                "apps/desktop/src/renderer/src/components/ModelPicker.vue",
                # ⚑ ANCHOR CORRECTED IN PLACE BY 696: the menu arm carries the list's `standIn` now
                # (`688` §1b); the row — a stand-in's list read as no list — is unchanged.
                # ⚑ **W4.78 · re-anchored in place, not retired** — whatTheCatalogueLets went in 6d2d195d (UI-012). The renderer now reads a provider's answered list in ModelPicker's sections computed. The replacement treats BroBot's stand-in list as no list, so a never-run agent's picker shows no rows (and 'Asking …' instead of a menu). The NAMED node killer no longer kills: it reads lists directly, and the host still answers. The DOM twin does: §5 'never run HAS a list' expects rows ['default','opus','haiku']. (moved from agent-model-choice.ts)
                "    const list = held?.state === 'answered' ? held.list : null\n",
                "    const list = held?.state === 'answered' && held.list.standIn === null ? held.list : null\n",
            )
        ],
    ),
    (
        "M54 · ⛔ **the sentence beside a held choice is drawn for one NOT in force** · *runs it on "
        "Claude, and cannot pick another provider or model* beside a choice main reads nothing of "
        "(`R31b`) — killed by `an-agents-model-on-screen.test.ts`",
        [
            (
                CHOICE,
                "  return aChoiceIsInForce(held, itsProvider) ? whatAModelChoiceReaches(held) : null\n",
                "  return whatAModelChoiceReaches(held)\n",
            )
        ],
    ),
]
