"""327 · A tool call we flatten to one word — each row is THE DEFECT, put back verbatim (131).

⛔ **What 327 fixed, in one sentence.** A real `mcpToolCall` arrives carrying server, tool,
arguments, result, error and duration, and `codex/normalize.ts` reduced it to `name: "mcp"`,
`summary: "mcpToolCall"` and a boolean — so the transcript said a tool ran and nothing else.

## ⚑ The evidence, because half of this table is about a shape the dispatch got wrong

`316` §3 captured one successful call. `327` re-ran that instrument against a real `0.146.0`
app-server, a real stdio MCP server on SDK `1.29.0` and an owned loopback Responses endpoint, and
added the two shapes nobody had asked the wire for:

| how it failed | `status` | `error` | `result` | `durationMs` |
|---|---|---|---|---|
| the TOOL threw | `failed` | **`null`** | `content[0].text` = the thrown message | `0` |
| the TRANSPORT timed out | `failed` | **`{message: "tool call error: … timed out …"}`** | **`null`** | `4002` |

🔴 **The dispatch's own §2.2 said the reason lives on `error.message`.** For one of the two ways a
call can fail, it does not — and that is the commoner one. `M7` and `M8` are the two halves of that
finding, and each is a row a reader of the brief alone would have shipped.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M14`, `M18`-`M27` | ⚑ **`run_suite`** — `packages/runtime/test/codex-mcp-row.test.ts` |
| `M15`-`M17`, `M28` | ⚑ **`run_suite`** — `apps/desktop/test/mcp-row-duration.render.test.ts` |

## ⚠️ What this table deliberately does NOT contain

⛔ **No row flips the order of `error` and `result` in {@link mcpResultSummary}.** On both captured
failures exactly ONE of the two is populated, so a swap is a no-op that would record as a survivor
and read as a coverage gap — `a-mutation-that-changes-nothing-reports-as-a-survivor`. The ORDER is
load-bearing only for an item carrying both, which no capture has produced; it is argued in the
docblock and left unpinned rather than pinned by a row that proves nothing.

⛔ **No row touches the memory path.** `316` settled that nested `memories__*` calls publish no item
at all and `318`/`319` built the rows that answer it. Different channel, different defect.

⛔ **No row makes `commandExecution` read its own `durationMs`.** `M12` is the control in the other
direction — that it is NOT read — because reading it would change the duration on every shell row in
the app, which this dispatch was not asked for.
"""

NORM = "packages/runtime/src/codex/normalize.ts"
FOLD = "apps/desktop/src/renderer/src/lib/transcript.ts"
ENTRY = "apps/desktop/src/renderer/src/components/ToolEntry.vue"
# ⚑ **`587` · where the card's own duration went.** `took` is one derivation now, read by the
# card and by the collapsed run beside it — `064`/`099`.
OUTCOME = "apps/desktop/src/renderer/src/lib/tool-outcome.ts"

