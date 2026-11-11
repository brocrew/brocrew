export type StringProperty = {
  type: 'string'
  description: string
  minLength?: number
  maxLength?: number
  pattern?: RegExp
}
export type NumberProperty = {
  type: 'number'
  description: string
  min?: number
  max?: number
  integer?: boolean
}
export function stringProperty(
  p: StringProperty & { enum?: readonly string[] },
  includeEnum: boolean,
): Record<string, unknown> {
  return {
    type: 'string',
    description: p.description,
    ...(includeEnum && p.enum ? { enum: [...p.enum] } : {}),
    ...(p.minLength !== undefined ? { minLength: p.minLength } : {}),
    ...(p.maxLength !== undefined ? { maxLength: p.maxLength } : {}),
    ...(p.pattern ? { pattern: p.pattern.source } : {}),
  }
}
export function numberProperty(p: NumberProperty): Record<string, unknown> {
  return {
    type: p.integer ? 'integer' : 'number',
    description: p.description,
    ...(p.min !== undefined ? { minimum: p.min } : {}),
    ...(p.max !== undefined ? { maximum: p.max } : {}),
  }
}
