"""423 · the gesture that brings an agent into existence — each row is THE DEFECT, put back (131).

🔴 **HO-023 §3, in the PO's words, and it is what held two merges:**

> *"The front door merges when a person can still bring an identity into existence and point a
> conversation at a repository."*

`417` deleted `+ New profile…`, which was the only person-operated way an `agent_identity` row had
ever come into being. `419` answered with a `createAgent` command, a store transaction and a preload
member — **and no caller**. ⛔ **This dispatch is the caller**: a button on the rail's Agents
section, a sheet, a store verb, and the demotion of `RuntimeScreen.DEFAULT_PROVIDER` from *the
provider a launch runs on* to *the fallback for an identity that has not said*.

## ⚑ The shape of the fix, and therefore the shape of this table

- **§1 · the gesture** (`M1`–`M3`) — the button, the wrapper that keeps `.section-label` at two
  children, and the two sentences that stopped being true the moment it landed.
- **§2 · the store verb** (`M4`–`M7`) — the payload, the re-read, the refusal a person reads, and
  the sheet that must not close over one.
- **§3 · what the form asks for** (`M8`–`M11`) — the fold, the empty gate, the optional facts, and
  the one name that is not a new agent.
- **§4 · the provider** (`M12`–`M14`) — the resolution, its order, and the fold that decides which
  orphan folder a name adopts.
- **§5 · the other door** (`M15`–`M18`) — `423` relay 1's (b): the identity, the project, the
  provider that identity chose, and the folder a project may legitimately not have.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M3`, `M6`–`M11`, `M14`–`M16`, `M18` | ⚑ **`run_dom`** — `apps/desktop/test/dom/a-gesture-that-creates-an-agent.dom.test.ts` |
| `M4`, `M5`, `M12`, `M13`, `M17` | ⚑ **`run_suite`** — `apps/desktop/test/a-gesture-that-creates-an-agent.test.ts` |

⚠️ **Three rows were filed under the wrong gate in drafts of this table, and both mistakes were
caught by running them rather than by reading them.** `M6`/`M7` were under `run_suite`: the node
project EXCLUDES `test/dom/**` and the only files importing `NewAgent.vue` are under it, so that
suite reads the component as SOURCE and never mounts it. `M17` was under `run_dom` and **reported
as a SURVIVOR** — it edits `RuntimeScreen.vue`, which no dom file mounts; what kills it is the
source census in the node suite that pins the screen's second resolution call. ⛔ **A gate column
is a claim like any other, and a row verified against the wrong gate is not verified.**

⚠️ **Every row was applied ALONE and watched go red against the file named here** —
`verify-each-mutation-row-without-running-the-table`. ⛔ **No table was run.**

## ⛔ What this table deliberately does NOT contain

⛔ **No row on the store rebuilding the literal it sends.** `AgentStore.create` writes
`{ slug, displayName, role, provider }` out of its argument rather than forwarding it, which is
`363`'s `plain-by-construction` on the renderer side of the wire. ⚠️ **Handing `said` straight
through would SURVIVE**: the one caller already builds a fresh object, so the replacement changes no
answer any test can produce (`a-true-mutation-measures-nothing`). The defence is real and its cost is
one line; what it guards against is a SECOND caller, and a row would be pricing a caller that does
not exist yet.

⛔ **No row on `AGENT_DISPLAY_NAME_CHARS`.** `419` made the same call and its reasoning was corrected
rather than repeated: the control and the schema both READ the constant, so a bound moved there moves
both and no test can see it (`a-bound-written-as-the-constant-cannot-pin-it`).

⛔ **No row on `role` being write-only.** `AgentIdentity` carries no `role` and `IDENTITY_COLUMNS`
does not select it, so what the form writes is visible only in the instructions a later launch
composes. That is a finding this dispatch REPORTS and did not fix; a mutation row would imply the
wire had been widened for it.

⛔ **No row on the 24px grid rule.** The Agents rows draw an 18px `project-symbol`, not an
`AgentState` plate, so this section is correctly on the base `.rail-item` grid and `423` added
nothing to `151 M19`'s selector list. A row would assert a declaration that must not exist.
"""

RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
BOARD = "apps/desktop/src/renderer/src/components/ProjectsBoard.vue"
# 🔴 **570 · the AGENTS section left the navigation column** (`EXT-008` §4.4), and the roster
# row it drew is `TeamWorkspace`'s card. ⛔ **Every row below that pointed into that block is
# CORRECTED IN PLACE and re-verified RED one at a time, never retired** — the subject moved and
# only the bytes changed (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
TEAM = "apps/desktop/src/renderer/src/components/TeamWorkspace.vue"
FORM = "apps/desktop/src/renderer/src/components/NewAgent.vue"
STORE = "apps/desktop/src/renderer/src/lib/agent-store.ts"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
PLACED = "apps/desktop/src/renderer/src/components/StartAsAgent.vue"
TOOLSREGISTER = "apps/desktop/src/renderer/src/components/ToolsRegister.vue"

