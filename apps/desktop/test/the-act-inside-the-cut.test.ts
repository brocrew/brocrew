import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TOOL_SUMMARY_MAX } from '../../../packages/runtime/src/claude/normalize'
import {
  A_CONVERSATION_CANNOT_INTERRUPT_ITSELF,
  A_CONVERSATION_CANNOT_ASK_ITSELF,
  A_FOLDER_COULD_NOT_BE_MADE,
  A_PROVIDER_REFUSED_THE_START,
  A_WAKE_ITS_PROVIDER_REFUSED,
  A_WAKE_WHOSE_FOLDER_COULD_NOT_BE_MADE,
  A_WAKE_WHOSE_FOLDER_IS_GONE,
  A_WAKE_WHOSE_PROGRAM_COULD_NOT_RUN,
  TOOL_REFUSALS,
  aFollowUpOnAPieceYouDidNotGive,
  aFollowUpOnAPieceYouGaveAnother,
  aMessageAboutAQueuedPiece,
  aStartItsLoginOrSettingsRefused,
  aFollowUpOnAPieceYouHold,
  aTakeBackOfAPieceYouHold,
  aTakeBackOfAPieceYouHoldThatEnded,
  aTakeBackOfYourOwnWork,
  anAgentWithSeveralConversations,
  anEndedPieceSaid,
  refuseTool,
} from '../src/main/runtime/agent-tools'
import { SPAWN_RAILS, refuse, type SpawnRefusalDetail } from '../src/main/runtime/spawn-rails'
import { MESSAGE_RAILS, refuseMessage } from '../src/main/runtime/message-rails'
import { REPLY_RAILS, refuseReply, replyUnkeptFileReason } from '../src/main/runtime/reply-rails'
import { QUESTION_RAILS, refuseQuestion } from '../src/main/runtime/question-rails'
import { INTERRUPT_RAILS, refuseInterrupt } from '../src/main/runtime/interrupt-rails'
import { RESOURCE_RAILS, refuseResource } from '../src/main/resources/resources'
import { MODEL_RAILS, refuseModel, type ModelRefusalDetail } from '../src/main/runtime/model-rails'
import { RAIL_PERMANENCES } from '../src/shared/refusals'
import { pastWorkSearchRefusal } from '../src/shared/past-work-search'
import {
  WORK_SEARCH_RAILS,
  WORK_SEARCH_REFUSAL_WORDS,
  workSearchRefusal,
} from '../src/shared/work-search-words'
import { PROVIDER_NAME } from '../src/shared/runtime-ipc'
import {
  aPieceNotEndedItsQuestionsUnread,
  aPieceNotEndedWhileAQuestionStarts,
} from '../src/shared/questions'

const here = dirname(fileURLToPath(import.meta.url))
const mainRoot = join(here, '../src/main')
const sharedRoot = join(here, '../src/shared')

const rowOf = (rail: string, sentence: string): string => `refused (${rail}): ${sentence}`

function whereTheActSits(
  row: string,
  act: string,
): 'inside' | { readonly past: number } | 'not-in-the-row' {
  const at = row.indexOf(act)
  if (at < 0) return 'not-in-the-row'
  const ends = at + act.length
  return ends <= TOOL_SUMMARY_MAX ? 'inside' : { past: ends }
}

const LONG_SLUG = 'a'.repeat(64)
const LONG_PATH = `/Users/somebody/${'deep/'.repeat(50)}folder`
const LABEL_LISTS = new Set(['held', 'stalled', 'choices'])
const BOTH_PROTECTIONS = ['the-card-before-an-act', 'the-sandbox-around-an-act'] as const
const LONG_MODEL = 'm'.repeat(120)
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const NOT_ASKED = 'Not logged in · Please run /login'

const SPAWN_DETAILS: Partial<Record<(typeof SPAWN_RAILS)[number], readonly SpawnRefusalDetail[]>> =
  {
    'name-the-piece-you-give-from': [{ held: ['W12', 'W3.4.1', 'W3.4.2'] }],
    'too-deep': [{ depth: 7, maxDepth: 6, label: 'W1.1.1.1.1.1.1' }],
    'no-free-worker-at-capacity': [{ profileId: LONG_SLUG }],
    'no-room-for-provider-conversation': [{ profileId: LONG_SLUG, provider: 'codex' }],
    'service-provider-is-fixed': [
      { profileId: LONG_SLUG, provider: 'codex', choices: [LONG_MODEL] },
    ],
    'worker-binding-is-unknown': [{ profileId: LONG_SLUG }],
    'that-profile-exists': [{ profileId: LONG_SLUG }],
    'wider-than-its-parent': [
      { asked: 'auto', spawnerRunsAs: 'ask', wouldLack: BOTH_PROTECTIONS },
      { asked: 'auto', spawnerRunsAs: 'ask', wouldLack: [] },
    ],
    'no-such-profile': [{ profileId: LONG_SLUG }],
    'its-record-cannot-be-read': [{ profileId: LONG_SLUG }],
    'its-provider-is-not-chosen': [
      { profileId: LONG_SLUG, startedOn: { claude: 9999, codex: 9999 } },
    ],
    'folder-unusable': [{ folderReason: `cwd does not exist: ${LONG_PATH}` }],
  }

const MODEL_DETAILS: Partial<Record<(typeof MODEL_RAILS)[number], readonly ModelRefusalDetail[]>> =
  {
    'model-not-in-the-list': [
      {
        door: 'give',
        provider: 'claude',
        model: LONG_MODEL,
        choices: ['default', 'opus', 'sonnet', 'haiku'],
      },
    ],
    'effort-not-offered': [
      { door: 'give', model: LONG_MODEL, efforts: [] },
      { door: 'give', model: LONG_MODEL, effort: 'minimal', efforts: CLAUDE_EFFORTS },
    ],
    'models-unavailable': [
      { door: 'give', provider: 'claude', model: LONG_MODEL, why: NOT_ASKED },
      { door: 'give', provider: 'codex', effort: 'xhigh' },
      { door: 'give', provider: 'claude', effort: 'xhigh', why: NOT_ASKED },
    ],
    'models-not-read-in-time': [
      { door: 'give', provider: 'codex', model: LONG_MODEL },
      { door: 'give', provider: 'codex', effort: 'xhigh' },
    ],
    'name-the-model-too': [{ door: 'create' }],
    'the-provider-moved-meanwhile': [{ door: 'give', provider: 'claude' }],
  }
