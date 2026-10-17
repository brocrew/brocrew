"""333 · A reap that said complete, and was not — each row is THE DEFECT, put back verbatim (131).

⛔ **What 333 fixed, in one sentence.** `window:check` reaped its app, reported the reap COMPLETE,
and then failed removing the user-data directory with `ENOTEMPTY` — on a green product, with three
consecutive re-runs clean, which is exactly the shape that gets waved through as flake.

## 🔴 The measurement, because the fix is only as good as it

⚑ **Reproduced.** A loop of the gate's own launch/reap/remove fired the failure at **iteration 16**,
and the capture at the throw named six survivors:

```
   provider-homes/default/default/codex/logs_2.sqlite      ← written  +9ms after the removal was asked
   provider-homes/default/default/codex/logs_2.sqlite-wal  ← written  +7ms
   provider-homes/default/default/codex/memories_1.sqlite  ← written  +5ms
```

⛔ **Written DURING the removal.** So a writer was alive after the reap said nothing was, and the
question is which of the two ways that can happen it was. **Both turned out to be real.**

**(a) The identity.** Between `SIGKILL` and leaving the process table an Electron browser spent
**535 ms** reading like this to `ps` — same pid, same `lstart`, same `pgid`, `comm` and `command`
rewritten to `(Electron)`:

```
   +  63ms  exe=(Electron)  cmd=(Electron)  start=same  pgid=same  ppid=1
   + 598ms  GONE
```

⚠️ `sameRememberedProcess` compares all six fields, so that read was `replaced` — *"the OS handed
this number to somebody else"* — and `replaced` was counted as neither alive nor unverifiable.
**Measured over 70 runs: 19 reported a complete teardown with four to six of their own processes
still in the table.** After the fix, over another 70: **0**.

**(b) The membership.** Discovery ran once, ABOVE an `inspect()` that costs **81 ms** on a seven-pid
lifecycle idle and two to three times that under a full `ci`. A provider child spawned in that window
is `detached`, leads its own process group, and is reached by neither the group signal nor a
`remember()`. Seen once in 70 runs. The second scan shrinks that window to one `ps -A` (**29 ms**);
it does not close it, and the response says so.

## ⛔ The row that is NOT here, and the ten minutes that put it there

⚠️ **`pid` + `lstart` alone made every teardown take 13.1–15.8 seconds and go red on a green
product.** The launcher is the caller's OWN direct child, so only the caller collects it — and
`blockingPause` stops the caller's event loop, so it stays a zombie for the whole 40-attempt bound.
A zombie holds no descriptor and no page; it cannot be what the removal is racing. `M7`–`M9` are that
regression, put back three ways.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M6`, `M10`-`M13` | ⚑ **`run_suite`** — `scripts/test/owned-process.test.mjs` |
| `M7`-`M9` | ⚑ **`run_suite`** — the zombie pair in the same file |
| `M14`-`M20` | ⚑ **`run_suite`** — `scripts/test/owned-teardown.test.mjs` |
| `M21`-`M23` | ⚑ **`run_suite`** — the per-gate table at the foot of `owned-teardown.test.mjs` |
| `M24`-`M25` | ⚑ **`run_suite`** — the late-discovery test in `owned-process.test.mjs` |

## ⚠️ What this table deliberately does NOT contain

⛔ **No row makes `runState` part of `sameRememberedProcess`.** It is a real defect — a process moves
between `S`, `R` and `SN` while it runs, so every re-read would look replaced — but the fixtures hold
one state per process, so the mutation would change nothing any assertion can see and would record as
a phantom survivor. `M10` covers the observable half, where the field joins `IDENTITY_FIELDS` and
`captureProcessIdentity` starts refusing every busy process.

⛔ **No row removes the `ENOTEMPTY` message's `{ cause }`.** The gates print `.message`, not the
chain, so nothing on any red line would move.

⛔ **No row touches the 40-attempt bound or the 250 ms interval.** They are 287/294's and this
dispatch measured against them rather than changing them: the worst post-fix reap was 1.7 s.

## ⚑ Anchors moved by 387, and re-verified rather than assumed

⛔ **`M17` was re-anchored on 2026-09-08 and re-run alone against `owned-teardown.test.mjs`: RED.**
`387` split the `written` filter across three lines and gave it a threshold, and this row's anchor
had already been corrected once by `360`. ⚠️ A corrected anchor otherwise keeps a verdict the line it
now names never earned — the row is applied to text it has never been applied to, and the table's
green belongs to the OLD line.

⚑ **And the sentence above about `runState` was right about something else too.** *"A process moves
between `S`, `R` and `SN` while it runs"* is exactly why `owned-process.test.mjs` compared its own
state against a second live `ps` and went intermittently red under a parallel run; `387` replaced
that equality with a shape and a control. ⛔ **The fact was written down here and the test next door
was betting against it.**
"""

