"""516 · one local server, one identity, one provider — each row is THE DEFECT, put back (131).

🔴 **the person's ask, and the one word the PO changed.**

> ⚑ *"For actual real work, I need to give some mcp tools to brobot and the agents… an interface
> where I can add a new mcp server (by its local unauthenticated url) and then all the agents can
> see it."*

⛔ **"All the agents" became *register once, grant per identity*** (HO-040 §4.2) — *"this is the part
that makes focused identities genuinely specialised rather than differently named"* — and `M8` is
that sentence as a defect: a build where registering IS granting, which is the thing a reader of the
ask would write.

## ⛔ The six properties these rows guard

 1. 🔴 **None of OUR verb names reaches the model** (HO-040 §4.3, `HO-042` §2). The rail refuses the
    WHOLE server at registration, and the provider's own deny vocabulary is the race backstop the PO
    accepted in place of a namespacing proxy — `M1`, `M2`, `M12`, `M13`.
 2. ⛔ **A registration grants nobody** — `M8`.
 3. ⛔ **A grant is not reachable on a provider that cannot name what it is approving**
    (`HO-042` §3) — `M9`, `M17`.
 4. ⚑ **A server that could not be ASKED is NOT PERFORMED**, never assumed clean (standing rule 13)
    — `M6`.
 5. ⛔ **An external row can never replace `brobot`** — `M3`, `M11`.
 6. ⚠️ **A resume re-supplies what a start supplied**, because for Claude that is the only way
    anything comes back (`307`) — `M10`.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| M1, M2 | `apps/desktop/test/one-local-server-one-identity.test.ts` §1 — a colliding server refused and a clean one admitted, in one sample |
| M3 | …the same file's §1 — `brobot` reserved, with a name one letter over admitted |
| M4 | …the same file's §1 — `__` forbidden, with one underscore admitted |
| M5 | …the same file's §1 — a URL that is not loopback |
| M6 | …the same file's §1 — a server that could not be asked |
| M7 | …the same file's §1 — a name already registered |
| M8, M10 | …the same file's §2 — the granted identity gets it and its neighbour does not |
| M9 | …the same file's §2 — a Codex launch is handed nothing |
| M14 | …the same file's §2 — a grant removed while the conversation was closed |
| M15 | …the same file's §4 — `0032`'s journal stamp is above `0031`'s |
| M11 | `packages/runtime/test/external-mcp.test.ts` §2 — an external row named `brobot` |
| M12, M13 | …the same file's §3 and §4 — the deny vocabulary, and ONE derivation of it |
| M16 | …the same file's §4 — the docblock says the pin was not abandoned |
| M17, M18 | `apps/desktop/test/dom/one-local-server-one-identity.dom.test.ts` §2 and §1 |

⛔ **The table was NOT run.** Every row below was applied ALONE, watched go red against the gate
named above with its own controls green first, and restored from held bytes with a SHA-256 re-check
— which is what `verify-each-mutation-row` is for and is not the same claim as a table run.

## ⚠️ What is deliberately NOT here

 - ⛔ **No row on `scripts/clean-base.mjs`'s `MIGRATIONS` constant.** `383 M5` owns that line, and
   pinning one rule in two tables is how a verdict comes to be inherited
   (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
 - ⛔ **No row on `setCapabilities`' `externalMcpServerIds === undefined` guard.** Inverting it would
   clear the grants on every capability-only save — and no test in this repo saves capabilities on an
   identity that HOLDS a grant without also naming the set, so the row would be
   `a-true-mutation-measures-nothing`. ⚑ It is filed as a finding instead.
 - ⚠️ **No row on `anythingMoved`.** `470`'s own source census already pins the expression, so a
   mutation here would be killed by a string comparison rather than by a press —
   `a-source-census-that-pins-a-line-kills-every-row-on-it`.
 - ⚠️ **No row on either table's CHECK constraint or foreign key.** A migration is applied once per
   fixture database and drizzle's journal hashes the file, so a mutated `.sql` fails the ledger
   rather than the property.
 - ⛔ **No row on this dispatch's own census regeneration.** *A mutation on a census is invisible to
   that census.*
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RULES = "apps/desktop/src/shared/external-mcp.ts"
ADAPTER = "packages/runtime/src/claude/agent-tools.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
SHEET = "apps/desktop/src/renderer/src/components/CapabilitiesSheet.vue"
JOURNAL = "apps/desktop/src/main/db/migrations/meta/_journal.json"

MUTATIONS = [
    # ── the refusal rail: none of our names reaches the model ────────────────────────────────────
    (
        "M1 · 🔴 the collision rail is gone · a server publishing `spawn_agent` registers, and the "
        "model is taught a second verb whose meaning and governance are not this app's — HO-040 "
        "§4.3's whole subject, and `408`'s `collaboration.spawn_agent` arriving deliberately",
        [
            (
                HOST,
                "    if (colliding.length > 0) {\n"
                "      throw new Error(externalMcpCollisionRefusal(foldProfileName(name), colliding))\n"
                "    }\n",
                "",
            )
        ],
    ),
    (
        "M2 · ⛔ the comparison stops folding the server's side · `Spawn_Agent` is no longer one of "
        "ours, so a one-character rename walks past the rail the PO ruled sufficient",
        [
            (
                RULES,
                "return [...new Set(offered.filter((name) => ours.has(foldProfileName(name))))].sort()",
                "return [...new Set(offered.filter((name) => ours.has(name)))].sort()",
            )
        ],
    ),
    (
        "M3 · 🔴 `brobot` stops being reserved · a person can register a server under the name this "
        "app publishes its OWN tools under, after which `claudeMcpServersFor` refuses every launch "
        "that identity makes — the reservation is what keeps that unreachable",
        [
            (
                RULES,
                "  if (name === foldProfileName(reservedServer)) {",
                "  if (false && name === foldProfileName(reservedServer)) {",
            )
        ],
    ),
    (
        "M4 · ⛔ `__` is admitted in a server name · `507` F4: `tool-inventory.ts` splits a qualified "
        "name at the FIRST `__`, so `work__browser` is read as server `work` with a tool called "
        "`browser__…` — every row of that server mis-grouped in the one surface that tells a person "
        "what their agent can see",
        [
            (
                RULES,
                "  if (name.includes(EXTERNAL_MCP_FORBIDDEN_IN_A_NAME)) {",
                "  if (false && name.includes(EXTERNAL_MCP_FORBIDDEN_IN_A_NAME)) {",
            )
        ],
    ),
    (
        "M5 · ⛔ any host is accepted · an unauthenticated server on somebody else's network is "
        "handed to a model, with no credential anywhere in this build to say who is asking",
        [
            (
                RULES,
                "  if (!isLoopbackHost(url.hostname)) {",
                "  if (false && !isLoopbackHost(url.hostname)) {",
            )
        ],
    ),
    (
        "M6 · 🔴 a server that could not be ASKED is registered as clean · standing rule 13's exact "
        "failure: a handshake that did not happen is read as a handshake that found nothing, so the "
        "one rail this build has is skipped by turning the server off",
        [
            # The preflight still refuses an unread server; replace that refusal with an empty roster. NOT VERIFIED
            (
                HOST,
                "      // says which half failed so a person can start the thing and try again.\n"
                "      throw new ServerNotReached(url, error)\n",
                "      // says which half failed so a person can start the thing and try again.\n"
                "      offered = []\n",
            )
        ],
    ),
    (
        "M7 · ⛔ a taken name is not reported · the store's `INSERT OR IGNORE` writes nothing and the "
        "door answers as though it had, so a person sees a registration that did not happen and the "
        "first row's URL silently stands",
        [
            # ⚑ **W4.506 · re-anchored in place, not retired** — the Add form's registration is its own method again; the plant still answers a taken name as a registration. NOT VERIFIED
            (
                HOST,
                "    if (row === null) {\n"
                "      throw new Error(\n"
                "        `There is already a server called ${foldProfileName(name)}. ` +\n"
                "          `Remove it first, or register this one under another name.`,\n"
                "      )\n"
                "    }\n",
                "    if (row === null) return { id: '', name, url, registeredAt: 0, reach: said.reach }\n",
            )
        ],
    ),
    # ── register once, grant per identity ───────────────────────────────────────────────────────
    (
        "M8 · 🔴 REGISTERING IS GRANTING · the launch resolves the whole registry instead of this "
        "identity's grants, so *all the agents can see it* — which is the person's own sentence and the "
        "one word HO-040 §4.2 changed",
        [
            (
                HOST,
                "  const servers = store.externalMcpServersFor(profileSlug)",
                "  const servers = store.externalMcpServers()",
            )
        ],
    ),
    (
        # ⚠️ **RE-ANCHORED at `605`, and the subject moved with the world rather than dying.**
        # ⛔ This row DELETED the guard, and its kill rested on Codex being `unwired`: with the
        # line gone a Codex launch was handed servers it could not card. `HO-090` §1 withdrew
        # that ruling, `605` measured the reach and moved the entry — so both shipped providers
        # answer `available` and **deleting the line changes nothing any test can see**. ⚑ That
        # is `a-line-no-mutation-can-kill-is-not-carrying-its-rule`, arriving through a product
        # decision rather than through a rewrite.
        #
        # 🔴 **The guard's SECURITY half is its polarity, and that is still killable**: read the
        # declaration backwards and every launch on every provider is handed nothing, which is
        # the grant a person made silently doing nothing. ⛔ Deletion measured *is the table
        # consulted*; inversion measures *is it obeyed*, and only the second still has a world
        # that can tell.
        "M9 · ⛔ the provider's declaration is read BACKWARDS · a launch on a provider that DOES "
        "hand these over is given nothing, so a grant a person made reaches no conversation and "
        "no surface says why",
        [
            (
                HOST,
                "  if (capabilitiesFor(provider).externalMcpServers.state !== 'available') return {}",
                "  if (capabilitiesFor(provider).externalMcpServers.state === 'available') return {}",
            )
        ],
    ),
    (
        "M10 · ⛔ a REOPEN drops the grant · for Claude a resume is the only way anything comes back "
        "(`307`), so a reopened conversation's external tools vanish — indistinguishable, from any "
        "transcript, from a model that chose not to call them",
        [
            (
                HOST,
                "        ...externalMcpContext(this.deps.store, row.provider, row.profileId),\n",
                "",
            )
        ],
    ),
    # ── the adapter: beside `brobot`, never instead of it ────────────────────────────────────────
    (
        "M11 · 🔴 the external servers are spread AFTER the in-process one · a row named `brobot` "
        "silently OVERWRITES this app's own server and every one of its tools is answered by "
        "somebody else's endpoint — a substitution nothing downstream could see",
        [
            (
                ADAPTER,
                "  const taken = new Set<string>(ownServer === null ? [] : [ownServer])\n"
                "  for (const one of external) {\n"
                "    if (taken.has(one.name)) {\n"
                "      throw new Error(\n"
                '        `external MCP server "${one.name}" collides with a server this launch already has; ` +\n'
                "          `refusing to build a child whose tools could come from either`,\n"
                "      )\n"
                "    }\n"
                "    taken.add(one.name)\n"
                "  }\n",
                "",
            ),
            (
                ADAPTER,
                "  return {\n    ...servers,\n    [ownServer]: createSdkMcpServer({",
                "  return {\n    [ownServer]: createSdkMcpServer({",
            ),
        ],
    ),
    (
        "M12 · ⛔ the provider-side deny vocabulary is empty · the rail's race backstop is gone, so a "
        "server that changes its roster between this app's handshake and Claude's can present one of "
        "OUR names to the model — the exact gap `HO-042` §2 accepted the refusal rail on the "
        "strength of this set closing",
        [
            (
                ADAPTER,
                "  if (reach === undefined) return []\n"
                "  return reach.servers.flatMap((server) =>\n"
                "    reach.reservedToolNames.map((leaf) => qualifyWith(CLAUDE_TOOL_NAMING, server.name, leaf)),\n"
                "  )",
                "  return reach === undefined ? [] : []",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 removed on purpose the first of
        # the two things this row's derivation folded together. Its anchor is left stale, so the
        # census records it retired.
        "M13 · 🔴 two conditional spreads instead of one derivation · the later `disallowedTools` "
        "silently deletes the earlier, so a delegating tier holding a registry grant loses one of the "
        "two blocks — and neither half has a test that could see the other's absence",
        [
            (
                CLAUDE,
                "    const deniedToolNames = [\n"
                "      ...(disableNativeMultiAgentDelegation === true ? NATIVE_MULTI_AGENT_DELEGATION_TOOLS : []),\n"
                "      ...forbiddenExternalSpellings(externalMcp),\n"
                "    ]\n",
                "    const deniedToolNames = [...forbiddenExternalSpellings(externalMcp)]\n",
            )
        ],
    ),
    # ── the store, the migration, and the sheet ──────────────────────────────────────────────────
    (
        "M14 · ⛔ a save only ADDS grants · the clear is gone, so unticking a box writes nothing and "
        "a person who took a server away from an identity is told it saved while the launch goes on "
        "resolving it",
        [
            (
                STORE,
                "        externalMcpSql().clearGrantsOf.run(rowId)\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** 5e931be8 says 'The database
        # is ONE migration, 0000_the_tree, on a fresh file only', and _journal.json now holds a
        # single entry (idx 0, when 1790676652301). There is no 0031 or 0032 to order any more, and
        # the commit deleted the "0032's journal stamp is ABOVE 0031's" test from
        # one-local-server-one-identity.test.ts. Only the generic monotonic check in
        # a-stamp-that-skips.test.ts is left, and no upgrade path exists for it to guard. Its anchor
        # is left stale, so the census records it retired.
        "M15 · 🔴 `0032`'s journal stamp goes back to the WALL CLOCK drizzle wrote · it lands 52.17 "
        "hours below `0031`'s hand-set stamp, so an upgrading database skips both tables SILENTLY "
        "and every read throws `no such table` — while a fresh install passes",
        [(JOURNAL, '"when": 1789928391316', '"when": 1789654195322')],
    ),
    (
        "M16 · ⚠️ the replacement invariant is deleted from the docblock · `strictMcpConfig` still "
        "reads `true` and the next reader meets a flag that now admits two sources with nothing "
        "saying the rule was not abandoned — HO-040 §4.4 approved the widening on the strength of "
        "this paragraph existing",
        [
            (
                ADAPTER,
                " * > `strictMcpConfig` remains true. It does not mean *\"no MCP\"*; it means this child may load MCP\n",
                " * > This flag is pinned.\n",
            )
        ],
    ),
    (
        "M17 · 🔴 the sheet offers the grant on a provider that declares it `unwired` · a person "
        "ticks a box that does nothing, which is exactly the offer `HO-042` §3 refused — *\"the sheet "
        "says so in the same shape as everything else rather than offering a grant that does nothing\"*",
        [
            (
                SHEET,
                "const externalMcpIsHeldBack = computed(() => externalMcpStatus.value?.state !== 'available')",
                "const externalMcpIsHeldBack = computed(() => false)",
            )
        ],
    ),
    (
        "M18 · ⛔ Save sends the row's ORIGINAL grants rather than the edited ones · every tick and "
        "untick on this block is silently discarded, and the sheet closes reporting success",
        [
            (
                SHEET,
                "  saveRefusal.value = await store.save(props.profileSlug, grant(), grantedServers.value)",
                "  saveRefusal.value = await store.save(\n"
                "    props.profileSlug,\n"
                "    grant(),\n"
                "    identity.value?.externalMcpServerIds ?? [],\n"
                "  )",
            )
        ],
    ),
]
