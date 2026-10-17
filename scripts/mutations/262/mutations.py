#!/usr/bin/env python3
"""262's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **All three findings are `254`'s.** That dispatch was careful, self-reviewed three times, and
caught a packaged-app defect nobody else would have. These are what an independent panel found
anyway — the point is the panel, not the seat.

 * **§1** (`259` lens C finding 1, BLOCKING) — Send could outrun a paste, so the message reached the
   provider without the picture it referred to and the picture rode the NEXT one.
 * **§2** (lens D finding 3, HIGH) — the shared paste root was app-wide and unprotected, so any
   session in `auto` could `Glob` it and `Read` another session's screenshot with no card.
 * **§3** (lens D finding 4, MEDIUM) — the unawaited startup sweep could unlink a file a concurrent
   re-paste had just renamed into place.

## The row groups

 * `M1`-`M12`  🔴 **§1 · the draft transaction.** The reservation before the first await (`M1`, the
                row the dispatch asked for by name), the wait itself and its POSITION, the drain,
                and the one primitive all four gestures go through.
 * `M13`-`M25` 🔴 **§2 · the paste root and the grant.** `M13` is the other row the dispatch asked
                for by name — the root going back to being an unprotected sibling. The rest are the
                carve-out: exact files only, real spellings only, live rather than copied, and
                rebuilt on a reopen.
 * `M44`      🔴 **the widening this dispatch nearly shipped**, found by the pass over its own diff.\n * `M26`-`M30` 🔴 **§3 · the queue.** The serialization itself, the pair that has to be one turn of
                it, the order inside that turn, and the rejection that must not poison the chain.
 * `M31`-`M43` ⚠️ **THIRTEEN rows carried forward** from tables this diff retired. ⛔ **Not one
                retired because its defect stopped being reachable** — every one is still exactly a
                defect, and the anchor moved because this dispatch edited the line beneath it.

## Where each row should die

 * `M1`-`M4`, `M8`-`M11` → `paste-image.dom.test.ts` *"a Send that outruns the paste (262 §1)"*, and
   the source census in `one-way-to-stage.test.ts`.
 * `M5`-`M7`, `M12` → the same dom suite's caption and drain assertions.
 * `M13` → `cli-equivalence.test.ts` *"`protectedRoots` is `[userData]` and the paste root"*, and
   `pasted-image.test.ts`'s placement test.
 * `M14`-`M16` → `claude-runtime.test.ts` *"the one file this session was HANDED …"* and
   `pasted-image.test.ts` *"a grant follows the FILE, not the spelling"*.
 * `M17` → `claude-runtime.test.ts` *"…and the grant is LIVE"*.
 * `M18`-`M22` → `handed-path-send.test.ts` *"the exact attachments this session was handed"*.
 * `M23` → `whole-session-reads.test.ts` *"reopening a live session reads a page too"*.
 * `M26`-`M30` → `pasted-image.test.ts` *"one at a time on the root (262 §3)"*.

⚠️ **What no project here can see, said once**: `run_suite` runs vitest, which transforms through
esbuild — so a row that breaks only the TYPES passes all four. `M18`, `M19` and `M22` are in that
class; none of their verdicts should be read as evidence that `pnpm run typecheck` stayed green.
"""

from __future__ import annotations

import sys
from pathlib import Path

COMPOSER = "apps/desktop/src/renderer/src/components/PromptComposer.vue"
CONFINEMENT = "packages/runtime/src/internal/confinement.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
MAIN = "apps/desktop/src/main/index.ts"
PASTED = "apps/desktop/src/main/runtime/pasted-image.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"

