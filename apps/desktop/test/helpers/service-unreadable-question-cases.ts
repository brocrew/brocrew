import { expect, it, vi } from 'vitest'
import type { TranscriptEvent } from '../../src/shared/conversation-events'
import type { GiveOutcome, RuntimeHost } from '../../src/main/runtime/runtime-host'
import type { ToolName } from '../../src/main/runtime/agent-tools'
import type { AServiceWorld } from './a-service-world'

interface QuestionContext {
  world(): AServiceWorld
  aQuestionPassedUpTwice(opts: { readonly endingWaitMs?: number }): Promise<{
    host: RuntimeHost
    boss: string
    caller: string
    service: string
    one: Extract<GiveOutcome, { ok: true }>
    original: string
    copy: string
    outer: string
  }>
  call(
    host: RuntimeHost,
    conversation: string,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<{
    structured: Record<string, unknown>
    text: string
  }>
  rows(conversation: string, type: TranscriptEvent['type']): TranscriptEvent[]
  stateIn(askedBy: string, requestId: string): string | undefined
  stateOf(service: string, piece: string): string | undefined
}

export async function noteFromGiver(
  call: QuestionContext['call'],
  host: RuntimeHost,
  boss: string,
  caller: string,
): Promise<void> {
  const noted = await call(host, boss, 'message_agent', {
    agent: caller,
    kind: 'note',
    text: 'A note.',
  })
  expect(noted.structured).toMatchObject({ outcome: 'ok' })
}

export function registerUnreadableQuestionCases({
  world,
  aQuestionPassedUpTwice,
  call,
  rows,
  stateIn,
  stateOf,
}: QuestionContext): void {
  it.each(['reply', 'close', 'take-back'] as const)(
    'names the unreadable question ledger and cause on %s',
    async (ending) => {
      const { host, boss, caller, service, one, original, copy, outer } =
        await aQuestionPassedUpTwice({})
      const row = world()
        .db.prepare(
          `SELECT id, ordinal, payload FROM events WHERE session_id = ? AND type = 'question_asked'
               AND json_extract(payload, '$.requestId') = ?`,
        )
        .get(caller, copy) as { id: string; ordinal: number; payload: string }
      world()
        .db.prepare(`UPDATE events SET payload = json_remove(payload, '$.prompt') WHERE id = ?`)
        .run(row.id)
      await call(host, boss, 'message_agent', {
        agent: caller,
        kind: 'note',
        text: 'Read again.',
      })
      const end = () =>
        ending === 'reply'
          ? call(host, service, 'reply_to_parent', {
              piece: one.label,
              outcome: 'done',
              summary: 'The third floor.',
            })
          : call(host, caller, ending === 'close' ? 'update_work' : 'withdraw_task', {
              piece: one.label,
              ...(ending === 'close' ? { close: true } : {}),
            })
      const refused = await end()
      expect(refused.structured).toMatchObject({
        outcome: 'refused',
        rail: 'its-questions-could-not-all-be-read',
        detail: {
          unreadQuestion: {
            ledger: caller,
            row: row.ordinal,
            cause: 'is not a well-formed question',
          },
        },
      })
      expect(refused.text).toContain(caller)
      expect(refused.text).toContain(String(row.ordinal))
      expect(refused.text).toContain('is not a well-formed question')
      expect(refused.text).not.toContain('Try again; if it fails again')
      expect(rows(service, 'work_replied')).toEqual([])
      expect(rows(service, 'work_closed')).toEqual([])
      expect(rows(service, 'work_taken_back')).toEqual([])
      expect([stateIn(service, original), stateIn(boss, outer)]).toEqual(['open', 'open'])
      world().db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(row.payload, row.id)
      await call(host, boss, 'message_agent', { agent: caller, kind: 'note', text: 'Restored.' })
      expect((await end()).structured).toMatchObject({ outcome: 'ok' })
    },
  )

  it.each([
    ['question_asked', "'broken JSON'", 'is not JSON'],
    ['request_routed', "json_remove(payload, '$.parent')", 'is not a well-formed routing'],
  ] as const)(
    'names the unreadable %s row and its cause when closing',
    async (kind, broken, cause) => {
      const { host, boss, caller, service, one, copy } = await aQuestionPassedUpTwice({})
      const row = world()
        .db.prepare(
          `SELECT id, ordinal, payload FROM events WHERE session_id = ? AND type = ?
           AND json_extract(payload, '$.requestId') = ?`,
        )
        .get(caller, kind, copy) as { id: string; ordinal: number; payload: string }
      world().db.prepare(`UPDATE events SET payload = ${broken} WHERE id = ?`).run(row.id)
      await call(host, boss, 'message_agent', {
        agent: caller,
        kind: 'note',
        text: 'Read again.',
      })
      const refused = await call(host, caller, 'update_work', { piece: one.label, close: true })
      expect(refused.structured).toMatchObject({
        outcome: 'refused',
        rail: 'its-questions-could-not-all-be-read',
        detail: { unreadQuestion: { ledger: caller, row: row.ordinal, cause } },
      })
      expect(refused.text).toContain(caller)
      expect(refused.text).toContain(cause)
      expect(rows(service, 'work_closed')).toEqual([])
      world().db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(row.payload, row.id)
    },
  )

  it('returns the question ledger read exception when handing back', async () => {
    const { host, caller, service, one } = await aQuestionPassedUpTwice({})
    const read = world().store.questionsRaisedIn.bind(world().store)
    const failed = vi.spyOn(world().store, 'questionsRaisedIn').mockImplementation((id, unread) => {
      if (id === caller) throw new Error('fictional disk I/O error')
      return read(id, unread)
    })
    try {
      const refused = await call(host, service, 'reply_to_parent', {
        piece: one.label,
        outcome: 'done',
        summary: 'The third floor.',
      })
      expect(refused.structured).toMatchObject({
        outcome: 'refused',
        rail: 'its-questions-could-not-all-be-read',
        detail: { unreadQuestion: { ledger: caller, cause: 'fictional disk I/O error' } },
      })
      expect(refused.text).toContain(caller)
      expect(refused.text).toContain('fictional disk I/O error')
      expect(rows(service, 'work_replied')).toEqual([])
    } finally {
      failed.mockRestore()
    }
  })

  it('passed up twice, keep a piece a person takes back open while a copy in between is no well-formed question; restored, it ends with all three', async () => {
    const { host, boss, caller, service, one, original, copy, outer } =
      await aQuestionPassedUpTwice({})
    // The caller's copy loses its prompt; its row is still JSON. A note from its giver grows its
    // record, so what was read of it before is read again.
    const row = world()
      .db.prepare(
        `SELECT id, payload FROM events WHERE session_id = ? AND type = 'question_asked'
             AND json_extract(payload, '$.requestId') = ?`,
      )
      .get(caller, copy) as { id: string; payload: string }
    const aNote = () => noteFromGiver(call, host, boss, caller)
    world()
      .db.prepare(`UPDATE events SET payload = json_remove(payload, '$.prompt') WHERE id = ?`)
      .run(row.id)
    await aNote()
    expect(await host.takeBackForAPerson(one.label, world().window)).toEqual({
      ok: false,
      rail: 'its-questions-could-not-all-be-read',
    })
    expect(stateOf(service, one.piece)).not.toBe('withdrawn')
    expect(rows(service, 'work_taken_back')).toEqual([])
    expect([stateIn(service, original), stateIn(boss, outer)]).toEqual(['open', 'open'])
    world().db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(row.payload, row.id)
    await aNote()
    expect(await host.takeBackForAPerson(one.label, world().window)).toMatchObject({ ok: true })
    expect([stateIn(service, original), stateIn(caller, copy), stateIn(boss, outer)]).toEqual([
      'work-withdrawn',
      'work-withdrawn',
      'work-withdrawn',
    ])
  })
}
