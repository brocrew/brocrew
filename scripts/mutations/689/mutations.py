"""689 · four small things main owes the window — `673` F-7, `687` inbox 3, `685` H1 and H2.

⛔ **Ordered by the PM from four hand-backs**: a holder's ending announced `conversations` and not
`work` (`673` F-7); the launch sweep dropped a crashed message's attachments (`687` inbox 3); a
failed model probe was cached for the life of the app (`685` H1); and the agent sheet's *Choose…*
probed both providers (`685` H2).

## ⚠️ What a row here measures

 * ⚑ **M1–M2 and M10 are the work announcement** — the ending's, made at all and made only for a
   conversation holding open work (killed by `four-small-things-main-owes-the-window.test.ts` §1),
   and the reopen's, whose call now goes through the same helper (killed by
   `work-moved-and-nothing-announced-it.test.ts` §2).
 * ⚑ **M3 is the sweep's attachments** — killed by §2.
 * ⚑ **M4–M5, M12–M14 and M16 are the cached-failure rule** — the read asking again, a success
   staying a value, a failure still being asked counting as fresh, one re-ask per failure however
   many asks met it, none during a quit, and the marking that tells a settled probe from one in
   flight — killed by §3's child counts and its in-flight quit test. ⚑ *A fresh failure — one this
   very ask produced — is not asked twice* is `677` M45, corrected in place onto the same helper;
   §3's control kills it too, and a copy here would be one mutation measured twice.
 * ⚑ **M6–M9, M11, M15, M17 and M18 are the one-provider door** — its wire, its provider enum, its
   quit guard (before any store read, since the database may be closed) and what that guard hands
   back, its ruling at the shutdown door, and `models` going through it — killed by §4, §3 and
   `shutdown-door.test.ts`. ⛔ M9 and M11 are retired: the `models` command and the one-provider
   command are gone (D-049).

## ⛔ What this table cannot reach

 * 🔴 **WHERE in the teardown the ending announces.** A row that moved the announcement to the top of
   `runFinalize` SURVIVED and was dropped: the pump delivers the provider's `status: ended` before
   the teardown begins, on every path a test can drive, so the task already reads the ending there.
   ⚑ §1 still reads the parent's task INSIDE the announcement — the property a person relies on —
   and the code comment says what orders it.
 * ⚠️ **The preload's `providerModels` line.** No test executes the preload; every verb's line
   there is as unmeasured as this one, and the renderer that will call it is the frontend's.
 * ⚠️ **Rows other tables hold on lines this dispatch MOVED**: `673` M16–M18 moved with the reopen's
   lines into `announceTheWorkItHolds` UNCHANGED, so they now mutate the reopen's AND the ending's
   announcement (both tables' killers still kill them; `673`'s table says so); `682` M16 moved
   into `providerModels` unchanged. Corrected in place, because their lines changed: `257` M14,
   `273` M8, `310` M2, `677` M20/M36/M37/M45, `682` M18.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"

THE_ENDING = "    this.announceTheWorkItHolds(session.id, 'ending')\n"
THE_DOOR_ASKS = "    return this.modelsAskedAgainIfTheyFailed(provider, askIn).then((one) =>\n"
THE_RULE = "    if (catalogue.ok || !stale || this.launches.closed) return catalogue\n"
THE_QUIT = (
    "    if (this.launches.closed) {\n"
    "      const answered = this.modelProbes.get(modelProbeKey(provider, profileId))\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── 673 F-7 · the ending announces its work ──────────────────────────────────────────────────
    (
        "M1 · 🔴 the ending announces no `work` · a parent's Work tab keeps *working* beside an "
        "ended holder for up to 30 s · killed by `four-small-things-main-owes-the-window.test.ts` §1",
        # ⚑ Landing D-016c (8d54d6dc, a stop changes nothing) · re-anchored in place, not retired —
        # The rule still holds. Ruling (c) keeps "its giver is told once, when it stalls", and the
        # ending of a conversation holding open work still announces `work` through
        # `announceTheWorkItHolds(session.id)`, which lost its `at` parameter. The old anchor
        # `announceTheWorkItHolds(session.id, 'ending')` is gone, so the row is re-anchored on the
        # single-argument line, which occurs once in runtime-host.ts at about line 16885 (the only
        # other caller is `announceTheWorkItHolds(old)` at replaced_by). The plant removes the line.
        # Killed by `four-small-things-main-owes-the-window.test.ts`.
        [
            (HOST, '    this.announceTheWorkItHolds(session.id)\n', ''),
        ],
    ),
    (
        "M2 · ⛔ EVERY ending announces `work`, holding work or not · each close makes every window "
        "re-read a population nothing moved · killed by "
        "`four-small-things-main-owes-the-window.test.ts` §1's controls",
        # ⚑ Landing D-016c (8d54d6dc, a stop changes nothing) · re-anchored in place, not retired —
        # The rule still holds: an ending that holds no open work announces `conversations` and no
        # `work`, and the commit left the ending's work-only-if-open guard in
        # `announceTheWorkItHolds`. The plant replaces the ending's guarded helper call with an
        # unconditional `theWorldMoved('work')`. Its anchor is the same single-argument line as M1,
        # since the old `(session.id, 'ending')` argument no longer exists. Killed by
        # `four-small-things-main-owes-the-window.test.ts`.
        [
            (HOST, '    this.announceTheWorkItHolds(session.id)\n', "    this.theWorldMoved('work')\n"),
        ],
    ),
    # ── 687 inbox 3 · the sweep carries the paths ────────────────────────────────────────────────
    (
        "M3 · 🔴 the launch sweep drops the paths again · a crashed message is offered back without "
        "its files, looking complete · killed by `four-small-things-main-owes-the-window.test.ts` §2",
        [(STORE, "            ...attachmentsStoredOn(held.payload),\n", "")],
    ),
    # ── 685 H1 · a failure already cached is asked once more ─────────────────────────────────────
    (
        "M4 · 🔴 the read never asks a failure again · one blip leaves an agent's menus reading "
        "*could not be asked* until a restart · killed by "
        "`four-small-things-main-owes-the-window.test.ts` §3",
        [(HOST, THE_DOOR_ASKS, "    return this.probeModelsFor(provider, askIn).then((one) =>\n")],
    ),
    (
        "M5 · ⛔ a cached SUCCESS is asked again · every ask spawns a child for a list already in "
        "hand · killed by `four-small-things-main-owes-the-window.test.ts` §3's controls",
        [(HOST, THE_RULE, "    if (!stale || this.launches.closed) return catalogue\n")],
    ),
    # ── 685 H2 · one provider's list is its own door ─────────────────────────────────────────────
    (
        "M6 · 🔴 the one-provider command asks BOTH · a Claude agent's press lays down a Codex home "
        "for a list nothing draws · killed by `four-small-things-main-owes-the-window.test.ts` §4",
        [
            (
                "apps/desktop/src/main/runtime/runtime-host.ts",
                # ⚑ **W4.91 · re-anchored in place, not retired** — 9e106ef0 removed the providerModels command; the one-provider read is the list door's theListFor now (moved from ipc.ts, reviewer's re-anchor)
                "    const catalogue = await this.providerModels(own, provider).catch((): ModelCatalogue => ({\n",
                # ⚑ **W4.202 · the replacement re-aimed, not the anchor** — D-049's rest removed
                # `models()`, which the mutant used to ask both; it now asks both itself.
                "    const catalogue = await Promise.all(SUPPORTED_PROVIDERS.map((one) => this.providerModels(own, one))).then((all) => all[SUPPORTED_PROVIDERS.indexOf(provider)] as ModelCatalogue).catch((): ModelCatalogue => ({\n",
            )
        ],
    ),
    (
        "M7 · ⛔ the wire takes ANY provider name · a string the app has no runtime for reaches the "
        "probe · killed by `four-small-things-main-owes-the-window.test.ts` §4",
        [
            (
                IPC,
                # ⚑ **W4.91 · re-anchored in place, not retired** — 9e106ef0 removed providerModels; the list door modelList takes the provider now (reviewer's re-anchor)
                "  z.object({ kind: z.literal('modelList'), provider: providerSchema, profileId }),\n",
                "  z.object({ kind: z.literal('modelList'), provider: z.string(), profileId }),\n",
            )
        ],
    ),
    (
        "M8 · ⛔ the door starts a probe during a quit · a provider home is laid down after `closeAll` "
        "— the registry refuses the child only after — and the window is told `closing` instead of "
        "being refused · killed by `four-small-things-main-owes-the-window.test.ts` §4",
        [(HOST, THE_QUIT, THE_QUIT.replace("    if (this.launches.closed) {\n", "    if (false) {\n"))],
    ),
    (
        # ⛔ **RETIRED BY RULING (W4.202, D-049's rest: the `models` command and the host's
        # `models()` are removed):** no read asks both providers through the door any more, so the
        # row's subject is gone. Its anchor is left stale, so the census records it retired.
        "M9 · ⛔ `models` stops going through the door · the launcher's read loses the rule a "
        "person's second ask depends on · killed by `four-small-things-main-owes-the-window.test.ts` §3",
        [
            (
                HOST,
                "        async (provider) => [provider, await this.providerModels(profileId, provider)] as const,\n",
                "        async (provider) => [provider, await this.probeModelsFor(provider, profileId)] as const,\n",
            )
        ],
    ),
    # ── review, round one ────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row plants removal of the reopen's `announceTheWorkItHolds(sessionId, 'reopen')`.
        # D-016c ruled that a reopen announces no work: "A stop, a reopen and a start tell nobody
        # anything and announce no work". The killer, work-moved-and-nothing-announced-it.test.ts
        # section 2, was rewritten to assert the opposite: `expect(saidWork(), 'a reopen announced
        # work').toBe(0)`, and the call site is gone. The row would now plant a rule the commit
        # reversed. Its anchor is left stale, so the census records it retired.
        "M10 · 🔴 the REOPEN announces no `work` again · its call now goes through the helper the "
        "ending shares, and a Work tab says *has ended* beside a running holder · killed by "
        "`work-moved-and-nothing-announced-it.test.ts` §2",
        [(HOST, "    this.announceTheWorkItHolds(sessionId, 'reopen')\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (D-049, 9e106ef0):** the one-provider model list left the bridge —
        # `providerModels` is no command any more, and a model list has one door, `modelList`. The
        # row's subject is gone, so its anchor is left stale and the census records it retired.
        "M11 · ⛔ the shutdown door REFUSES the one-provider list · an answered probe a quit could hand "
        "back for nothing is refused instead · killed by `shutdown-door.test.ts`",
        [(IPC, "  providerModels: 'answered',\n", "  providerModels: 'refused',\n")],
    ),
    (
        "M12 · ⛔ a failure still being asked counts as cached · two asks in one tick spend a child "
        "each on one answer · killed by `four-small-things-main-owes-the-window.test.ts` §3",
        [
            (
                HOST,
                "    const stale = cached !== undefined && this.settledModelProbes.has(cached)\n",
                "    const stale = cached !== undefined\n",
            )
        ],
    ),
    (
        "M13 · ⛔ every caller that met a failure forgets and asks again · the second deletes the "
        "first's probe while it runs and starts another child · killed by "
        "`four-small-things-main-owes-the-window.test.ts` §3",
        [
            (
                HOST,
                "    if (this.modelProbes.get(key) === cached) this.forgetModels(provider, folder)\n",
                "    this.forgetModels(provider, folder)\n",
            )
        ],
    ),
    (
        "M14 · ⛔ an ask in flight asks again DURING a quit · it lays down a provider home after "
        "`closeAll` and replaces the failure with `closing` · killed by "
        "`four-small-things-main-owes-the-window.test.ts` §3's in-flight quit test",
        [(HOST, THE_RULE, "    if (catalogue.ok || !stale) return catalogue\n")],
    ),
    (
        "M15 · ⛔ the door reads the store before its quit guard · a window asking once the "
        "database has closed is told the connection is closed · killed by "
        "`four-small-things-main-owes-the-window.test.ts` §4",
        [
            (
                HOST,
                THE_QUIT,
                THE_QUIT.replace(
                    "    if (this.launches.closed) {\n",
                    "    if (this.launches.closed && !this.hasNeverRun(profileId)) {\n",
                ),
            )
        ],
    ),
    # ── review, round two ────────────────────────────────────────────────────────────────────────
    (
        "M16 · 🔴 no probe is ever marked settled · every cached failure counts as fresh, and no door "
        "asks it again — `685` H1 back for all five callers at once · killed by "
        "`four-small-things-main-owes-the-window.test.ts` §3",
        [(HOST, "    void probe.then(settled, settled)\n", "")],
    ),
    (
        "M17 · ⛔ a quit refuses what it HAS · an answered probe is refused instead of handed back, "
        "which is what 070 ruled costs nothing · killed by "
        "`four-small-things-main-owes-the-window.test.ts` §3 and §4",
        [(HOST, "        answered ??\n        Promise.reject(\n", "        Promise.reject(\n")],
    ),
    (
        "M18 · ⛔ a quit hands back ANOTHER home's list · BroBot's catalogue answers for every profile "
        "while the app closes — `256` H1's shape · killed by "
        "`four-small-things-main-owes-the-window.test.ts` §3 and §4",
        [
            (
                HOST,
                "      const answered = this.modelProbes.get(modelProbeKey(provider, profileId))\n",
                "      const answered = this.modelProbes.get(modelProbeKey(provider, STAND_IN_PROFILE))\n",
            )
        ],
    ),
]
