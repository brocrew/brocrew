"""457 · What a tool answered — the row a person reads on the provider a fresh install runs.

⛔ **`448` §E4 measured the defect and priced the fix; this is the price.** `itemSummary` had no
`dynamicToolCall` branch and fell through to `return type`, so both rows of every BroBot tool call
on Codex summarised as the literal word `dynamicToolCall` — `405`'s recorded pair, of which only
the NAME was rescued at `348`.

🔴 **It is not cosmetic.** BroBot's whole front door is tool calls, `DEFAULT_PROVIDER` is `codex`,
and the person's database stores no choice — so on the provider he is actually using, the answer to
every question he asks rendered as one meaningless word. `447` could not attribute a defect
because of it.

## ⚑ Measured off the wire BEFORE anything was built

`packages/runtime/smoke/codex-tool-answer-probe.smoke.ts` drives the pinned app-server through a
loopback Responses endpoint — no credential, no model turn — and reproduces the pair in under two
seconds. Three facts came out of it and every row below rests on one of them:

| fact | consequence |
|---|---|
| `arguments` is present on BOTH phases | the CALL row reads it |
| `contentItems` is `null` on `item/started` and populated on `item/completed` | only the RESULT row may read it |
| two `inputText` items reach the model as ONE newline-joined string | splitting prose from payload is invisible to the model |

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M2` | ⚑ **`packages/runtime/test/what-a-tool-answered.test.ts`** §1 — the call row |
| `M3`-`M8`, `M13`, `M15` | ⚑ **`packages/runtime/test/what-a-tool-answered.test.ts`** §2 — the result row |
| `M14` | ⚑ **`packages/runtime/test/what-a-tool-answered.test.ts`** §3 — the union property |
| `M9`-`M10` | ⚑ **`packages/runtime/test/codex-agent-tools.test.ts`** — the two content items |
| `M11`-`M12` | ⚑ **`apps/desktop/test/a-list-that-notices.test.ts`** §1c — the ack as the gate |

## ⛔ What this table deliberately does NOT contain

⚠️ **No row restoring `return type` at `itemSummary`'s fall-through.** After this dispatch every
kind `itemCategory` calls a tool has a branch, so the fall-through is unreachable and an edit to
`UNSUMMARISED_TOOL_KIND` changes no byte any reader can see — it would report as a survivor
(`a-mutation-that-changes-nothing-reports-as-a-survivor`).

⛔ **The rule is carried by §3 instead — and a first draft of this paragraph was WRONG about how.**
§3 derives the tool kinds from the generated `ThreadItem.ts` and requires each summary to differ
from its own discriminant. ⚠️ **That alone does not carry it**: a nineteenth kind classified
`'tool'` and forgotten in `itemSummary` answers `UNSUMMARISED_TOOL_KIND`, which is not its
discriminant, so the property passed while every row of that kind said one meaningless sentence.
🔴 **This dispatch's own review found it.** §3 now asserts BOTH strings, and `M14` is the row that
proves the second assertion fires — `fileChange` standing in for the kind nobody has added yet.

⚠️ **No row on `mcpDuration`.** `dynamicToolCall` declares a `durationMs` and the probe measured it
arriving (4 ms), but `327` restricted that read to `mcpToolCall` on purpose and named widening it
as a follow-on. Carrying it here would change the duration on every shell row, which is not what
this dispatch was asked for — it is a finding in the response.

⚠️ **No row making the store return `value` regardless of `ok`.** `forSession` answers
`{ok: false}` with no `value` at all, so the edit changes nothing on either path.
"""

NORM = "packages/runtime/src/codex/normalize.ts"
TOOLS = "packages/runtime/src/codex/agent-tools.ts"
JOIN = "apps/desktop/src/renderer/src/lib/decide-proposal.ts"

