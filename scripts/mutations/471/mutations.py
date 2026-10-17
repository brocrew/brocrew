"""471 · the folder a proposal declares — HO-028 §4, ruled a DEFECT.

⛔ **What this table is aimed at.** `471` made a project created by proposal able to reach a real
repository, and every rule it added is one a mutation can delete without breaking a type:

 1. **The folder REACHES the project** — `M1` is the defect restored: `bringItIntoExistence` writes
    `cwd: null` as a literal again, which is the exact line HO-028 §4 ruled on (*"a project created
    through the proposal flow can never reach a repository, because its folder is null and its
    children inherit BroBot's workspace instead"*).
 2. **`none` is a CHOICE and not a default** — `M2`, `M3`, `M4`, `M12`. ⚑ §2.2's load-bearing half:
    the failure this vocabulary exists to prevent is a null nobody picked wearing the word somebody
    chose, and each of these rows produces exactly that by a different route.
 3. **The declaration is READ** — `M6` and `M7`. ⛔ The PO's whole reason for admitting an
    agent-named folder is that *"the folder is one more thing read before the click"*; a card that
    stops drawing it, or draws a path the row does not have, takes that reason away.
 4. **One folder rule, and one fold** — `M8`, `M9`, `M10`, `M11`, `M13`. ⚠️ 169 §1: `createProject`
    and `saveProject` each held a copy of the verification and the approval door held none, which
    is how this defect got in; these rows are the ways that comes back.
 5. **The migration** — `M14` and `M15`. 🔴 A backfill is this app claiming a decision nobody made,
    and a stamp below `0028`'s is a column that exists only on fresh installs.
 6. **A person's blank box is not a declaration** — `M16`, `M17`, `M18`.

⚠️ **Two rows are aimed at a REFUSAL rather than at a value.** `M5` makes a missing argument mean
*none*, and `M19` lets the wire take a word this app cannot read; both are the vocabulary being
guarded by nothing, which is what `a-closed-vocabulary-guards-what-a-member-says` is about.

⛔ **Evidence this table is honest about what it can reach.** Every row was applied alone, its own
killer file run, and the tree restored from bytes and hashed — the whole table has NOT been run
under the driver, so `CENSUS.md` records it `unrun` and no verdict is claimed here.
"""

STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
VOCAB = "apps/desktop/src/shared/project-folder.ts"
CARD = "apps/desktop/src/renderer/src/components/ProposalCard.vue"
SHEET = "apps/desktop/src/renderer/src/components/ProjectSheet.vue"
NEW = "apps/desktop/src/renderer/src/components/NewProject.vue"
MIGRATION = "apps/desktop/src/main/db/migrations/0029_organic_doctor_doom.sql"
JOURNAL = "apps/desktop/src/main/db/migrations/meta/_journal.json"

# ⚑ The approval path's one expression, anchored with the line under it so the row cannot land on
# some other `verifiedFolder` call.
THE_APPROVAL = (
    "      edit = this.verifiedFolder(projectFromProposal(proposal))\n"
    "    } catch (error) {"
)

