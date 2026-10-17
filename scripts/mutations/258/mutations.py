#!/usr/bin/env python3
"""258's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **the person asked to see this twice, in his own words.**

 > *"in the UI 'claude' is idle, even though it has something scheduled each 2 minutes."*

 > *"the card that shows 'waiting for person.txt to appear on Desktop' … should actually show in the
 > side panel where we have brobot avatar. It currently shows 'Nothing is waiting'."*

`250` measured where the fact lives and built nothing, as instructed. `253` built the event and drew
nothing, as instructed — `transcript.ts`'s arm was `case 'scheduled_work': return`. So a job an agent
created reached the app, was published as a level, and stopped at the Events tab, which shows
everything and is therefore where nothing is found.

## 🔴 The correction this table records, because two rows depend on it

⛔ **258's brief says `250` had already fixed the LABEL. It had not.** `250` gave
`SessionFacetInput` a `detached` field fed by `somethingRunning`, which reads the BACKGROUND
registry; nothing in the renderer had ever seen a `scheduled_work` event. the person's first sentence was
still true of `main` when this dispatch opened, so the fifth facet is part of this diff — and
`M24`/`M25` are `250`'s own rows re-pointed at the branch that grew to hold it.

## The row groups

 * `M1`-`M6`   🔴 **the level reaching the registry at all**, and the two rules it has to keep —
                `undefined` is not `[]` (`M2`, the row the dispatch asked for by name) and a level
                REPLACES rather than merges.
 * `M7`-`M10`  🔴 **§2's ruling** — the schedule survives a close and stops promising during one.
                `M7` is the one that makes this registry a copy of `248`'s, which is the whole thing
                `253` handed over to be decided.
 * `M11`-`M14` ⛔ **the carry** (064) — a schedule is restated at TURN END and nowhere else, so a
                released slab is the one place it can be lost for minutes at a time.
 * `M15`-`M23` ⚠️ **the words** — the two predicates, the heading that must never open with `0`, and
                the vocabulary the pill borrows so it cannot name one state a second way.
 * `M24`-`M28` ⛔ **precedence** — including `250 M1` and `250 M7` carried forward.
 * `M29`-`M32` 🔴 **the carriers** — the rail, the header, and the projection each reads (064).
 * `M33`-`M34` ⛔ **the panel's fourth sentence**, including `250 M17` carried forward.
 * `M35`       ⚠️ **the test with teeth** — the render suite's comment-stripping, without which
                every SSR negative would be holding the component's own prose.
 * `M36`       ⚠️ **the code-point slice**, which is the cut every neighbour in this family got
                wrong first.
 * `M37`-`M40` ⛔ **the component** — the condition, the two notices, and the quoting that stops a
                model-written prompt from turning one row into two.
 * `M41`       🔴 **the drawer's bot**, which is the fifth word surface and the one that has now
                gone stale TWICE — `250` fixed it in the component and `258` had to move the rule
                to `plateWord` so a sixth facet cannot repeat it.
 * `M42`       🔴 **`253 M25` carried forward** — the reading-view ruling, which this dispatch
                promoted from a compile floor and which would otherwise have had no row at all.
 * `M43`-`M45` 🔴 **three defects this diff's OWN adversarial pass found** — the fourth door that
                un-ends a transcript, the one drawn cell that was not quoted, and a counted cut
                whose remainder was reachable nowhere.
 * `M46`-`M47` 🔴 **the PLATE**, where `250 M23` SURVIVED this suite — the fourth facet's
                screen-reader clause was asserted by nothing, because the census sweeps had four
                axes and the fifth facet was not declared on the component at all.

## Where each row should die

 * `M1`  → `idle-truth.test.ts` *"turn over, nothing running, a job scheduled"*, and every render
           assertion in `idle-truth.render.test.ts`.
 * `M2`  → `scheduled-work.test.ts` *"`undefined` leaves the list alone; `[]` is the only thing that
           clears it"*.
 * `M7`  → `idle-truth.test.ts` *"a conversation that CLOSES keeps its schedule"*.
 * `M11` → `scheduled-work.test.ts` *"a released slab keeps the schedule"*.
 * `M18` → `schedule-words.test.ts` *"never opens with 0"* and `schedule-bar.render.test.ts`.
 * `M24` → `idle-truth.test.ts` *"turn over, work still running"* (250's own test, unchanged).
 * `M33` → `idle-truth.test.ts` *"the panel's four sentences each name their own state"*.

## ⚑ `446` corrected one anchor in place — same defect, same kill

⛔ **`M26` moved for `250` M5's reason exactly**: the clause it inverts admits a third NEEDING since
`446` gave `441`'s proposal a badge. ⚑ The DEFECT is unchanged — a schedule ranked above a card only
a person can clear — and the row was applied alone and watched go RED against
`one-word-and-what-it-drops.test.ts`.

"""

from pathlib import Path

