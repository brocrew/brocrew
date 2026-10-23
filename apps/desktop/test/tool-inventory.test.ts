import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  catalogue,
  filterCatalogue,
  inventoryAsOf,
  inventorySummary,
  qualify,
  readInventory,
  splitQualified,
  standingChoices,
  statusWord,
  TOOLS_ARE_AS_OF_A_STATEMENT,
  WHY_EVERY_CONVERSATION,
  type CatalogEntry,
  type InventoryReading,
  type ToolStanding,
} from '../src/renderer/src/lib/tool-inventory'
import {
  qualifyWith as runtimeQualifyWith,
  splitQualified as runtimeSplitQualified,
  CLAUDE_TOOL_NAMING,
  CODEX_TOOL_NAMING,
} from '../../../packages/runtime/src/tool-inventory'
import { applyEvent, createTranscript, type ToolRegistry } from '../src/renderer/src/lib/transcript'
import { carryForward, foldWindow } from '../src/renderer/src/lib/transcript-window'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **358 · what tools this conversation has — the reading, and the three states it can be in.**
 *
 * ⛔ **The fixtures below are a REAL measurement cut down, not an invention.**
 * `probe:tool-inventory` ran the app's own `agentToolsFor` → `claudeMcpServersFor` against a live
 * Claude child, twice, and recorded:
 *
 * ```
 * a · the app’s real launch      init.tools (37) : Task, …, Bash, …, mcp__brobot__end_agent,
 *                                                  mcp__brobot__get_agent_status, …
 *                                init.mcp_servers: brobot[connected]
 * b · control, no mcpServers     init.tools (32) : Task, …, Bash, …  ⟵ none of the five
 *                                init.mcp_servers: (none)
 * ```
 *
 * ⚑ **The control is what makes the positive mean anything** — five names present with the toolset
 * attached and zero present without it, on the same options — and the same pairing is done here at
 * the fold: every assertion that a state renders one way is made beside one that renders another.
 *
 * ## ⚠️ What this file may NOT be written with
 *
 * ⛔ **No provider name reaches this layer.** `039` forbids the renderer deciding anything by
 * recognising a provider and `provider-neutrality.test.ts` refused the first draft of the join by
 * name, so the spelling arrives as {@link ToolNaming} — data on the event. The Claude and Codex
 * conventions below are therefore fixture VALUES, exactly as they would arrive on the wire.
 */

const CLAUDE_NAMING = { prefix: 'mcp__', separator: '__' }
const CODEX_NAMING = { prefix: '', separator: '__' }

/** The five, as `agentToolsFor` declares them — names and shapes verbatim, prose cut down. */
const DECLARED = {
  server: 'brobot',
  instructions: 'These tools reach the app you are running inside.',
  tools: [
    {
      name: 'list_agents',
      description: 'List the agents you can see.',
      parameters: [
        { name: 'project', type: 'string', required: false, description: 'Only agents here.' },
      ],
    },
    {
      name: 'spawn_agent',
      description: 'Create another agent.',
      parameters: [
        { name: 'profile_slug', type: 'string', required: true, description: 'Which identity.' },
        { name: 'purpose', type: 'string', required: true, description: 'Why.' },
        { name: 'cwd', type: 'string', required: false },
      ],
    },
    { name: 'end_agent', description: 'End an agent you created.', parameters: [] },
  ],
} as const

/**
 * ⚑ **The verb `441` added** (`create_project`) in the shape this file's declarations take — the
 * one tool that made a live conversation read 15 and a new one read 16, which is the observation
 * `444` relay 1 exists for.
 */
const EXTRA_TOOL = {
  name: 'create_project',
  description: 'Create a project from work already described.',
  parameters: [],
} as const

/** The 37-name reading, cut to one built-in per shape plus the qualified five. */
const PUBLISHED = {
  tools: [
    'Bash',
    'Read',
    'Task',
    'mcp__brobot__list_agents',
    'mcp__brobot__spawn_agent',
    'mcp__brobot__end_agent',
  ],
  servers: [{ name: 'brobot', status: 'connected' }],
}

/**
 * ⚑ **`at` defaults to the moment these fixtures were stated** (444 relay 1) — a fixed instant, so
 * every reading below has a `when` and the one test that needs *no* moment asks for `null`.
 */
const STATED_AT = Date.UTC(2023, 4, 17, 9, 41, 7)

const registry = (
  set: ToolRegistry['set'],
  dropped = 0,
  at: number | null = STATED_AT,
): ToolRegistry => ({ set, dropped, at })

