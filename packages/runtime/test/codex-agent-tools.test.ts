import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  CODEX_TOOLS_DESCRIPTION,
  answerCodexToolCall,
  codexDynamicToolsFor,
} from '../src/codex/agent-tools'
import { agentToolStringEnum, type AgentToolAnswer, type AgentToolset } from '../src/agent-tools'

/**
 * 🔴 **348 · the Codex translation: five neutral tools becoming one `dynamicTools` namespace, and
 * one `item/tool/call` becoming an answer.**
 *
 * ⛔ **Not one of these tests is about policy**, because there is no policy in the file they test.
 * What is asserted is the shape the provider reads, the shape it is answered with, and the two
 * places `303` B and `307` said a translation goes wrong: a stripped argument, and a refusal that
 * arrives wearing an error's clothes.
 */

/** Calls are recorded so an assertion can say the tool did NOT run, and mean it. */
function toolset(answer: AgentToolAnswer | (() => Promise<AgentToolAnswer>) = { text: 'ok' }): {
  set: AgentToolset
  calls: Record<string, unknown>[]
} {
  const calls: Record<string, unknown>[] = []
  return {
    calls,
    set: {
      server: 'brobot',
      instructions: 'These tools reach the app you are running inside.',
      tools: [
        {
          name: 'spawn_agent',
          description: 'Create another agent.',
          beyondItsRails: 'it-starts-something-outside-this-app',
          input: {
            profile_slug: z.string().describe('Which identity to run as.'),
            purpose: z.string(),
            model: z.string().optional(),
            kind: agentToolStringEnum(['work', 'question'] as const)
              .describe("'work' assigns work. 'question' asks a question.")
              .optional(),
          },
          call: async (args) => {
            calls.push(args)
            return typeof answer === 'function' ? await answer() : answer
          },
        },
        {
          name: 'end_agent',
          description: 'End an agent you created.',
          beyondItsRails: 'it-destroys-work-in-flight',
          input: { agent: z.string() },
          call: async (args) => {
            calls.push(args)
            return { text: 'ended' }
          },
        },
      ],
    },
  }
}

const namespaceOf = (set: AgentToolset | undefined) => {
  const specs = codexDynamicToolsFor(set)
  expect(specs, 'a toolset with tools produces specs').toBeDefined()
  expect(specs).toHaveLength(1)
  const first = specs![0]! as {
    type: string
    name: string
    description: string
    tools: { name: string; description: string; inputSchema: Record<string, unknown> }[]
  }
  expect(first.type).toBe('namespace')
  return first
}

