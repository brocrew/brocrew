import type { AnswerAck } from '../../../shared/runtime-ipc'
import type {
  InstructionProposedEvent,
  InstructionChangedEvent,
  InstructionSettledEvent,
} from '../../../shared/conversation-events'
import {
  OWN_INSTRUCTIONS_CHARS,
  type AgentInstructionsReading,
  type InstructionEnding,
  type RulesAuthor,
} from '../../../shared/own-instructions'
import {
  ownNotesWriteFits,
  OWN_NOTES_BASELINE_PROBLEM,
  OWN_NOTES_STALE_PROBLEM,
  OWN_NOTES_SAVE_PROBLEM,
  OWN_NOTES_WRITE_CALLER_PROBLEM,
  OWN_NOTES_READ_CALLER_PROBLEM,
  type OwnNotesWrite,
  type OwnNotesReading,
  type OwnNotesReceipt,
  type AgentOwnNotesReading,
} from '../../../shared/own-notes'
import type {
  AgentRulesReading,
  AgentRulesReceipt,
  AgentRulesWrite,
  RulesBaseline,
} from '../../../shared/agent-rules'
import { THE_APP_DID_IT, type ActedBy } from '../../../shared/who-did-it'
import { DEFAULT_PROFILE_ID } from '../../../shared/profile-name'
import type { SessionStore } from '../../db/session-store'
import { foldProfileName } from '../../db/identity'
import { newInstructionAskId } from '../../db/ids'
import { whoDidIt, type Caller } from '../conversation-caller'
import type {
  AgentOwnNotesOutcome,
  AgentRulesOutcome,
  ProposeRulesOutcome,
} from './host-command-contracts'

interface InstructionDecisionOperations {
  store(): Pick<
    SessionStore,
    | 'instructionAsksWaiting'
    | 'ownInstructionsOf'
    | 'writeOwnInstructions'
    | 'settleInstructionAsk'
    | 'currentOwnNotesOf'
    | 'writeOwnNotes'
    | 'ownNotesOf'
    | 'ownNotesUnread'
    | 'undoOwnNotes'
    | 'markOwnNotesSeen'
    | 'capabilitiesOf'
    | 'parentOf'
    | 'instructionUnread'
    | 'undoOwnInstructions'
    | 'markInstructionsSeen'
  >
  rulesAuthor(me: string, by: Caller): RulesAuthor | null
  hasUnspawnedSlot(conversation: string): boolean
  /** Capture the current live session; invoke the returned publisher synchronously at the write. */
  instructionPublisher(
    conversation: string,
  ):
    | ((
        event: InstructionProposedEvent | InstructionChangedEvent | InstructionSettledEvent,
      ) => void)
    | null
  agentOwnNotes(profile: string): OwnNotesReading | null
  agentInstructions(profile: string): AgentInstructionsReading
  theWorldMoved(what: 'agents'): void
  now(): number
}

/** Read and version rules and own notes, and settle proposals against their recorded baseline. */
export class InstructionDecisions {
  constructor(private readonly ops: InstructionDecisionOperations) {}

  readOwnNotes(
    me: string,
    about: string | undefined,
    by: Caller,
  ): AgentOwnNotesOutcome<AgentOwnNotesReading> {
    const author = this.ops.rulesAuthor(me, by)
    if (author === null || (about !== undefined && typeof about !== 'string'))
      return {
        ok: false,
        rail: 'malformed-request',
        detail: { problems: [OWN_NOTES_READ_CALLER_PROBLEM] },
      }
    const profile = about === undefined ? author.profile : foldProfileName(about)
    const page = this.ops.store().currentOwnNotesOf(profile)
    if (page === null) return { ok: false, rail: 'no-such-agent', detail: { agent: profile } }
    const current = page.current
    return {
      ok: true,
      result: {
        profile: page.profile,
        version: current?.version ?? 0,
        text: current?.text ?? '',
        author: current?.author ?? null,
        reason: current?.reason ?? null,
      },
    }
  }

  writeOwnNotes(
    me: string,
    said: OwnNotesWrite,
    by: Caller,
  ): AgentOwnNotesOutcome<OwnNotesReceipt> {
    const author = this.ops.rulesAuthor(me, by)
    if (author === null)
      return {
        ok: false,
        rail: 'malformed-request',
        detail: { problems: [OWN_NOTES_WRITE_CALLER_PROBLEM] },
      }
    if (!ownNotesWriteFits(said))
      return {
        ok: false,
        rail: 'malformed-request',
        detail: { problems: [OWN_NOTES_BASELINE_PROBLEM] },
      }
    const page = this.ops.store().currentOwnNotesOf(author.profile)
    if (page === null || (page.current?.version ?? 0) !== said.expectedVersion)
      return {
        ok: false,
        rail: 'malformed-request',
        detail: { problems: [OWN_NOTES_STALE_PROBLEM] },
      }
    // The tool caller id is agent:<id>; the repository derives the author from the bare session id.
    const written = this.ops
      .store()
      .writeOwnNotes(author.profile, said, { who: 'an-agent', agent: me }, this.ops.now())
    if (written === null)
      return {
        ok: false,
        rail: 'malformed-request',
        detail: { problems: [OWN_NOTES_SAVE_PROBLEM] },
      }
    this.ops.theWorldMoved('agents')
    return {
      ok: true,
      result: {
        profile: author.profile,
        conversation: me,
        version: written.version,
        previousVersion: said.expectedVersion,
        author: written.author,
      },
    }
  }

