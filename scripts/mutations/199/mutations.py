#!/usr/bin/env python3
"""199's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **Two of these rows are the pre-199 code, not an invention.** M2 and M9 delete the two lines that
did not exist before this dispatch: the adapter reading `new_conversation_id` at all, and the
normalizer surfacing a refusal. Everything else is a way the fix could be present and still wrong.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. These were taken after `format:check`
was green.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

  * **`conversation_reset` on the WIRE.** Every row below drives the app's own vocabulary, so no
    row here can see the provider. ⚑ **The signal itself is no longer unobserved, and this paragraph
    said it was until the smoke ran** — `ui-live-smoke.mjs` step 70 types `/clear` into a real
    Claude conversation and got it, first time: *"1 conversation_reset · ref e3040511-1757-47d9-b3b6-486465a49b73
    → 4797e21f-c76c-4f08-b137-b1d21c855d3b"*, with the seam drawn and surviving normal mode. ⚠️ 133's
    lesson, which is why the smoke was written before this was claimed either way: a comment
    asserting a signal had never been seen was wrong for two dispatches, and absence in a capture is
    not absence. What stays out of this table's reach is the provider, not the fact.
  * **A second `system/init` AFTER a reset.** If the CLI re-announces the session under its new id,
    a RESUMED session would meet `validateInitRef`'s barrier with a mismatched id and be
    terminalized as a resume failure. Nothing in the SDK types says whether it does, and this table
    changes none of that code — the barrier is exactly as 011 left it. Unmeasured, and reported.
    ⚑ **Measured since (`715`'s `probe:claude-resume-after-cd`), and ruled (`721`):** it does — and
    the id it names is the only one with a transcript; `new_conversation_id` has none. R75 moves the
    ref to that init's id, R76 lets a reopen's first init follow its own reset. ⚠️ So M2's sentence
    is now the decision and M7's subject is gone (both retired by ruling, below); M3 and M5 were
    re-anchored in place at `721` onto the init-after-reset door; that door's own defects are table
    `721`.
  * **The `dom` project.** The new SFC is exercised by SSR in `desktop`, which proves which
    component ran and what text it emitted. Layout and resolved colour — 083's whole subject — have
    no test here at all, so a row mutating the stylesheet would come back GREEN.
  * **The ARCHIVE of the abandoned conversation.** One session row holds one ref, so after a reset
    the sweep copies the provider's file for the NEW conversation and never the old one. That is a
    consequence of the fix rather than a defect in it, it is unchanged by every row below, and it is
    ranked in the response doc.

⛔ **Do not apply these by hand** — `mutate.sh` owns the tree, takes 196's repository-global lock,
and restores from a pristine copy keyed by FULL relative path.
"""

from __future__ import annotations

import sys

NORMALIZE = "packages/runtime/src/claude/normalize.ts"
ADAPTER = "packages/runtime/src/claude/claude-runtime.ts"
FAKE = "packages/runtime/src/fake-runtime.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
FOLD = "apps/desktop/src/renderer/src/lib/transcript.ts"
MODE = "apps/desktop/src/renderer/src/lib/transcript-mode.ts"

# ⚑ `721`: `refAfterReset`'s body — the ref the init after a reset moves to (R75).
RESET_HELPER = """  if (current === null) return null
  if (!next || next === current.sessionId) return null
  return { ...current, sessionId: next }
"""

STORE_WRITE = """      if (event.type === 'session' || event.type === 'conversation_reset') {
        updateRef.run(serializeSessionRef(event.ref), at, sessionId)
      }
"""

FOLD_CASE = """      state.ref = event.ref
      state.items.push({
        kind: 'reset',
        id: nextId(state, 'reset'),
        sessionId: event.ref.sessionId,
        source: event.source,
      })
"""

