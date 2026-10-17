"""402 · a runner that performs the loop — each row is THE DEFECT, put back (131).

🔴 **Two subjects, one shape.** The dispatch fixed a red `smoke:resume` on both providers and built
the runner that performs HO-018 §4's exit. ⛔ **Both halves were red for the same reason and it is
worth naming once**: an instrument stated a fact instead of deriving it, and the fact moved.

| the instrument | what it stated | what moved it |
|---|---|---|
| `smoke:resume` step 5, `smoke:ui` ×3 | `rgb(247, 248, 250)` / `#e7ecf3` | ⚠️ `391` moved the palette |
| the BroBot factory text | *"Delegate that to a project manager"* | ⛔ nothing — it was never true |

⚑ **The second is the sharper one and it was SHIPPING.** Measured live on Codex from `399`'s own
evidence: the model read the app's instructions, obeyed them, called `spawn_agent`, and was refused
by this app's own rail — `not-in-can-spawn`, `until-a-person-changes-it`, `retryable: false`. Claude
had been passing the same step by DISOBEYING the same sentence.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M5` | ⚑ **`run_suite`** — `apps/desktop/test/the-text-a-child-is-actually-told.test.ts` §9 |
| `M6`–`M10` | ⚑ **`run_suite`** — `scripts/test/paper-ground.test.mjs` |
| `M11`–`M14` | ⚑ **`run_suite`** — `scripts/test/lifecycle-steps.test.mjs` |

## ⛔ What this table deliberately does NOT contain

⛔ **No row inside `lifecycle-stage.smoke.ts`'s performance, and that is a real limit stated rather
than hidden.** Every assertion in that file is answered by a live provider, so a row there is killed
only by a run that costs two provider sessions and forty minutes — which `mutations:check` neither
does nor should. ⚑ **What CAN be pinned is pinned**: the report is a pure function
(`lifecycle-steps.mjs`) with `M11`–`M13`, and the two censuses that hold the stage and the roster
together are `M14`.

⛔ **No row deleting a step from the runner's performance.** A deleted step reads as `NOT REACHED` on
every future run, which is the table's own answer already — the row would be *the feature is not
built*, and `M11` is that one layer down where a test can see it.

⛔ **No row on the four live assertions in `resume-live-smoke.mjs` and `ui-live-smoke.mjs`.** They
call `paperVerdict` and `chromeInkVerdict` now, which is exactly what makes `M6`–`M10` possible:
`196` H3's precedent — *"lifted out of the smoke so it can be asserted at all"* — one subject over.

⛔ **No row flipping `PAPER_FLOOR` to `0`.** ⚠️ It reads as a row and is not one: the claim-3 test's
regex is built FROM the constant, so a bound written as the constant cannot pin it
(`a-bound-written-as-the-constant-cannot-pin-it`). ⚑ `M8` is the row that reaches the same defect
through the comparison instead, and `paper-ground.test.mjs` pins the floor between the darkest paper
and the lightest chrome this app ships rather than at a number.
"""

FACTORY = "apps/desktop/src/main/runtime/factory-text.ts"
PAPER = "scripts/lib/paper-ground.mjs"
STEPS = "scripts/lib/lifecycle-steps.mjs"
STAGE = "apps/desktop/smoke/lifecycle-stage.smoke.ts"

# ⛔ **Anchored on the code lines alone and never on the comment above them**
# (`a-source-census-that-pins-a-line-kills-every-row-on-it`).
# ⚑ **RE-ANCHORED at `511`, and every row below is unchanged.** That dispatch gave the project
# manager a second grant that starts conversations (`canStaff`), so the predicate reads
# `producesAConversationOfItsOwn` — one function shared with `runtime-host.ts`'s
# `nativeDelegationContext`, which was asking the same question off `canSpawn` alone. ⛔ **The
# DEFECTS are the same three**: the branch forced true, the branch answered from REACH, and `null`
# taking the granted arm. Each re-verified RED individually.
PREDICATE = (
    "function mayStartAConversation(capabilities: ProfileCapabilities | null): boolean {\n"
    "  return capabilities !== null && producesAConversationOfItsOwn(capabilities)\n"
    "}"
)

PM_UNGRANTED = (
    "            'You may start no conversation of your own, so scope AND do this work yourself ' +\n"
    "              'rather than waiting on an agent you cannot start.',\n"
    "            'Tell whoever gave you this project when a piece of work would be better done by an ' +\n"
    "              'agent of its own, so that a person can grant you one.',\n"
)

