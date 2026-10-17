import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  boundInventory,
  parametersOf,
  qualifyWith,
  splitQualified,
  CLAUDE_TOOL_NAMING,
  CODEX_TOOL_NAMING,
  MAX_DECLARED_TOOLS,
  MAX_PUBLISHED_SERVERS,
  MAX_PUBLISHED_TOOLS,
  MAX_TOOL_NAME,
  MAX_TOOL_PARAMETERS,
  MAX_TOOL_TEXT,
} from '../src/tool-inventory'

/**
 * 🔴 **358 · the one bounding rule, and the flattening both adapters share.**
 *
 * ⛔ **A cap is never silent** (`092`'s rule in `247`'s wording): a row this refuses is counted in
 * `dropped`, because *"a registry that quietly undercounts is worse than none."* Every bound below
 * is asserted at the boundary AND one past it, and the number is written as a LITERAL rather than
 * as the constant — a `repeat(MAX + 1)` moves with the cap and pins nothing.
 */
describe('bounding one inventory (358)', () => {
  const tool = (name: string, description = 'does a thing') => ({
    name,
    description,
    parameters: [] as { name: string; type: string; required: boolean; description?: string }[],
  })

  it('passes an ordinary inventory through unchanged, and drops nothing', () => {
    const bounded = boundInventory({
      naming: CLAUDE_TOOL_NAMING,
      declared: { server: 'brobot', instructions: 'reach the app', tools: [tool('spawn_agent')] },
      published: { tools: ['Bash'], servers: [{ name: 'brobot', status: 'connected' }] },
    })
    expect(bounded.dropped).toBe(0)
    expect(bounded.declared?.tools).toHaveLength(1)
    expect(bounded.published?.tools).toEqual(['Bash'])
    expect(bounded.naming).toEqual({ prefix: 'mcp__', separator: '__' })
  })

  it('⛔ carries `null` through both halves rather than manufacturing an empty one', () => {
    const bounded = boundInventory({
      naming: CODEX_TOOL_NAMING,
      declared: null,
      published: null,
    })
    expect(bounded.declared).toBeNull()
    expect(bounded.published).toBeNull()
    expect(bounded.dropped).toBe(0)
  })

  describe('⛔ a row with no usable name is DROPPED, and counted', () => {
    it('an empty or blank name never survives, on either half', () => {
      const bounded = boundInventory({
        naming: CLAUDE_TOOL_NAMING,
        declared: { server: 'brobot', tools: [tool('spawn_agent'), tool(''), tool('   ')] },
        published: {
          tools: ['Bash', '', '   '],
          servers: [
            { name: 'brobot', status: 'connected' },
            { name: '', status: 'failed' },
          ],
        },
      })
      // ⛔ **A nameless tool cannot be joined on and cannot be typed by a model.** Showing one is a
      // row a person cannot act on; dropping it silently is a list one short with nothing to say so.
      expect(bounded.declared?.tools.map((one) => one.name)).toEqual(['spawn_agent'])
      expect(bounded.published?.tools).toEqual(['Bash'])
      expect(bounded.published?.servers).toEqual([{ name: 'brobot', status: 'connected' }])
      // 2 declared + 2 published tools + 1 server = 5, counted together as one shortfall.
      expect(bounded.dropped, 'every dropped row is in the number').toBe(5)
    })

    it('…and a name too long to be typed is dropped rather than clipped', () => {
      // The literal, not the constant: `repeat(MAX_TOOL_NAME + 1)` moves with the cap and pins
      // nothing. 200 is the bound; 201 is one past it.
      expect(MAX_TOOL_NAME).toBe(200)
      const bounded = boundInventory({
        naming: CLAUDE_TOOL_NAMING,
        declared: { server: 'brobot', tools: [tool('a'.repeat(200)), tool('b'.repeat(201))] },
        published: null,
      })
      expect(bounded.declared?.tools.map((one) => one.name.length)).toEqual([200])
      expect(bounded.dropped).toBe(1)
    })
  })

  it('⛔ a DESCRIPTION is clipped rather than dropped — and the ellipsis is inside the bound', () => {
    expect(MAX_TOOL_TEXT).toBe(500)
    const bounded = boundInventory({
      naming: CLAUDE_TOOL_NAMING,
      declared: { server: 'brobot', tools: [tool('x', 'y'.repeat(501))] },
      published: null,
    })
    const description = bounded.declared?.tools[0]?.description ?? ''
    expect(description).toHaveLength(500)
    expect(
      description.endsWith('…'),
      'the ellipsis is inside the bound, not appended past it',
    ).toBe(true)
    // ⚑ **Clipping is NOT counted**, unlike a drop: the row is still listed and still readable.
    // Shortening a description costs a reader some words; shortening a name costs them the tool.
    expect(bounded.dropped).toBe(0)
  })

  it('⛔ …and a description EXACTLY at the bound is left alone', () => {
    // 🔴 **The only input where `clip`'s `>` and a `>=` disagree.** At 501 both readings truncate
    // and both answer a 500-character string ending in `…`, so the test above measures the
    // arithmetic and not the comparison. At exactly 500 the two diverge: `>` keeps the text whole,
    // `>=` eats a character and appends an ellipsis to a description that fitted.
    const whole = 'y'.repeat(500)
    const bounded = boundInventory({
      naming: CLAUDE_TOOL_NAMING,
      declared: { server: 'brobot', tools: [tool('x', whole)] },
      published: null,
    })
    expect(bounded.declared?.tools[0]?.description).toBe(whole)
    expect(bounded.declared?.tools[0]?.description?.endsWith('…')).toBe(false)
  })

  it('⛔ the ceilings bite at the literal number, and say that they did', () => {
    expect(MAX_DECLARED_TOOLS).toBe(100)
    expect(MAX_PUBLISHED_TOOLS).toBe(400)
    expect(MAX_PUBLISHED_SERVERS).toBe(50)
    const bounded = boundInventory({
      naming: CLAUDE_TOOL_NAMING,
      declared: {
        server: 'brobot',
        tools: Array.from({ length: 101 }, (_, i) => tool(`t${String(i)}`)),
      },
      published: {
        tools: Array.from({ length: 401 }, (_, i) => `p${String(i)}`),
        servers: Array.from({ length: 51 }, (_, i) => ({
          name: `s${String(i)}`,
          status: 'pending',
        })),
      },
    })
    expect(bounded.declared?.tools).toHaveLength(100)
    expect(bounded.published?.tools).toHaveLength(400)
    expect(bounded.published?.servers).toHaveLength(50)
    expect(bounded.dropped, '1 + 1 + 1 past three separate ceilings').toBe(3)
  })

  it('a tool’s arguments are bounded too — at the literal 40, and one past it', () => {
    expect(MAX_TOOL_PARAMETERS).toBe(40)
    // ⛔ **The ceiling, driven at the boundary AND one past it** — the rule this file's docblock
    // states, and the one bound that had neither side until the review found it.
    const at = boundInventory({
      naming: CLAUDE_TOOL_NAMING,
      declared: {
        server: 'brobot',
        tools: [
          {
            ...tool('at'),
            parameters: Array.from({ length: 40 }, (_, i) => ({
              name: `p${String(i)}`,
              type: 'string',
              required: false,
            })),
          },
        ],
      },
      published: null,
    })
    expect(at.declared?.tools[0]?.parameters).toHaveLength(40)
    const past = boundInventory({
      naming: CLAUDE_TOOL_NAMING,
      declared: {
        server: 'brobot',
        tools: [
          {
            ...tool('past'),
            parameters: Array.from({ length: 41 }, (_, i) => ({
              name: `p${String(i)}`,
              type: 'string',
              required: false,
            })),
          },
        ],
      },
      published: null,
    })
    expect(past.declared?.tools[0]?.parameters).toHaveLength(40)
    expect(past.declared?.tools[0]?.parameters.at(-1)?.name).toBe('p39')
  })

  it('…and a nameless argument is dropped without being counted as a missing TOOL', () => {
    const bounded = boundInventory({
      naming: CLAUDE_TOOL_NAMING,
      declared: {
        server: 'brobot',
        tools: [
          {
            ...tool('x'),
            parameters: [
              { name: 'kept', type: 'string', required: true },
              { name: '', type: 'string', required: false },
            ],
          },
        ],
      },
      published: null,
    })
    expect(bounded.declared?.tools[0]?.parameters.map((one) => one.name)).toEqual(['kept'])
    // ⚠️ **A dropped ARGUMENT is not in `dropped`, and that is deliberate**: the number means *"this
    // list is understating what the conversation HAS"*, and a tool with one argument fewer is still
    // listed and still callable. `MAX_COMMAND_ALIASES` is written under the same rule.
    expect(bounded.dropped).toBe(0)
  })
})

