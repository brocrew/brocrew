"""448 · A list that notices, and a result that says who asked — two halves of one defect.

⛔ **`447` could not attribute the defect the person found, and said why in two sentences.** The first
is a stale roster in the renderer that a restart repaired. The second is that *the list was
filtered* and *the list was stale* are the same bytes from outside a tool answer — so the
investigation ended in *I cannot honestly attribute this*, and the evidence that would have
settled it was never written anywhere.

| § | the subject | where `447` left it |
|---|---|---|
| §1 | approving a proposal re-reads the roster this window draws | §7.5 item 1 |
| §2 | the screen routes its decision through the join rather than deciding alone | §7.5 item 1 |
| §3 | the answer carries the reach it was FOLDED through, in `MESSAGING_REACH`'s own words | §7.5 item 2 |
| §4 | that word is the one the fold used, and it leads the half a person can read | §7.5 item 2 |

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M4` | ⚑ **`apps/desktop/test/a-list-that-notices.test.ts`** §1 |
| `M5` | ⚑ **`apps/desktop/test/a-list-that-notices.test.ts`** §2 — the screen's census |
| `M6`-`M9` | ⚑ **`apps/desktop/test/a-count-that-says-what-it-counted.test.ts`** §1 and §4 |
| `M10`-`M14` | ⚑ **`apps/desktop/test/a-count-that-says-what-it-counted.test.ts`** §1 |
| `M15`-`M16` | ⚑ **`apps/desktop/test/a-count-that-says-what-it-counted.test.ts`** §2 |
| `M17`-`M19` | ⚑ **`apps/desktop/test/a-count-that-says-what-it-counted.test.ts`** §3 and §4 |
| `M20` | ⚑ **`apps/desktop/test/a-count-that-says-what-it-counted.test.ts`** §4 — the description |
| `M26`-`M29` | ⚑ **`apps/desktop/test/a-list-that-notices.test.ts`** §2 and §2b — the ACT census, relay 1 |
| `M30` | ⚑ **`apps/desktop/test/a-list-that-notices.test.ts`** §1 and §1d |

## ⚑ Why `M1` and `M3` anchor on one line

⛔ **The gate and the read are the same statement**, and the two rows ask different questions of
it: `M1` inverts the gate, so an approval stops re-reading AND a refusal starts; `M3` widens it, so
every decision re-reads and the refusal control stops being a control. ⚠️ Applied separately, as
every row is — `verify-each-mutation-row-without-running-the-table`.

## 🔴 `M2` WAS REMOVED, MEASURED AGAIN, AND RESTORED

⛔ **First run: it dropped the `await` on the decision and SURVIVED.** The row was removed with
its measurement — `RuntimeHost.decideProposal` is synchronous and `executeRuntimeCommand` reaches
it with no `await` in front of the switch, so under the node harness, which calls that dispatcher
in-process, the `project` row is written before the read either way.

⚠️ **That is a fact about the HARNESS, not about the product.** The shipped path is
`ipcRenderer.invoke` across a process; what orders the two calls there is that the decision's
dispatch writes the row before the `projects` invoke behind it is served. ⚑ So the sequencing is
real and the instrument was wrong — and `decide-proposal.ts` is a pure join over two `Pick<>`
interfaces, which makes the ordering measurable against two five-line fakes. 🔴 **`a-list-that-notices`
§1c is that measurement, and `M2` is red against it.**

## 🔴 RELAY 1 · `M26`-`M30`, and why there were two presses

⛔ **`M5` was right about the file and the file was not the subject.** `446` landed a SECOND
decide path — the attention-queue row — after this branch was cut, so it never appeared in the
census, reached `store.decideProposal` directly, and re-read nothing. ⚠️ **The person clearing a
proposal from the QUEUE got exactly the stale roster `447` measured**, and `main` went red on the
assertion rather than on the defect.

⚑ **So the census moved from a FILE to the ACT**: every `.decideProposal(` call expression under
`src/renderer`, which must be the door and the store and nothing else. 🔴 `M26` is `M5` one press
over; `M27`-`M29` are the arguments that differ between the two presses, which is where a queue
that answers the conversation on SCREEN would hide.

⚠️ **`M30` is on the JOIN, and `M28` is the same swap one function out.** ⛔ **A draft of this
paragraph said the forwarding *"was never measured"* — that was false and this dispatch's own
review said so**: in §1 the two ids are `sess_N` and `prop_<hex>`, so swapping them refuses at the
host and §1's first test is already red. ⚑ What §1d adds is the thing one conversation cannot
show: that the project which lands is *the one that was named*, with another proposal waiting
beside it.

⚠️ **And `M27` was rewritten after the review.** Its first form substituted a bare `activeId.value`
— `Ref<string | null>` where the join wants `string` — which `pnpm run typecheck` rejects before
any test runs, so the row would have been recording the compiler's work as the census's. ⛔ The
form that ships narrows with `??`, typechecks, and is a real wrong behaviour: the overview would
answer whatever is on screen whenever anything is.

## ⛔ What this table deliberately does NOT contain

⚠️ **No row that removes `reach` from `ProjectReading`.** It is a REQUIRED member, so deleting it
is a type error, and a type error fails every suite at once — a phantom kill that says nothing
about which assertion carries the rule. ⚑ `M10` and `M11` are the honest form: the field stays and
answers the wrong thing.

⚠️ **No row on `REACH_LISTS.none`.** A caller granted `none` is refused at `may-not-read-a-project`
before any roster is read, so no edit to that sentence changes a byte any reader can see — it
would report as a survivor (`a-mutation-that-changes-nothing-reports-as-a-survivor`). ⛔ What the
row is replaced by is an assertion instead: §1 pins that the refusal arm carries no `count_covers`
at all.

⚠️ **No row on the person's own `create`/`save` re-read.** `project-store.ts` has re-read since
`376` and `427`; this dispatch changed neither, and a row there would be `427`'s to write.

⚠️ **No row on a second window.** There is exactly one `new BrowserWindow` in this app; the two
`createWindow()` callers that can run while it is already up are each guarded by *there is no
window*, the third is the startup call that runs before any window exists, and the navigation
guard denies every `window.open`. So a row asserting cross-window invalidation would be measuring
a state the product cannot reach.
"""

