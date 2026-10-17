import { inject, provide, ref, type InjectionKey, type Ref } from 'vue'

/** The tabs a conversation's main area shows. */
export type MainTab = 'conversation' | 'graph' | 'files'

const MAIN_TAB: InjectionKey<Ref<MainTab>> = Symbol('main tab')

/**
 * The tab a conversation shows, held by the screen so Back and Forward can keep it with the place.
 * A surface that provides none (a test mounting one pane) gets a tab of its own.
 */
export function provideMainTab(tab: Ref<MainTab>): void {
  provide(MAIN_TAB, tab)
}

export function useMainTab(): Ref<MainTab> {
  return inject(MAIN_TAB, () => ref<MainTab>('conversation'), true)
}
