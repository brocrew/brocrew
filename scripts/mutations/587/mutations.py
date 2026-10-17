"""587 · The plumbing is quieter than the agent — a run of tool calls is one quiet line.

⛔ **`EXT-013` §3, and the defect is an INVERSION rather than untidiness:**

> ***"seven boxes of `mcp__brobot__list_profiles{}` around two sentences of Ada explaining her
> plan."*** 🔴 **The agent's words are the small quiet part and the plumbing is the loud part.**

## ⚑ What the rows below are actually guarding

⚠️ **Three separate claims, and a table that pushed on only one would pass a repair that traded one
for another:**

 1. **The SIZING is the fix** (M8–M10). The quiet line has to be the reference line — `--text-3xs`,
    `--faint`, no border, no fill — and the mark on it has to be a different ink from the line.
    ⛔ **Measured, and it is the finding that surprised this dispatch**: the card's own text was
    ALREADY smaller than the reference (8.5 px and 8 px against 9 px). The BOX was the loudness.
 2. **What may join a run** (M1–M4), and every exclusion is somebody else's ruling — `300`'s Stop,
    `029`'s sub-agent cards, `108`'s workflow tree, and a refusal's POSITION.
 3. **What the line says about what went wrong** (M5–M7), where the hazard is named:
    `an-unenumerated-state-counts-as-success`.

## 🔴 The one a reader should look at first

⛔ **M5 turns the complement into a hand-written list of failures** — `['error', 'failed']` — which
is what every version of this line wants to become. ⚠️ It is green to the eye and it silently
reports `stopped`, `unknown` and `unfinished` as *it went fine*, on the one row a person may never
open. ⚑ The killer drives `runLine` over `TOOL_OUTCOMES` rather than over cases somebody listed.

## ⛔ What this table does NOT cover, said out loud

 1. **That the fold is reached at all.** `transcriptRows` is called from `TranscriptView`'s `rows`
    computed, and a row deleting that call is `299`'s territory, not this one's.
 2. **`ToolEntry` itself.** Every LIVE call is still its card and `248`/`300`/`327`/`462`'s tables
    still guard it — two of them were re-anchored by this dispatch rather than retired, because
    `status` and `took` MOVED and their subjects did not.
 3. **The refusal's own sentence.** `405` composes it and `a-refusal-you-can-see.test.ts` guards it;
    what `587` changed is only that a refusal BREAKS a run, which M4 is about.
"""

RUNS = "apps/desktop/src/renderer/src/lib/tool-runs.ts"
OUTCOME = "apps/desktop/src/renderer/src/lib/tool-outcome.ts"
ROW = "apps/desktop/src/renderer/src/components/ToolRun.vue"

