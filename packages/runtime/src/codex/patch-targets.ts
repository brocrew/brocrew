import type { FileChange } from '../file-change'

/**
 * Which files a `fileChange` approval is about. `FileChangeRequestApprovalParams` carries no paths,
 * but the item's `item/started` arrives before the approval under the same `itemId` with its
 * `changes`. `item/fileChange/patchUpdated` has never been observed, but it is read too as the
 * declared per-file source.
 *
 * Entries are keyed by thread, turn and item, since an item id is not guaranteed unique beyond its
 * turn; a frame without both a thread and a turn is not recorded. Paths are never invented: an item
 * nobody reported answers `[]` and the disclosure stays under-disclosed.
 */
export interface PatchTarget {
  /** The path as the provider reported it — absolute in every captured frame. Never invented. */
  readonly path: string
  /** What the patch does, using the Changes pane's vocabulary; `touched` when the kind is unreadable. */
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
 * The thread, turn and item as one key. Length-prefixing the first two makes it injective, since
 * all three are opaque provider strings that may contain the separator.
 */
function identityKey(threadId: string, turnId: string, itemId: string): string {
  return `${threadId.length}:${threadId}|${turnId.length}:${turnId}|${itemId}`
}

/**
 * The key a frame is about, or `null` when it did not declare enough. Recording and lookup both use
 * it so the two keys cannot drift.
 */
function keyOf(params: unknown, itemId: string): string | null {
  const threadId = readString(params, 'threadId')
  const turnId = readString(params, 'turnId')
  if (!threadId || !turnId || !itemId) return null
  return identityKey(threadId, turnId, itemId)
}

/** One `FileUpdateChange` as a target, or `null` when it has no usable path (such a row would name nothing). */
function targetOf(change: unknown): PatchTarget | null {
  if (!isRecord(change)) return null
  const path = change['path']
  if (typeof path !== 'string' || !path) return null
  const kind = change['kind']
  const type = isRecord(kind) ? kind['type'] : undefined
  if (type === 'add') return { path, status: 'added' }
  if (type === 'delete') return { path, status: 'deleted' }
  if (type === 'update') {
    // `move_path` is where the file ends up, so it becomes the path and the old one `oldPath`, as in `parseUnifiedDiff`.
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

/** The files each in-flight `fileChange` item says it will touch, keyed by thread, turn and item. */
export class PatchTargets {
  private readonly byItem = new Map<string, PatchTarget[]>()

  /**
   * The most items held at once. An item whose approval never comes is never removed, so the oldest
   * is evicted, as in `FileEdits.MAX_PENDING`. An approval arrives about two frames after its item,
   * so evicted entries are long decided.
   */
  private static readonly MAX_ITEMS = 64

  /**
   * Learn from a notification; anything that is not a file change is ignored. An empty `changes`
   * array never overwrites what is already held, since it says nothing.
   */
  note(method: string, params: unknown): void {
    if (!isRecord(params)) return
    if (method === 'item/started' || method === 'item/completed') {
      const item = params['item']
      if (!isRecord(item) || item['type'] !== 'fileChange') return
      const id = item['id']
      // The identities are on the notification, not the item, so the key is read from `params`.
      if (typeof id === 'string') this.record(keyOf(params, id), targetsIn(item['changes']))
      return
    }
    // Never observed on the wire, but read because it is the declared per-file source; being later,
    // it wins if it ever arrives.
    if (method === 'item/fileChange/patchUpdated') {
      const id = params['itemId']
      if (typeof id === 'string') this.record(keyOf(params, id), targetsIn(params['changes']))
    }
  }

  private record(key: string | null, targets: PatchTarget[]): void {
    // A frame that did not declare all identities is not recorded.
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
   * What the provider said this thread's and turn's item will change, or `[]` when it never said
   * (not "nothing"). Takes the approval's own params so the key is built by {@link keyOf} on both ends.
   */
  for(params: unknown): readonly PatchTarget[] {
    const key = keyOf(params, readString(params, 'itemId'))
    if (key === null) return []
    return this.byItem.get(key) ?? []
  }
}

/** One target as a line a person reads, status first: `added /tmp/x/written.txt`. */
export function patchTargetLabel(target: PatchTarget): string {
  return target.status === 'renamed' && target.oldPath
    ? `renamed ${target.path} (from ${target.oldPath})`
    : `${target.status} ${target.path}`
}
