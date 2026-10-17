"""538 · A name the app mints for itself.

⛔ **`537` F5, measured rather than proposed:** *"Every identity the app mints for ITSELF gets
`displayName: null`."* A spawn target is minted *"having said NOTHING of the CALLER's"*, a launch
*"says NOTHING about the three facts a creation says"*, and the only two doors that ever write one
are a person at `NewAgent` and an agent passing the OPTIONAL `display_name` to `create_agent`.

🔴 **So {@link PROJECT_MANAGER_PROFILE_ID} — an identity this app brings into being to hold
BroBot's own seeded grant — had no name**, `agentName` fell through to `profileLabel`, and `537`'s
repair (every surface asking the app's one naming function) got back the bare slug.

> **the person:** *"the 'project manager' messages say **claude**. it's better if they say
> **Project Manager**."*

## ⚑ The property

> **An identity this app brought into being has a name a person can read, and it is the SAME word
> on every surface that names it.**

## 🔴 The three decisions these rows guard, and each is a refusal as much as a repair

 1. **WHERE the seed is resolved.** At `mintIdentity`'s two *the app is minting for ITSELF* call
    sites — a launch, and the grant-target loop — and **never inside `writeIdentityRow`**, which
    the creation door also goes through. `433` settled the same question one column over: at that
    door a `null` is a person who cleared the box, and `339`'s `.nullable()` ruling makes *absent*
    and *explicitly null* one value.
 2. **`default` is deliberately NOT in the table.** `profileLabel`'s hard-coded pair is not a
    second answer to this question — it is the answer for a caller with **no roster**, which a row
    in a database cannot reach. `SEEDED_PROVIDERS` refused the same shape first: *"A seed equal to
    `RuntimeScreen`'s `DEFAULT_PROVIDER` is not a seed; it is a backfill. It would be invisible at
    every surface, it could not be measured."*
 3. **`create_agent`'s `display_name` stays OPTIONAL.** A required argument would be a rail on ONE
    provider and a suggestion on the other: Claude's SDK parses arguments against the schema
    BEFORE the handler runs, so an omission would be refused by the transport and this app's door
    would never run — argument shape ABOVE the standing wall, which HO-031 §2.5 forbids and `445`
    measured the cost of. Codex hands the arguments over unparsed, so a `required` there is
    enforced by nothing.

## ⛔ What this table does NOT cover

 1. **A migration or a back-fill.** There is none, on the person's own withdrawal of the constraint that
    stopped `537`: *"we will again do a new install and test from scratch so no need for backwards
    compatibility."* The absence is asserted in `a-name-the-app-mints-for-itself.test.ts` §4 over
    the shipped SQL; no row here edits a `.sql` file.
 2. **`NewConversation`'s literal `who="BroBot"`.** The front door, where no identity has been
    chosen — reported as a finding, and `535` is drawing that surface.
 3. **The four surfaces still asking `profileLabel` directly.** `SessionInfo`,
    `ResumableSessions`, `SessionShelf` and `NewAgent` — reported, not repaired; the brief's scope
    is *giving `agentName` something better to return, not changing who asks it*.
## 🔴 584 · SIX ROWS RETIRED — the table this file is about no longer exists (`HO-078` §1, §5)

⛔ **`SEEDED_DISPLAY_NAMES` and `seededDisplayNameFor` are DELETED.** `HO-078` §1 retired the one
identity they named — the pre-made project manager — and `HO-078` §5 replaced the one-row seed with
a generator, `apps/desktop/src/shared/human-names.ts`.

⚑ **The PROPERTY `537` F5 asked for survives whole and is measured by `584`'s own table**: every
identity this app mints for itself has a name a person can read.

- ⚠️ **`M1`, `M2`, `M3`, `M4`** mutated the table and its lookup. **The subject is gone**; the fold
  they protected moved into `aNameForANewAgent`, where `584 M5` and `584 M6` carry it.
- ⚠️ **`M7`** mutated `mintIdentity`'s grant-target loop, which `HO-078` §1 left unreachable — see
  `409`'s own note and `a-true-mutation-measures-nothing`.
- 🔴 **`M10` · *`create_agent` REQUIRES a display name*** — ⛔ **the tool advertises no such field at
  all now.** `HO-078` §5: *"The app assigns the name. The agent does not choose it and does not
  ask."* ⚑ `584 M8` is its successor: the defect is the field COMING BACK, not its being optional.

⚑ **`M6` is re-anchored and not retired** — a LAUNCH that stops resolving a name is still `537` F5.
"""

IPC = "apps/desktop/src/shared/runtime-ipc.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
SHEET = "apps/desktop/src/renderer/src/components/StartAsAgent.vue"

THE_SEED = (
    "  {\n"
    "    slug: PROJECT_MANAGER_PROFILE_ID,\n"
    "    displayName: 'Project Manager',\n"
)

# ⚑ **Re-anchored by `584`, not retired** (`HO-078` §5). ⛔ The one-row seed became a GENERATOR —
# `human-names.ts` — so the LAUNCH resolves `nameForANewIdentity` instead of a table lookup. ⚠️
# **M6's subject is unchanged and is the one this file was written for**: a launch that stops
# resolving a name leaves every identity this app mints for itself nameless, which is `537` F5.
THE_LAUNCH = "      displayName: nameForANewIdentity(profileSlug),"
THE_TARGET = "        displayName: seededDisplayNameFor(target),"

