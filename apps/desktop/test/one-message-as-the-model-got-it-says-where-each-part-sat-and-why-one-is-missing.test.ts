import { describe, expect, it } from 'vitest'
import { conversationBlock } from '../src/main/runtime/instructions'
import {
  oneMessageAsTheModelGotIt,
  type AnEarlierMessage,
  type WhatTheMessageReadIsHanded,
} from '../src/main/runtime/what-this-agent-was-given'
import {
  sizeOf,
  type GivenRecordFile,
  type ModelGotPart,
  type WhatALaunchGave,
} from '../src/shared/what-this-agent-was-given'
import type { UserTurnEvent, UserTurnPart } from '../src/shared/runtime-ipc'

/**
 * # 🔴 F093 · C9 d — one message as the model got it: where each part sat, and why one is missing
 *
 * ⚑ **The read with no host** (`oneMessageAsTheModelGotIt`), handed what the host reads off the
 * ledger, so every case the host test cannot reach cheaply is read here: a turn of several messages,
 * a message with files, a message whose text was not kept, a Codex `/compact`, a launch brought in
 * from elsewhere or unreadable, BroBot's file refused at launch, and every place Codex's lead can
 * have ridden — or not yet.
 *
 * ⛔ A negative is read beside a positive from the same reader; a presence before an order or a text.
 */

const PROFILE_TEXT = '# Profile\n\n## How you work\nCarefully.'
const CONVERSATION = '## This conversation\nYou are lead.'
const BLOCK = conversationBlock(CONVERSATION)

const aRecord = (over: Partial<WhatALaunchGave> = {}): WhatALaunchGave => ({
  build: { id: 'abc1234', commit: 'abc1234def' },
  placement: 'system-prompt',
  profileFile: {
    path: '/homes/lead/claude/CLAUDE.md',
    text: PROFILE_TEXT,
    sections: [],
    refused: null,
  },
  ownInstructionsVersion: null,
  thisConversation: { text: CONVERSATION, sections: [] },
  files: [],
  memory: [],
  tools: { server: 'brobot', count: 0, sha256: '' },
  ...over,
})

const aTurn = (over: Partial<UserTurnEvent> = {}): UserTurnEvent => ({
  type: 'user_turn',
  text: 'please plan',
  sent: 'Sent by a person, typed into this app.\n\nplease plan',
  ...over,
})

const handed = (over: Partial<WhatTheMessageReadIsHanded> = {}): WhatTheMessageReadIsHanded => ({
  sessionId: 'sess_7',
  provider: 'claude',
  message: { ordinal: 40, at: 4_000, event: aTurn() },
  launch: { ordinal: 3, at: 300, kept: 'recorded', record: aRecord() },
  firstOfItsLaunch: true,
  earlierInThisLaunch: () => [],
  providersRecord: { found: false, why: 'The provider’s own record of this message is gone.' },
  ...over,
})

/** ⚑ An earlier-messages walk that refuses to be walked: a read that needs none never calls it. */
const neverWalked = (): Iterable<AnEarlierMessage> => {
  throw new Error('the launch’s earlier messages were walked')
}

const kinds = (parts: readonly ModelGotPart[]): string[] => parts.map((one) => one.kind)
const theMessage = (parts: readonly ModelGotPart[]): ModelGotPart => {
  const last = parts.at(-1)
  if (last?.kind !== 'the-message') throw new Error('the message is not the last part')
  return last
}

