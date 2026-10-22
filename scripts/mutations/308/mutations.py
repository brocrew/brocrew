#!/usr/bin/env python3
"""308's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **The defect was one sentence, and the deliverable is that it can no longer be one.** The Claude
config block told the user *"MCP servers, tools and prompt are passed as SDK query() options"*. Tools
and the prompt are. **MCP servers are not** — `optionsFor` in `claude-runtime.ts` has no `mcpServers`
member, and `307` proved it the expensive way: to measure whether the option would work it had to
inject one at the `QueryFactory` seam, because the adapter's options object has nowhere to put it.
⚠️ `strictMcpConfig: true` then excludes file and project config as well, so a Claude session here
gets MCP servers from **nowhere**, and the one sentence a user reads to find out where to add one
told them the app already handled it. That is HO-002 §5 acceptance #7 — *nothing unwired implies a
working state* — failing inside a criterion reported closed.

⚑ **So the sentence is now RENDERED from a typed table** (`CLAUDE_SDK_OPTIONS`), and the table is
checked against the adapter's own source **in both directions** by
`apps/desktop/test/disclosure-answers-to-the-code.test.ts`. `M1` is the original defect expressed in
that table; the rest are the ways the arrangement can rot.

| rows | the defect is caught by |
|---|---|
| `M1`-`M5` | ⚑ **`desktop`** — the disclosure lying about the adapter, in five different shapes |
| `M7`-`M11` | ⚑ **`desktop`** — the CHECK weakened until it stops discriminating; each is killed by a control written for it |
| `M6`, `M12` | ⚑ **`shared`** — the provider descriptor snapshot pins the exact disclosure text |

## ⛔ What this table cannot reach, said out loud

⚠️ **`M12` records the bound of the source-derived check.** The table is held to the adapter and the
sentence is held to NAME every member of the table — so a row cannot go unmentioned and a mention
cannot be invented. That check alone cannot detect English that names every option but describes
its stance wrongly. The provider descriptor snapshot now kills `M12` by pinning the exact rendered
sentence. It detects a text change; it does not interpret the sentence or derive its meaning from
the adapter.

⚠️ **`M6` is the Codex half**, and it is the second finding of the sweep rather than the first. The
`auth.json` note said *"the machine credential, copied in once at 0600"*. That is the PROVISIONING
rule and the app ships two gestures that write the file afterwards — `reprovisionCodexAuth`
overwrites it from `~/.codex`, and `startCodexLogin` has the app-server mint a brand-new credential
into the home, after which the file is that profile's own login and not the machine's at all.
The original whole-suite measurement left that wording alive: **5,827 of 5,828 green**, with only
`mutation-census.test.mjs` red. That check fires for any edit to a tracked file, so it was not
evidence of a semantic guard. The provider descriptor snapshot now kills `M6` by pinning the exact
credential note. As with `M12`, this catches a change to reviewed text; it does not derive the
credential's provenance from the sign-in implementation.

⚠️ **No row mutates `claude-runtime.ts`.** The test READS it and 24 other tables MUTATE it; a row
here that moved `strictMcpConfig` or deleted `tools:` would be measuring somebody else's anchor.
`308` changes no adapter behaviour at all — §4 of the dispatch is explicit that wiring MCP up is the
tools slice's job and needs the PO's Slice 3 specification first.

⚠️ Like 240, 243, 247, 248, 250, 251, 254, 258, 262, 292, 300, 301 and 306, this table does NOT
mutate the harness it is run by, and it touches no other dispatch's table.
"""

from __future__ import annotations

import sys
from pathlib import Path

