import type { FileChange } from '../file-change'

/**
 * 181 · **Which files a `fileChange` approval is actually about.**
 *
 * ## The problem this exists for
 *
 * `FileChangeRequestApprovalParams` is `{threadId, turnId, itemId, startedAtMs, reason?, grantRoot?}`
 * — measured against the vendored protocol and confirmed on the wire. It carries **no paths**, so a
 * card built from the approval alone can only say `apply_patch · file`, which is what the app has
 * been showing: a request to write your disk, with the one fact that matters missing.
 *
 * ## What was measured, and why this is not reasoning from the types
 *
 * `pnpm run probe:file-approval-paths`, two runs, four file approvals, every incoming frame teed and
 * numbered. The `fileChange` item's `item/started` arrives **two frames before** the approval
 * request, under the same `itemId`, already carrying its `changes`:
 *
 * ```
 * #34     item/started · exec-a736…  · changes[1]: add /tmp/…/written.txt
 * #35     thread/status/changed
 * #36 REQ item/fileChange/requestApproval · exec-a736…
 * ```
 *
 * Both shapes behaved identically (an `add` and an `update`), and `item/fileChange/patchUpdated` —
 * the notification 092 designed the Changes pane on — arrived **zero** times, exactly as 096
 * measured across 458,200 frames. That is why the correlation is built on the ITEM and not on that
 * notification, and why the notification is still read here: if it ever does arrive it is the
 * richer source, and three lines is a cheap way to not have to find out the hard way.
 *
 * ## ⛔ …and for one dispatch that correlation was `itemId` ALONE (184, from 182 H3)
 *
 * The wire declares **three** identities on every frame that can teach this tracker anything —
 * `threadId`, `turnId`, `itemId`, all three required on `ItemStartedNotification`,
 * `ItemCompletedNotification` and `FileChangePatchUpdatedNotification` — and
 * `FileChangeRequestApprovalParams` declares the same three. 181 kept one of them, and **nothing in
 * the generated protocol or in any comment promises an item id is unique beyond its turn.**
 *
 * ⛔ **So a stale entry could name the wrong file with `underDisclosed: false` beside it.** The
 * active item reports a dangerous target; a later, foreign or simply older frame reuses that id and
 * reports a benign one; the card reads the benign entry and claims full disclosure while doing it.
 * ⚑ 086's rule — *never imply a state we cannot back* — and worse than the `apply_patch · file` 181
 * replaced, because that at least said it knew nothing.
 *
 * **The key is now all three, and it is MEASURED rather than assumed.** `probe:file-approval-paths`,
 * extended for this dispatch to tee both ids on every frame — **three runs, 383 frames (97 + 121 +
 * 165), six file approvals**, and in every one the `item/started` that named the paths declared
 * **the same `threadId` and the same `turnId`** as the approval that followed it two frames later.
 * Every `item/*` frame in all three captures carried both; the only frames without them were
 * `thread/started`, `account/rateLimits/updated` and `remoteControl/status/changed`, none of which
 * this tracker reads. ⚠️ **A key that misses would silently return the card to `apply_patch ·
 * file`**, so it was not a thing to reason about.
 *
 * ## What it deliberately does not do
 *
 * It **never invents a path.** An item nobody told us about answers `[]`, and the caller's disclosure
 * stays under-disclosed — which is the state the Changes tab has been reporting all along
 * (*"they arrive on the change item, not on the approval. We will not invent a path or a count."*).
 * The measurement says that case is not the common one; it does not say it cannot happen.
 *
 * ⛔ **And an unkeyable frame teaches it nothing at all.** A frame that does not declare BOTH a
 * thread and a turn cannot be correlated to an approval — every approval declares both, or
 * `serverRequestScopeProblem` refuses it before a card exists — so recording it would be recording
 * something no lookup can ever match, under a key we made up. Dropping it costs a disclosure we
 * could not have made honestly anyway.
 */
export interface PatchTarget {
  /** The path as the provider reported it — absolute in every captured frame. Never invented. */
  readonly path: string
  /**
   * What the patch will do to it, in the SAME words the Changes pane uses for a file.
   *
   * One vocabulary rather than two: a card that says `modified` beside a pane that says `modified`
   * is one fact stated twice, and a card that said `update` would be a second dialect for a reader
   * to learn. `touched` is the honest fallback for a `PatchChangeKind` we cannot read — see
   * {@link FileChange.status}, where it already means "the agent wrote this file, and we were not
   * told how".
   */
  readonly status: FileChange['status']
  /** Where a renamed file came from (Codex's `move_path` case). Present only for `renamed`. */
  readonly oldPath?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown, key: string): string {
  if (isRecord(value) && typeof value[key] === 'string') return value[key]
  return ''
}

