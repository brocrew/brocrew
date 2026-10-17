"""705 · the words a person reads from a model — PM rulings R38 and R39 (`697` H-b, H-c).

## 🔴 A · R39 — a shortage the machine gets back by itself is its own, retryable word (M1-M15, M21-M23)

⚑ **The ruling**: *"a transient setup failure (`spawn EMFILE`) is never until a person changes it — a
retryable word that says so."* ⛔ **On `main` neither adapter's `ResumeError` carried the errno**: a
spawn `EMFILE` reaches its parent a tick after `spawn` returns and with NO streams, so Claude's chain
held the SDK's `TypeError` (*reading 'on'*) and Codex's the transport's (*reading 'setEncoding'*),
and Codex then threw the `EMFILE` itself uncaught — the transport touched `stdout` before it listened.
Codex's `EAGAIN` survived only as text. So the wake could only say *could not be resumed*.

 * M1-M3, M21 · the one reading of a chain (`transientSetupFailureOf`): which codes, the nearest
   decides, and the walk is bounded.
 * M4-M6, M22, M23 · Claude keeps the spawn's errno (the witness hears it; the resume waits one
   macrotask) — refuses a spawn that failed after its pipes, which on `main` handed back a handle,
   and honours a cancel that lands during that wait (review rounds one and two).
 * M7-M10 · Codex listens first, holds its words while streamless, and carries the errno as `cause`.
 * M11-M15 · the word: chosen first, its price, its act, its sentence, its closed reason.

## 🔴 B · R38 — a task is *Task #N* wherever a person reads it (M16-M20)

⚑ **The ruling**: *"anywhere a person may read it, a task is Task #N, never a bare #N (model text
read through the digest too)."* M16-M18 put each receipt's bare spelling back; M19 the raw stream's;
M20 puts a hand-written *Task #* back in a notice that already SAID it — identical output, so only
the census over `main/` (`a-task-is-task-n-where-a-person-reads-it.test.ts` §3) can see it.

## ⛔ What this table cannot reach

 * ⚠️ **The cycle guard in `transientSetupFailureOf`** (`!seen.has(link)`): removing it makes a looped
   chain spin synchronously, and a synchronous loop is a hang no test runner can interrupt — a row a
   run could not report. The loop's END is asserted (§3, *"a chain that loops ends"*); its guard is
   not mutated. ⚑ **The DEPTH bound beside it is** (M21, added by the review, which found it
   unasserted: no chain in the file was deeper than three links).
 * ⚠️ **Prose**: the docblocks R38 and R39 made false (`task-called.ts`, `digest.ts`,
   `reply-rails.ts`, `tasks.ts`, `questions.ts`, `PersonsQueue.vue`, `refusals.ts`,
   `interrupt-rails.ts`, `claude-child.ts`' four-errno sentence) are corrected, and no row can hold
   a sentence.
 * ⚠️ **Rows other tables hold on lines this dispatch MOVED**: `233` M7 (the witness's `'error'`
   listener now keeps the errno), `379` M20 (the raw stream's line), `400` M14, `624` M11, `698` M19
   and M20 (the four `reply-rails.ts` notices) — each corrected in place and re-verified RED alone.
"""

RUNTIME = "packages/runtime/src/runtime.ts"
WITNESS = "packages/runtime/src/claude/claude-child.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
TRANSPORT = "packages/runtime/src/codex/codex-transport.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
RAILS = "apps/desktop/src/main/runtime/reply-rails.ts"
DESCRIBE = "apps/desktop/src/renderer/src/lib/describe-event.ts"

ADAPTERS = "the-errno-a-resume-carries.test.ts"
THE_WAKE = "a-shortage-that-clears-by-itself.test.ts"
TASK_N = "a-task-is-task-n-where-a-person-reads-it.test.ts"

