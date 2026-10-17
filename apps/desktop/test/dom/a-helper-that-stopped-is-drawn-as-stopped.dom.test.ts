import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import PersonsQueue from '../../src/renderer/src/components/PersonsQueue.vue'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import type { AttentionRequest } from '../../src/renderer/src/lib/attention'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import { clockTime } from '../../src/shared/clock'
import type { LedgerWalk, PersonsDecision, PersonsQuestion } from '../../src/shared/questions'
import type { StalledWork } from '../../src/shared/stalled-work'
import type { StoppedWorkForAPerson } from '../../src/shared/stopped-work'
import { assertDrawn, drawnReady } from './drawn'
import { mount, paneProps, record, unmountAll, visible } from './harness'

/**
 * A helper that stopped with a given piece open reads, on its giver, "W6.4.1 with Quinn: stopped at
 * 00:28", and the piece shows under Waiting on you as "stopped at 00:28. Look, or take it back for Ada
 * to redo or give again.", with
 * a press that opens the holder and one that hands the piece back.
 */

const AT = new Date(2026, 9, 9, 0, 28).getTime()
const STOPPED_SAYS = `W6.4.1 with Quinn: stopped at ${clockTime(AT)}`

const read = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

afterEach(async () => {
  unmountAll()
  usePersonsQueue().forget()
  await page.viewport(1200, 808)
})

describe('the giver of a piece whose helper stopped', () => {
  const giver = async (stoppedWork: readonly unknown[], workWith: readonly string[] = []) => {
    await page.viewport(1200, 808)
    const m = mount(
      ConversationPane,
      paneProps({
        record: record([{ type: 'status', state: 'idle' } as never]),
        drawerOpen: true,
        waiting: 'waiting-on-a-worker',
        workWith,
        stoppedWork,
      }),
      { width: 1200, height: 808 },
    )
    await drawnReady()
    return m
  }

  it('says the piece, its holder and when it stopped, drawn whole', async () => {
    const m = await giver([{ label: 'W6.4.1', holder: 'Quinn', at: AT }])
    // The agent panel's plate, which says the giver's state in its words.
    const word = m.q('session-bot-word')
    expect(read(word)).toBe(STOPPED_SAYS)
    assertDrawn(word, 'the stopped helper on its giver')
    unmountAll()

    // One fact over: the same giver, its helper still at work.
    const working = await giver([], ['Quinn'])
    expect(read(working.q('session-bot-word'))).toBe('waiting on Quinn')
  })
})

const walkOf = (rows: StoppedWorkForAPerson[]): LedgerWalk<StoppedWorkForAPerson> =>
  ({
    rows,
    walk: 'every-conversation-that-was-given-work',
    ledgers: 1,
    rowsUnread: 0,
  }) as LedgerWalk<StoppedWorkForAPerson>

const QUINN: StoppedWorkForAPerson = {
  piece: 'work_641',
  label: 'W6.4.1',
  title: 'Draw the world clock page.',
  holder: 'sess_quinn',
  holderName: 'Quinn',
  giver: 'sess_ada',
  giverName: 'Ada',
  at: AT,
}

/** The queue, supplied the stopped work and doors that record each press. */
function supply(
  stopped: LedgerWalk<StoppedWorkForAPerson> | null,
  handBack: (label: string) => Promise<string> = async () => 'Taken back.',
  lastLookAnswered = true,
  stalled?: LedgerWalk<StalledWork>,
): { opened: string[]; handed: string[] } {
  const opened: string[] = []
  const handed: string[] = []
  const EMPTY = <Row>(): LedgerWalk<Row> =>
    ({
      rows: [],
      walk: 'every-conversation-that-routed',
      ledgers: 1,
      rowsUnread: 0,
    }) as LedgerWalk<Row>
  usePersonsQueue().supply(
    EMPTY<PersonsQuestion>(),
    EMPTY<PersonsDecision>(),
    {
      held: new Set<string>(),
      answerable: new Map<string, AttentionRequest>(),
      now: AT + 60_000,
      lastLookAnswered: { questions: true, decisions: true },
      answeredFromHere: new Set<string>(),
    },
    {
      travel: () => {},
      settle: () => {},
      takeOver: () => {},
      open: (sessionId) => opened.push(sessionId),
      handBack: (label) => {
        handed.push(label)
        return handBack(label)
      },
    },
    undefined,
    stalled === undefined ? undefined : { walked: stalled, lastLookAnswered: true },
    undefined,
    undefined,
    undefined,
    { walked: stopped, lastLookAnswered },
  )
  return { opened, handed }
}

