import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, type PropType } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import OverlayHost from '../../src/renderer/src/components/OverlayHost.vue'
import SessionTools from '../../src/renderer/src/components/SessionTools.vue'
import type { SessionRecord } from '../../src/renderer/src/lib/session-record'
import { useSpawnSafety } from '../../src/renderer/src/lib/spawn-safety'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { AgentIdentities, TranscriptEvent } from '../../src/shared/runtime-ipc'
import type { ToolRegistry } from '../../src/renderer/src/lib/transcript'
import { catalogue, readInventory } from '../../src/renderer/src/lib/tool-inventory'
import { mount, paneProps, permission, record, unmountAll, visible } from './harness'

/**
 * 🔴 **392 · the inventory workbench, in a real window** (on `358`'s sheet and `358`'s data).
 *
 * ⚠️ **Why this is a browser test and not a `*.render.test.ts`.** Most of what this surface has to
 * be true about is what an SSR string cannot answer:
 *
 *  - **the search box and the standing chips.** A filtered list is not in the markup until
 *    something types and clicks, and `desktop` cannot do either. Renderer tests are SSR-only and a
 *    `not.toContain` about a hidden row passes just as happily over a sheet that rendered nothing.
 *  - **the list/detail split.** Which pane is on screen is a media query's answer, and a string has
 *    no width.
 *  - **it does not clip, and it does not cover the emergency stop.** Both are geometry, and
 *    `getBoundingClientRect` does not exist for a string.
 *
 * ⛔ **The viewport is shared across this whole directory** — `page.viewport()` resizes the runner's
 * iframe — so it is captured before the first resize and restored after every test.
 */
const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }
const safety = useSpawnSafety()

const IDENTITIES: AgentIdentities = {
  identities: [
    {
      id: 'agp:default:pm',
      slug: 'pm',
      displayName: null,
      createdAt: 0,
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
    },
  ],
  foldersWithoutARow: [],
  use: [],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  // ⚑ **516** — the global registry, carried on the same read; empty is a real answer.
  externalMcpServers: [],
}

beforeEach(() => {
  // The lane is `v-if`'d on a supplied identities read (355), and §2 measures where it sits.
  safety.supply(IDENTITIES, () => {})
})

