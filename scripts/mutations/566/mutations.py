"""566 · The Tools register.

🔴 **One property, and it is a REFUSAL as much as a drawing.**

> ⚑ **`566` §1:** *A person can see every external server this app has registered, and what each
> one is* — ⛔ *without being told anything the app has not measured.*

## ⛔ A · the adapter `564` said was missing (`M1`–`M6`)

⚠️ **`564`: *"`ToolRegistryView` … needs an adapter for safe fields."*** ⚑ Every row here attacks
{@link registeredServers} or the words beside it, and they are in one group because the fold is one
function that answers five questions about each row.

 - **`M1`** — an `'everyone'` row is COUNTED, so a server every agent can use reads *granted to
   nobody*. ⛔ The most likely wrong repair, because the field is a number on four rows out of five.
 - **`M2`** — the count stops filtering, so every row reads the whole roster.
 - **`M3`** — the two reach sentences are swapped, which is `566` §4.1 answered backwards.
 - **`M4`** — the roster is re-sorted, so *which came first* gets a second answer in the renderer.
 - **`M5`** — zero loses its own words and becomes `Granted to 0 identities`.
 - **`M6`** — `Registered` loses its verb and the line becomes a bare duration.

## 🔴 B · §4.2 — said once, and said by the PROVIDER (`M7`–`M10`)

⛔ **The whole of `566` §4.2 is that this app composes none of these words.** ⚠️ Three of the four
rows below are ways to compose one anyway, and each of them compiles and reads well.

 - **`M7`** — `unwired` is read as handing them over, so the page says every provider does.
 - **`M8`** — the reason is replaced by a sentence this app wrote. ⚑ **The row the brief is really
   about**: `524` refused exactly this and said why — *"a second copy of `HO-042` §3's sentence is a
   second authority on it."*
 - **`M9`** — the declared note is discarded for the fallback, so `available` says a generic thing
   where the table said a specific one.
 - **`M10`** — a provider the table did not answer for gets a fabricated standing instead of being
   omitted (`086`).

## ⚠️ C · the page, and the three things it must not imply (`M11`–`M16`)

 - **`M11`** — the count is drawn before the read lands, so *not asked* renders as *asked and
   empty*.
 - **`M12`** — the empty sentence is typed into the template again, which is `516`'s own defect: the
   copy that drifted was the copy that was written twice.
 - **`M13`** — the address gets the rail's clamp back. 🔴 **`566` §5.3's row**, and the only one in
   this table that no string assertion can kill.
 - **`M14`** — reach is drawn only for the exception, so *everyone's* and *this build could not read
   the column* become one silence.
 - **`M15`** — the registration sheet's withdrawn sentence is put back verbatim.
 - **`M16`** — the capability sheet's former pointer is put back; this row is retired now that
   the destination is Settings → Tools. Its replacement is M21.

## ⛔ D · the destination (`M17`–`M20`)

 - **`M17`** — the former Tools reservation is removed; the current Settings reservation is M22.
 - **`M18`** — the former Tools rail row asks for a neighbour; the Settings rail row is M23.
 - **`M19`** — the palette row is gone.
 - **`M20`** — the former Tools row stops marking itself; the Settings rail row is M24.

## The Settings destination after Tools moved inside it (M21–M24)

 - **`M21`** — the capability sheet points at the removed Tools sidebar row instead of Settings → Tools.
 - **`M22`** — Settings leaves the list of reserved places, so its destination loses its name.
 - **`M23`** — pressing Settings asks to open a different destination.
 - **`M24`** — the Settings row no longer marks itself as the selected place.

## ⚠️ E · what this table does NOT cover, and why there is no row for it

 1. ⛔ **Moving `if (place.value === 'tools')` below the `projectId` test in `useSurface`.**
    `projectId` already answers `null` for every reserved word, so both orders give the same verdict
    at every input — **a row whose replacement changes no outcome reports as a SURVIVOR**
    (`a-mutation-that-changes-nothing-reports-as-a-survivor`). ⚑ `M22` attacks the reservation
    itself, which is the half that decides anything.
 2. ⛔ **The wiring census in `the-tools-register.test.ts` §4.** A mutation on a census is invisible
    to that census (`a-mutation-on-a-census-is-invisible-to-that-census`); the rows above attack the
    four SITES it reads, which is what makes the census worth having.
 3. ⛔ **`516`'s registration flow.** `566` changed one paragraph in `ExternalMcpRegistry.vue` and
    nothing else in it; `516`'s own table owns the door, and a copy here would make one defect kill
    two tables.
 4. ⛔ **The `now` sampling.** `props.now` versus a live minute is a JUDGEMENT argued in
    {@link registeredWords}, and both readings are true of a registration's age at every input this
    app can produce — the same no-op shape as item 1.
"""

