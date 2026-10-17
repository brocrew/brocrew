"""3024 · F092's workspace delete (a0c4489c) and F089–F091's held-piece refusals (52872cc0, 8e0773c3).

⛔ **The subject**: a person's Delete of a workspace reaches the Trash only for a folder that is
BroBot's, listed, closed, not this window's own, not the Default, not holding or inside another
listed workspace, and unchanged between the check and the move; and when an agent is refused a
take-back, a new brief, a close or an interrupt on a piece it holds or on itself, the refusal says
so in a whole sentence, with who and when.

## ⚑ Safe to run

The tests only ever hand a FAKE trash (`aFakeTrash`): it records what it is handed, moves nothing,
and refuses, and records, any path outside the test's own throwaway root (`realpath` of a
`mkdtemp` folder under the temporary directory). Electron and `shell` are never imported, so every
row is safe to run, whatever the mutant does to the checks: at worst the fake trash is handed a
throwaway path. The rows that let a path through name it in their defect.

## ⚑ What a row here measures

 * ⚑ **M1–M10 are the workspace delete** (`delete-workspace.ts`): the check's refusal passed on to
   the caller (M1); this window's workspace and the Default caught by identity, not by spelling
   (M2, M3); a folder holding or inside this window's workspace (M4); a listed workspace inside the
   folder a link lists (M5); a lock naming a live process of another account read as closed (M6);
   a gate that cannot say, on Windows, taken as closed (M7); a folder gone between the check and
   the move (M8); the pasted-images folder checked again before it goes (M9); and the row of the
   spelling asked by leaving the list (M10).
 * ⚑ **M11–M14 are the held-piece refusals** (`agent-tools.ts`): the open sentence's consequence
   (M11), a reading days later said with its day (M12), the caller's own root said whole (M13),
   and an interrupt of itself said as an interrupt that was not sent (M14).

## ⚠️ M6 survives on a runner able to signal pid 1

M6 plants a lock naming pid 1 and relies on `kill(1, 0)` answering EPERM for a process of another
account. On a runner where that signal succeeds (root, or pid 1 owned by the runner's own uid in a
container) the lock reads as open either way, so M6 survives there. GitHub's Linux runner and a Mac
as a user both give EPERM.

## ⛔ What this table does not contain

 * ⚠️ M1 relies on vitest not type-checking: `checked.listedAs` and `path` are undefined under it,
   and the delete falls to "cannot reach" before the fake trash is touched.
 * ⚠️ The spare candidates (the `> 5` strangers cut, the pid `<= 0` bound, the trash-then-push
   order, the ended tail of F089): their tests are in place, but they are not rows here.
 * ⚑ A workspace nested inside one that the list holds only by a link is REFUSED since W4.155
   (79cb4970, 10ba7bea): every listed folder is followed to where it is and compared by identity.
   M5 survived that change for every listed workspace still on disk; it is killed (W4.167) by one
   listed but gone, which the identity comparison cannot follow and only the real spelling catches.
"""

DW = "apps/desktop/src/main/delete-workspace.ts"
AT = "apps/desktop/src/main/runtime/agent-tools.ts"

