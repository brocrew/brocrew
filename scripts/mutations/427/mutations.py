"""427 · the doors a person actually presses — each row is THE DEFECT, put back (131).

🔴 **This dispatch is a RUN, plus the repairs the run justified.** `423` shipped two surfaces and
said so itself: *"the claim 'a person can do this' rests on a mounted component, not on a running
app."* `427` launched the built app on its own port and its own `--user-data-dir`, created an
identity, placed a conversation as it, and read the answers out of SQLite from a second process.

⚑ **So the table is not about the surfaces — `423` already has that table. It is about the three
things the run found**, plus the two instruments' rules that had to move for it.

## ⚑ The shape of the fix, and therefore the shape of this table

- **§1 · what a person reads when a door refuses** (`M1`–`M5`) — `423` F3, predicted and unseeable.
  The live run read *"Error invoking remote method 'runtime:command': Error: cwd does not exist:
  …"* off two project doors and the app's own sentence off the `+`. The census that keeps it
  honest, and the two repairs it names.
- **§2 · the census's own reader** (`M6`–`M10`) — a census is only as good as the shapes it can
  see, and every rule in it is planted against in `§0`.
- **§3 · the roster a save left behind** (`M11`–`M12`) — a project edited on the sheet stayed stale
  in every surface that lists projects, including one that then told a person the wrong thing
  about where their conversation would run.
- **§4 · the placed door's reach** (`M13`–`M16`) — what `StartAsAgent` can express, read out of
  the component, so an instrument can say how much of its interim door is waiting on a surface.
- **§5 · the step that lost its ANSWER** (`M17`) — `69b`, and the pinned set of steps that can
  go red for nobody.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M12` | ⚑ **`run_suite desktop`** — `apps/desktop/test/what-a-person-reads-when-a-door-refuses.test.ts` (`M1`–`M10`) and `apps/desktop/test/project-store.test.ts` (`M11`–`M12`) |
| `M13`–`M18` | ⚑ **`run_suite scripts`** — `scripts/test/front-door.test.mjs` (`M13`–`M15`, `M18`), `scripts/test/front-door-hook-reach.test.mjs` (`M16`), `scripts/test/step-census.test.mjs` (`M17`) |

⚠️ **`423` filed three rows under a gate that could not see them and one of them SURVIVED.** The
lesson taken here: every row below names the FILE that kills it, not the project, and was applied
alone and watched go red against that file — `verify-each-mutation-row-without-running-the-table`.
⛔ **No table was run.**

## ⛔ What this table deliberately does NOT contain

⛔ **No row on `fieldsOf`'s line-comment filter.** It was written, and then measured: a `//` line
can never be mistaken for a field, because the pattern wants an identifier character straight
after the indent and `/` is not one. ⚑ **The filter was a no-op, so it was removed rather than
given a row** — `a-line-no-mutation-can-kill-is-not-carrying-its-rule`, and a row over it would
have been a `true` mutation reporting as a survivor.

⛔ **No row on the renderer prose-strip firing against the tree as it stands.** Measured both ways
at `427`: with stripping ON and OFF the renderer yields the same **zero** offences — there is no
docblock in it quoting a catch's `.message` today. ⚑ The rule stays because the next comment
explaining why a handler stopped reading `.message` would put a phantom offence in front of
whoever wrote it, and it is killable through the fixture in `§0` rather than through the tree
(`M6` is that row).

⛔ **No row on the count `ui-live-smoke.mjs` prints about its own interim door.** The GROUPING is
live-only output and no gate can read it; what it is computed FROM —
`whatThePlacedDoorCannotCarry` and `placedDoorSends` — is gated, and that is `M13`–`M16`. ⚠️ This
is `420` §5.8's admission, unchanged: a printed summary is the one thing `pnpm run ci` cannot see.

⛔ **No row on `two-doors-probe.mjs`'s steps.** It is a live-only instrument; a mutation to a step
body would survive every gate in this repo. ⚑ **What IS gated is the hooks it addresses**, by
`scripts/test/front-door-hook-reach.test.mjs`, and `M16` is that row.

⛔ **No row on the new *"every `WITHDRAWN` entry declares `partial`"* assertion.** Deleting an
assertion is invisible to the file that holds it (`a-mutation-on-a-census-is-invisible-to-that-census`)
— it was written, run, and **SURVIVED**, which is the row reporting its own unsoundness rather
than a gap in the gate. ⚑ The guard stays; what keeps it there is review, and this paragraph.

🔴 **And `M17` survived its first shape too, for a worse reason.** Every expectation in
`step-census.test.mjs` re-derived itself from `WITHDRAWN`, so flipping one entry's `partial` moved
the instrument's answer and the test's expectation together and the arithmetic stayed
self-consistent — `a-fixture-built-with-the-helper-under-test-proves-nothing`, inside a census's
own test. ⛔ **The fix is a PINNED set** of the steps that can go red for nobody, added in the same
commit; `M17` is red against that and against nothing else.

⛔ **No row on `readableError`'s missing `^` anchor.** Removing it would survive: no sentence this
app composes contains the wrapper's text in the middle, so the control in `§3` cannot tell the two
regexes apart. ⚠️ **Naming it rather than planting a contrived fixture** — a message a person could
actually meet is the only fixture worth having here, and there is no such message.
"""

