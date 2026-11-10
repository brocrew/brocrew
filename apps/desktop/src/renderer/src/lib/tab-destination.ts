/** Only the index calculation; each strip owns its eligible tabs, keys and effects. */
export function tabDestination(
  key: string,
  at: number,
  count: number,
  wrap: 'modulo' | 'edge' = 'modulo',
): number | null {
  const last = count - 1
  switch (key) {
    case 'ArrowRight':
      return wrap === 'edge' ? (at === last ? 0 : at + 1) : (at + 1) % count
    case 'ArrowLeft':
      return wrap === 'edge' ? (at === 0 ? last : at - 1) : (at + count - 1) % count
    case 'Home':
      return 0
    case 'End':
      return last
    default:
      return null
  }
}
