import type { Provider } from '@brobot2/shared'
import type { AgentModelChoice } from '../../shared/model-choice-contracts'
import type { ProviderUsageReading, UsageWindowSeen } from '../../shared/runtime-ipc'
import type { WorkThatNamesIt } from '../../shared/piece-called'
import type { PieceHeld } from '../db/session-store'

/**
 * 🔴 **One IDENTITY, as an agent that may start a conversation as it reads it** (488,
 * HO-020's `list_profiles`, HO-031 §2.3).
 *
 * ## ⛔ Four fields, and the three that are missing are the ruling
 *
 * ⚠️ **No grant of its own.** What another identity may do is that identity's own business and a
 * person's sheet; `485` renders each agent its OWN grants, and publishing a second agent's here
 * would make one identity's configuration another's reading. ⛔ **The bound is not squeamishness:
 * `maxDepth` already crosses to a caller inside `too-deep`, about ITSELF** — which is what makes the
 * same number about somebody ELSE a widening rather than a restatement.
 *
 * ⚠️ **No conversation facts — not whether it is running, not how many times it has run.** Those
 * are folded through a different grant entirely ({@link RuntimeHost.agentsVisibleTo}), so carrying
 * them here would let a caller read past the fold that door applies. ⚑ *A widening of one
 * predicate widens every question its field answers*, and this row answers *who exists*.
 *
 * ⚠️ **No row id and no `created_at`.** The id is `aid:` plus the slug, no door takes it, and a
 * listing that published a derived id would invite a model to spend it where a slug belongs;
 * nothing a caller does with this list turns on when the name was minted. ⛔ **A field nobody needs
 * is a disclosure nobody can justify.**
 */
export interface ProfileReport {
  /**
   * ⚑ **The FOLDED slug, and it is spelled the way `give_work` takes it** — `profile`.
   * ⚠️ A caller copies this value into that argument; a second spelling here would be a value a
   * model has to transform before it can be spent.
   */
  readonly profile: string
  /** A human name somebody gave it, or null — nobody has. */
  readonly displayName: string | null
  /**
   * The provider it runs on, which a give never changes — or null: nothing names one yet, and its
   * first conversation decides it, or its conversations ran on both and a person has to choose.
   */
  readonly provider: Provider | null
  /**
   * 🔴 **D-042 · R6 — its DEFAULT model and effort, or null — it has none**: what its new
   * conversations start on when a give names none (`677`'s inbox 8: *"a spawner knows before it
   * calls"*). ⚑ Only a default IN FORCE (`aChoiceIsInForce`); a contradiction no launch reads is not
   * reported as though one did.
   */
  readonly defaultModel: AgentModelChoice | null
  /** It is a service: one conversation its callers share, which runs their work one at a time. */
  readonly isAService?: true
}

/**
 * 🔴 **Which identities a caller may be told about** (488, D-014).
 *
 * ⛔ **Every one, and there is no `refused` arm.** Any agent may start a conversation as any agent
 * this app holds, so there is no grant to fold this list by and no wall to refuse it with.
 */
export interface ProfileReading {
  /** Every identity this app holds — each is one the caller may start a conversation as. */
  readonly profiles: readonly ProfileReport[]
  /**
   * 🔴 **F096 — each provider's newest usage reading, per window** ({@link RuntimeHost.providerUsage}),
   * so a caller choosing whom to give work to can keep to a cap a person set — *Claude weekly: 34%,
   * resets on 9 October*. ⚑ The account's, not an agent's: every agent of a provider spends it.
   */
  readonly usage: Readonly<Record<Provider, readonly ProviderUsageReading[]>>
  /** ⚑ F096 — which windows each provider has reported, first and last ({@link RuntimeHost.usageWindowsSeen}). */
  readonly windowsSeen: Readonly<Record<Provider, readonly UsageWindowSeen[]>>
  /** When it was read, epoch ms — what each time in its words is placed on a day by. */
  readonly readAt: number
}

/**
 * ⚑ **F009 · how an agent's standing rules begin, as its record says it** — their first line that
 * holds a word, cut at {@link RULES_BEGIN_CHARS}; that it has none; or nothing at all for a caller
 * that does not reach the agent, which learns neither whether it has rules nor what they say.
 */
export type RulesOnARecord =
  | { readonly is: 'they-begin'; readonly line: string }
  | { readonly is: 'none' }
  | { readonly is: 'not-told' }

/**
 * ⚑ **F009 · who started a conversation of an agent's record**: a person — no conversation started
 * it, so it owns a root, the work a person gave it (D-016: a conversation nobody here started is a
 * person's) — the caller itself (`you`, 729 · R90: a reader is never told its own name as somebody
 * else's), or another conversation, by its name and the piece it started this one from — see
 * `RuntimeHost.whoStartedIt`.
 */
export type WhoStartedIt =
  | { readonly is: 'a-person' }
  | { readonly is: 'you' }
  | { readonly is: 'an-agent'; readonly conversation: string; readonly called: string }

/**
 * ⚑ **F009 · one conversation of an agent's record.** ⛔ **Never whether this app runs it** (`05`
 * rule 5): what it is doing now is the one state `get_agent_status` says. ⚑ Whether it ENDED is
 * here: one that could never be reopened, with the conversation that took its place (D-017 · R10).
 */
export interface ConversationOnARecord {
  readonly conversation: string
  /** The work that names it now ({@link SessionStore.workThatNames}), or `null`: it holds none. */
  readonly named: WorkThatNamesIt | null
  readonly startedBy: WhoStartedIt
  /** When it was created. */
  readonly startedAt: number
  /** When its record last changed — any row it was written, a stop's included. */
  readonly lastChangedAt: number
  /**
   * ⚑ **The conversation standing in its place** — the end of its chain of replacements, of the same
   * agent, so named as the record names its own — or `null`: it was never replaced.
   */
  readonly inItsPlace: {
    readonly conversation: string
    readonly named: WorkThatNamesIt | null
  } | null
  /** When a person archived it, epoch ms: present only for an archived one, which a record marks. */
  readonly archivedAt?: number
}

/**
 * ⚑ **F009 · who gave a piece of an agent's record**: a person — work its holder took on for them —
 * the caller itself, or another conversation, named by its own piece above this one (F033).
 */
export type WhoGaveIt =
  | { readonly is: 'a-person' }
  | { readonly is: 'you' }
  | { readonly is: 'an-agent'; readonly conversation: string; readonly called: string }

/**
 * ⚑ **F009 · one piece of an agent's record** — {@link PieceHeld}: its label, its title now, the
 * conversation holding it, and how it stands (open, or how and when it ended, with its outcome once
 * answered) — with who gave it, named.
 */
export interface PieceOnARecord {
  readonly held: PieceHeld
  readonly givenBy: WhoGaveIt
}
