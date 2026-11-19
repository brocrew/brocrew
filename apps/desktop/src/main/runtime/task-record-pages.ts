import { z } from 'zod'
import type { Exchange, Received, TaskRecordExchange, Words } from '../../shared/last-exchange'
import type { TaskRecordSelection } from './work-records'

export const TASK_RECORD_SECTIONS = ['children', 'files', 'exchanges'] as const
export type TaskRecordSection = (typeof TASK_RECORD_SECTIONS)[number]
const PAGE_SIZE = 5
const PART_SIZE = 800

const position = z.discriminatedUnion('section', [
  z.object({ section: z.literal('children'), after: z.number().int().positive() }),
  z.object({
    section: z.literal('files'),
    after: z.object({ createdAt: z.number().finite(), resource: z.string().min(1).max(200) }),
  }),
  z.object({
    section: z.literal('exchanges'),
    after: z.object({
      revision: z.string().max(128),
      parts: z.number().int().nonnegative(),
      previewed: z.boolean(),
    }),
  }),
])
type Position = z.infer<typeof position>
const cursor = z.object({ piece: z.string(), position })

export function taskRecordPosition(
  piece: string,
  section: TaskRecordSection,
  encoded: string,
): Position | null {
  if (encoded.length > 2048) return null
  try {
    const decoded = cursor.parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')))
    return decoded.piece === piece && decoded.position.section === section ? decoded.position : null
  } catch {
    return null
  }
}

export function taskRecordNext(piece: string, position: Position): string {
  return Buffer.from(JSON.stringify({ piece, position })).toString('base64url')
}

export function taskRecordSelection(
  section: TaskRecordSection | undefined,
  position: Position | null,
): TaskRecordSelection {
  return {
    limit: PAGE_SIZE,
    exchange: section === undefined || section === 'exchanges',
    ...(section === undefined || section === 'children'
      ? { children: position?.section === 'children' ? position.after : 0 }
      : {}),
    ...(section === undefined || section === 'files'
      ? { files: position?.section === 'files' ? position.after : null }
      : {}),
  }
}

type Body =
  | { readonly message: Received; readonly kind: 'received' }
  | {
      readonly words: Words
      readonly kind: 'answer'
    }

function bodyWords(body: Body): Words {
  return body.kind === 'received' ? body.message.words : body.words
}

function partCount(words: Words): number {
  return 'text' in words ? Math.max(1, Math.ceil(words.text.length / PART_SIZE)) : 1
}

function partOf(words: Words, index: number): Words {
  if ('unreadable' in words) return words
  const boundary = (at: number): number => {
    if (at >= words.text.length) return words.text.length
    return /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(words.text.slice(at - 1, at + 1)) ? at - 1 : at
  }
  return {
    text: words.text.slice(boundary(index * PART_SIZE), boundary((index + 1) * PART_SIZE)),
    clipped: partCount(words) > 1,
  }
}

export interface ExchangePart {
  readonly kind: Body['kind']
  readonly body: number
  readonly part: number
  readonly words: Words
  readonly from?: Received['from']
}

export function taskRecordExchangePage(
  record: TaskRecordExchange,
  preview: boolean,
  position: Position | null,
): {
  readonly preview: Exchange
  readonly rows: readonly ExchangePart[]
  readonly remaining: number
  readonly through: Extract<Position, { section: 'exchanges' }>['after']
  readonly restarted: boolean
} {
  const { exchange, revision } = record
  const { received, answer } = exchange
  const together = received?.cameWith ?? []
  const showTogether =
    together.length <= 3 && together.every((message) => partCount(message.words) === 1)
  const previewExchange: Exchange = {
    ...exchange,
    received:
      received === null
        ? null
        : {
            from: received.from,
            words: partOf(received.words, 0),
            ...(showTogether && received.cameWith !== undefined ? { cameWith: together } : {}),
          },
    answer: answer === null ? null : partOf(answer, 0),
  }
  const bodies: Body[] = [...together.map((message): Body => ({ kind: 'received', message }))]
  if (received !== null) bodies.push({ kind: 'received', message: received })
  if (answer !== null) bodies.push({ kind: 'answer', words: answer })
  const after = position?.section === 'exchanges' ? position.after : null
  const restarted = after !== null && after.revision !== revision
  const previewed = preview || (!restarted && after?.previewed === true)
  const offset = restarted ? 0 : (after?.parts ?? 0)
  let parts = 0
  const rows: ExchangePart[] = []
  for (const [index, body] of bodies.entries()) {
    const words = bodyWords(body)
    const count = partCount(words)
    const shown = previewed && (index >= together.length || showTogether) ? 1 : 0
    const first = shown + Math.max(0, offset - parts)
    if (!preview) {
      for (let part = first; part < count && rows.length < PAGE_SIZE; part++) {
        rows.push({
          kind: body.kind,
          body: index + 1,
          part: part + 1,
          words: partOf(words, part),
          ...(body.kind === 'received' ? { from: body.message.from } : {}),
        })
      }
    }
    parts += count - shown
  }
  const through = { revision, parts: offset + rows.length, previewed }
  return {
    preview: previewExchange,
    rows,
    remaining: Math.max(0, parts - through.parts),
    through,
    restarted,
  }
}
