"""1024 · D-024 · a profile's conversations know each other.

⚑ **Why `1024`**: card D-00N's table is `100N`. D-024 is one DEV commit, `8f602804`, landed through
DEV's own merge of `main`, `3500023f`.

## What it changed

* **The launch section**: at every launch a conversation's own section lists its profile's other
  conversations as they stood then (who each works for; its latest pieces, newest first; at most 5
  conversations with 3 pieces each, then a count of the rest). It is composed per conversation and
  written to no file: Claude gets it as the last block of its appended system prompt, Codex in front of
  the first turn of each life. A replacement's first launch leaves its predecessor out.
* **The reach**: `read_transcript` and `list_tasks` also reach the caller's own profile's other
  conversations, by a piece's label or an id; `list_tasks {made: true}` lists the files the profile's
  conversations made, newest ten.

 * `M1`–`M15` — the launch section. Killed by the landing's
   `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts` (`M2` also by DEV's
   `the-text-a-child-is-actually-told.test.ts` and `one-set-for-every-agent.test.ts`). `M5`'s killer arm
   uses a Codex double that lists `/` commands, which a real Codex does not: it measures the host's
   ordering rule (a command goes before the lead), and says so in its docblock.
 * `M20`–`M30` — the reach. Killed by the landing's `a-profile-reads-across-its-own-conversations.test.ts`
   (`M22` also by `a-giver-looks-closer.test.ts`).

Designed read-only by Sonnet 5.5 agents from the commit and today's code; each row verified alone by the
landing agent.

## Verification

- **RED: 26 of 26.** Each row alone by `verify_row.py` with its named killer, on `landing` over
  `5f2dc9e1` (the merges of `3500023f`, `75d3e2b4` and `ad8f0c78`), none by a syntax, reference or type
  error. Each killer file ran green unmutated first.
"""

