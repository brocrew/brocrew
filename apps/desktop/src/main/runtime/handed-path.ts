import { lstat, realpath, stat } from 'node:fs/promises'
import { isTheSameFile, type FileIdentity } from '@brobot2/runtime'
import { expandHome } from './scratch-cwd'
import { isAbsolute, relative, sep, win32 } from 'node:path'
import {
  CONTROL_CHARACTER_IN_PATH,
  MAX_HANDED_PATHS,
  MAX_PATH_CHARS,
  hasControlCharacter,
  quotedLiteral,
  type DroppedPathVerdict,
  type HandedPath,
} from '../../shared/runtime-ipc'

/**
 * # ⛔ A path a person handed the agent — and the rule that BroBot never opens it (216)
 *
 * Hand the agent a path to read with its own tools. BroBot does not read and encode attachment bytes, so this stays within the provider's existing text-turn contract.
 *
 * ⛔ **So this module STATS and never READS**, and that is written down as a rule rather than left
 * as a coincidence: `no-byte-authority.test.ts` is a census over this file and the two that call it,
 * and it fails on `readFileSync`, `readFile`, `createReadStream`, `read`, `readSync` and the rest.
 * ⚠️ **Somebody later "improving" this by loading the bytes in main would silently acquire the
 * authority `215` §3.3 priced, and nothing else in the app would notice.** That is what the census
 * exists to stop.
 *
 * ## ⛔ A staged chip is a RECORD OF CONSENT, not a cache (232)
 *
 * `227` found two HIGHs on this boundary and they are the same mistake made twice: a staged path
 * treated as a STRING. ⚑ **A person looked at a thing and agreed to hand it to a model**, so two
 * properties have to hold that a string does not have:
 *
 *  - **it must still be the same thing at the send** — {@link recheckHandedPaths} COMPARES rather
 *    than merely re-deriving, because re-asking the filesystem and then taking whatever it says is
 *    silent re-consent to whatever replaced it;
 *  - **it must reach the model as itself** — {@link messageWithHandedPaths} quotes, because a legal
 *    filename could otherwise write BroBot's own sentences.
 *
 * ## ⛔ Nothing here blocks the main process (232 §3, from 231)
 *
 * ⚠️ **Every filesystem call in this module is ASYNCHRONOUS, and that is a rule rather than a
 * style.** `runFlush` re-checks a queued message's paths with nobody at the keyboard; the synchronous
 * `realpathSync`/`statSync` it used to reach through would park Electron's entire main process on a
 * stalled network mount — no window, no menu, no quit, and no gesture that could have caused it.
 * ⚑ **One classifier, made async, rather than an async twin**: `197` is the dispatch about what two
 * classifiers for one fact cost, and a second one that exists only to be non-blocking would be that
 * defect with a good excuse.
 *
 * ## What this may decide, and what it may not
 *
 * ⚑ **`realResolve` is a CLASSIFIER** (`183`, `190`, `197`), and `215` §3.3 says
 * plainly they are *"not an attachment policy"*. Neither is this. It answers three questions a
 * person is entitled to have answered BEFORE they press Send (`106`, `118`, `169`):
 *
 *  - **does it exist**, so the refusal happens at the picker rather than after the send;
 *  - **is it a file or a directory**, because the agent will read them with different tools;
 *  - **is it outside this conversation's working directory**, because the agent's own permission
 *    card should not be the first time anybody notices.
 *
 * 🔒 **Outside the cwd is NOT refused.** The person chose it, and that is consent — `215`'s whole
 * point is that the read happens through the agent's tool, under the provider's own approval mode
 * (`ask` / `auto`), and BroBot adds no folder rule of its own (`726` · R92). What this does is make
 * sure the message SAYS so.
 */

/** Why a chosen path cannot be handed over, or `null` when it can. */
export type PathRefusal = string | null

/**
 * ⛔ **A refusal, and whether the thing is still THERE** (232, found reviewing this diff).
 *
 * ⚠️ **`recheckHandedPaths` used to glue *"it was there when you attached it, so it has been moved
 * or deleted since"* onto EVERY refusal the classifier could return**, and only one of them is a
 * disappearance. A staged file replaced by a fifo, a socket or a device is refused with *"that is
 * not a file or a folder"* — and was then told it had been moved or deleted, about a name something
 * is demonstrably sitting at. ⛔ **That is the sentence this dispatch's own §1 forbids**, arriving
 * through the one replacement `consentChanged` cannot see: `kind` is `file | directory`, so a file
 * that became a fifo never reaches the comparison.
 *
 * ⚑ **A flag rather than a second classifier** (`197`): the two questions are answered by the same
 * `stat` and there is no second opinion to disagree with.
 */
