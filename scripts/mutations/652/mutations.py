"""652 · A resume that needs no window.

⚑ **One signature and the tests that make it honest.** `resumeSession(sessionId, sink)` took a
`RuntimeEventSink` and now takes `RuntimeEventSink | null`, matching `createSession` since `336`.
`646` measured what the gap cost: the only sink a non-window caller could hand the reopen was one it
made up — `NO_SURFACE` is the obvious one and it type-checks — and the slot was then reserved under
that sink's `ownerId`, so `runningStateOf` answered `in-a-window` and a person pressing to take the
conversation over was told *"Switch to that window"* about a window that does not exist.

## 🔴 A · what the dispatch CHANGED

 1. **The reservation reads the sink the way `createSession`'s does** — `sink?.ownerId ?? null` and
    `sink?.aPersonIsBehindIt ?? false` — so a reopen with no surface is reserved under NO owner:
    `unwatched`, claimable, `bornWithoutASurface`, and released rather than ended when a claimer
    leaves. `NO_SURFACE` is substituted once, below the reservation, for the registered session.
 2. **Only a surface registers an owned wait and asks the generation fence** (`265` §1). With no
    surface there is no departure that could release the wait.
 3. **Only a surface re-attaches.** A null caller owns nothing, so a conversation already running
    goes on to `reserve` and is refused there (`held-by-nobody`) rather than handed over.

⚑ **And the `643` F6 instrument, landed**: two LIVE Claude children launched either side of a
credential rotation must disagree about the latch, which is a property of each child and not of the
runtime they share. `M6` and `M7` are the two ways that could stop being true.

## ⛔ B · what has NO row, said rather than left out

⚠️ **No row on `const waiting = sink === null ? null : this.beginOwnedWait(sink.ownerId)`.** The
only wrong value a null caller could register a wait under is an owner id nothing ever releases —
`closeSessionsForOwner` is asked only about real owners — so every such mutant behaves exactly like
the line it replaces. 🔴 **The fence for a WINDOW is `265 M1`-`M4`'s**, and `265 M2`'s anchor was
corrected in place by this dispatch rather than retired.

⚠️ **No row on `reopenSession(slot, sink ?? NO_SURFACE)` or on `if (waiting !== null)` in the
`finally`.** The first has no alternative that is not `null` itself, which the rest of the path
cannot take; the second deletes nothing from a set when there is nothing to delete. ⚑ The OTHER
`if (waiting !== null)` — the one around the generation fence — is NOT in this list: removing it
crashes every null reopen, and `M10` is that row (found by this dispatch's own review, which caught
this section promising a completeness it did not have).

⚠️ **No row making `?? false` read `?? true` for the answer door.** A slot with no owner never passes
`mayAnswerAsAHuman` — its last clause is `slot.ownerId === by.ownerId` — so the door cannot tell the
two apart. ⚑ `M2` is the same mutation measured where it IS observable: the woken conversation's own
`message_sent` records the slot's flag as `onBehalfOfAPerson`.

## ⚑ C · rows this dispatch owes OTHER tables' rulings, and rows it moved

⛔ **Two rulings in other tables said a row was unobservable, and this dispatch's review found both
false** — each is corrected in its own table's prose and its row lives here:

 * `M8` — `336` ruled *"no row makes `reserve` read equality without the null guard"* because only
   two surfaceless creates on one id could reach it. A second null REOPEN is exactly that.
 * `M9` — `349` ruled *"no `?? true` row on the create path"* because the answer door cannot see
   it. `message_sent` and `propose_project` can, and have since `439`/`441`; `M2` is the same row
   on the reopen door.

⚠️ And `340`'s *"changes no observable behaviour"* about `commandedBy: sink.ownerId` on a resume
had been false since `349`/`373` made a reopen disclose `hasACommander`; `373 M5` already is that
row, so only the prose moved.

### corrected in place (142: correct, never delete)

 * `265 M2` — the registration gained its `sink === null ? null :` condition.
 * `336 M1` and `349 M4` — the reopen now spells `createSession`'s two lines identically at a
   12-space indent, which CONTAINS the 10-space anchors; each gained the leading newline that pins
   it to `createSession`'s own line.
 * `349 M5` — the reopen's line reads `sink?.aPersonIsBehindIt ?? false` now.
 * ⚠️ `265 M1` and `336 M6` still apply exactly once without a correction: their anchors are
   substrings of the same lines at the deeper indent the new `if` blocks put them at. Both were
   re-verified RED by hand against their own killers.
 * ⚠️ `373 M5`'s REPLACEMENT spells `sink.ownerId`, which no longer type-checks on a nullable sink.
   A table run does not type-check, and every killer of that row reopens through a window, so it
   goes on measuring what it measured; it is recorded here rather than rewritten.

## 🔴 D · the killers

`apps/desktop/test/a-resume-that-needs-no-window.test.ts` for `M1`-`M5`, `M8` and `M10`;
`packages/runtime/test/sign-in-supersede.test.ts`'s *"two LIVE children launched either side of a
rotation disagree"* for `M6`-`M7`; `apps/desktop/test/a-project-he-described.test.ts`'s *"a
conversation with nobody at it is refused"* for `M9`. ⚑ Each row was verified RED by hand against
its own killer file, anchor count `== 1`, restored from saved bytes.

⚠️ **`M6` and `M7` spell the shared value on the runtime's own async token reader** — one function
object per `ClaudeRuntime`, handed to every child it launches — and NOT on `globalThis`. ⛔ The first
draft used `globalThis`, and the review measured what that cost `M7`: the value leaked from one test
into the next, five older tests in the killer file went red on the leak alone, and the row's RED no
longer said anything about the new test. Keyed per runtime, each test builds its own and nothing
carries over.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"

THE_OWNER = "            ownerId: sink?.ownerId ?? null,"
THE_PERSON = "            ownerIsAPerson: sink?.aPersonIsBehindIt ?? false,"

MUTATIONS = [
    # ── the reservation — who a woken conversation belongs to ──────────────────────────────────
    (
        "M1 · 🔴 **the shortcut `646` measured** · a reopen with no surface is reserved under "
        "`NO_SURFACE`'s id instead of none, so it reads `in-a-window`, nobody may claim it, and a "
        "person pressing to take it over is told to switch to a window that does not exist",
        [(HOST, THE_OWNER, "            ownerId: sink?.ownerId ?? NO_SURFACE.ownerId,")],
    ),
    (
        "M2 · ⛔ a woken conversation declares a PERSON behind it · `?? true` on the reopen, so what "
        "it sends is recorded as sent on a person's behalf and `propose_project` would park a card "
        "in front of nobody",
        [(HOST, THE_PERSON, "            ownerIsAPerson: sink?.aPersonIsBehindIt ?? true,")],
    ),
    # ── what a reopen must still do when nobody is watching ────────────────────────────────────
    (
        "M3 · 🔴 **the security row** · a reopen runs under the DEFAULT a person set for new "
        "conversations instead of the mode this one was recorded with — a conversation recorded "
        "`ask` comes back running without prompts once somebody makes `auto` the default",
        [
            (
                HOST,
                "    const approvalMode = row.approvalMode ?? 'ask'",
                "    const approvalMode = this.deps.store.defaultApprovalMode()",
            )
        ],
    ),
    (
        "M4 · ⛔ the instructions are not re-read on a reopen · the woken conversation comes back "
        "without the workspace instructions it was started with, which `told.ts` tells the person "
        "is read at every launch",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule holds:
        # `reopenSession` still re-reads the instructions from the recorded folder
        # (`this.deps.readInstructions?.(row.provider, row.cwd, providerHome, ...)`) and hands
        # `instructions?.systemHint` to `runtime.resume`. The old anchor now matches twice (the
        # reopen and the describe-for-attach read at ~25157), so the new anchor is pinned to the
        # reopen by the comment line just above it.
        [
            # ⚑ **W4.480 · re-anchored in place, not retired** — NOT VERIFIED; source-only. Held: running it needs W4’s written lift. Built-in skills moved the anchor; original defect, ID and killer retained.
            # ⚑ **W4.507 · re-anchored in place, not retired** — NOT VERIFIED; source-only. The text pack's one reading per launch moved the anchor; the reopen still re-reads the instructions. Original defect, ID and killer retained.
            (HOST, "    // another repo comes back with that repo's instructions rather than today's.\n    // One reading of a text pack for the whole launch, as at a start.\n    const pack = this.deps.readTextPack?.()\n    const builtInSkills = await this.theSkillsForALaunch(\n      slot,\n      row.provider,\n      providerHome,\n      row.profileId,\n      pack,\n    )\n    const instructions = this.deps.readInstructions?.(\n", "    // another repo comes back with that repo's instructions rather than today's.\n    // One reading of a text pack for the whole launch, as at a start.\n    const pack = this.deps.readTextPack?.()\n    const builtInSkills = await this.theSkillsForALaunch(\n      slot,\n      row.provider,\n      providerHome,\n      row.profileId,\n      pack,\n    )\n    const instructions = undefined && this.deps.readInstructions?.(\n"),
        ],
    ),
    (
        "M5 · ⛔ a null reopen of a RUNNING conversation becomes a claim · nobody asked for it by "
        "its own verb, and it is taken for `NO_SURFACE` — `336 M6`'s rule, broken on the null door",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `reopenSession`'s
        # sink!==null gate is unchanged in rule, only extended with a new `??
        # this.aPersonsWindowTakesIt(...)` fallback (D-017 R5) that the row's plain anchor didn't
        # account for. The comment directly above it still states 336 M6's rule verbatim ('a
        # conversation that is already running goes on to reserve and is refused there…and never
        # quietly becomes a claim'), confirming the invariant the row protects is unchanged and
        # deliberately documented.
        [
            (HOST, "      if (sink !== null) {\n        const held =\n          this.attachHeldSession(sessionId, sink, 'attach') ??", "      if (sink === null) {\n        const taken = this.attachHeldSession(sessionId, NO_SURFACE, 'claim')\n        if (taken !== null) return taken\n      }\n      if (sink !== null) {\n        const held =\n          this.attachHeldSession(sessionId, sink, 'attach') ??"),
        ],
    ),
    # ── 643 F6 · the latch is the child's, not the runtime's ───────────────────────────────────
    (
        "M6 · 🔴 every child compares against the LAST launch's credential · the launch credential "
        "becomes one value the runtime shares, so a child launched before a rotation reads as "
        "current the moment a newer child is launched — BroBot's hypothesis in `643`, inverted",
        [
            (
                CLAUDE,
                "    this.launchCredential = fingerprint\n  }",
                "    this.launchCredential = fingerprint\n"
                "    ;((this.authTokenProviderAsync ?? {}) as { lastLaunch?: string }).lastLaunch = fingerprint\n"
                "  }",
            ),
            (
                CLAUDE,
                "    if (credentialFingerprint(current) === this.launchCredential) return false",
                "    if (credentialFingerprint(current) === (this.authTokenProviderAsync as { lastLaunch?: string }).lastLaunch) return false",
            ),
        ],
    ),
    (
        "M7 · ⛔ the latch is shared across children · once any child is superseded every child "
        "reads superseded, so a conversation launched on the CURRENT credential is refused its "
        "turns for another's rotation",
        [
            (
                CLAUDE,
                "    if (this._signInSuperseded) return true",
                "    if (this._signInSuperseded || (this.authTokenProviderAsync as { latched?: boolean } | undefined)?.latched) return true",
            ),
            (
                CLAUDE,
                "    this._signInSuperseded = true\n    return true",
                "    this._signInSuperseded = true\n"
                "    ;(this.authTokenProviderAsync as { latched?: boolean }).latched = true\n"
                "    return true",
            ),
        ],
    ),
    # ── rows owed to other tables' rulings (§C) ────────────────────────────────────────────────
    (
        "M8 · ⛔ `reserve` asks equality BEFORE it asks for an owner · two reservations of one id "
        "under nobody — a second null reopen of a running conversation — are told *you are already "
        "looking at this* about a conversation nobody is looking at (`336`'s no-row ruling, now "
        "reachable)",
        [
            (
                HOST,
                "        existing.ownerId === null\n"
                "          ? 'held-by-nobody'\n"
                "          : existing.ownerId === ownerId\n"
                "            ? 'already-open'\n"
                "            : 'already-open-elsewhere',",
                "        existing.ownerId === ownerId\n"
                "          ? 'already-open'\n"
                "          : existing.ownerId === null\n"
                "            ? 'held-by-nobody'\n"
                "            : 'already-open-elsewhere',",
            )
        ],
    ),
    (
        "M9 · ⛔ a SPAWNED conversation declares a person behind it · `?? true` on the create door, so "
        "`propose_project` parks a card in front of nobody and what the child sends is recorded as on "
        "a person's behalf (`349`'s no-row ruling, observable since `439`/`441`)",
        [
            (
                HOST,
                "\n          ownerIsAPerson: sink?.aPersonIsBehindIt ?? false,",
                "\n          ownerIsAPerson: sink?.aPersonIsBehindIt ?? true,",
            )
        ],
    ),
    (
        "M10 · ⛔ the generation fence is asked of a reopen that registered no wait · every null "
        "reopen throws on `null.released`, so the door this dispatch opened is shut again by a crash",
        [
            (
                HOST,
                "      if (waiting !== null) {\n"
                "        this.refusalsTranslated(() => this.assertSurfaceIsStillThere(waiting, sessionId))\n"
                "      }",
                "      {\n"
                "        this.refusalsTranslated(() => this.assertSurfaceIsStillThere(waiting!, sessionId))\n"
                "      }",
            )
        ],
    ),
]
