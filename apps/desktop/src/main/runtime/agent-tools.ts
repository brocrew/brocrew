import { createListTasksTool } from './tool-families/work-board'
import { createReplyToParentTool, replyFields } from './tool-families/work-reply'
import {
  createAskQuestionTool,
  createPassQuestionUpTool,
  createWithdrawQuestionTool,
} from './tool-families/question-routing'
import { AGENT_TOOL_INSTRUCTIONS, AGENT_TOOL_SERVER, type ToolName } from './tool-families/catalog'
import { type AgentToolAnswer, type AgentToolDefinition, type AgentToolset } from '@brobot2/runtime'
import { type AgentToolHost } from './tool-families/host'
import { type Caller, agentCallerId } from './conversation-caller'
import { type ListsAsLastRead, theEffortsSaid, theModelsSaid } from './model-rails'
import { NAVIGATION_LINKS_DESCRIPTION } from '../../shared/links'
import { NAVIGATION_TOOL_NAMES, withNavigationLinks } from './tool-navigation-links'
import { aLaunchRefused, aLaunchThatDidNotStart } from './tool-families/launch-failures'
import { answerInWords } from './agent-tool-answer-words'
import { conversationAddressing } from './tool-families/addressing'
import { createAnswerQuestionTool, createListQuestionsTool } from './tool-families/questions'
import {
  createCreateAgentTool,
  createGiveWorkTool,
  createRestoreAgentTool,
} from './tool-families/launch'
import {
  createFindFilesTool,
  createReadDocumentTool,
  createReadTranscriptTool,
  createSearchPastWorkTool,
} from './tool-families/documents'
import {
  createGetAgentStatusTool,
  createListAgentsTool,
  createListProfilesTool,
} from './tool-families/directory'
import { createInterruptAgentTool, createMessageAgentTool } from './tool-families/messaging'
import {
  createSearchWorkTool,
  createTakeOnWorkTool,
  createUpdateWorkTool,
  createWithdrawTaskTool,
} from './tool-families/work'
import {
  createProposeAgentRulesTool,
  createReadAgentRulesTool,
  createReadOwnNotesTool,
  createWriteAgentRulesTool,
  createWriteOwnNotesTool,
} from './tool-families/knowledge'
import { createRequestActionTool, createRequestMcpServerTool } from './tool-families/requests'
import { readerFields } from './tool-families/reader-inputs'
import { refusalAnswer } from './tool-families/answers'
import { refusalIn, refuseTool } from './tool-families/refusals'
import { themeAgentTools } from '../themes/agent-tools'

export { CONVERSATIONS_LISTED } from './agent-directory'
export { agentCallerId, sessionSpeakingAs } from './conversation-caller'
export { legacyStartRefusalWords as A_START_ITS_SIGN_IN_REFUSED } from '../providers/index'
export { AGENT_TOOL_SERVER } from './tool-families/catalog'
export { AGENT_TOOL_INSTRUCTIONS } from './tool-families/catalog'
export { toolsToldInTextFor } from './tool-families/catalog'
export { TOOL_NAMES } from './tool-families/catalog'
export { type ToolName } from './tool-families/catalog'
export { TOOL_REFUSALS } from '../../shared/refusals'
export { type ToolRefusal } from '../../shared/refusals'
export { whatItRunsOnSaid } from './tool-families/launch'
export { TOOL_INPUT_ENUMS } from './tool-families/catalog'
export { TOOL_PERMANENCE } from './tool-families/refusals'
export { toolRemedyOf } from './tool-families/refusals'
export { type PublishedRefusal } from './tool-families/refusals'
export { anEndedPieceSaid } from './tool-families/delivery'
export { aFollowUpOnAPieceYouHold } from './tool-families/delivery'
export { aMessageAboutAQueuedPiece } from './tool-families/delivery'
export { aFollowUpOnAPieceYouGaveAnother } from './tool-families/delivery'
export { aFollowUpOnAPieceYouDidNotGive } from './tool-families/delivery'
export { anAgentWithSeveralConversations } from './tool-families/delivery'
export { aTakeBackOfAPieceYouHold } from './tool-families/delivery'
export { aTakeBackOfAPieceYouHoldThatEnded } from './tool-families/delivery'
export { aTakeBackOfYourOwnWork } from './tool-families/delivery'
export { refuseTool } from './tool-families/refusals'
export { aLaunchThatDidNotStart } from './tool-families/launch-failures'
export { aWakeThatDidNotHappen } from './tool-families/launch-failures'
export { A_FOLDER_COULD_NOT_BE_MADE } from './tool-families/launch-failures'
export { A_WAKE_WHOSE_PROGRAM_COULD_NOT_RUN } from './tool-families/launch-failures'
export { A_WAKE_WHOSE_FOLDER_IS_GONE } from './tool-families/launch-failures'
export { A_PROVIDER_REFUSED_THE_START } from './tool-families/launch-failures'
export { A_WAKE_ITS_PROVIDER_REFUSED } from './tool-families/launch-failures'
export { A_CONVERSATION_CANNOT_INTERRUPT_ITSELF } from './tool-families/launch-failures'
export { A_CONVERSATION_CANNOT_ASK_ITSELF } from './tool-families/launch-failures'
export { A_WAKE_WHOSE_FOLDER_COULD_NOT_BE_MADE } from './tool-families/launch-failures'
export { A_REFUSED_ROW_SHOWS } from './tool-families/launch-failures'
export { aStartItsLoginOrSettingsRefused } from './tool-families/launch-failures'
export { THE_NEW_AGENT_WAS_MADE } from './tool-families/launch-failures'
export { REPLY_ADDRESSING_KEYS } from './tool-families/catalog'
export { ENDED_LISTED } from './tool-families/listings'
export { ENDED_LISTED_AT_MOST } from './tool-families/listings'
export { type AgentToolHost } from './tool-families/host'
export { THIS_APP_CANNOT_NAME_IT } from './tool-families/directory'
export { refusalIn } from './tool-families/refusals'

