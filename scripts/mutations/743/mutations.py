"""743 · The last card words — the conversation's wholesale grant offered wherever *Always allow* is
(`739` F-1, ruled by the PM), a settled card's `persistence` saying what its answer granted (`739`
F-7), and the wholesale warning saying *for this conversation* (`739` F-8).

⚑ **The ruling** (the PM, 2026-09-27): *"a surface that offers the choices offers ALL of them. Where
Always allow is a one-click answer (Home, the person's queue), Allow for this conversation is too.
Neither is card-only while the other is not."*

## 🔴 What has to be killable

 * `M1`–`M9` 🔴 **`739` F-1 — Home and the person's queue offer the wholesale grant**: after the row
   (never the second button, 299 §1), in the card's words, under the card's warning, sending the
   wholesale grant; the MCP card's line under it names the tool and its server.
 * `M10`–`M18` 🔴 **`739` F-7 — the settled card's `persistence`** is what the answer granted:
   `once` · `session` · `session` · `always` · `nothing granted`, and `nothing granted` for a card
   closed with no answer.
 * `M19`–`M20` 🔴 **`739` F-8 — the wholesale warning says *for this conversation***, and the sentence
   for the grants a marked card withholds says *for the rest of this conversation*.
 * `M21`–`M26` 🔴 **review** — the card's warning keeps its bold reach and Home draws it whole; Home's
   MCP warning names the provider; a pressed row dims the warning; a settled card draws its
   `conversation grant` row only where that grant was the answer (F-7's sibling).

## ⛔ What this table cannot reach

 * ⚠️ **`.pq-warns`' colour** (the person's queue): no suite paints the queue's row; Home's twin
   (`.request-warns`, and its pressed state) is killed by the DOM suite (`M7`, `M24`).
 * ⚠️ **Rows re-anchored in place by `743`**, which keep their own tables' subjects: `299 M5` (the
   grant dropped from Home without a word), `730 M3` (the MCP arm of Home's warning), `730 M30` (Home
   not handing the request's marks to it), `739 M29` (a pending card hiding *always*). `739 M36` is
   retired by the ruling.

## ⚑ WRITTEN, not run as a table

⛔ **Writing rows is routine, RUNNING a table is rare and deliberate.** Each row was verified RED alone
with `scripts/mutations/verify_row.py` — one row, its killer file, restored from bytes — in an isolated
worktree, and no `mutations.txt` exists.
"""

from __future__ import annotations

ATTENTION = 'apps/desktop/src/renderer/src/lib/attention.ts'
ATTENTIONQUEUE = 'apps/desktop/src/renderer/src/components/AttentionQueue.vue'
PERMISSIONCARD = 'apps/desktop/src/renderer/src/components/PermissionCard.vue'
PERMISSION_OFFER = 'apps/desktop/src/renderer/src/lib/permission-offer.ts'
PERSONSQUEUE = 'apps/desktop/src/renderer/src/components/PersonsQueue.vue'
USER_INPUT_OFFER = 'apps/desktop/src/renderer/src/lib/user-input-offer.ts'

