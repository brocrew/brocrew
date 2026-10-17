import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CHANNEL_REFUSAL_SENTENCES, type AgentToolAnswer } from '@brobot2/runtime'
import {
  A_PERSON,
  CREATED_UNDER_ITS_PROFILE_NAME,
  DONE,
  FIX_IT_AND_CALL_AGAIN,
  HOW_THE_LAST_TURN_ENDED,
  ITS_RULES_ARE_SAVED,
  RULES_PUT_BEFORE_A_PERSON,
  RULES_WRITTEN,
  THE_CONVERSATION_THAT_GAVE_YOU_THIS_WORK,
  THE_PROVIDER_PROGRAM_IS_UNAVAILABLE,
  answerInWords,
  appOnlyRefusalQuote,
  createdAndNamed,
  doneWithThePiece,
  filesHoldingThoseWords,
  handedBackWithItsAnswer,
  heldBy,
  itsInputs,
  keptResources,
  lastAskedToStop,
  noFileHoldsThoseWords,
  permanenceInWords,
  theHolderIsNow,
  tookOn,
  whatWasMadeForIt,
  windowsReported,
  type AnswerWordsContext,
} from '../src/main/runtime/agent-tool-answer-words'
import { refuseTool, refusalIn, TOOL_REFUSALS } from '../src/main/runtime/agent-tools'
import { refuse, SPAWN_RAILS } from '../src/main/runtime/spawn-rails'
import { refuseModel, MODEL_RAILS } from '../src/main/runtime/model-rails'
import { refuseReply, REPLY_RAILS } from '../src/main/runtime/reply-rails'
import { refuseQuestion, QUESTION_RAILS } from '../src/main/runtime/question-rails'
import { refuseInterrupt, INTERRUPT_RAILS } from '../src/main/runtime/interrupt-rails'
import { refuseMessage, MESSAGE_RAILS } from '../src/main/runtime/message-rails'
import {
  readOfferedResource,
  refuseResource,
  RESOURCE_RAILS,
} from '../src/main/resources/resources'
import { clockTimeFrom } from '../src/shared/clock'
import { MAX_REFUSAL_TOLD, PERMANENCE_SAID, refusalReason } from '../src/shared/refusals'

/**
 * A refusal's permanence and actionable detail reach the model in its one text answer, while
 * `structured` is returned unchanged. Each payload is built by its rail's own builder and carried
 * as the tools carry it.
 */

const READ_AT = Date.UTC(2026, 9, 10, 15, 0)
const AN_HOUR_AGO = READ_AT - 3_600_000

const ADDRESSES: Readonly<Record<string, string>> = {
  sess_parent: 'W1',
  sess_sibling: 'W1.4',
}

const context: AnswerWordsContext = {
  me: 'sess_me',
  addressOf: (conversation) => ADDRESSES[conversation] ?? conversation,
  readAt: READ_AT,
}

/** A refusal as the tools answer with it: the payload, and its rail and reason as the text. */
function answered(
  refusal: { readonly rail: string; readonly reason: string },
  extra: Readonly<Record<string, unknown>> = {},
): AgentToolAnswer {
  return {
    text: `refused (${refusal.rail}): ${refusal.reason}`,
    structured: { outcome: 'refused', ...refusal, ...extra },
  }
}

/** What {@link answerInWords} added, after the text it was handed. */
function added(before: AgentToolAnswer): string {
  const after = answerInWords(before, context)
  expect(after.text.startsWith(before.text)).toBe(true)
  return after.text.slice(before.text.length)
}

const NEVER = `${PERMANENCE_SAID.permanent.charAt(0).toUpperCase()}${PERMANENCE_SAID.permanent.slice(1)}.`
const UNTIL = `This refusal holds ${PERMANENCE_SAID['until-a-person-changes-it']}.`
const WHILE = `This refusal holds ${PERMANENCE_SAID['while-this-holds']}.`