const waitingOnYou = async () => {
  await page.viewport(1400, 1200)
  const m = mount(WaitingOnYou, { needsYou: [], clock: AT + 60_000 }, { width: 1351, height: 1200 })
  await drawnReady()
  return m
}

describe('a stopped piece under Waiting on you', () => {
  it('is drawn whole: the piece and its holder, its title, when it stopped, and its two presses', async () => {
    supply(walkOf([QUINN]))
    const m = await waitingOnYou()
    const who = m.q('persons-queue-stopped-who-work_641')
    expect(read(who)).toBe('W6.4.1 with Quinn')
    const says = m.q('persons-queue-stopped-says-work_641')
    expect(read(says)).toBe(
      `stopped at ${clockTime(AT)}. Look, or take it back for Ada to redo or give again.`,
    )
    const look = m.q('persons-queue-stopped-look-work_641')
    const handBack = m.q('persons-queue-stopped-hand-back-work_641')
    expect(read(look)).toBe('Look')
    expect(read(handBack)).toBe('Take back')
    for (const [el, what] of [
      [who, 'the piece and its holder'],
      [says, 'when it stopped'],
      [look, 'Look'],
      [handBack, 'Take back'],
    ] as const) {
      assertDrawn(el, what)
    }
    // It is owed by nobody, so the page does not call itself quiet over it, nor count it.
    expect(read(m.q('waiting-stat'))).not.toBe('All clear')
  })

  it('says “its giver” when the row names no giver', async () => {
    supply(walkOf([{ ...QUINN, giverName: '' }]))
    const m = await waitingOnYou()
    expect(read(m.q('persons-queue-stopped-says-work_641'))).toBe(
      `stopped at ${clockTime(AT)}. Look, or take it back for its giver to redo or give again.`,
    )
  })

  it('Look opens the holder’s conversation and hands nothing back', async () => {
    const { opened, handed } = supply(walkOf([QUINN]))
    const m = await waitingOnYou()
    m.q('persons-queue-stopped-look-work_641').click()
    expect(opened).toEqual(['sess_quinn'])
    expect(handed).toEqual([])
  })

  it('Take back asks the door once, by its label, and says its answer in place', async () => {
    let answer: (said: string) => void = () => {}
    const pending = new Promise<string>((done) => (answer = done))
    const { handed, opened } = supply(walkOf([QUINN]), () => pending)
    const m = await waitingOnYou()
    const press = m.q('persons-queue-stopped-hand-back-work_641') as HTMLButtonElement
    press.click()
    press.click()
    await nextTick()
    expect(handed).toEqual(['W6.4.1'])
    expect(press.disabled).toBe(true)

    answer('Not taken back: it is no longer stopped.')
    await nextTick()
    await nextTick()
    await drawnReady()
    const said = m.q('persons-queue-stopped-said-work_641')
    expect(read(said)).toBe('Not taken back: it is no longer stopped.')
    expect(said.getAttribute('role')).toBe('status')
    assertDrawn(said, 'what the hand-back answered')
    expect(press.disabled).toBe(false)
    expect(opened).toEqual([])
  })

  it('a look that did not answer says so, and nothing stopped draws nothing', async () => {
    supply(null, undefined, false)
    const unread = await waitingOnYou()
    expect(visible(unread.q('persons-queue-stopped-unread'))).toBe(true)
    unmountAll()

    supply(walkOf([]))
    const quiet = await waitingOnYou()
    expect(quiet.host.querySelector('[data-cy="persons-queue-stopped"]')).toBeNull()
    expect(quiet.host.querySelector('[data-cy="persons-queue"]')).toBeNull()
  })

  it('a look that answered without reading every row says so, also when it lists nothing', async () => {
    for (const short of [
      { rowsUnread: 3, ledgersSkipped: 0 },
      { rowsUnread: 0, ledgersSkipped: 2 },
    ]) {
      supply({ ...walkOf([]), ...short })
      const m = await waitingOnYou()
      const line = m.q('persons-queue-stopped-short')
      expect(visible(line)).toBe(true)
      assertDrawn(line, 'the rows the look could not read')
      expect(read(m.q('waiting-stat'))).not.toBe('All clear')
      expect(m.host.querySelector('[data-cy="persons-queue-stopped-unread"]')).toBeNull()
      unmountAll()
    }
    // The control: a whole read with nothing in it says nothing.
    supply(walkOf([]))
    const whole = await waitingOnYou()
    expect(whole.host.querySelector('[data-cy="persons-queue-stopped-short"]')).toBeNull()
  })

  it('the corner copy draws the same row whole', async () => {
    supply(walkOf([QUINN]))
    await page.viewport(900, 700)
    const m = mount(PersonsQueue as never, { floating: true }, { width: 260, height: 680 })
    await drawnReady()
    for (const cy of ['who', 'says', 'look', 'hand-back']) {
      assertDrawn(m.q(`persons-queue-stopped-${cy}-work_641`), `the corner's ${cy}`)
    }
  })
})

