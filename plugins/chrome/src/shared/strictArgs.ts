export type PropSchema =
  | {
      type: 'string'
      description?: string
      enum?: readonly string[]
      minLength?: number
      maxLength?: number
    }
  | {
      type: 'number' | 'integer'
      description?: string
      minimum?: number
      maximum?: number
    }
  | {
      type: 'boolean'
      description?: string
    }
  | {
      type: 'array'
      description?: string
      items: {
        type: 'string'
        maxLength?: number
      }
      minItems?: number
      maxItems?: number
    }
export interface FlatSchema {
  type: 'object'
  properties: Readonly<Record<string, PropSchema>>
  required?: readonly string[]
  additionalProperties?: boolean
}
export function validateArgs(schema: FlatSchema, args: unknown): string[] {
  if (args === undefined || args === null) args = {}
  if (typeof args !== 'object' || Array.isArray(args)) return ['arguments must be a JSON object']
  const given = args as Record<string, unknown>
  const declared = (k: string) => Object.hasOwn(schema.properties, k)
  const errors: string[] = []
  if (schema.additionalProperties === false && Object.keys(given).some((k) => !declared(k))) {
    errors.push(`unknown argument; allowed: ${Object.keys(schema.properties).join(', ') || 'none'}`)
  }
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(given, key) || given[key] === undefined) errors.push(`"${key}" is required`)
  }
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (!Object.hasOwn(given, key) || given[key] === undefined) continue
    const error = propError(key, prop, given[key])
    if (error !== null) errors.push(error)
  }
  return errors
}
function propError(key: string, p: PropSchema, v: unknown): string | null {
  switch (p.type) {
    case 'string':
      if (typeof v !== 'string') return `"${key}" must be a string`
      if (p.enum !== undefined && !p.enum.includes(v))
        return `"${key}" must be one of: ${p.enum.join(', ')}`
      if (p.maxLength !== undefined && v.length > p.maxLength)
        return `"${key}" must be at most ${p.maxLength} characters`
      if (p.minLength !== undefined && v.length < p.minLength)
        return `"${key}" must be at least ${p.minLength} characters`
      return null
    case 'number':
    case 'integer':
      if (typeof v !== 'number' || !Number.isFinite(v)) return `"${key}" must be a number`
      if (p.type === 'integer' && !Number.isInteger(v)) return `"${key}" must be a whole number`
      if (p.minimum !== undefined && v < p.minimum) return `"${key}" must be at least ${p.minimum}`
      if (p.maximum !== undefined && v > p.maximum) return `"${key}" must be at most ${p.maximum}`
      return null
    case 'boolean':
      return typeof v === 'boolean' ? null : `"${key}" must be true or false`
    case 'array': {
      if (!Array.isArray(v)) return `"${key}" must be a list of strings`
      if (p.maxItems !== undefined && v.length > p.maxItems)
        return `"${key}" must have at most ${p.maxItems} items`
      if (p.minItems !== undefined && v.length < p.minItems)
        return `"${key}" must have at least ${p.minItems} items`
      if (!v.every((x) => typeof x === 'string')) return `"${key}" must be a list of strings`
      const cap = p.items?.maxLength
      if (cap !== undefined && v.some((x: string) => x.length > cap))
        return `each item of "${key}" must be at most ${cap} characters`
      return null
    }
    default:
      return `"${key}" has a type this check does not support`
  }
}
