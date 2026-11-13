import { AGENT_TOOL_SERVER, TOOL_INPUT_ENUMS, type ToolName, documentedToolEnum } from './catalog'
import { type AgentToolAnswer, type AgentToolDefinition } from '@brobot2/runtime'
import { type AgentToolHost } from './host'
import { type Caller } from '../conversation-caller'
import { HELD_FORMS_WITH_EXTENSIONS_SAID, MAX_RESOURCES_PER_REPLY } from '../../../shared/documents'
import {
  MAX_EXTERNAL_MCP_GRANTS,
  externalMcpNameRefusal,
  externalMcpUrlRefusal,
} from '../../../shared/external-mcp'
import {
  MCP_SERVER_REQUEST_WHO,
  MCP_SERVER_URL_CHARS,
  type McpServerRequestWho,
} from '../../../shared/mcp-server-requests'
import { PATH_SEGMENT_RULE, isPathSegment } from '../../../shared/runtime-ipc'
import { REPLY_SUMMARY_LIMIT } from '../reply-rails'
import { type ToolRefusal, carryQuestionRefusal, refuseTool } from './refusals'
import { answer, refusalAnswer } from './answers'
import { z } from 'zod'

/** Every argument `request_mcp_server` advertises, as a type its advertisement satisfies. */
interface RequestMcpServerArguments {
  /** The server's name, which its tools are published under. */
  readonly name: string
  /** The server's address, on this machine. */
  readonly url: string
  /** What the agent says the server can read and do. A claim the person reads. */
  readonly reaches: string
  /** Who would get it. */
  readonly who_gets_it: McpServerRequestWho
  /** With `only-these-agents`: the agents, as `list_profiles` names them. */
  readonly agents?: readonly string[]
  /** The caller's own piece of work this is for. */
  readonly piece?: string
}

/**
 * A `request_mcp_server` refusal said with the name and numbers it met, or `null` for the rail's
 * general sentence.
 */
function aServerRequestRefusal(
  rail: ToolRefusal,
  detail: Readonly<Record<string, unknown>>,
): string | null {
  const name = typeof detail.name === 'string' ? detail.name : null
  switch (rail) {
    case 'server-already-registered': {
      if (name === null) return null
      const already =
        typeof detail.address === 'string'
          ? `the server at ${detail.address} is already registered, as “${name}”`
          : `a server called “${name}” is already registered`
      return `ask the person with ask_question (a-person) to grant “${name}” to your profile if you need it and do not have it: ${already}, and a request cannot change a registered server, so nothing was asked.`
    }
    case 'server-already-asked-for': {
      if (name === null || typeof detail.request !== 'string') return null
      const asked = `the request already waiting on them to register “${name}”, so nothing new was asked.`
      return detail.yours === true
        ? `wait for the person to decide request ${detail.request}, which you made: it is ${asked} You will be told when they decide.`
        : `wait for the person to decide request ${detail.request}, which another conversation made: it is ${asked} If they approve it and you do not get it, ask them with ask_question (a-person) to grant it to your profile.`
    }
    case 'too-many-server-requests': {
      if (typeof detail.waiting !== 'number') return null
      return detail.from === 'this-conversation'
        ? `wait until one is decided: ${String(detail.waiting)} server requests from this conversation are already waiting on the person, so nothing was asked.`
        : `wait until some are decided, then ask again: ${String(detail.waiting)} server requests from agents are already waiting on the person, so nothing was asked.`
    }
    case 'no-agent-by-that-name': {
      const agents = Array.isArray(detail.agents) ? detail.agents.map(String) : []
      if (agents.length === 0) return null
      const said = agents.map((one) => `“${one}”`).join(', ')
      return `name each agent as list_profiles gives it: no agent has the profile ${said}, so nothing was asked.`
    }
    default:
      return null
  }
}

