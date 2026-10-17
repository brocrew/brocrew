"""340 · The caller that may command but not watch — each row is THE DEFECT, put back verbatim (131).

⛔ **What 340 fixed, in one sentence.** `336` built a door a session can exist behind with no
renderer and then measured what was behind it: *"the door lets a session EXIST without a renderer. It
does not let anything DRIVE one."* Every control verb asked `mayControl`, which for an owner of
`null` admits only `THE_APP_ITSELF` — so a spawned agent sat idle until a person took it over.

## ⚑ The shape, in three sentences

**`ownerId` answers three questions at once** — who may command, who is receiving, whose departure
ends it — **and a caller with no surface answers YES to the first and NO to the other two.** So the
first question moved to its own field, `commandedBy`, read by its own predicate, `mayCommand`.
⛔ **And a third predicate is NARROWER than both**: a commanding caller may hand this session work
and may not decide what that work is allowed to do (HO-005 Q2 — *"permissions: always the human"*).

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M6`, `M8`, `M13`-`M19`, `M22`-`M23`, `M25`-`M27` | ⚑ **`run_suite`** — `apps/desktop/test/the-caller-that-may-command-but-not-watch.test.ts` |
| `M7`, `M9`-`M12`, `M20`-`M21` | ⚑ **`run_suite`** — the file above AND `an-agent-gives-work-a-person-decides.demo.test.ts` |
| `M24`, `M28` | ⚑ **`run_suite`** — `apps/desktop/test/session-unavailable.test.ts` (`M24` is caught by the distinctness census that row's own survival caused to be written) |
| `M29` | ⚑ **`run_suite`** — `apps/desktop/test/send-refusals.test.ts` |

## ⚠️ What this table deliberately does NOT contain

⛔ **No row makes `resumeSession` reserve with `commandedBy: sink.ownerId`.** ⚑ Measured by reading
the two clauses rather than by running it: a resumed slot's owner IS the resumer, so `mayCommand`'s
first clause is already true of exactly that caller and the second would add nobody. A resumed
session is never `bornWithoutASurface` either, so no release can ever separate the two fields. The
mutation changes no observable behaviour and would record as a phantom survivor
(`a-mutation-that-changes-nothing-reports-as-a-survivor`). The ruling is written into the
`commandedBy` docblock instead, where it is also the answer to *"what does a restart do?"*.

⚠️ **That verdict was true when `340` wrote it and went false twice since** (recorded by `652`,
whose review found it). ⛔ **`349`/`373` made the mutation OBSERVABLE**: a reopen now DISCLOSES
`hasACommander`, so a person-started conversation reopened with `commandedBy: sink.ownerId` tells
its window an agent can still drive it — `373 M5` is exactly that row, killed by a window's reopen.
⚑ **And `652` gave the door a reopen with no resumer at all**: `resumeSession` takes a `null` sink,
reserves it under no owner, born `bornWithoutASurface`, and its only commander is `373`'s derivation
from the provenance row — so the two sentences above hold only of a WINDOW's reopen.

⛔ **No row widens `closeSessionsForOwner`'s filter to `&& slot.commandedBy !== ownerId` on its
own.** A commanded slot is unowned, so it is `bornWithoutASurface` and the widened filter would
RELEASE it — and releasing a slot that is already nobody's writes `ownerId = null` over `null`, the
sink to `NO_SURFACE` over `NO_SURFACE`, and the dedupe key to `''`. Unobservable. ⚑ `M27` is the
observable version: the commander's departure CLOSES what it commands, which is the third question
answered yes.

⛔ **No row touches `mayClaim` or `mayControl`.** `336` owns the first and `203` the second, and 340
deliberately widened neither: `attachOpenSessions` and `attachHeldSession` ask `mayControl` to decide
who a running conversation's stream is handed to, and a commander is entitled to none of it. ⚠️ **The
rows that would prove that live in those tables already** — what is new here is that the widening
went somewhere else, which `M8` and `M13`-`M17` are about.

⛔ **No row plants a second caller of `claimSession`.** The one door left onto this rule is a
non-window sink taking ownership, and it is closed today by a FACT rather than by a check — one
caller in `src`, whose sink is always `webContentsSink(event.sender)`. The gate for it is a source
census in the suite, aimed at the tools dispatch; a mutation row would only re-assert what that test
already reads out of the files.

## ⚑ What the per-row killer check changed, before this table was ever run

🔴 **The demonstration was passing over the wrong card.** Step 6 sends a second commanded turn and
then asserts the agent is *still* refused — and it waited on the words `AND ANOTHER`, which reach the
screen the instant the turn opens, because they ARE the message. So the refusal was being measured
against the card a person had already answered, and would have passed with the rule deleted. It waits
on the card COUNT now, and asserts the second id differs from the first
(`wait-on-the-thing-not-on-its-text`).

⚠️ **A second finding, from writing `M27`.** The obvious mutation — widening the `continue` — is a
no-op for exactly the slots the row is about, because a release of an already-released slot writes
every field back to the value it holds. Named above rather than added.

🔴 **`M24` survived, and the weak test was `session-unavailable.test.ts` rather than anything 340
wrote.** The row gives the new refusal `not-yours`'s sentence — the exact lie three docblocks in that
file are written to prevent — and the whole vocabulary walk passed it: non-empty, no leaked id, no
state name, reads as a sentence, names a way forward. ⛔ **Nothing anywhere asserted that two reasons
do not answer with the SAME string.** `118`, `214` and `336` each paid for that argument in prose and
none of them left a gate behind it. A distinctness census over `UNAVAILABLE_REASONS` was added, it
was green on the seventeen sentences that already existed, and `M24` is red against it.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
UNAVAILABLE = "apps/desktop/src/main/runtime/session-unavailable.ts"
REFUSALS = "apps/desktop/src/renderer/src/lib/send-refusals.ts"

# ⚑ **708 · anchors corrected in place, not retired** (standing rule 27): `R42` handed every turn
# gate a `from`, so each `assertCanTakeTurn(` call gained that key and most now span several
# lines; the rows below that named a gate call were re-spelled to it and each re-verified RED
# alone, with its killer named in 708's response.
MUTATIONS = [
    # ── the defect itself ─────────────────────────────────────────────────────────────────────
    (
        "M1 · ⛔ THE DEFECT, verbatim (336's finding) · the commanding clause is gone, so a session "
        "spawned for an agent sits idle until a person takes it over — which is the state 336 "
        "measured and the whole of what this dispatch is for",
        [
            (
                HOST,
                "  return slot.ownerId === by.ownerId || slot.commandedBy === by.ownerId\n}",
                "  return slot.ownerId === by.ownerId\n}",
            )
        ],
    ),
    (
        "M2 · ⛔ the commanding clause matches everyone EXCEPT the commander · exact-equality "
        "inverted, so every agent in the process may drive every spawned session and the one that "
        "was named may not",
        [
            (
                HOST,
                "  return slot.ownerId === by.ownerId || slot.commandedBy === by.ownerId\n}",
                "  return slot.ownerId === by.ownerId || slot.commandedBy !== by.ownerId\n}",
            )
        ],
    ),
    (
        "M3 · ⛔ the OWNER clause is dropped from `mayCommand` · a window can no longer send to the "
        "conversation it started, because the widening replaced the question instead of adding to it",
        [
            (
                HOST,
                "  return slot.ownerId === by.ownerId || slot.commandedBy === by.ownerId\n}",
                "  return slot.commandedBy === by.ownerId\n}",
            )
        ],
    ),
    (
        "M4 · ⚠️ the app itself stops being the superuser for commanding · the quit and the "
        "finalizer are ordinary callers again, which is 203's rule undone from the new side",
        [
            (
                HOST,
                "  if (by === THE_APP_ITSELF) return true\n"
                "  return slot.ownerId === by.ownerId || slot.commandedBy === by.ownerId",
                "  if (false as boolean) return true\n"
                "  return slot.ownerId === by.ownerId || slot.commandedBy === by.ownerId",
            )
        ],
    ),
    # ── §2 · knowledge escalates, authority does not ──────────────────────────────────────────
    (
        "M5 · 🔴 the answer gate readmits the superuser · `mayAnswerAsAHuman` becomes `mayControl`, "
        "so *nobody is asking* becomes an acceptable answer to *who is the person here* — the "
        "shortest path to the defect HO-005 Q2 forbids",
        [
            (
                HOST,
                # ⚠️ **Anchor corrected by `349`, not retired.** The gate gained a second conjunct —
                # the slot's own declaration of whether a person is behind its owner — and the
                # superuser clause moved with the line. Same defect: *nobody is asking* becomes an
                # acceptable answer to *who is the person here*.
                "  return by !== THE_APP_ITSELF && slot.ownerIsAPerson && slot.ownerId === by.ownerId\n}",
                "  return by === THE_APP_ITSELF || (slot.ownerIsAPerson && slot.ownerId === by.ownerId)\n}",
            )
        ],
    ),
    (
        "M6 · 🔴 THE SAFETY DEFECT, verbatim · the answer gate gains the commanding clause, so a "
        "parent agent answers its child's permission prompt — *the kill switch with extra steps*",
        [
            (
                HOST,
                # ⚠️ **Anchor corrected by `349`, not retired — and this row is exactly the one a
                # retirement must never be allowed to take.** `349` widened the gate with a third
                # question (is a PERSON behind the owner) and rewrapped the signature; the defect
                # this row puts back is unchanged and is still the ticket HO-005 Q2 forbids.
                # ⛔ **The commanding clause is added as a DISJUNCT of the whole entitlement**, not
                # inside the personhood conjunct — that is where a careless edit would put it, and
                # it is the only placement that actually readmits a commander, since a spawned
                # session's slot answers `ownerIsAPerson: false`.
                "export function mayAnswerAsAHuman(\n"
                "  slot: { readonly ownerId: string | null; readonly ownerIsAPerson: boolean },\n"
                "  by: Caller,\n"
                "): boolean {\n"
                "  return by !== THE_APP_ITSELF && slot.ownerIsAPerson && slot.ownerId === by.ownerId\n}",
                "export function mayAnswerAsAHuman(\n"
                "  slot: {\n"
                "    readonly ownerId: string | null\n"
                "    readonly ownerIsAPerson: boolean\n"
                "    readonly commandedBy?: string | null\n"
                "  },\n"
                "  by: Caller,\n"
                "): boolean {\n"
                "  return (\n"
                "    by !== THE_APP_ITSELF &&\n"
                "    ((slot.ownerIsAPerson && slot.ownerId === by.ownerId) ||\n"
                "      slot.commandedBy === by.ownerId)\n"
                "  )\n}",
            )
        ],
    ),
    (
        "M7 · ⛔ the two answer verbs ask the CONTROL question instead · the narrowing is gone and "
        "the superuser is back in, one layer above the predicate that says it may not be · killed by `the-caller-that-may-command-but-not-watch.test.ts`",
        [
            (
                HOST,
                # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · ee88c516 gave assertMayAnswer the request id; the plant still makes both answer verbs ask the control question, which lets the app itself answer for a person.
                "    return this.sessionFor(sessionId, (slot) => this.assertMayAnswer(slot, by, requestId))",
                "    return this.sessionFor(sessionId, (slot) => this.assertMayControl(slot, by))",
            )
        ],
    ),
    (
        "M8 · ⛔ the five commanding verbs ask the strict question again · one line, and the door is "
        "shut for every one of them at once",
        [
            (
                HOST,
                "    return this.sessionFor(sessionId, (slot) => this.assertMayCommand(slot, by))",
                "    return this.sessionFor(sessionId, (slot) => this.assertMayControl(slot, by))",
            )
        ],
    ),
    (
        "M9 · ⛔ `assertMayCommand` stops delegating its refusal · a caller that fails the widest "
        "question is admitted anyway, so every stranger in the process may drive every session",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — assertMayCommand still
        # has the exact two-line shape (guard + delegate to assertMayControl), just with
        # `mayCommand(slot, by)` now spelled `mayCommand(this.commandedNow(slot), by)`. Dropping the
        # delegated throw reproduces the defect verbatim: a caller that fails mayCommand is silently
        # admitted to every command-gated verb (interrupt, send, queueMessage, cancelQueuedMessage,
        # sendInterrupting).
        [
            (HOST, '  private assertMayCommand(slot: SessionSlot, by: Caller): void {\n    if (mayCommand(this.commandedNow(slot), by)) return\n    this.assertMayControl(slot, by)\n  }\n', '  private assertMayCommand(slot: SessionSlot, by: Caller): void {\n    if (mayCommand(this.commandedNow(slot), by)) return\n  }\n'),
        ],
    ),
    (
        "M10 · ⛔ the answer gate refuses the OWNER too · the person the session stopped to ask can "
        "no longer answer it, which is the state 336 §2.4 called a hang",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — assertMayAnswer's first
        # two lines are the same shape, just with `mayCommand(slot, by)` now
        # `mayCommand(this.commandedNow(slot), by)`. Disabling the mayAnswerAsAHuman door reproduces
        # the exact defect: the one person the session stopped to ask can no longer answer, because
        # every path now falls to the function's unconditional final throw.
        [
            (HOST, '    if (mayAnswerAsAHuman(slot, by)) return\n    if (!mayCommand(this.commandedNow(slot), by)) this.assertMayControl(slot, by)\n', '    if (false as boolean) return\n    if (!mayCommand(this.commandedNow(slot), by)) this.assertMayControl(slot, by)\n'),
        ],
    ),
    (
        "M11 · ⛔ a stranger is told the commander's sentence · the two refusals collapse into one, "
        "so a window holding an id it does not own is told *a person must answer this* instead of "
        "where the conversation actually is",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same function, same
        # two-refusal split (assertMayControl's not-yours/held-by-nobody vs the final
        # a-person-must-answer throw). Deleting the intermediate delegation collapses both into one
        # sentence, so a stranger on a window-held conversation is wrongly told 'a person must
        # answer this' instead of 'not yours'.
        [
            (HOST, '    if (!mayCommand(this.commandedNow(slot), by)) this.assertMayControl(slot, by)\n', ''),
        ],
    ),
    (
        "M12 · ⛔ the commander is told `not-yours` · the refusal is right and every word of the "
        "reason is a lie — it names a window to switch to, for a caller that may have none and for "
        "a conversation that may be nobody's",
        [
            (
                HOST,
                "        'a-person-must-answer',\n"
                "        `session ${slot.id} is held for ${ownerName(slot.ownerId)}, and ${callerName(by)} asked ` +\n"
                "          'to answer for a person',",
                "        'not-yours',\n"
                "        `session ${slot.id} is held for ${ownerName(slot.ownerId)}, and ${callerName(by)} asked ` +\n"
                "          'to answer for a person',",
            )
        ],
    ),
    # ── the verb list, one row per spelling ───────────────────────────────────────────────────
    (
        "M13 · ⛔ `send` is strict again — the one verb the whole ticket is about",
                # ⚑ **Re-anchored by 374, not retired.** The messaging gate is a SECOND line
                # at this verb rather than a wider `mayCommand` (340 §5's rule, in the
                # narrowing direction), so it sits between the two lines this anchor used
                # to be. ⛔ The rule this row measures is untouched, and it was re-applied
                # and re-run individually after the correction.
                #
                # ⚑ **Re-anchored AGAIN by 431, and again not retired.** A send asks
                # `requireToMessage` now — the same gate `queueMessage` asks, because the
                # two are the two spellings of one act and only one of them used to ask the
                # message entitlement (criterion 6). ⛔ The rule this row measures is still
                # untouched: the replacement is the STRICT gate, so the row still asks
                # whether a caller that is not the owner may put words in at all.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — sendAs still opens with
        # requireToMessage (the widened, message-capability entitlement) rather than the stricter
        # owner-only require — confirmed both by the surrounding prose ('340's own distinction, made
        # a second time') and by send-refusals.test.ts's own census asserting bodies.send contains
        # 'this.requireToMessage('. Nothing in D-017 touched this entitlement gate; only comment
        # lines around it changed, which is why the literal match broke.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: `send` must ask requireToMessage (the widened gate), not the strict `require`;
        # the-caller-that-may-command-but-not-watch.test.ts still measures it. Only the neighbouring
        # lines moved in D-016, so the `old` is narrowed to the one call that occurs once. Killed by
        # `the-caller-that-may-command-but-not-watch.test.ts`.
        [
            (HOST, '    const session = this.requireToMessage(sessionId, by)\n', '    const session = this.require(sessionId, by)\n'),
        ],
    ),
    (
        "M14 · ⛔ `queueMessage` is strict again — so an agent can drive a session only while it "
        "happens to be idle, which is the split the five-verb list exists to prevent",
                # ⚑ **Re-anchored by 374, not retired.** The messaging gate is a SECOND line
                # at this verb rather than a wider `mayCommand` (340 §5's rule, in the
                # narrowing direction), so it sits between the two lines this anchor used
                # to be. ⛔ The rule this row measures is untouched, and it was re-applied
                # and re-run individually after the correction.
                #
                # ⚑ **Re-anchored AGAIN by 431, and again not retired.** This verb asks
                # `requireToMessage` now — `mayCommand` widened by the reach a person
                # granted, at this one call site and no other (criterion 6). ⛔ The rule
                # this row measures is still untouched: the replacement is the STRICT gate,
                # so the row still asks what an agent may drive at all. Re-applied and
                # re-run individually after the correction.
                #
                # ⚑ **Re-anchored a THIRD time by `553`, and again not retired.** HO-060 §2 put a
                # SECOND gate on this run — `assertMayAssign`, which asks `can_assign_work` of a
                # message the caller declared work — so the anchor gained a line and lost nothing.
                # ⛔ The rule this row measures is untouched: the replacement is still the STRICT
                # gate, so it still asks what an agent may drive at all. Re-applied and re-run
                # individually after the correction.
                #
                # ⚑ **Re-anchored a FOURTH time by `565 relay 1`, and again not retired.** HO-066
                # §2.3 gave the second gate a third arm — the RECEIVER's own `takes_work_from` —
                # and it must be read ONCE for all three of its readers, so the read is hoisted
                # onto this run and handed down. ⛔ The anchor gained a line and lost nothing; the
                # rule this row measures is untouched, because the replacement is still the STRICT
                # entitlement. Re-applied and re-run individually after the correction.
                #
                # ⚑ **RE-ANCHORED a FIFTH time at `681`, not retired.** PM ruling R30b asks the walls
                # INSIDE the entitlement's gate, before *not started*, so the run is one call with
                # the walls in its closure. ⛔ The DEFECT this row plants is unchanged: the gate is
                # the STRICT one `require` asks — `assertMayControl` — spelled as `sessionFor`'s
                # gate so the walls are still asked. Re-applied and re-run individually after the
                # correction.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: `queueMessage` must ask requireToMessage so a commander can drive a busy session
        # as well as an idle one, and the same killer file measures it. The call changed shape in
        # D-016 (the wall callback is now `if (says !== null) ...` for a give's brief), so the `old`
        # and `new` follow it and the plant is the strict gate with the same walls. Killed by
        # `the-caller-that-may-command-but-not-watch.test.ts`.
        [
            (HOST, "    const session = this.requireToMessage(sessionId, by, () => {\n      if (says !== null) this.assertMayReach('message', sessionId, by)\n    })\n", "    const session = this.sessionFor(sessionId, (receiver) => {\n      this.assertMayControl(receiver, by)\n      if (says !== null) this.assertMayReach('message', sessionId, by)\n    })\n"),
        ],
    ),
    (
        "M15 · ⛔ `cancelQueuedMessage` is strict again — an agent may give work it can never take "
        "back",
        [
            (
                HOST,
                # ⚑ **Anchor corrected in place by `354`, not retired** (142's rule) — cancellation
                # names the MESSAGE now, so the signature carries a `messageId`. ⛔ **The defect is
                # unchanged**: this row still swaps `requireToCommand` for the stricter `require`,
                # which is the entitlement `340` split.
                "  async cancelQueuedMessage(sessionId: string, messageId: string, by: Caller): Promise<void> {\n"
                "    const session = this.requireToCommand(sessionId, by)",
                "  async cancelQueuedMessage(sessionId: string, messageId: string, by: Caller): Promise<void> {\n"
                "    const session = this.require(sessionId, by)",
            )
        ],
    ),
    (
        "M16 · ⛔ `sendInterrupting` is strict again",
        # ⚑ **Re-anchored by 374, not retired.** The messaging gate is a SECOND line
        # at this verb rather than a wider `mayCommand` (340 §5's rule, in the
        # narrowing direction), so it sits between the two lines this anchor used
        # to be. ⛔ The rule this row measures is untouched, and it was re-applied
        # and re-run individually after the correction.
        # ⚑ Landing D-014 · re-anchored in place, not retired — `sendInterrupting` still asks
        # `requireToCommand`, and a commander may still drive the conversation it spawned. Only the
        # comment under that line changed. Swapping in the strict `require` again refuses the
        # commander. Re-verified RED alone.
        [
            (HOST, '    const session = this.requireToCommand(sessionId, by)\n    // ⛔ **The message capability, because this verb delivers words** (374).', '    const session = this.require(sessionId, by)\n    // ⛔ **The message capability, because this verb delivers words** (374).'),
        ],
    ),
    (
        "M17 · ⛔ `interrupt` is strict again — an agent may start work and never stop it",
        # ⚑ **Re-anchored by 374, not retired.** The messaging gate is a SECOND line
        # at this verb rather than a wider `mayCommand` (340 §5's rule, in the
        # narrowing direction), so it sits between the two lines this anchor used
        # to be. ⛔ The rule this row measures is untouched, and it was re-applied
        # and re-run individually after the correction.
        # ⚑ Landing D-014 · re-anchored in place, not retired — D-014 deleted only the
        # `assertMayReach('interrupt', …)` line under `interrupt`'s `requireToCommand`. The
        # commander entitlement survives, and the card says interrupt still reaches the chain below
        # you. Re-verified RED alone.
        [
            (HOST, '  async interrupt(sessionId: string, by: Caller): Promise<void> {\n    const session = this.requireToCommand(sessionId, by)\n', '  async interrupt(sessionId: string, by: Caller): Promise<void> {\n    const session = this.require(sessionId, by)\n'),
        ],
    ),
    (
        "M18 · 🔴 `setApprovalMode` is widened to the commanding gate · the §2 defect reached one "
        "move earlier — an agent that can switch a session to `auto` has answered every permission "
        "prompt it will ever raise, in advance, and will never see a card to be refused",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The live-slot
        # `setApprovalMode` still goes through `this.require(sessionId, by)` (the owner's gate).
        # D-017b only added an earlier person-only branch, `aSettingForItsNextStart`, for a
        # conversation with no slot. The plant widens the live gate to `requireToCommand`, so a
        # commander could switch a session to `auto`.
        [
            (HOST, '    const session = this.require(sessionId, by)\n    await session.handle.setApprovalMode(mode)', '    const session = this.requireToCommand(sessionId, by)\n    await session.handle.setApprovalMode(mode)'),
        ],
    ),
    (
        "M19 · ⛔ `close` is widened to the commanding gate · *whose departure ends it* becomes an "
        "agent's answer too, so looking after a spawned conversation means being able to end "
        "somebody else's",
            # ⚠️ **RE-ANCHORED at 692, not retired.** 692 gave `close` a no-slot branch; the anchor is that branch's close and the check after it. The DEFECT this row plants is unchanged.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — `close` still gates a
        # known slot with `this.assertMayControl(slot, by)`, right after the tolerant `if (!slot)
        # return Promise.resolve()`. D-017b changed nothing on that line, but the old anchor's
        # `return Promise.resolve()\n    }` neighbour, from a no-slot branch, moved above it. The
        # plant widens the gate to `assertMayCommand`, so a commander could end somebody else's
        # conversation.
        [
            (HOST, '    if (!slot) return Promise.resolve()\n    this.assertMayControl(slot, by)', '    if (!slot) return Promise.resolve()\n    this.assertMayCommand(slot, by)'),
        ],
    ),
    # ⚑ **742 · M20's anchor corrected, not retired**: the door answers through `answerTheProvider`
    # now (`739` F-6 — the answer is bounded), so the lines under the gate's are the bound's comment.
    # The mutation is the same one, and it was re-run RED.
    (
        "M20 · ⛔ `respondPermission` reaches for the control gate · the call site, not the "
        "predicate, so the narrowing is intact and the verb walks past it · killed by `the-caller-that-may-command-but-not-watch.test.ts`",
        [
            (
                HOST,
                # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · ee88c516 gave the answer gate the request id, so a person can answer from the queue where no window holds the conversation; the plant still sends respondPermission through the control gate.
                "    const session = this.requireToAnswer(sessionId, by, requestId)\n    // 🔴 **742 · `739` F-6 — bounded**, and what follows the answer is",
                "    const session = this.require(sessionId, by)\n    // 🔴 **742 · `739` F-6 — bounded**, and what follows the answer is",
            )
        ],
    ),
    # ⚑ **740 · M21's anchor corrected, not retired**: the plan read that stood under the gate's line
    # is gone (`recordPlanPhase` compares against what the ledger holds), so the anchor is the gate's
    # line and the comment that now follows it. The mutation is the same one.
    (
        "M21 · ⛔ `respondUserInput` reaches for the control gate · the model's own card, which for "
        "Claude is the plan approval that lowers the read-only floor (150) · killed by `the-caller-that-may-command-but-not-watch.test.ts`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — respondUserInput (the
        # door for a model's own card — Claude's plan-approval among others) still gates on
        # requireToAnswer, not the plain control gate require; D-017 only inserted an earlier branch
        # (aPersonAnswersAQuestionThisAppAsked, for R6) above it, which pushed the trailing comment
        # from 'A question THIS APP is holding' to the now-adjacent '742 · 739 F-6 — bounded' note.
        # The entitlement rule itself is untouched.
        [
            # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · ee88c516 gave the answer gate the request id; the plant still sends respondUserInput through the control gate.
            (HOST, "    const session = this.requireToAnswer(sessionId, by, requestId)\n    // 🔴 **742 · `739` F-6 — bounded**, as {@link respondPermission}'s answer is.", "    const session = this.require(sessionId, by)\n    // 🔴 **742 · `739` F-6 — bounded**, as {@link respondPermission}'s answer is."),
        ],
    ),
    # ── the field ─────────────────────────────────────────────────────────────────────────────
    (
        "M22 · ⛔ the reservation throws the commander away · the door accepts the argument, the "
        "slot never holds it, and every refusal downstream is correct about a fact nobody recorded",
        [
            (
                HOST,
                "      // ⛔ Straight from the argument and never assigned again — see {@link SessionSlot.commandedBy}.\n"
                "      commandedBy,",
                "      // ⛔ Straight from the argument and never assigned again — see {@link SessionSlot.commandedBy}.\n"
                "      commandedBy: null,",
            )
        ],
    ),
    (
        "M23 · ⛔ the spawn door names the SINK as the commander instead of its argument · a "
        "window's own session is commandable by itself (which it already was) and a spawned one by "
        "nobody, so the parameter is decorative",
        [
            (
                HOST,
                # ⚑ Re-anchored by 341: the reservation argument gained `spawnedBy` and split over
                # four lines, and the commander is now read from `commander` — the one value that
                # answers "who may drive this", whether it came from the parameter or from an
                # admitted spawn's token. The mutation is unchanged: name the SINK instead.
                "          commandedBy: commander?.ownerId ?? null,",
                "          commandedBy: sink?.ownerId ?? null,",
            )
        ],
    ),
    (
        "M24 · ⛔ the new refusal has no sentence of its own · `describeUnavailable` answers with "
        "`not-yours`'s words, so the one refusal that is about authority reads as one about "
        "ownership and points at a window that may not exist",
        [
            (
                UNAVAILABLE,
                "      return 'Answering this is a person’s decision. An agent can give this conversation work, but not decide what that work is allowed to do. Open the conversation in a window and answer it there.'",
                "      return 'This conversation belongs to another window, so nothing was sent to it. Switch to that window to answer it, send to it, or close it.'",
            )
        ],
    ),
    # ── §3 · the two axes are orthogonal ──────────────────────────────────────────────────────
    (
        "M25 · 🔴 the claim takes the command with it · a person looking in on a spawned "
        "conversation silently takes the work away from the agent that commissioned it, which is "
        "the clause §3 says is the point",
        [
            (
                HOST,
                # ⚠️ **Anchor corrected by `349`, not retired.** The claim became a block when the
                # slot started recording whether a person is behind the claiming sink. Same defect,
                # one line further in: the claim takes the command with it.
                "      slot.ownerId = sink.ownerId\n",
                "      slot.ownerId = sink.ownerId\n"
                "      ;(slot as { commandedBy: string | null }).commandedBy = sink.ownerId\n",
            )
        ],
    ),
    (
        "M26 · 🔴 the release takes the command with it · the watching half is given back and the "
        "commanding half is destroyed with it, so a window that merely looked in ends the "
        "delegation by closing",
        [
            (
                HOST,
                "  private release(slot: SessionSlot): void {\n    slot.ownerId = null",
                "  private release(slot: SessionSlot): void {\n"
                "    slot.ownerId = null\n"
                "    ;(slot as { commandedBy: string | null }).commandedBy = null",
            )
        ],
    ),
    (
        "M27 · ⛔ the commander's departure ENDS the session · the third of the three questions "
        "answered yes, so *give this agent a task* means *and kill it when you stop asking*",
        [
            (
                HOST,
                "    const owned: SessionSlot[] = []\n"
                "    for (const slot of this.slots.values()) {\n"
                "      if (slot.ownerId !== ownerId) continue",
                "    const owned: SessionSlot[] = []\n"
                "    for (const slot of this.slots.values()) {\n"
                "      if (slot.commandedBy === ownerId) {\n"
                "        owned.push(slot)\n"
                "        continue\n"
                "      }\n"
                "      if (slot.ownerId !== ownerId) continue",
            )
        ],
    ),
    # ── the two censuses that keep the rest honest ────────────────────────────────────────────
    (
        "M28 · ⛔ the new sentence names no way forward · it says only that the answer was refused, "
        "which is the class of refusal 100 exists for — a person told no and left with nothing to do",
        [
            (
                UNAVAILABLE,
                "      return 'Answering this is a person’s decision. An agent can give this conversation work, but not decide what that work is allowed to do. Open the conversation in a window and answer it there.'",
                "      return 'Answering this is a person’s decision, and this caller is not one.'",
            )
        ],
    ),
    (
        "M29 · ⛔ the send-path census misfiles the two id-shaped refusals · they are recorded "
        "against `send`, so `sessionFor` grows a refusal nobody classified and the table still adds "
        "up (219 §2's whole mechanism, disarmed)",
        [
            (
                REFUSALS,
                "    id: 'unknown-session',\n    thrownBy: 'sessionFor',",
                "    id: 'unknown-session',\n    thrownBy: 'send',",
            )
        ],
    ),
]
