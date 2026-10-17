"""706 · what cannot come back is let go — `705` F-3; `702` F-3; the ruling on `702` F-1.

⛔ **Three items, and the first is the one a person hits.** The PM's three:

 * **`705` F-3** — a conversation the quit left open whose Codex thread is gone was never let go:
   the host forgot one only for a CAUSELESS `ResumeError`, and Codex's refusal rides as a cause, so
   every press failed again, forever. ⚑ *"tell a thread the provider no longer has (a never) from a
   transient failure BY WHAT IT IS, not by whether it carries a cause"* — and ⛔ *"a transient failure
   must never make the app forget a conversation."*
 * **`702` F-3** — `exportSession` looked the row up with `find`, so *"Export this conversation"* on a
   Claude conversation before its first turn said *"no recorded session"*.
 * **`702` F-1, ruled** — the tests that run `clean-base` run ONLY inside `pnpm run ci`.

## ⚑ What a row here measures

 * ⚑ **M1 is the host** — it lets go for the adapter's `noSuchSession`, never for a missing cause.
 * ⚑ **M2–M11 are Codex, told by what it is** — the adapter asks at all (M2); the refusal must be the
   app-server's, of `thread/resume`, under its measured code, in one of its two measured sentences,
   about THIS thread (M3, M5–M10); and the disk must agree, with a doubt keeping it (M4, M11).
 * ⚑ **M12–M15 are the other two adapters and the default** — Claude's not-found and the double's
   never-issued and mismatched refs are marked (M12, M13, M15); an unmarked `ResumeError` is never a
   never (M14).
 * ⚑ **M16–M18 are `702` F-3** — the door asks *is it recorded*, and a row with no provider id is
   refused as what it is, per kind.
 * ⚑ **M19–M22, M26 are the ruling** — `ci` still runs the gate-only config (M19, M26), that config
   still reaches the scripts test (M20), and no default project reaches either test (M21, M22).
 * ⚑ **M23–M25 are `verify_row.py`** — a killer only the gate may run is refused WITH its reason, by
   name and by path, and found by name so it can be. ⚠️ Without the new refusal the killer is still
   refused, by `project_of` (*"under no vitest project"*): these rows pin the reason, not the refusal.
 * ⚑ **M27–M29 are the `706` review's** — Claude's probe answers absence only for an absence (M27);
   an archived rollout is still on disk (M28); the gate-only globs are MATCHED, not walked (M29).
 * ⚑ **M30–M34 are its second to fourth rounds'** — Claude's probe asks every project folder, as the
   CLI's own resume does when its first lookup misses (M30); a doubt in one folder neither answers for
   the others (M31) nor is swallowed (M32); a name too long to exist is an absence (M33); and a
   `projects/` it cannot LIST is a doubt, not an empty one (M34).

## ⛔ What this table cannot reach, and what it must never do

 * 🔴 **No row here may make a table run START `clean-base`.** `M21`/`M22` plant the defect — a
   default project's globs reaching into `gate-only/` — with a glob that matches NO file there: a
   replacement that matched `clean-base.test.mjs` would make the run's own `--project scripts` (or
   `desktop`) start the script, the defect performed by the row that pins it (the `706` review).
 * ⚠️ **The rows killed by a test that starts `clean-base`** — none is here: those killers are gate-only
   now, and a seat may not run them (standing rule §6). Every row below is killed by an ordinary test.
 * ⚠️ **A NON-root `ENOENT` in `rolloutsOf`** (a directory vanishing mid-walk) counting as absence is
   not reachable: it is a race no test drives. The root `ENOENT` (a home with no `sessions/`) is the
   no-rollout subject's own path.
 * ⚠️ **The probe's own assertions** (`probe:codex-lost-thread`) — not in `ci`; it re-measures the
   provider, and a changed provider is a red run there, not here.

"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
LOST = "packages/runtime/src/codex/lost-thread.ts"
TRANSPORT = "packages/runtime/src/codex/codex-transport.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
FAKE = "packages/runtime/src/fake-runtime.ts"
RUNTIME = "packages/runtime/src/runtime.ts"
PKG = "package.json"
GATE_CONFIG = "vitest.gate-only.config.ts"
ROOT_CONFIG = "vitest.config.ts"
DESKTOP_CONFIG = "apps/desktop/vitest.config.ts"
VERIFY_ROW = "scripts/mutations/verify_row.py"

KILLER = "a-restart-keeps-what-was-open.test.ts"
ADAPTERS = "a-session-the-provider-no-longer-has.test.ts"
EXPORT = "export-session.test.ts"
GATE = "clean-base-runs-only-in-the-gate.test.mjs"
VERIFIER = "verify-row.test.mjs"

MUTATIONS = [
    # ── A · the host ────────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, PUT BACK · the host lets go only of a CAUSELESS `ResumeError` again, so a "
        f"Codex thread its app-server says is gone stays open and every press fails again · killed by `{KILLER}`",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives in
        # `itCanNeverBeReopened`, which `startForADelivery` and `aPersonsStart` use: the host lets
        # go only of the adapter's `noSuchSession` ResumeError, never on whether a cause is present.
        # The old line is now `if (seen instanceof ResumeError && seen.noSuchSession) return true`.
        # The plant swaps the test for the causeless one. Both the no-rollout arm and the died arm
        # carry a cause, so the first arm is no longer replaced and the died arm is.
        [
            (HOST, 'if (seen instanceof ResumeError && seen.noSuchSession) return true', 'if (seen instanceof ResumeError && seen.cause === undefined) return true'),
        ],
    ),
    # ── B · Codex, told by what it is ───────────────────────────────────────────────────────────
    (
        "M2 · 🔴 the Codex adapter never asks, so no lost thread is ever marked · "
        f"killed by `{ADAPTERS}`",
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — D-039 (17a9220d) hoisted the lost-thread question into a local const, so the old
        # `noSuchSession: codexNoLongerHasTheThread(...)` property line is gone. The rule survives
        # unchanged: the Codex adapter must ask whether the app-server still has the thread and mark
        # the ResumeError. The plant makes the local const `false`, so no lost thread is ever marked
        # and the host never lets go of it. Killed by
        # `a-session-the-provider-no-longer-has.test.ts`.
        [
            (CODEX, '      const noSuchSession = codexNoLongerHasTheThread(error, ref.sessionId, options.providerHome)\n', '      const noSuchSession = false\n'),
        ],
    ),
    (
        "M3 · ⛔ any refusal of `thread/resume` is a thread that is gone — a history it could not load "
        f"for a moment forgets the conversation · killed by `{ADAPTERS}`",
        [(LOST, "  if (!saysTheThreadIsGone(error.refusal, threadId)) return false\n", "")],
    ),
    (
        "M4 · ⛔ the disk is not asked — the provider's words alone forget a conversation whose "
        f"rollout is on disk · killed by `{ADAPTERS}`",
        [(LOST, "  return rolloutsOf(providerHome, threadId) === 'none'\n", "  return true\n")],
    ),
    (
        "M5 · 🔴 the transport's JSON-RPC refusal is a plain `Error` again, so the adapter cannot tell "
        f"the app-server's answer from a child that died · killed by `{ADAPTERS}`",
        [(TRANSPORT, "          waiter.reject(new CodexRequestRefused(waiter.method, message['error']))\n",
          "          waiter.reject(new Error(JSON.stringify(message['error'])))\n")],
    ),
    (
        "M6 · ⛔ a refusal of ANY request counts — the lost-thread words as `initialize`'s answer "
        f"forget the conversation · killed by `{ADAPTERS}`",
        [(LOST, "  if (!(error instanceof CodexRequestRefused) || error.method !== 'thread/resume') return false\n",
          "  if (!(error instanceof CodexRequestRefused)) return false\n")],
    ),
    (
        "M7 · ⚠️ the code is not read — the lost-thread words under a code the app-server never gives "
        f"them count · killed by `{ADAPTERS}`",
        [(LOST, "  if (code !== REFUSED_A_RESUME || typeof message !== 'string') return false\n",
          "  if (typeof message !== 'string') return false\n")],
    ),
    (
        "M8 · ⛔ *\"no rollout found\"* about ANY thread counts — another thread's refusal forgets this "
        f"one · killed by `{ADAPTERS}`",
        [(LOST, "  if (message === `no rollout found for thread id ${threadId}`) return true\n",
          "  if (message.startsWith('no rollout found for thread id ')) return true\n")],
    ),
    (
        "M9 · 🔴 the second measured sentence is not read — a thread whose rollout file was deleted is "
        f"never let go · killed by `{ADAPTERS}`",
        [(LOST, "  return path !== undefined && basename(path).includes(threadId)\n", "  return false\n")],
    ),
    (
        "M10 · ⛔ the rollout-path sentence about ANY file counts — another thread's missing file "
        f"forgets this one · killed by `{ADAPTERS}`",
        [(LOST, "  return path !== undefined && basename(path).includes(threadId)\n",
          "  return path !== undefined\n")],
    ),
    (
        "M11 · ⛔ a tree that could not be READ is read as empty — a doubt forgets the conversation · "
        f"killed by `{ADAPTERS}`",
        [(LOST, "    return 'unknown'\n", "    return 'none'\n")],
    ),
    # ── C · the other adapters, and the default ─────────────────────────────────────────────────
    (
        "M12 · 🔴 Claude's *\"session not found\"* is not marked, so the one never Claude knows is kept "
        f"open for ever · killed by `{ADAPTERS}`",
        [(CLAUDE, "        throw new ResumeError(ref, `session not found: ${ref.sessionId}`, { noSuchSession: true })\n",
          "        throw new ResumeError(ref, `session not found: ${ref.sessionId}`)\n")],
    ),
    (
        "M13 · ⛔ the double's never-issued ref is not marked, so every host test of a never measures a "
        f"conversation kept open · killed by `{ADAPTERS}` · killed by `{KILLER}`",
        [(FAKE, "        `unknown session (never issued by this provider): ${ref.sessionId}`,\n        { noSuchSession: true },\n",
          "        `unknown session (never issued by this provider): ${ref.sessionId}`,\n")],
    ),
    (
        "M14 · 🔴 an unmarked `ResumeError` IS a never — every failure of an attempt forgets the "
        f"conversation · killed by `{ADAPTERS}`",
        [(RUNTIME, "    this.noSuchSession = options?.noSuchSession === true\n",
          "    this.noSuchSession = options?.noSuchSession !== false\n")],
    ),
    (
        "M15 · ⚠️ the double's ref issued under another home is not marked · "
        f"killed by `{ADAPTERS}`",
        [(FAKE, "          `got {cwd:${ref.cwd}, home:${options.providerHome}, rotation:${ref.rotation}}`,\n        { noSuchSession: true },\n",
          "          `got {cwd:${ref.cwd}, home:${options.providerHome}, rotation:${ref.rotation}}`,\n")],
    ),
    # ── D · `702` F-3 — the export ──────────────────────────────────────────────────────────────
    (
        "M16 · 🔴 THE DEFECT, PUT BACK · the export asks `find`, so a conversation its provider never "
        f"named is *\"no recorded session\"* for every kind · killed by `{EXPORT}`",
        [(HOST, "    if (this.deps.store.recordedOne(sessionId) === null) {\n      throw new Error(`no recorded session: ${sessionId}`)\n",
          "    if (this.deps.store.find(sessionId) === null) {\n      throw new Error(`no recorded session: ${sessionId}`)\n")],
    ),
    (
        "M17 · ⛔ the refusal of a provider file or a bundle says *\"no recorded session\"* about a "
        f"recorded conversation · killed by `{EXPORT}`",
        [(HOST, "        'this conversation has no provider id BroCrew can read, so it cannot be written out as a ' +\n",
          "        `no recorded session: ${sessionId} — ` +\n")],
    ),
    (
        "M18 · ⚠️ the two kinds' words are swapped · "
        f"killed by `{EXPORT}`",
        [(HOST, "          (kind === 'native' ? 'provider file' : 'bundle'),\n",
          "          (kind === 'native' ? 'bundle' : 'provider file'),\n")],
    ),
    # ── E · the ruling — `clean-base` runs only inside the gate ─────────────────────────────────
    (
        "M19 · 🔴 `ci` stops running the gate-only tests — the only guard `clean-base` has goes out of "
        f"the gate with nothing saying so · killed by `{GATE}`",
        [(PKG, "pnpm run mutations:check && pnpm run gate-only:check && pnpm run test",
          "pnpm run mutations:check && pnpm run test")],
    ),
    (
        "M20 · ⛔ the gate-only config reaches the ORDINARY scripts tree instead of its own, so the gate "
        f"stops running the scripts `clean-base` test · killed by `{GATE}`",
        [(GATE_CONFIG, "          include: ['gate-only/**/*.test.mjs'],\n",
          "          include: ['test/**/*.test.mjs'],\n")],
    ),
    (
        "M21 · 🔴 the scripts project's globs reach into `gate-only/` again — the widening that makes "
        f"`--project scripts` and a bare `vitest run` start `clean-base` · killed by `{GATE}`",
        # ⛔ **The planted glob reaches INTO `gate-only/` and matches no file there** (the `706` review):
        # `*.test.mjs` would make a table run's own `--project scripts` start `clean-base` — the defect
        # this row pins, performed by the row. The census reads the glob, so this is as red.
        [(ROOT_CONFIG, "          include: ['test/**/*.test.mjs'],\n",
          "          include: ['test/**/*.test.mjs', 'gate-only/**/*.never-a-file.mjs'],\n")],
    ),
    (
        "M22 · 🔴 the desktop project's globs reach into `gate-only/` again — the widening that makes "
        f"`--project desktop` start `clean-base`, `698`'s and `703`'s run · killed by `{GATE}`",
        # ⛔ Matches no file, for `M21`'s reason.
        [(DESKTOP_CONFIG, "    include: ['test/**/*.test.ts'],\n",
          "    include: ['test/**/*.test.ts', 'gate-only/**/*.never-a-file.ts'],\n")],
    ),
    (
        "M23 · ⚠️ a gate-only killer named by FILE NAME is refused without its reason — `project_of`'s "
        f"*under no vitest project* answers instead · killed by `{VERIFIER}`",
        [(VERIFY_ROW, "    return refuse_a_gate_only_killer(found[0])\n", "    return found[0]\n")],
    ),
    (
        "M24 · ⚠️ a gate-only killer named by PATH is refused without its reason, as `M23` · "
        f"killed by `{VERIFIER}`",
        [(VERIFY_ROW, "        return refuse_a_gate_only_killer(named)\n", "        return named\n")],
    ),
    (
        "M25 · ⚠️ a gate-only killer named by file name is not FOUND, so the refusal says *\"names 0 "
        f"test files\"* instead of why · killed by `{VERIFIER}`",
        [(VERIFY_ROW, "        for home in (*TEST_HOMES, *GATE_ONLY_HOMES)\n", "        for home in TEST_HOMES\n")],
    ),
    (
        "M26 · ⛔ `gate-only:check` runs the default config — the gate runs every ordinary test again "
        f"and never the two that start `clean-base` · killed by `{GATE}`",
        [(PKG, '"gate-only:check": "vitest run --config vitest.gate-only.config.ts",',
          '"gate-only:check": "vitest run",')],
    ),
    # ── F · the `706` review's rows ─────────────────────────────────────────────────────────────
    (
        "M27 · 🔴 Claude's probe reads every error as *\"not there\"* again — an unreadable home is a "
        f"never, and the host lets the conversation go · killed by `{ADAPTERS}` · killed by `{KILLER}`",
        # ⚠️ Anchored in `stillThere` — every probe of a folder goes through it. ⚑ The host arm plants
        # the unreadable folder INSIDE a listable `projects/`, so this is the only line keeping it a doubt.
        [(CLAUDE, "    statSync(path)\n    return true\n  } catch (error) {\n    if (isAnAbsence(error)) return false\n    throw error\n",
          "    statSync(path)\n    return true\n  } catch {\n    return false\n")],
    ),
    (
        "M28 · ⚠️ an ARCHIVED rollout is not looked for — the lost-thread words forget a thread "
        f"`thread/unarchive` would bring back · killed by `{ADAPTERS}`",
        [(LOST, "      namesIt(join(home, 'sessions'), true) || namesIt(join(home, 'archived_sessions'), true)\n",
          "      namesIt(join(home, 'sessions'), true)\n")],
    ),
    (
        "M29 · ⛔ the gate-only desktop glob drifts to a name the test does not have — `ci` stays green "
        f"and never runs `a-clean-base-leaves-no-profiles` · killed by `{GATE}`",
        [(GATE_CONFIG, "          include: ['gate-only/**/*.test.ts'],\n",
          "          include: ['gate-only/**/*.spec.ts'],\n")],
    ),
    # ── G · review rounds two and three — Claude's probe asks where the CLI would look ────────────
    (
        "M30 · 🔴 only the folder the working folder names is asked — a symlinked, moved or over-long "
        f"one names a folder Claude never wrote, and a conversation Claude still has is called gone · killed by `{ADAPTERS}`",
        [(CLAUDE, "  if (folders.some(holdsIt)) return true\n", "")],
    ),
    (
        "M31 · ⛔ a doubt in ONE folder answers for all — an unreadable folder asked first fails every "
        f"press for a transcript that is in another · killed by `{ADAPTERS}`",
        [(CLAUDE, "      doubt ??= error\n      return false\n", "      throw error\n")],
    ),
    (
        "M32 · 🔴 a doubt is swallowed — an unreadable folder that could hold it, and none that does, "
        f"is called gone · killed by `{ADAPTERS}`",
        [(CLAUDE, "  if (doubt !== null) throw doubt\n", "")],
    ),
    (
        "M33 · ⚠️ a name too long to exist is a doubt, not an absence — a long working folder whose "
        f"conversation is really gone is never let go · killed by `{ADAPTERS}`",
        [(CLAUDE, "  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENAMETOOLONG'\n",
          "  return code === 'ENOENT' || code === 'ENOTDIR'\n")],
    ),
    (
        "M34 · 🔴 a `projects/` it cannot LIST is read as empty — a transcript in a folder it could not "
        f"see is called gone · killed by `{ADAPTERS}`",
        [(CLAUDE, "    if (!isAnAbsence(error)) throw error\n    folders = []\n", "    folders = []\n")],
    ),
]
