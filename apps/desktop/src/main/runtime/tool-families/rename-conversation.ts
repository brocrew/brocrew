import {
  agentToolHandlerInput,
  type AgentToolDefinition,
  toolArgumentsAtHandler,
} from '@brobot2/runtime'
import { z } from 'zod'
import { answer } from './answers'
import type { AgentToolHost } from './host'
import { refuseTool } from './refusals'

export function createRenameConversationTool(
  host: Pick<AgentToolHost, 'renameConversation' | 'nameByItsWork'>,
  me: string,
): AgentToolDefinition & { readonly name: 'rename_conversation' } {
  return {
    name: 'rename_conversation',
    handlerOwnsMissingInput: true,
    description:
      'Rename a conversation, by any of its labels or its id. Name it after the job, not the task: short, distinguishing word first ("DEV-100012", "Lisbon trip, March"). Rename it as the job grows. Rename conversations you hold or gave work to, and never change a title the person set: if it should change, ask the person with ask_question. Every title is kept in the conversation’s history with who set it, so the person can see and restore an earlier one. To retitle a task, use update_work.',
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: {
      conversation: agentToolHandlerInput(
        z.string().describe('The conversation, by any of its task labels (W1.2) or its id.'),
      ),
      title: agentToolHandlerInput(
        z.string().describe('Its new title: one line, 1 to 200 characters.'),
      ),
    },
    call: async (raw) => {
      const args = toolArgumentsAtHandler(raw)
      const result = await host.renameConversation(
        {
          conversation: typeof args.conversation === 'string' ? args.conversation : '',
          title: typeof args.title === 'string' ? args.title : '',
        },
        { kind: 'agent', conversation: me },
      )
      if (!result.ok) {
        const rail = result.code === 'bad-title' ? 'malformed-request' : 'no-such-agent'
        const refusal = refuseTool(rail)
        return answer({ ...refusal, ...result }, result.reason)
      }
      const previous = result.previousAuthor
      const setBy =
        previous === null
          ? ''
          : `, set by ${previous.kind === 'person' ? 'the person' : host.nameByItsWork(previous.conversation)}`
      return answer(
        { outcome: 'ok', ...result },
        `Conversation ${result.address} is now titled "${result.title}". It was "${result.previousTitle}"${setBy}. Recorded as set by you.`,
      )
    },
  }
}