SESSION_STORE = "apps/desktop/src/main/db/session-store.ts"
INDEX = "apps/desktop/src/main/index.ts"
AGENT_TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
FACTORY_TEXT = "apps/desktop/src/main/runtime/factory-text.ts"
INSTRUCTIONS = "apps/desktop/src/main/runtime/instructions.ts"
RUNTIME_HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · the composition root stops handing the reader this conversation's text · main/index.ts drops `thisConversation:` from its readSessionInstructions call, so no launch is ever sent its own section on either provider and no test that runs notices — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts` — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts`",
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not retired —
        # D-039 (17a9220d) made the composition root hand `thisConversationSpans(context,
        # toolsToldInTextFor(provider))`, so the old one-argument line is gone. The rule survives: if the
        # call that hands the reader this conversation's text is dropped, no launch gets its own section.
        # The killer's section 6 predicate already uses the new spelling and fails when the line is
        # removed. Killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts`.
        [
            # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The saved-methods reading rides a context of its own at this call; original defect, ID and killer retained.
            (INDEX, "        thisConversation: thisConversationSpans(\n          launchContext,\n          toolsToldInTextFor(provider),\n          provider,\n        ),\n", ""),
        ],
    ),
    (
        "M2 · the profile's file carries this conversation's sections again · profileBundleSpans renders the dynamic layer into the shared file, so a sibling's launch can rewrite it with its own list and facts — killed by `the-text-a-child-is-actually-told.test.ts`, `one-set-for-every-agent.test.ts` — killed by `the-text-a-child-is-actually-told.test.ts`, `one-set-for-every-agent.test.ts`, `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts`",
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. bf266c0f1 made profile sections provider-aware; still wrongly insert this conversation's dynamic sections into the shared profile file.
            (FACTORY_TEXT, "  return spansOf(bundleSections(context, provider))\n", "  return spansOf([\n    ...bundleSections(context, provider),\n    ...thisConversationSections(context as InstructionContext),\n  ])\n"),
        ],
    ),
    (
        "M3 · a life's first-turn text is never used up · withWhatThisLifeOwes forgets to clear firstTurnLead, so every Codex message of the life carries the conversation's block again — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts` — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts`",
        [
            # ⚑ **W4.179 · re-anchored in place, not retired** — W4.179 put the lead's kind for its row between the clear and the return; the mutation still never clears it
            # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The saved-methods index is kept out of records here; original defect, ID and killer retained.
            (RUNTIME_HOST, "    session.firstTurnLead = null\n    // ⚑ **W4.179 — which lead, for its turn's row** ({@link HostedSession.leadJustHandedOver}).\n    session.leadJustHandedOver = {\n      is: session.firstTurnLeadIs,\n      chars: withTheLinesKept(lead, session.savedMethodsLines).length,\n    }\n    return `${lead}\\n\\n${words}`\n", "    // ⚑ **W4.179 — which lead, for its turn's row** ({@link HostedSession.leadJustHandedOver}).\n    session.leadJustHandedOver = {\n      is: session.firstTurnLeadIs,\n      chars: withTheLinesKept(lead, session.savedMethodsLines).length,\n    }\n    return `${lead}\\n\\n${words}`\n"),
        ],
    ),
    (
        "M4 · a reopened life is handed no first-turn text · the resume path stops passing firstTurnLead to the hosted session, so a woken Codex conversation never receives the section composed at that reopen — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts` — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts`",
        [
            # ⚑ **W4.179 · re-anchored in place, not retired** — W4.179 passes what a reopened Codex thread still owes beside it; the mutation still passes nothing
            # Source-only re-anchor, NOT VERIFIED: the resume lead receives preloaded rows; removing its spread still omits all first-turn text.
            # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The saved-methods index is kept out of records here; original defect, ID and killer retained.
            (RUNTIME_HOST, "      // ⚑ **D-024 · R1 — every life owes its own**, as it stood at this launch — ⚑ **W4.179** and on\n      // Codex only what its thread does not already hold ({@link theLeadAReopenOwes}).\n      ...(instructions?.firstTurnLead === undefined\n        ? {}\n        : {\n            firstTurnLead: instructions.firstTurnLead,\n            ...this.theLeadAReopenOwes(\n              sessionId,\n              row.provider,\n              launchGave,\n              reopenedThreadLeads,\n              instructions.savedMethodsLines,\n            ),\n          }),\n", "      // ⚑ **D-024 · R1 — every life owes its own**, as it stood at this launch — ⚑ **W4.179** and on\n      // Codex only what its thread does not already hold ({@link theLeadAReopenOwes}).\n"),
        ],
    ),
    (
        "M5 · a person's command is sent with the text in front of it · the command branch of handToProvider takes the owed first-turn text, so a first-turn /usage or /compact is no longer a command — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts` — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts`",
        [
            (RUNTIME_HOST, "      return session.handle.send(text, this.stampFor(from, handed))\n", "      return session.handle.send(\n        this.withWhatThisLifeOwes(session, text),\n        this.stampFor(from, handed),\n      )\n"),
        ],
    ),
    (
        "M6 · the identity index lists the oldest conversations first · conversationsOf orders by updated_at ascending, so a launch lists a profile's stalest conversations and drops the active ones into the count — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts` — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts`",
        [
            (SESSION_STORE, "          WHERE agent_identity_id = ?\n          ORDER BY updated_at DESC, id DESC`,\n", "          WHERE agent_identity_id = ?\n          ORDER BY updated_at ASC, id ASC`,\n"),
        ],
    ),
    (
        "M7 · the identity index lists every profile's conversations · conversationsOf stops filtering on the identity, so a launch is told what other agents' conversations are doing — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts` — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts`",
        [
            # ⚑ **W4.141 · re-anchored in place, not retired** — F009: the identity's conversations are read with when each was created and last moved, for an agent's record; the plant still drops the identity filter, so a launch is told what other agents' conversations are doing
            (SESSION_STORE, "        `SELECT id, parent_session_id, created_at, updated_at FROM provider_session\n          WHERE agent_identity_id = ?", "        `SELECT id, parent_session_id, created_at, updated_at FROM provider_session\n          WHERE ? IS NOT NULL"),
        ],
    ),
    (
        "M8 · a reopened conversation lists itself among its profile's others · the launching conversation's own ids are no longer filtered out of the list — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts` — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts`",
        [
            (RUNTIME_HOST, "      .filter((one) => !itself.includes(one.conversation) && !this.replacedBy.has(one.conversation))\n", "      .filter((one) => !this.replacedBy.has(one.conversation))\n"),
        ],
    ),
    (
        "M9 · a conversation another has taken the place of is still listed · the replacedBy filter is gone, so the replacement and the conversation it replaced both appear — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts` — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts`",
        [
            (RUNTIME_HOST, "      .filter((one) => !itself.includes(one.conversation) && !this.replacedBy.has(one.conversation))\n", "      .filter((one) => !itself.includes(one.conversation))\n"),
        ],
    ),
    (
        "M10 · a replacement's first launch lists the conversation it replaces · the slot no longer remembers what it replaces, so the predecessor (not yet recorded as replaced) is listed as another conversation — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts` — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts`",
        [
            (RUNTIME_HOST, "      replaces: this.reservingAReplacementFor,\n", "      replaces: null,\n"),
        ],
    ),
    # Retired: the edited operation or wording was deleted, rather than moved.
    # RETIREMENT APPROVED — 1024 M11: anchor-absent; removed by 972f27788c869c586e3d06a4497fbb1f2a8e88e4.
    # The launch peer list deliberately removed worksFor and its self-as-you relation, including this
    # branch and its old tests. It now lists each conversation's label, title and last activity. A
    # remaining is-you guard for a public agent record answers a different surface and subject. Definition
    # retained as historical evidence; no row execution.
    (
        "M11 · a conversation this one started is called by its agent's name, never `you` · the stands-for check is replaced by false, so a reader is told its own act as somebody else's — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts` — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts`",
        [
            (RUNTIME_HOST, "            : itself.includes(one.parent)\n              ? { is: 'you' }\n", "            : false\n              ? { is: 'you' }\n"),
        ],
    ),
    # Retired: the edited operation or wording was deleted, rather than moved.
    # RETIREMENT APPROVED — 1024 M12: anchor-absent; removed by 972f27788c869c586e3d06a4497fbb1f2a8e88e4.
    # The launch peer list deliberately removed each peer's three newest held pieces and the reverse/slice
    # composition. It now lists conversation label, title and dated activity; the changed launch tests
    # assert that new list. Public record piece ordering remains a distinct consumer, not a replacement
    # for launch peer piece ordering. Definition retained as historical evidence; no row execution.
    (
        "M12 · a conversation's pieces are listed oldest first · the fold's give order is no longer reversed, so a launch lists a sibling's first three pieces instead of its latest — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts` — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts`",
        [
            (RUNTIME_HOST, "          .reverse()\n          .slice(0, PIECES_SHOWN_EACH)\n", "          .slice(0, PIECES_SHOWN_EACH)\n"),
        ],
    ),
    (
        "M13 · the list of conversations is unbounded · the newest-five slice is gone, so a profile with many conversations is listed whole and the count of the rest is zero — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts` — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts`",
        [
            (RUNTIME_HOST, "    const shown = others.slice(0, OTHER_CONVERSATIONS_SHOWN).map((one): OtherConversation => {\n", "    const shown = others.map((one): OtherConversation => {\n"),
        ],
    ),
    (
        "M14 · a launch with no other conversation still prints the heading · the guard on the list is widened so an empty list renders an empty heading — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts` — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts`",
        [
            (FACTORY_TEXT, "  if (context.others.shown.length > 0) {\n", "  if (context.others.shown.length >= 0) {\n"),
        ],
    ),
    (
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not retired —
        # D-039 (17a9220d) renamed NOTE_SENDS_ONLY_THIS_CONVERSATION to NOTE_SENDS_THIS_CONVERSATIONS_TEXT
        # ('sends this provider how to use its tools and what is true of this conversation') because the
        # lead now also carries the tools. The rule is unchanged: the Codex drawer note must say what is
        # sent whenever this conversation's own text was composed. The plant ignores sendsThisConversation
        # and always uses the 'provider reads its own' lead. Killed by
        # `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts`.
        # The native subject moved; this row retains its original fault.
        "M15 · Codex's drawer note says nothing is appended while a conversation's text is sent · the note's lead sentence ignores whether this conversation's own text was composed — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts` — killed by `a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts`",
        [
            ("apps/desktop/src/main/providers/codex/instructions.ts", "  const lead = sendsThisConversation\n    ? NOTE_SENDS_THIS_CONVERSATIONS_TEXT\n    : NOTE_PROVIDER_READS_ITS_OWN\n", "  const lead = NOTE_PROVIDER_READS_ITS_OWN\n"),
        ],
    ),
    (
        "M20 · read_transcript no longer reaches the caller's own profile's other conversations: only the spawn chain admits a reader — killed by `a-profile-reads-across-its-own-conversations.test.ts` — killed by `a-profile-reads-across-its-own-conversations.test.ts`",
        [
            (RUNTIME_HOST, "(this.ancestorsAsItWillRun(target).includes(reader) || this.ofOneIdentity(target, reader))", "(this.ancestorsAsItWillRun(target).includes(reader))"),
        ],
    ),
    (
        "M21 · two conversations this app can name no identity for are taken to be of ONE profile (null equals null) — killed by `a-profile-reads-across-its-own-conversations.test.ts` — killed by `a-profile-reads-across-its-own-conversations.test.ts`",
        [
            (RUNTIME_HOST, "return profile !== null && profile === this.profileOf(other)", "return profile === this.profileOf(other)"),
        ],
    ),
    (
        "M22 · a conversation may read its own transcript (the self guard is dropped, and since D-024 it is the only thing refusing it) — killed by `a-giver-looks-closer.test.ts` and `a-profile-reads-across-its-own-conversations.test.ts` — killed by `a-giver-looks-closer.test.ts`, `a-profile-reads-across-its-own-conversations.test.ts`",
        [
            (RUNTIME_HOST, "      target !== reader &&\n", "      true &&\n"),
        ],
    ),
    (
        "M23 · the not-a-conversation-below-you refusal tells an agent only its chain is read here, which is false since D-024 (the profile clause is gone) — killed by `a-profile-reads-across-its-own-conversations.test.ts` — killed by `a-profile-reads-across-its-own-conversations.test.ts`",
        [
            (AGENT_TOOLS, "only conversations you started, those started under them, and your profile’s other conversations are read here.", "only conversations you started, and those started under them, are read here."),
        ],
    ),
    (
        "M24 · list_tasks refuses a piece (or root) HELD by another conversation of the caller's profile: only the giver half of the profile reach is left — killed by `a-profile-reads-across-its-own-conversations.test.ts` — killed by `a-profile-reads-across-its-own-conversations.test.ts`",
        [
            (RUNTIME_HOST, "this.ofOneIdentity(row.owner, sessionId) ||", "false ||"),
        ],
    ),
    (
        "M25 · list_tasks refuses a piece GIVEN by another conversation of the caller's profile: only the owner half of the profile reach is left — killed by `a-profile-reads-across-its-own-conversations.test.ts` — killed by `a-profile-reads-across-its-own-conversations.test.ts`",
        [
            (RUNTIME_HOST, "(row.givenBy !== null && this.ofOneIdentity(row.givenBy, sessionId))", "false"),
        ],
    ),
    (
        "M26 · the made list is not scoped to the caller's profile: every profile's made files are listed — killed by `a-profile-reads-across-its-own-conversations.test.ts` — killed by `a-profile-reads-across-its-own-conversations.test.ts`",
        [
            (SESSION_STORE, "WHERE s.agent_identity_id = ?)\n          ORDER BY created_at DESC, id DESC\n          LIMIT ?", "WHERE s.agent_identity_id = ? OR 1 = 1)\n          ORDER BY created_at DESC, id DESC\n          LIMIT ?"),
        ],
    ),
    (
        "M27 · the made list follows who GAVE a piece instead of who owns it: a file made by another profile's conversation on a piece this profile gave is listed, and files made on its own roots are not — killed by `a-profile-reads-across-its-own-conversations.test.ts` — killed by `a-profile-reads-across-its-own-conversations.test.ts`",
        [
            (SESSION_STORE, "WHERE role = 'made'\n            AND work_id IN (SELECT w.id FROM work w\n                              JOIN provider_session s ON s.id = w.owner_session_id\n                             WHERE s.agent_identity_id = ?)\n          ORDER BY created_at DESC", "WHERE role = 'made'\n            AND work_id IN (SELECT w.id FROM work w\n                              JOIN provider_session s ON s.id = w.given_by_session_id\n                             WHERE s.agent_identity_id = ?)\n          ORDER BY created_at DESC"),
        ],
    ),
    (
        "M28 · the made list also lists the files a giver handed a piece as inputs (role is no longer 'made' only) — killed by `a-profile-reads-across-its-own-conversations.test.ts` — killed by `a-profile-reads-across-its-own-conversations.test.ts`",
        [
            (SESSION_STORE, "WHERE role = 'made'\n            AND work_id IN (SELECT w.id FROM work w\n                              JOIN provider_session s ON s.id = w.owner_session_id\n                             WHERE s.agent_identity_id = ?)\n          ORDER BY created_at DESC", "WHERE role IN ('made', 'input')\n            AND work_id IN (SELECT w.id FROM work w\n                              JOIN provider_session s ON s.id = w.owner_session_id\n                             WHERE s.agent_identity_id = ?)\n          ORDER BY created_at DESC"),
        ],
    ),
    (
        "M29 · the made list is oldest first, so with more than ten files it keeps the OLDEST ten — killed by `a-profile-reads-across-its-own-conversations.test.ts` — killed by `a-profile-reads-across-its-own-conversations.test.ts`",
        [
            (SESSION_STORE, "ORDER BY created_at DESC, id DESC\n          LIMIT ?", "ORDER BY created_at ASC, id ASC\n          LIMIT ?"),
        ],
    ),
    (
        "M30 · a sibling's root is told to the reader as its OWN work — killed by `a-profile-reads-across-its-own-conversations.test.ts` — killed by `a-profile-reads-across-its-own-conversations.test.ts`",
        [
            (AGENT_TOOLS, "    root.owner === reader\n      ? 'your own work, from a person'", "    true\n      ? 'your own work, from a person'"),
        ],
    ),
]