afterEach(async () => {
  unmountAll()
  safety.forget()
  // ⚠️ **444 · the band is a ROOT token now**, so a test that moves it has to put it back or
  // every later test in this file measures a lane it never set.
  document.documentElement.style.removeProperty('--lane-w')
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/** Where the sheet sits in the app: inside an `OverlayHost`, which is the backdrop and the scope. */
const Sheet = defineComponent({
  name: 'ToolsSheetUnderTest',
  props: { tools: { type: Object as PropType<ToolRegistry>, required: true } },
  setup: (props) => () =>
    h(
      OverlayHost,
      { label: 'A sheet' },
      { default: () => [h(SessionTools, { tools: props.tools })] },
    ),
})

const CLAUDE_NAMING = { prefix: 'mcp__', separator: '__' }
const CODEX_NAMING = { prefix: '', separator: '__' }

/**
 * THREE of the app's declared tools, verbatim — `spawn_agent` keeps all seven arguments, which is
 * the row the parameter table is measured on.
 *
 * 🔴 **Leaving two out is NOT free, and the first version of this comment said it was.** Against
 * {@link PUBLISHED_37}, which carries five `mcp__brobot__` names, a three-tool declaration puts
 * every fixture in this file permanently into the `unclaimed` state — the child naming tools under
 * BroBot's own server that BroBot's declaration does not carry. ⚠️ That is not a side effect: it is
 * why `entries.length` is 37 rather than 35, and it is asserted by name in §5. Found in review,
 * which read the comment against the arithmetic.
 */
const DECLARED = {
  server: 'brobot',
  instructions: 'These tools reach the app you are running inside.',
  tools: [
    {
      name: 'list_agents',
      // ⚑ **Copied from the shipped tool, verbatim** (433) — this fixture is what a PROVIDER
      // declares, so it is an input rather than an assertion, and a stale copy of a retired
      // sentence is a fixture describing an app that no longer exists.
      description:
        'List the agents you can see: every conversation this app will let you name, including your own. This is what the app is running now, so a conversation that has ended is not here, and one from an earlier run is here only if it has been reopened. An id this list omits cannot be reached — every tool whose agent id comes from this list answers no-such-agent for it. The agents themselves outlive their conversations — list_profiles names the ones you may start, and starting one opens a new conversation rather than waking the old one. Seeing one is not permission to send to it — message_agent answers that separately. Reports who each one is — the name a person gave that agent, and the profile slug you would spawn it under — with its id, project, state and where it came from. A conversation this app cannot attribute is still listed, and says so rather than being given a name.',
      parameters: [
        {
          name: 'project',
          type: 'string',
          required: false,
          description: 'Only agents in this project. Omit for every agent you can see.',
        },
      ],
    },
    {
      name: 'spawn_agent',
      description:
        'Start a conversation running as an agent that already exists, so there is somebody to give work to. It brings no new agent into existence — create_agent is the verb for that — so the name must be one this app holds, and list_profiles names every one. The conversation begins idle and is sent nothing; message_agent is a separate act. Returns the new agent id, or a refusal naming the rule that stopped it.',
      parameters: [
        {
          name: 'profile_slug',
          type: 'string',
          required: true,
          description: 'Which agent identity to run as. It must already exist.',
        },
        {
          name: 'purpose',
          type: 'string',
          required: true,
          description: 'Why you are creating it. Recorded with the agent, forever.',
        },
        {
          name: 'project',
          type: 'string',
          required: false,
          description: 'Which project it belongs to.',
        },
        { name: 'provider', type: 'string', required: false },
        { name: 'model', type: 'string', required: false },
        {
          name: 'cwd',
          type: 'string',
          required: false,
          description: 'Working directory. Defaults to your own.',
        },
        {
          name: 'approval_mode',
          type: 'string',
          required: false,
          description: "'ask' or 'auto'. You may not give a child a laxer mode than your own.",
        },
      ],
    },
    {
      name: 'end_agent',
      description:
        'End an agent below you: one you created, or one those agents created in turn. Its transcript is kept.',
      parameters: [],
    },
  ],
}

/**
 * ⚑ **The real 37-name reading**, verbatim from `probe:tool-inventory`'s instrumented arm — the
 * longest published list this app has ever seen, which is what makes the wrap assertion mean
 * something.
 */
const PUBLISHED_37 = [
  'Task',
  'AskUserQuestion',
  'Bash',
  'CronCreate',
  'CronDelete',
  'CronList',
  'DesignSync',
  'Edit',
  'EnterPlanMode',
  'EnterWorktree',
  'ExitPlanMode',
  'ExitWorktree',
  'Monitor',
  'NotebookEdit',
  'PushNotification',
  'Read',
  'RemoteTrigger',
  'ReportFindings',
  'ScheduleWakeup',
  'SendMessage',
  'Skill',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'TaskUpdate',
  'ToolSearch',
  'WebFetch',
  'WebSearch',
  'Workflow',
  'Write',
  'mcp__brobot__end_agent',
  'mcp__brobot__get_agent_status',
  'mcp__brobot__list_agents',
  'mcp__brobot__message_agent',
  'mcp__brobot__spawn_agent',
]

/**
 * ⚑ **When these inventories were stated** (444 relay 1) — a fixed instant rather than
 * `Date.now()`, so the as-of line is a value this file states and not one it races.
 *
 * ⛔ **A year that is NOT the current one, on purpose.** The first draft used 2026, and the branch
 * was written in 2026 — so a surface rendering `Date.now()` instead of the row's moment satisfied
 * every `toContain(year)` assertion in this file. `a-positive-assertion-must-differ-from-the-default`.
 */
const STATED_AT = Date.UTC(2023, 4, 17, 9, 41, 7)

const CLAUDE: ToolRegistry = {
  set: {
    naming: CLAUDE_NAMING,
    declared: DECLARED,
    published: { tools: PUBLISHED_37, servers: [{ name: 'brobot', status: 'connected' }] },
  },
  dropped: 0,
  at: STATED_AT,
}

const CODEX: ToolRegistry = {
  set: { naming: CODEX_NAMING, declared: DECLARED, published: null },
  dropped: 0,
  at: STATED_AT,
}

// ⛔ Nothing reported ⇒ no set AND no moment; the two are one fact (444 relay 1).
const UNTOLD: ToolRegistry = { set: null, dropped: 0, at: null }

/** ⛔ The child answered and named nothing — a report, and NOT the provider that never reports. */
const EMPTY_REPORT: ToolRegistry = {
  set: { naming: CLAUDE_NAMING, declared: null, published: { tools: [], servers: [] } },
  dropped: 0,
  at: STATED_AT,
}

/** A published reading with another MCP server in it, which is the only source of standing-less rows. */
const WITH_FOREIGN: ToolRegistry = {
  set: {
    naming: CLAUDE_NAMING,
    declared: DECLARED,
    published: {
      tools: ['Bash', 'mcp__brobot__spawn_agent', 'mcp__github__create_issue'],
      servers: [
        { name: 'brobot', status: 'connected' },
        { name: 'github', status: 'needs-auth' },
      ],
    },
  },
  dropped: 0,
  at: STATED_AT,
}

/**
 * 🔴 **A server the child NAMED and listed no tool under** — `readInventory` keeps it deliberately
 * (*"a status row with no tools … both real and both must appear"*) and `358`'s sheet drew it with
 * a `0` tally. The catalogue has a row per TOOL, so this reading produces none for it.
 */
const SILENT_SERVER: ToolRegistry = {
  set: {
    naming: CLAUDE_NAMING,
    declared: DECLARED,
    published: {
      tools: ['Bash', 'mcp__brobot__spawn_agent'],
      servers: [
        { name: 'brobot', status: 'connected' },
        { name: 'github', status: 'needs-auth' },
      ],
    },
  },
  dropped: 0,
  at: STATED_AT,
}

/** The row selector: a catalogue row is keyed by the QUALIFIED name, which is what a provider lists. */
const row = (qualified: string): string => `tool-${qualified}`
const ours = (bare: string): string => row(`mcp__brobot__${bare}`)

async function open(tools: ToolRegistry, width = 1200, height = 808) {
  await page.viewport(width, height)
  // ⚠️ The box is 10px because the sheet must never be measured against it: `OverlayHost` is
  // `position: fixed`, so a wide host div would silently supply the width the viewport should.
  const m = mount(Sheet, { tools }, { width: 10, height: 10 })
  await nextTick()
  return { m, sheet: m.q('session-tools') }
}

async function type(input: HTMLElement, text: string): Promise<void> {
  const field = input as HTMLInputElement
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

/** Every element inside the sheet whose content is wider than the box it is drawn in. */
function overflowing(root: HTMLElement): string[] {
  const named = (el: Element): string => {
    const cy = el.getAttribute('data-cy')
    if (cy) return `[data-cy=${cy}]`
    const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : ''
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`
  }
  const contained = (el: Element): boolean => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true
    const overflowX = getComputedStyle(el).overflowX
    return overflowX === 'hidden' || overflowX === 'clip'
  }
  return [root, ...root.querySelectorAll('*')]
    .filter((el) => el.scrollWidth > el.clientWidth + 1 && !contained(el))
    .map((el) => `${named(el)} — ${el.scrollWidth}px of content in ${el.clientWidth}px`)
}

/* ───────────────────────────────────────────────── §1 · the geometry the app really opens at ── */

describe('§1 · the workbench fits the geometry the app opens at', () => {
  for (const geometry of [
    { label: '1440×1000 — 302 finding #6', width: 1440, height: 1000 },
    { label: '1200×808 — the shell below the app’s own title bar (385)', width: 1200, height: 808 },
    {
      label: '1180×808 — --app-min-w, the narrowest the app will render',
      width: 1180,
      height: 808,
    },
    { label: '900×800 — narrower than --app-min-w', width: 900, height: 800 },
    { label: '460×760 — the narrow layout this dispatch photographs', width: 460, height: 760 },
  ]) {
    it(`is inside the window and cuts nothing at ${geometry.label}`, async () => {
      const { sheet } = await open(CLAUDE, geometry.width, geometry.height)

      const box = sheet.getBoundingClientRect()
      const viewport = document.documentElement.clientWidth
      expect(Math.round(box.left), 'the sheet starts left of the window').toBeGreaterThanOrEqual(0)
      expect(
        Math.round(box.right),
        `the sheet's right edge is ${Math.round(box.right - viewport)}px outside a ${viewport}px window`,
      ).toBeLessThanOrEqual(viewport)
      expect(Math.round(box.bottom)).toBeLessThanOrEqual(document.documentElement.clientHeight)

      // ⛔ Nothing inside it is cut by its own `overflow: hidden`, at any width.
      expect(overflowing(sheet), 'something in the sheet is cut off sideways').toEqual([])
    })
  }

  /**
   * ⛔ **The planted control**, so `toEqual([])` above cannot pass vacuously — and it is planted
   * INSIDE the sheet's own `overflow: hidden`, which is where the subject lives.
   */
  it('…and the sweep can see an overflow when there is one', async () => {
    const { sheet } = await open(CLAUDE)
    expect(overflowing(sheet), 'the sheet starts clean, so the plant is the only change').toEqual(
      [],
    )

    const plant = document.createElement('div')
    plant.style.width = '4000px'
    plant.style.height = '2px'
    plant.style.flex = 'none'
    sheet.querySelector('[data-cy="tools-provenance"]')!.append(plant)
    await nextTick()

    // ⚠️ **The report names the ELEMENTS the plant widened, not the plant** — a 4000px box whose
    // own content is empty has `scrollWidth === clientWidth` and is not itself overflowing.
    const found = overflowing(sheet)
    expect(found.join(' | ')).toContain('[data-cy=tools-provenance]')
    expect(found.join(' | ')).toContain('4000px of content')
  })

  /**
   * 🔴 **The long `mono` run — the one shape in this sheet that can push a pane sideways.**
   *
   * A built-in row is one unbroken 29-character name in a monospace face inside a 274px column;
   * `overflow-wrap: anywhere` is what keeps it inside. ⚠️ Measured on the LONGEST name the fixture
   * has, not on a representative one.
   */
  it('the longest published name wraps rather than widening the catalogue', async () => {
    const { m, sheet } = await open(CLAUDE, 900, 800)
    const longest = PUBLISHED_37.reduce((a, b) => (b.length > a.length ? b : a))
    expect(longest).toBe('mcp__brobot__get_agent_status')
    const el = m.q(row(longest))
    expect(el.innerText).toContain(longest)
    expect(
      el.scrollWidth - el.clientWidth,
      'a published name is wider than the row it is drawn in',
    ).toBeLessThanOrEqual(1)
    expect(overflowing(sheet)).toEqual([])
  })
})

/* ──────────────────────────────────── §2 · the gutter 390's emergency stop owns, and this sheet ── */

/**
 * 🔴 **v2.5.1's workbench is 964px wide and this one is not, and the reason is a safety control.**
 *
 * ⛔ **`SpawnStopLane` sits at `left: 10px` and is `200px` wide**, so it owns the leftmost 210px of
 * the overlay layer at every window size. A 964px sheet centred at the app's own floor
 * (`--app-min-w: 1180px`) starts at 108px — under the stop. ⚑ The lane's `z-index: 2` means it
 * still PAINTS on top and `390`'s `reachable()` still passes, which is exactly why this needed its
 * own assertion: the instrument that would have caught it samples one point and that point is clear.
 *
 * ⚠️ **This is a coupling between two components and neither file can see the other**, so it is
 * asserted here, where both are on screen.
 */