describe('§1 · a turn of several messages, and a message with files', () => {
  it('🔴 a held turn: its words one per message, oldest first; the text as handed over is the whole of it', () => {
    const sent = '2 messages were held for you…\n\nMessage 1 of 2.\n\np1\n\nMessage 2 of 2.\n\np2'
    const parts: UserTurnPart[] = [{ text: 'p1' }, { text: 'p2' }]
    const got = oneMessageAsTheModelGotIt(
      handed({
        message: { ordinal: 40, at: 4_000, event: aTurn({ text: 'p1\n\np2', parts, sent }) },
      }),
    )
    expect(got.words).toEqual(['p1', 'p2'])
    expect(theMessage(got.parts)).toMatchObject({
      where: 'this-message',
      origin: 'a-person',
      text: sent,
      why: null,
      size: sizeOf(sent),
    })
  })

  it('🔴 whose words: one sender for every message is that sender; any two different is unknown', () => {
    const origin = (parts: UserTurnPart[] | undefined, top: Partial<UserTurnEvent> = {}) =>
      theMessage(
        oneMessageAsTheModelGotIt(
          handed({
            message: {
              ordinal: 40,
              at: 4_000,
              event: aTurn({ ...top, ...(parts === undefined ? {} : { parts }) }),
            },
          }),
        ).parts,
      ).origin
    // ⚑ All the same: that one.
    expect(origin([{ text: 'a' }, { text: 'b' }])).toBe('a-person')
    expect(
      origin([
        { text: 'a', relayedFrom: 'sess_1' },
        { text: 'b', relayedFrom: 'sess_2' },
      ]),
    ).toBe('an-agent')
    expect(
      origin([
        { text: 'a', attribution: 'app_authored' },
        { text: 'b', attribution: 'app_authored' },
      ]),
    ).toBe('brobot')
    // ⛔ Mixed — the FIRST a person's — is no one's in particular.
    expect(origin([{ text: 'a' }, { text: 'n', attribution: 'app_authored' }])).toBe('unknown')
    expect(origin([{ text: 'a' }, { text: 'r', relayedFrom: 'sess_1' }])).toBe('unknown')
    // ⛔ Parts that do not read: no message, so no sender.
    expect(origin([{ junk: true } as unknown as UserTurnPart])).toBe('unknown')
    // ⚑ A turn of one is its own top level.
    expect(origin(undefined)).toBe('a-person')
    expect(origin(undefined, { attribution: 'app_authored' })).toBe('brobot')
    expect(origin(undefined, { relayedFrom: 'sess_1' })).toBe('an-agent')
    expect(origin(undefined, { attribution: 'provider_transcript' })).toBe('unknown')
  })

  it('⚑ a message with files: the words are the person’s alone, the text handed over carries the files', () => {
    const sent =
      'Sent by a person, typed into this app.\n\nlook at this\n\nAttached:\n- /work/project/notes.md'
    const got = oneMessageAsTheModelGotIt(
      handed({
        message: {
          ordinal: 40,
          at: 4_000,
          event: aTurn({
            text: 'look at this',
            attachments: [{ path: '/work/project/notes.md', kind: 'file', outsideCwd: false }],
            sent,
          }),
        },
      }),
    )
    expect(got.words).toEqual(['look at this'])
    expect(got.words.join('\n')).not.toContain('notes.md')
    expect(theMessage(got.parts).text).toBe(sent)
    expect(theMessage(got.parts).text).toContain('/work/project/notes.md')
  })
})

describe('§2 · a message whose text was not kept', () => {
  const missing = (provider: 'claude' | 'codex', event: UserTurnEvent): ModelGotPart =>
    theMessage(
      oneMessageAsTheModelGotIt(
        handed({
          provider,
          message: { ordinal: 40, at: 4_000, event },
          launch: {
            ordinal: 3,
            at: 300,
            kept: 'recorded',
            record: aRecord({
              placement: provider === 'claude' ? 'system-prompt' : 'first-message',
            }),
          },
          earlierInThisLaunch: () => [],
        }),
      ).parts,
    )

  const NO_COPY = 'This app kept no copy of the text it handed over for this message.'
  const COMPACTION = 'This was a command for Codex’s own compaction. No words reached the model.'
  const FROM_THE_PROVIDER =
    'This message was read from the provider’s own record: this app did not hand it over.'

  it('⛔ no copy kept: said so, with no text and no size', () => {
    for (const provider of ['claude', 'codex'] as const) {
      expect(missing(provider, aTurn({ sent: undefined })), provider).toMatchObject({
        text: null,
        size: null,
        why: NO_COPY,
      })
    }
  })

  it('🔴 Codex’s `/compact` alone, as typed or padded: no words reached the model — on Claude, no copy', () => {
    for (const typed of ['/compact', '  /compact\n']) {
      expect(missing('codex', aTurn({ text: typed, sent: undefined })).why, typed).toBe(COMPACTION)
    }
    expect(missing('claude', aTurn({ text: '/compact', sent: undefined })).why).toBe(NO_COPY)
    // ⛔ Among other messages, or with words after it, it is not the compaction command.
    expect(
      missing(
        'codex',
        aTurn({
          text: '/compact\n\nx',
          parts: [{ text: '/compact' }, { text: 'x' }],
          sent: undefined,
        }),
      ).why,
      // ⚑ W4.177 — a turn of several went over as one text, and is said as a turn.
    ).toBe('This app kept no copy of the text it handed over for this turn.')
    expect(missing('codex', aTurn({ text: '/compact now', sent: undefined })).why).toBe(NO_COPY)
    // ⚑ …and a `/compact` whose text WAS kept is shown as it went.
    expect(missing('codex', aTurn({ text: '/compact', sent: '/compact' }))).toMatchObject({
      text: '/compact',
      why: null,
    })
  })

  it('⛔ a message read from the provider’s own record: this app did not hand it over — before any other why', () => {
    expect(
      missing('claude', aTurn({ attribution: 'provider_transcript', sent: undefined })).why,
    ).toBe(FROM_THE_PROVIDER)
    expect(
      missing(
        'codex',
        aTurn({ text: '/compact', attribution: 'provider_transcript', sent: undefined }),
      ).why,
    ).toBe(FROM_THE_PROVIDER)
  })

  it('⛔ a text kept that is not words is no copy', () => {
    const odd = aTurn({ sent: 42 as unknown as string })
    expect(missing('claude', odd)).toMatchObject({ text: null, why: NO_COPY })
  })
})

