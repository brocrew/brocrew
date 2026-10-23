import type { Provider } from '@brobot2/shared'
import { providerDefinitions } from '../providers/definitions'
import type { TurnAsked, TurnReadingOptions, TurnReading } from './turn-reading'
export type { TurnAsked, TurnReadingOptions, TurnReading } from './turn-reading'
export { claudePartsAsTheModelGotThem } from '../providers/definitions'
export function readingATurn(
  provider: Provider,
  asked: TurnAsked,
  options: TurnReadingOptions = {},
): TurnReading {
  return providerDefinitions[provider].transcripts.readTurn(asked, options)
}