describe('§2 · the workbench never grows into the stop’s gutter (390)', () => {
  for (const width of [1440, 1200, 1180]) {
    it(`⛔ at ${width}px the sheet stops short of the lane's right edge`, async () => {
      const { m, sheet } = await open(CLAUDE, width, 808)
      const lane = m.q('overlay-spawning').getBoundingClientRect()
      const box = sheet.getBoundingClientRect()

      expect(lane.width, 'the lane did not render, so this measures nothing').toBeGreaterThan(0)
      expect(
        Math.round(box.left),
        `the sheet starts at ${Math.round(box.left)}px and the lane ends at ${Math.round(lane.right)}px`,
      ).toBeGreaterThanOrEqual(Math.round(lane.right))
    })
  }

  /**
   * 🔴 **THE RULING, pinned by equality** (444, `411` §6 item 5 — a decision owed since `411`).
   *
   * ⛔ **The lane OCCUPIES 210 and this sheet CLEARS 220.** The three assertions above are `>=`,
   * which is the right shape for *"does not cover the stop"* and the wrong shape for the number:
   * set the gutter to the lane's own 210 and every one of them stays green, because tangency
   * satisfies `>=`. ⚠️ **`411` §2.1 reported *"DOM tests pin the 220 gutter"* — they did not, and
   * `persons-queue.dom.test.ts` had already pinned the lane's 210 by equality at the commit `411`
   * measured.** So the 10px was undefended in the one direction the ruling is about.
   *
   * ⚑ **1180 and 1200 only.** From 1380px up the `940px` cap decides the width instead of the
   * gutter, so at 1440 the gap is 250 and pinning 10 there would be pinning the cap.
   */
  for (const width of [1200, 1180]) {
    it(`🔴 at ${String(width)}px the gap between sheet and lane is exactly one --space-5 step`, async () => {
      const { m, sheet } = await open(CLAUDE, width, 808)
      const lane = m.q('overlay-spawning').getBoundingClientRect()
      const box = sheet.getBoundingClientRect()
      const step = Number.parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--space-5').trim(),
        10,
      )
      expect(step, 'the spacing ladder is gone from tokens.css').toBe(10)
      expect(
        Math.round(box.left) - Math.round(lane.right),
        'the sheet is tangent to the lane, or has drifted off the ladder',
      ).toBe(step)
    })
  }

  /**
   * 🔴 **One token, two readers — proved by moving it** (444).
   *
   * ⛔ **This is the assertion that makes `--lane-clear` a derivation rather than a second
   * literal that happens to agree.** Before this dispatch `OverlayHost` said `200px` and
   * `SessionTools` said `220px`, in two files neither of which imports the other; widening the
   * lane would have left the sheet reserving the old band with nothing red anywhere.
   *
   * ⚑ **Planted and found with ONE derivation**: the expected numbers below are computed from the
   * value this test sets, not typed beside it.
   */
  it('🔴 widening the lane widens the gutter — both read one token', async () => {
    const planted = 240
    const step = 10
    document.documentElement.style.setProperty('--lane-w', `${String(planted)}px`)
    const { m, sheet } = await open(CLAUDE, 1180, 808)

    const band = m.q('overlay-host').querySelector<HTMLElement>('.overlay-corner')!
    expect(Math.round(band.getBoundingClientRect().width), 'the lane ignored the token').toBe(
      planted,
    )
    const lane = m.q('overlay-spawning').getBoundingClientRect()
    expect(Math.round(lane.right)).toBe(step + planted)

    const box = sheet.getBoundingClientRect()
    // ⛔ The sheet's own rule, evaluated: `100% - 2 * (10 + planted + 10)`, under the 940 cap.
    const expected = Math.min(940, 1180 - 2 * (step + planted + step))
    expect(Math.round(box.width), 'the sheet did not follow the lane').toBe(expected)
    expect(
      Math.round(box.left) - Math.round(lane.right),
      'the clearance step did not survive the move',
    ).toBe(step)
  })

  /**
   * ⚠️ **The control for the test above, and it is the state it falls back to.** With no override
   * the same two numbers are the shipped ones — so the widening really was the token's doing and
   * not something the mount does at any lane width.
   */
  it('⚠️ …and with the token left alone it is the shipped 210 / 220', async () => {
    const { m, sheet } = await open(CLAUDE, 1180, 808)
    const lane = m.q('overlay-spawning').getBoundingClientRect()
    expect(Math.round(lane.right)).toBe(210)
    expect(Math.round(sheet.getBoundingClientRect().width)).toBe(1180 - 2 * 220)
  })

  /**
   * 🔴 **Below the breakpoint the gutter is GONE and the safety property still holds** — and the
   * two are different claims. The narrow rule caps the sheet at 560px, which at 900px starts at
   * 170px, inside the lane's band; what keeps the stop reachable there is `z-index: 2` on a lane
   * whose sibling panel creates no stacking context, so it paints ON TOP rather than behind.
   * ⚠️ Review caught the first version of this file asserting only the gutter and the comment
   * claiming it held *"whatever the window"*.
   */
  it('⛔ at 460px the sheet reaches into the gutter and the stop is still the element on top', async () => {
    const { m, sheet } = await open(CLAUDE, 460, 760)
    const lane = m.q('overlay-spawning').getBoundingClientRect()
    const box = sheet.getBoundingClientRect()
    expect(
      Math.round(box.left),
      'the narrow sheet no longer overlaps the lane, so this measures the wrong thing',
    ).toBeLessThan(Math.round(lane.right))

    const at = document.elementFromPoint(lane.left + lane.width / 2, lane.top + lane.height / 2)
    expect(at, 'nothing is at the lane’s centre').not.toBeNull()
    expect(
      m.q('overlay-spawning').contains(at),
      'the sheet is the element a click at the stop’s centre would reach',
    ).toBe(true)
  })

  /**
   * ⛔ **The control, and it is the mock's own number.** Widened to v2.5.1's 964px the sheet really
   * does reach under the lane at the app's floor — so the assertion above is measuring the width
   * rule and not a gutter every sheet would have had anyway.
   */
  it('…and at v2.5.1’s 964px it would not', async () => {
    const { m, sheet } = await open(CLAUDE, 1180, 808)
    const before = sheet.getBoundingClientRect()
    const lane = m.q('overlay-spawning').getBoundingClientRect()
    expect(Math.round(before.left)).toBeGreaterThanOrEqual(Math.round(lane.right))

    sheet.style.width = '964px'
    sheet.style.maxWidth = '964px'
    await nextTick()
    expect(
      Math.round(sheet.getBoundingClientRect().left),
      'the mock’s own width would have cleared the lane, so this test proves nothing',
    ).toBeLessThan(Math.round(lane.right))
  })
})

/* ────────────────────────────────────────────────────── §3 · the two controls, and their count ── */

