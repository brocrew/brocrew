"""680 · The Claude Code inside BroBot is two months old — the bump, and a refusal said as what it is.

⛔ **Ordered by a refusal in the person's own window**, 2026-09-23 23:15: BroBot on `claude-opus-5-5[1m]`
was answered *"API Error: 400 Claude Code 2.1.218 does not support this model; version 2.1.280 or
newer is required. Run 'claude update', or update the Claude desktop app, then try again."* — drawn
as BroBot's own words, with *"claude reported an error without saying what it was"* under it.

## 🔴 A · whose words they are — the MARKER, measured (R28a · M1-M5)

⚑ The SDK frame of a refusal carries `message.model: "<synthetic>"` beside its error word (680 §1,
`packages/runtime/test/fixtures/claude-model-floor-refusal.json`); a reply cut at `max_output_tokens`
is one text block with an error word too, and names its REAL model. M3 is 110's shape rule restored,
and it is the row that proves the marker, not the shape, is what decides.

## 🔴 B · what our line says (R28b · M6-M7) and what the floor says (R28c · M8-M15)

⚑ The provider's whole sentence rides on `message`; the floor carries `refusal` values read off the
turn's own `system/init`, and the renderer says the model, both versions and *choose another model*.

## 🔴 C · the refused turn FAILED (M16) · the importer (M17-M18)

## ⚑ D · what the 0.3.281 bump moved (M19-M20) · the origin reader that had to learn 2.1.281 (M21-M24)

## 🔴 F · what 680's review found (M25-M31) — a notice with no error word, the output limit's advice,
a replayed field read as a member, the importer's version, and a mentions-only proof tied to its gate

## ⚠️ E · rows corrected elsewhere

⚑ `165 M3` and `165 M4` anchor the `systemPrompt` literal, which gained `snapshot: false`; the anchor
was corrected in place and both re-verified RED. No row was retired.
"""

