import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  MAX_PASTED_IMAGE_BYTES,
  MAX_PASTED_IMAGE_PIXELS,
  isPastedImageName,
  pastedImageName,
  pastedImageTooBig,
  pastedImageTooManyPixels,
  type DroppedPathVerdict,
  type PastedImage,
} from '../../shared/runtime-ipc'
import { classifyHandedPath } from './handed-path'

/**
 * # ⛔ The one attachment BroBot has to WRITE before it can hand it over (254 §2)
 *
 * ⚠️ **`216`'s standing rule is that BroBot never opens an attached file — it hands the path**, and
 * every gesture until now has honoured it for free: a picker, a drop and a Finder copy all begin
 * with something that already exists. ⛔ **A screenshot on the clipboard has no path**, so there is
 * nothing to hand until somebody writes it down. That is a genuine exception to the rule and the
 * dispatch asks for it to be named as one rather than smuggled in.
 *
 * ## ⛔ What the exception is, exactly — and what it is NOT
 *
 * ⚑ **BroBot reads the CLIPBOARD, never a file.** The bytes come from `clipboard.readImage()` in
 * `main/index.ts` — content the OS is holding because a person pressed ⌘C — and they arrive here as
 * a `Buffer` this module writes once and never reads back. ⛔ **`215` §3.3's authority is the
 * authority to open somebody's FILES**, and nothing here acquires it: `no-byte-authority.test.ts`
 * censuses this module with the rest of the route, its `node:fs` allowlist is now per-file, and the
 * six bindings below are the whole of what this file may do — none returns a file's contents.
 *
 * ⚠️ **And the write is the END of the special case.** What comes out is a path, classified by
 * {@link classifyHandedPath} exactly like a dropped one — same control-character gate, same
 * `realpath`, same outside-the-cwd caption, same send-time re-check. ⛔ **There is no second staging
 * path** (`216`'s `one-way-to-stage.test.ts` is the census that says so): the renderer hands this
 * verdict to `stage()` beside the drop's.
 *
 * ## 🔴 Where the bytes live, and why it is NOT under `userData`
 *
 * ⛔ **The first version of this wrote into `<userData>/pasted-images`, and that made the whole
 * feature dead on Claude.** Two independent reviewers found it over this dispatch's own diff.
 * `main/index.ts` handed the runtime `protectedRoots: () => [userData]`, and `confinement.ts`'s
 * `place()` carved back out exactly two directories — the session's `cwd` and its `providerHome`.
 * A path anywhere else under `userData` placed as **`refused`**, and the Claude adapter's prompt
 * guard denied that read ABOVE the mode check: no card, no chip, in `ask` and in `auto` alike.
 * ⚠️ **Everything else would have worked** — the chip, the file, the classifier, the transcript —
 * and the one thing the gesture exists for, the model seeing the picture, would have been refused
 * by this app's own confinement.
 *
 * ⚑ **`726` · R92 — and that reasoning is history now.** `protectedRoots` and the scan that refused
 * a path under it are gone, so a pasted file would be readable wherever it was written; it stays in
 * a sibling of `userData` because moving it would move every pasted file a conversation still names.
 *
 * ⚠️ **From `262` until `726` the list was `[userData, pastedImagesRoot(userData)]`**: `262` lens D
 * found this very directory readable from another session with no card and put it back under
 * protection, with the pasted FILES granted individually. `726` removed the root and the grants
 * with the rest of the scan.
 *
 * ⚑ **So the directory is a SIBLING of `userData`**, normally outside the conversation's working
 * directory: the message says so, and the provider's own approval mode decides the read — the
 * same standing an attachment picked from anywhere else on the disk has, which is what `215`/`216`
 * chose and what a pasted image ought to have too.
 *
 *  - Keep invented paste files out of the session cwd so they do not appear in the person's `git status`.
 *  - Avoid system temp, which may be swept before an agent reads the file.
 *  - Derive the root from `userData`, so `--user-data-dir` keeps an isolated launch's writes in its own tree instead of the person's default Application Support folder.
 *
 * ## 🔒 Named from its own BYTES, and who deletes it
 *
 * ⛔ **Content-addressed** (the adversarial pass, from three angles). A random name meant ⌘V twice
 * produced two files, two chips reading the identical *"an image you pasted"*, two undos reading the
 * identical sentence, and the same picture quoted to the model twice — with `stage()`'s
 * *"the same path twice is not two attachments"* rule unreachable by construction. ⚑ The digest
 * makes the second paste the SAME path, so the existing dedup collapses it and the disk holds one
 * copy. ⚠️ **No clock and no chosen name**: a timestamp is a fact about somebody's day that would
 * then live in the model's prompt and in the transcript forever.
 *
 *  - **Nothing deletes it during the conversation.** The agent reads the file at its own pace AFTER
 *    the send, and the transcript names the path for as long as the conversation exists — a delete
 *    on send would break the first and lie to the second.
 *  - **Swept by AGE**, at app start AND before each write. ⛔ The second is not decoration:
 *    `window-all-closed` deliberately does not quit, so this app runs for weeks, and a start-only
 *    sweep would have promised a bound it could not keep. ⚠️ **BEFORE the write, not after** — a
 *    sweep that ran afterwards could race the file it had just created.
 *  - ⚠️ **The promise is about AGE, not about the screen** — corrected from an earlier version of
 *    this note, which claimed nothing on screen is ever removed because the sweep ran only before a
 *    window existed. It runs mid-session now, so a chip staged more than a week ago and never
 *    re-pasted CAN be removed while it is visible. ⚑ The send then refuses it by name, which is
 *    `recheckHandedPaths`' ordinary answer for a file that went away, and the right one.
 *  - **What if the message is never sent:** it costs a few megabytes in a directory of BroBot's own
 *    and is gone within {@link PASTED_IMAGE_TTL_MS} of its last use. ⚠️ **Since `744` a draft is
 *    kept across restarts, and a kept draft that names a picture counts as a use at every launch**
 *    (`keepDraftedPastes`, `main/drafts-file.ts`, before the start-up sweep reads the age). A picture
 *    that aged out while nothing kept named it is refused at the send by name, which is
 *    `recheckHandedPaths`' ordinary answer for a file that went away, and the right one.
 *
 * ## 🔴 …and two sentences that used to stand here were FALSE under this module's own concurrency
 *
 * They read: **nothing NEWER than the TTL is ever touched**, and *a re-paste renames a fresh file
 * into place, so an old picture pasted again is not old*. ⛔ **`259` lens D finding 4 took both
 * apart, and the counterexample needs nobody but this app**: the startup sweep is deliberately not
 * awaited, so it can `stat` a digest path as older than the TTL, be descheduled, and have its
 * `unlink` land AFTER a re-paste has atomically renamed a brand-new inode onto that same pathname.
 * ⚠️ **The sweep then deletes the fresh file**, the chip is handed for a path that has already
 * vanished, and the send refuses it — for an image the person pasted seconds ago.
 *
 * ⚑ **A second `stat` before the `unlink` narrows that window and does not close it**, because the
 * replacement is by PATHNAME: whatever is measured, the file that gets removed is whichever inode
 * the name points at when the syscall runs.
 *
 * ⛔ **So every touch of this directory is SERIALIZED** — see {@link onTheRoot}. The startup sweep,
 * and each paste's sweep-then-write as ONE unit, take the queue in turn; a paste that arrives while
 * the startup sweep is still running waits for it rather than racing it. ⚑ The two sentences are
 * true again, and they are true because of the queue rather than in spite of it.
 */