describe('§3 · search and the standing filter', () => {
  it('⚑ the search narrows the list, and the header count does NOT move with it', async () => {
    const { m } = await open(CLAUDE)
    const summary = m.q('tools-summary').innerText
    expect(m.q('tools-shown').innerText).toContain('Showing 37 of 37 entries')
    expect(m.all(row('Bash'))).toHaveLength(1)

    await type(m.q('tools-search'), 'spawn_agent')
    expect(m.q('tools-shown').innerText).toContain('Showing 1 of 37 entries')
    expect(m.all(ours('spawn_agent'))).toHaveLength(1)
    expect(m.all(row('Bash')), 'a row the search excluded is gone').toHaveLength(0)

    // ⚠️ **`separately` matches exactly ONE row, and it matches on the DESCRIPTION alone** — no
    // tool is named that. Kept as an assertion rather than avoided as an odd query: it is the
    // cheapest proof that the search really reads both fields. ⛔ **The query was `spawn` until
    // `433`**, which matched `list_agents` on *"the ones you spawned"* — a sentence that is gone,
    // so the instrument moved with it rather than the claim being softened. ⚑ **And the pair below
    // is what keeps it a two-field proof**: a name-only query still narrows to its own row.
    await type(m.q('tools-search'), 'separately')
    expect(m.q('tools-shown').innerText).toContain('Showing 1 of 37 entries')
    expect(m.all(ours('list_agents'))).toHaveLength(1)
    expect(m.all(ours('spawn_agent'))).toHaveLength(0)

    // 🔴 **`inventorySummary`'s own docblock has forbidden a filtered header count since `358`.**
    // This is the dispatch that added the filter; the header still counts the whole inventory.
    expect(m.q('tools-summary').innerText, 'the header count followed the filter').toBe(summary)
    expect(summary).toContain('3 of 3 BroCrew tools confirmed')
  })

  it('matches a description as well as a name', async () => {
    const { m } = await open(CLAUDE)
    // ⛔ No row is named "transcript is kept" — this can only match on the sentence.
    await type(m.q('tools-search'), 'transcript is kept')
    expect(m.q('tools-shown').innerText).toContain('Showing 1 of 37')
    expect(m.all(ours('end_agent'))).toHaveLength(1)
  })

  /**
   * 🔴 **A reading that can carry NO standing at all gets no chips** — `353`'s negative control, a
   * launch with the toolset detached: `published` with `declared === null`, in which every row is
   * the child's own. ⚠️ `standingChoices` answers about the READING and would still have offered
   * two; whether this conversation holds anything WITH a standing is a second question. Found in
   * review.
   */
  it('⛔ no chips at all when there is no declaration to join to', async () => {
    const detached: ToolRegistry = {
      set: {
        naming: CLAUDE_NAMING,
        declared: null,
        published: {
          tools: ['Bash', 'mcp__github__create_issue'],
          servers: [{ name: 'github', status: 'connected' }],
        },
      },
      dropped: 0,
      at: STATED_AT,
    }
    const { m } = await open(detached)
    expect(m.q('tools-reading').innerText, 'the reading itself still offers two').toBe('published')
    expect(m.all('tools-filters'), 'a filter that can only ever empty the list').toHaveLength(0)
    expect(m.all('tools-filter-confirmed')).toHaveLength(0)
    // ⚑ The pair: the list is really there, so the absent chips are about standings and not about
    // a sheet that drew nothing.
    expect(m.q('tools-shown').innerText).toContain('Showing 2 of 2 entries')
    expect(m.all(row('Bash'))).toHaveLength(1)
  })

  it('⛔ only the standings this reading can produce get a chip', async () => {
    const published = await open(CLAUDE)
    expect(published.m.all('tools-filter-confirmed')).toHaveLength(1)
    expect(published.m.all('tools-filter-offered')).toHaveLength(1)
    expect(
      published.m.all('tools-filter-unconfirmable'),
      'a published reading offered a standing it can never mint',
    ).toHaveLength(0)

    unmountAll()
    const unpublished = await open(CODEX)
    expect(unpublished.m.all('tools-filter-unconfirmable')).toHaveLength(1)
    expect(unpublished.m.all('tools-filter-confirmed')).toHaveLength(0)
    expect(unpublished.m.all('tools-filter-offered')).toHaveLength(0)
  })

  it('⛔ filtering by standing hides every row that HAS none, and the count is what says so', async () => {
    const { m } = await open(CLAUDE)
    m.q('tools-filter-confirmed').click()
    await nextTick()

    expect(m.all(ours('spawn_agent'))).toHaveLength(1)
    // ⚠️ The 32 built-ins are gone and NOT because they failed a standing test — they have none.
    expect(m.all(row('Bash'))).toHaveLength(0)
    expect(m.q('tools-shown').innerText).toContain('Showing 3 of 37 entries')

    m.q('tools-clear-filters').click()
    await nextTick()
    expect(m.q('tools-shown').innerText).toContain('Showing 37 of 37 entries')
    expect(m.all(row('Bash'))).toHaveLength(1)
  })

  it('a search that matches nothing says so, and says the inventory is still there', async () => {
    const { m } = await open(CLAUDE)
    await type(m.q('tools-search'), 'zzzz-no-such-tool')
    expect(m.all('catalog-no-matches')).toHaveLength(1)
    expect(m.q('catalog-no-matches').innerText).toContain('37 entries are still there')
    // ⛔ It is NOT the "no entries at all" sentence — those are different facts.
    expect(m.all('catalog-empty')).toHaveLength(0)

    m.q('tools-clear-from-empty').click()
    await nextTick()
    expect(m.all('catalog-no-matches')).toHaveLength(0)
    expect(m.all(row('Bash'))).toHaveLength(1)
  })

  /**
   * ⛔ **A group whose every row was filtered out disappears rather than standing empty.** An empty
   * `github` heading under a search for `spawn` would read as *"this server has no tools"*, which
   * is a claim about the server rather than about the search.
   */
  /**
   * 🔴 **516 · what this group's sentence CLAIMS, and it used to claim something this app cannot
   * know.** ⛔ It read *"An MCP server the agent configured itself"* — a provenance nothing here
   * measures, and now positively false half the time: a person registers a server in the rail,
   * grants it to an identity, and `claudeMcpServersFor` puts it in the launch. ⚠️ The honest reading
   * of a row in this group is what the CHILD reported and BroBot did not declare; who set it up is
   * a question the inventory cannot answer, so the sentence stops claiming to.
   */
  it('⛔ the foreign-server group says what it knows and not who configured the server', async () => {
    const { m } = await open(WITH_FOREIGN)
    const group = m.q('tools-group-server:github')
    expect(group.innerText).toContain('beside BroCrew')
    expect(
      group.innerText,
      'this surface cannot know who configured a server the child reported',
    ).not.toContain('configured itself')
  })

  it('a group with no matching rows is absent, not an empty heading', async () => {
    const { m } = await open(WITH_FOREIGN)
    expect(m.all('tools-group-server:github')).toHaveLength(1)
    await type(m.q('tools-search'), 'spawn')
    expect(m.all('tools-group-server:github')).toHaveLength(0)
    expect(m.all('tools-group-brobot:brobot')).toHaveLength(1)
  })
})

/* ──────────────────────────────────────────────────────────── §4 · the detail, and its absences ── */

describe('§4 · the detail pane', () => {
  it('⚑ shows the selected row’s standing, sentence and arguments', async () => {
    const { m } = await open(CLAUDE)
    m.q(ours('spawn_agent')).click()
    await nextTick()

    expect(m.q('tool-detail-name').innerText).toBe('mcp__brobot__spawn_agent')
    // ⛔ **The row in the LIST carries the sentence too**, and it had no name and no assertion until
    // review: the search claims to read descriptions, and the list could have stopped drawing them
    // with nothing turning red.
    expect(m.q('tool-description-mcp__brobot__spawn_agent').innerText).toContain(
      'Start a conversation running as an agent that already exists',
    )
    expect(m.q('tool-detail-standing-chip').innerText).toBe('confirmed')
    expect(m.q('tool-detail-standing').innerText).toContain('the agent listed it')
    expect(m.q('tool-detail-desc').innerText).toContain('It brings no new agent into existence')
    expect(m.q('tool-detail-source').innerText).toContain('BroCrew')
    expect(m.q('tool-detail-server').innerText).toBe('brobot')
    expect(m.q('tool-detail-connection').innerText).toBe('connected')

    // ⛔ Scoped to the argument row, never to the pane: `toContain` on a whole panel is satisfied by
    // a neighbour, and `project` appears in TWO of this fixture's tools.
    // ⚠️ **The NAME is asserted, and review is why it had to be added**: the row's `data-cy` is
    // built from `parameter.name`, so deleting the name from the cell left the selector resolving
    // and every other assertion on the row passing.
    expect(m.q('tool-param-profile_slug').innerText).toContain('profile_slug')
    expect(m.q('tool-param-profile_slug').innerText).toContain('string')
    expect(
      m.q('tool-param-profile_slug').innerText,
      'a required argument is marked, and the marker is a glyph rather than a colour',
    ).toContain('*')
    expect(m.q('tool-param-model').innerText).not.toContain('*')

    // …and selecting a different row replaces the pane rather than adding to it.
    m.q(ours('end_agent')).click()
    await nextTick()
    expect(m.q('tool-detail-name').innerText).toBe('mcp__brobot__end_agent')
    expect(m.all('tool-param-profile_slug')).toHaveLength(0)
  })

  it('🔴 `takes no arguments` and `no argument list is published` are different sentences', async () => {
    const { m } = await open(CLAUDE)
    m.q(ours('end_agent')).click()
    await nextTick()
    const declaredEmpty = m.q('tool-detail-params').innerText
    expect(declaredEmpty).toContain('takes no arguments')

    m.q(row('Bash')).click()
    await nextTick()
    const nobodyPublishes = m.q('tool-detail-params').innerText
    expect(nobodyPublishes).toContain('No argument list is published')
    expect(nobodyPublishes).not.toContain('takes no arguments')
    // ⛔ The pair, made explicit: these are two absences and they must not read the same.
    expect(nobodyPublishes).not.toBe(declaredEmpty)
  })

  it('⛔ a row BroBot did not declare has no standing chip — and says why, rather than showing a word', async () => {
    const { m } = await open(WITH_FOREIGN)
    m.q(row('mcp__github__create_issue')).click()
    await nextTick()

    expect(
      m.all('tool-detail-standing-chip'),
      'a standing was invented for a foreign row',
    ).toHaveLength(0)
    expect(m.q('tool-detail-standing').innerText).toContain('BroCrew did not declare this one')
    expect(m.q('tool-detail-desc').innerText).toContain('No description is published')
    expect(m.q('tool-detail-server').innerText).toBe('github')
    expect(m.q('tool-detail-connection').innerText).toBe('needs sign-in')

    // ⚑ The pair: our OWN row in the same sheet does carry a chip, so "none" above is about the
    // source of the row and not about a detail pane that draws no chips at all.
    m.q(ours('spawn_agent')).click()
    await nextTick()
    expect(m.q('tool-detail-standing-chip').innerText).toBe('confirmed')
  })

  it('a built-in says the provider owns it, and names no server', async () => {
    const { m } = await open(CLAUDE)
    m.q(row('Bash')).click()
    await nextTick()
    expect(m.q('tool-detail-source').innerText).toContain('built-in')
    expect(m.q('tool-detail-server').innerText).toContain('None')
    // ⛔ **Not `Not reported by the agent`** — a built-in belongs to no server, so a connection is
    // a question with no subject and the answer would read as a silence where there is none. It is
    // the same distinction the group head makes; review found the detail pane not making it.
    expect(m.q('tool-detail-connection').innerText).toBe('It belongs to no server.')
    // ⚑ The pair, in the same sheet: a row that DOES belong to a server reports its word.
    m.q(ours('spawn_agent')).click()
    await nextTick()
    expect(m.q('tool-detail-connection').innerText).toBe('connected')
  })

  /**
   * ⛔ **A pane describing a row the filter has hidden is `279`'s name-for-an-absence**: everything
   * on screen agrees except the thing it is about.
   */
  it('a selection the filter hides does not keep the pane', async () => {
    const { m } = await open(CLAUDE)
    m.q(row('Bash')).click()
    await nextTick()
    expect(m.q('tool-detail-name').innerText).toBe('Bash')

    m.q('tools-filter-confirmed').click()
    await nextTick()
    expect(
      m.q('tool-detail-name').innerText,
      'the pane kept a row that is no longer listed',
    ).not.toBe('Bash')
    expect(m.q('tool-detail-name').innerText).toBe('mcp__brobot__list_agents')
  })
})