FOLD = "apps/desktop/src/renderer/src/lib/the-servers-this-app-registered.ts"
PAGE = "apps/desktop/src/renderer/src/components/ToolsRegister.vue"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
SURFACE = "apps/desktop/src/renderer/src/composables/useSurface.ts"
PALETTE = "apps/desktop/src/renderer/src/lib/command-palette.ts"
SHEET = "apps/desktop/src/renderer/src/components/ExternalMcpRegistry.vue"
CAPS = "apps/desktop/src/renderer/src/components/CapabilitiesSheet.vue"

GRANTED = """    grantedTo:
      server.reach === 'everyone'
        ? null
        : roster.filter((identity) => identity.externalMcpServerIds.includes(server.id)).length,"""

REACH_SAYS = (
    "    reachSays: server.reach === 'everyone' ? EXTERNAL_MCP_EVERYONE : EXTERNAL_MCP_RESTRICTED,"
)

SAYS = (
    "        says:\n"
    "          status.state === 'available'\n"
    "            ? (status.note ?? A_PROVIDER_THAT_SAID_ONLY_YES)\n"
    "            : status.reason,"
)

COUNT_GATE = '            v-if="store.loaded.value && !store.loadError.value"\n'

ADDRESS_RULE = "  overflow-wrap: anywhere;\n  white-space: pre-wrap;"

GO_TOOLS_ROW = (
    "  commands.push({\n    id: 'go-tools',\n    // ⛔ The rail's noun (`154`), which is the one word both surfaces use — see `SideRail`'s row.\n    title: 'Tools',\n    // ⚑ **The palette's `detail` is the sentence the rail row does NOT carry.** `EXT-008` §5 keeps\n    // explanatory prose out of the navigation column; a palette row is a search result and has to\n    // say what it opens, which is the same argument `go-sessions` above already rests on.\n    detail: 'The external MCP servers registered on this machine',\n    group: 'go',\n    keywords: ['mcp', 'server', 'servers', 'external', 'registry', 'register', 'add server'],\n    action: { kind: 'go', place: 'tools' },\n  })\n"
)

# 🔴 **570 · MOVED, and relay 2 said to look at this one first and not batch it.** `570` added a
# SECOND destination to the same literal — `'team'` — so the anchor's bytes changed while the
# subject, the trap `useSurface.ts` writes down four lines above this list, did not move at all.
# ⛔ **Corrected in place and re-verified RED**, never retired
# (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
# ⚑ **572 · the list went multi-line when `'projects'` joined it**, so both halves of `M17` are
# written as the file actually holds them. ⛔ **Re-anchored, not retired**: the subject is the word
# `'tools'` leaving `RESERVED_PLACES`, and it is still there to leave.
# ⚑ **ANCHOR CORRECTED IN PLACE BY 606, not retired.** ⛔ `EXT-008` §3 split Home into two
# destinations and both words had to be RESERVED in the same commit, for the reason the sentence
# above this list gives: anything not on it is read as a project id. ⚠️ **The SUBJECT of `M17` is
# untouched** — it still removes `'tools'` and still asks whether the rail's own destination opens
# `ProjectWorkspace` for a project called `tools`. ⛔ `correct-a-stale-mutation-anchor-dont-retire-it`,
# and the row was re-verified RED by hand after the correction.
# ⚑ ANCHOR CORRECTED IN PLACE BY 701 — `'kept-open'` was reserved after `'reading'`; the defect
# planted is unchanged: `'tools'` leaves the list.
RESERVED = (
    "export const RESERVED_PLACES = [\n"
    "  'home',\n"
    "  'waiting',\n"
    "  'away',\n"
    "  'new',\n"
    "  'sessions',\n"
    "  'reading',\n"
    "  'kept-open',\n"
    "  'tools',\n"
    "  'team',\n"
    "  'projects',\n"
    "] as const"
)
RESERVED_WITHOUT_TOOLS = (
    "export const RESERVED_PLACES = [\n"
    "  'home',\n"
    "  'waiting',\n"
    "  'away',\n"
    "  'new',\n"
    "  'sessions',\n"
    "  'reading',\n"
    "  'kept-open',\n"
    "  'team',\n"
    "  'projects',\n"
    "] as const"
)

