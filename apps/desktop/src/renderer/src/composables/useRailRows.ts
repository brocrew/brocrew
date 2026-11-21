import { computed, onBeforeUnmount, onMounted, watchEffect, type Ref } from 'vue'
import { railSectionOf } from '../lib/rail-sections'
import { useRecoveredConversationList } from './useConversationListRecovery'
import type { WhatEachConversationIsWaitingOn } from '../../../shared/task-contracts'
import { agentStateWords } from '../../../shared/agent-state'
import {
  facetsOfState,
  recordFacets,
  standingOf,
  standingWord,
  stateHere,
  stateForRecord,
  type AgentFacets,
  type Standing,
} from '../lib/agent-state'
import {
  conversationList,
  withConversationStates,
  workerLabel,
  onPurposeSaid,
  type ListedConversation,
} from '../lib/conversation-list'
import { basenameOf } from '../lib/paths'
import type { ConversationIdentity } from '../../../shared/conversation-title'
import type { PaletteOpenRow } from '../lib/command-palette'
import type { AgentIdentities } from '../../../shared/runtime-ipc'
// 🔴 **636 · the one wait each row is in, out of the reading that covers every conversation** —
// see {@link SideRail.waiting}, and {@link theWaitIn} for the three absences it narrows.
import {
  theWaitIn,
  whoItOwesIn,
  theWorkIn,
  whatTheWaitsCouldNotRead,
  whoseAnswerIn,
  whoseWorkIn,
  stoppedWorkIn,
} from '../lib/conversation-waits'
import { providerLimitDisplay } from '../lib/provider-limit-status'
import type { ProviderBlockStore } from '../lib/provider-limit-facts'
import { railFacts, useWhoCalledWhom } from './useWhoCalledWhom'
import { workByConversation } from '../lib/working-together'
import type { AppInfo } from '@brobot2/shared'
import { whereItWorks } from '../lib/session-record'
import { agentName } from '../../../shared/runtime-ipc'
import { DEFAULT_PROFILE_ID } from '../../../shared/profile-name'
import type { SessionRecord } from '../lib/session-record'
import type { useClientApi } from '../client-provider/injection'

/** ⚑ **D-017b · one row of the one list** — the same markup and the same press, whatever it is doing. */
export interface RailRow extends PaletteOpenRow {
  readonly brobot: boolean
  readonly initialIdentity?: ConversationIdentity
  readonly activityAt?: number
  readonly worker?: ListedConversation['worker']
  readonly facets: AgentFacets
  readonly detail?: string
  readonly standing: Standing
  /** ⚑ Another window has it open — said on the row, because a message from here is refused. */
  readonly elsewhere: boolean
}

/** What the rail's list and rows read. */
export interface RailRowsProps {
  readonly open: readonly Readonly<SessionRecord>[]
  readonly providerBlocks?: ProviderBlockStore
  readonly onScreen: SessionRecord | null
  readonly agents: AgentIdentities | null
  readonly workspaceFolder: AppInfo['workspace'] | null
  readonly waiting: WhatEachConversationIsWaitingOn | null
}

/**
 * The rail's one list — the host's two reads folded with the conversations this window holds —
 * and the rows drawn from it (S06, moved out of `SideRail.vue` unchanged).
 */
