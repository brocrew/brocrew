import { describe, expect, it } from 'vitest'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  agentNote,
  bandedResults,
  buildCommands,
  commandDetail,
  groupLabel,
  inGroup,
  runnable,
  type PaletteAgent,
  type PaletteCommand,
} from '../src/renderer/src/lib/command-palette'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { carryForward, foldWindow } from '../src/renderer/src/lib/transcript-window'

/**
 * **The commands the agent already has** (279) — the renderer half.
 *
 * ⛔ **The fixture is the live catalogue, cut down**, and the two providers are BOTH here on purpose.
 * `probe:provider-commands` measured Claude publishing 44 `/`-typed rows that mix its built-ins with
 * its skills, and Codex publishing 6 `$`-typed skills with no slash command anywhere on its
 * protocol. A suite that exercised one of them would pass over a palette telling a Codex user to
 * type `/compact` — which is the defect `279` §2's *"visibly distinguishable"* exists to prevent.
 *
 * ## ⚠️ What `desktop` cannot see, and what is asserted here anyway
 *
 * This project is SSR: it renders once and cannot press a key, so *"Enter does not run a listed
 * row"* is `agent-commands.dom.test.ts`'s. What lives here is the part that decides it —
 * {@link runnable}, the band, and the four sentences — plus the FOLD, which no browser test reaches.
 *
 * ⛔ **Every negative assertion below is paired with a positive one** (`brobot2-ssr-tests-pass-
 * vacuously`): *"the band is absent"* passes just as happily over a palette that builds no bands at
 * all, so each one says what IS there beside what is not.
 */

const CLAUDE_SET = {
  prefix: '/',
  commands: [
    {
      name: 'compact',
      description: 'Free up context by summarizing the conversation so far',
      argumentHint: '<optional custom summarization instructions>',
    },
    {
      name: 'usage',
      description: "Show session cost, plan usage, and what's contributing to your limits",
      aliases: ['cost', 'stats'],
    },
    { name: 'code-review', description: 'Review the current diff for correctness bugs' },
  ],
}

const CODEX_SET = {
  prefix: '$',
  commands: [
    { name: 'imagegen', description: 'Generate or edit images for websites, games, and more' },
    { name: 'review-agent', description: 'Find actionable bugs in code changes' },
  ],
}

const claude = (over: Partial<PaletteAgent> = {}): PaletteAgent => ({
  provider: 'claude',
  set: CLAUDE_SET,
  dropped: 0,
  ...over,
})

function palette(agent: PaletteAgent | null): PaletteCommand[] {
  return buildCommands({
    // ⚑ **D-017b · the rail's one list** — one row per conversation, whatever it is doing.
    conversations: [
      {
        sessionId: 'sess_a',
        provider: 'claude',
        label: 'workspace-a',
        // ⚑ D-016 · commit 7 · R2 — a conversation holding no piece: titled by its label.
        named: null,
        word: 'idle',
        opening: null,
        place: null,
      },
    ],
    activeId: 'sess_a',
    agent,
  })
}

