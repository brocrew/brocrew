"""737 · The wave's draws — a first message and its start in one act, the asking agent named, two
conversations of one agent told apart, the Stop in R43's words, a conversation busy until its last
command settles, and an MCP server's form drawn as its CLI draws it.

⚑ **The PM's five draws**, all built on facts `main` already carries: `735`'s `startAndSend` (§3, F-5,
F-6), `732`'s and `734`'s `agentProfile` (`734` F-2, `732` F-4), `730` F-3's words, `730` F-7's
count, and `728`'s `mcpServerAsks`.

## 🔴 What has to be killable

 * `M1`–`M3` 🔴 **`730` F-7**: `busy` lowered by the first command to settle, never raised, or never
   lowered.
 * `M4`–`M15`, `M77` 🔴 **`735` §3**: the store's one door — the attachments' plain copy (F-5), each
   adoption, the kept start's sentence, the cleanup, the Cancel's name — the pane's sentence for each
   answer (F-6), the screen's door and its line, and the ask this window must not make while it is
   being handed the conversation.
 * `M16`–`M31` 🔴 **`734` F-2 · `732` F-4 — the asking agent named**: the roster read or dropped at
   every hop (the fold's facts, NoticeEntry, the Stop's words), the category where there is no
   identity or no roster, never the handle.
 * `M32`–`M53` 🔴 **`734` F-2 — two conversations of one agent**: counted by conversation, ranked by
   the earliest row, the words for two and for more, drawn whole on both surfaces over the whole look.
 * `M54`–`M67` 🔴 **`730` F-3 — the Stop in R43's words**: both titles, both feet, the queue clause,
   the drawer's approval title, and the clause composed from `ASKED_TO_STOP` rather than retyped.
 * `M68`–`M76` 🔴 **`728` — a server's form as its CLI draws it**: the chip, the word *Allow*, keyed
   on the server's marker and no other, and one spelling on the card and on Home.
 * `M78`–`M87` 🔴 **the review's rounds**: a message that went to a conversation that ended in the
   air, a kept start that ended, a start not undone said once, the late Cancel said and drawn, the
   pane's own lines standing down, an adoption skipped mid-hand-over, a server's card read back as
   *Allowed*, and the namesake line's *reached you first*.

## ⛔ What this table cannot reach

 * ⚠️ **`735` F-2, an undone start's seam**: nothing is drawn, because no ledger row says a start was
   undone (a GAP for main) — so there is no line to mutate.
 * ⚠️ **Equivalent, measured SURVIVED by the author**: deleting `fact.by === 'an-agent' && ` from
   `whoAskedItToStop` — `stoppedBy` ignores the name on every other arm, so no drawing can differ.

## ⚑ WRITTEN, not run as a table

⛔ **Writing rows is routine, RUNNING a table is rare and deliberate.** Each row was verified RED alone
with `scripts/mutations/verify_row.py` — one row, its killer file, restored from bytes — in an isolated
worktree, and no `mutations.txt` exists.

## ⚠️ T-003 · after D-010 (`8bc565fa`) and D-011 (`79245533`)

D-010 deleted `queueTaken` and made the busy foot and placeholder offer to queue unconditionally: M60
and M65 are retired (their defects became the decision); M59 and M61 were corrected in place (M61's
inverted gate hid the offer, the opposite of the decision).
"""

from __future__ import annotations

KEPT_OPEN = 'apps/desktop/src/renderer/src/lib/kept-open.ts'
KEPTOPENPANE = 'apps/desktop/src/renderer/src/components/KeptOpenPane.vue'
RUNTIMESCREEN = 'apps/desktop/src/renderer/src/components/RuntimeScreen.vue'
SESSION_STORE = 'apps/desktop/src/renderer/src/lib/session-store.ts'
ATTENTION = 'apps/desktop/src/renderer/src/lib/attention.ts'
CONVERSATIONPANE = 'apps/desktop/src/renderer/src/components/ConversationPane.vue'
NOTICEENTRY = 'apps/desktop/src/renderer/src/components/NoticeEntry.vue'
PERMISSIONCARD = 'apps/desktop/src/renderer/src/components/PermissionCard.vue'
PERMISSION_OFFER = 'apps/desktop/src/renderer/src/lib/permission-offer.ts'
PERSONSQUEUE = 'apps/desktop/src/renderer/src/components/PersonsQueue.vue'
PERSONS_QUEUE = 'apps/desktop/src/renderer/src/lib/persons-queue.ts'
PROJECTWORKSPACE = 'apps/desktop/src/renderer/src/components/ProjectWorkspace.vue'
PROMPTCOMPOSER = 'apps/desktop/src/renderer/src/components/PromptComposer.vue'
SESSIONCONTROLS = 'apps/desktop/src/renderer/src/components/SessionControls.vue'
STOP_UNANSWERED = 'apps/desktop/src/renderer/src/lib/stop-unanswered.ts'
TRANSCRIPT = 'apps/desktop/src/renderer/src/lib/transcript.ts'

