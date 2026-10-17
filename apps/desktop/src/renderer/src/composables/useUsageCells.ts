import { computed, type ComputedRef } from 'vue'
import {
  PROVIDER_NAME,
  type Provider,
  type ProviderUsageReading,
} from '../../../shared/runtime-ipc'
import { usageWindowWord } from '../../../shared/usage-window'
import type { ForestConversation } from '../../../shared/the-whole-forest'
import { agoWords, fullTime } from '../lib/clock'
import { NOT_MEASURED } from '../lib/agent-panel'
import { processMemoryWords } from '../lib/process-memory'
import { resetWords, UNCONFIRMED_USAGE } from '../lib/usage-limit'
import { useMinuteClock } from './useMinuteClock'
import { useProviderUsage } from './useProviderUsage'
import { useWhoCalledWhom, type RunningConversation } from './useWhoCalledWhom'

/**
 * Each provider's usage, window by window, and the agents running now with their memory: the cells
 * the usage cards draw and the words the title bar's line is made of. Providers are iterated and
 * never named (`provider-neutrality.test.ts`).
 *
 * The readings are the window's own (`useProviderUsage`), read on a notice and never polled; the
 * minute clock moves the ages and resets. Running agents use the rail's all-page state reading;
 * process memory keeps the conversation page's existing reading.
 */

/** The two windows the cells show, by `usageWindowWord`'s word, with the short name a cell uses. */
const WINDOWS = [
  { word: '5-hour', short: '5h' },
  { word: 'weekly', short: 'week' },
] as const

const PROVIDERS = Object.keys(PROVIDER_NAME) as Provider[]

/**
 * The windows each provider's cells wait for before any reading has arrived. A window left out is
 * one that provider no longer reports: it gets no "Not read yet" cell, and is drawn only if a
 * reading for it does arrive.
 */
const AWAITED: Readonly<Record<Provider, readonly string[]>> = {
  claude: ['5-hour', 'weekly'],
  codex: ['weekly'],
}

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
export const NOT_READ_MARK = '—'

/** The provider's reading for a window; one the provider named a bucket for is not the window. */
function readingIn(
  readings: readonly ProviderUsageReading[],
  word: string,
): ProviderUsageReading | null {
  return (
    readings.find((one) => usageWindowWord(one.window) === word && !one.window.includes('(')) ??
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
  /** One cell per provider window, then the agents and their memory. */
  readonly cells: ComputedRef<readonly UsageCell[]>
  /** Provider usage, running and working totals, then process memory. */
  readonly line: ComputedRef<string>
}

export function useUsageCells(): UsageCells {
  const usage = useProviderUsage()
  const cast = useWhoCalledWhom()
  const minute = useMinuteClock()

  /** Each provider's windows, as `[short, reading or null]`, in the order the cells draw them. */
  const windows = computed(() =>
    PROVIDERS.map((provider) => ({
      provider,
      windows: WINDOWS.flatMap(({ word, short }) => {
        const reading = readingIn(usage.value?.[provider] ?? [], word)
        if (reading === null && !AWAITED[provider].includes(word)) return []
        return [{ word, short, reading }]
      }),
    })),
  )

  const usageCells = computed<UsageCell[]>(() => {
    // The minute clock is what moves the words; a reading newer than its last tick reads from now.
    const now = Math.max(minute.value, Date.now())
    return windows.value.flatMap(({ provider, windows: theirs }) =>
      theirs.map(({ word, short, reading }): UsageCell => {
        const label = `${PROVIDER_NAME[provider]} · ${short}`
        if (reading === null) {
          return {
            key: `${provider}-${short}`,
            label,
            age: null,
            value: null,
            title: null,
            name: `${PROVIDER_NAME[provider]} ${word} limit: not read yet`,
          }
        }
        const value = valueWords(reading, now)
        const title = titleWords(reading, now)
        return {
          key: `${provider}-${short}`,
          label,
          age: `read ${agoWords(reading.at, now)}`,
          value,
          title,
          name: `${PROVIDER_NAME[provider]} ${word} limit: ${value}. ${title.replace(`\n${UNCONFIRMED_USAGE}`, '').replace('\n', '. ')}.`,
        }
      }),
    )
  })

  /** The agents running now and the memory their processes hold, or `null` before the forest. */
  const running = computed(() => {
    const forest = cast.forest.value
    if (forest === null) return null
    const rows = forest.nodes.rows.filter(
      (node): node is ForestConversation =>
        node.node === 'a-conversation' && node.running !== 'not-running',
    )
    // Where main could measure no process, the memory says so as the agent cards do.
    const unmeasured = cast.memoryUnmeasured.value
    const bytes = rows.reduce(
      (sum, node) => sum + (cast.processMemory.value.get(node.conversation) ?? 0),
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
                  : [`${PROVIDER_NAME[provider]} ${count} (${workingWords(working)})`]
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

  const line = computed(() => {
    const population = agentsNow.value
    const agents =
      population === null
        ? `${NOT_READ_MARK} agents`
        : `${population.count} agents${population.count === 0 ? '' : ` · ${population.working} working`}`
    const providers = windows.value.flatMap(({ provider, windows: theirs }) =>
      theirs.map(({ short, reading }, index) => {
        const used =
          reading?.usedPercent == null
            ? NOT_READ_MARK
            : `${String(Math.round(reading.usedPercent))}%`
        return `${index === 0 ? `${PROVIDER_NAME[provider]} ` : ''}${short} ${used}`
      }),
    )
    const now = running.value
    return [...providers, agents, now === null ? NOT_READ_MARK : now.memory].join(' · ')
  })

  return { cells: computed(() => [...usageCells.value, ...totals.value]), line }
}