type PathVerdictRefusal = { refusal: string; gone: boolean }

/**
 * ⚠️ **A symlink is followed, and then BOTH ends are checked** (`170`, `190`).
 *
 * `lstat` first says whether the thing chosen is itself a link; `realpath` then says what it points
 * at. A dangling link is refused by name rather than by `ENOENT` on the target, because *"that file
 * no longer exists"* is a different sentence from *"that shortcut points nowhere"* and the second is
 * the one that tells a person what to fix.
 */
async function describeKind(
  path: string,
): Promise<{ kind: 'file' | 'directory'; real: string } | PathVerdictRefusal> {
  let real: string
  try {
    real = await realpath(path)
  } catch {
    // A link whose target is gone — `lstat` succeeds and `realpath` does not, which is exactly how
    // the two calls tell those apart.
    try {
      if ((await lstat(path)).isSymbolicLink()) {
        return {
          refusal: `that is a shortcut pointing at something that is not there: ${path}`,
          gone: true,
        }
      }
    } catch {
      /* falls through to the plain "not there" sentence, which is the right one */
    }
    return { refusal: `there is nothing at ${path}`, gone: true }
  }
  let stats
  try {
    stats = await stat(real)
  } catch {
    return { refusal: `there is nothing at ${path}`, gone: true }
  }
  if (stats.isDirectory()) return { kind: 'directory', real }
  // ⛔ **Regular files only.** A socket, a fifo or a device is something an agent's `Read` cannot
  // make sense of, and handing one over would spend a turn to learn that. `183`/`190` refuse the
  // same shapes for the same reason.
  if (!stats.isFile()) {
    // ⚠️ **`gone: false`, and it is load-bearing** (232, found reviewing this diff). Something IS at
    // that name — it is simply not something an agent can read — so {@link recheckHandedPaths} must
    // not tell the person it was moved or deleted. ⛔ **This is the THIRD replacement outcome**, and
    // it is the one {@link consentChanged} can never see: `kind` is `file | directory`, so a staged
    // file replaced by a fifo never reaches the comparison at all.
    return {
      refusal: `that is not a file or a folder — BroCrew can only hand over something readable: ${path}`,
      gone: false,
    }
  }
  return { kind: 'file', real }
}

/**
 * Is `target` inside `cwd`? — a LABEL, never a permission.
 *
 * ⛔ **`target` is the ALREADY-RESOLVED thing, and that is 232 §3's MEDIUM 1** (from `227`). This
 * used to take the path as SPELLED and `realpath` it a second time, so the string handed to the
 * model came from one observation of the filesystem and the label describing it came from another.
 * ⚠️ **Two observations can disagree**: a same-uid process retargeting `/repo/swap` between them
 * paired an OUTSIDE target with an INSIDE label — the exact failure `216` §2 names, arriving through
 * a race rather than through a bug in the comparison. ⚑ One `realpath` of the target now, in
 * {@link describeKind}, and its answer is what both the message and this decision are about.
 *
 * ⚠️ **The cwd is still resolved here**, and that is not the same hazard: a session's cwd is fixed
 * for its whole life and the launcher's is what the person is currently typing, so there is no
 * earlier observation of it for this one to disagree with.
 *
 * ⚑ **An unknown cwd counts as OUTSIDE.** A conversation whose directory we cannot resolve is one
 * where we cannot claim containment, and the honest default is the sentence that says less.
 *
 * ⛔ **A step is compared as PATH SEGMENTS, not as a substring** (234 §4, from `227` LOW 1). It read
 * `step.startsWith('..')`, and `..prefix` is a legal directory name: `/repo/..prefix/notes.md`
 * relativises to `..prefix/notes.md`, which that test accepts, so the chip said **outside** about a
 * file plainly inside the working directory. ⚠️ **A label that is wrong in the SAFE direction is
 * still wrong** — `216` §2 made this mark the one thing a person can check the handover against, and
 * one that cries wolf on ordinary names teaches people to stop reading it. ⚑ The separator is the
 * fix: `..` exactly, or `..` followed by the platform's separator, and nothing else.
 */
