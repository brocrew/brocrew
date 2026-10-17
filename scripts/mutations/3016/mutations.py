"""3016 · F046 titles, F059 and F006 — 50a548e2, 3cbc4bf5, 1abdb8ab, e59ef72c.

⛔ **The subject**: three host facts an agent or a window reads back. **F046** — a kept file is
titled by its own bytes (front matter `title:` first, read only when the block reads as YAML keys),
and the files kept before titles were taken are titled once, after a launch, a page at a time,
yielding the main process, stopping at a quit and telling the windows once. **F059** — `update_work`
on a piece that has ended says how, when and by whom, and the act THIS caller still has. **F006** —
each launch is told which build is running, and a build it cannot read costs only the line.

## ⚑ What a row here measures

 * ⚑ **M1, M13 are the store's two F046 statements** (`session-store.ts`): a title is written only
   while the row has none, and the untitled rows come oldest first.
 * ⚑ **M4–M7, M12 are the titling pass** (`runtime-host.ts` `titleTheOlderFiles`): a page that
   titles nothing ends it, a quit stops it after the file in hand and tells no window, it hands the
   main process back before its first read, and a page is read for its `<title>`. ⚠️ Anchored on
   today's text: `1c7a116e` added a second loop (the files titled by their name, read again) and
   turned the closing `titled > 0` into `titled + retitled > 0`; M6 plants on that line, and M5 on
   the FIRST loop's inner quit check (anchored with the lines after it — the second loop has its
   own). ⚠️ M12 is partly rescued by that second loop: the page, titled by its name in the first
   loop, is read again and retitled — so the pass answers `retitled: 1` where it owes `0`.
 * ⚑ **M10, M11 are the front-matter reader** (`resources.ts`): a rule followed by prose is no front
   matter, and a value that is only a ` #` comment is no title. Anchored on today's text after
   `38c695ac` (quoted values, `quotedValue`): both lines stand as they were.
 * ⚑ **M2, M3, M14–M16 are F059** — the host's detail (`runtime-host.ts`: the caller's own act,
   whose title it is, the reading moment) and its sentence (`agent-tools.ts` `anEndedPieceSaid`:
   the time on the reader's day, and "read its answer" only for a giver that did not answer it).
 * ⚑ **M8, M9, M17, M18 are F006** — the host's read of the build (a throw costs the line, never the
   launch; the launch is handed it) and `theBuildRunningSaid`'s two arms (`factory-text.ts`).

## ⛔ What this table does not contain

 * ⚠️ `/^title:(?:[ \\t](.*))?$/` alone — the notes found it indistinguishable from the block check.
 * ⚠️ `b337beed` (F006 wording) and `9e106ef0` (D-049, a removal): no rows.
 * ⚠️ No candidate row was dropped: every subject the notes named still stands after `38c695ac` and
   `1c7a116e`; M5, M6 and M12 are re-anchored on today's text as said above.
"""

STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RES = "apps/desktop/src/main/resources/resources.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
FACTORY = "apps/desktop/src/main/runtime/factory-text.ts"

