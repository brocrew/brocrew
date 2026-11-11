import { argsValidator, type ArgsSchema } from '../../../shared/argument-validation.js'
export type PropSchema =
  | {
      type: 'string'
      description?: string
      minLength?: number
      maxLength?: number
    }
  | {
      type: 'number' | 'integer'
      description?: string
      minimum?: number
      maximum?: number
    }
export type FlatSchema = ArgsSchema<PropSchema>
export const validateArgs = argsValidator<PropSchema>(propError)
function propError(key: string, p: PropSchema, v: unknown): string | null {
  if (p.type === 'string') {
    if (typeof v !== 'string') return `"${key}" must be a string`
    if (p.maxLength !== undefined && v.length > p.maxLength)
      return `"${key}" must be at most ${p.maxLength} characters`
    if (p.minLength !== undefined && v.length < p.minLength)
      return `"${key}" must be at least ${p.minLength} characters`
    return null
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) return `"${key}" must be a number`
  if (p.type === 'integer' && !Number.isInteger(v)) return `"${key}" must be a whole number`
  if (p.minimum !== undefined && v < p.minimum) return `"${key}" must be at least ${p.minimum}`
  if (p.maximum !== undefined && v > p.maximum) return `"${key}" must be at most ${p.maximum}`
  return null
}
