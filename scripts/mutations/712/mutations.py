"""712 · What the seats handed over, drawn — `702` GAP-1/GAP-3, `697` H-a, R56, `707` GAP-1/GAP-5,
R55; `704` H-6 and `707` F-4 are comments, and R57 is a GAP for main.

⚑ **The PM's §2:** every fact below was already on the wire and nothing on screen said it. The Team
page names the project an agent's first conversation is starting in (`702` GAP-1); the stalled band
says what a giver was told and was not (R54's first half, `702` GAP-3); the two *absent* sentences say
they are true of the rows this app could read, and how many it could not (`697` H-a); the provider
control says, before its press, that the press will clear a person's model choice (R56); the work
card's heading names the task's project when the words under it do (`707` GAP-1); six surfaces name
an identity instead of printing its slug (R41, `707` GAP-5); and the rail's face for a row a crash
closed is short, with the ruled sentence whole on its hover and in the palette (R55).

## 🔴 What has to be killable

 * `M1`–`M3` 🔴 **`702` GAP-1**: the launch's project never drawn; the recorded list drawn in its
   place; *not read yet* said beside a project it did read.
 * `M4`–`M5` 🔴 **R54**: the told arm never taken; the ruled words cut.
 * `M6`–`M10` 🔴 **`697` H-a**: a count of none said as a count; either viewer's qualified sentence
   never drawn; either viewer qualifying a reason that is not an absence.
 * `M11`–`M15`, `M34`–`M35` 🔴 **R56**: the warning never drawn; the choice never told to the row; one
   agent's choice warned about on another's sheet; the provider that keeps it, and *Nobody has said*,
   left out of the words; the door's own answer never taking the warning; a choice made in the
   control below never told to the row.
 * `M16` 🔴 **`707` GAP-1**: the heading ignores `elsewhere`.
 * `M17`–`M28` 🔴 **R41**: each of the six sites back to the slug — the notice's facts dropped, or
   drawn without the roster, or the sentence's subject left a slug; the ask line; the proposal strip,
   and the transcript not handing it the roster; the queue's speaker, and the screen not naming it;
   the store's remove and create sentences; the sheet's name.
 * `M29`–`M33` 🔴 **R55**: the face never set; the rail drawing the whole note; the palette drawing
   the face; the ruled face words changed; the face back behind the provider, where `712` measured
   the ruled words themselves cut.

## ⛔ What this table cannot reach

 * ⚠️ **`RuntimeScreen`'s glue is read, not mounted** (`211` §11): `M26` is killed by a census over
   its source.
 * ⚠️ **R56's *while a press is in flight* half of the `v-if`** is not observable at a settled
   mount, so it has no row. ⚑ The door's own answer taking the warning (`M34`) IS observable — the
   killer holds the child's re-read back — and `712`'s first version of this table said otherwise.
 * ⚠️ **R57** is not built — a GAP for main, and the response says why.
 * ⚠️ **The photographs** are evidence, not assertions.

## ⚑ WRITTEN, not run as a table

⛔ **Writing rows is routine, RUNNING a table is rare and deliberate.** Each row was verified RED
alone with `scripts/mutations/verify_row.py` — one row, its killer file, restored from bytes — in an
isolated worktree, and no `mutations.txt` exists.
"""

from __future__ import annotations

LIB = "apps/desktop/src/renderer/src/lib"
COMPONENTS = "apps/desktop/src/renderer/src/components"
PERSONS_QUEUE = "apps/desktop/src/renderer/src/lib/persons-queue.ts"
RUNTIMESCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"

