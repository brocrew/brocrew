"""3023 · F085 · F086–F088 · the front-matter key guard, and a message that names a piece — c8a1fda8, 7bd23f9e, db6e90a3.

⛔ **The subject**: two small guards the devs' own tests pin only on their obvious side. A Markdown
file's first `---` block is front matter only when each line in it opens like a YAML key — a plain
key that opens with no indicator and no `- `/`? `, or a quoted key closed on its own quote — and the
guard stays linear in the length of a line. And a message from one agent that names a piece says
which piece, however that piece ended (answered, taken back, closed), and refuses a note that names
a piece only its receiver holds.

## ⚑ What a row here measures

 * ⚑ **M1–M7 are `YAML_KEY`** (`resources.ts`, F085, c8a1fda8): `-key`/`?key` as keys while `- `/`? `
   are not; the 13 YAML indicators refused as a key's first character (`&*!` and `[]{}` in turn);
   `''` inside a single-quoted key; `\\"` and `\\\\` inside a double-quoted one; blanks between a
   closing quote and its colon. M1 and M2 share an anchor and plant different defects.
 * ⚑ **M8–M10 are the one place that says how a piece stands** (`runtime-host.ts`, F088, db6e90a3):
   the piece named, not the owner's first; a root said by its folded title, not its row's (null);
   a retitled piece said by its folded title, not the one it was given with.
 * ⚑ **M11 is the sender line** (`runtime-host.ts`, F088): only an agent's own words carry `about`
   on their `message_queued` row, except reconciliation's explicitly named incident.
 * ⚑ **M12 is the naming gate** (`runtime-host.ts`, F086, 7bd23f9e): a piece its receiver holds is
   not one a sender may name.

## ⛔ What this table does not contain

 * ⚠️ The `#`-first refusal in `YAML_KEY`: a `#` line is passed as a comment before `YAML_KEY` is
   consulted, so no test can observe it.
 * ⚠️ The `onePieceAsItStandsNow` catch path: it needs a store stub, and the same read is made after
   the send, so planting a failure there would not isolate it.
 * ⚠️ A tab after `-`/`?` (`(?![-?][ \\t])` to `(?![-?] )`) and the replaced-agent follow-up
   (`theOneInItsPlace` on both sides): extras the notes name; the second may already be killed by
   D-017's files.
"""

RES = "apps/desktop/src/main/resources/resources.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

KEYS = "the-front-matter-key-guard-refuses-what-no-plain-key-opens-with.test.ts"
NAMES = "a-message-names-a-piece-however-it-ended.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · `-key: x` and `?key: x` are refused as a list item / complex key — the guard refuses a "
        f"`-` or `?` first character, not only one followed by a blank · killed by `{KEYS}`",
        [(RES,
          r"(?![-?][ \t])",
          r"(?![-?])")],
    ),
    (
        "M2 · `? key: x` is read as a key — only `- ` is refused, `? ` opens a key · killed by "
        f"`{KEYS}`",
        [(RES,
          r"(?![-?][ \t])",
          r"(?!-[ \t])")],
    ),
    (
        "M3 · `&`, `*` and `!` are accepted as a key's first character · killed by "
        f"`{KEYS}`",
        [(RES,
          r"{},&*!|>%@",
          r"{},|>%@")],
    ),
    (
        "M4 · `[`, `]`, `{` and `}` are accepted as a key's first character · killed by "
        f"`{KEYS}`",
        [(RES,
          r'''[^\s#:'"[\]{},''',
          r'''[^\s#:'",''')],
    ),
    (
        "M5 · `''` inside a single-quoted key is not read, so `'it''s': x` is no key · killed by "
        f"`{KEYS}`",
        [(RES,
          r"""'(?:[^']|'')*'""",
          r"""'[^']*'""")],
    ),
    (
        "M6 · `\\\"` and `\\\\` inside a double-quoted key are not read, so such a key is no key · "
        f"killed by `{KEYS}`",
        [(RES,
          r'''"(?:[^"\\]|\\.)*"''',
          r'''"[^"]*"''')],
    ),
    (
        "M7 · blanks between a closing quote and its colon refuse the key · killed by "
        f"`{KEYS}`",
        [(RES,
          r"""')[ \t]*):""",
          r"""')):""")],
    ),
    (
        "M8 · a message about a piece says the owner's FIRST piece, not the one it names · killed by "
        f"`{NAMES}`",
        [(HOST,
          "      const folded = this.deps.store.piecesOwnedBy(owner).find((one) => one.piece === piece)\n",
          "      const folded = this.deps.store.piecesOwnedBy(owner).find(() => true)\n")],
    ),
    (
        "M9 · a root named by a message is said as a bare label — its row's title is always null · "
        f"killed by `{NAMES}`",
        [(HOST,
          "        return { label: row.label, title: this.deps.store.rootLines(row.piece).title }\n",
          "        return { label: row.label, title: row.title }\n")],
    ),
    (
        "M10 · a retitled piece is said by the title it was given with, not the one it stands under "
        f"· killed by `{NAMES}`",
        [(HOST,
          "        : onePieceAsItStands(folded)\n",
          "        : onePieceAsItStands({ ...folded, title: row.title })\n")],
    ),
    (
        # Same defect on its current subject; source-only, NOT VERIFIED.
        "M11 · unrelated app-owned held notices record a piece on their `message_queued` row, as an "
        f"agent's words do · killed by `{NAMES}`",
        [(HOST,
          "    const about =\n      from?.who === 'a-caller-with-an-id' || facts.appNotice === 'a-work-wait-needs-attention'\n        ? (facts.aboutPiece?.piece ?? null)\n        : null\n",
          "    const about = facts.aboutPiece?.piece ?? null\n")],
    ),
    (
        "M12 · a note may name a piece its RECEIVER holds — neither held nor given by the sender · "
        f"killed by `{NAMES}`",
        [(HOST,
          "    if (row.owner === sender) {\n",
          "    if (row.owner === sender || row.owner === agent) {\n")],
    ),
]
