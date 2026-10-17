"""586 · A success retracts a wall.

⛔ **`HO-080` §1:** *"A successful turn on a provider retracts that provider's walls."*
⛔ **`HO-080` §1.2:** *"A wall must name what it blocks precisely enough that a success can DISPROVE
it."*
⛔ **`HO-080` §1.3:** *"Claude's routine `status: 'allowed'` is a wall-ending record."*
⛔ **`HO-080` §2:** *"One condition per provider on the surface, stated at the confidence of the
WEAKEST record."*

⚑ **The rows below are about the RULES and the PROPERTIES**, never about the wiring — the compiler
already refuses to let a call go missing, and a row a compiler kills measures nothing.

## 🔴 A · the retraction itself

⚠️ **the person photographed *"Work on Claude has stopped"* at 02:30 and walked past it for days while
Claude answered him.** ⛔ `585` measured why: the read admits only `type = 'error'` rows, so nothing
in this app could ever un-say a wall.

⛔ **`M1` is that world put back** — the retraction never fires, and the band states something false
for as long as the lookback holds the row. ⚑ **`M2` moves the boundary by one millisecond**, which
is the direction that erases a real refusal: a wall and a clear stamped in the same tick are two
frames of one turn whose order this app did not observe, and `>=` reads the `allowed` frame that
PRECEDED the refusal as the later of them.

🔴 **`M3` lets any provider's work clear any provider's wall.** ⚠️ The two accounts are metered
separately and a Codex turn says nothing about Claude — this is the row that makes *per provider*
a measurement rather than a word in a docblock.

⛔ **`M4` drops the window match**, so `allowed (five_hour)` disproves a `seven_day` wall. ⚑ That is
`HO-080` §1.2 exactly: a retraction that cannot be matched precisely is a retraction that clears
walls the provider never spoke about.

🔴 **`M5` retracts `about-to-stop` as well**, which is the ruling read literally and is the one
place this dispatch narrowed it. ⛔ `LimitStanding` writes that standing as *"the window is nearly
spent and the provider is still answering"* — so a completed turn is its sentence coming TRUE.
⚠️ **And the cost is measured rather than argued**: Claude emits `allowed_warning` DURING a turn
that completes seconds later, so this row clears every approach warning within one turn of its
arrival — leaving it visible only while a turn is in flight, which is the one time nobody is reading
the queue. 🔴 `533` §0 exists because both providers hit a weekly wall and that warning was the
thing nobody saw.

## ⚑ B · what the ledger is asked

⛔ **`M6` reads *a turn that ENDED* instead of *a turn that COMPLETED*.** ⚠️ `closed_at IS NOT NULL`
is the cheaper predicate somebody will reach for, and it retracts a wall on the very turn the wall
refused — a failed turn is a turn that got no answer.

🔴 **`M7` removes the skip**, so the retraction read runs on every five-second poll whether or not
anything has walled. ⚑ It is measured by taking the `turn` table away: a read with no walls must
still answer, because it never goes and looks.

⛔ **`M8` stops the all-clear carrying its window into the fold**, which is `M4` arriving from the
database instead of from the rule — the same false retraction, one layer down, and a row that only
`M4`'s killer would otherwise catch.

## ⛔ C · the provider's own word

⚠️ **`M9` drops the window from the record the adapter writes.** ⛔ `rate_limit_info.rateLimitType`
is the only reason this record can be matched precisely at all — a completed turn cannot say which
window it disproves, and without this field neither can the provider's own statement.

🔴 **`M10` makes the promoted record VISIBLE in the transcript.** ⛔ `074` ruled that a routine
heartbeat must not become noise and `HO-080` §1.3 did not touch that half: `rate_limit_event` fires
once or twice per TURN, so a row for it is a row on every turn telling a reader the ordinary thing.
⚑ It was already invisible as `unknown{lifecycle}`; a type change is exactly how that gets lost.

⛔ **`M11` calls the record *the provider working*.** ⚠️ **It is the provider saying it is ABLE to
work, which is not the provider working** — and latching `working` on a heartbeat puts a session
into the busy state with no ending coming, which is `provider_commands`' measured failure and
`tool_inventory`'s.

## ⚠️ D · one condition, at the weakest confidence

⛔ **`M12` stops grouping at all** — one condition per RECORD — so `585`'s two claude rows are
two sentences again. 🔴 The
PO: *"if one wall has no known reset, knowing the other lifts at 04:10 does not tell a person Claude
works at 04:10. Two sentences let them read the reassuring one."* ⚑ It is also the row that restores
two list entries sharing one `:key` and one `data-cy`.

⚠️ **`M13` names the SOONEST reset rather than the latest.** ⛔ A person told *it comes back in 20
minutes* while a second limit lifts in five hours has been told something that is false in twenty
minutes — the reassuring reading of a partial fact.

🔴 **`M14` drops the admission of the unknown**, which is the weakest-confidence rule itself: the
sentence states the reset it knows and stops, and the limit nobody reported a return for disappears
from the words entirely.

⛔ **`M15` keeps only the first record's own line.** ⚑ `585` warned that collapsing the RECORDS
could hide a real second limit, and the PO kept both for that reason — this row collapses them
underneath a sentence that still says there are two.

## ⛔ What this table does NOT cover

 1. **`0040`.** It is a partial index: removing it changes cost and no answer, so a row on it would
    be a survivor by construction (`a-mutation-that-changes-nothing-reports-as-a-survivor`). ⚑ It is
    asserted instead, by name and through `EXPLAIN QUERY PLAN`, in §6 of the killer file.
 2. **`comesBackIn`'s thresholds.** They are `agoWords`' own and `533` owns them; this dispatch
    extracted the fragment and changed no number.
 3. **The Codex arm of `provider_limit_clear`.** There is none — a Codex snapshot below its floor is
    a provider-wide clear, which a completed Codex turn already says. Named as a finding, not built.
"""

