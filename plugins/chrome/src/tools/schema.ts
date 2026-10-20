import { validateArgs } from '../shared/strictArgs.js'
import type { FlatSchema, PropSchema } from '../shared/strictArgs.js'
import { ToolError } from '../toolError.js'
export { ToolError }
export type PropSpec =
  | {
      type: 'string'
      description: string
      minLength?: number
      maxLength?: number
      pattern?: RegExp
      enum?: readonly string[]
    }
  | {
      type: 'number'
      description: string
      min?: number
      max?: number
      integer?: boolean
    }
  | {
      type: 'boolean'
      description: string
    }
  | {
      type: 'scalar'
      description: string
    }
  | {
      type: 'array'
      description: string
      maxItems: number
      minItems?: number
      itemMaxLength?: number
    }
export interface ToolSpec {
  name: string
  description: string
  props: Record<string, PropSpec>
  required?: readonly string[]
}
export const MAX_TEXT = 100000
export function jsonSchemaOf(spec: ToolSpec): {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties: false
} {
  const properties: Record<string, unknown> = {}
  for (const [key, p] of Object.entries(spec.props)) {
    if (p.type === 'string') {
      properties[key] = {
        type: 'string',
        description: p.description,
        ...(p.enum ? { enum: [...p.enum] } : {}),
        ...(p.minLength !== undefined ? { minLength: p.minLength } : {}),
        ...(p.maxLength !== undefined ? { maxLength: p.maxLength } : {}),
        ...(p.pattern ? { pattern: p.pattern.source } : {}),
      }
    } else if (p.type === 'number') {
      properties[key] = {
        type: p.integer ? 'integer' : 'number',
        description: p.description,
        ...(p.min !== undefined ? { minimum: p.min } : {}),
        ...(p.max !== undefined ? { maximum: p.max } : {}),
      }
    } else if (p.type === 'boolean') {
      properties[key] = { type: 'boolean', description: p.description }
    } else if (p.type === 'scalar') {
      properties[key] = { type: ['boolean', 'string', 'number'], description: p.description }
    } else {
      properties[key] = {
        type: 'array',
        description: p.description,
        items: { type: 'string', ...(p.itemMaxLength ? { maxLength: p.itemMaxLength } : {}) },
        maxItems: p.maxItems,
        ...(p.minItems !== undefined ? { minItems: p.minItems } : {}),
      }
    }
  }
  return {
    type: 'object',
    properties,
    ...(spec.required?.length ? { required: [...spec.required] } : {}),
    additionalProperties: false,
  }
}
export function parseArgs(spec: ToolSpec, raw: unknown): Record<string, unknown> {
  const scalars = Object.entries(spec.props)
    .filter(([, p]) => p.type === 'scalar')
    .map(([k]) => k)
  const properties: Record<string, PropSchema> = {}
  for (const [key, def] of Object.entries(jsonSchemaOf(spec).properties)) {
    if (scalars.includes(key)) continue
    const rest = { ...(def as PropSchema & { pattern?: string }) }
    delete rest.pattern
    properties[key] = rest
  }
  const required = (spec.required ?? []).filter((k) => !scalars.includes(k))
  const schema: FlatSchema = {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  }
  const given =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null
  const visible = given
    ? Object.fromEntries(Object.entries(given).filter(([k]) => !scalars.includes(k)))
    : raw
  const errors = validateArgs(schema, visible)
  if (errors.length > 0) throw new ToolError(`invalid arguments: ${errors[0]}`)
  const out: Record<string, unknown> = {}
  if (!given) return out
  for (const [key, p] of Object.entries(spec.props)) {
    const v = given[key]
    if (v === undefined) {
      if (spec.required?.includes(key))
        throw new ToolError(`invalid arguments: "${key}" is required`)
      continue
    }
    if (p.type === 'string' && p.pattern && !p.pattern.test(v as string))
      throw new ToolError(`invalid arguments: "${key}" has the wrong format`)
    if (
      p.type === 'scalar' &&
      typeof v !== 'boolean' &&
      typeof v !== 'string' &&
      typeof v !== 'number'
    )
      throw new ToolError(`invalid arguments: "${key}" has the wrong type`)
    out[key] = v
  }
  return out
}
