import { computed, ref, useId, watch, type ComputedRef, type Ref } from 'vue'
import { railSectionHeading, RAIL_SECTION_REMEMBERED } from '../lib/rail-sections'
import { groupWorkers, workerName } from '../lib/conversation-list'
import { RECENT_CONVERSATION_PAGE_SIZE } from '../../../shared/listing-published'
import type { AgentIdentities } from '../../../shared/runtime-ipc'
import type { AppInfo } from '@brobot2/shared'
import { usePersistentToggle } from './usePersistentToggle'
import type { RailRow } from './useRailRows'

const sectionNames = {
  starred: 'Starred',
  brobot: 'BroBot',
  'needs-you': 'Needs you',
  recent: 'Recent',
} as const
export type RailSectionKey = keyof typeof sectionNames
export type RailSectionRow = Omit<RailRow, 'facets' | 'standing' | 'initialIdentity'> & {
  readonly facets: RailRow['facets'] | null
  readonly standing?: RailRow['standing']
  /** A provider-only row has no recorded identity to look up. */
  readonly initialIdentity?: RailRow['initialIdentity'] | null
}

/** What the rail's sections read. */
export interface RailSectionsProps {
  readonly agents: AgentIdentities | null
  readonly workspaceFolder: AppInfo['workspace'] | null
}

/**
 * Which rows each rail section holds, whether it is open, its count and how much of Recent is shown.
 */
export function useRailSections(
  props: RailSectionsProps,
  rows: ComputedRef<RailRow[]>,
  onScreenId: ComputedRef<string | null>,
  coverageComplete: Readonly<Ref<boolean>>,
  initialRecent: Readonly<Ref<readonly unknown[]>>,
  starredRows: Readonly<Ref<readonly RailSectionRow[]>>,
) {
  const sectionOpen = {
    starred: ref(true),
    brobot: usePersistentToggle(RAIL_SECTION_REMEMBERED.brobot, true),
    'needs-you': usePersistentToggle('brobot2.railNeedsYouOpen', true),
    recent: usePersistentToggle('brobot2.railRecentOpen', true),
  }
  const recentLimit = ref(RECENT_CONVERSATION_PAGE_SIZE)
  watch(
    () => props.workspaceFolder?.path,
    () => (recentLimit.value = RECENT_CONVERSATION_PAGE_SIZE),
  )
  const sectionIdBase = useId()
  const rowsIdOf = (key: RailSectionKey): string => `${sectionIdBase}-rows-${key}`

  const brobotRows = computed(() => rows.value.filter((row) => row.brobot))
  const otherRows = computed(() => rows.value.filter((row) => !row.brobot))
  const waitingRows = computed(() => otherRows.value.filter((row) => row.standing === 'waiting'))
  const recentRows = computed(() => otherRows.value.filter((row) => row.standing !== 'waiting'))

  function railSection(
    key: RailSectionKey,
    eligible: readonly RailSectionRow[],
    shown: readonly RailSectionRow[],
  ) {
    const groups = groupWorkers(shown, (row) => row.sessionId)
    const workerHeads = new Map(
      groups.flatMap(({ worker, rows }) =>
        worker
          ? [
              [
                rows[0]!.sessionId,
                {
                  identity: worker.identity,
                  giver: worker.giver,
                  label: workerName(worker, props.agents?.identities ?? null),
                },
              ] as const,
            ]
          : [],
      ),
    )
    const open = sectionOpen[key].value
    const selected = eligible.some((row) => row.sessionId === onScreenId.value)
    const recentTotal = key === 'recent' && coverageComplete.value ? eligible.length : null
    return {
      key,
      rowIdPrefix: key === 'starred' ? 'rail-starred' : 'rail',
      heading:
        key === 'brobot'
          ? railSectionHeading('brobot', props.agents?.identities ?? null)
          : sectionNames[key],
      rows: groups.flatMap((group) => group.rows),
      workerHeads,
      open,
      holdsTheOneOnScreen:
        selected && (!open || !shown.some((row) => row.sessionId === onScreenId.value)),
      count:
        key !== 'recent'
          ? key === 'brobot' && initialRecent.value.length > 0
            ? null
            : String(eligible.length)
          : recentTotal === null
            ? open
              ? `${shown.length} shown`
              : null
            : open
              ? `${shown.length} of ${recentTotal}`
              : String(recentTotal),
    }
  }

  const sections = computed(() => {
    const waiting = waitingRows.value
    const recent = recentRows.value
    const starred = starredRows.value
    return [
      ...(starred.length ? [railSection('starred', starred, starred)] : []),
      ...(brobotRows.value.length || starred.length
        ? [railSection('brobot', brobotRows.value, brobotRows.value)]
        : []),
      ...(waiting.length ? [railSection('needs-you', waiting, waiting)] : []),
      ...(recent.length ? [railSection('recent', recent, recent.slice(0, recentLimit.value))] : []),
    ]
  })

  const moreRecent = computed(() =>
    Math.min(RECENT_CONVERSATION_PAGE_SIZE, recentRows.value.length - recentLimit.value),
  )

  return {
    sectionOpen,
    recentLimit,
    rowsIdOf,
    waitingRows,
    sections,
    moreRecent,
  }
}
