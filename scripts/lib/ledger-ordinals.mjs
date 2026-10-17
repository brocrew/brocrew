/**
 * Require a nonempty, contiguous ledger ordinal sequence, not merely increasing values.
 * Increasing ordinals can still hide dropped entries; an empty ledger proves no delivery.
 * Share this assertion between live instruments and direct controls.
 *
 * @param {readonly number[]} ordinals in the order returned by the ledger
 * @param {string} what identifies the ledger in each failure
 * @returns {string} a one-line summary for the step result
 */
export function assertGapFree(ordinals, what) {
  if (!Array.isArray(ordinals) || ordinals.length === 0) {
    throw new Error(`${what}: no entries at all — there is nothing here to be gap-free`)
  }
  for (const [index, value] of ordinals.entries()) {
    if (!Number.isInteger(value)) {
      throw new Error(
        `${what}: entry ${index} has a non-integer ordinal (${JSON.stringify(value)})`,
      )
    }
  }
  const backwards = ordinals.findIndex((n, i) => i > 0 && n <= ordinals[i - 1])
  if (backwards > 0) {
    throw new Error(
      `${what}: ordinals are not strictly increasing — ${ordinals[backwards - 1]} is followed by ` +
        `${ordinals[backwards]} at entry ${backwards}`,
    )
  }
  // Strictly increasing AND spanning exactly as many values as there are entries ⇒ no gaps. Stated
  // as the span rather than as `n === first + i` so the failure can name how many are missing, and
  // so a window that legitimately does not begin at zero is not called broken for it.
  const first = ordinals[0]
  const last = ordinals[ordinals.length - 1]
  const span = last - first + 1
  if (span !== ordinals.length) {
    throw new Error(
      `${what}: ${ordinals.length} entries spanning ordinals ${first}..${last} (${span} values) — ` +
        `${span - ordinals.length} ordinal(s) are missing`,
    )
  }
  return `${ordinals.length} entries, ordinals ${first}..${last}, gap-free`
}
