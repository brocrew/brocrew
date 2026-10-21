// The approved plain words replace the former labels; the state and gesture checks remain.
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import { useSpawnSafety } from '../../src/renderer/src/lib/spawn-safety'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { AgentIdentities, AgentIdentity } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, type Mounted } from './harness'
import { assertDrawn, lineCount } from './drawn'

/**
 * 🔴 **355 · the kill switch, where §1 asked for it: reachable fast.**
 *
 * ⛔ **In the rail rather than inside a sheet, and the asymmetry is the design.** Switching spawning
 * OFF is one press; switching it back ON asks once. `340`'s ruling — *a widening must be opt-in at
 * the call site* — applied to a gesture: the direction that STOPS agents creating conversations must
 * never be the slower of the two, because a kill switch you have to confirm is one you confirm after
 * the thing you were trying to stop.
 *
 * ⚠️ **In the DOM project because the claim is about presses.** An SSR assertion could see the
 * markup of a button and nothing about what two clicks in a row do.
 *
 * ## ⚠️ 390 · the switch is SUPPLIED now, and this file drives the supply
 *
 * ⛔ **It was `props.agents` and an `onSetSpawning` handler until `390`.** The stop is drawn on two
 * layers now — here, and in `OverlayHost`'s safety lane, because every overlay covers this rail —
 * so the state and the confirm live in `lib/spawn-safety.ts` and `RuntimeScreen` supplies them.
 * ⚑ **Every assertion below is the one `355` wrote**; what changed is that the fixture hands the
 * state to the module the rail actually reads, which is what the screen does.
 */

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
  capabilities: { ...DEFAULT_CAPABILITIES },
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
})

const agents = (over: Partial<AgentIdentities> = {}): AgentIdentities => ({
  identities: [identity('pm'), identity('worker')],
  foldersWithoutARow: [],
  use: [],
  spawningEnabled: true,
  // 500 · required on `AgentIdentities`; none of these fixtures is about the launch default.
  defaultApprovalMode: 'ask',
  // ⚑ **516** — the global registry, carried on the same read; empty is a real answer.
  externalMcpServers: [],
  ...over,
})

const safety = useSpawnSafety()

/**
 * ⚠️ **One object, handed to the module AND to the rail's identities section.** They are two
 * readers of one read in the app too — `RuntimeScreen` supplies the switch and passes `:agents`
 * from the same `agentStore.identities.value` — so a fixture that let them differ would be testing
 * a state the product cannot reach.
 */
