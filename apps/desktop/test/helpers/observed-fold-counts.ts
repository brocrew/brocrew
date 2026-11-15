export interface FoldCounts {
  reused: number
  rebuilt: number
  carried: number
  keptOnly: number
}

const counts = new Map<string, FoldCounts>()

export function resetFoldCounts(): void {
  counts.clear()
}

export function noteFold(key: string | undefined, outcome: keyof FoldCounts): void {
  const name = key ?? 'local'
  let row = counts.get(name)
  if (row === undefined) {
    row = { reused: 0, rebuilt: 0, carried: 0, keptOnly: 0 }
    counts.set(name, row)
  }
  row[outcome]++
}

export function foldCounts(): Record<string, FoldCounts> {
  return Object.fromEntries(counts)
}
