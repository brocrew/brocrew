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
import type { SessionInstructions } from '../src/shared/runtime-ipc'
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

/**
 * 🔴 **What an agent was actually told** (442, HO-024 §4 criterion 24).
 *
 * > **24** — *An agent's instructions are legible to him: what it was told, composed, as sent —
 * > and what a running session was given at its launch, kept with that session.*
 *
 * ⛔ **§1 is the dispatch's own lead and it is a MEASUREMENT, not a design note.** *"Lead with §1 —
 * whether a resume really reads today's files, measured, and what the surface says about it."* The
 * first section below is that measurement, taken from the shipped source rather than from the
 * brief, and every sentence the surface draws about it is pinned to one of these assertions.
 *
 * ⚠️ **The second half of criterion 24 is NOT built here and must not read as if it were.** A
 * durable launch snapshot is a new write with a retention obligation; `442` §2.3 prices it and
 * forbids building it, and the response document carries the price.
 */

/** ⚠️ Anchored on THIS file rather than on the working directory, which the runner chooses. */
const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '../src')
const RUNTIME = join(here, '../../../packages/runtime/src')

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

/**
 * ⛔ **Prose stripped before a census asserts on code**
 * (`a-source-census-must-strip-prose-before-it-asserts`).
 *
 * Both adapters DISCUSS `baseInstructions` in their docblocks — one of them at length, to say it
 * is deliberately not used — so a census over the raw file would find the word it exists to prove
 * absent. ⚠️ **The controls are what make this a measurement**: §5 asserts the word IS in the raw
 * file, and that a neighbouring identifier survives the strip.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** The enclosing 2-space-indented class method of a byte offset, or null. */
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

// ─────────────────────────────────────────────────────────────────────────────
// §1 · A resume really does read today's files — measured
// ─────────────────────────────────────────────────────────────────────────────

