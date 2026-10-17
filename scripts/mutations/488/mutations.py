"""488 · who exists, and what they were told — HO-020's `list_profiles`, HO-031 §2.3's second half.

⛔ **The measurement this table exists for is two rows of BroBot's own orientation table.** Asked
*what identities exist* and *what may I spawn*, it answered **two** and **only `project-manager`**,
and recorded where both answers came from: **sqlite only**, read with a shell.

> 🔴 **"`list_agents` enumerates CONVERSATIONS, not identities, so an identity that has never run is
> undiscoverable."** ⚠️ *"An agent without shell access to `brobot2.sqlite` could not have answered*
> who can you hire? *at all."*

## 🔴 What the repair actually is, which is not a wider `list_agents`

⚠️ **No narrowing of the conversation reader could have answered it.** `467`'s sentence transfers
whole — *"a conversation with nothing waiting on anybody produces no queue row at all"* — and an
identity that has never run produces no conversation, so a roster folded out of live slots
under-reports exactly the population the question is about.

⛔ **And the fold is not a choice this dispatch made.** `admitSpawn`'s rail 4 already ruled it, in
the source: *"Asking `can_spawn` first means an agent only ever learns about profiles it was already
granted — it cannot enumerate the app's identities by spelling names at this door."* ⚑ **`M1` is the
row that reverses that ruling** — a listing wider than the grant, which is the same disclosure the
spawn door refuses one name at a time, granted wholesale for the price of one call.

## ⚑ The half that is worth more than the grant line `485` already prints

⛔ **A grant carries NAMES.** `485` renders them into every launch — *`May start conversations as:
builder, nobody-minted-this`* — and a name this app holds no identity for is `unknown-profile`,
which is PERMANENT. ⚠️ `mintIdentity`'s own docblock is about exactly this failure: *"A grant naming
an identity that does not exist is not a capability; it is a sentence."* 🔴 **`M2` and `M3` are the
two ways that half stops being answered** — dropped silently, or answered in the wrong direction by
listing a name nothing can start.

## ⛔ What this table deliberately does NOT contain

⛔ **No row that widens the disclosure to another identity's grants.** A row carries four facts and
no capability of the target's; that is a ruling, and a mutation planting one would be this dispatch
arguing with itself rather than measuring a rule. ⚠️ **The bound is asserted by name instead**, in
§4 of the suite, over the whole payload and derived from `CAPABILITY_FIELDS` — so a capability added
later is banned the day it exists.

⛔ **No row on `instruct_profile`.** Nothing was built: §2 of the response says the entitlement needs
a ruling first, and a mutation table for a mechanism nobody ruled would be evidence for a decision
nobody made.

⛔ **No row on the app-wide spawn switch.** `485` discloses it at launch and `admitSpawn`'s rail 1
answers it at the act; folding it into a sentence about what a COUNT covers would break the rule
`REACH_LISTS` states for itself — *each sentence says what the LIST is, never what the caller may do
about it*.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| `M1`–`M5` | ⚑ **`apps/desktop/test/who-exists-and-what-they-were-told.test.ts`** §1, and §2's biconditional with the spawn door |
| `M6`–`M10` | ⚑ the same file's §3 — `448`'s register on the identity axis |
| `M11`–`M13`, `M17` | ⚑ §4 — the disclosure, bounded, at BOTH layers |
| `M14`, `M15` | ⚑ §5 — the door: no argument, and no wall it has no business asking |
| `M16` | ⚑ §1 — the line a person sees, whose first word is the only one `spawn_agent` takes |
| `M18`–`M24` | ⚑ the same file's §7 and §3 — `511 relay 2`'s second arm of rail 7 |

## 🔴 `M11` SURVIVED its first pass, and the row was right

⛔ **The row spreads the whole identity into the host's reading, and nothing observable changed** —
because the DOOR builds its payload field by field, so the extra columns died one layer later.
⚠️ **That is `assert-in-the-gap-not-after-the-repair` in its exact shape**: a later step that
rewrites the same field hides the defect, and the bound at the host was a coincidence rather than a
rule. ⚑ **The fix is a test and a second row, not a softer row**: §4 now asserts the host's own
reading carries four keys and no capability, and `M17` puts the spread where it really does reach a
model.

## 🔴 `511 relay 2` · the fold read ONE of the two grants rail 7 spends

⛔ **Measured on the person's machine, on a clean base.** A seeded project manager — `canStaff:
'any-this-app-does-not-seed'`, `can_spawn` empty — asked this door what it could start, twice, and
was answered *"Your grant lets you start a conversation as nobody, so this list is empty for that
reason and no other."* ⚠️ **It believed the sentence and reported its task blocked without ever
attempting the spawn.** 🔴 **`admitSpawn` would have admitted it**: rail 7 falls through
`canSpawn` to `staffingAdmits`, and this fold short-circuited on the list alone.

⚑ **`M18`–`M24` are the seven ways that repair can be undone**, and each is a different defect
rather than seven spellings of one: the reach dropped from the population (`M18`), the empty-list
short-circuit re-armed (`M19`), the reach admitting the names this app SHIPS (`M20`, `M22` — the
control the grant is *defined* by), the word not following the arm (`M21`), the named half of the
union lost (`M23`), and the reach-shaped sentence claiming the count is of what exists (`M24`,
`M10`'s shape one member over).

⛔ **No row on `staffingAdmits` itself.** `a-tier-that-can-staff-its-project.test.ts` §4 owns that
function and the brief that opened this repair is explicit that the rail is correct; a row here
would be this table measuring somebody else's rule from further away than the test that already
pins it. ⚠️ **What IS measured here is that this door asks it at all** — `M18` and `M20` are the two
directions of that, and `169` §1 is why neither may be answered by a copy of what it decides.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

# ⚑ **511 relay 2 · the reach fold, written once** — three rows anchor on it or inside it, and
# a second transcription is a second thing to keep in step with prettier.
# ⚑ **RE-ANCHORED at `598`, not retired**: `HO-084` §1 gave `staffingAdmits` a facts argument, so
# the predicate spans nine lines instead of one. ⛔ The rows that spend this constant are unchanged.
REACHED = (
    "    const reached = reaches\n"
    "      ? [...held.keys()].filter(\n"
    "          (slug) =>\n"
    "            !named.has(slug) &&\n"
    "            staffingAdmits(\n"
    "              allowed.canStaff,\n"
    "              {\n"
    "                holder: foldProfileName(caller.profileId),\n"
    "                whoCreated: (folded) => held.get(folded)?.createdBy ?? null,\n"
    "              },\n"
    "              slug,\n"
    "            ),\n"
    "        )\n"
    "      : []\n"
)

# ⚑ **598 · the predicate alone**, for the two rows that replace the test rather than the walk.
THE_PREDICATE = (
    "          (slug) =>\n"
    "            !named.has(slug) &&\n"
    "            staffingAdmits(\n"
    "              allowed.canStaff,\n"
    "              {\n"
    "                holder: foldProfileName(caller.profileId),\n"
    "                whoCreated: (folded) => held.get(folded)?.createdBy ?? null,\n"
    "              },\n"
    "              slug,\n"
    "            ),"
)
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
CAPS = "apps/desktop/src/shared/capabilities.ts"

MUTATIONS = [
    # ------------------------------------------------------------------ §1 · the fold IS the grant
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row's defect is now D-014's
        # decision. The commit says 'Any agent may start a conversation as any existing profile …
        # list_profiles lists every agent', and profilesVisibleTo now returns the whole roster with
        # no grant read. A listing that answers the whole roster is what ships. Its anchor is left
        # stale, so the census records it retired.
        "M1 · 🔴 the listing stops being folded through the grant and answers the whole roster · "
        "this is the ruling `admitSpawn` rail 4 makes one door over, reversed for the price of one "
        "call instead of one call per name — and it is the widening the brief asks to be decided "
        "rather than drifted into",
        [
            (
                HOST,
                "    const granted = [...new Set(allowed.canSpawn)]",
                "    const granted = [...new Set(this.deps.store.agentIdentities().map((one) => one.slug))]",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject was names carried by
        # can_spawn that have no identity, and D-014 removed can_spawn ('can_spawn … unread').
        # grantedButNotHere is deleted from the host and the door. Its anchor is left stale, so the
        # census records it retired.
        "M2 · ⛔ a granted name this app holds no identity for is dropped silently · the caller is "
        "left with a grant line that names it and a door that will refuse it `unknown-profile` "
        "PERMANENTLY, which is the gap this verb exists to close",
        [
            (
                HOST,
                "      if (one === undefined) {\n"
                "        grantedButNotHere.push(slug)\n"
                "        continue\n"
                "      }",
                "      if (one === undefined) {\n"
                "        continue\n"
                "      }",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject was a GRANTED name with no
        # identity, and D-014 removed the grant that carried names (can_spawn). The listing is now
        # read only from agentIdentities(), so no granted name exists to list wrongly. Its anchor is
        # left stale, so the census records it retired.
        "M3 · 🔴 a granted name with no identity is LISTED as though it were one · the same defect "
        "in the direction that is worse, because a caller acting on it spends a turn on a refusal "
        "that can never be made true",
        [
            (
                HOST,
                "      const one = held.get(slug)\n"
                "      if (one === undefined) {",
                "      const one = held.get(slug) ?? { slug, displayName: null, role: null, provider: null }\n"
                "      if (false as boolean) {",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row protected deduping
        # allowed.canSpawn, and can_spawn was removed ('can_spawn … unread and unwritten'). There is
        # no grant list to dedupe. Its anchor is left stale, so the census records it retired.
        "M4 · ⚠️ the grant is read without deduping · `Worker` and `worker` are ONE identity (187, "
        "238) and the stored list folds on its way out, so a grant that spells one name twice makes "
        "`count` a count of grant entries rather than of agents",
        [
            (
                HOST,
                "    const granted = [...new Set(allowed.canSpawn)]",
                "    const granted = [...allowed.canSpawn]",
            )
        ],
    ),
    (
        "M5 · ⛔ the existence test moves off the identity row · `admitSpawn` rail 8 asks the same "
        "table, so a listing answered from anywhere else can disagree with the door it exists to "
        "inform — and a listed name that is then refused `unknown-profile` is worse than no listing",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule survives in today's
        # docblock: 'One store read, so existence and description cannot disagree … listed here and
        # admitSpawn will not answer unknown-profile are the same question', pinned by §2's
        # biconditional. Re-verified RED alone.
        [
            (HOST, '      profiles: this.deps.store.agentIdentities().map((one): ProfileReport => {', '      profiles: this.deps.store\n        .agentIdentities()\n        .filter((one) => one.provider !== null)\n        .map((one): ProfileReport => {'),
        ],
    ),
    # ------------------------------------------------- §2 · 448's register, on the identity axis
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The 'your-grant-is-empty' word and its
        # sentence were deleted with the grant fold. The reading takes no caller and there is no
        # grant that can name nobody ('list_profiles lists every agent'). Its anchor is left stale,
        # so the census records it retired.
        "M6 · 🔴 a caller whose grant names nobody is told the ordinary sentence · *this counts what "
        "you may start* beside an empty list reads as *this app holds none*, which is `447`'s harm "
        "affirmed rather than implied",
        [
            (
                HOST,
                "      return { profiles: [], grantedButNotHere: [], listing: 'your-grant-is-empty' }",
                "      return {\n"
                "        profiles: [],\n"
                "        grantedButNotHere: [],\n"
                "        listing: 'only-the-agents-you-may-start',\n"
                "      }",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The 'this-app-cannot-name-you' branch
        # was deleted. profilesVisibleTo() takes no caller and reads no grant ('D-014 · the reading
        # takes no caller — every agent sees every identity'), so there is no ruled grant to fall
        # back to. Its anchor is left stale, so the census records it retired.
        "M7 · ⛔ a conversation this app cannot name falls back to the ruled grant · `factory-text.ts` "
        "ruled this absence one surface over and its sentence is why — *that is not the same as "
        "being granted nothing* — so a default read here reports a row nobody looked at",
        [
            (
                HOST,
                # ⚑ **RE-ANCHORED at `598`**: the guard spells `caller === null` beside the one it
                # always had, because the reach below needs the caller's own slug (`HO-084` §1).
                # ⛔ It changes nothing — `allowed` is read only when there is a caller.
                "    if (caller === null || allowed === null) {\n"
                "      return { profiles: [], grantedButNotHere: [], listing: 'this-app-cannot-name-you' }\n"
                "    }",
                "    if (caller === null || allowed === null) {\n"
                "      return { profiles: [], grantedButNotHere: [], listing: 'your-grant-is-empty' }\n"
                "    }",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The fold's own word (reading.listing)
        # and PROFILE_LIST_COVERS were deleted. There is now one constant sentence,
        # EVERY_AGENT_THIS_APP_HOLDS, so no case exists that a door could choose instead of the
        # fold. Its anchor is left stale, so the census records it retired.
        "M8 · 🔴 the sentence is chosen at the DOOR from the row count instead of from the fold's own "
        "word · a door that decides what a list covers can report a case the fold never took, which "
        "is the defect `count_covers` exists to close arriving from inside it",
        [
            (
                TOOLS,
                "          const covers = PROFILE_LIST_COVERS[reading.listing]",
                "          const covers =\n"
                "            profiles.length === 0\n"
                "              ? PROFILE_LIST_COVERS['your-grant-is-empty']\n"
                "              : PROFILE_LIST_COVERS['only-the-agents-you-may-start']",
            )
        ],
    ),
    (
        "M9 · ⛔ the sentence stops leading the text half · a person sees at most 200 characters of "
        "a tool result, so the one line that changes what a reader may conclude is the one that has "
        "to survive the cut",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule survives: the covers
        # sentence must lead the text half ('FIRST, because it is the only line guaranteed to
        # survive the cut'). §3 still asserts startsWith. Re-verified RED alone.
        [
            # ⚑ **W4.166 · F096 · re-anchored in place, not retired** — the text half gained each provider's usage line after the profiles, so the array no longer closes after them; the swap is the same — the covers sentence stops leading
            (TOOLS, "              EVERY_AGENT_THIS_APP_HOLDS,\n              ...reading.profiles.map((report) => profileText(report)),\n", "              ...reading.profiles.map((report) => profileText(report)),\n              EVERY_AGENT_THIS_APP_HOLDS,\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row's defect is now the shipped
        # sentence. D-014 deleted PROFILE_LIST_COVERS and ships EVERY_AGENT_THIS_APP_HOLDS: 'This
        # counts every agent this app holds, and you may start a conversation as any of them.' The
        # mutation's text is essentially what ships now. Its anchor is left stale, so the census
        # records it retired.
        "M10 · ⚠️ the sentence for a folded listing claims it counts what EXISTS · the exact sentence "
        "`447` measured a model writing out of a correctly scoped answer, put back into the field "
        "that was built to stop it",
        [
            (
                CAPS,
                "  'only-the-agents-you-may-start':\n"
                "    'This counts the agents your own grant lets you start a conversation as, so it counts what you may start and not what exists. This app may hold agents that are not in it, and it says nothing about how many.',",
                "  'only-the-agents-you-may-start':\n"
                "    'This counts every agent this app holds.',",
            )
        ],
    ),
    # ----------------------------------------------------------------- §3 · the disclosure, bounded
    (
        "M11 · 🔴 the row is spread from the identity instead of built field by field · a spread "
        "writes past a narrower declared type, which is how a capability column reaches a model "
        "without anybody choosing it — `a-spread-writes-past-a-declared-type`, on the surface that "
        "publishes another identity's configuration",
        # ⚠️ **ANCHOR CORRECTED IN PLACE BY 682** — the row gained a fifth field (`modelChoice`,
        # inbox 8); the defect is the same spread of the whole identity into it.
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule survives in today's
        # profilesVisibleTo: 'Four fields, built here rather than spread from the row … a spread
        # with a narrower declared type writes past the type'. Only the fold around it went.
        # Re-verified RED alone.
        [
            # ⚑ **an agent keeps its provider · re-anchored in place, not retired** — the listing reports the provider the agent runs on, read into runsOn; the plant still spreads the row.
            (HOST, "        const runsOn = this.itsProvider(one.slug).provider\n        return {\n          profile: one.slug,\n          displayName: one.displayName,\n          provider: runsOn,\n", "        const runsOn = this.itsProvider(one.slug).provider\n        return {\n          ...one,\n          profile: one.slug,\n          displayName: one.displayName,\n          provider: runsOn,\n"),
        ],
    ),
    (
        "M12 · ⛔ an absent display name is rendered as a value · `086`'s rule, on the field a person "
        "types: a name somebody cleared and one nobody ever typed are the same fact, and a literal "
        "printed after the colon is a claim nobody made",
        [
            (
                TOOLS,
                # ⚠️ **The neighbouring line is part of the anchor on purpose** — `list_projects`
                # spells this fold identically one door up, and an anchor that matched both would be
                # unappliable rather than wrong.
                "            profile: report.profile,\n"
                "            ...(report.displayName === null ? {} : { display_name: report.displayName }),",
                "            profile: report.profile,\n"
                "            display_name: report.displayName ?? report.profile,",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** granted_but_not_here existed only for
        # names carried by can_spawn, and D-014 removed that grant ('can_spawn … unread and
        # unwritten'). The key and grantedButNotHere are gone from the host and the door, so there
        # is no gap list to make conditional. Its anchor is left stale, so the census records it
        # retired.
        "M13 · ⚠️ the gap list is present only when it is non-empty · a key that appears sometimes is "
        "a key a reader has to guess the meaning of when it is missing, and *every name your grant "
        "carries is here* is a real answer this app can give",
        [
            (
                TOOLS,
                "              granted_but_not_here: reading.grantedButNotHere,",
                "              ...(reading.grantedButNotHere.length === 0\n"
                "                ? {}\n"
                "                : { granted_but_not_here: reading.grantedButNotHere }),",
            )
        ],
    ),
    # ------------------------------------------------------------------------------- §4 · the door
    (
        # ⛔ **RETIRED BY RULING (F009, 223477ab; W4.143 reviewer agreed):** list_profiles now takes an
        # optional `profile` by design, opening that agent's record; the argument this row planted is
        # the design, and since D-014 the roster names every identity, so no existence answer leaks.
        "M14 · 🔴 the door advertises a name to ask about · the argument this verb refuses, because "
        "the whole listing is the caller's own grant and a named arm buys one narrowing at the cost "
        "of an existence answer at a door whose discipline is that existence is never asked first",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule survives: list_profiles
        # takes no argument ('A name to ask about was the obvious argument and it is refused',
        # `input: {}`). D-014 rewrote the comment line under the anchor. The plant advertises
        # profile_slug again. Re-verified RED alone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — list_profiles
        # still takes no argument by ruling (`input: {}`, with the docblock 'A name to ask about was
        # the obvious argument and it is refused'), and section 5 asserts the empty input. The
        # comment line the old anchor ran into was rewritten for give_work, so the plant anchors on
        # the docblock's last words and `input: {}` and advertises profile_slug again. Killed by
        # `who-exists-and-what-they-were-told.test.ts`.
        [
            (TOOLS, 'second shape of answer.\n       */\n      input: {},\n', "second shape of answer.\n       */\n      input: {\n        profile_slug: z.string().optional().describe('One agent, by its name.'),\n      },\n"),
        ],
    ),
    (
        "M15 · ⛔ the door asks a standing wall it has no business asking · `may-not-read-a-project` "
        "is `can_message` read for the `read` act and this list holds no project, so a reader "
        "copied from `list_projects` refuses on a grant that says nothing about identities",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule survives and is stated at
        # the door: 'No wall and no fold (D-014)'. It is pinned by both source censuses. The line
        # moved because the reading no longer takes (me, by). Re-verified RED alone.
        [
            (TOOLS, '          const reading = host.profilesVisibleTo()', "          const wall = host.mayReachAtAll('read', by)\n          if (wall !== null) {\n            return answer(carryMessageRefusal(wall), `refused (${wall.rail}): ${wall.reason}`)\n          }\n          const reading = host.profilesVisibleTo()"),
        ],
    ),
    # ------------------------------------------------------------- §5 · the line, and the one line
    (
        "M16 · ⚠️ the line a person sees leads with the display name · the slug is the only part of "
        "this row `spawn_agent` takes, and a summary cut at 200 characters that leads with a human "
        "name spends its characters on the half nobody can spend",
        [
            (
                TOOLS,
                "  [\n"
                "    report.profile,\n"
                "    ...(report.displayName === null || report.displayName === report.profile\n"
                "      ? []\n"
                "      : [report.displayName]),",
                "  [\n"
                "    ...(report.displayName === null || report.displayName === report.profile\n"
                "      ? []\n"
                "      : [report.displayName]),\n"
                "    report.profile,",
            )
        ],
    ),
    # ------------------------------------------- §6 · the layer the first attempt measured nothing at
    (
        "M17 · ⛔ the PAYLOAD is spread from the reading rather than built field by field · the same "
        "defect one layer out and the one that actually reaches a model — `list_projects` spells "
        "this construction the same way one door up, so a door copied from it is how a field "
        "nobody chose arrives at an agent",
        [
            (
                TOOLS,
                "          const profiles = reading.profiles.map((report) => ({\n"
                "            profile: report.profile,",
                "          const profiles = reading.profiles.map((report) => ({\n"
                "            ...report,\n"
                "            profile: report.profile,",
            )
        ],
    ),
    # ─────────────────── §7 · 511 relay 2 · the second arm of rail 7, at the discovery door
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The reach arm (canStaff via
        # staffingAdmits) was removed. The commit says 'the staffing carve-out [is] gone' and
        # 'can_staff … unread and unwritten'. The `reached` walk no longer exists. Its anchor is
        # left stale, so the census records it retired.
        "M18 · 🔴 the reach is dropped from the population and only the NAMED grant is folded · "
        "this is the person's defect exactly: a project manager holding `canStaff` and an empty "
        "`can_spawn` is told it may start nobody, by the only door it has for finding out, while "
        "`admitSpawn` rail 7 would have admitted every one of them",
        [
            (
                HOST,
                REACHED,
                "    const reached: string[] = []\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The empty-grant short-circuit belonged
        # to the grant fold, which D-014 removed. 'list_profiles lists every agent', so there is no
        # `granted`/`reaches` pair to test. Its anchor is left stale, so the census records it
        # retired.
        "M19 · ⛔ the empty-list short-circuit is re-armed · the same defect through the one branch "
        "that never reached the store — a caller whose grant NAMES nobody returns before the reach "
        "is ever asked, which is the line the sentence it believed was printed from",
        [
            (
                HOST,
                "    if (granted.length === 0 && !reaches) {",
                "    if (granted.length === 0) {",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row's defect is now D-014's
        # decision. 'Any agent may start a conversation as any existing profile' and 'no rule names
        # an agent' (card: '⚑ no rule names BroBot or any agent') mean listing the identities the
        # app ships, BroBot included, is intended. Its anchor is left stale, so the census records
        # it retired.
        "M20 · 🔴 the reach admits every identity this app holds, including the ones it SHIPS · "
        "`any-this-app-does-not-seed` is defined by its exclusion, and a listing that names "
        "`default` tells a project manager it may run as BroBot — the grant a person would have to "
        "widen to make true, offered as a reading",
        [
            (
                HOST,
                # ⚑ **RE-ANCHORED at `598`** — see {@link THE_PREDICATE}; the defect is unchanged.
                THE_PREDICATE,
                "          (slug) => !named.has(slug),",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The two arm-specific words
        # ('the-agents-here-your-reach-admits' and 'only-the-agents-you-may-start') and the
        # `listing` field were deleted with the fold. One sentence, EVERY_AGENT_THIS_APP_HOLDS,
        # replaces them. Its anchor is left stale, so the census records it retired.
        "M21 · ⚠️ the word does not follow the arm that answered · a reach-shaped count is reported "
        "under the sentence written for a NAMED list, so a reader is told the number is bounded by "
        "a grant it can see while it is really a walk over what this app holds — `447`'s harm, "
        "sharper on this arm rather than softer",
        [
            (
                HOST,
                "      listing: reaches ? 'the-agents-here-your-reach-admits' : 'only-the-agents-you-may-start',",
                "      listing: 'only-the-agents-you-may-start',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row protected how canStaff's
        # excluded set was derived, and canStaff was removed ('the staffing carve-out [is] gone').
        # There is no excluded set left to derive. Its anchor is left stale, so the census records
        # it retired.
        "M22 · ⛔ the excluded set is derived from the TARGET's row instead of from the app's seeds · "
        "{@link ProfileCapabilities.canStaff} refuses this reading by name — *deriving the set from "
        "the target does not itself delegate would mean narrowing one identity's spawn grant "
        "WIDENED who may run as it* — and it puts the answer on a column a person can edit rather "
        "than on two constants in the shipped release",
        [
            (
                HOST,
                # ⚑ **RE-ANCHORED at `598`** — see {@link THE_PREDICATE}; the defect is unchanged.
                THE_PREDICATE,
                "          (slug) =>\n"
                "            !named.has(slug) && this.deps.store.capabilitiesOf(slug)?.canStaff === 'none',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The union of the named arm (canSpawn)
        # and the reach arm (canStaff) is gone because both grants were removed by D-014. `for
        # (const slug of [...granted, ...reached])` no longer exists. Its anchor is left stale, so
        # the census records it retired.
        "M23 · ⚠️ the named half of the union is lost · a caller holding BOTH arms reads a list its "
        "own grant is missing from, and `granted_but_not_here` empties with it — so the one field "
        "that tells a caller a granted name is unstartable stops answering for the arm that "
        "carries names",
        [
            (
                HOST,
                "    for (const slug of [...granted, ...reached]) {",
                "    for (const slug of reached) {",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row's defect is now the shipped
        # sentence. The reach-shaped sentence was deleted, and D-014 ships 'This counts every agent
        # this app holds…' because the listing is the roster. Its anchor is left stale, so the
        # census records it retired.
        "M24 · ⛔ the reach-shaped sentence claims the count is of what EXISTS · `M10`'s row one "
        "member over, and the harm is worse here: a reach really does put nearly every identity in "
        "the app in the list, so *there are two agents in this app* is a sentence a reader is now "
        "far more likely to write out of a correctly scoped answer",
        [
            (
                CAPS,
                "  'the-agents-here-your-reach-admits':\n"
                "    'This counts the agents this app holds that your own grant lets you start a conversation as, and your grant reaches them by a rule rather than by naming them — so it is not a count of what this app holds, and it moves as agents are created. Anything reported beside it as a name this app holds no agent for comes from the names your grant does carry, because a rule carries none.',",
                "  'the-agents-here-your-reach-admits':\n"
                "    'This counts every agent this app holds.',",
            )
        ],
    ),
]