export async function outsideWorkingDirectory(target: string, cwd: string): Promise<boolean> {
  if (cwd.trim() === '') return true
  // ⛔ **`~` is expanded first** (217, found in review). The launcher hands its folder field over as
  // TYPED, and main's own cwd rule is `resolve(expandHome(trimmed))` — so without this a
  // `~/dev/thing` folder made `realpath` throw, the honest-default `catch` below answered
  // "outside", and every chip claimed a file was outside a directory it was plainly inside. ⚑ A
  // no-op for a session's cwd, which main resolved before it ever got here.
  const home = expandHome(cwd.trim())
  let here: string
  try {
    here = await realpath(home)
  } catch {
    return true
  }
  const step = relative(here, target)
  if (step === '') return false
  // Different roots — a UNC share, another drive — and there is no step from one to the other.
  if (isAbsolute(step)) return true
  return step === '..' || step.startsWith(`..${sep}`)
}

/**
 * ⛔ **Classify a chosen path, at CHOOSE-TIME** — `{ handed }` or `{ refusal }`, never a throw.
 *
 * A refusal is an ordinary thing that happens to a person picking a file, and it belongs on the
 * surface that asked rather than in a stack trace. `076` §3's cwd picker settled this shape for the
 * folder chooser and `214`'s bundle picker followed it; this is the third.
 */
export async function classifyHandedPath(
  chosen: string,
  cwd: string,
): Promise<{ handed: HandedPath } | PathVerdictRefusal> {
  // ⛔ **A control character is refused BEFORE anything else looks at the path** (232 §2, from `227`
  // HIGH 2). {@link hasControlCharacter} carries the reasoning; what belongs here is the ORDER.
  //
  // ⚠️ **This is the FIRST gate, and it has to be** (found reviewing this diff — it was written
  // SECOND, below the absoluteness refusal). Every refusal below it interpolates the path into a
  // sentence a person reads, and `app:hand-dropped-paths` applies no schema — so a forged or
  // replayed drop payload carrying a relative, control-bearing string put its bytes verbatim into
  // the composer's refusal line, through the one door the send commands' zod does not guard.
  // ⚑ The invariant is worth stating because everything below rests on it: past this line, a path
  // in this module is control-free — which is also why this is the one refusal that does NOT name
  // the path it is about.
  if (hasControlCharacter(chosen)) return { refusal: CONTROL_CHARACTER_IN_PATH, gone: false }
  // ⛔ **A relative path is REFUSED, not resolved** (found in review). It used to `resolve(chosen)`,
  // and single-argument `resolve` bases on the MAIN PROCESS's own `process.cwd()` — never on
  // `session.cwd`, the one directory this whole feature is framed around. ⚠️ A renderer sending
  // `".env"` therefore got `<wherever the app was launched>/.env` classified, labelled and
  // disclosed to the agent as *"attached by the user"* — a file no picker returned and nobody
  // chose. 🔒 Main resolves paths; it does not invent them.
  if (!isAbsolute(chosen)) {
    return {
      refusal: `that is not a full path, so there is no saying what it points at: ${chosen}`,
      gone: false,
    }
  }
  const path = chosen
  const kind = await describeKind(path)
  if ('refusal' in kind) return kind
  // ⛔ **The RESOLVED path is asked the same question** (found reviewing this diff). The gate above
  // examined the SPELLING; `realpath` answers with the TARGET's name, and a symlink called
  // `report.txt` may point at a legal POSIX filename with a newline in it. ⚠️ **So the invariant
  // above was false by one hop**: the picker accepted such a path, its bytes reached the chip's
  // label and its `title`, and the wire then refused a chip the person had already been shown.
  if (hasControlCharacter(kind.real)) return { refusal: CONTROL_CHARACTER_IN_PATH, gone: false }
  // ⛔ **The path is the RESOLVED one, not the one the gesture happened to spell** (221 §5).
  //
  // ⚠️ **`220` staged one folder twice — `/tmp/…/folder-drop` by drop, `/private/tmp/…/folder-drop`
  // by picker — and got two chips with the same visible label, both sent to the model as two
  // attachments.** `PromptComposer.stage` deduplicates on `path` and was right to; it had two
  // strings for one directory. This is the same `/tmp` vs `/private/tmp` family that broke live
  // assertions in `176`, `178` and `179` after `170`'s whole subject was path resolution.
  //
  // ⚑ **The resolution was already happening and was being thrown away.** {@link describeKind} calls
  // `realpath` to decide file-vs-directory, and its answer is now the ONE observation everything
  // else here is about — see {@link outsideWorkingDirectory}.
  //
  // ⚠️ **The bound is checked on what was CHOSEN and the answer is what was resolved** (found
  // reviewing this diff). A short symlink standing in front of a very deep path could in principle
  // hand back a string longer than {@link MAX_PATH_CHARS}, which the wire would then refuse with a
  // zod message — the class `221` §3 is about. It is out of reach rather than guarded: `realpath`
  // cannot return more than `PATH_MAX`, which is 1,024 on this platform against a ceiling of 4,096.
  //
  // ⚠️ **Deliberately not `packages/runtime`'s `realResolve`** (the ticket asks why): that function
  // exists for a path that does not exist YET — a `Write` target — where it climbs to the deepest
  // existing ancestor, and it is internal to that package. Nothing reaches this line unless
  // `describeKind` has already stat'd the thing, so the two answers are identical here by
  // construction, and the one already in hand costs no second `realpath` and no new export.
  return {
    handed: {
      path: kind.real,
      kind: kind.kind,
      outsideCwd: await outsideWorkingDirectory(kind.real, cwd),
    },
  }
}

