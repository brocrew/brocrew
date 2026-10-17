"""1023 · D-023 · a conversation's root holds files (F034, the person's decision: *"let W1 hold files"*).

⚑ **Why `1023`**: card D-00N's table is `100N`. D-023 is one DEV commit, `fe1cee33`.

## What it changed

`update_work` keeps resources on the caller's own root as what that conversation made, as on any piece
it holds, and W1's record in `list_tasks` lists them. `that-is-your-own-work` now answers only a new
brief and a close on a root.

 * `M1`–`M3` — killed by the landing's `the-giver-briefs-closes-and-hands-files-to-a-piece-it-gave.test.ts`,
   whose root case the landing re-aimed for D-023 (files kept as `made`, and listed in W1's record; a
   new brief and a close still refused).

Designed by the landing agent from the commit and today's code; each row verified alone.

## Verification

- **RED: 3 of 3.** Each row alone by `verify_row.py` with its named killer, on `landing` over
  `6a5e1d47` (the merge of `fe1cee33`). The killer file ran green unmutated first.
"""

RUNTIME_HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · a root's owner is refused keeping files on its own root again · update_work answers that-is-your-own-work to files on W1, so BroBot cannot keep what its own conversation made (F034, the refusal D-023 took away) — killed by `the-giver-briefs-closes-and-hands-files-to-a-piece-it-gave.test.ts`",
        [
            (RUNTIME_HOST, "    if (root && (rebriefs || input.close)) return refused('that-is-your-own-work', named)\n", "    if (root && (rebriefs || input.close || keeps)) return refused('that-is-your-own-work', named)\n"),
        ],
    ),
    (
        "M2 · W1's record lists no files · list_tasks naming a root answers an empty resources list, so what the conversation kept on its own work is kept and never found — killed by `the-giver-briefs-closes-and-hands-files-to-a-piece-it-gave.test.ts`",
        [
            (RUNTIME_HOST, "        resources: this.deps.store.resourcesOf(row.piece),\n", "        resources: [],\n"),
        ],
    ),
    (
        "M3 · a root takes a new brief · the refusal keeps only a close, so a conversation re-briefs its own work, which only makes sense for a piece one conversation gives another — killed by `the-giver-briefs-closes-and-hands-files-to-a-piece-it-gave.test.ts`",
        [
            (RUNTIME_HOST, "    if (root && (rebriefs || input.close)) return refused('that-is-your-own-work', named)\n", "    if (root && input.close) return refused('that-is-your-own-work', named)\n"),
        ],
    ),
]
