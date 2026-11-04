import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import { createAgentStore, type AgentStore } from '../../src/renderer/src/lib/agent-store'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { AgentIdentities, AgentIdentity, RuntimeBridge } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * 🔴 **464 · the owner and the target are two identities, and the sheet has to say which is which.**
 *
 * ⛔ **`460` asked for this test by name** (F1): *"Pin the owner and selected target independently
 * in a DOM test."* ⚠️ **And `464` §1.3 says why a careless one would measure nothing**: *"A test
 * that sets both to the same identity measures nothing — so the owner and the target must differ
 * in the fixture."* ⚑ That is `a-comparison-tested-where-both-sides-agree`, and the existing
 * capability-sheet fixture is exactly the shape it warns about: one identity, `pm`, which is both
 * the sheet's `profileSlug` and the only row in the roster.
 *
 * ## 🔴 Both orientations, because one of them is the mistake
 *
 * `460` §4: *"To allow `default` to spawn `sample-app-test-pm`, the person must open **default's**
 * sheet and add `sample-app-test-pm` to default's `canSpawn`. Opening the target's sheet instead
 * changes what that target may itself spawn later."* ⛔ **So the fixture is run BOTH WAYS** — `pm`'s
 * sheet ticking `worker`, and `worker`'s sheet ticking `pm` — and each must write onto the identity
 * whose sheet is open. A sheet that had hardcoded either side would pass one orientation and fail
 * the other; one that read the first row of the roster would pass both while being wrong.
 *
 * ⚠️ **In the DOM project because these are rendered sentences and a press.** SSR markup would show
 * the strings and could not show that ticking a box on one sheet writes onto the other identity.
 *
 * ## ⚠️ D-014 · the boxes are gone, and the sections about them went too
 *
 * ⛔ The grant picker (`canSpawn`'s ticks), its direction line, and the Team card's grant pair were
 * DELETED — no grant names another identity now. ⚑ §2 (a tick saved onto the owner) and §3 (the
 * rail's pair) had nothing left to press or read. **§1 stays**: the owner sentence still has to
 * name the identity whose sheet is open and not another one in the same roster, and the two-row
 * fixture is still what makes that a measurement.
 */

interface Answers {
  list: AgentIdentities
  saved: unknown[]
}

let answers: Answers

const identity = (slug: string): AgentIdentity => ({
  id: `agp:default:${slug}`,
  slug,
  displayName: null,
  createdAt: 1_700_000_000_000,
  // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
  createdBy: null,
  provider: null,
  // ⚑ **516** — presence IS the grant, so an empty list is *granted none*, not *not chosen*.
  externalMcpServerIds: [],
  capabilities: DEFAULT_CAPABILITIES,
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
})

/** ⛔ **Two identities, and they are never the same one** — the whole premise of this file. */
const ROSTER = (): AgentIdentities => ({
  identities: [identity('pm'), identity('worker')],
  foldersWithoutARow: [],
  use: [],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  // ⚑ **516** — the global registry, carried on the same read; empty is a real answer.
  externalMcpServers: [],
})

function storeOver(): AgentStore {
  const bridge = {
    agentIdentities: async () => answers.list,
    setCapabilities: async (input: unknown) => {
      // ⚑ Cloned the way the real bridge clones — `capabilities-sheet.dom.test.ts`' rule, and the
      // grant is two non-primitives, so a Proxy reaching here is a red rather than a silent pass.
      structuredClone(input)
      answers.saved.push(input)
      return answers.list.identities[0] ?? null
    },
    setSpawningEnabled: async () => ({ spawningEnabled: true }),
    // ⚑ **696 · the door's answer since `682`** — the identity AND what it cleared (`AgentProviderSet`).
    setAgentProvider: async () => {
      const one = answers.list.identities[0]
      return one === undefined ? null : { ...one, modelChoiceCleared: null }
    },
  } as unknown as RuntimeBridge
  return createAgentStore(bridge)
}

async function sheetFor(profileSlug: string): Promise<Mounted> {
  const store = storeOver()
  await store.load()
  const m = mount(
    CapabilitiesSheet,
    { profileSlug, runsOn: 'codex', store },
    { width: 900, height: 900 },
  )
  await nextTick()
  return m
}

const text = (m: Mounted, cy: string): string => (m.q(cy).textContent ?? '').replace(/\s+/g, ' ')

describe('464 · whose grant this is', () => {
  beforeEach(() => {
    answers = { list: ROSTER(), saved: [] }
  })
  afterEach(() => {
    unmountAll()
  })

  describe('§1 · the sheet names its owner, and nobody else in the roster', () => {
    it('🔴 the owner sentence names the identity the sheet was opened for and not the other one', async () => {
      const m = await sheetFor('pm')
      const owner = text(m, 'capabilities-owner')
      // ⛔ **Tested where the two readings DIVERGE** — with one identity in the fixture, "names the
      // owner" and "names the other row" are the same assertion and neither is measured.
      expect(owner).toContain('pm')
      expect(owner, 'the owner sentence names the other identity').not.toContain('worker')
    })

    it('⛔ …and it MOVES: the same roster, the other sheet, the other owner', async () => {
      // 🔴 **The control the assertion above needs, and it is not optional.** `pm` is the first
      // row of this roster, so a sentence that printed a constant — or the roster's head, which is
      // what a component reaching past its own prop would print — passes the test above and fails
      // this one. ⚑ Only a sentence that reads `profileSlug` passes both.
      const m = await sheetFor('worker')
      const owner = text(m, 'capabilities-owner')
      expect(owner).toContain('worker')
      // ⚠️ **And the other identity's name is nowhere in it**, which is the half that makes the
      // pair a measurement rather than two readings of the same thing.
      expect(owner).not.toContain('pm')
    })

    it('⛔ …and it is NOT drawn for a slug with no row, where it would contradict the body', async () => {
      // 🔴 **Found reviewing this dispatch's own diff.** The header is outside the body's `v-else`
      // chain, so it draws in every state — including the one where the body says *there is no
      // agent identity called this*. ⛔ A sentence reading *this is ghost's own row* directly
      // above that paragraph is a surface claiming a row the app has just refused to create, which
      // is `009`'s rule and worse than the vague sentence it replaced.
      const m = await sheetFor('ghost')
      expect(m.all('capabilities-owner')).toHaveLength(0)
      // ⚑ The pair: the state IS the no-row state, so the absence above is the branch and not a
      // mount that drew nothing at all.
      expect(text(m, 'capabilities-no-row')).toContain('ghost')
      expect(text(m, 'capabilities-title')).toContain('ghost')
    })
  })
})
