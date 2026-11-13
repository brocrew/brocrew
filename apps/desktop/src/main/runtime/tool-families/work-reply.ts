import { toolFieldProblems } from './field-problems'
import { whereTheReplyWent } from './delivery'
import {
  type AgentToolAnswer,
  type AgentToolDefinition,
  agentToolHandlerInput,
  toolArgumentsAtHandler,
} from '@brobot2/runtime'
import { type AgentToolHost } from './host'
import { type Caller } from '../conversation-caller'
import { keptResources } from '../agent-tool-answer-words'
import { SAVED_METHOD_CHARS } from '../../../shared/work-fields'
import { HELD_FORMS_WITH_EXTENSIONS_SAID, MAX_RESOURCES_PER_REPLY } from '../../../shared/documents'
import { TASK_OUTCOMES, type TaskOutcome } from '../../../shared/task-contracts'
import { REPLY_SUMMARY_LIMIT, refuseReply } from '../reply-rails'
import {
  REPLY_ADDRESSING_KEYS,
  TOOL_INPUT_ENUMS,
  type ToolName,
  documentedToolEnum,
} from './catalog'
import { answer, refusalAnswer } from './answers'
import { carryReplyRefusal, refuseTool } from './refusals'
import { workRequestRefused } from '../spawn-rails'
import { z } from 'zod'

/** A vocabulary the validator has not been taught is a refusal, never a pass (`325`). */
const isTaskOutcome = (value: unknown): value is TaskOutcome =>
  typeof value === 'string' && (TASK_OUTCOMES as readonly string[]).includes(value)

