"""617 · the wall nothing on screen says.

⛔ **`HO-080` §4:** ⚑ ***"That signal exists to answer* is anything happening. *A wall is the one
condition where the answer changes from* yes *to* no *and nothing else on screen says so."***
🔴 **And the sharpest half, which is what makes every row below worth writing:** ⛔ ***"the person, who
is watching for exactly this, did not see it. A person who is specifically looking for a condition
and misses it has proven the SURFACE, not their attention."***

## 🔴 The property every row here is pointed at

⛔ **A wall reaches the rail, it reaches it as the PROVIDER reported it, and the absence of the
clause means exactly one thing.** ⚑ The line is the only place a person meets this fact while they
are not on Home, so each of those three can fail on its own and each failure reads perfectly: a
clause that is missing, a clause that claims a stop nobody reported, and a clause whose silence
could mean *nothing stopped* or *we never asked*.

## ⚑ Four claims

 1. **Only what the PROVIDER called a stop reaches the line** (M1–M2). ⛔ `A_STANDING_STOPS_WORK` is
    exhaustive over `LimitStanding`, and both arms are load-bearing in opposite directions.
 2. **An unread look is MARKED, never read as an all-clear** (M3–M5). 🔴 `533` §0 is this app
    saying nothing while both providers had walled; these are the ways it could say nothing again.
 3. **The words are the app's** (M6–M8). ⚠️ The provider comes from the capability table, two
    providers are one clause, and the return time stays off a 187px line.
 4. **A person can SEE it** (M9–M11). ⛔ The clause is drawn, it is drawn in the summons register,
    and the rail is told about walls at all.

## 🔴 The one a reader should look at first

⛔ **M1 flips `about-to-stop` to a stop.** ⚑ Nothing throws and the line reads well — it says
*Claude stopped* while Claude is still answering, which is the claim `LimitStanding` refuses in its
own docblock (*"the window is nearly spent and the provider is still answering"*) and which
`586`/`HO-080` §1 built a whole retraction rule to avoid making. ⚠️ **It is the failure a person
cannot detect**, because the sentence is exactly the one they would see if it were true.

## ⛔ What this table does NOT cover, said out loud

 1. **What a wall IS, how it folds, and when it is retracted** — `533`, `585` and `586` own
    `provider-limit.ts`, and `a-wall-he-finds-out-about` and `a-success-retracts-a-wall` are its
    tables. ⚑ Every row here takes the band's own `ProviderLimitsView` as given.
 2. **The band on Home.** ⛔ `HO-080` §4 left it exactly as it was — *"the band can keep the
    detail"* — and `619` is in `persons-queue.ts` and `PersonsQueue.vue`.
 3. **The two COUNTS.** ⚠️ `571`'s rows own the cells; the only count row here is the one that
    proves a wall did not become a third scope, and that is asserted rather than mutated —
    `WHAT_A_READING_COUNTS` is pinned by the compiler.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| M1–M2 | `apps/desktop/test/the-counts-nobody-can-see.test.ts` §7.2 · only `stopped` reaches the line |
| M3–M5 | `…the-counts-nobody-can-see.test.ts` §7.4 · an unread look is marked |
| M6–M7 | `…the-counts-nobody-can-see.test.ts` §7.1, §7.3, §7.6 · the words, and the neutrality census |
| M8 | `…the-counts-nobody-can-see.test.ts` §7.5 · the return is on the hover |
| M9–M11 | `…dom/the-counts-nobody-can-see.dom.test.ts` · 617 · drawn, coloured, and reached |

⛔ **Evidence, and it is the method rather than a claim.** Every row was applied ALONE, its killer
file run, and the tree restored from the bytes kept before the edit —
`verify-each-mutation-row-without-running-the-table`. ⚠️ **The whole table has NOT been run under
the driver**, so `CENSUS.md` records it `unrun` and no verdict is claimed here. ⚑ Each red was
checked for the RIGHT reason: the output was searched for `SyntaxError`, `Transform failed` and
`error TS`, because a row red on a parse error measured nothing (`452 M8`).
"""

SIGNAL = "apps/desktop/src/renderer/src/lib/live-signal.ts"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"

