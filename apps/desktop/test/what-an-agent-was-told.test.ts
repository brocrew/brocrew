import type { SessionInstructions } from '../src/shared/instruction-contracts'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TOOL_NAMES } from '../src/main/runtime/agent-tools'
import { composeSystemHint, readSessionInstructions } from '../src/main/runtime/instructions'
import {
  canBeDrawn,
  drawableLayers,
  toldView,
  TOLD_ORDER_IS_WHAT_WE_KNOW,
} from '../src/renderer/src/lib/told'
import type { ToolRegistry } from '../src/renderer/src/lib/transcript'
import {
  claimedLayer,
  observedLayer,
  opaqueLayer,
  TOLD_HAS_AN_EARLIER_LIFE,
  TOLD_LAYER_KINDS,
  TOLD_REMEMBERS_NOTHING,
  type ToldLayer,
} from '../src/shared/told'

describe('every layer carries its register', () => {
  it('each of the three constructors fixes what the others may not carry', () => {
    const observed = observedLayer('a', 'app-composed', 't', 's', 'the bytes', 2)
    const claimed = claimedLayer('b', 'provider-discovered', 't', 's', 'the provider', ['/x'], 1)
    const opaque = opaqueLayer('c', 'provider-base', 't', 's')

    expect(observed.register).toBe('observed')
    expect(observed.saidBy).toBeNull()
    expect(observed.text).toBe('the bytes')
    expect(observed.paths).toEqual([])

    expect(claimed.register).toBe('claimed')
    expect(claimed.saidBy).toBe('the provider')
    expect(claimed.text).toBeNull()
    expect(claimed.paths).toEqual(['/x'])

    expect(opaque.register).toBe('unknown')
    expect(opaque.text).toBeNull()
    expect(opaque.paths).toEqual([])
    expect(opaque.saidBy).toBeNull()
  })

  it('an opaque layer may carry a count, and zero is distinct from none', () => {
    expect(opaqueLayer('c', 'published-tools', 't', 's').count).toBeNull()
    expect(opaqueLayer('c', 'published-tools', 't', 's', 15).count).toBe(15)
    expect(opaqueLayer('c', 'published-tools', 't', 's', 0).count).toBe(0)
  })

  it('a register this window does not recognise is withheld and counted, never drawn', () => {
    const good = opaqueLayer('a', 'provider-base', 't', 's')
    const bad = { ...good, id: 'b', register: 'assumed' } as unknown as ToldLayer
    expect(canBeDrawn(bad)).toBe(false)
    expect(canBeDrawn(good)).toBe(true)
    expect(drawableLayers([good, bad, { ...bad, id: 'c' }])).toEqual({
      layers: [good],
      withheld: 2,
    })
    expect(drawableLayers([good]).withheld).toBe(0)
  })
})

const NOTHING: SessionInstructions = {
  injected: [],
  agentMemory: [],
  provider: [],
  refused: [],
  note: '',
  recallsReported: false,
  writesReported: false,
  composed: null,
}

const NAMING = { prefix: 'mcp__', separator: '__' }

function registry(names: readonly string[], dropped = 0): ToolRegistry {
  return {
    dropped,
    at: null,
    set: {
      naming: NAMING,
      declared: {
        server: 'brobot',
        tools: names.map((name) => ({ name, description: name, parameters: [] })),
      },
      published: null,
    },
  }
}

