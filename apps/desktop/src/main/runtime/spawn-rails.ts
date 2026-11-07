import type { AgentModelChoice, WhereItCameFrom } from '../../shared/model-choice-contracts'
import type { TaskStallCause } from '../../shared/task-contracts'
import type { WorkerBindingReading } from '../../shared/worker-reading'
import { DONE_CONDITION_CHARS, WORK_BRIEF_CHARS, WORK_FIELD_WORDS } from '../../shared/work-fields'
import { refusalReason } from '../../shared/refusals'
import { isAbsolute, join } from 'node:path'
import type { GivenFolder } from '../../shared/work-folders'
import { z } from 'zod'
import { providerSchema, type Provider } from '@brobot2/shared'
import { whatTheChildWouldLack, type ApprovalMode, type Protection } from '@brobot2/runtime'
import { DEFAULT_CAPABILITIES, type ProfileCapabilities } from '../db/session-store'
import {
  PATH_SEGMENT_RULE,
  PROVIDER_NAME,
  foldProfileName,
  isPathSegment,
  type IdentityCreator,
} from '../../shared/runtime-ipc'
import type { ItsProvider, StartedOn } from '../../shared/agent-roster'
import { PIECE_TITLE_CHARS } from '../../shared/piece-called'
import { MAX_RESOURCES_PER_REPLY } from '../../shared/documents'

import type { RailPermanence, RefusalRemedy } from '../../shared/refusals'
import { undrivenSentence } from '../../shared/tasks'
import type { CallerIdentity, TellDelivery } from './runtime-host'
import type { MessageRefusal } from './message-rails'
import type { ResourceRefusal } from '../resources/resources'
import type { ModelRefusal } from './model-rails'

export type SpawnRail = keyof typeof SPAWN_RECORDS

export type { RailPermanence } from '../../shared/refusals'

export function permanenceOf(rail: SpawnRail): RailPermanence {
  return SPAWN_RECORDS[rail].permanence
}

export function retryableOf(rail: SpawnRail): boolean {
  return permanenceOf(rail) === 'while-this-holds'
}

export function remedyOf(rail: SpawnRail): RefusalRemedy | null {
  return SPAWN_RECORDS[rail].remedy
}

export interface SpawnRefusalDetail {
  profileId?: string
  executionProblem?: string
  piece?: string
  held?: readonly string[]
  label?: string
  depth?: number
  maxDepth?: number
  asked?: ApprovalMode
  spawnerRunsAs?: ApprovalMode
  wouldLack?: readonly Protection[]
  provider?: Provider
  choices?: readonly string[]
  startedOn?: StartedOn
  folderReason?: string
  problems?: readonly string[]
  unknownFields?: readonly string[]
}

export interface SpawnRefusal {
  readonly rail: SpawnRail
  readonly permanence: RailPermanence
  readonly retryable: boolean
  readonly reason: string
  readonly remedy: RefusalRemedy | null
  readonly detail: SpawnRefusalDetail
}

const PROTECTION_SAID: Readonly<Record<Protection, string>> = {
  'the-card-before-an-act': 'the card before you act',
  'the-sandbox-around-an-act': 'the sandbox around what you run',
}

export const labelsSaid = (labels: readonly string[] | undefined): string => {
  const all = labels ?? []
  if (all.length <= 1) return all[0] ?? '?'
  return `${all.slice(0, -1).join(', ')} and ${String(all[all.length - 1])}`
}

export interface AStallAGiveNames {
  readonly label: string
  readonly cause: TaskStallCause
}

export function stalledPiecesSaid(stalled: readonly AStallAGiveNames[]): string {
  if (stalled.length === 0) return ''
  const them = stalled.length > 1 ? 'them' : 'it'
  const named = labelsSaid(stalled.map((one) => `${one.label} (${undrivenSentence(one.cause)})`))
  return `It still holds ${named} from you, not being worked on: follow ${them} up with message_agent (kind follow-up), or take ${them} back with withdraw_task.`
}

