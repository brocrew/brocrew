import { computed, ref, watch, type Ref } from 'vue'
import type { AppInfo, Provider } from '@brobot2/shared'
import {
  CONVERSATION_IDENTITY_BATCH_SIZE,
  type ConversationIdentity,
  type ConversationIdentityBatchInput,
} from '../../../shared/conversation-title'
import type { AgentIdentities } from '../../../shared/runtime-ipc'
import { agoWords } from '../lib/clock'
import {
  conversationTitle,
  workerName,
  workerState,
  workerSubtitles,
} from '../lib/conversation-list'
import type { ConversationRowCy, ConversationRowView } from '../lib/conversation-row'
import { OPEN_IN_ANOTHER_WINDOW } from '../lib/taking-over'
import type { workByConversation } from '../lib/working-together'
import type { RailSectionRow } from './useRailSections'

interface RailRowViewProps {
  agents?: AgentIdentities | null
  workspaceFolder?: AppInfo['workspace'] | null
  readIdentities?: (
    input: ConversationIdentityBatchInput,
  ) => Promise<readonly ConversationIdentity[]>
  identityRevision?: number
}

/** How each rail row is drawn: its canonical identity, title, status line and the shared row's view. */
export function useRailRowViews(
  props: RailRowViewProps,
  sections: Readonly<Ref<readonly { open: boolean; rows: readonly RailSectionRow[] }[]>>,
  railMinute: Readonly<Ref<number>>,
  workByHolder: Readonly<Ref<ReturnType<typeof workByConversation>>>,
  providerLabel: (provider: Provider) => string,
) {
  const identityIds = computed((previous?: string[]) => {
    const visibleIds = sections.value
      .filter((section) => section.open)
      .flatMap((section) =>
        section.rows.filter((row) => row.initialIdentity === undefined).map((row) => row.sessionId),
      )
    const ids = [...new Set(visibleIds)].sort()
    return previous?.length === ids.length && previous.every((id, i) => id === ids[i])
      ? previous
      : ids
  })
  const identities = ref(new Map<string, ConversationIdentity | null>())
  let acceptedIdentityRevision: number | undefined
  watch(
    [identityIds, () => props.workspaceFolder?.path, () => props.identityRevision],
    async ([ids, workspace, revision], [, previousWorkspace], invalidate) => {
      if (workspace !== previousWorkspace) identities.value = new Map()
      const read = props.readIdentities
      if (!read) return
      let current = true
      invalidate(() => (current = false))
      const before = identities.value
      const unread =
        revision !== acceptedIdentityRevision ? ids : ids.filter((id) => !before.has(id))
      const batches: ConversationIdentityBatchInput[] = []
      for (let i = 0; i < unread.length; i += CONVERSATION_IDENTITY_BATCH_SIZE) {
        const sessionIds = unread.slice(i, i + CONVERSATION_IDENTITY_BATCH_SIZE)
        batches.push({ sessionIds })
      }
      try {
        const answers = await Promise.all(batches.map((batch) => read(batch)))
        if (current) {
          const merged = new Map(ids.map((id) => [id, before.get(id) ?? null]))
          for (const id of unread) merged.set(id, null)
          for (const [i, batch] of answers.entries()) {
            for (const item of batch) {
              if (batches[i]?.sessionIds.includes(item.conversation)) {
                merged.set(item.conversation, item)
              }
            }
          }
          acceptedIdentityRevision = revision
          identities.value = merged
        }
      } catch {
        // Keep the last identities for this workspace when a read fails.
      }
    },
    { immediate: true },
  )

  function identityOf(row: RailSectionRow): ConversationIdentity | null | undefined {
    return identities.value.get(row.sessionId) ?? row.initialIdentity
  }

  function rowTitle(row: RailSectionRow): string {
    const identity = identityOf(row)
    if (row.brobot) {
      const title = identity?.profileFallback ? null : (identity?.title ?? row.named?.title)
      return [identity?.address ?? row.sessionId, title?.trim()].filter(Boolean).join(' · ')
    }
    return identity?.title ?? conversationTitle(row.label, row.named)
  }

  function profileName(row: RailSectionRow): string {
    return row.worker && props.agents?.identities.some((one) => one.id === row.worker?.identity)
      ? workerName(row.worker, props.agents.identities)
      : row.label
  }

  function statusLine(row: RailSectionRow, detailed = false): string {
    return [
      !row.brobot && row.named ? row.label : null,
      row.provider ? providerLabel(row.provider as Provider) : null,
      detailed ? (row.detail ?? row.word) : row.word,
      !row.brobot && row.activityAt !== undefined
        ? agoWords(row.activityAt, railMinute.value)
        : null,
      row.elsewhere ? OPEN_IN_ANOTHER_WINDOW : null,
      row.place,
    ]
      .filter(Boolean)
      .join(' · ')
  }

  /** What one rail row draws, in the shared row's terms. */
  function railView(row: RailSectionRow): ConversationRowView {
    const identity = identityOf(row)
    const worker = !!row.worker
    const workerTop = worker && !identity
    return {
      id: row.sessionId,
      facets: row.facets,
      plateLabel: row.label,
      head: row.brobot ? 'brobot' : workerTop ? 'worker' : 'plain',
      canonical: !!identity,
      title: workerTop ? row.label : rowTitle(row),
      titleHint: workerTop
        ? [row.label, row.named?.title].filter(Boolean).join(' · ')
        : rowTitle(row),
      topWord: workerTop ? workerState(row.word, row.named) : undefined,
      topWordHint: workerTop ? (row.detail ?? workerState(row.word, row.named)) : undefined,
      status: {
        profile: !row.brobot && (identity || (row.named && !worker)) ? profileName(row) : null,
        provider: row.brobot || !identity ? (row.provider as Provider | null) : null,
        word:
          row.word && (row.brobot || !worker || identity)
            ? worker && !row.brobot
              ? workerState(row.word, row.named)
              : row.word
            : null,
        detail: row.detail,
        standing: row.standing,
        needing: row.facets?.needing,
        activityAt: row.brobot ? undefined : row.activityAt,
        elsewhere: row.elsewhere ? OPEN_IN_ANOTHER_WINDOW : null,
        place: row.place,
        hint: statusLine(row, true),
      },
      address: !row.brobot && identity ? identity.address : null,
      addressProvider: !row.brobot && identity ? (row.provider as Provider | null) : null,
      namedByYou: !row.brobot && identity?.author?.kind === 'person',
      pieces:
        worker && !row.brobot
          ? workerSubtitles(row.sessionId, row.named, workByHolder.value.get(row.sessionId) ?? [])
          : [],
      opening: !row.brobot && !identity ? row.opening : null,
    }
  }

  function railCy(row: RailSectionRow): ConversationRowCy {
    return {
      title: row.brobot
        ? `rail-brobot-title-${row.sessionId}`
        : row.worker
          ? `rail-worker-name-${row.sessionId}`
          : undefined,
      topWord: `rail-state-word-${row.sessionId}`,
      word: `rail-state-word-${row.sessionId}`,
      profile: `rail-profile-${row.sessionId}`,
      place: `rail-place-${row.sessionId}`,
      address: `rail-address-${row.sessionId}`,
      opening: `session-opening-${row.sessionId}`,
    }
  }

  return { identityOf, rowTitle, railView, railCy }
}
