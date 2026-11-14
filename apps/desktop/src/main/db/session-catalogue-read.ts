import type { AppStatement } from './connection'
import type { Provider, SessionStatus, TurnEnding } from '@brobot2/shared'
import { turnEndingSchema } from '@brobot2/shared'
import { parseSessionRef } from '@brobot2/runtime'
import type { ChildDescent } from '../adopt/discover-sessions'
import { PROVIDER_NAME, type DerivedState } from '../../shared/runtime-ipc'
import { NORMALIZER_VERSION } from '../archive/normalizer'

type TurnEndReason = TurnEnding

export interface ResumableSession {
  sessionId: string
  provider: Provider
  /** The parsed provider ref — a row without one is not returned at all. */
  ref: ReturnType<typeof parseSessionRef>
  cwd: string
  status: SessionStatus
  /** Null only for rows written before the column existed; never guessed. */
  approvalMode: 'ask' | 'auto' | null
  /** Null for rows written before profiles could be chosen — they ran in the default one. */
  profileId: string | null
  reasoningEffort: string | null
  model: string | null
  planMode: boolean | null
  planEndedAt: number | null
  modelOrEffortSetByAPersonAt: number | null
  reportedModel: string | null
  reportedEffort: string | null
  adoptedAt: number | null
  hasTranscript: boolean
  lastEnding: TurnEndReason | null
  child: ChildDescent | null
  resumeRefusal: string | null
  homeRefusal: string | null
  restoredFromBundle: boolean
  /** When the session began — the provider's own time for an adopted one. */
  createdAt: number
  updatedAt: number
}

export interface LiveSessionRow {
  sessionId: string
  /** Null for rows written before profiles could be chosen — they ran in the default one. */
  profileId: string | null
  /** Null only for rows written before the column existed; never guessed. */
  approvalMode: 'ask' | 'auto' | null
  /** The parsed ref, or null while the provider has not named this conversation yet. */
  ref: ReturnType<typeof parseSessionRef> | null
  model: string | null
  reasoningEffort: string | null
}

export interface UnresumableSession {
  sessionId: string
  provider: Provider
  cwd: string
  status: SessionStatus
  profileId: string | null
  adoptedAt: number | null
  updatedAt: number
  hasTranscript: boolean
  foundInUserHome: boolean
  restoredFromBundle: boolean
  lastEnding: TurnEndReason | null
  /** Plain-language why, from the row itself — never a guess. */
  reason: string
}

export interface RecordedSession {
  /** Our id for the row. */
  sessionId: string
  provider: Provider
  providerSessionId: string | null
  cwd: string
  status: SessionStatus
  profileId: string | null
  adoptedAt: number | null
  hasTranscript: boolean
  foundInUserHome: boolean
  restoredFromBundle: boolean
  derived: DerivedState | null
  lastEnding: TurnEndReason | null
  createdAt: number
  updatedAt: number
  /** Why it cannot be reopened, or null when it can — the same answer the reopen list gives. */
  unresumableReason: string | null
  neverStarted: boolean
  child: ChildDescent | null
}

interface SessionRow {
  id: string
  provider: string
  external_ref: string | null
  cwd: string
  status: string
  approval_mode: string | null
  profile_id: string | null
  reasoning_effort: string | null
  model: string | null
  plan_mode: number | null
  plan_ended_at: number | null
  model_or_effort_set_by_a_person_at: number | null
  reported_model: string | null
  reported_effort: string | null
  adopted_at: number | null
  restored_at: number | null
  child_descent: string | null
  has_events: number
  last_end_reason: string | null
  /** All null for a session with no `derived_generation` row — one this app recorded rather than projected. */
  normalizer_version: number | null
  building: number | null
  failure: string | null
  created_at: number
  updated_at: number
}