describe('§1 · a resume reads today’s files, and nothing keeps what it read', () => {
  it('🔴 the instruction reader is reached from exactly two launch paths — one create, one resume — and one look', () => {
    const host = read(join(ROOT, 'main/runtime/runtime-host.ts'))
    const sites = methodAround(host, 'this.deps.readInstructions?.(')
    // ⛔ **The pair, by name and by count.** A further LAUNCH site would mean a launch path nobody
    // measured; losing one would mean a launch that composes nothing — and the whole of §1's claim
    // is that BOTH of these read the filesystem at the moment they run.
    // ⚑ **D-017b · a third site, and it is not a launch**: `recordedHandover` — the look that draws
    // a conversation nothing runs in the one full view — shows the instructions its next start
    // would give it, read at the moment of the look. ⛔ It keeps nothing either (it is handed out
    // on the `ResumedSession` and never stored), so §1's claim holds for it as for the pair.
    // ⚑ **F093 · a fourth, and not a launch either**: the agent-input popup's read composes what the
    // next start would give a conversation whose last launch kept no record — handed out, kept
    // nowhere, and only into a home this app manages.
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
    // ⚠️ **Publish BEFORE read, which is 377's order and is why a resume rewrites as well as
    // rereads**: the profile bundle at the leaf is regenerated from today's data and then read
    // back, so yesterday's composition is not merely unrecorded — it is gone from disk too.
    expect(publish).toBeLessThan(reader)
  })

  it('⚑ and it is a RULING rather than a leak — the two sentences that say so are still in the source', () => {
    // ⛔ **Asserted BY NAME** (standing rule 5: a safety sentence with no test is a comment). The
    // surface's own copy is derived from these two facts and would become false if either moved.
    expect(read(join(ROOT, 'main/runtime/instructions.ts'))).toContain(
      'Called on every start AND every resume, deliberately',
    )
    expect(read(join(RUNTIME, 'runtime.ts'))).toContain(
      'Nothing about it is persisted, and that is the design rather than a leftover',
    )
    // ⚑ **The search shape's positive control** (standing rule 4): the same reader, asked for a
    // sentence that is not there, comes back empty — so the two above are findings and not an
    // artefact of a grep that matches anything.
    expect(read(join(ROOT, 'main/runtime/instructions.ts'))).not.toContain(
      'Called once and snapshotted for the life of the conversation',
    )
  })

  it('🔴 so the surface says what this identity is told NOW — and the sentence is one string, spelled once', () => {
    // ⛔ **442 §2.2: the deliverable even if nothing else lands.** Pinned as a value rather than as
    // prose so a component cannot quietly draft its own kinder version beside it.
    expect(TOLD_IS_THE_LAST_LAUNCH).toContain('most recent launch')
    expect(TOLD_IS_THE_LAST_LAUNCH).toContain('no earlier composition is kept')
    expect(TOLD_IS_THE_LAST_LAUNCH).toContain('told now')
    // ⚠️ **And it does NOT claim the thing criterion 24's second half would need.** A surface that
    // said this was what the session was given at ITS launch would be the confident-wrong case.
    expect(TOLD_IS_THE_LAST_LAUNCH).not.toContain('what this session was given')
    expect(TOLD_HAS_AN_EARLIER_LIFE).toContain('kept none of it')
    const panel = read(join(ROOT, 'renderer/src/components/SessionInstructions.vue'))
    // ⛔ **The component draws the CONSTANT.** A second spelling in a template is how the pinned
    // sentence and the drawn one come apart — `331`'s rule, and the reason this is a value at all.
    expect(panel).toContain('told.says')
    expect(panel).not.toContain('most recent launch')
  })

  it('⛔ and the relaunch fact is DERIVED from the record, once, and forwarded — never re-derived', () => {
    // 🔴 **`a-pointer-clause-is-a-claim`.** The sentence above is only honest if something really
    // computes it from the conversation's own record, and the only component that holds one is
    // the pane. ⚠️ Three files, one derivation: the pane decides, the drawer and the info panel
    // pass it on. A second derivation anywhere between them is how two answers to one fact appear.
    const pane = read(join(ROOT, 'renderer/src/components/ConversationPane.vue'))
    expect(pane).toContain(':relaunched="props.record.liveFrom !== null"')
    // ⚑ **527 · the chain is one hop SHORTER, and the census follows the chain rather than the
    // file names it used to have.** `HO-050` §1.1 took the instructions block out of the drawer;
    // the pane hands the fact straight to the sheet that draws it, so `SessionDrawer` and
    // `SessionInfo` no longer carry a prop they only forwarded. ⛔ **Re-aimed rather than deleted**
    // (standing rule 26): the claim — *one derivation, forwarded, never re-derived* — is unchanged,
    // and §2 below asserts the two former carriers really have stopped naming it.
    for (const file of ['renderer/src/components/AgentInstructionsSheet.vue']) {
      const source = read(join(ROOT, file))
      expect(source, file).toContain(':relaunched="props.relaunched"')
      // ⛔ …and it does not reach for the record itself. ⚠️ Read as CODE: it names the field in a
      // docblock, to say where the value came from, and a census over the raw bytes would find the
      // word it exists to prove absent (`a-source-census-must-strip-prose-before-it-asserts`).
      expect(source, `${file} discusses it`).toContain('liveFrom')
      expect(code(source), `${file} re-derives it`).not.toContain('liveFrom')
    }
    // ⛔ **The two that dropped out, asserted OUT.** A component still declaring the prop while
    // nothing passed it would be a second, permanently-false answer to the same question.
    for (const file of [
      'renderer/src/components/SessionDrawer.vue',
      'renderer/src/components/SessionInfo.vue',
    ]) {
      expect(code(read(join(ROOT, file))), `${file} still carries it`).not.toContain('relaunched')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §2 · Three constructors, and a layer with no register is unrepresentable
// ─────────────────────────────────────────────────────────────────────────────

describe('§2 · every layer carries its register, and there is no way to build one without', () => {
  it('🔴 the three constructors are the only ones, and each fixes what the others may not carry', () => {
    const observed = observedLayer('a', 'app-composed', 't', 's', 'the bytes', 2)
    const claimed = claimedLayer('b', 'provider-discovered', 't', 's', 'the provider', ['/x'], 1)
    const opaque = opaqueLayer('c', 'provider-base', 't', 's')

    expect(observed.register).toBe('observed')
    // ⛔ **An observation has no author** — the engine is not a speaker (`438`'s `observedLine`).
    expect(observed.saidBy).toBeNull()
    expect(observed.text).toBe('the bytes')
    expect(observed.paths).toEqual([])

    expect(claimed.register).toBe('claimed')
    // ⛔ **A claim with no author is a rumour**, so the speaker is in the signature…
    expect(claimed.saidBy).toBe('the provider')
    // …and there is no `text` parameter at all: a claimed layer is one whose bytes we do not hold.
    expect(claimed.text).toBeNull()
    expect(claimed.paths).toEqual(['/x'])

    expect(opaque.register).toBe('unknown')
    // ⛔ **An opaque layer cannot be given content.** Not a convention — there is no argument for it.
    expect(opaque.text).toBeNull()
    expect(opaque.paths).toEqual([])
    expect(opaque.saidBy).toBeNull()
  })

  it('⚑ an opaque layer MAY carry a count, which is 438’s gap shape rather than an exception', () => {
    expect(opaqueLayer('c', 'published-tools', 't', 's').count).toBeNull()
    expect(opaqueLayer('c', 'published-tools', 't', 's', 15).count).toBe(15)
    // ⚠️ **Zero is a claim and null is not.** A layer that really covers nothing must be able to
    // say so without borrowing the word for *nobody has said*.
    expect(opaqueLayer('c', 'published-tools', 't', 's', 0).count).toBe(0)
  })

  it('⛔ the source exports three constructors and writes three register literals — no fourth door', () => {
    const source = read(join(ROOT, 'shared/told.ts'))
    const exported = [...source.matchAll(/^export function (\w+)\(/gm)].map((m) => m[1])
    expect(exported).toEqual(['observedLayer', 'claimedLayer', 'opaqueLayer'])
    // ⛔ **Every `register:` in the file is one of the three, and all three are present.** A
    // generic constructor would either add a fourth literal or take the register as an argument —
    // and `register: register` would fail the first half of this.
    const literals = [...code(source).matchAll(/register: '([a-z]+)'/g)].map((m) => m[1])
    expect(new Set(literals)).toEqual(new Set(DIGEST_REGISTERS))
    expect(literals).toHaveLength(3)
    // ⚠️ **And it never re-declares the vocabulary** — 442 §1: *"Do not fork its register
    // vocabulary — one spelling, shared."*
    expect(source).toContain("import type { DigestRegister } from './digest'")
    expect(code(source)).not.toContain('DIGEST_REGISTERS = [')
  })

  it('⛔ a register this window does not recognise is WITHHELD and counted, never drawn', () => {
    // ⚠️ **Reachable rather than defensive**: commands are validated on the way in and results are
    // cast on the way back, so a main process one build ahead can hand this a fourth register.
    const alien = {
      ...opaqueLayer('x', 'provider-base', 't', 's'),
      register: 'assumed',
    } as unknown as ToldLayer
    expect(canBeDrawn(alien)).toBe(false)
    // …and the positive control: a real one IS drawable, so the check is not simply always false.
    expect(canBeDrawn(opaqueLayer('x', 'provider-base', 't', 's'))).toBe(true)
  })

  it('🔴 …and the WITHHELD count is the number dropped, which is the half a surface must say', () => {
    const good = opaqueLayer('a', 'provider-base', 't', 's')
    const bad = { ...good, id: 'b', register: 'assumed' } as unknown as ToldLayer
    // ⛔ **Measured directly** rather than through `toldView`, which builds every layer through
    // the three constructors and therefore cannot produce this — a count no test can exercise is
    // a count that can be zeroed silently (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`).
    expect(drawableLayers([good, bad, { ...bad, id: 'c' }])).toEqual({
      layers: [good],
      withheld: 2,
    })
    // ⚠️ …and the ordinary case withholds nothing, so the count is not simply the length.
    expect(drawableLayers([good]).withheld).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §3 · The projection — every layer labelled, the opaque ones named rather than omitted
// ─────────────────────────────────────────────────────────────────────────────

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
    // ⚑ 444 relay 1 gave the registry a moment; 442's layer does not read it — the `published-tools`
    // layer is already covered by TOLD_IS_THE_LAST_LAUNCH and a second as-of would be two answers.
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
    // ⛔ **And it is FIRST.** Everything this app adds lands on top of it; a list that put the
    // app's own text underneath would be asserting an order both adapters contradict.
    expect(view.layers[0]?.kind).toBe('provider-base')
  })

  it('⛔ the composed layer appears only when something really was appended, and carries the bytes', () => {
    const bare = toldView(NOTHING, null, false)
    expect(bare.layers.map((layer) => layer.kind)).not.toContain('app-composed')
    // ⚑ …and the absence is STATED rather than left to be noticed.
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
    // ⛔ **Found reviewing this dispatch's own diff**, and it is `317`'s lesson arriving one field
    // over: the type is a promise about NEW values, and `instructions.dom.test.ts` builds the
    // shape *"a stored session or an older host really has"* on purpose. ⚠️ `undefined !== null`
    // is TRUE, so the un-normalised check drew an `app-composed` layer whose text was `undefined`
    // AND suppressed the *"appended nothing"* sentence — a phantom layer and a missing absence,
    // from one comparison.
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
    // ⚑ **And the store's absence is stated on the same shape** (`536`). ⚠️ This fixture's
    // `agentMemory` is an empty ARRAY; the MISSING-key shape is asserted in the test below, which
    // is where the normalisation itself is the subject.
    expect(view.layers.map((layer) => layer.kind)).not.toContain('agent-store')
    expect(view.remembers).toBe(TOLD_REMEMBERS_NOTHING)
    // …and no layer reaches a surface carrying `undefined` where its bytes should be.
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
      // ⛔ **A path is not content** (442 §2.1). The layer names where, and says nothing it cannot.
      expect(layer?.text).toBeNull()
    }
    expect(store?.paths).toEqual(['/home/MEMORY.md'])
    expect(found?.paths).toEqual(['/repo/AGENTS.md'])
    expect(store?.count).toBe(1)
  })

  it('🔴 an empty store draws no layer and STATES the absence — 442’s own rule, one layer over', () => {
    // ⛔ **`536` §0's answer, as an assertion.** Nothing ever removed memory from this surface:
    // `671484ab` (165) drew the store and `a3dc55c6` (317) drew the whole of it, and both are
    // still drawn. ⚠️ **What never existed is this sentence** — the store is the only layer that
    // can be absent without a word for it, so a fresh identity's sheet named four layers of the
    // prompt and was silent about the fifth.
    const empty = toldView(NOTHING, null, false)
    expect(empty.layers.map((layer) => layer.kind)).not.toContain('agent-store')
    expect(empty.remembers).toBe(TOLD_REMEMBERS_NOTHING)

    // ⚑ **The control, and it is the half that keeps rule 2**: one file and the LAYER is what
    // says so, with no sentence — an absence stated beside a layer that exists would be telling a
    // reader with a memory store that they have none.
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

    // ⛔ **And the shape an older host really sends: the key MISSING, not empty** — `317`'s
    // normalisation, which `instructions.dom.test.ts` builds on purpose because no typed fixture
    // can express it. ⚠️ `undefined` is not an array, so an un-normalised read would make an
    // absent field mean *nothing to say* rather than *nothing read* — and this sentence exists
    // for the second.
    const older = { ...NOTHING } as Record<string, unknown>
    delete older['agentMemory']
    expect(toldView(older as unknown as SessionInstructions, null, false).remembers).toBe(
      TOLD_REMEMBERS_NOTHING,
    )
  })

  it('⛔ …and it speaks for this app’s READ — never for what the agent wrote, or for the prompt', () => {
    // 🔴 **`314` §3 is why this is a census on the words and not a preference.** An unreadable
    // index and a dangling link both produce an empty `agentMemory` while the agent had written
    // plenty — and on a dangling link the provider's own `stat` had been reading the target until
    // the machine rebooted. ⛔ *"The agent has written nothing"* is false in the first case and
    // *"nothing reached the model"* is false in the second, so neither may be the sentence.
    expect(TOLD_REMEMBERS_NOTHING).toContain('BroCrew read none from its store')
    // ⚑ **And it teaches the word**, because a reader who has never seen the rows has no way to
    // know which of the several things this app calls memory belongs on this surface.
    expect(TOLD_REMEMBERS_NOTHING).toContain('it writes the files and the provider loads them')
    expect(TOLD_REMEMBERS_NOTHING).not.toMatch(/(has |have )?written nothing|wrote nothing/i)
    expect(TOLD_REMEMBERS_NOTHING).not.toMatch(/reached (the model|this conversation)/i)
  })

  it('⚠️ the two absences are two sentences, and neither stands in for the other', () => {
    // ⛔ **Three of the five layers are conditional** — the agent's store, what BroBot composed,
    // and the files the provider found for itself. ⚑ Two of them now state their absence in
    // words; `provider-discovered` does not, and `536` reports that as a finding rather than
    // building a third sentence nobody asked for.
    const empty = toldView(NOTHING, null, false)
    expect(empty.appendedNothing).toBe(true)
    expect(empty.remembers).toBe(TOLD_REMEMBERS_NOTHING)
    // ⚠️ **Independent, in both directions.** A view where one absence implied the other would
    // leave a reader unable to tell which layer was missing.
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
    // ⛔ **Never a typed count** (442 §3.3): the roster grew twice this slice, and a number spelled
    // in the renderer would have been wrong both times.
    expect(tools(all)).toBe(TOOL_NAMES.length)
    expect(tools(fewer)).toBe(TOOL_NAMES.length - 1)
    // ⚠️ **Nothing reported is NOT zero** — that would claim the conversation was handed none.
    expect(tools(toldView(NOTHING, null, false))).toBeNull()
    // ⛔ …and NEITHER is a frame that arrived without a declaration. A conversation whose provider
    // published an inventory while BroBot's own toolset went unstated is *nobody has said*, not
    // *it was handed none* — and this is the arm the `null` literal actually lives on.
    const undeclared = {
      dropped: 0,
      at: null,
      set: { naming: NAMING, declared: null, published: null },
    }
    expect(tools(toldView(NOTHING, undeclared, false))).toBeNull()
    // ⛔ **An understating frame collapses the count** — `247` §3: *"a registry that quietly
    // undercounts is worse than none."*
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
    // ⛔ **Both directions.** A kind the vocabulary declares and the projection can never build is
    // a dead member; a kind the projection builds and the vocabulary omits would not compile, and
    // this half says so out loud rather than trusting that.
    expect(new Set(full.layers.map((layer) => layer.kind))).toEqual(new Set(TOLD_LAYER_KINDS))
    expect(full.withheld).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §4 · `composed` is what was SENT, framing and all
// ─────────────────────────────────────────────────────────────────────────────

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
    // ⛔ **The preamble.** These bytes went to the model on every launch and reached no surface at
    // all until 442 — which is exactly why criterion 24's first half was unmet by a panel that had
    // existed since 158.
    expect(composed).toContain('Follow them; they take precedence over earlier general guidance.')
    // …one header per block, naming where the block came from.
    expect(composed).toContain(`Contents of ${join(providerHome, 'CLAUDE.md')} (`)
    expect(composed).toContain(`Contents of ${join(cwd, 'CLAUDE.md')} (`)
    expect(composed).toContain('PROFILE-RULE-ONE')
    expect(composed).toContain('PROJECT-RULE-TWO')
    // 🔴 **The control that makes this a finding rather than a restatement**: NONE of that framing
    // is in the rows, so a panel drawing the rows alone was never drawing what was sent.
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
    // ⚑ **D-024 · R1 — the reader now says which channel keeps the composition**: Claude's system
    // prompt (`systemHint`), or the first message of a Codex life (`firstTurnLead`). ⛔ On Claude it
    // is the SAME value the panel draws, not a second composition — and no lead.
    expect(read.systemHint).toBe(read.instructions.composed)
    expect(read.firstTurnLead).toBeNull()
    const seam = read2(join(ROOT, 'main/index.ts'))
    // ⚑ **The composition root reads the field rather than composing again.** Two calls would be
    // two chances to disagree — the rule `blockHeader` already states about the byte budget.
    // ⚑ **D-024 · R1 moved the field it reads** from `read.instructions.composed` to the reader's
    // channel answers, both passed through as read, with the saved-methods lines put back.
    expect(seam).toContain('withTheLinesSent(read.systemHint, savedMethodsLines)')
    expect(seam).toContain('firstTurnLead: withTheLinesSent(read.firstTurnLead, savedMethodsLines)')
    expect(code(seam)).not.toContain('composeSystemHint(')
  })

  it('⚠️ a provider that reads its own files gets `null`, and null is a MEASUREMENT', () => {
    const read = readSessionInstructions({ provider: 'codex', cwd, providerHome, home })
    expect(read.instructions.injected).toEqual([])
    // ⛔ **Not *"we do not know"*.** This app appends nothing for that provider, so the honest
    // answer is that there is no composed layer — and the surface says so in one sentence.
    // ⚑ **D-024 · R1 — a reading with no conversation block, which no launch builds any more**: a
    // launch composes this conversation's own text for Codex too (`thisConversation`), and
    // `composed` is then that text alone, sent in front of the first message.
    expect(read.instructions.composed).toBeNull()
    expect(toldView(read.instructions, null, false).appendedNothing).toBe(true)
  })
})

/** A second reader, so §4's census cannot be satisfied by a file §1 already opened. */
function read2(path: string): string {
  return readFileSync(path, 'utf8')
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 · The opaque base is opaque because the adapters make it so
// ─────────────────────────────────────────────────────────────────────────────

describe('§5 · this app adds to the provider’s prompt and never replaces it', () => {
  const CLAUDE = join(RUNTIME, 'claude/claude-runtime.ts')
  const CODEX = join(RUNTIME, 'codex/codex-runtime.ts')

  it('🔴 one adapter appends to a NAMED PRESET it never reads, and assigns the field exactly once', () => {
    const source = code(read(CLAUDE))
    // ⛔ **Exactly one assignment**, so this census cannot be satisfied by a neighbour: a second
    // `systemPrompt =` somewhere else in a 4,000-line adapter is precisely the shape
    // `a-file-level-contains-cannot-tell-sibling-declarations-apart` names.
    const assignments = [...source.matchAll(/options\.systemPrompt = /g)]
    expect(assignments).toHaveLength(1)
    // ⚑ **…and the one assignment is the ADDITIVE form.** The preset is named and never read by
    // this app; `append` is the only thing it puts into it.
    const assigned = source.slice(assignments[0]!.index, assignments[0]!.index + 200)
    expect(assigned).toContain("type: 'preset'")
    expect(assigned).toContain("preset: 'claude_code'")
    expect(assigned).toContain('append: systemHint')
  })

  it('🔴 the other adapter sets the DEVELOPER layer and never the one that would replace the base', () => {
    const source = read(CODEX)
    // ⚑ **The control for the search shape** (standing rule 4): the word IS in the raw file — the
    // adapter spends a paragraph on why it is not used — so a census over the raw bytes would
    // report the opposite of the truth.
    expect(source, 'the adapter no longer discusses baseInstructions').toContain('baseInstructions')
    const stripped = code(source)
    // ⛔ **…and it is gone once the prose is.** `a-source-census-must-strip-prose-before-it-asserts`.
    expect(stripped, 'the adapter now sets baseInstructions').not.toContain('baseInstructions')
    // ⚠️ **The second control.** Without this, a stripper that deleted the whole file would pass
    // the assertion above — the failure mode `a-negative-is-only-as-strong-as-the-search-shape`
    // names, arriving through the instrument rather than the query.
    expect(stripped).toContain('developerInstructions')
  })

  it('⛔ and the protocol DECLARES the field both adapters decline, so the absence is a choice', () => {
    // 🔴 **A declaration is not a use, and this is the half that makes the two tests above mean
    // something.** If the generated protocol had no such field, *"never set"* would be a fact
    // about the SDK rather than about this app — and the layer below would be opaque for a reason
    // nobody here decided.
    const params = read(join(RUNTIME, 'codex/protocol/v2/ThreadStartParams.ts'))
    expect(params).toContain('baseInstructions')
  })

  it('⚠️ so the opaque layer’s sentence is derived from those two facts, and says only them', () => {
    const base = toldView(NOTHING, null, false).layers.find(
      (layer) => layer.kind === 'provider-base',
    )
    expect(base?.says).toContain('never replaces it')
    expect(base?.says).toContain('never held a byte')
    // ⛔ **It does not guess what the base SAYS.** `430`: the Observer *"can display them, not
    // reconstruct missing provider layers or decide what an agent was told"*.
    expect(base?.says).not.toContain('probably')
  })

  /**
   * 🔴 **The files this surface's copy is spelled in** — `317`'s rule is about the SURFACE, not
   * about one of its files, and a census that read some of them would be a rule with a hole in it.
   *
   * ⚠️ **`digest.ts` was added at `542` and it was found by review, not by design.** The panel
   * imports `REGISTER_WORDS` from it and draws those words twice — as the `:title` on a register
   * chip and as the chip's visible label — so they are copy on this surface, spelled in a file the
   * guard had never opened.
   *
   * ⛔ **The roster is still HAND-WRITTEN, and that is the residual**: the derivable version is
   * *every module this panel imports a drawn constant from*, and `DocumentBody.vue` — whose own
   * chrome this panel also draws — is outside it. Reported as a finding rather than half-built.
   */
  // ⛔ **583 · two files joined this surface and the roster did not follow them** (found
  // reviewing 583's own diff). `317` forbids this surface's renderer naming a provider in
  // user-visible text, and a hand-written roster is only as wide as the last person to edit it —
  // `a-negative-is-only-as-strong-as-the-search-shape`. ⚠️ Every group heading, every membership
  // sentence and both absence sentences now live in `shared/whose-text.ts` and
  // `renderer/src/lib/whose-groups.ts`; the rule reached neither until this line.
  const SURFACE = [
    join(ROOT, 'shared/told.ts'),
    join(ROOT, 'shared/whose-text.ts'),
    join(ROOT, 'renderer/src/lib/told.ts'),
    join(ROOT, 'renderer/src/lib/whose-groups.ts'),
    join(ROOT, 'renderer/src/lib/digest.ts'),
    join(ROOT, 'renderer/src/components/SessionInstructions.vue'),
  ]

  /**
   * ⛔ **The policy, which lives here and not in the reader.** A SUBSTRING and not a word — the
   * shipped census used `toContain`, and `\bclaude\b` would walk past `claude_code`.
   */
  const PROVIDER = /claude|codex/i

  /** Every string a person could read in one file that names a provider. */
  const named = (path: string, source: string): VisibleString[] =>
    visibleCopy(path, source).filter((one) => PROVIDER.test(one.text))

  /**
   * ⛔ **The census as it shipped from `442` until `542`**, spelled here so the quote-spelling
   * controls can show what it could not see. ⚠️ **It is not what any assertion runs** — it is the
   * second half of the three plants that turn on WHICH QUOTE was chosen, because a widened reader
   * that finds a planted string proves nothing unless the old one is shown missing the same string
   * (`a-comparison-tested-where-both-sides-agree`). The prose and attribute plants below are about
   * a different axis and carry no `BLIND` arm.
   */
  const BLIND = /'([^'\n]{20,})'/g

  it('⛔ and this surface names no provider, which 317 forbids and a scan enforces', () => {
    for (const path of SURFACE) {
      expect(named(path, read(path)), path).toEqual([])
    }
  })

  /**
   * ⚑ **The positive half, one control PER FILE** — a reader that returned nothing would satisfy
   * every line above (`a-positive-assertion-must-differ-from-the-default`). ⚠️ **Per file and not
   * per surface**: the first version of this test read two of the three and left the third's
   * negative vacuous, which is the hole the roster's own docblock warns about, two screens up.
   */
  it('⚑ …and the scan really read every file of it, in every shape they write copy in', () => {
    const read1 = (path: string): VisibleString[] => visibleCopy(path, read(path))
    // ⛔ **583 · addressed by NAME, not by index.** Two files joined this roster and every
    // `SURFACE[n]!` below it moved — a positional reference into a list somebody else edits is
    // the shape that reads the wrong file and still passes.
    const of = (tail: string): string => {
      const found = SURFACE.find((path) => path.replaceAll('\\', '/').endsWith(tail))
      expect(found, `${tail} is not on this surface any more`).toBeDefined()
      return found ?? ''
    }
    const copyIn = (tail: string): string =>
      read1(of(tail))
        .map((one) => one.text)
        .join('')
    // ⛔ **Derived, not spelled**: the sentence is imported, so a reword moves both sides at once
    // (`a-test-that-plants-and-finds-with-one-derivation`). ⚠️ **Joined, because the shipped
    // sentence is THREE literals `+` together** — which is also the reader's own bound: a provider
    // name split across such a seam is invisible to it, exactly as `provider-neutrality.test.ts`
    // says of `'cl' + 'aude'`.
    expect(copyIn('shared/told.ts')).toContain(TOLD_REMEMBERS_NOTHING)
    // ⚑ Two more derivations, so the other `.ts` files are not vacuous either. ⚠️ The order
    // sentence is a `+` chain like the one above and needs the same join; `REGISTER_WORDS`' title
    // is one literal and is pinned exactly.
    expect(copyIn('renderer/src/lib/told.ts')).toContain(TOLD_ORDER_IS_WHAT_WE_KNOW)
    expect(read1(of('renderer/src/lib/digest.ts')).map((one) => one.text)).toContain(
      REGISTER_WORDS.claimed.title,
    )
    // 🔴 **583 · the two files the group headings moved into**, each with its own control, because
    // a negative over a file the reader could not parse is a negative over nothing.
    expect(copyIn('shared/whose-text.ts')).toContain(WHOSE_WORDS.learned.says)
    expect(copyIn('renderer/src/lib/whose-groups.ts')).toContain(NOTHING_OF_YOURS_YET)

    const panel = read1(of('components/SessionInstructions.vue'))
    const origins = new Set(panel.map((one) => one.origin))
    // ⚠️ **Three of these four the shipped census could not read at all**, measured at `542`: the
    // panel draws 26 non-empty TEXT nodes, builds `not read: …` from backticks, and hands
    // `filename="as sent"` to a component that renders it. Only the single-quoted ones were read.
    expect([...origins].sort()).toEqual(['attribute', 'single', 'template', 'text'])
    // 🔴 **`double` is absent, and its absence is this dispatch's whole premise**: not one string
    // on this panel contains a straight `'`, so prettier single-quoted every one of them and the
    // old census happened to see the ones it saw. ⛔ A sentence with an apostrophe would have been
    // invisible, and nothing about the panel would have looked different.
    expect(origins.has('double')).toBe(false)
    // ⚑ One shipped sentence, spelled — a TEXT node cannot be imported from anywhere, so this is
    // the one place the pin has to be a literal. A reword makes it red and the author re-aims it.
    expect(panel.map((one) => one.text)).toContain(
      'Nothing here says which of these the agent has actually looked up.',
    )
    // ⛔ **And the attribute that review found the first draft blind to.** `filename` is a
    // component PROP, not an HTML attribute, and `DocumentBody` draws it as a visible label — so
    // no allow-list of platform a11y names could ever have contained it.
    expect(panel).toContainEqual({ text: 'as sent', origin: 'attribute' })
  })

  /**
   * # 🔴 542 · the guard was enforced by a formatting convention, not by the guard
   *
   * ⛔ **`536` F3:** *"Any string containing a straight `'` is double-quoted by prettier and is
   * invisible to it… Every sentence on this surface uses a typographic `’` and therefore stays
   * single-quoted."*
   *
   * ⚑ **Two plants, one per spelling** (standing rule 12), each paired with the shipped census
   * reading the same bytes — which is what makes them a measurement rather than a formality.
   */
  it('🔴 542 · a straight apostrophe makes prettier double-quote, and the copy is still copy', () => {
    const double = `export const A = "the agent's own Codex memory, as it was sent"`
    expect(named('a.ts', double)).toEqual([
      { text: "the agent's own Codex memory, as it was sent", origin: 'double' },
    ])
    // ⛔ **What shipped saw:** nothing. The `"` never opened a string for it, and the one `'` in
    // the sentence has no partner on the line.
    expect([...double.matchAll(BLIND)]).toEqual([])

    const single = `export const B = 'the agent’s own Codex memory, as it was sent'`
    expect(named('b.ts', single)).toEqual([
      { text: 'the agent’s own Codex memory, as it was sent', origin: 'single' },
    ])
    // ⚑ **And the arm that DID work, so the pair measures the difference and not the reader.**
    expect([...single.matchAll(BLIND)]).toHaveLength(1)
  })

  /**
   * ⛔ **The other half of the property, and the reason this is a parser rather than `["']`.**
   *
   * ⚠️ **`542` measured what a widened regex would have found on day one**, and the answer is
   * sharper than *"it would fire on the docblocks"*: across these four files a
   * `/["']…{20,}["']/` finds **exactly one** provider hit, and it is `SessionInstructions.vue`'s
   * own line comment *"It said \"loaded by Claude itself\" until 317"* — 🔴 **the very string
   * `536` F3 cites as its evidence.** ⛔ So the one-character fix turns the census red on the
   * sentence that reported the defect.
   *
   * ⚑ **And the noise it would have inherited.** The shipped census captured **66 spans** across
   * the files it read, of which **12 were prose and 11 of those begin mid-word** at the `s` of a
   * possessive — `"s register is imported, the renderer"` — because a span between two
   * apostrophes in adjacent comment sentences looks exactly like a quoted string.
   */
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
    // 🔴 **Each control trapped the way the subject is** (`a-control-must-be-trapped-the-way-the-subject-is`):
    // a reader that deleted everything, or an SFC parse that returned no template, passes all three
    // lines above. These are the same three files with the word moved from the prose into the copy.
    expect(named('c.ts', block.replace('a sentence a person reads', 'Claude wrote this'))).toEqual([
      { text: 'Claude wrote this', origin: 'single' },
    ])
    expect(named('d.ts', line.replace('a sentence a person reads', 'Claude wrote this'))).toEqual([
      { text: 'Claude wrote this', origin: 'single' },
    ])
    expect(named('e.vue', markup.replace('a sentence', 'Claude wrote this'))).toEqual([
      { text: 'Claude wrote this', origin: 'text' },
    ])

    // ⛔ **Code wearing a string's clothes is not copy either**, and the import graph is the shape
    // most likely to name an adapter. ⚠️ **The dynamic arms are here because review found them
    // missing**: only the static `import … from` was excluded at first, so `await import(…)`
    // counted as a sentence a person reads.
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

  /**
   * ⚑ **§3.3 · template literals, answered by measurement rather than by guess.** The brief asked
   * whether any user-visible copy is built with backticks. It is: `renderer/src/lib/told.ts`
   * renders a layer's size as `` `${String(bytes)} B` `` and `` `${(bytes / 1024).toFixed(1)} KB` ``,
   * and the panel builds `` `not read: ${reason}` `` — three sentences a person reads that no
   * single-quote census has ever looked at.
   */
  it('⚑ 542 · copy built with backticks, drawn as a text node, or handed to a component is copy', () => {
    const backtick = 'export const E = (n: number): string => `read from Codex: ${n} KB`'
    expect(named('f.ts', backtick)).toEqual([{ text: 'read from Codex: ', origin: 'template' }])
    expect([...backtick.matchAll(BLIND)]).toEqual([])

    // ⛔ **Attributes are read by EXCLUSION, so an unclassified name defaults to being copy.** The
    // component prop fires; `data-cy` and `class` do not.
    const label = `<template><Doc filename="what Codex loaded" data-cy="codex-row" class="codex-badge" /></template>`
    expect(named('g.vue', label)).toEqual([{ text: 'what Codex loaded', origin: 'attribute' }])
    // 🔴 **And the two that did NOT fire are a HOLE, not a covered case.** The first draft of this
    // test said `provider-neutrality.test.ts` refuses them; measured, it refuses a value that IS
    // `codex` and not one that merely contains it. ⚠️ Nothing refuses `data-cy="codex-row"`.
    expect(named('g.vue', label.replace('codex-row', 'codex'))).toEqual([
      { text: 'what Codex loaded', origin: 'attribute' },
    ])

    // ⚠️ **And the name is compared LOWER-CASED**, because Vue's parser hands back the author's
    // spelling verbatim while HTML does not care — `TITLE="…"` draws a tooltip, and review found
    // the first draft walking past one.
    expect(named('j.vue', `<template><p TITLE="Codex said so">x</p></template>`)).toEqual([
      { text: 'Codex said so', origin: 'attribute' },
    ])
    // ⛔ …and the exclusion is lower-cased on the same axis: a shouted `DATA-CY` is still machine.
    expect(named('k.vue', `<template><p DATA-CY="codex-row">x</p></template>`)).toEqual([])

    // ⚑ **An interpolation's own literals are copy** — the fourth template tag, which nothing else
    // here would notice renumbering.
    expect(named('i.vue', `<template><p>{{ ok ? 'Codex answered' : '' }}</p></template>`)).toEqual([
      { text: 'Codex answered', origin: 'single' },
    ])
  })

  /**
   * ⛔ **An instrument that can go quiet without saying so is not an instrument** (standing rule
   * 27). ⚠️ **Two ways a `.vue` goes quiet, and review found the second**: the parser reports
   * errors, or it reports none and hands back no AST at all — which is what an out-of-file
   * `<template src="…">` does, and the first draft returned the script's copy and said nothing.
   */
  it('⛔ 542 · a surface the parser cannot read is an error, never an empty answer', () => {
    expect(() => visibleCopy('broken.vue', '<template><div></template>')).toThrow(
      /Element is missing end tag/,
    )
    expect(() => visibleCopy('elsewhere.vue', '<template src="./tpl.html"></template>')).toThrow(
      /an out-of-file src=/,
    )
    // ⚑ The control: the same reader, on the same shape, WITHOUT the defect.
    expect(visibleCopy('whole.vue', '<template><div>a sentence</div></template>')).toEqual([
      { text: 'a sentence', origin: 'text' },
    ])
  })
})
