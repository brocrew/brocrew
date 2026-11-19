import { computed, onUnmounted, ref, watch, type Ref } from 'vue'
import { agentName, type AgentIdentity } from '../../../shared/runtime-ipc'
import type {
  ConversationSearchHit,
  GroupedWorkSearch,
  GroupedWorkSearchPreview,
  WorkSearchPage,
  WorkSearchQuery,
  WorkSearchResult,
} from '../../../shared/work-search'
import { appClosing } from '../lib/app-closing'
import { fullTime } from '../lib/clock'
import type { PaletteCommand, PaletteOpenRow } from '../lib/command-palette'
import { readableError } from '../lib/session-record'

interface PaletteSearchProps {
  conversations: readonly PaletteOpenRow[]
  searchCaller?: string | null
  profiles?: readonly AgentIdentity[]
  searchConversations?: (caller: string, query: WorkSearchQuery) => Promise<WorkSearchResult>
}

export type SearchRow = PaletteCommand & { readonly expandProfile?: string }

export interface SearchBand {
  group: PaletteCommand['group']
  rows: readonly SearchRow[]
  profileGroup?: { key: string; name: string; matched: number | null }
}

export function usePaletteSearch(
  props: PaletteSearchProps,
  query: Ref<string>,
  showing: Ref<boolean>,
) {
  const profile = ref('')
  const grouped = ref(false)
  const dates = ref({ from: '', to: '' })
  const invalidDates = computed(() => {
    const { from, to } = dates.value
    return from !== '' && to !== '' && from > to
  })
  const clearDates = () => {
    dates.value = { from: '', to: '' }
  }
  const searchAvailable = computed(() => !!props.searchCaller && !!props.searchConversations)
  const useReader = computed(
    () =>
      searchAvailable.value &&
      (query.value.trim() !== '' ||
        profile.value !== '' ||
        grouped.value ||
        dates.value.from !== '' ||
        dates.value.to !== ''),
  )
  const searchPage = ref<WorkSearchPage | null>(null)
  const searchHits = ref<readonly ConversationSearchHit[]>([])
  const searchGroups = ref<GroupedWorkSearch['groups']>([])
  const searchGaps = ref({ unread: 0, skipped: 0 })
  const searchBusy = ref(false)
  const searchFailed = ref<string | null>(null)
  let searchRequest = 0

  async function readConversations(more = false): Promise<void> {
    const caller = props.searchCaller
    const search = props.searchConversations
    const cursor = more ? searchPage.value?.next_cursor : null
    if (
      appClosing.value ||
      !caller ||
      !search ||
      invalidDates.value ||
      searchBusy.value ||
      (more && !cursor)
    )
      return
    const { from, to } = dates.value
    const reading = ++searchRequest
    searchBusy.value = true
    searchFailed.value = null
    try {
      const result = await search(caller, {
        words: query.value.trim(),
        ...(profile.value ? { profile: profile.value } : {}),
        ...(grouped.value ? { grouped: true } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(cursor ? { cursor } : {}),
        limit: 20,
        includeConversationMetadata: true,
      })
      if (reading !== searchRequest) return
      if (!result.ok) {
        searchFailed.value = 'Could not search conversations.'
        return
      }
      searchHits.value = [...searchHits.value, ...result.page.hits]
      if (result.page.grouped) {
        const groups = new Map(searchGroups.value.map((group) => [group.profile, group]))
        for (const group of result.page.grouped.groups) groups.set(group.profile, group)
        searchGroups.value = [...groups.values()]
      }
      searchPage.value = result.page
      searchGaps.value = {
        unread: searchGaps.value.unread + result.page.rows_unread,
        skipped: searchGaps.value.skipped + result.page.ledgers_skipped,
      }
    } catch (cause) {
      if (reading === searchRequest) searchFailed.value = readableError(cause)
    } finally {
      if (reading === searchRequest) searchBusy.value = false
    }
  }

  watch(
    [
      query,
      profile,
      grouped,
      () => dates.value.from,
      () => dates.value.to,
      showing,
      () => props.searchCaller,
      searchAvailable,
    ],
    (_selected, _old, cleanUp) => {
      searchRequest += 1
      searchHits.value = []
      searchGroups.value = []
      searchPage.value = null
      searchGaps.value = { unread: 0, skipped: 0 }
      searchBusy.value = false
      searchFailed.value = null
      if (!showing.value) {
        profile.value = ''
        grouped.value = false
        clearDates()
        return
      }
      if (invalidDates.value) {
        searchFailed.value = 'From must be on or before To.'
        return
      }
      if (!useReader.value) return
      const timer = window.setTimeout(() => void readConversations(), 180)
      cleanUp(() => window.clearTimeout(timer))
    },
  )
  onUnmounted(() => {
    searchRequest += 1
  })

  const loadedConversations = computed(
    () => new Map(props.conversations.map((row) => [row.sessionId, row])),
  )
  const profileName = (slug: string): string => agentName(slug, props.profiles ?? null)

  function readerCommand(hit: GroupedWorkSearchPreview, profileId: string | null): SearchRow {
    const row = loadedConversations.value.get(hit.conversation)
    return {
      id: `open-${hit.conversation}`,
      title: hit.title,
      recorded: hit.metadata,
      detail: [
        profileId ? profileName(profileId) : null,
        hit.metadata?.provider,
        row?.word,
        fullTime(hit.last_active_at),
        `Conversation ${hit.address}`,
        ...hit.matched_task_labels,
        hit.tasks_omitted
          ? `${hit.tasks_omitted} more matching ${hit.tasks_omitted === 1 ? 'task' : 'tasks'}`
          : null,
        row?.place,
        row?.opening,
      ]
        .filter(Boolean)
        .join(' · '),
      group: 'conversations',
      keywords: [],
      action: { kind: 'read-conversation', sessionId: hit.conversation },
    }
  }

  const readerBands = computed<readonly SearchBand[]>(() => {
    if (grouped.value) {
      const readers = searchGroups.value.map((group): SearchBand => {
        const key = `profile:${group.profile ?? ''}`
        const name = group.profile ? profileName(group.profile) : 'No profile'
        const rows = group.previews.map((hit) => readerCommand(hit, group.profile))
        const matched = searchPage.value?.grouped?.matched == null ? null : group.matched
        if (group.profile !== null && (matched === null || matched > rows.length)) {
          rows.push({
            id: `expand-${key}`,
            title: matched === null ? `Search ${name}` : `All ${matched} from ${name}`,
            detail: null,
            group: 'conversations',
            keywords: [],
            action: null,
            expandProfile: group.profile,
          })
        }
        return { group: 'conversations', rows, profileGroup: { key, name, matched } }
      })
      return readers
    }
    const rows = searchHits.value.map((hit) =>
      readerCommand(
        { ...hit, matched_task_labels: hit.matched_tasks.map((task) => task.label) },
        hit.profile,
      ),
    )
    return rows.length === 0 ? [] : [{ group: 'conversations', rows }]
  })

  const searchIncomplete = computed(
    () =>
      searchPage.value?.complete === false ||
      searchGaps.value.unread > 0 ||
      searchGaps.value.skipped > 0,
  )

  const searchNote = computed(() => {
    const page = searchPage.value
    if (!page) return searchFailed.value ? '' : 'Searching conversations…'
    const gaps = [
      searchGaps.value.unread
        ? `${searchGaps.value.unread} unread ${searchGaps.value.unread === 1 ? 'row' : 'rows'}`
        : null,
      searchGaps.value.skipped
        ? `${searchGaps.value.skipped} skipped ${searchGaps.value.skipped === 1 ? 'ledger' : 'ledgers'}`
        : null,
    ].filter(Boolean)
    const total = page.grouped?.matched
    const groupCount = searchGroups.value.length
    const count = page.grouped
      ? total == null
        ? `${groupCount} profile ${groupCount === 1 ? 'group' : 'groups'} shown.`
        : `${total} matching ${total === 1 ? 'conversation' : 'conversations'}.`
      : `${searchHits.value.length} shown.`
    return [
      count,
      ...(gaps.length ? [`${gaps.join(' · ')}.`] : []),
      ...(searchIncomplete.value ? ['Results may be incomplete.'] : []),
    ].join(' ')
  })

  return {
    profile,
    grouped,
    dates,
    invalidDates,
    clearDates,
    searchAvailable,
    useReader,
    searchPage,
    searchBusy,
    searchFailed,
    readConversations,
    readerBands,
    searchIncomplete,
    searchNote,
  }
}
