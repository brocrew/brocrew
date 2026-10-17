"""473 · the press that cloned nothing — `469`'s criterion-17 finding, both halves.

⛔ **What a person got.** `469` drove the ordinary spawned-child path — **Take it over**, then
**Deny** — and the press did nothing at all, silently. The card read *Not answered*, actions,
pending, panel and live all went to zero and Home returned to one item, while the child's ledger
held **zero** `user_decision` rows and the provider sat on `waiting_permission`. ⚠️ *"That is an
error projection, not a settlement."*

## 🔴 Two defects, and they are independent

| § | what it was | rows |
|---|---|---|
| the payload | `answerFor` returned `{ permission: decision.decision }` — the nested object the queue's deep `ref` had turned into a `Proxy`, which Electron refuses to structured-clone | `M1`-`M3`, `M7`, `M8` |
| the projection | `noteAnswer` read a REJECTED call as a settlement and wrote `note`, which `isAwaitingAnswer` reads as *over* | `M4`-`M6` |
| the THIRD door | ⚠️ **found by this dispatch's adversarial read of its own diff**: `noteProposal` was left on the old ruling, so one app held two rules about what silence means | `M9`, `M10` |

⚑ **The proposal arm never had the first problem**, and that asymmetry is the whole diagnosis: it
reads a BOOLEAN off the decision and writes its own literal, while the permission arm handed an
object over. `M1` is that line put back.

## ⛔ What this table deliberately does NOT contain

⚠️ **No row moving `markSent`.** `468` measured that the same flag is what replaces the buttons
inside one tick, and the brief forbids it by name: the repair is to make a rejection VISIBLE, not to
delay the flag that makes the press legible.

⚠️ **No row on `RequestDraft.answered`.** `469` F2 names it and this dispatch did not touch it: once
a bridge rejection leaves the request in `attentionQueue`, `noAnswerHere` reads the LIVE row and
never reaches the `answeredFromHere` branch at all. ⛔ A row for a change nobody made would report
as a survivor.

⚠️ **No row on §3a's in-flight half** (relay 1 §2). The sentence that replaces the buttons inside
one tick is `207` M2's and `468`'s, and *"an `AnswerAck` is not the record"* is the early return
`146` M5 already anchors on. ⛔ A fourth table mutating those lines would be three tables holding
one rule, which is the shape this dispatch spent its day repairing.

⚠️ **No row on the hand-over shape itself.** `{ permission: row.decision }` written in a NEW file
constructs nothing, so no source census can see it and no mutation of an existing line can plant it.
⛔ **That bound is written down in `the-press-that-cloned-nothing.test.ts` §4 rather than papered
over** — §1 covers the one hand-over this app has, and a new surface needs its own press.

⚠️ **No row on the census's own producer list.** `the-bridge-that-clones-nothing.test.ts` §9 asserts
the count — twelve producers across six verbs — so a list somebody shortened is red in that file
already, and a mutation ON a census is invisible to that census.

⚠️ **No row re-anchoring `146` M1/M6.** Those two anchor on the line this dispatch rewrote and were
**corrected in place**, not retired: the mutations are unchanged, the defects are unchanged, and
their labels say so. 🔴 **They keep a verdict they did not earn under the new bytes**, which is
disclosed rather than repaired — the whole of `146` was not re-run.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| `M1`, `M2` | ⚑ **`apps/desktop/test/the-press-that-cloned-nothing.test.ts`** §1, §2 and §4 |
| `M3` | ⚑ **§2 and §4** — ⚠️ **not §1**, which builds its own rows rather than folding the store's |
| `M4` | ⚑ **§3** and `apps/desktop/test/session-store.test.ts` |
| `M5`, `M6` | ⚑ **§3** — the sentence, WRITTEN OUT |
| `M7` | ⚑ **§4** — the renderer walked for a SECOND construction |
| `M8` | ⚑ **§4** — every outcome driven through the producer, one at a time |
| `M9`, `M10` | ⚑ **§3b** — the proposal door, whose rule this dispatch nearly left behind |

⚑ **§3a is not in this map and that is deliberate** — it pins standing rule §18's LINE (in flight is
said at once; done waits for the record), and every line it reads is already carried by `207` M2,
`468` and `146` M5.

⚠️ **This map was WRONG about `M5`/`M6` in its first draft, and the review that found it also fixed
the cause.** §3 compared the card's sentence against `answerNeverLeftThisWindow(…)` and nothing
else, so both sides moved together: `M6` — which drops the cause from the sentence — was green
against the section named here. ⛔ **A gate map is a claim like any other** (`468` made the same
mistake and said so). §3 now pins the words literally, which is what makes the row above true.

⛔ **Evidence this table is honest about what it can reach.** Every row was applied alone, its own
killer file run, and the tree restored from bytes — the whole table has NOT been run under the
driver, so `CENSUS.md` records it `unrun` and no verdict is claimed here.
"""

ATTENTION = "apps/desktop/src/renderer/src/lib/attention.ts"
OFFER = "apps/desktop/src/renderer/src/lib/permission-offer.ts"
STORE = "apps/desktop/src/renderer/src/lib/session-store.ts"