describe('the layers, in the order this app can establish', () => {
  it('the provider’s own layer is always drawn first, and it is opaque', () => {
    const view = toldView(NOTHING, null, false)
    const base = view.layers.find((layer) => layer.kind === 'provider-base')
    expect(base, 'the opaque base was omitted').toBeDefined()
    expect(base?.register).toBe('unknown')
    expect(base?.text).toBeNull()
    expect(view.layers[0]?.kind).toBe('provider-base')
    expect(base?.says).toContain('never replaces it')
    expect(base?.says).toContain('never held a byte')
  })

  it('the composed layer appears only when something really was appended, and carries the bytes', () => {
    const bare = toldView(NOTHING, null, false)
    expect(bare.layers.map((layer) => layer.kind)).not.toContain('app-composed')
    expect(bare.appendedNothing).toBe(true)

    const sent = toldView(
      { ...NOTHING, composed: 'PREAMBLE\n\nContents of /a:\n\nhello' },
      null,
      false,
    )
    const layer = sent.layers.find((one) => one.kind === 'app-composed')
    expect(layer?.register).toBe('observed')
    expect(layer?.text).toBe('PREAMBLE\n\nContents of /a:\n\nhello')
    expect(sent.appendedNothing).toBe(false)
  })

  it('a shape that predates the field draws no phantom layer, and still says nothing was appended', () => {
    // An older host or a stored session sends no `composed` key; `undefined !== null`.
    const legacy = {
      injected: [],
      agentMemory: [],
      provider: [],
      refused: [],
      note: '',
      recallsReported: false,
      writesReported: false,
    } as unknown as SessionInstructions
    const view = toldView(legacy, null, false)
    expect(view.layers.map((layer) => layer.kind)).not.toContain('app-composed')
    expect(view.appendedNothing).toBe(true)
    expect(view.layers.map((layer) => layer.kind)).not.toContain('agent-store')
    expect(view.remembers).toBe(TOLD_REMEMBERS_NOTHING)
    for (const layer of view.layers) expect(layer.text).toBeNull()
  })

  it('the agent’s store and the provider’s own files are claimed, with paths and no text', () => {
    const view = toldView(
      {
        ...NOTHING,
        agentMemory: [
          { kind: 'agent-memory', path: '/home/MEMORY.md', text: 'x', bytes: 1, truncated: false },
        ],
        provider: [{ path: '/repo/AGENTS.md', scope: 'project' }],
      },
      null,
      false,
    )
    const store = view.layers.find((layer) => layer.kind === 'agent-store')
    const found = view.layers.find((layer) => layer.kind === 'provider-discovered')
    for (const layer of [store, found]) {
      expect(layer?.register).toBe('claimed')
      expect(layer?.saidBy).toBe('the provider')
      expect(layer?.text).toBeNull()
    }
    expect(store?.paths).toEqual(['/home/MEMORY.md'])
    expect(found?.paths).toEqual(['/repo/AGENTS.md'])
    expect(store?.count).toBe(1)
  })

  it('an empty or missing store draws no layer and states the absence; one file draws the layer instead', () => {
    const empty = toldView(NOTHING, null, false)
    expect(empty.layers.map((layer) => layer.kind)).not.toContain('agent-store')
    expect(empty.remembers).toBe(TOLD_REMEMBERS_NOTHING)

    const store = toldView(
      {
        ...NOTHING,
        agentMemory: [
          { kind: 'agent-memory', path: '/home/MEMORY.md', text: 'x', bytes: 1, truncated: false },
        ],
      },
      null,
      false,
    )
    expect(store.layers.map((layer) => layer.kind)).toContain('agent-store')
    expect(store.remembers).toBeNull()

    const older = { ...NOTHING } as Record<string, unknown>
    delete older['agentMemory']
    expect(toldView(older as unknown as SessionInstructions, null, false).remembers).toBe(
      TOLD_REMEMBERS_NOTHING,
    )
  })

  it('the two absences are two sentences, and neither stands in for the other', () => {
    const composedOnly = toldView({ ...NOTHING, composed: 'PREAMBLE' }, null, false)
    expect(composedOnly.appendedNothing).toBe(false)
    expect(composedOnly.remembers).toBe(TOLD_REMEMBERS_NOTHING)
    const storedOnly = toldView(
      {
        ...NOTHING,
        agentMemory: [
          { kind: 'agent-memory', path: '/home/MEMORY.md', text: 'x', bytes: 1, truncated: false },
        ],
      },
      null,
      false,
    )
    expect(storedOnly.appendedNothing).toBe(true)
    expect(storedOnly.remembers).toBeNull()
  })

  it('the tools layer counts what the conversation reported, opaque, and never a guessed number', () => {
    const tools = (view: ReturnType<typeof toldView>): number | null =>
      view.layers.find((layer) => layer.kind === 'published-tools')?.count ?? null
    const all = toldView(NOTHING, registry(TOOL_NAMES), false)
    expect(tools(all)).toBe(TOOL_NAMES.length)
    expect(tools(toldView(NOTHING, registry(TOOL_NAMES.slice(1)), false))).toBe(
      TOOL_NAMES.length - 1,
    )
    const layer = all.layers.find((one) => one.kind === 'published-tools')
    expect(layer?.register).toBe('unknown')
    expect(layer?.text).toBeNull()
    // Nothing reported, a frame with no declaration, or an undercounting frame: no count.
    expect(tools(toldView(NOTHING, null, false))).toBeNull()
    const undeclared = {
      dropped: 0,
      at: null,
      set: { naming: NAMING, declared: null, published: null },
    }
    expect(tools(toldView(NOTHING, undeclared, false))).toBeNull()
    expect(tools(toldView(NOTHING, registry(TOOL_NAMES, 1), false))).toBeNull()
    expect(tools(toldView(NOTHING, registry(TOOL_NAMES, 2), false))).toBeNull()
  })

  it('the earlier-life sentence is drawn on a relaunch and withheld otherwise', () => {
    expect(toldView(NOTHING, null, false).earlier).toBeNull()
    expect(toldView(NOTHING, null, true).earlier).toBe(TOLD_HAS_AN_EARLIER_LIFE)
  })

  it('the view carries the order sentence', () => {
    expect(toldView(NOTHING, null, false).order).toBe(TOLD_ORDER_IS_WHAT_WE_KNOW)
  })

  it('every kind in the vocabulary is reachable, and nothing outside it is drawn', () => {
    const full = toldView(
      {
        ...NOTHING,
        composed: 'x',
        agentMemory: [{ kind: 'agent-memory', path: '/m', text: 'x', bytes: 1, truncated: false }],
        provider: [{ path: '/p', scope: 'unknown' }],
      },
      registry(TOOL_NAMES),
      true,
    )
    expect(new Set(full.layers.map((layer) => layer.kind))).toEqual(new Set(TOLD_LAYER_KINDS))
    expect(full.withheld).toBe(0)
  })
})

