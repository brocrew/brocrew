"""655 · The two probes, made honest and run — what the settle of `649`'s findings newly carries.

⛔ **Ordered by the PM from `649`'s findings table.** `655` lifted the probes' outer deadline into
`smoke/probe-run-deadline.ts` (one semantics, fake-timer tested) and adopted it in three probes; lifted
the cancel probe's reader into `smoke/cancel-interrupt-reader.ts` (fixture tested) and stopped it
awaiting arm B's interrupt; derived every budget from its waits by `042`'s rule; moved the exec
probe's two judgments into `smoke/exec-approval-evidence.ts`; and made each probe own its teardown
before anything exists, keep a failing run's root, and prove rule 40's port. ⚑ **Then it ran all
three, `$0`, loopback, and every one was green** — the censuses pin the code that ran.

## ⚠️ What a row here measures

 * ⚑ **Rows on the three lifted modules are killed by BEHAVIOUR** — a fake clock, a fixture
   transport, frames of each kind. ⛔ Rows on the probes are killed by their censuses, whose
   fingerprint kills any code edit: those rows prove the cheap gate notices the edit, never that
   the edited probe would still measure. That is a run.
 * ⛔ **`649`'s own rows moved with their subjects** — `649`'s table says where; they are not
   repeated here.

## ⛔ What this table cannot reach

 * 🔴 **The provider.** Whether 0.146.0 still offers `accept`, still reports the item `declined`,
   still ends the turn `interrupted` — only `pnpm run probe:*` can say, and `655` ran it.
 * ⚠️ **Reachability.** None of the six `smoke/` paths is a key in `reachability.py`'s audited
   manifest, so every row here routes to ALL four projects when the mutation seat runs it.
"""

