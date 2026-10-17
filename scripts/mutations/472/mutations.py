"""472 · the band the room was missing — HO-024 criterion 22, and HO-027 §4's exit gate.

⛔ **What this table is aimed at.** `467` put the conversation roster on the wire and `472` drew it.
Every rule the drawing added is one a mutation can delete without breaking a type, and they fall
into five groups:

 1. **The forbidden sentence.** `452` §5.1: *"a conversation with nothing waiting on anybody
    produces no queue row at all"*, so **"nothing is running in this project" is the one sentence
    this surface must never say by accident**. ⚑ `M5`, `M6` and `M8` are the three ways a band with
    something to say comes to say that instead — an empty claimed on a walk that read nothing, an
    empty claimed on a word this build cannot spell, and a refusal drawn as a current list.
 2. **Which project the answer is ABOUT.** `M1` and `M14` are the two ends of one guard: a person
    can open project A and then project B inside one round trip, and without the stamp the kept
    last-good list is drawn under B's heading — the strongest false claim this band can make.
 3. **`421`, HO-023 §2.3 — the four lies in sequence.** `settleOrphanRuns` settles a crashed run to
    `idle`, so `idle` is what a live conversation and one a power cut ended three weeks ago both
    say. ⚑ `M3` keys the band on that column; `M2` and `M4` are the two ways a press this app has no
    verb for gets offered to a person.
 4. **One derivation per fact.** `M9` is `449`'s measured defect rebuilt — a second answer to *what
    is this identity called*; `M11` is a number from another project read as this one's; `M10` is
    the age detaching from the read it is *as of*.
 5. **The presses this band REFUSES to offer, and the address that replaces one.** ⛔ `M12` puts
    back the `reopen` arm review found — a press the host answers with a sentence that is false for
    a whole class of placed rows — `M22` draws a press on every row including the two this app has
    no verb for, and `M13`/`M20` delete or misdirect the address of the surface that CAN act on a
    recording.

⚠️ **Three rows are aimed at the SCREEN rather than the band**, and they earn their place: the
drawing is perfect and the band is empty for ever if the reading, the identities or what this window
holds stops arriving (`M21`), if the poll runs where nothing paints it (`M16`), or if the instant
every age is measured from is taken after the round trip instead of before it (`M18`).

⛔ **Evidence this table is honest about what it can reach.** Every row was applied alone, its own
killer file run, and the tree restored from bytes and hashed — the whole table has NOT been run
under the driver, so `CENSUS.md` records it `unrun` and no verdict is claimed here.

🔴 **The gate map** — which file kills which row:

| rows | killer |
|---|---|
| M1–M19 and M24, **except M20 and M21** | `apps/desktop/test/the-band-the-room-was-missing.test.ts` |
| M9 | **also** `apps/desktop/test/a-row-that-says-who-is-in-it.test.ts`, whose census went with it |
| M20, M21 | `apps/desktop/test/the-room-behind-the-door.render.test.ts` |
| M22, M23 | `apps/desktop/test/dom/the-room-behind-the-door.dom.test.ts` |

⚠️ **The map was wrong when it was first written and review caught it**: it read `M1–M13, M15–M19`,
which silently left M14 owned by nobody.

⚑ **What this table deliberately does NOT contain.** No row moves `ROSTER_EVERY_MS` to a literal:
the census assertion that refuses one is a source read, and a mutation on a source census is
invisible to that census (`a-mutation-on-a-census-is-invisible-to-that-census`). The rule is carried
by the alias itself, which `M17` deletes instead.
"""