/**
 * ⛔ **Say the captions again for paths already chosen** (217 §2) — bounded, and never a refusal.
 *
 * ⚠️ **The launcher's folder can move after a file is attached to it**, which a live conversation
 * never has to deal with: a session's cwd is fixed the moment it starts. Choose a file, then choose
 * a different folder, and the chip's `outside` mark answers a question nobody is asking any more.
 *
 * ⛔ **A path that has since VANISHED is DROPPED, not refused.** This is a caption pass over
 * something already chosen, not a gesture anybody is waiting on — an error about a file the person
 * has not touched would be noise. {@link recheckHandedPaths} still refuses it by name at the send,
 * which is where a refusal belongs.
 *
 * ⚑ **Bounded HERE rather than at the IPC handler**, so the bound is reachable by a test: the
 * handler in `main/index.ts` is an `ipcMain.handle` callback that nothing can call directly, and a
 * rule the mutation table cannot reach is a rule nobody is checking (`216` M55's lesson, and 217's
 * own table found this row surviving).
 */
export async function captionHandedPaths(
  handed: readonly HandedPath[],
  cwd: string,
): Promise<HandedPath[]> {
  const kept: HandedPath[] = []
  for (const each of handed.slice(0, MAX_HANDED_PATHS)) {
    if (typeof each?.path !== 'string' || each.path === '') continue
    if (each.path.length > MAX_PATH_CHARS) continue
    const verdict = await classifyHandedPath(each.path, cwd)
    // ⛔ **A path that cannot be classified KEEPS its old caption — it is not dropped** (review).
    // Dropping it removed it from the staged list, so it never reached `recheckHandedPaths` at the
    // send and was never refused: the compensating control this function's own note appealed to
    // could not fire, and a file that went away while the launcher sat open vanished from the chip
    // strip silently. ⚑ One entry out per entry in, so the answer still corresponds to the request.
    //
    // 🔴 **ONLY the caption is refreshed — never the IDENTITY** (232 §1, found reviewing this diff,
    // by three reviewers independently). ⛔ **This line used to push `verdict.handed` whole**, whose
    // `path` is a fresh `realpath` and whose `kind` is a fresh `stat` — so the one pass that exists
    // to re-answer *"is it outside this folder?"* silently re-baselined the record consent is
    // measured against. ⚠️ **That re-opened `227` HIGH 1 through the launcher's own door**: the
    // debounced re-caption (`217` §2) between the swap and the press laundered the replacement into
    // the staged list, `recheckHandedPaths` then compared it against itself, and the target nobody
    // chose went to the provider as *"attached by the user"*. ⚑ **The comparison is
    // {@link consentChanged}**, not a second rule written here — the same question the send asks.
    const fresh = 'handed' in verdict ? verdict.handed : null
    kept.push(
      fresh !== null && (await consentChanged(each, fresh)) === null
        ? { ...each, outsideCwd: fresh.outsideCwd }
        : { ...each },
    )
  }
  return kept
}

