export function takeAssistantNotice<Event extends { type: string; text?: string }>(
  events: Event[],
): string {
  const retained = events.filter((event) => event.type !== 'assistant_message')
  const notice = events
    .flatMap((event) => (event.type === 'assistant_message' ? [event.text] : []))
    .join('\n')
  events.length = 0
  events.push(...retained)
  return notice
}
