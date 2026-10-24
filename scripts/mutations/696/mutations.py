"""696 · The model control reads R31 — `688` §1b (`682`'s four, less what `691` built), `688` L1,
and `681` F-b.

⚑ **The PM's §1:** what a person reads about a model choice under R31 — a never-run agent's menu
says whose list it is and the draft says what Save will leave (R31d); a saved choice's provenance,
NAMED; a choice not in force said in R31b's own terms; a no-provider agent's menus are its CHOICE's
provider (R31a); the provider press says what the same act cleared. **§2:** a taken-back go-ahead
says *type your next message to carry on* only while the conversation can take one and nobody has
(`688` L1); the Team page never says *no project yet* for an agent starting in one (`681` F-b).

## 🔴 What has to be killable

 * `M1`–`M4` 🔴 **R31d · the menu and the draft**: the catalogue's mark dropped; the draft's sentence
   blind to it; the note above the menus gone; the stand-in drawn as its slug.
 * `M5`–`M7` 🔴 **provenance**: the stand-in never named; the row's mark gone; the held sentence
   handed the slug.
 * `M8`–`M11` 🔴 **R31b · not in force**: `685`'s narrower sentence back; the row's mark gone, or
   drawn for the wrong choices; drawn as a warning.
 * `M12`–`M16` 🔴 **R31a · which provider the menus are for**: the choice ignored; the choice read
   beside a provider of the agent's own; the component reading the resolved provider for the list,
   or for the seed; the sheet's note claiming every launch.
 * `M17`–`M20` 🔴 **R31b · the provider press**: the store dropping what the door cleared; the sheet
   not drawing it; the line outliving the next press; the wrong provider named.
 * `M21`–`M30` 🔴 **`688` L1**: the conversation's state ignored, or never handed down, or claimed
   always; what came after ignored; the person's message, a go-ahead sent again, or a held message
   of theirs not counted; an agent's message counted as the person's; the row ignoring the decision;
   the list not passing it.
 * `M31`, `M32` 🔴 **`681` F-b**: *no project yet* for an agent starting; *first* for one that has run.
 * `M33`–`M43` 🔴 **`696`'s review, two rounds**: a held relay, report or notice, or a cancelled
   message of the person's, counted as carrying on; a conversation closing, a superseded sign-in and
   a page off the end ignored; a draft that IS the held choice saying what the menus' list would;
   the note's *unless you choose another provider* promised on every sheet, or forgotten on
   BroBot's.

## ⚠️ One row SURVIVED its first run, and its killer was added

 * `M14` — the list read for the resolved provider: the label said Claude, the seed kept `opus` as
   *(no longer listed)*, and no assertion read the ROWS. ⚑ DOM §3 now asserts the options are
   Claude's and no refusal is drawn (`696`'s review found it too).

## ⛔ What this table cannot reach

 * ⚠️ **`682`'s `model_choice_set_aside` row** — this dispatch checked how it reads and changed no
   code on its path (a docblock only); `682`'s own rows hold the fold (`682 M26`).
 * ⚠️ **`R31a` itself** — that an agent-started launch of a no-provider agent runs on its choice's
   provider is main's (`682`'s rows); `M12`/`M13` hold the control's reading of it.
 * ⚠️ **The photographs** are evidence, not assertions.

## ⚑ WRITTEN, not run as a table

⛔ **Writing rows is routine, RUNNING a table is rare and deliberate.** Each row was verified RED
alone with `scripts/mutations/verify_row.py` — one row, its killer file, restored from bytes — in an
isolated worktree, never a tree a dev server watches, and no `mutations.txt` exists.
"""

from __future__ import annotations

LIB = "apps/desktop/src/renderer/src/lib"
COMPONENTS = "apps/desktop/src/renderer/src/components"
AGENT_MODEL_CHOICE = "apps/desktop/src/renderer/src/lib/agent-model-choice.ts"
CONVERSATIONPANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"