FOLD = "apps/desktop/src/renderer/src/lib/transcript.ts"
WINDOW = "apps/desktop/src/renderer/src/lib/transcript-window.ts"
VOCAB = "apps/desktop/src/renderer/src/lib/scheduled-work.ts"
AGENT = "apps/desktop/src/renderer/src/lib/agent-state.ts"
PANEL = "apps/desktop/src/renderer/src/lib/session-panel.ts"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
CARD = "apps/desktop/src/renderer/src/components/AgentCard.vue"
BAR = "apps/desktop/src/renderer/src/components/ScheduleBar.vue"
PLATE = "apps/desktop/src/renderer/src/components/AgentState.vue"
RENDER_TEST = "apps/desktop/test/schedule-bar.render.test.ts"
AGENT_STATE = "apps/desktop/src/shared/agent-state.ts"

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- the level reaching the registry --------------------------------------------------------
    (
        "M1 · 🔴 THE DEFECT, verbatim · the fold goes back to 253's handoff, so the level arrives and "
        "stops. Every surface below is reading a registry nothing ever writes — the schedule is on "
        "the wire, in the Events tab, and nowhere a person looks",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The scheduled_work fold
        # still exists, now wrapped in the same `if (event.jobs !== undefined)` guard plus D-017's
        # new listedSince bookkeeping (transcript.ts:6118-6128). Deleting the whole guarded block
        # reproduces the identical defect: the level never reaches state.schedule, so every
        # downstream reader is stuck on an empty registry.
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — The scheduled_work fold still exists but D-029 removed the `sleeping:
        # state.schedule.sleeping` line from the registry it writes, so the old block text no longer
        # matches. The rule (the level must reach the registry) is unchanged; the plant deletes the
        # whole guarded block as before. Killed by `idle-truth.test.ts`,
        # `idle-truth.render.test.ts`, `scheduled-work.test.ts`.
        # ⚑ F035's window half · re-anchored in place, not retired — the fold names the new level
        # `jobs` and keeps the rows it took off (`left`); the plant and its defect are unchanged.
        [
            (FOLD, '      if (event.jobs !== undefined) {\n        const before = state.schedule\n        const jobs = event.jobs.map((job) => listedSinceOf(before, job, at))\n        state.schedule = {\n          jobs,\n          dropped: event.dropped ?? 0,\n          left: before.jobs.filter((one) => !jobs.some((job) => job.id === one.id)),\n        }\n      }\n', ''),
        ],
    ),
    (
        "M2 · 🔴 `undefined` collapses into `[]` · a frame that did not STATE the level erases one "
        "that is still going to fire. §1's most important rule, and what `222` cost a dispatch — and "
        "here the frames carrying only `dropped` and `source` are the normal shape",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same fold, same rule
        # (absent jobs must leave the level alone; only an explicit [] clears it). Removing the
        # presence guard and defaulting event.jobs to [] makes an absent-jobs frame silently clear
        # an existing schedule instead of leaving it untouched.
        # ⚑ F035's window half · re-anchored in place, not retired — the fold names the new level
        # `jobs` and keeps the rows it took off (`left`); the plant and its defect are unchanged.
        [
            (FOLD, '      if (event.jobs !== undefined) {\n        const before = state.schedule\n        const jobs = event.jobs.map((job) => listedSinceOf(before, job, at))\n', '      {\n        const before = state.schedule\n        const jobs = (event.jobs ?? []).map((job) => listedSinceOf(before, job, at))\n'),
        ],
    ),
    (
        "M3 · ⛔ the level MERGES instead of replacing · a job the provider stopped naming stays on "
        "screen for ever, which is the stale indicator `247` carried the SDK's own instruction to "
        "prevent: *replace your set with each payload rather than pairing edges*",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The REPLACE-not-merge
        # rule is unchanged; only the line grew a `.map(listedSinceOf...)` call. Concatenating the
        # previous `before` array in front of the new one reproduces the exact merge defect: a later
        # frame naming fewer jobs no longer drops the ones it left out.
        # ⚑ F035's window half · re-anchored in place, not retired — the fold names the new level
        # `jobs` and keeps the rows it took off (`left`); the plant and its defect are unchanged.
        [
            (FOLD, '        const jobs = event.jobs.map((job) => listedSinceOf(before, job, at))\n', '        const jobs = [...before.jobs, ...event.jobs.map((job) => listedSinceOf(before, job, at))]\n'),
        ],
    ),
    (
        "M4 · ⚠️ `dropped` stops travelling with the jobs · the count describes a level that no "
        "longer stands, so the bar's heading and its shortfall notice are about two different "
        "payloads",
        [(FOLD, "          dropped: event.dropped ?? 0,", "          dropped: state.schedule.dropped,")],
    ),
    (
        "M5 · ⚠️ the rows are ALIASED out of the event · the fold and whatever else holds that event "
        "share one array, which is how two folds come to disagree later for no reason",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The no-aliasing rule
        # ('carryForward hands this array to the next fold, and two folds sharing one array is a way
        # for them to disagree') is restated verbatim in today's file. Assigning `event.jobs`
        # directly instead of mapping it re-creates the alias.
        # ⚑ F035's window half · re-anchored in place, not retired — the fold names the new level
        # `jobs` and keeps the rows it took off (`left`); the plant and its defect are unchanged.
        [
            (FOLD, '        const jobs = event.jobs.map((job) => listedSinceOf(before, job, at))\n', '        const jobs = event.jobs\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** D-029
        # (6c35e3f7) deleted `ScheduleRegistry.sleeping` and the line this row plants: "The window's
        # \"asleep\" schedule is gone (\"Nothing here fires until this conversation takes its next
        # message\" is no longer true): every surface asks scheduleHeld". A level frame can no
        # longer re-open or close anything because no flag exists to get a second writer. Its anchor
        # is left stale, so the census records it retired.
        "M6 · ⛔ a level frame decides whether the conversation is open · `sleeping` gets a second "
        "writer, so a replayed ledger whose last level lands after the ending re-opens a closed "
        "conversation's schedule. One fact, one writer — `061` finding 6",
        [(FOLD, "          sleeping: state.schedule.sleeping,", "          sleeping: false,")],
    ),
    # ---- §2's ruling ----------------------------------------------------------------------------
    (
        "M7 · 🔴 the schedule is SWEPT at a close, exactly like `248`'s registry · this is the ruling "
        "`253` handed over, made the wrong way: a resumed session was measured reporting the same "
        "job back BEFORE its own first prompt, so *it is gone* is the false statement",
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — The rule survives and D-029 restates it in the ScheduleRegistry doc: the
        # schedule is "Not swept at a session boundary, as `stopDetachedWork` sweeps the registry
        # above" (253 measured a resumed session reporting the same job back before its first
        # prompt). `sleepSchedule` is gone, so the sweep is planted in `markTerminal`, the close
        # door; idle-truth.test.ts section 2 ("a conversation that CLOSES keeps its schedule
        # untouched") asserts jobs length 1 and id e3826cc5 after a `session ended` event, and goes
        # red when the close empties the list. Killed by `idle-truth.test.ts`.
        [
            (FOLD, '  // ⛔ **…but the SCHEDULE outlives this** (258 §2): the jobs stand, and this app starts the\n', '  state.schedule = { jobs: [], dropped: 0 }\n  // ⛔ **…but the SCHEDULE outlives this** (258 §2): the jobs stand, and this app starts the\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** The
        # defect (a closed conversation still promising a wake-up) is now the shipped behaviour:
        # D-029 (6c35e3f7) says "The window's 'asleep' schedule is gone ... every surface asks
        # scheduleHeld, and the bar under an idle word is not drawn", because the app starts a
        # stopped conversation in time for its jobs. The test was re-aimed to expect `scheduled`
        # after a close, so a plant of the old sleepSchedule call has no anchor and no meaning. Its
        # anchor is left stale, so the census records it retired.
        "M8 · ⛔ a CLOSED conversation still promises a wake-up · the heading keeps saying *will wake "
        "this conversation* over a session that is over, which is the sentence that invites someone "
        "to close the app and expect their 2 a.m. job to run",
        [
            (
                FOLD,
                "  // ⛔ **…but the SCHEDULE outlives this, and only its firing does not** (258 §2). Measured, not\n"
                "  // assumed — see {@link sleepSchedule}, which is where the whole asymmetry is argued.\n"
                "  sleepSchedule(state)\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** The
        # `sleepSchedule` call in `markReadOnly` was removed by D-029 (6c35e3f7) with the asleep
        # model; the new comment says "Its schedule is left as the recording ends: no start reaches
        # a recording, and ReadingPane draws TranscriptView alone — no bar, no word", and the
        # re-aimed test now expects the recording to read `scheduled` at the fold. The label's
        # defect (a recording promising a wake-up through a sleeping flag) cannot be planted any
        # more. Its anchor is left stale, so the census records it retired.
        "M9 · ⚠️ a RECORDING promises one too · `markReadOnly` deliberately does not set `ended`, so "
        "this is the one state where a word surface could still say `scheduled` about a transcript "
        "nothing is running behind",
        [
            (
                FOLD,
                "  // ⚠️ **A recording's schedule is not dead — it is asleep, and the difference is the ruling** (258\n"
                "  // §2). The jobs may well still exist in the provider; nothing here is running to let them fire.\n"
                "  sleepSchedule(state)\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** D-029
        # removed the subject on purpose: `wakeSchedule` and the `sleeping` flag no longer exist
        # anywhere in src, and markReopened now only carries a comment saying the schedule stands.
        # D-029's message: "The window's \"asleep\" schedule is gone (\"Nothing here fires until
        # this conversation takes its next message\" is no longer true): every surface asks
        # scheduleHeld". There is no line left to plant; the surviving rule (a reopen leaves the
        # jobs as they were) is pinned by idle-truth.test.ts `REOPENING it keeps the same jobs`,
        # with no code to mutate. Its anchor is left stale, so the census records it retired.
        "M10 · ⛔ a REOPENED conversation never wakes · the ledger being replayed ends with the "
        "previous life closing, so a resumed session says its jobs cannot fire — for ever, or until "
        "a turn ends and restates the level",
        [
            (
                FOLD,
                "  // ⛔ **The schedule did NOT die with it, and the resume is where that was measured** (258 §2). The\n"
                "  // ledger being replayed ends with the previous life closing, so the flag it left behind says\n"
                "  // asleep; this session is running, so its jobs can fire again. See {@link wakeSchedule}.\n"
                "  wakeSchedule(state)\n",
                "",
            )
        ],
    ),
    # ---- the carry ------------------------------------------------------------------------------
    (
        "M11 · 🔴 a released slab forgets the schedule · and this registry loses more by it than "
        "`248`'s does: a level is restated at TURN END and nowhere else, so the next restatement is "
        "a whole turn away rather than a frame away (064, 061 finding 5)",
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — The release carry still copies `schedule` in `carryForward`, minus the
        # `sleeping` line D-029 removed, so the old multi-line anchor is dark. The rule (a released
        # slab must not forget the schedule, because only a turn end restates it) survives; the
        # plant replaces the copy with an empty registry. Killed by `scheduled-work.test.ts`.
        # ⚑ F035's window half · re-anchored in place, not retired — the fold names the new level
        # `jobs` and keeps the rows it took off (`left`); the plant and its defect are unchanged.
        [
            (WINDOW, '    schedule: {\n      jobs: [...state.schedule.jobs],\n      dropped: state.schedule.dropped,\n      left: [...state.schedule.left],\n    },\n', '    schedule: { jobs: [], dropped: 0, left: [] },\n'),
        ],
    ),
    (
        "M12 · ⛔ the carry is built and never applied · `foldWindow` ignores it, so the copy above is "
        "made, handed over and dropped — the same silence one layer down",
        [(WINDOW, "    state.schedule = carry.schedule\n", "")],
    ),
    (
        "M13 · ⚠️ the carried rows are ALIASED · two folds share one array across a release, which is "
        "the reason every neighbour in this function is copied one level deep",
        [(WINDOW, "      jobs: [...state.schedule.jobs],", "      jobs: state.schedule.jobs,")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** D-029
        # deleted `sleeping` from the schedule registry ("The window's \"asleep\" schedule is
        # gone"), so the line `sleeping: state.schedule.sleeping,` this row mutates no longer exists
        # in transcript-window.ts. A closed conversation's jobs crossing a release is still pinned
        # by scheduled-work.test.ts, and M11 re-anchored covers a carry that loses them. Its anchor
        # is left stale, so the census records it retired.
        "M14 · ⛔ a release resurrects a closed schedule as a live one · `sleeping` is a fact about "
        "the CONVERSATION and not about the window, and dropping it is `061` finding 5 said about "
        "the flag instead of about the status",
        [(WINDOW, "      sleeping: state.schedule.sleeping,", "      sleeping: false,")],
    ),
    # ---- the words ------------------------------------------------------------------------------
    (
        "M15 · ⛔ `somethingScheduled` ignores `dropped` · the one payload the provider already told "
        "us was short is the one every word surface answers *idle* on. `247` §3: a registry that "
        "quietly undercounts is worse than none",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — somethingScheduled now
        # delegates to shared/agent-state.ts's scheduleHeld (D-017's 'one predicate' consolidation),
        # which still implements exactly `jobs.length > 0 || dropped > 0`. Dropping the dropped
        # clause there reproduces the same undercount defect at its new, single canonical location.
        [
            (AGENT_STATE, '  return level.jobs.length > 0 || level.dropped > 0\n', '  return level.jobs.length > 0\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** D-029
        # removed `somethingScheduled` (and its `&& !registry.sleeping`) from scheduled-work.ts;
        # every word surface now asks `scheduleHeld`, and a stopped conversation with a job reads
        # *scheduled*, which is the very reading this row called a defect. Message: "every surface
        # asks scheduleHeld". The `dropped` half of that predicate is still covered by M15. Its
        # anchor is left stale, so the census records it retired.
        "M16 · 🔴 `somethingScheduled` ignores `sleeping` · a conversation that is over reads "
        "`Scheduled`, promising a wake-up nothing can deliver — §2's ruling defeated in the one "
        "predicate every word surface asks",
        [(VOCAB, "  return scheduleHeld(registry) && !registry.sleeping", "  return scheduleHeld(registry)")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** Both
        # predicates the row collapses are gone: D-029 deleted `somethingScheduled`, and the bar's
        # `held` and the words now ask the one `scheduleHeld` ("every surface asks scheduleHeld, and
        # the bar under an idle word is not drawn"). ScheduleBar takes only the registry, which no
        # longer says closed, and schedule-bar.render.test.ts now asserts the closed bar equals the
        # open one, so no line can plant 'the bar stops drawing for a closed conversation'. DEV's
        # card lists M17 for re-anchor, but the only nearby line, AgentCard's `scheduleShown`, has
        # no test: no test reads the bar under an idle word, so a plant there would be green. Its
        # anchor is left stale, so the census records it retired.
        "M17 · ⚠️ the two predicates are collapsed into one · the BAR stops drawing for a closed "
        "conversation, which is the only surface with room for the sentence that says why. The words "
        "go quiet correctly and the explanation goes with them",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — ScheduleBar.vue's `held`
        # guard is unchanged in substance (`scheduleHeld(props.registry)`, now imported from
        # shared/agent-state.ts instead of the old scheduled-work.ts). Swapping it for
        # somethingScheduled still collapses the bar's wider condition into the word surfaces'
        # narrower one, hiding the whole bar (and its 'closed, cannot fire' sentence) for a sleeping
        # conversation.
        [
            (BAR, 'const held = computed(() => scheduleHeld(props.registry))', 'const held = computed(() => somethingScheduled(props.registry))'),
            (BAR, "import {\n  droppedScheduleNote,\n  SCHEDULE_ASLEEP,\n  scheduleCutNote,\n  scheduleHead,\n  scheduleLine,\n} from '../lib/scheduled-work'\n", "import {\n  droppedScheduleNote,\n  SCHEDULE_ASLEEP,\n  scheduleCutNote,\n  scheduleHead,\n  scheduleLine,\n  somethingScheduled,\n} from '../lib/scheduled-work'\n"),
        ],
    ),
    (
        "M18 · 🔴 the heading counts the rows it can LIST · `248`'s defect reintroduced verbatim: a "
        "level naming rows this app cannot name opens with *0 jobs will wake this conversation*, "
        "which is the state `250` had to route `PANEL_EMPTY_WORDS.unnamed` around",
        [(VOCAB, "  const total = registry.jobs.length + registry.dropped", "  const total = registry.jobs.length")],
    ),
    (
        "M19 · 🔴 the heading makes a PROMISE again · *\"1 job will wake this conversation\"* is a claim "
        "about the future, and the level is restated only at TURN END — so a job the model deleted "
        "mid-turn, or a one-shot whose time has passed, goes on being promised for as long as nobody "
        "speaks. The first draft of this file said exactly that; the adversarial pass took it out",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — scheduleHead is untouched
        # apart from the constant rename SCHEDULE_WORD -> SCHEDULED; the present-tense-only rule it
        # protects is the same. Swapping back to the future-tense wording reproduces the exact
        # over-claim the adversarial pass removed.
        [
            (VOCAB, '  return total === 1 ? `1 job is ${SCHEDULED}` : `${total} jobs are ${SCHEDULED}`\n', "  return total === 1\n    ? '1 job will wake this conversation'\n    : `${total} jobs will wake this conversation`\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):**
        # `SCHEDULE_ASLEEP` was deleted with the asleep sentence: D-029's message says "Nothing here
        # fires until this conversation takes its next message" is no longer true, and the constant,
        # its `.sch-asleep` cell and the `data-sleeping` mute are gone from scheduled-work.ts and
        # ScheduleBar.vue. There is no sentence left whose naming of the way out could regress. Its
        # anchor is left stale, so the census records it retired.
        "M20 · ⚠️ the closed sentence stops naming the way out · `239`'s rule is that the sentence "
        "raising the alarm names the instrument, and this app HAS one — Resume, under the closed "
        "threads in the sidebar",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule (`239`: the
        # sentence about a stopped conversation's schedule names the way out) survives. D-017b
        # rewrote SCHEDULE_ASLEEP from 'closed ... until you resume it' to 'Nothing here fires until
        # this conversation takes its next message.', so the way out is now 'its next message'. The
        # plant drops that clause, which two tests pin.
        [
            (VOCAB, "export const SCHEDULE_ASLEEP = 'Nothing here fires until this conversation takes its next message.'", "export const SCHEDULE_ASLEEP = 'Nothing here fires.'"),
        ],
    ),
    (
        "M21 · ⚠️ the pill writes its own literal · the bar says *still scheduled* and the pill says "
        "something else, which is the drift `222` §4 forbids and the one `250`'s adversarial pass "
        "took back out of this very file",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The pill's label map
        # still writes its scheduled entry as `capitalise(SCHEDULED)`, one word-surface over from
        # the bar (only the constant name changed from SCHEDULE_WORD to SCHEDULED). Hard-coding
        # 'Idle' reproduces the exact drift 250/258's adversarial pass forbade.
        [
            (AGENT, '  scheduled: capitalise(SCHEDULED),\n', "  scheduled: 'Idle',\n"),
        ],
    ),
    (
        "M22 · ⚠️ the pill wears `live` · a blue that means work is in progress, over a conversation "
        "whose provider is doing nothing at all. The WORD was the fix; a hue that claims a running "
        "machine is a second, louder claim nobody measured",
        [
            (
                AGENT,
                # ⚑ **636 · anchor CORRECTED, subject unchanged.** `elsewhere: ''` was added
                # BETWEEN this entry and the comment the anchor reached for, so the trailing
                # context is dropped rather than re-typed — the line is unique on its own
                # (`an-anchor-on-a-lists-last-member-dies-when-anything-appends`, one direction
                # over). ⛔ Re-verified RED by hand at `636`.
                "  scheduled: '',",
                "  scheduled: 'live',",
            )
        ],
    ),
    (
        "M23 · ⛔ the plate's accessible name loses the fifth facet · the sighted reading of this "
        "state is the bar above the composer, so the one person who cannot see it is told a "
        "conversation is idle when it is going to wake at 2 a.m.",
        [(AGENT, "  if (input.scheduled) parts.push('work scheduled')\n", "")],
    ),
    # ---- precedence -----------------------------------------------------------------------------
    (
        "M24 · 🔴 `250 M1` CARRIED FORWARD · the word ignores the BACKGROUND registry again, so the "
        "pill says Idle over a command the OS reports alive. The anchor moved because this dispatch "
        "made the branch a block; the defect is `250`'s, unchanged, and its own test still kills it",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — D-017 moved the one-word
        # ranking out of the renderer's if-chain into shared/agent-state.ts's agentStateArm, the
        # single place `list_agents`, `get_agent_status` and the window all read (per that file's
        # own doc: 'the one place the order is written'). Deleting its inTheBackground arm
        # reproduces 250 M1's defect at its new canonical home: a detached command is ignored and
        # the word falls through to idle/scheduled.
        [
            (AGENT_STATE, "  if (facts.inTheBackground) return 'in-the-background'\n", ''),
        ],
    ),
    (
        "M25 · 🔴 `250 M7` CARRIED FORWARD · a WORKING turn is relabelled — the pill stops saying the "
        "model is working the moment anything is detached, trading one wrong word for another. Same "
        "row, re-pointed at the block the fifth facet grew · killed by `the-one-state-ranks-its-six-facts-in-one-order.test.ts` (named by W4.91)",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same relocation as M24:
        # the active-outranks-background rule now lives as the order of the first two checks in
        # agentStateArm. Moving the background check above the active check reproduces 250 M7's
        # defect — a turn that is genuinely working gets relabelled the moment any command is
        # detached.
        [
            # ⚑ **W4.91 · re-anchored in place, not retired** — 80bff428 added the owes-an-answer rung; the background still jumps above a working turn
            (AGENT_STATE, "  if (facts.active) return 'active'\n  if (facts.waitingOnAnAnswer) return 'waiting-on-an-answer'\n  if (facts.owesAnAnswer === true) return 'owes-an-answer'\n  if (facts.inTheBackground) return 'in-the-background'\n", "  if (facts.inTheBackground) return 'in-the-background'\n  if (facts.active) return 'active'\n  if (facts.waitingOnAnAnswer) return 'waiting-on-an-answer'\n  if (facts.owesAnAnswer === true) return 'owes-an-answer'\n"),
        ],
    ),
    (
        "M26 · ⛔ `scheduled` outranks a PERMISSION · a conversation frozen on a card the user must "
        "answer reads *Scheduled*, and `063`/`079` §5's guarantee — an unanswered card always has a "
        "visible trace — is gone for something that is not even happening yet · killed by `the-one-state-ranks-its-six-facts-in-one-order.test.ts` (named by W4.91)",
                # ⚑ **Re-anchored by `446`**, for `250` M5's reason exactly — the clause was
                # extracted to `summonsAttention`, and the DEFECT below is unchanged.
                # ⚑ **636 · re-anchored again, and again for `250` M5's reason**: the guard gained
                # `waitSummonsAPerson(facets.waiting)`, the one wait that IS a person's. ⛔ The
                # defect — a schedule outranking a card only a person can clear — is untouched,
                # and the row was re-verified RED by hand at `636`.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — needsYou is still checked
        # first in agentStateArm precisely so a permission/question always outranks everything else
        # (063/079 §5). Moving the scheduled check above needsYou reproduces that exact violation: a
        # conversation frozen on a card a person must answer reads 'scheduled' instead of 'waiting'.
        [
            # ⚑ **W4.91 · re-anchored in place, not retired** — 80bff428 added the owes-an-answer rung; scheduled still jumps above a card
            (AGENT_STATE, "  if (facts.needsYou) return 'needs-you'\n  if (facts.active) return 'active'\n  if (facts.waitingOnAnAnswer) return 'waiting-on-an-answer'\n  if (facts.owesAnAnswer === true) return 'owes-an-answer'\n  if (facts.inTheBackground) return 'in-the-background'\n  if (facts.scheduled) return 'scheduled'\n", "  if (facts.scheduled) return 'scheduled'\n  if (facts.needsYou) return 'needs-you'\n  if (facts.active) return 'active'\n  if (facts.waitingOnAnAnswer) return 'waiting-on-an-answer'\n  if (facts.owesAnAnswer === true) return 'owes-an-answer'\n  if (facts.inTheBackground) return 'in-the-background'\n"),
        ],
    ),
    (
        "M27 · ⚠️ `scheduled` outranks `background` · something that WILL happen talks over something "
        "that IS happening, and the one word this surface has stops naming the one a person could "
        "act on — `248`'s bar is the one with a Stop button behind it",
                # ⚑ **636 · anchor CORRECTED, subject unchanged.** A third member joined this
                # branch — `elsewhere`, placed BETWEEN the two lines this row swaps — so the
                # anchor carries it through untouched and still plants exactly the defect it
                # always did: something that WILL happen talking over something that IS
                # happening. ⛔ Re-verified RED by hand at `636`.
                # ⚑ ANCHOR CORRECTED IN PLACE BY T-002 — D-006 gave `scheduled` its own line (two
                # standings, `stalled` and `answered`, now follow it). The row swaps the same two
                # lines around `elsewhere`, so `scheduled` again talks over `background`.
                # Re-verified RED alone.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The
        # background-outranks-schedule rule ('248's bar is the one with a Stop button behind it') is
        # the last two lines of agentStateArm today. Swapping them reproduces the exact M27 defect:
        # a conversation with both a running command and a due job reads 'scheduled' instead of
        # 'background'.
        [
            (AGENT_STATE, "  if (facts.inTheBackground) return 'in-the-background'\n  if (facts.scheduled) return 'scheduled'\n", "  if (facts.scheduled) return 'scheduled'\n  if (facts.inTheBackground) return 'in-the-background'\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row hoists `scheduled` above the
        # ENDING arms `facets.being === 'errored'` and the `isOver` returns. D-017 and D-017b
        # removed those terminal standings: `standingOf` now maps `agentStateArm`'s one order,
        # `nothingDoingHere` replaces `isOver`, and no surface says a conversation ended. The
        # idle-truth test says so: 'not because a terminal word outranks it (there is none now)'.
        # The anchor `facets.being === 'errored'` has no counterpart in `standingOf`. Its anchor is
        # left stale, so the census records it retired.
        "M28 · ⛔ `scheduled` talks over the ENDING · hoisted above `isOver`'s three returns, so a "
        "conversation that is finished or has errored reads *Scheduled* — the terminal fact is the "
        "larger one, exactly as it is for `background`",
        [
            (
                AGENT,
                "  if (facets.being === 'errored') return 'errored'",
                "  if (facets.scheduled) return 'scheduled'\n  if (facets.being === 'errored') return 'errored'",
            )
        ],
    ),
    # ---- the carriers ---------------------------------------------------------------------------
    (
        "M29 · 🔴 the RAIL goes quiet · `recordFacets` stops asking, so every conversation in the "
        "rail — which is most of them, since only one is on screen (064) — reads `claude · idle` "
        "while it holds a cron",
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — `recordFacets` still asks the schedule, now as
        # `scheduleHeld(record.control.schedule)` (D-029 replaced `somethingScheduled`). The rule
        # (the rail must not go quiet about a conversation holding a cron) is unchanged; the plant
        # drops that line again. Killed by `idle-truth.test.ts`, `idle-truth.render.test.ts`.
        [
            (AGENT, '    scheduled: scheduleHeld(record.control.schedule),\n', ''),
        ],
    ),
    (
        "M30 · 🔴 the HEADER goes quiet · the pane stops passing it, so the pill above the "
        "conversation disagrees with the bar a few inches below it — 099, restaged for a fifth fact",
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — ConversationPane's facetInput now says `scheduled:
        # scheduleHeld(control.value.schedule)` (D-029 renamed the call). The rule (the header pill
        # must agree with the bar below it) is unchanged; the plant removes the line. Killed by
        # `idle-truth.render.test.ts`.
        [
            (PANE, '  scheduled: scheduleHeld(control.value.schedule),\n', ''),
        ],
    ),
    (
        "M31 · ⛔ the facet is built but never carried · `sessionFacets` drops it, so every surface "
        "downstream reads an object the fact never reached",
        [(AGENT, "    ...(input.scheduled ? { scheduled: true } : {}),\n", "")],
    ),
    (
        "M32 · 🔴 the pane reads the READING window · a reader who has paged back past the level sees "
        "the bar empty and the pill say Idle, about a job that is still going to fire. Every record "
        "helper in the suite leaves the two projections as ONE object, which is what makes this row "
        "worth having (064)",
        # ⚑ Landing ui batch 1 · re-anchored in place, not retired — `ac9c71fd` moved the bar onto
        # the agent's card, which still reads the CONTROL projection (`state`); `shown` is the
        # reading window. The plant makes the card read the window first.
        [
            (
                CARD,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 3531ffd41 added persisted folding; retain it while selecting the paged reading schedule instead of the live one.
                "<ScheduleBar :registry=\"props.state.schedule\" fold=\"brobot2.cardScheduleFolded\" />",
                "<ScheduleBar :registry=\"props.shown?.schedule ?? props.state.schedule\" fold=\"brobot2.cardScheduleFolded\" />",
            )
        ],
    ),
    # ---- the panel ------------------------------------------------------------------------------
    (
        "M33 · 🔴 `250 M17` CARRIED FORWARD · the words stop being chosen — one sentence for four "
        "states, and it is the one that enumerates a list a cron is not in. the person's second sentence, "
        "restored: *It currently shows 'Nothing is waiting'*",
        [
            (
                PANEL,
                # ⚑ **508 re-anchored this and the ROW is unchanged.** That dispatch added a fourth
                # arm — work this conversation gave out — so the tail of the fold became an `if` and
                # a `return`. ⛔ The mutation still collapses every arm onto the one sentence that
                # enumerates a list a cron is not in, which is `250 M17`'s defect verbatim.
                # ⚠️ Re-verified RED against `idle-truth.test.ts` after the move, not carried on the
                # verdict it earned against the old shape —
                # `a-corrected-anchor-keeps-a-verdict-it-never-earned`.
                "  if (panel.stillRunning) {\n"
                "    return panel.runningNamed ? PANEL_EMPTY_WORDS.running : PANEL_EMPTY_WORDS.unnamed\n"
                "  }\n"
                "  if (panel.scheduled) return PANEL_EMPTY_WORDS.scheduled\n"
                "  return gaveWork ? PANEL_EMPTY_WORDS.gaveWork : PANEL_EMPTY_WORDS.quiet",
                "  return PANEL_EMPTY_WORDS.quiet",
            )
        ],
    ),
    (
        "M34 · ⛔ the panel stops asking · the paragraph is chosen from a field nothing fills, so the "
        "drawer goes back to *Questions, permissions, running agents and the checklist appear here* "
        "over a conversation with a 2 a.m. appointment",
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — sessionPanel still sets `scheduled` for the drawer's paragraph, now as
        # `scheduleHeld(state.schedule)` (D-029 renamed the call). The rule is unchanged; the plant
        # removes the field, so the drawer says nothing is waiting over a conversation with a job.
        # Killed by `idle-truth.test.ts`.
        [
            (PANEL, '    scheduled: scheduleHeld(state.schedule),\n', ''),
        ],
    ),
    # ---- the tests with teeth -------------------------------------------------------------------
    (
        "M35 · ⚠️ the render test stops stripping the component's own prose · SSR emits template "
        "comments verbatim, so `bar()` strips them before any assertion sees them — the discipline "
        "that three assertions in `background-bar.render.test.ts` were found passing over. ⚠️ It dies "
        "on the `<!---->` equality rather than on a leaked word, and that is stated rather than "
        "claimed: THIS component's seven template comments happen to contain none of the strings "
        "its negatives name, so what the row proves is that the stripping is load-bearing at all",
        [
            (
                RENDER_TEST,
                "  return (await raw(reg)).replace(/<!--[\\s\\S]*?-->/g, '')",
                "  return await raw(reg)",
            )
        ],
    ),
    (
        "M36 · ⚠️ the cut slices UTF-16 UNITS · a prompt ending on an emoji at the boundary renders a "
        "lone surrogate — `�` on screen, from the one function whose whole job is not to mislead "
        "about what a machine has promised to do",
        [(VOCAB, "  const points = [...full]", "  const points = full.split('')")],
    ),
    # ---- the component --------------------------------------------------------------------------
    (
        "M37 · ⛔ the prompt is drawn RAW · a cron prompt can be written by a model acting on a web "
        "page it read, and a newline in it turns one row into two on the one surface whose job is "
        "saying what this machine will do unattended. U+202E does worse and says nothing at all",
        [(VOCAB, "  return hasControlCharacter(text) || hasReorderingCharacter(text)", "  return false")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** The `<p
        # v-if="props.registry.sleeping" class="sch-asleep">` paragraph this row mutates was deleted
        # by D-029 ("The window's \"asleep\" schedule is gone"), together with `SCHEDULE_ASLEEP` and
        # the `data-sleeping` styles. The bar now has one state, and a closed bar must equal an open
        # one, as schedule-bar.render.test.ts asserts. Its anchor is left stale, so the census
        # records it retired.
        "M38 · ⛔ the closed conversation's sentence is not drawn · the heading drops the promise and "
        "nothing takes its place, so the bar shows jobs beside no explanation of why they are quiet",
        [
            (
                BAR,
                '    <p v-if="props.registry.sleeping" class="sch-asleep" data-cy="schedule-asleep">',
                '    <p v-if="false" class="sch-asleep" data-cy="schedule-asleep">',
            )
        ],
    ),
    (
        "M39 · ⚠️ the shortfall notice is not drawn · the heading counts every row the provider sent "
        "and the list shows fewer, with nothing on screen to reconcile the two — a list that looks "
        "complete is read as complete (092, 247 §3)",
        [
            (
                BAR,
                '    <p v-if="props.registry.dropped > 0" class="sch-dropped" data-cy="schedule-dropped">',
                '    <p v-if="false" class="sch-dropped" data-cy="schedule-dropped">',
            )
        ],
    ),
    (
        "M40 · ⛔ a job with neither a schedule nor a prompt draws an empty row · both fields are "
        "optional and both are `z.string()` with no minimum, so this is reachable rather than "
        "defensive — and a row a person cannot name is a row they cannot act on (106)",
        [
            (
                VOCAB,
                "    ...(when === undefined && asks === undefined\n"
                "      ? { fallback: shown(job.id, SCHEDULE_WHEN_CHARS) }\n"
                "      : {}),",
                "",
            )
        ],
    ),
    (
        "M41 · 🔴 the DRAWER's bot prints `idle` above its own paragraph · `250` found this surface "
        "in review and fixed it with a one-off `standing === 'background'` written into the "
        "component; the fifth facet walked straight through it. the person's exact complaint, restored "
        "INSIDE the panel by the dispatch that quotes him — found by this diff's own adversarial pass",
                # ⚑ ANCHOR CORRECTED IN PLACE BY T-002 — D-006 added two more plate standings and
                # the `return` now takes one per line. The row still drops `scheduled` from the
                # plate, and only it. Re-verified RED alone.
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — The anchor went dark through UI-008 (c37e0fd1), not D-029: `plateWord`'s return
        # now starts `standing === 'waiting' ||`, so `return standing === 'background' ||` no longer
        # matches. The rule (the drawer's bot must not print the bare DOING word over a schedule)
        # survives; the plant drops `scheduled` from the list, as the row always did. Killed by
        # `idle-truth.test.ts`, `idle-truth.render.test.ts`.
        [
            (AGENT, "    standing === 'background' ||\n    standing === 'scheduled' ||\n", "    standing === 'background' ||\n"),
        ],
    ),
    (
        "M42 · 🔴 `253 M25` CARRIED FORWARD · the fold starts making a transcript ROW per level. "
        "`253` guarded this as a compile floor; `258` turned it into a RULING with a measurement "
        "behind it — a cron firing re-emits the level every couple of minutes — so the row it "
        "retired has to come back pointed at the arm that now writes a registry. ⚠️ Through `notice` "
        "rather than a hand-built item: the first form hardcoded `provider: 'claude'` and tripped "
        "`provider-neutrality.test.ts` as well, which would have read as a far wider blast radius "
        "than the defect has",
        [
            (
                FOLD,
                "    case 'scheduled_work': {\n      if (event.jobs !== undefined) {",
                "    case 'scheduled_work': {\n"
                "      notice(state, 'info', 'a job is scheduled')\n"
                "      if (event.jobs !== undefined) {",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** The row
        # plants removing `wakeSchedule(state)` from the `session` arm, and D-029 deleted
        # `wakeSchedule` along with the asleep flag ("The window's \"asleep\" schedule is gone").
        # The test now says "no door writes the schedule now (the asleep flag went)"; what remains
        # (a two-life ledger leaves the level standing, state.ended false) is pinned by
        # idle-truth.test.ts and scheduled-work.test.ts but has no line to mutate that matches this
        # label. Its anchor is left stale, so the census records it retired.
        "M43 · 🔴 the FOURTH door stops waking it · `case 'session'` un-ends a transcript without "
        "going through `markReopened`, so a ledger with two lives folds to `ended: false` with the "
        "schedule asleep: the bar says *this conversation is closed* over a live conversation, and "
        "the pill and the rail go back to `Idle`. Found by the adversarial pass over this diff, by "
        "three angles independently — the doc-comment had claimed there were three doors",
        [
            (
                FOLD,
                "      wakeSchedule(state)\n      state.ref = event.ref\n",
                "      state.ref = event.ref\n",
            )
        ],
    ),
    (
        "M44 · 🔴 the bare row's ID is drawn RAW · `schedule` and `prompt` both go through the "
        "quoting and this one did not — and it is the ONE cell that can be the whole row. A job id "
        "carrying U+202E reorders everything after it on the surface whose stated job is saying what "
        "this machine has promised to do while nobody is watching",
        [
            (
                VOCAB,
                "      ? { fallback: shown(job.id, SCHEDULE_WHEN_CHARS) }",
                "      ? { fallback: { text: job.id, cut: 0, full: job.id } }",
            )
        ],
    ),
    (
        "M45 · ⛔ a counted cut points nowhere · the cell's title goes back to the fixed caveat and "
        "drops the whole string, so a row can announce *+N more characters* with those characters "
        "reachable in no surface at all — `092`'s rule broken by the very field written to keep it. "
        "`ScheduleShown.full` was computed and read by nothing until the adversarial pass said so",
        [(BAR, "  return `${caveat}\\n\\n${shown.full}`", "  return caveat")],
    ),
    (
        "M46 · 🔴 `250 M23` CARRIED FORWARD · the plate's accessible name loses the FOURTH facet, so a "
        "screen reader hears *claude — idle, live* over work the sighted reading shows in a list with "
        "a stop button. Its anchor moved because 258 declared the fifth prop beside it — the same "
        "line, one facet wider · killed by `agent-state.render.test.ts`",
        [
            (
                PLATE,
                # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · bda8b1be moved the facet spreads out of the accessible-name call into one facets computed that the name reads; the plant still drops the background-work facet, so the name says idle over running work.
                "  ...(props.detached ? { detached: true } : {}),\n",
                "",
            )
        ],
    ),
    (
        "M47 · 🔴 the FIFTH facet never reaches the plate at all · declared nowhere, so every caller's "
        "`v-bind` drops it onto the root element as a stray attribute and the screen-reader sentence "
        "`258` added becomes a branch no call site can produce — `222` §4's *a word nothing can "
        "produce*, created by the fix for it, which is exactly what `250 M23` records happening the "
        "first time. Found by the render sweep, which only reaches this state because `M23` SURVIVED "
        "and said its axis was missing · killed by `agent-state.render.test.ts`",
        # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · bda8b1be moved the facet spreads into one facets computed that the accessible name reads; the plant still drops the scheduled facet before the name, so the scheduled sentence is never produced.
        [(PLATE, "  ...(props.scheduled ? { scheduled: true } : {}),\n", "")],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    """Apply (or merely verify) one mutation. Returns 0 on success, 1 on a bad anchor."""
    name, edits = MUTATIONS[index]
    for rel, find, replace in edits:
        path = root / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name.split(' ·')[0]}: anchor found {hits}x in {rel} (expected exactly 1)")
            return 1
        if find == replace:
            print(f"!! {name.split(' ·')[0]}: replacement equals the original in {rel} — a no-op row")
            return 1
        if not dry:
            path.write_text(text.replace(find, replace, 1))
    return 0


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
