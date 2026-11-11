export interface ArgsSchema<P> {
  type: 'object'
  properties: Readonly<Record<string, P>>
  required?: readonly string[]
  additionalProperties?: boolean
}
export function argsValidator<P>(
  propError: (key: string, prop: P, value: unknown) => string | null,
) {
  return (schema: ArgsSchema<P>, args: unknown): string[] => {
    if (args === undefined || args === null) args = {}
    if (typeof args !== 'object' || Array.isArray(args)) return ['arguments must be a JSON object']
    const given = args as Record<string, unknown>
    const declared = (k: string) => Object.hasOwn(schema.properties, k)
    const errors: string[] = []
    if (schema.additionalProperties === false && Object.keys(given).some((k) => !declared(k))) {
      errors.push(
        `unknown argument; allowed: ${Object.keys(schema.properties).join(', ') || 'none'}`,
      )
    }
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(given, key) || given[key] === undefined)
        errors.push(`"${key}" is required`)
    }
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (!Object.hasOwn(given, key) || given[key] === undefined) continue
      const error = propError(key, prop, given[key])
      if (error !== null) errors.push(error)
    }
    return errors
  }
}