const MODEL_LISTS = new Set(['choices', 'efforts'])

interface Row {
  readonly key: string
  readonly rail: string
  readonly row: string
}

const VOCABULARIES: readonly {
  readonly name: string
  readonly module: string
  readonly rails: readonly string[]
  readonly arms: (rail: string) => readonly string[]
}[] = [
  {
    name: 'WORK_SEARCH_RAILS',
    module: 'shared/work-search-words.ts',
    rails: WORK_SEARCH_RAILS,
    arms: (rail) => [
      workSearchRefusal(rail.slice('work-search-'.length) as keyof typeof WORK_SEARCH_REFUSAL_WORDS)
        .reason,
    ],
  },
  {
    name: 'TOOL_REFUSALS',
    module: 'runtime/agent-tools.ts',
    rails: TOOL_REFUSALS,
    arms: (rail) => [refuseTool(rail as never).reason],
  },
  {
    name: 'SPAWN_RAILS',
    module: 'runtime/spawn-rails.ts',
    rails: SPAWN_RAILS,
    arms: (rail) =>
      (SPAWN_DETAILS[rail as (typeof SPAWN_RAILS)[number]] ?? [{}]).map(
        (detail) => refuse(rail as never, detail).reason,
      ),
  },
  {
    name: 'MESSAGE_RAILS',
    module: 'runtime/message-rails.ts',
    rails: MESSAGE_RAILS,
    arms: (rail) => [refuseMessage(rail as never).reason],
  },
  {
    name: 'REPLY_RAILS',
    module: 'runtime/reply-rails.ts',
    rails: REPLY_RAILS,
    arms: (rail) =>
      rail === 'piece-already-ended'
        ? [{}, { state: 'answered' }, { state: 'withdrawn' }, { state: 'closed' }].map(
            (detail) => refuseReply(rail, detail as never).reason,
          )
        : [refuseReply(rail as never).reason],
  },
  {
    name: 'QUESTION_RAILS',
    module: 'runtime/question-rails.ts',
    rails: QUESTION_RAILS,
    arms: (rail) =>
      rail === 'answer-too-long'
        ? [
            {},
            { argument: 'answers', limit: 1280, was: 12_800_000 },
            { argument: 'cannot_answer', limit: 1280, was: 12_800_000 },
          ].map((detail) => refuseQuestion(rail, detail as never).reason)
        : rail === 'no-open-question-you-asked-by-that-name'
          ? [
              {},
              {
                state: 'answered',
                at: 1_700_000_000_000,
                itsAnswer: 'held-and-this-turn-is-stopping',
              },
              { state: 'answered', at: 1_700_000_000_000, itsAnswer: 'held-until-this-turn-ends' },
              { state: 'answered', at: 1_700_000_000_000, itsAnswer: 'already-sent' },
              {
                state: 'answered',
                at: 1_700_000_000_000,
                itsAnswer: 'held-until-the-limit-resets',
              },
              {
                state: 'rejected',
                at: 1_700_000_000_000,
                itsAnswer: 'held-and-this-turn-is-stopping',
              },
              { state: 'rejected', at: 1_700_000_000_000, itsAnswer: 'held-until-this-turn-ends' },
              { state: 'rejected', at: 1_700_000_000_000, itsAnswer: 'already-sent' },
              {
                state: 'rejected',
                at: 1_700_000_000_000,
                itsAnswer: 'held-until-the-limit-resets',
              },
              { state: 'work-closed', at: 1_700_000_000_000 },
              { state: 'withdrawn', at: 1_700_000_000_000 },
              { state: 'withdrawn' },
            ].map((detail) => refuseQuestion(rail, detail as never).reason)
          : [refuseQuestion(rail as never).reason],
  },
  {
    name: 'INTERRUPT_RAILS',
    module: 'runtime/interrupt-rails.ts',
    rails: INTERRUPT_RAILS,
    arms: (rail) => [refuseInterrupt(rail as never).reason],
  },
  {
    name: 'RESOURCE_RAILS',
    module: 'resources/resources.ts',
    rails: RESOURCE_RAILS,
    arms: (rail) => [refuseResource(rail as never).reason],
  },
  {
    name: 'MODEL_RAILS',
    module: 'runtime/model-rails.ts',
    rails: MODEL_RAILS,
    arms: (rail) =>
      (MODEL_DETAILS[rail as (typeof MODEL_RAILS)[number]] ?? [{}]).map(
        (detail) => refuseModel(rail as never, detail).reason,
      ),
  },
]

