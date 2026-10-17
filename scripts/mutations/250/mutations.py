#!/usr/bin/env python3
"""250's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **the person watched his own app say `idle` twice while it was not.** `248` built the registry and
never touched the state: the pill is computed from `input.status`, and `agent-state.ts` contained
nothing about background work at all. So the surface that was RIGHT — *"1 thing is still running ·
waiting for person.txt to appear on Desktop · `local_bash` · Stop"* — sat a few inches under a header
that said `idle`, a rail row that said `claude · idle`, and a drawer that said *"Nothing is
waiting"*.

⚑ **Measured live before anything was built** (`pnpm run probe:idle-truth`, two runs). At the instant
the turn ended, with the OS reporting the spawned process ALIVE (`process.kill(pid, 0)`) and the
host's own status published by `SessionMachine` as `idle`, the three surfaces now read **Still
running · claude · still running · Nothing is waiting on you**, over `248`'s registry holding one
`local_bash` row.

## ⛔ The design decision the rows are about

**A FOURTH FACET, not a sixth `doing`.** `081` gave this file three composing vocabularies, each
single-valued; *"idle AND something is running"* is genuinely two facts. A `doing: 'background'`
would have had to be chosen INSTEAD of `replying` or `tool`, would have needed an avatar, and would
have promoted an idle session to a busy DOING — which is precisely the 042/089/099 bug
`sessionDoing`'s precedence exists to prevent. A `being` would shadow the provider's liveness; a
`needing` would spend the attention channel on something that asks nothing, which `229` and `107` §6
both rule out by name.

⚑ **And it draws no new mark.** The fact is already drawn — `248`'s bar, with the description, the
kind and the stop button. What was missing is that the WORDS disagreed with it. So the facet changes
{@link standingOf} and nothing else: `219`'s *do not invent a second mechanism*, and `099`'s one
derivation with three projections.

The row groups:

 * `M1`-`M4`   🔴 **the fact reaching the surfaces at all** — the branch the person watched be wrong, and
                each of the three call sites that carry it there.
 * `M5`-`M7`   ⛔ **precedence** — what the new word may not talk over. A permission FREEZES the
                composer and this blocks nothing (`229`/`063`); `unknown` is a refusal to claim and a
                refusal a smaller fact can talk over is not one.
 * `M8`-`M11`  ⚠️ **the vocabulary** — `248`'s own two words reused rather than a second phrase
                invented (`222` §4), the pill's tone, and the sentence a screen reader hears.
 * `M12`-`M13` ⛔ **the predicate every surface asks** (`223`) — including the level that UNDERSTATES
                itself, which is the one payload a `running.length` test answers "idle" on.
 * `M14`-`M18` ⛔ **the panel's sentence** — `229`'s ruling applied (never `waiting`), `108`'s
                asymmetry applied (`HAPPENING`, not `WAITING`), `067`'s blank column not
                reintroduced, and `239`'s rule that the sentence raising the alarm names the
                instrument.
 * `M19`-`M20` 🔴 **the two callers, separately** — the pane's (`ConversationPane`, the header pill)
                and the rail's, which must read the CONTROL projection or go quiet about every
                conversation the reader is not looking at (`064`).
 * `M21`-`M22` ⚠️ **the markup** — the component asking the projection rather than holding a literal,
                and the attribute a cross-surface test reads.
 * `M26`       🔴 **the drawer's bot**, which printed `idle` a few lines above the new paragraph —
                the fifth word surface, listed by neither the dispatch nor this diff's first draft.
 * `M27`       ⚠️ **Home's reassurance**, which enumerated a vocabulary it does not own and which
                nothing in the suite could see change.
 * `M24`-`M25` 🔴 **the sentence not pointing at a bar that did not render** — the level that names
                rows this app cannot list, which is the one state `somethingRunning` and
                `BackgroundBar`'s own `v-if` disagree about.
 * `M23`       🔴 **the defect this diff's own adversarial pass found** — the plate's accessible name
                losing the fourth facet, which is `222` §4's *a word nothing can produce* created by
                the fix for it. Every caller spreads the whole facets object, so before the prop was
                declared the fact arrived as a stray fallthrough ATTRIBUTE and the sentence was
                unreachable.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⛔ **No row can kill the TERMINAL precedence, and that is deliberate.** `standingOf` puts
   `errored`/`ended`/`unstarted` above `background`, but `markTerminal`, `markReopened` and
   `markReadOnly` all call `stopDetachedWork`, which empties the registry — so `ended + detached` is
   unreachable and a mutation that reordered those lines would change no observable answer. The
   invariant is pinned by a FOLD test instead (`idle-truth.test.ts`, *"a session that has ENDED
   cannot be holding running work"*), which is the honest place for it: if the fold ever stops
   sweeping, that test goes red and the guard has to come back into `standingOf`.
 * ⛔ **No row proves the LIVE claim.** That a real model detaches a real command and a real process
   is alive at the instant a real turn ends is not a property of this tree. `probe:idle-truth` is its
   instrument and it reads the OS. If a future pin changes what the model does, that probe goes red
   and this table stays green — which is the correct division, and it means the table is NOT evidence
   for §5's headline.
 * ⚠️ **No row makes the PILL'S COLOUR visible.** `STANDING_TONE.background` is `live`, and `M11`
   kills only because a unit test reads the token — no mutation here asserts a computed colour, so a
   stylesheet that stopped honouring `.live` would survive. `248` left the same gap and named it
   rather than shipping a row that cannot die.
 * ⚠️ **`BackgroundBar`'s `v-if` is NOT mutated and is not fixed here.** It is `running.length > 0`,
   narrower than {@link somethingRunning}, so a level that understates itself draws no bar while the
   WORD says work is running. Widening it is not a one-line change — the bar's heading counts
   `running.length`, so it would open with *"**0** things are still running"* — and that is `248`'s
   card vocabulary, which this dispatch is scoped out of. Reported in 250's response §5 instead.
 * ⚑ **Nothing retired, and nothing of another table's moved.** Run `census.py` before believing that
   in either direction — 238's lesson 4. Every file this table touches is new in 250's diff or gained
   only additions.

## ⚑ The killing test for every row

⛔ **NAMED, NOT VERIFIED — and 250 says so rather than implying otherwise.** The dispatch scoped this
seat to *"write the rows but DO NOT RUN the table — a dedicated seat runs them batched"*, so every
line below is the test the row is BUILT to kill and not a test that has been watched going red. `238`'s
lesson (two rows green beside prose saying they must die) is exactly the risk this leaves open, and it
is the running seat's to close.

⚑ What HAS been checked is the only thing that can be without running it: all anchors are present
exactly once (`mutations.py --dry-run`).

 * `M1`  → `idle-truth.test.ts` *"turn over, work still running — no surface says the conversation is
           idle"*; `idle-truth.render.test.ts` both surfaces.
 * `M2`  → the same, via the facet never being built.
 * `M3`  → `idle-truth.render.test.ts` *"says 'claude · still running', not 'claude · idle'"*.
 * `M4`  → `idle-truth.render.test.ts` *"says 'Still running' over a conversation whose work outlived
           the turn"* (the pane's own call site).
 * `M5`  → `idle-truth.test.ts` *"a permission still wins — it freezes the composer and this does
           not"*; `idle-truth.render.test.ts` *"a session waiting on a permission still says so"*.
 * `M6`  → `idle-truth.test.ts` *"…and so does `unknown`, because a refusal to claim outranks a
           smaller fact"*.
 * `M7`  → `idle-truth.test.ts` *"a turn that is genuinely WORKING keeps its own word"*.
 * `M8`  → `idle-truth.test.ts`'s `railWord` equality, and the render test's `claude · still running`.
 * `M9`  → `idle-truth.test.ts` *"the header pill"* equality; `agent-state.test.ts`'s label census.
 * `M10` → `idle-truth.test.ts`'s `pillTone` equality.
 * `M11` → `agent-state.test.ts` *"is a sentence for every one of the 512 states"* — the `said` count.
 * `M12` → `idle-truth.test.ts` *"a level that UNDERSTATES itself is still running"*.
 * `M13` → `idle-truth.test.ts` *"…and the same fold with an EMPTY level reads idle"*;
           `idle-truth.render.test.ts` *"a fresh conversation is untouched"*.
 * `M14` → `session-panel.render.test.ts` *"…and it stops saying that while work is still running"* —
           the paragraph disappears entirely, which is `067`'s blank column.
 * `M15` → `idle-truth.test.ts` *"background work is counted as HAPPENING and never as WAITING"*;
           `session-panel.render.test.ts`'s `data-waiting="0"`.
 * `M16` → `session-panel.test.ts`'s shape census, and every `panelHead` equality.
 * `M17` → `idle-truth.test.ts` *"the panel's three sentences each name their own state"*.
 * `M24` → the same test's `not.toContain('above the composer')` for the unnamed level, and
           *"a level that UNDERSTATES itself is still running"*.
 * `M25` → the same two.
 * `M26` → `idle-truth.render.test.ts` *"the DRAWER's bot says it too — the fifth word surface"*.
 * `M27` → `surfaces.render.test.ts` *"the quiet reassurance states what the queue MEANS and
           enumerates no vocabulary"* — a test that did not exist until the adversarial pass over
           250's diff pointed out that BOTH sentences, the old one and its first replacement, were
           held by nothing in the whole suite.
 * `M18` → the same test's `above the composer`, and the render test's.
 * `M19` → `idle-truth.render.test.ts` *"…and it reads the CONTROL projection, so paging back does
           not silence it (064)"*. ⛔ **This row named a test that could not kill it until the
           adversarial pass over 250's diff APPLIED the mutation and watched the file stay green**:
           every `record()` helper in the suite leaves `control` and `transcript` as the same object,
           so the two readings were indistinguishable. The named test now forks them explicitly.
 * `M20` → `idle-truth.test.ts` *"the RAIL reads the control projection"* (064).
 * `M21` → `session-panel.render.test.ts` *"…and it stops saying that while work is still running"*.
 * `M22` → the same test's `data-running="true"`.
 * `M23` → `idle-truth.render.test.ts` *"the plate's accessible NAME carries it — the sentence a
           screen reader hears"*.

## ⚑ `446` corrected two anchors in place — same defects, same kills

⛔ **`M15` and `M5` moved because `441`'s proposal joined the two things they are about.** The
panel's `waiting` is now a sum over three populations and `standingOf`'s blocking clause admits a
third NEEDING. ⚑ **Neither DEFECT changed**: `M15` still folds background work into a count that
means *blocked on YOU*, and `M5` still ranks it above a card only a person can clear. Both were
applied alone and watched go RED — `M15` against `idle-truth.test.ts`, `M5` against
`one-word-and-what-it-drops.test.ts`.

"""

