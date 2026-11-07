import type { NativeImage } from 'electron'
import { LIMITS, type AssetFacts } from '../../shared/themes/assets'

export interface ThemeImages {
  createFromBuffer(bytes: Buffer): NativeImage
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
