"""331 · The version chip that names no version — each row is THE DEFECT, put back verbatim (131).

⛔ **What 331 fixed, in one sentence.** The titlebar chip read `v0.0.0 · schema 16` — `v0.0.0` being
`package.json`'s version, unchanged since the first commit — so the one thing in the running app that
looked like build identity was the one field guaranteed never to be it, and the person, an hour after
`330` merged, had to ask: *"is the latest version running for me? because if so then it's not
working"*. Nothing in the app named the commit it was built from; adjudicating that took me grepping
a string out of the shipped bundle.

## ⚑ The shape of the fix, because it decides what a row can be

The commit is read ONCE, at BUILD time, in `electron.vite.config.ts`, and baked into the main bundle
as three `define`s. ⛔ **Never at runtime**: a packaged app has no repository, and on a developer's
machine a runtime read would name whatever is checked out rather than what is running — the
confident wrong answer this dispatch exists to end. ⚠️ And it lands in `out/`, which is git-ignored:
a stamp written into a tracked file would change that file on every build, and `mutations:check`
hashes censused files while `format:check` reads the whole tree.

| the answer | when |
|---|---|
| `e76e7c6` | a production build of a clean tree |
| `e76e7c6` + `uncommitted` in amber | a production build with modified tracked files |
| `dev` | ⛔ `electron-vite dev` — rebuilt on save, so no commit describes it |
| `unknown` | ⛔ nothing could tell us — a WORD, never `''` and never a crash |

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M14` | ⚑ **`run_suite`** — `apps/desktop/test/build-identity.test.ts` |
| `M15`-`M19` | ⚑ **`run_suite`** — the same file's config and build-guard describes |
| `M20`-`M21` | ⚑ **`run_suite`** — `packages/shared/test/contracts.test.ts` |
| `M22`-`M26` | ⚑ **`run_suite`** — `build-identity.test.ts`'s source pins on `index.ts` / `RuntimeScreen.vue` |

## ⚠️ What this table deliberately does NOT contain

⛔ **No row asserts a dev window shows a sha.** `M2` and `M3` are the two ways that defect gets back
in — the early return deleted, and the git read happening anyway — and there is no row anywhere
claiming the opposite.

⛔ **No row is about the RENDERED chip in a browser** — and ⚠️ **that reason expired at `389`.** It
was *"nothing in this repository mounts `RuntimeScreen` (`211` §11, `212` §9, `214` §8)"*, which was
true while the chip lived inside the whole app; `389 §2` moved it into `AppTitleBar.vue`, which
`dom/one-bar-one-shelf.dom.test.ts` DOES mount. So `M23`-`M26` still kill through source pins, but
the rendered chip is now reachable and a row aimed at it would no longer be aimed at nothing. The
three states quoted in `331`'s response were measured against the running app, out of
`[data-cy=build-line]`'s own `innerText`, and that is still the only reading of what it SAYS.

⛔ **No row makes `readAppInfo` itself fail.** It boots Electron on import and no test calls it;
`M22` is the wire between producer and payload and it is killed by a source pin, which is the honest
instrument for it rather than a test that could not exist.
"""

STAMP = "apps/desktop/src/main/build-stamp.ts"
IDENT = "apps/desktop/src/main/build-identity.ts"
CONF = "apps/desktop/electron.vite.config.ts"
CONTRACTS = "packages/shared/src/contracts.ts"
MAIN = "apps/desktop/src/main/index.ts"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
# ⚠️ **`389 §2` moved the title bar — chip and all — out of `RuntimeScreen.vue` into its own
# component**, so a DOM test could mount the bar the product actually draws. Six of this table's
# anchors moved with it (`M1`, `M23`-`M26`, `M29`). ⛔ **Correcting an anchor is free and it does NOT
# carry the verdict the row earned**: each of these was measured RED against the old address, and
# nothing has re-measured them at the new one. They are corrected rather than retired because the
# defect each describes is unchanged — the same edit, on the same lines, one file over — but the
# table's own attestation is now older than the code it points at, and that is worth knowing before
# anyone reads a green census as a re-run.
BAR = "apps/desktop/src/renderer/src/components/AppTitleBar.vue"