const SPAWN_RECORDS = {
  'malformed-request': {
    permanence: 'permanent',
    remedy: null,
    sentence: () => {
      return (
        'This request could not be read, so nothing was given. Send exactly the fields this tool ' +
        'documents — an unrecognised one is refused rather than ignored, because a request that ' +
        'half-arrives gives an agent something else.'
      )
    },
  },
  'no-piece-to-give-from': {
    permanence: 'permanent',
    remedy: null,
    sentence: () => {
      return 'Do the work here until you hold a piece; list_tasks shows your board. You hold no open piece that has reached you, so there is nothing to hang this under and nothing was given.'
    },
  },
  'name-the-piece-you-give-from': {
    permanence: 'permanent',
    remedy: null,
    sentence: (detail: SpawnRefusalDetail) => {
      return `Say which of your pieces this is for (${labelsSaid(detail.held)}): give again naming it as piece.`
    },
  },
  'no-piece-you-hold-by-that-name': {
    permanence: 'permanent',
    remedy: null,
    sentence: () => {
      return 'You hold no open piece by that name, so nothing was given. list_tasks names what you hold.'
    },
  },
  'too-deep': {
    permanence: 'until-a-person-changes-it',
    remedy: null,
    sentence: (detail: SpawnRefusalDetail) => {
      return (
        `Too deep to give: under ${detail.label ?? '?'} it would sit at depth ${String(detail.depth ?? '?')}, ` +
        `past the ${String(detail.maxDepth ?? '?')} this agent may give. ` +
        'Do it yourself, or ask whoever gave you your piece.'
      )
    },
  },
  'services-are-off': {
    permanence: 'until-a-person-changes-it',
    remedy: null,
    sentence: (detail: SpawnRefusalDetail) => {
      return `Not given: services are off. Do the work yourself, or give it to another agent; “${detail.profileId ?? '?'}” is a service.`
    },
  },
  'its-kind-is-unknown': {
    permanence: 'until-a-person-changes-it',
    remedy: null,
    sentence: (detail: SpawnRefusalDetail) => {
      if (detail.executionProblem) return `Not given: ${detail.executionProblem}`
      return `Not given: the services list can’t be read. Give the work to another agent, or ask a person; this app can’t tell whether “${detail.profileId ?? '?'}” is a service.`
    },
  },
  'worker-binding-is-unknown': {
    permanence: 'until-a-person-changes-it',
    remedy: null,
    sentence: (detail: SpawnRefusalDetail) => {
      return `Not given: '${detail.profileId ?? '?'}' has no known conversation. Tell a person, and give it again once that is fixed.`
    },
  },
  'parallel-not-for-a-service': {
    permanence: 'permanent',
    remedy: null,
    sentence: () => {
      return 'A service runs one piece at a time. Leave parallel out to queue the work.'
    },
  },
  'service-provider-is-fixed': {
    permanence: 'permanent',
    remedy: null,
    sentence: (detail: SpawnRefusalDetail) => {
      return (
        `“${detail.profileId ?? '?'}” is a service with one conversation on ${detail.provider === undefined ? 'its provider' : PROVIDER_NAME[detail.provider]}. ` +
        `Give it work on that provider; its models are ${(detail.choices ?? []).join(', ') || 'not available right now'}. ` +
        'A service cannot take a second provider.'
      )
    },
  },
  'no-free-worker-at-capacity': {
    permanence: 'while-this-holds',
    remedy: 'make-the-same-call-when-this-settles',
    sentence: (detail: SpawnRefusalDetail) => {
      return `Not given: '${detail.profileId ?? '?'}' already has 64 workers, and none is known to be free. Give it again when one is free.`
    },
  },
  'no-room-for-provider-conversation': {
    permanence: 'until-a-person-changes-it',
    remedy: null,
    sentence: (detail: SpawnRefusalDetail) => {
      return (
        'Give work on a provider already in that pool, or choose another agent. ' +
        `Your worker pool for “${detail.profileId ?? '?'}” is full and has no conversation on ${detail.provider === undefined ? 'the chosen provider' : PROVIDER_NAME[detail.provider]}. ` +
        'A person can remove a worker to make room; waiting for these workers to finish will not free a place for another provider.'
      )
    },
  },
  'that-is-this-conversation': {
    permanence: 'permanent',
    remedy: null,
    sentence: () => {
      return 'Not given: that agent is you. Do this part within the piece you are working on.'
    },
  },
  'it-would-wait-on-itself': {
    permanence: 'while-this-holds',
    remedy: 'make-the-same-call-when-this-settles',
    sentence: () => {
      return 'Not given: that service is waiting on work you hold, so it would never reach this. Finish or take back that work, then give this again.'
    },
  },
  'its-waits-cannot-all-be-checked': {
    permanence: 'while-this-holds',
    remedy: 'make-the-same-call-when-this-settles',
    sentence: (detail: SpawnRefusalDetail) => {
      return `Not given: its waits can’t all be checked. Give the work to another agent, or give it again once some of the work “${detail.profileId ?? '?'}” waits on has ended.`
    },
  },
  'its-record-cannot-be-read': {
    permanence: 'permanent',
    remedy: null,
    sentence: (detail: SpawnRefusalDetail) => {
      return `Not given: part of this app’s record of what “${detail.profileId ?? '?'}” gave can’t be read. Give the work to another agent.`
    },
  },
  'that-profile-exists': {
    permanence: 'permanent',
    remedy: null,
    sentence: (detail: SpawnRefusalDetail) => {
      return `“${detail.profileId ?? '?'}” is already an agent, so no new one was made and nothing was given. Give without new to use it: it keeps its memory.`
    },
  },
  'spawning-disabled': {
    permanence: 'until-a-person-changes-it',
    remedy: null,
    sentence: () => {
      return (
        'Agents may not start new conversations in this app right now, so a give that would start ' +
        'one gives nothing. Only a person can switch it back on. Work can still be given to an ' +
        'agent you already have a conversation with.'
      )
    },
  },
  'may-not-create-agents': {
    permanence: 'until-a-person-changes-it',
    remedy: null,
    sentence: () => {
      return 'You may not bring a new agent into existence, so nothing was given. Give to an agent list_profiles names, or ask a person.'
    },
  },
  'wider-than-its-parent': {
    permanence: 'until-a-person-changes-it',
    remedy: null,
    sentence: (detail: SpawnRefusalDetail) => {
      return (
        'Do this work here, or ask a person whether to change your approval mode. ' +
        `Nothing was given: you run in “${detail.spawnerRunsAs ?? '?'}”, with ` +
        `${(detail.wouldLack ?? []).map((kept) => PROTECTION_SAID[kept]).join(' and ') || 'a protection'}, ` +
        `and the conversation it would start would run in “${detail.asked ?? '?'}”, writing outside its ` +
        'folder and reaching the network with nobody asked.'
      )
    },
  },
  'no-such-profile': {
    permanence: 'permanent',
    remedy: null,
    sentence: (detail: SpawnRefusalDetail) => {
      return (
        'There is no agent by that name, so nothing was given: check the spelling — list_profiles ' +
        'names every agent. To bring a new agent into existence under this name, give it again with ' +
        `new: true. It asked for “${detail.profileId ?? '?'}”.`
      )
    },
  },
  'its-provider-is-not-chosen': {
    permanence: 'until-a-person-changes-it',
    remedy: null,
    sentence: (detail: SpawnRefusalDetail) => {
      {
        const on = Object.entries(detail.startedOn ?? {})
          .filter(([, started]) => started > 0)
          .map(
            ([provider, started]) => `${PROVIDER_NAME[provider as Provider]} (${String(started)})`,
          )
          .join(' and ')
        return on === ''
          ? `Ask a person to choose a provider for “${detail.profileId ?? '?'}” on its sheet, or give ` +
              'the work to another agent: it has no provider saved and no conversation yet, so ' +
              'nothing was given.'
          : `Ask a person to choose a provider for “${detail.profileId ?? '?'}” on its sheet, or give ` +
              `the work to another agent: it has no provider saved and its conversations ran on ` +
              `${on}, so nothing was given.`
      }
    },
  },
  'folder-unusable': {
    permanence: 'until-a-person-changes-it',
    remedy: null,
    sentence: (detail: SpawnRefusalDetail) => {
      return `The folder a new conversation would work in cannot be used, and only a person can make it right. What is wrong with it: ${detail.folderReason ?? 'no reason given'}.`
    },
  },
} satisfies Record<
  string,
  {
    permanence: RailPermanence
    remedy: RefusalRemedy | null
    sentence: (detail: SpawnRefusalDetail) => string
  }