MUTATIONS = [
    # ── §1 · the gesture ──────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, verbatim · the rail has no create gesture, so the app is back to the "
        "state `417` left it in — an identity comes into being only by a conversation running as "
        "one, and HO-023 §3's property is unmet with `417` and `420` still held on it · killed by `a-gesture-that-creates-an-agent.dom.test.ts`",
        # ⚑ **570 · MOVED.** The gesture is the Team page's `New agent` header button; the
        # overlay `RuntimeScreen` raises from it is the same one.
        [(TEAM,
          # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the New agent button became a shared primary button with one attribute per line; the plant still removes its press, so the page has no gesture that creates an agent
          "        data-cy=\"team-create\"\n        @click=\"emit('create')\"\n",
          "        data-cy=\"team-create\"\n")],
    ),
    (
        # ⚑ Landing D-016a (bd70d693) · killer:
        # `the-add-server-button-stays-at-the-far-end-of-the-tools-head.dom.test.ts` (the landing
        # added it; no existing test observed this plant).
        "M2 · ⛔ the spacer stops pushing, so the button packs against the count · 376's own "
        "comment names the outcome — *a third child would spread the count into the middle of "
        "the row* — and the page head has free space to spend doing the same thing. ⚑ "
        "**Re-anchored TWICE and it is the same rule both times**: `423` measured it on the "
        "rail's AGENTS header, `570` moved the subject to PROJECTS, and `572` moved it to "
        "`ProjectsBoard`'s page head, where the mechanism is a `flex: 1` spacer rather than "
        "`space-between` plus a wrapper. ⛔ **The wrapper version is gone from the app**: no "
        "`.section-label` in this rail wraps its right end any more",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The refutation holds. ToolsRegister's .page-head has the same shape the
        # deleted ProjectsBoard had (copy, `.head-spacer{flex:1}`, primary 'Add server…' button),
        # and nothing measures the button's position. NO EXISTING TEST KILLS THE PLANT, and a naive
        # position assertion could SURVIVE it: the ~130-character explanation at 10.5px nearly fills
        # the 760px head, so the button may sit at the right end even with no spacer. The new
        # chromium assertion must first shorten [data-cy=tools-register-is] to a word, so the spacer
        # alone decides, then expect the tools-add-server button's right edge to equal the
        # .page-head's right edge within 1px. Under the plant the button lands about 60px from the
        # left.
        [
            (TOOLSREGISTER, '.head-spacer {\n  flex: 1;\n}', '.head-spacer {\n}'),
        ],
    ),
    (
        "M3 · ⚠️ the empty note goes back to claiming a conversation is the only way · a person "
        "looking at a rail with a create button on it is told, one line below it, that creation is "
        "not a thing they can do — standing rule 8's drifting description, in the section the "
        "gesture landed in",
        # ⚑ **570 · MOVED.** The sentence is the Team page's `team-none`, and on a page it is
        # REACHABLE — in the rail `423` found it behind a `v-else-if` the orphan note always won.
        # ⚑ **641 · anchor corrected.** The directory moved inside its own `role="tabpanel"` so a
        # second tab could sit beside it, and prettier re-indented AND re-wrapped this sentence
        # across two lines. ⛔ **The SUBJECT is untouched** — it is still `team-none`, still the
        # only positive empty claim on this page. ⚠️ Corrected rather than retired, and
        # RE-VERIFIED RED against `the-agent-a-person-makes.dom.test.ts`.
        [(TEAM,
          "          No agent identities yet. Create one above, or one appears once a conversation has run as\n          it.",
          "          No agent identities yet. One exists once a conversation has run as it.")],
    ),
    # ── §2 · the store verb ───────────────────────────────────────────────────────────────────
    (
        "M4 · ⛔ the roster is not re-read, so the sheet closes over a list that has not got the "
        "row · the rail's count, the capability sheet's grantable list and the front door's "
        "provider all read that one ref, and all three keep the answer from before the press",
        # ⚠️ **Re-anchored by `516`**, and the reason is the row's own hazard arriving at its
        # anchor: two more store methods now legitimately re-read and check the same way, so the
        # old two-line anchor matched THREE times — and *a row that matches more than once applies
        # to nothing* (`a-reused-literal-makes-a-mutation-anchor-match-twice`). ⛔ **The SOURCE is
        # right**: a creation, a registration and a removal all have nowhere to patch, so each reads
        # the list back and answers its own failure. ⚑ So the anchor takes `create`'s OWN sentence
        # with it, which no other method can spell. The DEFECT is unchanged.
        # ⚑ ANCHOR CORRECTED IN PLACE BY 712 — R41 (`707` GAP-5): the sentence names the new agent off
        # the row main returned (`agentName(created.slug, [created])`) where it printed the slug, and
        # three comment lines sit above its return; the defect planted is unchanged: the re-read is
        # skipped.
        [(STORE,
          "        await load()\n"
          "        if (loadError.value !== null) {\n"
          "          // ⚑ **712 · R41 — the new agent NAMED, off the row main wrote**: a blank name box is not\n"
          "          // a nameless agent — main gives it a name from the pool (`nameForANewIdentity`) — so the\n"
          "          // name is the answer's, never the box's, and the slug only where main stored none.\n"
          "          return `${agentName(created.slug, [created])} was created, but this window could not re-read the list: ${loadError.value}`",
          "        if (loadError.value !== null) {\n"
          "          // ⚑ **712 · R41 — the new agent NAMED, off the row main wrote**: a blank name box is not\n"
          "          // a nameless agent — main gives it a name from the pool (`nameForANewIdentity`) — so the\n"
          "          // name is the answer's, never the box's, and the slug only where main stored none.\n"
          "          return `${agentName(created.slug, [created])} was created, but this window could not re-read the list: ${loadError.value}`")],
    ),
    (
        "M5 · 🔴 the refusal reaches a person as the LIBRARY wrote it · `Error invoking remote "
        "method 'runtime:command': Error: There is already an agent called worker.` — 249 M20's "
        "defect on another surface, and the one shape no fake bridge in this repo can reproduce",
        [(STORE, "  const sentence = (error: unknown): string => readableError(error)",
          "  const sentence = (error: unknown): string =>\n    error instanceof Error ? error.message : String(error)")],
    ),
    (
        "M6 · ⚠️ a blank display name crosses the wire as `''` rather than null · an empty string "
        "and *nobody has said* become one value, which is 339's `.nullable()` ruling inverted at "
        "the only call site that can tell them apart",
        [(FORM, "    displayName: name.value.trim() === '' ? null : name.value.trim(),",
          "    displayName: name.value.trim(),")],
    ),
    (
        "M7 · ⛔ the sheet closes over a refusal · the only place the name is explained goes with "
        "it, and a person is left at a rail that did not change with nothing said",
        [(FORM, "  if (createRefusal.value === null) emit('close')", "  emit('close')")],
    ),
    # ── §3 · what the form asks for ───────────────────────────────────────────────────────────
    (
        "M8 · ⛔ the TYPED name is sent instead of the folded one · `Worker` reaches a store that "
        "folds anyway, so the row is `worker` and the surface showed something else — 086's "
        "fabricated value with the fabrication on our side (238)",
        [(FORM, "    slug: folded.value,", "    slug: slug.value.trim(),")],
    ),
    (
        "M9 · ⚠️ an empty name is pressable · the press goes to the wire, zod refuses "
        "`slug: must be …`, and a person meets a path rule with a library's punctuation on it "
        "instead of a button that was never lit",
        [(FORM,
          "const blocked = computed(() => creating.value || folded.value === '' || slugRefusal.value !== null)",
          "const blocked = computed(() => creating.value || slugRefusal.value !== null)")],
    ),
    (
        "M10 · ⛔ a folder with no row becomes a REFUSAL rather than a note · the one name a person "
        "is most likely to be typing on purpose — the one the rail just told them about — is the "
        "one the form will not take, and §4's *reported, not repaired* is inverted",
        [(FORM, "        <p v-else-if=\"adopts\" class=\"note\" data-cy=\"new-agent-slug-adopts\">",
          "        <p v-else-if=\"adopts\" class=\"note err\" data-cy=\"new-agent-slug-refusal\">")],
    ),
    (
        "M11 · 🔴 typing `default` is silently ordinary · a person on a fresh install names BroBot "
        "under a heading that says *New agent*, mints its seeded grants and chooses the provider "
        "every conversation in the app will run on, and nothing says so",
        [(FORM, "    folded.value === DEFAULT_PROFILE_ID &&", "    false &&")],
    ),
    # ── §4 · the provider ─────────────────────────────────────────────────────────────────────
    # Source-only anchor repair; NOT VERIFIED.
    (
        "M12 · 🔴 `DEFAULT_PROVIDER` goes back to being THE ANSWER · the identity's column is never "
        "consulted on a launch, which is the state `420` §1.1 measured and `419` F3 wrote the fix "
        "for — *a dogfooding constant must not become the permanent provider of every conversation "
        "a person can start*",
        # ⚑ **Re-anchored by `435`** (HO-025 §5). The front door offers a provider again, so this
        # call gained a fourth argument — *what the person asked for*, ranked first — and `prettier`
        # broke it across five lines. ⛔ The DEFECT and the kill are unchanged: the identity's column
        # is never consulted, and `DEFAULT_PROVIDER` is the answer. ⚠️ No `⚑ ANCHOR CORRECTED IN
        # PLACE` suffix, because this table is `unrun` — there is no verdict for the correction to
        # invalidate, and the suffix's only mechanism is moving a run artefact to
        # `partial-or-invalid` (413).
        [
            (
                SCREEN,
                '    providerForALaunch(\n      agentStore.identities.value,\n      DEFAULT_PROFILE_ID,\n      DEFAULT_PROVIDER,\n      launchChoices.value.provider,\n    ),',
                "  DEFAULT_PROVIDER,",
            )
        ],
    ),
    (
        "M13 · ⛔ the fallback is consulted FIRST · the constant is never null, so an identity that "
        "HAS chosen is overridden by a dogfooding default — `419` M18's defect one door over, with "
        "the two terms that door orders swapped",
        # ⚑ **Re-anchored by `435`**: the order gained the asked term at the front (HO-025 §4), and
        # this row still swaps the two terms it was written about. ⛔ The kill is unchanged.
        [
            (
                STORE,
                # ⚑ **an agent keeps its provider · re-anchored in place, not retired** — the launch's rule reads what the agent runs on (runsOnIn) instead of the identity's raw column; same order, same plant.
                "  return asked ?? runsOnIn(list, slug)?.provider ?? fallback",
                "  return asked ?? fallback ?? runsOnIn(list, slug)?.provider",
            )
        ],
    ),
    (
        "M14 · ⚠️ the adopt note compares a FOLDED name against an UNFOLDED list · every orphan "
        "whose folder is not already lower-case — which is the population the fold exists for — "
        "stops being reported, silently, on the one surface that could give it its row",
        [(FORM, "      (folder) => foldProfileName(folder) === folded.value,",
          "      (folder) => folder === folded.value,")],
    ),
    # ── §5 · the other door (relay 1) ─────────────────────────────────────────────────────────
    (
        # ⚑ Landing D-016a (bd70d693) · killer:
        # `a-folder-a-person-chose-is-the-folder-the-conversation-runs-in.dom.test.ts` (the landing
        # added it; no existing test observed this plant).
        "M15 · 🔴 THE OTHER DEFECT, verbatim · the placed door sends no project, so every "
        "conversation lands in the pinned one and HO-023 §3's (b) is undelivered — which is the "
        "state `424` F3 measured: after `417` merges, every conversation a person can open is "
        "BroBot's, in the workspace, and so is everything it spawns",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The refutation holds. D-016 replaced the project select with a folder
        # picker, so the person's placement is now `cwd: folder.value` (StartAsAgent.vue:247), and
        # the plant sends every launch to the workspace whatever was chosen. NO EXISTING TEST KILLS
        # IT: §6 only launches with no folder, and no dom test stubs chooseCwd or presses
        # start-as-agent-choose-folder. Add a §6 test that sets window.api.chooseCwd to resolve {
        # path: '/work/repo' }, presses start-as-agent-choose-folder, sends, and expects the emitted
        # input to carry cwd '/work/repo'; run it with --project "dom (chromium)".
        [
            (PLACED, '      ...(folder.value === null ? {} : { cwd: folder.value }),', '      ...{},'),
        ],
    ),
    (
        "M16 · ⛔ the placed door opens as BroBot · the identity a person chose is thrown away at "
        "the one door that exists to honour it, and the sheet's own heading names somebody the "
        "conversation is not",
        [(PLACED, "      profileId: props.profileSlug,", "      profileId: DEFAULT_PROJECT_ID,")],
    ),
    (
        "M17 · 🔴 the placed door ignores the identity's provider · `423` §3's resolution goes back "
        "to being a decoration — the only door that can reach a non-null `agent_identity.provider` "
        "stops reading it, and a person who created an agent on Claude gets Codex with the sheet "
        "still saying Claude",
        [(SCREEN, "  return providerForALaunch(agentStore.identities.value, profileSlug, DEFAULT_PROVIDER)",
          "  return DEFAULT_PROVIDER")],
    ),
    (
        "M18 · ⚠️ a project with no folder becomes an ERROR rather than an answer · relay §3's "
        "ruling inverted — *if the project has no folder, the conversation has none, and that is "
        "correct, not an error to prevent* — and the one project every install has is the one with "
        "no folder",
        [(PLACED, '        <p v-else class="note" data-cy="start-as-agent-no-folder">',
          '        <p v-else class="note err" data-cy="start-as-agent-refusal">')],
    ),
]
