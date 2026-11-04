"""598 · The grant covers what it created — each row is THE DEFECT, put back verbatim (131).

⛔ **The ruling is `HO-084` §1, and it is one sentence:** *an agent's spawn grant covers what it
created. Reaching further down is a WIDENING, and the default is narrow.*

## 🔴 What the defect actually was, because it decides what these rows have to kill

⚠️ **`HO-083` §1 measured it on the person's own machine, with the product running as itself.** BroBot's
`list_profiles` named two identities it could run as: `trip-planning-pm` (**Ada**), which it had
created, and `trip-destination-scout` (**Ali**), which **Ada** had created and BroBot had never
seen. ⛔ Its grant was `any-this-app-does-not-seed`, which is true of every agent in the product —
**including a subordinate's own staff** — while a standing instruction said *leave the agents under
a project manager to that project manager*. ⚑ **BroBot's own sentence:** *"Two mechanisms pointing
opposite ways, with nothing but compliance in between."*

🔴 **And the fact the ruling turns on did not exist.** `agent_identity` had no creator column and
the ledger has no identity-creation event, so *who created this* was not a fold away — it was
absent. ⛔ **So the repair has two halves and the rows are grouped by them:** the fact is WRITTEN at
construction (A), and the grant then READS it (C).

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M4` | ⚑ **`run_suite desktop`** — `the-grant-covers-what-it-created.test.ts` §1 |
| `M5`, `M6` | ⚑ **`run_suite desktop`** — §2, and `create-without-the-right-to-start.test.ts` §6 |
| `M7`–`M11` | ⚑ **`run_suite desktop`** — §3, §4, and `a-tier-that-can-staff-its-project.test.ts` §4 |
| `M12`, `M13` | ⚑ **`run_suite desktop`** — §5, and `who-exists-and-what-they-were-told.test.ts` §7 |
| `M14`, `M15` | ⚑ **`run_suite desktop`** — §7 |
| `M16`, `M17` | ⚑ **`run_suite desktop`** — §5, §6 |

⚑ **Every row was applied and run ONE AT A TIME** — apply, run the killer file, restore from bytes,
checksum — rather than by running the table.

## ⛔ What this table deliberately does NOT contain

⛔ **No row on `mintIdentity`'s seeded-grant TARGET loop**, which passes `{ by: 'this-app' }` for a
slug a grant names rather than the creator of the identity that names it. ⚠️ `HO-078` §1 took
`canSpawn` off the one seeded grant, so **nothing reaches that loop on any input the shipped app can
hand it** — `seed-one-name-the-rest.test.ts` §1 asserts the emptiness by name. ⚑ A row there could
not change an answer, and `a-line-no-mutation-can-kill-is-not-carrying-its-rule` says to name that
rather than paper over it.

⛔ **No row that removes `created_by` from the `INSERT` or from `IDENTITY_COLUMNS`.** Either one
fails to compile — the column is in the statement's `?` list and in the row type — and a mutation
the TYPE CHECKER kills measures the type checker.

⛔ **No row on the CYCLE guard that makes the walk hang.** ⚠️ A row whose only signal is a 60-second
timeout costs a minute of every table run and reports *not performed* rather than *killed* (standing
rule 13's shape at a suite). ⚑ `M16` takes the same subject from the answering side instead: it
ADMITS on the second visit, which §7 kills in milliseconds.

⛔ **No row that removes the EXCLUSION in front of the `switch`.** ⚠️ `HO-084` §1 HOISTED
`thisAppSeedsThatName` out of the wide word's arm so it is asked once for four, and **`573 M5`
followed it there** — that row's subject has always been the exclusion, and its own note records
the move. ⚑ A second spelling of *the exclusion is gone* would be two rows for one rule.

⛔ **No row on the wide word's own sentence or behaviour.** `any-this-app-does-not-seed` still
exists, still means what it always did, and is still a word a person may choose — a row that broke
it would be measuring `511`'s rule rather than this one.
"""

from __future__ import annotations

RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
IDENTITY = "apps/desktop/src/main/db/identity.ts"
IPC = "apps/desktop/src/shared/runtime-ipc.ts"
CAPS = "apps/desktop/src/shared/capabilities.ts"
MIGRATION = "apps/desktop/src/main/db/migrations/0041_the_grant_covers_what_it_created.sql"