# The paste-root guard and handed-file grants no longer exist. Keep these removed-code anchors
# recorded as retired because the planted behavior is now intended.
MUTATIONS = [
    # ── §1 · the draft transaction ────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 §1 · THE RESERVATION IS GONE — an acquisition is never recorded, so `send` reads an "
        "empty `staged`, emits the text-only turn, and the screenshot lands on the NEXT message",
        [
            (
                COMPOSER,
                "  acquiring.value = [...acquiring.value, run]\n",
                "  acquiring.value = [...acquiring.value]\n",
            )
        ],
    ),
    (
        "M2 · 🔴 §1 · the send stops waiting for this draft's attachments — the finding itself, with "
        "the reservation still made and nothing reading it",
        [(COMPOSER, "  if (acquiringNow.value) await settle()\n", "")],
    ),
    (
        "M3 · ⛔ §1 · the wait moves BELOW `canSend`, so an empty box with a screenshot still being "
        "written has nothing to say yes to and ⌘↵ is dropped in silence",
        [
            (
                COMPOSER,
                "  if (acquiringNow.value) await settle()\n"
                "  // ⚠️ **Asked AFTER the wait, because the wait is a window**",
                "  // ⚠️ **Asked AFTER the wait, because the wait is a window**",
            ),
            (
                COMPOSER,
                "  const intent = sendIntentFor(props.state, interrupting)",
                "  if (acquiringNow.value) await settle()\n"
                "  const intent = sendIntentFor(props.state, interrupting)",
            ),
        ],
    ),
    (
        "M4 · ⛔ §1 · the wait moves BELOW the emit, which is no wait at all — a `toContain` census "
        "would still be green and the message would already have gone",
        [
            (
                COMPOSER,
                "  if (acquiringNow.value) await settle()\n"
                "  // ⚠️ **Asked AFTER the wait, because the wait is a window**",
                "  // ⚠️ **Asked AFTER the wait, because the wait is a window**",
            ),
            (
                COMPOSER,
                "  text.value = ''\n  // A refusal from an earlier picker attempt",
                "  if (acquiringNow.value) await settle()\n"
                "  text.value = ''\n  // A refusal from an earlier picker attempt",
            ),
        ],
    ),
    (
        "M5 · ⚠️ §1 · `settle` SNAPSHOTS instead of draining, so a second ⌘V one keystroke later is "
        "still in flight when the message goes out",
        [
            (
                COMPOSER,
                "  for (let waiting = acquiring.value; waiting.length > 0;) {\n"
                "    await Promise.allSettled(waiting)\n"
                "    const done = waiting\n"
                "    waiting = acquiring.value.filter((each) => !done.includes(each))\n"
                "  }\n",
                "  await Promise.allSettled(acquiring.value)\n",
            )
        ],
    ),
    (
        "M6 · ⚠️ §1 · `allSettled` becomes `all`, so one bridge call that rejects abandons the whole "
        "send — the press has no outcome at all and the words stay in a box nobody was told about",
        [
            (
                COMPOSER,
                "    await Promise.allSettled(waiting)",
                "    await Promise.all(waiting)",
            )
        ],
    ),
    (
        "M7 · ⚠️ §1 · the slot is never released, so `acquiringNow` latches true — the caption never "
        "clears and every later send pays a wait for an acquisition that finished long ago",
        [
            (
                COMPOSER,
                "    acquiring.value = acquiring.value.filter((each) => each !== run)\n",
                "",
            )
        ],
    ),
    (
        "M8 · ⛔ §1 · the PICKER stops reserving a slot — the slowest gesture of the four, since a "
        "modal can stand open for a minute, and therefore the likeliest instance of the defect",
        [
            (
                COMPOSER,
                "  await acquire(async () => {\n"
                "    const chosen = await window.api.chooseAttachment({ cwd: props.cwd })",
                "  await (async () => {\n"
                "    const chosen = await window.api.chooseAttachment({ cwd: props.cwd })",
            ),
            (
                COMPOSER,
                "    return chosen === null ? null : [chosen]\n  })",
                "    if (chosen !== null) stage([chosen])\n  })()",
            ),
        ],
    ),
    (
        "M9 · ⛔ §1 · the DROP stops reserving one, so a file dropped on a stalled network volume "
        "misses the message it was dropped on",
        [
            (
                COMPOSER,
                "  await acquire(async () => {\n    const verdicts = await classify(paths)",
                "  await (async () => {\n    const verdicts = await classify(paths)",
            ),
            (
                COMPOSER,
                "    return pathless === 0 ? verdicts : [...verdicts, { refusal: pathlessRefusal(pathless) }]\n"
                "  })",
                "    stage(pathless === 0 ? verdicts : [...verdicts, { refusal: pathlessRefusal(pathless) }])\n"
                "  })()",
            ),
        ],
    ),
    (
        "M10 · 🔴 §1 · the PASTE stops reserving one — `259` lens C finding 1, exactly as measured",
        [
            (
                COMPOSER,
                "  await acquire(async () => {\n"
                "    // ⛔ **Main is asked about the CLIPBOARD first",
                "  await (async () => {\n" "    // ⛔ **Main is asked about the CLIPBOARD first",
            ),
            (
                COMPOSER,
                "    return [...verdicts, ...image, ...extra]\n  })",
                "    stage([...verdicts, ...image, ...extra])\n  })()",
            ),
        ],
    ),
    (
        "M11 · ⚠️ §1 · a CANCELLED picker is staged as an empty list, so thinking better of it wipes "
        "the refusal already on screen — `216`'s rule that a cancel changes nothing",
        [
            (
                COMPOSER,
                "    if (verdicts !== null) stage(verdicts)",
                "    stage(verdicts ?? [])",
            )
        ],
    ),
    (
        "M12 · ⚠️ §1 · the caption goes, so a Send that is honestly waiting for a file looks like a "
        "press that did nothing — `106`'s complaint arriving through the fix for it",
        [(COMPOSER, '  <p v-if="acquiringNow"', '  <p v-if="false"')],
    ),
    # ── §2 · the paste root and the grant ─────────────────────────────────────────────────────
    (
        "M13 · 🔴 §2 · THE PASTE ROOT GOES BACK TO BEING AN UNPROTECTED SIBLING — session A's "
        "screenshot is readable by every session B running in `auto`, with no card (`259` lens D 3)",
        [
            (
                MAIN,
                "    protectedRoots: () => [userData, pastedImagesRoot(userData)],",
                "    protectedRoots: () => [userData],",
            )
        ],
    ),
    (
        "M14 · 🔴 §2 · the grant is dropped, so the session cannot read the picture it was handed — "
        "254's whole gesture dead again, refused by this app's own confinement",
        [
            (
                CONFINEMENT,
                "      return roots.handed.has(real) ? 'outside' : 'refused'",
                "      return 'refused'",
            )
        ],
    ),
    (
        "M15 · 🔴 §2 · the grant widens from a FILE to the whole root the file is in, so one "
        "attachment opens every neighbour's — the fix the reviewer pre-empted by name",
        [
            (
                CONFINEMENT,
                "      return roots.handed.has(real) ? 'outside' : 'refused'",
                "      return roots.handed.size > 0 ? 'outside' : 'refused'",
            )
        ],
    ),
    (
        "M16 · ⚠️ §2 · the grant is matched on the LEXICAL spelling, so a path spelled through the "
        "granted directory into the app's data is tested as though it were the granted file",
        [
            (
                CONFINEMENT,
                "      return roots.handed.has(real) ? 'outside' : 'refused'",
                "      return roots.handed.has(lexical) ? 'outside' : 'refused'",
            )
        ],
    ),
    (
        "M17 · ⛔ §2 · the adapter COPIES the grant set at launch, so nothing attached after the "
        "first frame can ever be read — a live carve-out frozen into a dead one",
        [
            (
                CLAUDE,
                "    ...(context.handedPaths === undefined ? {} : { handed: context.handedPaths }),",
                "    ...(context.handedPaths === undefined ? {} : { handed: new Set(context.handedPaths) }),",
            )
        ],
    ),
    (
        "M18 · ⛔ §2 · a STARTED session is launched with no grant set at all, so every attachment it "
        "is handed is refused by the root this dispatch protected",
        [(HOST, "        handedPaths: slot.handedPaths,\n", "")],
    ),
    (
        "M19 · ⛔ §2 · …and a RESUMED one, which is the half a start-only test would never see",
        [
            (
                HOST,
                "        handedPaths: slot.handedPaths, // …and as in `startSession` (262 §2), pre-filled above\n",
                "",
            )
        ],
    ),
    (
        "M20 · 🔴 §2 · a reopened conversation does not re-grant what its own ledger says it was "
        "handed, so it refuses the screenshot its transcript is still showing",
        [(HOST, "    this.grantRecordedAttachments(slot, sessionId)\n", "")],
    ),
    (
        "M21 · 🔴 §2 · the message is composed WITHOUT granting, so every path reaches the provider "
        "as one the guard has never been told about",
        [
            (
                HOST,
                "      if (isPastedImage(each.path)) session.handedPaths.add(each.path)\n",
                "",
            )
        ],
    ),
    (
        "M22 · ⚠️ §2 · `register` copies the slot's set instead of carrying it, so the adapter holds "
        "one object and every send writes into another",
        [
            (
                HOST,
                "      handedPaths: slot.handedPaths,\n      sink,",
                "      handedPaths: new Set(slot.handedPaths),\n      sink,",
            )
        ],
    ),
    (
        "M23 · ⚠️ §2 · the prefill reads the WHOLE ledger again — 053's rule, broken on a reopen of a "
        "conversation that may hold a hundred thousand events, to find a handful of paths",
        [
            (
                HOST,
                "    for (const path of this.deps.store.handedPaths(sessionId)) slot.handedPaths.add(path)",
                "    for (const recorded of this.deps.store.events(sessionId)) {\n"
                "      const attached = (recorded.event as { attachments?: readonly { path: string }[] })\n"
                "        .attachments\n"
                "      for (const each of attached ?? []) slot.handedPaths.add(each.path)\n"
                "    }",
            )
        ],
    ),
    (
        "M24 · ⚠️ §2 · the refusal goes back to promising *'to every session'*, which stopped being "
        "true the moment one session could be granted a file the others cannot see (086, a 4th time)",
        [
            (
                CONFINEMENT,
                "    `A tool call naming it is refused whatever the mode.`",
                "    `A tool call naming it is refused to every session, in every mode.`",
            )
        ],
    ),
    (
        "M25 · ⛔ §2 · the ledger read drops its GENERATION filter, so a reopen grants paths from a "
        "re-derivation this conversation abandoned",
        [
            (
                STORE,
                # ⚑ 676 · anchor CORRECTED, not retired: the field test sits behind `json_valid`
                # now (a torn row raised a reopen); the generation filter is the same subject.
                "      WHERE session_id = ? AND generation = ?\n"
                "        AND CASE WHEN json_valid(payload)\n"
                "                 THEN json_extract(payload, '$.attachments') IS NOT NULL",
                "      WHERE session_id = ?\n"
                "        AND CASE WHEN json_valid(payload)\n"
                "                 THEN json_extract(payload, '$.attachments') IS NOT NULL",
            ),
            (
                STORE,
                "      const rows = selectHandedPaths.all(sessionId, activeGeneration(sessionId)) as {",
                "      const rows = selectHandedPaths.all(sessionId) as {",
            ),
        ],
    ),
    # ── §3 · one at a time on the root ────────────────────────────────────────────────────────
    (
        "M26 · 🔴 §3 · the queue stops queueing, so the unawaited startup sweep and a paste are "
        "inside the same directory at once — `259` lens D finding 4",
        [
            (
                PASTED,
                "  const mine = onTheRootQueue.then(work)",
                "  const mine = Promise.resolve().then(work)",
            )
        ],
    ),
    (
        "M27 · 🔴 §3 · the handler sweeps and writes as TWO turns of the queue, which is two windows "
        "— the smaller version of the same race, between a paste's own sweep and its own write",
        [
            (
                MAIN,
                "      return await pastePicture(root, image.toPNG(), input.cwd ?? '', Date.now())",
                "      await sweepPastedImages(root, Date.now())\n"
                "      return await writePastedImage(root, image.toPNG(), input.cwd ?? '')",
            ),
            (
                MAIN,
                "  pastePicture,\n  pastedImagesRoot,",
                "  pastedImagesRoot,",
            ),
            (
                MAIN,
                "  tooManyPixels,\n} from './runtime/pasted-image'",
                "  tooManyPixels,\n  writePastedImage,\n} from './runtime/pasted-image'",
            ),
        ],
    ),
    (
        "M28 · ⛔ §3 · the paste sweeps AFTER it writes, so it can race the very file it has just "
        "created — the picture staged for a path a moment older than the sweep that removed it",
        [
            (
                PASTED,
                "    await sweepRoot(root, now, PASTED_IMAGE_TTL_MS)\n"
                "    return await writeOne(root, png, cwd)",
                "    const verdict = await writeOne(root, png, cwd)\n"
                "    await sweepRoot(root, now, PASTED_IMAGE_TTL_MS)\n"
                "    return verdict",
            )
        ],
    ),
    (
        "M29 · ⚠️ §3 · the queue carries a REJECTION forward, so one failed write refuses every paste "
        "for the rest of the run — a lock that fails closed on a job it was only meant to order",
        [
            (
                PASTED,
                "  onTheRootQueue = mine.then(\n    () => undefined,\n    () => undefined,\n  )",
                "  onTheRootQueue = mine",
            )
        ],
    ),
    (
        "M30 · ⛔ §3 · the START sweep goes, so nothing bounds a directory of abandoned drafts before "
        "a window exists — and the paste handler's gate has nothing to wait behind",
        [
            (
                MAIN,
                "  void sweepPastedImages(pastedImagesRoot(userData), Date.now()).catch(() => 0)\n",
                "",
            )
        ],
    ),
    (
        "M44 · 🔴 §2 · the grant stops caring WHAT it is granting, so a file attached with the "
        "paperclip is carved out of `userData` too — 069 A1 re-opened through a file picker",
        [
            (
                HOST,
                "      if (isPastedImage(each.path)) session.handedPaths.add(each.path)",
                "      session.handedPaths.add(each.path)",
            )
        ],
    ),
    # ── carried forward ───────────────────────────────────────────────────────────────────────
    (
        "M31 · ⚠️ `160 M1` CARRIED FORWARD · 153 §2 IS BACK — the personal homes rejoin "
        "protectedRoots, so a Claude session is refused ~/.claude and ~/.codex again",
        [
            (
                MAIN,
                "    protectedRoots: () => [userData, pastedImagesRoot(userData)],",
                "    protectedRoots: () => [\n"
                "      userData,\n"
                "      pastedImagesRoot(userData),\n"
                "      `${process.env['HOME']}/.claude`,\n"
                "      `${process.env['HOME']}/.codex`,\n"
                "    ],",
            )
        ],
    ),
    (
        "M32 · ⚠️ `160 M2` CARRIED FORWARD · the guard leaves entirely, dropping both roots that have "
        "a neighbour reason (069 A1 reopens, and 259 lens D 3 with it)",
        [
            (
                MAIN,
                "    protectedRoots: () => [userData, pastedImagesRoot(userData)],",
                "    protectedRoots: () => [],",
            )
        ],
    ),
    (
        "M33 · ⚠️ `160 M20` CARRIED FORWARD · a protected root stops being refused when only the REAL "
        "path lands in it — a symlink launders the credential store",
        [
            (
                CONFINEMENT,
                "    if (isWithin(root.lexical, lexical) || isWithin(root.real, real)) {",
                "    if (isWithin(root.lexical, lexical)) {",
            )
        ],
    ),
    (
        "M34 · ⚠️ `171 M1` CARRIED FORWARD · the refusal message goes back to claiming the DIRECTORY "
        "is unreachable, which reads as a rule about the folder rather than about this call",
        [
            (
                CONFINEMENT,
                "    `A tool call naming it is refused whatever the mode.`",
                "    `The app refuses its own data directory to every session, in every mode.`",
            )
        ],
    ),
    (
        "M35 · ⚠️ `216 M17` CARRIED FORWARD · a message QUEUED behind a running turn sends its words "
        "and silently drops its attachments — the chip vanishing as if it had gone (215 §3.2)",
                # ⚠️ **Anchor corrected by `412`, not retired.** The call gained the task the turn
                # hands over and wrapped over three lines; the rule this row protects — the flush
                # composes, so a held message's attachments reach the provider — is untouched.
                # ⚑ **Re-pointed by 414**: 412 gave `handToProvider` the task and 414 the origin,
                # so the flush's argument list wraps. The rule is untouched — this row still
                # deletes the whole composition and hands the words over bare.
                # ⚑ **Anchor corrected by `662`, not retired.** The handover moved INTO
                # `handToProvider`, so the flush calls it bare and its arguments lost a level.
                # The rule is untouched — this row still hands the words over bare.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a message queued behind a running turn must send its attachments when it flushes
        # (handed-path-send.test.ts 215 §3.2). D-016 changed the call: runFlush passes
        # `handed.paths` and a `handing` piece object to handToProvider instead of `queued.taskId`,
        # so the old `old` text no longer occurs. The plant hands the provider an empty path list,
        # which sends the words and drops the attachment block, and leaves the call well-formed.
        # Killed by `handed-path-send.test.ts`.
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — The flush no longer passes `handed.paths` after the queued words; D-027 reads
        # `one.handed.paths` in its single-message handover (`sending.length === 1`), and a turn of
        # several goes through handTogetherToProvider. The rule (a message queued behind a running
        # turn still carries its attachments to the provider) survives on the single-message path,
        # which is the label's population. The plant hands `[]` instead. Killed by
        # `handed-path-send.test.ts`.
        [
            (HOST, '            one.handed.paths,\n            one.handing,\n', '            [],\n            one.handing,\n'),
        ],
    ),
    (
        "M36 · ⚠️ `216 M19` CARRIED FORWARD · the interrupting send drops them, so redirecting an "
        "agent loses the file you were redirecting it to · killed by `the-origin-a-model-is-told.test.ts` (named by W4.139)",
        [
                # ⚠️ **Anchor corrected by `412`**: the interrupting send now names the task it does
                # NOT hand over. The rule is unchanged and so is the replacement.
                # ⚑ **Re-pointed by 414** — the interrupting send now derives an origin, so the
                # call wraps. The rule is untouched: the composition goes, the words stay.
                # ⚑ **Anchor corrected by `662`** — the handover moved into `handToProvider`, so
                # this door calls it bare, on one line. Same rule, same replacement.
                # ⚑ **Anchor corrected by `670`** — the handover sits in a `try` now, so a lost race
                # can be held. Same rule, same replacement, one level deeper.
                # ⚑ **713 · corrected in place** (standing rule 27): the interrupting handover hands over
                # its first gate's answer (`decided`, `708` H-4), so the call gained an argument. Same
                # rule, same replacement; re-verified RED alone, killer named in 713's response.
                # ⚑ **W4.136 · re-anchored in place, not retired** — F033 gave handToProvider the piece the words drive (null here), so the call reads one argument longer
                # ⚑ **W4.147 · re-anchored in place, not retired** — F088 gave handToProvider the piece an agent's note or follow-up names, after the piece the words drive, and prettier put the call on one argument per line; same rule, same plant (null here): the interrupting send still drops the composition and sends the bare words
                # ⚑ **W4.493 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. The interrupting send still drops attachments and composition; preserve the new pending-row reset while removing the same handover. No plant or table run. Held: running it needs W4 written lift.
                # ⚑ **W4.493 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. Current-handoff association changed this boundary; the same interrupting-authorship removal or unframed send defect and killer remain. No plant or table run. Held: running it needs W4 written lift.
                # ⚑ **W4.475 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. The interrupting handover now also hands over the turn row, whose authorship says whose turn it is; the same interrupting send still drops attachments and composition, and the killer stands. No plant or table run.
            ('apps/desktop/src/main/runtime/runtime-host.ts', '      await this.handToProvider(\n        session,\n        text,\n        handed.paths,\n        null,\n        null,\n        null,\n        this.originOf(by),\n        turn,\n        decided,\n      )', '      await session.handle.send(text)'),
        ],
    ),
    (
        "M37 · ⚠️ `216 M46` CARRIED FORWARD · THE COMPOSER GRID — the chip list becomes an ordinary "
        "grid item again, so staging one attachment throws the text field into the button column",
        [
            (
                COMPOSER,
                ".attach-refused,\n.attaching,\n.dropping-here {\n  grid-column: 1 / -1;\n}",
                ".attach-refused,\n.attaching,\n.dropping-here {\n  grid-column: auto;\n}",
            )
        ],
    ),
    (
        "M38 · ⚠️ `254 M14` CARRIED FORWARD · the clipboard is read even when the pasted entry HAS a "
        "path, so copying a file in Finder writes a second copy of it",
        [
            (
                COMPOSER,
                "      pathless === 0 || carriesText\n        ? []\n        : room > 0",
                "      false\n        ? []\n        : room > 0",
            )
        ],
    ),
    (
        "M39 · ⚠️ `254 M16` CARRIED FORWARD · a paste carrying more than one picture drops the rest in "
        "SILENCE — `106`'s rule, on the gesture with no filename and no preview to notice it by",
        [
            (
                COMPOSER,
                "    const extra =\n"
                "      pathless > 1 && !carriesText ? [{ refusal: onlyOnePastedImage(pathless - 1) }] : []",
                "    const extra: { refusal: string }[] = []",
            )
        ],
    ),
    (
        "M40 · ⚠️ `254 M17` CARRIED FORWARD · the paste writes the staged list itself instead of "
        "returning it — the FOURTH code path `218`'s census exists to prevent, and now also the "
        "gesture escaping 262 §1's reservation",
        [
            (
                COMPOSER,
                "    return [...verdicts, ...image, ...extra]",
                "    emit('update:attachments', [\n"
                "      ...staged.value,\n"
                "      ...image.flatMap((v) => ('handed' in v ? [v.handed] : [])),\n"
                "    ])\n"
                "    return null",
            )
        ],
    ),
    (
        "M41 · ⚠️ `254 M40` CARRIED FORWARD · the clipboard is read AFTER the path round trip, "
        "re-opening the window in which a clipboard manager can put something else on the pasteboard",
        [
            (
                COMPOSER,
                "    const verdicts = await classify(paths)\n    // ⛔ **One picture",
                "    // ⛔ **One picture",
            ),
            (
                COMPOSER,
                "    const extra =\n      pathless > 1 && !carriesText",
                "    const verdicts = await classify(paths)\n"
                "    const extra =\n      pathless > 1 && !carriesText",
            ),
        ],
    ),
    (
        "M42 · ⚠️ `254 M36` CARRIED FORWARD · the sweep runs only at START, so the week-long bound "
        "holds only for a process that restarts more often than the bound",
        [
            (
                PASTED,
                "    await sweepRoot(root, now, PASTED_IMAGE_TTL_MS)\n",
                "",
            )
        ],
    ),
    (
        "M43 · ⚠️ `254 M44` CARRIED FORWARD · the paste's own sweep runs after the write AND outside "
        "the queue's single turn — 254's race and 262's, at once",
        [
            (
                MAIN,
                "      return await pastePicture(root, image.toPNG(), input.cwd ?? '', Date.now())",
                "      const verdict = await writePastedImage(root, image.toPNG(), input.cwd ?? '')\n"
                "      await sweepPastedImages(root, Date.now())\n"
                "      return verdict",
            ),
            (
                MAIN,
                "  pastePicture,\n  pastedImagesRoot,",
                "  pastedImagesRoot,",
            ),
            (
                MAIN,
                "  tooManyPixels,\n} from './runtime/pasted-image'",
                "  tooManyPixels,\n  writePastedImage,\n} from './runtime/pasted-image'",
            ),
        ],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    """Apply (or merely verify) one mutation. Returns 0 on success, 1 on a bad anchor."""
    name, edits = MUTATIONS[index]
    for rel, find, replace in edits:
        path = root / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name.split(' ·')[0]}: anchor found {hits}x in {rel} (expected exactly 1)")
            return 1
        if find == replace:
            print(f"!! {name.split(' ·')[0]}: replacement equals the original in {rel} — a no-op row")
            return 1
        if not dry:
            path.write_text(text.replace(find, replace, 1))
    return 0


def main() -> int:
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