/**
 * ⛔ **One at a time on the paste root** (262 §3) — the queue every public function here goes
 * through.
 *
 * ⚠️ **Process-wide rather than per-root, deliberately.** There is one of these directories per
 * running app; keying by root would add a map, a lifetime and a way for two callers to disagree
 * about which key they meant, to serialize work that is already rare and short. The cost of the
 * broader lock is that a sweep of a temporary root in a test waits behind another one, which is
 * nothing.
 *
 * ⚠️ **The chain may never carry a REJECTION forward.** The queue holds a twin that settles either
 * way; the caller gets the real answer. Without that, one failed write would refuse every paste for
 * the rest of the run — a lock that fails closed on a job it was only supposed to order.
 */
let onTheRootQueue: Promise<unknown> = Promise.resolve()

function onTheRoot<T>(work: () => Promise<T>): Promise<T> {
  const mine = onTheRootQueue.then(work)
  onTheRootQueue = mine.then(
    () => undefined,
    () => undefined,
  )
  return mine
}

/** The directory BroBot writes pasted images into — and the only one {@link sweepPastedImages} touches. */
export const PASTED_IMAGES_DIRNAME = 'pasted-images'

/** The private name a write goes to before it is renamed into place — see {@link writePastedImage}. */
export const PASTED_PART = /^pasted-[0-9a-f]{32}\.png\.[0-9a-f]{12}\.part$/