CHOICE = f"{LIB}/agent-model-choice.ts"
STORE = f"{LIB}/agent-store.ts"
WORDS = f"{LIB}/front-door-words.ts"
PLAN = f"{LIB}/plan-mode.ts"
CONTROL = f"{COMPONENTS}/AgentModelChoice.vue"
SHEET = f"{COMPONENTS}/CapabilitiesSheet.vue"
HELD = f"{COMPONENTS}/QueuedMessage.vue"
LIST = f"{COMPONENTS}/TranscriptView.vue"
PANE = f"{COMPONENTS}/ConversationPane.vue"
TEAM = f"{COMPONENTS}/TeamWorkspace.vue"

HOST = "the-model-control-reads-r31.render.test.ts"
DOM = "the-model-control-reads-r31.dom.test.ts"
GOAHEAD = "who-wrote-it-and-which-task.render.test.ts"

MUTATIONS = [
    # ── R31d · the menu and the draft ───────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **the catalogue's stand-in mark dropped** · a never-run agent's menu reads as its own "
        f"list, and the draft names nothing (`688` §1b) — killed by `{HOST}`",
        [
            (
                "apps/desktop/src/renderer/src/lib/model-lists.ts",
                # ⚑ **W4.78 · re-anchored in place, not retired** — whatTheCatalogueLets went in 6d2d195d (UI-012). The renderer's read of a list (and its standIn mark) is now the model-lists holder. The replacement drops the mark when the list is read. The named killer still asserts it (§1/§2: listFor('fresh', …).standIn toBe 'brobot'), and the DOM picker note goes as well. (moved from agent-model-choice.ts)
                "        if (ours()) put(key, { state: 'answered', list })\n",
                "        if (ours()) put(key, { state: 'answered', list: { ...list, standIn: null } })\n",
            )
        ],
    ),
    (
        "M2 · 🔴 **the draft's sentence blind to the stand-in** · the words before Save are not the "
        f"words after it (`691` §8.1) — killed by `{DOM}`",
        [
            (
                CONTROL,
                "    : whatAModelChoiceReaches({ ...draft.value, standIn: menuStandIn.value }),\n",
                "    : whatAModelChoiceReaches(draft.value),\n",
            )
        ],
    ),
    (
        "M3 · ⚑ **the note above the menus gone** · a person picks from BroBot's list not told whose "
        f"it is — killed by `{DOM}`",
        [
            (
                CONTROL,
                # ⚑ **W4.78 · re-anchored in place, not retired** — UI-012 (6d2d195d) removed the agent-model-stand-in <p>. The note above the list is now handed to ModelPicker as `note` and drawn as model-picker-note. The named killer still asserts it: §1 expects the note to be visible and to read 'This is BroBot’s list…'.
                "            :note=\"standInSays\"\n",
                "            :note=\"null\"\n",
            )
        ],
    ),
    (
        "M4 · ⚑ **the menu's stand-in drawn as its slug** · *brobot’s list* about the agent every "
        f"surface calls BroBot — killed by `{DOM}`",
        [
            (
                CONTROL,
                # ⚑ **W4.78 · re-anchored in place, not retired** — UI-012 (6d2d195d) removed menuStandIn. The note's stand-in name is now built in standInSays. The named killer still asserts it: §1 expects 'This is BroBot’s list…', where the slug would give 'brobot’s'.
                "  const named = theStandInNamed({ standIn: listed.list.standIn }, roster.value).standIn\n",
                "  const named = listed.list.standIn\n",
            )
        ],
    ),
    # ── provenance ──────────────────────────────────────────────────────────────────────────────
    (
        "M5 · 🔴 **the stand-in is never named** · `agentName` bypassed, so a person who named BroBot "
        f"reads its slug — killed by `{HOST}`",
        [
            (
                CHOICE,
                "    : { ...choice, standIn: agentName(choice.standIn, identities) }\n",
                "    : choice\n",
            )
        ],
    ),
    (
        "M6 · 🔴 **the held row's provenance gone** · a provisional choice looks like its own home's "
        f"verdict at a glance — killed by `{DOM}`",
        [
            (
                CONTROL,
                '            <template v-else-if="heldStandIn !== null">\n',
                '            <template v-else-if="false">\n',
            )
        ],
    ),
    (
        "M7 · ⚑ **the held sentence handed the slug** · the saved row's sentence differs from the "
        f"draft's that promised it — killed by `{DOM}`",
        [
            (
                CONTROL,
                "    : heldReachesSays(theStandInNamed(held.value, roster.value), props.itsProvider),\n",
                "    : heldReachesSays(held.value, props.itsProvider),\n",
            )
        ],
    ),
    # ── R31b · not in force ─────────────────────────────────────────────────────────────────────
    (
        "M8 · 🔴 **`685`'s narrower sentence back** · *a launch on Codex does not read it* about a choice "
        f"NOTHING reads (R31b) — killed by `{HOST}`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired —
        # `aChoiceForAnotherProviderSays` (R31b) is untouched in role; D-017's messaging rewrite
        # only reworded it from 'another agent that starts or wakes this one' to 'another agent that
        # starts this one, or whose message starts it' (resume_agent's removal folded into
        # message-starts-it phrasing). The row's narrower-sentence plant applies verbatim to the new
        # wording, and the render test still asserts the exact full sentence with `.toBe`.
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — 6d2d195d (UI-012) reworded 'Change… picks a' to 'Its picker picks a'. Same narrowing back to 685's sentence. The named killer still asserts it: §3 compares the full sentence verbatim.
            (AGENT_MODEL_CHOICE, "    `${PROVIDER_NAME[itsProvider]}, so no launch reads it: another agent that starts this one, or ` +\n    'whose message starts it, does so as though nobody had chosen. Its picker picks a ' +\n    `${PROVIDER_NAME[itsProvider]} model in its place, and Clear takes it away.`\n", "    `${PROVIDER_NAME[itsProvider]}, so a launch on ${PROVIDER_NAME[itsProvider]} does not read it.`\n"),
        ],
    ),
    (
        "M9 · 🔴 **the row's *not in force* gone** · the first thing a person reads looks like a choice "
        f"that holds — killed by `{DOM}`",
        [
            (
                CONTROL,
                # ⚑ **W4.78 · re-anchored in place, not retired** — 6d2d195d (UI-012) moved the `notInForce` condition to the wrapping agent-model-held span, so the <em> now has no v-if of its own. Same removal of the mark. The named killer still asserts it: §2 expects agent-model-not-in-force to be visible and to read 'not in force'.
                "            <em class=\"agent-model-off\" data-cy=\"agent-model-not-in-force\">not in force</em>\n",
                "            <em v-if=\"false\" class=\"agent-model-off\" data-cy=\"agent-model-not-in-force\">not in force</em>\n",
            )
        ],
    ),
    (
        "M10 · ⛔ **the mark drawn for the choices that DO hold** · `682`'s predicate read the wrong "
        f"way round — killed by `{DOM}`",
        [
            (
                CONTROL,
                "  () => held.value !== null && !aChoiceIsInForce(held.value, props.itsProvider),\n",
                "  () => held.value !== null && aChoiceIsInForce(held.value, props.itsProvider),\n",
            )
        ],
    ),
    (
        "M11 · ⚑ ***not in force* drawn as a warning** · a state of the value painted as something "
        f"wrong a press fixes — killed by `{DOM}`",
        [
            (
                CONTROL,
                ".agent-model-off {\n  color: var(--muted);\n",
                ".agent-model-off {\n  color: var(--danger);\n",
            )
        ],
    ),
    # ── R31a · which provider the menus are for ─────────────────────────────────────────────────
    (
        "M12 · 🔴 **the choice ignored** · *Change…* on a no-provider agent's Claude choice opens "
        f"Codex's rows, and a save moves its agent-started launches (`691` §8.3) — killed by `{HOST}`",
        [
            (
                CHOICE,
                "  return itsProvider === null && held !== null ? held.provider : runsOn\n",
                "  return runsOn\n",
            )
        ],
    ),
    (
        "M13 · ⛔ **the choice read beside a provider of the agent's own** · a choice nothing reads "
        f"picks the menus — killed by `{HOST}`",
        [
            (
                CHOICE,
                "  return itsProvider === null && held !== null ? held.provider : runsOn\n",
                "  return held !== null ? held.provider : runsOn\n",
            )
        ],
    ),
    (
        "M14 · 🔴 **the list read for the resolved provider** · the label says Claude's model, the rows "
        f"are Codex's — killed by `{DOM}`",
        [
            (
                CONTROL,
                # ⚑ **W4.78 · re-anchored in place, not retired** — UI-012 (6d2d195d) took out whatTheCatalogueLets(…, menusFor, catalogue). The provider whose list is read is now the picker's `providers` prop. With runsOn, the face shows the Claude choice over Codex's rows. The named killer still asserts it: §3 expects sections ['claude'] and rows ['default','opus'].
                "            :providers=\"[menusFor]\"\n",
                "            :providers=\"[props.runsOn]\"\n",
            )
        ],
    ),
    (
        "M15 · ⚑ **the seed read for the resolved provider** · the menus open empty over the choice "
        f"they are for — killed by `{DOM}`",
        [
            (
                CONTROL,
                # ⚑ **W4.78 · re-anchored in place, not retired** — UI-012 (6d2d195d) removed seed(). What the draft starts on is now the `shown` computed, which ModelPicker seeds from. The named killer still asserts it: §3 expects drafted 'opus' and effort 'max'.
                "  held.value !== null && held.value.provider === menusFor.value ? held.value : null,\n",
                "  held.value !== null && held.value.provider === props.runsOn ? held.value : null,\n",
            )
        ],
    ),
    (
        "M16 · 🔴 **the sheet's note claims every launch** · *started as this identity* above a "
        f"choice that starts it on another provider — killed by `{HOST}`",
        [
            (
                WORDS,
                "    `The default for a new conversation as this identity is ${providerName(provider)}` +\n",
                "    `The next conversation started as this identity will run on ${providerName(provider)}` +\n",
            )
        ],
    ),
    # ── R31b · the provider press ───────────────────────────────────────────────────────────────
    (
        "M17 · 🔴 **the store drops what the door cleared** · a person's choice goes with no word "
        f"(R31b: *its answer says so*) — killed by `{HOST}`",
        [
            (
                STORE,
                "        return { ok: true, cleared: saved.modelChoiceCleared }\n",
                "        return { ok: true, cleared: null }\n",
            )
        ],
    ),
    (
        f"M18 · 🔴 **the sheet does not draw it** · the answer arrives and nothing says it — killed by `{DOM}`",
        [
            (
                SHEET,
                '          v-if="providerCleared"\n          class="identity-note"\n',
                '          v-if="false"\n          class="identity-note"\n',
            )
        ],
    ),
    (
        "M19 · ⚑ **the line outlives the next press** · a press that cleared nothing sits under a "
        f"sentence about the one before — killed by `{DOM}`",
        [(SHEET, "  providerCleared.value = null\n  const answer", "  const answer")],
    ),
    (
        "M20 · ⛔ **the wrong provider named** · *its provider is now Claude* after a move to Codex — "
        f"killed by `{HOST}`",
        [
            (
                CHOICE,
                "    `is always for its own provider, and its provider is now ${PROVIDER_NAME[nowOn]}.`\n",
                "    `is always for its own provider, and its provider is now ${PROVIDER_NAME[cleared.provider]}.`\n",
            )
        ],
    ),
    # ── `688` L1 · carry on, only while it can be done ──────────────────────────────────────────
    (
        "M21 · 🔴 **the conversation's state ignored** · *type your next message* over a conversation "
        f"that ended (`688` L1) — killed by `{GOAHEAD}`",
        [(PLAN, "  if (!canTakeAMessage) return open\n", "")],
    ),
    (
        "M22 · 🔴 **what came after ignored** · *type your next message* after the person typed it — "
        f"killed by `{GOAHEAD}`",
        [
            (
                PLAN,
                "    if (takenBack && !carriedOnLater) open.add(item.id)\n",
                "    if (takenBack) open.add(item.id)\n",
            )
        ],
    ),
    (
        "M23 · ⛔ **an agent's message counted as the person's** · a relayed turn takes the "
        f"instruction away while nobody has carried on — killed by `{DOM}`",
        [
            (
                PLAN,
                "  if (item.kind === 'user' || item.kind === 'continuation') return true\n",
                "  if (item.kind === 'user' || item.kind === 'continuation' || item.kind === 'relayed') return true\n",
            )
        ],
    ),
    (
        f"M24 · 🔴 **the person's message not counted** · the typed case, at the fold — killed by `{DOM}`",
        [
            (
                PLAN,
                "  if (item.kind === 'user' || item.kind === 'continuation') return true\n",
                "  if (item.kind === 'continuation') return true\n",
            )
        ],
    ),
    (
        "M25 · ⚑ **a go-ahead sent again not counted** · the earlier row still says *type your next "
        f"message* after the conversation carried on — killed by `{DOM}`",
        [
            (
                PLAN,
                "  if (item.kind === 'user' || item.kind === 'continuation') return true\n",
                "  if (item.kind === 'user') return true\n",
            )
        ],
    ),
    (
        "M26 · ⚑ **a held message of the person's not counted** · they have typed; it waits for the "
        f"turn — killed by `{DOM}`",
        [(PLAN, "  return (\n    item.kind === 'queued' &&\n", "  return (\n    false &&\n")],
    ),
    (
        "M27 · 🔴 **the row ignores the decision** · the whole sentence on every taken-back row, as "
        f"`688` shipped it — killed by `{GOAHEAD}`",
        [
            (
                HELD,
                "          {{ props.mayCarryOn === true ? THE_GO_AHEAD_TAKEN_BACK : THE_GO_AHEAD_WAS_NOT_SENT }}\n",
                "          {{ THE_GO_AHEAD_TAKEN_BACK }}\n",
            )
        ],
    ),
    (
        "M28 · 🔴 **the list does not pass it** · a live conversation's row loses the instruction a "
        f"person can follow — killed by `{GOAHEAD}`",
        [(LIST, '          :may-carry-on="mayCarryOn.has(row.item.id)"\n', "")],
    ),
    (
        "M29 · 🔴 **the pane never says it can take a message** · the same, one layer up — killed by "
        f"`{GOAHEAD}`",
        [(PANE, '          :can-take-a-message="canTakeAMessage"\n', "")],
    ),
    (
        "M30 · ⛔ **the pane forgets the conversation ENDED** · the instruction over a conversation "
        "that cannot take a message — "
        f"killed by `{GOAHEAD}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives, in a
        # new shape: 'type your next message to carry on' must not be drawn over a conversation that
        # cannot take a message. D-017b replaced the `composerState !== 'ended'` clause of
        # `canTakeAMessage` with `(props.record.meta?.cannotTakeAMessage ?? null) === null`, so the
        # plant drops that clause. The 'held by another window' control (`HELD_ELSEWHERE`) then
        # draws the instruction.
        [
            (CONVERSATIONPANE, "    (props.record.meta?.cannotTakeAMessage ?? null) === null &&\n    props.record.phase !== 'closing' &&\n", "    props.record.phase !== 'closing' &&\n"),
        ],
    ),
    # ── `696`'s review · the L1 conditions and the draft ────────────────────────────────────────
    (
        "M33 · ⛔ **a held relay counted as the person carrying on** · an agent's message waiting "
        f"takes the instruction away — killed by `{DOM}`",
        [(PLAN, "    item.relayed !== true &&\n", "")],
    ),
    (
        "M34 · ⛔ **a held report counted as the person carrying on** · a child's report waiting takes "
        f"the instruction away — killed by `{DOM}`",
        [(PLAN, "    item.report === undefined &&\n", "")],
    ),
    (
        "M35 · ⛔ **the app's held notice counted as the person carrying on** · BroBot's own words "
        f"take the instruction away — killed by `{DOM}`",
        [(PLAN, "    item.appNotice === undefined &&\n", "")],
    ),
    (
        "M36 · 🔴 **a message the person CANCELLED counted as carrying on** · nothing went, and no row "
        f"says what they can do (`696`'s review) — killed by `{DOM}`",
        [(PLAN, "    (item.outcome === null || item.goAhead === true)\n", "    true\n")],
    ),
    (
        "M37 · 🔴 **a conversation CLOSING read as one that can take a message** · *type your next "
        f"message* over one on its way out (`696`'s review) — killed by `{DOM}`",
        [
            (
                PANE,
                "    props.record.phase !== 'closing' &&\n    !signInSuperseded.value &&\n",
                "    !signInSuperseded.value &&\n",
            )
        ],
    ),
    (
        "M38 · 🔴 **the page off the end read as the whole conversation** · a message the person sent "
        f"after the row, in a released slab, unseen (`696`'s review) — killed by `{DOM}`",
        [
            (
                PANE,
                "    !signInSuperseded.value &&\n    props.record.window.atTail,\n",
                "    !signInSuperseded.value,\n",
            )
        ],
    ),
    (
        "M39 · ⚑ ***Change…* with nothing changed says what Save would leave** · a sentence for a "
        f"save that cannot happen, beside a row that says otherwise (`696`'s review) — killed by `{DOM}`",
        [
            (
                CONTROL,
                "    : sameChoice(draft.value, held.value)\n      ? heldReaches.value\n      : whatAModelChoiceReaches(",
                "    : whatAModelChoiceReaches(",
            )
        ],
    ),
    (
        "M40 · 🔴 **a superseded sign-in read as one that can take a message** · no message goes out "
        f"on it, frozen or not (`696`'s review, round two) — killed by `{DOM}`",
        [
            (
                PANE,
                "    !signInSuperseded.value &&\n    props.record.window.atTail,\n",
                "    props.record.window.atTail,\n",
            )
        ],
    ),
    (
        "M41 · 🔴 **every sheet promises a provider menu where it starts** · `StartAsAgent` has none "
        f"(`696`'s review, round two) — killed by `{DOM}`",
        [
            (
                SHEET,
                "providerTakesEffectNextTime(props.runsOn, identity.slug === DEFAULT_PROFILE_ID)",
                "providerTakesEffectNextTime(props.runsOn, true)",
            )
        ],
    ),
    (
        "M42 · ⚑ **BroBot's sheet forgets the front door's provider menu** · the note names a provider "
        f"the next conversation from the front door may not start on (`696`'s review) — killed by `{DOM}`",
        [
            (
                SHEET,
                "providerTakesEffectNextTime(props.runsOn, identity.slug === DEFAULT_PROFILE_ID)",
                "providerTakesEffectNextTime(props.runsOn, false)",
            )
        ],
    ),
    (
        "M43 · ⛔ **the note's clause ignores whether a door asks** · the promise drawn for every "
        f"identity, at the function — killed by `{HOST}`",
        [
            (
                WORDS,
                "    (aDoorAsks ? ', unless you choose another provider where you start it. ' : '. ') +\n",
                "    ', unless you choose another provider where you start it. ' +\n",
            )
        ],
    ),
    # ── `681` F-b ───────────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The Team card's 'Works in' line, with
        # 'no project yet' and its `v-else-if="member.use.isLaunching"` branch, was deleted whole by
        # D-016. The killer's own note reads 'D-016 - section 6 (681 F-b, the Team card's Works in
        # line saying starting rather than no project yet) went with the line itself: the Team page
        # names no project', and the commit removes 'the project rooms, board, sheet and picker'.
        # Its anchor is left stale, so the census records it retired.
        "M31 · 🔴 ***no project yet* for an agent starting in one** · `681` F-b, back — killed by "
        f"`{HOST}`",
        [(TEAM, '                v-else-if="member.use.isLaunching"\n', '                v-else-if="false"\n')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'first conversation' wording lived
        # in the same deleted 'Works in' paragraph of `TeamWorkspace.vue`; only the 'Recorded'
        # fact's `member.use.conversations` count survives, and it has no first/again wording to
        # flip. The dom test note says 'the Team page names no project', so the plant's
        # `member.use.conversations === 0` anchor has count 0. Its anchor is left stale, so the
        # census records it retired.
        "M32 · ⚑ ***first* for an agent that has run** · a restart called its first conversation — "
        f"killed by `{DOM}`",
        [
            (
                TEAM,
                "                  member.use.conversations === 0\n",
                "                  member.use.conversations >= 0\n",
            )
        ],
    ),
]