# ⚠️ **The agent's creation door, anchored on the call that spends the grant door's answer.**
# ⚑ **an agent keeps its provider · re-anchored in place, not retired** — the creation passes the said fields with the provider it keeps; the creator argument is unchanged.
THE_AGENTS_DOOR = "    const created = this.deps.store.createAgentIdentity({ ...said, provider }, may.creator)"

# ⚠️ **The person's door**, which is the one place in the host that says `a-person`.
THE_PERSONS_DOOR = "    const created = this.deps.store.createAgentIdentity(said, { by: 'a-person' })"

# ⚠️ **The proposal door's creator**, the last line of a call that spans two arguments.
THE_PROPOSERS_DOOR = "        { by: 'an-agent', agent: foldProfileName(proposal.proposedBy) },"

# ⚠️ **What the grant door hands back on the admitted arm** — resolved ONCE, so the grant that was
# read and the provenance that is written cannot come from two reads.
THE_GRANT_DOORS_ANSWER = (
    "    return { ok: true, creator: { by: 'an-agent', agent: foldProfileName(caller.profileId) } }"
)

# ⚠️ **The launch's own creator**, the fourth argument of `profileRowFor`'s mint.
THE_LAUNCHES_CREATOR = (
    "        provider: seededProviderFor(profileSlug),\n"
    "      },\n"
    "      { by: 'this-app' },\n"
    "    )"
)

# ⚠️ **The whole `created-by-me` arm**, comment included, so the row replaces a decision rather than
# an expression somebody could read as an accident.
THE_NARROW_ARM = (
    "      const creator = facts.whoCreated(foldedProfileId)\n"
    "      return creator !== null && creator.by === 'an-agent' && creator.agent === facts.holder"
)

THE_CHAIN_ARM = "      return inTheLineOf(facts.holder, foldedProfileId, facts)"

THE_WALK = (
    "  while (at !== null && at.by === 'an-agent') {\n"
    "    if (at.agent === holder) return true\n"
    "    if (seen.has(at.agent)) return false"
)

THE_HOLDER_AT_RAIL_SEVEN = (
    "        { holder: foldProfileName(parent.profileId), whoCreated: facts.whoCreated },"
)

THE_LISTINGS_LOOKUP = (
    "                holder: foldProfileName(caller.profileId),\n"
    "                whoCreated: (folded) => held.get(folded)?.createdBy ?? null,"
)

THE_ENCODING = (
    "  if (raw === 'a-person' || raw === 'this-app') return { by: raw }\n"
    "  const prefix = `aid${SEP}`\n"
    "  if (!raw.startsWith(prefix)) return null\n"
    "  const agent = raw.slice(prefix.length)\n"
    "  return agent === '' ? null : { by: 'an-agent', agent }"
)

THE_SEEDED_WORD = "      canStaff: 'created-by-me',\n      canCreateAgents: 'any',\n      canCreateProjects: 'any',"

THE_TEMPLATE_WORD = "      canStaff: 'created-by-me',\n      canCreateAgents: 'any',\n    },"

THE_NARROW_SENTENCE = (
    "  'created-by-me':\n"
    "    'any agent this identity created itself, including ones created after this was granted — ' +\n"
    "    'never one somebody else created, and never one this app ships a name for',"
)

THE_HELP = (
    "    help: 'Whether this identity may start a conversation as an agent that is not in the list "
    "above, and how far that reaches — each choice says what it admits. None of them ever includes "
    "the agents this app sets up itself, so this can never be used to run as one of those.',"
)