# ⛔ **504 REVERSED HALF OF THIS TABLE'S §3, and `M12` is re-aimed rather than retired.**
#
# ⚑ **`472` refused the recording's press for ONE reason and said so:** *"the band cannot know
# whether a reopen would work — `closed-threads.ts`'s `gestureFor` has THREE arms for a recording,
# keyed on `resumeRefusal` and `hasTranscript`, and `ProjectConversation` carries neither."*
#
# 🔴 **`504` put both fields on the wire and repaired the defect underneath**, in that dispatch's
# own words: *"`SessionStore.find` is not *is this recorded* — its own docblock says it drops a row
# with no provider ref — and `reopenSession` read that as `not-recorded`, so a person was told
# *There is no recording of this conversation to reopen* about a conversation whose ledger this app
# is holding."* ⛔ So the premise `M12` rested on is gone and restoring its anchor would assert
# something the product now deliberately does.
#
# ⚠️ **The half that survives is what the row now carries**: a press must be DERIVED from the two
# fields and never asserted for the state. Same kind of kill, same site, `142`'s rule — correct,
# never delete. ⛔ **Its recorded RED was measured against the OLD text**, and re-running the row is
# the only thing that makes that verdict current.

ROSTER = "apps/desktop/src/renderer/src/lib/project-roster.ts"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
ROOM = "apps/desktop/src/renderer/src/components/ProjectWorkspace.vue"
TEAM_ROSTER = "apps/desktop/src/renderer/src/lib/team-roster.ts"
TAKING_OVER = "apps/desktop/src/renderer/src/lib/taking-over.ts"
THE_FOREST = "apps/desktop/src/renderer/src/lib/the-forest.ts"
TEAMWORKSPACE = "apps/desktop/src/renderer/src/components/TeamWorkspace.vue"

# ⚑ The `empty` arm whole, so a row can widen the claim without touching the two around it.
THE_ONE_REAL_EMPTY = (
    "    empty:\n"
    "      doubt === null &&\n"
    "      walk.walk === 'every-conversation-placed-in-that-project' &&\n"
    "      walk.rows.length === 0\n"
    "        ? NO_CONVERSATIONS_YET\n"
    "        : null,\n"
)