/* ─────────────────────────────────────────────────── §5 · the three absences, each its own state ── */

describe('§5 · what the workbench SAYS when there is little or nothing to say', () => {
  it('⚑ published — the join is drawn, and the built-ins are apart from ours', async () => {
    const { m } = await open(CLAUDE)
    expect(m.q('tools-reading').innerText).toBe('published')
    expect(m.q('tools-summary').innerText).toContain('3 of 3 BroCrew tools confirmed')
    // 37 published, of which 5 are ours — so 32 are the provider's own.
    expect(m.q('tools-summary').innerText).toContain('32 built-in')
    expect(m.q('tools-status-brobot:brobot').innerText).toBe('connected')
    expect(m.q('tools-provenance').innerText).toContain('Not from a config file')
    // ⛔ **The grouping this sheet must get right** (`M23`): the five are under BroBot's server and
    // the built-ins are not.
    const own = m.q('tools-group-brobot:brobot')
    expect(own.innerText).toContain('mcp__brobot__spawn_agent')
    expect(own.innerText).not.toContain('AskUserQuestion')
    expect(m.q('tools-group-builtin').innerText).toContain('AskUserQuestion')
    expect(m.q('tools-group-builtin').innerText).not.toContain('mcp__brobot__')
    // ⛔ **The built-ins are not a server, so they get no server's answer.** The first draft drew
    // *"the agent did not list this server"* over thirty-two provider tools — a sentence about a
    // connection, for a thing that has none.
    expect(m.q('tools-status-builtin').innerText).toContain('not a server')
    expect(m.q('tools-status-builtin').innerText).not.toContain('did not list')
    // ⚑ The pair: a real server in the same sheet DOES get its own word.
    expect(m.q('tools-status-brobot:brobot').innerText).toBe('connected')
  })

  it('⛔ unpublished — nothing is called confirmed, and the chip says the word it MEANS', async () => {
    const { m } = await open(CODEX)
    expect(m.q('tools-reading').innerText).toBe('unpublished')
    // 🔴 **This is the word `358` got wrong and `388` §2.3 asked for.** The old sheet drew `offered`
    // here — the FORMAL name of a different standing — so a Codex conversation's rows wore the
    // Claude failure state's name.
    expect(m.q(`tool-standing-brobot__spawn_agent`).innerText).toBe('unconfirmable')
    expect(m.q('tools-status-brobot:brobot').innerText).toContain('not reported by this provider')
    expect(m.q('tools-provenance').innerText).toContain('publishes no tool inventory')

    // ⛔ **No ROW is called confirmed** — scoped to the standing chips rather than to the whole
    // sheet, because the summary line legitimately says *"none confirmed by the provider"*.
    expect(
      [...m.q('session-tools').querySelectorAll('[data-cy^="tool-standing-"]')].map(
        (el) => (el as HTMLElement).innerText,
      ),
    ).toEqual(['unconfirmable', 'unconfirmable', 'unconfirmable'])
    // ⚑ …and the built-in group is absent rather than empty, because nothing was published.
    expect(m.all('tools-group-builtin')).toHaveLength(0)
    // The Codex spelling, drawn from the naming on the event.
    expect(m.q('tool-brobot__spawn_agent').innerText).not.toContain('mcp__')
  })

  it('⛔ untold — the sentence, and NO list at all', async () => {
    const { m } = await open(UNTOLD)
    expect(m.q('tools-reading').innerText).toBe('untold')
    expect(m.q('catalog-empty').innerText).toContain('Not reported yet')
    // ⛔ **Its own sentence, not a second copy of the provenance.** Review found the same forty
    // words printed twice on one screen, one under the other; the provenance is above the list and
    // this is the list's own empty state.
    expect(m.q('tools-provenance').innerText).toContain('has not been told')
    expect(m.q('catalog-empty').innerText).toContain('has not started')
    expect(m.q('catalog-empty').innerText).not.toBe(m.q('tools-provenance').innerText)
    expect(m.q('tools-summary').innerText).toBe('not reported yet')
    // ⛔ **And no search box either**: a control over a list that does not exist is a control that
    // can only ever say "no matches" about an absence.
    expect(m.all('tools-search')).toHaveLength(0)
    expect(m.all('tools-filters')).toHaveLength(0)
    expect(m.all('tools-shown')).toHaveLength(0)
    // ⚑ The pair: the same selectors DO find something when there is something to find.
    unmountAll()
    const other = await open(CLAUDE)
    expect(other.m.all('tools-search')).toHaveLength(1)
    expect(other.m.all('catalog-empty')).toHaveLength(0)
  })

  /**
   * 🔴 **The third absence, and it is the one an adapter is most likely to lose** (392 §4).
   * `published: {tools: []}` is the child ANSWERING and naming nothing; `published: null` is a
   * provider that never answers. `353`'s negative control — a launch with the toolset detached — is
   * exactly this reading.
   */
  it('⛔ an explicitly empty report is not the provider that publishes none', async () => {
    const empty = await open(EMPTY_REPORT)
    expect(empty.m.q('tools-reading').innerText).toBe('published')
    const answered = empty.m.q('catalog-empty').innerText
    expect(answered).toContain('No entries at all')
    expect(answered).toContain('answered and named no tool at all')
    expect(answered).toContain('That is a report, not a silence')

    unmountAll()
    const none = await open({
      set: { naming: CODEX_NAMING, declared: null, published: null },
      dropped: 0,
      at: STATED_AT,
    })
    expect(none.m.q('tools-reading').innerText).toBe('unpublished')
    const silent = none.m.q('catalog-empty').innerText
    expect(silent).toContain('publishes none of its own')
    // ⛔ **Three sentences, pairwise different.** The untold one is measured in the test above; this
    // is the pair that keeps the two REPORTED absences apart.
    expect(silent).not.toBe(answered)

    unmountAll()
    const untold = await open(UNTOLD)
    expect(untold.m.q('catalog-empty').innerText).not.toBe(answered)
    expect(untold.m.q('catalog-empty').innerText).not.toBe(silent)
  })

  /**
   * 🔴 **The one reading where "count the confirmed" and "count the declared" disagree** — every
   * other fixture on this surface confirms all three, so the summary's arithmetic is measured here
   * and nowhere else (`358` `M24`, and `a-comparison-tested-where-both-sides-agree-measures-nothing`).
   */
  it('⛔ a tool the agent did not list reads differently from one it did — and the count says so', async () => {
    const { m } = await open({
      set: {
        naming: CLAUDE_NAMING,
        declared: DECLARED,
        published: {
          tools: ['Bash', 'mcp__brobot__list_agents'],
          servers: [{ name: 'brobot', status: 'connected' }],
        },
      },
      dropped: 0,
      at: STATED_AT,
    })
    expect(m.q(`tool-standing-mcp__brobot__list_agents`).innerText).toBe('confirmed')
    expect(m.q(`tool-standing-mcp__brobot__spawn_agent`).innerText).toBe('not listed')
    // ⛔ `1 of 3`, not `3 of 3`.
    expect(m.q('tools-summary').innerText).toContain('1 of 3 BroCrew tools confirmed')
    // ⛔ **They are not the same colour either** — the whole point is that one of these is a
    // problem. Read off the composited style, because a class name matching nothing would still
    // satisfy a `toContain` on the markup.
    const good = getComputedStyle(m.q(`tool-standing-mcp__brobot__list_agents`)).color
    const bad = getComputedStyle(m.q(`tool-standing-mcp__brobot__spawn_agent`)).color
    expect(bad, 'a listed and an unlisted tool are drawn the same').not.toBe(good)
  })

  /**
   * 🔴 **The server a person opens this sheet BECAUSE of.** A configured MCP server that failed or
   * needs a sign-in publishes a status row and contributes no tool name, and the catalogue has a
   * row per tool — so the first cut drew nothing at all for it, while the provenance sentence
   * directly above the list promised *"every MCP server it connected to"*. `358` drew it with its
   * word and a `0`. Found in review.
   */
  it('⛔ a server the agent named and listed no tool under is still on screen, with its word', async () => {
    const { m } = await open(SILENT_SERVER)
    const group = m.q('tools-group-server:github')
    expect(group.innerText).toContain('github')
    expect(m.q('tools-status-server:github').innerText).toBe('needs sign-in')
    expect(group.innerText).toContain('listed no tool under it')
    // ⚑ …and it really has no rows, so this is the empty heading and not a group with a row in it.
    expect(group.querySelectorAll('.catalog-item')).toHaveLength(0)

    // ⛔ **The pair that keeps it from being an "empty headings are fine" rule**: a group whose rows
    // the FILTER hid disappears, because that heading would be a claim about the server rather than
    // about the search.
    await type(m.q('tools-search'), 'spawn')
    expect(m.all('tools-group-server:github')).toHaveLength(0)
  })

  /**
   * 🔴 **The mirror of `offered`, and the more alarming half** — the CHILD naming a tool in
   * BroBot's own namespace that BroBot's declaration does not carry.
   */
  it('⛔ what the agent named under BroBot’s server that BroBot did not declare has its own heading', async () => {
    const { m } = await open(CLAUDE)
    const strangers = m.q('tools-group-unclaimed:brobot')
    expect(strangers.innerText).toContain('not in BroCrew’s declaration')
    expect(strangers.innerText).toContain('mcp__brobot__message_agent')
    expect(strangers.innerText).toContain('nothing of ours to confirm them against')
    // ⛔ **NOT under the declared heading**, which says the opposite. Review found both sentences on
    // one row: a group reading "declared by BroBot" over a row saying BroBot never declared it.
    expect(m.q('tools-group-brobot:brobot').innerText).not.toContain('mcp__brobot__message_agent')
    expect(m.q('tools-group-brobot:brobot').innerText).toContain('mcp__brobot__spawn_agent')
    // …and the header says so too, in the words the truncation cannot make false.
    expect(m.q('tools-summary').innerText).toContain('2 the agent named that BroCrew’s declaration')

    // The detail pane agrees with the heading rather than contradicting it.
    m.q(ours('message_agent')).click()
    await nextTick()
    expect(m.q('tool-detail-source').innerText).toContain('declaration does not carry it')
    expect(m.q('tool-detail-standing').innerText).toContain('BroCrew did not declare this one')
    expect(m.all('tool-detail-standing-chip')).toHaveLength(0)
  })

  it('a cap that bit is stated out loud', async () => {
    const { m } = await open({ ...CLAUDE, dropped: 3 })
    expect(m.q('tools-dropped').innerText).toContain('3 rows')
    expect(m.q('tools-dropped').innerText).toContain('understating')
    unmountAll()
    const clean = await open(CLAUDE)
    expect(clean.m.all('tools-dropped')).toHaveLength(0)
  })

  it('says why this conversation has these, and says the scope out loud', async () => {
    const { m } = await open(CLAUDE)
    // ⚑ **In the body, not at the head of the 274px column** — `392` photographed it taking six
    // lines out of the catalogue, and it is a fact about the whole inventory rather than a note on
    // one group.
    expect(m.q('tools-why').innerText).toBe(
      'Every conversation gets the same tools, except write_agent_rules. ' +
        'Only a BroBot conversation a person started gets it, to change another agent’s rules. ' +
        'BroCrew still checks every call against its rules.',
    )
    expect(
      m.q('tools-list').contains(m.q('tools-why')),
      'the sentence is inside the scrolling catalogue again',
    ).toBe(false)
    // ⛔ **The scope is a sentence and not a picker** (392 §3.3): there is no child `ToolRegistry`.
    expect(m.q('tools-scope').innerText).toContain('This conversation only')
    expect(m.q('tools-scope').innerText).toContain('never assumed from its parent')
    expect(
      m.q('session-tools').querySelectorAll('select'),
      'a scope picker was drawn for a scope that does not exist',
    ).toHaveLength(0)
  })

  /**
   * 🔴 **Both vocabularies are on screen and neither is read off the other** (392 §2).
   */
  it('⛔ the key prints all six words, each with its own sentence', async () => {
    const { m } = await open(CLAUDE)
    // ⛔ A closed `<details>` has NO `innerText` at all, so every assertion below would have been
    // satisfied by an empty string. Opened first, and the emptiness is asserted as the control.
    expect(m.q('vocab-standing-confirmed').innerText, 'the key starts closed').toBe('')
    m.q('tools-vocabulary').setAttribute('open', '')
    await nextTick()
    const sentences = new Set<string>()
    for (const key of ['confirmed', 'offered', 'unconfirmable']) {
      const el = m.q(`vocab-standing-${key}`)
      expect(el.innerText, `${key} does not name itself`).toContain(key)
      sentences.add(el.innerText)
    }
    for (const key of ['untold', 'unpublished', 'published']) {
      const el = m.q(`vocab-reading-${key}`)
      expect(el.innerText, `${key} does not name itself`).toContain(key)
      sentences.add(el.innerText)
    }
    expect(sentences.size, 'two of the six words share a sentence').toBe(6)
  })
})

