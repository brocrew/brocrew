/** Read the same bounded persisted page that the normal transcript uses for jump-to-latest. */
export async function activeTranscriptHistory(runtime, doc = document) {
  const pane = doc.querySelector('[data-cy=conversation-pane]')
  if (!pane) return null
  const sessionId = pane.dataset.sessionId
  if (!sessionId) throw new Error('The normal conversation pane does not name its session.')
  const page = await runtime.latestHistory({ sessionId })
  if (doc.querySelector('[data-cy=conversation-pane]')?.dataset.sessionId !== sessionId) {
    throw new Error('The selected conversation changed while its history was read.')
  }
  if (
    !Array.isArray(page?.entries) ||
    typeof page.from !== 'number' ||
    typeof page.hasOlder !== 'boolean'
  ) {
    throw new Error('The transcript history does not report its entries and page boundary.')
  }
  const entries = page.entries.map(({ ordinal, event }) => {
    let fact = { type: event.type }
    switch (event.type) {
      case 'tool_call':
        fact = { ...fact, name: event.name, id: event.id }
        break
      case 'user_command':
        fact = { ...fact, command: event.command, target: event.target }
        break
      case 'unknown':
        fact = { ...fact, provider: event.provider, category: event.category, label: event.label }
        break
      case 'error':
        fact = { ...fact, message: event.message }
        break
      case 'scheduled_work':
        fact = { ...fact, jobs: event.jobs?.map(({ id, schedule }) => ({ id, schedule })) }
        break
    }
    return { ordinal, event: fact }
  })
  return { entries, from: page.from, hasOlder: page.hasOlder, sessionId }
}

/** Embedded in an awaited CDP evaluation; no event subscription or provider reader is created. */
export const ACTIVE_TRANSCRIPT_HISTORY = `await (${activeTranscriptHistory.toString()})(window.api.runtime)`
