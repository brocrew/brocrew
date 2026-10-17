#!/usr/bin/env python3
"""219's mutation table — each row is THE DEFECT, put back verbatim (131).

`217` §9 asked the PM's question — *"is there any OTHER control on one composer and not the
other?"* — and found one pointing the opposite way to its own subject: ⛔ **`ConversationPane` never
passed `blocked`**, so it defaulted to `null` and Send was lit in every state the composer believed
was idle. The pane KNOWS the fact (`signInSuperseded`) and already gates its OTHER send control on
it (`canGoAhead`, since `149`). The composer was the one send path left un-gated, and the one with a
prop built for the job.

The rows fall into six groups:

  * `M1`-`M5c`  §1/§2 · the gate itself, and the three ways to get it wrong in the other direction
    — never blocked, always blocked, blocked in states whose own sentence is better. ⚑ **`M5b`/`M5c`
    are the SECOND finding**, which §2's enumeration turned up and the self-review made me act on:
    a conversation being closed had the identical defect.
  * `M6`-`M10`  §1 · what `blocked` does once it arrives: the button, its title, the hint, and ⛔
    **the busy branch, which is the second defect `219` found — in its own diff**.
  * `M11`-`M14` §1 · the SENTENCE. Not the host's exception text, not the bar's, names the remedy,
    claims no account.
  * `M15`-`M20` §2 · the knowable-or-not table and the census that keeps it honest, including
    ⛔ **`M18b`, which restores the verdict this dispatch got WRONG on its first pass** — the
    strongest row in the table, because it is the mistake that actually happened.
  * `M21`-`M24` §3 · prop and event parity across the two mounts, in both directions.
  * `M25`       the smoke's claim shape for step 47.

⚠️ **28 rows.** `M5b`, `M5c` and `M18b` carry suffixes rather than renumbering their neighbours,
which is `218`'s `M6b` idiom: a row added by a review pass says so in its own name.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

  * ⛔ **A REAL superseded sign-in.** `checkSignIn` compares the credential fingerprint injected at
    launch against a live `security find-generic-password` read, so producing the state means
    changing the machine's shared Claude Keychain item — one 8-hour token every Claude client on the
    machine holds. Every row below drives it as a `liveness.signInSuperseded` flag on a fixture
    record, which is all the renderer ever sees of it. `packages/runtime`'s own
    `sign-in-supersede.test.ts` covers the adapter half, and `219` acceptance 8 records that a live
    step cannot reach this at all.
  * ⛔ **The order of the host's gate chain.** `M15`-`M17` census `runtime-host.ts` as SOURCE.
    A gate MOVED between two methods that both still throw would leave every count correct; what
    catches that is the chain assertion in `send-refusals.test.ts`, which is itself a source check.
    The behavioural half is `sign-in-supersede.test.ts`, which drives the host.
  * ⛔ **Whether the sentence READS well.** Four rows check what it must not be and what it must
    contain. Nothing here can tell a good sentence from a grammatical one.
  * ⛔ **`packages/runtime`.** No row touches it, and no `runtime` test imports a file this commit
    changes — so the project is not run. The one `packages/` edit in this commit is a per-test
    timeout, which asserts nothing.

⚠️ **Anchors are taken from the FORMATTED source** — `147`'s M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. These were taken after `format` ran.

⛔ **Do not apply these by hand** — `mutate.sh` owns the tree, takes `196`'s repository-global lock,
and restores from a pristine copy keyed by FULL relative path.
"""

from __future__ import annotations

from pathlib import Path

PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
COMPOSER = "apps/desktop/src/renderer/src/components/PromptComposer.vue"
REFUSALS = "apps/desktop/src/renderer/src/lib/send-refusals.ts"
LAUNCHER = "apps/desktop/src/renderer/src/components/NewConversation.vue"
IPC = "apps/desktop/src/shared/runtime-ipc.ts"
CENSUS = "apps/desktop/test/send-refusals.test.ts"
PARITY = "apps/desktop/test/composer-parity.test.ts"
SMOKE = "scripts/ui-live-smoke.mjs"

SENTENCE = "'No message can go out on the sign-in this conversation is holding — reopen it on the current one, above.'"

