"""740 · *Always* kept where the CLI keeps it.

⚑ **Ordered by** the PM, the closing wave: runtime-dev's own `736` F-4, F-5, F-6, F-8 and F-9, under
R99 — *"Where the CLI and BroBot differ, BroBot does what the interactive CLI does."*

## 🔴 A · F-6 — a failed keep is said as a failed keep — M1–M3

M1 the failed keep refused `not-usable` again; M2 the host words `not-kept` as a request that has
gone; M3 it words it as the empty answer. (`146 M2` already holds the branch's `stillOpen`.)

## 🔴 B · F-8 — a plan the adapter settles with no card is written down — M4–M6

M4 the next event does not write it; M5 a person's plan request still pending is written back out;
M6 a failed plan write reported from inside an event's window (`320` §4.1's disorder).

⚠️ **No row seeds the ledger's plan phase wrongly** (`740`'s review): the store refuses a release on
a row that never planned (`writePlanEnded` is `WHERE plan_mode = 1`), and the first event corrects
the seed, so such a mutant is equivalent — measured by the review, not written as a row that could
only survive.

## 🔴 C · F-9 and F-4 on Claude — the interactive CLI's own choice, kept where the CLI keeps it — M7–M16

M7 a destination the CLI never offers is offered; M8 an `rm`'s own rule is offered again; M9 a Bash
row carries the CLI's mode; M10 *always* kept in the provider home again; M11 the card says nowhere it
is kept; M12 the project's rules not read at the next launch; M13 only `allow` read, so a person's
`deny` there is dropped; M14 a folder inside a repository reads its own folder, not the repository's
root; M15 a worktree reads its own folder, not its main repository's; M16 a repository rooted at the
home folder is taken as the project. (*Always* not held for the running session is `736 M6`,
re-anchored.)

## 🔴 D · what `740`'s own review found — M17–M25

M17 a folder's own local settings not read where the project is its repository's root; M18 a worktree
moved without repair read as its main repository; M19 a file the repository carries gives its
`allow`; M20 …one reached through a symbolic link; M21 …one git tracks; M22 a rule change that is not
an allow kept in a grant; M23 a kept whole-tool grant not disclosed; M24 a plan a grant ended not
written at its door; M25 an `rm`'s folder grant said as coverage.

⚠️ **No row for the ownership check** (`ownedByThisUser`): a root another user owns cannot be made in
a test that runs as one user. Named here rather than written as a row that could only survive.
"""

CODEX = "packages/runtime/src/codex/codex-runtime.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
KEPT_RULES = "packages/runtime/src/claude/persisted-rules.ts"

