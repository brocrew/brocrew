"""3003 · API keys, including Windows — `5fecec18`, `39862830`, `cb6508c5`.

🔒 **The subject**: a person saves a key for Claude or Codex, and that provider's agents run on it.
`ApiKeys` keeps it sealed and opens it only for a launch; `askTheProvider` checks it with one request
and answers in BroBot's words; `bringTheCodexKeyTo` logs each Codex home in with it through Codex's
own login (`changeCodexKeyInHome`), stamped by WHEN it was saved, one change per home at a time, and
`prepareProviderHome` then copies no login. A Claude launch hands the key over through a fourth pipe
(`39862830`), or on Windows, where the CLI reads no pipe, as `ANTHROPIC_API_KEY` beside
`CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1` (`cb6508c5`, `api-key-handover.ts`); `claudeLoginState`
reports a saved key ahead of the login. ⛔ Every row here is about a code path; no row holds a key,
and the killers use made-up strings only.

## ⚑ What a row here measures

 * ⚑ **M1–M5 are the Claude handover** — the route chosen for the platform the launch was given, the
   Windows switch that keeps the key from what the CLI runs, a key launch that carries nothing else,
   and the key reaching the spawn at all.
 * ⚑ **M6–M7 are what a check reports** — a saved key outranks the login, and one that cannot be
   opened is not quietly swallowed into the login.
 * ⚑ **M8–M9 are the sealed store and the check** — an unreadable key is never "no key", and a failed
   check never quotes what the failure said (the key included).
 * ⚑ **M10–M13 are the Codex home** — the stamp stands only over a login, only a login on the key
   counts, changes to one home queue, and a home on the key copies no login over it.
 * ⚑ **M14 is Codex's own login** — a refusal is answered in BroBot's words, not the provider's.

## ⛔ What this table cannot reach

 * ⚠️ **Refusing a sign-in or a re-copy while a key is saved** (`refuseWhileAKeyIsSaved` in
   `createProviderAuthOps`, `5fecec18`). No test calls `signIn` or `reprovision` with a `codexKey`
   seam; `provider-auth.test.ts` and `a-person-whose-machine-ran-short.test.ts` only stub the ops.
   Same for `bringTheKeyToItsHomes`: stubbed to `null`, never run.
 * ⚠️ **`claudeAuthHealth` with a key** (`39862830`). Its one unit test (`auth.test.ts`) passes no key,
   and the path through `prepareProviderHome` reads the REAL Keychain on macOS
   (`defaultKeychainReader`), so a row that skips the key check is killed or not depending on
   whether the machine running it has a Claude login.
 * ⚠️ **The pipe's `'error'` listener** (`claude-child.ts`). Its test kills the child with `exit 7`, but
   the key is written into the pipe's buffer before the shell exits, so `EPIPE` is a race and the row
   would be flaky.
"""

HANDOVER = "packages/runtime/src/claude/api-key-handover.ts"
CLAUDE_RUNTIME = "packages/runtime/src/claude/claude-runtime.ts"
CLAUDE_CHILD = "packages/runtime/src/claude/claude-child.ts"
AUTH = "packages/runtime/src/internal/auth.ts"
CODEX_LOGIN = "packages/runtime/src/codex/codex-login.ts"
API_KEYS = "apps/desktop/src/main/runtime/api-keys.ts"
HOMES = "apps/desktop/src/main/runtime/provider-homes.ts"

