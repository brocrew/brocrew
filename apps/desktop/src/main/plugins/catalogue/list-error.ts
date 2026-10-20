/** List discovery failure, separate from a plugin or supervisor failure. */
export class PluginListError extends Error {
  constructor(readonly state: 'not-published' | 'fetch-error') {
    super(state)
  }
}
