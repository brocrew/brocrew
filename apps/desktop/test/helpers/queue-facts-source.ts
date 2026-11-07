import { expect } from 'vitest'

/** The declaration and queue parameter keep brief facts out of ordinary messages. */
export function expectQueueFactsExcludeBriefs(records: string, hostSource: string): void {
  expect(records).toContain(
    [
      "type FactsAQueueCarries = Omit<TurnFacts, 'giving' | 'rebriefing'> & {",
      '  readonly giving?: never',
      '  readonly rebriefing?: never',
      '}',
    ].join('\n'),
  )
  // Match queueMessage itself; send accepts the same type.
  expect(
    /\n {2}queueMessage\(([\s\S]*?)\n {2}\): Promise<QueueOutcome>/.exec(hostSource)?.[1] ?? '',
  ).toContain('facts: FactsAQueueCarries = {},')
}