MUTATIONS = [
    # ── `739` F-1 — the wholesale grant, one click wherever *Always allow* is ──
    (
        "M1 · 743 · the wholesale grant goes back to the SECOND button on Home (299 §1's slot) — killed by `the-last-card-words.render.test.ts`",
        [(ATTENTION, "        if (wide !== null) queue.at(-1)?.decisions.push(wide)\n", "        if (wide !== null) queue.at(-1)?.decisions.splice(1, 0, wide)\n")],
    ),
    (
        "M2 · 743 · Home's wholesale grant is labelled with the placeholder, not the card's words — killed by `the-last-card-words.render.test.ts`",
        [(ATTENTION, "                label: offer.wide.label,\n", "                label: 'Allow all for this conversation',\n")],
    ),
    (
        "M3 · 743 · Home's wholesale grant sends the NARROW grant — killed by `the-last-card-words.render.test.ts`",
        [(ATTENTION, "                decision: permissionDecisionFor(offer.wide.outcome),\n", "                decision: permissionDecisionFor('allow_for_session'),\n")],
    ),
    (
        "M4 · 743 · Home's wholesale grant carries no warning — killed by `the-last-card-words.render.test.ts`",
        [(ATTENTION, "                warns: wideGrantWarning(item.request.action, item.request, common.provider),\n", "                warns: undefined,\n")],
    ),
    (
        "M5 · 743 · Home's MCP grant does not carry its call, so the line under it says *anything of this kind* — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(ATTENTION, "                  : { mcpToolCall: { server: call.server, tool: call.tool } }),\n", "                  : {}),\n")],
    ),
    (
        "M6 · 743 · whatThisAnswerDoes' MCP wholesale arm never taken — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(USER_INPUT_OFFER, "  if (decision.decision.outcome === 'allow_all_for_session' && decision.mcpToolCall !== undefined) {\n", "  if (decision.decision.outcome === 'allow_for_session' && decision.mcpToolCall !== undefined) {\n")],
    ),
    (
        "M7 · 743 · Home draws the grant's warning in the quiet ink of the line under it — killed by `the-last-card-words.dom.test.ts`",
        [(ATTENTIONQUEUE, ".request-warns {\n  color: var(--waiting);\n", ".request-warns {\n  color: var(--muted);\n")],
    ),
    (
        "M8 · 743 · Home does not draw the grant's warning — killed by `the-last-card-words.render.test.ts`",
        [(ATTENTIONQUEUE, "              v-if=\"decision.kind === 'permission' && decision.warns\"\n              class=\"request-warns\"\n", "              v-if=\"false\"\n              class=\"request-warns\"\n")],
    ),
    (
        "M9 · 743 · the person's queue does not draw the grant's warning — killed by `the-last-card-words.render.test.ts`",
        # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · ee796dfa moved the wholesale grant under More options as a broader choice, where its warning span is now indented deeper (a primary button has its own copy); the plant still hides the grant's warning in the person's queue.
        [(PERSONSQUEUE, "                      v-if=\"decision.kind === 'permission' && decision.warns\"\n                      class=\"pq-warns\"\n", "                      v-if=\"false\"\n                      class=\"pq-warns\"\n")],
    ),
    # ── `739` F-7 — the settled card's persistence ──
    (
        "M10 · 743 · the settled card's persistence row reads the offer's summary again — killed by `the-last-card-words.render.test.ts`",
        [(PERMISSIONCARD, "        <dd data-cy=\"permission-persistence\">{{ persistenceSaid }}</dd>\n", "        <dd data-cy=\"permission-persistence\">{{ scope.persistence }}</dd>\n")],
    ),
    (
        "M11 · 743 · Allow once is said to grant always (739 F-7's defect) — killed by `the-last-card-words.render.test.ts`",
        [(PERMISSION_OFFER, "  allow: 'once',\n  allow_for_session: 'session',\n", "  allow: 'always',\n  allow_for_session: 'session',\n")],
    ),
    (
        "M12 · 743 · the conversation's grant is said to grant always — killed by `the-last-card-words.render.test.ts`",
        [(PERMISSION_OFFER, "  allow_for_session: 'session',\n  [WIDE]: 'session',\n", "  allow_for_session: 'always',\n  [WIDE]: 'session',\n")],
    ),
    (
        "M13 · 743 · the wholesale grant is said to grant always — killed by `the-last-card-words.render.test.ts`",
        [(PERMISSION_OFFER, "  [WIDE]: 'session',\n", "  [WIDE]: 'always',\n")],
    ),
    (
        "M14 · 743 · Always allow is said to grant for this session only — killed by `the-last-card-words.render.test.ts`",
        [(PERMISSION_OFFER, "  [WIDE]: 'session',\n  allow_always: 'always',\n", "  [WIDE]: 'session',\n  allow_always: 'session',\n")],
    ),
    (
        "M15 · 743 · Deny is said to grant once — killed by `the-last-card-words.render.test.ts`",
        [(PERMISSION_OFFER, "  deny: NOTHING_GRANTED,\n", "  deny: 'once',\n")],
    ),
    (
        "M16 · 743 · Cancel is said to grant once — killed by `the-last-card-words.render.test.ts`",
        [(PERMISSION_OFFER, "  cancel: NOTHING_GRANTED,\n", "  cancel: 'once',\n")],
    ),
    (
        "M17 · 743 · a card closed with no answer is said to grant once — killed by `the-last-card-words.render.test.ts`",
        [(PERMISSION_OFFER, "  return outcome === null ? NOTHING_GRANTED : GRANTED_FOR[outcome]\n", "  return outcome === null ? 'once' : GRANTED_FOR[outcome]\n")],
    ),
    (
        "M18 · 743 · NOTHING_GRANTED's words — killed by `the-last-card-words.render.test.ts`",
        [(PERMISSION_OFFER, "export const NOTHING_GRANTED = 'nothing granted'\n", "export const NOTHING_GRANTED = 'none'\n")],
    ),
    # ── `739` F-8 — the wholesale warning's span ──
    (
        "M19 · 743 · the wholesale warning says for the rest of this session again (739 F-8) — killed by `the-last-card-words.render.test.ts`",
        [(PERMISSION_OFFER, "    rest: ' for this conversation — not just this one. Nothing will ask again, whatever it runs.',\n", "    rest: ' for the rest of this session — not just this one. Nothing will ask again, whatever it runs.',\n")],
    ),
    (
        "M20 · 743 · the withheld-grant sentence says for the rest of this session again (739 F-8's word) — killed by `the-last-card-words.render.test.ts`",
        [(PERMISSION_OFFER, "  'Nothing here allows it for the rest of this conversation: the provider marked", "  'Nothing here allows it for the rest of this session: the provider marked")],
    ),
    (
        "M21 · 743 · the card's warning loses its bold reach (058) — killed by `the-last-card-words.render.test.ts`",
        [(PERMISSIONCARD, "{{ warningParts.lead }}<strong>{{ warningParts.reach }}</strong\n          >{{ warningParts.rest }}", "{{ warningParts.lead }}{{ warningParts.reach }}{{ warningParts.rest }}")],
    ),
    (
        "M22 · 743 · Home's plain warning drops the grant's reach — killed by `the-last-card-words.render.test.ts`",
        [(PERMISSION_OFFER, "  return `${lead}${reach}${rest}`\n", "  return `${lead}${rest}`\n")],
    ),
    (
        "M23 · 743 · Home's MCP warning is not handed the provider (hop) — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        [(ATTENTION, "warns: wideGrantWarning(item.request.action, item.request, common.provider),", "warns: wideGrantWarning(item.request.action, item.request),")],
    ),
    (
        "M24 · 743 · a pressed Home row paints the grant's warning live — killed by `the-last-card-words.dom.test.ts`",
        [(ATTENTIONQUEUE, ".request-decide:disabled .request-warns {\n  color: var(--faint);\n}\n", "")],
    ),
    (
        "M25 · 743 · F-7's sibling — a settled card answered anything draws the conversation grant row again — killed by `the-last-card-words.render.test.ts`",
        [(PERMISSIONCARD, "          v-if=\"grantCovers !== null && (!answered || item.outcome === 'allow_for_session')\"\n", "          v-if=\"grantCovers !== null\"\n")],
    ),
    (
        "M26 · 743 · F-7's sibling — the conversation grant row gated on the wrong answer — killed by `the-last-card-words.render.test.ts`",
        [(PERMISSIONCARD, "          v-if=\"grantCovers !== null && (!answered || item.outcome === 'allow_for_session')\"\n", "          v-if=\"grantCovers !== null && (!answered || item.outcome === 'allow')\"\n")],
    ),
]