MUTATIONS = [
    # ── §1 · the call row ───────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT 448 §E4 MEASURED, restored · the dynamic branch goes and the row falls "
        "through again, so every BroBot tool call on Codex summarises as a protocol discriminator "
        "— 405's recorded pair, reproduced",
        [
            (
                NORM,
                "  if (type === 'mcpToolCall' || type === 'dynamicToolCall') return argumentsSummary(item)",
                "  if (type === 'mcpToolCall') return argumentsSummary(item)",
            )
        ],
    ),
    (
        "M2 · ⛔ the CALL row reads what came BACK · `contentItems` is null on every item/started, "
        "measured, so the row says `done` about a call that has not answered yet",
        [
            (
                NORM,
                "  if (type === 'mcpToolCall' || type === 'dynamicToolCall') return argumentsSummary(item)",
                "  if (type === 'mcpToolCall') return argumentsSummary(item)\n"
                "  if (type === 'dynamicToolCall') return dynamicResultSummary(item)",
            )
        ],
    ),
    # ── §2 · the result row ─────────────────────────────────────────────────────────────────────
    (
        "M3 · 🔴 the RESULT row repeats the call again · the dynamic arm leaves `resultSummary`, so "
        "the answer half of 457 is gone and the row shows the arguments twice",
        [
            (
                NORM,
                "  if (type === 'dynamicToolCall') return dynamicResultSummary(item)\n  return calledWith",
                "  return calledWith",
            )
        ],
    ),
    (
        "M4 · ⛔ every text item is joined rather than the first · the payload returns to the row, "
        "which is the 31-characters-of-answer-and-169-of-JSON measurement this dispatch exists to "
        "remove",
        [
            (
                NORM,
                "      if (text) return boundedSummary(text)\n      continue",
                "      if (text) return boundedSummary(\n"
                "        content\n"
                "          .map((each) => (isRecord(each) && typeof each['text'] === 'string' ? each['text'] : ''))\n"
                "          .join(' '),\n"
                "      )\n      continue",
            )
        ],
    ),
    (
        "M5 · ⚠️ the FIRST item wins even when it is empty · a tool whose prose half is blank gets "
        "a row that says `done` about an answer it actually sent",
        [
            (
                NORM,
                "      const text = typeof one['text'] === 'string' ? oneLine(one['text']) : ''\n"
                "      if (text) return boundedSummary(text)\n      continue",
                "      return boundedSummary(typeof one['text'] === 'string' ? oneLine(one['text']) : '')",
            )
        ],
    ),
    (
        "M6 · ⛔ no content becomes an empty row rather than Claude's word · `item/started` carries "
        "`contentItems: null` on every dynamic call, measured, so this is the commonest shape",
        [(NORM, "  if (!Array.isArray(content)) return 'done'", "  if (!Array.isArray(content)) return ''")],
    ),
    (
        "M7 · 🔴 an image answer puts its base64 data URL on the row · written to the ledger and "
        "cloned across IPC for the life of the session, which is 052's problem through a new door",
        [
            (
                NORM,
                "  inputImage: 'an image',",
                "  inputImage: '',",
            )
        ],
    ),
    (
        "M8 · ⚠️ the bound stops saying how much it dropped · `truncate` for `boundedSummary`, so a "
        "201-character answer and a 90,000-character one read the same — 187 §2's rule, and the "
        "exact defect 327 §2.3 measured one kind over",
        [
            (
                NORM,
                "      if (text) return boundedSummary(text)",
                "      if (text) return truncate(text)",
            )
        ],
    ),
    (
        "M13 · 🔴 the closed vocabulary is read with `in` rather than `hasOwn` · 068 F3's hazard, "
        "which this dispatch reintroduced and its own review caught: a wire item declaring "
        "`{type: 'toString'}` puts `function toString() { [native code] }` on a person's row",
        [
            (
                NORM,
                "    if (!notWords && typeof kind === 'string' && Object.hasOwn(NON_TEXT_ANSWER, kind)) {",
                "    if (!notWords && typeof kind === 'string' && kind in NON_TEXT_ANSWER) {",
            )
        ],
    ),
    (
        "M14 · 🔴 a tool kind loses its branch and lands on the FALL-THROUGH · `fileChange` is the "
        "proxy for the nineteenth kind somebody classifies and forgets: the row says `a tool call "
        "this app cannot describe yet` to a person, and `summary !== type` cannot see it",
        [
            (
                NORM,
                "  if (type === 'fileChange') return 'file change'\n",
                "",
            )
        ],
    ),
    (
        "M15 · ⛔ a picture short-circuits the sentence beside it · returning on the first non-text "
        "item shows `an image` about an answer that said something — the draft this dispatch's own "
        "review caught",
        [
            (
                NORM,
                "      notWords =\n"
                "        NON_TEXT_ANSWER[kind as Exclude<DynamicToolCallOutputContentItem['type'], 'inputText'>]",
                "      return NON_TEXT_ANSWER[\n"
                "        kind as Exclude<DynamicToolCallOutputContentItem['type'], 'inputText'>\n"
                "      ]",
            )
        ],
    ),
    # ── the two content items ───────────────────────────────────────────────────────────────────
    # Re-anchored, NOT VERIFIED; no mutant or killer was run.
    (
        "M9 · 🔴 the payload goes back into the prose item · one joined item is what 348 sent and "
        "what made the row mostly JSON; the model cannot tell, which is why only a test can",
        [('packages/runtime/src/codex/agent-tools.ts', "  return { contentItems: [{ type: 'inputText', text: answer.text }], success: true }", "  return { contentItems: [{ type: 'inputText', text: answer.structured === undefined ? answer.text : `${answer.text}\\n${JSON.stringify(answer.structured)}` }], success: true }")],
    ),
    # RETIRED: the former JSON/order/echo contract was removed.
    (
        "M10 · ⛔ the payload goes FIRST · the half written for a machine takes the 200 characters "
        "the half written for a person needs, which is 448's ordering ruling inverted",
        [
            (
                TOOLS,
                "      ...(answer.text ? [{ type: 'inputText' as const, text: answer.text }] : []),\n"
                "      ...(answer.structured === undefined\n"
                "        ? []\n"
                "        : [{ type: 'inputText' as const, text: JSON.stringify(answer.structured) }]),",
                "      ...(answer.structured === undefined\n"
                "        ? []\n"
                "        : [{ type: 'inputText' as const, text: JSON.stringify(answer.structured) }]),\n"
                "      ...(answer.text ? [{ type: 'inputText' as const, text: answer.text }] : []),",
            )
        ],
    ),
    # ── the ack as the gate ─────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** decide-proposal.ts is deleted in
        # bd70d693 ('Proposals go end to end') and a-list-that-notices.test.ts, its killer, is
        # deleted too. The gate on a host-agreed approval belonged to the proposal decide door,
        # which no longer exists. Its anchor is left stale, so the census records it retired.
        "M11 · 🔴 the join goes back to gating on `approve` alone · an approval the host REFUSED "
        "re-reads both rosters, and the agent one writes a loadError that CapabilitiesSheet draws "
        "as its whole body — 448 §E5, restored",
        [
            (
                JOIN,
                "  if (approve && ack?.outcome === 'taken')",
                "  if (approve)",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** Same subject as M11: `decideProposal`
        # and its `ack?.outcome === 'taken'` gate are deleted with proposals (bd70d693), along with
        # the killer test a-list-that-notices.test.ts. The name-collision refusal it protected no
        # longer has a caller. Its anchor is left stale, so the census records it retired.
        "M12 · ⛔ any answer counts as agreement · `ack !== undefined` admits every refusal the "
        "host makes, including the name collision that leaves the card answerable and creates "
        "nothing",
        [
            (
                JOIN,
                "  if (approve && ack?.outcome === 'taken')",
                "  if (approve && ack !== undefined)",
            )
        ],
    ),
]