  agentOwnNotes(profile: string): OwnNotesReading | null {
    return this.ops.store().ownNotesOf(foldProfileName(profile))
  }

  agentOwnNotesUnread(profile: string) {
    return this.ops.store().ownNotesUnread(foldProfileName(profile))
  }

  saveOwnNotes(profile: string, said: OwnNotesWrite, by: Caller): OwnNotesReading | null {
    const actor = whoDidIt(by)
    if (!ownNotesWriteFits(said)) return null
    const page = this.ops.store().currentOwnNotesOf(profile)
    if (page === null || (page.current?.version ?? 0) !== said.expectedVersion) return null
    const written = this.ops.store().writeOwnNotes(profile, said, actor, this.ops.now())
    if (written === null) return null
    this.ops.theWorldMoved('agents')
    return this.ops.agentOwnNotes(profile)
  }

  undoOwnNotes(profile: string, expectedVersion: number, by: Caller): OwnNotesReading | null {
    const actor = whoDidIt(by)
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return null
    const current = this.ops.store().currentOwnNotesOf(profile)?.current
    if (current == null || current.version !== expectedVersion) return null
    const written = this.ops
      .store()
      .undoOwnNotes(profile, { expectedVersion }, actor, this.ops.now())
    if (written === null) return null
    this.ops.theWorldMoved('agents')
    return this.ops.agentOwnNotes(profile)
  }

  markOwnNotesSeen(profile: string, throughVersion: number, by: Caller): boolean {
    const actor = whoDidIt(by)
    const before = this.ops.store().ownNotesUnread(profile).seenThrough
    const marked = this.ops.store().markOwnNotesSeen(profile, throughVersion, actor)
    if (marked && this.ops.store().ownNotesUnread(profile).seenThrough > before)
      this.ops.theWorldMoved('agents')
    return marked
  }

  proposeAgentRules(
    me: string,
    said: {
      readonly about: string
      readonly text: string
      readonly why: string
      readonly relaying: boolean
      readonly expectedVersion?: number
    },
    by: Caller,
  ): ProposeRulesOutcome {
    const author = this.ops.rulesAuthor(me, by)
    if (author === null) return { ok: false, rail: 'may-not-write-rules', detail: { you: null } }
    if (said.relaying)
      return {
        ok: false,
        rail: 'malformed-request',
        detail: { problems: ['already_agreed is not supported; leave it out'] },
      }
    if (
      typeof said.text !== 'string' ||
      said.text.length > OWN_INSTRUCTIONS_CHARS ||
      typeof said.why !== 'string' ||
      said.why.trim() === '' ||
      said.why.length > OWN_INSTRUCTIONS_CHARS
    )
      return {
        ok: false,
        rail: 'malformed-request',
        detail: { problems: ['rules and why must fit the size limit, and why must say why'] },
      }
    const about = foldProfileName(said.about)
    if (this.ops.store().capabilitiesOf(about) === null)
      return {
        ok: false,
        rail: 'no-such-agent',
        detail: { agent: about },
      }
    const publish = this.ops.instructionPublisher(me)
    if (publish === null)
      return { ok: false, rail: 'may-not-write-rules', detail: { you: author.profile } }
    const basedOnVersion = this.ops.store().ownInstructionsOf(about).versions[0]?.version ?? 0
    if (!Number.isSafeInteger(said.expectedVersion) || said.expectedVersion !== basedOnVersion)
      return {
        ok: false,
        rail: 'malformed-request',
        detail: {
          problems: ['the current rule version is required; read the rules again before proposing'],
        },
      }
    const askId = newInstructionAskId()
    publish({
      type: 'instruction_proposed',
      askId,
      ask: 'propose',
      about,
      proposedBy: author.profile,
      author,
      basedOnVersion,
      text: said.text,
      why: said.why.trim(),
    })
    return { ok: true, wrote: 'a-request', askId }
  }

