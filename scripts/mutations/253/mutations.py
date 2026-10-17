#!/usr/bin/env python3
"""253's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **the person's agent told him it would check every 2 minutes.** It called `CronCreate`, said *"it'll
die if you close this session"*, and BroBot rendered a tool call and forgot. Nothing in the app knew
that job existed a second after the card scrolled away.

⚑ **`250` measured where the fact lives and built nothing, as instructed**: the `Stop` hook's
`session_crons`, structured, on every turn, before and after a fire — and **nothing at all on the
message stream**, proven with a positive control in the same capture. 253 is the runtime half: read
that field, publish it as a level, and add no renderer.

## 🔴 The design decision the rows are about, and the capture that changed it

253's first draft emptied the level at `system/init`, copying `247`'s registry one event over, on
the reasoning `CronCreate`'s own receipt gives: *"session-only (not written to disk, dies when Claude
exits)"*. `smoke/scheduled-work-probe.smoke.ts` refuted it twice, and each failure ERASES a job that
is still scheduled:

 1. ⛔ **Every scheduled FIRE re-emits `system/init` on the SAME stream** — one process, one
    `query()`, one `session_id`: `init` at 10 194 ms, then 54 805 ms and 114 037 ms as the cron woke
    the session twice. An empty level there blanks a live job for the whole fired turn.
 2. ⛔ **A RESUMED session still holds its crons** — a new CLI process resuming `ea1f67f9` reported
    the same `e3826cc5` on a `Stop` at 4 336 ms, before its own first prompt at 4 526 ms.

Both reproduced on every run that measured them; the numbers above are the committed run's.

⚑ **So the producer has exactly one input and makes no reasoned claims**: every level it publishes is
one the provider stated. `M8` is that draft, restored, because a design a capture killed is worth a
row.

The row groups:

 * `M1`-`M4`   🔴 **the fact reaching the app at all** — the hook installed, what it reads, what it
                does with it, and the one thing a `Stop` hook must never do.
 * `M5`-`M7`   ⛔ **absent vs empty** — the distinction `222` cost a dispatch. A payload we cannot
                read may not clear a registry, and an empty one must.
 * `M8`        🔴 **the design the live capture killed**, restored verbatim.
 * `M9`-`M11`  ⚑ **the change gate** — publish on change, treat the level as a SET, and never let a
                shortfall hide behind an unchanged set of rows.
 * `M12`-`M15` 🔴 **`247`'s bound bug, in the two places it could come back** — a clip that outgrows
                its own schema, and a bound written to the provider's documented cap rather than to
                what the provider actually sends.
 * `M16`-`M20` ⚠️ **the reader's refusals** — the cap, the two silent-drop paths, the unreadable row,
                and a field copied without checking its type.
 * `M21`-`M23` ⛔ **the taxonomy and the wire** — the classification that must be deliberate, and the
                two schema bounds a producer could grow past.
 * `M24`-`M25` ⚠️ **the compile floor in `apps/desktop`** — the two files that enumerate
                `RuntimeEvent` exhaustively. Not a surface: the dispatch's §3 says *"no renderer"*,
                and these arms exist so the tree compiles and the debug stream does not lie about
                absent-vs-empty.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⛔ **No row can kill `promptGuardHooks`' `Omit<…, 'Stop'>` return type.** It exists so the spread
   at the launch site cannot silently swallow a `Stop` entry — a COMPILE-time guard against a future
   edit, and removing it changes no observable answer today. Widening it back would be caught by
   `tsc` only after somebody added the entry it protects against, which is the point.
 * ⛔ **No row proves the LIVE claim.** That a model reaches `CronCreate` unaided, that a fire
   re-announces `init`, and that a cron survives a resume are not properties of this tree.
   `probe:scheduled-work` is their instrument and it asserts all three. If a future pin changes any
   of them, that probe goes red and this table stays green — which is the correct division, and it
   means the table is NOT evidence for the response's headline.
 * ⚠️ **No row reaches `SubagentStop`.** 253 installs `Stop` alone, so there is nothing to mutate;
   whether the second reader is worth adding is a measurement the probe reports and does not assert.
 * ⚠️ **No row makes the ledger's REPLAY visible.** That a stored `scheduled_work` is re-folded on
   reopen is `session-record.ts`'s property, and it is the reason `M8` matters — but nothing here
   drives a reopen, so `M8` dies on the unit assertions rather than on the consequence.
 * ⚑ **Nothing retired, and nothing of another table's moved.** Run `census.py` before believing that
   in either direction — 238's lesson 4. Every file this table touches is new in 253's diff or gained
   only additions.

## ⚑ The killing test for every row

⛔ **NAMED, NOT VERIFIED — and 253 says so rather than implying otherwise.** The dispatch scoped this
seat to *"rows written, not run"*, so every line below is the test the row is BUILT to kill and not a
test that has been watched going red. `238`'s lesson (two rows green beside prose insisting they must
die) is exactly the risk this leaves open, and it is the running seat's to close.

⚑ What HAS been checked is the only thing that can be without running it: all anchors are present
exactly once (`mutations.py --dry-run`).

 * `M1`  → `scheduled-work.test.ts` *"the Stop hook must be installed in every session"* (the
           `drive` helper's own assertion), and every adapter test through it.
 * `M2`  → `scheduled-work.test.ts` *"says nothing at init — every level published is one the
           provider stated"*: the event never reaches the stream.
 * `M3`  → the same, plus *"an unreadable payload changes nothing on screen"* — the wrong field is
           `undefined` on every payload, so the level is never stated.
 * `M4`  → `scheduled-work.test.ts`'s `expect(result, 'the reader is inert').toEqual(...)`, which is
           inside `drive` and therefore runs on every adapter test in the file.
 * `M5`  → `scheduled-work.test.ts` *"publishes NOTHING for a payload that is not a level"* and
           *"an unreadable payload changes nothing on screen"*.
 * `M6`  → *"a hook whose reader throws still lets the turn end"* — the throw escapes into the CLI's
           hook machinery instead of being swallowed.
 * `M7`  → *"publishes the EMPTY level for an empty array — the fact that clears a list"*.
 * `M8`  → *"says nothing at init"* and *"a second init mid-session neither clears the level nor
           republishes it"*. ⛔ Also the probe's `[1]`, which is where it was found.
 * `M9`  → *"says nothing when the level has not changed"*.
 * `M10` → *"treats the level as a SET — a reorder is not a change"*.
 * `M11` → *"republishes when only the DROPPED count moved"*.
 * `M12` → *"never returns more characters than it was given as a bound"* — and, one layer on,
           *"every event it can produce parses the schema, however long the provider was"*.
 * `M13` → *"a 1000-character prompt plus the provider marker survives INTACT"*.
 * `M14` → *"every event it can produce parses the schema, however long the provider was"*.
 * `M15` → the same test's `toHaveLength(MAX_SCHEDULE_TEXT)`.
 * `M16` → *"caps the level and says by how much"*.
 * `M17` → the same test's `dropped` equality.
 * `M18` → *"drops a row with no usable id, and counts it out loud"* — a blank id becomes a row.
 * `M19` → the same test's `dropped` equality.
 * `M20` → *"keeps only the fields the provider actually typed"*, and the schema round-trip.
 * `M21` → `provider-work.test.ts` *"makes a new event type someone's decision rather than a
           default"* is NOT the killer — that one counts types. The killer is the same file's
           `isProviderWork(asEvent('scheduled_work'))` equality and `scheduled-work.test.ts` *"is
           never mistaken for the model working"*.
 * `M22` → `scheduled-work.test.ts` *"the wire refuses a level past the cap even when a producer
           does not"*.
 * `M23` → *"a 1000-character prompt plus the provider marker survives INTACT"* — the schema end of
           the same bound.
 * `M24` → ⛔ **NOT** `transcript.test.ts`'s `expect(describeEvent(samples[type])).not.toBe('')` —
           the adversarial pass over 253's own diff caught that: with `level` emptied the line still
           reads `" · hook/Stop"`, which is not `''`, so that census passes straight through it. The
           killer is `apps/desktop/test/scheduled-work.test.ts` *"says `no level` when the frame
           stated none, and `0 scheduled` when it stated an empty one"*, written for this row.
 * `M25` → `transcript.test.ts`'s `annotatesRatherThanAdds` — the arm starts producing an item.
"""

