import { computed, type Ref } from 'vue'
import { currentUsageWarnings } from '../lib/current-usage-warnings'
import {
  limitsDisplayLabel,
  limitsDisplayWords,
  type LimitsDisplayState,
} from '../lib/limits-display'
import { fullTime } from '../lib/clock'
import {
  atItsLimitSays,
  readingSays,
  readingStatus,
  readingTitle,
  timeGone,
  usageSays,
  usageTitle,
} from '../lib/usage-limit'
import type { ProviderCondition } from '../../../shared/provider-limit'
import type { ProviderUsageReading } from '../../../shared/runtime-ipc'

interface UsageProps {
  limit: ProviderCondition | null
  limitsRead: boolean | null
  limitsDisplay?: LimitsDisplayState
  clock: number
  readings: readonly ProviderUsageReading[] | null
}

function warningHistoryLabel(display: LimitsDisplayState): string {
  return limitsDisplayLabel(display, (at) => `No limit warnings recorded as of ${fullTime(at)}`)
}

export function useProviderCardUsage(props: Readonly<UsageProps>, name: Readonly<Ref<string>>) {
  const usage = computed<{ text: string; title: string | null; tone: 'note' | 'warn' }>(() => {
    if (props.limitsDisplay !== undefined) {
      const display = props.limitsDisplay
      const reading = display.reading
      // A retained warning can outlive its usage reading or account. The card's current
      // readings supply near-limit figures; reported stops retain their separate evidence.
      if (props.limit?.standing === 'about-to-stop') {
        const near = currentUsageWarnings(props.readings ?? [], props.clock)
        return {
          text:
            near.length === 0
              ? warningHistoryLabel(display)
              : near.map((one) => usageSays(one, props.clock)).join(' '),
          title: near.length === 0 ? null : near.map(usageTitle).join('\n'),
          tone: near.length === 0 ? 'note' : 'warn',
        }
      }
      return {
        text:
          props.limit !== null && reading !== null
            ? limitsDisplayWords.condition(
                usageSays(props.limit, reading.evaluatedAt),
                reading.evaluatedAt,
              )
            : warningHistoryLabel(display),
        title: reading === null ? null : limitsDisplayWords.lastReading(reading.evaluatedAt),
        tone: props.limit === null ? 'note' : 'warn',
      }
    }
    if (props.limit !== null) {
      return {
        text: usageSays(props.limit, props.clock),
        title: usageTitle(props.limit),
        tone: 'warn',
      }
    }
    if (props.limitsRead === null) return { text: 'Not read yet.', title: null, tone: 'note' }
    if (props.limitsRead === false) {
      return {
        text: 'BroCrew couldn’t read usage warnings just now. It tries again when something changes.',
        title: null,
        tone: 'warn',
      }
    }
    return { text: `No usage warning from ${name.value}.`, title: null, tone: 'note' }
  })

  // A dated display keeps the condition's words at the time its evidence was evaluated.
  const atItsLimit = computed(() => {
    if (props.limit === null) return null
    const reading = props.limitsDisplay?.reading
    const words = atItsLimitSays(props.limit, reading?.evaluatedAt ?? props.clock)
    return words === null || reading === undefined || reading === null
      ? words
      : limitsDisplayWords.condition(words, reading.evaluatedAt)
  })

  /** ⚑ Each window's newest reading, in words — `null` before the read lands. */
  const readingLines = computed(() =>
    props.readings === null
      ? null
      : props.readings.map((reading) => {
          const time = timeGone(reading, props.clock)
          return {
            key: reading.window,
            text: readingSays(reading, props.clock),
            status: readingStatus(reading, props.clock),
            title: readingTitle(reading, props.clock),
            time,
            paceTitle:
              time === null || reading.usedPercent === null
                ? ''
                : `${String(Math.round(reading.usedPercent))}% used; ${String(Math.round(time.fraction * 100))}% of the window’s time gone.`,
          }
        }),
  )

  return { usage, atItsLimit, readingLines }
}
