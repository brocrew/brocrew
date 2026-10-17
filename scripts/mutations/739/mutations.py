"""739 · The CLI's choices, drawn — *Always allow* on every surface with the words the wire gives it,
kept grants disclosed apart from conversation grants, the conversation grant's rule said, a command
with no answer bounded, and *Stop and send* said as an ask.

⚑ **The PM's five draws** (the closing wave's last frontend doc): `736` F-1 (and F-6's drawing), `730`
F-1 and `737` F-5, `726` F-14, `737` F-6 and `737` F-7 — on `main` @ `8a52dfd8`, which carries `740` and `741`
(R99), so every word reads `scope.grants` / `alwaysFile` / the scope's `cwd` and flows through it.

## 🔴 What has to be killable

 * `M1`–`M33` 🔴 **`736` F-1 — *Always allow* drawn on every surface, its words off the wire; `737` F-5 — the MCP card reads back *Allowed once*; `736` F-6 — Home draws a refused answer**.
 * `M34`–`M43` 🔴 **round 1 — the wholesale grant never says *Always*; accept edits bounded to the folders it works in; *Always allow* outlined; the kept row only where it was the answer**.
 * `M44`–`M83` 🔴 **`736` F-1 · `730` F-1 — kept grants disclosed apart; *not asked again*; the reopen keeps what was always allowed**.
 * `M84`–`M93` 🔴 **`726` F-14 — the conversation grant's line names the rule it installs**.
 * `M94`–`M113` 🔴 **`737` F-6 — a command with no answer lets go of `busy` at its bound, and says so**.
 * `M114`–`M125` 🔴 **`737` F-7 — *Stop and send* in R43's words, with the host's bound**.
 * `M126`–`M137` 🔴 **review round 2** — the proposal's pointer only where its `kept grant` row is, a
   conversation's own folder left out of what *Always allow* also covers, an unnamed server tool, the
   pane's footprint, the no-answer sentence, the kept words, the reopen sentence and its row, the kept
   list's dedupe and its no-rule fallback, a Claude whole-tool kept rule.

## ⛔ What this table cannot reach

 * ⚠️ **Equivalent, measured by the test authors**: `forSession`'s count-down is guarded twice
   (`if (!counted) return` in `countDown`, `if (counted)` in `finally`) and the bound is deleted from
   `bounds` twice — removing either one of a pair changes nothing; only both is observable.
 * ⚠️ **`PermissionCard`'s `LABELS.allow_all_for_session` placeholder** is overridden at render time by
   `wideGrantLabel` and read by nothing, so a mutation of it survives every suite — no row.
 * ⚠️ **`keptGrantOf`'s `kept` map passing `cwd`**: no measured card keeps a DIRECTORY rule in
   `allow_always`, so dropping the cwd there is equivalent today; the `here` map's cwd is killed.
 * ⚠️ **Step 82** (`scripts/ui-live-smoke.mjs`) is live-only and not in `ci`: its roster and units are
   guarded by `step-census.test.mjs` and `660 M3`, its budget figures by `step-budgets.test.mjs`.

## ⚑ WRITTEN, not run as a table

⛔ **Writing rows is routine, RUNNING a table is rare and deliberate.** Each row was verified RED alone
with `scripts/mutations/verify_row.py` — one row, its killer file, restored from bytes — in an isolated
worktree, and no `mutations.txt` exists.

## ⚠️ T-003 · after D-010 (`8bc565fa`) and D-011 (`79245533`)

D-010 deleted the not-yours foot: M118 is retired by ruling; M117 was corrected in place.
"""

from __future__ import annotations

ATTENTION = 'apps/desktop/src/renderer/src/lib/attention.ts'
ATTENTIONQUEUE = 'apps/desktop/src/renderer/src/components/AttentionQueue.vue'
CONVERSATIONPANE = 'apps/desktop/src/renderer/src/components/ConversationPane.vue'
PERMISSIONCARD = 'apps/desktop/src/renderer/src/components/PermissionCard.vue'
PERMISSION_OFFER = 'apps/desktop/src/renderer/src/lib/permission-offer.ts'
PROMPTCOMPOSER = 'apps/desktop/src/renderer/src/components/PromptComposer.vue'
REOPENING = 'apps/desktop/src/renderer/src/lib/reopening.ts'
SESSIONDRAWER = 'apps/desktop/src/renderer/src/components/SessionDrawer.vue'
SESSIONHEADER = 'apps/desktop/src/renderer/src/components/SessionHeader.vue'
SESSIONINFO = 'apps/desktop/src/renderer/src/components/SessionInfo.vue'
SESSION_RECORD = 'apps/desktop/src/renderer/src/lib/session-record.ts'
SESSION_STORE = 'apps/desktop/src/renderer/src/lib/session-store.ts'
STANDING_GRANTS = 'apps/desktop/src/renderer/src/lib/standing-grants.ts'
STOP_UNANSWERED = 'apps/desktop/src/renderer/src/lib/stop-unanswered.ts'
TAB_FLOW = 'scripts/lib/tab-flow.mjs'
USER_INPUT_OFFER = 'apps/desktop/src/renderer/src/lib/user-input-offer.ts'
WHAT_SURVIVES_THE_CONVERSATION = 'apps/desktop/src/renderer/src/lib/what-survives-the-conversation.ts'

