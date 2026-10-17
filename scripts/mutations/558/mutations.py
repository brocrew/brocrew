"""558 · Every identity he has — the read, the writes, and the rename.

⛔ **`HO-063` gap 1 asks for *every identity that exists, running or not*, and the list was never
what was missing.** `listIdentities` is `SELECT … FROM agent_identity ORDER BY slug` — `369` deleted
the project parameter and wrote down why — and a surface draws every row (the rail's Agents
section when `558` was written; `TeamWorkspace` since `570`, `EXT-008` §4.4). ⚑ **What
the list cannot say about a row is which projects it has worked in and whether anything has ever run
it**, and `created_at` cannot answer the second because both creation doors and the launch stamp it.

🔴 **And *a way to remove one nothing runs* turned out to be the same question read backwards.** The
facts that refuse a removal are exactly the facts a roster row displays, so there is ONE record and
one derivation over it — `whatHoldsIt` — read by the roster to explain a control and by
`RuntimeHost.removeAgent` to refuse a press.

## 🔴 A · the history, which is two statements over two tables on purpose

⛔ `M1` folds `conversations` out of the projects list, which is the invariant
`provider_session`'s own docblock CLAIMS — the two null-sets match — turned into code that would go
quiet the day it broke. `M2` reads the home row instead of the binding, which is the schema's own
trap: `agent_identity_home.project_segment` is a legacy path segment, `default` on every row that
exists, so a roster built on it would report every identity as working in one project. `M3` counts
DISTINCT sessions per binding rather than sessions, so a second life of one identity reads as one
conversation. `M4` drops the `IS NOT NULL` guard, so the swept-in conversations that belong to
nobody of ours are attributed to an identity id of `null`.

## ⛔ B · the fold, which is pure so that the door and the roster cannot disagree

⚑ `M5` keys the fold on the SLUG rather than the row id, which is the one spelling `agent_profile`
does not carry into `identity_id`. `M6` invents a roster entry for a history row no identity
carries, so the two lists stop being joinable. `M7` makes the reason name the identity instead of
the agent whose grant holds it, so the remedy `425` says a refusal carries points at the wrong
agent. `M8` lets an identity's own grant hold it, which would make an identity unremovable because
of a grant the removal takes with it.

⚠️ **No row folds the grant comparison, and that is stated rather than hidden.** Both sides are
already folded — `parseSlugList` maps `foldProfileName` over the stored list on the way out, and
`agent_identity_slug_folded_ck` is a database constraint on the other — so a third fold in
`identityUse` was provably equivalent to the comparison it wrapped. ⛔ A row on a line nothing can
make fail reports as a survivor and teaches nothing
(`a-line-no-mutation-can-kill-is-not-carrying-its-rule`), so the fold was DELETED and the
composition is asserted instead, by a grant saved with capitals.

## 🔴 C · what holds an identity, and every member of it

⛔ **Each is its own row, because each is a referent nothing else catches.** `M9` drops
`conversations`, `M10` drops `a-project`, `M11` drops `a-grant` and `M12` drops `this-app`. ⚠️ The
first two the database would still refuse — both foreign keys are `NO ACTION` — but as
*FOREIGN KEY constraint failed*, which names nothing a person can act on; the rest nothing
would catch at all. ⚑ `M13` returns the first reason instead of all of them, so a person told *it
is in a project* about an identity with forty conversations has been told the smaller half.

## 🔴 C2 · the referent that is not in the database, and the predicate that nearly missed one

⛔ **`M25` drops the launch-in-flight reason**, which is the one no foreign key can catch: `store.create`
runs from `onRegistered`, so between `createSession` and registration a freshly created identity has
written no row at all and every ledger-derived reason is false. `M26` narrows it to `starting` slots
— a phase test where the honest statement is *this host is running or starting a conversation as it*.
`M27` stops folding the launched slug, so `Worker` launching would stop holding `worker`.

⚠️ **And NOTHING here touches the second arm of *would this app mint it back*, which is stated
rather than hidden.** `thisAppSeedsThatName` asks about the slug ITSELF; `mintIdentity` writes a row
for every slug a seeded GRANT names. ⛔ **The two coincide today** — `SEEDED_GRANTS[default].canSpawn`
names `project-manager` and `SEEDED_ROLES` happens to name it too — **so no input can distinguish
them, and every row that tried came back a survivor** (`a-true-mutation-measures-nothing`; two were
written and both were withdrawn rather than left in). ⚑ **The arm stays, because the day the tables
diverge a removal without it succeeds on an identity the next launch brings back** — that is
`a-rail-can-be-ahead-of-its-tool-but-say-so`. 🔴 **And the coincidence is asserted BY NAME in the
suite**, so a divergence announces which arm is now carrying the answer instead of going quiet.

## ⚠️ D · the removal door

⛔ `M14` removes before asking what holds it, which is the whole rail. `M15` answers `ok` when the store
wrote nothing, which is criterion 12 in the direction nobody has written it in before: a row that
was already gone reads as one this press took away. ⚠️ **Its killer drives the host on a store
DOUBLE** — the branch is unreachable against a real store, because the roster read and the delete
derive the same `aid:` id from the same slug, and a guard only a doubled dependency can trip is a
guard that would otherwise be dark (`a-guard-that-only-a-live-run-can-trip-is-dark-by-default`). `M16` announces before the write rather
than after it, which is `534`'s own pairing — *a taken name writes nothing, so there is nothing to
announce*. `M17` announces nothing at all, so every surface that lists identities keeps drawing a
row the database no longer has.

## 🔴 E · the rename, and `HO-016` §2

⛔ `M18` makes the rename an `INSERT OR IGNORE`, so a slug with no row is named into existence —
criterion 12, and the refusal `setAgentProvider` and `setCapabilities` both answer with. `M19`
drops `blankToNull`, so a cleared box writes `''` and a third state arrives at every reader of the
column. `M20` writes the seeded name at the launch door instead of the caller's, which is `538`'s
first measurement reversed: an omission is the model ANSWERING, and a word derived from a slug
overrules an answer somebody gave. `M21` turns the app's `INSERT OR IGNORE` into an `INSERT OR
REPLACE`, which is `HO-016` §2 broken by one word — the seed lands on top of a rename at the next
launch.

## ⛔ F · the rails on both writes

⚑ `M22` and `M23` drop `requireAPerson` from the rename and the removal. ⚠️ Neither is what keeps
an AGENT off the door — that is the verb living on this wire and on no toolset — but both are what
keeps a channel with nobody behind it off it. `M24` lets the removal be answered during a quit,
which is the one write in this app that cannot be looked at afterwards to see whether it landed.

## ⚠️ What this table deliberately does NOT contain

⛔ **No row that adds a `runtime:changed` subject.** `534` built the vocabulary as a value with a
reader per member BY TYPE, so a third member is a compile error rather than a behaviour — and a
mutation that cannot run is not a measurement.

⛔ **No row on `AGENT_REMOVAL_MEANS`' words.** There is no surface drawing it yet (`559` has the
screen), so a row changing it would kill nothing and report as a survivor —
`a-line-no-mutation-can-kill-is-not-carrying-its-rule`. ⚑ **It is stated here rather than left to
be rediscovered**, and it is the one thing in this dispatch that is ahead of its reader.
## ⚠️ 584 · `M20` RETIRED, because its mutation is now the production code

⛔ **`M20` was *the creation door consults the seed*** — `538`'s first measurement reversed. 🔴
**`HO-078` §5 reversed it for real**: `create_agent` advertises no `display_name`, so an absence at
that door is no longer a model ANSWERING, and the app assigns. ⚑ A row whose mutation is the shipped
behaviour measures nothing (`a-true-mutation-measures-nothing`).

⚑ **`584 M4` is its successor, pointed the other way**: the defect is now the app's name going in
FRONT of a name a PERSON typed, which is standing rule 11 at the creation door.
"""

STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
ROSTER = "apps/desktop/src/shared/agent-roster.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"

PROJECTS_SQL = """        `SELECT b.identity_id AS identity, p.slug AS project
           FROM agent_profile b
           JOIN project p ON p.id = b.project_id
          WHERE b.identity_id IS NOT NULL
          ORDER BY b.identity_id, p.slug`,
"""

# ⚑ **an agent keeps its provider · re-anchored in place, not retired** — the history is grouped by provider too, with the started conversations beside the count.
CONVERSATIONS_SQL = "        `SELECT agent_identity_id AS identity, provider, count(*) AS conversations,\n                count(external_ref) AS started\n           FROM provider_session\n          WHERE agent_identity_id IS NOT NULL\n          GROUP BY agent_identity_id, provider`,\n"

REMOVE_ASKS = """    if (mine === undefined) return { ok: false, rail: 'no-such-agent' }
    const held = whatHoldsIt(mine)
    if (held.length > 0) return { ok: false, rail: 'it-is-still-held', held }
"""

MUTATIONS = [
    # ---- A · the history -----------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** D-016a removed the subject on purpose.
        # The commit says 'the project rooms, board, sheet and picker, project folders and their
        # rails ... are removed', and the store's identity history is now `IdentityHistory
        # {identityId, conversations}` with `conversationsPerIdentity` as its only statement, so
        # there is no projects list from which a conversation count could be wrongly derived. Its
        # anchor is left stale, so the census records it retired.
        "M1 · 🔴 **the conversation count is derived from the projects list** · the invariant "
        "`provider_session`'s docblock CLAIMS, written as code that goes quiet the day it breaks — "
        "`a-docblock-is-a-claim`",
        [
            (
                STORE,
                "        conversations: conversations.get(identityId) ?? 0,\n",
                "        conversations: (projects.get(identityId) ?? []).length,\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The statement that joined
        # `agent_profile` to `project` to say which projects an identity had worked in was replaced
        # by 'how many conversations have ever been recorded as each identity' in the same D-016
        # commit ('project folders and their rails ... are removed'). The row's defect was reading
        # the legacy `agent_identity_home.project_segment` column for that projects list, and the
        # list is gone. Its anchor is left stale, so the census records it retired.
        "M2 · ⛔ **the projects come from the identity's HOME row** · `agent_identity_home."
        "project_segment` is a legacy path segment — `default` on every row that exists — so every "
        "identity would report working in one project",
        [
            (
                STORE,
                PROJECTS_SQL,
                """        `SELECT h.identity_id AS identity, h.project_segment AS project
           FROM agent_identity_home h
          ORDER BY h.identity_id, h.project_segment`,
""",
            )
        ],
    ),
    (
        "M3 · ⛔ **conversations are counted per BINDING rather than per session** · a second life "
        "of one identity reads as one conversation, and `rotation` has been allocated against the "
        "identity since `369`",
        [
            (
                STORE,
                CONVERSATIONS_SQL,
                "        `SELECT agent_identity_id AS identity, provider, count(DISTINCT agent_profile_id) AS conversations,\n                count(external_ref) AS started\n           FROM provider_session\n          WHERE agent_identity_id IS NOT NULL\n          GROUP BY agent_identity_id, provider`,\n",
            )
        ],
    ),
    (
        "M4 · ⚠️ **the null guard is dropped** · a conversation swept out of the person's OWN "
        "`~/.claude` has no identity of ours, and this attributes every one of them to an identity "
        "id of `null`",
        [
            (
                STORE,
                CONVERSATIONS_SQL,
                "        `SELECT agent_identity_id AS identity, provider, count(*) AS conversations,\n                count(external_ref) AS started\n           FROM provider_session\n          GROUP BY agent_identity_id, provider`,\n",
            )
        ],
    ),
    # ---- B · the fold --------------------------------------------------------------------------
    (
        "M5 · ⛔ **the history is keyed on the SLUG instead of the row id** · `agent_profile."
        "identity_id` holds `aid:<folded slug>`, and nothing in the join carries the bare slug",
        [(ROSTER, "    const mine = byId.get(identity.id)\n", "    const mine = byId.get(identity.slug)\n")],
    ),
    (
        "M6 · 🔴 **a history row no identity carries becomes a roster entry** · the two lists stop "
        "being joinable one-to-one, so a surface can draw a control against another row's facts",
        [
            (
                ROSTER,
                "  const byId = new Map(history.map((one) => [one.identityId, one]))\n",
                "  const byId = new Map(history.map((one) => [one.identityId, one]))\n"
                "  if (history.length > identities.length) return []\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row attacked the `.map((other) =>
        # other.slug)` that named which agent's canSpawn grant holds an identity. D-014 deleted the
        # whole `grantsNamingIt` computation along with the `a-grant` reason (commit: "roles, the
        # seeded grants ... are gone"; card: "no can_spawn"). Its anchor is left stale, so the
        # census records it retired.
        "M7 · ⚠️ **the reason names the identity instead of the agent whose grant holds it** · a "
        "person reading *helper\u2019s own grant names it* has been told nothing they can act on, "
        "and the remedy `425` says a refusal carries is *edit THAT agent\u2019s grant*",
        [
            (
                ROSTER,
                "        .map((other) => other.slug)\n        .sort(),\n",
                "        .map(() => identity.slug)\n        .sort(),\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row's subject was the `other.slug
        # !== identity.slug` self-exclusion inside `grantsNamingIt`, a filter over
        # `capabilities.canSpawn`. D-014 removed canSpawn as a read grant ("can_spawn ... unread and
        # unwritten") and deleted the field and its filter from agent-roster.ts. Its anchor is left
        # stale, so the census records it retired.
        "M8 · ⛔ **an identity's own grant holds it** · it would be unremovable because of a grant "
        "the removal takes away with it, and the refusal would name the identity itself",
        [
            (
                ROSTER,
                "            other.slug !== identity.slug && other.capabilities.canSpawn.includes(identity.slug),\n",
                "            other.capabilities.canSpawn.includes(identity.slug),\n",
            )
        ],
    ),
    # ---- C · what holds an identity ------------------------------------------------------------
    (
        "M9 · 🔴 **`conversations` stops holding it** · the removal falls through to the store's "
        "`DELETE`, which raises `FOREIGN KEY constraint failed` — a refusal naming nothing a person "
        "can act on",
        [(ROSTER, "  if (use.conversations > 0) held.push('conversations')\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** D-016 ('Projects stop being something
        # a person or a model meets') removed `IdentityUse.projects` and the `a-project` holder;
        # `WHAT_HOLDS_AN_IDENTITY` is now ['conversations','this-app','a-launch'] and
        # agent-roster.ts has no `projects` at all. The line the row deletes no longer exists, and
        # the pair the label describes (conversations plus projects) is gone. Its anchor is left
        # stale, so the census records it retired.
        "M10 · 🔴 **`a-project` stops holding it** · same shape one table over, and the pair is why "
        "both are reported rather than one standing in for the other",
        [(ROSTER, "  if (use.projects.length > 0) held.push('a-project')\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 removed the subject on purpose.
        # The card says "no `can_spawn` / `not-in-can-spawn`", and the commit says "can_spawn ...
        # columns stay in the schema, unread and unwritten". Its anchor is left stale, so the census
        # records it retired.
        "M11 · ⛔ **a grant naming it stops holding it** · no foreign key catches this one, so the "
        "removal succeeds and that grant answers `unknown-profile` for ever — *a grant naming an "
        "identity that does not exist is not a capability; it is a sentence*",
        [(ROSTER, "  if (use.grantsNamingIt.length > 0) held.push('a-grant')\n", "")],
    ),
    (
        "M12 · 🔴 **a name this app ships stops holding it** · the press succeeds and the next "
        "launch mints the row back — HO-029 §3's shape, a surface reporting a settlement that did "
        "not hold",
        [(ROSTER, "  if (use.thisAppMintsIt) held.push('this-app')\n", "")],
    ),
    (
        "M13 · ⚠️ **only the first reason is carried** · a person told *it is in a project* about "
        "an identity with forty conversations has been told the smaller half",
        [(ROSTER, "  return held\n}\n", "  return held.slice(0, 1)\n}\n")],
    ),
    # ---- D · the removal door ------------------------------------------------------------------
    (
        "M14 · 🔴 **the door removes before asking what holds it** · the whole rail, and the two "
        "referents no foreign key catches go with it silently",
        [(HOST, REMOVE_ASKS, "    if (mine === undefined) return { ok: false, rail: 'no-such-agent' }\n")],
    ),
    (
        "M15 · ⛔ **a name with no row is answered `ok`** · criterion 12 in the direction nobody has "
        "written it in before: a name that was never there reads as one this press took away",
        [
            (
                HOST,
                "    if (!this.deps.store.removeAgentIdentity(folded)) return { ok: false, rail: 'no-such-agent' }\n",
                "    this.deps.store.removeAgentIdentity(folded)\n",
            )
        ],
    ),
    (
        "M16 · ⚠️ **the announcement moves ahead of the write** · `534`'s own pairing read "
        "backwards — a refused removal would tell every window to re-read a roster nothing moved",
        [
            (
                HOST,
                "    if (mine === undefined) return { ok: false, rail: 'no-such-agent' }\n"
                "    const held = whatHoldsIt(mine)\n",
                "    this.theWorldMoved('agents')\n"
                "    if (mine === undefined) return { ok: false, rail: 'no-such-agent' }\n"
                "    const held = whatHoldsIt(mine)\n",
            )
        ],
    ),
    (
        "M17 · ⛔ **the removal announces nothing** · every surface that lists identities keeps "
        "drawing a row the database no longer has, which is `534`'s defect at the other end",
        [
            (
                HOST,
                "    this.theWorldMoved('agents')\n    return { ok: true, slug: folded }\n",
                "    return { ok: true, slug: folded }\n",
            )
        ],
    ),
    # ---- E · the rename ------------------------------------------------------------------------
    (
        "M18 · ⛔ **the rename creates the row it cannot find** · criterion 12, and the refusal "
        "`setAgentProvider` and `setCapabilities` both answer with — *asking to configure something "
        "that does not exist may not bring it into being*",
        [
            (
                STORE,
                "      writeDisplayName: db.prepare(`UPDATE agent_identity SET display_name = ? WHERE id = ?`),\n",
                "      writeDisplayName: db.prepare(\n"
                "        `INSERT OR REPLACE INTO agent_identity (display_name, id, slug, created_at)\n"
                "         VALUES (?, ?, ?, 0)`,\n"
                "      ),\n",
            )
        ],
    ),
    (
        "M19 · ⚠️ **the blank fold is dropped** · a cleared box writes `''`, and a third state — "
        "neither *nobody has named this* nor a name — arrives at every reader of the column",
        [
            (
                STORE,
                "        spawnSql().writeDisplayName.run(blankToNull(displayName), agentIdentityRowId(profileSlug))\n",
                "        spawnSql().writeDisplayName.run(displayName, agentIdentityRowId(profileSlug))\n",
            )
        ],
    ),
    (
        "M20 · 🔴 **the creation door consults the seed** · `538`'s FIRST measurement reversed, and "
        "it is the one this dispatch left standing: an omission is the model ANSWERING, and a word "
        "derived from a slug overrules an answer somebody gave",
        [
            (
                STORE,
                "        displayName: blankToNull(said.displayName),\n",
                "        displayName: blankToNull(said.displayName) ?? seededDisplayNameFor(said.slug),\n",
            )
        ],
    ),
    (
        "M21 · 🔴 **the app's own writer becomes `INSERT OR REPLACE`** · `HO-016` §2 broken by one "
        "word — *the app may seed a default at creation; it never re-grants what a person removed* "
        "— and the next launch lands the seed on top of a rename",
        [
            (
                STORE,
                "        `INSERT OR IGNORE INTO agent_identity\n",
                "        `INSERT OR REPLACE INTO agent_identity\n",
            )
        ],
    ),
    # ---- F · the rails -------------------------------------------------------------------------
    (
        "M22 · ⛔ **the rename loses its person gate** · a channel with nobody behind it renames the "
        "thing every surface in this app draws an agent BY",
        [
            (
                IPC,
                "      requireAPerson(sink, command.kind)\n"
                "      return host.setAgentDisplayName(command.profileId, command.displayName)\n",
                "      return host.setAgentDisplayName(command.profileId, command.displayName)\n",
            )
        ],
    ),
    (
        "M23 · 🔴 **the removal loses its person gate** · the strongest member of that list — a "
        "caller that could remove an identity could remove the one holding the grant that refuses it",
        [
            (
                IPC,
                "      requireAPerson(sink, command.kind)\n      return host.removeAgent(command.profileId)\n",
                "      return host.removeAgent(command.profileId)\n",
            )
        ],
    ),
    (
        "M24 · ⚠️ **the removal is answered during a quit** · the one write in this app that cannot "
        "be looked at afterwards to see whether it landed: the window that asked is closing, and "
        "the row it would have re-read is gone",
        [(IPC, "  removeAgent: 'refused',\n", "  removeAgent: 'answered',\n")],
    ),
    (
        "M25 · 🔴 **a launch in flight stops holding it** · the one referent no foreign key can "
        "catch, because the rows do not exist yet — the press succeeds and `onRegistered` puts the "
        "row back, unbound from the conversation a person is watching start (HO-029 §3)",
        [(ROSTER, "  if (use.isLaunching) held.push('a-launch')\n", "")],
    ),
    (
        "M26 · ⛔ **only `starting` slots are counted as launches** · a phase test where the honest "
        "statement is *this host is running or starting a conversation as it*, and the redundancy "
        "with `conversations` is what makes it safe",
        # ⚠️ **RE-ANCHORED at 702, not retired.** 702 walks the slots once for WHICH identities launch and WHERE (`launchesByIdentity`), so the phase test lands on its `continue`. The DEFECT this row plants is unchanged.
        [
            (
                HOST,
                "      if (slot.profileId === null) continue\n",
                "      if (slot.profileId === null || slot.phase !== 'starting') continue\n",
            )
        ],
    ),
    (
        "M27 · ⚠️ **the launched slug is not folded** · a slot keeps whatever spelling its launcher "
        "typed and the roster's slugs are folded by a database constraint, so `Worker` launching "
        "would stop holding `worker` (238)",
        # ⚠️ **RE-ANCHORED at 702, not retired.** 702's `launchesByIdentity` folds the slot's spelling in one named line. The DEFECT this row plants is unchanged.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: a
        # launching slot's slug must be folded before it is compared with the roster's folded slugs.
        # The fold moved from a local `const slug` into `launchesByIdentity`'s
        # `launching.add(foldProfileName(slot.profileId))`, so the plant is that one line unfolded.
        [
            (HOST, '      launching.add(foldProfileName(slot.profileId))\n', '      launching.add(slot.profileId)\n'),
        ],
    ),
]
