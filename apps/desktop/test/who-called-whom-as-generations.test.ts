import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { forestView, type ForestView } from '../src/renderer/src/lib/the-forest'
import { forestGraph, waitsOnIt, type GraphNode } from '../src/renderer/src/lib/forest-graph'
import { OPEN_IN_ANOTHER_WINDOW } from '../src/renderer/src/lib/taking-over'
import {
  STANDING_LABEL,
  standingOf,
  type AgentFacets,
  type RailSays,
} from '../src/renderer/src/lib/agent-state'
import type { ForestNode, TheWholeForest } from '../src/shared/the-whole-forest'

/**
 * # 🔴 668 · *Who called whom*, drawn as generations — and every node opens
 *
 * The graph groups BroBot conversations and successive generations vertically. Pressing a
 * stopped agent must open its conversation and show the current state without requiring a
 * manual reopen and return to the page.
 *
 * ⛔ **This file owns what can be decided without a screen**: the placement (`forest-graph.ts`), the
 * one fact about where each node is, the live plate a held conversation wears, and the screen's
 * WIRING, read from its source with prose stripped. ⚑ **D-017b** — a node no longer presses a
 * gesture per process state: every press opens the conversation in its one full view, so `668`'s
 * gesture table (§2) and the closed press it routed through (`closed-press.ts`, §5) went with it. ⚑ **What a person SEES** — pixels, the press reaching
 * its act, the ring following a reopen without a remount — is
 * `test/dom/who-called-whom-as-generations.dom.test.ts`.
 */

const here = dirname(fileURLToPath(import.meta.url))
const COMPONENTS = join(here, '..', 'src', 'renderer', 'src', 'components')
const NOW = 1_800_000_000_000

const conv = (id: string, parent: string | null, over: Record<string, unknown> = {}): ForestNode =>
  ({
    node: 'a-conversation',
    conversation: id,
    under: parent === null ? { is: 'the-person' } : { is: 'a-conversation', conversation: parent },
    identity: id.replace('sess_', ''),
    provider: 'claude',
    status: 'idle',
    running: 'not-running',
    standsInFor: [],
    inItsPlace: null,
    startedAt: NOW - 60_000,
    updatedAt: NOW - 1_000,
    ...over,
  }) as ForestNode

const task = (holder: string, id: string, number: number): ForestNode =>
  ({
    node: 'a-task',
    under: { is: 'a-conversation', conversation: holder },
    givenBy: { is: 'the-person' },
    work: {
      piece: id,
      label: `W1.${String(number)}`,
      title: `request ${id}`,
      from: null,
      fromIdentity: null,
      to: holder,
      toIdentity: holder.replace('sess_', ''),
      state: 'working',
      givenAt: NOW - 30_000,
      endedAt: null,
    },
  }) as unknown as ForestNode

const forestOf = (rows: readonly ForestNode[]): TheWholeForest =>
  ({
    readAt: NOW,
    nodes: {
      rows,
      walk: 'every-conversation-this-app-placed',
      ledgers: rows.filter((r) => r.node === 'a-conversation').length,
      rowsUnread: 0,
    },
    conversations: rows.filter((r) => r.node === 'a-conversation').length,
    heldByNoAgent: 0,
  }) as unknown as TheWholeForest

const viewOf = (
  rows: readonly ForestNode[],
  over: { held?: readonly string[]; said?: ReadonlyMap<string, RailSays> | null } = {},
): ForestView =>
  forestView({
    forest: forestOf(rows),
    atWork: null,
    waits: null,
    identities: null,
    held: new Set(over.held ?? []),
    ...(over.said === undefined ? {} : { said: over.said }),
  })!

/**
 * The fixture has two BroBot conversations; the second starts Ana, Anh, and Ada, and Ada
 * starts Amara and Ali. Tasks are interleaved in fold order, so a task appearing after a
 * child’s row must not be attributed to the parent.
 */
