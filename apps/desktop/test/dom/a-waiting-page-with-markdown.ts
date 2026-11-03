import { nextTick } from 'vue'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import { attentionToACardNobodyHolds } from '../../src/renderer/src/lib/attention'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import {
  NOTHING_NAMED_THE_WORK,
  aPersonsSince,
  chainReading,
  chainSentence,
  decisionReading,
  escalationChain,
  readingSentence,
  type AskedQuestion,
  type LedgerWalk,
  type PersonsQuestion,
  type RequestOnlyAPersonCanSettle,
  type RoutedRequest,
} from '../../src/shared/questions'
import { mount } from './harness'

export const MARKDOWN_NOW = Date.UTC(2026, 8, 21, 14)
export const MARKDOWN_PROMPT =
  '**Choose a draft**\n\n- Read `notes.md`\n- Open [the preview](https://example.test/preview)\n\nSee /work/sample/notes.md.'
export const LITERAL_COMMAND = 'printf "%s" "**rm** [draft](sample) `literal`"'
export const LONG_MARKDOWN =
  '[https://example.test/' +
  'preview'.repeat(70) +
  '](https://example.test/preview)\n\n```sh\n' +
  'printf sample '.repeat(45) +
  '\n```'

const walked = <T>(rows: readonly T[]): LedgerWalk<T> => ({
  rows,
  walk: 'every-conversation-that-routed',
  ledgers: 1,
  rowsUnread: 0,
})

function question(
  id: string,
  raisedBy: PersonsQuestion['raisedBy'],
  asked: AskedQuestion | null,
): PersonsQuestion {
  const request: RoutedRequest = {
    requestId: id,
    askedBy: 'sess_glint',
    parent: null,
    went: { is: 'the-person-the-asker-named', to: 'a-person' },
    at: MARKDOWN_NOW - 60_000,
    state: 'open',
    endedAt: null,
    escalatedAt: null,
  }
  const chain = escalationChain(request, () => null)
  const name = () => 'Glint'
  return {
    request,
    aPersonsSince: aPersonsSince(request),
    chain,
    reading: chainReading(chain, name),
    sentence: chainSentence(chain, name),
    work: [],
    about: NOTHING_NAMED_THE_WORK,
    raisedBy,
    offered: null,
    asked,
  }
}

/** The real page with made-up questions, a to-do and a command requiring approval. */
export async function aWaitingPageWithMarkdown(width = 1180, height = 1000, long = false) {
  const words: AskedQuestion = {
    prompt: MARKDOWN_PROMPT + (long ? '\n\n' + LONG_MARKDOWN : ''),
    context: 'Added **after review**: read `summary.md`.',
    passedUp: true,
    parts: [
      {
        id: 'draft',
        header: 'Draft',
        prompt: 'Use **the short draft** from /work/sample/notes.md?',
        options: [],
      },
    ],
  }
  const app = question('req_app', 'this-app', words)
  const provider = question('req_provider', 'the-provider', words)
  const todo = {
    ...question('req_todo', 'this-app', null),
    action: {
      text:
        '**Check the preview**\n\n- Read `notes.md`\n- Open [the preview](https://example.test/preview)\n\nSee /work/sample/notes.md.' +
        (long ? '\n\n' + LONG_MARKDOWN : ''),
      files: [],
    },
  }
  const permission = attentionToACardNobodyHolds(
    'sess_glint',
    {
      asked: {
        type: 'permission_request',
        id: 'req_command',
        kind: 'command',
        action: 'Bash',
        detail: LITERAL_COMMAND,
        scope: {
          cwd: '/work/sample',
          paths: [],
          networkHosts: [],
          persistence: 'session',
          amendments: [],
          availableDecisions: ['allow', 'deny'],
          underDisclosed: false,
          grants: {},
        },
      },
      provider: 'claude',
      profileId: 'glint',
    },
    { sent: false, refused: null },
    () => 'Glint',
  )
  if (!permission) throw new Error('the sample permission produced no card')
  const request = {
    ...provider.request,
    requestId: 'req_command',
    went: {
      is: 'the-person-the-channel-left-it-with',
      to: 'a-person',
      because: 'a-permission-decision',
    },
  } as const satisfies RequestOnlyAPersonCanSettle
  const reading = decisionReading('sess_glint', () => 'Glint')
  usePersonsQueue().supply(
    walked([app, provider, todo]),
    walked([
      {
        request,
        reading,
        sentence: readingSentence(reading),
        says: 'a command approval',
        work: [],
      },
    ]),
    {
      held: new Set(),
      answerable: new Map(),
      nobodyHolds: new Map([
        [
          permission.key,
          {
            ...permission,
            asked: '**Run the preview check**',
          },
        ],
      ]),
      answeredFromHere: new Set(),
      now: MARKDOWN_NOW,
      lastLookAnswered: { questions: true, decisions: true },
    },
    {
      travel: () => {},
      settle: () => {},
      takeOver: () => {},
      open: () => {},
      answer: async () => null,
      answerTodo: async () => null,
      openFile: () => {},
    },
  )
  const m = mount(WaitingOnYou, { needsYou: [], clock: MARKDOWN_NOW }, { width, height })
  await nextTick()
  return m
}