export function createReplyToParentTool(
  host: Pick<AgentToolHost, 'maySaveMemory' | 'replyToParent'>,
  by: Caller,
  me: string,
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
  replyInput: ReturnType<typeof replyFields>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'reply_to_parent',
    handlerOwnsMissingInput: true,
    description:
      'Finish a piece of work you were given, or took on for a person, and tell the conversation that gave it. Name the piece — its label, like W1.2, or its id — and set the required outcome to done, blocked or failed; the app knows where it goes, and starts that conversation if nothing is running in it. A piece you took on with take_on_work goes to no other conversation: tell the person here. Hand back files with resource_paths: each is kept as a resource that conversation can read. Returns the piece’s label, the resources kept, and where the reply went: straight to that conversation, held until it is free, kept for its next start when it could not take it now, or not delivered — with why.',
    /**
     * **486 · the rails are the whole gate** (HO-031 §2.4).
     *
     * **HO-031 §2.9's own example.** *"The PM needed a human approval to call `mcp__brobot__reply_to_parent` — it had to ask permission to answer its parent."* The reply goes to the conversation that gave the work, `REPLY_RAILS` decide whether it lands, and a click here is the one that *breaks the loop the tools exist to make*.
     */
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: Object.fromEntries(
      Object.entries(replyInput).map(([field, schema]) => [field, agentToolHandlerInput(schema)]),
    ),
    call: (args) =>
      guarded(async () => {
        args = toolArgumentsAtHandler(args)
        // **An addressing argument is REFUSED, never overridden** (HO-015 §1.3, and `371`'s
        // defect said out loud). `371` shipped a `parentSessionId` that was silently taken and
        // replaced — *"enforcement was right and disclosure was wrong, and the caller was told its
        // argument was taken"*. Every spelling of the same idea is refused, because the thing
        // being refused is an INTENT.
        const aimed = REPLY_ADDRESSING_KEYS.filter((key) => Object.hasOwn(args, key))
        if (aimed.length > 0) {
          return refusalAnswer(
            refuseTool('malformed-request', {
              problems: aimed.map(
                (key) =>
                  `${key} is not an argument of this tool: a reply goes to the conversation that gave you the piece, and naming the piece is how you say which one`,
              ),
            }),
          )
        }
        const bothSummaryFields = args.summary !== undefined && Object.hasOwn(args, 'message')
        if (args.summary === undefined && Object.hasOwn(args, 'message')) {
          args = { ...args, summary: args.message }
        }
        const { piece, outcome, summary } = args
        const savedMethod = args.saved_method
        const methodReport =
          typeof savedMethod === 'string' && savedMethod.trim().length > 0 ? savedMethod : undefined
        const paths = args.resource_paths
        const resultDocument = args.result_document
        const { problems, problem, wrongType } = toolFieldProblems<string>()
        if (bothSummaryFields) {
          problem(
            'summary',
            'send only one of message and summary; message is accepted only when summary is absent',
          )
        }
        if (piece === undefined) problem('piece', 'required; expected non-empty text')
        else if (typeof piece !== 'string') wrongType('piece')
        else if (piece.length === 0) problem('piece', 'must not be empty')
        const outcomes = TOOL_INPUT_ENUMS['reply_to_parent:outcome'].members.join(', ')
        if (!isTaskOutcome(outcome)) {
          problem(
            'outcome',
            `${outcome === undefined ? 'required; ' : ''}expected one of ${outcomes}`,
          )
        }
        if (summary === undefined) problem('summary', 'required; expected non-empty text')
        else if (typeof summary !== 'string') wrongType('summary')
        else if (summary.trim().length === 0) problem('summary', 'must not be empty or blank')
        if (savedMethod !== undefined && typeof savedMethod !== 'string') {
          problem('saved_method', 'expected text, or absent')
        } else if (typeof savedMethod === 'string' && savedMethod.length > SAVED_METHOD_CHARS) {
          problem(
            'saved_method',
            `at most ${String(SAVED_METHOD_CHARS)} characters; got ${String(savedMethod.length)}`,
          )
        }
        if (
          paths !== undefined &&
          (!Array.isArray(paths) ||
            !paths.every((one) => typeof one === 'string' && one.length > 0))
        ) {
          problem('resource_paths', 'expected a list of non-empty text paths, or absent')
        } else if (Array.isArray(paths) && paths.length > MAX_RESOURCES_PER_REPLY) {
          problem(
            'resource_paths',
            `at most ${String(MAX_RESOURCES_PER_REPLY)} files; got ${String(paths.length)}`,
          )
        }
        if (args.needs_user_action !== undefined && typeof args.needs_user_action !== 'boolean') {
          problem('needs_user_action', 'expected true or false, or absent')
        }
        if (problems.length > 0) {
          const fields = Object.keys(replyInput)
          const unknown = Object.keys(args).filter(
            (key) => key !== 'message' && !Object.hasOwn(replyInput, key),
          )
          const detail = workRequestRefused(problems, args, fields)
          if (unknown.length === 0) return refusalAnswer(refuseTool('malformed-request', detail))
          const names = unknown.slice(0, 3).map((key) => {
            const name = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(key) ? key : 'unknown field'
            return `${name}: not a field of reply_to_parent; use ${fields.slice(0, -1).join(', ')} or ${fields.at(-1)}`
          })
          if (unknown.length > 3) names.push('Other unknown fields were also sent.')
          // Copying the detail leaves caller-named problems outside the identity marker.
          return refusalAnswer(
            refuseTool('malformed-request', { problems: [...detail.problems, ...names] }),
          )
        }
        if (
          resultDocument !== undefined &&
          (typeof resultDocument !== 'string' || resultDocument.length === 0)
        ) {
          const refused = refuseReply('result-document-not-returned')
          return answer(carryReplyRefusal(refused), `refused (${refused.rail}): ${refused.reason}`)
        }
        // **Not one rail is asked here.** Which piece this caller holds, whether it is still
        // open, how long a summary may be and whether a file may be kept are all the host's — the
        // module note's rule, and the reason the addressing question above is about the SHAPE of
        // the call rather than about who may reach whom.
        const replied = await host.replyToParent(
          {
            piece: piece as string,
            outcome: outcome as TaskOutcome,
            summary: summary as string,
            ...(methodReport === undefined ? {} : { savedMethod: methodReport }),
            resourcePaths: Array.isArray(paths) ? (paths as string[]) : [],
            ...(typeof resultDocument === 'string' ? { resultDocument } : {}),
            needsUserAction: args.needs_user_action === true,
          },
          by,
        )
        if (!replied.ok) {
          // **Two vocabularies arrive here and neither is translated** — this file's job is to
          // carry a refusal, and the resource sentences were written for exactly this caller.
          const carried = carryReplyRefusal(replied.refusal)
          return answer(carried, `refused (${replied.refusal.rail}): ${replied.refusal.reason}`)
        }
        // The files kept with the reply, by id (the outcome holds no names).
        const kept = replied.resources.length === 0 ? '' : ` ${keptResources(replied.resources)}`
        const main =
          replied.resultDocument === undefined ? '' : ` Main result: ${replied.resultDocument}.`
        const saveMethod =
          methodReport === undefined && host.maySaveMemory(me)
            ? " If this work taught you a tested method you would reuse, save it now as your Saved methods section says; otherwise you're done."
            : ''
        // **D-016 · commit 6 · R5 — a person's own request, answered and delivered nowhere**:
        // there is no conversation it went to, so the payload carries no `delivered` at all.
        if (replied.delivered === null) {
          return answer(
            {
              outcome: 'ok',
              piece: replied.piece,
              label: replied.label,
              state: 'answered',
              resources: replied.resources,
              ...(replied.resultDocument === undefined
                ? {}
                : { result_document: replied.resultDocument }),
            },
            `${replied.label} answered · it was a person’s own request, so the reply went to no other conversation — tell them here.${kept}${main}${saveMethod}`,
          )
        }
        return answer(
          {
            outcome: 'ok',
            piece: replied.piece,
            label: replied.label,
            state: 'answered',
            resources: replied.resources,
            ...(replied.resultDocument === undefined
              ? {}
              : { result_document: replied.resultDocument }),
            delivered: replied.delivered,
            ...(replied.why === undefined ? {} : { why: replied.why }),
          },
          `${replied.label} answered · ${whereTheReplyWent(replied)}${kept}${main}${saveMethod}`,
        )
      }),
  }
}