CENSUS = "apps/desktop/test/what-a-person-reads-when-a-door-refuses.test.ts"
RECORD = "apps/desktop/src/renderer/src/lib/session-record.ts"
PROJECTS = "apps/desktop/src/renderer/src/lib/project-store.ts"
LAUNCHER = "apps/desktop/src/renderer/src/components/NewConversation.vue"
APP_SOURCE = "scripts/lib/app-source.mjs"
DRAFT_SURVIVES_A_RESTART_PROBE = "scripts/draft-survives-a-restart-probe.mjs"
DOORS = "scripts/lib/front-door.mjs"
SOURCE = "scripts/lib/app-source.mjs"
STEPS = "scripts/lib/step-census.mjs"
PROBE = "scripts/two-doors-probe.mjs"

MUTATIONS = [
    # ── §1 · what a person reads when a door refuses ──────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row plants the `create` door of
        # the project store (`renderer/src/lib/project-store.ts`), and that file no longer exists at
        # HEAD. Commit bd70d693 says: "Projects stop being something a person or a model meets:
        # create_project and list_projects, the project rooms, board, sheet and picker, project
        # folders and their rails ... are removed"; its stat deletes ProjectSheet.vue,
        # NewProject.vue and useProjectStore.ts. The wider rule (a refusal reads through
        # readableError) still lives in agent-store.ts, but this row's gesture (choose a project
        # folder, press Create) is gone. Its anchor is left stale, so the census records it retired.
        "M1 · 🔴 THE DEFECT, verbatim · a person who chose a folder that moved before they pressed "
        "Create reads `Error invoking remote method 'runtime:command': Error: cwd does not exist: "
        "…` — the IPC library naming a method they have never heard of, in front of the only fact "
        "in the sentence. ⚑ Read off a running app at `427`, from this exact gesture",
        [
            (
                PROJECTS,
                "        return readableError(error)\n      }\n    },\n\n    async save(projectSlug, edit) {",
                "        return error instanceof Error ? error.message : String(error)\n      }\n    },\n\n    async save(projectSlug, edit) {",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row plants
        # `saveProject`/`checkFolder` in `project-store.ts`, which D-016 deleted together with the
        # project sheet. Card D-016a: "projects as something a person or model meets ... project
        # folders and their rails" were removed deliberately, so there is no project door left to
        # refuse a vanished folder. Its anchor is left stale, so the census records it retired.
        "M2 · 🔴 the same sentence one surface over · `saveProject` refuses a folder that vanished "
        "between the check and the press, and the project sheet shows the wrapper. ⛔ Both doors "
        "were measured live in one run, and the `+` beside them was NOT — which is what makes the "
        "pair a measurement rather than a screenshot",
        [
            (
                PROJECTS,
                "        return readableError(error)\n      }\n    },\n\n    checkFolder(path) {",
                "        return error instanceof Error ? error.message : String(error)\n      }\n    },\n\n    checkFolder(path) {",
            )
        ],
    ),
    (
        "M3 · ⚠️ the launcher's sign-in notices go back to the library's words · `417` deleted the "
        "settings block but left four auth gestures on this surface, and each of them reports a "
        "rejection to a person. ⛔ The one this repo cannot test behaviourally: a fake bridge "
        "rejects with a plain `Error`, so the wrapper is never there to strip",
        [
            (
                LAUNCHER,
                "      if (stillAsking(asked)) authNotice.value = readableError(error)\n    }\n  })\n  // Re-ask rather than assume the copy fixed it.",
                "      if (stillAsking(asked))\n        authNotice.value = error instanceof Error ? error.message : String(error)\n    }\n  })\n  // Re-ask rather than assume the copy fixed it.",
            )
        ],
    ),
    (
        "M4 · ⛔ the class name survives the strip · `AuthUnavailableError: your sign-in expired` "
        "is exception taxonomy wearing a sentence's clothes, and `readableError`'s own docblock "
        "says so — *which is exception taxonomy, not something to show a person*",
        [
            (
                RECORD,
                "  return raw.replace(/^Error invoking remote method '[^']*':\\s*(\\w*Error:\\s*)?/, '')",
                "  return raw.replace(/^Error invoking remote method '[^']*':\\s*/, '')",
            )
        ],
    ),
    (
        "M5 · 🔴 the strip is not done at all · every repaired site goes back at once, silently, "
        "because nothing else in the renderer re-implements it — which is the whole argument for "
        "there being one function",
        [
            (
                RECORD,
                "  return raw.replace(/^Error invoking remote method '[^']*':\\s*(\\w*Error:\\s*)?/, '')",
                "  return raw",
            )
        ],
    ),
    # ── §2 · the census's own reader ──────────────────────────────────────────────────────────
    (
        "M6 · ⛔ prose is not stripped before the census asserts · a docblock explaining why a "
        "handler STOPPED reading `.message` becomes an offence against the person who wrote it — "
        "`a-source-census-must-strip-prose-before-it-asserts`, arriving through the comment that "
        "records the fix",
        [
            (
                CENSUS,
                "  return source\n    .replace(/\\/\\*[\\s\\S]*?\\*\\//g, '')\n    .replace(/<!--[\\s\\S]*?-->/g, '')",
                "  return source\n    .replace(/<!--[\\s\\S]*?-->/g, '')",
            )
        ],
    ),
    (
        "M7 · ⛔ the `.message` rule is gone, so the census sees only stringification · the "
        "commonest spelling in this repo — seventeen handlers before `427` — becomes invisible and "
        "the file reports a clean renderer",
        [
            (
                CENSUS,
                "  if (new RegExp(`\\\\b${id}\\\\s*\\\\??\\\\.message\\\\b`).test(body)) found.push(`${binding}.message`)",
                "",
            )
        ],
    ),
    (
        "M8 · ⛔ the `String(<id>)` rule is gone · `String(cause)` on an `Error` is "
        "`\"Error: <the same message>\"`, so the half that looks innocent is exactly as loud as the "
        "half that does not — and the census would pass a renderer that used it everywhere",
        [
            (
                CENSUS,
                "  if (new RegExp(`\\\\bString\\\\(\\\\s*${id}\\\\s*\\\\)`).test(body)) found.push(`String(${binding})`)",
                "",
            )
        ],
    ),
    (
        "M9 · 🔴 the rule stops being built from the BINDING · `.message` is an ordinary field in "
        "this tree — `event.message`, `catalogue.message` — so a bare pattern reports a correct "
        "handler that logs one beside a repaired refusal. "
        "`an-assertion-can-be-satisfied-by-a-neighbouring-element`, inverted: the neighbour "
        "convicts instead of acquitting",
        [
            (
                CENSUS,
                "  if (new RegExp(`\\\\b${id}\\\\s*\\\\??\\\\.message\\\\b`).test(body)) found.push(`${binding}.message`)",
                "  if (/\\.message\\b/.test(body)) found.push(`${binding}.message`)",
            )
        ],
    ),
    (
        "M10 · ⛔ the catch body is a fixed slice again · three lines after the `catch`, so a long "
        "handler is judged on its opening and a short one on its neighbour — "
        "`a-fixed-width-slice-runs-into-the-next-region`, in the reader that decides what counts "
        "as inside a handler at all",
        [
            (
                CENSUS,
                "    blocks.push({ binding: found[1], body: code.slice(open + 1, end) })",
                "    blocks.push({\n      binding: found[1],\n      body: code.slice(open + 1).split('\\n').slice(0, 3).join('\\n'),\n    })",
            )
        ],
    ),
    # ── §3 · the roster a save left behind ────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row plants the project store's
        # `save` re-reading the roster (`project.value = saved`), and `project-store.ts` and its
        # test are deleted. D-016's commit message removes "the project rooms, board, sheet and
        # picker", and the rail/StartAsAgent notice about a project folder went with them. Its
        # anchor is left stale, so the census records it retired.
        "M11 · 🔴 THE DEFECT, found live · a save does not re-read the roster, so `loadAll`'s one "
        "run at mount is the last word: the rail keeps the old name and description, and "
        "`StartAsAgent` tells a person *this project has no folder, so the conversation runs in "
        "the app's own workspace* about a folder they set thirty seconds earlier — and then places "
        "the conversation in that folder anyway, because the host reads the database. ⛔ Invisible "
        "to every mount test: both halves are correct in isolation and the lie is in a THIRD "
        "surface reading a fourth piece of state",
        [(PROJECTS, "        project.value = saved\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row is the control for M11 and
        # lives in the same deleted `project-store.ts` (`There is no project called
        # ${projectSlug}.`). Retired with M11 under D-016a's removal of projects as a surface. Its
        # anchor is left stale, so the census records it retired.
        "M12 · ⚠️ the control goes too · a save that matched NO project re-reads the roster anyway, "
        "which is this store asking a question its own answer says is moot — and it hides `M11` by "
        "making the re-read unconditional, so the pairing is what keeps `M11` honest",
        [
            (
                PROJECTS,
                "        if (saved === null) return `There is no project called ${projectSlug}.`",
                "        if (saved === null) {\n          await readAll()\n          return `There is no project called ${projectSlug}.`\n        }",
            )
        ],
    ),
    # ── §4 · the placed door's reach ──────────────────────────────────────────────────────────
    (
        "M13 · 🔴 `approvalMode` is judged on its NAME instead of its VALUE · the sheet sends the "
        "literal `'ask'`, so `'auto' on turn 1` reads as something a person could ask for — and "
        "`420` measured that every live approval control is queued for the NEXT message, which "
        "means there is no surface for it anywhere in the product. "
        "`a-comparison-tested-where-both-sides-agree` avoided by testing the same key twice",
        [
            (
                DOORS,
                "      field === 'approvalMode' ? placement.approvalMode !== 'ask' : !sends.includes(field),",
                "      !sends.includes(field),",
            )
        ],
    ),
    (
        "M14 · ⛔ an empty field list is accepted · every placement reports as movable, so the "
        "count that says how much of the interim door is still waiting on a surface reads zero on "
        "the day the component becomes unreadable. ⚠️ The direction that flatters the product",
        [
            (
                DOORS,
                "  if (!Array.isArray(sends) || sends.length === 0) {",
                "  if (false) {",
            )
        ],
    ),
    (
        "M15 · ⛔ a block comment inside the payload counts as a field · the day somebody writes "
        "*projectSlug: removed at 431* inside a `/* … */` in `StartAsAgent.vue`, the door is "
        "credited with a field it no longer sends and one more placement reads as movable",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — `fieldsOf` in
        # scripts/lib/app-source.mjs still strips block comments first, but it is now a multi-line
        # chain that also matches spread fields, so the old one-line anchor is gone. The defect is
        # the same: remove the strip so a `/* projectSlug: ... */` note counts as a field.
        # front-door.test.mjs still pins it ('fieldsOf counts no field that only a comment
        # mentions').
        [
            (APP_SOURCE, "      .replace(/\\/\\*[\\s\\S]*?\\*\\//g, '')\n      .matchAll(", '      .matchAll('),
        ],
    ),
    (
        "M16 · ⛔ the live probe addresses a hook the renderer does not draw · it is a live-only "
        "instrument, so nothing but this census can see a selector that has stopped resolving — "
        "which is `417`'s own defect, on the newest script in the tree",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired —
        # scripts/two-doors-probe.mjs was deleted by D-016, but the census rule (a live probe must
        # not address a hook the renderer has stopped drawing) is live, and
        # draft-survives-a-restart-probe.mjs is one of the pinned DRIVERS. Its only hook is
        # `[data-cy="prompt-input"]` (drawn by PromptComposer.vue:1247), so renaming it to a hook
        # nobody draws fails the same census for the same reason.
        [
            (DRAFT_SURVIVES_A_RESTART_PROBE, 'const COMPOSER = \'[data-cy="prompt-input"]\'', 'const COMPOSER = \'[data-cy="prompt-input-box"]\''),
        ],
    ),
    (
        "M18 · ⛔ a token that is not declared answers `''` instead of stopping · every derived "
        "value in `app-source.mjs` is a STOP on a miss for one reason — an `undefined` turns an "
        "assertion into one that cannot fire — and a colour is the worst case: the live step "
        "compares it to what the app painted and would pass for any app at all",
        [
            (
                SOURCE,
                "    throw new Error(\n      `⛔ ${name} is not declared in tokens.css's :root block.",
                "    return '' && new Error(\n      `⛔ ${name} is not declared in tokens.css's :root block.",
            )
        ],
    ),
    # ── §5 · the step that lost its answer ────────────────────────────────────────────────────
    (
        "M17 · ⛔ `69b` is classified as a step that still runs, so its NOT PERFORMED row counts "
        "towards `appDefectOnly` · a step that can go red for nobody inflates the number that is "
        "supposed to mean *a red here can only be the app* — `196`'s defect at the level of the "
        "whole suite",
        [
            (
                STEPS,
                "    partial: false,\n    why: 'the two halves of step 69",
                "    partial: true,\n    why: 'the two halves of step 69",
            )
        ],
    ),
]
