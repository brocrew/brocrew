import { createHash } from 'node:crypto'

/** The selected local socket, or a Windows pipe named for this server instance. */
export function localEndpoint(
  socketPath: string,
  purpose: 'owner' | 'person',
  key: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== 'win32') return socketPath
  const name = createHash('sha256').update(`brocrew-plugin-${purpose}\0${key}`).digest('hex')
  return `\\\\.\\pipe\\brocrew-plugin-${purpose}-${name.slice(0, 32)}`
}

/** Whether local endpoints use filesystem socket paths rather than Windows pipes. */
export const isSocketFile = (platform: NodeJS.Platform = process.platform): boolean =>
  platform !== 'win32'
