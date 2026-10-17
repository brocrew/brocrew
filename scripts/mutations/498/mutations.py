#!/usr/bin/env python3
"""498 · the second factory text, and the sentence that says somebody is watching.

🔴 **`497` §6.1 found a factory text no factory-text census guards.** `workspace.ts`'s
`WORKSPACE_INSTRUCTIONS` is app-authored, versioned with the release, editable by nobody, rendered
as BOTH `CLAUDE.md` and `AGENTS.md`, and written into the cwd of every conversation that names no
folder — and it shipped *"A person is supervising this session and answers the approval prompts"*,
which is FALSE in `auto`, the mode `spawn-rails.ts` records the operator using.

⛔ **The clause is the easy half.** The durable half is that every guard on the FIRST factory text is
addressed to `composeProfileBundle`'s output, so all of them were blind to this file by
construction. This table is weighted accordingly.

| rows | what they protect |
|---|---|
| `M1`–`M3` | the withdrawn premise stays out, its paraphrase stays out, and the INSTRUCTION under it survives |
| `M4`, `M9` | the forbidden-clause member, which is what makes the deletion un-undoable |
| `M5`–`M8` | the claim census itself — a member deleted, a pattern that stops matching, and a pattern widened until it deletes a TRUE sentence |
| `M10` | the kept instruction turned back into a DESCRIBE, which no word census can see |

## ⚠️ `M3` and `M7` are the over-correction, and they are half the table's point

⛔ **A repair of a false premise can fail by taking the instruction with it** (`M3`) **and by
widening the census until it refuses the true sentences a person is legitimately named in**
(`M7`). ⚑ *"When this app asks a person to approve a command or a file change, only a person can
answer it"* is ENFORCED — `mayAnswerAsAHuman` refuses every non-person sink — and conditional on
the app asking. A census that also deleted that would have cost more than the sentence it removed.

## 🔴 `M2` is the row the member alone could not carry

⛔ **`merge` is a word any wording of *never merge* must reach for; *somebody is watching* has no
such word.** So `NOT_IN_THE_FACTORY_TEXT`'s `supervising` pins the spelling that shipped and
`NO_TEXT_PROMISES_A_WATCHER` pins the claim. `M2` writes the premise back WITHOUT the word, which is
exactly how it would come back.

## ⛔ What this table deliberately does NOT contain

⛔ **No row on the roster census in §1.6.** ⚠️ **A mutation on a census is invisible to that
census** — hard-coding the publisher list instead of deriving it from the tree makes the assertion
weaker and it still passes (`497`'s own omission, same reason). The derivation is protected by being
READ from `walk(join(SRC, 'main'))` with a planted two-call-site control beside it.

⛔ **No row re-introducing the `~/.claude` isolation paragraph's deletion.** `164 M13` is that row and
it still applies unchanged — this dispatch left that paragraph and its anchor untouched
(`301` §5: a second copy kills on the same assertion and says nothing).

⛔ **No row on `renderFor`'s provider branch.** `164 M14` owns it, and its REPLACEMENT quotes
*"Your instructions are this profile's own"*, a sentence this dispatch did not move — checked,
because a stale replacement passes `mutations:check` (`366`, `459`, `497`).

⛔ **No row making the workspace file mode-aware.** `498` PRICED that render and did not build it:
the approval mode is per-SESSION and can change between turns (`pendingApprovalMode`), while this
file is one shared directory's, written at boot. There is nothing to mutate.

## Gate map

| rows | killer |
|---|---|
| `M1`–`M3`, `M10` | `apps/desktop/test/the-text-a-child-is-actually-told.test.ts` §1.6 (the premise, the instruction, the list, the claim census) |
| `M4`, `M9` | `apps/desktop/test/the-text-a-child-is-actually-told.test.ts` §1.6's member pin |
| `M5`–`M8` | `apps/desktop/test/the-text-a-child-is-actually-told.test.ts` §1.6's key pin, its planted-sentence control and its over-correction control |
"""

import sys
from pathlib import Path

WORKSPACE = "apps/desktop/src/main/runtime/workspace.ts"
FACTORY = "apps/desktop/src/main/runtime/factory-text.ts"

# The repaired paragraph, exactly as it ships.
ASKS = "Ask when something is destructive or ambiguous rather than guessing.\n"

# The defect, verbatim — the two sentences `498` removed (131's rule).
WITHDRAWN = (
    "BroBot is a local agent application. A person is supervising this session and answers the approval\n"
    "prompts, so ask when something is destructive or ambiguous rather than guessing.\n"
)

MEMBER = "  'supervising',\n"

SUPERVISING_PATTERN = r"  'is supervising (498)': /\bsupervis(e|es|ed|ing|ion|or|ory)\b/i," + "\n"
WATCHING_PATTERN = r"  'is watching': /\b(watching|monitoring|observing|overseeing)\b/i," + "\n"
ATTENDED_PATTERN = r"  'attended or not': /\b(unattended|unsupervised|attended|babysat)\b/i," + "\n"
PRESENT_PATTERN = (
    "  'somebody is present':\n"
    r"    /\b(a|the|some)\s+(person|human|operator|user|somebody|someone)\b[^.]{0,40}\b(is|are|will be)\b[^.]{0,20}\b(there|here|present|available|nearby|online|watching|at the keyboard|standing by)\b/i,"
    + "\n"
)

