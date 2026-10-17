"""345 · Eight reds that are all the instrument — and the guard that could not see any of them.

⛔ **`310` shipped `'[data-cy=' + cy + ']'` into `smoke:ui` step 31 and `pnpm run ci` went green.**
The `097` walk refuses a hook assembled at runtime — *"a check that cannot run must not look like one
that passed"* — so the step threw before its first assertion, for two days, and the thing that found
it was `342`'s live batch: the first live run in thirty-five dispatches.

⚠️ **The two tests that existed could not have.** `tab-flow.test.mjs` checks the walk's LOGIC and
`tab-flow.reach.test.mjs` checks its hook table against the `.vue` sources; neither reads
`ui-live-smoke.mjs`. ⚑ **A guard is only as live as its cheapest execution site**, and `smoke:ui`
needs an on-screen window for sixteen-odd steps, so it can go on no hook and no timer.

## ⚑ What each row is defending

| rows | the defect |
|---|---|
| `M1`-`M5` | ⛔ **the guard itself** — the node-side correction without which it is 17 false alarms, and the rules that keep it off the repo's own prose |
| `M6` | 🔴 **310's line restored** in the instrument. ⚠️ **`project-sheet-probe.mjs` got the same repair and has NO row**: it runs no walk, so the guarded set correctly excludes it and nothing can redden on it — the fix there is hygiene against the day it adopts the walk, and it is unenforced by design |
| `M7`-`M10` | ⚠️ **step 7's whitelist** — three names dropped, one invented. ⛔ **No row touches the DERIVATION**: it lives in the test file, where a mutation could only make the test weaker and would record as a survivor |
| `M11`-`M15` | ⛔ **the host's tripwire** — the output thrown away again, the sweep unbound from the words it greps for |
| `M16`-`M21` | ⚠️ **the refusal that named one cause for six** |

## 🔴 What this table deliberately does NOT contain, and it is the same statement 310 made

⛔ **No row on step `1b2`'s or step `66`'s assertions.** `scripts/ui-live-smoke.mjs` is executed by
no vitest project (`277`'s `NO-ROWS.md`, `241 M10`, `275 M28`), so a row that rewrote what those
steps assert would record as a SURVIVOR and mean nothing —
`a-line-no-mutation-can-kill-is-not-carrying-its-rule`, pointed at a table instead of at a guard.

⚑ **What DID become killable in this dispatch is worth saying, because it is new.** `345` adds two
`ci` tests that read the smoke's own SOURCE, so for the first time the instrument's **hook shapes**
(`hook-reach.test.mjs`) and its **event whitelist** (`event-vocabulary.test.mjs`) can be reddened
from `pnpm run ci`. `M6` and `M7`-`M10` are rows that could not have existed before this dispatch.

⚠️ **And step `38` has no row either, deliberately.** `342` lost it to a harness refusal, not to a
quit defect — the app's own database from that run reads `ended`, 14/14 provider frames archived and
no `-wal` sidecar. What `345` repairs is that the refusal named ONE of at least six causes; which
cause it actually was is a measurement only a live run can make, and that is its own number.

## ⚑ ANCHOR CORRECTED IN PLACE BY 420 — `M6`, and why it MOVED rather than retired

⛔ **`M6`'s original address is gone, and not because the code moved.** It sat on step 31's Half A2
— the `profile-select` / `new-profile-name` block — and `417` deleted the launcher's whole settings
surface (HO-022 §2), so `420` reported that half NOT PERFORMED and its body went with it. ⚠️ **A
removed anchor is not a removed rule.** The `097` walk still refuses a hook assembled at runtime,
`hook-reach.test.mjs` still runs `builtHookViolations` over all three instruments, and this file
still crosses the node/page boundary at ninety-odd sites — so the row is re-aimed at one of them
rather than retired.

⚑ **The new address is `startSession`'s own send guard**, which is the most load-bearing page-side
read left in the file: every launch goes through it. The mutant is `310`'s helper, character for
character in shape — a `(cy) => document.querySelector('[data-cy=' + cy + ']')` — and the killer is
unchanged (`scripts/test/hook-reach.test.mjs`, *"builds no hook the walk cannot read"*).

⚠️ **This table is `unrun`, so the suffix costs it no run state** — there is no artefact for the
correction to invalidate. On a `complete` table it would have moved the whole table to
`partial-or-invalid`, which is `211`'s measurement and `224`'s cost in this same dispatch.
"""

TAB = "scripts/lib/tab-flow.mjs"
SMOKE = "scripts/ui-live-smoke.mjs"
RESUME = "scripts/resume-live-smoke.mjs"
PROBE = "scripts/project-sheet-probe.mjs"
OWNED = "scripts/lib/owned-process.mjs"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