  readAgentRules(me: string, about: string, by: Caller): AgentRulesOutcome<AgentRulesReading> {
    if (this.ops.rulesAuthor(me, by) === null)
      return {
        ok: false,
        rail: 'may-not-write-rules',
        detail: { you: null },
      }
    const profile = foldProfileName(about)
    if (this.ops.store().capabilitiesOf(profile) === null)
      return {
        ok: false,
        rail: 'no-such-agent',
        detail: { agent: profile },
      }
    const newest = this.ops.store().ownInstructionsOf(profile).versions[0]
    return {
      ok: true,
      result: {
        profile,
        version: newest?.version ?? 0,
        text: newest?.text ?? '',
        whoWroteIt: newest?.whoWroteIt ?? null,
        ...(newest?.author === undefined ? {} : { author: newest.author }),
        reason: newest?.said ?? null,
      },
    }
  }

  writeAgentRules(
    me: string,
    said: AgentRulesWrite,
    by: Caller,
  ): AgentRulesOutcome<AgentRulesReceipt> {
    const author = this.ops.rulesAuthor(me, by)
    if (author === null || author.profile !== DEFAULT_PROFILE_ID)
      return {
        ok: false,
        rail: 'may-not-write-rules',
        detail: { you: author?.profile ?? null },
      }
    // Both the live reservation and recorded parent survive a person's claim of a helper.
    if (!this.ops.hasUnspawnedSlot(me) || this.ops.store().parentOf(me) !== null)
      return {
        ok: false,
        rail: 'may-not-write-rules',
        detail: { you: author.profile, helper: true },
      }
    const profile = foldProfileName(said.about)
    if (profile === DEFAULT_PROFILE_ID)
      return {
        ok: false,
        rail: 'may-not-write-rules',
        detail: { you: author.profile, self: true },
      }
    if (this.ops.store().capabilitiesOf(profile) === null)
      return {
        ok: false,
        rail: 'no-such-agent',
        detail: { agent: profile },
      }
    if (
      !Number.isSafeInteger(said.expectedVersion) ||
      said.expectedVersion < 0 ||
      typeof said.text !== 'string' ||
      said.text.length > OWN_INSTRUCTIONS_CHARS ||
      typeof said.why !== 'string' ||
      said.why.trim() === '' ||
      said.why.length > OWN_INSTRUCTIONS_CHARS
    )
      return {
        ok: false,
        rail: 'malformed-request',
        detail: {
          problems: [
            'read the current rules, provide their version, and say why within the size limit',
          ],
        },
      }
    const previous = this.ops.store().ownInstructionsOf(profile).versions[0]
    if ((previous?.version ?? 0) !== said.expectedVersion)
      return {
        ok: false,
        rail: 'malformed-request',
        detail: { problems: ['the rules changed; read them again before replacing them'] },
      }
    const written = this.ops.store().writeOwnInstructions(
      {
        profileSlug: profile,
        text: said.text,
        whoWroteIt: 'an-agent-direct',
        author,
        by: whoDidIt(by),
        conversation: me,
        said: said.why.trim(),
        broughtBack: null,
        expectedVersion: said.expectedVersion,
      },
      this.ops.now(),
    )
    if (written === null)
      return {
        ok: false,
        rail: 'malformed-request',
        detail: { problems: ['the rules changed; read them again before replacing them'] },
      }
    const receipt: AgentRulesReceipt = {
      profile,
      conversation: me,
      version: written.version,
      previousVersion: previous?.version ?? 0,
      author,
      replacedPersonVersion:
        previous?.whoWroteIt === 'a-person' || previous?.whoWroteIt === 'an-agents-proposal'
          ? previous.version
          : null,
    }
    this.supersedeInstructionAsks(profile, whoDidIt(by))
    const publish = this.ops.instructionPublisher(me)
    if (publish !== null) publish({ type: 'instruction_changed', ...receipt })
    this.ops.theWorldMoved('agents')
    return { ok: true, result: receipt }
  }

  agentInstructions(profileSlug: string): AgentInstructionsReading {
    const about = foldProfileName(profileSlug)
    return {
      own: this.ops.store().ownInstructionsOf(profileSlug),
      waiting: this.ops
        .store()
        .instructionAsksWaiting()
        .filter((one) => one.asked.about === about),
      // Stamp the reading after both its versions and waiting proposals have been read.
      readAt: this.ops.now(),
    }
  }

  instructAgent(
    profileSlug: string,
    text: string,
    broughtBack: number | undefined,
    by: Caller,
    baseline?: RulesBaseline,
  ): AgentInstructionsReading | null {
    if (whoDidIt(by).who !== 'a-person') return null
    const current = this.ops.store().ownInstructionsOf(profileSlug).versions[0]
    const expected = baseline ?? {
      expectedVersion: current?.version ?? 0,
    }
    const written = this.ops.store().writeOwnInstructions(
      {
        profileSlug,
        text,
        expectedVersion: expected.expectedVersion,
        // This entry point writes the person as author; proposals use their own entry point.
        whoWroteIt: 'a-person',
        by: whoDidIt(by),
        conversation: null,
        said: null,
        broughtBack: broughtBack ?? null,
      },
      this.ops.now(),
    )
    if (written === null) return null
    this.supersedeInstructionAsks(profileSlug, whoDidIt(by))
    // Rules are identity data, so identity listings must be invalidated.
    this.ops.theWorldMoved('agents')
    return this.ops.agentInstructions(profileSlug)
  }