describe('348 · what Codex is handed on thread/start', () => {
  it('⛔ one namespace, named after the server, holding every tool', () => {
    const spec = namespaceOf(toolset().set)
    expect(spec.name).toBe('brobot')
    expect(spec.tools.map((one) => one.name)).toEqual(['spawn_agent', 'end_agent'])
    // ⚑ The provider spells a namespaced tool `<namespace>__<tool>` to the model
    // (probe:codex-dynamic-tools, arm A), so the namespace name is part of what the model reads.
    expect(spec.tools[0]!.description).toBe('Create another agent.')
  })

  it("⚑ the namespace description is ONE fixed sentence, never the toolset's instructions (D-039)", () => {
    // 🔴 **D-039 moved the fact this test pinned.** Until D-039 the instructions WERE the namespace
    // description — Claude hands them to the MCP server, Codex has one description per namespace —
    // because dropping them would lose the sentence that tells a model a refusal is an answer, which
    // is the thing `307` measured being obeyed. ⛔ They outgrew what the app-server takes there, and
    // every conversation that carried them was refused at `thread/start` (F055). ⚑ So the namespace
    // says `CODEX_TOOLS_DESCRIPTION`, and the instructions reach a Codex model in its conversation
    // instead — the tools section `toolsToldInTextFor('codex')` hands `thisConversationSpans` in the
    // desktop app. ⚠️ The "not dropped" half lives there now, and is that seam's to pin: this package
    // never sees that text.
    const withInstructions = toolset().set
    // ⛔ **The premise**: this toolset HAS instructions, and they are not the fixed sentence — else a
    // translation that still read them would pass the next line.
    expect(withInstructions.instructions).toBe('These tools reach the app you are running inside.')
    expect(withInstructions.instructions).not.toBe(CODEX_TOOLS_DESCRIPTION)
    expect(namespaceOf(withInstructions).description).toBe(CODEX_TOOLS_DESCRIPTION)
    // …and a toolset with no instructions says the same sentence, rather than `undefined` or another.
    const bare: AgentToolset = { server: 'brobot', tools: toolset().set.tools }
    expect(namespaceOf(bare).description).toBe(CODEX_TOOLS_DESCRIPTION)
    expect(namespaceOf(bare).description.length).toBeGreaterThan(0)
  })

  it('🔴 the argument schema is LOOSE, so an undocumented key is the door’s business (303 B)', () => {
    const schema = namespaceOf(toolset().set).tools[0]!.inputSchema
    // The declared keys are all there…
    expect(Object.keys(schema['properties'] as object).sort()).toEqual([
      'kind',
      'model',
      'profile_slug',
      'purpose',
    ])
    expect(schema['required']).toEqual(['profile_slug', 'purpose'])
    // ⛔ …and `additionalProperties` is NOT the `false` a strict object emits. A schema that
    // forbade the key would push the refusal out of `341`'s rail 1 and into the provider, where it
    // carries no rail, no permanence and no name.
    expect(schema['additionalProperties']).not.toBe(false)
  })

  it('🔴 advertises a closed vocabulary while an unknown member still reaches the handler', async () => {
    const built = toolset()
    const schema = namespaceOf(built.set).tools[0]!.inputSchema
    const kind = (schema['properties'] as { kind: Record<string, unknown> }).kind
    expect(kind['enum']).toEqual(['work', 'question'])
    expect(kind['description']).toContain("'question' asks a question.")
    expect(kind).not.toHaveProperty('default')

    const answer = await answerCodexToolCall(built.set, {
      namespace: 'brobot',
      tool: 'spawn_agent',
      arguments: { profile_slug: 'w', purpose: 'why', kind: 'status' },
    })
    expect(answer.success).toBe(true)
    expect(built.calls).toContainEqual({ profile_slug: 'w', purpose: 'why', kind: 'status' })
  })

  it('⚠️ no toolset and an EMPTY toolset both declare nothing', () => {
    expect(codexDynamicToolsFor(undefined)).toBeUndefined()
    expect(codexDynamicToolsFor({ server: 'brobot', tools: [] })).toBeUndefined()
    // …and the positive, so this is a measurement rather than a function that always says no.
    expect(codexDynamicToolsFor(toolset().set)).toBeDefined()
  })
})

