import { describe, expect, it } from 'vitest'
import { agoWords } from '../src/renderer/src/lib/clock'
import { teamRoster, type TeamRosterInput } from '../src/renderer/src/lib/team-roster'
import type { WhatIsBeingDone } from '../src/shared/what-is-being-done'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import type { AgentIdentities } from '../src/shared/runtime-ipc'

/**
 * ⛔ **504 M20 · the Team page says how old its reading is.**
 *
 * The Team page polls each agent’s state every half minute. `TeamRosterView.asOf` states the
 * reading’s age, distinguishing it from realtime state. `TeamWorkspace.vue` draws `team-asof`
 * under `v-if="view.asOf"`; returning null for a retained reading would silently remove that
 * qualification.
 *
 * ⚑ **Every reading here is a COMPLETE and EMPTY one at a moment far from the wall clock**, and the
 * live instant is an argument (`TeamRosterInput.now`), so the assertions are about the fold and not
 * about the machine it ran on. ⛔ **Each negative is paired with the positive that proves the
 * fixture can say the sentence at all** (`a-positive-assertion-must-differ-from-the-default`).
 */

const AT = 1_700_000_000_000

const source: AgentIdentities = {
  identities: [
    {
      id: 'aid:ada',
      slug: 'ada',
      displayName: 'Ada',
      createdAt: AT - 86_400_000,
      createdBy: null,
      capabilities: DEFAULT_CAPABILITIES,
      chosen: {} as AgentIdentities['identities'][number]['chosen'],
      provider: null,
      externalMcpServerIds: [],
    },
  ],
  foldersWithoutARow: [],
  use: [
    {
      slug: 'ada',
      conversations: 0,
      thisAppMintsIt: false,
      isLaunching: false,
      isStarting: false,
      runsOn: { provider: null, from: 'nothing-yet' },
    },
  ],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
}

const readAt = (at: number): WhatIsBeingDone => ({ readAt: at, conversations: [] })

const team = (over: Partial<TeamRosterInput> = {}): TeamRosterInput => ({
  source,
  query: '',
  filter: 'all',
  beingDone: readAt(AT),
  now: AT,
  ...over,
})

const asOf = (over: Partial<TeamRosterInput> = {}): string | null => {
  const view = teamRoster(team(over))
  expect(view, 'the fold answered nothing at all').not.toBeNull()
  return view!.asOf
}

describe('⛔ the Team page says how old the reading behind its plates is', () => {
  it('a reading a minute and a half old is named as one, in the words the rest of the app uses', () => {
    const said = asOf({ beingDone: readAt(AT - 90_000), now: AT })
    // The control: the fixture CAN say the sentence — a null here is the plant, not a quiet page.
    expect(said, 'a reading is held and the page says nothing about its age').not.toBeNull()
    expect(said).toBe(agoWords(AT - 90_000, AT))
    expect(said).toBe('2m ago')
  })

  it('a younger reading is a different sentence, so the age is read off THIS reading', () => {
    expect(asOf({ beingDone: readAt(AT - 45_000), now: AT })).toBe('45s ago')
    expect(asOf({ beingDone: readAt(AT - 45_000), now: AT })).not.toBe(
      asOf({ beingDone: readAt(AT - 90_000), now: AT }),
    )
  })

  it('the same reading grows older as the live instant moves, which is the clock that keeps it honest', () => {
    const reading = readAt(AT)
    const before = asOf({ beingDone: reading, now: AT })
    const later = asOf({ beingDone: reading, now: AT + 3 * 60_000 })
    expect(before).toBe('0s ago')
    expect(later, 'the age did not follow the live instant').toBe('3m ago')
    expect(later).not.toBe(before)
  })

  it('and while nothing has been read the page claims no age at all', () => {
    // ⚑ The other half of the pair: `null` is right when — and only when — there is no reading.
    expect(asOf({ beingDone: null })).toBeNull()
    expect(asOf({ beingDone: readAt(AT - 90_000) })).not.toBeNull()
  })
})
