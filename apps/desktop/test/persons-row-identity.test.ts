import { describe, expect, it } from 'vitest'
import { PERSONS_ROW_KEY, type PersonsRow } from '../src/shared/persons-published'

const request: PersonsRow<'questions'>['request'] = {
  requestId: 'request-0',
  askedBy: 'conversation-a',
  parent: null,
  went: { is: 'the-person-the-asker-named', to: 'a-person' },
  at: 1_000,
  state: 'open',
  endedAt: null,
  escalatedAt: null,
}
const question: PersonsRow<'questions'> = {
  request,
  aPersonsSince: 1_000,
  chain: {
    links: [{ waiting: request.askedBy, requestId: request.requestId, on: null }],
    endsWithAPerson: true,
  },
  reading: { hops: [{ waiting: 'Agent', on: null }], unfollowable: false },
  sentence: 'Agent waiting on you',
  work: [],
  about: { is: 'nothing-recorded-it' },
  raisedBy: 'this-app',
  offered: null,
  asked: null,
}
const decision: PersonsRow<'decisions'> = {
  request: {
    ...request,
    went: {
      is: 'the-person-the-channel-left-it-with',
      to: 'a-person',
      because: 'a-permission-decision',
    },
  },
  reading: question.reading,
  sentence: question.sentence,
  says: 'A command approval',
  work: [],
}

function assertRequestIdentity<Row extends { request: typeof request; sentence: string }>(
  key: (row: Row) => string,
  row: Row,
): void {
  const otherConversation = { ...row, request: { ...row.request, askedBy: 'conversation-b' } }
  const otherRequest = { ...row, request: { ...row.request, requestId: 'request-1' } }
  const renamed = { ...row, sentence: 'Renamed agent waiting on you' }
  expect(key(row)).toBe('conversation-a:request-0')
  expect(key(otherConversation)).toBe('conversation-b:request-0')
  expect(key(otherRequest)).toBe('conversation-a:request-1')
  const held = new Map(
    [row, otherConversation, otherRequest, renamed].map((one) => [key(one), one]),
  )
  expect(held.size).toBe(3)
  expect(held.get(key(row))).toBe(renamed)
  expect(held.get(key(otherConversation))).toBe(otherConversation)
}

function assertPieceIdentity<Row extends { piece: string; label: string; title: string | null }>(
  key: (row: Row) => string,
  row: Row,
): void {
  const renamed = { ...row, label: 'Renamed label', title: 'Renamed work' }
  const otherPiece = { ...row, piece: 'piece-b' }
  expect(key(row)).toBe('piece-a')
  expect(key(renamed)).toBe('piece-a')
  expect(key(otherPiece)).toBe('piece-b')
  const held = new Map([row, renamed, otherPiece].map((one) => [key(one), one]))
  expect([...held.keys()]).toEqual(['piece-a', 'piece-b'])
  expect(held.get('piece-a')).toBe(renamed)
  expect(held.get('piece-b')).toBe(otherPiece)
}

const piece = { piece: 'piece-a', label: 'Work label', title: 'Work title' }
const holder = { holder: 'conversation-a', holderName: 'Agent' }
const giver = { giver: 'conversation-parent', giverName: 'Parent' }
const owner = { owner: holder.holder, ownerName: holder.holderName }

describe('stable identities in the published person queue', () => {
  it('keeps questions with the same provider id from different conversations separate', () => {
    assertRequestIdentity(PERSONS_ROW_KEY.questions, question)
  })

  it('keeps decisions separate by conversation and request when the displayed name changes', () => {
    assertRequestIdentity(PERSONS_ROW_KEY.decisions, decision)
  })

  it('keeps an instruction proposal by ask id when its text or conversation changes', () => {
    const row: PersonsRow<'instructionAsks'> = {
      asked: {
        type: 'instruction_proposed',
        askId: 'proposal-a',
        ask: 'propose',
        about: 'recipient',
        proposedBy: 'proposer',
        text: 'Original rules',
        why: 'Original explanation',
      },
      conversation: 'conversation-a',
      at: 1_000,
    }
    const changed = {
      ...row,
      conversation: 'conversation-b',
      asked: { ...row.asked, text: 'Revised rules', why: 'Revised explanation' },
    }
    const other = { ...row, asked: { ...row.asked, askId: 'proposal-b' } }
    const key = PERSONS_ROW_KEY.instructionAsks
    expect(key(row)).toBe('proposal-a')
    expect(key(changed)).toBe(key(row))
    expect(key(other)).toBe('proposal-b')
    const held = new Map([row, changed, other].map((one) => [key(one), one]))
    expect(held.size).toBe(2)
    expect(held.get('proposal-a')).toBe(changed)
  })

  it('distinguishes MCP requests even when they ask for the same server', () => {
    const row: PersonsRow<'mcpServerRequests'> = {
      requested: {
        type: 'mcp_server_requested',
        requestId: 'server-request-a',
        name: 'fictional-server',
        url: 'http://127.0.0.1:1234/mcp',
        reaches: 'Fictional records',
        whoGetsIt: 'everyone',
        requestedBy: 'requester',
      },
      conversation: 'conversation-a',
      askerCalled: 'Agent',
      at: 1_000,
    }
    const renamed = { ...row, askerCalled: 'Renamed agent', conversation: 'conversation-b' }
    const other = { ...row, requested: { ...row.requested, requestId: 'server-request-b' } }
    const key = PERSONS_ROW_KEY.mcpServerRequests
    expect(key(row)).toBe('server-request-a')
    expect(key(renamed)).toBe(key(row))
    expect(key(other)).toBe('server-request-b')
    expect(new Map([row, renamed, other].map((one) => [key(one), one])).size).toBe(2)
  })

  it('holds stalled, stopped, waiting and incident rows by piece rather than their captions', () => {
    assertPieceIdentity(PERSONS_ROW_KEY.stalled, {
      ...piece,
      ...owner,
      ...giver,
      because: 'turn_ended',
      askedToStop: null,
      stalledAt: 1_000,
    })
    assertPieceIdentity(PERSONS_ROW_KEY.stopped, { ...piece, ...holder, ...giver, at: 1_000 })
    assertPieceIdentity(PERSONS_ROW_KEY.waitingOnWhoWrote, {
      ...piece,
      ...owner,
      answeredAt: 1_000,
    })
    assertPieceIdentity(PERSONS_ROW_KEY.incidents, {
      ...piece,
      ...holder,
      ...giver,
      kind: 'wait-target-ended',
      since: 1_000,
    })
  })
})
