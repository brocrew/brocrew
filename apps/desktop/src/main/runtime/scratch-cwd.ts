import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { CwdVerdict } from '../../shared/runtime-ipc'
import { ensureWorkspace } from './workspace'

/**
 * Where a session runs. A session cwd is chosen at creation and never re-derived later: the chosen
 * path is recorded on the session row, so a resume reopens the SAME directory.
 *
 * 🔴 **This module's fallback is the durable BroBot workspace (006)** — and since D-016 there is no
 * other: a conversation a person starts without naming a folder runs there, and a spawned one
 * starts in its parent's folder unless it names one. ⛔ **The line that stood here until 371 —
 * *"never a real work repository"* — stays withdrawn**: `364` measured that the launcher's own
 * folder field could be pointed at one, and a spawn may name any folder that exists.
 *
 * ⚑ **`362` §3's rule, with its bound**: the app may write provider-home leaves and the one reserved
 * workspace it derives from `userData`, and it writes nothing INSIDE a user's cwd.
 */

/**
 * Expand a leading `~` so a hand-typed home-relative path works from the dev screen.
 *
 * ⛔ **Exported since 217**, because the LAUNCHER hands its folder field to `classifyHandedPath`
 * verbatim and a `~/…` folder made every attachment read *"outside"* a directory it was plainly
 * inside — `realpathSync('~/dev/x')` throws and the honest-default `catch` says outside. One
 * expansion rule, used wherever a hand-typed folder is compared against anything.
 */
export function expandHome(path: string): string {
  if (path === '~') return homedir()
  return path.startsWith(`~/`) ? join(homedir(), path.slice(2)) : path
}

/**
 * Resolve the working directory for a session. An explicit path must already
 * exist and be a directory — the app never creates a directory the user only
 * mistyped. An omitted (or blank) path yields the durable BroBot workspace.
 *
 * ⚠️ The last sentence said *"a fresh `<userData>/scratch/<sessionId>`"* until 339. 006 replaced
 * that with the shared workspace and the body says so at length; only the summary was left behind.
 */
export function resolveSessionCwd(userData: string, sessionId: string, requested?: string): string {
  if (requested === undefined || requested.trim() === '') {
    // The durable BroBot workspace, not a per-session scratch dir (006). Continuity comes from
    // conversations SHARING a directory: work left behind is still there next time. A per-session
    // scratch dir threw that away the moment the conversation ended.
    //
    // `sessionId` is still taken because an explicit request may yet want a per-session path.
    void sessionId
    return ensureWorkspace(userData)
  }
  const verdict = checkSessionCwd(requested)
  if (!verdict.ok) throw new Error(verdict.reason)
  return verdict.path
}

/**
 * The same question, answered rather than thrown (076): **may this directory be a session's cwd,
 * and if not, why not.**
 *
 * ⚠️ **This exists so the folder picker and the launch cannot disagree.** 076 §3 asks for the
 * refusals to be readable *at choose-time* instead of arriving as a failure at launch — and the
 * tempting way to do that is a second check in the picker, phrased for a human. That is the shape of
 * defect this project keeps paying for: two statements of one rule, the friendlier one drifting, and
 * the drift landing in a security check (071's, here until `726`). So the picker calls THIS, and
 * {@link resolveSessionCwd} is a thin `throw` on top of it. There is one rule and one wording.
 *
 * `reason` is the message a user reads. That is why the refusals name the path and say what is
 * wrong with it instead of merely refusing.
 *
 * ⚠️ **{@link CwdVerdict} is declared on the WIRE now and re-exported here** (203). The launcher
 * asks this question about a typed path over IPC, so the answer is a wire type; declaring it twice
 * is the drift this function's whole comment is about.
 *
 * ⛔ **Every door that takes a folder asks THIS** — the folder picker, the launcher's typed path, a
 * spawn's `folder` and every launch ({@link resolveSessionCwd}) — and the predicate is the same term
 * for term at each: it must exist, it must be a directory, and it must be enterable. One rule, one
 * wording; 169 §1 is the whole argument.
 *
 * Do not refuse a cwd merely because it is inside app data. The former credential scan is absent, and folder eligibility no longer depends on that location.
 *
 * ⚑ **What differs is the CALLER's fallback, not the predicate.** A session with no requested path
 * gets the durable workspace ({@link resolveSessionCwd}); a spawn that names none starts in its
 * parent's folder. That is a decision about an absent value and belongs where the absence is
 * interpreted, not inside a function that is only ever handed a path.
 *
 * ⚠️ **The spelling this returns is the one that gets STORED** — {@link cwdSpelling}, the user's own
 * path made absolute, never its `realpath`. The session row records exactly this, for
 * `instructions.ts`'s stated reason: *"a user who typed a path must see the path they typed"*.
 */