# ⚑ The fold, whole — both arms, so a row can reverse the order it asks its two questions in.
THE_FOLD = (
    "  if (cwd !== null && cwd !== undefined && cwd.trim() !== '') return 'a-folder-was-chosen'\n"
    "  return said === 'no-folder-on-purpose' ? 'no-folder-on-purpose' : 'nobody-has-chosen'\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the folder reaching the project ────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The approval door this row plants
        # `cwd: null` into (`bringItIntoExistence` and the
        # `verifiedFolder(projectFromProposal(...))` line) is gone: bd70d693 says "Proposals go end
        # to end" and removes "create_project", and grep finds no `projectFromProposal`,
        # `verifiedFolder` or `project_proposed` writer in apps/desktop/src. Nothing creates a
        # project with a folder any more, so the HO-028 §4 defect has no surface. Its anchor is left
        # stale, so the census records it retired.
        "M1 · 🔴 THE DEFECT, restored · the approval writes `cwd: null` as a LITERAL again, which is "
        "the line HO-028 §4 ruled on. ⛔ *\"A project created through the proposal flow can never "
        "reach a repository, because its folder is null and its children inherit BroBot's workspace "
        "instead.\"* ⚠️ The card still draws the folder the agent declared, so a person approves a "
        "path and gets a project that does not have it — the disclosure defect under the behaviour "
        "one",
        [(HOST, THE_APPROVAL,
          "      edit = {\n"
          "        displayName: proposal.name,\n"
          "        description: proposal.description,\n"
          "        cwd: null,\n"
          "        folderIs: 'nobody-has-chosen',\n"
          "      }\n"
          "    } catch (error) {")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `ProposalCard.vue` (895 lines) and its
        # 'what the folder means' disclosure were deleted by bd70d693 ("Proposals go end to end,
        # with the demo seed, the renderer fixtures"). The sentence has no card left to sit in, and
        # its old killer `a-decision-with-nothing-to-fill-in.dom.test.ts` was deleted too. Its
        # anchor is left stale, so the census records it retired.
        "M6 · ⛔ the card stops EXPLAINING the folder · the twenty-eight-word sentence behind the "
        "disclosure, emptied. ⚠️ **595 narrowed this row and says so** (rule 26's third question): "
        "the PATH and its consequence clause moved ABOVE the fold and are guarded by `595` M4 and "
        "`595` M5, so the PO's *read before the click* argument is no longer what THIS row "
        "measures. ⚑ What it measures now is `EXT-011` §5 — *every sentence stays somewhere* — on "
        "the one sentence `595` moved rather than kept",
        # ⚠️ **Anchor corrected by 489**, which gave the card a four-word vocabulary of its own —
        # `PROPOSED_FOLDER_MEANS` — so it can draw *approving creates this*. ⛔ The defect is
        # unchanged and is now larger: without this line a person reads neither that there is a
        # folder nor that approving MAKES one.
        #
        # ⚡ **595 re-aimed it again, in place** (142's rule): the sentence is composed by
        # `whatTheFolderMeans` now and drawn behind the card's one disclosure, under the label
        # *what the folder means*. 🔴 **And the row's TITLE was corrected with it**, because the
        # anchor moved further than the words did: the old title claimed the PO's safety argument
        # was under test here and it is not any more — `a-corrected-anchor-keeps-a-verdict-it-
        # never-earned` applies to the DESCRIPTION as much as to the verdict. ⚠️ Re-verified RED
        # by hand against `a-decision-with-nothing-to-fill-in.dom.test.ts`.
        [(CARD,
          "      text: means,\n",
          "      text: '',\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The line to be mutated is in
        # `ProposalCard.vue`, which the commit deleted along with `folderProposedIs` in
        # `project-folder.ts`. Proposals are gone end to end, so no card reads a `project_proposed`
        # row's folder word. Its anchor is left stale, so the census records it retired.
        "M7 · ⛔ the card trusts the row's WORD instead of folding it · `folderIsOf` dropped, so a "
        "`project_proposed` row that claims `a-folder-was-chosen` with no path — an older ledger, "
        "or a bundle `importBundle` read from a file and checked nothing in — paints an empty "
        "directory and a sentence about a folder that is not there",
        # ⚠️ **Anchor corrected by 489** — the card folds through `folderProposedIs` now, whose
        # extra arm is the creating one. ⛔ The defect is unchanged: trust the row's word and a
        # ledger that claims a path it does not carry paints a sentence about a folder that is not
        # there.
        [(CARD,
          "const folderIs = computed(() => folderProposedIs(proposal.value.folder, proposal.value.folderIs))",
          "const folderIs = computed(() => proposal.value.folderIs ?? 'nobody-has-chosen')")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The publish of `project_proposed`
        # (`said.folder.is` / `folderIs: said.folder.is`) is deleted from runtime-host.ts; bd70d693
        # says "Proposals go end to end". No proposal row is published, so there is no word to drop.
        # Its anchor is left stale, so the census records it retired.
        "M20 · ⚠️ the publish drops `folderIs` · the path is on the row and the WORD is not, so "
        "`folderIsOf` reads a declared `none` as *nobody has chosen* and the card tells a person "
        "nobody was asked — about a proposal where somebody was",
        # ⚠️ **Anchor corrected by 489**, which flipped the condition to name the arm that has NO
        # path — both path arms now write `folder`. ⛔ The defect is unchanged: drop the word and a
        # declared `none` reads back as *nobody has chosen*.
        [(HOST,
          "      ...(said.folder.is === 'no-folder-on-purpose' ? {} : { folder: said.folder.path }),\n"
          "      folderIs: said.folder.is,\n",
          "      ...(said.folder.is === 'no-folder-on-purpose' ? {} : { folder: said.folder.path }),\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The conditional spread that wrote
        # `folder` on the `project_proposed` payload went with the proposal publish ("Proposals go
        # end to end, with the demo seed, the renderer fixtures"). No proposal payload is written
        # any more, so the empty-string second spelling cannot be planted. Its anchor is left stale,
        # so the census records it retired.
        "M21 · ⚠️ *there is no path here* gains a SECOND SPELLING on a durable row · the conditional "
        "spread goes and a proposal declaring `none` carries `folder: ''`. ⛔ 086's fabricated value "
        "at the one place it is written once and read for ever: the absent key and the empty string "
        "are different bytes in the ledger, only `folderIsOf`'s trim saves the reading, and `441`'s "
        "own payload census can no longer say what a card was shown. ⚠️ **Re-aimed after the first "
        "draft measured a NO-OP** — `folder: …: undefined` is byte-identical through "
        "`JSON.stringify`, so it reported as a survivor while changing nothing "
        "(`a-mutation-that-changes-nothing-reports-as-a-survivor`)",
        # ⚠️ **Anchor corrected by 489** — see `M20` for the flip. ⛔ The defect is unchanged: the
        # conditional spread goes and a proposal declaring `none` carries `folder: ''`.
        [(HOST,
          "      ...(said.folder.is === 'no-folder-on-purpose' ? {} : { folder: said.folder.path }),",
          "      folder: said.folder.is === 'no-folder-on-purpose' ? '' : said.folder.path,")],
    ),
    # ── §2 · `none` as a choice, and the parse that keeps it one ────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `declaredFolderFrom` lived in
        # `apps/desktop/src/shared/project-folder.ts`, which bd70d693 deleted whole (375 lines) with
        # "project folders and their rails". The tool argument it parsed (`create_project`'s folder)
        # no longer exists, so a malformed-folder-becomes-none defect cannot be planted anywhere.
        # Its anchor is left stale, so the census records it retired.
        "M2 · 🔴 a malformed folder becomes a quiet *none* · `declaredFolderFrom` answers the second "
        "arm instead of `null`, so a model that sent nothing usable is recorded as having CHOSEN to "
        "have no folder. ⛔ That is §2.2's failure exactly — a null nobody picked wearing the word "
        "somebody chose — and it reaches a durable row through a person's Approve",
        # ⚠️ **Anchor corrected by 489**, which added the `make` arm and folded both spellings
        # through ONE `startsWith` rule — so the variable is `path` rather than `typed`. ⛔ The
        # defect is unchanged and now reaches BOTH path arms, which is strictly wider.
        [(VOCAB,
          "  if (!path.startsWith('/') && !path.startsWith('~')) return null",
          "  if (!path.startsWith('/') && !path.startsWith('~')) return { is: 'no-folder-on-purpose' }")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The relative-path guard was a line in
        # `project-folder.ts`, deleted by bd70d693 together with `create_project` and proposals. No
        # agent-declared project folder is parsed anywhere now, so there is no accepted or refused
        # path to protect. Its anchor is left stale, so the census records it retired.
        "M3 · ⚠️ a RELATIVE path is accepted · `dev/brobot-2` is resolved against whatever directory "
        "this app's own process happens to be in, which is a place the agent that typed it has never "
        "seen and cannot mean — and a person reading `dev/brobot-2` on the card cannot tell which "
        "machine-absolute directory they are approving",
        # ⚠️ **Anchor corrected by 489** — see `M2`.
        [(VOCAB,
          "  if (!path.startsWith('/') && !path.startsWith('~')) return null\n",
          "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The closed `none` vocabulary
        # (`NO_FOLDER_WORD`, `declaredFolderFrom`) sat in the deleted `project-folder.ts`; the
        # commit removes "project folders and their rails" and proposals end to end. No caller can
        # declare a folder word any more. Its anchor is left stale, so the census records it
        # retired.
        "M4 · ⛔ the word is matched loosely · `startsWith` after a lower-case, so `None of it` and "
        "`none-for-now` are read as a declaration. ⚑ `a-closed-vocabulary-guards-what-a-member-says`: "
        "the guard is the equality, and a prefix test admits sentences the caller did not mean as a "
        "choice",
        [(VOCAB,
          "  if (typed === NO_FOLDER_WORD) return { is: 'no-folder-on-purpose' }",
          "  if (typed.toLowerCase().startsWith(NO_FOLDER_WORD)) return { is: 'no-folder-on-purpose' }")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `create_project` tool and its
        # `PROPOSE_FOLDER_ARGUMENT` are removed ("create_project and list_projects ... are
        # removed"); grep finds neither in agent-tools.ts. A missing-argument-defaults-to-none
        # defect has no tool call to ride on. Its anchor is left stale, so the census records it
        # retired.
        "M5 · 🔴 the tool DEFAULTS a missing argument to *none* · the `malformed-request` problem "
        "never fires, so a model that forgot the argument and a model that decided this project has "
        "no folder are the same call. ⛔ §2.2 again, one layer up from `M2`, and this is the shape a "
        "*sensible default* would take if anybody added one",
        [(TOOLS,
          "          const declared = declaredFolderFrom(args[PROPOSE_FOLDER_ARGUMENT])",
          "          const declared = declaredFolderFrom(args[PROPOSE_FOLDER_ARGUMENT]) ?? {\n"
          "            is: 'no-folder-on-purpose' as const,\n"
          "          }")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The fold's fallback arm was in the
        # deleted `project-folder.ts`; the no-decision-on-behalf-of-a-person rule guarded projects'
        # folder words, which D-016 removed together with the project surfaces. The `folder_is`
        # column remains in schema.ts but nothing folds or reads it. Its anchor is left stale, so
        # the census records it retired.
        "M12 · 🔴 the fold falls back to a DECISION · every project that predates `0029` — the person's "
        "own two — reads as *deliberately no folder*, so this app asserts a choice on behalf of "
        "somebody who was never asked. ⛔ It is the one direction the PO named: *\"that must be a "
        "stated choice, not a null nobody picked\"*",
        # ⚠️ **Anchor corrected by 489, and it had gone AMBIGUOUS rather than missing** — the new
        # `folderProposedIs` ends in the identical line, so the old anchor matched twice and applied
        # nowhere. ⛔ It now carries `folderIsOf`'s own preceding line, which is the neighbouring
        # unique text `a-duplicate-object-key-is-a-phantom-mutation` prescribes.
        [(VOCAB,
          "cwd.trim() !== '') return 'a-folder-was-chosen'\n"
          "  return said === 'no-folder-on-purpose' ? 'no-folder-on-purpose' : 'nobody-has-chosen'",
          "cwd.trim() !== '') return 'a-folder-was-chosen'\n"
          "  return said === 'nobody-has-chosen' ? 'nobody-has-chosen' : 'no-folder-on-purpose'")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `folderIsOf` lived in the deleted
        # `apps/desktop/src/shared/project-folder.ts` and its only readers (the store, the sheet,
        # the card) are deleted too. The commit removes "project folders and their rails" on
        # purpose, so the word-before-path fold has no subject left. Its anchor is left stale, so
        # the census records it retired.
        "M11 · ⛔ the fold asks the WORD before the PATH · the invariant reverses, so a row with a "
        "real directory and a stale `no-folder-on-purpose` beside it reads as having no folder — and "
        "a surface tells a person there is nothing there while every launch in that project starts "
        "in it",
        [(VOCAB, THE_FOLD,
          "  if (said === 'no-folder-on-purpose') return 'no-folder-on-purpose'\n"
          "  if (cwd !== null && cwd !== undefined && cwd.trim() !== '') return 'a-folder-was-chosen'\n"
          "  return 'nobody-has-chosen'\n")],
    ),
    # ── §3 · one rule, one fold, three doors ────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The approval path (`verifiedFolder`,
        # the `checkCwd` refusal inside it) was part of the proposal-approval flow that D-016
        # removed ("Proposals go end to end"). `checkCwd` itself survives only as the folder-picker
        # and spawn seam, which is a different rule than this row's approval-writes-project.cwd
        # defect. Its anchor is left stale, so the census records it retired.
        "M8 · 🔴 the approval path stops VERIFYING · `checkCwd`'s refusal is dropped, so a declared "
        "folder that has been deleted, is a file, or carves the credential store out of the "
        "confinement is written into `project.cwd` — and every conversation in that project then "
        "fails to launch, one at a time, with a sentence about a directory nobody chose today",
        [(HOST,
          "      const verdict = this.checkCwd(typed)\n      if (!verdict.ok) throw new Error(verdict.reason)\n",
          "      const verdict = this.checkCwd(typed)\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The store's project create door
        # (`folderIsOf(edit.cwd, edit.folderIs)`) went with
        # `createProject`/`saveProject`/`ProjectDetails`; session-store.ts no longer names
        # `folder_is` or writes a project's `cwd` (only the seeded `default` row, `project_sequence`
        # numbering and `SELECT id FROM project WHERE slug = ?` remain). The column survives in
        # schema.ts unused and unwritten. Its anchor is left stale, so the census records it
        # retired.
        "M9 · ⛔ the store writes the caller's CLAIM on create · `folderIsOf` dropped, so a payload "
        "saying `a-folder-was-chosen` with no path stores a pair this app's own reader has to "
        "correct — two answers to one question, which is 169 §1 at the column",
        [(STORE, "        folderIsOf(edit.cwd, edit.folderIs),", "        edit.folderIs,")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The store's project read that folded
        # `row.folder_is` is deleted with `ProjectDetails` (D-016: projects stop being something a
        # person or a model meets). Nothing reads `folder_is` in session-store.ts, so an unfolded
        # read cannot be planted. Its anchor is left stale, so the census records it retired.
        "M10 · ⛔ the READ stops folding · `0029` adds the column with no CHECK — `0017`'s price "
        "list — so the value is exactly as trustworthy as whatever last wrote it. ⚠️ Without the "
        "guard, a hand-edited database, a repair, or an older writer hands a surface a word this app "
        "cannot spell, which is the shape `370` ruled against by name",
        [(STORE, "    folderIs: folderIsOf(row.cwd, row.folder_is),",
          "    folderIs: row.folder_is as ProjectDetails['folderIs'],")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `SELECT id, slug, display_name,
        # description, cwd, folder_is, created_at FROM project WHERE slug = ?` statement no longer
        # exists in session-store.ts; the project detail read went with `ProjectDetails` and
        # `saveProject`. No reader of a project's folder declaration remains. Its anchor is left
        # stale, so the census records it retired.
        "M13 · ⚠️ `folder_is` is not SELECTED · the column exists, two doors write it, a person "
        "declares it — and every row comes back `undefined`, so a project deliberately without a "
        "folder is indistinguishable from one nobody ever asked about. ⛔ `423`'s finding, one "
        "column over",
        [(STORE,
          "        `SELECT id, slug, display_name, description, cwd, folder_is, created_at FROM project WHERE slug = ?`,",
          "        `SELECT id, slug, display_name, description, cwd, created_at FROM project WHERE slug = ?`,")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `const folderIs = z.enum(FOLDER_IS)`
        # is gone from ipc.ts: `FOLDER_IS` died with `project-folder.ts`, and the wire commands that
        # carried a project's folder (createProject, saveProject, the proposal decision) are removed
        # by D-016. No payload edge carries this vocabulary now. Its anchor is left stale, so the
        # census records it retired.
        "M19 · ⛔ the wire takes any string · `z.enum(FOLDER_IS)` becomes a bounded string, so the "
        "vocabulary is guarded by nothing on the one edge a payload crosses. ⚑ The store's fold "
        "narrows it back for two of the three words and NOT for the third, which is the quiet half: "
        "a caller's invented word lands in the column and only the reader saves the surface",
        [(IPC, "const folderIs = z.enum(FOLDER_IS)", "const folderIs = z.string().max(64)")],
    ),
    # ── §4 · the migration ──────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The row planted a backfill
        # of project.folder_is in migration 0029. 5e931be8 says 'the project, proposal, binding,
        # home and document tables go' and 'ONE migration, 0000_the_tree', so there is no project
        # table, no folder_is column and no 0029 file. The declared-folder feature went with
        # proposals and projects, and table 471's other rows on it are already retired. Its anchor
        # is left stale, so the census records it retired.
        "M14 · 🔴 `0029` BACKFILLS · one `UPDATE` turns every project that already exists into one "
        "that deliberately has no folder. ⛔ They were never declared, so this is the app putting a "
        "decision in a person's mouth about rows on their disk — and it is irreversible, because "
        "after it runs nothing can tell the two apart ever again",
        [(MIGRATION,
          "ALTER TABLE `project` ADD `folder_is` text;\n",
          "ALTER TABLE `project` ADD `folder_is` text;--> statement-breakpoint\n"
          "UPDATE `project` SET `folder_is` = 'no-folder-on-purpose' WHERE `folder_is` IS NULL;\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The row lowered the 0029
        # journal stamp below 0028's so drizzle silently skips the file. 5e931be8 rewrote
        # _journal.json to ONE entry (0000_the_tree, migration on a fresh file only), so no earlier
        # stamp exists to fall below and a-stamp-that-skips.test.ts sees skippable([x]) equal [].
        # Changing the lone stamp leaves every test green, and a plant that adds a second entry
        # would fail on a missing .sql file across the suite rather than on the stamp. Its anchor is
        # left stale, so the census records it retired.
        "M15 · ⛔ the journal stamp goes back to drizzle's generated value · `1789425783799` is "
        "43.61 hours BELOW `0028`'s, and `drizzle-orm` compares "
        "`Number(lastDbMigration.created_at) < migration.folderMillis` — so the file is SILENTLY "
        "skipped on every already-migrated database. ⚑ No error, and the column present only on "
        "fresh installs, which is the failure `379`, `380`, `383`, `419`, `440` and `441` each hit",
        [(JOURNAL, '"when": 1789669191316', '"when": 1789425783799')],
    ),
    # ── §5 · a person's blank box ───────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `folderAPersonTyped` was in the
        # deleted `project-folder.ts`, and both callers (the project sheet and the new-project form)
        # are deleted. Nobody types a project folder any more, so a blank box cannot declare
        # anything. Its anchor is left stale, so the census records it retired.
        "M16 · 🔴 a blank folder box DECLARES · `folderAPersonTyped`'s fallback becomes the choice, "
        "so a person who creates a project without filling in an optional field is recorded as "
        "having said this project has no folder. ⛔ HO-028 §4's *\"stated choice\"* put into "
        "somebody's mouth on the strength of an empty input",
        [(VOCAB, "  return folderIsOf(typed, held ?? 'nobody-has-chosen')",
          "  return folderIsOf(typed, held ?? 'no-folder-on-purpose')")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `ProjectSheet.vue` (631 lines) was
        # deleted by bd70d693 ("the project rooms, board, sheet and picker"). Holding a row's folder
        # declaration across a save has no sheet and no save door left. Its anchor is left stale, so
        # the census records it retired.
        "M17 · ⛔ the sheet stops HOLDING the row's declaration · it replaces all three fields on "
        "every save (339), so a project approved as *deliberately no folder* falls back to *nobody "
        "has chosen* the first time anybody edits its description. ⚠️ Standing rule 11's shape one "
        "field over: the app never removes what a person chose",
        [(SHEET, "    folderIs: folderAPersonTyped(cwd.value, project.value?.folderIs ?? null),",
          "    folderIs: folderAPersonTyped(cwd.value),")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `NewProject.vue` (537 lines) was
        # deleted by bd70d693 with the project picker and rooms. There is no create-project door to
        # spell a word by hand. Its anchor is left stale, so the census records it retired.
        "M18 · ⚠️ the create door spells the word by hand · `folderAPersonTyped` is not called and "
        "the literal is written instead, so the two doors that ask a person the same question stop "
        "being able to answer it the same way — and this one answers it wrong",
        [(NEW, "    folderIs: folderAPersonTyped(cwd.value),",
          "    folderIs: 'no-folder-on-purpose',")],
    ),
]
