"""734 · the queue names agents, not folders — `732` F-1, `732` F-5.

⛔ **Ordered by the PM** (the closing wave): `732` F-1 (under R41, a person's questions, decisions,
proposals and the digest named a conversation by its FOLDER — `nameForAPerson`, `398` — and in the
default folder every one of them read *brobot-workspace*) and `732` F-5 (`stop_unanswered` named its
asker by conversation only).

## ⚠️ What a row here measures

 * ⚑ **M1–M3 are the naming** — a conversation with an identity is named by its AGENT (M1), by the
   name a person gave it and not the slug (M2), and one with NO identity keeps its folder rather than
   the band's category (M3) — killed by `the-queue-names-agents-not-folders.test.ts` §1.
 * ⚑ **M4–M7 are the four readers** — each one reached through the one namer: questions (M4),
   decisions (M5), proposals (M6) and the digest (M7), each killed by its own test in §1.
 * ⚑ **M8–M10 are `732` F-5** — `stop_unanswered` carries the asker's identity (M8), only an
   agent's (M9: a person's ask handed the stopped worker as its asker — the store's door strips it
   from the persisted copy, so only the LIVE row shows it, and §2.2 reads that row), and the store's
   door bounds it on replay (M10).
 * ⚑ **M11–M12 are the roster** — read once per answer and not once per name (M11, §1.8), and the
   digest names its agents over the roster read it already made for a proposer (M12, §1.4).

## ⛔ What has NO row here, and why

 * ⚠️ **The identity read at the ask rather than two seconds later, at the publish** — equivalent
   under every input: the row carries the SLUG, which a rename does not move, and nothing re-binds a
   conversation to another identity inside the bound.
 * ⚠️ **The display name frozen onto the row** — `732 M10`, re-anchored by this dispatch into the
   one builder, where it now freezes the name onto `stop_unanswered` as well.
 * ⚠️ **The builder's guard** (`if (actor.who !== 'an-agent') return {}`) — measured an EQUIVALENT:
   a first row deleted it and SURVIVED. A person's ask has no `agent`, and `identityOf(undefined)`
   answers `null` rather than throwing, so the builder returns `{}` either way. ⚑ The guard stays as
   the positive statement *only an agent has an identity here*, and it saves a store read.
 * ⚠️ **`732` F-6 — what tells two conversations of one identity apart.** The PM closed it without
   work (*"the row keeps each conversation's id"*), so this dispatch adds no field and has no row:
   §1.7 pins two parents' live Bobs as two queue rows reading one sentence, each with its own
   `request.askedBy`, and §1.7b the digest's claim lines keeping their conversation.
 * ⚠️ **The prose rows** — docblocks, which no test reads (standing rule 19).
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
QUEUE = "the-queue-names-agents-not-folders.test.ts"

FOLDER_NAMER = "    const name = (id: string): string => this.folderOf(id)\n"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §A · the naming ───────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 `732` F-1 back · every conversation is named by its folder again, and in the default "
        f"one a person's queue reads *brobot-workspace* for every agent they have · killed by `{QUEUE}`",
        [(HOST, "    if (profile === null) return this.folderOf(sessionId)\n    return agentName(profile, identities())\n",
          "    return this.folderOf(sessionId)\n")],
    ),
    (
        "M2 · ⛔ the SLUG where the name goes · no roster, so *Bob* reads `worker-g` — R41's *never by "
        f"slug* · killed by `{QUEUE}`",
        [(HOST, "    return agentName(profile, identities())\n", "    return agentName(profile, null)\n")],
    ),
    (
        "M3 · ⛔ a conversation with NO identity says the band's category · a row a person must find "
        f"reads *an agent this app cannot name* instead of the folder it read before · killed by `{QUEUE}`",
        [(HOST, "    if (profile === null) return this.folderOf(sessionId)\n",
          "    if (profile === null) return AN_AGENT_THIS_APP_CANNOT_NAME\n")],
    ),
    # ── §B · the four readers ─────────────────────────────────────────────────────────────────────
    (
        f"M4 · 🔴 the QUESTIONS name by folder · *brobot-workspace waiting on you* · killed by `{QUEUE}`",
        [(HOST, "    const name = this.oneNamingPerAnswer()\n    // ⚑ **474 · ONE ledger read per asker",
          FOLDER_NAMER + "    // ⚑ **474 · ONE ledger read per asker")],
    ),
    (
        f"M5 · 🔴 the DECISIONS name by folder · *brobot-workspace waiting on you* · killed by `{QUEUE}`",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — decisionsForAPerson still
        # builds `name` from oneNamingPerAnswer() and hands `unread` (D-017's new skip-counting set)
        # straight to decisionsAwaitingAPerson unchanged; the naming rule itself was untouched by
        # this commit. Replacing `name` with a folder-keyed function still plants 'the DECISIONS
        # name by folder', e.g. *brobot-workspace waiting on you* instead of the agent's name.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: the
        # person's decision rows name the asking agent through the one naming per answer, never its
        # folder ('Bob waiting on you'). The surface is unchanged in decisionsForAPerson, except
        # that `onePlacementPerAnswer` is gone, so the old multi-line anchor no longer matches. The
        # plant is the same name-by-folder swap, anchored on the two-line prefix that is unique.
        [
            (HOST, '    const name = this.oneNamingPerAnswer()\n    const work = this.oneWorkReadPerAnswer()\n', '    const name = (id: string): string => this.folderOf(id)\n    const work = this.oneWorkReadPerAnswer()\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row plants folder-naming on the
        # PROPOSALS population of the queue. D-016a (bd70d693) says 'Proposals go end to end', and
        # `proposalsAwaitingAPerson` and the proposals half of the queue no longer exist in
        # runtime-host.ts. The rule for the surviving decisions population is held by 734 M5. Its
        # anchor is left stale, so the census records it retired.
        f"M6 · 🔴 the PROPOSALS name by folder · *brobot-workspace waiting on you* · killed by `{QUEUE}`",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — Same shape as M5 but for
        # proposalsForAPerson; the D-017 diff only inserted the `unread` set/comment between
        # `placement` and the store call, leaving `name` and the proposalsAwaitingAPerson call
        # itself untouched. Replacing `name` with the folder-keyed function still plants 'the
        # PROPOSALS name by folder'.
        [
            (HOST, "    const name = this.oneNamingPerAnswer()\n    const work = this.oneWorkReadPerAnswer()\n    const placement = this.onePlacementPerAnswer()\n    // 🔴 **D-017 · R8** — one set for the walk and this answer's own reads.\n    const unread = rowsUnreadOnce()\n    const walked = this.deps.store.proposalsAwaitingAPerson(unread)\n", "    const name = (id: string): string => this.folderOf(id)\n    const work = this.oneWorkReadPerAnswer()\n    const placement = this.onePlacementPerAnswer()\n    // 🔴 **D-017 · R8** — one set for the walk and this answer's own reads.\n    const unread = rowsUnreadOnce()\n    const walked = this.deps.store.proposalsAwaitingAPerson(unread)\n"),
        ],
    ),
    (
        "M7 · 🔴 the DIGEST names by folder · *Task #1, to brobot-workspace* and *brobot-workspace "
        f"reported…* · killed by `{QUEUE}`",
        [(HOST, "    const name = this.oneNamingPerAnswer(() => identities)\n", FOLDER_NAMER)],
    ),
    # ── §C · `732` F-5 — `stop_unanswered` says which agent asked ────────────────────────────────
    (
        "M8 · 🔴 `732` F-5 back · the unanswered stop names the asking conversation alone, and a "
        f"surface can say only *an agent* · killed by `{QUEUE}`",
        [(HOST, "      ...this.theIdentityThatAsked(asker),\n", "")],
    ),
    (
        "M9 · ⛔ a PERSON's unanswered Stop is written with an identity · the stopped worker is handed "
        "in as the asker, and the live window is told an agent asked — the stored copy is stripped, so "
        f"only the live row shows it · killed by `{QUEUE}`",
        [(HOST, "      ...this.theIdentityThatAsked(asker),\n",
          "      ...this.theIdentityThatAsked(\n        asker.who === 'an-agent' ? asker : { who: 'an-agent', agent: session.id },\n      ),\n")],
    ),
    (
        "M10 · ⛔ the replay bound skips `stop_unanswered` · an imported ledger puts any words where a "
        f"person will read a name · killed by `{QUEUE}`",
        [(STORE, "  if (event.type === 'work_interrupted' || event.type === 'stop_unanswered') {\n",
          "  if (event.type === 'work_interrupted') {\n")],
    ),
    # ── §D · the roster, once per answer ──────────────────────────────────────────────────────────
    (
        "M11 · ⛔ the roster is read once per NAME · an answer naming two agents reads it twice, on a poll that "
        f"runs every five seconds for the life of a window · killed by `{QUEUE}`",
        [(HOST, "    return () => (roster ??= this.deps.store.agentIdentities())\n",
          "    return () => (roster = this.deps.store.agentIdentities())\n")],
    ),
    (
        "M12 · ⛔ the digest's namer reads a roster of its own · two reads for one digest, beside the one "
        f"`agentCalled` already made (`734`'s review) · killed by `{QUEUE}`",
        [(HOST, "    const name = this.oneNamingPerAnswer(() => identities)\n",
          "    const name = this.oneNamingPerAnswer()\n")],
    ),
]
