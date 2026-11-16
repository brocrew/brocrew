function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export const TOOL_SUMMARY_MAX = 200

export function truncateToolSummary(text: string, max = TOOL_SUMMARY_MAX): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** Keep receipt blocks separate for the full-answer panel. */
export function textParts(content: unknown): readonly string[] {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  const parts: string[] = []
  for (const block of content) {
    if (isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string') {
      parts.push(block['text'])
    }
  }
  return parts
}

export function summarizeToolInput(name: string, input: unknown): string {
  if (isRecord(input)) {
    const command = input['command']
    if (typeof command === 'string') return truncateToolSummary(command)
    const filePath = input['file_path']
    if (typeof filePath === 'string') return filePath
    const description = input['description']
    if (typeof description === 'string' && description) return truncateToolSummary(description)
  }
  try {
    return truncateToolSummary(JSON.stringify(input) ?? name)
  } catch {
    return name
  }
}

export function summarizeToolResult(content: unknown): string {
  const first = textParts(content).find((part) => part.trim() !== '')
  return first === undefined ? 'done' : truncateToolSummary(first)
}
