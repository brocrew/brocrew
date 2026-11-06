
/**
 * ⛔ **One thing a person handed the agent — a PATH, never bytes** (216).
 *
 * Hand the agent a path to read with its own tools. BroBot does not read attachment bytes into the turn; access happens through the provider's existing permissions.
 *
 * ⚠️ **Every field is a LABEL, decided by main at choose-time and re-decided at send-time.** A
 * renderer's copy of `kind` or `outsideCwd` is a moment-old caption, never a permission: `main`
 * re-classifies before the turn goes out. See `handed-path.ts`.
 */
export interface HandedPath {
  /** The absolute path, as main resolved it. */
  path: string
  /** What `stat` said it is. The agent reads a file and a folder with different tools. */
  kind: 'file' | 'directory'
  /**
   * 🔒 **Not under this conversation's working directory** — and NOT a refusal.
   *
   * The person chose it, and that is consent. What this buys is that the message SAYS so, rather
   * than the agent's own permission card being the first place anybody notices.
   */
  outsideCwd: boolean
  /**
   * ⛔ **Present when BroBot WROTE this file from the clipboard** (254 §2) — a caption, never a fact
   * about the filesystem, and deliberately NOT on the wire.
   *
   * ⚠️ **A pasted image is the one attachment nobody NAMED.** Every other path in this app came from
   * a person pointing at a thing that already existed; a screenshot on the clipboard has no path at
   * all until BroBot gives it one. ⛔ **So a chip that showed a filename would be attributing a
   * choice the person did not make** — `254` §2 asks for exactly this distinction — and the honest
   * label says what happened instead: *an image you pasted*, and how big it is.
   *
   * ⚑ **The send schema in `ipc.ts` does not carry it, on purpose.** Main re-derives every field of
   * this record from the filesystem and refuses a mismatch (232 §1); a renderer-supplied *"this one
   * is a paste"* would be the one field main could not check, so it would be trust dressed as data.
   * It is a renderer-side caption for a renderer-side surface, and it is dropped at the door — which
   * is why the file is also NAMED `pasted-…` inside a directory called `pasted-images`: the
   * transcript, which shows the whole path, still says what the thing is, from the one fact that
   * does cross (`099`/`064` — the surfaces agree, through the path rather than through a flag).
   */
  pasted?: PastedImage
  /**
   * ⛔ **Present when a draft RESTORED at launch names a path that is no longer there** (744 · R100)
   * — main's caption at the restore, from the one classifier (`handed-path.ts`), and like
   * {@link pasted} deliberately NOT on the wire: the send schema strips it, and
   * `recheckHandedPaths` refuses the path by name if it is still gone when the message is sent.
   *
   * ⚠️ **Shown, never dropped.** A restored message that came back one attachment short with nothing
   * said would be a message the person did not write.
   */
  missing?: true
}

/**
 * ⛔ **What BroBot knows about an image it wrote from the clipboard** (254 §2) — its SIZE, and
 * nothing else.
 *
 * ⚑ **Measurements rather than a name or a time.** A name would be invented (the person named
 * nothing), and a timestamp is a fact about somebody's day that would then live in a chip, a
 * `title` and — through the path — in the model's prompt forever.
 *
 * Include encoded `bytes` because different screenshots can share identical dimensions. Size helps distinguish their chips, while the same picture pasted twice reuses one file and chip.
 */
export interface PastedImage {
  width: number
  height: number
  /** The size of the PNG BroBot wrote, so two same-shaped screenshots read differently. */
  bytes: number
}
