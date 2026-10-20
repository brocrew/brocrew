import os from 'node:os'
export interface PrivateModes {
  dir?: number
  file?: number
}
export function privateModes(platform: NodeJS.Platform = os.platform()): PrivateModes {
  return platform === 'win32' ? {} : { dir: 0o700, file: 0o600 }
}
export const PRIVATE: PrivateModes = privateModes()