ON_WINDOWS = "an-api-key-the-cli-can-read-on-windows.test.ts"
PIPE = "a-claude-key-goes-through-a-pipe.test.ts"
LOGIN_FACTS = "claude-login-facts.test.ts"
SEALED = "an-api-key-is-sealed-checked-and-stamped.test.ts"
CODEX_HOME = "a-codex-home-is-logged-in-with-the-key.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # 'the decision, per platform' › '🔒 Windows: the key in the environment, with the switch, and no
    # pipe' — on the Mac running the suite, 'win32' would get the pipe.
    (
        "M1 · the route is chosen by the platform BroBot runs on, not the one the launch was given — "
        f"the Windows route is never taken where it is asked for · killed by `{ON_WINDOWS}`",
        [(HANDOVER,
          "  if (platform === 'win32') {\n",
          "  if (process.platform === 'win32') {\n")],
    ),
    # 'the decision, per platform' › '🔒 Windows: …', and 'a launch on Windows' › each of start,
    # resume, models: `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` toBe '1'.
    (
        "M2 · on Windows the key goes into the environment without the host switch — so the CLI "
        f"hands it on to every shell, hook and MCP server it runs · killed by `{ON_WINDOWS}`",
        [(HANDOVER,
          "      env: { ANTHROPIC_API_KEY: apiKey, CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1' },\n",
          "      env: { ANTHROPIC_API_KEY: apiKey },\n")],
    ),
    # 'a launch on Windows' › start/resume/models and 'a launch on the Mac' › start/resume/models:
    # `CLAUDE_CODE_OAUTH_TOKEN` toBeUndefined — the test wires a login beside the key.
    (
        "M3 · a launch on a key also carries the machine login in the CLI's environment — the key "
        f"is not the one thing it runs on · killed by `{ON_WINDOWS}`",
        # ⚑ **The refused-key notice · re-anchored in place, not retired** — the key branch's return
        # also says the launch runs on the key (`onAKey: true`), so a refusal can say which credential
        # it refused. The anchor and the replacement both carry it; what the row plants is unchanged.
        [(CLAUDE_RUNTIME,
          "      return { additions, piped: handover.descriptor, onAKey: true }\n",
          "      const login = this.authTokenProvider?.()\n"
          "      if (login) additions.CLAUDE_CODE_OAUTH_TOKEN = login\n"
          "      return { additions, piped: handover.descriptor, onAKey: true }\n")],
    ),
    # '🔴 the witness hands the key to the spawn it asks for — and hands nothing when it was given
    # none': `asked[0]?.[1]` toBe KEY. (Also 'a launch on the Mac' in the Windows test: spawned
    # toHaveLength(2).)
    (
        "M4 · the witness spawns the CLI without the key — the CLI is told to read descriptor three "
        f"and nobody opened it, so a key launch says Not logged in · killed by `{PIPE}`",
        [(CLAUDE_CHILD,
          "      const spawned = apiKey === undefined ? spawnChild(options) : spawnChild(options, apiKey)\n",
          "      const spawned = spawnChild(options)\n")],
    ),
    # 'a launch on Windows' › '🔒 with no key, the login as before…' stays green; the key arms of
    # 'a launch on Windows' fail: `ANTHROPIC_API_KEY` and the switch are never in the env.
    (
        "M5 · the handover's variables are never added to the launch's environment — on Windows the "
        "key never reaches the CLI, on the Mac the CLI is never told which descriptor to read · "
        f"killed by `{ON_WINDOWS}`",
        [(CLAUDE_RUNTIME,
          "      Object.assign(additions, handover.env)\n",
          "      void handover.env\n")],
    ),
    # 'claudeLoginState' › '🔴 a saved key is what runs: it outranks the login, does not expire, and
    # the keychain is never read' — answers `login: 'account'`, and the reader is called.
    (
        "M6 · a check reads the login first and reports the key only when there is none — the "
        f"Providers screen says the login while launches run on the key · killed by `{LOGIN_FACTS}`",
        # ⚑ Re-anchored in place: the key's branch is a block now (it says what lies behind the key on
        # Windows); the plant still answers the login first and the key only when there is none.
        [(AUTH,
          "  if (apiKey?.()) {\n",
          "  const first = claudeLoginFacts(reader(), clock())\n"
          "  if (first !== null) {\n"
          "    return { state: 'usable', login: 'account', expiresAt: first.expiresAt }\n"
          "  }\n"
          "  if (apiKey?.()) {\n")],
    ),
    # 'claudeLoginState' › '⛔ a key provider that throws is not swallowed: the caller says it in its
    # own words' — toThrow('cannot open') gets a usable login instead.
    (
        "M7 · a saved key that cannot be opened is swallowed and the check falls back to the login "
        f"the person put aside · killed by `{LOGIN_FACTS}`",
        # ⚑ Re-anchored in place: the key's branch is a block now; the plant still swallows a key
        # that cannot be opened.
        [(AUTH,
          "  if (apiKey?.()) {\n",
          "  let key: string | null = null\n"
          "  try {\n"
          "    key = apiKey?.() ?? null\n"
          "  } catch {\n"
          "    key = null\n"
          "  }\n"
          "  if (key) {\n")],
    ),
    # 'ApiKeys' › '🔴 a saved key this Mac cannot open is not in use, and a launch is told so in words
    # that hold no key' — `lost.read('claude')` toThrow(ApiKeyUnreadableError).
    (
        "M8 · a saved key the Keychain can no longer open reads as no key — every launch quietly "
        f"falls back to the login · killed by `{SEALED}`",
        [(API_KEYS,
          # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. held: running it needs W4's written lift. bbf9cc20d moved unsealing to current's bounded async read. Replace only its unreadable-key throw with the same null outcome; the cast preserves the inner promise type.
          "        if (this.stillCurrent(provider, kept, change))\n          this.readability.set(provider, { ...kept, unreadableReason: error.message })\n        throw error\n",
          "        if (this.stillCurrent(provider, kept, change))\n          this.readability.set(provider, { ...kept, unreadableReason: error.message })\n        return null as unknown as OpenKey\n")],
    ),
    # 'askTheProvider' › '🔴 a connection that fails says it could not reach the provider — and not
    # what the failure said': `not.toContain(KEY)`, `not.toContain('ENOTFOUND')`.
    (
        "M9 · a check that cannot reach the provider quotes the failure — and whatever it carried, "
        f"the key included · killed by `{SEALED}`",
        [(API_KEYS,
          # ⚑ **a check that spends a token · re-anchored in place, not retired** — the check's could-not-reach answer is one value now, returned from the catch; the row still puts the failure's own words in it
          "  } catch {\n    return unreachable\n  }\n  if (!succeeded(listed.status))",
          "  } catch (error) {\n    return { ...unreachable, reason: `${unreachable.reason} (${String(error)})` }\n  }\n  if (!succeeded(listed.status))")],
    ),
    # 'bringTheCodexKeyTo' › '⛔ the stamp stands only while the home still holds a login: a stamp
    # over no auth.json logs in again' — changes toHaveBeenCalledTimes(2) gets 1.
    (
        "M10 · the stamp is trusted over a home whose auth.json is gone — the home runs on nothing "
        f"and is never logged in again · killed by `{SEALED}`",
        [(HOMES,
          "    if (stamp === current.setAt && existsSync(join(home, 'auth.json'))) return 'the-key'\n",
          "    if (stamp === current.setAt) return 'the-key'\n")],
    ),
    # 'bringTheCodexKeyTo' › '⛔ a login that fails refuses in BroBot’s words and stamps nothing —
    # never a quiet fallback' — the `chatgpt` arm resolves instead of throwing 'did not take the API key'.
    (
        "M11 · any login Codex reports counts as the key — a home left on a ChatGPT sign-in is "
        f"stamped as running on the key · killed by `{SEALED}`",
        [(HOMES,
          "    if (done.authMethod !== 'apikey') {\n",
          "    if (done.authMethod === null) {\n")],
    ),
    # 'bringTheCodexKeyTo' › '🔴 changes to ONE home run one at a time, in the order they were asked
    # — and a failure does not block the next': order toEqual(['start sk-1']) sees the second start.
    (
        "M12 · changes to one Codex home no longer wait for each other — an older login can land "
        f"after a newer one's stamp · killed by `{SEALED}`",
        [(HOMES,
          "  const mine = before.catch(() => undefined).then(() => bringTheCodexKeyToNow(home, codexKey))\n",
          "  const mine = bringTheCodexKeyToNow(home, codexKey)\n")],
    ),
    # 'prepareProviderHome with a key' › '🔴 a Codex home logged in with the key copies no login, and
    # returns at once' — `copied` not.toHaveBeenCalled.
    (
        "M13 · a Codex home logged in with the key still has the machine's login copied over it — "
        f"the key is put aside the moment it is set · killed by `{SEALED}`",
        [(HOMES,
          "      (await bringTheCodexKeyTo(home, seams.codexKey)) === 'the-key'\n"
          "    ) {\n"
          "      return home\n"
          "    }\n",
          "      (await bringTheCodexKeyTo(home, seams.codexKey)) === 'the-key'\n"
          "    ) {\n"
          "      // the key is in; the copied login is laid down beside it\n"
          "    }\n")],
    ),
    # 'changeCodexKeyInHome' › '⛔ a login Codex refuses is answered in BroBot’s words — never the
    # provider’s, never the key — and nothing is asked after it': toEqual the bare sentence, and
    # `not.toContain(KEY)`.
    (
        "M14 · a login or logout Codex refuses is answered with the provider's own words — which a "
        f"rejection can carry the key in · killed by `{CODEX_HOME}`",
        [(CODEX_LOGIN,
          "    } catch {\n"
          "      return { ok: false, reason: `Codex would not ${what}.` }\n",
          "    } catch (error) {\n"
          "      return { ok: false, reason: `Codex would not ${what}: ${String(error)}` }\n")],
    ),
]
