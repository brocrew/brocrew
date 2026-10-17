/**
 * Where a person has been in this window, for Back and Forward. A place is a screen, a conversation,
 * a Team profile, or an archived conversation's read-only history; the tab a conversation shows is
 * part of its place and is kept on it rather than recorded as a step. Popups are never places.
 *
 * The history lasts while the window is open. Going to a new place clears what Forward would
 * return to; going back to the place already current only updates its tab.
 */

/** One place. `key` says which place it is; the rest is how it was left. */
export interface Place {
  /** The same for the same place, whatever its tab or scroll. */
  readonly key: string
  /** What Back and Forward call it: "Waiting on you", "W3 · Chess week". */
  readonly name: string
  /** The conversation it shows, or the archived one it reads, by id; `null` for a screen. */
  readonly conversation: string | null
  /** The Team profile it shows, by identity id. */
  readonly identity: string | null
  /** The conversation's tab: Conversation, Graph or Files. */
  readonly tab: string | null
  /** What the screen needs to show it again, where its ids are not enough: a page already read. */
  readonly payload?: unknown
}

export interface HistoryEntry {
  place: Place
  /** Where its page was scrolled to when it was left, or `null` before it was. */
  scroll: number | null
  /** Its conversation or profile was deleted here: Back and Forward go past it, and say so. */
  gone: boolean
}

/** How many places a window remembers. */
export const PLACES_KEPT = 50

export interface PlaceHistory {
  readonly entries: readonly HistoryEntry[]
  readonly index: number
  /** The place shown now, or `undefined` before any. */
  current(): HistoryEntry | undefined
  /**
   * The window shows `place`. The same place as now updates its tab; another place is a new step,
   * after Back's, with Forward cleared and the oldest dropped past {@link PLACES_KEPT}.
   * `scrollLeft` is where the page now being left was scrolled to.
   */
  arrive(place: Place, scrollLeft: () => number | null): void
  /** The entry a step back or forward would show, gone ones included, or `undefined`. */
  peek(step: -1 | 1): HistoryEntry | undefined
  /**
   * Take a step: the current entry keeps `scrollLeft`, and the one a step away becomes current.
   * Gone entries on the way are removed and returned, so the window can say it went past them.
   */
  go(
    step: -1 | 1,
    scrollLeft: () => number | null,
  ): { reached: HistoryEntry | undefined; passed: HistoryEntry[] }
  /** Mark every entry that shows one of these conversations or profiles as gone. */
  markGone(conversations: readonly string[]): void
  /** Mark the entries that show a conversation as reading it archived. */
  markArchived(conversations: readonly string[], keyOf: (conversation: string) => string): void
  /** The nearest entry a step away that isn't gone, or `undefined`. */
  next(step: -1 | 1): HistoryEntry | undefined
}

export function createPlaceHistory(kept = PLACES_KEPT): PlaceHistory {
  let entries: HistoryEntry[] = []
  let index = -1

  const nearest = (step: -1 | 1): HistoryEntry | undefined => {
    for (let at = index + step; at >= 0 && at < entries.length; at += step) {
      if (!entries[at]!.gone) return entries[at]
    }
    return undefined
  }

  return {
    get entries() {
      return entries
    },
    get index() {
      return index
    },
    current: () => entries[index],
    arrive(place, scrollLeft) {
      const now = entries[index]
      if (now !== undefined && now.place.key === place.key) {
        now.place = place
        return
      }
      if (now !== undefined) now.scroll = scrollLeft()
      entries = [...entries.slice(0, index + 1), { place, scroll: null, gone: false }]
      if (entries.length > kept) entries = entries.slice(entries.length - kept)
      index = entries.length - 1
    },
    peek: (step) => entries[index + step],
    next: nearest,
    go(step, scrollLeft) {
      const passed: HistoryEntry[] = []
      const now = entries[index]
      if (now !== undefined) now.scroll = scrollLeft()
      let at = index + step
      while (at >= 0 && at < entries.length && entries[at]!.gone) {
        passed.push(entries[at]!)
        entries = [...entries.slice(0, at), ...entries.slice(at + 1)]
        if (step === -1) {
          index -= 1
          at -= 1
        }
      }
      if (at < 0 || at >= entries.length) return { reached: undefined, passed }
      index = at
      return { reached: entries[at], passed }
    },
    markGone(conversations) {
      const gone = new Set(conversations)
      for (const entry of entries) {
        const { conversation, identity } = entry.place
        if (
          (conversation !== null && gone.has(conversation)) ||
          (identity !== null && gone.has(identity))
        )
          entry.gone = true
      }
    },
    markArchived(conversations, keyOf) {
      const archived = new Set(conversations)
      for (const entry of entries) {
        const { conversation } = entry.place
        if (conversation === null || !archived.has(conversation)) continue
        const key = keyOf(conversation)
        if (entry.place.key !== key) entry.place = { ...entry.place, key, tab: null }
      }
    },
  }
}
