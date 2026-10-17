"""590 · A folder approved that no agent can work in.

⛔ **BroBot's own report, §A3, after it set up a real project:** *"`create_project.folder` — any
absolute path, no stated relationship to my own directory. `spawn_agent.cwd` — may only ever be your
own folder or one inside it. So a project can be approved by a human with a folder that no agent I
spawn can ever work in. This was avoided here only because the chosen path happened to sit inside
the workspace."* ⚑ Its closing line: *"If one thing gets fixed: A3."*

⛔ **HO-010 ruling 4, whose FIRST clause this door never had:** *"Narrow-only is parent-relative
monotone… `project.cwd` is the initial bound at the first spawn into a project, and monotone from the
parent thereafter."*

⚑ **The rows below are about the BOUND, the WORD beside it and the SENTENCE it produces** — never
about the wiring, because a row a compiler kills measures nothing.

⚑ **`726` · R92: there is no bound any more.** The same expression is now the folder a spawn that
names no cwd starts in, and `M1`–`M3` and `M5` plant their defects in that default; `M4`, `M6` and
`M7` are retired with the refusal (the note above `MUTATIONS`).

## 🔴 A · the bound, and the two readings one ruling holds

⛔ **`M1` is THE DEFECT, verbatim**: the bound is the parent's cwd on every spawn, which is the tree
`371` shipped and `459` made wrong. ⚑ It is the state BroBot met, and every assertion in §1 of
`a-folder-no-agent-can-work-in.test.ts` was written against it.

🔴 **`M2` and `M3` are the OTHER reading — the one HO-010 ruling 4 REFUSED** — *"the project-relative
reading makes a parent's narrowing a suggestion rather than a boundary: a child deep in a subtree
climbing back to the root means the narrowing never happened."* ⚠️ **`M2` widens whenever a project is
NAMED**, so a parent inside its own project climbs back to the project root by naming the project it
is already in; **`M3` widens whenever a project is PRESENT**, so every descendant in the project may
climb to the root and monotone is gone below the crossing. ⛔ **Both pass §1 and §2.1 in full**, which
is the point: the only tests that tell them apart are the ones written where the two readings diverge
(standing rule 3).

⚠️ **`M4` sets the WORD without the VALUE** — `boundProject` whenever a project was named rather than
when the project supplied the bound. ⛔ It is this dispatch's own first draft, caught by its own §2.2,
and it is `a-value-beside-a-word-or-a-union-of-arms` at the one field a model reads.

⛔ **`M5` spells *this project chose no folder* as `''` rather than `null`.** ⚑ The empty string is a
real hazard here and not an invention: `ProjectEdit.cwd` folds blanks, `RuntimeHost.checkCwd`
short-circuits a blank path to `{ ok: true, path: '' }` for the launcher's sake, and rail 12's own
comment records a spawn that *"silently landed somewhere no rail had checked"* through exactly that
value.

## ⚑ B · the sentence a refusal hands back

🔴 **`M6` gives every refusal the parent's sentence**, so a caller crossing into a project is told
*"You are working in <the project's folder>"* about a directory it is not standing in. ⛔ Standing
rule 8.2 is the reason this is a row and not a nicety: *"a sentence describing WHEN a fact is read is
itself a fact about the system — and getting it wrong is worse than getting the FACT wrong, because
it makes an agent disbelieve data that is correct."*

⚠️ **`M7` takes the remedy off the project arm.** `425`'s ruling is that a refusal carries one, and a
sentence that names the wall without naming the door is the refusal this app stopped shipping.

## ⛔ C · the grant summary's headline

🔴 **`M8` puts the bare `none` back.** ⛔ **BroBot, reading its own grants:** *"Read literally, line
one says I cannot spawn anything… Had I stopped at the headline I would have reported the request as
impossible. The summary leads with the exception and buries the rule."*

⚠️ **`M9` puts `by name` on the NON-empty case too**, which is the over-correction: a line that reads
*pm, worker by name* says the list is not the whole answer when it is.

## ⚠️ D · the sentences this ruling made false

⛔ **`M10` and `M11` restore the two `spawn_agent` descriptions this dispatch swept** (standing rule
8.1). ⚑ **`M10` is the sentence BroBot's belief was made of** — *"A folder is a separate question;
this does not set one."* — true when `459` wrote it and false the moment rail 12 changed. 🔴 A rule is
proven by VIOLATING it (standing rule 20), and these two rows are what prove §7's sweep is an
instrument rather than a promise.

## ⛔ What this table does NOT cover

 1. **`admitDeclaredFolder`'s rails.** `489` owns them and this dispatch changed none. (§5 drove the
    `folder-is-not-allowed` wall; `726` · R92 removed the wall and §5 with it.)
 2. **`not-your-project`.** HO-027 §2.2's placement rail is untouched; `459`'s own table owns it, and
    §2.3 asserts it still fires ahead of every folder question.
 3. **`narrowsInto` and `filesystemSpelling`.** `371`'s table owns both. (`726` · R92 deleted
    `narrowsInto` and retired `371`'s rows on it; `filesystemSpelling` stays.)
"""

RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
CAPS = "apps/desktop/src/shared/capabilities.ts"