/**
 * ⛔ **How long an unsent paste survives.**
 *
 * ⚑ A week is chosen against the gesture rather than against the disk: it is longer than any draft
 * anybody comes back to, and short enough that a year of pasting screenshots all day does not
 * quietly become a directory nobody knew about. ⚠️ **Since `744` a draft outlives the run it was
 * typed in** (R100), so the pictures a kept draft names are stamped as used at each launch, just
 * before the start-up sweep reads their age (`keepDraftedPastes`, `main/drafts-file.ts`).
 */
export const PASTED_IMAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * ⛔ **A sibling of `userData`, NAMED AFTER IT** — see this module's own note for why it is not
 * under `userData` (a reason `726` · R92 retired; the location stays so named paths stay true).
 *
 * 🔴 **`join(dirname(userData), 'pasted-images')` was the second version and it would have SHIPPED**
 * (found reviewing the fix for the first one). It is app-owned only by accident of the app's name:
 * `apps/desktop/package.json` is `@brobot2/desktop`, so `dirname` lands inside `@brobot2`. A data
 * folder directly under Application Support — a `--user-data-dir` a person picks, or a name without
 * a scope (`~/Library/Application Support/BroBot2`, as this note once wrongly said the packaged app
 * used; `data-folder.ts` pins every build to `@brobot2/desktop`) — makes `dirname` **Application
 * Support itself**: BroBot would have created a bare `pasted-images` folder among every other app's
 * data and then `readdir`ed and `unlink`ed inside it on every launch. ⚠️ **No test could have seen
 * it**: everything here runs under a `--user-data-dir` whose parent is the run's own tree.
 *
 * ⚑ **`<userData>-pasted-images` cannot go wrong that way.** It is namespaced by construction
 * whatever the app is called, and it still moves with `--user-data-dir`.
 *
 * ⚠️ **`pasted-image.test.ts` is what keeps this honest**: it asserts the NAMESPACING, which is the
 * failure only a packaged build could show.
 */
export function pastedImagesRoot(userData: string): string {
  return join(dirname(userData), `${basename(userData)}-${PASTED_IMAGES_DIRNAME}`)
}

/**
 * ⛔ **The size of the image BroBot actually WROTE, read out of the PNG it just built.**
 *
 * ⚠️ **Not `nativeImage.getSize()`, and that is a correction from the review.** That call answers in
 * DIPs: a Retina screenshot reports `1512 × 982` while `toPNG()` encodes `3024 × 1964`, so the chip
 * — whose whole job is to say something true about a picture whose name is suppressed — would have
 * reported half the real thing. ⚑ The IHDR is the file's own answer, it costs no call, and it cannot
 * disagree with the bytes on disk because it came out of them.
 *
 * @returns the size, or `null` when the buffer is not a PNG at all
 */
