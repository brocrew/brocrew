import { type AgentToolAnswer } from '@brobot2/runtime'
import { ENDED_LISTED_AT_MOST, LIMIT_DESCRIBED } from './listings'
import { MADE_FILES_LISTED } from '../../../shared/documents'
import { TOOL_INPUT_ENUMS, documentedToolEnum } from './catalog'
import { TURNS_BACK_DEFAULT, TURNS_BACK_MAX } from '../../../shared/last-exchange'
import { refusalAnswer } from './answers'
import { refuseTool } from './refusals'
import { workRequestRefused } from '../spawn-rails'
import { z } from 'zod'

// Reader schemas are created once per toolset, as are their handler diagnostics.

/** **D-037 · the most words one `find_files` search holds a file to.** */
export const MOST_WORDS_FOUND = 20

export function readerFields() {
  const readerInputs = {
    list_agents: {
      archived: z
        .boolean()
        .optional()
        .describe(
          'true lists the archived conversations instead, the most recently archived first, each with when it was archived and by whom. Leave it out for the conversations that are not archived.',
        ),
    },
    get_agent_status: {
      agent: z
        .string()
        .describe('The agent, by the piece it owns (W1.2) or by its id from list_agents.'),
    },
    read_document: {
      resource: z
        .string()
        .describe(
          'The resource id — res_… — as a reply names it, list_tasks naming its piece, list_tasks with made, or find_files.',
        ),
    },
    list_tasks: {
      piece: z
        .string()
        .optional()
        .describe(
          'A piece’s label (W1.2) or id to read its record. Leave it out for your own board.',
        ),
      made: z
        .boolean()
        .optional()
        .describe(
          `true lists the files your profile’s conversations made, newest first — at most ${String(MADE_FILES_LISTED)} — each with the piece it was kept on and when. Refused with piece.`,
        ),
      state: documentedToolEnum(
        TOOL_INPUT_ENUMS['list_tasks:state'],
        'Which pieces of your board to list.',
        'Refused with piece or made.',
      ).optional(),
      limit: z
        .number()
        .int()
        .min(1)
        .max(ENDED_LISTED_AT_MOST)
        .optional()
        .describe(`${LIMIT_DESCRIBED('pieces')} Refused with piece or made.`),
    },
    list_questions: {
      state: documentedToolEnum(
        TOOL_INPUT_ENUMS['list_questions:state'],
        'Which questions to list.',
      ).optional(),
      limit: z
        .number()
        .int()
        .min(1)
        .max(ENDED_LISTED_AT_MOST)
        .optional()
        .describe(LIMIT_DESCRIBED('questions')),
    },
    read_transcript: {
      agent: z
        .string()
        .describe('The agent, by the piece it owns (W1.2) or by its id from list_agents.'),
      turns_back: z
        .number()
        .optional()
        .describe(
          `How many of its turns to read, newest last: 1 to ${String(TURNS_BACK_MAX)}; ${String(TURNS_BACK_DEFAULT)} when left out.`,
        ),
      search: z
        .string()
        .optional()
        .describe(
          'Read instead the turns whose messages or answers contain these words (letters matched regardless of case).',
        ),
    },
    find_files: {
      where: documentedToolEnum(TOOL_INPUT_ENUMS['find_files:where'], 'Where to look.').optional(),
      words: z
        .string()
        .optional()
        .describe(
          `Words a file must hold, separated by spaces, at most ${String(MOST_WORDS_FOUND)}; case does not matter. Leave it out to list the files.`,
        ),
      older_than: z
        .string()
        .optional()
        .describe(
          'The id (res_…) an earlier answer gave to go on from: only files kept before it.',
        ),
    },
  } satisfies Record<string, z.ZodRawShape>

  const readerFieldRefusal = (
    name: keyof typeof readerInputs,
    args: Readonly<Record<string, unknown>>,
    valueProblems: readonly string[] = [],
  ): AgentToolAnswer | null => {
    const parsed = z.object(readerInputs[name]).strict().safeParse(args)
    const issues: z.core.$ZodIssue[] = (parsed.success ? [] : parsed.error.issues)
      .filter(
        (issue) =>
          issue.code === 'unrecognized_keys' ||
          (issue.code === 'invalid_type' &&
            ['string', 'boolean', 'number'].includes(issue.expected)),
      )
      .map((issue) => {
        if (issue.code !== 'invalid_type' || args[String(issue.path[0])] !== undefined) return issue
        const field = String(issue.path[0])
        const message =
          field === 'agent'
            ? 'required; name the agent by the piece it owns (W1.2) or its id'
            : field === 'resource'
              ? 'required; send the resource id (res_…)'
              : 'required; send text'
        return { code: 'custom', path: issue.path, message }
      })
    const remaining = valueProblems.filter(
      (problem) =>
        !issues.some((issue) => issue.path.length > 0 && problem.startsWith(String(issue.path[0]))),
    )
    if (issues.length === 0 && remaining.length === 0) return null
    const detail = workRequestRefused(issues, args, Object.keys(readerInputs[name]))
    return refusalAnswer(
      refuseTool(
        'malformed-request',
        remaining.length === 0 ? detail : { problems: [...detail.problems, ...remaining] },
      ),
    )
  }
  return { readerInputs, readerFieldRefusal }
}