from pathlib import Path

AGENT = "apps/desktop/src/renderer/src/lib/agent-state.ts"
VOCAB = "apps/desktop/src/renderer/src/lib/background-work.ts"
PANEL = "apps/desktop/src/renderer/src/lib/session-panel.ts"
PANEL_VUE = "apps/desktop/src/renderer/src/components/SessionPanel.vue"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
PLATE = "apps/desktop/src/renderer/src/components/AgentState.vue"
BOT = "apps/desktop/src/renderer/src/components/SessionBot.vue"
HOME = "apps/desktop/src/renderer/src/components/HomeSurface.vue"
# ⚑ 305 §1 moved Home's summary sentences here, where one function decides all of them.
ATTN = "apps/desktop/src/renderer/src/lib/home-attention.ts"
AGENT_STATE = "apps/desktop/src/shared/agent-state.ts"

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- the fact reaching the surfaces at all ---------------------------------------------------
    (
        "M1 · 🔴 THE DEFECT, verbatim · the word ignores the registry again, so the pill says Idle, "
        "the rail says `claude · idle` and the drawer says Nothing is waiting — over a command the "
        "OS reports alive. This is the line the person watched be wrong, twice",
        [
            (
                AGENT,
                "  if (facets.doing === 'idle') return facets.detached ? 'background' : 'idle'",
                "  if (facets.doing === 'idle') return 'idle'",
            )
        ],
    ),
    (
        "M2 · ⛔ the facet is built but never carried · `sessionFacets` drops it, so every surface "
        "downstream is reading an object the fact never reached — the same silence, one layer up",
        [(AGENT, "    ...(input.detached ? { detached: true } : {}),\n", "")],
    ),
    (
        "M3 · 🔴 the RAIL goes quiet · `recordFacets` stops asking, so every conversation in the "
        "rail — which is most of them, since only one is on screen (064) — reads `claude · idle`",
        [(AGENT, "    detached: somethingRunning(record.control.background),\n", "")],
    ),
    (
        "M4 · 🔴 the HEADER goes quiet · the pane stops passing it, so the pill above the "
        "conversation disagrees with the registry a few inches below it — 099, restaged",
        [(PANE, "  detached: somethingRunning(control.value.background),\n", "")],
    ),
    # ---- precedence -----------------------------------------------------------------------------
    (
        "M5 · ⛔ background work outranks a PERMISSION · a conversation frozen on a card the user "
        "must answer reads `still running`, and 063/079 §5's guarantee — an unanswered card always "
        "has a visible trace — is gone. 229: this asks nothing and blocks nothing",
                # ⚑ **Re-anchored by `446`**, which EXTRACTED this clause: the closed set of
                # NEEDINGS that may summon attention had four copies, and `441`'s proposal is the
                # member that would have separated them. ⛔ The DEFECT is unchanged: background
                # work, which asks nothing, ranked above a card only a person can clear.
                # ⚑ **636 · anchor CORRECTED, subject unchanged.** The guard gained a second
                # source — `waitSummonsAPerson(facets.waiting)`, the one wait that IS a person's
                # (`621` §5.2) — so the BYTES moved and the defect this row plants did not.
                # ⛔ Re-verified RED by hand at `636`
                # (`correct-a-stale-mutation-anchor-dont-retire-it`).
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The precedence rule —
        # background work must never talk over a card only a person can answer — still holds; it
        # just moved out of a two-line check inline in `standingOf` into the shared, ordered
        # `agentStateArm` (`needsYou` asked before `inTheBackground`). Re-inserting a background
        # short-circuit ahead of the arm computation plants the identical defect.
        [
            (AGENT, "  const arm = agentStateArm(armFactsOf(facets))\n  if (arm === 'needs-you') return 'waiting'", "  if (facets.detached) return 'background'\n  const arm = agentStateArm(armFactsOf(facets))\n  if (arm === 'needs-you') return 'waiting'"),
        ],
    ),
    (
        "M6 · ⚠️ it talks over `unknown` · the host has said nothing about this session and the app "
        "claims to know what it is doing — 081's faceless ring is a refusal, and a refusal a smaller "
        "fact can override is not one",
        [
            (
                AGENT,
                "  if (facets.doing === undefined || facets.doing === 'unknown') return 'unknown'",
                "  if (facets.detached) return 'background'\n"
                "  if (facets.doing === undefined || facets.doing === 'unknown') return 'unknown'",
            )
        ],
    ),
    (
        "M7 · ⚠️ a WORKING turn is relabelled · the pill stops saying the model is working the "
        "moment anything is detached, which trades one wrong word for another — 081's one-word rule "
        "is that the surface says the most important thing, and a live turn is it",
        [
            (
                AGENT,
                "  if (facets.doing === 'idle') return facets.detached ? 'background' : 'idle'\n",
                "  if (facets.detached) return 'background'\n"
                "  if (facets.doing === 'idle') return 'idle'\n",
            )
        ],
    ),
    # ---- the vocabulary -------------------------------------------------------------------------
    (
        "M8 · ⛔ a SECOND phrase for one fact · the rail prints `claude · background` while the "
        "registry above the composer and the tool card both say *still running* — 222 §4's "
        "one-vocabulary rule, which exists because a person must not meet two names for one thing",
        # ⚑ Landing ui batch 1 · re-anchored in place, not retired — F023 (`f2d554d8`) gave the
        # branch a richer phrase (*running in the background · <command>*) and, on purpose, left the
        # header pill and the registry's head on *still running*. So the rule is narrower now: the
        # rail, the plate and the palette say one phrase, and never the raw enum. The plant still
        # prints `claude · background`.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The one-vocabulary rule
        # (no second phrase for 'background' on the rail) still lives in `standingWord`; the branch
        # now calls the shared `agentStateWords` instead of building the string by hand, but it is
        # still the one place that turns the `background` standing into its sentence. Deleting it
        # makes `standingWord` fall through to the raw enum value 'background', reproducing the
        # original defect exactly.
        [
            (AGENT, "  if (standing === 'background')\n    return agentStateWords(\n      state?.is === 'in-the-background' ? state : { is: 'in-the-background', what: null },\n    )\n", ''),
        ],
    ),
    (
        "M9 · 🔴 the pill says Idle again by the shortest possible route · the derivation is right "
        "and the label lies, which is the failure a `Record<Standing, string>` exists to make loud",
        [(AGENT, "  background: capitalise(BACKGROUND_WORD.running),", "  background: 'Idle',")],
    ),
    (
        "M10 · ⚠️ the pill wears the blank tone · `idle`'s own absence of colour, on the one state "
        "that is not idle — the impression this dispatch exists to remove, kept in CSS",
        [
            (
                AGENT,
                "  background: 'live',\n  working: 'live',",
                "  background: '',\n  working: 'live',",
            )
        ],
    ),
    (
        "M11 · ⚠️ the screen reader is left with the old sentence · *claude — idle, live* over work "
        "the sighted reading shows in a list with a stop button. The one person who cannot see that "
        "list is the one this omission costs",
        [(AGENT, "  if (input.detached) parts.push('work still running')\n", "")],
    ),
    # ---- the predicate --------------------------------------------------------------------------
    (
        "M12 · ⛔ the predicate reads only the rows it can NAME · a level payload the provider sent "
        "with no `task_id` — counted by `normalize.ts` precisely because it can be neither listed "
        "nor stopped — makes every surface answer *idle* while something is running. 247 §3: a "
        "registry that quietly undercounts is worse than none",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The 'one predicate, every
        # consumer asks it' rule for `somethingRunning` is untouched — D-017's R11 moved the
        # function whole, byte-for-byte, into `shared/agent-state.ts` so `main` and the renderer
        # share one answer. The dropped-row undercount defect re-anchors verbatim at the new path.
        [
            (AGENT_STATE, '  return level.running.length > 0 || level.dropped > 0', '  return level.running.length > 0'),
        ],
    ),
    (
        "M13 · ⚠️ the other direction · every conversation ever opened reads *still running*, "
        "including one that has never seen a level payload — a badge that never comes down is a "
        "badge nobody reads (037)",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same predicate, same move
        # as M12 — only the direction of the defect differs (always-true instead of ignoring
        # `dropped`). The 'nothing running reads idle' control this row breaks still exists at the
        # new path.
        [
            (AGENT_STATE, '  return level.running.length > 0 || level.dropped > 0', '  return level.running.length >= 0'),
        ],
    ),
    # ---- the panel's sentence -------------------------------------------------------------------
    (
        "M14 · ⛔ the fact is folded into `empty` · the paragraph vanishes in the one state that "
        "most needs a sentence, leaving the blank column 067's review named — the fix for one lie "
        "reintroducing a different one",
        [
            (
                PANEL,
                "    empty: waiting === 0 && agents.length === 0 && workflows.length === 0 && todo === null,",
                "    empty:\n"
                "      waiting === 0 &&\n"
                "      agents.length === 0 &&\n"
                "      workflows.length === 0 &&\n"
                "      todo === null &&\n"
                "      !somethingRunning(state.background),",
            )
        ],
    ),
    (
        "M15 · ⛔ it is counted as WAITING · the composer freezes, the drawer badges and 205's "
        "attention bar rises for work that asks nothing — 229's ruling exactly, and 108's asymmetry "
        "(counted as HAPPENING, never as WAITING) broken in the one line that states it",
                # ⚑ **Re-anchored by `446`**, which added `441`'s proposal to the same sum. ⛔ The
                # DEFECT is unchanged: background work joining a count that means *blocked on YOU*.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule (running
        # background work is counted as HAPPENING and never as WAITING, 229/108) survives in
        # `session-panel.ts`; D-016 only removed `proposals.length` from the sum, so the anchor is
        # now `questions.length + permissions.length`. The corrected plant adds one waiting item
        # whenever `somethingRunning(state.background)` (already imported at line 11), which is the
        # label's defect verbatim.
        [
            (PANEL, '  const waiting = questions.length + permissions.length\n', '  const waiting =\n    questions.length + permissions.length +\n    (somethingRunning(state.background) ? 1 : 0)\n'),
        ],
    ),
    (
        "M16 · 🔴 the projection stops knowing · `stillRunning` is hard-false, so the drawer says "
        "*Nothing is waiting* over a running command — the person's third sighting, restored",
        [(PANEL, "    stillRunning: somethingRunning(state.background),", "    stillRunning: false,")],
    ),
    (
        "M17 · ⚠️ the words stop being chosen · one sentence for three states, and it is the one "
        "that is false while work runs",
        [
            (
                PANEL,
                "  if (!panel.stillRunning) return PANEL_EMPTY_WORDS.quiet\n"
                "  return panel.runningNamed ? PANEL_EMPTY_WORDS.running : PANEL_EMPTY_WORDS.unnamed",
                "  return PANEL_EMPTY_WORDS.quiet",
            )
        ],
    ),
    (
        "M24 · 🔴 the sentence points at a bar that did not render · a level that names rows this "
        "app cannot list (`dropped` without `running`) draws no `BackgroundBar` at all, because its "
        "`v-if` counts `running.length` — so *'it is listed above the composer'* sends the reader to "
        "nothing. Found by the adversarial pass over 250's diff, which RENDERED the state",
        [
            (
                PANEL,
                "  return panel.runningNamed ? PANEL_EMPTY_WORDS.running : PANEL_EMPTY_WORDS.unnamed",
                "  return PANEL_EMPTY_WORDS.running",
            )
        ],
    ),
    (
        "M26 · 🔴 the DRAWER's bot says `idle` again · `SessionBot` renders inside `SessionPanel`, a "
        "few lines above the paragraph that says work is still running — so the tab shows both at "
        "once, which is the person's own complaint surviving inside the panel 250 was fixing. The fifth "
        "word surface, and neither the dispatch nor the first draft of this diff listed it",
        [
            (
                BOT,
                "const subtitle = computed(() =>\n"
                "  standingOf(props.facets) === 'background'\n"
                "    ? standingWord(props.facets)\n"
                "    : DOING_WORD[props.facets.doing ?? 'unknown'],\n"
                ")",
                "const subtitle = computed(() => DOING_WORD[props.facets.doing ?? 'unknown'])",
            )
        ],
    ),
    (
        "M27 · ⚠️ Home enumerates the standings again · *'Every open conversation is either working "
        "or idle'* is a list of two over a vocabulary of eight, on the one surface the person scans — and "
        "it goes stale, silently, every time the vocabulary grows. 250's first fix widened the list "
        "to three and the adversarial pass over its own diff pointed out that it was still "
        "incomplete; the claim is the ABSENCE of an enumeration, not a particular sentence",
        # ⚠️ **Anchor corrected in 305 §1, not retired.** The sentence did not change; it MOVED, out
        # of `HomeSurface.vue` and into `home-attention.ts`, where every summary on that screen is
        # now decided. The row protects the same claim in the same words, at its new address.
        #
        # ⚑ **CORRECTED AGAIN IN PLACE BY 468.** The sentence still does not change; `468` appended
        # the placeholder disclosure to it, because the quiet arm is now reachable with seeded rows
        # on screen and `403`'s *"it used to live in one arm and that arm stopped firing"* would
        # otherwise have happened a second time. ⛔ Same label, same claim, same kill — the
        # enumeration comes back and this row is what says so.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — Home is gone, but the
        # rule is the absence of an enumerated vocabulary in the quiet reassurance, and that
        # sentence survives verbatim in `homeAttention().intro`, drawn by `WaitingOnYou.vue`; D-016
        # only removed the `${andThePlaceholders}` suffix (the seeded placeholders went with the
        # demo seed), so the template literal became a plain string. The plant puts back the
        # two-item list, and surfaces.render.test.ts's 'enumerates no vocabulary (250)' asserts
        # `not.toContain('either working or idle')` on the rendered paragraph.
        [
            (ATTN, "      ? 'Nothing here is blocked on an answer from you.'", "      ? 'Every open conversation is either working or idle.'"),
        ],
    ),
    (
        "M25 · ⚠️ `runningNamed` stops being the BAR's own condition · the sentence and the widget "
        "come to disagree about whether there is a list to look at, which is 223's rule in the one "
        "place 250 had to obey it twice",
        [
            (
                PANEL,
                "    runningNamed: state.background.running.length > 0,",
                "    runningNamed: somethingRunning(state.background),",
            )
        ],
    ),
    (
        "M18 · ⚠️ the alarm loses its instrument · the sentence says work is running and no longer "
        "says where to look for it — 239's rule is that a refusal states its own workaround, and "
        "this app HAS the instrument, six inches down",
        [
            (
                PANEL,
                "    body: `Work this conversation started is ${BACKGROUND_WORD.running} — it is listed above the composer.`,",
                "    body: 'Work this conversation started is still running.',",
            )
        ],
    ),
    # ---- the two callers, and the projection each must read --------------------------------------
    (
        "M19 · ⚠️ the pane reads the READING window · a person who scrolls back through a long "
        "conversation makes the header pill go quiet about work that is still running — 064's whole "
        "subject, and 061 finding 5's list of what reading old history was allowed to change",
        [
            (
                PANE,
                "  detached: somethingRunning(control.value.background),",
                "  detached: somethingRunning(props.record.transcript.background),",
            )
        ],
    ),
    (
        "M20 · 🔴 the RAIL reads the reading window · every conversation the reader is not looking "
        "at reports on a fold that stopped at the last page they scrolled to. The rail exists to "
        "describe exactly those conversations (064)",
        [
            (
                AGENT,
                "    detached: somethingRunning(record.control.background),",
                "    detached: somethingRunning(record.transcript.background),",
            )
        ],
    ),
    # ---- the markup ------------------------------------------------------------------------------
    (
        # The empty-card paragraph, its condition and its words do not exist. Retain the absent
        # anchor as retired rather than inventing a replacement heading.
        "M21 · ⚠️ the component holds the literal again · the rule is right, the projection is "
        "right, and the heading is a hard-coded string that cannot be wrong in one direction only",
        [
            (
                PANEL_VUE,
                "        <strong>{{ emptyWords.head }}</strong>",
                # ⚑ **CORRECTED IN PLACE BY 577 and again by 602**, each of which re-worded the
                # heading (`EXT-010` §3.1, then `589`'s repair 3).
                # ⛔ The replacement has to be the CURRENT heading or the row stops measuring what
                # its label says: leaving the old words would have made it *un-bind AND change the
                # sentence*, two propositions in one edit, and it would have flipped a recorded
                # survivor to RED with nothing saying so. ⚠️ Still a NO-OP by construction and
                # still a survivor — a mutation that hard-codes a constant's CURRENT value cannot
                # be killed by any test of the current state, which is what *"cannot be wrong in
                # one direction only"* above already admits.
                "        <strong>No permissions, questions or proposals are on a card here</strong>",
            )
        ],
    ),
    (
        # No rendered surface carries this data-running attribute after the empty paragraph is gone.
        # stillRunning has other tests; retain this absent anchor as retired.
        "M22 · ⚠️ the cross-surface handle goes · `data-running` is what lets a test read WHICH "
        "sentence rendered without matching prose, and 099's parity checks are built on exactly "
        "these attributes",
        [(PANEL_VUE, '        :data-running="panel.stillRunning"\n', "")],
    ),
    (
        "M23 · 🔴 the defect 250's own adversarial pass found · the plate's accessible name loses "
        "the fourth facet, so a screen reader hears *claude — idle, live* over work the sighted "
        "reading shows in a list with a stop button. Every caller spreads the whole facets object, "
        "so the fact still ARRIVES — as a stray `detached=\"true\"` on the root element, reaching "
        "nothing. 222 §4's *a word nothing can produce*, created by the fix for it",
        [
            (
                PLATE,
                "    // ⛔ **The one place this prop goes** (250) — see its declaration for why it goes nowhere else.\n"
                "    ...(props.detached ? { detached: true } : {}),\n",
                "",
            )
        ],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = Path(root) / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)")
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace))
    return bad


def main() -> int:
    import sys

    args = sys.argv[1:]
    if args[:1] == ["--count"]:
        print(len(MUTATIONS))
        return 0
    if args[:1] == ["--files"]:
        seen = []
        for _name, edits in MUTATIONS:
            for rel, _find, _replace in edits:
                if rel not in seen:
                    seen.append(rel)
        print(" ".join(seen))
        return 0
    if args[:1] == ["--name"]:
        print(MUTATIONS[int(args[1])][0])
        return 0
    if args[:1] == ["--dry-run"]:
        root = Path(args[1]).resolve()
        bad = 0
        for index in range(len(MUTATIONS)):
            bad += apply(root, index, dry=True)
        print(f"{len(MUTATIONS) - bad}/{len(MUTATIONS)} anchors found exactly once")
        return 1 if bad else 0
    root = Path(args[0]).resolve()
    return apply(root, int(args[1]), dry=False)


if __name__ == "__main__":
    raise SystemExit(main())