describe('what tools this conversation has (358)', () => {
  describe('the three states, and none of them may be drawn as another', () => {
    it('⛔ nobody has told us — and it does NOT read as a conversation with no tools', () => {
      const reading = readInventory(registry(null))
      expect(reading.kind).toBe('untold')
      expect(reading.own, 'there is nothing to list, because nothing was said').toBeNull()
      expect(reading.provenance).toContain('has not been told')
      // ⛔ **The pair.** "There is no list" must not be reachable by the sentence that means
      // "the list is empty" — `279` §2's rule, one state further on.
      expect(reading.provenance).not.toContain('no tool')
      expect(inventorySummary(reading)).toBe('not reported yet')
    })

    it('⛔ the provider publishes none — declared is shown, and confirmed by nothing', () => {
      const reading = readInventory(
        registry({ naming: CODEX_NAMING, declared: DECLARED, published: null }),
      )
      expect(reading.kind).toBe('unpublished')
      expect(reading.own?.tools.map((tool) => tool.standing)).toEqual([
        'unconfirmable',
        'unconfirmable',
        'unconfirmable',
      ])
      // ⛔ **`null`, and it is not "disconnected".** Nothing reported, so there is no word to show.
      expect(reading.own?.status).toBeNull()
      expect(reading.provenance).toContain('publishes no tool inventory')
      expect(reading.provenance).toContain('nothing here is a confirmation')
      // ⚑ …and the built-in half is empty because nothing was published, not because the parse
      // failed: the declared half is fully populated in the same reading.
      expect(reading.builtins).toEqual([])
      expect(reading.own?.tools).toHaveLength(3)
      expect(inventorySummary(reading)).toBe(
        '3 declared by BroCrew, none confirmed by the provider',
      )
    })

    it('⚑ the provider published — the join is real, and it names the built-ins apart', () => {
      const reading = readInventory(
        registry({ naming: CLAUDE_NAMING, declared: DECLARED, published: PUBLISHED }),
      )
      expect(reading.kind).toBe('published')
      expect(reading.own?.status).toBe('connected')
      expect(reading.own?.tools.map((tool) => tool.standing)).toEqual([
        'confirmed',
        'confirmed',
        'confirmed',
      ])
      // ⛔ **The built-ins are the provider's own and are NOT counted as BroBot's** — the whole
      // reason the header button shows five and not thirty-seven.
      expect(reading.builtins).toEqual(['Bash', 'Read', 'Task'])
      expect(reading.foreign, 'our own server is not also a foreign one').toEqual([])
      expect(inventorySummary(reading)).toBe('3 of 3 BroCrew tools confirmed · 3 built-in')
    })
  })

  /**
   * 🔴 **The state this surface exists for**, and the one a fixture is most likely to pass over.
   */
  it('⛔ a tool BroBot declared that the agent did NOT list reads differently from one it did', () => {
    const partial = {
      tools: ['Bash', 'mcp__brobot__list_agents'],
      servers: [{ name: 'brobot', status: 'connected' }],
    }
    const reading = readInventory(
      registry({ naming: CLAUDE_NAMING, declared: DECLARED, published: partial }),
    )
    const standings = Object.fromEntries(
      (reading.own?.tools ?? []).map((tool) => [tool.name, tool.standing]),
    )
    // ⚠️ **Both halves in one assertion object**: the listed one is `confirmed` and the two the
    // child did not name are `offered`. A test that asserted only the second would be satisfied by
    // a reading that called EVERYTHING offered.
    expect(standings).toEqual({
      list_agents: 'confirmed',
      spawn_agent: 'offered',
      end_agent: 'offered',
    })
    expect(inventorySummary(reading)).toBe('1 of 3 BroCrew tools confirmed · 1 built-in')
  })

  it('⛔ …and `offered` is not reachable on a provider that publishes nothing', () => {
    // The same declaration, the same three tools, the OTHER arm — so `unconfirmable` and `offered`
    // are proved distinct rather than two names for one path.
    const unpublished = readInventory(
      registry({ naming: CODEX_NAMING, declared: DECLARED, published: null }),
    )
    expect(unpublished.own?.tools.every((tool) => tool.standing === 'unconfirmable')).toBe(true)
    expect(unpublished.own?.tools.some((tool) => tool.standing === 'offered')).toBe(false)
  })

  it('names the server the agent connected to, and says so when the agent named none', () => {
    const noServerRow = readInventory(
      registry({
        naming: CLAUDE_NAMING,
        declared: DECLARED,
        published: { tools: PUBLISHED.tools, servers: [] },
      }),
    )
    // ⛔ The tools are still confirmed — they are in the list — but the CONNECTION is unreported,
    // and those are two different facts that a single "is it working" flag would have merged.
    expect(noServerRow.own?.status).toBeNull()
    expect(noServerRow.own?.tools.every((tool) => tool.standing === 'confirmed')).toBe(true)
    // …against the pair, where the row is there.
    expect(
      readInventory(registry({ naming: CLAUDE_NAMING, declared: DECLARED, published: PUBLISHED }))
        .own?.status,
    ).toBe('connected')
  })

  describe('other MCP servers the agent named', () => {
    it('lists a server BroBot did not declare, with its tools and its own word', () => {
      const reading = readInventory(
        registry({
          naming: CLAUDE_NAMING,
          declared: DECLARED,
          published: {
            tools: ['Bash', 'mcp__brobot__spawn_agent', 'mcp__github__create_issue'],
            servers: [
              { name: 'brobot', status: 'connected' },
              { name: 'github', status: 'needs-auth' },
            ],
          },
        }),
      )
      expect(reading.foreign).toEqual([
        { name: 'github', status: 'needs-auth', tools: ['mcp__github__create_issue'] },
      ])
      // ⚑ Ours is not among them, and its own tool did not leak into the foreign list.
      expect(reading.own?.name).toBe('brobot')
      expect(reading.builtins).toEqual(['Bash'])
    })

    it('⛔ a server with a status row and no tools, and one with tools and no status row', () => {
      // ⚠️ **Both, because deriving the list from either half alone would silently drop the other**
      // — `a-negative-is-only-as-strong-as-the-search-shape`.
      const reading = readInventory(
        registry({
          naming: CLAUDE_NAMING,
          declared: null,
          published: {
            tools: ['mcp__quiet__one'],
            servers: [{ name: 'silent', status: 'pending' }],
          },
        }),
      )
      expect(reading.foreign).toEqual([
        { name: 'quiet', status: '', tools: ['mcp__quiet__one'] },
        { name: 'silent', status: 'pending', tools: [] },
      ])
    })
  })

  describe('the connection word', () => {
    it('translates every word the pinned SDK declares', () => {
      expect(statusWord('connected')).toEqual({ label: 'connected', tone: 'ok', connected: true })
      expect(statusWord('failed').tone).toBe('bad')
      expect(statusWord('needs-auth').label).toBe('needs sign-in')
      expect(statusWord('pending').tone).toBe('wait')
      expect(statusWord('disabled').tone).toBe('off')
    })

    it('⛔ a word nobody enumerated is shown VERBATIM and is never counted as connected', () => {
      // `an-unenumerated-state-counts-as-success`, closed in the one place it could open here.
      expect(statusWord('quantum-entangled')).toEqual({
        label: 'quantum-entangled',
        tone: 'unknown',
        connected: false,
      })
      // ⚑ The pair: the function really does say `true` for something, so `false` above is a
      // ruling rather than a function that never says otherwise.
      expect(statusWord('connected').connected).toBe(true)
    })
  })

  describe('the spelling, which is data and never a provider', () => {
    it('splits Claude’s and Codex’s conventions, from the same function', () => {
      expect(splitQualified(CLAUDE_NAMING, 'mcp__brobot__spawn_agent')).toEqual({
        server: 'brobot',
        tool: 'spawn_agent',
      })
      expect(splitQualified(CODEX_NAMING, 'brobot__spawn_agent')).toEqual({
        server: 'brobot',
        tool: 'spawn_agent',
      })
    })

    it('⛔ a built-in is not a qualified name, on either convention', () => {
      expect(splitQualified(CLAUDE_NAMING, 'Bash')).toBeNull()
      expect(splitQualified(CODEX_NAMING, 'shell')).toBeNull()
      // ⚠️ …and the pair, so "returns null" is not simply what this function always does.
      expect(splitQualified(CLAUDE_NAMING, 'mcp__x__y')).not.toBeNull()
    })

    it('⛔ the PREFIX is checked — a name that merely CONTAINS the separator is not a server', () => {
      // 🔴 **The state where the two readings diverge, and it is the only one.** Every ordinary
      // built-in — `Bash`, `Read`, `Task` — has no separator at all and answers `null` whether or
      // not the prefix is tested; a name with the separator and no prefix is what tells the two
      // apart. Without this case, dropping the prefix check is a mutation nothing can see.
      expect(splitQualified(CLAUDE_NAMING, 'some__builtin')).toBeNull()
      // …and one character apart, WITH the prefix, the very same shape is a server's tool.
      expect(splitQualified(CLAUDE_NAMING, 'mcp__some__builtin')).toEqual({
        server: 'some',
        tool: 'builtin',
      })
    })

    it('…and such a name is read as a built-in by the whole reading, not merely by the split', () => {
      // The same divergence, one level up: a published name with the separator and no prefix must
      // land in `builtins` rather than inventing a server called `some`.
      const reading = readInventory(
        registry({
          naming: CLAUDE_NAMING,
          declared: null,
          published: { tools: ['some__builtin', 'mcp__github__x'], servers: [] },
        }),
      )
      expect(reading.builtins).toEqual(['some__builtin'])
      expect(reading.foreign.map((one) => one.name)).toEqual(['github'])
    })

    it('keeps a tool name that contains the separator whole', () => {
      // The rule the docblock states: server is up to the FIRST separator, tool is the rest.
      expect(splitQualified(CLAUDE_NAMING, 'mcp__srv__a__b')).toEqual({
        server: 'srv',
        tool: 'a__b',
      })
    })

    it('round-trips: what `qualify` writes, `splitQualified` reads back', () => {
      for (const naming of [CLAUDE_NAMING, CODEX_NAMING]) {
        const written = qualify(naming, 'brobot', 'get_agent_status')
        expect(splitQualified(naming, written)).toEqual({
          server: 'brobot',
          tool: 'get_agent_status',
        })
      }
      // ⛔ And the two conventions really do differ, or the loop above proves nothing.
      expect(qualify(CLAUDE_NAMING, 'brobot', 'x')).not.toBe(qualify(CODEX_NAMING, 'brobot', 'x'))
      expect(qualify(CLAUDE_NAMING, 'brobot', 'x')).toBe('mcp__brobot__x')
      expect(qualify(CODEX_NAMING, 'brobot', 'x')).toBe('brobot__x')
    })

    it('a row carries the name the MODEL must say, not the bare one', () => {
      const claude = readInventory(
        registry({ naming: CLAUDE_NAMING, declared: DECLARED, published: PUBLISHED }),
      )
      const codex = readInventory(
        registry({ naming: CODEX_NAMING, declared: DECLARED, published: null }),
      )
      expect(claude.own?.tools.map((tool) => tool.qualified)).toEqual([
        'mcp__brobot__list_agents',
        'mcp__brobot__spawn_agent',
        'mcp__brobot__end_agent',
      ])
      expect(codex.own?.tools.map((tool) => tool.qualified)).toEqual([
        'brobot__list_agents',
        'brobot__spawn_agent',
        'brobot__end_agent',
      ])
    })
  })

  it('⛔ a cap that bit is carried through to the reading, never silently', () => {
    const reading = readInventory(
      registry({ naming: CLAUDE_NAMING, declared: DECLARED, published: PUBLISHED }, 4),
    )
    expect(reading.dropped).toBe(4)
    // …and zero is zero, so the assertion above is about the number and not about its presence.
    expect(
      readInventory(registry({ naming: CLAUDE_NAMING, declared: DECLARED, published: PUBLISHED }))
        .dropped,
    ).toBe(0)
  })

  it('⛔ …and it travels on the EVENT, not only in a hand-built registry', () => {
    // ⚠️ **Every other `dropped` assertion in this file injects the number into the registry
    // helper**, so nothing measured the fold's own `event.dropped ?? 0` — the line that carries a
    // shortfall from the adapter to the screen. Driven through `applyEvent` here.
    const state = createTranscript()
    applyEvent(state, {
      type: 'tool_inventory',
      naming: CLAUDE_NAMING,
      declared: null,
      published: { tools: ['Bash'], servers: [] },
      dropped: 7,
      source: 'init',
    } as TranscriptEvent)
    expect(state.tools.dropped).toBe(7)
    expect(readInventory(state.tools).dropped).toBe(7)
    // ⚑ The pair: a frame WITHOUT the field folds to 0 rather than to `undefined`, which is what
    // keeps the shortfall banner off an inventory that lost nothing.
    const clean = createTranscript()
    applyEvent(clean, {
      type: 'tool_inventory',
      naming: CLAUDE_NAMING,
      declared: null,
      published: { tools: ['Bash'], servers: [] },
      source: 'init',
    } as TranscriptEvent)
    expect(clean.tools.dropped).toBe(0)
  })

  /**
   * 🔴 **Two byte-identical copies of one rule, and this is what keeps them honest.**
   *
   * ⛔ **The renderer cannot import the runtime's copy.** A value import from `@brobot2/runtime`
   * (or `@brobot2/shared`) costs the renderer bundle six figures of bytes and the vite config
   * cannot resolve it at all — `import type` only. So `splitQualified`/`qualify` exist twice on
   * purpose, which is exactly the `169` §1 hazard ("one rule spelled in N places drifts") that the
   * codebase otherwise forbids.
   *
   * ⚑ **This test is the exception's price.** It is in the `desktop` project, which is node, so it
   * can import BOTH and drive them through the same table. Fix one and not the other and this goes
   * red — which is the only thing standing between the two copies and a silent disagreement about
   * what a tool is called.
   */
  it('⛔ the renderer’s copy of the naming rule agrees with the runtime’s, input for input', () => {
    const CASES = [
      { naming: CLAUDE_NAMING, name: 'mcp__brobot__spawn_agent' },
      { naming: CLAUDE_NAMING, name: 'Bash' },
      { naming: CLAUDE_NAMING, name: 'some__builtin' },
      { naming: CLAUDE_NAMING, name: 'mcp__srv__a__b' },
      { naming: CLAUDE_NAMING, name: 'mcp__' },
      { naming: CLAUDE_NAMING, name: 'mcp____x' },
      { naming: CODEX_NAMING, name: 'brobot__spawn_agent' },
      { naming: CODEX_NAMING, name: 'shell' },
      { naming: CODEX_NAMING, name: '__x' },
    ]
    for (const { naming, name } of CASES) {
      expect(splitQualified(naming, name), `split disagrees on ${name}`).toEqual(
        runtimeSplitQualified(naming, name),
      )
    }
    for (const naming of [CLAUDE_NAMING, CODEX_NAMING]) {
      expect(qualify(naming, 'brobot', 'spawn_agent')).toBe(
        runtimeQualifyWith(naming, 'brobot', 'spawn_agent'),
      )
    }
    // ⚠️ **Non-vacuity**: the table really does contain inputs the two could differ on — one that
    // splits, one that does not, and one that only the prefix check separates.
    expect(splitQualified(CLAUDE_NAMING, 'mcp__brobot__spawn_agent')).not.toBeNull()
    expect(splitQualified(CLAUDE_NAMING, 'some__builtin')).toBeNull()
    // …and the two CONSTANTS agree too, which is what the fixture values above stand in for.
    expect(CLAUDE_NAMING).toEqual(CLAUDE_TOOL_NAMING)
    expect(CODEX_NAMING).toEqual(CODEX_TOOL_NAMING)
  })

  it('⛔ the “why” sentence says what the code decides, not what the brief asked for', () => {
    expect(WHY_EVERY_CONVERSATION).toBe(
      'Every conversation gets the same tools, except write_agent_rules. ' +
        'Only a BroBot conversation a person started gets it, to change another agent’s rules. ' +
        'BroCrew still checks every call against its rules.',
    )
  })

  describe('the fold, and what survives a window release', () => {
    const event: TranscriptEvent = {
      type: 'tool_inventory',
      naming: CLAUDE_NAMING,
      declared: DECLARED as unknown as Extract<
        TranscriptEvent,
        { type: 'tool_inventory' }
      >['declared'],
      published: PUBLISHED,
      source: 'init',
    }

    it('a fresh transcript holds `null`, and the frame replaces it wholesale', () => {
      const state = createTranscript()
      expect(state.tools.set, 'nobody has told us, before any frame').toBeNull()
      applyEvent(state, event)
      expect(state.tools.set?.published?.tools).toEqual(PUBLISHED.tools)
      expect(state.tools.set?.declared?.tools).toHaveLength(3)
      // ⛔ REPLACE: a second, smaller frame does not leave the first one's rows behind.
      applyEvent(state, { ...event, published: { tools: ['Bash'], servers: [] } })
      expect(state.tools.set?.published?.tools).toEqual(['Bash'])
      expect(state.tools.set?.published?.servers).toEqual([])
    })

    it('⛔ `published: null` is COPIED, never normalized into an empty inventory', () => {
      const state = createTranscript()
      applyEvent(state, { ...event, naming: CODEX_NAMING, published: null })
      expect(state.tools.set?.published).toBeNull()
      // ⚑ The pair, through the same fold: a real publication lands as itself.
      const other = createTranscript()
      applyEvent(other, event)
      expect(other.tools.set?.published).not.toBeNull()
    })

    /**
     * 🔴 **The registry survives a window release** — and nothing in the typechecker would have
     * said so: `FoldCarry` is hand-written.
     *
     * ⛔ **On Claude a restatement only happens when the ANSWER MOVES** — the adapter dedupes an
     * identical `system/init`, which is what keeps a cron waking a session three times from writing
     * four rows saying nothing happened. So an ordinary conversation publishes once and never
     * again, and a carry that dropped it would leave one long enough to roll its window reading
     * *"BroCrew has not been told what this conversation has"* — about a conversation it launched
     * five tools into.
     */
    it('⛔ survives a window release, which no compiler could have checked', () => {
      const state = createTranscript()
      applyEvent(state, event)
      expect(state.tools.set?.declared?.tools).toHaveLength(3)

      // A retained run that restates nothing about tools — the release case.
      const retained: RuntimeEventMessage[] = [
        {
          sessionId: 'sess_1',
          ordinal: 900,
          at: 1,
          event: { type: 'status', state: 'idle' } as TranscriptEvent,
        },
      ]
      const carried = carryForward(state, retained)
      const rebuilt = foldWindow(retained, null, carried)
      expect(rebuilt.tools.set?.declared?.tools.map((tool) => tool.name)).toEqual([
        'list_agents',
        'spawn_agent',
        'end_agent',
      ])
      expect(rebuilt.tools.set?.published?.tools).toEqual(PUBLISHED.tools)
      expect(rebuilt.tools.set?.naming).toEqual(CLAUDE_NAMING)

      // ⛔ **The pair, and it is what makes the assertion above a carry rather than a re-fold.** A
      // state that never held an inventory rebuilds to `null` through the SAME two calls — so the
      // rows above came across the release rather than being produced by `retained`.
      const empty = createTranscript()
      expect(foldWindow(retained, null, carryForward(empty, retained)).tools.set).toBeNull()
    })

    /* ─────────────────────────── 444 relay 1 · the moment the count was true ────────────── */

    /**
     * 🔴 **A count that does not say WHEN it was true** (444 relay 1).
     *
     * ⛔ **The moment is the ENVELOPE's, not a clock this fold reads.** `RuntimeHost.deliver`
     * stamps `at` once, writes it to `events.created_at` and puts the same number on the wire, so
     * a replayed row carries the moment it was RECORDED rather than the moment of the replay.
     */
    it('🔴 the fold keeps the envelope’s moment, and has none of its own', () => {
      const state = createTranscript()
      expect(state.tools.at, 'a fresh transcript has no moment either').toBeNull()
      applyEvent(state, event, 1_700_000_000_000)
      expect(state.tools.at).toBe(1_700_000_000_000)

      // ⛔ **The pair, and it is the arm two real callers take.** `ChildWorkViewer` folds bare
      // events with no envelope; a fold with no clock must land `null` rather than `0`, which
      // would draw as 1 January 1970 on any surface that formats it.
      const clockless = createTranscript()
      applyEvent(clockless, event)
      expect(clockless.tools.set, 'the frame still folded').not.toBeNull()
      expect(clockless.tools.at).toBeNull()
    })

    /**
     * ⚑ **THE PAIRED POSITIVE the relay asked for, in ONE sample** — a conversation that has never
     * been reopened shows what it was handed at its launch, and a reopened one shows the current
     * set. ⛔ **Latest-wins is what makes a resume honest**, so this asserts the rule rather than
     * changing it: the second row replaces the first, moment and all.
     *
     * ⚠️ **The two moments must DIFFER.** An equality against one re-read of a moving field
     * measures nothing; the claim is that reopening moves it.
     */
    it('🔴 a conversation never reopened keeps its launch moment; a reopened one takes the new row’s', () => {
      const launched = createTranscript()
      applyEvent(launched, event, 1_700_000_000_000)
      const before = readInventory(launched.tools)

      // …the same conversation, reopened: `agentToolsFor` runs again at `reopenSession` and the
      // adapter re-states the inventory from the rebuilt set.
      const reopened = createTranscript()
      applyEvent(reopened, event, 1_700_000_000_000)
      applyEvent(
        reopened,
        { ...event, declared: { ...DECLARED, tools: [...DECLARED.tools, EXTRA_TOOL] } as never },
        1_700_000_600_000,
      )
      const after = readInventory(reopened.tools)

      expect(before.own?.tools.length, 'the launch reading').toBe(3)
      expect(after.own?.tools.length, 'the reopened reading').toBe(4)
      expect(before.at).toBe(1_700_000_000_000)
      expect(after.at).toBe(1_700_000_600_000)
      // ⛔ **No `not.toBe(before.at)` here.** It would be entailed by the two lines above and could
      // never fire while they pass — a decorative pair. ⚑ **The discrimination is the COUNT beside
      // the MOMENT**: a fold that took the new row's tools and kept the old row's stamp passes
      // either assertion alone and fails them together.
      expect(before.own?.tools.map((tool) => tool.name)).not.toContain(EXTRA_TOOL.name)
    })

    /**
     * ⛔ **The moment survives a window release, which no compiler could have checked** — the
     * carry builds the registry field by hand. ⚠️ And a conversation long enough to roll its
     * window is precisely the one whose inventory is oldest.
     */
    it('🔴 …and the moment comes across a window release with the set', () => {
      const state = createTranscript()
      applyEvent(state, event, 1_700_000_000_000)
      const retained: RuntimeEventMessage[] = [
        {
          sessionId: 'sess_1',
          ordinal: 900,
          at: 1,
          event: { type: 'status', state: 'idle' } as TranscriptEvent,
        },
      ]
      const rebuilt = foldWindow(retained, null, carryForward(state, retained))
      expect(rebuilt.tools.at, 'the carry dropped the moment').toBe(1_700_000_000_000)
      // ⛔ **Against the outgoing state, not a literal** — a carry that stamped its own clock or
      // took `retained`'s `at` of 1 fails here, and unlike a `not.toBe(1)` this cannot be entailed
      // by the line above it.
      expect(rebuilt.tools.at).toBe(state.tools.at)
      const empty = createTranscript()
      expect(foldWindow(retained, null, carryForward(empty, retained)).tools.at).toBeNull()
    })

    it('⛔ the carry is a COPY, not an alias — two folds cannot share one array', () => {
      const state = createTranscript()
      applyEvent(state, event)
      const rebuilt = foldWindow([], null, carryForward(state, []))
      // ⚠️ **Identity, not contents.** The outgoing state stays reachable for the length of the
      // call, and a shared array is a way for two folds to disagree later for no reason — the rule
      // `carryForward` states for the five registries above this one.
      expect(rebuilt.tools.set?.published?.tools).not.toBe(state.tools.set?.published?.tools)
      expect(rebuilt.tools.set?.published?.servers).not.toBe(state.tools.set?.published?.servers)
      expect(rebuilt.tools.set?.declared?.tools).not.toBe(state.tools.set?.declared?.tools)
      // …and the copy really is equal, so `not.toBe` above is about identity rather than about a
      // carry that dropped the rows altogether.
      expect(rebuilt.tools.set?.published?.tools).toEqual(PUBLISHED.tools)
    })
  })
})

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   392 · the catalogue the workbench browses, and the vocabularies it may not cross
   ═════════════════════════════════════════════════════════════════════════════════════════════ */

