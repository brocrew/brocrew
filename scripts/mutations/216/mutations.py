#!/usr/bin/env python3
"""216's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **`215` measured that "attachment" is FOUR mechanisms and the person chose the third**: a path the
AGENT reads with its own tools, not bytes BroBot reads and encodes. Every row below defends some
part of that choice — because the choice is what makes this small, and a later "improvement" that
loaded the bytes in main would silently acquire `215` §3.3's authority with nothing to notice.

The rows fall into five groups:

  * `M1`-`M6`   §3 · classifying a chosen path — exists, what it is, and where it is.
  * `M7`-`M11`  §1/§2 · what actually reaches the provider, and what reaches the LEDGER.
  * `M12`-`M16` §2 · the composer control, the visible injection, and the undo.
  * `M17`-`M20` §2 · the three send paths and the queue, so nothing is silently dropped.
  * `M21`-`M24` ⛔ **the four rows this dispatch's own edits made stale** — see below.
  * `M25`-`M30` replay, the two books, the renderer store, and the live step's verdict shape.
  * `M31`-`M41` ⛔ **the first review's findings**, each turned into a rule with a row.
  * `M42`-`M57` ⛔ **the SECOND review's findings** — the defects the first round of fixes
    carried in with it, including the composer grid break that `visible()` cannot see.

## ⛔ Four rows RETIRED by this dispatch, and what replaced each one

`mutations:check` reported four stale anchors, all of them lines 216 moved rather than rules 216
changed. ⚠️ **A stale row protects nothing, so retiring one silently is how coverage disappears.**

  | retired | it protected | replaced by |
  |---|---|---|
  | `149` M16 | the queued FLUSH asks whether the session can take a turn | `M21` |
  | `149` M17 | the interrupt's SECOND check — `148` M1's TOCTOU          | `M22` |
  | `203` M10 | the IPC door names the CALLER on `send`                   | `M23` |
  | `203` M30 | ordinary `send` asks whether the session can take a turn  | `M24` |

⚑ **All four rules are unchanged and still enforced** — only their anchors moved, because a
`recheckHandedPaths` line now sits between the assert and the send.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

  * ⛔ **The native PICKER.** `app:choose-attachment` opens an OS dialog in the main process and no
    instrument here — unit, dom or live — can click one. What IS reachable is everything on both
    sides of it: `classifyHandedPath` decides the answer, and `dom/attach-path.dom.test.ts` drives
    the composer against a stubbed bridge including the cancel and refusal branches.
  * ⛔ **Whether the AGENT actually reads what was handed over.** `215` §4 and the dispatch both say
    that is existing provider behaviour and explicitly not this dispatch — *"do not make the agent
    read it, do not pre-read it to be helpful."* The live smoke asserts the loop end to end with one
    cheap turn; no unit test can, and none pretends to.
  * ⛔ **That BroBot never reads the bytes.** ⚠️ **This is unkillable by construction and that is the
    whole point**: "it did not read the file" has no observable consequence, so no mutation can make
    a behavioural test go red for it. `no-byte-authority.test.ts` is a SOURCE census for exactly
    that reason (`206` H1's argument, `214` `M8`'s lesson) — `M11` kills the census's own teeth, and
    nothing can kill the absence itself.
  * ⛔ **A path with a `)` in it, and other shapes the message's markdown-ish block renders oddly.**
    The block is plain text by measurement (§1), not markdown we parse, so nothing here reads it
    back — the model does. Untested because untestable from this side.
  * ⛔ **Multi-select, drag-and-drop, and inline bytes.** Out of scope per §5; no row touches them.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. These were taken after `format` ran.

⛔ **Do not apply these by hand** — `mutate.sh` owns the tree, takes 196's repository-global lock,
and restores from a pristine copy keyed by FULL relative path.


⚠️ **`413` CORRECTED `M51`'s ANCHOR IN PLACE, and the recorded RED was measured against the OLD
text.** ⛔ The queued push gained a line — the held message's own `messageId`, so an ending settles
the row it NAMES rather than the last unresolved one (`394` made a session able to hold two, and
`406` reported the gap). The row's defect and its kill are unchanged: the paths stop being pushed.
⚑ The corrected row was applied alone and watched go red before this note was written; re-running
the table is the only thing that makes the artefact's verdict current.

⛔ **MEASURED while doing it (413): it is the LABEL that tells the census, not the anchor.** With
the anchor corrected and the label left alone, this table came back **`complete`** — the run state
is computed from a definition fingerprint that covers the label and not the old text, so a
corrected anchor silently keeps a verdict measured against text that no longer exists. ⚑ The
`⚑ ANCHOR CORRECTED IN PLACE BY 413` suffix is what moves this table to `partial-or-invalid`, and
that is the honest state: the artefact was produced against a definition this file no longer has.
⚠️ **The cost is per TABLE and not per row** — every other row here is downgraded with it, which is
a fact about the instrument rather than about those rows.
"""