export function agentToolsFor(
  host: AgentToolHost,
  sessionId: string,
  /** Each provider's list as the app last read it, named in give_work's and create_agent's fields. */
  lists: ListsAsLastRead = {},
  /** The host supplies this launch-role snapshot; call-time authority remains at the host. */
  offersDirectRulesWrite = false,
): AgentToolset {
  const by: Caller = { ownerId: agentCallerId(sessionId) }
  const me = sessionId
  const theModels = theModelsSaid(lists)
  const theEfforts = theEffortsSaid(lists)

  const { selfRefusal, theConversationToReach } = conversationAddressing(host, by, me)

  const guarded = async (run: () => Promise<AgentToolAnswer>): Promise<AgentToolAnswer> => run()
  /**
   * **657 · `give_work`'s own classification of a launch that did not complete** — see
   * {@link aLaunchThatDidNotStart}. Per tool and by type: what it does not recognise it rethrows.
   */
  const launchedOrSaid = async (
    args: Record<string, unknown>,
    run: () => Promise<AgentToolAnswer>,
  ): Promise<AgentToolAnswer> => {
    try {
      return await run()
    } catch (error) {
      const failed = aLaunchThatDidNotStart(error)
      if (failed === null) throw error
      // **The host's own text goes to the log and nowhere else.** The model gets the closed reason;
      // the precise diagnostic — which can name a path — used to reach the transcript as *"<tool>
      // failed: …"*, and without this line it would now be recorded nowhere (review of `657`).
      console.warn(
        `give_work: the launch did not start (${failed.because}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      // **D-039 · and whether the give made a new agent before its launch failed** — a give
      // with `new: true` did ({@link THE_NEW_AGENT_WAS_MADE}).
      return refusalAnswer(
        aLaunchRefused(failed, args['new'] === true, {
          ...(typeof args['profile'] === 'string' ? { profile: args['profile'] } : {}),
          because: failed.because,
        }),
      )
    }
  }

  /** The advertised reply fields also supply the vocabulary of its diagnostics. */
  const replyInput = replyFields()

  /**
   * **`ToolName`, not `string`** (405). Every definition below is now the thing
   * {@link RuntimeHost.noteRefusal} is handed the name of, and typing the array is what makes that
   * a compile check rather than a cast: a tool whose `name` is not in {@link TOOL_NAMES} — the list
   * `347`'s *"a negative needs a search shape"* census is measured against — no longer builds.
   */
  const { readerInputs, readerFieldRefusal } = readerFields()

  const tools: (AgentToolDefinition & { readonly name: ToolName })[] = [
    createListAgentsTool(host, by, me, readerInputs, readerFieldRefusal, guarded),
    createGetAgentStatusTool(host, by, me, readerInputs, readerFieldRefusal, guarded),
    createGiveWorkTool(host, by, theModels, theEfforts, launchedOrSaid),
    createMessageAgentTool(host, by, me, selfRefusal, theConversationToReach, guarded),
    createReadDocumentTool(host, readerInputs, readerFieldRefusal, guarded),
    createReplyToParentTool(host, by, me, guarded, replyInput),
    createListTasksTool(host, by, me, readerInputs, readerFieldRefusal, guarded),
    createAnswerQuestionTool(host, by, me, guarded),
    createInterruptAgentTool(host, by, me, selfRefusal, guarded),
    createListQuestionsTool(host, me, readerInputs, readerFieldRefusal, guarded),
    createCreateAgentTool(host, by, me, theModels, theEfforts, guarded),
    createWithdrawTaskTool(host, by, guarded),
    createAskQuestionTool(host, by, me, selfRefusal, theConversationToReach, guarded),
    createListProfilesTool(host, by, me, guarded),
    createProposeAgentRulesTool(host, by, me, guarded),
    createPassQuestionUpTool(host, by, me, guarded),
    createWithdrawQuestionTool(host, by, guarded),
    createReadTranscriptTool(host, by, me, readerInputs, readerFieldRefusal, guarded),
    createUpdateWorkTool(host, by, guarded),
    createTakeOnWorkTool(host, by, guarded),
    createSearchWorkTool(host, me, guarded),
    createFindFilesTool(host, me, readerInputs, readerFieldRefusal, guarded),
    createRestoreAgentTool(host, by, me, guarded),
    createRequestMcpServerTool(host, me, guarded),
    createRequestActionTool(host, by, guarded),
  ]

  const recordsWhatItRefused = (
    one: AgentToolDefinition & { readonly name: ToolName },
  ): AgentToolDefinition => ({
    ...one,
    call: async (args: Record<string, unknown>): Promise<AgentToolAnswer> => {
      const answered = await one.call(args)
      // **AFTER the call and never around it.** A row written before the door answered would say
      // a rule refused something no rule had looked at yet, and a `try`/`finally` would write one
      // for a handler that threw — which is a BROKEN TOOL and deliberately not a refusal (307).
      const said = answerInWords(answered, {
        me,
        addressOf: (conversation) => host.addressOf(conversation),
        readAt: Date.now(),
      })
      const refused = refusalIn(one.name, answered.structured, said.text)
      if (refused !== null) host.noteRefusal(me, one.name, refused)
      return withNavigationLinks(
        one.name,
        said,
        {
          conversationName: (id) => host.nameByItsWork(id),
          conversationVisible: (id) => host.agentCard(id, by, me) !== null,
          conversationProfile: (id) => host.navigationProfileForConversation?.(id) ?? null,
          identity: (profile) => host.navigationIdentity?.(profile) ?? null,
          piece: (spelled) => {
            const read = host.pieceRecord(me, spelled)
            if (read.is === 'no-piece-by-that-name') return null
            const row = read.is === 'a-root' ? read.root : read.piece
            return { id: row.piece, label: row.label, title: row.title }
          },
        },
        args,
      )
    },
    description: NAVIGATION_TOOL_NAMES.has(one.name)
      ? `${one.description} ${NAVIGATION_LINKS_DESCRIPTION}`
      : one.description,
  })

  return {
    server: AGENT_TOOL_SERVER,
    instructions: AGENT_TOOL_INSTRUCTIONS,
    tools: [
      ...tools,
      ...themeAgentTools(
        () => host.themes,
        () => host.whatToCallTheConversation(me),
        (rail, detail) => refusalAnswer(refuseTool(rail, detail)),
        (answer) =>
          answerInWords(answer, {
            me,
            addressOf: (conversation) => host.addressOf(conversation),
            readAt: Date.now(),
          }),
      ),
      createSearchPastWorkTool(host, me, guarded),
      createReadAgentRulesTool(host, by, me, guarded),
      createWriteAgentRulesTool(host, by, me, guarded),
      createReadOwnNotesTool(host, by, me, guarded),
      createWriteOwnNotesTool(host, by, me, guarded),
    ]
      .filter((one) => one.name !== 'write_agent_rules' || offersDirectRulesWrite)
      .map(recordsWhatItRefused),
  }
}
