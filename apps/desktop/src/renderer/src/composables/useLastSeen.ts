import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import type { ToggleStorage } from './usePersistentToggle'

/** An absence shorter than this (a glance at another app) doesn't move "last here". */
export const AWAY_LONG_ENOUGH_MS = 5 * 60_000

/** The workspace's one boundary: when the person last left it for long enough. */
export const lastSeenKey = (workspace: string): string => `brocrew:last-seen:${workspace}`
/** When the workspace's window in front was left, until the person comes back to one. */
export const awaySinceKey = (workspace: string): string => `brocrew:away-since:${workspace}`
/** When the person last came back to one of the workspace's windows. */
export const backAtKey = (workspace: string): string => `brocrew:back-at:${workspace}`
/**
 * In this window's session storage: when it was left by being reloaded or closed. A reload keeps
 * session storage and a quit or a new window does not, which is how a reload is told apart.
 */
export const reloadedAtKey = (workspace: string): string => `brocrew:reloaded-at:${workspace}`

function storageOf(name: 'localStorage' | 'sessionStorage'): ToggleStorage | null {
  try {
    return globalThis[name] ?? null
  } catch {
    return null
  }
}

function readTime(storage: ToggleStorage | null, key: string): number | null {
  try {
    const raw = storage?.getItem(key) ?? null
    if (raw === null) return null
    const at = Number(raw)
    return Number.isFinite(at) && at > 0 ? at : null
  } catch {
    return null
  }
}

function writeTime(storage: ToggleStorage | null, key: string, at: number): void {
  try {
    storage?.setItem(key, String(at))
  } catch {
    // Storage can refuse a write; the boundary then stays where it was.
  }
}

function forget(storage: ToggleStorage | null, key: string): void {
  try {
    storage?.removeItem?.(key)
  } catch {
    // Best effort: a leaving left behind is ordered against the next one by its time.
  }
}

/** When an event happened, on the wall clock, however late it is handled. */
const happenedAt = (event: Event): number => performance.timeOrigin + event.timeStamp

export interface LastSeenOptions {
  /** Shared by the workspace's windows. */
  storage?: ToggleStorage | null
  /** This window's own, kept across a reload. */
  session?: ToggleStorage | null
  now?: () => number
  /** When an event (a leaving or a return) happened, on the same clock as `now`. */
  eventAt?: (event: Event) => number
  /** Whether this window is in front of the person now. */
  inFront?: () => boolean
  /** Where this window's focus, blur, closing and storage events arrive. */
  events?: EventTarget
  /** Where its visibility changes arrive, and what says whether it is hidden. */
  visibility?: EventTarget & { readonly visibilityState: DocumentVisibilityState }
}

/**
 * When the person last had this workspace in front: one boundary per workspace, shared by its
 * windows and kept across reloads, in the window's own storage.
 *
 * Leaving the window in front records when the person left, once, however many ways the leaving
 * is heard (blur, hidden, closing), and at the time it happened rather than when it was handled:
 * a later leaving is never replaced by an earlier one, and a leaving from before the person last
 * came back counts for nothing. Coming back to any of the workspace's windows makes that leaving
 * the boundary if they were away long enough. A glance at another app leaves the boundary where it
 * was, and so does a reload, however long it takes. `since` is `null` when there is no boundary
 * yet, which is not "they never left".
 */