from __future__ import annotations

import sys

HANDED = "apps/desktop/src/main/runtime/handed-path.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
COMPOSER = "apps/desktop/src/renderer/src/components/PromptComposer.vue"
BUBBLE = "apps/desktop/src/renderer/src/components/UserMessage.vue"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
DRAFTS = "apps/desktop/src/renderer/src/lib/drafts.ts"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
RENDERER_STORE = "apps/desktop/src/renderer/src/lib/session-store.ts"
SMOKE = "scripts/ui-live-smoke.mjs"
QUEUED = "apps/desktop/src/renderer/src/components/QueuedMessage.vue"
CENSUS = "apps/desktop/test/no-byte-authority.test.ts"

# ⚑ **708 · anchors corrected in place, not retired** (standing rule 27): `R42` handed every turn
# gate a `from`, so each `assertCanTakeTurn(` call gained that key and most now span several
# lines; the rows below that named a gate call were re-spelled to it and each re-verified RED
# alone, with its killer named in 708's response.
MUTATIONS = [
    # ------------------------------------------------- §3 · classifying a chosen path
    (
        "M1  · ⛔ THE DEFECT · a path that does not exist is accepted at the picker, so the refusal "
        "arrives after Send instead of before it (106, 118, 169)",
        # ⚑ Re-anchored by 232: the refusal carries `gone`, which is how `recheckHandedPaths`
        # tells a disappearance from a replacement it cannot compare. 232 re-runs it (M35).
        [(HANDED, "    return { refusal: `there is nothing at ${path}`, gone: true }\n  }\n  let stats", "    return { kind: 'file' }\n  }\n  let stats")],
    ),
    (
        "M2  · ⚠️ §3 · a dangling symlink says the FILE is missing rather than that the shortcut is "
        "broken — two different fixes, one sentence",
        # ⚑ Re-anchored by 232 §3: the classifier does no synchronous filesystem work any more, so
        # `lstatSync` is `await lstat`. The RULE is untouched. 232's table re-runs it (M22).
        [(HANDED, "      if ((await lstat(path)).isSymbolicLink()) {", "      if (false) {")],
    ),
    (
        "M3  · ⛔ §3 · a socket, fifo or device is handed over as a file, spending a turn to learn "
        "the agent cannot read it",
        [(HANDED, "  if (!stats.isFile()) {", "  if (false) {")],
    ),
    (
        "M4  · ⛔ §3 · a folder is reported as a file, so the agent reaches for the wrong tool",
        # ⚑ Re-anchored by 221 §5: `describeKind` now hands back the REAL path beside the kind, so
        # the same defect is spelled one field wider. 221's own table re-runs it (M23).
        [(HANDED, "  if (stats.isDirectory()) return { kind: 'directory', real }\n", "")],
    ),
    (
        "M5  · 🔒 §3 · a path OUTSIDE the working directory stops saying so, so the agent's own "
        "permission card is the first place anybody notices",
        # ⚑ Re-anchored by 234 §4: `startsWith('..')` was a SUBSTRING test and `..prefix` is a legal
        # directory name, so the comparison is by path SEGMENT now (`227` LOW 1). The rule this row
        # is about — that containment is answered at all — is unchanged. 234's table re-runs it (M16).
        # ⚑ Re-anchored by 232 §3 (227 MEDIUM 1): the target is no longer real-resolved a SECOND time
        # here — `describeKind` resolved it once and that answer is passed in — so `there` is
        # `target`. The rule is the same rule. 232's table re-runs it (M24).
        [
            (
                HANDED,
                "  const step = relative(here, target)\n"
                "  if (step === '') return false\n"
                "  // Different roots — a UNC share, another drive — and there is no step from one to the other.\n"
                "  if (isAbsolute(step)) return true\n"
                "  return step === '..' || step.startsWith(`..${sep}`)",
                "  void relative(here, target)\n  return false",
            )
        ],
    ),
    (
        "M6  · ⚠️ §3 · an unknown working directory reads as INSIDE — a containment claim nothing "
        "backs (086)",
        [(HANDED, "  if (cwd.trim() === '') return true", "  if (cwd.trim() === '') return false")],
    ),
    # ------------------------------- §1/§2 · what reaches the provider, and what reaches the ledger
    (
        "M7  · 🔴 THE DEFECT, verbatim · the path never reaches the provider at all — measured at the "
        "pin, plain text is the ONLY form a model sees (216 §1)",
        [(HANDED, "  if (handed.length === 0) return text\n", "  if (true) return text\n")],
    ),
    (
        "M8  · ⛔ §2 · the path is silently CONCATENATED with no label, so the model and the reader "
        "cannot tell the person's words from BroBot's (214, from the other end)",
        [(HANDED, "const block = ['Attached by the user, for you to read with your own tools:', ...lines].join", "const block = [...lines].join")],
    ),
    (
        "M9  · 🔒 §3 · the message stops saying a path is outside the working directory",
        [(HANDED, "    const where = each.outsideCwd ? ' (outside this conversation’s working directory)' : ''", "    const where = ''")],
    ),
    # ⚑ ANCHOR CORRECTED IN PLACE BY 657: `send` now BUILDS the `user_turn` row before the handover and publishes it
    # after (`650` F5), so the literal opens `const turn: UserTurnEvent = {` rather than a publish
    # call. The defect this row plants is unchanged; re-verified RED by hand against its killer.
    (
        "M10 · 🔴 214's DEFECT FROM THE OTHER END · the composed text is stored as the person's turn, "
        "so the transcript renders BroBot's sentence as something they typed",
        [(HOST, "    const turn: UserTurnEvent = {\n      type: 'user_turn',\n      text,\n      // Spread rather than assigned", "    const turn: UserTurnEvent = {\n      type: 'user_turn',\n      text: messageWithHandedPaths(text, handed.paths),\n      // Spread rather than assigned")],
    ),
    (
        "M11 · ⛔ the no-byte-authority census loses its teeth, so a later change can load the bytes "
        "in main and acquire 215 §3.3's authority with nothing to notice",
        [("apps/desktop/test/no-byte-authority.test.ts", "    .filter(({ line }) => READS_BYTES.some((api) => line.includes(api)))", "    .filter(() => false)")],
    ),
    # ------------------------------------------------- §2 · the composer, the injection, the undo
    (
        "M12 · ⛔ THE CONTROL 213 WENT LOOKING FOR is gone from the composer",
        [(COMPOSER, '          data-cy="attach-path"\n', '          data-cy="attach-path-gone"\n')],
    ),
    (
        "M13 · 🔴 §2 · what was attached is NOT SHOWN — the person's rule broken at the composer: an "
        "injection the UI does not display",
        [(COMPOSER, # ⚑ Re-anchored at 236 §4/§5: the staged list moved behind `staged` / `commitStaged`.
                # The defect is unchanged and this row is re-run in `scripts/mutations/236`.
                '      <ul v-if="staged.length > 0" class="attached" data-cy="composer-attachments">', '      <ul v-if="false" class="attached" data-cy="composer-attachments">')],
    ),
    (
        "M14 · 🔴 §2 · attaching stops being UNDOABLE before send (211: a half-formed attachment is "
        "the same defect as a half-formed draft)",
        [(COMPOSER, # ⚑ Re-anchored at 236 §4/§5: the staged list moved behind `staged` / `commitStaged`.
                # The defect is unchanged and this row is re-run in `scripts/mutations/236`.
                "  commitStaged(staged.value.filter((each) => each.path !== path))", "  void path")],
    ),
    (
        "M15 · ⛔ §2 · the attachments outlive their send and ride along on the NEXT message, "
        "silently, because the chip looks the same",
        [(COMPOSER, # ⚑ Re-anchored at 236 §4/§5: the staged list moved behind `staged` / `commitStaged`.
                # The defect is unchanged and this row is re-run in `scripts/mutations/236`.
                "  if (staged.value.length > 0) commitStaged([])", "  void props.attachments")],
    ),
    (
        "M16 · 🔴 214's DEFECT FROM THE OTHER END, in the transcript · the attachment is rendered "
        "INSIDE the person's own message body",
        [(BUBBLE, '      <ul v-if="item.attachments?.length" class="attached" data-cy="user-attachments">', '      <ul v-if="false" class="attached" data-cy="user-attachments">')],
    ),
    # --------------------------------------- §2 · every send path, so nothing is silently dropped
    (
        "M17 · ⛔ §2 · a message QUEUED behind a running turn sends its words and silently drops its "
        "attachments — the chip vanishing as if it had gone (215 §3.2's hazard, narrowly)",
        [(HOST, "      await session.handle.send(messageWithHandedPaths(queued.text, handed.paths))", "      await session.handle.send(queued.text)")],
    ),
    (
        "M18 · ⛔ §2 · the flushed turn is RECORDED without its attachments, so a replayed "
        "conversation loses what was handed over",
        [
            (
                HOST,
                # ⚑ **W4.493 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. Preserve the original defect, ID and killer at the formatted keyed-handoff boundary. No plant or table run. Held: running it needs W4 written lift.
                "        // was actually told. `handed.paths` is what went on the wire, and is the only honest source.\n        ...(handed.paths.length > 0 ? { attachments: handed.paths } : {}),",
                "        // was actually told. `handed.paths` is what went on the wire, and is the only honest source.",
            )
        ],
    ),
    (
        "M19 · ⛔ §2 · the interrupting send drops them, so redirecting an agent loses the file you "
        "were redirecting it to",
        [(HOST, "    await session.handle.send(messageWithHandedPaths(text, handed.paths))\n    // ⚠️ **Was missing", "    await session.handle.send(text)\n    // ⚠️ **Was missing")],
    ),
    (
        "M20 · ⛔ §3 · the SEND stops re-checking, so a path that vanished between choosing and "
        "sending is handed to the agent anyway",
        # ⚑ Re-anchored by 232 §3: `recheckHandedPaths` is awaited (231 — nothing on this route may
        # block the main process). 232's table re-runs it (M6).
        # ⚑ Re-anchored again by 234 §3: the gate took the content rule (`228` L1) and every call
        # site now hands over its content. 234's table re-runs it (M12).
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The unified sendAs (send,
        # queueAs's idle branch and others all delegate here now) still asks
        # assertCanTakeTurn('send', ...) and then re-checks attachments with recheckHandedPaths
        # before handing to the provider; D-017 wrapped both in a try/catch for the R1 'stop under
        # the handover, start again' race, which is why the literal text no longer matches. The
        # defect ('re-check dropped, handed passed through unchecked') still plants cleanly on the
        # reshaped code.
        [
            (HOST, '      handed = await recheckHandedPaths(attachments, session.cwd)', '      handed = { paths: [...attachments] }'),
        ],
    ),
    # --------------------------------- the four rows 216's own edits made stale, moved here intact
    (
        "M21 · ⛔ 149 M16, moved · the queued FLUSH stops asking whether the session can take a turn "
        "— the turn nobody pressed anything for",
        # ⚑ Re-anchored by 234: the gate takes content now (§3) and §1's ownership check sits between
        # it and the send, so the anchor is the CALL alone. 234's table re-runs it (M13).
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — D-027 made runFlush ask the turn gate once for the whole turn it takes (joined text,
        # summed attachments, `from` null for several), so the old single-message call text is gone.
        # The rule survives: the turn nobody pressed anything for still passes assertCanTakeTurn, so
        # a message queued before the machine sign-in moved is not delivered on the old sign-in. The
        # plant deletes that call (the unused `const [only]` left behind is harmless); a flush that
        # never calls the gate never looks at the sign-in. Killed by `sign-in-supersede.test.ts`,
        # `a-task-row-that-lies-about-its-holder.test.ts`.
        [
            (HOST, "      await this.assertCanTakeTurn(session, 'send', {\n        text: going.map(({ queued }) => queued.text).join('\\n\\n'),\n        attached: going.reduce((all, { handed }) => all + handed.paths.length, 0),\n        from: going.length === 1 && only !== undefined ? (only.queued.origin ?? null) : null,\n      })\n", ''),
        ],
    ),
    (
        "M22 · ⛔ 149 M17, moved · the interrupt's SECOND check is removed — THE 148 M1 TOCTOU",
        # ⚑ Re-anchored by 234 §3, same reason as M20. 234's table re-runs it (M14).
        [
            (
                HOST,
            # ⚑ **713 · corrected in place** (standing rule 27): the second gate is handed the first
            # gate's answer (`decided`, `708` H-4), so its call gained a key. Same rule, same
            # replacement; re-verified RED alone, killer named in 713's response.
            # ⚑ Re-anchored in place, not retired — the second gate now sits in a `try` that holds a
            # person's words for the reopen when the sign-in moved meanwhile; the plant removes the
            # gate and its catch together, which is the same defect.
                "    try {\n      await this.assertCanTakeTurn(session, 'send', {\n        text,\n        attached: attachments.length,\n        from: this.originOf(by),\n        decided,\n      })\n    } catch (error) {\n      // ⚑ …and one that moved while the stop waited holds them the same way.\n      if (!aPersonIsAsking(by) || !this.aReopenCarriesIt(error, by, session)) throw error\n      await this.queueAs(\n        session.id,\n        text,\n        by,\n        attachments,\n        'work',\n        {},\n        WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS,\n        'after-a-lost-race',\n      )\n      return\n    }\n    // ⚠️ Asked a second time",
                "    // ⚠️ Asked a second time",
            )
        ],
    ),
    (
        "M23 · ⛔ 203 M10, moved · the IPC door stops naming the CALLER on `send` — the shape of the "
        "whole 203 defect, one verb at a time",
        [(IPC, "      return await host.send(command.sessionId, command.text, sink, command.attachments)", "      return await host.send(command.sessionId, command.text, undefined as never, command.attachments)")],
    ),
    (
        "M24 · ⛔ 203 M30, moved · ordinary `send` stops asking whether the session can take a turn",
        # ⚑ Re-anchored by 232 §3, same reason as M20. 232's table re-runs it (M9).
        # ⚑ Re-anchored again by 234 §3, same reason again. 234's table re-runs it (M15).
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Same sendAs location:
        # removing just the assertCanTakeTurn('send', ...) call (keeping the path recheck) still
        # plants 'ordinary send stops asking whether the session can take a turn' — it skips the
        # content and sign-in checks. Only the try/catch wrapper D-017 added changed the literal
        # text; the rule and the call sequence are unchanged.
        [
            (HOST, "    try {\n      await this.assertCanTakeTurn(session, 'send', {\n        text,\n        attached: attachments.length,\n        from: this.originOf(by),\n      })\n      handed = await recheckHandedPaths(attachments, session.cwd)\n    } catch (error) {", '    try {\n      handed = await recheckHandedPaths(attachments, session.cwd)\n    } catch (error) {'),
        ],
    ),
    # ------------------------------------------------------------------ replay, and the two books
    (
        "M25 · ⛔ 215 §3.5's bound · a replayed turn's attachments are unbounded, so a ledger row "
        "from a later build hands the renderer whatever it holds",
        [
            (
                STORE,
                "    (event.type === 'user_turn' ||\n"
                "      event.type === 'message_queued' ||\n"
                "      event.type === 'message_unqueued') &&\n"
                "    event.attachments !== undefined",
                "    false",
            )
        ],
    ),
    (
        "M26 · ⚠️ §2 · the transcript drops the attachment on the way to the bubble, so a replayed "
        "conversation shows the words and not what went with them",
        [(TRANSCRIPT, "      appendUserMessage(state, event.text, event.attribution, event.attachments)", "      appendUserMessage(state, event.text, event.attribution)")],
    ),
    (
        "M27 · 🔴 019's BUG WITH A FILENAME ON IT · the attachment book stops being pruned with the "
        "drafts, so a closed conversation's paths outlive it (moved into `drafts.ts` — see the "
        "docstring: the two books became one because the SCREEN version was unkillable)",
        [(DRAFTS, "      paths.keepOnly(keep)\n", "")],
    ),
    (
        "M28 · ⛔ §2 · the book hands out its own array, so a caller that pushes mutates it behind "
        "its back and the reactive Map never sees the change",
        [(DRAFTS, "    read: (key) => [...(attached.get(key) ?? [])],", "    read: (key) => attached.get(key) ?? [],")],
    ),
    (
        "M29 · ⛔ §2 · the renderer store sends the words down one branch and the attachments down "
        "none, so a busy agent silently loses them",
        [(RENDERER_STORE, "        const input = {\n          sessionId,\n          text,\n          ...(attachments.length > 0 ? { attachments: [...attachments] } : {}),\n        }", "        const input = { sessionId, text }")],
    ),
    (
        "M30 · ⛔ 206 H1 · the live step writes its own verdict into a sentence instead of returning "
        "typed claims, so a run cannot tell asserted from merely printed",
        [
            (
                SMOKE,
                "    return claims(\n      asserted(\n        `1 · the attach control is painted in the composer",
                "    return (\n      `ASSERTED: ` +\n      (\n        `1 · the attach control is painted in the composer",
            )
        ],
    ),
    # ------------------------------------- the review's own findings, each now a rule with a row
    (
        "M31 · 🔴 review · a queued message whose file VANISHED goes back to the `catch` and sits "
        "there forever — no event, no error, nobody told",
        [
            (
                HOST,
                # ⚑ **Anchor corrected in place by `354` and again by `394`, not retired**
                # (142's rule). `354` gave the held message a name, so every `message_unqueued`
                # gained a `messageId` line inside the span this row reads; `394` made the slot a
                # MAILBOX, so nulling it became `takeQueued`. ⛔ **The DEFECT is unchanged**: the
                # bytes this row replaces are still *take the message out* becoming `return`.
                "      this.takeQueued(session, queued)\n"
                "      this.publishOurs(session, {\n"
                "        type: 'message_unqueued',\n"
                "        messageId: queued.id,\n"
                "        reason: 'abandoned',",
                "      return\n"
                "      this.publishOurs(session, {\n"
                "        type: 'message_unqueued',\n"
                "        messageId: queued.id,\n"
                "        reason: 'abandoned',",
            )
        ],
    ),
    (
        "M32 · ⛔ review · the ending drops its reason, so a message abandoned because its file went "
        "away is shown as one abandoned because the conversation ended — a transcript stating "
        "something that did not happen",
        [(HOST, "        detail: handed.refusal,\n", "")],
    ),
    (
        "M33 · 🔴 review · the interrupting send stops checking BEFORE it kills the running turn, so "
        "a vanished path destroys the thinking in flight and then refuses to send anything",
        [
            (
                HOST,
                # ⚑ Re-anchored by 232 §3: awaited (231). 232's table re-runs it (M7).
                "      const chosen = await recheckHandedPaths(attachments, session.cwd)\n"
                "      if ('refusal' in chosen) throw new Error(chosen.refusal)",
                "      const chosen = { paths: [...attachments] }\n      void chosen",
            )
        ],
    ),
    (
        "M34 · ⛔ review · the QUEUED event carries no paths, so the one window where attaching is "
        "still undoable is the one window that cannot show what was attached",
        [
            (
                HOST,
                # ⚑ **Anchor corrected in place by `354` and again by `394`, and NARROWED to the
                # comment-free half.** `354` put `messageId: id,` between `type` and `text`; `394`
                # put `kind,` and its docblock between those two. ⛔ **The bytes this row deletes
                # are still the attachments line**, and dropping `messageId` out of the span is what
                # stops the next line written above it from retiring this row again.
                "      kind,\n"
                "      text,\n"
                "      ...(handed.paths.length > 0 ? { attachments: handed.paths } : {}),",
                "      kind,\n      text,",
            )
        ],
    ),
    (
        "M35 · 🔴 review · the WAITING bubble hides its attachments — the person's rule broken at the one "
        "moment the injection has not happened yet",
        [
            (
                QUEUED,
                '      <ul v-if="item.attachments?.length" class="attached" data-cy="queued-attachments">',
                '      <ul v-if="false" class="attached" data-cy="queued-attachments">',
            )
        ],
    ),
    (
        "M36 · 🔴 review · `put it back in the composer` returns the words without the paths, so the "
        "restored draft looks whole and is not",
        [
            (
                QUEUED,
                "@click=\"emit('restore', item.text, item.attachments ?? [])\"",
                "@click=\"emit('restore', item.text)\"",
            )
        ],
    ),
    (
        "M37 · ⛔ review · the true reason is not preferred over the default wording, so a file that "
        "was deleted reads as a conversation that ended",
        [
            (
                QUEUED,
                '          <template v-else-if="item.detail">not sent · {{ item.detail }}</template>',
                '          <template v-else-if="false">not sent · {{ item.detail }}</template>',
            )
        ],
    ),
    (
        "M38 · ⛔ review · the import ALLOWLIST is blinded, so `import * as fs` on the route stops "
        "being caught — the `M11` shape again, on the second census",
        [
            (
                CENSUS,
                "  return fsBindings(path).filter((name) => !ALLOWED_FS_BINDINGS.includes(name))",
                "  return fsBindings(path).filter(() => false)",
            )
        ],
    ),
    (
        "M39 · 🔴 review · the replay bound SLICES before it filters, so a stored row that leads with "
        "malformed entries evicts every valid path from the window (the mutation the old fixture "
        "could not see, because it put the malformed entries last)",
        [
            (
                STORE,
                "      .filter(\n"
                "        (each): each is HandedPath =>\n"
                "          typeof each?.path === 'string' &&\n"
                "          each.path.length > 0 &&\n"
                "          each.path.length <= MAX_STORED_PATH_CHARS &&\n"
                "          (each.kind === 'file' || each.kind === 'directory'),\n"
                "      )\n"
                "      .slice(0, MAX_HANDED_PATHS)",
                "      .slice(0, MAX_HANDED_PATHS)\n"
                "      .filter(\n"
                "        (each): each is HandedPath =>\n"
                "          typeof each?.path === 'string' &&\n"
                "          each.path.length > 0 &&\n"
                "          each.path.length <= MAX_STORED_PATH_CHARS &&\n"
                "          (each.kind === 'file' || each.kind === 'directory'),\n"
                "      )",
            )
        ],
    ),
    (
        "M40 · ⛔ review · the replay bound covers the SENT turn only, leaving the two queue events "
        "unbounded — the gap exactly where the next event that carries paths would fall",
        [
            (
                STORE,
                "      event.type === 'message_queued' ||\n      event.type === 'message_unqueued') &&",
                "      false) &&",
            )
        ],
    ),
    (
        "M41 · ⛔ review · the flushed turn records the QUEUE-TIME copy, so a path whose kind changed "
        "while the message waited goes to the agent as one thing and into the ledger as another",
        # ⛔ **NO LONGER KILLABLE after 232 §1, and this is a note rather than a deletion**
        # (`142`: correct, never delete). ⚠️ The anchor still applies and the line is still
        # right — `handed.paths` is what went on the wire — but the two expressions are now
        # provably EQUAL wherever the flush proceeds: `consentChanged` refuses on any change to
        # `path` or `kind`, and `outsideCwd` cannot move for a live session because its cwd is
        # fixed for the session's whole life. ⚑ **The distinction this row was written to
        # protect has dissolved**, so no test can tell the mutant from the original; 232 named
        # it rather than shipping a row whose green means nothing.
        [
            (
                HOST,
                # ⚑ **W4.493 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. Preserve the original defect, ID and killer at the formatted keyed-handoff boundary. No plant or table run. Held: running it needs W4 written lift.
                "        // was actually told. `handed.paths` is what went on the wire, and is the only honest source.\n        ...(handed.paths.length > 0 ? { attachments: handed.paths } : {}),",
                "        // was actually told. `handed.paths` is what went on the wire, and is the only honest source.\n        ...(queued.attachments.length > 0 ? { attachments: [...queued.attachments] } : {}),",
            )
        ],
    ),
    # ------------------ the second review's findings — the defects the FIRST round of fixes carried
    (
        "M42 · 🔴 review · the replay bound SPREADS the stored object, so it holds the array length "
        "and the path length and nothing else — a bundle carries a megabyte in a field nobody "
        "declared, straight through to the renderer",
        [
            (
                STORE,
                "      .map((each) => ({ path: each.path, kind: each.kind, outsideCwd: each.outsideCwd === true }))",
                "      .map((each) => ({ ...each, outsideCwd: each.outsideCwd === true }))",
            )
        ],
    ),
    (
        "M43 · 🔒 review · a RELATIVE path is resolved against the MAIN PROCESS's own cwd instead of "
        "being refused, so a renderer sending `.env` has a file nobody chose disclosed to the agent "
        "as the user's own attachment",
        [
            (
                HANDED,
                # ⚑ Re-anchored by 232 §2: the control-character refusal now sits between this
                # guard and `const path = chosen`, so the old span no longer exists. ⚑ **Deleting
                # the guard IS the defect, and more faithfully than the old replacement was**:
                # Node resolves a relative path against the MAIN PROCESS's own `process.cwd()`
                # inside `realpath`, which is the sentence this row is about. 232 re-runs it (M15).
                "  if (!isAbsolute(chosen)) {\n"
                "    return {\n"
                "      refusal: `that is not a full path, so there is no saying what it points at: ${chosen}`,\n"
                "      gone: false,\n"
                "    }\n"
                "  }\n",
                "",
            )
        ],
    ),
    (
        "M44 · 🔒 review · the WIRE door stops requiring an absolute path — the first of the three "
        "bounds, and the one its own comment claimed to hold",
        [
            (
                IPC,
                # ⚑ Re-anchored by 232 §2: the control-character refine now follows this one, so
                # the line no longer ends in a comma. 232's table re-runs it (M13).
                "        .refine((each) => isAbsolute(each), 'a handed path must be absolute')",
                "        .refine(() => true, 'a handed path must be absolute')",
            )
        ],
    ),
    (
        "M45 · ⛔ review · the wire door stops BOUNDING the array, so a renderer posts 100,000 paths "
        "and main stats every one of them synchronously before the turn goes out",
        [(IPC, "  .max(MAX_HANDED_PATHS)\n  .optional()", "  .optional()")],
    ),
    (
        "M46 · 🔴 review · THE COMPOSER GRID · the chip list becomes an ordinary grid item again, so "
        "staging one attachment throws the text field into the button column and drops the send "
        "button onto a second row (the defect `visible()` cannot see)",
        [
            (
                COMPOSER,
                # Re-pointed by 218: the drop hint joined the same full-width rule, and the anchor
                # named the two selectors it used to have. Same line, same defect.
                ".attach-refused,\n.dropping-here {\n  grid-column: 1 / -1;\n}",
                ".attach-refused,\n.dropping-here {\n  grid-column: auto;\n}",
            )
        ],
    ),
    (
        "M47 · ⛔ review · the attach button falls off the composer's sizing rule and paints as a "
        "bordered pill beside the flat send button · killed by `attach-path.dom.test.ts`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the composer's shared button sizing now reads the control-size tokens instead of 29px; the plant still takes the attach button off that rule so it falls back to the generic bordered button
        [(COMPOSER, "\n.attach-button {\n  display: grid;\n  width: var(--control-icon);", "\n.attach-button-unused {\n  display: grid;\n  width: var(--control-icon);")],
    ),
    (
        "M48 · 🔴 review · an attachment stops counting as something to send, so with an empty box "
        "and a folder staged the Send button is lit and pressing it does nothing at all "
        "(the fix is `canSend`, not the button's `:disabled` — tightening that broke ten launcher "
        "assertions, because the launcher gates Send on the folder and the profile, not the prompt)",
        [
            # ⚑ Re-anchored by 221 §1: the predicate moved to `hasSomethingToSend` in `shared`, so
            # the composer and the WIRE hold one rule. 221's own table re-runs it (M6).
            (
                COMPOSER,
                "hasSomethingToSend(text, attached)",
                "text.trim() !== ''",
            )
        ],
    ),
    (
        "M49 · ⛔ review · the FOLD drops the ending's reason, so a message abandoned because its "
        "file was deleted renders as one abandoned because the conversation ended",
        [(TRANSCRIPT, "        if (event.detail) waiting.detail = event.detail\n", "")],
    ),
    (
        "M51 · ⛔ review · the queued bubble is pushed WITHOUT its paths, so a page that never saw "
        "the queueing shows a message that claims to carry nothing "
        "⚑ ANCHOR CORRECTED IN PLACE BY 413",
        [
            (
                TRANSCRIPT,
                "        ...(event.messageId === undefined ? {} : { messageId: event.messageId }),\n        ...(event.attachments ? { attachments: event.attachments } : {}),",
                "        ...(event.messageId === undefined ? {} : { messageId: event.messageId }),",
            )
        ],
    ),
    (
        "M52 · ⛔ review · the CENSUS's comment stripper latches on a `/*` inside a string literal "
        "again, so both rules silently stop reading the file at that line",
        [
            (
                CENSUS,
                "        if (char === \"'\" || char === '\"' || char === '`') {\n"
                "          quote = char\n"
                "          code += char\n"
                "          continue\n"
                "        }\n",
                "",
            )
        ],
    ),
    (
        "M53 · ⛔ review · the allowlist stops seeing the DEFAULT binding in a combined import, so "
        "`import fs, { statSync }` reports only the allowed half and `fs.open` walks through",
        [
            (
                CENSUS,
                "    if (\n"
                "      spec\n"
                "        .replace(/\\{[^}]*\\}/g, '')\n"
                "        .replace(/,/g, '')\n"
                "        .trim() !== ''\n"
                "    )\n"
                "      found.push('*')",
                "    if (false) found.push('*')",
            )
        ],
    ),
    (
        "M54 · ⛔ review · the side-door rule is blinded, so `await import('node:fs')` and "
        "`createRequire(...)('fs')` acquire the whole module with both censuses green",
        [
            (
                CENSUS,
                "      ({ line }) => /createRequire/.test(line) || /(?:^|[^A-Za-z0-9_$.])import\\s*\\(/.test(line),",
                "      () => false,",
            )
        ],
    ),
    (
        "M55 · ⛔ review · the restore writes the attachment book unguarded, so something attached "
        "while a failed send was in flight is silently replaced by the list that just failed "
        "(the rule was MOVED into `drafts.ts` to be reachable at all — the `RuntimeScreen` version "
        "survived the table, as three dispatches predicted it would)",
        [
            (
                DRAFTS,
                # ⚑ Re-anchored at 236: the staged list moved behind `staged` / `commitStaged`, and the
                # refused-message restore now MERGES (236 §5, from 227 LOW 3). Each defect
                # below is unchanged, and every one is re-run in `scripts/mutations/236`.
                "      if (merged.length !== now.length) paths.write(key, merged)",
                "      paths.write(key, [...attachments])",
            )
        ],
    ),
    (
        "M56 · ⛔ review · the renderer store swallows an attachment-only send and reports it as sent",
        [
            # ⚑ Re-anchored by 221 §1, for the same reason as M48. 221 re-runs it as M7.
            (
                RENDERER_STORE,
                "      if (!hasSomethingToSend(text, attachments.length)) return true",
                "      if (text.trim() === '') return true",
            )
        ],
    ),
    (
        "M57 · ⛔ review · the OUTSIDE mark is painted on every attachment, so a transcript claims "
        "every file was outside the folder — something false about what was consented to",
        [
            (
                BUBBLE,
                '          <em v-if="handed.outsideCwd" class="outside" data-cy="user-attached-outside"',
                '          <em v-if="true" class="outside" data-cy="user-attached-outside"',
            )
        ],
    ),
]


def apply(root, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
        if not path.exists():
            print(f"!! {name}: {rel} does not exist", file=sys.stderr)
            bad += 1
            continue
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(
                f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)",
                file=sys.stderr,
            )
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace, 1))
    return 1 if bad else 0


def main() -> int:
    from pathlib import Path

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
