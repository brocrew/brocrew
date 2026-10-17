import { THE_BLOCK_BEGINS } from '../../src/main/runtime/what-this-app-adds-to-a-turn'

/**
 * The words a turn handed its agent, without the block this app adds at their end — for a test
 * that is about the message, and reads it whole.
 */
export function withoutWhatThisAppAdds(words: string): string {
  const at = words.lastIndexOf(`\n\n${THE_BLOCK_BEGINS}\nThis app adds what follows.`)
  return at < 0 ? words : words.slice(0, at)
}

/** The block this app added at the end of those words, or `''` when they carry none. */
export function whatThisAppAdded(words: string): string {
  const at = words.lastIndexOf(`\n\n${THE_BLOCK_BEGINS}\nThis app adds what follows.`)
  return at < 0 ? '' : words.slice(at + 2)
}
