import type { Provider } from '@brobot2/shared'
import { withDeadline, type ContextReading } from '@brobot2/runtime'
import { newResourceId, newWorkId } from '../db/ids'
import type { SessionStore } from '../db/session-store'
import type { GivenFolder, ProtectedPlaceNotice } from '../../shared/work-folders'
import type { ItsProvider } from '../../shared/agent-roster'
import type { ModelAndEffort, WhereItCameFrom } from '../../shared/model-choice-contracts'
import type { CreatedSession, CwdVerdict, QueueOutcome } from '../../shared/runtime-ipc'
import { theListedRow } from '../../shared/model-choice'
import { judgeAnAgentsChoice, refuseModel, type TheListAsked } from '../connections/model-rails'
import type { ModelCatalogues } from '../connections/catalogues'
import type { OfferedFile, ResourceRefusal } from '../resources/resources'
import { THE_APP_ITSELF, sessionSpeakingAs, type Caller } from './conversation-caller'
import { RecordWriteFailed } from './record-write'
import { AGiveThatGaveNothing } from './session-unavailable'
import { keepSendOverflow } from './send-overflow'
import type { Giving } from './message-records'
import type { SendRecipientState } from '../../shared/tool-outcome'
import {
  admitGive,
  giveRequestSchema,
  refuse,
  theProviderAStartRunsOn,
  type AdmittedSpawn,
  type AStallAGiveNames,
  type GiveAdmission,
  type GiveFacts,
  type GiveOutcome,
  type GivingConversation,
  type HeldPiece,
  type ServiceAtAGive,
  type WhatItRunsOn,
} from './spawn-rails'

/** How many of the giver's recent conversations a give that names none lists. */
const RECENT_CONVERSATIONS_LISTED = 5

/** What a give needs from the host: its conversations, deliveries and starts. */
export interface GiveWorkHost {
  readonly store: () => SessionStore
  readonly resourcesRoot: () => string | undefined
  readonly modelCatalogues: () => ModelCatalogues
  readonly deliveryWaitMs: () => number
  readonly now: () => number
  readonly contextOf: (conversation: string) => ContextReading | null
  readonly runningAs: (sessionId: string) => GivingConversation | null
  readonly heldBy: (conversation: string) => readonly HeldPiece[]
  readonly theTurnDrives: (conversation: string) => string | null
  readonly isAHelper: (conversation: string) => boolean
  readonly theServiceAtAGive: (giver: string, profile: string) => ServiceAtAGive
  readonly theServiceStartAGiveMeets: (input: unknown) => Promise<void> | null
  readonly itsProvider: (profileSlug: string) => ItsProvider
  readonly checkCwd: (path: string) => CwdVerdict
  readonly addressOf: (conversation: string) => string
  readonly resolveConversationAddress: (address: string) => string
  readonly isAConversation: (conversation: string) => boolean
  readonly profileOf: (conversation: string) => string | null
  readonly theProviderOfConversation: (conversation: string) => Provider | null
  readonly thePairItRunsOn: (conversation: string) => ModelAndEffort | null
  readonly switchedFor: (conversation: string, choice: ModelAndEffort) => WhatItRunsOn['how']
  readonly switchedBack: (
    conversation: string,
    wrote: ModelAndEffort,
    was: ModelAndEffort | null,
  ) => void
  readonly keptFor: (
    conversation: string,
    spelled: readonly string[],
  ) =>
    | { readonly ok: true; readonly files: readonly (OfferedFile & { readonly title: string })[] }
    | { readonly ok: false; readonly refusal: ResourceRefusal }
  readonly aProtectedPlaceFor: (folder: string) => ProtectedPlaceNotice | null
  /** Hands the brief to the conversation, or the one that took its place. */
  readonly theBriefTo: (
    conversation: string,
    giving: Giving,
    by: Caller,
    onRecorded: (to: string) => void,
    deliver: (to: string, onAStop?: (to: string) => Promise<QueueOutcome>) => Promise<QueueOutcome>,
  ) => Promise<QueueOutcome>
  readonly queueTheBrief: (
    to: string,
    brief: string,
    by: Caller,
    giving: Giving,
    onAStop?: (to: string) => Promise<QueueOutcome>,
  ) => Promise<QueueOutcome>
  /** Records the service's one conversation, settled before use; returns its id. */
  readonly theServiceConversation: (
    profileId: string,
    conversation: string | null,
    provider: Provider | null,
  ) => string | Promise<string>
  readonly acceptAtTheService: (
    service: string,
    giving: Giving,
    pairAsked: ModelAndEffort | null,
  ) => void
  readonly noteWhatItGave: (giver: string, giving: Giving, to: string) => void
  readonly whenItsActivePieceStalled: (service: string) => number | null
  readonly queuedAhead: (piece: string, owner: string) => number | null
  readonly stallsIn: (
    conversation: string,
    giver: string,
    stalledWhenRecorded?: readonly AStallAGiveNames[],
  ) => readonly AStallAGiveNames[]
  readonly whatAGrantReaches: (conversation: string) => 'writes' | 'reads' | 'already'
  readonly whatItRunsOnNow: (
    conversation: string,
    judged: Provider,
    how: WhatItRunsOn['how'],
    from: WhereItCameFrom | null,
    named: WhatItRunsOn['named'],
  ) => WhatItRunsOn
  /** Starts the conversation a give admitted, under the piece it hangs from. */
  readonly startFromAGive: (
    start: AdmittedSpawn,
    startsOn: ModelAndEffort | null,
    giving: Giving,
  ) => Promise<CreatedSession>
  readonly firstBriefWasDelivered: (to: string, piece: string) => Promise<boolean>
  readonly cannotRunAfterGive: (
    error: unknown,
  ) => Extract<SendRecipientState, { kind: 'cannot-run' }>
}

