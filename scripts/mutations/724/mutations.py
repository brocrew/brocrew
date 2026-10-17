"""724 · small true words, for the model and the lists — R84, R82, `720` F-C, `717` F-2, `714` F-4, `718` F-1.

⛔ **Ordered by the PM** from `719` F-5 (R84: `list_tasks` carried every answered row's words — up to
1,280 units a row), `720` F-D (R82: `stalled_by` named who ASKED), `720` F-C (an agent asker printed
as `sess_…`), `717` F-2 (a Resume into a gone folder read the program's `ENOENT`), `714` F-4 (the
Team page could not tell a start from a running conversation) and `718` F-1 (whether a window runs on
a non-default userData was on no wire).

## ⚠️ What a row here measures

 * ⚑ **M1–M3 are R84** — the door carries the words only for an answer that reached nobody (M1:
   `main`'s R70 line, back), the fold marks that row (M2), and the store's narrow read selects the
   row that says so (M3) — killed by `small-true-words-for-the-model-and-the-lists.test.ts` §1.1 and
   §1.3.
 * ⚑ **M4–M5 are R82** — both doors spell the key `asked_to_stop_by` — killed by the same file's
   §2.1 and by `state-a-supervisor-can-trust.test.ts`, whose `list_projects` reads pin the second.
 * ⚑ **M6–M8 are `720` F-C** — the asker named at the push (M6) and on `list_tasks`' line (M7), and
   the one way to name an ask (M8) — killed by `state-a-supervisor-can-trust.test.ts` and §3.1.
   ⚑ **M27–M28** (`724`'s review): the ASKER and not the giver or the reader — killed by that file's
   ancestor test, where Grace asks, Ada gave the work and reads, and Bob holds it.
 * ⚑ **M9–M13 are `714` F-4** — `isStarting` and where, off the starting slots alone — killed by
   `every-identity-he-has.test.ts`.
 * ⚑ **M14–M19 are `718` F-1** — the title names a non-default data folder, by identity, and a
   hidden launch keeps its test name — killed by `a-window-nobody-sees.test.ts`.
 * ⚑ **M20–M26 are `717` F-2** — a reopen into a gone folder says so and names it, only under a
   spawn's `ENOENT`, and the wake says it too — killed by `the-folder-it-ran-in-is-gone.test.ts`.
   ⚠️ M21 SURVIVED its first run: its only control was a SHORTAGE in a gone folder, which R52's reader
   re-classifies whatever this gate says. The lost-conversation control was written for it.

## ⛔ What has NO row here, and who holds it instead

 * ⚠️ **The correction's call site** (`tellOneParentItWasSetRight` → `correctedWorkText`, F-C): its
   stall arm carries an ask only when a reopen restores a stall whose own push the giver never read
   (abandoned by its Close or a quit) — the giver's own ask included (`724`'s review) — and no rig
   here builds that. ⚑ The arm is pinned at its composer (§3.1), and `theAskNamed` (M8) is the one
   way to build the argument it takes; a call site that handed it `(conversation) => conversation`
   would survive, and that is stated rather than dressed as a row.
 * ⚠️ **The fold's `answered` guard on `reply_undelivered`** (R84): the row lands after the reply that
   closed the task, so no ledger holds it on an open row — a row planted there is an equivalent.
 * ⚠️ **`removeAgent`'s starting walk** (`714` F-4): `whatHoldsIt` asks `isLaunching` alone, so the
   door reads nothing the starting walk adds — `identityUseNow` is one helper so the two readers
   cannot fold different facts, and that is the whole of its claim.
 * ⚠️ **`719` M10 was removed by this dispatch** (R84): it planted the work's text as an OPEN row's
   words in the fold, and R84 gates the door on an answer that reached nobody — so those words reach
   no reader and the row planted an equivalent. Its coverage is M1 here, with §1.2.
 * ⚠️ **The prose rows** — docblocks, which no test reads (standing rule 19).
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"
RAILS = "apps/desktop/src/main/runtime/reply-rails.ts"
ROSTER = "apps/desktop/src/shared/agent-roster.ts"
PRESENTATION = "apps/desktop/src/main/launch-presentation.ts"
INDEX = "apps/desktop/src/main/index.ts"
CWD = "apps/desktop/src/main/runtime/scratch-cwd.ts"
UNAVAILABLE = "apps/desktop/src/main/runtime/session-unavailable.ts"
SMALL = "small-true-words-for-the-model-and-the-lists.test.ts"
SUPERVISOR = "state-a-supervisor-can-trust.test.ts"
IDENTITIES = "every-identity-he-has.test.ts"
WINDOW = "a-window-nobody-sees.test.ts"
GONE = "the-folder-it-ran-in-is-gone.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §A · R84 — the words ride only where they were lost ──────────────────────────────────────
    (
        "M1 · 🔴 R84 undone · `main`'s R70 line: every row carries a `summary`, and every answered one "
        f"its words, delivered or not — up to 1,280 units a row · killed by `{SMALL}` §1.1",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (a
        # delivered answer leaves no words on the list row; the summary rides only when the answer
        # reached nobody, R84) still holds. list_tasks' you_gave row is built in agent-tools.ts from
        # the piece row, and the guard is now `piece.answerReachedNobody`. The plant drops the guard
        # so every row carries its summary. Killed by
        # `small-true-words-for-the-model-and-the-lists.test.ts`.
        [
            (TOOLS, '  ...(piece.answerReachedNobody ? { summary: piece.summary } : {}),\n', '  summary: piece.summary,\n'),
        ],
    ),
    (
        "M2 · ⛔ the fold does not mark the answer that reached nobody · R48's line points at "
        f"`list_tasks`, and its row shows no words · killed by `{SMALL}` §1.3",
        [(TASKS, "        rows[index] = { ...answered, answerReachedNobody: true }\n", "        rows[index] = { ...answered, answerReachedNobody: false }\n")],
    ),
    (
        "M3 · ⛔ the store's narrow read does not select `reply_undelivered` · the fold never meets "
        f"the row, so the words ride nowhere — on every call, live or not · killed by `{SMALL}` §1.3",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (a
        # `reply_undelivered` event must be read when folding a giver's pieces, so the row learns
        # its answer reached nobody) still holds; `derivePieces` folds it into `answerReachedNobody`
        # (R84). The event list is now the `selectPieceEvents` type list in session-store.ts. The
        # plant drops `reply_undelivered` from it, so the lost answer's words never ride the row.
        # Killed by `small-true-words-for-the-model-and-the-lists.test.ts`.
        [
            (STORE, "'user_decision', 'reopened', 'reply_undelivered', 'message_queued',", "'user_decision', 'reopened', 'message_queued',"),
        ],
    ),
    # ── §B · R82 — a wire key says what it holds ─────────────────────────────────────────────────
    (
        "M4 · 🔴 R82 undone at `list_tasks` · the key says *stalled_by* again, beside "
        f"`stalled_because: 'turn_ended'` · killed by `{SMALL}` §2.1",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # (list_tasks spells who asked as `asked_to_stop_by`, never `stalled_by`, R82) survives on
        # the `you_gave` row that replaced the task list. The plant renames the field back to
        # `stalled_by`. Killed by `small-true-words-for-the-model-and-the-lists.test.ts`.
        [
            (TOOLS, '  asked_to_stop_by: piece.stalledBy,\n', '  stalled_by: piece.stalledBy,\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row's subject was the second door,
        # `list_projects`, and that tool is deleted ('create_project and list_projects ... are
        # removed'); the supervisor test's `list_projects` entry and live read went with it. The
        # remaining door, `list_tasks`' `asked_to_stop_by`, is planted by 724 M4. Its anchor is left
        # stale, so the census records it retired.
        "M5 · ⛔ R82 undone at `list_projects` · one door renamed and the other not, one depth of the "
        f"walk behind · killed by `{SUPERVISOR}`",
        [(TOOLS, "  ...(row.stalledBy === undefined ? {} : { asked_to_stop_by: row.stalledBy }),\n", "  ...(row.stalledBy === undefined ? {} : { stalled_by: row.stalledBy }),\n")],
    ),
    # ── §C · `720` F-C — who asked, named ────────────────────────────────────────────────────────
    (
        "M6 · 🔴 F-C undone at the PUSH · the notice a parent is pushed says *\"…, by sess_…\"* while "
        f"`list_tasks` names the agent · killed by `{SUPERVISOR}`",
                # ⚑ Re-anchored by `729` (R90), which gave `theAskNamed` its READER and put the call on
                # lines of its own; the row is unchanged — killed by the ancestor tests, whose asker
                # is not the reader.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # pushed 'stopped' notice names an ancestor who asked by the name a person knows, not by its
        # conversation id) still holds. The push site in runtime-host.ts passes `(conversation) =>
        # this.whatToCallTheConversation(conversation)` to `theAskNamed`. The plant passes the
        # identity function, so the notice says `by sess_…`. Killed by
        # `state-a-supervisor-can-trust.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The pushed stopped-notice is built in `tellOneParent` through
        # `theAskNamed(piece.stalledBy, (conversation) => this.nameByItsWork(conversation), ...)`;
        # the old `whatToCallTheConversation` callback is gone since D-016 commit 7 names an agent
        # by its piece. The plant makes the callback return the raw conversation id, so the parent
        # is pushed 'by sess_...' while list_tasks names the agent, which is the label's defect. The
        # ancestor tests (Grace asks, Ada gave) assert the pushed notice names Grace via
        # `theConversationCalled`. Killed by `state-a-supervisor-can-trust.test.ts`.
        [
            # ⚑ **W4.136 · re-anchored in place, not retired** — F033: the asker is named by its piece on the chain of the piece whose turn it stopped
            (HOST, "          theAskNamed(\n            piece.stalledBy,\n            (conversation) => this.nameByItsWorkUnder(conversation, piece.piece),\n", '          theAskNamed(\n            piece.stalledBy,\n            (conversation) => conversation,\n'),
        ],
    ),
    (
        "M7 · 🔴 F-C undone on `list_tasks`' line · the line read back says *\"…, by sess_…\"* while "
        f"the notice names the agent · killed by `{SUPERVISOR}`",
                # ⚑ Re-anchored by `729` (R90), which handed the line its READER; the row is unchanged.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # list_tasks line names an ancestor asker by its person-facing name, not its id) still
        # holds. In agent-tools.ts the `you_gave` row calls `theAskNamed(piece.stalledBy,
        # whatToCall, reader)`. The plant swaps `whatToCall` for the identity function so the line
        # carries a raw conversation id. Killed by `state-a-supervisor-can-trust.test.ts`.
        [
            # ⚑ **W4.136 · re-anchored in place, not retired** — F033: the asker is named by its piece on the chain of the piece whose turn it stopped
            (TOOLS, "theAskNamed(piece.stalledBy, (asker) => whatToCall(asker, piece.piece), reader)", 'theAskNamed(piece.stalledBy, (conversation) => conversation, reader)'),
        ],
    ),
    (
        "M8 · ⛔ naming an ask keeps the id · every sentence that says who asked prints the handle "
        f"`HO-095` §5.3 ruled out · killed by `{SMALL}` §3.1",
        [
            (
                RAILS,
                # ⚑ Re-anchored by `729` (R90), which split the one expression into the reader's arm
                # and this one; the row is unchanged.
                "    called: ask.asker === null ? null : whatToCall(ask.asker),\n",
                "    called: ask.asker,\n",
            )
        ],
    ),
    # ── §D · `714` F-4 — a start told apart from a running conversation ────────────────────────────
    (
        "M9 · 🔴 `isStarting` counts every phase · a running conversation reads as starting, which is "
        f"`714` F-4's false claim on the Team page · killed by `{IDENTITIES}`",
        [(ROSTER, "      isStarting: starting.has(identity.slug),\n", "      isStarting: launching.has(identity.slug),\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `projectsOfItsStarts` (and
        # `projectsOfItsLaunches`) were removed from `IdentityUse`, and `identityUse` now takes
        # `ReadonlySet`s. The surviving rule, `isStarting` counting only starting slots, is already
        # planted by 724 M9 (`isStarting: starting.has(...)` to `launching.has(...)`, killed by
        # every-identity-he-has.test.ts), along with M11-M13. Its anchor is left stale, so the
        # census records it retired.
        "M10 · ⛔ `projectsOfItsStarts` names every launch's place · a running conversation's project "
        f"reads as a start into it · killed by `{IDENTITIES}`",
        [(ROSTER, "      projectsOfItsStarts: starting.get(identity.slug) ?? [],\n", "      projectsOfItsStarts: launching.get(identity.slug) ?? [],\n")],
    ),
    (
        "M11 · ⛔ the walk's filter is dropped · the starting walk is the launching walk, so "
        f"`isStarting` is `isLaunching` again · killed by `{IDENTITIES}`",
        [(HOST, "      if (!only(slot)) continue\n", "")],
    ),
    (
        "M12 · ⛔ a start being CLOSED still reads as starting · `AgentCard.state` says *ending* for "
        f"that slot, and the roster would say *starting* · killed by `{IDENTITIES}`",
        [(HOST, "  return slot.session === null && !onItsWayOut(slot)\n", "  return slot.session === null\n")],
    ),
    (
        "M13 · ⛔ the roster's read asks the starting walk for every slot · `identityUseNow` hands the "
        f"launching map twice · killed by `{IDENTITIES}`",
        [(HOST, "      this.launchesByIdentity(stillStarting),\n", "      this.launchesByIdentity(),\n")],
    ),
    # ── §E · `718` F-1 — a window names its data folder ───────────────────────────────────────────
    (
        "M14 · 🔴 `718` F-1 undone · a person's launch on another folder is titled `BroBot2`, like "
        f"the person's own window · killed by `{WINDOW}`",
        [(PRESENTATION, "  return dataFolder === null ? PERSONS_TITLE : `${PERSONS_TITLE} — ${dataFolder}`\n", "  return PERSONS_TITLE\n")],
    ),
    (
        "M15 · ⛔ the folder beats a hidden launch · its bar says a folder while its OS title says "
        f"*test* · killed by `{WINDOW}`",
        [(PRESENTATION, "  if (presentation.hidden) return HIDDEN_TITLE\n", "")],
    ),
    (
        "M16 · ⛔ the default is compared by SPELLING · Chromium's resolved `/private/tmp`, a symlink "
        f"or another case calls the default folder *another* · killed by `{WINDOW}`",
        # ⚑ **W4.131 · re-anchored in place, not retired** — the comparison by identity moved to `same-folder.ts`'s `sameFolder`; the mutant still compares the two spellings.
        [(PRESENTATION, "  if (sameFolder(userData, defaultUserData)) return null\n", "  if (userData === defaultUserData) return null\n")],
    ),
    (
        "M17 · ⛔ a folder name keeps its format characters · a name can reorder or hide the title it "
        f"is shown in · killed by `{WINDOW}`",
        [(PRESENTATION, "  const folder = basename(resolve(userData)).replace(/[\\p{Cc}\\p{Cf}]/gu, '')\n", "  const folder = basename(resolve(userData))\n")],
    ),
    (
        "M18 · ⛔ the producer never passes the folder · every person's window says `BroBot2` again "
        f"· killed by `{WINDOW}`",
        [(INDEX, "    windowTitle: windowTitleFor(presentation, dataFolder),\n", "    windowTitle: windowTitleFor(presentation, null),\n")],
    ),
    (
        "M19 · ⛔ the default is compared with itself · no window ever names a folder · killed by "
        f"`{WINDOW}`",
        # ⚑ **W4.90 · re-anchored in place, not retired** — W4.90 pins the data folder; the default is the pinned path, no longer Electron's derivation from the app's name.
        [(INDEX, "    defaultDataFolder(app.getPath('appData')),\n", "    app.getPath('userData'),\n")],
    ),
    # ── §F · `717` F-2 — a reopen into a gone folder ─────────────────────────────────────────────
    (
        "M20 · 🔴 `717` F-2 undone · a person's Resume reads *\"spawn …/claude ENOENT\"* — the program, "
        f"about a folder · killed by `{GONE}` §1",
        [(HOST, "      throw this.aFolderThatIsGoneAsARefusal(error, row.ref.cwd, sessionId)\n", "      throw error\n")],
    ),
    (
        "M21 · ⛔ any failure in a gone folder is called the folder's · a conversation the provider "
        "LOST is told to put a folder back, and `692`'s *let it go* signal is wrapped away · killed by "
        f"`{GONE}` §1's controls",
        [(HOST, "    if (spawnNoWaitClearsOf(error) !== 'ENOENT' || !folderIsGone(cwd)) return error\n", "    if (!folderIsGone(cwd)) return error\n")],
    ),
    (
        "M22 · ⛔ a missing PROGRAM is called a gone folder · a folder that is there is said to be "
        f"gone · killed by `{GONE}` §1's controls",
        [(HOST, "    if (spawnNoWaitClearsOf(error) !== 'ENOENT' || !folderIsGone(cwd)) return error\n", "    if (spawnNoWaitClearsOf(error) !== 'ENOENT') return error\n")],
    ),
    (
        "M23 · ⛔ every folder is gone · a missing program in a folder that is there reads as the "
        f"folder's · killed by `{GONE}` §1's controls",
        [(CWD, "    statSync(cwd)\n    return false\n", "    statSync(cwd)\n    return true\n")],
    ),
    (
        "M24 · ⛔ the sentence loses WHICH folder · a person is told a folder is gone and not where "
        f"· killed by `{GONE}` §1",
        [(UNAVAILABLE, "      const where = path === null ? 'the folder it ran in' : `the folder it ran in, ${path},`\n", "      const where = 'the folder it ran in'\n")],
    ),
    (
        "M25 · 🔴 the wake has no arm for it · the chain's spawn `ENOENT` reads as the PROGRAM, and "
        f"the model is told its provider's program could not run · killed by `{GONE}` §2",
        [(TOOLS, "  if (reason === 'its-folder-is-gone') {\n    return { rail: 'that-conversation-could-not-be-resumed', because: reason, what: 'gone-folder' }\n  }\n", "")],
    ),
    (
        "M26 · ⛔ the wake says its word and not what is wrong · the generic sentence, where the "
        f"folder's own was owed · killed by `{GONE}` §2",
        [(TOOLS, "  if (unwoken.what === 'gone-folder') return { ...refused, reason: A_WAKE_WHOSE_FOLDER_IS_GONE }\n", "")],
    ),
    # ── §C2 · `720` F-C — the ASKER, not the giver or the reader (`724`'s review) ─────────────────
    (
        "M27 · 🔴 the push names the GIVER as the one who asked · an ancestor's ask reads as the "
        f"giver's own — a false account of who stopped the work · killed by `{SUPERVISOR}`",
                # ⚑ Re-anchored by `729` (R90), which gave `theAskNamed` its READER and put the call on
                # lines of its own; the row is unchanged.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (an
        # ancestor's ask is named by the ancestor, never by the giver) still holds. The push in
        # runtime-host.ts names the asker through `whatToCallTheConversation(conversation)`. The
        # plant always names `piece.giver`, so the notice says 'stopped, by Ada' when Grace asked.
        # Killed by `state-a-supervisor-can-trust.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The push still names the asker of the stop through theAskNamed;
        # commit 7 renamed the namer from whatToCallTheConversation to nameByItsWork, so the old
        # anchor is gone. The plant always names piece.giver, so an ancestor's ask reads as the
        # giver's own. Killed by `state-a-supervisor-can-trust.test.ts`.
        [
            # ⚑ **W4.136 · re-anchored in place, not retired** — F033: the asker is named by its piece on the chain of the piece whose turn it stopped
            (HOST, "          theAskNamed(\n            piece.stalledBy,\n            (conversation) => this.nameByItsWorkUnder(conversation, piece.piece),\n", '          theAskNamed(\n            piece.stalledBy,\n            () => this.nameByItsWork(piece.giver),\n'),
        ],
    ),
    # Re-anchored, NOT VERIFIED and HELD; its test reaches a held path.
    (
        "M28 · 🔴 `list_tasks` names its READER as the one who asked · the line tells the giver it "
        f"stopped its own work · killed by `{SUPERVISOR}`",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — `list_tasks` now builds each line as `pieceText(row, ownerIs(row),
        # called, me)`, so the old `whatToCallTheConversation(conversation)` line is gone. The plant
        # hands `pieceText` the row's own asker as the reader, so a giver reading the list is told
        # 'you asked it to stop' about an ask someone else made, which is the label's defect. The
        # ancestor tests expect that phrase only for the reader's own ask and Grace's name
        # otherwise. Killed by `state-a-supervisor-can-trust.test.ts`.
        [('apps/desktop/src/main/runtime/agent-tools.ts', 'pieceText(row, ownerIs(row), called, me, heldBecause(row), stopOf(row), heldByName(row))', 'pieceText(row, ownerIs(row), called, row.stalledBy?.asker ?? me, heldBecause(row), stopOf(row), heldByName(row))')],
    ),
]
