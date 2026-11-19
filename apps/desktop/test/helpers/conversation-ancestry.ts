/** Reads ancestors nearest first through the store's immediate parent relation. */
export function chainAbove(store: { parentOf(id: string): string | null }, id: string): string[] {
  const above: string[] = []
  for (let parent = store.parentOf(id); parent !== null; parent = store.parentOf(parent)) {
    above.push(parent)
  }
  return above
}