const OVERRIDES: readonly {
  readonly key: string
  readonly rail: string
  readonly spreadAs: string
  readonly sentence: string
}[] = [
  {
    key: 'WORK_SEARCH_RAILS|work-search-invalid/past-work',
    rail: 'work-search-invalid',
    spreadAs: 'refusalReason',
    sentence: pastWorkSearchRefusal('invalid').reason,
  },
  {
    key: 'WORK_SEARCH_RAILS|work-search-unavailable/past-work',
    rail: 'work-search-unavailable',
    spreadAs: 'refusalReason',
    sentence: pastWorkSearchRefusal('unavailable').reason,
  },
  {
    key: 'RESOURCE_RAILS|resource-not-a-form-this-app-keeps/reply-file-kind',
    rail: 'resource-not-a-form-this-app-keeps',
    spreadAs: 'replyUnkeptFileReason',
    sentence: replyUnkeptFileReason('/fictional/file.unrecognised'),
  },
  {
    key: 'TOOL_REFUSALS|agent-could-not-be-started/a-folder',
    rail: 'agent-could-not-be-started',
    spreadAs: 'A_FOLDER_COULD_NOT_BE_MADE',
    sentence: A_FOLDER_COULD_NOT_BE_MADE,
  },
  {
    key: 'TOOL_REFUSALS|that-conversation-could-not-be-resumed/its-program',
    rail: 'that-conversation-could-not-be-resumed',
    spreadAs: 'A_WAKE_WHOSE_PROGRAM_COULD_NOT_RUN',
    sentence: A_WAKE_WHOSE_PROGRAM_COULD_NOT_RUN,
  },
  {
    key: 'TOOL_REFUSALS|that-conversation-could-not-be-resumed/a-folder',
    rail: 'that-conversation-could-not-be-resumed',
    spreadAs: 'A_WAKE_WHOSE_FOLDER_COULD_NOT_BE_MADE',
    sentence: A_WAKE_WHOSE_FOLDER_COULD_NOT_BE_MADE,
  },
  {
    key: 'TOOL_REFUSALS|that-conversation-could-not-be-resumed/its-folder-is-gone',
    rail: 'that-conversation-could-not-be-resumed',
    spreadAs: 'A_WAKE_WHOSE_FOLDER_IS_GONE',
    sentence: A_WAKE_WHOSE_FOLDER_IS_GONE,
  },
  {
    key: 'TOOL_REFUSALS|agent-could-not-be-started/its-provider-refused-it',
    rail: 'agent-could-not-be-started',
    spreadAs: 'A_PROVIDER_REFUSED_THE_START',
    sentence: A_PROVIDER_REFUSED_THE_START,
  },
  {
    key: 'TOOL_REFUSALS|agent-did-not-start/its-sign-in-or-settings',
    rail: 'agent-did-not-start',
    spreadAs: 'aStartItsLoginOrSettingsRefused',
    sentence: aStartItsLoginOrSettingsRefused('sign-in', 'codex', 'give'),
  },
  {
    key: 'TOOL_REFUSALS|that-conversation-could-not-be-resumed/its-provider-refused-it',
    rail: 'that-conversation-could-not-be-resumed',
    spreadAs: 'A_WAKE_ITS_PROVIDER_REFUSED',
    sentence: A_WAKE_ITS_PROVIDER_REFUSED,
  },
  {
    key: 'TOOL_REFUSALS|that-piece-has-ended/how-it-ended',
    rail: 'that-piece-has-ended',
    spreadAs: 'anEndedPieceSaid',
    sentence: anEndedPieceSaid(
      {
        piece: 'work_1',
        label: 'W3.4.1.2',
        state: 'answered',
        at: 0,
        called: LONG_SLUG,
        yoursToRetitle: true,
      },
      3 * 24 * 60 * 60_000,
    ),
  },
  {
    key: 'TOOL_REFUSALS|not-a-piece-you-gave/a-piece-you-hold',
    rail: 'not-a-piece-you-gave',
    spreadAs: 'aFollowUpOnAPieceYouHold',
    sentence: aFollowUpOnAPieceYouHold('W3.4.1.2.1.1'),
  },
  {
    key: 'TOOL_REFUSALS|not-a-piece-you-gave/a-piece-you-gave-another',
    rail: 'not-a-piece-you-gave',
    spreadAs: 'aFollowUpOnAPieceYouGaveAnother',
    sentence: aFollowUpOnAPieceYouGaveAnother('W3.4.1.2.1.1'),
  },
  {
    key: 'TOOL_REFUSALS|not-a-piece-you-gave/a-piece-you-did-not-give',
    rail: 'not-a-piece-you-gave',
    spreadAs: 'aFollowUpOnAPieceYouDidNotGive',
    sentence: aFollowUpOnAPieceYouDidNotGive('sess_0123456789abcdef0123456789abcdef'),
  },
  {
    key: 'TOOL_REFUSALS|that-agent-has-several-conversations/their-labels',
    rail: 'that-agent-has-several-conversations',
    spreadAs: 'anAgentWithSeveralConversations',
    sentence: anAgentWithSeveralConversations(
      'a-profile-name-of-forty-characters-long',
      Array.from({ length: 7 }, (_, at) => `W3.4.1.2.1.${at + 1}`),
    ),
  },
  {
    key: 'TOOL_REFUSALS|that-piece-is-still-queued/its-label',
    rail: 'that-piece-is-still-queued',
    spreadAs: 'aMessageAboutAQueuedPiece',
    sentence: aMessageAboutAQueuedPiece('W3.4.1.2.1.1'),
  },
  {
    key: 'TOOL_REFUSALS|not-a-piece-you-gave/a-take-back-of-a-piece-you-hold',
    rail: 'not-a-piece-you-gave',
    spreadAs: 'aTakeBackOfAPieceYouHold',
    sentence: aTakeBackOfAPieceYouHold('W3.4.1.2.1.1'),
  },
  {
    key: 'TOOL_REFUSALS|not-a-piece-you-gave/a-take-back-of-a-piece-you-hold-that-ended',
    rail: 'not-a-piece-you-gave',
    spreadAs: 'aTakeBackOfAPieceYouHoldThatEnded',
    sentence: aTakeBackOfAPieceYouHoldThatEnded({
      is: 'ended',
      label: 'W3.4.1.2.1.1',
      state: 'withdrawn',
      at: 0,
      called: LONG_SLUG,
      readAt: 3 * 24 * 60 * 60_000,
    }),
  },
  {
    key: 'TOOL_REFUSALS|not-a-piece-you-gave/a-take-back-of-your-own-work',
    rail: 'not-a-piece-you-gave',
    spreadAs: 'aTakeBackOfYourOwnWork',
    sentence: aTakeBackOfYourOwnWork('W3'),
  },
  {
    key: 'TOOL_REFUSALS|a-conversation-with-its-questions-is-starting/its-label',
    rail: 'a-conversation-with-its-questions-is-starting',
    spreadAs: 'aPieceNotEndedWhileAQuestionStarts',
    sentence: aPieceNotEndedWhileAQuestionStarts('W3.4.1.2.1.1', 'work-withdrawn'),
  },
  {
    key: 'TOOL_REFUSALS|its-questions-could-not-all-be-read/its-label',
    rail: 'its-questions-could-not-all-be-read',
    spreadAs: 'aPieceNotEndedItsQuestionsUnread',
    sentence: aPieceNotEndedItsQuestionsUnread('W3.4.1.2.1.1', 'work-withdrawn'),
  },
  {
    key: 'TOOL_REFUSALS|that-agent-is-you/an-interrupt',
    rail: 'that-agent-is-you',
    spreadAs: 'A_CONVERSATION_CANNOT_INTERRUPT_ITSELF',
    sentence: A_CONVERSATION_CANNOT_INTERRUPT_ITSELF,
  },
  {
    key: 'TOOL_REFUSALS|that-agent-is-you/an-ask',
    rail: 'that-agent-is-you',
    spreadAs: 'A_CONVERSATION_CANNOT_ASK_ITSELF',
    sentence: A_CONVERSATION_CANNOT_ASK_ITSELF,
  },
  {
    key: 'TOOL_REFUSALS|that-agent-is-you/with-helper-guidance',
    rail: 'that-agent-is-you',
    spreadAs: 'aSelfAddressSaid',
    sentence:
      refuseTool('that-agent-is-you', { agent: 'sess_self' }).reason +
      ' W1.2 is your own piece, with no helpers recorded under it. list_agents names who you can reach.',
  },
]