/** A give a caller made, judged and carried out: `give_work`'s behaviour. */
export class GiveWork {
  constructor(private readonly host: GiveWorkHost) {}

  async give(input: unknown, by: Caller): Promise<GiveOutcome> {
    const h = this.host
    const speaking = sessionSpeakingAs(by)
    // A give that names a model or an effort reads its list before the rails; one that names
    // neither awaits nothing, so its admission happens in the tick it was made.
    const asking =
      by === THE_APP_ITSELF || speaking === null
        ? null
        : this.theListAGiveChoosesFrom(input, speaking)
    const choosing = asking === null ? null : await asking
    // A service starting is waited for before admission, so its row goes into a conversation
    // that has arrived.
    for (let waited = 0; waited < 3; waited += 1) {
      const starting = h.theServiceStartAGiveMeets(input)
      if (starting === null) break
      await withDeadline(starting, h.deliveryWaitMs(), 'a service starting').catch(() => {})
    }
    const giver = speaking === null ? null : h.runningAs(speaking)
    if (by === THE_APP_ITSELF || giver === null) {
      return { ok: false, refusal: refuse('no-piece-to-give-from') }
    }
    const admission = admitGive(
      input,
      by,
      this.facts(giver, choosing?.theNamedModels ?? null, choosing?.list.rows ?? []),
    )
    if (!admission.ok) return admission
    const { asked, under, goes } = admission
    const chosen = this.theChoiceOfAGive(asked, goes, choosing)
    if (chosen !== null && !chosen.ok) return { ok: false, refusal: chosen.refusal }
    // The files it hands over are the last rail: kept before anything is written or sent.
    const kept = h.keptFor(admission.giver, asked.inputs ?? [])
    if (!kept.ok) return { ok: false, refusal: kept.refusal }
    const brief = keepSendOverflow(h.resourcesRoot(), 'brief', asked.brief)
    if (!brief.ok) return brief
    const done = keepSendOverflow(h.resourcesRoot(), 'definition_of_done', asked.definition_of_done)
    if (!done.ok) return done
    const overflow = [brief.overflow, done.overflow].filter((one) => one !== null)
    const hasOverflow = overflow.length === 0 ? {} : { overflow }
    const choice = chosen?.chosen ?? null
    const store = h.store()
    const existing = goes.to === 'a-new-conversation' ? null : goes.conversation
    const lastActive = existing === null ? null : (store.find(existing)?.updatedAt ?? null)
    const facts = { under: under.label, lastActive, at: h.now() }
    const number = store.numberUnder(under.piece)
    const giving: Giving = {
      piece: newWorkId(),
      parent: under.piece,
      number,
      label: `${under.label}.${String(number)}`,
      giver: admission.giver,
      title: asked.title,
      brief: brief.inline,
      definitionOfDone: done.inline,
      folder: asked.folder ?? null,
      givenFolder: this.theFolderItGave(asked.folder, goes),
      inputs: [
        ...kept.files.map((file) => ({
          resource: newResourceId(),
          title: file.title,
          name: file.name,
          sha256: file.sha256,
          bytes: file.bytes.length,
        })),
        ...overflow.map((one) => one.file),
      ],
      ...(goes.to === 'a-new-conversation' ? { conversationTitle: goes.title } : {}),
    }
    const inputs = giving.inputs.map(({ resource, name }) => ({ resource, name }))
    const gaveNothing = (error: unknown): never => {
      if (error instanceof RecordWriteFailed) throw error
      throw store.workById(giving.piece) === null
        ? new AGiveThatGaveNothing(giving.label, error)
        : error
    }
    let reached: string | null = null
    const applied: { how: WhatItRunsOn['how'] } = { how: 'unchanged' }
    const named = { model: asked.model !== undefined, effort: asked.effort !== undefined }
    const chooseForDelivery = (to: string): ModelAndEffort | null | undefined => {
      reached = to
      if (goes.to === 'the-one-it-has' && choice !== null && applied.how !== 'switched') {
        if (h.theProviderOfConversation(to) !== choosing?.provider) {
          applied.how = 'another-provider'
        } else {
          const was = h.thePairItRunsOn(to)
          applied.how = h.switchedFor(to, choice)
          if (applied.how === 'switched') return was
        }
      }
      return undefined
    }
    const deliver = (
      to: string,
      onAStop?: (to: string) => Promise<QueueOutcome>,
    ): Promise<QueueOutcome> => {
      const switchedFrom = chooseForDelivery(to)
      const queued = h.queueTheBrief(to, giving.brief, by, giving, onAStop)
      if (switchedFrom === undefined || choice === null) return queued
      const wrote = choice
      const was = switchedFrom
      return queued.catch((error: unknown) => {
        h.switchedBack(to, wrote, was)
        applied.how = 'unchanged'
        throw error
      })
    }
    if (goes.to === 'a-service') {
      let service: string
      try {
        const selected = h.theServiceConversation(goes.profileId, goes.conversation, goes.provider)
        service = typeof selected === 'string' ? selected : await selected
        h.acceptAtTheService(service, giving, choice)
      } catch (error) {
        return gaveNothing(error)
      }
      h.noteWhatItGave(giving.giver, giving, service)
      const queueStalledAt = h.whenItsActivePieceStalled(service)
      const judged = h.theProviderOfConversation(service) ?? giver.provider
      const behind = h.queuedAhead(giving.piece, service) ?? 0
      return {
        ok: true,
        piece: giving.piece,
        label: giving.label,
        owner: service,
        recipientState: { kind: 'queued', behind },
        receiptFacts: { ...facts, context: h.contextOf(service) },
        found: service,
        profile: asked.profile,
        delivery: 'held',
        runsOn: {
          ...h.whatItRunsOnNow(service, judged, 'unchanged', null, named),
          ...(choice === null
            ? {}
            : { model: choice.model, effort: choice.effort, effortReported: false }),
        },
        startedIn: null,
        givenFolder: giving.givenFolder,
        folderNotGranted: goes.notGranted,
        grantReach: null,
        inputs,
        ...hasOverflow,
        queuedBehind: behind,
        ...(queueStalledAt === null ? {} : { queueStalledAt }),
      }
    }
    if (goes.to === 'the-one-it-has') {
      let delivered: QueueOutcome | null = null
      let cannotRun: Extract<SendRecipientState, { kind: 'cannot-run' }> | undefined
      let stallsAtRecord: readonly AStallAGiveNames[] | undefined
      const onRecorded = (to: string): void => {
        // A new turn can wait on a person before the receipt is returned.
        stallsAtRecord = h.stallsIn(to, giving.giver)
        chooseForDelivery(to)
      }
      try {
        delivered = await h.theBriefTo(goes.conversation, giving, by, onRecorded, deliver)
      } catch (error) {
        if (store.workById(giving.piece) === null) return gaveNothing(error)
        cannotRun = h.cannotRunAfterGive(error)
      }
      const owner = store.workById(giving.piece)?.owner ?? reached ?? goes.conversation
      const judged = h.theProviderOfConversation(goes.conversation) ?? giver.provider
      h.noteWhatItGave(giving.giver, giving, owner)
      const stalled = h
        .stallsIn(owner, giving.giver, stallsAtRecord)
        .filter((one) => one.label !== giving.label)
      const sent = delivered?.outcome === 'sent'
      return {
        ok: true,
        piece: giving.piece,
        label: giving.label,
        owner,
        found: goes.conversation,
        profile: asked.profile,
        delivery: sent ? 'sent' : 'held',
        recipientState: cannotRun ?? this.briefState(store, owner, giving.piece, sent),
        receiptFacts: { ...facts, context: h.contextOf(owner) },
        runsOn: h.whatItRunsOnNow(owner, judged, applied.how, null, named),
        startedIn: null,
        givenFolder: giving.givenFolder,
        folderNotGranted: goes.notGranted,
        grantReach: goes.grant === null ? null : h.whatAGrantReaches(owner),
        inputs,
        ...hasOverflow,
        ...(stalled.length === 0 ? {} : { stalled }),
      }
    }
    const { start } = goes
    const startedOnDefault =
      asked.provider === undefined &&
      asked.model === undefined &&
      h.itsProvider(asked.profile).provider === start.provider
    const resolved = h.modelCatalogues().theSelectedPairIfNamed(start.provider, start.profileId)
    const startsOn: ModelAndEffort | null = choice ?? (resolved?.effort == null ? null : resolved)
    const from: WhereItCameFrom = named.model
      ? 'named'
      : (resolved?.from ?? 'the-providers-default')
    let sessionId: string
    let cannotRun: Extract<SendRecipientState, { kind: 'cannot-run' }> | undefined
    try {
      ;({ sessionId } = await h.startFromAGive(start, startsOn, giving))
    } catch (error) {
      const recorded = store.workById(giving.piece)
      if (recorded === null) return gaveNothing(error)
      sessionId = recorded.owner
      cannotRun = h.cannotRunAfterGive(error)
    }
    const delivered =
      cannotRun === undefined && (await h.firstBriefWasDelivered(sessionId, giving.piece))
    h.noteWhatItGave(giving.giver, giving, sessionId)
    return {
      ok: true,
      piece: giving.piece,
      label: giving.label,
      owner: sessionId,
      found: sessionId,
      profile: asked.profile,
      delivery: delivered ? 'sent' : 'held',
      recipientState: cannotRun ?? this.briefState(store, sessionId, giving.piece, delivered),
      receiptFacts: { ...facts, context: null },
      runsOn: h.whatItRunsOnNow(
        sessionId,
        start.provider,
        cannotRun === undefined ? 'started' : 'unchanged',
        from,
        named,
      ),
      startedIn: cannotRun === undefined ? start.cwd : null,
      ...(startedOnDefault && cannotRun === undefined ? { startedOnDefault: true as const } : {}),
      givenFolder: giving.givenFolder,
      folderNotGranted: null,
      grantReach: null,
      inputs,
      ...hasOverflow,
    }
  }

