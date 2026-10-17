/**
 * What a conversation shows once this app has renewed its copy of a provider's sign-in by itself
 * (`ReopenedEvent.itsCopyWasReplaced`), in place of the rows the refusal wrote: one short
 * line. `name` is the provider's own, as a conversation names it.
 */
export const A_RENEWED_SIGN_IN_SAYS = {
  /** The agent carried on with the message it had been given: nobody needs to do anything. */
  carriedOn: (name: string): string => `${name} sign-in renewed.`,
  /** The message it had been given was not answered, and has to be sent again. */
  sendAgain: (name: string): string => `${name} sign-in renewed. Send your message again.`,
} as const
