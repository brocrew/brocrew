"""3020 · today's other risky code — `trustedAnchor` by identity (W4.124, 978fbe09), the updater's
restart-when-quiet (W4.109 / W4.128, 03c8775b and after) and A2's never-read-the-list-at-launch
(W4.131, d25cbc13…d346b8f6).

## ⚑ What a row here measures

 * ⚑ **M1–M5 are the never-touch checks, asked of what folders ARE** (`scripts/lib/safe-remove.mjs`):
   the identity `'is'` in `whereItStands` and in `trustedAnchor`, macOS's second (Data-volume)
   spelling, and both comparisons — forbidden roots and the working directory — made by identity,
   not by spelling. ⚠️ M3–M5 are killed ONLY by the darwin-only tests (`ctx.skip` elsewhere): on a
   Linux runner they survive. ⚠️ Table 351 already has M24 (`holds`), M25 (cwd `holds`), M34
   (`inside`), M33 (`.native`), M36 (unresolvable root) — none repeated here.
 * ⚑ **M6–M11 are the restart that waits until nothing would stop** (`updates.ts`, and the host's
   `whatARestartWouldStop`): another workspace it cannot tell about keeps it waiting; the
   conversations are read again after the process list; a cancel's look already under way never
   installs; no process list is read while a conversation here is busy; the Mac's opened disk image
   is never installed; a running turn alone is listed.
 * ⚑ **M12–M16 are A2's rule: no launch reads the list to choose its folder**
   (`data-folder.ts`, `workspaces.ts`, `workspaces-in-the-app.ts`): a launch that names its own
   folder keeps it; the pin never reads `workspaces.json`; a launch's own entry is matched by
   spelling and no other listed folder is read; a list that cannot be written changes nothing; a
   hidden launch never lists itself.

## ⛔ What this table does not contain

**No test reaches it (for the report):**

 * `whereItStands`' `'holds'`-before-`'inside'` order — only a folder mounted inside itself (Linux)
   tells them apart, and no test builds one.
 * The "could not be compared" refusals (`where === undefined`, `fromHere === undefined`,
   `foldersAbove` returning `undefined` on an unreadable parent, `spellingsOf` returning
   `undefined`) — defensive; no seam makes `identityOf` answer "could not ask".
 * `identityOf` keeping the device beside the inode (`dev:ino`) — no test has two volumes.
 * `spellingsOf`' slice branch (a Data-spelled path mapped back to its `/` spelling) — every darwin
   test reaches the same folder through the other branch or by identity alone.
 * `restartWhenQuiet`'s `stopped ||` guard — a restart chosen after `stop()` awaits a process list
   the test never answers, so nothing it asserts changes.
 * `whatARestartWouldStop`'s `turnRunning` parts one by one (`session.turnOpened`, `flushing`,
   `handingOver`, `startsInFlight`, `arrivals`) — the one host test cannot tell which made it true.
 * `readToRewrite`'s ENOENT-only rule — an unreadable list still throws later, at the rename.

**Killed, but left out for room** (each confirmed by reading `updates.test.ts`): `nothingWouldStop`
ignoring conversations, `stop()` / `cancelRestart()` not spending the choice, `wait` arming no next
look, a look that throws not said as an error, a newer list (`version > LIST_VERSION`) written over.
"""

SAFE = "scripts/lib/safe-remove.mjs"
UPDATES = "apps/desktop/src/main/updates.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
DATA = "apps/desktop/src/main/data-folder.ts"
CORE = "apps/desktop/src/main/workspaces.ts"
WIRED = "apps/desktop/src/main/workspaces-in-the-app.ts"

