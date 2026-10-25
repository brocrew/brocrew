import { z } from 'zod'
import { DOCUMENT_FORMS, formOfName } from './documents'

export const FILES_LIBRARY_BOUNDS = {
  rows: 100_000,
  bytes: 32 * 1024 * 1024,
  replyBytes: 512 * 1024,
  fieldBytes: 32 * 1024,
  page: 256,
  deadlineMs: 5_000,
  parentDeadlineMs: 6_000,
  idleMs: 60_000,
  restarts: 3,
  restartWindowMs: 60_000,
} as const

const id = z.string().min(1).max(200)
const cursor = z.string().min(1).max(2048)
const size = z.number().int().min(1).max(100)
export const libraryWords = (text: string): string[] =>
  text.normalize('NFC').toLowerCase().trim().split(/\s+/u).filter(Boolean)
const words = z
  .string()
  .max(200)
  .refine((text) => libraryWords(text).length <= 20)
export const filesLibraryScope = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('workspace') }),
  z.strictObject({ type: z.literal('task'), id, includeSubtasks: z.boolean() }),
  z.strictObject({ type: z.literal('conversationWork'), id, includeSubtasks: z.boolean() }),
])
export const filesLibraryQuery = z.strictObject({
  scope: filesLibraryScope,
  query: words,
  kind: z.enum(['all', 'documents', 'images']),
  role: z.enum(['all', 'made', 'input']),
  sort: z.enum(['newest', 'oldest', 'name']),
})
export type FilesLibraryQuery = z.infer<typeof filesLibraryQuery>
export const filesLibraryRequest = z.discriminatedUnion('operation', [
  z.strictObject({
    operation: z.literal('query'),
    query: filesLibraryQuery,
    size: size.optional(),
  }),
  z.strictObject({ operation: z.literal('page'), cursor, size: size.optional() }),
  z.strictObject({
    operation: z.literal('provenance'),
    snapshot: cursor,
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    cursor: cursor.optional(),
    size: size.optional(),
  }),
  z.strictObject({
    operation: z.literal('tasks'),
    query: words,
    parent: id.nullable(),
    cursor: cursor.optional(),
    size: size.optional(),
  }),
  z.strictObject({ operation: z.literal('release') }),
])
export type FilesLibraryRequest = z.infer<typeof filesLibraryRequest>

const display = z.string().max(512)
const task = z.strictObject({
  id,
  label: display,
  title: display.nullable(),
  breadcrumb: display,
  clipped: z.boolean(),
  children: z.number().int().nonnegative(),
})
export type LibraryTask = z.infer<typeof task>
export const libraryKeep = z.strictObject({
  resourceId: id,
  title: display,
  name: display,
  clipped: z.boolean(),
  form: z.enum(DOCUMENT_FORMS).nullable(),
  bytes: z.number().int().nonnegative().safe(),
  role: z.enum(['made', 'input']),
  keptAt: z.number().finite(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  addedBy: z.strictObject({ conversation: id, identity: id.nullable(), name: display }).nullable(),
  piece: id,
  label: display,
  pieceTitle: display.nullable(),
  breadcrumb: display,
})
export type LibraryKeep = z.infer<typeof libraryKeep>
const group = z.strictObject({
  file: libraryKeep,
  matchingKeeps: z.number().int().positive(),
})
export type LibraryFile = z.infer<typeof group>
const metrics = z.strictObject({
  rows: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative(),
  cacheBytes: z.number().int().nonnegative(),
})
const stamp = {
  snapshot: cursor,
  readAt: z.number().finite(),
  stale: z.boolean(),
  metrics,
}
const count = z.number().int().nonnegative()
const facets = z.strictObject({
  kinds: z.strictObject({ all: count, documents: count, images: count }),
  roles: z.strictObject({ all: count, made: count, input: count }),
})
export const filesLibraryResult = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('files'),
    ...stamp,
    files: z.array(group).max(100),
    totalFiles: count,
    totalKeeps: count,
    scopeKeeps: count,
    facets,
    next: cursor.nullable(),
  }),
  z.strictObject({
    type: z.literal('provenance'),
    ...stamp,
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    keeps: z.array(z.strictObject({ file: libraryKeep, matching: z.boolean() })).max(100),
    total: count,
    matching: count,
    next: cursor.nullable(),
  }),
  z.strictObject({
    type: z.literal('tasks'),
    ...stamp,
    tasks: z.array(task).max(100),
    total: count,
    next: cursor.nullable(),
  }),
  z.strictObject({ type: z.literal('released') }),
  z.strictObject({
    type: z.literal('unavailable'),
    cause: z.enum([
      'missing-task',
      'missing-conversation',
      'ancestry',
      'metadata',
      'budget',
      'changed',
      'cursor-expired',
      'invalid-cursor',
      'busy',
      'cancelled',
      'worker',
      'closed',
    ]),
    complete: z.literal(false),
    visited: count,
    unread: count,
    retryAfterMs: z.number().nonnegative().optional(),
  }),
])
export type FilesLibraryResult = z.infer<typeof filesLibraryResult>
export type LibraryUnavailable = Extract<FilesLibraryResult, { type: 'unavailable' }>
export function libraryUnavailable(
  cause: LibraryUnavailable['cause'],
  visited = 0,
  unread = 0,
  retryAfterMs?: number,
): LibraryUnavailable {
  return {
    type: 'unavailable',
    cause,
    complete: false,
    visited,
    unread,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  }
}

export function libraryKind(name: string): 'documents' | 'images' | 'unknown' {
  const form = formOfName(name)
  return form === 'image' ? 'images' : form === null ? 'unknown' : 'documents'
}
export function libraryMatches(fields: readonly string[], tokens: readonly string[]): boolean {
  const text = fields.map((field) => field.normalize('NFC').toLowerCase()).join('\n')
  return tokens.every((token) => text.includes(token))
}
const collator = new Intl.Collator('en', { usage: 'sort', sensitivity: 'variant', numeric: false })
export function scalarCompare(left: string, right: string): number {
  const a = [...left],
    b = [...right]
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const difference = a[i]!.codePointAt(0)! - b[i]!.codePointAt(0)!
    if (difference !== 0) return difference
  }
  return a.length - b.length
}
export function compareLibraryFiles(
  left: Pick<LibraryKeep, 'name' | 'title' | 'keptAt' | 'sha256'>,
  right: Pick<LibraryKeep, 'name' | 'title' | 'keptAt' | 'sha256'>,
  sort: FilesLibraryQuery['sort'],
): number {
  if (sort !== 'name')
    return (
      (sort === 'newest' ? right.keptAt - left.keptAt : left.keptAt - right.keptAt) ||
      scalarCompare(left.sha256, right.sha256)
    )
  return (
    collator.compare(left.name, right.name) ||
    scalarCompare(left.name, right.name) ||
    collator.compare(left.title, right.title) ||
    scalarCompare(left.title, right.title) ||
    scalarCompare(left.sha256, right.sha256)
  )
}

export interface FilesLibraryReader {
  read(request: FilesLibraryRequest, context: LibraryReadContext): Promise<FilesLibraryResult>
  close(): Promise<void>
}
// Only main supplies these values; renderer requests cannot choose a database or giver identities.
export interface LibraryReadContext {
  workspace: string
  givers: string[]
  hostRevision: string
}
export const libraryReadContext = z.strictObject({
  workspace: id,
  givers: z.array(id).max(10_000),
  hostRevision: z.string().max(512),
})