/* ─────────────────────────────────────── §6 · what this surface may never grow, as a census ────── */

describe('§6 · a read-only explorer, enforced rather than intended (392 §3.1)', () => {
  /**
   * 🔴 **A CLOSED vocabulary of every control this sheet may draw, and the rows are named rather
   * than excluded by a class.**
   *
   * ⛔ **Not a `not.toContain('Enable')`.** The shape of answer such a search could find is one
   * spelling of one word; the shape this finds is *any interactive element whose purpose nobody has
   * admitted*. ⚠️ **Two things review had to fix here.** The first version enumerated only
   * `<button>` and dropped anything carrying the `catalog-item` CLASS — so the one control the
   * brief forbids, written as `<button class="catalog-item" data-cy="run-tool">`, walked straight
   * past it. The rows are now named from the FIXTURE'S OWN catalogue, so a row is admitted because
   * it is one of the entries this reading has and for no other reason.
   */
  const ADMITTED = new Set([
    'close-overlay',
    'tools-clear-filters',
    'tools-clear-from-empty',
    'tools-filter-all',
    'tools-filter-confirmed',
    'tools-filter-offered',
    'tools-filter-unconfirmable',
    'tool-back',
    'tools-search',
  ])

  /** Every element a person can operate, not every `<button>`. */
  const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [contenteditable]'

  function unadmitted(sheet: HTMLElement, tools: ToolRegistry): string[] {
    const rows = new Set(catalogue(readInventory(tools)).map((entry) => `tool-${entry.key}`))
    return [...sheet.querySelectorAll<HTMLElement>(INTERACTIVE)]
      .map((el) => el.getAttribute('data-cy') ?? `(no data-cy) <${el.tagName.toLowerCase()}>`)
      .filter((cy) => !rows.has(cy) && !ADMITTED.has(cy))
  }

  /**
   * ⛔ **Four render states, because the first version walked ONE** — and three of its eight
   * admitted names were never on screen while it did. A control that only appears once something
   * is filtered, or only on an unpublished reading, was outside the census entirely.
   */
  const STATES: [
    string,
    ToolRegistry,
    (m: Awaited<ReturnType<typeof open>>['m']) => Promise<void>,
  ][] = [
    ['published, unfiltered', WITH_FOREIGN, async () => {}],
    [
      'published, filtered to nothing',
      WITH_FOREIGN,
      async (m) => {
        await type(m.q('tools-search'), 'zzzz')
      },
    ],
    [
      'unpublished, one chip picked',
      CODEX,
      async (m) => {
        m.q('tools-filter-unconfirmable').click()
        await nextTick()
      },
    ],
    ['untold, no list at all', UNTOLD, async () => {}],
  ]

  it('⚑ the admitted vocabulary really is the nine the titles below name', () => {
    // ⛔ `a-title-that-names-a-count-the-assertion-never-checks` — the number in the four titles
    // below is checked here rather than only written there.
    expect(ADMITTED.size).toBe(9)
  })

  it.each(STATES)(
    '⛔ every control in the workbench is a row or one of nine named affordances — %s',
    async (_label, tools, drive) => {
      const { m, sheet } = await open(tools)
      await drive(m)
      expect(
        sheet.querySelectorAll(INTERACTIVE).length,
        'nothing interactive at all, so this census measures nothing',
      ).toBeGreaterThan(0)
      expect(unadmitted(sheet, tools), 'a control nobody admitted is in the workbench').toEqual([])
    },
  )

  /**
   * ⛔ **The control PLANTS, and it plants TWO** (standing rule 12). The first version filtered two
   * string literals through `ADMITTED.has` and touched no element at all — a tautology that could
   * only fail if somebody added `run-tool` to the admitted set itself. These are real elements, in
   * the real sheet, in the two shapes the walk could have been blind to.
   */
  it('…and the census sees BOTH of two controls nobody admitted', async () => {
    const { sheet } = await open(WITH_FOREIGN)
    expect(unadmitted(sheet, WITH_FOREIGN), 'the sheet starts clean').toEqual([])

    // (a) A button wearing a catalogue row's own class — what the first version excluded by class.
    const run = document.createElement('button')
    run.className = 'catalog-item'
    run.setAttribute('data-cy', 'run-tool')
    run.textContent = 'Run'
    sheet.querySelector('[data-cy="tools-list"]')!.append(run)

    // (b) A control that is not a `<button>` at all — what the first version never enumerated.
    const toggle = document.createElement('input')
    toggle.type = 'checkbox'
    toggle.setAttribute('data-cy', 'disable-tool')
    sheet.querySelector('[data-cy="tool-detail"]')!.append(toggle)
    await nextTick()

    expect(unadmitted(sheet, WITH_FOREIGN).sort()).toEqual(['disable-tool', 'run-tool'])
  })

  /**
   * ⛔ **`origin` never crosses into this app** (382), and v2.5.1 renders, searches AND filters on
   * it. ⚠️ The search shape is *"any rendered text or attribute carrying the word"*, over a fixture
   * that has all four sources — not a check that one named element is missing.
   */
  it('⛔ nothing on the surface is an origin, in any of the four sources', async () => {
    const { m, sheet } = await open(CLAUDE)
    m.q('tools-vocabulary').setAttribute('open', '')
    await nextTick()

    /**
     * ⛔ **Text and ATTRIBUTES, and deliberately not `innerHTML`.** A comment is in the markup and
     * on no surface, and this file's own explanation of why there is no origin row cites the word —
     * `a-source-census-must-strip-prose-before-it-asserts`, found here by an `innerHTML` sweep that
     * went red on the sentence saying the field was removed.
     */
    const surface = (): string[] => {
      const out: string[] = []
      for (const el of [sheet, ...sheet.querySelectorAll('*')]) {
        for (const attribute of el.attributes) out.push(attribute.value)
        for (const node of el.childNodes)
          if (node.nodeType === Node.TEXT_NODE) out.push(node.textContent ?? '')
      }
      return out
    }

    // The fixture really does reach all four sources, or the sweep is over three of them.
    expect([...new Set(catalogue(readInventory(CLAUDE)).map((e) => e.source))].sort()).toEqual([
      'brobot',
      'builtin',
      'unclaimed',
    ])
    expect(
      surface().filter((text) => text.toLowerCase().includes('origin')),
      'the workbench is drawing a field the product does not carry',
    ).toEqual([])
    expect(surface().length, 'the sweep read nothing, so it proves nothing').toBeGreaterThan(50)

    // ⚑ The control, in BOTH shapes the sweep reads — a sweep blind to either half would pass a
    // surface that carried the word in the other.
    m.q('tools-scope').append(document.createTextNode(' origin'))
    m.q('tools-search').setAttribute('placeholder', 'name, description or origin…')
    await nextTick()
    expect(surface().filter((text) => text.toLowerCase().includes('origin'))).toHaveLength(2)
  })
})

