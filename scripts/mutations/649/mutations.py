"""649 · `495`'s free half — the probe deadline, landed, and the censuses that now measure it.

⛔ **Ordered by PM RULING 3**, from `647` F3. ⚑ `495`'s four `packages/runtime` files were taken
as a PATCH onto `main` @ `4ad22d70`, byte-identical to `495`'s tip `e24651e6`: an outer run
deadline and owned teardown for `codex-cancel-interrupt-probe.smoke.ts`, the new
`codex-exec-permission-approval.smoke.ts`, and two source censuses. ⚠️ **The probes run only under
`vitest.smoke.config.ts`; `pnpm run ci` runs the censuses and never the probes.**

## 🔴 Why the censuses changed before they landed

⛔ **Measured against the censuses exactly as `495` wrote them: of 65 distinct edits to the two
probes — 27 of mine, 28 more from a read-only adversarial review, 4 on the cancel probe's oracle,
6 from a review of `649`'s own first repair — 48 left them green.** The shapes: a commented-out
teardown line still held the words a raw-text `toContain` asked for (seven distinct); an order
check was satisfied by a reject left in a dead `else`; the timer's delay, the early-expiry path, the
refusal's condition, `stopThisCapture`'s body and both oracles were read by nothing.

⚑ **After `codeOnly`, named pins and a fingerprint of each whole probe: 65 of 65.** `649`'s first
repair (named pins alone) left the six `M19`–`M24` shapes open — measured, not argued — which is
why the fingerprint exists. Every edit was verified alone: applied, the two censuses run, the probe
restored from bytes. Every row below is type-valid (`tsc` exit 0 with it applied; a planted type
error in the same probe is the positive control, exit 2). ⚑ Two negative controls stay green by
design: a trailing comment and a blank line are not code.

## ⚠️ What a row here measures, and what it does not

 * ⚑ **One row per property the measurement found.** `M1` and `M14` were already killed by
   `495`'s own assertions and anchor them; the other 22 each survived the census as landed. The
   remaining verified edits are counted in `649`'s response, not repeated here.
 * ⛔ **The fingerprint kills ANY code edit, an inert one included.** Two of the 65 — the
   success-path re-check of the expiry bit, one in each probe — change nothing observable: that
   handler runs in the same microtask checkpoint as the work it follows, before any timer can set
   the bit. They die only because the code moved, so neither is a row
   ([[a-true-mutation-measures-nothing]]). ⚠️ At `649`, in the EXEC probe, which then had no
   clock refusal, the error-path re-check was inert too; in the CANCEL probe it was not, and that
   is `M19`. (`655` changed this — see its section below.)

## ⛔ What this table cannot reach

 * 🔴 **The probes' behaviour.** A row proves the cheap gate notices an edit — never that the
   edited probe would still measure. That is `pnpm run probe:codex-cancel-interrupt` and
   `pnpm run probe:codex-exec-permission` — loopback, no credential, no tokens — which `649` was
   ordered not to run (§3.2), and `655` then ran.
 * ⚠️ **Arm B's timestamps**, at `649`: the probe awaited `turn/interrupt` INSIDE its reader, so
   every frame queued behind it was stamped when dequeued — a defect in the instrument that no
   mutation of the census could express. (`655` fixed it; see below.)
 * ⚠️ **The fingerprint's own edge:** `squash` turns a line break into a space, so a break inserted
   after a bare `return` or `throw` does not move it.
 * ⛔ **Reachability.** Neither probe's path is a key in `reachability.py`'s audited manifest (it
   lists one other smoke file), so every row here routes to ALL four projects when the mutation
   seat runs it.

## ⚑ `655` · re-anchored, not retired

`655` moved the deadline into `smoke/probe-run-deadline.ts` and the cancel probe's reader into
`smoke/cancel-interrupt-reader.ts`, where they are TESTED (fake timers; a fixture transport), and
derived each budget from its waits. ⛔ **Nineteen rows lost their anchor — and six of them again
after `655`'s own review changed the helper — and none lost its subject**, so each was corrected
where its subject now lives and says so in its label; every row was re-verified RED by hand
against the tree `655` left, and every row type-checks. ⚠️ `M21`'s shadow is no longer type-valid
— `answered` is assigned inside the reader now — so it carries the same property in the form that
is: the answer sent BEFORE the record is written. Rows whose labels carried the old five- and
three-minute budgets now describe the property without the figures.

⚑ **What `655` changed in the paragraphs above:** the expiry re-checks now live ONCE, in the
helper, and neither is inert there — work that settles after the clock has passed is the
deadline's, tested with the bit set and without it; arm B's reader no longer awaits the interrupt
(`cancel-interrupt-reader.test.ts`); and all three probes ran green (`655`'s response).
"""

