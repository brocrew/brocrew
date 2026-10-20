/** Compare release versions without offering a downgrade or an unrecognized version. */
export function newerPluginVersion(candidate: string, installed: string): boolean {
  const parse = (value: string) =>
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      value,
    )
  const next = parse(candidate),
    before = parse(installed)
  if (!next || !before) return false
  for (let i = 1; i <= 3; i++) {
    const a = BigInt(next[i]!),
      b = BigInt(before[i]!)
    if (a !== b) return a > b
  }
  if (!next[4] || !before[4]) return !next[4] && !!before[4]
  const a = next[4].split('.'),
    b = before[4].split('.')
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i],
      y = b[i]
    if (x === undefined || y === undefined) return y === undefined
    if (x === y) continue
    const xn = /^\d+$/.test(x),
      yn = /^\d+$/.test(y)
    if (xn && yn) return BigInt(x) > BigInt(y)
    if (xn !== yn) return !xn
    return x > y
  }
  return false
}