/* ──────────────────────────────────────────────── §7 · the narrow layout, and the way back ────── */

describe('§7 · at 460px it is a list OR a detail, with a Back (392 §5)', () => {
  it('⛔ one pane at a time, and Back returns to the list', async () => {
    const { m } = await open(CLAUDE, 460, 760)
    const list = m.q('tools-list')
    const detail = m.q('tool-detail')
    expect(visible(list), 'the list is what a narrow sheet opens on').toBe(true)
    expect(visible(detail), 'both panes are on screen at 460px').toBe(false)

    m.q(ours('spawn_agent')).click()
    await nextTick()
    expect(visible(m.q('tool-detail'))).toBe(true)
    // ⚠️ `display: none` leaves the node in the DOM, so the question is what a person can SEE —
    // `toHaveLength(0)` here would have been a test about the markup rather than about the layout.
    expect(visible(m.q('tools-list')), 'both panes are on screen at 460px').toBe(false)
    expect(m.q('tool-detail-name').innerText).toBe('mcp__brobot__spawn_agent')

    const back = m.q('tool-back')
    expect(visible(back), 'there is no way back out of the detail').toBe(true)
    back.click()
    await nextTick()
    expect(visible(m.q('tools-list'))).toBe(true)
    expect(visible(m.q('tool-detail'))).toBe(false)
  })

  /**
   * 🔴 **The trap review found: the way back disappearing exactly when it is needed.** Below the
   * breakpoint the catalogue is hidden while this pane shows; if the filter empties the list, the
   * selection goes with it and the detail falls to its own empty state — which, with the button
   * drawn inside the `v-else`, had no exit at all.
   */
  it('⛔ the way back survives the selection it was beside', async () => {
    const { m } = await open(CLAUDE, 460, 760)
    m.q(ours('spawn_agent')).click()
    await nextTick()
    expect(visible(m.q('tools-list'))).toBe(false)

    await type(m.q('tools-search'), 'zzzz-no-such-tool')
    expect(
      m.all('tool-detail-name'),
      'the selection survived a filter that matches nothing',
    ).toHaveLength(0)
    expect(visible(m.q('tool-detail-empty')), 'the detail pane is the one on screen').toBe(true)
    expect(visible(m.q('tools-list')), 'the catalogue is still hidden, so this is the trap').toBe(
      false,
    )

    const back = m.q('tool-back')
    expect(visible(back), 'there is no way out of the detail pane').toBe(true)
    back.click()
    await nextTick()
    expect(visible(m.q('tools-list'))).toBe(true)
  })

  it('⚑ and at 1200px both panes are on screen, so Back would be a control that does nothing', async () => {
    const { m } = await open(CLAUDE, 1200, 808)
    expect(visible(m.q('tools-list'))).toBe(true)
    expect(visible(m.q('tool-detail'))).toBe(true)
    m.q(ours('spawn_agent')).click()
    await nextTick()
    expect(visible(m.q('tools-list')), 'selecting a row hid the list at full width').toBe(true)
    expect(
      visible(m.q('tool-back')),
      'a Back button is on screen beside the list it goes back to',
    ).toBe(false)
  })
})

/* ────────────────────────────────────────────────────────── §8 · it is on paper because hosted ── */

/**
 * ⛔ **The scheme is INHERITED** (344/346). The sheet declares no `data-chat-theme`; `OverlayHost`
 * carries it, and this asserts that what actually paints is the light scope.
 */
describe('§8 · it is on paper because it is hosted, not because it says so', () => {
  it('carries no scope of its own, and the host carries exactly one', async () => {
    const { m, sheet } = await open(CLAUDE)
    expect(sheet.getAttribute('data-chat-theme'), 'the sheet declares no scope').toBeNull()
    expect(m.q('overlay-host').getAttribute('data-chat-theme')).toBe('light')
    expect(sheet.querySelectorAll('[data-chat-theme]')).toHaveLength(0)
  })
})

/* ────────────────────────────────────────────────────────────────────── §9 · reaching the sheet ── */