describe('392 · the catalogue', () => {
  const claude = registry({ naming: CLAUDE_NAMING, declared: DECLARED, published: PUBLISHED })
  const codex = registry({ naming: CODEX_NAMING, declared: DECLARED, published: null })

  it('⛔ every row BroBot did not declare has NO standing — an absent answer, not a fourth word', () => {
    const rows = catalogue(
      readInventory(
        registry({
          naming: CLAUDE_NAMING,
          declared: DECLARED,
          published: {
            tools: ['Bash', 'mcp__brobot__spawn_agent', 'mcp__github__create_issue'],
            servers: [
              { name: 'brobot', status: 'connected' },
              { name: 'github', status: 'needs-auth' },
            ],
          },
        }),
      ),
    )
    const by = (source: string): CatalogEntry[] => rows.filter((row) => row.source === source)

    // ⚑ The pair: our own rows DO carry one, so "null" below is about the source and not about a
    // catalogue that forgot to compute standing at all.
    expect(by('brobot').map((row) => row.standing)).toEqual(['offered', 'confirmed', 'offered'])
    expect(by('server').map((row) => row.standing)).toEqual([null])
    expect(by('builtin').map((row) => row.standing)).toEqual([null])

    // ⛔ **And `null` is the only absent field they share.** A foreign row still knows its server and
    // that server's own word — losing those would make it indistinguishable from a built-in.
    const foreign = by('server')[0]!
    expect(foreign.server).toBe('github')
    expect(foreign.serverStatus).toBe('needs-auth')
    expect(by('builtin')[0]!.server).toBeNull()
  })

  it('🔴 `[]` and `null` parameters are different absences, and one of them is BroBot’s own answer', () => {
    const rows = catalogue(readInventory(claude))
    const endAgent = rows.find((row) => row.bare === 'end_agent')!
    const builtin = rows.find((row) => row.source === 'builtin')!
    expect(endAgent.parameters, 'BroBot declared it and it takes nothing').toEqual([])
    expect(builtin.parameters, 'nobody publishes an argument list for a built-in').toBeNull()
    // ⛔ The same split on the sentence half: a description we hold, and one nobody holds.
    expect(rows.find((row) => row.bare === 'spawn_agent')!.description).toBe(
      'Create another agent.',
    )
    expect(builtin.description).toBeNull()
  })

  it('⛔ a server the child named with no status row is `null`, not an empty string', () => {
    const rows = catalogue(
      readInventory(
        registry({
          naming: CLAUDE_NAMING,
          declared: null,
          // A published tool under a server that has no status row at all — `readInventory` carries
          // it as `''`, and a template printing that would draw a chip with nothing in it.
          published: { tools: ['mcp__github__create_issue'], servers: [] },
        }),
      ),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.serverStatus).toBeNull()
  })

  /**
   * 🔴 **The invariant `392` found broken, and the shape of the loss.**
   *
   * ⛔ **A name the child listed under BroBot's OWN server that BroBot did not declare fell out of
   * every list.** `own.tools` is built from the DECLARATION; `foreign` deletes our server by name;
   * `builtins` only takes names with no server at all. So the frame carried it, three lists each
   * had a reason not to, and `dropped` — the one field that exists to say a list understates — never
   * saw it. ⚑ In production the two lists are the same five and this never bites; it bites in
   * exactly the state this surface exists for.
   *
   * ⚠️ **The assertion is a CONSERVATION law rather than a check on one field**: every published
   * name appears once, and every declared name appears once, and nothing else does. A future field
   * that loses a name fails here without anybody thinking to test for it.
   */
  it('🔴 every published name reaches the catalogue exactly once, and so does every declared one', () => {
    const set = {
      naming: CLAUDE_NAMING,
      declared: DECLARED,
      published: {
        // `get_agent_status` is under OUR server and is NOT in `DECLARED` — the shape that vanished.
        tools: [
          'Bash',
          'mcp__brobot__spawn_agent',
          'mcp__brobot__get_agent_status',
          'mcp__github__create_issue',
        ],
        servers: [{ name: 'brobot', status: 'connected' }],
      },
    }
    const reading = readInventory(registry(set))
    const rows = catalogue(reading)

    expect(reading.unclaimed).toEqual(['mcp__brobot__get_agent_status'])
    const keys = rows.map((row) => row.key)
    expect(new Set(keys).size, 'a name is in the catalogue twice').toBe(keys.length)
    for (const name of set.published.tools)
      expect(keys, `${name} was published and is in no list`).toContain(name)
    for (const tool of DECLARED.tools)
      expect(keys, `${tool.name} was declared and is in no list`).toContain(
        `mcp__brobot__${tool.name}`,
      )
    // ⛔ …and nothing was invented: the catalogue is exactly the union of the two lists.
    expect(keys.length).toBe(
      new Set([
        ...set.published.tools,
        ...DECLARED.tools.map((tool) => `mcp__brobot__${tool.name}`),
      ]).size,
    )

    // ⛔ **It carries no standing**, because there is no declaration of ours to join to a listing.
    expect(rows.find((row) => row.key === 'mcp__brobot__get_agent_status')!.standing).toBeNull()
    // ⛔ **Its OWN source, not `brobot`.** Filed as `brobot` the surface put it under a heading
    // reading *"declared by BroBot"* beside a detail cell reading *"BroBot's own toolset"*, next to
    // a sentence saying BroBot never declared it — one row saying both. Found in review.
    expect(rows.find((row) => row.key === 'mcp__brobot__get_agent_status')!.source).toBe(
      'unclaimed',
    )
    // ⚑ The pair: a row BroBot really did declare, in the same reading, is `brobot`.
    expect(rows.find((row) => row.key === 'mcp__brobot__spawn_agent')!.source).toBe('brobot')
  })

  it('⛔ the summary says so out loud, and is silent when there is nothing to say', () => {
    const withUnclaimed = readInventory(
      registry({
        naming: CLAUDE_NAMING,
        declared: DECLARED,
        published: {
          tools: ['mcp__brobot__spawn_agent', 'mcp__brobot__get_agent_status'],
          servers: [{ name: 'brobot', status: 'connected' }],
        },
      }),
    )
    expect(withUnclaimed.unclaimed).toHaveLength(1)
    // ⚠️ **`the declaration does not carry` rather than `BroBot did not declare`**, because
    // `MAX_DECLARED_TOOLS` can truncate the declaration on the wire and the stronger sentence would
    // then be a false accusation. Found in review; the shortfall row tells the two apart.
    expect(inventorySummary(withUnclaimed)).toContain(
      '1 the agent named that BroCrew\u2019s declaration does not carry',
    )
    expect(inventorySummary(withUnclaimed)).not.toContain('did not declare')
    // ⚑ The pair, and it is the PRODUCTION reading: the two lists agree, so the clause is absent
    // rather than reading `0 the agent named…`.
    const ordinary = readInventory(claude)
    expect(ordinary.unclaimed).toEqual([])
    expect(inventorySummary(ordinary)).not.toContain('does not carry')
  })

  it('⛔ a name the provider published twice is ONE row — the key is documented unique', () => {
    // ⚠️ Nothing upstream deduplicates: the wire types the list `z.array(z.string())`, the bound
    // filters and slices, and the fold copies. Two rows under one `:key` is a render fault rather
    // than information. Found in review.
    const rows = catalogue(
      readInventory(
        registry({
          naming: CLAUDE_NAMING,
          declared: null,
          published: {
            tools: ['Bash', 'Bash', 'mcp__github__create_issue', 'mcp__github__create_issue'],
            servers: [{ name: 'github', status: 'connected' }],
          },
        }),
      ),
    )
    expect(rows.map((row) => row.key)).toEqual(['mcp__github__create_issue', 'Bash'])
    // ⚑ The pair: two DIFFERENT names are two rows, so this is identity and not a cap.
    const two = catalogue(
      readInventory(
        registry({
          naming: CLAUDE_NAMING,
          declared: null,
          published: { tools: ['Bash', 'Read'], servers: [] },
        }),
      ),
    )
    expect(two.map((row) => row.key)).toEqual(['Bash', 'Read'])
  })

  it('⛔ an empty status word is `null` on OUR server too, not only on a foreign one', () => {
    // ⚠️ `''` is legal on the wire — the schema clips a status word and does not require one — and
    // the first cut normalised it in the foreign branch and let BroBot's own through, which is
    // `an-exception-made-at-one-depth-of-a-walk`. Found in review.
    const empty = catalogue(
      readInventory(
        registry({
          naming: CLAUDE_NAMING,
          declared: DECLARED,
          published: {
            tools: ['mcp__brobot__spawn_agent'],
            servers: [{ name: 'brobot', status: '' }],
          },
        }),
      ),
    )
    expect(empty.map((row) => row.serverStatus)).toEqual([null, null, null])
    // ⚑ The pair: a real word survives, so this is about `''` and not about every status.
    const named = catalogue(
      readInventory(
        registry({
          naming: CLAUDE_NAMING,
          declared: DECLARED,
          published: {
            tools: ['mcp__brobot__spawn_agent'],
            servers: [{ name: 'brobot', status: 'connected' }],
          },
        }),
      ),
    )
    expect(named[0]!.serverStatus).toBe('connected')
  })

  it('the order is BroBot, then its strangers, then every other server, then the built-ins', () => {
    const rows = catalogue(
      readInventory(
        registry({
          naming: CLAUDE_NAMING,
          declared: DECLARED,
          published: {
            tools: [
              'Bash',
              'mcp__github__create_issue',
              'mcp__brobot__spawn_agent',
              'mcp__brobot__get_agent_status',
            ],
            servers: [{ name: 'github', status: 'connected' }],
          },
        }),
      ),
    )
    // ⛔ **All four sources**, in the order the sheet stacks them — a fixture that reached three of
    // them would have measured the order of three.
    expect(rows.map((row) => row.source)).toEqual([
      'brobot',
      'brobot',
      'brobot',
      'unclaimed',
      'server',
      'builtin',
    ])
  })

  describe('the filter, which is where a search can quietly reach a field we do not have', () => {
    const rows = catalogue(readInventory(claude))
    const names = (query: string, standing: 'all' | ToolStanding = 'all'): string[] =>
      filterCatalogue(rows, { query, standing }).map((row) => row.bare)

    it('searches names and descriptions, and the empty query is not a filter', () => {
      expect(names('')).toHaveLength(rows.length)
      expect(names('   '), 'whitespace is not a search').toHaveLength(rows.length)
      expect(names('spawn')).toEqual(['spawn_agent'])
      // ⚑ Matched on the DESCRIPTION alone — no row is named "another agent".
      expect(names('another agent')).toEqual(['spawn_agent'])
      expect(names('SPAWN'), 'case does not decide a match').toEqual(['spawn_agent'])
      // The qualified name is what is searched, so the server inside it is reachable without a
      // second field that could later disagree with the first.
      expect(names('mcp__brobot__')).toEqual(['list_agents', 'spawn_agent', 'end_agent'])
    })

    /**
     * ⛔ **TWO fields, and the negative names the shape it looked for.** A search that also swept a
     * row's `source` would return every built-in for the word `builtin` — a word that is in no name
     * and no description, so the query is only satisfiable by a field the search may not read.
     */
    it('⛔ searches the two fields and no third', () => {
      expect(names('builtin'), 'the search reached a row’s source').toEqual([])
      expect(names('brobot'), 'the search reached a row’s source').toEqual([
        'list_agents',
        'spawn_agent',
        'end_agent',
      ])
      // ⚑ The control: `brobot` above is matched by the qualified NAME, not by the source — so the
      // assertion is about which field answered, and `builtin` is the query where the two differ.
      expect(rows.filter((row) => row.source === 'builtin')).toHaveLength(3)
    })

    /**
     * 🔴 **The negative, with its search shape named** (standing rule 4).
     *
     * ⛔ **`382` measured `origin` as a field that never crosses into this app**, and v2.5.1 renders,
     * searches AND filters on it. The shape of answer this could have found is a `CatalogEntry` with
     * an origin-shaped field, or a `filterCatalogue` that reads one: so the assertion enumerates
     * every key a row HAS, rather than asking whether one key is missing.
     */
    it('⛔ every row has exactly nine fields and none of them is an origin', () => {
      const FIELDS = [
        'bare',
        'description',
        'key',
        'name',
        'parameters',
        'server',
        'serverStatus',
        'source',
        'standing',
      ].sort()
      // ⛔ **Every row, not `rows[0]`.** `catalogue` builds FOUR separate object literals and the
      // first is always a BroBot-declared one, so a field added to any of the other three — which
      // is exactly where an origin would live — was unmeasured. Found in review.
      const mixed = catalogue(
        readInventory(
          registry({
            naming: CLAUDE_NAMING,
            declared: DECLARED,
            published: {
              tools: [
                'Bash',
                'mcp__brobot__spawn_agent',
                'mcp__brobot__get_agent_status',
                'mcp__github__create_issue',
              ],
              servers: [{ name: 'brobot', status: 'connected' }],
            },
          }),
        ),
      )
      expect(
        [...new Set(mixed.map((row) => row.source))].sort(),
        'the fixture does not reach all four literals',
      ).toEqual(['brobot', 'builtin', 'server', 'unclaimed'])
      for (const row of mixed) expect(Object.keys(row).sort(), row.key).toEqual(FIELDS)
    })

    it('⛔ the standing filter hides the rows that have no standing, and the count says so', () => {
      const confirmed = filterCatalogue(rows, { query: '', standing: 'confirmed' })
      expect(confirmed.map((row) => row.bare)).toEqual(['list_agents', 'spawn_agent', 'end_agent'])
      // ⛔ Three of the six rows are gone and NOT because they failed a standing test — they have
      // none. The workbench's own count line is what keeps that from reading as "the agent has 3".
      expect(rows).toHaveLength(6)
      expect(confirmed.every((row) => row.standing === 'confirmed')).toBe(true)
    })

    it('the two controls compose rather than replace one another', () => {
      expect(names('agent', 'confirmed')).toEqual(['list_agents', 'spawn_agent', 'end_agent'])
      expect(names('bash', 'confirmed'), 'a built-in has no standing to match').toEqual([])
      expect(names('bash')).toEqual(['Bash'])
    })
  })

  describe('the six states, counted from the code rather than from a list', () => {
    /**
     * ⛔ **The compiler asks for every member, so a fourth cannot slip through** (392 §6). These two
     * records do not exist to be read — they exist so that adding a member to either union stops the
     * build here, at the file that enumerates them, rather than silently widening every loop below.
     */
    const READINGS: Record<InventoryReading['kind'], true> = {
      untold: true,
      unpublished: true,
      published: true,
    }
    const STANDINGS: Record<ToolStanding, true> = {
      confirmed: true,
      offered: true,
      unconfirmable: true,
    }

    it('⚑ three readings and three standings, and every standing belongs to exactly one reading', () => {
      expect(Object.keys(READINGS)).toHaveLength(3)
      expect(Object.keys(STANDINGS)).toHaveLength(3)

      // ⛔ Every standing this app can MINT appears under exactly one reading, and every choice a
      // reading offers is a standing that reading can really produce. Both directions, because one
      // of them alone is satisfied by a `standingChoices` that returns everything.
      const offered = new Set<string>()
      for (const kind of Object.keys(READINGS) as (keyof typeof READINGS)[]) {
        for (const choice of standingChoices(kind)) {
          expect(offered.has(choice), `${choice} is offered under two readings`).toBe(false)
          offered.add(choice)
        }
      }
      expect([...offered].sort()).toEqual(Object.keys(STANDINGS).sort())
      expect(standingChoices('untold'), 'untold has no list, so it has no standings').toEqual([])
    })

    /**
     * 🔴 **The census: what `readInventory` really mints under each reading.**
     *
     * ⛔ **Measured off the function, not off the table above.** `standingChoices` is a claim about
     * `readInventory`; this is the pair that checks the claim, so the two cannot drift apart into a
     * filter offering a standing the reading can never carry.
     */
    const minted = (reading: InventoryReading): string[] => [
      ...new Set(
        catalogue(reading).flatMap((row) => (row.standing === null ? [] : [row.standing])),
      ),
    ]

    it('⛔ every reading mints only the standings it offers', () => {
      const cases: [InventoryReading, string[]][] = [
        [readInventory(registry(null)), []],
        [readInventory(codex), ['unconfirmable']],
        [readInventory(claude), ['confirmed']],
        [
          readInventory(
            registry({
              naming: CLAUDE_NAMING,
              declared: DECLARED,
              published: { tools: [], servers: [] },
            }),
          ),
          ['offered'],
        ],
      ]
      for (const [reading, expected] of cases) {
        expect(minted(reading).sort(), `${reading.kind} minted the wrong standings`).toEqual(
          expected.sort(),
        )
        for (const standing of minted(reading))
          expect(
            standingChoices(reading.kind) as readonly string[],
            `${reading.kind} minted ${standing} and does not offer it`,
          ).toContain(standing)
      }
    })

    /**
     * ⛔ **The control, and it plants TWO** (standing rule 12). A walk that stopped at the first
     * unknown member would pass a table missing its last one — the exact shape `store.create(`
     * failed on in an 8 700-line host.
     */
    it('…and the walk above sees BOTH of two members nothing mints', () => {
      // ⛔ **The control runs the WALK, on a planted vocabulary.** The first version filtered two
      // string literals through `Object.keys(STANDINGS)` and called no production code at all — a
      // tautology that could only fail if somebody added `sideways` to the union. Found in review.
      const unminted = (vocabulary: readonly string[]): string[] => {
        const mintable = new Set<string>()
        for (const kind of Object.keys(READINGS) as (keyof typeof READINGS)[])
          for (const choice of standingChoices(kind)) mintable.add(choice)
        return vocabulary.filter((word) => !mintable.has(word))
      }
      expect(unminted(Object.keys(STANDINGS)), 'a real standing reads as unminted').toEqual([])
      expect(
        unminted([...Object.keys(STANDINGS), 'sideways', 'rumoured']),
        'the walk stopped at the first stranger',
      ).toEqual(['sideways', 'rumoured'])
    })
  })

  /**
   * 🔴 **The safety sentence, asserted BY NAME** (standing rule 5, HO-013 §5).
   *
   * ⛔ **`the agent can call them` stood in this sentence until `392` and was two promises at once**:
   * that the declaration ARRIVED — the one thing an unpublished reading cannot know, and the
   * question `353` needed an investigation to answer for one run — and that a call would be
   * ADMITTED, which is a capability's answer and is not readable from this window.
   */
  describe('the unpublished sentence, which is the one a person could act on', () => {
    const sentence = readInventory(codex).provenance

    it('⛔ says it is not a confirmation, not complete, and not a list of what can be called', () => {
      expect(sentence).toContain('nothing here is a confirmation')
      expect(sentence).toContain('Not a complete account')
      expect(sentence).toContain('not a list of what it can call')
    })

    /**
     * 🔴 **The fourth clause, which was FALSE and which nothing pinned** (444 relay 1).
     *
     * ⛔ **It said the tools were declared *"when it started"*.** `agentToolsFor` runs at
     * `startSessionInProfile` AND at `reopenSession`, so a conversation opened out of the library
     * is handed TODAY's declaration — which is exactly the 15 → 16 a person saw and could not
     * explain. ⚠️ Its three neighbours above were asserted by name and this one was not, so
     * correcting it would otherwise have passed every existing test and been revertible in
     * silence.
     */
    it('🔴 …and it says WHICH launch, because a reopened conversation is handed today’s set', () => {
      expect(sentence).toContain('at its most recent launch')
      expect(sentence, 'the sentence a reopened conversation makes false').not.toContain(
        'when it started',
      )
      // ⚑ The pair, one fact over: the PUBLISHED sentence never made this claim, so the absence
      // above is about this reading rather than about a phrase no reading ever had.
      expect(readInventory(claude).provenance).not.toContain('most recent launch')
    })

    it('⛔ and makes neither of the two promises it used to', () => {
      expect(sentence, 'the delivery promise is back').not.toContain('can call them')
      // ⚑ The pair: the PUBLISHED sentence is a different sentence, so the three clauses above are
      // about this reading rather than about prose every reading happens to share.
      const published = readInventory(claude).provenance
      expect(published).not.toContain('Not a complete account')
      expect(published).toContain('Not from a config file')
    })
  })
})

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   444 relay 1 · a count that says WHEN it was true, in 438's register and not a second one
   ═════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * ⛔ **Prose stripped before any census below**, because three of these assertions are about what
 * the CODE does and every one of these files explains itself at length — a `toContain` a docblock
 * satisfies passes over code that does not exist, and its mirror goes red over a comment
 * describing its own success (`a-source-census-must-strip-prose-before-it-asserts`).
 */
