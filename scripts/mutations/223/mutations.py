#!/usr/bin/env python3
"""223's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **Send was lit, full-accent and completely inert whenever the box was empty and nothing was
attached — the state the app spends most of its life in.** `send-prompt`'s `:disabled` was
`!canType || blocked !== null` and had never asked about CONTENT. `221` pressed it in the running
app and measured the whole of it: **no conversation, no rail row, the wire never reached.** `106` in
its worst form, on the most-seen button in the product.

⚑ **It had been declined twice for the same reason.** `216` tried to tighten it; `221` tried the
one-line fix and backed it out. Both hit the same wall: **nine `dom` assertions** in
`profile-picker.dom.test.ts` and `folder-gate.dom.test.ts` asserting *"a legal name/folder lights
Send"* with an EMPTY prompt box — so each was testing its own gate AND the absence of a content gate,
in one assertion, and only one of those was its subject.

The rows fall into five groups:

  * `M1`-`M4`   §1/§2 · the button, and every way to get it wrong in both directions — refusing what
    the send paths accept, and refusing nothing at all.
  * `M5`-`M8`   §4 · the sentence, and the precedence that decides which one gets the slot.
  * `M9`-`M12`  §3 · ⛔ **the isolation itself.** `M9`-`M11` take the prompt back out of the THREE
    test files that were entangled, so their assertions stop being about their own subject — which is
    the finding, so it has to be killable. `M12` is the INSTRUMENT rather than a fixture: it stops
    the *"type, then read the button"* helper dispatching its `input` event, which is the trap 223
    fell into writing that file and which turns every one of those tests into a test of the initial
    state.

    ⚠️ **`M11` SURVIVED its first run, and the reason is worth writing down.** Removing a draft only
    WEAKENS a test; a weaker `expect` still passes, so nothing fails. `M9` and `M10` were killed by
    luck — their files also hold `disabled === false` assertions, which do break. `M11`'s file holds
    only a `true` one. ⛑ **The repair is not in this table**: each of the three files now asserts its
    own non-vacuity (*"every assertion here runs with a prompt in the box"*), which is a claim that
    can fail — and that is what makes all three rows kills rather than two kills and a hope.
  * `M13`-`M15` §5 · the OTHER consumers of the one rule, and the census that catches them. ⚠️ **A
    row that WEAKENS an assertion is not a mutation** — the first draft of `M13`/`M14` did exactly
    that and could never have been killed, because a weaker `expect` still passes. They mutate the
    source the census reads, which is the only shape a census row can have.
  * `M17`       ⛔ **The regression 223 itself introduced**, caught by an adversarial pass over this
    dispatch's own diff before it was committed: the tooltip was written as a SECOND chain beside
    `:disabled`, enumerating two of `canSend`'s three clauses, so an `ended` conversation fell
    through to the content sentence. The row deletes the state branch that fixed it.
  * `M16`       ⚠️ **`169` M1 and `219` M8, re-anchored and RE-RUN.** They are the same edit — the
    button stops reading `blocked` — and both went stale when 223 moved that `:disabled` onto
    `canSendNow`. Restoring an anchor without running it is an applicability claim rather than a
    kill, so it is run here once; both of their own tables are re-anchored too.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

  * ⛔ **A real person pressing a real dark button.** Every row here runs against a component in a
    test browser. That the button in the SHIPPED app is dark with an empty box, says why, and lights
    on one character is step `11g` and only step `11g`.
  * ⛔ **The `canAttach: false` half of the sentence.** Both shipped mounts pass `true`, so the
    branch has no production caller — `M8` kills its wording, and nothing here can show a mount that
    switches attaching off, because there is not one.
  * ⚠️ **Collateral damage in `scripts`.** 223 edits `ui-live-smoke.mjs` (step `11g`'s claims) and
    this table does not run that project; `221`'s `M28` is the row that owns that step's shape.
"""

from pathlib import Path