describe('§3 · the launch the message went in', () => {
  const NO_LAUNCH = 'This app’s record of the conversation holds no launch before this message.'
  const IMPORTED =
    'This conversation was brought in from elsewhere, and this app describes only the launches it made itself.'
  const UNREADABLE = 'This message’s launch kept a record this app could not read.'
  const NONE =
    'This message’s launch kept no record of what it gave: it was made before this app kept one, or keeping it failed.'

  it('⛔ each way a launch is not described says its own why, on both of BroBot’s parts it cannot give', () => {
    const cases = [
      { launch: null, why: NO_LAUNCH },
      {
        launch: { ordinal: 3, at: 300, kept: 'imported' as const, record: aRecord() },
        why: IMPORTED,
      },
      {
        launch: { ordinal: 3, at: 300, kept: 'unreadable' as const, record: null },
        why: UNREADABLE,
      },
      { launch: { ordinal: 3, at: 300, kept: 'none' as const, record: null }, why: NONE },
    ]
    for (const { launch, why } of cases) {
      const got = oneMessageAsTheModelGotIt(
        handed({ launch, firstOfItsLaunch: launch === null ? null : true }),
      )
      expect(kinds(got.parts), why).toEqual([
        'profile-instructions',
        'this-conversation',
        'the-message',
      ])
      expect(got.parts.slice(0, 2), why).toMatchObject([
        { where: 'system-prompt', text: null, size: null, why, path: null },
        { where: 'system-prompt', text: null, size: null, why, path: null },
      ])
      expect(got.launch, why).toEqual(
        launch === null ? null : { ordinal: 3, at: 300, recorded: false },
      )
    }
  })

  it('⛔ a conversation brought in from elsewhere: a record handed with it is not taken — none of its files or words', () => {
    const record = aRecord({
      files: [
        {
          path: '/repo/CLAUDE.md',
          kind: 'repository-conventions',
          bytes: 1,
          sha256: 'x',
          truncated: false,
        },
      ],
    })
    const imported = oneMessageAsTheModelGotIt(
      handed({ launch: { ordinal: 3, at: 300, kept: 'imported', record } }),
    )
    const recorded = oneMessageAsTheModelGotIt(
      handed({ launch: { ordinal: 3, at: 300, kept: 'recorded', record } }),
    )
    // ⚑ The control: the same record, recorded, gives its profile, its file and its words.
    expect(kinds(recorded.parts)).toEqual([
      'profile-instructions',
      'repository-conventions',
      'this-conversation',
      'the-message',
    ])
    expect(recorded.launch?.recorded).toBe(true)
    expect(kinds(imported.parts)).toEqual([
      'profile-instructions',
      'this-conversation',
      'the-message',
    ])
    expect(imported.launch?.recorded).toBe(false)
    expect(imported.parts.map((one) => one.text).join('')).not.toContain('How you work')
  })

  it('⚑ on Codex the parts it cannot give are named where Codex reads them: the first message', () => {
    const got = oneMessageAsTheModelGotIt(
      handed({
        provider: 'codex',
        launch: { ordinal: 3, at: 300, kept: 'none', record: null },
        earlierInThisLaunch: neverWalked,
      }),
    )
    expect(got.parts.slice(0, 2).map((one) => one.where)).toEqual([
      'first-message',
      'first-message',
    ])
  })

  it('⚑ the answer carries the message’s place and time, the launch’s, and R1’s slot as handed', () => {
    const got = oneMessageAsTheModelGotIt(handed({ firstOfItsLaunch: false }))
    expect(got).toMatchObject({
      sessionId: 'sess_7',
      provider: 'claude',
      ordinal: 40,
      at: 4_000,
      firstOfItsLaunch: false,
      launch: { ordinal: 3, at: 300, recorded: true },
      providersRecord: { found: false, why: 'The provider’s own record of this message is gone.' },
    })
  })
})

