#!/usr/bin/env python3
"""
171 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

⛔ **Do not apply these by hand.** 157's dry-run corrupted three source files that way, and 166's
"safe" replacement corrupted the tree a second time because the restore loop was written for bash
word-splitting in a zsh shell. The pristine copy and the trap in `mutate.sh` are why this one cannot.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. Every anchor below was copied out of
the tree after `prettier --check` reported it clean.

## What the table is about

⛔ **This is a VOCABULARY dispatch, so most of the table mutates SENTENCES.** That is not a weaker
kind of mutation here — it is the subject. 168 H1 is a comment that stated a machine fact nobody had
measured (*"Bash raises a card in every mode"*), and 142 §5's rule is that such a comment is worse
than none, because the next reader takes it for a measurement. A table that only mutated logic would
be checking the half of this dispatch that did not change.

⛔ **M1–M4 are the behaviour the new sentences describe.** M1 is the refusal message's own
overstatement. M2–M4 are the three doors the pair test walks — the hook's yield in `auto`, the
callback's early return, and the wide-scan deny that survives both — because "not carded in yolo"
and "refused in ask with nothing to click" are claims about a route, not about one function.

⛔ **M5–M8 are §2, the name.** The label is composed in two places by design (the host owns the
provider-specific sentence; the renderer owns the pill), so the shared constant, the host's own
wording and each surface are mutated separately. A single mutation of `YOLO_LABEL` reddening
everything would not tell us that any given surface had its own assertion.

⛔ **M9–M13 are §3, the sentence and where it renders.** Both surfaces that choose the mode, the
pending case, the wording itself, and the tooltip that had outlived its own truth.

## ⛔ What this table does NOT cover, said out loud rather than left to be assumed

 1. **The corrected COMMENTS themselves** — `confinement.ts`'s scan doc, the guard hook's, the four
    §4 descriptions. A comment cannot be mutated into a red test, and pretending otherwise with a
    source-text assertion would pin prose that is meant to be rewritten when it stops being true.
    What CAN be pinned is the behaviour they now describe correctly, and that is M1–M4.
 2. **The `ask`-mode Bash card.** The corrected sentence says a `Bash` command in `ask` still reaches
    the card. That route is `handleCanUseTool`'s ordinary path and is already covered by this repo's
    permission tests; nothing 171 wrote is the reason it holds.
 3. **`cli-equivalence.test.ts`'s corrected title and comment.** Same reason as 1 — the assertions in
    that test are unchanged and were already covered by 160's table.
 4. **The enum.** `auto` is deliberately untouched (033/078 — it is persisted and travels the IPC),
    so there is no change there to mutate.

## 🔴 499 · `M10` RETIRES, and it is NOT corrected — this table is `complete`

⛔ **`HO-037` §1 ruled a third clause into the drawer's yolo paragraph** — *"agents this conversation
creates run in this mode too, and on Codex that also removes the sandbox"* — and `M10`'s anchor is
the WHOLE `<p>` element, closing tag included. ⚠️ **There is no placement inside that paragraph which
preserves it**, and placing the sentence outside it would have been a second block, which is the wall
of caveats `031` rates as worse than nothing and which `yolo-disclosure.dom.test.ts` asserts against
by counting lines.

🔴 **So it is retired rather than re-aimed, and the reason is the run state.** `171` is
`complete` with fourteen recorded verdicts. ⛔ **A corrected anchor keeps a verdict it never
earned** — the artefact would go on attesting a RED that was measured against bytes this commit does
not contain — and the census says so in its own header: *"it does not re-attest that an old RED is
semantically valid."* ⚑ **Correcting an anchor is free; correcting one on a RUN table is a
laundered verdict**, and that is the one thing this harness cannot detect for itself.

⚠️ **What the rule it carried now rests on instead**, so the loss is named rather than silent:
`yolo-disclosure.dom.test.ts` §3 asserts the paragraph is present, visible, one line, and made of
exactly its three named spans and nothing else — which is `M10`'s claim (*Controls stops saying it*)
plus two more. ⛔ It is an assertion and not a mutation row, and that is strictly weaker; the honest
replacement is a re-run of this table, which `499` did not perform.
"""