# ⚑ The screen's refusal arm, whole — the half that decides what a dropped call leaves on screen.
THE_REFUSAL = (
    "  roster.value = roster.value?.slug === asked ? { ...roster.value, answered: false } : null\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · which project the answer is about ──────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** D-016 deleted `project-roster.ts` and
        # the project room with it; the file-deleted anchor (`reading.slug !== input.forSlug`)
        # guarded a per-project reading drawn under a project heading. The commit says projects
        # 'stop being something a person or a model meets: … the project rooms, board, sheet and
        # picker' and the rewritten band test now holds only `openElsewhere` and the cadence, so
        # there is no project-keyed reading left to mis-attribute. Its anchor is left stale, so the
        # census records it retired.
        "M1 · 🔴 THE DEFECT · the reading's project is not compared with the surface's, so a list "
        "answered for the project a person just LEFT is drawn under the one they just opened. ⛔ Two "
        "rooms inside one round trip is an ordinary gesture, and the rows are wrong rather than "
        "missing — the strongest false claim this band can make",
        [(ROSTER, "  if (reading === null || reading.slug !== input.forSlug) return null",
          "  if (reading === null) return null")],
    ),
    (
        # ⚠️ **RETIRED, and an OPEN FINDING (landing D-016a, bd70d693):** the rule survives but
        # D-016a deleted the only test that pinned it, so no plant can go red until a test exists
        # again. The refutation is right that the rule survives. The same 'person moved while it was
        # in flight' guard sits at RuntimeScreen.vue:2025 (distil, digestWindowMs), :2154
        # (readWhoIsWorkingOnce, surface team), :2213 (readTheWork) and :2293 (readTheCast,
        # activeId). No test reads any of them: the only pin was the census over readTheRoomOnce in
        # the-band-the-room-was-missing.test.ts, which D-016a cut from 982 lines to 15, and a grep
        # of every test file for `asked !==` finds nothing. So a plant deleting :2025 or :2154 (the
        # two with no workRead/castRead sequence overlap) stays green, which makes this a lost pin
        # rather than a violated rule. The row can be re-anchored only once a census over those
        # reader bodies exists.
        "M14 · ⛔ the in-flight guard goes from the SCREEN · a slow answer for the project a person "
        "has LEFT lands and overwrites the reading, so the room they are standing in is thrown back "
        "to *Nothing has been read yet* and loses the list it already had. ⚠️ **The rows are never "
        "drawn under the wrong heading** — M1's guard in the fold is what stops that, and it is "
        "untouched here — so this row measures the SECOND half of the pair: a good list discarded "
        "by an answer about somewhere else. ⚑ The digest has this guard against `digestWindowMs` "
        "moving mid-read; `304` is what reaches it",
        # 🔴 **550 CORRECTED this anchor; it was NOT retired** (standing rule 27). That dispatch
        # gave the same screen a second per-room poll — `readTheDocuments`, band 4's — built to
        # `readTheRoom`'s shape on purpose, and the bare guard line then matched twice. ⛔ The
        # SUBJECT is exactly where it was; only the uniqueness of the bytes moved, so the anchor
        # carries the two comment lines above it, which name the roster's own answer. ⚠️ The row
        # was re-verified RED by hand against its killer after the correction —
        # `a-corrected-anchor-keeps-a-verdict-it-never-earned`.
        [
            (
                SCREEN,
                "  // ⚑ **The person moved while it was in flight.** The answer is about a room "
                "nobody is looking at;\n"
                "  // writing it would leave the next room's first frame holding this one's rows.\n"
                "  if (asked !== roomSlug.value) return\n",
                "  // ⚑ **The person moved while it was in flight.** The answer is about a room "
                "nobody is looking at;\n"
                "  // writing it would leave the next room's first frame holding this one's rows.\n",
            )
        ],
    ),
    # ── §2 · the forbidden sentence, and the three ways to say it by accident ───────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `RosterDoubt` arm
        # ('the-read-did-not-answer') lived in the deleted project-roster fold. The identical rule
        # on its living siblings (Work tab `work-given-out.ts`, documents) is already planted by
        # tables 508 (mutations/508 line 195) and 550, so a re-anchor would duplicate them. Its
        # anchor is left stale, so the census records it retired.
        "M5 · 🔴 a refusal is drawn as a CURRENT list · `434`'s finding deleted — the rows are kept, "
        "which is right, and nothing says they are the last answer rather than this one. ⛔ A band "
        "frozen at the minute the read died looks exactly like a band that is up to date, and "
        "everything placed since is missing with nothing saying so",
        [(ROSTER,
          "  const doubt: RosterDoubt | null = !reading.answered\n"
          "    ? 'the-read-did-not-answer'\n"
          "    : says === null\n"
          "      ? 'a-word-this-app-cannot-spell'\n"
          "      : null",
          "  const doubt: RosterDoubt | null = says === null ? 'a-word-this-app-cannot-spell' : null")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** Its defect is 'no such project' drawn
        # as 'no conversations here', keyed on the walk word
        # `every-conversation-placed-in-that-project`. Projects and their per-project walk are
        # removed by D-016 ('projects stop being something a person … meets'); the fold and its
        # `NO_CONVERSATIONS_YET` empty are deleted. Its anchor is left stale, so the census records
        # it retired.
        "M6 · 🔴 *no such project* becomes *no conversations here* · the walk word is not checked, "
        "so a slug this app holds no row for, and a store with no database at all, are both drawn "
        "as an empty PROJECT. ⛔ `453`'s whole register spent in one line, and `452` §5.1's "
        "forbidden sentence said out of two facts that are not about the project",
        [(ROSTER, THE_ONE_REAL_EMPTY,
          "    empty: walk.rows.length === 0 ? NO_CONVERSATIONS_YET : null,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The unspellable-walk-word doubt was
        # `project-roster.ts`'s `RosterDoubt`, deleted with the file. The same guard on the Work tab
        # and the documents list is carried by tables 508 and 550 (which plant the same `says ===
        # null` arm), so nothing here remains uncovered. Its anchor is left stale, so the census
        # records it retired.
        "M8 · ⛔ a walk this build cannot SPELL is drawn as a current list · `467` F7's ruling "
        "deleted: the preload CASTS, so a word from a newer build reaches this fold, `walkCovers` "
        "answers null, and the band draws its rows with nothing saying that the sentence describing "
        "what was read could not be read — and goes on to certify the project EMPTY on a question it "
        "could not name. ⚑ **Re-aimed twice and both aims are findings.** The first was a `!unspellable` "
        "guard on `empty` that was provably redundant (an unspellable word is not the one word that "
        "arm tests), so a mutation on it left every test green — "
        "`a-line-no-mutation-can-kill-is-not-carrying-its-rule`. The second aim was `stale`, a "
        "BOOLEAN that drew *this list did not answer just now* over a read that had answered "
        "perfectly well; review caught the false sentence, the boolean became {@link RosterDoubt}, "
        "and the guard came back reachable from both causes",
        [(ROSTER,
          "    : says === null\n"
          "      ? 'a-word-this-app-cannot-spell'\n"
          "      : null",
          "    : null")],
    ),
    # ── §3 · 421 · the gesture, and the two presses this app has no verb for ────────────────────
    (
        "M3 · 🔴 the band is keyed on the LEDGER's column · HO-023 §2.3's four lies in sequence, "
        "restored: `settleOrphanRuns` settles a crashed run to `idle`, so this offers *take it over* "
        "on every row a power cut left behind and calls a live conversation a recording",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # band must be keyed on the host's `running`, not the ledger's status column, because
        # settleOrphanRuns settles a crashed run to idle. The `hereIsOf(...)` call is now
        # `openElsewhere(row.running, held)` on the `const elsewhere` line, and the plant feeds it a
        # status-derived running value.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives:
        # where-it-is must be keyed on the host's `running`, never the ledger's `status`, because
        # `settleOrphanRuns` settles a crashed run to `idle`. `the-forest.ts` still calls
        # `openElsewhere(node.running, held)` on nodes that carry both fields (no other table plants
        # it), so the same status-derived plant goes there. The 'take it over' consequence in the
        # label is stale after D-017b, the cause is not.
        [
            (THE_FOREST, '    const elsewhere = openElsewhere(node.running, input.held.has(node.conversation))', "    const elsewhere = openElsewhere(\n      node.status === 'ended' || node.status === 'errored' ? 'not-running' : 'in-a-window',\n      input.held.has(node.conversation),\n    )"),
        ],
    ),
    (
        "M2 · ⛔ the window's own answer is ignored · `in-a-window` collapses to one word, so the "
        "conversation a person has open in THIS window is told it is *open in another window* and "
        "loses its press entirely. ⚠️ `RUNNING_STATES` says the host cannot answer which surface "
        "owns a row and `hideOpen` is the one question a per-window filter may decide — this is "
        "that filter deleted, and the direction it fails in is the one a person meets first",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # window's own answer (`held`) decides whether an in-a-window row is open elsewhere; the old
        # `hereIsOf` line is now `openElsewhere(running, held)`. The plant drops `!held`, so the
        # conversation open in THIS window is told it is open in another window.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives and
        # moved: the window's own `held` decides whether an `in-a-window` row is open elsewhere, and
        # that predicate is `openElsewhere` in `taking-over.ts` (moved out of the deleted roster).
        # No other table plants `&& !held` there; the anchor occurs once. The label's 'loses its
        # press' is stale after D-017b (one press always), but the defect (own-window conversation
        # told it is in another window) still stands.
        [
            (TAKING_OVER, "  return running === 'in-a-window' && !held\n", "  return running === 'in-a-window'\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The ruling this row guards is reversed
        # by D-017b: 'no Reopen / Take it over / Read the recording presses: one press, "Open the
        # conversation"'. A row another window holds now offers that press (the band test asserts
        # elsewhere rows have action OPEN_THE_CONVERSATION), and the message from here is refused
        # with HELD_ELSEWHERE, so 'a press that cannot act' is no longer the defect. Its anchor is
        # left stale, so the census records it retired.
        "M4 · ⛔ a control that cannot act · `taking-over.ts`'s "
        "ruling deleted — *switching windows is not something this app can do for you, and "
        "`RuntimeHost` has no verb for it*. ⚑ The row grows a press whose only outcome is a refusal "
        "by name, which is `118` exactly ⚑ ANCHOR CORRECTED IN PLACE BY 504",
        [(ROSTER, "  if (here === 'open-in-another-window') return null",
          "  if (here === 'open-in-another-window') return 'open'")],
    ),
    # ── §4 · one derivation per fact ────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The plant (`name:
        # agentName(row.identity, …)` in project-roster.ts) is gone with the roster. The surviving
        # derivation, the Team card's `heading: agentName(identity.slug, source.identities)`, is
        # already planted by table 449 (mutations/449 line 417), and
        # `a-row-that-says-who-is-in-it.test.ts` kills it there. Its anchor is left stale, so the
        # census records it retired.
        "M9 · 🔴 a second answer to *what is this identity called* · `449`'s measured defect "
        "rebuilt: the roster is read here instead of through `agentName`, so the band names an "
        "identity one way and the rail, the queue and the library name it another",
        [(ROSTER, "    name: agentName(row.identity, input.identities ?? null),",
          "    name:\n"
          "      input.identities?.find((one) => one.slug === row.identity)?.displayName ??\n"
          "      row.identity,")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The anchor (`started:
        # agoWords(row.startedAt, at)`) lived in the deleted project-roster fold. The sibling rule
        # on the Team card (age against the reading's own `readAt`) is already carried by table 593
        # (`since: agoWords(one.since, readAt)` planted as `agoWords(one.since)`), so a re-anchor
        # here would be a duplicate. Its anchor is left stale, so the census records it retired.
        "M10 · ⚠️ the age detaches from the read it is *as of* · the wall clock in place of the "
        "instant the list was asked for. ⛔ It is not merely imprecise — a test that states the "
        "instant loses its grip, and the number then moves for reasons that have nothing to do with "
        "the list under it",
        [(ROSTER, "    started: agoWords(row.startedAt, at),",
          "    started: agoWords(row.startedAt, Date.now()),")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** Its defect was a `#N` from another
        # project drawn as this project's (`work.projectSlug` vs the band heading). The commit
        # removes exactly this: 'a task reads "Task #N"' and projects go, so no surface has a
        # per-project heading or a project slug on the work to confuse; project-roster.ts is
        # deleted. Its anchor is left stale, so the census records it retired.
        "M11 · ⛔ a number from another project is drawn as this one's · `WorkInHand.projectSlug` is "
        "the WORK's project and this band's heading is the CONVERSATION's; two conversations in two "
        "projects can both hold a `#3`, so a bare number inside this band is read as this project's",
        # Dropping the other project's name makes its task appear to belong to this project.
        [(ROSTER, "  const elsewhere = work.projectSlug === forSlug ? null : work.projectSlug\n",
          "  const elsewhere = null\n")],
    ),
    # ── §5 · 102 and 100 · a gesture's own state ────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** D-017b's commit message says 'no
        # Reopen / Take it over / Read the recording presses: one press, "Open the conversation"',
        # and deletes recordingGesture and the `reopen` arm. The row's premise (a press asserted for
        # the state instead of derived from reopenRefusal/hasTranscript) has no arm left to plant;
        # the refusal is now drawn as `row.refusal` beside the always-present press, and tests
        # assert every state presses the one action. Its anchor is left stale, so the census records
        # it retired.
        "M12 · 🔴 THE PRESS THIS BAND CANNOT HONOUR · the `reopen` arm "
        "ASSERTED for the state instead of derived from the row. ⛔ The surviving half of this row's "
        "rule: a conversation this app placed and then lost before its provider answered the "
        "handshake keeps `external_ref IS NULL` for ever and is in this roster by construction, so a "
        "band that offers *Reopen the conversation* on every recording still offers a press the host "
        "refuses — the two fields are what tell them apart and this ignores them. ⚠️ See the "
        "reversal paragraph in this table's docstring ⚑ RE-AIMED IN PLACE BY 504",
        [(ROSTER,
          "  return recordingGesture({ refusal: record.reopenRefusal, hasTranscript: record.hasTranscript })",
          "  return 'reopen'")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `project-conversations-all`
        # address was on the band bar of `ProjectWorkspace.vue`, which D-016 deleted ('the project
        # rooms, board, sheet and picker'). No such data-cy exists anywhere under apps/desktop and
        # no other surface draws a per-project band that owes the way to the whole. Its anchor is
        # left stale, so the census records it retired.
        "M13 · ⛔ the band becomes a dead end · the address of the surface that CAN act on a "
        "recording is deleted from the band bar, so a project whose conversations are all finished "
        "lists every one of them and offers a person nothing at all. ⚑ It is band 3's own argument: "
        "a list that is a SUBSET must carry the way to the whole, or it is a queue that quietly "
        "loses rows",
        [(ROOM, '            data-cy="project-conversations-all"\n', "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `@sessions="place = 'sessions'"` was
        # the project band's address to the recordings page; RuntimeScreen no longer mounts a band
        # or has an `@sessions` handler (only `@new-conversation` and `@go`). The band went with the
        # room. Its anchor is left stale, so the census records it retired.
        "M20 · ⚠️ the address goes to the wrong surface · the band's one act routes a person Home "
        "instead of to the page that holds every recording with every control. ⛔ Home is the whole "
        "QUEUE, which is band 3's address and a different question; a person looking for the "
        "conversation this band would not let them reopen arrives somewhere that does not list it",
        [(SCREEN, """@sessions="place = \'sessions\'\"""", """@sessions="place = \'home\'\"""")],
    ),
    # ── §6 · the three the SCREEN owes the band ─────────────────────────────────────────────────
    (
        "M15 · 🔴 a dropped call blanks the band · `434`'s rule deleted: the rows a person was "
        "looking at are thrown away instead of kept and marked, and the band falls back to *Nothing "
        "has been read yet* — a window that HAS had an answer telling a person it has never had "
        "one. ⚠️ **Not the forbidden sentence** (the fold refuses to certify an empty it has not "
        "read), and that is the point of keeping the two halves apart: what is lost here is the "
        "list, and what says so is a sentence about this window rather than about the project",
        # A failed relationship refresh drops the previous cards instead of keeping them.
        [
            (SCREEN, '    cast.reading.value =\n      cast.reading.value?.conversation === asked\n        ? { ...cast.reading.value, answered: false, atWork: null }\n        : null\n', '    cast.reading.value = null\n'),
        ],
    ),
    (
        "M16 · ⚠️ the poll runs where nothing paints it · the gate `distil` has for Home, deleted: "
        "one statement plus a per-conversation fold on the main process, every thirty seconds, for a "
        "surface nobody is looking at",
        # 🔴 **550 CORRECTED this anchor; it was NOT retired** — `M14`'s note above, same cause.
        # ⛔ The gate is `readTheRoom`'s and the correction names that function, so the second
        # per-room poll `550` added cannot be what this row measures. ⚠️ Re-verified RED by hand.
                # ⚑ **678 re-anchored and the ROW is unchanged** — the body is `readTheRoomOnce` now,
                # the function `oneReadAtATime` wraps; the gate this row deletes is the same line.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The gate the label names lives on in distil (`if (surface.value !==
        # 'away') return`, RuntimeScreen.vue:2016). The plant deletes it, so the digest reads on
        # every surface. The expected red is '🔴 the gate names the same place the digest component
        # is routed on'. With distil's gate gone, the first gate its regex finds after `async
        # function distil(` is readWhoIsWorkingOnce's 'team', so `gate[1]` is 'team' and not 'away'.
        # The Team, Work and Cast gates (:2147, :2204, :2267) have no killer today, so they are not
        # planted.
        [
            # ⚑ **Recent activity replaced the digest card · re-anchored in place, not retired** — the gated read is Recent activity's now; the plant still deletes the gate, so it reads on every surface
            # ⚑ **Recent activity reads one page per call · re-anchored in place, not retired** — each call reads one page now; the plant still deletes the gate, so the page reads on every surface
            (SCREEN, "  if (surface.value === 'away') return readPage()\n", "  void readPage()\n"),
        ],
    ),
    (
        # ⚠️ **RETIRED, and an OPEN FINDING (landing D-016a, bd70d693):** the rule survives but
        # D-016a deleted the only test that pinned it, so no plant can go red until a test exists
        # again. The rule survives. readTheWork stamps `const at = Date.now()` at
        # RuntimeScreen.vue:2209 before `await store.tasksAssignedBy(asked)`, and distil's `const
        # to` at :2017 does the same, so no age is measured from the landing. The census that pinned
        # it (`read.indexOf('const at = Date.now()') < read.indexOf('await ')` over readTheRoomOnce)
        # went with the room. No test reads readTheWork's or distil's body today:
        # a-childs-state.test.ts slices only readTheCast and the-counts-nobody-can-see.test.ts only
        # readTheWorkspaceOnce. So moving the stamp below the await stays green, which makes this a
        # lost pin rather than a violation. Re-anchor once a census over readTheWork exists.
        "M18 · ⛔ the instant is stamped when the answer LANDS · a read is a round trip, so every age "
        "on the band then claims the list is fresher than it is by exactly that trip",
        # ⚑ **Anchor corrected at `588`**: the roster read and `575`'s `whatIsBeingDone` now go out
        # in ONE `Promise.all`, so the line this row swapped no longer exists on its own. ⛔ The
        # SUBJECT is unchanged and is now stronger, because ONE stamp covers TWO readings: a stamp
        # taken after the round trip over-states the freshness of both.
        [(SCREEN,
          "  const at = Date.now()\n  // ⛔ **Together and not in series**",
          "  // ⛔ **Together and not in series**")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `roomFor(projectId.value,
        # projectStore.projects.value)` resolved a room by slug or `proj:<slug>` id; `roomFor`,
        # `projectId` and `projectStore` are gone with the project rooms ('project rooms, board,
        # sheet and picker' removed by D-016). Its anchor is left stale, so the census records it
        # retired.
        "M19 · ⚠️ the screen resolves the id by SLUG only · `roomFor`'s two keys narrowed to one, so "
        "a room opened by its `proj:<slug>` id — what every FK in the database holds — draws a band "
        "that is never read for. ⛔ The surface and the poll then disagree about which project is on "
        "screen, which is the collision `roomFor` was extracted to make impossible",
        [(SCREEN, "roomFor(projectId.value, projectStore.projects.value)?.slug ?? null",
          "projectStore.projects.value.find((row) => row.slug === projectId.value)?.slug ?? null")],
    ),
    (
        "M17 · ⛔ the cadence becomes a number somebody CHOSE · `LOOK_EVERY_MS`'s own rule deleted — "
        "the roster and the digest are one question and this is the alias that says so. ⚠️ A "
        "literal here is a third cadence nobody derived, free to drift from the read it shares its "
        "cost profile with",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives:
        # `ROSTER_EVERY_MS` is still the digest's number by derivation, now in `team-roster.ts` (the
        # Team page's tick), and DEV kept the band test's cadence section for it ('the cadence is
        # the Team page's'). Same plant, new file; the string occurs exactly once there.
        [
            # ⚑ **Recent activity replaced the digest card · re-anchored in place, not retired** — the roster's tick is Recent activity's number now; the plant still makes it a chosen literal
            (TEAM_ROSTER, "export const ROSTER_EVERY_MS = ACTIVITY_READ_EVERY_MS", "export const ROSTER_EVERY_MS = 45_000"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `:conversations="roster"` supplied the
        # project room; both the room and the `roster` ref are deleted. The only remaining
        # `:conversations=` on the screen is the rail's `theOneList`, which is another table's line.
        # Its anchor is left stale, so the census records it retired.
        "M21 · 🔴 the band is drawn and never supplied · the reading stops reaching the room, so a "
        "perfect fold answers *nobody has looked yet* for ever. ⛔ A line no mutation can kill is not "
        "carrying its rule, and the mount is one of those",
        [(SCREEN, '          :conversations="roster"\n', "")],
    ),
    # ── §7 · the drawing itself ─────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** D-017b removed `v-if="row.action"` on
        # purpose: the button is drawn on every row and `row.action` is always OPEN_THE_CONVERSATION
        # ('one press on every row'). The band test now asserts
        # `expect(template).not.toContain('v-if="row.action"')`, so the plant would restore the
        # opposite of the ruling. Its anchor is left stale, so the census records it retired.
        "M22 · ⛔ a press is drawn on every row · `118`'s rule deleted at the drawing: the two states "
        "this app has no verb for — a conversation another window holds, and a recording this row "
        "cannot answer for — get a button with no words in it, which is worse than a greyed one "
        "because it does not even say what it would do. ⚑ **Re-aimed: the first aim replaced the "
        "`v-if` with a `:disabled` and the template stopped COMPILING** (the sibling `v-else-if` "
        "lost its `v-if`), and a mutation that cannot build is not a measurement",
        [(ROOM, '                v-if="row.action"', '                v-if="true"')],
    ),
    (
        "M24 · ⛔ the band stops re-reading · the interval is never installed, so the room a person "
        "leaves open is frozen at the answer it had when they walked in. ⚑ **Added after review**: "
        "the census pinned the CLEAR half and the cadence constant and not the install, so the tick "
        "could have been deleted outright with every assertion still green · killed by `the-counts-nobody-can-see.test.ts` (named by W4.91)",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — `rostering` became the Team page's `teaming` interval
        # (RuntimeScreen.vue:2475), and the plant deletes its install so the page freezes at its
        # arrival read. Two source censuses pin the install and both should go red. In
        # one-read-at-a-time.test.ts, '⚑ the four triggers all call the wrapped one' fails because
        # the stripped `readWhoIsWorking()` call count drops from 4 to 3, and the exact `teaming =
        # setInterval` line is also absent. In the-counts-nobody-can-see.test.ts, '⛔ exactly one
        # interval re-reads it' fails because no setInterval call mentions readWhoIsWorking.
        # ⛔ **RETIRED BY RULING (W4.74, D-033's window half):** W4 asked for the Team page's, the
        # band's and the Work tab's periodic re-reads to go, since every move of the work is now
        # pushed (`work`, a turn's too) and each surface is read again on it. The interval this row
        # deleted no longer exists, so there is nothing for the plant to delete; what is left on a
        # clock is the one glance (what each agent is doing, and process memory), pinned by
        # `the-rails-list-is-asked-again-…`. Its anchor is left stale, so the census records it retired.
        [
            # ⚑ **W4.91 · re-anchored in place, not retired** — 031d1176 replaced the band's re-read with one glance on the same clock (reviewer's re-anchor); not installing it freezes what each agent is doing
            (SCREEN, "  glancing = setInterval(() => void glance(), ROSTER_EVERY_MS)\n", ""),
        ],
    ),
    (
        "M23 · ⚠️ the row stops saying what this app is doing with it · the one line that tells a "
        "person a conversation is open in another window, or that nobody is watching it, goes — and "
        "a row with no press and no sentence is a row that simply does nothing",
        # ⚑ **Anchor corrected at `588`**: `EXT-013` §2.4 folded this row's four stacked facts into
        # ONE quiet line, so the sentence is inside a `<span>` that keeps its own `data-cy`. ⛔ The
        # SUBJECT never moved — the line that says what this app is doing with the conversation.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # row's one quiet line says where the conversation is ('open in another window'), now via
        # `<template v-if="row.says"> · {{ row.says }}</template>` rather than an unconditional `{{
        # row.says }}`. The plant strips that clause so the sentence is never drawn.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — ProjectWorkspace.vue is gone (old count -1). The row's 'open in another
        # window' line is now the Team shelf's `.shelf-where` span, fed by team-roster.ts:491 `says:
        # elsewhere ? OPEN_IN_ANOTHER_WINDOW : null`. The plant removes the span, so a conversation
        # another window holds says nothing. The expected red is '⚑ THE CONTROL — the same row open
        # in ANOTHER window says where it is, drawn whole', which fails at `where` being null. This
        # is a DOM test, so it needs `--project "dom (chromium)"` and a name filter.
        [
            (TEAMWORKSPACE, '                        <span v-if="row.says" class="shelf-where">{{ row.says }}</span>', ''),
        ],
    ),
]