MUTATIONS = [
    # ---- §1 · identity: the ref must follow the provider -----------------------------------------
    (
        "M1 · the handle's ref does not follow · `handle.ref` goes on naming the conversation the "
        "provider left, so the archive, the hand-over and the `session:'ended'` all name it too",
        [
            (
                ADAPTER,
                "    if (event.type === 'conversation_reset') this._ref = event.ref\n",
                "",
            )
        ],
    ),
    (
        # 🔴 **RETIRED BY RULING at `721` (R75), in the honest direction: this row's sentence is now
        # the product.** ⚑ R75: *"After a `conversation_reset`, [the ref] is the session the CLI's
        # next init names in the same launch … not the id the reset event names."* — so nothing
        # reads `new_conversation_id`, deliberately: measured, it names a conversation with no
        # transcript. ⛔ Re-anchored onto the new emit, the row would delete R75's door rather than
        # put back 199's defect, and it would carry 199's verdict unearned. ⚑ The defect it guarded
        # — *the ref does not follow a `/clear`* — is measured again by `721 M1` (the reset never
        # remembered) and `721 M2` (the move never emitted). Its anchor is the pre-`721` emit.
        "M2 · ⛔ THE DEFECT, verbatim · nothing reads `new_conversation_id` — the pre-199 code",
        [
            (
                ADAPTER,
                "        const reset = claudeConversationReset(message, this._ref)\n"
                "        if (reset)\n"
                "          this.emit({ type: 'conversation_reset', ref: reset, source: 'conversation_reset' })\n",
                "",
            )
        ],
    ),
    (
        "M3 · the reset moves the ref through the OPENING door instead · `sessionStarted`'s guard "
        "drops it on the floor, so the identity silently does not move at all",
        [
            (
                # ⚑ Re-anchored IN PLACE at `721`: the reset's move is emitted off the init after it
                # (R75) — the same door, a different source. The defect is unchanged.
                ADAPTER,
                "          if (moved) this.emit({ type: 'conversation_reset', ref: moved, source: RESET_SOURCE })\n",
                "          if (moved) this.machine.sessionStarted(moved, this.opening)\n",
            )
        ],
    ),
    # ⛔ **M4 is this slot's SECOND occupant, and the first one is why a table is worth running at
    # all.** It read *"the terminal half of the guard is gone"* and aimed at
    # `this.machine.isTerminal ? null : …` at the reset's call site — and it came back **GREEN**.
    # `runLoop` stops reading the moment `terminated` is set, and every path to a terminal state
    # sets it in the same synchronous block, so the check could not fire. 198's rule: a green row
    # found either blindness or dead code, and this found dead code. The guard is gone (the comment
    # that replaced it records the measurement) and this slot now holds a row that kills a test.
    (
        "M4 · the seam cites nothing · the row says a reset happened and not which signal reported "
        "it, so a reader cannot tell where the claim came from",
        [
            (
                FOLD,
                "        sessionId: event.ref.sessionId,\n        source: event.source,\n",
                "        sessionId: event.ref.sessionId,\n        source: '',\n",
            )
        ],
    ),
    (
        "M5 · the new ref is INVENTED rather than derived · rotation resets to 0, so the ref names "
        "a conversation no resume can match",
        [
            (
                NORMALIZE,
                RESET_HELPER,
                "  if (current === null) return null\n"
                "  if (!next || next === current.sessionId) return null\n"
                "  return { provider: 'claude', sessionId: next, cwd: current.cwd, rotation: 0 }\n",
            )
        ],
    ),
    (
        "M6 · a re-announcement of the SAME conversation is treated as a reset · a seam is drawn "
        "where nothing happened and the ref is rewritten with itself",
        [
            (
                NORMALIZE,
                "  if (!next || next === current.sessionId) return null\n",
                "  if (!next) return null\n",
            )
        ],
    ),
    (
        # 🔴 **RETIRED at `721`, and the subject is gone by RULING (R75).** ⚑ Under R75 the reset
        # FRAME carries no id into any ref — `claudeConversationReset` returns only the conversation it
        # left — so there is no longer a line where *"a reset before the handshake names the
        # session"* could be written. ⛔ `721` first re-anchored it onto `refAfterReset`'s
        # `current === null` guard, and `721`'s review showed why that was wrong: the helper's one
        # caller runs only after the first init set the ref, so the mutant was unreachable from the
        # product and only the helper's unit test saw it — a verdict for a subject the row no longer
        # measured. ⚑ What holds the rule now is the first init SPENDING the pending reset (`721 M5`)
        # and R76's proof (`721 M8`, `M9`). Its anchor is the pre-`721` helper.
        "M7 · a reset before the handshake names the session · `system/init` stops being the only "
        "door to a first identity, and the resume barrier is bypassed",
        [
            (
                NORMALIZE,
                "  if (message.type !== 'conversation_reset' || current === null) return null\n"
                "  const next = readString(message, 'new_conversation_id')\n",
                "  if (message.type !== 'conversation_reset') return null\n"
                "  const next = readString(message, 'new_conversation_id')\n"
                "  if (current === null) return { provider: 'claude', sessionId: next, cwd: '/', rotation: 0 }\n",
            )
        ],
    ),
    (
        "M8 · ⛔ the row a resume reopens from is never updated · everything on screen is right and "
        "the work is still lost at the next launch",
        [
            (
                STORE,
                STORE_WRITE,
                "      if (event.type === 'session') {\n"
                "        updateRef.run(serializeSessionRef(event.ref), at, sessionId)\n"
                "      }\n",
            )
        ],
    ),
    (
        "M9 · the DOUBLE stops following the reset (186's argument) · the Fake's `handle.ref` lies, "
        "so its `session:'ended'` writes the abandoned conversation back over the row on close",
        [
            (
                FAKE,
                "    if (event.type === 'conversation_reset') this._ref = event.ref\n",
                "",
            )
        ],
    ),
    # ---- §2 · visibility: the reader has to be told ----------------------------------------------
    (
        "M10 · ⛔ THE DEFECT, verbatim · a refusal falls through to `unknown{activity}` — chatter, "
        "filtered out of the reading view, an empty turn with no explanation (the pre-199 code)",
        [
            (
                NORMALIZE,
                "      if (message.subtype === 'model_refusal_no_fallback') {\n"
                "        return [{ type: 'error', message: refusalNotice(message), fatal: false }]\n"
                "      }\n",
                "",
            )
        ],
    ),
    (
        "M11 · the refusal is surfaced with neither its category nor its explanation · a line that "
        "says something happened and nothing about what",
        [
            (
                NORMALIZE,
                "  return detail ? `${head}: ${truncate(detail)}` : `${head}.`\n",
                "  return `claude declined to answer.`\n",
            )
        ],
    ),
    (
        "M12 · the refusal ENDS the session · a turn that produced nothing is reported as a "
        "conversation that is over",
        [
            (
                NORMALIZE,
                "        return [{ type: 'error', message: refusalNotice(message), fatal: false }]\n",
                "        return [{ type: 'error', message: refusalNotice(message), fatal: true }]\n",
            )
        ],
    ),
    (
        "M13 · the reset is filed as lifecycle chrome after all · an `info` notice, which is exactly "
        "what the reading view drops — the row is not quiet, it is absent",
        [
            (
                FOLD,
                FOLD_CASE,
                "      state.ref = event.ref\n"
                "      notice(state, 'info', `conversation reset · ${event.ref.sessionId}`)\n",
            )
        ],
    ),
    (
        "M14 · the transcript's own ref does not follow · the header and the exporter go on naming "
        "the conversation the provider left, under a row that says it left",
        [
            (
                FOLD,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. d33e354fa added message-run bookkeeping before the same ref update; remove only that update.
                "    case 'conversation_reset': {\n      endMessageRun(state)\n      state.ref = event.ref\n",
                "    case 'conversation_reset': {\n      endMessageRun(state)\n",
            )
        ],
    ),
    # ⚠️ **M15's FIRST version came back GREEN and did not express its defect** — a second thing
    # this table found about itself. It deleted `case 'reset':` from the visible group, which drops
    # the kind into `isVisibleIn`'s `default` arm — and that arm returns **true**, deliberately, so
    # a new item kind fails safe INTO the reading view rather than out of it. The mutation therefore
    # left the row on screen and proved nothing. ⛔ **The defect has to be stated, not implied**: an
    # explicit `return false`, which is what "filed as chrome" actually looks like.
    (
        "M15 · the reading view hides the row · the seam exists, is drawn, and is only ever on "
        "screen in the mode nobody reads in",
        [
            (
                MODE,
                "    case 'reset':\n    case 'user':\n",
                "    case 'reset':\n      return false\n    case 'user':\n",
            )
        ],
    ),
]


def apply(root, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
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