const FAMILY: ForestNode[] = [
  conv('sess_b1', null, { running: 'in-a-window' }),
  conv('sess_b2', null),
  conv('sess_ana', 'sess_b2'),
  task('sess_ana', 'task_ana1', 1),
  task('sess_ana', 'task_ana2', 2),
  conv('sess_anh', 'sess_b2'),
  task('sess_anh', 'task_anh1', 1),
  conv('sess_ada', 'sess_b2'),
  task('sess_ada', 'task_ada1', 1),
  conv('sess_amara', 'sess_ada'),
  task('sess_amara', 'task_amara3', 3),
  conv('sess_ali', 'sess_ada'),
  task('sess_ali', 'task_ali2', 2),
  task('sess_ali', 'task_ali5', 5),
]

const nodeOf = (nodes: readonly (readonly GraphNode[])[], id: string): GraphNode => {
  const found = nodes.flat().find((node) => node.row.conversation === id)
  expect(found, `${id} is not in the graph`).toBeDefined()
  return found!
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the placement
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · generations, top to bottom, each parent over its children', () => {
  it('🔴 row 1 is what a person started; row n+1 what row n started — the person’s family', () => {
    const graph = forestGraph(viewOf(FAMILY))
    const names = graph.generations.map((row) => row.map((node) => node.row.conversation))
    expect(names).toEqual([
      ['sess_b1', 'sess_b2'],
      ['sess_ana', 'sess_anh', 'sess_ada'],
      ['sess_amara', 'sess_ali'],
    ])
    // ⚑ each node knows its parent, and the parent is in the row above
    for (const [g, row] of graph.generations.entries()) {
      for (const node of row) {
        expect(node.generation).toBe(g)
        if (g === 0) expect(node.parent).toBeNull()
        else
          expect(graph.generations[g - 1]!.map((up) => up.row.conversation)).toContain(node.parent)
      }
    }
  })

  it('🔴 a parent sits at the centre of its children; a leaf takes one slot — the tidy placement', () => {
    const graph = forestGraph(viewOf(FAMILY))
    const at = (id: string): number => nodeOf(graph.generations, id).centre
    // b1 is a leaf in slot 0; b2 spans Ana, Anh and Ada's two — slots 1 to 5
    expect(at('sess_b1')).toBe(0.5)
    expect([at('sess_ana'), at('sess_anh'), at('sess_ada')]).toEqual([1.5, 2.5, 4])
    expect([at('sess_amara'), at('sess_ali')]).toEqual([3.5, 4.5])
    expect(at('sess_b2')).toBe(3)
    expect(graph.slots).toBe(5)
    // ⛔ **the claim, in general**: every parent's centre is the midpoint of its children's outer edges
    for (const node of graph.generations.flat()) {
      const kids = graph.generations.flat().filter((kid) => kid.parent === node.row.conversation)
      if (kids.length === 0) continue
      const span = (kid: GraphNode): [number, number] => {
        const leaves = graph.generations
          .flat()
          .filter((one) => one.parent === kid.row.conversation).length
        const width = Math.max(1, leaves)
        return [kid.centre - width / 2, kid.centre + width / 2]
      }
      const left = Math.min(...kids.map((kid) => span(kid)[0]))
      const right = Math.max(...kids.map((kid) => span(kid)[1]))
      expect(node.centre, node.row.conversation).toBe((left + right) / 2)
    }
    // ⚑ every centre is a half — what lets the component draw a row as ONE half-slot grid
    for (const node of graph.generations.flat()) expect((node.centre * 2) % 1).toBe(0)
  })

  it('⛔ the CONTROL — siblings share a row, and a single child sits exactly under its parent', () => {
    const graph = forestGraph(viewOf([conv('sess_p', null), conv('sess_only', 'sess_p')]))
    expect(nodeOf(graph.generations, 'sess_only').centre).toBe(
      nodeOf(graph.generations, 'sess_p').centre,
    )
    const siblings = forestGraph(
      viewOf([conv('sess_p', null), conv('sess_x', 'sess_p'), conv('sess_y', 'sess_p')]),
    )
    expect(siblings.generations[1]!.map((node) => node.row.conversation)).toEqual([
      'sess_x',
      'sess_y',
    ])
  })

  it('🔴 each task stays on the conversation that HOLDS it — never on its parent', () => {
    const graph = forestGraph(viewOf(FAMILY))
    const tasksOf = (id: string): string[] =>
      nodeOf(graph.generations, id).tasks.map((row) => row.key)
    expect(tasksOf('sess_ana')).toEqual(['task_ana1', 'task_ana2'])
    expect(tasksOf('sess_ada')).toEqual(['task_ada1'])
    expect(tasksOf('sess_ali')).toEqual(['task_ali2', 'task_ali5'])
    expect(tasksOf('sess_b2')).toEqual([])
    // ⚑ none lost, none doubled
    const drawn = graph.generations.flat().flatMap((node) => node.tasks.map((row) => row.key))
    expect(drawn.sort()).toEqual(
      FAMILY.filter((row) => row.node === 'a-task')
        .map((row) => (row.node === 'a-task' ? row.work.piece : ''))
        .sort(),
    )
  })

  it('⚑ one line per child, from its parent’s centre to its own, in the band above its row', () => {
    const graph = forestGraph(viewOf(FAMILY))
    expect(graph.edges).toHaveLength(5)
    for (const edge of graph.edges) {
      const child = nodeOf(graph.generations, edge.child)
      const parent = nodeOf(graph.generations, child.parent!)
      expect(edge).toEqual({
        generation: child.generation,
        from: parent.centre,
        to: child.centre,
        child: edge.child,
      })
    }
  })

  it('⛔ depth is unbounded — a chain of 3,000 folds and places without a stack a person’s data could overflow', () => {
    // ⚠️ **Through the FOLD as well as the placement** — the fold's own comment said *iterative*
    // while it recursed, and this chain is what found it (`668`). The bound today is 500.
    const chain = Array.from({ length: 3000 }, (_, i) =>
      conv(`sess_${i}`, i === 0 ? null : `sess_${i - 1}`),
    )
    const view = viewOf(chain)
    expect(view.rows.map((row) => row.depth)).toEqual(chain.map((_, i) => i))
    const graph = forestGraph(view)
    expect(graph.generations).toHaveLength(3000)
    expect(graph.slots).toBe(1)
    expect(graph.generations[2999]![0]!.centre).toBe(0.5)
  })

  it('⚑ the fold’s order is PRE-order — a parent, its tasks, then each child’s whole family in turn', () => {
    expect(viewOf(FAMILY).rows.map((row) => row.key)).toEqual([
      'sess_b1',
      'sess_b2',
      'sess_ana',
      'task_ana1',
      'task_ana2',
      'sess_anh',
      'task_anh1',
      'sess_ada',
      'task_ada1',
      'sess_amara',
      'task_amara3',
      'sess_ali',
      'task_ali2',
      'task_ali5',
    ])
  })

  it('⚑ an empty reading is an empty graph, one slot wide — never a throw', () => {
    const graph = forestGraph(viewOf([]))
    expect(graph).toEqual({ generations: [], edges: [], slots: 1 })
  })

  it('⚠️ a conversation whose starter this reading did not draw is in the FIRST row, and says so', () => {
    const view = viewOf([
      conv('sess_orphan', null, {
        under: { is: 'a-conversation-this-reading-did-not-draw', conversation: 'sess_gone' },
      }),
    ])
    const graph = forestGraph(view)
    const node = nodeOf(graph.generations, 'sess_orphan')
    expect(node.generation).toBe(0)
    expect(node.row.conversationRow?.parentNotDrawn).toBe('sess_gone')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · every node presses what the rest of the app presses
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · where the conversation IS — the one fact a node says', () => {
  /**
   * 🔴 **668 handed each node a gesture off its running state and this window's `held`** — open,
   * take over, show, or none. ⚑ **D-017b** — every node presses the one open, so what the fold
   * still hands a node from those two inputs is the one fact a person acts on: another window has
   * it open, and a message from here would be refused there (`openElsewhere`).
   */
  it('🔴 the fold says another window has it open — and only of the one another window holds', () => {
    const view = viewOf(
      [
        conv('sess_closed', null, { running: 'not-running' }),
        conv('sess_unwatched', null, { running: 'unwatched' }),
        conv('sess_mine', null, { running: 'in-a-window' }),
        conv('sess_theirs', null, { running: 'in-a-window' }),
      ],
      { held: ['sess_mine'] },
    )
    const row = (id: string) => view.rows.find((one) => one.conversation === id)?.conversationRow
    for (const id of ['sess_closed', 'sess_unwatched', 'sess_mine']) {
      expect(row(id)?.elsewhere, id).toBe(false)
      expect(row(id)?.whereSays, id).toBeNull()
    }
    // ⚑ **The one that differs**, so the loop above compared something.
    expect(row('sess_theirs')?.elsewhere).toBe(true)
    expect(row('sess_theirs')?.whereSays).toBe(OPEN_IN_ANOTHER_WINDOW)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · the plate of a conversation this window holds is its own record
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · the rail’s plate — the person’s dotted ring, and UI-004’s one word table', () => {
  const idle: AgentFacets = { doing: 'idle', being: 'live' }

  it('🔴 a reopened conversation the poll has not caught up with draws the RAIL’s plate and word', () => {
    // ⚑ the poll's answer, as it stood when he came back: running, and not yet named by a reading
    const rows = [conv('sess_ada', null, { running: 'in-a-window' }), task('sess_ada', 't1', 1)]
    const stale = viewOf(rows)
    expect(stale.rows[0]!.facets.doing, 'the premise: the poll alone draws the dashed ring').toBe(
      'unknown',
    )
    expect(stale.rows[0]!.says).toBe(STANDING_LABEL[standingOf(stale.rows[0]!.facets)])
    const railed = viewOf(rows, {
      held: ['sess_ada'],
      said: new Map([['sess_ada', { facets: idle, word: 'idle' }]]),
    })
    // ⛔ `toBe` — the rail row's own facets, never a copy that happens to agree
    expect(railed.rows[0]!.facets).toBe(idle)
    // ⚑ UI-004 · the rail's word, not the forest's own table
    expect(railed.rows[0]!.says).toBe('idle')
    // ⚑ and the task row under it carries them — a view-model fact, drawn by no plate since `668`
    expect(railed.rows[1]!.facets).toBe(idle)
  })

  it('⛔ a rail on screen that does not name a conversation draws it faceless and wordless — no rail, the poll', () => {
    const rows = [conv('sess_ada', null, { running: 'in-a-window' })]
    const unnamed = viewOf(rows, { said: new Map([['sess_ali', { facets: idle, word: 'idle' }]]) })
    expect(unnamed.rows[0]!.facets).toEqual({})
    expect(unnamed.rows[0]!.says).toBeNull()
    // ⚑ The pair, one fact over: no rail on screen at all, and the poll answers as before.
    for (const said of [undefined, null]) {
      const polled = viewOf(rows, said === undefined ? {} : { said })
      expect(polled.rows[0]!.facets.doing).toBe('unknown')
      expect(polled.rows[0]!.says).toBe(STANDING_LABEL[standingOf(polled.rows[0]!.facets)])
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · the screen's wiring, read from its source
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** ⚑ Code only — a docblock quoting a call is not a call. */
const code = (source: string): string =>
  source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

/** ⚑ The body of `name: () => { … }` in an object literal, by brace counting. */
function armOf(source: string, name: string): string {
  const start = source.indexOf(`${name}: () => {`)
  expect(start, `no ${name} arm`).toBeGreaterThan(-1)
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    if (source[i] === '}') depth -= 1
    if (depth === 0) return source.slice(start, i + 1)
  }
  throw new Error(`${name} arm never closes`)
}

describe('§4 · RuntimeScreen follows the change, and routes every press to the one open', () => {
  const screen = code(readFileSync(join(COMPONENTS, 'RuntimeScreen.vue'), 'utf8'))

  it('⚑ the arm reader finds each arm by name — the control plants TWO', () => {
    const planted = 'x({\n  a: () => {\n    one()\n  },\n  b: () => {\n    two()\n  },\n})'
    expect(armOf(planted, 'a')).toContain('one()')
    expect(armOf(planted, 'a')).not.toContain('two()')
    expect(armOf(planted, 'b')).toContain('two()')
  })

  it('🔴 when the host says conversations or work moved, the forest is read again', () => {
    for (const subject of ['conversations', 'work']) {
      expect(armOf(screen, subject), subject).toMatch(/\breadWhoIsWorking\(\)/)
    }
  })

  it('🔴 the forest is handed the rail’s rows — every card the rail’s plate and word (UI-004)', () => {
    // ⚑ **2026-09-30 · one fold for both drawings of the forest** — the Team page's and the main
    // panel's Graph tab — so the rules below are read off that one function, and both views are
    // proved to be folded by it.
    expect(screen).toMatch(
      /const theForestView = computed\(\(\) => foldTheForest\(theForest\.value, beingDone\.value\)\)/,
    )
    expect(screen).toMatch(/const conversationForestView = computed\(\(\) =>\s*foldTheForest\(/)
    const start = screen.indexOf('function foldTheForest(')
    expect(start).toBeGreaterThan(-1)
    const body = screen.slice(start, screen.indexOf('\n}\n', start))
    // ⚑ **UI-004** — the rail's rows (`668`'s `live` plate for a held conversation is one of them),
    // so the Graph moves on D-019's push. ⛔ And no second derivation in the fold.
    expect(body).toMatch(/said:\s*cast\.railSays\.value/)
    expect(body).not.toMatch(/recordFacets\(/)
    // ⚑ **D-006** · the rail derives a held conversation's row from its record, the wait and where
    // the work it holds stands — both off the screen's one reading of the waits
    const rail = code(readFileSync(join(COMPONENTS, 'SideRail.vue'), 'utf8'))
    expect(rail).toMatch(
      // ⚑ F036 · and who waits on its answer, off the host's state of it (`whoItOwesIn`).
      /recordFacets\(\s*record,\s*theWaitIn\(props\.waiting, record\.sessionId\),\s*theWorkIn\(props\.waiting, record\.sessionId\),\s*whoItOwesIn\(host\?\.state\),?\s*\)/,
    )
    expect(screen).toMatch(/:waiting="conversationWaits"/)
  })

  it('🔴 a node’s press reaches the one open — the conversation in its full view', () => {
    // ⚑ **D-017b · re-aimed** — a closed node's press went through `closedPress` (the library's one
    // answer, then reopen or read); every node now presses the one open, whatever it is doing, and
    // the screen draws it through `openConversation`, which looks and starts nothing.
    const team = code(readFileSync(join(COMPONENTS, 'TeamWorkspace.vue'), 'utf8'))
    expect(team).toMatch(/<TeamForest[\s\S]{0,200}@press="pressForest"/)
    const press = team.slice(team.indexOf('function pressForest('))
    expect(press.slice(0, press.indexOf('\n}\n'))).toMatch(
      /emit\('openConversation', row\.conversation\)/,
    )
    expect(screen).toMatch(/<TeamWorkspace[\s\S]{0,800}@open-conversation="select"/)
    const select = screen.slice(screen.indexOf('function select('))
    expect(select.slice(0, select.indexOf('\n}\n'))).toMatch(/openConversation\(sessionId\)/)
    // ⛔ **And the old route is gone**, so nothing presses round the one open.
    expect(screen).not.toMatch(/@open-closed=/)
    expect(screen).not.toContain('closedPress(')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §5 · UI-004 · a line is dashed while the parent waits on the child
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§5 · UI-004 · a line is dashed while the parent holds an open piece it gave that child', () => {
  /** ⚑ A piece held by `holder`, given by `giver` (a conversation), in `state`. */
  const gave = (holder: string, giver: string, piece: string, state: string): ForestNode =>
    ({
      node: 'a-task',
      under: { is: 'a-conversation', conversation: holder },
      givenBy: { is: 'a-conversation', conversation: giver },
      work: {
        piece,
        label: `W${piece}`,
        title: piece,
        from: giver,
        fromIdentity: null,
        to: holder,
        toIdentity: null,
        state,
        givenAt: 1,
        endedAt: null,
      },
    }) as unknown as ForestNode

  const nodesOf = (rows: readonly ForestNode[]): Map<string, GraphNode> =>
    new Map(
      forestGraph(viewOf(rows)).generations.flatMap((generation) =>
        generation.map((node) => [node.row.conversation, node] as const),
      ),
    )

  const family = (state: string): ForestNode[] => [
    conv('sess_boss', null),
    conv('sess_bro', 'sess_boss'),
    conv('sess_ana', 'sess_bro'),
    conv('sess_arjun', 'sess_bro'),
    conv('sess_rui', 'sess_boss'),
    gave('sess_bro', 'sess_boss', '1.0', 'working'),
    gave('sess_ana', 'sess_bro', '1.1', state),
    // ⛔ Rui holds a piece BroBot gave him — and BroBot is not his parent.
    gave('sess_rui', 'sess_bro', '1.3', 'working'),
  ]

  it('🔴 dashed for a child holding an open piece its PARENT gave — solid for one holding none, or one given by another', () => {
    const nodes = nodesOf(family('working'))
    expect(waitsOnIt(nodes.get('sess_bro')!)).toBe(true)
    expect(waitsOnIt(nodes.get('sess_ana')!)).toBe(true)
    expect(waitsOnIt(nodes.get('sess_arjun')!)).toBe(false)
    expect(waitsOnIt(nodes.get('sess_rui')!)).toBe(false)
    // ⛔ A root has no parent to wait on it.
    expect(waitsOnIt(nodes.get('sess_boss')!)).toBe(false)
  })

  it('⚑ …every piece it holds counts, not only the three a card shows — and a person’s piece never dashes its parent’s line', () => {
    // ⚑ Ana holds BroBot's open W1.1 first, then three newer pieces from others, all answered.
    const many = [
      ...family('working'),
      gave('sess_ana', 'sess_boss', '2.1', 'answered'),
      gave('sess_ana', 'sess_boss', '2.2', 'answered'),
      gave('sess_ana', 'sess_boss', '2.3', 'answered'),
    ]
    expect(nodesOf(many).get('sess_ana')!.tasks).toHaveLength(4)
    expect(waitsOnIt(nodesOf(many).get('sess_ana')!)).toBe(true)
    // ⛔ Arjun holds an open piece a PERSON gave him: nobody on the line above waits on it.
    const person = {
      ...gave('sess_arjun', 'sess_bro', '9.1', 'working'),
      givenBy: { is: 'the-person' },
    } as unknown as ForestNode
    expect(waitsOnIt(nodesOf([...family('working'), person]).get('sess_arjun')!)).toBe(false)
  })

  it('⚑ …open means open: a stalled piece still dashes, an answered one does not', () => {
    expect(waitsOnIt(nodesOf(family('stalled')).get('sess_ana')!)).toBe(true)
    expect(waitsOnIt(nodesOf(family('answered')).get('sess_ana')!)).toBe(false)
  })
})