/**
 * What a person is told when they drop more than one message can carry (232 §3, from `227`
 * MEDIUM 5).
 *
 * ⚑ **Deliberately a different sentence from the composer's ceiling refusal**, which says *"the rest
 * were not added"*. That one is about a staged list that is already full; this one is about a batch
 * main declined to look at, and it says *not looked at* rather than *not added* because that is
 * exactly what happened — nothing here stat'd them, so nothing here knows whether they were files.
 */
export function tooManyDropped(overflow: number): string {
  return (
    `BroCrew looks at ${MAX_HANDED_PATHS} at a time — ${overflow} more ` +
    `${overflow === 1 ? 'was' : 'were'} not looked at`
  )
}

/**
 * ⛔ **Classify paths that arrived by DROP** (218 §2) — the picker's rule, over a list.
 *
 * ⚑ **This is acceptance 7 in one line: it calls {@link classifyHandedPath} and decides nothing
 * itself.** The dialog and the drop are two GESTURES that end in one rule. A drop that classified
 * itself — in the renderer, or here with its own `stat` — would be a second opinion about what a
 * path is, and `197` spent a whole dispatch on the two that already existed.
 *
 * ⛔ **A folder is ONE path** (§3). Nothing here enumerates, expands or counts what is inside a
 * directory: `describeKind` answers `directory` and that is the end of it. The agent has its own
 * tools for looking inside, and `215`'s whole choice was to let it use them.
 *
 * ⚠️ **Every entry gets an answer**, refusals included, so the reply corresponds to the request —
 * the caller shows one sentence per thing that could not be taken. What is dropped SILENTLY is only
 * what could never have been a path: a non-string, an empty string, or something past the ceiling.
 *
 * ⛔ **…and the CEILING says so too** (232 §3, from `227` MEDIUM 5). It used to `slice` and stop:
 * drop eleven files on an empty composer and ten chips appeared, the eleventh gone with no verdict,
 * no sentence and nothing on screen that had changed. ⚠️ **The composer's own ceiling refusal could
 * not fire either** — it counts ACCEPTED verdicts against the remaining slots, and the eleventh
 * produced no verdict to count. ⚑ `106`: a cap is fine, a silent cap is not. The bound on the WORK
 * is unchanged — nothing past the tenth is stat'd — and the trailing sentence costs one subtraction.
 */
export async function classifyDroppedPaths(
  paths: readonly unknown[],
  cwd: string,
): Promise<DroppedPathVerdict[]> {
  const verdicts: DroppedPathVerdict[] = []
  for (const each of paths.slice(0, MAX_HANDED_PATHS)) {
    if (typeof each !== 'string' || each === '') continue
    if (each.length > MAX_PATH_CHARS) continue
    const verdict = await classifyHandedPath(each, cwd)
    // ⚑ **`gone` does not cross the wire** (232, review). It is the tail {@link recheckHandedPaths}
    // picks its sentence with, and {@link DroppedPathVerdict} is two cases and no third field —
    // the picker in `main/index.ts` narrows the same way, at the same boundary, for the same
    // reason: what the renderer receives is what the type says it receives.
    verdicts.push('handed' in verdict ? verdict : { refusal: verdict.refusal })
  }
  // ⚠️ **LAST, so a real path's own refusal wins the one slot on screen** — the same ordering
  // `onDrop` gives its pathless sentence, and for the same reason: the specific thing that went
  // wrong is what a person can act on.
  const overflow = paths.length - MAX_HANDED_PATHS
  if (overflow > 0) verdicts.push({ refusal: tooManyDropped(overflow) })
  return verdicts
}