# The child-folder bound and its project-arm detail are gone. Retain their absent anchors as retired
# because the planted behavior is now intended.
MUTATIONS = [
    # ---- A · the bound --------------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row's anchor `projectFolder ??
        # parent.cwd` is gone: D-016 removed "project folders and their rails" and rail 12 now reads
        # `requested = asked.cwd ?? parent.cwd`. The 'parent's cwd on every spawn' default is now
        # the only behaviour (the test says "a DEFAULT, never a bound"), so the label's defect is
        # the decision and there is no project folder left to ignore. Its anchor is left stale, so
        # the census records it retired.
        "M1 · 🔴 **THE DEFECT, verbatim: the bound is the parent's cwd on every spawn** · a project "
        "a person approved is a folder no agent its creator staffs it with can ever work in — "
        "BroBot's §A3, and the tree `371` shipped before `459` made it wrong",
        [
            (
                # ⚑ **Re-anchored in place at `726` (R92)**: the project's folder is the DEFAULT a
                # spawn starts in now, never a bound; the defect — the project's folder is ignored —
                # is the same.
                RAILS,
                "  const defaultCwd = projectFolder ?? parent.cwd\n",
                "  const defaultCwd = parent.cwd\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** This plants the project-relative
        # reading of the bound (`crossedIntoAProject`, `inProject`, `asked.project`). D-016 removed
        # the project argument on `spawn_agent` and `same-project` reach, and R92 (726) removed the
        # bound itself. `crossedIntoAProject` no longer appears in `spawn-rails.ts` and there is no
        # bound left for a project to widen. Its anchor is left stale, so the census records it
        # retired.
        "M2 · 🔴 **the bound widens whenever a project is NAMED, including your own** · HO-010 "
        "ruling 4's REFUSED project-relative reading — *a child deep in a subtree climbing back to "
        "the root means the narrowing never happened* · the plausible mistake: the caller asked "
        "about a project, so answer about the project",
        [
            (
                RAILS,
                "  const crossedIntoAProject =\n"
                "    projectSlug !== null &&\n"
                "    (inProject === null || foldProfileName(projectSlug) !== foldProfileName(inProject))\n"
                "      ? projectSlug\n"
                "      : null\n",
                "  const crossedIntoAProject = asked.project !== undefined ? projectSlug : null\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** Same subject as M2: it widens the
        # bound for every spawn in a project via `facts.projectFolderOf`. That fact and
        # `projectSlug` are gone from `spawn-rails.ts` and `runtime-host.ts` (D-016: "project
        # folders and their rails ... removed"). Monotone narrowing was retired earlier by R92. Its
        # anchor is left stale, so the census records it retired.
        "M3 · ⛔ **the bound widens for every spawn in a project, named or not** · monotone below the "
        "crossing is gone: a grandchild three directories down climbs back to the project root "
        "without naming anything · the plausible mistake: the placement is already resolved, so use it",
        [
            (
                RAILS,
                "  const projectFolder =\n"
                "    crossedIntoAProject === null ? null : facts.projectFolderOf(crossedIntoAProject)\n",
                "  const projectFolder =\n"
                "    projectSlug === null ? null : facts.projectFolderOf(projectSlug)\n",
            )
        ],
    ),
    (
        "M4 · ⚠️ **the WORD is set without the VALUE** · `boundProject` names a project whenever one "
        "was crossed into, so a caller is told its bound came from a project while the bound is its "
        "own folder · this dispatch's own first draft, caught by its own §2.2",
        [
            (
                RAILS,
                "  const boundProject = projectFolder === null ? null : crossedIntoAProject\n",
                "  const boundProject = crossedIntoAProject\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The anchor is `projectFolderOf:
        # (projectSlug) => this.projectCwd(projectSlug) ?? null` in `runtime-host.ts`. Neither
        # `projectFolderOf` nor `projectCwd` exists anywhere in `apps/desktop/src` (D-016 deleted
        # project folders). 'A project that chose no folder' has no meaning any more. Its anchor is
        # left stale, so the census records it retired.
        "M5 · ⛔ **`no folder` is spelled `''` rather than `null`** · the blank travels into the "
        "bound, `checkCwd` short-circuits it to `{ ok: true, path: '' }`, and a project that chose "
        "no folder stops being staffable at all · rail 12's own comment records a spawn that "
        "*silently landed somewhere no rail had checked* through this value",
        [
            (
                HOST,
                "      projectFolderOf: (projectSlug) => this.projectCwd(projectSlug) ?? null,",
                "      projectFolderOf: (projectSlug) => this.projectCwd(projectSlug) ?? '',",
            )
        ],
    ),
    # ---- B · the sentence -----------------------------------------------------------------------
    (
        "M6 · 🔴 **every refusal gets the parent's sentence** · a caller crossing into a project is "
        "told *you are working in* a directory it is not standing in — standing rule 8.2, which is "
        "worse than a wrong fact because it makes an agent disbelieve a correct rail",
        [
            (
                RAILS,
                "      return detail.boundProject === undefined\n",
                "      return true\n",
            )
        ],
    ),
    (
        "M7 · ⚠️ **the project arm loses its remedy** · `425`: a refusal carries the door as well as "
        "the wall, and a caller told only that its folder is wrong has nowhere to go",
        [
            # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads (675 §1); The DEFECT this row plants is unchanged.
            (
                RAILS,
                "        : 'The folder asked for is outside that project’s folder, so nothing was started. Ask for ' +\n            'the project’s folder, or for one under it: a conversation you start in that project ' +",
                "        : 'The folder asked for is outside that project’s folder, so nothing was started. A ' +\n            'conversation you start in that project ' +",
            ),
        ],
    ),
    # ---- C · the grant summary ------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The 'none by name' summary belonged to
        # the `canSpawn` list field, and D-014 removed that field from
        # `ProfileCapabilities`/`CAPABILITY_FIELDS`. Card: "no `can_spawn` / `not-in-can-spawn`";
        # commit: "can_spawn … columns stay in the schema, unread and unwritten". Its anchor is left
        # stale, so the census records it retired.
        "M8 · 🔴 **the bare `none` comes back** · BroBot: *Read literally, line one says I cannot "
        "spawn anything… Had I stopped at the headline I would have reported the request as "
        "impossible* — the summary leading with the exception and burying the rule",
        [
            (
                CAPS,
                "    says: (held) => (held.length === 0 ? 'none by name' : held.join(', ')),",
                "    says: (held) => (held.length === 0 ? 'none' : held.join(', ')),",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** Same subject as 590:M8: the `canSpawn`
        # summary line is gone together with the grant (card: "no `can_spawn` / `not-in-can-spawn`";
        # commit: can_spawn is "unread and unwritten"). With no list, 'by name' has nowhere to
        # over-apply. Its anchor is left stale, so the census records it retired.
        "M9 · ⚠️ **`by name` lands on the NON-empty case too** · the over-correction: a line reading "
        "*pm, worker by name* says the list is not the whole answer when it is",
        [
            (
                CAPS,
                "    says: (held) => (held.length === 0 ? 'none by name' : held.join(', ')),",
                "    says: (held) => (held.length === 0 ? 'none by name' : `${held.join(', ')} by name`),",
            )
        ],
    ),
    # ---- D · the sweep --------------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The sentence 'A folder is a separate
        # question; this does not set one' belonged to the `project` argument's description on
        # `spawn_agent`. D-016 removed that argument ("the project argument on spawn_agent and
        # list_agents are removed"), and the test's own comment says the sentence "went with the
        # argument". The sentence appears nowhere in `apps/desktop/src`. Its anchor is left stale,
        # so the census records it retired.
        "M10 · ⛔ **the sentence BroBot's belief was made of comes back** · *A folder is a separate "
        "question; this does not set one* — true when `459` wrote it, false the moment rail 12 "
        "changed, and standing rule 8.1 is the clause it breaks",
        [
            (
                TOOLS,
                # ⚑ **Re-anchored in place at `726` (R92)**: the description no longer says cwd narrows.
                "              'name and no retry will pass. Naming a project you are not already in also decides ' +\n"
                "              'where the new conversation works: unless you name a cwd, it starts in that ' +\n"
                "              'project\\u2019s folder.',",
                "              'name and no retry will pass. A folder is a separate question; this does not set one.',",
            )
        ],
    ),
    (
        "M11 · ⛔ **`cwd` says the bound is only ever your own folder again** · a caller that "
        "believes it never attempts the call this dispatch admits, which is an instruction closing "
        "a door the app has opened",
                # ⚑ **Re-anchored in place at `726` (R92)**: the description now says any folder; the
                # mutant — the old bound sentence back — is now R92's own defect in words.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: the
        # `cwd` description must not tell a caller the bound is only ever its own folder, because
        # R92 opened that door. D-016 only rewrote the description to "Working directory: any folder
        # that exists. Defaults to your own working directory. A relative path is read from your own
        # working directory." (the project clause is gone). The re-anchor plants the old bound
        # sentence over that text, which is the label's defect.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule holds
        # and is asserted: a tool description must not tell a caller the working folder is only ever
        # its own. spawn_agent.cwd became give_work.folder (agent-tools.ts), whose description now
        # reads 'Where a conversation this starts works: any folder that exists, and a relative path
        # is read from your own working directory. Defaults to your own working directory. …'; the
        # plant puts the old bound sentence back over it. Killed by
        # `a-folder-no-agent-can-work-in.test.ts`.
        [
            # ⚑ W4.189 · re-anchored in place, not retired — give_work's folder now also grants a
            # conversation the giver already has; the defect planted is the same.
            # ⚑ **parallel workers · re-anchored in place, not retired** — Parallel-worker tool wording changes this anchor. Same labelled defect and killer retained; source-only, NOT VERIFIED and held for execution.
            # ⚑ **parallel worker folder words · re-anchored in place, not retired** — Parallel-worker tool wording changes this anchor. Same labelled defect and killer retained; source-only, NOT VERIFIED and held for execution.
            (TOOLS, "A folder for this piece: any that exists;", "A folder for this piece. Defaults to your own, and may only ever be your own folder or one inside it;"),
        ],
    ),
]
