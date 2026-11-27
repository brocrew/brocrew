/**
 * What a give or take-on request must hold: its schemas, and the problems a malformed request is
 * told in its own words. Split out of spawn-rails.ts as a pure move.
 */
import { WORK_FIELD_WORDS } from '../../shared/work-fields'
import { z } from 'zod'
import { providerSchema } from '@brobot2/shared'
import { PATH_SEGMENT_RULE, isPathSegment } from '../../shared/runtime-ipc'
import { PIECE_TITLE_CHARS } from '../../shared/piece-called'

/**
 * 🔴 **D-016 · the give's request, and `.strict()` is a rail rather than a style** — see
 * `malformed-request`.
 *
 * ⛔ **It lives in `main/` and not in `shared/runtime-ipc.ts`.** The renderer's protocol is a wire;
 * this is the one door an agent's tool call reaches.
 *
 * ⚑ **There are no provider or approval arguments** (plan ruling 3): a conversation a give starts
 * runs on the agent's own provider ({@link theProviderAStartRunsOn}), in the giver's mode.
 * 🔴 **D-042 · R4 — a model and an effort ARE arguments**: an agent chooses what its helper's
 * one conversation with it runs on, judged at `model-rails.ts`' seam — the list, then the model's
 * efforts.
 */
export const doneConditionText = z
  .string({ error: WORK_FIELD_WORDS.required })
  .refine((value) => value.trim() !== '', WORK_FIELD_WORDS.blank)

export const workBriefText = z.string().refine((value) => value.trim() !== '', 'must say something')

/** What a value sent for a field is, in a word or two. */
function aValueOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'a list'
  switch (typeof value) {
    case 'string':
      return 'text'
    case 'number':
      return 'a number'
    case 'boolean':
      return 'true or false'
    default:
      return 'an object'
  }
}

/** What a field takes, in {@link aValueOf}'s words. */
const EXPECTED_SAID: Readonly<Record<string, string>> = {
  string: 'text',
  boolean: 'true or false',
  array: 'a list',
  number: 'a number',
  object: 'an object',
}

const valueAt = (request: unknown, path: readonly PropertyKey[]): unknown =>
  path.reduce<unknown>(
    (value, key) =>
      typeof value === 'object' && value !== null
        ? (value as Readonly<Record<PropertyKey, unknown>>)[key]
        : undefined,
    request,
  )

const isWorkFieldWords = (message: string): boolean =>
  (Object.values(WORK_FIELD_WORDS) as readonly string[]).includes(message)

/** Caller-named fields are shown with a bounded name and a bounded list. */
const unknownFieldNames = (keys: readonly string[]): string[] =>
  keys.slice(0, 5).map((key) => (key.length > 40 ? `${key.slice(0, 39)}…` : key))

/**
 * Each problem with a work request, naming its field and what that field takes. A field sent as
 * the wrong kind of value says what came; no value sent is repeated.
 */
const workRequestProblems = (
  issues: readonly z.core.$ZodIssue[],
  /** The request as it was sent, for what kind of value each field came as. */
  request: unknown,
  /** The fields the tool takes, named beside a field it does not. */
  takes: readonly string[],
): string[] =>
  issues.map((issue) => {
    const field = issue.path.map(String).join('.') || '(request)'
    const value = valueAt(request, issue.path)
    if (issue.code === 'invalid_type' && value !== undefined) {
      const expected = EXPECTED_SAID[issue.expected] ?? issue.expected
      return `${field}: expected ${expected}, got ${aValueOf(value)}`
    }
    if (isWorkFieldWords(issue.message)) return issue.message
    const unit = (origin: string): string => (origin === 'array' ? 'items' : 'characters')
    switch (issue.code) {
      case 'invalid_type':
        return `${field} is required`
      case 'unrecognized_keys':
        return `${field}: unknown fields ${unknownFieldNames(issue.keys)
          .map((key) => JSON.stringify(key))
          .join(
            ', ',
          )}${issue.keys.length > 5 ? ` and ${String(issue.keys.length - 5)} more` : ''} — it takes only ${takes.join(', ')}`
      case 'too_big':
        return `${field}: at most ${String(issue.maximum)} ${unit(issue.origin)}`
      case 'too_small':
        return issue.origin === 'string' && Number(issue.minimum) === 1
          ? `${field}: must not be empty`
          : `${field}: at least ${String(issue.minimum)} ${unit(issue.origin)}`
      default:
        return `${field}: ${issue.message}`
    }
  })

