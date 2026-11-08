import { providerDescriptor, type Provider } from '@brobot2/shared'

export function signInKey(provider: Provider, profileId: string): string {
  return providerDescriptor(provider).signIn.portScope === 'machine'
    ? provider
    : `${provider}:${profileId}`
}

export function signInHeldBy(provider: Provider, holder: string, asked: string): Error {
  if (holder === asked)
    return new Error(`a ${provider} sign-in is already in progress for this profile`)
  return new Error(
    `a ${provider} sign-in is already in progress for the profile "${holder}" — only one can run ` +
      `at a time, because ${provider} sends its browser redirect to one fixed port on this machine. ` +
      `Finish or cancel that one, then try again.`,
  )
}