describe('the answer stays the answer it was', () => {
  it('keeps the prefix and the reason byte for byte, and hands back the same structured object', () => {
    const before = answered(refuseTool('no-such-agent', { agent: 'sess_typed' }))
    const after = answerInWords(before, context)
    expect(after.structured).toBe(before.structured)
    expect(
      after.text.startsWith(`refused (no-such-agent): ${refuseTool('no-such-agent').reason}`),
    ).toBe(true)
    expect(after.text).toBe(`${before.text} ${NEVER}`)
  })

  it('returns an answer that is not a refusal as the very object it was', () => {
    const ok: AgentToolAnswer = {
      text: 'created helper',
      structured: { outcome: 'ok', agent: 'helper' },
    }
    expect(answerInWords(ok, context)).toBe(ok)
    const bare: AgentToolAnswer = { text: '' }
    expect(answerInWords(bare, context)).toBe(bare)
  })

  it('says its words once, however many times it is asked', () => {
    const before = answered(
      refuseReply('summary-too-long', { piece: 'W1.2', label: 'W1.2', limit: 1280, was: 2582 }),
    )
    const once = answerInWords(before, context)
    expect(answerInWords(once, context).text).toBe(once.text)
  })
})

describe('fresh refusal reasons and their composed prefixes', () => {
  const constructors = [
    ['tool', () => TOOL_REFUSALS.map((rail) => refuseTool(rail))],
    ['give', () => SPAWN_RAILS.map((rail) => refuse(rail))],
    ['model', () => MODEL_RAILS.map((rail) => refuseModel(rail))],
    ['reply', () => REPLY_RAILS.map((rail) => refuseReply(rail))],
    ['question', () => QUESTION_RAILS.map((rail) => refuseQuestion(rail))],
    ['interrupt', () => INTERRUPT_RAILS.map((rail) => refuseInterrupt(rail))],
    ['message', () => MESSAGE_RAILS.map((rail) => refuseMessage(rail))],
    ['resource', () => RESOURCE_RAILS.map((rail) => refuseResource(rail))],
  ] as const

  for (const [name, construct] of constructors) {
    it(`keeps every ${name} reason verbatim inside the composed answer`, () => {
      const refusals = construct()
      expect(refusals.length).toBeGreaterThan(0)
      for (const one of refusals) {
        expect(refusalReason(one.reason), one.rail).toBe(one.reason)
        expect(one.reason.trim(), one.rail).toBe(one.reason)
        const before = answered(one)
        const composed = answerInWords(before, context)
        expect(composed.structured).toBe(before.structured)
        const kept = refusalIn('message_agent', composed.structured, composed.text)?.told
        expect(kept, one.rail).toBeDefined()
        expect(composed.text.startsWith(`refused (${one.rail}): ${kept!.text}`), one.rail).toBe(
          true,
        )
      }
    })
  }

  it.each(['\tA fictional reason.\n', 'A fictional reason.\n', '\tA fictional reason.', ''])(
    'refuses an invalid reason without trimming it: %j',
    (reason) => {
      expect(() => refusalReason(reason)).toThrow('nonempty and have no boundary whitespace')
      expect(() =>
        answerInWords(answered({ ...refuseTool('no-such-agent'), reason }), context),
      ).toThrow()
    },
  )
})