/**
 * ⛔ **The three identities a file-change frame declares, as ONE key** (184).
 *
 * ⚠️ **Injective by construction, and it has to be**, because all three parts are opaque provider
 * strings that may contain any character including the separator. Length-prefixing the first two
 * makes the decoding unambiguous — read `n`, take `n` characters, and what remains after the last
 * `|` is the item id — so two different triples can never spell one key and one triple can never
 * spell two. ⚑ **Exactly 045's argument for {@link requestKey}**, where `String(id)` collapsing
 * numeric `1` and string `"1"` hung a real request; the lesson is that a composite key is only a
 * key if it round-trips.
 */
function identityKey(threadId: string, turnId: string, itemId: string): string {
  return `${threadId.length}:${threadId}|${turnId.length}:${turnId}|${itemId}`
}

/**
 * The key a frame is about, or `null` when it did not declare enough to be correlated.
 *
 * ⚠️ **One reader for both ends.** The recording side and the approval side call this with their own
 * params, so the key that goes in and the key that comes out cannot be spelled by two pieces of code
 * that drift apart — which is the failure 184 is fixing, one level up.
 */
function keyOf(params: unknown, itemId: string): string | null {
  const threadId = readString(params, 'threadId')
  const turnId = readString(params, 'turnId')
  if (!threadId || !turnId || !itemId) return null
  return identityKey(threadId, turnId, itemId)
}

/**
 * One `FileUpdateChange` → one target, or `null` when it carries no usable path.
 *
 * ⚠️ **A change with no path is dropped rather than rendered as a blank line.** The card's whole job
 * here is to name a file; a row that names nothing is the defect wearing a bullet point.
 */
function targetOf(change: unknown): PatchTarget | null {
  if (!isRecord(change)) return null
  const path = change['path']
  if (typeof path !== 'string' || !path) return null
  const kind = change['kind']
  const type = isRecord(kind) ? kind['type'] : undefined
  if (type === 'add') return { path, status: 'added' }
  if (type === 'delete') return { path, status: 'deleted' }
  if (type === 'update') {
    // `move_path` is where the file ENDS UP, so it becomes the row's path and the old one becomes
    // `oldPath` — the same convention `parseUnifiedDiff` uses, so a rename reads the same in the
    // card and in the pane.
    const movePath = isRecord(kind) ? kind['move_path'] : undefined
    return typeof movePath === 'string' && movePath
      ? { path: movePath, status: 'renamed', oldPath: path }
      : { path, status: 'modified' }
  }
  // An unrecognized (or absent) kind: the file is named, what happens to it is not claimed.
  return { path, status: 'touched' }
}

/** The targets a frame carries for a file change, or `[]` when it carries none. */
function targetsIn(changes: unknown): PatchTarget[] {
  if (!Array.isArray(changes)) return []
  const targets: PatchTarget[] = []
  for (const change of changes) {
    const target = targetOf(change)
    if (target) targets.push(target)
  }
  return targets
}

/**
 * The files each in-flight `fileChange` item says it will touch, keyed by **thread, turn and item**.
 *
 * A small tracker handed the wire facts, exactly like Claude's {@link FileEdits} on the other side —
 * the adapter reads the provider's item shape in ONE place, and the approval path asks a question
 * rather than parsing a notification it never saw.
 */
export class PatchTargets {
  private readonly byItem = new Map<string, PatchTarget[]>()

