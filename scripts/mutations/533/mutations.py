"""533 · A wall he finds out about before he hits it.

⛔ **The defect, measured twice from the person's own ledger** (HO-052 §4):

| run | the event, verbatim, non-fatal | occurrences |
|---|---|---:|
| 2026-09-17 | `codex is approaching its rate limit — 99% of a 7-day window used; resets …` | 2 |
| 2026-09-18 | `claude is approaching its rate limit (seven_day); resets …` | 5 |

⚠️ **Both providers hit a weekly wall inside two days of real use and he saw neither.** The only
record was a non-fatal `error` row in a transcript nobody was reading. 🔴 The PO's ruling: *"A
provider limit that will stop his agents working is not a ledger event. It belongs where everything
else that needs him belongs — the queue."*

## ⛔ What these rows are mostly about, and it is not the recogniser

⚠️ **Half of this table is about NOT SAYING SOMETHING FALSE**, because that is where the repair can
go wrong in a way nobody would notice:

 1. **Overstating.** The provider says *approaching*, not *stopped*. A sentence claiming work HAS
    stopped when it has not is `030`/`029`'s defect with the subject changed — and it would read as
    a better warning rather than as a lie.
 2. **The false all-clear.** An empty band claims every provider is still taking work. ⛔ That is
    `086`'s rule on the read where the wrong default is reassuring, and it is the claim `533` §0
    measured this app making silently while both providers had walled.
 3. **Counting a wall as a thing he owes.** `PersonsQueueView.count` is *"a fact, not a badge"*.

## 🔴 And one row exists because the coupling is INVISIBLE

⛔ **M5.** `normalize.ts` in both adapters composes the sentence and `533` §3 puts both files out of
bounds, so this app RECOGNISES their words. ⚠️ **A reword there would make `readProviderLimit`
answer `null` for ever, silently** — standing rule 27's *an instrument that can go quiet without
saying so is not an instrument*. ⚑ The row below plants the drift and requires §2 of the test to
see it.

## ⛔ What this table does NOT cover

 1. **How the providers report it.** `533` §3 puts both `normalize.ts` files out of bounds; nothing
    here edits one, and M5 mutates the RECOGNISER against them rather than the other way round.
 2. **The live poll's cadence.** `LOOK_EVERY_MS` is `401`'s and is pinned by that dispatch's rows.
"""

LIMIT = "apps/desktop/src/shared/provider-limit.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
QUEUE = "apps/desktop/src/renderer/src/lib/persons-queue.ts"
BAND = "apps/desktop/src/renderer/src/components/PersonsQueue.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
# ⚑ **606 · the queue's HOST**, which `EXT-008` §3 moved off Home into its own destination.
# ⛔ Both rows on this constant — `M3` and `M24` — keep their subjects exactly; only the file and
# one indent moved. `correct-a-stale-mutation-anchor-dont-retire-it`, each re-verified RED by hand.
HOME = "apps/desktop/src/renderer/src/components/WaitingOnYou.vue"
USAGE_LIMIT = "apps/desktop/src/renderer/src/lib/usage-limit.ts"