function everyRow(): Row[] {
  const rows: Row[] = []
  for (const vocabulary of VOCABULARIES) {
    for (const rail of vocabulary.rails) {
      const arms = vocabulary.arms(rail)
      arms.forEach((sentence, index) =>
        rows.push({
          key: `${vocabulary.name}|${rail}${arms.length > 1 ? `/${index + 1}` : ''}`,
          rail,
          row: rowOf(rail, sentence),
        }),
      )
    }
  }
  for (const one of OVERRIDES)
    rows.push({ key: one.key, rail: one.rail, row: rowOf(one.rail, one.sentence) })
  return rows
}

const ACT: Readonly<Record<string, string>> = {
  'WORK_SEARCH_RAILS|work-search-invalid/past-work': 'Use one to 20 search words',
  'WORK_SEARCH_RAILS|work-search-unavailable/past-work': 'Try again',
  'WORK_SEARCH_RAILS|work-search-invalid':
    'Use a listed scope and state, at most 20 words, and a limit from 1 to 50',
  'WORK_SEARCH_RAILS|work-search-cursor-invalid': 'Start the search again',
  'WORK_SEARCH_RAILS|work-search-unavailable': 'Try again',
  'WORK_SEARCH_RAILS|work-search-busy': 'Try again in a moment',
  'REPLY_RAILS|result-document-not-returned':
    'must be a Markdown file or page listed in resource_paths',
  'TOOL_REFUSALS|no-such-agent': 'list_agents names the ones you can reach',
  'TOOL_REFUSALS|that-conversation-takes-no-messages': 'list_agents names the ones you can reach',
  'TOOL_REFUSALS|that-agent-has-several-conversations':
    'make the same call with agent set to one of that agent\u2019s conversations',
  'TOOL_REFUSALS|that-agent-has-several-conversations/their-labels':
    'make the same call with agent set to one of',
  'TOOL_REFUSALS|malformed-request': 'The problems are listed in the detail',
  'TOOL_REFUSALS|agent-cannot-take-a-message':
    'ask a person to inspect why that conversation cannot take a message',
  'TOOL_REFUSALS|that-conversation-has-not-started': 'make the same call again in a moment',
  'TOOL_REFUSALS|a-conversation-with-its-questions-is-starting': 'Try again in a moment',
  'TOOL_REFUSALS|a-conversation-with-its-questions-is-starting/its-label': 'Try again in a moment',
  'TOOL_REFUSALS|its-questions-could-not-all-be-read': 'Check that record, then retry this call',
  'TOOL_REFUSALS|its-questions-could-not-all-be-read/its-label':
    'Check that record, then retry this call',
  'REPLY_RAILS|a-conversation-with-its-questions-is-starting': 'Try again in a moment',
  'REPLY_RAILS|its-questions-could-not-all-be-read': 'Check that record, then retry this call',
  'TOOL_REFUSALS|not-a-conversation-below-you':
    'To ask any other agent something, use ask_question',
  'TOOL_REFUSALS|that-agent-is-you': 'do it yourself — or send it to another agent',
  'TOOL_REFUSALS|that-agent-is-you/with-helper-guidance':
    'do it yourself — or send it to another agent',
  'TOOL_REFUSALS|that-agent-is-you/an-interrupt':
    'Stop your own work yourself, or name another agent to interrupt',
  'TOOL_REFUSALS|that-agent-is-not-below-you': 'Call message_agent again without interrupt',
  'TOOL_REFUSALS|spawning-disabled': 'no retry will pass until they switch it back on',
  'TOOL_REFUSALS|agent-did-not-start':
    'ask a person to read the detail and decide whether to start that conversation again',
  'TOOL_REFUSALS|agent-could-not-start-just-now': 'Make the same call again in a moment',
  'TOOL_REFUSALS|agent-could-not-be-started':
    'Starting it again will not help until a person has looked',
  'TOOL_REFUSALS|agent-could-not-be-started/a-folder':
    'Starting it again will not help until a person has looked',
  'TOOL_REFUSALS|agent-could-not-be-started/its-provider-refused-it':
    'Giving it again will not help until a person has looked',
  'TOOL_REFUSALS|agent-did-not-start/its-sign-in-or-settings':
    'Ask a person to save an API key on the Codex card in Providers',
  'TOOL_REFUSALS|may-not-create-agents': 'ask a person to grant agent creation',
  'TOOL_REFUSALS|agent-name-taken': 'Choose a different name, or use the agent that exists',
  'TOOL_REFUSALS|services-are-off-so-none-is-made': 'A person turns them on in Team',
  'TOOL_REFUSALS|not-a-piece-you-gave': 'list_tasks lists the open pieces you gave out',
  'TOOL_REFUSALS|not-a-piece-you-gave/a-piece-you-hold': 'make the same call with kind note',
  'TOOL_REFUSALS|not-a-piece-you-gave/a-piece-you-gave-another': 'make the same call with agent',
  'TOOL_REFUSALS|not-a-piece-you-gave/a-piece-you-did-not-give': 'send it as kind note to',
  'TOOL_REFUSALS|that-piece-is-still-queued': 'Change its brief with update_work',
  'TOOL_REFUSALS|that-piece-is-still-queued/its-label': 'Change its brief with update_work',
  'TOOL_REFUSALS|not-a-piece-you-gave/a-take-back-of-a-piece-you-hold':
    'to hand it back finished, call reply_to_parent; to ask about it, call ask_question naming it',
  'TOOL_REFUSALS|not-a-piece-you-gave/a-take-back-of-a-piece-you-hold-that-ended':
    'stop work on that piece',
  'TOOL_REFUSALS|not-a-piece-you-gave/a-take-back-of-your-own-work':
    'ask a person with ask_question naming it, and answer the person here when it is done',
  'TOOL_REFUSALS|that-piece-was-already-answered':
    'Read the reply first; for genuinely new work, give it with give_work',
  'TOOL_REFUSALS|no-piece-by-that-name': 'list_tasks names the open pieces you hold and gave',
  'TOOL_REFUSALS|that-is-your-own-work':
    'ask a person with ask_question naming it, and answer the person here when it is done',
  'TOOL_REFUSALS|the-start-it-waited-on-did-not-happen': 'Give it again: that starts a new one',
  'TOOL_REFUSALS|the-giver-names-a-piece':
    'To have it called something else, ask it; you may set its status line',
  'TOOL_REFUSALS|that-piece-has-ended': 'Only its title may still be changed',
  'TOOL_REFUSALS|that-piece-has-ended/how-it-ended': 'read its answer with list_tasks',
  'TOOL_REFUSALS|that-work-is-being-sent': 'make this call again once it has gone',
  'TOOL_REFUSALS|the-giver-briefs-and-closes-a-piece':
    'Ask with ask_question to change or stop the work',
  'TOOL_REFUSALS|no-work-of-your-own': 'Use give_work',
  'TOOL_REFUSALS|work-record-unavailable': 'Try again',
  'TOOL_REFUSALS|no-agent-by-that-name': 'name an agent by the profile list_profiles gives it',
  'TOOL_REFUSALS|that-conversation-is-not-archived':
    'list_agents with archived: true names the archived ones you can reach',
  'TOOL_REFUSALS|it-is-being-archived-or-deleted': 'Call this tool again once that is done',
  'TOOL_REFUSALS|it-could-not-be-restored': 'Tell the person',
  'TOOL_REFUSALS|server-already-registered':
    'ask the person with ask_question (a-person) to grant it to your profile',
  'TOOL_REFUSALS|server-already-asked-for': 'wait for the person to decide',
  'TOOL_REFUSALS|too-many-server-requests': 'wait until one is decided',
  'TOOL_REFUSALS|may-not-write-rules': 'You can propose a change with propose_agent_rules',
  'TOOL_REFUSALS|may-not-relay-a-rule':
    'Ask again without claiming it was already agreed, and a person will decide',
  'TOOL_REFUSALS|that-is-work-you-hold':
    'call ask_question naming that piece; to hand it back finished, call reply_to_parent',
  'TOOL_REFUSALS|that-conversation-is-still-stopping': 'Make the same call again in a moment',
  'TOOL_REFUSALS|that-conversation-could-not-be-resumed':
    'Sending again will not help until a person has looked',
  'TOOL_REFUSALS|that-conversation-could-not-be-resumed/its-program':
    'Sending again will not help until a person has looked',
  'TOOL_REFUSALS|that-conversation-could-not-be-resumed/a-folder':
    'Sending again will not help until a person has looked',
  'TOOL_REFUSALS|that-conversation-could-not-be-resumed/its-folder-is-gone':
    'Sending again will not help until a person has looked',
  'TOOL_REFUSALS|that-conversation-could-not-be-resumed/its-provider-refused-it':
    'Sending again will not help until a person has looked',
  'TOOL_REFUSALS|that-conversation-could-not-be-woken-just-now':
    'Make the same call again in a moment',
  'SPAWN_RAILS|malformed-request': 'Send exactly the fields this tool documents',
  'SPAWN_RAILS|its-provider-is-not-chosen': 'Ask a person to choose a provider for',
  'SPAWN_RAILS|spawning-disabled': 'Only a person can switch it back on',
  'SPAWN_RAILS|no-piece-to-give-from': 'Do the work here until you hold a piece',
  'SPAWN_RAILS|name-the-piece-you-give-from': 'give again naming it as piece',
  'SPAWN_RAILS|no-piece-you-hold-by-that-name': 'list_tasks names what you hold',
  'SPAWN_RAILS|too-deep': 'Do it yourself, or ask whoever gave you your piece',
  'SPAWN_RAILS|parallel-not-for-a-service': 'Leave parallel out to queue the work',
  'SPAWN_RAILS|no-free-worker-at-capacity': 'Give it again when one is free',
  'SPAWN_RAILS|no-room-for-provider-conversation':
    'Give work on a provider already in that pool, or choose another agent',
  'SPAWN_RAILS|service-provider-is-fixed': 'Give it work on that provider',
  'SPAWN_RAILS|worker-binding-is-unknown': 'Tell a person, and give it again once that is fixed',
  'SPAWN_RAILS|that-profile-exists': 'Give without new to use it',
  'SPAWN_RAILS|services-are-off': 'Do the work yourself, or give it to another agent',
  'SPAWN_RAILS|its-kind-is-unknown': 'Give the work to another agent, or ask a person',
  'SPAWN_RAILS|that-is-this-conversation': 'Do this part within the piece you are working on',
  'SPAWN_RAILS|it-would-wait-on-itself': 'Finish or take back that work, then give this again',
  'SPAWN_RAILS|its-waits-cannot-all-be-checked':
    'Give the work to another agent, or give it again once some of the work',
  'SPAWN_RAILS|its-record-cannot-be-read': 'Give the work to another agent',
  'SPAWN_RAILS|may-not-create-agents': 'Give to an agent list_profiles names, or ask a person',
  'SPAWN_RAILS|no-such-profile': 'check the spelling',
  'SPAWN_RAILS|folder-unusable': 'only a person can make it right',
  'SPAWN_RAILS|wider-than-its-parent/1':
    'Do this work here, or ask a person whether to change your approval mode',
  'SPAWN_RAILS|wider-than-its-parent/2':
    'Do this work here, or ask a person whether to change your approval mode',
  'MESSAGE_RAILS|may-not-message': 'ask one, or do the work yourself',
  'MESSAGE_RAILS|may-not-assign-work':
    'Send it as a note, ask with ask_question, or do the work yourself',
  'REPLY_RAILS|no-piece-by-that-name': 'list_tasks names the pieces you hold',
  'REPLY_RAILS|a-person-gave-that-piece': 'answer the person here',
  'REPLY_RAILS|piece-already-ended/1': 'stop work on that piece',
  'REPLY_RAILS|piece-already-ended/2': 'stop work on that piece',
  'REPLY_RAILS|piece-already-ended/3': 'stop work on that piece',
  'REPLY_RAILS|piece-already-ended/4': 'stop work on that piece',
  'REPLY_RAILS|summary-too-long':
    'Put the rest in a Markdown file, a page, an image or a PDF and name its path in resource_paths',
  'QUESTION_RAILS|no-question-by-that-name': 'list_questions names the requests you can answer',
  'QUESTION_RAILS|a-person-answers-this-one': 'that one is a person’s to settle',
  'QUESTION_RAILS|that-answer-cannot-be-sent':
    'Answer every part it asks about, choosing one of its options unless it takes an answer of your own',
  'QUESTION_RAILS|more-than-one-question-has-that-id':
    'make the same call again with asked_by set to one of the conversations the detail lists',
  'QUESTION_RAILS|that-conversation-did-not-ask-that':
    'make the same call again with asked_by set to one of the conversations the detail lists',
  'QUESTION_RAILS|no-open-work-by-that-name': 'list_tasks names the pieces you hold',
  'QUESTION_RAILS|name-the-piece-you-ask-about': 'ask again naming it as piece',
  'QUESTION_RAILS|no-piece-to-ask-about': 'A question to another agent needs no piece',
  'QUESTION_RAILS|nobody-to-pass-it-up-to': 'Pass it to a person with a-person instead',
  'QUESTION_RAILS|no-agent-you-can-ask-by-that-name': 'list_agents names the agents you can ask',
  'QUESTION_RAILS|a-question-asked-of-you-by-name-is-yours':
    'it is yours to answer — or to say you cannot, with answer_question and cannot_answer',
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/1': 'Use the id ask_question returned',
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/2': 'stop here and read its answer',
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/3':
    'end this turn to read its answer before you report on that question',
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/4':
    'read its answer, which was sent to you as a message',
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/5':
    'end this turn to read its answer before you report on that question',
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/6':
    'stop here and read the reply declining it',
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/7':
    'end this turn to read the reply declining it before you report on that question',
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/8':
    'read the reply declining it, which was sent to you as a message',
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/9':
    'end this turn to read the reply declining it before you report on that question',
  'QUESTION_RAILS|answer-too-long/1':
    'shorten your answer, or put the long form in a file and name its full path in your answer',
  'QUESTION_RAILS|answer-too-long/2':
    'shorten your answer, or put the long form in a file and name its full path in your answer',
  'QUESTION_RAILS|answer-too-long/3':
    'shorten your reason, or put the long form in a file and name its full path in cannot_answer',
  'INTERRUPT_RAILS|a-person-is-being-asked':
    'carry on with something else, or say that you are blocked on it',
  'INTERRUPT_RAILS|that-conversation-has-not-started': 'ask again in a moment',
  'INTERRUPT_RAILS|it-is-waiting-on-an-answer': 'If that is you, answer it with answer_question',
  'INTERRUPT_RAILS|not-below-you': 'To ask it something use ask_question',
  'RESOURCE_RAILS|resource-unreadable': 'Write a file and offer that path instead',
  'RESOURCE_RAILS|resource-not-a-form-this-app-keeps/reply-file-kind':
    'Name its full path in summary',
  'RESOURCE_RAILS|resource-not-a-form-this-app-keeps':
    'Keep it where it is and name its full path in what you write',
  'RESOURCE_RAILS|resource-too-large': 'Write a file and offer that path instead',
  'RESOURCE_RAILS|resource-empty': 'Write a file and offer that path instead',
  'RESOURCE_RAILS|resource-not-text': 'Write a file and offer that path instead',
  'RESOURCE_RAILS|resource-could-not-be-kept':
    'Trying again will not help until a person sorts out what stopped it',
  'RESOURCE_RAILS|no-such-resource': 'check the id in the reply or piece record',
  'RESOURCE_RAILS|resource-bytes-missing': 'ask a person to restore the file',
  'RESOURCE_RAILS|resource-bytes-changed': 'ask a person to check or restore the file',
  'RESOURCE_RAILS|resource-bytes-unreadable':
    'Asking again will not help until a person has looked',
  'RESOURCE_RAILS|resource-store-unavailable':
    'Trying again will not help until a person sets it up',
  'MODEL_RAILS|model-not-in-the-list': 'Pick a model from Claude’s list',
  'MODEL_RAILS|effort-not-offered/1': 'Leave effort out',
  'MODEL_RAILS|effort-not-offered/2': `Pick an effort “${LONG_MODEL}” offers`,
  'MODEL_RAILS|models-unavailable/1': 'Ask a person to check Claude',
  'MODEL_RAILS|models-unavailable/2': 'Name a model too',
  'MODEL_RAILS|models-unavailable/3': 'Ask a person to check Claude',
  'MODEL_RAILS|models-not-read-in-time/1': 'Give again in a moment',
  'MODEL_RAILS|models-not-read-in-time/2': 'Give again in a moment',
  'MODEL_RAILS|name-the-model-too': 'Name the model too',
  'MODEL_RAILS|the-provider-moved-meanwhile': 'Give again',
  'TOOL_REFUSALS|theme-is-built-in': 'Save it under a new id',
  'TOOL_REFUSALS|theme-exists': 'Set replace to true to replace it',
  'TOOL_REFUSALS|theme-unknown': 'Call list_themes to see the themes this app can use',
  'TOOL_REFUSALS|theme-too-large': 'Use fewer or smaller files',
}