export function useLastSeen(
  workspace: () => string | null,
  {
    storage = storageOf('localStorage'),
    session = storageOf('sessionStorage'),
    now = Date.now,
    eventAt = happenedAt,
    inFront = () => document.hasFocus(),
    events = window,
    visibility = document,
  }: LastSeenOptions = {},
): { since: Ref<number | null> } {
  const since = ref<number | null>(null)
  let here = false
  /** When this window was last left, until the person comes back to it. */
  let ownLeaving: number | null = null

  const where = (): string | null => workspace()

  function readBoundary(): void {
    const ws = where()
    since.value = ws === null ? null : readTime(storage, lastSeenKey(ws))
  }

  /** The person left this window, at `at`. Heard once per time in front. */
  function leave(at: number): void {
    const ws = where()
    if (!here || ws === null) return
    here = false
    ownLeaving = at
    const back = readTime(storage, backAtKey(ws))
    const pending = readTime(storage, awaySinceKey(ws))
    // From before the person last came back, or older than a leaving already recorded: not this
    // absence's start.
    if (back !== null && at < back) return
    if (pending !== null && pending >= at) return
    writeTime(storage, awaySinceKey(ws), at)
  }

  const wentAway = (event: Event): void => leave(eventAt(event))

  /**
   * The window is closing: a reload or a quit, which the next window to open here can tell. The
   * mark names this window's own leaving, whether the closing is how it left or it was left just
   * before (blur or hidden, then closing).
   */
  function closing(event: Event): void {
    const ws = where()
    leave(eventAt(event))
    if (ws !== null && ownLeaving !== null) writeTime(session, reloadedAtKey(ws), ownLeaving)
  }

  /**
   * The person is in front of the workspace, since `at`: a leaving at least five minutes before
   * becomes the boundary. `at` is when the return happened, on the departures' clock.
   */
  function settle(at: number): void {
    const ws = where()
    if (ws === null) return
    // A return older than one already recorded changes nothing: the person came back since.
    const back = readTime(storage, backAtKey(ws))
    if (back !== null && at < back) return readBoundary()
    writeTime(storage, backAtKey(ws), at)
    // A leaving after this return belongs to a later absence, which this return does not end.
    const left = readTime(storage, awaySinceKey(ws))
    if (left !== null && left > at) return readBoundary()
    forget(storage, awaySinceKey(ws))
    if (left !== null && at - left >= AWAY_LONG_ENOUGH_MS) writeTime(storage, lastSeenKey(ws), left)
    readBoundary()
  }

  /** The person came back, at `at`: the return event's own time, or now when a window opens. */
  function cameBack(at: number): void {
    if (here) return
    here = true
    ownLeaving = null
    settle(at)
  }

  const onFocus = (event: Event): void => cameBack(eventAt(event))

  /** This window was reloaded, not reopened: its own leaving by the reload is no absence. */
  function forgetOwnReload(): void {
    const ws = where()
    if (ws === null) return
    const reloaded = readTime(session, reloadedAtKey(ws))
    if (reloaded === null) return
    forget(session, reloadedAtKey(ws))
    if (readTime(storage, awaySinceKey(ws)) === reloaded) forget(storage, awaySinceKey(ws))
  }

  const onVisibility = (event: Event): void => {
    if (visibility.visibilityState === 'hidden') wentAway(event)
    else if (inFront()) cameBack(eventAt(event))
  }

  // Another window of the workspace moved the boundary: this one shows the same.
  const onStorage = (event: Event): void => {
    const ws = where()
    if (ws !== null && (event as StorageEvent).key === lastSeenKey(ws)) readBoundary()
  }

  // The workspace is known only once the app has said which it is.
  watch(
    where,
    () => {
      forgetOwnReload()
      if (here) settle(now())
      else readBoundary()
    },
    { immediate: true },
  )

  onMounted(() => {
    events.addEventListener('blur', wentAway)
    events.addEventListener('focus', onFocus)
    events.addEventListener('pagehide', closing)
    events.addEventListener('storage', onStorage)
    visibility.addEventListener('visibilitychange', onVisibility)
    // A window opening in front is the person coming back from a quit; a reload was forgotten above.
    if (inFront()) cameBack(now())
  })
  onUnmounted(() => {
    events.removeEventListener('blur', wentAway)
    events.removeEventListener('focus', onFocus)
    events.removeEventListener('pagehide', closing)
    events.removeEventListener('storage', onStorage)
    visibility.removeEventListener('visibilitychange', onVisibility)
  })

  return { since }
}
