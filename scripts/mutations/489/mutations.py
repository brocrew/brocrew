"""489 · a proposal that could never succeed — HO-031 §2.6, and §3's `create_project` row.

⛔ **What happened to the person**, in BroBot's own words (§2.1): *"`create_project` requires `folder` to
already exist. It does not say so. The check runs **after** the person reads the proposal and
presses approve — so the app spends the user's attention on a proposal that could never succeed,
then fails it."* 🔴 The PO: *"the outcome was indistinguishable from *he declined*."*

| § | the fix | rows |
|---|---|---|
| 1.1 | validate at CALL time, and ask the disk LAST | `M1`–`M2` |
| 1.3 / 2 | what a declared folder may NOT be, and the order the rails ask it in | `M3`–`M9` |
| 1.3 | the creation itself, and the declaration a person read first | `M10`–`M16` |
| 1.2 | the cause in `reason`, and the word that was arriving as `nobody-answered` | `M17`–`M19` |
| 3 | the description that contradicted its own `required` array | `M20`–`M21` |

## 🔴 The trap this table is mostly about

⚠️ **`489` lets an approval create a directory on the person's disk**, so most of these rows are not
about the feature at all — they are about the wall in front of it. ⛔ `M3`, `M4` and `M5` each open
a different route into this app's own data, and `M5` is the one a reader is least likely to catch:
the real-spelling pass computed off the LEXICAL parent is a check that runs, reports nothing, and
launders a symlink.

## ⛔ What this table deliberately does NOT contain

⚠️ **No row on `checkSessionCwd`'s three existence arms.** *Missing*, *not a directory* and *cannot
be opened* are `076`/`303 C`/`339`'s and their rows live with those dispatches; `489` folded them to
ONE rail at a new door and changed none of them.

⚠️ **No row on the `standing-agent` folder that is drawn and discarded.** That predates this
dispatch — a shape that creates no project still has its declared folder painted on the card — and
it is reported as a finding rather than repriced under cover of a fix. ⛔ `M21` covers only the arm
`489` itself introduced.

⚠️ **No row on `projectFromProposal` keeping the future tense.** ⛔ It cannot: `folderIsOf` reads
the PATH first and `SessionStore` folds again on the way in, so a row claiming `a-folder-will-be-made`
is not a state three independent folds can produce — a mutation there is TRUE and measures nothing
(`a-true-mutation-measures-nothing`). ⚑ The tense is asserted positively in
`what-approving-a-proposal-actually-does.test.ts` §6 instead.

⚠️ **No row on the filesystem-oracle trade.** Whether a caller may learn that a path it named is
absent is a RULING (HO-031 §2.6 moved it), not a behaviour a mutation can measure; the cost is
argued in `project-folder-rails.ts` and reported.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| `M1`, `M2` | ⚑ **`apps/desktop/test/a-proposal-that-could-never-succeed.test.ts`** §1 — refused at the call, and the folder asked LAST |
| `M3`, `M6`–`M9`, `M22` | ⚑ the same file §2 — what a declared folder may not be |
| `M4`, `M5` | ⚑ the same file §2 — the symlink whose real path is inside this app's data |
| `M10`, `M11`, `M16` | ⚑ **`apps/desktop/test/what-approving-a-proposal-actually-does.test.ts`** §6 and §6b |
| `M12` | ⚑ the desktop rails file §5 — a host that cannot answer refuses |
| `M13`, `M14` | ⚑ **`apps/desktop/test/a-proposal-that-could-never-succeed.render.test.ts`** — the sentence a person reads |
| `M15` | ⚑ the same render file, plus the rails file §3 — the fold reads the path first |
| `M17`–`M19` | ⚑ **`what-approving-a-proposal-actually-does.test.ts`** §7, and `a-project-he-described.test.ts` |
| `M20`, `M21` | ⚑ the rails file §4 and §2 |

⛔ **Evidence this table is honest about what it can reach.** Every row was applied alone, its own
killer file run, and the tree restored from bytes — the whole table has NOT been run under the
driver, so `CENSUS.md` records it `unrun` and no verdict is claimed here.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RAILS = "apps/desktop/src/main/runtime/project-folder-rails.ts"
SCRATCH = "apps/desktop/src/main/runtime/scratch-cwd.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
VOCAB = "apps/desktop/src/shared/project-folder.ts"
CARD = "apps/desktop/src/renderer/src/components/ProposalCard.vue"

# The folder-is-not-allowed wall and its ordering are gone. These anchors remain recorded as retired
# because their planted behavior is now intended.
MUTATIONS = [
    # ── §1.1 · the defect, and the order that keeps its fix honest ───────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** D-016a removed create_project and
        # proposals end to end (commit: "Proposals go end to end"). `admitTheFolder` and the
        # proposal call path no longer exist in runtime-host.ts (count_now 0, grep finds neither),
        # so a proposal that cannot succeed can no longer be published. Its anchor is left stale, so
        # the census records it retired.
        "M1 · 🔴 THE DEFECT, restored · the folder is not admitted at the call, so a proposal that "
        "cannot succeed publishes a card, spends a person's attention, and fails after they decide "
        "— HO-031 §2.1 exactly, and the outcome is indistinguishable from *he declined*",
        [
            (
                HOST,
                "    const admitted = this.admitTheFolder(said.folder)\n"
                "    if (!admitted.ok) {\n"
                "      return no(admitted.rail, { folder: admitted.folder, because: admitted.reason })\n"
                "    }\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The call-time folder check in
        # create_project is gone: create_project is deleted ("create_project and list_projects ...
        # are removed"). Nothing asks a folder before or after the grant any more. Its anchor is
        # left stale, so the census records it retired.
        "M2 · ⛔ the folder is asked FIRST, ahead of the grant · 341 inverted at the one door where "
        "the refusal is a fact about the person's disk: an unentitled caller now learns whether a path "
        "it named exists, from a verb it may not call",
        # ⚑ Landing D-014 · re-anchored in place, not retired — D-014 deleted the old anchor
        # (mayCreateProjects / can_create_projects). Re-verified RED alone.
        [
            (HOST, '    if (mints) {\n      const allowed = this.deps.store.capabilitiesOf(caller.profileId)\n', '    const admittedEarly = this.admitTheFolder(said.folder)\n    if (!admittedEarly.ok) {\n      return no(admittedEarly.rail, {\n        folder: admittedEarly.folder,\n        because: admittedEarly.reason,\n      })\n    }\n    if (mints) {\n      const allowed = this.deps.store.capabilitiesOf(caller.profileId)\n'),
        ],
    ),
    # ── §2 · what a declared folder may NOT be ───────────────────────────────────────────────────
    (
        "M3 · 🔴 the POLICY wall goes · a declared folder inside this app's own data is admitted, "
        "so approving puts a project — and, on the creating arm, a directory this app made — in the "
        "credential store's neighbourhood. ⛔ 069 A1, reached through the one door that now writes",
        [
            (
                RAILS,
                "  const lexical = thisAppsOwn(userData, folder, false)\n"
                "  if (lexical !== null) return { ok: false, rail: 'folder-is-not-allowed', reason: lexical, folder }\n",
                "",
            )
        ],
    ),
    (
        "M4 · ⛔ the REAL-spelling pass goes · `~/link → <userData>` with a declared "
        "`make ~/link/proj` is lexically nowhere near this app's data and the leaf does not exist, "
        "so one pass admits it — and approving makes a directory inside the credential store's "
        "neighbourhood through a path that never looked like it was inside anything",
        [
            (
                RAILS,
                "  const real = join(filesystemSpelling(parent), basename(folder))\n"
                "  const walled = thisAppsOwn(userData, real, true)\n"
                "  if (walled !== null) {\n"
                "    return { ok: false, rail: 'folder-is-not-allowed', reason: walled, folder }\n"
                "  }\n",
                "",
            )
        ],
    ),
    (
        "M5 · 🔴 the real pass is computed off the LEXICAL parent · the check still runs, still "
        "reports, and launders exactly the symlink it exists to catch — `371`'s "
        "`realpathSync.native` lesson undone by one call, and the quietest row in this table",
        [
            (
                RAILS,
                "  const real = join(filesystemSpelling(parent), basename(folder))",
                "  const real = join(parent, basename(folder))",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** project-folder-rails.ts was deleted by
        # D-016 ("project folders and their rails ... are removed"), so the parent-exists check is
        # gone (count_now -1, file missing). Approving a proposal no longer creates a directory. Its
        # anchor is left stale, so the census records it retired.
        "M6 · ⛔ the PARENT need not exist · a person is asked to approve a creation that cannot "
        "happen, which is the defect this dispatch exists to end arriving from inside its own fix. "
        "⚠️ And `mkdirSync` is non-recursive, so the press bounces — after the attention was spent",
        [
            (
                RAILS,
                "  let parentIsADirectory: boolean\n"
                "  try {\n"
                "    parentIsADirectory = statSync(parent).isDirectory()\n"
                "  } catch {\n"
                "    return {\n"
                "      ok: false,\n"
                "      rail: 'no-such-folder',\n"
                "      reason: `the folder this would be made in does not exist: ${parent}`,\n"
                "      folder,\n"
                "    }\n"
                "  }\n",
                "  let parentIsADirectory = true\n",
            )
        ],
    ),
    (
        # ⚠️ **This row was first written as *`recursive: true`, so approving makes a tree* and that
        # is a PHANTOM** — the parent rail refuses the only declaration the flag could act on, so
        # the mutation changes nothing and would have reported as a survivor
        # (`a-true-mutation-measures-nothing`). ⛔ **The bound on what approving writes is the RAIL,
        # not the flag**, `M6` is the row that carries it, and this one was re-aimed at a defect the
        # same function can actually produce.
        "M7 · ⚠️ the stored spelling becomes the REAL one · 170 §3 inverted — *\"a user who typed a "
        "path must see the path they typed\"* — so a person approves `~/dev/thing` and the project "
        "records whatever the filesystem calls it after symlinks and case. ⛔ The real spelling was "
        "computed for the WALL and must not travel on",
            # ⚑ **Corrected in place at `726`.** R92 deleted the app-data wall, and with it the `real`
            # this mutant stored — so the old replacement named a variable that no longer exists and
            # died of a `ReferenceError`, which measures nothing. ⛔ The subject is untouched: 170 §3
            # still says the stored spelling is the CALLER's. The mutant now computes the real
            # spelling the wall used to — the parent made real, the leaf as typed — and stores it.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The stored-spelling rule (170 §3, a user must see the path they typed)
        # now lives in the last line of `checkSessionCwd`, whose `path` is `cwdSpelling`, i.e.
        # resolve of the typed path and never the realpath. The old plant died because the app-data
        # wall's `real` is gone. The new plant returns the filesystem's spelling through the same
        # module's own `filesystemSpelling`, so it needs no import and no other edit, and it reaches
        # the stored row through `resolveSessionCwd` and `checkFolder` to `spawn-rails.ts`'s `cwd:
        # folder.path`. It is red today on the §3 symlink test in
        # `a-narrowing-that-means-something.test.ts` (`cwdOf(allowed.agent)` must be the typed
        # `inward` link, not `sub`), and `scratch-cwd.t
        [
            (SCRATCH, '  return { ok: true, path: cwd }\n', '  return { ok: true, path: filesystemSpelling(cwd) }\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The folder-already-exists rail was in
        # the deleted project-folder-rails.ts, and 'a folder to be made' existed only for
        # create_project proposals. The commit removed proposals and project folders on purpose. Its
        # anchor is left stale, so the census records it retired.
        "M8 · ⛔ a folder to be MADE may already be there · approving adopts a directory holding "
        "somebody else's work, under a card that read *approving creates it*. ⚑ `adopts-a-folder`'s "
        "subject arriving with no notice, on a durable act",
        [
            (
                RAILS,
                "  if (taken) {\n"
                "    return {\n"
                "      ok: false,\n"
                "      rail: 'folder-already-exists',\n"
                "      reason: `there is already something at ${folder}`,\n"
                "      folder,\n"
                "    }\n"
                "  }\n",
                "",
            )
        ],
    ),
    (
        "M9 · 🔴 `checkSessionCwd` asks EXISTENCE before the wall again · 341 inverted at the "
        "session door: a caller naming `<userData>/provider-homes/x` is told whether it is there, "
        "by the rule that exists to stop it naming that at all",
        [
            (
                SCRATCH,
                "  const wall = appDataReason(userData, cwd, true)\n"
                "  if (wall !== null) return { ok: false, reason: wall }\n"
                "  let isDirectory: boolean",
                "  let isDirectory: boolean",
            ),
            (
                SCRATCH,
                "  if (!isDirectory) return { ok: false, reason: `cwd is not a directory: ${cwd}` }\n",
                "  if (!isDirectory) return { ok: false, reason: `cwd is not a directory: ${cwd}` }\n"
                "  const wall = appDataReason(userData, cwd, true)\n"
                "  if (wall !== null) return { ok: false, reason: wall }\n",
            ),
        ],
    ),
    # ── §1.3 · the creation, and the declaration that licenses it ────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The press-time re-admit of a
        # proposal's folder was in the approve path of the deleted proposal machinery ("Proposals go
        # end to end"); `door.admit` and `a-folder-will-be-made` no longer appear anywhere in src.
        # Its anchor is left stale, so the census records it retired.
        "M10 · 🔴 the press does not ask the door AGAIN · a directory that resolves is not a "
        "directory that stays (170 §3), and the arm `489` adds is the opposite one: somebody made "
        "that folder — and put work in it — while the card sat on screen, and approving adopts it",
        [
            (
                HOST,
                "      const again = door.admit({ is: 'a-folder-will-be-made', path: proposal.folder })\n"
                "      if (!again.ok) return { refused: theFolderWentAway(again.reason) }\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** Approving a proposal used to make the
        # folder (`door.make`); proposals, approving and project folders are removed by D-016a, so
        # no approve step exists to skip the mkdir. Its anchor is left stale, so the census records
        # it retired.
        "M11 · ⛔ nothing is made · the project is written with a `cwd` pointing at a directory that "
        "does not exist, so every conversation started in it fails at the launch instead — the card "
        "promised a creation and the press performed a row",
        [
            (
                HOST,
                "      try {\n"
                "        door.make(again.path ?? proposal.folder)\n"
                "      } catch (error) {\n"
                "        return { refused: theFolderWentAway(errorMessage(error)) }\n"
                "      }\n",
                "",
            )
        ],
    ),
    # ⚑ **Corrected in place at `726`**: R92 removed `folder-is-not-allowed`, and a door-less host now
    # refuses under `no-such-folder` with its own sentence (`NO_FOLDER_DOOR`). The defect — a host with
    # no door ADMITS — is unchanged; the label's *"the only thing that knows where this app's own data
    # lives"* stopped being true at `726` (the door reads no `userData` any more). Re-verified RED.
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `folderDoor` dependency and
        # `NO_FOLDER_DOOR` are gone from runtime-host.ts (grep finds neither). The seam existed only
        # to gate create_project's declared folder, which the commit deleted with "project folders
        # and their rails". Its anchor is left stale, so the census records it retired.
        "M12 · ⚠️ a host with no folder door ADMITS instead of refusing · the seam is the only thing "
        "that knows where this app's own data lives, so a host without it would publish a card "
        "promising a directory it cannot place and cannot make. ⛔ Fail-open at the one gate whose "
        "whole subject is a durable write",
        [
            (
                HOST,
                "    const door = this.deps.folderDoor?.()\n"
                "    if (door === undefined) {\n"
                "      return {\n"
                "        ok: false,\n"
                "        rail: 'no-such-folder',\n"
                "        reason: NO_FOLDER_DOOR,\n"
                "        folder: declared.path,\n"
                "      }\n"
                "    }\n"
                "    return door.admit(declared)",
                "    const door = this.deps.folderDoor?.()\n"
                "    if (door === undefined) return { ok: true, path: declared.path }\n"
                "    return door.admit(declared)",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** ProposalCard.vue is deleted (count_now
        # -1); the card is gone with "Proposals go end to end". The three-word folder vocabulary is
        # only read by that card. Its anchor is left stale, so the census records it retired.
        "M13 · 🔴 the card folds through the THREE-word vocabulary again · a declaration that "
        "approving CREATES a directory renders as *This project works in a folder*, so a person "
        "approves a durable creation they never read. ⛔ The PO's whole safety argument is that the "
        "sentence was on the card",
        [
            (
                CARD,
                "const folderIs = computed(() => folderProposedIs(proposal.value.folder, proposal.value.folderIs))",
                "const folderIs = computed(\n"
                "  () =>\n"
                "    (proposal.value.folder ?? '') === ''\n"
                "      ? 'nobody-has-chosen'\n"
                "      : ('a-folder-was-chosen' as const),\n"
                ")",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):**
        # apps/desktop/src/shared/project-folder.ts (the folderProposedIs fold) is deleted by D-016
        # (file missing). Its only consumers were the proposal card and the project proposal row,
        # both removed. Its anchor is left stale, so the census records it retired.
        "M14 · ⛔ the fold fails OPEN · a word this build cannot read — a hand-edited database, a "
        "bundle `importBundle` checked nothing in — makes the card announce that approving creates "
        "a directory. ⚑ A promise about a durable act nobody declared, which is the one direction "
        "this vocabulary must never fail in",
        [
            (
                VOCAB,
                "    return said === 'a-folder-will-be-made' ? 'a-folder-will-be-made' : 'a-folder-was-chosen'",
                "    return said === 'a-folder-was-chosen' ? 'a-folder-was-chosen' : 'a-folder-will-be-made'",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** shared/project-folder.ts and its
        # `folderProposedIs` fold are deleted, so there is no word-versus-path fold to reorder. The
        # `project_proposed` row it read went with proposals. Its anchor is left stale, so the
        # census records it retired.
        "M15 · ⚠️ the WORD decides before the path · *(no path, `a-folder-will-be-made`)* becomes a "
        "state a reader can produce, so a `project_proposed` row carrying a creating word and no "
        "directory paints a card promising to create nothing",
        [
            (
                VOCAB,
                "  if (folder !== null && folder !== undefined && folder.trim() !== '') {\n"
                "    return said === 'a-folder-will-be-made' ? 'a-folder-will-be-made' : 'a-folder-was-chosen'\n"
                "  }\n",
                "  if (said === 'a-folder-will-be-made') return 'a-folder-will-be-made'\n"
                "  if (folder !== null && folder !== undefined && folder.trim() !== '') {\n"
                "    return 'a-folder-was-chosen'\n"
                "  }\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The host's proposal row
        # (`said.folder.is`, `folder: said.folder.path`) is deleted with create_project and
        # proposals (count_now 0). There is no proposal row left to drop a path from. Its anchor is
        # left stale, so the census records it retired.
        "M16 · 🔴 the PATH is dropped from the row on the creating arm · this is the defect this "
        "dispatch actually shipped and its own witness caught: the word lands, the directory does "
        "not, `folderProposedIs` folds it back to *nobody has chosen*, and the card tells a person "
        "nobody was asked about a proposal where somebody was",
        [
            (
                HOST,
                "      ...(said.folder.is === 'no-folder-on-purpose' ? {} : { folder: said.folder.path }),",
                "      ...(said.folder.is === 'a-folder-was-chosen' ? { folder: said.folder.path } : {}),",
            )
        ],
    ),
    # ── §1.2 · the cause in `reason` ─────────────────────────────────────────────────────────────
    (
        "M17 · 🔴 a WITHDRAWN proposal settles `null` again · the identical value the 300-second "
        "bound produces, so a supervisor is told the card is still on somebody's screen and not to "
        "propose it again — about a proposal that was ended and will never be decided. ⛔ HO-031 "
        "§2.1: criterion 18 ranges over answers a tool gives an AGENT",
        [
            (
                HOST,
                "        held.settle({ ending: 'withdrawn', created: null })",
                "        held.settle(null)",
            )
        ],
    ),
    (
        "M18 · ⛔ the withdrawn SENTENCE goes · the word is right on the wire and the prose falls "
        "through to the expiry branch, so the structured half and the text half of one answer "
        "contradict each other — and the half a provider renders is the false one",
        [
            (
                TOOLS,
                # ⚑ **Re-anchored by `615`**, which moved the three DECIDED sentences into
                # `proposal-rails.ts` so one vocabulary serves the call and the delivery. ⛔ The
                # DEFECT is unchanged and is still spelled here: `withdrawn` stops reaching the
                # shared table and the PROSE falls through to the expiry branch, so the structured
                # half says `withdrawn` while the text half says *nobody has answered yet*.
                "  if (outcome.decided !== null) return whatTheDecisionMeans(outcome.decided, outcome)\n",
                "  if (outcome.decided !== null && outcome.decided !== 'withdrawn')\n    return whatTheDecisionMeans(outcome.decided, outcome)\n",
            )
        ],
    ),
    (
        "M19 · ⚠️ `reason` leaves the payload · BroBot's §2.1 restored — *\"No `reason`, no "
        "`detail`, no `timed_out`\"* — so a model reading the structured half gets a word and "
        "nothing that says what the word means",
        [
            (
                TOOLS,
                "              decision: outcome.decided ?? 'nobody-answered',\n"
                "              reason: said,\n",
                "              decision: outcome.decided ?? 'nobody-answered',\n",
            )
        ],
    ),
    # ── §3 · the prose that denied its own argument ──────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `CREATE_PROJECT_DOES_NOT_ASK` is gone
        # from agent-tools.ts because create_project itself is removed ("create_project and
        # list_projects ... are removed"). There is no description that can contradict a required
        # folder. Its anchor is left stale, so the census records it retired.
        "M20 · 🔴 HO-031 §3's row, restored · the description tells a caller it does not name a "
        "folder while the validator demands one. ⛔ BroBot: *\"The prose tells you not to send the "
        "thing the validator demands\"* — one failed call for every first-time caller",
        [
            (
                TOOLS,
                "export const CREATE_PROJECT_DOES_NOT_ASK = ['a slug', 'a provider', 'which agents'] as const",
                "export const CREATE_PROJECT_DOES_NOT_ASK = [\n"
                "  'a slug',\n"
                "  'a folder',\n"
                "  'a provider',\n"
                "  'which agents',\n"
                "] as const",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The project shapes and `SHAPE_CREATES`
        # declared-folder arm in agent-tools.ts were part of create_project and are deleted
        # (count_now 0). Projects are no longer something a model meets, so a shape that creates no
        # project cannot declare a folder. Its anchor is left stale, so the census records it
        # retired.
        "M21 · ⛔ a shape that creates NO project may declare a folder into existence · the card "
        "reads *approving creates ~/x* and approving mints an identity and touches no folder, so a "
        "person reads a promise about something that will not happen",
        [
            (
                TOOLS,
                "            if (\n"
                "              declared.is === 'a-folder-will-be-made' &&\n"
                "              isProjectShape(shape) &&\n"
                "              SHAPE_CREATES[shape] !== 'a project'\n"
                "            ) {",
                "            if (false as boolean) {",
            )
        ],
    ),
    # ── the SECOND protected root, found by reviewing this dispatch's own diff ──────────────────
    (
        "M22 · 🔴 the SECOND protected root stops being refused · `protectedRoots` is `[userData, "
        "pastedImagesRoot(userData)]` and the second is a SIBLING of `userData`, so nothing that "
        "reasons about *inside userData* covers it. ⛔ A project folder could then be declared — and "
        "CREATED — inside a directory this app owns and `clean-base` walks. ⚠️ Found by reviewing "
        "this dispatch's own diff, after its docblock restated `codex-runtime.ts`' stale "
        "`[userData]` instead of reading the composition root",
        [
            (
                RAILS,
                "  return insideRoot(pastedImagesRoot(userData), path, alsoReal)\n"
                "    ? `the folder is inside this app's own pasted-image store: ${path}`\n"
                "    : null\n",
                "  return null\n",
            )
        ],
    ),
]