const NO_ACT: Readonly<Record<string, string>> = {
  'QUESTION_RAILS|move-offer-not-available':
    'the request cannot be offered; the sentence names no repeatable act',
  'QUESTION_RAILS|move-offer-is-held':
    'the current request is being recorded; the separate remedy names when to repeat the call',
  'QUESTION_RAILS|move-offer-needs-a-person':
    'restoring availability belongs to a person; this sentence gives the caller no act',
  'TOOL_REFUSALS|theme-invalid':
    'the remedy is in separate problem lines, not an act in this sentence',
  'TOOL_REFUSALS|that-agent-is-you/an-ask':
    'a conversation cannot ask itself; no question was recorded',
  'TOOL_REFUSALS|that-piece-was-already-taken-back':
    'what the caller asked for already holds — there is nothing left to do',
  'TOOL_REFUSALS|that-piece-was-already-closed':
    'what the caller asked for already holds — there is nothing left to do',
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/10': 'the question already ended',
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/11': 'the question was already withdrawn',
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/12': 'the question already ended',
  'QUESTION_RAILS|question-has-already-ended':
    'the question ended, so no further answer is owed or repeatable',
  'QUESTION_RAILS|the-conversation-that-asked-has-gone':
    'the asking conversation is gone, so no further answer is owed or repeatable',
  'QUESTION_RAILS|this-app-does-not-hold-those-words':
    'the original words are gone, so the same id cannot be passed up',
  'INTERRUPT_RAILS|that-service-is-on-another-callers-piece':
    'the service is on another caller’s piece; the same stop goes once that piece has ended',
}