  private briefState(
    store: SessionStore,
    owner: string,
    piece: string,
    sent: boolean,
  ): SendRecipientState {
    if (sent) return { kind: 'started' }
    const behind = store.messagesWaitingIn(owner).findIndex((one) => one.piece === piece)
    return behind < 0 ? { kind: 'started' } : { kind: 'queued', behind }
  }

  /** The model list a give that names a model or an effort is judged against, and its provider. */
  private theListAGiveChoosesFrom(
    input: unknown,
    speaking: string,
  ): Promise<{
    readonly provider: Provider
    readonly list: TheListAsked
    readonly theNamedModels: Provider | null
  } | null> | null {
    const h = this.host
    const giving = h.runningAs(speaking)
    const parsed = giveRequestSchema.safeParse(input)
    if (giving === null || !parsed.success) return null
    const asked = parsed.data
    const service = h.theServiceAtAGive(speaking, asked.profile)
    const fixed = service.is === 'service' ? service.provider : null
    const serviceConflict =
      asked.provider !== undefined && fixed !== null && asked.provider !== fixed
    if (asked.model === undefined && asked.effort === undefined && !serviceConflict) return null
    // An addressed conversation keeps its provider; its model list is that provider's.
    const addressed =
      service.is === 'service' || asked.to === undefined || asked.to === 'new'
        ? null
        : this.conversationAt(asked.to)
    const known = h.store().agentIdentityOf(asked.profile) !== null
    const startsOn = (theNamedModels: Provider | null) =>
      fixed ??
      addressed?.provider ??
      theProviderAStartRunsOn(asked, known, giving, this.whatAStartsProviderReads, theNamedModels)
    const home =
      service.is === 'service' && service.conversation !== null
        ? (h.profileOf(service.conversation) ?? asked.profile)
        : addressed !== null
          ? addressed.profileId
          : asked.profile
    const listFor = (provider: Provider) => h.modelCatalogues().theListFor(provider, home)
    const preferred = startsOn(null)
    return (async () => {
      const first = preferred === null ? null : await listFor(preferred)
      if (
        asked.provider !== undefined ||
        asked.model === undefined ||
        (first !== null && theListedRow(first.rows, asked.model) !== undefined)
      ) {
        return preferred === null || first === null
          ? null
          : { provider: preferred, list: first, theNamedModels: null }
      }
      const theNamedModels = await h.modelCatalogues().theProviderWhoseListAloneHolds(asked.model)
      const provider = startsOn(theNamedModels) ?? preferred
      if (provider === null) return null
      return {
        provider,
        list: provider === preferred && first !== null ? first : await listFor(provider),
        theNamedModels,
      }
    })()
  }