describe('the ledger quote adds only the reviewed app clauses', () => {
  it.each(['  The existing reason.\t\n', '\t \r\n'])(
    'keeps every byte of a nonempty raw reason, including boundary whitespace: %j',
    (reason) => {
      const before = answered({ ...refuseTool('no-such-agent'), reason })
      expect(appOnlyRefusalQuote(before.structured)).toBe(reason)
      expect(refusalIn('message_agent', before.structured)?.told).toEqual({
        text: reason,
        dropped: 0,
      })
      expect(() => answerInWords(before, context)).toThrow('boundary whitespace')
      expect(() => appOnlyRefusalQuote(before.structured, before.text)).toThrow(
        'boundary whitespace',
      )
      expect(() => refusalIn('message_agent', before.structured, before.text)).toThrow(
        'boundary whitespace',
      )
    },
  )

  it('preserves the old codepoint bound on a whitespace-bearing raw fallback', () => {
    const reason = ` ${'🌿'.repeat(MAX_REFUSAL_TOLD)} `
    const before = answered({ ...refuseTool('no-such-agent'), reason })
    expect(appOnlyRefusalQuote(before.structured)).toBe(reason)
    expect(refusalIn('message_agent', before.structured)?.told).toEqual({
      text: ` ${'🌿'.repeat(MAX_REFUSAL_TOLD - 1)}`,
      dropped: 2,
    })
  })

  it('keeps the whole app-only answer, with the original payload unchanged', () => {
    const before = answered(refuseTool('no-such-agent'))
    const after = answerInWords(before, context)
    expect(after.structured).toBe(before.structured)
    expect(appOnlyRefusalQuote(after.structured, after.text)).toBe(
      `${String(before.structured!['reason'])} ${NEVER}`,
    )
    expect(appOnlyRefusalQuote(after.structured)).toBe(before.structured!['reason'])
  })

  it('keeps the app-generated unused label when the exact whole answer contains only it and permanence', () => {
    const before = answered(refuseTool('agent-took-too-long-to-start'), {
      label_not_used: 'W1.23',
    })
    const after = answerInWords(before, context)
    const quote = `${String(before.structured!['reason'])} The label W1.23 was used up by this failed give and names no piece. ${WHILE}`
    expect(after.text).toBe(`refused (agent-took-too-long-to-start): ${quote}`)
    expect(appOnlyRefusalQuote(after.structured, after.text)).toBe(quote)
    expect(appOnlyRefusalQuote(after.structured, `${after.text} Another clause.`)).toBe(
      before.structured!['reason'],
    )
  })

  for (const [name, before, privateText] of [
    [
      'a supplied path',
      answered(
        refuseResource('resource-too-large', {
          path: '/fictional/PRIVATE_CALLER_PATH.txt',
          bytes: 20_000_000,
          limit: 10_485_760,
        }),
      ),
      'PRIVATE_CALLER_PATH',
    ],
    [
      'an echoed problem key',
      answered(refuseTool('malformed-request', { problems: ['PRIVATE_CALLER_KEY: unrecognized'] })),
      'PRIVATE_CALLER_KEY',
    ],
  ] as const) {
    it(`keeps ${name} in actionable prose but out of the ledger quote`, () => {
      const after = answerInWords(before, context)
      expect(after.structured).toBe(before.structured)
      expect(after.text).toContain(privateText)
      expect(JSON.stringify(after.structured!['detail'])).toContain(privateText)
      const quote = appOnlyRefusalQuote(after.structured, after.text)
      expect(quote).toBe(before.structured!['reason'])
      expect(quote).not.toContain(privateText)
      expect(
        after.text.startsWith(`refused (${String(after.structured!['rail'])}): ${quote}`),
      ).toBe(true)
    })
  }

  it('keeps only the raw reason if no complete final answer or reason is available', () => {
    expect(appOnlyRefusalQuote(undefined, 'refused (missing): unknown')).toBeUndefined()
    const before = answered(refuseTool('no-such-agent'))
    expect(appOnlyRefusalQuote(before.structured)).toBe(before.structured!['reason'])
    expect(() => appOnlyRefusalQuote(before.structured, 'Another answer.')).toThrow('must prefix')
  })
})

