"""625 · Memory the app can read without a conversation, and a person may correct.

⛔ **`EXT-015` §0's acceptance test is *can the person find BroBot's false note and remove it*.** ⚑ Every
row below is one half of that: the FIND (a reading that exists with no conversation open, and says
which of four things it found) or the REMOVE (a write that refuses to leave BroBot's own folders,
and a record that outlives the file it describes).

## 🔴 A · the brief's §2 premise, measured

⚠️ **The dispatch quoted `src/main/runtime/instructions.ts:100` as a current fact:**
*"`agentMemory: null` for every Codex session."* ⛔ **That sentence is inside a docblock narrating a
defect `317` FIXED**, and its own paragraph says so in the past tense — *"this module went on
reporting `agentMemory: null` for every Codex session"* — under a heading that reads *"…but its
MEMORY is here now, and the sentence that said otherwise was ours (317)"*.

| what the code does today | where |
|---|---|
| ⚑ Codex's store is READ — summary, handbook and ad-hoc notes | `readCodexAgentMemory`, reached from `readSessionInstructions`'s `provider !== 'claude'` branch |
| ⚑ the branch sets `agentMemory: codex.memory` | `instructions.ts`, one line below the corrected comment |

🔴 **So `EXT-015` §3.4's *both providers* was already buildable, and the real gap is the one beside
it:** three different facts — *never ran on this provider*, *ran and wrote nothing*, *the store is
here and unreadable* — all arrived as `entries: []`. ⛔ **`MEMORY_STORE_STATE` is that, and `M4` and
`M5` are the rows that keep the three apart.**

## ⛔ B · the rail, and why it is the opposite of the read's

⚠️ **`readMemoryStore` FOLLOWS a symlink out of the store**, deliberately, under `170` §2: the
provider read the target before this app was asked anything, so refusing removed the row from the
panel and removed nothing from the prompt — *"no visibility and no protection, which is strictly
worse than either."*

🔴 **That argument inverts for a WRITE.** Following the link on a removal is an `unlink` on a file
outside `~/Library/Application Support/@brobot2/desktop/`; following it on a correction is an
`O_TRUNC` on one. ⛔ **`EXT-015` §5 forbids exactly that** — *"Never `~/.claude` and never
`~/.codex`"* — and unlike the read, refusing costs a person nothing they cannot get another way.

⚑ **`M1`, `M2` and `M3` are the three ways that rail can be taken down**, and they are separate
rows because they are separate failures: the READING stops saying an entry is unamendable, the WRITE
stops asking, and the WRITE asks on one act of two.

## ⚠️ C · what has NO row, said rather than left out

⛔ **No row on `amendable`'s LEXICAL arm.** ⚑ A store entry's path is `join(<store dir>, <name>)`
under a home this app derived under the root, so it is lexically inside by construction and no
fixture can make that arm fire while the real arm passes. ⚠️ **It is kept for `placeResource`'s
stated reason** — *"a path that is not even spelled inside the workspace is refused before this app
goes and looks at it"* — and it is `a-rail-can-be-ahead-of-its-tool-but-say-so`, said here.

⛔ **No row on `readAt` being stamped at the END of the walk.** ⚠️ The assertion that holds it is
`before <= readAt <= after` around one call, and a stamp taken at the bottom satisfies it too. ⚑ The
rule it carries — `stamp-a-measurement-when-you-ask-not-when-it-answers` — is a claim about the
DIRECTION of an error under concurrency, and a fixture that could see it would have to write a file
between two syscalls of one call.

⛔ **No row on `O_NOFOLLOW` in `rewrite`.** ⚑ The containment check runs first, so by the time that
flag matters the path has already been established as inside the root; the window it closes is a
link planted BETWEEN the check and the open, which no single-threaded fixture can open. ⚠️ **It is a
kernel guard against a race, not a branch** — and a row that removed it would survive, which is
`a-line-no-mutation-can-kill-is-not-carrying-its-rule` recognised before it is written rather than
after.

⛔ **No row on the index's dangling pointer.** ⚑ Removing a Claude topic file leaves its
`- [Title](file.md)` line in `MEMORY.md`, and that is a DECISION rather than a defect: finding the
line means parsing an agent's prose, which `EXT-015` §5 and `D17` / `HO-088` §5.1 both forbid.
⚠️ `a-person-may-correct-a-memory.test.ts` §1 asserts the pointer survives and that the remedy is a
second act by the same person — a test of the ruling, not a row against it.
"""

