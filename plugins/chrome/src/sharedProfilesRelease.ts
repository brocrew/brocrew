export const sharedProfilesRelease = Object.freeze({ format: 1, mac: true, windows: true })

export function sharedProfilesReleased(platform: string, signal?: unknown): boolean {
  if (!signal || typeof signal !== 'object') return false
  const release = signal as Record<string, unknown>
  if (
    release.format !== 1 ||
    typeof release.mac !== 'boolean' ||
    typeof release.windows !== 'boolean'
  )
    return false
  return platform === 'darwin' ? release.mac : platform === 'win32' ? release.windows : false
}
