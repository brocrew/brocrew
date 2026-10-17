"""419 · creating an agent, and the provider it runs on — each row is THE DEFECT, put back (131).

🔴 **HO-023 §3 held the front door until a person could still bring an identity into existence.**
`417` deleted `+ New profile…` from the launcher and that gesture was the ONLY way an identity had
ever come into being — *"a launch is what CREATES a profile"* — while `spawn_agent`'s own schema says
the rest: *"It must already exist"*. ⛔ **An app with one identity had no way to get a second.**

⚠️ **HO-023 §2.4 arrived at the same verb from the other end.** A person asked BroBot for another
agent; BroBot's only seeded grant is `project-manager`, so *"create another agent"* had exactly one
legal answer — the identity already running — and the product reached for the illegitimate one and
**ended a live conversation.** ⛔ **The rail was not wrong. This capability was missing.**

## ⛔ The shape of the fix, and therefore the shape of this table

- **§1 · the two doors.** HO-020 §4 licences both and neither is derived from the other: a person is
  ungated (HO-005, *"the human is unrestricted"*), an agent meets three rails and reads a refusal.
- **§2 · the trap.** `416` measured four `provider-homes` call sites that still derive their first
  segment from `DEFAULT_PROJECT_ID`, harmless only because `0018` backfilled every recorded segment
  to `default`. ⛔ A creation that minted a locator would make those four this dispatch's problem, so
  creation mints NONE — and `M6`/`M7` are that decision reversed.
- **§3 · the capability**, its own, and deliberately not `canSpawn` being non-empty.
- **§4 · the provider**, a default for the NEXT conversation and never a change to a live one.
- **§5 · the migration**, whose `when` drizzle stamps from the wall clock — 41 hours BEHIND this
  repo's hand-set journal, which is a silent skip on upgrade and a missing column on somebody else's
  machine.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M20` | ⚑ **`run_suite`** — `apps/desktop/test/creating-an-agent.test.ts` |

⚠️ **Every row was applied ALONE and watched go red against the file named here** —
`verify-each-mutation-row-without-running-the-table`. ⛔ **No table was run.**

## ⛔ What this table deliberately does NOT contain

⛔ **No row on `CREATION_REACH`'s missing third word.** `same-project` would be a choice every call
site read exactly as `any` reads — HO-010 ruling 6 is global-only identity — so a row adding it could
change no answer this app can produce and would report as a survivor.

⛔ **No row flipping `canCreateAgents`'s fold from `narrowest` to `ruled`.** Both are `'none'` on this
field, so the replacement is still TRUE and the row would measure nothing
(`a-true-mutation-measures-nothing`). ⚑ The rule itself is carried by `341` `M35`, on `canMessage`,
where the two values differ — and this dispatch re-anchored that row rather than duplicating it.

⛔ **No row on the ORDER of the switch and the grant beyond `M13`.** One `if` above another, and a
row per permutation would be three rows pricing one decision.

⛔ **No row on `AGENT_DISPLAY_NAME_CHARS`.** ⚠️ **The REASON was corrected by `423` and the
conclusion was not.** It read *"nothing in this app renders an identity's display name yet"*, which
stopped being true the moment `NewAgent.vue` grew a `:maxlength="AGENT_DISPLAY_NAME_CHARS"` box —
but a bound moved here still changes no answer a test can see, because the control and the schema
BOTH read the constant and move together (`a-bound-written-as-the-constant-cannot-pin-it`).

## ⚠️ Six rows in OTHER tables were re-anchored by this dispatch, and every one was re-run

⚑ **`341` `M35`, `355` `M9`/`M13`, `376` `M10`/`M11`, `377` `M22`, `383` `M5`, `409` `M1`/`M2`/`M3`.**
The extraction of `writeIdentityRow` and the two new columns moved the lines they pin. ⛔ **A
corrected anchor otherwise keeps a verdict it never earned**, which is free to do and impossible to
notice afterwards, so each was applied alone and watched go red again.

🔴 **`409` `M3` is the one whose DEFECT changed shape, and it is recorded rather than smoothed over.**
Merging the two call sites into `writeIdentityRow` left *the target is written with the SPAWNER's
seed* with no one-line spelling; the nearest honest expression is one level down and now hits every
minted row. The sentence its killer suite checks is unchanged.
"""

STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
WIRE = "apps/desktop/src/shared/runtime-ipc.ts"
SCHEMA = "apps/desktop/src/shared/capabilities.ts"
RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"
MIGRATION = "apps/desktop/src/main/db/migrations/0026_small_nico_minoru.sql"
JOURNAL = "apps/desktop/src/main/db/migrations/meta/_journal.json"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the two doors ────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, verbatim · the creation door writes nothing, so an app that has run "
        "`417` has one identity and no way to get a second — and BroBot asked for another agent "
        "goes on having exactly one legal answer, which is the identity already running",
        [(STORE, "      if (spawnSql().identityBySlug.get(slug) !== undefined) return null",
          "      return null")],
    ),
    (
        "M2 · ⛔ a taken name is ADOPTED instead of refused · a caller that names an identity a "
        "person already configured is handed it, with whatever grants that person gave it — "
        "creation becoming a way to acquire an agent you did not make",
        [(STORE, "      if (spawnSql().identityBySlug.get(slug) !== undefined) return null",
          "      if (false) return null")],
    ),
    (
        "M3 · ⚠️ the name is written UNFOLDED · `Worker` and `worker` become two identities over one "
        "home on a case-insensitive volume and two on a case-sensitive one — 238's finding, at the "
        "one door that can now create the second spelling",
        [(STORE, "      const slug = foldProfileName(said.slug)", "      const slug = said.slug")],
    ),
    (
        "M4 · ⛔ the person's door stops requiring a person · a channel that declares nobody can "
        "mint the thing every capability is a fact ABOUT, which is 349's gate deleted at the one "
        "verb that brings its subject into existence",
        [(IPC, "      requireAPerson(sink, command.kind)\n      return host.createAgent({",
          "      return host.createAgent({")],
    ),
    (
        "M5 · ⚠️ the person's door answers NULL instead of naming what went wrong · a taken name "
        "reaches a window as *nothing happened*, and the person is left looking for an agent they "
        "were never told exists",
        [(HOST, "    if (created === null) throw new Error(nameIsTaken(said.slug))",
          "    if (created === null) return null as unknown as AgentIdentity")],
    ),
    # ── §2 · the trap — a creation must not mint a home locator ────────────────────────────────
    (
        "M6 · 🔴 the brief's own trap, built · the creation mints an `agent_identity_home` row, so "
        "`416`'s four uncorrected `provider-homes` call sites stop being harmless and this dispatch "
        "becomes five — ⛔ the first symptom in production is a person signing in and the credential "
        "landing somewhere the session will not read",
        [(STORE,
          "      return identityFrom(spawnSql().identityBySlug.get(slug) as IdentityRow)",
          "      spawnSql().ensureHomeRow.run(\n"
          "        agentIdentityHomeRowId(slug, said.provider ?? 'codex'),\n"
          "        agentIdentityRowId(slug),\n"
          "        said.provider ?? 'codex',\n"
          "        slug,\n"
          "        at,\n"
          "      )\n"
          "      return identityFrom(spawnSql().identityBySlug.get(slug) as IdentityRow)")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a commit 2, a5d66e92):** The commit a5d66e92 says
        # "Every provider home lives under the one folder HOME_FOLDER ('default'): the home rows ...
        # go", and creating-an-agent.test.ts re-aimed its case to "since D-016 a home is derived,
        # not recorded" (the launch records no address). The recorded-address code this row planted
        # on is gone. Its anchor is left stale, so the census records it retired.
        "M7 · ⛔ the LAUNCH stops writing `default` · the segment becomes the identity's own name, "
        "so every home laid down after this lands under a directory none of `416`'s four readers "
        "look in — the same failure as `M6`, arriving through the door that was always allowed to "
        "write an address",
        [(STORE,
          "    spawnSql().ensureHomeRow.run(\n"
          "      agentIdentityHomeRowId(record.profileId, record.provider),\n"
          "      identityId,\n"
          "      record.provider,\n"
          "      DEFAULT_PROJECT_ID,\n",
          "    spawnSql().ensureHomeRow.run(\n"
          "      agentIdentityHomeRowId(record.profileId, record.provider),\n"
          "      identityId,\n"
          "      record.provider,\n"
          "      record.profileId,\n")],
    ),
    # ── §3 · the capability ───────────────────────────────────────────────────────────────────
    (
        "M8 · 🔴 the grant is not asked at all · every agent in the app may mint identities, which "
        "is HO-020 §4's *\"a typo there is indistinguishable from an intention\"* with nothing in "
        "front of it — and the cost is a durable empty identity per typo",
        # ⚑ **RE-ANCHORED at `598`, not retired**: `HO-084` §1 made this door return the
        # CALLER on its admitted arm, so the guard spells `caller === null` beside the one
        # it always had. ⛔ Same line, same defect.
        [(HOST, "    if (allowed === null || caller === null || allowed.canCreateAgents === 'none') {",
          "    if (false) {")],
    ),
    (
        "M9 · ⛔ the grant is DERIVED from `canSpawn` being non-empty · one field answering two "
        "questions, so the next widening of either silently widens the other — the cheap-looking "
        "option §3 of the brief names and refuses",
        # ⚑ **RE-ANCHORED at `598`, not retired**: `HO-084` §1 made this door return the
        # CALLER on its admitted arm, so the guard spells `caller === null` beside the one
        # it always had. ⛔ Same line, same defect.
        [(HOST, "    if (allowed === null || caller === null || allowed.canCreateAgents === 'none') {",
          "    if (allowed === null || caller === null || allowed.canSpawn.length === 0) {")],
    ),
    (
        "M10 · ⚠️ an unresolvable caller is admitted · a session this host cannot find holds no "
        "capabilities at all, and *we cannot tell who is asking* gets the wide answer instead of "
        "the narrow one",
        # ⚑ **RE-ANCHORED at `598`, not retired**: `HO-084` §1 made this door return the
        # CALLER on its admitted arm, so the guard spells `caller === null` beside the one
        # it always had. ⛔ Same line, same defect.
        [(HOST, "    if (allowed === null || caller === null || allowed.canCreateAgents === 'none') {",
          "    if (allowed !== null && caller !== null && allowed.canCreateAgents === 'none') {")],
    ),
    (
        "M11 · ⛔ nothing is seeded · BroBot ships unable to create the agent a person asks it for, "
        "which is HO-023 §2.4 restored: the product has no legitimate way to satisfy the request "
        "and reaches for the illegitimate one",
        # ⚑ Landing D-014 · re-anchored in place, not retired (landing review) — HO-023 §2.4 (BroBot
        # ships able to create the agent a person asks for) moved from the seed to the ruled
        # default, so the row now plants the default. Re-verified RED alone.
        [
            (SCHEMA, "    ruled: 'any',\n    narrowest: 'none',\n    vocabulary: [...CREATION_REACH],\n", "    ruled: 'none',\n    narrowest: 'none',\n    vocabulary: [...CREATION_REACH],\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row's defect, "the ruled default
        # becomes `any`" for `canCreateAgents`, is now D-014's decision: capabilities.ts has `ruled:
        # 'any'` with the comment "D-014 · `any` — every agent may create an agent". Card D-014:
        # "every agent may create a profile, start and message agents". Its anchor is left stale, so
        # the census records it retired.
        "M12 · 🔴 the ruled default becomes `any` · every identity that has chosen NOTHING may mint "
        "rows, so the seed stops being a decision and the grant stops being a grant — ⚠️ and a "
        "person who narrows one identity has changed nothing about the rest",
        # ⚑ **Re-anchored by `441`, which added a SECOND `CreationReach` field.**
        # `canCreateProjects` repeats these three lines verbatim, so the old anchor matched twice and
        # the row went dark. ⛔ **The DEFECT is byte-for-byte what it was** — `canCreateAgents`' ruled
        # default becoming `any` — and what moved is only the trailing context needed to say which of
        # the two entries it is.
        # ⚠️ **Re-anchored a SECOND time when `441` rebased onto `440`**, which inserted
        # `takesWorkFrom` between the two `CreationReach` entries. The trailing context is now the
        # entry that actually follows `canCreateAgents`; the defect did not move at all.
        # ⚠️ **And a THIRD time at `470`**, which gave every entry a required `whenItTakesEffect`,
        # so the property this row's trailing context ended on is no longer the last one in the
        # entry. ⛔ Still byte-for-byte the same defect, on the same line.
        [(SCHEMA,
          "    ruled: 'none',\n    narrowest: 'none',\n    vocabulary: [...CREATION_REACH],\n"
          "    whenItTakesEffect: null,\n  },\n  {\n    key: 'takesWorkFrom',",
          "    ruled: 'any',\n    narrowest: 'none',\n    vocabulary: [...CREATION_REACH],\n"
          "    whenItTakesEffect: null,\n  },\n  {\n    key: 'takesWorkFrom',")],
    ),
    (
        "M13 · ⚠️ the kill switch is not asked · an app a person has told to stop goes on minting "
        "identities nothing can start, which is the one state where this verb can ONLY produce the "
        "durable empty row criterion 12 exists to prevent",
        # ⚑ **486 corrected this anchor and not this rule.** The switch moved into
        # `RuntimeHost.mayCreateAgents`, the one function that owns it, so a tool can ask it before
        # it reads an argument — and the line it is asked on is this one.
        # ⚑ **RE-ANCHORED at `598`, not retired**: this door answers a discriminated union now,
        # so the refusal carries `ok: false` (`HO-084` §1). ⛔ Same line, same defect.
        [(HOST, "    if (!this.deps.store.spawnPolicy().spawningEnabled) {\n"
                "      return { ok: false, rail: 'spawning-disabled', detail: {} }\n"
                "    }",
          "    void this.deps.store.spawnPolicy()")],
    ),
    (
        "M14 · ⛔ the collision is asked BEFORE the grant · an unentitled caller learns which "
        "identities exist from the shape of the refusal it gets back — 341's "
        "entitlement-before-existence ruling, inverted",
        # ⚑ **486 corrected this anchor and not this rule** (HO-031 §2.5). ⛔ The grant and the
        # switch moved into `mayCreateAgents` so a TOOL can ask them before it reads an argument;
        # what is left here is the wall and then the name, in that order, and this row still swaps
        # exactly those two. ⚠️ `486` M10 mutates the same two statements for its own reason — the
        # reorder must not become an oracle — and the rows are kept apart rather than folded,
        # because one is about the door's ordering and the other about what moving it could cost.
        # ⚑ **RE-ANCHORED at `598`, not retired**: the grant door answers a union now and the
        # creation reads the creator off it (`HO-084` §1). ⛔ **The row still swaps exactly those
        # two statements**, and the mutated creation names the person's origin because there is no
        # grant answer to read from above it any more — which is the defect rather than a detail:
        # the NAME is asked before anybody has said whether this caller may create at all.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # holds: the grant and kill switch must be asked before the name is written (entitlement
        # before existence). `createAgentFor` still runs `mayCreateAgents` then
        # `createAgentIdentity`; the only drift is that `mayCreateAgents(me)` lost its `by`
        # parameter. The plant swaps the same two statements, creating the row as a person before
        # the grant is asked. Killed by `creating-an-agent.test.ts`.
        # ⚑ Landing D-016b part 2 (5e931be8) · killer corrected — The rule IS pinned.
        # the-doors-our-own-verbs-do-not-need.test.ts ('and the HOST door folds them too') calls
        # host.createAgentFor directly with canCreateAgents 'none' and asserts
        # store.agentIdentities() does not contain the name. creating-an-agent.test.ts only goes
        # through the tool, so it never saw the order and the listed killers cannot fail. The plant
        # creates the identity first and only then asks mayCreateAgents, which leaves the refused
        # name behind. The plant is right as it stands, so only the killer changes. Killed by
        # `the-doors-our-own-verbs-do-not-need.test.ts`.
        [
            # ⚑ **an agent keeps its provider · re-anchored in place, not retired** — the creation now keeps a provider, read between the grant and the name; the plant still writes the name before the grant is asked.
            (HOST, "    const may = this.mayCreateAgents(me)\n    if (!may.ok) return may\n    // 3 · the name, last — and its provider kept from the start: the one it names, else its\n    // default's, else the creator's.\n    const provider = said.provider ?? itsDefault?.provider ?? this.theProviderOfConversation(me)\n    const created = this.deps.store.createAgentIdentity({ ...said, provider }, may.creator)\n", "    const provider = said.provider ?? itsDefault?.provider ?? this.theProviderOfConversation(me)\n    const created = this.deps.store.createAgentIdentity({ ...said, provider }, { by: 'a-person' })\n    const may = this.mayCreateAgents(me)\n    if (!may.ok) return may\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject, the `role` argument on
        # `create_agent` and its AGENT_ROLES validation, was removed on purpose:
        # `CREATE_ROLE_ARGUMENT`, `AGENT_ROLE_INPUT` and the check are gone from agent-tools.ts.
        # Card: "no roles". Commit 010f9426: "roles … are gone. Its anchor is left stale, so the
        # census records it retired.
        "M15 · ⚠️ an unknown role is FOLDED to null rather than refused · a model that asked for a "
        "role and got a successful creation has been told its argument was taken — `371`'s "
        "disclosure defect, one door over",
        [(TOOLS,
          "          if (role !== undefined && !(AGENT_ROLES as readonly unknown[]).includes(role)) {\n"
          "            problems.push(\n"
          "              `${CREATE_ROLE_ARGUMENT} must be one of ${AGENT_ROLES.join(', ')}, or left out`,\n"
          "            )\n"
          "          }\n",
          "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** This row guarded the key that
        # `create_agent`'s role argument was read from, and that argument no longer exists
        # (`CREATE_ROLE_ARGUMENT` was deleted in 010f9426). Card: "no roles". Commit: "roles … are
        # gone". Its anchor is left stale, so the census records it retired.
        "M16 · ⛔ the advertised name and the read name drift apart · the handler reads a key no "
        "model is ever told about, so every call omits the role and the column stays null while the "
        "tool goes on answering `ok`",
        [(TOOLS, "          const role = args[CREATE_ROLE_ARGUMENT]",
          "          const role = args['agent_role']")],
    ),
    # ── §4 · the provider ─────────────────────────────────────────────────────────────────────
    (
        "M17 · 🔴 the identity's provider is never read · a dogfooding constant goes back to being "
        "the permanent provider of every conversation in a chain — HO-023 §3's own sentence, put "
        "back: *a dogfooding constant must not become the permanent provider of every conversation "
        "a person can start*",
        # ⚑ ANCHOR CORRECTED IN PLACE BY 499 — the expression MOVED and did not change. It was
        # written inline in the admitted token; `wider-than-its-parent` compares on the child's
        # provider, so it is computed into a `const` above that rail and the token reads it back.
        # ⚠️ Table `419` has NO run artefact, so this inherits no verdict it did not earn.
        # ⚠️ **CORRECTED IN PLACE AGAIN BY 682** — a person's choice in force comes first now (`R31a`)
        # and the identity's provider is read once into `itsProvider`; this still drops that term.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # holds: an identity's own provider must be read when a give starts a conversation for it.
        # Provider resolution is now `inForce?.provider ?? itsProvider ?? giving.provider` in
        # `admitGive`, so the plant drops `itsProvider` (the identity's answer) and leaves the
        # giver's provider, as the old row did with the parent's. The asked-provider term is gone
        # because `give_work` takes no provider. Killed by `creating-an-agent.test.ts`.
        [
            # ⚑ **an agent keeps its provider · re-anchored in place, not retired** — the start's provider is the agent's own first (theProviderAStartRunsOn), then its default's, the named model's and the giver's.
            (RAILS, "  if (its.provider !== null) return its.provider\n", ""),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The row guards the caller's
        # own provider argument outranking the identity's. D-016 removed that argument:
        # creating-an-agent.test.ts §4 says "D-016 · `the CALLER's own argument still wins` is
        # deleted: `give_work` takes no provider — a conversation it starts runs on the identity's
        # provider, or the giver's". The current line already reads `inForce?.provider ??
        # itsProvider ?? giving.provider`, so the old plant (identity ahead of the argument) is what
        # the code does and cannot go red. Its anchor is left stale, so the census records it
        # retired.
        "M18 · ⛔ the identity's provider BEATS the caller's own argument · a model that named a "
        "provider and got a successful spawn has been told its argument was taken, which is `371`'s "
        "silently-overridden field one door over",
        # ⚑ ANCHOR CORRECTED IN PLACE BY 499 — same move, same unchanged defect.
        # ⚠️ **…and BY 682**, as M17: the identity's own provider put ahead of the caller's argument.
        [(RAILS, "  const provider = inForce?.provider ?? asked.provider ?? itsProvider ?? parent.provider",
          "  const provider = inForce?.provider ?? itsProvider ?? asked.provider ?? parent.provider")],
    ),
    (
        "M19 · ⚠️ a LAUNCH writes the provider it happened to run on · the column stops meaning *what "
        "this identity chose* and starts meaning *what it was first started with*, which is `370`'s "
        "infer-from-an-accident defect with a new column — and then it is indistinguishable from a "
        "person who chose it",
        # ⚑ **RE-ANCHORED at 433, not retired.** `433` gave the launch door a seeded provider to
        # resolve, so the argument stopped being a bare `null` and the literal wrapped. ⛔ **The
        # defect is unchanged and is now sharper**: the column would hold the provider THIS launch
        # happened to use rather than the identity's own answer, and the two differ — the seed is
        # `claude` and the fixture launches on `codex`, which is where the readings diverge.
        # ⚑ **RE-ANCHORED a second time at 538**, which put the display-name seed on the first
        # argument of the same call. ⛔ **The mutated argument is still `provider` and only
        # `provider`** — the other two lines are carried so the anchor stays the smallest span that
        # identifies this call site, and `an-anchor-on-a-lists-last-member-dies-when-anything-appends`
        # is why it is written out rather than matched loosely.
        # ⚑ **RE-ANCHORED a third time at `598`**, which gave this call a fourth argument —
        # `{ by: 'this-app' }`, who brought the row into being (`HO-084` §1) — so the literal
        # wrapped again. ⛔ **The mutated argument is still `provider` and only `provider`.**
        [(STORE,
          "        provider: seededProviderFor(profileSlug),\n"
          "      },\n"
          "      { by: 'this-app' },\n"
          "    )",
          "        provider: 'codex',\n"
          "      },\n"
          "      { by: 'this-app' },\n"
          "    )")],
    ),
    # ── §5 · the migration ────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The migration journal was
        # replaced: `meta/_journal.json` now has one entry, `0000_the_tree`, and the 0001..0026
        # migrations were deleted in 5e931be8. creating-an-agent.test.ts §6 records it: "D-016 · the
        # one migration — `0026`'s journal order and its seed on a database created at `0025` lost
        # their subject when every migration became `0000_the_tree.sql`; the schema stands". With
        # one entry there is no earlier `when` for a later one to fall below. Its anchor is left
        # stale, so the census records it retired.
        "M20 · 🔴 the journal entry is stamped where drizzle put it · `0026`'s `when` falls BELOW "
        "`0025`'s, so the migration is silently skipped on every upgrading machine — the schema "
        "never changes, nothing errors, and the first symptom is a missing column on somebody "
        "else's install",
        [(JOURNAL, '"when": 1789409991316', '"when": 1789176472007')],
    ),
]