describe('348 · what one item/tool/call is answered with', () => {
  const call = (tool: string, args: unknown = {}, namespace: string | null = 'brobot') => ({
    namespace,
    tool,
    arguments: args,
  })

  it('⛔ a granted call is a success carrying the text', async () => {
    const { set } = toolset({ text: 'spawned sess_9' })
    const answer = await answerCodexToolCall(set, call('spawn_agent', { profile_slug: 'w' }))
    expect(answer.success).toBe(true)
    expect(answer.contentItems).toEqual([{ type: 'inputText', text: 'spawned sess_9' }])
  })

  // Policy refusals are completed answers; bookkeeping preserves their original structured facts.
  it('a refusal is successful transport with one prose item and internal structured facts', async () => {
    const refusal = { outcome: 'refused', rail: 'not-your-parent', retryable: false }
    const said = 'refused (not-your-parent): it is not yours'
    const { set } = toolset({ text: said, structured: refusal })
    let internal: AgentToolAnswer | undefined
    const answer = await answerCodexToolCall(set, call('spawn_agent'), (completed) => {
      internal = completed
    })
    expect(answer.success).toBe(true)
    expect(answer.contentItems).toEqual([{ type: 'inputText', text: said }])
    expect(internal?.structured).toBe(refusal)
  })

  it('a bookkeeping failure does not turn a completed action into a broken tool', async () => {
    const { set, calls } = toolset({ text: 'Done.', structured: { outcome: 'ok' } })
    expect(
      (
        await answerCodexToolCall(set, call('spawn_agent'), () => {
          throw new Error('observer')
        })
      ).success,
    ).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('keeps an intentionally empty answer as one item', async () => {
    const { set } = toolset({ text: '', structured: { outcome: 'ok' } })
    expect((await answerCodexToolCall(set, call('spawn_agent'))).contentItems).toEqual([
      { type: 'inputText', text: '' },
    ])
  })

  it('⚠️ an answer with no structured half carries the text alone', async () => {
    const { set } = toolset({ text: 'plain' })
    const answer = await answerCodexToolCall(set, call('spawn_agent'))
    expect(answer.contentItems).toEqual([{ type: 'inputText', text: 'plain' }])
  })

  it('🔴 the arguments reach the tool UNTOUCHED, undocumented keys included (303 B)', async () => {
    const { set, calls } = toolset()
    await answerCodexToolCall(
      set,
      call('spawn_agent', { profile_slug: 'w', purpose: 'why', priority: 'high' }),
    )
    // ⛔ `spawnRequestSchema` is `.strict()`, so `priority` is what rail 1 refuses BY NAME — and it
    // can only do that if the transport hands it over. Stripping it here would turn a refusal a
    // model can read into a spawn that quietly ignored what it asked for.
    expect(calls).toEqual([{ profile_slug: 'w', purpose: 'why', priority: 'high' }])
  })

  it('⛔ a name this session does not offer runs nothing and says success:false', async () => {
    const { set, calls } = toolset()
    const answer = await answerCodexToolCall(set, call('dispatch_work'))
    expect(answer.success).toBe(false)
    expect(calls).toEqual([])
    // …and the paired positive, so "nothing ran" is not the state every branch is in.
    await answerCodexToolCall(set, call('end_agent'))
    expect(calls).toHaveLength(1)
  })

  it('⚠️ a foreign namespace runs nothing; a null one is accepted', async () => {
    const { set, calls } = toolset()
    expect((await answerCodexToolCall(set, call('end_agent', {}, 'somebody_else'))).success).toBe(
      false,
    )
    expect(calls).toEqual([])
    expect((await answerCodexToolCall(set, call('end_agent', {}, null))).success).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('⛔ arguments that are not an object run nothing', async () => {
    const { set, calls } = toolset()
    for (const bad of ['a string', 42, null, ['a', 'list']]) {
      expect((await answerCodexToolCall(set, call('end_agent', bad))).success).toBe(false)
    }
    expect(calls).toEqual([])
  })

  it('🔴 a handler that throws is the ONE thing that reports as a broken tool', async () => {
    const { set } = toolset(() => Promise.reject(new Error('the host fell over')))
    const answer = await answerCodexToolCall(set, call('spawn_agent'))
    expect(answer.success).toBe(false)
    const item = answer.contentItems[0]!
    expect(item.type === 'inputText' && item.text).toContain('the host fell over')
  })

  it('⚠️ a session that declared no tools answers a call the same way a wrong name does', async () => {
    // Two different sentences for "never existed" and "not offered here" would let a caller learn
    // which sessions carry tools from the shape of the answer — `341`'s entitlement-before-existence
    // ruling, one door over.
    const withNone = await answerCodexToolCall(undefined, call('spawn_agent'))
    const withWrongName = await answerCodexToolCall(toolset().set, call('spawn_agent_x'))
    expect(withNone.success).toBe(false)
    expect(withWrongName.success).toBe(false)
    const a = withNone.contentItems[0]!
    const b = withWrongName.contentItems[0]!
    expect(a.type === 'inputText' && a.text.replace('spawn_agent', 'X')).toBe(
      b.type === 'inputText' ? b.text.replace('spawn_agent_x', 'X') : '',
    )
  })
})
