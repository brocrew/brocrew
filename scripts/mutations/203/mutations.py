#!/usr/bin/env python3
"""203's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **Twenty-nine of these rows are 195 H1-H4 as they really shipped until this commit**: a control
verb that took a session id and no caller, so any window with an id could drive any conversation
(`M1`-`M12`); an application menu this app never authored, whose View → Reload ends every
conversation in the window (`M13`-`M17`); a rail with no live attention count and one word for two
different asks (`M18`-`M22`); and a launch that provisioned a credential-bearing home and then
refused the folder (`M23`-`M29`).

⛔ **Four rows are inherited, and the census is why.** `pnpm run mutations:check` reported `149 M14`,
`150 M25`, `150 M26` and `169 M4` stale the moment this landed: their anchors are lines 203 replaced
— three of them because `this.require(sessionId)` gained a caller, one because `launchBlocked` grew
a folder clause — so four rows that had been protecting real behaviour were suddenly protecting
nothing. Every one of their defects is still a defect, so each is carried forward here on the new
anchor: `M30` (ordinary `send` stops asking), `M31` (the interrupt breadcrumb is gone entirely),
`M32` (…and written above the sign-in gate again), `M33` (the launcher stops blocking on an unnamed
profile). ⚠️ **A stale row is not a row that failed; it is a row that stopped being asked.**

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. These were taken after `format` ran.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

  * **A real second window.** Every H1 row drives `executeRuntimeCommand` with two `RecordingSink`s
    in one process. Nothing here can say that a real Electron `WebContents` id is stable across a
    reload, or that two real windows get different ones — `sinkOwnerId` is `webContents:<id>` and
    `index.ts` is the only thing that calls it. ⚑ The live smoke's step `38b` is the nearest
    instrument, and it is about the single-instance lock rather than about ownership.
  * **The menu, as a menu.** `M13`-`M16` mutate a TEMPLATE and `M17` mutates the line that installs
    it. What no row can do is press ⌘R: the accelerator belongs to a native menu, CDP cannot reach
    it, and `Menu` is only real inside a running Electron main process. ⚑ **`M17` is nonetheless
    the first mutation in this repository that reaches `index.ts`** — because the assertion it kills
    reads that file as TEXT rather than importing it, which is the way past the hole 202 recorded
    (*"`index.ts` is loaded by nothing in the gate"*). It is a narrow way past: it proves the call is
    written, never that Electron ran it.
  * **DevTools' own reload.** The template withholds the DevTools ITEM from a packaged build; a
    developer build keeps it, and its ⌘R drives the inspected page's `webContents.reload()` from a
    different WebContents. No row can remove that and none pretends to.
  * **What a person sees.** `M18`-`M22` kill assertions about painted boxes and rendered words in a
    real Chromium at 200px — which is why `dom` runs — but nobody in this table looks at the rail.
    The PM measured the app itself; that is what found H3 in the first place.
  * **A folder that vanishes between the check and the press.** `M23` puts the ordering defect back
    and dies on what a refused launch leaves on disk. The renderer's `checkCwd` is advisory by
    construction (TOCTOU), and no row here can produce the race — what the rows can say is that the
    two answers agree over a corpus (`M27`) and that the host refuses before it provisions.
  * **The `runtime` and `scripts` projects.** 203 changes no adapter and no script library, so
    neither runs. The one `ui-live-smoke.mjs` edit is a comment that had gone stale in 094.
  * ⛔ **One guard in this diff cannot be killed at all, and it is named rather than counted.**
    `attachOpenSessions`'s `if (!mayControl(slot, sink)) continue` is a FAST PATH: removing it
    changes nothing observable, because `attachHeldSession` — which the loop then calls for every
    slot — asks the same predicate and returns `null`. The pre-check found that as a GREEN row and
    it was withdrawn rather than kept as a number. What protects the behaviour is `M7`; what the
    line buys is not walking a stranger's sessions, and no test can see that.

⛔ **Do not apply these by hand** — `mutate.sh` owns the tree, takes 196's repository-global lock,
and restores from a pristine copy keyed by FULL relative path.
"""

from __future__ import annotations

import sys

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
MENU = "apps/desktop/src/main/app-menu.ts"
MAIN = "apps/desktop/src/main/index.ts"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
LAUNCHER = "apps/desktop/src/renderer/src/components/NewConversation.vue"
STATE = "apps/desktop/src/renderer/src/lib/agent-state.ts"

