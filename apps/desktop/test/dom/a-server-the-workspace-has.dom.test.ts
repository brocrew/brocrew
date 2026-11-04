import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import ExternalMcpRegistry from '../../src/renderer/src/components/ExternalMcpRegistry.vue'
import { createAgentStore, type AgentStore } from '../../src/renderer/src/lib/agent-store'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type {
  AgentIdentities,
  AgentIdentity,
  ProviderCapabilityMap,
  RuntimeBridge,
} from '../../src/shared/runtime-ipc'
import {
  EXTERNAL_MCP_EVERYONE_MEANS,
  EXTERNAL_MCP_RESTRICTED_MEANS,
  type ExternalMcpServerReach,
  type ExternalMcpServerRow,
} from '../../src/shared/external-mcp'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * 🔴 **524 · the two surfaces `HO-048` changed, as a person meets them.**
 *
 * ## ⛔ Why the DOM project and not an SSR string
 *
 * ⚠️ **Every claim here is about a CONTROL.** *The wide answer is pre-selected* is a property of a
 * radio's `checked`, which a rendered string cannot tell from an `value="everyone"` attribute nobody
 * chose; *there is no box on this row* is the absence of an element, which
 * `brobot2-ssr-tests-pass-vacuously` is the standing warning about asserting from markup. ⛔ And the
 * one that matters most — **the default travels to the wire untouched** — only a real press answers.
 *
 * ## ⚑ What is measured
 *
 *  1. the wide answer is the one already chosen, and its disclosure is the one already drawn;
 *  2. choosing the exception swaps the sentence and reaches the wire;
 *  3. an available-to-all server appears on an identity's sheet **with no input on it at all**,
 *     beside a restricted one that has one — both in one mount, which is standing rule 3's shape;
 *  4. the sheet stops saying *None granted* about an identity that may use every server in the app.
 */

interface Answers {
  list: AgentIdentities
  registered: unknown[]
}

let answers: Answers

const server = (
  name: string,
  reach: ExternalMcpServerReach,
  port = 8765,
): ExternalMcpServerRow => ({
  id: `ems:${name}`,
  name,
  url: `http://127.0.0.1:${String(port)}/mcp`,
  registeredAt: 1_700_000_000_000,
  reach,
})

const identity = (over: Partial<AgentIdentity> = {}): AgentIdentity => ({
  id: 'aid:pm',
  slug: 'pm',
  displayName: null,
  createdAt: 1_700_000_000_000,
  // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
  createdBy: null,
  provider: null,
  externalMcpServerIds: [],
  capabilities: DEFAULT_CAPABILITIES,
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
  ...over,
})

/** ⚑ Both answers in the map, so *held back* is about one entry rather than an unread table. */
const CAPABILITIES = {
  claude: { externalMcpServers: { state: 'available' } },
  codex: {
    externalMcpServers: {
      state: 'unwired',
      reason: 'Codex asks for a tool approval without naming which call it is about.',
    },
  },
} as unknown as ProviderCapabilityMap

function storeOver(): AgentStore {
  const bridge = {
    agentIdentities: async () => answers.list,
    registerExternalMcpServer: async (input: unknown) => {
      // ⛔ **Cloned the way the REAL bridge clones** — `a-test-bridge-that-clones-nothing`.
      structuredClone(input)
      answers.registered.push(input)
      const said = input as { name: string; url: string; reach: ExternalMcpServerReach }
      const row = server(said.name, said.reach)
      answers.list = {
        ...answers.list,
        externalMcpServers: [...answers.list.externalMcpServers, row],
      }
      return row
    },
    removeExternalMcpServer: async () => true,
    setCapabilities: async () => answers.list.identities[0] ?? null,
    // ⚑ **696 · the door's answer since `682`** — the identity AND what it cleared (`AgentProviderSet`).
    setAgentProvider: async () => {
      const one = answers.list.identities[0]
      return one === undefined ? null : { ...one, modelChoiceCleared: null }
    },
    setSpawningEnabled: async () => ({ spawningEnabled: true }),
  } as unknown as RuntimeBridge
  return createAgentStore(bridge)
}

async function openRegistry(): Promise<Mounted> {
  const store = storeOver()
  await store.load()
  const m = mount(ExternalMcpRegistry, { store }, { width: 900, height: 1200 })
  await nextTick()
  return m
}

async function openSheet(runsOn: 'claude' | 'codex' = 'claude'): Promise<Mounted> {
  const store = storeOver()
  await store.load()
  const m = mount(
    CapabilitiesSheet,
    { profileSlug: 'pm', runsOn, capabilities: CAPABILITIES, store },
    { width: 900, height: 1200 },
  )
  await nextTick()
  return m
}

const radio = (m: Mounted, cy: string): HTMLInputElement => m.q(cy) as HTMLInputElement

