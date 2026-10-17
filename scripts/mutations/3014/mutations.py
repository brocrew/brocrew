"""3014 · the pinned data folder and packaging — b4401765, 2f3f8cb5, f441ec95.

⛔ **The subject**: where every person's data lives, decided before anything reads it, and the
two places that speak for it. The app pins `<appData>/@brobot2/desktop` as Electron's `userData`
as the first thing `index.ts` does, making the folder first and touching nothing when a launch
names its own `--user-data-dir`; Windows is given the app's id and no other system is. The
packaged Windows check fails a build that kept its data anywhere else, and launches nothing on a
machine where a person's data could be. clean-base, which empties that folder, warns about it
before anything can stop the run.

## ⚑ What a row here measures

 * ⚑ **M1–M3, M11 are the pin** (`data-folder.ts`, `index.ts`): nothing made or asked for when
   `--user-data-dir` is given; the folder made BEFORE `setPath`; the pin first after the imports;
   the folder under `appData`, not another path.
 * ⚑ **M6–M8 are the pin's failure path and the Windows id** (2f3f8cb5): a folder that cannot be
   made still pinned; the bare call asks the process's platform; only Windows gets the id.
 * ⚑ **M4, M5, M9, M10, M12 are the packaged check** (`windows-packaged-check.mjs`): a runner
   that already holds a folder is not measured; a folder named after the app fails the build; no
   database after the whole wait fails it; a pid that already ended is not killed; a self-hosted
   runner is never launched on.
 * ⚑ **M13, M14 are clean-base's warning** (f441ec95), on today's text after dev `2264dcfd`:
   the warning hangs on the target being the shared folder, not on `--dir` being absent (M13),
   and is said before the run can find the folder absent and stop (M14).

## ⛔ What this table does not contain

 * ⚠️ 273d4cc7: it follows the rename in tests and census only; no product logic.
 * ⚠️ f441ec95's row 2 (a respelling such as `…/desktop/` escapes the warning): the same defect as
   table 3013's M12, which holds it.
 * ⚠️ The notes' "file 3" (`clean-base-names-the-shared-folder-however-it-is-reached.test.mjs`)
   was not kept; M13 and M14 are killed by `clean-base-names-the-shared-folder-before-anything-
   else.test.mjs`, which pins the guard's text, its depth, and its place before the anchor.
"""

FOLDER = "apps/desktop/src/main/data-folder.ts"
INDEX = "apps/desktop/src/main/index.ts"
WINDOWS = "scripts/windows-packaged-check.mjs"
CLEAN = "scripts/clean-base.mjs"