CANCEL = "packages/runtime/smoke/codex-cancel-interrupt-probe.smoke.ts"
EXEC = "packages/runtime/smoke/codex-exec-permission-approval.smoke.ts"
EXTERNAL_MCP = "packages/runtime/smoke/codex-external-mcp-probe.smoke.ts"
HELPER = "packages/runtime/smoke/probe-run-deadline.ts"
READER = "packages/runtime/smoke/cancel-interrupt-reader.ts"
EVIDENCE = "packages/runtime/smoke/exec-approval-evidence.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 F1 put back: the reader AWAITS arm B's interrupt before reading on — `495`'s defect, every frame behind it stamped when dequeued and the arrival held behind the RPC · killed by `cancel-interrupt-reader.test.ts`",
        [
            (
                READER,
                '      if (reading.toolCalls >= wanted) resolveWantedCalls()',
                (
                    '      await interruptSettled\n'
                    '      if (reading.toolCalls >= wanted) resolveWantedCalls()'
                ),
            ),
        ],
    ),
    (
        'M2 · 🔒 F7: `offers` stops reading the decision — any listed offer, even one without `cancel`, lets the probe send `cancel` · killed by `exec-approval-evidence.test.ts`',
        [
            (
                EVIDENCE,
                '  return Array.isArray(offered) && offered.includes(decision)',
                '  return Array.isArray(offered)',
            ),
        ],
    ),
    (
        'M3 · 🔴 F7: an exit code no longer counts as execution — a command that ran and failed reads as *did not run* · killed by `exec-approval-evidence.test.ts`',
        [
            (
                EVIDENCE,
                '    if (reported.exitCode !== null) ranBecause.add(`item ${id} exitCode ${reported.exitCode}`)\n',
                '',
            ),
        ],
    ),
    (
        'M4 · 🔴 F7: output the command streamed is no longer counted — a running command that printed reads as *did not run* · killed by `exec-approval-evidence.test.ts`',
        [
            (
                EVIDENCE,
                '      outputDeltas += 1\n',
                '',
            ),
        ],
    ),
    (
        'M5 · 🔴 F7: a `completed` command no longer counts — only `failed` does · killed by `exec-approval-evidence.test.ts`',
        [
            (
                EVIDENCE,
                "    if (reported.status === 'completed') ranBecause.add(",
                "    if (reported.status === 'failed') ranBecause.add(",
            ),
        ],
    ),
    (
        'M6 · 🔒 F7: the offer check removed from the exec reader — `cancel` is sent whether or not the provider listed it · killed by the exec census',
        [
            (
                EXEC,
                (
                    "        if (!offers(incoming.params, 'cancel')) {\n"
                    "          failure = 'NOT PERFORMED — the provider did not offer cancel, so no decision was sent'\n"
                    '          continue\n'
                    '        }\n'
                ),
                '',
            ),
        ],
    ),
    (
        "M7 · ⛔ F7: a turn that never reached its terminal stops being NOT PERFORMED — rule 13's word is lost, though the oracle's own terminal check still fails the run · killed by the exec census",
        [
            (
                EXEC,
                '      failure ??= `NOT PERFORMED — the turn reached no terminal within ${SETTLE_MS}ms of the answer`\n',
                '',
            ),
        ],
    ),
    (
        "M8 · 🔴 F7: the probe's whole claim unasserted — nothing checks that the offered command did not run · killed by the exec census",
        [
            (
                EXEC,
                "  expect(evidence.ranBecause, 'the command the provider offered did not run').toEqual([])\n",
                '',
            ),
        ],
    ),
    (
        'M9 · ⚠️ F6: the arm deletes its root before its expectations run — a failing run destroys the evidence it exists to leave · killed by the cancel census',
        [
            (
                CANCEL,
                (
                    '  return arm\n'
                    '}'
                ),
                (
                    '  rmSync(root, { recursive: true, force: true })\n'
                    '  return arm\n'
                    '}'
                ),
            ),
        ],
    ),
    (
        'M10 · ⚠️ F6: arm D stops asserting its interrupt was accepted — a stalled or refused `turn/interrupt` reads green · killed by the cancel census',
        [
            (
                CANCEL,
                "  expect(two.interruptError, 'D · turn/interrupt was accepted').toBeNull()\n",
                '',
            ),
        ],
    ),
    (
        'M11 · ⛔ F6: no refusal once the port is bound — an expiry during the bind found nothing to close, and the child is then spawned into a run that is over · killed by the cancel census',
        [
            (
                CANCEL,
                '    deadline.refuse(`starting arm ${label} · the loopback port is bound`)\n',
                '',
            ),
        ],
    ),
    (
        'M12 · 🔴 rule 40 disarmed: the configured port is copied from the port the process was given instead of read back from the file the child reads — a stanza that wrote a different port could no longer be caught · killed by the cancel census',
        [
            (
                CANCEL,
                "    configuredPort = configuredPortOf(readFileSync(join(home, 'config.toml'), 'utf8'))",
                '    configuredPort = listenedOn',
            ),
        ],
    ),
    (
        "M13 · ⛔ F3: `605`'s arm F runs with arm E's options — it no longer takes the turn its oracle reads, while the table (and the budget counted from it) still say it does · killed by the 605 census",
        [
            (
                EXTERNAL_MCP,
                "await runArm('F-ask-elicitation', reachedBy, ARM_OPTIONS.F)",
                "await runArm('F-ask-elicitation', reachedBy, ARM_OPTIONS.E)",
            ),
        ],
    ),
    (
        "M14 · 🔴 F3: `605`'s `it()` drops the helper's timeout — vitest's 20-minute default fires BEFORE the 40-minute deadline, freeing the awaiter and not the child · killed by the 605 census",
        [
            (
                EXTERNAL_MCP,
                # ⚑ **720 · ANCHOR CORRECTED in place (rule 27)** — `720` added arms H–J (R74), so the
                # label reads A–J; the defect is unchanged. Re-verified RED alone.
                (
                    "  () => deadline.within('measuring arms A–J', measureExternalMcp),\n"
                    '  deadline.testTimeoutMs,\n'
                ),
                "  () => deadline.within('measuring arms A–J', measureExternalMcp),\n",
            ),
        ],
    ),
    (
        "M15 · ⛔ F3: `605`'s arms stop refusing to start past the deadline · killed by the 605 census",
        [
            (
                EXTERNAL_MCP,
                '  deadline.refuse(`starting arm ${label}`)\n',
                '',
            ),
        ],
    ),
    (
        "M16 · 🔴 F3: the helper's test timeout equals its budget — vitest and the deadline race, and vitest can win · killed by `probe-run-deadline.test.ts`",
        [
            (
                HELPER,
                '    testTimeoutMs: budgetMs + teardownMs + TEST_TIMEOUT_MARGIN_MS,',
                '    testTimeoutMs: budgetMs,',
            ),
        ],
    ),
    (
        'M17 · ⛔ F3: the helper lets two captures be owned at once — expiry tears down only the last one registered · killed by `probe-run-deadline.test.ts`',
        [
            (
                HELPER,
                (
                    '      if (stopActive !== null) {\n'
                    '        throw new Error(`the ${probe} tried to own two captures at once`)\n'
                    '      }\n'
                ),
                '',
            ),
        ],
    ),
    (
        "M18 · ⛔ F2: the margin removed — the budget EQUALS the waits' sum, so the last hung step races the outer deadline instead of failing as itself · killed by `probe-run-deadline.test.ts`",
        [
            (
                HELPER,
                '  return Math.ceil(worst * RUN_BUDGET_MARGIN)',
                '  return worst',
            ),
        ],
    ),
    (
        'M19 · ⚠️ F3: a stale release frees the live capture — the next expiry tears down nothing · killed by `probe-run-deadline.test.ts`',
        [
            (
                HELPER,
                '        if (stopActive === stop) stopActive = null',
                '        stopActive = null',
            ),
        ],
    ),
    (
        'M20 · 🔴 teardown STARTED, not awaited — the timer rejects while the capture is still closing, and a fork stopped after the rejection kills it half-done · killed by `probe-run-deadline.test.ts`',
        [
            (
                HELPER,
                '            void expire().then(() => reject(deadlineError))',
                (
                    '            void expire()\n'
                    '            reject(deadlineError)'
                ),
            ),
        ],
    ),
    (
        'M21 · ⛔ the teardown bound stretched a thousandfold — a teardown that hangs holds the rejection long past the budget · killed by `probe-run-deadline.test.ts`',
        [
            (
                HELPER,
                '          timer = setTimeout(resolve, teardownMs)',
                '          timer = setTimeout(resolve, teardownMs * 1_000)',
            ),
        ],
    ),
    (
        "M22 · ⚠️ within's timer no longer cleared — a work that throws synchronously, or one that finishes early, leaves it armed to tear down a capture it no longer owns · killed by `probe-run-deadline.test.ts`",
        [
            (
                HELPER,
                (
                    '      } finally {\n'
                    '        if (timer !== undefined) clearTimeout(timer)\n'
                    '      }\n'
                    '    },'
                ),
                (
                    '      } finally {\n'
                    '        void timer\n'
                    '      }\n'
                    '    },'
                ),
            ),
        ],
    ),
    (
        "M23 · 🔴 F7: a process id counts only on the item's LAST frame — a `processId` on `item/started` erased by a completion that omits it · killed by `exec-approval-evidence.test.ts`",
        [
            (
                EVIDENCE,
                '    if (reported.processId !== null) ranBecause.add(',
                "    if (reported.processId !== null && frame.method === 'item/completed') ranBecause.add(",
            ),
        ],
    ),
    (
        'M24 · ⚠️ F7: the listen past the terminal removed — the exec probe judges the moment `turn/completed` lands, before an item report that trails it · killed by the exec census',
        [
            (
                EXEC,
                '    await new Promise((resolve) => setTimeout(resolve, POST_TERMINAL_MS))\n',
                '',
            ),
        ],
    ),
    (
        "M25 · ⛔ F3: `605`'s refusal after the binds removed — an expiry during a bind found nothing to close, and the child is spawned into a run that is over · killed by the 605 census",
        [
            (
                EXTERNAL_MCP,
                '    deadline.refuse(`starting arm ${label} · both loopback ports are bound`)\n',
                '',
            ),
        ],
    ),
    (
        "M26 · 🔴 rule 40 disarmed in `605`: the configured port copied from the port the endpoint was given, not read back from the child's file · killed by the 605 census",
        [
            (
                EXTERNAL_MCP,
                "    configuredPort = configuredPortOf(readFileSync(join(home, 'config.toml'), 'utf8'))",
                '    configuredPort = capturePort',
            ),
        ],
    ),
    (
        "M27 · ⚠️ `605` deletes each arm's root before its expectations run — a failing run destroys the evidence it exists to leave · killed by the 605 census",
        [
            (
                EXTERNAL_MCP,
                (
                    '  return arm\n'
                    '}'
                ),
                (
                    '  rmSync(root, { recursive: true, force: true })\n'
                    '  return arm\n'
                    '}'
                ),
            ),
        ],
    ),
    (
        "M28 · 🔴 F1: the reader's two writes REVERSED — `turn/interrupt` before the declined result, the order the adapter never uses · killed by `cancel-interrupt-reader.test.ts`",
        [
            (
                READER,
                (
                    '      if (answers) {\n'
                    '        transport.respond(incoming.id, options.declined)\n'
                    '        if (reading.answeredAt === null) reading.answeredAt = since()\n'
                    '      }\n'
                    "      // 🔴 **Arm B is the adapter's sequence**: the declined result and `turn/interrupt` in ONE\n"
                    '      // continuation, nothing asynchronous between them — and the interrupt is NOT awaited here.\n'
                    "      if (plan === 'answer-then-interrupt') {\n"
                    '        const { threadId, turnId } = options.turn()\n'
                    '        if (!threadId || !turnId) {\n'
                    '          reading.failure =\n'
                    "            'NOT PERFORMED — answer-then-interrupt reached the tool before turn/start bound its ids'\n"
                    '        } else {\n'
                    '          reading.interruptSentAt = since()\n'
                    "          const interrupt = transport.request('turn/interrupt', { threadId, turnId })\n"
                    "          interruptSettled = bounded('turn/interrupt', interrupt, options.rpcDeadlineMs).then(\n"
                    '            () => {\n'
                    '              reading.interruptResolvedAt = since()\n'
                    '            },\n'
                    '            (error: unknown) => {\n'
                    '              reading.interruptError = error instanceof Error ? error.message : String(error)\n'
                    '            },\n'
                    '          )\n'
                    '        }\n'
                    '      }\n'
                ),
                (
                    "      // 🔴 **Arm B is the adapter's sequence**: the declined result and `turn/interrupt` in ONE\n"
                    '      // continuation, nothing asynchronous between them — and the interrupt is NOT awaited here.\n'
                    "      if (plan === 'answer-then-interrupt') {\n"
                    '        const { threadId, turnId } = options.turn()\n'
                    '        if (!threadId || !turnId) {\n'
                    '          reading.failure =\n'
                    "            'NOT PERFORMED — answer-then-interrupt reached the tool before turn/start bound its ids'\n"
                    '        } else {\n'
                    '          reading.interruptSentAt = since()\n'
                    "          const interrupt = transport.request('turn/interrupt', { threadId, turnId })\n"
                    "          interruptSettled = bounded('turn/interrupt', interrupt, options.rpcDeadlineMs).then(\n"
                    '            () => {\n'
                    '              reading.interruptResolvedAt = since()\n'
                    '            },\n'
                    '            (error: unknown) => {\n'
                    '              reading.interruptError = error instanceof Error ? error.message : String(error)\n'
                    '            },\n'
                    '          )\n'
                    '        }\n'
                    '      }\n'
                    '      if (answers) {\n'
                    '        transport.respond(incoming.id, options.declined)\n'
                    '        if (reading.answeredAt === null) reading.answeredAt = since()\n'
                    '      }\n'
                ),
            ),
        ],
    ),
]