MUTATIONS = [
    # ── `736` F-1 — *Always allow* drawn on every surface, its words off the wire; `737` F-5 — the MCP  ──
    (
        "M1 · 739 A1 · PLACE puts allow_always apart again (no surface draws it) — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSION_OFFER, "  allow_always: 2,\n", "  allow_always: 'apart',\n")],
    ),
    (
        "M2 · 739 A1 · ALWAYS_ALLOW's word changes — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSION_OFFER, "export const ALWAYS_ALLOW = 'Always allow'\n", "export const ALWAYS_ALLOW = 'Always Allow'\n")],
    ),
    (
        "M3 · 739 A1 · ALLOWED_ONCE reads Approved again (737 F-5) — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSION_OFFER, "export const ALLOWED_ONCE = 'Allowed once'\n", "export const ALLOWED_ONCE = 'Approved'\n")],
    ),
    (
        "M4 · 739 A1 · ruleSaid drops the rule's server — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSION_OFFER, "      const on = rule.server === undefined ? '' : ` on ${rule.server}`\n", "      const on = ''\n")],
    ),
    (
        "M5 · 739 A1 · keptGrantOf keyed on the conversation grant instead of allow_always — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSION_OFFER, "  if (!(scope.availableDecisions ?? []).includes('allow_always')) return null\n", "  if (!(scope.availableDecisions ?? []).includes('allow_for_session')) return null\n")],
    ),
    (
        "M6 · 739 A1 · keptGrantOf's 'also' repeats the kept rules — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSION_OFFER, "  const also = here.filter((said) => !kept.includes(said))\n", "  const also = here\n")],
    ),
    (
        "M7 · 739 A1 · keptGrantOf ignores alwaysFile — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSION_OFFER, "    file: scope.grants?.alwaysFile ?? null,\n", "    file: null,\n")],
    ),
    (
        "M8 · 739 A1 · no rules read as an empty rule list — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSION_OFFER, "    rules: kept.length === 0 ? null : kept.join('; '),\n", "    rules: kept.join('; '),\n")],
    ),
    (
        "M9 · 739 A1 · keptGrantSaid says nothing when the file is not named — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSION_OFFER, "  const where = kept.file === null ? 'where, this request does not say' : `in ${kept.file}`\n", "  const where = kept.file === null ? '' : `in ${kept.file}`\n")],
    ),
    (
        "M10 · 739 A1 · keptGrantSaid says nothing when the rules are not named — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSION_OFFER, "  const what = kept.rules ?? 'the provider’s own rule for this, which this request does not name'\n", "  const what = kept.rules ?? ''\n")],
    ),
    (
        "M11 · 739 A1 · kept grant row drops what the press also covers — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSION_OFFER, "      : `; for this conversation it also covers: ${kept.alsoForThisConversation}`\n", "      : ''\n")],
    ),
    (
        "M12 · 739 A1 · whatThisAnswerDoes reads keeps beside the wrong outcome — killed by `always-allow-on-every-surface.render.test.ts`",
        [(USER_INPUT_OFFER, "  if (decision.decision.outcome === 'allow_always' && decision.keeps !== undefined) {\n", "  if (decision.decision.outcome === 'allow_for_session' && decision.keeps !== undefined) {\n")],
    ),
    (
        "M13 · 739 A1 · the Always allow line drops the file — killed by `always-allow-on-every-surface.render.test.ts`",
        [(USER_INPUT_OFFER, "  const where = keeps.file === null ? '' : `, in ${keeps.file}`\n", "  const where = ''\n")],
    ),
    (
        "M14 · 739 A1 · the Always allow line drops the rule — killed by `always-allow-on-every-surface.render.test.ts`",
        [(USER_INPUT_OFFER, "  const what = keeps.rules === null ? '' : `: ${keeps.rules}`\n", "  const what = ''\n")],
    ),
    (
        "M15 · 739 A1 · the Always allow line drops what it also covers — killed by `always-allow-on-every-surface.render.test.ts`",
        [(USER_INPUT_OFFER, "      : `; for this conversation it also covers: ${keeps.alsoForThisConversation}`\n", "      : ''\n")],
    ),
    (
        "M16 · 739 A1 · PERMISSION_EFFECTS.allow_always words change — killed by `always-allow-on-every-surface.render.test.ts`",
        [(USER_INPUT_OFFER, "    'the agent may do this, and the provider’s own rule for it is kept beyond this conversation',\n", "    'the agent may do this, from now on',\n")],
    ),
    (
        "M17 · 739 A1 · Home's label for allow_always is not ALWAYS_ALLOW — killed by `always-allow-on-every-surface.render.test.ts`",
        [(ATTENTION, "  allow_always: ALWAYS_ALLOW,\n", "  allow_always: 'Always',\n")],
    ),
    (
        "M18 · 739 A1 · Home's decision never carries keeps (the hop) — killed by `always-allow-on-every-surface.render.test.ts`",
        [(ATTENTION, "            ...(outcome === 'allow_always' && keeps !== null ? { keeps } : {}),\n", "            ...(outcome === 'allow_always' && keeps === null ? { keeps } : {}),\n")],
    ),
    (
        "M19 · 739 A1 · Home's scope drops the kept line — killed by `always-allow-on-every-surface.render.test.ts`",
        [(ATTENTION, "  if (kept !== null) lines.push(kept)\n", "")],
    ),
    (
        "M20 · 739 A1 · Home's exec proposal branch keyed on the wrong kind — killed by `always-allow-on-every-surface.render.test.ts`",
        [(ATTENTION, "    if (keepsARule && amendment.kind === 'exec') {\n", "    if (keepsARule && amendment.kind === 'network') {\n")],
    ),
    (
        "M21 · 739 A1 · Home's exec proposal stops naming Always allow — killed by `always-allow-on-every-surface.render.test.ts`",
        [(ATTENTION, "        `proposed for future ${amendment.kind}: ${amendment.detail} — only ${ALWAYS_ALLOW} keeps a rule here, the one said above`,\n", "        `proposed for future ${amendment.kind}: ${amendment.detail}`,\n")],
    ),
    (
        "M22 · 739 A1 · Home drops the conversation line on an always card that offers a conversation grant — killed by `what-a-grant-covers.render.test.ts`",
        [(ATTENTION, "    (scope.persistence === 'always' &&\n", "    (scope.persistence === 'never' &&\n")],
    ),
    (
        "M23 · 739 A1 · Home's conversation line counts Always allow as a conversation grant — killed by `what-a-grant-covers.render.test.ts`",
        [(ATTENTION, "        (one) => one === 'allow_for_session' || one === 'allow_all_for_session',\n", "        (one) => one === 'allow_for_session' || one === 'allow_all_for_session' || one === 'allow_always',\n")],
    ),
    (
        "M24 · 739 A1 · the card's label for allow_always is not ALWAYS_ALLOW — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSIONCARD, "  allow_always: ALWAYS_ALLOW,\n", "  allow_always: 'Always Allow',\n")],
    ),
    (
        "M25 · 739 A1 · Allowed once keyed on the wrong card (737 F-5) — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSIONCARD, "  if (outcome === 'allow' && mcpCall.value !== undefined) return ALLOWED_ONCE\n", "  if (outcome === 'allow' && mcpCall.value === undefined) return ALLOWED_ONCE\n")],
    ),
    (
        "M26 · 739 A1 · the card's saysOf hands no keeps — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSIONCARD, "  const kept = outcome === 'allow_always' ? keeps.value : null\n", "  const kept = null\n")],
    ),
    (
        "M27 · 739 A1 · the card's saysOf drops keeps from the decision — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSIONCARD, "      ...(kept === null ? {} : { keeps: kept }),\n", "      ...{},\n")],
    ),
    (
        "M28 · 739 A1 · the kept grant row is gone from a card answered Always allow (the read-back of what was kept) — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSIONCARD, "        <template v-if=\"keptSaid !== null && (!answered || item.outcome === 'allow_always')\">\n", "        <template v-if=\"keptSaid !== null && !answered\">\n")],
    ),
    (
        "M29 · 739 A1 · the persistence row hides always again (drawnPersistence's reading) — killed by `always-allow-on-every-surface.render.test.ts`",
        # ⚑ ANCHOR CORRECTED IN PLACE BY 743 — `739` F-7: the row reads `persistenceSaid`, whose PENDING
        # arm is the offer's summary; the subject (a pending card hiding *always*) is that arm.
        [(PERMISSIONCARD, "  answered.value ? grantedFor(props.item.outcome) : scope.value.persistence,\n", "  answered.value ? grantedFor(props.item.outcome) : scope.value.persistence === 'always' ? 'session' : scope.value.persistence,\n")],
    ),
    (
        "M30 · 739 A1 · the card's keepsARule keyed on the wrong rule kind — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSIONCARD, "  (scope.value.grants?.allow_always ?? []).some((rule) => rule.kind === 'command-prefix'),\n", "  (scope.value.grants?.allow_always ?? []).some((rule) => rule.kind === 'tool'),\n")],
    ),
    (
        "M31 · 739 A1 · the card's exec proposal stops naming Always allow — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSIONCARD, "                  ? `only ${ALWAYS_ALLOW} keeps a rule here, the one under “kept grant”`\n", "                  ? 'not applied by any answer here'\n")],
    ),
    (
        "M32 · 739 A1 · 'proposed, not applied here' drawn on the always card too — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSIONCARD, "        <template v-if=\"scope.amendments.length > 0 && !keptRuleSaid\">\n", "        <template v-if=\"scope.amendments.length > 0\">\n")],
    ),
    (
        "M33 · 739 A1 · Home draws no refusal (736 F-6) — killed by `always-allow-on-every-surface.render.test.ts`",
        [(ATTENTIONQUEUE, "        <p v-if=\"request.refused\" class=\"request-warn\" data-cy=\"attention-refused\">\n", "        <p v-if=\"false\" class=\"request-warn\" data-cy=\"attention-refused\">\n")],
    ),
    # ── round 1 — the wholesale grant never says *Always*; accept edits bounded to the folders it works ──
    (
        "M34 · 739 review · the wholesale grant's label never says Always — killed by `wide-grant.render.test.ts`",
        [(PERMISSION_OFFER, "  return `Allow every ${action} call for this conversation`", "  return `Always allow ${action} this session`")],
    ),
    (
        "M35 · 739 review · the wholesale grant's settled verdict never says always — killed by `wide-grant.render.test.ts`",
        [(PERMISSIONCARD, "        ? `Allowed every ${props.item.request.action} call for this conversation`", "        ? 'Always allowed this session'")],
    ),
    (
        "M36 · 739 review · the MCP card's withheld-grant sentence gives the warning, not breadth, as its reason — killed by `when-codex-asks-to-run-an-mcp-tool.render.test.ts`",
        # ⛔ RETIRED BY `743` (`739` F-1, ruled by the PM), anchor-absent: Home and the person's queue
        # OFFER the conversation's grant now, so the sentence saying why it was not offered there is
        # gone with the reason for it — the subject (the wrong reason given for a card-only grant)
        # has no case left. What replaced it (the grant under the card's warning) is table 743's.
        [(PERMISSION_OFFER, "whatever it is given, and it lives on ` +\n      `the card, under its own warning. Open it to grant that.`", "whatever it is given, so it lives on ` +\n      `the card. Open it to grant that.`")],
    ),
    (
        "M37 · 739 review · accept edits says the folders it works in — killed by `what-a-conversation-grant-covers-said.render.test.ts`",
        [(PERMISSION_OFFER, "'every file edit in the folders it works in, without asking (accept edits)'", "'every file edit, without asking (accept edits)'")],
    ),
    (
        "M38 · 739 review · a folder rule for the conversation's own folder is said as what Always allow also covers — beside the kept rule, 740's *so the same request is still asked* — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSION_OFFER, "    .filter((rule) => !(rule.kind === 'directory' && sameFolder(rule.path, scope.cwd)))\n", "")],
    ),
    (
        "M39 · 739 review · conversationGrantCovers hands ruleSaid the cwd (740's folder that adds nothing) — killed by `what-a-conversation-grant-covers-said.render.test.ts`",
        [(PERMISSION_OFFER, "  return rules.map((rule) => ruleSaid(rule, scope.cwd)).join('; ')", "  return rules.map((rule) => ruleSaid(rule)).join('; ')")],
    ),
    (
        "M40 · 739 review · the Always allow line is rule-first — killed by `always-allow-on-every-surface.render.test.ts`",
        [(USER_INPUT_OFFER, "  return `${PERMISSION_EFFECTS.allow_always}${what}${where}${also}`", "  return `${PERMISSION_EFFECTS.allow_always}${where}${what}${also}`")],
    ),
    (
        "M41 · 739 review · a settled card draws the kept row only where Always allow was the answer — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSIONCARD, "<template v-if=\"keptSaid !== null && (!answered || item.outcome === 'allow_always')\">", "<template v-if=\"keptSaid !== null\">")],
    ),
    (
        "M42 · 739 review · Always allow is never the filled approve — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSIONCARD, "            approve: outcomeAllows(outcome) && offer.primary === 'allows' && !keptBeyond(outcome),", "            approve: outcomeAllows(outcome) && offer.primary === 'allows',")],
    ),
    (
        "M43 · 739 review · Always allow is drawn approve-quiet — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSIONCARD, "              outcomeAllows(outcome) && (offer.primary === 'refuses' || keptBeyond(outcome)),", "              outcomeAllows(outcome) && offer.primary === 'refuses',")],
    ),
    # ── `736` F-1 · `730` F-1 — kept grants disclosed apart; *not asked again*; the reopen keeps what w ──
    (
        "M44 · 739 kept list reads only an Always-allow answer — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(STANDING_GRANTS, "    if (item.kind !== 'permission' || item.outcome !== 'allow_always') continue\n", "    if (item.kind !== 'permission' || item.outcome === null) continue\n")],
    ),
    (
        "M45 · 739 kept grant said in the card's rule words, not the action — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(STANDING_GRANTS, "        : grantRulesSaid(rules, item.request.scope.cwd)\n", "        : `the provider’s own rule for ${item.request.action}, which its card did not name`\n")],
    ),
    (
        "M46 · 739 kept grant carries the card's alwaysFile — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(STANDING_GRANTS, "    const file = grants?.alwaysFile ?? null\n", "    const file: string | null = null\n")],
    ),
    (
        "M47 · 739 a server's kept tool is listed as mcp__<server>__<tool> — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(STANDING_GRANTS, "        ? [rule.server === undefined ? rule.tool : `mcp__${rule.server}__${rule.tool}`]\n", "        ? [rule.tool]\n")],
    ),
    (
        "M48 · 739 a rule with content is listed under no whole-tool name — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(STANDING_GRANTS, "      rule.kind === 'tool' && rule.content === undefined\n", "      rule.kind === 'tool'\n")],
    ),
    (
        "M49 · 739 notKeptHere subtracts what was kept here — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(STANDING_GRANTS, "  return blanketGrants.filter((name) => !kept.some((one) => one.listedAs.includes(name)))\n", "  return [...blanketGrants]\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** ae07008f
        # removed the conversation header's warnings band on purpose: 'Out: the header's warnings
        # band (another caller, not asked again, kept beyond this conversation) ... and what only
        # they used (... the header-only grant titles ...)'. `notAskedAgainTitle`, the chip title
        # this row mutates, is deleted from standing-grants.ts. HOW_THESE_GRANTS_END survives only
        # in Info's note, already pinned by M73 and M52. Its anchor is left stale, so the census
        # records it retired.
        "M50 · 739 chip title carries HOW_THESE_GRANTS_END — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(STANDING_GRANTS, "  return `Not asked again here: ${listed.join(', ')}. ${HOW_THESE_GRANTS_END} Listed in the drawer, under Info.`\n", "  return `Not asked again here: ${listed.join(', ')}. Listed in the drawer, under Info.`\n")],
    ),
    (
        "M51 · 739 730 F-1 the label is 'not asked again' — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(STANDING_GRANTS, "export const NOT_ASKED_AGAIN = 'not asked again'\n", "export const NOT_ASKED_AGAIN = 'always allowed'\n")],
    ),
    (
        "M52 · 739 HOW_THESE_GRANTS_END says a kept one outlives the conversation — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives,
        # reworded. `HOW_THESE_GRANTS_END` still says that a grant kept with "Always allow" outlives
        # the conversation and one allowed for this conversation may be asked about again, and it
        # now ends `one kept with “Always allow” is not.` The plant flips the last word to `is
        # too.`, saying the opposite about the kept grant.
        [
            (STANDING_GRANTS, "  'with “Always allow” is not.'\n", "  'with “Always allow” is too.'\n"),
        ],
    ),
    (
        "M53 · 739 keptAndWhere names the file — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(STANDING_GRANTS, "  return kept.file === null ? kept.said : `${kept.said} — in ${kept.file}`\n", "  return kept.said\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** ae07008f
        # removed the header's warnings band and 'the header-only grant titles'; `keptTitle`, the
        # header kept-mark title this row mutates, is deleted from standing-grants.ts.
        # KEPT_BEYOND_IT_SAYS survives only in Info's kept note, already pinned by M78 and M56. Its
        # anchor is left stale, so the census records it retired.
        "M54 · 739 kept title carries KEPT_BEYOND_IT_SAYS — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(STANDING_GRANTS, "  return `${kept.map(keptAndWhere).join('; ')}. ${KEPT_BEYOND_IT_SAYS} Listed in the drawer, under Info.`\n", "  return `${kept.map(keptAndWhere).join('; ')}. Listed in the drawer, under Info.`\n")],
    ),
    (
        "M55 · 739 the kept label is 'kept beyond this conversation' — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(STANDING_GRANTS, "export const KEPT_BEYOND_THIS_CONVERSATION = 'kept beyond this conversation'\n", "export const KEPT_BEYOND_THIS_CONVERSATION = 'always allowed'\n")],
    ),
    (
        "M56 · 739 KEPT_BEYOND_IT_SAYS: a later reader is NOT asked — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(STANDING_GRANTS, "  'conversation whose launch applies that file is not asked about what it covers, beyond the ' +\n", "  'conversation whose launch applies that file is asked about what it covers, beyond the ' +\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** ae07008f
        # ('the header's warnings band (another caller, not asked again, kept beyond this
        # conversation)' is out): the header chip and its `notAskedAgain` list are deleted from
        # SessionHeader.vue. The same gate on Info's not-asked-again row is still rowed by M71. Its
        # anchor is left stale, so the census records it retired.
        "M57 · 739 header chip gated on the list without kept names — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(SESSIONHEADER, "      v-if=\"notAskedAgain.length > 0\"\n", "      v-if=\"session?.blanketGrants?.length\"\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** ae07008f
        # deleted the header chip and its title function (`notAskedAgainTitle`) with the warnings
        # band, so there is no header title to plant. The list of grants that are not kept is still
        # rowed on Info by M70. Its anchor is left stale, so the census records it retired.
        "M58 · 739 header chip title lists only what is not kept — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(SESSIONHEADER, "      :title=\"notAskedAgainTitle(notAskedAgain)\"\n", "      :title=\"notAskedAgainTitle(session?.blanketGrants ?? [])\"\n")],
    ),
    (
        # The header warning band and not-asked-again chip are gone. Info still covers the not-kept
        # list separately; retain this absent header anchor as retired.
        "M59 · 739 header chip text lists only what is not kept — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(SESSIONHEADER, "      ⚠ {{ NOT_ASKED_AGAIN }}: {{ notAskedAgain.join(', ') }}\n", "      ⚠ {{ NOT_ASKED_AGAIN }}: {{ session?.blanketGrants?.join(', ') }}\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** ae07008f
        # deleted the header's 'kept beyond this conversation' mark with the warnings band, so there
        # is no header mark to hide. Info's kept row being drawn is still rowed by M74. Its anchor
        # is left stale, so the census records it retired.
        "M60 · 739 header kept mark is drawn — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(SESSIONHEADER, "      v-if=\"kept.length > 0\"\n", "      v-if=\"false\"\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** ae07008f
        # deleted the header kept mark and its title (`keptTitle`) with the warnings band. The rule
        # that each kept grant names its file survives in Info's kept note, rowed by M77 and M53.
        # Its anchor is left stale, so the census records it retired.
        "M61 · 739 header kept mark's title names each file — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(SESSIONHEADER, "      :title=\"keptTitle(kept)\"\n", "      :title=\"keptTitle([])\"\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** ae07008f
        # deleted the header kept mark's text with the warnings band. Each kept grant in the grant's
        # own words survives in Info's kept cell, rowed by M76. Its anchor is left stale, so the
        # census records it retired.
        "M62 · 739 header kept mark text is each grant's words — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(SESSIONHEADER, "      ⚠ {{ KEPT_BEYOND_THIS_CONVERSATION }}: {{ kept.map((one) => one.said).join(', ') }}\n", "      ⚠ {{ KEPT_BEYOND_THIS_CONVERSATION }}: {{ kept.map((one) => one.file).join(', ') }}\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** ae07008f
        # removed the header's warnings band; the `warned` computed whose kept-mark term this row
        # dropped no longer exists in SessionHeader.vue, and neither does the header's `kept` prop
        # ('the header's `kept` prop and the pane's feed' are out). Nothing remains for a kept grant
        # to turn on. Its anchor is left stale, so the census records it retired.
        "M63 · 739 warned turns on for the kept mark — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives.
        # `warned` in `SessionHeader.vue` must be on for the kept mark, or a kept-only conversation
        # draws no band and the mark is invisible. D-017b folded the three-line `||` chain into a
        # single `return` line, so the old anchor `    props.kept.length > 0 ||\n` is now absent;
        # the plant removes the middle term from that line. The Bash(make build *) case has
        # `blanketGrants: []` and no commander, so only the kept term can turn the band on there.
        [
            (SESSIONHEADER, '  return (session.blanketGrants?.length ?? 0) > 0 || props.kept.length > 0 || session.hasACommander\n', '  return (session.blanketGrants?.length ?? 0) > 0 || session.hasACommander\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** ae07008f
        # deleted the header's `notAskedAgain` computed with the warnings band and its `kept` prop.
        # The subtraction of the kept names from the list survives only in Info
        # (`notKeptHere(props.session.blanketGrants, kept.value)`), rowed by M70. Its anchor is left
        # stale, so the census records it retired.
        "M64 · 739 header subtracts the kept names from the list — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(SESSIONHEADER, "const notAskedAgain = computed(() => notKeptHere(props.session?.blanketGrants ?? [], props.kept))\n", "const notAskedAgain = computed(() => notKeptHere(props.session?.blanketGrants ?? [], []))\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** ae07008f
        # removed 'the header's `kept` prop and the pane's feed': ConversationPane.vue no longer
        # reads or computes `kept` (no keptInThisConversation call remains there). The drawer's own
        # read of kept for Info is still rowed by M67. Its anchor is left stale, so the census
        # records it retired.
        "M65 · 739 pane reads kept off its control projection — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(CONVERSATIONPANE, "const kept = computed(() => keptInThisConversation(control.value.items))\n", "const kept = computed(() => keptInThisConversation([]))\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** ae07008f
        # removed the pane's feed of `kept` to the header along with the header's prop
        # (`:kept="kept"` is gone from ConversationPane.vue). The hand-off that survives is the
        # drawer's to SessionInfo, rowed by M68. Its anchor is left stale, so the census records it
        # retired.
        "M66 · 739 pane hands kept to the header — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(CONVERSATIONPANE, "      :tools=\"control.tools\"\n      :kept=\"kept\"\n", "      :tools=\"control.tools\"\n")],
    ),
    (
        "M67 · 739 drawer reads kept off its state — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(SESSIONDRAWER, "const kept = computed(() => keptInThisConversation(props.state.items))\n", "const kept = computed(() => keptInThisConversation([]))\n")],
    ),
    (
        "M68 · 739 drawer hands kept to SessionInfo — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(SESSIONDRAWER, "        :kept=\"kept\"\n", "")],
    ),
    (
        "M69 · 739 SessionInfo reads its kept prop — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(SESSIONINFO, "const kept = computed(() => props.kept ?? [])\n", "const kept = computed((): readonly KeptHere[] => [])\n")],
    ),
    (
        "M70 · 739 Info's conversation list without what was kept here — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(SESSIONINFO, "const grants = computed(() => notKeptHere(props.session.blanketGrants, kept.value).join(' · '))\n", "const grants = computed(() => props.session.blanketGrants.join(' · '))\n")],
    ),
    (
        "M71 · 739 Info's grants row gated on the list without kept names — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(SESSIONINFO, "        <template v-if=\"grants !== ''\">\n", "        <template v-if=\"session.blanketGrants.length > 0\">\n")],
    ),
    (
        "M72 · 739 Info's conversation row label is NOT_ASKED_AGAIN — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(SESSIONINFO, "          <dt>{{ NOT_ASKED_AGAIN }}</dt>\n", "          <dt>always allowed</dt>\n")],
    ),
    (
        "M73 · 739 Info's grants note is HOW_THESE_GRANTS_END — killed by `what-always-allow-kept-and-what-is-not-asked-again.dom.test.ts`",
        [(SESSIONINFO, "              {{ HOW_THESE_GRANTS_END }}\n", "              {{ KEPT_BEYOND_IT_SAYS }}\n")],
    ),
    (
        "M74 · 739 Info's kept row is drawn — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(SESSIONINFO, "        <template v-if=\"kept.length > 0\">\n", "        <template v-if=\"false\">\n")],
    ),
    (
        "M75 · 739 Info's kept row label — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(SESSIONINFO, "          <dt>{{ KEPT_BEYOND_THIS_CONVERSATION }}</dt>\n", "          <dt>kept</dt>\n")],
    ),
    (
        "M76 · 739 Info's kept cell is each grant's words — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(SESSIONINFO, "              kept.map((one) => one.said).join(' · ')\n", "              kept.map((one) => one.file).join(' · ')\n")],
    ),
    (
        "M77 · 739 Info's kept note names each file — killed by `what-always-allow-kept-and-what-is-not-asked-again.dom.test.ts`",
        [(SESSIONINFO, "                {{ keptAndWhere(one) }}\n", "                {{ one.said }}\n")],
    ),
    (
        "M78 · 739 Info's kept note sentence is KEPT_BEYOND_IT_SAYS — killed by `what-always-allow-kept-and-what-is-not-asked-again.dom.test.ts`",
        [(SESSIONINFO, "              <div>{{ KEPT_BEYOND_IT_SAYS }}</div>\n", "              <div>{{ HOW_THESE_GRANTS_END }}</div>\n")],
    ),
    (
        "M79 · 739 REOPEN_COSTS kept row is told 'always allow' — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(REOPENING, "    person: { isTold: 'always allow' },\n", "    person: { isTold: 'always allowed' },\n")],
    ),
    (
        "M80 · 739 the free sentence tells 'always allow' — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        # ⚑ **always allow that recurs · re-anchored in place, not retired** — the sentence names the conversation grant's approvals by its button's words, so the line ends 'It forgets its'; the plant still swaps 'always allow' for 'always keep'
        [(REOPENING, "    'always allow stays where it was kept. It forgets its ' +\n", "    'always keep stays where it was kept. It forgets its ' +\n")],
    ),
    (
        "M81 · 739 REOPEN_COSTS: what Always allow kept is KEPT — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(REOPENING, "    what: 'what you chose to “Always allow”',\n    becomes: 'kept',\n", "    what: 'what you chose to “Always allow”',\n    becomes: 'lost',\n")],
    ),
    (
        "M82 · 739 info-kept is the AGENT's fact — killed by `the-thread-a-person-does-not-leave.dom.test.ts`",
        [(WHAT_SURVIVES_THE_CONVERSATION, "  { cy: 'info-kept', subject: 'agent', role: 'value', sometimes: true },\n", "  { cy: 'info-kept', subject: 'conversation', role: 'value', sometimes: true },\n")],
    ),
    (
        "M83 · 739 tab-flow claims info-kept for Info — killed by `tab-flow.dom.test.ts`",
        [(TAB_FLOW, "  'info-kept': 'info',\n", "  'info-kept': 'controls',\n")],
    ),
    # ── `726` F-14 — the conversation grant's line names the rule it installs ──
    (
        "M84 · 739 D3 · the folder arm is gone: a //<dir>/** Read rule is said raw — killed by `what-a-conversation-grant-covers-said.render.test.ts`",
        [(PERMISSION_OFFER, "      if (folder !== null) return `reading from /${folder[1]} (${rule.tool}(${rule.content}))`\n", "")],
    ),
    (
        "M85 · 739 D3 · any tool's //<dir>/** rule is said as reading (the Read check dropped) — killed by `what-a-conversation-grant-covers-said.render.test.ts`",
        [(PERMISSION_OFFER, "      const folder = rule.tool === 'Read' ? A_FOLDER_FROM_THE_ROOT.exec(rule.content ?? '') : null\n", "      const folder = A_FOLDER_FROM_THE_ROOT.exec(rule.content ?? '')\n")],
    ),
    (
        "M86 · 739 D3 · a single-slash (project-relative) Read rule is read as a folder — killed by `what-a-conversation-grant-covers-said.render.test.ts`",
        [(PERMISSION_OFFER, "const A_FOLDER_FROM_THE_ROOT = /^\\/\\/(.+)\\/\\*\\*$/\n", "const A_FOLDER_FROM_THE_ROOT = /^\\/(.+)\\/\\*\\*$/\n")],
    ),
    (
        "M87 · 739 D3 · conversationGrantCovers says rules for an offer with no conversation grant — killed by `what-a-conversation-grant-covers-said.render.test.ts`",
        [(PERMISSION_OFFER, "  if (!(scope.availableDecisions ?? []).includes('allow_for_session')) return null\n", "")],
    ),
    (
        "M88 · 739 D3 · whatThisAnswerDoes ignores the decision's covers — killed by `what-a-conversation-grant-covers-said.render.test.ts`",
        [(USER_INPUT_OFFER, "  if (decision.decision.outcome === 'allow_for_session' && decision.covers !== undefined) {\n", "  if (decision.decision.outcome === 'allow_for_session' && false) {\n")],
    ),
    (
        "M89 · 739 D3 · the line drops the rule it names — killed by `what-a-conversation-grant-covers-said.render.test.ts`",
        [(USER_INPUT_OFFER, "    return `the agent may do this, and for this conversation what the provider’s own rule for it covers: ${decision.covers}`\n", "    return `the agent may do this, and for this conversation what the provider’s own rule for it covers`\n")],
    ),
    (
        "M90 · 739 D3 · Home does not hand covers to its decision (and so the person's queue) — killed by `what-a-conversation-grant-covers-said.render.test.ts`",
        [(ATTENTION, "            ...(outcome === 'allow_for_session' && covers !== null ? { covers } : {}),\n", "")],
    ),
    (
        "M91 · 739 D3 · Home's covers taken from the disclosure sentence, not the rules — killed by `what-a-conversation-grant-covers-said.render.test.ts`",
        [(ATTENTION, "        const covers = conversationGrantCovers(scope)\n", "        const covers = conversationGrantSaid(scope)\n")],
    ),
    (
        "M92 · 739 D3 · the card does not derive covers for its line — killed by `what-a-conversation-grant-covers-said.dom.test.ts`",
        [(PERMISSIONCARD, "  const covers = outcome === 'allow_for_session' ? conversationGrantCovers(scope.value) : null\n", "  const covers = outcome === 'allow_for_session' ? null : null\n")],
    ),
    (
        "M93 · 739 D3 · the card's decision drops covers before whatThisAnswerDoes — killed by `what-a-conversation-grant-covers-said.render.test.ts`",
        [(PERMISSIONCARD, "      ...(covers === null ? {} : { covers }),\n", "      ...{},\n")],
    ),
    # ── `737` F-6 — a command with no answer lets go of `busy` at its bound, and says so ──
    (
        "M94 · 739 D4 · the bound never lowers busy (countDown dropped from the timer) — killed by `a-command-that-has-no-answer.test.ts`",
        [(SESSION_STORE, "      bounds.delete(bound)\n      countDown()\n      record.unanswered += 1\n", "      bounds.delete(bound)\n      record.unanswered += 1\n")],
    ),
    (
        "M95 · 739 D4 · the bound is never counted (unanswered never raised) — killed by `a-command-that-has-no-answer.test.ts`",
        [(SESSION_STORE, "      countDown()\n      record.unanswered += 1\n", "      countDown()\n")],
    ),
    (
        "M96 · 739 D4 · the bound lowers busy under another command (not a count) — killed by `a-command-that-has-no-answer.test.ts`",
        [(SESSION_STORE, "      bounds.delete(bound)\n      countDown()\n", "      bounds.delete(bound)\n      counted = false\n      record.busy = false\n")],
    ),
    (
        "M97 · 739 D4 · a late answer never takes its count back — killed by `a-command-that-has-no-answer.test.ts`",
        [(SESSION_STORE, "      else record.unanswered -= 1\n", "")],
    ),
    (
        "M98 · 739 D4 · a released command is counted down twice (bound and late answer) — killed by `a-command-that-has-no-answer.test.ts`",
        [(SESSION_STORE, "      counted = false\n", "")],
    ),
    (
        "M99 · 739 D4 · the bound fires at once — killed by `a-command-that-has-no-answer.test.ts`",
        [(SESSION_STORE, "    }, A_COMMAND_IS_WAITED_ON_MS)\n", "    }, 0)\n")],
    ),
    (
        "M100 · 739 D4 · the bound is not 15 s — killed by `a-command-that-has-no-answer.test.ts`",
        [(SESSION_STORE, "export const A_COMMAND_IS_WAITED_ON_MS = 15_000\n", "export const A_COMMAND_IS_WAITED_ON_MS = 30_000\n")],
    ),
    (
        "M101 · 739 D4 · an answered command's bound is not cleared — killed by `a-command-that-has-no-answer.test.ts`",
        [(SESSION_STORE, "      clearTimeout(bound)\n", "")],
    ),
    (
        "M102 · 739 D4 · dispose leaves the bounds running — killed by `a-command-that-has-no-answer.test.ts`",
        [(SESSION_STORE, "      for (const bound of bounds) clearTimeout(bound)\n", "")],
    ),
    (
        "M103 · 739 D4 · a bound is never registered for dispose — killed by `a-command-that-has-no-answer.test.ts`",
        [(SESSION_STORE, "    bounds.add(bound)\n", "")],
    ),
    (
        "M104 · 739 D4 · the bound answers the CALLER in the command's place — killed by `a-command-that-has-no-answer.test.ts`",
        [(SESSION_STORE, "      return { ok: true, value: await action(record) }\n", "      return {\n        ok: true,\n        value: await Promise.race([\n          action(record),\n          new Promise<T>((settle) =>\n            setTimeout(() => settle(undefined as T), A_COMMAND_IS_WAITED_ON_MS),\n          ),\n        ]),\n      }\n")],
    ),
    (
        "M105 · 739 D4 · the line's words (its second sentence dropped) — killed by `a-command-that-has-no-answer.test.ts`",
        [(SESSION_STORE, "  'seconds. An answer may still come — this line goes once every answer has.'\n", "  'seconds.'\n")],
    ),
    (
        "M106 · 739 D4 · a new record starts counted unanswered — killed by `a-command-that-has-no-answer.test.ts`",
        [(SESSION_RECORD, "    unanswered: 0,\n", "    unanswered: 1,\n")],
    ),
    (
        "M107 · 739 D4 · the pane draws the line only for two or more — killed by `a-command-that-has-no-answer.dom.test.ts`",
        [(CONVERSATIONPANE, "<p v-if=\"props.record.unanswered > 0\" class=\"pane-unanswered\" data-cy=\"session-unanswered\">", "<p v-if=\"props.record.unanswered > 1\" class=\"pane-unanswered\" data-cy=\"session-unanswered\">")],
    ),
    (
        "M108 · 739 D4 · the pane's line does not say the sentence — killed by `a-command-that-has-no-answer.dom.test.ts`",
        [(CONVERSATIONPANE, "          {{ A_COMMAND_HAS_NOT_ANSWERED }}\n", "          {{ props.record.error }}\n")],
    ),
    (
        "M109 · 739 D4 · the line is not painted — killed by `a-command-that-has-no-answer.dom.test.ts`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the sign-in panel's rule now sits between .pane-unanswered and .pane-error; the plant still hides the no-answer line
        # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
        [(CONVERSATIONPANE, "  color: var(--waiting-text);\n  font-size: var(--type-caption);\n}\n\n/* The profile's sign-in panel, in the same strip as the refusal it answers. */\n", "  color: var(--waiting-text);\n  font-size: var(--text-4xs);\n  display: none;\n}\n\n/* The profile's sign-in panel, in the same strip as the refusal it answers. */\n")],
    ),
    (
        "M110 · 739 D4 · the go-ahead's busy-only title falls back to the turn's — killed by `a-command-that-has-no-answer.dom.test.ts`",
        [(CONVERSATIONPANE, "                  : composerState === 'idle'\n", "                  : false\n")],
    ),
    (
        "M111 · 739 D4 · the go-ahead's busy-only title words — killed by `a-command-that-has-no-answer.dom.test.ts`",
        [(CONVERSATIONPANE, "  'Wait for what you just asked of this conversation to be answered, then start work.'\n", "  'Wait for the current turn to finish, then start work.'\n")],
    ),
    (
        "M112 · 739 · #23 · the no-answer line claims the buttons again ('its buttons no longer wait for it') — killed by `a-command-that-has-no-answer.test.ts`",
        [(SESSION_STORE, "  'seconds. An answer may still come — this line goes once every answer has.'", "  'seconds, so its buttons no longer wait for it. An answer may still come — this line goes when it does.'")],
    ),
    (
        "M113 · 739 · #28 · dispose forgets the bounds' timers (a bound fires into a record after dispose) — round-0 code that the retitled §4 measures — killed by `a-command-that-has-no-answer.test.ts`",
        [(SESSION_STORE, "      for (const bound of bounds) clearTimeout(bound)\n      bounds.clear()\n", "      bounds.clear()\n")],
    ),
    # ── `737` F-7 — *Stop and send* in R43's words, with the host's bound ──
    (
        "M114 · 739 D5 · the title back to main: \"Stop <who> and send this instead\" — killed by `stop-and-send-says-it-asks.render.test.ts`",
        [(PROMPTCOMPOSER, ":title=\"`Stop and send — ${A_STOP_THEN_THIS_IS_SENT} (${interruptKey})`\"", ":title=\"`Stop ${who} and send this instead (${interruptKey})`\"")],
    ),
    (
        "M115 · 739 D5 · one spelling: the title retypes the clause instead of reading the constant — killed by `stop-and-send-says-it-asks.render.test.ts`",
        [(PROMPTCOMPOSER, "Stop and send — ${A_STOP_THEN_THIS_IS_SENT} (", "Stop and send — the turn is asked to stop; this is sent once it has ended, or comes back to you if it has not within seconds (")],
    ),
    (
        "M116 · 739 D5 · the plain busy foot back to main: \"to interrupt and send now\" — killed by `stop-and-send-says-it-asks.render.test.ts`",
        [(PROMPTCOMPOSER, "          <strong>{{ interruptKey }}</strong> is Stop and send: {{ A_STOP_THEN_THIS_IS_SENT }}\n", "          <strong>{{ interruptKey }}</strong> to interrupt and send now\n")],
    ),
    (
        "M117 · 739 D5 · the own-waiting foot back to main: \", or ⇧⌘↵ to interrupt and send this now.\" — killed by `stop-and-send-says-it-asks.render.test.ts`",
        # ⚑ **T-003 · re-anchored in place, not retired** — D-010 rewrote the waiting foot; the row still puts back main's *interrupt and send this now*. Re-verified RED alone.
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — D-027 rewrote the own-waiting foot's first half to 'with what is already waiting — a
        # command goes alone', so the old anchor went dark; the rule (the foot says Stop and send in
        # R43's words, not main's 'interrupt and send this now') survives. The plant restores main's
        # second half after the new first half. Killed by
        # `stop-and-send-says-it-asks.render.test.ts`, `the-stop-says-it-asks.render.test.ts`.
        [
            (PROMPTCOMPOSER, '          waiting — a command goes alone · <strong>{{ interruptKey }}</strong> is Stop and send:\n          {{ A_STOP_THEN_THIS_IS_SENT }}\n', '          waiting — a command goes alone, or <strong>{{ interruptKey }}</strong> to interrupt and send this now.\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The subject is gone. M118 reverted the
        # ⇧⌘↵ clause inside the not-yours foot (688 R22: 'A message you did not write is already
        # waiting … Wait for it to go before queueing another.'). Its anchor is left stale, so the
        # census records it retired (`anchor-absent`).
        "M118 · 739 D5 · the not-yours foot (688 R22) back to main: \", or ⇧⌘↵ to interrupt and send this now.\" — killed by `stop-and-send-says-it-asks.render.test.ts`",
        [(PROMPTCOMPOSER, "          is. Wait for it to go before queueing another.\n          <strong>{{ interruptKey }}</strong> is Stop and send: {{ A_STOP_THEN_THIS_IS_SENT }}.\n", "          is. Wait for it to go before queueing another, or\n          <strong>{{ interruptKey }}</strong> to interrupt and send this now.\n")],
    ),
    (
        "M119 · 739 D5 · hop: PromptComposer no longer imports A_STOP_THEN_THIS_IS_SENT — killed by `stop-and-send-says-it-asks.render.test.ts`",
        [(PROMPTCOMPOSER, "import { A_STOP_THEN_THIS_IS_SENT } from '../lib/stop-unanswered'\n", "")],
    ),
    (
        "M120 · 739 D5 · the clause promises a send NOW: \"and this is sent now\" — killed by `stop-and-send-says-it-asks.render.test.ts`",
        [(STOP_UNANSWERED, "`${A_STOP_ASKS_THE_TURN}; this is sent once it has ended, or comes back to you if it has not within seconds`", "`${A_STOP_ASKS_THE_TURN}, and this is sent now`")],
    ),
    (
        "M121 · 739 D5 · the clause claims the stop: \"the turn is stopped, and this is sent once it has ended\" — killed by `stop-and-send-says-it-asks.render.test.ts`",
        [(STOP_UNANSWERED, "export const A_STOP_THEN_THIS_IS_SENT = `${A_STOP_ASKS_THE_TURN}; this is sent once it has ended, or comes back to you if it has not within seconds`", "export const A_STOP_THEN_THIS_IS_SENT = `the turn is stopped; this is sent once it has ended, or comes back to you if it has not within seconds`")],
    ),
    (
        "M122 · 739 · #2/#25 · the Stop-and-send clause loses the host's limit (round 0's promise without condition) — killed by `stop-and-send-says-it-asks.render.test.ts`",
        [(STOP_UNANSWERED, "export const A_STOP_THEN_THIS_IS_SENT = `${A_STOP_ASKS_THE_TURN}; this is sent once it has ended, or comes back to you if it has not within seconds`", "export const A_STOP_THEN_THIS_IS_SENT = `${A_STOP_ASKS_THE_TURN}; this is sent once it has ended`")],
    ),
    (
        "M123 · 739 · #2 · the Stop-and-send title adds round 0's unbounded 'if it does not end' clause — killed by `stop-and-send-says-it-asks.render.test.ts`",
        [(PROMPTCOMPOSER, ":title=\"`Stop and send — ${A_STOP_THEN_THIS_IS_SENT} (${interruptKey})`\"", ":title=\"`Stop and send — ${A_STOP_THEN_THIS_IS_SENT}; if it does not end, this comes back to you (${interruptKey})`\"")],
    ),
    (
        "M124 · 739 · #2 · the free busy foot types the clause without the limit (a second spelling) — killed by `stop-and-send-says-it-asks.render.test.ts`",
        [(PROMPTCOMPOSER, "          <strong>{{ interruptKey }}</strong> is Stop and send: {{ A_STOP_THEN_THIS_IS_SENT }}\n        </template>", "          <strong>{{ interruptKey }}</strong> is Stop and send: the turn is asked to stop; this is sent once it has ended\n        </template>")],
    ),
    (
        "M125 · 739 D5 · the limit leaves the words (rule 8.4): no \"or comes back to you if it has not within seconds\" — killed by `stop-and-send-says-it-asks.render.test.ts`",
        [(STOP_UNANSWERED, "`${A_STOP_ASKS_THE_TURN}; this is sent once it has ended, or comes back to you if it has not within seconds`", "`${A_STOP_ASKS_THE_TURN}; this is sent once it has ended`")],
    ),
    # ── round 2 — the pointer where its row is, the own folder, an unnamed tool, the footprint, the words ──
    (
        "M126 · 739 round 2 #2/#16 · the proposal's pointer at 'kept grant' drawn on every settled card whose Always allow keeps a prefix rule — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSIONCARD, "  () => keepsARule.value && (!answered.value || props.item.outcome === 'allow_always'),", "  () => keepsARule.value,")],
    ),
    (
        "M127 · 739 round 2 #17 · keptGrantOf leaves out every folder rule, not only the conversation's own — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSION_OFFER, ".filter((rule) => !(rule.kind === 'directory' && sameFolder(rule.path, scope.cwd)))", ".filter((rule) => rule.kind !== 'directory')")],
    ),
    (
        "M128 · 739 round 2 #3 · a server's tool with no clean name leaves a gap ('every  call on github') — killed by `always-allow-on-every-surface.render.test.ts`",
        [(PERMISSION_OFFER, "if (rule.server !== undefined && rule.tool === '') {", "if (false) {")],
    ),
    (
        "M129 · 739 round 2 #9 · the no-answer line is not in the pane's footprint, so a pinned reader loses the last line — killed by `a-command-that-has-no-answer.dom.test.ts`",
        [(CONVERSATIONPANE, "|${props.record.unanswered > 0 ? 'unanswered' : ''}`,", "`,")],
    ),
    (
        "M130 · 739 round 2 #6/#15 · the no-answer line says the window stopped waiting again (round 1's words) — killed by `a-command-that-has-no-answer.test.ts`",
        [(SESSION_STORE, "'seconds. An answer may still come — this line goes once every answer has.'", "'seconds. This window has stopped waiting for it — an answer may still come, and this line goes when it does.'")],
    ),
    (
        "M131 · 739 round 2 · KEPT_BEYOND_IT_SAYS back to 'reads that file', without the provider's safety checks — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        # ⚑ **W4.428 · re-anchored in place, not retired** — the window's words now name the product BroCrew, or say "This app" for the app's own acts; the row plants the same defect in the renamed text.
        [(STANDING_GRANTS, "'conversation whose launch applies that file is not asked about what it covers, beyond the ' +\n  'provider’s own safety checks. BroCrew cannot take them back. Listed from the part of this ' +\n  'conversation this window has loaded.'", "'conversation that reads that file is not asked about what it covers. BroCrew cannot take them ' +\n  'back. Listed from the part of this conversation this window has loaded.'")],
    ),
    (
        "M132 · 739 round 2 · the free reopen sentence stops saying where the kept grant STAYS — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        # ⚑ **always allow that recurs · re-anchored in place, not retired** — the line ends 'It forgets its' now; the plant still drops where the kept grant stays
        [(REOPENING, "'always allow stays where it was kept. It forgets its ' +", "'always allow. It forgets its ' +")],
    ),
    (
        "M133 · 739 round 2 · REOPEN_COSTS' kept row drops 740's exception (carriedByTheRepository) — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(REOPENING, "      '`projectRulesFor` / `carriedByTheRepository`) — so the free sentence says where it STAYS, ' +\n", "      ') — so the free sentence says where it STAYS, ' +\n")],
    ),
    (
        "M134 · 739 round 2 #18 · keptInThisConversation lists the same rule in the same file twice — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(STANDING_GRANTS, "    if (kept.some((one) => one.said === said && one.file === file)) continue\n", "")],
    ),
    (
        "M135 · 739 round 2 #18 · the kept dedupe ignores the file — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(STANDING_GRANTS, "if (kept.some((one) => one.said === said && one.file === file)) continue", "if (kept.some((one) => one.said === said)) continue")],
    ),
    (
        "M136 · 739 round 2 #11 · a Claude whole-tool kept rule is listed under an mcp__ name it does not have, so the chip claims it too — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(STANDING_GRANTS, "? [rule.server === undefined ? rule.tool : `mcp__${rule.server}__${rule.tool}`]", "? [`mcp__${rule.server}__${rule.tool}`]")],
    ),
    (
        "M137 · 739 lead · a kept card that named no rule is said as its bare action again, which reads as the whole tool — killed by `what-always-allow-kept-and-what-is-not-asked-again.render.test.ts`",
        [(STANDING_GRANTS, "          `the provider’s own rule for ${item.request.action}, which its card did not name`\n", "          item.request.action\n")],
    ),
]
