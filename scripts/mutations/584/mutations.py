"""584 · Seed one identity, and generate the names.

⛔ **`HO-078` §1:** *"A fresh install ships `brobot` and no other identity."*
⛔ **`HO-078` §5:** *"The app assigns the name. The agent does not choose it and does not ask."*
⛔ **`HO-078` §3:** *"BroBot creates project managers. A project manager staffs ITSELF."*

⚑ **The rows below are about the RAILS and the PROPERTIES**, never about the wiring — the compiler
already refuses to let a call go missing, and a row a compiler kills measures nothing.

## 🔴 A · the seed that was also a roster

⚠️ **`HO-078` §1.1 names a tangle and it is two lines of code.** `SEEDED_GRANTS[default]` held
`canSpawn: ['project-manager']`, and `mintIdentity` writes a row **for every slug a seeded grant
NAMES** — so a CAPABILITY LIST was also the identity ROSTER, and the pre-made project manager
shipped as a side effect of granting BroBot delegation.

⛔ **`M1` puts the list back**, which is `HO-078` §1's world restored: a person clean-installs, opens
the app, and the Team page holds two agents he never asked for. ⚑ **`M2` is the other half of the
same identity** — it puts `project-manager` back into `SEEDED_ROLES`, which alone makes
`thisAppSeedsThatName` true again, so `canStaff: 'any-this-app-does-not-seed'` stops admitting the
one name BroBot has to be able to start. ⚠️ **That is `HO-068` §1 arriving from the other direction**:
BroBot creates a project manager and cannot start it, which is the defect `573` was dispatched for.

⛔ **`mintIdentity`'s grant-target loop gets NO ROW, and that is said rather than papered over.**
With no seeded grant naming a target, `seededGrantFor(...)?.canSpawn ?? []` is empty for every input
the shipped app can hand it — so **no mutation on that loop can change an answer**
(`a-line-no-mutation-can-kill-is-not-carrying-its-rule`). ⚑ It is KEPT because it is what makes *the
grant and the identity are one decision* true for the next seeded grant, and `M1` is what reaches it:
a row that restores the list is also the row that re-animates the loop, which is the honest way to
measure a mechanism whose data is gone.

## ⚑ B · who decides what an agent is called

🔴 **`M3` lets the generator name BroBot.** ⛔ `profileLabel` already answers *BroBot (default)* for
that slug with a roster and without one, so a handle there is a SECOND answer to a question this app
already answers — and it would take the first name of the list, leaving every fresh install one short.

⛔ **`M4` puts the app's name in front of a person's.** ⚑ `HO-078` §5 took the decision away from the
MODEL and left it with the PERSON — *"the person can rename"* — and `NewAgent.vue` is where they
type one. ⚠️ A row that overrules them is standing rule 11's shape at the creation door: the app
deciding a value a person has already answered.

⚠️ **`M5` stops the uniqueness check reading the SLUG column.** ⛔ An agent addressed as `ada` beside
one displayed as *Ada* is a collision a person trips over whichever column produced it, and `HO-078`
§5.2 asks for uniqueness *"checkable before, not refused after"* — which is only as wide as the set
it checks against.

🔴 **`M6` hands out the same name every time.** ⛔ *Uniqueness at assignment* is the whole of §5.2 and
it is invisible in one sample: a roster of sixty-nine agents all called *Ada* satisfies every
assertion that an identity HAS a name.

⛔ **`M7` makes a full roster reissue a used name bare.** ⚑ When every name is taken, a used one is
given with a number (*Ada 2*); a bare reissue is the version that looks like success — the next
agent gets a name, it is somebody else's, and nothing says so.

## ⛔ C · the door an agent walks

🔴 **`M8` reads `display_name` off the arguments again.** ⚠️ **`348`'s `z.looseObject` is what makes
this reachable**: an undocumented key is NOT stripped, so a reader with no advertisement is a path a
test can drive and no model was ever told about — which is worse than the field, because the model
cannot even see what decided its agent's name.

⚑ **`M9` drops the name from the success answer.** ⛔ A door that assigns silently is a door a model
has to ASK about, and asking the person is exactly what `HO-078` §5.1 measured costing a run —
*"a decision that bought nothing and blocked his run."*

## ⚠️ D · the sentences each tier is told

⛔ **`M10` puts the withdrawn instruction back.** ⚑ `HO-078` §3.1: *"That was `HO-042` §4.2. The PO
withdrew half of it a week ago — and the instruction never followed the withdrawal."* 🔴 **the person
watched BroBot obey it**, which is what a sentence that was true when it shipped costs (standing
rule 8.1).

⚠️ **`M11` renders the project manager's staffing line unbranched.** ⛔ A line requiring a capability
can be false from the day it ships — `402`, measured live — and this one is false for any project
manager a person has narrowed.

⛔ **`M12` restores *an agent you cannot create* in a branch about STARTING.** ⚑ Found sweeping for
`HO-078` §3.1 and repaired in the same commit (standing rule 19's corollary): since `532` a project
manager's category grants creation, so the clause was false of exactly the identity most likely to
read it.

## ⛔ What this table does NOT cover

 1. **`ROLE_TEMPLATES`' contents.** `532` owns them and this dispatch changed none; `M2` is about the
    SEED tables, which is the half `HO-078` §1.1 separates them from.
 2. **The migrations.** Nothing was added or changed, and `0025`'s guard is asserted by driving it
    rather than by mutating it — a row there would edit a file that has already run on every install
    it can reach.
 3. **`NOTICE_MEANS`' corrected sentence.** ⚠️ It is user-facing prose with no assertion of its own
    today, so a row on it would be a survivor by construction — raised as a finding instead
    (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`).
"""

