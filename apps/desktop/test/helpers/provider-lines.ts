import type { ProviderLines } from '../../src/main/archive/derive-ledger'

/** A provider's lines held in memory, read the way a derive reads a file: a window at a time. */
export function linesOf(lines: readonly string[]): ProviderLines {
  return (from, maxLines) => {
    const next = Math.min(from + maxLines, lines.length)
    return {
      lines: lines.slice(from, next),
      offset: next,
      done: next >= lines.length,
      partial: false,
    }
  }
}