TEAM = f"{COMPONENTS}/TeamWorkspace.vue"
QUEUE = f"{LIB}/persons-queue.ts"
UNREAD = f"{LIB}/rows-unread.ts"
OUTPUT = f"{COMPONENTS}/WorkflowOutputViewer.vue"
CHILD = f"{COMPONENTS}/ChildWorkViewer.vue"
CHOICE = f"{LIB}/agent-model-choice.ts"
SHEET = f"{COMPONENTS}/CapabilitiesSheet.vue"
MODEL = f"{COMPONENTS}/AgentModelChoice.vue"
WORDS = f"{LIB}/work-report.ts"
FOLD = f"{LIB}/transcript.ts"
NOTICE = f"{COMPONENTS}/NoticeEntry.vue"
ASKED = f"{LIB}/instruction-asked.ts"
OWN = f"{COMPONENTS}/OwnInstructions.vue"
CARD = f"{COMPONENTS}/ProposalCard.vue"
VIEW = f"{COMPONENTS}/TranscriptView.vue"
ATTENTION = f"{LIB}/attention.ts"
SCREEN = f"{COMPONENTS}/RuntimeScreen.vue"
STORE = f"{LIB}/agent-store.ts"
THREADS = f"{LIB}/closed-threads.ts"
RAIL = f"{COMPONENTS}/SideRail.vue"

NODE = "what-the-seats-handed-over-drawn.render.test.ts"
DRAWN = "what-the-seats-handed-over-drawn.dom.test.ts"
NAMED = "an-identity-named-and-a-clear-said-first.dom.test.ts"

