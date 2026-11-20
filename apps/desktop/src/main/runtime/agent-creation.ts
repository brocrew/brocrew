import type { Provider } from '@brobot2/shared'
import type { AgentIdentity, IdentityCreator, NewAgent } from '../../shared/runtime-ipc'
import type { AgentModelChoice } from '../../shared/model-choice-contracts'
import type { RulesAuthor } from '../../shared/own-instructions'
import type { SessionStore } from '../db/session-store'
import { foldProfileName } from '../db/identity'
import { whoDidIt, type Caller } from './conversation-caller'
import type { CreateAgentOutcome } from './host-split/host-command-contracts'

/** The one sentence for a name that is already an identity, in the folded spelling the row has. */
function nameIsTaken(slug: string): string {
  return (
    `There is already an agent called ${foldProfileName(slug)}. An agent's name is its identity, ` +
    'so it cannot be reused — and names are compared without case, because a profile is its folder.'
  )
}

/** What creating an agent reads from and writes through the host. */
export interface AgentCreationOperations {
  store(): Pick<
    SessionStore,
    'createAgentIdentity' | 'writeOwnInstructions' | 'setModelChoice' | 'modelChoiceOf'
  >
  /** The profile a conversation runs as, live or as recorded; `null` when neither says. */
  profileOf(conversation: string): string | null
  /** Keep a just-created identity as a service, taking it back if that cannot be written. */
  keepItAsAService(created: AgentIdentity): void
  theProviderOfConversation(conversation: string): Provider | null
  rulesAuthor(me: string, by: Caller): RulesAuthor | null
  theWorldMoved(what: 'agents'): void
  now(): number
}

/**
 * Bringing an agent into existence: the person's door from the window, and `create_agent`.
 *
 * Every agent may create one. The identity records who created it, and that creator's profile is
 * the one agent profile that may later change the new agent's standing rules.
 */
export class AgentCreation {
  constructor(private readonly ops: AgentCreationOperations) {}

  /** The person's door: refusals are thrown, for the window to show. */
  createAgent(said: NewAgent, by?: Caller): AgentIdentity {
    const actor = by === undefined ? null : whoDidIt(by)
    const creator: IdentityCreator | null =
      actor?.who === 'a-person'
        ? { by: 'a-person' }
        : actor?.who === 'the-app-itself'
          ? { by: 'this-app' }
          : actor?.who === 'an-agent'
            ? this.creatorOf(actor.agent)
            : null
    const created = this.ops.store().createAgentIdentity(said, creator)
    if (created === null) throw new Error(nameIsTaken(said.slug))
    if (said.asAService === true) this.ops.keepItAsAService(created)
    // An identity row exists, so every surface that lists identities re-reads.
    this.ops.theWorldMoved('agents')
    return created
  }

  /**
   * `create_agent`: the name, then the new agent's own rules and default model,
   * written only on the call that minted the row.
   */
  createAgentFor(
    me: string,
    said: NewAgent,
    by: Caller,
    itsOwnRules: string | null,
    /** The default model and effort the call named, already judged; `null` when it named none. */
    itsDefault: AgentModelChoice | null,
  ): CreateAgentOutcome {
    // Its provider: the one it names, else its default's, else the creator's.
    const provider = said.provider ?? itsDefault?.provider ?? this.ops.theProviderOfConversation(me)
    const created = this.ops.store().createAgentIdentity({ ...said, provider }, this.creatorOf(me))
    if (created === null) {
      return { ok: false, rail: 'agent-name-taken', detail: { agent: foldProfileName(said.slug) } }
    }
    if (said.asAService === true) this.ops.keepItAsAService(created)
    // The rules are written after the name, so a second call naming this agent is refused by the
    // name before it reaches them; the database also refuses `its-creator` on a later version.
    const rulesAuthor = this.ops.rulesAuthor(me, by)
    const rules =
      itsOwnRules === null
        ? null
        : this.ops.store().writeOwnInstructions(
            {
              profileSlug: created.slug,
              text: itsOwnRules,
              whoWroteIt: 'its-creator',
              ...(rulesAuthor === null ? {} : { author: rulesAuthor }),
              // The conversation that acted, as every settled act records it; the identity's
              // `created_by` holds the creating profile.
              by: whoDidIt(by),
              conversation: me,
              said: null,
              broughtBack: null,
            },
            this.ops.now(),
          )
    if (itsDefault !== null) this.ops.store().setModelChoice(created.slug, itsDefault)
    // Announced after the rules and the default are written, so a re-read sees all of them.
    this.ops.theWorldMoved('agents')
    return {
      ok: true,
      identity: created,
      rules,
      defaultModel: this.ops.store().modelChoiceOf(created.slug),
    }
  }

  /** The identity a conversation creates agents as; `null` when nothing says which profile it runs. */
  creatorOf(conversation: string): IdentityCreator | null {
    const profile = this.ops.profileOf(conversation)
    return profile === null ? null : { by: 'an-agent', agent: foldProfileName(profile) }
  }
}