/**
 * ⛔ **What the person agreed to hand over, as a comparable fact** (232 §1).
 *
 * ## Why this pair and not the other candidates
 *
 * ⚑ **Consent is over the OBJECT — what it is and where it lives — because those are the two things
 * the chip showed and the two the model is told about.** The dispatch asks which of `path`, `kind`,
 * `outsideCwd` and `dev`/`ino` make up identity, and the answer is the first two:
 *
 *  - **the canonical path.** This is the one that carries the attack: `/repo/report.txt` replaced by
 *    a symlink to `~/.ssh/id_rsa` resolves to a different target, and every other field can be left
 *    untouched while it happens.
 *  - **`kind`.** A file that became a folder is a different thing to read, with a different tool,
 *    and the agent is told which. It is also the case existing coverage called ACCEPTABLE.
 *
 * ⛔ **`outsideCwd` is deliberately NOT here, and this is the subtle one.** It is not a property of
 * the thing chosen; it is a property of the RELATION between that thing and a folder which, on the
 * launcher, is still being decided. `217` §2 built a debounced re-caption for exactly that — attach
 * a file, then choose the folder — so a staged copy is legitimately a fifth of a second behind the
 * cwd it is about. ⚠️ **Comparing it would refuse the person who attached before choosing**, which
 * is the order the re-caption exists to support. And it costs nothing: for a LIVE session the cwd is
 * fixed for its whole life, so with the target pinned the label cannot move under it — the one thing
 * that could is a mutable cwd symlink, which is `227` MEDIUM 2 and its own dispatch (§4). The label
 * is still re-derived and it is the fresh one that is SENT; it is only not a reason to refuse.
 *
 * ⛔ **`dev`/`ino` were considered and REJECTED, for two reasons that both stand alone.**
 *
 *  1. ⚠️ **It would bind an object nothing ever opens.** `215`'s whole mechanism is that the AGENT
 *     reads the path later, with its own tools, BY NAME. An inode pinned at send time says nothing
 *     about what that name resolves to a minute afterwards, so the precision would be false —
 *     reassurance about a binding this app does not hold.
 *  2. ⚠️ **It would refuse the commonest thing that happens to a staged file.** Most editors save by
 *     writing a temporary file and renaming it over the target; the inode changes and NOTHING the
 *     person agreed to has. A queued message would be abandoned because somebody pressed ⌘S.
 *
 * ## What is compared against what — and why the renderer's copy is the right basis
 *
 * ⚠️ **`ipc.ts` says a renderer's `kind`/`outsideCwd` are *"accepted for shape and then thrown
 * away"*, and that stays true of what is SENT.** The distinction this rests on: the renderer's copy
 * is not evidence about the FILESYSTEM — main re-derives that — it is evidence about the SCREEN, the
 * caption main itself wrote and the person then looked at. ⛔ **And the comparison is fail-closed in
 * one direction only**: a mismatch can REFUSE and can never authorise, because the values that go on
 * the wire are always the freshly derived ones. A renderer that lies gets a refusal; a renderer that
 * tells the truth changes nothing.
 */
/**
 * Whether the path a person attached still names what it resolves to now, with nothing put in
 * between. On macOS and Linux a resolved path spelled differently went through a link, so only the
 * same spelling is the same thing. On Windows one file has several spellings — its short name
 * (`RUNNER~1`) and any letter case — so another spelling is the same thing only when, folder by
 * folder from the drive down, each part of the attached path is the very object the resolved path
 * names at that depth (the same volume and file number, compared exactly) and none of them is a link
 * or a junction. A spelling that names a stream (`notes.txt:hidden`) or a device or extended path
 * (`\\?\`, `\\.\`) is never another spelling.
 */
export async function namesTheSameThing(
  attached: string,
  resolved: string,
  platform: NodeJS.Platform = process.platform,
  lstatOf: (path: string) => Promise<FileIdentity & { isSymbolicLink(): boolean }> = (path) =>
    lstat(path, { bigint: true }),
): Promise<boolean> {
  if (attached === resolved) return true
  if (platform !== 'win32') return false
  const theirs = partsOf(attached)
  const ours = partsOf(resolved)
  if (theirs === null || ours === null || theirs.names.length !== ours.names.length) return false
  let one = theirs.root
  let other = ours.root
  for (let at = 0; ; at += 1) {
    try {
      const [mine, real] = await Promise.all([lstatOf(one), lstatOf(other)])
      if (mine.isSymbolicLink() || real.isSymbolicLink()) return false
      // A number of 0 is a disk that keeps none: nothing can be told by it.
      if (mine.ino === 0n || !isTheSameFile(mine, real)) return false
    } catch {
      return false
    }
    if (at === theirs.names.length) return true
    one = win32.join(one, theirs.names[at]!)
    other = win32.join(other, ours.names[at]!)
  }
}

/**
 * A Windows path's root (a drive or a share) and the names under it; `null` for a device or
 * extended path, or one that names a stream.
 */