CANCEL = "packages/runtime/smoke/codex-cancel-interrupt-probe.smoke.ts"
EXEC = "packages/runtime/smoke/codex-exec-permission-approval.smoke.ts"
HELPER = "packages/runtime/smoke/probe-run-deadline.ts"
READER = "packages/runtime/smoke/cancel-interrupt-reader.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · ⛔ arm D is handed a fresh WHOLE budget — the absolute deadline re-born per test instead of once · ⚑ the one row `495`'s own census already killed on this probe, kept as its anchor · ⚑ 655: moved into the shared helper; killed by `probe-run-deadline.test.ts`",
        [
            (
                HELPER,
                '      deadlineAt ??= Date.now() + budgetMs',
                '      deadlineAt = Date.now() + budgetMs',
            ),
        ],
    ),
    (
        'M2 · 🔴 the timer is armed with a whole budget instead of what REMAINS — arm D runs a full budget past wherever A–C ended, and `??=` is untouched · ⛔ survived the census as landed · ⚑ 655: moved into the shared helper; killed by `probe-run-deadline.test.ts`',
        [
            (
                HELPER,
                '        }, deadlineAt! - Date.now())',
                '        }, budgetMs)',
            ),
        ],
    ),
    (
        'M3 · 🔴 an expiry that RESOLVES the race — the reject left in a dead `else` — turns a stalled arm into a green `it()` · ⛔ survived the census as landed, which asked only that the words appear in order · ⚑ 655: moved into the shared helper; killed by `probe-run-deadline.test.ts`',
        [
            (
                HELPER,
                '            void expire().then(() => reject(deadlineError))',
                '            void expire().then(() => _(undefined as never))',
            ),
        ],
    ),
    (
        'M4 · 🔴 an already-spent budget RETURNS instead of throwing NOT PERFORMED, so arm D passes without measuring anything · ⛔ survived the census as landed · ⚑ 655: moved into the shared helper; killed by `probe-run-deadline.test.ts`',
        [
            (
                HELPER,
                (
                    '      if (outOfTime()) {\n'
                    '        await expire()\n'
                    '        throw deadlineError\n'
                    '      }'
                ),
                (
                    '      if (outOfTime()) {\n'
                    '        await expire()\n'
                    '        return undefined as T\n'
                    '      }'
                ),
            ),
        ],
    ),
    (
        "M5 · ⚠️ the refusal at a capture's start reads only the bit a late timer sets, not the clock — after a sleep or under load an arm starts past the deadline · ⛔ survived the census as landed · ⚑ 655: moved into the shared helper; killed by `probe-run-deadline.test.ts`",
        [
            (
                HELPER,
                '  const outOfTime = (): boolean => expired || (deadlineAt !== null && Date.now() >= deadlineAt)',
                '  const outOfTime = (): boolean => expired',
            ),
        ],
    ),
    (
        "M6 · ⛔ the refusal is still CALLED, behind a condition that is never true · ⛔ survived the census as landed, which asked for the call's text · ⚑ 655: the probe now calls the helper's `deadline.refuse`",
        [
            (
                CANCEL,
                '  deadline.refuse(`starting arm ${label}`)\n',
                '  if (label.length === 0) deadline.refuse(`starting arm ${label}`)\n',
            ),
        ],
    ),
    (
        "M7 · 🔴 teardown awaits the reader before closing the transport it reads — a live child keeps the reader open, so the expiry's teardown waits on the thing it was meant to stop · ⛔ survived the census as landed · ⚑ 655: the teardown now awaits the extracted reader's `done`",
        [
            (
                CANCEL,
                (
                    '      if (transport !== null) await transport.close()\n'
                    '    } finally {\n'
                    '      try {\n'
                    '        if (reader !== null) await reader.done'
                ),
                (
                    '      if (reader !== null) await reader.done\n'
                    '    } finally {\n'
                    '      try {\n'
                    '        if (transport !== null) await transport.close()'
                ),
            ),
        ],
    ),
    (
        "M8 · 🔴 expiry SCHEDULES teardown fifteen seconds out instead of starting it, so the awaiter is rejected over a live app-server — the detached child the docblock says the bound prevents · ⛔ survived the census as landed · ⚑ 655: teardown is now registered through the helper's `deadline.own`",
        [
            (
                CANCEL,
                '  const release = deadline.own(() => closeOwnedCapture())',
                (
                    '  const release = deadline.own(async () => {\n'
                    '    setTimeout(() => void closeOwnedCapture().catch(() => {}), SETTLE_MS).unref?.()\n'
                    '  })'
                ),
            ),
        ],
    ),
    (
        'M9 · ⛔ `await transport.close()` commented out — the census read raw text, and the dead line still held its words · ⛔ survived the census as landed; `codeOnly` is the repair · ⚑ 655: re-anchored on the new teardown',
        [
            (
                CANCEL,
                '      if (transport !== null) await transport.close()',
                '      // if (transport !== null) await transport.close()',
            ),
        ],
    ),
    (
        "M10 · 🔴 arm B's interrupt deferred one event-loop turn behind its tool result — the polling gap `495` removed, spelled without `await`, `waitFor` or `setTimeout` · ⛔ survived the census as landed · ⚑ 655: moved into the extracted reader; killed by `cancel-interrupt-reader.test.ts`",
        [
            (
                READER,
                "          const interrupt = transport.request('turn/interrupt', { threadId, turnId })\n",
                (
                    '          const interrupt = new Promise((resolve) => setImmediate(resolve)).then(() =>\n'
                    "            transport.request('turn/interrupt', { threadId, turnId }),\n"
                    '          )\n'
                ),
            ),
        ],
    ),
    (
        'M11 · ⚠️ arm B ALSO interrupted from the main flow — a second `turn/interrupt` the adapter never sends · ⛔ survived the census as landed, whose `toContain` still found the original clause inside the widened one',
        [
            (
                CANCEL,
                "    } else if (plan !== 'answer-only' && plan !== 'answer-then-interrupt') {",
                "    } else if ((plan !== 'answer-only' && plan !== 'answer-then-interrupt') || plan === 'answer-then-interrupt') {",
            ),
        ],
    ),
    (
        'M12 · 🔴 the CONTROL arm C sends the interrupt too — its one differing fact gone, so `interrupted` could be what a declined call says anyway · ⛔ survived the census as landed, which never read the experiment · ⚑ 655: the arms are now one table, `ARMS`, which the budget is counted from',
        [
            (
                CANCEL,
                "  ['C-answer-only', 'answer-only'],",
                "  ['C-answer-only', 'answer-then-interrupt'],",
            ),
        ],
    ),
    (
        'M13 · 🔴 an early `return` after the evidence line — every expectation skipped, the `it()` green · ⛔ survived the census as landed',
        [
            (
                CANCEL,
                '  console.log(`492 cancel-interrupt · ${JSON.stringify(report, null, 1)}`)\n',
                (
                    '  console.log(`492 cancel-interrupt · ${JSON.stringify(report, null, 1)}`)\n'
                    '  if (neverAnswer.failure !== null) return\n'
                ),
            ),
        ],
    ),
    (
        "M14 · ⛔ the synthetic model call becomes a top-level `function_call` instead of the code-mode `custom_tool_call` the pin actually exposes · ⚑ killed by `495`'s own census, kept as its anchor",
        [
            (
                EXEC,
                (
                    "      type: 'custom_tool_call',\n"
                    "      id: 'ctc_495_exec_permission',"
                ),
                (
                    "      type: 'function_call',\n"
                    "      id: 'ctc_495_exec_permission',"
                ),
            ),
        ],
    ),
    (
        "M15 · 🔴 the exec probe's outer budget multiplied tenfold — far past the waits `042`'s rule derives it from · ⛔ survived the census as landed · ⚑ 655: the budget is now derived; this multiplies the derivation",
        [
            (
                EXEC,
                '  runBudgetMs(SERIAL_WAITS_MS),',
                '  runBudgetMs(SERIAL_WAITS_MS) * 10,',
            ),
        ],
    ),
    (
        'M16 · 🔒 the probe ANSWERS `accept` while its record still says `cancel` — the offered command runs, and the evidence says it did not · ⛔ survived the census as landed · ⚑ 655: re-anchored on the reader that now checks the offer first',
        [
            (
                EXEC,
                '        ownedTransport.respond(incoming.id, answered)',
                "        ownedTransport.respond(incoming.id, { decision: 'accept' })",
            ),
        ],
    ),
    (
        'M17 · 🔴 the criterion-17 oracle no longer requires `accept` — the one fact `483` found and `495` reconstructed · ⛔ survived the census as landed',
        [
            (
                EXEC,
                "  expect(decisions).toContain('accept')",
                "  expect(decisions).toContain('cancel')",
            ),
        ],
    ),
    (
        "M18 · 🔴 the `it()` body `void`s its deadline wrapper — the test resolves at once, whatever the probe finds · ⛔ survived the census as landed, whose `toContain` still found the call · ⚑ 655: re-anchored on the `it()` that now passes the helper's timeout",
        [
            (
                EXEC,
                "  () => deadline.within('capturing the raw command approval', measureProviderApproval),",
                (
                    '  () => {\n'
                    "    void deadline.within('capturing the raw command approval', measureProviderApproval)\n"
                    '  },'
                ),
            ),
        ],
    ),
    (
        'M19 · 🔴 the ERROR-path handler RETURNS once the bit is set — a refusal that trips on the clock (after a sleep, or a timer lagging under load) resolves the race GREEN with arms unmeasured · ⛔ survived the census as landed · ⚑ 655: moved into the shared helper; killed by `probe-run-deadline.test.ts`',
        [
            (
                HELPER,
                (
                    '          async (error: unknown) => {\n'
                    '            if (!outOfTime()) throw error\n'
                    '            await expire()\n'
                    '            throw deadlineError\n'
                    '          },'
                ),
                (
                    '          async (error: unknown) => {\n'
                    '            if (!outOfTime()) throw error\n'
                    '            await expire()\n'
                    '            return undefined as T\n'
                    '          },'
                ),
            ),
        ],
    ),
    (
        "M20 · ⛔ the cancel probe's budget multiplied after the part the census names — six budgets behind a derivation that says one · ⛔ survived the census as landed and `649`'s first repair · ⚑ 655: the budget is now derived; this multiplies the derivation",
        [
            (
                CANCEL,
                '  runBudgetMs(ARMS.flatMap(([, plan]) => serialWaitsMs(plan))),',
                '  runBudgetMs(ARMS.flatMap(([, plan]) => serialWaitsMs(plan))) * 6,',
            ),
        ],
    ),
    (
        "M21 · 🔒 the answer is SENT before the record is written — the provider receives `null` while the evidence says `cancel`: the wire and the record disagree · ⛔ survived the census as landed and `649`'s first repair · ⚑ 655: the shadow is no longer type-valid — `answered` is now assigned in the reader — so the same property, the record and the wire disagreeing, is written as the answer sent BEFORE the record",
        [
            (
                EXEC,
                (
                    "        answered = { decision: 'cancel' }\n"
                    '        ownedTransport.respond(incoming.id, answered)'
                ),
                (
                    '        ownedTransport.respond(incoming.id, answered)\n'
                    "        answered = { decision: 'cancel' }"
                ),
            ),
        ],
    ),
    (
        "M22 · ⛔ arm D's `it()` behind an env guard nobody sets — the second reading silently never runs, the pinned text intact · ⛔ survived the census as landed and `649`'s first repair · ⚑ 655: re-anchored on the `it()` that now passes the helper's timeout",
        [
            (
                CANCEL,
                (
                    'it(\n'
                    "  '492 · a SECOND card, outstanding, when the turn is interrupted',"
                ),
                (
                    "if (process.env['BROBOT_492_ARM_D'])\n"
                    '  it(\n'
                    "  '492 · a SECOND card, outstanding, when the turn is interrupted',"
                ),
            ),
        ],
    ),
    (
        "M23 · 🔴 `stopActiveCapture = null` inserted between two pins — expiry then starts no teardown, and every pinned block still reads true · ⛔ survived the census as landed and `649`'s first repair · ⚑ 655: teardown is now owned through the helper; this releases it at once",
        [
            (
                EXEC,
                '  const release = deadline.own(() => closeOwnedCapture())\n',
                (
                    '  const release = deadline.own(() => closeOwnedCapture())\n'
                    '  release()\n'
                ),
            ),
        ],
    ),
    (
        "M24 · 🔴 the experiment's input moved WITH its oracle — `special/unknown` becomes `special/tmpdir` on both sides, so the probe can pass while measuring a path BroBot CAN display, which is not criterion 17 · ⛔ survived the census as landed and `649`'s first repair",
        [
            (
                EXEC,
                "              value: { kind: 'unknown', path: PROFILE_MARKER },",
                "              value: { kind: 'tmpdir', path: PROFILE_MARKER },",
            ),
            (
                EXEC,
                "          value: { kind: 'unknown', path: PROFILE_MARKER, subpath: null },",
                "          value: { kind: 'tmpdir', path: PROFILE_MARKER, subpath: null },",
            ),
        ],
    ),
]
