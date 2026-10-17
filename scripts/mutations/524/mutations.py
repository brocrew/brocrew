"""524 · a server the workspace has — each row is THE DEFECT, put back (131).

🔴 **What these rows protect is one property with two halves that point in OPPOSITE directions**, and
that is the whole reason this table exists rather than a single row on the column:

 1. ⚑ **The DEFAULT is the WIDEST** — a person who says nothing registers a server every identity may
    use. `HO-048` §1: *"A registration form that starts restricted and asks a person to open it up
    would reproduce today's cost with one extra click, which is not a fix. It starts open."*
 2. ⛔ **The FOLD is the NARROWEST** — a value this build cannot read means *restricted*, never
    *everyone's*. The column carries no CHECK (SQLite has no `ADD CONSTRAINT`, and `0033` would have
    had to buy a 12-step rebuild of a table a foreign key points at), so the vocabulary is closed in
    the reader — *"an unrecognised value must fold to the NARROWEST meaning, never to the default, or
    a typo becomes a widening."*

⚠️ **Every row below flips one of those two and nothing else.** A table that only had rows on the
wide half would pass an implementation that folded wide, and vice versa.

## ⛔ This is a WIDENING, so standing rule 24 applies to the TABLE too

⚑ **`M5` is the row the rule asks for.** *"A narrowing is safe when everything it newly refuses was
already wrong"* — the mirror is that a widening has to name what it newly ADMITS, and the most
dangerous version of this dispatch is not one that refuses too much: it is one that reads
`reach != 'restricted'` and hands every unreadable row to every identity in the app.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| `M1`, `M2` | ⚑ **`apps/desktop/test/a-server-the-workspace-has.test.ts` §4** — the fold, in SQL and in JS |
| `M3` | ⚑ **§1/§2** — an identity with no grant row, and one an agent created |
| `M4` | ⚑ **§3** — the narrow half, which `HO-048` §1.1 keeps |
| `M5` | 🔴 **§4** — the divergence: both readings agree on the two good words and differ on every other |
| `M6` | ⚑ **§3** — everyone's AND granted, which is what `0033` makes of the person's own database |
| `M7` | ⚑ **§6** — the backfill, on a database migrated to `0032` and no further |
| `M8`, `M9` | ⚑ **`apps/desktop/test/dom/a-server-the-workspace-has.dom.test.ts` §1** — the form's default, and the choice reaching the wire |
| `M10` | ⚑ **dom §2** — the sheet, which must not draw a control for a row that is not a grant |
| `M11` | ⚑ **§7** — the disclosure `HO-048` §2 owes |
| `M12` | 🔴 **§4** — the wire's refusal, which is the FOLD's opposite on purpose |

⛔ **The table was NOT run.** Every row below was applied ALONE, watched go red against the gate named
above, and restored from held bytes with a SHA-256 re-check — `verify-each-mutation-row`, which is not
the same claim as a table run.

## ⚠️ What is deliberately NOT here

 * **Nothing more on the zod row than `M12`.** ⚠️ **The first draft of this table left it out
   entirely**, on the grounds that widening `z.enum` to `z.string()` is a TYPE error and so could
   never reach a test. ⛔ **That reasoning was wrong and this table's own rules are why**:
   `npx vitest run` does not typecheck, so a mutation the compiler would refuse still RUNS and still
   goes red — and a *"deliberately not here"* note is a claim the next dispatch believes.
 * **A row removing `foldExternalMcpReach` from the store's INSERT.** ⚠️ The wire already refuses a
   third word and every caller in the build is typed, so nothing a test can reach changes —
   `a-true-mutation-measures-nothing`. ⛔ The line is named here rather than left as a phantom
   survivor (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`).
 * **A row putting a CHECK on `external_mcp_server.reach`.** ⛔ It is not a defect, it is the more
   expensive design — and it cannot be expressed as a text swap in a `.sql` that has already been
   applied on every install.
 * **A row on `clean-base.mjs`'s `MIGRATIONS`.** ⚑ `383 M5` owns that rule and `524` re-anchored it
   rather than writing a second copy.
 * **Anything in `516`'s table.** ⚠️ That table's rows are about the grant mechanism, which this
   dispatch did not elaborate; `HO-048` §1.1's *"do not elaborate it"* is the reason there is nothing
   to add there.
"""