import sys
from pathlib import Path

CONFINEMENT = "packages/runtime/src/internal/confinement.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
IPC = "apps/desktop/src/shared/runtime-ipc.ts"
COPY = "apps/desktop/src/renderer/src/lib/approval-mode.ts"
HEADER = "apps/desktop/src/renderer/src/components/SessionHeader.vue"
CONTROLS = "apps/desktop/src/renderer/src/components/SessionControls.vue"
LAUNCHER = "apps/desktop/src/renderer/src/components/NewConversation.vue"

# There is no wide-scan deny hook to mutate. The row retains its absent anchor and is recorded
# retired because the planted behavior is now intended.
MUTATIONS = [
    # ---- §1 · the sentence, and the three doors it describes -------------------------------------
    (
        "M1 · ⛔ 171 §1 · the refusal message goes back to claiming the DIRECTORY is unreachable — "
        "*'The app refuses its own data directory to every session, in every mode'* — which a Bash "
        "command walks past in either mode",
        [
            (
                CONFINEMENT,
                "    `A tool call naming it is refused to every session, in every mode.`\n",
                "    `The app refuses its own data directory to every session, in every mode.`\n",
            )
        ],
    ),
    (
        "M2 · 🔴 168 H1 · the guard hook stops yielding in `auto` and forces a card instead (080's "
        "defect) — so the uncarded route the corrected comment describes is no longer what happens · "
        "⚑ REPLACEMENT CORRECTED IN PLACE BY 700: `askFor` takes a key of `WHY_THIS_GUARD_ASKS` since "
        "700, so the same ask with the same sentence is spelled `askFor('consequential')` · ⚑ "
        "REPLACEMENT CORRECTED IN PLACE BY 728: R93 removed that sentence with the ask it gave, so the "
        "forced card is spelled with the one the hook still has, `askFor('questions')`",
        [
            (
                CLAUDE,
                "            if (isAutoApprove({ approvalMode: effectiveMode() })) return { continue: true }\n",
                "            if (isAutoApprove({ approvalMode: effectiveMode() }))\n"
                "              return askFor('questions')\n",
            )
        ],
    ),
    (
        "M3 · 🔴 the callback's auto-approve early return is removed, so a yielded call in yolo "
        "reaches the card composer — the SECOND door, and the one the hook alone cannot prove shut",
        [
            (
                CLAUDE,
                # ⚑ **728 · re-anchored in place, not retired** — 728 (R93) stands the early return aside while planning, where the CLI's own plan mode asks; the row still removes it for every other yielded call in yolo
                "    if (isAutoApprove({ approvalMode: this.approvals.effective }) && !this.planning) {\n      return { behavior: 'allow' }\n    }\n",
                "",
            )
        ],
    ),
    (
        "M4 · 🔴 the wide-scan deny is removed from the hook, so the PAIRED POSITIVE goes — a "
        "structured tool naming the app's own data stops being refused in `ask`",
        [
            (
                CLAUDE,
                "            if (scan.refused.length > 0) return denyFor(refusalMessage(scan.refused))\n",
                "",
            )
        ],
    ),
    # ---- §2 · the name -------------------------------------------------------------------------
    (
        "M5 · ⛔ 171 §2 · the shared label goes back to `AUTO`, the name the Claude CLI gives an "
        "allowlist that grows by consent",
        [(IPC, "export const YOLO_LABEL = 'YOLO'\n", "export const YOLO_LABEL = 'AUTO'\n")],
    ),
    (
        "M6 · the host's own wording goes back to `— no prompts`, which describes the app's cards "
        "and stops there — the reading that let 168 H1 stand for three dispatches",
        [
            (
                HOST,
                "    ? `⚠ approvals: Auto — nothing is asked · sandbox OFF`\n    : `⚠ approvals: Auto — nothing is asked`\n",
                "    ? `⚠ approvals: Auto — no prompts · sandbox OFF`\n    : `⚠ approvals: Auto — no prompts`\n",
            )
        ],
    ),
    (
        "M7 · the pending disclosure uses legacy YOLO instead of Ask/Auto; "
        "the approved 0.1.3 words replace YOLO. Host proof UNRUN on the new wording.",
        [
            (
                HOST,
                "        : `${note} · ${requested === 'auto' ? 'Auto' : 'Ask'} from your next message`,\n",
                "        : `${note} · ${requested === 'auto' ? 'YOLO' : 'Ask'} from your next message`,\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING:** the bar's mark says Ask or Auto now, so the word YOLO this row guards is gone by design (daa7c0144, the approved first-run design).
        "M8 · the header pill goes back to `AUTO · unattended` — `unattended` says who is watching, "
        "which is not what a reader needs to know about this mode. "
        "⚑ ANCHOR CORRECTED IN PLACE BY 579 relay 3b, TWICE OVER: the mark MOVED from the warnings "
        "band onto the bar (two spaces of indentation) and its two clauses were removed on the person's "
        "instruction — *\"it should only say YOLO\"*. ⛔ **The row's own rule is untouched**: it is "
        "about the WORD, `171 §2`'s `YOLO` rather than the Claude CLI's `AUTO`, and that word is "
        "still what the mark renders and what two live smoke steps read with `/YOLO/`. "
        "🔴 RE-VERIFIED BY HAND AT 579: applied alone, RED 5 of 61 across "
        "`conversation-chrome.render.test.ts`, `the-conversation-header.test.ts` and "
        "`dom/a-mode-that-says-what-it-does.dom.test.ts`; restored from bytes and hash-checked",
        [
            (
                HEADER,
                # ⚠️ **CORRECTED by 367, not retired.** The pill gained a second clause — the reach —
                # and this row is still about the first: `AUTO · unattended` is the wording 171 took
                # off it, and the whole line has to be the replacement because the anchor is the line.
                '        <span class="dot"></span>{{ YOLO_LABEL }}\n',
                '        <span class="dot"></span>AUTO · unattended\n',
            )
        ],
    ),
    # ---- §3 · the sentence, and where it renders ------------------------------------------------
    (
        "M9 · ⛔ 171 §3 · the launcher stops saying what yolo means, so the consequence is stated "
        "nowhere a user meets the choice at creation",
        [
            (
                LAUNCHER,
                # ⚠️ **CORRECTED by 367.** The paragraph is a block now, because it carries the
                # provider's own half beside 171's shared one — inside ONE wrapper span, which is
                # `367` M18's subject: `.note` is `display: flex`, so a bare second child renders as
                # a second column. Deleting the whole block is still the mutation this row
                # describes: the launcher stops saying what yolo means.
                '          <p v-if="yolo" class="note warn" data-cy="yolo-means">\n'
                "            <span\n              >{{ YOLO_MEANS }}\n"
                '              <span v-if="yoloReach" data-cy="yolo-reach">{{ yoloReach }}</span></span\n'
                "            >\n          </p>\n",
                "",
            )
        ],
    ),
    (
        "M10 · Controls stops saying it, so a conversation switched to yolo mid-flight is never "
        "told what it was switched to",
        [
            (
                CONTROLS,
                # ⚠️ **CORRECTED by 367** — same edit as M9, one surface along.
                '      <p\n        v-if="(session.pendingApprovalMode ?? session.approvalMode) === \'auto\'"\n'
                '        class="note"\n        data-cy="yolo-means"\n      >\n        {{ YOLO_MEANS }}\n'
                '        <span v-if="yoloReach" data-cy="yolo-reach">{{ yoloReach }}</span>\n      </p>\n',
                "",
            )
        ],
    ),
    (
        "M11 · Controls waits for the turn to ADOPT the switch before saying anything, so the "
        "consequence arrives after the decision rather than with it",
        [
            (
                CONTROLS,
                "        v-if=\"(session.pendingApprovalMode ?? session.approvalMode) === 'auto'\"\n",
                "        v-if=\"session.approvalMode === 'auto'\"\n",
            )
        ],
    ),
    (
        "M12 · the sentence stops naming the CLIs' own flags and stops naming what is reachable — "
        "the vague version, which is the one a Claude Code user reads as the accumulating 'Auto'",
        [
            (
                COPY,
                # ⚑ **728 · re-anchored in place, not retired** — 728 (R93) says the planning exception in the same sentence; the row's subject is unchanged
                "  'Yolo is what the CLIs call --dangerously-skip-permissions and --yolo: nothing is asked — except ' +\n  'what a CLI’s own plan mode still asks while it plans — and a ' +\n  'command it runs can reach anything you can — this app’s own data, the other profiles’ homes ' +\n  'and the sign-ins kept in them included.'\n",
                "  'Yolo means the agent does not ask before it acts.'\n",
            )
        ],
    ),
    (
        "M13 · the launcher's tooltip goes back to *'Fixed when the session starts'*, which 034 "
        "made false and nobody revisited — a permanent choice a button on the next screen changes",
        [
            (
                LAUNCHER,
                # ⚠️ **CORRECTED by 367, not retired.** The tooltip's second clause used to name
                # Codex — a claim about one provider shown on both — and `367` replaced it with the
                # one true of both, because the differing half now renders on the page. This row is
                # about the THIRD clause, *"Changeable later"*, and it still is.
                '              title="Yolo: the agent runs commands and edits files without asking, and nothing this app configures confines them. Changeable later, from Controls, from your next message on."\n',
                '              title="Auto-approve everything: the agent runs commands and edits files without asking. Codex also drops its sandbox. Fixed when the session starts."\n',
            )
        ],
    ),
    (
        "M14 · a session in a LIST reports the ENUM again, so a row that ran allow-all comes back "
        "on the resume list saying `auto` — the one word this dispatch is about",
        [
            (
                COPY,
                "  if (mode === 'auto') return YOLO_LABEL.toLowerCase()\n",
                "",
            )
        ],
    ),
]


def apply(root: Path, index: int) -> bool:
    _, edits = MUTATIONS[index]
    for rel, old, new in edits:
        path = root / rel
        text = path.read_text()
        seen = text.count(old)
        if seen != 1:
            print(f"    !! anchor found {seen} times in {rel}: {old[:70]!r}", file=sys.stderr)
            return False
        # Later edits in the same mutation must see the earlier ones.
        path.write_text(text.replace(old, new, 1))
    return True


def main() -> int:
    if sys.argv[1:2] == ["--count"]:
        print(len(MUTATIONS))
        return 0
    if sys.argv[1:2] == ["--name"]:
        print(MUTATIONS[int(sys.argv[2])][0])
        return 0
    # ⚠️ **The dry-run is HERE, in Python, and it touches nothing** (166 §11). It counts the anchor
    # in the tree exactly as `apply` would and reports every miss at once, so a table with a reflowed
    # anchor is found before a long run reports `DID NOT APPLY` at mutation nine.
    if sys.argv[1:2] == ["--dry-run"]:
        root = Path(sys.argv[2])
        bad = 0
        for i, (name, edits) in enumerate(MUTATIONS):
            for rel, old, _ in edits:
                seen = (root / rel).read_text().count(old)
                if seen != 1:
                    bad += 1
                    print(f"M{i + 1} anchor x{seen} in {rel}: {old[:70]!r}")
                    print(f"   {name[:100]}")
        print(f"checked {len(MUTATIONS)} bad {bad}")
        return 1 if bad else 0
    root, index = Path(sys.argv[1]), int(sys.argv[2])
    return 0 if apply(root, index) else 1


if __name__ == "__main__":
    raise SystemExit(main())