describe('279 · the band, and what it says it is', () => {
  it('⛔ writes each command the way its own provider writes it — the sigil is measured, not styled', () => {
    const onClaude = inGroup(palette(claude()), 'agent').map((row) => row.title)
    expect(onClaude).toEqual(['/compact', '/usage', '/code-review'])

    const onCodex = inGroup(
      palette({ provider: 'codex', set: CODEX_SET, dropped: 0 }),
      'agent',
    ).map((row) => row.title)
    expect(onCodex).toEqual(['$imagegen', '$review-agent'])
    // ⛔ **The pairing that matters.** A prefix hard-coded anywhere would pass the Claude assertion
    // above and tell a Codex user to type something the agent will not answer to.
    expect(onCodex.join(' '), 'and no slash reaches a Codex row').not.toContain('/')
  })

  it('⛔ names the provider in the heading — §2’s "visibly distinguishable"', () => {
    // ⚠️ **`Claude`, capital C, through the app's own `PROVIDER_NAME` table** — `151`'s register
    // (*"name the two programs"*) applied by `169` §2. The first draft of this band printed the raw
    // `meta.provider` and read *"claude's own commands"*, which is the kind of thing
    // `reading-pane.render.test.ts` exists to keep out of the renderer (found in this dispatch's own
    // review).
    expect(groupLabel('agent', claude())).toBe("Claude's own commands")
    expect(groupLabel('agent', { provider: 'codex', set: CODEX_SET, dropped: 0 })).toBe(
      "Codex's own commands",
    )
    // …while BroBot's own bands keep the rail's vocabulary, which is the other half of the contrast.
    expect(groupLabel('conversations', claude())).toBe('Conversations')
    expect(groupLabel('go', claude())).toBe('Go to')
  })

  it('⛔ is drawn LAST, so 44 rows cannot push your conversations below the fold', () => {
    const bands = bandedResults(palette(claude()), '').map((band) => band.group)
    expect(bands).toContain('agent')
    expect(bands[bands.length - 1], 'the agent band is last on an empty query').toBe('agent')
    expect(bands[0], 'and the conversation you are looking at is still first').toBe('this')
  })

  it('⚑ …and ranking lifts it the moment it is the best answer', () => {
    // The other half of the rule above: browsing puts it last, searching does not. `compact` matches
    // no conversation in this fixture and the agent row's title starts with it.
    const bands = bandedResults(palette(claude()), 'compact')
    expect(bands.map((band) => band.group)).toEqual(['agent'])
    expect(bands[0]!.rows.map((row) => row.title)).toEqual(['/compact'])
  })

  it('⛔ finds a command by its bare name and by an ALIAS the row never draws', () => {
    // `keywords`' own promise, kept: matched and never displayed. `/cost` is not a title anywhere.
    const byBareName = bandedResults(palette(claude()), 'usage').flatMap((band) => band.rows)
    expect(byBareName.map((row) => row.title)).toContain('/usage')

    // ⚠️ **`stats` rather than `cost`, and the difference is a real property of the live row.**
    // `/usage`'s own description says *"Show session cost, plan usage…"*, so a query of `cost`
    // matches the DETAIL and would have proved nothing about aliases — the assertion would have
    // passed with `keywords` empty. `stats` appears in neither the title nor the description, so the
    // only way this row can be found by it is the alias.
    const byAlias = bandedResults(palette(claude()), 'stats').flatMap((band) => band.rows)
    expect(
      byAlias.map((row) => row.title),
      'an alias finds its command',
    ).toEqual(['/usage'])
    expect(
      [...byAlias.map((row) => row.title), ...byAlias.map((row) => row.detail ?? '')].join(' '),
      '…and the alias itself is nowhere on screen',
    ).not.toContain('stats')
  })

  it('⛔ collapses the whitespace one live description really carries', () => {
    // Measured: 1 of the 44 has newlines — `/claude-api`'s multi-line TRIGGER block. `.palette-row
    // small` is one clipped line, and the collapsed string is also what `score` searches and what a
    // hover would show.
    expect(commandDetail('first line\n\nsecond   line')).toBe('first line second line')
    // The hint is appended rather than dropped: 17 of 44 carry one and it is most of what a person
    // needs — `/code-review` without its `[--fix]` is a command you cannot use.
    expect(commandDetail('Review the diff', '[low|high] [--fix]')).toBe(
      'Review the diff · takes [low|high] [--fix]',
    )
    // Absent, never blank (`211` §3) — and paired, so this is not a test over an always-null return.
    expect(commandDetail(undefined, undefined)).toBeNull()
    expect(commandDetail('', '  ')).toBeNull()
    expect(commandDetail(undefined, '[pr]')).toBe('takes [pr]')
  })
})

describe('279 · listed, not run (§3)', () => {
  it('⛔ no agent row is runnable, and every BroBot row still is', () => {
    const rows = palette(claude())
    const agentRows = inGroup(rows, 'agent')
    expect(agentRows.length, 'the band really has rows to be unrunnable').toBe(3)
    expect(agentRows.every((row) => !runnable(row))).toBe(true)
    expect(agentRows.every((row) => row.action === null)).toBe(true)
    // ⛔ **The pairing.** A `runnable` that returned false for everything would satisfy the line
    // above and quietly disable the whole palette.
    const ours = rows.filter((row) => row.group !== 'agent')
    expect(ours.length).toBeGreaterThan(0)
    expect(ours.every(runnable), "BroBot's own rows are untouched").toBe(true)
  })

  it('⛔ says out loud that it lists them and does not run them', () => {
    const said = agentNote(claude())!
    expect(said).toContain('3 commands')
    expect(said).toContain('Type one with /')
    expect(said, '§3: honest as long as it says so').toContain('does not run them')
  })
})

