"""405 · a refusal you can see — each row is THE DEFECT, put back (131).

🔴 **One subject: a rail that fired and left no trace.** ⛔ `402` F2 read a real Codex worker's
ledger after this app refused its `spawn_agent` and found the two rows an ADMITTED spawn writes:

    tool_call    name: brobot__spawn_agent   summary: dynamicToolCall
    tool_result  summary: dynamicToolCall    ok: true

⚑ **`ok: true` is CORRECT** (`307`) — a refusal is a successful call whose payload denies the
request — ⛔ **and nothing normalises `structured`**, so *"a person reading the transcript of a child
this app refused sees a tool call that worked."*

🔴 **HO-019 §4:** *"our entire rail discipline is demonstrated by an actual refusal — and if the
ledger cannot tell the two apart, that discipline is provable in TESTS and invisible in
PRODUCTION."*

## ⛔ Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M12` | ⚑ **`run_suite`** — `apps/desktop/test/a-refusal-you-can-see.test.ts` |

## ⚠️ What this table deliberately does NOT contain

⛔ **No row moving `refusalIn`'s `outcome !== 'refused'` discriminant.** ⚠️ It reads as a row and is
not one: an `ok` payload carries no `rail` and no `permanence`, so a wrapper that stopped checking
the discriminant would fall through to the same `null` by the next test down — the assertions all
read identically and the row would be unkillable
(`a-line-no-mutation-can-kill-is-not-carrying-its-rule`). ⚑ What that check buys is silence in the
log for the ordinary case, which is legibility rather than behaviour.

⛔ **No row deriving `retryable` from `permanence` at write time.** ⚠️ Every rail in every one of the
seven vocabularies derives it exactly that way today, so the replacement is TRUE for every input this
suite can produce — a mutation whose value never differs is a phantom survivor
(`a-mutation-that-changes-nothing-reports-as-a-survivor`). ⚑ `M4` puts the same rule back as a
CONSTANT, which does differ, and the event's own docblock carries the reason the derivation must not
move into the writer.

⛔ **No row inside any rail's `PERMANENCE` table.** ⚑ Those are `341`'s and each vocabulary's own
table owns them; this dispatch moved whether a refusal is RECORDED and never what any rail means.

## ⚑ Four anchors corrected in place by `425`

⛔ **`M6`, `M8`, `M9` and `M11` carry the `⚑ ANCHOR CORRECTED IN PLACE BY 425` suffix.**
⚠️ **On a table with a recorded run that suffix changes each row's identity and moves the table to
`partial-or-invalid`** — which is what `421` measured when it corrected `151` and `401`. ⛔ **This
table has never been RUN**: the census calls it `unrun`, there is no artifact, and there is therefore
no verdict for the correction to invalidate. 🔴 **So the suffix here is a marker for the next reader
and nothing more, and the evidence these four rows still bite is the individual re-verification
below** — not a state change in `CENSUS.md`.

⛔ **All four anchor on lines `425` edited** to carry a fifth fact — the remedy —
through `refusalIn`, the writer, the notice and the raw line. ⚠️ **The anchors were corrected rather
than retired** (`correct-a-stale-mutation-anchor-dont-retire-it`): every one of these rows still
protects exactly what it protected, and retiring a row because somebody edited the line under it is
how a guarantee goes dark.

🔴 **Their recorded RED was measured against the OLD text and is not evidence about the new**
(`a-corrected-anchor-keeps-a-verdict-it-never-earned`). ⚑ **All four were re-applied alone against the
corrected anchors by `425` and watched go red** against `a-refusal-you-can-see.test.ts`, and the
replacements were adjusted so each still measures ONE thing: `M8` keeps the new field on the row it
appends wrongly, and `M11` keeps the new clause while removing only the rail.
"""

TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
DESCRIBE = "apps/desktop/src/renderer/src/lib/describe-event.ts"
STAGE = "apps/desktop/smoke/lifecycle-stage.smoke.ts"

# ⛔ **Anchored on the code lines alone and never on the comment above them**
# (`a-source-census-that-pins-a-line-kills-every-row-on-it`).
WRAPPED = "    ].map(recordsWhatItRefused),\n"

