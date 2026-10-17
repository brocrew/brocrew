"""514 · a tick that a force-stop also earns — each row is THE DEFECT, put back (131).

⛔ **The field report, verbatim** (`HO-038` §5.1, the PM writing to the PO):

> ⚠️ **And one thing I am telling you rather than swallowing.** `quit:check` passed — 2,092 ms
> against a 5,000 ms budget — **but printed a line I have not seen in five gates:**
> ⛔ *"Electron did not exit on its own; the last resort stopped it."*
> 🔴 **The part I would want ruled eventually:** if the last resort is what stopped it, then **a
> genuine future hang also prints `✔` inside budget.**

⚑ **Twelve response documents had printed it by the day this landed** — `363`, `366`, `385`, `409`, `428`, `429`, `448`, `452`, `477`, `492`, `509` and `513` —
and **each argued in its own prose that the tick still meant what a tick usually means.**
⚠️ `509`'s was inside budget at 2,146 ms of 5,000 on a run averaging load 92; `452` rebuilt bare
`main` to prove the line was not its own.

## ⚠️ What is CORRECT here and therefore carries no row

⛔ **`294`'s ruling is not reversed and no row reverses it.** The last resort firing is REPORTED,
never failed: bare Electron 43.2.0, twenty lines with one window and no BroBot code, hangs in 5 of
6 loaded quits, and *"failing the run when the bound does its job would put the flakiness straight
back, this time on the fix."* ⚑ **Both cells of this vocabulary are GREEN**, `M9` is the row that
puts the failure back, and it is a defect rather than a policy.

⛔ **The `✔` on the clean cell is correct and is not mutated away.** Every reader of this gate
already greps for it; after `514` that grep answers the right question instead of the nearly-right
one. `M1` is the row that lets the stopped cell wear it too.

## ⛔ The four properties these rows guard

 1. **The two outcomes differ at the TOKEN** — `M1`, `M2`, `M8`. A vocabulary whose cells agree on
    the mark, on the word, or on the position carries no information at all, which is the state
    this dispatch found: the line was identical for its whole length and differed only where the
    shorter one ran out.
 2. **The detector reads the APP'S OWN WORDS** — `M5`, `M6`, `M7`, `M10`. The sentence is baked
    into `closerProgram` and printed immediately before `process.kill(target, "SIGKILL")`, so there
    is no stop without it; a detector handed a constant, or matching a spelling the product does
    not print, reports `exited` on every run it will ever make.
 3. **The cell cannot redden a run** — `M9`. `ci` is an `&&` chain and load is a property of the
    machine rather than of the commit.
 4. **`exited` is an absence that was possible to hear** — `M11`. The gate goes red when the app's
    shutdown report is missing; taken before that, `exited` would mean *"nothing the app said
    reached this file"* rather than *"the app said nothing about a last resort"*.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| `M1`-`M4`, `M12` | ⚑ **`scripts/test/quit-verdict.test.mjs` §2**, the closed vocabulary and its distinctness check — and §1's two head equalities |
| `M5` | ⚑ **§1's reconstruction join** (`expect(said).toContain(LAST_RESORT_SAID)`) **and `apps/desktop/test/one-app.test.ts`**, which pins the export line — two projects |
| `M6`, `M7` | ⚑ **§1's plant and its absent-output control** |
| `M8` | ⚑ **§1's `firstDifference` measurement, its two head equalities, and §3's prose-stripped census** |
| `M9`, `M10`, `M11` | ⚑ **§3**, the gate's reach and the two positional orderings |

⛔ **The table was NOT run.** Every row below was applied ALONE, watched go red against the gate
named above, and restored from bytes with a SHA-256 re-check — which is what
`verify-each-mutation-row` is for and is not the same claim as a table run.

⚑ **`M9` is the row `294` named and could not write.** Its own docstring lists *"the last resort
firing is a FAILURE again"* among three deliberate omissions, because *"rows whose only kill is a
live gate are guaranteed survivors"* and `mutate.sh` launches no Electron. 🔴 **Extracting the
verdict into `scripts/lib/` is what makes it killable**: the proposition is now a positional fact
about the gate's source, which the `scripts` project can read without a machine under load.

## ⚠️ What is deliberately NOT here

 * **`--untracked` removed from §4's sweep.** ⛔ **A no-op mutation reports as a survivor.** With
   every reader committed, `git grep` answers identically with and without it; the arm is only
   observable while a reader is uncommitted, which this harness cannot stage. The flag is there
   because the census failed on this dispatch's own new files, and that is the evidence.
 * **Anything that weakens an assertion in `quit-verdict.test.mjs`.** ⛔ A mutation on a census is
   invisible to that census.
 * **A row that makes the GATE print the wrong line at run time.** ⚠️ Nothing in this repository
   runs `app-closes-check.mjs`; it launches a real Electron, and `mutate.sh` runs four vitest
   projects. `M9`-`M11` are source propositions for exactly that reason.
 * **A row on `window:check`'s `✔`.** ⛔ Out of scope by the dispatch (§3) — and unlike this one,
   that token already has a string reader, in `scripts/mutations/241/mutate.sh`.
"""

