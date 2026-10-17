"""354 · the message that has no name — each row is THE DEFECT, put back verbatim (131).

⛔ **This table is about an IDENTITY and the two sentences it buys, and about nothing else.** The
held message was a singleton field with no name; cancellation named the SESSION. The id is minted
once, carried on the durable ledgers and the person's cancellation surface, and REFUSED when it
names something this session is not holding. ⚠️ **`490` drew the model boundary:** no agent tool
accepts this id, so `message_agent` must not expose it as though it were a receipt the caller could
read or act on. `M15` now guards that boundary while the remaining rows guard the internal identity.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M3`, `M8`-`M12`, `M20`, `M22` | ⚑ **`run_suite`** — `apps/desktop/test/the-message-that-has-no-name.test.ts` |
| `M4`-`M6` | ⚑ **`run_suite`** — the same file, one describe per ending |
| `M7` | ⚑ **`run_suite`** — `apps/desktop/test/handed-path-send.test.ts`, the fourth writer |
| `M13` | ⚑ **`run_suite`** — the wire census in `the-message-that-has-no-name.test.ts` |
| `M14` | ⚑ **`run_suite`** — `apps/desktop/test/user-command.test.ts`, the only wire→host cancel |
| `M15`-`M19` | ⚑ **`run_suite`** — `apps/desktop/test/the-five-tools.test.ts` §7 |
| `M21` | ⚑ **`run_suite`** — `apps/desktop/test/session-store.test.ts` |
| `M23` | ⚑ **`run_suite`** — the renderer source census, which is the only instrument a click has |

## ⛔ The singleton is the rule, and no row here loosens it

**HO-007:** *"One held message per session IS one-task-per-agent, structurally."* ⚑ **So there is no
row that adds a second slot, a depth or a `next`** — the mutation that would matter is one that
makes room for a second message, and there is no line to mutate because no such line was written.
What `M22` does instead is take the id off the branch where nothing is held, which is the shape that
keeps *"queued"* and *"sent"* different answers rather than two words.

## ⚠️ Where each rail is measured, and why that took an instrument

⛔ **`M9` is the ordering row and it needed a state no test could otherwise reach.** The identity
check and the flush check give the SAME answer everywhere except one instant: a flush in flight, and
a cancel naming a message this session is not holding. Written the other way round the caller is
told *"that message is already being sent"* about a message that was never held — `340`'s finding, a
reason answering with another reason's sentence. ⚑ The test parks INSIDE `handle.send`, which is the
only place `flushing` is set, `queued` still names the held message, and the provider already has
it. Without that instrument this row would have recorded as a survivor and the ordering would have
been a comment.

## ⚠️ Two rows about lines a behaviour test cannot press

`M21` and `M23` are the renderer's two halves. The store's is measured through its fake bridge, which
records the id it was handed; the click handler's is a SOURCE census, because it lives in a `.vue`
file and the only thing worth asserting about it is which id it reads. ⛔ **Both are here rather than
nowhere**: a line no mutation can make red is a line nobody is checking.

## ⛔ What this table deliberately does NOT contain

⛔ **No row on `queuedDisclosure`'s second caller.** The attach path and `sessionDisclosures` now go
through one function, which is the protection; a row mutating one of the two call sites would be
mutating the extraction rather than a rule, and no test asserts what a RE-ATTACHED window is told
about a held message.

⛔ **No row that makes a resume re-arm the queue.** `077` ruled that a reopened conversation comes
back holding nothing, and `354` measured that it still does. A mutation that re-armed it would be a
change to that ruling, which belongs to `077`'s table and to whoever reopens the ruling.

⛔ **No row on the crash gap.** A `message_queued` written by a process that was killed has no
ending, and nothing at the next launch writes one — measured, and reported as the finding S1 needs.
It is a defect this dispatch found and did not fix, so there is no line here to put back.

## ⚠️ T-003 · after D-010 (`8bc565fa`) and D-011 (`79245533`)

D-010 retired the singleton (one held message per conversation): M17–M19 are retired by ruling beside each row, and
the section *The singleton is the rule, and no row here loosens it* describes the rule D-010 removed. The
gate line for `M15`–`M19` now covers M15–M16.
"""