MUTATIONS = [
    # ── the guard itself ───────────────────────────────────────────────────────────────────────
    (
        "M1 · ⛔ THE CORRECTION THAT MAKES IT A CHECK · the node-side holes stop being modelled, so "
        "every ordinary `'[data-cy=\"${cy}\"]'` reads as a hook built at runtime. ⚠️ **Measured at "
        "345 with every other rule of the guard left in place: 17 reports across the three guarded "
        "instruments, and after this dispatch every single one of them is wrong** — a guard that "
        "reddens 17 correct lines is one somebody switches off in a week",
        [(TAB, "unreadableSelectorIn(asEvaluated(line))", "unreadableSelectorIn(line)")],
    ),
    (
        "M2 · 🔴 THE GUARD REPORTS NOTHING · `builtHookViolations` answers the empty list for every "
        "input, which is exactly what a clean tree looks like — the failure mode this whole dispatch "
        "is about, reproduced inside the thing that fixes it",
        [(TAB, "  return found\n}", "  return found.slice(0, 0)\n}")],
    ),
    (
        "M3 · ⛔ the comment skip goes · this repo's own prose ABOUT this defect — two lines quoting "
        "`'[data-cy=' + section + ']'` in `ui-live-smoke.mjs`, and the walk's own explanation in "
        "`tab-flow.mjs` — fails the guard, and a guard that reddens on its own documentation is one "
        "somebody switches off",
        [
            (
                TAB,
                "    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return",
                "    if (trimmed.startsWith('/*')) return",
            )
        ],
    ),
    (
        "M4 · ⚠️ the hole stands for something that is not a hook NAME · `[data-cy=\"${cy}\"]` "
        "becomes `[data-cy=\"\"]`, which fails `HOOK_NAME`, so modelling the interpolation stops "
        "helping and every quoted read is reported again",
        [(TAB, "const HOLE_STANDS_FOR = 'x'", "const HOLE_STANDS_FOR = ''")],
    ),
    (
        "M5 · ⚠️ the brace balance becomes a stop at the first `}` · a nested hole leaves its tail "
        "behind and turns a correct line into a violation, which is the direction this guard must "
        "never be wrong in — ⛔ **and it is only visible under an OWNED prefix**: `[data-cy=\"${a ? "
        "b : { c: 1 }.c}\"]` reads the same both ways, because the leftover `x.c}` is waved through "
        "by the literal-head rule. The fixture that kills this is the `injected-` one, and 345's "
        "first attempt used the ordinary prefix and watched the row survive",
        [
            (
                TAB,
                "      if (here === '{') depth += 1\n      else if (here === '}') depth -= 1",
                "      if (here === '}') depth -= 1",
            )
        ],
    ),
    # ── 310's line restored ────────────────────────────────────────────────────────────────────
    (
        "M6 · 🔴 THE FINDING, VERBATIM · `310`'s helper is put back into the smoke — the state the "
        "tree was in for two days while `pnpm run ci` reported green — ⚑ **this row could not have "
        "existed before this dispatch**, because nothing read this file "
        "⚑ ANCHOR CORRECTED IN PLACE BY 420",
        [
            (
                SMOKE,
                "      const box = document.querySelector('[data-cy=prompt-input]')\n"
                "      const button = document.querySelector('[data-cy=send-prompt]')",
                "      const at = (cy) => document.querySelector('[data-cy=' + cy + ']')\n"
                "      const box = at('prompt-input')\n"
                "      const button = at('send-prompt')",
            )
        ],
    ),
    (
        "M7 · 🔴 THE LAG, RESTORED · `scheduled_work` leaves the list again — the type whose ONLY "
        "on-screen representation is this very log, so step 7 is the surface most likely to meet it "
        "first and call the app strange for it",
        [(SMOKE, "      'scheduled_work',\n", "")],
    ),
    (
        "M8 · ⚠️ the lag in the other direction · a name no event can carry is permitted, so the "
        "whitelist grows a hole nothing can ever fill and the equality that catches a DELETED type "
        "stops holding",
        [(SMOKE, "      'memory_recall',", "      'memory_recall',\n      'memory_reconsidered',")],
    ),
    (
        "M9 · ⛔ `provider_commands` goes · published once whenever a conversation opens, so it is "
        "in the log of essentially every session this run makes — the single most likely of the "
        "seven to turn the next live batch red about the app",
        [(SMOKE, "      'provider_commands',\n", "")],
    ),
    (
        "M10 · ⚠️ the APP-AUTHORED half of the vocabulary · `memory_loaded` leaves the list, and it "
        "is the half `transcript.test.ts` says *\"was possible to forget\"* precisely because it has "
        "no runtime array to derive from — it is read off the arms of the `TranscriptEvent` union or "
        "it is not read at all",
        [(SMOKE, "      'memory_loaded',\n", "")],
    ),
    # ── the host's tripwire ────────────────────────────────────────────────────────────────────
    (
        "M11 · 🔴 THE 342 FINDING, RESTORED · the app's stdout and stderr go back to `/dev/null`, so "
        "F6's only tripwire — a `console.error` in the MAIN process, which is on no CDP target — is "
        "unobservable by every live run again and a clean ordering negative means nothing",
        [(SMOKE, "      stdio: ['ignore', appLog, appLog, 'ipc'],", "      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],")],
    ),
    (
        "M12 · ⛔ the same, in the ONE suite that really falsifies ordering · `smoke:resume`'s step 7 "
        "walks the ordinals across the quit seam, and it was deaf to the app's own alarm about the "
        "same question",
        [(RESUME, "      stdio: ['ignore', appLog, appLog],", "      stdio: 'ignore',")],
    ),
    (
        "M13 · 🔴 THE CONTROL THAT CANNOT MATCH · the host's sentence is reworded, so both sweeps go "
        "on greping for words nothing writes and report a permanent all-clear — "
        "`a-negative-is-only-as-strong-as-the-search-shape`, in the place it costs most",
        [(HOST, "`runtime session ${session.id}: ordinal ${message.ordinal} went out after `", "`runtime session ${session.id}: ordinal ${message.ordinal} was published after `")],
    ),
    (
        "M14 · ⚠️ `smoke:resume` captures and never reads · exactly `packaged-smoke.mjs`'s state, "
        "which 345 named and did not fix: the bytes are on disk and no step looks at them",
        [
            (
                RESUME,
                "      const outOfOrder = said.split('\\n').filter((line) => /went out after/.test(line))",
                "      const outOfOrder = []",
            )
        ],
    ),
    (
        "M15 · ⚠️ the sweep stops saying how much it read · *\"0 out-of-order publishes\"* is what a "
        "healthy run says AND what a run that captured nothing says, and the byte count is the only "
        "thing that tells them apart",
        [
            (
                SMOKE,
                "    `  host log: ${hostSaid.read} file(s), ${hostSaid.bytes} B of host log swept · ` +",
                "    `  host log: ` +",
            )
        ],
    ),
    # ── the refusal that named one cause for six ───────────────────────────────────────────────
    (
        "M16 · 🔴 THE 342 FINDING · one sentence for every way a signal can be declined, so a "
        "launcher that simply FINISHED, a `ps` that could not be asked and a genuinely recycled pid "
        "all report as the same defect — which is why 342 could not say what killed step 38",
        [
            (
                OWNED,
                "    return {\n      signalled: false,\n      why: `the launcher reads ${result.state.kind}, not alive${code ? ` (${code})` : ''}`,\n    }",
                "    return { signalled: false, why: 'its saved process identity no longer matches' }",
            )
        ],
    ),
    (
        "M17 · ⛔ the re-scan failure borrows the state arm's words · *\"the launcher reads alive\"* "
        "over a refusal caused by a descendant that reparented mid-scan sends the next reader to the "
        "wrong half of the machine entirely",
        [
            (
                OWNED,
                "        why: `the descendant re-scan could not be trusted, and the launcher reads ${stateOf(launcher, false).kind}`,",
                "        why: `the launcher reads ${stateOf(launcher, false).kind}, not alive`,",
            )
        ],
    ),
    (
        "M18 · ⚠️ the re-scan refusal stops naming the launcher's own state · *\"could not be "
        "trusted\"* alone cannot distinguish a scan that failed because the thing being scanned had "
        "ended from one that failed for a reason of its own — the exact question step 38 turns on",
        [
            (
                OWNED,
                "        why: `the descendant re-scan could not be trusted, and the launcher reads ${stateOf(launcher, false).kind}`,",
                "        why: 'the descendant re-scan could not be trusted',",
            )
        ],
    ),
    (
        "M19 · ⛔ `signal` answers the report object instead of a boolean · an object is always "
        "truthy, so a caller written `if (!lifecycle.signal(…))` reads every refusal as a signal "
        "that was sent — ⚠️ **and there is no such caller left in the tree, which this dispatch is "
        "what did**: `ui-live-smoke.mjs`'s wrapper was the last one and now calls `signalWhy`. The "
        "row therefore defends the PUBLISHED SHAPE of a shared lifecycle rather than a live call "
        "site, and `owned-process.test.mjs` alone is what holds it",
        [(OWNED, "    signal: (signal = 'SIGINT') => signalWhy(signal).signalled,", "    signal: (signal = 'SIGINT') => signalWhy(signal),")],
    ),
    (
        "M20 · ⛔ the KERNEL's refusal borrows `unverifiable`'s word · `ps` answered `alive` and "
        "`process.kill` threw — `ESRCH` when the group emptied inside the window between the read "
        "and the kill — and reporting that as *\"ps could not be asked\"* is the same one-sentence-"
        "for-two-states defect this section removes, reproduced inside the fix (345 review measured "
        "the two arms byte-identical before the split)",
        [
            (
                OWNED,
                "      return { state: { kind: 'unsignallable', error }, signalled: false }",
                "      return { state: { kind: 'unverifiable', error }, signalled: false }",
            )
        ],
    ),
    (
        "M21 · ⚠️ a successful signal reports the same word as a refusal · `why` stops being the "
        "thing that separates them, so the control every refusal is measured against disappears",
        [(OWNED, "    if (result.signalled) return { signalled: true, why: 'sent' }", "    if (result.signalled) return { signalled: true, why: 'the launcher reads alive, not alive' }")],
    ),
]
