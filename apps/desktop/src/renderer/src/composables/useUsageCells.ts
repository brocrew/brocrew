import { computed, type ComputedRef } from 'vue'
import { providerDescriptor, providerRecord, SUPPORTED_PROVIDERS } from '@brobot2/shared/providers'
import { compatibilityConnectionId, type ProviderConnection } from '@brobot2/shared'
import type { Provider, ProviderUsageReading } from '../../../shared/runtime-ipc'
import { agoWords, fullTime } from '../lib/clock'
import { NOT_MEASURED } from '../lib/agent-panel'
import { processMemoryWords } from '../lib/process-memory'
import {
  resetWords,
  UNCONFIRMED_USAGE,
  usageProviderName,
  type UsageProviderNames,
} from '../lib/usage-limit'
import { useMinuteClock } from './useMinuteClock'
import { useProviderUsage } from './useProviderUsage'
import { useWhoCalledWhom, type RunningConversation } from './useWhoCalledWhom'

/**
 * Each running connection's attributed windows and the agents running now with their memory: the cells
 * the usage cards draw and the words the title bar's line is made of. Providers are iterated and
 * never named (`provider-neutrality.test.ts`).
 *
 * The readings are the window's own (`useProviderUsage`), read on a notice and never polled; the
 * minute clock moves the ages and resets. Running agents use the rail's all-page state reading;
 * process memory keeps the conversation page's existing reading.
 */

/** The two windows the cells show, by their core-supplied period word, with the short name a cell uses. */
const WINDOWS = [
  { word: '5-hour', short: '5h' },
  { word: 'weekly', short: 'week' },
] as const

const PROVIDERS = SUPPORTED_PROVIDERS

/**
 * The windows each connection waits for before the first usage answer. After an answer,
 * only its returned periods are shown, including periods whose amount has not been said.
 */
const AWAITED = providerRecord<readonly string[]>(
  (provider) => providerDescriptor(provider).usageWindows,
)

export interface UsageCell {
  readonly key: string
  readonly label: string
  /** `null` while there is no reading. */
  readonly age: string | null
  /** `null` while there is no reading. */
  readonly value: string | null
  /** The exact reset and when the reading arrived, or `null` while there is none. */
  readonly title: string | null
  /** Everything the cell says, for its accessible name. */
  readonly name: string
}

/** The two totals' cells, told apart from the usage cells. */
export const TOTALS: ReadonlySet<string> = new Set(['agents', 'memory'])

/** What not read yet is, in the title bar's line. */
const NOT_READ_MARK = '?'

/** The provider's reading for a window; one the provider named a bucket for is not the window. */
function readingIn(
  readings: readonly {
    readonly reading: ProviderUsageReading
    readonly window: ProviderUsageReading['period']
  }[],
  word: string,
): ProviderUsageReading | null {
  return (
    readings.find((one) => one.window?.word === word && one.window?.bucket === false)?.reading ??
    null
  )
}

/** "28% · resets in 3 h 12 min"; "was 95% · reset 2 days ago" once the window has reset. */
function valueWords(reading: ProviderUsageReading, now: number): string {
  const past = reading.resetsAt !== null && reading.resetsAt <= now
  const used =
    reading.usedPercent === null
      ? 'Amount not said'
      : `${past ? 'was ' : ''}${String(Math.round(reading.usedPercent))}%`
  return `${used} · ${resetWords(reading.resetsAt, now) ?? 'reset time not said'}${reading.unconfirmed === true ? ` · ${UNCONFIRMED_USAGE}` : ''}`
}

function titleWords(reading: ProviderUsageReading, now: number): string {
  const reset =
    reading.resetsAt === null
      ? 'Reset time not said'
      : `${reading.resetsAt > now ? 'Resets' : 'Reset'} ${fullTime(reading.resetsAt)}`
  return `${reset}\nRead ${fullTime(reading.at)}${reading.unconfirmed === true ? `\n${UNCONFIRMED_USAGE}` : ''}`
}

export interface UsageCells {
  /** Running connection windows only, then the agents and their memory. */
  readonly cells: ComputedRef<readonly UsageCell[]>
  /** Provider usage, running and working totals, then process memory. */
  readonly line: ComputedRef<string>
  readonly description: ComputedRef<string>
  readonly variants: ComputedRef<readonly string[]>
}