MUTATIONS = [
    # ── §1 · the sentence itself, in the three shapes it comes back in ─────────────────────────
    (
        "M1 · 🔴 the withdrawn premise is back, verbatim · *A person is supervising this session and "
        "answers the approval prompts* — unhedged, in the file written into the cwd of every "
        "conversation that names no folder, and false in `auto`. ⛔ `086`'s direction: an agent told "
        "a person is watching may act MORE freely than one told the truth",
        [(WORKSPACE, ASKS, WITHDRAWN)],
    ),
    (
        "M2 · ⚠️ …and the same premise WITHOUT the word the member pins · *somebody is watching* has "
        "no single word it must reach for, which is why `NO_TEXT_PROMISES_A_WATCHER` exists beside "
        "the list. ⛔ A member alone would have let this through",
        [
            (
                WORKSPACE,
                ASKS,
                "A human is at the keyboard for this session and approves what you run, so ask when\n"
                "something is destructive or ambiguous rather than guessing.\n",
            )
        ],
    ),
    (
        "M3 · ⛔ the over-correction: the premise goes and takes the INSTRUCTION with it · *ask when "
        "something is destructive or ambiguous rather than guessing* is a real instruction, "
        "followable in both approval modes, and it is the half that had to survive. ⚠️ A sweep that "
        "deleted the whole paragraph would pass every negative in this section",
        [(WORKSPACE, "\n" + ASKS, "")],
    ),
    # ── §2 · the list that makes the deletion un-undoable ──────────────────────────────────────
    (
        "M4 · 🔴 `supervising` leaves `NOT_IN_THE_FACTORY_TEXT` · a deletion is undone by the next "
        "person who finds the sentence sensible; a member cannot be. ⛔ The census that walks the "
        "list is DERIVED from it and would go green — the pin by name is the assertion that fails",
        [(FACTORY, MEMBER, "")],
    ),
    # ── §3 · the claim census, in all three directions it can break ────────────────────────────
    (
        "M5 · ⛔ a member of the claim census is deleted · `is watching` goes, and every text passes "
        "a census that no longer asks the question. ⚑ The key list is pinned by name for exactly "
        "this, one subject over from `a-bound-written-as-the-constant-cannot-pin-it`",
        [(FACTORY, WATCHING_PATTERN, "")],
    ),
    (
        "M6 · ⚠️ a pattern stops matching anything real · `supervis…` narrows to a word no sentence "
        "uses, so the member is present, the loop runs and nothing is measured. ⛔ The planted "
        "sentence per member is what catches it — standing rule 4, a negative is only as strong as "
        "its search shape",
        [(FACTORY, SUPERVISING_PATTERN, r"  'is supervising (498)': /\bsupervisorship\b/i," + "\n")],
    ),
    (
        "M7 · 🔴 a pattern is widened until it refuses a TRUE sentence · dropping the predicate "
        "leaves *a person* on its own, which condemns *only a person can answer it* — enforced by "
        "`mayAnswerAsAHuman` and conditional on the app asking. ⛔ The over-correction control and "
        "the roster loop both fail, which is the point: this census must not be able to delete the "
        "sentences a person is legitimately named in",
        [
            (
                FACTORY,
                PRESENT_PATTERN,
                r"  'somebody is present': /\b(a|the|some)\s+(person|human|operator|user|somebody|someone)\b/i,"
                + "\n",
            )
        ],
    ),
    (
        "M8 · ⚠️ the negative spelling slips out of `attended or not` · *you are never running "
        "unattended* promises exactly what *a person is supervising* promises, and `\\battended\\b` "
        "does not match inside `unattended`. ⛔ A member that reads as present and answers nothing",
        [
            (
                FACTORY,
                ATTENDED_PATTERN,
                r"  'attended or not': /\b(attended|babysat)\b/i," + "\n",
            )
        ],
    ),
    (
        "M9 · ⛔ the member is weakened from the WORD to the sentence that shipped · "
        "`is supervising this session` catches one phrasing and lets every other through, which is "
        "the defect the list's own docblock exists to refuse — *a list of WORDS rather than a list "
        "of sentences*",
        [(FACTORY, MEMBER, "  'is supervising this session',\n")],
    ),
    # ── §4 · the shape no word census can see ──────────────────────────────────────────────────
    (
        "M10 · 🔴 the kept instruction becomes a DESCRIBE · *destructive or ambiguous work is "
        "escalated to a person* asserts a mechanism instead of asking the agent to do anything, "
        "trips no pattern in either census, and is standing rule 8's defect arriving through the "
        "repair. ⛔ Only the assertion that pins the instruction BY ITS WORDS catches it",
        [
            (
                WORKSPACE,
                ASKS,
                "Destructive or ambiguous work is escalated to a person before it runs.\n",
            )
        ],
    ),
]


def apply(root: Path, index: int) -> bool:
    _, edits = MUTATIONS[index]
    staged: list[tuple[Path, str]] = []
    for rel, old, new in edits:
        path = root / rel
        text = path.read_text()
        seen = text.count(old)
        if seen != 1:
            print(f"    !! anchor found {seen} times in {rel}: {old[:70]!r}", file=sys.stderr)
            return False
        staged.append((path, text.replace(old, new, 1)))
    for path, text in staged:
        path.write_text(text)
    return True


def main() -> int:
    if sys.argv[1:2] == ["--count"]:
        print(len(MUTATIONS))
        return 0
    if sys.argv[1:2] == ["--name"]:
        print(MUTATIONS[int(sys.argv[2])][0])
        return 0
    root, index = Path(sys.argv[1]), int(sys.argv[2])
    return 0 if apply(root, index) else 1


if __name__ == "__main__":
    raise SystemExit(main())
