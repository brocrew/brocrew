import { providerSchema, type Provider } from '@brobot2/shared'
import { TASK_STATES } from './task-contracts'
import type { TaskOutcome, TaskState } from './task-contracts'
import { z } from 'zod'

import type { WorkFileGroup } from './work-file-groups'
import { aTitleAuthor, type ConversationTitleAuthor } from './conversation-title'

const WORK_SEARCH_SCOPES = ['mine', 'this-conversation', 'all'] as const
export const WORK_SEARCH_BOUNDS = {
  candidates: 1000,
  responseUnits: 32768,
  resultUnits: 320,
  statusUnits: 160,
  titleUnits: 200,
  resourceIds: 10,
  ledgerRows: 10000,
  ledgerBytes: 16 * 1024 * 1024,
  cellBytes: 1024 * 1024,
  pageRows: 50000,
  pageMs: 250,
  workerMs: 5000,
  waiting: 8,
} as const

export const WORK_SEARCH_GROUP_BOUNDS = { groups: 6, previews: 3, taskLabels: 3 } as const

export const conversationSearchQuery = z
  .object({
    profile: z.string().min(1).max(200).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    words: z
      .string()
      .max(200)
      .refine((value) => value.trim().split(/\s+/u).filter(Boolean).length <= 20)
      .optional(),
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z.string().max(2048).optional(),
  })
  .strict()
export const workSearchQuery = conversationSearchQuery.extend({
  scope: z.enum(WORK_SEARCH_SCOPES).optional(),
  state: z.enum(TASK_STATES).optional(),
  includeConversationMetadata: z.literal(true).optional(),
  grouped: z.literal(true).optional(),
})
export type WorkSearchQuery = z.input<typeof workSearchQuery>

export interface WorkSearchHit {
  readonly kind: 'root' | 'piece'
  readonly piece: string
  readonly label: string
  readonly title: string | null
  readonly given_at: number
  readonly definition_of_done?: string | null
  readonly state: TaskState | null
  readonly conversation_state?: string
  readonly owner: {
    readonly conversation: string
    readonly name: string | null
    readonly profile: string | null
  }
  readonly giver: {
    readonly conversation: string
    readonly name: string | null
    readonly profile: string | null
  } | null
  readonly result: { readonly outcome: TaskOutcome; readonly summary: string | null } | null
  readonly status: string | null
  readonly resource_ids: Readonly<Record<WorkFileGroup, readonly string[]>>
  readonly clipped: { readonly title: boolean; readonly result: boolean; readonly status: boolean }
  readonly resources_omitted: number
}

export interface ConversationSearchHit {
  readonly conversation: string
  readonly address: string
  readonly title: string
  readonly line: string
  readonly profile: string | null
  readonly last_active_at: number
  readonly status: string | null
  readonly matched_tasks: readonly WorkSearchHit[]
  readonly tasks_omitted: number
  readonly metadata?: {
    readonly provider: Provider
    readonly archived_at: number | null
    readonly title_author: ConversationTitleAuthor | null
  }
}

export interface WorkSearchPage {
  readonly hits: readonly ConversationSearchHit[]
  readonly searched: number
  readonly rows_unread: number
  readonly ledgers_skipped: number
  readonly complete: boolean
  readonly next_cursor: string | null
  readonly grouped?: GroupedWorkSearch
}

export interface GroupedWorkSearchPreview extends Pick<
  ConversationSearchHit,
  'conversation' | 'address' | 'title' | 'last_active_at' | 'status' | 'metadata'
> {
  readonly matched_task_labels: readonly string[]
  readonly tasks_omitted: number
}

export interface GroupedWorkSearch {
  readonly matched: number | null
  readonly groups: readonly {
    readonly profile: string | null
    readonly matched: number | null
    readonly previews: readonly GroupedWorkSearchPreview[]
  }[]
}

export type WorkSearchResult =
  | { readonly ok: true; readonly page: WorkSearchPage }
  | { readonly ok: false; readonly reason: 'invalid' | 'cursor-invalid' | 'unavailable' | 'busy' }

const count = z.number().int().nonnegative().safe()
const who = z
  .object({
    conversation: z.string().max(200),
    name: z.string().max(200).nullable(),
    profile: z.string().max(200).nullable(),
  })
  .strict()