MUTATIONS = [
    # ── `702` GAP-1 · the Team page names the launch's project ──────────────────────────────────
    (
        # Per-project launch tags and projectsOfItsLaunches no longer exist. The starting card only
        # says Starting now; retain the absent anchor as retired.
        "M1 · 🔴 **the launch's project never drawn** · *not read yet* for an agent whose launch names "
        f"its project — `702` GAP-1 undone — killed by `{DRAWN}`",
        [
            (
                TEAM,
                '                ><template v-if="member.use.projectsOfItsLaunches.length > 0"\n',
                '                ><template v-if="false"\n',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `member.use.projects` and
        # `projectsOfItsLaunches` lists were removed from `IdentityUse` (agent-roster.ts diff) and
        # from the Team card template; there is no recorded-projects list left to draw. Projects
        # were removed as something a person meets (commit message, D-016a item 1). Its anchor is
        # left stale, so the census records it retired.
        "M2 · ⛔ **the recorded list drawn in the launch's place** · the one list this branch exists "
        f"because it is empty — killed by `{DRAWN}`",
        [
            (
                TEAM,
                '                    v-for="place in member.use.projectsOfItsLaunches"\n',
                '                    v-for="place in member.use.projects"\n',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `<template v-else>not read yet
        # —</template>` beside the project list is gone from TeamWorkspace.vue, along with the
        # project list it sat next to. The card's 'Not read yet' is now a `doingSays` arm
        # (`not-read`), a different fact that has its own rows; the row's defect was about the
        # project. Its anchor is left stale, so the census records it retired.
        "M3 · ⚑ **_not read yet_ said beside the project it read** · the words for *no project named* "
        f"stand in front of the one it named — killed by `{DRAWN}`",
        [
            (
                TEAM,
                "                  —</template\n                ><template v-else>not read yet —</template>\n",
                "                  —</template\n                >not read yet —\n",
            )
        ],
    ),
    # ── R54 · the band says what the giver was told ─────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row protects stalledWorkLead taking the arm for a giver told the work is still open
        # (`work.toldItWasStillOpen === true`). The commit deleted it: "Gone with it: the kept-open
        # receipt and notices, ... the two R54 leads on the stalled-work band", and
        # leadForAGiverToldItWasStillOpen is gone from persons-queue.ts. The lead is now one
        # sentence, true of every row, because a giver is told about a piece once. Its anchor is
        # left stale, so the census records it retired.
        "M4 · 🔴 **the told arm never taken** · *has not been told* about a giver that was told the "
        f"work is still open — `702` F-5 back — killed by `{NODE}`",
        [
            (
                QUEUE,
                "  if (work.toldItWasStillOpen === true) return leadForAGiverToldItWasStillOpen(work)\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row protects the ruled words TOLD_IT_WAS_STILL_OPEN ('told a message would start it;
        # not told nothing can start it now') not being cut to their first half. The constant was
        # deleted with the lead it fed ("the two R54 leads on the stalled-work band"), and the
        # killer's cases for the started-again lead drawn and in the DOM went with their subject.
        # The anchor has zero matches in persons-queue.ts. Its anchor is left stale, so the census
        # records it retired.
        "M5 · ⚠️ **the ruled words cut to their first half** · the lead says what it was told and not "
        f"what it was not (R54) — killed by `{NODE}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — R54 (say what it was told
        # AND what it was not) still applies; only the wording changed for D-017's world —
        # `TOLD_IT_WAS_STILL_OPEN` is now `'told a message would start it; not told nothing can
        # start it now'` (split across two lines). Cutting it to the first clause is the same defect
        # M5 protected, still directly asserted byte-for-byte by the killer test.
        [
            (PERSONS_QUEUE, "export const TOLD_IT_WAS_STILL_OPEN =\n  'told a message would start it; not told nothing can start it now'\n", "export const TOLD_IT_WAS_STILL_OPEN =\n  'told a message would start it'\n"),
        ],
    ),
    # ── `697` H-a · the absence is true of the rows this app could read ─────────────────────────
    (
        "M6 · ⛔ **a count of none said as a count** · *0 rows … could not be read* on every answer the "
        f"host gives, since `0` is a measurement — killed by `{NODE}`",
        [
            (
                UNREAD,
                "  if (count === undefined || !(count > 0)) return null\n",
                "  if (count === undefined) return null\n",
            )
        ],
    ),
    (
        "M7 · 🔴 **the output viewer's qualified sentence never drawn** · *did not report an output "
        f"file* over rows it could not read — killed by `{DRAWN}`",
        [(OUTPUT, "  if (unread !== null) return `${NO_OUTPUT} ${unread}.`\n", "")],
    ),
    (
        "M8 · ⚑ **the output viewer qualifies a file it FOUND** · *gone* is not an absence the torn "
        f"rows could explain — killed by `{DRAWN}`",
        [
            (
                OUTPUT,
                "    props.result.reason === 'no-output' ? absenceUnreadSays(props.result.rowsUnread) : null\n",
                "    absenceUnreadSays(props.result.rowsUnread)\n",
            )
        ],
    ),
    (
        "M9 · 🔴 **the child viewer's qualified sentence never drawn** · *no record of that agent* over "
        f"rows it could not read — killed by `{DRAWN}`",
        [
            (
                CHILD,
                "  if (unread !== null)\n    return `${NO_RECORD} ${unread}. There is nothing to open. ${FOUND_FROM_THE_RUN}`\n",
                "",
            )
        ],
    ),
    (
        "M10 · ⚑ **the child viewer qualifies a reason that is not an absence** — killed by "
        f"`{DRAWN}`",
        [
            (
                CHILD,
                "    props.result.reason === 'unknown-agent' ? absenceUnreadSays(props.result.rowsUnread) : null\n",
                "    absenceUnreadSays(props.result.rowsUnread)\n",
            )
        ],
    ),
    # ── R56 · say it before the press ──────────────────────────────────────────────────────────
    (
        "M11 · 🔴 **the warning never drawn** · the press clears a person's choice and says so only "
        f"afterwards (`696` L2) — killed by `{NAMED}`",
        [
            (
                SHEET,
                '          v-if="providerWillClear && !choosingProvider"\n',
                '          v-if="false"\n',
            )
        ],
    ),
    (
        "M12 · ⛔ **the choice never told to the row** · the control holds it and the row above it "
        f"cannot warn — killed by `{NAMED}`",
        [
            (
                MODEL,
                "    readOnce.value = true\n    emit('held', answer.held)\n",
                "    readOnce.value = true\n",
            )
        ],
    ),
    (
        "M13 · ⚠️ **one agent's choice warned about on another's sheet** · the held choice outlives the "
        f"identity it was read for — killed by `{NAMED}`",
        [(SHEET, "  () => (heldChoice.value = undefined),\n", "  () => undefined,\n")],
    ),
    (
        "M14 · ⚑ **the words stop naming the provider that keeps it** · *another provider* is a "
        f"prediction a person cannot check against the menu — killed by `{NODE}`",
        [
            (
                CHOICE,
                "    `Moving it to a provider other than ${PROVIDER_NAME[held.provider]} clears the model and ` +\n",
                "    'Moving it to another provider clears the model and ' +\n",
            )
        ],
    ),
    (
        "M15 · ⚑ **the one option that keeps it left out** · the door keeps a choice on *Nobody has "
        f"said*, and the warning would read as *any press clears it* — killed by `{NODE}`",
        # ⚑ **an agent keeps its provider · re-anchored in place, not retired** — the empty choice is now named "no provider saved", as the select's option changed.
        [(CHOICE, "    'Leaving no provider saved keeps it.'\n", "    ''\n")],
    ),
    # ── `707` GAP-1 · the card's heading ───────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `elsewhere` and `taskCalledIn` were
        # deleted, so `work-report.ts` now builds the heading as `taskCalled(report.number)` only.
        # Commit message: 'a task reads "Task #N"'; card: 'Task #N in <project>' is what D-016a
        # deliberately removed. Its anchor is left stale, so the census records it retired.
        "M16 · 🔴 **the heading ignores `elsewhere`** · *Task #1* over words saying *Task #1 in beta* "
        f"(`707` GAP-1 back) — killed by `{NODE}`",
        [(WORDS, "      report.elsewhere === undefined\n", "      true\n")],
    ),
    # ── R41 · every identity a person reads is named ───────────────────────────────────────────
    (
        "M17 · 🔴 **the notice's facts dropped by the fold** · the ask is drawn from the roster-less "
        f"sentence, two slugs — killed by `{NAMED}`",
        [(FOLD, "        instructionAsked: asked,\n", "")],
    ),
    (
        "M18 · ⛔ **the notice drawn without the roster** · the facts are on the item and the row "
        f"never asks them — killed by `{NAMED}`",
        [(NOTICE, "  props.item.instructionAsked === undefined\n", "  true\n")],
    ),
    (
        "M19 · ⚑ **the ask's subject left a slug** · the proposer named, the identity the rules are "
        f"ABOUT printed as its slug — killed by `{NAMED}`",
        [(ASKED, "    asked.about,\n  )} — ", "    asked.about,\n  ) && asked.about} — ")],
    ),
    (
        f"M20 · 🔴 **the rules editor's ask line prints the slug** — killed by `{NAMED}`",
        [
            (
                OWN,
                "            <strong>{{ named(one.asked.proposedBy) }}</strong> asked to set these rules ·\n",
                "            <strong>{{ one.asked.proposedBy }}</strong> asked to set these rules ·\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `ProposalCard.vue` is deleted (-1).
        # Commit message: 'Proposals go end to end'; the killer's proposal-strip test went with it,
        # and the current an-identity-named DOM test has no proposal section. Its anchor is left
        # stale, so the census records it retired.
        f"M21 · 🔴 **the proposal strip prints the slug** — killed by `{NAMED}`",
        [
            (
                CARD,
                '      <span class="who" data-cy="proposal-by">{{ proposedByName }} proposed this</span>\n',
                '      <span class="who" data-cy="proposal-by">{{ proposal.proposedBy }} proposed this</span>\n',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `<ProposalCard :identities=...>`
        # call in TranscriptView.vue is gone (no `proposal` remains in the file), so the plant's
        # anchor cannot exist. Proposals went 'end to end' per the commit message; the other
        # `:identities` props on that file belong to different cards and different rows. Its anchor
        # is left stale, so the census records it retired.
        "M22 · ⛔ **the transcript never hands the card its roster** · the card can name, and is "
        f"never given the names — killed by `{NAMED}`",
        [
            (
                VIEW,
                '          :sent="props.draftFor?.(row.item.proposal.proposalId)?.sent"\n'
                '          :identities="props.identities ?? null"\n',
                '          :sent="props.draftFor?.(row.item.proposal.proposalId)?.sent"\n',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `proposalScopeLines` and the
        # `${nameOf(proposal.proposedBy)} says: ...` line were deleted with proposals ('Proposals go
        # end to end'). The surviving speaker, `AttentionRequest.who =
        # nameOf(record.meta.profileId)`, is already planted by 714 M1 and M3 (killed by
        # a-command-in-the-box) and 714 M2 (DOM). Its anchor is left stale, so the census records it
        # retired.
        "M23 · 🔴 **the queue's speaker prints the slug** · *project-manager says: …* beside a card "
        f"naming it — killed by `{NODE}`",
        [
            (
                ATTENTION,
                "  lines.push(`${nameOf(proposal.proposedBy)} says: ${proposal.why}`)\n",
                "  lines.push(`${proposal.proposedBy} says: ${proposal.why}`)\n",
            )
        ],
    ),
    (
        f"M24 · 🔴 **the store's remove sentences print the slug** — killed by `{NODE}`",
        [
            (
                STORE,
                "      const called = agentName(profileId, identities.value?.identities ?? null)\n",
                "      const called = profileId\n",
            )
        ],
    ),
    (
        "M25 · ⚑ **the store's create sentence prints the slug** · over the name main just gave it — a "
        f"blank box is a pool name, not a nameless agent (`712`'s review) — killed by `{NODE}`",
        [
            (
                STORE,
                "          return `${agentName(created.slug, [created])} was created, but",
                "          return `${said.slug} was created, but",
            )
        ],
    ),
    (
        "M26 · ⛔ **the screen never names the queue's speaker** · the door takes a name function and "
        f"the one caller hands none (census over `RuntimeScreen`) — killed by `{NODE}`",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives:
        # RuntimeScreen must hand `attentionQueue` the roster-aware `agentHeadingFor` as its third
        # argument, so `AttentionRequest.who` is a name and not the slug. Only the comment above it
        # changed (now '714 · R41 ... (`AttentionRequest.who`)'), so the anchor moved; the row's
        # label still says 'a proposal's speaker', but the rule it protects is the same call. The §7
        # census in the render test still exists and passes today.
        [
            (RUNTIMESCREEN, "    // ⚑ **714 · R41** — the identity each waiting row's conversation runs as\n    // (`AttentionRequest.who`), named over the roster.\n    agentHeadingFor,\n", ''),
        ],
    ),
    (
        "M27 · 🔴 **the sheet's name is the slug** · title, owner, direction and offer all print it — "
        f"killed by `{NAMED}`",
        [
            (
                SHEET,
                "  agentName(props.profileSlug, store.identities.value?.identities ?? null),\n",
                "  props.profileSlug,\n",
            )
        ],
    ),
    (
        "M28 · ⚑ **the title back to its inline copy of the rule** · `displayName ?? slug`, which parts "
        f"from `agentName` on BroBot's slug with no display name — killed by `{NAMED}`",
        [
            (
                SHEET,
                '        <strong data-cy="capabilities-title">{{ called }}</strong>\n',
                '        <strong data-cy="capabilities-title">{{ identity?.displayName ?? profileSlug }}</strong>\n',
            )
        ],
    ),
    # ── R55 · the rail's face is short; the hover is whole ─────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `closed-threads.ts` and its `face:`
        # line were removed with the closed-conversations list (no `closed-threads` reference is
        # left in `apps/desktop/src`). The commit message says "One Conversations list in the rail
        # and the palette, each row with the shared state: no open / closed / kept-open split". The
        # face and note the row protected are no longer drawn. Its anchor is left stale, so the
        # census records it retired.
        "M29 · 🔴 **the face never set** · the rail cuts the ruled sentence after *closed because Br…* "
        f"(`701` F-7 back) — killed by `{NODE}`",
        [(THREADS, "      face: CLOSED_BY_AN_UNFINISHED_QUIT_FACE,\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `SideRail.vue` no longer has
        # `v-if="row.face"` (grep count 0), because rows carry the shared `state` and there is no
        # per-row quit face. The commit message says "no open / closed / kept-open split" and "No
        # sentence says whether a process runs". The template the row planted on was removed on
        # purpose. Its anchor is left stale, so the census records it retired.
        "M30 · ⛔ **the rail draws the whole note** · the face is set and the rail never asks it — "
        f"killed by `{DRAWN}`",
        [
            (
                RAIL,
                '                <template v-if="row.face">{{ row.face }} · {{ row.provider }}</template\n',
                '                <template v-if="false">{{ row.face }} · {{ row.provider }}</template\n',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The face/provider ordering in
        # `SideRail.vue` went with the `row.face` template, which is gone (grep count 0 for
        # `v-if="row.face"`). Rows now carry `state` and `inAnotherWindow` from
        # `conversation-list.ts`, and no per-row face is drawn. The commit message says "no open /
        # closed / kept-open split". Its anchor is left stale, so the census records it retired.
        "M33 · ⚠️ **the face back behind the provider** · the order `712` measured: *claude · closed · "
        f"quit didn’t…* at 208 px, the ruled words themselves cut — killed by `{DRAWN}`",
        [
            (
                RAIL,
                '                <template v-if="row.face">{{ row.face }} · {{ row.provider }}</template\n',
                '                <template v-if="row.face">{{ row.provider }} · {{ row.face }}</template\n',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The `note:` line lived in
        # `closed-threads.ts`, which no longer exists. The unfinished-quit note is a sentence about
        # whether a process ran, and the commit says "No sentence says whether a process runs". Its
        # removal is the decision, not a defect. Its anchor is left stale, so the census records it
        # retired.
        "M31 · ⚠️ **the palette draws the face** · a wider place with NO hover loses the ruled "
        f"sentence (R55: *every wider place keeps it*) — killed by `{NODE}`",
        [(THREADS, "      note: CLOSED_BY_AN_UNFINISHED_QUIT,\n", "      note: CLOSED_BY_AN_UNFINISHED_QUIT_FACE,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `CLOSED_BY_AN_UNFINISHED_QUIT_FACE`
        # was defined in `closed-threads.ts`, which is deleted (no reference remains in
        # `apps/desktop/src`). The commit message says "no open / closed / kept-open split ... No
        # sentence says whether a process runs". The face text is removed on purpose. Its anchor is
        # left stale, so the census records it retired.
        f"M32 · ⚑ **the ruled face words changed** — killed by `{NODE}`",
        [
            (
                THREADS,
                "export const CLOSED_BY_AN_UNFINISHED_QUIT_FACE = 'closed · quit didn’t finish'\n",
                "export const CLOSED_BY_AN_UNFINISHED_QUIT_FACE = 'closed after a crash'\n",
            )
        ],
    ),
    (
        "M34 · 🔴 **the door's own answer never takes the warning** · with the child's re-read held "
        "back, the row still warns about a choice the door says it has just cleared — found by "
        f"`712`'s review — killed by `{NAMED}`",
        [(SHEET, "    heldChoice.value = null\n", "")],
    ),
    (
        "M35 · ⚑ **a choice made in the control below never told to the row** · a person saves one, "
        f"and the row above warns about nothing — killed by `{NAMED}`",
        [
            (
                MODEL,
                # ⚑ **W4.78 · re-anchored in place, not retired** — UI-012 (6d2d195d) split send() into save() and clear(). The row is about a SAVE ('a person saves one'), so the anchor is save()'s emit, not clear()'s, which is what the auto-guess picked. The named killer still asserts it: 'the control's OWN Save and Clear move the line' expects WILL_CLEAR_OPUS_HIGH right after Take.
                "  refusal.value = null\n  emit('held', answer.held)\n  return null\n",
                "  refusal.value = null\n  return null\n",
            )
        ],
    ),
]