MUTATIONS = [
    # ── 730 F-7 — busy counts ─────────────────────────────────────────────────────────────────────────────
    (
        "M1 · 730 F-7 · busy is a boolean again — the first command to settle lowers it under the second — killed by `session-store.test.ts`",
        [(SESSION_STORE, "      record.busy = stillOut > 0\n", "      record.busy = false\n")],
    ),
    (
        "M2 · 730 F-7 · a command is never counted, so the first to settle leaves none out — killed by `session-store.test.ts`",
        [(SESSION_STORE, "    commandsInFlight.set(record, (commandsInFlight.get(record) ?? 0) + 1)\n", "")],
    ),
    (
        "M3 · 730 F-7 · a settled command is never counted down, so busy never falls — killed by `session-store.test.ts`",
        [(SESSION_STORE, "      const stillOut = (commandsInFlight.get(record) ?? 1) - 1\n", "      const stillOut = commandsInFlight.get(record) ?? 1\n")],
    ),
    # ── 735 §3 — the first message and its start, in one act ─────────────────────────────────────────────
    (
        "M4 · 735 F-5 · the store hands the wire the composer's own reactive array — killed by `session-store.test.ts`",
        [(SESSION_STORE, "            ...(attachments.length === 0 ? {} : { attachments: overTheWire(attachments) }),\n", "            ...(attachments.length === 0 ? {} : { attachments }),\n")],
    ),
    (
        "M5 · 735 §3 · a sent first message is not adopted — the conversation it started is not open here — killed by `session-store.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — `session-store.ts`'s
        # `startAndSend` still adopts a sent first message's conversation; D-017 · R10 wraps the
        # target in `went === null ? starting : slot(went)` (a replacement lookup) but the
        # `adoptHandover(..., answer.sent)` call this row deletes is still exactly one statement.
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 155331d5a added provider-read sequencing; omit only adoption of a successful sent first message.
            (SESSION_STORE, "          adoptHandover(went === null ? starting : slot(went), answer.sent, providerReadAt)\n", ""),
        ],
    ),
    (
        "M6 · 735 F-1 · a start kept and handed over is not adopted — killed by `session-store.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The
        # kept-and-handed-over-running branch still calls `adoptHandover(running, refusal.running)`,
        # where `running` is now computed one line above via the same R10 replacement lookup;
        # deleting the call still un-adopts the running conversation exactly as before.
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 155331d5a added provider-read sequencing; omit only adoption of the held running start.
            (SESSION_STORE, "          adoptHandover(running, refusal.running, providerReadAt)\n", ""),
        ],
    ),
    (
        "M7 · 735 F-1 · the host's sentence is not said beside the conversation it handed over — killed by `session-store.test.ts`",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The host's sentence is
        # still written beside the handed-over conversation, now as `running.error = refusal.said`
        # (`running` being the R10-aware target); deleting it re-plants 'the host's sentence is not
        # said beside the conversation it handed over' unchanged.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives. When
        # a refused first message hands the caller a running conversation, the host's sentence is
        # still said beside it (`running.error = said` in `store.startAndSend`), now reached through
        # the one press "Open the conversation". Only the `running.error = said` line moved; the
        # plant deletes it.
        [
            (SESSION_STORE, '            running.error = said\n', ''),
        ],
    ),
    (
        "M8 · 735 §3 · a refused first message leaves a half-record for the list — killed by `session-store.test.ts`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives. A
        # refused first message on a record with no meta must be deleted, never left as a
        # half-record for the list (`if (starting.meta === null) sessions.delete(sessionId)` in
        # `startAndSend`). The plant keeps the record when there is no meta. Use the two-line
        # anchor, because the one-line `if (starting.meta === null) sessions.delete(sessionId)`
        # occurs twice in the file.
        [
            (SESSION_STORE, '        if (starting.meta === null) sessions.delete(sessionId)\n        else starting.error = said\n', '        if (starting.meta !== null) starting.error = said\n'),
        ],
    ),
    (
        "M9 · 735 §3 · the start is not named under the conversation's own id, so the pane's Cancel cannot reach it — killed by `session-store.test.ts`",
        [(SESSION_STORE, "        const answer = await forLaunch(resumeError, sessionId, (launchKey) =>\n", "        const answer = await forLaunch(resumeError, `first:${sessionId}`, (launchKey) =>\n")],
    ),
    (
        "M10 · 737 · the window asks the host about a conversation it is being handed — a round trip the hand-over answers, which `M84`'s skip keeps from adopting it early — killed by `a-conversation-a-quit-left-open-starts-on-its-first-message.test.ts`",
        [(SESSION_STORE, "    if ((sessions.get(sessionId)?.handover ?? 0) > 0) return\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The subject is deleted. D-017b removed
        # the kept-open pane and every sentence about whether a process runs.
        # `FIRST_MESSAGE_REFUSALS` no longer has `no-longer-waiting` or `stillWaiting`, and
        # `IT_IS_NO_LONGER_WAITING` was deleted with `kept-open.ts` and has no reference left in
        # `apps/desktop/src`. There is no second sentence left to draw for that fact. Its anchor is
        # left stale, so the census records it retired.
        "M11 · 735 F-6 · no-longer-waiting draws the host's sentence, the second sentence for one fact — killed by `a-conversation-a-quit-left-open-starts-on-its-first-message.test.ts`",
        [(KEPT_OPEN, "  if (refusal.refusedBy === 'no-longer-waiting') return `${IT_IS_NO_LONGER_WAITING}.`\n", "")],
    ),
    (
        # ⚑ Landing D-017b (3af91dcb) · killer:
        # `a-message-from-a-conversations-view-goes-where-the-host-ruled.test.ts` (*a cancelled
        # start says nothing beside the box*); the older note that no test builds a record with meta
        # is out of date.
        "M12 · 735 §3 · a start the person cancelled is said as a refusal — killed by `a-conversation-a-quit-left-open-starts-on-its-first-message.test.ts`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives in
        # `startAndSend`: `const said = refusal.launch === 'cancelled' ? null : refusal.said`, so a
        # start the person cancelled is not said as a refusal. The plant drops the cancelled special
        # case. The label's old killer was rewritten, and the surviving cancelled-answer test uses a
        # bare record (`meta === null`), which is deleted either way, so no existing test goes red.
        [
            (SESSION_STORE, "        const said = refusal.launch === 'cancelled' ? null : refusal.said\n", '        const said = refusal.said\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The subject is deleted. This row
        # pinned a kept-and-handed-over start being said in the pane the person is taken away from.
        # D-017b deleted the reduced kept-open pane (`KeptOpenPane.vue` and the `kept-open.ts`
        # window words), and there is no pane to be taken away from. The conversation is now opened
        # in place by the one press "Open the conversation". Its anchor is left stale, so the census
        # records it retired.
        "M13 · 735 F-1 · a start kept and handed over is said in the pane the person is taken away from — killed by `a-conversation-a-quit-left-open-starts-on-its-first-message.test.ts`",
        [(KEPT_OPEN, "  if (came.openHere) return null\n", "")],
    ),
    (
        "M14 · 735 §3 · the first message is two acts again (the start, then the send) — killed by `a-conversation-a-quit-left-open-starts-on-its-first-message.test.ts`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives and is
        # now pinned harder. The screen continues a recorded conversation in one act,
        # `store.startAndSend`, never the start and then the send. The plant puts `store.resume`
        # then `store.send` back inside `continueIt`, still inside `draftSweep.reopening`. The
        # rewritten killer's census asserts the `continueIt` regexes and
        # `.not.toMatch(/store\.resume\(|store\.send\(/)`.
        [
            (RUNTIMESCREEN, '    answer.came = await store.startAndSend(sessionId, text, attachments)\n', "    const opened = await store.resume(sessionId)\n    answer.came = opened === null ? null : { sent: await store.send(opened, text, 'now', attachments), openHere: true }\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The subject is deleted. The screen no
        # longer nulls `NO_LONGER_WAITING` on a moved line, because the `no-longer-waiting` refusal
        # and `IT_IS_NO_LONGER_WAITING` were removed with the kept-open pane, and
        # `FirstMessageNotSent.notSent` is now `{refusedBy, said, launch, running}`. There is no
        # such line to null. Its anchor is left stale, so the census records it retired.
        "M15 · 735 F-6 · the screen nulls NO_LONGER_WAITING on the promise of a moved line a failed re-read never draws — killed by `a-conversation-a-quit-left-open-starts-on-its-first-message.test.ts`",
        [(RUNTIMESCREEN, "    if (keptOpen.value?.info.sessionId === sessionId) keptOpenFailure.value = refusal\n", "    if (keptOpen.value?.info.sessionId === sessionId)\n      keptOpenFailure.value = refusal === NO_LONGER_WAITING ? null : refusal\n")],
    ),
    # ── 734 F-2 · 732 F-4 — the asking agent, named ─────────────────────────────────────────────────────────
    (
        "M16 · 734 F-2 · an absent identity reaches agentName (BroBot) — killed by `the-agent-that-asked-a-stop-named.render.test.ts`",
        [(STOP_UNANSWERED, "    fact.by === 'an-agent' && fact.agentProfile !== undefined && identities !== null\n", "    fact.by === 'an-agent' && identities !== null\n")],
    ),
    (
        "M17 · 734 F-2 · a roster-less reader names the slug, not the category — killed by `the-agent-that-asked-a-stop-named.render.test.ts`",
        [(STOP_UNANSWERED, "    fact.by === 'an-agent' && fact.agentProfile !== undefined && identities !== null\n", "    fact.by === 'an-agent' && fact.agentProfile !== undefined\n")],
    ),
    (
        "M18 · 734 F-2 · the asker is drawn by its slug, not agentName's name — killed by `the-agent-that-asked-a-stop-named.render.test.ts`",
        [(STOP_UNANSWERED, "      ? agentName(fact.agentProfile, identities)\n", "      ? fact.agentProfile\n")],
    ),
    (
        "M19 · 734 F-2 · whoAskedItToStop always says the category — killed by `the-agent-that-asked-a-stop-named.render.test.ts`",
        [(STOP_UNANSWERED, "  return stoppedBy(fact.by, named)\n", "  return stoppedBy(fact.by, null)\n")],
    ),
    (
        "M20 · 734 F-2 · the ask's sentence drops the roster — killed by `the-agent-that-asked-a-stop-named.render.test.ts`",
        [(STOP_UNANSWERED, "  return `${ASKED_TO_STOP} by ${whoAskedItToStop(fact, identities)}`\n", "  return `${ASKED_TO_STOP} by ${whoAskedItToStop(fact, null)}`\n")],
    ),
    (
        "M21 · 734 F-2 · R83's sentence drops the roster — killed by `the-agent-that-asked-a-stop-named.render.test.ts`",
        [(STOP_UNANSWERED, "  return `${who} has not answered the stop asked for by ${whoAskedItToStop(fact, identities)}`\n", "  return `${who} has not answered the stop asked for by ${whoAskedItToStop(fact, null)}`\n")],
    ),
    (
        "M22 · 734 F-2 · the Stop's sentence drops the roster — killed by `the-agent-that-asked-a-stop-named.render.test.ts`",
        [(STOP_UNANSWERED, "  return `${stopUnansweredSays(fact, provider, identities)} — while that ask stands, Stop joins it rather than asking ${who} again`\n", "  return `${stopUnansweredSays(fact, provider)} — while that ask stands, Stop joins it rather than asking ${who} again`\n")],
    ),
    (
        "M23 · 734 F-2 · ConversationPane hands the Stop's words no roster — killed by `the-agent-that-asked-a-stop-named.render.test.ts`",
        [(CONVERSATIONPANE, "        // ⚑ **737 · and which agent asked**, named as the notice names it (`734` F-2).\n        props.identities ?? null,\n", "        null,\n")],
    ),
    (
        "M24 · 734 F-2 · NoticeEntry re-says the ask without the roster — killed by `the-agent-that-asked-a-stop-named.render.test.ts`",
        [(NOTICEENTRY, "    : askedToStopSays(props.item.askedToStop, props.identities ?? null),\n", "    : askedToStopSays(props.item.askedToStop, null),\n")],
    ),
    (
        "M25 · 734 F-2 · NoticeEntry draws the fold's category text for the ask — killed by `the-agent-that-asked-a-stop-named.render.test.ts`",
        [(NOTICEENTRY, "    ? stopAskedOrText.value\n", "    ? props.item.text\n")],
    ),
    (
        "M26 · 734 F-2 · NoticeEntry re-says R83 without the roster — killed by `the-agent-that-asked-a-stop-named.render.test.ts`",
        [(NOTICEENTRY, "        props.provider ?? null,\n        props.identities ?? null,\n", "        props.provider ?? null,\n        null,\n")],
    ),
    (
        "M27 · 734 F-2 · the fold keeps no facts on the ask's notice — killed by `the-agent-that-asked-a-stop-named.render.test.ts`",
        [(TRANSCRIPT, "        text: askedToStopSays(askedToStop, null),\n        askedToStop,\n", "        text: askedToStopSays(askedToStop, null),\n")],
    ),
    (
        "M28 · 734 F-2 · the ask's fact drops the identity — killed by `the-agent-that-asked-a-stop-named.render.test.ts`",
        [(TRANSCRIPT, "        ...(askerIs === undefined ? {} : { agentProfile: askerIs }),\n", "")],
    ),
    (
        "M29 · 734 F-2 · the ask's fact drops the handle — killed by `the-agent-that-asked-a-stop-named.render.test.ts`",
        [(TRANSCRIPT, "        ...(asker === undefined ? {} : { agent: asker }),\n", "")],
    ),
    (
        "M30 · 734 F-2 · the fold's text prints the handle again (main's) — killed by `the-agent-that-asked-a-stop-named.render.test.ts`",
        [(TRANSCRIPT, "        text: askedToStopSays(askedToStop, null),\n", "        text: `asked to stop by ${askedToStop.agent ?? 'an agent'}`,\n")],
    ),
    (
        "M31 · 734 F-2 · R83's fact drops the identity — killed by `the-agent-that-asked-a-stop-named.render.test.ts`",
        [(TRANSCRIPT, "        ...(event.agentProfile === undefined ? {} : { agentProfile: event.agentProfile }),\n", "")],
    ),
    # ── 734 F-2 — two conversations of one agent, told apart ──────────────────────────────────────────────
    (
        "M32 · 734 F-2 · namesakes · a single conversation is nobody's namesake — killed by `two-conversations-of-one-agent-told-apart.test.ts`",
        [(PERSONS_QUEUE, "    if (conversations === undefined || conversations.size < 2) continue\n", "    if (conversations === undefined || conversations.size < 1) continue\n")],
    ),
    (
        "M33 · 734 F-2 · namesakes · conversations, not rows (keyed by sessionId) — killed by `two-conversations-of-one-agent-told-apart.test.ts`",
        [(PERSONS_QUEUE, "    conversations.set(\n      row.sessionId,\n", "    conversations.set(\n      row.key,\n")],
    ),
    (
        "M34 · 734 F-2 · namesakes · a conversation reached you with its EARLIEST row — killed by `two-conversations-of-one-agent-told-apart.test.ts`",
        [(PERSONS_QUEUE, "          : Math.min(waiting, row.blockedSince),\n", "          : Math.max(waiting, row.blockedSince),\n")],
    ),
    (
        "M35 · 734 F-2 · namesakes · one unstamped row leaves its conversation with no since — killed by `two-conversations-of-one-agent-told-apart.test.ts`",
        [(PERSONS_QUEUE, "        : waiting === null || waiting === undefined || row.blockedSince === null\n", "        : waiting === null || waiting === undefined\n")],
    ),
    (
        "M36 · 734 F-2 · namesakes · an unstamped conversation leaves the group unranked — killed by `two-conversations-of-one-agent-told-apart.test.ts`",
        [(PERSONS_QUEUE, "    const told = since.every((at) => at !== null) && new Set(since).size === since.length\n", "    const told = new Set(since).size === since.length\n")],
    ),
    (
        "M37 · 734 F-2 · namesakes · two alike leave the group unranked — killed by `two-conversations-of-one-agent-told-apart.test.ts`",
        [(PERSONS_QUEUE, "    const told = since.every((at) => at !== null) && new Set(since).size === since.length\n", "    const told = since.every((at) => at !== null)\n")],
    ),
    (
        "M38 · 734 F-2 · namesakes · rank counts those that waited LONGER, strictly — killed by `two-conversations-of-one-agent-told-apart.test.ts`",
        [(PERSONS_QUEUE, "since.filter((at) => at !== null && at < mine)", "since.filter((at) => at !== null && at <= mine)")],
    ),
    (
        "M39 · 734 F-2 · namesakes · others is the OTHER conversations — killed by `two-conversations-of-one-agent-told-apart.test.ts`",
        [(PERSONS_QUEUE, "    namesakes.set(row.key, { name: asker.name, others: conversations.size - 1, rank })\n", "    namesakes.set(row.key, { name: asker.name, others: conversations.size, rank })\n")],
    ),
    (
        "M40 · 734 F-2 · namesakes · the asker's hop, never a later one — killed by `two-conversations-of-one-agent-told-apart.test.ts`",
        [(PERSONS_QUEUE, "    const asker = row.chain[0]\n    if (asker === undefined) continue\n    const conversations = byName.get(asker.name) ?? new Map<string, number | null>()\n", "    const asker = row.chain[row.chain.length - 2]\n    if (asker === undefined) continue\n    const conversations = byName.get(asker.name) ?? new Map<string, number | null>()\n")],
    ),
    (
        "M41 · 734 F-2 · namesakes · 'another' is exactly one other — killed by `two-conversations-of-one-agent-told-apart.test.ts`",
        [(PERSONS_QUEUE, "    others === 1\n      ? `${name} has another conversation asking you something too`\n", "    others === 0\n      ? `${name} has another conversation asking you something too`\n")],
    ),
    (
        "M42 · 734 F-2 · namesakes · the words when the look cannot rank — killed by `two-conversations-of-one-agent-told-apart.test.ts`",
        [(PERSONS_QUEUE, "  if (rank === null) return `${lead}; each row opens its own conversation.`\n", "  if (rank === null) return `${lead}.`\n")],
    ),
    (
        "M43 · 734 F-2 · namesakes · second of two, last of more — killed by `two-conversations-of-one-agent-told-apart.test.ts`",
        [(PERSONS_QUEUE, "this conversation reached you ${count === 2 ? 'second' : 'last'}.", "this conversation reached you ${count === 3 ? 'second' : 'last'}.")],
    ),
    (
        "M44 · 734 F-2 · namesakes · the last is rank = count — killed by `two-conversations-of-one-agent-told-apart.test.ts`",
        [(PERSONS_QUEUE, "  if (rank === count) {\n", "  if (rank === others) {\n")],
    ),
    (
        "M45 · 734 F-2 · namesakes · the middle says its place of ALL of them — killed by `two-conversations-of-one-agent-told-apart.test.ts`",
        [(PERSONS_QUEUE, "`number ${rank}`} of ${count}.`", "`number ${rank}`} of ${others}.`")],
    ),
    (
        "M46 · 734 F-2 · namesakes · namesakes over the queue's rows — killed by `two-conversations-of-one-agent-told-apart.dom.test.ts`",
        [(PERSONSQUEUE, "const namesakes = computed(() => namesakesIn(rows.value))\n", "const namesakes = computed(() => namesakesIn([]))\n")],
    ),
    (
        "M47 · 734 F-2 · namesakes · the line says namesakeSays — killed by `two-conversations-of-one-agent-told-apart.dom.test.ts`",
        [(PERSONSQUEUE, "            {{ namesakeSays(namesakes.get(row.key)!) }}\n", "            {{ row.sentence }}\n")],
    ),
    (
        "M48 · 734 F-2 · namesakes · the line is painted — killed by `two-conversations-of-one-agent-told-apart.dom.test.ts`",
        [(PERSONSQUEUE, ".pq-namesake {\n  color: var(--muted);\n", ".pq-namesake {\n  visibility: hidden;\n  color: var(--muted);\n")],
    ),
    (
        "M49 · 734 F-2 · namesakes · the line is drawn whole — killed by `two-conversations-of-one-agent-told-apart.dom.test.ts`",
        [(PERSONSQUEUE, ".pq-namesake {\n  color: var(--muted);\n", ".pq-namesake {\n  overflow: hidden;\n  max-width: 160px;\n  white-space: nowrap;\n  color: var(--muted);\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row guards namesakes computed over
        # the whole look and not a project band's subset. D-016a removed 'the project rooms, board,
        # sheet and picker', and ProjectWorkspace.vue is deleted. The killer's own header now says
        # 'the project band that drew them too is gone'. PersonsQueue.vue has only the whole look
        # (`namesakesIn(rows.value)`), and M46 already covers that surface. Its anchor is left
        # stale, so the census records it retired.
        "M50 · 734 F-2 · namesakes · namesakes over the WHOLE look, not the band — killed by `two-conversations-of-one-agent-told-apart.dom.test.ts`",
        [(PROJECTWORKSPACE, "const namesakes = computed(() => namesakesIn(persons.view.value?.rows ?? []))\n", "const namesakes = computed(() => namesakesIn(decisions.value))\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** It hides the namesake line drawn by
        # ProjectWorkspace's band, a surface D-016a deleted ('the project rooms, board, sheet and
        # picker' are removed). The surviving surface, PersonsQueue's `pq-namesake` line, is planted
        # by M46, M47, M48 and M49. Re-anchoring would only duplicate a live row. Its anchor is left
        # stale, so the census records it retired.
        "M51 · 734 F-2 · namesakes · the band draws the line — killed by `two-conversations-of-one-agent-told-apart.dom.test.ts`",
        [(PROJECTWORKSPACE, "                v-if=\"namesakes.has(row.key)\"\n                class=\"decision-namesake\"\n", "                v-if=\"false\"\n                class=\"decision-namesake\"\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** It swaps `namesakeSays` for
        # `row.sentence` on the project band's line in ProjectWorkspace.vue, deleted with the
        # project rooms in D-016a. PersonsQueue.vue's identical
        # `namesakeSays(namesakes.get(row.key)!)` line is planted by M47, so nothing is left to
        # re-anchor. Its anchor is left stale, so the census records it retired.
        "M52 · 734 F-2 · namesakes · the line says namesakeSays — killed by `two-conversations-of-one-agent-told-apart.dom.test.ts`",
        [(PROJECTWORKSPACE, "                {{ namesakeSays(namesakes.get(row.key)!) }}\n", "                {{ row.sentence }}\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** It plants a clipped
        # `.decision-namesake` box, a CSS class that lived only in the deleted ProjectWorkspace.vue.
        # The PersonsQueue `.pq-namesake` box has its own row, M49 (drawn whole, `overflow: hidden;
        # max-width: 160px`). The band it protected went with D-016a. Its anchor is left stale, so
        # the census records it retired.
        "M53 · 734 F-2 · namesakes · the line is drawn whole — killed by `two-conversations-of-one-agent-told-apart.dom.test.ts`",
        [(PROJECTWORKSPACE, ".decision-namesake {\n  margin: 0;\n", ".decision-namesake {\n  margin: 0;\n  overflow: hidden;\n  max-width: 160px;\n  white-space: nowrap;\n")],
    ),
    # ── 730 F-3 — the Stop in R43's words ─────────────────────────────────────────────────────────────────
    (
        "M54 · 730 F-3 · frozen Stop title back to main's claim — killed by `the-stop-says-it-asks.render.test.ts`",
        [(PROMPTCOMPOSER, "? `Stop instead of answering — ${A_STOP_ASKS_THE_TURN} (Esc)`", "? 'Stop the turn instead of answering (Esc)'")],
    ),
    (
        "M55 · 730 F-3 · busy Stop title back to main's claim — killed by `the-stop-says-it-asks.render.test.ts`",
        [(PROMPTCOMPOSER, ": `Stop — ${A_STOP_ASKS_THE_TURN} (Esc)`", ": 'Interrupt the running turn (Esc)'")],
    ),
    (
        "M56 · 730 F-3 · busy Stop title spelled as a literal (same bytes, second spelling) — killed by `the-stop-says-it-asks.render.test.ts`",
        [(PROMPTCOMPOSER, ": `Stop — ${A_STOP_ASKS_THE_TURN} (Esc)`", ": 'Stop — the turn is asked to stop (Esc)'")],
    ),
    (
        "M57 · 730 F-3 · frozen foot Esc clause back to 'stops the turn' — killed by `the-stop-says-it-asks.render.test.ts`",
        [(PROMPTCOMPOSER, ">, but <strong>Esc</strong> is Stop: {{ A_STOP_ASKS_THE_TURN }}</template", ">, but <strong>Esc</strong> stops the turn</template")],
    ),
    (
        "M58 · 730 F-3 · frozen foot clause spelled as a literal (same bytes) — killed by `the-stop-says-it-asks.render.test.ts`",
        [(PROMPTCOMPOSER, ">, but <strong>Esc</strong> is Stop: {{ A_STOP_ASKS_THE_TURN }}</template", ">, but <strong>Esc</strong> is Stop: the turn is asked to stop</template")],
    ),
    (
        "M59 · 730 F-3 · busy foot Esc clause back to 'interrupt the turn' — killed by `the-stop-says-it-asks.render.test.ts`",
        # ⚑ **T-003 · re-anchored in place, not retired** — D-010 joined the foot's lines; the row still puts back *interrupt the turn*. Re-verified RED alone.
        [(PROMPTCOMPOSER, "          {{ who }} is working — type to queue a message. <strong>Esc</strong> is Stop:\n          {{ A_STOP_ASKS_THE_TURN }}.\n", "          {{ who }} is working — type to queue a message, or press <strong>Esc</strong> to interrupt the turn.\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The row's defect is now the decision.
        # M60 planted 'busy foot drops the queueTaken gate (offers to queue while one waits)'. D-010
        # deleted `queueTaken` and made the busy foot offer to queue unconditionally. Its anchor is
        # left stale, so the census records it retired (`anchor-absent`).
        "M60 · 730 F-3 · busy foot drops the queueTaken gate (offers to queue while one waits) — killed by `the-stop-says-it-asks.render.test.ts`",
        [(PROMPTCOMPOSER, "{{ who }} is working<template v-if=\"!queueTaken\"> — type to queue a message</template>.", "{{ who }} is working — type to queue a message.")],
    ),
    (
        # ⚑ **T-003 · re-anchored in place, not retired** (T-003's review) — D-010 deleted the
        # `queueTaken` gate and made the queue offer unconditional. The inverted gate hid the offer
        # while nothing waits, the opposite of D-010's decision, so the row now drops the offer from
        # the busy foot, which is that same defect. Re-verified RED alone.
        "M61 · 730 F-3 · busy foot queueTaken gate inverted — killed by `the-stop-says-it-asks.render.test.ts`",
        [(PROMPTCOMPOSER, "          {{ who }} is working — type to queue a message. <strong>Esc</strong> is Stop:\n", "          {{ who }} is working. <strong>Esc</strong> is Stop:\n")],
    ),
    (
        "M62 · 730 F-3 · hop: PromptComposer no longer imports the clause — killed by `the-stop-says-it-asks.render.test.ts`",
        [(PROMPTCOMPOSER, "import { A_STOP_ASKS_THE_TURN } from '../lib/stop-unanswered'\n", "")],
    ),
    (
        "M63 · 730 F-3 · sweep: the approval title says 'interrupt it' again — killed by `the-stop-says-it-asks.render.test.ts`",
        # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · d21b3125 removed SessionControls.vue; the approval sentence for a pending mode is now built in useConversationControls.ts. The plant still adds the old 'interrupt it' clause. The row's file moves to useConversationControls.ts.
        [("apps/desktop/src/renderer/src/composables/useConversationControls.ts", "        'that is already running.'", "        'that is already running. To stop this one now, interrupt it.'")],
    ),
    (
        "M64 · 730 F-3 · 737 review · the approval title tells a person to press a Stop a pending mode may not have — killed by `the-stop-says-it-asks.render.test.ts`",
        # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · d21b3125 removed SessionControls.vue; the approval sentence for a pending mode is now built in useConversationControls.ts. The plant still tells a person to press a Stop a pending mode may not have. The row's file moves to useConversationControls.ts.
        [("apps/desktop/src/renderer/src/composables/useConversationControls.ts", "        'that is already running.'", "        'that is already running. For this one, press Stop: the turn is asked to stop.'")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The row's defect is now the decision.
        # M65 planted 'the placeholder offers to queue while a message already waits' by forcing the
        # `queueTaken ? `${who} is working…`` arm off. D-010 deleted that ternary. Its anchor is
        # left stale, so the census records it retired (`anchor-absent`).
        "M65 · 730 F-3 · 737 review · the placeholder offers to queue while a message already waits — killed by `the-stop-says-it-asks.render.test.ts`",
        [(PROMPTCOMPOSER, "                  queueTaken\n                  ? `${who} is working…`\n", "                  false\n                  ? `${who} is working…`\n")],
    ),
    (
        "M66 · 730 F-3 · the clause claims the turn is stopped — killed by `the-stop-says-it-asks.render.test.ts`",
        [(STOP_UNANSWERED, "export const A_STOP_ASKS_THE_TURN = `the turn is ${ASKED_TO_STOP}`", "export const A_STOP_ASKS_THE_TURN = `the turn is stopped`")],
    ),
    (
        "M67 · 730 F-3 · the clause retyped instead of composed from ASKED_TO_STOP (same bytes) — killed by `the-stop-says-it-asks.render.test.ts`",
        [(STOP_UNANSWERED, "export const A_STOP_ASKS_THE_TURN = `the turn is ${ASKED_TO_STOP}`", "export const A_STOP_ASKS_THE_TURN = 'the turn is asked to stop'")],
    ),
    # ── 728 — an MCP server's form, as its CLI draws it ──────────────────────────────────────────────────
    (
        "M68 · 728 · the chip's server arm never taken (a server card falls through to `item.request.kind` = command) — killed by `a-servers-form-drawn-as-its-cli-draws-it.render.test.ts`",
        [(PERMISSIONCARD, "<span v-if=\"serversAsk\" class=\"kind\">{{ MCP_SERVER_KIND }}</span>", "<span v-if=\"false\" class=\"kind\">{{ MCP_SERVER_KIND }}</span>")],
    ),
    (
        "M69 · 728 · the chip keyed on Codex's marker instead of the server's — killed by `a-servers-form-drawn-as-its-cli-draws-it.render.test.ts`",
        [(PERMISSIONCARD, "<span v-if=\"serversAsk\" class=\"kind\">", "<span v-if=\"mcpCall\" class=\"kind\">")],
    ),
    (
        "M70 · 728 · the Allow arm dropped (a server card says Approve again) — killed by `a-servers-form-drawn-as-its-cli-draws-it.render.test.ts`",
        [(PERMISSIONCARD, "  if (outcome === 'allow' && serversAsk.value !== undefined) return ALLOW\n", "")],
    ),
    (
        "M71 · 728 · the Allow arm widened to every card (the marker condition removed) — killed by `a-servers-form-drawn-as-its-cli-draws-it.render.test.ts`",
        [(PERMISSIONCARD, "  if (outcome === 'allow' && serversAsk.value !== undefined) return ALLOW\n", "  if (outcome === 'allow') return ALLOW\n")],
    ),
    (
        "M72 · 728 · serversAsk reads no request (the computed is always undefined) — killed by `a-servers-form-drawn-as-its-cli-draws-it.render.test.ts`",
        [(PERMISSIONCARD, "const serversAsk = computed(() => serversAskOf(props.item.request))", "const serversAsk = computed(() => serversAskOf({}))")],
    ),
    (
        "M73 · 728 · the chip draws the wire's kind, not the constant (DOM photograph mount) — killed by `a-servers-form-drawn-as-its-cli-draws-it.dom.test.ts`",
        [(PERMISSIONCARD, "class=\"kind\">{{ MCP_SERVER_KIND }}</span>", "class=\"kind\">{{ item.request.kind }}</span>")],
    ),
    (
        "M74 · 728 · the chip's word — killed by `a-servers-form-drawn-as-its-cli-draws-it.render.test.ts`",
        [(PERMISSION_OFFER, "export const MCP_SERVER_KIND = 'MCP server'", "export const MCP_SERVER_KIND = 'MCP Server'")],
    ),
    (
        "M75 · 728 · the CLI's word on Allow — killed by `a-servers-form-drawn-as-its-cli-draws-it.render.test.ts`",
        [(PERMISSION_OFFER, "export const ALLOW = 'Allow'\n", "export const ALLOW = 'Approve'\n")],
    ),
    (
        "M76 · 728 · Home stops reading the shared ALLOW (the three surfaces split again) — killed by `a-servers-form-drawn-as-its-cli-draws-it.render.test.ts`",
        [(ATTENTION, "  allow: ALLOW,\n", "  allow: 'Approve',\n")],
    ),
    # ── the review of the table — a note that was wrong ─────────────────────────────────────────────────
    (
        "M77 · 735 §3 · the start's events are not held by a hand-over bracket, so the window asks the host about the conversation it is being handed — killed by `a-conversation-a-quit-left-open-starts-on-its-first-message.test.ts`",
        [(SESSION_STORE, "      starting.handover += 1\n", "      starting.handover += 0\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The subject is deleted. This row
        # pinned the kept-open pane's sentence for a first message that went to a conversation that
        # ended in the air (`IT_TOOK_THE_MESSAGE_AND_ENDED`). D-017b removed that pane and "every
        # sentence saying whether a process runs", so the export has no reference left in
        # `apps/desktop/src`. The host's replacement wording (`Your message did not go in: …`) is a
        # different rule with no process facts. Its anchor is left stale, so the census records it
        # retired.
        "M78 · 737 review · a first message that went to a conversation that ended in the air says nothing — killed by `a-conversation-a-quit-left-open-starts-on-its-first-message.test.ts`",
        [(KEPT_OPEN, "    return came.openHere ? null : `${IT_TOOK_THE_MESSAGE_AND_ENDED} ${IT_IS_NO_LONGER_WAITING}.`\n", "    return null\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The subject is deleted. The stale
        # "running now" sentence for a kept start that ended before it opened here belonged to
        # `whatTheFirstMessagePaneSays` in `kept-open.ts`. That file was deleted by D-017b together
        # with every sentence about whether a process runs. The host's `running` field is now only
        # the hand-over record, never a process claim drawn to the person. Its anchor is left stale,
        # so the census records it retired.
        "M79 · 737 review · a kept start that ended before it opened here says the host's stale *running now* — killed by `a-conversation-a-quit-left-open-starts-on-its-first-message.test.ts`",
        [(KEPT_OPEN, "  if (refusal.running !== null) {\n", "  if (false) {\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The subject is deleted.
        # `ITS_START_WAS_NOT_UNDONE` and its second-sentence-beside-the-moved-line logic lived in
        # the kept-open window words, which D-017b removed. The host still undoes a start that no
        # message reached (`undoAStartNoMessageReached`) but no longer says it to the person. Its
        # anchor is left stale, so the census records it retired.
        "M80 · 737 review · a start not undone says ITS_START_WAS_NOT_UNDONE beside the moved line, two sentences for one fact — killed by `a-conversation-a-quit-left-open-starts-on-its-first-message.test.ts`",
        [(KEPT_OPEN, "  if (!refusal.stillWaiting)", "  if (false)")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The subject is deleted.
        # `TOO_LATE_TO_CANCEL` and `aLateCancelSays` were in `kept-open.ts`, deleted by D-017b, so
        # there is no late-Cancel sentence to be silent about. Cancel is now `stopIt`: `if
        # (store.isLaunching(sessionId)) void store.cancelLaunch(sessionId) else void
        # store.interrupt(sessionId)`, and it says nothing either way. Its anchor is left stale, so
        # the census records it retired.
        "M81 · 737 review · a Cancel that reached no start to stop says nothing — killed by `a-conversation-a-quit-left-open-starts-on-its-first-message.test.ts`",
        [(KEPT_OPEN, "  return stopped || !stillInTheAir ? null : TOO_LATE_TO_CANCEL\n", "  return null\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The subject is deleted. The screen
        # dropping what a late Cancel says refers to `aLateCancelSays` and `TOO_LATE_TO_CANCEL`,
        # which were deleted with `kept-open.ts` and the kept-open pane. `stopIt` has no late-cancel
        # answer to keep or drop. Its anchor is left stale, so the census records it retired.
        "M82 · 737 review · the screen drops what a late Cancel says — killed by `a-conversation-a-quit-left-open-starts-on-its-first-message.test.ts`",
        [(RUNTIMESCREEN, "  if (said !== null && keptOpen.value?.info.sessionId === sessionId) keptOpenFailure.value = said\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The subject is deleted. This row
        # pinned the pane's own lines ("starts it", or the move again) beside a failure that says
        # the conversation moved. The pane is `KeptOpenPane.vue`, deleted by D-017b along with the
        # reading-only pane and the Reopen / Take it over / Read the recording presses, now one
        # press. Its DOM killer `what-a-quit-left-open-on-screen.dom.test.ts` no longer describes a
        # surface that exists. Its anchor is left stale, so the census records it retired.
        "M83 · 737 review · the pane's own lines say *starts it* or the move again beside a failure that says it moved — killed by `what-a-quit-left-open-on-screen.dom.test.ts`",
        [(KEPTOPENPANE, "    <template v-if=\"!theFailureSaysItMoved\">\n", "    <template v-if=\"true\">\n")],
    ),
    (
        "M84 · 737 review · an ask about another session adopts a conversation this window is being handed — killed by `session-store.test.ts`",
        [(SESSION_STORE, "      if ((sessions.get(session.sessionId)?.handover ?? 0) > 0) continue\n", "")],
    ),
    (
        "M85 · 737 review · a server's card answered Allow reads back *Approved* — killed by `a-servers-form-drawn-as-its-cli-draws-it.render.test.ts`",
        [(PERMISSIONCARD, "  if (outcome === 'allow' && serversAsk.value !== undefined) return 'Allowed'\n", "")],
    ),
    (
        "M86 · 734 F-2 · namesakes · the first says *first of N* instead of *first* — killed by `two-conversations-of-one-agent-told-apart.test.ts`",
        [(PERSONS_QUEUE, "  if (rank === 1) return `${lead}; this conversation reached you first.`\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The subject is deleted. This row
        # pinned the kept-open header and the End button following only a failure that says the
        # conversation moved. D-017b removed the End conversation button and the
        # open/closed/kept-open split with the reduced pane, so there is no such header or End to
        # follow a failure. Its anchor is left stale, so the census records it retired.
        "M87 · 737 review · the header and End follow ANY failure, not one that says the conversation moved — killed by `what-a-quit-left-open-on-screen.dom.test.ts`",
        [(KEPTOPENPANE, "const itMoved = computed(() => props.moved === true || theFailureSaysItMoved.value)\n", "const itMoved = computed(() => props.moved === true || props.failure !== null)\n")],
    ),
]
