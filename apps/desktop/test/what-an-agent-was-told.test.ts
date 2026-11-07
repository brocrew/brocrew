import type { SessionInstructions } from '../src/shared/instruction-contracts'
import { sessionRefSchema } from '../../../packages/runtime/src/session-ref'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
import { DIGEST_REGISTERS } from '../src/shared/digest'
import { REGISTER_WORDS } from '../src/renderer/src/lib/digest'

import {
  claimedLayer,
  observedLayer,
  opaqueLayer,
  TOLD_HAS_AN_EARLIER_LIFE,
  TOLD_IS_THE_LAST_LAUNCH,
  TOLD_LAYER_KINDS,
  TOLD_REMEMBERS_NOTHING,
  type ToldLayer,
} from '../src/shared/told'
import { WHOSE_WORDS } from '../src/shared/whose-text'
import { NOTHING_OF_YOURS_YET } from '../src/renderer/src/lib/whose-groups'
import { visibleCopy, type VisibleString } from './lib/visible-copy'


const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '../src')
const RUNTIME = join(here, '../../../packages/runtime/src')

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function methodAround(source: string, needle: string): string[] {
  const lines = source.split('\n')
  const method = /^ {2}(?:private |public |protected )?(?:async )?([A-Za-z_]\w*)\s*[(<]/
  const found: string[] = []
  lines.forEach((line, index) => {
    if (!line.includes(needle)) return
    for (let back = index; back >= 0; back -= 1) {
      const hit = method.exec(lines[back] ?? '')
      if (hit) {
        found.push(hit[1] ?? '')
        return
      }
    }
    found.push('<no enclosing method>')
  })
  return found
}


describe('§1 · a resume reads today’s files', () => {
  it('🔴 the instruction reader is reached from exactly two launch paths — one create, one resume — and one look', () => {
    const host = read(join(ROOT, 'main/runtime/runtime-host.ts'))
    const sites = methodAround(host, 'this.deps.readInstructions?.(')
    expect(sites).toEqual([
      'startSessionInProfile',
      'whatThisAgentWasGiven',
      'reopenSession',
      'recordedHandover',
    ])
    const look = host.slice(host.indexOf('  private recordedHandover('))
    expect(look.slice(0, look.indexOf('\n  }\n'))).toContain(
      'instructions: instructions?.instructions ?? NO_INSTRUCTIONS,',
    )
  })

  it('⛔ the seam PUBLISHES and then READS on every call, so the read is of the files as they are now', () => {
    const root = read(join(ROOT, 'main/index.ts'))
    const seam = root.slice(root.indexOf('readInstructions: ('))
    const publish = seam.indexOf('publishProfileBundle(')
    const reader = seam.indexOf('readSessionInstructions(')
    expect(publish, 'the seam no longer publishes the profile bundle').toBeGreaterThan(-1)
    expect(reader, 'the seam no longer reads the instruction files').toBeGreaterThan(-1)
    expect(publish).toBeLessThan(reader)
  })

  it('the canonical session reference has identity fields, and the instruction reader delegates to its provider', () => {
    expect(Object.keys(sessionRefSchema.shape).sort()).toEqual([
      'cwd',
      'provider',
      'rotation',
      'sessionId',
    ])
    const source = code(read(join(ROOT, 'main/runtime/instructions.ts')))
    expect(source).toContain(
      'return providerKnowledge[inputs.provider].instructions.read(inputs)',
    )
  })

  it('🔴 so the surface says what this identity is told NOW — and the sentence is one string, spelled once', () => {
    expect(TOLD_IS_THE_LAST_LAUNCH).toContain('most recent launch')
    expect(TOLD_IS_THE_LAST_LAUNCH).toContain('no earlier composition is kept')
    expect(TOLD_IS_THE_LAST_LAUNCH).toContain('told now')
    expect(TOLD_IS_THE_LAST_LAUNCH).not.toContain('what this session was given')
    expect(TOLD_HAS_AN_EARLIER_LIFE).toContain('kept none of it')
    const panel = read(join(ROOT, 'renderer/src/components/SessionInstructions.vue'))
    expect(panel).toContain('told.says')
    expect(panel).not.toContain('most recent launch')
  })

  it('⛔ and the relaunch fact is DERIVED from the record, once, and forwarded — never re-derived', () => {
    const pane = read(join(ROOT, 'renderer/src/components/ConversationPane.vue'))
    expect(pane).toContain(':relaunched="props.record.liveFrom !== null"')
    for (const file of ['renderer/src/components/AgentInstructionsSheet.vue']) {
      const source = read(join(ROOT, file))
      expect(source, file).toContain(':relaunched="props.relaunched"')
      expect(code(source), `${file} re-derives it`).not.toContain('liveFrom')
      const opening = '<script setup lang="ts">'
      expect(source.split(opening)).toHaveLength(2)
      const decoy = source.replace(opening, `${opening}\n// liveFrom comment control\n`)
      expect(decoy).not.toBe(source)
      expect(decoy).toContain('// liveFrom comment control')
      expect(code(decoy).replace(/\s+/g, ' ').trim()).toBe(
        code(source).replace(/\s+/g, ' ').trim(),
      )
      expect(code(decoy), `${file} comment is not a derivation`).not.toContain('liveFrom')
      const changed = source.replace(
        opening,
        `${opening}\nconst relaunchControl = props.record.liveFrom !== null\n`,
      )
      expect(changed).not.toBe(source)
      expect(code(changed), `${file} executable re-derivation is detected`).toContain('liveFrom')
    }
    for (const file of [
      'renderer/src/components/SessionDrawer.vue',
      'renderer/src/components/SessionInfo.vue',
    ]) {
      expect(code(read(join(ROOT, file))), `${file} still carries it`).not.toContain('relaunched')
    }
  })
})


describe('§2 · every layer carries its register, and there is no way to build one without', () => {
  it('🔴 the three constructors are the only ones, and each fixes what the others may not carry', () => {
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

  it('⚑ an opaque layer MAY carry a count, which is 438’s gap shape rather than an exception', () => {
    expect(opaqueLayer('c', 'published-tools', 't', 's').count).toBeNull()
    expect(opaqueLayer('c', 'published-tools', 't', 's', 15).count).toBe(15)
    expect(opaqueLayer('c', 'published-tools', 't', 's', 0).count).toBe(0)
  })

  it('⛔ the source exports three constructors and writes three register literals — no fourth door', () => {
    const source = read(join(ROOT, 'shared/told.ts'))
    const exported = [...source.matchAll(/^export function (\w+)\(/gm)].map((m) => m[1])
    expect(exported).toEqual(['observedLayer', 'claimedLayer', 'opaqueLayer'])
    const literals = [...code(source).matchAll(/register: '([a-z]+)'/g)].map((m) => m[1])
    expect(new Set(literals)).toEqual(new Set(DIGEST_REGISTERS))
    expect(literals).toHaveLength(3)
    expect(source).toContain("import type { DigestRegister } from './digest'")
    expect(code(source)).not.toContain('DIGEST_REGISTERS = [')
  })

  it('⛔ a register this window does not recognise is WITHHELD and counted, never drawn', () => {
    const alien = {
      ...opaqueLayer('x', 'provider-base', 't', 's'),
      register: 'assumed',
    } as unknown as ToldLayer
    expect(canBeDrawn(alien)).toBe(false)
    expect(canBeDrawn(opaqueLayer('x', 'provider-base', 't', 's'))).toBe(true)
  })

  it('🔴 …and the WITHHELD count is the number dropped, which is the half a surface must say', () => {
    const good = opaqueLayer('a', 'provider-base', 't', 's')
    const bad = { ...good, id: 'b', register: 'assumed' } as unknown as ToldLayer
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

describe('§3 · the layers, in the order this app can establish', () => {
  it('🔴 the provider’s own layer is ALWAYS drawn, and it is opaque', () => {
    const view = toldView(NOTHING, null, false)
    const base = view.layers.find((layer) => layer.kind === 'provider-base')
    expect(base, 'the opaque base was omitted — 442 §2.1 forbids exactly this').toBeDefined()
    expect(base?.register).toBe('unknown')
    expect(base?.text).toBeNull()
    expect(view.layers[0]?.kind).toBe('provider-base')
  })

  it('⛔ the composed layer appears only when something really was appended, and carries the bytes', () => {
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

  it('🔴 a shape that predates the field draws no phantom layer, and still says nothing was appended', () => {
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

  it('⚠️ the agent’s store and the provider’s own files are CLAIMED, with paths and no text', () => {
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

  it('🔴 an empty store draws no layer and STATES the absence — 442’s own rule, one layer over', () => {
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

  it('⛔ …and it speaks for this app’s READ — never for what the agent wrote, or for the prompt', () => {
    expect(TOLD_REMEMBERS_NOTHING).toContain('BroCrew read none from its store')
    expect(TOLD_REMEMBERS_NOTHING).toContain('it writes the files and the provider loads them')
    expect(TOLD_REMEMBERS_NOTHING).not.toMatch(/(has |have )?written nothing|wrote nothing/i)
    expect(TOLD_REMEMBERS_NOTHING).not.toMatch(/reached (the model|this conversation)/i)
  })

  it('⚠️ the two absences are two sentences, and neither stands in for the other', () => {
    const empty = toldView(NOTHING, null, false)
    expect(empty.appendedNothing).toBe(true)
    expect(empty.remembers).toBe(TOLD_REMEMBERS_NOTHING)
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

  it('🔴 the verb count is DERIVED from what the conversation reported — two data points, so a typed number fails', () => {
    const all = toldView(NOTHING, registry(TOOL_NAMES), false)
    const fewer = toldView(NOTHING, registry(TOOL_NAMES.slice(1)), false)
    const tools = (view: ReturnType<typeof toldView>): number | null =>
      view.layers.find((layer) => layer.kind === 'published-tools')?.count ?? null
    expect(tools(all)).toBe(TOOL_NAMES.length)
    expect(tools(fewer)).toBe(TOOL_NAMES.length - 1)
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

  it('⚑ the tools layer is opaque even when it has a count, because the definitions are the provider’s', () => {
    const layer = toldView(NOTHING, registry(TOOL_NAMES), false).layers.find(
      (one) => one.kind === 'published-tools',
    )
    expect(layer?.register).toBe('unknown')
    expect(layer?.text).toBeNull()
    expect(layer?.count).toBe(TOOL_NAMES.length)
  })

  it('⛔ the earlier-life sentence is drawn on a relaunch and WITHHELD otherwise — never a hedge', () => {
    expect(toldView(NOTHING, null, false).earlier).toBeNull()
    expect(toldView(NOTHING, null, true).earlier).toBe(TOLD_HAS_AN_EARLIER_LIFE)
  })

  it('⚠️ the order sentence says what the order does NOT claim', () => {
    expect(toldView(NOTHING, null, false).order).toBe(TOLD_ORDER_IS_WHAT_WE_KNOW)
    expect(TOLD_ORDER_IS_WHAT_WE_KNOW).toContain('not something this app observes')
  })

  it('🔴 every kind in the vocabulary is reachable, and nothing outside it is drawn', () => {
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


describe('§4 · composed, as sent', () => {
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

  it('🔴 the composed string carries the framing the per-file rows do not', () => {
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

  it('⛔ it is the SAME composition the adapter is handed — one call, not two', () => {
    const read = readSessionInstructions({ provider: 'claude', cwd, providerHome, home })
    expect(read.instructions.composed).toBe(composeSystemHint(read.instructions.injected))
    expect(read.systemHint).toBe(read.instructions.composed)
    expect(read.firstTurnLead).toBeNull()
    const seam = read2(join(ROOT, 'main/index.ts'))
    expect(seam).toContain('withTheLinesSent(read.systemHint, savedMethodsLines)')
    expect(seam).toContain('firstTurnLead: withTheLinesSent(read.firstTurnLead, savedMethodsLines)')
    expect(code(seam)).not.toContain('composeSystemHint(')
  })

  it('⚠️ a provider that reads its own files gets `null`, and null is a MEASUREMENT', () => {
    const read = readSessionInstructions({ provider: 'codex', cwd, providerHome, home })
    expect(read.instructions.injected).toEqual([])
    expect(read.instructions.composed).toBeNull()
    expect(toldView(read.instructions, null, false).appendedNothing).toBe(true)
  })
})

function read2(path: string): string {
  return readFileSync(path, 'utf8')
}


describe('§5 · this app adds to the provider’s prompt and never replaces it', () => {
  const CLAUDE = join(RUNTIME, 'claude/claude-runtime.ts')
  const CODEX = join(RUNTIME, 'codex/codex-runtime.ts')

  it('🔴 one adapter appends to a NAMED PRESET it never reads, and assigns the field exactly once', () => {
    const source = code(read(CLAUDE))
    const assignments = [...source.matchAll(/options\.systemPrompt = /g)]
    expect(assignments).toHaveLength(1)
    const assigned = source.slice(assignments[0]!.index, assignments[0]!.index + 200)
    expect(assigned).toContain("type: 'preset'")
    expect(assigned).toContain("preset: 'claude_code'")
    expect(assigned).toContain('append: systemHint')
  })

  it('🔴 the other adapter sets the DEVELOPER layer and never the one that would replace the base', () => {
    const source = read(CODEX)
    const decoy = `/* baseInstructions comment control */\n${source}`
    expect(decoy).toContain('/* baseInstructions comment control */')
    expect(code(decoy).trim()).toBe(code(source).trim())
    expect(code(decoy)).not.toContain('baseInstructions')
    const changed = `${source}\nconst baseInstructions = 'replace the base'\n`
    expect(code(changed)).toContain('baseInstructions')
    const stripped = code(source)
    expect(stripped, 'the adapter now sets baseInstructions').not.toContain('baseInstructions')
    expect(stripped).toContain('developerInstructions')
  })

  it('⛔ and the protocol DECLARES the field both adapters decline, so the absence is a choice', () => {
    const params = read(join(RUNTIME, 'codex/protocol/v2/ThreadStartParams.ts'))
    expect(params).toContain('baseInstructions')
  })

  it('⚠️ so the opaque layer’s sentence is derived from those two facts, and says only them', () => {
    const base = toldView(NOTHING, null, false).layers.find(
      (layer) => layer.kind === 'provider-base',
    )
    expect(base?.says).toContain('never replaces it')
    expect(base?.says).toContain('never held a byte')
    expect(base?.says).not.toContain('probably')
  })

  const SURFACE = [
    join(ROOT, 'shared/told.ts'),
    join(ROOT, 'shared/whose-text.ts'),
    join(ROOT, 'renderer/src/lib/told.ts'),
    join(ROOT, 'renderer/src/lib/whose-groups.ts'),
    join(ROOT, 'renderer/src/lib/digest.ts'),
    join(ROOT, 'renderer/src/components/SessionInstructions.vue'),
  ]

  const PROVIDER = /claude|codex/i

  const named = (path: string, source: string): VisibleString[] =>
    visibleCopy(path, source).filter((one) => PROVIDER.test(one.text))

  const BLIND = /'([^'\n]{20,})'/g

  it('⛔ and this surface names no provider, which 317 forbids and a scan enforces', () => {
    for (const path of SURFACE) {
      expect(named(path, read(path)), path).toEqual([])
    }
  })

  it('⚑ …and the scan really read every file of it, in every shape they write copy in', () => {
    const read1 = (path: string): VisibleString[] => visibleCopy(path, read(path))
    const of = (tail: string): string => {
      const found = SURFACE.find((path) => path.replaceAll('\\', '/').endsWith(tail))
      expect(found, `${tail} is not on this surface any more`).toBeDefined()
      return found ?? ''
    }
    const copyIn = (tail: string): string =>
      read1(of(tail))
        .map((one) => one.text)
        .join('')
    expect(copyIn('shared/told.ts')).toContain(TOLD_REMEMBERS_NOTHING)
    expect(copyIn('renderer/src/lib/told.ts')).toContain(TOLD_ORDER_IS_WHAT_WE_KNOW)
    expect(read1(of('renderer/src/lib/digest.ts')).map((one) => one.text)).toContain(
      REGISTER_WORDS.claimed.title,
    )
    expect(copyIn('shared/whose-text.ts')).toContain(WHOSE_WORDS.learned.says)
    expect(copyIn('renderer/src/lib/whose-groups.ts')).toContain(NOTHING_OF_YOURS_YET)

    const panel = read1(of('components/SessionInstructions.vue'))
    const origins = new Set(panel.map((one) => one.origin))
    expect([...origins].sort()).toEqual(['attribute', 'single', 'template', 'text'])
    expect(origins.has('double')).toBe(false)
    expect(panel.map((one) => one.text)).toContain(
      'Nothing here says which of these the agent has actually looked up.',
    )
    expect(panel).toContainEqual({ text: 'as sent', origin: 'attribute' })
  })

  it('🔴 542 · a straight apostrophe makes prettier double-quote, and the copy is still copy', () => {
    const double = `export const A = "the agent's own Codex memory, as it was sent"`
    expect(named('a.ts', double)).toEqual([
      { text: "the agent's own Codex memory, as it was sent", origin: 'double' },
    ])
    expect([...double.matchAll(BLIND)]).toEqual([])

    const single = `export const B = 'the agent’s own Codex memory, as it was sent'`
    expect(named('b.ts', single)).toEqual([
      { text: 'the agent’s own Codex memory, as it was sent', origin: 'single' },
    ])
    expect([...single.matchAll(BLIND)]).toHaveLength(1)
  })

  it('⛔ 542 · …and it sees no prose, however much prose quotes the thing it guards against', () => {
    const block = `/** ⚠️ It said "loaded by Claude itself" until 317. */\nexport const C = 'a sentence a person reads'`
    const line = `export const D = 'a sentence a person reads' // Codex discovers these natively\n`
    const markup = `<template><!-- 312 measured Codex injecting one file --><p>a sentence</p></template>`
    for (const [at, source] of [
      ['c.ts', block],
      ['d.ts', line],
      ['e.vue', markup],
    ] as const) {
      expect(named(at, source), at).toEqual([])
    }
    expect(named('c.ts', block.replace('a sentence a person reads', 'Claude wrote this'))).toEqual([
      { text: 'Claude wrote this', origin: 'single' },
    ])
    expect(named('d.ts', line.replace('a sentence a person reads', 'Claude wrote this'))).toEqual([
      { text: 'Claude wrote this', origin: 'single' },
    ])
    expect(named('e.vue', markup.replace('a sentence', 'Claude wrote this'))).toEqual([
      { text: 'Claude wrote this', origin: 'text' },
    ])

    const code = [
      `import { x } from './codex-runtime'`,
      `export { y } from './claude-runtime'`,
      `const a = await import('./codex-runtime')`,
      `const b = require('./claude-runtime')`,
      `type T = \`claude-\${string}\``,
      `type U = 'codex' | 'other'`,
      `declare module 'codex-sdk' {}`,
    ].join('\n')
    expect(named('h.ts', code)).toEqual([])
    expect(named('h.ts', `${code}\nexport const Z = 'Codex named in copy'`)).toEqual([
      { text: 'Codex named in copy', origin: 'single' },
    ])
  })

  it('⚑ 542 · copy built with backticks, drawn as a text node, or handed to a component is copy', () => {
    const backtick = 'export const E = (n: number): string => `read from Codex: ${n} KB`'
    expect(named('f.ts', backtick)).toEqual([{ text: 'read from Codex: ', origin: 'template' }])
    expect([...backtick.matchAll(BLIND)]).toEqual([])

    const label = `<template><Doc filename="what Codex loaded" data-cy="codex-row" class="codex-badge" /></template>`
    expect(named('g.vue', label)).toEqual([{ text: 'what Codex loaded', origin: 'attribute' }])
    expect(named('g.vue', label.replace('codex-row', 'codex'))).toEqual([
      { text: 'what Codex loaded', origin: 'attribute' },
    ])

    expect(named('j.vue', `<template><p TITLE="Codex said so">x</p></template>`)).toEqual([
      { text: 'Codex said so', origin: 'attribute' },
    ])
    expect(named('k.vue', `<template><p DATA-CY="codex-row">x</p></template>`)).toEqual([])

    expect(named('i.vue', `<template><p>{{ ok ? 'Codex answered' : '' }}</p></template>`)).toEqual([
      { text: 'Codex answered', origin: 'single' },
    ])
  })

  it('⛔ 542 · a surface the parser cannot read is an error, never an empty answer', () => {
    expect(() => visibleCopy('broken.vue', '<template><div></template>')).toThrow(
      /Element is missing end tag/,
    )
    expect(() => visibleCopy('elsewhere.vue', '<template src="./tpl.html"></template>')).toThrow(
      /an out-of-file src=/,
    )
    expect(visibleCopy('whole.vue', '<template><div>a sentence</div></template>')).toEqual([
      { text: 'a sentence', origin: 'text' },
    ])
  })
})