  /**
   * The most items held at once.
   *
   * ⚠️ **An item whose approval never comes is never removed, and a long conversation is exactly
   * where this app runs** — the same hazard, and the same answer, as `FileEdits.MAX_PENDING`. The
   * oldest is evicted rather than the newest refused: an approval arrives two frames after its item,
   * so the entries that age out are the ones already decided. 64 is far above any real in-flight
   * count (a turn proposes a handful of patches) and far below anything that matters for memory.
   *
   * ## ⚠️ What the bound does once the key is three fields wide (184 §3, answering 182 M3)
   *
   * **More entries live at once, and that is the point.** Under the old key a reused item id
   * OVERWROTE — one slot, wrong answer. Now two turns that reuse an id hold two entries, so the map
   * fills faster in exactly the case the old key got wrong.
   *
   * ⛔ **It cannot drop an entry the current turn still needs, and the window is what proves it.**
   * The entry is written when the item's frame arrives and read when the approval arrives —
   * **measured at two frames apart**, both runs of 181's probe and again in this dispatch's. For
   * eviction to take it, 64 further file-change items would have to be recorded inside that
   * two-frame window; and only the ACTIVE turn can record at all, because every method this class
   * reads is now behind the turn gate. Nothing foreign can consume a slot.
   *
   * ⚑ **And the entries eviction takes first are exactly the dead ones.** A completed turn's entries
   * can never be read again — an approval naming that turn is refused by `serverRequestScopeProblem`
   * as a stale turn long before it reaches a card — and Map iteration is insertion-ordered, so the
   * oldest turn's entries go first. The wider key made the bound better behaved, not worse.
   */
  private static readonly MAX_ITEMS = 64

  /**
   * Learn from a notification. Everything that is not a file change is ignored — this is not a
   * general item ledger.
   *
   * ⚠️ **An EMPTY `changes` array never overwrites what we already hold.** The two are different
   * claims: a populated report says which files, an empty one says nothing at all, and letting the
   * second erase the first would turn a card that could name its file into one that could not,
   * depending on frame order.
   */
  note(method: string, params: unknown): void {
    if (!isRecord(params)) return
    if (method === 'item/started' || method === 'item/completed') {
      const item = params['item']
      if (!isRecord(item) || item['type'] !== 'fileChange') return
      const id = item['id']
      // ⛔ The identities are on the NOTIFICATION, not on the item — `ItemStartedNotification` is
      // `{item, threadId, turnId, startedAtMs}` — so the key is read from `params` and the id from
      // the item it wraps.
      if (typeof id === 'string') this.record(keyOf(params, id), targetsIn(item['changes']))
      return
    }
    // Never observed on the wire (096: zero in 458,200 frames; 181: zero in two runs; 184: zero in
    // four more — 383 frames of approval capture plus a four-file edit turn counted at the transport
    // rather than at the event stream), and read anyway because it is the DECLARED per-file source.
    // If it starts
    // arriving, it wins by being later without anything else having to change.
    //
    // ⚠️ **182 was right that a frame which never arrives and is ALSO ungated is the worst of both**,
    // and 184 put it behind the same gate as its siblings. This read is now defensive in one
    // direction only: it can add a fact for the running turn, and it can no longer replace one.
    if (method === 'item/fileChange/patchUpdated') {
      const id = params['itemId']
      if (typeof id === 'string') this.record(keyOf(params, id), targetsIn(params['changes']))
    }
  }

  private record(key: string | null, targets: PatchTarget[]): void {
    // ⛔ A frame that did not declare all three identities is not recorded under a key we invented.
    if (key === null || targets.length === 0) return
    this.byItem.set(key, targets)
    // Map iteration is insertion-ordered, so the first key is the oldest item.
    while (this.byItem.size > PatchTargets.MAX_ITEMS) {
      const oldest = this.byItem.keys().next().value
      if (oldest === undefined) break
      this.byItem.delete(oldest)
    }
  }

  /**
   * What the provider said **this thread's, this turn's** item will change — `[]` when it never
   * said, which is not "nothing".
   *
   * ⛔ **Takes the approval's own params**, so the identity is read by {@link keyOf} on both ends and
   * a lookup cannot be spelled differently from the record that answers it (184).
   */
  for(params: unknown): readonly PatchTarget[] {
    const key = keyOf(params, readString(params, 'itemId'))
    if (key === null) return []
    return this.byItem.get(key) ?? []
  }
}

/**
 * One target, as a line a person reads — `added /tmp/x/written.txt`.
 *
 * The status word leads because it is what changes between rows and what decides whether the reader
 * cares: `deleted /etc/hosts` and `modified /etc/hosts` are the same path and not the same question.
 * The shape mirrors the filesystem-profile labels this adapter already builds (`write /tmp/x`), so
 * the disclosure block reads consistently whichever kind of card it is on.
 */
export function patchTargetLabel(target: PatchTarget): string {
  return target.status === 'renamed' && target.oldPath
    ? `renamed ${target.path} (from ${target.oldPath})`
    : `${target.status} ${target.path}`
}
