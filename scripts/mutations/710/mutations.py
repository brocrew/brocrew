"""710 · what a spawn and a refusal say — PM rulings R51, R52, R53 (`707` F-2, F-3, F-6), and `707`
F-1 and GAP-2 to GAP-4.

## 🔴 A · R51 — a spawn a person must fix has a permanent word of its own (M1-M8)

⚑ **The ruling**: *"A Claude spawn whose binary is missing (`ENOENT` after its pipes), or any spawn
errno that no wait can clear, is refused with a permanent, non-retryable word that says what is wrong
in words. It is never a broken tool, never `ok`, and never borrows the retryable shortage word."*
⛔ **On `main` (`ed0b52b7`)** `spawn_agent` THREW for every such code on both providers — a broken
tool, *"spawn_agent failed: spawn /…/claude ENOENT"*, the host's path in it.

## 🔴 B · R52 — a shortage at a person's own New Conversation is a person's sentence (M9-M15)

⚑ **The ruling**: *"they read a sentence that says what happened and what they can do … ⛔ Never the
raw errno … and never *try again in a moment*."* ⛔ **On `main`** a person read the errno itself, or —
where the shortage met the Keychain read or the Codex sign-in copy first — a FALSE sign-in diagnosis.

## 🔴 C · R53 — on the WAKE path a refusal names the identity (M16-M21)

⚑ **The ruling**: *"the WAKE path quotes a recorded profile id the caller never gave, so it reads the
identity's name (R41). On the SPAWN path the id is the caller's own key echoed back; it stays."*

## 🔴 D · `707` F-1 — `project` beside `number` in six refusal details (M22-M27)

## 🔴 E · `707` GAP-2 to GAP-4 — the main field for each (M28-M34)

## 🔴 F · `710`'s own review (M35-M46)

⚑ **Six rows for guards the review found untested, and six for what the review made `710` fix**: the
quit's door gives the held task's project (M35); the receipt's project on each branch (M36, M37);
an answered withdrawal's project (M38); a person's REOPEN says the shortage in a reopen's words
(M39, M40); `EMFILE` is BroBot2's own table, so its sentence never says *close an app* (M41, M42);
the launcher's model field says the shortage, never its errno (M43-M45); the sign-in check after a
failed start says it too (M46). ⚑ **And five for the second review**: a row's Import and the
catch-up sweep say it (M47, M48); the clause and the sign-in check say `EMFILE` as BroBot2's own
(M49, M50); the turn gate's Keychain read resolves `null` for a spawn refused at once (M51).

## ⚑ Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M8` | ⚑ **`run_suite`** — `a-spawn-a-person-must-fix.test.ts` |
| `M9`-`M15` | ⚑ **`run_suite`** — `a-person-whose-machine-ran-short.test.ts` |
| `M16`-`M21` | ⚑ **`run_suite`** — `wake-one-conversation.test.ts` §3.5b |
| `M22`-`M29`, `M33`, `M34` | ⚑ **`run_suite`** — `a-task-from-another-project-says-where.test.ts` §7, §8 |
| `M30`-`M32` | ⚑ **`run_suite`** — `what-the-cards-cannot-say-yet.test.ts` §6 |
| `M35` | ⚑ **`run_suite`** — `a-restart-keeps-what-was-open.test.ts` |
| `M36`-`M38` | ⚑ **`run_suite`** — `a-task-from-another-project-says-where.test.ts` §7, §8 |
| `M39`-`M46`, `M49`, `M50` | ⚑ **`run_suite`** — `a-person-whose-machine-ran-short.test.ts` §4, §5 |
| `M47`, `M48` | ⚑ **`run_suite`** — `import-from-home.test.ts` |
| `M51` | ⚑ **`run_suite`** — `packages/runtime/test/keychain-read.test.ts` |

## ⛔ What this table deliberately does NOT contain

⛔ **No row on the host arms of `that-work-is-being-sent` and `that-conversation-has-not-started`
dropping `projectSlug`** — `WithdrawRefused` makes it REQUIRED, so such a mutant does not compile;
those two are pinned behaviourally in `taking-work-back.test.ts` §3 and
`hold-the-second-message.test.ts` §6, and M22 removes the field where the detail is built.
⛔ **No row on the wake's fall-through** (`aWakeThatDidNotHappen` → `aLaunchThatDidNotStart`): both
adapters wrap a resume's spawn errno in a `ResumeError`, answered in the wake's own permanent word
before it, so no product error reaches the launch's new word there.
"""