const REFUSED = 'Not taken back: it is no longer stopped.'

/** A hand-back whose answer the test gives when it chooses. */
function heldAnswer(): { door: () => Promise<string>; answer: (said: string) => void } {
  let answer: (said: string) => void = () => {}
  const pending = new Promise<string>((done) => (answer = done))
  return { door: () => pending, answer }
}

const settle = async (): Promise<void> => {
  await nextTick()
  await nextTick()
  await drawnReady()
}

describe('a hand-back’s answer is kept apart from what the list holds', () => {
  it('a refresh that drops the row after a refusal keeps the refusal, until it is dismissed', async () => {
    const held = heldAnswer()
    supply(walkOf([QUINN]), held.door)
    const m = await waitingOnYou()
    m.q('persons-queue-stopped-hand-back-work_641').click()
    held.answer(REFUSED)
    await settle()
    expect(read(m.q('persons-queue-stopped-said-work_641'))).toBe(REFUSED)

    // The helper resumed, so the next look no longer lists the piece.
    supply(walkOf([]), held.door)
    await settle()
    const said = m.q('persons-queue-stopped-said-work_641')
    expect(read(said)).toBe(REFUSED)
    assertDrawn(said, 'the refusal after the row left the list')
    expect(m.host.querySelector('[data-cy="persons-queue-stopped-hand-back-work_641"]')).toBeNull()
    expect(m.host.querySelector('[data-cy="persons-queue-stopped-says-work_641"]')).toBeNull()

    m.q('persons-queue-stopped-dismiss-work_641').click()
    await settle()
    expect(m.host.querySelector('[data-cy="persons-queue-stopped-work_641"]')).toBeNull()
  })

  it('a refresh while the hand-back is on its way keeps the card, then says the answer', async () => {
    const held = heldAnswer()
    supply(walkOf([QUINN]), held.door)
    const m = await waitingOnYou()
    m.q('persons-queue-stopped-hand-back-work_641').click()
    await nextTick()

    supply(walkOf([]), held.door)
    await settle()
    const press = m.q('persons-queue-stopped-hand-back-work_641') as HTMLButtonElement
    expect(press.disabled).toBe(true)
    expect(m.host.querySelector('[data-cy="persons-queue-stopped-dismiss-work_641"]')).toBeNull()

    held.answer(REFUSED)
    await settle()
    expect(read(m.q('persons-queue-stopped-said-work_641'))).toBe(REFUSED)
    expect(visible(m.q('persons-queue-stopped-dismiss-work_641'))).toBe(true)
  })

  it('the control: while the look still lists the piece, its answer stays on the listed row', async () => {
    const held = heldAnswer()
    supply(walkOf([QUINN]), held.door)
    const m = await waitingOnYou()
    m.q('persons-queue-stopped-hand-back-work_641').click()
    held.answer(REFUSED)
    await settle()
    supply(walkOf([QUINN]), held.door)
    await settle()
    expect(m.all('persons-queue-stopped-work_641')).toHaveLength(1)
    expect(read(m.q('persons-queue-stopped-said-work_641'))).toBe(REFUSED)
    expect(visible(m.q('persons-queue-stopped-hand-back-work_641'))).toBe(true)
    expect(m.host.querySelector('[data-cy="persons-queue-stopped-dismiss-work_641"]')).toBeNull()
  })
})