describe('279 · the four states, told apart', () => {
  it('⛔ nobody has told us — and that is NOT "this agent has no commands" (§2)', () => {
    const untold = agentNote(claude({ set: null }))!
    expect(untold).toContain('has not been told')
    expect(untold, 'and it names the program the way a person reads it').toContain('Claude')
    // …and no band is built, so there is no empty section pretending the agent had none.
    expect(inGroup(palette(claude({ set: null })), 'agent')).toEqual([])
    // ⛔ **Paired**: the same palette still builds its own rows, so the absence above is about the
    // agent band and not about a `buildCommands` that returned nothing.
    expect(palette(claude({ set: null })).length).toBeGreaterThan(0)
  })

  it('⛔ …and the provider answering with NOTHING is a different sentence', () => {
    const none = agentNote(claude({ set: { prefix: '/', commands: [] } }))!
    expect(none).toContain('reports no commands of its own')
    expect(none, 'it does not claim we were never told').not.toContain('has not been told')
  })

  it('⛔ no conversation on screen says nothing at all — absence is the honest rendering', () => {
    expect(agentNote(null)).toBeNull()
    // ⚠️ Paired with the three states that DO speak, so this is not a note that never returns a
    // sentence. `undefined` lands here too: the two readers of a missing agent must agree.
    expect(agentNote(undefined)).toBeNull()
    expect(agentNote(claude())).not.toBeNull()
  })

  it('⛔ a shortfall is SAID, in the same sentence, rather than shown as a shorter list', () => {
    const short = agentNote(claude({ dropped: 4 }))!
    expect(short).toContain('4 more could not be listed')
    expect(short, 'and the count it DID list is right there beside it').toContain('3 commands')
    expect(agentNote(claude())!, 'the ordinary case says nothing').not.toContain(
      'could not be listed',
    )
  })

  it('one command reads as one, not as "1 commands"', () => {
    const one = agentNote(claude({ set: { prefix: '/', commands: [{ name: 'compact' }] } }))!
    expect(one).toContain('1 command of its own')
  })
})