SHARED = "apps/desktop/src/shared/external-mcp.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
MIGRATION = "apps/desktop/src/main/db/migrations/0033_sudden_loki.sql"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
FORM = "apps/desktop/src/renderer/src/components/ExternalMcpRegistry.vue"
SHEET = "apps/desktop/src/renderer/src/components/CapabilitiesSheet.vue"

MUTATIONS = [
    # ── the fold, which is the CHECK the column could not afford ───────────────────────────────
    (
        "M1 · 🔴 the fold answers EVERYONE for a value it cannot read · the column has no CHECK, so "
        "this function is the only thing standing between a typo and a server every identity in the "
        "app may call — and the direction it fails in is the direction that hands tools out",
        [
            (
                SHARED,
                "  return said === 'everyone' ? 'everyone' : 'restricted'",
                "  return said === 'restricted' ? 'restricted' : 'everyone'",
            )
        ],
    ),
    (
        "M2 · ⛔ the fold recognises SPELLINGS instead of the value · `EVERYONE` and `Everyone` start "
        "meaning everyone's, so a hand-edited row widens on a case difference — and the id derived "
        "from the folded name stops being the only thing a spelling can change",
        [
            (
                SHARED,
                "  return said === 'everyone' ? 'everyone' : 'restricted'",
                "  return String(said).toLowerCase() === 'everyone' ? 'everyone' : 'restricted'",
            )
        ],
    ),
    # ── the fold a LAUNCH reads, which is SQL and not JavaScript ───────────────────────────────
    (
        "M3 · 🔴 the reach arm is gone from what a launch resolves · an available-to-all server "
        "reaches nobody and the whole ruling is inert, while every surface goes on drawing it as "
        "everyone's — the shape where the sheet and the launch disagree",
        [
            (
                STORE,
                "          WHERE s.reach = 'everyone'\n"
                "             OR EXISTS (SELECT 1 FROM external_mcp_server_grant g",
                "          WHERE EXISTS (SELECT 1 FROM external_mcp_server_grant g",
            )
        ],
    ),
    (
        "M4 · ⛔ the GRANT arm is gone · `516`'s table stops reaching anything, so the one mechanism "
        "`HO-048` §1.1 kept — *the mechanism for the exception* — silently does nothing, and a "
        "restricted server is a server nobody can ever be given",
        [
            (
                STORE,
                "          WHERE s.reach = 'everyone'\n"
                "             OR EXISTS (SELECT 1 FROM external_mcp_server_grant g\n"
                "                         WHERE g.server_id = s.id AND g.identity_id = ?)",
                "          WHERE s.reach = 'everyone' AND ? IS NOT NULL",
            )
        ],
    ),
    (
        "M5 · 🔴 the launch asks *is it NOT restricted* instead of *is it everyone's* · the two "
        "readings agree on both good words and diverge on every other value, so a NULL, a typo and a "
        "word a later build writes all WIDEN — which is the exact failure standing rule 24 says a "
        "widening cannot buy off with *it can only refuse more*",
        [(STORE, "          WHERE s.reach = 'everyone'", "          WHERE s.reach != 'restricted'")],
    ),
    (
        "M6 · ⚠️ the JOIN comes back · a server that is everyone's AND separately granted is returned "
        "TWICE — which is the normal shape of an install `0033` upgraded, since the backfill widens "
        "the rows `516` had already granted — and the adapter gets two entries under one name",
        [
            (
                STORE,
                "          WHERE s.reach = 'everyone'\n"
                "             OR EXISTS (SELECT 1 FROM external_mcp_server_grant g\n"
                "                         WHERE g.server_id = s.id AND g.identity_id = ?)",
                "          LEFT JOIN external_mcp_server_grant g ON g.server_id = s.id\n"
                "          WHERE s.reach = 'everyone' OR g.identity_id = ?",
            )
        ],
    ),
    # ── the default, which is the ruling ───────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The row plants the `ADD
        # reach ... DEFAULT 'restricted'` backfill in migration 0033_sudden_loki.sql, and 5e931be8
        # says 'The database is ONE migration, 0000_the_tree, on a fresh file only', so there are no
        # existing rows to backfill and the killer's section 6 ('the rows that already exist') was
        # deleted. The equivalent default in 0000_the_tree.sql (line 69, `reach text DEFAULT
        # 'everyone' NOT NULL`) is never exercised, because session-store inserts
        # external_mcp_server rows naming `reach` explicitly, so a plant there would have no killer.
        # Its anchor is left stale, so the census records it retired.
        "M7 · 🔴 the migration backfills RESTRICTED · every server registered before this ruling "
        "keeps costing what `HO-047` priced, so the one person who has registered one — the person "
        "whose complaint caused the ruling — gets none of the fix unless he edits rows nobody told "
        "him about",
        [
            (
                MIGRATION,
                "ALTER TABLE `external_mcp_server` ADD `reach` text DEFAULT 'everyone' NOT NULL;",
                "ALTER TABLE `external_mcp_server` ADD `reach` text DEFAULT 'restricted' NOT NULL;",
            )
        ],
    ),
    (
        "M8 · ⛔ the registration form starts RESTRICTED · *“a registration form that starts "
        "restricted and asks a person to open it up would reproduce today's cost with one extra "
        "click, which is not a fix”* — the control still exists, the sentence still renders, and the "
        "ruling is reversed by one word nobody would read as a decision",
        [
            (
                FORM,
                "const reach = ref<ExternalMcpServerReach>('everyone')",
                "const reach = ref<ExternalMcpServerReach>('restricted')",
            )
        ],
    ),
    (
        "M9 · ⚠️ the form sends its own answer instead of the person's · the radios move, the "
        "sentence under them swaps, and every registration is wide whatever was chosen — a control "
        "that is drawn, pressable and disconnected",
        [(FORM, "    reach: reach.value,", "    reach: 'everyone',")],
    ),
    # ── the surfaces ──────────────────────────────────────────────────────────────────────────
    (
        "M10 · ⛔ the sheet draws a TICK-BOX for a server that is everyone's · a checkbox a person "
        "cannot uncheck, on a fact no door can change, and the list of things they may grant fills "
        "with rows that were never grants",
        [
            (
                SHEET,
                "const grantableServers = computed(() => registry.value.filter((one) => one.reach !== 'everyone'))",
                "const grantableServers = computed(() => registry.value)",
            )
        ],
    ),
    (
        "M12 · 🔴 the wire FOLDS a third word instead of refusing it · `reach` stops being a closed "
        "vocabulary at the boundary, so a renderer this build did not compile registers a server "
        "with a word nobody recognises and the store quietly files it as restricted — a payload the "
        "app did not understand, acted on rather than refused. ⛔ It is the FOLD's opposite and that "
        "is the decision: a row already in the database has to mean something, and a caller that "
        "has not made sense has not asked for anything",
        [
            (
                IPC,
                "    reach: z.enum(['everyone', 'restricted']),",
                "    reach: z.string(),",
            )
        ],
    ),
    (
        "M11 · 🔴 the disclosure stops saying what it widens · `HO-048` §2 is *stated, not gated*, "
        "and a sentence that drops *agents that other agents create and whose conversations you never open* keeps the shape of a "
        "disclosure while removing the only clause a person could not have guessed",
        [
            (
                SHARED,
                "  'Every agent in this app may use this server — including agents that other agents create and ' +\n"
                "  'whose conversations you never open — and in a conversation running in yolo, nothing asks ' +\n"
                "  'before it does.'",
                "  'Every agent in this app may use this server, and in a conversation running in yolo, ' +\n"
                "  'nothing asks before it does.'",
            )
        ],
    ),
]