export function useRailRows(
  props: RailRowsProps,
  client: ReturnType<typeof useClientApi>,
  railMinute: Readonly<Ref<number>>,
) {
  /* ---------------------------------------------------------------------------
     ⚑ D-017b · the ONE list — the host's two reads, folded by `conversation-list.ts`,
     with the conversations this window holds drawn from their own records beside it.
     --------------------------------------------------------------------------- */

  const lists = railFacts()
  onBeforeUnmount(() => lists.clear())

  const {
    hostResumable,
    hostUnresumable,
    coverageComplete,
    recent: initialRecent,
    looked,
    listError,
    said,
    providerBlocks,
    hearStates,
    refreshListed,
  } = useRecoveredConversationList(
    () => props.workspaceFolder?.path ?? null,
    () => client.sessions,
    () => props.providerBlocks,
  )

  const readList = computed(() =>
    conversationList({
      resumable: hostResumable.value,
      unresumable: hostUnresumable.value,
      identities: props.agents?.identities ?? null,
      providerSaid: providerBlocks.value.snapshot(),
    }),
  )
  const listed = computed(() =>
    withConversationStates(
      readList.value,
      new Map([...said.value].map(([conversation, heard]) => [conversation, heard.state])),
    ),
  )
  const cast = useWhoCalledWhom()
  // Index the forest once per reading, rather than walking it for every row on every render.
  const workByHolder = computed(() => workByConversation(cast.forest.value))
  watchEffect(() => {
    lists.update({ listedConversations: looked.value ? listed.value : null })
    if (!looked.value) {
      lists.update({ runningConversations: null })
      return
    }
    const live = new Map(
      [...hostResumable.value, ...hostUnresumable.value]
        .filter((row) => row.running !== 'not-running')
        .map((row) => [row.sessionId, row.provider]),
    )
    lists.update({
      runningConversations: listed.value.flatMap(({ sessionId, state }) => {
        const provider = live.get(sessionId)
        return provider === undefined ? [] : [{ sessionId, provider, state }]
      }),
    })
  })

  onMounted(refreshListed)

  function who(record: SessionRecord): string {
    const meta = record.meta
    if (!meta) return record.sessionId
    return identityName(meta)
  }

  function identityName(meta: { readonly profileId: string }): string {
    return agentName(meta.profileId, props.agents?.identities ?? null)
  }

  function placeOf(record: SessionRecord): string | null {
    return whereItWorks(record)
  }

  /** Local records supply live state. Other rows and activity order come from the host listing. */
  const rows = computed<RailRow[]>(() => {
    const byHost = new Map(listed.value.map((row) => [row.sessionId, row]))
    const shown = props.onScreen
    const drawn = new Map<string, { row: RailRow; at: number }>()
    // ⚑ **Fed here** — the fold is the present.
    for (const record of props.open) {
      const host = byHost.get(record.sessionId)
      const worker = host?.worker
      // 🔴 **636 · the sixth facet, and it is the one this record cannot hold** — see
      // {@link SideRail.waiting}. 🔴 **D-006 · and where the work it holds stands**, off the same
      // reading. ⚑ **D-017 · R19 — the wait carries who owes it the next move, as the host read it.**
      const facets = recordFacets(
        record,
        theWaitIn(props.waiting, record.sessionId),
        theWorkIn(props.waiting, record.sessionId),
        // ⚑ **F036 · who waits on its answer** — the host's own state of it, pushed to its listed row.
        whoItOwesIn(host?.state),
      )
      const currentState = stateForRecord(record, () =>
        stateHere(
          record,
          facets,
          whoseAnswerIn(props.waiting, record.sessionId),
          whoseWorkIn(props.waiting, record.sessionId),
          {},
          stoppedWorkIn(props.waiting, record.sessionId),
        ),
      )
      const limit = providerLimitDisplay(
        providerBlocks.value.get(record.sessionId) ?? record.meta,
        currentState,
        railMinute.value,
      )
      const standing = standingOf(facets)
      // An idle conversation holding a piece waiting on purpose says that wait, and its status line.
      const purpose = onPurposeSaid(standing === 'idle', host?.waitingOnPurpose)
      drawn.set(record.sessionId, {
        at: host?.updatedAt ?? Number.POSITIVE_INFINITY,
        row: {
          ...(worker ? { worker } : {}),
          sessionId: record.sessionId,
          brobot: host?.personStarted === true && railSectionOf(host.identity) === 'brobot',
          activityAt: host?.updatedAt,
          provider: record.meta?.provider ?? null,
          facets,
          standing,
          ...(limit ? { detail: limit.detail } : purpose ? { detail: purpose.detail } : {}),
          word: limit?.short ?? purpose?.word ?? standingWord(facets, currentState),
          label: workerLabel(who(record), worker, host?.named),
          // 🔴 **D-016 · commit 7 · R2 — the work that names it is the host's**, off the row already
          // looked up for its order: a record this window is fed holds no tree.
          named: host?.named ?? null,
          // ⛔ **449 · the second of the two facts a row needs**, and the palette takes it too.
          place: placeOf(record),
          // ⛔ **The one fact that tells two rows apart** (211 §3), read off the record.
          opening: record.opening,
          elsewhere: false,
        },
      })
    }
    // ⚑ **Every other one — the host's word**, the one on screen included when it is drawn from its
    // ledger.
    for (const host of listed.value) {
      if (drawn.has(host.sessionId)) continue
      const facets = facetsOfState(host.state)
      const limit = providerLimitDisplay(
        providerBlocks.value.get(host.sessionId),
        host.state,
        railMinute.value,
      )
      const shownHere = shown?.sessionId === host.sessionId ? shown : null
      const purpose = onPurposeSaid(host.state.is === 'idle', host.waitingOnPurpose)
      drawn.set(host.sessionId, {
        at: host.updatedAt,
        row: {
          ...(host.worker ? { worker: host.worker } : {}),
          sessionId: host.sessionId,
          brobot: host.personStarted === true && railSectionOf(host.identity) === 'brobot',
          activityAt: host.updatedAt,
          provider: host.provider,
          facets,
          standing: standingOf(facets),
          word: limit?.short ?? purpose?.word ?? agentStateWords(host.state),
          ...(limit ? { detail: limit.detail } : purpose ? { detail: purpose.detail } : {}),
          label: workerLabel(host.label, host.worker, host.named),
          named: host.named,
          place: host.place,
          opening: shownHere?.opening ?? null,
          elsewhere: host.inAnotherWindow,
        },
      })
    }
    for (const row of initialRecent.value) {
      if (drawn.has(row.sessionId)) continue
      drawn.set(row.sessionId, {
        at: row.updatedAt,
        row: {
          sessionId: row.sessionId,
          brobot:
            row.personStarted === true &&
            railSectionOf(row.profileId ?? DEFAULT_PROFILE_ID) === 'brobot',
          ...(row.identity === null ? {} : { initialIdentity: row.identity }),
          activityAt: row.updatedAt,
          provider: row.provider,
          facets: { doing: 'unknown' },
          standing: 'unknown',
          word: '',
          label: agentName(row.profileId, props.agents?.identities ?? null),
          named: null,
          place: basenameOf(row.cwd) || null,
          opening: null,
          elsewhere: row.running === 'in-a-window',
        },
      })
    }
    return [...drawn.values()].sort((one, other) => other.at - one.at).map(({ row }) => row)
  })

  /**
   * 🔴 **685 · the waits reading's unread rows, said once under the rows it qualifies** (`676`
   * F-R18a) — see {@link whatTheWaitsCouldNotRead}. ⚑ `props.open` is the population the rows
   * are drawn from, and each of them reads its wait from {@link SideRail.waiting}.
   */
  const waitsShort = computed(() =>
    whatTheWaitsCouldNotRead(
      props.waiting ?? null,
      props.open.map((record) => record.sessionId),
    ),
  )

  return {
    lists,
    hostResumable,
    coverageComplete,
    initialRecent,
    looked,
    listError,
    hearStates,
    refreshListed,
    listed,
    workByHolder,
    rows,
    waitsShort,
  }
}