const ids = z.array(z.string().max(200)).max(WORK_SEARCH_BOUNDS.resourceIds)
const taskHit = z
  .object({
    kind: z.enum(['root', 'piece']),
    piece: z.string().max(200),
    label: z.string(),
    title: z.string().max(WORK_SEARCH_BOUNDS.titleUnits).nullable(),
    given_at: z.number().finite(),
    definition_of_done: z.string().max(512).nullable().optional(),
    state: z.enum(TASK_STATES).nullable(),
    conversation_state: z.string().max(200).optional(),
    owner: who,
    giver: who.nullable(),
    result: z
      .object({
        outcome: z.enum(['done', 'blocked', 'failed']),
        summary: z.string().max(WORK_SEARCH_BOUNDS.resultUnits).nullable(),
      })
      .strict()
      .nullable(),
    status: z.string().max(WORK_SEARCH_BOUNDS.statusUnits).nullable(),
    resource_ids: z
      .object({ brief: ids, result: ids, attachments: ids, working: ids })
      .strict()
      .refine(
        (groups) =>
          Object.values(groups).reduce((total, refs) => total + refs.length, 0) <=
          WORK_SEARCH_BOUNDS.resourceIds,
      ),
    clipped: z.object({ title: z.boolean(), result: z.boolean(), status: z.boolean() }).strict(),
    resources_omitted: count,
  })
  .strict()
const conversationHit = z
  .object({
    conversation: z.string().max(200),
    address: z.string(),
    title: z.string().max(WORK_SEARCH_BOUNDS.titleUnits),
    line: z.string(),
    profile: z.string().max(200).nullable(),
    last_active_at: z.number().finite(),
    status: z.string().max(WORK_SEARCH_BOUNDS.statusUnits).nullable(),
    matched_tasks: z.array(taskHit).max(50),
    tasks_omitted: count,
    metadata: z
      .object({
        provider: providerSchema,
        archived_at: z.number().finite().nullable(),
        title_author: z.custom<ConversationTitleAuthor>(aTitleAuthor).nullable(),
      })
      .strict()
      .optional(),
  })
  .strict()

const groupedPreview = conversationHit
  .pick({
    conversation: true,
    address: true,
    title: true,
    last_active_at: true,
    status: true,
    metadata: true,
    tasks_omitted: true,
  })
  .extend({ matched_task_labels: z.array(z.string()).max(WORK_SEARCH_GROUP_BOUNDS.taskLabels) })
const groupedSearch = z
  .object({
    matched: count.nullable(),
    groups: z
      .array(
        z
          .object({
            profile: z.string().max(200).nullable(),
            matched: count.nullable(),
            previews: z.array(groupedPreview).max(WORK_SEARCH_GROUP_BOUNDS.previews),
          })
          .strict(),
      )
      .max(WORK_SEARCH_GROUP_BOUNDS.groups),
  })
  .strict()

export const workSearchResult = z
  .discriminatedUnion('ok', [
    z
      .object({
        ok: z.literal(false),
        reason: z.enum(['invalid', 'cursor-invalid', 'unavailable', 'busy']),
      })
      .strict(),
    z
      .object({
        ok: z.literal(true),
        page: z
          .object({
            hits: z.array(conversationHit).max(50),
            searched: count.max(WORK_SEARCH_BOUNDS.candidates),
            rows_unread: count,
            ledgers_skipped: count,
            complete: z.boolean(),
            next_cursor: z.string().max(2048).nullable(),
            grouped: groupedSearch.optional(),
          })
          .strict(),
      })
      .strict(),
  ])
  .refine((value) => JSON.stringify(value).length <= WORK_SEARCH_BOUNDS.responseUnits)

export function searchWords(words: string | undefined): readonly string[] {
  return [...new Set((words ?? '').toLocaleLowerCase('en').trim().split(/\s+/u).filter(Boolean))]
}

export function clippedWorkText(
  text: string | null,
  most: number,
): { readonly text: string | null; readonly clipped: boolean } {
  if (text === null || text.length <= most) return { text, clipped: false }
  const end = /[\ud800-\udbff]/u.test(text[most - 1]!) ? most - 1 : most
  return { text: text.slice(0, end), clipped: true }
}