>

export const SPAWN_RAILS: readonly SpawnRail[] = Object.keys(SPAWN_RECORDS) as SpawnRail[]

export function describeRail(rail: SpawnRail, detail: SpawnRefusalDetail = {}): string {
  return SPAWN_RECORDS[rail].sentence(detail)
}

export function refuse(rail: SpawnRail, detail: SpawnRefusalDetail = {}): SpawnRefusal {
  return {
    rail,
    permanence: permanenceOf(rail),
    retryable: retryableOf(rail),
    reason: refusalReason(describeRail(rail, detail)),
    remedy: remedyOf(rail),
    detail,
  }
}

export const doneConditionSchema = z
  .string({ error: WORK_FIELD_WORDS.required })
  .refine((value) => value.trim() !== '', WORK_FIELD_WORDS.blank)
  .max(DONE_CONDITION_CHARS, WORK_FIELD_WORDS.conditionLimit)

export const workBriefSchema = z
  .string()
  .refine((value) => value.trim() !== '', 'must say something')
  .max(WORK_BRIEF_CHARS, WORK_FIELD_WORDS.briefLimit)

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

const unknownFieldNames = (keys: readonly string[]): string[] =>
  keys.slice(0, 5).map((key) => (key.length > 40 ? `${key.slice(0, 39)}…` : key))