MUTATIONS = [
    # ---------------------------------------------------------------- H1 · 195's object-level hole
    (
        "M1 · [anchor corrected in place by 340: the three questions an id is asked moved out of "
        "`require` into `sessionFor`, and the entitlement is now the `gate` parameter — deleting it "
        "still removes the check from every control verb, and now from all THREE entitlements at "
        "once, which is strictly more of the defect this row is about] ⛔ THE DEFECT, verbatim · "
        "`require` takes the caller and does not ask — every control verb is back to a session id "
        "and nothing else",
        [
            (
                HOST,
                "    if (!slot) throw new Error(`unknown session: ${sessionId}`)\n    gate(slot)\n",
                "    if (!slot) throw new Error(`unknown session: ${sessionId}`)\n",
            )
        ],
    ),
    (
        "M2 · the owner check itself passes anything — one predicate, and this is it disarmed",
        [(HOST, "    if (mayControl(slot, by)) return\n", "    if (true as boolean) return\n")],
    ),
    (
        "M3 · ownership is object IDENTITY, not the owner id — so a window that reattached after a "
        "reload becomes a stranger to its own session",
        [
            (
                HOST,
                "  return by === THE_APP_ITSELF || slot.ownerId === by.ownerId\n",
                "  return by === THE_APP_ITSELF || (slot as unknown as Caller) === by\n",
            )
        ],
    ),
    # ⚠️ **RE-ANCHORED at 692, not retired.** 692 gave `close` a no-slot branch (a person's Close of what the quit closed); the anchor is that branch's close and the check after it. The DEFECT this row plants is unchanged.
    (
        "M4 · `close` skips its own check — the one control verb that does not go through `require`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives:
        # `close` must ask `assertMayControl` itself, because it deliberately bypasses `require`.
        # D-017b deleted the quit-marker block (`aQuitLeftItOpen` / `forgetTheQuitOf`) inside the
        # no-slot branch, so the branch is now `if (!slot) return Promise.resolve()` and the plant
        # removes the owner check that follows it.
        [
            (HOST, '    if (!slot) return Promise.resolve()\n    this.assertMayControl(slot, by)\n', '    if (!slot) return Promise.resolve()\n'),
        ],
    ),
    (
        "M5 · …and `close` refuses an UNKNOWN id too, so the Close button stops being safe to press "
        "twice (062's tolerance, lost to the fix)",
            # ⚠️ **RE-ANCHORED at 692, not retired.** 692 gave `close` a no-slot branch; the whole branch is what the row turns into a throw. The DEFECT this row plants is unchanged.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — close()'s no-slot branch
        # is still the tolerant no-op the doc comment above it describes ('Tolerant by design ...
        # Still the tolerant no-op for an id nothing knows'); only the helper name changed from
        # keptOpen(sessionId) !== null to aQuitLeftItOpen(sessionId) (an already-noted re-anchor
        # lineage: mutations.py's own comment says this row was 're-anchored at 692, not retired').
        # The corrected edit plants the same throw-on-unknown-id defect at the current call site.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives:
        # closing an unknown id is a silent no-op so the Close button is safe to press twice (062).
        # D-017b removed the quit-marker code from the no-slot branch, which is now the plain
        # tolerant `return Promise.resolve()` again, and the plant turns that line into a throw on
        # an unknown id.
        [
            (HOST, '    if (!slot) return Promise.resolve()\n    this.assertMayControl(slot, by)\n', '    if (!slot) throw new Error(`unknown session: ${sessionId}`)\n    this.assertMayControl(slot, by)\n'),
        ],
    ),
    (
        "M6 · ⛔ `noteUserCommand` forgets the caller — a stranger forges durable, ordinal-stamped "
        "`user_command` rows into somebody else's ledger (203 §1, this dispatch's own finding)",
        [(HOST, "    if (slot && !mayControl(slot, by)) return\n", "")],
    ),
    (
        "M7 · [anchor corrected in place by 336: the same single gate now asks `mayClaim` for a claim and `mayControl` for an attach. Deleting the line still removes 062's refusal — from BOTH doors, which is strictly more of the defect this row is about] `attachHeldSession` stops asking — 062's *told, not attached* undone by the same "
        "predicate that now guards the verbs",
        [(HOST, "    if (!(how === 'claim' ? mayClaim(slot) : mayControl(slot, sink))) return null\n", "")],
    ),
    (
        "M8 · the owner check runs AFTER the phase check, so a stranger asking about a session that "
        "is still STARTING is told so — a timing oracle over somebody else's conversation",
        [
            (
                HOST,
                # ⚑ Re-anchored by 340: the ordering rule this row inverts now lives in
                # `sessionFor`, where the entitlement is a parameter, so the line it swaps past is
                # `gate(slot)` rather than one gate by name. The rule is unchanged and it now
                # covers all three entitlements instead of one.
                # ⚑ ANCHOR CORRECTED IN PLACE BY 650: the throw is typed now —
                # `SessionStillStarting`, carrying whether the reservation is being closed — and
                # prettier wraps it over four lines. The ordering defect this row inverts is
                # unchanged, and the row was re-verified RED by hand against its killer.
                "    gate(slot)\n"
                "    // A reserved-but-not-yet-registered session is a real state now (062), and saying \"unknown\"\n"
                "    // for it would send whoever reads it looking for a session that had been lost rather than one\n"
                "    // that has not opened yet.\n"
                # ⚠️ **ANCHOR CORRECTED IN PLACE BY 659**: every phase comparison in this file now goes
                # through one predicate, `onItsWayOut`, so the quoted line changed and the SUBJECT did
                # not. The replacement reproduces the same defect in the new spelling; re-verified RED
                # by hand against its killer.
                "    if (slot.session === null)\n"
                "      throw new SessionStillStarting(`session is still starting: ${sessionId}`, onItsWayOut(slot))\n",
                "    if (slot.session === null)\n"
                "      throw new SessionStillStarting(`session is still starting: ${sessionId}`, onItsWayOut(slot))\n"
                "    gate(slot)\n",
            )
        ],
    ),
    (
        "M9 · the refusal is thrown RAW — the diagnostic, with both owner ids in it, reaches the "
        "renderer as the sentence a person reads (100's split, inverted)",
        [
            (
                HOST,
                # ⚑ Re-anchored by 340: `assertMayAnswer` throws in exactly this shape, so the
                # two-line form matched twice and stopped identifying a row. The gate line above it
                # is what tells the two apart; the mutation itself is unchanged.
                "    if (mayControl(slot, by)) return\n    throw this.refusalTranslated(\n      new SessionUnavailable(",
                "    if (mayControl(slot, by)) return\n    throw (\n      new SessionUnavailable(",
            ),
            (HOST, "      ),\n      'act on a session',\n    )\n  }", "      )\n    )\n  }"),
        ],
    ),
    (
        "M10 · the IPC door stops naming the caller on `send` — the shape of the whole defect, one "
        "verb at a time",
        [
            (
                IPC,
                "      return await host.send(command.sessionId, command.text, sink)",
                "      return await host.send(command.sessionId, command.text)",
            )
        ],
    ),
    (
        "M11 · …nor on the permission answer, which is the verb 195 opens with",
        [(IPC, "        command.decision,\n        sink,\n", "        command.decision,\n")],
    ),
    (
        "M12 · …nor on the approval mode, so a stranger can turn a conversation to auto-approve",
        [(IPC, "command.mode, sink)", "command.mode)")],
    ),
    # ------------------------------------------------------------------- H2 · the menu nobody wrote
    (
        "M13 · ⛔ THE DEFECT, verbatim · View → Reload is back — one keystroke, every conversation "
        "in the window",
        [(MENU, "        { role: 'togglefullscreen' },", "        { role: 'togglefullscreen' },\n        { role: 'reload' },")],
    ),
    (
        "M14 · …and Force Reload with it",
        [(MENU, "        { role: 'zoomOut' },", "        { role: 'zoomOut' },\n        { role: 'forceReload' },")],
    ),
    (
        "M15 · DevTools is offered in a PACKAGED build too, so a shipped app has a route to the "
        "one reload no template can remove",
        [(MENU, "  const { appName, devTools } = options", "  const { appName } = options\n  const devTools = true")],
    ),
    (
        "M16 · the menu loses Copy — the cheapest way to pass *no reload* is to ship no menu",
        [(MENU, "        { role: 'copy' },\n", "")],
    ),
    (
        "M17 · ⛔ nothing installs it — the template is written and Electron never sees it, so the "
        "default menu (and its Reload) is back · killed by `app-menu.test.ts` (named by W4.91)",
        [
            (
                MAIN,
                # ⚑ **W4.91 · re-anchored in place, not retired** — ae53076e names the menu BroBot (PERSONS_TITLE) instead of app.getName()
                # ⚑ **theme host · re-anchored in place, not retired** — NOT VERIFIED. The Default look callback is retained; the replacement constructs the menu without installing it.
                "      Menu.setApplicationMenu(\n        Menu.buildFromTemplate(\n          appMenuTemplate({\n            appName: PERSONS_TITLE,\n            devTools: !app.isPackaged,\n            defaultLook: () => {\n              void themes?.showDefault().catch(() => undefined)\n            },\n          }),\n        ),\n      )\n",
                "      void appMenuTemplate({\n        appName: PERSONS_TITLE,\n        devTools: !app.isPackaged,\n        defaultLook: () => {\n          void themes?.showDefault().catch(() => undefined)\n        },\n      })\n",
            )
        ],
    ),
    # ------------------------------------------------------ H3 · attention in the state, not on screen
    (
        "M18 · ⛔ THE DEFECT, verbatim · the row is back to one word for two different asks — "
        "`waiting`, whether it is a permission that freezes the composer or a question that does not",
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — The rule survives: a row names WHICH ask, permission or question. UI-008
        # (c37e0fd1) re-worded it from `waiting: <needing>` to `needs you: <needing>`, so the old
        # two-line anchor is gone; the final return now is `summonsAttention(facets.needing) ?
        # `${NEEDS_YOU}: ${facets.needing}` : NEEDS_YOU`. The plant drops the detail so both asks
        # read the bare `needs you` again (the label's word `waiting` is now stale, the defect is
        # the same). Killed by `agent-state.test.ts`, `attention-rail.dom.test.ts`,
        # `idle-truth.render.test.ts`.
        [
            (STATE, '  return summonsAttention(facets.needing) ? `${NEEDS_YOU}: ${facets.needing}` : NEEDS_YOU', '  return NEEDS_YOU'),
        ],
    ),
    (
        "M19 · …and the rail renders the coarse standing again, so the words exist only in the "
        "`aria-label` (the state the PM measured)",
        # ⚑ **Re-anchored by `449`, not retired** (142's rule): the row's own line gained WHERE the
        # conversation is working, so prettier broke the interpolation across two lines. ⛔ The
        # defect is unchanged — the rail draws the coarse standing and the words that tell a
        # permission from a question live only in the plate's `aria-label` again.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # rail row must show the word that says which kind of wait (row.word), not the coarse
        # standing. D-017b moved the row to the single Conversations list and renamed the field
        # access from `row.record.meta?.provider` to `row.provider`; `row.word` and the split line
        # are unchanged, so only the needle's prefix moves.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The rule survives: the rail row's word must say which kind of wait it
        # is (`waiting: permission` / `waiting: question`), not only that it waits. The row now
        # interpolates `row.word` in the `<small>`, so the plant swaps it for the coarser
        # `row.standing`. Killed by `attention-rail.dom.test.ts`.
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — The rail row still draws `row.word` in its status line, but 4c1718d7 moved the
        # row into the per-section list and prettier reflowed the interpolation, so the old one-line
        # needle no longer matches. The rule (the row shows the word that says which wait, not the
        # coarse standing) survives; the plant swaps `row.word` for `row.standing` in the reflowed
        # two-line form. Killed by `attention-rail.dom.test.ts`.
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 9fd9abfe4 wrapped the same state word in its own span; substitute only the coarse standing.
            (RAIL, "<span :data-cy=\"`rail-state-word-${row.sessionId}`\">{{", "<span :data-cy=\"`rail-state-word-${row.sessionId}`\">{{ row.standing ||"),
        ],
    ),
    (
        "M20 · ⛔ there is no live count — the only number on the rail is the seed's Home badge again",
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — The live attention count survives, now one badge per section (`section.needing`,
        # `rail-needs-you-<key>`) since 4c1718d7; `needingCount > 0` no longer exists. The plant
        # keeps the label's defect (no live count is drawn) by turning the badge's `v-if` into
        # `false`; the old plant (delete the `v-if`) would only show a zero badge, which is a
        # different defect. Killed by `attention-rail.dom.test.ts`,
        # `brobot-and-the-other-agents-fold-apart.dom.test.ts`.
        [
            (RAIL, '            v-if="section.needing > 0"\n', '            v-if="false"\n'),
        ],
    ),
    (
        "M21 · the count is written over `needing` rather than the standing, so a plan go-ahead — "
        "which blocks nothing and is deliberately NOT waiting — inflates a number its rows disagree with",
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — The count moved from `rows.value.filter(...)` inside a computed to the
        # per-section helper `needingCount(of)`, but its rule is unchanged and documented in place:
        # a plan go-ahead is a `needing` and deliberately not `waiting`. The plant counts
        # `facets.needing !== undefined` in that helper, so the plan row inflates the badge. Killed
        # by `attention-rail.dom.test.ts`.
        [
            (RAIL, "  return of.filter((row) => row.standing === 'waiting').length", '  return of.filter((row) => row.facets.needing !== undefined).length'),
        ],
    ),
    (
        "M22 · …or over the row COUNT, which is the same defect with a rounder number",
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — Same moved anchor as M21 (`needingCount`), same rule. The plant counts every row
        # in the section, which is the same defect with a rounder number. Killed by
        # `attention-rail.dom.test.ts`.
        [
            (RAIL, "  return of.filter((row) => row.standing === 'waiting').length", '  return of.length'),
        ],
    ),
    # ------------------------------------------------- H4 · a refused launch that provisioned anyway
    (
        "M23 · ⛔ THE DEFECT, verbatim · the home is provisioned BEFORE the cwd is resolved — a "
        "mistyped folder leaves a credential-bearing home and a profile in the menu forever",
        [
            (
                HOST,
                # ⚑ Re-anchored by 243 (`prepareProviderHome` is awaited now). The ORDER is
                # the rule and it is unchanged: resolve the cwd before anything is written.
                # ⚑ Re-anchored again by 371, which wired `project.cwd` in as the default a
                # session with no requested folder takes (HO-009 §5.1). The ORDER is still the rule;
                # the row was re-applied and re-run at 371 rather than carried on its old verdict.
                "    const cwd = this.deps.resolveCwd(id, input.cwd ?? this.projectCwd())\n    const providerHome = await this.deps.prepareProviderHome(input.provider, profileId)",
                "    const providerHome = await this.deps.prepareProviderHome(input.provider, profileId)\n    const cwd = this.deps.resolveCwd(id, input.cwd ?? this.projectCwd())",
            )
        ],
    ),
    (
        "M24 · `launchBlocked` stops weighing a folder that was REFUSED, so Send is lit over the "
        "sentence saying it cannot be used (169's shape, one field over)",
        [
            (
                LAUNCHER,
                "  if (cwdRefusal.value !== null) {\n    return 'That folder cannot be used — see the reason under the folder above.'\n  }\n",
                "",
            )
        ],
    ),
    (
        "M25 · ⛔ Send goes dead while a check is merely IN FLIGHT — a 200 ms hole after every "
        "keystroke, and a permanent one if the bridge cannot answer (the live smoke found this one)",
        [
            (
                LAUNCHER,
                "  if (cwdRefusal.value !== null) {\n"
                "    return 'That folder cannot be used — see the reason under the folder above.'\n"
                "  }\n",
                "  if (cwdRefusal.value !== null) {\n"
                "    return 'That folder cannot be used — see the reason under the folder above.'\n"
                "  }\n"
                "  if (cwd.value.trim() !== '' && cwdVerdict.value?.path !== cwd.value) {\n"
                "    return 'Checking that folder…'\n"
                "  }\n",
            )
        ],
    ),
    (
        "M26 · typing CLEARS what the app knew instead of asking — the pre-203 renderer exactly",
        [(LAUNCHER, '@input="checkCwdSoon"', '@input="cwdVerdict = null"')],
    ),
    (
        "M27 · ⛔ `checkCwd` answers `ok` for everything — the launcher and the launch stop agreeing, "
        "which is the one thing 076 §3 exists to prevent",
        [
            (
                HOST,
                "      return { ok: true, path: this.deps.resolveCwd(CHECKING_A_FOLDER, path) }",
                "      return { ok: true, path }",
            )
        ],
    ),
    (
        "M28 · `checkCwd` sends a blank path through `resolveCwd`, so a keystroke on an empty box "
        "creates the workspace directory",
        [(HOST, "    if (path.trim() === '') return { ok: true, path: '' }\n", "")],
    ),
    (
        "M29 · the picker's verdict is thrown away, so a folder just refused by the native dialog "
        "leaves Send lit until something else asks",
        [
            (
                LAUNCHER,
                "  cwdVerdict.value = { path: chosen.path, refusal: chosen.refusal ?? null }",
                "  cwdVerdict.value = null",
            )
        ],
    ),
    # ------------------------------------------------------------------- carried forward (see above)
    (
        "M30 · ordinary `send` stops asking whether the session can take a turn "
        "(149 M14 carried: the anchor gained a caller)",
        [
            (
                HOST,
                "    const session = this.require(sessionId, by)\n    await this.assertCanTakeTurn(session, 'send')\n    await session.handle.send(text)",
                "    const session = this.require(sessionId, by)\n    this.assertAcceptsMessages(session, 'send')\n    await session.handle.send(text)",
            )
        ],
    ),
    (
        "M31 · the interrupt breadcrumb is gone entirely — 085's original report "
        "(150 M25 carried: `noteUserCommand` gained a caller)",
        [(HOST, "    this.noteUserCommand(sessionId, 'interrupted_to_send', by)", "    void 0")],
    ),
    (
        "M32 · …and written ABOVE the sign-in gate again, so a refused turn claims a gesture "
        "(150 M26 carried, 148 L2, 039)",
        # ⚑ Re-anchored by 232 §3: the queue latch is raised BEFORE the gate now (232's
        # review — the path re-check became a filesystem round trip, and a turn ending
        # inside it let the queued message jump the interrupt), so the gate moved into the
        # `try`. The rule is unchanged: the breadcrumb may not be written above it. 232's
        # table re-runs it (M36).
        # ⚑ Re-anchored again by 340: `sendInterrupting` is one of the five verbs a
        # commanding caller may reach, so it asks `requireToCommand`. The rule is unchanged.
        # ⚑ Re-anchored again by 374: the messaging gate is two lines between the
        # entitlement and the latch, so the anchor moves down to the first of them. The
        # breadcrumb rule is unchanged — it may not be written above anything that refuses,
        # and 374 added two things that do.
        # ⚑ Landing D-014 · re-anchored in place, not retired — Only the comment under
        # `requireToCommand` changed: D-014 rewrote it and dropped the `'interrupt'` grant line. The
        # rule survives. Re-verified RED alone.
        [
            (HOST, '    const session = this.requireToCommand(sessionId, by)\n    // ⛔ **The message capability, because this verb delivers words** (374).', "    const session = this.requireToCommand(sessionId, by)\n    this.noteUserCommand(sessionId, 'interrupted_to_send', by)\n    // ⛔ **The message capability, because this verb delivers words** (374)."),
        ],
    ),
    (
        "M33 · the launcher stops blocking on an UNNAMED profile, so `+ New profile…` with an empty "
        "box launches (169 M4 carried: `launchBlocked` grew a folder clause)",
        [
            (
                LAUNCHER,
                "    return newProfileName.value === ''\n"
                "      ? 'Name the new profile above before starting a conversation in it.'\n"
                "      : 'That profile name cannot be used — see the rule under the field above.'\n",
                "    return newProfileName.value === '' ? null : 'That profile name cannot be used.'\n",
            )
        ],
    ),
]


def apply(root, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(
                f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)",
                file=sys.stderr,
            )
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace, 1))
    return 1 if bad else 0


def main() -> int:
    from pathlib import Path

    args = sys.argv[1:]
    if args[:1] == ["--count"]:
        print(len(MUTATIONS))
        return 0
    if args[:1] == ["--files"]:
        seen = []
        for _name, edits in MUTATIONS:
            for rel, _find, _replace in edits:
                if rel not in seen:
                    seen.append(rel)
        print(" ".join(seen))
        return 0
    if args[:1] == ["--name"]:
        print(MUTATIONS[int(args[1])][0])
        return 0
    if args[:1] == ["--dry-run"]:
        root = Path(args[1]).resolve()
        bad = 0
        for index in range(len(MUTATIONS)):
            bad += apply(root, index, dry=True)
        print(f"{len(MUTATIONS) - bad}/{len(MUTATIONS)} anchors found exactly once")
        return 1 if bad else 0
    root = Path(args[0]).resolve()
    return apply(root, int(args[1]), dry=False)


if __name__ == "__main__":
    raise SystemExit(main())