beforeEach(() => {
  answers = {
    list: {
      identities: [identity()],
      foldersWithoutARow: [],
      use: [],
      spawningEnabled: true,
      defaultApprovalMode: 'ask',
      externalMcpServers: [],
    },
    registered: [],
  }
})

afterEach(() => unmountAll())

describe('524 §1 · the registration form starts OPEN', () => {
  it('🔴 the wide answer is already chosen, and its sentence is already on screen', async () => {
    const m = await openRegistry()
    // ⛔ **`checked`, not `value`.** A radio whose `value` is `everyone` says what it would send if
    // somebody pressed it; this says nobody has to. ⚑ *"It starts open"* is the ruling, and this is
    // the one line in the app where it is true or false.
    expect(radio(m, 'external-mcp-reach-everyone').checked, 'the form starts restricted').toBe(true)
    expect(radio(m, 'external-mcp-reach-restricted').checked).toBe(false)

    // ⚠️ **The disclosure `HO-048` §2 owes, drawn under the answer that is selected** — stated, not
    // gated. ⛔ Nothing is disabled by it and there is nothing to acknowledge, so the pairing is
    // that Add is pressable with the sentence on screen.
    expect(m.q('external-mcp-everyone-means').textContent).toContain(EXTERNAL_MCP_EVERYONE_MEANS)
    expect(m.all('external-mcp-restricted-means')).toHaveLength(0)

    // ⛔ **STATED, NOT GATED — measured by filling the form and finding Add live.** ⚠️ Asserting
    // `disabled === false` on the empty form would have passed for the wrong reason: `516` blocks
    // Add on an empty field, so the button is dead there whatever this dispatch did. ⚑ With the two
    // boxes filled, the disclosure is on screen and the press is available — which is the whole of
    // *"I am not gating it."*
    const name = m.q('external-mcp-name') as HTMLInputElement
    const url = m.q('external-mcp-url') as HTMLInputElement
    name.value = 'kibana'
    name.dispatchEvent(new Event('input'))
    url.value = 'http://127.0.0.1:9001/mcp'
    url.dispatchEvent(new Event('input'))
    await nextTick()
    expect(m.q('external-mcp-everyone-means').textContent).toContain(EXTERNAL_MCP_EVERYONE_MEANS)
    expect((m.q('external-mcp-add') as HTMLButtonElement).disabled, 'the disclosure gated').toBe(
      false,
    )
    // ⚠️ …and there is nothing to acknowledge: the only checkable controls on this form are the two
    // radios, so no third one can have appeared as a condition of the press.
    expect(m.host.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
  })

  it('⚑ choosing the exception swaps the sentence, and the choice reaches the wire', async () => {
    const m = await openRegistry()
    const restricted = radio(m, 'external-mcp-reach-restricted')
    restricted.checked = true
    restricted.dispatchEvent(new Event('change'))
    await nextTick()

    expect(m.q('external-mcp-restricted-means').textContent).toContain(
      EXTERNAL_MCP_RESTRICTED_MEANS,
    )
    expect(m.all('external-mcp-everyone-means')).toHaveLength(0)

    const name = m.q('external-mcp-name') as HTMLInputElement
    const url = m.q('external-mcp-url') as HTMLInputElement
    name.value = 'browser'
    name.dispatchEvent(new Event('input'))
    url.value = 'http://127.0.0.1:9001/mcp'
    url.dispatchEvent(new Event('input'))
    await nextTick()
    m.q('external-mcp-add').click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(answers.registered.at(-1)).toMatchObject({ name: 'browser', reach: 'restricted' })
    await nextTick()
    // 🔴 **And the form goes back to the default**, so the ruling's answer does not depend on what
    // somebody registered before it.
    expect(radio(m, 'external-mcp-reach-everyone').checked).toBe(true)
  })

  it('⛔ every registered row says which it is, including the common one', async () => {
    answers.list = {
      ...answers.list,
      externalMcpServers: [server('kibana', 'everyone'), server('browser', 'restricted', 9001)],
    }
    const m = await openRegistry()
    expect(m.q('external-mcp-row-reach-kibana').textContent).toContain('every identity')
    // ⚠️ **Both drawn, never only the exception.** A list where one state is silence cannot tell
    // *everyone's* from *this build could not read the column* — which is the value
    // `foldExternalMcpReach` produces for a row it does not recognise.
    expect(m.q('external-mcp-row-reach-browser').textContent).toContain('grant')
  })

  it('🔴 a server NAMED `everyone` does not steal the radio’s selector', async () => {
    // ⛔ **The rule, proven by violating it** (standing rule 20). A server name is a path segment, so
    // `everyone` is a name a person may register — and under the first spelling of the row's
    // `data-cy` it produced `external-mcp-reach-everyone`, which is the radio's. ⚠️ `querySelector`
    // answers the FIRST match in document order and the rows are drawn ABOVE the form, so every
    // assertion about the default would have been reading a `<small>` and passing on its text.
    answers.list = { ...answers.list, externalMcpServers: [server('everyone', 'everyone')] }
    const m = await openRegistry()
    const picked = radio(m, 'external-mcp-reach-everyone')
    expect(picked.tagName, 'the selector found the row instead of the control').toBe('INPUT')
    expect(picked.checked).toBe(true)
    // ⚑ The pairing: the row is still drawn, under its own name, so the separation is real rather
    // than one of the two having disappeared.
    expect(m.q('external-mcp-row-reach-everyone').tagName).toBe('SMALL')
  })
})

describe('524 §2 · the identity sheet stops under-reporting', () => {
  it('🔴 an available-to-all server is drawn with NO control on it, beside one that has a box', async () => {
    answers.list = {
      ...answers.list,
      externalMcpServers: [server('kibana', 'everyone'), server('browser', 'restricted', 9001)],
    }
    const m = await openSheet()

    // ⛔ **No `<input>` at all rather than a ticked one that is `disabled`.** A checkbox is a
    // control; one drawn checked-and-frozen makes a person hunt for the state that would unfreeze
    // it, and there is no such state — a server's reach is fixed at registration.
    const everyones = m.q('external-mcp-everyones-kibana')
    expect(
      everyones.querySelector('input'),
      'the row that is not a grant drew a control',
    ).toBeNull()
    expect(everyones.textContent).toContain('kibana')

    // ⚑ **The pairing, in the SAME mount** (standing rule 3): the restricted one DOES have a box, so
    // the absence above is this dispatch's rule and not a block that stopped drawing controls.
    const grantable = m.q('external-mcp-grant-browser')
    expect(grantable.querySelector('input')).not.toBeNull()

    // ⛔ **…and the everyone's row is not ALSO in the tickable list**, which is the defect a filter
    // that forgot its complement would produce.
    expect(m.all('external-mcp-grant-kibana')).toHaveLength(0)
    expect(m.all('external-mcp-everyones-browser')).toHaveLength(0)
  })

  it('⚑ it counts what this identity may USE, not what it was granted', async () => {
    answers.list = {
      ...answers.list,
      externalMcpServers: [server('kibana', 'everyone')],
    }
    const m = await openSheet()
    // 🔴 **`None granted` was the true sentence under the withdrawn model and is a lie under this
    // one**: this identity has no grant row and may call every tool this server publishes.
    expect(m.q('external-mcp-state').textContent).toContain('1 usable')
    expect(m.q('external-mcp-state').textContent).not.toContain('None')
  })

  it('⛔ an empty REGISTRY still says so, even with no restricted rows to draw', async () => {
    // ⚠️ **This paragraph used to be the `v-else` of the tick-box list.** After the split it would
    // have claimed *nothing is registered* whenever no server happened to be restricted — which is
    // now the normal state — so the pairing is both directions in one file.
    const empty = await openSheet()
    expect(empty.q('external-mcp-empty').textContent).toContain('No external MCP servers')
    empty.unmount()

    answers.list = { ...answers.list, externalMcpServers: [server('kibana', 'everyone')] }
    const full = await openSheet()
    expect(
      full.all('external-mcp-empty'),
      'a registry with a row claimed to be empty',
    ).toHaveLength(0)
  })

  it('🔴 a held-back block says a resolution HAPPENED when the identity chose nothing', async () => {
    answers.list = { ...answers.list, externalMcpServers: [server('browser', 'restricted', 9001)] }
    // ⛔ **`HO-048` §3's *whichever way it goes: the sheet says what is missing*.** ⚠️ The measurement
    // this dispatch owed found the effective provider was ALREADY resolved — `runsOn` is
    // `providerForALaunch(identities, slug, DEFAULT_PROVIDER)` and has been since `433` — so what was
    // missing was never the resolution. It was saying that one happened.
    const unsaid = await openSheet('codex')
    expect(unsaid.q('external-mcp-answers-for-the-fallback').textContent).toContain('falls back to')
    unsaid.unmount()

    // ⚑ **The pairing, one fact over**: an identity that HAS chosen gets the provider's reason and
    // no fallback sentence, because there is no resolution to explain.
    answers.list = {
      ...answers.list,
      identities: [identity({ provider: 'codex' })],
      use: [
        {
          slug: 'pm',
          conversations: 0,
          thisAppMintsIt: false,
          isLaunching: false,
          isStarting: false,
          runsOn: { provider: 'codex', from: 'saved' },
        },
      ],
    }
    const chose = await openSheet('codex')
    expect(chose.q('external-mcp-held-back').textContent).toContain('which call it is about')
    expect(chose.all('external-mcp-answers-for-the-fallback')).toHaveLength(0)
  })
})