MUTATIONS = [
    # ── the defect itself ─────────────────────────────────────────────────────────────────────
    (
        "M1 · ⛔ THE DEFECT, verbatim · the chip shows the app version again, so the only thing on "
        "screen that looks like build identity is the one field that never changes",
        [
            (
                BAR,
                "  return `${read.build.id}${uncommitted} · schema ${read.db.migrationsApplied}${branchWords.value}`",
                "  return `v${read.version} · schema ${read.db.migrationsApplied}${branchWords.value}`",
            )
        ],
    ),
    # ── dev must never name a commit ──────────────────────────────────────────────────────────
    (
        "M2 · ⛔ a dev window names a sha · `electron-vite dev` rebuilds on save, so the number is "
        "stale the moment the person edits — and a stale sha invites exactly the wrong conclusion",
        [
            (
                STAMP,
                "  if (command === 'serve') return { id: 'dev', commit: '', dirty: false }\n",
                "",
            )
        ],
    ),
    (
        "M3 · ⛔ dev asks git anyway and throws the answer away · looks identical on screen and is "
        "one refactor away from leaking the stale value back out",
        [
            (
                STAMP,
                "  if (command === 'serve') return { id: 'dev', commit: '', dirty: false }\n"
                "  const facts = read()",
                "  const facts = read()\n"
                "  if (command === 'serve') return { id: 'dev', commit: '', dirty: false }",
            )
        ],
    ),
    # ── three answers, never two (326's lesson in a second instrument) ─────────────────────────
    (
        "M4 · ⛔ an empty `git status` is read as a failure · the tree is clean and the build says "
        "`unknown`, so the honest case is the one that loses its name",
        [
            (
                STAMP,
                "    return {\n"
                "      commit,\n"
                "      dirty: git(['status', '--porcelain', '--untracked-files=no']).trim().length > 0,\n"
                "    }",
                "    const changed = git(['status', '--porcelain', '--untracked-files=no']).trim()\n"
                "    if (changed === '') return null\n"
                "    return { commit, dirty: true }",
            )
        ],
    ),
    (
        "M5 · ⛔ a `git status` that THREW is reported as clean · *I could not look* and *nothing "
        "changed* become one value — 326's finding, in git instead of lsof",
        [
            (
                STAMP,
                "    return {\n"
                "      commit,\n"
                "      dirty: git(['status', '--porcelain', '--untracked-files=no']).trim().length > 0,\n"
                "    }",
                "    let dirty = false\n"
                "    try {\n"
                "      dirty = git(['status', '--porcelain', '--untracked-files=no']).trim().length > 0\n"
                "    } catch {\n"
                "      dirty = false\n"
                "    }\n"
                "    return { commit, dirty }",
            )
        ],
    ),
    (
        "M6 · ⛔ whatever `rev-parse` printed is taken as a commit · a warning or an empty repo's "
        "answer goes on the chip looking like an identity",
        [(STAMP, "    if (!/^[0-9a-f]{40}$/.test(commit)) return null\n", "")],
    ),
    (
        "M7 · ⛔ the sha test stops caring about case · `E76E7C6…` is not what any git command will "
        "echo back, so the chip and every message quoting it drift apart",
        [
            (
                STAMP,
                "    if (!/^[0-9a-f]{40}$/.test(commit)) return null",
                "    if (!/^[0-9a-f]{40}$/i.test(commit)) return null",
            )
        ],
    ),
    (
        "M8 · ⛔ *I do not know* becomes an empty string · an empty chip reads as a rendering bug "
        "rather than as an answer, which is the failure 183's rule is about",
        [
            (
                STAMP,
                "  if (facts === null) return { id: 'unknown', commit: '', dirty: false }",
                "  if (facts === null) return { id: '', commit: '', dirty: false }",
            )
        ],
    ),
    (
        "M9 · ⛔ the dirtiness is smuggled into the sha · two representations of one fact, and the "
        "renderer is then free to re-derive the wrong one out of the text",
        [
            (
                STAMP,
                "  return { id: facts.commit.slice(0, SHORT_SHA), commit: facts.commit, dirty: facts.dirty }",
                "  const short = facts.commit.slice(0, SHORT_SHA)\n"
                "  return {\n"
                "    id: facts.dirty ? `${short}-dirty` : short,\n"
                "    commit: facts.commit,\n"
                "    dirty: facts.dirty,\n"
                "  }",
            )
        ],
    ),
    (
        "M10 · ⛔ untracked files count as dirty · `out/`, scratch and editor droppings are "
        "permanently present, so every build is marked and the mark stops meaning anything",
        [
            (
                STAMP,
                "      dirty: git(['status', '--porcelain', '--untracked-files=no']).trim().length > 0,",
                "      dirty: git(['status', '--porcelain']).trim().length > 0,",
            )
        ],
    ),
    # ── the runtime read may never throw ──────────────────────────────────────────────────────
    (
        "M11 · ⛔ the unstamped bundle throws instead of degrading · a ReferenceError inside "
        "`readAppInfo` takes the schema count off the chip beside it (039)",
        [
            (
                IDENT,
                "  const id = typeof __BUILD_ID__ === 'string' && __BUILD_ID__.length > 0 ? __BUILD_ID__ : NO_STAMP",
                "  const id = __BUILD_ID__ ?? NO_STAMP",
            )
        ],
    ),
    (
        "M12 · ⛔ an empty stamp is accepted as a name · the chip renders nothing where the build "
        "goes, which reads as a broken window rather than as a build nobody recorded",
        [
            (
                IDENT,
                "typeof __BUILD_ID__ === 'string' && __BUILD_ID__.length > 0 ? __BUILD_ID__ : NO_STAMP",
                "typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : NO_STAMP",
            )
        ],
    ),
    (
        "M13 · ⛔ the full commit is read independently of the short one · the chip and its tooltip "
        "are then free to describe different builds",
        [
            (
                IDENT,
                "    commit: id === NO_STAMP || typeof __BUILD_COMMIT__ !== 'string' ? '' : __BUILD_COMMIT__,",
                "    commit: typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : '',",
            )
        ],
    ),
    (
        "M14 · ⛔ an unstamped build defaults to DIRTY · every build nobody could describe is "
        "accused of carrying uncommitted work, so the amber warning stops being information",
        [
            (
                IDENT,
                "    dirty: typeof __BUILD_DIRTY__ === 'boolean' ? __BUILD_DIRTY__ : false,",
                "    dirty: typeof __BUILD_DIRTY__ === 'boolean' ? __BUILD_DIRTY__ : true,",
            )
        ],
    ),
    # ── the wiring, and the guard that stops it failing silently ──────────────────────────────
    (
        "M15 · ⛔ the stamp never reaches the main bundle · `buildIdentity()` falls back to "
        "`unknown` for every build, and nothing anywhere says why",
        [
            (
                CONF,
                "    main: {\n      define,\n",
                "    main: {\n",
            )
        ],
    ),
    (
        "M16 · ⛔ one of the three defines is misspelled · the id survives and the full sha in the "
        "tooltip quietly becomes empty, which is the half-failure hardest to notice",
        [
            (
                CONF,
                "    __BUILD_COMMIT__: JSON.stringify(build.commit),",
                "    __BUILD_COMMITT__: JSON.stringify(build.commit),",
            )
        ],
    ),
    (
        "M17 · ⛔ the build no longer checks that the stamp landed · the one guard against the "
        "silent failure is removed and everything stays green",
        [
            (
                CONF,
                "        copyMigrations(),\n        stampReachedTheBundle(build.id),",
                "        copyMigrations(),",
            )
        ],
    ),
    (
        "M18 · ⛔ the guard passes whatever it is given · it runs, it is in the plugin list, and it "
        "has no opinion — the shape 260 calls a row that cannot fail",
        [
            (
                CONF,
                "      if (!stamped) {",
                "      if (false && !stamped) {",
            )
        ],
    ),
    (
        "M19 · ⛔ the guard accepts a stamp found in an ASSET · a literal in a copied migration "
        "would satisfy it while the code that runs has none",
        [
            (
                CONF,
                "        (chunk) => chunk.type === 'chunk' && (chunk.code ?? '').includes(JSON.stringify(id)),",
                "        (chunk) => (chunk.code ?? '').includes(JSON.stringify(id)),",
            )
        ],
    ),
    # ── the contract ──────────────────────────────────────────────────────────────────────────
    (
        "M20 · ⛔ the build becomes optional in `AppInfo` · a payload without one parses, and the "
        "renderer reads `undefined.id` behind the same `v-if` as the schema count · killed by `contracts.test.ts` (named by W4.78)",
        [
            (
                CONTRACTS,
                # ⚑ **W4.78 · re-anchored in place, not retired** — 40826342 (F077) added a `branches` field inside build's object, so its closing `}),` moved below it; making that closing `.optional()` is the same defect
                "      .nullable(),\n  }),\n  db: z.object({\n",
                "      .nullable(),\n  }).optional(),\n  db: z.object({\n",
            )
        ],
    ),
    (
        "M21 · ⛔ the commit must be non-empty · every dev build and every unstamped build then "
        "fails to parse `app:info` at startup, which is the honest cases refusing to boot",
        [
            (
                CONTRACTS,
                "    commit: z.string(),\n    dirty: z.boolean(),",
                "    commit: z.string().min(1),\n    dirty: z.boolean(),",
            )
        ],
    ),
    # ── the wire, and the chip ────────────────────────────────────────────────────────────────
    (
        "M22 · ⛔ the producer stops sending the build · `appInfoSchema.parse` throws inside "
        "`readAppInfo`, so the chip is an error message at the moment somebody needs the sha",
        [
            (
                MAIN,
                "    build: { ...buildIdentity(), branches: buildBranches() },\n",
                "",
            )
        ],
    ),
    (
        "M23 · ⛔ the word goes and only the colour is left · a screenshot in greyscale, or a reader "
        "who cannot separate amber from grey, sees a plain sha and believes it",
        [
            (
                BAR,
                "  const uncommitted = read.build.dirty ? ' · uncommitted' : ''",
                "  const uncommitted = ''",
            )
        ],
    ),
    (
        "M24 · ⛔ the colour goes · the word survives, so the chip is still true, but the state that "
        "should stop you trusting the sha no longer catches the eye",
        [
            (
                BAR,
                "        :class=\"{ 'build-dirty': props.info.build.dirty || branchWords !== '' }\"\n",
                "",
            )
        ],
    ),
    (
        "M25 · ⛔ the sha stops being selectable · the titlebar is `user-select: none`, so the one "
        "string a person is meant to paste into a message cannot be dragged over",
        [
            (
                BAR,
                "  user-select: text;\n  white-space: nowrap;\n}\n\n.sync-detail.danger {",
                "  white-space: nowrap;\n}\n\n.sync-detail.danger {",
            )
        ],
    ),
    (
        "M26 · ⛔ `data-cy=app-info` moves onto the inner span · the brief's own trap — "
        "`packaged-smoke` and `ui-live-smoke` both address that element and would go quiet",
        [
            (
                BAR,
                '    <div class="sync-state" data-cy="app-info">',
                '    <div class="sync-state">',
            )
        ],
    ),
    # ── the two joins nothing but a test can hold ─────────────────────────────────────────────
    (
        "M27 · ⛔ the producer's word drifts from the one the renderer branches on · the config's "
        "loader cannot resolve `@brobot2/shared`, so these two literals live in two packages and a "
        "rename in either fails nothing — the chip renders and the hover explains the wrong build",
        [(STAMP, "  if (command === 'serve') return { id: 'dev'", "  if (command === 'serve') return { id: 'development'")],
    ),
    (
        "M28 · ⛔ the git bound becomes one a busy machine can cross · a clean build then reports "
        "`unknown` because the host was loaded — this dispatch's own defect, via its own instrument "
        "(326 measured one `lsof` on this machine at 21 s)",
        [(STAMP, "const GIT_TIMEOUT_MS = 30_000", "const GIT_TIMEOUT_MS = 1")],
    ),
    (
        "M29 · ⛔ the RENDERER's word drifts too · the third spelling of `dev`, kept a literal "
        "because a value import from `@brobot2/shared` costs the renderer bundle 135 kB — so the "
        "tooltip explains a dev window as a build that recorded no commit",
        [(BAR, "  if (read.build.id === 'dev') {", "  if (read.build.id === 'development') {")],
    ),
]
