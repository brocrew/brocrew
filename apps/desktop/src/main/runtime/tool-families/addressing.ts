import { type AgentToolAnswer } from '@brobot2/runtime'
import { type AgentToolHost } from './host'
import { type Caller } from '../conversation-caller'
import { TASK_IS_OPEN } from '../../../shared/tasks'
import { anAgentWithSeveralConversations } from './delivery'
import { pieceNumbersOf } from '../../../shared/piece-called'
import { refusalAnswer } from './answers'
import { refuseTool } from './refusals'
import { skippedRecordsSentence, unreadRowsSentence } from './listings'

// Addressing helpers and their reads belong to one toolset instance.

export function conversationAddressing(
  host: Pick<
    AgentToolHost,
    | 'agentCard'
    | 'pieceRecord'
    | 'theConversationAProfileNames'
    | 'theConversationAddressed'
    | 'tookItsPlace'
  >,
  by: Caller,
  me: string,
) {
  const ownPieceHelpers = (spelled: string) => {
    if (pieceNumbersOf(spelled) === null) return null
    const record = host.pieceRecord(me, spelled)
    if (record.is === 'no-piece-by-that-name') return null
    const piece = record.is === 'a-root' ? record.root : record.piece
    if (piece.owner !== me && host.tookItsPlace(piece.owner) !== me) return null
    const children = record.children.filter(
      (child) => child.owner !== me && host.tookItsPlace(child.owner) !== me,
    )
    const helpers = children.flatMap((child) => {
      const card = host.agentCard(child.owner, by, me)
      if (card === null || card.agent === me) return []
      const known = card.whose.is === 'an-identity-this-app-holds' ? card.whose : null
      return [
        {
          label: child.label,
          state: child.state,
          outcome: child.outcome,
          owner: card.agent,
          profile: known?.profile ?? null,
          name: known?.name ?? null,
        },
      ]
    })
    return {
      label: piece.label,
      helpers,
      children: children.length,
      rowsUnread: record.rowsUnread,
      ledgersSkipped: record.ledgersSkipped,
    }
  }

  const selfRefusal = (
    spelled: string,
    agent: string,
    payload: ReturnType<typeof refuseTool> = refuseTool('that-agent-is-you', { agent }),
  ): AgentToolAnswer => {
    const facts = spelled === agent ? null : ownPieceHelpers(spelled)
    const lines = [payload.reason]
    if (facts !== null) {
      if (facts.helpers.length > 0) {
        lines.push(`${facts.label} is your own piece.`)
        lines.push(
          `Its helpers: ${facts.helpers
            .map((helper) => {
              const who =
                helper.name === null
                  ? ''
                  : helper.name === helper.profile
                    ? `${helper.name} on `
                    : `${helper.name} (${helper.profile}) on `
              return `${who}${helper.label} (${TASK_IS_OPEN[helper.state] ? helper.state : `ended: ${helper.outcome ?? helper.state}`})`
            })
            .join('; ')}.`,
        )
        lines.push(
          "Reach a helper by its piece's label, even after it ended: message_agent with kind: note, or ask_question.",
        )
        if (facts.helpers.some((helper) => helper.profile !== null))
          lines.push('For new work, give_work with its profile.')
        lines.push('To stop a known conversation, interrupt_agent with its label.')
      } else if (facts.rowsUnread > 0 || (facts.ledgersSkipped ?? 0) > 0) {
        lines.push(`${facts.label} is your own piece. list_agents names who you can reach.`)
      } else {
        lines.push(
          facts.children === 0
            ? `${facts.label} is your own piece, with no helpers recorded under it. list_agents names who you can reach.`
            : `${facts.label} is your own piece. None of its helpers is in your reach. list_agents names who you can reach.`,
        )
      }
      if (facts.rowsUnread > 0) lines.push(unreadRowsSentence(facts.rowsUnread))
      if ((facts.ledgersSkipped ?? 0) > 0) lines.push(skippedRecordsSentence(facts.ledgersSkipped!))
    }
    const aSelfAddressSaid = lines.join(' ')
    return refusalAnswer({ ...payload, reason: aSelfAddressSaid })
  }

  const theConversationToReach = (
    spelled: string,
    forAMessage = false,
  ): { readonly agent: string } | { readonly refused: AgentToolAnswer } => {
    const addressed = host.theConversationAddressed(spelled, by, me, 'messaging')
    if (addressed !== spelled) return { agent: addressed }
    const named = host.theConversationAProfileNames(spelled, by, me, forAMessage)
    if (named === null) return { agent: spelled }
    if (named.is === 'one') return { agent: named.conversation }
    return {
      refused: refusalAnswer({
        ...refuseTool('that-agent-has-several-conversations', {
          agent: spelled,
          conversations: named.labels,
        }),
        reason: anAgentWithSeveralConversations(named.profile, named.labels),
      }),
    }
  }
  return { selfRefusal, theConversationToReach }
}
