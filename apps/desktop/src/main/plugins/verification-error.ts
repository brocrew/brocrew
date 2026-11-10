export type PluginVerificationFailure = 'invalid' | 'digest' | 'path' | 'limit' | 'target'

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