describe('permanence, true on every rail of its class', () => {
  it('derives each clause from PERMANENCE_SAID, and asks for a fix only of a malformed call', () => {
    expect(permanenceInWords('no-such-agent', 'permanent')).toBe(NEVER)
    expect(permanenceInWords('malformed-request', 'permanent')).toBe(
      `${NEVER} ${FIX_IT_AND_CALL_AGAIN}`,
    )
    expect(permanenceInWords('may-not-message', 'until-a-person-changes-it')).toBe(UNTIL)
    expect(permanenceInWords('summary-too-long', 'while-this-holds')).toBe(WHILE)
    expect(FIX_IT_AND_CALL_AGAIN).toBe('Fix it and call again.')
  })

  it('tells a malformed call, of either vocabulary, to fix it and call again', () => {
    const tool = added(
      answered(refuseTool('malformed-request', { problems: ['agent is required'] })),
    )
    const give = added(answered(refuse('malformed-request', { problems: ['title: Too big'] })))
    for (const tail of [tool, give])
      expect(tail.endsWith(`${NEVER} ${FIX_IT_AND_CALL_AGAIN}`)).toBe(true)
  })

  it('invites no call on a permanent rail that is not malformed — an ended piece least of all', () => {
    const permanent = [
      answered(refuseTool('no-such-agent', { agent: 'sess_typed' })),
      answered(refuseTool('that-agent-is-you', { agent: 'sess_me' })),
      answered(refuseTool('that-piece-was-already-answered', { piece: 'W1.3', label: 'W1.3' })),
      answered(refuseTool('that-piece-was-already-taken-back', { piece: 'W1.3', label: 'W1.3' })),
      answered(
        refuseQuestion('question-has-already-ended', { question: 'req_asked', state: 'answered' }),
      ),
    ]
    for (const one of permanent) {
      const tail = added(one)
      expect(tail.endsWith(NEVER)).toBe(true)
      expect(tail).not.toContain(FIX_IT_AND_CALL_AGAIN)
      expect(tail).not.toMatch(/call again|retry/i)
    }
  })

  it('never says a person must act, where an agent answering clears it', () => {
    const until = [
      // Cleared when the conversation it waits on answers, which may be the caller.
      answered(
        refuseInterrupt('it-is-waiting-on-an-answer', { agent: 'sess_typed', askedOf: 'sess_me' }),
      ),
      // Cancelled by its parent: nobody else acts, and the same call then starts.
      answered(refuseTool('agent-did-not-start', { profile: 'helper', because: 'cancelled' })),
      answered(refuseMessage('may-not-message')),
    ]
    for (const one of until) {
      const tail = added(one)
      expect(tail.endsWith(UNTIL)).toBe(true)
      expect(tail).not.toMatch(/a person must|retry/i)
    }
  })

  it('never promises an identical retry, where the caller has to change its call or its file', () => {
    const lasting = [
      answered(
        refuseReply('summary-too-long', { piece: 'W1.2', label: 'W1.2', limit: 1280, was: 2582 }),
      ),
      answered(refuseResource('resource-too-large', { bytes: 30_000_000, limit: 10_485_760 })),
      answered(refuseTool('that-conversation-has-not-started', { agent: 'sess_typed' })),
    ]
    for (const one of lasting) {
      const tail = added(one)
      expect(tail.endsWith(WHILE)).toBe(true)
      expect(tail).not.toMatch(/retry|clears/i)
    }
  })

  it('names the rejected main document and cause without promising an identical retry or keeping the path', () => {
    for (const [problem, words] of [
      ['not-listed', 'not listed'],
      ['not-document', 'not Markdown or a page'],
    ] as const) {
      const path = '/fictional/PRIVATE_CALLER_PATH.pdf'
      const before = answered(
        refuseReply('result-document-not-returned', {
          path,
          resultDocumentProblem: problem,
        }),
      )
      const reason =
        'The main result document must be a Markdown file or page listed in resource_paths. Nothing was recorded.'
      const after = answerInWords(before, context)
      expect(after.structured).toBe(before.structured)
      expect(after.structured).toEqual({
        outcome: 'refused',
        rail: 'result-document-not-returned',
        reason,
        detail: { path, resultDocumentProblem: problem },
        permanence: 'permanent',
        retryable: false,
        remedy: null,
      })
      expect(after.text).toBe(
        `refused (result-document-not-returned): ${reason} ${path} is ${words}.`,
      )
      expect(after.text.match(/Nothing was recorded\./g)).toHaveLength(1)
      expect(after.text).not.toContain(NEVER)
      expect(answerInWords(after, context).text).toBe(after.text)
      expect(appOnlyRefusalQuote(after.structured, after.text)).toBe(reason)
      expect(refusalIn('reply_to_parent', after.structured, after.text)?.told).toEqual({
        text: reason,
        dropped: 0,
      })
      expect(after.text.startsWith(`refused (result-document-not-returned): ${reason}`)).toBe(true)
    }
    const unspecified = answered(refuseReply('result-document-not-returned'))
    expect(answerInWords(unspecified, context)).toBe(unspecified)
  })

  it('says nothing of permanence it cannot read, and still says the detail', () => {
    const before: AgentToolAnswer = {
      text: 'refused (malformed-request): the arguments did not match.',
      structured: {
        outcome: 'refused',
        rail: 'malformed-request',
        permanence: 'soon',
        detail: { problems: ['x'] },
      },
    }
    expect(added(before)).toBe(' Problems: x.')
  })
})