MUTATIONS = [
    # ── the defect itself ─────────────────────────────────────────────────────────────────────
    (
        "M1 · ⛔ THE DEFECT, verbatim · the row goes back to the word `mcp` — the whole ticket. "
        "⚠️ Every other fact still lands, which is why the killer has to assert the NAME",
        [
            (
                NORM,
                "    if (server && tool) return truncate(`mcp__${server}__${tool}`)",
                "    if (server && tool) return 'mcp'",
            )
        ],
    ),
    (
        "M2 · 🔴 THE DEFECT's other half · the result repeats the CALL instead of saying what came "
        "back — `316`'s `summary: \"mcpToolCall\"`, and the failure reason with it",
        [
            (
                NORM,
                "  if (type === 'mcpToolCall') return mcpResultSummary(item)",
                "  if (type === 'mcpToolCall') return calledWith",
            )
        ],
    ),
    (
        "M3 · ⛔ the arguments are dropped and the item TYPE stands where they were — the "
        "`itemSummary` fallback this kind used to reach",
        [
            (
                NORM,
                "  if (type === 'mcpToolCall' || type === 'dynamicToolCall') return argumentsSummary(item)",
                "  if (type === 'dynamicToolCall') return argumentsSummary(item)",
            )
        ],
    ),
    # ── half-listings of the qualified name ───────────────────────────────────────────────────
    (
        "M4 · ⚠️ the SERVER is dropped from the name, so a row names a tool without saying whose — "
        "two servers exposing `search` become one row",
        [
            (
                NORM,
                "    if (server && tool) return truncate(`mcp__${server}__${tool}`)",
                "    if (server && tool) return truncate(`mcp__${tool}`)",
            )
        ],
    ),
    (
        "M5 · ⚠️ the TOOL is dropped, so every call to one server reads identically",
        [
            (
                NORM,
                "    if (server && tool) return truncate(`mcp__${server}__${tool}`)",
                "    if (server && tool) return truncate(`mcp__${server}`)",
            )
        ],
    ),
    (
        "M6 · 🔴 the two halves are swapped — a name that is well-formed, plausible, and names the "
        "wrong thing in both positions",
        [
            (
                NORM,
                "    if (server && tool) return truncate(`mcp__${server}__${tool}`)",
                "    if (server && tool) return truncate(`mcp__${tool}__${server}`)",
            )
        ],
    ),
    (
        "M7 · ⛔ the malformed guard becomes `||`, so a missing server INVENTS one out of the tool "
        "name — `mcp__echo_probe` reads as a server called `echo_probe`",
        [
            (
                NORM,
                "    if (server && tool) return truncate(`mcp__${server}__${tool}`)",
                "    if (server || tool) return truncate(`mcp__${server}${tool}`)",
            )
        ],
    ),
    # ── the failure finding ───────────────────────────────────────────────────────────────────
    (
        "M8 · 🔴 THE BRIEF's own version · only `error.message` is read, which is what `327` §2.2 "
        "asked for — and the row then says nothing at all about a tool that THREW, the commoner of "
        "the two measured failures",
        [
            (
                NORM,
                "  const result = readField(item, 'result')\n  const text = mcpResultText(readField(result, 'content'))\n  if (text) return boundedSummary(oneLine(text))",
                "  const result = readField(item, 'result')\n  const text = ''\n  if (text) return boundedSummary(oneLine(text))",
            )
        ],
    ),
    (
        "M9 · 🔴 the mirror · only the result is read, so a TIMEOUT — which carries no result at "
        "all — settles as the word `done` beside a red dot",
        [
            (
                NORM,
                "  const message = readString(error, 'message')\n  if (message) return boundedSummary(oneLine(message))",
                "  const message = readString(error, 'message')\n  if (!message) return boundedSummary('')",
            )
        ],
    ),
    (
        "M10 · ⛔ the bare-string `error` branch goes, so a non-conformant server's reason falls "
        "through to `done` — `068`'s hazard, on the one field it was found on",
        [
            (
                NORM,
                "  if (typeof error === 'string' && error) return boundedSummary(oneLine(error))",
                "  if (false) return boundedSummary(oneLine(String(error)))",
            )
        ],
    ),
    (
        "M11 · ⚠️ the provider's multi-line failure is left as sent, so `\\n\\nCaused by:\\n    ` "
        "pushes the sentence that says WHAT failed past a `white-space: nowrap` clip",
        [
            (
                NORM,
                "  return text.replace(/\\s+/g, ' ').trim()",
                "  return text",
            )
        ],
    ),
    # ── the duration ──────────────────────────────────────────────────────────────────────────
    (
        "M12 · 🔴 the truthiness trap · `0` is dropped, so the duration disappears from exactly the "
        "rows where how FAST it failed is the interesting part — measured, the thrown arm reported "
        "`durationMs: 0`",
        [
            (
                NORM,
                "  return ms === undefined || ms < 0 ? {} : { durationMs: ms }",
                "  return ms ? { durationMs: ms } : {}",
            )
        ],
    ),
    (
        "M13 · ⚑ THE CONTROL in the other direction · the duration is read for every tool item, "
        "which changes what every shell row in the app shows — a widening this dispatch was not "
        "asked for",
        [
            (
                NORM,
                "  if (type !== 'mcpToolCall') return {}",
                "  if (type === 'nothing') return {}",
            )
        ],
    ),
    (
        "M14 · ⚠️ a nonsense negative duration is admitted, and fails schema validation for the "
        "WHOLE event rather than costing its own field",
        [
            (
                NORM,
                "  return ms === undefined || ms < 0 ? {} : { durationMs: ms }",
                "  return ms === undefined ? {} : { durationMs: ms }",
            )
        ],
    ),
    (
        "M15 · ⛔ the duration is put on the CALL as well, where the wire says `null` — a row that "
        "states how long something took before it has finished, and a field `toolCallSchema` does "
        "not declare at all",
        [
            (
                NORM,
                "    return [{ type: 'tool_call', id, name, summary, ...(backgroundId ? { backgroundId } : {}) }]",
                "    return [\n      {\n        type: 'tool_call',\n        id,\n        name,\n        summary,\n        ...(type === 'mcpToolCall' ? { durationMs: 0 } : {}),\n        ...(backgroundId ? { backgroundId } : {}),\n      },\n    ]",
            )
        ],
    ),
    # ── the bound ─────────────────────────────────────────────────────────────────────────────
    (
        "M16 · 🔴 the remainder is not stated, so a 90 047-character answer and a 201-character one "
        "render as the same row — `187 §2`'s rule, dropped",
        [
            (
                NORM,
                "  return `${truncate(text, SUMMARY_CAP)} (${SUMMARY_CAP} of ${text.length} characters)`",
                "  return truncate(text, SUMMARY_CAP)",
            )
        ],
    ),
    (
        "M17 · ⚠️ off by one · a result that exactly FITS is reported as bounded, so the row claims "
        "a loss that did not happen",
        [
            (
                NORM,
                "  if (text.length <= SUMMARY_CAP) return text",
                "  if (text.length < SUMMARY_CAP) return text",
            )
        ],
    ),
    (
        "M18 · ⛔ the cap is raised past anything real, so ninety kilobytes of a third party's "
        "output is cloned across IPC and written to the ledger twice",
        [(NORM, "const SUMMARY_CAP = 200", "const SUMMARY_CAP = 100_000")],
    ),
    (
        "M19 · 🔴 `316`'s OTHER shape, repeated here · the payload is replaced WHOLESALE by an "
        "erasure marker instead of truncated, so what the server said is gone from a summary line",
        [
            (
                NORM,
                "  return `${truncate(text, SUMMARY_CAP)} (${SUMMARY_CAP} of ${text.length} characters)`",
                "  return `<${text.length} characters, not carried>`",
            )
        ],
    ),
    (
        "M20 · ⚠️ the ARGUMENTS escape the bound — the half of the row nobody thinks of as a "
        "payload, and the one a caller controls directly",
        [
            (
                NORM,
                "  return json === undefined ? '' : boundedSummary(json)",
                "  return json === undefined ? '' : json",
            )
        ],
    ),
    (
        "M21 · ⛔ the NAME escapes the bound · it stopped being a literal from a Map in this very "
        "dispatch, and `toolCallSchema.name` carries no `.max()` — found reviewing 327's own diff",
        [
            (
                NORM,
                "    if (server && tool) return truncate(`mcp__${server}__${tool}`)",
                "    if (server && tool) return `mcp__${server}__${tool}`",
            )
        ],
    ),
    # ── the empty summary ─────────────────────────────────────────────────────────────────────
    (
        "M22 · ⚠️ the join goes back to interpolation, so a call with NO arguments opens its result "
        "row with a dangling em dash",
        [
            (
                NORM,
                "  const spoken = [settled, outcome.note].filter(Boolean).join(' — ')",
                "  const spoken = outcome.note ? `${settled} — ${outcome.note}` : settled",
            )
        ],
    ),
    (
        "M23 · ⛔ an absent `arguments` is narrated as the string `null` rather than left empty — a "
        "row that says the model sent something it did not",
        [
            (
                NORM,
                "  if (args === undefined || args === null) return ''",
                "  if (args === undefined) return ''",
            )
        ],
    ),
    (
        "M24 · ⚑ the empty-result word is invented rather than borrowed · `316`'s memory call really "
        "did return `{}`, and Claude's own row says `done`",
        [
            (
                NORM,
                "  // Claude's own word for a result that carried no text (`summarizeToolResult`), not a new one.\n  return 'done'",
                "  // Claude's own word for a result that carried no text (`summarizeToolResult`), not a new one.\n  return 'no output'",
            )
        ],
    ),
    (
        "M25 · ⚠️ `structuredContent` is never read, so a server that sends only the machine half "
        "settles as `done` with its answer discarded",
        [
            (
                NORM,
                "  const structured = readField(result, 'structuredContent')",
                "  const structured = undefined",
            )
        ],
    ),
    # ── the deliberate drops ──────────────────────────────────────────────────────────────────
    (
        "M26 · ⛔ `appContext` is carried onto the row after all — machinery for a payload nobody "
        "has measured, which is the ruling `327` §2.5 made in the other direction",
        [
            (
                NORM,
                "      ...mcpDuration(type, item),",
                "      ...mcpDuration(type, item),\n      ...(type === 'mcpToolCall' && readField(item, 'appContext')\n        ? { summary: `${spoken} ${JSON.stringify(readField(item, 'appContext'))}` }\n        : {}),",
            )
        ],
    ),
    (
        "M27 · ⚠️ the result summary is left unbounded on the `structuredContent` path only — one "
        "escape route out of three, which is the shape a partial fix leaves behind",
        [
            (
                NORM,
                "      if (json !== undefined) return boundedSummary(json)",
                "      if (json !== undefined) return json",
            )
        ],
    ),
    # ── the renderer ──────────────────────────────────────────────────────────────────────────
    (
        "M28 · 🔴 the row ignores the provider's own number and prints the host-clock span instead "
        "— measured, 7 ms of envelopes for a call the provider timed at 4, and worse under load",
        [
            (
                OUTCOME,
                "  if (item.background === undefined) {\n    const reported = item.result?.durationMs",
                "  if (false) {\n    const reported = item.result?.durationMs",
            )
        ],
    ),
    (
        "M29 · ⛔ `248`, undone · the provider's duration is printed for DETACHED work too, so a "
        "command that is still running gets a completion time beside `still running`",
        [
            (
                OUTCOME,
                "  if (item.background === undefined) {\n    const reported = item.result?.durationMs",
                "  {\n    const reported = item.result?.durationMs",
            )
        ],
    ),
    (
        "M30 · 🔴 the truthiness trap again, one layer up · the FOLD drops a measured `0`, so the "
        "normalizer's care is undone between it and the screen",
        [
            (
                FOLD,
                "          ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),",
                "          ...(event.durationMs ? { durationMs: event.durationMs } : {}),",
            )
        ],
    ),
    (
        "M31 · ⚠️ the card row writes a `durationMs` its own type does not declare and nothing can "
        "render — an object spread writes past a declared type with no error, which is how the "
        "first draft of this dispatch shipped it",
        [
            (
                FOLD,
                "        nested.result = { summary: event.summary, ok: event.ok }",
                "        nested.result = {\n          summary: event.summary,\n          ok: event.ok,\n          ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),\n        }",
            )
        ],
    ),
]