async function rail(
  props: Record<string, unknown> = {},
): Promise<{ m: Mounted; spawning: boolean[]; opened: string[] }> {
  const spawning: boolean[] = []
  const opened: string[] = []
  const identities = ('agents' in props ? props.agents : agents()) as AgentIdentities | null
  safety.supply(identities, (enabled) => spawning.push(enabled))
  const m = mount(
    SideRail,
    {
      open: [],
      activeId: null,
      place: null,
      agents: agents(),
      onOpenAgentCapabilities: (slug: string) => opened.push(slug),
      ...props,
    },
    { width: 240, height: 900 },
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  return { m, spawning, opened }
}

/**
 * 🔴 **570 · the roster this file used to read off the rail is a PAGE now.**
 *
 * ⛔ **`EXT-008` §4.4 took the AGENTS section out of the navigation column** — *"the rail says zero
 * and then names three agents… the Agents page is where it gets explained, not the rail"* — so the
 * three assertions below about identities, orphan folders and the two empty states mount
 * `TeamWorkspace`. ⚑ **The kill switch is untouched and is not in this helper**: `EXT-008` §5
 * keeps it in the rail by name, it lives in `.rail-bottom` rather than in the evicted block, and
 * every assertion about it above still mounts `SideRail`.
 */
async function page(
  identities: AgentIdentities | null = agents(),
): Promise<{ m: Mounted; opened: string[] }> {
  const opened: string[] = []
  const m = mount(
    TeamWorkspace,
    {
      agents: identities,
      onOpen: (slug: string) => opened.push(slug),
      store: {
        renameTo: () => {
          throw new Error('this file presses no write door')
        },
        remove: () => {
          throw new Error('this file presses no write door')
        },
      },
    },
    { width: 1100, height: 900 },
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  return { m, opened }
}

afterEach(() => {
  unmountAll()
  // ⛔ **The module is the window's one stop and it outlives a mount.** Left supplied, the next
  // file's rail would draw a switch nobody in it had answered for.
  safety.forget()
})

describe('355 · the spawning switch in the rail', () => {
  it('🔴 one press switches it off', async () => {
    const { m, spawning } = await rail()
    expect(m.q('rail-spawning-state').textContent).toContain('Agents can start new conversations')
    m.q('rail-spawning').click()
    await nextTick()
    expect(spawning).toEqual([false])
  })

  /**
   * ⛔ **The pair, and it is what makes the test above a measurement.** The same button, one press,
   * in the other direction: nothing is emitted, and the row says what the second press would do.
   */
  it('🔴 the first press to switch it back ON emits nothing, and the second one does', async () => {
    const { m, spawning } = await rail({ agents: agents({ spawningEnabled: false }) })
    expect(m.q('rail-spawning-state').textContent).toContain(
      'Agents cannot start new conversations',
    )

    m.q('rail-spawning').click()
    await nextTick()
    expect(spawning, 'a single press widened what agents may do').toEqual([])
    expect(m.q('rail-spawning-state').textContent).toContain(
      'Allow agents to start new conversations?',
    )

    m.q('rail-spawning').click()
    await nextTick()
    expect(spawning).toEqual([true])
  })

  /**
   * ⛔ **A confirm left armed across a change made from somewhere else is one press from a
   * widening** — and nothing in this file could see it until this test existed. The first version
   * never changed the prop after mounting, so the watch that disarms it never ran either way, and
   * the row that keyed that watch on the wrong fact survived.
   */
  it('🔴 the armed confirm is disarmed when the switch changes from elsewhere', async () => {
    const { m, spawning } = await rail({ agents: agents({ spawningEnabled: false }) })

    m.q('rail-spawning').click()
    await nextTick()
    expect(m.q('rail-spawning-state').textContent).toContain(
      'Allow agents to start new conversations?',
    )

    // Somebody else threw the switch — another window, or a save this rail did not make. ⚠️ **The
    // supply is how it arrives**, which is `RuntimeScreen`'s `watchEffect` on the store: a fixture
    // that reached into the module's state instead would be measuring a path nothing walks.
    safety.supply(agents({ spawningEnabled: true }), (enabled) => spawning.push(enabled))
    await nextTick()
    expect(m.q('rail-spawning-state').textContent).toContain('Agents can start new conversations')

    // ⛔ …and the press that lands on the armed state must now be the OFF one, not a confirmed ON.
    m.q('rail-spawning').click()
    await nextTick()
    expect(spawning).toEqual([false])
  })

  /**
   * ⚑ **The pair for the disarm, and it is the state the old prop-watch could not tell apart.**
   * A re-read that leaves the switch alone — a new identity appearing, which `355` fires on every
   * conversation start — must NOT throw away a confirm a person has just armed. The supply compares
   * the switch rather than the object for exactly this.
   */
  it('⚠️ …but a re-read that leaves the switch alone keeps the confirm armed', async () => {
    const { m, spawning } = await rail({ agents: agents({ spawningEnabled: false }) })

    m.q('rail-spawning').click()
    await nextTick()
    expect(m.q('rail-spawning-state').textContent).toContain(
      'Allow agents to start new conversations?',
    )

    safety.supply(agents({ spawningEnabled: false, foldersWithoutARow: ['half-typed'] }), (e) =>
      spawning.push(e),
    )
    await nextTick()
    expect(m.q('rail-spawning-state').textContent).toContain(
      'Allow agents to start new conversations?',
    )

    // ⛔ …so the press that follows is the confirmed ON, not a first press thrown away.
    m.q('rail-spawning').click()
    await nextTick()
    expect(spawning).toEqual([true])
  })

  /** ⚠️ …and the row is honest about what the switch does NOT do. */
  it('⚠️ says what stopped, and that nothing running was stopped', async () => {
    const { m } = await rail({ agents: agents({ spawningEnabled: false }) })
    expect(m.q('rail-spawning-line').textContent).toContain(
      'Current work can continue. Click to allow new conversations.',
    )
  })

  it('⚑ an identity row opens its own sheet', async () => {
    const { m, opened } = await page()
    // ⚠️ **570 · the DOOR moved with the row and it is the same door.** The rail's agent row was
    // the only opener of the capability sheet in the whole renderer; `RuntimeScreen` listens to
    // this page's `open` now and raises exactly the overlay the rail used to raise.
    m.q('team-open-pm').click()
    await nextTick()
    expect(opened).toEqual(['pm'])
  })

  /** ⛔ §4's trap, on the surface a person actually meets it on. */
  it('⛔ names a folder with no identity, without offering it as one', async () => {
    const { m } = await page(agents({ foldersWithoutARow: ['half-typed'] }))
    expect(m.q('team-other-home-folders').textContent).toContain('half-typed')
    expect(m.all('team-card-half-typed')).toHaveLength(0)
    // ⚑ The pair: an identity that DOES have a row is a row you can press.
    expect(m.all('team-card-pm')).toHaveLength(1)
    // ⚠️ **570 · and the page says what to DO about it**, which the rail's version also did —
    // `EXT-008` §2 listed that sentence as prose in navigation and §3 said where it belongs.
    expect(m.q('team-other-home-folders-says').textContent?.replace(/\s+/g, ' ')).toContain(
      'Create one with the same name to give it its row',
    )
  })

  /**
   * ⛔ **This section is wired, so it must not sit under a *"soon"* mark** (009, and the rail's own
   * rule since 339). A working control dressed as a placeholder teaches a person not to trust the
   * ones that work.
   */
  it('⛔ is not marked "soon"', async () => {
    const { m } = await rail()
    // ⚠️ **570 · the mark is on the DESTINATION now**, because the section it used to be on is
    // gone. ⛔ The claim is unchanged and is the reason it must move rather than be deleted: the
    // Team row opens a page that reads and writes real `agent_profile` rows, and a working
    // control dressed as a placeholder teaches a person not to trust the ones that work.
    expect(m.q('rail-team').getAttribute('data-wired')).toBe('true')
    expect(m.q('rail-team').closest('[data-wired="false"]')).toBe(null)
    // ⚠️ **572 · the control used to be a PAIR, then one row** (`rail-closed-projects`, then
    // `rail-home`, the last placeholder over the demo seed). ⚑ **D-016 deleted Home and the seed**,
    // so this rail draws no not-wired row at all and there is no control left to point at: the
    // claim rests on the `data-wired="true"` positive above, which a mark taken off would fail.
  })

  /** ⚠️ Before the read lands there is no section at all, rather than an empty or a wrong one. */
  /**
   * ⚠️ **Not even the header.** *"Agents 0"* before the read lands is 086's mistake on a count: *not
   * asked* and *asked and empty* are two facts, and one of them is a claim this rail has not made.
   */
  it('⚠️ draws nothing at all until the identities have arrived', async () => {
    // ⛔ **The rail half is unchanged and is still the rail's**: with no answer the switch is not
    // drawn either, which is the same `086` rule on the control `EXT-008` §5 keeps here.
    const { m: bare } = await rail({ agents: null })
    expect(bare.all('rail-spawning')).toHaveLength(0)
    // ⛔ **`expect(bare.all('rail-agents')).toHaveLength(0)` was here and is DELETED, not moved.**
    // ⚠️ The hook is gone from the component in every state, so the line could not fail again in
    // any world — a negative with nothing to find (`brobot2-ssr-tests-pass-vacuously`, in the
    // DOM). ⚑ The source-level absence it was standing in for is pinned refutably by
    // `the-screen-nothing-reaches.test.ts` §1 and §3, which read the rail's own bytes.

    // 🔴 **570 · and the roster's two arms are the PAGE's now.** `086`: *not asked* and *asked and
    // empty* are two facts. ⛔ Before the read lands the page says it is reading and draws no
    // count; with an empty answer it draws the count `0` and the sentence the rail's section used
    // to carry — **which had no destination until this page had one** (`561` §5.4: *an eviction
    // with no destination is a deletion*).
    const { m } = await page(null)
    expect(m.q('team-loading').textContent).toContain('Reading identities')
    expect(m.all('team-count')).toHaveLength(0)
    expect(m.all('team-none')).toHaveLength(0)

    const { m: empty } = await page({
      identities: [],
      foldersWithoutARow: [],
      use: [],
      spawningEnabled: true,
      // ⚑ **516** — an ANSWER carries the registry too, and an empty one is a real answer.
      externalMcpServers: [],
      defaultApprovalMode: 'ask',
    })
    expect(empty.all('team-loading')).toHaveLength(0)
    expect(empty.q('team-count').textContent).toBe('0')
    expect(empty.q('team-none').textContent).toContain('No agent identities yet')
  })
})

it.each([251.68, 266.2])(
  'keeps the wrapped heading and workspace visible at %spx',
  async (width) => {
    const { m } = await rail({ agents: agents({ spawningEnabled: false }) })
    m.host.style.width = `${width}px`
    await nextTick()
    for (const confirming of [false, true]) {
      if (confirming) {
        m.q('rail-spawning').click()
        await nextTick()
      }
      const heading = m.q('rail-spawning-state')
      assertDrawn(heading, 'new conversation heading', m.host)
      expect(lineCount(heading)).toBeLessThanOrEqual(2)
      const control = m.q('rail-spawning').getBoundingClientRect()
      const workspace = m.q('rail-workspace')
      assertDrawn(workspace, 'workspace below the control', m.host)
      const footer = workspace.getBoundingClientRect()
      expect(footer.top).toBeGreaterThanOrEqual(control.bottom)
      expect(footer.bottom).toBeLessThanOrEqual(m.host.getBoundingClientRect().bottom)
    }
  },
)
