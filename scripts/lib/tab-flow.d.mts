/**
 * Type declarations for the tab-flow walk. The implementation stays plain `.mjs` for live
 * Node instruments without a build, while TypeScript DOM checks receive the same contract
 * without an import-error suppression tied to formatting.
 */

/** Every drawer tab id, in strip order. */
export declare const DRAWER_TABS: readonly string[]

/** Which tab owns which drawer-BODY hook. */
export declare const TAB_OF_HOOK: Readonly<Record<string, string>>

/** Hook families built in a `v-for`, matched by prefix. */
export declare const TAB_OF_HOOK_PREFIX: Readonly<Record<string, string>>

/** Hooks inside a tab body that belong to no tab, because they are drawn elsewhere too. */
export declare const APP_WIDE_HOOKS: ReadonlySet<string>

/** The token a deliberately cross-tab read carries. */
export declare const WIDE_READ_MARK: string

/** Every `[data-cy=…]` an expression names, as exact hooks. */
export declare function hooksIn(expression: string): string[]

/**
 * Every hook a smoke builds in the PAGE, read out of its own source rather than from a live run
 * (345). See the implementation for what this can and cannot see.
 */
export declare function builtHookViolations(
  source: string,
): { line: number; text: string; code: string }[]

/** A `[data-cy=` whose name is built at runtime rather than written down, or `null`. */
export declare function unreadableSelectorIn(expression: string): string | null

/** The tab that owns `hook`, or `null` when it is not inside the drawer body. */
export declare function tabOfHook(hook: string): string | null

/** The violation this expression commits against `activeTab`, or `null`. */
export declare function tabFlowViolation(
  activeTab: string | null,
  expression: string,
): string | null

/** The page-side expression that answers "which tab is mounted right now?". */
export declare const ACTIVE_TAB_EXPRESSION: string

/** Run the walk over one expression and throw if it is a violation. */
export declare function assertTabFlow(
  expression: string,
  readActiveTab: (probe: string) => Promise<string | null>,
): Promise<void>