describe('composed, as sent', () => {
  let root = ''
  let home = ''
  let cwd = ''
  let providerHome = ''

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brobot2-told-'))
    home = join(root, 'home')
    cwd = join(root, 'work', 'repo')
    providerHome = join(root, 'provider-homes', 'default', 'default', 'claude')
    mkdirSync(cwd, { recursive: true })
    mkdirSync(providerHome, { recursive: true })
    mkdirSync(home, { recursive: true })
    writeFileSync(join(providerHome, 'CLAUDE.md'), 'PROFILE-RULE-ONE\n')
    writeFileSync(join(cwd, 'CLAUDE.md'), 'PROJECT-RULE-TWO\n')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('the composed string carries the framing the per-file rows do not', () => {
    const read = readSessionInstructions({ provider: 'claude', cwd, providerHome, home })
    const composed = read.instructions.composed
    expect(composed).not.toBeNull()
    expect(composed).toContain('Follow them; they take precedence over earlier general guidance.')
    expect(composed).toContain(`Contents of ${join(providerHome, 'CLAUDE.md')} (`)
    expect(composed).toContain(`Contents of ${join(cwd, 'CLAUDE.md')} (`)
    expect(composed).toContain('PROFILE-RULE-ONE')
    expect(composed).toContain('PROJECT-RULE-TWO')
    for (const item of read.instructions.injected) {
      expect(item.text).not.toContain(
        'Follow them; they take precedence over earlier general guidance.',
      )
      expect(item.text).not.toContain('Contents of ')
    }
  })

  it('it is the same composition the Claude adapter is handed as its system prompt', () => {
    const read = readSessionInstructions({ provider: 'claude', cwd, providerHome, home })
    expect(read.instructions.composed).toBe(composeSystemHint(read.instructions.injected))
    expect(read.systemHint).toBe(read.instructions.composed)
    expect(read.firstTurnLead).toBeNull()
  })

  it('a provider that reads its own files gets no composed layer, and the view says so', () => {
    const read = readSessionInstructions({ provider: 'codex', cwd, providerHome, home })
    expect(read.instructions.injected).toEqual([])
    expect(read.instructions.composed).toBeNull()
    expect(toldView(read.instructions, null, false).appendedNothing).toBe(true)
  })
})