from __future__ import annotations

MEM = "apps/desktop/src/main/runtime/agent-memory.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"

AMENDABLE_REAL = (
    "  if (!within(root.lexical, resolve(path))) return false\n"
    "  return within(root.real, realPath(link ?? path))"
)
WRITE_CHECK = (
    "  if (!found.amendable) return { done: false, refused: 'somewhere-else', entry: found.path }"
)
TRUNCATED = (
    "  if (found.truncated) return { done: false, refused: 'unreadable', entry: found.path }"
)
STATE_ORDER = (
    "  if (entries.length > 0) return 'read'\n"
    "  if (read.refused.length > 0) return 'unreadable'\n"
    "  return 'nothing-written'"
)
NO_HOME = (
    "  if (!existsSync(home)) {\n"
    "    return { provider, state: 'no-home', dir: null, entries: [], refused: [] }\n"
    "  }\n"
    "  const read = STORE_READER[provider](home)"
)
PROVIDERS = "const PROVIDERS = Object.keys(STORE_READER) as readonly Provider[]"
TEXT_AFTER = "        textAfter: command.act === 'removed' ? null : command.text,"
WHO = "        by: whoDidIt(by),\n        textBefore: outcome.textBefore,"
EXISTENCE = (
    "    if (this.deps.store.agentIdentities().every(({ slug }) => slug !== profileId)) return null"
)
NEWEST_FIRST = (
    "           FROM identity_memory_amendment WHERE identity_id = ? ORDER BY seq DESC`,"
)
NOT_RECORDED = (
    "      return { done: false, refused: 'not-recorded', reading: this.agentMemory(profileId) }"
)
GATE_WRITE = "      requireAPerson(sink, command.kind)\n      return host.amendAgentMemory(command, sink)"
# ⚑ **W4.170** — F093's follow-up (8efcfba7) gave the paged arm a gate of its own and kept this
# one before the first-page read; the anchor is the first-page arm's gate, as it was.
GATE_READ = "      requireAPerson(sink, command.kind)\n      return host.agentMemory(command.profileId)"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the rail that keeps a write inside BroBot's own folders ────────────────────────────
    (
        "M1 · 🔒 **the READING stops saying an entry is somewhere else** · `amendable` drops the "
        "REAL-path arm and answers `true` for every entry the lexical arm admits. ⛔ A memory index "
        "that is a symlink to `~/.claude/CLAUDE.md` is followed by the reader — `170` §2, "
        "deliberately — and the popup then offers a control over a file `EXT-015` §5 forbids this "
        "app to write. ⚑ **This is the surface's half of the rail**, and its absence is what a "
        "person would press",
        [(MEM, AMENDABLE_REAL, "  if (!within(root.lexical, resolve(path))) return false\n  return true")],
    ),
    (
        "M2 · ⛔ **the WRITE stops asking** · the containment re-check vanishes from "
        "`amendAgentMemory` and the act proceeds on whatever the store listed. ⚠️ **A distinct "
        "failure from `M1`**: there the reading is wrong and a surface draws a control it should "
        "not; here the reading is right and the door does not read it. 🔴 `HO-029` §3's other half "
        "— a check made when the popup opened is not a check made when the button was pressed, and "
        "a link can be planted between them",
        [(MEM, WRITE_CHECK, "  if (found.link === undefined) return { done: false, refused: 'somewhere-else', entry: found.path }")],
    ),
    (
        "M3 · ⚠️ **the rail covers ONE act of two** · a correction through a link is still refused "
        "and a REMOVAL through one is not. ⛔ `one-failure-is-not-the-failure-shape`: `unlink` and "
        "`O_TRUNC` are different syscalls on different branches, and a guard that covered the "
        "second would leave the first deleting a file outside BroBot's folders. ⚑ It is the row "
        "that makes the two assertions in `a-person-may-correct-a-memory.test.ts` §2 a pair rather "
        "than a duplicate",
        [(MEM, WRITE_CHECK, "  if (!found.amendable && inputs.act === 'corrected') return { done: false, refused: 'somewhere-else', entry: found.path }")],
    ),
    (
        "M4 · 🔴 **a file this app could only read PART of is destroyed anyway** · the `truncated` "
        "refusal goes. ⛔ **The record would then state bytes nobody has**: `textBefore` is what the "
        "guarded reader returned, capped at `INSTRUCTION_FILE_CAP`, so a removal of a larger file "
        "would be recorded as its first 64 KiB and the rest would exist nowhere. ⚑ "
        "`a-derivation-cannot-answer-what-its-ledger-does-not-contain` enforced at the door rather "
        "than regretted at the reader",
        [(MEM, TRUNCATED, "  if (found.truncated && found.bytes < 0) return { done: false, refused: 'unreadable', entry: found.path }")],
    ),
    # ── B · the four words, and the bare empty list they replace ───────────────────────────────
    (
        "M5 · ⛔ **a wall of refusals renders as *nothing written yet*** · `unreadable` is dropped "
        "from `stateOf` and a store whose every file this app declined answers the empty-state "
        "word. ⚠️ **The entries list is `[]` either way** — that is the whole point of the "
        "vocabulary — so nothing about the payload's shape can tell the two apart. 🔴 `EXT-015` "
        "§3.5's one line would be shown over a store that is right there and unreadable",
        [(MEM, STATE_ORDER, "  if (entries.length > 0) return 'read'\n  return 'nothing-written'")],
    ),
    (
        "M6 · 🔴 **an agent that has NEVER RUN on a provider is reported as one that wrote "
        "nothing** · the `no-home` branch goes. ⛔ A person is then told *this agent hasn’t written "
        "anything down yet* about a provider no conversation of theirs has ever used — an "
        "invitation to wait for a store nothing is going to fill. ⚑ It is the state a bare empty "
        "list was most wrong about, and the brief's criterion 2 in one row",
        [(MEM, NO_HOME, "  const read = STORE_READER[provider](home)")],
    ),
    (
        "M7 · ⚠️ **only the first provider is read** · the roster stops being derived from the "
        "reader table and becomes a literal. ⛔ **`EXT-015` §3.4 is *both providers*** — and an "
        "identity whose provider was switched at `433` still has a store under the home it moved "
        "away from, so a reading scoped to one would show a person an empty popup for memory that "
        "is on their disk. ⚑ `a-loop-over-a-literal-variant-list-is-not-exhaustive`, on the axis "
        "the `Record<Provider, …>` above it exists to close",
        [(MEM, PROVIDERS, "const PROVIDERS = ['claude'] as readonly Provider[]")],
    ),
    # ── C · the record, and what it is allowed to claim ────────────────────────────────────────
    (
        "M8 · ⛔ **a removal records the text it did NOT write** · `textAfter` carries the "
        "command's text on both acts. ⚠️ **The database is what stops it** — "
        "`identity_memory_amendment_after_matches_act_ck` — so the row cannot land and the act's "
        "record is lost after the file is already gone. 🔴 It is the row that proves the CHECK is "
        "doing work rather than restating a rule the writer keeps",
        [(HOST, TEXT_AFTER, "        textAfter: command.text,")],
    ),
    (
        "M9 · 🔴 **a person's removal is recorded as the app's** · `whoDidIt` is replaced by the "
        "app's own actor. ⛔ **`EXT-015` §3.3 is *never let a person's edit look like the agent's "
        "own*** — and this is the inverse failure, which is worse in the direction that matters: a "
        "record saying the app removed a memory nobody can then find a person for. ⚑ `477`'s "
        "finding is why the column exists at all — provenance is not derivable from the act",
        [(HOST, WHO, "        by: THE_APP_DID_IT,\n        textBefore: outcome.textBefore,")],
    ),
    (
        "M10 · ⛔ **a slug with no identity row has its memory removed anyway** · the existence "
        "check goes. ⚠️ **The FILE is the damage, not the missing row**: the check runs before "
        "anything reaches the filesystem, so without it a caller naming a profile this app has no "
        "identity for still gets a `unlink` — and `writeMemoryAmendment` then refuses, leaving the "
        "act performed and unrecorded. 🔴 Criterion 12 at this door, and the one ordering that "
        "makes a probe impossible",
        [(HOST, EXISTENCE, "    if (profileId === '') return null")],
    ),
    (
        "M11 · ⚠️ **the history reads oldest first** · the amendments statement orders ascending. "
        "⛔ A person opening the popup meets the first thing they ever did to this agent's memory "
        "rather than the last, which is the opposite of every other history in this app — "
        "`ownInstructionSql().versionsOf` is `DESC` for the same reason one line of prose above it "
        "says so",
        [(STORE, NEWEST_FIRST, "           FROM identity_memory_amendment WHERE identity_id = ? ORDER BY seq ASC`,")],
    ),
    (
        "M14 · 🔴 **an act that LANDED is reported as one that changed nothing** · the branch where "
        "the FILE was removed and the RECORD could not be written answers `write-failed`, whose "
        "sentence is *\"Nothing changed and nothing was recorded\"*. ⛔ **The first half of that is "
        "false in this state and false in the direction that reassures** — a person is told their "
        "memory is intact while it is gone. ⚑ **Found reviewing this dispatch's own diff**, and it "
        "is `two-questions-about-one-address`: one word was carrying *the filesystem refused* and "
        "*the record refused*, and only the first sentence is ever true of both",
        [(HOST, NOT_RECORDED, "      return { done: false, refused: 'write-failed', reading: this.agentMemory(profileId) }")],
    ),
    # ── D · the door, and the one authority it has ─────────────────────────────────────────────
    (
        "M12 · 🔒 **anything on the wire may amend an agent's memory** · `requireAPerson` is "
        "dropped from the write. 🔴 **This is the row that makes the record's MISSING `wrote_it` "
        "column a defect instead of a decision**: `identity_memory_amendment` carries no "
        "provenance vocabulary precisely because exactly one kind of caller can reach this verb, "
        "and `A_PERSON_DID_THIS` is the sentence that states it. ⛔ Without the gate the table is "
        "recording an authority it never checked",
        [(IPC, GATE_WRITE, "      return host.amendAgentMemory(command, sink)")],
    ),
    (
        "M13 · ⛔ **anything on the wire may READ an agent's memory** · `requireAPerson` is dropped "
        "from the read. ⚠️ **A different argument from `M12`'s and it needs its own row**: the "
        "write's gate is about authority over an act, and this one is about a payload that carries "
        "another agent's memory VERBATIM. ⚑ `HO-005`'s *the human is unrestricted* is a statement "
        "about a HUMAN, and an agent reading another agent's memory is not something anybody has "
        "asked for · killed by `the-memory-door.test.ts` (named by W4.170) · killed by `an-agent-memory-read-asks-a-person-on-both-arms.test.ts` (named by W4.170)",
        [(IPC, GATE_READ, "      return host.agentMemory(command.profileId)")],
    ),
]