/** The generation columns of {@link SessionRow}, as the shape {@link derivedStateOf} reads. */
function derivedStateOfRow(row: SessionRow): DerivedState | null {
  if (row.normalizer_version === null) return null
  return derivedStateOf(
    {
      normalizerVersion: row.normalizer_version,
      building: row.building,
      failure: row.failure,
    },
    row.has_events !== 0,
  )
}

interface ProjectionState {
  normalizerVersion: number
  building: number | null
  failure: string | null
}

export function derivedStateOf(row: ProjectionState | null, present: boolean): DerivedState | null {
  if (row === null) return null
  if (row.building !== null) return 'rebuilding'
  if (row.failure !== null) return 'failed'
  if (!present) return null
  return row.normalizerVersion < NORMALIZER_VERSION ? 'stale' : 'current'
}

export function resolveEndReason(value: string | null): TurnEndReason | null {
  if (value === null) return null
  return turnEndingSchema.safeParse(value).success ? (value as TurnEndReason) : 'unknown'
}

export function parseChildDescent(raw: string | null): ChildDescent | null {
  if (raw === null || raw === '') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as ChildDescent) : null
  } catch {
    return null
  }
}

function providerIdOf(row: SessionRow): string | null {
  if (row.external_ref === null) return null
  try {
    return parseSessionRef(row.external_ref).sessionId
  } catch {
    return null
  }
}

function recordedOf(row: SessionRow): RecordedSession {
  return {
    ...describeRow(row),
    providerSessionId: providerIdOf(row),
    derived: derivedStateOfRow(row),
    createdAt: row.created_at,
    unresumableReason: reopenRefusalOf(row),
    neverStarted: row.external_ref === null,
    child: parseChildDescent(row.child_descent),
  }
}

function reopenRefusalOf(row: ReopenFacts): string | null {
  return canReopen(row) ? whyNoDirectInput(row) : whyNotResumable(row)
}

/** The part of a row that reads the same whether or not it can be resumed. */
function describeRow(row: SessionRow): Omit<UnresumableSession, 'reason'> {
  return {
    sessionId: row.id,
    provider: row.provider as Provider,
    cwd: row.cwd,
    status: row.status as SessionStatus,
    profileId: row.profile_id,
    adoptedAt: row.adopted_at,
    updatedAt: row.updated_at,
    hasTranscript: row.has_events !== 0,
    foundInUserHome: foundInUserHome(row),
    restoredFromBundle: restoredFromBundle(row),
    lastEnding: resolveEndReason(row.last_end_reason),
  }
}

interface ReopenFacts {
  provider: string
  external_ref: string | null
  profile_id: string | null
  adopted_at: number | null
  restored_at: number | null
  child_descent: string | null
  has_events: number
}

function whyNotResumable(row: ReopenFacts): string {
  const provider = PROVIDER_NAME[row.provider as Provider]
  if (restoredFromBundle(row)) {
    const held =
      row.has_events === 0
        ? 'restored from a bundle that carried no conversation'
        : 'restored from a bundle — BroCrew has the whole conversation and can show it'
    return (
      `${held}, but ${provider} never ran it on this machine, so a message here has nothing to ` +
      'carry on from'
    )
  }
  if (foundInUserHome(row)) {
    return (
      `one of your own ${provider} conversations, found in ${provider}'s own folder — BroCrew can ` +
      `read it here, but a message here would start ${provider} in BroCrew's own folder, where ` +
      'this conversation is not'
    )
  }
  if (row.external_ref !== null) {
    return 'we can no longer read where this conversation lives, so a message here cannot carry it on'
  }
  return row.has_events === 0
    ? 'no turn was ever taken in this one, so there is nothing to carry on from'
    : `this one stopped before ${provider} gave it an id, so there is nothing to carry on from`
}

function foundInUserHome(row: ReopenFacts): boolean {
  return row.adopted_at !== null && row.profile_id === null
}

function restoredFromBundle(row: ReopenFacts): boolean {
  return row.restored_at !== null
}