export function createRequestMcpServerTool(
  host: Pick<AgentToolHost, 'requestMcpServer'>,
  me: string,
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'request_mcp_server',
    description:
      'Ask the person to register an outside MCP server, so you and the agents you name can use its tools. Give its name, its exact address, what it can read and do, and who should get it. This registers nothing and contacts nothing: the request waits under Waiting on you until the person approves or refuses it, and they may not be looking now. When they decide, this conversation is told. If they approve and your own profile gets the server, this conversation is reopened once it is idle, so the server’s tools reach you; not while it runs work in the background or is planning, which a reopen would end. Returns what happened, or a refusal naming the rule that stopped it.',
    /**
     * Any agent may ask, with no grant: what guards the registry is the person's press, behind
     * `requireAPerson` on the window's decide command, which no toolset carries.
     */
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: {
      name: z
        .string()
        .describe(
          `A short name for the server, which its tools are published under: ${PATH_SEGMENT_RULE}, never two underscores together, and not ${AGENT_TOOL_SERVER}.`,
        ),
      url: z
        .string()
        .describe(
          'The server’s full address, exactly as it should be registered, for example http://127.0.0.1:8765/mcp. It must be on this machine and carry no username or password.',
        ),
      reaches: z
        .string()
        .describe(
          `What this server can read and do, in your own words, at most ${REPLY_SUMMARY_LIMIT.toLocaleString('en-US')} characters. The person reads this before deciding.`,
        ),
      who_gets_it: documentedToolEnum(
        TOOL_INPUT_ENUMS['request_mcp_server:who_gets_it'],
        'Who should get the server.',
      ),
      agents: z
        .array(z.string())
        .optional()
        .describe(
          `With only-these-agents: which agents, as list_profiles names them (1 to ${String(MAX_EXTERNAL_MCP_GRANTS)}).`,
        ),
      piece: z
        .string()
        .optional()
        .describe('Optional: the label of your piece of work this is for.'),
    } satisfies Readonly<Record<keyof RequestMcpServerArguments, z.ZodType>>,
    call: (args) =>
      guarded(async () => {
        const problems: string[] = []
        const { name, url, reaches, who_gets_it: who, agents, piece } = args
        if (typeof name !== 'string') {
          problems.push('name is required: a short name for the server')
        } else {
          const bad = externalMcpNameRefusal(name, AGENT_TOOL_SERVER)
          if (bad !== null) problems.push(bad)
        }
        if (typeof url !== 'string') {
          problems.push('url is required: the server’s full address')
        } else if (url.length > MCP_SERVER_URL_CHARS) {
          problems.push(`url must be at most ${String(MCP_SERVER_URL_CHARS)} characters`)
        } else {
          const bad = externalMcpUrlRefusal(url)
          if (bad !== null) problems.push(bad)
        }
        if (
          typeof reaches !== 'string' ||
          reaches.trim().length === 0 ||
          reaches.length > REPLY_SUMMARY_LIMIT
        ) {
          problems.push(
            `reaches is required: what the server can read and do, at most ${String(REPLY_SUMMARY_LIMIT)} characters`,
          )
        }
        const whoIsKnown = MCP_SERVER_REQUEST_WHO.some((one) => one === who)
        if (!whoIsKnown) {
          problems.push(`who_gets_it is required and takes ${MCP_SERVER_REQUEST_WHO.join(' or ')}`)
        }
        const named = Array.isArray(agents) ? (agents as unknown[]) : null
        if (who === 'only-these-agents') {
          if (
            named === null ||
            named.length === 0 ||
            named.length > MAX_EXTERNAL_MCP_GRANTS ||
            named.some((one) => typeof one !== 'string' || !isPathSegment(one))
          ) {
            problems.push(
              `agents is required with only-these-agents: 1 to ${String(MAX_EXTERNAL_MCP_GRANTS)} agents, as list_profiles names them`,
            )
          }
        } else if (who === 'everyone' && agents !== undefined) {
          problems.push(
            'agents goes only with only-these-agents: everyone already means every agent',
          )
        }
        if (piece !== undefined && (typeof piece !== 'string' || piece.length === 0)) {
          problems.push('piece must name a piece of work you hold, or be left out')
        }
        if (problems.length > 0) {
          return refusalAnswer(refuseTool('malformed-request', { problems }))
        }
        const asked = host.requestMcpServer(me, {
          name: name as string,
          url: url as string,
          reaches: (reaches as string).trim(),
          whoGetsIt: who as McpServerRequestWho,
          agents: who === 'only-these-agents' ? (named as string[]) : [],
          piece: typeof piece === 'string' ? piece : null,
        })
        if (!asked.ok) {
          const refused = refuseTool(asked.rail, asked.detail)
          const reason = aServerRequestRefusal(asked.rail, asked.detail)
          return refusalAnswer(reason === null ? refused : { ...refused, reason })
        }
        return answer(
          { outcome: 'ok', request: asked.requestId },
          `Put in front of the person as request ${asked.requestId}. Nothing is registered unless they approve it, and they may not be looking now. Carry on with what you can; you will be told when they decide.`,
        )
      }),
  }
}

