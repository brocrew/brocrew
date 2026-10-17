import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  TOOL_INPUT_ENUMS,
  agentToolsFor,
  type AgentToolHost,
} from '../src/main/runtime/agent-tools'

const here = dirname(fileURLToPath(import.meta.url))
const toolSource = readFileSync(join(here, '../src/main/runtime/agent-tools.ts'), 'utf8')

interface PropertySchema {
  readonly const?: unknown
  readonly enum?: readonly unknown[]
  readonly description?: string
  readonly [keyword: string]: unknown
}

interface ToolSchemaSource {
  readonly name: string
  readonly input: z.ZodRawShape
}

/** Follow one local JSON pointer. A future shared/ref schema must not disappear from the census. */
function resolveLocalRef(root: PropertySchema, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined
  return ref
    .slice(2)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce<unknown>((value, part) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
      return (value as Readonly<Record<string, unknown>>)[part]
    }, root)
}

/**
 * Find enum leaves by accepted argument path, including arrays, nested objects and compositions.
 * Definition tables are reached through `$ref` rather than counted as a second phantom argument.
 */
function collectEnums(
  value: unknown,
  path: string,
  root: PropertySchema,
  found: Record<string, PropertySchema>,
  refs: ReadonlySet<string> = new Set(),
): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return
  const schema = value as PropertySchema
  if (Array.isArray(schema.enum)) found[path] = schema
  else if (typeof schema.const === 'string') found[path] = { ...schema, enum: [schema.const] }

  const ref = schema['$ref']
  if (typeof ref === 'string' && !refs.has(ref)) {
    collectEnums(resolveLocalRef(root, ref), path, root, found, new Set([...refs, ref]))
  }

  const properties = schema['properties']
  if (typeof properties === 'object' && properties !== null && !Array.isArray(properties)) {
    for (const [name, property] of Object.entries(properties)) {
      collectEnums(property, `${path}.${name}`, root, found, refs)
    }
  }
  collectEnums(schema['items'], `${path}[]`, root, found, refs)
  const prefixItems = schema['prefixItems']
  if (Array.isArray(prefixItems)) {
    prefixItems.forEach((item, index) =>
      collectEnums(item, `${path}[${String(index)}]`, root, found, refs),
    )
  }
  const additional = schema['additionalProperties']
  if (typeof additional === 'object' && additional !== null) {
    collectEnums(additional, `${path}.*`, root, found, refs)
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
    const branches = schema[keyword]
    if (Array.isArray(branches)) {
      branches.forEach((branch, index) =>
        collectEnums(branch, `${path}|${keyword}[${String(index)}]`, root, found, refs),
      )
    }
  }
}

function enumArgumentsIn(
  tools: readonly ToolSchemaSource[],
): Readonly<Record<string, PropertySchema>> {
  const found: Record<string, PropertySchema> = {}
  for (const tool of tools) {
    const schema = z.toJSONSchema(z.looseObject(tool.input)) as PropertySchema
    collectEnums(schema, tool.name, schema, found)
  }
  return found
}

function publishedEnumArguments(): Readonly<Record<string, PropertySchema>> {
  // Schema construction reads no host state. The empty double is deliberate: this census asks the
  // actual registered tools for their input shapes and never invokes a handler.
  return enumArgumentsIn(agentToolsFor({} as AgentToolHost, 'sess_enum_census').tools)
}

function documentedCalls(source: string): string[] {
  return [...source.matchAll(/documentedToolEnum\(\s*TOOL_INPUT_ENUMS\[['"]([^'"]+)['"]\]/g)].map(
    (match) => match[1] ?? '',
  )
}

describe('490 · every closed vocabulary a tool caller has to choose from', () => {
  it('🔴 the census reads the registered schemas, and every member has its own sentence', () => {
    const actual = publishedEnumArguments()
    const expected = Object.fromEntries(
      Object.entries(TOOL_INPUT_ENUMS).map(([address, vocabulary]) => [
        address.replace(':', '.'),
        [...vocabulary.members],
      ]),
    )

    expect(
      Object.fromEntries(Object.entries(actual).map(([key, value]) => [key, value.enum])),
    ).toEqual(expected)
    for (const [address, vocabulary] of Object.entries(TOOL_INPUT_ENUMS)) {
      const description = actual[address.replace(':', '.')]?.description ?? ''
      const sentences = vocabulary.sentences as Readonly<Record<string, string>>
      for (const member of vocabulary.members) {
        // ⛔ The sentence, not merely the neighbouring member word. A description that lists the
        // values and explains only one of them must fail this assertion.
        expect(description).toContain(sentences[member])
      }
    }
  })

  it('⛔ asks for every helper CALL, not merely an imported vocabulary', () => {
    const calls = documentedCalls(toolSource).sort()
    expect(calls).toEqual(Object.keys(TOOL_INPUT_ENUMS).sort())

    // ⚠️ Two controls: a scanner that stops after the first call in a file, or folds two calls to
    // one vocabulary, fails here before it can bless production by accident.
    const planted = [
      "const a = documentedToolEnum(TOOL_INPUT_ENUMS['plant.one'], 'one')",
      "const b = documentedToolEnum(TOOL_INPUT_ENUMS['plant.two'], 'two')",
    ].join('\n')
    expect(documentedCalls(planted)).toEqual(['plant.one', 'plant.two'])
  })

  it('⚠️ the schema census finds two planted leaves, including one nested in an array', () => {
    const planted = enumArgumentsIn([
      {
        name: 'plant',
        input: {
          first: z.literal('one'),
          rows: z.array(z.object({ second: z.enum(['three', 'four']) })),
        },
      },
    ])
    expect(
      Object.fromEntries(Object.entries(planted).map(([path, schema]) => [path, schema.enum])),
    ).toEqual({
      'plant.first': ['one'],
      'plant.rows[].second': ['three', 'four'],
    })
  })

  // ⚑ **D-016 · `spawn_agent.approval_mode` went with `spawn_agent`.** `give_work` takes no mode:
  // a conversation it starts runs in its giver's (inherit, never wider), so no vocabulary is left
  // for a caller to choose from and the case that pinned its two values is gone with it.

  it('⛔ a tool input does not bypass the shared declaration with a direct zod enum', () => {
    const registered = toolSource.slice(toolSource.indexOf('export function agentToolsFor('))
    expect(registered).not.toMatch(/\bz\.(?:enum|literal)\s*\(/)
  })
})
