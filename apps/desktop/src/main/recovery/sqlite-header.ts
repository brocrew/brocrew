import type { RecoveryFs } from './files'

const HEADER_BYTES = 100

export async function headerOf(file: string, fs: RecoveryFs): Promise<Uint8Array | null> {
  const header = new Uint8Array(HEADER_BYTES)
  const handle = await fs.open(file, 'r')
  try {
    let filled = 0
    while (filled < HEADER_BYTES) {
      const { bytesRead } = await handle.read(header, filled, HEADER_BYTES - filled, filled)
      if (bytesRead === 0) return null
      filled += bytesRead
    }
    return header
  } finally {
    await handle.close()
  }
}