SAFE_TEST = "safe-remove.test.mjs"
UPDATES_TEST = "updates.test.ts"
RESTART = "what-a-restart-would-stop.test.ts"
WORKSPACES = "workspaces.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 **the identity `'is'` lost** · a target that IS a never-touch folder is neither "
        "inside nor holding it, so `--dir` on the checkout or a mis-cased `$HOME` is trusted · "
        f"killed by `{SAFE_TEST}`",
        [(SAFE,
          "  if (it === that) return 'is'\n",
          "  if (false) return 'is'\n")],
    ),
    (
        "M2 · 🔴 `trustedAnchor` passes over `'is'` — the never-touch folder itself is trusted when "
        f"it holds no other forbidden root · killed by `{SAFE_TEST}`",
        [(SAFE,
          "    if (where === 'is') {\n",
          "    if (where === 'is' && false) {\n")],
    ),
    (
        "M3 · 🔴 **the second spelling dropped** · a folder's parents are read in its `/` spelling "
        "only, so `/System/Volumes/Data` (and `/System/Volumes`, `/System`) is trusted though it holds "
        f"the home (darwin only) · killed by `{SAFE_TEST}`",
        [(SAFE,
          "  if (there === here) return [real, other]\n",
          "  if (false) return [real, other]\n")],
    ),
    (
        "M4 · 🔴 **back to comparing spellings** · the forbidden roots are string-compared again, so "
        "the Data-volume spelling of `~`, `~/.claude`, `~/.codex` is trusted (darwin only) · killed "
        f"by `{SAFE_TEST}`",
        [(SAFE,
          "    const where = whereItStands(real, forbiddenReal)\n",
          "    const where = real === forbiddenReal ? 'is' : isAncestor(real, forbiddenReal) ? 'holds'"
          " : isAncestor(forbiddenReal, real) ? 'inside' : null\n")],
    ),
    (
        "M5 · the working directory compared by spelling again — run from one spelling, the target "
        f"typed the other way is trusted (darwin only) · killed by `{SAFE_TEST}`",
        [(SAFE,
          "  const fromHere = cwdReal === null ? null : whereItStands(real, cwdReal)\n",
          "  const fromHere = cwdReal === null ? null : real === cwdReal ? 'is'"
          " : isAncestor(real, cwdReal) ? 'holds' : null\n")],
    ),
    (
        "M6 · 🔴 another workspace it CANNOT tell about counts as none, so the update installs and "
        f"may stop a BroBot it never saw · killed by `{UPDATES_TEST}`",
        [(UPDATES,
          "  return stops.conversations.length === 0 && stops.otherWorkspaces === 0\n",
          "  return stops.conversations.length === 0 && (stops.otherWorkspaces ?? 0) === 0\n")],
    ),
    (
        "M7 · 🔴 **the mid-turn install** · the conversations are not read again after the process "
        f"list, so a turn that started meanwhile is cut by the restart · killed by `{UPDATES_TEST}`",
        [(UPDATES,
          "        const stops = { conversations: deps.conversationsARestartWouldStop(), otherWorkspaces }\n",
          "        const stops = { conversations: busy, otherWorkspaces }\n")],
    ),
    (
        "M8 · 🔴 a restart cancelled — or the app quitting — while the process list is read still "
        f"installs when the look answers · killed by `{UPDATES_TEST}`",
        [(UPDATES,
          "        otherWorkspaces = await deps.otherWorkspacesRunning()\n"
          "        // ⚑ Cancelled, chosen again, or quitting, while it looked: the latest word stands.\n"
          "        if (choice !== restartChoice) return\n",
          "        otherWorkspaces = await deps.otherWorkspacesRunning()\n"
          "        // ⚑ Cancelled, chosen again, or quitting, while it looked: the latest word stands.\n")],
    ),
    (
        "M9 · the computer's process list is read on every look while a conversation here is busy "
        f"(a PowerShell each time on Windows) · killed by `{UPDATES_TEST}`",
        [(UPDATES,
          "        if (busy.length > 0) {\n",
          "        if (false) {\n")],
    ),
    (
        "M10 · 🔴 the Mac's opened disk image is INSTALLED by Restart to update — the guided update "
        f"starts an install it never downloaded for · killed by `{UPDATES_TEST}`",
        [(UPDATES,
          "      deps.installs !== 'on-restart' ||\n"
          "      !((ready.kind === 'ready' && ready.how === 'restart') || ready.kind === 'waiting-to-restart')\n",
          "      !(ready.kind === 'ready' || ready.kind === 'waiting-to-restart')\n")],
    ),
    (
        "M11 · 🔴 a running turn alone no longer keeps the update waiting — the host lists a "
        f"conversation only for a card, held words or background work · killed by `{RESTART}`",
        [(HOST,
          "        row.turnRunning ||\n        row.waitingOnAPerson ||\n",
          "        row.waitingOnAPerson ||\n")],
    ),
    (
        "M12 · 🔴 a launch that names its own folder (`--user-data-dir`) is moved to the default "
        f"folder — every restart, reopen and other workspace lands on the wrong data · killed by `{WORKSPACES}`",
        [(DATA,
          "  if (app.commandLine.hasSwitch('user-data-dir')) return\n",
          "  if (false) return\n")],
    ),
    (
        "M13 · 🔴 **the person's rule broken** · the launch reads `workspaces.json` and opens the most "
        f"recently listed folder, even one that is gone · killed by `{WORKSPACES}`",
        [(DATA,
          "  const folder = defaultDataFolder(app.getPath('appData'))\n",
          "  let folder = defaultDataFolder(app.getPath('appData'))\n"
          "  try {\n"
          "    folder = (JSON.parse(readFileSync(join(app.getPath('appData'), '@brobot2', 'workspaces.json'), 'utf8')) as { workspaces: { path: string }[] }).workspaces[0]?.path ?? folder\n"
          "  } catch {}\n")],
    ),
    (
        "M14 · a launch matches its own entry by reading every listed folder on the disk — one on a "
        f"share that is gone holds the launch up · killed by `{WORKSPACES}`",
        [(CORE,
          "import { insideBySpelling, samePath } from './same-folder'\n",
          "import { insideBySpelling, sameFolder, samePath } from './same-folder'\n"),
         (CORE,
          "  const others = readToRewrite(file).filter((one) => !samePath(one.path, path))\n",
          "  const others = readToRewrite(file).filter((one) => !sameFolder(one.path, path))\n")],
    ),
    (
        "M15 · a list that cannot be written throws out of `startWorkspaces` and takes the launch's "
        f"IPC with it · killed by `{WORKSPACES}`",
        [(WIRED,
          "    try {\n"
          "      rememberWorkspace(listFile, userData, Date.now())\n"
          "    } catch (error) {\n"
          "      console.error(`BroCrew could not add this workspace to its list (${listFile}):`, error)\n"
          "    }\n",
          "    rememberWorkspace(listFile, userData, Date.now())\n")],
    ),
    (
        "M16 · a hidden launch (every test and smoke) adds itself to the list it keeps · killed by "
        f"`{WORKSPACES}`",
        [(WIRED,
          "  if (!options.hidden) {\n    try {\n      rememberWorkspace(",
          "  if (true) {\n    try {\n      rememberWorkspace(")],
    ),
]