export function pngSize(png: Buffer): PastedImage | null {
  // Signature (8) + length (4) + 'IHDR' (4), then width and height as big-endian 32-bit.
  if (png.length < 24) return null
  if (!png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return null
  }
  if (png.toString('ascii', 12, 16) !== 'IHDR') return null
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  return width > 0 && height > 0 ? { width, height, bytes: png.length } : null
}

/**
 * ⛔ **The bound that comes BEFORE the encode** — `null` when the picture may be encoded.
 *
 * ⚠️ **Exported and pure so it is reachable**, because its caller is an `ipcMain.handle` callback in
 * a file no test process can load (`electron`). The handler asks this with the clipboard's own size
 * multiplied by its scale factors, and only then calls `toPNG()`.
 */
export function tooManyPixels(width: number, height: number): string | null {
  return width * height > MAX_PASTED_IMAGE_PIXELS ? pastedImageTooManyPixels(width, height) : null
}

/**
 * ⛔ **Write the clipboard's picture down, then classify the path like any other** (254 §2).
 *
 * ⚠️ **PNG, always.** The clipboard holds a decoded bitmap rather than a file format, so something
 * has to be chosen; PNG is lossless, is what every provider's read tool understands, and is what
 * `nativeImage.toPNG()` hands over without a second encode.
 *
 * ⚠️ **The write ALONE, and the app does not use it** (262 §3) — {@link pastePicture} is the paste
 * handler's door, because the sweep and the write have to be one turn of {@link onTheRoot}. This
 * stays exported because it is the unit `pasted-image.test.ts` exercises directly, and because a
 * sweep-free write is the honest primitive for a caller already holding the queue to compose from.
 *
 * @param root {@link pastedImagesRoot} — the caller owns `userData`, this module owns the folder
 * @param png  the clipboard's image, already encoded
 * @param cwd  the conversation's folder, for the `outside` caption only
 */
export function writePastedImage(
  root: string,
  png: Buffer,
  cwd: string,
): Promise<DroppedPathVerdict> {
  return onTheRoot(() => writeOne(root, png, cwd))
}

/**
 * ⛔ **The paste, as ONE turn of the queue: sweep, then write** (262 §3).
 *
 * ⚠️ **The pair is the unit, not each half.** Two queued calls would leave a window between them
 * for another paste's sweep — a smaller version of the race this exists to close — and the ordering
 * this module promises is *sweep before the write it protects*, which only holds if nothing gets in
 * between.
 *
 * @param now the clock, passed in for the same reason {@link sweepPastedImages} takes it
 */
export function pastePicture(
  root: string,
  png: Buffer,
  cwd: string,
  now: number,
): Promise<DroppedPathVerdict> {
  return onTheRoot(async () => {
    await sweepRoot(root, now, PASTED_IMAGE_TTL_MS)
    return await writeOne(root, png, cwd)
  })
}