IPC = "apps/desktop/src/shared/runtime-ipc.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
NAMES = "apps/desktop/src/shared/human-names.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
TEXT = "apps/desktop/src/main/runtime/factory-text.ts"

MUTATIONS = [
    # ---- A · the seed that was also a roster ------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 removed the seeded grants and
        # `canSpawn` itself. The commit says "roles, the seeded grants, role templates and the
        # staffing carve-out are gone … A new identity row is all NULL", and the card says "no
        # `can_spawn` / `not-in-can-spawn`". Its anchor is left stale, so the census records it
        # retired.
        "M1 · ⛔ **the seeded grant NAMES a target again** · `HO-078` §1's world restored — a "
        "person clean-installs and finds an agent nobody asked for, because a capability list is "
        "also the roster `mintIdentity` walks",
        [
            (
                IPC,
                # ⚑ **RE-ANCHORED at `598`, not retired**: `HO-084` §1 narrowed the seeded
                # word from `any-this-app-does-not-seed` to `created-by-me`. ⛔ The defect
                # this row names is unchanged; only the value it quotes moved.
                "      canMessage: 'any',\n      canAssignWork: 'any',\n      canStaff: 'created-by-me',",
                "      canMessage: 'any',\n      canAssignWork: 'any',\n      canSpawn: ['project-manager'],\n      canStaff: 'created-by-me',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject is gone. `SEEDED_ROLES`,
        # `AgentRole` on `AgentIdentity`, `thisAppSeedsThatName` and the staffing reach it fed were
        # all deleted (commit: "roles, the seeded grants, role templates and the staffing carve-out
        # are gone"; card: "no roles … no role anywhere"). Its anchor is left stale, so the census
        # records it retired.
        "M2 · 🔴 **the second seeded ROLE comes back** · which alone makes "
        "`thisAppSeedsThatName` true, so BroBot's staffing reach stops admitting the one name it "
        "has to be able to start — `HO-068` §1 from the other direction",
        [
            (
                IPC,
                "    why: 'The default profile is BroBot, which is the one role this app knows rather than infers.',\n  },\n]",
                "    why: 'The default profile is BroBot, which is the one role this app knows rather than infers.',\n  },\n  {\n    slug: 'project-manager',\n    role: 'project-manager',\n    why: 'This identity exists because BroBot is granted the right to create a project manager.',\n  },\n]",
            )
        ],
    ),
    # ---- B · who decides what an agent is called --------------------------------------------
    (
        "M3 · ⛔ **the generator names BroBot** · a second answer to a question `profileLabel` "
        "already answers with a roster and without one — and it spends the first pool member on a "
        "row nothing reads it from",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule survives: the name
        # generator still leaves the default profile nameless. Re-verified RED alone.
        [
            (STORE, '    if (folded === DEFAULT_PROFILE_ID) return null\n', ''),
        ],
    ),
    (
        "M4 · ⚠️ **the app's name goes in FRONT of a person's** · standing rule 11 at the creation "
        "door: a person typed a name into `NewAgent` and this app decided a value they had already "
        "answered",
        [
            (
                STORE,
                "        displayName: blankToNull(said.displayName) ?? nameForANewIdentity(slug),",
                "        displayName: nameForANewIdentity(slug) ?? blankToNull(said.displayName),",
            )
        ],
    ),
    (
        "M5 · ⚠️ **the uniqueness check stops reading the SLUG column** · `HO-078` §5.2's "
        "*checkable before* is only as wide as the set it checks, and an agent addressed as `ada` "
        "beside one displayed as *Ada* is one collision whichever column produced it",
        [(STORE, "      taken.push(row.slug)\n", "")],
    ),
    (
        "M6 · 🔴 **every agent gets the same name** · *uniqueness at assignment* is invisible in a "
        "single sample, and a roster of sixty-nine identical handles satisfies every assertion "
        "that an identity HAS a name",
        [
            (
                NAMES,
                # ⚑ **the agent-name generator · re-anchored in place, not retired** — names come first from BroBot's own list, in order; the mutation hands out its first name every time
                "  const first = own?.names.find((one) => !answersTo.has(one.key))",
                "  const first = own?.names[0]",
            )
        ],
    ),
    (
        "M7 · ⛔ **an exhausted pool reissues its last member** · the closed set's end is a STATE, "
        "and a reissue is the version of it that looks like success: the next agent gets a name, "
        "it is somebody else's, and nothing says so",
        [
            (
                NAMES,
                # ⚑ **the agent-name generator · re-anchored in place, not retired** — no closed pool any more: when every name is taken a used one is given with a number; the mutation reissues it bare
                "  const again = oneOf(namesThatCanBeGiven(), random)\n",
                "  const again = oneOf(namesThatCanBeGiven(), random)\n  return again\n",
            )
        ],
    ),
    # ---- C · the door an agent walks ----------------------------------------------------------
    (
        "M8 · 🔴 **the door reads `display_name` off the arguments again** · reachable only because "
        "`348`'s `z.looseObject` does not strip an undocumented key — a reader with no "
        "advertisement is a path no model was ever told about",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule survives: `create_agent`
        # still sends `displayName: null` and advertises no name field. The anchor moved because
        # D-014 deleted the `role:` line after it; the line after it is now `provider:`. Re-verified
        # RED alone.
        [
            (TOOLS, '            displayName: null,\n            provider: provider === undefined ? null : (provider as Provider),', "            displayName: (args as Record<string, unknown>)['display_name'] as string | null,\n            provider: provider === undefined ? null : (provider as Provider),"),
        ],
    ),
    # Re-anchored, NOT VERIFIED and HELD; its test reaches a held path.
    (
        "M9 · ⚑ **the success answer stops naming the agent** · a door that assigns silently is a "
        "door a model has to ASK about, and asking the person is what `HO-078` §5.1 measured "
        "costing a run",
        [('apps/desktop/src/main/runtime/agent-tools.ts', 'createdAndNamed(named)', 'CREATED_UNDER_ITS_PROFILE_NAME')],
    ),
    # ---- D · the sentences each tier is told --------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (T-002): PE-003 (one situational instruction set for every agent; the role column is no longer read) removed BroBot's staffing lines.**
        # Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M10 · ⛔ **the withdrawn instruction comes back** · `HO-078` §3.1, and the person watched "
        "BroBot obey it: a sentence that was true when it shipped, left standing a week after the "
        "ruling under it was withdrawn",
        [
            (
                TEXT,
                "                  'When a domain of work has no project manager yet, bring one into existence ' +\n                    'yourself and give it the work — one project manager per domain, not one per ' +\n                    'piece of work.',\n                  'Leave the agents under a project manager to that project manager: tell it what ' +\n                    'the work needs rather than creating those agents yourself.',",
                "                  'When work needs a kind of agent that does not exist yet, bring that agent ' +\n                    'into existence yourself and then delegate the work to a project manager — ' +\n                    'do not ask a project manager to create it.',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-002): PE-003 (one situational instruction set for every agent; the role column is no longer read) removed the project manager's staffing branch (`mayBringOneIntoBeing`).**
        # Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M11 · ⚠️ **the project manager's staffing line is rendered unbranched** · `402` a fourth "
        "time: a line requiring a capability, told to an identity a person has narrowed out of it",
        [
            (
                TEXT,
                "            ...(acts.mayBringOneIntoBeing\n              ? [\n                  'When the work needs a kind of agent this project does not have, bring that ' +\n                    'agent into existence yourself rather than asking for one.',\n                ]\n              : []),",
                "            'When the work needs a kind of agent this project does not have, bring that ' +\n              'agent into existence yourself rather than asking for one.',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-002): PE-003 (one situational instruction set for every agent; the role column is no longer read) removed the project manager's *You may start no conversation* branch.**
        # Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M12 · ⛔ **a branch about STARTING says *cannot create* again** · false of exactly the "
        "identity most likely to read it, since `532` gave the project-manager category creation "
        "— standing rule 19's corollary, put back",
        [
            (
                TEXT,
                "            'You may start no conversation of your own, so scope AND do this work yourself ' +\n              'rather than waiting on an agent you cannot start.',",
                "            'You may start no conversation of your own, so scope AND do this work yourself ' +\n              'rather than waiting on an agent you cannot create.',",
            )
        ],
    ),
]