PINNED = "the-data-folder-is-pinned-before-anything-reads-it.test.ts"
CHECK = "the-windows-check-fails-a-build-that-made-no-database-where-every-build-kept-it.test.mjs"
SHARED = "clean-base-names-the-shared-folder-before-anything-else.test.mjs"
CENSUS = "clean-base-without-running-it.test.mjs"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 every launch with its own `--user-data-dir` — every test and smoke — makes the "
        f"shared real folder · killed by `{PINNED}`",
        [(FOLDER,
          "  if (app.commandLine.hasSwitch('user-data-dir')) return\n",
          "  mkdirSync(defaultDataFolder(app.getPath('appData')), { recursive: true })\n"
          "  if (app.commandLine.hasSwitch('user-data-dir')) return\n")],
    ),
    (
        "M2 · 🔴 `setPath` runs before the folder exists, and Electron throws on a first launch · "
        f"killed by `{PINNED}`",
        [(FOLDER,
          "  const folder = defaultDataFolder(app.getPath('appData'))\n",
          "  const folder = defaultDataFolder(app.getPath('appData'))\n  app.setPath('userData', folder)\n"),
         (FOLDER,
          "  app.setPath('userData', folder)\n}\n",
          "}\n")],
    ),
    (
        "M3 · 🔴 a module-scope read of `userData` runs before the pin · killed by "
        f"`{PINNED}`",
        [(INDEX,
          "pinTheDataFolder(app)\n",
          "void app.getPath('userData')\npinTheDataFolder(app)\n")],
    ),
    (
        "M4 · the Windows check launches on a runner that already holds a BroBot or BroBot2 folder, "
        f"and then blames the app for it · killed by `{CHECK}`",
        [(WINDOWS,
          "  if (existsSync(folder) || named.some((one) => existsSync(one))) {\n",
          "  if (existsSync(folder)) {\n")],
    ),
    (
        "M5 · 🔴 a build that moved the data to `%APPDATA%\\BroBot` passes · killed by "
        f"`{CHECK}`",
        [(WINDOWS,
          "  const strays = named.filter((one) => existsSync(one))\n",
          "  const strays = named.filter(() => false)\n")],
    ),
    (
        "M6 · a folder that cannot be made leaves `userData` unpinned, so Electron derives it from "
        f"the app's name · killed by `{PINNED}`",
        [(FOLDER,
          "    // Reported where the folder is first used.\n",
          "    return\n")],
    ),
    (
        "M7 · `index.ts`'s bare call never names the app to Windows — the platform defaults to "
        f"`darwin`, not the process's · killed by `{PINNED}`",
        [(FOLDER,
          "  platform: NodeJS.Platform = process.platform,\n",
          "  platform: NodeJS.Platform = 'darwin',\n")],
    ),
    (
        "M8 · Linux and every other system are given the Windows app id · killed by "
        f"`{PINNED}`",
        [(FOLDER,
          "  if (platform === 'win32') app.setAppUserModelId(APP_ID)\n",
          "  if (platform !== 'darwin') app.setAppUserModelId(APP_ID)\n")],
    ),
    (
        "M9 · 🔴 an app that ran the whole wait and made no database is a warning, and the build "
        f"passes · killed by `{CHECK}`",
        [(WINDOWS,
          "  else fail(`the app ran ${DATA_WAIT_MS / 1000} s and made no database in ${folder}`)\n",
          "  else warn(`not measured: the app made no database in ${DATA_WAIT_MS / 1000} s (${folder})`)\n")],
    ),
    (
        "M10 · the check kills a pid that already ended, which may now be another process's · "
        f"killed by `{CHECK}`",
        [(WINDOWS,
          "  if (!ended && app.pid !== undefined) spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'])\n",
          "  if (app.pid !== undefined) spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'])\n")],
    ),
    (
        "M11 · the folder is pinned under the home folder, not `appData` · killed by "
        f"`{PINNED}`",
        [(FOLDER,
          "  const folder = defaultDataFolder(app.getPath('appData'))\n",
          "  const folder = defaultDataFolder(app.getPath('home' as 'appData'))\n")],
    ),
    (
        "M12 · 🔴 the check launches the app on a self-hosted runner, which can be a person's "
        f"machine · killed by `{CHECK}`",
        [(WINDOWS,
          "    process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted'\n",
          "    process.env.GITHUB_ACTIONS === 'true'\n")],
    ),
    (
        "M13 · 🔴 `--dir` naming the shared folder gets no warning — it hangs on no `--dir` being "
        f"given (f441ec95's own condition before review) · killed by `{SHARED}` and `{CENSUS}`",
        [(CLEAN,
          "  if (shared !== null) {\n",
          "  if (parsed.dir === null) {\n")],
    ),
    (
        "M14 · 🔴 a run on an absent shared folder — the dry run the gate-only test uses — stops "
        f"before it says whose data it is · killed by `{SHARED}`",
        [(CLEAN,
          "  // ⚠️ **The shared folder is said for what it is, at the head of the report** (W4.90): a development\n",
          "  if (trustedAnchor(target, { repoRoot: REPO_ROOT }).kind === 'absent') return console.log(out.join('\\n'))\n"
          "  // ⚠️ **The shared folder is said for what it is, at the head of the report** (W4.90): a development\n")],
    ),
]