  private readonly whatAStartsProviderReads: Pick<GiveFacts, 'modelChoiceOf' | 'itsProvider'> = {
    modelChoiceOf: (profileSlug) => this.host.store().modelChoiceOf(profileSlug),
    itsProvider: (profileSlug) => this.host.itsProvider(profileSlug),
  }

  /** The conversation an address names, read for a give; `null` when none answers to it. */
  private conversationAt(
    address: string,
  ): { conversation: string; profileId: string; provider: Provider | null } | null {
    const h = this.host
    const conversation = h.resolveConversationAddress(address)
    if (!h.isAConversation(conversation)) return null
    const profileId = h.profileOf(conversation)
    if (profileId === null) return null
    return { conversation, profileId, provider: h.theProviderOfConversation(conversation) }
  }

  private facts(
    giving: GivingConversation,
    theNamedModels: Provider | null,
    models: readonly { readonly id: string }[],
  ): GiveFacts {
    const h = this.host
    return {
      giver: () => giving,
      held: (giver) => h.heldBy(giver),
      drivenByTheTurn: () => h.theTurnDrives(giving.sessionId),
      isAHelper: () => h.isAHelper(giving.sessionId),
      agentExists: (profileSlug) => h.store().agentIdentityOf(profileSlug) !== null,
      conversationAt: (address) => this.conversationAt(address),
      recentWith: (profileSlug) => {
        const recent = h
          .store()
          .recentConversationsGivenFrom(giving.sessionId, profileSlug, RECENT_CONVERSATIONS_LISTED)
        return {
          rows: recent.rows.map((one) => ({
            address: h.addressOf(one.conversation),
            title: h.store().conversationTitle(one.conversation)?.title ?? one.title,
          })),
          more: recent.more,
        }
      },
      serviceAt: (giver, profileSlug) => h.theServiceAtAGive(giver, profileSlug),
      spawningEnabled: () => h.store().spawnPolicy().spawningEnabled,
      itsProvider: (profileSlug) => h.itsProvider(profileSlug),
      theNamedModelsProvider: () => theNamedModels,
      serviceModels: () => models.map(({ id }) => id),
      modelChoiceOf: (profileSlug) => h.store().modelChoiceOf(profileSlug),
      checkFolder: (path) => h.checkCwd(path),
    }
  }

