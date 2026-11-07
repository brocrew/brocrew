import type { JsonValue } from './json-value'

export interface McpElicitation {
  readonly serverName: string
  readonly message: string
  readonly mode: string
  readonly url?: string
  readonly urlWithheld?: true
  readonly fields: readonly ElicitationField[]
}

interface ElicitationField {
  readonly key: string
  readonly schema: Record<string, unknown>
  readonly required: boolean
}

export const SKIPPED = 'Leave this one out'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(from: Record<string, unknown>, key: string): string {
  const value = from[key]
  return typeof value === 'string' ? value : ''
}

function requiredKeys(schema: unknown): Set<string> {
  const listed = isRecord(schema) ? schema['required'] : undefined
  return new Set(
    Array.isArray(listed) ? listed.filter((one): one is string => typeof one === 'string') : [],
  )
}

export const MAX_ELICITATION_URL = 4096

// Hidden characters can make a displayed URL differ from the one copied.
const HIDDEN_CHARACTERS =
  // eslint-disable-next-line no-control-regex -- the control characters ARE the subject
  /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]/

export function mcpElicitation(params: unknown): McpElicitation | null {
  if (!isRecord(params)) return null
  const serverName = readString(params, 'serverName')

  if (serverName === '') return null
  const schema = params['requestedSchema']
  const properties = isRecord(schema) && isRecord(schema['properties']) ? schema['properties'] : {}
  const url = readString(params, 'mode') === 'url' ? readString(params, 'url').trim() : ''
  const shown = url !== '' && url.length <= MAX_ELICITATION_URL && !HIDDEN_CHARACTERS.test(url)
  return {
    serverName,
    message: readString(params, 'message'),
    mode: readString(params, 'mode'),
    ...(shown ? { url } : url !== '' ? { urlWithheld: true as const } : {}),

    fields:
      readString(params, 'mode') === 'form'
        ? Object.entries(properties).flatMap(([key, one]) =>
            isRecord(one) ? [{ key, schema: one, required: requiredKeys(schema).has(key) }] : [],
          )
        : [],
  }
}

function enumChoices(schema: Record<string, unknown>): { label: string; value: string }[] | null {
  const items = isRecord(schema['items']) ? schema['items'] : schema
  const bare = items['enum']
  if (Array.isArray(bare)) {
    const plain = bare.filter((one): one is string => typeof one === 'string')

    const names = items['enumNames']
    return plain.map((value, index) => ({
      label:
        Array.isArray(names) && typeof names[index] === 'string' && names[index] !== ''
          ? names[index]
          : value,
      value,
    }))
  }
  const titled = items['oneOf'] ?? items['anyOf']
  if (!Array.isArray(titled)) return null
  const choices = titled.flatMap((one) => {
    if (!isRecord(one)) return []
    const value = readString(one, 'const')
    return value === '' ? [] : [{ label: readString(one, 'title') || value, value }]
  })
  return distinctLabels(choices)
}

function distinctLabels(
  choices: { label: string; value: string }[],
): { label: string; value: string }[] {
  const seen = new Set(choices.map((choice) => choice.label))
  // Distinct labels prevent an answer from selecting a different underlying value.
  if (seen.size === choices.length) return choices
  return choices.map((choice) => ({ label: choice.value, value: choice.value }))
}

function isMultiSelect(schema: Record<string, unknown>): boolean {
  return schema['type'] === 'array'
}

export function elicitationQuestions(elicitation: McpElicitation): {
  id: string
  prompt: string
  header?: string
  options: { label: string }[]
  multiSelect?: boolean
  description?: string
}[] {
  return elicitation.fields.map((field) => {
    const choices =
      field.schema['type'] === 'boolean'
        ? BOOLEAN_CHOICES.map((label) => ({ label, value: label }))
        : enumChoices(field.schema)
    const title = readString(field.schema, 'title')
    const description = readString(field.schema, 'description')

    const offered = field.required
      ? (choices ?? [])
      : [{ label: SKIPPED, value: SKIPPED }, ...(choices ?? [])]
    return {
      id: field.key,

      prompt: title || field.key,

      header: field.key,
      options: offered.map((choice) => ({ label: choice.label })),

      ...(!field.required && choices === null ? { allowOther: true } : {}),
      ...(isMultiSelect(field.schema) ? { multiSelect: true } : {}),
      ...(description === '' ? {} : { description }),
    }
  })
}

export function elicitationContent(
  elicitation: McpElicitation,
  approved: ReadonlyMap<string, readonly string[]>,
): { readonly content: Record<string, JsonValue> } | { readonly refusal: string } {
  // Server-chosen keys such as __proto__ must remain own data properties.
  const content: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
  for (const field of elicitation.fields) {
    const chosen = approved.get(field.key)
    if (chosen === undefined || chosen.length === 0) continue

    // Omit optional fields rather than sending the card's skip label to the server.
    if (!field.required && chosen.length === 1 && chosen[0] === SKIPPED) continue
    const type = field.schema['type']
    if (type === 'boolean') {
      content[field.key] = chosen[0] === BOOLEAN_CHOICES[0]
      continue
    }
    if (type === 'number' || type === 'integer') {
      const parsed = Number(chosen[0])
      if (!Number.isFinite(parsed)) {
        return { refusal: `${field.key} takes a number and "${chosen[0]}" is not one` }
      }

      if (type === 'integer' && !Number.isInteger(parsed)) {
        return { refusal: `${field.key} takes a whole number and "${chosen[0]}" is not one` }
      }
      content[field.key] = parsed
      continue
    }
    const choices = enumChoices(field.schema)
    const valueOf = (label: string): string =>
      choices?.find((choice) => choice.label === label)?.value ?? label
    if (!isMultiSelect(field.schema)) {
      content[field.key] = valueOf(chosen[0] ?? '')
      continue
    }

    const members: JsonValue[] = []
    const memberType = isRecord(field.schema['items']) ? field.schema['items']['type'] : undefined
    for (const one of chosen) {
      if (memberType === 'boolean') {
        members.push(one === BOOLEAN_CHOICES[0])
        continue
      }
      if (memberType === 'number' || memberType === 'integer') {
        const parsed = Number(one)
        if (!Number.isFinite(parsed) || (memberType === 'integer' && !Number.isInteger(parsed))) {
          return { refusal: `${field.key} takes numbers and "${one}" is not one` }
        }
        members.push(parsed)
        continue
      }
      members.push(valueOf(one))
    }
    content[field.key] = members
  }
  return { content }
}

export const BOOLEAN_CHOICES = ['Yes', 'No'] as const

export function elicitationWords(elicitation: McpElicitation): string {
  const said =
    elicitation.message === '' ? '' : `\n\n${elicitation.serverName} says: ${elicitation.message}`
  const link =
    elicitation.url !== undefined
      ? `\n\n${elicitation.serverName}’s link: ${elicitation.url}`
      : elicitation.urlWithheld === true
        ? `\n\n${elicitation.serverName} sent a link BroCrew does not show — too long, or with hidden characters in it.`
        : ''
  return `${link}${said}`
}

export function opensALink(elicitation: McpElicitation): boolean {
  return elicitation.mode === 'url' && elicitation.url !== undefined
}

export function serverAsks(elicitation: McpElicitation): { server: string; url?: string } {
  return {
    server: elicitation.serverName,
    ...(elicitation.url === undefined ? {} : { url: elicitation.url }),
  }
}
