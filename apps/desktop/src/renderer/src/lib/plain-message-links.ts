/** Person messages are literal text; only bare work labels acquire controls. */
export function personMessageParts(source: string): Array<{ text: string; label: boolean }> {
  const parts: Array<{ text: string; label: boolean }> = []
  const labels = /(?<![\w./\\-])W\d+(?:\.\d+)*(?![\w/\\-]|\.[\w/\\])/g
  let end = 0
  for (const hit of source.matchAll(labels)) {
    parts.push({ text: source.slice(end, hit.index), label: false })
    parts.push({ text: hit[0], label: true })
    end = hit.index + hit[0].length
  }
  parts.push({ text: source.slice(end), label: false })
  return parts
}