RECORD = (
    "      const refused = refusalIn(one.name, answered.structured)\n"
    "      if (refused !== null) host.noteRefusal(me, one.name, refused)\n"
    "      return answered\n"
)

CALL = "      const answered = await one.call(args)\n"

# ⚑ **ANCHOR CORRECTED IN PLACE BY 425** — `refusalIn` now reads a fourth field, the remedy, before
# these two lines. The rule `M6` measures is unchanged: a payload that cannot be read is not published
# as a partial row.
READABLE = (
    "  if (typeof rail === 'string' && rail.length > 0 && isRailPermanence(permanence)) {\n"
    "    if (typeof retryable === 'boolean') return { rail, permanence, retryable, remedy: said }\n"
    "  }\n"
)

# ⚑ **ANCHOR CORRECTED IN PLACE BY 425** — the published row gained `remedy`. `M8` is about WHICH
# WRITER appends, not about which fields are on the row, so the replacement below carries the same six
# members: a row that also lost a field would be two defects wearing one label.
WRITER = (
    # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 351e0ddc4 added full refusal words; carry those unchanged while using the same wrong store-side ordinal write.
    "    this.publishOurs(session, {\n      type: 'tool_refused',\n      tool,\n      rail: refused.rail,\n      permanence: refused.permanence,\n      retryable: refused.retryable,\n      // ⛔ **425 · carried, never composed here** (HO-023 §2.2). The word was decided by the rail's\n      // own table at the door that refused, re-derived by the carrier, and read back off the payload\n      // the model was handed. ⚑ A host that chose one would be an eighth place the policy lives.\n      remedy: refused.remedy,\n      // ⚑ The sentence the caller was handed, so the row can say it in full after a restart.\n      ...(refused.told === undefined ? {} : { told: refused.told }),\n    })\n"
)

WHOSE_LEDGER = (
    "    const slot = this.slots.get(sessionId)\n"
    "    const session = slot?.phase === 'live' ? slot.session : null\n"
)

# ⚑ **ANCHOR CORRECTED IN PLACE BY 425** — the notice gained a fifth clause. `M9` deletes the whole
# arm, which is the same defect it always was: the row is in the ledger and the transcript draws
# nothing.
# ⚑ **ANCHOR CORRECTED IN PLACE BY 685** — the arm gained one line, the notice waiting for its call's
# receipt (`675` F-d). `M9` still deletes the whole arm and measures the same defect.
DRAWN = (
    # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. The receipt wait now receives host-kept refusal text; still suppress the whole refused-tool transcript row.
    "    case 'tool_refused':\n      notice(\n        state,\n        'warn',\n        `refused: ${event.tool} · ${event.rail} · ${permanenceSaid(event.permanence)} · ${\n          event.retryable ? 'retrying may work' : 'retrying will not help'\n        }${remedyClause(event.remedy)}`,\n      )\n      awaitItsReceipt(state, event.tool, event.rail, event.told ?? null)\n      return\n"
)

SAID = "  return isRailPermanence(permanence) ? PERMANENCE_SAID[permanence] : permanence\n"

