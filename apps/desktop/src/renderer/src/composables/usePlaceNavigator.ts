import { inject, provide, type ComputedRef, type InjectionKey } from 'vue'

/** What the window's Back and Forward buttons show and do. */
export interface PlaceNavigator {
  /** Where Back goes, or `null` when there is nowhere. */
  readonly backTo: ComputedRef<string | null>
  /** Where Forward goes, or `null` when there is nowhere. */
  readonly forwardTo: ComputedRef<string | null>
  back(): void
  forward(): void
}

const NAVIGATOR: InjectionKey<PlaceNavigator> = Symbol('place navigator')

export function providePlaceNavigator(navigator: PlaceNavigator): void {
  provide(NAVIGATOR, navigator)
}

/** The screen's navigator, or `null` where no screen provides one. */
export function usePlaceNavigator(): PlaceNavigator | null {
  return inject(NAVIGATOR, null)
}