DELETE = "a-delete-refused-never-reaches-the-trash.test.ts"
WORDS = "a-piece-you-hold-or-yourself-said-word-for-word.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 `delete` ignores every refusal of its check · killed by "
        f"`{DELETE}`",
        [(DW,
          "  if (!checked.ok) return { deleted: false, refusal: checked.refusal }",
          "  if (!checked.ok && asked === '') return { deleted: false, refusal: checked.refusal }")],
    ),
    (
        "M2 · 🔴 this window's workspace is caught only by its exact spelling — a link to it, or its "
        f"Data-volume spelling, gets by · killed by `{DELETE}`",
        [(DW,
          "  if (sameFolder(asked, context.thisOne)) {",
          "  if (asked === context.thisOne) {")],
    ),
    (
        "M3 · 🔴 the Default is caught only by its exact spelling — a link to it gets by · killed by "
        f"`{DELETE}`",
        [(DW,
          "  if (sameFolder(asked, context.defaultFolder)) {",
          "  if (asked === context.defaultFolder) {")],
    ),
    (
        "M4 · 🔴 a folder holding or inside this window's workspace is not refused by identity · "
        f"the fake trash is handed a throwaway path · killed by `{DELETE}`",
        [(DW,
          "    [context.thisOne, 'the workspace this window runs on'],",
          "    [context.defaultFolder, 'the workspace this window runs on'],")],
    ),
    (
        "M5 · a listed workspace inside the folder a link lists is missed, and the refusal is told "
        f"in other words · killed by `{DELETE}`",
        [(DW,
          "if ([listedAs, real].some((spelling) => insideBySpelling(other, spelling, context.platform))) {",
          "if ([listedAs].some((spelling) => insideBySpelling(other, spelling, context.platform))) {")],
    ),
    (
        "M6 · 🔴 a lock naming a live process of another account reads as closed, so a workspace "
        f"that is open is deleted · killed by `{DELETE}` (survives on a runner able to signal pid 1)",
        [(DW,
          "    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'closed' : 'open'",
          "    return 'closed'")],
    ),
    (
        "M7 · 🔴 on Windows a gate that cannot say is taken as closed, so a workspace that may be "
        f"open is deleted · killed by `{DELETE}`",
        [(DW,
          "  if (gate === 'unknown' && lock === null) {",
          "  if (false) {")],
    ),
    (
        "M8 · a folder gone before the move is told it changed, not that BroBot cannot reach it · "
        f"killed by `{DELETE}`",
        [(DW,
          "refusal: 'BroCrew cannot reach this folder now. Try again.'",
          "refusal: 'This folder changed while BroCrew checked it. Try again.'")],
    ),
    (
        "M9 · 🔴 the pasted-images folder is not checked again before it goes, so a file a person "
        f"added since goes with it · killed by `{DELETE}`",
        [(DW,
          "      : (await itsPastedImages(checked.path, thisAccount())).folder",
          "      : checked.pastedImages")],
    ),
    (
        "M10 · the row of the spelling asked by stays in the list after the delete · killed by "
        f"`{DELETE}`",
        [(DW,
          # ⚑ **W4.156 · re-anchored in place, not retired** — W4.155 takes every listed spelling of the folder off the list (`checked.rows`), which holds the asked one whenever it is listed, so dropping `asked` alone now changes nothing (measured: it survives). The plant drops both routes, keeping only the list's own spelling and the folder's, so the row of the spelling asked by stays, as the label says. Killed by the same test.
          "new Set([...checked.rows, asked, checked.path])",
          "new Set([checked.listedAs, checked.path])")],
    ),
    (
        "M11 · the open refusal of a piece you hold says nothing was changed, not that nothing was "
        f"taken back · killed by `{WORDS}`",
        [(AT,
          "    `${label} is a piece you hold, not one you gave, so nothing was taken back. withdraw_task ` +\n",
          "    `${label} is a piece you hold, not one you gave, so nothing was changed. withdraw_task ` +\n")],
    ),
    (
        "M12 · an ending read days later is said as a bare time, so it reads as today · killed by "
        f"`{WORDS}`",
        [(AT,
          "  const when = held.at === undefined ? '' : ` at ${clockTimeFrom(held.at, held.readAt)}`\n",
          "  const when = held.at === undefined ? '' : ` at ${clockTimeFrom(held.at, held.at)}`\n")],
    ),
    (
        "M13 · the caller's own root is refused without saying that nothing was taken back · "
        f"killed by `{WORDS}`",
        [(AT,
          "    `${label} is this conversation’s own work, from a person, so nothing was taken back. ` +\n",
          "    `${label} is this conversation’s own work, from a person. ` +\n")],
    ),
    (
        "M14 · an interrupt of itself is refused as if something was sent · killed by "
        f"`{WORDS}`",
        [(AT,
          "a conversation cannot interrupt itself, so nothing was interrupted. Stop your own work",
          "a conversation cannot interrupt itself, so nothing was sent. Stop your own work")],
    ),
]
