import type { NativeImage } from 'electron'
import { LIMITS, type AssetFacts } from '../../shared/themes/assets'

export interface ThemeImages {
  createFromBuffer(bytes: Buffer): NativeImage
}

const RED_PIXEL = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f00050001ff89993d1d0000000049454e44ae426082',
  'hex',
)

export function bitmapRedIndex(images: ThemeImages): 0 | 2 | null {
  const red = images.createFromBuffer(RED_PIXEL)
  if (red.isEmpty()) return null
  const pixel = red.toBitmap({ scaleFactor: 1 })
  if (pixel.length !== 4 || pixel[1] !== 0 || pixel[3] !== 255) return null
  if (pixel[0] === 255 && pixel[2] === 0) return 0
  if (pixel[0] === 0 && pixel[2] === 255) return 2
  return null
}

export function themePictureSampler(
  images: ThemeImages,
): (bytes: Buffer, facts: AssetFacts) => boolean {
  return (bytes, facts) => {
    try {
      if (facts.type !== 'png' && facts.type !== 'jpeg') return false
      if (
        bytes.length > LIMITS.pictureBytes ||
        !facts.width ||
        !facts.height ||
        facts.width > LIMITS.picturePixels ||
        facts.height > LIMITS.picturePixels
      )
        return false
      const picture = images.createFromBuffer(bytes)
      if (picture.isEmpty()) return false
      const size = picture.getSize(1)
      return size.width === facts.width && size.height === facts.height
    } catch {
      return false
    }
  }
}
