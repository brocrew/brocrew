/** The words a person types to mean "stop", compared without case or accents. */
const STOP_WORDS = new Set(['stop', 'arrete', 'pause', 'wait', 'attends'])

/**
 * Whether a message is only a word asking the agent to stop, such as "Stop!" or "arrête.", so the
 * window can offer to stop the turn instead of queueing the word behind it.
 */
export function isOnlyAStopWord(text: string): boolean {
  const word = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '')
  return STOP_WORDS.has(word)
}
