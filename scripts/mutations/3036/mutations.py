"""3036 · a give's folder, granted on a conversation the giver already has, and the reads written
beside it: what a Codex thread holds of its lead, the model and effort a conversation last ran.

⛔ **The subject**: a folder named in a give to a conversation that exists is a GRANT on that
conversation for that piece alone — never on another helper of the same giver, and gone at the
first turn after its piece ends. The provider is handed the grant only with the turn that carries
its brief; the window shows it queued until a turn starts with it. A relative folder is read from
the giver's folder, `~` from the home folder, and a blank one is no folder. The giver is told what
the grant changes for THAT conversation, and a places check that throws is said, never a refusal.
Beside it: a Codex thread's lead is not held when this app failed its turn or its history was
rewritten; the older Claude conversations' model is read only from this app's own transcripts,
without overwriting a chosen model or the effort on record; the places a grant is compared with
include a redirected Claude home; a Claude turn's reported effort stands only while its ask does;
a reopen keeps the effort on record only on its first report; a sub-agent's reply never names the
conversation's model; and the provider's report wins over the setting.

## ⚑ What a row here measures

 * ⚑ **M1–M10 are the folder grant** (`runtime-host.ts`, `spawn-rails.ts`): the grant read from its
   own conversation's pieces (M1) and only its OPEN ones (M2); the brief that goes straight out
   carries its own grant (M3); the window's queued/applied state (M4); the receipt's reach for a
   conversation that runs without asking (M5) and by provider (M6); `~` (M7) and a blank folder
   (M8); a places check that throws, said as nothing (M9) or as a refusal (M10).
 * ⚑ **M11, M12 are what a Codex thread holds** (`codex-lead.ts`): a failed turn's lead, and a
   compaction or a new thread.
 * ⚑ **M13–M15 are the pass over the older conversations** (`recordWhatTheOlderOnesRan`): a link
   out of the profile's home (M13), a chosen model (M14), the effort on record (M15).
 * ⚑ **M16 is the places** (`protected-places.ts`): a redirected Claude home.
 * ⚑ **M17 is Claude's effort read back** (`claude-runtime.ts`): kept across an `init` only while
   the ask is the same.
 * ⚑ **M18 is a life's first report** (`recordWhatItReportsRunning`).
 * ⚑ **M19 is the newest reply's model** (`native-file.ts`): a side chain passed over.
 * ⚑ **M20 is the order of what was last reported** (`lastReportedOf`).

## ⛔ What this table does not contain

 * ⚠️ A relative folder read from this process's folder: table 726 plants it on the same line.
 * ⚠️ A grant read from the GIVER's pieces: the brief's own turn carries its grant whatever the read
   returns, so the gap test cannot tell it apart.
 * ⚠️ A held brief's grant carried before its brief (`delivered`): no gap test starts a turn while
   a brief is held and its piece open.
 * ⚠️ The Codex lead's other guards (the header-opening `sent`, a dropped heading, a row with no
   text, a launch with no record), the host's reset of the first turn's lead after a failure, the
   pass's adopted, Codex, live-conversation and quit guards, the reported-effort `''` guard, the
   wait composition and the context reading's cache — each has a gap test, left out to keep the
   table at twenty rows.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"
LEAD = "apps/desktop/src/main/runtime/codex-lead.ts"
PLACES = "apps/desktop/src/main/protected-places.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
NATIVE = "apps/desktop/src/main/archive/native-file.ts"

GRANT = "a-folder-grant-stays-on-its-piece-and-says-what-it-reaches.test.ts"
THREAD = "what-a-codex-thread-holds-read-from-its-record.test.ts"
OWN_RECORD = "the-model-a-transcript-records-is-read-only-from-this-apps-own-record.test.ts"
THE_PASS = "the-pass-over-older-conversations-skips-and-keeps-what-it-must.test.ts"
ENVIRONMENT = "the-places-on-this-computer-are-read-from-its-environment.test.ts"
AT_ITS_STOP = "a-claude-turns-effort-is-read-back-at-its-stop.test.ts"
FIRST_REPORT = "a-claude-lifes-first-report-keeps-the-effort-on-record.test.ts"
NEWEST_REPLY = "the-newest-reply-model-in-a-native-file.test.ts"
LAST_REPORTED = "who-called-whom-last-reported-and-context.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 **a grant rides every running conversation** · a folder given to one helper is "
        "handed to another helper of the same giver at its next turn, and named in its window · "
        f"killed by `{GRANT}`",
        [(HOST,
          "      return this.deps.store.openPiecesOf(conversation).flatMap((row) =>\n",
          "      return [...this.slots.keys()].flatMap((one) => this.deps.store.openPiecesOf(one)).flatMap((row) =>\n")],
    ),
    (
        "M2 · 🔴 **a piece that ended keeps its grant** · a closed piece's folder is still handed to "
        "the provider at every later turn, and a held brief taken back stays shown in the window · "
        f"killed by `{GRANT}`",
        [(HOST,
          "      return this.deps.store.openPiecesOf(conversation).flatMap((row) =>\n",
          "      return this.deps.store.piecesOwnedBy(conversation).flatMap((row) =>\n")],
    ),
    (
        "M3 · 🔴 a brief that goes straight out is handed over without its folder — its piece is "
        "written after the handover, so the turn that explains the grant never has it · killed by "
        f"`{GRANT}`",
        [(HOST,
          "      ...carrying.flatMap(({ grant }) => (grant === undefined ? [] : [filesystemSpelling(grant)])),\n",
          "")],
    ),
    (
        "M4 · a grant held with its brief is shown in force before any turn has it — the window "
        f"says `applied` where it is `queued` · killed by `{GRANT}`",
        [(HOST,
          "      state: effective.includes(grant.reaches) ? ('applied' as const) : ('queued' as const),\n",
          "      state: 'applied' as const,\n")],
    ),
    (
        "M5 · 🔴 a conversation that runs without asking is said to gain a write it already had — the "
        f"giver reads that the grant changed something · killed by `{GRANT}`",
        [(HOST,
          "    if (row?.approvalMode === 'auto') return 'already'\n",
          "")],
    ),
    (
        "M6 · 🔴 **the reach by the wrong provider** · Claude asking first is said to write without "
        "asking, and Codex asking first to still ask before changing anything · killed by "
        f"`{GRANT}`",
        # This row follows the same behavior after provider facts moved into the registry.
        [("apps/desktop/src/main/runtime/runtime-host.ts",
          # ⚑ **provider selection refactor · re-anchored in place, not retired** — The null case is explicit and the provider choice is exhaustive; reversing its values preserves the original wrong-reach fault.
          # ⚑ **provider registry · re-anchored in place, not retired** — The descriptor supplies grant reach; reversing reads and writes preserves the original wrong-provider fault and the null case.
          "    return row === null ? 'reads' : providerDescriptor(row.provider).approval.grantReach\n",
          "    return row === null ? 'reads' : providerDescriptor(row.provider).approval.grantReach === 'writes' ? 'reads' : 'writes'\n")],
    ),
    (
        "M7 · `~/x` is joined under the giver's folder instead of the home folder, so the grant names "
        f"a folder that is not there and is not granted · killed by `{GRANT}`",
        [(RAILS,
          "  return spelled !== '' && !isAbsolute(spelled) && spelled !== '~' && !spelled.startsWith('~/')\n",
          "  return spelled !== '' && !isAbsolute(spelled)\n")],
    ),
    (
        "M8 · a blank folder on a give to a conversation it has is checked as a folder — the receipt "
        f"says what a grant reaches where nothing was granted · killed by `{GRANT}`",
        [(RAILS,
          "    if (asked.folder !== undefined && asked.folder.trim() !== '') {\n",
          "    if (asked.folder !== undefined) {\n")],
    ),
    (
        "M9 · 🔴 a places check that throws is said as nothing: the folder is granted and the giver "
        f"is never told it could not be checked · killed by `{GRANT}`",
        [(HOST,
          "      return { kind: 'could-not-check' }\n",
          "      return null\n")],
    ),
    (
        "M10 · 🔴 a places check that throws refuses the give — a folder whose place cannot be read "
        f"stops the work going, where it is only ever to be said · killed by `{GRANT}`",
        [(HOST,
          "      return { kind: 'could-not-check' }\n",
          "      throw error\n")],
    ),
    (
        "M11 · 🔴 **a failed turn's lead read as held** · a lead whose turn this app ended as failed "
        "is taken as in the thread, so the reopen sends nothing and the thread never has its "
        f"instructions · killed by `{THREAD}`",
        [(LEAD,
          "      if (pending !== null && row.failedByThisApp) {\n",
          "      if (pending !== null && false) {\n")],
    ),
    (
        "M12 · 🔴 a compaction or a new thread no longer empties what the thread holds — the lead it "
        f"lost is never sent again · killed by `{THREAD}`",
        [(LEAD,
          "    if (row.rowType === 'compaction' || row.rowType === 'conversation_reset') {\n",
          "    if (false) {\n")],
    ),
    (
        "M13 · 🔴 a transcript named like a record that links out of the profile's home is read, and "
        f"its model written as this conversation's · killed by `{OWN_RECORD}`",
        [
            ("apps/desktop/src/main/providers/claude/transcripts.ts", "  readEarlierModel: (home, file) => (ownsRecord(home, file) ? newestReplyModel(file) : null),", "  readEarlierModel: (_home, file) => newestReplyModel(file),"),
        ],
    ),
    (
        "M14 · a conversation with a chosen model is given its transcript's model as a report — the "
        f"API's spelling, never the CLI's · killed by `{THE_PASS}`",
        [(HOST,
          "      if (runsOn === null || runsOn.reportedModel !== null || runsOn.model !== null) continue\n",
          "      if (runsOn === null || runsOn.reportedModel !== null) continue\n")],
    ),
    (
        "M15 · the pass that writes an older conversation's model wipes the effort on record · "
        f"killed by `{THE_PASS}`",
        [(HOST,
          "        this.deps.store.setReportedModel(one.sessionId, model, runsOn.reportedEffort)\n",
          "        this.deps.store.setReportedModel(one.sessionId, model, null)\n")],
    ),
    (
        "M16 · 🔴 a Claude home redirected by `CLAUDE_CONFIG_DIR` is not among the places, so a "
        f"grant on the sign-in folder is said as nothing · killed by `{ENVIRONMENT}`",
        [
            ("apps/desktop/src/main/providers/claude/discovery.ts", "    ...new Set([join(home, '.claude'), userHome(env, homedir)]),", "    ...new Set([join(home, '.claude'), userHome(process.env, homedir)]),"),
        ],
    ),
    (
        "M17 · a new effort asked of Claude is shown as the old turn's reported level at the next "
        f"`init` · killed by `{AT_ITS_STOP}`",
        [(CLAUDE,
          "            reported !== undefined && reported.model === message.model && reported.asked === asked\n",
          "            reported !== undefined && reported.model === message.model\n")],
    ),
    (
        "M18 · every report with no effort keeps the effort on record, not only a life's first — a "
        f"moved ask goes on showing the old level · killed by `{FIRST_REPORT}`",
        [
            ("apps/desktop/src/main/runtime/runtime-host.ts", "        effort === null &&\n        firstOfThisLife &&\n        providerDefinitions[session.provider].transcripts.keepEarlierReportedEffort()", "        effort === null &&\n        providerDefinitions[session.provider].transcripts.keepEarlierReportedEffort()"),
        ],
    ),
    (
        "M19 · a sub-agent's newer reply (`isSidechain`) names the conversation's model · killed by "
        f"`{NEWEST_REPLY}`",
        [
            ("apps/desktop/src/main/providers/claude/native-record.ts", "        if (entry.type !== 'assistant' || entry.isSidechain === true) return null\n", "        if (entry.type !== 'assistant') return null\n"),
        ],
    ),
    (
        "M20 · a set model wins over the one its provider reported, so a stopped helper is shown "
        f"running what it was asked for · killed by `{LAST_REPORTED}`",
        [(HOST,
          "        ...(runsOn.reportedModel !== null\n",
          "        ...(runsOn.reportedModel !== null && runsOn.model === null\n")],
    ),
]