describe('§4 · BroBot’s file and the other files the launch kept', () => {
  it('⛔ BroBot’s file refused at launch: no text, its path, and why — by the reader’s reason', () => {
    const said = (refused: string): ModelGotPart | undefined => {
      const record = aRecord({
        profileFile: {
          path: '/homes/lead/AGENTS.override.md',
          text: PROFILE_TEXT,
          sections: [],
          refused,
        },
      })
      return oneMessageAsTheModelGotIt(
        handed({ launch: { ordinal: 3, at: 300, kept: 'recorded', record } }),
      ).parts[0]
    }
    expect(said('unmanaged-override')).toMatchObject({
      kind: 'profile-instructions',
      path: '/homes/lead/AGENTS.override.md',
      text: null,
      size: null,
      why: 'It did not reach the model: someone else’s file is at the name BroCrew publishes it under, and BroCrew left that file alone.',
    })
    expect(said('over-budget')?.why).toBe(
      'It did not reach the model: the instructions’ size limit ran out before it.',
    )
    expect(said('something-else')?.why).toBe(
      'It did not reach the model: this app’s reader did not send it.',
    )
    // ⚑ The control: not refused, it is there in full.
    const sent = oneMessageAsTheModelGotIt(handed()).parts[0]
    expect(sent).toMatchObject({ kind: 'profile-instructions', text: PROFILE_TEXT, why: null })
    expect(sent?.size).toEqual(sizeOf(PROFILE_TEXT))
  })

  it('⚑ no profile file composed: no part for it; the files follow in the reader’s order, each by whose it is', () => {
    const files: GivenRecordFile[] = [
      {
        path: '/ws/CLAUDE.md',
        kind: 'workspace-instructions',
        bytes: 9,
        sha256: 'a',
        truncated: false,
        text: '# BroCrew workspace',
      },
      {
        path: '/repo/sub/CLAUDE.md',
        kind: 'repository-conventions',
        bytes: 9,
        sha256: 'b',
        truncated: false,
      },
      {
        path: '/homes/lead/claude/CLAUDE.md',
        kind: 'profile-memory',
        bytes: 9,
        sha256: 'c',
        truncated: false,
      },
    ]
    const got = oneMessageAsTheModelGotIt(
      handed({
        launch: {
          ordinal: 3,
          at: 300,
          kept: 'recorded',
          record: aRecord({ profileFile: null, files }),
        },
      }),
    )
    expect(kinds(got.parts)).toEqual([
      'workspace-instructions',
      'repository-conventions',
      'profile-memory',
      'this-conversation',
      'the-message',
    ])
    const [workspace, repository, memory] = got.parts
    expect(workspace).toMatchObject({
      title: 'BroCrew’s workspace file',
      origin: 'brobot',
      path: '/ws/CLAUDE.md',
      text: '# BroCrew workspace',
      why: null,
    })
    // ⚑ W4.177 — a file kept by its fingerprint is read now, to give the text the model got when it
    // is still the same; these paths are a fixture's, so nothing is there to read.
    const BY_FINGERPRINT =
      'This app keeps this file by its fingerprint only, since BroCrew did not write it, and the file cannot be read now: what the model got cannot be shown.'
    expect(repository).toMatchObject({
      title: 'CLAUDE.md, this folder’s own file',
      origin: 'a-repository',
      path: '/repo/sub/CLAUDE.md',
      text: null,
      size: null,
      why: BY_FINGERPRINT,
    })
    expect(memory).toMatchObject({
      title: 'This profile’s own CLAUDE.md',
      text: null,
      why: BY_FINGERPRINT,
    })
    expect(got.parts.slice(0, 4).every((one) => one.where === 'system-prompt')).toBe(true)
  })
})