MUTATIONS = [
    # ── §1 · the payload ────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, restored · `answerFor` hands the nested decision over again, so every "
        "one-click permission answer from Home or the person's queue is a Vue `Proxy` on the wire — "
        "`ipcRenderer.invoke` rejects before `ipcMain` exists, no `user_decision` is written and the "
        "provider stays frozen, on a screen that says the answer landed",
        [
            (
                ATTENTION,
                "  if (decision.kind === 'permission')\n"
                "    return { permission: permissionDecisionFor(decision.decision.outcome) }\n",
                "  if (decision.kind === 'permission') return { permission: decision.decision }\n",
            )
        ],
    ),
    (
        "M2 · ⛔ the outcome stops being read off the press · the producer is called with a constant, "
        "so Allow and Deny send the same answer and a person who refused a command has approved it — "
        "cloneable, delivered, and wrong, which is the failure no clone guard can see",
        [
            (
                ATTENTION,
                "    return { permission: permissionDecisionFor(decision.decision.outcome) }\n",
                "    return { permission: permissionDecisionFor('allow') }\n",
            )
        ],
    ),
    (
        "M3 · ⚠️ the ROW's offered decisions collapse onto one outcome · every button a queue row "
        "draws carries `allow`, whatever its label says, so the press is correct all the way to the "
        "wire and answers the opposite of what it was labelled",
        [
            (
                ATTENTION,
                "            decision: permissionDecisionFor(outcome),\n",
                "            decision: permissionDecisionFor('allow'),\n",
            )
        ],
    ),
    # ── §2 · the projection ─────────────────────────────────────────────────────────────────────
    (
        "M4 · 🔴 THE SECOND DEFECT, restored · a call that never reached the host settles the card "
        "again — `note` retires the request, `isAwaitingAnswer` goes false, and the count, the "
        "panel, the live queue and Home all drop a request the provider is still frozen on",
        [
            (
                STORE,
                "      !ok || (ack?.outcome === 'refused' && ack.stillOpen) ? markAnswerRefused : markRequestFailed",
                "      ack?.outcome === 'refused' && ack.stillOpen ? markAnswerRefused : markRequestFailed",
            )
        ],
    ),
    (
        "M5 · ⛔ the sentence stops saying the card is still waiting · it goes back to the past-tense "
        "*answering this failed*, drawn above buttons that are live — a person reads that the card "
        "is over while the only thing that can end it is still on screen",
        [
            (
                STORE,
                "    'that answer did not reach the conversation, so it is still waiting — ' +\n"
                "    `you can send it again: ${cause ?? 'this window could not say why'}`",
                "    'answering this failed: ' + `${cause ?? 'this window could not say why'}`",
            )
        ],
    ),
    (
        "M6 · ⚠️ the diagnosis is dropped on the way to the card · *could not be cloned* — the words "
        "`469` found had already reached the window — are replaced by a shrug, so the one sentence "
        "that says WHY an answer bounced says nothing a person or a bug report can act on",
        [
            (
                STORE,
                "`you can send it again: ${cause ?? 'this window could not say why'}`",
                "'you can send it again.'",
            )
        ],
    ),
    # ── §3 · one producer, and the census that says so ──────────────────────────────────────────
    (
        "M7 · 🔴 a SECOND producer appears · `answerFor` writes the permission value itself again "
        "rather than calling the one function both surfaces share — which is the shape `469` F3 is "
        "about: the value is cloneable, the door is unchanged, and the next producer is free to get "
        "it wrong exactly as this one did",
        [
            (
                ATTENTION,
                "    return { permission: permissionDecisionFor(decision.decision.outcome) }\n",
                "    return { permission: { outcome: 'deny' } }\n",
            )
        ],
    ),
    (
        "M8 · ⛔ one outcome is built as another · `deny` returns `cancel`, so the graceful refusal "
        "the UI's Deny is documented to mean KILLS THE TURN instead — `permission.ts` says in as "
        "many words that a UI Deny is never `cancel`",
        [
            (
                OFFER,
                "    case 'deny':\n      return { outcome: 'deny' }",
                "    case 'deny':\n      return { outcome: 'cancel' }",
            )
        ],
    ),
    # ── §4 · the third door, found by this dispatch's read of its own diff ───────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `decideProposal`, `markProposalGone`
        # and the proposal branch of `noteAnswer` are deleted; only the permission door (`!ok ||
        # (ack?.outcome === 'refused' && ack.stillOpen)`) remains and is planted by the table's
        # other rows. D-016 removed proposals end to end, so a defect in a proposal door is no
        # longer a defect. Its anchor is left stale, so the census records it retired.
        "M9 · 🔴 the PROPOSAL door goes back to the old ruling · a `decideProposal` that never "
        "reached the host retires the card again — and this one has no way back, because "
        "`markProposalGone` takes the row out of `attentionQueue` and the queue then says "
        "*no longer waiting* about a proposal the host is still holding open",
        [
            (
                STORE,
                "      !ok || (refused && (ack as Extract<AnswerAck, { outcome: 'refused' }>).stillOpen)",
                "      refused && (ack as Extract<AnswerAck, { outcome: 'refused' }>).stillOpen",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The sentence 'the proposal is still
        # open — you can decide it again' was the proposal door in the renderer session store, which
        # no longer exists (no `proposal` text left in `lib/session-store.ts`). D-016: 'Proposals go
        # end to end, with the demo seed, the renderer fixtures and takes_work_from.' Its anchor is
        # left stale, so the census records it retired.
        "M10 · ⛔ the proposal's sentence stops saying the card is still open · it goes back to the "
        "past-tense *deciding this failed*, drawn above controls that are live — the same false "
        "tense `M5` puts back one door over",
        [
            (
                STORE,
                "    'that decision did not reach the conversation, so the proposal is still open — ' +\n"
                "    `you can decide it again: ${cause ?? 'this window could not say why'}`",
                "    'deciding this failed: ' + `${cause ?? 'this window could not say why'}`",
            )
        ],
    ),
]