UNTITLED = "a-file-kept-untitled-is-titled-only-while-it-has-none.test.ts"
ONCE = "the-files-kept-before-titles-were-taken-are-titled-once.test.ts"
YAML = "a-front-matter-title-is-read-as-yaml-keys.test.ts"
ENDED = "update-work-on-an-ended-piece-says-how-when-and-by-whom.test.ts"
BUILD = "each-conversation-is-told-which-build-is-running.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 **a kept title is overwritten** · `titleResource` writes over a title written "
        f"between the pass's read and its write · killed by `{UNTITLED}` and `{ONCE}`",
        [(STORE,
          "        `UPDATE work_resource SET title = ? WHERE id = ? AND title IS NULL`,\n",
          "        `UPDATE work_resource SET title = ? WHERE id = ?`,\n")],
    ),
    (
        "M2 · 🔴 an ended piece's caller is matched against its OWNER, not itself — the giver who "
        f"closed it reads its own act by its own name, and the helper reads \"You\" · killed by `{ENDED}`",
        [(HOST,
          "            : this.theIdsItStandsFor(caller).includes(endedBy)\n",
          "            : this.theIdsItStandsFor(row.owner).includes(endedBy)\n")],
    ),
    (
        "M3 · 🔴 whose title it is, inverted — the giver of an ended piece is told to stop work on "
        f"it, and its helper that it may retitle it · killed by `{ENDED}`",
        [(HOST,
          "          yoursToRetitle: itsGiver || row.givenBy === null,\n",
          "          yoursToRetitle: !(itsGiver || row.givenBy === null),\n")],
    ),
    (
        "M4 · 🔴 **the titling pass spins** · a page that titles nothing (every row titled "
        f"elsewhere) is read again and again · killed by `{ONCE}`",
        [(HOST,
          "      if (page.length === 0 || titledNow === 0) break\n",
          "      if (page.length === 0) break\n")],
    ),
    (
        "M5 · 🔴 a quit begun mid-pass does not stop the page in hand — every file left on it is "
        f"read and titled during the quit · killed by `{ONCE}`",
        [(HOST,
          "        if (this.launches.closed) break\n"
          "        const form = formOfName(row.name)\n"
          "        const read = form === 'markdown' || form === 'page' ? resourceBytes(root, row) : null\n",
          "        const form = formOfName(row.name)\n"
          "        const read = form === 'markdown' || form === 'page' ? resourceBytes(root, row) : null\n")],
    ),
    (
        "M6 · the windows are told the work moved while the app is quitting · killed by "
        f"`{ONCE}`",
        [(HOST,
          "    if (titled + retitled > 0 && !this.launches.closed) this.theWorldMoved('work')\n",
          "    if (titled + retitled > 0) this.theWorldMoved('work')\n")],
    ),
    (
        "M7 · the pass reads its first page on the launch path — no hand-back before it, so a quit "
        f"begun as it starts is not seen · killed by `{ONCE}`",
        [(HOST,
          "    let titled = 0\n    await handBackTheMainProcess()\n",
          "    let titled = 0\n")],
    ),
    (
        "M8 · 🔴 **a build that cannot be read refuses the launch** · `theBuildRunning` rethrows "
        f"instead of costing the line · killed by `{BUILD}`",
        [(HOST,
          "      console.warn(`runtime host could not read which build is running: ${errorMessage(error)}`)\n"
          "      return null\n",
          "      console.warn(`runtime host could not read which build is running: ${errorMessage(error)}`)\n"
          "      throw error\n")],
    ),
    (
        "M9 · no launch is told the build — the launch context carries `build: null` · killed by "
        f"`{BUILD}`",
        [(HOST,
          "      build: this.theBuildRunning(),\n",
          "      build: null,\n")],
    ),
    (
        "M10 · 🔴 a horizontal rule followed by prose is read as front matter — a `title:` line in "
        f"the body becomes the file's title · killed by `{YAML}`",
        [(RES,
          "  if (!isYaml) return null\n",
          "")],
    ),
    (
        "M11 · `title: # TODO` is titled `# TODO` — a value that is only a comment is taken as the "
        f"title · killed by `{YAML}`",
        [(RES,
          "    const comment = raw.search(/(?:^|[ \\t])#/)\n",
          "    const comment = raw.search(/[ \\t]#/)\n")],
    ),
    (
        "M12 · an older page is not read for its `<title>` in the first loop — titled by its name, "
        f"and only retitled by the second · killed by `{ONCE}`",
        [(HOST,
          "        const read = form === 'markdown' || form === 'page' ? resourceBytes(root, row) : null\n",
          "        const read = form === 'markdown' ? resourceBytes(root, row) : null\n")],
    ),
    (
        "M13 · the untitled rows come newest first — the pass's pages walk the table backwards · "
        f"killed by `{UNTITLED}`",
        [(STORE,
          "`SELECT ${RESOURCE_COLUMNS} FROM work_resource WHERE title IS NULL ORDER BY rowid LIMIT ?`",
          "`SELECT ${RESOURCE_COLUMNS} FROM work_resource WHERE title IS NULL ORDER BY rowid DESC LIMIT ?`")],
    ),
    (
        "M14 · an ending on another day is said with its time alone — the reading moment is "
        f"ignored · killed by `{ENDED}`",
        [(TOOLS,
          "  const when = detail.at === undefined ? '' : ` at ${clockTimeFrom(detail.at, readAt)}`\n",
          "  const when = detail.at === undefined ? '' : ` at ${clockTime(detail.at)}`\n")],
    ),
    (
        "M15 · the refusal is read as of the moment the piece ended, not now — an ending on another "
        f"day loses its date · killed by `{ENDED}`",
        [(HOST,
          "          yoursToRetitle: itsGiver || row.givenBy === null,\n        },\n        readAt: this.now(),\n",
          "          yoursToRetitle: itsGiver || row.givenBy === null,\n        },\n        readAt: folded.endedAt ?? this.now(),\n")],
    ),
    (
        "M16 · a giver that itself answered its piece is told to read its own answer with "
        f"list_tasks · killed by `{ENDED}`",
        [(TOOLS,
          "    : detail.state === 'answered' && !yours\n",
          "    : detail.state === 'answered'\n")],
    ),
    (
        "M17 · a development build with no commit is said as a build that did not record one · "
        f"killed by `{BUILD}`",
        [(FACTORY,
          "  if (build.id === BUILD_IS_DEV) {\n",
          "  if (build.id === BUILD_IS_DEV && build.commit !== '') {\n")],
    ),
    (
        "M18 · a half-stamp — an id and no commit — is said as \"built from commit ``\" · killed by "
        f"`{BUILD}`",
        [(FACTORY,
          "  if (build.commit === '' || build.id === BUILD_IS_UNRECORDED) {\n",
          "  if (build.id === BUILD_IS_UNRECORDED) {\n")],
    ),
]
