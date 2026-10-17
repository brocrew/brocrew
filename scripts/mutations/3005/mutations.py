"""3005 · Claude's stream fragments — 33eb0dff, 9eae8fa0, b188b521.

⛔ **The defect.** Claude's partial-message frames (tool-input, thinking and signature deltas, block
and message start and stop) were each written to the ledger as an `unknown` row and sent to the
window: about ten a second under load, and 77% of all rows, while the message they build arrives
whole right after them. ⚑ The adapter now marks a well-formed fragment `passing`
(`aPassingFragment` in `normalize.ts`) and the host's `deliver` returns on one after `observe`: no
row, no send (33eb0dff). ⛔ A thinking delta that carries words is kept — no other event holds them
(9eae8fa0). ⚑ Migration `0004_no_stream_fragments.sql` removes the stored fragments and moves each
later row down by the fragments before it; `compactWhenMuchIsFree` gives the space back at launch
(b188b521).

## ⚑ What a row here measures

 * ⚑ **M1–M4 · the adapter's mark** — set at all, never on a kind this build does not know, never on
   thinking with words, and on thinking without them.
 * ⚑ **M5–M6 · the host's return** — a passing fragment is not kept, and nothing that is not passing
   is dropped with it.
 * ⚑ **M7–M10 · the migration** — thinking with words and unrecognized frames survive it, and the
   rows that stay are renumbered per conversation AND generation.
 * ⚑ **M11–M12 · the compaction** — not for a little free space, and never a copy the disk cannot hold.

## ⛔ What this table cannot reach

 * ⚠️ **The host's return placed before `session.liveness.observe`** — a fragment would no longer
   count as a sign the provider is working; neither preferred killer reads liveness after a fragment.
 * ⚠️ **The words rule leaking to other deltas** (dropping `deltaType === 'thinking_delta' &&`) —
   killable (`claude-normalize.test.ts`' ⛔ thinking test, its signature/tool-input loop), left out
   for count: M3/M4 measure the same expression.
 * ⚠️ **`aPassingFragment` on the structural frames** (`message_start` …, line 268) — killable by the
   063 and STRUCTURAL tests, left out: M1 removes the mark from every caller at once.
 * ⚠️ **The migration's `ROWS … AND 1 PRECEDING` bound** — `AND CURRENT ROW` gives the same number
   for every row that stays (its own `fragment` is 0), so the mutant is equivalent. **The
   `-1 - ordinal` step** — rows move down in rowid order, so no planted case collides without it.
 * ⚠️ **The migration's `provider` / `raw.type` / `type = 'unknown'` checks** — killable by the same ⛔
   keep test as M7–M8; left out so the table does not plant one filter four times.
 * ⚠️ **`free * 4 < pages`** — no test has 64 MB or more free yet less than a quarter of the file.
   **`freeOnDisk === null ||`** alone is equivalent (`null < n` is true in JS). **`VACUUM` dropped and
   the `busy === 0` word** — killable (the 🔴 gives-back and ⚑ log-held tests), left out for count.
 * ⚠️ **`index.ts`' call and its log lines** — nothing launches the main process under test.
"""

NORMALIZE = "packages/runtime/src/claude/normalize.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
MIGRATION = "apps/desktop/src/main/db/migrations/0004_no_stream_fragments.sql"
COMPACT = "apps/desktop/src/main/db/compact.ts"

