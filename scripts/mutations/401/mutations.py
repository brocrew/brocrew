"""401 · the queue that ends at a person — each row is THE DEFECT, put back (131).

🔴 **HO-007 criterion 11's last link.** `394` routed a question to a parent, `396` gave the parent a
reader, `398` gave the deadline a row and folded the chain — and `399` measured that **no `.vue`
file calls `questionsForAPerson`**. The PO's word for that state:

> ⛔ **"A chain that stops before the person is not a chain — it is the feature not existing,
> disclosed as a backend."**

⚑ So this dispatch builds the surface, and every row below is one sentence on it made false.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M2` | ⚑ `apps/desktop/test/persons-queue.test.ts` §1 — the reading, and the sentence that joins it |
| `M3`, `M5`–`M10` | ⚑ the same file's §2, §4 and §5 — the view's absences, its row and its count |
| `M11` | ⚑ §3 of BOTH files — the chain, one name per participant |
| `M12`–`M17` | ⚑ `apps/desktop/test/dom/persons-queue.dom.test.ts` §1, §2, §4, §5, §8 — the band, the focus order, the live region |
| `M18`–`M20` | ⚑ §6 of both files — Home's third population |
| `M4`, `M21`–`M28` | ⚑ `persons-queue.test.ts` §7 — the store's refusal, and the shell's wiring read as source |

⚠️ **The ranges were wrong in the first draft and the review caught it**: `M11` was filed under a
section that never looks at a chain and `M17` under one with no aria assertion in it. A gate table
that names a gate which cannot kill its row is worse than none — it is a coverage claim nothing
checks.

## 🔴 ONE ANCHOR WAS CORRECTED IN PLACE BY `421`

⛔ **`M6`'s fork moved file.** `421` gave the left rail the same gesture for the same population —
HO-023 §2.3, *"`store.claim()` is the door that works and it has one call site. Give it the
others"* — so `held ? 'Open the conversation' : 'Take it over and open it'` now lives in
`taking-over.ts`, which both surfaces read. ⚑ **The row stays on the QUEUE's call site**, which is
what it prices; the shared function has its own row in `421`. ⚠️ This table is `unrun`, so the row
carried no verdict to invalidate — the suffix is on the label anyway, because the next person to
run it must know the text moved. **Applied alone and watched go RED against
`persons-queue.test.ts`.**

## ⛔ What this table deliberately does NOT contain

⛔ **No row deleting the poll.** ⚠️ A window that never looks draws nothing, which is also what a
window with nothing waiting draws — so the row would record as a SURVIVOR against every gate that
supplies the module directly, and mean nothing. ⚑ What IS a row is `M21`: the look folding a
REFUSAL into an all-clear, which is a defect whatever the cadence.

⛔ **No row on `escalationChain`, `questionsAPersonMustAnswer` or the `because` gate.** `398` owns all three
and its own table has them. What `401` adds to that file is the NAMING (`chainReading`), and `M1`
and `M2` are its two halves.

⛔ **No row making this surface ANSWER.** There is nothing to remove: the queue has one control per
row and it travels. ⚑ The census that would catch one being added is the dom file's *"there is
nothing on this surface that could answer anything"*, which walks the real DOM for every
`button`, `input`, `select`, `textarea` and `[contenteditable]` under the root — so a control added
by a child component is caught too, and a row here would only be able to delete the one that exists.

⛔ **No row on `--waiting` in a light scope.** `391` owns the token and `chat-theme.test.ts` owns the
contrast; what this surface adds is the CHOICE of the pill trio over the ink one, and a row swapping
them would be measured where both readings agree in the dark scope — `a-comparison-tested-where-both-
sides-agree-measures-nothing`. ⚑ The dom file asserts the scoped value differs from the root one
instead, which is the property that makes the choice necessary.

## ⚠️ Eight anchors were CORRECTED at `403`, and not one defect changed

⛔ **`M3`, `M5`, `M7`, `M9`, `M19`, `M20`, `M22` and `M25` are re-anchored** on declarations that
`403` moved when it added the second population: the view takes two lists and returns `null` if
either is missing, its row builder is a helper with its own parameter names, `HomeAttention.
escalated` is `onlyYou`, its intro arm names no population, and the shell's look reads both.
⚑ **Every row still puts back exactly the defect its label describes, and every killer is
unchanged.** ⚠️ **This table was entirely UNRUN when they were corrected**, so no row is carrying a
verdict it did not earn — `a-corrected-anchor-keeps-a-verdict-it-never-earned` is the rule and it
cost nothing here only because nothing had been run.

## ⚠️ `434` moved `M14`'s anchor — same defect, same kill

⛔ **The card's `v-if` gained a third arm.** `434` added `PersonsQueueView.stale` — *a read that has
STOPPED answering*, which `403`'s `partial` cannot see — and the card must draw for it too, so the
condition is now `rows.length > 0 || view.partial || view.stale`. ⚑ `M14`'s defect is unchanged:
`v-if="view !== null"` draws an empty amber card over every sheet in the app for the life of the
process. ⛔ **The recorded RED was measured against the OLD text**; the corrected row was applied
alone and watched go red at `434`.

## ⚑ `446` corrected two anchors in place, and this is the THIRD dispatch to move them

⛔ **`M3` and `M9` moved because a third population arrived.** The view's *nothing has landed* guard
now asks about three reads, and the announcement is folded over whatever populations are PRESENT
rather than branching on two. ⚠️ **`M9`'s evidence had to be re-quoted a second time** — `403` made
its empty arm say *0 decisions* and `446` made it say nothing at all — ⛔ **and the DEFECT is
unchanged either way**: a live region that speaks when there is nothing to say. Both rows were
applied alone and watched go RED against `persons-queue.test.ts`.

"""