  /** The model and effort a give chose, judged against the list of the conversation it reaches. */
  private theChoiceOfAGive(
    asked: Extract<GiveAdmission, { ok: true }>['asked'],
    goes: Extract<GiveAdmission, { ok: true }>['goes'],
    choosing: { readonly provider: Provider; readonly list: TheListAsked } | null,
  ): ReturnType<typeof judgeAnAgentsChoice> | null {
    if (choosing === null) return null
    const h = this.host
    const catalogues = h.modelCatalogues()
    const at:
      | { readonly made: { readonly provider: Provider; readonly profile: string } }
      | { readonly existing: string } =
      goes.to === 'a-new-conversation'
        ? { made: { provider: goes.start.provider, profile: goes.start.profileId } }
        : goes.to === 'a-service' && goes.conversation === null
          ? { made: { provider: goes.provider ?? choosing.provider, profile: goes.profileId } }
          : { existing: goes.conversation ?? '' }
    const provider =
      'made' in at
        ? at.made.provider
        : (h.theProviderOfConversation(at.existing) ?? choosing.provider)
    if (provider !== choosing.provider) {
      return {
        ok: false,
        refusal: refuseModel('the-provider-moved-meanwhile', { door: 'give', provider }),
      }
    }
    const otherwise =
      'made' in at
        ? (catalogues.theSelectedPairIfNamed(provider, at.made.profile) ??
          catalogues.theProvidersDefaultIn(choosing.list, provider, asked.effort))
        : (h.thePairItRunsOn(at.existing) ??
          catalogues.theSelectedPairIfNamed(provider, h.profileOf(at.existing)) ??
          catalogues.theProvidersDefaultIn(choosing.list, provider, asked.effort))
    return judgeAnAgentsChoice(
      {
        ...(asked.model === undefined ? {} : { model: asked.model }),
        ...(asked.effort === undefined ? {} : { effort: asked.effort }),
      },
      provider,
      choosing.list,
      otherwise === null ? null : { model: otherwise.model, effort: otherwise.effort },
      'give',
    )
  }

  /** The folder a give named, as this app used it, with the place it meets if it names one. */
  private theFolderItGave(
    asked: string | undefined,
    goes: Extract<GiveAdmission, { ok: true }>['goes'],
  ): GivenFolder | null {
    if (asked === undefined || asked.trim() === '') return null
    const given =
      goes.to !== 'a-new-conversation'
        ? goes.grant === null
          ? null
          : { folder: goes.grant, use: 'grant' as const }
        : { folder: goes.start.cwd, use: 'working-folder' as const }
    if (given === null) return null
    const notice = this.host.aProtectedPlaceFor(given.folder)
    return notice === null ? given : { ...given, notice }
  }
}