NORMALIZE_TEST = "claude-normalize.test.ts"
NOT_KEPT = "a-stream-fragment-is-not-kept-nor-sent.test.ts"
DROPS = "the-migration-that-drops-stream-fragments.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ---- A · the adapter's mark (33eb0dff, 9eae8fa0) --------------------------------------------
    # NORMALIZE_TEST · 'stream_event text_delta → assistant_delta; other frames are CLASSIFIED, never
    # dropped (063)' — `message_start` must equal `{ …, passing: true }`; also the STRUCTURAL and
    # 'every non-text delta kind is classified' tests.
    (
        "M1 · a well-formed fragment is never marked `passing` — every one is kept and sent again, "
        f"the defect verbatim · killed by `{NORMALIZE_TEST}`",
        [(NORMALIZE,
          "    ? { ...fragment, passing: true }\n",
          "    ? fragment\n")],
    ),
    # NORMALIZE_TEST · 'a NOVEL frame or delta kind stays LOUD (unrecognized), never quiet-by-default'
    # — `expect(novel).not.toHaveProperty('passing')` on a `some_future_delta`.
    (
        "M2 · a kind this build does not know is marked `passing` too — a novel frame is silently "
        f"dropped instead of staying loud and kept · killed by `{NORMALIZE_TEST}`",
        [(NORMALIZE,
          "  return fragment.type === 'unknown' && category !== 'unrecognized'\n",
          "  return fragment.type === 'unknown'\n")],
    ),
    # NORMALIZE_TEST · '⛔ thinking that carries words is KEPT: no other event holds them, so it is
    # not a passing fragment' — `kept` must equal the unknown WITHOUT `passing`.
    (
        "M3 · thinking that carries words passes like any fragment — the model's words are lost, "
        f"the defect 9eae8fa0 fixed · killed by `{NORMALIZE_TEST}`",
        [(NORMALIZE,
          "        thinkingInWords\n"
          "          ? wrapUnknown('claude', message, blockDeltaCategory(deltaType), deltaType)\n"
          "          : aPassingFragment(message, blockDeltaCategory(deltaType), deltaType),\n",
          "        aPassingFragment(message, blockDeltaCategory(deltaType), deltaType),\n")],
    ),
    # NORMALIZE_TEST · same ⛔ test, its loop: `{ thinking: '' }` must still be `passing: true`.
    (
        "M4 · an empty thinking delta counts as words — the empty ones, most of them, are kept and "
        f"sent again · killed by `{NORMALIZE_TEST}`",
        [(NORMALIZE,
          "        typeof delta['thinking'] === 'string' &&\n"
          "        delta['thinking'] !== ''\n",
          "        typeof delta['thinking'] === 'string'\n")],
    ),
    # ---- B · the host's return (33eb0dff) -----------------------------------------------------------
    # NOT_KEPT · '🔴 a passing fragment is not written and not sent; one that is not passing is both'
    # — 'a passing fragment was written'; and '⚑ … a fragment takes no ordinal'.
    (
        "M5 · `deliver` keeps a passing fragment — written to the ledger and sent to the window, ten "
        f"a second under load · killed by `{NOT_KEPT}`",
        [(HOST,
          "    if (event.type === 'unknown' && event.passing === true) return\n",
          "")],
    ),
    # NOT_KEPT · same 🔴 test, the paired positive — the unmarked event must add one row and one send.
    (
        "M6 · `deliver` drops every `unknown`, passing or not — a thinking delta with words, a novel "
        f"frame, never reach the ledger · killed by `{NOT_KEPT}`",
        [(HOST,
          "    if (event.type === 'unknown' && event.passing === true) return\n",
          "    if (event.type === 'unknown') return\n")],
    ),
    # ---- C · the migration (b188b521) ---------------------------------------------------------------
    # DROPS · '⛔ keeps thinking that carries words, and every frame it cannot be sure is a fragment'
    # — `A-0-0` (thinking 'some words') must survive.
    (
        "M7 · the migration removes thinking that carries words with the fragments — the only copy of "
        f"the model's words is deleted · killed by `{DROPS}`",
        [(MIGRATION,
          "\t\t\t\t\tAND length(coalesce(json_extract(`payload`, '$.raw.event.delta.thinking'), '')) = 0,\n",
          "\t\t\t\t\tAND length(coalesce(json_extract(`payload`, '$.raw.event.delta.thinking'), '')) >= 0,\n")],
    ),
    # DROPS · same ⛔ test — `A-0-3` (an `unrecognized` input_json_delta) must survive.
    (
        "M8 · the migration removes a frame filed `unrecognized` — a malformed or novel frame, kept "
        f"loud on purpose, is deleted · killed by `{DROPS}`",
        [(MIGRATION,
          "\t\t\t\t\tAND json_extract(`payload`, '$.category') <> 'unrecognized'\n",
          "")],
    ),
    # DROPS · '🔴 removes the fragments and moves what follows each one down by the fragments before
    # it' — expects ordinals 0, 1, 2 and gets 0, 3, 5.
    (
        "M9 · the rows that stay keep their old ordinals — every removed fragment leaves a hole, and a "
        f"reopened conversation shows a false missing-events notice · killed by `{DROPS}`",
        [(MIGRATION,
          "SELECT `rid`, `fragment`, `ordinal` - `gone_before`\n",
          "SELECT `rid`, `fragment`, `ordinal`\n")],
    ),
    # DROPS · '⚑ conversations and generations are renumbered apart, and nothing is left dangling' —
    # each generation of `C` must read [0, 1, 2, 3, 4, 5].
    (
        "M10 · the renumbering counts fragments across generations — a later life's rows move down by "
        f"an earlier life's fragments · killed by `{DROPS}`",
        [(MIGRATION,
          "\t\t\tPARTITION BY `session_id`, `generation` ORDER BY `ordinal`\n",
          "\t\t\tPARTITION BY `session_id` ORDER BY `ordinal`\n")],
    ),
    # ---- D · the compaction (b188b521) --------------------------------------------------------------
    # DROPS · '🔴 leaves a database with little free space alone, whatever the disk holds' — 2 MB free
    # of 4 MB is a quarter, so it compacts and answers 'compacted', not 'not-needed'.
    (
        "M11 · a small free space is compacted too — any file a quarter free pauses the launch for a "
        f"`VACUUM` · killed by `{DROPS}`",
        [(COMPACT,
          "  if (free * pageSize < COMPACT_FROM_FREE_BYTES || free * 4 < pages) return 'not-needed'\n",
          "  if (free * 4 < pages) return 'not-needed'\n")],
    ),
    # DROPS · '⛔ never starts a copy the disk cannot hold, nor one it cannot measure' — expects
    # 'not-enough-disk' for `null` and for 6 MB beside 8 MB kept.
    (
        "M12 · the disk is never asked — `VACUUM` starts a copy the disk cannot hold, or cannot "
        f"measure · killed by `{DROPS}`",
        [(COMPACT,
          "  if (freeOnDisk === null || freeOnDisk < 2 * kept) return 'not-enough-disk'\n",
          "")],
    ),
]