/**
 * 🔴 **The arguments, flattened from the JSON Schema the child was actually handed.**
 *
 * ⛔ **The same document `codex/agent-tools.ts` sends and `claude/agent-tools.ts` parses with** —
 * `z.looseObject`, which `348` corrected `347` to after measuring a strict object stripping an
 * undocumented key before `341`'s rail 1 could refuse it by name. A `required` column derived from
 * a different document would be a surface disagreeing with the door.
 */
describe('flattening a tool’s arguments (358)', () => {
  it('reads name, type, required and the `.describe()` sentence', () => {
    expect(
      parametersOf({
        profile_slug: z.string().describe('Which agent identity to run as.'),
        project: z.string().optional(),
        depth: z.number().optional(),
        on: z.boolean(),
      }),
    ).toEqual([
      {
        name: 'profile_slug',
        type: 'string',
        required: true,
        description: 'Which agent identity to run as.',
      },
      { name: 'project', type: 'string', required: false },
      { name: 'depth', type: 'number', required: false },
      { name: 'on', type: 'boolean', required: true },
    ])
  })

  it('⛔ `required` really distinguishes — an all-optional shape says so', () => {
    // The pair for the assertion above: a shape where nothing is required must not come back with
    // everything required, or `required: true` up there is what this function always says.
    expect(parametersOf({ a: z.string().optional(), b: z.string().optional() })).toEqual([
      { name: 'a', type: 'string', required: false },
      { name: 'b', type: 'string', required: false },
    ])
  })

  it('⛔ an enum answers with its MEMBERS, not with the word `string`', () => {
    // 🔴 **Zod 4 emits `{type:'string', enum:[…]}`**, so a reader that took `type` first would print
    // `string` about an argument with exactly two legal values — which is what the first draft of
    // `typeWordOf` did, and what this test caught.
    const [only] = parametersOf({ mode: z.enum(['ask', 'auto']) })
    expect(only?.type).toBe("'ask' | 'auto'")
    expect(only?.required).toBe(true)
    // ⚑ The pair: a plain string still reads as `string`, so the branch above is about enums and
    // not about a function that has stopped saying `string` at all.
    expect(parametersOf({ text: z.string() })[0]?.type).toBe('string')
  })

  it('⛔ an empty shape is an empty list, not a failure', () => {
    expect(parametersOf({})).toEqual([])
  })
})