describe('each actionable detail, in words', () => {
  const at = clockTimeFrom(AN_HOUR_AGO, READ_AT)
  const cases: [string, AgentToolAnswer, string][] = [
    [
      'validation problems, every one',
      answered(
        refuseTool('malformed-request', {
          problems: ['agent is required', 'kind must be one of note, follow-up.'],
        }),
      ),
      ` Problems: agent is required; kind must be one of note, follow-up. ${NEVER} ${FIX_IT_AND_CALL_AGAIN}`,
    ],
    [
      "a give's parse, which its own sentence does not list",
      answered(
        refuse('malformed-request', {
          problems: ['title: String must contain at most 200 character(s)'],
        }),
      ),
      ` Problems: title: String must contain at most 200 character(s). ${NEVER} ${FIX_IT_AND_CALL_AGAIN}`,
    ],
    [
      'why a start did not happen',
      answered(refuseTool('agent-did-not-start', { profile: 'helper', because: 'shutting-down' })),
      ` It did not start because BroCrew is shutting down. ${UNTIL}`,
    ],
    [
      'the error a program or folder met',
      answered(refuseTool('agent-could-not-be-started', { profile: 'helper', because: 'ENOENT' })),
      ` The error was ENOENT. ${UNTIL}`,
    ],
    [
      'the error a wake met',
      answered(
        refuseTool('that-conversation-could-not-be-resumed', {
          agent: 'sess_typed',
          because: 'EACCES',
        }),
      ),
      ` The error was EACCES. ${UNTIL}`,
    ],
    [
      "its provider's own reason",
      answered(
        refuseTool('agent-could-not-be-started', {
          profile: 'helper',
          because: 'its-provider-refused-it',
          providerSaid: 'model not allowed for this account',
        }),
      ),
      ` Its provider said: “model not allowed for this account”. ${UNTIL}`,
    ],
    [
      'what this app said, where nothing else says why',
      answered(
        refuseTool('agent-cannot-take-a-message', {
          agent: 'sess_typed',
          said: 'It stopped taking turns.',
        }),
      ),
      ` This app said: It stopped taking turns. ${UNTIL}`,
    ],
    [
      'what a person must do to restore it',
      answered(
        refuseTool('it-could-not-be-restored', {
          agent: 'sess_typed',
          said: 'Let BroBot write its folder',
        }),
      ),
      ` This app said: Let BroBot write its folder. ${UNTIL}`,
    ],
    [
      'how an answered piece ended, and what its reply handed in',
      answered(
        refuseTool('that-piece-was-already-answered', {
          piece: 'W1.3',
          label: 'W1.3',
          answered: 'done',
          resources: ['res_a', 'res_b'],
          at: AN_HOUR_AGO,
        }),
      ),
      ` W1.3 was answered done at ${at}. Its reply handed in res_a, res_b. ${NEVER}`,
    ],
    [
      'a long summary whose reason already states its length and limit',
      answered(
        refuseReply('summary-too-long', { piece: 'W1.2', label: 'W1.2', limit: 1280, was: 2582 }),
      ),
      ` ${WHILE}`,
    ],
    [
      "what kind of thing is a person's",
      answered(
        refuseQuestion('a-person-answers-this-one', {
          question: 'req_asked',
          because: 'a-permission-decision',
        }),
      ),
      ` It is ${CHANNEL_REFUSAL_SENTENCES['a-permission-decision']}. ${NEVER}`,
    ],
    [
      'how a question ended',
      answered(
        refuseQuestion('question-has-already-ended', { question: 'req_asked', state: 'rejected' }),
      ),
      ` It was already declined. ${NEVER}`,
    ],
    [
      'every conversation that raised that id, by its address',
      answered(
        refuseQuestion('more-than-one-question-has-that-id', {
          question: 'req_asked',
          askers: ['sess_parent', 'sess_sibling', 'sess_unlabelled'],
        }),
      ),
      ` Those that asked it: W1, W1.4, sess_unlabelled. ${NEVER}`,
    ],
    [
      'the ones that did raise it, when the one named did not',
      answered(
        refuseQuestion('that-conversation-did-not-ask-that', {
          question: 'req_asked',
          askers: ['sess_sibling'],
        }),
      ),
      ` Those that asked it: W1.4. ${NEVER}`,
    ],
    [
      'the pieces a question could be about',
      answered(refuseQuestion('name-the-piece-you-ask-about', { held: ['W1.2', 'W1.5'] })),
      ` You hold W1.2, W1.5. ${NEVER}`,
    ],
    [
      'why an answer could not be sent',
      answered(
        refuseQuestion('that-answer-cannot-be-sent', {
          question: 'req_asked',
          said: 'no answer was given for part_2',
        }),
      ),
      ` This app said: no answer was given for part_2. ${WHILE}`,
    ],
    [
      'the conversation an interrupt waits on',
      answered(
        refuseInterrupt('it-is-waiting-on-an-answer', {
          agent: 'sess_typed',
          askedOf: 'sess_parent',
        }),
      ),
      ` It waits on W1. ${UNTIL}`,
    ],
    [
      '…and when that is the caller',
      answered(
        refuseInterrupt('it-is-waiting-on-an-answer', { agent: 'sess_typed', askedOf: 'sess_me' }),
      ),
      ` It waits on you. ${UNTIL}`,
    ],
    [
      'which of the files was refused',
      answered(refuseResource('resource-unreadable', { path: '/work/notes.md' })),
      ` The file was /work/notes.md. ${WHILE}`,
    ],
    [
      'how large a file is, and the most kept',
      answered(refuseResource('resource-too-large', { bytes: 30_000_000, limit: 10_485_760 })),
      ` It is 30 MB; the most kept of that kind is 10.5 MB. ${WHILE}`,
    ],
    [
      'which file was too large, as the agent spelled it',
      answered(
        refuseResource('resource-too-large', {
          path: 'notes/big.md',
          bytes: 30_000_000,
          limit: 10_485_760,
        }),
      ),
      ` The file was notes/big.md. It is 30 MB; the most kept of that kind is 10.5 MB. ${WHILE}`,
    ],
    [
      'a provider program that is missing, which has no error code',
      answered(
        refuseTool('agent-could-not-be-started', {
          profile: 'helper',
          because: 'provider-binary-unavailable',
        }),
      ),
      ` ${THE_PROVIDER_PROGRAM_IS_UNAVAILABLE} ${UNTIL}`,
    ],
    [
      '…and the same, at a wake',
      answered(
        refuseTool('that-conversation-could-not-be-resumed', {
          agent: 'sess_typed',
          because: 'provider-binary-unavailable',
        }),
      ),
      ` ${THE_PROVIDER_PROGRAM_IS_UNAVAILABLE} ${UNTIL}`,
    ],
    [
      'a question that ended in a race, with no ending recorded',
      answered(
        refuseQuestion('question-has-already-ended', {
          question: 'req_asked',
          said: 'request is not pending',
        }),
      ),
      ` This app did not see how it ended. This app said: request is not pending. ${NEVER}`,
    ],
    [
      'why a file could not be kept',
      answered(
        refuseResource('resource-could-not-be-kept', {
          problem: 'the disk is full',
          path: 'out/report.md',
        }),
      ),
      ` out/report.md: the disk is full. ${UNTIL}`,
    ],
  ]

  it.each(cases)('%s', (_family, before, tail) => {
    expect(added(before)).toBe(tail)
  })
})