const NO_ACT_PAST_THE_BOUND: readonly string[] = []

describe('675 · the act inside the cut', () => {
  const rows = everyRow()

  it('⚑ the bound is the one the normalizers cut at, and it is not a formality', () => {
    expect(TOOL_SUMMARY_MAX).toBe(200)
    expect(rows.filter((one) => one.row.length > TOOL_SUMMARY_MAX).length).toBeGreaterThan(40)
  })

  it('🔴 every sentence is accounted for — an act, or a line in NO_ACT — and never both', () => {
    const keys = rows.map((one) => one.key).sort()
    expect(new Set(keys).size, 'two rows share a key').toBe(keys.length)
    const accounted = [...Object.keys(ACT), ...Object.keys(NO_ACT)].sort()
    expect(accounted).toEqual(keys)
    for (const key of Object.keys(NO_ACT)) expect(ACT, key).not.toHaveProperty(key)
  })

  for (const row of everyRow()) {
    const act = ACT[row.key]
    if (act === undefined) continue
    it(`⛔ ${row.key} — its act ends inside the first ${TOOL_SUMMARY_MAX} characters`, () => {
      expect(whereTheActSits(row.row, act), row.row).toBe('inside')
    })
  }

  it('⚠️ …and the ones with no act that run past the cut are exactly the ones named', () => {
    expect(
      rows
        .filter((one) => NO_ACT[one.key] !== undefined && one.row.length > TOOL_SUMMARY_MAX)
        .map((one) => one.key)
        .sort(),
    ).toEqual([...NO_ACT_PAST_THE_BOUND].sort())
  })

  it('🔴 731 · no refusal makes a FOLDER part of its act — a folder is named only in the factory habit', () => {
    const habit = 'Use the assigned folder.'
    const namesAFolder = (sentence: string): boolean =>
      /working directory|working folder|project folder/i.test(sentence.split(habit).join(''))
    expect(rows.filter((one) => namesAFolder(one.row)).map((one) => one.key)).toEqual([])
    expect(
      namesAFolder('Keep it in the project folder and name its path in your summary instead.'),
    ).toBe(true)
    expect(namesAFolder('Put the long form in a Markdown file in your working directory.')).toBe(
      true,
    )
    expect(
      namesAFolder(`Keep it where it is and name its full path in what you write. ${habit}`),
    ).toBe(false)
  })

  it('🔴 the predicate CAN fail — an act planted past the cut, and one planted missing', () => {
    const padding = 'x'.repeat(TOOL_SUMMARY_MAX)
    const act = 'call list_tasks'
    expect(whereTheActSits(rowOf('planted', `${act}. ${padding}`), act)).toBe('inside')
    expect(whereTheActSits(rowOf('planted', `${padding} ${act}.`), act)).toEqual({
      past: rowOf('planted', `${padding} ${act}`).length,
    })
    expect(whereTheActSits(rowOf('planted', padding), act)).toBe('not-in-the-row')
    const exact = rowOf(
      'p',
      'y'.repeat(TOOL_SUMMARY_MAX - rowOf('p', '').length - act.length) + act,
    )
    expect(exact).toHaveLength(TOOL_SUMMARY_MAX)
    expect(whereTheActSits(exact, act)).toBe('inside')
    expect(whereTheActSits(`${exact}!`.replace(act, `z${act}`), act)).toEqual({
      past: TOOL_SUMMARY_MAX + 1,
    })
  })

  it('⚑ the parameterised arms are measured at their LONGEST, and EVERY planted value is in the row', () => {
    for (const [rail, details] of Object.entries(SPAWN_DETAILS)) {
      details.forEach((detail, index) => {
        const said = refuse(rail as never, detail).reason
        for (const [field, value] of Object.entries(detail)) {
          const shown: readonly unknown[] =
            field === 'provider'
              ? [PROVIDER_NAME[value as keyof typeof PROVIDER_NAME]]
              : LABEL_LISTS.has(field)
                ? (value as readonly unknown[])
                : [value]
          for (const one of shown) {
            if (typeof one !== 'string') continue
            expect(said, `${rail}/${index + 1} · ${field}`).toContain(one)
          }
        }
      })
    }
    for (const [rail, details] of Object.entries(MODEL_DETAILS)) {
      details.forEach((detail, index) => {
        const said = refuseModel(rail as never, detail).reason
        for (const [field, value] of Object.entries(detail)) {
          if (field === 'door') continue
          const shown: readonly unknown[] =
            field === 'provider'
              ? [PROVIDER_NAME[value as keyof typeof PROVIDER_NAME]]
              : MODEL_LISTS.has(field)
                ? (value as readonly unknown[])
                : [value]
          for (const one of shown) {
            expect(typeof one, `${rail}/${index + 1} · ${field}`).toBe('string')
            expect(said, `${rail}/${index + 1} · ${field}`).toContain(one)
          }
        }
      })
    }
  })
})

