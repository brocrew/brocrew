"""349 · A sink that says whether a person is behind it — each row is THE DEFECT, put back (131).

⛔ **What this dispatch replaced.** `mayAnswerAsAHuman` asked whether the caller OWNED the session,
and ownership is taken by `claimSession`, **which takes a `RuntimeEventSink` — a four-member
structural type any caller can satisfy**. So an agent that presented a sink could claim its own
child and then answer that child's permission prompt legally. ⚑ **What stopped it was a fact about
the callers that exist, not a check**, and `340` wrote that fact down as a source census.

⚑ **The rail is three lines and every row below is one of them being untold.** A sink DECLARES
(`RuntimeEventSink.aPersonIsBehindIt`, required and never defaulted); a claim COPIES the declaration
onto the slot beside the owner it is taking; the answer door READS the copy instead of inferring a
person from the fact that somebody owns the conversation.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1` | ⚑ **`run_suite`** — `apps/desktop/test/an-agent-gives-work-a-person-decides.demo.test.ts` |
| `M2`-`M13`, `M17`, `M20`, `M21` | ⚑ **`run_suite`** — `apps/desktop/test/a-sink-that-says-whether-a-person-is-behind-it.test.ts` |
| `M14`-`M16`, `M18`, `M19`, `M22` | ⚑ **`run_suite`** — `apps/desktop/test/a-person-is-told-an-agent-can-still-drive-it.render.test.ts` |
| `M23` | ⚑ **`run_suite`** — `apps/desktop/test/attention-queue.test.ts` |

⚠️ **`M17`, `M20` and `M21` are the census's rows and only the census can see them.** They change no
behaviour any test can drive — an optional field, a stale reset, a value nothing reads — so what
turns red is `§4` of the file above, over prose-stripped source. ⛔ Naming a behaviour suite for them
would send a reviewer doing the per-row check to a file that passes.

## ⛔ What this table deliberately does NOT contain

⛔ **No `?? true` row on the create path** — see below, and see `652 M9`, which is that row. Two rows that were written as *"deliberately
absent, phantom"* turned out **not** to be phantoms and are now `M20` and `M21`; the correction is
recorded under *"what the per-row killer check changed"*.

⛔ **No `?? true` row on the create path.** `sink?.aPersonIsBehindIt ?? false` falls to its default
only when there is no sink at all — which is exactly when `ownerId` is `null`, and a `null` owner
already refuses every caller through the predicate's third conjunct. Flipping the default would be
unobservable **and the census cannot see it either**, because the census counts declarations of
`true` and this is a fallback. `M4` mutates the whole expression instead, which is observable and is
red.

⚠️ **Unobservable at the ANSWER door only, and that stopped being the whole of it after `439`/`441`**
(recorded by `652`, whose review found it). ⛔ Two readers ask the slot's flag with no owner in the
question — `message_sent` records it as `onBehalfOfAPerson`, and `propose_project` refuses
`no-person-to-ask` on it — so the flip IS observable. ⚑ **`652 M9` is the create-door row** (killed
by `a-project-he-described.test.ts`), beside `652 M2` on the reopen door.

⛔ **No row widens `mayControl`, `mayCommand` or `mayClaim`.** `340` owns those and `349` did not
touch them — ownership is exactly where `340` left it, which is `§2` of the suite rather than a row.

⛔ **No row on `setApprovalMode`'s gate.** It asks `mayControl` and `349` deliberately did not move
it; the suite PINS that door open rather than closing it (`the door 349 leaves open`), so a row
would assert a rule this dispatch did not ship. See the response doc for the three answers priced.

## ⚑ What the per-row killer check changed, before this table was ever run

🔴 **`M13` did not exist until the suite could see it.** The reservation arm of `UnclaimedSession`
carried `commandedBy` from the first draft, and every test that read it happened to be a session
nobody commanded — so `commandedBy: slot.commandedBy` → `commandedBy: null` was green. The row was
written, found unkillable by hand, and the SUITE was extended (a gated launch, commanded by a caller
with no surface) rather than the row retired: *"a line no mutation can kill is not carrying its
rule"*, and here the rule was fine and the reading was missing.

🔴 **`M17` is the reason the required field has a gate at all.** Making `aPersonIsBehindIt` optional
changes nothing any test can see — every construction site already declares it — so §3.3's rule
(*"declaring must be explicit, never a default"*) was a paragraph until the census asserted the
declaration's own text over prose-stripped source.

🔴 **`M23` did not have a killer when it was written, and the SUITE moved.** The render test builds
an `AttentionRequest` literal, so it exercises the row and not the projection that fills it — the row
that blanks `hasACommander` in `attention.ts` was green. `attention-queue.test.ts` gained the
reading: a record with a commander, one without, and one with no `meta` at all. Same shape as `M13`,
same conclusion: the rule was fine and nothing was looking at it.

🔴 **`M20` and `M21` were written as *"deliberately absent — phantom"* and that reasoning was
WRONG.** Both were argued away on behaviour alone: nothing reads a released slot's field, and
nothing reads `NO_SURFACE`'s copy. Both are true, and both are beside the point — **§4's census
reads the SOURCE**, and it pins `slot.ownerIsAPerson = false` as a literal and counts every
declaration of `true` under `src/main`. ⛔ *"No gate can see this"* has to be asked of every gate,
including the ones that read text rather than behaviour; asked of only one, it retires a row that
was red all along.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
HEADER = "apps/desktop/src/renderer/src/components/SessionHeader.vue"
CONTROLS = "apps/desktop/src/renderer/src/components/SessionControls.vue"
# ⚑ **529 moved the commander paragraph out of Controls and onto the Info surface**
# (`HO-050` §1.2: *Controls are things you press. Info is things you read*). ⛔ M16 and M19
# were RE-ANCHORED onto the new file rather than retired — a row that stops counting is a row
# that stops measuring (`HO-050` §3) — and their killer,
# `a-person-is-told-an-agent-can-still-drive-it.render.test.ts`, moved with it.
# ⚠️ **Re-anchoring changes a row's DEFINITION, so any recorded verdict would stop being earned**
# (`a-corrected-anchor-keeps-a-verdict-it-never-earned`). ⚑ This table has none — it is `unrun`
# in `CENSUS.md` — so nothing was invalidated; instead each moved row was verified BY HAND after
# the move: 349 M16/M19 applied alone, watched RED against its killer, and restored
# from bytes with a SHA-256 re-check.
# ⚠️ **Re-anchored a SECOND time at 529 relay 1.** `527` turned that panel into an index while
# this was in flight, so the paragraph came back as a `<template>`-gated ROW with the sentence
# behind a disclosure; the condition moved onto the tag and the old anchor stopped counting.
# ⛔ **A moved anchor is a REPAIR, never a `--retire`** (rule 27) — the subject is still there and
# the claim is unchanged. Both re-verified RED alone after the re-land.
INFO = "apps/desktop/src/renderer/src/components/SessionInfo.vue"
QUEUE = "apps/desktop/src/renderer/src/components/AttentionQueue.vue"
ATTENTION = "apps/desktop/src/renderer/src/lib/attention.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the declaration stops being a declaration ─────────────────────────────────────────
    (
        "M1 · 🔴 the one thing in this app that a person really is behind stops saying so · a "
        "window is where a permission card is DRAWN, and if `webContentsSink` does not declare it "
        "then nobody in the app may answer anything",
        [(IPC, "    aPersonIsBehindIt: true,", "    aPersonIsBehindIt: false,")],
    ),
    (
        "M2 · 🔴 THE DEFECT: a claim makes its claimer a person · this is `340`'s sentence exactly "
        "— *an agent that presents a sink could claim its own child and then answer its permission "
        "prompt legally*",
        [
            (
                HOST,
                "      slot.ownerIsAPerson = sink.aPersonIsBehindIt",
                "      slot.ownerIsAPerson = true",
            )
        ],
    ),
    (
        "M3 · ⛔ a claim makes its claimer nobody · the other direction, and it is the one that "
        "wedges a real conversation: the person who takes it over cannot answer the card they were "
        "handed",
        [
            (
                HOST,
                "      slot.ownerIsAPerson = sink.aPersonIsBehindIt",
                "      slot.ownerIsAPerson = false",
            )
        ],
    ),
    (
        "M4 · ⛔ the reservation stops asking the sink that asked for the session · a window that "
        "opens its own conversation could not then answer it. ⚑ ANCHOR CORRECTED IN PLACE BY 652 (142: correct, never delete) — `resumeSession` now "
        "spells this line identically one indent deeper, so the anchor gained the leading newline "
        "that pins it to `createSession`'s; the defect and the kill are unchanged",
        [
            (
                HOST,
                "\n          ownerIsAPerson: sink?.aPersonIsBehindIt ?? false,",
                "\n          ownerIsAPerson: false,",
            )
        ],
    ),
    (
        "M5 · ⛔ a reopen stops asking the sink that reopened it · `085`'s ended latch one field "
        "over: the conversation comes back and the person who pressed Reopen may not decide "
        "anything in it. ⚑ ANCHOR CORRECTED IN PLACE BY 652 (142: correct, never delete) — the sink is nullable since 652, so the reopen reads it "
        "the way `createSession` does, `?? false` for no surface; the defect (a reopen that stops "
        "asking the sink) and the kill (a WINDOW's reopen) are unchanged",
        [
            (
                HOST,
                "            ownerIsAPerson: sink?.aPersonIsBehindIt ?? false,",
                "            ownerIsAPerson: false,",
            )
        ],
    ),
    # ── §2 · the door stops reading the declaration ────────────────────────────────────────────
    (
        "M6 · 🔴 the answer door goes back to inferring a person from ownership · the whole of "
        "`349` in one clause, and HO-005 Q2 with it",
        [
            (
                HOST,
                "  return by !== THE_APP_ITSELF && slot.ownerIsAPerson && slot.ownerId === by.ownerId",
                "  return by !== THE_APP_ITSELF && slot.ownerId === by.ownerId",
            )
        ],
    ),
    (
        "M7 · ⛔ the answer door stops asking WHOSE conversation it is · `062`'s rule spent buying "
        "this one: any window with a person behind it could answer any other window's card",
        [
            (
                HOST,
                "  return by !== THE_APP_ITSELF && slot.ownerIsAPerson && slot.ownerId === by.ownerId",
                "  return by !== THE_APP_ITSELF && slot.ownerIsAPerson",
            )
        ],
    ),
    (
        "M8 · ⛔ the two questions become alternatives instead of both · either half alone admits "
        "the caller, so a non-person owner passes on the second and a stranger passes on the first",
        [
            (
                HOST,
                "  return by !== THE_APP_ITSELF && slot.ownerIsAPerson && slot.ownerId === by.ownerId",
                "  return by !== THE_APP_ITSELF && (slot.ownerIsAPerson || slot.ownerId === by.ownerId)",
            )
        ],
    ),
    # ── §3 · the disclosure HO-006 §4.5 asked for ──────────────────────────────────────────────
    (
        "M9 · 🔴 the claim tells the person nobody else can send here · criterion 9 verbatim — a "
        "surface implying a state that is not true, on the one gesture where a person takes over a "
        "conversation an agent commissioned",
        [
            (
                HOST,
                "      // are one instant.\n      hasACommander: slot.commandedBy !== null,",
                "      // are one instant.\n      hasACommander: false,",
            )
        ],
    ),
    (
        "M10 · ⛔ every fresh conversation claims somebody else can drive it · the other direction "
        "of the same lie, and the one that would teach a reader to ignore the pill",
        [
            (
                HOST,
                "      // instead of from two arguments that could come to disagree.\n"
                "      hasACommander: slot.commandedBy !== null,",
                "      // instead of from two arguments that could come to disagree.\n"
                "      hasACommander: true,",
            )
        ],
    ),
    # ⚠️ **Anchor and label corrected by `373`, and the DEFECT is unchanged.** This row hard-codes
    # the reopen path's disclosure. Its comment moved when `373` made the answer vary — a reopened
    # child of a spawn is commanded, a person's own conversation is not — and its old sentence
    # (*"nothing persists one"*) named a premise that has stopped being true. The mutation is the
    # same edit on the same line: a constant where the slot should be asked.
    (
        "M11 · ⛔ a reopen hard-codes the disclosure instead of asking the slot · `373` made the "
        "answer vary, so a constant here is `349`'s lie in whichever direction it is written — and "
        "`true` tells a person somebody else can send into a conversation nobody spawned",
        [
            (
                HOST,
                "      // and this line needed no edit to start saying so. ⚡ One field, asked twice.\n"
                "      hasACommander: slot.commandedBy !== null,",
                "      // and this line needed no edit to start saying so. ⚡ One field, asked twice.\n"
                "      hasACommander: true,",
            )
        ],
    ),
    (
        "M12 · ⛔ the host-side list forgets who may drive a running unclaimed session · `340`'s "
        "own gap put back: unowned stops being distinguishable from unattended",
        [
            (
                HOST,
                "        commandedBy: slot.commandedBy,\n        running: true,",
                "        commandedBy: null,\n        running: true,",
            )
        ],
    ),
    (
        "M13 · ⛔ …and forgets it on a reservation, where it is already known · `commandedBy` is "
        "fixed at reservation, so this arm answering `null` makes *nobody commands it* and *we "
        "have not got that far* one value again (074)",
        [
            (
                HOST,
                "          commandedBy: slot.commandedBy,\n          running: false,",
                "          commandedBy: null,\n          running: false,",
            )
        ],
    ),
    # ── §4 · the two surfaces a person actually reads ──────────────────────────────────────────
    (
        "M14 · ⛔ the bar shouts on every conversation · *only the unattended one shouts* (082) — a "
        "pill that is always there is a pill nobody reads, which costs the disclosure its whole "
        "value",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule (only a
        # commanded conversation shows the 'another caller can send here' pill) survives on the
        # header. D-017b removed the `ended` prop and its `&& !ended` clause, so the anchor is now
        # `v-if="session?.hasACommander"` on the pill span. The plant shows the pill on every
        # conversation.
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — ae07008f removed the header pill, but the rule (the other-caller disclosure is
        # drawn only for a commanded conversation, never on every one) lives on in Info's `other
        # callers` row ("Info still says every fact"), and no row plants the always-drawn direction
        # there (349 M16 is the inversion). The render test pairs the positive with
        # `not.toContain('data-cy="info-has-a-commander"')` for an ordinary session, so drawing the
        # row for every session turns it red. The label's wording about the bar and pill is stale;
        # the plant is now Info's row. Killed by
        # `a-person-is-told-an-agent-can-still-drive-it.render.test.ts`.
        [
            (INFO, '        <template v-if="session.hasACommander">', '        <template v-if="session">'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):**
        # ae07008f: "Out: the header's warnings band (another caller, not asked again, kept beyond
        # this conversation)"; the header's `v-if="session?.hasACommander"` pill is gone. The same
        # inversion on the surviving surface is already planted by 349 M16 (`<template
        # v-if="!session.hasACommander">` in SessionInfo.vue), so re-anchoring would duplicate it.
        # Its anchor is left stale, so the census records it retired.
        "M15 · 🔴 the bar says it about the conversations it is NOT true of · the inversion, which "
        "is worse than silence: a person is warned about their own conversation and told nothing "
        "about the one an agent is driving",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The inversion rule
        # survives: the pill must appear for the commanded conversation and not for the ordinary
        # one. Only the `&& !ended` clause is gone (D-017b). The plant inverts `hasACommander` on
        # the pill's `v-if`.
        [
            (HEADER, '      v-if="session?.hasACommander"\n      class="liveness auto"', '      v-if="session && !session.hasACommander"\n      class="liveness auto"'),
        ],
    ),
    (
        "M16 · ⛔ the Approvals group explains the rule to the wrong conversation · the same "
        "inversion where it costs the most, next to the control that decides what the work may do",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The 'other callers' row
        # on the Info surface must be drawn for a commanded conversation and not the reverse, so the
        # inversion rule survives. D-017b removed the `&& !props.ended` clause and left `<template
        # v-if="session.hasACommander">`. The plant inverts it.
        [
            (INFO, '        <template v-if="session.hasACommander">', '        <template v-if="!session.hasACommander">'),
        ],
    ),
    # ── §5 · the rule that is a paragraph unless something asserts it ──────────────────────────
    (
        "M17 · 🔴 the declaration becomes optional · §3.3: *declaring must be explicit, never a "
        "default* — with a `?` the next non-window transport compiles without its author ever "
        "deciding, and every existing site goes on compiling too",
        [
            (
                HOST,
                "  readonly aPersonIsBehindIt: boolean",
                "  readonly aPersonIsBehindIt?: boolean",
            )
        ],
    ),
    # ── §6 · the disclosure outliving the capability it discloses ──────────────────────────────
    (
        "M22 · 🔴 the surface a person ANSWERS from stops saying somebody else supplied the work · "
        "the pill and the Approvals note are both INSIDE a conversation, and this row is where the "
        "decision is actually made — criterion 9 on the one gesture the disclosure is about",
        [
            (
                QUEUE,
                '<p v-if="request.hasACommander" class="request-warn" data-cy="attention-has-a-commander">',
                '<p v-if="false" class="request-warn" data-cy="attention-has-a-commander">',
            )
        ],
    ),
    (
        "M23 · ⛔ …and the projection stops carrying it, so no surface downstream could say it · "
        "one line further back than `M22`, and the shape a widening would actually take",
        [
            (
                ATTENTION,
                "        hasACommander: record.meta?.hasACommander === true,",
                "        hasACommander: false,",
            )
        ],
    ),
    (
        "M20 · ⛔ a release stops giving the personhood half back · the slot goes on saying a person "
        "is behind an owner that has gone — masked at the door by the `null` owner beside it, and "
        "caught by the census, which is what a belt is for",
        [
            (
                HOST,
                "    slot.ownerIsAPerson = false",
                "    slot.ownerIsAPerson = true",
            )
        ],
    ),
    (
        "M21 · 🔴 a second thing in the app declares a person, and it is the sink for a session "
        "NOBODY is watching · §3.3's exact shape — the permissive value written where no window is",
        [
            (
                HOST,
                "  aPersonIsBehindIt: false,\n  alive: false,",
                "  aPersonIsBehindIt: true,\n  alive: false,",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row plants the bar promising a
        # live capability after the conversation has ENDED, by dropping `&& !ended`. D-017b removed
        # that rule on purpose: the killer test's own note says 'the `ended` gate is gone from both
        # surfaces — a conversation is never ended', and its test 'both surfaces say it on a
        # conversation nothing runs' is 'The inverse of what this test pinned before D-017b, and on
        # purpose'. The plant now equals the shipped code, so it is an equivalent mutant. Its anchor
        # is left stale, so the census records it retired.
        "M18 · ⛔ the bar goes on promising a live capability after the conversation has ENDED · "
        "criterion 9 pointed the other way — every verb the tooltip names is refused once the "
        "session is over, so the pill would imply a state that is not true",
        [
            (
                HEADER,
                'v-if="session?.hasACommander && !ended"',
                'v-if="session?.hasACommander"',
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row plants the
        # Approvals/other-callers note appearing on an ENDED conversation, by dropping `&&
        # !props.ended`. D-017b made exactly that the required behaviour: the SessionInfo comment
        # says 'drawn whether or not anything runs it: a message from that caller starts it, so the
        # capability is there either way', and the killer test asserts `info-has-a-commander` on a
        # stopped commanded conversation. The plant equals the shipped code, so it cannot go red.
        # Its anchor is left stale, so the census records it retired.
        "M19 · ⛔ …and so does the Approvals note, which says *can go on doing so while you have it "
        "open* · the same lie at the place a person reads to decide what this conversation may do",
        [
            (
                INFO,
                '        <template v-if="session.hasACommander && !props.ended">',
                '        <template v-if="session.hasACommander">',
            )
        ],
    ),
]
