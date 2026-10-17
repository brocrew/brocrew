"""377 · The text a child is actually told.

⛔ **One subject with three ways of failing that all read as working.**

1. **The text says the wrong thing.** A clause that ships before its mechanism, a limit dropped off a
   protection, a description where a rendering belongs. ⚑ Every one of these produces a bundle that
   compiles, publishes and is read by a live child — the failure is entirely in what it SAYS.
2. **The text reaches nobody.** A leaf under a name the provider does not read, a publish that
   overwrites somebody's own file, a refusal nobody is told about.
3. **The selector picks wrong.** `role` was landed shape-only by `369`; this dispatch gives it its
   first value, and *"assume worker"* is the defect `369` wrote a paragraph to forbid.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M4` | ⚑ **`apps/desktop/test/the-text-a-child-is-actually-told.test.ts`** §1/§2 — what the text says |
| `M5`-`M11` | ⚑ **…** §3 — the dynamic layer, rendered from data |
| `M12`-`M16` | ⚑ **…** §4 — publishing, and refusing to take somebody else's leaf |
| `M17`-`M21` | ⚑ **…** §5 — the repository bridge and the order of the list |
| `M22`-`M25` | ⚑ **…** §6 — the role seed |
| `M26`, `M27` | ⚑ **…** §8 — what the HOST hands the reader, at a launch and at a reopen |
| `M28`-`M30` | ⚑ **`apps/desktop/test/dom/the-text-a-child-is-actually-told.dom.test.ts`** — what a person sees |

## ⛔ What this table deliberately does NOT contain

⛔ **No row deleting `bundleHeader`'s version number.** It is carried by the marker either way, and
`BUNDLE_MARKER` — the prefix the ownership check compares — does not contain it. ⚑ **A row nothing
can kill is not carrying its rule**, so the absence is recorded here rather than written as a
survivor.

⛔ **No row on the `MARKER_PROBE_BYTES` bound.** Raising it changes no answer this repository can
produce: every marker is 33 bytes and lands in the first line, so a row moving 256 to 4096 would be
a no-op mutation reporting as a survivor.

⛔ **No row making `publishOwnFile` write through the published name instead of staging.** That is
`261` §2's property and `261`'s own table owns it; a second copy here would kill on somebody else's
test and tell this dispatch nothing.

⛔ **No row on the ORDER of the two `WAITS_FOR_S2` entries.** The census iterates the list, so the
order is not a rule and a row permuting it could not be refused.

## 🔴 497 · `M1`'s subject was WITHDRAWN by the product owner, and the row was re-aimed

⛔ **`M1` measured *"the two roadmap rules lose their limit"*** — `never merge` and `never modify
production` shipping as though this app enforced them. ⚠️ **HO-035 (2026-09-16) withdrew both as
product invariants**, in the PO's own words: *"I misread them as properties of the product… BroBot
is generic. It can run his coding workflow, and it can plan a vacation."* ⛔ **So the recorded
verdict for `M1` was measured against a sentence that no longer exists, and against a rule this
product no longer makes.**

⚑ **Re-aimed rather than retired** (`314`'s case, and 142's rule): the row now puts the withdrawn
sentence BACK into `COMMON_RULES`, which is the stronger half of what it always protected, and it
still dies in `the-text-a-child-is-actually-told.test.ts` — on `NOT_IN_THE_FACTORY_TEXT`'s new
`merge` and `production` members and on `497`'s own named absence test. 🔴 **The verdict in
`mutations.txt` is historical and was measured against the OLD text; only a re-run makes it
current.** ⚠️ This table is `unrun`, so nothing was downgraded by the label change.

## ⚠️ The one row whose absence is a finding rather than a decision

⛔ **There is no row for *"the first launch of an identity states the ruled grants instead of
nothing"*.** The read runs before `store.create` writes the row, so `capabilitiesOf` genuinely
answers null — and a mutation forcing `DEFAULT_CAPABILITIES` there would be caught by §8's paired
launches. ⚑ It IS written: `M27`. This paragraph exists because the row looks like a widening and is
in fact the ordering finding this dispatch made, and a reader meeting `M27` cold would not know that.
"""

