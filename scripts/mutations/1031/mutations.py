"""1031 · D-031 · the app's times match the Mac's clock.

⚑ **Why `1031`**: card D-00N's table is `100N`. D-031 is one DEV commit, `4c8d494b`, landed through
the frontend's merge `7d54be3b`.

## What it changed

Main reads the zone file the Mac's own clock reads (its transitions and the rule after the last one),
and one shared module answers the offset for any instant in both processes, turns a wall time back into
an instant, and builds formatters with the person's locale and the Mac's offset. Every time the app says
or reads uses it; D-029's walk places a job where the Claude CLI fires it.

 * `M1`–`M10` — killed by the landing's `a-time-the-app-says-is-the-time-on-the-macs-clock.test.ts`.

Designed read-only by a Sonnet 5.5 agent from the commit and today's code; each row verified alone by the
landing agent.

## Verification

- **RED: 10 of 10.** Each row alone by `verify_row.py` with its named killer, on `landing` over
  `7b046154` (the merges of `7d54be3b` and `4c598c4b`), none by a syntax, reference or type error.
  Each killer file ran green unmutated first.
"""

INDEX = "apps/desktop/src/main/index.ts"
RUNTIME_HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
SYSTEM_ZONE = "apps/desktop/src/main/system-zone.ts"
CAPABILITIES_SHEET_VUE = "apps/desktop/src/renderer/src/components/CapabilitiesSheet.vue"
LOCAL_TIME = "apps/desktop/src/shared/local-time.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · a rule zone's daylight time starts an hour early: the start change of a POSIX rule is said in the daylight offset instead of standard time, so Paris springs forward at 00:00 UTC instead of 01:00 — killed by `a-time-the-app-says-is-the-time-on-the-macs-clock.test.ts`",
        [
            (LOCAL_TIME, "edges.push({ at: ruleDayAt(each, daylight.starts) - standard, offset: daylight.offset })", "edges.push({ at: ruleDayAt(each, daylight.starts) - daylight.offset, offset: daylight.offset })"),
        ],
    ),
    (
        "M2 · a rule's 'last Sunday' (week 5) is not folded back into its month: in a month whose fifth such weekday does not exist the change lands in the NEXT month, so Paris ends daylight time on 2026-11-01 and springs forward on 2027-04-04 — killed by `a-time-the-app-says-is-the-time-on-the-macs-clock.test.ts`",
        [
            (LOCAL_TIME, "  while (date > days) date -= 7\n", "  // (no fold back into the month)\n"),
        ],
    ),
    # RETIREMENT APPROVED — 1031 M3: anchor-absent; removed by 82cf5886a. instantOfLocal and the fired-
    # one-shot level-restatement mechanism were removed, along with the restatement test. Scheduling now
    # keeps a start per repeating-job run and derives run evidence without that restate; SessionCrons
    # emits changes only. No repeated-wall-time inverse solver or restate flag remains. Definition
    # retained as historical evidence; no row execution.
    (
        "M3 · a wall time a daylight-saving change repeats is read as its LATER instant: instantOfLocal takes the later of the two fitting instants, so a daily 02:30 job placed across the autumn change is fired twice and a repeated wall time is off by an hour — killed by `a-time-the-app-says-is-the-time-on-the-macs-clock.test.ts`",
        [
            (LOCAL_TIME, "if (fits(early) && fits(late)) return Math.min(early, late)", "if (fits(early) && fits(late)) return Math.max(early, late)"),
        ],
    ),
    (
        "M4 · every formatted time ignores the Mac's offset: the formatter is built without the offset zone, so clockTime, clockTimeFrom, fullTime and calendarDay say the runtime's own zone (the hour-ahead defect D-031 exists for) — killed by `a-time-the-app-says-is-the-time-on-the-macs-clock.test.ts`",
        [
            (LOCAL_TIME, "{ ...options, timeZone: offsetZone(minutes) }", "{ ...options }"),
        ],
    ),
    (
        "M5 · two instants are the same Mac day when they fall on the same UTC day: sameLocalDay ignores the offset, so the library's Today band and clockTimeFrom's day-or-bare-time choice follow UTC midnight instead of the Mac's — killed by `a-time-the-app-says-is-the-time-on-the-macs-clock.test.ts`",
        [
            (LOCAL_TIME, "return Math.floor((a + offsetAt(a)) / DAY_MS) === Math.floor((b + offsetAt(b)) / DAY_MS)", "return Math.floor(a / DAY_MS) === Math.floor(b / DAY_MS)"),
        ],
    ),
    (
        "M6 · the Mac's wall clock is read in the runtime's own zone: localFields takes the Date offset instead of the zone handed over, so the cron walk, a one-shot's :00/:30 rule and a Codex export name read one zone while the walk's instants are built in another — killed by `a-time-the-app-says-is-the-time-on-the-macs-clock.test.ts`",
        [
            (LOCAL_TIME, "  const wall = new Date(at + offsetAt(at))\n  return {", "  const wall = new Date(at - new Date(at).getTimezoneOffset() * 60_000)\n  return {"),
        ],
    ),
    (
        "M7 · a zone file's POSIX footer is read with the wrong sign: 'CET-1CEST' is parsed as standard time one hour WEST of UTC, so every rule zone east of Greenwich is hours off — killed by `a-time-the-app-says-is-the-time-on-the-macs-clock.test.ts`",
        [
            (SYSTEM_ZONE, "const standard = 0 - duration(24)", "const standard = duration(24)"),
        ],
    ),
    (
        "M8 · a zone that moved does not place the waiting wake-ups again: placeTheWakeUpsAgain marks the states but never re-arms a stopped conversation's wake-up, so its timer starts it at the old zone's time — killed by `a-time-the-app-says-is-the-time-on-the-macs-clock.test.ts`",
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 7767d7951 moved level/compaction inputs into the receipt planner; omit only the same re-arm after a zone change.
            (RUNTIME_HOST, "          this.armItsWakeUp(conversation, wakeUp.lastLifeEnded)\n", "          void wakeUp.lastLifeEnded\n"),
        ],
    ),
    (
        "M9 · main never hands the zone it read to the shared module: the readLocalTimeFrom(localZone) call is gone, so every time main says (agent-facing words, the walk, export names) is the runtime's own zone data while the window reads the Mac's — killed by `a-time-the-app-says-is-the-time-on-the-macs-clock.test.ts`",
        [
            # ⚑ **theme host · re-anchored in place, not retired** — NOT VERIFIED. Theme startup follows the zone handoff; the replacement removes only that handoff.
            (INDEX, "      readLocalTimeFrom(localZone)\n      themes = new ThemeStore({", "      themes = new ThemeStore({"),
        ],
    ),
    (
        "M10 · the capabilities sheet's 'Exists since' goes back to the runtime's own zone: calendarDay is replaced by new Date(createdAt).toLocaleDateString(), the pre-D-031 spelling — killed by `a-time-the-app-says-is-the-time-on-the-macs-clock.test.ts`",
        [
            (CAPABILITIES_SHEET_VUE, "{{ calendarDay(identity.createdAt) }}", "{{ new Date(identity.createdAt).toLocaleDateString() }}"),
        ],
    ),
]