MUTATIONS = [
    # ── §1 · only what the PROVIDER called a stop ──────────────────────────────────────────────
    (
        "M1 · 🔴 **AN APPROACH IS DRAWN AS A STOP** · the rail says *Claude stopped* while Claude is still answering. ⛔ `LimitStanding`'s own words for this arm are *\"the window is nearly spent and the provider is still answering\"*, so the answer to *is anything happening* is still yes. ⚑ Nothing throws and the sentence is exactly the one a person would see if it were true — and `586` built a retraction rule precisely so a wall is never stated past the provider's word",
        [(SIGNAL, "  'about-to-stop': false,", "  'about-to-stop': true,")],
    ),
    (
        "M2 · ⛔ a reported wall reaches nothing · the other arm, and the whole of `HO-080` §4 gone. ⚠️ SEPARATE from M1 because a repair that swapped the two would pass a test asserting only that the arms DIFFER — `a-comparison-tested-where-both-sides-agree-measures-nothing`",
        [(SIGNAL, "  stopped: true,\n}", "  stopped: false,\n}")],
    ),
    # ── §2 · an unread look is MARKED ──────────────────────────────────────────────────────────
    (
        "M3 · 🔴 **NOBODY HAS LOOKED READS AS AN ALL-CLEAR** · `providerLimitsView` answers `null` before the first look, and this makes that silence. ⛔ `533` §0 is this app saying nothing while both providers had walled; `086`'s rule is that the wrong default on this read is a false all-clear",
        [(SIGNAL, "  const short = limits === null || limits.unread", "  const short = limits !== null && limits.unread")],
    ),
    (
        "M4 · ⚠️ a look that stopped answering draws nothing at all · the condition is returned only when a wall is standing, so *we could not find out* hides inside *it does not hold*. ⛔ That is the two-meanings-for-one-absence this module refuses for a counted zero, one subject over",
        [(SIGNAL, "  if (walls.length === 0 && !short) return null", "  if (walls.length === 0) return null")],
    ),
    (
        "M5 · ⛔ the mark comes off the clause · a known wall under a failed look then reads as the whole answer — *Claude stopped* with nothing saying that whether anything ELSE stopped is no longer being read. ⚑ SEPARATE from M4: this arm survives when a wall is standing, which is the arm M4 cannot reach",
        [(SIGNAL, "    drawn: `${BETWEEN_CELLS}${says}${short ? '*' : ''}`,", "    drawn: `${BETWEEN_CELLS}${says}`,")],
    ),
    # ── §3 · the words are the app's ───────────────────────────────────────────────────────────
    (
        "M6 · 🔴 the provider is typed as a literal · `provider-neutrality-does-not-see-display-text` exactly: the neutrality census reads capability tables and a display string naming one provider passes it. ⛔ Codex then walls and the rail says Claude — and the day a third provider lands, it has no name here at all",
        [(SIGNAL, "  const names = providers.map((one) => providerName(one))", "  const names = providers.map(() => 'Claude')")],
    ),
    (
        "M7 · ⚠️ two walled providers become a list a reader has to count · *Codex, Claude stopped* instead of *Codex and Claude stopped*. ⛔ The separator is already `BETWEEN_CELLS` on this line, so a comma makes the clause ambiguous with a cell — `provider_commands`' rule that a reader counting separators is the failure",
        [(SIGNAL, "  return names.length <= 1 ? last : `${names.slice(0, -1).join(', ')} and ${last}`", "  return names.length <= 1 ? last : `${names.slice(0, -1).join(', ')}, ${last}`")],
    ),
    (
        "M8 · ⛔ the return time never reaches the hover · the band's own sentence — *Work on Claude has stopped. It comes back in 3 hours.* — stops travelling, and the rail's title says only what the line already says. ⚑ `HO-080` §4 left the DETAIL with the band; a hover that carries none of it makes the rail a dead end for the one question a walled person has",
        [(SIGNAL, "      ...(stopped?.said ?? []),", "")],
    ),
    # ── §4 · a person can SEE it ───────────────────────────────────────────────────────────────
    (
        # ⚑ **Anchor CORRECTED before this table was ever censused** — `prettier` folded the
        # attribute onto the `<span>`'s own line after the row was written, so the row went
        # `anchor-absent` on its first regeneration. ⛔ The SUBJECT did not move: this is
        # `correct-a-stale-mutation-anchor-dont-retire-it`, and the row was re-verified RED by hand
        # against the corrected bytes rather than retired.
        "M9 · 🔴 **THE CLAUSE IS COMPOSED AND NEVER DRAWN** · `line` still carries it, so the `title` is right and every assertion that reads the view passes. ⛔ What a person sees is the counts alone — the exact defect `HO-080` §4 was written about, with the fact now computed and thrown away",
        [(RAIL, '<span v-if="liveSignal.stopped" class="rail-live-stopped"', '<span v-if="false" class="rail-live-stopped"')],
    ),
    (
        "M10 · ⚠️ the clause is drawn in the line's own ink · `--faint` beside `--faint`, which is a condition that has to be READ rather than one that stops a scan. ⛔ `textContent` is identical, so only a resolved colour says otherwise — and *a person who is specifically looking for a condition and misses it has proven the surface*",
        [(RAIL, ".rail-live-stopped {\n  color: var(--waiting-text-label);", ".rail-live-stopped {\n  color: var(--faint);")],
    ),
    (
        "M11 · ⛔ the rail is never told about a wall · the prop goes and the line falls back to its default, which is `null` — *nobody has looked* — so every rail in the app draws the unread mark for ever. ⚑ It is the wiring row, and it fails LOUDLY rather than quietly, which is the direction this shape was chosen for",
        [(SCREEN, '        :limits="persons.limits.value"\n', "")],
    ),
]