MUTATIONS = [
    # ── §1 · the table itself ─────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 `main`'s BEHAVIOUR, REPRODUCED WHOLE · the table is empty, so every seam this "
        "dispatch built is still there and answers `null` — the project manager comes into being "
        "nameless, `agentName` falls through to `profileLabel`, and every surface `537` pointed at "
        "the one naming function reads back the bare slug",
        [(IPC, THE_SEED + "    why:", "  {\n    slug: 'nobody',\n    displayName: 'Nobody',\n    why:")],
    ),
    (
        "M2 · ⛔ the seed names `default` instead · the entry §3 refuses, because `profileLabel` "
        "and `agentName` already answer *BroBot (default)* for that slug WITH a roster and WITHOUT "
        "one — a row invisible at every surface, which is `SEEDED_PROVIDERS`' own definition of a "
        "backfill rather than a seed",
        [(IPC, "    slug: PROJECT_MANAGER_PROFILE_ID,\n    displayName: 'Project Manager',",
          "    slug: DEFAULT_PROFILE_ID,\n    displayName: 'BroBot (default)',")],
    ),
    (
        "M3 · ⚠️ the seeded word IS the slug · a name equal to what the fallback already answers "
        "changes nothing a person could see, so the column is written for symmetry and measured by "
        "nothing — `SEEDED_PROVIDERS`' *\"it would be invisible at every surface\"* arriving in the "
        "new table",
        [(IPC, "    displayName: 'Project Manager',", "    displayName: PROJECT_MANAGER_PROFILE_ID,")],
    ),
    (
        "M4 · ⛔ the lookup stops FOLDING · `Project-Manager` and `project-manager` are one identity "
        "(238) and this leaves whichever spelling a launcher happened to use nameless — the same "
        "defect `seededGrantFor` and `seededProviderFor` each name in their own docblock",
        [(IPC,
          "export function seededDisplayNameFor(profileSlug: string): string | null {\n"
          "  const folded = foldProfileName(profileSlug)\n"
          "  return SEEDED_DISPLAY_NAMES.find((seed) => seed.slug === folded)?.displayName ?? null\n"
          "}",
          "export function seededDisplayNameFor(profileSlug: string): string | null {\n"
          "  return SEEDED_DISPLAY_NAMES.find((seed) => seed.slug === profileSlug)?.displayName ?? null\n"
          "}")],
    ),
    # ── §2 · where the seed is resolved ───────────────────────────────────────────────────────
    (
        "M5 · 🔴 THE `433` DEFECT, ONE COLUMN OVER · the seed moves INSIDE `writeIdentityRow`, so "
        "the CREATION door resolves it too — a person who left the name box empty is answered with "
        "a word they declined, and afterwards their answer is indistinguishable from one they made",
        [(STORE, "      said.displayName,", "      said.displayName ?? seededDisplayNameFor(profileSlug),")],
    ),
    (
        "M6 · ⛔ a LAUNCH stops resolving it · only BroBot's grant-target loop seeds a name, so a "
        "conversation opened as the project manager DIRECTLY — the other door that brings that row "
        "into being — mints it nameless, and which door ran first decides what a person reads",
        [(STORE, THE_LAUNCH, "      displayName: null,")],
    ),
    (
        "M7 · ⛔ the grant-target loop mints its target on the MINTER's name · an identity BroBot "
        "brings into being to hold a grant is called whatever BroBot is called, which is the app "
        "naming somebody else's agent — `433 M10`'s shape, on the column `538` added",
        [(STORE, THE_TARGET, "        displayName: seededDisplayNameFor(profileSlug),")],
    ),
    # ── §3 · the one naming function, and the surfaces that ask it ────────────────────────────
    (
        "M8 · 🔴 `agentName` stops preferring the ROSTER · the older function answers first, so a "
        "display name a person typed AND one this app seeded are both invisible — `449`'s whole "
        "repair inverted, and the reason a seed needs the order asserted rather than assumed",
        # ⚑ **671 · anchor corrected in place** — the fallback is folded (`667` G5a), so it is handed
        # `slug`. Subject unchanged: the roster stops being preferred. Re-verified RED alone.
        [(IPC, "  return named ?? profileLabel(slug)", "  return profileLabel(slug)")],
    ),
    (
        "M9 · ⛔ the second launcher door goes back to the SLUG · `537` F6 restored, so an identity "
        "somebody named reads one way on the sheet that opens a conversation as it and another way "
        "on every surface that then draws that conversation",
        # ⚠️ **Anchored on the wrapped form prettier produced**, not on the one-line call — a
        # census of the formatter is what `429 M15` paid for (`a-regex-inside-a-template-literal`'s
        # sibling, one artefact over).
        [(SHEET,
          "const who = computed(() =>\n"
          "  agentName(props.profileSlug, agents.identities.value?.identities ?? null),\n"
          ")",
          "const who = computed(() => props.profileSlug)")],
    ),
    # ── §4 · the decision about the tool ──────────────────────────────────────────────────────
    (
        "M10 · 🔴 `create_agent` REQUIRES a display name · §3.3 reversed: on Claude the SDK refuses "
        "the call before this app's door runs, so a model that omitted it meets a shape error where "
        "the real rail may have been `may-not-create-agents` — argument shape above the standing "
        "wall, which is HO-031 §2.5's ordering and `445`'s measured confusion",
        [(TOOLS,
          "        display_name: z\n          .string()\n          .optional()\n",
          "        display_name: z\n          .string()\n")],
    ),
]