describe('a late answer lands only for its own press', () => {
  it('an answer that arrives after the queue was forgotten revives no card', async () => {
    const held = heldAnswer()
    supply(walkOf([QUINN]), held.door)
    const m = await waitingOnYou()
    m.q('persons-queue-stopped-hand-back-work_641').click()
    await nextTick()

    usePersonsQueue().forget()
    supply(walkOf([]), held.door)
    held.answer(REFUSED)
    await settle()
    expect(m.host.querySelector('[data-cy="persons-queue-stopped-work_641"]')).toBeNull()
  })

  it('an older press’s answer neither speaks for nor clears a newer press on the same stop', async () => {
    const older = heldAnswer()
    supply(walkOf([QUINN]), older.door)
    const m = await waitingOnYou()
    m.q('persons-queue-stopped-hand-back-work_641').click()
    await nextTick()

    usePersonsQueue().forget()
    const newer = heldAnswer()
    supply(walkOf([QUINN]), newer.door)
    await settle()
    const press = m.q('persons-queue-stopped-hand-back-work_641') as HTMLButtonElement
    press.click()
    await nextTick()

    older.answer('Taken back.')
    await settle()
    expect(press.disabled).toBe(true)
    expect(m.host.querySelector('[data-cy="persons-queue-stopped-said-work_641"]')).toBeNull()

    newer.answer(REFUSED)
    await settle()
    expect(read(m.q('persons-queue-stopped-said-work_641'))).toBe(REFUSED)
    expect(press.disabled).toBe(false)
  })
})

describe('one stop read by both the untold and the told look is drawn once', () => {
  const stall = (stalledAt: number | null): LedgerWalk<StalledWork> =>
    ({
      rows: [
        {
          piece: 'work_641',
          label: 'W6.4.1',
          title: 'Draw the world clock page.',
          owner: 'sess_quinn',
          ownerName: 'Quinn',
          giver: 'sess_ada',
          giverName: 'Ada',
          because: 'turn_ended',
          stalledAt,
        } as StalledWork,
      ],
      walk: 'every-conversation-that-routed',
      ledgers: 1,
      rowsUnread: 0,
    }) as LedgerWalk<StalledWork>

  const stallRows = (m: { host: HTMLElement }): number =>
    m.host.querySelectorAll('[data-cy="persons-queue-stall"]').length

  it('the same stop, its giver told between the two reads, is drawn as told', async () => {
    supply(walkOf([QUINN]), undefined, true, stall(AT))
    const m = await waitingOnYou()
    expect(stallRows(m)).toBe(0)
    expect(m.all('persons-queue-stopped-work_641')).toHaveLength(1)
  })

  it('a newer stall of the piece than the told stop is drawn as the stall alone', async () => {
    supply(walkOf([QUINN]), undefined, true, stall(AT + 60_000))
    const m = await waitingOnYou()
    expect(stallRows(m)).toBe(1)
    expect(m.host.querySelector('[data-cy="persons-queue-stopped-work_641"]')).toBeNull()
  })

  it('the control: each read alone draws its own band', async () => {
    supply(walkOf([]), undefined, true, stall(AT))
    const untold = await waitingOnYou()
    expect(stallRows(untold)).toBe(1)
    unmountAll()
    supply(walkOf([QUINN]), undefined, true, { ...stall(AT), rows: [] })
    const told = await waitingOnYou()
    expect(stallRows(told)).toBe(0)
    expect(told.all('persons-queue-stopped-work_641')).toHaveLength(1)
  })
})
