"""647 · Two branches that never landed — the one row `460`'s test newly carries.

⛔ **Ordered by `00-backlog` D31**, found while reclaiming 163 worktrees. ⚑ `460` and `495` were
both **investigation** dispatches: each produced a verdict, each closed ✅, and neither was ever
meant to merge. ⚠️ What `460` left behind is one test on an unmerged branch, and `647` landed it.

## 🔴 Why this table has exactly one row

⚑ **`647` measured both halves of `460`'s test against the whole suite, and they are not alike.**

 * ⛔ **The RAIL half is over-covered.** Making rail 7 spend `canCreateAgents` as well as
   `canSpawn` — `!spawner.canSpawn.includes(…) && spawner.canCreateAgents === 'none'` — reddens
   **22 tests across ten files**, measured on the whole suite: `573` (5), `598` (4), `409` (3),
   `511` (2), `456` (2), `459`, `629`, `584`, `488`, `the-text-a-child-is-actually-told`, and
   `460`'s own. ⚠️ **A row here would be a twenty-third answer to one question** and is
   deliberately absent. ⚑ **No other arm of `355` moves** — `pm` holds `canCreateAgents` at its
   ruled `'none'` everywhere else in that file.
 * 🔴 **The COLUMN half is carried by `460`'s test ALONE**, and that is `M1`.

## ⚠️ What `M1` is, and why it is shaped the way it is

⛔ **A cross-wire that changes no RESOLVED capability.** `can_spawn` cleared to `'[]'` instead of
`NULL` resolves to the same empty list through `capabilitiesOf`, so every reader that goes through
the resolver agrees with the unmutated tree — *a rule measured only where both readings agree
measures nothing*. ⚑ **What it does change is `chosen`**: `086`'s distinction between a row that
FOLLOWS the default and one that CHOSE it, which is exactly the fact a grant sheet draws.

⚠️ **Conditioned on `canCreateAgents`, and that is the point rather than a contrivance.** The
unconditional form (`? null` → `? '[]'` for every clear) is already red through `355` §2's *a
grant that names one field leaves every other column NULL*. ⛔ **That test names `maxDepth` and
one grant**, so it measures ONE of the ninety ordered field pairs; the pair `460` named — grant
the neighbour, clear the rail's own field — is one of the eighty-nine it does not reach.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⛔ **No row on `edit.canSpawn === undefined`.** ⚑ That is `355 M1`, which has anchored the
   *grant never reaches the column* defect since `355` and is unmoved.
 * ⛔ **No row on the ORDER of the `written` literal.** ⚑ That is `355 M13`, whose anchor spans
   the same `canSpawn` block this row's does. ⚠️ Two rows over one region is safe — the harness
   applies one at a time — but a second ORDER row would report as a survivor against a tree the
   other had already mutated ([[a-mutation-on-a-census-is-invisible-to-that-census]]).
 * 🔴 **No row widens `355` §2's census to loop over every NAMING field.** ⚑ `647` measured that
   a loop over `CAPABILITY_FIELDS` catches this cross-wire **and all ninety pairs**, which is a
   strictly better instrument than `M1` plus `460`'s test. ⛔ **It is a change to another
   dispatch's census and is on the PM's plate** — `647` §1 may land `460`'s patch and nothing
   else, and a test improvement made in passing is a ruling nobody asked for (standing rule 14).
 * ⚠️ **No row makes `externalMcpServerIds` optional again.** ⚑ `516` owns that field and the
   reason `460`'s test did not run for 501 commits; a row here would pin `516`'s wire from a
   table about a worktree sweep.
"""

STORE = "apps/desktop/src/main/db/session-store.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 removed the canSpawn edit path in
        # session-store.ts. The commit says the 'can_spawn … columns stay in the schema, unread and
        # unwritten'. canSpawn survives in src/ only as the two schema.ts column declarations
        # (agent_identity and agent_profile), unread and unwritten, so there is no edit path for a
        # chosen-vs-default inversion to reach. Its anchor is left stale, so
        # the census records it retired.
        "M1 · 🔴 clearing `canSpawn` beside a granted `canCreateAgents` records a CHOICE of nobody "
        "instead of restoring the default · ⛔ the resolved capability is identical — `[]` either "
        "way — so every reader through `capabilitiesOf` agrees and only the RAW column differs, "
        "which is `086`'s *chosen* versus *default* silently inverted for the one identity a "
        "person has just been given creation rights over",
        [
            (
                STORE,
                "        canSpawn:\n"
                "          edit.canSpawn === undefined\n"
                "            ? row.can_spawn\n"
                "            : edit.canSpawn === null\n"
                "              ? null\n"
                "              : JSON.stringify([...edit.canSpawn]),",
                "        canSpawn:\n"
                "          edit.canSpawn === undefined\n"
                "            ? row.can_spawn\n"
                "            : edit.canSpawn === null\n"
                "              ? edit.canCreateAgents === undefined || edit.canCreateAgents === null\n"
                "                ? null\n"
                "                : '[]'\n"
                "              : JSON.stringify([...edit.canSpawn]),",
            )
        ],
    ),
]
