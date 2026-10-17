import { deflateSync } from 'node:zlib'

const DIGITS: Readonly<Record<string, readonly string[]>> = {
  '1': ['010', '110', '010', '010', '111'],
  '2': ['110', '001', '010', '100', '111'],
  '3': ['110', '001', '010', '001', '110'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '110', '001', '110'],
  '6': ['011', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '110'],
  '+': ['000', '010', '111', '010', '000'],
}

/** The small overlay uses 9+ above nine; the accessible description keeps the whole count. */
export function attentionOverlayLabel(count: number): string {
  return count <= 0 ? '' : count > 9 ? '9+' : String(count)
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(kind: string, bytes: Buffer): Buffer {
  const type = Buffer.from(kind)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(bytes.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([type, bytes])))
  return Buffer.concat([length, type, bytes, crc])
}

/** A transparent 16px PNG works without a renderer, fonts or a platform image dependency. */
export function attentionOverlay(count: number): Buffer | null {
  const label = attentionOverlayLabel(count)
  if (!label) return null
  const pixels = Buffer.alloc(16 * (1 + 16 * 4))
  function pixel(x: number, y: number, color: readonly number[]): void {
    const at = y * 65 + 1 + x * 4
    color.forEach((value, channel) => (pixels[at + channel] = value))
  }
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if ((x - 7.5) ** 2 + (y - 7.5) ** 2 <= 7.5 ** 2) pixel(x, y, [180, 40, 35, 255])
    }
  }
  const scale = label.length === 1 ? 2 : 1
  const width = label.length * 3 * scale + (label.length - 1) * scale
  const left = Math.floor((16 - width) / 2)
  const top = Math.floor((16 - 5 * scale) / 2)
  for (const [index, digit] of [...label].entries()) {
    DIGITS[digit]?.forEach((row, y) => {
      for (const [x, ink] of [...row].entries()) {
        if (ink !== '1') continue
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            pixel(
              left + index * 4 * scale + x * scale + dx,
              top + y * scale + dy,
              [255, 255, 255, 255],
            )
          }
        }
      }
    })
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(16, 0)
  header.writeUInt32BE(16, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