CODEX_TESTS = "codex-runtime.test.ts"
KEEP = "a-failed-keep-is-said-as-one.test.ts"
PLAN = "plan-floor-durable.test.ts"
OFFER = "apps/desktop/src/renderer/src/lib/permission-offer.ts"
GRANT_WORDS = "what-a-grant-covers.render.test.ts"
CLAUDE_TESTS = "claude-runtime.test.ts"
STORES = "the-same-choices-the-cli-offers.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · F-6 ──────────────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **a failed keep is refused `not-usable` again** — the refusal the host words as the "
        f"sentence about a question left blank — killed by `{CODEX_TESTS}`, and killed by `{KEEP}` (740)",
        [
            (
                CODEX,
                "        throw new AnswerRefused(\n          'not-kept',\n",
                "        throw new AnswerRefused(\n          'not-usable',\n",
            )
        ],
    ),
    (
        "M2 · 🔴 **the host words `not-kept` as a request that has GONE** — out of the live branch, so "
        f"it falls through to *\"not one of the responses this request offers\"*, closed — killed by `{KEEP}` (740)",
        [
            (
                HOST,
                "    if (refusal === 'not-usable' || refusal === 'not-kept') {\n",
                "    if (refusal === 'not-usable') {\n",
            )
        ],
    ),
    (
        "M3 · 🔴 **a failed keep is said as the EMPTY answer again** — the one live branch, with the "
        f"sentence about a question left blank for both — killed by `{KEEP}` (740)",
        [
            (
                HOST,
                "          refusal === 'not-kept'\n",
                "          refusal !== refusal\n",
            )
        ],
    ),
    # ── B · F-8 ──────────────────────────────────────────────────────────────────────────────────
    (
        "M4 · 🔴 **the plan the model starts is not written down** — the next event no longer records a "
        f"plan the adapter settled with no card, so a reopen comes back not planning — killed by `{PLAN}` (740)",
        [
            (
                HOST,
                "    this.recordPlanPhase(session, false)\n\n",
                "\n",
            )
        ],
    ),
    (
        "M5 · 🔴 **a plan a person asked for, still pending, is written back OUT** — the compare runs "
        f"over a request the provider has not taken yet — killed by `{PLAN}` (740)",
        [(HOST, "    if (effective !== requested) return\n", "")],
    ),
    (
        "M6 · ⚠️ **a failed plan write is reported from INSIDE an event's window** — the notice takes "
        f"ordinal N+1 while event N is unsent (`320` §4.1's disorder) — killed by `{PLAN}` (740)",
        [(HOST, "    this.recordPlanPhase(session, false)\n", "    this.recordPlanPhase(session, true)\n")],
    ),
    # ── C · F-9 and F-4 on Claude ──────────────────────────────────────────────────────────────
    (
        "M7 · 🔴 **a destination the interactive CLI never offers is offered** — a `projectSettings` "
        f"suggestion kept as a conversation grant — killed by `{CLAUDE_TESTS}` (740)",
        [
            (
                CLAUDE,
                # ⚑ Re-anchored at `740`'s review: the filter also drops non-allow rule changes now.
                "      OFFERED_DESTINATIONS.has(update.destination) &&\n",
                "      true &&\n",
            )
        ],
    ),
    (
        "M8 · 🔴 **an `rm`'s own rule is offered again** — the SDK's whole set on a Bash ask that named "
        f"a file, and an *always* that keeps it (`736` F-9) — killed by `{CLAUDE_TESTS}` (740)",
        [
            (
                CLAUDE,
                "  const namedAFile = options.blockedPath !== undefined\n",
                "  const namedAFile = false\n",
            )
        ],
    ),
    (
        "M9 · ⚠️ **a Bash row carries the CLI's MODE** — *accept edits* installed by a command's "
        f"conversation grant — killed by `{CLAUDE_TESTS}` (740)",
        [
            (
                CLAUDE,
                "    if (update.type !== 'addRules' || update.behavior !== 'allow') return []\n",
                "    if (update.type !== 'addRules' || update.behavior !== 'allow') return [update]\n",
            )
        ],
    ),
    (
        "M10 · 🔴 **always kept in the PROVIDER HOME again** — `userSettings`, every folder the "
        f"identity works in (`736` F-4) — killed by `{CLAUDE_TESTS}` (740)",
        [
            (
                CLAUDE,
                "    keptByTheCli(update) ? [update, { ...update, destination: 'session' }] : [update],\n",
                "    keptByTheCli(update)\n"
                "      ? [{ ...update, destination: 'userSettings' }, { ...update, destination: 'session' }]\n"
                "      : [update],\n",
            )
        ],
    ),
    (
        "M11 · ⚠️ **the card says nowhere an always is kept** — no `alwaysFile` — killed by "
        f"`{CLAUDE_TESTS}` (740)",
        [
            (
                CLAUDE,
                # ⚑ **the independent location module · re-anchored in place, not retired** — the launch finds its local settings files once, the first being where an always is kept; the plant still names no file
                "    this.alwaysRulesFile = files[0] ?? null\n",
                "    this.alwaysRulesFile = null\n",
            )
        ],
    ),
    (
        "M12 · 🔴 **the project's kept rules are not read at the next launch** — so a rule the CLI "
        f"kept there is asked again — killed by `{STORES}` (740)",
        [
            (
                KEPT_RULES,
                # ⚑ **the independent location module · re-anchored in place, not retired** — the launch's rules are read from the files it found, without blocking; the plant still reads no project's rules
                "    ...(localFiles === null ? [] : [await projectRulesFor(localFiles, signal)]),\n",
                "    ...[],\n",
            )
        ],
    ),
    (
        "M13 · 🔴 **only `allow` is read** — a person's `deny` in the same file dropped, so BroBot runs "
        f"what their own CLI refuses — killed by `{STORES}` (740)",
        [
            (
                KEPT_RULES,
                "    return { allow: list('allow'), deny: list('deny'), ask: list('ask') }\n",
                "    return { allow: list('allow'), deny: [], ask: [] }\n",
            )
        ],
    ),
    (
        "M14 · ⚠️ **a folder inside a repository reads its own folder** — not the repository's root, "
        f"where the CLI keeps the rule — killed by `{STORES}` (740)",
        [
            (
                "packages/runtime/src/claude/local-settings-location.ts",
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. held: running it needs W4's written lift. 56e4cb6b2 moved project routing into the independent location module. Return the starting folder rather than the repository root; candidate killer is local-settings-location.test.ts, not executed.
                "  return checkout\n",
                "  return startingFolder\n",
            )
        ],
    ),
    (
        "M15 · ⚠️ **a worktree reads its own folder** — not its main repository's, the CLI's canonical "
        f"root — killed by `{STORES}` (740)",
        [
            (
                "packages/runtime/src/claude/local-settings-location.ts",
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. held: running it needs W4's written lift. 56e4cb6b2 moved routing to Git's worktree list. Select the containing linked checkout rather than the main one, retaining main-root routing for ordinary repository subfolders; candidate killer is local-settings-location.test.ts.
                "    checkout = first.slice('worktree '.length)\n",
                "    checkout =\n      records\n        .filter((record) => record.startsWith('worktree '))\n        .map((record) => record.slice('worktree '.length))\n        .filter((folder) => startingFolder === folder || startingFolder.startsWith(`${folder}/`))\n        .sort((left, right) => right.length - left.length)[0] ?? first.slice('worktree '.length)\n",
            )
        ],
    ),
    (
        "M16 · ⚠️ **a repository rooted at the HOME folder is taken as the project** — the CLI keeps "
        f"the rule in the folder there — killed by `{STORES}` (740)",
        # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. held: running it needs W4's written lift. 56e4cb6b2 moved the same home-root exception to settingsFolder. Omit only that exception; candidate killer is local-settings-location.test.ts.
        [("packages/runtime/src/claude/local-settings-location.ts", "  if (canonicalFolder(checkout) === canonicalFolder(homedir())) return startingFolder\n", "")],
    ),
    # ── D · what 740's own review found ─────────────────────────────────────────────────────────
    (
        "M17 · 🔴 **a folder's OWN local settings are not read** where the project is its repository's "
        f"root — a `deny` kept there is dropped — killed by `{STORES}` (740)",
        [
            (
                "packages/runtime/src/claude/local-settings-location.ts",
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. held: running it needs W4's written lift. 56e4cb6b2 moved file precedence into localSettingsFilesOf. Keep the routed file but omit the starting folder's own local-settings file; candidate killer is local-settings-location.test.ts.
                "      projectLocalSettingsFile(cwd),\n      join(resolve(cwd), '.claude', 'settings.local.json'),\n",
                "      projectLocalSettingsFile(cwd),\n",
            )
        ],
    ),
    # RETIREMENT APPROVED — 740 M18: anchor-absent; removed by 56e4cb6b2. The backlink test and helper
    # were removed. Independent local-settings-location.ts deliberately routes a manually moved worktree
    # through Git to the main checkout without repairing the stale entry; local-settings-location.test.ts
    # explicitly asserts [main,moved]. This is the opposite of the old moved-worktree-is-own-project rule,
    # so it cannot be re-anchored with equivalent meaning. Definition retained as historical evidence; no
    # row execution.
    (
        "M18 · ⚠️ **a worktree moved without repair is read as its main repository** — the CLI's "
        f"backlink check gone — killed by `{STORES}` (740)",
        [
            (
                KEPT_RULES,
                "    if (realOrResolved(resolve(gitDir, back)) !== join(realOrResolved(gitRoot), '.git'))\n"
                "      return gitRoot\n",
                "",
            )
        ],
    ),
    (
        "M19 · 🔴 **a local-settings file the REPOSITORY carries gives its `allow`** — a cloned "
        f"repository grants itself `curl` — killed by `{STORES}` (740)",
        [
            (
                KEPT_RULES,
                # ⚑ **the independent location module · re-anchored in place, not retired** — the repository gate asks git without blocking; the plant still gives a carried file's allow
                "    allow: allow.length > 0 && (await anyCarried(folders, signal)) ? [] : allow,\n",
                "    allow,\n",
            )
        ],
    ),
    (
        "M20 · ⚠️ **…one reached through a SYMBOLIC LINK** gives its `allow` — killed by "
        f"`{STORES}` (740)",
        [(KEPT_RULES, "      if (lstatSync(one).isSymbolicLink()) return true\n", "")],
    ),
    (
        "M21 · ⚠️ **…one GIT TRACKS** gives its `allow` — `ls-files` read backwards — killed by "
        f"`{STORES}` (740)",
        [(KEPT_RULES, "  if (git.status === 0) return true\n", "  if (git.status === 0) return false\n")],
    ),
    (
        "M22 · ⚠️ **a rule change that is not an ALLOW is kept in a grant** — a `deny` installed by "
        f"*Allow for this conversation* — killed by `{CLAUDE_TESTS}` (740)",
        [
            (
                CLAUDE,
                # ⚑ **a shell card that hides nothing · re-anchored in place, not retired** — the filter is one step deeper, after the folders the conversation already works in are taken out
                "            update.type === 'removeRules') &&\n          update.behavior !== 'allow'\n",
                "            update.type === 'removeRules') &&\n          false\n",
            )
        ],
    ),
    (
        "M23 · ⚠️ **a kept whole-tool grant is not disclosed** — *always* on an MCP tool missing from "
        f"the header's list — killed by `{CLAUDE_TESTS}` (740)",
        [
            (
                CLAUDE,
                "        // grant for this conversation, and is disclosed as one, as the conversation button's is.\n"
                "        for (const kept of wholeToolsOf(updates)) this.sessionGrants.grantAll(kept)\n",
                "        // grant for this conversation, and is disclosed as one, as the conversation button's is.\n",
            )
        ],
    ),
    (
        "M24 · 🔴 **a plan a grant ENDED is not written at its door** — the *accept edits* grant leaves "
        f"the ledger planning — killed by `{PLAN}` (740)",
        [
            (
                HOST,
                "    // and the ledger is told before the door returns — {@link recordPlanPhase}.\n"
                "    this.recordPlanPhase(session)\n",
                "    // and the ledger is told before the door returns — {@link recordPlanPhase}.\n",
            )
        ],
    ),
    (
        "M25 · ⚠️ **an `rm`'s folder grant is said as COVERAGE** — *\"working in <folder>\"* over a "
        f"grant that asks the same `rm` again — killed by `{GRANT_WORDS}` (740)",
        [(OFFER, "      return sameFolder(rule.path, cwd)\n", "      return false\n")],
    ),
]