MUTATIONS = [
    # ------------------------------------------------- §1 · the gate, and its two opposite defects
    (
        # ⚑ Re-anchored by 234 §2 (M1 and M5c): `sendBlocked` gained a line — `closing` outranks a
        # FROZEN composer now (`228` M2), and `ended` keeps its own sentence — so the three-line body
        # these rows quote reads in a different order. Both rules are unchanged. 234 re-runs them.
        "M1 · 🔴 §1 · THE DEFECT, verbatim: the pane computes a reason and never has one — which is "
        "the state 217 §9 found, where Send is lit and full-accent in a conversation the host will "
        "refuse, and the press hands the words back with a red error",
        [
            (
                PANE,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 714 — `708` H-3a: a third reason (a command with
                # files) follows the sign-in's; the defect planted is unchanged — no reason, ever.
                "  if (props.record.phase === 'closing') return CLOSING_BLOCK\n"
                "  if (composerState.value !== 'idle' && composerState.value !== 'busy') return null\n"
                "  if (signInSuperseded.value) return SIGN_IN_SUPERSEDED_BLOCK\n"
                "  const command = aCommandInTheBox(props.draft, control.value.commands)\n"
                "  return command === null || props.handing.staged.length === 0\n"
                "    ? null\n"
                "    : aCommandTakesNoAttachmentsYet(command)",
                "  return null",
            )
        ],
    ),
    (
        "M2 · 🔴 §1 · the computed is right and the pane never hands it over — the same defect one "
        "line further out, and the one a source census of the MOUNT is what catches",
        [(PANE, '          :blocked="sendBlocked"\n', "")],
    ),
    (
        "M3 · ⛔ §1 · THE OPPOSITE DEFECT (118): every conversation is blocked, including the ones "
        "that would have worked — a control disabled for a state that was fine",
        [
            (
                PANE,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 714 — `708` H-3a: the sign-in's reason is a line of
                # its own now; the defect planted is unchanged — every conversation is blocked.
                "  if (signInSuperseded.value) return SIGN_IN_SUPERSEDED_BLOCK\n",
                "  return SIGN_IN_SUPERSEDED_BLOCK\n",
            )
        ],
    ),
    (
        "M4 · ⛔ §1 · the reason displaces a BETTER sentence: `blocked` outranks every state hint, so "
        "a card waiting to be answered stops saying so and an ended conversation stops saying it is "
        "over — 147's acceptance 7 is the other instrument that catches this",
        [
            (
                PANE,
                "  if (composerState.value !== 'idle' && composerState.value !== 'busy') return null\n",
                "",
            )
        ],
    ),
    (
        "M5 · ⛔ §1 · the gate is narrowed to `idle`, so a RUNNING turn is un-gated again — the host "
        "refuses a queue on the same credential (`assertCanTakeTurn(session, 'queue')`), so ⌘↵ over "
        "a superseded sign-in goes back to being a press that cannot work",
        [
            (
                PANE,
                "  if (composerState.value !== 'idle' && composerState.value !== 'busy') return null",
                "  if (composerState.value !== 'idle') return null",
            )
        ],
    ),
    (
        "M5b · 🔴 §2 · ⚑ THE SECOND FINDING, reverted verbatim: a conversation being CLOSED stops "
        "gating its composer. The header plate beside it draws the word `closing` from the same "
        "`record.phase`, and Send sits lit next to it until the press comes back *\"cannot send: "
        "session ... is still closing\"* — 217 §9's defect, one fact over, found by 219 §2's own "
        "enumeration",
        [
            (
                PANE,
                "  if (props.record.phase === 'closing') return CLOSING_BLOCK\n",
                "",
            )
        ],
    ),
    (
        "M5c · ⛔ §2 · the two reasons swap precedence, so a conversation on its way out is told to "
        "reopen on the current sign-in — a remedy that cannot save THIS session, which is 118's "
        "*\"there is no later\"* wearing an actionable-looking sentence",
        [
            (
                PANE,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 714 — `708` H-3a: the sign-in's reason is a line of
                # its own now, with the command's after it; the defect planted is unchanged — the
                # sign-in and the close swap places.
                "  if (props.record.phase === 'closing') return CLOSING_BLOCK\n"
                "  if (composerState.value !== 'idle' && composerState.value !== 'busy') return null\n"
                "  if (signInSuperseded.value) return SIGN_IN_SUPERSEDED_BLOCK\n",
                "  if (composerState.value !== 'idle' && composerState.value !== 'busy') return null\n"
                "  if (signInSuperseded.value) return SIGN_IN_SUPERSEDED_BLOCK\n"
                "  if (props.record.phase === 'closing') return CLOSING_BLOCK\n",
            )
        ],
    ),
    # ------------------------------------------------------- §1 · what `blocked` does once it lands
    (
        "M6 · 🔴 §1 · the reason is EMPTY: the button still greys, and there is nothing to read — "
        "118's whole point, since a greyed control with no later is the thing being removed",
        [(REFUSALS, SENTENCE, "''")],
    ),
    (
        # ⚑ Re-anchored by 234 §2: the busy selector asks `busyChoices` now — one predicate instead
        # of `state === 'busy' && text.trim() !== '' && blocked === null` — because the middle clause
        # was a fourth transcription of the send rule (`227` M4 / `228` M1). The mutant is the same
        # defect: the branch without its `blocked` guard. 234's table re-runs it (M19).
        "M7 · ⛔ §1 · ⚑ THE SECOND DEFECT, found in 219's own diff: the busy branch loses its guard, "
        "so `queue-prompt` and `interrupt-send-prompt` are lit, full-accent, and pressing either "
        "does NOTHING AT ALL — no message, no error, because `canSend` refuses them silently",
        [
            (
                COMPOSER,
                "<template v-if=\"busyChoices\">",
                "<template v-if=\"state === 'busy' && text.trim() !== ''\">",
            )
        ],
    ),
    (
        "M8 · 🔴 §1 · the Send button stops reading `blocked` — the four jobs 217 named, minus the "
        "first one a person meets",
        [
            # ⚑ **Re-anchored by 223**, which moved this `:disabled` onto `!canSendNow`. ⛔ **The
            # defect is unchanged** — the button stops reading `blocked` — and it is the SAME edit
            # `169` M1 makes, so 223 carries it once and re-runs it there.
            (
                COMPOSER,
                "  canSend(text.value, props.state, props.blocked, staged.value.length),\n)",
                "  canSend(text.value, props.state, null, staged.value.length),\n)",
            )
        ],
    ),
    (
        "M9 · ⛔ §1 · the button is dark and its tooltip still says `Send` — the refusal is enforced "
        "and unexplained, which is 106 exactly",
        [
            (
                COMPOSER,
                "            blocked !== null\n              ? blocked\n",
                "            blocked !== null\n              ? `Send (${sendKey})`\n",
            )
        ],
    ),
    (
        "M10 · ⛔ §1 · the foot stops rendering the reason, so the only place the sentence appears is "
        "a tooltip — invisible to anyone who does not hover the thing they already cannot press",
        [
            (
                COMPOSER,
                '<template v-if="blocked !== null">{{ blocked }}</template>',
                '<template v-if="false">{{ blocked }}</template>',
            )
        ],
    ),
    # --------------------------------------------------------------------- §1 · the sentence itself
    (
        "M11 · 🔴 §1 · the host's exception text is forwarded raw to the surface — 202 §3 had to "
        "unpick exactly this class, and the dispatch names it",
        [
            (
                REFUSALS,
                SENTENCE,
                "'cannot send: this conversation is holding the Claude sign-in it started with, and "
                "your machine has moved on to a different one since — a renewal counts. Nothing has "
                "been sent.'",
            )
        ],
    ),
    (
        "M12 · ⛔ §1 · the composer reprints the BAR's opening clause, which is on screen at the same "
        "moment by construction — 085's *\"one refusal rendered twice\"*",
        [
            (
                REFUSALS,
                SENTENCE,
                "'This conversation is holding the Claude sign-in it started with, and your machine "
                "has moved on to a different one. A renewal counts.'",
            )
        ],
    ),
    (
        "M13 · ⛔ §1 · the sentence says what is wrong and names no way out — 106's *\"no control "
        "that cannot act\"*, with the reason but not the later",
        [(REFUSALS, SENTENCE, "'No message can go out on the sign-in this conversation is holding.'")],
    ),
    (
        "M14 · 🔒 §1 · the sentence claims WHICH account, which the app cannot know: the Keychain "
        "blob carries no identity at all (147 §1, re-measured in 149), so this is 039's invented fact",
        [
            (
                REFUSALS,
                SENTENCE,
                "'You are now signed in as a different account — reopen it on the current one, above.'",
            )
        ],
    ),
    # -------------------------------------------------------- §2 · the table, and its census's teeth
    (
        "M15 · 🔴 §2 · the row for the one refusal this window CAN see says it can never see it — a "
        "table that has stopped describing the code is worse than no table",
        [
            (
                REFUSALS,
                "    hostSays: 'sign-in it started with',\n    knowable: 'first-press',",
                "    hostSays: 'sign-in it started with',\n    knowable: 'never',",
            )
        ],
    ),
    (
        "M16 · ⛔ §2 · a refusal is dropped from the table, so the host throws seven times and the "
        "list accounts for six — the exact drift the census exists to catch",
        [
            (
                REFUSALS,
                "    id: 'still-closing',\n    thrownBy: 'assertAcceptsMessages',",
                "    id: 'still-closing-DROPPED',\n    thrownBy: 'send',",
            )
        ],
    ),
    (
        "M17 · ⛔ §2 · a row points at a line that is not in the method it names — the row reads "
        "true and is about nothing, which is how a doc rots without saying so",
        [
            (
                REFUSALS,
                "    hostSays: 'this conversation is over',",
                "    hostSays: 'this conversation has finished',",
            )
        ],
    ),
    (
        "M18 · ⛔ §2 · a `closing` disclosure is added to `SessionLiveness`, so the renderer would have "
        "TWO answers to one question — the phase it wrote itself and a field the host publishes. "
        "That is the drift 064 and 099 are both about, and the table pins its absence rather than "
        "remembering it",
        [
            (
                IPC,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 5ae6a3206 added provider-block facts ahead of state; the same interface still must not carry a second closing flag.
                "export interface SessionLiveness {\n",
                "export interface SessionLiveness {\n  closing?: boolean\n",
            )
        ],
    ),
    (
        "M18b · ⛔ §2 · the `still-closing` verdict goes back to `never` — the answer 219 §2 gave on "
        "its FIRST pass and the self-review overturned. It reads plausible (the host holds `closing`, "
        "no disclosure carries it) and it is wrong: the renderer writes that phase itself, before it "
        "awaits (089). A table this confidently wrong is worse than no table",
        [
            (
                REFUSALS,
                "    id: 'still-closing',\n    thrownBy: 'assertAcceptsMessages',\n    knowable: 'before',",
                "    id: 'still-closing',\n    thrownBy: 'assertAcceptsMessages',\n    knowable: 'never',",
            )
        ],
    ),
    (
        "M19 · ⛔ §2 · the census's slice runs past the end of each method, so every 'body' is most "
        "of the class and every throw count is wrong — caught by the non-vacuity floor rather than "
        "by the rule, which is what that floor is for",
        [(CENSUS, "  const to = source.indexOf('\\n  }', from)", "  const to = source.indexOf('\\n}', from)")],
    ),
    (
        "M20 · ⛔ §2 · the census stops counting throws at all, so every method matches a table of "
        "any size — the silent-zero failure that 216 M11 taught this suite to fear",
        [(CENSUS, "  return body.match(/\\bthrow\\b/g)?.length ?? 0", "  return body.match(/\\bthrowz\\b/g)?.length ?? 0")],
    ),
    # --------------------------------------------------------------- §3 · parity, in both directions
    (
        "M21 · 🔴 §3 · the LAUNCHER loses `blocked` — 217 §9's defect pointing the other way, and "
        "the direction a test written only about the pane would never have seen",
        [(LAUNCHER, '      :blocked="launchBlocked"\n', "")],
    ),
    (
        "M22 · ⛔ §3 · the launcher stops listening for `@update:attachments` — 216's actual shipped "
        "defect, restored: every path a person staged there is cleared and thrown on the floor",
        [
            (
                LAUNCHER,
                '      @update:attachments="(handed) => emit(\'update:attachments\', handed)"\n',
                "",
            )
        ],
    ),
    (
        "M23 · ⛔ §3 · the parity extractor reports every prop as supplied by every mount — the "
        "DANGEROUS parser failure, because it makes the file green forever rather than loud",
        [
            (
                PARITY,
                "    if (sigil === '@') emits.add(name!)\n    else if (name !== 'key') props.add(camel(name!))",
                "    if (sigil === '@') emits.add(name!)\n    else if (name !== 'key') props.add(camel(name!))\n    for (const every of ['state', 'draft', 'blocked', 'placeholder', 'hasQueued', 'who', 'cwd', 'attachments', 'canAttach', 'interruptible']) props.add(every)",
            )
        ],
    ),
    (
        "M24 · ⛔ §3 · a deliberate difference names the WRONG mount, so the exemption stops being "
        "about the thing it excuses — an exemption that cannot go stale is the only kind worth having",
        [
            (
                PARITY,
                "  placeholder: {\n    withheldBy: 'pane',",
                "  placeholder: {\n    withheldBy: 'launcher',",
            )
        ],
    ),
    # ------------------------------------------------------------------------ the smoke's claim shape
    (
        "M25 · ⛔ · step 47 reports a bare sentence instead of per-claim verdicts, so a live step can "
        "go green while asserting nothing (209 §9, 206 H1)",
        [
            (
                SMOKE,
                "    return claims(\n      asserted(\n        `1 · the composer accepted typing WHILE a real turn ran",
                "    return (\n      `ASSERTED: ` +\n      (\n        `1 · the composer accepted typing WHILE a real turn ran",
            )
        ],
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
