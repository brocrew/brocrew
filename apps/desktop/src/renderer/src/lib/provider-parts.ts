/**
 * The parts of a provider's card on the Providers screen, in the order they are drawn. Each is one
 * row of the screen's grid, shared by every provider's card, and each folds: one press folds that
 * part in every card, so the cards stay level. A new part is one name here, its first-time state
 * below, and its section in `ProviderCard.vue`; the card's row count follows this list.
 */
export const PROVIDER_PARTS = ['login', 'key', 'version', 'usage', 'resources', 'models'] as const

export type ProviderPart = (typeof PROVIDER_PARTS)[number]

/** Usage and running work open at first. Setup is the entry to login and API keys. */
export const OPEN_AT_FIRST: Readonly<Record<ProviderPart, boolean>> = {
  login: false,
  key: false,
  version: false,
  usage: true,
  resources: true,
  models: false,
}

/** Where a part's open or folded state is remembered on this computer. */
export function partKey(part: ProviderPart): string {
  return `brobot2.providers.open.${part}`
}