export function replyFields() {
  const replyInput = {
    piece: z
      .string()
      // **A description that tells a model where a value comes from has to be re-read every
      // time a new place supplies it** — `a description hardens into a ruling in the docblock it
      // leaves`. D-016 · the brief names the label ({@link messageNamingThePiece}), and so do
      // `list_tasks` and the sender line.
      .describe(
        'The piece you are finishing — its label (W1.2) or its id. The brief that gave it to you names it — or take_on_work’s answer, for work you took on — and list_tasks lists it.',
      ),
    outcome: documentedToolEnum(
      TOOL_INPUT_ENUMS['reply_to_parent:outcome'],
      'How the work ended.',
      'Anything else is refused and no reply is recorded.',
    ),
    summary: z
      .string()
      .describe(
        `What the conversation that gave you this needs to read — for work you took on for a person, what its record keeps as its last status line. At most ${REPLY_SUMMARY_LIMIT.toLocaleString('en-US')} characters (UTF-16 code units). Put longer detail in a file listed in resource_paths. Nothing is shortened for you.`,
      ),
    saved_method: z
      .string()
      .max(SAVED_METHOD_CHARS)
      .optional()
      .describe(
        'What you saved to your Saved methods from this work: its file name, or none and why, in a few words. Save before you hand back.',
      ),
    resource_paths: z
      .array(z.string())
      .optional()
      .describe(
        // 736 · `733` F-4 — the kinds rendered from the store's own list, not asserted.
        `Files to hand back with the reply, at most ${String(MAX_RESOURCES_PER_REPLY)} — ${HELD_FORMS_WITH_EXTENSIONS_SAID} — anywhere; a relative path is read from your own working directory. Each is copied and hashed and kept as a resource, and the reply carries its id instead of its contents.`,
      ),
    result_document: z
      .string()
      .optional()
      .describe(
        "The main result document's path, also listed in resource_paths. Leave it out to hand back files without naming a main document.",
      ),
    needs_user_action: z
      .boolean()
      .optional()
      .describe('Set this when a person has to do something before anything else can happen.'),
  }
  return replyInput
}