NORMALIZE = "packages/runtime/src/claude/normalize.ts"
REFUSAL = "packages/runtime/src/claude/provider-refusal.ts"
RUNTIME = "packages/runtime/src/claude/claude-runtime.ts"
EVENTS = "packages/runtime/src/events.ts"
WORDS = "packages/runtime/src/claude/assistant-error.ts"
IMPORT = "apps/desktop/src/main/archive/import-claude.ts"
NORMALIZER = "apps/desktop/src/main/archive/normalizer.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
SENTENCE = "apps/desktop/src/renderer/src/lib/provider-error.ts"
ORIGIN = "scripts/lib/claude-cli-origin.mjs"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · whose words they are ──────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **nothing is diverted** · the CLI's own notice is drawn as the speaker's words again, "
        "for every word but the credential one's tests — killed by `a-refusal-is-not-the-speakers-words.test.ts`",
        [(NORMALIZE, "        if (theClisNotice) {\n", "        if (false) {\n")],
    ),
    (
        "M2 · ⛔ **every message with an error word is diverted** · a REAL model's message beside a "
        "word loses its text — killed by `a-refusal-is-not-the-speakers-words.test.ts`",
        [(NORMALIZE, "        if (theClisNotice) {\n", "        if (true) {\n")],
    ),
    (
        "M3 · 🔴 **110's SHAPE rule restored** · *one text block and nothing else* decides, so a real "
        "model's one-block message beside a word is taken for a notice — killed by `a-refusal-is-not-the-speakers-words.test.ts`",
        [
            (
                NORMALIZE,
                "        if (theClisNotice) {\n",
                "        if (events.length === 1 && events[0]?.type === 'assistant_message') {\n",
            )
        ],
    ),
    (
        "M4 · ⛔ **the marker is read off the wrong field** · `message.model` of the OUTER frame, which "
        "has none — nothing is ever the CLI's — killed by `a-refusal-is-not-the-speakers-words.test.ts`",
        [
            (
                REFUSAL,
                "  return (inner as { model?: unknown }).model === THE_CLIS_OWN_MODEL\n",
                "  return (message as { model?: unknown }).model === THE_CLIS_OWN_MODEL\n",
            )
        ],
    ),
    (
        "M5 · ⚠️ **the credential notice is no longer carried** · `authentication_failed` falls back to "
        "our words though the CLI said why — killed by `claude-normalize.test.ts`",
        [
            (
                NORMALIZE,
                "          events.push({ type: 'error', message: said, fatal: true, cause: 'auth_stale' })\n",
                "          events.push({\n            type: 'error',\n            message: assistantErrorWords(message.error),\n            fatal: true,\n            cause: 'auth_stale',\n          })\n",
            )
        ],
    ),
    # ── B · what our line says ────────────────────────────────────────────────────────────────
    (
        "M6 · 🔴 **R28b undone** · our words replace the provider's sentence, so the floor reads "
        "*\"without saying what it was\"* again — killed by `a-refusal-is-not-the-speakers-words.test.ts`",
        [
            (
                NORMALIZE,
                "        const said = notice.trim() ? notice : assistantErrorWords(message.error ?? 'unknown')\n",
                "        const said = assistantErrorWords(message.error ?? 'unknown')\n",
            )
        ],
    ),
    (
        "M7 · ⚠️ **a whitespace notice counts as a diagnostic** · the reader is handed blanks instead of "
        "the true *\"without saying what it was\"* — killed by `a-refusal-is-not-the-speakers-words.test.ts`",
        [
            (
                NORMALIZE,
                "        const said = notice.trim() ? notice : assistantErrorWords(message.error ?? 'unknown')\n",
                "        const said = notice ? notice : assistantErrorWords(message.error ?? 'unknown')\n",
            )
        ],
    ),
    (
        "M8 · 🔴 **the floor carries no values** · the refusal is recognised and dropped, and the reader "
        "gets `claude update` — killed by `a-refusal-is-not-the-speakers-words.test.ts`",
        [(NORMALIZE, "            ...(refusal === null ? {} : { refusal }),\n", "")],
    ),
    (
        "M9 · 🔴 **`runs` is a constant** · the version this app runs is written down rather than read "
        "off the wire — killed by `a-refusal-is-not-the-speakers-words.test.ts`",
        [(REFUSAL, "    runs: announced.version,\n", "    runs: '2.1.218',\n")],
    ),
    (
        "M10 · ⛔ **`model` is a constant** · the model the turn asked for is written down, not "
        "announced — killed by `a-refusal-is-not-the-speakers-words.test.ts`",
        [(REFUSAL, "    model: announced.model,\n", "    model: 'claude-opus-5-5[1m]',\n")],
    ),
    (
        "M11 · ⚠️ **a refusal is recognised with nothing announced** · a replay with no init claims "
        "values it never read — killed by `a-refusal-is-not-the-speakers-words.test.ts`",
        [
            (
                REFUSAL,
                "  if (floor === null || announced.version === null || announced.model === null) return null\n",
                "  if (floor === null) return null\n",
            )
        ],
    ),
    (
        "M12 · 🔴 **the init is never read** · no version and no model, so nothing is ever recognised — "
        "killed by `a-refusal-is-not-the-speakers-words.test.ts`",
        [(NORMALIZE, "  announced.noteInit(message)\n", "")],
    ),
    (
        "M13 · 🔴 **the adapter keeps its announcement to itself** · the live session hands the "
        "normalizer no `AnnouncedCli`, so a real refusal carries nothing — killed by `claude-runtime.test.ts`",
        [(RUNTIME, "          this.announced,\n", "")],
    ),
    (
        "M14 · ⛔ **the event contract forgets `refusal`** · the parse every event passes before it is "
        "stored strips the values in silence — killed by `a-refusal-is-not-the-speakers-words.test.ts`",
        [(EVENTS, "  refusal: providerRefusalSchema.optional(),\n", "")],
    ),
    (
        "M15 · 🔴 **the reader is shown the provider's advice** · the renderer never draws the values, "
        "so `Run 'claude update'` is what a person reads — killed by `provider-error.test.ts`",
        [(TRANSCRIPT, "      if (refusal !== null) {\n", "      if (false) {\n")],
    ),
    # ── C · the refused turn failed · the importer ─────────────────────────────────────────────
    (
        "M16 · 🔴 **a refused turn COMPLETED** · `is_error` on a `success` result unread, and a parent "
        "is told the child finished — killed by `a-refusal-is-not-the-speakers-words.test.ts`",
        [
            (
                NORMALIZE,
                "    if (message.is_error !== true) return { outcome: 'completed' }\n",
                "    return { outcome: 'completed' }\n",
            )
        ],
    ),
    (
        "M17 · 🔴 **an adopted conversation draws the refusal as the assistant's** · the importer "
        "diverts nothing — killed by `raw-archive-import.test.ts`",
        [
            (
                IMPORT,
                "    if (theClisNotice) {\n",
                "    if (false) {\n",
            )
        ],
    ),
    (
        "M18 · ⛔ **the importer diverts a real reply** · every archived message with an error word "
        "loses its text — killed by `raw-archive-import.test.ts`",
        [
            (
                IMPORT,
                "  const theClis = isRecord(message) && message['model'] === THE_CLIS_OWN_MODEL\n",
                "  const theClis = isRecord(message)\n",
            )
        ],
    ),
    # ── D · the bump ──────────────────────────────────────────────────────────────────────────
    (
        "M19 · 🔴 **0.3.281's default takes over** · the system prompt is recorded on the first request "
        "and a reopened conversation keeps its first launch's instructions — killed by `conformance.test.ts`",
        [(RUNTIME, "      snapshot: false,\n", "")],
    ),
    (
        "M20 · ⚠️ **a new error word says an old word's sentence** · `account_on_hold` read as a "
        "credential failure — killed by `claude-normalize.test.ts`",
        [
            (
                WORDS,
                "  account_on_hold: 'this account is on hold and claude will not answer it',\n",
                "  account_on_hold: 'claude could not authenticate',\n",
            )
        ],
    ),
    # RETIREMENT APPROVED — 680 M21: file-gone; removed by e504ff460ce1a0b5cf1e8b8de9daf5aa46dc0aae.
    # Guarded parser and its test were deliberately removed under the standing rule forbidding
    # reading inside Claude Code; retained loopback wire probe does not replace these parser guarantees,
    # and none are wanted. Definition retained as historical evidence; no row execution.
    (
        "M21 · 🔴 **the NEAREST same-named definition is the callee again** · on CLI 2.1.281 that is a "
        "zero-parameter Windows check, and the gate reads ⛔ — killed by `claude-cli-origin.test.mjs`",
        # ⚑ **provider-update-1 · re-anchored in place, not retired** — provider update 1 moved the arity check into `definitionsIn` (callees are now resolved by chunk); the mutation is the same, dropping it
        [(ORIGIN, "    if (params === arity) found.push({ at, body })\n", "    found.push({ at, body })\n")],
    ),
    # RETIREMENT APPROVED — 680 M22: file-gone; removed by e504ff460ce1a0b5cf1e8b8de9daf5aa46dc0aae.
    # Guarded parser and its test were deliberately removed under the standing rule forbidding
    # reading inside Claude Code; retained loopback wire probe does not replace these parser guarantees,
    # and none are wanted. Definition retained as historical evidence; no row execution.
    (
        "M22 · ⛔ **an ambiguous callee is resolved to one of its candidates** · a lenient twin can be "
        "read as the strict rule — killed by `claude-cli-origin.test.mjs`",
        [
            (
                ORIGIN,
                "    if (bodies.size === 1) resolved[name] = [...bodies.keys()][0]\n",
                "    if (bodies.size >= 1) resolved[name] = [...bodies.keys()][0]\n",
            )
        ],
    ),
    # RETIREMENT APPROVED — 680 M23: file-gone; removed by e504ff460ce1a0b5cf1e8b8de9daf5aa46dc0aae.
    # Guarded parser and its test were deliberately removed under the standing rule forbidding
    # reading inside Claude Code; retained loopback wire probe does not replace these parser guarantees,
    # and none are wanted. Definition retained as historical evidence; no row execution.
    (
        "M23 · 🔴 **a mentions-only pass is accepted on its NAME** · the early return that makes it "
        "harmless is never looked for — killed by `claude-cli-origin.test.mjs`",
        [
            (
                ORIGIN,
                "        ? mentionsPassReturnsFirst(text) !== null\n",
                "        ? true\n",
            )
        ],
    ),
    # RETIREMENT APPROVED — 680 M24: file-gone; removed by e504ff460ce1a0b5cf1e8b8de9daf5aa46dc0aae.
    # Guarded parser and its test were deliberately removed under the standing rule forbidding
    # reading inside Claude Code; retained loopback wire probe does not replace these parser guarantees,
    # and none are wanted. Definition retained as historical evidence; no row execution.
    (
        "M24 · ⚠️ **any `return` in the guard proves the pass harmless** · one in a nested arrow, "
        "or behind an `if`, reads clean — killed by `claude-cli-origin.test.mjs`",
        [
            (
                ORIGIN,
                "      if (depth === 0 && statementStart && text.startsWith('return', end)) returns = true\n",
                "      if (text.startsWith('return', end)) returns = true\n",
            )
        ],
    ),
    # ── F · what 680's review found ───────────────────────────────────────────────────────────
    (
        "M25 · 🔴 **a notice with NO error word is the speaker's** · 0.3.281's `is_api_error_message` "
        "unread, so a tool call the model could not form reads as its words — killed by `a-refusal-is-not-the-speakers-words.test.ts`",
        [
            (
                REFUSAL,
                "  return (message as unknown as Record<string, unknown>)['is_api_error_message'] === true\n",
                "  return false\n",
            )
        ],
    ),
    (
        "M26 · 🔴 **a reply cut at its limit hands over `CLAUDE_CODE_MAX_OUTPUT_TOKENS`** · the output "
        "limit is not recognised — killed by `a-refusal-is-not-the-speakers-words.test.ts`",
        [
            (
                REFUSAL,
                "  if (limit !== null) return { is: 'reply-cut-at-its-output-limit', limit: limit[1]! }\n",
                "",
            )
        ],
    ),
    (
        "M27 · ⛔ **a replayed `refusal` is trusted** · a later build's kind draws a blank notice and a "
        "`null` stops the fold — killed by `provider-error.test.ts`",
        [
            (
                TRANSCRIPT,
                "      const refusal = knownRefusal(event.refusal)\n",
                "      const refusal = (event.refusal ?? null) as ReturnType<typeof knownRefusal>\n",
            )
        ],
    ),
    (
        "M28 · ⚠️ **the importer's word-less notice is the assistant's** · an archived "
        "`isApiErrorMessage` record keeps its bubble — killed by `raw-archive-import.test.ts`",
        [
            (
                IMPORT,
                "    theClis && (typeof error === 'string' || record['isApiErrorMessage'] === true)\n",
                "    theClis && typeof error === 'string'\n",
            )
        ],
    ),
    (
        "M29 · 🔴 **the importer changed and nothing says so** · older adopted ledgers never read stale, "
        "and the Rebuild is never offered — killed by `raw-archive-import.test.ts`",
        [(NORMALIZER, "export const NORMALIZER_VERSION = 4\n", "export const NORMALIZER_VERSION = 3\n")],
    ),
    # RETIREMENT APPROVED — 680 M30: file-gone; removed by e504ff460ce1a0b5cf1e8b8de9daf5aa46dc0aae.
    # Guarded parser and its test were deliberately removed under the standing rule forbidding
    # reading inside Claude Code; retained loopback wire probe does not replace these parser guarantees,
    # and none are wanted. Definition retained as historical evidence; no row execution.
    (
        "M30 · ⛔ **the guard and the gate need not share an options object** · a guard on another "
        "object proves the pass harmless — killed by `claude-cli-origin.test.mjs`",
        [
            (
                ORIGIN,
                "    const reader = `\"workflow_keyword_request\",()=>Promise.resolve(${options}?.isHumanTypedPrompt`\n",
                "    const reader = `\"workflow_keyword_request\",()=>Promise.resolve(`\n",
            )
        ],
    ),
    # RETIREMENT APPROVED — 680 M31: file-gone; removed by e504ff460ce1a0b5cf1e8b8de9daf5aa46dc0aae.
    # Guarded parser and its test were deliberately removed under the standing rule forbidding
    # reading inside Claude Code; retained loopback wire probe does not replace these parser guarantees,
    # and none are wanted. Definition retained as historical evidence; no row execution.
    (
        "M31 · ⛔ **a guard in ANOTHER function proves the pass harmless** — killed by "
        "`claude-cli-origin.test.mjs`",
        [(ORIGIN, "    if (/\\bfunction\\b/.test(text.slice(end, keyword))) continue\n", "")],
    ),
]