/**
 * ⛔ **The spelling, which is DATA** — `039` forbids a renderer deciding anything by recognising a
 * provider, so the two conventions are constants the adapters state rather than a branch.
 */
describe('how a provider spells a server’s tool (358)', () => {
  it('the two conventions are what was measured, and they differ', () => {
    // Claude: `probe:tool-inventory` read `mcp__brobot__spawn_agent` out of `system/init.tools`.
    expect(qualifyWith(CLAUDE_TOOL_NAMING, 'brobot', 'spawn_agent')).toBe(
      'mcp__brobot__spawn_agent',
    )
    // Codex: `353` read the five names, unprefixed, off the child's own outbound request body.
    expect(qualifyWith(CODEX_TOOL_NAMING, 'brobot', 'spawn_agent')).toBe('brobot__spawn_agent')
  })

  it('⛔ the PREFIX is checked, so a name that merely contains the separator is not a server', () => {
    // 🔴 **The state where the two readings diverge.** A name with the separator and no prefix is
    // the only input that tells "the prefix is checked" apart from "it is not" — every ordinary
    // built-in has no separator at all and answers `null` either way.
    expect(splitQualified(CLAUDE_TOOL_NAMING, 'some__builtin')).toBeNull()
    // …and the pair, one character apart: with the prefix, the very same shape IS a server's tool.
    expect(splitQualified(CLAUDE_TOOL_NAMING, 'mcp__some__builtin')).toEqual({
      server: 'some',
      tool: 'builtin',
    })
  })

  it('a plain built-in is not a qualified name on either convention', () => {
    expect(splitQualified(CLAUDE_TOOL_NAMING, 'Bash')).toBeNull()
    expect(splitQualified(CODEX_TOOL_NAMING, 'shell')).toBeNull()
  })
})
