"""336 · The door a session can be created through — each row is THE DEFECT, put back verbatim (131).

⛔ **What 336 fixed, in one sentence.** `RuntimeHost.createSession` took a renderer's event sink and
reserved the slot under `sink.ownerId`, so a session created by anything else could not exist — and
that is the whole of `182` H5, which every spawn tool waits behind.

## 🔴 The measurement the rows rest on

`303` created a real Claude session under a host-owned id and then had the production renderer sink
ask for it. ⛔ **`attachOpenSessions` answered `[]`, `resume` refused with *"already open in another
window"*, and the renderer received 0 of that turn's 33 events.** The same run's same-owner control
proved the replay/live fold itself lossless — `count=56, unique=56, gaps=[], duplicates=[]` — so the
missing operation was never the stream. It was the first ownership claim, and there was none.

## ⚑ The shape, in three sentences

**An owner is the surface a slot is reserved under; `null` means nobody.** A window may take over a
session nobody owns ({@link mayClaim}) and may never take one anybody owns — including itself, which
is what `attachOpen` is for. A window that goes away **closes** what it started and **releases** what
it merely claimed, so looking in on a spawned conversation does not kill it.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M9`, `M14`-`M18` | ⚑ **`run_suite`** — `apps/desktop/test/the-door-a-session-can-be-created-through.test.ts` |
| `M10`-`M13` | ⚑ **`run_suite`** — the door file above AND `the-conversation-nobody-asked-for.demo.test.ts` |
| `M19` | ⚑ **`run_suite`** — `apps/desktop/test/session-unavailable.test.ts` |
| `M20` | ⚑ **`run_suite`** — `apps/desktop/test/shutdown-door.test.ts` |
| `M21` | ⚑ **`run_suite`** — `apps/desktop/test/window-authority.test.ts` |
| `M22`-`M23` | ⚑ **`run_suite`** — `apps/desktop/test/the-conversation-nobody-asked-for.demo.test.ts` |

## ⚠️ What this table deliberately does NOT contain

⛔ **No row flips `NO_SURFACE.alive` to `true`.** Measured: the demonstration stays GREEN, and it is
right to. `send` and `sendLiveness` on that object are no-ops, so the events would be handed to a
function that drops them instead of being kept from a function that would — the mutation changes no
observable behaviour and would record as a phantom survivor
(`a-mutation-that-changes-nothing-reports-as-a-survivor`). The ruling is written into the constant's
docblock instead.

⛔ **No row widens `attachOpenSessions`' pre-filter to `!mayControl(slot, sink) && !mayClaim(slot)`.**
The loop still calls `attachHeldSession(..., 'attach')`, which gates on `mayControl` again and
answers `null` — so the widened filter admits a slot that is then skipped anyway. A no-op. ⚑ `M5` is
the observable version: making that call CLAIM.

⛔ **No row makes `reserve` read `existing.ownerId === ownerId` without the null guard.** It would
only differ for two surfaceless creates colliding on one id, and `newSessionId` does not collide —
unobservable, so the row would mean nothing. ⚠️ **`652` made it reachable** (found by that
dispatch's own review): a second `resumeSession(id, null)` of a running conversation nobody owns IS
two surfaceless reservations of one id, and the mutant then answers `already-open` — *"you are
already looking at this"* — where the code answers `held-by-nobody`. ⚑ **`652 M8` is that row**,
killed by `a-resume-that-needs-no-window.test.ts` §1.5.

⛔ **No row removes `session.lastDisclosures = ''` from `release`.** It is 148 H5's dedupe key and
the reason it is cleared is written down, but nothing in this suite drives a state change across a
release-and-reclaim, so the row would survive its killer while describing a real defect. ⚠️ **Named
here rather than added**, because a survivor is worse than an absence: it says the assertion looked.

⛔ **No row touches `THE_APP_ITSELF`.** 203 owns that symbol and 336 does not reopen it; what this
dispatch added is the statement in its docblock that it is not an owner.

## ⚑ What the per-row killer check changed, before this table was ever run

⚠️ **The falsification of the demonstration is what set this table's bounds.** Four breaks were run
against `the-conversation-nobody-asked-for.demo.test.ts` before any row was written: three went red
(`M2`, `M3`, `M8`'s shapes) and the fourth — `alive: true` — stayed green, which is how the first
ruling above came to be written rather than guessed. ⛔ A `--dry-run` proves an anchor applies once
and could not have found it.

🔴 **`M10` then survived its killer, and the test was asserting about the wrong moment.** The
assertion read *"the window that let it go is told nothing more"* — made AFTER the next claim, which
swaps the sink itself, so it passed over a release that had left the departed window's sink in place.
⛔ The defect is real and lives entirely in the GAP between the release and the next claim: everything
recorded there was being delivered to a window that no longer owned the conversation, and the
claimer's replay would then have covered events already sent somewhere else. ⚑ The door file now
emits an event in that gap and asserts the departed window's message count did not move.

⚠️ **A second finding, from the same run.** The test helper pushed provider events at the runtime's
NEWEST handle, and the release test opens a control session after the one under test — so the marker
was landing in the control's conversation and the wait timed out looking like a product failure.
Handles are keyed by session id now.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
UNAVAILABLE = "apps/desktop/src/main/runtime/session-unavailable.ts"
RENDERER = "apps/desktop/src/renderer/src/lib/session-store.ts"

MUTATIONS = [
    # ── the defect itself ─────────────────────────────────────────────────────────────────────
    (
        "M1 · ⛔ THE DEFECT, verbatim (182 H5) · a session created with no window is reserved under "
        "a fabricated owner instead of none — so no renderer can ever be given it, which is the "
        "state 303 measured as 0 of 33 events. ⚑ ANCHOR CORRECTED IN PLACE BY 652 (142: correct, never delete) — `resumeSession`'s reservation now "
        "spells the same field the same way one indent deeper, so the anchor gained the newline "
        "that pins it to `createSession`'s own line; the defect and the kill are unchanged",
        [
            (
                HOST,
                # ⚑ Re-anchored by 340: `reserve` takes the two ownership facts as one argument
                # now (`ownerId` and `commandedBy`), because two adjacent `string | null`s are a
                # swap waiting to happen. The mutation is the same fabricated owner.
                # ⚑ Re-anchored again by 341, which added a THIRD fact to that argument
                # (`spawnedBy`) and put the object over four lines. The row now anchors on its own
                # field alone, which is both unique and immune to a fourth one arriving.
                # ⚑ Re-anchored by 652: `resumeSession` now reserves with this exact text at a
                # 12-space indent, which CONTAINS the 10-space line, so the count went to two. The
                # leading newline is what tells the two apart — ten spaces then `o`, not twelve.
                "\n          ownerId: sink?.ownerId ?? null,",
                "\n          ownerId: sink?.ownerId ?? 'host:spawned',",
            )
        ],
    ),
    (
        "M2 · ⛔ the claim gate is inverted · a conversation nobody owns is refused and one somebody "
        "owns is handed over, which is 062's refusal deleted",
        [(HOST, "  return slot.ownerId === null\n}", "  return slot.ownerId !== null\n}")],
    ),
    (
        "M3 · ⛔ the claim never takes ownership · the window is handed the conversation and still "
        "cannot act on it, and the next window can take it too",
        [
            (
                HOST,
                # ⚠️ **Anchor corrected by `349`, not retired.** That dispatch turned the claim into
                # a block, because the slot now records whether a PERSON is behind the claiming sink
                # as well as who it is. The rule and the defect are untouched — the claim stops
                # taking ownership — so the row is corrected in place: a retired row is a rule
                # nobody is watching, and this one is 336's whole door.
                "      slot.ownerId = sink.ownerId\n",
                "",
            )
        ],
    ),
    (
        "M4 · ⛔ a claim asks mayControl · exact-equality again, so the one operation this dispatch "
        "exists to add is the one that was already there and already refused",
        [
            (
                HOST,
                "    if (!(how === 'claim' ? mayClaim(slot) : mayControl(slot, sink))) return null",
                "    if (!mayControl(slot, sink)) return null",
            )
        ],
    ),
    (
        "M5 · ⛔ the reconciliation CLAIMS · every window that loads or hot-reloads silently becomes "
        "the owner of every conversation nobody asked for, including somebody else's",
        [
            (
                HOST,
                "      const session = this.attachHeldSession(slot.id, sink, 'attach')",
                "      const session = this.attachHeldSession(slot.id, sink, 'claim')",
            )
        ],
    ),
    (
        "M6 · ⛔ a RESUME quietly becomes a claim · a second door onto the same act, so the rule "
        "'a claim is deliberate and by id' is true of one verb and not of the other (169 §1)",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — resumeSession's
        # no-window-owns-it branch still calls attachHeldSession(sessionId, sink, 'attach') first
        # (now with a D-017 R5 '?? this.aPersonsWindowTakesIt(...)' fallback added after it), and
        # the guarding comment right above it still cites this exact row by name: 'and never quietly
        # becomes a claim (336 M6's rule, on this door)'. The rule is untouched; only an unrelated
        # fallback was appended.
        [
            (HOST, "        const held =\n          this.attachHeldSession(sessionId, sink, 'attach') ??", "        const held =\n          this.attachHeldSession(sessionId, sink, 'claim') ??"),
        ],
    ),
    # ── the birth fact, and what a departing window means ─────────────────────────────────────
    (
        "M7 · ⛔ a departing window RELEASES everything · a window's own conversations are left "
        "running with no surface and nothing to close them, which is 062's defect restored",
        [
            (
                HOST,
                "      if (slot.bornWithoutASurface) this.release(slot)\n      else owned.push(slot)",
                "      this.release(slot)",
            )
        ],
    ),
    (
        "M8 · ⛔ a departing window CLOSES everything · looking in on a conversation nobody asked "
        "for kills it when you close the window, which makes the door a trap",
        [
            (
                HOST,
                "      if (slot.bornWithoutASurface) this.release(slot)\n      else owned.push(slot)",
                "      owned.push(slot)",
            )
        ],
    ),
    (
        "M9 · ⛔ the birth fact is read from the CURRENT owner · a session claimed by a window is "
        "thereafter treated as one that window started, so the first claimer's departure ends it",
        [
            (
                HOST,
                # ⚑ **Anchor CORRECTED by `661`, not retired** — the birth fact gained a second way to
                # be true (*an agent asked for this conversation*, `656` F2), and the rule this row
                # carries is untouched: *a fact frozen at the reservation, never read from whoever
                # holds the session now*. ⛔ Re-verified RED against this table's own file at the
                # commit that moved it — `a-corrected-anchor-keeps-a-verdict-it-never-earned`.
                "      bornWithoutASurface: ownerId === null || anAgentAskedForIt,",
                "      bornWithoutASurface: false,",
            )
        ],
    ),
    (
        "M10 · ⛔ a released session keeps delivering into the window that let it go · the departed "
        "surface goes on being told, and the next claimer's replay then covers events already sent",
        [(HOST, "    session.sink = NO_SURFACE\n", "")],
    ),
    # ── what a claimer is handed ──────────────────────────────────────────────────────────────
    (
        "M11 · ⛔ a claim comes back as a REOPEN · the corrections a reopen applies — settling the "
        "cards, clearing the activity, closing the tool calls — are every one of them false about a "
        "conversation that never stopped (100). ⚑ REPLACEMENT CORRECTED IN PLACE BY 653 (142: "
        "correct, never delete) — it wrote `'reopened'`, which is not a `SessionHandover`: the "
        "renderer branches only on `'resumed'`, so the mutant never applied a correction and only "
        "the host-side equality checks could see it. `'resumed'` is the defect the label names",
        [(HOST, "      handover: 'attached',", "      handover: 'resumed',")],
    ),
    (
        "M12 · ⛔ the renderer takes the claim and folds nothing · the host moved the ownership and "
        "the screen stays empty, which is 172's report with a new cause",
        [
            (
                RENDERER,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 155331d5a added provider-read sequencing; omit adoption of the claimed conversation exactly as before.
                "        return adoptHandover(slot(handed.sessionId), handed, providerReadAt)",
                "        return true",
            )
        ],
    ),
    (
        "M13 · ⛔ the renderer swallows a refused claim · the press reports success, the window shows "
        "nothing, and the sentence the host wrote for the person is thrown away. ⚑ ANCHOR CORRECTED "
        "IN PLACE BY 653 (142: correct, never delete) — `claim` gained `resume`'s hold on early "
        "events, so these two lines moved one indent deeper inside its `try`; the defect and the "
        "kill are unchanged",
        [
            (
                RENDERER,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 155331d5a added provider-read sequencing; preserve it while swallowing the same refused claim.
                "        const handed = await bridge.claim({ sessionId })\n        return adoptHandover(slot(handed.sessionId), handed, providerReadAt)",
                "        const handed = await bridge.claim({ sessionId }).catch(() => null)\n        if (handed === null) return false\n        return adoptHandover(slot(handed.sessionId), handed, providerReadAt)",
            )
        ],
    ),
    # ── the report that turns a hang into a state ─────────────────────────────────────────────
    (
        "M14 · ⛔ every session is reported as unclaimed · a window's own live conversations are "
        "offered to anything that asks what is going spare",
        [(HOST, "      if (slot.ownerId !== null) continue\n", "")],
    ),
    (
        "M15 · ⛔ a session waiting on a person never says so · §2.4's whole state, silent — a "
        "conversation stopped for an answer nobody can be told is needed",
        [
            (
                HOST,
                "        waitingForAHuman: session.handle.status() === 'waiting_permission',",
                "        waitingForAHuman: false,",
            )
        ],
    ),
    (
        "M16 · ⛔ a reservation is left out of the report · 'nothing is unclaimed' comes to mean "
        "both 'nothing' and 'one whose provider has not arrived' (074)",
        [
            (
                HOST,
                # ⚠️ **Anchor corrected by `349`, not retired.** The reservation arm became a
                # multi-line literal when `commandedBy` joined it (HO-006 §4.5). Same arm, same
                # defect: the reservation is left out of the report entirely.
                "        unclaimed.push({\n"
                "          sessionId: slot.id,\n"
                "          since: slot.since,\n"
                "          // \u26a0\ufe0f **Named on a reservation too, and it is already known** (349): `commandedBy` is fixed\n"
                "          // at reservation, so a slot whose provider has not arrived can still say who will be\n"
                "          // allowed to drive it. Leaving it out of this arm would make *\"nobody commands it\"* and\n"
                "          // *\"we have not got that far\"* one value, which is 074's rule and the reason this union\n"
                "          // is a union.\n"
                "          commandedBy: slot.commandedBy,\n"
                "          running: false,\n"
                "        })\n"
                "        continue",
                "        continue",
            )
        ],
    ),
    # ── the refusals, told apart ──────────────────────────────────────────────────────────────
    (
        "M17 · ⛔ the claimer asking again is sent to a window that does not exist · 100's one "
        "sentence for several states, in the new door",
        [
            (
                HOST,
                "        slot.ownerId === sink.ownerId ? 'already-open' : 'already-open-elsewhere',",
                "        'already-open-elsewhere',",
            )
        ],
    ),
    (
        "M18 · ⛔ the diagnosis asks the owner first · a reservation whose provider has not arrived "
        "falls through every state and is reported as a conversation with no recording",
        [
            (
                HOST,
                "    const session = slot.session\n"
                "    if (session === null) {\n"
                "      const openingForMs = this.now() - slot.since",
                "    if (slot.ownerId === null && slot.session === null) {\n"
                "      const openingForMs = this.now() - slot.since",
            ),
            (
                HOST,
                # ⚠️ **ANCHOR CORRECTED IN PLACE BY 659**: every phase comparison in this file now goes
                # through one predicate, `onItsWayOut`, so the quoted line changed and the SUBJECT did
                # not. The replacement reproduces the same defect in the new spelling; re-verified RED
                # by hand against its killer.
                # ⚑ **716 · re-anchored in place, not retired** — `716` moved `whyNotClaimed`'s closing question above the reservation's (`reserve`'s order), so the owner question now follows the reservation's.
                "        { openingForMs },\n      )\n    }\n    if (slot.ownerId !== null) {",
                "        {},\n      )\n    }\n    const session = slot.session\n    if (session === null) return new SessionUnavailable('not-recorded', 'no session')\n    if (slot.ownerId !== null) {",
            ),
        ],
    ),
    (
        "M19 · ⛔ the refusal names no way forward · 100's whole complaint, in the one refusal only "
        "a take-over can reach: it says no and leaves the person nothing to press. ⚠️ **Anchor "
        "corrected by `523`, not retired** — that dispatch gave this code a second door "
        "(`releaseSession`) and the sentence dropped its take-over-only clause in the same commit, "
        "because a shared code is a shared sentence. The row is unchanged and was re-verified RED",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The refusal must still
        # name a way forward. D-017b rewrote the `not-running` sentence to 'There was nothing in
        # this conversation to act on just now. Send it a message to carry on with it.', dropping
        # 'Reopen it if it was recorded'. The plant cuts the second sentence, so the refusal leaves
        # a person nothing to do.
        [
            (UNAVAILABLE, "      return 'There was nothing in this conversation to act on just now. Send it a message to carry on with it.'", "      return 'There was nothing in this conversation to act on just now.'"),
        ],
    ),
    (
        "M20 · ⛔ a take-over is answered during a quit · it reads the ledger and a history window "
        "before it decides anything, which is the exact reason `resume` is refused there (273 §2)",
        [(IPC, "  claim: 'refused',", "  claim: 'answered',")],
    ),
    (
        "M21 · ⛔ the refusal reaches the renderer as the DIAGNOSTIC · the ids the log is for go on "
        "screen, which is the split 100 made and 336 must not undo",
        [
            (
                HOST,
                "    throw this.refusalTranslated(this.whyNotClaimed(sessionId, sink), 'take over a conversation')",
                "    throw this.whyNotClaimed(sessionId, sink)",
            )
        ],
    ),
    # ── the chain the demonstration walks ─────────────────────────────────────────────────────
    (
        "M22 · ⛔ the claim is not on the wire at all · the host can do it and no renderer can ask, "
        "which is half a door",
        [
            (
                IPC,
                "  z.object({ kind: z.literal('claim'), sessionId }),",
                "",
            )
        ],
    ),
    (
        "M23 · ⛔ the boundary claims for the wrong surface · who is taking the conversation over "
        "comes from somewhere other than the channel the ask arrived on (102's rule)",
        [
            (
                IPC,
                "      return host.claimSession(command.sessionId, sink)",
                "      return host.claimSession(command.sessionId, { ...sink, ownerId: 'someone' })",
            )
        ],
    ),
]
