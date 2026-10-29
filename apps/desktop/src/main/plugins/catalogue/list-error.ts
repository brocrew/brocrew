/** List discovery failure, separate from a plugin or supervisor failure. */
export class PluginListError extends Error {
  constructor(
    readonly state: 'not-published' | 'fetch-error',
    readonly reason?: PluginListFailureReason,
  ) {
    super(state)
  }
}
import type { PluginListFailureReason } from '../../../shared/plugin-settings'