from pathlib import Path

SCHED = "packages/runtime/src/scheduled-work.ts"
CRONS = "packages/runtime/src/claude/session-crons.ts"
ADAPTER = "packages/runtime/src/claude/claude-runtime.ts"
EVENTS = "packages/runtime/src/events.ts"
WORK = "packages/runtime/src/internal/provider-work.ts"
DESCRIBE = "apps/desktop/src/renderer/src/lib/describe-event.ts"
FOLD = "apps/desktop/src/renderer/src/lib/transcript.ts"

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- the fact reaching the app at all --------------------------------------------------------
    (
        "M1 · 🔴 THE DEFECT, verbatim · the `Stop` hook is never installed, so BroBot is back to "
        "knowing nothing about the job the person was promised. The tool call scrolls away and the "
        "schedule goes with it",
        [
            (
                ADAPTER,
                # ⚑ **W4.202 (F099) · re-anchored in place, not retired** — F099 split the Stop hook's call over four lines (it also reads the effort); the row still removes the whole hook
                "        Stop: scheduleReaderHooks(\n          (crons) => handle.noteSessionCrons(crons, 'hook/Stop'),\n          (level) => handle.noteReportedEffort(level),\n        ),\n",
                "",
            )
        ],
    ),
    (
        "M2 · ⛔ the hook reads the level and drops it · `noteSessionCrons` stops publishing, so the "
        "one channel that carries the fact is open and connected to nothing — 235's *live mechanism "
        "with no live input*, inverted",
        [(ADAPTER, "    if (event) this.emit(event)", "    void event")],
    ),
    (
        "M3 · ⛔ the hook reads the WRONG field · `background_tasks` is the other array on the same "
        "payload and it is about work running NOW. Reading it here would make a detached command "
        "look like a schedule, which is the one confusion `scheduled-work.ts` opens by refusing",
        [(ADAPTER, "              note(input.session_crons)", "              note(input.background_tasks)")],
    ),
    (
        "M4 · 🔴 the reader DECIDES · a `Stop` hook that does not continue can restart a turn, and "
        "this one exists to copy a field out. A display fact gets a veto over whether the "
        "conversation is allowed to end",
        [
            (
                ADAPTER,
                "          return { continue: true }\n        },\n      ],\n    },\n  ]\n}",
                "          return { continue: false }\n        },\n      ],\n    },\n  ]\n}",
            )
        ],
    ),
    # ---- absent vs empty ------------------------------------------------------------------------
    (
        "M5 · 🔴 a payload we could not read CLEARS the list · `undefined` — which the SDK's own type "
        "says an older CLI sends — stops meaning *we were not told* and starts meaning *the job is "
        "gone*. A person watches their schedule vanish because a field changed shape",
        [
            (
                CRONS,
                "    if (!Array.isArray(raw)) return undefined",
                "    if (!Array.isArray(raw)) return { type: 'scheduled_work', jobs: [], source }",
            )
        ],
    ),
    (
        "M6 · ⚠️ a hostile payload takes the turn with it · the read is no longer wrapped, so a "
        "getter that throws surfaces inside the CLI's hook machinery at the exact moment a turn is "
        "trying to end. A display fact may not wedge a conversation",
        [
            (
                ADAPTER,
                "            try {\n"
                "              note(input.session_crons)\n"
                "            } catch {\n"
                "              /* a level we could not read is a level we do not publish, never a broken turn */\n"
                "            }\n",
                "            note(input.session_crons)\n",
            )
        ],
    ),
    (
        "M7 · ⛔ the EMPTY level is suppressed with the unreadable ones · nothing can ever say *the "
        "provider reports no scheduled jobs*, so a registry that showed one keeps showing it after "
        "`CronDelete` — 222's stale indicator, on the other event",
        [
            (
                CRONS,
                "    if (!Array.isArray(raw)) return undefined",
                "    if (!Array.isArray(raw) || raw.length === 0) return undefined",
            )
        ],
    ),
    # ---- the design the live capture killed ------------------------------------------------------
    (
        "M8 · 🔴 253's OWN first draft, restored · the empty level is emitted at `system/init` again. "
        "The capture killed it twice: a scheduled FIRE re-announces `init` on the same stream, so a "
        "live job is blanked for the whole fired turn; and a RESUMED session still holds its crons, "
        "so the replayed ledger this was correcting was already right",
        [
            (
                ADAPTER,
                "        if (message.type === 'system' && message.subtype === 'init' && message.model) {",
                "        if (message.type === 'system' && message.subtype === 'init') {\n"
                "          this.noteSessionCrons([], message.subtype)\n"
                "        }\n"
                "        if (message.type === 'system' && message.subtype === 'init' && message.model) {",
            )
        ],
    ),
    # ---- the change gate -------------------------------------------------------------------------
    (
        "M9 · ⚑ every turn end publishes again · the `Stop` hook fires at every turn end and usually "
        "restates the same set, so a conversation grows one ledger row per turn forever to say "
        "nothing new — 052's hazard by a slower route",
        [(CRONS, "    if (fingerprint === this.published) return undefined\n", "")],
    ),
    (
        "M10 · ⚠️ the level becomes a SEQUENCE · a payload that merely reorders the same jobs counts "
        "as a change, so a provider that lists them differently between turns republishes forever "
        "and every consumer re-renders a list that did not move",
        [
            (
                CRONS,
                "      [...jobs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),\n      dropped,\n",
                "      jobs,\n      dropped,\n",
            )
        ],
    ),
    (
        "M11 · ⛔ a shortfall hides behind an unchanged set · `dropped` leaves the fingerprint, so a "
        "payload carrying rows this app cannot list looks identical to one that did not. A person is "
        "being told less than before and nothing says so — 092's rule, defeated by a cache",
        [
            (
                CRONS,
                "      [...jobs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),\n      dropped,\n",
                "      [...jobs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),\n",
            )
        ],
    ),
    # ---- 247's bound bug, in the two places it could come back ------------------------------------
    (
        "M12 · 🔴 247's exact bug, put back · the clip is written the way `truncate` is — keep `max` "
        "and THEN append an ellipsis, so its output is `max + 1`. The schema rejects precisely the "
        "strings that were bounded, and `toWireEvent` degrades the WHOLE event to `unknown`: the row "
        "is lost, not trimmed",
        [
            (
                SCHED,
                "  return text.length > max ? `${text.slice(0, max - 1)}…` : text",
                "  return text.length > max ? `${text.slice(0, max)}…` : text",
            )
        ],
    ),
    (
        "M13 · ⛔ the bound is written to the provider's DOCUMENTED cap · 1000 rather than 1024, so "
        "the `… [+N chars]` marker the provider appends to a clipped prompt is itself clipped off. "
        "The one signal that says *there was more* is the thing that gets cut",
        [(SCHED, "export const MAX_SCHEDULE_PROMPT = 1024", "export const MAX_SCHEDULE_PROMPT = 1000")],
    ),
    (
        "M14 · ⛔ the prompt is passed through unbounded · a model writes cron prompts, so this is "
        "free text arriving from the provider and going straight at a `.max()` schema",
        [
            (
                CRONS,
                "    ...(typeof prompt === 'string'\n"
                "      ? { prompt: clipScheduleText(prompt, MAX_SCHEDULE_PROMPT) }\n"
                "      : {}),",
                "    ...(typeof prompt === 'string' ? { prompt } : {}),",
            )
        ],
    ),
    (
        "M15 · ⚠️ the id is passed through unbounded · same failure, on the one field the whole level "
        "is keyed by — so the event that degrades is the one that identifies the jobs",
        [
            (
                CRONS,
                "    id: clipScheduleText(id, MAX_SCHEDULE_TEXT),",
                "    id,",
            )
        ],
    ),
    # ---- the reader's refusals -------------------------------------------------------------------
    (
        "M16 · ⛔ the cap is gone · one malformed payload becomes a permanent row in every store "
        "downstream (052), and the level fails its own schema on the way out",
        [
            (
                CRONS,
                "      if (jobs.length >= MAX_SCHEDULED_JOBS) {\n        dropped += 1\n        continue\n      }\n",
                "",
            )
        ],
    ),
    (
        "M17 · ⚠️ the cap is SILENT · rows past the ceiling are dropped without being counted, so a "
        "registry showing 100 of 107 says nothing about the seven. A cap is never silent",
        [
            (
                CRONS,
                "      if (jobs.length >= MAX_SCHEDULED_JOBS) {\n        dropped += 1\n        continue\n      }",
                "      if (jobs.length >= MAX_SCHEDULED_JOBS) {\n        continue\n      }",
            )
        ],
    ),
    (
        "M18 · ⛔ a row with a BLANK id becomes a row · it cannot be told apart from the next blank "
        "one, so the fingerprint stops being stable and a list shows an entry nobody can name",
        [
            (
                CRONS,
                "  if (typeof id !== 'string' || id === '') return null",
                "  if (typeof id !== 'string') return null",
            )
        ],
    ),
    (
        "M19 · ⚠️ an unreadable row is dropped in silence · the second half of `dropped`'s job. A "
        "payload of three jobs where one has no id shows two rows and claims to be complete",
        [(CRONS, "      if (job) jobs.push(job)\n      else dropped += 1", "      if (job) jobs.push(job)")],
    ),
    (
        "M20 · ⚠️ a field is copied without checking its type · `recurring` arrives as whatever the "
        "payload held, so a string walks into a `z.boolean()` and the whole event degrades",
        [
            (
                CRONS,
                "    ...(typeof recurring === 'boolean' ? { recurring } : {}),",
                "    ...(recurring === undefined ? {} : { recurring: recurring as boolean }),",
            )
        ],
    ),
    # ---- the taxonomy and the wire ---------------------------------------------------------------
    (
        "M21 · 🔴 a schedule counts as the model WORKING · its Claude producer is the `Stop` hook, so "
        "it is emitted at the instant a turn ENDS. Every conversation that ever scheduled anything "
        "latches busy, with no ending coming — an unchanged level is never republished",
        [
            (
                WORK,
                "const PROVIDER_WORK = new Set<RuntimeEvent['type']>([\n  'assistant_delta',",
                "const PROVIDER_WORK = new Set<RuntimeEvent['type']>([\n  'scheduled_work',\n  'assistant_delta',",
            )
        ],
    ),
    (
        "M22 · ⛔ the wire's own cap goes · the producer's ceiling is not the wire's, and this is the "
        "one that holds when the payload did not come from this adapter — a re-folded ledger row, or "
        "a future producer",
        [(EVENTS, "    .max(MAX_SCHEDULED_JOBS)\n    .optional(),", "    .optional(),")],
    ),
    (
        "M23 · ⛔ the schema end of 247's bound · `.max(1000)` against a producer that legitimately "
        "emits the provider's cap PLUS its marker. Same degradation, arrived at from the other side",
        [
            (
                EVENTS,
                "        prompt: z.string().max(MAX_SCHEDULE_PROMPT).optional(),",
                "        prompt: z.string().max(1000).optional(),",
            )
        ],
    ),
    # ---- the compile floor in apps/desktop --------------------------------------------------------
    (
        "M24 · ⚠️ the raw stream stops describing it · the debug drawer is where you check what the "
        "provider really said, and an empty line there is the one place a new variant can hide",
        [
            (
                DESCRIBE,
                "    case 'scheduled_work': {\n"
                "      const level = event.jobs === undefined ? 'no level' : `${event.jobs.length} scheduled`",
                "    case 'scheduled_work': {\n"
                "      const level = ''",
            )
        ],
    ),
    (
        "M25 · ⚠️ the fold starts making a row · 253's dispatch says *no renderer*; this arm is the "
        "compile floor and nothing else. A transcript row per level change would bury the "
        "conversation under its own schedule",
        [
            (
                FOLD,
                "    case 'scheduled_work':\n      return\n",
                "    case 'scheduled_work': {\n"
                "      state.items.push({\n"
                "        kind: 'unknown',\n"
                "        id: nextId(state, 'unknown'),\n"
                "        provider: 'claude',\n"
                "        category: 'lifecycle',\n"
                "        raw: null,\n"
                "      })\n"
                "      return\n"
                "    }\n",
            )
        ],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = Path(root) / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)")
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace))
    return bad


def main() -> int:
    import sys

    args = sys.argv[1:]
    if args[:1] == ["--count"]:
        print(len(MUTATIONS))
        return 0
    if args[:1] == ["--files"]:
        seen = []
        for _name, edits in MUTATIONS:
            for rel, _find, _replace in edits:
                if rel not in seen:
                    seen.append(rel)
        print(" ".join(seen))
        return 0
    if args[:1] == ["--name"]:
        print(MUTATIONS[int(args[1])][0])
        return 0
    if args[:1] == ["--dry-run"]:
        root = Path(args[1]).resolve()
        bad = 0
        for index in range(len(MUTATIONS)):
            bad += apply(root, index, dry=True)
        print(f"{len(MUTATIONS) - bad}/{len(MUTATIONS)} anchors found exactly once")
        return 1 if bad else 0
    root = Path(args[0]).resolve()
    return apply(root, int(args[1]), dry=False)


if __name__ == "__main__":
    raise SystemExit(main())