describe('675 · the vocabularies this census reads are ALL of them', () => {
  const codeOnly = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

  const everyModule = (): { path: string; source: string }[] => {
    const found: { path: string; source: string }[] = []
    const walk = (dir: string, base: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full, base)
        else if (entry.name.endsWith('.ts')) {
          found.push({ path: relative(base, full), source: readFileSync(full, 'utf8') })
        }
      }
    }
    walk(mainRoot, mainRoot)
    walk(sharedRoot, join(sharedRoot, '..'))
    return found
  }

  const namesAPermanence = (source: string): boolean =>
    RAIL_PERMANENCES.some((word) => codeOnly(source).includes(`'${word}'`))

  const CONSUMERS: readonly string[] = ['runtime/agent-tool-answer-words.ts']

  it('🔴 every module that prices a rail is read above, and nothing else is', () => {
    const modules = everyModule()
    const pricing = modules
      .filter((file) => namesAPermanence(file.source))
      .map((file) => file.path.split('\\').join('/'))
      .sort()
    const themeTools = codeOnly(readFileSync(join(mainRoot, 'themes/agent-tools.ts'), 'utf8'))
    expect(themeTools).toContain('PERMANENCE_SAID.permanent')
    expect(themeTools).toContain("PERMANENCE_SAID['while-this-holds']")
    expect(pricing).toEqual(
      [
        ...VOCABULARIES.map((one) => one.module),
        'shared/refusals.ts',
        'themes/agent-tools.ts',
        ...CONSUMERS,
      ].sort(),
    )
    for (const path of CONSUMERS) {
      const found = modules.find((one) => one.path.split('\\').join('/') === path)
      const code = codeOnly(found?.source ?? '')
      const named = RAIL_PERMANENCES.flatMap((word) => code.split(`'${word}'`).slice(1))
      const compared = RAIL_PERMANENCES.flatMap((word) =>
        code.split(new RegExp(`[!=]==\\s*'${word}'`)).slice(1),
      )
      expect(named.length, `${path} names no permanence`).toBeGreaterThan(0)
      expect(compared.length, `${path} prices a rail`).toBe(named.length)
    }
  })

  const theOverridesIn = (source: string): string[] =>
    [
      ...codeOnly(source).matchAll(
        /\{\s*\.\.\.(?:[^{}]|\{[^{}]*\})*?,\s*reason:\s*([A-Za-z_$][\w$]*)/g,
      ),
    ].map((match) => match[1] ?? '')

  const NOT_A_REFUSALS_REASON = ['whyNotResumable', 'found']

  it('🔴 every refusal sentence a door says in place of its table’s is in the census', () => {
    const spread = everyModule()
      .flatMap((file) => theOverridesIn(file.source))
      .filter((name) => !NOT_A_REFUSALS_REASON.includes(name))
    expect([...new Set(spread)].sort()).toEqual(
      [...new Set(OVERRIDES.map((one) => one.spreadAs))].sort(),
    )
    for (const name of NOT_A_REFUSALS_REASON) {
      expect(everyModule().flatMap((file) => theOverridesIn(file.source))).toContain(name)
    }
  })

  it('⚠️ …and the scan finds two planted overrides, and none in prose', () => {
    const planted = [
      `const a = { ...refuse('x'), reason: A_NEW_SENTENCE }\n`,
      `return { ...refuseTool('y', { agent }), reason: anotherOne(detail) }\n`,
      `/** { ...refuse('z'), reason: ONLY_IN_A_DOCBLOCK } */\n`,
    ]
    expect(planted.flatMap(theOverridesIn)).toEqual(['A_NEW_SENTENCE', 'anotherOne'])
  })

  it('⚠️ …and the derivation finds a planted vocabulary, and no commented one', () => {
    const planted = [
      { path: 'runtime/a-new-door.ts', source: `const P = { a: 'permanent' as const }\n` },
      { path: 'runtime/another-door.ts', source: `const Q = { b: 'while-this-holds' as const }\n` },
      { path: 'runtime/prose.ts', source: `/** it is 'until-a-person-changes-it'. */\n` },
    ]
    expect(planted.filter((one) => namesAPermanence(one.source)).map((one) => one.path)).toEqual([
      'runtime/a-new-door.ts',
      'runtime/another-door.ts',
    ])
  })
})
