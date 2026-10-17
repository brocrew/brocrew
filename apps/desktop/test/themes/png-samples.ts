/**
 * The darkest and lightest pixels of a PNG, read the way the host samples a picture, for tests that
 * check the themes the app ships. Reads 8-bit RGB and RGBA, not interlaced: what the shipped art is.
 */
import { inflateSync } from 'node:zlib'
import { luminance, type Rgba } from '../../src/shared/themes/colour'
import type { PictureSamples } from '../../src/shared/themes/contrast'

export function pngSamples(file: Buffer): PictureSamples {
  const width = file.readUInt32BE(16)
  const height = file.readUInt32BE(20)
  const [depth, colourType, , , interlace] = [file[24], file[25], file[26], file[27], file[28]]
  if (depth !== 8 || (colourType !== 2 && colourType !== 6) || interlace !== 0) {
    throw new Error(`pngSamples reads 8-bit RGB or RGBA only (depth ${depth}, type ${colourType})`)
  }
  const channels = colourType === 6 ? 4 : 3
  const data: Buffer[] = []
  for (let at = 8; at < file.length;) {
    const length = file.readUInt32BE(at)
    const type = file.toString('ascii', at + 4, at + 8)
    if (type === 'IDAT') data.push(file.subarray(at + 8, at + 8 + length))
    at += 12 + length
  }
  const raw = inflateSync(Buffer.concat(data))
  const stride = width * channels
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels]! : 0
      const b = y > 0 ? pixels[(y - 1) * stride + x]! : 0
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels]! : 0
      const value = raw[y * (stride + 1) + 1 + x]!
      const p = a + b - c
      const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)]
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      const add = [0, a, b, (a + b) >> 1, paeth][filter]!
      pixels[y * stride + x] = (value + add) & 255
    }
  }
  let darkest: Rgba | null = null
  let lightest: Rgba | null = null
  let seeThrough = false
  for (let i = 0; i < pixels.length; i += channels) {
    const pixel: Rgba = {
      r: pixels[i]!,
      g: pixels[i + 1]!,
      b: pixels[i + 2]!,
      a: channels === 4 ? pixels[i + 3]! / 255 : 1,
    }
    if (pixel.a < 1) seeThrough = true
    if (pixel.a === 0) continue
    if (!darkest || luminance(pixel) < luminance(darkest)) darkest = pixel
    if (!lightest || luminance(pixel) > luminance(lightest)) lightest = pixel
  }
  const none: Rgba = { r: 0, g: 0, b: 0, a: 0 }
  return { darkest: darkest ?? none, lightest: lightest ?? none, seeThrough }
}