function partsOf(path: string): { root: string; names: string[] } | null {
  if (/^[\\/]{2}[?.][\\/]/.test(path)) return null
  const normal = win32.normalize(path)
  const root = win32.parse(normal).root
  if (root === '') return null
  const names = normal
    .slice(root.length)
    .split('\\')
    .filter((name) => name !== '')
  return names.some((name) => name.includes(':')) ? null : { root, names }
}

async function consentChanged(was: HandedPath, now: HandedPath): Promise<string | null> {
  if (!(await namesTheSameThing(was.path, now.path))) {
    return (
      `that is not what you attached any more: ${was.path} now leads to ${now.path} — nothing was ` +
      'sent, attach it again if that is what you meant'
    )
  }
  if (was.kind !== now.kind) {
    const before = was.kind === 'directory' ? 'folder' : 'file'
    const after = now.kind === 'directory' ? 'folder' : 'file'
    return `what you attached as a ${before} is a ${after} now: ${was.path} — nothing was sent`
  }
  return null
}

/**
 * ⛔ **Is this still true?** — re-run at SEND time, because choosing and sending are two moments.
 *
 * §3 asks what happens to a path that vanishes between the two, and this is the answer: the send is
 * refused, by name, and the message the person typed is still in the box. ⚠️ **Refusing here rather
 * than sending anyway is the `106`/`118` reading**: we know before the turn is spent, and a path the
 * agent will fail to read is worth more as a sentence now than as a failed tool call in a minute.
 *
 * ⚑ **It re-classifies rather than trusting what the renderer carried back.** The renderer's copy is
 * a label from a moment ago; this is main asking the filesystem again, which is also what stops a
 * renderer-supplied `kind` or `outsideCwd` from being taken on trust.
 *
 * ## ⛔ …and then it COMPARES, which is 232 §1 (from `227` HIGH 1)
 *
 * ⚠️ **Re-deriving and then taking the new answer is silent re-consent.** The reasoning above is
 * right and it stopped one step short: main asked the filesystem again and never asked whether the
 * answer had CHANGED. cwd `/repo`, the person stages the ordinary file `/repo/report.txt`, and
 * before the press — or during a queued wait that can be minutes long — another same-uid process
 * replaces it with a symlink to `~/.ssh/id_rsa`. The old code re-classified, got a perfectly valid
 * answer, and told the provider that file was *"attached by the user"*. ⛔ **A pure move or delete
 * was always refused; it was the valid REPLACEMENT that walked through.**
 *
 * ⚑ **This makes `216` §3's ruling safe rather than reversing it.** That ruling says the caption a
 * person is looking at is from choose-time. It is only a safe thing to show if what is on disk at
 * send-time still matches it — otherwise the caption is a promise the send quietly breaks.
 *
 * ⛔ **The refusal names WHAT CHANGED and is not the moved-or-deleted sentence**, which would be
 * false: the file is right there. See {@link consentChanged}.
 */
export async function recheckHandedPaths(
  handed: readonly HandedPath[],
  cwd: string,
): Promise<{ paths: HandedPath[] } | { refusal: string }> {
  const paths: HandedPath[] = []
  for (const each of handed) {
    const now = await classifyHandedPath(each.path, cwd)
    if ('refusal' in now) {
      // ⛔ **The tail is decided by whether the thing is still THERE** (232, found reviewing this
      // diff). This used to glue *"moved or deleted"* onto every refusal the classifier can return,
      // and only one of them is a disappearance — so a staged file replaced by a fifo, a socket or
      // a device was refused with a sentence saying it had gone, about a name something is
      // demonstrably sitting at. ⚠️ **That is the third replacement outcome and the one
      // {@link consentChanged} can never see**, because `kind` is `file | directory`; it has to name
      // what changed here or nowhere.
      return {
        refusal: now.gone
          ? `${now.refusal} — it was there when you attached it, so it has been moved or deleted since`
          : `${now.refusal} — it was a ${each.kind === 'directory' ? 'folder' : 'file'} when you attached it, so what is at that name now is something else`,
      }
    }
    const changed = await consentChanged(each, now.handed)
    if (changed !== null) return { refusal: changed }
    // ⛔ **Deduplicated on the canonical path, AFTER the re-check** (232 §1; `221` §5 did the same at
    // staging). ⚠️ **The composer already dedupes and the wire is not the composer's to trust**: a
    // forged or replayed command can carry one path twice, and two identical rows would tell the
    // agent to read the same file twice and make the transcript claim two attachments where the
    // person made one. ⚑ It is reachable only that way — a duplicate arising on DISK would have had
    // to change one of the two entries first, and {@link consentChanged} refuses before this line.
    if (paths.some((kept) => kept.path === now.handed.path)) continue
    paths.push(now.handed)
  }
  return { paths }
}