/** The details {@link workRequestRefused} composed in this app's words alone. */
const IN_ITS_OWN_WORDS = new WeakSet<object>()

/**
 * A work request that could not be read: each problem, and the fields sent that the tool does not
 * take ({@link SpawnRefusalDetail.unknownFields}). ⚑ With none of those, every word is this app's,
 * and {@link problemsInItsOwnWords} says so.
 */
export function workRequestRefused(
  issues: readonly z.core.$ZodIssue[],
  request: unknown,
  takes: readonly string[],
): { readonly problems: readonly string[]; readonly unknownFields?: readonly string[] } {
  const unknown = issues.flatMap((issue) => (issue.code === 'unrecognized_keys' ? issue.keys : []))
  const problems = workRequestProblems(issues, request, takes)
  if (unknown.length > 0) return { problems, unknownFields: unknownFieldNames(unknown) }
  const detail = { problems }
  IN_ITS_OWN_WORDS.add(detail)
  return detail
}

/** Whether a refusal's detail is a work request's problems in this app's words alone. */
export function problemsInItsOwnWords(detail: unknown): boolean {
  return typeof detail === 'object' && detail !== null && IN_ITS_OWN_WORDS.has(detail)
}

export const giveRequestSchema = z
  .object({
    /** The agent to give it to, by profile. The same path-segment alphabet every profile name uses. */
    profile: z.string().refine(isPathSegment, `must be ${PATH_SEGMENT_RULE}`),
    /** What the piece is called — the line a person and a model read beside its label. */
    title: z.string().trim().min(1).max(PIECE_TITLE_CHARS),
    brief: workBriefText,
    definition_of_done: doneConditionText,
    /** ⚑ Used only when this give starts a conversation; a relative one is read from the giver's. */
    folder: z.string().optional(),
    /** "new" for a new conversation, or the address of the conversation that continues the job. */
    to: z.string().trim().min(1).max(200).optional(),
    /** The job's name, for a new conversation. */
    conversation_title: z.string().optional(),
    /**
     * The caller's own task to hang this under, by label or id — inferred: the one open task that
     * has reached it, of several the one its turn drives, else its root (D-022 · R4).
     */
    under: z.string().min(1).max(200).optional(),
    /** The provider a new conversation runs on; an existing conversation keeps its own. */
    provider: providerSchema.optional(),
    /**
     * 🔴 **D-016 · files handed over with the work, kept as the piece's inputs** — read from the
     * giver's folder, and kept before anything is written or sent (`RuntimeHost.giveWork`).
     */
    resources: z.array(z.string().min(1)).optional(),
    inputs: z.array(z.string().min(1)).optional(),
    /**
     * 🔴 **D-042 · R4 — the model that conversation runs on, from this piece on** — one in the list
     * a person keeps for its provider. ⚑ The provider never changes.
     */
    model: z.string().min(1).max(120).optional(),
    /** 🔴 **D-042 · R4 — its reasoning effort**, one that model offers. */
    effort: z.string().min(1).max(60).optional(),
  })
  .strict()

export type GiveRequest = z.infer<typeof giveRequestSchema>

/**
 * 🔴 **D-016 · commit 6 · R1 — `take_on_work`'s request: a give's own `title` and `brief`, bounded
 * as a give's are, and nothing else.** ⛔ No `folder`, no `inputs`, no `piece`: work taken on always
 * hangs under the caller's own root. ⚑ `.strict()`, as the give's is, so a key a caller believes in
 * is refused by name (`303` B) rather than dropped.
 */
export const takeOnWorkRequestSchema = giveRequestSchema
  .pick({ title: true, inputs: true })
  .extend({
    brief: workBriefText,
    definition_of_done: doneConditionText,
    piece: z.string().min(1).max(200).optional(),
  })
  .strict()
