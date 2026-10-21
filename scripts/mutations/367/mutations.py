"""367 · A mode that says what it does — each row is THE DEFECT, put back verbatim (131).

⛔ **HO-011 §3.2:** *"'Auto-approve' is not what Codex `auto` means. `danger-full-access`, no prompt,
the OS user's full reach is what it means, and that sentence should be **in front of a person before
they choose it** and **visible wherever a session in that mode appears.** Claude's `auto` needs its
own true sentence, including that **`Bash` is an opaque string the structured scan does not see.**"*

⚑ **`171` already did half of this and stopped at one sentence for both providers.** It named the
mode (`AUTO` → `YOLO`), wrote `YOLO_MEANS`, and put it at both moments of choice. What it could not
say is HOW, and the two adapters do opposite things:

 - **Codex** — `APPROVAL_PROFILES`: `ask` is `sandbox: 'read-only'`, `auto` is
   `sandbox: 'danger-full-access'`. Yolo is an OS sandbox coming off.
 - **Claude** — this app hands Claude no sandbox in either mode. `permissionModeFor` asks for
   `'default'` always; `promptGuardHooks` yields on `isAutoApprove` and `handleCanUseTool` returns
   `allow`. Yolo is the CARD coming off, and nothing else.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M5` | ⚑ **desktop** — `a-mode-that-says-what-it-does.test.ts` §1, over the declarations |
| `M6` | ⚑ **desktop** — §2's paste census: the adapter's sentence copied into the renderer |
| `M7`-`M9` | ⚑ **dom** — `a-mode-that-says-what-it-does.dom.test.ts` §1, the launcher |
| `M10`, `M11` | ⚑ **dom** — §3, the drawer |
| `M12`-`M15` | ⚑ **dom** — §2, the pill and its tooltip |
| `M16`, `M17` | ⚑ **desktop** — `a-mode-that-says-what-it-does.render.test.ts`, the guardrails |
| `M18` | 🔴 **dom** — §1's computed-`display` assertion, which a probe screenshot bought |
| `M19`, `M20` | ⚑ **desktop** — `conversation-chrome.render.test.ts`, the Ask/Auto bar and switch |

## ⚠️ What this table deliberately does NOT contain

⛔ **No row that removes the `approvals` entry from `ProviderCapabilities`.** It is a
`Record<Provider, …>` member, so an adapter that stopped declaring it fails to COMPILE — and the
harness's gates are the vitest projects, where a type-only edit is unkillable by construction
(`361`'s own rule). The entry's EXISTENCE is held by the compiler; its CONTENT is what these rows
are about.

⛔ **No row on `describeApprovalMode`.** `367` left it alone on purpose — the drawer states the whole
sentence two lines under that button, so the button's short line is not the surface carrying the
disclosure. `171` M6/M7 already own those two strings, and a second table's rows on one anchor is
how two tables come to disagree about what a line is for.

⛔ **No row that makes both notes the SAME by editing the shared half.** `YOLO_MEANS` is `171`'s and
`171` M12 is the row for it. What this table adds is the half that must DIFFER, and `M1` is the
distinctness row: one sentence for both is the defect this dispatch is named after.
"""

from __future__ import annotations

CODEX = "packages/runtime/src/codex/capabilities.ts"
CLAUDE = "packages/runtime/src/claude/capabilities.ts"
LAUNCHER = "apps/desktop/src/renderer/src/components/NewConversation.vue"
CONTROLS = "apps/desktop/src/renderer/src/components/SessionControls.vue"
HEADER = "apps/desktop/src/renderer/src/components/SessionHeader.vue"
RECRUIT = "apps/desktop/src/renderer/src/components/RecruitSheet.vue"