/**
 * ⛔ **What goes into the message, and it is the ONLY thing that does** (216 §1).
 *
 * Measured at the pin: a Codex `mention` contributes zero content items to the model request, and
 * Claude's SDK has no local-path block at all. ⚑ **Plain text is not merely the cheap option — it is
 * the only form that reaches the model**, so the path travels as words.
 *
 * ⚠️ **Prefixed and labelled, never silently concatenated.** `214` removed 12,646 messages that
 * rendered injected material as the person's own; gluing a bare path onto the end of somebody's
 * sentence is that defect arriving from the other end. The block says who put it there and what it
 * is, so a model reading the turn and a person reading the transcript get the same story.
 *
 * ⛔ **It says "outside" out loud.** `215`'s mechanism puts the read behind the agent's own card;
 * this makes sure the card is not the first place anybody learns the path is somewhere else.
 *
 * ## ⛔ The path is QUOTED, because a filename could otherwise write these sentences (232 §2)
 *
 * ⚠️ **This used to interpolate the path RAW into a newline-delimited block**, and a pathname may
 * contain any byte but `NUL` and `/`. One real selection, entirely inside the cwd, became two
 * BroBot-authored records — the second naming a file nobody chose (`227` HIGH 2). ⛔ **And even with
 * no control character at all the block was ambiguous** (`227` MEDIUM 3): a file genuinely named
 * `report (outside this conversation's working directory)` serialised identically to an outside file
 * named `report`, so the model could recover neither the pathname nor the containment.
 *
 * ⚑ **`JSON.stringify`, not a hand-rolled escaper.** It is total — `"` and `\` escaped, every
 * control character escaped, no exceptions to remember — it is LOSSLESS, so the model can recover the
 * exact pathname, and it is the one quoting convention every model already reads. ⛔ **The suffix now
 * sits outside the quotes**, so no filename can forge it, and the block cannot be extended by its own
 * content: producing a second `- file: "…"` record would need an unescaped `"`, and there is no such
 * thing on this side of `JSON.stringify`.
 *
 * ⚠️ **The quoting is total on its own**, deliberately, even though {@link classifyHandedPath}
 * already refuses control characters before a path can reach here. Two rules for one attack, because
 * they fail differently: the refusal removes the class, and this survives a caller that never went
 * through the classifier.
 *
 * ⛔ **U+2028 and U+2029 are escaped BY HAND, because `JSON.stringify` leaves them** (found reviewing
 * this diff). ⚠️ **The first version of this note argued they were harmless — *"a forged record needs
 * a `\"` this function would escape"* — and that reasoning is unsound.** It assumes the model reads
 * the block as quoted strings; the block's own grammar teaches it to read LINES, and U+2028 is a
 * line separator to plenty of things that read text. A planted directory tree whose components spell
 * `a<U+2028>- file: <somewhere else><U+2028>b` needs no quote at all. ⚑ **Two characters, one
 * `replace` each, and the argument stops needing to be right.**
 *
 * ⚑ **The three lines that did that are now {@link quotedLiteral}, shared** (251 §2). The registry
 * above the composer renders a COMMAND the model wrote, which is the same problem — arbitrary text
 * on a line whose structure a reader trusts — and 251's dispatch refuses a second escaping rule for
 * it. Moving the HOW leaves the WHEN here: a handed path is quoted unconditionally, for the reason
 * the paragraph above gives, and the registry quotes only what would otherwise mislead.
 */
export function messageWithHandedPaths(text: string, handed: readonly HandedPath[]): string {
  if (handed.length === 0) return text
  const lines = handed.map((each) => {
    const what = each.kind === 'directory' ? 'folder' : 'file'
    const where = each.outsideCwd ? ' (outside this conversation’s working directory)' : ''
    return `- ${what}: ${quotedLiteral(each.path)}${where}`
  })
  const block = ['Attached by the user, for you to read with your own tools:', ...lines].join('\n')
  return text.trim() === '' ? block : `${text}\n\n${block}`
}
