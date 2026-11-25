import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { owedHere } from '../src/renderer/src/lib/owed-here'
import type { PersonsQueue } from '../src/renderer/src/lib/persons-queue'

/**
 * The sidebar's Waiting on you badge and the page it opens count what a person owes with one
 * function, so the two numbers cannot drift apart.
 */

const rows = (n: number) => ({ rows: Array.from({ length: n }, (_, i) => ({ key: `r${i}` })) })

function queue(): PersonsQueue {
  return {
    view: ref({ count: 1, ...rows(1) }),
    asks: ref(rows(2)),
    serverRequests: ref(rows(3)),
    waitingOnWhoWrote: ref(rows(4)),
    workWaits: ref({ todos: rows(5), incidents: rows(6), recoveries: rows(7) }),
  } as unknown as PersonsQueue
}

const notChosen = {
  use: [{ slug: 'ada', runsOn: { from: 'its-conversations-differ', startedOn: [] } }],
} as never

describe('what a person owes outside this window', () => {
  it('counts every population once, and the agents whose provider they must choose', () => {
    expect(owedHere(queue(), notChosen)).toBe(1 + 2 + 3 + 4 + 5 + 6 + 1)
  })

  it('counts nothing for a queue that has not been read', () => {
    const empty = {
      view: ref(null),
      asks: ref(null),
      serverRequests: ref(null),
      waitingOnWhoWrote: ref(null),
      workWaits: ref({ todos: rows(0), incidents: rows(0), recoveries: rows(0) }),
    } as unknown as PersonsQueue
    expect(owedHere(empty, null)).toBe(0)
  })

  it('passes the same queue summary to the Waiting on you page and rail', () => {
    const screen = readFileSync(
      new URL('../src/renderer/src/components/RuntimeScreen.vue', import.meta.url),
      'utf8',
    )
    const attention = readFileSync(
      new URL('../src/renderer/src/composables/useRuntimeAttention.ts', import.meta.url),
      'utf8',
    )
    expect(attention).toMatch(/onlyYou:\s*owedHere\(persons, /)
    expect(screen).toContain(':needs-you="homeNeedsYou.total"')
    expect(screen).toContain(':attention="homeNeedsYou"')
  })
})
