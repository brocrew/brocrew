export function readVolumeIdentity(file: string, device: string, options?: {
  platform?: NodeJS.Platform
  read?(program: string, args: string[]): string
}): string | undefined