describe('§5 · this conversation’s lead', () => {
  const onCodex = (
    sent: string | undefined,
    earlier: readonly AnEarlierMessage[] | (() => Iterable<AnEarlierMessage>) = [],
    record: WhatALaunchGave = aRecord({ placement: 'first-message' }),
  ) =>
    oneMessageAsTheModelGotIt(
      handed({
        provider: 'codex',
        message: { ordinal: 40, at: 4_000, event: aTurn({ sent }) },
        launch: { ordinal: 3, at: 300, kept: 'recorded', record },
        earlierInThisLaunch: typeof earlier === 'function' ? earlier : () => earlier,
      }),
    )
  const leadOf = (parts: readonly ModelGotPart[]): ModelGotPart | undefined =>
    parts.find((one) => one.kind === 'this-conversation')

  it('🔴 Claude: in the system prompt, whole — and a message that starts as the lead does is never split', () => {
    const sent = `${BLOCK}\n\nplease plan`
    const got = oneMessageAsTheModelGotIt(
      handed({
        message: { ordinal: 40, at: 4_000, event: aTurn({ sent }) },
        earlierInThisLaunch: neverWalked,
      }),
    )
    expect(leadOf(got.parts)).toMatchObject({ where: 'system-prompt', text: BLOCK, why: null })
    expect(theMessage(got.parts).text).toBe(sent)
  })

  it('🔴 Codex: split off the front of the message it rode, exactly — the launch’s other messages unread', () => {
    const got = onCodex(`${BLOCK}\n\nplease plan`, neverWalked)
    expect(leadOf(got.parts)).toMatchObject({
      where: 'this-message',
      title: 'What is true of this conversation, in front of this message',
      text: BLOCK,
      size: sizeOf(BLOCK),
    })
    expect(theMessage(got.parts).text).toBe('please plan')
    expect(kinds(got.parts).slice(-2)).toEqual(['this-conversation', 'the-message'])
  })

  it('⛔ Codex: the lead with no blank line after it, or alone, did not ride in front of this message', () => {
    for (const sent of [`${BLOCK}please plan`, BLOCK, `x${BLOCK}\n\nplease plan`]) {
      const got = onCodex(sent, [])
      expect(leadOf(got.parts)?.where, sent).not.toBe('this-message')
      expect(theMessage(got.parts).text, sent).toBe(sent)
    }
  })

  it('🔴 Codex: named where it LAST rode — the newest earlier message that carried it, and the walk stops there', () => {
    let pulled = 0
    const earlier: AnEarlierMessage[] = [
      { ordinal: 30, sent: 'plain', first: false },
      { ordinal: 20, sent: `${BLOCK}\n\nafter the compaction`, first: false },
      { ordinal: 10, sent: `${BLOCK}\n\nthe first`, first: true },
    ]
    const walk = function* (): Generator<AnEarlierMessage> {
      for (const one of earlier) {
        pulled += 1
        yield one
      }
    }
    const got = onCodex('and one more', walk)
    expect(leadOf(got.parts)).toMatchObject({
      where: 'an-earlier-message',
      title: 'What is true of this conversation, in front of an earlier message of this launch',
      text: BLOCK,
    })
    expect(pulled).toBe(2)
    expect(theMessage(got.parts).text).toBe('and one more')

    // ⚑ The control: only the first carried it — named there.
    const onlyFirst = onCodex('and one more', [earlier[0], earlier[2]] as AnEarlierMessage[])
    expect(leadOf(onlyFirst.parts)).toMatchObject({
      where: 'first-message',
      title: 'What is true of this conversation, in front of the first message of this launch',
      text: BLOCK,
    })
  })

  it('⛔ Codex: no message so far carried it — not reached yet; and when a text was not kept, not known', () => {
    const NOT_YET =
      'It had not reached the model by this message: it rides in front of the next message that carries words.'
    const UNKNOWN =
      'Where it rode is not known: this app kept no copy of the text handed over with every message of this launch.'
    const plain: AnEarlierMessage[] = [{ ordinal: 20, sent: 'a', first: true }]
    expect(leadOf(onCodex('b', plain).parts)).toMatchObject({
      where: 'first-message',
      text: null,
      size: null,
      why: NOT_YET,
    })
    expect(leadOf(onCodex('b', []).parts)?.why).toBe(NOT_YET)
    // ⛔ An earlier text not kept, or this one not kept: where it rode cannot be said.
    expect(leadOf(onCodex('b', [{ ordinal: 20, sent: undefined, first: true }]).parts)?.why).toBe(
      UNKNOWN,
    )
    expect(leadOf(onCodex(undefined, plain).parts)?.why).toBe(UNKNOWN)
    // ⚑ …but a carrier newer than the text not kept still names where it rode.
    expect(
      leadOf(
        onCodex('b', [
          { ordinal: 30, sent: `${BLOCK}\n\nx`, first: false },
          { ordinal: 20, sent: undefined, first: true },
        ]).parts,
      )?.where,
    ).toBe('an-earlier-message')
  })

  it('⚑ Codex: a launch that composed no conversation text has no lead part at all', () => {
    const got = onCodex(
      'b',
      neverWalked,
      aRecord({ placement: 'first-message', thisConversation: null }),
    )
    expect(kinds(got.parts)).toEqual(['profile-instructions', 'the-message'])
    expect(got.parts[0]?.where).toBe('first-message')
  })
})