describe('279 · the fold, which no browser test reaches', () => {
  it('⛔ starts at `null` — untold, which is not an empty list', () => {
    const state = createTranscript()
    expect(state.commands.set).toBeNull()
    expect(state.commands.dropped).toBe(0)
  })

  it('⛔ REPLACES the list rather than appending — §4’s level test', () => {
    const state = createTranscript()
    applyEvent(state, {
      type: 'provider_commands',
      commands: [{ name: 'compact' }, { name: 'usage' }],
      prefix: '/',
      source: 'initializationResult',
    })
    expect(state.commands.set!.commands.map((c) => c.name)).toEqual(['compact', 'usage'])

    // A mid-session `commands_changed`: skills discovered as the agent moved into a subdirectory.
    applyEvent(state, {
      type: 'provider_commands',
      commands: [{ name: 'compact' }, { name: 'deploy' }],
      prefix: '/',
      source: 'commands_changed',
    })
    expect(state.commands.set!.commands.map((c) => c.name)).toEqual(['compact', 'deploy'])
    // ⛔ **The assertion the dispatch asks for by name.** A merge would keep `usage` for ever — a
    // skill deleted mid-session made immortal, which is `222`'s stale indicator in another hat.
    expect(state.commands.set!.commands.map((c) => c.name)).not.toContain('usage')
    expect(state.commands.set!.commands).toHaveLength(2)
  })

  it('⛔ an empty list CLEARS it, and the two nulls stay apart', () => {
    const state = createTranscript()
    applyEvent(state, {
      type: 'provider_commands',
      commands: [{ name: 'compact' }],
      prefix: '/',
      source: 'initializationResult',
    })
    applyEvent(state, {
      type: 'provider_commands',
      commands: [],
      prefix: '/',
      source: 'commands_changed',
    })
    // ⚠️ `[]` — the provider answered — and NOT back to `null`, which would mean nobody had asked.
    expect(state.commands.set).not.toBeNull()
    expect(state.commands.set!.commands).toEqual([])
  })

  it('⛔ the prefix and the shortfall travel WITH the list, replaced together', () => {
    const state = createTranscript()
    applyEvent(state, {
      type: 'provider_commands',
      commands: [{ name: 'compact' }],
      prefix: '/',
      dropped: 3,
      source: 'initializationResult',
    })
    expect(state.commands).toMatchObject({ dropped: 3 })
    expect(state.commands.set!.prefix).toBe('/')
    // A later frame with no shortfall clears it: a count about a list you are no longer showing is
    // a number about nothing.
    applyEvent(state, {
      type: 'provider_commands',
      commands: [{ name: 'compact' }, { name: 'usage' }],
      prefix: '/',
      source: 'commands_changed',
    })
    expect(state.commands.dropped).toBe(0)
  })

  it('⛔ survives a window release — the level is stated ONCE and there is no next one', () => {
    const at = (ordinal: number, event: TranscriptEvent): RuntimeEventMessage => ({
      sessionId: 'sess_a',
      ordinal,
      at: 1_800_000_000_000 + ordinal,
      event,
    })
    const level: TranscriptEvent = {
      type: 'provider_commands',
      commands: [{ name: 'compact' }, { name: 'usage' }],
      prefix: '/',
      source: 'initializationResult',
    }
    const before = foldWindow([at(0, level), at(1, { type: 'assistant_message', text: 'hi' })])
    expect(before.commands.set!.commands).toHaveLength(2)

    // The slab holding the level is released; only the tail survives.
    const retained = [at(1, { type: 'assistant_message', text: 'hi' })]
    // ⛔ **The control, and it is what makes the carry assertion mean anything.** A cold fold of the
    // suffix has never been told, because the only frame that ever said so is gone.
    expect(foldWindow(retained).commands.set, 'without the carry the band would vanish').toBeNull()

    const after = foldWindow(retained, null, carryForward(before, retained))
    expect(after.commands.set!.commands.map((c) => c.name)).toEqual(['compact', 'usage'])
    expect(after.commands.set!.prefix).toBe('/')
  })

  it('⛔ …and a suffix that restates the level still WINS over the carry', () => {
    const at = (ordinal: number, event: TranscriptEvent): RuntimeEventMessage => ({
      sessionId: 'sess_a',
      ordinal,
      at: 1_800_000_000_000 + ordinal,
      event,
    })
    const before = foldWindow([
      at(0, {
        type: 'provider_commands',
        commands: [{ name: 'old' }],
        prefix: '/',
        source: 'initializationResult',
      }),
    ])
    const retained = [
      at(1, {
        type: 'provider_commands',
        commands: [{ name: 'new' }],
        prefix: '/',
        source: 'commands_changed',
      }),
    ]
    // The rule a carry has to keep: it may not change what a fold of the same events would produce.
    const after = foldWindow(retained, null, carryForward(before, retained))
    expect(after.commands.set!.commands.map((c) => c.name)).toEqual(['new'])
  })

  it('⛔ the carry COPIES the list — two folds cannot come to share one array', () => {
    const at = (ordinal: number, event: TranscriptEvent): RuntimeEventMessage => ({
      sessionId: 'sess_a',
      ordinal,
      at: 1_800_000_000_000 + ordinal,
      event,
    })
    const before = foldWindow([
      at(0, {
        type: 'provider_commands',
        commands: [{ name: 'compact' }],
        prefix: '/',
        source: 'initializationResult',
      }),
    ])
    const carry = carryForward(before, [])
    expect(carry.commands.set).not.toBe(before.commands.set)
    expect(carry.commands.set!.commands).not.toBe(before.commands.set!.commands)
    expect(carry.commands.set!.commands).toEqual(before.commands.set!.commands)
  })

  it('⛔ …and `null` is carried as `null`, never manufactured into an empty set', () => {
    const before = createTranscript()
    expect(carryForward(before, []).commands.set).toBeNull()
  })
})