LIMIT = "apps/desktop/src/shared/provider-limit.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
CLAUDE = "packages/runtime/src/claude/normalize.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
WORK = "packages/runtime/src/internal/provider-work.ts"

MUTATIONS = [
    # ---- A · the retraction itself -----------------------------------------------------------
    (
        "M1 · 🔴 **nothing ever retracts a wall** · the world `585` measured and the person photographed "
        "at 02:30 — the band states something false for as long as the lookback holds the row",
        [(LIMIT, "    if (retractedBy(one, takingWork)) continue\n", "")],
    ),
    (
        "M2 · ⛔ **the boundary moves by one millisecond** · `>=` reads the `allowed` frame that "
        "PRECEDED a refusal as the later of them, so a real wall is erased by the heartbeat that "
        "came before it in the same tick",
        [(LIMIT, "      one.at > wall.at &&", "      one.at >= wall.at &&")],
    ),
    (
        "M3 · ⚠️ **any provider's work clears any provider's wall** · the two accounts are metered "
        "separately, and a Codex turn says nothing about Claude",
        [(LIMIT, "      one.provider === wall.provider &&\n", "")],
    ),
    (
        "M4 · ⛔ **the window stops being matched** · `HO-080` §1.2 inverted: `allowed (five_hour)` "
        "disproves a `seven_day` wall, which is a retraction clearing walls the provider never "
        "spoke about",
        [
            (
                LIMIT,
                "      (one.window === '' || one.window === wall.window),",
                "      one.window !== undefined,",
            )
        ],
    ),
    (
        "M5 · 🔴 **an approach warning is retracted too** · the ruling read literally — and Claude "
        "emits `allowed_warning` DURING a turn that completes seconds later, so every approach "
        "warning is cleared within one turn of arriving, which is `533` §0 re-committed",
        [(LIMIT, "  wall.standing === 'stopped' &&\n", "")],
    ),
    # ---- B · what the ledger is asked ---------------------------------------------------------
    (
        "M6 · ⛔ **a turn that ENDED counts as a turn that ANSWERED** · the cheaper predicate, and "
        "it retracts a wall on the very turn the wall refused",
        [
            (
                STORE,
                "      WHERE t.end_reason = 'completed' AND t.closed_at > ?",
                "      WHERE t.closed_at IS NOT NULL AND t.closed_at > ?",
            )
        ],
    ),
    (
        "M7 · 🔴 **the retraction read runs on every poll** · five seconds, whether or not anything "
        "has walled — the cost this guard exists to refuse, on the path `533` already narrowed "
        "three ways before parsing a single payload",
        [(STORE, "    if (walls.length === 0) return []\n", "")],
    ),
    (
        "M8 · ⚠️ **an all-clear loses its window on the way out of the database** · `M4` arriving "
        "from the SQL instead of from the rule: every clear becomes provider-wide",
        [
            (
                STORE,
                "      window: row.window ?? '',",
                "      window: '',",
            )
        ],
    ),
    # ---- C · the provider's own word ----------------------------------------------------------
    (
        "M9 · ⛔ **the record the adapter writes carries no window** · `rateLimitType` is the only "
        "reason the provider's own statement can be matched precisely, and without it this record "
        "says no more than a completed turn does",
        [
            (
                CLAUDE,
                "    window: typeof info['rateLimitType'] === 'string' ? info['rateLimitType'] : '',",
                "    window: '',",
            )
        ],
    ),
    (
        "M10 · 🔴 **the promoted record becomes VISIBLE** · `074`'s ruling is untouched by "
        "`HO-080` §1.3 — `rate_limit_event` fires once or twice per TURN, so a row for it is a row "
        "on every turn telling a reader the ordinary thing",
        [
            (
                TRANSCRIPT,
                "    case 'provider_limit_clear':\n      return\n",
                "    case 'provider_limit_clear':\n      notice(state, 'info', `${event.window} is not limiting work`)\n      return\n",
            )
        ],
    ),
    (
        "M11 · ⛔ **the heartbeat is called *the provider working*** · it is the provider saying it "
        "is ABLE to work, and latching `working` on it puts a session into the busy state with no "
        "ending coming — `provider_commands`' measured failure",
        [
            (
                WORK,
                "  'tool_result',\n])",
                "  'tool_result',\n  'provider_limit_clear',\n])",
            )
        ],
    ),
    # ---- D · one condition, at the weakest confidence ------------------------------------------
    (
        "M12 · ⛔ **two records become two sentences again** · `585`'s screenshot restored, "
        "including two rows sharing one `:key` and one `data-cy` — and the PO's reason: *two "
        "sentences let them read the reassuring one*",
        [
            (
                LIMIT,
                "  return [...byProvider.entries()].map(([provider, group]) => {",
                "  return walls.map((only) => {\n    const [provider, group] = [only.provider, [only]]",
            )
        ],
    ),
    (
        "M13 · ⚠️ **the sentence names the SOONEST reset** · a person told *it comes back in 20 "
        "minutes* while a second limit lifts in five hours has been told something that is false "
        "in twenty minutes",
        [(LIMIT, "  const last = Math.max(...known)", "  const last = Math.min(...known)")],
    ),
    (
        "M14 · 🔴 **the unknown is no longer admitted** · the weakest-confidence rule itself: the "
        "sentence states the reset it knows and the limit nobody reported a return for disappears "
        "from the words",
        [(LIMIT, "  if (unknown === 0) return comesBackWords(last, now)", "  return comesBackWords(last, now)")],
    ),
    (
        "M15 · ⛔ **only the first record's own line survives** · `585` warned that collapsing the "
        "RECORDS could hide a real second limit, and this collapses them underneath a sentence "
        "that still says there are two",
        [(LIMIT, "      said: group.map((one) => one.said),", "      said: [group[0]!.said],")],
    ),
]