describe('a file too large to keep is named as the agent spelled it', () => {
  let dir = ''
  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'brobot2-too-large-')))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('uses the supplied path over the resolved one, and the resolved one when none is supplied', () => {
    const real = join(dir, 'big.md')
    writeFileSync(real, 'a'.repeat(1_048_577))

    const supplied = readOfferedResource(real, 'notes/big.md')
    if (supplied.ok) throw new Error('a file over the cap was offered')
    expect(supplied.refusal.rail).toBe('resource-too-large')
    expect(supplied.refusal.detail).toEqual({
      path: 'notes/big.md',
      bytes: 1_048_577,
      limit: 1_048_576,
    })
    expect(added(answered(supplied.refusal))).toContain(' The file was notes/big.md.')
    expect(added(answered(supplied.refusal))).not.toContain(real)

    const unsupplied = readOfferedResource(real)
    if (unsupplied.ok) throw new Error('a file over the cap was offered')
    expect(unsupplied.refusal.detail).toEqual({ path: real, bytes: 1_048_577, limit: 1_048_576 })
  })

  it('leaves every other refusal naming the resolved path', () => {
    const real = join(dir, 'empty.md')
    writeFileSync(real, '')
    const empty = readOfferedResource(real, 'notes/empty.md')
    if (empty.ok) throw new Error('an empty file was offered')
    expect(empty.refusal.rail).toBe('resource-empty')
    expect(empty.refusal.detail).toEqual({ path: real })
  })
})

