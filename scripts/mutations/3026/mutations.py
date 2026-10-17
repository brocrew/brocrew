"""3026 · a delete follows every listed workspace to where it is, and the last read before the Trash is fresh — 79cb4970, 10ba7bea, 70726791.

⛔ **The subject**: W4.155's real-path delete. Every listed folder is followed through its links
(`whereItIs`: `realpath`, asked without blocking) and compared with the folder to delete by what
the folders ARE (`whereItStands`); one that is gone, or leads to no folder (a loop), blocks nothing;
one that does not answer refuses. A folder above it with a sign of a workspace refuses it, listed or
not. Every row that is this same folder by another spelling is asked whether it is open and leaves
the list with it. And the identity read just before the Trash reads the disk now (70726791).

## ⚑ Safe to run

Neither killer reaches a real Trash: `a-delete-refused-never-reaches-the-trash.test.ts` hands only
`aFakeTrash`, which moves nothing and refuses any path outside its `mkdtemp` root; and
`delete-workspace.test.ts` hands only `aTrash`, a function of its own that renames what it is handed
into `<root>/trash` (never `shell`, never Electron). ⚠️ `aTrash` does NOT refuse an outside path, so
each row was checked: the Trash is only ever handed `checked.path` (the real path of the listed
spelling, from `trustedAnchor`) or its pasted-images sibling, and no row here touches either; in
both files every folder asked, listed or linked to is inside the test's throwaway root (the
Data-volume spellings name the same throwaway folders). Every case that kills a row below is a
`deleteVerdict` (no Trash at all) or a refused delete, except M10's, which hands either fake Trash a
throwaway folder it would otherwise have refused.

## ⚑ What a row here measures

 * ⚑ **M1–M6 are the listed-folder loop** (`check`): a listed folder that holds this one only by
   a link, by identity (M1); one this folder holds only by a link (M2); the link followed at all
   (M3); a gone row blocks nothing (M4); one that does not answer refuses (M5); a link loop blocks
   nothing (M6).
 * ⚑ **M7, M8 are the rows of the same folder** (10ba7bea): kept (M7) and each asked whether it is
   open (M8).
 * ⚑ **M9 is the walk up**: a folder inside a workspace the list does not hold.
 * ⚑ **M10 is the last read before the Trash** (70726791): it reads the disk, not what the check saw.

Not repeated from 3024: its M5 (`[listedAs, real]` by spelling) and M10 (the forget set) anchor in
the same loop and delete, on other lines and other defects.

## ⛔ What this table does not contain

 * ⚠️ 70726791's own plant — the last read joining an earlier lookup (`stat-now` → `stat`): a local
   `stat` has settled, and left `stillAsking`, long before the delete reads again; only a share that
   stalls could tell, and no test has one.
 * ⚠️ The own row skipped by its exact spelling (`other === listedAs` → `samePath`): no test lists
   a row spelled like the folder by case or `..` that leads elsewhere.
 * ⚠️ The Default and this window's folder followed before they are compared (`theirs`), the
   `EISDIR` spelling (Windows), and `askedOnce`'s timer: no test makes either folder a link, runs on
   Windows' refusing drives, or stalls a lookup.
 * ⚠️ The delete's own run check over every row (`checked.rows`): no test opens another spelling
   between the check and the move.
 * ⚠️ M5 survives on Windows and as root (the case that kills it is skipped there).
"""

DW = "apps/desktop/src/main/delete-workspace.ts"

REFUSED = "a-delete-refused-never-reaches-the-trash.test.ts"
DELETE = "delete-workspace.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 a folder inside a workspace the list holds only by a link is not refused by where it "
        "is — inside one never started, it is deleted · killed by "
        f"`{DELETE}` (\"W4.155 · a workspace the list holds only by a link\")",
        [(DW,
          "    if (where === 'inside') return refused(`This folder is inside the workspace ${other}.`)\n",
          "    if (false) return refused(`This folder is inside the workspace ${other}.`)\n")],
    ),
    (
        "M2 · 🔴 a folder holding a workspace the list reaches only by a link is not refused by where "
        f"it is · killed by `{DELETE}` (\"W4.155 · a workspace the list holds only by a link\", "
        "around it)",
        [(DW,
          "    if (where === 'holds') return refused(`This folder holds the workspace ${other}.`)\n",
          "    if (false) return refused(`This folder holds the workspace ${other}.`)\n")],
    ),
    (
        "M3 · 🔴 **a listed folder is not followed through its link** · compared as the list spells "
        f"it, a workspace held only by a link is missed · killed by `{DELETE}` (\"W4.155 · a "
        "workspace the list holds only by a link\", around it)",
        [(DW,
          "        (real) => real,\n",
          "        () => folder,\n")],
    ),
    (
        "M4 · a listed workspace that is gone blocks every delete · killed by "
        f"`{DELETE}` (\"a listed folder that is gone blocks nothing\") and `{REFUSED}` (\"3024 M5 · "
        "… one listed elsewhere lets it go\")",
        [(DW,
          "    if (otherReal === null) continue\n",
          "    if (otherReal === null) return refused(`The workspace ${other} is gone.`)\n")],
    ),
    (
        "M5 · 🔴 a listed workspace BroBot cannot reach is taken as gone, so a folder that may be "
        f"part of it is let through · killed by `{DELETE}` (\"… one BroBot cannot reach refuses\"; "
        "skipped on Windows and as root)",
        [(DW,
          "    if (otherReal === undefined) {\n",
          "    if (otherReal === undefined) continue\n    if (false) {\n")],
    ),
    (
        "M6 · a listed link loop is read as unreachable and blocks every delete · killed by "
        f"`{DELETE}` (\"a listed folder that is gone blocks nothing\", the loop)",
        [(DW,
          "if (['ENOENT', 'ENOTDIR', 'ELOOP', 'ENAMETOOLONG'].includes(error.code ?? '')) return null",
          "if (['ENOENT', 'ENOTDIR', 'ENAMETOOLONG'].includes(error.code ?? '')) return null")],
    ),
    (
        "M7 · 🔴 another spelling of the same folder is not one of its rows: open by it, it is "
        f"deleted, and its row stays on the list · killed by `{DELETE}` (\"every row that is this "
        "folder by another spelling …\")",
        [(DW,
          "    if (where === 'is') rows.push(other)\n",
          "    if (where === 'is') void other\n")],
    ),
    (
        "M8 · 🔴 the check asks only the list's own spelling whether it is open, not every row of the "
        f"folder · killed by `{DELETE}` (\"every row that is this folder by another spelling …\")",
        [(DW,
          "  for (const row of rows) {\n",
          "  for (const row of [listedAs]) {\n")],
    ),
    (
        "M9 · 🔴 a folder inside a workspace the list does not hold is deleted — no sign above it is "
        f"read · killed by `{DELETE}` (\"inside a workspace the list does not hold at all\")",
        [(DW,
          "    if (isBroBotsFolder(above)) return refused(`This folder is inside the workspace ${above}.`)\n",
          "    if (false) return refused(`This folder is inside the workspace ${above}.`)\n")],
    ),
    (
        "M10 · 🔴 **the last read before the Trash is not a read** · it answers what the check saw, "
        "so a folder gone or swapped since is handed to the Trash · killed by "
        f"`{REFUSED}` (\"the folder gone between the check and the move\") and `{DELETE}` (\"a folder "
        "swapped for another while it was checked\")",
        [(DW,
          "  const identity = await identityOf(checked.path, true)\n",
          "  const identity = checked.identity\n")],
    ),
]