THE_MIGRATION_TAIL = "ALTER TABLE `agent_identity` ADD `created_by` text;"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the fact this app had never written down ──────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, from the side that made it invisible: the AGENT's creation door "
        "records `this-app` rather than the agent that called it. ⛔ Every identity BroBot or a "
        "project manager mints then belongs to nobody, so `created-by-me` admits none of them — "
        "the tier that may create can no longer start what it created, which is `HO-068` §1.2's "
        "own defect arriving through the column instead of through the grant",
        [(HOST, THE_AGENTS_DOOR, "    const created = this.deps.store.createAgentIdentity({ ...said, provider }, { by: 'this-app' })")],
    ),
    (
        "M2 · 🔴 the PERSON's door records `this-app`, which is the collapse `HO-084` §1 needs "
        "kept apart. ⛔ A row the person typed and a row a launch minted become one fact, and the "
        "roster `HO-052` §3 is queued for could never tell him which identities he made",
        [(HOST, THE_PERSONS_DOOR, "    const created = this.deps.store.createAgentIdentity(said, { by: 'this-app' })")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The anchor is the proposal door's
        # creator (`foldProfileName(proposal.proposedBy)`). That door is gone with 'Proposals go end
        # to end', and `deliverDecision` and `proposal.proposedBy` no longer exist in
        # runtime-host.ts. The two remaining creation doors (the agent's door via `may.creator` and
        # the person's `{ by: 'a-person' }`) are still held by 598's other rows. Its anchor is left
        # stale, so the census records it retired.
        "M3 · 🔴 an APPROVED proposal is recorded as the PERSON's — the alternative this dispatch "
        "considered and refused. ⛔ A project manager that proposed a worker, and had a person say "
        "yes, is then unable to staff it: `HO-052` §1's *a project manager that cannot staff its "
        "project is not a project manager*, through a different door",
        [(HOST, THE_PROPOSERS_DOOR, "        { by: 'a-person' },")],
    ),
    (
        "M4 · 🔴 a LAUNCH claims a person made the row. ⛔ `profileRowFor` mints on a launch and on "
        "an adoption, where there is nobody to be — so the app writes a claim about an act nobody "
        "performed, and `370`'s infer-from-an-accident defect lands on a column a RAIL reads",
        [(STORE, THE_LAUNCHES_CREATOR, "        provider: seededProviderFor(profileSlug),\n      },\n      { by: 'a-person' },\n    )")],
    ),
    # ── B · what NULL means ───────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The row plants an UPDATE
        # backfill in migration 0041_the_grant_covers_what_it_created.sql, which is deleted:
        # 5e931be8 made 'The database is ONE migration, 0000_the_tree, on a fresh file only', and
        # created_by is now declared directly in 0000_the_tree.sql with no older rows. A backfill
        # placed there would run against an empty table and no test could see it, so there is no
        # defect left to plant. Its anchor is left stale, so the census records it retired.
        "M5 · 🔴 `0041` carries the backfill — the statement §3.1 priced and refused. ⛔ Every row "
        "older than the column is attributed to this app's own seed, and `HO-083` §1 photographed "
        "two rows on the person's machine it would lie about: `trip-planning-pm`, created by BroBot, "
        "and `trip-destination-scout`, created by Ada. ⚠️ **A claim written into a ledger is worse "
        "than a null when it is wrong**",
        [(
            MIGRATION,
            THE_MIGRATION_TAIL,
            "ALTER TABLE `agent_identity` ADD `created_by` text;--> statement-breakpoint\n"
            "UPDATE `agent_identity` SET `created_by` = 'this-app' WHERE `created_by` IS NULL;",
        )],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The `created-by-me` staffing reach,
        # `staffingAdmits` and `StaffingFacts.whoCreated` were deleted from spawn-rails.ts (commit:
        # "the staffing carve-out [is] gone … Any agent may start a conversation as any existing
        # profile"). Its anchor is left stale, so the census records it retired.
        "M6 · 🔴 the narrow word ADMITS an unrecorded creator — §3's second reading, taken. ⛔ *The "
        "old wide behaviour survives for exactly the rows that have it today*, so the ruling "
        "changes nothing on a real machine and `an-unenumerated-state-counts-as-success` is the "
        "shape: an absence answering a security question by falling through",
        [(
            RAILS,
            THE_NARROW_ARM,
            "      const creator = facts.whoCreated(foldedProfileId)\n"
            "      return creator === null || (creator.by === 'an-agent' && creator.agent === facts.holder)",
        )],
    ),
    # ── C · the rail ──────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** BroBot's seeded `canStaff` is gone
        # along with `SEEDED_GRANTS` and the `canStaff` field (commit: "the seeded grants … and the
        # staffing carve-out are gone"; "can_staff … unread and unwritten"). Its anchor is left
        # stale, so the census records it retired.
        "M7 · 🔴 THE DEFECT, verbatim: BroBot is seeded `any-this-app-does-not-seed` again. ⛔ "
        "This is `HO-083` §1's own measurement put back — BroBot's grant sweeps up "
        "`trip-destination-scout`, an agent **Ada** created — and it is the row the brief's §6.5 "
        "asks for by name: **if the narrow default can be mutated back to the wide word and "
        "nothing dies, the rail is not carrying the ruling**",
        [(IPC, THE_SEEDED_WORD, "      canStaff: 'any-this-app-does-not-seed',\n      canCreateAgents: 'any',\n      canCreateProjects: 'any',")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The project-manager category seed
        # (`ROLE_TEMPLATES`) and its `canStaff` were deleted (commit: "roles, the seeded grants,
        # role templates … are gone"). There is no template left to widen. Its anchor is left stale,
        # so the census records it retired.
        "M8 · 🔴 the project-manager CATEGORY is seeded the wide word again. ⛔ The tier `HO-052` "
        "§1 exists to make useful reaches past its own staff into a sibling's, which is the same "
        "contradiction one level down — and a seed is the carrier standing rule 32 names, so a "
        "template that ships the widening has performed it for every identity it makes",
        [(IPC, THE_TEMPLATE_WORD, "      canStaff: 'any-this-app-does-not-seed',\n      canCreateAgents: 'any',\n    },")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The defect is now D-014's decision.
        # "Any agent may start a conversation as any existing profile" is wider than "admits
        # anything an agent created", and the `created-by-me` case in `staffingAdmits` was deleted
        # with the reach. Its anchor is left stale, so the census records it retired.
        "M9 · 🔴 `created-by-me` admits anything an AGENT created, whoever that agent was. ⛔ The "
        "word reads the column and still answers the wrong question — every identity in the "
        "product that came through an agent's door is admitted — which is `HO-083` §1's finding "
        "with one more read in front of it and no less reach",
        [(
            RAILS,
            THE_NARROW_ARM,
            "      const creator = facts.whoCreated(foldedProfileId)\n"
            "      return creator !== null && creator.by === 'an-agent'",
        )],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The creator-chain walk `inTheLineOf`
        # (the `while (at !== null && at.by === 'an-agent')` loop) was deleted from spawn-rails.ts
        # with the staffing reach (commit: "the staffing carve-out [is] gone"). No rail reads who
        # created an identity any more. Its anchor is left stale, so the census records it retired.
        "M10 · 🔴 the CHAIN walks past a link that is not an agent. ⛔ A row a PERSON created "
        "becomes transparent, so whoever created that person's creator inherits everything under "
        "it — the subtree `HO-084` §1.3 licenses is a subtree of the holder's own creations and "
        "never of a person's",
        [(
            RAILS,
            THE_WALK,
            "  while (at !== null) {\n"
            "    if (at.by === 'an-agent' && at.agent === holder) return true\n"
            "    if (at.by !== 'an-agent') return true\n"
            "    if (seen.has(at.agent)) return false",
        )],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** Rail 7's staffing question (`holder:
        # foldProfileName(parent.profileId)` against the target's creator) was removed. D-014: "Any
        # agent may start a conversation as any existing profile … no `can_spawn` /
        # `not-in-can-spawn`". Its anchor is left stale, so the census records it retired.
        "M11 · 🔴 rail 7 asks the question about the TARGET rather than about the parent. ⛔ The "
        "holder is whoever is being spawned, so *created by me* is true of everything an agent "
        "made — the grant is spent on the wrong identity, which is the shape `a-person-flag-is-"
        "about-the-owner-not-the-caller` names one field over",
        [(
            RAILS,
            THE_HOLDER_AT_RAIL_SEVEN,
            "        { holder: foldProfileName(asked.profileId), whoCreated: facts.whoCreated },",
        )],
    ),
    # ── D · the two readers of one fact ───────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The defect is now the decision.
        # `profilesVisibleTo()` takes no caller and reads no grant ("Every identity this app holds,
        # and no grant read (D-014)"), and the card says "list_profiles lists every agent" while the
        # door admits every existing profile. Its anchor is left stale, so the census records it
        # retired.
        "M12 · 🔴 the LISTING answers a different question from the rail. ⛔ `profilesVisibleTo` "
        "hands `staffingAdmits` a creator that is always the caller, so `list_profiles` names "
        "every identity in the app while the door refuses most of them — `511` relay 2's defect "
        "with the arrow reversed, and the one that made a project manager report blocked",
        [(
            HOST,
            THE_LISTINGS_LOOKUP,
            "                holder: foldProfileName(caller.profileId),\n"
            "                whoCreated: () => ({ by: 'an-agent', agent: foldProfileName(caller.profileId) }),",
        )],
    ),
    (
        "M13 · 🔴 the grant door names the APP rather than the caller on its admitted arm. ⛔ *Who "
        "is asking* is resolved once precisely so the grant that was read and the provenance that "
        "is written cannot disagree; this makes them disagree in the one direction nothing else "
        "would notice — every agent's creation becomes the app's",
        [(HOST, THE_GRANT_DOORS_ANSWER, "    return { ok: true, creator: { by: 'this-app' } }")],
    ),
    # ── E · the encoding ──────────────────────────────────────────────────────────────────────
    (
        "M14 · 🔴 a value this app cannot read folds to `this-app` rather than to NULL. ⛔ A "
        "hand-edited column stops being *nobody recorded it* and becomes a claim, in the one "
        "direction `parseChoice`'s rule exists to refuse — and `aid:` with nothing after it reads "
        "as an agent with an empty slug, which is a row id no row can have",
        [(
            IDENTITY,
            THE_ENCODING,
            "  if (raw === 'a-person' || raw === 'this-app') return { by: raw }\n"
            "  const prefix = `aid${SEP}`\n"
            "  if (!raw.startsWith(prefix)) return { by: 'this-app' }\n"
            "  const agent = raw.slice(prefix.length)\n"
            "  return { by: 'an-agent', agent }",
        )],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The cycle guard lived in the
        # creator-chain walk `inTheLineOf`, which D-014 deleted with the `created-by-me` reach. The
        # commit leaves the created_by column as an ungated record ("no rail reads who created an
        # identity"), so a ring in it grants nothing. Its anchor is left stale, so the census
        # records it retired.
        "M15 · 🔴 a CYCLE in the creator chain is ADMITTED instead of refused. ⛔ The column has no "
        "foreign key and no CHECK — `0041` says why — so a hand-edited database can hold one, and "
        "a walk that answers *yes* on a ring hands a grant to an identity no chain actually "
        "reaches",
        [(
            RAILS,
            THE_WALK,
            "  while (at !== null && at.by === 'an-agent') {\n"
            "    if (at.agent === holder) return true\n"
            "    if (seen.has(at.agent)) return true",
        )],
    ),
    # ── F · the words ─────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** `STAFFING_REACH_ADMITS` and the
        # `created-by-me` sentence were deleted from capabilities.ts, and the grants sheet now "has
        # six rows and says any agent may start that identity" (card). The narrow word and its
        # sentence no longer exist. Its anchor is left stale, so the census records it retired.
        "M16 · 🔴 the narrow word's SENTENCE describes the wide one. ⛔ It is rendered into the "
        "grant line an agent reads at launch AND into the sheet a person chooses with — one "
        "function, `STAFFING_REACH_ADMITS` — so a model told it may start *any agent this app did "
        "not set up itself* meets a rail that refuses most of them, which is `456`'s measured "
        "defect: twelve live arms acting on a sentence the door did not honour",
        [(
            CAPS,
            THE_NARROW_SENTENCE,
            "  'created-by-me':\n"
            "    'any agent this app did not set up itself, including ones created after this was granted — ' +\n"
            "    'never one this app ships a name for',",
        )],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The `canStaff` field and its sheet help
        # were removed from `CAPABILITY_FIELDS` (commit: "can_staff … unread and unwritten"; "the
        # grants sheet … say[s] what is now true"). There is no staffing choice left to describe.
        # Its anchor is left stale, so the census records it retired.
        "M17 · 🔴 the sheet's HELP names a set again. ⛔ It is the PERSON's half of standing rule "
        "8.1 — *user-facing prose is worse than a docblock, because the person reading it has no "
        "way to check* — and a help that spells one reading of a four-word vocabulary tells "
        "somebody choosing `created-by-me` that it admits every agent this app did not set up",
        [(
            CAPS,
            THE_HELP,
            "    help: 'Whether this identity may start a conversation as an agent that is not in "
            "the list above — including agents created after you granted this. It never includes "
            "the agents this app sets up itself, so it cannot be used to run as one of those.',",
        )],
    ),
]