MUTATIONS = [
    # ---- the shipped defect, put back ------------------------------------------------------------
    (
        "M1 · 🔴 THE SHIPPED DEFECT, PUT BACK · the one look stops asking what the providers have "
        "said, so a wall is a row in a ledger again and reaches no surface at all. ⛔ This is `533` "
        "§0 exactly: two runs, two providers, two days, and nobody told",
        [
            (
                SCREEN,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. d74e28699 separated scheduled warning reads and cedea34ef moved them to a dated lane; omit only the same wall-read request, preserving actionable reads.
                "  await lookAtLimits(() => limitsLane.refresh(() => store.readLimitsDisplay()), scheduled)\n",
                "",
            )
        ],
    ),
    (
        "M2 · ⛔ the queue stops drawing for a wall ALONE · nothing is waiting on a person and a "
        "provider has stopped taking work, and the card is not on screen — which is the state this "
        "dispatch exists for and the one the surface could not previously be in",
                # ⚑ **ANCHOR CORRECTED IN PLACE BY 557** — the `v-if` gained the stopped-work band's
                # own two clauses. ⛔ The subject is unchanged: this row still deletes every reason
                # the card draws for something that is not a queue ROW. ⚑ **678 · and again**: the
                # stalled walk's unread rows (F-R18b) are a third such reason, deleted with the rest.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — D-017's R19 added an
        # `an-instruction-ask` clause and wrapped the whole condition in `(view !== null && (...))
        # || ... || (props.floating && asksSaySomething)`, so the old 5-line block plus trailing
        # text no longer matches, but the rule it guards — a wall alone (no rows, no asks) still
        # draws the card — is untouched and is exactly what `533` §0/§2 exists for.
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # UI-009 moved the wall band out of PersonsQueue's card (bb5b9b7e: "The Claude usage warning
        # leaves 'Yours to settle' for the top of the page") but the rule survives on Waiting on
        # you: a wall alone, with nothing owed, must still be drawn. The re-aimed
        # a-wall-he-finds-out-about.dom.test.ts asserts exactly that. The plant gates the band on
        # something being owed, so a wall alone draws nothing. The label still says 'queue/card';
        # the landing agent may reword it. Killed by `a-wall-he-finds-out-about.dom.test.ts`.
        [
            (HOME, '      <ul v-if="walls.length > 0" class="usage" data-cy="persons-queue-walls">', '      <ul v-if="walls.length > 0 && personsRows > 0" class="usage" data-cy="persons-queue-walls">'),
        ],
    ),
    (
        "M3 · ⚠️ …and the same thing one surface up · Home mounts the card only when something is "
        "waiting, so the band is reachable in the overlay and invisible on the screen a person "
        "actually reads. ⛔ Two mounts, two conditions, and only one of them is here",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # UI-009 (bb5b9b7e) moved the limits band off the queue card into Waiting on you's own `<ul
        # class="usage">`, so the old `providersSaySomething` mount gate is gone on purpose. The
        # rule it guarded survives: a wall ALONE (nothing owed, `533` §0's state) must still draw on
        # the page a person reads, so the plant gates the band on owed rows again. Suggested label:
        # "the band is drawn only when something is owed · Waiting on you draws the limits band only
        # beside a row, so a wall alone reaches no screen". Killed by
        # `a-wall-he-finds-out-about.dom.test.ts`.
        [
            (HOME, '      <ul v-if="walls.length > 0" class="usage" data-cy="persons-queue-walls">\n', '      <ul v-if="walls.length > 0 && personsRows > 0" class="usage" data-cy="persons-queue-walls">\n'),
        ],
    ),
    # ---- the fold: provider and window, never the event -------------------------------------------
    (
        "M4 · 🔴 the fold goes back to the EVENT · his five identical claude lines draw five rows "
        "and Codex's climbing percentage draws one per frame. ⚑ §2.3 of the brief: one provider at "
        "one limit is ONE thing a person needs to know",
        [
            (
                LIMIT,
                "export const providerLimitKey = (seen: ProviderLimitSeen): string =>\n"
                "  `${seen.provider} ${seen.window}`",
                "export const providerLimitKey = (seen: ProviderLimitSeen): string =>\n"
                "  `${seen.provider} ${seen.window} ${String(seen.at)}`",
            )
        ],
    ),
    # ---- the instrument that stops the recogniser going quiet -------------------------------------
    (
        "M5 · 🔴 THE PROVIDER REWORDS AND THIS APP GOES QUIET · the recogniser's phrase drifts one "
        "word from what `claude/normalize.ts` composes, so every wall on that provider reads as an "
        "ordinary error, for ever, and nothing else in the app changes. ⛔ Standing rule 27's exact "
        "shape — and the reason the census in §2 of the test reads the adapters' own literals",
        [
            (
                LIMIT,
                "  { phrase: 'is approaching its rate limit', standing: 'about-to-stop' },\n",
                "  { phrase: 'is nearing its rate limit', standing: 'about-to-stop' },\n",
            )
        ],
    ),
    (
        "M6 · ⛔ the wall stops belonging to the name that OPENS the line · a prefix match becomes a "
        "loose one, so *claude reported that codex is rate-limited* is drawn as a wall on CLAUDE. "
        "⚠️ The anchor is what makes a provider's sentence about that provider",
        [
            (
                LIMIT,
                "  const found = PHRASES.find((one) => rest.startsWith(one.phrase))\n",
                "  const found = PHRASES.find((one) => rest.includes(one.phrase))\n",
            )
        ],
    ),
    (
        "M7 · ⛔ the wall is attributed to the WRONG PROVIDER · the roster stops being searched and "
        "the first name in it answers for every line, so Claude's window reads as Codex's and a "
        "person waits out the wrong clock on the wrong provider. ⚑ It is the line that decides "
        "WHOSE wall this is, and a sentence about one provider on another's name is `460` F1's "
        "wrong-identity half with the subject changed",
        [
            (
                LIMIT,
                "  const provider = PROVIDERS.find((one) => said.startsWith(`${one} `))\n",
                "  const provider = said === '' ? undefined : PROVIDERS[1]\n",
            )
        ],
    ),
    # ---- not saying something false --------------------------------------------------------------
    (
        "M8 · 🔴 AN APPROACH IS DRAWN AS A WALL · 99% of a window becomes *Work on Codex has "
        "stopped*, which is a stronger claim than the provider made. ⛔ `030`/`029`'s defect with "
        "the subject changed, and it would read as a better warning rather than as a lie",
        [
            (
                LIMIT,
                "  { phrase: 'is approaching its rate limit', standing: 'about-to-stop' },\n",
                "  { phrase: 'is approaching its rate limit', standing: 'stopped' },\n",
            )
        ],
    ),
    (
        "M9 · ⛔ the sentence stops saying when work comes back · the consequence is drawn and the "
        "one thing a person can act on is gone. ⚑ The PO ruled on the PAIR: *work on this provider "
        "will stop AND here is when it comes back*",
        [
            (
                LIMIT,
                # ⚑ **RE-ANCHORED by `586`** (`HO-080` §2). The sentence is now composed once, for
                # a provider rather than for a wall, so `providerLimitSays` delegates and the words
                # live in `providerConditionSays`. ⛔ **The ROW is unchanged** — the consequence is
                # drawn and the one thing a person can act on is gone — and the PO's ruling it
                # measures is still the PAIR. ⚠️ Corrected rather than retired, and re-verified RED
                # by hand (`correct-a-stale-mutation-anchor-dont-retire-it`).
                "  const returns = providerReturnWords(resets, now)\n"
                "  return `Work on ${PROVIDER_NAME[provider]} ${PROVIDER_LIMIT_SAYS[standing]}.${returns ? ` ${returns}` : \'\'}`\n",
                "  return `Work on ${PROVIDER_NAME[provider]} ${PROVIDER_LIMIT_SAYS[standing]}.`\n",
            )
        ],
    ),
    (
        "M10 · ⛔ a reset the provider never gave is INVENTED · *nothing said when it comes back* "
        "becomes an hour nobody reported. ⚠️ `086` on the read where the wrong default is the "
        "reassuring one — and both adapters make this field optional",
        [
            (
                LIMIT,
                "  if (resetsAt === null) return 'Nothing said when it comes back.'\n",
                "  if (resetsAt === null) return 'It comes back in about an hour.'\n",
            )
        ],
    ),
    (
        "M11 · ⚠️ the measurement comes back into the sentence · *approaching the seven-day limit, "
        "resets on the 23rd* is a FACT and the PO ruled it is not the sentence. ⛔ `HO-050` §3, "
        "third time: name the consequence rather than the measurement",
        [
            (
                LIMIT,
                "  'about-to-stop': 'is about to stop',\n",
                "  'about-to-stop': 'is approaching its limit',\n",
            )
        ],
    ),
    (
        "M12 · 🔴 A WALL THAT HAS ALREADY COME BACK STANDS FOR EVER · a limit observed last week is "
        "still drawn after its window reset, so a person plans around agents that are working. ⛔ "
        "The same false claim this dispatch ends, in the other direction",
        [
            (
                LIMIT,
                "    if (one.resetsAt !== null && one.resetsAt <= now) continue\n",
                "",
            )
        ],
    ),
    (
        "M13 · ⚠️ one card says two things about one provider · *has stopped* and *is about to "
        "stop* are drawn together, because Codex spells its wall and its approach differently and "
        "they do not share a fold key. ⛔ `304`'s contradiction, on one row's subject",
        [
            (
                LIMIT,
                "    .filter((one) => one.standing === 'stopped' || !walled.has(one.provider))\n",
                "",
            )
        ],
    ),
    (
        "M14 · ⛔ an unknown return is treated as an immediate one · a wall the provider said "
        "nothing about sorts above one coming back in an hour. ⚑ `byBlockedSince`'s ruling one "
        "surface over: an unknown age is not an old age, and a `?? 0` is how it gets claimed",
        [
            (
                LIMIT,
                "        (left.resetsAt ?? Number.POSITIVE_INFINITY) -\n"
                "          (right.resetsAt ?? Number.POSITIVE_INFINITY) ||\n",
                "        (left.resetsAt ?? 0) - (right.resetsAt ?? 0) ||\n",
            )
        ],
    ),
    # ---- the read ---------------------------------------------------------------------------------
    (
        "M15 · ⛔ the SQL prefilter stops being the recogniser's own list · it keeps the first "
        "phrase and drops the rest, so Codex's approach — the line off his 2026-09-17 run — is "
        "never even decoded. ⚑ `a-filter-can-blind-the-instrument-that-justifies-it`",
        [
            (
                STORE,
                "  const wallTerms = PHRASES.map((one) => `%${one.phrase}%`)\n",
                "  const wallTerms = PHRASES.slice(0, 1).map((one) => `%${one.phrase}%`)\n",
            )
        ],
    ),
    (
        "M16 · ⚠️ `ledgers` is counted off the ROWS · *how many conversations did you read* becomes "
        "a restatement of how many walls came back, so a read over twelve ledgers that found "
        "nothing reports zero of each. ⛔ `LedgerWalk`'s own rule: the count is the QUERY's",
        [
            (
                STORE,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 12c3d591f derives candidate-ledger count from one wall read; still replace that count with zero, not the decoded wall count.
                "      const ledgers = phase(\n        'count-ledgers',\n        () => new Set(candidates.map((row) => row.session_id)).size,\n      )\n",
                "      const ledgers = 0\n",
            )
        ],
    ),
    (
        "M17 · ⛔ a row this app cannot read is dropped in SILENCE · `150`'s skip, un-counted again "
        "— and `453` made it countable because *a summary may be scoped, a list of obligations may "
        "not*. ⚠️ A wall inside an unreadable payload is a wall nobody is told about",
        [
            (
                STORE,
                # ⚑ **re-anchored in place, not retired**: a kept walls read decodes each row once, and
                # the count is taken where each call selects the walls; still removes only that count.
                "            rowsUnread += 1\n            return []\n          }\n          const wall = row.said\n",
                "            return []\n          }\n          const wall = row.said\n",
            )
        ],
    ),
    (
        "M18 · ⚠️ the read loses its clock bound · every error row this database has ever held is "
        "decoded, twelve times a minute, on the main process — which is the cost the three partial "
        "indexes beside `events_error_idx` exist to refuse. ⛔ And a wall from last year is read",
        [
            (
                STORE,
                "      const since = now - PROVIDER_WALL_LOOKBACK_MS\n",
                "      const since = 0\n",
            )
        ],
    ),
    # ---- the band ---------------------------------------------------------------------------------
    (
        "M19 · 🔴 THE FALSE ALL-CLEAR · a look that has stopped answering draws nothing, so the "
        "band vanishes and a person reads that as *every provider is still taking work*. ⛔ `086` "
        "on the read where the wrong default is the reassuring one",
        [
            (
                QUEUE,
                "  if (limitsForAPerson === null) return lastLookAnswered ? null : { walls: [], unread: true }\n",
                "  if (limitsForAPerson === null) return null\n",
            )
        ],
    ),
    (
        "M20 · ⛔ …and the other direction · a band is drawn before anybody has looked, so an empty "
        "one is claimed on a window four milliseconds old. ⚑ `null` is *nobody has answered yet* "
        "and it is not *no provider has walled*",
        [
            (
                QUEUE,
                "  if (limitsForAPerson === null) return lastLookAnswered ? null : { walls: [], unread: true }\n",
                "  if (limitsForAPerson === null) return { walls: [], unread: !lastLookAnswered }\n",
            )
        ],
    ),
    (
        "M21 · ⚠️ the band is drawn UNDER what a person owes · a walled provider sits below a list "
        "of questions, and it is the stronger fact: a question waits, a wall means the agent he is "
        "about to hand work to will not run",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The 'band above what a person owes' rule survives on the page (the usage band is first in
        # `.attention-list`) and is measured by geometry in a-wall-he-finds-out-about.dom.test.ts
        # §4. The old plant (`v-if="false"` on the PersonsQueue band) did not match the label
        # anyway. This plant hides the top band and draws a copy below the Yours-to-settle group, so
        # the wall sits under the rows. Edits apply in order: the first is counted in the pristine
        # file, the second's `old` is unaffected by it. Killed by
        # `a-wall-he-finds-out-about.dom.test.ts`.
        [
            (HOME, '      <ul v-if="walls.length > 0" class="usage" data-cy="persons-queue-walls">', '      <ul v-if="false" class="usage" data-cy="persons-queue-walls">'),
            (HOME, '        <PersonsQueue />\n      </template>\n', '        <PersonsQueue />\n      </template>\n      <ul class="usage" data-cy="persons-queue-walls" v-if="walls.length > 0">\n        <li\n          v-for="wall in walls"\n          :key="wall.key"\n          class="usage-limit"\n          :data-standing="wall.standing"\n          :data-cy="`persons-queue-wall-${wall.provider}`"\n        >\n          <p\n            class="usage-says"\n            :title="usageTitle(wall)"\n            :data-cy="`persons-queue-wall-says-${wall.provider}`"\n          >\n            {{ usageSays(wall, props.clock) }}\n          </p>\n        </li>\n      </ul>\n'),
        ],
    ),
    (
        "M22 · ⛔ the provider's own words are dropped · the consequence is drawn and the sentence "
        "the adapter composed is gone, so the window, the percentage and the reset are nowhere. ⚑ "
        "`533` §3: this app routes and re-words, it does not re-measure",
                # ⚑ **RE-ANCHORED by `586`** (`HO-080` §2), which made this one `<p>` a `v-for`
                # over every record the provider wrote — `585` measured TWO claude observations
                # about one condition. ⛔ **The ROW is unchanged**: the consequence is drawn and
                # the provider's own sentences are gone, so the window, the percentage and the
                # reset are nowhere. ⚠️ Only its bytes moved
                # (`correct-a-stale-mutation-anchor-dont-retire-it`); re-verified RED by hand.
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The rule survives: the provider's own words are kept, unedited. bb5b9b7e (UI-009) moved
        # them from a drawn `pq-wall-said` paragraph to the plain sentence's `:title` ("with the
        # provider's line on its hover"), built by `usageTitle` in usage-limit.ts. The plant drops
        # `condition.said` from that title, leaving only the exact reset instant so M23's pairing
        # stays untouched. Killed by `a-wall-he-finds-out-about.dom.test.ts`.
        [
            (USAGE_LIMIT, "return [...condition.said, ...(reset === '' ? [] : [reset])]", "return [...(reset === '' ? [] : [reset])]"),
        ],
    ),
    (
        "M23 · ⚠️ the exact instant stops being reachable · the sentence says *in 5 days* and there "
        "is nowhere left for the moment itself, which is the pairing `526` and fourteen components "
        "before it use for a shortened rendering",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The `:title="fullTime(wall.resetsAt)"` on a PersonsQueue `<p>` went with that element in
        # UI-009, but the pairing survives: the plain sentence names only the day and the exact
        # instant now rides on `usageTitle`'s title (`fullTime(condition.resetsAt)`,
        # lib/usage-limit.ts). The plant drops the instant from the title; the dom test strips the
        # provider's own line first so only the exact instant can supply the year '2026'. Killed by
        # `a-wall-he-finds-out-about.dom.test.ts`.
        [
            (USAGE_LIMIT, "  const reset = condition.resetsAt === null ? '' : fullTime(condition.resetsAt)\n", "  const reset = ''\n"),
        ],
    ),
    (
        "M24 · 🔴 A WALL IS COUNTED AS SOMETHING HE OWES · the number a person reads as *how much "
        "do I owe* gains a row nobody can answer. ⛔ `PersonsQueueView.count` is *a fact, not a "
        "badge*, and this is the second half of §2.1's shape argument",
        [
            (
                HOME,
                "const personsRows = computed(() => persons.view.value?.count ?? 0)\n",
                "const personsRows = computed(\n"
                "  () => (persons.view.value?.count ?? 0) + (persons.limits.value?.walls.length ?? 0),\n"
                ")\n",
            )
        ],
    ),
    (
        "M25 · ⛔ the band outlives the look that produced it · a supply that names no walls keeps "
        "the last ones, so a window that stopped reading draws a wall it can no longer see. ⚠️ "
        "That is the staleness `PersonsQueueView.stale` exists to disclose rather than to hide",
        [
            (
                QUEUE,
                "      walls.value = nextLimits ?? NOBODY_HAS_LOOKED_FOR_A_WALL\n",
                "      if (nextLimits !== undefined) walls.value = nextLimits\n",
            )
        ],
    ),
    (
        "M26 · ⚠️ the band and the rows come from two moments · the walls are drawn against the "
        "window's own clock rather than the one the ages beside them use, so a card can say *9 "
        "minutes ago* on one line and measure *in 5 days* from another instant on the next",
        [
            (
                QUEUE,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. cedea34ef added an independently dated display argument, which remains intact. The undated legacy input still uses the same world clock as queue-row ages; replace only that clock with a second reading. The authoritative display deliberately ignores this argument.
                "    providerLimitsView(\n      walls.value.walked,\n      walls.value.lastLookAnswered,\n      world.value.now,\n      walls.value.display,\n    ),",
                "    providerLimitsView(\n      walls.value.walked,\n      walls.value.lastLookAnswered,\n      Date.now(),\n      walls.value.display,\n    ),",
            )
        ],
    ),
    # ---- the clamp, because the clamp is carrying a rule ------------------------------------------
    #
    # ⚑ **`a-line-no-mutation-can-kill-is-not-carrying-its-rule`.** The provider's own line is
    # bounded by FOUR declarations and three of them look like boilerplate around the fourth. ⛔
    # Remove any one and the row goes back to growing with a bucket name this app does not bound.
    (
        # ⛔ **RETIRED BY RULING (landing ui bb5b9b7e…128203e6 (UI-009 to UI-011)):** The provider's
        # own line is no longer drawn under the sentence: `.pq-wall-said` and its
        # `-webkit-line-clamp: 3` are gone from PersonsQueue.vue (0 matches; `git log -S` names
        # bb5b9b7e). UI-009's message: "The Claude usage warning leaves 'Yours to settle' for the
        # top of the page, said plainly ... with the provider's line on its hover"; the dom test
        # notes the clamp measurements "went with it: the line is on the sentence's title now,
        # whole, and no element of it is clamped". `.usage-says` carries no bucket name, so there is
        # nothing left to bound. Its anchor is left stale, so the census records it retired.
        "M27 · ⛔ the provider's line stops being bounded · one account's long bucket name sets the "
        "height of the card, and `526`'s lever — a row's height stopped depending on the size of "
        "the text inside it — is gone",
        [(BAND, "  -webkit-line-clamp: 3;\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing ui bb5b9b7e…128203e6 (UI-009 to UI-011)):** The
        # `.pq-wall-said { display: -webkit-box }` rule was deleted with the provider-line `<p>` in
        # UI-009 (bb5b9b7e, "with the provider's line on its hover"); no clamped element exists on
        # the limits band any more, so there is no box for the clamp to bind to. A new row about
        # `.usage-says` being clipped would be a different defect, not this one re-anchored. Its
        # anchor is left stale, so the census records it retired.
        "M28 · ⚠️ the box goes · the element falls back to `display: block`, so `-webkit-line-clamp` "
        "binds to nothing and the clamp above it is correct and inert. ⛔ A clamp is not one "
        "declaration. ⚑ ANCHOR CORRECTED IN PLACE BY 557",
        # ⛔ **The selector is in the anchor now.** `557` added a second clamped element to this
        # component with the identical recipe, so a bare declaration matches twice —
        # `a-second-function-in-the-same-shape-disarms-a-file-scoped-census`, in CSS.
        [(BAND, ".pq-wall-said {\n  display: -webkit-box;\n", ".pq-wall-said {\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing ui bb5b9b7e…128203e6 (UI-009 to UI-011)):** The
        # `-webkit-box-orient: vertical` / `-webkit-line-clamp: 3` pair belonged to `.pq-wall-said`,
        # removed by UI-009 (bb5b9b7e) when the provider's line moved onto the sentence's hover
        # title. Nothing in PersonsQueue.vue or WaitingOnYou.vue clamps the wall's text now, so the
        # vendor pair has no subject. Its anchor is left stale, so the census records it retired.
        "M29 · ⚠️ the box orients the other way · the clamp counts COLUMNS, so it stops counting "
        "lines and the row grows again. ⛔ The vendor pair is a pair. ⚑ ANCHOR CORRECTED IN PLACE BY 557",
        [
            (
                BAND,
                # ⚑ **The clamp NUMBER disambiguates it** — `557`'s block clamps to 2 and this one
                # to 3, so the pair below is unique to the wall's own rule.
                "  -webkit-box-orient: vertical;\n  -webkit-line-clamp: 3;\n",
                "  -webkit-box-orient: horizontal;\n  -webkit-line-clamp: 3;\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing ui bb5b9b7e…128203e6 (UI-009 to UI-011)):** The `overflow:
        # hidden` it removed sat on `.pq-wall-said`, which UI-009 (bb5b9b7e) deleted along with the
        # displayed provider line. The dom test records it: "the three measurements of the
        # provider's own line drawn under the sentence went with it ... no element of it is
        # clamped", so there is nothing to spill out of a box. Its anchor is left stale, so the
        # census records it retired.
        "M30 · ⛔ the overflow is left visible · the clamp bounds the BOX and the text spills out of "
        "it, so what a person reads is not what the element measures — which is the defect `530` "
        "found on the rail, where every assertion passed over a value that was never on screen. "
        "⚑ ANCHOR CORRECTED IN PLACE BY 557",
        [
            (
                BAND,
                # ⚑ **The selector, for `M28`'s reason.**
                ".pq-wall-said {\n  display: -webkit-box;\n  overflow: hidden;\n  color: var(--faint);\n",
                ".pq-wall-said {\n  display: -webkit-box;\n  color: var(--faint);\n",
            )
        ],
    ),
]
