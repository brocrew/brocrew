export function toolResultsIn(body: unknown): Set<string>
export function anthropicEvents(
  model: string,
  reply:
    { kind: 'text'; text: string } | { kind: 'tool_use'; id: string; name: string; input: unknown },
  messageId: string,
): unknown[]
export function sseOf(events: readonly unknown[]): string
