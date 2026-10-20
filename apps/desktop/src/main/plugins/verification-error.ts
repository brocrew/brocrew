export type PluginVerificationFailure =
  | 'invalid'
  | 'signature'
  | 'digest'
  | 'path'
  | 'limit'
  | 'target'
  | 'immutable-release'
  | 'install-hook'

/** Error details never carry package text or an upstream exception across the host boundary. */
export class PluginVerificationError extends Error {
  constructor(readonly code: PluginVerificationFailure) {
    super('Plugin unavailable. Try again.')
    this.name = 'PluginVerificationError'
  }
}

export function refusePlugin(code: PluginVerificationFailure): never {
  throw new PluginVerificationError(code)
}
