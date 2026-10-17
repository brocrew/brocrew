import { agentName, type AgentIdentity } from '../../../shared/runtime-ipc'
import type { InstructionAsk } from '../../../shared/own-instructions'

/**
 * 🔴 **712 · R41 (`707` GAP-5) — an agent's ask about an identity's own rules, with both NAMED.**
 *
 * ⛔ **The notice printed two slugs** — *"project-manager proposed rules for default — 812
 * characters."* — and R41 is *"every identity a person reads is NAMED (`agentName`), never by
 * slug"*. ⚑ `lost-reply.ts`' shape, and for its reason: the fold that draws the notice has no roster
 * (it lands after the ledger), so the fold keeps the FACTS here and writes the roster-less sentence
 * as `text` for a reader that has none (`readable-export.ts`); `NoticeEntry` draws the same function
 * with the roster.
 */
export interface InstructionAsked {
  /** The proposing agent, by slug — `InstructionProposedEvent.proposedBy`. */
  readonly proposedBy: string
  /** The identity the rules are about, by folded slug — `InstructionProposedEvent.about`. */
  readonly about: string
  readonly ask: InstructionAsk
  /** The length of the rules it asked for, in characters. */
  readonly characters: number
}

/**
 * ⚑ **The sentence, one function for both readers** — with the roster the names a person gave, and
 * with none `agentName`'s own fallback (the product's label for BroBot's slug, the slug otherwise).
 */
export function instructionAskedSentence(
  asked: InstructionAsked,
  identities: readonly AgentIdentity[] | null,
): string {
  const named = (slug: string): string => agentName(slug, identities)
  return `${named(asked.proposedBy)} ${asked.ask === 'relay' ? 'set' : 'proposed'} rules for ${named(
    asked.about,
  )} — ${String(asked.characters)} characters. ${
    asked.ask === 'relay'
      ? 'It said you had given it this rule, so it was written.'
      : 'Nothing is written until you approve it on that agent.'
  }`
}