RUNTIME = "packages/runtime/src/runtime.ts"
AUTH = "packages/runtime/src/internal/auth.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
UNAVAILABLE = "apps/desktop/src/main/runtime/session-unavailable.ts"
SPAWN_RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
CODEX_LOGIN = "packages/runtime/src/codex/codex-login.ts"
RESTART = "a-restart-keeps-what-was-open.test.ts"
IMPORT = "import-from-home.test.ts"
KEYCHAIN = "keychain-read.test.ts"

MUST_FIX = "a-spawn-a-person-must-fix.test.ts"
RAN_SHORT = "a-person-whose-machine-ran-short.test.ts"
WAKE = "wake-one-conversation.test.ts"
WHERE = "a-task-from-another-project-says-where.test.ts"
CARDS = "what-the-cards-cannot-say-yet.test.ts"

THE_NEW_ARM = (
    # ⚑ **716 · re-anchored in place, not retired** — `716` gave R51's arm a `what` (the program), so the sentence says which (R66).
    "  if (cannotRun !== null) {\n    return { rail: 'agent-could-not-be-started', because: cannotRun, what: 'program' }\n  }\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · R51 ──────────────────────────────────────────────────────────────────────────────────
    (
        f"M1 · 🔴 a spawn a person must fix is a broken tool again · the new arm gone — killed by `{MUST_FIX}`",
        [(TOOLS, THE_NEW_ARM, "")],
    ),
    (
        "M2 · 🔴 the permanent word is priced retryable · a model told to retry a program that is not "
        f"there, and the biconditional's other half — killed by `{MUST_FIX}`",
        [
            (
                TOOLS,
                "  'agent-could-not-be-started': 'until-a-person-changes-it',\n",
                "  'agent-could-not-be-started': 'while-this-holds',\n",
            )
        ],
    ),
    (
        "M3 · ⚠️ any errno is called a program that could not run · a host's own `mkdir` refused is "
        f"told its provider is missing — killed by `{MUST_FIX}`",
        [
            (
                RUNTIME,
                "      const itWasASpawn = typeof syscall === 'string' && syscall.startsWith('spawn')\n",
                "      const itWasASpawn = true\n",
            )
        ],
    ),
    (
        "M4 · ⚠️ the reader answers a shortage too · the two readers both answer one error, and only "
        f"the arm order stands between a shortage and the permanent word — killed by `{MUST_FIX}`",
        [
            (
                RUNTIME,
                "      return itWasASpawn && !aWaitClearsIt ? code : null\n",
                "      return itWasASpawn ? code : null\n",
            )
        ],
    ),
    (
        "M5 · 🔴 the reader stops at the error it is handed · Codex's transport refusal carries the "
        f"errno as its cause, and a missing Codex binary is a broken tool again — killed by `{MUST_FIX}`",
        [(RUNTIME, "    at = (at as { cause?: unknown }).cause\n", "    at = null\n")],
    ),
    (
        "M6 · 🔴 the sentence loses its act · it says the start failed and never that waiting will not "
        f"help — killed by `{MUST_FIX}`",
        [
            (
                TOOLS,
                "could not be started, so nothing was sent. Starting it again will not help until a person has looked: this machine",
                "could not be started, so nothing was sent. This machine",
            )
        ],
    ),
    (
        "M7 · ⛔ the permanent case BORROWS the retryable shortage word · the one thing R51 names "
        f"twice — killed by `{MUST_FIX}`",
        [
            (
                TOOLS,
                THE_NEW_ARM,
                "  if (cannotRun !== null) return { rail: 'agent-could-not-start-just-now', because: cannotRun }\n",
            )
        ],
    ),
    (
        "M8 · ⚠️ the permanent case keeps `agent-did-not-start` · a word whose sentence says only *the "
        f"detail says why* — R51 asks for a word that says what is wrong — killed by `{MUST_FIX}`",
        [
            (
                TOOLS,
                THE_NEW_ARM,
                "  if (cannotRun !== null) return { rail: 'agent-did-not-start', because: cannotRun }\n",
            )
        ],
    ),
    # ── B · R52 ──────────────────────────────────────────────────────────────────────────────────
    (
        "M9 · 🔴 a person reads the errno again · `createSession` passes a shortage through "
        f"untranslated — killed by `{RAN_SHORT}`",
        [
            (
                HOST,
                # ⚑ **716 · re-anchored in place, not retired** — `716` folded R52's translation into `aRefusalAPersonReads` with R66's folder and the reopen's words.
                "      throw this.refusalTranslated(this.aRefusalAPersonReads(error, id))\n",
                "      throw this.refusalTranslated(error)\n",
            )
        ],
    ),
    (
        "M10 · 🔴 the refusal drops the errno · `spawn_agent`, through the same door, can no longer "
        f"read the code and is a broken tool — killed by `{RAN_SHORT}`",
        [
            (
                HOST,
                # ⚑ **re-anchored in place by `710`'s own review** — the refusal's context grew the
                # shortage's code; the row still drops the cause.
                "      { shortage, ...(reopening ? { reopening: true as const } : {}) },\n"
                "      { cause: error },\n",
                "      { shortage, ...(reopening ? { reopening: true as const } : {}) },\n",
            )
        ],
    ),
    (
        "M11 · ⚠️ `SessionUnavailable` ignores the cause it is handed · the same loss one layer down — "
        f"killed by `{RAN_SHORT}`",
        [
            (
                UNAVAILABLE,
                "    super(message, options?.cause === undefined ? undefined : { cause: options.cause })\n",
                "    super(message)\n",
            )
        ],
    ),
    (
        "M12 · 🔴 the Keychain read swallows a shortage again · a person with no process slot left is "
        f"told their login is missing — killed by `{RAN_SHORT}`",
        [
            (
                AUTH,
                "    // ⛔ **710 · R52** — a shortage is the machine's, not the login's (the docblock above).\n"
                "    if (transientSetupFailureOf(error) !== null) throw error\n",
                "    // ⛔ **710 · R52** — a shortage is the machine's, not the login's (the docblock above).\n",
            )
        ],
    ),
    (
        "M13 · 🔴 the Codex sign-in copy swallows a shortage again · a person is told their credential "
        f"is not found, with its path — killed by `{RAN_SHORT}`",
        [
            (
                AUTH,
                "        if (transientSetupFailureOf(error) !== null) throw error\n"
                "        throw new AuthUnavailableError('codex', `personal Codex auth.json not found at ${source}`)\n",
                "        throw new AuthUnavailableError('codex', `personal Codex auth.json not found at ${source}`)\n",
            )
        ],
    ),
    (
        "M14 · ⛔ the sentence says *try again in a moment* · standing rule 8.4, which R52 names — "
        f"killed by `{RAN_SHORT}`",
                # ⚑ **re-anchored in place by `710`'s own review** — the sentence says a reopen's way
                # forward too (`${then}`); the row still plants *try again in a moment*.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — Standing rule 8.4
        # ("never try again in a moment") still holds. D-017b rewrote the non-EMFILE
        # `machine-ran-short` sentence in `session-unavailable.ts` to `Close an app you are not
        # using, or quit and reopen BroBot2, ${then}.` and dropped "or a conversation", because
        # there is no such press any more. The plant swaps its tail for `then try again in a
        # moment.`. `${then}` stays in use in the EMFILE arm, so it still typechecks.
        [
            (UNAVAILABLE, 'Close an app you are not using, or quit and reopen BroCrew, ${then}.`', 'Close an app you are not using, then try again in a moment.`'),
        ],
    ),
    (
        "M15 · ⚠️ every failed launch is called a shortage · a sign-in, a disk that said no — each told "
        f"the machine ran short — killed by `{RAN_SHORT}`",
        [(HOST, "    if (shortage === null) return error\n", "")],
    ),
    # ── C · R53 ──────────────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The wake's `not-in-can-spawn` refusal
        # is deleted with the rail (card: "no `can_spawn` / `not-in-can-spawn`"). The naming rule
        # itself survives on the wake's `profile-already-live`, which 710 M17/M19 already cover. Its
        # anchor is left stale, so the census records it retired.
        f"M16 · 🔴 the wake's `not-in-can-spawn` is handed no name · *“worker”* again — killed by `{WAKE}`",
        [
            (
                SPAWN_RAILS,
                "    return refuse('not-in-can-spawn', {\n"
                "      profileId: woken.profileId,\n"
                "      named: facts.agentCalled(woken.profileId),\n"
                "    })",
                "    return refuse('not-in-can-spawn', {\n      profileId: woken.profileId,\n    })",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** D-017 deletes `resume_agent`'s wake
        # path whole: `admitWake`, `WokenConversation` and `SpawnFacts.agentCalled` are all gone
        # from spawn-rails.ts, and `profile-already-live` is now reached only from `admitSpawn`,
        # keyed on the caller's own typed `profile_slug`. The docblock this diff removed said the
        # name lookup was 'Never set on the spawn path, whose sentence echoes the caller's own key'
        # — the field this row plants (`named`) only ever mattered on the path the commit
        # deliberately removed. Its anchor is left stale, so the census records it retired.
        f"M17 · 🔴 the wake's `profile-already-live` is handed no name — killed by `{WAKE}`",
        [
            (
                SPAWN_RAILS,
                "      profileId: woken.profileId,\n"
                "      named: facts.agentCalled(woken.profileId),\n"
                "      liveSessionId: theOneAlreadyLive,\n",
                "      profileId: woken.profileId,\n      liveSessionId: theOneAlreadyLive,\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The `case 'not-in-can-spawn':` sentence
        # in spawn-rails.ts is deleted. Any agent now starts any existing profile, so no such
        # refusal is phrased anywhere. Its anchor is left stale, so the census records it retired.
        f"M18 · 🔴 `not-in-can-spawn`'s sentence ignores the name it is handed — killed by `{WAKE}`",
        [
            (
                SPAWN_RAILS,
                "        `${detail.named ?? `“${detail.profileId ?? '?'}”`}.`\n",
                "        `“${detail.profileId ?? '?'}”.`\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Same removal:
        # `SpawnRefusalDetail.named` no longer exists (only `profileId` and `liveSessionId` remain),
        # and the sentence now unconditionally reads `“${detail.profileId ?? '?'}”` because there is
        # no wake-path name to prefer. The row plants ignoring a field that the commit itself
        # deleted, so there is nothing left to re-anchor to. Its anchor is left stale, so the census
        # records it retired.
        f"M19 · 🔴 `profile-already-live`'s sentence ignores the name it is handed — killed by `{WAKE}`",
        [
            (
                SPAWN_RAILS,
                "        `drive. It is ${detail.named ?? `“${detail.profileId ?? '?'}”`}. Starting a different agent ` +\n",
                "        `drive. It is “${detail.profileId ?? '?'}”. Starting a different agent ` +\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is gone. The row
        # plants a roster name in place of the caller's own key in `profile-already-live`'s detail
        # via `facts.agentCalled`. 5e931be8 says 'spawn_agent is gone', and `spawn-rails.ts` is now
        # `admitGive`, with no `profile-already-live`, no `agentCalled` and no `named` field. The
        # killer file's header says its §3 was 'retired with the tool' ('a message start meets the
        # message rails only, R1'), and the earlier D-017 landing retired M17 to M19 and M21 on the
        # same subject. The remaining refusals `no-such-profile` and `that-profile-exists` echo
        # `asked.profile`, the caller's own key, with no roster lookup to plant. Its anchor is left
        # stale, so the census records it retired.
        "M20 · ⛔ the SPAWN path names too · the caller's own key replaced by the roster's name, which "
        f"discloses a row it may not see (`598`) — killed by `{WAKE}`",
        # ⚑ Landing D-014 · re-anchored in place, not retired (landing review) — not-in-can-spawn is
        # gone, and R53's own-key rule stands on the spawn path (`SpawnRefusalDetail.named`: never
        # set there); the control rides profile-already-live. Re-verified RED alone.
        [
            (SPAWN_RAILS, "    return no('profile-already-live', { profileId: asked.profileId, liveSessionId: alreadyLive })\n", "    return no('profile-already-live', { profileId: asked.profileId, named: facts.agentCalled(asked.profileId), liveSessionId: alreadyLive })\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The host's `agentCalled` thunk that
        # this row targeted was `SpawnFacts.agentCalled`, built solely to resolve a WAKE's recorded
        # profile id to a display name for `admitWake`; that thunk and its call site are gone with
        # `resume_agent`. `runtime-host.ts` still has an unrelated local `agentCalled` (11266) but
        # it feeds `digest.ts`'s proposal sentences, a different feature this commit did not touch.
        # Its anchor is left stale, so the census records it retired.
        "M21 · ⚠️ the host's name is the slug · a name a PERSON gave the identity never reaches the "
        f"sentence — killed by `{WAKE}`",
        [
            (
                HOST,
                "      agentCalled: (profileSlug) => agentName(profileSlug, this.deps.store.agentIdentities()),\n",
                "      agentCalled: (profileSlug) => profileSlug,\n",
            )
        ],
    ),
    # ── D · `707` F-1 ────────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** D-016 removed the project beside
        # `number` in every refusal detail: `withdrawalDetail` now returns `{ agent, number:
        # refused.number }` and `WithdrawRefused` has no `projectSlug`. The commit says "a task
        # reads 'Task #N'", and the killer `a-task-from-another-project-says-where.test.ts` was
        # deleted in bd70d693 (971 lines). Its anchor is left stale, so the census records it
        # retired.
        "M22 · 🔴 `withdraw_task`'s withdrawn, in-flight and not-started refusals lose the project · "
        f"`number: 1` for a caller holding two Task #1s — killed by `{WHERE}`",
        [
            (
                TOOLS,
                "      return { agent, number: refused.number, project: refused.projectSlug }\n",
                "      return { agent, number: refused.number }\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The answered arm of `withdrawalDetail`
        # no longer carries `project` (the diff shows `-  project: refused.projectSlug`), because
        # tasks read "Task #N" and not "Task #N in <project>". Its killer file was deleted, and no
        # other test pins a project beside the number. Its anchor is left stale, so the census
        # records it retired.
        f"M23 · 🔴 `withdraw_task`'s answered refusal loses the project — killed by `{WHERE}`",
        [
            (
                TOOLS,
                "        number: refused.number,\n        project: refused.projectSlug,\n",
                "        number: refused.number,\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `message_agent`'s answered refusal no
        # longer says `project: about_.projectSlug`; D-016 deleted that key with the project
        # spelling. Nothing is left to drop, and the killer is deleted. Its anchor is left stale, so
        # the census records it retired.
        f"M24 · 🔴 `message_agent`'s answered refusal loses the project — killed by `{WHERE}`",
        [(TOOLS, "                  project: about_.projectSlug,\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `WorkAlreadyOpen` lost its third
        # constructor argument `heldTaskProject`, and the refusal no longer carries `project:
        # error.heldTaskProject`. The rail itself (a second open task is refused) survives, but this
        # row's defect is a project that no longer exists. Its anchor is left stale, so the census
        # records it retired.
        f"M25 · 🔴 `agent-already-has-work-open` loses the project — killed by `{WHERE}`",
        [(TOOLS, "                  project: error.heldTaskProject,\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The plant passes `DEFAULT_PROJECT_ID`
        # as a third argument to `WorkAlreadyOpen`, whose constructor is now `(heldTaskId,
        # heldTaskNumber)`. Current code is `new WorkAlreadyOpen(openWork.taskId, openWork.number)`,
        # so the defect (wrong project for the held task) is removed on purpose, and the killer is
        # deleted. Its anchor is left stale, so the census records it retired.
        "M26 · ⚠️ the held task's project is the caller's default, not the task's · work in `beta` "
        f"refused as *Task #1 in default* — killed by `{WHERE}`",
        [
            (
                HOST,
                "      throw new WorkAlreadyOpen(openWork.taskId, openWork.number, openWork.projectSlug)\n",
                "      throw new WorkAlreadyOpen(openWork.taskId, openWork.number, DEFAULT_PROJECT_ID)\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `that-task-was-already-withdrawn`
        # arm of `WithdrawRefused` is now `{ rail, number }` with no `projectSlug`, so there is no
        # field to set to the default project. The project on refusals went with "Task #N in
        # <project>", and the killer is deleted. Its anchor is left stale, so the census records it
        # retired.
        "M27 · ⚠️ a withdrawn task's project is the default, not the task's — killed by "
        f"`{WHERE}`",
        [
            (
                HOST,
                "            rail: 'that-task-was-already-withdrawn',\n"
                "            number: task.number,\n"
                "            projectSlug: task.projectSlug,\n",
                "            rail: 'that-task-was-already-withdrawn',\n"
                "            number: task.number,\n"
                "            projectSlug: DEFAULT_PROJECT_ID,\n",
            )
        ],
    ),
    # ── E · `707` GAP-2 to GAP-4 ─────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `elsewhere` (the project a receipt
        # carries, `WorkReport.elsewhere` and `MessageSentEvent.elsewhere`) was removed from the
        # types, from the host's receipt and from the renderer. The card line reads "tasks read Task
        # #N", and the killer is deleted. Its anchor is left stale, so the census records it
        # retired.
        f"M28 · 🔴 GAP-2 · the receipt is written without the project it was handed — killed by `{WHERE}`",
        [(HOST, "      ...(taskNumber === null || elsewhere === null ? {} : { elsewhere }),\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The comparison of the giver's project
        # with the receiver's existed only to fill `elsewhere`, and `taskElsewhere`,
        # `projectElsewhere` and `taskCalledFrom` no longer exist. D-016 says "a task reads Task
        # #N", so a receipt never says "in beta". Its anchor is left stale, so the census records it
        # retired.
        "M29 · ⚠️ GAP-2 · the project is compared with the RECEIVER's, whose own it always is — the "
        f"receipt never says *in beta* — killed by `{WHERE}`",
        [
            (
                HOST,
                "            this.deps.store.identityOf(from.caller)?.projectSlug ?? null,\n",
                "            this.deps.store.identityOf(session.id)?.projectSlug ?? null,\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `boundTaskElsewhere` and
        # `MessageSentEvent.elsewhere` are gone from `session-store.ts`; `boundTaskNumber` now
        # bounds only the number and its task id. The killer's §6 test 'a stored `elsewhere` is kept
        # beside a number it places' was removed from `what-the-cards-cannot-say-yet.test.ts` in
        # bd70d693. Its anchor is left stale, so the census records it retired.
        "M30 · ⚠️ GAP-2 · the bound keeps a project with no number to place · a replayed row says "
        f"*in beta* about no task — killed by `{CARDS}`",
        [
            (
                STORE,
                "  if (isAStoredId(event.elsewhere) && event.taskNumber !== undefined) return event\n",
                "  if (isAStoredId(event.elsewhere)) return event\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'bound keeps any stored project'
        # defect needs the `elsewhere` bound, which D-016 deleted along with the field. The test
        # that pinned it (`what-the-cards-cannot-say-yet` §6, the `elsewhere: 'b'.repeat(201)`
        # cases) was deleted, and the number-only bound has its own rows elsewhere (687). Its anchor
        # is left stale, so the census records it retired.
        "M31 · ⚠️ GAP-2 · the bound keeps any stored project · a replayed row's card is handed a "
        f"five-thousand-character project, or a number — killed by `{CARDS}`",
        [
            (
                STORE,
                "  if (isAStoredId(event.elsewhere) && event.taskNumber !== undefined) return event\n",
                "  if (event.taskNumber !== undefined) return event\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `boundTaskNumber` no longer calls
        # `boundTaskElsewhere(boundTheNumberAlone(event))`; the two halves are one function bounding
        # the number alone. There is no second bound to skip, and the surviving number bound is not
        # this row's subject. Its anchor is left stale, so the census records it retired.
        f"M32 · 🔴 GAP-2 · the bound is never asked — killed by `{CARDS}`",
        [
            (
                STORE,
                "  return boundTaskElsewhere(boundTheNumberAlone(event))\n",
                "  return boundTheNumberAlone(event)\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `readersProject` was removed from the
        # Work tab's read (`-      return { ...walked, readersProject: itsOwn?.project_slug ?? null
        # }`) and from every `list_tasks` and `withdraw_task` shape. It existed only so a task from
        # another project could read "Task #N in <project>", which D-016 removed on purpose. Its
        # anchor is left stale, so the census records it retired.
        f"M33 · 🔴 GAP-3 · the Work tab's read never says whose project it is — killed by `{WHERE}`",
        [
            (
                STORE,
                "      return { ...walked, readersProject: itsOwn?.project_slug ?? null }\n",
                "      return { ...walked, readersProject: null }\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `WhoCalledWhom.readersProject` was
        # removed in bd70d693 (`who-called-whom.test.ts` says "`readersProject` (a fact, not a
        # press) went with projects"). Working-together no longer reads a project for the
        # conversation, so there is nothing to drop. Its anchor is left stale, so the census records
        # it retired.
        f"M34 · 🔴 GAP-4 · Working-together's read never says whose project it is — killed by `{WHERE}`",
        [
            (
                HOST,
                "      readersProject: this.deps.store.conversationBinding(sessionId)?.projectSlug ?? null,\n",
                "      readersProject: null,\n",
            )
        ],
    ),
    # ── F · `710`'s own review ───────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The quit door now reads `throw new
        # WorkAlreadyOpen(open.taskId, open.number)`, with no project argument, so 'names the wrong
        # project' cannot be planted. `a-restart-keeps-what-was-open.test.ts` still exists but D-016
        # took the project off the refusal (its line 1203 says so). Its anchor is left stale, so the
        # census records it retired.
        "M35 · ⚠️ the quit's door names the wrong project for the task it holds · a parent re-sending "
        f"work a quit left open is told of Task #N in a project it is not in — killed by `{RESTART}`",
        [
            (
                HOST,
                "      if (open !== null) throw new WorkAlreadyOpen(open.taskId, open.number, open.projectSlug)\n",
                "      if (open !== null) throw new WorkAlreadyOpen(open.taskId, open.number, 'a-project-it-is-not-in')\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The idle receipt's `taskElsewhere`
        # argument no longer exists (grep finds none in `runtime-host.ts`), because no receipt
        # carries a project after D-016. The plant would only replace one argument with `null` in a
        # call that no longer has it, and the killer is deleted. Its anchor is left stale, so the
        # census records it retired.
        f"M36 · 🔴 GAP-2 · the IDLE receipt is handed no project — killed by `{WHERE}`",
        [
            (
                HOST,
                "        null,\n        toProfile,\n        text,\n        taskElsewhere,\n",
                "        null,\n        toProfile,\n        text,\n        null,\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** Same as M36 for the held receipt: the
        # `taskElsewhere` argument was removed with the project spelling, and so was the killer test
        # that pinned it. Its anchor is left stale, so the census records it retired.
        f"M37 · 🔴 GAP-2 · the HELD receipt is handed no project — killed by `{WHERE}`",
        [
            (
                HOST,
                "      id,\n      toProfile,\n      text,\n      taskElsewhere,\n",
                "      id,\n      toProfile,\n      text,\n      null,\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `that-task-was-already-answered`
        # refusal is now `{ rail, number, outcome, documentId, endedAt }` with no `projectSlug`, so
        # the plant's target line no longer exists. Tasks read "Task #N" and the killer is deleted.
        # Its anchor is left stale, so the census records it retired.
        f"M38 · ⚠️ an answered task's project is the default, not the task's — killed by `{WHERE}`",
        [
            (
                HOST,
                "          rail: 'that-task-was-already-answered',\n"
                "          number: task.number,\n"
                "          projectSlug: task.projectSlug,\n",
                "          rail: 'that-task-was-already-answered',\n"
                "          number: task.number,\n"
                "          projectSlug: DEFAULT_PROJECT_ID,\n",
            )
        ],
    ),
    (
        "M39 · 🔴 a person's Reopen reads the errno again · *resume setup failed: spawn … EMFILE* — "
        f"killed by `{RAN_SHORT}`",
        [
            (
                HOST,
                # ⚑ **716 · re-anchored in place, not retired** — `716` folded R52's translation into `aRefusalAPersonReads` with R66's folder and the reopen's words.
                "        throw this.refusalTranslated(this.aRefusalAPersonReads(error, sessionId, true))\n",
                "        throw this.refusalTranslated(error)\n",
            )
        ],
    ),
    (
        "M40 · ⚠️ a Reopen is told to *start it again* · a new conversation, for one that exists — "
        f"killed by `{RAN_SHORT}`",
        [
            (
                HOST,
                # ⚑ **716 · re-anchored in place, not retired** — `716` folded R52's translation into `aRefusalAPersonReads`; the reopen's flag is the same argument.
                "        throw this.refusalTranslated(this.aRefusalAPersonReads(error, sessionId, true))\n",
                "        throw this.refusalTranslated(this.aRefusalAPersonReads(error, sessionId))\n",
            )
        ],
    ),
    (
        "M41 · ⚠️ an `EMFILE` is told to *close an app* · BroBot2's own table, which no other app "
        f"holds any of — killed by `{RAN_SHORT}`",
        [
            (
                UNAVAILABLE,
                "      return context.shortage === 'EMFILE'\n",
                "      return context.shortage === 'a code no shortage has'\n",
            )
        ],
    ),
    (
        f"M42 · ⚠️ the refusal is handed no code · every shortage reads alike — killed by `{RAN_SHORT}`",
        [
            (
                HOST,
                "      { shortage, ...(reopening ? { reopening: true as const } : {}) },\n",
                "      { ...(reopening ? { reopening: true as const } : {}) },\n",
            )
        ],
    ),
    (
        "M43 · 🔴 the model field reads the errno again · *Claude could not be asked what it can run: "
        f"spawnSync security EAGAIN* — killed by `{RAN_SHORT}`",
        [
            (
                HOST,
                # ⚑ **re-anchored in place by `710`'s second review** — the clause grew `EMFILE`'s own
                # words; the row still hands every failure's errno to a person.
                # ⚑ **716 · re-anchored in place, not retired** — `716` gave `howAFailureReads`'s non-shortage arm a folder (R66), so it is a block; the defect is the same: a shortage reads as its errno.
                "    const shortage = transientSetupFailureOf(error)\n    if (shortage === null) {\n",
                "    const shortage = transientSetupFailureOf(error)\n    if (shortage !== 'a code no failure has') {\n",
            )
        ],
    ),
    (
        "M44 · ⚠️ the model field's home step bypasses the clause · the Keychain's errno again — "
        f"killed by `{RAN_SHORT}`",
        [
            (
                HOST,
                "      console.warn(`model list for ${provider} unavailable: ${errorMessage(error)}`)\n"
                "      return { ok: false, reason: 'refused', detail: this.howAFailureReads(error) }\n",
                "      console.warn(`model list for ${provider} unavailable: ${errorMessage(error)}`)\n"
                "      return { ok: false, reason: 'refused', detail: errorMessage(error) }\n",
            )
        ],
    ),
    (
        "M45 · ⚠️ the model field's probe step bypasses the clause · the probe's own spawn errno "
        f"again — killed by `{RAN_SHORT}`",
        [
            (
                HOST,
                "      // 🔴 **710 · review** — a probe the machine ran short for says so, never its errno.\n"
                "      return { ok: false, reason: 'refused', detail: this.howAFailureReads(error) }\n",
                "      // 🔴 **710 · review** — a probe the machine ran short for says so, never its errno.\n"
                "      return { ok: false, reason: 'refused', detail: errorMessage(error) }\n",
            )
        ],
    ),
    (
        "M46 · 🔴 the sign-in check after a failed start shows the errno and the binary's path again "
        f"— killed by `{RAN_SHORT}`",
        [
            (
                CODEX_LOGIN,
                # ⚑ **re-anchored in place by `710`'s second review** — the reason grew `EMFILE`'s own
                # words; the row still lets the errno and the binary's path through.
                "    const shortage = transientSetupFailureOf(error)\n    if (shortage !== null) {\n",
                "    const shortage = transientSetupFailureOf(error)\n    if (shortage === 'a code no shortage has') {\n",
            )
        ],
    ),
    (
        "M47 · 🔴 a Library row's Import prints the errno again · *it could not be imported: spawnSync "
        f"security EAGAIN* — killed by `{IMPORT}`",
        [
            (
                HOST,
                # ⚑ **716 · re-anchored in place, not retired** — `716` tells `howAFailureReads` that Import also READS transcripts (an `open` is not taken for a write there); the defect is the same: the errno is printed.
                "          failure = `it could not be imported: ${this.howAFailureReads(error, true)}`\n",
                "          failure = `it could not be imported: ${errorMessage(error)}`\n",
            )
        ],
    ),
    (
        f"M48 · 🔴 the catch-up sweep prints the errno again in its skipped list — killed by `{IMPORT}`",
        [
            (
                HOST,
                # ⚑ **716 · re-anchored in place, not retired** — `716` tells `howAFailureReads` that the sweep also READS transcripts; the defect is the same: the errno is printed.
                "          reason: `could not be archived: ${this.howAFailureReads(error, true)}`,\n",
                "          reason: `could not be archived: ${errorMessage(error)}`,\n",
            )
        ],
    ),
    (
        "M49 · ⚠️ the clause blames the machine for `EMFILE` · the launch box says BroBot2's own table, "
        f"the model field beside it says the machine — killed by `{RAN_SHORT}`",
        [
            (
                HOST,
                "    return shortage === 'EMFILE'\n      ? 'BroCrew had too many files open'\n",
                "    return shortage === 'a code no shortage has'\n      ? 'BroCrew had too many files open'\n",
            )
        ],
    ),
    (
        "M50 · ⚠️ the sign-in check blames the machine for `EMFILE` — killed by "
        f"`{RAN_SHORT}`",
        [
            (
                CODEX_LOGIN,
                "          shortage === 'EMFILE'\n",
                "          shortage === 'a code no shortage has'\n",
            )
        ],
    ),
    (
        "M51 · 🔴 the turn gate's Keychain read REJECTS on a spawn refused at once · the one outcome "
        f"its *cannot tell* contract rules out — killed by `{KEYCHAIN}`",
        [(AUTH, "    } catch {\n      resolve(null)\n    }\n", "    } catch (error) {\n      throw error\n    }\n")],
    ),
]