# ⚑ **736 · corrected in place, not retired** (twice: at its review the note also says the home's
# `config.toml` can open the bound) — R96 made `ask` the Codex CLI's default preset
# (`workspace-write`), so the write clause moved (measured: the folder and `/tmp` unasked). The
# subject of every row anchored here — the note that says what the mode takes off — is unchanged.
CODEX_NOTE = (
    "    note: 'On Codex this mode takes the sandbox off: with approvals on it writes in your folder "
    "and the temporary folders without asking, and cannot write anywhere else or reach the network "
    "unless you approve it or the config.toml of this identity opens it; with them off it runs "
    "danger-full-access, which applies no sandbox at "
    "all. Neither mode limits what it can read.',\n"
)
# ⚑ `726` (R92) cut the clause about *"the only check left"* — the path scan is gone — so M1, M3 and
# M4 are re-anchored in place onto the note as it now stands. ⚠️ M4's mutant — a note promising *"the
# only check left refuses any path inside this app’s own data"* — is still a defect: since R92 there
# is no such check, so the sentence would be false in the reassuring direction.
# ⚑ **728 · re-anchored in place, not retired** — 728 (R93) says the planning exception in the same
# sentence; the three rows reading this keep their subjects (M3, M4, and the Codex note wearing it).
CLAUDE_NOTE = "    note: 'On Claude nothing is sandboxed in either mode. What this mode removes is the card, except while Claude is planning: its own plan mode still asks, as the CLI’s does.',\n"


MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the declarations ───────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT THIS DISPATCH IS NAMED AFTER: one sentence for both providers · Codex "
        "is declared with Claude's note, so the app says the same thing to two adapters that do "
        "opposite things — which is exactly what `329` had to fix once already on `homeCredential`",
        [(CODEX, CODEX_NOTE, CLAUDE_NOTE)],
    ),
    (
        "M2 · 🔴 THE SENTENCE THE PM RELAYED FROM `366` MID-DISPATCH: the Codex half is written as "
        "CONTAINMENT · *runs read-only and waits for you* reads as reach, and `366` read a planted "
        "file outside the workspace under every Codex profile — the sandbox narrows writes and "
        "network, and `ask` buys consent rather than containment (HO-011 §2)",
        [
            (
                CODEX,
                CODEX_NOTE,
                "    note: 'On Codex this mode takes the sandbox off: with approvals on, Codex runs "
                "read-only and waits for you; with them off it runs danger-full-access, which "
                "applies no sandbox at all.',\n",
            )
        ],
    ),
    (
        "M3 · 🔴 the Codex sentence wearing Claude's name: Claude is declared as a sandbox coming "
        "off · there was never one, in either mode, and a reader told otherwise would believe `ask` "
        "confines a Claude session",
        [
            (
                CLAUDE,
                CLAUDE_NOTE,
                "    note: 'On Claude this mode is the sandbox coming off: with approvals on the "
                "session is confined to its working directory, and with them off it is not.',\n",
            )
        ],
    ),
    (
        "M4 · ⛔ the HOLE is dropped from Claude's sentence and the CHECK is described as a "
        "guarantee · *the app refuses its own data* is the overstatement `168 H1` measured a `Bash` "
        "command walking past in both modes, and `171` corrected the same one in `refusalMessage`",
        [
            (
                CLAUDE,
                CLAUDE_NOTE,
                "    note: 'On Claude nothing is sandboxed in either mode. What this mode removes "
                "is the card; the only check left refuses any path inside this app’s own data.',\n",
            )
        ],
    ),
    (
        "M5 · the note is emptied to the empty string the optional field allows · the entry is "
        "still `available`, still compiles, and discloses nothing — the shape a declaration decays "
        "into when nobody asserts that it SAYS something",
        [(CODEX, CODEX_NOTE, "    note: '',\n")],
    ),
    # ── §2 · the words leak into the renderer ───────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING:** the launcher no longer shows a mode sentence, so there is no copy of the adapter's (daa7c0144, the approved first-run design).
        "M6 · ⛔ 039's own defect: the launcher keeps a COPY of the adapter's sentence as a "
        "fallback · it names no provider, so the neutrality census cannot see it, and it goes stale "
        "the first time an adapter's policy moves",
        [
            (
                LAUNCHER,
                "  return status?.state === 'available' ? (status.note ?? '') : ''\n})\n",
                "  return status?.state === 'available'\n    ? (status.note ?? '')\n    : 'On "
                "Codex this mode is the sandbox coming off: with approvals on, Codex runs "
                "read-only and waits for you; with them off it runs danger-full-access, which "
                "applies no sandbox profile at all.'\n})\n",
            )
        ],
    ),
    # ── §3 · before a person chooses it ─────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING:** the launcher's mode sentence is gone; the first choice says Ask or Auto in plain words (daa7c0144, the approved first-run design).
        "M7 · 🔴 §2.1 · the launcher stops saying the differing half, so the moment of choice is "
        "back to `171`'s one sentence for both — the state this dispatch was sent to fix",
        [
            (
                LAUNCHER,
                # ⚠️ The span is nested inside the wrapper `M18` is about, hence the indent and the
                # closing `</span>` that belongs to the wrapper staying put.
                '              <span v-if="yoloReach" data-cy="yolo-reach">{{ yoloReach }}</span>',
                "",
            )
        ],
    ),
    (
        "M8 · ⛔ the launcher reads a FIXED provider instead of the selected one · every launcher "
        "capability line was this shape once (`planAvailable`), and it is right on the day it is "
        "written",
        [
            (
                LAUNCHER,
                "  const status = props.capabilities?.[provider.value]?.approvals\n",
                "  const status = props.capabilities?.['claude']?.approvals\n",
            )
        ],
    ),
    (
        "M9 · the launcher reads the WRONG capability · `planMode` is `available` on both providers "
        "with a note of its own, so the surface renders a true sentence about the wrong subject and "
        "nothing looks broken",
        [
            (
                LAUNCHER,
                "  const status = props.capabilities?.[provider.value]?.approvals\n",
                "  const status = props.capabilities?.[provider.value]?.planMode\n",
            )
        ],
    ),
    # ── §4 · the other moment of choice ─────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING:** the card's yolo panel and its reach sentence are gone; M19 and M20 hold the mode on the bar and the switch (daa7c0144, the approved first-run design).
        "M10 · ⛔ Controls stops saying it, so a conversation switched to yolo mid-flight is told "
        "strictly less than one launched into it — the drift `171 §3`'s shared constant existed to "
        "prevent, reappearing one clause along · killed by `a-mode-that-says-what-it-does.dom.test.ts` · killed by `yolo-disclosure.dom.test.ts`",
        [
            (
                "apps/desktop/src/renderer/src/components/CardApproval.vue",
                # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · d21b3125 removed SessionControls.vue and moved the approval mode onto the agent card, whose panel renders the provider's own yolo sentence; the plant still drops that sentence where a running conversation switches mode. The row's file moves to CardApproval.vue.
                "          <span v-if=\"props.approval.reach\" data-cy=\"yolo-reach\">{{ props.approval.reach }}</span>\n",
                "",
            )
        ],
    ),
    (
        "M11 · Controls reads the LAUNCHER's question — a fixed provider — rather than the one this "
        "session is actually running · killed by `a-mode-that-says-what-it-does.dom.test.ts`",
        [
            (
                "apps/desktop/src/renderer/src/composables/useConversationControls.ts",
                # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · d21b3125 moved the approval reading out of SessionControls.vue into useConversationControls.ts; the plant still reads one fixed provider's sentence instead of the session's own. The row's file moves to useConversationControls.ts.
                "    const status = capabilities?.[session.provider]?.approvals\n",
                "    const status = capabilities?.['codex']?.approvals\n",
            )
        ],
    ),
    # ── §5 · wherever a session in that mode appears ────────────────────────────────────────────
    (
        "M12 · 🔴 §2.2 · the REACH half is dropped, so the disclosure describes the PROMPT and says "
        "nothing about how far the thing that did not ask can reach — the half HO-011 §3.2 asked "
        "for. "
        "🔴 RE-AIMED BY 579 relay 3b, and the reason is a REVERSAL this row must not hide. ⛔ It "
        "edited the header PILL, on `367 §2`'s rule: *\"a tooltip is not a disclosure; the reach "
        "clause is IN the pill.\"* ⚠️ **the person reversed that**, shown the sentence and asked again: "
        "*\"it should only say YOLO. No need for the 'nothing is confirmed…' or whatever.\"* "
        "⚑ **So the pill carries neither clause and there is nothing there to drop** — the row "
        "would have been a no-op wearing a rule's name "
        "(`a-mutation-that-changes-nothing-reports-as-a-survivor`). "
        "⛔ **What survives of `367 §2` is that both halves are DISCLOSED**, and both are in "
        "`yoloTitle` now, in plain words. ⚑ The rule the row measures is unchanged: a disclosure "
        "of this mode that names the prompt and not the reach is half a disclosure. "
        "🔴 RE-VERIFIED BY HAND AT 579: applied alone, RED 1 — `the-conversation-header.test.ts` "
        "§2, *the mark that came back to the bar is one word, with both facts in its title*; "
        "restored from bytes and hash-checked",
        [
            (
                HEADER,
                # ⚑ **728 · re-anchored in place, not retired** — 728 (R93) says the planning exception in the same sentence; the row's subject is unchanged
                "without asking, except what the provider’s own plan mode asks while it plans, and nothing this app configures confines them.",
                "without asking, except what the provider’s own plan mode asks while it plans.",
            )
        ],
    ),
    (
        "M13 · ⛔ the disclosure claims the OPPOSITE of what was measured · *this app confines them* "
        "on a mode that on Codex is `danger-full-access` and on Claude was never confined at all. "
        "🔴 RE-AIMED BY 579 relay 3b onto `yoloTitle`, for `M12`'s reason and with `M12`'s caveat: "
        "the pill this row edited says one word now, and the claim it inverts lives in the title. "
        "⚠️ **`364` measured the reach on BOTH providers** — no sandbox, the login's own scope — so "
        "this is still the row that catches a sentence saying the app holds a boundary it does not "
        "have, which is `168 H1`'s defect verbatim. "
        "🔴 RE-VERIFIED BY HAND AT 579 — and it SURVIVED the first attempt, which is the most "
        "useful thing this row has ever done. ⛔ The re-aimed killer asserted the title "
        "`toContain('confines them')`, and this mutant's *\"and THIS APP confines them\"* — the "
        "exact opposite claim, `168 H1`'s defect verbatim — satisfies that as a SUBSTRING. "
        "⚠️ **A test that cannot tell a sentence from its inverse is not testing the sentence**, "
        "and it had been written the same hour. ⚑ The assertion now names the negation "
        "(`nothing this app configures confines them`) and forbids the inverse by pattern. "
        "🔴 RED 2 after that correction — `the-conversation-header.test.ts` §2 and "
        "`dom/a-mode-that-says-what-it-does.dom.test.ts` §2, because the SAME weak assertion had "
        "been written into both files in the same hour; restored from bytes and hash-checked",
        [
            (
                HEADER,
                'and nothing this app configures confines them.',
                'and this app confines them.',
            )
        ],
    ),
    (
        "M14 · the tooltip drops the adapter's declared sentence and keeps only this file's own "
        "words · the pill is then provider-blind in both halves, and the difference `364` measured "
        "is stated nowhere on this surface · killed by `a-mode-that-says-what-it-does.dom.test.ts`",
        [
            (
                HEADER,
                # ⚑ **728 · re-anchored in place, not retired** — 728 (R93) says the planning exception in the same sentence; the row's subject is unchanged
                # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · d21b3125 changed the tooltip's last sentence from the Controls tab to the Open tab; the plant still drops the provider's declared sentence from the yolo pill's tooltip.
                "nothing this app configures confines them. ${declared ?? ''} Change it in the drawer’s Open tab.`",
                "nothing this app configures confines them. Change it in the drawer’s Open tab.`",
            )
        ],
    ),
    (
        "M15 · the pill's tooltip recognises a provider instead of indexing one — the exact line "
        "`planTitle`'s first draft carried, which the neutrality census caught within the minute",
        [
            (
                HEADER,
                "  const status = session ? props.capabilities?.[session.provider]?.approvals : undefined\n",
                "  const status = session ? props.capabilities?.['claude']?.approvals : undefined\n",
            )
        ],
    ),
    (
        "M18 · 🔴 THE DEFECT A SCREENSHOT FOUND AND EVERY DOM ASSERTION MISSED: the wrapper comes "
        "off, so `.note`'s `display: flex` blockifies the reach into a SECOND FLEX ITEM and the "
        "launcher renders one sentence as two columns — inside the paragraph, with a height, "
        "outside the fold, and unreadable",
        [
            (
                LAUNCHER,
                "            <span\n              >{{ YOLO_MEANS }}\n"
                '              <span v-if="yoloReach" data-cy="yolo-reach">{{ yoloReach }}</span></span\n'
                "            >\n",
                "            {{ YOLO_MEANS }}\n"
                '            <span v-if="yoloReach" data-cy="yolo-reach">{{ yoloReach }}</span>\n',
            )
        ],
    ),
    # ── §6 · the preview that asserted a rail ───────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `RecruitSheet.vue` (the recruiting
        # sheet, with its dispatch-side guardrail text) is deleted by D-016a with the project and
        # proposal surfaces. The guardrail wording it carried is not rendered anywhere now. Its
        # anchor is left stale, so the census records it retired.
        "M16 · 🔴 §3 · the recruiting sheet's guardrails go back to asserting rails the app does "
        "not hold · `364`: *no production mutation* and *no deployment* are neither enforced nor "
        "rendered — and HO-035 has since withdrawn both as product invariants, so they are a "
        "person's own brief for ever rather than a rail scheduled for Slice 6, which is what the "
        "quote block this row deletes actually says ⚑ REASON CORRECTED IN PLACE BY 497",
        [
            (
                RECRUIT,
                "> ⚠️ These are what the PM would WRITE INTO this agent's instructions. BroBot2 enforces none of\n"
                "> them: nothing in the app checks a branch, a deployment or a dispatch document, and the approvals\n"
                "> setting below is the launcher's checkbox rather than a rail. Read them as the brief, not as a\n"
                "> boundary.\n\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** Same file as M16: `RecruitSheet.vue`
        # is deleted by D-016a, and with it the 'Auto-approve stays off: the first command or write
        # freezes for approval' bullet. Nothing else renders that sentence. Its anchor is left
        # stale, so the census records it retired.
        "M17 · ⛔ the bullet `364` did not name comes back · a mode rail claimed in the vocabulary "
        "`171` retired, on a sheet that wires nothing — *Auto-approve stays off: the first command "
        "or write freezes for approval*",
        [
            (
                RECRUIT,
                "- Yolo stays off, so the first command or write waits for you.",
                "- Auto-approve stays off: the first command or write freezes for approval.",
            )
        ],
    ),
    # ── the Ask/Auto bar and switch, which state the conversation's mode after the first-run design ──
    (
        # ⚑ New with the approved first-run design, which removed the yolo panel M10 was anchored in.
        # M10's intent, that the conversation's surfaces state the mode it runs in, now sits on the
        # bar's Ask/Auto mark and the card's switch.
        "M19 · 🔴 the bar says Ask over a conversation running in Auto · the mark stops reading the "
        "session's mode, so the one surface on screen without the drawer open tells a person they "
        "are being asked when nothing will ask · killed by `conversation-chrome.render.test.ts`",
        [
            (
                HEADER,
                "{{ session.approvalMode === 'auto' ? 'Auto' : 'Ask' }}",
                "{{ 'Ask' }}",
            )
        ],
    ),
    (
        "M20 · ⛔ the card's switch stops reading the mode · it draws Ask for a conversation running "
        "in Auto, so the control that changes the mode states the wrong one · killed by "
        "`conversation-chrome.render.test.ts`",
        [
            (
                "apps/desktop/src/renderer/src/components/CardApproval.vue",
                "      :checked=\"props.approval.mode === 'auto'\"\n",
                "",
            )
        ],
    ),
]

