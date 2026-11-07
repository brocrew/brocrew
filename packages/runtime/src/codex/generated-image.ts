import { IMAGE_MEDIA_TYPES, imageMediaType } from '../image-media-type'
export { IMAGE_MEDIA_TYPES, imageMediaType } from '../image-media-type'
import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

export const GENERATED_IMAGES_DIRNAME = 'generated_images'

function realOrNull(path: string): string | null {
  try {
    return realpathSync.native(path)
  } catch {
    return null
  }
}

export function resolveGeneratedImage(input: {
  codexHome: string

  threadId: string

  imageId: string

  savedPath?: string | undefined
}): string | null {
  const home = realOrNull(resolve(input.codexHome))
  const root = home === null ? null : realOrNull(join(home, GENERATED_IMAGES_DIRNAME))

  const claimed = input.savedPath?.trim()
  const candidates = [
    ...(claimed ? [claimed] : []),
    ...(root === null
      ? []
      : [...IMAGE_MEDIA_TYPES.keys()].map((ext) =>
          join(root, input.threadId, `${input.imageId}${ext}`),
        )),
  ]

  for (const candidate of candidates) {
    // was ever talking about. Refused rather than joined to something.
    if (!isAbsolute(candidate)) continue
    if (imageMediaType(candidate) === null) continue
    const real = realOrNull(candidate)
    if (real === null) continue

    // A link named image.png can resolve to a document; check the real extension too.
    if (imageMediaType(real) === null) continue
    try {
      if (!statSync(real).isFile()) continue
    } catch {
      continue
    }
    return real
  }
  return null
}
