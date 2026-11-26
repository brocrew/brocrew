import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { SHORT_REPLY_CHARACTERS } from '../src/main/runtime/tool-families/long-replies'
import { answerOn } from './helpers/call-tool'
import { fullReplyPath, theFileUnnamed, wholeReply } from './lib/full-reply'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'

const HOUR = 3_600_000
const AT = Date.parse('2026-11-25T08:00:00Z')

describe('read_transcript filters, and a long answer kept in a temp file', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  let reader: string
  let target: string
  let other: string
  let piece: { readonly piece: string; readonly label: string }

  const write = (event: Record<string, unknown>, at: number) =>
    world.store.append(target, world.store.nextOrdinal(target), event as TranscriptEvent, at)
  const turn = (at: number, received: Record<string, unknown>, said: string) => {
    write({ type: 'user_turn', ...received }, at)
    write({ type: 'assistant_message', text: said }, at + 1)
  }
  const read = async (args: Record<string, unknown>, as = reader) =>
    answerOn(agentToolsFor(host, as), 'read_transcript', { agent: target, ...args })

  beforeEach(async () => {
    world = aServiceWorld()
    world.anAgent('reader', 'normal')
    world.anAgent('worker', 'normal')
    world.anAgent('other', 'normal')
    host = world.aHost()
    reader = await world.aPersonOpens(host, 'reader')
    other = await world.aPersonOpens(host, 'other')
    const given = await world.gives(host, reader, 'worker')
    if (!given.ok) throw new Error('the task was not recorded')
    target = given.owner
    piece = { piece: given.piece, label: given.label }
    turn(AT, { text: 'a person asks for the budget' }, 'here is the budget')
    turn(
      AT + HOUR,
      {
        text: 'other conversation notes the venue',
        attribution: 'app_authored',
        relayedFrom: other,
        says: 'note',
      },
      'noted the venue',
    )
    turn(
      AT + 2 * HOUR,
      { text: 'the app reminds about open work', attribution: 'app_authored' },
      'checking the open work',
    )
    turn(
      AT + 3 * HOUR,
      {
        text: 'a follow-up on the booking',
        attribution: 'app_authored',
        relayedFrom: reader,
        piece: piece.piece,
      },
      'the booking is confirmed',
    )
  })

  afterEach(async () => {
    await world.cleanUp()
  })

  it('from a person keeps only the person’s turns, without the last exchange', async () => {
    const answer = await read({ from: 'a-person', turns_back: 20 })
    expect(answer.text).toContain('1 turn matches')
    expect(answer.text).toContain('a person asks for the budget')
    expect(answer.text).not.toContain('the venue')
    expect(answer.text).not.toContain('The last message')
    expect(answer.structured).toMatchObject({ outcome: 'ok', matched: 1, older: false })
  })

  it('from this-app keeps only the app’s own words', async () => {
    const answer = await read({ from: 'this-app', turns_back: 20 })
    expect(answer.text).toContain('the app reminds about open work')
    expect(answer.text).not.toContain('a person asks')
    expect(answer.text).not.toContain('the venue')
  })

  it('from a conversation keeps its messages', async () => {
    const answer = await read({ from: other, turns_back: 20 })
    expect(answer.text).toContain('other conversation notes the venue')
    expect(answer.structured).toMatchObject({ matched: 1 })
  })

  it('since and until keep the turns that began inside the range, both ends included', async () => {
    const answer = await read({
      since: new Date(AT + HOUR).toISOString(),
      until: new Date(AT + 2 * HOUR).toISOString(),
      turns_back: 20,
    })
    expect(answer.structured).toMatchObject({ matched: 2 })
    expect(answer.text).toContain('the venue')
    expect(answer.text).toContain('open work')
    expect(answer.text).not.toContain('budget')
  })

  it('an empty range matches nothing and says so', async () => {
    const answer = await read({
      since: new Date(AT + 10 * HOUR).toISOString(),
      until: new Date(AT).toISOString(),
    })
    expect(answer.structured).toMatchObject({ outcome: 'ok', matched: 0 })
    expect(answer.text).toContain('No turn of')
  })

  it('about keeps the turns sent about that task', async () => {
    const answer = await read({ about: piece.label, turns_back: 20 })
    expect(answer.text).toContain('a follow-up on the booking')
    expect(answer.text).not.toContain('the venue')
  })

  it('kind keeps one half, and search looks only in that half', async () => {
    const received = await read({ kind: 'received', turns_back: 20 })
    expect(received.text).toContain('a person asks for the budget')
    expect(received.text).not.toContain('here is the budget')
    const answers = await read({ kind: 'answers', turns_back: 20 })
    expect(answers.text).toContain('here is the budget')
    expect(answers.text).not.toContain('a person asks for the budget')
    expect((await read({ kind: 'answers', search: 'confirmed' })).structured).toMatchObject({
      matched: 1,
    })
    expect((await read({ kind: 'received', search: 'confirmed' })).structured).toMatchObject({
      matched: 0,
    })
  })

  it('kind received leaves out a turn its provider started, which received nothing', async () => {
    write({ type: 'provider_turn' }, AT + 4 * HOUR)
    write({ type: 'assistant_message', text: 'woke on my own' }, AT + 4 * HOUR + 1)
    const received = await read({
      kind: 'received',
      since: new Date(AT).toISOString(),
      turns_back: 20,
    })
    expect(received.structured).toMatchObject({ matched: 4 })
    expect(received.text).not.toContain('started by itself')
    const both = await read({ since: new Date(AT).toISOString(), turns_back: 20 })
    expect(both.structured).toMatchObject({ matched: 5 })
  })

  it('filters combine', async () => {
    const answer = await read({
      from: reader,
      about: piece.label,
      since: new Date(AT + 3 * HOUR).toISOString(),
      search: 'booking',
      kind: 'received',
    })
    expect(answer.structured).toMatchObject({ matched: 1 })
    expect(answer.text).toContain('a follow-up on the booking')
    expect(answer.text).not.toContain('the booking is confirmed')
    const none = await read({ from: other, about: piece.label })
    expect(none.structured).toMatchObject({ matched: 0 })
  })

  it('refuses a time that does not read, and names an unknown sender or task as before', async () => {
    expect((await read({ since: 'yesterday-ish' })).structured).toMatchObject({
      rail: 'malformed-request',
    })
    expect((await read({ until: '0' })).structured).toMatchObject({ rail: 'malformed-request' })
    expect((await read({ since: '2026-02-30T09:00:00Z' })).structured).toMatchObject({
      rail: 'malformed-request',
    })
    expect((await read({ since: '2026-11-25' })).structured).toMatchObject({ outcome: 'ok' })
    expect((await read({ from: 'W99.1' })).structured).toMatchObject({ rail: 'no-such-agent' })
    expect((await read({ about: 'W99.1' })).structured).toMatchObject({
      rail: 'no-piece-by-that-name',
    })
  })

  it('a long answer comes back short, with the whole of it in a fresh temp file', async () => {
    for (let n = 0; n < 20; n += 1) {
      turn(
        AT + (5 + n) * HOUR,
        { text: `long message ${String(n)} ${'x'.repeat(3000)}` },
        `answer ${String(n)} ${'y'.repeat(3000)}`,
      )
    }
    const first = await read({ from: 'a-person', turns_back: 20 })
    expect(first.text.length).toBeLessThanOrEqual(SHORT_REPLY_CHARACTERS)
    expect(first.text).toContain('turns match')
    const path = fullReplyPath(first.text)
    expect(path).not.toBeNull()
    const kept = readFileSync(path!, 'utf8')
    expect(kept).toContain('long message 19')
    expect(kept).toContain('answer 19')
    expect(kept.length).toBeGreaterThan(SHORT_REPLY_CHARACTERS)

    const second = await read({ from: 'a-person', turns_back: 20 })
    const again = fullReplyPath(second.text)
    expect(again).not.toBeNull()
    expect(readFileSync(again!, 'utf8')).toBe(kept)
    expect(again).not.toBe(path)
    expect(readFileSync(path!, 'utf8')).toBe(kept)
  })

  it('a short answer stays inline, with no file', async () => {
    const answer = await read({ from: 'a-person' })
    expect(answer.text).toContain('a person asks for the budget')
    expect(answer.text).not.toContain('Full reply:')
  })

  it('a Claude reader and a Codex reader get the same words, short or long', async () => {
    world.anAgent('codex-reader', 'normal', 'codex')
    const codexReader = await world.aPersonOpens(host, 'codex-reader')
    const short = { from: 'a-person', turns_back: 20 }
    expect((await read(short, codexReader)).text).toBe((await read(short)).text)
    for (let n = 0; n < 20; n += 1) {
      turn(AT + (5 + n) * HOUR, { text: `long ${String(n)} ${'x'.repeat(3000)}` }, 'y'.repeat(3000))
    }
    const byCodex = (await read(short, codexReader)).text
    const byClaude = (await read(short)).text
    expect(byClaude).toContain('Full reply: ')
    expect(theFileUnnamed(byCodex)).toBe(theFileUnnamed(byClaude))
    expect(wholeReply(byCodex)).toBe(wholeReply(byClaude))
  })
})
