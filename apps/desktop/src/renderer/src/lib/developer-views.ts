import { DEFAULT_TAB, type DrawerTab } from './drawer'

/**
 * # W4.13 · Debug mode — the views only a developer needs
 *
 * Use one debug switch on the Providers screen, off by default. Developer views listed here appear only when it is on.
 */

/** ⚑ The side panel's tabs that only debug mode offers — the raw event list. */
export const DEVELOPER_TABS: readonly DrawerTab[] = ['events']

/** The side panel's tabs not offered right now. */
export function hiddenDrawerTabs(debugMode: boolean): readonly DrawerTab[] {
  return debugMode ? [] : DEVELOPER_TABS
}

/** ⚑ The tab to be on: the one asked for, or the panel's default when it is not offered. */
export function offeredTab(tab: DrawerTab, hidden: readonly DrawerTab[]): DrawerTab {
  return hidden.includes(tab) ? DEFAULT_TAB : tab
}
