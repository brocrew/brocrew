/**
 * Who a provider says a session is signed in as, as the provider's own documented interface
 * answered. ⛔ It stays on this computer and inside the app's own process: no event carries it,
 * nothing logs it, and no prompt or tool answer is given it.
 */
export interface SessionAccount {
  /** The account's email, as the provider said it. */
  readonly email: string
  readonly organization?: string
}

/** A field of an account longer than this is not read as one. */
const LONGEST_ACCOUNT_FIELD = 320

/** `said`, when it is a line of text an account's field could be. */
function aField(said: unknown): string | undefined {
  if (typeof said !== 'string') return undefined
  const text = said.trim()
  return text === '' || text.length > LONGEST_ACCOUNT_FIELD || /[\r\n]/.test(text)
    ? undefined
    : text
}

/** The account in what a provider answered, or `null` when it named no email: account not known. */
export function sessionAccountFrom(said: {
  readonly email?: unknown
  readonly organization?: unknown
}): SessionAccount | null {
  const email = aField(said.email)
  if (email === undefined) return null
  const organization = aField(said.organization)
  return { email, ...(organization === undefined ? {} : { organization }) }
}