# ⚑ **ANCHOR CORRECTED IN PLACE BY 425** — the raw line gained the remedy word. `M11` still removes
# only the RAIL, and the replacement below keeps the new clause so the row measures one thing.
LINE = (
    "      return `${event.tool} · refused: ${event.rail} · ${event.permanence} · ${\n"
    "        event.retryable ? 'retryable' : 'not retryable'\n"
    "      }${isRefusalRemedy(event.remedy) ? ` · ${event.remedy}` : ''} (ours)`\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the finding itself ────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 the shipped defect, put back · the toolset publishes its tools unwrapped, so no "
        "refusal any door answers is ever recorded — `402` F2 exactly: a refused `spawn_agent` and "
        "an admitted one are the same two rows, `ok: true` on both, and the only party who can say "
        "why a child stopped trying is the child",
        # ⚑ **theme host · re-anchored in place, not retired** — NOT VERIFIED. The expanded tool array is retained; the replacement removes refusal recording from every tool.
        [(TOOLS, WRAPPED, "    ],\n")],
    ),
    (
        "M2 · ⛔ only the tool the FINDING named is recorded · `spawn_agent` leaves a row and the "
        "eight other doors leave nothing, so a rail that refuses a message, a reply, a question or "
        "an interrupt is still invisible in production. ⚠️ It is the shape a fix written from the "
        "example rather than from the rule takes, and every assertion about spawning passes",
        [
            (
                TOOLS,
                "      if (refused !== null) host.noteRefusal(me, one.name, refused)\n",
                "      if (refused !== null && one.name === 'spawn_agent')\n"
                "        host.noteRefusal(me, one.name, refused)\n",
            )
        ],
    ),
    (
        "M3 · ⛔ the row is written from the ATTEMPT rather than from the answer · every call this "
        "toolset answers is recorded as refused, so an admitted spawn and a refused one are once "
        "again indistinguishable — this time by both carrying a refusal instead of neither",
        [
            (
                TOOLS,
                CALL,
                "      host.noteRefusal(me, one.name, {\n"
                "        rail: 'malformed-request',\n"
                "        permanence: 'permanent',\n"
                "        retryable: false,\n"
                "      })\n"
                "      const answered = await one.call(args)\n",
            )
        ],
    ),
    # ── §2 · the two facts beside the rail ─────────────────────────────────────────────────────
    (
        "M4 · 🔴 the permanence is a constant · every refusal is recorded `permanent`, so a person "
        "reading a transcript is told to change the call when the honest answer is *ask somebody for "
        "a grant* or *wait*. ⚠️ `not-in-can-spawn` is `until-a-person-changes-it` and `too-deep` is "
        "`permanent` — a suite that had only ever measured one of them would pass this",
        [
            (
                HOST,
                "      permanence: refused.permanence,\n",
                "      permanence: 'permanent',\n",
            )
        ],
    ),
    (
        "M5 · ⛔ retryability is a constant · every refusal is recorded as not retryable, so a model "
        "and a person are both told that a queue which empties at the next turn boundary will never "
        "let this call through — `no-such-agent` and `no-task-by-that-name` are `while-this-holds` "
        "and retrying is exactly what they invite",
        [(HOST, "      retryable: refused.retryable,\n", "      retryable: false,\n")],
    ),
    (
        "M6 · ⛔ a payload the app cannot read is published as a partial row · a refusal whose "
        "permanence is a word this build does not know is recorded with it anyway, so a person is "
        "told a rule stopped their agent and the row cannot say for how long. ⚑ It is worse than the "
        "silence `402` measured, because it looks like an answer. ⚑ ANCHOR CORRECTED IN PLACE BY 425",
        [
            (
                TOOLS,
                READABLE,
                "  if (typeof rail === 'string' && rail.length > 0) {\n"
                "    return {\n"
                "      rail,\n"
                "      permanence: permanence as never,\n"
                "      retryable: retryable === true,\n"
                "      remedy: said,\n"
                "    }\n"
                "  }\n",
            )
        ],
    ),
    # ── §3 · whose ledger, and which writer ────────────────────────────────────────────────────
    (
        "M7 · 🔴 the row goes into the PARENT's ledger · a spawned conversation's refusals are "
        "written into the transcript of whoever created it, so the conversation that tried reads "
        "clean and the conversation that did nothing is told a rule stopped it. ⚠️ It reads as "
        "helpful — the parent 'should know' — and it is a fact about the child",
        [
            (
                HOST,
                WHOSE_LEDGER,
                # ⛔ **`SessionSlot.spawnedBy` and never `HostedSession`'s** — the first draft of this
                # row read `mine.session.spawnedBy`, which does not exist, so it evaluated to
                # `undefined`, fell through `?? sessionId` and SURVIVED as a no-op
                # (`a-mutation-that-changes-nothing-reports-as-a-survivor`).
                "    const mine = this.slots.get(sessionId)\n"
                "    const slot = this.slots.get(mine?.spawnedBy ?? sessionId)\n"
                "    const session = slot?.phase === 'live' ? slot.session : null\n",
            )
        ],
    ),
    (
        "M8 · 🔴 a store-side append into a ledger the host is running · `398` §6 measured this "
        "exactly: the ordinal collides with `HostedSession.ordinal`, `record()` logs the first "
        "collision and returns, and **every later durable event is dropped SILENTLY**. ⚠️ A tool "
        "call arrives mid-turn, which is the busiest this ledger ever is. ⚑ ANCHOR CORRECTED IN PLACE BY 425",
        [
            (
                HOST,
                WRITER,
                "    this.deps.store.append(\n      session.id,\n      session.ordinal,\n      {\n        type: 'tool_refused',\n        tool,\n        rail: refused.rail,\n        permanence: refused.permanence,\n        retryable: refused.retryable,\n        remedy: refused.remedy,\n        ...(refused.told === undefined ? {} : { told: refused.told }),\n      },\n      this.now(),\n    )\n",
            )
        ],
    ),
    # ── §4 · the surface HO-019 §4's sentence is about ─────────────────────────────────────────
    (
        "M9 · 🔴 the transcript draws nothing · the row is in the ledger and the only place it can be "
        "read is the raw Events tab, so *\"a person reading a transcript should be able to see that "
        "an agent tried something and was told no\"* is still false. ⚑ This is the row that would "
        "survive a fix that stopped at the ledger. ⚑ ANCHOR CORRECTED IN PLACE BY 425",
        [(TRANSCRIPT, DRAWN, "    case 'tool_refused':\n      return\n")],
    ),
    (
        "M10 · ⛔ the notice is `info` · `transcript-mode.ts`'s reading view drops `info` notices, so "
        "the refusal is visible in the debug view and invisible in the one a person reads — "
        "HO-019 §4's *invisible in production* moved one surface over",
        [
            (
                TRANSCRIPT,
                "      notice(\n        state,\n        'warn',\n        `refused: ${event.tool}",
                "      notice(\n        state,\n        'info',\n        `refused: ${event.tool}",
            )
        ],
    ),
    (
        "M12 · 🔴 the instrument stays blind · `402`'s runner folds the ledger for its verdicts and "
        "reads only the two places `402` had — a `tool_result` that carries `ok` and never the "
        "tool's structured return, and a `raw_frame` the ARCHIVE SWEEP writes after the fact. "
        "⚠️ Step 6 then passes on the OUTCOME alone, which is exactly the state HO-019 §4 calls "
        "*provable in tests and invisible in production*",
        [
            (
                STAGE,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 445 — `445` widened this census from the single
                # verb `spawn_agent` to every verb that can bring a conversation into being, after
                # a live Codex worker called `create_agent` and the row above it reported *"the
                # worker never tried to create an agent"* about a ledger that held the call. ⛔ The
                # ROW is unchanged in what it does: it deletes the structured `tool_refused` read
                # and leaves the instrument on `402`'s two blind sources.
                "  const recorded = store\n"
                "    .events(sessionId)\n"
                "    .map((one) => one.event)\n"
                "    .filter(\n"
                "      (event): event is Extract<TranscriptEvent, { type: 'tool_refused' }> =>\n"
                "        event.type === 'tool_refused' &&\n"
                "        (VERBS_THAT_BRING_ONE_INTO_BEING as readonly string[]).includes(event.tool),\n"
                "    )\n"
                "  const own = recorded.at(-1)\n"
                "  if (own !== undefined) {\n"
                "    return { tool: own.tool, rail: own.rail, permanence: own.permanence, retryable: own.retryable }\n"
                "  }\n",
                "",
            )
        ],
    ),
    (
        "M11 · ⛔ the raw stream drops the rail · the Events tab says a tool was refused and not by "
        "WHICH RULE — the one fact `402`'s runner needs to tell a refused spawn from an admitted "
        "one, and the one HO-019 §4 names first. ⚑ ANCHOR CORRECTED IN PLACE BY 425",
        [
            (
                DESCRIBE,
                LINE,
                "      return `${event.tool} · refused · ${event.permanence} · ${\n"
                "        event.retryable ? 'retryable' : 'not retryable'\n"
                "      }${isRefusalRemedy(event.remedy) ? ` · ${event.remedy}` : ''} (ours)`\n",
            )
        ],
    ),
]