OWNED = "scripts/lib/owned-process.mjs"
TEARDOWN = "scripts/lib/owned-teardown.mjs"
WINDOW = "scripts/window-opens-check.mjs"
FIXTURE = "scripts/fixture-follow-check.mjs"
QUIT = "scripts/app-closes-check.mjs"

MUTATIONS = [
    # ── the defect itself ─────────────────────────────────────────────────────────────────────
    (
        "M1 · ⛔ THE DEFECT, verbatim · a process on its way out is 'replaced' again, so completion "
        "is computed over an empty list and the directory comes off while it is still flushing",
        [
            (
                OWNED,
                "      if (isTheSameProcess(saved, current)) return { kind: 'exiting', current }\n",
                "",
            )
        ],
    ),
    (
        "M2 · ⛔ the discriminator becomes the NAME again · `(Electron)` is a different executable, "
        "so the one read that proves the process is still there is the one that dismisses it",
        [
            (
                OWNED,
                "  return saved.pid === current.pid && saved.start === current.start\n",
                "  return (\n"
                "    saved.pid === current.pid &&\n"
                "    saved.start === current.start &&\n"
                "    saved.executable === current.executable\n"
                "  )\n",
            )
        ],
    ),
    (
        "M3 · ⛔ the pid becomes the identity · a number the OS handed to somebody else is waited "
        "for to the bound — the failure 287/294 built this module to prevent, from the other side",
        [
            (
                OWNED,
                "  return saved.pid === current.pid && saved.start === current.start\n",
                "  return saved.pid === current.pid\n",
            )
        ],
    ),
    (
        "M4 · ⛔ the list exists and stops nothing · `exiting` is collected, reported on the red "
        "line, and left out of the one condition the removal is behind",
        [
            (
                OWNED,
                "      complete: alive.length === 0 && exiting.length === 0 && unverifiable.length === 0,",
                "      complete: alive.length === 0 && unverifiable.length === 0,",
            )
        ],
    ),
    (
        "M5 · ⛔ nothing is ever put in the list · completion is right and every red line says "
        "'no pid is still alive' about a teardown that waited ten seconds for one",
        [
            (
                OWNED,
                "      if (state.kind === 'exiting') exiting.push(identity.pid)\n",
                "",
            )
        ],
    ),
    (
        "M6 · ⛔ the outcome stops carrying it · the gates read `outcome.exiting` and find it empty, "
        "so 241's failure and a slow exit print the same sentence",
        [(OWNED, "      exiting: Object.freeze([...last.exiting]),", "      exiting: Object.freeze([]),")],
    ),
    # ── the zombie ruling, which is the regression this table exists to hold ──────────────────
    (
        "M7 · ⛔ THE REGRESSION, verbatim · a collected pid is waited for, so the caller's own "
        "unreaped child runs every teardown to its bound: 13.1-15.8s and a red on a green product",
        [
            (
                OWNED,
                "      if (current.runState.startsWith(ZOMBIE)) return { kind: 'collected' }\n",
                "",
            )
        ],
    ),
    (
        "M8 · ⛔ the same, by ORDER rather than absence · the check moves below the identity "
        "comparisons, where a platform that leaves a zombie's name alone reads it as ALIVE and "
        "signals a row in a table until the bound runs out — the subtler half of M7",
        [
            (
                OWNED,
                "      if (current.runState.startsWith(ZOMBIE)) return { kind: 'collected' }\n"
                "      if (sameRememberedProcess(saved, current, { allowInitReparent })) {\n"
                "        return { kind: 'alive', current }\n"
                "      }\n",
                "      if (sameRememberedProcess(saved, current, { allowInitReparent })) {\n"
                "        return { kind: 'alive', current }\n"
                "      }\n"
                "      if (current.runState.startsWith(ZOMBIE)) return { kind: 'collected' }\n",
            )
        ],
    ),
    (
        "M9 · ⛔ the letter stops matching · `ps` says `Z` and the constant says `z`, so the check "
        "runs, reads nothing and lets M7 through behind a line that looks like it is doing the work",
        [(OWNED, "const ZOMBIE = 'Z'", "const ZOMBIE = 'z'")],
    ),
    # ── the state is READ, and is not authority ───────────────────────────────────────────────
    (
        "M10 · ⛔ the state becomes part of the saved identity · a process that moves from `S` to "
        "`R` between two samples is refused, so the teardown ends up with authority over nothing",
        [
            (
                OWNED,
                "const IDENTITY_FIELDS = ['pid', 'start', 'executable', 'parentPid', 'pgid', 'command']",
                "const IDENTITY_FIELDS = [\n"
                "  'pid',\n"
                "  'start',\n"
                "  'executable',\n"
                "  'parentPid',\n"
                "  'pgid',\n"
                "  'command',\n"
                "  'runState',\n"
                "]",
            )
        ],
    ),
    (
        "M11 · ⛔ the field is never read from `ps` · `runState` is the empty string for every "
        "process there is, which reads as 'not a zombie' and is M7 with no line to point at",
        [
            (
                OWNED,
                "  const facts = read(['pid', 'ppid', 'pgid', 'state', 'lstart'])",
                "  const facts = read(['pid', 'ppid', 'pgid', 'lstart'])",
            )
        ],
    ),
    (
        "M12 · ⛔ the two new fields swap places · `start` becomes the state letter and `runState` "
        "the date — every identity mismatches itself, and `lstart` is the only field with spaces",
        [
            (
                OWNED,
                "    start: match[5],",
                "    start: match[4],",
            ),
            (
                OWNED,
                "    runState: match[4],",
                "    runState: match[5],",
            ),
        ],
    ),
    (
        "M13 · ⛔ `state` is appended AFTER `lstart` · the multi-word field eats it, so the parse "
        "silently keeps working and the state is part of the date",
        [
            (
                OWNED,
                "  const facts = read(['pid', 'ppid', 'pgid', 'state', 'lstart'])",
                "  const facts = read(['pid', 'ppid', 'pgid', 'lstart', 'state'])",
            )
        ],
    ),
    # ── the removal, and the two fixes 333 §3.2 forbids ───────────────────────────────────────
    (
        "M14 · ⛔ the swallow, verbatim · the teardown failure becomes silence, which is how a real "
        "leak goes green — 241 is what it costs and 066 is what it then perturbs",
        [
            (
                TEARDOWN,
                "  try {\n"
                "    remove(directory)\n"
                "  } catch (error) {\n"
                "    throw new Error(describeFailedRemoval(directory, askedAt, error, survivors), { cause: error })\n"
                "  }\n",
                "  try {\n"
                "    remove(directory)\n"
                "  } catch {\n"
                "    // the directory will be collected with the temp root\n"
                "  }\n",
            )
        ],
    ),
    (
        "M15 · ⛔ the RETRY, verbatim · `maxRetries` turns every one of these green while the "
        "directory of a live app comes off underneath it: the same defect, hidden",
        [
            (
                TEARDOWN,
                "  rmSync(directory, { recursive: true, force: true })",
                "  rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })",
            )
        ],
    ),
    (
        "M16 · ⛔ the stamp moves to when it ANSWERED · the removal walk is the slow part, so every "
        "survivor written during it reads as one written before it and the accusation disappears",
        [
            (
                TEARDOWN,
                "    throw new Error(describeFailedRemoval(directory, askedAt, error, survivors), { cause: error })",
                "    throw new Error(describeFailedRemoval(directory, now(), error, survivors), { cause: error })",
            )
        ],
    ),
    (
        "M17 · ⛔ the two kinds of failure become one sentence · a live writer and a slow unlink "
        "read the same, which is the whole of what made the original message unactionable",
        [
            (
                TEARDOWN,
                # ⚑ Anchor corrected by 360, which added the `isDirectory` clause to this filter,
                # and again by 387, which gave it a threshold of `askedAt + A_WHOLE_MILLISECOND` and
                # split it across three lines. The RULE is untouched through both — a live writer
                # and a slow unlink must still read differently — and the replacement is the same
                # one it has always been: no writer is ever named. ⛔ Re-verified RED on 2026-09-08
                # against `scripts/test/owned-teardown.test.mjs`, because a corrected anchor
                # otherwise keeps a verdict the line it now names never earned.
                "  const written = left.filter(\n    (entry) => entry.isDirectory !== true && entry.mtimeMs >= askedAt + A_WHOLE_MILLISECOND,\n  )",
                "  const written = []",
            )
        ],
    ),
    (
        "M18 · ⛔ the cap stops being admitted · the sentence names every survivor and never says "
        "how many it did not, so a page of them reads as the whole set (`a-pointer-clause-is-a-claim`)",
        [
            (
                TEARDOWN,
                # ⚑ Anchor corrected by 360, which put the writers at the front of this list so a
                # 25-entry cap cannot hide the one line that carries the claim. The rule this row
                # pins is the CAP, and the replacement still removes it.
                "  const shown = [...written, ...left.filter((entry) => !written.includes(entry))].slice(\n    0,\n    MAX_SURVIVORS_SHOWN,\n  )",
                "  const shown = left",
            )
        ],
    ),
    (
        "M19 · ⛔ the report replaces the failure · a directory the walk cannot list throws from "
        "inside the description of the throw — 325's defect, one layer in",
        [
            (
                TEARDOWN,
                # ⚑ Anchor corrected by 360, which gave the pushed entry an `isDirectory` and so
                # spread it over four lines. The rule is untouched: a walk that cannot list a
                # directory must name it, not throw from inside the description of a throw.
                "    let entries\n"
                "    try {\n"
                "      entries = readdirSync(dir)\n"
                "    } catch (error) {\n"
                "      found.push({\n"
                "        path: `${relative}/ (could not be listed: ${errorCode(error)})`,\n"
                "        mtimeMs: 0,\n"
                "        isDirectory: true,\n"
                "      })\n"
                "      return\n"
                "    }\n",
                "    const entries = readdirSync(dir)\n",
            )
        ],
    ),
    (
        "M20 · ⛔ the cap moves and the sentence does not · twenty-five is what the message is "
        "written against, and a bound nothing pins drifts away from the words that describe it",
        [(TEARDOWN, "const MAX_SURVIVORS_SHOWN = 25", "const MAX_SURVIVORS_SHOWN = 50")],
    ),
    # ── the three gates ───────────────────────────────────────────────────────────────────────
    (
        "M21 · ⛔ `window:check` stops naming it · the gate waits for a pid on its way out and then "
        "reports 'no pid is still alive', sending the reader to look for a leak that is not there",
        [
            (
                WINDOW,
                "    (outcome.exiting.length > 0\n"
                "      ? `, pid(s) ${outcome.exiting.join(', ')} are still in the process table on their way out`\n"
                "      : '') +\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row removes the 'on their way out'
        # clause from the red line of scripts/fixture-follow-check.mjs, which the commit deleted
        # with `fixture:check`. The same fact is held for the surviving gates by 333 M21
        # (window:check) and 333 M23 (quit:check), and by owned-teardown.test.mjs's 'names a pid
        # still on its way out' pin, whose table now has just those two. Its anchor is left stale,
        # so the census records it retired.
        "M22 · ⛔ `fixture:check` stops naming it · the gate 325 was dispatched for, silent about "
        "the state that produced this dispatch's own failure",
        [
            (
                FIXTURE,
                "    // ⚑ 333: still in the table on its way out is its own fact — see `window-opens-check.mjs`.\n"
                "    (outcome.exiting.length > 0\n"
                "      ? `, pid(s) ${outcome.exiting.join(', ')} are still in the process table on their way out`\n"
                "      : '') +\n",
                "",
            )
        ],
    ),
    (
        "M23 · ⛔ `quit:check` stops naming it · the third gate through this teardown, and the one "
        "whose whole subject is how an app comes down",
        [
            (
                QUIT,
                "    // ⚑ 333: still in the table on its way out is its own fact — see `window-opens-check.mjs`.\n"
                "    (outcome.exiting.length > 0\n"
                "      ? `, pid(s) ${outcome.exiting.join(', ')} are still in the process table on their way out`\n"
                "      : '') +\n",
                "",
            )
        ],
    ),
    # ── the late-discovery window ─────────────────────────────────────────────────────────────
    (
        "M24 · ⛔ discovery goes back above the `inspect()` · a provider child spawned in those "
        "81ms leads its own process group, so neither the group signal nor a `remember()` reaches it",
        [(OWNED, "      discover()\n      const signal =", "      const signal =")],
    ),
    (
        "M25 · ⛔ discovery moves BELOW the signal · the launcher is dead by then and ancestry is "
        "gone, so the scan runs, finds nothing, and looks exactly like the one that works",
        [
            (
                OWNED,
                "      discover()\n"
                "      const signal = crash || attempt >= termAttempts ? 'SIGKILL' : 'SIGTERM'\n",
                "      const signal = crash || attempt >= termAttempts ? 'SIGKILL' : 'SIGTERM'\n",
            ),
            (
                OWNED,
                "      last = inspect()\n"
                "      if (!last.complete && attempt + 1 < maxAttempts) {",
                "      discover()\n"
                "      last = inspect()\n"
                "      if (!last.complete && attempt + 1 < maxAttempts) {",
            ),
        ],
    ),
]