QUESTIONS = "apps/desktop/src/shared/questions.ts"
QUEUE = "apps/desktop/src/renderer/src/lib/persons-queue.ts"
STORE = "apps/desktop/src/renderer/src/lib/session-store.ts"
ARM = (
    "            `No conversation on this screen is blocked on you. ${items(onlyYou)} below ${\n"
    "              onlyYou === 1 ? 'is' : 'are'\n"
    "            } waiting on you, and each is settled on its own card.${andThePlaceholders}`,\n"
)

HOME = "apps/desktop/src/renderer/src/lib/home-attention.ts"
PANEL = "apps/desktop/src/renderer/src/components/PersonsQueue.vue"
HOST = "apps/desktop/src/renderer/src/components/OverlayHost.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
# ⚑ **606 · the live queue's HOST**, which `EXT-008` §3 moved off Home into its own destination.
# ⛔ The constant keeps its name so the rows on it are still one subject.
HOMEVUE = "apps/desktop/src/renderer/src/components/WaitingOnYou.vue"
ATTENTIONQUEUE = "apps/desktop/src/renderer/src/components/AttentionQueue.vue"

# ⛔ **Anchored on the code lines alone and never on the paragraph above them** — a docblock that
# argues for a line is edited far more often than the line
# (`a-source-census-that-pins-a-line-kills-every-row-on-it`).
# 🔴 **453 · the card's `v-if` gained two more arms and this is its fourth spelling.** ⛔ Two rows
# anchor on it (`M14` here, `403 M25`), so it is a constant rather than two copies that can drift
# apart — which is how `a-corrected-anchor-keeps-a-verdict-it-never-earned` happens twice at once.
# ⚑ **533 · ANCHOR CORRECTED IN PLACE, not retired.** The band of provider walls added two
# arms to this condition — `walls.length > 0` and `limits?.unread === true` — so the section's
# `v-if` gained an outer parenthesis and two lines. ⛔ **The bytes moved and every SUBJECT on this
# constant is exactly where it was**, which is what `correct-a-stale-mutation-anchor-dont-retire-it`
# means by a repair. ⚠️ **Every replacement that used to reduce the whole condition now keeps the
# two wall arms**, so each row still puts back its OWN defect and nothing else: a row that also
# deleted the band would be measuring two things and killing on either.
# ⚑ **ANCHOR CORRECTED IN PLACE BY 557** — the `v-if` gained the stopped-work band's own two
# clauses (`StalledWorkView`). ⛔ The subject of every row that reads this constant is unchanged;
# what moved is the list of reasons the card may draw at all, and each replacement below carries
# the two new clauses so the row still isolates the arm it is about.
V_IF = (
    '    v-if="\n'
    '      (view !== null &&\n'
    '        (rows.length > 0 || view.partial || view.stale || view.noLedger || view.rowsDropped)) ||\n'
    '      walls.length > 0 ||\n'
    '      limits?.unread === true ||\n'
    '      stalledRows.length > 0 ||\n'
    '      stalled?.unread === true ||\n'
    # ⚑ **678 · re-anchored and the ROW is unchanged** — the `v-if` gained the stalled walk's unread
    # rows (F-R18b), and each replacement below carries the clause, so the row isolates what it did.
    '      !!stalled?.short\n'
    '    "\n'
)