export function createRequestActionTool(
  host: Pick<AgentToolHost, 'requestAnAction'>,
  by: Caller,
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'request_action',
    description:
      'Ask the person to do something only they can do — a click, a check, a sign-in, a file to look at — as a to-do under Waiting on you, about a piece you hold. Say what to do, and hand them files with resources. Name the piece, or leave it out when you hold only one. This does not wait: the person answers Done or Can’t do it, with a note if they like, and the answer reaches you as a message. To mark the piece as waiting on it, call update_work with on: {person: "<the question id this returns>"}. A request in your reply is not a to-do, and shows nowhere.',
    /** It writes a request and hands nobody work: only the person's answer reaches the caller. */
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: {
      piece: z
        .string()
        .optional()
        .describe(
          'Which piece the to-do is for, by its label (W1.2) or id. Leave it out when you hold only one.',
        ),
      action: z
        .string()
        .describe(
          `What the person should do, in plain words, at most ${String(REPLY_SUMMARY_LIMIT)} characters. It shows under Waiting on you with Markdown: **bold**, lists, \`code\` for ids and paths, and links to files.`,
        ),
      resources: z
        .array(z.string())
        .optional()
        .describe(
          `Files to hand the person, at most ${String(MAX_RESOURCES_PER_REPLY)} — ${HELD_FORMS_WITH_EXTENSIONS_SAID} — anywhere; a relative path is read from your own working directory. Each is kept for the piece.`,
        ),
    },
    call: (args) =>
      guarded(async () => {
        const piece = args['piece']
        const action = args['action']
        const paths = args['resources']
        const problems: string[] = []
        if (piece !== undefined && (typeof piece !== 'string' || piece.length === 0)) {
          problems.push("piece must be a piece's label or id, or left out")
        }
        const said = typeof action === 'string' ? action.trim() : ''
        if (said === '' || said.length > REPLY_SUMMARY_LIMIT) {
          problems.push(
            `action must say what to do, in 1 to ${String(REPLY_SUMMARY_LIMIT)} characters`,
          )
        }
        if (
          paths !== undefined &&
          (!Array.isArray(paths) ||
            !paths.every((one) => typeof one === 'string' && one.length > 0))
        ) {
          problems.push('resources must be a list of paths, or absent')
        } else if (Array.isArray(paths) && paths.length > MAX_RESOURCES_PER_REPLY) {
          problems.push(
            `resources may name at most ${String(MAX_RESOURCES_PER_REPLY)} files, and it named ${String(paths.length)}`,
          )
        }
        if (problems.length > 0) {
          return refusalAnswer(refuseTool('malformed-request', { problems }))
        }
        const asked = await host.requestAnAction(
          {
            piece: typeof piece === 'string' ? piece : null,
            action: said,
            files: Array.isArray(paths) ? (paths as string[]) : [],
          },
          by,
        )
        if ('resourceRefusal' in asked) {
          const { resourceRefusal } = asked
          return answer(
            { ...resourceRefusal },
            `refused (${resourceRefusal.rail}): ${resourceRefusal.reason}`,
          )
        }
        if (!asked.ok) {
          const carried = carryQuestionRefusal(asked.refusal)
          return answer(carried, `refused (${asked.refusal.rail}): ${asked.refusal.reason}`)
        }
        return answer(
          { outcome: 'ok', question: asked.question },
          `The to-do is under Waiting on you as ${asked.question}. The person answers Done or Can’t do it, and the answer reaches you as a message; they may not be looking now. Carry on from here.`,
        )
      }),
  }
}