const code = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('444 relay 1 · the inventory says as-of-when', () => {
  const WHEN = Date.UTC(2023, 4, 17, 9, 41, 7)

  describe('the moment, and the silence when there is none', () => {
    it('⛔ a reading with no moment draws NO line — never a zero and never 1970', () => {
      const nothing = readInventory(registry(null, 0, null))
      expect(nothing.at).toBeNull()
      expect(inventoryAsOf(nothing), 'an absent moment must be silence').toBeNull()
      // ⚑ **The pair, one fact over**: the SAME reading with a moment does produce a line, so the
      // `null` above is the absent-moment arm rather than a function that never answers.
      expect(inventoryAsOf(readInventory(registry(null, 0, WHEN)))).not.toBeNull()
    })

    /**
     * ⛔ **A moment the FORMATTER refuses draws nothing either** (444, found reviewing this diff).
     *
     * ⚑ **`at === null` is not the only absence.** `fullTime` answers the empty string for a NaN,
     * for `undefined`, and for anything past `Intl`'s TimeClip bound — and a guard on `null`
     * alone let those through as the dangling fragment `'Stated '`, which is non-null, so the
     * surface drew it. ⚠️ **It was rendering on screen in `overlays-on-paper.dom.test.ts`** the
     * whole time, through a `ToolRegistry` literal `vue-tsc` could not see.
     */
    it('⛔ …and a moment the formatter refuses is an absence, not a dangling `Stated `', () => {
      // ⚑ The three shapes `fullTime` refuses, from its own guard rather than from a guess.
      for (const refused of [Number.NaN, 8.64e15 + 1, -8.64e15 - 1]) {
        const reading = readInventory(registry(null, 0, refused))
        expect(reading.at, 'the reading dropped the value before the formatter saw it').toBe(
          refused,
        )
        expect(inventoryAsOf(reading), `${String(refused)} produced a line`).toBeNull()
      }
      // ⛔ **The pair, one fact over**: a good instant through the SAME call still produces one,
      // so the three nulls above are the refusal arm and not a function that stopped answering.
      const good = inventoryAsOf(readInventory(registry(null, 0, WHEN)))
      expect(good).not.toBeNull()
      expect(good, 'the guard swallowed the text as well as the time').toContain('Stated ')
    })

    it('🔴 …and the line carries the whole date, not a bare wall clock', () => {
      const line = inventoryAsOf(readInventory(registry(null, 0, WHEN)))
      expect(line).not.toBeNull()
      // ⛔ **Derived from the instant this test states**, never typed beside it: a conversation
      // launched yesterday and read today would show a bare `09:41` that a person reads as this
      // morning, and a locale-formatted date is the only thing that cannot be misread that way.
      expect(line, 'the year is missing, so the moment is ambiguous across days').toContain(
        String(new Date(WHEN).getFullYear()),
      )
      expect(line).toContain('Stated')
    })

    it('⛔ the moment reaches the reading from the registry, on every arm', () => {
      // ⚠️ Both return arms of `readInventory`, because a field copied into one of two branches is
      // the defect this file has caught twice (`one-failure-is-not-the-failure-shape`).
      expect(readInventory(registry(null, 0, WHEN)).kind).toBe('untold')
      expect(readInventory(registry(null, 0, WHEN)).at).toBe(WHEN)
      const told = registry(
        { naming: CLAUDE_NAMING, declared: DECLARED, published: PUBLISHED },
        0,
        WHEN,
      )
      expect(readInventory(told).kind).toBe('published')
      expect(readInventory(told).at).toBe(WHEN)
      const unpublished = registry(
        { naming: CODEX_NAMING, declared: DECLARED, published: null },
        0,
        WHEN,
      )
      expect(readInventory(unpublished).kind).toBe('unpublished')
      expect(readInventory(unpublished).at).toBe(WHEN)
    })
  })

  describe('the sentence, whose load-bearing clauses are asserted by name', () => {
    it('🔴 it names the act that updates the count', () => {
      expect(TOOLS_ARE_AS_OF_A_STATEMENT).toContain('reopening it is what makes this current')
    })

    /**
     * ⛔ **And it names the act that does NOT** — measured, not assumed. A window reload
     * re-ATTACHES a held session (`handover: 'attached'`), which launches nothing and emits no
     * new inventory, so *"reopen"* meaning *"reload"* would be a remedy that does not work.
     * `425`'s rule applies to copy as much as to rails: tell them the act, or tell them nothing.
     */
    it('🔴 …and the act that does not', () => {
      expect(TOOLS_ARE_AS_OF_A_STATEMENT).toContain('Reloading the window does not')
    })

    /**
     * 🔴 **It may NOT say the provider published this.** Every count a person reads is the
     * DECLARED half — what BroBot handed over — and Codex's `published` is hard-coded `null` for
     * ever, so *"the provider published"* is false on one of the two engines. ⚑ The register is
     * still `observed`: the engine watched this conversation STATE its inventory.
     */
    it('⛔ it claims no provider publication, in any of the spellings that would', () => {
      const said = TOOLS_ARE_AS_OF_A_STATEMENT.toLowerCase()
      for (const spelling of [
        'provider published',
        'published by',
        'confirmed by',
        'the provider',
      ]) {
        expect(said, `the sentence claims ${spelling}`).not.toContain(spelling)
      }
      // ⚑ **The control, and it runs the SAME FOUR NEEDLES over a string that DOES make the
      // claim** — a first draft looked for a different phrase in a different haystack, which
      // proved only that `String.prototype.includes` works. ⛔ Two of the four are spellings no
      // version of this sentence has ever carried, so without this they would be absences of
      // something unreachable.
      const claiming =
        'the provider published this inventory: published by the provider, confirmed by it'
      for (const spelling of [
        'provider published',
        'published by',
        'confirmed by',
        'the provider',
      ]) {
        expect(claiming, `the scan cannot see ${spelling}`).toContain(spelling)
      }
    })
  })

  describe('438’s vocabulary, reused rather than forked', () => {
    it('🔴 the sheet imports REGISTER_WORDS and declares no register words of its own', () => {
      const sheet = code('../src/renderer/src/components/SessionTools.vue')
      expect(sheet).toContain("from '../lib/digest'")
      expect(sheet).toContain('REGISTER_WORDS.observed')

      // ⛔ **No second vocabulary.** A component that spelled the word itself would be `439`'s
      // finding with a new noun — a register that means one thing in `DigestCard` and another
      // here. The tell is either shape: a key named for a register, or the TITLE copied across.
      const forked = (text: string): boolean =>
        /\bobserved\s*:/.test(text) || text.includes('the engine watched this happen')
      expect(forked(sheet), 'the sheet spells a register word instead of importing it').toBe(false)

      // ⚑ **The control, planted and trapped the way the subject is** — both halves of the
      // predicate fire on a fork, so the `false` above is a measurement and not a regex that
      // matches nothing in this codebase's style.
      expect(forked("const WORDS = { observed: { label: 'observed' } }")).toBe(true)
      expect(forked("title: 'the engine watched this happen'")).toBe(true)
      // …and it fires on the module that legitimately declares them, which is the real artefact.
      expect(forked(code('../src/renderer/src/lib/digest.ts'))).toBe(true)
    })

    it('⛔ …and it is not drawn as a GAP, which is the opposite case', () => {
      const sheet = code('../src/renderer/src/components/SessionTools.vue')
      // A `DigestGap` says *the ledger cannot answer this*, with a count. Here the ledger answers.
      for (const spelling of ['DigestGap', 'digestGap', 'DIGEST_GAP']) {
        expect(sheet, `the as-of line is drawn as a gap (${spelling})`).not.toContain(spelling)
      }
      // ⚑ The control: the vocabulary it does NOT use is a real export, so these are absences of
      // something reachable rather than of something that does not exist.
      expect(code('../src/shared/digest.ts')).toContain('DIGEST_GAP_KINDS')
    })
  })
})
