import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { normalizeMessage } from '../src/claude/normalize'
import { readCodexSkill } from '../src/codex/normalize'
import {
  boundCommands,
  MAX_COMMAND_ALIASES,
  MAX_COMMAND_NAME,
  MAX_COMMAND_TEXT,
  MAX_PROVIDER_COMMANDS,
  MAX_SKILL_PATH,
} from '../src/provider-commands'
import { capabilitiesFor, parseRuntimeEvent, type RuntimeEvent } from '../src/index'

/**
 * **The commands the agent already has** (279) — the runtime half.
 *
 * ⛔ **Every fixture below is verbatim from `probe:provider-commands`**, not composed from the
 * vendored types. That probe opened a real Claude login with a prompt that never yields (no turn, no
 * tokens) and asked the bundled Codex binary before any thread started; what came back is the whole
 * reason this dispatch's copy says what it says:
 *
 * ```
 * claude · initializationResult().commands   44 rows in 1 918 ms
 *          supportedCommands()                same 44 names in 0 ms  ← cached, so init is free
 *          44/44 description · 17/44 argumentHint · 7/44 aliases · longest description 1 135
 * codex  · skills/list                        6 rows, all scope:"system", all enabled
 *          plugin/list                        marketplaces — not commands
 *          collaborationMode/list             Plan, Default — MODES, not commands
 *          hooks/list                         nothing
 * ```
 *
 * ⚠️ **The finding a suite written from the types would have missed** is that these are two
 * different vocabularies: Claude's 44 mix its built-ins with its skills and are typed `/name`;
 * Codex's 6 are skills, typed `$name`, and **none of the six appears among the forty-four**. A test
 * that asserted "both providers publish commands" would pass over a palette telling a Codex user to
 * type `/compact`.
 */

function sdk(message: Record<string, unknown>): SDKMessage {
  return message as unknown as SDKMessage
}

/** `commands_changed` — the PUSH, carrying a whole replacement list. */
const pushed = (commands: unknown[]): SDKMessage =>
  sdk({ type: 'system', subtype: 'commands_changed', commands, session_id: 's', uuid: 'u' })

/** Four of the 44, verbatim — the one with aliases, the one with a hint, and two plain ones. */
const COMPACT = {
  name: 'compact',
  description: 'Free up context by summarizing the conversation so far',
  argumentHint: '<optional custom summarization instructions>',
}
const USAGE = {
  name: 'usage',
  description: "Show session cost, plan usage, and what's contributing to your limits",
  argumentHint: '',
  aliases: ['cost', 'stats'],
}
const REVIEW = { name: 'review', description: 'Review a GitHub pull request', argumentHint: '[pr]' }

function commandsOf(
  events: RuntimeEvent[],
): Extract<RuntimeEvent, { type: 'provider_commands' }>[] {
  return events.filter(
    (event): event is Extract<RuntimeEvent, { type: 'provider_commands' }> =>
      event.type === 'provider_commands',
  )
}