THE_CODES = "export const TRANSIENT_SETUP_CODES = ['EMFILE', 'ENFILE', 'EAGAIN', 'ENOMEM'] as const\n"
THE_WORD = "'that-conversation-could-not-be-woken-just-now'"
THE_WALK = "  while (link !== null && typeof link === 'object' && !seen.has(link) && seen.size < 16) {\n"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · R39 — the one reading of a chain ─────────────────────────────────────────────────────
    (
        "M1 · 🔴 a descriptor shortage is not transient · `EMFILE` leaves the list, and the spawn "
        f"R39 names is priced *until a person changes it* again — killed by `{ADAPTERS}`",
        [
            (
                RUNTIME,
                THE_CODES,
                "export const TRANSIENT_SETUP_CODES = ['ENFILE', 'EAGAIN', 'ENOMEM'] as const\n",
            )
        ],
    ),
    (
        "M2 · ⛔ a binary that is not there is transient · `ENOENT` joins the list, and a wake tells a "
        f"model to retry what only a person can fix — killed by `{ADAPTERS}`",
        [
            (
                RUNTIME,
                THE_CODES,
                "export const TRANSIENT_SETUP_CODES = ['EMFILE', 'ENFILE', 'EAGAIN', 'ENOMEM', 'ENOENT'] as const\n",
            )
        ],
    ),
    (
        "M3 · ⛔ the walk passes the nearest code to find a more convenient one · a person's `ENOENT` "
        f"wrapping a shortage reads as the shortage — killed by `{ADAPTERS}`",
        [
            (
                RUNTIME,
                "      return (TRANSIENT_SETUP_CODES as readonly string[]).includes(code)\n"
                "        ? (code as TransientSetupCode)\n"
                "        : null\n",
                "      if ((TRANSIENT_SETUP_CODES as readonly string[]).includes(code)) {\n"
                "        return code as TransientSetupCode\n"
                "      }\n",
            )
        ],
    ),
    # ── A · R39 — Claude keeps the spawn's errno ─────────────────────────────────────────────────
    (
        "M4 · 🔴 Claude's resume keeps the SDK's `TypeError` · the witness heard the `EMFILE` and the "
        f"cause is the symptom again — killed by `{ADAPTERS}`",
        [(CLAUDE, "      const failed = spawnFailure ?? error\n", "      const failed = error\n")],
    ),
    (
        "M5 · 🔴 the witness hears the errno and keeps nothing · the spawn's own failure is dropped "
        f"where it arrives — killed by `{ADAPTERS}`",
        [
            (
                WITNESS,
                "        spawnFailure = error\n        dead = true\n",
                "        dead = true\n",
            )
        ],
    ),
    (
        "M6 · ⛔ the witness answers before the errno can have arrived · no macrotask, so a spawn that "
        f"failed reads as one that did not — killed by `{ADAPTERS}`",
        [
            (
                WITNESS,
                "      await new Promise<void>((resolve) => setImmediate(resolve))\n",
                "      await Promise.resolve()\n",
            )
        ],
    ),
    # ── A · R39 — Codex listens first, holds its words, and carries the errno ────────────────────
    (
        "M7 · 🔴 the transport touches a stream Node never assigned · `stdout.setEncoding` throws, the "
        f"chain holds that `TypeError`, and the errno is lost — killed by `{ADAPTERS}`",
        [
            (
                TRANSPORT,
                "    this.streamless = (this.child as { stdout?: unknown }).stdout === undefined\n"
                "    if (this.streamless) return\n",
                "    this.streamless = (this.child as { stdout?: unknown }).stdout === undefined\n",
            )
        ],
    ),
    (
        "M8 · 🔴 nobody is listening when the spawn fails · the `'error'` listener is attached after the "
        "streamless return, and a descriptor shortage is an uncaught exception in the process that "
        f"spawned it — killed by `{ADAPTERS}`",
        [
            (
                TRANSPORT,
                "    this.child.on('error', (error) => this.onSpawnError(error))\n",
                "",
            ),
            (
                TRANSPORT,
                "    if (this.streamless) return\n    this.child.stdout.setEncoding('utf8')\n",
                "    if (this.streamless) return\n"
                "    this.child.on('error', (error) => this.onSpawnError(error))\n"
                "    this.child.stdout.setEncoding('utf8')\n",
            ),
        ],
    ),
    (
        "M9 · ⛔ a streamless transport writes anyway · the first request throws a `TypeError` of its "
        f"own before the errno arrives, and that is the cause — killed by `{ADAPTERS}`",
        [
            (
                TRANSPORT,
                "    if (this.streamless) return\n    this.child.stdin.write(",
                "    this.child.stdin.write(",
            )
        ],
    ),
    (
        "M10 · 🔴 the errno is a word in a message again · `new Error(text)`, so an `EAGAIN` cannot be "
        f"told from a missing binary by type — killed by `{ADAPTERS}`",
        [
            (
                TRANSPORT,
                "      new Error(`codex app-server failed to spawn: ${error.message}${this.stderrSuffix()}`, {\n"
                "        cause: error,\n"
                "      }),\n",
                "      new Error(`codex app-server failed to spawn: ${error.message}${this.stderrSuffix()}`),\n",
            )
        ],
    ),
    # ── A · R39 — the word ───────────────────────────────────────────────────────────────────────
    (
        # ⚑ **710 · the consequence CORRECTED** (`710`'s second review): since `710` a reopen's
        # shortage reaches the wake as the host's refusal, not a bare `ResumeError`, so without this
        # arm it falls through to the LAUNCH's classifier and answers the spawn's word.
        "M11 · 🔴 the wake never asks · a wake's shortage answers the SPAWN's word "
        f"(`agent-could-not-start-just-now`), never the wake's own — killed by `{THE_WAKE}`",
        [
            (
                TOOLS,
                # ⚑ **707 · re-anchored in place, not retired** — R39 extended: the wake asks of any error, and the launch's classifier asks too; the row still stops the WAKE asking.
                "  const shortage = transientSetupFailureOf(error)\n  if (shortage !== null) {\n",
                "  const shortage = null as ReturnType<typeof transientSetupFailureOf>\n  if (shortage !== null) {\n",
            )
        ],
    ),
    (
        "M12 · 🔴 the retryable word is priced *until a person changes it* · R39's own sentence, "
        f"undone at the price — killed by `{THE_WAKE}`",
        [
            (
                TOOLS,
                f"  {THE_WORD}: 'while-this-holds',\n",
                f"  {THE_WORD}: 'until-a-person-changes-it',\n",
            )
        ],
    ),
    (
        "M13 · ⛔ retryable, and no act · the biconditional's other half — the refusal says a retry "
        f"may work and names nothing to do — killed by `{THE_WAKE}`",
        [
            (
                TOOLS,
                f"  {THE_WORD}: 'make-the-same-call-when-this-settles',\n",
                f"  {THE_WORD}: null,\n",
            )
        ],
    ),
    (
        "M14 · 🔴 the sentence tells a model to stop · the retryable word carries the permanent word's "
        f"*will not help until a person has looked* — killed by `{THE_WAKE}`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The key
        # `'that-conversation-could-not-be-woken-just-now'` is unchanged, but its sentence text was
        # reworded from 'could not be woken just now... Make the same call again in a moment' to
        # 'could not be started just now... Make the same call again in a moment' (D-017's
        # wake→start unification). The rule — the retryable sentence must not carry the permanent
        # sentence's 'will not help until a person has looked' — is untouched and still asserted
        # verbatim by the killer test.
        [
            (TOOLS, "    'that conversation could not be started just now, so nothing was sent. Make the same call again in a moment: its provider", "    'that conversation could not be started just now, so nothing was sent. Starting it again will not help until a person has looked: its provider"),
        ],
    ),
    (
        "M15 · ⛔ the closed reason is the class's, not the errno's · `EMFILE` and `EAGAIN` read as one "
        f"thing in the payload and the ledger — killed by `{THE_WAKE}`",
        [
            (
                TOOLS,
                f"    return {{ rail: {THE_WORD}, because: shortage }}\n",
                f"    return {{ rail: {THE_WORD}, because: 'the-provider-could-not-resume-it' }}\n",
            )
        ],
    ),
    # ── B · R38 — Task #N ────────────────────────────────────────────────────────────────────────
    (
        "M16 · 🔴 `list_tasks` spells a bare `#1` again · the line a model reads and the digest quotes "
        f"— killed by `{TASK_N}`",
                # ⚑ **707 · re-anchored in place, not retired** — R40 spells each line for its reader (`taskCalledFrom`); the row still prints a bare `#1`.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — R38 (a task reads Task
        # #N wherever a person reads it, never a bare #N) survives and is now stronger. D-016
        # dropped the `taskCalledFrom(..., projectSlug, readersProject)` reader-relative spelling
        # for plain `taskCalled(task.number)` in `list_tasks`' line; the plant still prints a bare
        # `#N`.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — R38 survives
        # on pieces, in the killer test's own words: 'there is no Task #N any more... R38's rule
        # stands on the new name — anywhere a person may read it, a piece is its label, and never a
        # bare #N'. 5e931be8 replaced `taskCalled(task.number)` in `list_tasks`' line with
        # `pieceLine(piece.label, piece.title)`. The plant prints the number with a `#` and the
        # piece id again instead of the label, as the old plant did. Killed by
        # `a-task-is-task-n-where-a-person-reads-it.test.ts`.
        [
            (TOOLS, '  return `  ${pieceLine(piece.label, piece.title)} · ${piece.state}${\n', '  return `  #${piece.label.slice(1)} ${piece.piece} · ${piece.state}${\n'),
        ],
    ),
    # Re-anchored, NOT VERIFIED and HELD; its test reaches a held path.
    (
        "M17 · 🔴 `reply_to_parent`'s receipt says `#1 answered` again · the digest's `tool-answered` "
        f"line quotes it — killed by `{TASK_N}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Unchanged code and
        # unchanged rule: `reply_to_parent`'s digest line still must use
        # `taskCalled(replied.number)` (which reads the CALLER's project) rather than a bare `#N`.
        # D-017 did not touch this file; the line is byte-identical to before, and
        # `a-task-is-task-n-where-a-person-reads-it.test.ts` still source-greps for the exact
        # `taskCalled(...)` call (line 443) alongside a fixture of the banned bare-number form (line
        # 389).
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: `reply_to_parent`'s receipt opens on the piece's label and never on a bare `#N`
        # (R38). The receipt is now `${replied.label} answered · ${replied.delivered}${...` and the
        # test pins it. The plant prints `#` plus the label's number in its place. Killed by
        # `a-task-is-task-n-where-a-person-reads-it.test.ts`.
        # ⚑ **635 · re-anchored in place, not retired** — NOT VERIFIED. The accepted receipt appends fixed memory guidance; this row still substitutes a bare number for the piece label and preserves the new suffix.
        [('apps/desktop/src/main/runtime/agent-tools.ts', "`${replied.label} answered · ${whereTheReplyWent(replied)}${kept}${main}${saveMethod}`,", "`#${replied.label.slice(1)} answered · ${whereTheReplyWent(replied)}${kept}${main}${saveMethod}`,")],
    ),
    (
        "M18 · 🔴 `withdraw_task`'s receipt says *task 2* again · a third name for one task — killed by "
        f"`{TASK_N}`",
                # ⚑ **707 · re-anchored in place, not retired** — R40 spells the receipt for its caller (`taskCalledFrom`); the row still says *task 2*.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule (a third name
        # for one task, `task 2`, is never printed) survives. D-016 collapsed
        # `taskCalledFrom(outcome.number, outcome.projectSlug, outcome.readersProject)` to
        # `taskCalled(outcome.number)` in `withdraw_task`'s receipt, so the plant swaps it for the
        # lowercase `task N` again.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a third name for a piece (lowercase 'task 2') is never printed, and
        # `withdraw_task`'s receipt opens on the label (R38). The line is now `${outcome.label} is
        # taken back — ${owner} no longer owes it${...`, so the plant swaps the label for lowercase
        # 'task' plus its number. Killed by `a-task-is-task-n-where-a-person-reads-it.test.ts`.
        [
            (TOOLS, '`${outcome.label} is taken back — ${owner} no longer owes it${', '`task ${outcome.label.slice(1)} is taken back — ${owner} no longer owes it${'),
        ],
    ),
    (
        "M19 · 🔴 the raw stream prints a bare `#3 world-clock` again · the Events tab is a person's "
        f"too — killed by `{TASK_N}`",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule (the Events
        # tab's `task_assigned` line spells Task #N, never a bare #N) survives. D-016 removed
        # `taskCalledIn(number, projectSlug)` and the line is now `taskCalled(event.number) · task_1
        # ← ...`. The event still carries `projectSlug` (kept for numbering until the tree), so the
        # plant prints `#3 world-clock · ...` exactly as the label says.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the Events tab, which a person can open, spells a give by its label with the id
        # beside it. `work_given` in describe-event.ts now returns `${event.label} · ${event.piece}
        # · ${event.title} · given by ${event.givenBy} · ${...`. The plant prints a bare `#N` and
        # the id, as the label says. Killed by `a-task-is-task-n-where-a-person-reads-it.test.ts`.
        [
            (DESCRIBE, 'return `${event.label} · ${event.piece} · ${event.title} · given by ${event.givenBy} · ${', 'return `#${event.label.slice(1)} ${event.piece} · ${event.title} · given by ${event.givenBy} · ${'),
        ],
    ),
    (
        "M20 · ⚠️ a notice writes *Task #* by hand again · the SAME words, so every behaviour test is "
        "green; only the census over `main/` sees a second spelling arrive — killed by "
        f"`{TASK_N}`",
                # ⚑ **707 · re-anchored in place, not retired** — R40 spells the notice for its giver (`taskCalledFrom`); the row still writes *Task #* by hand, and says the SAME words (the project too, where it is elsewhere), so only a census can see it (`707`'s review).
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: a
        # notice must ASK `taskCalled`, not hand-write `Task #`, so the census over `main/` sees a
        # second spelling. D-016 removed the project clause, so the hand-written form is now just
        # `Task #${String(task.number)}`, with the same output words, on the `reply-rails.ts` 'was
        # answered by' notice.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The defect
        # survives in a new form: a notice must ASK `pieceLine` and not hand-write the label and
        # title. The notice in `replyText` is now `${pieceLine(piece.label, piece.title)} was
        # answered by ${piece.owner}: ${reply.outcome}.`. The plant inlines what `pieceLine` returns
        # (`title === null ? label : label · title`), so it says the same words, every behaviour
        # test stays green, and only the census over reply-rails.ts sees it. Killed by
        # `a-task-is-task-n-where-a-person-reads-it.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The 'was answered by' notice in replyText still asks pieceLine for
        # the piece's label and title; commit 7 changed only ${piece.owner} to ${holder}. The plant
        # inlines what pieceLine returns, so the words are identical and every behaviour test stays
        # green, and only the census over reply-rails.ts sees a second spelling. Killed by
        # `a-task-is-task-n-where-a-person-reads-it.test.ts`.
        [
            (RAILS, '`${pieceLine(piece.label, piece.title)} was answered by ${holder}: ${reply.outcome}.`,', '`${piece.title === null ? piece.label : `${piece.label} · ${piece.title}`} was answered by ${holder}: ${reply.outcome}.`,'),
        ],
    ),
    # ── review round one ─────────────────────────────────────────────────────────────────────────
    (
        "M21 · ⛔ the walk has no depth bound · a chain wrapped past sixteen links is read to its end, "
        f"and a shortage buried there is found where the walk promised to stop — killed by `{ADAPTERS}`",
        [
            (
                RUNTIME,
                THE_WALK,
                "  while (link !== null && typeof link === 'object' && !seen.has(link)) {\n",
            )
        ],
    ),
    (
        "M22 · 🔴 Claude hands back a handle whose spawn failed after its pipes · `EAGAIN` wakes "
        "nothing and the wake says it woke — `main`'s answer, found by the review — killed by "
        f"`{ADAPTERS}`",
        [
            (
                CLAUDE,
                "      const spawnFailed = await child.spawnFailure()\n"
                "      if (spawnFailed !== null) throw spawnFailed\n",
                "",
            )
        ],
    ),
    # ── review round two ─────────────────────────────────────────────────────────────────────────
    (
        "M23 · ⛔ a cancel during the spawn check is ignored · the resume's second await is AFTER the "
        "CLI exists, and a cancel landing there hands back a live handle the caller has abandoned — "
        "killed by `conformance.test.ts`",
        [
            (
                CLAUDE,
                "      assertNotCancelled(options.signal, 'claude resume')\n"
                "      handle.attachQuery(query, child)\n",
                "      handle.attachQuery(query, child)\n",
            )
        ],
    ),
]
