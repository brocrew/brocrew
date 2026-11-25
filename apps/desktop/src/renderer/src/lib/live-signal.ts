import type { Provider } from '@brobot2/shared'
import type { LimitStanding } from '../../../shared/provider-limit'
import { limitsDisplayLabel, limitsDisplayWords } from './limits-display'
import type { ProviderLimitsView } from './persons-queue'
import { usageProviderName, type UsageProviderNames } from './usage-limit'

export const PARTIAL_WAITING_COUNT =
  'Some rows could not be read. The count may be incomplete or out of date.'

const PARTIAL_PROVIDER_NOTICE =
  'a clause marked * is not an all-clear — the read that finds a walled provider did not answer'

const STOPS_WORK: Readonly<Record<LimitStanding, boolean>> = {
  'about-to-stop': false,
  stopped: true,
}

function providersSaid(providers: readonly Provider[], supplied?: UsageProviderNames): string {
  const names = providers.map((provider) => usageProviderName(provider, supplied, 'the provider'))
  const last = names[names.length - 1] ?? ''
  return names.length <= 1 ? last : `${names.slice(0, -1).join(', ')} and ${last}`
}

/** The rail notice and hover use the same provider limits as the Waiting on you page. */
export function providerStopNotice(
  limits: ProviderLimitsView | null,
  names?: UsageProviderNames,
): { text: string; title: string } | null {
  const walls = (limits?.walls ?? []).filter((wall) => STOPS_WORK[wall.standing])
  const short = limits === null || limits.unread
  if (walls.length === 0 && !short) return null

  const providers = walls.map((wall) => wall.provider)
  const display = limits?.display
  const label = display === undefined ? null : limitsDisplayLabel(display)
  const at = display?.reading?.evaluatedAt
  let text: string
  if (display !== undefined && label !== null) {
    if (at !== undefined && providers.length > 0) {
      const reported = `${limitsDisplayWords.rail(providers, names)} · ${limitsDisplayWords.reported(at)}`
      text = display.status === 'ready' ? reported : `${reported} · ${label}`
    } else {
      text = label
    }
  } else {
    const notice =
      providers.length === 0 ? 'nothing stopped' : `${providersSaid(providers, names)} stopped`
    text = short ? `${notice}*` : notice
  }

  const title = [
    text,
    ...(short ? [PARTIAL_PROVIDER_NOTICE] : []),
    ...(label === null || label === text ? [] : [label]),
    ...walls.map((wall) => wall.says),
  ].join(' · ')
  return { text, title }
}