describe('279 · what Claude pushes', () => {
  it('⛔ turns a `commands_changed` frame into a whole list, prefix and all', () => {
    const events = normalizeMessage(pushed([COMPACT, USAGE]))
    const [level] = commandsOf(events)
    expect(level, 'a `commands_changed` frame produces a level event').toBeDefined()
    expect(level!.commands.map((command) => command.name)).toEqual(['compact', 'usage'])
    expect(level!.prefix, 'Claude commands are typed with a slash — measured on 44 live rows').toBe(
      '/',
    )
    expect(level!.source).toBe('commands_changed')
    // The optional fields are carried rather than flattened: 17 of 44 have a hint and 7 aliases,
    // and both are what a person actually searches this band with.
    expect(level!.commands[0]!.argumentHint).toBe(COMPACT.argumentHint)
    expect(level!.commands[1]!.aliases).toEqual(['cost', 'stats'])
    // ⚠️ **An empty `argumentHint` is DROPPED rather than travelling as a blank** — the provider
    // sends `''` for "none" on 27 of the 44, and a surface testing for it would be testing for a
    // string the palette must not draw.
    expect(level!.commands[1]!.argumentHint).toBeUndefined()
  })

  it('⛔ …and the frame is still on the raw stream, beside the level — never instead of it', () => {
    const events = normalizeMessage(pushed([COMPACT]))
    // ⚑ `247`'s construction and `245`'s ruling: the classification stays `lifecycle`, so a reader
    // checking what the provider really said still has the payload. A normalizer that CONSUMED the
    // frame would be moving a fact rather than adding one.
    expect(commandsOf(events)).toHaveLength(1)
    const chatter = events.find((event) => event.type === 'unknown')
    expect(chatter, 'the raw frame survives as classified chatter').toBeDefined()
    expect(chatter).toMatchObject({ type: 'unknown', category: 'lifecycle' })
  })

  it('⛔ a payload it cannot read produces NO event — an unreadable frame is not an empty list', () => {
    // ⚠️ **The direction that matters.** `commands: []` is the provider saying this agent has none,
    // which is what empties the palette's band; inventing that from a malformed frame would empty it
    // on exactly the traffic we understood least. Paired with the positive below so this is not a
    // test that would pass over a normalizer producing nothing at all.
    expect(commandsOf(normalizeMessage(pushed(undefined as unknown as unknown[])))).toEqual([])
    expect(commandsOf(normalizeMessage(pushed('not-a-list' as unknown as unknown[])))).toEqual([])
    const empty = commandsOf(normalizeMessage(pushed([])))
    expect(empty, 'but a real empty list IS an event — the provider answered').toHaveLength(1)
    expect(empty[0]!.commands).toEqual([])
  })

  it('⛔ REPLACES rather than appends — the SDK says so and this is the level rule (§4)', () => {
    // The SDK's own instruction: *"Clients should REPLACE their cached command list with this
    // payload."* Every frame carries a whole list, so the second one cannot be read as a delta —
    // there is no shape in which it could be. ⚠️ Asserted on the EVENTS here and on the registry in
    // `apps/desktop/test/agent-commands.test.ts`, because the two could disagree.
    const first = commandsOf(normalizeMessage(pushed([COMPACT, USAGE])))[0]!
    const second = commandsOf(normalizeMessage(pushed([REVIEW])))[0]!
    expect(first.commands.map((c) => c.name)).toEqual(['compact', 'usage'])
    expect(second.commands.map((c) => c.name)).toEqual(['review'])
    expect(
      second.commands.map((c) => c.name),
      'and it does not carry the earlier two',
    ).not.toContain('compact')
  })

  it('⛔ every emitted event survives the IPC boundary — the bounds are the schema', () => {
    // `toWireEvent` re-validates, and a level that failed would be degraded to `unknown` and lost.
    // ⚠️ The long row is the one that matters: the live catalogue's longest description is 1 135
    // characters and `MAX_COMMAND_TEXT` is 500, so this is the exact string that would fail a schema
    // one character narrower than the clip — `background_work`'s 201 exists because of that bug.
    const long = { name: 'typeable', description: 'y'.repeat(4000), argumentHint: 'z'.repeat(900) }
    const [level] = commandsOf(normalizeMessage(pushed([COMPACT, long])))
    expect(parseRuntimeEvent(level!).ok, 'a bounded level parses').toBe(true)
    expect(level!.commands[1]!.description!.length).toBeLessThanOrEqual(MAX_COMMAND_TEXT)
    expect(level!.commands[1]!.description!.endsWith('…'), 'and it says it was cut').toBe(true)
    expect(level!.commands[1]!.argumentHint!.length).toBeLessThanOrEqual(MAX_COMMAND_TEXT)
  })

  it('⛔ a NAME too long to type is dropped and counted, never clipped', () => {
    // ⛔ **`MAX_COMMAND_NAME`'s own rule, and the first draft of this file broke it** (found in this
    // dispatch's own review). The bound clipped, which would have put `/xxxx…` on screen inviting a
    // person to type a command that does not exist — `106` reached by being tidy. Shortening a
    // DESCRIPTION costs a reader some words; shortening a NAME costs them the command.
    const level = commandsOf(
      normalizeMessage(pushed([COMPACT, { name: 'x'.repeat(MAX_COMMAND_NAME + 1) }])),
    )[0]!
    expect(level.commands.map((c) => c.name)).toEqual(['compact'])
    expect(level.dropped, 'and it is SAID, as a nameless row is').toBe(1)
    // ⚠️ Paired: a name exactly ON the bound is kept whole, so this is not a test over a filter that
    // rejects everything.
    const at = commandsOf(normalizeMessage(pushed([{ name: 'x'.repeat(MAX_COMMAND_NAME) }])))[0]!
    expect(at.commands[0]!.name.length).toBe(MAX_COMMAND_NAME)
    expect(at.dropped ?? 0).toBe(0)
  })
})