export type { CwdVerdict }

export function checkSessionCwd(requested: string): CwdVerdict {
  const trimmed = requested.trim()
  if (trimmed === '') return { ok: false, reason: 'choose a folder' }
  const cwd = cwdSpelling(trimmed)
  let isDirectory: boolean
  try {
    isDirectory = statSync(cwd).isDirectory()
  } catch {
    return { ok: false, reason: `cwd does not exist: ${cwd}` }
  }
  if (!isDirectory) return { ok: false, reason: `cwd is not a directory: ${cwd}` }
  // ⛔ **A directory that exists is not a directory a child can be started in** (339, HO-005
  // criterion 11, from 303 C). `statSync` needs search permission on the PARENT and says nothing
  // about the directory itself, so this function returned `ok` for a folder no process could enter —
  // and the failure then arrived from the provider, in the provider's words. Measured on macOS 25.3,
  // uid 501, this tree:
  //
  //   | mode | `statSync().isDirectory()` | `X_OK` | `R_OK` | `spawn({ cwd })` |
  //   |------|---------------------------|--------|--------|------------------|
  //   | 000  | true                      | EACCES | EACCES | **EACCES**       |
  //   | 111  | true                      | ok     | EACCES | **exit 0**       |
  //   | 444  | true                      | EACCES | ok     | **EACCES**       |
  //
  // ⚠️ **`X_OK` and not `R_OK`, and the 111 row is why.** Search permission is the bit `chdir` needs;
  // a directory a session can enter but not list is unusual and it WORKS, so asking for readability
  // would refuse a folder that runs. ⚑ And the 444 row is the one that makes this more than
  // pedantry: `r--` looks readable to a person and fails at spawn.
  //
  // 🔴 **What 303 C measured is the cost of not asking.** With the directory gone, Codex reported
  // `ENOENT` **naming the executable** and Claude returned a healthy-looking resumed handle and then
  // fatalled about a **libc mismatch** — and Node does the same thing here, reporting
  // `spawnSync <path-to-node> EACCES`, which names the binary about a fault in the folder. Neither
  // error names the cause, and a user reading either looks in the wrong place entirely.
  //
  // ⚠️ **This is a race and is meant to be.** The answer is true when it is given; 170 §3's rule is
  // that a cwd which resolves is not a cwd that stays, so this is asked again wherever the directory
  // is about to be used rather than trusted from a row. ⚠️ **724 · a REOPEN does not ask it first**:
  // it asks {@link folderIsGone} once its spawn has failed (`717` F-2), so a reopen that works is
  // never refused by a check. (Since `705` Claude refuses a gone folder at the resume, with Node's
  // errno, rather than handing back a healthy-looking handle as 303 C measured.)
  try {
    accessSync(cwd, constants.X_OK)
  } catch {
    return {
      ok: false,
      reason: `cwd cannot be opened: ${cwd} — it exists, but BroCrew is not allowed into it, so nothing could run there`,
    }
  }
  return { ok: true, path: cwd }
}