const workRequestProblems = (
  issues: readonly z.core.$ZodIssue[],
  request: unknown,
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

const IN_ITS_OWN_WORDS = new WeakSet<object>()

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

export function problemsInItsOwnWords(detail: unknown): boolean {
  return typeof detail === 'object' && detail !== null && IN_ITS_OWN_WORDS.has(detail)
}

export const giveRequestSchema = z
  .object({
    profile: z.string().refine(isPathSegment, `must be ${PATH_SEGMENT_RULE}`),
    title: z.string().trim().min(1).max(PIECE_TITLE_CHARS),
    brief: workBriefSchema,
    definition_of_done: doneConditionSchema,
    folder: z.string().optional(),
    piece: z.string().min(1).max(200).optional(),
    new: z.boolean().optional(),
    provider: providerSchema.optional(),
    parallel: z.boolean().optional(),
    inputs: z.array(z.string().min(1)).max(MAX_RESOURCES_PER_REPLY).optional(),
    model: z.string().min(1).max(120).optional(),
    effort: z.string().min(1).max(60).optional(),
  })
  .strict()

export type GiveRequest = z.infer<typeof giveRequestSchema>

export const takeOnWorkRequestSchema = giveRequestSchema
  .pick({ title: true, brief: true, definition_of_done: true, piece: true, inputs: true })
  .strict()

export interface WhatItRunsOn {
  readonly provider: Provider
  readonly model: string | null
  readonly effort: string | null
  readonly effortReported: boolean
  readonly how: 'started' | 'switched' | 'unchanged' | 'a-person-chose-it' | 'another-provider'
  readonly from: WhereItCameFrom | null
  readonly named: { readonly model: boolean; readonly effort: boolean }
}

export interface AdmittedSpawn {
  readonly parentSessionId: string
  readonly profileId: string
  readonly provider: Provider
  readonly cwd: string
  readonly approvalMode: 'ask' | 'auto'
  readonly commandedBy: CallerIdentity | null
}

export interface GivingConversation {
  readonly sessionId: string
  readonly profileId: string
  readonly provider: Provider
  readonly cwd: string
  readonly approvalMode: ApprovalMode
}

export interface HeldPiece {
  readonly piece: string
  readonly label: string
  readonly root: boolean
  readonly giver: string | null
  readonly received: boolean
}

export interface GiveFacts {
  readonly giver: () => GivingConversation
  readonly held: (giver: string) => readonly HeldPiece[]
  readonly drivenByTheTurn: () => string | null
  readonly isAHelper: () => boolean
  readonly mayGiveWork: () => MessageRefusal | null
  readonly depthOf: (piece: string) => number
  readonly capabilitiesOf: (profileSlug: string) => ProfileCapabilities | null
  readonly helperAs: (giver: string, profileSlug: string, provider?: Provider) => string | null
  readonly workerAt?: (
    giver: string,
    profileSlug: string,
    parallel: boolean,
    provider?: Provider,
  ) =>
    | { readonly is: 'legacy' | 'unknown' }
    | { readonly is: 'full'; readonly noProvider?: true }
    | { readonly is: 'known'; readonly conversation: string | null }
  readonly serviceAt: (giver: string, profileSlug: string) => ServiceAtAGive
  readonly spawningEnabled: () => boolean
  readonly mayCreateAgents: () => IdentityCreator | null
  readonly itsProvider: (profileSlug: string) => ItsProvider
  readonly theNamedModelsProvider: () => Provider | null
  readonly serviceModels?: () => readonly string[]
  readonly modelChoiceOf: (profileSlug: string) => AgentModelChoice | null
  readonly checkFolder: (path: string) => { ok: true; path: string } | { ok: false; reason: string }
}

export type ServiceAtAGive =
  | { readonly is: 'normal' | 'off' | 'unknown'; readonly why?: string }
  | {
      readonly is: 'service'
      readonly conversation: string | null
      readonly isTheGiver: boolean
      readonly waitsOnTheGiver: 'yes' | 'no' | 'unknown' | 'unread'
      readonly provider: Provider | null
    }

export type GiveAdmission =
  | { readonly ok: false; readonly refusal: SpawnRefusal | MessageRefusal }
  | {
      readonly ok: true
      readonly asked: GiveRequest
      readonly giver: string
      readonly under: HeldPiece
      readonly goes:
        | {
            readonly to: 'the-one-it-has'
            readonly conversation: string
            readonly grant: string | null
            readonly notGranted: string | null
          }
        | {
            readonly to: 'a-new-conversation'
            readonly start: AdmittedSpawn
            readonly creating: { readonly slug: string; readonly by: IdentityCreator } | null
          }
        | {
            readonly to: 'a-service'
            readonly conversation: string | null
            readonly profileId: string
            readonly provider: Provider | null
            readonly grant: string | null
            readonly notGranted: string | null
          }
    }

export type GiveOutcome =
  | {
      readonly ok: true
      readonly piece: string
      readonly label: string
      readonly owner: string
      readonly found: string
      readonly profile: string
      readonly worker?: WorkerBindingReading
      readonly delivery: Exclude<TellDelivery, 'not-delivered'>
      readonly runsOn: WhatItRunsOn
      readonly startedIn: string | null
      readonly startedOnDefault?: true
      readonly givenFolder: GivenFolder | null
      readonly folderNotGranted: string | null
      readonly grantReach: 'writes' | 'reads' | 'already' | null
      readonly inputs: readonly { readonly resource: string; readonly name: string }[]
      readonly queuedBehind?: number
      readonly queueStalledAt?: number
      readonly stalled?: readonly AStallAGiveNames[]
    }
  | {
      readonly ok: false
      readonly refusal: SpawnRefusal | MessageRefusal | ResourceRefusal | ModelRefusal
    }

export interface ReplacedConversation {
  readonly parentSessionId: string
  readonly profileId: string
  readonly provider: Provider
  readonly cwd: string
  readonly approvalMode: ApprovalMode
  readonly commandedBy: CallerIdentity
}

export function admitAReplacement(replaced: ReplacedConversation): AdmittedSpawn {
  const admitted: AdmittedSpawn = {
    parentSessionId: replaced.parentSessionId,
    profileId: replaced.profileId,
    provider: replaced.provider,
    cwd: replaced.cwd,
    approvalMode: replaced.approvalMode,
    commandedBy: replaced.commandedBy,
  }
  return admitted
}

export function theProviderAStartRunsOn(
  asked: Pick<GiveRequest, 'profile' | 'provider'>,
  known: boolean,
  giving: Pick<GivingConversation, 'provider'>,
  facts: Pick<GiveFacts, 'modelChoiceOf' | 'itsProvider'>,
  theNamedModels: Provider | null,
): Provider | null {
  if (asked.provider !== undefined) return asked.provider
  if (theNamedModels !== null) return theNamedModels
  const its: ItsProvider = known
    ? facts.itsProvider(asked.profile)
    : { provider: null, from: 'nothing-yet' }
  if (its.provider !== null) return its.provider
  if (its.from === 'its-conversations-differ') return null
  const chosen = known ? facts.modelChoiceOf(asked.profile) : null
  return chosen?.provider ?? giving.provider
}

function placedFrom(folder: string, giversFolder: string): string {
  const spelled = folder.trim()
  return spelled !== '' && !isAbsolute(spelled) && spelled !== '~' && !spelled.startsWith('~/')
    ? join(giversFolder, spelled)
    : folder
}

export function admitGive(request: unknown, by: CallerIdentity, facts: GiveFacts): GiveAdmission {
  const no = (rail: SpawnRail, detail: SpawnRefusalDetail = {}): GiveAdmission => ({
    ok: false,
    refusal: refuse(rail, detail),
  })

  const parsed = giveRequestSchema.safeParse(request)
  if (!parsed.success) {
    const takes = Object.keys(giveRequestSchema.shape)
    return no('malformed-request', workRequestRefused(parsed.error.issues, request, takes))
  }
  const asked = parsed.data
  const giving = facts.giver()

  const held = facts.held(giving.sessionId)
  let under: HeldPiece
  if (asked.piece !== undefined) {
    const named = held.find((one) => one.piece === asked.piece || one.label === asked.piece)
    if (named === undefined) return no('no-piece-you-hold-by-that-name', { piece: asked.piece })
    under = named
  } else {
    const received = held.filter((one) => !one.root && one.received)
    const givenToIt = held.filter((one) => !one.root && one.giver !== null)
    const notItsRoot = received.length === 0 && givenToIt.length > 0 && facts.isAHelper()
    const drives = received.length > 1 ? facts.drivenByTheTurn() : null
    const inferred =
      received.length === 1
        ? received[0]
        : received.length > 1
          ? received.find((one) => one.piece === drives)
          : notItsRoot
            ? undefined
            : held.find((one) => one.root)
    if (inferred === undefined) {
      if (notItsRoot) {
        return no('name-the-piece-you-give-from', { held: givenToIt.map((one) => one.label) })
      }
      return received.length > 1
        ? no('name-the-piece-you-give-from', { held: received.map((one) => one.label) })
        : no('no-piece-to-give-from')
    }
    under = inferred
  }

  const wall = facts.mayGiveWork()
  if (wall !== null) return { ok: false, refusal: wall }

  const giver = facts.capabilitiesOf(giving.profileId) ?? DEFAULT_CAPABILITIES
  const depth = facts.depthOf(under.piece) + 1
  if (depth > giver.maxDepth) {
    return no('too-deep', {
      depth,
      maxDepth: giver.maxDepth,
      label: under.label,
      profileId: asked.profile,
    })
  }

  const service = asked.new === true ? null : facts.serviceAt(giving.sessionId, asked.profile)
  if (service?.is === 'off') return no('services-are-off', { profileId: asked.profile })
  if (service?.is === 'unknown')
    return no('its-kind-is-unknown', {
      profileId: asked.profile,
      ...(service.why ? { executionProblem: service.why } : {}),
    })
  if (service?.is === 'service') {
    const requestedProvider = asked.provider ?? facts.theNamedModelsProvider()
    if (
      requestedProvider != null &&
      service.provider !== null &&
      requestedProvider !== service.provider
    ) {
      return no('service-provider-is-fixed', {
        profileId: asked.profile,
        provider: service.provider,
        choices: facts.serviceModels?.() ?? [],
      })
    }
    if (asked.parallel === true)
      return no('parallel-not-for-a-service', { profileId: asked.profile })
    if (service.isTheGiver) return no('that-is-this-conversation', { profileId: asked.profile })
    if (service.waitsOnTheGiver === 'yes') {
      return no('it-would-wait-on-itself', { profileId: asked.profile })
    }
    if (service.waitsOnTheGiver === 'unknown') {
      return no('its-waits-cannot-all-be-checked', { profileId: asked.profile })
    }
    if (service.waitsOnTheGiver === 'unread') {
      return no('its-record-cannot-be-read', { profileId: asked.profile })
    }
    if (service.conversation === null) {
      const mayStart = facts.spawningEnabled()
      if (!mayStart) return no('spawning-disabled', { profileId: asked.profile })
      if (service.provider === null) {
        const its = facts.itsProvider(asked.profile)
        return no('its-provider-is-not-chosen', {
          profileId: asked.profile,
          ...(its.from === 'its-conversations-differ' ? { startedOn: its.startedOn } : {}),
        })
      }
    }
    const named = asked.folder?.trim() ?? ''
    const checked = named === '' ? null : facts.checkFolder(placedFrom(named, giving.cwd))
    const grant = checked?.ok === true ? checked.path : null
    const notGranted = checked !== null && !checked.ok ? checked.reason : null
    return {
      ok: true,
      asked,
      giver: giving.sessionId,
      under,
      goes: {
        to: 'a-service',
        conversation: service.conversation,
        profileId: foldProfileName(asked.profile),
        provider: service.conversation === null ? service.provider : null,
        grant,
        notGranted,
      },
    }
  }

  const known = facts.capabilitiesOf(asked.profile) !== null
  const provider = theProviderAStartRunsOn(
    asked,
    known,
    giving,
    facts,
    facts.theNamedModelsProvider(),
  )
  const worker = facts.workerAt?.(
    giving.sessionId,
    asked.profile,
    asked.parallel === true && asked.new !== true,
    provider ?? undefined,
  )
  if (worker?.is === 'full') {
    return asked.parallel === true && worker.noProvider !== true
      ? no('no-free-worker-at-capacity', { profileId: asked.profile })
      : no('no-room-for-provider-conversation', {
          profileId: asked.profile,
          ...(provider === null ? {} : { provider }),
        })
  }
  if (worker?.is === 'unknown') return no('worker-binding-is-unknown', { profileId: asked.profile })
  const found =
    worker?.is === 'known'
      ? worker.conversation
      : facts.helperAs(giving.sessionId, asked.profile, provider ?? undefined)
  if (found !== null) {
    if (asked.new === true) return no('that-profile-exists', { profileId: asked.profile })
    let grant: string | null = null
    let notGranted: string | null = null
    if (asked.folder !== undefined && asked.folder.trim() !== '') {
      const folder = facts.checkFolder(placedFrom(asked.folder, giving.cwd))
      if (folder.ok) grant = folder.path
      else notGranted = folder.reason
    }
    return {
      ok: true,
      asked,
      giver: giving.sessionId,
      under,
      goes: { to: 'the-one-it-has', conversation: found, grant, notGranted },
    }
  }

  if (!facts.spawningEnabled()) return no('spawning-disabled', { profileId: asked.profile })
  const creator = asked.new === true && !known ? facts.mayCreateAgents() : null
  if (asked.new === true && !known && creator === null) {
    return no('may-not-create-agents', { profileId: asked.profile })
  }

  const approvalMode = giving.approvalMode

  const wouldLack =
    provider === null
      ? []
      : whatTheChildWouldLack(
          { provider, approvalMode },
          { provider: giving.provider, approvalMode: giving.approvalMode },
        )
  if (wouldLack.length > 0) {
    return no('wider-than-its-parent', {
      asked: approvalMode,
      spawnerRunsAs: giving.approvalMode,
      wouldLack,
      profileId: asked.profile,
    })
  }

  if (!known && asked.new !== true) return no('no-such-profile', { profileId: asked.profile })
  if (known && asked.new === true) return no('that-profile-exists', { profileId: asked.profile })

  if (provider === null) {
    const its = facts.itsProvider(asked.profile)
    return no('its-provider-is-not-chosen', {
      profileId: asked.profile,
      ...(its.from === 'its-conversations-differ' ? { startedOn: its.startedOn } : {}),
    })
  }

  const requested =
    asked.folder !== undefined && asked.folder.trim() !== '' ? asked.folder : giving.cwd
  const folder = facts.checkFolder(placedFrom(requested, giving.cwd))
  if (!folder.ok) return no('folder-unusable', { folderReason: folder.reason })

  const start: AdmittedSpawn = {
    parentSessionId: giving.sessionId,
    profileId: known ? asked.profile : foldProfileName(asked.profile),
    provider,
    cwd: folder.path,
    approvalMode,
    commandedBy: by,
  }
  return {
    ok: true,
    asked,
    giver: giving.sessionId,
    under,
    goes: {
      to: 'a-new-conversation',
      start,
      creating: creator === null ? null : { slug: foldProfileName(asked.profile), by: creator },
    },
  }
}
