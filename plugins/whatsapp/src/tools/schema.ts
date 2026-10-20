import { validateArgs } from '../shared/strictArgs.js'
import type { FlatSchema, PropSchema } from '../shared/strictArgs.js'
import { PublicToolError } from '../shared/toolServer.js'
export type PropSpec =
  | {
      type: 'string'
      description: string
      minLength?: number
      maxLength?: number
      pattern?: RegExp
    }
  | {
      type: 'number'
      description: string
      min?: number
      max?: number
      integer?: boolean
    }
export interface ToolSpec {
  name: string
  description: string
  props: Record<string, PropSpec>
  required?: readonly string[]
}
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
        ...(p.minLength !== undefined ? { minLength: p.minLength } : {}),
        ...(p.maxLength !== undefined ? { maxLength: p.maxLength } : {}),
        ...(p.pattern ? { pattern: p.pattern.source } : {}),
      }
    } else {
      properties[key] = {
        type: p.integer ? 'integer' : 'number',
        description: p.description,
        ...(p.min !== undefined ? { minimum: p.min } : {}),
        ...(p.max !== undefined ? { maximum: p.max } : {}),
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
  const properties: Record<string, PropSchema> = {}
  for (const [key, def] of Object.entries(jsonSchemaOf(spec).properties)) {
    const rest = { ...(def as PropSchema & { pattern?: string }) }
    delete rest.pattern
    properties[key] = rest
  }
  const schema: FlatSchema = {
    type: 'object',
    properties,
    ...(spec.required?.length ? { required: spec.required } : {}),
    additionalProperties: false,
  }
  const errors = validateArgs(schema, raw)
  if (errors.length > 0) throw new PublicToolError(`invalid arguments: ${errors[0]}`)
  const given =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const out: Record<string, unknown> = {}
  for (const [key, p] of Object.entries(spec.props)) {
    const v = given[key]
    if (v === undefined) continue
    if (p.type === 'string' && p.pattern && !p.pattern.test(v as string))
      throw new PublicToolError(`invalid arguments: "${key}" has the wrong format`)
    out[key] = v
  }
  return out
}