describe('279 · the ONE bounding rule', () => {
  it('⛔ counts what it dropped, for BOTH reasons, rather than showing a shorter list', () => {
    // `092`'s no-silent-cap rule in `247`'s wording: *"a registry that quietly undercounts is worse
    // than none."* Two reasons, deliberately counted together — past the cap, and no usable name.
    const overCap = Array.from({ length: MAX_PROVIDER_COMMANDS + 7 }, (_, at) => ({
      name: `c${at}`,
    }))
    expect(boundCommands(overCap).commands).toHaveLength(MAX_PROVIDER_COMMANDS)
    expect(boundCommands(overCap).dropped).toBe(7)

    const nameless = boundCommands([{ name: 'real' }, { name: '' }, { name: '   ' }])
    expect(nameless.commands.map((c) => c.name)).toEqual(['real'])
    expect(nameless.dropped, 'a command with no name cannot be typed and is SAID').toBe(2)

    // The ordinary case says nothing, which is what makes a non-zero count readable as news.
    expect(boundCommands([COMPACT, USAGE]).dropped).toBe(0)
  })

  it('⛔ clips INCLUSIVE of the ellipsis — the off-by-one `background_work` had to write 201 for', () => {
    const at = boundCommands([{ name: 'a', description: 'y'.repeat(MAX_COMMAND_TEXT) }])
    expect(at.commands[0]!.description, 'exactly at the bound is untouched').toBe(
      'y'.repeat(MAX_COMMAND_TEXT),
    )
    const over = boundCommands([{ name: 'a', description: 'y'.repeat(MAX_COMMAND_TEXT + 1) }])
    expect(over.commands[0]!.description!.length, 'one past it lands ON the bound').toBe(
      MAX_COMMAND_TEXT,
    )
    expect(over.commands[0]!.description!.endsWith('…')).toBe(true)
  })

  it('⛔ bounds the aliases too, and drops the empty and the untypeable ones', () => {
    const many = Array.from({ length: MAX_COMMAND_ALIASES + 3 }, (_, at) => `a${at}`)
    const bounded = boundCommands([
      { name: 'usage', aliases: [...many, '', 'x'.repeat(MAX_COMMAND_NAME + 1)] },
    ])
    expect(bounded.commands[0]!.aliases).toHaveLength(MAX_COMMAND_ALIASES)
    // An alias is matched and never drawn, so a clipped one is a string that can only fail to match.
    expect(bounded.commands[0]!.aliases!.every((alias) => alias.length <= MAX_COMMAND_NAME)).toBe(
      true,
    )
    // ⚠️ **NOT counted in `dropped`, and that is deliberate.** That number means *"this list is
    // understating what the agent has"* — a command is still listed and still typeable when an
    // alternate name for it was not carried, so folding it in would report a missing command that
    // is right there on screen.
    expect(bounded.dropped).toBe(0)
  })
})

describe('279 · what Codex publishes, which is not the same thing', () => {
  /** Two of the six, verbatim from `skills/list` — the one with an interface, and a bare one. */
  const IMAGEGEN = {
    name: 'imagegen',
    description:
      'Generate or edit raster images when the task benefits from AI-created bitmap visuals such as photos, illustrations, textures, sprites, mockups, or transparent-background cutouts.',
    interface: {
      displayName: 'Image Gen',
      shortDescription: 'Generate or edit images for websites, games, and more',
      defaultPrompt: 'Use $imagegen to make or edit an image for this project.',
    },
    scope: 'system',
    enabled: true,
  }

  it('⛔ prefers the sentence written for a PERSON over the trigger written for the model', () => {
    // ⚠️ **Measured, and this is the finding rather than a preference.** Both fields are present on
    // every one of the six live rows and they are not the same sentence: `shortDescription` is 52
    // characters aimed at a reader, `description` is a trigger telling the model when to reach for
    // the skill. The palette draws one clipped line.
    expect(readCodexSkill(IMAGEGEN).description).toBe(
      'Generate or edit images for websites, games, and more',
    )
    // …and falls back rather than going blank when a skill ships no interface at all.
    expect(readCodexSkill({ name: 'bare', description: 'the trigger' }).description).toBe(
      'the trigger',
    )
    // A row with neither draws no second line rather than an empty one (`211` §3).
    expect(readCodexSkill({ name: 'silent' }).description).toBeUndefined()
  })

  it('⛔ carries no argument hint and no aliases, because the protocol declares neither', () => {
    // ⚠️ **An absence stated rather than assumed.** `SkillMetadata` has no field meaning *"and then
    // type this"*; inventing one from `interface.defaultPrompt` would put words in the provider's
    // mouth on the surface whose whole job is to report what it said. Paired with the positive
    // above so this is not a negative assertion over an empty read.
    const read = readCodexSkill(IMAGEGEN)
    expect(read.name).toBe('imagegen')
    expect(read.argumentHint).toBeUndefined()
    expect(read.aliases).toBeUndefined()
  })
})

