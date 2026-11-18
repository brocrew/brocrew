import { z } from 'zod'
import { TurnInProgress, type AgentToolAnswer, type AgentToolDefinition } from '@brobot2/runtime'
import type { Caller } from '../conversation-caller'
import type { AgentToolHost } from './host'
import type { ToolName } from './catalog'
import { answer, refusalAnswer } from './answers'
import { refuseTool } from './refusals'

export function createCompactAgentTool(
  host: Pick<AgentToolHost, 'compactAgent' | 'theConversationAddressed' | 'nameByItsWork'>,
  by: Caller,
  me: string,
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'compact_agent',
    description:
      'Compact an idle conversation you started, or one started under it, using its Compact action. Name it by its piece or conversation id.',
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: { agent: z.string().describe('The conversation, by its piece or id.') },
    call: (args) =>
      guarded(async () => {
        if (typeof args.agent !== 'string' || args.agent.length === 0) {
          return refusalAnswer(refuseTool('malformed-request', { problems: ['agent is required'] }))
        }
        const agent = host.theConversationAddressed(args.agent, by, me, 'interrupting')
        let outcome: Awaited<ReturnType<typeof host.compactAgent>>
        try {
          outcome = await host.compactAgent(agent, by)
        } catch (error) {
          if (!(error instanceof TurnInProgress)) throw error
          return answer({ outcome: 'busy', agent }, 'It’s working; try again when it’s idle.')
        }
        if (outcome === 'no-such-agent') return refusalAnswer(refuseTool(outcome, { agent }))
        if (outcome === 'not-below-you') {
          return answer(
            {
              outcome: 'refused',
              rail: outcome,
              permanence: 'permanent',
              retryable: false,
              remedy: null,
              reason:
                'Only conversations you started, or ones started under them, can be compacted here.',
            },
            'refused (not-below-you): Only conversations you started, or ones started under them, can be compacted here.',
          )
        }
        return answer({ outcome: 'ok', agent }, `Asked ${host.nameByItsWork(agent)} to compact.`)
      }),
  }
}