LIB = "scripts/lib/quit-verdict.mjs"
GATE = "scripts/app-closes-check.mjs"

MUTATIONS = [
    # ── the vocabulary: two cells that must differ ──────────────────────────────────────────────
    (
        "M1 · 🔴 the stopped cell wears the tick again · both outcomes print `quit:check ✔` and the "
        "only difference is a sentence further along the line — the defect exactly as HO-038 "
        "photographed it, with the cell named and carrying no mark of its own",
        [(LIB, "    mark: '⚠️',", "    mark: '✔',")],
    ),
    (
        "M2 · ⛔ the two cells say the same word · `closed` on both, so a reader who has read the "
        "verdict has learned nothing and the grep that distinguishes them is back at the tail",
        [(LIB, "    word: 'STOPPED',", "    word: 'closed',")],
    ),
    (
        "M3 · ⚠️ the phrase four briefs already grep for leaves the stopped cell · `509`, `510`, "
        "`511` and `513` all instruct their agent to search this gate's line for *did not exit on "
        "its own*, and every one of those instructions silently stops matching",
        [
            (
                LIB,
                "    because: 'Electron did not exit on its own; the last resort stopped it',",
                "    because: 'the last resort stopped it',",
            )
        ],
    ),
    (
        "M4 · ⛔ the clean cell claims nothing · the tick goes back to meaning *no warning was "
        "printed* rather than *Electron exited on its own* — an absence carrying the fact, which is "
        "the shape this whole dispatch is about",
        [(LIB, "    because: 'Electron exited on its own',", "    because: '',")],
    ),
    # ── the detector: the app's own words, or nothing ───────────────────────────────────────────
    (
        "M5 · 🔴 the detector matches a spelling the product does not print · one letter of case, "
        "and every run for the rest of this app's life reports `exited` — including the ones where "
        "its own closer sent SIGKILL",
        [
            (
                LIB,
                "export const LAST_RESORT_SAID = 'is being stopped now'",
                "export const LAST_RESORT_SAID = 'is being stopped NOW'",
            )
        ],
    ),
    (
        "M6 · ⛔ the sentence has to BE the whole output · the closer prints one line into a file "
        "the app has been writing to for seven seconds, so an exact match never fires and the "
        "stopped cell becomes unreachable in production while every unit assertion about it holds",
        [
            (
                LIB,
                "  return typeof appOutput === 'string' && appOutput.includes(LAST_RESORT_SAID)\n"
                "    ? 'stopped'\n"
                "    : 'exited'\n",
                "  return typeof appOutput === 'string' && appOutput.trim() === LAST_RESORT_SAID\n"
                "    ? 'stopped'\n"
                "    : 'exited'\n",
            )
        ],
    ),
    (
        "M7 · ⚠️ a lost report reads as a force-stop · the gate's own `read()` answers `''` on "
        "failure, so an unreadable log would announce a stop that never happened — `326` again, an "
        "instrument reporting itself as the product, in the direction that looks alarming",
        [
            (
                LIB,
                "  return typeof appOutput === 'string' && appOutput.includes(LAST_RESORT_SAID)\n",
                "  return typeof appOutput !== 'string' || appOutput.includes(LAST_RESORT_SAID)\n",
            )
        ],
    ),
    # ── the line: where the difference sits ─────────────────────────────────────────────────────
    (
        "M8 · 🔴 the verdict goes back to the end of the line · `294`'s shape restored character "
        "for character — one tick for both outcomes and the reason appended last, which is the "
        "thing five response documents each had to explain",
        [
            (
                LIB,
                "      `quit:check ${cell.mark} ${cell.word} in ${closedIn} ` +\n"
                "      `(budget ${String(budgetMs)}ms) — ${cell.because}`,",
                "      `quit:check ✔ closed in ${closedIn} (budget ${String(budgetMs)}ms)` +\n"
                "      (verdict === 'stopped' ? ` · ⚠️ ${cell.because}` : ''),",
            )
        ],
    ),
    # ── the gate: what it does with the cell ────────────────────────────────────────────────────
    (
        "M9 · 🔴 the gate goes RED on a stopped exit · the row `294` named as a deliberate omission "
        "and could not write, now written: a loaded machine turns a tree with no defect in it red, "
        "which is the same instrument lying in the other direction",
        [
            (
                GATE,
                "  const { head } = quitHeadline({\n"
                "    output,\n"
                "    closedIn: since(processGoneAt),\n"
                "    budgetMs: QUIT_BUDGET_MS,\n"
                "  })\n",
                "  const { head, verdict } = quitHeadline({\n"
                "    output,\n"
                "    closedIn: since(processGoneAt),\n"
                "    budgetMs: QUIT_BUDGET_MS,\n"
                "  })\n"
                "  if (verdict === 'stopped') {\n"
                "    await fail(`⛔ Electron did not exit on its own; the last resort stopped it.`)\n"
                "  }\n",
            )
        ],
    ),
    (
        "M10 · ⛔ the verdict is handed a constant instead of the app's words · every assertion "
        "about the vocabulary still holds and the gate reports `exited` on every run forever — a "
        "door proved correct and never opened",
        [
            (
                GATE,
                "    output,\n    closedIn: since(processGoneAt),",
                "    output: '',\n    closedIn: since(processGoneAt),",
            )
        ],
    ),
    (
        "M11 · ⚠️ the cell is read before the app is known to have spoken · moved above the "
        "shutdown-report refusal and above the graceful door, so `exited` stops meaning *the app "
        "said nothing about a last resort* and starts meaning *nothing the app said reached here*",
        [
            (
                GATE,
                "  const { head } = quitHeadline({\n"
                "    output,\n"
                "    closedIn: since(processGoneAt),\n"
                "    budgetMs: QUIT_BUDGET_MS,\n"
                "  })\n"
                "\n",
                "",
            ),
            (
                GATE,
                "  // 🔴 **The last resort firing is REPORTED, not failed** (294), and the change "
                "is a finding rather\n",
                "  const { head } = quitHeadline({\n"
                "    output,\n"
                "    closedIn: since(processGoneAt),\n"
                "    budgetMs: QUIT_BUDGET_MS,\n"
                "  })\n"
                "  // 🔴 **The last resort firing is REPORTED, not failed** (294), and the change "
                "is a finding rather\n",
            ),
        ],
    ),
    (
        "M12 · ⚠️ the vocabulary stops being frozen · a cell can be edited at run time, so the "
        "closed set is closed only by convention — and the one thing a reader is asked to trust "
        "about this line is that its two words are the only two words",
        [
            (
                LIB,
                "export const QUIT_VERDICTS = Object.freeze({\n",
                "export const QUIT_VERDICTS = {\n",
            ),
            (LIB, "  }),\n})\n", "  }),\n}\n"),
        ],
    ),
]
