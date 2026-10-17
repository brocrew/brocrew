import { describe, expect, it } from 'vitest'
import { createPlaceHistory, PLACES_KEPT, type Place } from '../src/renderer/src/lib/place-history'

/**
 * The places a window showed, for Back and Forward: a new place is a step, the same place again
 * only updates its tab, a new step clears Forward, the oldest go past a cap, and a place deleted
 * meanwhile is gone past and named.
 */

const screen = (name: string): Place => ({
  key: `screen:${name}`,
  name,
  conversation: null,
  identity: null,
  tab: null,
})
const conversation = (id: string, tab = 'conversation'): Place => ({
  key: `conversation:${id}`,
  name: id,
  conversation: id,
  identity: null,
  tab,
})
const at = (y: number) => () => y

describe('a window’s places', () => {
  it('a new place is a step; Back and Forward walk them; the ends say there is nowhere', () => {
    const h = createPlaceHistory()
    h.arrive(screen('waiting'), at(0))
    h.arrive(screen('team'), at(0))
    h.arrive(screen('tools'), at(0))
    expect(h.next(-1)?.place.name).toBe('team')
    expect(h.next(1)).toBeUndefined()
    expect(h.go(-1, at(0)).reached?.place.name).toBe('team')
    expect(h.go(-1, at(0)).reached?.place.name).toBe('waiting')
    expect(h.next(-1)).toBeUndefined()
    expect(h.go(1, at(0)).reached?.place.name).toBe('team')
  })

  it('the same place again only updates its tab, recording no step', () => {
    const h = createPlaceHistory()
    h.arrive(screen('waiting'), at(0))
    h.arrive(conversation('c1'), at(0))
    h.arrive(conversation('c1', 'graph'), at(0))
    expect(h.entries).toHaveLength(2)
    expect(h.current()?.place.tab).toBe('graph')
  })

  it('a new place after Back clears what Forward would return to', () => {
    const h = createPlaceHistory()
    h.arrive(screen('waiting'), at(0))
    h.arrive(screen('team'), at(0))
    h.go(-1, at(0))
    expect(h.next(1)?.place.name).toBe('team')
    h.arrive(screen('tools'), at(0))
    expect(h.next(1)).toBeUndefined()
    expect(h.entries.map((one) => one.place.name)).toEqual(['waiting', 'tools'])
  })

  it(`keeps the last ${String(PLACES_KEPT)} places`, () => {
    const h = createPlaceHistory()
    for (let i = 0; i < PLACES_KEPT + 5; i++) h.arrive(screen(`s${String(i)}`), at(0))
    expect(h.entries).toHaveLength(PLACES_KEPT)
    expect(h.entries[0]!.place.name).toBe('s5')
  })

  it('keeps where a page was scrolled to when it is left, and hands it back on the way back', () => {
    const h = createPlaceHistory()
    h.arrive(screen('waiting'), at(0))
    h.arrive(screen('team'), at(340))
    expect(h.go(-1, at(80)).reached?.scroll).toBe(340)
    expect(h.go(1, at(0)).reached?.scroll).toBe(80)
  })

  it('goes past a place deleted meanwhile, both ways, and names it', () => {
    const h = createPlaceHistory()
    h.arrive(screen('waiting'), at(0))
    h.arrive(conversation('c1'), at(0))
    h.arrive(screen('team'), at(0))
    h.markGone(['c1'])
    expect(h.next(-1)?.place.name).toBe('waiting')
    const back = h.go(-1, at(0))
    expect(back.reached?.place.name).toBe('waiting')
    expect(back.passed.map((one) => one.place.name)).toEqual(['c1'])
    expect(h.entries.map((one) => one.place.name)).toEqual(['waiting', 'team'])
    expect(h.go(1, at(0)).reached?.place.name).toBe('team')
  })

  it('a conversation archived meanwhile is kept, as its read-only history', () => {
    const h = createPlaceHistory()
    h.arrive(conversation('c1', 'graph'), at(0))
    h.arrive(screen('team'), at(0))
    h.markArchived(['c1'], (id) => `archive:${id}`)
    expect(h.next(-1)?.place.key).toBe('archive:c1')
    expect(h.next(-1)?.place.tab).toBeNull()
  })
})