describe('a Codex skill keeps its own file and the description the model is given', () => {
  const FICTIONAL = {
    name: 'brew-tea',
    description: 'Use when someone asks for tea: pick the leaves, the water and the time.',
    interface: { shortDescription: 'Brew a pot of tea' },
    path: '/fictional/home/skills/brew-tea/SKILL.md',
    scope: 'user',
    enabled: true,
  }

  it('⚑ its SKILL.md path, its scope and its model-facing description ride on the row', () => {
    const read = readCodexSkill(FICTIONAL)
    expect(read.description).toBe('Brew a pot of tea')
    expect(read.skill).toEqual({
      path: '/fictional/home/skills/brew-tea/SKILL.md',
      scope: 'user',
      description: 'Use when someone asks for tea: pick the leaves, the water and the time.',
    })
    // ⛔ A row with no path has no file to name.
    expect(readCodexSkill({ name: 'bare', description: 'x' }).skill).toBeUndefined()
  })

  it('⛔ the bound cuts a long description, and drops a path too long to be one', () => {
    const long = 'Steep it. '.repeat(80)
    const [kept] = boundCommands([readCodexSkill({ ...FICTIONAL, description: long })]).commands
    expect(kept?.skill?.description?.length).toBe(MAX_COMMAND_TEXT)
    expect(kept?.skill?.description?.endsWith('…')).toBe(true)
    const [far] = boundCommands([
      readCodexSkill({ ...FICTIONAL, path: `/${'a'.repeat(MAX_SKILL_PATH)}` }),
    ]).commands
    expect(far?.name).toBe('brew-tea')
    expect(far?.skill).toBeUndefined()
    // ⚑ …and the event takes the row whole.
    const event = parseRuntimeEvent({
      type: 'provider_commands',
      commands: [kept],
      prefix: '$',
      source: 'skills/list',
    })
    expect(
      event.ok && event.event.type === 'provider_commands' ? event.event.commands[0]?.skill : null,
    ).toEqual(kept?.skill)
  })
})

describe('279 · the capability says which of the two you are looking at', () => {
  it('⛔ both providers are `available` and the NOTE is what keeps that from being a lie', () => {
    const claude = capabilitiesFor('claude').agentCommands
    const codex = capabilitiesFor('codex').agentCommands
    // ⚠️ **Narrowed rather than cast, and the compiler is the reason this reads oddly.**
    // `CapabilityStatus` is a union whose `note` lives only on the `available` arm — so an assertion
    // about the note is only reachable after the state has been PROVED, which is the right order
    // anyway: a note on a capability that had become `unwired` would be describing something the app
    // no longer offers.
    if (claude.state !== 'available' || codex.state !== 'available') {
      throw new Error(`both providers publish a command list: ${claude.state} / ${codex.state}`)
    }
    // ⚠️ **`capabilities.ts`' own "available, but not the same thing" case.** Flattening both to a
    // state would invite a UI promising one and rendering the other — so the notes have to differ,
    // and Codex's has to say the thing a person will otherwise go looking for.
    expect(claude.note).not.toBe(codex.note)
    expect(codex.note, 'it names what Codex does NOT publish').toContain('no slash commands')
    expect(claude.note, "…and Claude's names the sigil that does work").toContain('slash')
  })
})