CFG = "apps/desktop/src/main/runtime/provider-config.ts"
TEST = "apps/desktop/test/disclosure-answers-to-the-code.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── the disclosure lying about the adapter ────────────────────────────────────────────────
    (
        "M1 · ⛔ THE defect, put back — with its SIDES SWAPPED by 347, because the fact it lies "
        "about has moved. ⚠️ Until 347 the adapter passed no `mcpServers` and the lie was to claim "
        "it did; 347 makes it pass an in-process MCP server carrying the session's own tools, so "
        "the lie is now to claim it does NOT. ⛔ The row is corrected rather than retired: it "
        "protects the same rule it always did — the one sentence a user reads about where their "
        "tools come from may not disagree with `optionsFor` — and a retired row would have left "
        "that rule unguarded in the direction that is now reachable. ⚑ HO-002 §5 acceptance #7: "
        "nothing unwired may imply a working state, and nothing wired may imply an unwired one. "
        "⚠️ **Re-anchored a second time by `516`**, which widened the LABEL because the option now "
        "carries a person's registered external servers as well — the row's rule is untouched and "
        "only the bytes it is measured against moved",
        [
            (
                # Provider facts live in the shared registry; this row plants the same fault there.
                "packages/shared/src/providers/configuration.ts",
                "    option: 'mcpServers',\n"
                "    label: \"this session's own tools and any external servers granted to it, as MCP servers\",\n"
                "    stance: 'passed',\n",
                "    option: 'mcpServers',\n"
                "    label: \"this session's own tools and any external servers granted to it, as MCP servers\",\n"
                "    stance: 'absent',\n",
            )
        ],
    ),
    (
        "M2 · ⛔ …and the quieter half of the same defect: the row is deleted, so the app stops "
        "saying anything about MCP at all. ⚠️ Silence is what the surface had before `307` looked, "
        "and it is why nobody noticed — an absent claim is not a corrected one (`074`). ⚑ Anchor "
        "corrected by 347 with the row's rule untouched; after 347 the deletion also silences the "
        "one line telling a person their agent CAN reach the app. ⚠️ **Re-anchored a second time by "
        "`516`**, which widened the label; the deletion is the same deletion",
        [
            (
                # Provider facts live in the shared registry; this row plants the same fault there.
                "packages/shared/src/providers/configuration.ts",
                "  {\n"
                "    option: 'mcpServers',\n"
                "    label: \"this session's own tools and any external servers granted to it, as MCP servers\",\n"
                "    stance: 'passed',\n"
                "  },\n",
                "",
            )
        ],
    ),
    (
        "M3 · 🔴 a SECOND MCP claim, hand-written into a file note where nothing checks it — the "
        "exact shape the original defect had, and `169` §1's rule (*one rule in two places drifts*) "
        "in the one place this app had already been bitten by it",
        [
            (
                # Provider facts live in the shared registry; this row plants the same fault there.
                "packages/shared/src/providers/configuration.ts",
                "{ name: '.claude.json', note: \"the SDK's own state — not a file you edit to add tools\" },",
                "{ name: '.claude.json', note: \"the SDK's own state — add MCP servers here\" },",
            )
        ],
    ),
    (
        "M4 · ⛔ the block spells an option the adapter does not set. ⚠️ Not a typo row: this is how "
        "a disclosure goes stale after a rename, and the user is left setting something that "
        "reaches nothing",
        [
            (
                # Provider facts live in the shared registry; this row plants the same fault there.
                "packages/shared/src/providers/configuration.ts",
                "  { option: 'settingSources', label: 'settingSources: []', stance: 'pinned' },",
                "  { option: 'settingSource', label: 'settingSources: []', stance: 'pinned' },",
            )
        ],
    ),
    (
        "M5 · ⛔ the block names an environment variable the adapter never points at the provider "
        "home. ⚑ The one claim on this surface a user can ACT on — it is how they would export a "
        "home by hand — and `CLAUDE_CONFIG_DIR` is the variable whose emptiness `childEnvAdditions` "
        "refuses a launch over",
        # This row follows the same behavior after provider facts moved into the registry.
        # ⚑ **provider registry · re-anchored in place, not retired** — The config layout moved into shared data; naming the wrong home variable restores the same error.
        [("packages/shared/src/providers/configuration.ts", "  homeEnv: 'CLAUDE_CONFIG_DIR',\n", "  homeEnv: 'CLAUDE_HOME',\n")],
    ),
    (
        "M6 · ⚠️ the Codex credential note goes back to *'the machine credential, copied in once at "
        "0600'* — true of `provisionCodexAuth` and false of the home, because `reprovisionCodexAuth` "
        "overwrites it and `startCodexLogin` mints a new one into it. The provider descriptor "
        "snapshot kills this row by pinning the exact reviewed note; it does not derive the "
        "credential's provenance from the sign-in implementation",
        [
            (
                # This row follows the same behavior after provider facts moved into the registry.
                "packages/shared/src/providers/configuration.ts",
                # The referenced sign-in button was renamed; the row keeps its credential-provenance defect.
                # ⚑ **provider registry · re-anchored in place, not retired** — The credential note moved with the layout; the old wording still misstates the profile credential as a one-time machine copy.
                "      note: 'the credential this profile runs on, at 0600 — copied from ~/.codex, or minted here by \"Sign in for this agent\"',\n",
                "      note: 'the machine credential, copied in once at 0600',\n",
            )
        ],
    ),
    # ── the check weakened until it stops discriminating ──────────────────────────────────────
    (
        "M7 · 🔴 the comparison is computed over NOTHING — `193`'s vacuity in the guard written to "
        "stop a disclosure drifting. Every claim in the table could be false and the rule would "
        "still print an empty list. ⚑ Killed by the §3 control block, which feeds `disagreements` a "
        "synthetic Slice 3 table and demands a NAMED disagreement back",
        [
            (
                TEST,
                "  return claims\n    .filter((claim) => (claim.stance === 'absent') === passed.has(claim.option))",
                "  return claims\n    .filter(() => false)\n    .filter((claim) => (claim.stance === 'absent') === passed.has(claim.option))",
            )
        ],
    ),
    (
        "M8 · ⛔ the MCP matcher narrows to the one literal the defect happened to use — *'one "
        "string literal wide'*, the seam class this codebase has hit repeatedly. A reworded claim "
        "(*'mcp servers are forwarded'*) then walks straight past it. ⚑ Killed by the §3 controls, "
        "which is the whole reason they are assertions and not a paragraph",
        [
            (
                TEST,
                "const namesMcp = (text: string): boolean => /\\bmcp\\b/i.test(text)",
                "const namesMcp = (text: string): boolean => text.includes('MCP servers')",
            )
        ],
    ),
    (
        "M9 · 🔴 the escape hatch is widened to hide the very word it exists to catch, so a "
        "hand-written `mcpServers` in any disclosure string passes the camelCase rule. ⚠️ This row "
        "is why the hatch is held shut from BOTH sides — it may name nothing the options literal "
        "knows, and nothing the disclosure itself claims",
        [(TEST, "const NOT_AN_OPTION = ['macOS']", "const NOT_AN_OPTION = ['macOS', 'mcpServers']")],
    ),
    (
        "M10 · ⛔ the scan loses its scoping to the `Options` literal and reads the whole of "
        "`optionsFor`, so keys of nested objects — `type`, `preset`, anything in a local — start "
        "counting as options the adapter passes. ⚑ Killed by the synthetic-source control, which "
        "plants exactly those three shapes in a source small enough to read",
        [
            (
                TEST,
                "  const literal = body.slice(literalStart, body.indexOf('\\n    }\\n', literalStart))",
                "  const literal = body",
            )
        ],
    ),
    (
        "M11 · 🔴 the sentence stops being rendered and becomes a hand-written string again — the "
        "table survives, correct and unread, while the screen says whatever somebody typed. ⛔ The "
        "arrangement's own failure mode, and the reason the sentence is asserted to NAME every "
        "member of the table rather than merely to exist",
        [
            (
                # This row follows the same behavior after provider facts moved into the registry.
                "packages/shared/src/providers/configuration.ts",
                # The hand-written sentence omits current passed options and the file-settings disclosure.
                "  model: CLAUDE_MODEL_NOTE,\n",
                "  model: 'programmatic — MCP servers, tools and prompt are passed as SDK query() options',\n",
            )
        ],
    ),
    (
        "M12 · the sentence names every measured option but describes its passed options as NOT "
        "passed, while the measured table stays correct. The old absent-clause replacement became "
        "a no-op when every current option became passed; the registry snapshot now pins the "
        "same false-disclosure subject against the current sentence",
        [
            (
                # This row follows the same behavior after provider facts moved into the registry.
                "packages/shared/src/providers/configuration.ts",
                # The current layout has no absent clause; reverse its present disclosure instead.
                "  model: CLAUDE_MODEL_NOTE,\n",
                "  model: CLAUDE_MODEL_NOTE.replace('are passed as SDK query() options', 'are NOT passed as SDK query() options'),\n",
            )
        ],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    for rel, find, replace in edits:
        path = root / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name.split(' ·')[0]}: anchor found {hits}x in {rel} (expected exactly 1)")
            return 1
        if find == replace:
            print(f"!! {name.split(' ·')[0]}: replacement equals the original in {rel} — a no-op row")
            return 1
        if not dry:
            path.write_text(text.replace(find, replace, 1))
    return 0


def main() -> int:
    args = sys.argv[1:]
    if args[:1] == ["--count"]:
        print(len(MUTATIONS))
        return 0
    if args[:1] == ["--files"]:
        seen = []
        for _name, edits in MUTATIONS:
            for rel, _find, _replace in edits:
                if rel not in seen:
                    seen.append(rel)
        print(" ".join(seen))
        return 0
    if args[:1] == ["--name"]:
        print(MUTATIONS[int(args[1])][0])
        return 0
    if args[:1] == ["--dry-run"]:
        root = Path(args[1]).resolve()
        bad = 0
        for index in range(len(MUTATIONS)):
            bad += apply(root, index, dry=True)
        print(f"{len(MUTATIONS) - bad}/{len(MUTATIONS)} anchors found exactly once")
        return 1 if bad else 0
    root = Path(args[0]).resolve()
    return apply(root, int(args[1]), dry=False)


if __name__ == "__main__":
    raise SystemExit(main())