LANE_FLOATING = (
    ".persons-queue.floating {\n"
    "  position: absolute;\n"
    "  z-index: 2;\n"
    "  right: var(--space-5);\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the naming that crosses the wire ──────────────────────────────────────────────────
    (
        "M1 · 🔴 the person is a NAME rather than a null · the one answerer who is not a "
        "conversation becomes the string `you`, so a conversation whose working folder is called "
        "`you` reads as the person — and the surface can no longer tell the end of a chain from a "
        "hop in the middle of one, because the discrimination it drew was the null",
        # ⚠️ **611 · CORRECTED IN PLACE** — the push is guarded, because a link whose `on` is
        # null is ALREADY the person's hop: an addressed question has no hop above it.
        [(QUESTIONS, "    if (last.on !== null) hops.push({ waiting: name(last.on), on: null })\n",
          "    if (last.on !== null) hops.push({ waiting: name(last.on), on: 'you' })\n")],
    ),
    (
        "M2 · 🔴 a walk that was STOPPED is reported as one that ended · a cycle and the hop bound "
        "both come back `unfollowable: false`, so the surface draws a chain that simply stops "
        "and says nothing about the part it could not follow — `398`'s own rule broken from the "
        "other side: it does not print *you*, it prints a chain that looks complete",
        [(QUESTIONS, "  return { hops, unfollowable: true }\n",
          "  return { hops, unfollowable: false }\n")],
    ),
    # ── §2 · the three absences ────────────────────────────────────────────────────────────────
    (
        "M3 · 🔴 a read that has not landed is drawn as one that found nothing · the first paint "
        "after a launch claims a person has nothing waiting on them, which is `086`'s rule broken "
        "on the one surface where the wrong default is a false all-clear",
                # same guard. ⛔ The DEFECT is unchanged: a read that has not landed drawn as one
                # that found nothing.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule holds: a read
        # that has not landed is null and not an empty queue. `personsQueueView(questions,
        # decisions, world)` now has two populations and the early return is a single-line `if
        # (questionsForAPerson === null && decisionsForAPerson === null) return null`. The plant
        # replaces that return with `??= []` for each, so a launch-time null pair is drawn as an
        # empty, quiet queue. Section 2's own `personsQueueView([], [], WORLD)` case shows an array
        # is safe for the rest of the function.
        [
            (QUEUE, '  if (questionsForAPerson === null && decisionsForAPerson === null) return null\n', '  questionsForAPerson ??= []\n  decisionsForAPerson ??= []\n'),
        ],
    ),
    (
        "M4 · 🔴 a REFUSED read becomes *nothing is waiting on you* · one dropped IPC call and the "
        "strongest claim this app makes about somebody's own workload is made out of a failure — "
        "every other degrading read in this store may answer with the empty thing, and this is the "
        "one where empty and unknown are different sentences",
        [(STORE, "      } catch {\n        return null\n      }\n    },\n\n    /**\n"
                 "     * ⛔ **DEFECT FIXED HERE",
          "      } catch {\n        return []\n      }\n    },\n\n    /**\n"
          "     * ⛔ **DEFECT FIXED HERE")],
    ),
    # ── §3 · the row, and where it points ──────────────────────────────────────────────────────
    (
        "M5 · 🔴 the route goes to the PARENT instead of to the child · the card is on the "
        "conversation that ASKED, and this sends a person to the one that failed to answer — a "
        "conversation with nothing on it to answer, reached by a button that promised arrival",
        [(QUEUE, "      sessionId: request.askedBy,\n",
          "      sessionId: (request as { parent: string }).parent,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The subject is gone:
        # `openingAction(held)` no longer exists and the queue row's action is the constant
        # OPEN_THE_CONVERSATION. D-017b: "no Reopen / Take it over / Read the recording presses: one
        # press, 'Open the conversation'", and taking-over.ts says the four words (Open, Take it
        # over and open it, Reopen, Read the recording) "each named what a process was doing, which
        # a person no longer has to know (05 rule 5)". The planted string is now the real code. Its
        # anchor is left stale, so the census records it retired.
        "M6 · ⛔ the widening is not named before it is made · taking over a conversation nobody "
        "holds and opening one this window already runs read as the same gesture, so `336`'s door "
        "is walked through by somebody who was told they were opening something "
        "⚑ ANCHOR CORRECTED IN PLACE BY 421",
        # ⚠️ **421 moved the fork to `taking-over.ts`** so the left rail could read the same words
        # for the same gesture; this row stays on the QUEUE's call site, which is what it prices —
        # the shared function has its own row in `421`.
        [(QUEUE, "      action: openingAction(held),\n",
          "      action: 'Open the conversation',\n")],
    ),
    (
        "M7 · ⛔ a missing stamp becomes a moment · a row whose escalation time did not cross reads "
        "as having become yours at the epoch, so the age this surface exists to show is invented "
        "rather than withheld — `attention.ts`' rule, one subject over",
        [(QUEUE,
          "      since: at === null ? null : agoWords(at, world.now),\n",
          "      since: agoWords(at ?? 0, world.now),\n")],
    ),
    (
        "M8 · ⛔ the count is capped · a person with twelve questions waiting is told nine, on the "
        "one surface whose entire content is the number — a badge you may round is a badge nobody "
        "can act on",
        [(QUEUE, "  const count = rows.length\n", "  const count = Math.min(rows.length, 9)\n")],
    ),
    (
        "M9 · ⛔ the announcement fires with an empty queue · a screen reader is told *waiting on "
        "you* every time the poll answers, which is the unconditional live region the design's own "
        "attention-policy correction removed. ⚠️ The words it says have been re-quoted twice — `403` "
        "made the empty arm *0 decisions* and `446` made `waitingFor` fold over the populations "
        "that are PRESENT, so an empty queue now announces the empty string — ⛔ and the DEFECT is "
        "unchanged either way: a live region that speaks when there is nothing to say",
        [(QUEUE,
          "    announcement: count === 0 ? '' : `${waitingFor(present)} waiting on you.`,\n",
          "    announcement: `${waitingFor(present)} waiting on you.`,\n")],
    ),
    (
        "M10 · ⚠️ the look is paced by preference rather than by the deadline it watches · twice the "
        "escalation window between looks, so a question can be a person's for a full minute with "
        "nothing on screen saying so — a bound that stops being derived from the thing it bounds",
        [(QUEUE, "export const LOOK_EVERY_MS = 5_000\n", "export const LOOK_EVERY_MS = 60_000\n")],
    ),
    (
        "M11 · 🔴 the chain does not name the conversation the card is IN · the hops are drawn from "
        "each answerer alone, so a chain reads *pm-alpha → you* and the child a person has to open "
        "is the one name missing from it",
        # ⚑ **613 · anchor CORRECTED IN PLACE, not retired** — the hop gained `did` (what this
        # participant was observed to do) and the line moved; the SUBJECT is untouched, which is
        # why this is a repair. Re-verified RED by hand against `persons-queue.test.ts` §3.
        [(QUEUE, "  return [\n    { name: first.waiting, you: false, did: raised },\n",
          "  return [\n")],
    ),
    # ── §4 · the two corners ───────────────────────────────────────────────────────────────────
    (
        "M12 · 🔴 the overlay layer's reserved band moves to the RIGHT edge · which is the shape "
        "`401` drew first and the review measured: `DocumentDrawer` is `width: min(640px, 56vw); "
        "height: 100%; margin-left: auto`, so a card 10px from the right edge sits inside the "
        "drawer's own footer and takes `drawer-review-dispatch` — *\"the only door to the dispatch "
        "gate that does not go through Home\"*. ⛔ There is no width at which the right corner is "
        "free, which is why the two cards share the left one",
        [(HOST, "  bottom: var(--space-6);\n  left: var(--space-5);\n  display: flex;\n",
          "  bottom: var(--space-6);\n  right: var(--space-5);\n  display: flex;\n")],
    ),
    (
        "M13 · 🔴 the band is unbounded · nine escalated questions grow the column up the screen "
        "and carry the emergency stop off the top of the window — the one control a person "
        "reaches for at the worst moment, pushed away by the list that tells them it is the worst "
        "moment",
        [(HOST, "  max-height: calc(100% - 2 * var(--space-6));\n", "")],
    ),
    (
        "M14 · ⛔ it is drawn when there is nothing in it · an empty amber card sits over every "
        "sheet in the app for the whole life of the process, which is the attention channel spent "
        "on telling a person there was nothing to spend it on ⚑ ANCHOR CORRECTED IN PLACE BY 434 "
        "⚑ ANCHOR CORRECTED IN PLACE BY 453",
        # ⚑ **533 · the replacement keeps the two wall arms** — see V_IF's note. The defect this
        # row puts back is *the QUEUE half draws when it has nothing*, and a replacement that also
        # deleted the band would kill on the band instead.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The PersonsQueue v-if is
        # the same guarded-disclosure clause, now with an extra `(props.floating &&
        # asksSaySomething)` OR-arm added since 434/453's prior corrections (unrelated to this row).
        # Widening `(view !== null && (rows.length>0 || …))` down to plain `view !== null` still
        # draws an empty card whenever a read has landed with nothing to say.
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The rule survives (the queue card draws only when there is something to say, never an
        # empty amber card). bb5b9b7e (UI-009) removed the `walls.length > 0 || limits?.unread ===
        # true` arms from the section `v-if`, so the old whole-condition anchor is dark; the first
        # two lines are unchanged. The plant widens the queue half back to plain `view !== null`,
        # keeping every other arm so the row isolates its own defect. Killed by
        # `persons-queue.dom.test.ts`.
        [
            (PANEL, '      (view !== null &&\n        (rows.length > 0 || view.partial || view.stale || view.noLedger || view.rowsDropped)) ||\n', '      view !== null ||\n'),
        ],
    ),
    (
        "M15 · 🔴 the summons takes the emergency stop's Shift+Tab · drawn after the stop it becomes "
        "the last focusable in the host, so the one keystroke `390` measured now lands on a list of "
        "questions — at exactly the moment somebody is most likely to be reaching for the stop",
        [
            (HOST, '    <PersonsQueue floating @leave="emit(\'close\')" />\n', ""),
            (HOST, "    <SpawnStopLane />\n",
             "    <SpawnStopLane />\n    <PersonsQueue floating @leave=\"emit('close')\" />\n"),
        ],
    ),
    (
        "M16 · ⛔ it travels without leaving the modal · the surface swaps behind an open dialog "
        "with a focus trap on it, so a person presses *take me to it* and stays exactly where they "
        "were, looking at the sheet they pressed it from",
        [(PANEL, "  if (props.floating) emit('leave')\n", "")],
    ),
    (
        "M17 · ⛔ the queue carries its own live region · it is drawn twice — in the corner and on "
        "Home — so every announcement is made twice, and the one channel this dispatch opened for a "
        "summons becomes two channels nobody owns",
        # ⚑ **ANCHOR CORRECTED IN PLACE BY 606, not retired.** ⛔ `EXT-008` §3 moved the in-flow
        # copy off Home, so the value that named a screen was renamed to name what the copy IS —
        # `a-column-name-is-a-claim`. ⚠️ **The SUBJECT is untouched**: this row still adds a second
        # live region to a component drawn twice. Re-verified RED by hand after the correction.
        [(PANEL, '    :data-place="props.floating ? \'overlay\' : \'in-flow\'"\n',
          '    :data-place="props.floating ? \'overlay\' : \'in-flow\'"\n    aria-live="polite"\n')],
    ),
    # ── §5 · Home's arithmetic ─────────────────────────────────────────────────────────────────
    (
        "M18 · 🔴 the live queue goes on claiming the screen is empty · *Nothing needs you.* is "
        "printed directly above a list of questions escalated to a person, which is `304`'s "
        "contradiction arriving through a third population",
        # ⚑ **ANCHOR CORRECTED IN PLACE BY 606, not retired.** ⛔ The condition lost its `seeded`
        # term when `EXT-008` §3 moved the demo seed's rows to the placeholder screen — the group
        # is not on this surface at all — so what is left is the two terms this row is about.
        # ⚠️ **The SUBJECT is untouched**: sever `personsRows === 0` and the live queue claims the
        # screen is empty over a list of questions escalated to a person. Re-verified RED by hand.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The `:alone` claim on
        # `AttentionQueue` moved from `personsRows === 0` to `onlyYou === 0` (`onlyYou = personsRows
        # + asks.length`, D-017's F024 addition of instruction asks), but it is still the same claim
        # about the whole screen. Dropping the population check leaves 'Nothing needs you.' drawn
        # over a live escalated-question list, the exact 304 contradiction this row protects.
        [
            (HOMEVUE, ':alone="onlyYou === 0 && !attention.unread"', ':alone="!attention.unread"'),
        ],
    ),
    (
        "M19 · 🔴 Home does not count them · the header stat, the greeting and the rail's badge all "
        "read *All clear* over a worker frozen on a question only a person can answer — the exact "
        "state `305` spent a dispatch removing, with the population changed",
        # ⚑ **ANCHOR CORRECTED IN PLACE BY 468, not retired.** `468` took `seeded` out of the sum —
        # a placeholder nothing can clear is not work — so the line this row severs is now
        # `live + onlyYou`. ⛔ Same label, same defect, same kill: the population `401` added stops
        # being counted and Home reads All clear over a worker frozen on a person's answer.
        [(HOME, "  const total = live + onlyYou\n", "  const total = live\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The subject was the panel's
        # seeded-placeholder disclosure, and D-016 deleted it. The commit says 'Proposals go end to
        # end, with the demo seed', and its diff removes `seeded` and `andThePlaceholders` from
        # home-attention.ts and deletes demo-seed.ts, PlaceholderBanner.vue, demo-store.ts and their
        # tests. The `intro` arm today ends at 'each is settled on its own card.' with no
        # placeholder clause to fall back to. Its anchor is left stale, so the census records it
        # retired.
        "M20 · ⛔ the panel's sentence falls back to the seeded one · with nothing answerable on "
        "screen and something escalated, a reader is told the rows below are placeholders while a "
        "conversation waits on them",
        # ⚑ **ANCHOR CORRECTED AND RE-AIMED IN PLACE BY 468, not retired** — `453`'s move on
        # `434 M14`, for the same reason. ⛔ The defect was a FALLBACK: with something escalated and
        # nothing answerable, the intro dropped through to the seeded-only sentence. `468` appends
        # the disclosure to every arm and deleted the seeded-only one, so there is no longer a
        # branch to fall through to and the old anchor cannot express the claim.
        #
        # ⚠️ **Same label, same claim, same kill, at the surviving half**: the escalation sentence
        # is severed and `${andThePlaceholders}` is KEPT, so a reader with a worker frozen on their
        # answer is told only that the rows below are placeholders — which is this row's own
        # sentence, reached the other way round.
        [(HOME,
          ARM,
          "            `${andThePlaceholders}`,\n")],
    ),
    # ── §6 · the shell that does the looking ───────────────────────────────────────────────────
    (
        "M21 · 🔴 the route samples the reader's place AFTER the round trip · `095`'s defect, on "
        "this feature's ordinary path: a claim attaches a provider and replays a ledger window, "
        "and a person who pressed ⌘N or went Home while it was in flight has it taken away when "
        "it lands — `showConversation`'s guard compares the state against itself and can never "
        "refuse",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives and
        # the old plant is dead: the `row.held` branch and `select(row.sessionId)` were replaced by
        # `openConversation`, which samples `view()` before the `store.look` await and passes it to
        # showConversation (095's rule). The plant moves `const from = view()` to after the await,
        # so the guard compares the state against itself.
        [
            (SCREEN, '  const from = view()\n  const opened = store.isLive(sessionId) ? sessionId : await store.look(sessionId)\n', '  const opened = store.isLive(sessionId) ? sessionId : await store.look(sessionId)\n  const from = view()\n'),
        ],
    ),
    (
        "M22 · 🔴 a refused look blanks the queue · the store answers `null` when the read did not "
        "happen and the shell writes it in anyway, so a person's list of questions disappears on a "
        "dropped call and comes back on the next one — `M4`'s defect one layer up, where the `null` "
        "was invented precisely so this layer could refuse it",
        [(SCREEN,
          "  if (questions !== null) escalated.value = questions\n"
          "  if (decisions !== null) decided.value = decisions\n",
          "  escalated.value = questions\n  decided.value = decisions\n")],
    ),
    (
        "M23 · ⛔ the announcement interrupts · a question that has already waited thirty seconds "
        "cuts across whatever sentence a person is currently hearing, which is the one register "
        "`ClosingShade` is allowed and this is not",
        [(SCREEN,
          '<div class="only-for-a-reader" role="status" data-cy="persons-queue-announcement">',
          '<div class="only-for-a-reader" role="alert" data-cy="persons-queue-announcement">')],
    ),
    (
        "M24 · ⚠️ the queue is not put back on unmount · the module outlives the component, so a "
        "reload leaves a list of rows pointing at conversations the new store has never heard of "
        "— and every one of them offers to take a person to a card that is not there",
        [(SCREEN, "  persons.forget()\n", "")],
    ),
    (
        "M25 · 🔴 the rail's badge counts two populations of three · `homeAttention`'s third "
        "argument is optional, so the second call site compiles without it — and the Home button "
        "carries no badge at all over a question the screen it opens is listing. ⛔ `304`'s "
        "contradiction, re-created inside the dispatch that cites it, which is where the review "
        "found it ⚑ ANCHOR CORRECTED IN PLACE BY 453 · killed by `work-waiting-on-your-reply-is-drawn-and-counted.dom.test.ts`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `homeAttention`'s third
        # argument is still optional and RuntimeScreen.vue's call site still spells it out as its
        # own field (now `(persons.view.value?.count ?? 0) + (persons.asks.value?.rows.length ??
        # 0)`, widened for F024's asks). Deleting the field reproduces the exact
        # 304-contradiction-inside-the-dispatch-that-cites-it hole a source census exists to catch.
        [
            # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · F097 (a032e58f) wrapped onlyYou over three lines and added the work waiting on a person's reply; the plant still drops the Home badge's onlyYou argument
            # ⚑ **an agent keeps its provider · re-anchored in place, not retired** — the count gained the agents a person has to choose a provider for; the plant still drops the whole count.
            # ⚑ **W4.506 · re-anchored in place, not retired** — the count gained the agents' requests to register an MCP server; the plant still drops the whole count. NOT VERIFIED
            # ⚑ **what waits on a person · re-anchored in place, not retired** — the count gained the to-dos agents asked of a person; the plant still drops the whole count
            # ⚑ **what waits on a person · re-anchored in place, not retired** — the count gained the work no agent moved after being reminded; the plant still drops the whole count
            (SCREEN, "    onlyYou:\n      (persons.view.value?.count ?? 0) +\n      (persons.asks.value?.rows.length ?? 0) +\n      (persons.serverRequests.value?.rows.length ?? 0) +\n      (persons.waitingOnWhoWrote.value?.rows.length ?? 0) +\n      persons.workWaits.value.todos.rows.length +\n      persons.workWaits.value.incidents.rows.length +\n      providersNotChosenIn(agentStore.identities.value).length,\n", ""),
        ],
    ),
    (
        "M26 · 🔴 the announcement cannot be heard from inside a modal · `aria-modal=\"true\"` tells "
        "assistive technology to ignore the rest of the document, so with the shell's region "
        "outside it a screen-reader user is told nothing at all — in exactly the state this "
        "summons is hosted in the overlay layer FOR",
        [(HOST,
          # ⚑ **popups drawn in open order · re-anchored in place, not retired** — the host is drawn into the screen's overlay layer, a level deeper; the plant still takes the announcement out of the modal
          "      <div class=\"only-for-a-reader\" role=\"status\" data-cy=\"overlay-queue-announcement\">\n        {{ persons.view.value?.announcement ?? '' }}\n      </div>\n\n",
          "")],
    ),
    (
        "M27 · ⛔ the overlay's region is populated when it is inserted · a live region that "
        "arrives in the tree already carrying its text is not reliably announced, so the one "
        "sentence this channel exists for is the one it does not say",
        [(HOST,
          '    <div class="only-for-a-reader" role="status" data-cy="overlay-queue-announcement">\n',
          '    <div\n      v-if="(persons.view.value?.count ?? 0) > 0"\n'
          '      class="only-for-a-reader"\n      role="status"\n'
          '      data-cy="overlay-queue-announcement"\n    >\n')],
    ),
    (
        "M28 · ⛔ the live queue goes on making the WHOLE SCREEN's claim · *No conversation is "
        "frozen on a permission or a question* is printed directly above a group listing "
        "questions escalated from conversations this window is not running — two adjacent "
        "sentences, one denying what the other states",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # live queue's empty sentence must not make the whole screen's claim. D-017b reworded the
        # sentence from "No conversation this window is running is frozen..." to "No conversation on
        # this list is frozen...", still a claim scoped to the list, so the plant swaps it for the
        # unscoped sentence on the one-line span.
        [
            (ATTENTIONQUEUE, '      <span v-else>No conversation on this list is frozen on a permission or a question.</span>', '      <span v-else>No conversation is frozen on a permission or a question.</span>'),
        ],
    ),
]
