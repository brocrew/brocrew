/**
 * Waiting on you draws its open list one card at a time, oldest first across every kind of card,
 * each by its own component told which card to draw. A copy told nothing draws every card.
 *
 * Each list is indexed once per read, so a page of many cards finds each one without scanning.
 */
const indexes = new WeakMap<object, Map<string, unknown[]>>()

export function drawnFrom<T>(
  list: readonly T[],
  only: string | undefined,
  keyOf: (item: T) => string,
): readonly T[] {
  if (only === undefined) return list
  let index = indexes.get(list) as Map<string, T[]> | undefined
  if (index === undefined) {
    index = new Map()
    for (const item of list) {
      const key = keyOf(item)
      index.set(key, [...(index.get(key) ?? []), item])
    }
    indexes.set(list, index)
  }
  return index.get(only) ?? []
}