export function useUsageCells(
  names?: () => UsageProviderNames,
  connections: () => readonly ProviderConnection[] = () => [],
): UsageCells {
  const nameOf = (provider: Provider): string => usageProviderName(provider, names?.(), 'Provider')
  const usage = useProviderUsage()
  const cast = useWhoCalledWhom()
  const minute = useMinuteClock()

  const windows = computed(() => {
    const running = cast.runningConversations.value ?? []
    const identities = PROVIDERS.flatMap((provider) =>
      [
        ...new Set(
          running.filter((row) => row.provider === provider).map((row) => row.connectionId ?? null),
        ),
      ]
        .sort((a, b) => (a ?? '').localeCompare(b ?? ''))
        .map((connectionId) => ({ provider, connectionId })),
    ).sort(
      (a, b) =>
        a.provider.localeCompare(b.provider) ||
        (a.connectionId ?? '').localeCompare(b.connectionId ?? ''),
    )
    return identities.map(({ provider, connectionId }) => {
      const metadata = connections().find(
        (row) => row.provider === provider && row.id === connectionId,
      )
      const several = identities.filter((row) => row.provider === provider).length > 1
      const label =
        connectionId === null
          ? `${nameOf(provider)} · unknown connection`
          : several
            ? `${nameOf(provider)} · ${metadata?.name ?? connectionId}`
            : nameOf(provider)
      const readings =
        connectionId === null
          ? []
          : (usage.value?.[provider] ?? [])
              .filter((reading) => reading.connectionId === connectionId)
              .map((reading) => ({ reading, window: reading.period }))
      const key =
        connectionId === compatibilityConnectionId(provider, 'sign-in')
          ? provider
          : JSON.stringify([provider, connectionId])
      return {
        provider,
        connectionId,
        key,
        label,
        windows: WINDOWS.flatMap(({ word, short }) => {
          const reading = readingIn(readings, word)
          if (
            reading === null &&
            (usage.value !== null ||
              !(metadata?.authMethod === 'sign-in' && AWAITED[provider].includes(word)))
          )
            return []
          return [{ word, short, reading }]
        }),
      }
    })
  })

  const usageCells = computed<UsageCell[]>(() => {
    const now = Math.max(minute.value, Date.now())
    return windows.value.flatMap(({ key, label: groupLabel, windows: theirs }) => {
      if (theirs.length === 0)
        return [
          {
            key: `${key}-unknown`,
            label: groupLabel,
            age: null,
            value: null,
            title: null,
            name: `${groupLabel} usage: unknown`,
          },
        ]
      return theirs.map(({ word, short, reading }): UsageCell => {
        const label = `${groupLabel} · ${short}`
        if (reading === null)
          return {
            key: `${key}-${short}`,
            label,
            age: null,
            value: null,
            title: null,
            name: `${groupLabel} ${word} limit: not read yet`,
          }
        const value = valueWords(reading, now)
        const title = titleWords(reading, now)
        return {
          key: `${key}-${short}`,
          label,
          age: `read ${agoWords(reading.at, now)}`,
          value,
          title,
          name: `${groupLabel} ${word} limit: ${value}. ${title.replace(`\n${UNCONFIRMED_USAGE}`, '').replace('\n', '. ')}.`,
        }
      })
    })
  })

  /** The rail supplies running membership on every page, independently of graph reads. */
  const running = computed(() => {
    const rows = cast.runningConversations.value
    if (rows === null) return null
    // Where main could measure no process, the memory says so as the agent cards do.
    const unmeasured = cast.memoryUnmeasured.value
    if (unmeasured === null && rows.some((row) => !cast.processMemory.value.has(row.sessionId)))
      return null
    const bytes = rows.reduce(
      (sum, node) => sum + (cast.processMemory.value.get(node.sessionId) ?? 0),
      0,
    )
    return {
      rows,
      unmeasured,
      memory: unmeasured === null ? processMemoryWords(bytes) : NOT_MEASURED,
    }
  })

  const agentsNow = computed(() => {
    const rows = cast.runningConversations.value
    if (rows === null) return null
    const working = (row: RunningConversation): boolean =>
      row.state.is === 'active' || row.state.is === 'in-the-background'
    return {
      count: rows.length,
      working: rows.filter(working).length,
      providers: PROVIDERS.map((provider) => {
        const theirs = rows.filter((row) => row.provider === provider)
        return { provider, count: theirs.length, working: theirs.filter(working).length }
      }),
    }
  })
  const workingWords = (count: number): string =>
    count === 0 ? 'none working' : `${count} working`

  const totals = computed<UsageCell[]>(() => {
    const cell = (
      key: string,
      label: string,
      value: string | null,
      title: string | null,
      name: string,
    ): UsageCell => ({ key, label, age: null, value, title, name })
    const now = running.value
    const population = agentsNow.value
    const agents =
      population === null
        ? null
        : population.count === 0
          ? '0'
          : [
              ...population.providers.flatMap(({ provider, count, working }) => {
                return count === 0
                  ? []
                  : [`${nameOf(provider)} ${count} (${workingWords(working)})`]
              }),
            ].join('\n')
    return [
      cell(
        'agents',
        'Agents',
        agents,
        null,
        agents === null ? 'Agents running: not read yet' : `Agents running: ${agents}`,
      ),
      cell(
        'memory',
        'Memory',
        now?.memory ?? null,
        now?.unmeasured ?? null,
        now === null
          ? 'Their memory: not read yet'
          : `Their memory: ${now.unmeasured ?? now.memory}`,
      ),
    ]
  })

  const score = (reading: ProviderUsageReading | null): number =>
    reading?.usedPercent != null &&
    reading.unconfirmed !== true &&
    (reading.resetsAt === null || reading.resetsAt > Math.max(minute.value, Date.now()))
      ? reading.usedPercent
      : -1
  type Group = (typeof windows.value)[number]
  function groupWords(group: Group, tightestOnly = false): string {
    const theirs = tightestOnly
      ? [...group.windows].sort((a, b) => score(b.reading) - score(a.reading)).slice(0, 1)
      : group.windows
    if (theirs.length === 0) return `${group.label} · usage ${NOT_READ_MARK}`
    return `${group.label} ${theirs
      .map(({ short, reading }) => {
        const used =
          reading?.usedPercent == null
            ? NOT_READ_MARK
            : `${reading.resetsAt !== null && reading.resetsAt <= Math.max(minute.value, Date.now()) ? 'was ' : ''}${Math.round(reading.usedPercent)}%`
        return `${short} ${used}`
      })
      .join(' · ')}`
  }
  const line = computed(() => {
    const population = agentsNow.value
    const agents =
      population === null
        ? `${NOT_READ_MARK} agents`
        : `${population.count} agents${population.count === 0 ? '' : ` · ${population.working} working`}`
    const now = running.value
    return [
      ...windows.value.map((group) => groupWords(group)),
      agents,
      now === null ? NOT_READ_MARK : now.memory,
    ].join(' · ')
  })
  const variants = computed(() => {
    const ranked = [...windows.value].sort(
      (a, b) =>
        Math.max(-1, ...b.windows.map(({ reading }) => score(reading))) -
          Math.max(-1, ...a.windows.map(({ reading }) => score(reading))) ||
        a.provider.localeCompare(b.provider) ||
        (a.connectionId ?? '').localeCompare(b.connectionId ?? ''),
    )
    const first = ranked[0]
    if (!first) return [line.value]
    const more = ranked.length > 1 ? ` · +${ranked.length - 1}` : ''
    return [...new Set([line.value, groupWords(first) + more, groupWords(first, true) + more])]
  })
  const description = computed(() =>
    [
      line.value,
      ...windows.value.flatMap(({ label, windows: theirs }) =>
        theirs.length === 0
          ? [`${label} usage: unknown`]
          : theirs.map(
              ({ word, reading }) =>
                `${label} ${word} usage: ${reading?.usedPercent == null ? 'unknown' : `${Math.round(reading.usedPercent)}% used`}${reading?.unconfirmed === true ? ` (${UNCONFIRMED_USAGE})` : ''}${reading ? `; ${resetWords(reading.resetsAt, Math.max(minute.value, Date.now())) ?? 'reset time not said'}` : ''}`,
            ),
      ),
      ...totals.value.map((cell) => cell.name),
    ].join('. '),
  )

  return {
    cells: computed(() => [...usageCells.value, ...totals.value]),
    line,
    variants,
    description,
  }
}