/**
 * 🔴 **724 · `717` F-2 — the folder a conversation ran in is no longer there** — asked AFTER a
 * reopen's spawn failed, never before (`RuntimeHost.aFolderThatIsGoneAsARefusal`).
 *
 * ⚑ **Why a reopen needs its own question**: a start asks {@link checkSessionCwd} before it spawns;
 * a reopen spawns in the folder its row recorded, and a folder that went since meets Node's
 * *"spawn <program> ENOENT"* — which names the PROGRAM (303 C, above; `717` F-2 measured it on the
 * Resume a person pressed). ⛔ **Only the kernel's absence is *gone*** — `ENOENT` — and a folder that
 * answers, or refuses to be looked at, is not. ⚠️ A path through a FILE is not asked here: its spawn
 * fails `ENOTDIR`, never `ENOENT`, so the caller never gets this far (`724`'s review; recorded).
 */
export function folderIsGone(cwd: string): boolean {
  try {
    statSync(cwd)
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
  }
}

/**
 * 🔴 **The ONE normalisation every cwd rule uses, and it touches no disk** (371).
 *
 * ⛔ **One spelling rule for every place a folder is compared or stored** — a second one would let
 * two callers disagree about `'  /work  '`, which `trim` makes legal here and a bare `resolve`
 * would turn into a relative path under `process.cwd()`. 169 §1, one layer down.
 *
 * ⚠️ **`resolve`, and deliberately NOT `realpath`** — the spelling this returns is the one that gets
 * STORED, and `checkSessionCwd`'s own comment says why: *"a user who typed a path must see the path
 * they typed"*. The real spelling is a separate question, asked by {@link filesystemSpelling} at the
 * moment a rule needs the filesystem's own answer.
 */
export function cwdSpelling(requested: string): string {
  return resolve(expandHome(requested.trim()))
}

/*
 * A child may start in any existing folder it can enter; it need not stay inside its parent's working directory.
 */

/**
 * **The path the filesystem agrees with, exported for the caller that needs the real spelling
 * before it reads** (371) — the resources reader, placing a kept file inside its own tree
 * (`resources/resources.ts`).
 *
 * ⚠️ **It answers the path itself when nothing is there to resolve**, which is {@link real}'s
 * honest default.
 *
 * ⛔ **Not called `realPathOf`, because `read-text-file.ts` already exports one** and it answers a
 * different shape about a different question. Two functions of one name reaching one file is how a
 * reader comes to believe a call did the other thing — `runtime-host.ts` imports both.
 */
export function filesystemSpelling(path: string): string {
  return real(path)
}

/*
 * ⚑ **`726` · R92 — `appDataReason`, `insideRoot` and `within` were here** (071, 489). They refused
 * a cwd, or a project folder, inside the app's own data or its pasted-images store — the other
 * half of the Claude scan R92 removed. `assertNotPersonalProviderHome` went the same way in 160, for
 * the reason R92 now makes general: *"Brobot like any other Codex or Claude Code CLI … should have
 * access to all folders."*
 */

/**
 * The path the filesystem agrees with, or the path itself when nothing is there to resolve.
 *
 * 🔴 **`realpathSync.native`** (371): both spellings resolve symlinks; only the native one
 * canonicalises CASE. Measured on this machine's APFS volume, uid 501, with `<tmp>/Root/pkg` on
 * disk:
 *
 *   | asked for          | `realpathSync`      | `realpathSync.native` |
 *   |--------------------|---------------------|-----------------------|
 *   | `<tmp>/root/pkg`   | `…/root/pkg`        | **`…/Root/pkg`**      |
 *
 * ⛔ **So the plain one hands back the caller's own case**, and a comparison against a real
 * spelling then answers *not inside* for a directory APFS says is the same one. (It was a hole in
 * the cwd wall `726` removed; it still matters to the documents writer's own placement.)
 */
function real(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}