describe('nothing said twice, and nothing the caller sent said back', () => {
  it('leaves the model choices where the reason already says them, once', () => {
    const before = answered(
      refuseModel('model-not-in-the-list', {
        door: 'give',
        provider: 'claude',
        model: 'opus-9',
        choices: ['opus', 'sonnet'],
      }),
    )
    const after = answerInWords(before, context)
    expect(after.text).toBe(`${before.text} ${UNTIL}`)
    expect(after.text.split('“sonnet”').length - 1).toBe(1)
  })

  it('adds nothing but permanence where the reason says every fact', () => {
    expect(added(answered(refuse('it-would-wait-on-itself', { profileId: 'helper' })))).toBe(
      ` ${WHILE}`,
    )
    expect(added(answered(refuseMessage('may-not-message', { agent: 'sess_typed' })))).toBe(
      ` ${UNTIL}`,
    )
  })

  it('never dumps the detail, and never says back what the caller sent', () => {
    const every = [
      answered(refuseTool('no-such-agent', { agent: 'sess_typed' })),
      answered(refuseTool('no-piece-by-that-name', { piece: 'W9.9' })),
      answered(refuseQuestion('no-question-by-that-name', { question: 'req_asked' })),
      answered(refuseResource('no-such-resource', { resource: 'res_typed' })),
      answered(
        refuseResource('resource-bytes-changed', {
          resource: 'res_typed',
          kept: 'abc123',
          found: 'def456',
        }),
      ),
      answered(
        refuseTool('agent-could-not-start-just-now', { profile: 'helper', because: 'EMFILE' }),
      ),
    ]
    for (const one of every) {
      const tail = added(one)
      expect(tail).not.toMatch(/[{}"]|sess_typed|W9\.9|req_asked|res_typed|abc123|EMFILE|helper/)
    }
  })
})

describe('a give that used up its label', () => {
  it('says so once, after the refusal it rode on and before its permanence', () => {
    const failed = answered(
      refuseTool('agent-could-not-start-just-now', { profile: 'helper', because: 'EMFILE' }),
    )
    const before: AgentToolAnswer = {
      text: failed.text,
      structured: { ...failed.structured, label_not_used: 'W1.7' },
    }
    const after = answerInWords(before, context)
    expect(after.structured).toBe(before.structured)
    expect(after.text).toBe(
      `${failed.text} The label W1.7 was used up by this failed give and names no piece. ${WHILE}`,
    )
    expect(after.text.split('W1.7').length - 1).toBe(1)
  })
})

describe('never two stops', () => {
  it('closes a reason that does not end, and leaves alone one that does', () => {
    const open: AgentToolAnswer = {
      text: 'refused (no-such-agent): nothing by that name',
      structured: { ...refuseTool('no-such-agent'), outcome: 'refused' },
    }
    expect(answerInWords(open, context).text).toBe(
      `refused (no-such-agent): nothing by that name. ${NEVER}`,
    )
  })

  it('keeps a quoted reason that ends inside its quotes', () => {
    const before = answered(
      refuseTool('agent-could-not-be-started', {
        because: 'its-provider-refused-it',
        providerSaid: 'Not allowed.',
      }),
    )
    expect(added(before)).toBe(` Its provider said: “Not allowed.” ${UNTIL}`)
  })

  it('never doubles a stop anywhere a detail is said', () => {
    const many = [
      answered(
        refuseTool('malformed-request', { problems: ['agent is required.', 'text is required;'] }),
      ),
      answered(refuseTool('it-could-not-be-restored', { said: 'Let BroBot write its folder.' })),
      answered(
        refuseQuestion('that-answer-cannot-be-sent', { said: 'no answer was given for part_2.' }),
      ),
      answered(
        refuseResource('resource-could-not-be-kept', {
          problem: 'the disk is full.',
          path: 'out/report.md',
        }),
      ),
    ]
    for (const one of many) {
      expect(answerInWords(one, context).text).not.toMatch(/\.\s*\.|;\./)
    }
  })
})

describe('the approved success words, spelled once', () => {
  it('says each as W4 approved it', () => {
    expect(DONE).toBe('Done.')
    expect(doneWithThePiece('W1.2')).toBe('Done. W1.2.')
    expect(tookOn('W1.7')).toBe('Took on W1.7.')
    expect(createdAndNamed('Ada')).toBe('Created; this app named it Ada.')
    expect(CREATED_UNDER_ITS_PROFILE_NAME).toBe('Created; it goes by its profile name.')
    expect(ITS_RULES_ARE_SAVED).toBe('Its rules are saved.')
    expect(RULES_WRITTEN).toBe(
      "Written: it reaches that agent's next conversation, not one already running.",
    )
    expect(RULES_PUT_BEFORE_A_PERSON).toBe(
      'Put in front of a person: nothing is written unless they approve it.',
    )
    expect(keptResources(['res_a', 'res_b'])).toBe('Kept: res_a, res_b.')
    expect(lastAskedToStop('14:02', 'no-turn-running')).toBe(
      'It was last asked to stop at 14:02, when no turn was running.',
    )
    expect(lastAskedToStop('14:02', 'an-earlier-turn')).toBe(
      'It was last asked to stop at 14:02, in a turn that ended before its last.',
    )
    expect(lastAskedToStop('14:02', 'the-turn-running-now')).toBe(
      'It was last asked to stop at 14:02, in the turn running now.',
    )
    expect(HOW_THE_LAST_TURN_ENDED).toEqual({
      'it-finished': 'it finished',
      'it-was-stopped': 'it was stopped',
      'the-provider-faulted': 'its provider failed',
      'it-was-stopped-and-it-faulted': 'it was stopped, and its provider failed',
      'nothing-has-said': 'this app did not see how it ended',
    })
    expect(heldBy('W1.2')).toBe('held by W1.2')
    expect(theHolderIsNow('idle')).toBe('the conversation holding it is now idle')
    expect(itsInputs(['res_a'])).toBe('Its inputs: res_a.')
    expect(whatWasMadeForIt(['res_b'])).toBe('What was made for it: res_b.')
    expect(handedBackWithItsAnswer(['res_c'])).toBe('Handed back with its answer: res_c.')
    expect(
      windowsReported('Claude', [{ window: 'five-hour', first: '09:12', last: '14:40' }]),
    ).toBe('Windows Claude has reported: five-hour (first 09:12, last 14:40).')
    expect(THE_CONVERSATION_THAT_GAVE_YOU_THIS_WORK).toBe(
      'the conversation that gave you this work',
    )
    expect(A_PERSON).toBe('a person')
    expect(filesHoldingThoseWords('on your tree')).toBe(
      'Files on your tree holding those words, newest first:',
    )
    expect(noFileHoldsThoseWords('on your tree')).toBe('No file on your tree holds those words.')
  })
})
