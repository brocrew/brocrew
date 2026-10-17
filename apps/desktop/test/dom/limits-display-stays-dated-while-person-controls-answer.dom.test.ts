import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import {
  limitsDisplayLane,
  type LimitsDisplayState,
} from '../../src/renderer/src/lib/limits-display'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import type { LimitsDisplayAnswer } from '../../src/shared/limits-display'
import type { InstructionAskWaiting } from '../../src/shared/own-instructions'
import { readProviderLimit } from '../../src/shared/provider-limit'
import { mount, unmountAll, visible } from './harness'

const NOW = Date.UTC(2026, 9, 8, 22)
const queue = usePersonsQueue()
const ask: InstructionAskWaiting = {
  asked: {
    type: 'instruction_proposed',
    askId: 'fictional-ask',
    ask: 'propose',
    about: 'fictional-worker',
    proposedBy: 'fictional-manager',
    text: 'Keep a report with completed work.',
    why: 'The next conversation needs the result.',
  },
  conversation: 'fictional-conversation',
  at: NOW,
}

afterEach(() => {
  unmountAll()
  queue.forget()
})

function answer(operation = 1): LimitsDisplayAnswer {
  const wall = readProviderLimit('claude is rate-limited (five_hour)', NOW)
  if (wall === null) throw new Error('fictional limit not recognized')
  return {
    is: 'read',
    reading: {
      operation,
      databaseEpoch: 1,
      signInEpoch: 1,
      pinStartedAt: NOW,
      pinFinishedAt: NOW + 1,
      evaluatedAt: NOW + 2,
      usageAt: NOW - 10,
      finishedAt: NOW + 3,
      walked: {
        walk: 'every-provider-wall-recently-recorded',
        rows: [wall],
        ledgers: 1,
        rowsUnread: 0,
      },
    },
  }
}

function fixture() {
  const approved: Array<[string, boolean]> = []
  const supply = (display: LimitsDisplayState) => {
    queue.supply(
      { walk: 'every-conversation-that-routed', rows: [], ledgers: 1, rowsUnread: 0 },
      { walk: 'every-conversation-that-routed', rows: [], ledgers: 1, rowsUnread: 0 },
      {
        held: new Set(),
        answerable: new Map(),
        now: NOW,
        lastLookAnswered: { questions: true, decisions: true },
        answeredFromHere: new Set(),
      },
      {
        travel: () => {},
        settle: () => {},
        takeOver: () => {},
        open: () => {},
        decideInstruction: (id, yes) => approved.push([id, yes]),
      },
      {
        walked: display.reading?.walked ?? null,
        lastLookAnswered: display.status === 'ready',
        display,
      },
      undefined,
      { walked: [ask], lastLookAnswered: true, nameOf: (slug) => slug },
    )
  }
  const lane = limitsDisplayLane(supply)
  return { lane, approved }
}

async function frames(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise<void>((done) => requestAnimationFrame(() => done()))
  await nextTick()
}

describe('dated limits on the real Waiting on you surface', () => {
  it('keeps drawing and approving a real rule ask while its independent limits reply is pending', async () => {
    const { lane, approved } = fixture()
    await lane.refresh(async () => answer())
    const page = mount(WaitingOnYou, { clock: NOW + 60_000 })
    await nextTick()
    const original = page.q('persons-queue-wall-says-claude').textContent
    expect(original).toMatch(/^\s*As of /)
    let finish!: (answer: LimitsDisplayAnswer | null) => void
    const pending = lane.refresh(
      () =>
        new Promise((done) => {
          finish = done
        }),
    )
    try {
      await nextTick()
      expect(page.q('limits-display-reading').textContent).toContain('Updating limits…')
      expect(page.q('limits-display-reading').textContent).toContain('Last reading:')
      expect(page.q('persons-queue-wall-says-claude').textContent).toBe(original)
      const approve = page.q('waiting-ask-approve-fictional-ask')
      expect(visible(approve)).toBe(true)
      const box = approve.getBoundingClientRect()
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      expect(hit !== null && approve.contains(hit)).toBe(true)
      approve.click()
      expect(approved).toEqual([['fictional-ask', true]])
      await frames(6)
      expect(page.q('limits-display-reading').textContent).toContain('Updating limits…')
    } finally {
      finish(null)
      await pending
      lane.close()
    }
    await nextTick()
    expect(page.q('limits-display-reading').textContent).toContain('Limits unavailable')
    expect(page.q('persons-queue-wall-says-claude').textContent).toBe(original)
  })

  it('a sign-in notice drops historical warnings without asserting that the new account is clear', async () => {
    const { lane } = fixture()
    await lane.refresh(async () => answer())
    const page = mount(WaitingOnYou, { clock: NOW })
    await nextTick()
    expect(page.all('persons-queue-wall-claude')).toHaveLength(1)
    lane.changed({ why: 'scope', databaseEpoch: 1, signInEpoch: 2 })
    await nextTick()
    expect(page.all('persons-queue-wall-claude')).toHaveLength(0)
    expect(page.q('limits-display-reading').textContent).toContain('Limits unavailable')
    expect(page.q('limits-display-reading').textContent).not.toContain('No limits reported')
    lane.close()
  })

  it('an empty complete reading is dated, while an empty coverage hole remains unavailable', async () => {
    const { lane } = fixture()
    const read = answer()
    if (read.is !== 'read') throw new Error('fictional reading missing')
    const empty = {
      ...read,
      reading: { ...read.reading, walked: { ...read.reading.walked, rows: [], ledgers: 0 } },
    }
    await lane.refresh(async () => empty)
    const page = mount(WaitingOnYou, { clock: NOW })
    await nextTick()
    expect(page.q('limits-display-reading').textContent).toContain('No limits reported as of')
    await lane.refresh(async () => ({
      ...empty,
      reading: { ...empty.reading, walked: { ...empty.reading.walked, rowsUnread: 1 } },
    }))
    await nextTick()
    expect(page.q('limits-display-reading').textContent).toContain('Limits unavailable')
    expect(page.q('limits-display-reading').textContent).not.toContain('No limits reported')
    lane.close()
  })
})
