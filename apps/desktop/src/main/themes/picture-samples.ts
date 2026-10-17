import type { NativeImage } from 'electron'
import { LIMITS, type AssetFacts } from '../../shared/themes/assets'
import { luminance, type Rgba } from '../../shared/themes/colour'
import type { PictureSamples } from '../../shared/themes/contrast'

export interface ThemeImages {
  createFromBuffer(bytes: Buffer): NativeImage
}

const RED_PIXEL = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f00050001ff89993d1d0000000049454e44ae426082',
  'hex',
)

/** Where red sits in a bitmap `nativeImage` gives on this platform: first or third; null if neither. */
export function bitmapRedIndex(images: ThemeImages): 0 | 2 | null {
  const red = images.createFromBuffer(RED_PIXEL)
  if (red.isEmpty()) return null
  const pixel = red.toBitmap({ scaleFactor: 1 })
  if (pixel.length !== 4 || pixel[1] !== 0 || pixel[3] !== 255) return null
  if (pixel[0] === 255 && pixel[2] === 0) return 0
  if (pixel[0] === 0 && pixel[2] === 255) return 2
  return null
}

export function samplesFromBitmap(bytes: Buffer, red: 0 | 2): PictureSamples | null {
  if (bytes.length === 0 || bytes.length > 32 * 32 * 4 || bytes.length % 4 !== 0) return null
  let darkest: Rgba | undefined
  let lightest: Rgba | undefined
  let low = Infinity
  let high = -Infinity
  let seeThrough = false
  for (let at = 0; at < bytes.length; at += 4) {
    const a = bytes[at + 3]! / 255
    if (a < 1) seeThrough = true
    const channel = (index: number): number => (a === 0 ? 0 : Math.min(255, bytes[at + index]! / a))
    const colour: Rgba = { r: channel(red), g: channel(1), b: channel(2 - red), a }
    const light = luminance(colour)
    if (light < low) {
      low = light
      darkest = colour
    }
    if (light > high) {
      high = light
      lightest = colour
    }
  }
  return darkest && lightest ? { darkest, lightest, seeThrough } : null
}

export function themePictureSampler(
  images: ThemeImages,
): (bytes: Buffer, facts: AssetFacts) => PictureSamples | null {
  let order: 0 | 2 | null | undefined
  return (bytes, facts) => {
    try {
      if (facts.type !== 'png' && facts.type !== 'jpeg') return null
      if (order === undefined) order = bitmapRedIndex(images)
      if (order === null) return null
      if (
        bytes.length > LIMITS.pictureBytes ||
        !facts.width ||
        !facts.height ||
        facts.width > LIMITS.picturePixels ||
        facts.height > LIMITS.picturePixels
      )
        return null
      const picture = images.createFromBuffer(bytes)
      if (picture.isEmpty()) return null
      const size = picture.getSize(1)
      if (size.width !== facts.width || size.height !== facts.height) return null
      const scale = Math.min(1, 32 / size.width, 32 / size.height)
      const width = Math.max(1, Math.round(size.width * scale))
      const height = Math.max(1, Math.round(size.height * scale))
      const small = picture.resize({ width, height, quality: 'best' })
      const bitmap = small.toBitmap({ scaleFactor: 1 })
      if (bitmap.length !== width * height * 4) return null
      return samplesFromBitmap(bitmap, order)
    } catch {
      return null
    }
  }
}