/** {@link writePastedImage} without the queue — for callers that are already holding it. */
async function writeOne(root: string, png: Buffer, cwd: string): Promise<DroppedPathVerdict> {
  // ⛔ **The bound is checked BEFORE the directory is made**, so a refused paste leaves nothing
  // behind at all — not an empty folder, and certainly not a partial file somebody could later
  // attach. ⚠️ `length` is the encoded size, which is the number that lands on the disk and the one
  // {@link pastedImageTooBig} quotes.
  if (png.length > MAX_PASTED_IMAGE_BYTES) return { refusal: pastedImageTooBig(png.length) }
  // ⚠️ **An unreadable buffer is a refusal rather than a file.** `nativeImage` answers with nothing
  // for a clipboard holding an image it cannot decode, and a 0-byte `.png` staged as an attachment
  // would spend a whole turn to learn that. ⚑ {@link pngSize} is the same question asked precisely:
  // if there is no header there is no picture, whatever the length says.
  const size = pngSize(png)
  if (size === null) return { refusal: 'that picture could not be read off the clipboard' }
  const path = join(root, pastedImageName(createHash('sha256').update(png).digest('hex')))
  try {
    await mkdir(root, { recursive: true })
    // 🔴 **Written to a private name and RENAMED into place** (found reviewing the fix that made the
    // name a digest). ⚠️ **`writeFile(…, {flag:'wx'})` creates the file at `open` and fills it
    // afterwards**, so a second paste of the same picture — two presses, or two windows — took the
    // `EEXIST` branch while the first was still writing, and handed the agent a path to a partial
    // file. ⛔ **Worse, content addressing made that permanent**: a truncated file left by a crash or
    // a full disk matched every future paste of that screenshot forever.
    //
    // ⚑ **`rename` is atomic**, so the name only ever appears on a COMPLETE file, and the bytes it
    // replaces are identical to the bytes replacing them — the name is their digest. It also makes
    // the mtime *last used* for free: the file that ends up at `path` is the one just written, so
    // re-pasting an old screenshot cannot stage something the sweep is about to remove, and no
    // separate `utimes` (or its own failure mode) is needed.
    const part = `${path}.${randomBytes(6).toString('hex')}.part`
    await writeFile(part, png)
    await rename(part, path)
  } catch (error) {
    return {
      refusal:
        `that picture could not be saved — BroCrew needs to write it down before an agent can ` +
        `read it (${error instanceof Error ? error.message : String(error)})`,
    }
  }
  // ⛔ **The SAME classifier every other gesture ends in** (218's acceptance 7, one gesture further
  // on). It re-derives the canonical path, refuses a control character, and decides the `outside`
  // caption — none of which this module is entitled to answer for itself, however sure it is.
  const verdict = await classifyHandedPath(path, cwd)
  if ('refusal' in verdict) return { refusal: verdict.refusal }
  return { handed: { ...verdict.handed, pasted: size } }
}

/**
 * ⛔ **Delete pasted images older than `ttlMs`** — at app start, and after each write.
 *
 * ⚠️ **It never throws.** A missing directory is the ordinary first-run case, and a file that
 * vanished between the listing and the `stat` is another window doing the same work — neither is a
 * reason to keep an app from starting or to fail a paste. ⚑ What it returns is how many it removed,
 * so a caller can say so rather than guess.
 *
 * ⛔ **Only names {@link isPastedImage} accepts.** Anything else in that directory was not put there
 * by this module and is not this module's to delete — which is what makes the blast radius of a
 * mistaken `root` zero rather than everything in it. ⚠️ `unlink` removes a LINK rather than what it
 * points at, so a planted symlink costs nothing either.
 */
export function sweepPastedImages(
  root: string,
  now: number,
  ttlMs: number = PASTED_IMAGE_TTL_MS,
): Promise<number> {
  return onTheRoot(() => sweepRoot(root, now, ttlMs))
}

/** {@link sweepPastedImages} without the queue — for callers that are already holding it. */
async function sweepRoot(root: string, now: number, ttlMs: number): Promise<number> {
  let swept = 0
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return 0
  }
  for (const name of names) {
    // ⚑ **The half-written temporaries too** — a `.part` left by a crash or a full disk is this
    // module's own litter, matches nothing else, and would otherwise sit there for good.
    if (!isPastedImageName(name) && !PASTED_PART.test(name)) continue
    const path = join(root, name)
    try {
      // ⚠️ **`mtimeMs`, not `birthtimeMs`.** Birth time is not carried by every filesystem this app
      // can be installed on and reads as the epoch where it is missing — which would sweep every
      // file on the first run instead of none. It is also the field a re-paste touches.
      if (now - (await stat(path)).mtimeMs <= ttlMs) continue
      await unlink(path)
      swept += 1
    } catch {
      // Gone already, or not ours to remove. Either way the next file is what matters.
    }
  }
  return swept
}
