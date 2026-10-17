import type { DigestRegister } from '../../../shared/digest'

/**
 * How the window says a fact is known: watched by the engine, said by an agent, or not answerable
 * from the ledger. Keyed by {@link DigestRegister}, so a register added to the shared vocabulary
 * and not here is a compile error rather than an unlabelled chip in front of a person.
 */
export const REGISTER_WORDS: Readonly<
  Record<DigestRegister, { readonly label: string; readonly title: string }>
> = {
  observed: { label: 'observed', title: 'the engine watched this happen' },
  claimed: { label: 'claimed', title: 'an agent said this — nothing in this app checked it' },
  unknown: { label: 'unknown', title: 'the ledger cannot answer this' },
}