  agentRulesUnread(profile: string) {
    return this.ops.store().instructionUnread(profile)
  }

  undoAgentRules(
    profile: string,
    expectedVersion: number,
    by: Caller,
  ): AgentInstructionsReading | null {
    const actor = whoDidIt(by)
    if (actor.who !== 'a-person') return null
    const written = this.ops
      .store()
      .undoOwnInstructions(profile, expectedVersion, actor, this.ops.now())
    if (written === null) return null
    this.supersedeInstructionAsks(profile, actor)
    this.ops.theWorldMoved('agents')
    return this.ops.agentInstructions(profile)
  }

  markAgentRulesSeen(profile: string, throughVersion: number, by: Caller): boolean {
    const actor = whoDidIt(by)
    const marked = this.ops.store().markInstructionsSeen(profile, throughVersion, actor)
    if (marked) this.ops.theWorldMoved('agents')
    return marked
  }

  decideInstruction(askId: string, approve: boolean, by: Caller): AnswerAck {
    if (whoDidIt(by).who !== 'a-person')
      return {
        outcome: 'refused',
        reason: 'only a person can decide this request',
        stillOpen: true,
      }
    const waiting = this.ops
      .store()
      .instructionAsksWaiting()
      .find((one) => one.asked.askId === askId)
    if (waiting === undefined) {
      return {
        outcome: 'refused',
        reason: 'there is no request waiting by that name, so nothing was written',
        stillOpen: false,
      }
    }
    const actor = whoDidIt(by)
    if (approve) {
      if (
        waiting.asked.basedOnVersion === undefined ||
        (this.ops.store().ownInstructionsOf(waiting.asked.about).versions[0]?.version ?? 0) !==
          waiting.asked.basedOnVersion
      ) {
        this.endInstructionAsk(askId, 'superseded', THE_APP_DID_IT)
        return {
          outcome: 'refused',
          reason:
            'the rules changed or this request has no recorded baseline; ask for a new proposal',
          stillOpen: false,
        }
      }
      const written = this.ops.store().writeOwnInstructions(
        {
          profileSlug: waiting.asked.about,
          text: waiting.asked.text,
          whoWroteIt: 'an-agents-proposal',
          expectedVersion: waiting.asked.basedOnVersion,
          ...(waiting.asked.author === undefined ? {} : { author: waiting.asked.author }),
          // The person approves; the proposing conversation remains separate provenance.
          by: actor,
          conversation: waiting.conversation,
          said: waiting.asked.why,
          broughtBack: null,
        },
        this.ops.now(),
      )
      // A changed or vanished identity ends the request instead of leaving an unusable approval.
      if (written === null) {
        this.endInstructionAsk(askId, 'refused', THE_APP_DID_IT)
        return {
          outcome: 'refused',
          reason:
            'the agent or its rules changed, so nothing was written and the request has been taken down',
          stillOpen: false,
        }
      }
      this.supersedeInstructionAsks(waiting.asked.about, actor, askId)
      this.ops.theWorldMoved('agents')
    }
    if (!this.endInstructionAsk(askId, approve ? 'approved' : 'refused', actor)) {
      // Approval may have written even when another window wins the final settlement.
      return {
        outcome: 'refused',
        reason: 'somebody answered that request first',
        stillOpen: false,
      }
    }
    return { outcome: 'taken' }
  }

  private supersedeInstructionAsks(profile: string, by: ActedBy, except?: string): void {
    for (const waiting of this.ops.store().instructionAsksWaiting()) {
      if (waiting.asked.about === foldProfileName(profile) && waiting.asked.askId !== except) {
        this.endInstructionAsk(waiting.asked.askId, 'superseded', by)
      }
    }
  }

  // Publication writes and sends the live row; offline settlement uses the stored row.
  private endInstructionAsk(askId: string, ending: InstructionEnding, by: ActedBy): boolean {
    const waiting = this.ops
      .store()
      .instructionAsksWaiting()
      .find((one) => one.asked.askId === askId)
    if (waiting === undefined) return false
    const publish = this.ops.instructionPublisher(waiting.conversation)
    if (publish === null) {
      return this.ops.store().settleInstructionAsk(askId, ending, by, this.ops.now())
    }
    publish({ type: 'instruction_settled', askId, ending, by })
    return true
  }
}