FACTORY = "apps/desktop/src/main/runtime/factory-text.ts"
BUNDLE = "apps/desktop/src/main/runtime/profile-bundle.ts"
READER = "apps/desktop/src/main/runtime/instructions.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
WIRE = "apps/desktop/src/shared/runtime-ipc.ts"
MIGRATION = "apps/desktop/src/main/db/migrations/0021_marvelous_lifeguard.sql"
PANEL = "apps/desktop/src/renderer/src/components/SessionInstructions.vue"
# ⚑ F093 · the refusal words moved out of the panel into one table both surfaces read.
REFUSALS = "apps/desktop/src/renderer/src/lib/refusal-words.ts"

MUTATIONS = [
    # ── §1/§2 · what the text says ────────────────────────────────────────────────────────────
    (
        # 🔴 **RE-AIMED IN PLACE BY 497, because the row's PREMISE was overturned** — 314's case,
        # not a stale anchor. ⛔ The subject was *the two roadmap rules ship WITHOUT their limit*,
        # and HO-035 withdrew the rules themselves: they were one person's working discipline, read
        # as properties of the product. ⚠️ **Restoring the old anchor would assert something the
        # product deliberately no longer does**, which is the tell for this case; retiring the row
        # would delete the argument, and rewriting it silently would hide that a ruling was
        # reversed. ⚑ **The surviving half is the stronger one** — the sentence must not be in the
        # factory text at all — so the row now REINTRODUCES it, and the same kind of census kills
        # it: `NOT_IN_THE_FACTORY_TEXT` holds `merge` and `production`, and
        # `the-text-a-child-is-actually-told.test.ts` §2 walks every member over every role.
        "M1 · 🔴 the withdrawn rule comes BACK into the common rules · HO-035 struck *never merge* "
        "and *PROD is read-only* as product invariants — one person's working discipline, read as "
        "properties of a product that can just as well plan a vacation "
        "⚑ RE-AIMED IN PLACE BY 497",
        [
            (
                # ⚑ **Corrected in place at `726` §2a** onto the line that replaced the one this was
                # anchored on: R92 turned *"Work inside your working directory…"* into the habit
                # *"Put the files you create in your working directory…"*, and the row still plants
                # the withdrawn rule immediately above it. The defect is unchanged.
                FACTORY,
                # ⚑ **W4.481 · re-anchored in place, not retired** — W4.481: the v6 core replaced "How you work" and "Rules"; the same mutation, applied to the core's sentence that carries the rule
                # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The v9 core moved the anchor; original defect, ID and killer retained.
                # ⚑ **W4.643 · re-anchored in place, not retired** — NOT VERIFIED; source-only. v21 rewrote the sentence this row's defect lives in; the same defect, applied to the v21 sentence that carries it
                # ⚑ **W4.669 · re-anchored in place, not retired** — verified RED alone (verify_row; 377 M4 by a plant against `a-check-in-is-a-question.test.ts` §1, whose §2 waits on request_action). v22 rewords the core sentence this row's defect lives in; the same defect, applied to the v22 sentence that carries it
                "    'person or project facts. Use relevant skills; report missing guidance and continue ' +\n    'permitted work.',\n",
                "    'person or project facts. Use relevant skills; report missing guidance and continue ' +\n    'permitted work.',\n  'Never merge, and never modify production. These are rules you follow, not limits this app ' +\n    'places on you — nothing here stops a command you run from doing either.',\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-002): PE-003 (one situational instruction set for every agent; the role column is no longer read) removed the role sections a null role was rendered from.**
        # Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M2 · ⛔ an unrecorded role is rendered as a worker · the exact fold `369` forbids — every "
        "pre-`370` identity is handed a text a person never chose, indistinguishable afterwards "
        "from one who chose it",
        [
            (
                FACTORY,
                "  const role = context.role === null ? null : ROLE_SECTIONS[context.role]",
                "  const role = ROLE_SECTIONS[context.role ?? 'worker']",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-002): PE-003 (one situational instruction set for every agent; the role column is no longer read) removed the null-role sentence: no role is read, so there is none to explain.**
        # Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M3 · ⛔ the null role says nothing · the role section is absent and no sentence explains "
        "it, so a model infers what it is and a person reading the drawer sees a gap",
        [
            (
                FACTORY,
                "      ? '- No role is recorded for this profile, so this app has not told you what you are. The rules above apply whatever you are.'",
                "      ? ''",
            )
        ],
    ),
    (
        # ⚠️ **Re-labelled by `393`, and re-verified RED rather than assumed.** The ANCHOR did not
        # move; what moved is what kills the row. It used to die on the `WAITS_FOR_S2` census —
        # *"`reply_to_parent` before the tool exists"* — and S2 has landed, so that census no longer
        # forbids the word. ⛔ A row whose killer has gone away is a row protecting nothing, and the
        # honest repair is to say what it catches NOW rather than to retire it or leave the sentence
        # to age: the clause lands in `COMMON_RULES`, which every role gets, so **BroBot — which has
        # no parent — is instructed to reply to one**, and `393`'s control on the brobot bundle is
        # what notices. 684 re-anchors this on the now reader-scoped agent handover rule;
        # the subject survives, and the row is re-verified red in 684's targeted evidence.
        "M4 · 🔴 the reply clause lands in the rules EVERY role gets · BroBot is told to finish a "
        "task by replying to a parent it does not have, and `377`'s *give the whole answer* rule is "
        "gone — a role-specific instruction leaking into the common ones",
        [
            (
                FACTORY,
                # ⚑ **W4.481 · re-anchored in place, not retired** — W4.481: the v6 core replaced "How you work" and "Rules"; the same mutation, applied to the core's sentence that carries the rule
                # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The v9 core moved the anchor; original defect, ID and killer retained.
                # ⚑ **W4.643 · re-anchored in place, not retired** — NOT VERIFIED; source-only. v21 rewrote the sentence this row's defect lives in; the same defect, applied to the v21 sentence that carries it
                # ⚑ **W4.669 · re-anchored in place, not retired** — verified RED alone (verify_row; 377 M4 by a plant against `a-check-in-is-a-question.test.ts` §1, whose §2 waits on request_action). v22 rewords the core sentence this row's defect lives in; the same defect, applied to the v22 sentence that carries it
                "    'person or project facts. Use relevant skills; report missing guidance and continue ' +\n    'permitted work.',\n",
                "    'person or project facts. Use relevant skills; report missing guidance and continue ' +\n    'permitted work.',\n  'When you are done, call reply_to_parent with the task id.',\n",
            )
        ],
    ),
    # ── §3 · the dynamic layer ────────────────────────────────────────────────────────────────
    (
        "M5 · 🔴 the parent paragraph becomes delegation again · HO-009 §7.3's original wording, "
        "which `370` measured false on both sides of a restart",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The rule survives: the parent paragraph must state provenance (who
        # started this conversation, who can message it), not delegation ('it gave you this task and
        # it is who you report to'). The paragraph now names `context.startedBy` (a sentence-name),
        # so the plant rewrites that sentence as delegation. Killed by
        # `the-text-a-child-is-actually-told.test.ts`.
        [
            (FACTORY, "      `- This conversation was started by ${context.startedBy}. That conversation can send you ` +\n        'messages, and can still do so after this app has been restarted.',", '      `- You have a parent: ${context.startedBy}. It gave you this task and it is who you report to.`,'),
        ],
    ),
    (
        "M6 · ⛔ the restart half of the parent sentence is dropped · `370`'s stale claim by "
        "omission — a child is left believing the relationship dies with the process, which `373` "
        "fixed",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The rule survives: the parent sentence must keep its restart half
        # ('and can still do so after this app has been restarted'). The literal moved to the
        # `startedBy` paragraph, so the plant trims the second string to 'messages.'. Killed by
        # `the-text-a-child-is-actually-told.test.ts`.
        [
            (FACTORY, "        'messages, and can still do so after this app has been restarted.',", "        'messages.',"),
        ],
    ),
    (
        "M7 · 🔴 the grants are not rendered · every capability sentence goes back to being prose "
        "somebody has to remember to update — HO-015 §2's whole ruling, undone",
        [
            (
                FACTORY,
                "  if (context.capabilities !== null) {",
                "  if (false as boolean) {",
            )
        ],
    ),
    # Re-anchored, NOT VERIFIED and HELD; its test publishes provider-home files.
    ("M8 · ⛔ the grant block loses its bound · a person's grant reads as a limit on everything the agent can do, which is `368`'s consent-never-containment defect one surface over", [('apps/desktop/src/main/runtime/factory-text.ts', "for ${PRODUCT_NAME}'s agent tools", 'for your actions')]),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** D-016 removed the subject. The commit
        # message says 'Projects stop being something a person or a model meets', and its diff to
        # factory-text.ts deletes the `project` field of the bundle context and both the 'You are
        # working in the project' line and the `## About ${context.project.title}` section. The
        # anchor line `if (context.project !== null && context.project.description !== null) {` no
        # longer exists, and there is no description paragraph left to render as 'null'. Its anchor
        # is left stale, so the census records it retired.
        "M9 · ⛔ a null description renders its paragraph · the words `null` reach a model and a "
        "person, which `370` forbids by name",
        [
            (
                FACTORY,
                "  if (context.project !== null && context.project.description !== null) {",
                "  if (context.project !== null) {",
            )
        ],
    ),
    (
        "M10 · ⚠️ the configured layer draws an empty heading · a section claiming a person has "
        "written rules when they have not — 086 in the other direction, on the seam 582 fills",
        # ⚑ **582 · the anchor's BYTES moved and its subject did not** (standing rule 27). The
        # heading became {@link YOUR_OWN_INSTRUCTIONS_HEADING} so the marker line at the top of the
        # same output can name it, and the trailing clause said *the seam Slice 5 fills* about a
        # seam that is now fed. ⛔ **Corrected in place and re-verified RED by hand**, which is what
        # that rule asks for — a corrected anchor keeps a verdict it never earned until somebody
        # re-takes it.
        [
            (
                FACTORY,
                # ⚑ **583 · the composer builds SECTIONS with a layer each now**, so the guard is a
                # block rather than a one-liner. Same guard, same defect: an empty heading claiming
                # a person has written rules when they have not.
                "  if (configured !== '') {",
                "  if (true) {",
            )
        ],
    ),
    (
        "M11 · ⛔ dynamic is rendered before factory · HO-009 §2's order reversed, so what is true "
        "of this conversation arrives above the rules it is qualified by",
        [
            (
                FACTORY,
                # ⚑ **583 · the push carries a layer now** (standing rule 27); the reorder is the same.
                "  sections.push({\n    whose: 'dynamic',\n    heading: '## This conversation',",
                "  sections.splice(2, 0, {\n    whose: 'dynamic',\n    heading: '## This conversation',",
            )
        ],
    ),
    # ── §4 · publishing ───────────────────────────────────────────────────────────────────────
    (
        "M12 · 🔴 the header goes · a bundle with no role, project or grants compiles to an EMPTY "
        "leaf, and `362` §2 measured that an empty profile override does not shadow — the provider "
        "silently reads something else",
        [
            (
                FACTORY,
                # Re-anchored, NOT VERIFIED and HELD: its killer publishes into provider homes.
                # Remove only the ownership header; retain the identity and instructions.
                "        bundleHeader(configured !== ''),\n",
                "",
            )
        ],
    ),
    (
        "M13 · 🔴 any existing leaf is treated as ours · somebody's own `AGENTS.override.md` is "
        "overwritten on the next launch — HO-016's *the app disagreeing with them silently*",
        [
            (
                BUNDLE,
                "  if (!stat.isFile()) return false",
                "  if (!stat.isFile()) return false\n  return true",
            )
        ],
    ),
    (
        "M14 · ⛔ a symlink at the leaf is ours · a link whose target's first line carries the "
        "marker licenses replacing the person's own link, and nothing says so",
        [
            (
                BUNDLE,
                "  if (!stat.isFile()) return false",
                "  if (stat.isSymbolicLink()) return true",
            )
        ],
    ),
    (
        "M15 · 🔴 the refusal is not surfaced · the conflict is a value nobody renders, which is "
        "exactly *only logged* — the half HO-016 says must reach a person",
        [
            (
                READER,
                "  if (inputs.bundle?.ok === false)\n    refused.push({ path: inputs.bundle.path, reason: inputs.bundle.reason })",
                "",
            )
        ],
    ),
    (
        "M16 · ⛔ the refusal is surfaced on ONE provider · moved below the Codex early return, so "
        "a Codex conflict — the only provider whose leaf the provider itself reads — is silent",
        [
            (
                READER,
                "  if (inputs.bundle?.ok === false)\n    refused.push({ path: inputs.bundle.path, reason: inputs.bundle.reason })",
                "",
            ),
            (
                READER,
                "  const agent = readClaudeAgentMemory(inputs.providerHome)\n  refused.push(...agent.refused)",
                "  const agent = readClaudeAgentMemory(inputs.providerHome)\n  refused.push(...agent.refused)\n  if (inputs.bundle?.ok === false)\n    refused.push({ path: inputs.bundle.path, reason: inputs.bundle.reason })",
            ),
        ],
    ),
    # ── §5 · the bridge, and the order of the list ────────────────────────────────────────────
    (
        "M17 · 🔴 Codex is injected the repository's bytes as well · `364` §2.3's double supply — "
        "the provider gets its own native read AND a copy, on every request",
        [
            (
                READER,
                "  if (inputs.provider !== 'claude') {",
                "  if (false as boolean) {",
            )
        ],
    ),
    (
        "M18 · ⛔ an EMPTY project override stops shadowing · `362` §2's live matrix inverted, so "
        "Claude is given the `AGENTS.md` Codex is not reading",
        [
            (
                READER,
                "  const override = join(dir, AGENTS_OVERRIDE_FILENAME)\n  if (safeStat(override) !== null) return override",
                "  const override = join(dir, AGENTS_OVERRIDE_FILENAME)\n  const read = safeStat(override)\n  if (read !== null && read.size > 0) return override",
            )
        ],
    ),
    (
        "M19 · 🔒 the bridge ignores the home boundary · a `.git` at or above `$HOME` puts a "
        "person's own `~/AGENTS.md` in a prompt — `170` §4's defect, arriving through the new walk",
        [
            (
                READER,
                "  return chain.filter(\n    (dir) => !isHomeOrAbove(dir, homeResolved) && !isHomeOrAbove(realPath(dir), homeReal),\n  )",
                "  return chain",
            )
        ],
    ),
    (
        "M20 · ⛔ the shared file lands after the Claude-only one · the same-depth overlay is "
        "inverted, so a repository's shared conventions read as an override of its Claude prose",
        [
            (
                READER,
                "    const convention = conventions.get(dir)\n    if (convention !== undefined) take(convention, 'repository-conventions')",
                "",
            )
        ],
    ),
    (
        "M21 · ⛔ the app's own bundle lands after the agent's memory file · what the app says this "
        "agent IS arrives below what the agent wrote about itself, and loses the budget first",
        [
            (
                READER,
                "  if (inputs.bundle?.ok === true) take(inputs.bundle.path, 'profile-instructions')",
                "",
            )
        ],
    ),
    # ── §6 · the role seed ────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 took roles out on purpose (card:
        # "no roles"; commit: "roles ... are gone. The role ... column[] stay[s] in the schema,
        # unread and unwritten"). writeIdentityRow no longer writes a role and seededRoleFor is
        # deleted, so "nothing writes role" is now the intended state. Its anchor is left stale, so
        # the census records it retired.
        "M22 · 🔴 nothing writes `role` again · the column goes back to shape-only and the "
        "renderer has nothing to select on — `370`'s finding, restored. ⚑ **RE-ANCHORED at 419, not "
        "retired**: the write moved into `writeIdentityRow` and the role became *the caller's, or "
        "the seed's*, so the whole expression is what this row replaces now",
        [
            (STORE, "    const role = said.role ?? seededRoleFor(profileSlug)\n", "    const role = null\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** SEEDED_ROLES and seededRoleFor were
        # deleted with roles (commit: "roles ... are gone"). With no role seed, there is nothing
        # whose fold could depend on how a slug is spelled. Its anchor is left stale, so the census
        # records it retired.
        "M23 · ⛔ the seed stops folding · `Default` gets no role and `default` does, so BroBot's "
        "own text depends on how a launcher happened to spell its slug — 238's finding one column "
        "over",
        [
            (
                WIRE,
                "  const folded = foldProfileName(profileSlug)\n  return SEEDED_ROLES.find((seed) => seed.slug === folded)?.role ?? null",
                "  return SEEDED_ROLES.find((seed) => seed.slug === profileSlug)?.role ?? null",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is migration
        # 0021's `UPDATE agent_identity SET role = 'brobot' ... AND role IS NULL` seed. Roles and
        # their seeds were removed with the old model (D-014/D-016) and the single migration
        # 0000_the_tree has no `role` UPDATE at all, so there is no re-seed on upgrade to guard. Its
        # anchor is left stale, so the census records it retired.
        "M24 · 🔴 the migration re-seeds · `AND role IS NULL` goes, so an upgrade overwrites a role "
        "somebody set — HO-016 §2's *never re-grants what a person removed*, one column over",
        [
            (
                MIGRATION,
                "UPDATE `agent_identity` SET `role` = 'brobot' WHERE `slug` = 'default' AND `role` IS NULL;",
                "UPDATE `agent_identity` SET `role` = 'brobot' WHERE `slug` = 'default';",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The role reader (parseAgentRole over
        # row.role) is gone from session-store.ts, and the role column is "unread and unwritten"
        # (commit). No word from the database can be passed on as a role any more. Its anchor is
        # left stale, so the census records it retired.
        "M25 · ⛔ an unreadable word is handed on as a role · a typo in a hand-edited database "
        "promotes an agent to project manager, which is the narrow-direction rule `341` set for "
        "every capability fold",
        [
            (
                STORE,
                "      return parseAgentRole(row?.role ?? null)",
                "      return (row?.role ?? null) as AgentRole | null",
            )
        ],
    ),
    # ── §8 · what the host hands the reader ───────────────────────────────────────────────────
    (
        "M26 · 🔴 the resumed child forgets its parent · the reopen builds a context with no "
        "provenance, so `373`'s restored relationship is true in the rails and absent from the text "
        "the child is given",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule holds: a
        # reopened child must be handed its parent in the text it is given. The call is now
        # `instructionContext(profileId, cwd, parentSessionId)`, because the project argument was
        # removed, so only the anchor moved. The plant hands `null` where `slot.spawnedBy` stood.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a reopened child must be told its parent, from the ledger's `spawnedBy`, exactly
        # as a fresh launch is. The reopen site in `resumeSession` still builds
        # `instructionContext(row.profileId, row.cwd, slot.spawnedBy, sessionId)`, so the plant
        # passes `null` for the provenance and leaves the two other call sites alone. Killed by
        # `the-text-a-child-is-actually-told.test.ts`.
        [
            (HOST, '      this.instructionContext(row.profileId, row.cwd, slot.spawnedBy, sessionId),', '      this.instructionContext(row.profileId, row.cwd, null, sessionId),'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row's mutation is now the
        # production code: runtime-host.ts:12958 reads `capabilitiesOf(profileSlug) ??
        # DEFAULT_CAPABILITIES`, and grantsThisLaunchWillRecord was deleted. Its anchor is left
        # stale, so the census records it retired.
        "M27 · ⛔ the first launch is told it holds the RULED grants · the ruled defaults instead "
        "of the grants its own row is about to hold, so a shipped BroBot's first conversation is "
        "told it may start nobody while `admitSpawn` would admit the spawn — HO-031 §1",
        # 🔴 **485 · this row's REASON changed and its subject did not, so it is corrected in place
        # rather than retired** (142's rule for a docblock, applied to a mutation label). ⚠️ It used
        # to read *"a capability claim for a row that does not exist — `374`'s rails REFUSE an
        # identity they cannot find"*, and that sentence defended passing the store's `null`
        # straight through. ⛔ **The clause under it was false:** `onRegistered` runs the
        # `INSERT OR IGNORE` before `pumpEvents`, so there is no window in which a conversation
        # can ask and be answered `null`. 485 gave the line `grantsThisLaunchWillRecord`, and the
        # mutation now puts the weaker fallback back — which still tells BroBot it may start
        # nobody, on the one launch that matters.
        [
            (
                HOST,
                "          : (this.deps.store.capabilitiesOf(profileSlug) ??\n            grantsThisLaunchWillRecord(profileSlug)),",
                "          : (this.deps.store.capabilitiesOf(profileSlug) ?? DEFAULT_CAPABILITIES),",
            )
        ],
    ),
    # ── the panel ─────────────────────────────────────────────────────────────────────────────
    (
        "M28 · 🔴 the app's file and the agent's file wear one label · two owners one directory "
        "apart become indistinguishable, so a durable rule gets written into the file the next "
        "launch regenerates — 086, at its sharpest",
        [
            (
                PANEL,
                # ⚑ **W4.428 · re-anchored in place, not retired** — the window's words now name the product BroCrew, or say "This app" for the app's own acts; the row plants the same defect in the renamed text.
                "  'profile-instructions': 'profile instructions — written by BroCrew at this launch',",
                "  'profile-instructions': 'profile memory',",
            )
        ],
    ),
    (
        "M29 · ⛔ the conflict prints its raw word · `not read: unmanaged-override` tells a person "
        "nothing about whose file won or what to do — the silence the row exists to remove",
        [
            (
                REFUSALS,
                # ⚑ **W4.428 · re-anchored in place, not retired** — the window's words now name the product BroCrew, or say "This app" for the app's own acts; the row plants the same defect in the renamed text.
                "  'unmanaged-override':\n    'left alone — this file was not written by BroCrew, so its own instructions for this profile ' +\n    'were not published and the agent did not get them. Move or rename it to hand the name back.',",
                "",
            )
        ],
    ),
    (
        "M30 · ⚠️ the shared repository file is labelled as one engine's · the row stops saying "
        "what it is FOR, and names a provider on a panel `317` keeps provider-free",
        [
            (
                PANEL,
                # ⚑ **W4.428 · re-anchored in place, not retired** — the window's words now name the product BroCrew, or say "This app" for the app's own acts; the row plants the same defect in the renamed text.
                "  'repository-conventions': 'repository conventions — the file both engines share, read by BroCrew',",
                "  'repository-conventions': 'repository conventions — read here for Claude',",
            )
        ],
    ),
]