# ⚑ **REPLACEMENT SIDE CORRECTED IN PLACE BY 497.** `497` rewrote the first of these two
# sentences — HO-035's vacation test; *read the ticket, read a spec, look at a repository outline*
# named one workflow's artefacts — and this constant is a row's NEW text, never its anchor.
# ⛔ **`mutations:check` reads anchors and is blind to a replacement** (`366`, `459`), so leaving
# it would have left `M8` inserting a granted arm that no longer exists: the row would still apply,
# still report a verdict, and no longer be the swap its label describes.
PM_GRANTED = (
    "            'Investigate only far enough to scope the work: read what you were given and skim ' +\n"
    "              'what it points at. When you need more than that, delegate it.',\n"
    "            'Do not implement or investigate deeply yourself. Delegate focused work so that it ' +\n"
    "              'gets its own context.',\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the instruction this app gave and then refused ────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (T-002): PE-003 (one situational instruction set for every agent; the role column is no longer read) removed `mayStartAConversation` and the role lines it branched; the one set now says *if your grants permit it*.**
        # Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M1 · 🔴 the shipped defect, put back · every BroBot is told to delegate to a project manager "
        "whatever it may create, so a fresh install's first conversation obeys an instruction the "
        "app's own spawn rail refuses `not-in-can-spawn` — permanently, `retryable: false`, on the "
        "one door a person can open. ⚠️ Measured live: Codex obeyed and answered NOT-WRITTEN; Claude "
        "passed the same step on the same commit by disobeying it",
        [(FACTORY, PREDICATE, PREDICATE.replace("capabilities !== null && producesAConversationOfItsOwn(capabilities)", "true"))],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-002): PE-003 (one situational instruction set for every agent; the role column is no longer read) removed `mayStartAConversation`.**
        # Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M2 · ⛔ the predicate widens to REACH · `canMessage` is read as a licence to delegate, so "
        "every identity that may message anybody is told to hand work to a project manager it "
        "cannot create — which is the ruled default, so it is nearly every identity in the app. "
        "⚠️ **`409` moved where this is measurable and not what it measures**: the two readings now "
        "AGREE on BroBot, which is seeded both, so the killers are the identities that hold the "
        "ruled `same-project` and no spawn grant. ⚑ Reach is not the grant that produces a manager, "
        "and `374`'s own rule is that a rail reads the capability it is about",
        [
            (
                FACTORY,
                "  return capabilities !== null && producesAConversationOfItsOwn(capabilities)\n",
                "  return capabilities !== null && capabilities.canMessage !== 'none'\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-002): PE-003 (one situational instruction set for every agent; the role column is no longer read) removed `mayStartAConversation`.**
        # Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M3 · ⛔ an absent identity row is read as permission · `null` takes the GRANTED branch, so "
        "the one conversation that certainly cannot delegate is the one told to — `instructionContext` "
        "composes a bundle BEFORE `store.create` writes the row, and `assertMaySpawn` answers "
        "`?? DEFAULT_CAPABILITIES` for the same absence. ⚠️ This is the first launch on every fresh "
        "install",
        [
            (
                FACTORY,
                "  return capabilities !== null && producesAConversationOfItsOwn(capabilities)\n",
                "  return capabilities === null || producesAConversationOfItsOwn(capabilities)\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-002): PE-003 (one situational instruction set for every agent; the role column is no longer read) removed the project manager's role lines.**
        # Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M4 · 🔴 the rule is made at one of two depths · a project manager granted no `can_spawn` is "
        "told to delegate anyway, so the fix holds for the role the resume smoke happens to drive and "
        "fails for the one the runner drives — `an-exception-made-at-one-depth-of-a-walk`, with the "
        "same rail refusing at both",
        [(FACTORY, PM_UNGRANTED, PM_GRANTED)],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-002): PE-003 (one situational instruction set for every agent; the role column is no longer read) removed `role.lines` and the literal it could be handed.**
        # Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M5 · ⛔ the section and the grant list are read twice · the role text is rendered from a "
        "literal while `## What you have been granted` still prints the real list, so one bundle tells "
        "an agent to delegate three lines above the line saying it may create nobody — two answers to "
        "one question, and the one a person never reads is the instruction",
        [
            (
                FACTORY,
                # ⚠️ **Anchor and replacement corrected by `412`, not retired.** `lines` takes
                # {@link GrantedActs} rather than one boolean now, because a second branched
                # sentence arrived. ⛔ **The mutation is the SAME one**: the spawn branch is forced
                # true and every other act is still read from the grant, so what this row breaks is
                # exactly what it broke before — the role text and the grant list disagreeing.
                "    const lines = role.lines(grantedActs(context.capabilities))\n",
                "    const lines = role.lines({\n"
                "      ...grantedActs(context.capabilities),\n"
                "      mayStartAConversation: true,\n"
                "    })\n",
            )
        ],
    ),
    # ── §2 · "on paper", measured instead of restated ──────────────────────────────────────────
    (
        "M6 · 🔴 the scope control goes · a surface that stopped applying `[data-chat-theme='light']` "
        "paints the app's near-black ground AND resolves `--chat-bg` to it, so the two agree and the "
        "check passes on a build where the conversation is not paper at all — `390`'s finding, as the "
        "row that puts it back",
        [
            (
                PAPER,
                "  if (read.paperScoped === read.paperRoot) {\n",
                "  if (false) {\n",
            )
        ],
    ),
    (
        "M7 · ⛔ the token is read outside the scope that redeclares it · both reads come off "
        "`documentElement`, so claim 2 compares a value with itself and holds for every build — "
        "`read-a-token-in-the-scope-that-redeclares-it`, arriving as the thing it warns about",
        [
            (
                PAPER,
                "    `paperScoped: getComputedStyle(${element}).getPropertyValue('--chat-bg').trim(), ` +\n",
                "    `paperScoped: getComputedStyle(document.documentElement).getPropertyValue('--chat-bg').trim(), ` +\n",
            )
        ],
    ),
    (
        "M8 · ⛔ *on paper* becomes a tautology · the luminance floor goes, so a palette that set "
        "`--chat-bg` to near-black passes both surviving claims while the conversation stops being "
        "paper. ⚑ This is the claim the hex literal was standing in for, and the only one of the "
        "three that a palette move cannot satisfy",
        [
            (
                PAPER,
                "  const light = luminance(painted)\n  if (light < PAPER_FLOOR) {\n",
                "  const light = luminance(painted)\n  if (false) {\n",
            )
        ],
    ),
    (
        "M9 · ⛔ an unreadable ground passes quietly · a colour this parser cannot read is treated as "
        "*probably fine* rather than as unreadable, so the day a token is written `oklch(…)` or "
        "`color-mix(…)` the whole check goes blank and green in one commit",
        [
            (
                PAPER,
                "  if (painted === null) {\n"
                "    throw new Error(`${where}: cannot read a ground colour from ${JSON.stringify(read?.paperBg)}`)\n"
                "  }\n",
                "  if (painted === null) {\n    return `${where}: unreadable`\n  }\n",
            )
        ],
    ),
    (
        "M10 · 🔴 the chrome control loses its own control · `sceneInk` stops being compared, so an "
        "app that stopped scoping ink ANYWHERE passes — every element resolving `:root` — and the row "
        "that exists to catch a light scope leaking into the chrome is green over the feature's "
        "absence. ⚠️ `a-comparison-tested-where-both-sides-agree`",
        [
            (
                PAPER,
                "  if (read.ink === read.sceneInk) {\n",
                "  if (false) {\n",
            )
        ],
    ),
    # ── §3 · the report, computed from the outcome ─────────────────────────────────────────────
    (
        "M11 · 🔴 a partial run prints the success line · `complete` asks whether ANY row passed, so a "
        "runner that died after row 1 says *the project lifecycle was performed end to end* — §3.3 by "
        "name: *a preview and a partial run must not be able to print a success line*",
        [
            (
                STEPS,
                "    complete:\n"
                "      rows.every((row) => row.verdict === 'PASS') && extra.every((row) => row.verdict === 'PASS'),\n",
                "    complete: rows.some((row) => row.verdict === 'PASS'),\n",
            )
        ],
    ),
    (
        "M12 · ⛔ a step nobody reached is omitted rather than named · the table drops every row with "
        "no observation, so a run that derailed at row 3 prints a three-row table that reads as a "
        "complete performance — the brief's *every step it could not perform is named as not "
        "performed. Not omitted*",
        [
            (
                STEPS,
                "  const rows = LIFECYCLE_STEPS.map((step) => {\n",
                "  const rows = LIFECYCLE_STEPS.filter((step) => last.has(step.id)).map((step) => {\n",
            )
        ],
    ),
    (
        "M13 · ⛔ a FAIL the diagram does not name stops counting · `the kill never arrived` and `the "
        "stage itself` are exactly the rows that carry a failure with no roster entry, and dropping "
        "them from the headline turns the sharpest reds in the instrument into blank space beside a "
        "green success line",
        [
            (
                STEPS,
                "    complete:\n"
                "      rows.every((row) => row.verdict === 'PASS') && extra.every((row) => row.verdict === 'PASS'),\n",
                "    complete: rows.every((row) => row.verdict === 'PASS'),\n",
            )
        ],
    ),
    (
        "M14 · 🔴 the killed process reports its own kill · the stage writes row 12 itself, so the "
        "verdict is stamped BEFORE the signal and the only process that could correct it is the one "
        "that dies. ⚑ `a-report-must-be-computed-from-the-outcome`, in the one place where the "
        "difference between a plan and an outcome is a `SIGKILL`",
        [
            (
                STAGE,
                "          note(\n"
                "            '11b the worker has open work and the runner has been signalled',\n",
                "          note(\n"
                "            '12 the app is killed while that work is open',\n",
            )
        ],
    ),
]