function hasSomewhereToReopen(row: ReopenFacts): boolean {
  return !foundInUserHome(row) && !restoredFromBundle(row)
}

function canReopen(row: ReopenFacts): boolean {
  return hasSomewhereToReopen(row) && readableRef(row) !== null
}

function readableRef(
  row: Pick<ReopenFacts, 'external_ref'>,
): ReturnType<typeof parseSessionRef> | null {
  return row.external_ref === null ? null : safeSessionRef(row.external_ref)
}

function safeSessionRef(external: string): ReturnType<typeof parseSessionRef> | null {
  try {
    return parseSessionRef(external)
  } catch {
    return null
  }
}

function toResumable(row: SessionRow): ResumableSession | null {
  const ref = readableRef(row)
  if (ref === null) return null
  try {
    return {
      sessionId: row.id,
      provider: row.provider as Provider,
      ref,
      cwd: row.cwd,
      status: row.status as SessionStatus,
      approvalMode:
        row.approval_mode === 'ask' || row.approval_mode === 'auto' ? row.approval_mode : null,
      profileId: row.profile_id,
      reasoningEffort: row.reasoning_effort,
      model: row.model,
      planMode: row.plan_mode === null ? null : row.plan_mode !== 0,
      planEndedAt: row.plan_ended_at,
      modelOrEffortSetByAPersonAt: row.model_or_effort_set_by_a_person_at,
      reportedModel: row.reported_model,
      reportedEffort: row.reported_effort,
      adoptedAt: row.adopted_at,
      hasTranscript: row.has_events === 1,
      child: parseChildDescent(row.child_descent),
      resumeRefusal: whyNoDirectInput(row),
      homeRefusal: hasSomewhereToReopen(row) ? null : whyNotResumable(row),
      restoredFromBundle: restoredFromBundle(row),
      lastEnding: resolveEndReason(row.last_end_reason),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  } catch {
    return null
  }
}

function whyNoDirectInput(row: ReopenFacts): string | null {
  if (parseChildDescent(row.child_descent) === null) return null
  return 'a sub-agent conversation — another agent drove it, so it takes no message of its own'
}

export function createSessionCatalogueRead(selectAll: AppStatement, selectOne: AppStatement) {
  function find(sessionId: string): ResumableSession | null {
    const row = selectOne.get(sessionId) as SessionRow | undefined
    return row ? (toResumable(row) ?? null) : null
  }

  function findLive(sessionId: string): LiveSessionRow | null {
    const row = selectOne.get(sessionId) as SessionRow | undefined
    if (!row) return null
    return {
      sessionId: row.id,
      profileId: row.profile_id,
      approvalMode:
        row.approval_mode === 'ask' || row.approval_mode === 'auto' ? row.approval_mode : null,
      ref: row.external_ref === null ? null : safeSessionRef(row.external_ref),
      model: row.model,
      reasoningEffort: row.reasoning_effort,
    }
  }

  function resumable(): ResumableSession[] {
    return (selectAll.all() as SessionRow[]).flatMap((row) => {
      if (!hasSomewhereToReopen(row)) return []
      const session = toResumable(row)
      return session ? [session] : []
    })
  }

  function unresumable(): UnresumableSession[] {
    // The same rows `resumable()` drops, kept with the reason they were dropped.
    return (selectAll.all() as SessionRow[]).flatMap((row) =>
      canReopen(row) ? [] : [{ ...describeRow(row), reason: whyNotResumable(row) }],
    )
  }

  function recorded(): RecordedSession[] {
    return (selectAll.all() as SessionRow[]).map(recordedOf)
  }

  function recordedOne(sessionId: string): RecordedSession | null {
    const row = selectOne.get(sessionId) as SessionRow | undefined
    return row === undefined ? null : recordedOf(row)
  }

  return { find, findLive, resumable, unresumable, recorded, recordedOne }
}
