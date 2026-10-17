"""593 · the avatar is the status carrier.

⛔ **`EXT-012` §2, and the person's own words are the direction:**

> ⚑ ***"Seeing the icon of BroBot thinking when it's active in a conversation goes a long way — more
> than these explanations we have."*** — and, of the page as it stood, ⛔ ***"it looks like shit."***

## ⚑ Six claims, and a table that pushed on one would pass a repair that traded another

 1. **The FOLD reaches a row** (M1–M7). ⛔ `575` built `byIdentity` for this page and named it
    *"A Team page's question: what is this identity doing, anywhere?"* — and it reached no surface
    for three weeks. Every row here is a way for the read to arrive and say nothing.
 2. **The ARMS** (M8–M13). 🔴 Seven states, and the two that cost a drop each are here: a quiet
    agent that loses its face (M8), and the dotted `unstarted` underline that made the page read as
    broken (M9). ⚠️ **Both were found by the person at the running app, not by a test.**
 3. **The WORDS** (M14–M16). ⛔ `558` wrote `HOLDING_SAYS` for this surface and this surface drew
    the reason keys; `593` wrote `ROLE_SAYS` and three surfaces read it.
 4. **The NARROWING** (M17–M19). ⚑ `theirConversations` wraps `projectRoster` rather than folding
    the walk again, and narrows AFTER — because a `LedgerWalk`'s counts are computed from the QUERY.
 5. **The WIRE** (M20–M21). 🔴 `BeingDoneTracker` kept the last `status` privately for its own turn
    boundary; a third caller needed it and `sessionDoing` will not let an activity say anything
    without one.
 6. **The PAINT** (M22–M27). ⚠️ Every row is a declaration that changes what a person's eye lands
    on first, or a sentence that says one fact twice.

## 🔴 The one a reader should look at first

⛔ **M3 restores the faceless ring on a live conversation every other surface is calling `idle`.**
⚑ It is one argument long, it typechecks, and it is exactly what shipped in the first drop —
`SessionMachine.sync` publishes a status only when the derived one CHANGES, so a conversation that
was already quiet when this app registered it publishes none at all, and a caller reading `null`
draws no face however much the provider published.

## ⛔ What this table does NOT cover, said out loud

 1. **`575`'s read itself** — `scripts/mutations/575` owns the tracker's event table, the turn
    boundary and the phase vocabulary. ⚑ **M20–M21 are here anyway**, because `593` changed what
    that class REPORTS and the rule it reports under.
 2. **`projectRoster`'s own rules** — `scripts/mutations/472` and `504` own `hereIs`, the four
    gestures and the reopen refusal. ⚑ `593` narrows that fold; it changed none of it.
 3. **`AgentState` and `agent-state.ts`** — `082`, `089`, `250` and `258` own the plate, the nine
    standings and `activityLine`. ⛔ This table asserts only which of their answers reaches a card.
 4. **The disclosure's own read cadence.** ⚠️ `showConversations` reads on press and keeps the
    answer; a row that made it re-read on every open changes no drawn fact and would report as a
    survivor (`a-true-mutation-measures-nothing`).

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| M1–M13, M15 | `apps/desktop/test/the-avatar-is-the-status.test.ts` §§1–3 · the fold and the arms |
| M14 | ⚠️ **`…the-avatar-is-the-status.dom.test.ts` §5** — *the refusal is in English, and neither reason key reaches the card*. ⛔ **It was verified against the UNIT suite first and SURVIVED**, and the mapping was the defect rather than the row: `heldSays` is a fold field whose whole claim is what a person READS, so the assertion that can fail is a drawn one |
| M16 | `…the-avatar-is-the-status.test.ts` §5 · the role vocabulary, and its census over `components/*.vue` |
| M17–M19 | `…the-avatar-is-the-status.test.ts` §4 · the narrowing, the counts and the four owners of the empty sentence |
| M20–M21 | `…the-avatar-is-the-status.test.ts` §6 and `what-each-agent-is-doing.test.ts` · the tracker |
| M22–M27 | `…the-avatar-is-the-status.dom.test.ts` §§1–4 · the paint |

⛔ **Evidence, and it is the method rather than a claim.** Every row was applied ALONE, its killer
file run, and the tree restored from the bytes kept before the edit and hashed — `verify-each-mutation-row-without-running-the-table`. ⚠️ **The whole table has NOT been run under
the driver**, so `CENSUS.md` records it `unrun` and no verdict is claimed here. ⚑ **27 of 27 are RED,
and each was checked for the RIGHT reason**: the runner's output was searched for `SyntaxError`,
`Transform failed` and `error TS`, because a row red on a parse error measured nothing (`452 M8`).
"""