COMPOSER = "apps/desktop/src/renderer/src/components/PromptComposer.vue"
SHARED = "apps/desktop/src/shared/runtime-ipc.ts"
FOLDER_GATE = "apps/desktop/test/dom/folder-gate.dom.test.ts"
PROFILE_PICKER = "apps/desktop/test/dom/profile-picker.dom.test.ts"
LAUNCH_DRAFT = "apps/desktop/test/dom/launch-draft.dom.test.ts"
CENSUS = "apps/desktop/test/send-rule-consumers.test.ts"
NOTHING_TO_SEND_TEST = "apps/desktop/test/dom/nothing-to-send.dom.test.ts"
STORE = "apps/desktop/src/renderer/src/lib/session-store.ts"
WIRE = "apps/desktop/src/main/runtime/ipc.ts"

# The computed 223 put between the button and the rule both send paths run through.
CAN_SEND_NOW = "  canSend(text.value, props.state, props.blocked, staged.value.length),\n)"

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- §1/§2 · the button ----------------------------------------------------------------------
    (
        "M1 · ⛔ THE DEFECT · the button goes back to `!canType || blocked !== null`, so Send is lit "
        "and inert on an empty box — 221's measurement, put back",
        [(COMPOSER, ':disabled="!canSendNow"', ':disabled="!canType || blocked !== null"')],
    ),
    (
        "M2 · …and the opposite: the button ignores CONTENT the other way and is dark even with "
        "words in the box — 118's 'there is no later', which is worse than a lit dead control",
        [(COMPOSER, ':disabled="!canSendNow"', ':disabled="true"')],
    ),
    (
        "M3 · ⛔ 221 §6 REVERSED · the computed stops counting attachments, so an attachment-only "
        "message is refused again and a working feature hides behind a dead control",
        [(COMPOSER, CAN_SEND_NOW, "  canSend(text.value, props.state, props.blocked, 0),\n)")],
    ),
    (
        "M4 · the shared predicate stops trimming, so a message of nothing but spaces lights Send "
        "and starts a turn — 077's rule enforced in letter and not in fact (221's second half)",
        [
            (
                SHARED,
                "  return text.trim() !== '' || attached > 0",
                "  return text !== '' || attached > 0",
            )
        ],
    ),
    # ---- §4 · the sentence and its precedence -----------------------------------------------------
    (
        "M5 · ⛔ 169 · the dark button's tooltip says `Send` again, so the control is refused and "
        "unexplained — 106 exactly, on the state a person meets first",
        [
            (
                COMPOSER,
                "  return nothingToSendYet(props.canAttach)",
                "  return null",
            )
        ],
    ),
    (
        "M6 · 🔴 the EMPTY-BOX sentence outranks `blocked`, so a superseded sign-in is answered with "
        "'type a message' — the one action that cannot possibly help (219 §1, reversed)",
        [
            (
                COMPOSER,
                "  if (canSendNow.value) return null\n  if (props.blocked !== null) return props.blocked\n",
                "  if (canSendNow.value) return null\n  if (!hasSomethingToSend(text.value, props.attachments.length))\n    return nothingToSendYet(props.canAttach)\n  if (props.blocked !== null) return props.blocked\n",
            )
        ],
    ),
    (
        "M7 · the sentence stops naming the ACTION and names the state instead, so a dark button "
        "says what is wrong and not what would fix it (118's 'there IS a later')",
        [
            (
                SHARED,
                "  return canAttach ? 'Type a message, or attach a file, to send' : 'Type a message to send'",
                "  return canAttach ? 'Nothing to send' : 'Nothing to send'",
            )
        ],
    ),
    (
        "M8 · the sentence names attaching on a mount that does not offer it — 106 one layer down, "
        "in the prose: a way forward that is not there",
        [
            (
                SHARED,
                "  return canAttach ? 'Type a message, or attach a file, to send' : 'Type a message to send'",
                "  return 'Type a message, or attach a file, to send'",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Deleted on purpose. The `props.state
        # === 'ended'` clause and its sentence ('reopen it under CLOSED_CONVERSATIONS in the
        # sidebar…') are gone from PromptComposer.vue, along with the 'ended' ComposerState and the
        # CLOSED_CONVERSATIONS import. D-017b: 'Sending continues it: the first message goes through
        # startAndSend, which attaches, claims or reopens it and sends in one act'. The diff comment
        # says there is no ended conversation and every one takes a message. Its anchor is left
        # stale, so the census records it retired.
        "M17 · ⛔ THE REGRESSION 223 INTRODUCED AND AN ADVERSARIAL PASS CAUGHT · the state clause "
        "loses its sentence, so a dark Send on an ENDED conversation tells you to type into a locked "
        "box and to use a paperclip the same render disabled — 118's 'there IS a later', reversed",
        [
            (
                COMPOSER,
                # ⚠️ **672 · re-anchored** — the sentence names the rail's own heading now
                # (`CLOSED_CONVERSATIONS`); the clause losing its sentence is the same defect.
                "  if (props.state === 'ended')\n    return `This conversation has ended — reopen it under ${CLOSED_CONVERSATIONS} in the sidebar to carry on (its row says why if it cannot be)`\n",
                "",
            )
        ],
    ),
    # ---- §3 · the isolation is the finding, so it has to be killable ------------------------------
    (
        "M9 · ⛔ §3 · the FOLDER tests lose their prompt, so every 'this folder blocks Send' "
        "assertion passes with the folder gate deleted — the entanglement 216 and 221 both hit",
        [(FOLDER_GATE, "  draft: 'hello',", "  draft: '',")],
    ),
    (
        "M10 · ⛔ §3 · the same for the NAME tests — 169 §1's corpus goes back to measuring its own "
        "gate AND the absence of a content gate in one assertion",
        [(PROFILE_PICKER, "  draft: 'hello',", "  draft: '',")],
    ),
    (
        "M11 · ⛔ §3 · the one the census found beyond the nine · a restored folder that no longer "
        "exists is asserted to disable Send with an EMPTY box — green with the folder check deleted. "
        "⚠️ SURVIVED its first run: removing a draft only WEAKENS a test, and a weaker expect still "
        "passes. It is killable because each of these files now asserts its own non-vacuity",
        [
            (
                LAUNCH_DRAFT,
                "    const held: Held = { launch: null, draft: 'carry on with this' }",
                "    const held: Held = { launch: null, draft: '' }",
            )
        ],
    ),
    (
        "M12 · ⛔ the 'type, then read the button' instrument stops TYPING — the trap 223 fell into "
        "writing this file, and it turns every one of those tests into a test of the initial state",
        [
            (
                NOTHING_TO_SEND_TEST,
                "  box.dispatchEvent(new Event('input', { bubbles: true }))\n  await nextTick()\n}",
                "  await nextTick()\n}",
            )
        ],
    ),
    # ---- §5 · the census that stops the drift -----------------------------------------------------
    (
        "M13 · ⛔ the renderer STORE drops its early-out, so a dead send reaches the wire again — and "
        "the census is what catches it, because an IMPORT is not a call",
        [
            (
                STORE,
                "      if (!hasSomethingToSend(text, attachments.length)) return true",
                "      if (false) return true",
            )
        ],
    ),
    (
        "M14 · ⛔ the WIRE's shaped schema stops refining, so `text: z.string()` accepts a message "
        "with no words and nothing attached — 221's defect with the bound removed instead of shared",
        [
            (
                WIRE,
                "    .refine((command) => hasSomethingToSend(command.text, command.attachments?.length ?? 0), {",
                "    .refine(() => true, {",
            )
        ],
    ),
    (
        "M15 · the census's comment stripper is disarmed, so a rule MENTIONED in prose counts as a "
        "rule asked — 206 H1's own failure mode, in the instrument built to avoid it",
        [(CENSUS, "        if (rest.startsWith('//')) break", "        if (false) break")],
    ),
    # ---- re-anchored, and RE-RUN ------------------------------------------------------------------
    (
        "M16 · ⚑ 169 M1 AND 219 M8, re-anchored and re-run · the button stops reading `blocked`, so "
        "Send is lit over `../../escape` and over a superseded sign-in again",
        [(COMPOSER, CAN_SEND_NOW, "  canSend(text.value, props.state, null, staged.value.length),\n)")],
    ),
]


def apply(root, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = Path(root) / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)")
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace))
    return bad


def main() -> int:
    import sys

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