/**
 * 🔴 **The door — the half of `358` that answers *"I could not find them."***
 *
 * ⚠️ **Mounted through `ConversationPane`, not through `SessionHeader` alone.** The pane owns the
 * `OverlayHost` and the `toolsFor` guard; a test that emitted the event on the header would prove
 * the button emits and nothing about what opens.
 */
describe('§9 · reaching the workbench from the conversation (358)', () => {
  const withTools = (tools: ToolRegistry, events: TranscriptEvent[] = []): SessionRecord => {
    const r = record([{ type: 'status', state: 'idle' } as never, ...events])
    r.control.tools = tools
    return r
  }

  it('⛔ the button carries BroBot’s own count — not the published total — and opens the workbench', async () => {
    await page.viewport(1200, 808)
    const m = mount(ConversationPane, paneProps({ record: withTools(CLAUDE) }), {
      width: 1200,
      height: 808,
    })
    await nextTick()

    // ⛔ **The count is BroBot's own — three in this fixture.** `PUBLISHED_37` carries 37 names, of
    // which 32 are the provider's built-ins; a `37` here would count those as ours.
    expect(m.q('session-tools-count').innerText).toBe('3')
    const hover = m.q('open-session-tools').getAttribute('title') ?? ''
    expect(hover).toContain('3 of 3 BroCrew tools')
    // 🔴 **…and WHEN that was true** (444 relay 1). ⛔ The number in the chip stays bare — a
    // timestamp in a 20px badge is not readable — so the bar's hover is the only place on this
    // surface that can carry the moment, and a count with no moment is the whole defect.
    expect(hover, 'the bar says how many and not of when').toContain(
      String(new Date(STATED_AT).getFullYear()),
    )
    expect(hover).toContain('Stated')
    expect(m.all('session-tools')).toHaveLength(0)

    m.q('open-session-tools').click()
    await nextTick()
    expect(m.all('session-tools')).toHaveLength(1)
    expect(visible(m.q('session-tools'))).toBe(true)
    expect(m.q('tools-title').innerText).toBe('Inventory workbench')
    expect(m.q('tools-read-only').innerText.toLowerCase()).toContain('read-only')

    // …and the overlay's own ✕ closes it, which is the chrome `OverlayHost` promises.
    m.q('close-overlay').click()
    await nextTick()
    expect(m.all('session-tools')).toHaveLength(0)
  })

  it('⛔ no button at all when nothing has been reported — absent, never `0`', async () => {
    await page.viewport(1200, 808)
    const m = mount(ConversationPane, paneProps({ record: withTools(UNTOLD) }), {
      width: 1200,
      height: 808,
    })
    await nextTick()
    expect(m.all('open-session-tools')).toHaveLength(0)
    // ⚑ The pair: the very same mount DOES draw it when there is something to say.
    const other = mount(ConversationPane, paneProps({ record: withTools(CODEX) }), {
      width: 1200,
      height: 808,
    })
    await nextTick()
    expect(other.q('session-tools-count').innerText).toBe('3')
  })

  it('the count is quiet — it must not borrow the amber that means “you are blocked”', async () => {
    await page.viewport(1200, 808)
    // ⛔ **A card really waiting**: the attention badge is `v-if="props.waiting > 0"` and `waiting`
    // is DERIVED by the pane, so a fixture without one makes the comparison unreachable.
    const m = mount(
      ConversationPane,
      paneProps({
        record: withTools(CLAUDE, [
          permission('req_1'),
          { type: 'status', state: 'waiting_permission' } as TranscriptEvent,
        ]),
      }),
      { width: 1200, height: 808 },
    )
    await nextTick()

    const badge = m.q('session-panel-badge')
    expect(
      visible(badge),
      'the attention badge must be on screen or this test compares nothing',
    ).toBe(true)
    const count = getComputedStyle(m.q('session-tools-count')).color
    expect(count, 'the tools count borrowed the attention badge’s ink').not.toBe(
      getComputedStyle(badge).color,
    )
    expect(count, 'the count is drawn in something').not.toBe('')
  })
})

/* ══════════════════════════════════ §10 · the count says WHEN it was true (444 relay 1) ══════ */

/**
 * 🔴 **A count that does not say when it was true** (444 relay 1).
 *
 * ⛔ **The observation.** A conversation started before `441` showed **15** tools and a new one
 * showed **16**; then the old one showed `create_project` too, once it was reopened. ⚑ Nothing was
 * broken — `agentToolsFor` runs at launch and at reopen and nowhere else, so a live conversation
 * keeps the set it was built with, and the fold's assignment lets the newest row win. 🔴 **The
 * defect was that no surface said of WHICH instant its number was true.**
 *
 * ⚠️ **Painted, because it is a chip a person has to be able to read.** A register the SSR string
 * contains and the window does not draw is a register nobody has (`brobot2-ssr-tests-pass-vacuously`).
 */
describe('§10 · the inventory says as-of-when (444 relay 1)', () => {
  it('🔴 the moment and its register are on screen, with no click', async () => {
    const { m } = await open(CLAUDE)
    const line = m.q('tools-as-of')
    expect(visible(line), 'the as-of line is not on screen').toBe(true)

    const chip = m.q('tools-register')
    expect(visible(chip)).toBe(true)
    // ⛔ **A chip with no words is a layer with no register**, whatever the projection says.
    expect((chip.textContent ?? '').trim()).toBe('observed')
    const box = chip.getBoundingClientRect()
    expect(box.width).toBeGreaterThan(30)
    expect(box.height).toBeGreaterThan(8)

    // …and the sentence beside it names the act, and the act that does not work.
    const said = m.q('tools-as-of-moment').textContent ?? ''
    expect(said).toContain('reopening it is what makes this current')
    expect(said).toContain('Reloading the window does not')
    // ⛔ Derived from the instant the fixture states, never typed here.
    expect(said).toContain(String(new Date(STATED_AT).getFullYear()))
  })

  /**
   * ⛔ **Nothing stated ⇒ nothing drawn.** This is what survives of this file's own rule 4 —
   * *"no invented time"* — after `444` filled the hole: an absent moment is silence, never
   * *"Time not reported"* and never a zero.
   */
  it('⛔ a conversation nobody has told us about draws no moment at all', async () => {
    const { m } = await open(UNTOLD)
    expect(m.host.querySelector('[data-cy="tools-as-of"]')).toBeNull()
    expect(m.host.querySelector('[data-cy="tools-register"]')).toBeNull()
    // ⚑ **The pair, in the same test**: the provenance sentence IS drawn, so the sheet rendered
    // and the absence above is the moment's rather than the whole block's.
    expect(visible(m.q('tools-provenance'))).toBe(true)
    expect(m.q('tools-provenance').textContent).toContain('has not been told')
  })

  /**
   * ⛔ **And a moment the formatter refuses draws nothing on screen either** (444, found
   * reviewing this diff). ⚠️ A guard on `null` alone let a NaN through as the fragment
   * `Stated .` — non-null, so `v-if="asOf !== null"` fired and the sheet drew it. This is the
   * mount that would have caught it.
   */
  it('⛔ a moment the formatter refuses draws no line at all', async () => {
    const { m } = await open({ ...CLAUDE, at: Number.NaN })
    expect(m.host.querySelector('[data-cy="tools-as-of"]')).toBeNull()
    // ⚑ The pair: the same fixture with a real moment DOES draw one, so the absence is the NaN's.
    unmountAll()
    const good = await open(CLAUDE)
    expect(visible(good.m.q('tools-as-of'))).toBe(true)
  })

  /**
   * ⚑ **THE PAIRED SAMPLE the relay asked for**: a conversation that has never been reopened shows
   * the moment of its launch, and one that has shows the newer row's. ⛔ Both drawn, in one test,
   * and the two moments must DIFFER — an equality against one re-read of a moving field measures
   * nothing.
   */
  it('🔴 a reopened conversation draws the newer moment, and a never-reopened one does not', async () => {
    const LATER = STATED_AT + 600_000
    const launched = await open(CLAUDE)
    const first = launched.m.q('tools-as-of-moment').textContent ?? ''
    unmountAll()

    const reopened = await open({ ...CLAUDE, at: LATER })
    const second = reopened.m.q('tools-as-of-moment').textContent ?? ''

    expect(first.length, 'the launch reading drew no moment').toBeGreaterThan(0)
    expect(second, 'the moment did not move when the row did').not.toBe(first)
    // ⛔ …and the SENTENCE is the same one on both — the moment moves, the explanation does not.
    for (const said of [first, second]) {
      expect(said).toContain('reopening it is what makes this current')
    }
  })
})