TEAM = "apps/desktop/src/renderer/src/lib/team-roster.ts"
CAPS = "apps/desktop/src/shared/capabilities.ts"
TRACK = "apps/desktop/src/main/runtime/being-done.ts"
CARD = "apps/desktop/src/renderer/src/components/TeamWorkspace.vue"

MUTATIONS = [
    (
        "M1 · ⛔ the reading is never consulted · `575`'s door is wired the whole way and the fold drops it, so every card is back to `1 conversation recorded` — ⚠️ and the page still says *what each agent is doing* in its own age line",
        [
            (
                TEAM,
                '  const atWork = beingDone === null ? null : byIdentity(beingDone)\n',
                '  const atWork = null\n',
            )
        ],
    ),
    (
        "M2 · 🔴 the map is keyed by the identity's ROW ID · `aid:ada` is not `ada`, so every lookup misses and a machine running four conversations draws four quiet cards. ⛔ {@link ConversationAtWork.identity}'s own docblock is the rule — *the slug resolved once at launch, which is the same value `ProjectConversation.identity` carries*",
        [
            (
                TEAM,
                '      const running = atWork?.get(identity.slug) ?? []\n',
                '      const running = atWork?.get(identity.id) ?? []\n',
            )
        ],
    ),
    (
        'M3 · 🔴 the status is withheld again · **this is the defect the person found at the running app**: `sessionDoing` lets an activity REFINE a status and never PROMOTE one (`099`), so a caller passing `null` draws the faceless ring at a live conversation the rail is calling `idle`',
        [
            (
                TEAM,
                '  const plate = whatAPlateCanDraw(one, one.status)\n',
                '  const plate = whatAPlateCanDraw(one, null)\n',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The `started` input is gone: D-017b
        # removed `started`/`ended` from `SessionFacetInput` and from `team-roster.ts`'s `toldOf`,
        # and removed the `unstarted` standing and being. Commit: 'No sentence says whether a
        # process runs'. Its anchor is left stale, so the census records it retired.
        'M4 · ⛔ a running conversation is drawn as one that never started · `sessionBeing` answers `unstarted` for `started: false` and `sessionDoing` answers `unknown`, so the plate goes faceless for every agent the app is actually running',
        [
            (
                TEAM,
                '  return {\n    started: true,\n    phase: null,\n    status: plate.status,\n',
                '  return {\n    started: false,\n    phase: null,\n    status: plate.status,\n',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `ended` is no longer a facet input
        # (`isOver` became `nothingDoingHere`, and the `ended` standing/being were dropped from the
        # tables), so `team-roster.ts` has no `ended: false` line to flip. Same D-017b 'No sentence
        # says whether a process runs'. Its anchor is left stale, so the census records it retired.
        'M5 · ⛔ a running conversation is drawn as terminal · `isOver` is the predicate both facets ask, so the face falls to `idle` and the underline to `ended` on a conversation the host is running. ⛑ `ended: false` is DERIVED and not assumed — `whatIsBeingDone` returns only slots that are neither absent nor closing',
        [
            (
                TEAM,
                '    ended: false,\n    activity: plate.activity,\n',
                '    ended: true,\n    activity: plate.activity,\n',
            )
        ],
    ),
    (
        "M6 · ⚠️ `streaming` is dropped on the way in · `089`'s ordering is the whole reason that field is on the row rather than folded into `told`: after a tool returns, the activity still says `tool` while the model is already replying",
        [
            (
                TEAM,
                '    streaming: plate.streaming,\n',
                '    streaming: false,\n',
            )
        ],
    ),
    (
        "M7 · ⛔ the age is measured from NOW rather than from the reading · the row's own stamp against a second clock, which is the defect {@link WhatIsBeingDone.readAt} exists to remove — one page would show two ages taken at two instants",
        [
            (
                TEAM,
                '    since: agoWords(one.since, readAt),\n',
                '    since: agoWords(one.since),\n',
            )
        ],
    ),
    (
        'M8 · 🔴 a quiet agent loses its face · **the person, at the running app:** *"I do not see the current state of the bot in the avatar"*. ⛔ With the reading COMPLETE, *this app is running nothing as this identity* is a sound inference and `idle` is `042`\'s own word for it',
        [
            (
                TEAM,
                "  return { doing: doing.it === 'not-right-now' ? 'idle' : 'unknown' }\n",
                "  return { doing: 'unknown' }\n",
            )
        ],
    ),
    (
        "M9 · 🔴 the plate claims a SESSION the identity has not got · **the dotted line the person reported**: `sessionFacets({started: false})` answers `being: 'unstarted'`, which paints a dotted faint underline under a dashed ring — two marks for one nothing, and `unstarted` is a claim about a session rather than about an identity",
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — UI-008 (c37e0fd1) rewrote `plateFor`, but the-avatar-is-the-status.test.ts still
        # pins the rule: an identity with no running conversation draws the idle face and no arm
        # draws an underline (`member.facets.being` must be undefined). The old plant passed
        # `started: false`, which `sessionFacets` has ignored since D-017b, so the new plant writes
        # the dotted `unstarted` underline under the faceless ring directly. It goes red on the
        # quiet arm's `toEqual({ doing: 'idle' })` and on the no-underline sweep. Killed by
        # `the-avatar-is-the-status.test.ts`.
        [
            (TEAM, '  if (one !== null) return sessionFacets(toldOf(one, stateOf.get(one.conversation)))\n', "  if (one !== null) return sessionFacets(toldOf(one, stateOf.get(one.conversation)))\n  if (running.length === 0) return { doing: 'unknown', being: 'unstarted' }\n"),
        ],
    ),
    (
        'M10 · ⛔ `Unknown` where the app knows the agent is in a conversation · the reading says the host is running it and only the PHASE is unknown; `STANDING_LABEL.unknown` tells a person the smaller half of a fact this read holds',
        [
            (
                TEAM,
                "    return standing === 'unknown'\n      ? { it: 'in-a-conversation' }\n      : { it: 'one-conversation', standing }\n",
                "    return { it: 'one-conversation', standing }\n",
            )
        ],
    ),
    (
        'M11 · ⚠️ a launch in flight reads as *Never run* · `isLaunching` is the one state neither count can see — between `createSession` and `onRegistered` the rows do not exist yet, so `conversations` is still zero while a person watches it start',
        [
            (
                TEAM,
                "  if (use.isLaunching) return { it: 'starting' }\n  if (use.conversations === 0) return { it: 'never-run' }\n",
                "  if (use.conversations === 0) return { it: 'never-run' }\n  if (use.isLaunching) return { it: 'starting' }\n",
            )
        ],
    ),
    (
        "M12 · ⛔ *not in a conversation right now* is claimed before anything has been read · `086`'s two facts collapsed into one: *not asked* drawn as *asked and empty*, on the first frame of every visit",
        [
            (
                TEAM,
                "  return wasRead ? { it: 'not-right-now' } : { it: 'not-read' }\n",
                "  return { it: 'not-right-now' }\n",
            )
        ],
    ),
    (
        'M13 · ⚠️ the chip claims a running machine for an agent doing nothing · `STANDING_TONE` leaves four standings blank on purpose, and its own note is the argument: painting them *would claim a running machine for a conversation whose composer is free*',
        [
            (
                TEAM,
                "  return what.it === 'one-conversation' ? STANDING_TONE[what.standing] : ''\n",
                "  return what.it === 'one-conversation' ? STANDING_TONE[what.standing] : 'live'\n",
            )
        ],
    ),
    (
        'M14 · ⛔ the removal reasons go back to reason codes · `EXT-012` §1.2: *"four internal reason codes shown to a person as a comma list. `a-project` and `a-launch` are not English."* ⛑ `558` wrote the table and `agent-store.ts` already read it for the refusal a person gets AFTER the press',
        [
            (
                TEAM,
                '        heldSays: heldBy.map((why) => HOLDING_SAYS[why]),\n',
                '        heldSays: heldBy,\n',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** Roles were removed on purpose. The
        # D-014 diff to team-roster.ts deletes `roleSays` and the `ROLE_SAYS` import, and
        # `AgentIdentity.role` is gone (commit: "roles … are gone"; card: "no role anywhere"). There
        # is no role for the Team card to draw. Its anchor is left stale, so the census records it
        # retired.
        'M15 · ⛔ the role goes back to the stored key · `EXT-012` §2.1 asked for the role *in words* — *Ada · project manager* — and `project-manager` is what the column holds, not English',
        [
            (
                TEAM,
                '        roleSays: identity.role === null ? null : ROLE_SAYS[identity.role],\n',
                '        roleSays: identity.role,\n',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** `ROLE_SAYS` (role key to words) was
        # deleted from capabilities.ts with the rest of the role vocabulary. Commit: "roles, the
        # seeded grants, role templates … are gone"; card: "no roles". Its anchor is left stale, so
        # the census records it retired.
        "M16 · ⚠️ a role's WORD is its KEY · a label map whose entries equal their keys is a map that is not a map, and the three surfaces reading it would each be drawing the column again",
        [
            (
                CAPS,
                "  'project-manager': 'project manager',\n",
                "  'project-manager': 'project-manager',\n",
            )
        ],
    ),
    (
        "M17 · 🔴 every agent's conversations under every agent · the walk is the WHOLE project, so without the narrowing Ada's card lists Ali's conversations and the card's own count disagrees with its own list",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: a
        # card's shelf narrows to its own agent's conversations. D-016 replaced the `projectRoster`
        # walk with the rail's one list, so the narrowing is now `listed.filter((row) =>
        # row.identity === identity)` in `theirConversations`. The re-anchor drops that filter, so
        # Ada's shelf lists Ali's conversations.
        [
            (TEAM, '  return listed\n    .filter((row) => row.identity === identity)\n    .map((row) => {\n', '  return listed\n    .map((row) => {\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** Its subject was `emptySentence`
        # deferring to the project walk's own sentence (`view.empty`, `view.says`, 'no such
        # project', 'no ledger'). D-016 deleted `project-roster.ts` and the per-project walk, and
        # `theirConversations` now takes the one list and returns `null` (not read) or the narrowed
        # rows. The current `[]` versus `null` distinction is a different rule, noted in
        # other_notes. Its anchor is left stale, so the census records it retired.
        "M18 · ⛔ the walk's own sentence is discarded · *no such project* and *no ledger* are statements about the NAME and about this APP, and a sentence of ours over one is a second opinion about a read that already answered. \u26a1 **Anchor moved during 593's own settle**: the deferral was a `??` over `view.empty`, which is the wrong field — it is `emptySentence`'s third question now, and the row follows the SUBJECT rather than the bytes",
        [
            (
                TEAM,
                "  if (view.empty !== null) return view.empty\n  if (view.rows.length === 0) return view.says\n",
                "  if (view.empty !== null) return view.empty\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row is about `LedgerWalk`'s query
        # counts (`unread`, `short`) carried beside the narrowed rows. D-016 removed those fields:
        # `TheirConversation` has no `unread`, and `theirConversations` returns a plain list.
        # `unread: view.unread` no longer exists, so there is no count to narrow. Its anchor is left
        # stale, so the census records it retired.
        "M19 · ⚠️ the query's counts are narrowed with the rows · `LedgerWalk`'s three counts are computed from the QUERY and never from its rows, so a number narrowed here describes a walk nobody took",
        [
            (
                TEAM,
                '    unread: view.unread,\n',
                '    unread: rows.length,\n',
            )
        ],
    ),
    (
        "M20 · 🔴 a conversation that has published no status reads BUSY · the repair's opposite error: `042`'s sentence is *idle means we are no longer driving a turn*, and at registration this app is driving none",
        [
            (
                TRACK,
                "  private status: SessionStatus = 'idle'\n",
                "  private status: SessionStatus = 'working'\n",
            )
        ],
    ),
    (
        'M21 · ⛔ the tracker reports a constant instead of what it was told · the field is kept for the turn boundary either way, so the class still works and only its READERS go blind',
        [
            (
                TRACK,
                '    return { told: this.told, streaming: this.streaming, since: this.at, status: this.status }\n',
                "    return { told: this.told, streaming: this.streaming, since: this.at, status: 'idle' }\n",
            )
        ],
    ),
    (
        'M22 · ⚠️ the row says its state twice · **the person:** *"why do we feel the need to add the \'this app is not running it\' information?"* ⛔ On a recording `Ended` and that sentence are one fact in two grammars (`222` §4)',
        # ⚑ ANCHOR CORRECTED IN PLACE BY 725 — `711` GAP-1: a row the quit left open says its words
        # here too, since it wears no standing; the recording's arm this row flips is unchanged.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule 'a row says its
        # state once' survives, re-aimed by D-017b: `TeamWorkspace.vue` draws `.shelf-where` only
        # when `row.says` is set (another window has it open), and the killer test asserts a row
        # nothing runs has NO second phrase. The old `row.hereIs !== 'not-running-in-this-app' ||
        # row.keptOpen` condition is gone; the plant now forces the span on for every row and fills
        # it with the standing word, so a recording says its state twice.
        [
            (CARD, '                        <span v-if="row.says" class="shelf-where">{{ row.says }}</span>', '                        <span v-if="true" class="shelf-where">{{ row.says ?? STANDING_LABEL[row.standing] }}</span>'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'Started {{ row.started }}' age
        # span was part of the per-project roster rows on the Team shelf. D-016 rebuilt the shelf
        # from the rail's one list, and each row now draws only the state word, `says`, `place` and
        # the one press. `row.started` and the word `Started` are gone from `TeamWorkspace.vue`, and
        # `ProjectWorkspace`, the row's own comparison, is deleted. Its anchor is left stale, so the
        # census records it retired.
        "M23 · ⛔ the age loses its word · a bare age beside `Ended` reads as *ended 13h ago*, which is a claim about the wrong end of the conversation. ⛑ `Started` is `ProjectWorkspace`'s own word for the same field",
        [
            (
                CARD,
                '<span class="shelf-when">Started {{ row.started }}</span>',
                '<span class="shelf-when">{{ row.started }}</span>',
            )
        ],
    ),
    (
        "M24 · 🔴 the plate shrinks to the rail's size · `SIZES.card` is 60 and `compact` is 24, one pixel above `PLATE_FLOOR` — the illustration survives but the thing the person asked to SEE is a quarter of the area it was chosen at",
        [
            (
                CARD,
                '<AgentState size="card" v-bind="member.facets" :label="member.heading" />',
                '<AgentState size="compact" v-bind="member.facets" :label="member.heading" />',
            )
        ],
    ),
    (
        'M25 · ⛔ the press squeezes instead of wrapping · a card is ~280px and the action is a SENTENCE (`504`: it says what it does before it is pressed), so without the wrap one of the two is clipped',
        [
            (
                CARD,
                '.shelf-row {\n  display: flex;\n  min-width: 0;\n  flex-wrap: wrap;\n',
                '.shelf-row {\n  display: flex;\n  min-width: 0;\n  flex-wrap: nowrap;\n',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The group heading `<p
        # class="shelf-place">` over per-project groups (`member.use.projects.length > 1`) is gone.
        # D-016 made the shelf one flat list per agent, so there are no groups or project pill to
        # repeat. `member.use.projects` and `.shelf-place` no longer exist in `TeamWorkspace.vue`.
        # Its anchor is left stale, so the census records it retired.
        'M26 · ⚠️ the group heading is drawn over a single group · the pill above already names it, and a heading repeating the one thing on screen is the label-over-the-thing `EXT-013` §2.1 ruled against',
        [
            (
                CARD,
                '                <p v-if="member.use.projects.length > 1" class="shelf-place">{{ place }}</p>\n',
                '                <p v-if="true" class="shelf-place">{{ place }}</p>\n',
            )
        ],
    ),
    (
        "M27 · ⛔ the state line stops being the loud one · `EXT-012` §1's defect was three KINDS of fact set identically, and this line is the one a person reads first on every card · killed by `the-avatar-is-the-status.dom.test.ts`",
        [
            (
                CARD,
                # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · .team-now moved from --text-2xs to --text-sm (with a new comment) in the type unification; the plant still sets the state line at the slug's size and normal weight so it is no longer the loud one
                # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the shared-cards pass on Team dropped the comment the anchor quoted; the plant still sets the state line at the size and weight of the slug beside it
                # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
                ".team-now {\n  display: flex;\n  align-items: center;\n  margin: var(--space-1) 0 0;\n  color: var(--muted);\n  font-size: var(--type-small);\n  font-weight: var(--fw-semibold);\n",
                ".team-now {\n  display: flex;\n  align-items: center;\n  margin: 2px 0 0;\n  color: var(--muted);\n  font-size: var(--text-3xs);\n  font-weight: var(--fw-normal);\n",
            )
        ],
    ),
]