MUTATIONS = [
    (
        "M1 · 🔴 **AN EVERYONE ROW IS COUNTED** · the `null` arm goes, so a server every agent can "
        "use reads *Granted to nobody yet* — ⛔ and on a database that kept `0033`'s backfilled "
        "grants it reads a number instead, which is two wrong answers from one reading. ⚑ The most "
        "likely wrong repair in this file: the field is a number on every other row",
        [
            (
                FOLD,
                GRANTED,
                "    grantedTo: roster.filter((identity) =>\n"
                "      identity.externalMcpServerIds.includes(server.id),\n"
                "    ).length,",
            )
        ],
    ),
    (
        "M2 · ⛔ the count stops FILTERING · every restricted row reads the size of the whole "
        "roster, so *granted to 3 identities* is a fact about how many identities exist",
        [
            (
                FOLD,
                "        : roster.filter((identity) => identity.externalMcpServerIds.includes(server.id)).length,",
                "        : roster.length,",
            )
        ],
    ),
    (
        "M3 · 🔴 **§4.1 ANSWERED BACKWARDS** · the two reach sentences are swapped, so the register "
        "tells a person their open server is somebody's speciality and their exclusive one is "
        "everyone's. ⚠️ Both rows still draw, both read plausibly, and the only per-server decision "
        "a person makes is inverted",
        [
            (
                FOLD,
                REACH_SAYS,
                "    reachSays: server.reach === 'everyone' ? EXTERNAL_MCP_RESTRICTED : EXTERNAL_MCP_EVERYONE,",
            )
        ],
    ),
    (
        "M4 · ⚠️ the renderer RE-SORTS the roster · the store answers `ORDER BY registered_at, name` "
        "and this gives *which came first* a second answer, free to disagree with the sheet beside "
        "it the day two rows share a second",
        [
            (
                FOLD,
                "  return identities.externalMcpServers.map((server) => ({",
                "  return [...identities.externalMcpServers]\n"
                "    .sort((a, b) => a.name.localeCompare(b.name))\n"
                "    .map((server) => ({",
            )
        ],
    ),
    (
        "M5 · ⛔ zero loses its own words · a restricted server nobody was granted reads *Granted to "
        "0 identities*, which is a number rather than the state it names — ⚑ and that state is the "
        "one thing on this page a person can act on",
        [
            (
                FOLD,
                "  if (granted === 0) return 'Granted to nobody yet'\n",
                "",
            )
        ],
    ),
    (
        "M6 · ⚠️ the registration line loses its verb · `3d ago` on a row that also carries a grant "
        "count is a duration with no subject, and the reader has to guess which fact it is about",
        [(FOLD, "  return `Registered ${agoWords(registeredAt, now)}`", "  return agoWords(registeredAt, now)")],
    ),
    (
        "M7 · 🔴 **`unwired` READS AS HANDED OVER** · `handsThemOver` asks whether the provider is "
        "not `absent`, so a capability WE have not built reports as one that works — ⛔ which is "
        "`HO-063` §6's *his tools reach BroBot and nothing he delegates to*, denied by the surface "
        "that exists to say it",
        [
            (
                FOLD,
                "        handsThemOver: status.state === 'available',",
                "        handsThemOver: status.state !== 'absent',",
            )
        ],
    ),
    (
        "M8 · 🔴 **THE APP COMPOSES THE SENTENCE** (§4.2) · the provider's own reason is replaced "
        "by one written here, which is precisely what `524` refused: *\"a second copy of `HO-042` "
        "§3's sentence is a second authority on it.\"* ⚑ It reads well, it is true today, and it "
        "goes false the day the entry moves to `available` with nothing red",
        [
            (
                FOLD,
                SAYS,
                "        says:\n"
                "          status.state === 'available'\n"
                "            ? (status.note ?? A_PROVIDER_THAT_SAID_ONLY_YES)\n"
                "            : 'This provider cannot reach an external server yet.',",
            )
        ],
    ),
    (
        "M9 · ⛔ the declared NOTE is discarded · every available provider says the fallback, so a "
        "table that took the trouble to describe what it does with a server is drawn as though it "
        "had only said yes",
        [
            (
                FOLD,
                "            ? (status.note ?? A_PROVIDER_THAT_SAID_ONLY_YES)",
                "            ? A_PROVIDER_THAT_SAID_ONLY_YES",
            )
        ],
    ),
    (
        "M10 · ⛔ a provider the table never answered for is GIVEN a standing · `086`: *nobody "
        "asked* becomes *this provider hands them over*, invented for a key whose entry does not "
        "exist",
        [
            (
                FOLD,
                "    if (status === undefined) return []",
                "    if (status === undefined)\n"
                "      return [\n"
                "        {\n"
                "          provider,\n"
                "          name: providerName(provider),\n"
                "          handsThemOver: true,\n"
                "          says: A_PROVIDER_THAT_SAID_ONLY_YES,\n"
                "        },\n"
                "      ]",
            )
        ],
    ),
    (
        "M11 · ⛔ the count is drawn BEFORE the read lands · `086`, one surface over from the rail "
        "section this page replaced: *not asked* and *asked and empty* are two facts, and a `0` "
        "while the door is still open claims the second",
        [(PAGE, COUNT_GATE, "")],
    ),
    (
        "M12 · 🔴 **THE SENTENCE IS TYPED INTO THE TEMPLATE AGAIN** · which is `516`'s own defect "
        "reproduced: the copy that went false was the copy that existed twice, and `524` corrected "
        "one of them. ⚑ The words are identical today, so only a census over the source can see it",
        [
            (
                PAGE,
                "            {{ EXTERNAL_MCP_NONE_YET }}",
                "            No external MCP servers yet. Every agent can use one unless you register it as\n"
                "            restricted.",
            )
        ],
    ),
    (
        "M13 · 🔴 **§5.3 · THE ADDRESS GETS THE RAIL'S CLAMP BACK** · `overflow: hidden; "
        "text-overflow: ellipsis; white-space: nowrap`, which is what `SideRail` and "
        "`ExternalMcpRegistry` both still do to this exact string. ⛔ **No string assertion in this "
        "repository can kill this row** — `textContent` is identical either way — and that is the "
        "whole argument for `531`'s sensor",
        [
            (
                PAGE,
                ADDRESS_RULE,
                "  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;",
            )
        ],
    ),
    (
        "M14 · ⛔ reach is drawn only for the EXCEPTION · a list where *everyone's* is silence "
        "cannot tell it apart from a row this build could not read, which is the state "
        "`foldExternalMcpReach` produces for an unreadable column — ⚑ and it is the shape `524` "
        "argued against on the registration sheet's own rows · killed by `the-tools-register.dom.test.ts`",
        [
            (
                PAGE,
                # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the reach span gained the shared chip class when Tools took the shared page styles; the plant still draws reach only for restricted servers, so an everyone server says nothing
                "                <span class=\"reach bb-chip\" :data-cy=\"`tools-reach-${server.name}`\">{{",
                "                <span\n                  v-if=\"server.reach === 'restricted'\"\n                  class=\"reach bb-chip\"\n                  :data-cy=\"`tools-reach-${server.name}`\"\n                  >{{",
            )
        ],
    ),
    (
        "M15 · 🔴 **THE WITHDRAWN SENTENCE, PUT BACK** · `main`'s behaviour at `70c57d46`: the "
        "registration sheet tells a person a registration grants nobody, eight lines above a "
        "pre-selected *available to every identity* radio. ⛔ `HO-048` §1 withdrew it at `524` and "
        "this copy survived that sweep",
        [
            (
                SHEET,
                "          {{ EXTERNAL_MCP_NONE_YET }}",
                "          No servers are registered yet. Add one below — it grants nobody until you tick it\n"
                "          on an agent's own sheet.",
            )
        ],
    ),
    (
        "M16 · ⛔ the capability sheet points at a rail section that is GONE · *Add one from "
        "External tools in the rail*, which `566` §5.4 asked about by name. ⚠️ The assertion that "
        "already covered this paragraph reads the sheet's own string, so only a reader that takes "
        "the label off the RAIL can see it (`a-pointer-clause-is-a-claim`)",
        [
            (
                CAPS,
                # ⚑ **678 re-anchored and the ROW is unchanged** — *"in the rail"* became *"in the
                # sidebar"* (a word nothing is labelled, `110`); the row still names the section `566` removed.
                "          No external MCP servers are registered yet. Add one from Tools in the sidebar — a local\n"
                "          address, registered once for the whole app.",
                "          No external MCP servers are registered yet. Add one from External tools in the rail\n"
                "          — a local address, registered once for the whole app.",
            )
        ],
    ),
    (
        "M17 · 🔴 **MAIN'S BEHAVIOUR, PUT BACK** · the word leaves `RESERVED_PLACES`, so `place: "
        "'tools'` is read as a project id and the rail's own destination opens `ProjectWorkspace` "
        "for a project called `tools` — ⛔ the trap `useSurface.ts` writes down four lines above the "
        "list and which nothing tested until now · killed by `the-tools-register.test.ts` (named by W4.78)",
                # ⚑ **The word this row removes is still `'tools'`** — `'team'` and, since `572`,
                # `'projects'` stay, so the mutant is a tree in which one reserved destination
                # opens a project and two others do not, which is a sharper world than main's was.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives:
        # 'tools' must stay in `RESERVED_PLACES`, or place 'tools' routes as a project called tools.
        # D-017b removed `'kept-open'` from the list, so the old multi-line anchor (which listed
        # `'kept-open'`) no longer matches; the current list is home, waiting, away, new, sessions,
        # reading, tools, team, projects. The plant drops only `'tools'`; it type-checks the same
        # way as before, and vitest does not type-check.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: a
        # rail destination's word must be in RESERVED_PLACES or its place is unreachable. D-016
        # removed the project-id fallback, so the consequence is now the launcher instead of
        # ProjectWorkspace, but the-tools-register.test.ts still asserts the word is reserved. The
        # anchor is rewritten to the seven-word list and the plant drops only 'tools'.
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — 2caad6d2 appended 'providers' to the reserved places; 'tools' is still reserved (W4.78 reviewer disagreed with retiring it)
            (SURFACE, "  'tools',\n  'team',\n  'providers',\n] as const", "  'team',\n  'providers',\n] as const"),
        ],
    ),
    (
        "M18 · ⚠️ the rail row asks for a NEIGHBOURING destination · it draws identically, reads "
        "identically and marks itself identically; the only thing that changes is where a person "
        "lands, which is the one fact a rail row carries",
        [(RAIL, "@click=\"emit('go', 'tools')\"", "@click=\"emit('go', 'sessions')\"")],
    ),
    (
        "M19 · ⛔ the palette row is GONE · a destination reachable only by finding it in the rail, "
        "which is the state `104`'s *first-run distinct from no-match* rests on not being true. "
        "⚠️ **The whole `commands.push` block, so the file still parses** — a row that breaks the "
        "syntax is killed by every suite that imports the module and has measured none of them "
        "(`a-true-mutation-measures-nothing`, the same failure in the other direction). Found by "
        "verifying this row on its own: it came back RED with zero named assertions",
        [(PALETTE, GO_TOOLS_ROW, "")],
    ),
    (
        "M20 · ⛔ the Tools row stops marking itself · every other destination in this rail says "
        "when it is the one you are on, and a row that never does is a person who cannot tell "
        "where they are from the navigation column",
        [(RAIL, ":class=\"{ active: props.place === 'tools' }\"\n          ", "")],
    ),
    (
        "M21 · the capability sheet points at the removed Tools sidebar row instead of the "
        "Settings → Tools tab",
        [(
            CAPS,
            "          No external MCP servers are registered yet. Add one from Settings → Tools — a local\n"
            "          address, registered once for the whole app.",
            "          No external MCP servers are registered yet. Add one from Tools in the sidebar — a local\n"
            "          address, registered once for the whole app.",
        )],
    ),
    (
        "M22 · Settings leaves the reserved destinations, so a word that names the page no "
        "longer belongs to the page set",
        [(
            SURFACE,
            "  'providers',\n  'settings',\n] as const",
            "  'providers',\n] as const",
        )],
    ),
    (
        "M23 · the Settings rail row asks for a neighbouring destination while still looking "
        "like Settings",
        [(RAIL, "@click=\"emit('go', 'settings')\"", "@click=\"emit('go', 'sessions')\"")],
    ),
    (
        "M24 · the Settings rail row stops marking itself as the selected destination",
        [(RAIL, ":class=\"{ active: props.place === 'settings' }\"", "")],
    ),
]
