import { afterEach, describe, expect, it } from 'vitest'
import TaskList from '../../src/renderer/src/components/TaskList.vue'
import IconSprite from '../../src/renderer/src/components/IconSprite.vue'
import { workReading } from '../../src/renderer/src/lib/work-report'
import type { CastTask } from '../../src/renderer/src/lib/working-together'
import { standingOf, STANDING_LABEL } from '../../src/renderer/src/lib/agent-state'
import { CONVERSATION_WAITS, WAITING_STANDS_FOR, type TaskState } from '../../src/shared/tasks'
import { mount, unmountAll } from './harness'

/**
 * # 🔴 F083 · a piece whose agent replied asks nothing of you
 *
 * A piece a person gave enters `waiting-on-the-person-who-asked` whenever its owner's turn ends with
 * it open — an answer to anyone, or a note, ends a turn. It names nobody who must move. The right
 * panel read it as *"waiting on you"* while the rail said *"Nothing needs you"*. ⚑ It reads
 * *replied* now, with the ledger's cause sentence under it; a real ask keeps its own words.
 */

afterEach(unmountAll)

const task = (state: TaskState): CastTask =>
  ({
    piece: {
      piece: 'work_1',
      reading: workReading({ label: 'W2.5', state } as never),
      open: true,
      state,
      said: 'get the launch page ready',
      given: 0,
    },
    facets: null,
    toName: 'you',
  }) as unknown as CastTask

const panel = (state: TaskState) => {
  mount(IconSprite, {}, { width: 10, height: 1 })
  return mount(TaskList, { tasks: [task(state)], canOpen: false }, { width: 360, height: 300 })
}

const text = (element: Element | null): string =>
  element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

describe('F083 · a piece whose agent replied asks nothing of you', () => {
  it('🔴 its turn ended: the panel says “replied”, with why, and never “waiting on you”', () => {
    const m = panel('waiting-on-the-person-who-asked')
    const line = m.q('cast-taken-work')
    expect(text(line)).toContain('replied')
    expect(text(m.q('cast-work-why'))).toBe(WAITING_STANDS_FOR['waiting-on-the-person-who-asked'])
    expect(m.q('cast-work-mark').getAttribute('title')).toBe('replied')
    expect(text(m.host)).not.toContain('waiting on you')
  })

  it('⚑ …and a real ask still says it waits on a person, with its own why', () => {
    const m = panel('waiting-on-a-person')
    expect(text(m.q('cast-taken-work'))).toContain('waiting on a person')
    expect(text(m.q('cast-work-why'))).toBe(WAITING_STANDS_FOR['waiting-on-a-person'])
  })

  it('⛔ a piece that is simply working draws no why', () => {
    const m = panel('working')
    expect(text(m.q('cast-taken-work'))).toContain('being worked on')
    expect(m.all('cast-work-why')).toHaveLength(0)
  })

  it('🔴 the rail and the panel agree: this state is never a conversation’s wait, so the rail cannot say it needs you', () => {
    // The panel's word for it is not a demand…
    expect(
      workReading({ label: 'W2.5', state: 'waiting-on-the-person-who-asked' } as never).word,
    ).toBe('replied')
    // …and the rail's standing is built from conversation waits only, which leave it out.
    expect(CONVERSATION_WAITS).not.toContain('waiting-on-the-person-who-asked')
    expect(STANDING_LABEL[standingOf({})]).not.toMatch(/needs you/i)
  })
})