MUTATIONS = [
    # ── §1 · what may join a run, and every exclusion is a ruling ──────────────────────────
    (
        "M1 · ⛔ a LIVE call joins the run · `300`'s Stop — *the one control this app has over a "
        "running command* — goes behind a disclosure triangle, and a turn mid-`Bash` collapses into "
        "a line with nothing pressable on it",
        [(RUNS, "  return toolSettled(item)\n", "  return true\n")],
    ),
    (
        "M2 · ⛔ a call with SUB-AGENTS joins the run · `029`'s own sentence, undone — *burying it "
        "under the parent row's collapsed output would hide exactly the thing 029 exists to "
        "surface* — and a child running for minutes is drawn as a word on a quiet line",
        [
            (
                RUNS,
                "  if (item.subAgents !== undefined && item.subAgents.length > 0) return false\n",
                "",
            )
        ],
    ),
    (
        "M3 · ⛔ a call with a WORKFLOW joins the run · `108`'s tree, same argument, same loss",
        [(RUNS, "  if (item.workflow !== undefined) return false\n", "")],
    ),
    (
        "M4 · 🔴 a REFUSAL stops breaking the span · the row is absorbed into a collapsed line and "
        "loses the only attribution it has. ⛔ `runtime-ipc.ts` measured that there is no call id on "
        "either provider and `transcript.ts` says what the row has instead — *it lets its POSITION "
        "do the rest*. ⚠️ This is the row that restores `587`'s brief as written",
        [
            (
                RUNS,
                "    close()\n    rows.push({ kind: 'item', item, at })\n",
                "    if (item.kind !== 'notice') close()\n    rows.push({ kind: 'item', item, at })\n",
            )
        ],
    ),
    # ── §2 · what the line says about what went wrong ──────────────────────────────────────
    (
        "M5 · 🔴 THE ONE TO READ FIRST — the line shouts on a hand-written list of failures instead "
        "of on the COMPLEMENT of success · `an-unenumerated-state-counts-as-success`, in four "
        "characters. ⛔ `stopped`, `unknown` and `unfinished` go quiet, and a tenth outcome added "
        "tomorrow is silent on the day it lands",
        [
            (
                OUTCOME,
                "  const outcome = toolOutcome(item)\n"
                "  return !TOOL_OUTCOMES_IN_FLIGHT.includes(outcome) && !TOOL_OUTCOMES_DONE.includes(outcome)\n",
                "  const outcome = toolOutcome(item)\n"
                "  return outcome === 'error' || outcome === 'failed'\n",
            )
        ],
    ),
    (
        "M6 · ⚠️ the success set widens by one · `unfinished` — *we stopped watching* — is counted as "
        "plainly done, which is `074`'s false *running…* wearing the opposite costume",
        [
            (
                OUTCOME,
                "export const TOOL_OUTCOMES_DONE: readonly ToolOutcome[] = ['done', 'completed']",
                "export const TOOL_OUTCOMES_DONE: readonly ToolOutcome[] = ['done', 'completed', 'unfinished']",
            )
        ],
    ),
    (
        "M7 · ⛔ the amiss words are CAPPED like the names are · a run with four kinds of trouble in "
        "it says three of them and `+1 more`, so the one thing on this line a person cannot get any "
        "other way is the thing that gets elided (`092` — a cap is never silent, and this is a cap "
        "on the wrong list)",
        [(RUNS, "    Number.POSITIVE_INFINITY,\n", "    NAMES_SPELLED,\n")],
    ),
    # ── §3 · the sizing IS the fix ─────────────────────────────────────────────────────────
    (
        "M8 · 🔴 the line stops matching the reference · `EXT-013` §3.1 says *the size and weight of "
        "`thought · ~434 tokens`* and *do not invent a third weight*; this invents one, and it "
        "invents it in the direction the card was already wrong in · killed by `the-plumbing-is-louder.dom.test.ts`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the head's gap moved to --space-5 in the layout refresh, and --text-5xs now resolves to the same caption size as --text-3xs, so the old plant changed nothing; this one draws the run line a pixel below the reasoning line it must match
        # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
        [(ROW, "  font-size: var(--type-caption);\n  gap: var(--space-5);", "  font-size: calc(var(--text-3xs) - 1px);\n  gap: var(--space-5);")],
    ),
    (
        "M9 · ⛔ the CHROME comes back · a border on the quiet line, which is the declaration that "
        "made seven of these dominate a transcript. ⚑ Written as an addition rather than a removal "
        "because what this dispatch did was DELETE a rule, and a mutation has to put it back · killed by `the-plumbing-is-louder.dom.test.ts`",
        [
            (
                ROW,
                # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the quiet line is now a card of its own, matched to the tool entry's chrome; the plant gives it a louder edge than that card, the chrome that made a run of these dominate a transcript
                "  border: var(--border-width) solid var(--line);\n  background: var(--panel);\n  /* The reasoning",
                "  border: var(--border-width) solid var(--line-strong);\n  background: var(--panel);\n  /* The reasoning",
            )
        ],
    ),
    (
        "M10 · ⛔ the mark takes the line's own ink · *1 failed* stops being distinguishable from the "
        "tally beside it, so the one loud thing on a quiet row goes quiet — which is the inversion "
        "this dispatch exists to delete, reintroduced one element down",
        # ⚑ **Anchor corrected inside this dispatch**: the `flex: 0 0 auto` it quoted was measured
        # to do nothing and was deleted (see M14). The subject — the mark's ink — never moved.
        # ⚠️ **The rule's WHOLE body, because `.amiss {\n  color: var(--waiting);` is also a
        # substring of `.tab.on.amiss {`** — an anchor that matched twice reported APPLY FAILED.
        [(ROW, ".amiss {\n  color: var(--waiting);\n  font-weight: var(--fw-semibold);",
          ".amiss {\n  color: var(--faint);\n  font-weight: var(--fw-semibold);")],
    ),
    (
        "M11 · ⚠️ every tab is in the tab order · a seven-call run becomes seven tab stops and a "
        "transcript with forty calls in it becomes forty, which is `587` §4.1's question answered "
        "the wrong way round",
        [(ROW, ':tabindex="index === tab ? 0 : -1"', ':tabindex="0"')],
    ),
    (
        "M12 · ⛔ the cut names stop being recoverable · the `title` goes, and the tool names a "
        "browser ellipsised at the pane's floor width are gone for good (`531`'s standard, and the "
        "row the clipped-text ledger admitted this component under)",
        [(ROW, '      :title="whole"\n', "")],
    ),
    (
        "M13 · 🔴 `330`, undone · the memory word leaves the quiet line and survives only inside the "
        "expanded panel, so a person is back to inferring a memory write from unlabelled rows — "
        "which is the state `330` was dispatched to end, restored by a collapse nobody asked to "
        "restore it",
        [(RUNS, "  const memory = calls.some((call) => call.memoryPath !== undefined)\n", "  const memory = false\n")],
    ),
    (
        "M14 · ⛔ the names stop being the part that gives way · without `min-width: 0` a flex item "
        "will not shrink below its own content, so the line stops ellipsising and starts OVERFLOWING "
        "— and the head, which may never be what shortens, is what goes off the edge instead. "
        "⚑ **This row replaced TWO that could not be killed.** A first draft mutated `.label`'s "
        "`flex: 0 0 auto`; measured, neither that declaration nor `.amiss`'s did anything, because "
        "`.detail` spends the whole shrink before either is asked to move — both were DELETED "
        "rather than guarded (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`). A second "
        "draft mutated `.detail`'s `min-width: 0`, which is ALSO inert: `overflow: hidden` already "
        "resolves the automatic minimum size to zero. ⛔ `overflow` is what was measured RED",
        [(ROW, "  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n", "  text-overflow: ellipsis;\n  white-space: nowrap;\n")],
    ),
]
