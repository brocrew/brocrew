/** Keep interior blanks for the native parser; only the read ceiling can excuse a partial tail. */
export function completeTranscriptLines(text: string, truncated: boolean): string[] {
  const lines = text.split('\n')
  const cutMidLine = truncated && !text.endsWith('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  if (cutMidLine) lines.pop()
  return lines
}