JOIN = "apps/desktop/src/renderer/src/lib/decide-proposal.ts"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
RAILS = "apps/desktop/src/main/runtime/message-rails.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
WORDS = "apps/desktop/src/shared/capabilities.ts"

# ⚑ **relay 1's subject, spelled once.** `446`'s press and `441`'s card differ in one argument
# that MEANS anything — which conversation is answered — but all three of their ids are spelled
# differently, so an anchor naming only the verb would match both presses.
QUEUE_BLOCK = (
    "    void decideProposalAndReread(\n"
    "      store,\n"
    "      projectStore,\n"
    "      agentStore,\n"
    "      request.sessionId,\n"
    "      request.requestId,\n"
    "      answer.proposal.approve,\n"
    "    )"
)

MUTATIONS = [
    # ── §1 · the roster this window draws catches up ────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** Its subject, `decide-proposal.ts` (the
        # join that re-reads the project and agent rosters after a proposal is decided), was deleted
        # by bd70d693: "Proposals go end to end, with the demo seed, the renderer fixtures and
        # takes_work_from". There is no decision to gate a re-read on, and the killer
        # `a-list-that-notices.test.ts` was deleted with it. Its anchor is left stale, so the census
        # records it retired.
        "M1 · 🔴 THE DEFECT 447 FOUND, inverted rather than removed · an approval no longer "
        "re-reads the roster and a refusal does, so the rail stays one project behind the "
        "database for exactly as long as the window lives",
        [(JOIN, "  if (approve && ack?.outcome === 'taken') await Promise.all([projects.loadAll(), agents.load()])",
                "  if (!approve) await Promise.all([projects.loadAll(), agents.load()])")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `await
        # sessions.decideProposal(...)` ordering it plants sat in `decide-proposal.ts`, which
        # bd70d693 deleted along with proposals. Its killer (`a-list-that-notices` §1c, the
        # two-fakes ordering test) is deleted too. Its anchor is left stale, so the census records
        # it retired.
        "M2 · ⛔ the rosters are read BESIDE the decision rather than after it · the `await` goes "
        "and the two wire calls race, which on the shipped path is a read of the ledger a process "
        "away as it was before the person pressed",
        [
            (
                JOIN,
                "  const ack = await sessions.decideProposal(sessionId, proposalId, approve)\n"
                "  // \u26d4 **After the decision, and the ORDER is the contract**",
                "  void sessions.decideProposal(sessionId, proposalId, approve)\n"
                "  // \u26d4 **After the decision, and the ORDER is the contract**",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** It widens the approve-only gate in
        # `decide-proposal.ts`. Proposals and that file are gone ("Proposals go end to end"), and
        # its killer `a-list-that-notices.test.ts` no longer exists. Its anchor is left stale, so
        # the census records it retired.
        "M3 · ⚠️ the gate widens to every decision · a refusal re-reads too, which costs a wire "
        "call on a gesture that creates nothing and makes the positive unfalsifiable",
        [
            (
                JOIN,
                "  if (approve && ack?.outcome === 'taken') await Promise.all([projects.loadAll(), agents.load()])",
                "  if (typeof approve === 'boolean') await Promise.all([projects.loadAll(), agents.load()])",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The subject went on purpose:
        # `decide-proposal.ts` (the join that re-reads the roster after a proposal decision) is
        # deleted in bd70d693, whose message says 'Proposals go end to end'. Nothing in src still
        # calls `decideProposal` or `projects.loadAll()`, so there is no decision-then-re-read order
        # left to protect. Its anchor is left stale, so the census records it retired.
        "M4 · ⛔ the re-read happens BEFORE the decision · the roster is refreshed against the "
        "ledger as it was, which is the reading order the docblock exists to forbid and the one "
        "that looks right in a diff",
        [
            (
                JOIN,
                "  const ack = await sessions.decideProposal(sessionId, proposalId, approve)\n"
                "  // \u26d4 **After the decision, and the ORDER is the contract**",
                "  // \u26d4 **After the decision, and the ORDER is the contract**",
            ),
            (
                JOIN,
                "  if (approve && ack?.outcome === 'taken') await Promise.all([projects.loadAll(), agents.load()])\n}",
                "  if (approve && ack?.outcome === 'taken') await Promise.all([projects.loadAll(), agents.load()])\n"
                "  const ack = await sessions.decideProposal(sessionId, proposalId, approve)\n}",
            ),
        ],
    ),
    # ── §2 · the screen decides through the join ────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `RuntimeScreen.vue` no longer has
        # `decideProposalAndReread`, and `decideProposal` is gone from the session store, the IPC
        # and the host. bd70d693 ('Proposals go end to end, with the demo seed, the renderer
        # fixtures ...') removed the whole decide path, and `a-list-that-notices.test.ts`, the row's
        # killer, is deleted in the same commit. Its anchor is left stale, so the census records it
        # retired.
        "M5 · 🔴 the screen goes back to deciding alone · the exact three lines 447 measured, "
        "restored — the session store called directly, the project store never told",
        [
            (
                SCREEN,
                "    void decideProposalAndReread(\n"
                "      store,\n"
                "      projectStore,\n"
                "      agentStore,\n"
                "      activeId.value,\n"
                "      proposalId,\n"
                "      approve,\n"
                "    )",
                "    void store.decideProposal(activeId.value, proposalId, approve)",
            )
        ],
    ),
    # ── §3 · the reach a fold used, read once and handed out ────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `reachOf` and the `reach` word that
        # rode beside `list_projects` were part of the project listing, which bd70d693 removes
        # ('create_project and list_projects ... are removed'). No listing carries a folded reach
        # word any more: `count_covers` survives only on `list_profiles` and `list_documents` as
        # fixed sentences. The killer `a-count-that-says-what-it-counted.test.ts` is deleted. Its
        # anchor is left stale, so the census records it retired.
        "M6 · 🔴 the reported reach reads the WRONG COLUMN · `can_interrupt` instead of "
        "`can_message`, so the word beside a project listing describes a grant that filtered "
        "nothing — 433's ruling reported as its opposite",
        [
            (
                RAILS,
                "  return allowed === null ? null : allowed[REACH_OF[act]]",
                "  return allowed === null ? null : allowed[REACH_OF['interrupt']]",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'admitted arm' this row targets
        # was `list_projects`' ok payload, and `reachOf` is deleted with it (bd70d693:
        # 'create_project and list_projects ... are removed'). The rule 'no grant read means no
        # reach reported' still holds on `admitReachAtAll`'s refusal arm, but that is already 374's
        # M11 (see other_notes), so a re-anchor here would duplicate it. The killer
        # `a-count-that-says-what-it-counted.test.ts` is deleted. Its anchor is left stale, so the
        # census records it retired.
        "M7 · ⛔ a reader with no grant is reported as one granted nothing · `null` becomes "
        "`'none'`, which states a column value nobody read — MessageRefusalDetail.reach's rule, "
        "broken on the admitted arm",
        [
            (
                RAILS,
                "  return allowed === null ? null : allowed[REACH_OF[act]]",
                "  return allowed === null ? 'none' : allowed[REACH_OF[act]]",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `const reach = reachOf('read',
        # allowed)` was in `projectsVisibleTo`, the host door for `list_projects`, and both are
        # deleted. There is no `read` act left: `MESSAGING_ACTS` is now only `message` and `assign`,
        # and `REACH_OF` has just those two entries. The killer
        # `a-count-that-says-what-it-counted.test.ts` is deleted. Its anchor is left stale, so the
        # census records it retired.
        "M8 · ⚠️ the door asks for the wrong ACT · `end` reads `can_interrupt` through the same "
        "table, so the answer is filtered by one grant and labelled with another",
        [(HOST, "    const reach = reachOf('read', allowed)", "    const reach = reachOf('end', allowed)")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The named arm was `list_projects`
        # called with a project, and `projectsVisibleTo`/`reportOn` no longer exist (bd70d693:
        # 'create_project and list_projects ... and the project argument on spawn_agent and
        # list_agents are removed'). `list_agents` has no named-project arm. The killer
        # `a-count-that-says-what-it-counted.test.ts` is deleted. Its anchor is left stale, so the
        # census records it retired.
        "M9 · ⛔ the named arm forgets what admitted it · a caller that asked about one project is "
        "told a count of one with no word saying whether anything else exists",
                # ⚑ 676 · anchor CORRECTED, not retired: F1 built the report into a `const` first
                # and gave the answer its count; the named arm's `reach` is the same subject.
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — 676 already split this
        # single-line return into a multi-line object and added `...ledgersSkippedOf(...)`, and
        # D-017 left that shape untouched. The named arm still closes over the same `reach` computed
        # once at the top of the method, so forcing `reach: null` in just this arm still plants 'the
        # named arm forgets what admitted it' while the unnamed arm (M10's subject) is untouched.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The named arm of
        # projectsVisibleTo still closes over the single `reach` computed once at the top of the
        # method and returns it in its ok payload. Only reportOn's argument order shifted (this
        # landing tree already carries a prior re-anchor of this row for commit 2's shape; commit 3
        # reordered the args again to `(unread, by, me)`), so the anchor text needs updating again
        # but the rule (the named arm must report what admitted it) is unchanged.
        [
            (HOST, "      const projects = this.reportOn([named], unread, by, me)\n      return {\n        outcome: 'ok',\n        projects,\n        reach,", "      const projects = this.reportOn([named], unread, by, me)\n      return {\n        outcome: 'ok',\n        projects,\n        reach: null,"),
        ],
    ),
    # ── §4 · what the payload and the text say ──────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The unnamed `list_projects` return in
        # `projectsVisibleTo` (and `reportOn`) is gone: bd70d693 says "create_project and
        # list_projects ... are removed", and the card says "same-project reach" goes. No project
        # listing carries a reach word any more, and the killer
        # `a-count-that-says-what-it-counted.test.ts` is deleted. `list_profiles` has its own
        # reach-free `count_covers` sentence under table 488. Its anchor is left stale, so the
        # census records it retired.
        "M10 · 🔴 THE PAYLOAD GOES BACK TO 447's STATE · the unnamed listing carries no reach, so "
        "a fifty-project app folded to one and a one-project app are the same bytes again",
                # ⚑ 676 · anchor CORRECTED, not retired: the unnamed listing's return is one line
                # now, after the `const` that carries its count.
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — Same reshaping as M9
        # applied to the unnamed-listing return; the `reach` computed once at the top of the method
        # is still what both arms are supposed to report. Forcing `reach: null` here still plants
        # '447's state is restored' — a fifty-project app folded to one and a one-project app become
        # indistinguishable bytes.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same story as M9 one arm
        # over: the unnamed listing still returns the same closed-over `reach`, and reportOn's
        # argument order shift is the only thing that moved the anchor. 448's own rule — the unnamed
        # listing must carry a real reach word rather than silently reverting to the pre-448 payload
        # — still holds.
        [
            (HOST, "    const projects = this.reportOn(\n      roster.filter((slug) => admits(slug) === null),\n      unread,\n      by,\n      me,\n    )\n    return {\n      outcome: 'ok',\n      projects,\n      reach,", "    const projects = this.reportOn(\n      roster.filter((slug) => admits(slug) === null),\n      unread,\n      by,\n      me,\n    )\n    return {\n      outcome: 'ok',\n      projects,\n      reach: null,"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `...(reading.reach === null ? {} :
        # { reach })` spread belonged to the `list_projects` answer, which was removed
        # ("create_project and list_projects ... are removed"). No tool answer in `agent-tools.ts`
        # reads `reading.reach` now, and the killer test is deleted. Its anchor is left stale, so
        # the census records it retired.
        "M11 · ⛔ the key is present exactly when it should be absent · a person's unnarrowed "
        "listing grows a reach word, and a folded one loses it",
        [
            (
                TOOLS,
                "              ...(reading.reach === null ? {} : { reach: reading.reach }),",
                "              ...(reading.reach === null ? { reach: reading.reach } : {}),",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The sentence keyed on the grant
        # (`REACH_LISTS` / `NOTHING_NARROWED_THE_LIST`) went with `list_projects` and the project
        # fold; those constants no longer exist in capabilities.ts. Today's remaining listings have
        # no fold to key a sentence on ("No wall and no fold (D-014)"). Its anchor is left stale, so
        # the census records it retired.
        "M12 · ⚠️ every answer claims nothing narrowed it · the sentence stops being keyed on the "
        "grant, which is the false global claim 447 measured, written into the app itself",
        [
            (
                TOOLS,
                "              : reading.reach === null\n"
                "                ? NOTHING_NARROWED_THE_LIST\n"
                "                : REACH_LISTS[reading.reach]",
                "              : NOTHING_NARROWED_THE_LIST",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `REACH_LISTS[reading.reach]` and the
        # `count_covers` reach lookup were removed with `list_projects` (commit: "create_project and
        # list_projects ... are removed"). There is no grant-to-sentence lookup left to echo, and
        # the killer test is deleted. Its anchor is left stale, so the census records it retired.
        "M13 · ⛔ the payload echoes the grant instead of looking it up · `count_covers` becomes "
        "the bare word, so a model meets a code where it needed a sentence",
        [
            (
                TOOLS,
                "                : REACH_LISTS[reading.reach]",
                "                : reading.reach",
            )
        ],
    ),
    (
        "M14 · ⚠️ the count stops counting the rows it returned · `count` and the length of "
        "`projects` come apart, so the number a model quotes is not the number of reports beside it",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — list_projects and its `count: projects.length` are gone, but
        # list_documents (agent-tools.ts ~5279) still answers `count: documents.length` beside
        # `count_covers`, and no table plants it. The refutation holds: the plant makes `count` 3
        # beside two documents, and test §2 '🔴 no argument is every document, oldest first — and the
        # count says so' asserts `expect(listed.count).toBe(2)` at line 331, so it goes red on the
        # number and on nothing else. The label should say `documents` for `projects`. `count:
        # profiles.length` in list_profiles (~5218) is an equally valid twin, killed by
        # who-exists-and-what-they-were-told.test.ts lines 215 and 238, if a second row is wanted.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a tool's count must equal the length of the rows it returns beside it. The
        # original site, list_documents' count, is gone with documents ('list_documents is gone' in
        # 5e931be8), and the table's killer a-count-that-says-what-it-counted.test.ts no longer
        # exists. list_profiles carries the same rule as count: profiles.length beside count_covers,
        # pinned by who-exists-and-what-they-were-told.test.ts, so the plant moves there. Killed by
        # `who-exists-and-what-they-were-told.test.ts`.
        [
            (TOOLS, '              count: profiles.length,', '              count: profiles.length + 1,'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `covers` sentence leading the text
        # half of `list_projects` went with that tool ("list_projects ... removed"). The same rule
        # survives on `list_profiles` (table 488 M9 plants it, killed by
        # who-exists-and-what-they-were-told) and on `list_documents`, where no test pins the text
        # half, so a re-anchor there would survive. Its anchor is left stale, so the census records
        # it retired.
        "M15 · 🔴 the sentence moves to the END of the text half · it is still in the payload and "
        "no longer in the 200 characters a `tool_result` summary keeps, which is the only part of "
        "a tool answer a person can read in this app",
                # ⚑ 676 · anchor CORRECTED, not retired: F1's unread sentence now sits last, so
                # `covers` is moved to the end behind it — still out of the kept 200 characters.
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — D-017 inserted
        # `...whenSkipped(reading.ledgersSkipped, skippedRecordsSentence),` as a new line right
        # before the array's closing `].join('\n'),` in list_projects' answer, so edit 2's old text
        # (which ended right after the rowsUnread line) no longer matches even though edit 1
        # (stripping `covers,` from the front) still does. The rule the row protects — `covers` must
        # lead the text half so it survives `tool_result`'s 200-char cut (`TOOL_SUMMARY_MAX`) — is
        # untouched by this commit; `covers` just needs to be pushed behind one more sibling line to
        # plant the same 'moved to the end' defect.
        [
            (TOOLS, '            [\n              covers,\n              ...(projects.length === 0', '            [\n              ...(projects.length === 0'),
            (TOOLS, "              ...(reading.rowsUnread === 0 ? [] : [unreadRowsSentence(reading.rowsUnread)]),\n              ...whenSkipped(reading.ledgersSkipped, skippedRecordsSentence),\n            ].join('\\n'),", "              ...(reading.rowsUnread === 0 ? [] : [unreadRowsSentence(reading.rowsUnread)]),\n              ...whenSkipped(reading.ledgersSkipped, skippedRecordsSentence),\n              covers,\n            ].join('\\n'),"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `covers` line in the
        # `list_projects` text half is deleted with the tool (bd70d693: "create_project and
        # list_projects ... are removed"). `list_documents` still has `covers,` first in its text
        # half, but no test asserts it, so a plant there would survive. `list_profiles` is already
        # row 488 M9. Its anchor is left stale, so the census records it retired.
        "M16 · ⛔ the text half stops carrying it at all · the structured payload still says the "
        "list was folded and the half a person sees does not",
        [
            (
                TOOLS,
                "            [\n              covers,\n              ...(projects.length === 0",
                "            [\n              ...(projects.length === 0",
            )
        ],
    ),
    # ── §5 · one vocabulary, and the clause that carries the harm ───────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The folded-reach sentence
        # `REACH_LISTS['same-project']` ("You may be told about your own project and no other...")
        # is gone from capabilities.ts. `same-project` reach was removed ("same-project reach ...
        # removed"), and MESSAGING_REACH is now just `none` and `any`. Its anchor is left stale, so
        # the census records it retired.
        "M17 · 🔴 the clause the harm turned on is dropped · a folded listing still says something "
        "true and no longer says that its count is not a count of every project",
        [
            (
                WORDS,
                "    'You may be told about your own project and no other, so this counts what you may be told about and not what exists.',",
                "    'You may be told about your own project and no other.',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `REACH_LISTS.any` ("...so this counts
        # every project this app has") no longer exists; the project listing it described was
        # removed with `list_projects`. The two-reaches-one-sentence defect cannot occur with no
        # per-reach project sentences, and the killer test is deleted. Its anchor is left stale, so
        # the census records it retired.
        "M18 · ⛔ two reaches say one sentence · a folded answer and an exhaustive one are "
        "distinguishable by a field whose two values read identically",
        [
            (
                WORDS,
                "  any: 'You may be told about every project, so this counts every project this app has.',",
                "  any: 'You may be told about your own project and no other, so this counts what you may be told about and not what exists.',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `NOTHING_NARROWED_THE_LIST` was
        # deleted from capabilities.ts along with the project listing that used it. `list_profiles`
        # and `list_documents` use `EVERY_AGENT_THIS_APP_HOLDS` and a local `covers` string, and
        # neither has a no-grant arm. Its anchor is left stale, so the census records it retired.
        "M19 · ⚠️ the no-grant sentence becomes a fourth reach wearing the same clothes · a reader "
        "that never met a rail is described as one that did",
        [
            (
                WORDS,
                "export const NOTHING_NARROWED_THE_LIST =\n"
                "  'Nothing narrowed this list; it counts every project this app has.'",
                "export const NOTHING_NARROWED_THE_LIST =\n"
                "  'You may be told about every project, so this counts every project this app has.'",
            )
        ],
    ),
    (
        "M20 · ⛔ the tool stops saying that its count is bounded · standing rule 5's shape — the "
        "sentence a model reads before it ever sees a payload, removed in silence",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The list_projects description is gone, but list_profiles (agent-tools.ts
        # ~5183) still ends its description with 'The answer says in words what the count covers —
        # read that before summarising it.' I checked every table: nothing plants that clause. 488
        # M9 pins only the covers-first text half, M8 and M10 are retired, and grep of
        # scripts/mutations for 'what the count covers' finds nothing. Removing it leaves the
        # description ending 'succeed.' and makes §3 '⛔ the sentence says the count is of what this
        # app HOLDS, and the description points at it' fail at line 297,
        # `expect(one?.description).toContain('what the count covers')`, so the row is still a live
        # kill and retiring it would lose it.
        [
            (TOOLS, ' The answer says in words what the count covers — read that before summarising it.', ''),
        ],
    ),
    # ── §6 · the named arm, and the other roster — both found by this dispatch's own review ────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The named-arm sentence (`asked !==
        # undefined ? ONE_PROJECT_YOU_NAMED`) belonged to `list_projects`' optional `project`
        # argument, which went with the tool. No remaining list tool has a named arm that borrows a
        # fold sentence. Its anchor is left stale, so the census records it retired.
        "M21 · 🔴 THE REGRESSION THE REVIEW FOUND, restored · `covers` keyed on the grant alone, "
        "so an `any` caller naming one project is told in words that one is all there are — 447's "
        "harm affirmed rather than implied, in the field built to close it",
        [
            (
                TOOLS,
                "            asked !== undefined\n"
                "              ? ONE_PROJECT_YOU_NAMED\n"
                "              : reading.reach === null",
                "            reading.reach === null",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `asked` and the named/unnamed split
        # existed only in `list_projects`, which bd70d693 removed. The `asked !== undefined` anchor
        # is gone from agent-tools.ts. Its anchor is left stale, so the census records it retired.
        "M22 · ⛔ the named arm borrows the unnamed arm's sentence one word over · `asked` is "
        "read as its negation, so a listing is labelled as a named read and a named read as a "
        "listing",
        [
            (
                TOOLS,
                "            asked !== undefined\n",
                "            asked === undefined\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `ONE_PROJECT_YOU_NAMED` was deleted
        # from capabilities.ts with the `list_projects` named arm ("list_projects ... removed"). The
        # defect (a one-project answer claiming a total) has no surface left. Its anchor is left
        # stale, so the census records it retired.
        "M23 · ⚠️ the named arm's sentence claims a total · the one-project answer says what an "
        "exhaustive listing says, which is the exact clause the review caught",
        [
            (
                WORDS,
                "export const ONE_PROJECT_YOU_NAMED =\n"
                "  'You asked about one project, so this counts that project alone and says nothing about how many there are.'",
                "export const ONE_PROJECT_YOU_NAMED =\n"
                "  'You may be told about every project, so this counts every project this app has.'",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** It plants the agent-roster half of the
        # proposal-approval re-read in `decide-proposal.ts` (an approved standing agent). Proposals
        # go end to end, so no approval writes an `agent_identity` row through this path, and the
        # file and its killer test are deleted. Its anchor is left stale, so the census records it
        # retired.
        "M24 · 🔴 the OTHER roster goes back to stale · an approved standing agent writes an "
        "`agent_identity` row and the window's agent store is never told, which is 447's finding "
        "one table over and the half a draft of this dispatch priced at nothing",
        [
            (
                JOIN,
                "  if (approve && ack?.outcome === 'taken') await Promise.all([projects.loadAll(), agents.load()])",
                "  if (approve) await projects.loadAll()",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** It plants the project-roster half of
        # the same proposal-approval re-read in `decide-proposal.ts`. Both the file and the
        # proposals it served were removed by bd70d693, and `a-list-that-notices.test.ts` §1b is
        # gone. Its anchor is left stale, so the census records it retired.
        "M25 · ⛔ the project roster goes back to stale while the agent one is kept · the two "
        "halves are separable, and a fix that covered only the one it was briefed about would "
        "pass every test written before the review",
        [
            (
                JOIN,
                "  if (approve && ack?.outcome === 'taken') await Promise.all([projects.loadAll(), agents.load()])",
                "  if (approve) await agents.load()",
            )
        ],
    ),
    # ── relay 1 · the OTHER press, and the argument that differs ────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** It plants the attention queue's
        # proposal press (`decideProposalAndReread(...)` in RuntimeScreen.vue) falling back to a
        # bare `store.decideProposal`. The proposal press and `decideProposal` were removed
        # ("Proposals go end to end"), and the queue now has only the permission and user-input
        # presses. Its anchor is left stale, so the census records it retired.
        "M26 · 🔴 THE DEFECT THAT TURNED main RED · 446's queue press goes back to deciding "
        "alone, which is M5 one surface over — a person clearing a proposal from the attention "
        "queue gets the stale roster 447 measured, and no census scoped to one file can see it",
        [
            (
                SCREEN,
                QUEUE_BLOCK,
                "    void store.decideProposal(request.sessionId, request.requestId, answer.proposal.approve)",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** Its anchor was the proposal press,
        # which is deleted. The rule survives on the queue's permission and user-input presses in
        # `decideFromOverview`, but table 444 M1 and M2 already plant exactly `activeId.value ??
        # request.sessionId` on both, killed by persons-queue.test.ts. A re-anchor would be a
        # byte-identical duplicate row. Its anchor is left stale, so the census records it retired.
        "M27 · \u26d4 the queue prefers the conversation ON SCREEN · the row's session only when "
        "nothing is selected, which is the one mistake the overview exists not to make and which "
        "TYPECHECKS, unlike the bare `activeId.value` a draft of this row used",
        [
            (
                SCREEN,
                "      request.sessionId,\n      request.requestId,",
                "      activeId.value ?? request.sessionId,\n      request.requestId,",
            )
        ],
    ),
    (
        "M28 · \u26a0\ufe0f the row's two ids are swapped · both are plain strings in a component "
        "nothing mounts, so the proposal id arrives as a session and every approval from the "
        "queue is refused as no such conversation",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The proposal press is
        # gone, but `decideFromOverview` still answers the queue with `request.sessionId,
        # request.requestId` for permissions and user input, and no other row plants a swap of those
        # two ids. Plant the swap on both surviving presses; both are plain strings, so it
        # typechecks. persons-queue.test.ts 'hands them the ROW's own ids' asserts both exact call
        # prefixes. The label should say a permission or question id arrives as a session, and every
        # answer from the queue is refused as no such conversation, instead of "every approval".
        [
            (SCREEN, '    void store.respondPermission(request.sessionId, request.requestId, answer.permission)', '    void store.respondPermission(request.requestId, request.sessionId, answer.permission)'),
            (SCREEN, '  void store.respondUserInput(request.sessionId, request.requestId, answer.userInput)', '  void store.respondUserInput(request.requestId, request.sessionId, answer.userInput)'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** "The queue press always approves" was
        # `answer.proposal.approve` on the proposal press, which was removed with proposals
        # ("Proposals go end to end"). The surviving presses take their decision from `answerFor`,
        # which is a different defect under other tables. Its anchor is left stale, so the census
        # records it retired.
        "M29 · \u26d4 the queue press always approves · No on a row creates the project anyway, "
        "which is 441's criterion 21 inverted at the one surface that answers without opening the "
        "card",
        [(SCREEN, "      answer.proposal.approve,\n    )", "      true,\n    )")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** It swaps the ids passed to
        # `sessions.decideProposal` inside `decide-proposal.ts`. The join, `decideProposal` and the
        # proposal bridge are all deleted by bd70d693, and the killer `a-list-that-notices` §1/§1d
        # is gone. Its anchor is left stale, so the census records it retired.
        "M30 · 🔴 the join forwards the two ids swapped · the door's own hop, which no row on the "
        "SCREEN can reach — M28 swaps them at the call site and this swaps them one function in",
        [
            (
                JOIN,
                "  const ack = await sessions.decideProposal(sessionId, proposalId, approve)",
                "  await sessions.decideProposal(proposalId, sessionId, approve)",
            )
        ],
    ),
]