QUEUED = "apps/desktop/src/main/runtime/queued-message.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
STORE = "apps/desktop/src/renderer/src/lib/session-store.ts"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the name itself ──────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 every held message is given the SAME name · a constant is still a name, and every "
        "assertion that a message HAS one goes on passing — what stops working is telling two of "
        "them apart, which is the entire point of naming them",
        [
            (
                QUEUED,
                "export const newQueuedMessageId = (): string => `msg_${randomUUID()}`",
                "export const newQueuedMessageId = (): string => 'msg_held'",
            )
        ],
    ),
    (
        "M2 · ⛔ the disclosure names the message by its TEXT · what a surface cancels by stops "
        "being the id the host minted, so two messages with the same words would be one handle",
        [
            (
                QUEUED,
                # ⚑ **Anchor corrected in place by `394`, not retired** (142's rule). That dispatch
                # made the disclosure a MAILBOX, so the ternary became a `map`. ⛔ **The DEFECT is
                # unchanged**: the id a surface cancels by becomes the message's own words.
                "    id: queued.id,\n    kind: queued.kind,",
                "    id: queued.text,\n    kind: queued.kind,",
            )
        ],
    ),
    (
        "M3 · 🔴 the LEDGER's half of the name is dropped · the slot dies with the process, so this "
        "is the only durable record that the message was called anything — S1's task rows are "
        "derived from these events and would have nothing to be named after",
        [
            (
                HOST,
                # ⚑ **Anchor corrected in place by `394`, and NARROWED** — that dispatch put a
                # `kind` line and its docblock between `messageId` and `text`, so the span this row
                # used to read now contains prose. ⛔ **The bytes this row deletes are still exactly
                # the `messageId` line**, and reading one line rather than four is what stops the
                # next comment written inside that object from retiring it again.
                "      messageId: id,\n",
                "",
            )
        ],
    ),
    # ── §2 · all four endings carry it ────────────────────────────────────────────────────────
    (
        "M4 · ⛔ the CANCELLED ending loses the name · a reader rebuilding from the ledger gets a "
        "beginning it can name and an ending it cannot join to it",
        [
            (
                HOST,
                # ⚑ **RE-ANCHORED at 690, not retired**: `takeQueuedBack` writes the ending it is
                # handed since R32 (`cancelled` by default, `retracted` for the app's own notice), so
                # the literal became `why.reason`. The subject — the cancel's name — is unchanged.
                "      type: 'message_unqueued',\n      messageId: queued.id,\n      reason: why.reason,",
                "      type: 'message_unqueued',\n      reason: why.reason,",
            )
        ],
    ),
    (
        "M5 · ⛔ the ABANDONED ending at teardown loses the name · the one ending a crash-free quit "
        "always writes, and the one a restart reads",
                # ⚑ **Anchor corrected in place by `394`** — the publish moved inside the loop
                # that abandons EVERY slot, so it is indented one level further. ⛔ **The bytes this
                # row deletes are still the `messageId` line.**
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `abandonQueued` became
        # `handOnWhatItHeld`: a stop now hands a held message to the next start, and only a message
        # cut mid-handover or dropped by `end_agent` is ended `abandoned`. That ending must still
        # name its message. The landing added the assertion to
        # `the-words-that-were-lost-and-who-asked.test.ts` §1.10.
        [
            (HOST, "        type: 'message_unqueued',\n        messageId: queued.id,\n        reason: 'abandoned',\n        text: queued.text,\n        ...(cut", "        type: 'message_unqueued',\n        reason: 'abandoned',\n        text: queued.text,\n        ...(cut"),
        ],
    ),
    (
        "M6 · ⛔ the SENT ending loses the name · the ending that follows the happy path, and the "
        "only one that says a held message became a turn",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — The `sent` ending survives, now written once per message of the turn in a `for (const {
        # queued } of went)` loop before the one user_turn, so the old 6-space anchor is dark. The
        # rule (the sent ending names the message it settles) is unchanged and D-027 added
        # per-message name assertions. The plant drops `messageId: queued.id` from that ending.
        # Killed by `the-message-that-has-no-name.test.ts`.
        [
            (HOST, "        type: 'message_unqueued',\n        messageId: queued.id,\n        reason: 'sent',\n", "        type: 'message_unqueued',\n        reason: 'sent',\n"),
        ],
    ),
    (
        "M7 · ⚠️ the FOURTH ending — a queued attachment that vanished — loses the name · four "
        "writers can end a held message and this is the one nobody remembers, which is why it has "
        "its own row rather than sharing `M5`'s",
        [
            (
                HOST,
                "        type: 'message_unqueued',\n        messageId: queued.id,\n        reason: 'abandoned',\n        text: queued.text,\n        detail: handed.refusal,",
                "        type: 'message_unqueued',\n        reason: 'abandoned',\n        text: queued.text,\n        detail: handed.refusal,",
            )
        ],
    ),
    # ── §3 · the cancel rails, and their order ────────────────────────────────────────────────
    (
        "M8 · 🔴 the identity check is deleted · the verb goes back to cancelling whatever is held "
        "when it arrives, which is the defect: the message a person was offered a cancel for can go "
        "and another can be queued behind the turn it started, inside the gap before the press",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `394` widened
        # `session.mailbox` into a `holding` array (mailbox + handed-on messages) but the
        # identity-check block that refuses a wrong id is unchanged in shape and still guards the
        # same rule. Deleting it still lets a caller be misled about what is held, now surfaced as
        # the wrong error ('there is no queued message to cancel' instead of naming the mailbox),
        # which the same killer test catches.
        [
            (HOST, "    if (queued === undefined && holding.length > 0) {\n      throw new Error(\n        `that is not a message this conversation is holding — it is holding ${holding\n          .map((one) => one.id)\n          .join(', ')}`,\n      )\n    }\n", ''),
        ],
    ),
    (
        "M9 · 🔴 the identity check moves BELOW the flush check · the two rails agree everywhere "
        "except one instant, and there a cancel naming a message this session never held is "
        "answered *that message is already being sent* — `340`'s finding, one door over",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Same
        # `holding`/`inTheMailbox` restructuring as M8; the two-rail ordering rule (identity before
        # flush) is unchanged and still has the one instant where it matters — a wrong id during a
        # live flush. Swapping the flush-check block above the identity-check block reproduces
        # exactly the 340 finding this row protects.
        [
            (HOST, "    if (queued === undefined && holding.length > 0) {\n      throw new Error(\n        `that is not a message this conversation is holding — it is holding ${holding\n          .map((one) => one.id)\n          .join(', ')}`,\n      )\n    }\n    // ⚠️ Only a message in the mailbox can be in a flush; one handed on is in none.\n    const inTheMailbox = queued !== undefined && session.mailbox.includes(queued)\n    if (session.flushing && (queued === undefined || inTheMailbox)) {\n      throw new Error('too late to cancel: that message is already being sent')\n    }\n", "    // ⚠️ Only a message in the mailbox can be in a flush; one handed on is in none.\n    const inTheMailbox = queued !== undefined && session.mailbox.includes(queued)\n    if (session.flushing && (queued === undefined || inTheMailbox)) {\n      throw new Error('too late to cancel: that message is already being sent')\n    }\n    if (queued === undefined && holding.length > 0) {\n      throw new Error(\n        `that is not a message this conversation is holding — it is holding ${holding\n          .map((one) => one.id)\n          .join(', ')}`,\n      )\n    }\n"),
        ],
    ),
    (
        "M10 · ⛔ the flush guard is deleted · `077`'s rail, unrelated to the name and re-measured "
        "because `354` moved the code around it: a cancel accepted mid-handover puts both "
        "`cancelled` and `sent` in the ledger for one message",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The flush guard itself
        # (now `session.flushing && (queued === undefined || inTheMailbox)`) is the same 077 rail
        # with the same job — refuse a cancel once the message is on the wire. Deleting it still
        # lets a cancel land mid-flush, so the ledger can end up with both `cancelled` and `sent`
        # for one message, exactly as the row describes.
        [
            (HOST, "    if (session.flushing && (queued === undefined || inTheMailbox)) {\n      throw new Error('too late to cancel: that message is already being sent')\n    }\n", ''),
        ],
    ),
    (
        "M11 · ⛔ a cancel naming a message over a session holding NOTHING reports success · the "
        "caller is told its message was taken back when there was never a message; every surface "
        "that shows a cancel as done would show one",
        [
            (
                HOST,
                "    if (!queued) throw new Error('there is no queued message to cancel')",
                "    if (!queued) return",
            )
        ],
    ),
    (
        "M12 · ⛔ the refusal stops naming what IS held · *that is not the message* leaves the caller "
        "with no way to find out what is, so the next call is a guess",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The refusal message's job
        # — name what IS held, not just that the id was wrong — is unchanged; only the array it
        # lists moved from `session.mailbox` to `holding`. Stripping the 'it is holding …' clause
        # still leaves a caller with no way to discover what is actually queued, which the same
        # killer test pins by checking the thrown message contains the held id.
        [
            (HOST, "        `that is not a message this conversation is holding — it is holding ${holding\n          .map((one) => one.id)\n          .join(', ')}`,\n", "        'that is not a message this conversation is holding',\n"),
        ],
    ),
    # ── §4 · the wire ─────────────────────────────────────────────────────────────────────────
    (
        "M13 · 🔴 the cancel command accepts a missing name and fills one in · `303` B from the "
        "other side: a field that is not REQUIRED is a field an older shape travels without, and "
        "the command that names no message goes back to cancelling whatever is held",
        [
            (
                IPC,
                "  z.object({ kind: z.literal('cancelQueuedMessage'), sessionId, messageId }),",
                "  z.object({\n    kind: z.literal('cancelQueuedMessage'),\n    sessionId,\n    messageId: messageId.default(''),\n  }),",
            )
        ],
    ),
    (
        "M14 · ⛔ the boundary drops the name on the floor · the id crosses the wire and is then not "
        "handed on, which is the one place a whole layer of this change can be undone by a line "
        "that still compiles",
        [
            (
                IPC,
                "      return await host.cancelQueuedMessage(command.sessionId, command.messageId, sink)",
                "      return await host.cancelQueuedMessage(command.sessionId, 'msg_whatever', sink)",
            )
        ],
    ),
    # ── §5 · the tool ─────────────────────────────────────────────────────────────────────────
    (
        "M15 · 🔴 `message_agent` exposes the held message's internal name again · no agent tool "
        "accepts it, so the answer invents a receipt-shaped handle the caller cannot read or act on",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — `message_agent`'s
        # queued-branch payload still must never leak the internal held-message id; the object
        # literal moved (a `went_to` spread was inserted by D-017 · R10) but the same `outcome:
        # 'ok', delivery: 'queued', agent, kind: says` triple is still there and `QueueOutcome`'s
        # queued variant still carries `messageId`.
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 32981d722 inserted the durable message-act fact; preserve it while exposing the original invalid message handle.
            (TOOLS, "                delivery: 'queued',\n                messageAct,\n                agent,\n                kind: says,", "                delivery: 'queued',\n                messageAct,\n                agent,\n                kind: says,\n                message: outcome.messageId,"),
        ],
    ),
    (
        "M16 · ⛔ the SENT branch invents a name · nothing is being held, so an id handed back there "
        "is a handle to nothing — `347`'s *a tool answering with an id would invent a handle nothing "
        "else accepts*, arriving one dispatch late through the other branch",
                # ⚑ **415 · `kind` rides both branches** — see `M15`.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The sent-branch payload
        # still must carry no handle at all, because `QueueOutcome`'s 'sent' variant has no
        # `messageId` field to leak (`390`'s design, quoted in shared/runtime-ipc.ts: "No messageId
        # ... An id handed back here would name a message that was never held"). The object literal
        # moved (the `went_to` spread was inserted) but the same triple is still there.
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 32981d722 inserted the durable message-act fact; preserve it while exposing the original invalid message handle.
            (TOOLS, "                  delivery: 'sent',\n                  messageAct,\n                  agent,\n                  kind: says,", "                  delivery: 'sent',\n                  messageAct,\n                  agent,\n                  kind: says,\n                  message: agent,"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The subject no longer exists. D-010
        # (8bc565fa) deleted the whole `if (error instanceof MessageAlreadyHeld)` branch in
        # agent-tools.ts, and with it `refuseTool('a-message-you-cannot-withdraw-is-waiting', {
        # agent, holding: error.heldMessageId, … })`. Its anchor is left stale, so the census
        # records it retired (`anchor-absent`).
        "M17 · 🔴 the refusal's `holding` names the AGENT instead of the message · two strings in one "
        "payload, and only one of them is the answer — an assertion over the whole payload would be "
        "satisfied by the neighbour",
        [
            (
                TOOLS,
                # ⚑ **Anchor corrected in place by `703`** — the held rail answers in two words now,
                # by what is held (`698` F-B), and this row's killer (`the-five-tools.test.ts` §7)
                # holds the caller's own QUESTION, so it meets the NEW word's arm. ⛔ **The DEFECT is
                # unchanged**: `holding` names the agent instead of the held message. Re-verified RED
                # individually against `the-five-tools.test.ts`.
                "                const cannot = refuseTool('a-message-you-cannot-withdraw-is-waiting', {\n"
                "                  agent,\n"
                "                  holding: error.heldMessageId,\n",
                "                const cannot = refuseTool('a-message-you-cannot-withdraw-is-waiting', {\n"
                "                  agent,\n"
                "                  holding: agent,\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The subject no longer exists: D-010
        # deleted `MessageAlreadyHeld` and the refusal that named the held message; a message sent
        # to a busy agent is now held, not refused. Its anchor is left stale, so the census records it retired
        # (`anchor-absent`).
        "M18 · ⛔ the held-message refusal falls through to the generic one · criterion 13 asks for a "
        "refusal that NAMES the held message; this one answers *that agent is not in a state where "
        "it can be given anything to do*, which is true of a different situation",
        [
            (
                TOOLS,
                "            if (error instanceof MessageAlreadyHeld) {",
                "            if (false as boolean) {",
            )
        ],
    ),
    # ── §6 · the host's typed refusal ─────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** D-010 deleted the host's `throw new
        # MessageAlreadyHeld(heldWork.id, …)` together with its predicate `theWorkAHoldWaitsBehind`.
        # It also removed the class from queued-message.ts (`-export class MessageAlreadyHeld
        # extends Error`). Its anchor is left stale, so the census records it retired
        # (`anchor-absent`).
        "M19 · 🔴 the refusal carries a name nobody is holding · the class exists so the tool layer "
        "does not have to read an id out of prose, and a constant makes it a second way of saying "
        "nothing",
        [
            (
                HOST,
                # ⚑ **Anchor corrected in place by `394`** — the singleton reads the mailbox for the
                # held WORK message now. ⛔ **The DEFECT is unchanged**: the refusal names a constant
                # instead of the message it is refusing on behalf of.
                # ⚑ **…and by `703`**, which passes what is held as a second argument. Re-verified RED
                # individually against `the-five-tools.test.ts`.
                "      throw new MessageAlreadyHeld(\n        heldWork.id,\n",
                "      throw new MessageAlreadyHeld(\n        'msg_something',\n",
            )
        ],
    ),
    (
        "M20 · ⚠️ the queued outcome answers with a name that is not the one it recorded · the slot, "
        "the ledger and the caller must be told one string; two of the three agreeing is what makes "
        "a handle stop working days later",
        [
            (
                HOST,
                "    return { outcome: 'queued', messageId: id }",
                "    return { outcome: 'queued', messageId: newQueuedMessageId() }",
            )
        ],
    ),
    # ── §7 · the two renderer halves ──────────────────────────────────────────────────────────
    (
        "M21 · ⛔ the store cancels by session and drops the name · it would not fail here — the "
        "command is refused a layer further out, by a schema no renderer test runs — so the fake "
        "bridge recording what it was handed is the only instrument that can see it",
        [
            (
                STORE,
                "      await forSession(sessionId, () => bridge.cancelQueuedMessage({ sessionId, messageId }))",
                "      await forSession(sessionId, () => bridge.cancelQueuedMessage({ sessionId }))",
            )
        ],
    ),
    (
        "M22 · ⚠️ the composer names a message it was never shown · reading the id from anywhere but "
        "the live disclosure is the stale-handle defect this whole dispatch is about, arriving from "
        "the one direction a person can actually reach",
        [
            (
                SCREEN,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 688: the handler names the PRESSED row now, never the
                # disclosure's head (R33, and `688`'s review removed the head fallback). The row — the
                # screen naming a message this window was never shown — is unchanged.
                "  if (id) void store.cancelQueuedMessage(id, messageId)",
                "  if (id) void store.cancelQueuedMessage(id, 'msg_whatever')",
            )
        ],
    ),
    (
        "M23 · ⚠️ *nothing is held* answers with the FLUSH's sentence · a set whose members must "
        "differ needs a distinctness check, and this is the member that would be FALSE: nothing was "
        "ever queued, so nothing is being sent. `340` found a reason answering with another "
        "reason's sentence while the whole vocabulary walk passed it. ⛔ **The row `M11` used to be "
        "put a TRUE sentence in this branch and survived** — a mutation whose result is still "
        "accurate is measuring nothing, and the distinctness assertion that let it through compared "
        "two strings that could not have been equal",
        [
            (
                HOST,
                "    if (!queued) throw new Error('there is no queued message to cancel')",
                "    if (!queued)\n      throw new Error('too late to cancel: that message is already being sent')",
            )
        ],
    ),
]
